// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { setupEnv } from './auth-helpers.ts';
import { fakePng, makeEpub } from './fixtures.ts';

setupEnv({ AUTH: 'password' });
const { ensureDirs, LIBRARY_DIR } = await import('../src/config.ts');
const { db, migrate } = await import('../src/db.ts');
const { saveCover } = await import('../src/covers.ts');
const { createApp } = await import('../src/app.ts');
const { ensureSetupCode } = await import('../src/auth.ts');
const { xmlEscape } = await import('../src/routes/opds.ts');
ensureDirs();
migrate();
const { app } = createApp({ getRemoteAddress: () => '10.0.0.5' });

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: (n) => n === 'entry' || n === 'link' });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const NASTY = `Tom & Jerry <b>"quoted"</b> it's`;
const NOW = new Date().toISOString();

function addBook(id: string, o: { title: string; authors?: string[]; series?: string; idx?: number; format?: string; cover?: boolean; status?: string; added?: string; file?: Uint8Array }) {
  const rel = `${id}.${o.format ?? 'epub'}`;
  if (o.file) fs.writeFileSync(path.join(LIBRARY_DIR, rel), o.file);
  db.prepare(`INSERT INTO books (id, path, format, title, authors, series, series_index, description, language, isbn, has_cover, file_size, added_at, updated_at, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, rel, o.format ?? 'epub', o.title, JSON.stringify(o.authors ?? ['Anon']), o.series ?? null, o.idx ?? null,
    `About ${o.title} & more <p>`, 'en', '9780306406157', o.cover ? 1 : 0, o.file?.length ?? 0, o.added ?? NOW, NOW, o.status ?? 'unread');
  if (o.cover) saveCover(id, fakePng(7), 'png');
}

const epub = await makeEpub({ title: 'x' });
addBook('aaaaaaaaaaaaaaa1', { title: NASTY, authors: ['Ann & Bob <Z>'], series: 'Saga "One"', idx: 2, cover: true, file: epub, status: 'reading' });
addBook('aaaaaaaaaaaaaaa2', { title: 'Alpha', authors: ['Zed Writer'], series: 'Saga "One"', idx: 1 });
addBook('aaaaaaaaaaaaaaa3', { title: 'Scan', authors: ['Zed Writer'], format: 'pdf' });
addBook('aaaaaaaaaaaaaaa4', { title: 'Mobi', format: 'mobi' });
addBook('aaaaaaaaaaaaaaa5', { title: 'Azw', format: 'azw3' });
addBook('aaaaaaaaaaaaaaa6', { title: 'Fb', format: 'fb2' });
addBook('aaaaaaaaaaaaaaa7', { title: 'Comic', format: 'cbz' });
db.prepare('INSERT INTO shelves (id, name, created_at) VALUES (?,?,?)').run('shelf1', 'Favs & "best"', NOW);
db.prepare('INSERT INTO shelf_books (shelf_id, book_id, added_at) VALUES (?,?,?)').run('shelf1', 'aaaaaaaaaaaaaaa2', NOW);

// Set up auth and mint an API token.
const code = ensureSetupCode()!;
const setup = await app.request('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, password: 'correct horse battery' }) });
const cookie = `libristead_session=${/libristead_session=([^;]+)/.exec(setup.headers.get('set-cookie')!)![1]}`;
const tokRes = await app.request('/api/auth/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'libristead', cookie }, body: JSON.stringify({ name: 'opds' }) });
const { token } = await tokRes.json();
const AUTH = { authorization: `Basic ${Buffer.from(`reader:${token}`).toString('base64')}` };
const get = (p: string, h: Record<string, string> = AUTH) => app.request(p, { headers: h });
async function feed(p: string) {
  const res = await get(p);
  assert.equal(res.status, 200, p);
  const j = parser.parse(await res.text());
  assert.ok(j.feed, p);
  return { res, feed: j.feed, entries: arr<any>(j.feed.entry), links: arr<any>(j.feed.link) };
}

test('requires auth', async () => {
  for (const p of ['/opds', '/opds/recent', '/opds/search?q=a', '/opds/opensearch.xml', '/opds/books/aaaaaaaaaaaaaaa1/file']) {
    const r = await get(p, {});
    assert.equal(r.status, 401, p);
    assert.match(r.headers.get('www-authenticate') ?? '', /Basic/);
  }
  assert.equal((await get('/opds', { authorization: `Bearer ${token}` })).status, 200);
  assert.equal((await get('/opds', { authorization: 'Basic ' + Buffer.from('x:lst_bad').toString('base64') })).status, 401);
});

test('xmlEscape', () => {
  assert.equal(xmlEscape(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
  assert.equal(xmlEscape('a\x01b'), 'ab');
});

test('root is a navigation feed with sections and search', async () => {
  const { res, feed: f, entries, links } = await feed('/opds');
  assert.match(res.headers.get('content-type')!, /kind=navigation/);
  assert.equal(entries.length, 6);
  const hrefs = entries.map((e) => arr<any>(e.link)[0]['@_href']);
  for (const h of ['/opds/recent', '/opds/reading', '/opds/authors', '/opds/series', '/opds/shelves', '/opds/all']) assert.ok(hrefs.includes(h), h);
  assert.equal(arr<any>(entries[0].link)[0]['@_type'], ACQ_TYPE);
  const search = links.find((l) => l['@_rel'] === 'search' && l['@_type'] === 'application/opensearchdescription+xml');
  assert.equal(search['@_href'], '/opds/opensearch.xml');
  assert.equal(f.title, 'Libristead');
  const os = parser.parse(await (await get('/opds/opensearch.xml')).text());
  assert.match(os.OpenSearchDescription.Url['@_template'], /\{searchTerms\}/);
});
const ACQ_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';

test('acquisition entries: links, MIME per format, escaping, metadata', async () => {
  const { res, entries, links } = await feed('/opds/all');
  assert.match(res.headers.get('content-type')!, /kind=acquisition/);
  assert.equal(entries.length, 7);
  assert.ok(links.some((l) => l['@_rel'] === 'search'));
  const byId = (id: string) => entries.find((e) => e.id === `urn:libristead:book:${id}`);
  const acq = (e: any) => arr<any>(e.link).find((l) => l['@_rel'] === 'http://opds-spec.org/acquisition');
  const want: Record<string, string> = {
    '1': 'application/epub+zip', '3': 'application/pdf', '4': 'application/x-mobipocket-ebook',
    '5': 'application/vnd.amazon.ebook', '6': 'application/x-fictionbook+xml', '7': 'application/vnd.comicbook+zip',
  };
  for (const [n, mime] of Object.entries(want)) assert.equal(acq(byId(`aaaaaaaaaaaaaaa${n}`))['@_type'], mime, n);
  const e1 = byId('aaaaaaaaaaaaaaa1');
  assert.equal(e1.title, NASTY);
  assert.equal(e1.author.name, 'Ann & Bob <Z>');
  assert.equal(e1['dc:language'], 'en');
  assert.equal(e1['calibre:series'], 'Saga "One"');
  assert.equal(acq(e1)['@_href'], '/opds/books/aaaaaaaaaaaaaaa1/file');
  const rels = arr<any>(e1.link).map((l) => l['@_rel']);
  assert.ok(rels.includes('http://opds-spec.org/image') && rels.includes('http://opds-spec.org/image/thumbnail'));
  assert.ok(!arr<any>(byId('aaaaaaaaaaaaaaa2').link).some((l) => String(l['@_rel']).includes('image')));
  assert.equal(entries[0].title, 'Alpha'); // title order
});

test('authors, series, shelves, reading, recent', async () => {
  const authors = await feed('/opds/authors');
  assert.match(authors.res.headers.get('content-type')!, /kind=navigation/);
  const names = authors.entries.map((e) => e.title);
  assert.ok(names.includes('Ann & Bob <Z>') && names.includes('Zed Writer'));
  const href = arr<any>(authors.entries.find((e) => e.title === 'Ann & Bob <Z>').link)[0]['@_href'];
  const a = await feed(href);
  assert.deepEqual(a.entries.map((e) => e.title), [NASTY]);
  const z = await feed('/opds/authors/Zed%20Writer');
  assert.equal(z.entries.length, 2);

  const series = await feed('/opds/series');
  assert.deepEqual(series.entries.map((e) => e.title), ['Saga "One"']);
  const s = await feed(arr<any>(series.entries[0].link)[0]['@_href']);
  assert.deepEqual(s.entries.map((e) => e.title), ['Alpha', NASTY]); // by series_index

  const shelves = await feed('/opds/shelves');
  assert.equal(shelves.entries[0].title, 'Favs & "best"');
  const sh = await feed(arr<any>(shelves.entries[0].link)[0]['@_href']);
  assert.deepEqual(sh.entries.map((e) => e.title), ['Alpha']);
  assert.equal((await get('/opds/shelves/nope')).status, 404);

  assert.deepEqual((await feed('/opds/reading')).entries.map((e) => e.title), [NASTY]);
  assert.equal((await feed('/opds/recent')).entries.length, 7);
});

test('search by title, author and series; escapes wildcard', async () => {
  assert.deepEqual((await feed('/opds/search?q=zed')).entries.map((e) => e.title).sort(), ['Alpha', 'Scan']);
  assert.equal((await feed('/opds/search?q=' + encodeURIComponent('tom & jerry'))).entries.length, 1);
  assert.equal((await feed('/opds/search?q=saga')).entries.length, 2);
  assert.equal((await feed('/opds/search?q=%25')).entries.length, 0);
  assert.equal((await feed('/opds/search')).entries.length, 0);
});

test('file download and cover', async () => {
  const f = await get('/opds/books/aaaaaaaaaaaaaaa1/file');
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'application/epub+zip');
  assert.match(f.headers.get('content-disposition')!, /^attachment; filename="aaaaaaaaaaaaaaa1\.epub"/);
  assert.deepEqual(new Uint8Array(await f.arrayBuffer()), epub);
  const c = await get('/opds/books/aaaaaaaaaaaaaaa1/cover');
  assert.equal(c.status, 200);
  assert.equal(c.headers.get('content-type'), 'image/png');
  assert.equal((await get('/opds/books/aaaaaaaaaaaaaaa2/cover')).status, 404);
});

test('pagination with more than 50 books', async () => {
  for (let i = 0; i < 60; i++) addBook(`bbbbbbbbbbbbb${String(i).padStart(3, '0')}`, { title: `Bulk ${String(i).padStart(2, '0')}`, authors: ['Bulk Author'] });
  const p1 = await feed('/opds/all');
  assert.equal(p1.entries.length, 50);
  const rel = (l: any[], r: string) => l.find((x) => x['@_rel'] === r)?.['@_href'];
  assert.equal(rel(p1.links, 'next'), '/opds/all?page=2');
  assert.equal(rel(p1.links, 'previous'), undefined);
  const p2 = await feed('/opds/all?page=2');
  assert.equal(p2.entries.length, 17);
  assert.equal(rel(p2.links, 'previous'), '/opds/all?page=1');
  assert.equal(rel(p2.links, 'first'), '/opds/all?page=1');
  assert.equal(rel(p2.links, 'next'), undefined);
  const s = await feed('/opds/search?q=bulk');
  assert.equal(rel(s.links, 'next'), '/opds/search?q=bulk&page=2');
  assert.equal((await feed('/opds/search?q=bulk&page=2')).entries.length, 10);
  const au = await feed('/opds/authors/Bulk%20Author?page=2');
  assert.equal(au.entries.length, 10);
});
