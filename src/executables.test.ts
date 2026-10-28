import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findOnPath, invocation, pathFromShell } from './executables.ts';

test('findOnPath takes the first runnable file and skips the rest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magscribe-path-'));
  const [plain, dir, good] = ['plain', 'dir', 'good'].map((name) => path.join(root, name));
  for (const folder of [plain, dir, good]) fs.mkdirSync(folder);
  fs.writeFileSync(path.join(plain, 'tool'), ''); // not executable
  fs.mkdirSync(path.join(dir, 'tool')); // executable bit, but a folder
  fs.writeFileSync(path.join(good, 'tool'), '', { mode: 0o755 });
  try {
    const PATH = ['relative', '', plain, dir, good].join(':');
    assert.equal(findOnPath('tool', { PATH }, false), path.join(good, 'tool'));
    assert.equal(findOnPath('tool', { PATH: `relative:${plain}` }, false), null);
    assert.equal(findOnPath('tool', {}, false), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invocation starts an exe as it is and a .cmd through cmd.exe with plain arguments only', () => {
  assert.deepEqual(invocation('C:\\bin\\claude.exe', ['-p', 'any "text" & more']), {
    file: 'C:\\bin\\claude.exe',
    args: ['-p', 'any "text" & more'],
    verbatim: false,
  });
  const cmd = invocation('C:\\Users\\A & B\\npm\\codex.CMD', ['exec', '--sandbox', 'read-only', '-']);
  assert.equal(cmd.verbatim, true);
  assert.match(cmd.file, /cmd\.exe$/);
  assert.deepEqual(cmd.args, ['/d', '/s', '/c', '""C:\\Users\\A & B\\npm\\codex.CMD" exec --sandbox read-only -"']);
  assert.throws(() => invocation('C:\\npm\\claude.cmd', ['-p', 'two words']));
  assert.throws(() => invocation('C:\\npm\\claude.cmd', ['%PATH%']));
  assert.throws(() => invocation('C:\\100%\\claude.cmd', ['-p']));
});

test('pathFromShell finds the PATH between the marks, whatever the rc files printed', () => {
  const output = 'welcome!\n__MAGSCRIBE_PATH__/opt/homebrew/bin:/usr/bin__MAGSCRIBE_PATH__';
  assert.equal(pathFromShell(output), '/opt/homebrew/bin:/usr/bin');
  assert.equal(pathFromShell('__MAGSCRIBE_PATH____MAGSCRIBE_PATH__'), null);
  assert.equal(pathFromShell('no marks at all'), null);
});
