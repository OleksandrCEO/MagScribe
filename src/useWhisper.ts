import { useEffect, useRef, useState } from 'react';
import { findGpu, isRealGpu, type Gpu } from '@/gpu';
import type { Strings, UiLang } from '@/i18n';
import {
  deleteModel,
  modelStates,
  MODEL_IDS,
  recommendedModel,
  type Device,
  type ModelId,
  type ModelState,
} from '@/models';
import { MODEL_KEY, readSetting, writeSetting } from '@/settings';
import type { Segment } from '@/subtitles';
import type { Language, WorkerRequest, WorkerResponse } from '@/worker';

/** What a finished run hands back — the same shape whichever engine produced it. */
export type Transcription = { text: string; segments: Segment[] };

/** What a run reports on its way. `covered` is how far into the audio the text reaches, in seconds. */
export type RunHandlers = {
  onProgress: (percent: number, covered: number) => void;
  onMerging: () => void;
  onPartial: (text: string) => void;
};

// Downloading is only half the wait: the weights still have to be parsed and compiled onto the GPU.
// `checking` lasts a few milliseconds, until the adapter probe and the cache lookup come back.
export type ModelStage = 'checking' | 'absent' | 'failed' | 'ready' | 'preparing' | 'downloading';

// The run in flight: its handlers, and how to settle the promise `transcribe` returned.
type Run = RunHandlers & { resolve: (result: Transcription | null) => void; reject: (error: Error) => void };

/**
 * The Whisper model in a Web Worker: which one, whether it is on disk, loading it, and running it. One worker per
 * window, spawned on mount and again after a stop — terminating is the only way out of a run, and it takes the
 * loaded model with it, so the replacement starts loading at once instead of waiting for the next click.
 */
export function useWhisper(s: Strings, uiLang: UiLang) {
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

  const workerRef = useRef<Worker | null>(null);
  const ready = useRef(false); // read inside the worker listener, which never sees state updates
  const run = useRef<Run | null>(null);

  // What this machine will load: a software adapter is refused by the worker, so it ends up on wasm like a
  // machine with no card at all — and that decides both the files and the size the window promises.
  const device: Device = isRealGpu(gpu) ? 'webgpu' : 'wasm';
  const fp16 = isRealGpu(gpu) && gpu.fp16;
  const recommended = recommendedModel();

  /** Settles the run in flight, if any, with nothing to show: stopped, or the model went away under it. */
  const dropRun = (): void => {
    run.current?.resolve(null);
    run.current = null;
  };

  const spawn = (id: ModelId): void => {
    dropRun();
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    ready.current = false;
    setModel(null);
    setModelError(null); // a fresh worker owes nothing to the one before it, which may have failed
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
      if (message.type === 'progress') run.current?.onProgress(message.progress, message.covered);
      if (message.type === 'merging') run.current?.onMerging();
      if (message.type === 'partial') run.current?.onPartial(message.text);
      if (message.type === 'result') {
        run.current?.resolve({ text: message.text, segments: message.segments });
        run.current = null;
      }
      if (message.type === 'error') {
        // Before the model is up, the failure is permanent — keep it on screen instead of a toast that fades.
        if (!ready.current) setModelError(message.message);
        run.current?.reject(new Error(message.message));
        run.current = null;
      }
    });

    // A worker that fails to load its own module never posts anything, and the window would wait forever.
    worker.addEventListener('error', (event) => setModelError(event.message || s.error.workerFailed));

    worker.postMessage({ type: 'load', lang: uiLang, model: id, offline: false } satisfies WorkerRequest);
  };

  // Mount only, and deliberately: one worker per window, and spawn is re-created on every render.
  useEffect(() => {
    // What this machine has, and what it already holds. A model in the cache loads without touching the
    // network, so there is nothing to ask about; an empty cache means a download, and that is the person's
    // call — see docs/concept.md. With nothing chosen yet, the adapter decides which one is offered.
    void (async () => {
      // The adapter first: which files a model would fetch here depends on it, and so does what counts as cached.
      const adapter = await findGpu();
      const state = await modelStates(isRealGpu(adapter) ? 'webgpu' : 'wasm', isRealGpu(adapter) && adapter.fp16);
      const onDisk = MODEL_IDS.filter((id) => state[id] === 'ready');
      const fits = recommendedModel();
      // With nothing chosen yet: what this machine should run, unless it is not here and another one is —
      // downloading a second model while the first sits in the cache helps nobody.
      const first = onDisk.length === 0 || onDisk.includes(fits) ? fits : onDisk[0];
      const pick = readSetting(MODEL_KEY, MODEL_IDS, first);

      setGpu(adapter);
      setModels(state);
      setModelId(pick);
      if (state[pick] === 'ready') spawn(pick);
      else setAskModel(pick);
    })();

    const unsubscribe = window.api.onGpuGone((message) => {
      setModelError(s.error.restartApp(message));
      dropRun();
    });

    return () => {
      workerRef.current?.terminate();
      unsubscribe();
    };
    // Mount only: a running worker is not re-spawned because the window changed language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Runs the loaded model over the samples. Resolves null when the run was stopped or the model went away. */
  const transcribe = (audio: Float32Array, language: Language, handlers: RunHandlers): Promise<Transcription | null> =>
    new Promise((resolve, reject) => {
      const worker = workerRef.current;
      if (!worker || !ready.current) {
        reject(new Error(s.error.modelNotLoaded));
        return;
      }
      run.current = { ...handlers, resolve, reject };
      worker.postMessage({ type: 'transcribe', audio, language } satisfies WorkerRequest, [audio.buffer]);
    });

  /** Ends the run in flight. The pipeline never looks at a flag mid-run, so the worker goes and a new one loads. */
  const restart = (): void => {
    if (modelId) spawn(modelId);
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
    spawn(id);
  };

  /** Yes to the download — of whichever model the question ended up offering, which is also the one kept. */
  const allowModel = (): void => {
    if (askModel === null) return;
    const id = askModel;
    setAskModel(null);
    setModelId(id);
    writeSetting(MODEL_KEY, id);
    spawn(id);
  };

  /** Removes one model's files. Rejects when the cache refused, and the window says so. */
  const forgetModel = async (id: ModelId): Promise<void> => {
    await deleteModel(id);
    setModels((current) => ({ ...current, [id]: 'none' }));
  };

  const modelStage: ModelStage = modelId === null
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

  return {
    modelId,
    models,
    gpu,
    device,
    fp16,
    recommended,
    started,
    download,
    model,
    modelError,
    fallback,
    modelStage,
    askModel,
    setAskModel,
    transcribe,
    restart,
    chooseModel,
    allowModel,
    forgetModel,
  };
}
