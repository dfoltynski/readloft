// SPDX-License-Identifier: AGPL-3.0-only
// OPDS 1.2 catalog (Atom). Mounted at /opds behind the same auth gate as /api.
import { Hono, type Context } from 'hono';
import { db, getBookRow, rowToBook, type BookRow } from '../db.ts';
import { findCover } from '../covers.ts';
import { HttpError, serveBookFile, serveCover } from './books.ts';

const PAGE_SIZE = 50;
const NAV = 'application/atom+xml;profile=opds-catalog;kind=navigation';
const ACQ = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const OPENSEARCH = 'application/opensearchdescription+xml';

/** MIME types advertised in acquisition links (and used for the download response). */
export const OPDS_MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  azw3: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  fbz: 'application/x-zip-compressed-fb2',
  cbz: 'application/vnd.comicbook+zip',
};

/** Escape text/attribute content; also drops characters that are illegal in XML 1.0. */
export function xmlEscape(s: unknown): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const esc = xmlEscape;
const enc = encodeURIComponent;

interface Link { rel?: string; href: string; type?: string; title?: string }
function linkXml(l: Link): string {
  return `<link${l.rel ? ` rel="${esc(l.rel)}"` : ''} href="${esc(l.href)}"${l.type ? ` type="${esc(l.type)}"` : ''}${l.title ? ` title="${esc(l.title)}"` : ''}/>`;
}

interface NavItem { id: string; title: string; href: string; content?: string; type?: string }

