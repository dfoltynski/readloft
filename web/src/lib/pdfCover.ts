import type { Book } from '@shared/types';
import { api, fileUrl } from '../api';
import { runtimeImport } from './runtimeImport';

/**
 * The server can't render PDFs, so PDF covers are made in the browser:
 * render page 1 with the pdf.js build vendored by foliate-js, then upload it
 * as the book's cover. Runs once per book (the server keeps has_cover).
 */

const PDFJS_URL = '/foliate-js/vendor/pdfjs/pdf.mjs';
const WORKER_URL = '/foliate-js/vendor/pdfjs/pdf.worker.mjs';
const COVER_WIDTH = 600;

// Minimal slice of the pdf.js API we use.
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: object): { promise: Promise<PdfDoc> };
}
interface PdfDoc {
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= runtimeImport(PDFJS_URL).then(() => {
    // foliate-js's pdf.js build registers itself on globalThis.
    const lib = (globalThis as unknown as { pdfjsLib: PdfJs }).pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = new URL(WORKER_URL, window.location.origin).href;
    return lib;
  });
  return pdfjsPromise;
}

async function renderFirstPage(bookId: string): Promise<Blob> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({
    url: fileUrl(bookId),
    // Server supports Range: only fetch the bytes page 1 needs.
    disableAutoFetch: true,
    disableStream: true,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85),
    );
  } finally {
    await doc.destroy();
  }
}

const attempted = new Set<string>();
let queue: Promise<void> = Promise.resolve();

/**
 * Generate covers for PDFs that lack one, one at a time.
 * `onCover` fires after each successful upload so the UI can refresh.
 */
export function ensurePdfCovers(books: Book[], onCover: (book: Book) => void) {
  for (const book of books) {
    if (book.format !== 'pdf' || book.hasCover || attempted.has(book.id)) continue;
    attempted.add(book.id);
    queue = queue.then(async () => {
      try {
        const blob = await renderFirstPage(book.id);
        const updated = await api.setCover(book.id, new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
        onCover(updated);
      } catch (e) {
        console.warn(`PDF cover for "${book.title}" failed`, e);
      }
    });
  }
}
