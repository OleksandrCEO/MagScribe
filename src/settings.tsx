import { useEffect, useRef, type ReactNode } from 'react';
import { CheckIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatSize, LANG_NAMES, UI_LANGS, type Strings, type UiLang } from '@/i18n';
import { modelBytes, MODEL_IDS, MODELS, type ModelId } from '@/models';
import { DEFAULT_PROMPTS, PROMPT_FIELDS, type Prompts } from '@/prompts';
import { cn } from 'cn';

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
        'm-auto w-110 max-w-[calc(100%-3rem)] rounded-2xl border bg-card p-0 text-foreground',
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
  cached: ModelId[];
  recommended: ModelId;
  fp16: boolean; // what the adapter reported: it decides which of the two download sizes is the real one
  busy: boolean; // a model is loading or working, so this is no moment to delete or swap it
  onChange: (id: ModelId) => void;
  onDelete?: (id: ModelId) => void; // only the settings window offers it; the first-run question has nothing to delete
};

/** The two models, with what each would cost here. Used by the settings window and by the first-run question. */
export function ModelPicker({ s, value, cached, recommended, fp16, busy, onChange, onDelete }: PickerProps) {
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
                {cached.includes(id) ? (
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">{s.model.downloaded}</span>
                ) : (
                  id === recommended && (
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      {s.model.recommended}
                    </span>
                  )
                )}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {s.model[id]} · ≈ {formatSize(modelBytes(id, fp16), s)}
              </span>
            </span>
          </button>
          {onDelete && cached.includes(id) && (
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

type SettingsProps = {
  open: boolean;
  s: Strings;
  lang: UiLang;
  onLang: (lang: UiLang) => void;
  model: ModelId;
  models: ModelId[]; // which ones are on disk
  recommended: ModelId;
  fp16: boolean;
  modelBusy: boolean; // the model is loading or working: swapping or deleting it mid-run is nobody's intent
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
  models,
  recommended,
  fp16,
  modelBusy,
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
          <div className="flex items-center gap-0.5 rounded-[10px] border bg-background p-[3px]">
            {UI_LANGS.map((value) => (
              <Button
                key={value}
                variant="ghost"
                size="xs"
                aria-pressed={lang === value}
                className={cn(
                  'rounded-[7px] px-2.5 text-muted-foreground',
                  lang === value && 'bg-muted text-foreground',
                )}
                onClick={() => onLang(value)}
              >
                {LANG_NAMES[value]}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{s.settings.model}</span>
          <ModelPicker
            s={s}
            value={model}
            cached={models}
            recommended={recommended}
            fp16={fp16}
            busy={modelBusy}
            onChange={onModel}
            onDelete={onDeleteModel}
          />
        </div>

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
