import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PORT = Number(process.env.PORT) || 8080;
export const LIBRARY_DIR = path.resolve(process.env.LIBRARY_DIR || './books');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const COVERS_DIR = path.join(DATA_DIR, 'covers');
export const UPLOADS_DIR = path.join(LIBRARY_DIR, 'uploads');
export const WEB_DIST = path.resolve(process.env.WEB_DIST || path.join(serverDir, '../web/dist'));
const si = process.env.SCAN_INTERVAL_MINUTES;
export const SCAN_INTERVAL_MINUTES = si === undefined || si === '' ? 30 : Number(si) || 0;

export function ensureDirs(): void {
  for (const d of [LIBRARY_DIR, DATA_DIR, COVERS_DIR, UPLOADS_DIR]) fs.mkdirSync(d, { recursive: true });
}

/** Resolve a library-relative path; returns null if it escapes LIBRARY_DIR. */
export function safeLibraryPath(rel: string): string | null {
  const abs = path.resolve(LIBRARY_DIR, rel);
  if (abs !== LIBRARY_DIR && !abs.startsWith(LIBRARY_DIR + path.sep)) return null;
  return abs;
}
