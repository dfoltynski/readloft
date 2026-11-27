// SPDX-License-Identifier: AGPL-3.0-only
// Generated-in-code book fixtures shared by the tests. No binary blobs.
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

/** Smallest thing detectImageExt accepts: PNG magic plus padding. */
export function fakePng(tag = 0): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b[31] = tag;
  return b;
}

export interface EpubOpts { title?: string; authors?: string[]; series?: string; index?: number; lang?: string; cover?: boolean }

export async function makeEpub(o: EpubOpts = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const creators = (o.authors ?? ['Jane Doe']).map((a) => `<dc:creator>${a}</dc:creator>`).join('');
  const series = o.series
    ? `<meta name="calibre:series" content="${o.series}"/><meta name="calibre:series_index" content="${o.index ?? 1}"/>` : '';
  zip.file('OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:title>${o.title ?? 'Test Book'}</dc:title>${creators}<dc:language>${o.lang ?? 'en'}</dc:language>
<dc:identifier opf:scheme="ISBN">9780306406157</dc:identifier>${series}${o.cover === false ? '' : '<meta name="cover" content="cover-img"/>'}
</metadata><manifest><item id="cover-img" href="images/cover.png" media-type="image/png"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  zip.file('OEBPS/c1.xhtml', '<html><body><p>Hello</p></body></html>');
  if (o.cover !== false) zip.file('OEBPS/images/cover.png', fakePng(1));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function makePdf(title: string, author: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.setTitle(title);
  doc.setAuthor(author);
  return doc.save();
}

export function makeFb2(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Fiction Title</book-title><lang>pl</lang>
<sequence name="Saga" number="3"/>
<coverpage><image l:href="#cov.png"/></coverpage>
</title-info></description><body><section><p>x</p></section></body>
<binary id="cov.png" content-type="image/png">${Buffer.from(fakePng(2)).toString('base64')}</binary>
</FictionBook>`;
}

export async function makeCbz(names: string[], comicInfo?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  names.forEach((n, i) => zip.file(n, fakePng(10 + i)));
  if (comicInfo) zip.file('ComicInfo.xml', comicInfo);
  return zip.generateAsync({ type: 'uint8array' });
}

/** Minimal PalmDB + MOBI record 0 with EXTH (author 100, cover offset 201, language 524) and one image record. */
export function makeMobi(o: { name: string; fullTitle: string; author: string; lang: string }): Uint8Array {
  const hdrLen = 232;
  const exth = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32BE(type, 0); h.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([h, data]);
  };
  const off = Buffer.alloc(4); off.writeUInt32BE(0);
  const recs = [exth(100, Buffer.from(o.author)), exth(524, Buffer.from(o.lang)), exth(201, off)];
  const exthBody = Buffer.concat(recs);
  const exthHdr = Buffer.alloc(12);
  exthHdr.write('EXTH', 0, 'latin1');
  exthHdr.writeUInt32BE(12 + exthBody.length, 4);
  exthHdr.writeUInt32BE(recs.length, 8);
  const exthBuf = Buffer.concat([exthHdr, exthBody]);
  const nameBuf = Buffer.from(o.fullTitle, 'utf8');
  const r0 = Buffer.alloc(16 + hdrLen + exthBuf.length + nameBuf.length);
  r0.write('MOBI', 16, 'latin1');
  r0.writeUInt32BE(hdrLen, 20);
  r0.writeUInt32BE(65001, 28);
  r0.writeUInt32BE(16 + hdrLen + exthBuf.length, 84);
  r0.writeUInt32BE(nameBuf.length, 88);
  r0.writeUInt32BE(1, 0x6c); // first image record
  r0.writeUInt32BE(0x40, 0x80); // has EXTH
  exthBuf.copy(r0, 16 + hdrLen);
  nameBuf.copy(r0, 16 + hdrLen + exthBuf.length);
  const img = Buffer.from(fakePng(3));
  const head = Buffer.alloc(78 + 2 * 8);
  head.write(o.name, 0, 'latin1');
  head.writeUInt16BE(2, 76);
  head.writeUInt32BE(head.length, 78);
  head.writeUInt32BE(head.length + r0.length, 78 + 8);
  return new Uint8Array(Buffer.concat([head, r0, img]));
}
