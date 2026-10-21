/**
 * What Whisper eats, and the way to produce it without ffmpeg.
 *
 * One definition of the sample rate for all three sides: main decodes with ffmpeg, the worker consumes the
 * samples, and the window falls back to the browser's own decoder when the machine has no ffmpeg.
 */

export const SAMPLE_RATE = 16_000;

// Chromium decodes the whole file into memory before anything is resampled, so this route is for short clips.
// ffmpeg streams and stays the primary one; main refuses to read anything bigger than this for it.
export const MAX_BROWSER_DECODE = 200 * 1024 * 1024;

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
  if (frames === 0) throw new Error('У файлі немає звукової доріжки');

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
