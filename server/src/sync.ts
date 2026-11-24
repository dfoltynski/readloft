// Cross-device state sync through per-device JSON files in a shared folder (see README "Sync between devices").
// Each device writes ONLY its own <deviceId>.json (full state, last-writer-wins per record) and merges the others.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { SyncDevice, SyncStatus } from '../../shared/types.ts';
import { db } from './db.ts';
import { DATA_DIR, SYNC_DIR, SYNC_ENABLED } from './config.ts';

type Kind = 'bookmark' | 'annotation' | 'shelf' | 'shelfBook';

interface BookMeta {
  title: string; authors: string[]; series: string | null; seriesIndex: number | null;
  description: string | null; publisher: string | null; language: string | null;
  publishedAt: string | null; isbn: string | null;
}
interface BookRec {
  progress: number; location: string | null; status: string; lastOpenedAt: string | null;
  stateUpdatedAt: string | null; meta?: BookMeta; metaUpdatedAt?: string;
}
interface BookmarkRec { bookKey: string; location: string; label: string; progress: number; createdAt: string; updatedAt: string; deleted?: true }
interface AnnotationRec {
  bookKey: string; cfi: string; text: string; note: string; color: string; progress: number; chapter: string | null;
  createdAt: string; updatedAt: string; deleted?: true;
}
interface ShelfRec { name: string; createdAt: string; updatedAt: string; deleted?: true }
interface ShelfBookRec { addedAt: string; updatedAt: string; deleted?: true }
interface StatePart { progress: number; location: string | null; status: string; lastOpenedAt: string | null; at: string; dev: string }
interface MetaPart { meta: BookMeta; at: string; dev: string }
interface PendBook { state?: StatePart; meta?: MetaPart }
interface SyncFile {
  v: 1; deviceId: string; deviceName: string; writtenAt: string;
  books: Record<string, BookRec>; bookmarks: Record<string, BookmarkRec>; annotations: Record<string, AnnotationRec>;
  shelves: Record<string, ShelfRec>; shelfBooks: Record<string, ShelfBookRec>;
}

const TOMBSTONE_TTL_MS = 90 * 24 * 3600_000;
const POLL_MS = 20_000;
const WRITE_DEBOUNCE_MS = 3000;

const nowIso = () => new Date().toISOString();
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nstr = (v: unknown): string | null => (isStr(v) ? v : null);

export function bookKeyOf(relPath: string): string {
  return relPath.split(path.sep).join('/').normalize('NFC');
}

// ---------- state ----------
let device: { id: string; name: string } | null = null;
let lastMergeAt: string | null = null;
let lastWriteAt: string | null = null;
let lastError: string | undefined;
let knownDevices = new Map<string, SyncDevice>();
let lastSig = '';
let lastContent = '';
let writeTimer: NodeJS.Timeout | null = null;
const loggedBad = new Set<string>();
const brctlAsked = new Map<string, number>();
let lookup = new Map<string, string>(); // NFC book key -> book id

export function getSyncStatus(): SyncStatus {
  return {
    enabled: SYNC_ENABLED, dir: SYNC_ENABLED ? SYNC_DIR : null,
    deviceId: device?.id ?? null, deviceName: device?.name ?? null,
    lastMergeAt, lastWriteAt, devices: [...knownDevices.values()].sort((a, b) => b.writtenAt.localeCompare(a.writtenAt)),
    ...(lastError ? { error: lastError } : {}),
  };
}

function loadDevice(): { id: string; name: string } {
  const f = path.join(DATA_DIR, 'device.json');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (isStr(j?.id) && j.id) return { id: j.id, name: isStr(j.name) ? j.name : os.hostname() };
  } catch { /* create below */ }
  const d = { id: randomUUID(), name: os.hostname() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(d));
  return d;
}

// ---------- helpers for routes ----------
export function markDirty(): void {
  if (!SYNC_ENABLED || !device) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => { writeTimer = null; try { writeOwn(); } catch (e) { fail('write', e); } }, WRITE_DEBOUNCE_MS);
  writeTimer.unref();
}

export function addTombstone(kind: Kind, key: string, at = nowIso()): void {
  db.prepare(`INSERT INTO sync_tombstones (kind, key, deleted_at) VALUES (?,?,?)
    ON CONFLICT(kind, key) DO UPDATE SET deleted_at = CASE WHEN excluded.deleted_at > deleted_at THEN excluded.deleted_at ELSE deleted_at END`)
    .run(kind, key, at);
  delPending(kind, key);
  markDirty();
}

export function clearTombstone(kind: Kind, key: string): void {
  db.prepare('DELETE FROM sync_tombstones WHERE kind = ? AND key = ?').run(kind, key);
  markDirty();
}

export function shelfBookKey(shelfId: string, bookId: string): string | null {
  const r = db.prepare('SELECT path FROM books WHERE id = ?').get(bookId) as unknown as { path: string } | undefined;
  return r ? `${shelfId}|${bookKeyOf(r.path)}` : null;
}

