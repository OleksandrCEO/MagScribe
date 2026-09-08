import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

export default function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Transcriber</h1>
      <Button onClick={() => toast.success('shadcn/ui працює')}>Кнопка shadcn</Button>
      <Toaster />
    </div>
  );
}
