'use strict';
// Apps integradas: Notas, apps de terceros (con SDK), Archivos, Editor, Builder, Mis Apps, Ajustes y Terminal.

function openNotes() {
  openWindow('Notas', '📝', b => {
    b.style.padding = '0';
    const t = h('textarea', { style: 'height:100%;border:0;border-radius:0', placeholder: 'Escribe aquí…', 'aria-label': 'Notas' });
    t.value = notes;
    t.oninput = () => { notes = t.value; saveNotes(); };
    b.appendChild(t);
  });
}

// ---------- Apps de terceros ----------
// SDK inyectado en las apps HTML: window.os.{notify, fs.read/write/list/remove}
const SDK = '<script>(()=>{let id=0;const p={};addEventListener("message",e=>{const m=e.data;if(m&&m.dqos&&p[m.id]){m.err?p[m.id].rej(new Error(m.err)):p[m.id].res(m.val);delete p[m.id]}});' +
  'const call=(m,a)=>new Promise((res,rej)=>{const i=++id;p[i]={res,rej};parent.postMessage({dqos:1,id:i,m,a},"*")});' +
  'window.os={notify:t=>call("notify",[t]),fs:{read:f=>call("read",[f]),write:(f,c)=>call("write",[f,c]),list:()=>call("list",[]),remove:f=>call("remove",[f])}};})()<\/script>';
const frames = new WeakMap();   // contentWindow -> app

addEventListener('message', e => {
  const m = e.data, app = m && m.dqos && frames.get(e.source);
  if (!app) return;
  const root = '/apps/' + app.id + '/';
  const path = f => root + String(f).replace(/^\/+/, '').replace(/\.\.+/g, '');
  const ops = {
    notify: t => { notify(app.name + ': ' + t); },
    read: f => fs[path(f)] ?? null,
    write: (f, c) => { fs[path(f)] = String(c); saveFs(); },
    list: () => Object.keys(fs).filter(k => k.startsWith(root)).map(k => k.slice(root.length)),
    remove: f => { delete fs[path(f)]; saveFs(); },
  };
  let reply;
  try { reply = { dqos: 1, id: m.id, val: ops[m.m] ? ops[m.m](...m.a) : undefined }; }
  catch (err) { reply = { dqos: 1, id: m.id, err: String(err) }; }
  e.source.postMessage(reply, '*');
});

