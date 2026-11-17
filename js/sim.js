/* シミュレーション: ばね → 粗い面 → 斜面 の台車（docs/decisions.md の 13）。物理は lib/simcore.js。
 * 上にコース、下に棒グラフ（はじめ ｜ いま）。いまの棒は動き続ける。はじめの力学的エネルギーの高さに灰色の点線。
 * 粗い面を通ると「摩擦力が台車に負の仕事をした」の上向きの矢印（箱の値はそれまでの合計）。
 * 予想: 点を選ぶ → 棒を指でかく → 走らせる → その点で止まり、本当の棒と並べる。
 * 基準面の点線は指で上下できる。物体より上にすると重力の棒は負（基準線より下に伸びる）。
 * URL: ?test で自己テスト（結果を body の data-test に出す）
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const CH = { theme: 'color', fs: 5.2, fsName: 4.4, fsTitle: 5.0, fsWork: 4.2, fmt: 'sig2', ref: true, barGap: 5.5 };
  EBar.setFonts('"BIZ UDPGothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif');
  const G = ESim.GEO;

  const SL = [
    { key: 'm', nm: '台車の質量', unit: 'kg', min: 0.5, max: 4, step: 0.5, v: 1.0 },
    { key: 'k', nm: 'ばね定数', unit: 'N/m', min: 20, max: 400, step: 10, v: 200 },
    { key: 'x', nm: 'ばねの縮み', unit: 'm', min: 0, max: 0.30, step: 0.01, v: 0.20 },
    { key: 'f', nm: '摩擦力の大きさ', unit: 'N', min: 0, max: 5, step: 0.1, v: 1.5 },
    { key: 'd', nm: '粗い面の長さ（0 で摩擦なし）', unit: 'm', min: 0, max: 1.0, step: 0.1, v: 0.5 },
    { key: 'h', nm: '斜面の高さ', unit: 'm', min: 0, max: 1.0, step: 0.05, v: 0.40 },
  ];
  const P = { ref: 0 };
  SL.forEach(s => { P[s.key] = s.v; });
  const PT = { A: 'ばねを離れた所', B: '斜面の下', C: '斜面の上' };

  let st = ESim.init(P), running = false, slow = false, last = 0;
  const pred = { on: false, pt: null, val: { K: 0, Us: 0, Ug: 0 }, shown: false };

  // 棒の数値は目盛りの 1/5 まで（1 目盛り 0.5 J なら 0.1 J 刻み）。「0.12 J」のような長い数値が隣の棒の数値と重なった
  const r2 = v => { const q = Math.pow(10, Math.floor(Math.log10(scale().unit / 5) + 1e-9)); return +(Math.round(v / q) * q).toPrecision(6); };
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

  /* ── コース ── */
  const S = 40, X0 = 6, FY = 50;     // 1 m = 40 mm（図の上の長さ）
  const X = x => X0 + x * S, Y = y => FY - y * S;
  function courseSVG() {
    const c = ESim.course(P), w = ESim.where(P, st.s), cmp = ESim.comp(st.s);
    const xEnd = G.foot + G.run + G.plat;
    const it = [];
    // 図の枠（基準面を動かしても図の大きさが変わらないように）
    it.push({ t: 'text', x: X(0) - 4, y: Y(P.h + 0.62), s: '' }, { t: 'text', x: X(xEnd) + 41, y: FY + 16, s: '' });
    it.push({ t: 'wall', x: X(0), y1: FY - 13, y2: FY, side: -1 });
    it.push({ t: 'spring', x1: X(0), x2: X(G.L0 - cmp), y: FY, h: 4, n: 8 });
    if (hasFric()) {
      it.push({ t: 'floor', x1: X(0), x2: X(G.r0), y: FY });
      it.push({ t: 'rough', x1: X(G.r0), x2: X(G.r0 + P.d), y: FY });
      it.push({ t: 'floor', x1: X(G.r0 + P.d), x2: X(xEnd), y: FY });
    } else it.push({ t: 'floor', x1: X(0), x2: X(xEnd), y: FY });
    if (P.h > 0) {
      it.push({ t: 'slope', x1: X(G.foot), y1: FY, x2: X(G.foot + G.run), y2: Y(P.h) });
      it.push({ t: 'slope', x1: X(G.foot + G.run), y1: Y(P.h), x2: X(xEnd), y2: Y(P.h) });
      it.push({ t: 'slope', x1: X(xEnd), y1: Y(P.h), x2: X(xEnd), y2: FY });
      it.push({ t: 'vdim', x: X(xEnd) + 5, y1: Y(P.h), y2: FY, label: `${fmt2(P.h)} m`, side: 1 });
    }
    // 予想の点 A・B・C（道の上に小さな印と記号）
    for (const k of 'ABC') {
      const q = ESim.where(P, c.points[k]);
      const on = pred.on && pred.pt === k;
      it.push({ t: 'guide', x1: X(q.x), y1: Y(q.y) - 1, x2: X(q.x), y2: Y(q.y) - 15 });
      it.push({ t: 'text', x: X(q.x), y: Y(q.y) - 16.5, s: k, fs: on ? 5.6 : 4.4, color: on ? null : 'grey' });
    }
    it.push({ t: 'cart', x: X(w.x), y: Y(w.y), ang: w.ang });
    // 速さの矢印（台車の上、動く向きに。長さは速さに比例）
    if (Math.abs(st.v) > 0.05) {
      const a = w.ang * Math.PI / 180, ux = Math.cos(a) * Math.sign(st.v), uy = -Math.sin(a) * Math.sign(st.v);
      const nx = -Math.sin(a), ny = -Math.cos(a), cx = X(w.x) + nx * 10, cy = Y(w.y) + ny * 10, L = Math.min(4 + Math.abs(st.v) * 4, 16);
      it.push({ t: 'vel', x1: cx, y1: cy, x2: cx + ux * L, y2: cy + uy * L });
    }
    it.push({ t: 'ref', x1: X(0) - 3, x2: X(xEnd) + 40, y: Y(P.ref), label: '基準面 ⇕', below: P.ref > 0.05 && P.ref < P.h + 0.1 });
    return EScene.scene({ items: it, pad: 1 }, { fs: 4.2 });
  }

  /* ── 棒グラフ ── */
  function nowState(title) {
    const e = ESim.energies(P, st);
    return { title, K: r2(e.K), Us: r2(e.Us), Ug: r2(e.Ug) };
  }
  function startState() {
    const s0 = ESim.init(P), e = ESim.energies(P, s0);
    return { title: 'はじめ', K: 0, Us: r2(e.Us), Ug: r2(e.Ug) };
  }
  function chartOpt(extra) { return Object.assign({}, CH, scale(), extra || {}); }
  const FRIC_TEXT = '摩擦力が台車に\n負の仕事をした';
  function chartSVG() {
    const title = pred.atPt ? `${pred.pt} の点` : 'いま';
    const works = hasFric() ? [r2(st.Wf) > 0 ? { W: -r2(st.Wf), text: FRIC_TEXT } : { W: 0, blank: true, text: FRIC_TEXT }] : [];
    return EBar.chart([startState(), nowState(title)], chartOpt({ works }));
  }
  function predStates() {
    return [startState(), Object.assign({ title: `${pred.pt} の点（予想）` }, pred.val)];
  }
  function predOpt() {
    // 予想の図も、下の本当の図と同じ幅・同じ目盛り（矢印の空きも同じにする）
    return chartOpt({ works: hasFric() ? [{ W: 0, blank: true, text: FRIC_TEXT }] : [], ref: true });
  }

  function readout() {
    const e = ESim.energies(P, st);
    $('readout').textContent = `速さ ${fmt2(Math.abs(st.v))} m/s　高さ ${fmt2(e.y)} m　ばねの縮み ${fmt2(e.comp)} m`;
  }
  function render() {
    $('course').innerHTML = courseSVG();
    $('chart').innerHTML = chartSVG();
    readout();
    $('bRun').textContent = running ? '⏸ 止める' : (st.done || st.t === 0 ? '▶ 走らせる' : '▶ 続ける');
    $('bRun').disabled = !running && (st.done === 'friction' || st.done === 'end');
  }
  function renderPred() {
    $('predBox').classList.toggle('hidden', !pred.on);
    $('bPredict').classList.toggle('on', pred.on);
    if (!pred.on) return;
    $('predPts').innerHTML = 'ABC'.split('').map(k => `<button type="button" data-pt="${k}" class="${pred.pt === k ? 'on' : ''}">${k}　${PT[k]}</button>`).join('');
    $('predPts').querySelectorAll('button').forEach(b => b.onclick = () => { pred.pt = b.dataset.pt; resetRun(); renderPred(); render(); });
    $('predHint').textContent = pred.pt ? `${pred.pt} の点を通るときの棒を、指でかいてから「走らせる」を押してください。` : '点を選んでください。';
    $('predChart').innerHTML = pred.pt ? EBar.chart(predStates(), predOpt()) : '';
  }

  /* ── 動かす ── */
  function target() { return pred.on && pred.pt && !pred.shown ? ESim.course(P).points[pred.pt] : null; }
  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05) * (slow ? 0.25 : 1); last = now;
    ESim.step(P, st, dt, target());
    if (st.done) { running = false; done(); }
    render();
    if (running) requestAnimationFrame(frame);
  }
  function done() {
    const e = ESim.energies(P, st);
    const lost = `摩擦力が負の仕事をして、力学的エネルギーが ${fmt2(st.Wf)} J 減りました。`;
    if (st.done === 'friction') msg(`台車は粗い面の上で止まりました。${lost}`);
    else if (st.done === 'end') msg('台車はコースの右端に着きました。' + (st.Wf > 0.004 ? lost : ''));
    else if (st.done === 'target') { pred.shown = true; pred.atPt = true; msg(`${pred.pt} の点に着きました。上の予想と、下の本当の棒グラフを比べてください。「続ける」でその先へ走ります。`); st.done = null; }
    else if (st.done === 'short') { pred.shown = true; msg(`台車は ${pred.pt} の点まで上がれずに、引き返しました（いちばん高い所で止めています）。`); st.done = null; }
    void e;
  }
  function msg(t) { $('msg').textContent = t; }
  function resetRun() { running = false; st = ESim.init(P); pred.shown = false; pred.atPt = false; msg(''); }

  $('bRun').onclick = () => {
    if (running) { running = false; render(); return; }
    if (P.x === 0) { msg('ばねを縮めてください。'); return; }
    if (pred.on && !pred.pt) { msg('予想する点を選んでください。'); return; }
    if (st.t === 0) msg('');
    pred.atPt = false;
    running = true; last = performance.now(); requestAnimationFrame(frame); render();
  };
  $('bReset').onclick = () => { resetRun(); render(); };
  $('bSlow').onclick = () => { slow = !slow; $('bSlow').classList.toggle('on', slow); };
  $('bPredict').onclick = () => { pred.on = !pred.on; resetRun(); renderPred(); render(); };

  /* スライダー: 変えたら、はじめからやり直す */
  $('sliders').innerHTML = SL.map(s => `<label class="sl"><span class="nm">${s.nm}</span><span class="val" id="v_${s.key}"></span>` +
    `<input type="range" id="s_${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.v}"></label>`).join('');
  const showVal = s => { $('v_' + s.key).textContent = `${P[s.key].toFixed((String(s.step).split('.')[1] || '').length)} ${s.unit}`; };
  SL.forEach(s => {
    showVal(s);
    $('s_' + s.key).addEventListener('input', e => {
      P[s.key] = +e.target.value; showVal(s);
      if (s.key === 'h') P.ref = Math.min(P.ref, P.h + 0.5);
      resetRun(); renderPred(); render();
    });
  });

  /* 基準面を指で上下（0.05 m 刻み、床より 0.2 m 下 〜 斜面の上より 0.5 m 上） */
  (function bindRef() {
    const box = $('course'); let drag = false;
    const toSvg = e => { const svg = box.querySelector('svg'), p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const set = e => {
      const y = (FY - toSvg(e).y) / S, v = Math.round(y / 0.05) * 0.05;
      const nv = Math.max(-0.2, Math.min(P.h + 0.5, +v.toFixed(2)));
      if (nv !== P.ref) { P.ref = nv; renderPred(); render(); }
    };
    box.addEventListener('pointerdown', e => {
      if (!box.querySelector('svg')) return;
      const p = toSvg(e);
      if (Math.abs(p.y - Y(P.ref)) > 5) return;
      drag = true; e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch (_) { /* 古いブラウザ */ }
    });
    box.addEventListener('pointermove', e => { if (drag) set(e); });
    const up = () => { drag = false; };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  })();

  /* 予想の棒を指でかく（「はじめ」の右の場面の 3 本。1 目盛り刻み。重力だけ負にもできる） */
  (function bindPred() {
    const box = $('predChart'); let col = null;
    const geo = () => EBar.layout(predStates(), predOpt());
    const toSvg = e => { const svg = box.querySelector('svg'), p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const set = e => {
      const L = geo(), k = ['K', 'Us', 'Ug'][col];
      let v = Math.round((L.baseY - toSvg(e).y) / L.mpu) * L.unit;
      v = Math.min(L.unitsUp * L.unit, Math.max(k === 'Ug' ? -L.unitsDown * L.unit : 0, v));
      pred.val[k] = +v.toPrecision(6);
      $('predChart').innerHTML = EBar.chart(predStates(), predOpt());
    };
    box.addEventListener('pointerdown', e => {
      if (!box.querySelector('svg')) return;
      const L = geo(), p = toSvg(e); col = null;
      for (let j = 0; j < 3; j++) { const x = L.barX(1, j); if (p.x >= x - L.gap / 2 && p.x <= x + L.bw + L.gap / 2) col = j; }
      if (col === null) return;
      e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch (_) { /* 古いブラウザ */ }
      set(e);
    });
    box.addEventListener('pointermove', e => { if (col !== null) set(e); });
    const up = () => { col = null; };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  })();

  // ?t=秒 でその時刻まで進めた画面（見本・確認用）。?ref=、?pt=A|B|C も
  const qs = new URLSearchParams(location.search);
  if (qs.has('ref')) P.ref = +qs.get('ref');
  if (qs.has('pt')) { pred.on = true; pred.pt = qs.get('pt'); }
  if (qs.has('t')) { const T = +qs.get('t'); while (!st.done && st.t < T) ESim.step(P, st, 1 / 60, target()); if (st.done) done(); }
  render(); renderPred();

  /* ── 自己テスト ── */
  if (/[?&]test/.test(location.search)) {
    const ng = [];
    const runAll = (tgt) => { let n = 0; while (!st.done && n++ < 20000) ESim.step(P, st, 1 / 60, tgt); };
    // 1) 既定: 粗い面で止まり、摩擦力の仕事 = はじめの力学的エネルギー
    resetRun(); runAll(null);
    if (st.done !== 'friction' || Math.abs(st.Wf - 4.0) > 1e-3) ng.push('既定で粗い面に止まらない ' + st.done + ' ' + st.Wf);
    render();
    if (!/摩擦力が台車に/.test($('chart').innerHTML)) ng.push('摩擦の矢印が出ない');
    // 2) 基準面を斜面の上より上に: 重力の棒が負
    P.ref = 0.6; resetRun(); render();
    if (!/−5\.9\sJ/.test($('chart').innerHTML)) ng.push('基準面を上げても重力の棒が負にならない');   // 数と単位のあいだは細い空白
    P.ref = 0;
    // 3) 予想: C の点。h = 0.2 なら届く
    P.h = 0.2; pred.on = true; pred.pt = 'C'; resetRun(); renderPred();
    runAll(target());
    if (st.done !== 'target') ng.push('C に着かない ' + st.done);
    done(); render();
    if (!/C の点/.test($('chart').innerHTML)) ng.push('着いた点の名前が出ない');
    if (!/C の点（予想）/.test($('predChart').innerHTML)) ng.push('予想の図が出ない');
    // 4) 摩擦なしでは矢印の空きを作らない
    P.f = 0; resetRun(); render();
    if (/摩擦力/.test($('chart').innerHTML)) ng.push('摩擦なしで矢印の文が出る');
    document.body.dataset.test = ng.length ? 'NG: ' + ng.join(' / ') : 'TEST ALL OK';
  }
})();
