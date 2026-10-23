/// <reference lib="webworker" />
/// <reference types="@webgpu/types" />
import {
  env,
  pipeline,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import { findGpu } from './gpu';
import { setUiLang, t, type UiLang } from './i18n';
import { MODELS, weightsFor, type Device, type ModelId, type Weights } from './models';
import { SAMPLE_RATE } from './pcm';
import { toSegments, type Segment } from './subtitles';

// Where onnxruntime takes its own runtime from. Left alone it imports the `.mjs` glue from cdn.jsdelivr.net,
// which costs the app its offline start and lets a CDN execute code in our window; the files are copied next to
// the bundle at build time (see vite.renderer.config.mts). `location.href` is the worker's own URL, so this
// resolves on both `app://bundle` and the dev server's localhost. Setting the prefix also turns off the
// bundler's own guess for the `.wasm`, which is why both halves live in this one folder.
// `wasm` is a read-only optional in the types (the same env object serves onnxruntime-node), so only its
// fields can be set. If it were ever missing, onnxruntime would go back to the CDN — and the CSP would turn
// that into a loud «no available backend» rather than a quiet download, which is how this was found.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = new URL('/ort/', location.href).href;

const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;
const JUMP_S = CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S; // new audio each chunk adds; the rest overlaps its neighbours

// null lets Whisper detect the language itself, per 30-second chunk.
export type Language = 'uk' | 'en' | null;

// `lang` is the interface language, for the few messages of ours that reach the screen — not the speech one.
// It arrives with `load` only: a worker is spawned on mount and after every stop, which is often enough.
// `offline` is the command line's: it may only use what is cached, since nobody is there to agree to a download.
export type WorkerRequest =
  | { type: 'load'; lang: UiLang; model: ModelId; offline: boolean }
  | { type: 'transcribe'; audio: Float32Array; language: Language };

export type WorkerResponse =
  | { type: 'download'; progress: number } // model download, 0..100
  | { type: 'fallback'; from: Device; reason: string }
  | { type: 'ready'; adapter: string; encoder: string } // what the model really runs on, for the status line
  // `covered` is how far into the audio the text already reaches, in seconds — where a stopped run resumes.
  | { type: 'progress'; progress: number; covered: number }
  | { type: 'merging' } // chunks done; the pipeline is still stitching overlaps and timestamps
  | { type: 'partial'; text: string } // text so far, so the first chunk is not a silent wait
  | { type: 'result'; text: string; segments: Segment[] }
  | { type: 'error'; message: string };

// Which files to load is the model's own business now — see `MODELS` in models.ts, where each one carries the
// pair it wants with and without `shader-f16`. The fp32 encoder is never an option: it keeps its weights in a
// multi-gigabyte side file. (The int8-vs-q4 timings in the git history were taken on SwiftShader, not on a
// GPU, so treat them as CPU numbers.)
type Picked = { adapter: string; weights: Weights };

// A software adapter is refused rather than used: it is just as slow as wasm and it lies in the status line.
const pickWebGpu = async (model: ModelId): Promise<Picked> => {
  const gpu = await findGpu();
  if (!gpu) throw new Error(t().error.adapterNull);
  if (gpu.software) throw new Error(t().error.softwareAdapter(gpu.label));

  return { adapter: `WebGPU · ${gpu.label}`, weights: weightsFor(model, 'webgpu', gpu.fp16) };
};

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

const post = (message: WorkerResponse): void => self.postMessage(message);

// The library already aggregates per-file bytes into a single percentage for us.
const reportDownload = (info: ProgressInfo): void => {
  if (info.status === 'progress_total') post({ type: 'download', progress: info.progress });
};

const load = async (model: ModelId): Promise<void> => {
  // WebGPU first; fall through to wasm both when the API is missing and when the backend fails to start.
  const devices: Device[] = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];

  for (const device of devices) {
    try {
      const picked: Picked =
        device === 'webgpu'
          ? await pickWebGpu(model)
          : { adapter: 'CPU · wasm', weights: weightsFor(model, 'wasm', false) };
      // `bytes` in the pair is for the window to show; the pipeline is given the two quantisations themselves.
      const { encoder_model, decoder_model_merged } = picked.weights;
      transcriber = await pipeline('automatic-speech-recognition', MODELS[model].repo, {
        device,
        dtype: { encoder_model, decoder_model_merged },
        progress_callback: reportDownload,
      });
      post({ type: 'ready', adapter: picked.adapter, encoder: encoder_model });
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (device === devices.at(-1)) throw new Error(`${device}: ${reason}`, { cause: error });
      post({ type: 'fallback', from: device, reason });
    }
  }
};

