// SPDX-License-Identifier: AGPL-3.0-only
// Last-writer-wins merge, exercised black-box: remote devices are JSON files in SYNC_DIR,
// the local device is this process. Records are compared via the real SQLite DB.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'libristead-sync-'));
const syncDir = path.join(root, 'sync');
process.env.LIBRARY_DIR = path.join(root, 'library');
process.env.DATA_DIR = path.join(root, 'data');
process.env.SYNC_DIR = syncDir;
delete process.env.SYNC;

const LOCAL = 'dev-m-local';
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.DATA_DIR, 'device.json'), JSON.stringify({ id: LOCAL, name: 'Local' }));

const { ensureDirs } = await import('../src/config.ts');
const { db, migrate } = await import('../src/db.ts');
const sync = await import('../src/sync.ts');

const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
type Rec = Record<string, unknown>;
interface Remote { books?: Rec; bookmarks?: Rec; annotations?: Rec; shelves?: Rec; shelfBooks?: Rec }

function remote(id: string, r: Remote): void {
  fs.writeFileSync(path.join(syncDir, `${id}.json`), JSON.stringify({
    v: 1, deviceId: id, deviceName: id, writtenAt: t(0),
    books: {}, bookmarks: {}, annotations: {}, shelves: {}, shelfBooks: {}, ...r,
  }));
}
const merge = () => assert.equal(sync.mergeRemote(true), true);
const all = (sql: string, ...p: (string | number)[]) => db.prepare(sql).all(...p) as unknown as Rec[];
const one = (sql: string, ...p: (string | number)[]) => db.prepare(sql).get(...p) as unknown as Rec | undefined;
const ownFile = () => JSON.parse(fs.readFileSync(path.join(syncDir, `${LOCAL}.json`), 'utf8'));

