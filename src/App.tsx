import { useRef, useState, type DragEvent } from 'react';
import { FileVideoIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import type { SelectedFile } from '@/preload';
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
  // dragenter/dragleave also fire for children, so count the nesting instead of toggling on every event.
  const dragDepth = useRef(0);

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

  return (
    // Dropping outside the zone would otherwise make the window navigate to the file.
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 p-8"
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
          'w-full max-w-xl items-center gap-4 border-2 border-dashed p-10 text-center transition-colors',
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
        <div className="flex max-w-xl items-center gap-3 text-sm">
          <FileVideoIcon className="size-5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium" title={file.path}>
            {file.name}
          </span>
          <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
        </div>
      )}

      <Toaster />
    </div>
  );
}