function openCustom(app) {
  if (app.type === 'url' && !/^https?:\/\//i.test(app.content)) return notify('La URL de ' + app.name + ' debe empezar con http:// o https://');
  openWindow(app.name, app.icon, b => {
    b.style.padding = '0';
    const f = h('iframe', { sandbox: 'allow-scripts allow-forms allow-modals allow-popups', title: app.name });
    if (app.type === 'url') f.src = app.content; else f.srcdoc = SDK + app.content;
    b.appendChild(f);
    frames.set(f.contentWindow, app);
  }, { w: 640, h: 440 });
}

const TEMPLATES = {
  'Vacía': '',
  'Calculadora': ['<input id="e" placeholder="2+2*3" style="width:70%;font-size:20px">',
    '<button onclick="r.textContent=eval(e.value.replace(/[^-+*/().0-9 ]/g,\'\'))">=</button><h2 id="r"></h2>'].join('\n'),
  'Tareas (guarda en archivos)': ['<h3>Tareas</h3><input id="t"><button onclick="add()">+</button><ul id="l"></ul>',
    '<script>let T=[];const draw=()=>l.innerHTML=T.map((x,i)=>"<li onclick=\'T.splice("+i+",1);save()\'>"+x.replace(/</g,"&lt;")+"</li>").join("");',
    'const save=async()=>{await os.fs.write("tareas.json",JSON.stringify(T));draw()};',
    'const add=()=>{if(t.value){T.push(t.value);t.value="";save();os.notify("Tarea agregada")}};',
    'os.fs.read("tareas.json").then(v=>{T=v?JSON.parse(v):[];draw()});<\/script>'].join('\n'),
  'Reloj': '<h1 id="c" style="font-size:48px;text-align:center"></h1><script>setInterval(()=>c.textContent=new Date().toLocaleTimeString(),500)<\/script>',
};

// ---------- Archivos ----------
const TEXT_EXT = /\.(json|md|txt|js|css|html|qasm|csv|xml|svg|ya?ml)$/i;
const safeName = n => { n = (n || '').trim(); return n && !n.includes('/') && n !== '.' && n !== '..' ? n : null; };

function openFiles(startDir) {
  let dir = startDir || '/';
  openWindow('Archivos', '📁', b => {
    const draw = () => {
      b.textContent = '';
      const upload = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: async () => {
        for (const f of upload.files) {
          if (f.size > 1.5e6) { notify(f.name + ' supera 1.5 MB'); continue; }
          const asText = f.type.startsWith('text/') || TEXT_EXT.test(f.name);
          fs[dir + f.name] = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; asText ? r.readAsText(f) : r.readAsDataURL(f); });
        }
        saveFs(); draw();
      } });
      b.append(h('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap' },
        h('button', { class: 'btn', 'aria-label': 'Subir carpeta', onclick: () => { dir = dir.replace(/[^/]+\/$/, '') || '/'; draw(); } }, '⬆️'),
        h('b', { style: 'flex:1' }, dir),
        h('button', { class: 'btn', onclick: () => { const n = safeName(prompt('Nombre del archivo')); if (n) { fs[dir + n] = ''; saveFs(); openEditor(dir + n); draw(); } } }, '+ Archivo'),
        h('button', { class: 'btn', onclick: () => { const n = safeName(prompt('Nombre de la carpeta')); if (n) { fs[dir + n + '/.keep'] = ''; saveFs(); draw(); } } }, '+ Carpeta'),
        h('button', { class: 'btn', onclick: () => upload.click() }, 'Subir'), upload));
      const es = fsEntries(dir);
      if (!es.length) b.append(h('p', {}, 'Carpeta vacía'));
      es.forEach(en => {
        const path = dir + en.name;
        const open = () => en.dir ? (dir += en.name + '/', draw()) : openEditor(path);
        const stop = fn => ev => { ev.stopPropagation(); fn(); };
        b.append(h('div', { class: 'row', tabindex: 0, role: 'button', onclick: open, onkeydown: e => { if (e.key === 'Enter') open(); } },
          h('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis' }, (en.dir ? '📁 ' : '📄 ') + en.name),
          h('small', { style: 'opacity:.6' }, en.dir ? '' : fmtSize(fs[path].length)),
          h('button', { class: 'btn', title: 'Renombrar', 'aria-label': 'Renombrar ' + en.name, onclick: stop(() => {
            const n = safeName(prompt('Nuevo nombre', en.name));
            if (n && n !== en.name) { if (!fsMove(path, dir + n)) notify('No se pudo renombrar (¿ya existe?)'); draw(); }
          }) }, '✏️'),
          en.dir ? '' : h('button', { class: 'btn', title: 'Descargar', 'aria-label': 'Descargar ' + en.name, onclick: stop(() => download(en.name, fs[path])) }, '⬇️'),
          h('button', { class: 'btn', title: 'Borrar', 'aria-label': 'Borrar ' + en.name, onclick: stop(() => { if (confirm('¿Borrar ' + en.name + '?')) { fsRemove(path); draw(); } }) }, '🗑️')));
      });
    };
    draw();
  }, { w: 520, h: 400 });
}

function openEditor(path) {
  openWindow(path.split('/').pop(), '📄', b => {
    const v = fs[path] ?? '', name = path.split('/').pop();
    if (v.startsWith('data:')) {
      if (v.startsWith('data:image/')) b.append(h('img', { src: v, alt: name, style: 'max-width:100%;display:block;margin-bottom:8px' }));
      else b.append(h('p', {}, 'Archivo binario (' + fmtSize(v.length) + ')'));
      b.append(h('button', { class: 'btn', onclick: () => download(name, v) }, '⬇️ Descargar'));
      return;
    }
    const t = h('textarea', { style: 'height:calc(100% - 48px)', 'aria-label': name });
    t.value = v;
    const save = () => { fs[path] = t.value; saveFs(); notify('Guardado ' + path); };
    t.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    b.append(t, h('p', { style: 'margin:8px 0 0' }, h('button', { class: 'btn primary', onclick: save }, 'Guardar'), ' Ctrl/⌘ + S'));
  }, { w: 480, h: 360 });
}

