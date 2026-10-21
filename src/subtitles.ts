import type { Segment } from './worker';

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

/** What the chapter prompt reads: one `[timecode] речення` per line. */
export const toTimedText = (segments: Segment[]): string =>
  segments.map(({ start, text }) => `[${timecode(start)}] ${text}`).join('\n');