/** Call before deleting a manual shelf: tombstones the shelf and its memberships. */
export function tombstoneShelf(shelfId: string): void {
  const now = nowIso();
  const rows = db.prepare('SELECT b.path FROM shelf_books sb JOIN books b ON b.id = sb.book_id WHERE sb.shelf_id = ?')
    .all(shelfId) as unknown as { path: string }[];
  for (const r of rows) addTombstone('shelfBook', `${shelfId}|${bookKeyOf(r.path)}`, now);
  db.prepare("DELETE FROM sync_pending WHERE kind = 'shelfBook' AND substr(key, 1, length(?) + 1) = ? || '|'").run(shelfId, shelfId);
  addTombstone('shelf', shelfId, now);
}

/**
 * Call before the scanner drops a book whose file vanished (moved, deleted, or evicted by iCloud).
 * Moves its synced state into sync_pending, so it is still emitted to other devices and is restored
 * by applyPending() when a file with the same library path shows up again. Not tombstoned: a missing
 * file on this device must not delete anything on other devices.
 */
export function parkBook(bookId: string): void {
  if (!SYNC_ENABLED || !device) return;
  const dev = device.id;
  const b = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as unknown as {
    path: string; progress: number; location: string | null; status: string; last_opened_at: string | null;
    state_updated_at: string | null; meta_updated_at: string | null; metadata_locked: number;
    title: string; authors: string; series: string | null; series_index: number | null; description: string | null;
    publisher: string | null; language: string | null; published_at: string | null; isbn: string | null;
  } | undefined;
  if (!b) return;
  const key = bookKeyOf(b.path);
  const cur = readPending<PendBook>('book', key) ?? {};
  if (b.state_updated_at && (!cur.state || b.state_updated_at > cur.state.at)) {
    cur.state = { progress: b.progress, location: b.location, status: b.status, lastOpenedAt: b.last_opened_at, at: b.state_updated_at, dev };
  }
  if (b.metadata_locked === 1 && b.meta_updated_at && (!cur.meta || b.meta_updated_at > cur.meta.at)) {
    let authors: string[] = [];
    try { const a = JSON.parse(b.authors); if (Array.isArray(a)) authors = a.map(String); } catch { /* ignore */ }
    cur.meta = { meta: { title: b.title, authors, series: b.series, seriesIndex: b.series_index, description: b.description,
      publisher: b.publisher, language: b.language, publishedAt: b.published_at, isbn: b.isbn }, at: b.meta_updated_at, dev };
  }
  if (cur.state || cur.meta) putPending('book', key, cur, cur.state?.at ?? cur.meta?.at ?? '');
  for (const r of db.prepare('SELECT * FROM bookmarks WHERE book_id = ?').all(bookId) as unknown as
    { id: string; location: string; label: string; progress: number; created_at: string; updated_at: string | null }[]) {
    const rec: BookmarkRec = { bookKey: key, location: r.location, label: r.label, progress: r.progress,
      createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at };
    putPending('bookmark', r.id, { d: dev, r: rec }, rec.updatedAt);
  }
  for (const r of db.prepare('SELECT * FROM annotations WHERE book_id = ?').all(bookId) as unknown as
    { id: string; cfi: string; text: string; note: string; color: string; progress: number; chapter: string | null; created_at: string; updated_at: string }[]) {
    const rec: AnnotationRec = { bookKey: key, cfi: r.cfi, text: r.text, note: r.note, color: r.color, progress: r.progress,
      chapter: r.chapter, createdAt: r.created_at, updatedAt: r.updated_at };
    putPending('annotation', r.id, { d: dev, r: rec }, rec.updatedAt);
  }
  for (const r of db.prepare(`SELECT sb.shelf_id, sb.added_at, sb.updated_at FROM shelf_books sb
    JOIN shelves s ON s.id = sb.shelf_id AND s.folder IS NULL WHERE sb.book_id = ?`).all(bookId) as unknown as
    { shelf_id: string; added_at: string; updated_at: string | null }[]) {
    const rec: ShelfBookRec = { addedAt: r.added_at, updatedAt: r.updated_at ?? r.added_at };
    putPending('shelfBook', `${r.shelf_id}|${key}`, { d: dev, r: rec }, rec.updatedAt);
  }
  markDirty();
}

// ---------- pending / tombstone storage ----------
function getTomb(kind: Kind, key: string): string | null {
  const r = db.prepare('SELECT deleted_at FROM sync_tombstones WHERE kind = ? AND key = ?').get(kind, key) as unknown as { deleted_at: string } | undefined;
  return r ? r.deleted_at : null;
}
function readPending<T>(kind: string, key: string): T | null {
  const r = db.prepare('SELECT json FROM sync_pending WHERE kind = ? AND key = ?').get(kind, key) as unknown as { json: string } | undefined;
  if (!r) return null;
  try { return JSON.parse(r.json) as T; } catch { return null; }
}
function putPending(kind: string, key: string, obj: unknown, updatedAt: string): void {
  db.prepare(`INSERT INTO sync_pending (kind, key, json, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(kind, key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`)
    .run(kind, key, JSON.stringify(obj), updatedAt);
}
function delPending(kind: string, key: string): void {
  db.prepare('DELETE FROM sync_pending WHERE kind = ? AND key = ?').run(kind, key);
}

