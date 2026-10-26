// Asistente IA y Nube con las APIs simuladas (no usa claves reales). node tests/services.js
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want))); if (!ok) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch(); const p = await browser.newPage({ viewport: { width: 1280, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const calls = [];
  await p.route('https://api.anthropic.com/**', r => {
    calls.push(['anthropic', r.request().headers()['x-api-key']]);
    r.fulfill({ json: { content: [{ type: 'text', text: '```json\n{"name":"Cronómetro","icon":"<img src=x onerror=window.__p=1>","html":"<h1 id=x>ok</h1>"}\n```' }] } });
  });
  await p.route('https://demo.supabase.co/**', r => {
    const u = r.request().url(), m = r.request().method(); calls.push([m, u.replace('https://demo.supabase.co', '')]);
    if (u.includes('/auth/v1/token')) return r.fulfill({ json: { access_token: 'tok', user: { id: 'uid-1' } } });
    if (m === 'POST') return r.fulfill({ status: 201, body: '' });
    return r.fulfill({ json: [{ data: { apps: [{ id: 'a9', name: 'Remota', icon: '🛰️', type: 'html', content: '<p>r</p>' }], fs: { '/r.txt': 'x' } }, updated_at: new Date().toISOString() }] });
  });
  await p.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  const win = () => p.locator('.win').last();

  await p.dblclick('.icon[aria-label="Asistente IA"]');
  await win().locator('input').fill('sk-test'); await win().locator('textarea').fill('cronómetro'); await win().locator('button:text-is("Generar e instalar")').click();
  await p.waitForSelector('.icon[aria-label="Cronómetro"]');
  eq('assistant installed + icon sanitized', await p.evaluate(() => [customApps.at(-1).name, customApps.at(-1).icon.length <= 8, window.__p || 0]), ['Cronómetro', true, 0]);
  eq('iframe runs', await p.frameLocator('iframe').first().locator('#x').textContent(), 'ok');
  await win().locator('button:text-is("Olvidar clave")').count();

  await p.dblclick('.icon[aria-label="Nube"]');
  const c = win(), ins = c.locator('input');
  await ins.nth(0).fill('https://demo.supabase.co'); await ins.nth(1).fill('anon'); await ins.nth(2).fill('a@b.co'); await ins.nth(3).fill('pw');
  await c.locator('button:text-is("Entrar")').click(); await c.locator('button:text-is("⬆️ Subir")').click(); await p.waitForTimeout(300);
  await c.locator('button:text-is("⬇️ Descargar")').click(); await p.waitForTimeout(300);
  eq('pulled remote app', await p.evaluate(() => customApps.map(a => a.name)), ['Remota']);
  eq('api calls', calls.map(x => x[0] === 'anthropic' ? x : [x[0], x[1].split('?')[0]]), [['anthropic', 'sk-test'], ['POST', '/auth/v1/token'], ['POST', '/rest/v1/dqos_state'], ['GET', '/rest/v1/dqos_state']]);

  await ins.nth(0).fill('http://insecure.example'); await c.locator('button:text-is("Entrar")').click(); await p.waitForTimeout(100);
  eq('rejects non-https url', (await c.innerText()).includes('https://'), true);
  eq('page errors', errs, []);
  await browser.close();
})();
