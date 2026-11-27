// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setupEnv } from './auth-helpers.ts';

setupEnv({ AUTH: 'none', HOST: '127.0.0.1' });
const { ensureDirs } = await import('../src/config.ts');
const { migrate } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');
ensureDirs();
migrate();
const { app } = createApp();

test('AUTH=none: loopback Host allowed', async () => {
  for (const host of ['127.0.0.1:8080', 'localhost', 'localhost:3000', '[::1]:8080']) {
    assert.equal((await app.request('/api/stats', { headers: { host } })).status, 200, host);
  }
  const s = await (await app.request('/api/auth/status', { headers: { host: 'localhost' } })).json();
  assert.deepEqual(s, { mode: 'none', setupRequired: false, authenticated: true });
});

test('AUTH=none: other Host headers get 403 (DNS rebinding)', async () => {
  for (const host of ['evil.example', 'evil.example:8080', '192.168.1.5:8080', 'localhost.evil.example']) {
    assert.equal((await app.request('/api/stats', { headers: { host } })).status, 403, host);
  }
});

test('AUTH=none with a non-loopback HOST exits 1', () => {
  const r = spawnSync(process.execPath, ['-e', "import('./server/src/config.ts')"], {
    env: { ...process.env, AUTH: 'none', HOST: '0.0.0.0' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /loopback/);
});

test('AUTH=proxy without AUTH_TRUSTED_PROXIES exits 1', () => {
  const r = spawnSync(process.execPath, ['-e', "import('./server/src/config.ts')"], {
    env: { ...process.env, AUTH: 'proxy', AUTH_TRUSTED_PROXIES: '' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
});
