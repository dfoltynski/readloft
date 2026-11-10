import fs from 'node:fs';
import path from 'node:path';
import { COVERS_DIR } from './config.ts';

export const COVER_MIME: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};

export function removeCover(id: string): void {
  for (const ext of Object.keys(COVER_MIME)) {
    try { fs.unlinkSync(path.join(COVERS_DIR, `${id}.${ext}`)); } catch { /* none */ }
  }
}

export function saveCover(id: string, data: Uint8Array, ext: string): void {
  removeCover(id);
  fs.writeFileSync(path.join(COVERS_DIR, `${id}.${ext}`), data);
}

export function findCover(id: string): { file: string; mime: string; mtimeMs: number; size: number } | null {
  if (!/^[0-9a-f]{16}$/.test(id)) return null;
  for (const [ext, mime] of Object.entries(COVER_MIME)) {
    const file = path.join(COVERS_DIR, `${id}.${ext}`);
    try {
      const st = fs.statSync(file);
      return { file, mime, mtimeMs: st.mtimeMs, size: st.size };
    } catch { /* next */ }
  }
  return null;
}
