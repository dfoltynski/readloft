import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Book, BookStatus } from '@shared/types';
import { api, uploadFiles, type BookSort } from '../api';
import BookCard, { BOOKS_DRAG_TYPE } from '../components/BookCard';
import ContextMenu, { type MenuItem } from '../components/ContextMenu';
import Cover from '../components/Cover';
import DeleteBookDialog from '../components/DeleteBookDialog';
import { IconClose, IconGrid, IconList, IconMenu, IconSearch, IconUpload } from '../components/Icons';
import ShortcutsDialog from '../components/ShortcutsDialog';
import Sidebar from '../components/Sidebar';
import { useLibraryShortcuts, useSelectionShortcuts, useScrollRestore } from '../lib/libraryHooks';
import { ensurePdfCovers } from '../lib/pdfCover';
import { useToast } from '../components/Toast';
import UploadOverlay from '../components/UploadOverlay';
import { authorLine, formatPercent } from '../lib/format';
import { useAsync, useDebounced, useLocalStorage } from '../lib/hooks';

const SORTS: { value: BookSort; label: string }[] = [
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'recent', label: 'Recently read' },
];

/** "Added 3 books, skipped 1: file.txt" */
function uploadSummary(added: number, skipped: string[]): string {
  const addedText = `Added ${added} book${added === 1 ? '' : 's'}`;
  if (skipped.length === 0) return addedText;
  const shown = skipped.slice(0, 3).join(', ');
  const more = skipped.length > 3 ? ` and ${skipped.length - 3} more` : '';
  return `${addedText}, skipped ${skipped.length}: ${shown}${more}`;
}

const STATUSES: BookStatus[] = ['unread', 'reading', 'finished'];

