/**
 * Which engines transcribe and write the summary and the chapters, and where their APIs live. Kept by main in
 * userData rather than in the renderer's localStorage, because the keys are in here: encrypted with safeStorage
 * and never sent back to the window, which only learns whether there is one.
 */
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  AI_ENGINES,
  API_ROLES,
  SPEECH_ENGINES,
  storedApis,
  type AiSettings,
  type AiSettingsUpdate,
  type ApiRole,
  type StoredApis,
} from './api';
import { t } from './i18n';

type Stored = Pick<AiSettings, 'engine' | 'speech'> & { apis: StoredApis };

const settingsFile = (): string => path.join(app.getPath('userData'), 'engines.json');

/** What is on disk, shape-checked; anything odd falls back to the default engines with nothing configured. */
const readStored = (): Stored => {
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')) as Record<string, unknown>;
  } catch {
    // no file yet, or not JSON: the defaults below
  }
  return {
    engine: AI_ENGINES.find((value) => value === saved?.engine) ?? 'claude',
    speech: SPEECH_ENGINES.find((value) => value === saved?.speech) ?? 'whisper',
    apis: storedApis(typeof saved === 'object' && saved !== null ? saved : {}),
  };
};

/** The settings as the window may see them. */
export const aiSettings = (): AiSettings => {
  const { engine, speech, apis } = readStored();
  const visible = (role: ApiRole) => {
    const { key, ...connection } = apis[role];
    return { ...connection, hasKey: key !== null };
  };
  return { engine, speech, apis: { speech: visible('speech'), summary: visible('summary') } };
};

/** One API's key in clear, for the request header and nothing else. Null when none is stored. */
export const aiKey = (role: ApiRole): string | null => {
  const { key } = readStored().apis[role];
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
  const apis = Object.fromEntries(
    API_ROLES.map((role) => {
      const { baseUrl, model, key: typed } = update.apis[role];
      // A key goes only where it was given for: a new address drops it, or a window could redirect it elsewhere.
      let key = baseUrl === stored.apis[role].baseUrl ? stored.apis[role].key : null;
      if (typed === '') key = null;
      else if (typed !== undefined) {
        if (!keyringReady()) throw new Error(t().error.noKeyring);
        key = safeStorage.encryptString(typed).toString('base64');
      }
      return [role, { baseUrl, model, key }];
    }),
  ) as StoredApis;

  const next: Stored = { engine: update.engine, speech: update.speech, apis };
  fs.writeFileSync(settingsFile(), JSON.stringify(next), { mode: 0o600 });
  return aiSettings();
};
