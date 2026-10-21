import { useEffect, useRef, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from 'cn';

/** What a finished run opens on — and with it, which button leads the pill when a file is picked. */
export type Mode = 'transcript' | 'subtitles';

export const MODE_KEY = 'mode';

export const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'transcript', label: 'Текст і конспект', hint: 'Транскрипт, далі «Вловити суть»' },
  { value: 'subtitles', label: 'Субтитри й таймкоди', hint: 'Файл .srt, далі розділи для YouTube і Telegram' },
];

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

type SettingsProps = { open: boolean; mode: Mode; onMode: (mode: Mode) => void; onClose: () => void };

export function SettingsDialog({ open, mode, onMode, onClose }: SettingsProps) {
  return (
    <Modal open={open} title="Налаштування" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">Режим за замовчуванням</span>
          <span className="text-xs text-muted-foreground">
            Перша кнопка в панелі і екран, яким завершується транскрибація. У панелі режим завжди можна
            перемкнути на один файл.
          </span>
        </div>
        {MODES.map(({ value, label, hint }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
            className={cn(
              'flex flex-col gap-0.5 rounded-xl border bg-background px-4 py-3 text-left transition-colors',
              'hover:bg-muted/60',
              mode === value && 'border-foreground/35 bg-muted hover:bg-muted',
            )}
          >
            <span className="text-[13.5px] font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </button>
        ))}
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
          й аудіо на твоїй машині.
        </p>
        <p>
          Whisper large-v3-turbo рахує тут, локально: ні файл, ні звук нікуди не йдуть
          {engine && <span className="text-foreground"> ({engine})</span>}. З мережі завантажується лише сама
          модель, один раз.
        </p>
        <p>
          Виняток — конспект і таймкоди: вони передають транскрипт команді <code>claude</code>, а та звертається
          до Anthropic.
        </p>
      </div>
    </Modal>
  );
}
