import { execFile, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

const DATALESS = 0x40000000;
const inflight = new Map<string, number>();

export function cloudProvider(abs: string): string | null {
  if (abs.includes('/Library/Mobile Documents/')) return 'iCloud Drive';
  const m = abs.match(/\/Library\/CloudStorage\/([^/]+)/);
  if (m) {
    const dir = m[1]!;
    if (/^dropbox/i.test(dir)) return 'Dropbox';
    if (/^onedrive/i.test(dir)) return 'OneDrive';
    if (/^googledrive/i.test(dir)) return 'Google Drive';
    if (/^box/i.test(dir)) return 'Box';
    return dir;
  }
  return null;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

export async function isOffloaded(abs: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    try {
      const out = await run('/usr/bin/stat', ['-f', '%Xf', '--', abs]);
      const flags = parseInt(out.trim(), 16);
      return Number.isFinite(flags) && (flags & DATALESS) !== 0;
    } catch {
      // File missing: legacy iCloud placeholder `.<name>.icloud`?
      const ph = path.join(path.dirname(abs), `.${path.basename(abs)}.icloud`);
      await fsp.access(ph);
      return true;
    }
  } catch {
    return false;
  }
}

export function isDownloading(abs: string): boolean {
  return inflight.has(abs);
}

export function clearDownload(abs: string): void {
  inflight.delete(abs);
}

/** Idempotent; re-kicks the download if the previous request is older than 20s (e.g. it was dropped). */
export function startDownload(abs: string): void {
  const prev = inflight.get(abs);
  if (prev && Date.now() - prev < 20_000) return;
  inflight.set(abs, Date.now());
  const provider = cloudProvider(abs);
  if (provider === 'iCloud Drive') {
    execFile('/usr/bin/brctl', ['download', abs], { timeout: 15000 }, (err) => {
      if (err) console.warn(`[cloud] brctl download failed: ${err.message}`);
    });
  } else {
    // Reading the first byte makes the File Provider materialize the file.
    void (async () => {
      let fh: fsp.FileHandle | undefined;
      try {
        fh = await fsp.open(abs, 'r');
        await fh.read(Buffer.alloc(1), 0, 1, 0);
      } catch (e) {
        console.warn(`[cloud] download trigger failed: ${(e as Error).message}`);
      } finally {
        await fh?.close().catch(() => {});
      }
    })();
  }
}

const pctCache = new Map<string, { at: number; value: number | null }>();

export function icloudPercent(abs: string): Promise<number | null> {
  const hit = pctCache.get(abs);
  if (hit && Date.now() - hit.at < 800) return Promise.resolve(hit.value);
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* ignore */ }
      const value = parsePercent(out, path.basename(abs));
      pctCache.set(abs, { at: Date.now(), value });
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('/usr/bin/brctl', ['monitor', '-p', path.dirname(abs)], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(finish, 3000);
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes('gathering done')) finish();
    });
    child.on('error', finish);
    child.on('close', finish);
  });
}

function parsePercent(out: string, base: string): number | null {
  try {
    for (const line of out.split('\n')) {
      if (!line.includes(` /${base}`)) continue;
      const m = line.match(/↓[^%]*?(\d+(?:\.\d+)?)%/);
      if (m) return Math.min(100, Math.max(0, Number(m[1])));
    }
  } catch { /* ignore */ }
  return null;
}
