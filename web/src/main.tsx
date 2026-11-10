import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/Toast';
import './styles.css';

// One-time migration of storage keys from the project's former name (Bookread).
function migrateStorage(store: Storage): void {
  try {
    const old = 'book' + 'read';
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && (k.startsWith(`${old}.`) || k.startsWith(`${old}:`))) keys.push(k);
    }
    for (const k of keys) {
      const next = 'readloft' + k.slice(old.length);
      if (store.getItem(next) === null) store.setItem(next, store.getItem(k) ?? '');
      store.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}
migrateStorage(localStorage);
migrateStorage(sessionStorage);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
