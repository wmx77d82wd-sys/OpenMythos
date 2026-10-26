'use strict';
// Arranque: lista de apps, escritorio, menú Inicio, paleta y restauración de sesión.

const builtins = [
  { id: 'terminal', name: 'Terminal', icon: '⌨️', open: openTerminal },
  { id: 'files', name: 'Archivos', icon: '📁', open: () => openFiles() },
  { id: 'qubit', name: 'Qubit Lab', icon: '⚛️', open: openQubitLab },
  { id: 'assistant', name: 'Asistente IA', icon: '🤖', open: openAssistant },
  { id: 'cloud', name: 'Nube', icon: '☁️', open: openCloud },
  { id: 'notes', name: 'Notas', icon: '📝', open: openNotes },
  { id: 'builder', name: 'Agregar App', icon: '➕', open: () => openBuilder() },
  { id: 'manager', name: 'Mis Apps', icon: '🗂️', open: openManager },
  { id: 'settings', name: 'Ajustes', icon: '⚙️', open: openSettings },
];

const findApp = id => [...builtins, ...customApps].find(a => a.id === id);

function launch(a) {
  $('#menu').style.display = 'none';
  currentApp = a.id;
  try { a.open ? a.open() : openCustom(a); } finally { currentApp = null; }
}

function refresh() {
  const icons = $('#icons'), menu = $('#menu');
  icons.textContent = ''; menu.textContent = '';
  [...builtins, ...customApps].forEach(a => {
    const isCustom = customApps.includes(a);
    const ctxItems = [{ label: 'Abrir', run: () => launch(a) },
      ...(isCustom ? [{ label: 'Editar', run: () => openBuilder(a.id) }, { label: 'Desinstalar', run: () => { if (confirm('¿Desinstalar ' + a.name + '?')) uninstallApp(a); } }] : [])];
    icons.appendChild(h('div', {
      class: 'icon', tabindex: 0, role: 'button', 'aria-label': a.name,
      ondblclick: () => launch(a),
      onclick: () => { if (matchMedia('(pointer:coarse)').matches) launch(a); },
      onkeydown: e => { if (e.key === 'Enter') launch(a); },
      oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); showCtx(e.clientX, e.clientY, ctxItems); },
    }, h('div', { class: 'ico' }, a.icon), h('div', { class: 'lbl' }, a.name)));
    menu.appendChild(h('div', { class: 'item', tabindex: 0, onclick: () => launch(a), onkeydown: e => { if (e.key === 'Enter') launch(a); } }, a.icon + '  ' + a.name));
  });
}

// Elementos que busca la paleta (Ctrl/⌘ + K)
function paletteSource() {
  const items = [...builtins, ...customApps].map(a => ({ icon: a.icon, label: a.name, hint: 'App', run: () => launch(a) }));
  Object.keys(fs).filter(k => !k.endsWith('/.keep')).forEach(k => items.push({ icon: '📄', label: k, hint: 'Archivo', run: () => openEditor(k) }));
  items.push(
    { icon: '🌓', label: 'Cambiar tema claro/oscuro', hint: 'Acción', run: () => { settings.theme = settings.theme === 'dark' ? 'light' : 'dark'; saveSettings(); } },
    { icon: '✨', label: 'Activar/desactivar fondo animado', hint: 'Acción', run: () => { settings.qbg = settings.qbg === false; saveSettings(); startBg(); } },
    { icon: '💾', label: 'Exportar respaldo', hint: 'Acción', run: exportBackup },
    { icon: '📥', label: 'Importar respaldo', hint: 'Acción', run: importBackup });
  return items;
}

$('#startBtn').onclick = e => { e.stopPropagation(); const m = $('#menu'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };
$('#palBtn').onclick = openPalette;
document.addEventListener('click', e => { if (!e.target.closest('#menu')) $('#menu').style.display = 'none'; });
$('#desktop').addEventListener('contextmenu', e => {
  if (e.target.closest('.win')) return;
  e.preventDefault();
  showCtx(e.clientX, e.clientY, [
    { label: '➕ Nueva app', run: () => openBuilder() },
    { label: '📁 Archivos', run: () => launch(findApp('files')) },
    { label: '🔍 Buscar…', run: openPalette },
    { label: '⚙️ Ajustes', run: () => launch(findApp('settings')) },
  ]);
});
const tickClock = () => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
tickClock(); setInterval(tickClock, 15000);

applySettings(); refresh(); startBg();

// Reabrir las ventanas de la sesión anterior
if (settings.restore !== false) {
  const prev = LS.get('session', []);
  if (Array.isArray(prev)) prev.slice(0, 8).forEach(id => { const a = typeof id === 'string' && findApp(id); if (a) launch(a); });
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
