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

/** The quantisations we use. The names are the file suffixes on HuggingFace, which is also how `caches` tells them apart. */
export type Quant = 'fp16' | 'q4' | 'int8';

/** One pair of files the worker loads, and what the two of them weigh together. */
export type Weights = { encoder_model: Quant; decoder_model_merged: Quant; bytes: number };

/**
 * Sizes read off the HuggingFace blob list on 21.10.2026, for exactly the pair of files each case fetches;
 * approximate on purpose, since the tokenizer and the configs add a couple of megabytes on top.
 *
 * The quantisation is per model, not global. Turbo stays on q4: at 809M parameters 4-bit costs it little, and
 * q4 is the path onnxruntime's WebGPU backend handles best. Small is 244M, where 4-bit bites much harder — and
 * int8 happens to be the *smaller* download for it too (88 + 149 MB against 63 + 222), because q4 only
 * quantises part of its decoder.
 */
export const MODELS: Record<ModelId, { repo: string; name: string; withF16: Weights; plain: Weights }> = {
  small: {
    repo: 'onnx-community/whisper-small',
    name: 'Whisper small',
    withF16: { encoder_model: 'fp16', decoder_model_merged: 'int8', bytes: 318 * MB },
    plain: { encoder_model: 'int8', decoder_model_merged: 'int8', bytes: 237 * MB },
  },
  turbo: {
    repo: 'onnx-community/whisper-large-v3-turbo',
    name: 'Whisper large-v3-turbo',
    withF16: { encoder_model: 'fp16', decoder_model_merged: 'q4', bytes: 1534 * MB },
    plain: { encoder_model: 'q4', decoder_model_merged: 'q4', bytes: 724 * MB },
  },
};

/** `fp16` is what the adapter reported (see `gpu.ts`): a card with `shader-f16` keeps the encoder in half floats. */
export const weightsFor = (id: ModelId, fp16: boolean): Weights => (fp16 ? MODELS[id].withF16 : MODELS[id].plain);

/** What a download of this model costs on this machine. */
export const modelBytes = (id: ModelId, fp16: boolean): number => weightsFor(id, fp16).bytes;

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

/**
 * `ready` — the exact two files this machine would load are here, so loading touches no network.
 * `stale` — something from that repository is cached, but not those two: the configs and the tokenizer of a
 *           download that never finished (transformers.js fetches those first), or weights in a quantisation
 *           this app no longer asks for. Useless bytes, and the only reason the settings window offers to
 *           delete a model it does not consider downloaded.
 * `none`  — nothing at all.
 */
export type ModelState = 'none' | 'stale' | 'ready';

/** The state of every model, as the cache has it. `fp16` decides which files «the right ones» are. */
export const modelStates = async (fp16: boolean): Promise<Record<ModelId, ModelState>> => {
  const urls = await cachedUrls();
  const has = (repo: string, file: string): boolean =>
    urls.some((url) => url.includes(`${repo}/`) && url.includes(file));

  const state = (id: ModelId): ModelState => {
    const { repo } = MODELS[id];
    const weights = weightsFor(id, fp16);
    if (
      has(repo, `encoder_model_${weights.encoder_model}.onnx`) &&
      has(repo, `decoder_model_merged_${weights.decoder_model_merged}.onnx`)
    ) {
      return 'ready';
    }
    return urls.some((url) => url.includes(`${repo}/`)) ? 'stale' : 'none';
  };

  return { small: state('small'), turbo: state('turbo') };
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
