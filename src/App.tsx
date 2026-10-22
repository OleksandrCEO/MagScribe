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
  PlayIcon,
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
import { findGpu, isRealGpu, type Gpu } from '@/gpu';
import { formatSize, pickUiLang, setUiLang, STRINGS, UI_LANGS, type UiLang } from '@/i18n';
import {
  deleteModel,
  modelBytes,
  modelStates,
  MODELS,
  MODEL_IDS,
  recommendedModel,
  type Device,
  type ModelId,
  type ModelState,
} from '@/models';
import type { ExportedAudio, SelectedFile, Theme } from '@/preload';
import type { AiTask, Prompts } from '@/prompts';
import {
  AboutDialog,
  ConfirmDialog,
  LANG_KEY,
  MODEL_KEY,
  ModelPicker,
  SettingsDialog,
  readPrompts,
  readSetting,
  writePrompts,
  writeSetting,
} from '@/settings';
import { decodeInBrowser, SAMPLE_RATE } from '@/pcm';
import { timecode, toSrt, toTimedText, type Segment } from '@/subtitles';
import type { Language, WorkerRequest, WorkerResponse } from '@/worker';
import { cn } from 'cn';

const countWords = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

// Only a line that starts with a timecode is a chapter: a preamble or an empty numbering from the model
// would otherwise be counted as one.
const countChapters = (text: string): number =>
  text.split('\n').filter((line) => /^\s*\d{1,2}:\d\d/.test(line)).length;

// A token at a time would re-render the whole window while the GPU is busy, and the later a long run gets, the
// more text each repaint lays out. Twice a second still reads as streaming, and `result` repaints the final
// text in full, so the frames dropped in between cost nothing.
const PAINT_EVERY_MS = 500;

const THEME_KEY = 'theme';

// The labels live in i18n, keyed by the same value — `s.theme[value]`.
const themes: { value: Theme; Icon: typeof SunIcon }[] = [
  { value: 'light', Icon: SunIcon },
  { value: 'system', Icon: MonitorIcon },
  { value: 'dark', Icon: MoonIcon },
];

const THEME_VALUES = themes.map(({ value }) => value);

// One run, four ways to read it. A finished run always lands on the transcript; the rest are a click away.
type View = 'transcript' | 'subtitles' | 'summary' | 'chapters';

type Screen = View | 'pick' | 'audio';

// The text panel between the title and the pill, shared by the transcript editor and the rendered summary.
const panelClass =
  'min-h-0 flex-1 overflow-y-auto rounded-2xl border bg-background px-7 py-6 text-[15px] leading-[1.7] [scrollbar-width:thin]';

// Under ~790 px the pill cannot hold its labels: the buttons fall back to their icons, and the title carries
// the name for both the tooltip and the accessibility tree.
const wideOnly = 'max-[790px]:hidden';

type PillProps = {
  icon: ReactNode;
  label: string; // the name: the tooltip, the accessible name, and the text on a wide window
  wide?: string; // when a wide window says something longer than the name («Готую конспект…»)
  lead?: boolean; // the one filled button of the row
  disabled?: boolean;
  onClick: () => void;
};

/** Every button in the pill. Icon-only below ~790 px, so the name has to live outside the span. */
const PillButton = ({ icon, label, wide, lead, disabled, onClick }: PillProps) => (
  <Button
    variant={lead ? 'default' : 'ghost'}
    size="lg"
    className={cn('rounded-full', lead ? 'px-4.5' : 'px-3.5')}
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
  >
    {icon}
    <span className={wideOnly}>{wide ?? label}</span>
  </Button>
);

/** The one-line offer under the status: retry a load that failed, or ask for the model that is not there. */
const StatusLink = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    className="w-fit text-[11px] underline underline-offset-2 opacity-90 hover:opacity-100"
    onClick={onClick}
  >
    {label}
  </button>
);

/**
 * What the window is busy with — one at a time, and never two at once, which is what makes this a union and
 * not the six booleans it used to be. Everything downstream reads it: the block above the pill, the stop
 * button, whether the text panel is editable, and whether the machine is allowed to doze off.
 */
type Job =
  // The three ffmpeg runs: one percentage, one source. `reading` decodes the file into samples for the model,
  // `exporting` encodes the track the audio screen shows, `saving` is the same encode from a result screen.
  | { kind: 'reading' | 'exporting' | 'saving'; percent: number }
  // The worker. `merging` is its last phase: the chunks are decoded and the overlaps are being stitched.
  | { kind: 'transcribing'; percent: number; merging: boolean }
  | { kind: 'ai'; task: AiTask }; // the claude CLI, which is work too, but work that nothing can stop

// One block above the pill for every long wait; `value` is undefined for stages that have no percentage.
type Bar = { label: string; value?: number };

