/**
 * Which engine writes the summary and the chapters, and where the API one lives. Kept by main in userData rather
 * than in the renderer's localStorage, because the key is in here: it is encrypted with safeStorage and never
 * sent back to the window, which only learns whether there is one.
 */
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AI_ENGINES, parseBaseUrl, type AiEngine, type AiSettings, type AiSettingsUpdate } from './api';
import { t } from './i18n';

// `key` is the safeStorage ciphertext in base64, or null.
type Stored = { engine: AiEngine; baseUrl: string; model: string; key: string | null };

const settingsFile = (): string => path.join(app.getPath('userData'), 'engines.json');

/** What is on disk, shape-checked; anything odd falls back to the default engine with nothing configured. */
const readStored = (): Stored => {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')) as Partial<Record<keyof Stored, unknown>>;
    return {
      engine: AI_ENGINES.find((value) => value === saved.engine) ?? 'claude',
      baseUrl: typeof saved.baseUrl === 'string' ? (parseBaseUrl(saved.baseUrl) ?? '') : '',
      model: typeof saved.model === 'string' ? saved.model : '',
      key: typeof saved.key === 'string' ? saved.key : null,
    };
  } catch {
    return { engine: 'claude', baseUrl: '', model: '', key: null };
  }
};

/** The settings as the window may see them. */
export const aiSettings = (): AiSettings => {
  const { key, ...visible } = readStored();
  return { ...visible, hasKey: key !== null };
};

/** The key in clear, for the request header and nothing else. Null when none is stored. */
export const aiKey = (): string | null => {
  const { key } = readStored();
  if (key === null) return null;
  try {
    return safeStorage.decryptString(Buffer.from(key, 'base64'));
  } catch {
    // A keyring that was reset or swapped cannot open what the old one locked.
    throw new Error(t().error.keyUnreadable);
  }
};

// On Linux, with no keyring to ask, Chromium encrypts with a password hardcoded in its source — the key would be
// as good as plain text on disk. Refusing is better than pretending.
const keyringReady = (): boolean =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');

/** Stores an update that `parseUpdate` already checked, and answers with what the window may now see. */
export const saveAiSettings = (update: AiSettingsUpdate): AiSettings => {
  const stored = readStored();
  // A key goes only where it was given for: a new address drops it, or a window could redirect it elsewhere.
  let key = update.baseUrl === stored.baseUrl ? stored.key : null;
  if (update.key === '') key = null;
  else if (update.key !== undefined) {
    if (!keyringReady()) throw new Error(t().error.noKeyring);
    key = safeStorage.encryptString(update.key).toString('base64');
  }

  const next: Stored = { engine: update.engine, baseUrl: update.baseUrl, model: update.model, key };
  fs.writeFileSync(settingsFile(), JSON.stringify(next), { mode: 0o600 });
  return aiSettings();
};
