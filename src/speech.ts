/**
 * The API transcription engine: one piece of a recording (the window cuts it, see `splitAtSilence`) to
 * `{baseUrl}/audio/transcriptions`, segments back. Main only — the key never reaches the window.
 */
import { aiSettings } from './aiSettings';
import { readSegments } from './api';
import { postApi } from './apiRequest';
import { encodeOpus, ffmpegBinary } from './audio';
import { t } from './i18n';
import { toWav } from './pcm';
import type { Segment } from './subtitles';

export const transcribeApi = async (
  samples: Float32Array,
  language: string | null,
): Promise<{ text: string; segments: Segment[] }> => {
  const { speechModel } = aiSettings();
  if (!speechModel) throw new Error(t().error.apiIncomplete);

  // Opus when ffmpeg is here to encode it; WAV, which needs nothing, when it is not.
  const opus = ffmpegBinary() !== null;
  const audio = opus ? await encodeOpus(samples) : toWav(samples);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: opus ? 'audio/ogg' : 'audio/wav' }), opus ? 'audio.ogg' : 'audio.wav');
  form.append('model', speechModel);
  form.append('response_format', 'verbose_json'); // the only format with timestamps
  if (language) form.append('language', language);

  const segments = readSegments(await postApi('/audio/transcriptions', form));
  if (segments === null) throw new Error(t().error.noTimestamps(speechModel));
  return { text: segments.map((segment) => segment.text).join(' '), segments };
};
