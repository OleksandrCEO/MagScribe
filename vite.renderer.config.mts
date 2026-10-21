import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

// onnxruntime loads its wasm backend at runtime: it imports the `.mjs` glue and then fetches the matching
// `.wasm`, by default from cdn.jsdelivr.net at its own pinned version. That means the app needs the network to
// start at all, and it means a CDN gets to run code in our window — so the worker points `wasmPaths` at our own
// origin instead (see src/worker.ts) and these are the files it finds there. Only two of the four variants
// onnxruntime ships are ever asked for; the bundle names no others.
const ORT_FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

/** Copies the onnxruntime runtime into `public/ort`, where the dev server and the build both pick it up. */
const copyOrt = (): Plugin => ({
  name: 'copy-onnxruntime-wasm',
  buildStart() {
    const from = path.resolve(import.meta.dirname, 'node_modules/onnxruntime-web/dist');
    const to = path.resolve(import.meta.dirname, 'public/ort');
    fs.mkdirSync(to, { recursive: true });
    for (const file of ORT_FILES) {
      const source = path.join(from, file);
      const target = path.join(to, file);
      // The files are tens of megabytes: copy only when the version in node_modules is not the one here.
      if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(source).size) continue;
      fs.copyFileSync(source, target);
    }
  },
});

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss(), copyOrt()],
  // The renderer has no package.json at runtime, and the About window should not carry a hardcoded version.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // direnv materialises the flake inputs under .direnv, symlinks into the whole nixpkgs tree included. Vite
  // followed them and reloaded the page on random nixpkgs .html files, which throws away a running
  // transcription. .gitignore does not help here: the dev server has its own watcher.
  server: { watch: { ignored: ['**/.direnv/**'] } },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
