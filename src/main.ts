import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  Notification,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  powerSaveBlocker,
  protocol,
  screen,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import type { ExportedAudio, SelectedFile } from './preload';
import { cancelFfmpeg, discardExport, exportAudio, extractAudio, isExport } from './audio';
import { MAX_PROMPT, type AiTask } from './prompts';
import { AI_TASKS } from './summary';

// Linux hides WebGPU behind a flag and needs the Vulkan backend explicitly; without both, requestAdapter()
// returns null (or only SwiftShader) and transcription drops to the much slower wasm engine.
// Vulkan also switches window compositing, which paints an empty window on this stack — so composite on the
// CPU instead. Our UI is text and a progress bar; the GPU is here for the model, not for the chrome.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('enable-features', 'Vulkan');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

// Chromium caps every GPU disk cache at 6 MB. Dawn stores one VkPipelineCache blob per pipeline in
// DawnWebGPUCache and Whisper builds hundreds of them at ~20 KB each, so the cache kept evicting itself and
// every cold start recompiled all shaders: minutes at 0 % with the GPU process on five cores. 512 MB holds the set.
app.commandLine.appendSwitch('gpu-disk-cache-size-kb', String(512 * 1024));

// Chromium refuses CacheStorage on file://, and @huggingface/transformers treats that as "no cache available"
// and re-downloads the model — the packaged app pulled the whole Whisper checkpoint from HuggingFace on every
// launch, while the dev server (http://localhost) cached it fine. A standard+secure scheme gives the renderer a
// real origin, which is what the Cache API keys on. Must be called before `ready`.
const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://bundle`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    // secure: CacheStorage needs a secure context. supportFetchAPI: the module worker and the onnxruntime .wasm
    // are fetched from this origin. corsEnabled: the worker fetches model files from huggingface.co.
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const MIN_WIDTH = 640;
const MIN_HEIGHT = 520;
const DEFAULT_BOUNDS = { width: 1040, height: 680 };

type WindowBounds = { width: number; height: number; x?: number; y?: number };

const boundsFile = (): string => path.join(app.getPath('userData'), 'window-state.json');

// A saved position can point at a monitor that is no longer attached — drop it and let Electron center the window.
const isOnSomeDisplay = (x: number, y: number, width: number, height: number): boolean =>
  screen
    .getAllDisplays()
    .some(({ workArea: a }) => x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y);

const readBounds = (): WindowBounds => {
  try {
    const saved: unknown = JSON.parse(fs.readFileSync(boundsFile(), 'utf-8'));
    if (typeof saved !== 'object' || saved === null) return DEFAULT_BOUNDS;
    const { width, height, x, y } = saved as Partial<WindowBounds>;
    if (typeof width !== 'number' || typeof height !== 'number') return DEFAULT_BOUNDS;

    const bounds: WindowBounds = { width: Math.max(width, MIN_WIDTH), height: Math.max(height, MIN_HEIGHT) };
    if (typeof x === 'number' && typeof y === 'number' && isOnSomeDisplay(x, y, bounds.width, bounds.height)) {
      bounds.x = x;
      bounds.y = y;
    }
    return bounds;
  } catch {
    return DEFAULT_BOUNDS; // no state yet, or the file is unreadable/corrupted
  }
};

const saveBounds = (window: BrowserWindow): void => {
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(window.getNormalBounds()));
  } catch {
    // losing the window position is not worth blocking the app from closing
  }
};

let mainWindow: BrowserWindow | null = null;
let working = false;
let closing = false; // a close was asked for and the window is showing its own question
let sleepBlocker: number | null = null;

/** The renderer tells us when a transcription is in flight; the main process guards the machine around it. */
const setWorking = (value: boolean): void => {
  working = value;

  // A long transcription is unattended work — do not let the machine doze off in the middle of it.
  if (working && sleepBlocker === null) {
    sleepBlocker = powerSaveBlocker.start('prevent-app-suspension');
  }
  if (!working && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    ...readBounds(), // no saved x/y -> Electron centers the window itself
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false, // avoid the white flash: shown on ready-to-show below
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const window = mainWindow;

  const show = (): void => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  };

  window.once('ready-to-show', show);
  // Safety net: with GPU compositing off (see the Vulkan switches above) a hidden window never paints its
  // first frame, so ready-to-show never fires and the app would sit there invisible.
  window.webContents.once('did-finish-load', show);
  window.on('close', (event) => {
    saveBounds(window);
    if (!working) return;

    event.preventDefault();
    // A second click on the system's close button overrides the question, so a renderer that stopped answering
    // can never trap the person inside the app.
    if (closing) {
      setWorking(false);
      window.destroy();
      return;
    }
    closing = true;
    window.webContents.send('close:ask');
  });

  // and load the index.html of the app.
  window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL || `${APP_ORIGIN}/index.html`);
};

