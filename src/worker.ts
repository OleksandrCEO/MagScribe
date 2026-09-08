/// <reference lib="webworker" />
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

export type WorkerRequest = { type: 'load' } | { type: 'transcribe'; audio: Float32Array };

export type WorkerResponse =
  | { type: 'download'; progress: number } // model download, 0..100
  | { type: 'ready'; device: Device }
  | { type: 'progress'; progress: number } // transcription, 0..100
  | { type: 'result'; text: string }
  | { type: 'error'; message: string };

// Quantisation follows this checkpoint's model card: fp16 encoder + q4 decoder on WebGPU,
// int8 throughout on wasm, where fp16 has no hardware to run on.
const DEVICE_OPTIONS = {
  webgpu: { device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' } },
  wasm: { device: 'wasm', dtype: 'q8' },
} as const;

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
      transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
        ...DEVICE_OPTIONS[device],
        progress_callback: reportDownload,
      });
      post({ type: 'ready', device });
      return;
    } catch (error) {
      if (device === devices.at(-1)) throw error;
    }
  }
};

const transcribe = async (audio: Float32Array): Promise<void> => {
  if (!transcriber) throw new Error('Модель ще не завантажена');

  // Same window arithmetic the pipeline uses internally, so the percentage matches the real chunk count.
  const window = CHUNK_LENGTH_S * SAMPLE_RATE;
  const jump = (CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S) * SAMPLE_RATE;
  const totalChunks = audio.length > window ? Math.ceil((audio.length - window) / jump) + 1 : 1;
  let finished = 0;

  // The pipeline types its tokenizer as the generic base class; for whisper it really is a WhisperTokenizer.
  const tokenizer = transcriber.tokenizer as ConstructorParameters<typeof WhisperTextStreamer>[0];

  const streamer = new WhisperTextStreamer(tokenizer, {
    // end() runs once per generate() call, and the pipeline calls generate() once per audio chunk
    on_finalize: () => {
      finished += 1;
      post({ type: 'progress', progress: Math.min(100, (finished / totalChunks) * 100) });
    },
  });

  const output = await transcriber(audio, {
    language: 'uk',
    task: 'transcribe',
    chunk_length_s: CHUNK_LENGTH_S,
    stride_length_s: STRIDE_LENGTH_S,
    streamer,
  });

  post({ type: 'result', text: (Array.isArray(output) ? output[0].text : output.text).trim() });
};

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const done = request.type === 'load' ? load() : transcribe(request.audio);

  done.catch((error: unknown) => {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});