// ---------- LWW rules ----------
/** Does a remote (at, dev) beat a local timestamp? Equal -> higher deviceId wins. */
function winsOver(rAt: string, rDev: string, lAt: string | null): boolean {
  if (!lAt) return true;
  if (rAt !== lAt) return rAt > lAt;
  return rDev > (device?.id ?? '');
}

function decide(kind: Kind, key: string, rec: { updatedAt: string; deleted?: boolean }, dev: string, localUpd: string | null): 'skip' | 'delete' | 'upsert' {
  if (rec.deleted) return localUpd === null || rec.updatedAt >= localUpd ? 'delete' : 'skip';
  const tomb = getTomb(kind, key);
  if (tomb && tomb >= rec.updatedAt) return 'skip';
  if (localUpd !== null && !winsOver(rec.updatedAt, dev, localUpd)) return 'skip';
  return 'upsert';
}

function setTomb(kind: Kind, key: string, at: string): void {
  db.prepare(`INSERT INTO sync_tombstones (kind, key, deleted_at) VALUES (?,?,?)
    ON CONFLICT(kind, key) DO UPDATE SET deleted_at = CASE WHEN excluded.deleted_at > deleted_at THEN excluded.deleted_at ELSE deleted_at END`)
    .run(kind, key, at);
}

// ---------- applying remote records ----------
function applyBookParts(id: string, state: StatePart | undefined, meta: MetaPart | undefined): void {
  const row = db.prepare('SELECT state_updated_at, meta_updated_at FROM books WHERE id = ?').get(id) as unknown as
    { state_updated_at: string | null; meta_updated_at: string | null } | undefined;
  if (!row) return;
  if (state && winsOver(state.at, state.dev, row.state_updated_at)) {
    db.prepare('UPDATE books SET progress=?, location=?, status=?, last_opened_at=?, state_updated_at=? WHERE id=?')
      .run(state.progress, state.location, state.status, state.lastOpenedAt, state.at, id);
  }
  if (meta && winsOver(meta.at, meta.dev, row.meta_updated_at)) {
    const m = meta.meta;
    db.prepare(`UPDATE books SET title=?, authors=?, series=?, series_index=?, description=?, publisher=?, language=?,
      published_at=?, isbn=?, metadata_locked=1, meta_updated_at=? WHERE id=?`)
      .run(m.title, JSON.stringify(m.authors), m.series, m.seriesIndex, m.description, m.publisher, m.language, m.publishedAt, m.isbn, meta.at, id);
  }
}

function applyBook(key: string, state: StatePart | undefined, meta: MetaPart | undefined): void {
  const id = lookup.get(key);
  if (id) { applyBookParts(id, state, meta); return; }
  const cur = readPending<PendBook>('book', key) ?? {};
  if (state && (!cur.state || state.at > cur.state.at)) cur.state = state;
  if (meta && (!cur.meta || meta.at > cur.meta.at)) cur.meta = meta;
  putPending('book', key, cur, cur.state?.at ?? cur.meta?.at ?? '');
}

function applyBookmark(key: string, rec: BookmarkRec, dev: string): void {
  const live = db.prepare('SELECT updated_at FROM bookmarks WHERE id = ?').get(key) as unknown as { updated_at: string | null } | undefined;
  const pend = readPending<{ d: string; r: BookmarkRec }>('bookmark', key);
  const localUpd = live ? (live.updated_at ?? '') : pend ? pend.r.updatedAt : null;
  const d = decide('bookmark', key, rec, dev, localUpd);
  if (d === 'skip') return;
  if (d === 'delete') {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(key);
    delPending('bookmark', key);
    setTomb('bookmark', key, rec.updatedAt);
    return;
  }
  db.prepare('DELETE FROM sync_tombstones WHERE kind = ? AND key = ?').run('bookmark', key);
  const bid = lookup.get(rec.bookKey);
  if (bid) {
    db.prepare(`INSERT INTO bookmarks (id, book_id, location, label, progress, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET book_id=excluded.book_id, location=excluded.location, label=excluded.label,
      progress=excluded.progress, created_at=excluded.created_at, updated_at=excluded.updated_at`)
      .run(key, bid, rec.location, rec.label, rec.progress, rec.createdAt, rec.updatedAt);
    delPending('bookmark', key);
  } else {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(key);
    putPending('bookmark', key, { d: dev, r: rec }, rec.updatedAt);
  }
}

