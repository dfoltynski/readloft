import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * App-wide hover tooltip, driven by event delegation so every control gets one without wrapping.
 * Text comes from (nearest ancestor first): `data-tip`, `title` (moved to `data-tip` so the
 * native tooltip doesn't double up), or the `aria-label` of an icon-only control. A trailing
 * "(R)" is rendered as a keyboard hint. `data-tip=""` opts out.
 * Disabled buttons still receive mouseover in current Chromium (incl. Electron 45), so they show tips too.
 */
const DELAY_MS = 400;
const GAP = 8;
const MARGIN = 8;
const CONTROLS = 'button, a, [role="button"], [role="menuitem"], [role="tab"], select, summary, input:not([type="text"]):not([type="search"]):not([type="time"]):not([type="number"])';

interface Tip { text: string; rect: DOMRect }

function tipFor(start: Element): { el: Element; text: string } | null {
  for (let el: Element | null = start; el && el !== document.body; el = el.parentElement) {
    if (el.hasAttribute('data-tip')) {
      const t = el.getAttribute('data-tip')?.trim();
      if (t) return { el, text: t };
      return null; // explicit opt-out
    }
    const title = el.getAttribute('title')?.trim();
    if (title) {
      el.setAttribute('data-tip', title);
      el.removeAttribute('title');
      return { el, text: title };
    }
    const label = el.getAttribute('aria-label')?.trim();
    if (label && el.matches(CONTROLS)) {
      const visible = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!visible || el.matches('select, input')) return { el, text: label };
    }
  }
  return null;
}

function Label({ text }: { text: string }) {
  const m = /^(.*\S)\s+\(([^()\s]{1,8}|[^()\s]+ [^()\s]+)\)$/.exec(text);
  if (!m) return <>{text}</>;
  return <>{m[1]}<kbd>{m[2]}</kbd></>;
}

export default function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let current: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
      setPos(null);
    };
    const onOver = (e: Event) => {
      const t = e.target instanceof Element ? e.target : null;
      const found = t ? tipFor(t) : null;
      if (!found) return hide();
      if (found.el === current) return;
      hide();
      current = found.el;
      const el = found.el;
      timer = window.setTimeout(() => {
        if (!el.isConnected) return;
        setTip({ text: el.getAttribute('data-tip') ?? found.text, rect: el.getBoundingClientRect() });
      }, DELAY_MS);
    };
    const onOut = (e: MouseEvent) => {
      if (!current) return;
      const to = e.relatedTarget as Node | null;
      if (!to || !current.contains(to)) hide();
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    return () => {
      hide();
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('mousedown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, []);

  // Measure after render, then place below the control (or above when it would be clipped).
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!tip || !box) return;
    const { width, height } = box.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const below = tip.rect.bottom + GAP + height <= vh - MARGIN || tip.rect.top - GAP - height < MARGIN;
    const top = below ? tip.rect.bottom + GAP : tip.rect.top - GAP - height;
    const left = Math.min(Math.max(tip.rect.left + tip.rect.width / 2 - width / 2, MARGIN), Math.max(MARGIN, vw - width - MARGIN));
    setPos({ left, top: Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - height - MARGIN)), below });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={boxRef}
      className="tooltip"
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <Label text={tip.text} />
    </div>
  );
}
