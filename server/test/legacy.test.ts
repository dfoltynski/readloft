// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDbFile, resolveSyncDir } from '../src/legacy.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'libristead-test-'));
const read = (p: string) => fs.readFileSync(p, 'utf8');

test('fresh install uses libristead.db', () => {
  const d = tmp();
  assert.equal(migrateDbFile(d), path.join(d, 'libristead.db'));
  assert.deepEqual(fs.readdirSync(d), []);
});

test('readloft.db and its -wal/-shm are migrated', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'readloft.db'), 'db');
  fs.writeFileSync(path.join(d, 'readloft.db-wal'), 'wal');
  fs.writeFileSync(path.join(d, 'readloft.db-shm'), 'shm');
  const p = migrateDbFile(d);
  assert.equal(p, path.join(d, 'libristead.db'));
  assert.equal(read(p), 'db');
  assert.equal(read(p + '-wal'), 'wal');
  assert.equal(read(p + '-shm'), 'shm');
  assert.deepEqual(fs.readdirSync(d).sort(), ['libristead.db', 'libristead.db-shm', 'libristead.db-wal']);
});

test('bookread.db is migrated', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'bookread.db'), 'old');
  const p = migrateDbFile(d);
  assert.equal(read(p), 'old');
  assert.equal(fs.existsSync(path.join(d, 'bookread.db')), false);
});

test('readloft.db wins over bookread.db', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'readloft.db'), 'rl');
  fs.writeFileSync(path.join(d, 'bookread.db'), 'br');
  assert.equal(read(migrateDbFile(d)), 'rl');
});

test('existing libristead.db is never overwritten', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'libristead.db'), 'new');
  fs.writeFileSync(path.join(d, 'readloft.db'), 'rl');
  fs.writeFileSync(path.join(d, 'bookread.db'), 'br');
  assert.equal(read(migrateDbFile(d)), 'new');
  assert.equal(read(path.join(d, 'readloft.db')), 'rl');
  assert.equal(read(path.join(d, 'bookread.db')), 'br');
});

test('resolveSyncDir: legacy .readloft only -> legacy path', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.readloft'));
  assert.equal(resolveSyncDir(d), path.join(d, '.readloft', 'sync'));
});

test('resolveSyncDir: .libristead present -> new path (even with legacy)', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.libristead'));
  assert.equal(resolveSyncDir(d), path.join(d, '.libristead', 'sync'));
  fs.mkdirSync(path.join(d, '.readloft'));
  assert.equal(resolveSyncDir(d), path.join(d, '.libristead', 'sync'));
});

test('resolveSyncDir: neither -> new path', () => {
  const d = tmp();
  assert.equal(resolveSyncDir(d), path.join(d, '.libristead', 'sync'));
});

test('resolveSyncDir: env override wins', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.readloft'));
  const o = tmp();
  assert.equal(resolveSyncDir(d, o), o);
});
