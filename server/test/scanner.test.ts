// SPDX-License-Identifier: AGPL-3.0-only
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeEpub, makePdf, makeFb2 } from './fixtures.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'libristead-scan-'));
const lib = path.join(root, 'library');
process.env.LIBRARY_DIR = lib;
process.env.DATA_DIR = path.join(root, 'data');
process.env.SYNC = '0';

const { ensureDirs } = await import('../src/config.ts');
const { db, migrate } = await import('../src/db.ts');
const { scanLibrary, formatOf, idFor } = await import('../src/scanner.ts');

before(() => { ensureDirs(); migrate(); });

const titles = () =>
  (db.prepare('SELECT title FROM books ORDER BY title').all() as unknown as { title: string }[]).map((r) => r.title);

test('formatOf recognises supported formats', () => {
  assert.equal(formatOf('a.EPUB'), 'epub');
  assert.equal(formatOf('a.fb2.zip'), 'fbz');
  assert.equal(formatOf('a.txt'), null);
});

test('scan: add, rescan unchanged, update, remove', async () => {
  fs.mkdirSync(path.join(lib, 'Sci-Fi'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'one.epub'), await makeEpub({ title: 'One' }));
  fs.writeFileSync(path.join(lib, 'Sci-Fi', 'two.pdf'), await makePdf('Two', 'Au Thor'));
  fs.writeFileSync(path.join(lib, 'three.fb2'), makeFb2());
  fs.writeFileSync(path.join(lib, 'notes.txt'), 'ignored');
  fs.writeFileSync(path.join(lib, '.hidden.epub'), 'ignored');

  let r = await scanLibrary();
  assert.deepEqual([r.added, r.updated, r.removed], [3, 0, 0]);
  assert.deepEqual(titles(), ['Fiction Title', 'One', 'Two']);
  const one = db.prepare('SELECT has_cover FROM books WHERE id = ?').get(idFor('one.epub')) as unknown as { has_cover: number };
  assert.equal(one.has_cover, 1);
  const shelf = db.prepare("SELECT name FROM shelves WHERE folder = 'Sci-Fi'").get() as unknown as { name: string } | undefined;
  assert.equal(shelf?.name, 'Sci-Fi');

  r = await scanLibrary();
  assert.deepEqual([r.added, r.updated, r.removed], [0, 0, 0]);

  fs.writeFileSync(path.join(lib, 'one.epub'), await makeEpub({ title: 'One Revised', authors: ['New Author'] }));
  r = await scanLibrary();
  assert.deepEqual([r.added, r.updated, r.removed], [0, 1, 0]);
  assert.ok(titles().includes('One Revised'));

  fs.unlinkSync(path.join(lib, 'Sci-Fi', 'two.pdf'));
  r = await scanLibrary();
  assert.deepEqual([r.added, r.updated, r.removed], [0, 0, 1]);
  assert.deepEqual(titles(), ['Fiction Title', 'One Revised']);
  assert.equal(db.prepare("SELECT 1 FROM shelves WHERE folder = 'Sci-Fi'").get(), undefined);
});

test('metadata_locked books keep edited metadata on rescan', async () => {
  db.prepare("UPDATE books SET title = 'Custom', metadata_locked = 1 WHERE id = ?").run(idFor('three.fb2'));
  fs.writeFileSync(path.join(lib, 'three.fb2'), makeFb2().replace('Fiction Title', 'Changed Title'));
  const r = await scanLibrary();
  assert.equal(r.updated, 1);
  const row = db.prepare('SELECT title FROM books WHERE id = ?').get(idFor('three.fb2')) as unknown as { title: string };
  assert.equal(row.title, 'Custom');
});
