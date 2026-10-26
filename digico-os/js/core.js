'use strict';
// Núcleo: estado persistente, sistema de archivos virtual, ventanas, paleta, menú contextual y fondo.

const $ = s => document.querySelector(s);

// Crea elementos sin innerHTML: los hijos string son siempre texto, nunca HTML.
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}

// ---------- Estado persistente ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('dqos.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dqos.' + k, JSON.stringify(v)); return true; } catch { return false; } },
};
const HEX = /^#[0-9a-f]{6}$/i;

function sanitizeApps(list) {
  return (Array.isArray(list) ? list : [])
    .filter(a => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.content === 'string' && (a.type === 'html' || a.type === 'url'))
    .map(a => ({ id: a.id.replace(/[^\w-]/g, ''), name: a.name.slice(0, 60), icon: String(a.icon || '🧩').slice(0, 8), type: a.type, content: a.content }));
}
function sanitizeFs(o) {
  const r = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (k.startsWith('/') && typeof v === 'string') r[k] = v;
  return r;
}
function sanitizeSettings(s) {
  const r = {};
  if (!s || typeof s !== 'object') return r;
  if (s.theme === 'dark' || s.theme === 'light') r.theme = s.theme;
  for (const k of ['bg1', 'bg2', 'accent']) if (typeof s[k] === 'string' && HEX.test(s[k])) r[k] = s[k];
  for (const k of ['qbg', 'restore']) if (typeof s[k] === 'boolean') r[k] = s[k];
  return r;
}

let customApps = sanitizeApps(LS.get('apps', []));   // {id,name,icon,type:'html'|'url',content}
let settings = Object.assign({ theme: 'dark', bg1: '#0b1026', bg2: '#3b1d6e', accent: '#7c5cff', qbg: true, restore: true }, sanitizeSettings(LS.get('settings', {})));
let notes = String(LS.get('notes', ''));
// Sistema de archivos virtual: mapa plano ruta -> contenido (las carpetas son prefijos).
// Un contenido que empieza con "data:" es un archivo binario (imagen, pdf…).
let fs = sanitizeFs(LS.get('fs', { '/Bienvenida.txt': 'Bienvenido a DigiCo Quantum OS.\nPulsa Ctrl/⌘ + K para buscar apps y archivos.\nTus apps usan os.fs dentro de /apps/<id>/.' }));

function persist(key, val, what) {
  if (!LS.set(key, val)) notify('⚠️ Sin espacio: no se pudo guardar ' + what + '. Exporta un respaldo y libera archivos.');
}
const saveApps = () => persist('apps', customApps, 'las apps');
const saveFs = () => persist('fs', fs, 'los archivos');
const saveNotes = () => persist('notes', notes, 'las notas');
const saveSettings = () => { persist('settings', settings, 'los ajustes'); applySettings(); };

const snapshot = () => ({ apps: customApps, settings, notes, fs });
function applySnapshot(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Formato inválido');
  customApps = sanitizeApps(d.apps);
  Object.assign(settings, sanitizeSettings(d.settings));
  notes = typeof d.notes === 'string' ? d.notes : '';
  if ('fs' in d) fs = sanitizeFs(d.fs);
  saveApps(); saveSettings(); saveFs(); saveNotes(); refresh(); startBg();
}

const absPath = p => p.startsWith('/') ? p : '/' + p;
function fsEntries(dir) {
  const seen = new Map();
  for (const k of Object.keys(fs)) {
    if (!k.startsWith(dir)) continue;
    const rest = k.slice(dir.length), i = rest.indexOf('/');
    if (i >= 0) seen.set(rest.slice(0, i), true);
    else if (rest !== '.keep') seen.set(rest, false);
  }
  return [...seen].map(([name, dir]) => ({ name, dir })).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
}
function fsMove(from, to) {
  const keys = Object.keys(fs).filter(k => k === from || k.startsWith(from + '/'));
  if (!keys.length || Object.keys(fs).some(k => k === to || k.startsWith(to + '/'))) return false;
  for (const k of keys) { fs[to + k.slice(from.length)] = fs[k]; delete fs[k]; }
  saveFs(); return true;
}
function fsRemove(path) { Object.keys(fs).filter(k => k === path || k.startsWith(path + '/')).forEach(k => delete fs[k]); saveFs(); }
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

