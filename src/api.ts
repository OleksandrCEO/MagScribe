/**
 * The engines' APIs: the OpenAI-compatible request shape (OpenAI, OpenRouter, Gemini, Anthropic, Mistral, ollama,
 * LM Studio, llama.cpp, vLLM) and Deepgram's own for the transcription. Pure functions and types only: main sends
 * the requests (summary.ts, speech.ts) and keeps the settings (aiSettings.ts), the settings window imports the
 * types, and `api.test.ts` covers the rest.
 */
import { t } from './i18n.ts';
import { toSegments, type Segment } from './subtitles.ts';

export const AI_ENGINES = ['claude', 'api'] as const;
export type AiEngine = (typeof AI_ENGINES)[number];
// `api` is any OpenAI-compatible `/audio/transcriptions`; Deepgram speaks a format of its own.
export const SPEECH_ENGINES = ['whisper', 'api', 'deepgram'] as const;
export type SpeechEngine = (typeof SPEECH_ENGINES)[number];
// Each engine has an API of its own — address, model and key — since a provider rarely does both well.
export const API_ROLES = ['speech', 'summary'] as const;
export type ApiRole = (typeof API_ROLES)[number];

/** One API as the window edits it. */
export type Connection = { baseUrl: string; model: string };

type Engines = { engine: AiEngine; speech: SpeechEngine };

/** What the settings window may know: everything but the keys themselves. */
export type AiSettings = Engines & { apis: Record<ApiRole, Connection & { hasKey: boolean }> };

/** What the settings window sends. A `key` left out keeps the stored one, an empty one forgets it. */
export type AiSettingsUpdate = Engines & { apis: Record<ApiRole, Connection & { key?: string }> };

/** What main keeps: the key as safeStorage ciphertext in base64, or null. */
export type StoredApis = Record<ApiRole, Connection & { key: string | null }>;

/** What «Перевірити» found: one entry per API in use, with the error in words or null when it answered. */
export type ApiCheck = { task: ApiRole; error: string | null }[];

/** The APIs these engines call, in the order «Перевірити» tries them. */
export const rolesInUse = ({ engine, speech }: Engines): ApiRole[] =>
  API_ROLES.filter((role) => (role === 'speech' ? speech !== 'whisper' : engine === 'api'));

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