function applyAnnotation(key: string, rec: AnnotationRec, dev: string): void {
  const live = db.prepare('SELECT updated_at FROM annotations WHERE id = ?').get(key) as unknown as { updated_at: string | null } | undefined;
  const pend = readPending<{ d: string; r: AnnotationRec }>('annotation', key);
  const localUpd = live ? (live.updated_at ?? '') : pend ? pend.r.updatedAt : null;
  const d = decide('annotation', key, rec, dev, localUpd);
  if (d === 'skip') return;
  if (d === 'delete') {
    db.prepare('DELETE FROM annotations WHERE id = ?').run(key);
    delPending('annotation', key);
    setTomb('annotation', key, rec.updatedAt);
    return;
  }
  db.prepare('DELETE FROM sync_tombstones WHERE kind = ? AND key = ?').run('annotation', key);
  const bid = lookup.get(rec.bookKey);
  if (bid) {
    db.prepare(`INSERT INTO annotations (id, book_id, cfi, text, note, color, progress, chapter, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET book_id=excluded.book_id, cfi=excluded.cfi, text=excluded.text, note=excluded.note,
      color=excluded.color, progress=excluded.progress, chapter=excluded.chapter, created_at=excluded.created_at, updated_at=excluded.updated_at`)
      .run(key, bid, rec.cfi, rec.text, rec.note, rec.color, rec.progress, rec.chapter, rec.createdAt, rec.updatedAt);
    delPending('annotation', key);
  } else {
    db.prepare('DELETE FROM annotations WHERE id = ?').run(key);
    putPending('annotation', key, { d: dev, r: rec }, rec.updatedAt);
  }
}

function applyShelf(key: string, rec: ShelfRec, dev: string): void {
  const live = db.prepare('SELECT updated_at, folder FROM shelves WHERE id = ?').get(key) as unknown as { updated_at: string | null; folder: string | null } | undefined;
  if (live && live.folder !== null) return; // never touch folder shelves
  const d = decide('shelf', key, rec, dev, live ? (live.updated_at ?? '') : null);
  if (d === 'skip') return;
  if (d === 'delete') {
    db.prepare('DELETE FROM shelves WHERE id = ? AND folder IS NULL').run(key); // cascades memberships
    db.prepare("DELETE FROM sync_pending WHERE kind = 'shelfBook' AND substr(key, 1, length(?) + 1) = ? || '|'").run(key, key);
    setTomb('shelf', key, rec.updatedAt);
    return;
  }
  db.prepare('DELETE FROM sync_tombstones WHERE kind = ? AND key = ?').run('shelf', key);
  db.prepare(`INSERT INTO shelves (id, name, created_at, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`)
    .run(key, rec.name, rec.createdAt, rec.updatedAt);
}

function applyShelfBook(key: string, rec: ShelfBookRec, dev: string): void {
  const i = key.indexOf('|');
  if (i < 1) return;
  const shelfId = key.slice(0, i);
  const bookKey = key.slice(i + 1);
  const bid = lookup.get(bookKey);
  const live = bid ? db.prepare('SELECT updated_at FROM shelf_books WHERE shelf_id = ? AND book_id = ?').get(shelfId, bid) as unknown as { updated_at: string | null } | undefined : undefined;
  const pend = readPending<{ d: string; r: ShelfBookRec }>('shelfBook', key);
  const localUpd = live ? (live.updated_at ?? '') : pend ? pend.r.updatedAt : null;
  const d = decide('shelfBook', key, rec, dev, localUpd);
  if (d === 'skip') return;
  if (d === 'delete') {
    if (bid) db.prepare('DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?').run(shelfId, bid);
    delPending('shelfBook', key);
    setTomb('shelfBook', key, rec.updatedAt);
    return;
  }
  const shelf = db.prepare('SELECT folder FROM shelves WHERE id = ?').get(shelfId) as unknown as { folder: string | null } | undefined;
  if (!shelf) {
    if (getTomb('shelf', shelfId)) return; // shelf was deleted
    putPending('shelfBook', key, { d: dev, r: rec }, rec.updatedAt);
    return;
  }
  if (shelf.folder !== null) return;
  db.prepare('DELETE FROM sync_tombstones WHERE kind = ? AND key = ?').run('shelfBook', key);
  if (bid) {
    db.prepare(`INSERT INTO shelf_books (shelf_id, book_id, added_at, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(shelf_id, book_id) DO UPDATE SET added_at=excluded.added_at, updated_at=excluded.updated_at`)
      .run(shelfId, bid, rec.addedAt, rec.updatedAt);
    delPending('shelfBook', key);
  } else {
    putPending('shelfBook', key, { d: dev, r: rec }, rec.updatedAt);
  }
}

function refreshLookup(): void {
  lookup = new Map();
  for (const r of db.prepare('SELECT id, path FROM books').all() as unknown as { id: string; path: string }[]) {
    lookup.set(bookKeyOf(r.path), r.id);
  }
}

