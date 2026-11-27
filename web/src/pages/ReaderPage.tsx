// SPDX-License-Identifier: AGPL-3.0-only
import { runtimeImport } from '../lib/runtimeImport';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Book, Bookmark } from '@shared/types';
import { api, fileUrl } from '../api';
import { IconClose } from '../components/Icons';
import NightLightOverlay from '../components/NightLightOverlay';
import HelpOverlay from '../components/reader/HelpOverlay';
import ContextMenu, { type MenuItem } from '../components/ContextMenu';
import { useToast } from '../components/Toast';
import { Composer, HoverTip, PeekCard, SelectionToolbar } from '../components/reader/AnnotationCards';
import { useAnnotations, type AnnotationsApi, type SelInfo } from '../components/reader/useAnnotations';
import ReadAloudBar from '../components/reader/ReadAloudBar';
import { useReadAloud } from '../components/reader/useReadAloud';
import { findBookmarkOnPage, pageStart, type CfiModule } from '../components/reader/bookmarkUtils';
import { useBookSearch } from '../components/reader/useBookSearch';
import { useWakeLock } from '../components/reader/useWakeLock';
import TocPanel, { type PanelTab } from '../components/TocPanel';
import '../reader.css';
import { formatBytes, formatPercent } from '../lib/format';
import { ReaderAside, ReaderDock, ReaderTopChrome } from '../design/studio/ReaderChrome';
import { useOnSynced, useSyncStatus } from '../lib/sync';
import {
  buildBookCss, loadSettings, paletteFor, resolveTheme, saveSettings, type ReaderSettings,
} from '../lib/readerSettings';
import type { FoliateRelocateDetail, FoliateTocItem, FoliateView } from '../foliate';

type LoadState = { kind: 'loading' } | { kind: 'cloud'; startedAt: number; percent: number | null; provider: string | null; size: number } | { kind: 'ready' } | { kind: 'error'; message: string };

interface Position {
  fraction: number;
  label: string;
  currentHref?: string;
  loc?: string;
  cfi?: string;
  /** Estimated minutes left in the chapter / book (reflowable only). */
  time?: { section: number; total: number };
}

/** Minimal shape of foliate's FootnoteHandler (footnotes.js). */
interface FootnoteHandlerLike extends EventTarget {
  handle(book: unknown, e: Event): Promise<void> | undefined;
}

const FOLIATE_VIEW_URL = '/foliate-js/view.js';
const CHROME_IDLE_MS = 2500;
const SAVE_DEBOUNCE_MS = 1500;
const EDGE_TOP = 64;
const EDGE_BOTTOM = 96;
const FOOTNOTES_URL = '/foliate-js/footnotes.js';
const CFI_URL = '/foliate-js/epubcfi.js';

const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
}

const CLOUD_TIPS = [
  'Tip: In Finder, right-click your books folder and choose “Keep Downloaded” to keep every book available offline.',
  'Large PDFs can take a minute on a slow connection.',
  'You can go back to the library — the download keeps going in the background.',
  'Make sure you’re online and signed in to iCloud in System Settings.',
];

