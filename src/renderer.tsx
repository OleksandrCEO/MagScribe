import { createRoot } from 'react-dom/client';
import App from '@/App';
import './index.css';

// The command line runs the same bundle in a hidden window; it needs the worker, not the interface.
if (location.hash === '#cli') {
  void import('@/headless');
} else {
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element #root not found in index.html');
  createRoot(container).render(<App />);
}
