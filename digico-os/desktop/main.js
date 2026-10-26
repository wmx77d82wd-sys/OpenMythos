const { app, BrowserWindow, ipcMain } = require('electron');
const { exec } = require('child_process');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

// Carpeta real del usuario a la que el OS tiene acceso: ~/DigiCoOS
const ROOT = path.join(os.homedir(), 'DigiCoOS');

// Resuelve una ruta relativa dentro de ROOT; rechaza cualquier intento de salir de ella
function inRoot(rel) {
  const p = path.resolve(ROOT, String(rel || '.'));
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) throw new Error('Ruta fuera de ' + ROOT);
  return p;
}

ipcMain.handle('host:list', async (_e, d) => (await fsp.readdir(inRoot(d), { withFileTypes: true })).map(x => x.name + (x.isDirectory() ? '/' : '')));
ipcMain.handle('host:read', (_e, f) => fsp.readFile(inRoot(f), 'utf8'));
ipcMain.handle('host:write', async (_e, f, c) => { const p = inRoot(f); await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, String(c)); });
ipcMain.handle('host:remove', (_e, f) => fsp.rm(inRoot(f), { recursive: true }));
ipcMain.handle('host:exec', (_e, cmd) => new Promise(res =>
  exec(String(cmd), { cwd: ROOT, timeout: 15000, maxBuffer: 1e6 }, (err, stdout, stderr) => res({ stdout, stderr, code: err ? (err.code || 1) : 0 }))));

app.whenReady().then(async () => {
  await fsp.mkdir(ROOT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280, height: 800, title: 'DigiCo Quantum OS',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  // El puente de host solo debe servir a nuestra página: bloquea navegación y ventanas externas
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'index.html'));
});

app.on('window-all-closed', () => app.quit());
