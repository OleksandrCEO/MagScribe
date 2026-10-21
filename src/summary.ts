import { execFile } from 'node:child_process';
import { CHAPTERS_PROMPT, SUMMARY_PROMPT, type AiTask } from './prompts';

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

/** The two things the model does for us. `prompt` is the one edited in the settings window, if there is one. */
export const AI_TASKS: Record<AiTask, (transcript: string, prompt?: string) => Promise<string>> = {
  summary: (transcript, prompt) => runClaude(prompt ?? SUMMARY_PROMPT, transcript),
  chapters: (timedTranscript, prompt) => runClaude(prompt ?? CHAPTERS_PROMPT, timedTranscript),
};
