import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Shelf, ShelfBooksBody } from '../../../shared/types.ts';
import { db } from '../db.ts';
import { HttpError } from './books.ts';

interface ShelfRow { id: string; name: string; created_at: string; book_count: number }

const toShelf = (r: ShelfRow): Shelf => ({ id: r.id, name: r.name, bookCount: r.book_count, createdAt: r.created_at });

function getShelf(id: string): Shelf | null {
  const r = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = s.id) AS book_count
    FROM shelves s WHERE s.id = ?`).get(id) as unknown as ShelfRow | undefined;
  return r ? toShelf(r) : null;
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
    FROM shelves s ORDER BY s.name COLLATE NOCASE`).all() as unknown as ShelfRow[];
  return c.json(rows.map(toShelf));
});

shelves.post('/shelves', async (c) => {
  const name = await readName(c);
  const id = randomUUID();
  db.prepare('INSERT INTO shelves (id, name, created_at) VALUES (?,?,?)').run(id, name, new Date().toISOString());
  return c.json(getShelf(id), 201);
});

shelves.patch('/shelves/:id', async (c) => {
  const id = c.req.param('id');
  if (!getShelf(id)) throw new HttpError(404, 'shelf not found');
  const name = await readName(c);
  db.prepare('UPDATE shelves SET name = ? WHERE id = ?').run(name, id);
  return c.json(getShelf(id));
});

shelves.delete('/shelves/:id', (c) => {
  const id = c.req.param('id');
  if (!getShelf(id)) throw new HttpError(404, 'shelf not found');
  db.prepare('DELETE FROM shelves WHERE id = ?').run(id);
  return c.json({ ok: true });
});

shelves.put('/shelves/:id/books/:bookId', (c) => {
  const { id, bookId } = c.req.param();
  if (!getShelf(id)) throw new HttpError(404, 'shelf not found');
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) throw new HttpError(404, 'book not found');
  db.prepare('INSERT OR IGNORE INTO shelf_books (shelf_id, book_id, added_at) VALUES (?,?,?)')
    .run(id, bookId, new Date().toISOString());
  return c.json({ ok: true });
});

shelves.delete('/shelves/:id/books/:bookId', (c) => {
  const { id, bookId } = c.req.param();
  if (!getShelf(id)) throw new HttpError(404, 'shelf not found');
  db.prepare('DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?').run(id, bookId);
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

function bulk(shelfId: string, ids: string[], sql: string, params: (bookId: string) => (string | number)[]): number {
  let changed = 0;
  const stmt = db.prepare(sql);
  const exists = db.prepare('SELECT 1 FROM books WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const bookId of new Set(ids)) {
      if (!exists.get(bookId)) continue;
      changed += Number(stmt.run(...params(bookId)).changes);
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
  if (!getShelf(id)) throw new HttpError(404, 'shelf not found');
  const ids = await readBookIds(c);
  const now = new Date().toISOString();
  const added = bulk(id, ids, 'INSERT OR IGNORE INTO shelf_books (shelf_id, book_id, added_at) VALUES (?,?,?)', (b) => [id, b, now]);
  return c.json({ added });
});

shelves.post('/shelves/:id/books/remove', async (c) => {
  const id = c.req.param('id');
  if (!getShelf(id)) throw new HttpError(404, 'shelf not found');
  const ids = await readBookIds(c);
  const removed = bulk(id, ids, 'DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?', (b) => [id, b]);
  return c.json({ removed });
});
