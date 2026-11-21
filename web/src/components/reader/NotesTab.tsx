import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import type { Annotation, AnnotationColor } from '@shared/types';
import { ANNOTATION_COLORS, COLOR_HEX, COLOR_LABEL, bookNotesMarkdown, downloadText, matchesFilter, shortDate, type AnnotationKindFilter } from '../../lib/annotations';
import { formatPercent } from '../../lib/format';

type Filter = 'all' | 'notes' | 'highlights' | AnnotationColor;

interface Props {
  annotations: Annotation[];
  fraction: number;
  bookTitle: string;
  authors: string[];
  onJump: (a: Annotation) => void;
}

export function NoteItem({ a, onClick, showBook }: { a: Annotation; onClick: () => void; showBook?: string }) {
  return (
    <button className="note-item" style={{ ['--c' as string]: COLOR_HEX[a.color] } as CSSProperties} onClick={onClick}>
      <span className="note-bar" aria-hidden="true" />
      <span className="note-body">
        {showBook && <span className="note-book">{showBook}</span>}
        <span className="note-quote">{a.text}</span>
        {a.note && <span className="note-text">{a.note}</span>}
        <span className="note-meta">{formatPercent(a.progress)} · {a.note ? shortDate(a.updatedAt) : 'highlight'}</span>
      </span>
    </button>
  );
}

export default function NotesTab({ annotations, fraction, bookTitle, authors, onJump }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'book' | 'recent'>('book');

  const filtered = useMemo(() => {
    const kind: AnnotationKindFilter = filter === 'notes' || filter === 'highlights' ? filter : 'all';
    const color: AnnotationColor | '' = ANNOTATION_COLORS.includes(filter as AnnotationColor) ? (filter as AnnotationColor) : '';
    const list = annotations.filter((a) => matchesFilter(a, q.trim(), kind, color));
    return sort === 'book'
      ? list.sort((a, b) => a.progress - b.progress || a.createdAt.localeCompare(b.createdAt))
      : list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [annotations, q, filter, sort]);

  const hereIndex = sort === 'book' ? filtered.findIndex((a) => a.progress > fraction) : -1;
  const here = (
    <div className="note-here" role="separator"><span>You are here · {formatPercent(fraction)}</span></div>
  );

  if (annotations.length === 0) {
    return <p className="muted pad">No notes yet. Select text to highlight it or press N to add a note.</p>;
  }

  let lastChapter: string | null | undefined;
  return (
    <div className="notes-tab">
      <div className="notes-controls">
        <input type="search" placeholder="Search notes" aria-label="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter notes" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All</option>
          <option value="notes">Notes</option>
          <option value="highlights">Highlights</option>
          {ANNOTATION_COLORS.map((c) => <option key={c} value={c}>{COLOR_LABEL[c]}</option>)}
        </select>
      </div>
      <div className="notes-list">
        {filtered.length === 0 && <p className="muted pad">Nothing matches.</p>}
        {filtered.map((a, i) => {
          const heading = sort === 'book' && a.chapter !== lastChapter ? (a.chapter ?? 'Untitled section') : null;
          if (sort === 'book') lastChapter = a.chapter;
          return (
            <Fragment key={a.id}>
              {hereIndex === i && here}
              {heading && <div className="note-chapter">{heading}</div>}
              <NoteItem a={a} onClick={() => onJump(a)} />
            </Fragment>
          );
        })}
        {sort === 'book' && filtered.length > 0 && hereIndex === -1 && here}
      </div>
      <div className="notes-foot">
        <button
          className="btn btn-quiet"
          onClick={() => downloadText(`${bookTitle} — notes.md`, bookNotesMarkdown(bookTitle, authors, [...annotations].sort((a, b) => a.progress - b.progress || a.createdAt.localeCompare(b.createdAt))))}
        >
          Export as Markdown
        </button>
        <button className="btn btn-quiet" onClick={() => setSort((s) => (s === 'book' ? 'recent' : 'book'))}>
          {sort === 'book' ? 'Book order' : 'Newest'}
        </button>
      </div>
    </div>
  );
}
