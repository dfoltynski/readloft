import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import ContextMenu from '../../components/ContextMenu';
import { useToast } from '../../components/Toast';
import { formatRelative } from '../../lib/format';
import { useAsync, useTheme } from '../../lib/hooks';
import { openShortcuts } from '../../lib/shortcuts';
import { useOnSynced, useSyncStatus } from '../../lib/sync';
import { setDesignSystem } from '../designSystem';
import { useNoteCounts } from './hooks';
import { LogoTile, SIcon } from './icons';

export interface TopBarSearch {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement>;
}

interface Props {
  active: 'library' | 'notes' | 'none';
  search?: TopBarSearch;
  /** Shows the Upload button. */
  onUpload?: () => void;
  /** Called after a rescan or sync changed the data. */
  onChanged?: () => void;
  /** Opens the sidebar drawer on narrow screens. */
  onMenu?: () => void;
  /** Changes whenever the page's data changes, to refresh the counters. */
  refreshKey?: unknown;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

export default function StudioTopBar({ active, search, onUpload, onChanged, onMenu, refreshKey }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [theme, toggleTheme] = useTheme();
  const own = useRef<HTMLInputElement>(null);
  const input = search?.inputRef ?? own;
  const [local, setLocal] = useState('');
  const [scanning, setScanning] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { status: sync, syncing, syncNow } = useSyncStatus();
  const stats = useAsync(() => api.stats(), [refreshKey]);
  const notes = useNoteCounts(refreshKey);
  useOnSynced(stats.reload);
  useEffect(() => {
    const t = setInterval(stats.reload, 60_000);
    return () => clearInterval(t);
  }, [stats.reload]);

  // "/" focuses the search box (the library page also wires this up itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [input]);

  const runSync = useCallback(async () => {
    try {
      const s = await syncNow();
      if (!s) return;
      if (s.error) toast(`Sync error: ${s.error}`, 'error');
      else if (!s.enabled) toast('Sync is off (SYNC=0)');
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }, [syncNow, toast, onChanged]);

  const rescan = async () => {
    setScanning(true);
    try {
      const r = await api.scan();
      toast(`Scan complete: ${r.added} added, ${r.updated} updated, ${r.removed} removed`);
      stats.reload();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setScanning(false);
    }
  };

  const ok = !!sync?.enabled && !sync.error;
  const syncText = !sync ? '' : !sync.enabled ? 'sync off' : sync.error ? 'sync error' : sync.lastMergeAt ? `synced ${formatRelative(sync.lastMergeAt)}` : 'synced';
  const syncTitle = !sync ? 'Sync status'
    : !sync.enabled ? 'Sync is off (SYNC=0)'
    : sync.error ? `Sync error: ${sync.error}`
    : `Synced with ${sync.devices.length} other device${sync.devices.length === 1 ? '' : 's'}`;
  const s = stats.data;

  return (
    <header className="st-top">
      {onMenu && (
        <button className="st-icon-btn st-menu-btn" aria-label="Open sidebar" onClick={onMenu}><SIcon.Menu /></button>
      )}
      <Link to="/" className="st-brand" aria-label="Readloft home">
        <LogoTile />
        <b>readloft</b>
      </Link>
      <nav className="st-nav" aria-label="Sections">
        <Link to="/" aria-current={active === 'library' ? 'page' : undefined}>Library</Link>
        <Link to="/notes" aria-current={active === 'notes' ? 'page' : undefined}>Notes</Link>
      </nav>
      <div className="st-search">
        <SIcon.Search />
        <input
          ref={input}
          type="search"
          aria-label="Search"
          placeholder={search?.placeholder ?? 'Search books, authors…'}
          value={search ? search.value : local}
          onChange={(e) => (search ? search.onChange(e.target.value) : setLocal(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
            if (e.key === 'Enter' && !search && local.trim()) navigate(`/?q=${encodeURIComponent(local.trim())}`);
          }}
        />
        <span className="st-kbd">/</span>
      </div>
      <div className="st-grow" />
      <span className="st-stats" title={syncTitle}>
        <span className={`st-dot${ok ? '' : ' warn'}`} aria-hidden="true" />
        {s ? `${s.total} books · ${s.reading} reading · ` : ''}
        {notes.loaded ? `${notes.total} notes` : ''}
        {syncText ? ` · ${syncText}` : ''}
      </span>
      <button className="st-btn" onClick={runSync} disabled={syncing} aria-label="Sync now" data-tip="Sync now">
        <span className={syncing ? 'st-spin' : undefined}><SIcon.Sync /></span>
        <span className="st-btn-label">{syncing ? 'Syncing' : 'Sync'}</span>
      </button>
      <button className="st-btn" onClick={rescan} disabled={scanning}>{scanning ? 'Scanning…' : 'Rescan'}</button>
      {onUpload && (
        <button className="st-btn primary" onClick={onUpload}>
          <SIcon.Upload /> <span className="st-btn-label">Upload</span>
        </button>
      )}
      <button
        className="st-icon-btn"
        aria-label="Settings menu"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right - 190, y: r.bottom + 6 });
        }}
      >
        <SIcon.Gear />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: theme === 'dark' ? 'Light theme' : 'Dark theme', onSelect: toggleTheme },
            { label: 'Keyboard shortcuts', onSelect: openShortcuts },
            { label: 'Classic design', separatorBefore: true, onSelect: () => setDesignSystem('classic') },
          ]}
        />
      )}
    </header>
  );
}
