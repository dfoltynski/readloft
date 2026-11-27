// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import HelpOverlay from './reader/HelpOverlay';
import { LIBRARY_SHORTCUTS, READER_SHORTCUTS, SHORTCUTS_EVENT } from '../lib/shortcuts';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

/** App-wide keyboard cheatsheet outside the reader (the reader has its own `?` handler). */
export default function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const inReader = pathname.startsWith('/read/');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (inReader || e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      e.preventDefault();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SHORTCUTS_EVENT, onOpen);
    };
  }, [inReader]);

  if (!open || inReader) return null;
  return <HelpOverlay onClose={() => setOpen(false)} groups={[...LIBRARY_SHORTCUTS, ...READER_SHORTCUTS]} />;
}
