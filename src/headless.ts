/**
 * The renderer of the command line's hidden window (`index.html#cli`, see cli.ts and main.ts).
 *
 * It does what the window does on a click, minus the questions: the same transcription engine the person chose —
 * an API, or the same adapter probe, model and worker. What the window would ask about — a model that is not
 * downloaded — fails here instead, and the worker is told to stay offline so a fallback cannot fetch anything.
 */
import { connectionLabel, type Connection } from '@/api';
import type { CliJob } from '@/cli';
import { findGpu, isRealGpu } from '@/gpu';
import { pickUiLang, STRINGS, UI_LANGS } from '@/i18n';
import { MODEL_IDS, MODELS, modelStates, recommendedModel } from '@/models';
import { errorText } from '@/lib/utils';
import { LANG_KEY, MODEL_KEY, readSetting } from '@/settings';
import { transcribeOverApi } from '@/useApiSpeech';
import type { WorkerRequest, WorkerResponse } from '@/worker';

const lang = readSetting(LANG_KEY, UI_LANGS, pickUiLang(navigator.language));
const s = STRINGS[lang];
window.api.setLang(lang); // main's own lines (ffmpeg, memory) in the same language as ours

const fail = (error: unknown): void => window.api.cliFail(errorText(error));

/** Logs a percentage only when the whole number changes; a line per token would flood stderr. */
const percentLog = (line: (percent: number) => string): ((percent: number) => void) => {
  let last = -1;
  return (percent) => {
    const whole = Math.floor(percent);
    if (whole === last) return;
    last = whole;
    window.api.cliLog(line(whole));
  };
};

/** The transcription engine set to an API in the window: the same pieces and requests a click would send. */
const runApi = async ({ file, language }: Pick<CliJob, 'file' | 'language'>, connection: Connection): Promise<void> => {
  window.api.cliLog(s.cli.engine(connectionLabel(connection)));
  window.api.onAudioProgress(percentLog(s.cli.reading));
  const audio = await window.api.extractAudio(file);
  const transcribing = percentLog(s.cli.transcribing);
  const result = await transcribeOverApi(audio, language, {
    onProgress: transcribing,
    onMerging: () => undefined,
    onPartial: () => undefined,
  });
  if (result) window.api.cliDone(result.text, result.segments);
};

const run = async (): Promise<void> => {
  const job = await window.api.cliJob();
  const { speech, apis } = await window.api.getAiSettings();
  if (speech !== 'whisper') return runApi(job, apis.speech);

  const gpu = await findGpu();
  const id = readSetting(MODEL_KEY, MODEL_IDS, recommendedModel());
  const states = await modelStates(isRealGpu(gpu) ? 'webgpu' : 'wasm', isRealGpu(gpu) && gpu.fp16);
  if (states[id] !== 'ready') throw new Error(s.cli.noModel(MODELS[id].name));

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('error', (event) => window.api.cliFail(event.message || s.error.workerFailed));

  const transcribing = percentLog(s.cli.transcribing);
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'fallback') window.api.cliLog(s.error.fallback(message.from, message.reason));
    else if (message.type === 'progress') transcribing(message.progress);
    else if (message.type === 'merging') window.api.cliLog(s.cli.merging);
    else if (message.type === 'result') window.api.cliDone(message.text, message.segments);
    else if (message.type === 'error') window.api.cliFail(message.message);
    else if (message.type === 'ready') {
      window.api.cliLog(s.cli.engine(`${message.adapter} · ${message.encoder}`));
      void window.api
        .extractAudio(job.file)
        .then((audio) => {
          const request: WorkerRequest = { type: 'transcribe', audio, language: job.language };
          worker.postMessage(request, [audio.buffer]);
        })
        .catch(fail);
    }
  });

  window.api.onAudioProgress(percentLog(s.cli.reading));
  worker.postMessage({ type: 'load', lang, model: id, offline: true } satisfies WorkerRequest);
};

run().catch(fail);
