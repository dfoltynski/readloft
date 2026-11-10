import JSZip from 'jszip';
import { xml, arr, text, stripHtml, toCover, type ExtractedMeta } from './util.ts';

function nameOf(a: Record<string, unknown>): string {
  const parts = [text(a['first-name']), text(a['middle-name']), text(a['last-name'])].filter(Boolean);
  return parts.length ? parts.join(' ') : text(a['nickname']);
}

function flatText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(flatText).join('\n');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !k.startsWith('@_'))
      .map(([, x]) => flatText(x)).join(' ');
  }
  return '';
}

export function extractFb2Xml(src: string): ExtractedMeta {
  const fb = xml.parse(src)?.FictionBook;
  if (!fb) return {};
  const out: ExtractedMeta = {};
  const ti = arr(fb.description?.['title-info'])[0] as Record<string, unknown> | undefined;
  if (!ti) return out;
  const title = text(ti['book-title']);
  if (title) out.title = title;
  const authors = arr(ti.author as unknown).map((a) => (typeof a === 'object' && a ? nameOf(a as Record<string, unknown>) : '')).filter(Boolean);
  if (authors.length) out.authors = authors;
  if (ti.annotation) out.description = stripHtml(flatText(ti.annotation)).trim() || null;
  out.language = text(ti.lang) || null;
  out.publishedAt = text(ti.date) || null;
  const seq = arr(ti.sequence as unknown)[0] as Record<string, unknown> | undefined;
  if (seq && typeof seq === 'object') {
    if (seq['@_name']) out.series = String(seq['@_name']);
    const n = parseFloat(String(seq['@_number'] ?? ''));
    if (!Number.isNaN(n)) out.seriesIndex = n;
  }
  const pi = arr(fb.description?.['publish-info'])[0] as Record<string, unknown> | undefined;
  if (pi) {
    out.publisher = text(pi.publisher) || null;
    out.isbn = text(pi.isbn) || null;
  }
  const img = arr((ti.coverpage as Record<string, unknown> | undefined)?.image as unknown)[0] as Record<string, unknown> | undefined;
  const href = img ? String(img['@_href'] ?? '').replace(/^#/, '') : '';
  if (href) {
    const bin = arr(fb.binary as unknown).find((b) => typeof b === 'object' && b && (b as Record<string, unknown>)['@_id'] === href) as Record<string, unknown> | undefined;
    if (bin) out.cover = toCover(Buffer.from(text(bin).replace(/\s+/g, ''), 'base64'));
  }
  return out;
}

export async function extractFb2(bytes: Uint8Array): Promise<ExtractedMeta> {
  return extractFb2Xml(Buffer.from(bytes).toString('utf8'));
}

export async function extractFbz(bytes: Uint8Array): Promise<ExtractedMeta> {
  const zip = await JSZip.loadAsync(bytes);
  const name = Object.keys(zip.files).find((n) => /\.fb2$/i.test(n));
  if (!name) return {};
  return extractFb2Xml(await zip.file(name)!.async('string'));
}