function feedXml(o: { id: string; title: string; kind: 'navigation' | 'acquisition'; self: string; links?: Link[]; entries: string[] }): string {
  const now = new Date().toISOString();
  const type = o.kind === 'navigation' ? NAV : ACQ;
  const links: Link[] = [
    { rel: 'self', href: o.self, type },
    { rel: 'start', href: '/opds', type: NAV },
    { rel: 'search', href: '/opds/opensearch.xml', type: OPENSEARCH, title: 'Search' },
    { rel: 'search', href: '/opds/search?q={searchTerms}', type: ACQ, title: 'Search' },
    ...(o.links ?? []),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:calibre="http://calibre.kovidgoyal.net/2009/metadata">
<id>${esc(o.id)}</id>
<title>${esc(o.title)}</title>
<updated>${now}</updated>
<author><name>Libristead</name></author>
${links.map(linkXml).join('\n')}
${o.entries.join('\n')}
</feed>
`;
}

function navEntry(n: NavItem): string {
  return `<entry><title>${esc(n.title)}</title><id>${esc(n.id)}</id><updated>${new Date().toISOString()}</updated>${n.content ? `<content type="text">${esc(n.content)}</content>` : ''}${linkXml({ rel: 'subsection', href: n.href, type: n.type ?? ACQ })}</entry>`;
}

function bookEntry(r: BookRow): string {
  const b = rowToBook(r);
  const mime = OPDS_MIME[b.format] ?? 'application/octet-stream';
  const parts: string[] = [
    `<title>${esc(b.title)}</title>`,
    `<id>urn:libristead:book:${esc(b.id)}</id>`,
    `<updated>${esc(b.updatedAt)}</updated>`,
  ];
  for (const a of b.authors) parts.push(`<author><name>${esc(a)}</name></author>`);
  if (b.description) parts.push(`<summary type="text">${esc(b.description)}</summary>`);
  if (b.language) parts.push(`<dc:language>${esc(b.language)}</dc:language>`);
  if (b.isbn) parts.push(`<dc:identifier>urn:isbn:${esc(b.isbn.replace(/[^0-9Xx]/g, '') || b.isbn)}</dc:identifier>`);
  if (b.publisher) parts.push(`<dc:publisher>${esc(b.publisher)}</dc:publisher>`);
  if (b.publishedAt) parts.push(`<published>${esc(b.publishedAt)}</published>`);
  if (b.series) {
    parts.push(`<calibre:series>${esc(b.series)}</calibre:series>`);
    if (b.seriesIndex !== null) parts.push(`<calibre:series_index>${esc(b.seriesIndex)}</calibre:series_index>`);
  }
  parts.push(linkXml({ rel: 'http://opds-spec.org/acquisition', href: `/opds/books/${b.id}/file`, type: mime }));
  const cover = b.hasCover ? findCover(b.id) : null;
  if (cover) {
    parts.push(linkXml({ rel: 'http://opds-spec.org/image', href: `/opds/books/${b.id}/cover`, type: cover.mime }));
    parts.push(linkXml({ rel: 'http://opds-spec.org/image/thumbnail', href: `/opds/books/${b.id}/cover`, type: cover.mime }));
  }
  return `<entry>\n${parts.join('\n')}\n</entry>`;
}

function pageOf(c: Context): number {
  const n = Number.parseInt(c.req.query('page') ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** rel=first/previous/next links for `base` (path with optional query, e.g. "/opds/search?q=x"). */
function pagingLinks(base: string, page: number, total: number, type: string): Link[] {
  const sep = base.includes('?') ? '&' : '?';
  const href = (p: number) => `${base}${sep}page=${p}`;
  const last = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const out: Link[] = [];
  if (page > 1) {
    out.push({ rel: 'first', href: href(1), type });
    out.push({ rel: 'previous', href: href(page - 1), type });
  }
  if (page < last) {
    out.push({ rel: 'next', href: href(page + 1), type });
    out.push({ rel: 'last', href: href(last), type });
  }
  return out;
}

function escLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

function bookFeed(c: Context, o: { id: string; title: string; path: string; where?: string; params?: (string | number)[]; order: string }): Response {
  const page = pageOf(c);
  const where = o.where ? `WHERE ${o.where}` : '';
  const params = o.params ?? [];
  const total = (db.prepare(`SELECT COUNT(*) n FROM books b ${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`SELECT b.* FROM books b ${where} ORDER BY ${o.order} LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE) as unknown as BookRow[];
  const self = page > 1 ? `${o.path}${o.path.includes('?') ? '&' : '?'}page=${page}` : o.path;
  return xml(c, feedXml({ id: o.id, title: o.title, kind: 'acquisition', self, links: pagingLinks(o.path, page, total, ACQ), entries: rows.map(bookEntry) }), ACQ);
}

function navFeed(c: Context, o: { id: string; title: string; path: string; items: NavItem[]; paginate?: boolean }): Response {
  const page = o.paginate ? pageOf(c) : 1;
  const items = o.paginate ? o.items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : o.items;
  const self = page > 1 ? `${o.path}?page=${page}` : o.path;
  return xml(c, feedXml({
    id: o.id, title: o.title, kind: 'navigation', self,
    links: o.paginate ? pagingLinks(o.path, page, o.items.length, NAV) : [],
    entries: items.map(navEntry),
  }), NAV);
}

function xml(c: Context, body: string, type: string): Response {
  return c.body(body, 200, { 'Content-Type': `${type};charset=utf-8`, 'Cache-Control': 'no-store' });
}

const TITLE_ORDER = 'b.title COLLATE NOCASE ASC, b.id ASC';
const BOOKS_AUTHORS = `SELECT j.value AS name, COUNT(*) AS n FROM books b, json_each(b.authors) j WHERE j.type = 'text' AND j.value != '' GROUP BY j.value ORDER BY j.value COLLATE NOCASE`;

export const opds = new Hono();

opds.get('/', (c) => {
  const items: NavItem[] = [
    { id: 'urn:libristead:opds:recent', title: 'Recently added', href: '/opds/recent', content: 'Newest books first' },
    { id: 'urn:libristead:opds:reading', title: 'Currently reading', href: '/opds/reading', content: 'Books you have started' },
    { id: 'urn:libristead:opds:authors', title: 'Authors', href: '/opds/authors', type: NAV, content: 'Browse by author' },
    { id: 'urn:libristead:opds:series', title: 'Series', href: '/opds/series', type: NAV, content: 'Browse by series' },
    { id: 'urn:libristead:opds:shelves', title: 'Shelves', href: '/opds/shelves', type: NAV, content: 'Your shelves' },
    { id: 'urn:libristead:opds:all', title: 'All books', href: '/opds/all', content: 'Everything, sorted by title' },
  ];
  return navFeed(c, { id: 'urn:libristead:opds:root', title: 'Libristead', path: '/opds', items });
});

opds.get('/opensearch.xml', (c) => c.body(
  `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
<ShortName>Libristead</ShortName>
<Description>Search the Libristead library</Description>
<InputEncoding>UTF-8</InputEncoding>
<Url type="${ACQ}" rel="results" template="/opds/search?q={searchTerms}"/>
</OpenSearchDescription>
`, 200, { 'Content-Type': `${OPENSEARCH};charset=utf-8` }));

opds.get('/recent', (c) => bookFeed(c, {
  id: 'urn:libristead:opds:recent', title: 'Recently added', path: '/opds/recent', order: 'b.added_at DESC, b.id ASC',
}));

opds.get('/reading', (c) => bookFeed(c, {
  id: 'urn:libristead:opds:reading', title: 'Currently reading', path: '/opds/reading',
  where: `b.status = 'reading'`, order: 'b.last_opened_at DESC NULLS LAST, b.id ASC',
}));

opds.get('/all', (c) => bookFeed(c, { id: 'urn:libristead:opds:all', title: 'All books', path: '/opds/all', order: TITLE_ORDER }));

opds.get('/authors', (c) => {
  const rows = db.prepare(BOOKS_AUTHORS).all() as unknown as { name: string; n: number }[];
  return navFeed(c, {
    id: 'urn:libristead:opds:authors', title: 'Authors', path: '/opds/authors', paginate: true,
    items: rows.map((r) => ({ id: `urn:libristead:opds:author:${r.name}`, title: r.name, href: `/opds/authors/${enc(r.name)}`, content: `${r.n} book${r.n === 1 ? '' : 's'}` })),
  });
});

opds.get('/authors/:name', (c) => {
  const name = c.req.param('name');
  return bookFeed(c, {
    id: `urn:libristead:opds:author:${name}`, title: name, path: `/opds/authors/${enc(name)}`,
    where: 'EXISTS (SELECT 1 FROM json_each(b.authors) j WHERE j.value = ?)', params: [name],
    order: 'b.series COLLATE NOCASE ASC NULLS LAST, b.series_index ASC NULLS LAST, b.title COLLATE NOCASE ASC, b.id ASC',
  });
});

opds.get('/series', (c) => {
  const rows = db.prepare(`SELECT series AS name, COUNT(*) AS n FROM books WHERE series IS NOT NULL AND series != '' GROUP BY series ORDER BY series COLLATE NOCASE`).all() as unknown as { name: string; n: number }[];
  return navFeed(c, {
    id: 'urn:libristead:opds:series', title: 'Series', path: '/opds/series', paginate: true,
    items: rows.map((r) => ({ id: `urn:libristead:opds:series:${r.name}`, title: r.name, href: `/opds/series/${enc(r.name)}`, content: `${r.n} book${r.n === 1 ? '' : 's'}` })),
  });
});

opds.get('/series/:name', (c) => {
  const name = c.req.param('name');
  return bookFeed(c, {
    id: `urn:libristead:opds:series:${name}`, title: name, path: `/opds/series/${enc(name)}`,
    where: 'b.series = ?', params: [name], order: 'b.series_index ASC NULLS LAST, b.title COLLATE NOCASE ASC, b.id ASC',
  });
});

opds.get('/shelves', (c) => {
  const rows = db.prepare(`SELECT s.id, s.name, (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = s.id) AS n FROM shelves s ORDER BY s.name COLLATE NOCASE`).all() as unknown as { id: string; name: string; n: number }[];
  return navFeed(c, {
    id: 'urn:libristead:opds:shelves', title: 'Shelves', path: '/opds/shelves', paginate: true,
    items: rows.map((r) => ({ id: `urn:libristead:opds:shelf:${r.id}`, title: r.name, href: `/opds/shelves/${enc(r.id)}`, content: `${r.n} book${r.n === 1 ? '' : 's'}` })),
  });
});

opds.get('/shelves/:id', (c) => {
  const id = c.req.param('id');
  const shelf = db.prepare('SELECT name FROM shelves WHERE id = ?').get(id) as { name: string } | undefined;
  if (!shelf) throw new HttpError(404, 'shelf not found');
  return bookFeed(c, {
    id: `urn:libristead:opds:shelf:${id}`, title: shelf.name, path: `/opds/shelves/${enc(id)}`,
    where: 'b.id IN (SELECT book_id FROM shelf_books WHERE shelf_id = ?)', params: [id], order: TITLE_ORDER,
  });
});

opds.get('/search', (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const like = `%${escLike(q)}%`;
  return bookFeed(c, {
    id: `urn:libristead:opds:search:${q}`, title: `Search: ${q}`, path: `/opds/search?q=${enc(q)}`,
    where: q ? `(b.title LIKE ? ESCAPE '\\' OR b.authors LIKE ? ESCAPE '\\' OR b.series LIKE ? ESCAPE '\\')` : '0',
    params: q ? [like, like, like] : [], order: TITLE_ORDER,
  });
});

opds.get('/books/:id/file', (c) => {
  const id = c.req.param('id');
  const row = getBookRow(id);
  return serveBookFile(c, id, { mime: row ? OPDS_MIME[row.format] : undefined, disposition: 'attachment' });
});
opds.get('/books/:id/cover', (c) => serveCover(c, c.req.param('id')));

opds.all('*', (c) => c.json({ error: 'not found' }, 404));

