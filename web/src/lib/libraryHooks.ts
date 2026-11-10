import { useEffect, type RefObject } from 'react';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

interface ShortcutHandlers {
  onSearch: () => void;
  onUpload: () => void;
  onHelp: () => void;
}

/** Library-wide single-key shortcuts. Ignored while typing or with modifiers. */
export function useLibraryShortcuts({ onSearch, onUpload, onHelp }: ShortcutHandlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        onSearch();
      } else if (e.key === 'u') {
        e.preventDefault();
        onUpload();
      } else if (e.key === '?') {
        e.preventDefault();
        onHelp();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSearch, onUpload, onHelp]);
}

/**
 * Remembers the scroll offset of `ref` per `key` (sessionStorage) and restores it
 * once `ready` becomes true, so returning from a book lands where you left.
 */
export function useScrollRestore(ref: RefObject<HTMLElement>, key: string, ready: boolean) {
  const storageKey = `readloft.scroll:${key}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          sessionStorage.setItem(storageKey, String(el.scrollTop));
        } catch {
          /* ignore */
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, [ref, storageKey]);

  useEffect(() => {
    if (!ready || !ref.current) return;
    try {
      const saved = Number(sessionStorage.getItem(storageKey));
      ref.current.scrollTop = Number.isFinite(saved) ? saved : 0;
    } catch {
      /* ignore */
    }
  }, [ref, storageKey, ready]);
}