const rendererRoot = (): string => path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

/** Serves the built renderer over app://. Anything resolving outside the bundle directory is refused. */
const serveBundle = async (request: Request): Promise<Response> => {
  const root = rendererRoot();
  const { pathname } = new URL(request.url);
  const file = path.join(root, decodeURIComponent(pathname));

  // path.join normalises the "..", so this catches both plain and percent-encoded traversal.
  if (file !== root && !file.startsWith(root + path.sep)) return new Response(null, { status: 403 });

  return net.fetch(pathToFileURL(file).toString());
};

// The renderer never touches the filesystem: it gets a path only from this native dialog.
ipcMain.handle('file:select', async (): Promise<SelectedFile | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Відео', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv'] },
      { name: 'Аудіо', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'wma'] },
      { name: 'Усі файли', extensions: ['*'] },
    ],
  });
  if (canceled || filePaths.length === 0) return null;

  const [filePath] = filePaths;
  const { size } = await fs.promises.stat(filePath);
  return { path: filePath, name: path.basename(filePath), size };
});

const requirePath = (value: unknown, channel: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${channel} needs a file path`);
  return value;
};

// Both conversions stream their percentage back to the window that asked for them.
ipcMain.handle('audio:extract', (event, filePath: unknown, from: unknown): Promise<Float32Array> =>
  extractAudio(
    requirePath(filePath, 'audio:extract'),
    (percent) => event.sender.send('audio:progress', percent),
    // Where a resumed run picks up; anything that is not a sane number decodes the file from its start.
    typeof from === 'number' && Number.isFinite(from) && from > 0 ? from : 0,
  ),
);

ipcMain.handle('audio:export', (event, filePath: unknown): Promise<ExportedAudio> =>
  exportAudio(requirePath(filePath, 'audio:export'), (percent) => event.sender.send('audio:progress', percent)),
);

// Where the last save went. Without it every dialog opens in ~/Downloads, however many times in a row the
// person has picked another folder.
const saveDirFile = (): string => path.join(app.getPath('userData'), 'save-dir.txt');
let saveDir: string | null | undefined; // undefined: not read from disk yet

const readSaveDir = (): string | null => {
  if (saveDir !== undefined) return saveDir;

  try {
    const saved = fs.readFileSync(saveDirFile(), 'utf-8').trim();
    // The folder may have been renamed or removed since; the dialog then falls back to the system's choice.
    saveDir = saved !== '' && path.isAbsolute(saved) && fs.statSync(saved).isDirectory() ? saved : null;
  } catch {
    saveDir = null;
  }
  return saveDir;
};

const rememberSaveDir = (target: string): void => {
  saveDir = path.dirname(target);
  try {
    fs.writeFileSync(saveDirFile(), saveDir, 'utf-8');
  } catch {
    // losing it only costs the next dialog its starting folder
  }
};

/** Save dialog; null when the user cancels. It opens where the last save landed. */
const askWhereToSave = async (
  suggestedName: unknown,
  fallback: string,
  filter: Electron.FileFilter,
): Promise<string | null> => {
  const name = typeof suggestedName === 'string' ? suggestedName : fallback;
  const directory = readSaveDir();

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: directory === null ? name : path.join(directory, name),
    filters: [filter],
  });
  if (canceled || !filePath) return null;

  rememberSaveDir(filePath);
  return filePath;
};

ipcMain.handle('file:save', async (_event, text: unknown, suggestedName: unknown): Promise<boolean> => {
  if (typeof text !== 'string') throw new Error('file:save needs text');

  // The renderer saves .txt and .srt through this one channel, so the dialog filter follows the name it suggested.
  const suffix = typeof suggestedName === 'string' ? path.extname(suggestedName).slice(1).toLowerCase() : '';
  const extension = /^[a-z0-9]{1,8}$/.test(suffix) ? suffix : 'txt';

  const target = await askWhereToSave(suggestedName, `transcript.${extension}`, {
    name: extension.toUpperCase(),
    extensions: [extension],
  });
  if (target === null) return false;

  await fs.promises.writeFile(target, text, 'utf-8');
  return true;
});

ipcMain.handle('audio:save', async (_event, fromPath: unknown, suggestedName: unknown): Promise<boolean> => {
  // Only the track we just produced may be copied out — the renderer never gets to name arbitrary sources.
  if (typeof fromPath !== 'string' || !isExport(fromPath)) throw new Error('audio:save: unknown source file');

  const target = await askWhereToSave(suggestedName, 'audio.ogg', { name: 'OGG (Opus)', extensions: ['ogg'] });
  if (target === null) return false;

  await fs.promises.copyFile(fromPath, target);
  return true;
});

// The renderer cannot do this itself: its preload is sandboxed, and a sandboxed preload gets only a subset of
// electron (ipcRenderer, contextBridge, webFrame, webUtils, nativeImage, crashReporter) — no clipboard module.
ipcMain.handle('clipboard:write', async (_event, text: unknown): Promise<boolean> => {
  if (typeof text !== 'string') throw new Error('clipboard:write needs text');

  await clipboard.writeText(text); // async since Electron 44, modelled on the W3C API
  // Read it back: on Wayland the selection belongs to whoever claimed it last, so a write can quietly not stick.
  return (await clipboard.readText()) === text;
});

ipcMain.on('theme:set', (_event, theme: unknown) => {
  if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return;
  nativeTheme.themeSource = theme;
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff');
});

// Stopping a run: the renderer kills its own worker, main kills the conversion it may be sitting in.
ipcMain.on('audio:cancel', cancelFfmpeg);

// The answer to that question. Anything but a clear yes leaves the window alone.
ipcMain.on('close:answer', (_event, quit: unknown) => {
  closing = false;
  if (quit !== true || mainWindow === null) return;

  setWorking(false);
  saveBounds(mainWindow);
  mainWindow.destroy();
});

ipcMain.on('work:working', (_event, value: unknown) => setWorking(value === true));

ipcMain.on('notify', (_event, title: unknown, body: unknown) => {
  if (!Notification.isSupported()) return;

  const notification = new Notification({ title: String(title), body: String(body) });
  notification.on('click', () => mainWindow?.show());
  notification.show();
});

ipcMain.handle('ai:run', (_event, task: unknown, transcript: unknown, prompt: unknown): Promise<string> => {
  const run = AI_TASKS[task as AiTask] as typeof AI_TASKS[AiTask] | undefined;
  if (!run) throw new Error(`ai:run: unknown task ${String(task)}`);
  if (typeof transcript !== 'string' || transcript.trim().length === 0) throw new Error('ai:run needs a transcript');

  // The prompt comes from a text box in the settings window: anything odd falls back to the built-in one.
  const edited = typeof prompt === 'string' && prompt.trim().length > 0 ? prompt.trim() : undefined;
  if (edited !== undefined && edited.length > MAX_PROMPT) throw new Error('ai:run: prompt is too long');

  return run(transcript, edited);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  Menu.setApplicationMenu(null);
  // The app is dark unless told otherwise, and this is what the first frame is painted with: the renderer
  // re-asserts the saved choice a moment later, but by then the window must not have flashed white.
  nativeTheme.themeSource = 'dark';
  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) protocol.handle(APP_SCHEME, serveBundle);
  createWindow();
});

app.on('will-quit', discardExport);

// A dead GPU process takes the WebGPU device and the model with it; the renderer would otherwise wait forever at 0 %.
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU') return;
  const line = `${new Date().toISOString()} GPU process gone: ${details.reason}, exit code ${details.exitCode}`;
  console.error(line);
  fs.appendFile(path.join(app.getPath('userData'), 'gpu.log'), `${line}\n`, () => {});
  mainWindow?.webContents.send('gpu:gone', `GPU-процес завершився (${details.reason}, код ${details.exitCode})`);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
