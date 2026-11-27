// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveSyncDir } from './legacy.ts';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}
export const VERSION = process.env.LIBRISTEAD_VERSION || readVersion();

export const PORT = Number(process.env.PORT) || 8080;
export const HOST = process.env.HOST || '0.0.0.0';
export const LIBRARY_DIR = path.resolve(process.env.LIBRARY_DIR || './books');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const COVERS_DIR = path.join(DATA_DIR, 'covers');
export const UPLOADS_DIR = path.join(LIBRARY_DIR, 'uploads');
export const WEB_DIST = path.resolve(process.env.WEB_DIST || path.join(serverDir, '../web/dist'));
export const SYNC_ENABLED = process.env.SYNC !== '0';
export const SYNC_DIR = resolveSyncDir(LIBRARY_DIR, process.env.SYNC_DIR);
const si = process.env.SCAN_INTERVAL_MINUTES;
export const SCAN_INTERVAL_MINUTES = si === undefined || si === '' ? 30 : Number(si) || 0;


export type AuthModeName = 'password' | 'proxy' | 'none';
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', '[::1]', 'localhost'];
export const isLoopbackHost = (h: string): boolean => LOOPBACK_HOSTS.includes(h.toLowerCase());

function configFail(msg: string): never {
  console.error(`[config] ${msg}`);
  process.exit(1);
}

const authRaw = (process.env.AUTH || 'password').toLowerCase();
if (authRaw !== 'password' && authRaw !== 'proxy' && authRaw !== 'none') configFail(`AUTH must be password, proxy or none (got "${authRaw}")`);
export const AUTH: AuthModeName = authRaw;
if (AUTH === 'none' && !isLoopbackHost(HOST)) {
  configFail(`AUTH=none is only allowed when HOST is a loopback address (127.0.0.1, ::1, localhost); HOST=${HOST}. Use AUTH=password or AUTH=proxy.`);
}
export const AUTH_PROXY_HEADER = process.env.AUTH_PROXY_HEADER || 'Remote-User';
export const AUTH_TRUSTED_PROXIES: string[] = (process.env.AUTH_TRUSTED_PROXIES || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (AUTH === 'proxy' && AUTH_TRUSTED_PROXIES.length === 0) {
  configFail('AUTH=proxy requires AUTH_TRUSTED_PROXIES (comma-separated IPs of your reverse proxy).');
}
/** Honour X-Forwarded-Proto / X-Forwarded-For from a reverse proxy in front of the server. */
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';

export function ensureDirs(): void {
  for (const d of [LIBRARY_DIR, DATA_DIR, COVERS_DIR, UPLOADS_DIR]) fs.mkdirSync(d, { recursive: true });
}

/** Resolve a library-relative path; returns null if it escapes LIBRARY_DIR. */
export function safeLibraryPath(rel: string): string | null {
  const abs = path.resolve(LIBRARY_DIR, rel);
  if (abs !== LIBRARY_DIR && !abs.startsWith(LIBRARY_DIR + path.sep)) return null;
  return abs;
}
