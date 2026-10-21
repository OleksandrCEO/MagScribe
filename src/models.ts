/**
 * The models the window offers, and what is already on disk.
 *
 * Two of them, for the two machines this app runs on: a real graphics card takes the large one, and everything
 * else — a CPU run through wasm, or a card too small to hold 1.5 GB of weights — takes the small one. The
 * worker loads one at a time; which one is the person's choice, remembered in localStorage.
 *
 * Renderer and worker both import this; keep it free of node, React and electron.
 */

export type ModelId = 'small' | 'turbo';

export const MODEL_IDS: readonly ModelId[] = ['small', 'turbo'];

const MB = 1024 * 1024;

/**
 * Sizes read off the HuggingFace blob list on 21.10.2026, as the pair of files the worker really fetches:
 * `encoder_model_fp16` + `decoder_model_merged_q4` on a card with `shader-f16`, both `q4` everywhere else.
 * They are approximate on purpose — the tokenizer and the configs add a couple of megabytes on top.
 */
export const MODELS: Record<ModelId, { repo: string; name: string; fp16: number; q4: number }> = {
  small: { repo: 'onnx-community/whisper-small', name: 'Whisper small', fp16: 391 * MB, q4: 286 * MB },
  turbo: {
    repo: 'onnx-community/whisper-large-v3-turbo',
    name: 'Whisper large-v3-turbo',
    fp16: 1534 * MB,
    q4: 724 * MB,
  },
};

/** What a download of this model costs here; `fp16` is what the adapter reported, see `gpu.ts`. */
export const modelBytes = (id: ModelId, fp16: boolean): number => (fp16 ? MODELS[id].fp16 : MODELS[id].q4);

/** Where a machine starts: the large model is worth it only on a real card. */
export const recommendedModel = (gpu: boolean): ModelId => (gpu ? 'turbo' : 'small');

/**
 * The weights live in Chromium's Cache Storage (per origin — see CLAUDE.md), one entry per downloaded file,
 * keyed by its URL on huggingface.co. The repository name inside that URL is what tells the models apart.
 */
const cachedUrls = async (): Promise<string[]> => {
  try {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  } catch {
    return []; // no Cache Storage means nothing is cached, which is the honest answer here
  }
};

/** Which models are on disk already, i.e. which of them load without touching the network. */
export const cachedModels = async (): Promise<ModelId[]> => {
  const urls = await cachedUrls();
  return MODEL_IDS.filter((id) => urls.some((url) => url.includes(MODELS[id].repo)));
};

/** Removes one model's files and leaves the other one alone. */
export const deleteModel = async (id: ModelId): Promise<void> => {
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (request.url.includes(MODELS[id].repo)) await cache.delete(request);
    }
  }
};