// ---------- Gestión de apps ----------
function openBuilder(editId) {
  const editing = typeof editId === 'string' ? customApps.find(a => a.id === editId) : null;
  openWindow(editing ? 'Editar App' : 'Agregar App', '➕', (b, { close }) => {
    const name = h('input', { placeholder: 'Mi app' }), icon = h('input', { maxlength: 4 });
    const type = h('select', {}, h('option', { value: 'html' }, 'Código HTML/JS'), h('option', { value: 'url' }, 'URL externa (https)'));
    const tpl = h('select', {}, ...Object.keys(TEMPLATES).map(k => h('option', {}, k)));
    const code = h('textarea', { rows: 10, placeholder: '<h1>Hola</h1>' });
    icon.value = '🧩';
    if (editing) { name.value = editing.name; icon.value = editing.icon; type.value = editing.type; code.value = editing.content; }
    tpl.onchange = () => { code.value = TEMPLATES[tpl.value]; type.value = 'html'; };
    const ok = h('button', { class: 'btn primary', onclick: () => {
      if (!name.value.trim() || !code.value.trim()) return notify('Falta nombre o contenido');
      if (type.value === 'url' && !/^https?:\/\//i.test(code.value.trim())) return notify('La URL debe empezar con http:// o https://');
      const data = { name: name.value.trim().slice(0, 60), icon: (icon.value || '🧩').slice(0, 8), type: type.value, content: type.value === 'url' ? code.value.trim() : code.value };
      if (editing) Object.assign(editing, data); else customApps.push({ id: 'app' + Date.now(), ...data });
      saveApps(); refresh(); close();
    } }, editing ? 'Guardar' : 'Instalar');
    b.append(h('label', {}, 'Nombre'), name, h('label', {}, 'Ícono (emoji)'), icon, h('label', {}, 'Tipo'), type,
      h('label', {}, 'Plantilla'), tpl, h('label', {}, 'Contenido (código o URL)'), code, h('p', {}, ok));
  }, { w: 480, h: 540 });
}

function uninstallApp(a) {
  customApps = customApps.filter(x => x !== a); saveApps();
  if (Object.keys(fs).some(k => k.startsWith('/apps/' + a.id + '/')) && confirm('¿Borrar también los datos de ' + a.name + '?')) fsRemove('/apps/' + a.id);
  refresh();
}

function openManager() {
  openWindow('Mis Apps', '🗂️', b => {
    const draw = () => {
      b.textContent = '';
      if (!customApps.length) b.append(h('p', {}, 'No has instalado apps todavía. Usa ➕ Agregar App o 🤖 Asistente IA.'));
      customApps.forEach(a => b.append(h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' },
        h('span', { style: 'flex:1' }, a.icon + ' ', h('b', {}, a.name)),
        h('button', { class: 'btn', onclick: () => openCustom(a) }, 'Abrir'),
        h('button', { class: 'btn', onclick: () => openBuilder(a.id) }, 'Editar'),
        h('button', { class: 'btn', onclick: () => { if (confirm('¿Desinstalar ' + a.name + '?')) { uninstallApp(a); draw(); } } }, 'Borrar'))));
    };
    draw();
  });
}

// ---------- Ajustes ----------
const WALLPAPERS = { 'Cuántico': ['#0b1026', '#3b1d6e'], 'Aurora': ['#06222b', '#0f766e'], 'Atardecer': ['#2b0b1f', '#c2410c'], 'Grafito': ['#111827', '#4b5563'] };

function exportBackup() { download('digico-os-backup.json', JSON.stringify(snapshot(), null, 2)); }
function importBackup() {
  const inp = h('input', { type: 'file', accept: 'application/json' });
  inp.onchange = async () => {
    try { applySnapshot(JSON.parse(await inp.files[0].text())); notify('Respaldo importado'); }
    catch (e) { notify('Archivo inválido: ' + e.message); }
  };
  inp.click();
}
function storageUsed() {
  try { return Object.keys(localStorage).filter(k => k.startsWith('dqos.')).reduce((s, k) => s + (k.length + localStorage.getItem(k).length) * 2, 0); } catch { return 0; }
}

