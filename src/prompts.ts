/**
 * The instructions the summary engine gets. They live apart from `summary.ts` because the settings window
 * shows them for editing, and the renderer cannot import a module that pulls in node:child_process.
 *
 * They are written in English on purpose: the interface may be translated one day, and the answer must follow the
 * recording, not the instruction. Hence the rule about the source language in both of them — keep it in any edit.
 */

export type AiTask = 'summary' | 'chapters';

export const SUMMARY_PROMPT = [
  'Below is a transcript of a video or an audio recording.',
  'Summarise it in the language the transcript itself is written in — never in the language of these instructions.',
  '',
  'Shape of the answer:',
  '1. One sentence on what this is about as a whole.',
  '2. The key points as a list — substance only, no filler.',
  '3. If the text holds agreements, tasks or next steps, add them as a separate list under a short heading of',
  '   its own, written in the same language as the rest.',
  '',
  'Lists and paragraphs only: no tables and no checkboxes — the window renders neither.',
  'Rely on the text alone and invent nothing. No preamble such as "here is the summary".',
].join('\n');

// The transcript arrives as `[timecode] sentence` lines, one per subtitle.
export const CHAPTERS_PROMPT = [
  'Below is a transcript of a video where every line starts with a timecode.',
  'Turn it into a list of chapters: one line each, formatted "00:00 - Title".',
  'Write the titles in the language the transcript itself is written in — never in the language of these',
  'instructions.',
  '',
  'Rules:',
  '- One chapter per real change of subject, on average one every 3 to 30 minutes. Chapters are signposts, not',
  '  an outline of every paragraph: when in doubt, make fewer of them.',
  '- Keep a title short, under 70 characters, with no full stop at the end — it has to fit on one line of a',
  '  chat message.',
  '- Take the timecode from the line where the subject starts, and keep the format used in the transcript.',
  '- The first chapter is always 00:00 — without it YouTube shows no chapters at all.',
  '- Chapters in ascending order of timecode, no repeats.',
  '',
  'Rely on the text alone and invent nothing. Output nothing but the list itself: no preamble, no explanations.',
].join('\n');

export type Prompts = Record<AiTask, string>;

export const DEFAULT_PROMPTS: Prompts = { summary: SUMMARY_PROMPT, chapters: CHAPTERS_PROMPT };

/** Where an edited prompt is kept. What the settings window calls it lives in i18n.ts, keyed by the same task. */
export const PROMPT_FIELDS: { task: AiTask; key: string }[] = [
  { task: 'summary', key: 'prompt.summary' },
  { task: 'chapters', key: 'prompt.chapters' },
];

// A prompt longer than this is a mistake, not a prompt; main refuses it and falls back to the default.
export const MAX_PROMPT = 8000;
