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

/** Where the model runs. The worker tries `webgpu` first and falls back to `wasm`; see worker.ts. */
export type Device = 'webgpu' | 'wasm';

export const MODEL_IDS: readonly ModelId[] = ['small', 'turbo'];

const MB = 1024 * 1024;

/** The quantisations we use. The names are the file suffixes on HuggingFace, which is also how `caches` tells them apart. */
export type Quant = 'fp16' | 'q4' | 'int8';

/** One pair of files the worker loads, and what the two of them weigh together. */
export type Weights = { encoder_model: Quant; decoder_model_merged: Quant; bytes: number };

/** The three cases a machine can be in; sizes are the pair of files each one fetches. */
type Variants = {
  f16: Weights; // a card that reports `shader-f16`: the encoder stays in half floats
  gpu: Weights; // any other real card
  cpu: Weights; // wasm, with no card in play at all
};

/**
 * Sizes read off the HuggingFace blob list on 21.10.2026, for exactly the pair of files each case fetches;
 * approximate on purpose, since the tokenizer and the configs add a couple of megabytes on top.
 *
 * The quantisation is per model *and* per runtime, both measured rather than assumed:
 *
 * - turbo stays on q4 everywhere. At 809M parameters 4-bit costs it little, and q4 is what onnxruntime's
 *   WebGPU backend runs natively (`MatMulNBits`).
 * - small is 244M, where 4-bit bites much harder, and for it int8 is also the smaller download (88 + 149 MB
 *   against 63 + 222, because q4 only quantises part of its decoder). But int8 has no WebGPU kernels: those
 *   nodes fall back to the CPU inside the GPU session, with tensors copied back and forth every layer, and
 *   the run crawls — measured on an RTX card, where turbo q4 does the same file in 35 seconds. So int8 is for
 *   the wasm path, which is the one small exists for, and a card gets q4.
 */
export const MODELS: Record<ModelId, { repo: string; name: string } & Variants> = {
  small: {
    repo: 'onnx-community/whisper-small',
    name: 'Whisper small',
    f16: { encoder_model: 'fp16', decoder_model_merged: 'q4', bytes: 391 * MB },
    gpu: { encoder_model: 'q4', decoder_model_merged: 'q4', bytes: 286 * MB },
    cpu: { encoder_model: 'int8', decoder_model_merged: 'int8', bytes: 237 * MB },
  },
  turbo: {
    repo: 'onnx-community/whisper-large-v3-turbo',
    name: 'Whisper large-v3-turbo',
    f16: { encoder_model: 'fp16', decoder_model_merged: 'q4', bytes: 1534 * MB },
    gpu: { encoder_model: 'q4', decoder_model_merged: 'q4', bytes: 724 * MB },
    cpu: { encoder_model: 'q4', decoder_model_merged: 'q4', bytes: 724 * MB },
  },
};

/**
 * Which pair this machine loads. `fp16` is what the adapter reported (see `gpu.ts`) and only matters on a card.
 *
 * A WebGPU load that fails and falls back to wasm can therefore want files the GPU run did not fetch; that
 * second download is the price of the fallback, and the settings window reports the first set as leftovers.
 */
export const weightsFor = (id: ModelId, device: Device, fp16: boolean): Weights =>
  device === 'wasm' ? MODELS[id].cpu : fp16 ? MODELS[id].f16 : MODELS[id].gpu;

/** What a download of this model costs on this machine. */
export const modelBytes = (id: ModelId, device: Device, fp16: boolean): number => weightsFor(id, device, fp16).bytes;

/**
 * Where a machine starts — turbo, card or no card.
 *
 * It used to depend on the hardware, on the theory that a processor should get the lighter model. Comparing
 * the two on the same recording killed that theory: small does not lose polish, it loses the content. On a
 * Ukrainian screencast it turned «Generate Access Token» into «генерей та аксистокін», «Instagram API» into
 * «інстаграм і п'яй», invented words that read as real ones, and repeated a whole clause it had hallucinated.
 * int8 removed the repetition and nothing else. A slow correct answer beats a fast one nobody can repair, so
 * the processor gets turbo too, and small stays for whoever chooses speed knowingly.
 */
export const recommendedModel = (): ModelId => 'turbo';

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

/** The state of every model, as the cache has it. The runtime decides which files «the right ones» are. */
export const modelStates = async (device: Device, fp16: boolean): Promise<Record<ModelId, ModelState>> => {
  const urls = await cachedUrls();
  const has = (repo: string, file: string): boolean =>
    urls.some((url) => url.includes(`${repo}/`) && url.includes(file));

  const state = (id: ModelId): ModelState => {
    const { repo } = MODELS[id];
    const weights = weightsFor(id, device, fp16);
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
