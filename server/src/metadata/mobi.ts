import { toCover, splitAuthors, type ExtractedMeta } from './util.ts';

function dec(buf: Buffer, enc: number): string {
  return enc === 65001 ? buf.toString('utf8') : buf.toString('latin1');
}

export async function extractMobi(bytes: Uint8Array): Promise<ExtractedMeta> {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ExtractedMeta = {};
  if (b.length < 80) return out;
  const palmName = b.subarray(0, 32).toString('latin1').replace(/\0.*$/s, '').replace(/[_]/g, ' ').trim();
  if (palmName) out.title = palmName;
  const numRecs = b.readUInt16BE(76);
  const offs: number[] = [];
  for (let i = 0; i < numRecs; i++) {
    const p = 78 + i * 8;
    if (p + 4 > b.length) break;
    offs.push(b.readUInt32BE(p));
  }
  if (!offs.length) return out;
  const rec = (i: number) => b.subarray(offs[i], i + 1 < offs.length ? offs[i + 1] : b.length);
  const r0 = rec(0);
  if (r0.length < 132 || r0.toString('latin1', 16, 20) !== 'MOBI') return out;
  const hdrLen = r0.readUInt32BE(20);
  const enc = r0.readUInt32BE(28);
  const fullNameOff = r0.readUInt32BE(84);
  const fullNameLen = r0.readUInt32BE(88);
  if (fullNameOff && fullNameLen && fullNameOff + fullNameLen <= r0.length) {
    const t = dec(r0.subarray(fullNameOff, fullNameOff + fullNameLen), enc).trim();
    if (t) out.title = t;
  }
  const firstImage = r0.length >= 0x70 ? r0.readUInt32BE(0x6c) : 0xffffffff;
  const exthFlags = r0.readUInt32BE(0x80);
  if (exthFlags & 0x40) {
    const ep = 16 + hdrLen;
    if (r0.toString('latin1', ep, ep + 4) === 'EXTH') {
      const count = r0.readUInt32BE(ep + 8);
      let p = ep + 12;
      const authors: string[] = [];
      let coverOffset: number | null = null;
      for (let i = 0; i < count && p + 8 <= r0.length; i++) {
        const type = r0.readUInt32BE(p);
        const len = r0.readUInt32BE(p + 4);
        if (len < 8) break;
        const data = r0.subarray(p + 8, p + len);
        p += len;
        const s = () => dec(data, enc).trim();
        switch (type) {
          case 100: authors.push(...splitAuthors(s())); break;
          case 101: out.publisher = s() || null; break;
          case 103: out.description = s() || null; break;
          case 104: out.isbn = s() || null; break;
          case 106: out.publishedAt = s() || null; break;
          case 503: if (s()) out.title = s(); break;
          case 524: out.language = s() || null; break;
          case 201: if (data.length >= 4) coverOffset = data.readUInt32BE(0); break;
        }
      }
      if (authors.length) out.authors = authors;
      if (coverOffset !== null && firstImage !== 0xffffffff) {
        const idx = firstImage + coverOffset;
        if (idx < offs.length) out.cover = toCover(new Uint8Array(rec(idx)));
      }
    }
  }
  return out;
}
