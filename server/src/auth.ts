// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { ApiToken, AuthStatus, CreatedApiToken } from '../../shared/types.ts';
import { AUTH, AUTH_PROXY_HEADER, AUTH_TRUSTED_PROXIES, DATA_DIR, TRUST_PROXY, isLoopbackHost } from './config.ts';
import { db } from './db.ts';

export const SESSION_COOKIE = 'libristead_session';
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'libristead';
const SESSION_MAX_AGE_S = 30 * 24 * 3600;
const SESSION_TOUCH_MS = 3600_000;
const TOKEN_TOUCH_MS = 5 * 60_000;
const MIN_PASSWORD = 10;
const SETUP_CODE_FILE = path.join(DATA_DIR, 'setup-code');

export type RemoteAddressGetter = (c: Context) => string | undefined;

type AuthVia = 'cookie' | 'token' | 'proxy' | 'none';
type Env = { Variables: { authVia: AuthVia; sessionHash: string } };

const defaultRemote: RemoteAddressGetter = (c) => {
  try { return getConnInfo(c).remote.address; } catch { return undefined; }
};

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
const now = (): string => new Date().toISOString();

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- password hashing ----------

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  try {
    const expected = Buffer.from(parts[5], 'base64');
    const key = await scrypt(password, Buffer.from(parts[4], 'base64'), N, r, p);
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// ---------- user / setup code ----------

const hasUser = (): boolean => !!db.prepare('SELECT 1 FROM auth_user WHERE id = 1').get();

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const normalizeCode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Password mode, first run: create a fresh one-time setup code, store only its hash
 * in DATA_DIR/setup-code (0600) and return the plaintext for logging. Null when a user exists.
 */
export function ensureSetupCode(): string | null {
  if (hasUser()) {
    try { fs.rmSync(SETUP_CODE_FILE, { force: true }); } catch { /* ignore */ }
    return null;
  }
  const bytes = crypto.randomBytes(10);
  let code = '';
  for (const b of bytes) code += B32[b % 32];
  fs.writeFileSync(SETUP_CODE_FILE, sha256(code) + '\n', { mode: 0o600 });
  fs.chmodSync(SETUP_CODE_FILE, 0o600);
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function printSetupCode(code: string): void {
  console.log([
    '',
    '================ Libristead first-run setup ================',
    `  Setup code: ${code}`,
    '  Open the web UI and enter this code with the password you',
    '  want to use. The code is valid until you finish setup and',
    '  changes on every restart. Docker: docker logs libristead',
    '=============================================================',
    '',
  ].join('\n'));
}

function setupCodeMatches(code: string): boolean {
  let stored: string;
  try { stored = fs.readFileSync(SETUP_CODE_FILE, 'utf8').trim(); } catch { return false; }
  if (!/^[0-9a-f]{64}$/.test(stored)) return false;
  return safeEqual(sha256(normalizeCode(code)), stored);
}

/** Used by the reset-password CLI. */
export function resetAuth(): void {
  db.exec('DELETE FROM auth_user; DELETE FROM sessions;');
}

// ---------- rate limiting ----------

const WINDOW_MS = 15 * 60_000;
const PER_IP_MAX = 5;
const GLOBAL_MAX = 50;
interface Bucket { count: number; resetAt: number }
const ipBuckets = new Map<string, Bucket>();
const globalBucket: Bucket = { count: 0, resetAt: 0 };

function liveBucket(b: Bucket, t: number): Bucket {
  if (b.resetAt <= t) { b.count = 0; b.resetAt = 0; }
  return b;
}

/** Seconds to wait if blocked, else 0. */
function blockedFor(ip: string, t = Date.now()): number {
  const g = liveBucket(globalBucket, t);
  if (g.count >= GLOBAL_MAX) return Math.ceil((g.resetAt - t) / 1000);
  const b = ipBuckets.get(ip);
  if (b && liveBucket(b, t).count >= PER_IP_MAX) return Math.ceil((b.resetAt - t) / 1000);
  return 0;
}

function recordFailure(ip: string, t = Date.now()): void {
  for (const [k, v] of ipBuckets) if (v.resetAt <= t) ipBuckets.delete(k);
  const b = liveBucket(ipBuckets.get(ip) ?? { count: 0, resetAt: 0 }, t);
  if (!b.resetAt) b.resetAt = t + WINDOW_MS;
  b.count++;
  ipBuckets.set(ip, b);
  const g = liveBucket(globalBucket, t);
  if (!g.resetAt) g.resetAt = t + WINDOW_MS;
  g.count++;
}

/** Test helper. */
export function resetRateLimits(): void {
  ipBuckets.clear();
  globalBucket.count = 0;
  globalBucket.resetAt = 0;
}

// ---------- sessions ----------

function isHttps(c: Context): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true;
  return TRUST_PROXY && (c.req.header('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() === 'https';
}

function setSessionCookie(c: Context, raw: string): void {
  setCookie(c, SESSION_COOKIE, raw, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_MAX_AGE_S, secure: isHttps(c),
  });
}

function createSession(c: Context): void {
  const raw = crypto.randomBytes(32).toString('base64url');
  const t = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  db.prepare('INSERT INTO sessions (id_hash, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(raw), new Date(t).toISOString(), new Date(t + SESSION_MAX_AGE_S * 1000).toISOString(), new Date(t).toISOString(),
      (c.req.header('user-agent') || '').slice(0, 300));
  setSessionCookie(c, raw);
}

/** Returns the session's id_hash if the request carries a valid session cookie; slides expiry. */
function checkSession(c: Context): string | null {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return null;
  const h = sha256(raw);
  const row = db.prepare('SELECT expires_at, last_seen_at FROM sessions WHERE id_hash = ?').get(h) as
    { expires_at: string; last_seen_at: string } | undefined;
  if (!row) return null;
  const t = Date.now();
  if (Date.parse(row.expires_at) < t) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(h);
    return null;
  }
  if (t - Date.parse(row.last_seen_at) > SESSION_TOUCH_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?')
      .run(new Date(t).toISOString(), new Date(t + SESSION_MAX_AGE_S * 1000).toISOString(), h);
    setSessionCookie(c, raw);
  }
  return h;
}

// ---------- API tokens ----------

const tokenTouched = new Map<string, number>();

function bearerFromHeader(header: string): string | null {
  const m = /^(Bearer|Basic)\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  if (m[1].toLowerCase() === 'bearer') return m[2].trim();
  try {
    const decoded = Buffer.from(m[2].trim(), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    return i < 0 ? null : decoded.slice(i + 1);
  } catch {
    return null;
  }
}

function checkToken(token: string): boolean {
  if (!token.startsWith('lst_')) return false;
  const h = sha256(token);
  const row = db.prepare('SELECT id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL').get(h) as { id: string } | undefined;
  if (!row) return false;
  const t = Date.now();
  if (t - (tokenTouched.get(row.id) ?? 0) > TOKEN_TOUCH_MS) {
    tokenTouched.set(row.id, t);
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(new Date(t).toISOString(), row.id);
  }
  return true;
}

// ---------- request helpers ----------

function normIp(ip: string): string {
  const s = ip.trim().toLowerCase();
  return s.startsWith('::ffff:') && s.includes('.') ? s.slice(7) : s;
}

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) { const i = h.indexOf(']'); return i < 0 ? h : h.slice(0, i + 1); }
  return h.split(':')[0];
}

