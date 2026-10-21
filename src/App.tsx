import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArrowLeftIcon,
  AudioLinesIcon,
  CaptionsIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  FileAudioIcon,
  FileVideoIcon,
  ListOrderedIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  UploadIcon,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import type { ExportedAudio, SelectedFile, Theme } from '@/preload';
import { MODES, MODE_KEY, SettingsDialog, readSetting, writeSetting, type Mode } from '@/settings';
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
  { value: null, label: 'Авто', title: 'Визначити мову автоматично' },
  { value: 'uk', label: 'UK', title: 'Українська' },
  { value: 'en', label: 'EN', title: 'Англійська' },
];

const THEME_VALUES = themes.map(({ value }) => value);
const MODE_VALUES = MODES.map(({ value }) => value);

// Which of the result screens is on. The two modes double as views: a run lands on the one it was started as.
type View = Mode | 'summary' | 'chapters';

// The text panel between the title and the pill, shared by the transcript editor and the rendered summary.
const panelClass =
  'min-h-0 flex-1 overflow-y-auto rounded-2xl border bg-background px-7 py-6 text-[15px] leading-[1.7] [scrollbar-width:thin]';

// One block above the pill for every long wait; `value` is undefined for stages that have no percentage.
type Job = { label: string; value?: number };

export default function App() {
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readSetting(THEME_KEY, THEME_VALUES, 'system'));
  const [mode, setMode] = useState<Mode>(() => readSetting(MODE_KEY, MODE_VALUES, 'transcript'));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [language, setLanguage] = useState<Language>('uk');
  const [download, setDownload] = useState(0);
  const [model, setModel] = useState<{ adapter: string; encoder: string } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [converting, setConverting] = useState(false); // decoding the file for the model
  const [conversion, setConversion] = useState(0); // percentage of the ffmpeg run behind converting/exporting
  const [progress, setProgress] = useState<number | null>(null); // null while nothing is being transcribed
  const [transcript, setTranscript] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]); // timestamped speech, behind the subtitles and chapters
  const [elapsed, setElapsed] = useState<number | null>(null); // seconds the last finished run took
  const [summary, setSummary] = useState('');
  const [chapters, setChapters] = useState('');
  const [view, setView] = useState<View>(mode); // each result has its own screen over the transcript
  const [aiTask, setAiTask] = useState<'summary' | 'chapters' | null>(null); // what the claude CLI is chewing on
  const [exporting, setExporting] = useState(false); // re-encoding the file to OGG/Opus
  const [audio, setAudio] = useState<ExportedAudio | null>(null);
  const [pending, setPending] = useState<Mode | null>(null); // asked to transcribe before the model finished loading

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
        setModel({ adapter: message.adapter, encoder: message.encoder });
        ready.current = true;
      }
      if (message.type === 'fallback') setFallback(`${message.from} недоступний: ${message.reason}`);
      if (message.type === 'progress') setProgress(message.progress);
      if (message.type === 'partial') setTranscript(message.text);
      if (message.type === 'result') {
        setTranscript(message.text);
        setSegments(message.segments);
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

    window.api.onAudioProgress(setConversion);
    window.api.onGpuGone((message) => {
      setModelError(`${message}. Перезапусти застосунок.`);
      setProgress(null);
    });

    worker.postMessage({ type: 'load' } satisfies WorkerRequest);
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    writeSetting(THEME_KEY, theme);
    window.api.setTheme(theme);
  }, [theme]);

  useEffect(() => writeSetting(MODE_KEY, mode), [mode]);

  const busy = converting || progress !== null || exporting;

  const stopDragging = (): void => {
    dragDepth.current = 0;
    setDragging(false);
  };

  const clearResults = (): void => {
    setTranscript('');
    setSegments([]);
    setSummary('');
    setChapters('');
    setView(mode);
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

  const startTranscription = async (target: Mode): Promise<void> => {
    if (!file || !workerRef.current) return;

    clearResults();
    setView(target);
    setPending(null);
    setConversion(0);
    setConverting(true);
    startedAt.current = Date.now();
    try {
      const samples = await window.api.extractAudio(file.path);
      setProgress(0);
      workerRef.current.postMessage({ type: 'transcribe', audio: samples, language } satisfies WorkerRequest, [samples.buffer]);
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
    setConversion(0);
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
    const target = pending;
    setPending(null);
    void startTranscription(target);
  }, [pending, model, busy]);

  // Downloading is only half the wait: the weights still have to be parsed and compiled onto the GPU.
  const modelStage = modelError ? 'failed' : model ? 'ready' : download >= 100 ? 'preparing' : 'downloading';

  const job: Job | null = exporting
    ? { label: 'Конвертація в аудіо', value: conversion }
    : converting
      ? { label: 'Конвертація аудіо', value: conversion }
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
  // A run the model gave no usable timestamps for has nothing to show as subtitles — keep the text instead.
  const resultView: View = view === 'subtitles' && segments.length === 0 ? 'transcript' : view;
  // While it runs you watch the text stream in; the chosen view only takes over once there is a result.
  const screen = stage !== 'text' ? stage : busy ? 'transcript' : resultView;
  const done = transcript !== '' && !busy;
  const srt = segments.length > 0 ? toSrt(segments) : '';

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

  // Both starts run the same transcription — they differ only in the screen it lands on. The mode from the
  // settings leads the pill; the other stays one click away for a single file.
  const starts: Mode[] = mode === 'subtitles' ? ['subtitles', 'transcript'] : ['transcript', 'subtitles'];

  const startButton = (target: Mode, variant: 'default' | 'ghost'): ReactNode => (
    <Button
      key={target}
      variant={variant}
      size="lg"
      className={cn('rounded-full', variant === 'default' ? 'px-4.5' : 'px-3.5')}
      disabled={!file || busy || pending !== null || modelStage === 'failed'}
      onClick={() => (model ? void startTranscription(target) : setPending(target))}
    >
      {target === 'subtitles' && <CaptionsIcon />}
      {busy && stage === 'text'
        ? 'Транскрибую…'
        : pending === target
          ? 'Чекаю на модель…'
          : target === 'subtitles'
            ? 'Субтитри'
            : 'Транскрибувати'}
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
              // Editable so misheard names and clumsy chapter titles can be fixed in place; the worker still
              // streams into the transcript while it runs. The .srt is generated from the segments, so it is not.
              <Textarea
                className={cn(
                  panelClass,
                  'field-sizing-fixed resize-none border-border focus-visible:ring-0 md:text-[15px] dark:bg-background',
                )}
                value={screen === 'subtitles' ? srt : screen === 'chapters' ? chapters : transcript}
                readOnly={busy || screen === 'subtitles'}
                onChange={(event) => (screen === 'chapters' ? setChapters : setTranscript)(event.target.value)}
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

      <div className="absolute top-5 left-6 flex items-center gap-2.5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AudioLinesIcon className="size-4" />
          <span className="text-[13px] font-medium text-foreground">MagScribe</span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          title="Налаштування"
          className="-my-1.5 size-6.5 rounded-[7px] text-muted-foreground"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon className="size-3.5" />
        </Button>
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
        {/* Two rows, roughly the pill's height: what is happening, then which engine does it. */}
        <div
          className={cn(
            'pointer-events-auto flex flex-col gap-0.5 pb-1.5 text-xs',
            modelError ? 'text-destructive' : 'text-muted-foreground',
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
              {starts.map((target, index) => startButton(target, index === 0 ? 'default' : 'ghost'))}
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                disabled={!file}
                onClick={convertToAudio}
              >
                <FileAudioIcon /> Конвертувати
              </Button>
            </>
          )}
          {screen === 'transcript' && (
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
              {segments.length > 0 && (
                <Button
                  variant="ghost"
                  size="lg"
                  className="rounded-full px-3.5"
                  disabled={!done}
                  onClick={() => setView('subtitles')}
                >
                  <CaptionsIcon /> Субтитри
                </Button>
              )}
              {summary ? (
                <Button size="lg" className="rounded-full px-4.5" disabled={!done} onClick={() => setView('summary')}>
                  <SparklesIcon /> Конспект
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="rounded-full px-4.5"
                  disabled={!done || aiTask !== null}
                  onClick={() => runAi('summary')}
                >
                  <SparklesIcon /> {aiTask === 'summary' ? 'Готую конспект…' : 'Вловити суть'}
                </Button>
              )}
            </>
          )}
          {screen === 'subtitles' && (
            <>
              <Button variant="ghost" size="lg" className="rounded-full px-3.5" onClick={() => setView('transcript')}>
                <ArrowLeftIcon /> До тексту
              </Button>
              <Button variant="ghost" size="lg" className="rounded-full px-3.5" onClick={() => copy(srt)}>
                <ClipboardCopyIcon /> Копіювати
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full px-3.5"
                onClick={() => save(window.api.saveText(srt, `${baseName}.srt`))}
              >
                <DownloadIcon /> Зберегти .srt
              </Button>
              {chapters ? (
                <Button size="lg" className="rounded-full px-4.5" onClick={() => setView('chapters')}>
                  <ListOrderedIcon /> Таймкоди
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="rounded-full px-4.5"
                  disabled={!done || aiTask !== null}
                  onClick={() => runAi('chapters')}
                >
                  <ListOrderedIcon /> {aiTask === 'chapters' ? 'Готую таймкоди…' : 'Зробити таймкоди'}
                </Button>
              )}
            </>
          )}
          {screen === 'chapters' && (
            <>
              <Button variant="ghost" size="lg" className="rounded-full px-3.5" onClick={() => setView('subtitles')}>
                <ArrowLeftIcon /> До субтитрів
              </Button>
              <Button variant="ghost" size="lg" className="rounded-full px-3.5" onClick={() => copy(chapters)}>
                <ClipboardCopyIcon /> Копіювати
              </Button>
              <Button
                size="lg"
                className="rounded-full px-4.5"
                onClick={() => save(window.api.saveText(chapters, `${baseName} — таймкоди.txt`))}
              >
                <DownloadIcon /> Зберегти .txt
              </Button>
            </>
          )}
          {screen === 'summary' && (
            <>
              <Button variant="ghost" size="lg" className="rounded-full px-3.5" onClick={() => setView('transcript')}>
                <ArrowLeftIcon /> До транскрипту
              </Button>
              <Button variant="ghost" size="lg" className="rounded-full px-3.5" onClick={() => copy(summary)}>
                <ClipboardCopyIcon /> Копіювати
              </Button>
              <Button
                size="lg"
                className="rounded-full px-4.5"
                onClick={() => save(window.api.saveText(summary, `${baseName} — конспект.txt`))}
              >
                <DownloadIcon /> Зберегти .txt
              </Button>
            </>
          )}
          {stage === 'audio' && (
            <>
              <Button
                size="lg"
                className="rounded-full px-4.5"
                disabled={!audio}
                onClick={() => audio && save(window.api.saveAudio(audio.path, `${baseName}.ogg`))}
              >
                <DownloadIcon /> Зберегти .ogg
              </Button>
              {startButton(mode, 'ghost')}
            </>
          )}
        </div>

        {/* Plain text, not a segmented control: it is set once per file and should not compete with the pill. */}
        <div className="pointer-events-auto flex items-center gap-2.5 justify-self-end pb-1.5 text-xs">
          {languages.map(({ value, label, title }) => (
            <button
              key={label}
              type="button"
              title={title}
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
          ))}
        </div>
      </div>

      <SettingsDialog open={settingsOpen} mode={mode} onMode={setMode} onClose={() => setSettingsOpen(false)} />
      <Toaster />
    </div>
  );
}
