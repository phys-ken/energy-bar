/* 計算用紙（手書き：黒ペンと消しゴムだけ）と電卓（四則・√・かっこ）。試作 proto/scratch.html から移したもの。
 * iPad Safari の対策: touch-action:none、touchstart/move の preventDefault（passive:false）、
 * ペンを一度でも使ったら指（touch）は無視（手のひらで線が出ない）、getCoalescedEvents があれば使う。
 */
'use strict';
const cap = (el, id) => { try { el.setPointerCapture(id); } catch (_) {} };

const Pad = (() => {
  const cv = document.getElementById('pad'), ctx = cv.getContext('2d'), wrap = document.getElementById('padwrap');
  let strokes = [], undo = [], mode = 'pen', curS = null, penSeen = false, store = {}, activeId = null;
  const W = 2.6, ER = 14;
  function resize() {
    const r = wrap.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); ctx.setTransform(d, 0, 0, d, 0, 0); redraw();
  }
  function drawStroke(s) {
    const p = s.p; ctx.strokeStyle = '#111'; ctx.lineWidth = W; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    if (p.length === 1) { ctx.arc(p[0][0], p[0][1], W / 2, 0, 7); ctx.fillStyle = '#111'; ctx.fill(); return; }
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my); }
    const l = p[p.length - 1]; ctx.lineTo(l[0], l[1]); ctx.stroke();
  }
  function redraw() { const r = wrap.getBoundingClientRect(); ctx.clearRect(0, 0, r.width, r.height); strokes.forEach(drawStroke); if (curS) drawStroke(curS); }
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hit = (s, x, y) => s.p.some(([a, b]) => (a - x) ** 2 + (b - y) ** 2 < ER * ER);
  function erase(x, y) { const gone = strokes.filter(s => hit(s, x, y)); if (!gone.length) return; strokes = strokes.filter(s => !hit(s, x, y)); undo.push({ t: 'erase', s: gone }); redraw(); }
  function accept(e) {
    if (e.pointerType === 'pen') { if (!penSeen) { penSeen = true; document.getElementById('penNote').textContent = 'ペンを検出：指・手のひらでは書きません'; } return true; }
    return !penSeen;
  }
  cv.addEventListener('pointerdown', e => {
    if (!accept(e) || activeId !== null) return; e.preventDefault(); activeId = e.pointerId; cap(cv, e.pointerId);
    const [x, y] = pos(e); if (mode === 'pen') { curS = { p: [[x, y]] }; redraw(); } else erase(x, y);
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== activeId) return; e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) { const [x, y] = pos(ev); if (mode === 'pen' && curS) curS.p.push([x, y]); else if (mode === 'era') erase(x, y); }
    if (mode === 'pen') redraw();
  });
  const end = e => { if (e.pointerId !== activeId) return; activeId = null; if (curS) { strokes.push(curS); undo.push({ t: 'add', s: [curS] }); curS = null; redraw(); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  ['touchstart', 'touchmove'].forEach(t => cv.addEventListener(t, e => e.preventDefault(), { passive: false }));
  cv.addEventListener('contextmenu', e => e.preventDefault());
  new ResizeObserver(resize).observe(wrap);
  return {
    setMode(m) { mode = m; cv.style.cursor = m === 'era' ? 'cell' : 'crosshair'; },
    undo() { const u = undo.pop(); if (!u) return; if (u.t === 'add') strokes = strokes.filter(s => !u.s.includes(s)); else strokes.push(...u.s); redraw(); },
    clear() { if (!strokes.length) return; undo.push({ t: 'erase', s: strokes }); strokes = []; redraw(); },
    save(id) { store[id] = { strokes, undo }; },
    load(id) { const s = store[id] || { strokes: [], undo: [] }; strokes = s.strokes; undo = s.undo; redraw(); },
    reset() { store = {}; strokes = []; undo = []; redraw(); },
    count() { return strokes.length; }, _test: { cv },
  };
})();