function download(name, content) {
  const url = content.startsWith('data:') ? content : URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  const a = h('a', { href: url, download: name }); a.click();
  if (!content.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function notify(text) {
  const d = h('div', { class: 'toast' }, text);
  $('#toasts').appendChild(d);
  setTimeout(() => d.remove(), 3500);
}

function applySettings() {
  const r = document.documentElement;
  r.dataset.theme = settings.theme;
  r.style.setProperty('--accent', settings.accent);
  if (settings.theme === 'dark') { r.style.setProperty('--bg1', settings.bg1); r.style.setProperty('--bg2', settings.bg2); }
  else { r.style.removeProperty('--bg1'); r.style.removeProperty('--bg2'); }
}

// ---------- Gestor de ventanas ----------
let z = 10, winCount = 0, currentApp = null;   // currentApp: id de la app que se está lanzando (para restaurar la sesión)
const wins = new Map();
const sessionIds = [];                         // apps con ventana abierta, se restauran al recargar
const saveSession = () => LS.set('session', sessionIds);

function openWindow(title, icon, render, opts = {}) {
  const id = ++winCount, appId = opts.appId || currentApp;
  currentApp = null;
  const desktop = $('#desktop');
  const el = h('div', { class: 'win', role: 'dialog', 'aria-label': title });
  const off = (id % 8) * 28;
  Object.assign(el.style, {
    left: Math.max(0, Math.min(80 + off, innerWidth - 320)) + 'px', top: Math.max(0, Math.min(50 + off, innerHeight - 260)) + 'px',
    width: Math.min(opts.w || 520, innerWidth - 8) + 'px', height: Math.min(opts.h || 380, innerHeight - 52) + 'px',
  });
  const bar = h('div', { class: 'bar' },
    h('span', {}, icon), h('span', { class: 't' }, title),
    h('button', { 'data-a': 'min', 'aria-label': 'Minimizar' }, '–'),
    h('button', { 'data-a': 'max', 'aria-label': 'Maximizar' }, '▢'),
    h('button', { 'data-a': 'close', 'aria-label': 'Cerrar' }, '✕'));
  const body = h('div', { class: 'body' });
  el.append(bar, body);
  desktop.appendChild(el);

  const task = h('button', { title }, icon + ' ' + title);
  $('#tasks').appendChild(task);

  const w = { el, task, min: false, prev: null };
  wins.set(id, w);
  const focus = () => { el.style.zIndex = ++z; wins.forEach(o => o.el.classList.remove('focus')); el.classList.add('focus'); };
  w.focus = focus;
  const toggleMin = () => { w.min = !w.min; el.style.display = w.min ? 'none' : 'flex'; if (!w.min) focus(); };
  const geom = () => ({ left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height });
  const toggleMax = () => {
    if (w.prev) { Object.assign(el.style, w.prev); w.prev = null; }
    else { w.prev = geom(); Object.assign(el.style, { left: '0px', top: '0px', width: '100%', height: '100%' }); }
  };
  const snapTo = side => {
    const W = desktop.clientWidth, H = desktop.clientHeight;
    if (side === 'top') return w.prev ? undefined : toggleMax();
    if (!w.prev) w.prev = geom();
    Object.assign(el.style, { left: side === 'left' ? '0px' : W / 2 + 'px', top: '0px', width: W / 2 + 'px', height: H + 'px' });
  };
  const close = () => {
    el.remove(); task.remove(); wins.delete(id);
    const i = sessionIds.indexOf(appId); if (appId && i >= 0) { sessionIds.splice(i, 1); saveSession(); }
  };

  el.addEventListener('pointerdown', focus);
  task.onclick = () => (w.min || !el.classList.contains('focus')) ? (w.min ? toggleMin() : focus()) : toggleMin();
  bar.querySelector('[data-a=close]').onclick = close;
  bar.querySelector('[data-a=min]').onclick = toggleMin;
  bar.querySelector('[data-a=max]').onclick = toggleMax;
  bar.addEventListener('dblclick', e => { if (!e.target.closest('button')) toggleMax(); });

  // Arrastrar con pointer events (funciona con ratón, táctil y sobre iframes) y acoplar a los bordes
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    if (w.prev) {   // al arrastrar una ventana maximizada/acoplada, vuelve a su tamaño
      const p = w.prev; w.prev = null; Object.assign(el.style, p);
      el.style.left = Math.max(0, e.clientX - parseFloat(p.width) / 2) + 'px'; el.style.top = '0px';
    }
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop, snap = $('#snap');
    let zone = null;
    const mv = ev => {
      el.style.left = (ev.clientX - sx) + 'px'; el.style.top = Math.max(0, ev.clientY - sy) + 'px';
      zone = ev.clientY <= 6 ? 'top' : ev.clientX <= 6 ? 'left' : ev.clientX >= innerWidth - 7 ? 'right' : null;
      const W = desktop.clientWidth, H = desktop.clientHeight;
      if (zone) Object.assign(snap.style, { display: 'block', left: zone === 'right' ? W / 2 + 'px' : '0px', top: '0px', width: (zone === 'top' ? W : W / 2) + 'px', height: H + 'px' });
      else snap.style.display = 'none';
    };
    const up = () => {
      bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
      snap.style.display = 'none';
      if (zone) snapTo(zone);
    };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  });

  if (appId) { sessionIds.push(appId); saveSession(); }
  if (innerWidth < 700) toggleMax();   // en pantallas pequeñas todo va a pantalla completa
  try { render(body, { close }); }
  catch (err) { console.error(err); body.textContent = 'Error al abrir: ' + err.message; }
  focus();
  return w;
}

