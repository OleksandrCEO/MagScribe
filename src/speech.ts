/**
 * The API transcription engines: one piece of a recording (the window cuts it, see `splitAtSilence`) to the
 * transcription API from the settings, segments back — an OpenAI-compatible `/audio/transcriptions` or Deepgram's
 * `/listen`. Main only — the key never reaches the window.
 */
import { aiSettings } from './aiSettings';
import { deepgramPath, readDeepgram, readSegments } from './api';
import { postApi } from './apiRequest';
import { encodeOpus, ffmpegBinary } from './audio';
import { t } from './i18n';
import { toWav } from './pcm';
import type { Segment } from './subtitles';

export const transcribeApi = async (
  samples: Float32Array,
  language: string | null,
): Promise<{ text: string; segments: Segment[] }> => {
  const { speech, apis } = aiSettings();
  const { model } = apis.speech;
  if (!model) throw new Error(t().error.apiIncomplete);

  // Opus when ffmpeg is here to encode it; WAV, which needs nothing, when it is not.
  const opus = ffmpegBinary() !== null;
  const bytes = opus ? await encodeOpus(samples) : toWav(samples);
  const audio = new Blob([bytes], { type: opus ? 'audio/ogg' : 'audio/wav' });

  let segments: Segment[] | null;
  if (speech === 'deepgram') {
    // Deepgram takes the bare file; the model and the language go in the query.
    segments = readDeepgram(await postApi('speech', deepgramPath(model, language), audio));
  } else {
    const form = new FormData();
    form.append('file', audio, opus ? 'audio.ogg' : 'audio.wav');
    form.append('model', model);
    form.append('response_format', 'verbose_json'); // the only format with timestamps
    if (language) form.append('language', language);
    segments = readSegments(await postApi('speech', '/audio/transcriptions', form));
  }
  if (segments === null) throw new Error(t().error.noTimestamps(model));
  return { text: segments.map((segment) => segment.text).join(' '), segments };
};
