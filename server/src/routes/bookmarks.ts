import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Bookmark } from '../../../shared/types.ts';
import { db } from '../db.ts';
import { HttpError } from './books.ts';

interface BookmarkRow { id: string; book_id: string; location: string; label: string; progress: number; created_at: string }

const toBookmark = (r: BookmarkRow): Bookmark => ({
  id: r.id, bookId: r.book_id, location: r.location, label: r.label, progress: r.progress, createdAt: r.created_at,
});

export const bookmarks = new Hono();

bookmarks.get('/books/:id/bookmarks', (c) => {
  const rows = db.prepare('SELECT * FROM bookmarks WHERE book_id = ? ORDER BY progress, created_at')
    .all(c.req.param('id')) as unknown as BookmarkRow[];
  return c.json(rows.map(toBookmark));
});

bookmarks.post('/books/:id/bookmarks', async (c) => {
  const bookId = c.req.param('id');
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) throw new HttpError(404, 'book not found');
  let body: { location?: unknown; label?: unknown; progress?: unknown } | null;
  try { body = (await c.req.json()) as typeof body; } catch { throw new HttpError(400, 'invalid JSON body'); }
  const { location, label, progress } = body ?? {};
  if (typeof location !== 'string' || !location) throw new HttpError(400, 'location is required');
  if (typeof progress !== 'number' || !Number.isFinite(progress)) throw new HttpError(400, 'progress must be a number');
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const cleanLabel = typeof label === 'string' ? label.trim().slice(0, 300) : '';
  const clamped = Math.min(1, Math.max(0, progress));
  db.prepare('INSERT INTO bookmarks (id, book_id, location, label, progress, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, bookId, location, cleanLabel, clamped, createdAt);
  return c.json(toBookmark({ id, book_id: bookId, location, label: cleanLabel, progress: clamped, created_at: createdAt }), 201);
});

bookmarks.patch('/bookmarks/:id', async (c) => {
  const id = c.req.param('id');
  let body: { label?: unknown } | null;
  try { body = (await c.req.json()) as typeof body; } catch { throw new HttpError(400, 'invalid JSON body'); }
  if (typeof body?.label !== 'string') throw new HttpError(400, 'label must be a string');
  const label = body.label.trim().slice(0, 300);
  if (!label) throw new HttpError(400, 'label must not be empty');
  const res = db.prepare('UPDATE bookmarks SET label = ? WHERE id = ?').run(label, id);
  if (!res.changes) throw new HttpError(404, 'bookmark not found');
  const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as unknown as BookmarkRow;
  return c.json(toBookmark(row));
});

bookmarks.delete('/bookmarks/:id', (c) => {
  const res = db.prepare('DELETE FROM bookmarks WHERE id = ?').run(c.req.param('id'));
  if (!res.changes) throw new HttpError(404, 'bookmark not found');
  return c.json({ ok: true });
});
