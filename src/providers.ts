/**
 * The presets in the settings window: an address and the models worth suggesting, the first one filled in. Any
 * other model can be typed by hand, and «Локально» takes any address. Model ids and addresses checked against each
 * provider's documentation on 28.10.2026; they change, so this is the file to update. No prices here — they
 * would go stale in the interface.
 */

/** How the suggestion list labels a model: a cheaper or lighter one, or a smarter one. */
export type Tier = 'cheap' | 'light' | 'smart';

export type Provider = { name: string; baseUrl: string; models: { id: string; tier?: Tier }[] };

/** The one transcription preset. Deepgram has a format of its own, so picking it is the speech engine `deepgram`. */
export const DEEPGRAM: Provider = {
  name: 'Deepgram',
  baseUrl: 'https://api.deepgram.com/v1',
  models: [{ id: 'nova-3' }, { id: 'nova-2' }],
};

/** All of these answer the OpenAI-compatible `/chat/completions`. */
export const SUMMARY_PROVIDERS: Provider[] = [
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-6-luna', tier: 'cheap' },
      { id: 'gpt-6.1-terra', tier: 'cheap' },
      { id: 'gpt-6.1-sol', tier: 'smart' },
      { id: 'gpt-6-astra', tier: 'smart' },
    ],
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'openai/gpt-6-luna', tier: 'cheap' },
      { id: 'anthropic/claude-haiku-5.5', tier: 'cheap' },
      { id: 'google/gemini-3.8-flash', tier: 'cheap' },
      { id: 'anthropic/claude-sonnet-5.5', tier: 'smart' },
      { id: 'anthropic/claude-opus-5.5', tier: 'smart' },
    ],
  },
  {
    // The OpenAI compatibility layer is in beta at Google.
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-3.8-flash', tier: 'cheap' },
      { id: 'gemini-3.5-flash-lite', tier: 'cheap' },
      { id: 'gemini-3.1-pro-preview', tier: 'smart' },
    ],
  },
  {
    // Hyphens here, dots at OpenRouter. Anthropic calls this layer one for testing, not long-term production.
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-haiku-5-5', tier: 'cheap' },
      { id: 'claude-sonnet-5-5', tier: 'smart' },
      { id: 'claude-opus-5-5', tier: 'smart' },
    ],
  },
  {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [
      { id: 'mistral-small-latest', tier: 'cheap' },
      { id: 'mistral-medium-latest', tier: 'smart' },
      { id: 'mistral-large-latest', tier: 'smart' },
    ],
  },
];

/**
 * «Локально» for the summary: ollama's address and models. Any other local server (LM Studio, llama.cpp, vLLM) is
 * its own address typed in.
 */
export const LOCAL: Provider = {
  name: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  models: [
    { id: 'gemma4:e4b', tier: 'light' },
    { id: 'llama3.2:3b', tier: 'light' },
    { id: 'gemma4:31b', tier: 'smart' },
    { id: 'gpt-oss:20b', tier: 'smart' },
  ],
};
