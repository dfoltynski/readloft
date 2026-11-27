// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Shelf, ShelfBooksBody } from '../../../shared/types.ts';
import { db } from '../db.ts';
import { HttpError } from './books.ts';
import { addTombstone, clearTombstone, markDirty, shelfBookKey, tombstoneShelf } from '../sync.ts';

interface ShelfRow { id: string; name: string; created_at: string; folder: string | null; book_count: number }

const toShelf = (r: ShelfRow): Shelf => ({ id: r.id, name: r.name, bookCount: r.book_count, createdAt: r.created_at,
  source: r.folder === null ? 'manual' : 'folder', folder: r.folder });

function getShelf(id: string): Shelf | null {
  const r = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = s.id) AS book_count
    FROM shelves s WHERE s.id = ?`).get(id) as unknown as ShelfRow | undefined;
  return r ? toShelf(r) : null;
}

function assertManual(id: string): Shelf {
  const s = getShelf(id);
  if (!s) throw new HttpError(404, 'shelf not found');
  if (s.source === 'folder') {
    throw new HttpError(409, 'Folder shelves are managed automatically from the library folder structure and cannot be changed');
  }
  return s;
}

async function readName(c: { req: { json: () => Promise<unknown> } }): Promise<string> {
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new HttpError(400, 'invalid JSON body'); }
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name is required');
  return name.trim().slice(0, 200);
}

export const shelves = new Hono();

shelves.get('/shelves', (c) => {
  const rows = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = s.id) AS book_count
    FROM shelves s ORDER BY (s.folder IS NOT NULL), CASE WHEN s.folder IS NULL THEN s.name END COLLATE NOCASE,
    s.folder COLLATE NOCASE`).all() as unknown as ShelfRow[];
  return c.json(rows.map(toShelf));
});

shelves.post('/shelves', async (c) => {
  const name = await readName(c);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO shelves (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(id, name, now, now);
  markDirty();
  return c.json(getShelf(id), 201);
});

shelves.patch('/shelves/:id', async (c) => {
  const id = c.req.param('id');
  assertManual(id);
  const name = await readName(c);
  db.prepare('UPDATE shelves SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), id);
  markDirty();
  return c.json(getShelf(id));
});

shelves.delete('/shelves/:id', (c) => {
  const id = c.req.param('id');
  assertManual(id);
  tombstoneShelf(id);
  db.prepare('DELETE FROM shelves WHERE id = ?').run(id);
  return c.json({ ok: true });
});

shelves.put('/shelves/:id/books/:bookId', (c) => {
  const { id, bookId } = c.req.param();
  assertManual(id);
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) throw new HttpError(404, 'book not found');
  const now = new Date().toISOString();
  const r = db.prepare('INSERT OR IGNORE INTO shelf_books (shelf_id, book_id, added_at, updated_at) VALUES (?,?,?,?)')
    .run(id, bookId, now, now);
  if (r.changes) { const k = shelfBookKey(id, bookId); if (k) clearTombstone('shelfBook', k); }
  return c.json({ ok: true });
});

shelves.delete('/shelves/:id/books/:bookId', (c) => {
  const { id, bookId } = c.req.param();
  assertManual(id);
  const k = shelfBookKey(id, bookId);
  const r = db.prepare('DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?').run(id, bookId);
  if (r.changes && k) addTombstone('shelfBook', k);
  return c.json({ ok: true });
});

async function readBookIds(c: { req: { json: () => Promise<unknown> } }): Promise<string[]> {
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new HttpError(400, 'invalid JSON body'); }
  const ids = (body as Partial<ShelfBooksBody> | null)?.bookIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000 || !ids.every((i) => typeof i === 'string')) {
    throw new HttpError(400, 'bookIds must be a non-empty array of strings (max 5000)');
  }
  return ids;
}

function bulk(ids: string[], sql: string, params: (bookId: string) => (string | number)[], onChange: (bookId: string) => void): number {
  let changed = 0;
  const stmt = db.prepare(sql);
  const exists = db.prepare('SELECT 1 FROM books WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const bookId of new Set(ids)) {
      if (!exists.get(bookId)) continue;
      const n = Number(stmt.run(...params(bookId)).changes);
      if (n) onChange(bookId);
      changed += n;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return changed;
}

shelves.post('/shelves/:id/books', async (c) => {
  const id = c.req.param('id');
  assertManual(id);
  const ids = await readBookIds(c);
  const now = new Date().toISOString();
  const added = bulk(ids, 'INSERT OR IGNORE INTO shelf_books (shelf_id, book_id, added_at, updated_at) VALUES (?,?,?,?)', (b) => [id, b, now, now],
    (b) => { const k = shelfBookKey(id, b); if (k) clearTombstone('shelfBook', k); });
  return c.json({ added });
});

shelves.post('/shelves/:id/books/remove', async (c) => {
  const id = c.req.param('id');
  assertManual(id);
  const ids = await readBookIds(c);
  const removed = bulk(ids, 'DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?', (b) => [id, b],
    (b) => { const k = shelfBookKey(id, b); if (k) addTombstone('shelfBook', k); });
  return c.json({ removed });
});