/** Apply sync_pending rows whose books/shelves now exist. Caller must be inside a transaction. */
function applyPendingInner(): void {
  refreshLookup();
  const rows = db.prepare('SELECT kind, key FROM sync_pending').all() as unknown as { kind: string; key: string }[];
  for (const { kind, key } of rows) {
    if (kind === 'book') {
      if (!lookup.has(key)) continue;
      const p = readPending<PendBook>('book', key);
      delPending('book', key);
      if (p) applyBookParts(lookup.get(key)!, p.state, p.meta);
    } else if (kind === 'bookmark' || kind === 'annotation' || kind === 'shelfBook') {
      const p = readPending<{ d: string; r: never }>(kind, key);
      delPending(kind, key);
      if (!p) continue;
      if (kind === 'bookmark') applyBookmark(key, p.r as BookmarkRec, p.d);
      else if (kind === 'annotation') applyAnnotation(key, p.r as AnnotationRec, p.d);
      else applyShelfBook(key, p.r as ShelfBookRec, p.d);
    }
  }
}

/** Apply pending records for books that now exist (after a scan or upload). */
export function applyPending(): void {
  if (!SYNC_ENABLED || !device) return;
  const before = (db.prepare('SELECT COUNT(*) AS n FROM sync_pending').get() as unknown as { n: number }).n;
  if (!before) return;
  db.exec('BEGIN');
  try { applyPendingInner(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); fail('apply pending', e); return; }
  markDirty();
}

// ---------- reading remote files ----------
function fail(what: string, e: unknown): void {
  lastError = `${what}: ${(e as Error).message}`;
  console.warn(`[sync] ${lastError}`);
}

function parseRemote(file: string, sig: string): SyncFile | null {
  let j: unknown;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (!loggedBad.has(file + sig)) { loggedBad.add(file + sig); console.warn(`[sync] skipping unreadable ${path.basename(file)}: ${(e as Error).message}`); }
    return null;
  }
  if (!isObj(j) || j.v !== 1 || !isStr(j.deviceId) || !j.deviceId) {
    if (!loggedBad.has(file + sig)) { loggedBad.add(file + sig); console.warn(`[sync] skipping ${path.basename(file)}: unsupported format`); }
    return null;
  }
  const m = (v: unknown) => (isObj(v) ? v : {});
  return {
    v: 1, deviceId: j.deviceId, deviceName: isStr(j.deviceName) ? j.deviceName : j.deviceId,
    writtenAt: isStr(j.writtenAt) ? j.writtenAt : '', books: m(j.books) as never, bookmarks: m(j.bookmarks) as never,
    annotations: m(j.annotations) as never,
    shelves: m(j.shelves) as never, shelfBooks: m(j.shelfBooks) as never,
  };
}

function parseMeta(v: unknown): BookMeta | null {
  if (!isObj(v) || !isStr(v.title) || !v.title.trim()) return null;
  return {
    title: v.title, authors: Array.isArray(v.authors) ? v.authors.filter(isStr) : [], series: nstr(v.series),
    seriesIndex: isNum(v.seriesIndex) ? v.seriesIndex : null, description: nstr(v.description), publisher: nstr(v.publisher),
    language: nstr(v.language), publishedAt: nstr(v.publishedAt), isbn: nstr(v.isbn),
  };
}

interface DirScan { files: { name: string; full: string; sig: string }[]; sig: string }

function scanDir(ownName: string): DirScan {
  const files: DirScan['files'] = [];
  for (const name of fs.readdirSync(SYNC_DIR)) {
    if (process.platform === 'darwin' && name.startsWith('.') && name.endsWith('.json.icloud')) {
      const real = path.join(SYNC_DIR, name.slice(1, -'.icloud'.length));
      const last = brctlAsked.get(real) ?? 0;
      if (Date.now() - last > 60_000) {
        brctlAsked.set(real, Date.now());
        try { execFile('brctl', ['download', real], () => { /* ignore */ }); } catch { /* ignore */ }
      }
      continue;
    }
    if (name.startsWith('.') || !name.endsWith('.json') || name === ownName) continue;
    const full = path.join(SYNC_DIR, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile()) files.push({ name, full, sig: `${name}:${Math.floor(st.mtimeMs)}:${st.size}` });
    } catch { /* vanished */ }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { files, sig: files.map((f) => f.sig).join('|') };
}

