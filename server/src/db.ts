import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Book, BookFormat, BookStatus } from '../../shared/types.ts';
import { DATA_DIR } from './config.ts';

const MIGRATIONS: string[] = [
  `CREATE TABLE books (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    series TEXT,
    series_index REAL,
    description TEXT,
    publisher TEXT,
    language TEXT,
    published_at TEXT,
    isbn TEXT,
    has_cover INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,
    mtime_ms INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread',
    progress REAL NOT NULL DEFAULT 0,
    location TEXT,
    last_opened_at TEXT,
    metadata_locked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_books_title ON books(title);
  CREATE INDEX idx_books_added ON books(added_at);
  CREATE TABLE shelves (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE shelf_books (
    shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (shelf_id, book_id)
  );`,
  `CREATE TABLE bookmarks (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    location TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_bookmarks_book ON bookmarks(book_id, progress);`,
];

fs.mkdirSync(DATA_DIR, { recursive: true });
// One-time migration from the project's former name (Bookread).
const dbPath = path.join(DATA_DIR, 'readloft.db');
const legacyDbPath = path.join(DATA_DIR, 'bookread.db');
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(legacyDbPath + suffix)) fs.renameSync(legacyDbPath + suffix, dbPath + suffix);
  }
}
export const db = new DatabaseSync(dbPath);

export function migrate(): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let v = row.user_version;
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v++;
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export interface BookRow {
  id: string; path: string; format: string; title: string; authors: string;
  series: string | null; series_index: number | null; description: string | null;
  publisher: string | null; language: string | null; published_at: string | null;
  isbn: string | null; has_cover: number; file_size: number; mtime_ms: number;
  added_at: string; updated_at: string; status: string; progress: number;
  location: string | null; last_opened_at: string | null; metadata_locked: number;
}

export function rowToBook(r: BookRow, shelfIds: string[] = []): Book {
  let authors: string[] = [];
  try { const a = JSON.parse(r.authors); if (Array.isArray(a)) authors = a.map(String); } catch { /* ignore */ }
  return {
    id: r.id, path: r.path, format: r.format as BookFormat, title: r.title, authors,
    series: r.series, seriesIndex: r.series_index, description: r.description,
    publisher: r.publisher, language: r.language, publishedAt: r.published_at, isbn: r.isbn,
    hasCover: !!r.has_cover, fileSize: r.file_size, addedAt: r.added_at, updatedAt: r.updated_at,
    status: r.status as BookStatus, progress: r.progress, location: r.location,
    lastOpenedAt: r.last_opened_at, shelfIds,
  };
}

export function getBookRow(id: string): BookRow | undefined {
  return db.prepare('SELECT * FROM books WHERE id = ?').get(id) as unknown as BookRow | undefined;
}

export function shelfIdsFor(ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  // chunk to stay under SQLite variable limit
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db.prepare(
      `SELECT book_id, shelf_id FROM shelf_books WHERE book_id IN (${chunk.map(() => '?').join(',')})`,
    ).all(...chunk) as unknown as { book_id: string; shelf_id: string }[];
    for (const r of rows) {
      const l = map.get(r.book_id) ?? [];
      l.push(r.shelf_id);
      map.set(r.book_id, l);
    }
  }
  return map;
}

export function getBook(id: string): Book | null {
  const r = getBookRow(id);
  if (!r) return null;
  return rowToBook(r, shelfIdsFor([id]).get(id) ?? []);
}
