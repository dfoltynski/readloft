import { Link, useNavigate } from 'react-router-dom';
import type { Book } from '@shared/types';
import { BOOKS_DRAG_TYPE } from '../../components/BookCard';
import Cover from '../../components/Cover';
import { IconCheck, IconMore } from '../../components/Icons';
import { authorLine, formatPercent } from '../../lib/format';

interface Props {
  book: Book;
  view: 'grid' | 'list';
  notes: number;
  /** The book shown in the inspector. */
  inspected: boolean;
  /** A plain click opens the details page instead of inspecting (inspector hidden). */
  openOnClick: boolean;
  onInspect: (book: Book) => void;
  onMenu: (book: Book, x: number, y: number) => void;
  selected: boolean;
  selectionActive: boolean;
  getDragIds: (book: Book) => string[];
  dragging: boolean;
  onDragChange: (ids: string[] | null) => void;
  onSelect: (book: Book, mods: { shift: boolean; toggle: boolean }) => void;
}

export default function StudioBookCard({
  book, view, notes, inspected, openOnClick, onInspect, onMenu, selected, selectionActive, getDragIds, dragging, onDragChange, onSelect,
}: Props) {
  const navigate = useNavigate();
  const reading = book.status === 'reading';
  const cls = ['st-card', view === 'list' && 'st-card-list', (inspected || selected) && 'sel', selectionActive && 'selecting', dragging && 'dragging']
    .filter(Boolean).join(' ');
  const pct = formatPercent(book.progress);
  return (
    <article
      className={cls}
      draggable
      onDragStart={(e) => {
        const ids = getDragIds(book);
        e.dataTransfer.setData(BOOKS_DRAG_TYPE, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'copy';
        if (ids.length > 1) {
          const ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.textContent = `${ids.length} books`;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 20, 20);
          setTimeout(() => ghost.remove(), 0);
        }
        onDragChange(ids);
      }}
      onDragEnd={() => onDragChange(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(book, e.clientX, e.clientY);
      }}
      onDoubleClick={() => navigate(`/book/${book.id}`)}
    >
      <Link
        to={`/book/${book.id}`}
        className="st-card-link"
        draggable={false}
        aria-label={`${book.title}, details`}
        onClick={(e) => {
          const toggle = e.metaKey || e.ctrlKey;
          if (toggle || e.shiftKey || selectionActive) {
            e.preventDefault();
            onSelect(book, { shift: e.shiftKey, toggle: toggle || (selectionActive && !e.shiftKey) });
          } else if (!openOnClick) {
            e.preventDefault();
            onInspect(book);
          }
        }}
      >
        <div className="st-tile">
          <span className="st-tag">{book.format.toUpperCase()}</span>
          {book.status === 'finished'
            ? <span className="st-tag r">✓ finished</span>
            : notes > 0 && <span className="st-tag r">{notes} {notes === 1 ? 'note' : 'notes'}</span>}
          <div className="st-cover"><Cover book={book} /></div>
        </div>
        <div className="st-card-text">
          <div className="st-card-title">{book.title}</div>
          <div className="st-card-author">{authorLine(book) || 'Unknown author'}</div>
          {reading && (
            <div className="st-bar" aria-label={`${pct} read`}><i style={{ width: pct }} /></div>
          )}
        </div>
      </Link>
      <button
        type="button"
        className="select-check"
        aria-pressed={selected}
        aria-label={`Select ${book.title}`}
        onClick={(e) => onSelect(book, { shift: e.shiftKey, toggle: !e.shiftKey })}
      >
        {selected && <IconCheck size={14} />}
      </button>
      <button
        type="button"
        className="icon-btn card-more"
        aria-label={`More actions for ${book.title}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(book, r.left, r.bottom + 4);
        }}
      >
        <IconMore />
      </button>
    </article>
  );
}
