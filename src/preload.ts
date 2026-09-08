import { contextBridge, ipcRenderer, webUtils } from 'electron';

export type SelectedFile = { path: string; name: string; size: number };

// The only bridge between the renderer and the system. Keep it to what the UI actually needs.
const api = {
  selectFile: (): Promise<SelectedFile | null> => ipcRenderer.invoke('file:select'),
  // Modern Electron strips File.path; this is the only way to learn where a dropped file lives.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  transcribe: (filePath: string): Promise<string> => ipcRenderer.invoke('transcribe:run', filePath),
  summarize: (transcript: string): Promise<string> => ipcRenderer.invoke('summary:run', transcript),
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