function openSettings() {
  openWindow('Ajustes', '⚙️', b => {
    const theme = h('select', {}, h('option', { value: 'dark' }, 'Oscuro'), h('option', { value: 'light' }, 'Claro'));
    const c1 = h('input', { type: 'color' }), c2 = h('input', { type: 'color' }), ac = h('input', { type: 'color' });
    const qb = h('input', { type: 'checkbox' }), rs = h('input', { type: 'checkbox' });
    theme.value = settings.theme; c1.value = settings.bg1; c2.value = settings.bg2; ac.value = settings.accent;
    qb.checked = settings.qbg !== false; rs.checked = settings.restore !== false;
    theme.onchange = () => { settings.theme = theme.value; saveSettings(); };
    c1.oninput = () => { settings.bg1 = c1.value; saveSettings(); };
    c2.oninput = () => { settings.bg2 = c2.value; saveSettings(); };
    ac.oninput = () => { settings.accent = ac.value; saveSettings(); };
    qb.onchange = () => { settings.qbg = qb.checked; saveSettings(); startBg(); };
    rs.onchange = () => { settings.restore = rs.checked; saveSettings(); };
    const walls = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, ...Object.entries(WALLPAPERS).map(([name, [a, c]]) =>
      h('button', { class: 'swatch', title: name, 'aria-label': 'Fondo ' + name, style: 'background:linear-gradient(135deg,' + c + ',' + a + ')', onclick: () => {
        Object.assign(settings, { bg1: a, bg2: c }); c1.value = a; c2.value = c; saveSettings();
      } })));
    b.append(
      h('label', {}, 'Tema'), theme,
      h('label', {}, 'Fondos'), walls,
      h('label', {}, 'Colores del fondo (oscuro)'), h('div', { style: 'display:flex;gap:8px' }, c1, c2),
      h('label', {}, 'Color de acento'), ac,
      h('label', {}, qb, ' Fondo cuántico animado'),
      h('label', {}, rs, ' Reabrir mis ventanas al recargar'),
      h('p', { style: 'opacity:.7' }, 'Almacenamiento usado: ' + fmtSize(storageUsed()) + ' de ~5 MB'),
      h('p', {}, h('button', { class: 'btn', onclick: exportBackup }, 'Exportar todo (JSON)'), ' ',
        h('button', { class: 'btn', onclick: importBackup }, 'Importar'), ' ',
        h('button', { class: 'btn', onclick: () => { LS.set('ak', ''); notify('Clave de la IA olvidada'); } }, 'Olvidar clave IA'), ' ',
        h('button', { class: 'btn', onclick: () => { if (confirm('¿Borrar todo?')) { Object.keys(localStorage).filter(k => k.startsWith('dqos.')).forEach(k => localStorage.removeItem(k)); location.reload(); } } }, 'Restablecer')));
  }, { w: 440, h: 520 });
}

