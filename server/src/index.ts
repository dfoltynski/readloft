import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, LIBRARY_DIR, DATA_DIR, WEB_DIST, SCAN_INTERVAL_MINUTES, ensureDirs } from './config.ts';
import { migrate } from './db.ts';
import { scanLibrary } from './scanner.ts';
import { books, HttpError } from './routes/books.ts';
import { shelves } from './routes/shelves.ts';
import { bookmarks } from './routes/bookmarks.ts';
import { library } from './routes/library.ts';

ensureDirs();
migrate();

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: err.message || 'internal error' }, 500);
});

app.route('/api', books);
app.route('/api', shelves);
app.route('/api', bookmarks);
app.route('/api', library);
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

const hasWeb = fs.existsSync(path.join(WEB_DIST, 'index.html'));
if (hasWeb) {
  const root = path.relative(process.cwd(), WEB_DIST) || '.';
  app.use('/*', serveStatic({ root }));
  const indexHtml = path.join(WEB_DIST, 'index.html');
  app.get('*', (c) => c.html(fs.readFileSync(indexHtml, 'utf8')));
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Readloft listening on :${PORT} | library=${LIBRARY_DIR} data=${DATA_DIR} web=${hasWeb ? WEB_DIST : 'none'}`);
});

scanLibrary().then((r) => console.log(`Initial scan: +${r.added} ~${r.updated} -${r.removed} in ${r.durationMs}ms`));
if (SCAN_INTERVAL_MINUTES > 0) {
  setInterval(() => { scanLibrary().catch((e) => console.error(e)); }, SCAN_INTERVAL_MINUTES * 60_000).unref();
}
