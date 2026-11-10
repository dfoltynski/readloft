import type { Book } from '@shared/types';

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
};

export const formatPercent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

export const authorLine = (book: Book): string => book.authors.join(', ');

export const seriesLine = (book: Book): string | null =>
  book.series ? (book.seriesIndex != null ? `${book.series} #${book.seriesIndex}` : book.series) : null;

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic gradient for books without a cover. */
export function generatedCoverBackground(title: string): string {
  const h = hashString(title);
  const hue1 = h % 360;
  const hue2 = (hue1 + 30 + ((h >> 8) % 50)) % 360;
  return `linear-gradient(155deg, hsl(${hue1} 45% 38%), hsl(${hue2} 50% 24%))`;
}

/** "3 days ago" style relative time. Returns '' for missing/invalid dates. */
export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const seconds = Math.round((t - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** Split a plain-text description into paragraphs on newlines / blank lines. */
export const splitParagraphs = (text: string): string[] =>
  text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
