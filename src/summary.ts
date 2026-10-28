import { execFile, type ChildProcess } from 'node:child_process';
import { app } from 'electron';
import { aiSettings } from './aiSettings';
import { chatRequest, readReply } from './api';
import { cancelApi, postApi, TIMEOUT_MS } from './apiRequest';
import { t } from './i18n';
import { CHAPTERS_PROMPT, SUMMARY_PROMPT, type AiTask } from './prompts';

// The transcript is whatever was in the recording, so it is untrusted text that ends up inside a prompt for an
// agent that owns tools. Two cheap fences, neither of which costs the user anything:
//
// - cwd in the temp folder. `claude -p` loads the hooks from the working directory's .claude/settings.json and
//   connects its .mcp.json servers, with no trust dialog — so the app must not hand it a real project folder,
//   and it inherits Electron's cwd otherwise.
// - the tools a summary has no business touching. (--bare would drop hooks and MCP wholesale, but it also
//   stops reading the OAuth login and demands an API key, so it is not an option for a subscription user.)
const FENCED_OFF = 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task';

// The window runs one task at a time (`job` is a single union), so one handle is all the cancelling needs.
let child: ChildProcess | null = null;

/** Drops the run the window gave up on — a summary or an API transcription. Safe to call when there is none. */
export const cancelAi = (): void => {
  child?.kill();
  child = null;
  cancelApi();
};

/** Runs the local `claude` CLI over a transcript. Anything that goes wrong comes back as a readable message. */
const runClaude = (prompt: string, input: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const claude = execFile(
      'claude',
      ['-p', prompt, '--disallowed-tools', FENCED_OFF],
      { cwd: app.getPath('temp'), timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        child = null;
        if (!error) {
          resolve(stdout.trim());
          return;
        }
        const { code } = error as NodeJS.ErrnoException;
        if (code === 'ENOENT') {
          reject(new Error(t().error.claudeMissing));
          return;
        }
        // Node kills the child on an oversized stdout too, and `killed` alone would blame the timeout for it.
        if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(new Error(t().error.replyTooBig));
          return;
        }
        if (error.killed) {
          reject(new Error(t().error.claudeTimeout(TIMEOUT_MS / 1000)));
          return;
        }
        reject(new Error(stderr.trim() || error.message));
      },
    );

    child = claude;
    claude.stdin?.end(input);
  });

/** Sends the transcript to the OpenAI-compatible API from the settings. The key never leaves main. */
const runApi = async (prompt: string, input: string): Promise<string> => {
  const { model } = aiSettings();
  if (!model) throw new Error(t().error.apiIncomplete);
  const reply = readReply(await postApi('/chat/completions', JSON.stringify(chatRequest(model, prompt, input))));
  if (reply === null) throw new Error(t().error.apiEmpty);
  return reply;
};

/** Whichever engine the settings window chose, read on every run so a change applies to the next click. */
const runAi = (prompt: string, input: string): Promise<string> =>
  aiSettings().engine === 'api' ? runApi(prompt, input) : runClaude(prompt, input);

/** The two things the model does for us. `prompt` is the one edited in the settings window, if there is one. */
export const AI_TASKS: Record<AiTask, (transcript: string, prompt?: string) => Promise<string>> = {
  summary: (transcript, prompt) => runAi(prompt ?? SUMMARY_PROMPT, transcript),
  chapters: (timedTranscript, prompt) => runAi(prompt ?? CHAPTERS_PROMPT, timedTranscript),
};
