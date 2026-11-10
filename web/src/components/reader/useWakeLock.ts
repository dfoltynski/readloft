import { useEffect } from 'react';

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/** Holds a screen wake lock while `enabled`; re-acquires it when the tab becomes visible again. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !wakeLockSupported) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (stopped) void l.release();
        else lock = l;
      } catch {
        /* denied (e.g. low battery); try again on next visibility change */
      }
    };
    // The browser releases the lock whenever the page is hidden.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release();
    };
  }, [enabled]);
}
