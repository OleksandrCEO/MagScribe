import { useRef } from 'react';
import { SAMPLE_RATE, splitAtSilence } from '@/pcm';
import type { Segment } from '@/subtitles';
import type { RunHandlers, Transcription } from '@/useWhisper';
import type { Language } from '@/worker';

/**
 * The API transcription engine, with the same `transcribe` as `useWhisper`: the recording is cut at pauses into
 * pieces one request can carry, main sends each one, and their timestamps are moved to where the piece starts.
 * Progress counts finished pieces, and `covered` is where the last one ended, so a stopped run resumes there.
 */
export function useApiSpeech() {
  const stopped = useRef(false);

  const transcribe = async (
    audio: Float32Array,
    language: Language,
    { onProgress, onPartial }: RunHandlers,
  ): Promise<Transcription | null> => {
    stopped.current = false;
    const pieces = splitAtSilence(audio);
    const texts: string[] = [];
    const segments: Segment[] = [];
    for (const [index, [start, end]] of pieces.entries()) {
      let piece: Transcription;
      try {
        // slice, not subarray: IPC clones the whole buffer behind a view, i.e. the entire recording every time.
        piece = await window.api.transcribeChunk(audio.slice(start, end), language);
      } catch (error) {
        if (stopped.current) return null; // the aborted request, not a failure
        throw error;
      }
      if (stopped.current) return null;

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

  /** Ends the run: the request in flight is aborted and no further piece is sent. */
  const stop = (): void => {
    stopped.current = true;
    window.api.cancelAi();
  };

  return { transcribe, stop };
}
