import { app, BrowserWindow, Menu, dialog, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import type { SelectedFile } from './preload';
import { extractAudio } from './audio';

// Linux ships WebGPU behind a flag and needs the Vulkan backend explicitly; without both, requestAdapter()
// returns null and transcription falls back to the (much slower) wasm engine.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('enable-features', 'Vulkan');
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

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    ...readBounds(), // no saved x/y -> Electron centers the window itself
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false, // avoid the white flash: shown on ready-to-show below
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveBounds(mainWindow));

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
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
