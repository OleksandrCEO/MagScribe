import assert from 'node:assert/strict';
import test from 'node:test';
import { BYTES_PER_SECOND, fitsInMemory } from './pcm.ts';

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
