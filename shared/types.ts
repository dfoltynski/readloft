// Shared API contract between server and web. Keep this file dependency-free.
//
// REST API (all JSON unless noted, prefix /api):
//   GET    /api/books?q=&shelf=&status=&sort=      -> Book[]
//            q: search title/author/series; shelf: shelf id; status: BookStatus
//            sort: "added" (default, newest first) | "title" | "author" | "recent" (last opened)
//   GET    /api/books/:id                          -> Book
//   PATCH  /api/books/:id   body: BookPatch        -> Book  (status 'unread' also resets progress/location/lastOpenedAt)
//   DELETE /api/books/:id?file=1                   -> { ok: true }  (file=1 also deletes file on disk)
//   GET    /api/books/:id/file                     -> raw file bytes (correct Content-Type, supports Range)
//   GET    /api/books/:id/cover                    -> image bytes, 404 if none
//   PUT    /api/books/:id/cover  multipart "file"  -> Book   (custom cover upload)
//   PUT    /api/books/:id/progress body: ProgressUpdate -> Book
//   POST   /api/upload      multipart, one or more "files" fields -> { added: Book[], skipped: string[] }
//   POST   /api/scan                               -> ScanResult
//   GET    /api/shelves                            -> Shelf[] (manual shelves first, then folder shelves by path)
//   POST   /api/shelves     body: { name }         -> Shelf (always source 'manual')
//   PATCH  /api/shelves/:id body: { name }         -> Shelf   (409 for folder shelves)
//   DELETE /api/shelves/:id                        -> { ok: true }   (409 for folder shelves)
//   PUT    /api/shelves/:id/books/:bookId          -> { ok: true }   (409 for folder shelves)
//   DELETE /api/shelves/:id/books/:bookId          -> { ok: true }   (409 for folder shelves)
//   POST   /api/shelves/:id/books        body: { bookIds }  -> { added: number }   (409 for folder shelves)
//   POST   /api/shelves/:id/books/remove body: { bookIds }  -> { removed: number } (409 for folder shelves)
//   Folder shelves are created/synced automatically by every library scan from the directory
//   structure (a book is on its folder's shelf and every ancestor folder's shelf) and are read-only.
//   GET    /api/books/:id/bookmarks                -> Bookmark[] (sorted by progress)
//   POST   /api/books/:id/bookmarks body: { location, label, progress } -> Bookmark
//   PATCH  /api/bookmarks/:id body: { label }       -> Bookmark
//   DELETE /api/bookmarks/:id                      -> { ok: true }
//   GET    /api/stats                              -> LibraryStats
// Errors: non-2xx with { error: string }.

export const SUPPORTED_EXTENSIONS = [
  'epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'fbz', 'cbz',
] as const;
export type BookFormat = (typeof SUPPORTED_EXTENSIONS)[number];

export type BookStatus = 'unread' | 'reading' | 'finished';

export interface Book {
  id: string;            // stable: sha1 of path relative to library root, first 16 hex chars
  path: string;          // relative to library root
  format: BookFormat;
  title: string;
  authors: string[];
  series: string | null;
  seriesIndex: number | null;
  description: string | null;
  publisher: string | null;
  language: string | null;
  publishedAt: string | null; // free-form date string from metadata
  isbn: string | null;
  hasCover: boolean;
  fileSize: number;      // bytes
  addedAt: string;       // ISO
  updatedAt: string;     // ISO
  status: BookStatus;
  progress: number;      // 0..1
  location: string | null; // reader position (EPUB CFI or foliate-js location string)
  lastOpenedAt: string | null;
  shelfIds: string[];
}

export type BookPatch = Partial<Pick<Book,
  'title' | 'authors' | 'series' | 'seriesIndex' | 'description' |
  'publisher' | 'language' | 'publishedAt' | 'isbn' | 'status'>>;

export interface ProgressUpdate {
  progress: number;        // 0..1
  location: string | null;
}

export interface Bookmark {
  id: string;
  bookId: string;
  location: string;        // foliate CFI
  label: string;
  progress: number;        // 0..1
  createdAt: string;
}

export interface Shelf {
  id: string;
  name: string;
  bookCount: number;
  createdAt: string;
  /** 'manual' = user-created; 'folder' = auto-synced from the library directory structure (read-only). */
  source: 'manual' | 'folder';
  /** Library-relative directory path, '/'-separated (e.g. "Fiction/Sci-fi"). null for manual shelves. */
  folder: string | null;
}

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  durationMs: number;
}

export interface LibraryStats {
  total: number;
  reading: number;
  finished: number;
  unread: number;
  byFormat: Record<string, number>;
}

export interface ShelfBooksBody { bookIds: string[] }