function clientIp(c: Context, remote: RemoteAddressGetter): string {
  if (TRUST_PROXY) {
    const xff = c.req.header('x-forwarded-for');
    // Rightmost entry is the one our own proxy observed; earlier ones are client-supplied.
    const last = xff?.split(',').pop()?.trim();
    if (last) return normIp(last);
  }
  const r = remote(c);
  return r ? normIp(r) : 'unknown';
}

function originOk(c: Context): boolean {
  const origin = c.req.header('origin');
  if (origin === undefined) return true;
  // Behind a trusted reverse proxy the Host header may be rewritten (e.g. nginx's default $proxy_host),
  // so compare against X-Forwarded-Host when the proxy is trusted.
  const fwd = TRUST_PROXY ? (c.req.header('x-forwarded-host') || '').split(',')[0].trim() : '';
  const expected = (fwd || c.req.header('host') || '').toLowerCase();
  try { return new URL(origin).host.toLowerCase() === expected; } catch { return false; }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Public API paths (exact). Everything else under /api needs authentication. */
const PUBLIC_API = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup']);

function proxyAuthenticated(c: Context, remote: RemoteAddressGetter): boolean {
  const r = remote(c);
  if (!r) return false;
  if (!AUTH_TRUSTED_PROXIES.map(normIp).includes(normIp(r))) return false;
  return (c.req.header(AUTH_PROXY_HEADER) || '').trim() !== '';
}

function unauthorized(c: Context) {
  // Only challenge non-browser clients; a Basic challenge would make browsers pop up a login dialog.
  if (!c.req.header(CSRF_HEADER)) c.header('WWW-Authenticate', 'Basic realm="Libristead", charset="UTF-8"');
  return c.json({ error: 'authentication required' }, 401);
}

/** Authenticate a request for the current mode. Returns how, or null. */
function authenticate(c: Context<Env>, remote: RemoteAddressGetter): AuthVia | 'csrf' | null {
  if (AUTH === 'none') return 'none';
  if (AUTH === 'proxy') return proxyAuthenticated(c, remote) ? 'proxy' : null;
  const authz = c.req.header('authorization');
  if (authz) {
    const tok = bearerFromHeader(authz);
    return tok && checkToken(tok) ? 'token' : null;
  }
  const h = checkSession(c);
  if (!h) return null;
  c.set('sessionHash', h);
  if (UNSAFE.has(c.req.method)) {
    if (c.req.header(CSRF_HEADER) !== CSRF_VALUE || !originOk(c)) return 'csrf';
  }
  return 'cookie';
}

/** DNS-rebinding guard for AUTH=none; no-op otherwise. */
export function hostGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (AUTH === 'none' && !isLoopbackHost(hostnameOf(c.req.header('host') || ''))) {
      return c.json({ error: 'forbidden host' }, 403);
    }
    await next();
  };
}

