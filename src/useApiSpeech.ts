import { useRef } from 'react';
import { SAMPLE_RATE, splitAtSilence } from '@/pcm';
import type { Segment } from '@/subtitles';
import type { RunHandlers, Transcription } from '@/useWhisper';
import type { Language } from '@/worker';

/**
 * The API transcription engine: the recording is cut at pauses into pieces one request can carry, main sends each
 * one, and their timestamps are moved to where the piece starts. Progress counts finished pieces, and `covered` is
 * where the last one ended, so a stopped run resumes there. No React here: the command line runs it too.
 * `stopped` is asked after every request; null means it said yes.
 */
export const transcribeOverApi = async (
  audio: Float32Array,
  language: Language,
  { onProgress, onPartial }: RunHandlers,
  stopped: () => boolean = () => false,
): Promise<Transcription | null> => {
  const pieces = splitAtSilence(audio);
  const texts: string[] = [];
  const segments: Segment[] = [];
  for (const [index, [start, end]] of pieces.entries()) {
    let piece: Transcription;
    try {
      // slice, not subarray: IPC clones the whole buffer behind a view, i.e. the entire recording every time.
      piece = await window.api.transcribeChunk(audio.slice(start, end), language);
    } catch (error) {
      if (stopped()) return null; // the aborted request, not a failure
      throw error;
    }
    if (stopped()) return null;

    const offset = start / SAMPLE_RATE;
    for (const segment of piece.segments) {
      segments.push({ ...segment, start: segment.start + offset, end: segment.end + offset });
    }
    if (piece.text) texts.push(piece.text);
    onPartial(texts.join(' '));
    onProgress(((index + 1) / pieces.length) * 100, end / SAMPLE_RATE);
  }
  return { text: texts.join(' '), segments };
};

/** `transcribeOverApi` for the window, with the same `transcribe` as `useWhisper` and a stop. */
export function useApiSpeech() {
  const stopped = useRef(false);

  const transcribe = (audio: Float32Array, language: Language, handlers: RunHandlers) => {
    stopped.current = false;
    return transcribeOverApi(audio, language, handlers, () => stopped.current);
  };

  /** Ends the run: the request in flight is aborted and no further piece is sent. */
  const stop = (): void => {
    stopped.current = true;
    window.api.cancelAi();
  };

  return { transcribe, stop };
}