function addBook(id: string, rel: string): void {
  db.prepare(`INSERT INTO books (id, path, format, title, added_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, rel, 'epub', `Title ${id}`, t(0), t(0));
}
function snapshot(): string {
  return JSON.stringify(['books', 'bookmarks', 'annotations', 'shelves', 'shelf_books', 'sync_tombstones', 'sync_pending']
    .map((tb) => all(`SELECT * FROM ${tb} ORDER BY 1, 2`)));
}
const bookState = (id: string) => one('SELECT progress, status, state_updated_at FROM books WHERE id = ?', id)!;

before(() => {
  ensureDirs(); migrate();
  fs.mkdirSync(syncDir, { recursive: true });
  addBook('b1', 'one.epub'); addBook('b2', 'two.epub'); addBook('b3', 'three.epub');
  sync.startSync();
  assert.equal(sync.getSyncStatus().deviceId, LOCAL);
});

test('book state: newer remote wins, older remote ignored', () => {
  db.prepare("UPDATE books SET progress=0.5, status='reading', state_updated_at=? WHERE id='b1'").run(t(10));
  remote('dev-a', { books: { 'one.epub': { progress: 0.9, location: 'loc9', status: 'finished', lastOpenedAt: t(20), stateUpdatedAt: t(20) } } });
  merge();
  assert.deepEqual({ ...bookState('b1') }, { progress: 0.9, status: 'finished', state_updated_at: t(20) });

  remote('dev-a', { books: { 'one.epub': { progress: 0.1, location: 'old', status: 'reading', lastOpenedAt: t(5), stateUpdatedAt: t(5) } } });
  merge();
  assert.equal(bookState('b1').progress, 0.9);
});

test('book state vs metadata are independent fields (concurrent edits merge)', () => {
  db.prepare("UPDATE books SET progress=0.3, status='reading', state_updated_at=? WHERE id='b2'").run(t(50));
  remote('dev-a', { books: { 'two.epub': {
    progress: 0.1, location: null, status: 'reading', lastOpenedAt: null, stateUpdatedAt: t(40), // older state
    meta: { title: 'Edited Title', authors: ['X'], series: 'S', seriesIndex: 1, description: null, publisher: null, language: 'en', publishedAt: null, isbn: null },
    metaUpdatedAt: t(60), // newer meta
  } } });
  merge();
  const r = one('SELECT title, series, metadata_locked, progress, state_updated_at FROM books WHERE id = ?', 'b2')!;
  assert.equal(r.title, 'Edited Title');
  assert.equal(r.series, 'S');
  assert.equal(r.metadata_locked, 1);
  assert.equal(r.progress, 0.3); // local state kept
  assert.equal(r.state_updated_at, t(50));
});

test('two remote devices: newest wins regardless of file order; tie -> higher deviceId', () => {
  const st = (p: number, at: string) => ({ books: { 'three.epub': { progress: p, location: null, status: 'reading', lastOpenedAt: null, stateUpdatedAt: at } } });
  remote('dev-b', st(0.2, t(100)));
  remote('dev-c', st(0.7, t(90)));
  merge();
  assert.equal(bookState('b3').progress, 0.2);

  remote('dev-b', st(0.4, t(200)));
  remote('dev-c', st(0.6, t(200))); // tie, dev-c > dev-b
  merge();
  assert.equal(bookState('b3').progress, 0.6);
  fs.rmSync(path.join(syncDir, 'dev-b.json')); fs.rmSync(path.join(syncDir, 'dev-c.json'));
});

const bm = (over: Rec = {}) => ({ bookKey: 'one.epub', location: 'epubcfi(/6/2)', label: 'L', progress: 0.1, createdAt: t(1), updatedAt: t(1), ...over });

test('bookmarks: create, newer edit wins, older edit ignored', () => {
  remote('dev-a', { bookmarks: { m1: bm() } });
  merge();
  assert.equal(one('SELECT label FROM bookmarks WHERE id = ?', 'm1')?.label, 'L');

  remote('dev-a', { bookmarks: { m1: bm({ label: 'newer', updatedAt: t(30) }) } });
  merge();
  assert.equal(one('SELECT label FROM bookmarks WHERE id = ?', 'm1')?.label, 'newer');

  remote('dev-a', { bookmarks: { m1: bm({ label: 'stale', updatedAt: t(10) }) } });
  merge();
  assert.equal(one('SELECT label FROM bookmarks WHERE id = ?', 'm1')?.label, 'newer');
});

test('bookmarks: deletion tombstone removes, blocks stale re-add, newer re-add resurrects', () => {
  remote('dev-a', { bookmarks: { m1: { updatedAt: t(40), deleted: true } } });
  merge();
  assert.equal(one('SELECT 1 FROM bookmarks WHERE id = ?', 'm1'), undefined);
  assert.equal(one("SELECT deleted_at FROM sync_tombstones WHERE kind='bookmark' AND key='m1'")?.deleted_at, t(40));

  remote('dev-b', { bookmarks: { m1: bm({ label: 'zombie', updatedAt: t(35) }) } });
  merge();
  assert.equal(one('SELECT 1 FROM bookmarks WHERE id = ?', 'm1'), undefined);

  remote('dev-b', { bookmarks: { m1: bm({ label: 'reborn', updatedAt: t(45) }) } });
  merge();
  assert.equal(one('SELECT label FROM bookmarks WHERE id = ?', 'm1')?.label, 'reborn');
  assert.equal(one("SELECT 1 FROM sync_tombstones WHERE kind='bookmark' AND key='m1'"), undefined);
  fs.rmSync(path.join(syncDir, 'dev-b.json'));
});

test('local deletion (tombstone) is emitted and a stale remote cannot revive it', () => {
  const del = new Date().toISOString(); // tombstones older than 90 days are pruned when writing
  remote('dev-a', { bookmarks: { m2: bm({ updatedAt: t(5) }) } });
  merge();
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run('m2');
  sync.addTombstone('bookmark', 'm2', del);
  merge();
  assert.equal(one('SELECT 1 FROM bookmarks WHERE id = ?', 'm2'), undefined);
  sync.writeOwn();
  assert.deepEqual({ ...ownFile().bookmarks.m2 }, { bookKey: '', location: '', label: '', progress: 0, createdAt: '', updatedAt: del, deleted: true });
});

test('annotations, shelves and shelf memberships: create then delete; shelf delete cascades', () => {
  remote('dev-a', {
    annotations: { a1: { bookKey: 'one.epub', cfi: 'c', text: 'hi', note: 'n', color: 'blue', progress: 0.2, chapter: null, createdAt: t(1), updatedAt: t(1) } },
    shelves: { s1: { name: 'Favs', createdAt: t(1), updatedAt: t(1) } },
    shelfBooks: { 's1|one.epub': { addedAt: t(1), updatedAt: t(1) } },
  });
  merge();
  assert.equal(one('SELECT note FROM annotations WHERE id = ?', 'a1')?.note, 'n');
  assert.equal(one('SELECT name FROM shelves WHERE id = ?', 's1')?.name, 'Favs');
  assert.equal(all('SELECT * FROM shelf_books WHERE shelf_id = ?', 's1').length, 1);

  remote('dev-a', {
    annotations: { a1: { updatedAt: t(70), deleted: true } },
    shelves: { s1: { updatedAt: t(70), deleted: true } },
    shelfBooks: { 's1|one.epub': { updatedAt: t(70), deleted: true } },
  });
  merge();
  assert.equal(one('SELECT 1 FROM annotations WHERE id = ?', 'a1'), undefined);
  assert.equal(one('SELECT 1 FROM shelves WHERE id = ?', 's1'), undefined);
  assert.equal(all('SELECT * FROM shelf_books WHERE shelf_id = ?', 's1').length, 0);
});

test('records for books not in the library are parked and applied later', () => {
  remote('dev-a', { bookmarks: { m9: bm({ bookKey: 'late.epub', updatedAt: t(80) }) } });
  merge();
  assert.equal(one('SELECT 1 FROM bookmarks WHERE id = ?', 'm9'), undefined);
  assert.equal(one("SELECT 1 FROM sync_pending WHERE kind='bookmark' AND key='m9'") !== undefined, true);
  addBook('b9', 'late.epub');
  sync.applyPending();
  assert.equal(one('SELECT book_id FROM bookmarks WHERE id = ?', 'm9')?.book_id, 'b9');
  assert.equal(one("SELECT 1 FROM sync_pending WHERE kind='bookmark' AND key='m9'"), undefined);
});

test('re-merging the same remote files is idempotent', () => {
  const before = snapshot();
  merge(); merge();
  assert.equal(snapshot(), before);
  sync.writeOwn();
  const own1 = JSON.stringify({ ...ownFile(), writtenAt: '' });
  merge();
  sync.writeOwn();
  assert.equal(JSON.stringify({ ...ownFile(), writtenAt: '' }), own1);
});

test('own file round-trips: another device reading it sees merged state', () => {
  sync.writeOwn();
  const f = ownFile();
  assert.equal(f.deviceId, LOCAL);
  assert.equal(f.books['one.epub'].progress, 0.9);
  assert.equal(f.books['two.epub'].meta.title, 'Edited Title');
});
