import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
