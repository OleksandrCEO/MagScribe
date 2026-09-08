import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';

export type SelectedFile = { path: string; name: string; size: number };
export type ExportedAudio = { path: string; size: number }; // an OGG/Opus file in the temp folder, see audio.ts
export type Theme = 'light' | 'dark' | 'system';

// The only bridge between the renderer and the system. Keep it to what the UI actually needs.
const api = {
  selectFile: (): Promise<SelectedFile | null> => ipcRenderer.invoke('file:select'),
  // Modern Electron strips File.path; this is the only way to learn where a dropped file lives.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  // Transcription itself runs in a renderer worker; main only turns media into samples it can chew on.
  extractAudio: (filePath: string): Promise<Float32Array> => ipcRenderer.invoke('audio:extract', filePath),
  exportAudio: (filePath: string): Promise<ExportedAudio> => ipcRenderer.invoke('audio:export', filePath),
  summarize: (transcript: string): Promise<string> => ipcRenderer.invoke('summary:run', transcript),
  // Both return false when the user cancels the save dialog.
  saveText: (text: string, suggestedName: string): Promise<boolean> =>
    ipcRenderer.invoke('file:save', text, suggestedName),
  saveAudio: (fromPath: string, suggestedName: string): Promise<boolean> =>
    ipcRenderer.invoke('audio:save', fromPath, suggestedName),
  copyText: (text: string): Promise<void> => clipboard.writeText(text),
  // Lets main keep the machine awake and ask before the window closes mid-run.
  setWorking: (working: boolean): void => ipcRenderer.send('work:working', working),
  // Main flips nativeTheme, so prefers-color-scheme (and with it the whole CSS theme) follows the choice.
  setTheme: (theme: Theme): void => ipcRenderer.send('theme:set', theme),
  notify: (title: string, body: string): void => ipcRenderer.send('notify', title, body),
  // Main reports a crashed GPU process here; the model is gone with it, so the UI must stop waiting.
  onGpuGone: (listener: (message: string) => void): void => {
    ipcRenderer.on('gpu:gone', (_event, message: unknown) => listener(String(message)));
  },
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
