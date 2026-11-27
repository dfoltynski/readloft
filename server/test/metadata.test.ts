// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractMetadata } from '../src/metadata/index.ts';
import { extractMobi } from '../src/metadata/mobi.ts';
import { fallbackMeta, splitAuthors, detectImageExt } from '../src/metadata/util.ts';
import { fakePng, makeEpub, makePdf, makeFb2, makeCbz, makeMobi } from './fixtures.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libristead-meta-'));
function put(name: string, data: Uint8Array | string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
}

test('epub: title, authors, series, language, isbn, cover', async () => {
  const p = put('a.epub', await makeEpub({ title: 'The Epub', authors: ['Jane Doe', 'John Roe'], series: 'Cycle', index: 2.5, lang: 'de' }));
  const m = await extractMetadata(p, 'epub');
  assert.equal(m.title, 'The Epub');
  assert.deepEqual(m.authors, ['Jane Doe', 'John Roe']);
  assert.equal(m.series, 'Cycle');
  assert.equal(m.seriesIndex, 2.5);
  assert.equal(m.language, 'de');
  assert.equal(m.isbn, '9780306406157');
  assert.equal(m.cover?.ext, 'png');
  assert.deepEqual([...m.cover!.data], [...fakePng(1)]);
});

test('epub: no cover declared -> no cover, no series', async () => {
  const p = put('b.epub', await makeEpub({ cover: false }));
  const m = await extractMetadata(p, 'epub');
  assert.equal(m.cover ?? null, null);
  assert.equal(m.series ?? null, null);
});

test('epub: broken file falls back to filename', async () => {
  const p = put('Some Author - Broken Title.epub', 'not a zip');
  const m = await extractMetadata(p, 'epub');
  assert.equal(m.title, 'Broken Title');
  assert.deepEqual(m.authors, ['Some Author']);
});

test('pdf: title and authors', async () => {
  const p = put('a.pdf', await makePdf('PDF Title', 'Ann One, Bob Two'));
  const m = await extractMetadata(p, 'pdf');
  assert.equal(m.title, 'PDF Title');
  assert.deepEqual(m.authors, ['Ann One', 'Bob Two']);
  assert.equal(m.cover ?? null, null);
});

test('fb2: title, author, series, language, cover', async () => {
  const p = put('a.fb2', makeFb2());
  const m = await extractMetadata(p, 'fb2');
  assert.equal(m.title, 'Fiction Title');
  assert.deepEqual(m.authors, ['Ann Writer']);
  assert.equal(m.series, 'Saga');
  assert.equal(m.seriesIndex, 3);
  assert.equal(m.language, 'pl');
  assert.equal(m.cover?.ext, 'png');
});

test('fbz: fb2 inside zip', async () => {
  const JSZip = (await import('jszip')).default;
  const z = new JSZip();
  z.file('book.fb2', makeFb2());
  const p = put('a.fb2.zip', await z.generateAsync({ type: 'uint8array' }));
  const m = await extractMetadata(p, 'fbz');
  assert.equal(m.title, 'Fiction Title');
  assert.equal(m.series, 'Saga');
});

test('cbz: first image in natural order is the cover; ComicInfo fields', async () => {
  const info = `<ComicInfo><Title>Issue Ten</Title><Series>Heroes</Series><Number>10</Number><Writer>Al Writer; Bo Writer</Writer><LanguageISO>en</LanguageISO></ComicInfo>`;
  const p = put('a.cbz', await makeCbz(['p10.png', 'p2.png', 'p1.png'], info));
  const m = await extractMetadata(p, 'cbz');
  assert.equal(m.title, 'Issue Ten');
  assert.equal(m.series, 'Heroes');
  assert.equal(m.seriesIndex, 10);
  assert.deepEqual(m.authors, ['Al Writer', 'Bo Writer']);
  assert.equal(m.language, 'en');
  assert.deepEqual([...m.cover!.data], [...fakePng(12)]); // p1.png is third entry
});

test('cbz: no ComicInfo -> filename title, still has cover', async () => {
  const p = put('My Comic.cbz', await makeCbz(['001.png']));
  const m = await extractMetadata(p, 'cbz');
  assert.equal(m.title, 'My Comic');
  assert.ok(m.cover);
});

test('mobi: title, author, language, cover from EXTH', async () => {
  const bytes = makeMobi({ name: 'short_name', fullTitle: 'Mobi Full Title', author: 'Mo Bi', lang: 'en' });
  const m = await extractMobi(bytes);
  assert.equal(m.title, 'Mobi Full Title');
  assert.deepEqual(m.authors, ['Mo Bi']);
  assert.equal(m.language, 'en');
  assert.equal(m.cover?.ext, 'png');
  const viaIndex = await extractMetadata(put('a.azw3', bytes), 'azw3');
  assert.equal(viaIndex.title, 'Mobi Full Title');
});

test('mobi: truncated input is tolerated', async () => {
  assert.deepEqual(await extractMobi(new Uint8Array(10)), {});
});

test('util helpers', () => {
  assert.deepEqual(splitAuthors('A One & B Two; C Three and D Four'), ['A One', 'B Two', 'C Three', 'D Four']);
  assert.deepEqual(fallbackMeta('/x/Foo_Bar - Baz_Qux.fb2.zip'), { title: 'Baz Qux', authors: ['Foo Bar'] });
  assert.equal(detectImageExt(fakePng()), 'png');
  assert.equal(detectImageExt(new Uint8Array(20)), null);
});