/** Merge every other device's file into the local DB. Returns true when anything was read. */
export function mergeRemote(force = false): boolean {
  if (!SYNC_ENABLED || !device) return false;
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  const scan = scanDir(`${device.id}.json`);
  if (!force && scan.sig === lastSig) { lastMergeAt = nowIso(); return false; }

  const states = new Map<string, StatePart>();
  const metas = new Map<string, MetaPart>();
  const bm = new Map<string, { rec: BookmarkRec; dev: string }>();
  const an = new Map<string, { rec: AnnotationRec; dev: string }>();
  const sh = new Map<string, { rec: ShelfRec; dev: string }>();
  const sb = new Map<string, { rec: ShelfBookRec; dev: string }>();
  const devices = new Map<string, SyncDevice>();
  const beats = <T extends { updatedAt: string; deleted?: true }>(a: { rec: T; dev: string }, b: { rec: T; dev: string } | undefined) =>
    !b || a.rec.updatedAt > b.rec.updatedAt ||
    (a.rec.updatedAt === b.rec.updatedAt && (!!a.rec.deleted !== !!b.rec.deleted ? !!a.rec.deleted : a.dev > b.dev));
  const offer = <T extends { updatedAt: string; deleted?: true }>(map: Map<string, { rec: T; dev: string }>, key: string, rec: T, dev: string) => {
    const c = { rec, dev };
    if (beats(c, map.get(key))) map.set(key, c);
  };

  for (const f of scan.files) {
    const r = parseRemote(f.full, f.sig);
    if (!r || r.deviceId === device.id) continue;
    devices.set(r.deviceId, { id: r.deviceId, name: r.deviceName, writtenAt: r.writtenAt });
    const dev = r.deviceId;
    for (const [key, v] of Object.entries(r.books)) {
      if (!isObj(v)) continue;
      const at = nstr(v.stateUpdatedAt);
      if (at && isNum(v.progress) && isStr(v.status)) {
        const cur = states.get(key);
        if (!cur || at > cur.at || (at === cur.at && dev > cur.dev)) {
          states.set(key, { progress: v.progress, location: nstr(v.location), status: v.status, lastOpenedAt: nstr(v.lastOpenedAt), at, dev });
        }
      }
      const mat = nstr(v.metaUpdatedAt);
      const meta = mat ? parseMeta(v.meta) : null;
      if (mat && meta) {
        const cur = metas.get(key);
        if (!cur || mat > cur.at || (mat === cur.at && dev > cur.dev)) metas.set(key, { meta, at: mat, dev });
      }
    }
    for (const [key, v] of Object.entries(r.bookmarks)) {
      if (!isObj(v) || !isStr(v.updatedAt)) continue;
      if (v.deleted === true) offer(bm, key, { bookKey: '', location: '', label: '', progress: 0, createdAt: '', updatedAt: v.updatedAt, deleted: true }, dev);
      else if (isStr(v.bookKey) && isStr(v.location) && v.location && isNum(v.progress) && isStr(v.createdAt)) {
        offer(bm, key, { bookKey: v.bookKey.normalize('NFC'), location: v.location, label: isStr(v.label) ? v.label : '', progress: v.progress, createdAt: v.createdAt, updatedAt: v.updatedAt }, dev);
      }
    }
    for (const [key, v] of Object.entries(r.annotations)) {
      if (!isObj(v) || !isStr(v.updatedAt)) continue;
      if (v.deleted === true) offer(an, key, { bookKey: '', cfi: '', text: '', note: '', color: 'yellow', progress: 0, chapter: null, createdAt: '', updatedAt: v.updatedAt, deleted: true }, dev);
      else if (isStr(v.bookKey) && isStr(v.cfi) && v.cfi && isNum(v.progress) && isStr(v.createdAt)) {
        offer(an, key, { bookKey: v.bookKey.normalize('NFC'), cfi: v.cfi, text: isStr(v.text) ? v.text : '', note: isStr(v.note) ? v.note : '',
          color: isStr(v.color) ? v.color : 'yellow', progress: v.progress, chapter: nstr(v.chapter), createdAt: v.createdAt, updatedAt: v.updatedAt }, dev);
      }
    }
    for (const [key, v] of Object.entries(r.shelves)) {
      if (!isObj(v) || !isStr(v.updatedAt)) continue;
      if (v.deleted === true) offer(sh, key, { name: '', createdAt: '', updatedAt: v.updatedAt, deleted: true }, dev);
      else if (isStr(v.name) && v.name && isStr(v.createdAt)) offer(sh, key, { name: v.name, createdAt: v.createdAt, updatedAt: v.updatedAt }, dev);
    }
    for (const [key, v] of Object.entries(r.shelfBooks)) {
      if (!isObj(v) || !isStr(v.updatedAt)) continue;
      const k = key.indexOf('|') > 0 ? key.slice(0, key.indexOf('|') + 1) + key.slice(key.indexOf('|') + 1).normalize('NFC') : null;
      if (!k) continue;
      if (v.deleted === true) offer(sb, k, { addedAt: '', updatedAt: v.updatedAt, deleted: true }, dev);
      else if (isStr(v.addedAt)) offer(sb, k, { addedAt: v.addedAt, updatedAt: v.updatedAt }, dev);
    }
  }

  db.exec('BEGIN');
  try {
    refreshLookup();
    for (const [key, v] of sh) applyShelf(key, v.rec, v.dev);
    const bookKeys = new Set([...states.keys(), ...metas.keys()]);
    for (const key of bookKeys) applyBook(key.normalize('NFC'), states.get(key), metas.get(key));
    for (const [key, v] of bm) applyBookmark(key, v.rec, v.dev);
    for (const [key, v] of an) applyAnnotation(key, v.rec, v.dev);
    for (const [key, v] of sb) applyShelfBook(key, v.rec, v.dev);
    applyPendingInner();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    fail('merge', e);
    return false;
  }
  lastSig = scan.sig;
  knownDevices = devices;
  lastMergeAt = nowIso();
  lastError = undefined;
  markDirty(); // merged state is now ours too
  return true;
}

