// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Set temp DATA_DIR/LIBRARY_DIR before any server module is imported (config reads env at import). */
export function setupEnv(env: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'libristead-auth-'));
  process.env.DATA_DIR = path.join(root, 'data');
  process.env.LIBRARY_DIR = path.join(root, 'books');
  process.env.WEB_DIST = path.join(root, 'nodist');
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return root;
}
