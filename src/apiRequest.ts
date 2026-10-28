/**
 * One POST to the OpenAI-compatible API from the settings — the summary and the transcription both go through
 * here, so the key, the timeout, the redirect fence and the error wording live in one place. Main only.
 */
import { net } from 'electron';
import { aiKey, aiSettings } from './aiSettings';
import { errorDetail } from './api';
import { t } from './i18n';

// A summary reads the whole transcript, a transcription uploads ten minutes of audio: either is a long wait.
export const TIMEOUT_MS = 300_000;
// A summary is a few kilobytes and a verbose_json for ten minutes a few hundred; anything near this is broken.
const MAX_REPLY = 8 * 1024 * 1024;

// The window runs one task at a time (`job` is a single union), so one handle is all the cancelling needs.
let request: AbortController | null = null;

/** Drops the request in flight, if any; its caller rejects and the window ignores that. */
export const cancelApi = (): void => {
  request?.abort();
  request = null;
};

/**
 * Posts `body` to `{baseUrl}{path}` with the stored key and answers with the parsed JSON (null when the body is
 * not JSON). A string goes as JSON, a FormData as multipart. Anything that goes wrong is a readable message.
 */
export const postApi = async (path: string, body: string | FormData): Promise<unknown> => {
  const { baseUrl } = aiSettings();
  if (!baseUrl) throw new Error(t().error.apiIncomplete); // engines.json edited by hand, or half-written
  const key = aiKey();
  const cancel = new AbortController();
  request = cancel;
  const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(TIMEOUT_MS)]);

  try {
    let response: Response;
    try {
      // net.fetch, not Node's fetch: Chromium's stack, so the system proxy settings apply.
      response = await net.fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          ...(typeof body === 'string' && { 'content-type': 'application/json' }),
          ...(key !== null && { authorization: `Bearer ${key}` }),
        },
        body,
        // An API does not redirect a POST; a server that tries is not getting the key and the content elsewhere.
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

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null; // the callers' readers turn a body that is not JSON into the same «no text» as an empty one
    }
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
