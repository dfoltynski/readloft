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
    title: 'Choose your Readloft library folder',
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
    s.listen(p, () => s.close(() => resolve(true)));
  });
}
function randomFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
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
    title: 'Readloft',
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
    { label: 'Readloft', submenu: items },
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
    dialog.showErrorBox('Readloft failed to start', String(err?.stack || err));
    app.quit();
  });
}
