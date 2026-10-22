import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCli, renderOutput } from './cli.ts';

test('parseCli leaves a window start alone and ignores Chromium switches', () => {
  assert.equal(parseCli(['.', '--force-device-scale-factor=1']), null);
  assert.equal(parseCli(['--help']), 'help');
});

test('parseCli reads a job with defaults and both flag spellings', () => {
  assert.deepEqual(parseCli(['--force-device-scale-factor=1', '--transcribe', 'a.mp4']), {
    file: 'a.mp4',
    format: 'txt',
    language: 'uk',
  });
  assert.deepEqual(parseCli(['--transcribe=a.mp4', '--format=srt', '--lang', 'auto']), {
    file: 'a.mp4',
    format: 'srt',
    language: null,
  });
});

test('parseCli refuses what it does not know', () => {
  assert.equal(typeof parseCli(['--transcribe', 'a.mp4', '--format', 'vtt']), 'string');
  assert.equal(typeof parseCli(['--transcribe', 'a.mp4', '--lang', 'toString']), 'string');
  assert.equal(typeof parseCli(['--transcribe']), 'string');
  assert.equal(typeof parseCli(['--format', 'srt']), 'string');
});

test('renderOutput ends every format with a newline', () => {
  const segments = [{ start: 0, end: 1.5, text: 'Привіт' }];
  assert.equal(renderOutput('txt', 'Привіт', segments), 'Привіт\n');
  assert.equal(renderOutput('timed', 'Привіт', segments), '[00:00] Привіт\n');
  assert.equal(renderOutput('srt', 'Привіт', segments), '1\n00:00:00,000 --> 00:00:01,500\nПривіт\n');
});
