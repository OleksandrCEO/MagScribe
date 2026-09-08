import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';

export type SelectedFile = { path: string; name: string; size: number };

// The only bridge between the renderer and the system. Keep it to what the UI actually needs.
const api = {
  selectFile: (): Promise<SelectedFile | null> => ipcRenderer.invoke('file:select'),
  // Modern Electron strips File.path; this is the only way to learn where a dropped file lives.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  // Transcription itself runs in a renderer worker; main only turns media into samples it can chew on.
  extractAudio: (filePath: string): Promise<Float32Array> => ipcRenderer.invoke('audio:extract', filePath),
  summarize: (transcript: string): Promise<string> => ipcRenderer.invoke('summary:run', transcript),
  // Returns false when the user cancels the save dialog.
  saveText: (text: string, suggestedName: string): Promise<boolean> =>
    ipcRenderer.invoke('file:save', text, suggestedName),
  copyText: (text: string): Promise<void> => clipboard.writeText(text),
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
