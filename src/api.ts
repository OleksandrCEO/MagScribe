/**
 * The OpenAI-compatible chat API — one request shape that OpenAI, OpenRouter, Groq, DeepSeek, ollama, LM Studio,
 * llama.cpp and vLLM all answer. Pure functions and types only: main sends the request (summary.ts) and keeps the
 * settings (aiSettings.ts), the settings window imports the types, and `api.test.ts` covers the rest.
 */
import { t } from './i18n.ts';

export const AI_ENGINES = ['claude', 'api'] as const;
export type AiEngine = (typeof AI_ENGINES)[number];

/** What the settings window may know: everything but the key itself. */
export type AiSettings = { engine: AiEngine; baseUrl: string; model: string; hasKey: boolean };

/** What the settings window sends. `key` left out keeps the stored one, an empty one forgets it. */
export type AiSettingsUpdate = { engine: AiEngine; baseUrl: string; model: string; key?: string };

// Long enough for any real URL, model id or key; anything longer is not one of those.
const MAX_FIELD = 500;

// Plain http is fine for a server on this machine and nowhere else: the request carries the key and the transcript.
// WHATWG URL keeps the brackets around an IPv6 hostname.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A base URL we are willing to send a transcript and a key to, without the trailing slash; null when it is not. */
export const parseBaseUrl = (input: string): string | null => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return null;
  // A login in the URL would end up in error messages; a query or a fragment would break the path appended to it.
  if (url.username || url.password || url.search || url.hash) return null;
  return url.href.replace(/\/+$/, '');
};

/**
 * Checks what the settings window sent before main stores any of it. The renderer is not trusted with the key's
 * destination, so this is the gate, not a convenience. Throws a message the window can show as it is.
 */
export const parseUpdate = (raw: unknown): AiSettingsUpdate => {
  const fields = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const { engine, baseUrl, model, key } = fields;
  const known = AI_ENGINES.find((value) => value === engine);
  if (!known) throw new Error(`ai:settings: unknown engine ${String(engine)}`);
  const text = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_FIELD;
  if (!text(baseUrl) || !text(model)) throw new Error('ai:settings: malformed fields');
  // Whitespace inside a key is a paste gone wrong, and a line break would be a header injection.
  if (key !== undefined && (typeof key !== 'string' || key.length > MAX_FIELD || /\s/.test(key.trim()))) {
    throw new Error(t().error.apiKeyMalformed);
  }

  const url = baseUrl.trim() ? parseBaseUrl(baseUrl) : '';
  if (url === null) throw new Error(t().error.apiBadUrl);
  if (known === 'api' && (!url || !model.trim())) throw new Error(t().error.apiIncomplete);
  return { engine: known, baseUrl: url, model: model.trim(), ...(key !== undefined && { key: key.trim() }) };
};

/** The body of a chat completion: the instruction as the system message, the transcript as the user's. */
export const chatRequest = (model: string, prompt: string, input: string) => ({
  model,
  messages: [
    { role: 'system', content: prompt },
    { role: 'user', content: input },
  ],
});

/** The answer out of a chat completion's JSON, or null when the body is not one or says nothing. */
export const readReply = (body: unknown): string | null => {
  const choices = (body as { choices?: unknown } | null)?.choices;
  const content = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } })?.message?.content : null;
  return typeof content === 'string' && content.trim() ? content.trim() : null;
};

// A provider's explanation is one sentence; a whole HTML error page is not worth a toast.
const MAX_DETAIL = 300;

/** The provider's own words about a failed request: OpenAI's `{ error: { message } }`, or else the raw text. */
export const errorDetail = (text: string): string => {
  try {
    const error = (JSON.parse(text) as { error?: unknown } | null)?.error;
    const message = typeof error === 'string' ? error : (error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, MAX_DETAIL);
  } catch {
    // not JSON: the text itself is the best there is
  }
  return text.trim().slice(0, MAX_DETAIL);
};
