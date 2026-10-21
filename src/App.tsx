import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArrowLeftIcon,
  AudioLinesIcon,
  CaptionsIcon,
  ChevronDownIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  FileAudioIcon,
  FileTextIcon,
  FileVideoIcon,
  ListOrderedIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SparklesIcon,
  SunIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import type { ExportedAudio, SelectedFile, Theme } from '@/preload';
import { AboutDialog, SettingsDialog, readSetting, writeSetting } from '@/settings';
import { toSrt, toTimedText } from '@/subtitles';
import type { Language, Segment, WorkerRequest, WorkerResponse } from '@/worker';
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

const countLines = (text: string): number => text.split('\n').filter((line) => line.trim()).length;

const THEME_KEY = 'theme';
const themes: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Світла', Icon: SunIcon },
  { value: 'system', label: 'Як у системі', Icon: MonitorIcon },
  { value: 'dark', label: 'Темна', Icon: MoonIcon },
];

const languages: { value: Language; label: string; title: string }[] = [
  { value: null, label: 'Авто', title: 'Мова розпізнавання — визначити автоматично' },
  { value: 'uk', label: 'UK', title: 'Мова розпізнавання — українська' },
  { value: 'en', label: 'EN', title: 'Мова розпізнавання — англійська' },
];

const THEME_VALUES = themes.map(({ value }) => value);

// One run, four ways to read it. A finished run always lands on the transcript; the rest are a click away.
type View = 'transcript' | 'subtitles' | 'summary' | 'chapters';

type Screen = View | 'pick' | 'audio';

// The page name leads the system title bar, the app name follows it, the way a browser tab reads.
const SCREEN_TITLES: Record<Screen, string> = {
  pick: '',
  transcript: 'Текст',
  subtitles: 'Субтитри',
  summary: 'Конспект',
  chapters: 'Таймкоди',
  audio: 'Аудіо',
};

// The text panel between the title and the pill, shared by the transcript editor and the rendered summary.
const panelClass =
  'min-h-0 flex-1 overflow-y-auto rounded-2xl border bg-background px-7 py-6 text-[15px] leading-[1.7] [scrollbar-width:thin]';

// Under ~790 px the pill cannot hold its labels: the buttons fall back to their icons, and the title carries
// the name for both the tooltip and the accessibility tree.
const wideOnly = 'max-[790px]:hidden';

// One block above the pill for every long wait; `value` is undefined for stages that have no percentage.
type Job = { label: string; value?: number };

