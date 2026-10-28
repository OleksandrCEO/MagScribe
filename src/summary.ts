import { execFile, type ChildProcess } from 'node:child_process';
import { app, net } from 'electron';
import { aiKey, aiSettings } from './aiSettings';
import { chatRequest, errorDetail, readReply } from './api';
import { t } from './i18n';
import { CHAPTERS_PROMPT, SUMMARY_PROMPT, type AiTask } from './prompts';

// Both prompts read the whole transcript, and an hour of speech is a long read even for a fast model.
const TIMEOUT_MS = 300_000;
// A summary is a few kilobytes; anything near this is a broken server, not an answer.
const MAX_REPLY = 8 * 1024 * 1024;

// The transcript is whatever was in the recording, so it is untrusted text that ends up inside a prompt for an
// agent that owns tools. Two cheap fences, neither of which costs the user anything:
//
// - cwd in the temp folder. `claude -p` loads the hooks from the working directory's .claude/settings.json and
//   connects its .mcp.json servers, with no trust dialog — so the app must not hand it a real project folder,
//   and it inherits Electron's cwd otherwise.
// - the tools a summary has no business touching. (--bare would drop hooks and MCP wholesale, but it also
//   stops reading the OAuth login and demands an API key, so it is not an option for a subscription user.)
const FENCED_OFF = 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task';

// The window runs one task at a time (`job` is a single union), so one handle per engine is all the cancelling needs.
let child: ChildProcess | null = null;
let request: AbortController | null = null;

/** Drops the run the window gave up on. Safe to call when there is none; the window ignores the rejection. */
export const cancelAi = (): void => {
  child?.kill();
  child = null;
  request?.abort();
  request = null;
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
  const { baseUrl, model } = aiSettings();
  if (!baseUrl || !model) throw new Error(t().error.apiIncomplete); // engines.json edited by hand, or half-written
  const key = aiKey();
  const cancel = new AbortController();
  request = cancel;
  const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(TIMEOUT_MS)]);

  try {
    let response: Response;
    try {
      // net.fetch, not Node's fetch: Chromium's stack, so the system proxy settings apply.
      response = await net.fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key !== null && { authorization: `Bearer ${key}` }) },
        body: JSON.stringify(chatRequest(model, prompt, input)),
        // An API does not redirect a POST; a server that tries is not getting the key and the transcript elsewhere.
        redirect: 'error',
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error; // the timeout or the stop, told apart below
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(t().error.apiUnreachable(new URL(baseUrl).host, reason), { cause: error });
    }

    if (Number(response.headers.get('content-length')) > MAX_REPLY) throw new Error(t().error.replyTooBig);
    const text = await response.text();
    if (text.length > MAX_REPLY) throw new Error(t().error.replyTooBig);
    const detail = errorDetail(text);
    if (response.status === 401 || response.status === 403) throw new Error(t().error.apiKeyRejected(detail));
    if (!response.ok) throw new Error(t().error.apiFailed(response.status, detail));

    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // readReply turns a body that is not JSON into the same «no text» as an empty one
    }
    const reply = readReply(body);
    if (reply === null) throw new Error(t().error.apiEmpty);
    return reply;
  } catch (error) {
    // A stop rejects too, and the window drops that one unread; only the timeout needs words.
    if (signal.aborted && !cancel.signal.aborted) {
      throw new Error(t().error.apiTimeout(TIMEOUT_MS / 1000), { cause: error });
    }
    throw error;
  } finally {
    if (request === cancel) request = null;
  }
};

/** Whichever engine the settings window chose, read on every run so a change applies to the next click. */
const runAi = (prompt: string, input: string): Promise<string> =>
  aiSettings().engine === 'api' ? runApi(prompt, input) : runClaude(prompt, input);

/** The two things the model does for us. `prompt` is the one edited in the settings window, if there is one. */
export const AI_TASKS: Record<AiTask, (transcript: string, prompt?: string) => Promise<string>> = {
  summary: (transcript, prompt) => runAi(prompt ?? SUMMARY_PROMPT, transcript),
  chapters: (timedTranscript, prompt) => runAi(prompt ?? CHAPTERS_PROMPT, timedTranscript),
};
