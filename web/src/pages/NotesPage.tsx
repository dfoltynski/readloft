import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AnnotationColor, AnnotationWithBook } from '@shared/types';
import { api } from '../api';
import Sidebar from '../components/Sidebar';
import { IconMenu, IconSearch } from '../components/Icons';
import { useToast } from '../components/Toast';
import {
  ANNOTATION_COLORS, COLOR_HEX, COLOR_LABEL, downloadText, libraryNotesMarkdown, shortDate, type AnnotationKindFilter,
} from '../lib/annotations';
import { formatPercent, generatedCoverBackground } from '../lib/format';
import { useAsync, useDebounced } from '../lib/hooks';
import { useOnSynced } from '../lib/sync';
import { useDesignSystem } from '../design/designSystem';
import StudioFrame from '../design/studio/Frame';

type Sort = 'recent' | 'book';

function MiniCover({ a }: { a: AnnotationWithBook }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="notes-cover" style={{ background: generatedCoverBackground(a.bookTitle) }}>
      {a.bookHasCover && !failed && (
        <img src={`/api/books/${a.bookId}/cover`} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

export default function NotesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const [kind, setKind] = useState<AnnotationKindFilter>('all');
  const [color, setColor] = useState<AnnotationColor | ''>('');
  const [sort, setSort] = useState<Sort>('recent');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const studio = useDesignSystem() === 'studio';

  const shelves = useAsync(() => api.listShelves(), []);
  const stats = useAsync(() => api.stats(), []);
  const notes = useAsync(
    () => api.searchAnnotations({ q: dq, color, kind: kind === 'all' ? '' : kind, sort }),
    [dq, color, kind, sort],
  );
  const total = useAsync(() => api.searchAnnotations(), []);

  useEffect(() => {
    document.title = 'Notes · Readloft';
    return () => { document.title = 'Readloft'; };
  }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const reload = () => { shelves.reload(); stats.reload(); notes.reload(); total.reload(); };
  useOnSynced(reload);

  const list = notes.data ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, AnnotationWithBook[]>();
    for (const a of list) {
      const g = m.get(a.bookId);
      if (g) g.push(a);
      else m.set(a.bookId, [a]);
    }
    return [...m.values()].map((g) => (sort === 'book' ? [...g].sort((x, y) => x.progress - y.progress) : g));
  }, [list, sort]);
  const totalByBook = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of total.data ?? []) m.set(a.bookId, (m.get(a.bookId) ?? 0) + 1);
    return m;
  }, [total.data]);

  const open = (a: AnnotationWithBook) =>
    navigate(`/read/${a.bookId}?cfi=${encodeURIComponent(a.cfi)}&ann=${a.id}`);

  const KINDS: [AnnotationKindFilter, string][] = [['all', 'All'], ['notes', 'With notes'], ['highlights', 'Highlights']];
  const everything = total.data?.length ?? 0;
  const booksCount = totalByBook.size;

  const content = (
    <>
    {notes.error && <div className="notice notice-error">Could not load notes: {notes.error.message}</div>}
    {!notes.loading && !notes.error && list.length === 0 && (
      <div className="empty">
        <h2>{everything === 0 ? 'No notes yet' : 'Nothing matches'}</h2>
        <p className="muted">
          {everything === 0
            ? 'Open a book, select some text and highlight it or press N to add a note.'
            : 'Try a different search or filter.'}
        </p>
      </div>
    )}
    {groups.map((g) => {
      const first = g[0];
      const all = totalByBook.get(first.bookId) ?? g.length;
      return (
        <section key={first.bookId} className="notes-group" aria-label={first.bookTitle}>
          <header className="notes-group-head">
            <MiniCover a={first} />
            <div className="notes-group-title">
              <Link to={`/book/${first.bookId}`} className="notes-book">{first.bookTitle}</Link>
              {first.bookAuthors.length > 0 && <span className="muted"> · {first.bookAuthors.join(', ')}</span>}
            </div>
            <Link to={`/read/${first.bookId}?panel=notes`} className="notes-all">All {all} →</Link>
          </header>
          <div className="notes-grid">
            {g.map((a) => (
              <button
                key={a.id}
                className="notes-card"
                style={{ ['--c' as string]: COLOR_HEX[a.color] } as CSSProperties}
                onClick={() => open(a)}
              >
                <span className="note-bar" aria-hidden="true" />
                <span className="note-body">
                  {a.chapter && <span className="note-chapter-tag">{a.chapter}</span>}
                  <span className="note-quote">{a.text}</span>
                  {a.note && <span className="note-text">{a.note}</span>}
                  <span className="note-meta">{formatPercent(a.progress)} · {a.note ? shortDate(a.updatedAt) : 'highlight'}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      );
    })}
    </>
  );

  const exportMd = () => {
    downloadText('Readloft notes.md', libraryNotesMarkdown(list));
    toast(`Exported ${list.length} ${list.length === 1 ? 'note' : 'notes'}`);
  };

  if (studio) {
    return (
      <StudioFrame
        active="notes"
        search={{ value: q, onChange: setQ, placeholder: 'Search notes' }}
        onChanged={reload}
        onMenu={() => setDrawerOpen(true)}
        refreshKey={total.data}
        sidebar={
          <Sidebar
            shelves={shelves.data ?? []}
            stats={stats.data}
            activeNotes
            open={drawerOpen}
            onClose={closeDrawer}
            onChanged={reload}
          />
        }
        statusLeft={`${everything} ${everything === 1 ? 'note or highlight' : 'notes and highlights'} · ${booksCount} ${booksCount === 1 ? 'book' : 'books'}`}
        hints={[['/', 'search'], ['?', 'shortcuts']]}
      >
        <main className="st-main">
          <div className="st-head">
            <h1>Notes</h1>
            {total.data && (
              <span className="st-sub">
                {everything} {everything === 1 ? 'note or highlight' : 'notes and highlights'} in {booksCount} {booksCount === 1 ? 'book' : 'books'}
              </span>
            )}
            <div className="st-pills">
              {KINDS.map(([k, label]) => (
                <button key={k} className={`st-pill${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
              ))}
              <span className="st-swatches" role="group" aria-label="Color">
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`st-swatch${color === c ? ' on' : ''}`}
                    style={{ ['--c' as string]: COLOR_HEX[c] } as CSSProperties}
                    aria-label={`${COLOR_LABEL[c]} only`}
                    aria-pressed={color === c}
                    onClick={() => setColor(color === c ? '' : c)}
                  />
                ))}
              </span>
              <select className="st-pill st-select" aria-label="Sort notes" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="recent">Recent first</option>
                <option value="book">By book</option>
              </select>
              <button className="st-btn primary" style={{ height: 32 }} disabled={list.length === 0} onClick={exportMd}>Export Markdown</button>
            </div>
          </div>
          {content}
        </main>
      </StudioFrame>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        shelves={shelves.data ?? []}
        stats={stats.data}
        activeNotes
        open={drawerOpen}
        onClose={closeDrawer}
        onChanged={reload}
      />
      <main className="main">
        <header className="toolbar">
          <button className="icon-btn menu-toggle" aria-label="Open sidebar" onClick={() => setDrawerOpen(true)}>
            <IconMenu />
          </button>
          <div className="notes-title">
            <h1 className="page-title">Notes</h1>
            {total.data && (
              <p className="muted small">
                {everything} {everything === 1 ? 'note or highlight' : 'notes and highlights'} in {booksCount} {booksCount === 1 ? 'book' : 'books'}
              </p>
            )}
          </div>
          <button
            className="btn"
            disabled={list.length === 0}
            onClick={() => {
              downloadText('Readloft notes.md', libraryNotesMarkdown(list));
              toast(`Exported ${list.length} ${list.length === 1 ? 'note' : 'notes'}`);
            }}
          >
            Export Markdown
          </button>
        </header>
        <div className="toolbar notes-filters">
          <div className="search">
            <IconSearch size={16} />
            <input
              type="search"
              placeholder="Search notes"
              aria-label="Search notes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="segmented" role="group" aria-label="Kind">
            {KINDS.map(([k, label]) => (
              <button key={k} className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
          <div className="notes-colors" role="group" aria-label="Color">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                className={`ann-dot${color === c ? ' active' : ''}`}
                style={{ ['--c' as string]: COLOR_HEX[c] } as CSSProperties}
                aria-label={`${COLOR_LABEL[c]} only`}
                aria-pressed={color === c}
                onClick={() => setColor(color === c ? '' : c)}
              />
            ))}
          </div>
          <select className="select" aria-label="Sort notes" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">Recent first</option>
            <option value="book">By book</option>
          </select>
        </div>

        <div className="content">
          {content}
        </div>
      </main>
    </div>
  );
}
