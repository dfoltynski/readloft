/**
 * Text + image extraction for read-aloud on PDFs, using the pdf.js build vendored with foliate-js.
 * foliate's own PDF book object doesn't expose its document, so we open the file a second time
 * (lazily, only when the user starts reading). pdf.js is loaded only via runtimeImport.
 */
import { runtimeImport } from './runtimeImport';
import { segmentSentences } from './readAloud';

const PDFJS_URL = '/foliate-js/vendor/pdfjs/pdf.mjs';
const PDFJS_DIR = '/foliate-js/vendor/pdfjs/';
/** Images covering less than this share of the page (icons, bullets, rules) are ignored. */
const MIN_IMAGE_AREA = 0.05;

interface TextItem { str: string; hasEOL?: boolean; transform: number[]; height?: number }
interface PdfPage {
  view: number[];
  getTextContent(): Promise<{ items: (TextItem | { type: string })[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> | void }
interface PdfJsLib {
  OPS: Record<string, number>;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDoc> };
}

async function loadLib(): Promise<PdfJsLib> {
  let lib = (globalThis as { pdfjsLib?: PdfJsLib }).pdfjsLib;
  if (!lib) {
    await runtimeImport(PDFJS_URL);
    lib = (globalThis as { pdfjsLib?: PdfJsLib }).pdfjsLib;
  }
  if (!lib) throw new Error('pdf.js is not available');
  if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = `${PDFJS_DIR}pdf.worker.mjs`;
  return lib;
}

export interface PdfPageText {
  sentences: string[];
  hasImage: boolean;
}

/** Joins pdf.js text items into paragraphs: de-hyphenates line breaks and splits on big vertical gaps. */
export function itemsToParagraphs(items: TextItem[]): string[] {
  const paras: string[] = [];
  let cur = '';
  let lastY: number | null = null;
  let lastH = 0;
  const endPara = () => { if (cur.trim()) paras.push(cur.trim()); cur = ''; };
  for (const it of items) {
    if (!it.str) continue; // pdf.js emits empty end-of-line markers; line changes are detected by y below
    const y = it.transform[5]!;
    const h = it.height || Math.abs(it.transform[3]!) || 10;
    if (lastY !== null && Math.abs(y - lastY) > 0.5 * h && cur) {
      // New line. A gap well beyond normal leading starts a new paragraph.
      const gap = Math.abs(y - lastY);
      if (gap > Math.max(h, lastH) * 2.1) endPara();
      else if (/\p{L}-\s*$/u.test(cur) && /^\p{Ll}/u.test(it.str.trimStart())) cur = cur.trimEnd().slice(0, -1);
      else if (!/\s$/.test(cur)) cur += ' ';
    }
    cur += it.str;
    if (it.hasEOL && !/-$/.test(cur) && !/\s$/.test(cur)) cur += ' ';
    else if (it.hasEOL && /-$/.test(cur) && !/\p{L}-$/u.test(cur)) cur += ' ';
    lastY = y;
    lastH = h;
  }
  endPara();
  return paras;
}

export class PdfSource {
  private cache = new Map<number, Promise<PdfPageText>>();
  private lib: PdfJsLib;
  private doc: PdfDoc;
  readonly numPages: number;

  private constructor(lib: PdfJsLib, doc: PdfDoc) {
    this.lib = lib;
    this.doc = doc;
    this.numPages = doc.numPages;
  }

  static async open(file: Blob): Promise<PdfSource> {
    const lib = await loadLib();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({
      data,
      cMapUrl: `${PDFJS_DIR}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_DIR}standard_fonts/`,
      isEvalSupported: false,
    }).promise;
    return new PdfSource(lib, doc);
  }

  /** Zero-based page. */
  page(index: number, lang = 'en'): Promise<PdfPageText> {
    let p = this.cache.get(index);
    if (!p) {
      p = this.extract(index, lang);
      this.cache.set(index, p);
      p.catch(() => this.cache.delete(index));
    }
    return p;
  }

  private async extract(index: number, lang: string): Promise<PdfPageText> {
    const page = await this.doc.getPage(index + 1);
    const [content, hasImage] = await Promise.all([page.getTextContent(), this.detectImage(page)]);
    const items = content.items.filter((i): i is TextItem => typeof (i as TextItem).str === 'string');
    const sentences = itemsToParagraphs(items).flatMap((para) => segmentSentences(para, lang));
    return { sentences, hasImage };
  }

  /** True when the page paints an image covering at least MIN_IMAGE_AREA of the page. */
  private async detectImage(page: PdfPage): Promise<boolean> {
    const O = this.lib.OPS;
    const imageOps = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintImageXObjectRepeat, O.paintJpegXObject].filter((x) => x !== undefined));
    const { fnArray, argsArray } = await page.getOperatorList();
    const pageArea = Math.abs((page.view[2]! - page.view[0]!) * (page.view[3]! - page.view[1]!)) || 1;
    type M = number[];
    const mul = (a: M, b: M): M => [
      a[0]! * b[0]! + a[2]! * b[1]!, a[1]! * b[0]! + a[3]! * b[1]!,
      a[0]! * b[2]! + a[2]! * b[3]!, a[1]! * b[2]! + a[3]! * b[3]!,
      a[0]! * b[4]! + a[2]! * b[5]! + a[4]!, a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
    ];
    let ctm: M = [1, 0, 0, 1, 0, 0];
    const stack: M[] = [];
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i]!;
      if (fn === O.save) stack.push(ctm);
      else if (fn === O.restore) ctm = stack.pop() ?? ctm;
      else if (fn === O.transform) ctm = mul(argsArray[i] as M, ctm);
      else if (imageOps.has(fn)) {
        // The image fills the unit square under the current matrix.
        const area = Math.abs(ctm[0]! * ctm[3]! - ctm[1]! * ctm[2]!);
        if (area / pageArea >= MIN_IMAGE_AREA) return true;
      }
    }
    return false;
  }

  destroy() {
    this.cache.clear();
    void this.doc.destroy();
  }
}
