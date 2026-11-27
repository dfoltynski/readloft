// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { VERSION, WEB_DIST } from './config.ts';
import { HttpError, books } from './routes/books.ts';
import { shelves } from './routes/shelves.ts';
import { bookmarks } from './routes/bookmarks.ts';
import { annotations } from './routes/annotations.ts';
import { library } from './routes/library.ts';
import { opds } from './routes/opds.ts';
import { authGate, authRoutes, hostGuard, type RemoteAddressGetter } from './auth.ts';

export interface AppOptions {
  /** Override how the socket's remote address is read (tests). */
  getRemoteAddress?: RemoteAddressGetter;
  /** Serve the built web UI when present (default true). */
  serveWeb?: boolean;
}

export function createApp(opts: AppOptions = {}): { app: Hono; hasWeb: boolean } {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: err.message || 'internal error' }, 500);
  });

  app.use('*', hostGuard());
  // Default deny: every /api route except the allowlist in auth.ts needs authentication.
  app.use('/api/*', authGate(opts.getRemoteAddress));
  // OPDS catalog for e-reader apps (Basic/Bearer API token); same default-deny gate.
  app.use('/opds', authGate(opts.getRemoteAddress));
  app.use('/opds/*', authGate(opts.getRemoteAddress));
  app.route('/opds', opds);
  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));
  app.route('/api/auth', authRoutes(opts.getRemoteAddress));
  app.route('/api', books);
  app.route('/api', shelves);
  app.route('/api', bookmarks);
  app.route('/api', annotations);
  app.route('/api', library);
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  const hasWeb = opts.serveWeb !== false && fs.existsSync(path.join(WEB_DIST, 'index.html'));
  if (hasWeb) {
    app.use('/*', serveStatic({ root: WEB_DIST }));
    const indexHtml = path.join(WEB_DIST, 'index.html');
    app.get('*', (c) => c.html(fs.readFileSync(indexHtml, 'utf8')));
  }
  return { app, hasWeb };
}