// ---------- writing our own file ----------
function buildState(): Omit<SyncFile, 'writtenAt'> {
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString();
  db.prepare('DELETE FROM sync_tombstones WHERE deleted_at < ?').run(cutoff);
  const books: Record<string, BookRec> = {};
  const bookmarks: Record<string, BookmarkRec> = {};
  const annotations: Record<string, AnnotationRec> = {};
  const shelves: Record<string, ShelfRec> = {};
  const shelfBooks: Record<string, ShelfBookRec> = {};

  interface Row {
    path: string; progress: number; location: string | null; status: string; last_opened_at: string | null;
    state_updated_at: string | null; meta_updated_at: string | null; metadata_locked: number;
    title: string; authors: string; series: string | null; series_index: number | null; description: string | null;
    publisher: string | null; language: string | null; published_at: string | null; isbn: string | null;
  }
  for (const r of db.prepare('SELECT * FROM books ORDER BY path').all() as unknown as Row[]) {
    const withMeta = r.metadata_locked === 1 && !!r.meta_updated_at;
    if (!r.state_updated_at && !withMeta) continue;
    let authors: string[] = [];
    try { const a = JSON.parse(r.authors); if (Array.isArray(a)) authors = a.map(String); } catch { /* ignore */ }
    const rec: BookRec = {
      progress: r.progress, location: r.location, status: r.status, lastOpenedAt: r.last_opened_at, stateUpdatedAt: r.state_updated_at,
    };
    if (withMeta) {
      rec.meta = { title: r.title, authors, series: r.series, seriesIndex: r.series_index, description: r.description,
        publisher: r.publisher, language: r.language, publishedAt: r.published_at, isbn: r.isbn };
      rec.metaUpdatedAt = r.meta_updated_at!;
    }
    books[bookKeyOf(r.path)] = rec;
  }
  for (const r of db.prepare('SELECT key, json FROM sync_pending WHERE kind = ? ORDER BY key').all('book') as unknown as { key: string; json: string }[]) {
    if (books[r.key]) continue;
    try {
      const p = JSON.parse(r.json) as PendBook;
      const rec: BookRec = p.state
        ? { progress: p.state.progress, location: p.state.location, status: p.state.status, lastOpenedAt: p.state.lastOpenedAt, stateUpdatedAt: p.state.at }
        : { progress: 0, location: null, status: 'unread', lastOpenedAt: null, stateUpdatedAt: null };
      if (p.meta) { rec.meta = p.meta.meta; rec.metaUpdatedAt = p.meta.at; }
      books[r.key] = rec;
    } catch { /* ignore */ }
  }

  for (const r of db.prepare(`SELECT bm.*, b.path FROM bookmarks bm JOIN books b ON b.id = bm.book_id ORDER BY bm.id`).all() as unknown as
    { id: string; path: string; location: string; label: string; progress: number; created_at: string; updated_at: string | null }[]) {
    bookmarks[r.id] = { bookKey: bookKeyOf(r.path), location: r.location, label: r.label, progress: r.progress,
      createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at };
  }
  for (const r of db.prepare('SELECT key, json FROM sync_pending WHERE kind = ? ORDER BY key').all('bookmark') as unknown as { key: string; json: string }[]) {
    if (bookmarks[r.key]) continue;
    try { bookmarks[r.key] = (JSON.parse(r.json) as { r: BookmarkRec }).r; } catch { /* ignore */ }
  }
  for (const r of db.prepare('SELECT an.*, b.path FROM annotations an JOIN books b ON b.id = an.book_id ORDER BY an.id').all() as unknown as
    { id: string; path: string; cfi: string; text: string; note: string; color: string; progress: number; chapter: string | null; created_at: string; updated_at: string }[]) {
    annotations[r.id] = { bookKey: bookKeyOf(r.path), cfi: r.cfi, text: r.text, note: r.note, color: r.color, progress: r.progress,
      chapter: r.chapter, createdAt: r.created_at, updatedAt: r.updated_at };
  }
  for (const r of db.prepare('SELECT key, json FROM sync_pending WHERE kind = ? ORDER BY key').all('annotation') as unknown as { key: string; json: string }[]) {
    if (annotations[r.key]) continue;
    try { annotations[r.key] = (JSON.parse(r.json) as { r: AnnotationRec }).r; } catch { /* ignore */ }
  }
  for (const r of db.prepare('SELECT * FROM shelves WHERE folder IS NULL ORDER BY id').all() as unknown as
    { id: string; name: string; created_at: string; updated_at: string | null }[]) {
    shelves[r.id] = { name: r.name, createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at };
  }
  for (const r of db.prepare(`SELECT sb.shelf_id, sb.added_at, sb.updated_at, b.path FROM shelf_books sb
    JOIN shelves s ON s.id = sb.shelf_id AND s.folder IS NULL JOIN books b ON b.id = sb.book_id ORDER BY sb.shelf_id, b.path`).all() as unknown as
    { shelf_id: string; added_at: string; updated_at: string | null; path: string }[]) {
    shelfBooks[`${r.shelf_id}|${bookKeyOf(r.path)}`] = { addedAt: r.added_at, updatedAt: r.updated_at ?? r.added_at };
  }
  for (const r of db.prepare('SELECT key, json FROM sync_pending WHERE kind = ? ORDER BY key').all('shelfBook') as unknown as { key: string; json: string }[]) {
    if (shelfBooks[r.key]) continue;
    try { shelfBooks[r.key] = (JSON.parse(r.json) as { r: ShelfBookRec }).r; } catch { /* ignore */ }
  }
  for (const t of db.prepare('SELECT kind, key, deleted_at FROM sync_tombstones ORDER BY kind, key').all() as unknown as { kind: Kind; key: string; deleted_at: string }[]) {
    if (t.kind === 'bookmark' && !bookmarks[t.key]) bookmarks[t.key] = { bookKey: '', location: '', label: '', progress: 0, createdAt: '', updatedAt: t.deleted_at, deleted: true };
    else if (t.kind === 'annotation' && !annotations[t.key]) annotations[t.key] = { bookKey: '', cfi: '', text: '', note: '', color: 'yellow', progress: 0, chapter: null, createdAt: '', updatedAt: t.deleted_at, deleted: true };
    else if (t.kind === 'shelf' && !shelves[t.key]) shelves[t.key] = { name: '', createdAt: '', updatedAt: t.deleted_at, deleted: true };
    else if (t.kind === 'shelfBook' && !shelfBooks[t.key]) shelfBooks[t.key] = { addedAt: '', updatedAt: t.deleted_at, deleted: true };
  }
  return { v: 1, deviceId: device!.id, deviceName: device!.name, books, bookmarks, annotations, shelves, shelfBooks };
}

