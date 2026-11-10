import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { BookStatus, LibraryStats, Shelf } from '@shared/types';
import { api } from '../api';
import { BOOKS_DRAG_TYPE } from './BookCard';
import { useTheme } from '../lib/hooks';
import ContextMenu from './ContextMenu';
import { useToast } from './Toast';
import {
  IconBooks, IconCheck, IconCircle, IconLogo, IconMoon, IconPlus, IconReading, IconRefresh,
  IconShelf, IconSun,
} from './Icons';

interface Props {
  shelves: Shelf[];
  stats: LibraryStats | undefined;
  activeShelfId?: string;
  activeStatus?: BookStatus;
  open: boolean;
  onClose: () => void;
  /** Called after anything that changes shelves or the book list (scan, shelf edits). */
  onChanged: () => void;
}

const FILTERS: { label: string; status?: BookStatus; icon: ReactNode; count: (s: LibraryStats) => number }[] = [
  { label: 'All Books', icon: <IconBooks />, count: (s) => s.total },
  { label: 'Currently Reading', status: 'reading', icon: <IconReading />, count: (s) => s.reading },
  { label: 'Finished', status: 'finished', icon: <IconCheck />, count: (s) => s.finished },
  { label: 'Unread', status: 'unread', icon: <IconCircle />, count: (s) => s.unread },
];

export default function Sidebar({ shelves, stats, activeShelfId, activeStatus, open, onClose, onChanged }: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, toggleTheme] = useTheme();
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menu, setMenu] = useState<{ shelf: Shelf; x: number; y: number } | null>(null);
  const [dropShelfId, setDropShelfId] = useState<string | null>(null);
  const newInput = useRef<HTMLInputElement>(null);

  // Close the mobile drawer after navigating.
  useEffect(onClose, [location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (creating) newInput.current?.focus();
  }, [creating]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const createShelf = async () => {
    const name = newName.trim();
    setCreating(false);
    setNewName('');
    if (name) await run(() => api.createShelf(name));
  };

  const commitRename = async () => {
    const id = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    if (id && name) await run(() => api.renameShelf(id, name));
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const r = await api.scan();
      toast(`Scan complete: ${r.added} added, ${r.updated} updated, ${r.removed} removed`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setScanning(false);
    }
  };

  const isBookDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(BOOKS_DRAG_TYPE);

  const dropBooks = async (e: React.DragEvent, shelf: Shelf) => {
    if (!isBookDrag(e)) return;
    e.preventDefault();
    setDropShelfId(null);
    try {
      const ids = JSON.parse(e.dataTransfer.getData(BOOKS_DRAG_TYPE)) as string[];
      const r = await api.addBooksToShelf(shelf.id, ids);
      toast(r.added === 0 ? `Already on “${shelf.name}”` : `Added ${r.added} book${r.added === 1 ? '' : 's'} to “${shelf.name}”`);
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const deleteShelf = async (shelf: Shelf) => {
    if (!window.confirm(`Delete shelf “${shelf.name}”? Books stay in your library.`)) return;
    await run(() => api.deleteShelf(shelf.id));
    if (activeShelfId === shelf.id) navigate('/');
  };

  return (
    <>
      {open && <div className="scrim" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Library navigation">
        <Link to="/" className="brand">
          <IconLogo size={22} />
          <span>Readloft</span>
        </Link>

        <nav className="side-scroll">
          <div className="side-heading">Library</div>
          {FILTERS.map((f) => {
            const active = !activeShelfId && activeStatus === f.status;
            return (
              <Link
                key={f.label}
                to={f.status ? `/?status=${f.status}` : '/'}
                className={`side-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {f.icon}
                <span className="side-label">{f.label}</span>
                {stats && <span className="side-count">{f.count(stats)}</span>}
              </Link>
            );
          })}

          <div className="side-heading side-heading-row">
            <span>Shelves</span>
            <button className="icon-btn" aria-label="New shelf" onClick={() => setCreating(true)}>
              <IconPlus size={15} />
            </button>
          </div>
          {shelves.map((s) =>
            renamingId === s.id ? (
              <input
                key={s.id}
                className="side-input"
                aria-label="Shelf name"
                value={renameValue}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <NavLink
                key={s.id}
                to={`/shelf/${s.id}`}
                className={({ isActive }) => `side-item${isActive ? ' active' : ''}${dropShelfId === s.id ? ' drop-target' : ''}`}
                onDragOver={(e) => {
                  if (!isBookDrag(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (dropShelfId !== s.id) setDropShelfId(s.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropShelfId((cur) => (cur === s.id ? null : cur));
                }}
                onDrop={(e) => void dropBooks(e, s)}
                draggable={false}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ shelf: s, x: e.clientX, y: e.clientY });
                }}
              >
                <IconShelf />
                <span className="side-label">{s.name}</span>
                <span className="side-count">{s.bookCount}</span>
                <button
                  type="button"
                  className="icon-btn side-more"
                  aria-label={`Actions for shelf ${s.name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ shelf: s, x: r.left, y: r.bottom + 4 });
                  }}
                >
                  …
                </button>
              </NavLink>
            ),
          )}
          {creating ? (
            <input
              ref={newInput}
              className="side-input"
              placeholder="Shelf name"
              aria-label="New shelf name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={createShelf}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createShelf();
                if (e.key === 'Escape') {
                  setNewName('');
                  setCreating(false);
                }
              }}
            />
          ) : (
            <button className="side-item side-new" onClick={() => setCreating(true)}>
              <IconPlus />
              <span className="side-label">New shelf</span>
            </button>
          )}
        </nav>

        <div className="side-footer">
          <button className="btn btn-quiet" onClick={rescan} disabled={scanning}>
            <IconRefresh /> {scanning ? 'Scanning…' : 'Rescan library'}
          </button>
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </aside>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Rename',
              onSelect: () => {
                setRenamingId(menu.shelf.id);
                setRenameValue(menu.shelf.name);
              },
            },
            { label: 'Delete shelf', danger: true, onSelect: () => deleteShelf(menu.shelf) },
          ]}
        />
      )}
    </>
  );
}
