// SPDX-License-Identifier: AGPL-3.0-only
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Packaged: server/ and web-dist/ sit next to main.js. Dev: use the repo checkout.
const packaged = fs.existsSync(path.join(here, 'server', 'src', 'index.ts'));
const serverEntry = packaged ? path.join(here, 'server', 'src', 'index.ts') : path.join(here, '..', 'server', 'src', 'index.ts');
const webDist = packaged ? path.join(here, 'web-dist') : path.join(here, '..', 'web', 'dist');

// Migrate app data from the former name (Readloft): userData follows productName, so the folder name changed.
// Must run before anything touches userData and before app ready.
function migrateLegacyUserData() {
  try {
    const next = app.getPath('userData');
    const legacy = path.join(path.dirname(next), 'Read' + 'loft');
    if (!fs.existsSync(legacy)) return;
    // Electron may create userData (GPU cache etc.) before this runs, so "exists" is not enough:
    // only skip when the new folder already holds our own data.
    const hasOwnData = ['config.json', 'data'].some((f) => fs.existsSync(path.join(next, f)));
    if (hasOwnData) return;
    if (!fs.existsSync(next)) {
      try {
        fs.renameSync(legacy, next);
        console.log(`Migrated app data ${legacy} -> ${next}`);
        return;
      } catch { /* fall through to per-entry move */ }
    }
    fs.mkdirSync(next, { recursive: true });
    for (const name of fs.readdirSync(legacy)) {
      const from = path.join(legacy, name);
      const to = path.join(next, name);
      if (fs.existsSync(to)) continue; // keep what Electron just created (caches, locks)
      try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); }
    }
    console.log(`Migrated app data ${legacy} -> ${next} (legacy folder left with leftovers)`);
  } catch (err) {
    console.error('App data migration failed', err);
  }
}
migrateLegacyUserData();

const userData = app.getPath('userData');
const configFile = path.join(userData, 'config.json');
const dataDir = path.join(userData, 'data');

let win = null;
let port = 0;
let quitting = false;

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
}

async function pickLibraryFolder(current) {
  const res = await dialog.showOpenDialog({
    title: 'Choose your Libristead library folder',
    message: 'Choose the folder that holds your books. It can be an iCloud Drive folder.',
    buttonLabel: 'Use This Folder',
    defaultPath: current || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
}

function isFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
function randomFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
  });
}
async function choosePort() {
  return (await isFree(8080)) ? 8080 : randomFreePort();
}

async function waitForServer(p, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api/stats`);
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not start in time');
}

function openWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Libristead',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const origin = `http://127.0.0.1:${port}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.on('closed', () => { win = null; });
  win.loadURL(origin);
}

async function changeLibrary() {
  const cfg = readConfig();
  const dir = await pickLibraryFolder(cfg.libraryDir);
  if (!dir) return;
  writeConfig({ ...cfg, libraryDir: dir });
  app.relaunch();
  quitting = true;
  app.quit();
}

function buildMenu() {
  const items = [
    { label: 'Open in Browser', click: () => shell.openExternal(`http://127.0.0.1:${port}`) },
    { label: 'Change Library Folder…', click: changeLibrary },
    { label: 'Show Data Folder', click: () => shell.openPath(dataDir) },
    { type: 'separator' },
    { role: 'quit' },
  ];
  const template = [
    { label: 'Libristead', submenu: items },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start() {
  const cfg = readConfig();
  let libraryDir = cfg.libraryDir;
  if (!libraryDir || !fs.existsSync(libraryDir)) {
    libraryDir = await pickLibraryFolder(libraryDir);
    if (!libraryDir) { app.quit(); return; }
    writeConfig({ ...cfg, libraryDir });
  }
  fs.mkdirSync(dataDir, { recursive: true });
  port = await choosePort();
  process.env.PORT = String(port);
  process.env.LIBRARY_DIR = libraryDir;
  process.env.DATA_DIR = dataDir;
  process.env.WEB_DIST = webDist;
  // Desktop is single-user and local: bind loopback only, no login.
  process.env.HOST = '127.0.0.1';
  process.env.AUTH = 'none';
  process.env.LIBRISTEAD_VERSION = app.getVersion();
  await import(pathToFileURL(serverEntry).href);
  await waitForServer(port);
  buildMenu();
  openWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (port) openWindow(); });
  app.on('activate', () => { if (port) openWindow(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !quitting) app.quit();
  });
  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox('Libristead failed to start', String(err?.stack || err));
    app.quit();
  });
}
