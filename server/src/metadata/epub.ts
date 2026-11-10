import JSZip from 'jszip';
import path from 'node:path';
import { xml, arr, text, texts, stripHtml, toCover, type ExtractedMeta } from './util.ts';

function resolveHref(base: string, href: string): string {
  let h = href;
  try { h = decodeURIComponent(href); } catch { /* keep */ }
  h = h.split('#')[0];
  return path.posix.normalize(base ? `${base}/${h}` : h);
}

async function readText(zip: JSZip, name: string): Promise<string | null> {
  const f = zip.file(name) ?? zip.file(decodeURI(name));
  return f ? f.async('string') : null;
}

export async function extractEpub(bytes: Uint8Array): Promise<ExtractedMeta> {
  const zip = await JSZip.loadAsync(bytes);
  const container = await readText(zip, 'META-INF/container.xml');
  if (!container) return {};
  const c = xml.parse(container);
  const rf = arr(c?.container?.rootfiles?.rootfile)[0] as Record<string, unknown> | undefined;
  const opfPath = rf ? String(rf['@_full-path'] ?? '') : '';
  if (!opfPath) return {};
  const opfStr = await readText(zip, opfPath);
  if (!opfStr) return {};
  const opf = xml.parse(opfStr)?.package;
  if (!opf) return {};
  const md = opf.metadata ?? {};
  const baseDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);

  const out: ExtractedMeta = {};
  const title = texts(md.title)[0];
  if (title) out.title = title;
  const creators = texts(md.creator);
  if (creators.length) out.authors = creators;
  const desc = text(md.description);
  if (desc) out.description = stripHtml(desc);
  out.publisher = text(md.publisher) || null;
  out.language = text(md.language) || null;
  out.publishedAt = text(md.date) || null;

  for (const id of arr(md.identifier)) {
    const t = text(id);
    const scheme = typeof id === 'object' ? String((id as Record<string, unknown>)['@_scheme'] ?? '') : '';
    if (/isbn/i.test(t) || /isbn/i.test(scheme)) {
      const digits = t.replace(/^urn:isbn:/i, '').replace(/isbn:?/i, '').replace(/[\s-]/g, '');
      if (/^(\d{13}|\d{9}[\dXx])$/.test(digits)) { out.isbn = digits; break; }
    }
  }

  const metas = arr(md.meta) as unknown[];
  const metaObjs = metas.filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null);
  for (const m of metaObjs) {
    if (m['@_name'] === 'calibre:series' && m['@_content']) out.series = String(m['@_content']);
    if (m['@_name'] === 'calibre:series_index' && m['@_content']) {
      const n = parseFloat(String(m['@_content']));
      if (!Number.isNaN(n)) out.seriesIndex = n;
    }
  }
  if (!out.series) {
    const coll = metaObjs.find((m) => m['@_property'] === 'belongs-to-collection');
    if (coll) {
      const name = text(coll);
      if (name) {
        out.series = name;
        const cid = coll['@_id'];
        const pos = metaObjs.find((m) => m['@_property'] === 'group-position' && (!cid || m['@_refines'] === `#${cid}`));
        const n = pos ? parseFloat(text(pos)) : NaN;
        if (!Number.isNaN(n)) out.seriesIndex = n;
      }
    }
  }

  // Cover
  const items = arr(opf.manifest?.item) as Record<string, unknown>[];
  const isImg = (i: Record<string, unknown>) => String(i['@_media-type'] ?? '').startsWith('image/');
  let coverItem = items.find((i) => String(i['@_properties'] ?? '').split(/\s+/).includes('cover-image'));
  if (!coverItem) {
    const cm = metaObjs.find((m) => m['@_name'] === 'cover');
    if (cm) coverItem = items.find((i) => i['@_id'] === cm['@_content']);
  }
  if (!coverItem) {
    coverItem = items.find((i) => isImg(i) && /cover/i.test(`${i['@_id']} ${i['@_href']}`));
  }
  if (coverItem && coverItem['@_href']) {
    const p = resolveHref(baseDir, String(coverItem['@_href']));
    const f = zip.file(p);
    if (f) out.cover = toCover(await f.async('uint8array'));
  }
  return out;
}
