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

export type WorkerRequest = { type: 'load' } | { type: 'transcribe'; audio: Float32Array };

export type WorkerResponse =
  | { type: 'download'; progress: number } // model download, 0..100
  | { type: 'fallback'; from: Device; reason: string }
  | { type: 'ready'; device: Device }
  | { type: 'progress'; progress: number } // transcription, 0..100
  | { type: 'result'; text: string }
  | { type: 'error'; message: string };

// Quantisation per this checkpoint's model card: fp16 encoder + q4 decoder on WebGPU. Not every adapter
// implements shader-f16 though (NVIDIA under Vulkan does not), and the fp32 encoder keeps its weights in a
// 2.5 GB side file, so without fp16 the encoder goes 4-bit as well — 425 MB, and the same MatMulNBits path
// the decoder already uses. On wasm both halves are 4-bit too: q8 weights of this model fail to load in
// onnxruntime-web with a missing-scale error.
const deviceOptions = async (device: Device) => {
  if (device === 'wasm') return { device, dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' } } as const;

  const adapter = await navigator.gpu.requestAdapter();
  const fp16 = adapter?.features.has('shader-f16') ?? false;
  return { device, dtype: { encoder_model: fp16 ? 'fp16' : 'q4', decoder_model_merged: 'q4' } } as const;
};

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
        ...(await deviceOptions(device)),
        progress_callback: reportDownload,
      });
      post({ type: 'ready', device });
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (device === devices.at(-1)) throw new Error(`${device}: ${reason}`);
      post({ type: 'fallback', from: device, reason });
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
