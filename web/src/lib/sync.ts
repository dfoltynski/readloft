import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStatus } from '@shared/types';
import { api } from '../api';

/** Fired on window after "Sync now" finished, so pages can reload their data. */
export const SYNCED_EVENT = 'readloft:synced';

/** Polled sync status plus a "sync now" action. */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = () => api.syncStatus().then((s) => alive && setStatus(s), () => {});
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const syncNow = useCallback(async (): Promise<SyncStatus | null> => {
    if (busy.current) return null;
    busy.current = true;
    setSyncing(true);
    try {
      // Keep the spinner visible long enough to notice on fast local syncs.
      const [s] = await Promise.all([api.syncNow(), new Promise((r) => setTimeout(r, 700))]);
      setStatus(s);
      window.dispatchEvent(new Event(SYNCED_EVENT));
      return s;
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, []);

  return { status, syncing, syncNow };
}

/** Runs `fn` whenever a "Sync now" completes. */
export function useOnSynced(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(SYNCED_EVENT, h);
    return () => window.removeEventListener(SYNCED_EVENT, h);
  }, []);
}
