// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Annotation, AnnotationColor, AnnotationWithBook } from '../../../shared/types.ts';
import { db } from '../db.ts';
import { HttpError } from './books.ts';
import { addTombstone, clearTombstone, markDirty } from '../sync.ts';

interface AnnotationRow {
  id: string; book_id: string; cfi: string; text: string; note: string; color: string;
  progress: number; chapter: string | null; created_at: string; updated_at: string;
}
interface AnnotationJoinRow extends AnnotationRow { title: string; authors: string; has_cover: number }

const COLORS: readonly string[] = ['yellow', 'green', 'blue', 'pink'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toAnnotation = (r: AnnotationRow): Annotation => ({
  id: r.id, bookId: r.book_id, cfi: r.cfi, text: r.text, note: r.note, color: r.color as AnnotationColor,
  progress: r.progress, chapter: r.chapter, createdAt: r.created_at, updatedAt: r.updated_at,
});

function parseAuthors(s: string): string[] {
  try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(String); } catch { /* ignore */ }
  return [];
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch { /* fallthrough */ }
  throw new HttpError(400, 'invalid JSON body');
}

export const annotations = new Hono();

annotations.get('/books/:id/annotations', (c) => {
  const rows = db.prepare('SELECT * FROM annotations WHERE book_id = ? ORDER BY progress, created_at')
    .all(c.req.param('id')) as unknown as AnnotationRow[];
  return c.json(rows.map(toAnnotation));
});

annotations.get('/annotations', (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const color = c.req.query('color') ?? '';
  const kind = c.req.query('kind') ?? 'all';
  const sort = c.req.query('sort') ?? 'recent';
  if (color && !COLORS.includes(color)) throw new HttpError(400, 'invalid color');
  if (!['all', 'notes', 'highlights'].includes(kind)) throw new HttpError(400, 'invalid kind');
  if (!['recent', 'book'].includes(sort)) throw new HttpError(400, 'invalid sort');
  const where: string[] = [];
  const args: string[] = [];
  if (q) {
    where.push("(instr(lower(a.text), ?) > 0 OR instr(lower(a.note), ?) > 0)");
    args.push(q, q);
  }
  if (color) { where.push('a.color = ?'); args.push(color); }
  if (kind === 'notes') where.push("a.note != ''");
  else if (kind === 'highlights') where.push("a.note = ''");
  const order = sort === 'book' ? 'b.title COLLATE NOCASE, b.id, a.progress, a.created_at' : 'a.updated_at DESC';
  const rows = db.prepare(`SELECT a.*, b.title, b.authors, b.has_cover FROM annotations a JOIN books b ON b.id = a.book_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`).all(...args) as unknown as AnnotationJoinRow[];
  const out: AnnotationWithBook[] = rows.map((r) => ({
    ...toAnnotation(r), bookTitle: r.title, bookAuthors: parseAuthors(r.authors), bookHasCover: !!r.has_cover,
  }));
  return c.json(out);
});

annotations.post('/books/:id/annotations', async (c) => {
  const bookId = c.req.param('id');
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) throw new HttpError(404, 'book not found');
  const body = await readBody(c);
  const { cfi, text, note, color, progress, chapter, id: bodyId } = body;
  if (typeof cfi !== 'string' || !cfi) throw new HttpError(400, 'cfi is required');
  if (typeof text !== 'string') throw new HttpError(400, 'text must be a string');
  if (typeof progress !== 'number' || !Number.isFinite(progress)) throw new HttpError(400, 'progress must be a number');
  if (note !== undefined && typeof note !== 'string') throw new HttpError(400, 'note must be a string');
  if (color !== undefined && (typeof color !== 'string' || !COLORS.includes(color))) throw new HttpError(400, 'invalid color');
  if (chapter !== undefined && chapter !== null && typeof chapter !== 'string') throw new HttpError(400, 'chapter must be a string');
  if (bodyId !== undefined && (typeof bodyId !== 'string' || !UUID_RE.test(bodyId))) throw new HttpError(400, 'invalid id');
  const id = typeof bodyId === 'string' ? bodyId : randomUUID();
  if (db.prepare('SELECT 1 FROM annotations WHERE id = ?').get(id)) throw new HttpError(409, 'annotation id already exists');
  const now = new Date().toISOString();
  const row: AnnotationRow = {
    id, book_id: bookId, cfi, text: text.slice(0, 5000), note: (note ?? '').trim().slice(0, 10000),
    color: color ?? 'yellow', progress: Math.min(1, Math.max(0, progress)),
    chapter: typeof chapter === 'string' && chapter.trim() ? chapter.trim().slice(0, 300) : null,
    created_at: now, updated_at: now,
  };
  db.prepare(`INSERT INTO annotations (id, book_id, cfi, text, note, color, progress, chapter, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.book_id, row.cfi, row.text, row.note, row.color, row.progress, row.chapter, row.created_at, row.updated_at);
  clearTombstone('annotation', id); // restoring a deleted annotation (undo)
  markDirty();
  return c.json(toAnnotation(row), 201);
});

annotations.patch('/annotations/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readBody(c);
  const { note, color } = body;
  if (note === undefined && color === undefined) throw new HttpError(400, 'note or color required');
  if (note !== undefined && typeof note !== 'string') throw new HttpError(400, 'note must be a string');
  if (color !== undefined && (typeof color !== 'string' || !COLORS.includes(color))) throw new HttpError(400, 'invalid color');
  const cur = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as unknown as AnnotationRow | undefined;
  if (!cur) throw new HttpError(404, 'annotation not found');
  const nextNote = typeof note === 'string' ? note.trim().slice(0, 10000) : cur.note;
  const nextColor = typeof color === 'string' ? color : cur.color;
  db.prepare('UPDATE annotations SET note = ?, color = ?, updated_at = ? WHERE id = ?')
    .run(nextNote, nextColor, new Date().toISOString(), id);
  markDirty();
  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as unknown as AnnotationRow;
  return c.json(toAnnotation(row));
});

annotations.delete('/annotations/:id', (c) => {
  const id = c.req.param('id');
  const res = db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
  if (!res.changes) throw new HttpError(404, 'annotation not found');
  addTombstone('annotation', id);
  return c.json({ ok: true });
});
