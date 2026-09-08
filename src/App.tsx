import { useEffect, useRef, useState, type DragEvent } from 'react';
import { AudioLinesIcon, ClipboardCopyIcon, DownloadIcon, FileVideoIcon, SparklesIcon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Toaster } from '@/components/ui/sonner';
import type { SelectedFile } from '@/preload';
import type { Device, WorkerRequest, WorkerResponse } from '@/worker';
import { cn } from 'cn';

const formatSize = (bytes: number): string => {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const power = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  const value = bytes / 1024 ** power;
  return `${power === 0 ? value : value.toFixed(1)} ${units[power]}`;
};

const countWords = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

export default function App() {
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [download, setDownload] = useState(0);
  const [device, setDevice] = useState<Device | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null); // null while nothing is being transcribed
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [pending, setPending] = useState(false); // asked to transcribe before the model finished loading

  // dragenter/dragleave also fire for children, so count the nesting instead of toggling on every event.
  const dragDepth = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const ready = useRef(false); // read inside the worker listener, which never sees state updates

  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'download') setDownload(message.progress);
      if (message.type === 'ready') {
        setDownload(100);
        setDevice(message.device);
        ready.current = true;
      }
      if (message.type === 'fallback') setFallback(`${message.from} недоступний: ${message.reason}`);
      if (message.type === 'progress') setProgress(message.progress);
      if (message.type === 'partial') setTranscript(message.text);
      if (message.type === 'result') {
        setTranscript(message.text);
        setProgress(null);
        window.api.notify('MagScribe', `Транскрипція завершена — ${countWords(message.text)} слів`);
      }
      if (message.type === 'error') {
        // Before the model is up, the failure is permanent — keep it on screen instead of a toast that fades.
        if (!ready.current) setModelError(message.message);
        else toast.error(message.message);
        setProgress(null);
      }
    });

    worker.postMessage({ type: 'load' } satisfies WorkerRequest);
    return () => worker.terminate();
  }, []);

  const stopDragging = (): void => {
    dragDepth.current = 0;
    setDragging(false);
  };

  const pickFile = (picked: SelectedFile): void => {
    setFile(picked);
    setTranscript('');
    setSummary('');
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    stopDragging();

    const dropped = event.dataTransfer.files[0];
    if (!dropped) return;
    pickFile({ path: window.api.getPathForFile(dropped), name: dropped.name, size: dropped.size });
  };

  const chooseFile = async (): Promise<void> => {
    const chosen = await window.api.selectFile();
    if (chosen) pickFile(chosen);
  };

  const failWith = (error: unknown): void => {
    toast.error(error instanceof Error ? error.message : String(error));
  };

  const startTranscription = async (): Promise<void> => {
    if (!file || !workerRef.current) return;

    setTranscript('');
    setSummary('');
    setPending(false);
    setConverting(true);
    try {
      const audio = await window.api.extractAudio(file.path);
      setProgress(0);
      workerRef.current.postMessage({ type: 'transcribe', audio } satisfies WorkerRequest, [audio.buffer]);
    } catch (error) {
      failWith(error);
      setProgress(null);
    } finally {
      setConverting(false);
    }
  };

  const copy = async (text: string): Promise<void> => {
    await window.api.copyText(text);
    toast.success('Скопійовано');
  };

  const saveTranscript = async (): Promise<void> => {
    const base = file ? file.name.replace(/\.[^.]+$/, '') : 'transcript';
    try {
      if (await window.api.saveText(transcript, `${base}.txt`)) toast.success('Збережено');
    } catch (error) {
      failWith(error);
    }
  };

  const makeSummary = async (): Promise<void> => {
    setSummarizing(true);
    try {
      setSummary(await window.api.summarize(transcript));
    } catch (error) {
      failWith(error);
    } finally {
      setSummarizing(false);
    }
  };

  const busy = converting || progress !== null;

  // Main keeps the machine awake while this is true, and asks before closing the window.
  useEffect(() => {
    window.api.setWorking(busy);
  }, [busy]);

  // Loading the model takes a few seconds on every start — let the click wait for it instead of the person.
  useEffect(() => {
    if (!pending || device === null || busy) return;
    setPending(false);
    void startTranscription();
  }, [pending, device, busy]);

  const modelReady = device !== null;
  // Downloading is only half the wait: the weights still have to be parsed and compiled onto the GPU.
  const modelStage = modelError ? 'failed' : modelReady ? 'ready' : download >= 100 ? 'preparing' : 'downloading';

  return (
    // Dropping outside the zone would otherwise make the window navigate to the file.
    <div
      className="grid h-screen grid-cols-1 grid-rows-[minmax(0,1fr)] gap-5 p-5 md:grid-cols-[minmax(260px,300px)_1fr]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <div className="flex items-center gap-2">
          <AudioLinesIcon className="size-5" />
          <h1 className="text-lg font-semibold">MagScribe</h1>
        </div>

        <Card
          onDragEnter={() => {
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => {
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) stopDragging();
          }}
          onDrop={handleDrop}
          className={cn(
            'items-center gap-4 border-2 border-dashed p-8 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <UploadIcon className="size-7 text-muted-foreground" />
          <div>
            <p className="font-medium">Перетягни сюди відео або аудіо</p>
            <p className="text-sm text-muted-foreground">MP4, MKV, MOV, MP3, WAV та інші</p>
          </div>
          <Button variant="outline" onClick={chooseFile}>
            Вибрати файл
          </Button>
        </Card>

        {file && (
          <div className="flex items-center gap-3 text-sm">
            <FileVideoIcon className="size-5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium" title={file.path}>
              {file.name}
            </span>
            <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
          </div>
        )}

        {modelStage === 'downloading' && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Завантаження моделі</span>
              <span>{Math.round(download)}%</span>
            </div>
            <Progress value={download} />
          </div>
        )}

        {modelStage === 'preparing' && (
          <p className="text-sm text-muted-foreground">
            Модель завантажена, готую до роботи — перший запуск триває кілька хвилин
          </p>
        )}

        {modelStage === 'failed' && <p className="text-sm text-destructive">{modelError}</p>}

        {converting && <p className="text-sm text-muted-foreground">Конвертація аудіо…</p>}

        {progress !== null && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Транскрипція</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
          </div>
        )}

        <Button
          disabled={!file || busy || pending || modelStage === 'failed'}
          onClick={() => (modelReady ? void startTranscription() : setPending(true))}
        >
          {busy ? 'Транскрибую…' : pending ? 'Почну, щойно модель завантажиться' : 'Транскрибувати'}
        </Button>

        {fallback && <p className="text-xs text-muted-foreground">{fallback}</p>}
      </div>

      <div className="flex min-h-0 flex-col gap-4">
        {summary && (
          <Card className="max-h-[40%] gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">Вижимка</h2>
              <Button variant="ghost" size="sm" onClick={() => copy(summary)}>
                <ClipboardCopyIcon /> Копіювати
              </Button>
            </div>
            <p className="min-h-0 flex-1 overflow-y-auto text-sm whitespace-pre-wrap">{summary}</p>
          </Card>
        )}

        <Card className="min-h-0 flex-1 gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Транскрипт</h2>
            {transcript && (
              <span className="text-xs text-muted-foreground">
                {countWords(transcript)} слів · {transcript.length} символів
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">
            {transcript || <span className="text-muted-foreground">Тут зʼявиться текст після транскрипції.</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!transcript} onClick={() => copy(transcript)}>
              <ClipboardCopyIcon /> Копіювати
            </Button>
            <Button variant="outline" size="sm" disabled={!transcript} onClick={saveTranscript}>
              <DownloadIcon /> Зберегти .txt
            </Button>
            <Button size="sm" disabled={!transcript || summarizing} onClick={makeSummary}>
              <SparklesIcon /> {summarizing ? 'Готую вижимку…' : 'Зробити вижимку'}
            </Button>
          </div>
        </Card>
      </div>

      <Toaster />
    </div>
  );
}
