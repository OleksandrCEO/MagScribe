/**
 * Finding and starting the programs the app does not ship: ffmpeg and the claude / codex CLIs, plus the few
 * Windows system tools around them. No electron imports: `npm test` reads this file.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WINDOWS = process.platform === 'win32';

/** A tool from System32 by its full path: a bare `cmd.exe` would be searched for in the cwd first. */
export const systemTool = (...parts: string[]): string =>
  path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', ...parts);

/**
 * The first `name` on PATH that is a runnable file. On Windows every PATHEXT extension is tried, the way the
 * shell looks a command up: `claude` is `claude.exe` from the native installer and `claude.cmd` from npm.
 * Relative PATH entries are skipped — they would resolve against whatever the cwd happens to be.
 */
export const findOnPath = (name: string, env: NodeJS.ProcessEnv = process.env, windows = WINDOWS): string | null => {
  const exts = windows ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext !== '') : [''];
  const paths = windows ? path.win32 : path.posix;
  for (const dir of (env.PATH ?? '').split(paths.delimiter)) {
    if (!paths.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const candidate = paths.join(dir, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // not here, keep looking
      }
    }
  }
  return null;
};

// What cmd.exe passes through untouched: no quotes, no spaces, none of `% ^ & | < > ( ) !`.
const PLAIN_ARG = /^[\w.,:=+/-]+$/;

/**
 * How to start `file`. A Windows .cmd/.bat (what npm installs a CLI as) runs only through cmd.exe, and no quoting
 * survives cmd.exe intact for an argument from the outside — so those take plain constant arguments only, and
 * whatever varies goes on stdin. Anything else is started directly.
 */
export const invocation = (file: string, args: string[]): { file: string; args: string[]; verbatim: boolean } => {
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args, verbatim: false };
  const unsafe = [file, ...args].find((part, index) => (index === 0 ? /["%^!]/.test(part) : !PLAIN_ARG.test(part)));
  if (unsafe !== undefined) throw new Error(`refusing to pass ${unsafe} through cmd.exe`);
  // /s strips the outer quotes and keeps the rest verbatim, so the quoted path survives spaces and `&`.
  return { file: systemTool('cmd.exe'), args: ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`], verbatim: true };
};

/** Stops a child and everything it started: on Windows a .cmd's cmd.exe dies alone and leaves node running. */
export const stopTree = (child: ChildProcess): void => {
  if (!WINDOWS || child.pid === undefined) {
    child.kill();
    return;
  }
  spawn(systemTool('taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () =>
    child.kill(),
  );
};

const PATH_MARK = '__MAGSCRIBE_PATH__';

/** The PATH between the two marks in a shell's output; rc files may print anything around it. */
export const pathFromShell = (output: string): string | null => {
  const parts = output.split(PATH_MARK);
  return parts.length >= 3 && parts[1].trim() !== '' ? parts[1].trim() : null;
};

/**
 * The PATH the user's login shell builds. A macOS app started from Finder or the Dock gets launchd's bare
 * `/usr/bin:/bin:/usr/sbin:/sbin`, which has neither Homebrew's ffmpeg nor the claude / codex CLIs in it.
 * Interactive as well as login, because npm, nvm and the CLIs' own installers add themselves in the rc file.
 * Null when the shell fails, hangs or prints no PATH; the caller then keeps the one it has.
 */
export const loginShellPath = (): string | null => {
  const shell = os.userInfo().shell ?? process.env.SHELL ?? '/bin/zsh';
  try {
    const output = execFileSync(shell, ['-ilc', `printf '${PATH_MARK}%s${PATH_MARK}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return pathFromShell(output);
  } catch {
    return null;
  }
};
