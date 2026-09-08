import { execFile } from 'node:child_process';

// The whole instruction the summariser gets — change it here, the transcript itself arrives on stdin.
export const SUMMARY_PROMPT = [
  'Нижче транскрипт відео або аудіо. Зроби стислу вижимку українською мовою у такому вигляді:',
  '',
  '1. Одне речення про те, про що це загалом.',
  '2. Ключові тези списком — по суті, без води.',
  '3. Якщо в тексті є домовленості, задачі чи наступні кроки — окремим списком «Далі:».',
  '',
  'Спирайся лише на текст, нічого не додумуй. Без преамбул на кшталт «ось вижимка».',
].join('\n');

const TIMEOUT_MS = 120_000;

/** Runs the local `claude` CLI over a transcript. Anything that goes wrong comes back as a readable message. */
export const summarize = (transcript: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const claude = execFile(
      'claude',
      ['-p', SUMMARY_PROMPT],
      { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout.trim());
          return;
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('Команду claude не знайдено. Встанови Claude Code CLI і перевір, що вона є у PATH.'));
          return;
        }
        if (error.killed) {
          reject(new Error('claude не вклався у 120 секунд'));
          return;
        }
        reject(new Error(stderr.trim() || error.message));
      },
    );

    claude.stdin?.end(transcript);
  });
