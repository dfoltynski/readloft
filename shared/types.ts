// SPDX-License-Identifier: AGPL-3.0-only
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
//   GET    /api/books/:id/annotations              -> Annotation[] (sorted by progress)
//   POST   /api/books/:id/annotations body: { cfi, text, note?, color?, progress, chapter?, id? } -> Annotation
//            (optional id lets the client restore a deleted annotation under the same id; must be a UUID)
//   PATCH  /api/annotations/:id body: { note?, color? } -> Annotation
//   DELETE /api/annotations/:id                    -> { ok: true }
//   GET    /api/annotations?q=&color=&kind=all|notes|highlights&sort=recent|book -> AnnotationWithBook[]
//            q matches text or note (case-insensitive); sort: recent (updated desc, default) | book (title, progress)
//   GET    /api/stats                              -> LibraryStats
//   GET    /api/sync                               -> SyncStatus (cross-device sync via per-device JSON files in <library>/.libristead/sync)
//   POST   /api/sync                               -> SyncStatus ("sync now": writes this device's file, merges the others' immediately; no-op when sync is disabled)
//   Authentication (server env AUTH=password|proxy|none; every /api route except the three public ones below requires it):
//   GET    /api/auth/status                        -> AuthStatus (public)
//   POST   /api/auth/setup    body: { code, password } -> { ok: true } (public; first run only: code is printed in the server log; sets the session cookie; password min 10 chars)
//   POST   /api/auth/login    body: { password }   -> { ok: true } (public; sets the session cookie; 429 + Retry-After after repeated failures)
//   POST   /api/auth/logout                        -> { ok: true }
//   POST   /api/auth/password body: { current, next } -> { ok: true } (revokes all other sessions)
//   GET    /api/auth/tokens                        -> ApiToken[] (session only)
//   POST   /api/auth/tokens   body: { name }       -> CreatedApiToken (session only; plaintext token shown once)
//   DELETE /api/auth/tokens/:id                    -> { ok: true } (session only)
//   Browser requests authenticated by cookie must send header "X-Requested-With: libristead" on POST/PUT/PATCH/DELETE.
//   Scripts/OPDS/KOReader: "Authorization: Bearer lst_..." or HTTP Basic with any username and the token as password.
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

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface Annotation {
  id: string;
  bookId: string;
  cfi: string;             // foliate CFI (EPUB) or the reader's location string (PDF fallback)
  text: string;            // quoted passage
  note: string;            // '' = highlight only
  color: AnnotationColor;
  progress: number;        // 0..1
  chapter: string | null;  // TOC label at creation
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationWithBook extends Annotation {
  bookTitle: string;
  bookAuthors: string[];
  bookHasCover: boolean;
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

export interface SyncDevice {
  id: string;
  name: string;
  writtenAt: string;       // ISO, when that device last wrote its state file
}

export interface SyncStatus {
  enabled: boolean;        // false when SYNC=0
  dir: string | null;      // directory holding the per-device state files
  deviceId: string | null;
  deviceName: string | null;
  lastMergeAt: string | null; // ISO, last completed check/merge of other devices' files
  lastWriteAt: string | null; // ISO, last time this device wrote its own file
  devices: SyncDevice[];   // other devices seen
  error?: string;
}

export interface ShelfBooksBody { bookIds: string[] }

/**
 * Whether a book's file is local or offloaded to cloud storage (iCloud Drive etc.).
 * GET  /api/books/:id/availability -> BookAvailability (404 unknown book)
 * POST /api/books/:id/download     -> BookAvailability; starts the cloud download if offloaded
 */
export interface BookAvailability {
  offloaded: boolean;        // file is a cloud placeholder, not on disk yet
  downloading: boolean;      // a download we started is in flight and still not finished
  percent: number | null;    // 0..100 when known (iCloud only), else null
  provider: string | null;   // e.g. 'iCloud Drive', 'Dropbox'; null for plain local paths
  size: number;              // bytes (from the index)
}

export type AuthMode = 'password' | 'proxy' | 'none';

export interface AuthStatus {
  mode: AuthMode;
  /** password mode only: no password set yet, the setup code from the server log is needed. */
  setupRequired: boolean;
  authenticated: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedApiToken extends ApiToken {
  /** Plaintext token, returned only once. */
  token: string;
}