const transcribe = async (audio: Float32Array, language: Language): Promise<void> => {
  if (!transcriber) throw new Error(t().error.modelNotLoaded);

  const duration = audio.length / SAMPLE_RATE;
  // The pipeline's own window loop: windows start every JUMP_S, the last is the first that reaches the end.
  const windows = duration > CHUNK_LENGTH_S ? Math.ceil((duration - CHUNK_LENGTH_S) / JUMP_S) + 1 : 1;

  // The pipeline types its tokenizer as the generic base class; for whisper it really is a WhisperTokenizer.
  const tokenizer = transcriber.tokenizer as ConstructorParameters<typeof WhisperTextStreamer>[0];

  let text = '';

  // Progress counts finished 30-second windows. Two earlier counters ran ahead of the audio:
  // - streamer.end() fires per pass, not per window — return_timestamps takes the seek path
  //   (`_generate_with_seek`), which generates again whenever the model stops short inside a window;
  // - summing the timestamps each pass stopped at overshoots too, because a repeat pass runs on the rest of the
  //   window padded with silence, and Whisper puts timestamps on that silence up to 30 s.
  // The pipeline calls `model.generate` exactly once per window; the repeat passes go through `super.generate`
  // inside it, past this wrapper. So the wrapped call is the one count that cannot outrun the audio.
  const { model } = transcriber;
  const generate = model.generate;
  let done = 0;
  model.generate = async (...args: Parameters<typeof generate>) => {
    const result = await generate.apply(model, args);
    done += 1;
    // `covered` is where a stopped run resumes: every window but the last adds JUMP_S of new audio.
    post({ type: 'progress', progress: (done / windows) * 100, covered: Math.min(duration, done * JUMP_S) });
    // The last window is not the end of the run: decode_asr still has to resolve the overlap between every pair
    // of windows and turn timestamp tokens into spans. Nothing reports from in there.
    if (done >= windows) post({ type: 'merging' });
    return result;
  };

  const streamer = new WhisperTextStreamer(tokenizer, {
    // Chunks take a while, so stream the words out as they are decoded instead of waiting for the chunk.
    callback_function: (piece: string) => {
      text += piece;
      post({ type: 'partial', text });
    },
  });

  const output = await transcriber(audio, {
    ...(language && { language }),
    task: 'transcribe',
    chunk_length_s: CHUNK_LENGTH_S,
    stride_length_s: STRIDE_LENGTH_S,
    // Timestamps cost a few tokens per chunk and give us subtitles and chapters for free — always on.
    return_timestamps: true,
    streamer,
  }).finally(() => {
    model.generate = generate;
  });

  const { text: full, chunks = [] } = Array.isArray(output) ? output[0] : output;
  post({ type: 'result', text: full.trim(), segments: toSegments(chunks) });
};

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'load') {
    setUiLang(request.lang);
    // The Cache Storage is read first either way. transformers.js refuses a setup with both sources off, so
    // offline turns on the «local» one instead — it looks under /models/ on our own origin, where nothing is.
    env.allowLocalModels = request.offline;
    env.allowRemoteModels = !request.offline;
  }
  const done = request.type === 'load' ? load(request.model) : transcribe(request.audio, request.language);

  done.catch((error: unknown) => {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});