export default function App() {
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readSetting(THEME_KEY, THEME_VALUES, 'system'));
  const [dialog, setDialog] = useState<'settings' | 'about' | null>(null);
  const [language, setLanguage] = useState<Language>('uk');
  const [download, setDownload] = useState(0);
  const [model, setModel] = useState<{ adapter: string; encoder: string } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [converting, setConverting] = useState(false); // decoding the file for the model
  const [conversion, setConversion] = useState(0); // percentage of the ffmpeg run behind converting/exporting
  const [progress, setProgress] = useState<number | null>(null); // null while nothing is being transcribed
  const [merging, setMerging] = useState(false); // all chunks decoded, the pipeline is stitching them together
  const [transcript, setTranscript] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]); // timestamped speech, behind the subtitles and chapters
  const [subtitles, setSubtitles] = useState(''); // the .srt itself, so it can be fixed up before saving
  const [elapsed, setElapsed] = useState<number | null>(null); // seconds the last finished run took
  const [summary, setSummary] = useState('');
  const [chapters, setChapters] = useState('');
  const [view, setView] = useState<View>('transcript'); // each result has its own screen over the transcript
  const [aiTask, setAiTask] = useState<'summary' | 'chapters' | null>(null); // what the claude CLI is chewing on
  const [exporting, setExporting] = useState(false); // re-encoding the file to OGG/Opus
  const [audio, setAudio] = useState<ExportedAudio | null>(null);
  const [pending, setPending] = useState(false); // asked to transcribe before the model finished loading

  // dragenter/dragleave also fire for children, so count the nesting instead of toggling on every event.
  const dragDepth = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const ready = useRef(false); // read inside the worker listener, which never sees state updates
  const startedAt = useRef(0);
  const stopped = useRef(false); // a cancelled ffmpeg rejects like a broken one; this tells the two apart

  // Spawned on mount, and again after a stop: terminating is the only way out of a run, and it takes the
  // loaded model with it, so the replacement starts loading at once instead of waiting for the next click.
  const spawnWorker = (): void => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    ready.current = false;
    setModel(null);
    setDownload(0);

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'download') setDownload(message.progress);
      if (message.type === 'ready') {
        setDownload(100);
        setModel({ adapter: message.adapter, encoder: message.encoder });
        ready.current = true;
      }
      if (message.type === 'fallback') setFallback(`${message.from} недоступний: ${message.reason}`);
      if (message.type === 'progress') setProgress(message.progress);
      if (message.type === 'merging') setMerging(true);
      if (message.type === 'partial') setTranscript(message.text);
      if (message.type === 'result') {
        setMerging(false);
        setTranscript(message.text);
        setSegments(message.segments);
        setSubtitles(toSrt(message.segments));
        setProgress(null);
        setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
        window.api.notify('MagScribe', `Транскрибація завершена — ${countWords(message.text)} слів`);
      }
      if (message.type === 'error') {
        // Before the model is up, the failure is permanent — keep it on screen instead of a toast that fades.
        if (!ready.current) setModelError(message.message);
        else toast.error(message.message);
        setProgress(null);
        setMerging(false);
      }
    });

    worker.postMessage({ type: 'load' } satisfies WorkerRequest);
  };

  useEffect(() => {
    spawnWorker();

    window.api.onAudioProgress(setConversion);
    window.api.onGpuGone((message) => {
      setModelError(`${message}. Перезапусти застосунок.`);
      setProgress(null);
    });

    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    writeSetting(THEME_KEY, theme);
    window.api.setTheme(theme);
  }, [theme]);

  const busy = converting || progress !== null || exporting;

  const stopDragging = (): void => {
    dragDepth.current = 0;
    setDragging(false);
  };

  const clearResults = (): void => {
    setTranscript('');
    setSegments([]);
    setSubtitles('');
    setSummary('');
    setChapters('');
    setView('transcript');
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

  /** Stops whatever is running and keeps whatever it has already produced. */
  const stop = (): void => {
    stopped.current = true;
    window.api.cancelAudio(); // kills ffmpeg if we are still converting
    // The pipeline runs chunk after chunk inside a single await and never looks at a flag, so the worker has to go.
    workerRef.current?.terminate();
    spawnWorker();

    setConverting(false);
    setExporting(false);
    setProgress(null);
    setMerging(false);
    toast.info(transcript ? 'Зупинено — розшифроване досі лишилось' : 'Зупинено');
  };

  const baseName = file ? file.name.replace(/\.[^.]+$/, '') : '';
  const extension = file?.name.split('.').pop() ?? '';

  const startTranscription = async (): Promise<void> => {
    if (!file || !workerRef.current) return;

    clearResults();
    stopped.current = false;
    setPending(false);
    setMerging(false);
    setConversion(0);
    setConverting(true);
    startedAt.current = Date.now();
    try {
      const samples = await window.api.extractAudio(file.path);
      setProgress(0);
      workerRef.current.postMessage({ type: 'transcribe', audio: samples, language } satisfies WorkerRequest, [samples.buffer]);
    } catch (error) {
      if (!stopped.current) failWith(error); // a killed ffmpeg rejects like a broken one
      setProgress(null);
    } finally {
      setConverting(false);
    }
  };

  const convertToAudio = async (): Promise<void> => {
    if (!file) return;

    clearResults();
    stopped.current = false;
    setConversion(0);
    setExporting(true);
    try {
      setAudio(await window.api.exportAudio(file.path));
    } catch (error) {
      if (!stopped.current) failWith(error);
    } finally {
      setExporting(false);
    }
  };

  const copy = async (text: string): Promise<void> => {
    if (await window.api.copyText(text)) toast.success('Скопійовано');
    else toast.error('Буфер обміну не прийняв текст');
  };

  const save = async (saved: Promise<boolean>): Promise<void> => {
    try {
      if (await saved) toast.success('Збережено');
    } catch (error) {
      failWith(error);
    }
  };

  // Both stages run the local claude CLI: a summary of the plain text, chapters of the timestamped lines.
  const runAi = async (task: 'summary' | 'chapters'): Promise<void> => {
    setAiTask(task);
    try {
      const text =
        task === 'summary' ? await window.api.summarize(transcript) : await window.api.chapters(toTimedText(segments));
      if (task === 'summary') setSummary(text);
      else setChapters(text);
      setView(task);
    } catch (error) {
      failWith(error);
    } finally {
      setAiTask(null);
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
    ? { label: 'Конвертація в аудіо', value: conversion }
    : converting
      ? { label: 'Конвертація аудіо', value: conversion }
      : merging
        ? { label: 'Збираю текст і таймкоди' }
        : progress !== null
          ? { label: 'Транскрибація', value: progress }
          : aiTask
            ? { label: aiTask === 'summary' ? 'Готую конспект' : 'Готую таймкоди' }
            : modelStage === 'downloading'
              ? { label: 'Завантаження моделі', value: download }
              : modelStage === 'preparing'
                ? { label: 'Готую модель до роботи — перший запуск триває кілька хвилин' }
                : null;

  const status = busy
    ? 'Машина не засне до завершення'
    : model
      ? transcript || audio
        ? 'Готово'
        : 'Модель готова'
      : modelStage === 'preparing'
        ? 'Готую модель'
        : 'Завантажую модель';

  // What the window is about right now: picking a file, reading what a run produced, or holding an exported track.
  const stage = audio || exporting ? 'audio' : transcript || busy ? 'text' : 'pick';
  // Nothing switches the view by itself: a run ends on the transcript, and the pill opens the rest.
  const screen: Screen = stage === 'text' ? view : stage;
  const done = transcript !== '' && !busy;
  const onSubtitles = screen === 'subtitles'; // the text screen and the .srt screen share one set of buttons

  // Electron takes the window title from the document, so the taskbar can say which screen is open.
  const screenTitle = exporting
    ? 'Конвертація'
    : converting || progress !== null
      ? 'Транскрибація'
      : SCREEN_TITLES[screen];

  useEffect(() => {
    document.title = screenTitle ? `${screenTitle} — MagScribe` : 'MagScribe';
  }, [screenTitle]);
  // Transcript, .srt and chapters are three editable texts; only the source differs.
  const panelText = screen === 'subtitles' ? subtitles : screen === 'chapters' ? chapters : transcript;
  const setPanelText = screen === 'subtitles' ? setSubtitles : screen === 'chapters' ? setChapters : setTranscript;

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

      {file && stage === 'pick' && (
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

  // The lead button follows what is on screen: the text leads to a summary, the .srt leads to chapters.
  const summaryButton: ReactNode = summary ? (
    <Button
      size="lg"
      className="rounded-full px-4.5"
      title="Конспект"
      disabled={!done}
      onClick={() => setView('summary')}
    >
      <SparklesIcon /> <span className={wideOnly}>Конспект</span>
    </Button>
  ) : (
    <Button
      size="lg"
      className="rounded-full px-4.5"
      title="Вловити суть"
      disabled={!done || aiTask !== null}
      onClick={() => runAi('summary')}
    >
      <SparklesIcon /> <span className={wideOnly}>{aiTask === 'summary' ? 'Готую конспект…' : 'Вловити суть'}</span>
    </Button>
  );

  const chaptersButton: ReactNode = chapters ? (
    <Button
      size="lg"
      className="rounded-full px-4.5"
      title="Таймкоди"
      disabled={!done}
      onClick={() => setView('chapters')}
    >
      <ListOrderedIcon /> <span className={wideOnly}>Таймкоди</span>
    </Button>
  ) : (
    <Button
      size="lg"
      className="rounded-full px-4.5"
      title="Таймкоди"
      disabled={!done || segments.length === 0 || aiTask !== null}
      onClick={() => runAi('chapters')}
    >
      <ListOrderedIcon /> <span className={wideOnly}>{aiTask === 'chapters' ? 'Готую таймкоди…' : 'Таймкоди'}</span>
    </Button>
  );

  const transcribeButton = (variant: 'default' | 'ghost'): ReactNode => (
    <Button
      variant={variant}
      size="lg"
      className={cn('rounded-full', variant === 'default' ? 'px-4.5' : 'px-3.5')}
      title="Транскрибувати"
      disabled={!file || busy || pending || modelStage === 'failed'}
      onClick={() => (model ? void startTranscription() : setPending(true))}
    >
      <AudioLinesIcon />
      <span className={wideOnly}>
        {busy && stage === 'text' ? 'Транскрибую…' : pending ? 'Чекаю на модель…' : 'Транскрибувати'}
      </span>
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
      {stage === 'pick' ? (
        <div className="absolute inset-0 flex items-center justify-center pb-15">{dropZone}</div>
      ) : (
        // The text scrolls inside its own panel: the top bar, the pill and the progress block stay put.
        <div className={cn('absolute inset-0 flex flex-col px-6 pt-22', job ? 'pb-33' : 'pb-24')}>
          <div className="mx-auto flex min-h-0 w-170 max-w-full flex-1 flex-col">
            <h1 className="mb-1.5 text-center text-[26px] leading-tight font-semibold tracking-[-0.02em] break-words">
              {baseName}
            </h1>
            <p className="mb-6 text-center text-[13px] text-muted-foreground">
              {screen === 'summary'
                ? `Конспект · ${countWords(summary)} слів`
                : screen === 'subtitles'
                  ? `Субтитри · SRT · ${segments.length} реплік`
                  : screen === 'chapters'
                    ? `Таймкоди · ${countLines(chapters)} розділів`
                    : audio
                      ? `OGG · Opus · ${formatSize(audio.size)}`
                      : file && `${formatSize(file.size)} · ${extension.toUpperCase()}`}
              {screen === 'transcript' &&
                elapsed !== null &&
                ` · розшифровано за ${formatDuration(elapsed)} · ${countWords(transcript)} слів`}
            </p>

            {screen === 'audio' ? (
              audio && (
                <div className="flex items-center justify-center gap-3 text-muted-foreground">
                  <FileAudioIcon className="size-5" strokeWidth={1.75} />
                  <span>Аудіодоріжку витягнуто. Збережи її або запусти транскрибацію.</span>
                </div>
              )
            ) : screen === 'summary' ? (
              <div className={cn(panelClass, 'markdown')}>
                <Markdown>{summary}</Markdown>
              </div>
            ) : (
              // All three are editable in place — misheard names, subtitle wording before YouTube, clumsy
              // chapter titles. The worker still streams into the transcript while it runs, so that one waits.
              <Textarea
                className={cn(
                  panelClass,
                  'field-sizing-fixed resize-none border-border focus-visible:ring-0 md:text-[15px] dark:bg-background',
                )}
                value={panelText}
                readOnly={busy}
                onChange={(event) => setPanelText(event.target.value)}
              />
            )}
          </div>
        </div>
      )}

      {stage !== 'pick' && dragging && !busy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 pb-15 backdrop-blur-sm">
          {dropZone}
        </div>
      )}

      {/* The name is the menu: one trigger instead of a tool hung on the brand mark. The negative margin keeps
          the row as tall as the text, so nothing else in the corner moves. */}
      <button
        type="button"
        popoverTarget="app-menu"
        className={cn(
          'absolute top-[14px] left-4 flex items-center gap-2 rounded-[9px] px-2 py-1.5',
          'text-muted-foreground transition-colors hover:bg-muted/60',
        )}
      >
        <AudioLinesIcon className="size-4" />
        <span className="text-[13px] font-medium text-foreground">MagScribe</span>
        <ChevronDownIcon className="size-3.5" />
      </button>

      {/* A native popover: the top layer, Esc and click-outside come from the platform, so there is no JS here. */}
      <div
        id="app-menu"
        popover="auto"
        className={cn(
          'fixed top-12 left-4 m-0 w-56 rounded-xl border bg-popover p-1.5 text-popover-foreground',
          'shadow-[0_18px_48px_-20px_rgb(0_0_0/0.55)]',
        )}
      >
        {([
          ['settings', 'Налаштування'],
          ['about', 'Про MagScribe'],
        ] as const).map(([target, label]) => (
          <button
            key={target}
            type="button"
            popoverTarget="app-menu"
            popoverTargetAction="hide"
            className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-muted"
            onClick={() => setDialog(target)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="absolute top-4 right-5 flex items-center gap-2">
        {stage !== 'pick' && !busy && (
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
          <div className="flex items-center justify-between gap-4 text-[12.5px] text-muted-foreground">
            <span>{job.label}</span>
            <div className="flex items-center gap-2.5">
              {job.value !== undefined && (
                <b className="font-medium text-foreground tabular-nums">{Math.round(job.value)} %</b>
              )}
              {busy && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Зупинити"
                  className="-my-1 size-5.5 rounded-[6px] text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  onClick={stop}
                >
                  <XIcon className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            {job.value === undefined ? (
              // No percentage to promise: a short bar crossing the track, instead of a full one that looks done.
              <div className="h-full w-2/5 animate-indeterminate rounded-full bg-foreground" />
            ) : (
              <div
                className={cn(
                  'relative h-full overflow-hidden rounded-full bg-foreground transition-[width]',
                  'after:absolute after:inset-0 after:animate-sheen after:bg-linear-to-r',
                  'after:from-transparent after:via-white/35 after:to-transparent',
                )}
                style={{ width: `${job.value}%` }}
              />
            )}
          </div>
        </div>
      )}

      {/* A grid, not two absolutes: the status can never slide under the pill on a narrow window. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 grid grid-cols-[1fr_auto_1fr] items-end gap-4 px-6 pb-6',
        )}
      >
        {/* Two rows, roughly the pill's height: what is happening, then which engine does it. */}
        <div
          className={cn(
            'pointer-events-auto flex flex-col gap-0.5 pb-1.5 text-xs',
            modelError ? 'text-destructive' : cn('text-muted-foreground', wideOnly),
          )}
          title={fallback ?? undefined}
        >
          <span>{modelError ?? status}</span>
          {!modelError && model && <span className="text-[11px] opacity-75">{`${model.adapter} · ${model.encoder}`}</span>}
        </div>

        <div
          className={cn(
            'pointer-events-auto flex items-center gap-1 rounded-full bg-card p-1.5',
            'ring-1 ring-border shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]',
          )}
        >
          {stage === 'pick' && (
            <>
              {transcribeButton('default')}
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                title="Конвертувати у звук"
                disabled={!file}
                onClick={convertToAudio}
              >
                <FileAudioIcon /> <span className={wideOnly}>Конвертувати</span>
              </Button>
            </>
          )}
          {/* The text and the .srt are the same run, so they share one row: copy, save, swap, and what is next. */}
          {(screen === 'transcript' || onSubtitles) && (
            <>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                title="Копіювати"
                disabled={!done}
                onClick={() => copy(onSubtitles ? subtitles : transcript)}
              >
                <ClipboardCopyIcon /> <span className={wideOnly}>Копіювати</span>
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                disabled={!done}
                onClick={() =>
                  save(
                    window.api.saveText(
                      onSubtitles ? subtitles : transcript,
                      `${baseName}${onSubtitles ? '.srt' : '.txt'}`,
                    ),
                  )
                }
                title={onSubtitles ? 'Зберегти .srt' : 'Зберегти .txt'}
              >
                <DownloadIcon /> <span className={wideOnly}>{onSubtitles ? 'Зберегти .srt' : 'Зберегти .txt'}</span>
              </Button>
              {segments.length > 0 && (
                <Button
                  variant="ghost"
                  size="lg"
                  className="rounded-full px-3.5"
                  title={onSubtitles ? 'До тексту' : 'До субтитрів'}
                  disabled={!done}
                  onClick={() => setView(onSubtitles ? 'transcript' : 'subtitles')}
                >
                  {onSubtitles ? <FileTextIcon /> : <CaptionsIcon />}
                  <span className={wideOnly}>{onSubtitles ? 'Текст' : 'Субтитри'}</span>
                </Button>
              )}
              {onSubtitles ? chaptersButton : summaryButton}
            </>
          )}
          {screen === 'chapters' && (
            <>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                title="До субтитрів"
                onClick={() => setView('subtitles')}
              >
                <ArrowLeftIcon /> <span className={wideOnly}>До субтитрів</span>
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                title="Копіювати"
                onClick={() => copy(chapters)}
              >
                <ClipboardCopyIcon /> <span className={wideOnly}>Копіювати</span>
              </Button>
              <Button
                size="lg"
                className="rounded-full px-4.5"
                title="Зберегти .txt"
                onClick={() => save(window.api.saveText(chapters, `${baseName} — таймкоди.txt`))}
              >
                <DownloadIcon /> <span className={wideOnly}>Зберегти .txt</span>
              </Button>
            </>
          )}
          {screen === 'summary' && (
            <>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                title="До транскрипту"
                onClick={() => setView('transcript')}
              >
                <ArrowLeftIcon /> <span className={wideOnly}>До транскрипту</span>
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                title="Копіювати"
                onClick={() => copy(summary)}
              >
                <ClipboardCopyIcon /> <span className={wideOnly}>Копіювати</span>
              </Button>
              <Button
                size="lg"
                className="rounded-full px-4.5"
                title="Зберегти .txt"
                onClick={() => save(window.api.saveText(summary, `${baseName} — конспект.txt`))}
              >
                <DownloadIcon /> <span className={wideOnly}>Зберегти .txt</span>
              </Button>
            </>
          )}
          {stage === 'audio' && (
            <>
              <Button
                size="lg"
                className="rounded-full px-4.5"
                title="Зберегти .ogg"
                disabled={!audio}
                onClick={() => audio && save(window.api.saveAudio(audio.path, `${baseName}.ogg`))}
              >
                <DownloadIcon /> <span className={wideOnly}>Зберегти .ogg</span>
              </Button>
              {transcribeButton('ghost')}
            </>
          )}
        </div>

        {/* Plain text, not a segmented control: it is set once per file and should not compete with the pill.
            Three bare words need to say what they are for, so each carries a tooltip. */}
        <TooltipProvider delay={350}>
          <div className="pointer-events-auto flex items-center gap-2.5 justify-self-end self-center text-xs">
            {languages.map(({ value, label, title }) => (
              <Tooltip key={label}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-pressed={language === value}
                      disabled={busy}
                      className={cn(
                        'text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none',
                        language === value && 'font-medium text-foreground',
                      )}
                      onClick={() => setLanguage(value)}
                    >
                      {label}
                    </button>
                  }
                />
                <TooltipContent>{title}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>

      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} />
      <AboutDialog
        open={dialog === 'about'}
        engine={model && `${model.adapter} · ${model.encoder}`}
        onClose={() => setDialog(null)}
      />
      <Toaster />
    </div>
  );
}