/** Default-deny gate for /api/*. */
export function authGate(remote: RemoteAddressGetter = defaultRemote): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (PUBLIC_API.has(c.req.path)) return next();
    const via = authenticate(c, remote);
    if (via === 'csrf') return c.json({ error: 'missing or invalid CSRF header' }, 403);
    if (!via) return unauthorized(c);
    c.set('authVia', via);
    return next();
  };
}

// ---------- routes ----------

export function authRoutes(remote: RemoteAddressGetter = defaultRemote): Hono<Env> {
  const r = new Hono<Env>();

  r.get('/status', (c) => {
    const body: AuthStatus = {
      mode: AUTH,
      setupRequired: AUTH === 'password' && !hasUser(),
      authenticated: (() => { const v = authenticate(c, remote); return !!v && v !== 'csrf'; })(),
    };
    return c.json(body);
  });

  const passwordOnly: MiddlewareHandler<Env> = async (c, next) => {
    if (AUTH !== 'password') return c.json({ error: 'not available in this auth mode' }, 404);
    await next();
  };
  r.use('/login', passwordOnly);
  r.use('/setup', passwordOnly);
  r.use('/logout', passwordOnly);
  r.use('/password', passwordOnly);
  r.use('/tokens', passwordOnly);
  r.use('/tokens/*', passwordOnly);

  async function body<T>(c: Context): Promise<Partial<T>> {
    try { const b = await c.req.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; }
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');

  function limited(c: Context, ip: string) {
    const wait = blockedFor(ip);
    if (!wait) return null;
    c.header('Retry-After', String(wait));
    return c.json({ error: 'too many attempts, try again later' }, 429);
  }

  r.post('/setup', async (c) => {
    if (!originOk(c)) return c.json({ error: 'forbidden origin' }, 403);
    const ip = clientIp(c, remote);
    const lim = limited(c, ip);
    if (lim) return lim;
    if (hasUser()) return c.json({ error: 'already set up' }, 409);
    const b = await body<{ code: string; password: string }>(c);
    const password = str(b.password);
    if (!setupCodeMatches(str(b.code))) {
      recordFailure(ip);
      return c.json({ error: 'invalid setup code' }, 403);
    }
    if (password.length < MIN_PASSWORD) return c.json({ error: `password must be at least ${MIN_PASSWORD} characters` }, 400);
    const hash = await hashPassword(password);
    const t = now();
    try {
      db.prepare('INSERT INTO auth_user (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)').run(hash, t, t);
    } catch {
      return c.json({ error: 'already set up' }, 409);
    }
    try { fs.rmSync(SETUP_CODE_FILE, { force: true }); } catch { /* ignore */ }
    createSession(c);
    return c.json({ ok: true });
  });

  r.post('/login', async (c) => {
    if (!originOk(c)) return c.json({ error: 'forbidden origin' }, 403);
    const ip = clientIp(c, remote);
    const lim = limited(c, ip);
    if (lim) return lim;
    const b = await body<{ password: string }>(c);
    const row = db.prepare('SELECT password_hash FROM auth_user WHERE id = 1').get() as { password_hash: string } | undefined;
    if (!row) return c.json({ error: 'setup required' }, 409);
    if (!(await verifyPassword(str(b.password), row.password_hash))) {
      recordFailure(ip);
      return c.json({ error: 'wrong password' }, 401);
    }
    ipBuckets.delete(ip);
    createSession(c);
    return c.json({ ok: true });
  });

  /** Session-cookie-only guard for the endpoints below (tokens cannot manage sessions or tokens). */
  const sessionOnly: MiddlewareHandler<Env> = async (c, next) => {
    if (c.get('authVia') !== 'cookie') return c.json({ error: 'session required' }, 403);
    await next();
  };
  r.use('/logout', sessionOnly);
  r.use('/password', sessionOnly);
  r.use('/tokens', sessionOnly);
  r.use('/tokens/*', sessionOnly);

  r.post('/logout', (c) => {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(c.get('sessionHash'));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  r.post('/password', async (c) => {
    const ip = clientIp(c, remote);
    const lim = limited(c, ip);
    if (lim) return lim;
    const b = await body<{ current: string; next: string }>(c);
    const row = db.prepare('SELECT password_hash FROM auth_user WHERE id = 1').get() as { password_hash: string } | undefined;
    if (!row || !(await verifyPassword(str(b.current), row.password_hash))) {
      recordFailure(ip);
      return c.json({ error: 'wrong current password' }, 403);
    }
    const next = str(b.next);
    if (next.length < MIN_PASSWORD) return c.json({ error: `password must be at least ${MIN_PASSWORD} characters` }, 400);
    const hash = await hashPassword(next);
    db.prepare('UPDATE auth_user SET password_hash = ?, updated_at = ? WHERE id = 1').run(hash, now());
    db.prepare('DELETE FROM sessions WHERE id_hash != ?').run(c.get('sessionHash'));
    return c.json({ ok: true });
  });

  r.get('/tokens', (c) => {
    const rows = db.prepare('SELECT id, name, created_at, last_used_at FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC')
      .all() as unknown as { id: string; name: string; created_at: string; last_used_at: string | null }[];
    const out: ApiToken[] = rows.map((x) => ({ id: x.id, name: x.name, createdAt: x.created_at, lastUsedAt: x.last_used_at }));
    return c.json(out);
  });

  r.post('/tokens', async (c) => {
    const b = await body<{ name: string }>(c);
    const name = str(b.name).trim().slice(0, 80);
    if (!name) return c.json({ error: 'name required' }, 400);
    const token = 'lst_' + crypto.randomBytes(24).toString('base64url');
    const id = crypto.randomUUID();
    const t = now();
    db.prepare('INSERT INTO api_tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(id, name, sha256(token), t);
    const out: CreatedApiToken = { id, name, createdAt: t, lastUsedAt: null, token };
    return c.json(out);
  });

  r.delete('/tokens/:id', (c) => {
    const res = db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now(), c.req.param('id'));
    if (!res.changes) return c.json({ error: 'token not found' }, 404);
    return c.json({ ok: true });
  });

  return r;
}