export default function App() {
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  // Dark by default: this is a window people leave open through a long run, and the system's choice is one click away.
  const [theme, setTheme] = useState<Theme>(() => readSetting(THEME_KEY, THEME_VALUES, 'dark'));
  // The interface language. Nothing saved yet means the system's own, which is what a first run should open in.
  const [uiLang, setUiLangState] = useState<UiLang>(() =>
    readSetting(LANG_KEY, UI_LANGS, pickUiLang(navigator.language)),
  );
  const [dialog, setDialog] = useState<'settings' | 'about' | null>(null);
  const [prompts, setPrompts] = useState<Prompts>(readPrompts); // the instructions the claude CLI gets
  const [language, setLanguage] = useState<Language>('uk');
  const [download, setDownload] = useState(0);
  // Which model this window works with, which ones are already on disk, and what the machine can run. `modelId`
  // is null only for the moment the adapter is being probed, before anything decides anything.
  const [modelId, setModelId] = useState<ModelId | null>(null);
  const [models, setModels] = useState<Record<ModelId, ModelState>>({ small: 'none', turbo: 'none' });
  const [gpu, setGpu] = useState<Gpu | null>(null);
  const [started, setStarted] = useState(false); // a worker was spawned, i.e. the download was agreed to
  const [askModel, setAskModel] = useState<ModelId | null>(null); // the «download the model?» window, and for which
  const [model, setModel] = useState<{ adapter: string; encoder: string } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null); // the one thing the window is doing, or nothing
  const [transcript, setTranscript] = useState('');
  // A run has put its text on screen. Separate from `transcript` because the panel is editable: selecting all
  // and cutting is a legitimate thing to do, and it must not throw the window back to the file picker.
  const [ran, setRan] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]); // timestamped speech, behind the subtitles and chapters
  const [subtitles, setSubtitles] = useState(''); // the .srt itself, so it can be fixed up before saving
  const [elapsed, setElapsed] = useState<number | null>(null); // seconds the last finished run took
  const [summary, setSummary] = useState('');
  const [chapters, setChapters] = useState('');
  const [view, setView] = useState<View>('transcript'); // each result has its own screen over the transcript
  const [audio, setAudio] = useState<ExportedAudio | null>(null);
  const [pending, setPending] = useState(false); // asked to transcribe before the model finished loading
  const [resumeAt, setResumeAt] = useState<number | null>(null); // where a stopped run can pick up, in seconds
  const [confirming, setConfirming] = useState(false); // the stop is one click away from costing the subtitles
  const [closeAsked, setCloseAsked] = useState(false); // main caught a close while a run was in flight
  const [noFfmpeg, setNoFfmpeg] = useState<string | null>(null); // why the «потрібен ffmpeg» window is open
  // Asked on startup and again whenever the «потрібен ffmpeg» window closes; assumed present until main says
  // otherwise. State, not a ref: the progress block reads it to decide whether it has a percentage to show.
  const [ffmpegReady, setFfmpegReady] = useState(true);

  const s = STRINGS[uiLang]; // every line this window shows
  // What this machine will load: a software adapter is refused by the worker, so it ends up on wasm like a
  // machine with no card at all — and that decides both the files and the size the window promises.
  const device: Device = isRealGpu(gpu) ? 'webgpu' : 'wasm';
  const fp16 = isRealGpu(gpu) && gpu.fp16;
  const recommended = recommendedModel();

  // The language of the recording, not of the interface: three bare words, each with a tooltip of its own.
  const speech: { value: Language; label: string; title: string }[] = [
    { value: null, label: s.speech.auto, title: s.speech.autoHint },
    { value: 'uk', label: 'UK', title: s.speech.ukHint },
    { value: 'en', label: 'EN', title: s.speech.enHint },
  ];

  // dragenter/dragleave also fire for children, so count the nesting instead of toggling on every event.
  const dragDepth = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const ready = useRef(false); // read inside the worker listener, which never sees state updates
  const startedAt = useRef(0);
  const stopped = useRef(false); // a cancelled ffmpeg rejects like a broken one; this tells the two apart
  const aiStopped = useRef(false); // same for a killed claude: its rejection is not a failure to report
  const covered = useRef(0); // seconds of audio the text already reaches, counted from the start of the file
  const offset = useRef(0); // where the current run started; a resumed worker counts from its own zero
  const kept = useRef(''); // the text a resumed run appends to
  const resumed = useRef(false); // a resumed run has no timestamps for the part before it, so it offers no .srt
  const pendingFrom = useRef<number | undefined>(undefined); // what the click asked for while the model loaded
  const painted = useRef(0); // when the streaming text was last written into the panel, see PAINT_EVERY_MS

  // Spawned on mount, and again after a stop: terminating is the only way out of a run, and it takes the
  // loaded model with it, so the replacement starts loading at once instead of waiting for the next click.
  const spawnWorker = (id: ModelId): void => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    ready.current = false;
    setModel(null);
    setDownload(0);
    setStarted(true);

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'download') setDownload(message.progress);
      if (message.type === 'ready') {
        setDownload(100);
        setModel({ adapter: message.adapter, encoder: message.encoder });
        // It is on disk now, so the settings window stops offering to download what is already here.
        setModels((current) => ({ ...current, [id]: 'ready' }));
        ready.current = true;
      }
      if (message.type === 'fallback') setFallback(s.error.fallback(message.from, message.reason));
      if (message.type === 'progress') {
        setJob({ kind: 'transcribing', percent: message.progress, merging: false });
        covered.current = offset.current + message.covered;
      }
      if (message.type === 'merging') {
        setJob((current) => (current?.kind === 'transcribing' ? { ...current, merging: true } : current));
      }
      if (message.type === 'partial') {
        // More text is still coming, so the «stitching» the estimate announced a moment ago has not started.
        setJob((current) =>
          current?.kind === 'transcribing' && current.merging ? { ...current, merging: false } : current,
        );
        if (Date.now() - painted.current < PAINT_EVERY_MS) return;
        painted.current = Date.now();
        setTranscript(kept.current + message.text);
        setRan(true);
      }
      if (message.type === 'result') {
        const whole = kept.current + message.text;
        setTranscript(whole);
        setRan(true);
        // A resumed run only has timestamps for the part it did, and half an .srt is worse than none.
        setSegments(resumed.current ? [] : message.segments);
        setSubtitles(resumed.current ? '' : toSrt(message.segments));
        setResumeAt(null);
        setJob(null);
        setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
        window.api.notify('MagScribe', s.toast.transcribed(s.words(countWords(whole))));
      }
      if (message.type === 'error') {
        // Before the model is up, the failure is permanent — keep it on screen instead of a toast that fades.
        if (!ready.current) setModelError(message.message);
        else toast.error(message.message);
        setJob((current) => (current?.kind === 'transcribing' ? null : current));
      }
    });

    // A worker that fails to load its own module never posts anything, and the window would wait forever.
    worker.addEventListener('error', (event) => setModelError(event.message || s.error.workerFailed));

    worker.postMessage({ type: 'load', lang: uiLang, model: id, offline: false } satisfies WorkerRequest);
  };

  // Mount only, and deliberately: one worker per window, and spawnWorker is re-created on every render.
  useEffect(() => {
    // What this machine has, and what it already holds. A model in the cache loads without touching the
    // network, so there is nothing to ask about; an empty cache means a download, and that is the person's
    // call — see docs/concept.md. With nothing chosen yet, the adapter decides which one is offered.
    void (async () => {
      // The adapter first: which files a model would fetch here depends on it, and so does what counts as cached.
      const adapter = await findGpu();
      const state = await modelStates(isRealGpu(adapter) ? 'webgpu' : 'wasm', isRealGpu(adapter) && adapter.fp16);
      const ready = MODEL_IDS.filter((id) => state[id] === 'ready');
      const fits = recommendedModel();
      // With nothing chosen yet: what this machine should run, unless it is not here and another one is —
      // downloading a second model while the first sits in the cache helps nobody.
      const first = ready.length === 0 || ready.includes(fits) ? fits : ready[0];
      const pick = readSetting(MODEL_KEY, MODEL_IDS, first);

      setGpu(adapter);
      setModels(state);
      setModelId(pick);
      if (state[pick] === 'ready') spawnWorker(pick);
      else setAskModel(pick);
    })();

    void window.api.hasFfmpeg().then(setFfmpegReady);
    // The percentage of whichever ffmpeg run is going on; nothing else in main reports one.
    const unsubscribe = [
      window.api.onAudioProgress((percent) =>
        setJob((current) =>
          current?.kind === 'reading' || current?.kind === 'exporting' || current?.kind === 'saving'
            ? { ...current, percent }
            : current,
        ),
      ),
      window.api.onCloseAsk(() => setCloseAsked(true)),
      window.api.onGpuGone((message) => {
        setModelError(s.error.restartApp(message));
        setJob((current) => (current?.kind === 'transcribing' ? null : current));
      }),
    ];

    return () => {
      workerRef.current?.terminate();
      unsubscribe.forEach((remove) => remove());
    };
    // Mount only: a running worker is not re-spawned because the window changed language, and the listeners
    // above are registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeSetting(THEME_KEY, theme);
    window.api.setTheme(theme);
  }, [theme]);

  useEffect(() => writePrompts(prompts), [prompts]);

  // What the window speaks: remembered, read out by a screen reader, and passed on to main, which has its own
  // strings for the open dialog and for the errors it reports.
  useEffect(() => {
    setUiLang(uiLang);
    writeSetting(LANG_KEY, uiLang);
    document.documentElement.lang = uiLang;
    window.api.setLang(uiLang);
  }, [uiLang]);

  // ffmpeg or the worker holding the file: this is what freezes the text and what the stop button can stop.
  const running = job !== null && job.kind !== 'ai';
  // The claude run counts as work too: it lasts minutes, the machine must not doze off in it, closing the
  // window has to ask, and nothing new may start underneath it and then be overwritten by its answer.
  const busy = job !== null;

  const stopDragging = (): void => {
    dragDepth.current = 0;
    setDragging(false);
  };

  const clearResults = (keepText = false): void => {
    if (!keepText) {
      setTranscript('');
      setRan(false);
      setElapsed(null);
      setAudio(null);
      setResumeAt(null);
    }
    setSegments([]);
    setSubtitles('');
    setSummary('');
    setChapters('');
    setView('transcript');
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
    setConfirming(false);
    // A claude run has nothing to resume and no worker to replace: kill the child and drop its answer.
    if (job?.kind === 'ai') {
      aiStopped.current = true;
      window.api.cancelAi();
      setJob(null);
      return;
    }
    stopped.current = true;
    window.api.cancelAudio(); // kills ffmpeg if we are still converting
    // The pipeline runs chunk after chunk inside a single await and never looks at a flag, so the worker has to go.
    workerRef.current?.terminate();
    if (modelId) spawnWorker(modelId);

    // Where the text got to: the run can pick up there instead of starting the file over.
    const reached = covered.current;
    setResumeAt(reached > 0 ? reached : null);
    setJob(null);
    toast.info(reached > 0 ? s.toast.stoppedAt(timecode(reached)) : s.toast.stopped);
  };

  const baseName = file ? file.name.replace(/\.[^.]+$/, '') : '';
  const extension = file?.name.split('.').pop() ?? '';

  /** `from` resumes a stopped run at that second of the file, keeping the text it already produced. */
  /**
   * Samples for the worker. ffmpeg does it when the machine has one — it streams, reports a percentage and
   * reads anything. Without it the browser's own decoder stands in: it holds the whole file in memory and only
   * knows the containers Chromium can demux, which is enough for the short clips this case is about.
   */
  const readSamples = async (path: string, from?: number): Promise<Float32Array> => {
    if (ffmpegReady) return window.api.extractAudio(path, from);

    const samples = await decodeInBrowser(await window.api.readBytes(path));
    // ffmpeg seeks before decoding; here the whole file is already decoded, so a resumed run just skips ahead.
    return from ? samples.subarray(Math.floor(from * SAMPLE_RATE)) : samples;
  };

  const startTranscription = async (from?: number): Promise<void> => {
    if (!file || !workerRef.current) return;

    const resuming = from !== undefined && from > 0;
    clearResults(resuming);
    kept.current = resuming ? `${transcript.trimEnd()} ` : '';
    resumed.current = resuming;
    offset.current = from ?? 0;
    covered.current = offset.current;

    stopped.current = false;
    setPending(false);
    setJob({ kind: 'reading', percent: 0 });
    startedAt.current = Date.now();
    try {
      const samples = await readSamples(file.path, from);
      if (stopped.current) return; // the stop caught up while ffmpeg was finishing: the worker is a new one
      setJob({ kind: 'transcribing', percent: 0, merging: false });
      workerRef.current.postMessage({ type: 'transcribe', audio: samples, language } satisfies WorkerRequest, [samples.buffer]);
    } catch (error) {
      // A killed ffmpeg rejects like a broken one. With no ffmpeg at all, a failure here means the browser
      // could not read this particular file, and the answer to that is the same window as a missing binary.
      if (!stopped.current) {
        if (ffmpegReady) failWith(error);
        else setNoFfmpeg(s.ffmpegDialog.cannotRead);
      }
    } finally {
      // Only our own reading: by now the worker may already be transcribing, or a stop may have cleared it.
      setJob((current) => (current?.kind === 'reading' ? null : current));
    }
  };

  /** Starts the run, or arranges for it: the model may still be loading, or not be downloaded at all yet. */
  const startOrWait = (from?: number): void => {
    pendingFrom.current = from;
    if (model) {
      void startTranscription(from);
      return;
    }
    setPending(true);
    if (!started && modelId) setAskModel(modelId); // nothing loading yet: ask before anything is downloaded
  };

  /**
   * Makes `id` the model of this window: loaded straight away when it is on disk, asked about when it is not.
   * A model that still has to be downloaded is not remembered until the download is agreed to — otherwise
   * «Not now» would leave the window pointing at a model it does not have.
   */
  const chooseModel = (id: ModelId): void => {
    if (models[id] !== 'ready') {
      setAskModel(id);
      return;
    }
    setModelId(id);
    writeSetting(MODEL_KEY, id);
    setAskModel(null);
    spawnWorker(id);
  };

  /** Yes to the download — of whichever model the question ended up offering, which is also the one kept. */
  const allowModel = (): void => {
    if (askModel === null) return;
    const id = askModel;
    setAskModel(null);
    setModelId(id);
    writeSetting(MODEL_KEY, id);
    spawnWorker(id);
  };

  const forgetModel = async (id: ModelId): Promise<void> => {
    try {
      await deleteModel(id);
      setModels((current) => ({ ...current, [id]: 'none' }));
      toast.success(s.toast.modelDeleted);
    } catch (error) {
      failWith(error);
    }
  };

  const convertToAudio = async (): Promise<void> => {
    if (!file) return;
    if (!ffmpegReady) {
      setNoFfmpeg(s.ffmpegDialog.forTrack);
      return;
    }

    clearResults();
    stopped.current = false;
    setJob({ kind: 'exporting', percent: 0 });
    try {
      const track = await window.api.exportAudio(file.path);
      if (stopped.current) return; // stopped mid-encode: do not throw the window onto the audio screen
      setAudio(track);
    } catch (error) {
      if (!stopped.current) failWith(error);
    } finally {
      setJob((current) => (current?.kind === 'exporting' ? null : current));
    }
  };

  /**
   * Hands over the audio track from a result screen. Nothing kept it: the transcription decodes the file into
   * samples, gives them to the worker and lets them go, so the track is encoded now — and deliberately without
   * touching `audio`, which would send the window to the export screen and take the results off it.
   */
  const saveTrack = async (): Promise<void> => {
    if (!file) return;
    if (!ffmpegReady) {
      setNoFfmpeg(s.ffmpegDialog.forTrack);
      return;
    }

    stopped.current = false;
    setJob({ kind: 'saving', percent: 0 });
    try {
      const track = audio ?? (await window.api.exportAudio(file.path));
      if (stopped.current) return; // stopped mid-encode: a save dialog nobody asked for is worse than nothing
      await save(window.api.saveAudio(track.path, `${baseName}.ogg`));
    } catch (error) {
      if (!stopped.current) failWith(error);
    } finally {
      setJob((current) => (current?.kind === 'saving' ? null : current));
    }
  };

  const copy = async (text: string): Promise<void> => {
    if (await window.api.copyText(text)) toast.success(s.toast.copied);
    else toast.error(s.toast.clipboardRefused);
  };

  const save = async (saved: Promise<boolean>): Promise<void> => {
    try {
      if (await saved) toast.success(s.toast.saved);
    } catch (error) {
      failWith(error);
    }
  };

  // Both stages run the local claude CLI: a summary of the plain text, chapters of the timestamped lines.
  const runAi = async (task: AiTask): Promise<void> => {
    aiStopped.current = false;
    setJob({ kind: 'ai', task });
    try {
      const text =
        task === 'summary'
          ? await window.api.summarize(transcript, prompts.summary)
          : await window.api.chapters(toTimedText(segments), prompts.chapters);
      if (aiStopped.current) return; // stopped while claude was writing: the answer is not wanted any more
      if (task === 'summary') setSummary(text);
      else setChapters(text);
      setView(task);
    } catch (error) {
      if (aiStopped.current) return; // our own kill, not a failure
      failWith(error);
    } finally {
      setJob((current) => (current?.kind === 'ai' ? null : current));
    }
  };

  // Main keeps the machine awake while this is true, and asks before closing the window.
  useEffect(() => {
    window.api.setWorking(busy);
  }, [busy]);

  // Loading the model takes a few seconds on every start — let the click wait for it instead of the person.
  useEffect(() => {
    if (!pending || model === null || busy) return;
    // The wait is over, and clearing the flag is what keeps this effect from firing again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(false);
    void startTranscription(pendingFrom.current);
    // startTranscription is a new function on every render; the flag above, not its identity, decides when
    // this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, model, busy]);

  // Downloading is only half the wait: the weights still have to be parsed and compiled onto the GPU.
  // `checking` lasts a few milliseconds, until the adapter probe and the cache lookup come back.
  const modelStage = modelId === null
    ? 'checking'
    : !started
      ? 'absent'
      : modelError
        ? 'failed'
        : model
          ? 'ready'
          : download >= 100
            ? 'preparing'
            : 'downloading';

  /** The job in words, or — when there is no job — whatever the model itself is still doing. */
  const barFor = (current: Job | null): Bar | null => {
    if (current === null) {
      if (modelStage === 'downloading') return { label: s.job.downloading, value: download };
      if (modelStage === 'preparing') return { label: s.job.preparing };
      return null;
    }
    switch (current.kind) {
      case 'reading':
        // The browser decoder reports nothing on its way; only ffmpeg has a percentage to show.
        return { label: s.job.readingAudio, value: ffmpegReady ? current.percent : undefined };
      case 'exporting':
      case 'saving':
        return { label: s.job.audioFile, value: current.percent };
      case 'transcribing':
        return current.merging
          ? { label: s.job.merging }
          : { label: s.job.transcribing, value: current.percent };
      case 'ai':
        return { label: current.task === 'summary' ? s.job.summary : s.job.chapters };
    }
  };

  const bar = barFor(job);

  const status = busy
    ? s.status.awake
    : model
      ? transcript || audio
        ? s.status.done
        : s.status.modelReady
      : modelStage === 'absent'
        ? s.status.modelAbsent
        : modelStage === 'preparing'
          ? s.status.preparing
          : s.status.downloading; // also what the few milliseconds of `checking` say

  // What the window is about right now: picking a file, reading what a run produced, or holding an exported track.
  const stage = audio || job?.kind === 'exporting' ? 'audio' : ran || running ? 'text' : 'pick';
  // Nothing switches the view by itself: a run ends on the transcript, and the pill opens the rest.
  const screen: Screen = stage === 'text' ? view : stage;
  const done = transcript !== '' && !running; // the text can still be copied and saved while claude thinks
  const onSubtitles = screen === 'subtitles'; // the text screen and the .srt screen share one set of buttons

  // Electron takes the window title from the document, so the taskbar can say which screen is open.
  // The page name leads the system title bar, the app name follows it, the way a browser tab reads.
  const screenTitle = job?.kind === 'exporting'
    ? s.screen.conversion
    : job?.kind === 'reading' || job?.kind === 'transcribing'
      ? s.screen.transcription
      : { pick: '', ...s.screen }[screen];

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
          <span className="font-medium">{s.ui.dropTitle}</span>
          <span className="text-[13px] text-muted-foreground">{s.ui.dropHint}</span>
        </div>
        <Button variant="outline" onClick={chooseFile}>
          {s.ui.dropPick}
        </Button>
      </div>

      {file && stage === 'pick' && (
        <div className="flex items-center gap-3 rounded-[10px] border bg-background px-3 py-2.5" title={file.path}>
          <FileVideoIcon className="size-4.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13.5px] font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">{formatSize(file.size, s)}</span>
          </div>
        </div>
      )}
    </div>
  );

  /** The tail every result screen shares: the text out as a copy, and the text out as a file. */
  const takeOut = (out: { text: string; file: string; label: string; lead?: boolean; disabled?: boolean }): ReactNode => (
    <>
      <PillButton
        icon={<ClipboardCopyIcon />}
        label={s.pill.copy}
        disabled={out.disabled}
        onClick={() => copy(out.text)}
      />
      <PillButton
        icon={<DownloadIcon />}
        label={out.label}
        lead={out.lead}
        disabled={out.disabled}
        onClick={() => save(window.api.saveText(out.text, out.file))}
      />
    </>
  );

  // The lead button follows what is on screen: the text leads to a summary, the .srt leads to chapters.
  const summaryButton: ReactNode = summary ? (
    <PillButton lead icon={<SparklesIcon />} label={s.pill.summary} disabled={!done} onClick={() => setView('summary')} />
  ) : (
    <PillButton
      lead
      icon={<SparklesIcon />}
      label={s.pill.process}
      wide={job?.kind === 'ai' && job.task === 'summary' ? s.pill.processing : undefined}
      disabled={!done || job?.kind === 'ai'}
      onClick={() => runAi('summary')}
    />
  );

  const chaptersButton: ReactNode = chapters ? (
    <PillButton lead icon={<ListOrderedIcon />} label={s.pill.chapters} disabled={!done} onClick={() => setView('chapters')} />
  ) : (
    <PillButton
      lead
      icon={<ListOrderedIcon />}
      label={s.pill.chapters}
      wide={job?.kind === 'ai' && job.task === 'chapters' ? s.pill.chaptering : undefined}
      disabled={!done || segments.length === 0 || job?.kind === 'ai'}
      onClick={() => runAi('chapters')}
    />
  );

  const transcribeButton = (lead: boolean): ReactNode => (
    <PillButton
      lead={lead}
      icon={<AudioLinesIcon />}
      label={s.pill.transcribe}
      wide={busy && stage === 'text' ? s.pill.transcribing : pending ? s.pill.waitingForModel : undefined}
      disabled={!file || busy || pending || modelStage === 'failed'}
      onClick={() => startOrWait()}
    />
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
        <div className={cn('absolute inset-0 flex flex-col px-6 pt-22', bar ? 'pb-33' : 'pb-24')}>
          <div className="mx-auto flex min-h-0 w-170 max-w-full flex-1 flex-col">
            <div className="mb-1.5 flex items-center justify-center gap-2">
              <h1 className="min-w-0 text-center text-[26px] leading-tight font-semibold tracking-[-0.02em] break-words">
                {baseName}
              </h1>
              {/* The export screen has its own save button; everywhere else the track hides behind this one. */}
              {stage !== 'audio' && (
                <TooltipProvider delay={350}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={s.ui.saveTrack}
                          disabled={busy}
                          onClick={() => void saveTrack()}
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground',
                            'transition-colors hover:bg-muted hover:text-foreground',
                            'disabled:pointer-events-none disabled:opacity-40',
                          )}
                        >
                          <DownloadIcon className="size-4" />
                        </button>
                      }
                    />
                    <TooltipContent>{s.ui.saveTrack}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <p className="mb-6 text-center text-[13px] text-muted-foreground">
              {screen === 'summary'
                ? `${s.screen.summary} · ${s.words(countWords(summary))}`
                : screen === 'subtitles'
                  ? `${s.screen.subtitles} · SRT · ${s.cues(segments.length)}`
                  : screen === 'chapters'
                    ? `${s.screen.chapters} · ${s.chapters(countChapters(chapters))}`
                    : audio
                      ? `OGG · Opus · ${formatSize(audio.size, s)}`
                      : file && `${formatSize(file.size, s)} · ${extension.toUpperCase()}`}
              {screen === 'transcript' &&
                elapsed !== null &&
                s.ui.transcribedIn(timecode(elapsed), s.words(countWords(transcript)))}
            </p>

            {screen === 'audio' ? (
              audio && (
                <div className="flex items-center justify-center gap-3 text-muted-foreground">
                  <FileAudioIcon className="size-5" strokeWidth={1.75} />
                  <span>{s.ui.audioReady}</span>
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
                readOnly={running}
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
          ['settings', s.ui.settings],
          ['about', s.ui.about],
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
            <RotateCcwIcon /> {s.ui.startOver}
          </Button>
        )}
        <div className="flex items-center gap-0.5 rounded-[10px] border bg-background p-[3px]">
          {themes.map(({ value, Icon }) => (
            <Button
              key={value}
              variant="ghost"
              size="icon-xs"
              title={s.theme[value]}
              aria-label={s.theme[value]}
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

      {bar && (
        <div className="absolute bottom-23 left-1/2 flex w-110 max-w-[calc(100%-3rem)] -translate-x-1/2 flex-col gap-2">
          <div className="flex items-center justify-between gap-4 text-[12.5px] text-muted-foreground">
            <span>{bar.label}</span>
            <div className="flex items-center gap-2.5">
              {bar.value !== undefined && (
                <b className="font-medium text-foreground tabular-nums">{Math.round(bar.value)} %</b>
              )}
              {busy && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={s.ui.stop}
                  aria-label={s.ui.stop}
                  className="-my-1 size-5.5 rounded-[6px] text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  // Only a run that is decoding has something to lose; reading the file, encoding a track or
                  // waiting on claude stops without a word.
                  onClick={() => (job?.kind === 'transcribing' ? setConfirming(true) : stop())}
                >
                  <XIcon className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={bar.label}
            {...(bar.value !== undefined && {
              'aria-valuenow': Math.round(bar.value),
              'aria-valuetext': `${Math.round(bar.value)} %`,
            })}
          >
            {bar.value === undefined ? (
              // No percentage to promise: a short bar crossing the track, instead of a full one that looks done.
              <div className="h-full w-2/5 animate-indeterminate rounded-full bg-foreground" />
            ) : (
              <div
                className={cn(
                  'relative h-full overflow-hidden rounded-full bg-foreground transition-[width]',
                  'after:absolute after:inset-0 after:animate-sheen after:bg-linear-to-r',
                  'after:from-transparent after:via-white/35 after:to-transparent',
                )}
                style={{ width: `${bar.value}%` }}
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
          aria-live="polite"
        >
          <span>{modelError ?? status}</span>
          {modelError ? (
            <StatusLink
              label={s.ui.retry}
              onClick={() => {
                setModelError(null);
                if (modelId) spawnWorker(modelId);
              }}
            />
          ) : modelStage === 'absent' && modelId ? (
            <StatusLink label={s.ui.downloadModel} onClick={() => setAskModel(modelId)} />
          ) : (
            model && <span className="text-[11px] opacity-75">{`${model.adapter} · ${model.encoder}`}</span>
          )}
        </div>

        <div
          className={cn(
            'pointer-events-auto flex items-center gap-1 rounded-full bg-card p-1.5',
            'ring-1 ring-border shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]',
          )}
        >
          {stage === 'pick' && (
            <>
              {transcribeButton(true)}
              <PillButton
                icon={<FileAudioIcon />}
                label={s.pill.convert}
                wide={s.pill.convertShort}
                disabled={!file}
                onClick={convertToAudio}
              />
            </>
          )}
          {/* The text and the .srt are the same run, so they share one row: copy, save, swap, and what is next. */}
          {(screen === 'transcript' || onSubtitles) && (
            <>
              {takeOut({
                text: onSubtitles ? subtitles : transcript,
                file: `${baseName}${onSubtitles ? '.srt' : '.txt'}`,
                label: onSubtitles ? s.pill.saveSrt : s.pill.saveTxt,
                disabled: !done,
              })}
              {resumeAt !== null && (
                <PillButton
                  icon={<PlayIcon />}
                  label={s.pill.resumeFrom(timecode(resumeAt))}
                  disabled={!file || busy || pending || modelStage === 'failed'}
                  onClick={() => startOrWait(resumeAt)}
                />
              )}
              {segments.length > 0 && (
                <PillButton
                  icon={onSubtitles ? <FileTextIcon /> : <CaptionsIcon />}
                  label={onSubtitles ? s.pill.toText : s.pill.toSubtitles}
                  wide={onSubtitles ? s.pill.text : s.pill.subtitles}
                  disabled={!done}
                  onClick={() => setView(onSubtitles ? 'transcript' : 'subtitles')}
                />
              )}
              {onSubtitles ? chaptersButton : summaryButton}
            </>
          )}
          {screen === 'chapters' && (
            <>
              <PillButton icon={<ArrowLeftIcon />} label={s.pill.toSubtitles} onClick={() => setView('subtitles')} />
              {takeOut({ text: chapters, file: s.file.chapters(baseName), label: s.pill.saveTxt, lead: true })}
            </>
          )}
          {screen === 'summary' && (
            <>
              <PillButton icon={<ArrowLeftIcon />} label={s.pill.toTranscript} onClick={() => setView('transcript')} />
              {takeOut({ text: summary, file: s.file.summary(baseName), label: s.pill.saveTxt, lead: true })}
            </>
          )}
          {stage === 'audio' && (
            <>
              <PillButton
                lead
                icon={<DownloadIcon />}
                label={s.pill.saveOgg}
                disabled={!audio}
                onClick={() => audio && save(window.api.saveAudio(audio.path, `${baseName}.ogg`))}
              />
              {transcribeButton(false)}
            </>
          )}
        </div>

        {/* Plain text, not a segmented control: it is set once per file and should not compete with the pill.
            Three bare words need to say what they are for, so each carries a tooltip. */}
        <TooltipProvider delay={350}>
          <div className="pointer-events-auto flex items-center gap-2.5 justify-self-end self-center text-xs">
            {speech.map(({ value, label, title }) => (
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

      <ConfirmDialog
        open={confirming}
        title={s.stopDialog.title}
        cancel={s.stopDialog.cancel}
        confirm={s.stopDialog.confirm}
        close={s.ui.close}
        body={s.stopDialog.body}
        onConfirm={stop}
        onClose={() => setConfirming(false)}
      />
      <ConfirmDialog
        open={closeAsked}
        title={s.closeDialog.title}
        cancel={s.closeDialog.cancel}
        confirm={s.closeDialog.confirm}
        close={s.ui.close}
        body={s.closeDialog.body}
        onConfirm={() => {
          setCloseAsked(false);
          window.api.answerClose(true);
        }}
        onClose={() => {
          setCloseAsked(false);
          window.api.answerClose(false);
        }}
      />
      <ConfirmDialog
        open={askModel !== null}
        title={s.modelDialog.title}
        cancel={s.modelDialog.cancel}
        confirm={s.modelDialog.confirm(formatSize(modelBytes(askModel ?? recommended, device, fp16), s))}
        close={s.ui.close}
        body={s.modelDialog.body(MODELS[recommended].name, isRealGpu(gpu))}
        tone="default"
        onConfirm={allowModel}
        // «Not now» also calls off a click that was waiting for the model it just declined.
        onClose={() => {
          setAskModel(null);
          setPending(false);
        }}
      >
        <ModelPicker
          s={s}
          value={askModel ?? recommended}
          states={models}
          recommended={recommended}
          device={device}
          fp16={fp16}
          busy={false}
          onChange={setAskModel}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={noFfmpeg !== null}
        title={s.ffmpegDialog.title}
        cancel={s.ffmpegDialog.cancel}
        confirm={s.ffmpegDialog.confirm}
        close={s.ui.close}
        body={s.ffmpegDialog.body(noFfmpeg ?? '')}
        tone="default"
        onConfirm={() => {
          window.api.openFfmpegDownload();
          setNoFfmpeg(null);
        }}
        // Re-ask on the way out: ffmpeg may have been installed while this window was open.
        onClose={() => {
          setNoFfmpeg(null);
          void window.api.hasFfmpeg().then(setFfmpegReady);
        }}
      />
      <SettingsDialog
        open={dialog === 'settings'}
        s={s}
        lang={uiLang}
        onLang={setUiLangState}
        model={modelId ?? recommended}
        states={models}
        recommended={recommended}
        device={device}
        fp16={fp16}
        modelBusy={busy || modelStage === 'downloading' || modelStage === 'preparing'}
        onModel={chooseModel}
        onDeleteModel={(id) => void forgetModel(id)}
        prompts={prompts}
        onPrompts={setPrompts}
        onClose={() => setDialog(null)}
      />
      <AboutDialog
        open={dialog === 'about'}
        s={s}
        model={MODELS[modelId ?? recommended].name}
        engine={model && `${model.adapter} · ${model.encoder}`}
        onClose={() => setDialog(null)}
      />
      {/* Top right: at the bottom the toasts sat over the pill, i.e. over the buttons they are reporting on. */}
      <Toaster position="top-right" />
    </div>
  );
}
