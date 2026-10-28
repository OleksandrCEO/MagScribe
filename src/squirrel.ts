/**
 * Squirrel.Windows runs the freshly installed exe with `--squirrel-install` (or `-updated`, `-uninstall`,
 * `-obsolete`) and gives it 15 seconds. We answer with the Start menu and desktop shortcuts — all that
 * electron-squirrel-startup did — and with the `magscribe` command: `bin\magscribe.cmd` in the install root,
 * on the user's PATH. A .cmd, not the exe itself, because cmd waits for a program a batch file starts, which it
 * does not for a bare GUI exe: a script gets the transcript before its next line runs.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { systemTool } from './executables';

// Adds `$env:MAGSCRIBE_BIN` to the user's Path or takes it out, keeping the entries as they were written:
// .NET's own Get/SetEnvironmentVariable would expand every %VAR% in the list and save it as a plain string.
// Setting a variable through .NET afterwards is what broadcasts the change, so new terminals see it.
const EDIT_PATH = `
$d = $env:MAGSCRIBE_BIN
$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$old = [string]$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
$parts = @($old -split ';' | Where-Object { $_ -and $_ -ne $d })
if ($env:MAGSCRIBE_ADD -eq '1') { $parts += $d }
$new = $parts -join ';'
if ($new -ne $old) {
  $k.SetValue('Path', $new, 'ExpandString')
  [Environment]::SetEnvironmentVariable('MAGSCRIBE_PATH_CHANGED', '1', 'User')
  [Environment]::SetEnvironmentVariable('MAGSCRIBE_PATH_CHANGED', $null, 'User')
}`;

/** Resolves when the program has exited, whatever it exited with: a failed step must not keep the others back. */
const run = (file: string, args: string[], extra: Record<string, string> = {}): Promise<void> =>
  new Promise((resolve) => {
    const child = spawn(file, args, { stdio: 'ignore', env: { ...process.env, ...extra } });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });

const editPath = (bin: string, add: boolean): Promise<void> =>
  run(
    systemTool('WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(EDIT_PATH, 'utf16le').toString('base64')],
    { MAGSCRIBE_BIN: bin, MAGSCRIBE_ADD: add ? '1' : '0' },
  );

/** True when this launch is a Squirrel event: the app then does its part, quits, and opens no window. */
export const handleSquirrel = (): boolean => {
  const event = process.platform === 'win32' ? process.argv[1] : undefined;
  const root = path.resolve(path.dirname(process.execPath), '..'); // the app runs from <root>\app-<version>
  const update = path.join(root, 'Update.exe');
  const exe = path.basename(process.execPath);
  const bin = path.join(root, 'bin');

  let steps: Promise<unknown>[];
  if (event === '--squirrel-install' || event === '--squirrel-updated') {
    // Relative to the .cmd, so the user's own folder names never pass through cmd's parsing.
    const target = path.relative(bin, process.execPath);
    steps = [run(update, [`--createShortcut=${exe}`])];
    try {
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'magscribe.cmd'), `@"%~dp0${target}" %*\r\n`);
      steps.push(editPath(bin, true));
    } catch {
      // no command then; the app itself is installed all the same
    }
  } else if (event === '--squirrel-uninstall') {
    steps = [run(update, [`--removeShortcut=${exe}`]), editPath(bin, false)];
  } else if (event === '--squirrel-obsolete') {
    steps = [];
  } else {
    return false;
  }
  void Promise.all(steps).finally(() => app.quit());
  return true;
};
