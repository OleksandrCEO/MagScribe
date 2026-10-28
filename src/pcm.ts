/**
 * What Whisper eats, and the way to produce it without ffmpeg.
 *
 * One definition of the sample rate for all three sides: main decodes with ffmpeg, the worker consumes the
 * samples, and the window falls back to the browser's own decoder when the machine has no ffmpeg.
 */
// The extension is for node: `npm test` runs this module directly, and its type stripping resolves no
// extensionless paths. The bundlers do not care either way — see src/pcm.test.ts.
import { t } from './i18n.ts';

export const SAMPLE_RATE = 16_000;

// Chromium decodes the whole file into memory before anything is resampled, so this route is for short clips.
// ffmpeg streams and stays the primary one; main refuses to read anything bigger than this for it.
export const MAX_BROWSER_DECODE = 200 * 1024 * 1024;

/** Bytes a second of decoded audio takes: 16 000 samples of four bytes, about 230 MB per hour. */
export const BYTES_PER_SECOND = SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT;

/**
 * Whether a recording of this length can be decoded without running the machine out of memory.
 *
 * The samples exist twice at the same moment: the buffer main decodes into, and the structured clone the
 * window receives before it transfers them on to the worker. Half of what is free is the share this one job
 * may take — the rest is the model, the browser and whatever else the person is doing. A machine with plenty
 * of memory never meets this; a 4 GB one with a three-hour file does, and it should hear so before it spends
 * ten minutes decoding into a crash.
 */
export const fitsInMemory = (seconds: number, freeBytes: number): boolean =>
  seconds * BYTES_PER_SECOND * 2 < freeBytes * 0.5;

/**
 * Decodes a media file into 16 kHz mono samples using the browser's own decoder.
 *
 * Measured on this Chromium: mp3, flac, mp4, mov and even mkv come back decoded (wav, ogg/opus, m4a and webm
 * are the same decoders); avi and wmv reject with `EncodingError: Unable to decode audio data`, and the window
 * then says that this file needs ffmpeg. Note that decodeAudioData already resamples to the context's rate, so
 * the render below is usually a pass-through — it is there to guarantee 16 kHz mono whatever the engine does.
 */
export const decodeInBrowser = async (bytes: Uint8Array): Promise<Float32Array> => {
  // decodeAudioData takes an ArrayBuffer and detaches it; a view that does not span its whole buffer has to be
  // copied out first, which an IPC-delivered array usually does not need.
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  const input = whole ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  // An offline context decodes without opening an output device. The length is a placeholder: nothing renders.
  const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(input as ArrayBuffer);
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  if (frames === 0) throw new Error(t().error.noAudioTrack);

  // One render does both jobs: a buffer of any rate played into a 16 kHz context is resampled, and a source of
  // any channel count connected to a mono destination is downmixed.
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  // Copied out: the view belongs to an AudioBuffer we are about to drop, and the worker transfers what it gets.
  return new Float32Array((await offline.startRendering()).getChannelData(0));
};

/**
 * How long one request to a transcription API may be. Ten minutes of WAV is ~19 MB, under the 25 MB OpenAI and
 * Groq take per file, and the same piece as Opus is ~2 MB.
 */
export const API_CHUNK_S = 600;
const SEARCH_S = 30; // how far back from the limit a cut looks for a pause
const FRAME = SAMPLE_RATE / 10; // the pause is found in tenths of a second

/**
 * Where to cut a recording into pieces of at most `maxSeconds`: each cut lands in the quietest tenth of a second
 * among the last `SEARCH_S` before the limit, so no word is split between two requests. Returns [start, end)
 * sample pairs that cover the whole recording in order.
 */
export const splitAtSilence = (samples: Float32Array, maxSeconds = API_CHUNK_S): [number, number][] => {
  const max = Math.floor(maxSeconds * SAMPLE_RATE);
  const pieces: [number, number][] = [];
  let start = 0;
  while (samples.length - start > max) {
    let cut = start + max;
    let quietest = Infinity;
    const earliest = Math.max(start + 1, start + max - SEARCH_S * SAMPLE_RATE);
    for (let frame = start + max - FRAME; frame >= earliest; frame -= FRAME) {
      let energy = 0;
      for (let i = frame; i < frame + FRAME; i++) energy += samples[i] * samples[i];
      if (energy < quietest) {
        quietest = energy;
        cut = frame + FRAME / 2; // the middle of the pause, not its edge
      }
    }
    pieces.push([start, cut]);
    start = cut;
  }
  pieces.push([start, samples.length]);
  return pieces;
};

/** 16-bit PCM WAV of the samples: what every transcription server reads, with or without ffmpeg behind it. */
export const toWav = (samples: Float32Array): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return bytes;
};
