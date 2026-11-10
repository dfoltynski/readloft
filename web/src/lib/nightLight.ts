import { useCallback, useEffect, useSyncExternalStore, useState } from 'react';

export type NightLightMode = 'off' | 'on' | 'schedule';

export interface NightLightSettings {
  mode: NightLightMode;
  /** Warm-filter strength, 0..100. */
  strength: number;
  /** Schedule start, 'HH:MM' (24h). */
  from: string;
  /** Schedule end, 'HH:MM' (24h). May be earlier than `from` (crosses midnight). */
  to: string;
  /** Extra brightness reduction in percent, 0..80. */
  dim: number;
}

export const DEFAULT_NIGHT_LIGHT: NightLightSettings = {
  mode: 'off', strength: 40, from: '20:00', to: '07:00', dim: 0,
};

export const NIGHT_LIGHT_KEY = 'readloft.nightlight';
/** Same-tab change notification (the `storage` event only fires in other tabs). */
const CHANGE_EVENT = 'readloft:nightlight';

const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
const isTime = (s: unknown): s is string => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);

function parse(raw: string | null): NightLightSettings {
  if (!raw) return DEFAULT_NIGHT_LIGHT;
  try {
    const o = JSON.parse(raw) as Partial<NightLightSettings>;
    const d = DEFAULT_NIGHT_LIGHT;
    return {
      mode: o.mode === 'on' || o.mode === 'schedule' ? o.mode : 'off',
      strength: clamp(o.strength, 0, 100, d.strength),
      from: isTime(o.from) ? o.from : d.from,
      to: isTime(o.to) ? o.to : d.to,
      dim: clamp(o.dim, 0, 80, d.dim),
    };
  } catch {
    return DEFAULT_NIGHT_LIGHT;
  }
}

// useSyncExternalStore needs a referentially stable snapshot: cache by raw string.
let cachedRaw: string | null | undefined;
let cached: NightLightSettings = DEFAULT_NIGHT_LIGHT;

export function loadNightLight(): NightLightSettings {
  let raw: string | null = null;
  try { raw = localStorage.getItem(NIGHT_LIGHT_KEY); } catch { /* ignore */ }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

export function saveNightLight(s: NightLightSettings) {
  try { localStorage.setItem(NIGHT_LIGHT_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const subscribe = (cb: () => void) => {
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === NIGHT_LIGHT_KEY) cb(); };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True when the filter should be showing at `now`. Handles ranges crossing midnight. */
export function isNightLightActive(s: NightLightSettings, now: Date = new Date()): boolean {
  if (s.mode === 'off') return false;
  if (s.mode === 'on') return true;
  const from = toMinutes(s.from);
  const to = toMinutes(s.to);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (from === to) return false;
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

export interface NightLight {
  settings: NightLightSettings;
  /** Whether the filter is showing right now (mode on, or schedule window). */
  active: boolean;
  update: (patch: Partial<NightLightSettings>) => void;
  /** Quick toggle: off -> on, anything else -> off. */
  toggle: () => void;
}

/** Shared, cross-component and cross-tab night light state. */
export function useNightLight(): NightLight {
  const settings = useSyncExternalStore(subscribe, loadNightLight, () => DEFAULT_NIGHT_LIGHT);
  // Re-evaluate the schedule every minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (settings.mode !== 'schedule') return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, [settings.mode]);

  const update = useCallback((patch: Partial<NightLightSettings>) => {
    saveNightLight({ ...loadNightLight(), ...patch });
  }, []);
  const toggle = useCallback(() => {
    update({ mode: loadNightLight().mode === 'off' ? 'on' : 'off' });
  }, [update]);

  return { settings, active: isNightLightActive(settings, now), update, toggle };
}
