import { useEffect, useRef, useState, type DragEvent } from 'react';
import { FileVideoIcon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
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

export default function App() {
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [download, setDownload] = useState(0);
  const [device, setDevice] = useState<Device | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null); // null while nothing is being transcribed
  const [converting, setConverting] = useState(false);
  const [transcript, setTranscript] = useState('');

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

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    stopDragging();

    const dropped = event.dataTransfer.files[0];
    if (!dropped) return;
    setFile({ path: window.api.getPathForFile(dropped), name: dropped.name, size: dropped.size });
  };

  const chooseFile = async (): Promise<void> => {
    const chosen = await window.api.selectFile();
    if (chosen) setFile(chosen);
  };

  const startTranscription = async (): Promise<void> => {
    if (!file || !workerRef.current) return;

    setTranscript('');
    setConverting(true);
    try {
      const audio = await window.api.extractAudio(file.path);
      setProgress(0);
      workerRef.current.postMessage({ type: 'transcribe', audio } satisfies WorkerRequest, [audio.buffer]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setProgress(null);
    } finally {
      setConverting(false);
    }
  };

  const modelReady = device !== null;
  // Downloading is only half the wait: the weights still have to be parsed and compiled onto the GPU.
  const modelStage = modelError ? 'failed' : modelReady ? 'ready' : download >= 100 ? 'preparing' : 'downloading';

  return (
    // Dropping outside the zone would otherwise make the window navigate to the file.
    <div
      className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 p-8"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
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
          'items-center gap-4 border-2 border-dashed p-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        <UploadIcon className="size-8 text-muted-foreground" />
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
        <p className="text-center text-sm text-muted-foreground">
          Модель завантажена, готую до роботи — перший запуск триває кілька хвилин
        </p>
      )}

      {modelStage === 'failed' && <p className="text-center text-sm text-destructive">{modelError}</p>}

      {fallback && <p className="text-center text-xs text-muted-foreground">{fallback}</p>}

      {converting && <p className="text-center text-sm text-muted-foreground">Конвертація аудіо…</p>}

      {progress !== null && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Транскрипція</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      <Button disabled={!file || !modelReady || converting || progress !== null} onClick={startTranscription}>
        {converting || progress !== null ? 'Транскрибую…' : modelStage === 'ready' ? 'Транскрибувати' : 'Чекаю на модель…'}
      </Button>

      {transcript && <Textarea readOnly value={transcript} className="min-h-48" />}


      <Toaster />
    </div>
  );
}
