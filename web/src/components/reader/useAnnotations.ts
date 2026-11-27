// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationColor } from '@shared/types';
import { api } from '../../api';
import { COLOR_HEX } from '../../lib/annotations';
import type { FoliateView } from '../../foliate';
import { makeMark, pointInRect, reflowColumnRight, type RectLike } from './annotationMarks';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYER_ID = 'rl-ann-layer';

export interface SelInfo {
  doc: Document;
  index: number;
  range: Range;
  text: string;
  /** Viewport coordinates of the selection's first line. */
  rect: { left: number; right: number; top: number; bottom: number };
  /** Set when the selection lies inside an existing annotation. */
  existingId: string | null;
}

export type ComposerState =
  | { kind: 'new'; sel: SelInfo; note: string; color: AnnotationColor; y: number }
  | { kind: 'edit'; id: string; note: string; color: AnnotationColor; y: number };

export interface PeekState { id: string; y: number }
export interface HoverState { x: number; y: number; text: string }

interface Drawn { doc: Document; range: Range; hit: RectLike[] }

interface Options {
  bookId: string;
  getView: () => FoliateView | null;
  ready: boolean;
  showHighlights: boolean;
  getPosition: () => { fraction: number; label: string; cfi?: string };
  /** Collapsed fallback CFI for the current page. */
  pageCfi: (cfi: string) => string;
  toast: (message: string, kind?: 'info' | 'error', options?: { action?: { label: string; onClick: () => void }; duration?: number }) => void;
}

const byProgress = (a: Annotation, b: Annotation) => a.progress - b.progress || a.createdAt.localeCompare(b.createdAt);
const noop = () => {};

const frameOffset = (doc: Document) => {
  const f = doc.defaultView?.frameElement;
  const r = f ? f.getBoundingClientRect() : { left: 0, top: 0 };
  return { x: r.left, y: r.top };
};