export default function LibraryPage() {
  const { id: shelfId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const statusParam = params.get('status');
  const status = STATUSES.find((s) => s === statusParam);
  const [storedSort, setStoredSort] = useLocalStorage<BookSort>('readloft.sort', 'added');
  const findSort = (v: string | null) => SORTS.find((s) => s.value === v)?.value;
  const sort: BookSort = findSort(params.get('sort')) ?? findSort(storedSort) ?? 'added';
  const urlQuery = params.get('q') ?? '';

  const [search, setSearch] = useState(urlQuery);
  const debouncedSearch = useDebounced(search, 250);
  const [view, setView] = useLocalStorage<'grid' | 'list'>('readloft.view', 'grid');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState<{ book: Book; x: number; y: number } | null>(null);
  const [toDelete, setToDelete] = useState<Book | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [draggingIds, setDraggingIds] = useState<string[] | null>(null);
  const [shelfMenu, setShelfMenu] = useState<{ x: number; y: number } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Keep the URL's ?q= in sync with the debounced search box.
  useEffect(() => {
    if (debouncedSearch === urlQuery) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (debouncedSearch) next.set('q', debouncedSearch);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const books = useAsync(
    () => api.listBooks({ q: urlQuery, shelf: shelfId, status, sort }),
    [urlQuery, shelfId, status, sort],
  );
  const shelves = useAsync(() => api.listShelves(), []);
  const stats = useAsync(() => api.stats(), []);
  const reading = useAsync(() => api.listBooks({ status: 'reading', sort: 'recent' }), []);

  const reloadAll = useCallback(() => {
    books.reload();
    shelves.reload();
    stats.reload();
    reading.reload();
  }, [books.reload, shelves.reload, stats.reload, reading.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // PDFs get their cover rendered in the browser (server can't render PDFs).
  useEffect(() => {
    if (!books.data) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    ensurePdfCovers(books.data, () => {
      clearTimeout(timer);
      timer = setTimeout(() => { books.reload(); reading.reload(); }, 400);
    });
  }, [books.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const activeShelf = shelves.data?.find((s) => s.id === shelfId);
  const isAll = !shelfId && !status && !urlQuery;
  const continueReading = isAll ? (reading.data ?? []).slice(0, 10) : [];

  // The chosen sort is remembered in localStorage; an explicit ?sort= link still wins.
  const setSort = (value: BookSort) => {
    setStoredSort(value);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('sort');
      return next;
    });
  };

  // ---- Upload (drag & drop anywhere + button) ----
  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploadProgress(0);
      try {
        const r = await uploadFiles(files, setUploadProgress);
        toast(uploadSummary(r.added.length, r.skipped));
        reloadAll();
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setUploadProgress(null);
      }
    },
    [reloadAll, toast],
  );

  useEffect(() => {
    let depth = 0;
    // Chrome adds "Files" to image drags, so book drags are excluded explicitly.
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer?.types.includes('Files') && !e.dataTransfer.types.includes(BOOKS_DRAG_TYPE);
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void upload(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [upload]);

  // ---- Book actions ----
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reloadAll();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const menuItems = (book: Book): MenuItem[] => [
    { label: 'Read', onSelect: () => navigate(`/read/${book.id}`) },
    { label: 'Details', onSelect: () => navigate(`/book/${book.id}`) },
    {
      label: 'Add to shelf',
      separatorBefore: true,
      submenu: (shelves.data ?? []).map((s) => {
        const member = book.shelfIds.includes(s.id);
        return {
          label: s.name,
          checked: member,
          onSelect: () =>
            attempt(() => (member ? api.removeFromShelf(s.id, book.id) : api.addToShelf(s.id, book.id))),
        };
      }),
    },
    book.status === 'finished'
      ? { label: 'Mark unread', onSelect: () => attempt(() => api.patchBook(book.id, { status: 'unread' })) }
      : { label: 'Mark finished', onSelect: () => attempt(() => api.patchBook(book.id, { status: 'finished' })) },
    { label: 'Delete…', danger: true, separatorBefore: true, onSelect: () => setToDelete(book) },
  ];

  const title = useMemo(() => {
    if (shelfId) return activeShelf?.name ?? 'Shelf';
    if (status === 'reading') return 'Currently Reading';
    if (status === 'finished') return 'Finished';
    if (status === 'unread') return 'Unread';
    return 'All Books';
  }, [shelfId, activeShelf, status]);

  const list = books.data ?? [];

  // ---- Selection ----
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0 || !books.data) return prev;
      const ids = new Set(books.data.map((b) => b.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [books.data]);
  useEffect(() => {
    setSelected(new Set());
    setAnchor(null);
  }, [shelfId, status, urlQuery]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const selectAll = useCallback(() => setSelected(new Set(list.map((b) => b.id))), [list]);
  useSelectionShortcuts(selected.size > 0, clearSelection, selectAll);

  const onSelect = (book: Book, { shift, toggle }: { shift: boolean; toggle: boolean }) => {
    const from = anchor ? list.findIndex((b) => b.id === anchor) : -1;
    if (shift && from >= 0) {
      const to = list.findIndex((b) => b.id === book.id);
      const [a, z] = from < to ? [from, to] : [to, from];
      setSelected((prev) => new Set([...prev, ...list.slice(a, z + 1).map((b) => b.id)]));
    } else if (toggle || shift) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (!next.delete(book.id)) next.add(book.id);
        return next;
      });
      setAnchor(book.id);
    }
  };

  const getDragIds = (book: Book) => (selected.has(book.id) ? [...selected] : [book.id]);

  const reportAdded = (name: string, added: number) =>
    toast(added === 0 ? `Already on “${name}”` : `Added ${added} book${added === 1 ? '' : 's'} to “${name}”`);

  const addSelectedToShelf = async (shelfIdTo: string, name: string) => {
    const ids = [...selected];
    try {
      const r = await api.addBooksToShelf(shelfIdTo, ids);
      reportAdded(name, r.added);
      reloadAll();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const addSelectedToNewShelf = async () => {
    const name = window.prompt('New shelf name')?.trim();
    if (!name) return;
    try {
      const shelf = await api.createShelf(name);
      await addSelectedToShelf(shelf.id, shelf.name);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const removeSelectedFromShelf = async () => {
    if (!shelfId) return;
    const ids = [...selected];
    try {
      const r = await api.removeBooksFromShelf(shelfId, ids);
      toast(`Removed ${r.removed} book${r.removed === 1 ? '' : 's'} from “${activeShelf?.name ?? 'shelf'}”`);
      setSelected(new Set());
      reloadAll();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  useScrollRestore(contentRef, location.pathname + location.search, !books.loading);

  const openSearch = useCallback(() => searchInput.current?.focus(), []);
  const openUpload = useCallback(() => fileInput.current?.click(), []);
  const openHelp = useCallback(() => setShowShortcuts(true), []);
  useLibraryShortcuts({ onSearch: openSearch, onUpload: openUpload, onHelp: openHelp });

  const clearSearch = () => {
    setSearch('');
    searchInput.current?.blur();
  };
  const showEmptyLibrary = !books.loading && list.length === 0 && !urlQuery && !shelfId && !status;

  return (
    <div className="app-shell">
      <Sidebar
        shelves={shelves.data ?? []}
        stats={stats.data}
        activeShelfId={shelfId}
        activeStatus={status}
        open={drawerOpen}
        onClose={closeDrawer}
        onChanged={reloadAll}
      />

      <main className="main">
        <header className="toolbar">
          <button className="icon-btn menu-toggle" aria-label="Open sidebar" onClick={() => setDrawerOpen(true)}>
            <IconMenu />
          </button>
          <h1 className="page-title">
            {title}
            {!books.loading && <span className="page-count">{list.length} {list.length === 1 ? 'book' : 'books'}</span>}
          </h1>
          <div className="search">
            <IconSearch size={16} />
            <input
              ref={searchInput}
              type="search"
              placeholder="Search ( / )"
              aria-label="Search books"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') clearSearch();
              }}
            />
          </div>
          <select className="select" aria-label="Sort books" value={sort} onChange={(e) => setSort(e.target.value as BookSort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="View">
            <button
              className={view === 'grid' ? 'active' : ''}
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
            >
              <IconGrid size={16} />
            </button>
            <button
              className={view === 'list' ? 'active' : ''}
              aria-label="List view"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              <IconList size={16} />
            </button>
          </div>
          <label className="btn btn-primary upload-btn">
            <IconUpload size={16} /> <span>Upload</span>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept=".epub,.pdf,.mobi,.azw,.azw3,.fb2,.fbz,.cbz"
              onChange={(e) => {
                void upload(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        </header>

        <div className={`content${selected.size > 0 ? ' has-selection-bar' : ''}`} ref={contentRef}>
          {books.error && <div className="notice notice-error">Could not load books: {books.error.message}</div>}

          {continueReading.length > 0 && (
            <section aria-labelledby="continue-h" className="continue">
              <h2 id="continue-h" className="section-title">Continue reading</h2>
              <div className="continue-row">
                {continueReading.map((b) => (
                  <Link key={b.id} to={`/read/${b.id}`} className="continue-card" aria-label={`Continue reading ${b.title}`}>
                    <Cover book={b} />
                    <div className="cover-progress" aria-hidden="true">
                      <div style={{ width: formatPercent(b.progress) }} />
                    </div>
                    <div className="book-title">{b.title}</div>
                    <div className="book-author">{authorLine(b)}</div>
                  </Link>
                ))}
              </div>
              <h2 className="section-title">Library</h2>
            </section>
          )}

          {showEmptyLibrary ? (
            <div className="empty">
              <h2>Your library is empty</h2>
              <p>
                Drop ebook files anywhere on this page, use the Upload button, or mount a folder of books into the
                server's library directory and press “Rescan library”.
              </p>
            </div>
          ) : !books.loading && list.length === 0 ? (
            <div className="empty">
              {urlQuery ? (
                <>
                  <h2>No books match “{urlQuery}”</h2>
                  <p>Check the spelling or try a different search.</p>
                  <button className="btn" onClick={clearSearch}>Clear search</button>
                </>
              ) : (
                <>
                  <h2>Nothing here yet</h2>
                  <p>No books on this {shelfId ? 'shelf' : 'filter'} yet.</p>
                  {shelfId && <p>Add books from their context menu or details page.</p>}
                </>
              )}
            </div>
          ) : (
            <div className={view === 'grid' ? 'book-grid' : 'book-list'}>
              {list.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  view={view}
                  onMenu={(book, x, y) => setMenu({ book, x, y })}
                  selected={selected.has(b.id)}
                  selectionActive={selected.size > 0}
                  onSelect={onSelect}
                  getDragIds={getDragIds}
                  dragging={!!draggingIds?.includes(b.id)}
                  onDragChange={setDraggingIds}
                />
              ))}
            </div>
          )}
        </div>

        {selected.size > 0 && (
          <div className="selection-bar" role="toolbar" aria-label="Selection actions">
            <span className="selection-count">{selected.size} selected</span>
            <button
              className="btn"
              aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setShelfMenu({ x: r.left, y: r.top - 8 - 34 * ((shelves.data?.length ?? 0) + 1) });
              }}
            >
              Add to shelf
            </button>
            {shelfId && <button className="btn" onClick={removeSelectedFromShelf}>Remove from shelf</button>}
            <button className="btn btn-quiet" onClick={selectAll}>Select all</button>
            <button className="icon-btn" aria-label="Clear selection" onClick={clearSelection}>
              <IconClose size={16} />
            </button>
          </div>
        )}
      </main>

      {shelfMenu && (
        <ContextMenu
          x={shelfMenu.x}
          y={shelfMenu.y}
          onClose={() => setShelfMenu(null)}
          items={[
            ...(shelves.data ?? []).map((sh) => ({ label: sh.name, onSelect: () => addSelectedToShelf(sh.id, sh.name) })),
            { label: 'New shelf…', separatorBefore: (shelves.data ?? []).length > 0, onSelect: addSelectedToNewShelf },
          ]}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.book)} onClose={() => setMenu(null)} />}
      {toDelete && (
        <DeleteBookDialog
          book={toDelete}
          onCancel={() => setToDelete(null)}
          onConfirm={(deleteFile) => {
            const b = toDelete;
            setToDelete(null);
            void attempt(() => api.deleteBook(b.id, deleteFile));
          }}
        />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      <UploadOverlay dragging={dragging} progress={uploadProgress} />
    </div>
  );
}
