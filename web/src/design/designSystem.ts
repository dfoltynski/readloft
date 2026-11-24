import { useSyncExternalStore } from 'react';

export type DesignSystem = 'classic' | 'studio';

const KEY = 'readloft.designSystem';
const FONTS_ID = 'readloft-studio-fonts';
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&family=Literata:opsz,wght@7..72,400;7..72,500;7..72,600&display=swap';

function read(): DesignSystem {
  try {
    return localStorage.getItem(KEY) === 'studio' ? 'studio' : 'classic';
  } catch {
    return 'classic';
  }
}

let current: DesignSystem = read();
const listeners = new Set<() => void>();

/** Google Fonts are optional: offline the stylesheet fails to load and the CSS falls back to system fonts. */
function ensureFonts(): void {
  if (document.getElementById(FONTS_ID)) return;
  const link = document.createElement('link');
  link.id = FONTS_ID;
  link.rel = 'stylesheet';
  link.href = FONTS_HREF;
  link.onerror = () => link.remove();
  document.head.appendChild(link);
}

/** Reflects the choice on <html data-ds>. Called at startup and on every change. */
export function applyDesignSystem(): void {
  document.documentElement.dataset.ds = current;
  if (current === 'studio') ensureFonts();
}

export const getDesignSystem = (): DesignSystem => current;

export function setDesignSystem(ds: DesignSystem): void {
  if (ds === current) return;
  current = ds;
  try {
    localStorage.setItem(KEY, ds);
  } catch {
    /* ignore */
  }
  applyDesignSystem();
  listeners.forEach((l) => l());
}

export const toggleDesignSystem = () => setDesignSystem(current === 'studio' ? 'classic' : 'studio');

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

export function useDesignSystem(): DesignSystem {
  return useSyncExternalStore(subscribe, getDesignSystem, getDesignSystem);
}