/** Notes & highlights for the open book: data, drawing in the page, selection toolbar, composer and peek card. */
export function useAnnotations(opts: Options) {
  const { bookId, ready, showHighlights } = opts;
  const o = useRef(opts);
  o.current = opts;

  const [anns, setAnns] = useState<Annotation[]>([]);
  const [sel, setSel] = useState<SelInfo | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [peek, setPeek] = useState<PeekState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const annsRef = useRef(anns); annsRef.current = anns;
  const selRef = useRef(sel); selRef.current = sel;
  const composerRef = useRef(composer); composerRef.current = composer;
  const peekRef = useRef(peek); peekRef.current = peek;
  const hoverId = useRef<string | null>(null);
  const drawn = useRef(new Map<string, Drawn>());
  const shown = useRef(new Map<string, string>());
  const fixedDocs = useRef(new Map<Document, { index: number; mo: MutationObserver; timer?: number }>());
  const resolved = useRef(new Map<string, { index: number; anchor: (doc: Document) => Range } | null>());

  // ---- load ----
  useEffect(() => {
    let stale = false;
    setAnns([]); setSel(null); setComposer(null); setPeek(null);
    drawn.current.clear(); shown.current.clear(); resolved.current.clear();
    api.listAnnotations(bookId).then((l) => { if (!stale) setAnns(l); }, () => { /* non-fatal */ });
    return () => { stale = true; };
  }, [bookId]);

  // ---- drawing: reflowable books go through foliate's overlayer ----
  const drawOne = useCallback((view: FoliateView, a: Annotation) => {
    shown.current.set(a.id, a.cfi);
    view.addAnnotation({ value: a.cfi, id: a.id, color: a.color, hasNote: !!a.note, fill: o.current.showHighlights }).catch(noop);
  }, []);

  useEffect(() => {
    const view = o.current.getView();
    if (!ready || !view || view.isFixedLayout) return;
    const onDraw = (e: Event) => {
      const { draw, annotation, doc, range } = (e as CustomEvent).detail as {
        draw: (fn: (rects: ArrayLike<RectLike>) => SVGElement, opts: object) => void;
        annotation: { id: string; color: AnnotationColor; hasNote: boolean; fill: boolean };
        doc: Document; range: Range;
      };
      draw((rects) => {
        const m = makeMark(rects, {
          color: COLOR_HEX[annotation.color] ?? COLOR_HEX.yellow, fill: annotation.fill, hasNote: annotation.hasNote,
          columnRight: (r) => reflowColumnRight(doc, r),
          ns: (t) => document.createElementNS(SVG_NS, t) as SVGElement,
        });
        drawn.current.set(annotation.id, { doc, range, hit: m.hit });
        return m.el;
      }, {});
    };
    const onOverlay = () => { for (const a of annsRef.current) drawOne(view, a); };
    view.addEventListener('draw-annotation', onDraw);
    view.addEventListener('create-overlay', onOverlay);
    onOverlay();
    return () => {
      view.removeEventListener('draw-annotation', onDraw);
      view.removeEventListener('create-overlay', onOverlay);
    };
  }, [ready, bookId, drawOne]);

  useEffect(() => {
    const view = o.current.getView();
    if (!ready || !view || view.isFixedLayout) return;
    const cur = new Set(anns.map((a) => a.id));
    for (const [id, value] of [...shown.current]) {
      if (cur.has(id)) continue;
      shown.current.delete(id);
      drawn.current.delete(id);
      view.deleteAnnotation({ value }).catch(noop);
    }
    for (const a of anns) drawOne(view, a);
  }, [anns, showHighlights, ready, drawOne]);

  // ---- drawing: fixed layout (PDF, comics) has no overlayer, so paint an SVG layer inside each page document ----
  const paintFixed = useCallback((doc: Document, index: number) => {
    const view = o.current.getView();
    if (!doc.defaultView || !doc.body || !view) { fixedDocs.current.delete(doc); return; }
    doc.getElementById(LAYER_ID)?.remove();
    for (const [id, d] of [...drawn.current]) if (d.doc === doc) drawn.current.delete(id);
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.id = LAYER_ID;
    Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '20', overflow: 'visible' });
    doc.body.append(svg);
    // pdf.js renders the page at device-pixel scale and shrinks <html> with a CSS transform, while
    // client rects are in viewport space: undo that scale inside the layer.
    const k = (svg as SVGSVGElement).getScreenCTM()?.a || 1;
    const layerG = doc.createElementNS(SVG_NS, 'g');
    layerG.setAttribute('transform', `scale(${1 / k})`);
    svg.append(layerG);
    const pageW = doc.documentElement.clientWidth;
    let maxRight = 0;
    const layer = doc.querySelector('.textLayer');
    if (layer) for (const c of Array.from(layer.querySelectorAll('span'))) { if (!c.textContent?.trim()) continue; const r = c.getBoundingClientRect(); if (r.width > 0) maxRight = Math.max(maxRight, r.right); }
    const colRight = Math.min((maxRight || pageW - 24) + 1, pageW - 12);
    for (const a of annsRef.current) {
      let r = resolved.current.get(a.cfi);
      if (r === undefined) {
        try {
          const x = view.resolveCFI(a.cfi);
          r = x && !(x instanceof Promise) ? x : null;
        } catch { r = null; }
        resolved.current.set(a.cfi, r);
      }
      if (!r || r.index !== index) continue;
      let range: Range;
      try { range = r.anchor(doc); } catch { continue; }
      const m = makeMark(range.getClientRects(), {
        color: COLOR_HEX[a.color], fill: o.current.showHighlights, hasNote: !!a.note,
        columnRight: () => colRight, ns: (t) => doc.createElementNS(SVG_NS, t) as SVGElement,
      });
      layerG.append(m.el);
      drawn.current.set(a.id, { doc, range, hit: m.hit });
    }
  }, []);

  useEffect(() => {
    for (const [doc, d] of [...fixedDocs.current]) paintFixed(doc, d.index);
  }, [anns, showHighlights, paintFixed]);

  // ---- mutations ----
  const createFrom = useCallback(async (s: SelInfo, note: string, color: AnnotationColor) => {
    const { getView, getPosition, pageCfi, toast } = o.current;
    const view = getView();
    const pos = getPosition();
    let cfi = '';
    try { cfi = view ? view.getCFI(s.index, s.range) : ''; } catch { /* fall back below */ }
    if (!cfi && pos.cfi) cfi = pageCfi(pos.cfi);
    if (!cfi) { toast('Could not save: no location for this selection', 'error'); return; }
    try {
      const created = await api.createAnnotation(bookId, {
        cfi, text: s.text.slice(0, 5000), note, color, progress: pos.fraction, chapter: pos.label || null,
      });
      setAnns((l) => [...l, created].sort(byProgress));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }, [bookId]);

  const patch = useCallback(async (id: string, p: { note?: string; color?: AnnotationColor }) => {
    const prev = annsRef.current.find((a) => a.id === id);
    if (!prev) return;
    setAnns((l) => l.map((a) => (a.id === id ? { ...a, ...p } : a)));
    try {
      const saved = await api.patchAnnotation(id, p);
      setAnns((l) => l.map((a) => (a.id === id ? saved : a)));
    } catch (e) {
      setAnns((l) => l.map((a) => (a.id === id ? prev : a)));
      o.current.toast((e as Error).message, 'error');
    }
  }, []);

  const remove = useCallback((id: string) => {
    const gone = annsRef.current.find((a) => a.id === id);
    if (!gone) return;
    setAnns((l) => l.filter((a) => a.id !== id));
    setPeek((p) => (p?.id === id ? null : p));
    api.deleteAnnotation(id).then(() => {
      o.current.toast('Annotation deleted', 'info', {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            api.createAnnotation(gone.bookId, {
              id: gone.id, cfi: gone.cfi, text: gone.text, note: gone.note, color: gone.color, progress: gone.progress, chapter: gone.chapter,
            }).then((a) => { if (gone.bookId === bookId) setAnns((l) => [...l.filter((x) => x.id !== a.id), a].sort(byProgress)); })
              .catch((e: Error) => o.current.toast(e.message, 'error'));
          },
        },
      });
    }, (e: Error) => {
      setAnns((l) => [...l, gone].sort(byProgress));
      o.current.toast(e.message, 'error');
    });
  }, [bookId]);

  // ---- selection ----
  const selectionFrom = useCallback((doc: Document, index: number, range: Range): SelInfo | null => {
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const off = frameOffset(doc);
    const first = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const box = range.getBoundingClientRect();
    let existingId: string | null = null;
    for (const [id, d] of drawn.current) {
      if (d.doc !== doc) continue;
      try {
        if (d.range.compareBoundaryPoints(Range.START_TO_START, range) <= 0 && d.range.compareBoundaryPoints(Range.END_TO_END, range) >= 0) existingId = id;
      } catch { /* different roots */ }
    }
    return {
      doc, index, range: range.cloneRange(), text, existingId,
      rect: { left: off.x + box.left, right: off.x + box.right, top: off.y + first.top, bottom: off.y + first.bottom },
    };
  }, []);

  const evalSelection = useCallback((doc: Document, index: number) => {
    const s = doc.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const info = selectionFrom(doc, index, s.getRangeAt(0));
    if (!info) return;
    setSel(info);
    setPeek(null);
  }, [selectionFrom]);

  const clearDocSelection = (s: SelInfo) => { try { s.doc.getSelection()?.removeAllRanges(); } catch { /* ignore */ } };

  const hitAt = (doc: Document, x: number, y: number): string | null => {
    let hit: string | null = null;
    for (const [id, d] of drawn.current) if (d.doc === doc && d.hit.some((r) => pointInRect(x, y, r))) hit = id;
    return hit;
  };

  const attachDoc = useCallback((doc: Document, index: number) => {
    const view = o.current.getView();
    if (view?.isFixedLayout) {
      const entry = { index, mo: new MutationObserver((muts) => {
        if (!muts.some((m) => !(m.target as Element).closest?.(`#${LAYER_ID}`))) return;
        const e = fixedDocs.current.get(doc);
        if (!e) return;
        window.clearTimeout(e.timer);
        e.timer = window.setTimeout(() => paintFixed(doc, index), 150);
      }) } as { index: number; mo: MutationObserver; timer?: number };
      for (const [d, e] of [...fixedDocs.current]) if (!d.defaultView) { e.mo.disconnect(); fixedDocs.current.delete(d); }
      fixedDocs.current.set(doc, entry);
      entry.mo.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
      entry.timer = window.setTimeout(() => paintFixed(doc, index), 300);
    }
    doc.addEventListener('mouseup', () => { window.setTimeout(() => evalSelection(doc, index), 10); });
    doc.addEventListener('keyup', (e) => { if (e.shiftKey) window.setTimeout(() => evalSelection(doc, index), 10); });
    doc.addEventListener('selectionchange', () => {
      const s = doc.getSelection();
      if (!s || s.isCollapsed) setSel((cur) => (cur && cur.doc === doc ? null : cur));
    });
    doc.addEventListener('mousemove', (e) => {
      const id = hitAt(doc, e.clientX, e.clientY);
      const a = id ? annsRef.current.find((x) => x.id === id) : undefined;
      const want = a && a.note ? a.id : null;
      if (want === hoverId.current) return;
      hoverId.current = want;
      if (!a || !want) { setHover(null); return; }
      const off = frameOffset(doc);
      setHover({ x: off.x + e.clientX, y: off.y + e.clientY, text: a.note });
    });
    doc.documentElement.addEventListener('mouseleave', () => { hoverId.current = null; setHover(null); });
  }, [evalSelection, paintFixed]);

  const yOf = (id: string, fallback = 140) => {
    const d = drawn.current.get(id);
    return d && d.hit[0] ? frameOffset(d.doc).y + d.hit[0].top : fallback;
  };

  const openPeek = useCallback((id: string, y?: number) => {
    setSel(null);
    setComposer(null);
    setPeek({ id, y: y ?? yOf(id) });
  }, []);

  const saveComposer = useCallback(async () => {
    const c = composerRef.current;
    if (!c) return;
    setComposer(null);
    if (c.kind === 'new') {
      clearDocSelection(c.sel);
      await createFrom(c.sel, c.note.trim(), c.color);
    } else {
      const cur = annsRef.current.find((a) => a.id === c.id);
      if (cur && (cur.note !== c.note.trim() || cur.color !== c.color)) await patch(c.id, { note: c.note.trim(), color: c.color });
    }
  }, [createFrom, patch]);

  const startNote = useCallback((s: SelInfo) => {
    setSel(null);
    setPeek(null);
    if (s.existingId) {
      const a = annsRef.current.find((x) => x.id === s.existingId);
      if (a) { setComposer({ kind: 'edit', id: a.id, note: a.note, color: a.color, y: s.rect.top }); return; }
    }
    setComposer({ kind: 'new', sel: s, note: '', color: 'yellow', y: s.rect.top });
  }, []);

  const startEdit = useCallback((id: string) => {
    const a = annsRef.current.find((x) => x.id === id);
    if (!a) return;
    setPeek(null);
    setComposer({ kind: 'edit', id, note: a.note, color: a.color, y: yOf(id) });
  }, []);

  const highlight = useCallback(async (s: SelInfo, color: AnnotationColor) => {
    setSel(null);
    if (s.existingId) { await patch(s.existingId, { color }); clearDocSelection(s); return; }
    clearDocSelection(s);
    await createFrom(s, '', color);
  }, [createFrom, patch]);

  /** Returns true when something was closed. */
  const escape = useCallback((): boolean => {
    if (composerRef.current) { setComposer(null); return true; }
    if (peekRef.current) { setPeek(null); return true; }
    if (selRef.current) { clearDocSelection(selRef.current); setSel(null); return true; }
    return false;
  }, []);

  /** `N`: note on the selection (or edit the open peek). */
  const noteKey = useCallback(() => {
    if (selRef.current) { startNote(selRef.current); return; }
    if (peekRef.current) startEdit(peekRef.current.id);
  }, [startNote, startEdit]);

  /** Call from the page's click handler (after its own link/selection checks). True = click consumed. */
  const onDocClick = useCallback((doc: Document, ev: MouseEvent): boolean => {
    if (composerRef.current) { void saveComposer(); return true; }
    const id = hitAt(doc, ev.clientX, ev.clientY);
    if (id) { openPeek(id, frameOffset(doc).y + ev.clientY); return true; }
    if (peekRef.current) { setPeek(null); return true; }
    return false;
  }, [saveComposer, openPeek]);

  /** Go to an annotation and show its peek card. */
  const jumpTo = useCallback(async (a: Annotation) => {
    const view = o.current.getView();
    if (!view) return;
    setSel(null); setComposer(null);
    try { await view.goTo(a.cfi); } catch (e) { console.error(e); }
    for (let i = 0; i < 12; i++) {
      if (drawn.current.has(a.id)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    openPeek(a.id);
  }, [openPeek]);

  return {
    annotations: anns, sel, composer, peek, hover,
    setComposer, setPeek, attachDoc, selectionFrom, startNote, startEdit, highlight, saveComposer,
    openPeek, remove, patch, escape, noteKey, onDocClick, jumpTo,
    cancelComposer: () => setComposer(null),
    closeSel: () => { if (selRef.current) clearDocSelection(selRef.current); setSel(null); },
  };
}

export type AnnotationsApi = ReturnType<typeof useAnnotations>;
