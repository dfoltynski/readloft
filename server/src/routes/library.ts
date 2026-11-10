import { Hono } from 'hono';
import type { LibraryStats } from '../../../shared/types.ts';
import { db } from '../db.ts';

export const library = new Hono();

library.get('/stats', (c) => {
  const stats: LibraryStats = { total: 0, reading: 0, finished: 0, unread: 0, byFormat: {} };
  const st = db.prepare('SELECT status, COUNT(*) AS n FROM books GROUP BY status').all() as unknown as { status: string; n: number }[];
  for (const r of st) {
    stats.total += r.n;
    if (r.status === 'reading') stats.reading = r.n;
    else if (r.status === 'finished') stats.finished = r.n;
    else if (r.status === 'unread') stats.unread = r.n;
  }
  const fm = db.prepare('SELECT format, COUNT(*) AS n FROM books GROUP BY format').all() as unknown as { format: string; n: number }[];
  for (const r of fm) stats.byFormat[r.format] = r.n;
  return c.json(stats);
});
