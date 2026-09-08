import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AudioLinesIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  FileAudioIcon,
  FileVideoIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SparklesIcon,
  SunIcon,
  UploadIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import type { ExportedAudio, SelectedFile, Theme } from '@/preload';
import type { Device, WorkerRequest, WorkerResponse } from '@/worker';
import { cn } from 'cn';

const formatSize = (bytes: number): string => {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const power = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  const value = bytes / 1024 ** power;
  return `${power === 0 ? value : value.toFixed(1)} ${units[power]}`;
};

const formatDuration = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const countWords = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

const deviceLabel: Record<Device, string> = { webgpu: 'WebGPU', wasm: 'WASM' };

const THEME_KEY = 'theme';
const themes: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Світла', Icon: SunIcon },
  { value: 'system', label: 'Як у системі', Icon: MonitorIcon },
  { value: 'dark', label: 'Темна', Icon: MoonIcon },
];

const readTheme = (): Theme => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return themes.some((theme) => theme.value === saved) ? (saved as Theme) : 'system';
  } catch {
    return 'system';
  }
};

// One block above the pill for every long wait; `value` is undefined for stages that have no percentage.
type Job = { label: string; value?: number };

export default function App() {
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [download, setDownload] = useState(0);
  const [model, setModel] = useState<{ device: Device; encoder: string } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [converting, setConverting] = useState(false); // decoding the file for the model
  const [progress, setProgress] = useState<number | null>(null); // null while nothing is being transcribed
  const [transcript, setTranscript] = useState('');
  const [elapsed, setElapsed] = useState<number | null>(null); // seconds the last finished run took
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [exporting, setExporting] = useState(false); // re-encoding the file to OGG/Opus
  const [audio, setAudio] = useState<ExportedAudio | null>(null);
  const [pending, setPending] = useState(false); // asked to transcribe before the model finished loading

  // dragenter/dragleave also fire for children, so count the nesting instead of toggling on every event.
  const dragDepth = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const ready = useRef(false); // read inside the worker listener, which never sees state updates
  const startedAt = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'download') setDownload(message.progress);
      if (message.type === 'ready') {
        setDownload(100);
        setModel({ device: message.device, encoder: message.encoder });
        ready.current = true;
      }
      if (message.type === 'fallback') setFallback(`${message.from} недоступний: ${message.reason}`);
      if (message.type === 'progress') setProgress(message.progress);
      if (message.type === 'partial') setTranscript(message.text);
      if (message.type === 'result') {
        setTranscript(message.text);
        setProgress(null);
        setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
        window.api.notify('MagScribe', `Транскрибація завершена — ${countWords(message.text)} слів`);
      }
      if (message.type === 'error') {
        // Before the model is up, the failure is permanent — keep it on screen instead of a toast that fades.
        if (!ready.current) setModelError(message.message);
        else toast.error(message.message);
        setProgress(null);
      }
    });

    worker.postMessage({ type: 'load' } satisfies WorkerRequest);
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // a theme that does not survive a restart is not worth an error
    }
    window.api.setTheme(theme);
  }, [theme]);

  const busy = converting || progress !== null || exporting;

  const stopDragging = (): void => {
    dragDepth.current = 0;
    setDragging(false);
  };

  const clearResults = (): void => {
    setTranscript('');
    setSummary('');
    setElapsed(null);
    setAudio(null);
  };

  const pickFile = (picked: SelectedFile): void => {
    setFile(picked);
    clearResults();
  };

  const startOver = (): void => {
    setFile(null);
    clearResults();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    stopDragging();

    // A drop mid-run would wipe the result the worker is still streaming into.
    const dropped = event.dataTransfer.files[0];
    if (!dropped || busy) return;
    pickFile({ path: window.api.getPathForFile(dropped), name: dropped.name, size: dropped.size });
  };

  const chooseFile = async (): Promise<void> => {
    const chosen = await window.api.selectFile();
    if (chosen) pickFile(chosen);
  };

  const failWith = (error: unknown): void => {
    toast.error(error instanceof Error ? error.message : String(error));
  };

  const baseName = file ? file.name.replace(/\.[^.]+$/, '') : '';
  const extension = file?.name.split('.').pop() ?? '';

  const startTranscription = async (): Promise<void> => {
    if (!file || !workerRef.current) return;

    clearResults();
    setPending(false);
    setConverting(true);
    startedAt.current = Date.now();
    try {
      const samples = await window.api.extractAudio(file.path);
      setProgress(0);
      workerRef.current.postMessage({ type: 'transcribe', audio: samples } satisfies WorkerRequest, [samples.buffer]);
    } catch (error) {
      failWith(error);
      setProgress(null);
    } finally {
      setConverting(false);
    }
  };

  const convertToAudio = async (): Promise<void> => {
    if (!file) return;

    clearResults();
    setExporting(true);
    try {
      setAudio(await window.api.exportAudio(file.path));
    } catch (error) {
      failWith(error);
    } finally {
      setExporting(false);
    }
  };

  const copy = async (text: string): Promise<void> => {
    await window.api.copyText(text);
    toast.success('Скопійовано');
  };

  const save = async (saved: Promise<boolean>): Promise<void> => {
    try {
      if (await saved) toast.success('Збережено');
    } catch (error) {
      failWith(error);
    }
  };

  const makeSummary = async (): Promise<void> => {
    setSummarizing(true);
    try {
      setSummary(await window.api.summarize(transcript));
    } catch (error) {
      failWith(error);
    } finally {
      setSummarizing(false);
    }
  };

  // Main keeps the machine awake while this is true, and asks before closing the window.
  useEffect(() => {
    window.api.setWorking(busy);
  }, [busy]);

  // Loading the model takes a few seconds on every start — let the click wait for it instead of the person.
  useEffect(() => {
    if (!pending || model === null || busy) return;
    setPending(false);
    void startTranscription();
  }, [pending, model, busy]);

  // Downloading is only half the wait: the weights still have to be parsed and compiled onto the GPU.
  const modelStage = modelError ? 'failed' : model ? 'ready' : download >= 100 ? 'preparing' : 'downloading';

  const job: Job | null = exporting
    ? { label: 'Конвертація в аудіо' }
    : converting
      ? { label: 'Конвертація аудіо' }
      : progress !== null
        ? { label: 'Транскрибація', value: progress }
        : summarizing
          ? { label: 'Готую конспект' }
          : modelStage === 'downloading'
            ? { label: 'Завантаження моделі', value: download }
            : modelStage === 'preparing'
              ? { label: 'Готую модель до роботи — перший запуск триває кілька хвилин' }
              : null;

  const status = busy
    ? 'Машина не засне до завершення'
    : model
      ? `${transcript || audio ? 'Готово' : 'Модель готова'} · ${deviceLabel[model.device]} · ${model.encoder}`
      : modelStage === 'preparing'
        ? 'Готую модель'
        : 'Завантажую модель';

  // What the window is about right now: picking a file, reading a transcript, or holding an exported track.
  const mode = audio || exporting ? 'audio' : transcript || busy ? 'transcript' : 'pick';
  const done = transcript !== '' && !busy;

  const dropZone: ReactNode = (
    <div className="flex w-120 max-w-full flex-col gap-3.5">
      <div
        className={cn(
          'flex flex-col items-center gap-4 rounded-2xl border border-dashed bg-background px-6 pt-10 pb-9 text-center',
          'transition-colors',
          dragging && 'border-primary bg-primary/5',
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
          <UploadIcon className="size-5" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-medium">Перетягни відео або аудіо</span>
          <span className="text-[13px] text-muted-foreground">MP4, MKV, MOV, MP3, WAV та інші</span>
        </div>
        <Button variant="outline" onClick={chooseFile}>
          Вибрати файл
        </Button>
      </div>

      {file && mode === 'pick' && (
        <div className="flex items-center gap-3 rounded-[10px] border bg-background px-3 py-2.5" title={file.path}>
          <FileVideoIcon className="size-4.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13.5px] font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
          </div>
        </div>
      )}
    </div>
  );

  const transcribeButton = (variant: 'default' | 'ghost'): ReactNode => (
    <Button
      variant={variant}
      size="lg"
      className={cn('rounded-full', variant === 'default' ? 'px-4.5' : 'px-3.5')}
      disabled={!file || busy || pending || modelStage === 'failed'}
      onClick={() => (model ? void startTranscription() : setPending(true))}
    >
      {busy && mode === 'transcript' ? 'Транскрибую…' : pending ? 'Чекаю на модель…' : 'Транскрибувати'}
    </Button>
  );

  return (
    // The whole window takes drops: the zone is what lights up, but dropping beside it must not navigate away.
    <div
      className="relative h-screen overflow-hidden"
      onDragEnter={() => {
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) stopDragging();
      }}
      onDrop={handleDrop}
    >
      {mode === 'pick' ? (
        <div className="absolute inset-0 flex items-center justify-center pb-15">{dropZone}</div>
      ) : (
        <div className="absolute inset-0 overflow-y-auto">
          <div className="mx-auto w-170 max-w-full px-6 pt-22 pb-30">
            <h1 className="mb-1.5 text-center text-[26px] leading-tight font-semibold tracking-[-0.02em] break-words">
              {baseName}
            </h1>
            <p className="mb-9 text-center text-[13px] text-muted-foreground">
              {audio
                ? `OGG · Opus · ${formatSize(audio.size)}`
                : file && `${formatSize(file.size)} · ${extension.toUpperCase()}`}
              {elapsed !== null && ` · розшифровано за ${formatDuration(elapsed)} · ${countWords(transcript)} слів`}
            </p>

            {mode === 'audio' ? (
              audio && (
                <div className="flex items-center justify-center gap-3 text-muted-foreground">
                  <FileAudioIcon className="size-5" strokeWidth={1.75} />
                  <span>Аудіодоріжку витягнуто. Збережи її або запусти транскрибацію.</span>
                </div>
              )
            ) : (
              <div className="text-base leading-[1.8] whitespace-pre-wrap">{transcript}</div>
            )}

            {summary && (
              <section className="mt-10 border-t pt-7">
                <div className="mb-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <SparklesIcon className="size-[15px]" />
                    <span className="text-[13px] font-medium text-foreground">Конспект</span>
                  </div>
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => copy(summary)}>
                    <ClipboardCopyIcon /> Копіювати
                  </Button>
                </div>
                <div className="text-[15px] leading-[1.7] whitespace-pre-wrap">{summary}</div>
              </section>
            )}
          </div>
        </div>
      )}

      {mode !== 'pick' && dragging && !busy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 pb-15 backdrop-blur-sm">
          {dropZone}
        </div>
      )}

      <div className="absolute top-5 left-6 flex items-center gap-2 text-muted-foreground">
        <AudioLinesIcon className="size-4" />
        <span className="text-[13px] font-medium text-foreground">MagScribe</span>
      </div>

      <div className="absolute top-4 right-5 flex items-center gap-2">
        {mode !== 'pick' && !busy && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={startOver}>
            <RotateCcwIcon /> Почати заново
          </Button>
        )}
        <div className="flex items-center gap-0.5 rounded-[10px] border bg-background p-[3px]">
          {themes.map(({ value, label, Icon }) => (
            <Button
              key={value}
              variant="ghost"
              size="icon-xs"
              title={label}
              aria-pressed={theme === value}
              className={cn(
                'size-6.5 rounded-[7px] text-muted-foreground',
                theme === value && 'bg-muted text-foreground',
              )}
              onClick={() => setTheme(value)}
            >
              <Icon className="size-3.5" />
            </Button>
          ))}
        </div>
      </div>

      {job && (
        <div className="absolute bottom-23 left-1/2 flex w-110 max-w-[calc(100%-3rem)] -translate-x-1/2 flex-col gap-2">
          <div className="flex justify-between gap-4 text-[12.5px] text-muted-foreground">
            <span>{job.label}</span>
            {job.value !== undefined && (
              <b className="font-medium text-foreground tabular-nums">{Math.round(job.value)} %</b>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'relative h-full overflow-hidden rounded-full bg-foreground transition-[width]',
                'after:absolute after:inset-0 after:animate-sheen after:bg-linear-to-r',
                'after:from-transparent after:via-white/35 after:to-transparent',
              )}
              style={{ width: `${job.value ?? 100}%` }}
            />
          </div>
        </div>
      )}

      {/* A grid, not two absolutes: the status can never slide under the pill on a narrow window. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 grid grid-cols-[1fr_auto_1fr] items-end gap-4 px-6 pb-6',
        )}
      >
        <p
          className={cn(
            'pointer-events-auto pb-2.5 text-xs',
            modelError ? 'text-destructive' : 'text-muted-foreground',
          )}
          title={fallback ?? undefined}
        >
          {modelError ?? status}
        </p>

        <div
          className={cn(
            'pointer-events-auto flex items-center gap-1 rounded-full bg-card p-1.5',
            'ring-1 ring-border shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]',
          )}
        >
          {mode === 'pick' && (
            <>
              {transcribeButton('default')}
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                disabled={!file}
                onClick={convertToAudio}
              >
                <FileAudioIcon /> Конвертувати в аудіо
              </Button>
            </>
          )}
          {mode === 'transcript' && (
            <>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                disabled={!done}
                onClick={() => copy(transcript)}
              >
                <ClipboardCopyIcon /> Копіювати
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                disabled={!done}
                onClick={() => save(window.api.saveText(transcript, `${baseName}.txt`))}
              >
                <DownloadIcon /> Зберегти .txt
              </Button>
              <Button size="lg" className="rounded-full px-4.5" disabled={!done || summarizing} onClick={makeSummary}>
                <SparklesIcon /> {summarizing ? 'Готую конспект…' : 'Вловити суть'}
              </Button>
            </>
          )}
          {mode === 'audio' && (
            <>
              <Button
                size="lg"
                className="rounded-full px-4.5"
                disabled={!audio}
                onClick={() => audio && save(window.api.saveAudio(audio.path, `${baseName}.ogg`))}
              >
                <DownloadIcon /> Зберегти .ogg
              </Button>
              {transcribeButton('ghost')}
            </>
          )}
        </div>
      </div>

      <Toaster />
    </div>
  );
}
