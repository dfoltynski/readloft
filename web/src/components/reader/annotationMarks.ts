// SVG drawing for annotations: a margin bar + dot (quiet default) and an optional translucent highlight.

export interface RectLike { left: number; top: number; right: number; bottom: number; width: number; height: number }

export interface MarkOptions {
  color: string;
  /** Also paint a translucent highlight over the passage. */
  fill: boolean;
  /** Filled dot = has a note; hollow ring = highlight only. */
  hasNote: boolean;
  /** Right edge of the text column that contains the given rect. */
  columnRight: (r: RectLike) => number;
  /** Creates SVG elements in the right document. */
  ns: (tag: string) => SVGElement;
}

export interface Mark {
  el: SVGElement;
  /** Click/hover targets (passage rects + the bar), in the same coordinate space as the rects. */
  hit: RectLike[];
}

const set = (el: SVGElement, attrs: Record<string, string | number>) => {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export function makeMark(rects: ArrayLike<RectLike>, o: MarkOptions): Mark {
  const g = o.ns('g');
  const hit: RectLike[] = [];
  const cols = new Map<number, { right: number; top: number; bottom: number }>();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.width < 1 || r.height < 1) continue;
    hit.push(r);
    if (o.fill) {
      g.append(set(o.ns('rect'), { x: r.left, y: r.top, width: r.width, height: r.height, fill: o.color, 'fill-opacity': 0.3 }));
    }
    const right = Math.round(o.columnRight(r));
    const c = cols.get(right);
    if (c) { c.top = Math.min(c.top, r.top); c.bottom = Math.max(c.bottom, r.bottom); }
    else cols.set(right, { right, top: r.top, bottom: r.bottom });
  }
  const ordered = [...cols.values()].sort((a, b) => a.right - b.right || a.top - b.top);
  ordered.forEach((c, i) => {
    const x = c.right + 5;
    const top = i === 0 ? c.top + 4 : c.top;
    const h = Math.max(4, c.bottom - top);
    g.append(set(o.ns('rect'), { x, y: top, width: 3, height: h, rx: 1.5, fill: o.color }));
    hit.push({ left: x - 4, top: c.top, right: x + 8, bottom: c.bottom, width: 12, height: c.bottom - c.top });
    if (i === 0) {
      g.append(o.hasNote
        ? set(o.ns('circle'), { cx: x + 1.5, cy: c.top + 3, r: 3.5, fill: o.color })
        : set(o.ns('circle'), { cx: x + 1.5, cy: c.top + 3, r: 3, fill: 'none', stroke: o.color, 'stroke-width': 1.5 }));
    }
  });
  return { el: g, hit };
}

/** Right edge of the text column containing `r` in a reflowable section document. */
export function reflowColumnRight(doc: Document, r: RectLike): number {
  const view = doc.defaultView;
  if (view) {
    const cs = view.getComputedStyle(doc.documentElement);
    const cw = parseFloat(cs.columnWidth);
    const gap = parseFloat(cs.columnGap);
    if (cw > 0 && Number.isFinite(gap)) {
      const x0 = gap / 2;
      const stride = cw + gap;
      const k = Math.max(0, Math.floor(((r.left + r.right) / 2 - x0) / stride));
      return x0 + k * stride + cw;
    }
  }
  // Scrolled flow: the body is the (centred) column.
  const b = doc.body?.getBoundingClientRect();
  return b && b.width > 0 ? b.right : r.right;
}

export const pointInRect = (x: number, y: number, r: RectLike) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
