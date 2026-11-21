import { runtimeImport } from '../lib/runtimeImport';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Book, Bookmark } from '@shared/types';
import { api, fileUrl } from '../api';
import { IconBack, IconClose, IconSettings, IconToc } from '../components/Icons';
import NightLightOverlay from '../components/NightLightOverlay';
import HelpOverlay from '../components/reader/HelpOverlay';
import ContextMenu, { type MenuItem } from '../components/ContextMenu';
import ReadAloudBar from '../components/reader/ReadAloudBar';
import { useReadAloud } from '../components/reader/useReadAloud';
import { IconBookmark, IconFullscreen, IconNightLight, IconSpeaker } from '../components/reader/ReaderIcons';
import { findBookmarkOnPage, pageStart, type CfiModule } from '../components/reader/bookmarkUtils';
import { useBookSearch } from '../components/reader/useBookSearch';
import { useWakeLock } from '../components/reader/useWakeLock';
import ReaderSettingsPanel from '../components/ReaderSettingsPanel';
import TocPanel, { type PanelTab } from '../components/TocPanel';
import { useNightLight } from '../lib/nightLight';
import '../reader.css';
import { formatBytes, formatPercent } from '../lib/format';
import { useDismiss } from '../lib/hooks';
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

function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const FOLIATE_VIEW_URL = '/foliate-js/view.js';
const CHROME_IDLE_MS = 2500;
const SAVE_DEBOUNCE_MS = 1500;
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

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const footnoteHostRef = useRef<HTMLDivElement>(null);
  const footnoteViewRef = useRef<FoliateView | null>(null);
  const cfiRef = useRef<CfiModule | null>(null);
  const fileRef = useRef<File | null>(null);
  const getFile = useCallback(() => fileRef.current, []);

  const [book, setBook] = useState<Book>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [toc, setToc] = useState<FoliateTocItem[]>([]);
  const [ticks, setTicks] = useState<number[]>([]);
  const [rtl, setRtl] = useState(false);
  const [fixedLayout, setFixedLayout] = useState(false);
  const [position, setPosition] = useState<Position>({ fraction: 0, label: '' });
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('contents');
  const [searchFocus, setSearchFocus] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [bookLang, setBookLang] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; range: Range | null; selected: string } | null>(null);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const nightLight = useNightLight();
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
  });
  useDismiss(settingsRef, settingsOpen, () => setSettingsOpen(false));

  // ---- Bookmarks ----
  useEffect(() => {
    let stale = false;
    setBookmarks([]);
    api.listBookmarks(id).then((b) => { if (!stale) setBookmarks(b); }, () => { /* non-fatal */ });
    return () => { stale = true; };
  }, [id]);

  const currentBookmark = findBookmarkOnPage(bookmarks, position.cfi, cfiRef.current);

  actions.current = {
    toggleBookmark: () => {
      const { position: pos, bookmarks: list } = live.current;
      const existing = findBookmarkOnPage(list, pos.cfi, cfiRef.current);
      if (existing) {
        setBookmarks((bs) => bs.filter((b) => b.id !== existing.id));
        api.deleteBookmark(existing.id).catch(() => setBookmarks((bs) => [...bs, existing]));
      } else if (pos.cfi) {
        const label = `${pos.label || 'Page'} — ${formatPercent(pos.fraction)}`;
        api.createBookmark(id, { location: pageStart(pos.cfi, cfiRef.current), label, progress: pos.fraction })
          .then((b) => setBookmarks((bs) => [...bs, b].sort((a, c) => a.progress - c.progress)))
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
    closeFootnote: () => setFootnoteOpen(false),
    readAloud: () => tts.toggle(),
    ttsPrev: () => { if (tts.state.status !== 'idle') tts.prev(); },
    ttsNext: () => { if (tts.state.status !== 'idle') tts.next(); },
    escape: () => {
      const l = live.current;
      if (menu) setMenu(null);
      else if (l.helpOpen) setHelpOpen(false);
      else if (tts.state.status !== 'idle' && !l.tocOpen) tts.stop();
      else if (l.footnoteOpen) setFootnoteOpen(false);
      else closePanels();
    },
  };

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ---- Chrome auto-hide ----
  const hideTimer = useRef<number>();
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const poke = useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!panelOpenRef.current) setChromeVisible(false);
    }, CHROME_IDLE_MS);
  }, []);
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke, panelOpen]);

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
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const queueSave = (progress: number, location: string | null) => {
      pending = { progress, location };
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return actions.current.escape();
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
        case 'b': case 'B': actions.current.toggleBookmark(); break;
        case 't': case 'T': actions.current.toggleToc(); break;
        case 'r': case 'R': actions.current.readAloud(); break;
        case '[': actions.current.ttsPrev(); break;
        case ']': actions.current.ttsNext(); break;
        case '?': actions.current.toggleHelp(); break;
        case 'ArrowLeft': void v.goLeft(); break;
        case 'ArrowRight': void v.goRight(); break;
        case 'PageUp': void v.prev(); break;
        case 'PageDown': void v.next(); break;
        case ' ': void (e.shiftKey ? v.prev() : v.next()); break;
        default: return;
      }
      e.preventDefault();
    };

    /** Left 25% = previous page, right 25% = next, centre toggles the chrome. */
    const onTap = (x: number) => {
      const v = viewRef.current;
      if (!v) return;
      const ratio = x / window.innerWidth;
      if (ratio < 0.25) void v.goLeft();
      else if (ratio > 0.75) void v.goRight();
      else setChromeVisible((visible) => !visible);
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

        const res = await fetch(fileUrl(id));
        if (!res.ok) throw new Error(`Could not download the book (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        // foliate-js detects the format from the file name, which our URL lacks.
        const file = new File([blob], `book.${b.format}`, { type: blob.type });
        fileRef.current = file;

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

        view.addEventListener('load', ((e: CustomEvent<{ doc: Document }>) => {
          const doc = e.detail.doc;
          doc.addEventListener('keydown', onKey);
          doc.addEventListener('mousemove', poke);
          doc.addEventListener('contextmenu', (ev) => {
            if (!ttsAvail.current) return;
            ev.preventDefault();
            const frame = doc.defaultView?.frameElement;
            const r = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
            const sel = doc.getSelection();
            const selected = sel && !sel.isCollapsed ? sel.toString() : '';
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
            setMenu({ x: r.left + ev.clientX, y: r.top + ev.clientY, range, selected });
          });
          doc.addEventListener('click', (ev) => {
            if (live.current.footnoteOpen && !(ev.target as Element | null)?.closest?.('a[href]')) {
              actions.current.closeFootnote();
              return;
            }
            if ((ev.target as Element | null)?.closest?.('a[href]')) return;
            if (doc.defaultView?.getSelection()?.toString()) return;
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
        setTicks(view.getSectionFractions());

        if (b.location) await view.init({ lastLocation: b.location });
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
  }, [id, poke]);

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

  return (
    <div
      className={`reader reader-${themeName}`}
      style={{ ['--r-bg' as string]: palette.bg, ['--r-fg' as string]: palette.fg }}
      onMouseMove={poke}
      onTouchStart={() => {
        /* taps are handled by click zones; touch keeps chrome from hiding mid-gesture */
        window.clearTimeout(hideTimer.current);
      }}
    >
      <div
        ref={containerRef}
        className="reader-stage"
        onClick={(e) => {
          // Clicks outside the book iframe (page margins).
          if ((e.target as HTMLElement).closest('.reader-header, .reader-footer, .reader-panel, .reader-popover, .footnote-pop')) return;
          if (footnoteOpen) return setFootnoteOpen(false);
          const ratio = e.clientX / window.innerWidth;
          if (ratio < 0.25) void view?.goLeft();
          else if (ratio > 0.75) void view?.goRight();
          else setChromeVisible((v) => !v);
        }}
      />

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

      <header className={`reader-header${chrome ? '' : ' hidden'}`}>
        <button className="icon-btn" aria-label="Back to book details" onClick={() => navigate(`/book/${id}`)}>
          <IconBack />
        </button>
        <div className="reader-title" title={book?.title}>{book?.title}</div>
        <button
          className="icon-btn"
          aria-label={currentBookmark ? 'Remove bookmark (B)' : 'Add bookmark (B)'}
          aria-pressed={!!currentBookmark}
          onClick={() => actions.current.toggleBookmark()}
        >
          <IconBookmark filled={!!currentBookmark} />
        </button>
        <button
          className="icon-btn"
          aria-label="Blue light filter"
          aria-pressed={nightLight.settings.mode !== 'off'}
          onClick={nightLight.toggle}
        >
          <IconNightLight active={nightLight.settings.mode !== 'off'} />
        </button>
        <button
          className="icon-btn"
          aria-label={tts.state.status === 'idle' ? 'Read aloud (R)' : 'Pause / resume reading (R)'}
          aria-pressed={tts.state.status !== 'idle'}
          aria-disabled={!!tts.unavailable}
          onClick={() => actions.current.readAloud()}
        >
          <IconSpeaker />
        </button>
        {fullscreenSupported && (
          <button
            className="icon-btn"
            aria-label={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            onClick={() => actions.current.toggleFullscreen()}
          >
            <IconFullscreen exit={fullscreen} />
          </button>
        )}
        <button
          className="icon-btn"
          aria-label="Contents, bookmarks and search (T)"
          aria-expanded={tocOpen}
          onClick={() => actions.current.toggleToc()}
        >
          <IconToc />
        </button>
        <div ref={settingsRef} className="popover-anchor">
          <button
            className="icon-btn"
            aria-label="Reader settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              setTocOpen(false);
              setSettingsOpen((o) => !o);
            }}
          >
            <IconSettings />
          </button>
          {settingsOpen && (
            <ReaderSettingsPanel settings={settings} fixedLayout={fixedLayout} onChange={patchSettings} />
          )}
        </div>
      </header>

      {tocOpen && (
        <TocPanel
          tab={panelTab}
          onTab={setPanelTab}
          toc={toc}
          currentHref={position.currentHref}
          bookmarks={bookmarks}
          search={search}
          searchFocusToken={searchFocus}
          onClose={() => setTocOpen(false)}
          onSelect={(href) => {
            void view?.goTo(href);
            setTocOpen(false);
          }}
          onJumpLocation={(loc) => {
            void view?.goTo(loc);
            // On narrow screens the panel covers the page; keep it open on desktop to browse hits.
            if (window.innerWidth < 800) setTocOpen(false);
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
      )}

      <footer className={`reader-footer${chrome && state.kind === 'ready' ? '' : ' hidden'}`}>
        <div className="reader-footer-info">
          <span className="reader-chapter">{position.label}</span>
          <span>
            {position.loc ? `${position.loc} · ` : ''}
            {formatPercent(position.fraction)}
          </span>
        </div>
        {!fixedLayout && position.time && (
          <div className="reader-time">
            {formatMinutes(position.time.section)} left in chapter · {formatMinutes(position.time.total)} left in book
          </div>
        )}
        <input
          className="reader-slider"
          type="range"
          min={0}
          max={1}
          step="any"
          dir={rtl ? 'rtl' : 'ltr'}
          list="reader-ticks"
          aria-label="Reading progress"
          value={position.fraction}
          onChange={(e) => void view?.goToFraction(Number(e.target.value))}
        />
        <datalist id="reader-ticks">
          {ticks.map((t) => <option key={t} value={t} />)}
        </datalist>
      </footer>

      {/* Footnote popover: the host is always mounted so foliate can lay the view out. */}
      <div className={`footnote-pop${footnoteOpen ? ' open' : ''}`} role="dialog" aria-label="Footnote">
        <button className="icon-btn footnote-close" aria-label="Close footnote" onClick={() => setFootnoteOpen(false)}>
          <IconClose />
        </button>
        <div ref={footnoteHostRef} className="footnote-host" />
      </div>

      {tts.state.status !== 'idle' || tts.state.error ? (
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
          const items: MenuItem[] = [
            { label: menu.selected ? 'Read aloud from selection' : 'Read from here', onSelect: () => tts.start(menu.range) },
          ];
          if (menu.selected) {
            items.push({ label: 'Copy', onSelect: () => void navigator.clipboard?.writeText(menu.selected).catch(() => {}) });
          }
          return items;
        })()} />
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      <NightLightOverlay />
    </div>
  );
}
