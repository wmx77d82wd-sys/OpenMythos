'use strict';
// Qubit Lab: simulador de vector de estado de hasta 5 qubits con circuito editable.
// Una columna con ● (control) y puertas aplica esas puertas controladas: CNOT, Toffoli, etc.

const R2 = Math.SQRT1_2;
const GATES = {
  H: [[[R2, 0], [R2, 0]], [[R2, 0], [-R2, 0]]],
  X: [[[0, 0], [1, 0]], [[1, 0], [0, 0]]],
  Y: [[[0, 0], [0, -1]], [[0, 1], [0, 0]]],
  Z: [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]],
  S: [[[1, 0], [0, 0]], [[0, 0], [0, 1]]],
  T: [[[1, 0], [0, 0]], [[0, 0], [R2, R2]]],
};

// cols: arreglo de columnas; cada columna es un arreglo por qubit con null | 'C' | nombre de puerta
function simulate(n, cols) {
  const N = 1 << n; let re = new Float64Array(N), im = new Float64Array(N); re[0] = 1;
  for (const col of cols) {
    let cm = 0;
    for (let q = 0; q < n; q++) if (col[q] === 'C') cm |= 1 << q;
    for (let k = 0; k < n; k++) {
      const g = GATES[col[k]]; if (!g) continue;
      const [[g00, g01], [g10, g11]] = g, nr = re.slice(), ni = im.slice();
      for (let i = 0; i < N; i++) {
        if (((i >> k) & 1) || (i & cm) !== cm) continue;
        const j = i | (1 << k), ar = re[i], ai = im[i], cr = re[j], ci = im[j];
        nr[i] = g00[0] * ar - g00[1] * ai + g01[0] * cr - g01[1] * ci;
        ni[i] = g00[0] * ai + g00[1] * ar + g01[0] * ci + g01[1] * cr;
        nr[j] = g10[0] * ar - g10[1] * ai + g11[0] * cr - g11[1] * ci;
        ni[j] = g10[0] * ai + g10[1] * ar + g11[0] * ci + g11[1] * cr;
      }
      re = nr; im = ni;
    }
  }
  return { re, im, p: Array.from(re, (r, i) => r * r + im[i] * im[i]) };
}

function toQasm(n, cols) {
  const lines = ['OPENQASM 3.0;', 'include "stdgates.inc";', 'qubit[' + n + '] q;'];
  for (const col of cols) {
    const ctl = [];
    for (let q = 0; q < n; q++) if (col[q] === 'C') ctl.push('q[' + q + ']');
    for (let k = 0; k < n; k++) if (GATES[col[k]]) lines.push((ctl.length ? 'ctrl(' + ctl.length + ') @ ' : '') + col[k].toLowerCase() + ' ' + [...ctl, 'q[' + k + ']'].join(', ') + ';');
  }
  return lines.join('\n') + '\n';
}

