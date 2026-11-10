import { Link } from 'react-router-dom';
import type { Book } from '@shared/types';
import Cover from './Cover';
import { IconCheck, IconMore } from './Icons';
import { authorLine, formatPercent } from '../lib/format';

export const BOOKS_DRAG_TYPE = 'application/x-readloft-books';

interface Props {
  book: Book;
  view: 'grid' | 'list';
  onMenu: (book: Book, x: number, y: number) => void;
  selected: boolean;
  selectionActive: boolean;
  /** Ids to drag when this card is dragged (all selected if selected, else just this book). */
  getDragIds: (book: Book) => string[];
  dragging: boolean;
  onDragChange: (ids: string[] | null) => void;
  onSelect: (book: Book, mods: { shift: boolean; toggle: boolean }) => void;
}

export default function BookCard({ book, view, onMenu, selected, selectionActive, getDragIds, dragging, onDragChange, onSelect }: Props) {
  const reading = book.status === 'reading';
  const cls = ['book-card', `book-card-${view}`, selected && 'selected', selectionActive && 'selecting', dragging && 'dragging']
    .filter(Boolean).join(' ');
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
    >
      <Link
        to={`/book/${book.id}`}
        className="book-link"
        draggable={false}
        aria-label={`${book.title}, details`}
        onClick={(e) => {
          const toggle = e.metaKey || e.ctrlKey;
          if (toggle || e.shiftKey || selectionActive) {
            e.preventDefault();
            onSelect(book, { shift: e.shiftKey, toggle: toggle || (selectionActive && !e.shiftKey) });
          }
        }}
      >
        <div className="cover-wrap">
          <Cover book={book} />
          {reading && (
            <div className="cover-progress" aria-hidden="true">
              <div style={{ width: formatPercent(book.progress) }} />
            </div>
          )}
          {book.status === 'finished' && <span className="badge">Finished</span>}
        </div>
        <div className="book-meta">
          <div className="book-title">{book.title}</div>
          <div className="book-author">{authorLine(book) || 'Unknown author'}</div>
          {view === 'list' && (
            <div className="book-extra">
              {book.format.toUpperCase()}
              {reading ? ` · ${formatPercent(book.progress)}` : ''}
            </div>
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
