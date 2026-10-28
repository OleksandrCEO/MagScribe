import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { config, configs as tsConfigs } from 'typescript-eslint';

// ESLint 9, flat config. The one addition that matters is eslint-plugin-react-hooks: the hook rules are the
// only tool that catches the class of mistake App.tsx can make — a stale closure in an effect, a dependency
// that is really a ref, a worker spawned from a callback that captured the previous render.
export default config(
  // public/ holds the onnxruntime runtime copied out of node_modules at build time, minified and not ours.
  { ignores: ['.vite/', 'out/', 'dist/', '.direnv/', 'public/', '.claude/'] }, // .claude/worktrees holds other checkouts
  {
    // Named explicitly: without it `eslint .` would only discover the .js files.
    files: ['**/*.{ts,tsx,mts,js,mjs}'],
    extends: [
      js.configs.recommended,
      tsConfigs.recommended,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.electron,
      importPlugin.flatConfigs.typescript,
      reactHooks.configs.flat['recommended-latest'],
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    settings: { 'import/resolver': { typescript: { project: './tsconfig.json' } } },
  },
);