const fieldsOf = (raw: unknown): Record<string, unknown> =>
  (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

/** One API out of an update; `needed` when its engine is on, and then the address and the model must be there. */
const parseConnection = (raw: unknown, needed: boolean): Connection & { key?: string } => {
  const { baseUrl, model, key } = fieldsOf(raw);
  const text = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_FIELD;
  if (!text(baseUrl) || !text(model)) throw new Error('ai:settings: malformed fields');
  // Whitespace inside a key is a paste gone wrong, and a line break would be a header injection.
  if (key !== undefined && (typeof key !== 'string' || key.length > MAX_FIELD || /\s/.test(key.trim()))) {
    throw new Error(t().error.apiKeyMalformed);
  }
  const url = baseUrl.trim() ? parseBaseUrl(baseUrl) : '';
  if (url === null) throw new Error(t().error.apiBadUrl);
  if (needed && (!url || !model.trim())) throw new Error(t().error.apiIncomplete);
  return { baseUrl: url, model: model.trim(), ...(key !== undefined && { key: key.trim() }) };
};

/**
 * Checks what the settings window sent before main stores any of it. The renderer is not trusted with the keys'
 * destinations, so this is the gate, not a convenience. Throws a message the window can show as it is.
 */
export const parseUpdate = (raw: unknown): AiSettingsUpdate => {
  const fields = fieldsOf(raw);
  const engine = AI_ENGINES.find((value) => value === fields.engine);
  if (!engine) throw new Error(`ai:settings: unknown engine ${String(fields.engine)}`);
  const speech = SPEECH_ENGINES.find((value) => value === fields.speech);
  if (!speech) throw new Error(`ai:settings: unknown speech engine ${String(fields.speech)}`);
  const apis = fieldsOf(fields.apis);
  const inUse = rolesInUse({ engine, speech });
  const [speechApi, summaryApi] = API_ROLES.map((role) => parseConnection(apis[role], inUse.includes(role)));
  return { engine, speech, apis: { speech: speechApi, summary: summaryApi } };
};

/**
 * The APIs out of engines.json as it was read, shape-checked. Up to 0.8.7 both engines shared one address and one
 * key, with `model` and `speechModel` side by side: such a file becomes two APIs with that address and that key,
 * so nothing has to be typed again. The ciphertext is copied as it is — the same safeStorage opens both.
 */
export const storedApis = (saved: Record<string, unknown>): StoredApis => {
  const read = (raw: unknown): Connection & { key: string | null } => {
    const { baseUrl, model, key } = fieldsOf(raw);
    return {
      baseUrl: typeof baseUrl === 'string' ? (parseBaseUrl(baseUrl) ?? '') : '',
      model: typeof model === 'string' ? model : '',
      key: typeof key === 'string' ? key : null,
    };
  };
  if (saved.apis !== undefined) {
    const apis = fieldsOf(saved.apis);
    return { speech: read(apis.speech), summary: read(apis.summary) };
  }
  const { baseUrl, key, model, speechModel } = saved;
  return { speech: read({ baseUrl, key, model: speechModel }), summary: read({ baseUrl, key, model }) };
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

// `{ start, end, text }` from either reply, in the shape `toSegments` already cleans up.
const timed = (items: unknown[]): Segment[] => {
  const number = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return toSegments(
    items.map((raw) => {
      const { start, end, text } = fieldsOf(raw);
      return { timestamp: [number(start), number(end)], text: typeof text === 'string' ? text : '' };
    }),
  );
};

/**
 * The segments out of a `verbose_json` transcription — OpenAI's `whisper-1` sends them. Null when the body has no
 * `segments` list: a model that only does `json` (gpt-4o-transcribe) or a server that ignored the format, and
 * without timestamps there are no subtitles and no chapters.
 */
export const readSegments = (body: unknown): Segment[] | null => {
  const { segments } = fieldsOf(body);
  return Array.isArray(segments) ? timed(segments) : null;
};

/** Deepgram's path for a recording: the model, the language (or detection), sentences with their timestamps. */
export const deepgramPath = (model: string, language: string | null): string => {
  const query = new URLSearchParams({ model, smart_format: 'true', paragraphs: 'true' });
  if (language) query.set('language', language);
  else query.set('detect_language', 'true');
  return `/listen?${query}`;
};

/**
 * Segments out of a Deepgram reply: the sentences of its paragraphs, each with a start and an end. An empty
 * transcript (silence) is no segments; anything else without paragraphs is not a reply we can use — null.
 */
export const readDeepgram = (body: unknown): Segment[] | null => {
  const channels = fieldsOf(fieldsOf(body).results).channels;
  const alternatives = Array.isArray(channels) ? fieldsOf(channels[0]).alternatives : undefined;
  if (!Array.isArray(alternatives) || typeof alternatives[0] !== 'object' || alternatives[0] === null) return null;
  const { transcript, paragraphs } = fieldsOf(alternatives[0]);
  const list = fieldsOf(paragraphs).paragraphs;
  if (!Array.isArray(list)) return typeof transcript === 'string' && !transcript.trim() ? [] : null;
  return timed(list.flatMap((paragraph) => {
    const { sentences } = fieldsOf(paragraph);
    return Array.isArray(sentences) ? (sentences as unknown[]) : [];
  }));
};

// A provider's explanation is one sentence; a whole HTML error page is not worth a toast.
const MAX_DETAIL = 300;

/**
 * The provider's own words about a failed request: OpenAI's `{ error: { message } }` (Anthropic and Mistral use
 * it too), Gemini's same object inside a list, Deepgram's `err_msg` or `message` — or else the raw text.
 */
export const errorDetail = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as unknown;
    const body = fieldsOf(Array.isArray(parsed) ? parsed[0] : parsed);
    const { error } = body;
    const message = typeof error === 'string' ? error : (fieldsOf(error).message ?? body.err_msg ?? body.message);
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, MAX_DETAIL);
  } catch {
    // not JSON: the text itself is the best there is
  }
  return text.trim().slice(0, MAX_DETAIL);
};
