// SPDX-License-Identifier: AGPL-3.0-only
// Migrations from the project's former names (Bookread, Readloft). Pure functions, no side effects on import.
import fs from 'node:fs';
import path from 'node:path';

const DB_SUFFIXES = ['', '-wal', '-shm'];

function moveDb(from: string, to: string): void {
  for (const suffix of DB_SUFFIXES) {
    if (fs.existsSync(from + suffix)) fs.renameSync(from + suffix, to + suffix);
  }
}

/** Returns the path of libristead.db, moving a legacy readloft.db (preferred) or bookread.db into place first. */
export function migrateDbFile(dataDir: string): string {
  const dbPath = path.join(dataDir, 'libristead.db');
  if (fs.existsSync(dbPath)) return dbPath;
  for (const legacy of ['readloft.db', 'bookread.db']) {
    const legacyPath = path.join(dataDir, legacy);
    if (fs.existsSync(legacyPath)) {
      moveDb(legacyPath, dbPath);
      break;
    }
  }
  return dbPath;
}

/**
 * Sync folder: SYNC_DIR override wins; otherwise <library>/.libristead/sync, except that an existing legacy
 * <library>/.readloft is kept in use (not moved: other devices on the old version still write there).
 */
export function resolveSyncDir(libraryDir: string, envOverride?: string): string {
  if (envOverride) return path.resolve(envOverride);
  const next = path.join(libraryDir, '.libristead');
  const legacy = path.join(libraryDir, '.readloft');
  if (!fs.existsSync(next) && fs.existsSync(legacy)) {
    console.info(`Using legacy sync folder ${path.join(legacy, 'sync')} (found .readloft, no .libristead)`);
    return path.join(legacy, 'sync');
  }
  return path.join(next, 'sync');
}
