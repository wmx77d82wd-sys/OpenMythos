'use strict';
// Servicios externos: asistente de IA (Anthropic) y sincronización (Supabase).

// Asistente: pide a Claude que escriba una app y la instala. La clave se guarda solo en este navegador.
const AI_SYSTEM = 'Eres el generador de apps de DigiCo Quantum OS. Responde SOLO con un objeto JSON: {"name": string, "icon": un emoji, "html": string}. ' +
  '"html" es un documento HTML completo y autocontenido (CSS y JS en línea, sin librerías externas). Corre en un iframe aislado. ' +
  'Puede usar window.os: os.notify(texto), os.fs.read(ruta), os.fs.write(ruta, texto), os.fs.list(), os.fs.remove(ruta); todas devuelven promesas y guardan datos persistentes.';

function parseAppJson(txt) {
  const a = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  if (typeof a.name !== 'string' || typeof a.html !== 'string') throw new Error('Respuesta sin name/html');
  return a;
}

function openAssistant() {
  openWindow('Asistente IA', '🤖', b => {
    const key = h('input', { type: 'password', placeholder: 'sk-ant-...', autocomplete: 'off' });
    const ask = h('textarea', { rows: 4, placeholder: 'Un cronómetro con vueltas que guarde el historial' });
    const out = h('pre', { style: 'white-space:pre-wrap;opacity:.85' });
    const go = h('button', { class: 'btn primary' }, 'Generar e instalar');
    key.value = LS.get('ak', '');
    go.onclick = async () => {
      if (!key.value.trim() || !ask.value.trim()) return notify('Falta la clave o la descripción');
      LS.set('ak', key.value.trim());
      go.disabled = true; out.textContent = 'Generando…';
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 120000);
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': key.value.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 8000, system: AI_SYSTEM, messages: [{ role: 'user', content: ask.value }] }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
        const a = parseAppJson(j.content.map(c => c.text || '').join(''));
        const app = sanitizeApps([{ id: 'app' + Date.now(), name: a.name, icon: a.icon, type: 'html', content: a.html }])[0];
        if (!app) throw new Error('App inválida');
        customApps.push(app); saveApps(); refresh();
        out.textContent = 'Instalada: ' + app.icon + ' ' + app.name; notify('App instalada: ' + app.name); openCustom(app);
      } catch (err) { out.textContent = 'Error: ' + (err.name === 'AbortError' ? 'tiempo de espera agotado' : err.message); }
      clearTimeout(timer); go.disabled = false;
    };
    const forget = h('button', { class: 'btn', onclick: () => { LS.set('ak', ''); key.value = ''; notify('Clave olvidada'); } }, 'Olvidar clave');
    b.append(h('label', {}, 'API key de Anthropic (se guarda solo en este navegador)'), key,
      h('label', {}, '¿Qué app quieres?'), ask, h('p', {}, go, ' ', forget), out);
  }, { w: 480, h: 440 });
}

// Sincronización con Supabase (Auth + PostgREST). Tabla y políticas RLS en sync.sql.
let sbSession = null;   // { token, uid } solo en memoria
function openCloud() {
  openWindow('Nube', '☁️', b => {
    const cfg = LS.get('cloud', { url: '', key: '', email: '' });
    const url = h('input', { placeholder: 'https://xxxx.supabase.co' }), key = h('input'), email = h('input', { type: 'email' }), pw = h('input', { type: 'password' });
    const st = h('div', { style: 'opacity:.85' });
    url.value = cfg.url; key.value = cfg.key; email.value = cfg.email;
    const conf = () => {
      const c = { url: url.value.trim().replace(/\/$/, ''), key: key.value.trim(), email: email.value.trim() };
      if (!/^https:\/\//i.test(c.url)) throw new Error('La URL debe empezar con https://');
      LS.set('cloud', c); return c;
    };
    const say = s => { st.textContent = s; };
    const guard = fn => async () => { try { await fn(); } catch (e) { say('Error: ' + e.message); } };
    const auth = kind => async () => {
      const c = conf();
      const r = await fetch(c.url + (kind === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password'), {
        method: 'POST', headers: { apikey: c.key, 'content-type': 'application/json' },
        body: JSON.stringify({ email: c.email, password: pw.value }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.msg || j.error_description || j.message || r.status);
      if (!j.access_token) throw new Error('Confirma tu correo y luego pulsa Entrar');
      sbSession = { token: j.access_token, uid: j.user.id }; say('Sesión iniciada ✔');
    };
    const rest = (path, opts = {}) => {
      if (!sbSession) throw new Error('Primero entra a tu cuenta');
      const c = conf();
      return fetch(c.url + '/rest/v1/dqos_state' + path, { ...opts, headers: { apikey: c.key, Authorization: 'Bearer ' + sbSession.token, 'content-type': 'application/json', ...opts.headers } });
    };
    const up = guard(async () => {
      const r = await rest('?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ user_id: sbSession && sbSession.uid, data: snapshot(), updated_at: new Date().toISOString() }]) });
      if (!r.ok) throw new Error((await r.json()).message || r.status);
      say('Subido ✔ ' + new Date().toLocaleTimeString()); notify('Sincronizado con la nube');
    });
    const down = guard(async () => {
      const r = await rest('?select=data,updated_at&user_id=eq.' + (sbSession && sbSession.uid));
      const rows = await r.json();
      if (!r.ok) throw new Error(rows.message || r.status);
      if (!rows.length) throw new Error('No hay copia en la nube todavía');
      if (!confirm('Esto reemplaza tus apps y archivos locales con la copia del ' + new Date(rows[0].updated_at).toLocaleString() + '. ¿Seguir?')) return;
      applySnapshot(rows[0].data); say('Descargado ✔');
    });
    b.append(h('label', {}, 'URL del proyecto Supabase'), url, h('label', {}, 'Anon key'), key, h('label', {}, 'Correo'), email, h('label', {}, 'Contraseña'), pw,
      h('p', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn', onclick: guard(auth('signup')) }, 'Crear cuenta'),
        h('button', { class: 'btn', onclick: guard(auth('login')) }, 'Entrar'),
        h('button', { class: 'btn primary', onclick: up }, '⬆️ Subir'),
        h('button', { class: 'btn', onclick: down }, '⬇️ Descargar')), st);
  }, { w: 440, h: 460 });
}
