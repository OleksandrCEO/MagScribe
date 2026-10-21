/**
 * The instructions the local `claude` CLI gets. They live apart from `summary.ts` because the settings window
 * shows them for editing, and the renderer cannot import a module that pulls in node:child_process.
 */

export type AiTask = 'summary' | 'chapters';

export const SUMMARY_PROMPT = [
  'Нижче транскрипт відео або аудіо. Зроби стислий конспект українською мовою у такому вигляді:',
  '',
  '1. Одне речення про те, про що це загалом.',
  '2. Ключові тези списком — по суті, без води.',
  '3. Якщо в тексті є домовленості, задачі чи наступні кроки — окремим списком «Далі:».',
  '',
  'Спирайся лише на текст, нічого не додумуй. Без преамбул на кшталт «ось конспект».',
].join('\n');

// The transcript arrives as `[таймкод] речення` lines, one per subtitle.
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

export type Prompts = Record<AiTask, string>;

export const DEFAULT_PROMPTS: Prompts = { summary: SUMMARY_PROMPT, chapters: CHAPTERS_PROMPT };

/** Where an edited prompt is kept, and what the settings window calls it. */
export const PROMPT_FIELDS: { task: AiTask; key: string; label: string }[] = [
  { task: 'summary', key: 'prompt.summary', label: 'Конспект — «Вловити суть»' },
  { task: 'chapters', key: 'prompt.chapters', label: 'Таймкоди — розділи відео' },
];

// A prompt longer than this is a mistake, not a prompt; main refuses it and falls back to the default.
export const MAX_PROMPT = 8000;
