import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDismiss } from '../lib/hooks';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  danger?: boolean;
  checked?: boolean;
  /** Renders a nested flyout list. */
  submenu?: MenuItem[];
  separatorBefore?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Small floating menu positioned at viewport coordinates, with one level of submenu. */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<number | null>(null);
  useDismiss(ref, true, onClose);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
    el.querySelector<HTMLElement>('button')?.focus();
  }, [x, y]);

  const render = (list: MenuItem[], nested: boolean): ReactNode =>
    list.map((item, i) => (
      <div key={i} className="menu-row" onMouseEnter={() => !nested && setOpenSub(item.submenu ? i : null)}>
        {item.separatorBefore && <div className="menu-sep" role="separator" />}
        <button
          type="button"
          role="menuitem"
          className={`menu-item${item.danger ? ' danger' : ''}`}
          onClick={() => {
            if (item.submenu) {
              setOpenSub(openSub === i ? null : i);
              return;
            }
            item.onSelect?.();
            onClose();
          }}
        >
          <span className="menu-check">{item.checked ? '✓' : ''}</span>
          <span className="menu-label">{item.label}</span>
          {item.submenu && <span aria-hidden="true">▸</span>}
        </button>
        {item.submenu && openSub === i && (
          <div className="menu submenu" role="menu">
            {item.submenu.length === 0 ? (
              <div className="menu-empty">No shelves yet</div>
            ) : (
              render(item.submenu, true)
            )}
          </div>
        )}
      </div>
    ));

  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.left, top: pos.top }}>
      {render(items, false)}
    </div>
  );
}
