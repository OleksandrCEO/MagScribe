/// <reference lib="webworker" />
/// <reference types="@webgpu/types" />
import {
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

const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;
const JUMP_S = CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S; // new audio each chunk adds; the rest overlaps its neighbours

// null lets Whisper detect the language itself, per 30-second chunk.
export type Language = 'uk' | 'en' | null;

// `lang` is the interface language, for the few messages of ours that reach the screen — not the speech one.
// It arrives with `load` only: a worker is spawned on mount and after every stop, which is often enough.
export type WorkerRequest =
  | { type: 'load'; lang: UiLang; model: ModelId }
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

  // The pipeline types its tokenizer as the generic base class; for whisper it really is a WhisperTokenizer.
  const tokenizer = transcriber.tokenizer as ConstructorParameters<typeof WhisperTextStreamer>[0];

  let text = '';

  // Counting generate() calls would be wrong here. With return_timestamps the model takes the seek path
  // (`_generate_with_seek`): when it stops short inside a 30-second window it re-encodes the remainder and
  // generates again, so one window costs one call or several, and the count runs ahead of the audio.
  // What every pass does report is the timestamp it stopped at, i.e. how much of its segment it ate. Those add
  // up to the whole window, and consecutive windows overlap, so JUMP/WINDOW turns eaten audio into new audio.
  let consumed = 0; // seconds of audio the passes have chewed through, counting each window whole
  let lastEnd = 0; // the last timestamp inside the pass that is running

  const streamer = new WhisperTextStreamer(tokenizer, {
    // Chunks take a while, so stream the words out as they are decoded instead of waiting for the chunk.
    callback_function: (piece: string) => {
      text += piece;
      post({ type: 'partial', text });
    },
    on_chunk_end: (time: number) => {
      lastEnd = time;
    },
    // end() runs once per generate() call — one or more of them per 30-second window.
    on_finalize: () => {
      consumed += lastEnd || CHUNK_LENGTH_S; // a pass that emitted no timestamp swallowed its whole segment
      lastEnd = 0;

      const covered = duration > 0 ? Math.min(duration, consumed * (JUMP_S / CHUNK_LENGTH_S)) : 0;
      post({ type: 'progress', progress: duration > 0 ? (covered / duration) * 100 : 100, covered });
      // Reaching the end of the audio is not the end of the run: decode_asr still has to resolve the overlap
      // between every pair of windows and turn timestamp tokens into spans. Nothing reports from in there.
      if (covered >= duration) post({ type: 'merging' });
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
  });

  const { text: full, chunks = [] } = Array.isArray(output) ? output[0] : output;
  post({ type: 'result', text: full.trim(), segments: toSegments(chunks) });
};

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'load') setUiLang(request.lang);
  const done = request.type === 'load' ? load(request.model) : transcribe(request.audio, request.language);

  done.catch((error: unknown) => {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});
