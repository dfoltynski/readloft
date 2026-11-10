import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Book, BookPatch, BookStatus, ProgressUpdate } from '../../../shared/types.ts';
import { db, getBook, getBookRow, rowToBook, shelfIdsFor, type BookRow } from '../db.ts';
import { LIBRARY_DIR, UPLOADS_DIR, safeLibraryPath } from '../config.ts';
import { findCover, removeCover, saveCover } from '../covers.ts';
import { detectImageExt } from '../metadata/util.ts';
import { formatOf, indexFile, scanLibrary } from '../scanner.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/x-mobipocket-ebook',
  azw3: 'application/x-mobipocket-ebook',
  fb2: 'application/x-fictionbook+xml',
  fbz: 'application/x-zip-compressed-fb2',
  cbz: 'application/vnd.comicbook+zip',
};
const STATUSES = ['unread', 'reading', 'finished'];

function escLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

function sanitizeFileName(name: string): string {
  let base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  base = base.replace(/[\x00-\x1f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return base || 'book';
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const lower = name.toLowerCase();
  const ext = lower.endsWith('.fb2.zip') ? name.slice(-8) : path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 1; ; i++) {
    try { await fsp.access(candidate); } catch { return candidate; }
    candidate = path.join(dir, `${stem} (${i})${ext}`);
  }
}

export const books = new Hono();

books.get('/books', (c) => {
  const { q, shelf, status, sort } = c.req.query();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q && q.trim()) {
    const like = `%${escLike(q.trim())}%`;
    where.push(`(b.title LIKE ? ESCAPE '\\' OR b.authors LIKE ? ESCAPE '\\' OR b.series LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  if (shelf) {
    where.push('b.id IN (SELECT book_id FROM shelf_books WHERE shelf_id = ?)');
    params.push(shelf);
  }
  if (status) {
    if (!STATUSES.includes(status)) throw new HttpError(400, 'invalid status');
    where.push('b.status = ?');
    params.push(status);
  }
  const order = sort === 'title' ? 'b.title COLLATE NOCASE ASC'
    : sort === 'author' ? 'b.authors COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC'
    : sort === 'recent' ? 'b.last_opened_at DESC NULLS LAST, b.title COLLATE NOCASE ASC'
    : 'b.added_at DESC, b.title COLLATE NOCASE ASC';
  const sql = `SELECT b.* FROM books b ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  const rows = db.prepare(sql).all(...params) as unknown as BookRow[];
  const shelves = shelfIdsFor(rows.map((r) => r.id));
  return c.json(rows.map((r) => rowToBook(r, shelves.get(r.id) ?? [])));
});

books.get('/books/:id', (c) => {
  const b = getBook(c.req.param('id'));
  if (!b) throw new HttpError(404, 'book not found');
  return c.json(b);
});

function optStr(v: unknown, field: string): string | null {
  if (v === null) return null;
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be a string or null`);
  return v.trim() || null;
}

books.patch('/books/:id', async (c) => {
  const id = c.req.param('id');
  const row = getBookRow(id);
  if (!row) throw new HttpError(404, 'book not found');
  let body: BookPatch;
  try { body = await c.req.json(); } catch { throw new HttpError(400, 'invalid JSON body'); }
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'invalid body');
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  let metaChanged = false;
  const set = (col: string, v: string | number | null) => { sets.push(`${col} = ?`); params.push(v); };
  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) throw new HttpError(400, 'title must be a non-empty string');
    set('title', body.title.trim()); metaChanged = true;
  }
  if ('authors' in body) {
    if (!Array.isArray(body.authors) || body.authors.some((a) => typeof a !== 'string')) throw new HttpError(400, 'authors must be string[]');
    set('authors', JSON.stringify(body.authors.map((a) => a.trim()).filter(Boolean))); metaChanged = true;
  }
  if ('seriesIndex' in body) {
    const v = body.seriesIndex;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) throw new HttpError(400, 'seriesIndex must be a number or null');
    set('series_index', v ?? null); metaChanged = true;
  }
  const strCols: [keyof BookPatch, string][] = [
    ['series', 'series'], ['description', 'description'], ['publisher', 'publisher'],
    ['language', 'language'], ['publishedAt', 'published_at'], ['isbn', 'isbn'],
  ];
  for (const [k, col] of strCols) {
    if (k in body) { set(col, optStr(body[k], k)); metaChanged = true; }
  }
  if ('status' in body) {
    const s = body.status as BookStatus;
    if (!STATUSES.includes(s)) throw new HttpError(400, 'invalid status');
    set('status', s);
    if (s === 'finished') set('progress', 1);
    else if (s === 'unread') set('progress', 0);
  }
  if (metaChanged) set('metadata_locked', 1);
  if (sets.length) {
    set('updated_at', new Date().toISOString());
    db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }
  return c.json(getBook(id));
});

books.delete('/books/:id', async (c) => {
  const id = c.req.param('id');
  const row = getBookRow(id);
  if (!row) throw new HttpError(404, 'book not found');
  if (c.req.query('file') === '1') {
    const abs = safeLibraryPath(row.path);
    if (!abs || abs === LIBRARY_DIR) throw new HttpError(400, 'invalid path');
    try { await fsp.unlink(abs); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new HttpError(500, `could not delete file: ${(e as Error).message}`);
    }
  }
  db.prepare('DELETE FROM books WHERE id = ?').run(id);
  removeCover(id);
  return c.json({ ok: true });
});

books.get('/books/:id/file', async (c) => {
  const row = getBookRow(c.req.param('id'));
  if (!row) throw new HttpError(404, 'book not found');
  const abs = safeLibraryPath(row.path);
  if (!abs) throw new HttpError(400, 'invalid path');
  let st;
  try { st = await fsp.stat(abs); } catch { throw new HttpError(404, 'file missing on disk'); }
  const size = st.size;
  const fileName = path.basename(row.path);
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const headers: Record<string, string> = {
    'Content-Type': MIME[row.format] ?? 'application/octet-stream',
    'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Accept-Ranges': 'bytes',
    'Last-Modified': st.mtime.toUTCString(),
  };
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = c.req.header('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    if (m[1] === '') {
      const n = Number(m[2]);
      start = Math.max(0, size - n);
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
  if (size === 0) return new Response(null, { status: 200, headers });
  const stream = fs.createReadStream(abs, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
});

books.get('/books/:id/cover', async (c) => {
  const id = c.req.param('id');
  const cv = findCover(id);
  if (!cv) throw new HttpError(404, 'no cover');
  const etag = `"${Math.floor(cv.mtimeMs)}-${cv.size}"`;
  const base = { 'Cache-Control': 'public, max-age=86400', ETag: etag };
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers: base });
  const data = await fsp.readFile(cv.file);
  return new Response(data, { headers: { ...base, 'Content-Type': cv.mime, 'Content-Length': String(data.length) } });
});

books.put('/books/:id/cover', async (c) => {
  const id = c.req.param('id');
  if (!getBookRow(id)) throw new HttpError(404, 'book not found');
  const body = await c.req.parseBody();
  const f = body['file'];
  if (!(f instanceof File)) throw new HttpError(400, 'missing "file" field');
  const data = new Uint8Array(await f.arrayBuffer());
  const ext = detectImageExt(data);
  if (!ext) throw new HttpError(400, 'unsupported image type');
  saveCover(id, data, ext);
  db.prepare('UPDATE books SET has_cover = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return c.json(getBook(id));
});

books.put('/books/:id/progress', async (c) => {
  const id = c.req.param('id');
  const row = getBookRow(id);
  if (!row) throw new HttpError(404, 'book not found');
  let body: ProgressUpdate;
  try { body = await c.req.json(); } catch { throw new HttpError(400, 'invalid JSON body'); }
  if (!body || typeof body.progress !== 'number' || !Number.isFinite(body.progress)) throw new HttpError(400, 'progress must be a number');
  if (body.location !== null && body.location !== undefined && typeof body.location !== 'string') throw new HttpError(400, 'location must be a string or null');
  const progress = Math.min(1, Math.max(0, body.progress));
  let status = row.status;
  if (progress >= 0.99) status = 'finished';
  else if (status === 'unread' && progress > 0) status = 'reading';
  db.prepare('UPDATE books SET progress = ?, location = ?, status = ?, last_opened_at = ? WHERE id = ?')
    .run(progress, body.location ?? null, status, new Date().toISOString(), id);
  return c.json(getBook(id));
});

books.post('/upload', bodyLimit({
  maxSize: 1024 * 1024 * 1024,
  onError: (c) => c.json({ error: 'upload too large (max 1 GB)' }, 413),
}), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body['files'];
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, 'no "files" provided');
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  const added: Book[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const name = sanitizeFileName(f.name);
    if (!formatOf(name)) { skipped.push(f.name); continue; }
    try {
      const dest = await uniquePath(UPLOADS_DIR, name);
      if (!dest.startsWith(LIBRARY_DIR + path.sep)) { skipped.push(f.name); continue; }
      await fsp.writeFile(dest, new Uint8Array(await f.arrayBuffer()), { flag: 'wx' });
      const r = await indexFile(dest);
      const b = r.outcome === 'error' ? null : getBook(r.id);
      if (b) added.push(b); else skipped.push(f.name);
    } catch (e) {
      console.warn(`[upload] ${f.name}: ${(e as Error).message}`);
      skipped.push(f.name);
    }
  }
  return c.json({ added, skipped });
});

books.post('/scan', async (c) => c.json(await scanLibrary()));
