import assert from 'node:assert/strict';
import test from 'node:test';
import { BYTES_PER_SECOND, fitsInMemory, SAMPLE_RATE, splitAtSilence, toWav } from './pcm.ts';

const GB = 1024 ** 3;

test('an hour of audio is the ~230 MB the comments promise', () => {
  assert.equal(BYTES_PER_SECOND, 64_000);
  assert.equal(3600 * BYTES_PER_SECOND, 230_400_000); // decimal MB, which is what «230 MB per hour» means
});

test('a long file on a small machine is refused', () => {
  // The case that prompted this: three hours on a 4 GB machine with about 2 GB actually free.
  assert.equal(fitsInMemory(3 * 3600, 2 * GB), false);
});

test('the same file on a roomy machine is allowed', () => {
  assert.equal(fitsInMemory(3 * 3600, 29 * GB), true);
});

test('what is counted is both copies, against half of what is free', () => {
  const seconds = 1000;
  const needed = seconds * BYTES_PER_SECOND * 2;
  assert.equal(fitsInMemory(seconds, needed * 2 + 1), true); // half of free is a hair above what is needed
  assert.equal(fitsInMemory(seconds, needed * 2 - 1), false); // and a hair below it
});

test('a file of no length never trips the check', () => {
  assert.equal(fitsInMemory(0, 1), true);
});

test('splitAtSilence cuts in the pause before the limit and covers every sample', () => {
  // 25 s of tone with a hush at 7–7.5 s; pieces of at most 10 s look back over their last 30 s, i.e. all of it.
  const hush = (i: number): boolean => i >= 7 * SAMPLE_RATE && i < 7.5 * SAMPLE_RATE;
  const samples = new Float32Array(25 * SAMPLE_RATE).map((_, i) => (hush(i) ? 0 : 0.5));
  const pieces = splitAtSilence(samples, 10);
  assert.ok(pieces[0][1] >= 7 * SAMPLE_RATE && pieces[0][1] <= 7.5 * SAMPLE_RATE);
  assert.equal(pieces[0][0], 0);
  assert.equal(pieces.at(-1)?.[1], samples.length);
  for (let i = 1; i < pieces.length; i++) assert.equal(pieces[i][0], pieces[i - 1][1]);
  for (const [start, end] of pieces) assert.ok(end - start <= 10 * SAMPLE_RATE && end > start);
});

test('splitAtSilence leaves a short recording whole', () => {
  assert.deepEqual(splitAtSilence(new Float32Array(SAMPLE_RATE), 10), [[0, SAMPLE_RATE]]);
});

test('toWav writes a 16 kHz mono 16-bit header and clamps the samples', () => {
  const wav = toWav(new Float32Array([0, 2, -2]));
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), SAMPLE_RATE);
  assert.equal(view.getUint32(40, true), 6);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)], [0, 32767, -32767]);
});
