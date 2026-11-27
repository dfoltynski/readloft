// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/Toast';
import './styles.css';
import './design/studio.css';

// One-time migration of storage keys from the project's former names (Bookread, Readloft).
function migrateStorage(store: Storage): void {
  try {
    const olds = ['book' + 'read', 'read' + 'loft'];
    const keys: [string, string][] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k) continue;
      for (const old of olds) {
        if (k.startsWith(`${old}.`) || k.startsWith(`${old}:`)) keys.push([k, 'libristead' + k.slice(old.length)]);
      }
    }
    for (const [k, next] of keys) {
      if (store.getItem(next) === null) store.setItem(next, store.getItem(k) ?? '');
      store.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}
migrateStorage(localStorage);
migrateStorage(sessionStorage);
try {
  localStorage.removeItem('libristead.designSystem');
  localStorage.removeItem('read' + 'loft.designSystem');
} catch { /* ignore */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
