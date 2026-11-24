import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Book, BookStatus, Shelf } from '@shared/types';
import { api } from '../../api';
import ContextMenu from '../../components/ContextMenu';
import Cover from '../../components/Cover';
import { useToast } from '../../components/Toast';
import { authorLine, formatBytes, formatPercent, formatRelative } from '../../lib/format';
import StatusSeg from './StatusSeg';

interface Props {
  book: Book | undefined;
  notes: number;
  shelves: Shelf[];
  /** Reload lists after a change. */
  onChanged: () => void;
}

/** Right-hand "Selected" panel in the library. */
export default function Inspector({ book, notes, shelves, onChanged }: Props) {
  const toast = useToast();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!book) {
    return (
      <aside className="st-insp" aria-label="Selected book">
        <div className="st-caps">Selected</div>
        <p className="st-muted">Select a book to see its details.</p>
      </aside>
    );
  }
  const manual = shelves.filter((s) => s.source === 'manual');
  const onShelves = shelves.filter((s) => book.shelfIds.includes(s.id));
  const started = book.progress > 0 && book.status !== 'unread';
  const last = formatRelative(book.lastOpenedAt);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const setStatus = (status: BookStatus) => run(() => api.patchBook(book.id, { status }));

  return (
    <aside className="st-insp" aria-label="Selected book">
      <div className="st-caps">Selected</div>
      <div className="st-tile st-tile-lg">
        <div className="st-cover st-cover-lg"><Cover book={book} /></div>
      </div>
      <div>
        <h2><Link to={`/book/${book.id}`}>{book.title}</Link></h2>
        <div className="st-muted">
          {[authorLine(book) || 'Unknown author', book.format.toUpperCase(), formatBytes(book.fileSize)].join(' · ')}
        </div>
      </div>
      <div>
        <div className="st-row"><span className="st-caps">Progress</span><span className="st-mono">{book.status === 'finished' ? '100%' : formatPercent(book.progress)}</span></div>
        <div className="st-bar" style={{ marginTop: 8 }}><i style={{ width: book.status === 'finished' ? '100%' : formatPercent(book.progress) }} /></div>
      </div>
      <StatusSeg value={book.status} onChange={setStatus} />
      <div>
        <div className="st-caps" style={{ marginBottom: 8 }}>Shelves</div>
        <div className="st-chips">
          {onShelves.map((s) => (
            <Link key={s.id} to={`/shelf/${s.id}`} className="st-chip" title={s.folder ?? s.name}>{s.name}</Link>
          ))}
          <button
            type="button"
            className="st-chip dash"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 4 });
            }}
          >
            + Add
          </button>
        </div>
      </div>
      <div className="st-facts">
        <div className="st-fact">
          <span>Notes</span>
          <b>{notes > 0 ? <Link to={`/read/${book.id}?panel=notes`}>{notes}</Link> : 0}</b>
        </div>
        <div className="st-fact"><span>Added</span><b>{new Date(book.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b></div>
      </div>
      <div className="st-box">
        {started || book.status === 'finished'
          ? <><b>Last read</b> {last || 'recently'}</>
          : <><b>Not started yet.</b> Opens at the beginning.</>}
      </div>
      <Link to={`/read/${book.id}`} className="st-btn primary st-cta">
        {book.status === 'reading' && started ? 'Continue reading' : book.status === 'finished' ? 'Read again' : 'Start reading'}
      </Link>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={manual.length === 0
            ? [{ label: 'No shelves yet — create one in the sidebar' }]
            : manual.map((s) => {
              const member = book.shelfIds.includes(s.id);
              return {
                label: s.name,
                checked: member,
                onSelect: () => run(() => (member ? api.removeFromShelf(s.id, book.id) : api.addToShelf(s.id, book.id))),
              };
            })}
        />
      )}
    </aside>
  );
}
