import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SUPPORTED_EXTENSIONS } from '../../shared/types.ts';
import type { BookFormat, ScanResult } from '../../shared/types.ts';
import { LIBRARY_DIR } from './config.ts';
import { db, getBookRow } from './db.ts';
import { extractMetadata } from './metadata/index.ts';
import { saveCover, removeCover } from './covers.ts';
import { parkBook, syncAfterScan } from './sync.ts';

export function formatOf(fileName: string): BookFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.fb2.zip')) return 'fbz';
  const ext = path.extname(lower).slice(1);
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as BookFormat) : null;
}

export function idFor(relPath: string): string {
  return createHash('sha1').update(relPath).digest('hex').slice(0, 16);
}

export function toRel(abs: string): string {
  return path.relative(LIBRARY_DIR, abs).split(path.sep).join('/');
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) {
    console.warn(`[scan] cannot read ${dir}: ${(e as Error).message}`);
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && formatOf(e.name)) out.push(p);
  }
}

export type IndexOutcome = 'added' | 'updated' | 'unchanged' | 'error';

/** Index one file. Never throws. */
export async function indexFile(abs: string, force = false): Promise<{ id: string; outcome: IndexOutcome }> {
  const rel = toRel(abs);
  const id = idFor(rel);
  try {
    const format = formatOf(abs)!;
    const st = await fs.stat(abs);
    const mtime = Math.floor(st.mtimeMs);
    const existing = getBookRow(id);
    if (existing && !force && existing.mtime_ms === mtime && existing.file_size === st.size) {
      return { id, outcome: 'unchanged' };
    }
    const meta = await extractMetadata(abs, format);
    const now = new Date().toISOString();
    let hasCover = existing ? existing.has_cover : 0;
    if (meta.cover) {
      saveCover(id, meta.cover.data, meta.cover.ext);
      hasCover = 1;
    } else if (existing && !existing.metadata_locked) {
      // keep a custom cover? only drop if file no longer yields one and unlocked
      hasCover = existing.has_cover;
    }
    if (!existing) {
      db.prepare(`INSERT INTO books (id, path, format, title, authors, series, series_index, description,
        publisher, language, published_at, isbn, has_cover, file_size, mtime_ms, added_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, rel, format, meta.title, JSON.stringify(meta.authors), meta.series ?? null, meta.seriesIndex ?? null,
        meta.description ?? null, meta.publisher ?? null, meta.language ?? null, meta.publishedAt ?? null,
        meta.isbn ?? null, hasCover, st.size, mtime, now, now);
      return { id, outcome: 'added' };
    }
    if (existing.metadata_locked) {
      db.prepare('UPDATE books SET has_cover=?, file_size=?, mtime_ms=?, updated_at=? WHERE id=?')
        .run(hasCover, st.size, mtime, now, id);
    } else {
      db.prepare(`UPDATE books SET title=?, authors=?, series=?, series_index=?, description=?, publisher=?,
        language=?, published_at=?, isbn=?, has_cover=?, file_size=?, mtime_ms=?, updated_at=? WHERE id=?`).run(
        meta.title, JSON.stringify(meta.authors), meta.series ?? null, meta.seriesIndex ?? null,
        meta.description ?? null, meta.publisher ?? null, meta.language ?? null, meta.publishedAt ?? null,
        meta.isbn ?? null, hasCover, st.size, mtime, now, id);
    }
    return { id, outcome: 'updated' };
  } catch (e) {
    console.warn(`[scan] failed to index ${rel}: ${(e as Error).message}`);
    return { id, outcome: 'error' };
  }
}

/** Stable id for the auto-shelf of a library-relative folder. */
export function folderShelfId(folder: string): string {
  return idFor(`folder:${folder}`);
}

/**
 * Mirror the library's folder structure into read-only "folder" shelves.
 * A book is on the shelf of its own folder and of every ancestor folder; the library root and
 * `uploads/` are ignored. One transaction, bulk queries. Manual shelves/memberships are untouched.
 */
export function syncFolderShelves(): void {
  const books = db.prepare('SELECT id, path FROM books').all() as unknown as { id: string; path: string }[];
  const desired = new Map<string, Set<string>>(); // folder -> book ids
  for (const b of books) {
    const segs = b.path.split('/').slice(0, -1);
    if (!segs.length || segs[0] === 'uploads') continue;
    for (let i = 1; i <= segs.length; i++) {
      const folder = segs.slice(0, i).join('/');
      let set = desired.get(folder);
      if (!set) desired.set(folder, (set = new Set()));
      set.add(b.id);
    }
  }

  const existing = new Map(
    (db.prepare('SELECT id, folder, name FROM shelves WHERE folder IS NOT NULL').all() as unknown as
      { id: string; folder: string; name: string }[]).map((r) => [r.folder, r]),
  );
  const current = new Map<string, Set<string>>(); // shelf id -> book ids
  for (const r of db.prepare(
    `SELECT sb.shelf_id, sb.book_id FROM shelf_books sb JOIN shelves s ON s.id = sb.shelf_id WHERE s.folder IS NOT NULL`,
  ).all() as unknown as { shelf_id: string; book_id: string }[]) {
    let set = current.get(r.shelf_id);
    if (!set) current.set(r.shelf_id, (set = new Set()));
    set.add(r.book_id);
  }

  const now = new Date().toISOString();
  const insShelf = db.prepare('INSERT INTO shelves (id, name, created_at, folder) VALUES (?,?,?,?)');
  const setName = db.prepare('UPDATE shelves SET name = ? WHERE id = ?');
  const delShelf = db.prepare('DELETE FROM shelves WHERE id = ?');
  const insMember = db.prepare('INSERT OR IGNORE INTO shelf_books (shelf_id, book_id, added_at) VALUES (?,?,?)');
  const delMember = db.prepare('DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?');

  db.exec('BEGIN');
  try {
    for (const [folder, row] of existing) {
      if (!desired.has(folder)) delShelf.run(row.id); // cascades memberships
    }
    for (const [folder, ids] of desired) {
      const name = folder.split('/').join(' / ');
      let shelfId = existing.get(folder)?.id;
      if (!shelfId) {
        shelfId = folderShelfId(folder);
        insShelf.run(shelfId, name, now, folder);
      } else if (existing.get(folder)!.name !== name) {
        setName.run(name, shelfId);
      }
      const have = current.get(shelfId) ?? new Set<string>();
      for (const id of ids) if (!have.has(id)) insMember.run(shelfId, id, now);
      for (const id of have) if (!ids.has(id)) delMember.run(shelfId, id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

let inFlight: Promise<ScanResult> | null = null;

export function scanLibrary(): Promise<ScanResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const start = Date.now();
    const res: ScanResult = { added: 0, updated: 0, removed: 0, durationMs: 0 };
    try {
      const files: string[] = [];
      await walk(LIBRARY_DIR, files);
      const seen = new Set<string>();
      for (const f of files) {
        const r = await indexFile(f);
        seen.add(r.id);
        if (r.outcome === 'added') res.added++;
        else if (r.outcome === 'updated') res.updated++;
      }
      const rows = db.prepare('SELECT id FROM books').all() as unknown as { id: string }[];
      for (const { id } of rows) {
        if (!seen.has(id)) {
          parkBook(id); // keep progress/bookmarks/shelf entries so they return if the file comes back
          db.prepare('DELETE FROM books WHERE id = ?').run(id);
          removeCover(id);
          res.removed++;
        }
      }
      syncFolderShelves();
      syncAfterScan();
    } catch (e) {
      console.error('[scan] failed:', e);
    }
    res.durationMs = Date.now() - start;
    return res;
  })().finally(() => { inFlight = null; });
  return inFlight;
}
