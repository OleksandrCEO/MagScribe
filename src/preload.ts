import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { UiLang } from './i18n';

export type SelectedFile = { path: string; name: string; size: number };
export type ExportedAudio = { path: string; size: number }; // an OGG/Opus file in the temp folder, see audio.ts
export type Theme = 'light' | 'dark' | 'system';

// Every `on*` below hands back its own remover: production mounts once, but HMR in dev would otherwise
// stack a second listener on every reload and the window would process each message twice.
const subscribe = (channel: string, relay: (event: IpcRendererEvent, ...args: unknown[]) => void): (() => void) => {
  ipcRenderer.on(channel, relay);
  return () => {
    ipcRenderer.off(channel, relay);
  };
};

// The only bridge between the renderer and the system. Keep it to what the UI actually needs.
const api = {
  selectFile: (): Promise<SelectedFile | null> => ipcRenderer.invoke('file:select'),
  // Modern Electron strips File.path; this is the only way to learn where a dropped file lives.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  // Transcription itself runs in a renderer worker; main only turns media into samples it can chew on.
  // `from` lets a stopped run resume: ffmpeg seeks there and decodes only what is left.
  extractAudio: (filePath: string, from?: number): Promise<Float32Array> =>
    ipcRenderer.invoke('audio:extract', filePath, from),
  exportAudio: (filePath: string): Promise<ExportedAudio> => ipcRenderer.invoke('audio:export', filePath),
  // Kills the ffmpeg behind the current extract or export; safe to call when there is none.
  cancelAudio: (): void => ipcRenderer.send('audio:cancel'),
  // Kills the claude run behind summarize/chapters; safe to call when there is none.
  cancelAi: (): void => ipcRenderer.send('ai:cancel'),
  // Asked once on startup: without a system ffmpeg neither conversion can run, and the window says so instead
  // of failing on the first click. The app ships no binary of its own — see audio.ts for why.
  hasFfmpeg: (): Promise<boolean> => ipcRenderer.invoke('ffmpeg:present'),
  // Opens ffmpeg's download page. The URL lives in main and takes no argument from here.
  openFfmpegDownload: (): void => ipcRenderer.send('ffmpeg:download'),
  // The raw file, for the browser decoder that stands in for a missing ffmpeg. Rejects on a file too big to
  // hold in memory, which is what that decoder would do with it.
  readBytes: (filePath: string): Promise<Uint8Array> => ipcRenderer.invoke('file:bytes', filePath),
  // Percentage of the extract/export ffmpeg is currently running.
  onAudioProgress: (listener: (percent: number) => void): (() => void) =>
    subscribe('audio:progress', (_event, percent: unknown) => listener(Number(percent))),
  // Both run the local claude CLI in main: a summary of the plain transcript, chapters of the timestamped one.
  // `prompt` is whatever the settings window holds; main falls back to the built-in instruction without one.
  summarize: (transcript: string, prompt: string): Promise<string> =>
    ipcRenderer.invoke('ai:run', 'summary', transcript, prompt),
  chapters: (timedTranscript: string, prompt: string): Promise<string> =>
    ipcRenderer.invoke('ai:run', 'chapters', timedTranscript, prompt),
  // Both return false when the user cancels the save dialog.
  saveText: (text: string, suggestedName: string): Promise<boolean> =>
    ipcRenderer.invoke('file:save', text, suggestedName),
  saveAudio: (fromPath: string, suggestedName: string): Promise<boolean> =>
    ipcRenderer.invoke('audio:save', fromPath, suggestedName),
  // Resolves false when the clipboard refused the text; the window says so instead of a false «Скопійовано».
  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write', text),
  // Lets main keep the machine awake and ask before the window closes mid-run.
  setWorking: (working: boolean): void => ipcRenderer.send('work:working', working),
  // Main flips nativeTheme, so prefers-color-scheme (and with it the whole CSS theme) follows the choice.
  setTheme: (theme: Theme): void => ipcRenderer.send('theme:set', theme),
  // The window owns the interface language; main needs it for the open dialog and for its own error messages.
  setLang: (lang: UiLang): void => ipcRenderer.send('lang:set', lang),
  notify: (title: string, body: string): void => ipcRenderer.send('notify', title, body),
  // Main asks before closing a window that is still working; the window answers with its own dialog.
  onCloseAsk: (listener: () => void): (() => void) => subscribe('close:ask', () => listener()),
  answerClose: (quit: boolean): void => ipcRenderer.send('close:answer', quit),
  // Main reports a crashed GPU process here; the model is gone with it, so the UI must stop waiting.
  onGpuGone: (listener: (message: string) => void): (() => void) =>
    subscribe('gpu:gone', (_event, message: unknown) => listener(String(message))),
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
