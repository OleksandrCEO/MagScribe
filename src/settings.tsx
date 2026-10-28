import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { CheckIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AI_ENGINES,
  rolesInUse,
  type AiSettings,
  type AiSettingsUpdate,
  type ApiCheck,
  type ApiRole,
  type Connection,
  type SpeechEngine,
} from '@/api';
import { formatSize, LANG_NAMES, UI_LANGS, type Strings, type UiLang } from '@/i18n';
import { modelBytes, MODEL_IDS, MODELS, type Device, type ModelId, type ModelState } from '@/models';
import { DEFAULT_PROMPTS, PROMPT_FIELDS, type Prompts } from '@/prompts';
import { DEEPGRAM, SUMMARY_PROVIDERS, type Provider } from '@/providers';
import { cn } from 'cn';

// Read by the window and by the command line's hidden one, which shares the origin and so the person's choices.
export const LANG_KEY = 'lang';
export const MODEL_KEY = 'model';

// localStorage is keyed per origin and survives restarts. It can still throw (blocked storage), and a setting
// that does not come back is not worth an error on screen.
export const readSetting = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return allowed.some((value) => value === saved) ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeSetting = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // see above: a setting that does not survive a restart is not an error
  }
};

/** Free text, unlike the settings above it, so there is no list of allowed values to check against. */
const readStored = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

export const readPrompts = (): Prompts =>
  Object.fromEntries(
    PROMPT_FIELDS.map(({ task, key }) => [task, readStored(key, DEFAULT_PROMPTS[task])]),
  ) as Prompts;

export const writePrompts = (prompts: Prompts): void => {
  for (const { task, key } of PROMPT_FIELDS) writeSetting(key, prompts[task]);
};

/**
 * The two bits of markup a translated line may carry: `*emphasis*` and `` `code` ``. Keeping them inside the
 * string is what lets a whole sentence be one translatable unit — English and Ukrainian put the emphasis in
 * different places, and a sentence split into three JSX fragments cannot be reordered.
 */
