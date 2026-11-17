/* シミュレーション: ばね → 粗い面 → 斜面 の台車（docs/decisions.md の 13）。物理は lib/simcore.js。
 * 黒板に映す（iPad → プロジェクター）のが基本。黒い画面が既定で、線は太く、字は大きく。
 * 場面はプリセット（登りきる・途中で折り返す・粗い面で止まる・行ったり来たりして止まる）から選ぶ。
 * カスタムだけ、縮み・粗い面の長さ・斜面の高さを動かせる（質量・ばね定数・摩擦力は決めておく）。
 * 棒グラフは「はじめ ｜ いま」。摩擦力の仕事はその間の上向きの矢印（箱の値はそれまでの合計）。
 * 予想: 点を選ぶ → 棒を指でかく → 走らせる → その点で止まる。予想は「いま」の棒に黄色の点線の枠で重ねる。
 * 基準面の点線は指で上下できる（物体より上にすると重力の棒は負）。
 * URL: ?test で自己テスト（body の data-test）。?p=プリセット&t=秒&ref=&pt=A|B|C&light で見本の画面
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const UIFONT = '"BIZ UDPGothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif';
  EBar.setFonts(UIFONT);
  const G = ESim.GEO;
  const qs = new URLSearchParams(location.search);

  // 決めておく値（カスタムでも動かさない）
  const FIX = { m: 1.0, k: 200, f: 2.0 };
  const PRESETS = [
    { id: 'climb', nm: '斜面を登りきる', x: 0.20, d: 0.3, h: 0.20 },
    { id: 'turn', nm: '斜面の途中で折り返す', x: 0.20, d: 0, h: 0.60 },
    { id: 'stop', nm: '粗い面で止まる', x: 0.10, d: 0.6, h: 0.20 },
    { id: 'back', nm: '行ったり来たりして止まる', x: 0.20, d: 0.3, h: 0.40 },
    { id: 'custom', nm: 'カスタム' },
  ];
  const SL = [
    { key: 'x', nm: 'ばねの縮み', unit: 'm', min: 0.05, max: 0.30, step: 0.01 },
    { key: 'd', nm: '粗い面の長さ', unit: 'm', min: 0, max: 0.6, step: 0.1 },
    { key: 'h', nm: '斜面の高さ', unit: 'm', min: 0, max: 0.8, step: 0.05 },
  ];
  const PT = { A: 'ばねを離れた所', B: '斜面の下', C: '斜面の上' };

  const P = Object.assign({ ref: 0 }, FIX, { x: 0.20, d: 0.3, h: 0.20 });
  let preset = 'climb', dark = !qs.has('light');
  let st = ESim.init(P), running = false, slow = false, last = 0;
  const pred = { on: false, pt: null, val: null, shown: false, atPt: false };

  const fmt2 = v => { const a = Math.abs(v); if (a < 0.005) return '0'; const t = a >= 100 ? String(Math.round(a)) : String(+a.toPrecision(2)); return (v < 0 ? '−' : '') + (a < 10 && !t.includes('.') ? t + '.0' : t); };
  const hasFric = () => P.f > 0 && P.d > 0;

  /* 目盛り: 走るあいだ動かさない。値の幅から 1 目盛りを 1・2・5 × 10ⁿ で決める */
  function scale() {
    const Us0 = 0.5 * P.k * P.x * P.x, Ugf = P.m * ESim.g * (0 - P.ref), E0 = Us0 + Ugf;
    const Ugh = P.m * ESim.g * (P.h - P.ref);
    const max = Math.max(Us0, E0, Ugf, Math.min(Ugh, Math.max(E0, 0)), 0);
    const min = Math.min(0, Ugf, E0, Ugh < 0 ? Math.max(Ugh, Ugf) : 0);
    const raw = Math.max((max - min) / 8, 0.01), e = Math.pow(10, Math.floor(Math.log10(raw)));
    const unit = [1, 2, 5, 10].map(k => k * e).find(u => u >= raw - 1e-12);
    return { unit, max, min };
  }
  // 棒の数値は 0.1 J 刻み程度（目盛りから決める）。細かく出すと隣の棒の数値と重なった
  const rd = v => { const q = Math.pow(10, Math.floor(Math.log10(scale().unit / 5) + 1e-9)); return +(Math.round(v / q) * q).toPrecision(6); };

  /* ── コース（自前で描く。教室の後ろから見えるよう線を太く、字を大きく） ── */
  const U = 100;                       // 1 m = 100
  const X = x => x * U, Y = y => -y * U;
  const xEnd = G.foot + G.run + G.plat;
  const pal = () => dark
    // 灰色は黒地で暗すぎると後ろの席から読めない（初見のレビュー 2026-11-17）ので明るめ
    ? { bg: '#0e1210', ink: '#f2f2ea', grey: '#c3c8bf', hi: '#ffd84d', fill: '#1d2420' }
    : { bg: '#ffffff', ink: '#151515', grey: '#6f6f6f', hi: '#c62828', fill: '#ffffff' };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const n1 = v => +v.toFixed(1);
  function courseSVG() {
    const c = pal(), w = ESim.where(P, st.s), cmp = ESim.comp(st.s), cs = ESim.course(P);
    const ln = (x1, y1, x2, y2, col, sw, dash) => `<line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    const tx = (x, y, s, fs, col, anchor = 'middle', wt = 700) => `<text x="${n1(x)}" y="${n1(y)}" font-size="${fs}" font-weight="${wt}" fill="${col}" text-anchor="${anchor}" font-family='${UIFONT}'>${esc(s)}</text>`;
    const head = (x, y, ux, uy, col, L, hw) => `<polygon points="${n1(x)},${n1(y)} ${n1(x - ux * L - uy * hw)},${n1(y - uy * L + ux * hw)} ${n1(x - ux * L + uy * hw)},${n1(y - uy * L - ux * hw)}" fill="${col}"/>`;
    // 余白は最小に（上の空きは A・B・C の文字と左上の速さの表示のぶんだけ）
    const top = Y(P.h + 0.55), bot = 36, left = -22, right = X(xEnd) + 92;
    let g = `<rect x="${left}" y="${top}" width="${right - left}" height="${bot - top}" fill="${c.bg}"/>`;
    // 基準面（指で上下に動かす）。床や台より先に描く（上に描くと、床と重なったとき床が点線に見えた）
    const yr = Y(P.ref);
    g += ln(-20, yr, right - 4, yr, c.grey, 2, '7 5');
    g += tx(right - 4, P.ref < 0 ? yr - 6 : yr + 21, '基準面 ⇕', 16, c.grey, 'end');
    // 床（下に短い斜線）と粗い面（太線＋濃い斜線）
    for (let x = -10; x < X(xEnd); x += 9) g += ln(x + 6, 1.5, x, 7.5, c.grey, 1.2);
    g += ln(-10, 0, X(xEnd), 0, c.ink, 2.6);
    if (hasFric()) {
      for (let x = X(G.r0); x < X(G.r0 + P.d) - 2; x += 4) g += ln(x + 5, 3, x, 9, c.ink, 1.6);
      g += `<rect x="${X(G.r0)}" y="-3.5" width="${X(P.d)}" height="7" fill="${c.ink}"/>`;
      g += tx(X(G.r0 + P.d / 2), 30, '粗い面', 16, c.ink);
    }
    // 壁
    g += ln(0, 0, 0, -44, c.ink, 2.6);
    for (let y = -40; y < 0; y += 8) g += ln(0, y, -6, y + 6, c.grey, 1.2);
    // 斜面と上の台
    if (P.h > 0) {
      g += `<polygon points="${X(G.foot)},0 ${X(G.foot + G.run)},${n1(Y(P.h))} ${X(xEnd)},${n1(Y(P.h))} ${X(xEnd)},0" fill="${c.fill}" stroke="${c.ink}" stroke-width="2.6" stroke-linejoin="round"/>`;
      // 高さ（両矢印）
      const dx = X(xEnd) + 14;
      g += ln(dx, Y(P.h) + 6, dx, -6, c.ink, 1.6) + head(dx, Y(P.h), 0, -1, c.ink, 7, 3.2) + head(dx, 0, 0, 1, c.ink, 7, 3.2);
      // 高さの数値は矢印の右（「基準面」の字は線の下に書くので重ならない。台の中に書くと低い台からはみ出した）
      g += tx(dx + 6, Y(P.h / 2) + 6, `${fmt2(P.h)} m`, 17, c.ink, 'start');
    }
    // 予想の点 A・B・C
    for (const k of 'ABC') {
      const q = ESim.where(P, cs.points[k]), on = pred.on && pred.pt === k;
      g += ln(X(q.x), Y(q.y) - 6, X(q.x), Y(q.y) - 31, on ? c.hi : c.grey, 1.4, '4 4');
      g += tx(X(q.x), Y(q.y) - 36, k, on ? 22 : 18, on ? c.hi : c.grey);
    }
    // ばね（ジグザグ。台車の車体の高さ）
    const sx2 = X(G.L0 - cmp), sy = -13, n = 10, amp = 5.5;
    let pts = `0,${sy} 4,${sy}`;
    for (let i = 0; i < n; i++) { const x = 4 + (sx2 - 8) * (i + 0.5) / n; pts += ` ${n1(x)},${sy + (i % 2 ? amp : -amp)}`; }
    pts += ` ${n1(sx2 - 4)},${sy} ${n1(sx2)},${sy}`;
    g += `<polyline points="${pts}" fill="none" stroke="${c.ink}" stroke-width="2" stroke-linejoin="round"/>`;
    // 台車（幅 0.25 m）
    const cx = X(w.x), cy = Y(w.y), hw = G.hw * U;
    g += `<g transform="translate(${n1(cx)} ${n1(cy)}) rotate(${n1(-w.ang)})">` +
      `<rect x="${-hw}" y="-21" width="${2 * hw}" height="13" rx="1.5" fill="${c.fill}" stroke="${c.ink}" stroke-width="2.6"/>` +
      `<circle cx="${-hw + 6}" cy="-4" r="4" fill="${c.bg}" stroke="${c.ink}" stroke-width="2.2"/>` +
      `<circle cx="${hw - 6}" cy="-4" r="4" fill="${c.bg}" stroke="${c.ink}" stroke-width="2.2"/></g>`;
    // 速さの矢印（台車の上、動く向き。長さは速さに比例）
    if (Math.abs(st.v) > 0.05) {
      const a = w.ang * Math.PI / 180, sg = Math.sign(st.v), ux = Math.cos(a) * sg, uy = -Math.sin(a) * sg;
      const bx = cx - Math.sin(a) * 30, by = cy - Math.cos(a) * 30, L = Math.min(10 + Math.abs(st.v) * 12, 48);
      const ex = bx + ux * L, ey = by + uy * L;
      g += ln(bx, by, ex - ux * 6, ey - uy * 6, c.ink, 3) + head(ex, ey, ux, uy, c.ink, 9, 4.5);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${n1(top)} ${right - left} ${n1(bot - top)}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
  }

  /* ── 棒グラフ ── */
  const CH = () => ({ theme: dark ? 'chalk' : 'color', fs: 5.6, fsName: 4.6, fsTitle: 5.6, fsWork: 4.4, fmt: 'sig2', ref: true, barGap: 7, sepGap: 6, lwk: 1.7 });
  // スマホの幅では矢印の下の文を図に入れず、図の下に 1 行で出す（文の幅のぶん棒グラフが小さくなった）
  const narrow = () => window.innerWidth < 600;
  const FRIC = '摩擦力が台車に\n負の仕事をした';
  const fricText = () => narrow() ? null : FRIC;
  function startState() {
    const e = ESim.energies(P, ESim.init(P));
    return { title: 'はじめ', K: 0, Us: rd(e.Us), Ug: rd(e.Ug) };
  }
  function nowState(title) {
    const e = ESim.energies(P, st);
    return { title, K: rd(e.K), Us: rd(e.Us), Ug: rd(e.Ug) };
  }
  const reserve = () => hasFric() ? [{ W: 0, blank: true, text: fricText() }] : [];
  function chartOpt(extra) { return Object.assign(CH(), scale(), extra || {}); }
  // 予想の棒を「いま」の場面に黄色の点線の枠で重ねる
  function predOverlay(states, opt) {
    if (!pred.on || !pred.val) return '';
    const L = EBar.layout(states, opt), T = EBar.THEMES[opt.theme];
    const v = Object.assign({}, pred.val), sw = 0.9;
    v.sum = v.K + v.Us + v.Ug;
    let s = '';
    ['K', 'Us', 'Ug', 'sum'].forEach((k, j) => {
      const h = v[k] / L.unit * L.mpu, x = L.barX(1, j), y = Math.min(L.baseY, L.baseY - h);
      if (Math.abs(h) < 0.01) s += `<line x1="${x}" y1="${L.baseY}" x2="${x + L.bw}" y2="${L.baseY}" stroke="${T.answer}" stroke-width="${sw * 1.6}"/>`;
      else s += `<rect x="${x - 0.8}" y="${y}" width="${L.bw + 1.6}" height="${Math.abs(h)}" fill="none" stroke="${T.answer}" stroke-width="${sw}" stroke-dasharray="1.6 1.0"/>`;
    });
    s += `<text x="${L.xPanel(1) + L.panelW}" y="${L.top - 1.5}" font-size="4.2" font-weight="700" fill="${T.answer}" text-anchor="end" font-family='${UIFONT}'>┅ 予想</text>`;
    return s;
  }
  function liveChart() {
    const title = pred.atPt ? `${pred.pt} の点` : 'いま';
    const works = hasFric() ? [rd(st.Wf) > 0 ? { W: -rd(st.Wf), text: fricText() } : reserve()[0]] : [];
    const states = [startState(), nowState(title)], opt = chartOpt({ works });
    opt.extra = predOverlay(states, opt);
    return EBar.chart(states, opt);
  }
  // 予想をかく図（走らせる前）。「いま」の場所に、指でかく 3 本
  const predStates = () => [startState(), Object.assign({ title: `${pred.pt} の点（予想）`, answer: true }, pred.val)];
  const drawing = () => pred.on && pred.pt && st.t === 0 && !running;
  function chartSVG() { return drawing() ? EBar.chart(predStates(), chartOpt({ works: reserve() })) : liveChart(); }

  function fit(svgHtml) {   // 枠いっぱいに縮める（縦横比は保つ）
    return svgHtml.replace(/<svg([^>]*?) width="[^"]*" height="[^"]*"/, '<svg$1 preserveAspectRatio="xMidYMid meet"');
  }
  function render() {
    $('course').innerHTML = courseSVG();
    $('chart').innerHTML = fit(chartSVG());
    $('chart').classList.toggle('draw', drawing());
    $('fricCap').classList.toggle('hidden', !(narrow() && hasFric() && rd(st.Wf) > 0 && !drawing()));
    const e = ESim.energies(P, st);
    $('readout').textContent = `速さ ${fmt2(Math.abs(st.v))} m/s　高さ ${fmt2(e.y)} m`;
    $('bRun').textContent = running ? '⏸ 止める' : (st.t === 0 ? '▶ 走らせる' : '▶ 続ける');
    $('bRun').disabled = !running && (st.done === 'friction' || st.done === 'end');
  }
  function renderBars() {
    $('preset').value = preset;
    $('custom').classList.toggle('hidden', preset !== 'custom');
    $('bPredict').classList.toggle('on', pred.on);
    $('predPts').classList.toggle('hidden', !pred.on);
    $('predPts').innerHTML = '<span>どの点で予想？</span>' + 'ABC'.split('').map(k => `<button type="button" data-pt="${k}" class="${pred.pt === k ? 'on' : ''}">${k} ${PT[k]}</button>`).join('');
    $('predPts').querySelectorAll('button').forEach(b => b.onclick = () => {
      pred.pt = b.dataset.pt; resetRun(); renderBars(); render();
      msg(`${pred.pt} の点を通るときの棒を、下の図に指でかいてから「走らせる」。`);
    });
    $('bTheme').textContent = dark ? '☀' : '🌙';
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name=theme-color]').content = dark ? '#0e1210' : '#fbfbf7';
  }
  function setPreset(id) {
    preset = id;
    const p = PRESETS.find(q => q.id === id);
    if (p && p.x != null) Object.assign(P, { x: p.x, d: p.d, h: p.h });
    P.ref = Math.min(P.ref, P.h + 0.5);
    SL.forEach(s => { $('s_' + s.key).value = P[s.key]; showVal(s); });
    resetRun(); renderBars(); render();
  }

  /* ── 動かす ── */
  const target = () => pred.on && pred.pt && !pred.shown ? ESim.course(P).points[pred.pt] : null;
  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05) * (slow ? 0.25 : 1); last = now;
    ESim.step(P, st, dt, target());
    if (st.done) { running = false; done(); }
    render();
    if (running) requestAnimationFrame(frame);
  }
  function done() {
    const lost = `摩擦力が負の仕事をして、力学的エネルギーが ${fmt2(st.Wf)} J 減りました。`;
    if (st.done === 'friction') msg(`粗い面の上で止まりました。${lost}`);
    else if (st.done === 'end') msg('台の右端に着きました。' + (st.Wf > 0.004 ? lost : ''));
    else if (st.done === 'target') { pred.shown = true; pred.atPt = true; msg(`${pred.pt} の点に着きました。黄色の点線（予想）と比べよう。`); st.done = null; }
    else if (st.done === 'short') { pred.shown = true; msg(`${pred.pt} の点まで上がれずに引き返しました（いちばん高い所で止めています）。`); st.done = null; }
  }
  function msg(t) { $('msg').textContent = t; }
  function resetRun() {
    running = false; st = ESim.init(P); pred.shown = false; pred.atPt = false; msg('');
    if (pred.on && pred.pt) pred.val = pred.val || { K: 0, Us: 0, Ug: 0 };
  }

  $('bRun').onclick = () => {
    if (running) { running = false; render(); return; }
    if (pred.on && !pred.pt) { msg('予想する点を選んでください。'); return; }
    if (st.t === 0) msg('');
    pred.atPt = false;
    running = true; last = performance.now(); requestAnimationFrame(frame); render();
  };
  $('bReset').onclick = () => { resetRun(); render(); };
  $('bSlow').onclick = () => { slow = !slow; $('bSlow').classList.toggle('on', slow); };
  $('bPredict').onclick = () => {
    pred.on = !pred.on; pred.val = null; if (!pred.on) pred.pt = null;
    resetRun(); renderBars(); render();
    if (pred.on) msg('予想する点を選んでください。');
  };
  $('bTheme').onclick = () => { dark = !dark; renderBars(); render(); };

  /* 全画面（iPad の Safari は要素の全画面に対応。iPhone は対応しないのでボタンを出さない） */
  const root = document.documentElement;
  const reqFS = root.requestFullscreen || root.webkitRequestFullscreen;
  const exitFS = document.exitFullscreen || document.webkitExitFullscreen;
  const isFS = () => document.fullscreenElement || document.webkitFullscreenElement;
  if (!reqFS) $('bFull').classList.add('hidden');
  $('bFull').onclick = () => { if (isFS()) exitFS.call(document); else reqFS.call(root); };
  // 2 本指の拡大・ダブルタップの拡大で画面がずれないように
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  // 向きを変えた・全画面にしたとき、図を描き直す（スマホの幅かどうかで矢印の文の置き場所が変わる）
  window.addEventListener('resize', () => render());

  /* 場面はプルダウン（ボタンを 5 つ並べると 1 行を取り、図が小さくなった） */
  $('preset').innerHTML = PRESETS.map(p => `<option value="${p.id}">${p.nm}</option>`).join('');
  $('preset').addEventListener('change', e => setPreset(e.target.value));

  /* カスタムのスライダー */
  $('custom').innerHTML = SL.map(s => `<label class="sl"><span class="nm">${s.nm}</span><span class="val" id="v_${s.key}"></span>` +
    `<input type="range" id="s_${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${P[s.key]}"></label>`).join('') +
    `<span class="fixed">質量 ${FIX.m.toFixed(1)} kg・ばね定数 ${FIX.k} N/m・摩擦力 ${FIX.f.toFixed(1)} N（粗い面の長さ 0 で摩擦なし）</span>`;
  function showVal(s) { $('v_' + s.key).textContent = `${P[s.key].toFixed((String(s.step).split('.')[1] || '').length)} ${s.unit}`; }
  SL.forEach(s => {
    showVal(s);
    $('s_' + s.key).addEventListener('input', e => {
      P[s.key] = +e.target.value; showVal(s);
      if (s.key === 'h') P.ref = Math.min(P.ref, P.h + 0.5);
      resetRun(); render();
    });
  });

  const toSvg = (svg, e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  /* 基準面を指で上下（0.05 m 刻み、床より 0.2 m 下 〜 台の上より 0.5 m 上） */
  (function bindRef() {
    const box = $('course'); let drag = false;
    const set = e => {
      const y = -toSvg(box.querySelector('svg'), e).y / U, v = Math.round(y / 0.05) * 0.05;
      const nv = Math.max(-0.2, Math.min(P.h + 0.5, +v.toFixed(2)));
      if (nv !== P.ref) { P.ref = nv; render(); }
    };
    box.addEventListener('pointerdown', e => {
      const svg = box.querySelector('svg'); if (!svg) return;
      if (Math.abs(toSvg(svg, e).y - Y(P.ref)) > 16) return;
      drag = true; e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch (_) { /* 古いブラウザ */ }
    });
    box.addEventListener('pointermove', e => { if (drag) set(e); });
    const up = () => { drag = false; };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  })();

  /* 予想の棒を指でかく（「はじめ」の右の場面の 3 本。1 目盛り刻み。重力だけ負にもできる） */
  (function bindPred() {
    const box = $('chart'); let col = null;
    const geo = () => EBar.layout(predStates(), chartOpt({ works: reserve() }));
    const set = e => {
      const L = geo(), k = ['K', 'Us', 'Ug'][col];
      let v = Math.round((L.baseY - toSvg(box.querySelector('svg'), e).y) / L.mpu) * L.unit;
      v = Math.min(L.unitsUp * L.unit, Math.max(k === 'Ug' ? -L.unitsDown * L.unit : 0, v));
      pred.val[k] = +v.toPrecision(6);
      $('chart').innerHTML = fit(chartSVG());
    };
    box.addEventListener('pointerdown', e => {
      if (!drawing()) return;
      const svg = box.querySelector('svg'), L = geo(), p = toSvg(svg, e); col = null;
      for (let j = 0; j < 3; j++) { const x = L.barX(1, j); if (p.x >= x - L.gap / 2 && p.x <= x + L.bw + L.gap / 2) col = j; }
      if (col === null) return;
      e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch (_) { /* 古いブラウザ */ }
      set(e);
    });
    box.addEventListener('pointermove', e => { if (col !== null) set(e); });
    const up = () => { col = null; };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  })();

  // 見本の画面: ?p=プリセット&t=秒&ref=&pt=
  setPreset(qs.get('p') || 'climb');
  if (qs.has('ref')) P.ref = +qs.get('ref');
  if (qs.has('pt')) { pred.on = true; pred.pt = qs.get('pt'); resetRun(); pred.val = { K: 2, Us: 0, Ug: 1 }; renderBars(); }
  if (qs.has('t')) { const T = +qs.get('t'); while (!st.done && st.t < T) ESim.step(P, st, 1 / 60, target()); if (st.done) done(); }
  render();

  /* ── 自己テスト ── */
  if (qs.has('test')) {
    const ng = [];
    const runAll = () => { let n = 0; while (!st.done && n++ < 40000) ESim.step(P, st, 1 / 60, target()); };
    const expect = { climb: 'end', turn: null, stop: 'friction', back: 'friction' };
    for (const id of Object.keys(expect)) {
      setPreset(id); runAll();
      if (st.done !== expect[id]) ng.push(`${id}: ${st.done}`);
      if (id === 'turn') { const e = ESim.energies(P, st); if (Math.abs(e.K + e.Us + e.Ug - 4) > 1e-6) ng.push('摩擦なしで力学的エネルギーが変わる'); }
    }
    // 途中で折り返す: いちばん高い所 = 4.0 J / (1.0 kg × 9.8) = 0.41 m（斜面の高さ 0.60 m に届かない）
    setPreset('turn'); let maxY = 0; for (let i = 0; i < 600; i++) { ESim.step(P, st, 1 / 60); maxY = Math.max(maxY, ESim.energies(P, st).y); }
    if (Math.abs(maxY - 4 / 9.8) > 0.002) ng.push('折り返す高さ ' + maxY);
    // 粗い面で止まる: 摩擦力の仕事 = 1.0 J
    setPreset('stop'); runAll(); render();
    if (Math.abs(st.Wf - 1.0) > 1e-3) ng.push('止まるまでの摩擦力の仕事 ' + st.Wf);
    if (!/摩擦力が台車に/.test($('chart').innerHTML)) ng.push('摩擦の矢印が出ない');
    // 基準面を台より上に: 重力の棒が負
    setPreset('climb'); P.ref = 0.6; resetRun(); render();
    if (!/−5\.9\sJ/.test($('chart').innerHTML)) ng.push('基準面を上げても重力の棒が負にならない');
    P.ref = 0;
    // 予想: C の点で止まり、予想の枠が出る
    pred.on = true; pred.pt = 'C'; resetRun(); pred.val = { K: 2, Us: 0, Ug: 2 };
    if (!/C の点（予想）/.test(chartSVG())) ng.push('予想をかく図が出ない');
    runAll(); done(); render();
    if (!pred.atPt || !/C の点/.test($('chart').innerHTML) || !/予想/.test($('chart').innerHTML)) ng.push('予想の点で比べられない');
    pred.on = false; pred.pt = null;
    // カスタム: 粗い面 0 で矢印なし
    setPreset('custom'); P.d = 0; resetRun(); render();
    if (/摩擦力/.test($('chart').innerHTML)) ng.push('摩擦なしで矢印の文が出る');
    setPreset('climb');
    document.body.dataset.test = ng.length ? 'NG: ' + ng.join(' / ') : 'TEST ALL OK';
  }
})();
