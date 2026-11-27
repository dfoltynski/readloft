// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv } from './auth-helpers.ts';

setupEnv({ AUTH: 'proxy', AUTH_TRUSTED_PROXIES: '10.0.0.1, 172.18.0.2', AUTH_PROXY_HEADER: 'Remote-User' });
const { ensureDirs } = await import('../src/config.ts');
const { migrate } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');
ensureDirs();
migrate();

let remote: string | undefined = '10.0.0.1';
const { app } = createApp({ getRemoteAddress: () => remote });

test('trusted proxy address + header is accepted', async () => {
  remote = '10.0.0.1';
  assert.equal((await app.request('/api/stats', { headers: { 'Remote-User': 'alice' } })).status, 200);
  remote = '::ffff:172.18.0.2';
  assert.equal((await app.request('/api/stats', { headers: { 'Remote-User': 'alice' } })).status, 200);
});

test('missing/empty header, untrusted or unknown address are rejected', async () => {
  remote = '10.0.0.1';
  assert.equal((await app.request('/api/stats')).status, 401);
  assert.equal((await app.request('/api/stats', { headers: { 'Remote-User': '' } })).status, 401);
  remote = '203.0.113.9';
  assert.equal((await app.request('/api/stats', { headers: { 'Remote-User': 'alice' } })).status, 401);
  remote = undefined;
  assert.equal((await app.request('/api/stats', { headers: { 'Remote-User': 'alice' } })).status, 401);
});

test('status reflects proxy auth; login/setup unavailable', async () => {
  remote = '10.0.0.1';
  const s = await (await app.request('/api/auth/status', { headers: { 'Remote-User': 'a' } })).json();
  assert.deepEqual(s, { mode: 'proxy', setupRequired: false, authenticated: true });
  assert.equal((await app.request('/api/auth/login', { method: 'POST' })).status, 404);
});
