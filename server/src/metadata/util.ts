import { XMLParser } from 'fast-xml-parser';

export interface ExtractedMeta {
  title?: string;
  authors?: string[];
  series?: string | null;
  seriesIndex?: number | null;
  description?: string | null;
  publisher?: string | null;
  language?: string | null;
  publishedAt?: string | null;
  isbn?: string | null;
  cover?: { data: Uint8Array; ext: string } | null;
}

export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
  trimValues: true,
});

export function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Extract text from a string / number / {#text} / array value. */
export function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('#text' in o) return text(o['#text']);
  }
  return '';
}

export function texts(v: unknown): string[] {
  return arr(v as unknown).map(text).filter(Boolean);
}

export function stripHtml(s: string): string {
  return s
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function detectImageExt(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  return null;
}

export function toCover(data: Uint8Array | null | undefined): { data: Uint8Array; ext: string } | null {
  if (!data) return null;
  const ext = detectImageExt(data);
  return ext ? { data, ext } : null;
}

export function splitAuthors(s: string): string[] {
  return s.split(/\s*(?:[,;]|\s&\s|\sand\s)\s*/i).map((x) => x.trim()).filter(Boolean);
}

export function fallbackMeta(filePath: string): { title: string; authors: string[] } {
  let name = filePath.split(/[\\/]/).pop() ?? filePath;
  name = name.replace(/\.fb2\.zip$/i, '').replace(/\.[^.]+$/, '');
  name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const m = name.match(/^(.{2,}?)\s+-\s+(.{2,})$/);
  if (m) return { title: m[2].trim(), authors: [m[1].trim()] };
  return { title: name || 'Untitled', authors: [] };
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