export const rich = (line: string): ReactNode[] =>
  line.split(/(\*[^*]+\*|`[^`]+`)/).map((part, index) => {
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <span key={index} className="font-medium text-foreground">
          {part.slice(1, -1)}
        </span>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });

/** Paragraphs of a translated body, `rich` applied to each. */
const paragraphs = (body: string[]): ReactNode =>
  body.map((line) => (
    <p key={line}>{rich(line)}</p>
  ));

type ModalProps = { open: boolean; title: string; close: string; onClose: () => void; children: ReactNode };

/** The shell both windows share: a native <dialog>, so the backdrop, Esc and the focus trap come from the platform. */
function Modal({ open, title, close, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click that lands on the dialog element itself landed on the backdrop — the content sits in the div.
      onClick={(event) => event.target === ref.current && onClose()}
      className={cn(
        'm-auto w-136 max-w-[calc(100%-3rem)] rounded-2xl border bg-card p-0 text-foreground',
        'max-h-[85vh] overflow-y-auto [scrollbar-width:thin]',
        'shadow-[0_24px_64px_-24px_rgb(0_0_0/0.5)] backdrop:bg-black/35',
      )}
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            title={close}
            aria-label={close}
            className="-mt-1 -mr-1 text-muted-foreground"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

type PickerProps = {
  s: Strings;
  value: ModelId;
  states: Record<ModelId, ModelState>;
  recommended: ModelId;
  device: Device; // webgpu or wasm: together with fp16 it decides which download size is the real one here
  fp16: boolean;
  busy: boolean; // a model is loading or working, so this is no moment to delete or swap it
  onChange: (id: ModelId) => void;
  onDelete?: (id: ModelId) => void; // only the settings window offers it; the first-run question has nothing to delete
};

/** The two models, with what each would cost here. Used by the settings window and by the first-run question. */
export function ModelPicker({ s, value, states, recommended, device, fp16, busy, onChange, onDelete }: PickerProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {MODEL_IDS.map((id) => (
        <div
          key={id}
          className={cn(
            'flex items-center gap-2 rounded-[10px] border px-3 py-2 transition-colors',
            value === id ? 'border-foreground/40 bg-muted' : 'hover:bg-muted/40',
          )}
        >
          <button
            type="button"
            aria-pressed={value === id}
            disabled={busy}
            className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
            onClick={() => onChange(id)}
          >
            {/* The tick, not the shading, is what says «this is the one in use» at a glance. */}
            <CheckIcon className={cn('size-4 shrink-0', value === id ? 'opacity-100' : 'opacity-0')} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-medium">
                {MODELS[id].name}
                {/* One note after the name: downloaded, leftovers of a quantisation we no longer use, or — for
                    a model that is neither — the one this machine should take. */}
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  {states[id] === 'ready'
                    ? s.model.downloaded
                    : states[id] === 'stale'
                      ? s.model.stale
                      : id === recommended
                        ? s.model.recommended
                        : ''}
                </span>
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {s.model[id]} · ≈ {formatSize(modelBytes(id, device, fp16), s)}
              </span>
            </span>
          </button>
          {/* Stale files are deletable too — they are the only way those megabytes ever leave the disk. */}
          {onDelete && states[id] !== 'none' && (
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 text-muted-foreground"
              disabled={busy}
              onClick={() => onDelete(id)}
            >
              {s.settings.deleteModel}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** A row of plain words with one of them on: the interface language, an engine, a provider. Wraps when long. */
function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 self-start rounded-[10px] border bg-background p-[3px]">
      {options.map((option) => (
        <Button
          key={option.value}
          variant="ghost"
          size="xs"
          aria-pressed={value === option.value}
          className={cn(
            'rounded-[7px] px-2.5 text-muted-foreground',
            value === option.value && 'bg-muted text-foreground',
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

const inputClass = 'text-[13px] md:text-[13px] dark:bg-background';

type Form = Pick<AiSettings, 'engine' | 'speech'> & { apis: Record<ApiRole, Connection> };

const formOf = ({ engine, speech, apis }: AiSettings): Form => ({
  engine,
  speech,
  apis: {
    speech: { baseUrl: apis.speech.baseUrl, model: apis.speech.model },
    summary: { baseUrl: apis.summary.baseUrl, model: apis.summary.model },
  },
});

/** A preset's address and its first model, or nothing at all for «Локально». */
const fill = (preset: Provider | null): Connection =>
  preset ? { baseUrl: preset.baseUrl, model: preset.models[0]?.id ?? '' } : { baseUrl: '', model: '' };

/** The form with the transcription on an API: the one set up before, or Deepgram when there is none. */
const withApiSpeech = (form: Form, before: SpeechEngine): Form => {
  const { baseUrl } = form.apis.speech;
  if (!baseUrl) return { ...form, speech: 'deepgram', apis: { ...form.apis, speech: fill(DEEPGRAM) } };
  return { ...form, speech: before !== 'whisper' ? before : baseUrl === DEEPGRAM.baseUrl ? 'deepgram' : 'api' };
};

type EnginesProps = {
  s: Strings;
  open: boolean;
  busy: boolean; // a run is going on: «Перевірити» would race its request for the one cancel handle in main
  // The first-run form: transcription over an API and nothing else to choose, so the engine rows, the summary
  // and «Перевірити» stay out of it. Called with what was saved.
  onSaved?: (settings: AiSettings) => void;
};

/**
 * The engines for the transcription and for «Опрацювати» with the chapters, each API with its own preset, address,
 * model and key. Their settings live in main, the keys with them, so the form is loaded on every open and saved
 * with a button: the key fields are write-only, and half-typed values are no setting.
 */
function EnginesSection({ s, open, busy, onSaved }: EnginesProps) {
  const [saved, setSaved] = useState<AiSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [keys, setKeys] = useState<Record<ApiRole, string>>({ speech: '', summary: '' });
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ApiCheck | 'running' | null>(null);

  const show = (settings: AiSettings): void => {
    setSaved(settings);
    setForm(onSaved ? withApiSpeech(formOf(settings), settings.speech) : formOf(settings));
    setKeys({ speech: '', summary: '' });
    setError(null);
    setCheck(null);
  };

  useEffect(() => {
    if (open) void window.api.getAiSettings().then(show);
    // Loaded on every open and on nothing else; show is a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (update: AiSettingsUpdate): Promise<void> => {
    const answer = await window.api.setAiSettings(update);
    if ('error' in answer) setError(answer.error);
    else if (onSaved) onSaved(answer.settings);
    else show(answer.settings);
  };

  const runCheck = async (): Promise<void> => {
    setCheck('running');
    setCheck(await window.api.checkApi());
  };

  if (!saved || !form) return null;
  const inUse = rolesInUse(form);
  const dirty = keys.speech !== '' || keys.summary !== '' || JSON.stringify(form) !== JSON.stringify(formOf(saved));

  const save = (): void => {
    const withKey = (role: ApiRole) => ({
      ...form.apis[role],
      ...(inUse.includes(role) && keys[role] && { key: keys[role] }),
    });
    void submit({ ...form, apis: { speech: withKey('speech'), summary: withKey('summary') } });
  };

  // What is saved, not what is typed: forgetting a key must not store a half-edited form.
  const forget = (role: ApiRole): void => {
    const kept = formOf(saved);
    void submit({ ...kept, apis: { ...kept.apis, [role]: { ...kept.apis[role], key: '' } } });
  };

  const pick = (role: ApiRole, preset: Provider | null): void =>
    setForm({
      ...form,
      ...(role === 'speech' && { speech: preset ? 'deepgram' : 'api' }),
      apis: { ...form.apis, [role]: fill(preset) },
    });

  /** One engine's API: the preset (or «Локально»), the address, the model with the preset's suggestions, the key. */
  const connection = (role: ApiRole): ReactNode => {
    const value = form.apis[role];
    const presets = role === 'speech' ? [DEEPGRAM] : SUMMARY_PROVIDERS;
    const preset =
      role === 'speech'
        ? form.speech === 'deepgram'
          ? DEEPGRAM
          : null
        : (SUMMARY_PROVIDERS.find(({ baseUrl }) => baseUrl === value.baseUrl) ?? null);
    const stored = saved.apis[role];
    const list = `${role}-models`;
    const field = (name: keyof Connection, label: string, input: ReactNode): ReactNode => (
      <label key={name} className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {input}
      </label>
    );
    const text = (name: keyof Connection, placeholder?: string) => ({
      value: value[name],
      placeholder,
      spellCheck: false,
      className: inputClass,
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        setForm({ ...form, apis: { ...form.apis, [role]: { ...value, [name]: event.target.value } } }),
    });

    return (
      <div className="flex flex-col gap-2.5 border-l-2 pl-3">
        <Choice
          value={preset?.name ?? ''}
          options={[
            ...presets.map(({ name }) => ({ value: name, label: name })),
            { value: '', label: s.settings.custom },
          ]}
          onChange={(name) => pick(role, presets.find((candidate) => candidate.name === name) ?? null)}
        />
        <p className="text-xs leading-[1.55] text-muted-foreground">
          {rich(role === 'speech' ? s.settings.speechHint : s.settings.summaryHint)}
        </p>
        {field('baseUrl', s.settings.baseUrl, <Input {...text('baseUrl', 'https://…/v1')} />)}
        {field(
          'model',
          role === 'speech' ? s.settings.speechModel : s.settings.apiModel,
          <>
            {/* The preset's models as suggestions; any other id can still be typed. */}
            <Input list={list} {...text('model')} />
            <datalist id={list}>
              {preset?.models.map(({ id, tier }) => (
                <option key={id} value={id} label={tier && s.settings.tier[tier]} />
              ))}
            </datalist>
          </>,
        )}
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {s.settings.apiKey}
            {stored.hasKey && (
              <Button variant="ghost" size="xs" className="-my-1 text-muted-foreground" onClick={() => forget(role)}>
                {s.settings.forgetKey}
              </Button>
            )}
          </span>
          <Input
            type="password"
            autoComplete="off"
            value={keys[role]}
            // A new address drops the stored key on save, so it is «saved» only while the address is the same.
            placeholder={stored.hasKey && value.baseUrl === stored.baseUrl ? s.settings.keySaved : s.settings.keyNone}
            className={inputClass}
            onChange={(event) => setKeys({ ...keys, [role]: event.target.value })}
          />
        </label>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      {!onSaved && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] font-medium">{s.settings.speechEngine}</span>
          <Choice
            value={form.speech === 'whisper' ? 'whisper' : 'api'}
            options={(['whisper', 'api'] as const).map((value) => ({ value, label: s.settings.speechEngines[value] }))}
            onChange={(value) =>
              setForm(value === 'whisper' ? { ...form, speech: 'whisper' } : withApiSpeech(form, saved.speech))
            }
          />
        </div>
      )}
      {form.speech !== 'whisper' && connection('speech')}
      {!onSaved && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] font-medium">{s.settings.aiEngine}</span>
          <Choice
            value={form.engine}
            options={AI_ENGINES.map((value) => ({ value, label: s.settings.engines[value] }))}
            onChange={(engine) => setForm({ ...form, engine })}
          />
        </div>
      )}
      {!onSaved && form.engine === 'api' && connection('summary')}

      {error && <p className="text-xs leading-[1.55] text-destructive">{error}</p>}
      {Array.isArray(check) &&
        check.map(({ task, error: failure }) => (
          <p
            key={task}
            className={cn('text-xs leading-[1.55]', failure ? 'text-destructive' : 'text-muted-foreground')}
          >
            {task === 'speech' ? s.settings.speechEngine : s.settings.aiEngine}: {failure ?? s.settings.checkOk}
          </p>
        ))}
      {/* Unsaved changes are saved first; what is checked is always what is stored. */}
      {dirty || onSaved ? (
        <Button size="sm" className="self-end px-3" onClick={save}>
          {s.settings.save}
        </Button>
      ) : (
        inUse.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="self-end px-3"
            disabled={busy || check === 'running'}
            onClick={() => void runCheck()}
          >
            {check === 'running' ? s.settings.checking : s.settings.check}
          </Button>
        )
      )}
    </div>
  );
}

type SettingsProps = {
  open: boolean;
  s: Strings;
  lang: UiLang;
  onLang: (lang: UiLang) => void;
  model: ModelId;
  states: Record<ModelId, ModelState>; // what the cache holds for each
  recommended: ModelId;
  device: Device;
  fp16: boolean;
  modelBusy: boolean; // the model is loading or working: swapping or deleting it mid-run is nobody's intent
  busy: boolean; // any run, the model's or the API's
  onModel: (id: ModelId) => void;
  onDeleteModel: (id: ModelId) => void;
  prompts: Prompts;
  onPrompts: (prompts: Prompts) => void;
  onClose: () => void;
};

export function SettingsDialog({
  open,
  s,
  lang,
  onLang,
  model,
  states,
  recommended,
  device,
  fp16,
  modelBusy,
  busy,
  onModel,
  onDeleteModel,
  prompts,
  onPrompts,
  onClose,
}: SettingsProps) {
  return (
    <Modal open={open} title={s.ui.settings} close={s.ui.close} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] font-medium">{s.settings.language}</span>
          {/* Two languages, so a pair of buttons says it all; the first one picked is the system's own. */}
          <Choice
            value={lang}
            options={UI_LANGS.map((value) => ({ value, label: LANG_NAMES[value] }))}
            onChange={onLang}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{s.settings.model}</span>
          <ModelPicker
            s={s}
            value={model}
            states={states}
            recommended={recommended}
            device={device}
            fp16={fp16}
            busy={modelBusy}
            onChange={onModel}
            onDelete={onDeleteModel}
          />
        </div>

        <EnginesSection s={s} open={open} busy={busy} />

        <div className="flex flex-col gap-4">
          <p className="text-xs leading-[1.55] text-muted-foreground">{s.settings.promptsHint}</p>

          {PROMPT_FIELDS.map(({ task }) => (
            <div key={task} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium">{s.settings.prompt[task]}</span>
                {/* Nothing to reset while the text is still ours, so the button only shows up once it is not. */}
                {prompts[task] !== DEFAULT_PROMPTS[task] && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="-my-1 text-muted-foreground"
                    onClick={() => onPrompts({ ...prompts, [task]: DEFAULT_PROMPTS[task] })}
                  >
                    {s.settings.reset}
                  </Button>
                )}
              </div>
              <Textarea
                value={prompts[task]}
                spellCheck={false}
                onChange={(event) => onPrompts({ ...prompts, [task]: event.target.value })}
                className={cn(
                  'field-sizing-fixed h-44 resize-none text-[12.5px] leading-[1.5] md:text-[12.5px]',
                  '[scrollbar-width:thin] dark:bg-background',
                )}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/**
 * The other answer to «download the model?»: transcribe over an API instead. Folded away behind one line, since
 * the question is about the model; unfolded, it is the engines form cut down to the transcription's API.
 */
export function KeyBranch({ s, onSaved }: { s: Strings; onSaved: (settings: AiSettings) => void }) {
  const [unfolded, setUnfolded] = useState(false);
  if (!unfolded) {
    return (
      <Button variant="ghost" size="xs" className="self-start text-muted-foreground" onClick={() => setUnfolded(true)}>
        {s.modelDialog.useKey}
      </Button>
    );
  }
  return <EnginesSection s={s} open busy={false} onSaved={onSaved} />;
}

type ConfirmProps = {
  open: boolean;
  title: string;
  cancel: string;
  confirm: string;
  close: string;
  body: string[];
  children?: ReactNode; // what the question needs besides words — the model picker, so far
  tone?: 'destructive' | 'default'; // destructive by default: most of these questions cost something
  onConfirm: () => void;
  onClose: () => void;
};

/** The one question the app asks before something it cannot take back. Esc and the backdrop mean «no». */
export function ConfirmDialog({
  open,
  title,
  cancel,
  confirm,
  close,
  body,
  children,
  tone = 'destructive',
  onConfirm,
  onClose,
}: ConfirmProps) {
  return (
    <Modal open={open} title={title} close={close} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2.5 text-[13px] leading-[1.6] text-muted-foreground">
          {paragraphs(body)}
        </div>
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="lg" className="px-4" onClick={onClose}>
            {cancel}
          </Button>
          <Button variant={tone} size="lg" className="px-4" onClick={onConfirm}>
            {confirm}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** `engine` is the adapter line the status bar shows, or null while the model is still loading. */
export function AboutDialog({
  open,
  s,
  model,
  engine,
  onClose,
}: {
  open: boolean;
  s: Strings;
  model: string; // the name of the model this window works with
  engine: string | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={s.ui.about} close={s.ui.close} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px] leading-[1.6] text-muted-foreground">
        {paragraphs(s.about(__APP_VERSION__, model, engine))}
      </div>
    </Modal>
  );
}
