/** One timestamped piece of speech — a subtitle line, and the unit the chapter prompt reads. */
export type Segment = { start: number; end: number; text: string };

/**
 * A pair of timestamps as the tokenizer leaves it. It types them as two numbers, but it really leaves the end
 * (sometimes both ends) null on a chunk it never closed — hence the wider type here.
 */
export type Chunk = { timestamp: (number | null)[]; text: string };

const MIN_SEGMENT_S = 1.2; // what an unclosed last chunk gets, so no subtitle ends before it starts

const pad = (value: number): string => String(value).padStart(2, '0');

/** `00:30` under an hour, `1:10:46` over it — the shape YouTube and Telegram both read as a timecode. */
export const timecode = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  return `${hours > 0 ? `${hours}:` : ''}${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}`;
};

/** `00:00:30,500` — SRT wants two-digit hours and a comma before the milliseconds. */
const srtTime = (seconds: number): string => {
  const clamped = Math.max(0, seconds);
  const whole = Math.floor(clamped);
  const ms = Math.min(999, Math.round((clamped - whole) * 1000)); // capped: 999.6 ms must not become a fourth digit
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)},${String(ms).padStart(3, '0')}`;
};

/** SubRip, the format YouTube, Premiere and VLC all take. Segments come straight from Whisper's own boundaries. */
export const toSrt = (segments: Segment[]): string =>
  `${segments.map(({ start, end, text }, index) => `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`).join('\n\n')}\n`;

/** Whisper's own chunks, normalised into segments: no open ends, no empty lines. */
export const toSegments = (chunks: Chunk[]): Segment[] =>
  chunks.flatMap(({ timestamp: [start, end], text }, index): Segment[] => {
    const trimmed = text.trim();
    if (typeof start !== 'number' || trimmed === '') return [];

    const nextStart = chunks[index + 1]?.timestamp[0];
    const stop = typeof end === 'number' ? end : typeof nextStart === 'number' ? nextStart : 0;
    return [{ start, end: stop > start ? stop : start + MIN_SEGMENT_S, text: trimmed }];
  });

/** `00:01:23.45` → seconds. The shape ffmpeg prints in its `Duration:` banner. */
export const parseClock = (clock: string): number => {
  const [hours, minutes, seconds] = clock.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
};

/** What the chapter prompt reads: one `[timecode] речення` per line. */
export const toTimedText = (segments: Segment[]): string =>
  segments.map(({ start, text }) => `[${timecode(start)}] ${text}`).join('\n');