// ---------- Terminal ----------
function openTerminal() {
  openWindow('Terminal', '⌨️', b => {
    b.style.padding = '0';
    const out = h('div', {}, 'DigiCo Quantum OS — escribe "help"\n');
    const inp = h('input', { 'aria-label': 'Comando', autocomplete: 'off', spellcheck: 'false' });
    const term = h('div', { class: 'term' }, out, '$ ', inp);
    b.append(term);
    const print = s => { out.textContent += s + '\n'; term.scrollTop = term.scrollHeight; };
    const all = () => [...builtins, ...customApps];
    const find = n => all().find(a => a.id === n || a.name.toLowerCase() === n.toLowerCase());
    const cmds = {
      help: () => print('help | apps | open <app> | install <nombre> <url> | remove <app> | theme dark|light\nls [dir] | cat <f> | write <f> <txt> | rm <f> | notify <txt> | storage | date | clear | echo <txt>\n(escritorio) host ls|cat|write|rm <ruta> | sh <comando>\nTab completa, ↑/↓ historial.'),
      ls: a => { let d = absPath(a[0] || '/'); if (!d.endsWith('/')) d += '/'; const es = fsEntries(d); print(es.length ? es.map(e => (e.dir ? '📁 ' : '📄 ') + e.name).join('\n') : '(vacío)'); },
      cat: a => print(fs[absPath(a[0] || '')] ?? 'No existe'),
      write: a => { fs[absPath(a[0] || '')] = a.slice(1).join(' '); saveFs(); },
      rm: a => { const p = absPath(a[0] || ''); print(p in fs ? (fsRemove(p), 'Borrado') : 'No existe'); },
      notify: a => notify(a.join(' ')),
      storage: () => print(fmtSize(storageUsed()) + ' de ~5 MB'),
      // Solo en la app de escritorio (Electron): archivos reales en ~/DigiCoOS y comandos del sistema
      host: async a => {
        const hb = window.hostBridge;
        if (!hb) return print('Disponible solo en la app de escritorio (ver README)');
        const [c, f = '.', ...rest] = a;
        try {
          if (c === 'ls') print((await hb.list(f)).join('\n') || '(vacío)');
          else if (c === 'cat') print(await hb.read(f));
          else if (c === 'write') { await hb.write(f, rest.join(' ')); print('Escrito'); }
          else if (c === 'rm') { await hb.remove(f); print('Borrado'); }
          else print('uso: host ls|cat|write|rm <ruta> [texto]');
        } catch (e) { print('Error: ' + e.message); }
      },
      sh: async a => {
        if (!window.hostBridge) return print('Disponible solo en la app de escritorio');
        const r = await window.hostBridge.exec(a.join(' '));
        print((r.stdout || '') + (r.stderr || '') + (r.code ? '[código ' + r.code + ']' : ''));
      },
      apps: () => print(all().map(a => a.icon + ' ' + a.name).join('\n')),
      open: a => { const x = find(a.join(' ')); x ? launch(x) : print('No existe: ' + a.join(' ')); },
      install: a => {
        if (a.length < 2 || !/^https?:\/\//i.test(a[1])) return print('uso: install <nombre> <url http(s)>');
        customApps.push({ id: 'app' + Date.now(), name: a[0], icon: '🌐', type: 'url', content: a[1] }); saveApps(); refresh(); print('Instalada ' + a[0]);
      },
      remove: a => { const x = customApps.find(y => y.name.toLowerCase() === a.join(' ').toLowerCase()); if (!x) return print('No encontrada'); uninstallApp(x); print('Eliminada'); },
      theme: a => { settings.theme = a[0] === 'light' ? 'light' : 'dark'; saveSettings(); },
      date: () => print(new Date().toString()),
      clear: () => { out.textContent = ''; },
      echo: a => print(a.join(' ')),
    };
    const hist = []; let hi = 0;
    const complete = () => {
      const v = inp.value, m = v.match(/^(\S+)\s+(.*)$/);
      let pool, prefix, head = '';
      if (!m) { pool = Object.keys(cmds); prefix = v; }
      else if (m[1] === 'open' || m[1] === 'remove') { pool = all().map(a => a.name); prefix = m[2]; head = m[1] + ' '; }
      else { pool = Object.keys(fs); const last = v.split(/\s+/).pop(); prefix = last; head = v.slice(0, v.length - last.length); }
      const hits = pool.filter(x => x.toLowerCase().startsWith(prefix.toLowerCase()));
      if (hits.length === 1) inp.value = head + hits[0] + (m ? '' : ' ');
      else if (hits.length > 1) print(hits.join('  '));
    };
    inp.onkeydown = e => {
      if (e.key === 'ArrowUp') { if (hist.length) { hi = Math.max(0, hi - 1); inp.value = hist[hi]; } e.preventDefault(); }
      else if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] || ''; e.preventDefault(); }
      else if (e.key === 'Tab') { e.preventDefault(); complete(); }
      else if (e.key === 'Enter') {
        const line = inp.value.trim(); inp.value = ''; print('$ ' + line);
        if (!line) return;
        hist.push(line); hi = hist.length;
        const [c, ...a] = line.split(/\s+/);
        Promise.resolve((cmds[c] || (() => print('Comando desconocido: ' + c)))(a)).catch(err => print('Error: ' + err.message));
      }
    };
    term.onclick = () => inp.focus();
    inp.focus();
  });
}
