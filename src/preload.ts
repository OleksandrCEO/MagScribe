import { contextBridge, ipcRenderer } from 'electron';

// The only bridge between the renderer and the system. Keep it to what the UI actually needs.
const api = {
  selectFile: (): Promise<string | null> => ipcRenderer.invoke('file:select'),
  transcribe: (filePath: string): Promise<string> => ipcRenderer.invoke('transcribe:run', filePath),
  summarize: (transcript: string): Promise<string> => ipcRenderer.invoke('summary:run', transcript),
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