(() => {
  const sheet = document.getElementById('sheet'), bS = document.getElementById('bSheet');
  const tog = open => { sheet.classList.toggle('open', open); bS.classList.toggle('on', open); };
  bS.onclick = () => tog(!sheet.classList.contains('open'));
  document.getElementById('tClose').onclick = () => tog(false);
  const tPen = document.getElementById('tPen'), tEra = document.getElementById('tEra');
  tPen.onclick = () => { Pad.setMode('pen'); tPen.classList.add('on'); tEra.classList.remove('on'); };
  tEra.onclick = () => { Pad.setMode('era'); tEra.classList.add('on'); tPen.classList.remove('on'); };
  document.getElementById('tUndo').onclick = () => Pad.undo();
  document.getElementById('tClear').onclick = () => Pad.clear();
  const g = document.getElementById('grip'); let y0 = null, h0;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; h0 = sheet.getBoundingClientRect().height; cap(g, e.pointerId); sheet.classList.add('dragging'); });
  g.addEventListener('pointermove', e => { if (y0 === null) return; const h = Math.max(160, Math.min(window.innerHeight - 60, h0 + (y0 - e.clientY))); sheet.style.height = h + 'px'; });
  const up = () => { y0 = null; sheet.classList.remove('dragging'); }; g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  window.closeSheet = () => tog(false);
})();

const Calc = (() => {
  let ex = '', last = null;
  const K = [['7', '8', '9', '÷', '⌫'], ['4', '5', '6', '×', 'C'], ['1', '2', '3', '−', '√'], ['0', '.', '(', ')', '+'], ['x²', '答に入れる', '=']];
  const keys = document.getElementById('ckeys');
  keys.innerHTML = K.flat().map(k => `<button type="button" class="${'÷×−+'.includes(k) && k.length === 1 ? 'op' : k === '=' ? 'eq wide' : k === '答に入れる' ? 'wide small' : ''}" data-k="${k}">${k}</button>`).join('');
  function evaluate(s) {
    let i = 0; const t = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/²/g, '^2');
    const peek = () => t[i], eat = c => { if (t[i] === c) { i++; return true; } return false; };
    function num() { const j = i; while (/[0-9.]/.test(t[i] || '')) i++; if (j === i) throw 0; const v = parseFloat(t.slice(j, i)); if (isNaN(v)) throw 0; return v; }
    function atom() { if (eat('(')) { const v = expr(); eat(')'); return v; } if (eat('√')) { const v = power(); if (v < 0) throw 'neg'; return Math.sqrt(v); } if (eat('-')) return -power(); return num(); }
    function power() { let v = atom(); while (eat('^')) v = Math.pow(v, atom()); return v; }
    function term() { let v = power(); for (;;) { if (eat('*')) v *= power(); else if (eat('/')) { const d = power(); if (d === 0) throw 'div0'; v /= d; } else if (peek() === '(' || peek() === '√') v *= power(); else return v; } }
    function expr() { let v = term(); for (;;) { if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; } }
    const v = expr(); if (i !== t.length) throw 0; return v;
  }
  const fmt = v => { if (!isFinite(v)) return 'エラー'; const r = Math.round(v * 1e10) / 1e10; return String(Math.abs(r) >= 1e9 || (Math.abs(r) < 1e-6 && r !== 0) ? r.toExponential(6) : r); };
  const show = rv => { document.getElementById('dEx').textContent = ex; document.getElementById('dRv').textContent = rv !== undefined ? rv : (ex || '0'); };
  keys.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
    if (k === 'C') { ex = ''; last = null; show(); return; }
    if (k === '⌫') { ex = ex.slice(0, -1); show(); return; }
    if (k === '=') { try { last = evaluate(ex); show(fmt(last)); } catch (err) { show(err === 'div0' ? '0 では割れません' : err === 'neg' ? '√ の中が負' : '式を確かめてください'); } return; }
    if (k === 'x²') { ex += '²'; show(); return; }
    if (k === '答に入れる') { if (last !== null && window.App) window.App.setInput(fmt(last)); return; }
    if (last !== null && /[0-9.√(]/.test(k) && document.getElementById('dRv').textContent !== ex) ex = '';
    last = null; ex += k; show();
  });
  const box = document.getElementById('calc'), bC = document.getElementById('bCalc');
  const tog = open => { box.classList.toggle('open', open); bC.classList.toggle('on', open); };
  bC.onclick = () => tog(!box.classList.contains('open'));
  document.getElementById('cClose').onclick = () => tog(false);
  const h = document.getElementById('calchead'); let o = null;
  h.addEventListener('pointerdown', e => { if (e.target.tagName === 'BUTTON') return; const r = box.getBoundingClientRect(); o = [e.clientX - r.left, e.clientY - r.top]; cap(h, e.pointerId); });
  h.addEventListener('pointermove', e => { if (!o) return; box.style.left = Math.max(0, Math.min(innerWidth - 60, e.clientX - o[0])) + 'px'; box.style.top = Math.max(0, Math.min(innerHeight - 60, e.clientY - o[1])) + 'px'; box.style.right = 'auto'; });
  const up = () => o = null; h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  return { evaluate, fmt, close: () => tog(false), clear: () => { ex = ''; last = null; show(); } };
})();
