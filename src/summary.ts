import { execFile } from 'node:child_process';

// The whole instruction the summariser gets — change it here, the transcript itself arrives on stdin.
export const SUMMARY_PROMPT = [
  'Нижче транскрипт відео або аудіо. Зроби стислий конспект українською мовою у такому вигляді:',
  '',
  '1. Одне речення про те, про що це загалом.',
  '2. Ключові тези списком — по суті, без води.',
  '3. Якщо в тексті є домовленості, задачі чи наступні кроки — окремим списком «Далі:».',
  '',
  'Спирайся лише на текст, нічого не додумуй. Без преамбул на кшталт «ось конспект».',
].join('\n');

// Same deal for the chapter list; the transcript arrives as `[таймкод] речення` lines, one per subtitle.
export const CHAPTERS_PROMPT = [
  'Нижче транскрипт відео, де кожен рядок починається з таймкоду.',
  'Склади з нього список розділів українською мовою — по рядку на розділ, у форматі «00:00 - Назва».',
  '',
  'Правила:',
  '- Один розділ — одна справжня зміна теми, у середньому кожні 3–7 хвилин.',
  '- Назва коротка, до 70 символів, без крапки в кінці: вона має вміститися в один рядок повідомлення.',
  '- Таймкод бери з рядка, де тема починається, і пиши його в тому ж форматі, що у транскрипті.',
  '- Перший розділ завжди 00:00 — інакше YouTube не покаже розділи взагалі.',
  '- Розділи в порядку зростання таймкоду, без повторів.',
  '',
  'Спирайся лише на текст, нічого не додумуй. Нічого, крім самого списку: без преамбул і пояснень.',
].join('\n');

// Both prompts read the whole transcript, and an hour of speech is a long read even for a fast model.
const TIMEOUT_MS = 300_000;

/** Runs the local `claude` CLI over a transcript. Anything that goes wrong comes back as a readable message. */
const runClaude = (prompt: string, input: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const claude = execFile(
      'claude',
      ['-p', prompt],
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
          reject(new Error(`claude не вклався у ${TIMEOUT_MS / 1000} секунд`));
          return;
        }
        reject(new Error(stderr.trim() || error.message));
      },
    );

    claude.stdin?.end(input);
  });

/** The two things the model does for us; the renderer names one of these keys over IPC. */
export const AI_TASKS = {
  summary: (transcript: string): Promise<string> => runClaude(SUMMARY_PROMPT, transcript),
  chapters: (timedTranscript: string): Promise<string> => runClaude(CHAPTERS_PROMPT, timedTranscript),
};

export type AiTask = keyof typeof AI_TASKS;