/** Write this device's full state (atomically). Skips when unchanged. */
export function writeOwn(): boolean {
  if (!SYNC_ENABLED || !device) return false;
  const state = buildState();
  const content = JSON.stringify(state);
  if (content === lastContent) return false;
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  const writtenAt = nowIso();
  const { v, deviceId, deviceName, ...rest } = state;
  const file = path.join(SYNC_DIR, `${device.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v, deviceId, deviceName, writtenAt, ...rest }));
  fs.renameSync(tmp, file);
  lastContent = content;
  lastWriteAt = writtenAt;
  return true;
}

// ---------- lifecycle ----------
export function startSync(): void {
  if (!SYNC_ENABLED) { console.log('[sync] disabled (SYNC=0)'); return; }
  try {
    device = loadDevice();
    fs.mkdirSync(SYNC_DIR, { recursive: true });
    const own = path.join(SYNC_DIR, `${device.id}.json`);
    try {
      const j = JSON.parse(fs.readFileSync(own, 'utf8')) as Record<string, unknown>;
      lastWriteAt = isStr(j.writtenAt) ? j.writtenAt : null;
      delete j.writtenAt;
      lastContent = JSON.stringify(j);
    } catch { /* no previous file */ }
    mergeRemote(true);
    writeOwn();
    console.log(`[sync] device ${device.name} (${device.id.slice(0, 8)}) dir=${SYNC_DIR}`);
  } catch (e) { fail('start', e); }

  const check = () => {
    try { mergeRemote(); } catch (e) { fail('poll', e); }
  };
  setInterval(check, POLL_MS).unref();
  try {
    let t: NodeJS.Timeout | null = null;
    const w = fs.watch(SYNC_DIR, () => {
      if (t) clearTimeout(t);
      t = setTimeout(check, 1000);
      t.unref();
    });
    w.on('error', () => { /* polling still works */ });
    w.unref();
  } catch { /* watch unsupported; polling still works */ }
}

/** "Sync now": write this device's state, re-read every other device's file and apply pending records. */
export function syncNow(): SyncStatus {
  if (!SYNC_ENABLED || !device) return getSyncStatus();
  try {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    writeOwn();
    mergeRemote(true);
    applyPending();
    writeOwn();
  } catch (e) { fail('sync now', e); }
  return getSyncStatus();
}

/** After a scan: re-read remote files, then apply pending records for newly present books. */
export function syncAfterScan(): void {
  if (!SYNC_ENABLED || !device) return;
  try { mergeRemote(true); applyPending(); } catch (e) { fail('after scan', e); }
}
