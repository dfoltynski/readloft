// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-aloud engine on top of the Web Speech API (`speechSynthesis`) and foliate's renderer.
 *
 * Why not foliate's tts.js: it emits SSML (which speechSynthesis cannot speak) and cannot skip
 * tables/images/code or emit cues, so we walk the section DOM ourselves and speak sentence-sized
 * utterances (this also avoids Chrome's "stops after ~15s" bug).
 *
 * What is read: paragraph/heading/list/caption text. What is skipped, with a spoken cue
 * ("Image.", "Table.", "Equation.", "Code block.", "Video."): img, svg, picture, canvas, object,
 * embed, video, audio, math, table (including its caption), pre. Figure captions (figcaption) ARE
 * read. Inline images inside a line of text are skipped silently so sentences aren't interrupted.
 */
import type { FoliateView } from '../foliate';
import type { PdfSource } from './pdfText';

export type TtsStatus = 'idle' | 'playing' | 'paused';

export interface TtsNotice {
  label: string;
  /** Element in the live section document; may be stale after a section change. Null for PDFs. */
  el: Element | null;
  index: number;
}

export interface TtsState {
  status: TtsStatus;
  notice: TtsNotice | null;
  error: string | null;
}

export interface TtsOptions {
  rate: number;
  voice: SpeechSynthesisVoice | null;
  pauseAtMedia: boolean;
}

type Item =
  | { kind: 'text'; range: Range | null; text: string }
  | { kind: 'cue'; label: string; el: Element | null; speech?: string };

const ABBREV = /(?:^|[\s("“])(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|vs|etc|No|Fig|Vol|Rev|Gen|Col|Capt|Lt|Sgt|Hon|Inc|Ltd|Co|e\.g|i\.e|cf|approx)\.$/;
const HIGHLIGHT = 'libristead-tts';
const MAX_CHUNK = 220;
const NOTICE_MS = 12000;

const BLOCK_TAGS = new Set([
  'article', 'aside', 'blockquote', 'caption', 'details', 'dialog', 'div', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'ul', 'p', 'section', 'tr', 'br', 'body',
]);
const SKIP_TAGS = new Set(['script', 'style', 'head', 'template', 'noscript', 'rt', 'rp']);
const CUES: Record<string, string> = {
  img: 'Image', svg: 'Image', picture: 'Image', canvas: 'Image', object: 'Image', embed: 'Image',
  video: 'Video', audio: 'Audio', math: 'Equation', table: 'Table', pre: 'Code block',
};

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  && typeof SpeechSynthesisUtterance !== 'undefined';

function isNoteRef(el: Element): boolean {
  const t = `${el.getAttribute('epub:type') ?? ''} ${el.getAttribute('role') ?? ''}`;
  return /noteref/.test(t);
}

/** Builds the ordered list of sentences and media cues for one section document. */
export function buildItems(doc: Document): Item[] {
  const win = doc.defaultView;
  const lang = doc.documentElement.lang || 'en';
  let segmenter: Intl.Segmenter;
  try { segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' }); }
  catch { segmenter = new Intl.Segmenter('en', { granularity: 'sentence' }); }

  const items: Item[] = [];
  let nodes: Text[] = [];

  const flush = () => {
    if (!nodes.length) return;
    const strs = nodes.map((n) => n.data);
    const full = strs.join('');
    const starts: number[] = [];
    let sum = 0;
    for (const s of strs) { starts.push(sum); sum += s.length; }
    const locate = (offset: number, isEnd: boolean): [Text, number] => {
      let idx = 0;
      for (let i = 0; i < starts.length; i++) if (isEnd ? starts[i]! < offset : starts[i]! <= offset) idx = i;
      return [nodes[idx]!, Math.min(Math.max(offset - starts[idx]!, 0), strs[idx]!.length)];
    };
    // Intl.Segmenter splits after abbreviations such as "Dr." — glue those back onto the next sentence.
    const segs: { index: number; segment: string }[] = [];
    for (const seg of segmenter.segment(full)) {
      const prev = segs[segs.length - 1];
      if (prev && ABBREV.test(prev.segment.trimEnd())) prev.segment += seg.segment;
      else segs.push({ index: seg.index, segment: seg.segment });
    }
    for (const seg of segs) {
      const text = seg.segment.replace(/­/g, '').replace(/\s+/g, ' ').trim();
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const lead = seg.segment.length - seg.segment.trimStart().length;
      const trail = seg.segment.length - seg.segment.trimEnd().length;
      const range = doc.createRange();
      const [sn, so] = locate(seg.index + lead, false);
      const [en, eo] = locate(seg.index + seg.segment.length - trail, true);
      range.setStart(sn, so);
      range.setEnd(en, eo);
      items.push({ kind: 'text', range, text });
    }
    nodes = [];
  };

  const pushCue = (label: string, el: Element) => {
    flush();
    const last = items[items.length - 1];
    if (last?.kind === 'cue' && last.label === label) return; // collapse runs of images
    items.push({ kind: 'cue', label, el });
  };

  const visit = (el: Element) => {
    const tag = el.localName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return;
    const style = win?.getComputedStyle(el);
    if (style?.display === 'none') return;
    const cue = CUES[tag];
    if (cue) {
      // Inline = sits inside a line of text (the parent has its own text nodes), e.g. an icon or emoji.
      const inline = !!style?.display.startsWith('inline') && !!el.parentElement
        && Array.from(el.parentElement.childNodes).some((n) => n.nodeType === 3 && (n.nodeValue ?? '').trim());
      if (cue === 'Image' && inline && tag !== 'object') return; // icon / emoji inside text
      pushCue(cue, el);
      return;
    }
    if (isNoteRef(el)) return;
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) nodes.push(c as Text);
      else if (c.nodeType === 1) visit(c as Element);
    }
    if (block) flush();
  };

  if (doc.body) visit(doc.body);
  flush();
  return items;
}

/** Sentence-splits plain text (glues abbreviations like "Dr." back onto the next sentence). */
export function segmentSentences(text: string, lang: string): string[] {
  let segmenter: Intl.Segmenter;
  try { segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' }); }
  catch { segmenter = new Intl.Segmenter('en', { granularity: 'sentence' }); }
  const segs: string[] = [];
  for (const seg of segmenter.segment(text)) {
    const prev = segs[segs.length - 1];
    if (prev !== undefined && ABBREV.test(prev.trimEnd())) segs[segs.length - 1] = prev + seg.segment;
    else segs.push(seg.segment);
  }
  return segs.map((x) => x.replace(/­/g, '').replace(/\s+/g, ' ').trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
}

/** Splits long text at clause boundaries so each utterance stays short (Chrome cuts off long ones). */
export function chunkText(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK) {
    const window = rest.slice(0, MAX_CHUNK);
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(' — '));
    if (cut < MAX_CHUNK / 3) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = MAX_CHUNK;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Picks the best voice for a BCP-47 language: same language, local, enhanced/premium first. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string | undefined): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const want = (lang || navigator.language || 'en').toLowerCase();
  const base = want.split('-')[0]!;
  const score = (v: SpeechSynthesisVoice) => {
    const vl = v.lang.toLowerCase().replace('_', '-');
    let s = 0;
    if (vl === want) s += 100;
    else if (vl.split('-')[0] === base) s += 60;
    if (v.localService) s += 20;
    if (/enhanced|premium|siri|natural|neural/i.test(v.name)) s += 10;
    if (v.default) s += 3;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

const norm = (s: string) => s.normalize('NFKC').replace(/[\s\u00ad-]+/g, '').toLowerCase();

/** Text at/after a range start (selection, or the clicked text run) used to find a PDF sentence. */
function rangeHint(r: Range): string {
  const sel = r.toString();
  if (sel.trim()) return sel;
  const n = r.startContainer;
  return n.nodeType === 3 ? (n as Text).data.slice(r.startOffset) : (n.textContent ?? '');
}

export class ReadAloud {
  private view: FoliateView;
  private opts: TtsOptions;
  private listener: (s: TtsState) => void;
  private state: TtsState = { status: 'idle', notice: null, error: null };
  private items: Item[] = [];
  private doc: Document | null = null;
  private sectionIndex = -1;
  private pos = 0;
  private gen = 0; // bumped to invalidate in-flight utterance callbacks
  private noticeTimer = 0;
  private busy = false;
  private spoken = false;
  private skipped = 0;
  private pdfOpen: (() => Promise<PdfSource>) | null;
  private pdf: PdfSource | null = null;
  private pageIndex = 0;
  private lang: string;
  private started = false;

  /** `openPdf` switches the engine to PDF mode: text comes from pdf.js instead of the section DOM. */
  constructor(view: FoliateView, opts: TtsOptions, listener: (s: TtsState) => void, openPdf?: () => Promise<PdfSource>, lang?: string) {
    this.view = view;
    this.opts = opts;
    this.listener = listener;
    this.pdfOpen = openPdf ?? null;
    this.lang = lang || 'en';
  }

  get status() { return this.state.status; }

  setOptions(opts: Partial<TtsOptions>) {
    const changed = (opts.rate !== undefined && opts.rate !== this.opts.rate)
      || (opts.voice !== undefined && opts.voice !== this.opts.voice);
    this.opts = { ...this.opts, ...opts };
    if (changed && this.state.status === 'playing') void this.speakCurrent();
  }

  private emit(patch: Partial<TtsState>) {
    this.state = { ...this.state, ...patch };
    this.listener(this.state);
  }

  private contents() {
    return (this.view.renderer.getContents?.() ?? [])[0];
  }

  /** Loads the items of the currently displayed section. */
  private async loadSection(): Promise<boolean> {
    if (this.pdfOpen) return this.loadPdfPage();
    const c = this.contents();
    if (!c) return false;
    if (c.doc !== this.doc) {
      this.clearHighlight();
      this.doc = c.doc;
      this.sectionIndex = c.index;
      this.items = buildItems(c.doc);
      this.ensureStyle(c.doc);
    }
    return true;
  }

  private async loadPdfPage(): Promise<boolean> {
    this.pdf ??= await this.pdfOpen!();
    const src = this.pdf;
    if (this.pageIndex < 0 || this.pageIndex >= src.numPages) return false;
    const idx = this.pageIndex;
    const pg = await src.page(idx, this.lang);
    this.sectionIndex = idx;
    const items: Item[] = [];
    if (pg.hasImage && (pg.sentences.length || this.spoken)) {
      items.push({ kind: 'cue', label: 'Image', el: null, speech: 'This page has an image.' });
    }
    for (const text of pg.sentences) items.push({ kind: 'text', range: null, text });
    this.items = items;
    if (idx + 1 < src.numPages) void src.page(idx + 1, this.lang).catch(() => {}); // prefetch
    return true;
  }

  private ensureStyle(doc: Document) {
    if (doc.getElementById('libristead-tts-style')) return;
    const st = doc.createElement('style');
    st.id = 'libristead-tts-style';
    st.textContent = `::highlight(${HIGHLIGHT}) { background-color: rgba(255, 200, 40, 0.45); color: inherit; }`;
    doc.head?.append(st);
  }

  private highlight(range: Range | null) {
    const win = this.doc?.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown }) | null;
    const reg = win?.CSS?.highlights;
    if (!reg || !win?.Highlight) return;
    if (range) reg.set(HIGHLIGHT, new win.Highlight(range));
    else reg.delete(HIGHLIGHT);
  }

  private clearHighlight() { this.highlight(null); }

  /**
   * Starts reading. `from` is a range in the current section (selection / clicked point / visible
   * page start); null starts at the first sentence of the current section.
   */
  async start(from: Range | null, hint?: string) {
    if (!speechSupported) return;
    this.cancelSpeech();
    this.spoken = false;
    this.started = false;
    this.skipped = 0;
    this.emit({ status: 'playing', notice: null, error: null });
    if (this.pdfOpen) {
      const g = this.gen;
      try {
        this.pageIndex = Math.max(0, (this.view.renderer as { index?: number }).index ?? 0);
        if (!(await this.loadSection())) return this.fail('Nothing to read here.');
      } catch (e) {
        console.error(e);
        if (g === this.gen) this.fail('Could not read the text of this PDF.');
        return;
      }
      if (g !== this.gen) return;
      this.pos = 0;
      const needle = norm(hint ?? (from ? rangeHint(from) : '')).slice(0, 24);
      if (needle.length >= 4) {
        const i = this.items.findIndex((it) => it.kind === 'text' && norm(it.text).includes(needle));
        if (i >= 0) this.pos = i;
        else if (this.items[0]?.kind === 'cue') this.pos = 0;
      }
      await this.run();
      return;
    }
    if (!(await this.loadSection())) return this.fail('Nothing to read here.');
    this.pos = 0;
    if (from) {
      const i = this.items.findIndex((it) => {
        const r = it.kind === 'text' ? it.range! : this.rangeOf(it.el!);
        return from.compareBoundaryPoints(Range.END_TO_START, r) < 0; // `from` starts before the item ends
      });
      this.pos = i < 0 ? this.items.length : i;
    }
    await this.run();
  }

  private rangeOf(el: Element): Range {
    const r = el.ownerDocument.createRange();
    r.selectNode(el);
    return r;
  }

  pause() {
    if (this.state.status !== 'playing') return;
    this.emit({ status: 'paused' });
    speechSynthesis.pause();
  }

  resume() {
    if (this.state.status !== 'paused') return;
    this.emit({ status: 'playing' });
    speechSynthesis.resume();
    // Some engines silently drop a paused utterance: if nothing is speaking, say the sentence again.
    const g = this.gen;
    window.setTimeout(() => {
      if (g === this.gen && this.state.status === 'playing' && !speechSynthesis.speaking && !this.busy) void this.speakCurrent();
    }, 300);
  }

  stop() {
    this.cancelSpeech();
    this.clearHighlight();
    window.clearTimeout(this.noticeTimer);
    this.emit({ status: 'idle', notice: null });
  }

  /** Skip by whole sentences (cues count as steps). */
  async step(delta: 1 | -1) {
    if (this.state.status === 'idle') return;
    const wasPaused = this.state.status === 'paused';
    this.cancelSpeech();
    if (wasPaused) this.emit({ status: 'playing' });
    this.pos += delta;
    if (this.pos < 0) {
      if (!(await this.changeSection(-1))) { this.pos = 0; }
      else this.pos = this.items.length - 1;
    }
    await this.run();
  }

  private cancelSpeech() {
    this.gen++;
    if (speechSynthesis.speaking || speechSynthesis.pending || speechSynthesis.paused) {
      const wasPaused = speechSynthesis.paused;
      speechSynthesis.cancel();
      if (wasPaused) speechSynthesis.resume(); // Safari keeps the paused flag across cancel()
    }
  }

  private fail(message: string) {
    this.cancelSpeech();
    this.clearHighlight();
    this.emit({ status: 'idle', error: message });
  }

  /** Moves the renderer to the next/previous linear section. Returns false at the book's ends. */
  private async changeSection(dir: 1 | -1): Promise<boolean> {
    if (this.pdfOpen) {
      const next = this.pageIndex + dir;
      if (!this.pdf || next < 0 || next >= this.pdf.numPages) return false;
      this.pageIndex = next;
      try { await (this.view.renderer as { goTo?: (t: { index: number }) => Promise<void> }).goTo?.({ index: next }); }
      catch { /* keep reading even if the page view can't follow */ }
      try { return await this.loadSection(); } catch { return false; }
    }
    const before = this.contents()?.index;
    try {
      await (dir === 1 ? this.view.renderer.nextSection?.() : this.view.renderer.prevSection?.());
    } catch { return false; }
    const c = this.contents();
    if (!c || c.index === before) return false;
    await this.loadSection();
    return true;
  }

  private async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      const g = this.gen;
      // Advance past empty sections / end of section.
      while (this.pos >= this.items.length) {
        if (g !== this.gen) return;
        const noText = 'This PDF has no text layer to read';
        // A scanned PDF has no text on any page: give up early instead of walking every page.
        if (this.pdfOpen && !this.spoken && ++this.skipped >= 5) return this.fail(noText);
        if (!(await this.changeSection(1))) {
          if (this.spoken) this.stop();
          else this.fail(this.pdfOpen ? noText : 'No readable text found.');
          return;
        }
        this.pos = 0;
      }
      if (g !== this.gen) return;
    } finally { this.busy = false; }
    await this.speakCurrent();
  }

  private async speakCurrent() {
    const item = this.items[this.pos];
    if (!item || (!this.doc && !this.pdfOpen)) return;
    const g = ++this.gen;
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel(); // never queue on top of old speech
    if (item.kind === 'cue') return this.speakCue(item, g);
    this.spoken = true;
    if (item.range) {
      this.highlight(item.range);
      void this.view.renderer.scrollToAnchor?.(item.range, true);
    }
    const chunks = chunkText(item.text);
    const next = (i: number) => {
      if (g !== this.gen) return;
      if (i >= chunks.length) return this.advance(g);
      const u = new SpeechSynthesisUtterance(chunks[i]);
      u.rate = this.opts.rate;
      if (this.opts.voice) { u.voice = this.opts.voice; u.lang = this.opts.voice.lang; }
      else if (this.doc?.documentElement.lang) u.lang = this.doc.documentElement.lang;
      u.onstart = () => { this.started = true; };
      u.onend = () => next(i + 1);
      u.onerror = (e) => {
        if (g !== this.gen || e.error === 'interrupted' || e.error === 'canceled') return;
        this.fail(`Speech stopped (${e.error}).`);
      };
      speechSynthesis.speak(u);
      if (!this.started) this.watchStart(g);
    };
    // Chrome sometimes ignores speak() right after cancel(); a tick in between avoids it.
    window.setTimeout(() => next(0), 30);
  }

  /** Warns when the first utterance never starts (no voices installed, speech blocked by the OS). */
  private watchStart(g: number) {
    window.setTimeout(() => {
      if (g !== this.gen || this.started || this.state.status !== 'playing') return;
      if (speechSynthesis.paused) return;
      this.fail('Speech didn’t start. Check that a text-to-speech voice is installed and enabled on this device.');
    }, 5000);
  }

  private speakCue(item: Extract<Item, { kind: 'cue' }>, g: number) {
    window.clearTimeout(this.noticeTimer);
    this.emit({ notice: { label: item.label, el: item.el, index: this.sectionIndex } });
    this.noticeTimer = window.setTimeout(() => this.emit({ notice: null }), NOTICE_MS);
    const u = new SpeechSynthesisUtterance(item.speech ?? `${item.label}.`);
    u.rate = this.opts.rate;
    if (this.opts.voice) { u.voice = this.opts.voice; u.lang = this.opts.voice.lang; }
    u.onstart = () => { this.started = true; };
    u.onend = () => {
      if (g !== this.gen) return;
      if (this.opts.pauseAtMedia) {
        this.pos++;
        this.revealNotice();
        return;
      }
      this.advance(g);
    };
    u.onerror = (e) => {
      if (g !== this.gen || e.error === 'interrupted' || e.error === 'canceled') return;
      this.advance(g);
    };
    window.setTimeout(() => {
      if (g !== this.gen) return;
      speechSynthesis.speak(u);
      if (!this.started) this.watchStart(g);
    }, 30);
  }

  private advance(g: number) {
    if (g !== this.gen) return;
    this.pos++;
    void this.run();
  }

  /** Pause reading and bring the skipped image/table into view ("tap to view"). */
  revealNotice() {
    const n = this.state.notice;
    this.cancelSpeech();
    this.emit({ status: 'paused' });
    if (n?.el && this.contents()?.index === n.index) void this.view.renderer.scrollToAnchor?.(n.el, false);
  }

  destroy() {
    this.stop();
    this.pdf?.destroy();
    this.pdf = null;
    this.listener = () => {};
  }
}