function openQubitLab() {
  openWindow('Qubit Lab', '⚛️', b => {
    const MAXQ = 5, COLS = 6, PAL = [...Object.keys(GATES), 'C'];
    const newCols = () => Array.from({ length: COLS }, () => Array(MAXQ).fill(null));
    let n = 3, cols = newCols(), sel = null, shots = null, refocus = null;

    const label = i => '|' + i.toString(2).padStart(n, '0') + '⟩';
    const place = (c, q, g) => { cols[c][q] = g || null; shots = null; draw(); };
    const preset = (nq, cells) => { n = nq; cols = newCols(); cells.forEach(([c, q, g]) => cols[c][q] = g); shots = null; draw(); };
    const PRESETS = {
      Bell: () => preset(2, [[0, 0, 'H'], [1, 0, 'C'], [1, 1, 'X']]),
      GHZ: () => preset(3, [[0, 0, 'H'], [1, 0, 'C'], [1, 1, 'X'], [2, 1, 'C'], [2, 2, 'X']]),
      Toffoli: () => preset(3, [[0, 0, 'X'], [0, 1, 'X'], [1, 0, 'C'], [1, 1, 'C'], [1, 2, 'X']]),
    };

    const draw = () => {
      const { re, im, p } = simulate(n, cols);
      const nq = h('select', { 'aria-label': 'Número de qubits', style: 'width:auto', onchange: e => { n = +e.target.value; shots = null; draw(); } },
        ...[2, 3, 4, 5].map(k => h('option', k === n ? { selected: true } : {}, String(k))));
      const grid = h('table', { style: 'border-collapse:collapse;margin-bottom:8px' });
      for (let q = 0; q < n; q++) {
        const tr = h('tr', {}, h('td', { style: 'padding-right:6px' }, h('code', {}, 'q' + q)));
        cols.forEach((col, c) => {
          const cell = h('td', { class: 'qc', tabindex: 0, role: 'button', 'aria-label': 'q' + q + ' columna ' + (c + 1) + (col[q] ? ': ' + col[q] : '') },
            col[q] === 'C' ? '●' : col[q] || '');
          cell.onclick = () => place(c, q, sel);
          cell.onkeydown = e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refocus = [c, q]; place(c, q, sel); }
            else if (e.key === 'Backspace' || e.key === 'Delete') { refocus = [c, q]; place(c, q, null); }
          };
          cell.ondragover = e => e.preventDefault();
          cell.ondrop = e => { e.preventDefault(); place(c, q, e.dataTransfer.getData('text/plain')); };
          tr.appendChild(cell);
        });
        grid.appendChild(tr);
      }
      const palette = PAL.map(g => h('button', {
        class: 'btn' + (sel === g ? ' primary' : ''), draggable: 'true', 'aria-pressed': String(sel === g),
        onclick: () => { sel = sel === g ? null : g; draw(); },
        ondragstart: e => e.dataTransfer.setData('text/plain', g),
      }, g === 'C' ? '●' : g));

      const total = shots ? shots.reduce((a, c) => a + c, 0) : 0;
      const bars = [];
      p.forEach((v, i) => {
        if (v < 5e-4 && !(shots && shots[i])) return;
        const wd = shots ? shots[i] / total : v;
        const hue = Math.round(((Math.atan2(im[i], re[i]) / (2 * Math.PI)) + 1) % 1 * 360);   // el color codifica la fase
        bars.push(h('div', { style: 'display:flex;gap:8px;align-items:center;margin:2px 0', title: label(i) + '  amplitud ' + re[i].toFixed(3) + (im[i] < 0 ? '' : '+') + im[i].toFixed(3) + 'i' },
          h('code', { style: 'width:64px' }, label(i)),
          h('div', { style: 'flex:1' }, h('div', { class: 'bar2', style: 'width:' + wd * 100 + '%;background:hsl(' + hue + ' 75% 62%)' })),
          h('span', { style: 'width:100px;text-align:right' }, (v * 100).toFixed(1) + '%' + (shots ? ' · ' + shots[i] : ''))));
      });

      b.textContent = '';
      b.append(
        h('div', { class: 'gates' }, h('b', {}, 'Qubits'), nq, h('b', { style: 'margin-left:8px' }, 'Puertas'), ...palette),
        h('div', { class: 'gates' },
          ...Object.keys(PRESETS).map(k => h('button', { class: 'btn', onclick: PRESETS[k] }, k)),
          h('button', { class: 'btn', onclick: () => { cols.push(Array(MAXQ).fill(null)); draw(); } }, '+ columna'),
          h('button', { class: 'btn', onclick: () => { cols = newCols(); shots = null; draw(); } }, 'Limpiar'),
          h('button', { class: 'btn primary', onclick: () => {
            shots = new Array(p.length).fill(0);
            for (let k = 0; k < 1000; k++) { let r = Math.random(), i = 0; while (i < p.length - 1 && r >= p[i]) r -= p[i++]; shots[i]++; }
            draw();
          } }, '×1000'),
          h('button', { class: 'btn', title: 'Guardar como OpenQASM 3 en /circuits/', onclick: () => {
            const path = '/circuits/circuito.qasm'; fs[path] = toQasm(n, cols); saveFs(); notify('Guardado en ' + path); openEditor(path);
          } }, 'QASM')),
        grid, ...bars,
        h('p', { style: 'opacity:.6;font-size:12px' }, 'Color de la barra = fase. Arrastra una puerta a la rejilla, o elige una y haz clic. Supr borra la celda enfocada.'));
      if (refocus) { const cell = grid.querySelector('tr:nth-child(' + (refocus[1] + 1) + ') td:nth-child(' + (refocus[0] + 2) + ')'); refocus = null; if (cell) cell.focus(); }
    };
    draw();
  }, { w: 580, h: 540 });
}
