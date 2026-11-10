import JSZip from 'jszip';
import { xml, text, naturalCompare, toCover, splitAuthors, type ExtractedMeta } from './util.ts';

export async function extractCbz(bytes: Uint8Array): Promise<ExtractedMeta> {
  const zip = await JSZip.loadAsync(bytes);
  const out: ExtractedMeta = {};
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const imgs = names
    .filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n))
    .sort(naturalCompare);
  if (imgs.length) out.cover = toCover(await zip.file(imgs[0])!.async('uint8array'));
  const ci = names.find((n) => /(^|\/)comicinfo\.xml$/i.test(n));
  if (ci) {
    try {
      const info = xml.parse(await zip.file(ci)!.async('string'))?.ComicInfo ?? {};
      const title = text(info.Title);
      if (title) out.title = title;
      const series = text(info.Series);
      if (series) {
        out.series = series;
        const n = parseFloat(text(info.Number));
        if (!Number.isNaN(n)) out.seriesIndex = n;
        if (!title) out.title = `${series}${text(info.Number) ? ' #' + text(info.Number) : ''}`;
      }
      const w = text(info.Writer);
      if (w) out.authors = splitAuthors(w);
      const sum = text(info.Summary);
      if (sum) out.description = sum;
      const pub = text(info.Publisher);
      if (pub) out.publisher = pub;
      if (text(info.Year)) out.publishedAt = text(info.Year);
      const lang = text(info.LanguageISO);
      if (lang) out.language = lang;
    } catch { /* ignore bad ComicInfo */ }
  }
  return out;
}