// Un clic dentro de un iframe no genera pointerdown en la página: enfoca la ventana cuando el iframe toma el foco
addEventListener('blur', () => setTimeout(() => {
  const a = document.activeElement;
  if (a && a.tagName === 'IFRAME') for (const w of wins.values()) if (w.el.contains(a)) { w.focus(); break; }
}, 0));

// ---------- Paleta de comandos (Ctrl/⌘ + K) ----------
function openPalette() {
  const pal = $('#palette'), inp = pal.querySelector('input'), res = pal.querySelector('.res');
  const src = paletteSource();
  let items = [], sel = 0;
  const render = () => {
    const q = inp.value.trim().toLowerCase();
    items = src.filter(i => !q || i.label.toLowerCase().includes(q)).slice(0, 30);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    res.textContent = '';
    items.forEach((it, k) => res.appendChild(h('div', { class: k === sel ? 'sel' : '', onclick: () => pick(k) },
      h('span', {}, it.icon), h('span', {}, it.label), h('span', { style: 'margin-left:auto;opacity:.6' }, it.hint || ''))));
    const cur = res.querySelector('.sel'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  };
  const close = () => { pal.style.display = 'none'; inp.onkeydown = inp.oninput = pal.onclick = null; };
  const pick = k => { const it = items[k]; close(); if (it) it.run(); };
  inp.oninput = () => { sel = 0; render(); };
  inp.onkeydown = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') pick(sel);
  };
  pal.onclick = e => { if (e.target === pal) close(); };
  inp.value = ''; pal.style.display = 'flex'; render(); inp.focus();
}
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
});

// ---------- Menú contextual ----------
function showCtx(x, y, items) {
  const ctx = $('#ctx');
  ctx.textContent = '';
  items.forEach(it => ctx.appendChild(h('div', { onclick: () => { hideCtx(); it.run(); } }, it.label)));
  ctx.style.display = 'block';
  ctx.style.left = Math.max(0, Math.min(x, innerWidth - ctx.offsetWidth - 4)) + 'px';
  ctx.style.top = Math.max(0, Math.min(y, innerHeight - ctx.offsetHeight - 50)) + 'px';
}
const hideCtx = () => { $('#ctx').style.display = 'none'; };
document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctx')) hideCtx(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { hideCtx(); $('#menu').style.display = 'none'; } });

// ---------- Fondo cuántico: red de partículas ----------
const bg = $('#qbg'), bgx = bg.getContext('2d');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pts = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * 3e-4, vy: (Math.random() - .5) * 3e-4 }));
let bgRaf = 0;
function fitBg() { bg.width = bg.clientWidth; bg.height = bg.clientHeight; }
function startBg() {
  cancelAnimationFrame(bgRaf);
  if (settings.qbg === false) { bg.style.display = 'none'; return; }
  bg.style.display = 'block'; fitBg();
  const tick = () => {
    const W = bg.width, H = bg.height;
    bgx.clearRect(0, 0, W, H);
    if (!reduceMotion) pts.forEach(p => { p.x = (p.x + p.vx + 1) % 1; p.y = (p.y + p.vy + 1) % 1; });
    pts.forEach((p, i) => {
      bgx.fillStyle = 'rgba(160,140,255,.8)'; bgx.beginPath(); bgx.arc(p.x * W, p.y * H, 2, 0, 7); bgx.fill();
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot((p.x - pts[j].x) * W, (p.y - pts[j].y) * H);
        if (d < 120) { bgx.strokeStyle = 'rgba(124,92,255,' + (1 - d / 120) * .5 + ')'; bgx.beginPath(); bgx.moveTo(p.x * W, p.y * H); bgx.lineTo(pts[j].x * W, pts[j].y * H); bgx.stroke(); }
      }
    });
    if (!reduceMotion) bgRaf = requestAnimationFrame(tick);
  };
  tick();
}
addEventListener('resize', () => { if (settings.qbg !== false) { fitBg(); if (reduceMotion) startBg(); } });
