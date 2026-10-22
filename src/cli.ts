/**
 * The command line: `magscribe --transcribe <file> [--format txt|srt|timed] [--lang uk|en|auto]`.
 *
 * Only the parsing and the output live here; main.ts runs the job in a hidden window, because the model needs
 * the same Chromium (WebGPU, Cache Storage) the window has. No electron imports: `npm test` reads this file.
 */
import { parseArgs } from 'node:util';
import { toSrt, toTimedText, type Segment } from './subtitles.ts';
import type { Language } from './worker';

export const CLI_FORMATS = ['txt', 'srt', 'timed'] as const;
export type CliFormat = (typeof CLI_FORMATS)[number];

const LANGS: Record<string, Language> = { uk: 'uk', en: 'en', auto: null };

export type CliJob = { file: string; format: CliFormat; language: Language };

/**
 * `null` — no CLI flag at all, so this is an ordinary window start. `help` — print the usage. A string is what
 * is wrong with the arguments. Lenient on purpose: argv also carries Chromium's own switches and, in dev, `.`.
 */
export const parseCli = (argv: string[]): CliJob | 'help' | string | null => {
  const { values } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    options: {
      transcribe: { type: 'string' },
      format: { type: 'string' },
      lang: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help === true) return 'help';
  if (values.transcribe === undefined) {
    return values.format === undefined && values.lang === undefined ? null : '--format and --lang need --transcribe';
  }

  const { transcribe: file, format = 'txt', lang = 'uk' } = values;
  if (typeof file !== 'string' || file === '') return '--transcribe needs a file path';
  if (!CLI_FORMATS.includes(format as CliFormat)) return `unknown --format ${String(format)}`;
  if (typeof lang !== 'string' || !Object.hasOwn(LANGS, lang)) return `unknown --lang ${String(lang)}`;
  return { file, format: format as CliFormat, language: LANGS[lang] };
};

/** What the run prints to stdout, always ending in a newline. */
export const renderOutput = (format: CliFormat, text: string, segments: Segment[]): string => {
  const out = format === 'srt' ? toSrt(segments) : format === 'timed' ? toTimedText(segments) : text;
  return out.endsWith('\n') ? out : `${out}\n`;
};
