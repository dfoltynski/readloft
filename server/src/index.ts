// SPDX-License-Identifier: AGPL-3.0-only
import { serve } from '@hono/node-server';
import { PORT, HOST, AUTH, LIBRARY_DIR, DATA_DIR, WEB_DIST, SCAN_INTERVAL_MINUTES, ensureDirs } from './config.ts';
import { migrate } from './db.ts';
import { scanLibrary } from './scanner.ts';
import { startSync } from './sync.ts';
import { createApp } from './app.ts';
import { ensureSetupCode, printSetupCode } from './auth.ts';

ensureDirs();
migrate();
startSync();
const { app, hasWeb } = createApp();

if (AUTH === 'password') {
  const code = ensureSetupCode();
  if (code) printSetupCode(code);
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Libristead listening on ${HOST}:${PORT} | auth=${AUTH} | library=${LIBRARY_DIR} data=${DATA_DIR} web=${hasWeb ? WEB_DIST : 'none'}`);
});

scanLibrary().then((r) => console.log(`Initial scan: +${r.added} ~${r.updated} -${r.removed} in ${r.durationMs}ms`));
if (SCAN_INTERVAL_MINUTES > 0) {
  setInterval(() => { scanLibrary().catch((e) => console.error(e)); }, SCAN_INTERVAL_MINUTES * 60_000).unref();
}
