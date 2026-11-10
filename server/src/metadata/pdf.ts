import { PDFDocument } from 'pdf-lib';
import { splitAuthors, type ExtractedMeta } from './util.ts';

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedMeta> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const out: ExtractedMeta = {};
  const t = doc.getTitle()?.trim();
  if (t) out.title = t;
  const a = doc.getAuthor()?.trim();
  if (a) out.authors = splitAuthors(a);
  const s = doc.getSubject()?.trim();
  if (s) out.description = s;
  return out;
}
