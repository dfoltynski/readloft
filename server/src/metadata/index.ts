import fs from 'node:fs/promises';
import type { BookFormat } from '../../../shared/types.ts';
import { fallbackMeta, type ExtractedMeta } from './util.ts';
import { extractEpub } from './epub.ts';
import { extractPdf } from './pdf.ts';
import { extractCbz } from './cbz.ts';
import { extractMobi } from './mobi.ts';
import { extractFb2, extractFbz } from './fb2.ts';

export type { ExtractedMeta };

export interface FullMeta extends ExtractedMeta {
  title: string;
  authors: string[];
}

export async function extractMetadata(absPath: string, format: BookFormat): Promise<FullMeta> {
  const fb = fallbackMeta(absPath);
  let m: ExtractedMeta = {};
  try {
    const bytes = new Uint8Array(await fs.readFile(absPath));
    switch (format) {
      case 'epub': m = await extractEpub(bytes); break;
      case 'pdf': m = await extractPdf(bytes); break;
      case 'cbz': m = await extractCbz(bytes); break;
      case 'mobi': case 'azw': case 'azw3': m = await extractMobi(bytes); break;
      case 'fb2': m = await extractFb2(bytes); break;
      case 'fbz': m = await extractFbz(bytes); break;
    }
  } catch (e) {
    console.warn(`[metadata] failed for ${absPath}: ${(e as Error).message}`);
  }
  const title = m.title?.trim() || fb.title;
  const authors = m.authors?.length ? m.authors : fb.authors;
  return { ...m, title, authors };
}
