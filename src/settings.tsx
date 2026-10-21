import { useEffect, useRef, type ReactNode } from 'react';
import { RotateCcwIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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

type ModalProps = { open: boolean; title: string; onClose: () => void; children: ReactNode };

/** The shell both windows share: a native <dialog>, so the backdrop, Esc and the focus trap come from the platform. */
function Modal({ open, title, onClose, children }: ModalProps) {
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
            title="Закрити"
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

type SettingsProps = { open: boolean; prompts: Prompts; onPrompts: (prompts: Prompts) => void; onClose: () => void };

export function SettingsDialog({ open, prompts, onPrompts, onClose }: SettingsProps) {
  return (
    <Modal open={open} title="Налаштування" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-[1.55] text-muted-foreground">
          Інструкції, які отримує модель. Можна замінити на власні, або підкоригувати за бажанням. Порожнє поле
          підставить промпт за замовчуванням.
        </p>

        {PROMPT_FIELDS.map(({ task, label }) => (
          <div key={task} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium">{label}</span>
              {/* Nothing to reset while the text is still ours, so the button only shows up once it is not. */}
              {prompts[task] !== DEFAULT_PROMPTS[task] && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="-my-1 text-muted-foreground"
                  onClick={() => onPrompts({ ...prompts, [task]: DEFAULT_PROMPTS[task] })}
                >
                  <RotateCcwIcon /> Скинути
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
    </Modal>
  );
}

type ConfirmProps = {
  open: boolean;
  title: string;
  cancel: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
};

/** The one question the app asks before something it cannot take back. Esc and the backdrop mean «no». */
export function ConfirmDialog({ open, title, cancel, confirm, onConfirm, onClose, children }: ConfirmProps) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2.5 text-[13px] leading-[1.6] text-muted-foreground">{children}</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="lg" className="px-4" onClick={onClose}>
            {cancel}
          </Button>
          <Button variant="destructive" size="lg" className="px-4" onClick={onConfirm}>
            {confirm}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** `engine` is the adapter line the status bar shows, or null while the model is still loading. */
export function AboutDialog({ open, engine, onClose }: { open: boolean; engine: string | null; onClose: () => void }) {
  return (
    <Modal open={open} title="Про MagScribe" onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px] leading-[1.6] text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">MagScribe {__APP_VERSION__}</span> — транскрибація відео
          й аудіо: текст, субтитри .srt і таймкоди розділів.
        </p>
        <p>
          Зараз розшифровує Whisper large-v3-turbo на цій машині
          {engine && <span className="text-foreground"> ({engine})</span>}, а конспект і таймкоди пише команда{' '}
          <code>claude</code> — тобто транскрипт для них іде в Anthropic.
        </p>
        <p>Вибір рушія для обох кроків — локального чи хмарного — зʼявиться в налаштуваннях.</p>
      </div>
    </Modal>
  );
}
