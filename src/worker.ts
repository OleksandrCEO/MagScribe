/// <reference lib="webworker" />
/// <reference types="@webgpu/types" />
import {
  pipeline,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/whisper-large-v3-turbo';
const SAMPLE_RATE = 16_000;
const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;

export type Device = 'webgpu' | 'wasm';

// null lets Whisper detect the language itself, per 30-second chunk.
export type Language = 'uk' | 'en' | null;

/** One timestamped piece of speech — a subtitle line, and the unit the chapter prompt reads. */
export type Segment = { start: number; end: number; text: string };

export type WorkerRequest = { type: 'load' } | { type: 'transcribe'; audio: Float32Array; language: Language };

export type WorkerResponse =
  | { type: 'download'; progress: number } // model download, 0..100
  | { type: 'fallback'; from: Device; reason: string }
  | { type: 'ready'; adapter: string; encoder: string } // what the model really runs on, for the status line
  | { type: 'progress'; progress: number } // transcription, 0..100
  | { type: 'partial'; text: string } // text so far, so the first chunk is not a silent wait
  | { type: 'result'; text: string; segments: Segment[] }
  | { type: 'error'; message: string };

// Quantisation per this checkpoint's model card: fp16 encoder + q4 decoder on WebGPU; without shader-f16 the
// encoder goes 4-bit too, because the fp32 encoder keeps its weights in a 2.5 GB side file. On wasm both halves
// are 4-bit: the int8 decoder fails to load there with a missing scale. The int8-vs-q4 timings in the git history
// were taken on SwiftShader, not on a GPU, so treat them as CPU numbers.
type Dtype = Record<'encoder_model' | 'decoder_model_merged', 'fp16' | 'q4'>;
const Q4: Dtype = { encoder_model: 'q4', decoder_model_merged: 'q4' };

type Picked = { adapter: string; dtype: Dtype };

// SwiftShader is the software Vulkan that ships inside Electron. It answers requestAdapter() like a real card, so
// without this check the app said "WebGPU" for weeks while every matmul ran on the CPU inside the GPU process.
// Refusing it drops us to wasm, which is just as slow but tells the truth in the status line.
const SOFTWARE_ADAPTER = /swiftshader|llvmpipe|lavapipe|warp/i;

const pickWebGpu = async (): Promise<Picked> => {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('requestAdapter() повернув null');

  const { vendor, architecture, description, isFallbackAdapter } = adapter.info;
  const label = [vendor, architecture].filter(Boolean).join(' ') || description || 'невідомий адаптер';
  if (isFallbackAdapter || SOFTWARE_ADAPTER.test(`${vendor} ${architecture} ${description}`)) {
    throw new Error(`програмний адаптер «${label}» замість відеокарти`);
  }

  const fp16 = adapter.features.has('shader-f16');
  return { adapter: `WebGPU · ${label}`, dtype: fp16 ? { ...Q4, encoder_model: 'fp16' } : Q4 };
};

// The tokenizer types the pair as two numbers, but it really leaves the end (sometimes both ends) null on a
// chunk it never closed — hence the wider type here and the normalisation below.
type Chunk = { timestamp: (number | null)[]; text: string };

const MIN_SEGMENT_S = 1.2; // what an unclosed last chunk gets, so no subtitle ends before it starts

const toSegments = (chunks: Chunk[]): Segment[] =>
  chunks.flatMap(({ timestamp: [start, end], text }, index): Segment[] => {
    const trimmed = text.trim();
    if (typeof start !== 'number' || trimmed === '') return [];

    const nextStart = chunks[index + 1]?.timestamp[0];
    const stop = typeof end === 'number' ? end : typeof nextStart === 'number' ? nextStart : 0;
    return [{ start, end: stop > start ? stop : start + MIN_SEGMENT_S, text: trimmed }];
  });

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

const post = (message: WorkerResponse): void => self.postMessage(message);

// The library already aggregates per-file bytes into a single percentage for us.
const reportDownload = (info: ProgressInfo): void => {
  if (info.status === 'progress_total') post({ type: 'download', progress: info.progress });
};

const load = async (): Promise<void> => {
  // WebGPU first; fall through to wasm both when the API is missing and when the backend fails to start.
  const devices: Device[] = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];

  for (const device of devices) {
    try {
      const picked: Picked = device === 'webgpu' ? await pickWebGpu() : { adapter: 'CPU · wasm', dtype: Q4 };
      transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
        device,
        dtype: picked.dtype,
        progress_callback: reportDownload,
      });
      post({ type: 'ready', adapter: picked.adapter, encoder: picked.dtype.encoder_model });
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (device === devices.at(-1)) throw new Error(`${device}: ${reason}`);
      post({ type: 'fallback', from: device, reason });
    }
  }
};

const transcribe = async (audio: Float32Array, language: Language): Promise<void> => {
  if (!transcriber) throw new Error('Модель ще не завантажена');

  // Same window arithmetic the pipeline uses internally, so the percentage matches the real chunk count.
  const window = CHUNK_LENGTH_S * SAMPLE_RATE;
  const jump = (CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S) * SAMPLE_RATE;
  const totalChunks = audio.length > window ? Math.ceil((audio.length - window) / jump) + 1 : 1;
  let finished = 0;

  // The pipeline types its tokenizer as the generic base class; for whisper it really is a WhisperTokenizer.
  const tokenizer = transcriber.tokenizer as ConstructorParameters<typeof WhisperTextStreamer>[0];

  let text = '';

  const streamer = new WhisperTextStreamer(tokenizer, {
    // Chunks take a while, so stream the words out as they are decoded instead of waiting for the chunk.
    callback_function: (piece: string) => {
      text += piece;
      post({ type: 'partial', text });
    },
    // end() runs once per generate() call, and the pipeline calls generate() once per audio chunk
    on_finalize: () => {
      finished += 1;
      post({ type: 'progress', progress: Math.min(100, (finished / totalChunks) * 100) });
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
  const done = request.type === 'load' ? load() : transcribe(request.audio, request.language);

  done.catch((error: unknown) => {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});
