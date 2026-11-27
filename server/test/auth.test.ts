// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv } from './auth-helpers.ts';

setupEnv({ AUTH: 'password' });
const { ensureDirs } = await import('../src/config.ts');
const { migrate } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');
const { ensureSetupCode, resetRateLimits } = await import('../src/auth.ts');
ensureDirs();
migrate();
const { app } = createApp({ getRemoteAddress: () => '10.0.0.5' });

const CSRF = { 'X-Requested-With': 'libristead' };
const JSON_H = { 'Content-Type': 'application/json' };
const PUBLIC = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup']);
const PASSWORD = 'correct horse battery';

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, { method: 'POST', headers: { ...JSON_H, ...headers }, body: JSON.stringify(body) });
}
function cookieOf(res: Response): string {
  const sc = res.headers.get('set-cookie') || '';
  const m = /libristead_session=([^;]+)/.exec(sc);
  assert.ok(m, 'session cookie set');
  return `libristead_session=${m[1]}`;
}

const code = ensureSetupCode()!;
let cookie = '';

test('every /api route denies unauthenticated requests except the allowlist', async () => {
  const seen = new Set<string>();
  for (const r of app.routes) {
    if (!r.path.startsWith('/api') && !r.path.startsWith('/opds')) continue;
    const p = r.path.replace(/:[A-Za-z]+\??/g, 'x').replace(/\*/g, 'x');
    const method = r.method === 'ALL' ? 'GET' : r.method;
    const key = `${method} ${p}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const res = await app.request(p, { method });
    if (PUBLIC.has(p)) assert.notEqual(res.status, 401, key);
    else assert.equal(res.status, 401, key);
  }
  assert.ok(seen.size > 20);
  assert.equal((await app.request('/api/does-not-exist')).status, 401);
  for (const p of ['/opds', '/opds/', '/opds/opensearch.xml', '/opds/search?q=x', '/opds/nope']) {
    assert.equal((await app.request(p)).status, 401, p);
  }
  assert.ok([...seen].some((k) => k.startsWith('GET /opds')));
});

test('status reports setup required', async () => {
  const s = await (await app.request('/api/auth/status')).json();
  assert.deepEqual(s, { mode: 'password', setupRequired: true, authenticated: false });
});

test('setup: wrong code fails, short password fails, right code works once', async () => {
  assert.equal((await post('/api/auth/setup', { code: 'AAAAA-AAAAA', password: PASSWORD })).status, 403);
  assert.equal((await post('/api/auth/setup', { code, password: 'short' })).status, 400);
  const ok = await post('/api/auth/setup', { code, password: PASSWORD });
  assert.equal(ok.status, 200);
  const sc = ok.headers.get('set-cookie')!;
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
  assert.match(sc, /Path=\//);
  assert.doesNotMatch(sc, /Secure/i);
  cookie = cookieOf(ok);
  assert.equal((await post('/api/auth/setup', { code, password: PASSWORD })).status, 409);
  assert.equal((await app.request('/api/stats', { headers: { cookie } })).status, 200);
});

test('login ok / bad', async () => {
  resetRateLimits();
  assert.equal((await post('/api/auth/login', { password: 'nope nope nope' })).status, 401);
  const ok = await post('/api/auth/login', { password: PASSWORD });
  assert.equal(ok.status, 200);
  cookie = cookieOf(ok);
  const s = await (await app.request('/api/auth/status', { headers: { cookie } })).json();
  assert.equal(s.authenticated, true);
  assert.equal(s.setupRequired, false);
});

test('Secure cookie when request is https', async () => {
  const res = await app.request('https://localhost/api/auth/login', {
    method: 'POST', headers: JSON_H, body: JSON.stringify({ password: PASSWORD }),
  });
  assert.match(res.headers.get('set-cookie')!, /Secure/i);
});

test('cookie POST needs X-Requested-With and matching Origin', async () => {
  const noHdr = await app.request('/api/shelves', { method: 'POST', headers: { ...JSON_H, cookie }, body: JSON.stringify({ name: 'a' }) });
  assert.equal(noHdr.status, 403);
  const badOrigin = await app.request('/api/shelves', {
    method: 'POST', headers: { ...JSON_H, ...CSRF, cookie, origin: 'http://evil.example', host: 'localhost:8080' }, body: JSON.stringify({ name: 'a' }),
  });
  assert.equal(badOrigin.status, 403);
  const good = await app.request('/api/shelves', {
    method: 'POST', headers: { ...JSON_H, ...CSRF, cookie, origin: 'http://localhost:8080', host: 'localhost:8080' }, body: JSON.stringify({ name: 'a' }),
  });
  assert.equal(good.status, 201);
});

test('api tokens: bearer, basic, revoke; tokens cannot manage tokens', async () => {
  const created = await post('/api/auth/tokens', { name: 'kobo' }, { ...CSRF, cookie });
  assert.equal(created.status, 200);
  const { id, token } = await created.json();
  assert.match(token, /^lst_/);
  assert.equal((await app.request('/api/stats', { headers: { authorization: `Bearer ${token}` } })).status, 200);
  const basic = Buffer.from(`anyone:${token}`).toString('base64');
  assert.equal((await app.request('/api/stats', { headers: { authorization: `Basic ${basic}` } })).status, 200);
  // token auth needs no CSRF header
  assert.equal((await app.request('/api/shelves', { method: 'POST', headers: { ...JSON_H, authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'b' }) })).status, 201);
  assert.equal((await app.request('/api/auth/tokens', { headers: { authorization: `Bearer ${token}` } })).status, 403);
  const list = await (await app.request('/api/auth/tokens', { headers: { cookie } })).json();
  assert.equal(list.length, 1);
  assert.ok(list[0].lastUsedAt);
  assert.equal((await app.request(`/api/auth/tokens/${id}`, { method: 'DELETE', headers: { ...CSRF, cookie } })).status, 200);
  assert.equal((await app.request('/api/stats', { headers: { authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await app.request('/api/stats', { headers: { authorization: 'Bearer lst_bogus' } })).status, 401);
});

test('password change revokes other sessions', async () => {
  const other = cookieOf(await post('/api/auth/login', { password: PASSWORD }));
  const bad = await post('/api/auth/password', { current: 'wrong wrong wrong', next: 'another long password' }, { ...CSRF, cookie });
  assert.equal(bad.status, 403);
  const ok = await post('/api/auth/password', { current: PASSWORD, next: 'another long password' }, { ...CSRF, cookie });
  assert.equal(ok.status, 200);
  assert.equal((await app.request('/api/stats', { headers: { cookie: other } })).status, 401);
  assert.equal((await app.request('/api/stats', { headers: { cookie } })).status, 200);
  resetRateLimits();
  assert.equal((await post('/api/auth/login', { password: 'another long password' })).status, 200);
});

test('logout invalidates the session', async () => {
  assert.equal((await post('/api/auth/logout', {}, { ...CSRF, cookie })).status, 200);
  assert.equal((await app.request('/api/stats', { headers: { cookie } })).status, 401);
});

test('rate limit: 429 with Retry-After on the 6th failure, success resets', async () => {
  resetRateLimits();
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/login', { password: 'wrong wrong wrong' })).status, 401);
  const res = await post('/api/auth/login', { password: 'wrong wrong wrong' });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
  // even the right password is blocked while limited
  assert.equal((await post('/api/auth/login', { password: 'another long password' })).status, 429);
  resetRateLimits();
  for (let i = 0; i < 3; i++) await post('/api/auth/login', { password: 'wrong wrong wrong' });
  assert.equal((await post('/api/auth/login', { password: 'another long password' })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/login', { password: 'wrong wrong wrong' })).status, 401);
});
