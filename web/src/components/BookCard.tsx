import { Link } from 'react-router-dom';
import type { Book } from '@shared/types';
import Cover from './Cover';
import { IconMore } from './Icons';
import { authorLine, formatPercent } from '../lib/format';

interface Props {
  book: Book;
  view: 'grid' | 'list';
  onMenu: (book: Book, x: number, y: number) => void;
}

export default function BookCard({ book, view, onMenu }: Props) {
  const reading = book.status === 'reading';
  return (
    <article
      className={`book-card book-card-${view}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(book, e.clientX, e.clientY);
      }}
    >
      <Link to={`/book/${book.id}`} className="book-link" aria-label={`${book.title}, details`}>
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
