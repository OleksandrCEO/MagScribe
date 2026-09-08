import { app, BrowserWindow, Menu, Notification, dialog, ipcMain, nativeTheme, powerSaveBlocker, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import type { SelectedFile } from './preload';
import { extractAudio } from './audio';
import { summarize } from './summary';

// Linux hides WebGPU behind a flag and needs the Vulkan backend explicitly; without both, requestAdapter()
// returns null (or only SwiftShader) and transcription drops to the much slower wasm engine.
// Vulkan also switches window compositing, which paints an empty window on this stack — so composite on the
// CPU instead. Our UI is text and a progress bar; the GPU is here for the model, not for the chrome.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('enable-features', 'Vulkan');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const MIN_WIDTH = 640;
const MIN_HEIGHT = 520;
const DEFAULT_BOUNDS = { width: 900, height: 680 };

type WindowBounds = { width: number; height: number; x?: number; y?: number };

const boundsFile = (): string => path.join(app.getPath('userData'), 'window-state.json');

// A saved position can point at a monitor that is no longer attached — drop it and let Electron center the window.
const isOnSomeDisplay = (x: number, y: number, width: number, height: number): boolean =>
  screen.getAllDisplays().some(({ workArea: a }) =>
    x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y);

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#ffffff',
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
    const answer = dialog.showMessageBoxSync(window, {
      type: 'question',
      buttons: ['Продовжити', 'Перервати'],
      defaultId: 0,
      cancelId: 0,
      message: 'Транскрипція ще триває',
      detail: 'Якщо закрити вікно зараз, розпізнаний текст буде втрачено.',
    });

    if (answer === 1) {
      setWorking(false);
      window.destroy();
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
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

ipcMain.handle('audio:extract', (_event, filePath: unknown): Promise<Float32Array> => {
  if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('audio:extract needs a file path');
  return extractAudio(filePath);
});

ipcMain.handle('file:save', async (_event, text: unknown, suggestedName: unknown): Promise<boolean> => {
  if (typeof text !== 'string') throw new Error('file:save needs text');

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: typeof suggestedName === 'string' ? suggestedName : 'transcript.txt',
    filters: [{ name: 'Текст', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return false;

  await fs.promises.writeFile(filePath, text, 'utf-8');
  return true;
});

ipcMain.on('work:working', (_event, value: unknown) => setWorking(value === true));

ipcMain.on('notify', (_event, title: unknown, body: unknown) => {
  if (!Notification.isSupported()) return;

  const notification = new Notification({ title: String(title), body: String(body) });
  notification.on('click', () => mainWindow?.show());
  notification.show();
});

ipcMain.handle('summary:run', (_event, transcript: unknown): Promise<string> => {
  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    throw new Error('summary:run needs a transcript');
  }
  return summarize(transcript);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  Menu.setApplicationMenu(null);
  createWindow();
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
