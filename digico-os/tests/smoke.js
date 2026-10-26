// Pruebas de humo: node tests/smoke.js  (requiere `playwright` con Chromium instalado)
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const URL_ = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want))); if (!ok) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 780 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept('x'));
  await p.goto(URL_);
  const win = () => p.locator('.win').last();
  const rows = async () => (await win().locator('div:has(> code)').allInnerTexts()).map(s => s.replace(/\s+/g, ' '));

  // Qubit Lab
  await p.dblclick('.icon:has-text("Qubit Lab")');
  await p.click('button:text-is("GHZ")'); eq('GHZ', await rows(), ['|000⟩ 50.0%', '|111⟩ 50.0%']);
  await p.click('button:text-is("Toffoli")'); eq('Toffoli', await rows(), ['|111⟩ 100.0%']);
  await p.click('button:text-is("Bell")'); await p.click('button:text-is("H") >> nth=0'); await p.click('.qc >> nth=9');   // H en q1, columna 4 (n=2: q1 empieza en la celda 6)
  await p.click('button:text-is("×1000")');
  eq('shots total', (await win().locator('div:has(> code)').allInnerTexts()).map(s => +s.split('·')[1]).reduce((a, c) => a + c, 0), 1000);
  await p.click('button:text-is("QASM")');
  const qasm = await p.evaluate(() => fs['/circuits/circuito.qasm']);
  eq('QASM header', qasm.split('\n').slice(0, 3), ['OPENQASM 3.0;', 'include "stdgates.inc";', 'qubit[2] q;']);
  eq('QASM has cx', qasm.includes('ctrl(1) @ x q[0], q[1];'), true);

  // XSS: un ícono malicioso no debe crear elementos
  await p.evaluate(() => applySnapshot({ apps: [{ id: 'evil', name: '<b>x</b>', icon: '<img src=x onerror="window.__pwned=1">', type: 'html', content: '<p>hi</p>' }] }));
  await p.waitForTimeout(200);
  eq('no injected <img> in desktop', await p.locator('#icons img, #menu img, .win .bar img').count(), 0);
  eq('not pwned', await p.evaluate(() => window.__pwned || 0), 0);
  await p.dblclick('.icon[aria-label="<b>x</b>"]');
  eq('app name stays text', await win().getAttribute('aria-label'), '<b>x</b>');

  // Snapshot inválido se rechaza / sanea
  eq('bad snapshot throws', await p.evaluate(() => { try { applySnapshot([1]); return 'no'; } catch { return 'throws'; } }), 'throws');
  await p.evaluate(() => applySnapshot({ apps: 'x', settings: { accent: 'url(javascript:1)', theme: 'dark' }, fs: { 'noslash': 'x', '/ok': 'y', '/num': 5 } }));
  eq('sanitized', await p.evaluate(() => [customApps.length, settings.accent, Object.keys(fs)]), [0, '#7c5cff', ['/ok']]);

  // Puente de apps: aislado a /apps/<id>/
  await p.evaluate(() => { customApps.push({ id: 'a1', name: 'Puente', icon: '🧪', type: 'html', content: '<script>os.fs.write("../../escape.txt","hola").then(()=>os.notify("listo"))<\/script>' }); refresh(); });
  await p.dblclick('.icon[aria-label="Puente"]'); await p.waitForTimeout(400);
  eq('bridge scoped', (await p.evaluate(() => Object.keys(fs))).filter(k => k.includes('escape')), ['/apps/a1///escape.txt']);

  // Archivos: renombrar, mover carpeta y borrar
  await p.evaluate(() => { fs['/d/a.txt'] = '1'; fs['/d/s/b.txt'] = '2'; });
  eq('fsMove dir', await p.evaluate(() => { const r = fsMove('/d', '/e'); return [r, Object.keys(fs).filter(k => k.startsWith('/e')).sort()]; }), [true, ['/e/a.txt', '/e/s/b.txt']]);
  eq('fsMove refuses overwrite', await p.evaluate(() => { fs['/f'] = '1'; fs['/g'] = '2'; return fsMove('/f', '/g'); }), false);

  // Paleta Ctrl+K
  await p.keyboard.press('Control+k'); await p.keyboard.type('notas'); await p.keyboard.press('Enter');
  eq('palette opens app', await win().getAttribute('aria-label'), 'Notas');

  // Terminal: Tab y historial
  await p.dblclick('.icon[aria-label="Terminal"]');
  const inp = win().locator('input'); await inp.fill('sto'); await inp.press('Tab'); eq('tab completes', await inp.inputValue(), 'storage ');
  await inp.press('Enter'); await inp.press('ArrowUp'); eq('history', await inp.inputValue(), 'storage');

  // Acoplar ventana al borde izquierdo
  const bar = win().locator('.bar'); const bb = await bar.boundingBox();
  await p.mouse.move(bb.x + 60, bb.y + 10); await p.mouse.down(); await p.mouse.move(2, 300, { steps: 6 }); await p.mouse.up();
  const g = await win().evaluate(e => [e.style.left, e.style.width]); eq('snap left', g, ['0px', '640px']);

  // Sesión: recargar reabre las ventanas
  await p.evaluate(() => LS.set('session', ['notes', 'terminal']));
  await p.reload();
  eq('session restored', await p.locator('.win').count(), 2);

  // Menú contextual del escritorio
  await p.click('#desktop', { button: 'right', position: { x: 900, y: 500 } });
  eq('context menu', await p.locator('#ctx > div').count(), 4);

  eq('page errors', errs, []);
  await browser.close();
})();
