/// <reference types="@webgpu/types" />

/**
 * Is there a graphics card here, and what can it do — the one question both the window and the worker ask.
 *
 * The window needs the answer before anything is downloaded, to recommend a model and to show its real size;
 * the worker needs it to pick the device and the dtype. Asking twice costs nothing: `requestAdapter()` reads
 * the driver, it does not create a device.
 */

import { t } from './i18n';

// SwiftShader is the software Vulkan that ships inside Electron. It answers requestAdapter() like a real card,
// so without this check the app said "WebGPU" for weeks while every matmul ran on the CPU inside the GPU process.
const SOFTWARE_ADAPTER = /swiftshader|llvmpipe|lavapipe|warp/i;

/** `software` adapters are refused for transcription: they are the CPU wearing a GPU's name. */
export type Gpu = { label: string; software: boolean; fp16: boolean };

/** The adapter this machine has, or null when WebGPU is missing entirely. */
export const findGpu = async (): Promise<Gpu | null> => {
  if (!('gpu' in navigator)) return null;

  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return null;

  const { vendor, architecture, description, isFallbackAdapter } = adapter.info;
  const label = [vendor, architecture].filter(Boolean).join(' ') || description || t().error.unknownAdapter;
  const software = isFallbackAdapter || SOFTWARE_ADAPTER.test(`${vendor} ${architecture} ${description}`);
  return { label, software, fp16: adapter.features.has('shader-f16') };
};

/** Whether the big model is worth offering: a real card, not the software one. */
export const isRealGpu = (gpu: Gpu | null): gpu is Gpu => gpu !== null && !gpu.software;
