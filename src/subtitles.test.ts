import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClock, timecode, toSegments, toSrt, toTimedText } from './subtitles.ts';
import { STRINGS } from './i18n.ts';

// Everything here is a pure function over numbers and strings: no media file, no model, no fixtures. These are
// the places where a bug is silent and expensive — a timecode off by a digit still looks like a timecode.

test('timecode drops the hours until there are any', () => {
  assert.equal(timecode(0), '00:00');
  assert.equal(timecode(9), '00:09');
  assert.equal(timecode(90), '01:30');
  assert.equal(timecode(599), '09:59');
  assert.equal(timecode(3600), '1:00:00');
  assert.equal(timecode(3661), '1:01:01');
  assert.equal(timecode(45296), '12:34:56');
});

test('timecode floors and never goes negative', () => {
  assert.equal(timecode(59.999), '00:59'); // a cue that starts at 59.999 must not be announced as the minute
  assert.equal(timecode(-5), '00:00');
});

test('srt keeps two-digit hours, a comma, and three digits of milliseconds', () => {
  assert.equal(
    toSrt([{ start: 0, end: 1.5, text: 'Привіт' }]),
    '1\n00:00:00,000 --> 00:00:01,500\nПривіт\n',
  );
  assert.equal(
    toSrt([{ start: 3661.5, end: 3662, text: 'Hour' }]),
    '1\n01:01:01,500 --> 01:01:02,000\nHour\n',
  );
});

test('srt caps the milliseconds instead of carrying them into a fourth digit', () => {
  // 999.6 ms rounds to 1000, which would read as «,1000» and break every player that parses the field.
  assert.match(toSrt([{ start: 0.9996, end: 2, text: 'x' }]), /^1\n00:00:00,999 --> /);
});

test('srt numbers the cues from one and separates them with a blank line', () => {
  const srt = toSrt([
    { start: 0, end: 1, text: 'one' },
    { start: 1, end: 2, text: 'two' },
  ]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,000\none\n\n2\n00:00:01,000 --> 00:00:02,000\ntwo\n');
});

test('toSegments closes a chunk Whisper left open with the next one', () => {
  const segments = toSegments([
    { timestamp: [0, null], text: ' перший ' },
    { timestamp: [4, 6], text: 'другий' },
  ]);
  assert.deepEqual(segments, [
    { start: 0, end: 4, text: 'перший' },
    { start: 4, end: 6, text: 'другий' },
  ]);
});

test('toSegments gives the last open chunk a minimum length', () => {
  const [last] = toSegments([{ timestamp: [10, null], text: 'tail' }]);
  assert.equal(last.start, 10);
  assert.ok(last.end > last.start, 'a cue must not end before it starts');
});

test('toSegments drops what cannot become a subtitle', () => {
  assert.deepEqual(toSegments([{ timestamp: [null, null], text: 'no start' }]), []);
  assert.deepEqual(toSegments([{ timestamp: [0, 1], text: '   ' }]), []);
});

test('toSegments keeps an end that is not after the start out of the output', () => {
  const [only] = toSegments([{ timestamp: [5, 5], text: 'same' }]);
  assert.ok(only.end > 5);
});

test('parseClock reads what ffmpeg prints in its Duration banner', () => {
  assert.equal(parseClock('00:01:23.45'), 83.45);
  assert.equal(parseClock('01:00:00.00'), 3600);
  assert.equal(parseClock('00:00:00.00'), 0);
});

test('toTimedText is one timecoded line per cue', () => {
  const text = toTimedText([
    { start: 0, end: 2, text: 'Привіт' },
    { start: 3665, end: 3670, text: 'Пізніше' },
  ]);
  assert.equal(text, '[00:00] Привіт\n[1:01:05] Пізніше');
});

test('Ukrainian counts in all three forms, English in two', () => {
  assert.equal(STRINGS.uk.words(1), '1 слово');
  assert.equal(STRINGS.uk.words(2), '2 слова');
  assert.equal(STRINGS.uk.words(5), '5 слів');
  assert.equal(STRINGS.uk.words(11), '11 слів'); // the trap: 11 takes «слів», 21 takes «слово»
  assert.equal(STRINGS.uk.words(21), '21 слово');
  assert.equal(STRINGS.en.words(1), '1 word');
  assert.equal(STRINGS.en.words(2), '2 words');
});

test('both languages answer every key', () => {
  // `en: typeof uk` already makes a missing key a type error; this catches an empty one.
  const flatten = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : typeof value === 'function'
        ? [String((value as (...args: never[]) => string)(1 as never, 'x' as never))]
        : Array.isArray(value) || (typeof value === 'object' && value !== null)
          ? Object.values(value as object).flatMap(flatten)
          : [];

  for (const [lang, strings] of Object.entries(STRINGS)) {
    for (const line of flatten(strings)) assert.ok(line.trim().length > 0, `${lang} has an empty line`);
  }
});