function CloudDownload({ title, info, onBack }: {
  title: string;
  info: { startedAt: number; percent: number | null; provider: string | null; size: number };
  onBack: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - info.startedAt) / 1000));
  const tip = CLOUD_TIPS[Math.floor(elapsed / 6) % CLOUD_TIPS.length];
  const where = info.provider ?? 'cloud storage';
  const pct = info.percent;
  return (
    <div className="reader-overlay cloud-dl" role="status">
      <h2>Downloading from {where}</h2>
      <p className="cloud-dl-title">{title}</p>
      <p className="muted">{formatBytes(info.size)}</p>
      <div
        className={`cloud-dl-bar${pct == null ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-label="Download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct == null ? undefined : Math.round(pct)}
      >
        <div style={pct == null ? undefined : { width: `${pct}%` }} />
      </div>
      <p className="muted cloud-dl-meta">
        {pct != null && <strong>{Math.round(pct)}%</strong>}
        {pct != null && ' · '}
        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
      </p>
      <p className="muted">This book is stored in {where} and isn’t on this Mac yet. It will open automatically when the download finishes.</p>
      <p className="muted cloud-dl-tip" key={tip}>{tip}</p>
      {elapsed >= 90 && <p className="muted cloud-dl-warn">This is taking longer than usual. Check your internet connection and iCloud status.</p>}
      <button className="btn" onClick={onBack}>Back</button>
    </div>
  );
}

export default function ReaderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const footnoteHostRef = useRef<HTMLDivElement>(null);
  const footnoteViewRef = useRef<FoliateView | null>(null);
  const cfiRef = useRef<CfiModule | null>(null);
  const fileRef = useRef<File | null>(null);
  const fileIdRef = useRef('');
  const getFile = useCallback(() => fileRef.current, []);

  const [book, setBook] = useState<Book>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [toc, setToc] = useState<FoliateTocItem[]>([]);
  const [rtl, setRtl] = useState(false);
  const [fixedLayout, setFixedLayout] = useState(false);
  const [position, setPosition] = useState<Position>({ fraction: 0, label: '' });
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  // Starts in the reading state (controls hidden) unless auto-hide is off.
  const [chromeVisible, setChromeVisible] = useState(!settings.autoHide);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('contents');
  const [searchFocus, setSearchFocus] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [bookLang, setBookLang] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; range: Range | null; selected: string; sel: SelInfo | null } | null>(null);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  // Bumped to re-open the book (fixed-layout books pick their spread mode at open time).
  const [reloadTick, setReloadTick] = useState(0);
  const lastLoc = useRef<{ id: string; cfi: string } | null>(null);
  const getView = useCallback(() => viewRef.current, []);
  const search = useBookSearch(getView);

  const tts = useReadAloud({
    bookId: id,
    getView,
    bookLang,
    settings,
    patchSettings: (patch) => setSettings((s) => ({ ...s, ...patch })),
    fixedLayout,
    format: book?.format,
    getFile,
    ready: state.kind === 'ready',
  });
  const ttsAvail = useRef(false);
  ttsAvail.current = !tts.unavailable;

  const panelOpen = tocOpen || settingsOpen;
  const closePanels = useCallback(() => {
    setTocOpen(false);
    setSettingsOpen(false);
  }, []);

  useWakeLock(settings.keepAwake);

  // Latest state for the long-lived key/click handlers registered in the load effect.
  const live = useRef({ settings, position, bookmarks, helpOpen, footnoteOpen, tocOpen, panelTab });
  live.current = { settings, position, bookmarks, helpOpen, footnoteOpen, tocOpen, panelTab };
  const actions = useRef({
    toggleBookmark: () => {}, toggleFullscreen: () => {}, openSearch: () => {},
    toggleToc: () => {}, toggleHelp: () => {}, escape: () => {}, closeFootnote: () => {},
    readAloud: () => {}, ttsPrev: () => {}, ttsNext: () => {},
    addNote: () => {}, toggleNotes: () => {}, togglePages: () => {}, toggleChrome: () => {},
  });
  const annRef = useRef<AnnotationsApi | null>(null);

  const ann = useAnnotations({
    bookId: id,
    getView,
    ready: state.kind === 'ready',
    showHighlights: settings.showHighlights,
    getPosition: () => live.current.position,
    pageCfi: (cfi) => pageStart(cfi, cfiRef.current),
    toast,
  });
  annRef.current = ann;

  // ---- Bookmarks ----
  useEffect(() => {
    let stale = false;
    setBookmarks([]);
    api.listBookmarks(id).then((b) => { if (!stale) setBookmarks(b); }, () => { /* non-fatal */ });
    return () => { stale = true; };
  }, [id]);

  // After "Sync now": refresh bookmarks and offer to follow a device that is further along.
  useOnSynced(() => {
    api.listBookmarks(id).then(setBookmarks, () => { /* non-fatal */ });
    api.getBook(id).then((b) => {
      const loc = b.location;
      if (loc && b.progress > live.current.position.fraction + 0.01 && viewRef.current) {
        toast(`Another device is further along (${formatPercent(b.progress)})`, 'info', {
          action: { label: 'Jump there', onClick: () => void viewRef.current?.goTo(loc) },
          duration: 10_000,
        });
      }
    }, () => { /* non-fatal */ });
  });

  /** Esc at the bottom of the layers: save the final position, then back to wherever the reader was opened from. */
  const flushRef = useRef<() => void>(() => {});
  const leaveReader = () => {
    flushRef.current();
    // react-router keeps the in-app history index in history.state; 0 / missing means the reader was the first page.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  };

  const currentBookmark = findBookmarkOnPage(bookmarks, position.cfi, cfiRef.current);

  actions.current = {
    toggleBookmark: () => {
      const { position: pos, bookmarks: list } = live.current;
      const existing = findBookmarkOnPage(list, pos.cfi, cfiRef.current);
      if (existing) {
        toast('Bookmark removed');
        setBookmarks((bs) => bs.filter((b) => b.id !== existing.id));
        api.deleteBookmark(existing.id).catch(() => setBookmarks((bs) => [...bs, existing]));
      } else if (pos.cfi) {
        const label = `${pos.label || 'Page'} — ${formatPercent(pos.fraction)}`;
        api.createBookmark(id, { location: pageStart(pos.cfi, cfiRef.current), label, progress: pos.fraction })
          .then((b) => { toast('Bookmark added'); setBookmarks((bs) => [...bs, b].sort((a, c) => a.progress - c.progress)); })
          .catch(console.error);
      }
    },
    toggleFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    },
    openSearch: () => {
      setSettingsOpen(false);
      setTocOpen(true);
      setPanelTab('search');
      setSearchFocus((n) => n + 1);
    },
    toggleToc: () => {
      setSettingsOpen(false);
      setPanelTab('contents');
      setTocOpen((o) => !o);
    },
    toggleHelp: () => setHelpOpen((h) => !h),
    togglePages: () => setSettings((s) => ({ ...s, columns: s.columns === '1' ? 'auto' : '1' })),
    addNote: () => annRef.current?.noteKey(),
    toggleNotes: () => {
      const l = live.current;
      setSettingsOpen(false);
      if (l.tocOpen && l.panelTab === 'notes') setTocOpen(false);
      else { setPanelTab('notes'); setTocOpen(true); }
    },
    closeFootnote: () => setFootnoteOpen(false),
    readAloud: () => tts.toggle(),
    ttsPrev: () => { if (tts.state.status !== 'idle') tts.prev(); },
    ttsNext: () => { if (tts.state.status !== 'idle') tts.next(); },
    // Layered Esc: one press does one thing, top-most first. Last resort: back to the book list.
    escape: () => {
      const l = live.current;
      if (menu) setMenu(null);
      else if (annRef.current?.escape()) return;
      else if (l.helpOpen) setHelpOpen(false);
      else if (l.footnoteOpen) setFootnoteOpen(false);
      else if (l.tocOpen || settingsOpen) closePanels();
      else if (tts.state.status !== 'idle') tts.stop();
      else leaveReader();
    },
    toggleChrome: () => chromeApi.current.toggle(),
  };

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ---- Reading state with auto-hiding controls ----
  const docsRef = useRef(new Set<Document>());
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverChrome = useRef(false);
  const focusChrome = useRef(false);
  const draggingSlider = useRef(false);
  const chromeTimer = useRef<number>();
  const cursorTimer = useRef<number>();
  const chromeShown = useRef(chromeVisible);
  chromeShown.current = chromeVisible;
  const overlayOpen = tocOpen || settingsOpen || !!menu || !!ann.composer || !!ann.peek || helpOpen;
  const blockedRef = useRef(false);
  blockedRef.current = overlayOpen;
  const autoHideRef = useRef(settings.autoHide);
  autoHideRef.current = settings.autoHide;
  const chromeApi = useRef({
    blocked: (): boolean => false,
    schedule: () => {},
    show: () => {},
    hideNow: (_force: boolean) => {},
    toggle: () => {},
    pointerMove: (_y: number) => {},
  });
  chromeApi.current = {
    blocked: () => hoverChrome.current || focusChrome.current || draggingSlider.current || blockedRef.current,
    schedule: () => {
      window.clearTimeout(chromeTimer.current);
      if (!autoHideRef.current) return;
      chromeTimer.current = window.setTimeout(() => {
        if (!chromeApi.current.blocked()) setChromeVisible(false);
      }, CHROME_IDLE_MS);
    },
    show: () => {
      setChromeVisible(true);
      chromeApi.current.schedule();
    },
    hideNow: (force) => {
      if (!autoHideRef.current || !chromeShown.current) return;
      if (force) {
        // Esc: drop focus and hover so nothing keeps the controls alive.
        focusChrome.current = false;
        hoverChrome.current = false;
        if (rootRef.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      } else if (chromeApi.current.blocked()) return;
      window.clearTimeout(chromeTimer.current);
      setChromeVisible(false);
    },
    toggle: () => {
      if (chromeShown.current) {
        window.clearTimeout(chromeTimer.current);
        setChromeVisible(false);
      } else chromeApi.current.show();
    },
    pointerMove: (y) => {
      // Cursor: hide after 2.5 s of inactivity, show on movement.
      rootRef.current?.classList.remove('st-cursor-hidden');
      docsRef.current.forEach((d) => { try { d.documentElement.style.removeProperty('cursor'); } catch { /* detached */ } });
      window.clearTimeout(cursorTimer.current);
      cursorTimer.current = window.setTimeout(() => {
        if (hoverChrome.current) return;
        rootRef.current?.classList.add('st-cursor-hidden');
        docsRef.current.forEach((d) => { try { d.documentElement.style.cursor = 'none'; } catch { /* detached */ } });
      }, CHROME_IDLE_MS);
      // Controls: only the top / bottom edge zones reveal them.
      if (y < EDGE_TOP || y > window.innerHeight - EDGE_BOTTOM) chromeApi.current.show();
    },
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => chromeApi.current.pointerMove(e.clientY);
    const onUp = () => {
      if (draggingSlider.current) { draggingSlider.current = false; chromeApi.current.schedule(); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.clearTimeout(chromeTimer.current);
      window.clearTimeout(cursorTimer.current);
    };
  }, []);
  // Drawers / menus closing (or the setting changing) restarts the hide timer.
  useEffect(() => {
    if (!settings.autoHide) setChromeVisible(true);
    else if (chromeShown.current) chromeApi.current.schedule();
  }, [overlayOpen, settings.autoHide]);
  // First time only: explain how to bring the controls back.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    try {
      if (localStorage.getItem('readloft.studioHint')) return;
      localStorage.setItem('readloft.studioHint', '1');
    } catch { /* storage unavailable: show once per session */ }
    toast('Move to the top or bottom edge, or click the middle of the page, to show controls', 'info', { duration: 7000 });
  }, [state.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const { status: syncStatus, syncing, syncNow } = useSyncStatus();

  // ---- Load the book and mount foliate-view ----
  useEffect(() => {
    let cancelled = false;
    let view: FoliateView | null = null;
    let saveTimer: number | undefined;
    let pending: { progress: number; location: string | null } | null = null;

    const flush = () => {
      window.clearTimeout(saveTimer);
      if (pending) {
        api.saveProgressKeepalive(id, pending);
        pending = null;
      }
    };
    flushRef.current = flush;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const queueSave = (progress: number, location: string | null) => {
      pending = { progress, location };
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return e.repeat ? undefined : actions.current.escape();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        return actions.current.openSearch();
      }
      if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = viewRef.current;
      if (!v) {
        // The book is still opening: say so instead of ignoring the key.
        if (e.key === 'r' || e.key === 'R') { actions.current.readAloud(); e.preventDefault(); }
        return;
      }
      switch (e.key) {
        case 'f': case 'F': actions.current.toggleFullscreen(); break;
        case 'd': case 'D': actions.current.togglePages(); break;
        case 'm': case 'M': actions.current.toggleChrome(); break;
        case 'b': case 'B': actions.current.toggleBookmark(); break;
        case 't': case 'T': actions.current.toggleToc(); break;
        case 'r': case 'R': actions.current.readAloud(); break;
        case '[': actions.current.ttsPrev(); break;
        case ']': actions.current.ttsNext(); break;
        case '?': actions.current.toggleHelp(); break;
        case 'n': case 'N': actions.current.addNote(); break;
        case 'a': case 'A': actions.current.toggleNotes(); break;
        case 'ArrowLeft': void v.goLeft(); break;
        case 'ArrowRight': void v.goRight(); break;
        case 'PageUp': void v.prev(); break;
        case 'PageDown': void v.next(); break;
        case ' ': void (e.shiftKey ? v.prev() : v.next()); break;
        default: return;
      }
      e.preventDefault();
    };

    /** Left third = previous page, right third = next, centre toggles the chrome. */
    const onTap = (x: number) => {
      const v = viewRef.current;
      if (!v) return;
      const box = containerRef.current?.getBoundingClientRect();
      const ratio = box && box.width > 0 ? (x - box.left) / box.width : x / window.innerWidth;
      const lo = 1 / 3;
      if (ratio < lo) void v.goLeft();
      else if (ratio > 1 - lo) void v.goRight();
      else actions.current.toggleChrome();
    };

    /** Wires foliate's footnote handler so noteref links open a popover instead of navigating. */
    const setupFootnotes = async (v: FoliateView) => {
      try {
        const mod = await runtimeImport<{ FootnoteHandler: new () => FootnoteHandlerLike }>(FOOTNOTES_URL);
        const handler = new mod.FootnoteHandler();
        handler.addEventListener('before-render', ((e: CustomEvent<{ view: FoliateView }>) => {
          const fv = e.detail.view;
          footnoteViewRef.current?.close?.();
          footnoteViewRef.current = fv;
          footnoteHostRef.current?.replaceChildren(fv);
          fv.renderer.setAttribute('flow', 'scrolled');
        }) as EventListener);
        handler.addEventListener('render', ((e: CustomEvent<{ view: FoliateView }>) => {
          const p = paletteFor(live.current.settings.theme);
          e.detail.view.renderer.setStyles?.(
            `html { color-scheme: ${p.dark ? 'dark' : 'light'}; color: ${p.fg}; background: ${p.bg}; font-size: 95%; }
             body { background: transparent; } a:link { color: ${p.link}; }`,
          );
          setFootnoteOpen(true);
        }) as EventListener);
        v.addEventListener('link', ((e: Event) => {
          // handle() calls preventDefault() itself when the link is a note reference.
          handler.handle(v.book, e)?.catch((err) => {
            console.error(err);
            void v.goTo((e as CustomEvent<{ href: string }>).detail.href);
          });
        }) as EventListener);
      } catch (e) {
        console.warn('Footnote popups unavailable', e);
      }
    };

    const load = async () => {
      try {
        const b = await api.getBook(id);
        if (cancelled) return;
        setBook(b);

        // Offloaded cloud file: trigger the download and wait for it, instead of hanging on fetch.
        let av = await api.getAvailability(id).catch(() => null);
        if (av?.offloaded) {
          const startedAt = Date.now();
          av = await api.startDownload(id);
          while (av.offloaded) {
            if (cancelled) return;
            setState({ kind: 'cloud', startedAt, percent: av.percent, provider: av.provider, size: av.size });
            await new Promise((r) => setTimeout(r, 1000));
            if (cancelled) return;
            // POST is idempotent server-side and re-kicks a stalled download; a failed poll just retries.
            av = await api.startDownload(id).catch(() => av!);
          }
          setState({ kind: 'loading' });
        }
        if (cancelled) return;

        let file = fileRef.current && fileIdRef.current === id ? fileRef.current : null;
        if (!file) {
          const res = await fetch(fileUrl(id));
          if (!res.ok) throw new Error(`Could not download the book (${res.status})`);
          const blob = await res.blob();
          if (cancelled) return;
          // foliate-js detects the format from the file name, which our URL lacks.
          file = new File([blob], `book.${b.format}`, { type: blob.type });
          fileRef.current = file;
          fileIdRef.current = id;
        }

        // Loaded at runtime from public/, not bundled by Vite. Registers <foliate-view>.
        await runtimeImport(FOLIATE_VIEW_URL);
        if (cancelled) return;

        view = document.createElement('foliate-view') as FoliateView;
        containerRef.current?.append(view);
        viewRef.current = view;
        try {
          await view.open(file);
        } catch (e) {
          console.error(e);
          throw new Error('This file could not be opened. It may be corrupt or in an unsupported format.');
        }
        if (cancelled) return;

        // One / Two pages for fixed-layout books (PDF, comics): "One" turns spreads off.
        if (view.isFixedLayout && live.current.settings.columns === '1') {
          const bk = view.book as { rendition?: Record<string, unknown> };
          bk.rendition = { ...bk.rendition, spread: 'none' };
          view.renderer.open?.(view.book);
        }

        view.addEventListener('load', ((e: CustomEvent<{ doc: Document; index: number }>) => {
          const doc = e.detail.doc;
          const sectionIndex = e.detail.index;
          annRef.current?.attachDoc(doc, sectionIndex);
          doc.addEventListener('keydown', onKey);
          docsRef.current.add(doc);
          doc.addEventListener('mousemove', (ev) => {
            const fr = doc.defaultView?.frameElement;
            chromeApi.current.pointerMove((fr ? fr.getBoundingClientRect().top : 0) + ev.clientY);
          });
          doc.addEventListener('contextmenu', (ev) => {
            const sel = doc.getSelection();
            const selected = sel && !sel.isCollapsed ? sel.toString() : '';
            if (!ttsAvail.current && !selected) return;
            ev.preventDefault();
            const frame = doc.defaultView?.frameElement;
            const r = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
            let range: Range | null = null;
            if (selected && sel?.rangeCount) range = sel.getRangeAt(0).cloneRange();
            else {
              const d = doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
              if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(ev.clientX, ev.clientY);
              else {
                const cp = d.caretPositionFromPoint?.(ev.clientX, ev.clientY);
                if (cp) { range = doc.createRange(); range.setStart(cp.offsetNode, cp.offset); range.collapse(true); }
              }
            }
            const selInfo = selected && sel?.rangeCount ? annRef.current?.selectionFrom(doc, sectionIndex, sel.getRangeAt(0)) ?? null : null;
            setMenu({ x: r.left + ev.clientX, y: r.top + ev.clientY, range, selected, sel: selInfo });
          });
          doc.addEventListener('click', (ev) => {
            if (live.current.footnoteOpen && !(ev.target as Element | null)?.closest?.('a[href]')) {
              actions.current.closeFootnote();
              return;
            }
            if ((ev.target as Element | null)?.closest?.('a[href]')) return;
            if (doc.defaultView?.getSelection()?.toString()) return;
            if (annRef.current?.onDocClick(doc, ev)) return;
            // Convert iframe-relative coordinates to viewport coordinates.
            const frame = doc.defaultView?.frameElement;
            const left = frame ? frame.getBoundingClientRect().left : 0;
            onTap(left + ev.clientX);
          });
        }) as EventListener);

        view.addEventListener('relocate', ((e: CustomEvent<FoliateRelocateDetail>) => {
          const d = e.detail;
          setPosition({
            fraction: d.fraction,
            label: d.tocItem?.label?.trim() ?? '',
            currentHref: d.tocItem?.href,
            cfi: d.cfi,
            time: d.time,
            loc: d.pageItem
              ? `Page ${d.pageItem.label}`
              : d.location
                ? `Loc ${d.location.current + 1} of ${d.location.total}`
                : undefined,
          });
          if (d.cfi) lastLoc.current = { id, cfi: d.cfi };
          chromeApi.current.hideNow(false); // a page turn hides the controls
          queueSave(d.fraction, d.cfi ?? null);
        }) as EventListener);

        try {
          cfiRef.current = await runtimeImport<CfiModule>(CFI_URL);
        } catch { /* bookmarks fall back to exact CFI match */ }
        void setupFootnotes(view);

        setToc(view.book.toc ?? []);
        setRtl(view.book.dir === 'rtl');
        setFixedLayout(!!view.isFixedLayout);
        setBookLang(view.language?.canonical || (Array.isArray(view.book.metadata?.language) ? String(view.book.metadata.language[0]) : (view.book.metadata?.language as string | undefined)) || undefined);

        const resume = lastLoc.current?.id === id ? lastLoc.current.cfi : b.location;
        if (resume) await view.init({ lastLocation: resume });
        else await view.renderer.next();
        if (cancelled) return;
        setState({ kind: 'ready' });
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: (e as Error).message });
      }
    };

    void load();
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      cancelled = true;
      flush();
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      view?.close?.();
      view?.remove();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadTick]);

  // Switching One/Two pages re-opens fixed-layout books, resuming at the current page.
  const prevColumns = useRef(settings.columns);
  useEffect(() => {
    if (prevColumns.current === settings.columns) return;
    prevColumns.current = settings.columns;
    if (fixedLayout) {
      setState({ kind: 'loading' });
      setReloadTick((t) => t + 1);
    }
  }, [settings.columns, fixedLayout]);

  // ---- Deep links from the notes page: ?panel=notes, ?cfi=…&ann=… ----
  const deepLinked = useRef(false);
  useEffect(() => { deepLinked.current = false; }, [id]);
  useEffect(() => {
    if (state.kind !== 'ready' || deepLinked.current) return;
    const panel = params.get('panel');
    const annId = params.get('ann');
    if (annId) {
      const a = ann.annotations.find((x) => x.id === annId);
      if (!a) return; // wait for the annotations to load
      deepLinked.current = true;
      void ann.jumpTo(a);
    } else if (panel === 'notes') {
      deepLinked.current = true;
      setPanelTab('notes');
      setTocOpen(true);
    } else return;
    setParams((p) => { const n = new URLSearchParams(p); n.delete('panel'); n.delete('ann'); n.delete('cfi'); return n; }, { replace: true });
  }, [state.kind, params, ann.annotations]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Apply settings to the renderer ----
  useEffect(() => {
    saveSettings(settings);
    const view = viewRef.current;
    if (state.kind !== 'ready' || !view) return;
    const r = view.renderer;
    if (!view.isFixedLayout) {
      r.setStyles?.(buildBookCss(settings));
      r.setAttribute('flow', settings.flow);
      r.setAttribute('max-inline-size', `${settings.maxWidth}px`);
      r.setAttribute('gap', `${settings.margin}%`);
      r.setAttribute('max-column-count', settings.columns === '1' ? '1' : '2');
      if (settings.animate && settings.flow === 'paginated') r.setAttribute('animated', '');
      else r.removeAttribute('animated');
    }
  }, [settings, state.kind]);

  // "App" theme follows the app's light/dark mode, which may change while reading.
  useEffect(() => {
    if (settings.theme !== 'app') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const rerender = () => setSettings((s) => ({ ...s }));
    mq.addEventListener('change', rerender);
    return () => mq.removeEventListener('change', rerender);
  }, [settings.theme]);

  const patchSettings = (patch: Partial<ReaderSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const palette = paletteFor(settings.theme);
  const themeName = resolveTheme(settings.theme);
  const view = viewRef.current;
  const chrome = chromeVisible || panelOpen || state.kind !== 'ready';

  const tocPanel = (
        <TocPanel
          tab={panelTab}
          onTab={setPanelTab}
          toc={toc}
          currentHref={position.currentHref}
          bookmarks={bookmarks}
          annotations={ann.annotations}
          fraction={position.fraction}
          bookTitle={book?.title ?? ''}
          bookAuthors={book?.authors ?? []}
          onJumpAnnotation={(a) => {
            void ann.jumpTo(a);
            setTocOpen(false);
          }}
          search={search}
          searchFocusToken={searchFocus}
          onClose={() => setTocOpen(false)}
          onSelect={(href) => {
            void view?.goTo(href);
            setTocOpen(false);
          }}
          onJumpLocation={(loc) => {
            void view?.goTo(loc);
            setTocOpen(false);
          }}
          onRenameBookmark={async (bid, label) => {
            const prev = bookmarks.find((b) => b.id === bid);
            if (!prev) return;
            setBookmarks((bs) => bs.map((b) => (b.id === bid ? { ...b, label } : b)));
            try {
              const saved = await api.renameBookmark(bid, label);
              setBookmarks((bs) => bs.map((b) => (b.id === bid ? { ...b, label: saved.label } : b)));
            } catch (e) {
              setBookmarks((bs) => bs.map((b) => (b.id === bid ? { ...b, label: prev.label } : b)));
              throw e;
            }
          }}
          onDeleteBookmark={(bid) => {
            const gone = bookmarks.find((b) => b.id === bid);
            setBookmarks((bs) => bs.filter((b) => b.id !== bid));
            api.deleteBookmark(bid).catch(() => gone && setBookmarks((bs) => [...bs, gone]));
          }}
        />
      );

  const stageEl = (
      <div
        ref={containerRef}
        className="reader-stage"
        onClick={(e) => {
          // Clicks outside the book iframe (page margins).
          if ((e.target as HTMLElement).closest('.reader-header, .reader-footer, .reader-panel, .reader-popover, .footnote-pop')) return;
          if (footnoteOpen) return setFootnoteOpen(false);
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = box.width > 0 ? (e.clientX - box.left) / box.width : e.clientX / window.innerWidth;
          const lo = 1 / 3;
          if (ratio < lo) void view?.goLeft();
          else if (ratio > 1 - lo) void view?.goRight();
          else actions.current.toggleChrome();
        }}
      />
  );
  const loadOverlays = (
    <>
      {state.kind === 'loading' && (
        <div className="reader-overlay" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>Opening book…</span>
        </div>
      )}
      {state.kind === 'cloud' && (
        <CloudDownload title={book?.title ?? ''} info={state} onBack={() => navigate(`/book/${id}`)} />
      )}
      {state.kind === 'error' && (
        <div className="reader-overlay" role="alert">
          <h2>Can’t open this book</h2>
          <p className="muted">{state.message}</p>
          <button className="btn btn-primary" onClick={() => navigate(`/book/${id}`)}>Back</button>
        </div>
      )}
    </>
  );
  const tail = (
    <>
      {/* Footnote popover: the host is always mounted so foliate can lay the view out. */}
      <div className={`footnote-pop${footnoteOpen ? ' open' : ''}`} role="dialog" aria-label="Footnote">
        <button className="icon-btn footnote-close" aria-label="Close footnote" onClick={() => setFootnoteOpen(false)}>
          <IconClose />
        </button>
        <div ref={footnoteHostRef} className="footnote-host" />
      </div>

      {(tts.state.status !== 'idle' || tts.state.error) && (chromeVisible || !!tts.state.error) ? (
        <ReadAloudBar
          state={tts.state}
          hint={tts.hint}
          rate={settings.ttsRate}
          voices={tts.voices}
          voiceURI={tts.voice?.voiceURI}
          bookLang={bookLang}
          lifted={chrome && state.kind === 'ready'}
          onToggle={tts.toggle}
          onPrev={tts.prev}
          onNext={tts.next}
          onStop={tts.stop}
          onRate={tts.setRate}
          onVoice={tts.setVoice}
          onReveal={tts.reveal}
        />
      ) : null}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={((): MenuItem[] => {
          const items: MenuItem[] = [];
          const msel = menu.sel;
          if (msel) {
            items.push({ label: 'Highlight', onSelect: () => void ann.highlight(msel, 'yellow') });
            items.push({ label: 'Add note', onSelect: () => ann.startNote(msel) });
          }
          if (ttsAvail.current) {
            items.push({ label: menu.selected ? 'Read aloud from selection' : 'Read from here', onSelect: () => tts.start(menu.range) });
          }
          if (menu.selected) {
            items.push({ label: 'Copy', onSelect: () => void navigator.clipboard?.writeText(menu.selected).catch(() => {}) });
          }
          return items;
        })()} />
      )}

      {ann.sel && !ann.composer && (
        <SelectionToolbar
          sel={ann.sel}
          canRead={!tts.unavailable}
          onColor={(c) => void ann.highlight(ann.sel!, c)}
          onNote={() => ann.startNote(ann.sel!)}
          onCopy={() => { void navigator.clipboard?.writeText(ann.sel!.text).catch(() => {}); ann.closeSel(); }}
          onRead={() => { const r = ann.sel!.range; ann.closeSel(); tts.start(r); }}
          onDelete={() => { if (ann.sel?.existingId) ann.remove(ann.sel.existingId); ann.closeSel(); }}
        />
      )}
      {ann.composer && (
        <Composer
          state={ann.composer}
          quote={ann.composer.kind === 'new' ? ann.composer.sel.text : ann.annotations.find((a) => a.id === (ann.composer as { id: string }).id)?.text ?? ''}
          onChange={(patch) => ann.setComposer((c) => (c ? { ...c, ...patch } : c))}
          onSave={() => void ann.saveComposer()}
          onCancel={ann.cancelComposer}
        />
      )}
      {ann.peek && !ann.composer && (() => {
        const a = ann.annotations.find((x) => x.id === ann.peek!.id);
        return a ? (
          <PeekCard
            annotation={a}
            peek={ann.peek}
            count={ann.annotations.length}
            onEdit={() => ann.startEdit(a.id)}
            onDelete={() => ann.remove(a.id)}
            onClose={() => ann.setPeek(null)}
            onOpenPanel={() => { ann.setPeek(null); actions.current.toggleNotes(); }}
          />
        ) : null;
      })()}
      {ann.hover && !ann.peek && !ann.composer && <HoverTip hover={ann.hover} />}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      <NightLightOverlay />
    </>
  );

  const view2 = viewRef.current;
  const ready = state.kind === 'ready';
  const drawer = tocOpen || settingsOpen;
  const chromeProps = (kind: 'top' | 'bottom') => ({
    className: `st-chrome st-chrome-${kind}${chromeVisible || !settings.autoHide ? ' shown' : ''}`,
    onMouseEnter: () => { hoverChrome.current = true; window.clearTimeout(chromeTimer.current); },
    onMouseLeave: () => { hoverChrome.current = false; chromeApi.current.schedule(); },
    onFocus: (e: React.FocusEvent) => {
      if ((e.target as HTMLElement).matches?.(':focus-visible')) {
        focusChrome.current = true;
        setChromeVisible(true);
        window.clearTimeout(chromeTimer.current);
      }
    },
    onBlur: (e: React.FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        focusChrome.current = false;
        chromeApi.current.schedule();
      }
    },
  });
  return (
    <div
      ref={rootRef}
      className="reader reader-studio"
      style={{ ['--book-bg' as string]: palette.bg, ['--book-fg' as string]: palette.fg }}
      data-book-theme={themeName}
    >
      {stageEl}
      {loadOverlays}

      <div {...chromeProps('top')}>
        <ReaderTopChrome
          title={book?.title ?? ''}
          chapter={position.label}
          sync={syncStatus}
          syncing={syncing}
          onSync={() => { void syncNow().catch((e) => toast((e as Error).message, 'error')); }}
          autoHide={settings.autoHide}
          onAutoHide={(autoHide) => patchSettings({ autoHide })}
        />
      </div>

      <div className={`st-scrim${drawer ? ' open' : ''}`} onClick={closePanels} aria-hidden="true" />
      <div className={`st-drawer st-drawer-left${tocOpen ? ' open' : ''}`}>{tocPanel}</div>
      <div className={`st-drawer st-drawer-right${settingsOpen ? ' open' : ''}`}>
        <ReaderAside
          settings={settings}
          fixedLayout={fixedLayout}
          onChange={patchSettings}
          tts={{
            playing: tts.state.status === 'playing',
            idle: tts.state.status === 'idle',
            unavailable: tts.unavailable,
            voiceName: tts.voice?.name,
            onToggle: () => actions.current.readAloud(),
            rate: settings.ttsRate,
            onRate: tts.setRate,
          }}
        />
      </div>

      <div {...chromeProps('bottom')}>
        <ReaderDock
          fraction={position.fraction}
          rtl={rtl}
          settings={settings}
          fixedLayout={fixedLayout}
          ready={ready}
          bookmarked={!!currentBookmark}
          speaking={tts.state.status !== 'idle'}
          fullscreen={fullscreen}
          fullscreenSupported={fullscreenSupported}
          railOpen={tocOpen}
          asideOpen={settingsOpen}
          onPrev={() => void view2?.prev()}
          onNext={() => void view2?.next()}
          onSeek={(f) => void view2?.goToFraction(f)}
          onChange={patchSettings}
          onReadAloud={() => actions.current.readAloud()}
          onBookmark={() => actions.current.toggleBookmark()}
          onFullscreen={() => actions.current.toggleFullscreen()}
          onToggleRail={() => actions.current.toggleToc()}
          onToggleAside={() => { setTocOpen(false); setSettingsOpen((o) => !o); }}
          onSliderDrag={(d) => { draggingSlider.current = d; if (!d) chromeApi.current.schedule(); }}
        />
      </div>

      {tts.state.status !== 'idle' && !chromeVisible && (
        <button
          type="button"
          className="st-tts-mini"
          aria-label={tts.state.status === 'playing' ? 'Pause reading aloud (R)' : 'Resume reading aloud (R)'}
          onClick={() => actions.current.readAloud()}
        >
          {tts.state.status === 'playing' ? '❚❚' : '▶'}
        </button>
      )}
      {tail}
    </div>
  );
}
