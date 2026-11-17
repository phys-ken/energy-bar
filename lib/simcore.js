/* シミュレーションの物理と場面の形（docs/decisions.md の 13）。画面は js/sim.js。
 * 物体は点として扱い、道（点の列）に沿った長さ s で位置を持つ。道の終わりで「飛び出す」場面だけ、そのあと放物運動。
 * 自由落下・鉛直ばね振り子は、まっすぐ下向きの道として扱う。
 * ばねは道の始まりの側にある。つないである（振り子）か、押すだけ（押し出す）か。
 * 粗い面は物体の真ん中が上にあるあいだ、動く向きと逆に大きさ f の摩擦力（粗い面は水平な所にだけ置く）。
 * 力学的エネルギー K + Us + Ug と、摩擦力がした仕事の大きさ Wf の和は一定。
 * 数値の誤差で棒がずれないよう、道の上では毎ステップ K をこの関係から決め、速さをそれに合わせる。飛んでいるあいだは式どおり。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const g = 9.8, M = 1.0, F_ROUGH = 2.0, D = Math.PI / 180;
  const HW = 0.15;   // 台車の幅の半分（台車を大きく見せる。先生の指摘 2026-11-17「シミュレーションが小さい」）
  const BOX = 0.1;   // 小物体の幅の半分

  /* ── 道 ── */
  function track(raw) {
    const pts = [raw[0]];
    for (const p of raw.slice(1)) { const q = pts[pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) pts.push(p); }
    const S = [0];
    for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, S, len: S[S.length - 1] };
  }
  // 道の上の点: 位置 x, y と、s が増える向きの単位ベクトル tx, ty
  function at(tr, s) {
    const { pts, S } = tr, n = pts.length;
    let lo = 0, hi = n - 1;
    if (s >= tr.len) lo = n - 2;
    else if (s > 0) while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] <= s) lo = mid; else hi = mid; }
    const L = S[lo + 1] - S[lo], u = (s - S[lo]) / L;
    const dx = pts[lo + 1][0] - pts[lo][0], dy = pts[lo + 1][1] - pts[lo][1];
    return { x: pts[lo][0] + dx * u, y: pts[lo][1] + dy * u, tx: dx / L, ty: dy / L };
  }
  // x（または高さ y）を初めて通る所の s
  function sAt(tr, val, axis) {
    const k = axis === 'y' ? 1 : 0;
    for (let i = 1; i < tr.pts.length; i++) {
      const a = tr.pts[i - 1][k], b = tr.pts[i][k];
      if ((a - val) * (b - val) <= 0 && a !== b) return tr.S[i - 1] + (tr.S[i] - tr.S[i - 1]) * (val - a) / (b - a);
    }
    return null;
  }
  const sAtX = (tr, x) => sAt(tr, x, 'x'), sAtY = (tr, y) => sAt(tr, y, 'y');
  // 折れ線の角を丸める（台車が角で急に向きを変えないように）。t は角から丸めが始まる所までの長さ
  const filletT = (r, deg) => r * Math.tan(deg * D / 2);
  function rounded(keys, r) {
    const out = [keys[0]];
    for (let i = 1; i < keys.length - 1; i++) {
      const p0 = keys[i - 1], p1 = keys[i], p2 = keys[i + 1];
      const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const d1 = [(p1[0] - p0[0]) / l1, (p1[1] - p0[1]) / l1], d2 = [(p2[0] - p1[0]) / l2, (p2[1] - p1[1]) / l2];
      const phi = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
      if (phi < 1e-6) { out.push(p1); continue; }
      const t = Math.min(r * Math.tan(phi / 2), l1 / 2, l2 / 2);
      const A = [p1[0] - d1[0] * t, p1[1] - d1[1] * t], B = [p1[0] + d2[0] * t, p1[1] + d2[1] * t];
      for (let k = 0; k <= 16; k++) {
        const u = k / 16, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        out.push([a * A[0] + b * p1[0] + c * B[0], a * A[1] + b * p1[1] + c * B[1]]);
      }
    }
    out.push(keys[keys.length - 1]);
    return out;
  }

  /* ── 力とエネルギー ── */
  // ばねの伸び e（負は縮み）。押すだけのばねは、離れたら 0
  function springAt(W, s) {
    const sp = W.spring;
    if (!sp) return { e: 0, Us: 0, F: 0 };
    let e = s - sp.off - sp.L0;
    if (!sp.attached && e > 0) e = 0;
    return { e, Us: 0.5 * sp.k * e * e, F: -sp.k * e };
  }
  const onRough = (W, s) => W.f > 0 && W.rough.some(([a, b]) => s >= a && s <= b);
  const others = (W, s) => springAt(W, s).F - W.m * g * at(W.tr, s).ty;   // 摩擦力のほかの力（s が増える向きが正）

  function init(W) {
    const p = at(W.tr, W.s0);
    return { ph: 'track', s: W.s0, v: 0, dir: 0, x: p.x, y: p.y, vx: 0, vy: 0, t: 0, Wf: 0, done: null, passed: false, launch: null };
  }
  // ref: 基準面の高さ。Ug はそこからの高さで
  function energies(W, st, ref = 0) {
    const Us = st.ph === 'track' ? springAt(W, st.s).Us : 0;
    const K = st.ph === 'fly' ? 0.5 * W.m * (st.vx * st.vx + st.vy * st.vy) : Math.max(0, W.E0 - Us - W.m * g * st.y - st.Wf);
    return { K, Us, Ug: W.m * g * (st.y - ref), Wf: st.Wf, y: st.y, speed: Math.sqrt(2 * K / W.m) };
  }

  /* ── 動かす ──
   * st.done: 'stop'（粗い面で止まった）/ 'end'（道の端に着いた）/ 'land'（床に着く直前）/
   *          'target'（予想の点）/ 'short'（予想の点まで上がれずに引き返した）
   * tgt: 予想の点。{ s }（場所）か { ev }（'turn' 折り返す所・'apex' 飛んでいちばん高い所・'launch' 飛び出す瞬間・'land'・'stop'・'end'）
   */
  function step(W, st, dt, tgt) {
    if (st.done) return st;
    const n = Math.max(1, Math.ceil(dt / 0.0005)), h = dt / n;
    for (let i = 0; i < n && !st.done; i++) (st.ph === 'fly' ? flyStep : trackStep)(W, st, h, tgt);
    return st;
  }
  // できごと。予想の点ならそこで止める（fallback があれば、予想でなくても止める）
  function event(st, ev, tgt, fallback) {
    if (tgt && tgt.ev === ev) st.done = 'target';
    else if (fallback) st.done = fallback;
  }
  function trackStep(W, st, h, tgt) {
    const rough = onRough(W, st.s), F = others(W, st.s);
    if (st.v === 0 && (rough ? Math.abs(F) <= W.f : Math.abs(F) < 1e-9)) { stopHere(W, st, tgt); return; }
    let a = F / W.m;
    if (rough) a -= Math.sign(st.v || F) * W.f / W.m;
    let v = st.v + a * h;
    if (rough && st.v !== 0 && Math.sign(v) !== Math.sign(st.v)) v = 0;
    const s0 = st.s, s1 = s0 + v * h;
    // 摩擦力の仕事: 粗い面の上を動いた分だけ
    if (W.f > 0) for (const [ra, rb] of W.rough) {
      const lo = Math.max(Math.min(s0, s1), ra), hi = Math.min(Math.max(s0, s1), rb);
      if (hi > lo) st.Wf += W.f * (hi - lo);
    }
    st.s = s1; st.v = v; st.t += h;
    if (st.s >= W.sEnd) st.s = W.sEnd;
    if (st.s <= 0) { st.s = 0; st.v = 0; }
    const q = at(W.tr, st.s); st.x = q.x; st.y = q.y;
    // 速さをエネルギーの関係に合わせる（向きはそのまま。止まる直前は合わせない）
    const K = energies(W, st).K;
    if (Math.abs(st.v) > 0.05) st.v = Math.sign(st.v) * Math.sqrt(2 * K / W.m);
    // 予想の点（場所）を通った
    if (tgt && tgt.s != null && !st.passed && s0 !== s1 && (s0 - tgt.s) * (s1 - tgt.s) <= 0) { st.passed = true; st.done = 'target'; return; }
    // 折り返した
    const sg = Math.sign(st.v);
    if (sg !== 0) {
      if (st.dir !== 0 && sg !== st.dir) {
        if (tgt && tgt.ev === 'turn') { st.done = 'target'; return; }
        if (tgt && tgt.s != null && !st.passed) { st.done = 'short'; return; }
      }
      st.dir = sg;
    }
    // 道の終わり
    if (st.s >= W.sEnd) {
      if (W.endAt === 'launch') {
        const sp = Math.sqrt(2 * energies(W, st).K / W.m);
        st.ph = 'fly'; st.vx = sp * q.tx; st.vy = sp * q.ty; st.launch = { tx: q.tx, ty: q.ty };
        event(st, 'launch', tgt);
      } else event(st, W.endAt === 'land' ? 'land' : 'end', tgt, W.endAt === 'land' ? 'land' : 'end');
      return;
    }
    if (st.v === 0) {
      const F2 = others(W, st.s);
      if (onRough(W, st.s) ? Math.abs(F2) <= W.f : Math.abs(F2) < 1e-9) stopHere(W, st, tgt);
    }
  }
  // 止まった: 止まる直前は速さを合わせないので、残った小さな K（0.0001 J ほど）を摩擦力の仕事に入れて 0 にする
  function stopHere(W, st, tgt) {
    if (W.f > 0 && W.rough.length) st.Wf = W.E0 - springAt(W, st.s).Us - W.m * g * st.y;
    event(st, 'stop', tgt, 'stop');
  }
  function flyStep(W, st, h, tgt) {
    const vy0 = st.vy, x0 = st.x, y0 = st.y;
    st.x += st.vx * h; st.y += vy0 * h - 0.5 * g * h * h; st.vy = vy0 - g * h; st.t += h;
    if (st.y <= W.floorY) {   // 床に着く直前（ちょうど床の高さ）まで戻す
      const tl = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * (y0 - W.floorY))) / g;
      st.x = x0 + st.vx * tl; st.y = W.floorY; st.vy = vy0 - g * tl;
      event(st, 'land', tgt, 'land');
      return;
    }
    if (vy0 > 0 && st.vy <= 0) event(st, 'apex', tgt);
  }

  // 最後まで（または T 秒）動かして、棒の値の幅と動く範囲を調べる（目盛りと図の枠を決める）
  function scan(W, T = 25) {
    const st = init(W), r = { K: [0, 0], Us: [0, 0], x: [st.x, st.x], y: [st.y, st.y], sum: {}, done: null, t: 0 };
    const mg = W.m * g;
    for (const c of ['', 's', 'e', 'se']) r.sum[c] = [Infinity, -Infinity];
    const rec = () => {
      const e = energies(W, st);
      r.K[1] = Math.max(r.K[1], e.K); r.Us[1] = Math.max(r.Us[1], e.Us);
      r.x[0] = Math.min(r.x[0], st.x); r.x[1] = Math.max(r.x[1], st.x);
      r.y[0] = Math.min(r.y[0], st.y); r.y[1] = Math.max(r.y[1], st.y);
      for (const c of ['', 's', 'e', 'se']) {
        const v = e.K + (c.includes('s') ? e.Us : 0) + (c.includes('e') ? mg * st.y : 0);
        r.sum[c][0] = Math.min(r.sum[c][0], v); r.sum[c][1] = Math.max(r.sum[c][1], v);
      }
    };
    rec();
    while (!st.done && st.t < T) { step(W, st, 1 / 240); rec(); }
    r.done = st.done; r.t = st.t;
    return r;
  }

  /* ── 場面 ── */
  const SPR = (L0, off, attached, k = 200, h = 0.13) => ({ k, L0, off, attached, h });
  function make(o) {
    const W = Object.assign({ m: M, f: F_ROUGH, rough: [], spring: null, endAt: 'end', floorY: 0, deco: {}, ref0: 0 }, o);
    if (W.sEnd == null) W.sEnd = W.tr.len;
    W.E0 = springAt(W, W.s0).Us + W.m * g * at(W.tr, W.s0).y;
    if (!W.refRange) { const ys = W.tr.pts.map(q => q[1]); W.refRange = [Math.min(0, ...ys) - 0.2, Math.max(...ys) + 0.4]; }
    return W;
  }
  const PX = { key: 'x', nm: 'ばねの縮み', unit: 'm', min: 0.05, max: 0.3, step: 0.01 };
  const PH = (min, max, step, nm = 'はじめの高さ') => ({ key: 'h', nm, unit: 'm', min, max, step });

  // 斜面（35°）を下りて水平面へ
  function slopeKeys(h, floorLen) {
    const H = h + 0.12, run = H / Math.tan(35 * D);
    return { H, run, keys: [[0, H], [run, 0], [run + floorLen, 0]] };
  }
  // 谷形の曲面（放物線を左右でつなぐ。wl・wr が左右の幅）
  function valley(wl, wr) {
    return P => {
      const H = 0.9, pts = [];
      for (let i = 0; i <= 200; i++) { const x = -wl + (wl + wr) * i / 200; pts.push([x + wl, H * Math.pow(x / (x < 0 ? wl : wr), 2)]); }
      const tr = track(pts), x0 = wl - wl * Math.sqrt(P.h / H);
      return make({
        tr, s0: sAtX(tr, x0),
        deco: { floor: [-0.05, wl + wr + 0.05], solid: true, dims: [{ x: -0.12, y1: 0, y2: P.h, gx: x0 }] },
        points: [{ id: 'A', nm: '谷底', s: sAtX(tr, wl) }, { id: 'B', nm: '右側でいちばん高い所', ev: 'turn' }],
      });
    };
  }
  // 壁 ─ ばね ─ 水平面（粗い面）─ 斜面 ─ 上の台（台車）
  function springSlope(P) {
    const L0 = 0.35, r0 = 0.62, foot = 1.45, run = 0.6, plat = 0.5, xe = foot + run + plat, d = P.d || 0;
    const keys = P.h > 0 ? [[0, 0], [foot, 0], [foot + run, P.h], [xe, P.h]] : [[0, 0], [xe, 0]];
    const tr = track(rounded(keys, 0.1));
    const reach = 0.5 * 200 * P.x * P.x - F_ROUGH * d > M * g * P.h + 1e-9;
    const points = [{ id: 'A', nm: 'ばねを離れた所', s: L0 + HW }];
    if (P.h > 0) points.push({ id: 'B', nm: '斜面の下', s: sAtX(tr, foot) },
      reach ? { id: 'C', nm: '斜面の上', s: sAtX(tr, foot + run) } : { id: 'C', nm: 'いちばん高い所', ev: 'turn' });
    if (!reach && d > 0) points.push({ id: 'D', nm: '止まった所', ev: 'stop' });
    return make({
      tr, s0: L0 + HW - P.x, sEnd: tr.len - HW, spring: SPR(L0, HW, false), rough: d > 0 ? [[r0, r0 + d]] : [],
      deco: { floor: [-0.05, xe], wall: { x: 0, y1: 0, y2: 0.45 }, solid: true, dims: P.h > 0 ? [{ x: xe + 0.14, y1: 0, y2: P.h }] : [] },
      points,
    });
  }

  // grp: 0 重力 / 1 ばね / 2 ばねと重力 / 3 粗い面。body: cart 台車 / ball 小球 / box 小物体 / weight おもり
  const SCENES = [
    {
      id: 'fall', grp: 0, nm: '自由落下', body: 'ball', bodyNm: '小球', vertical: true,
      params: [PH(0.5, 2.0, 0.1)], def: { h: 1.0 },
      build: P => make({
        tr: track([[0, P.h], [0, 0]]), s0: 0, endAt: 'land',
        deco: { floor: [-0.45, 0.45], dims: [{ x: 0.3, y1: 0, y2: P.h }] },
        points: [{ id: 'A', nm: '半分の高さ', s: P.h / 2 }, { id: 'B', nm: '床に着く直前', ev: 'land' }],
        refRange: [-0.3, P.h + 0.3],
      }),
    },
    {
      id: 'slope', grp: 0, nm: '斜面をすべり下りる', body: 'cart', bodyNm: '台車',
      params: [PH(0.2, 0.8, 0.05)], def: { h: 0.5 },
      build: P => {
        const { H, run, keys } = slopeKeys(P.h, 1.0), tr = track(rounded(keys, 0.2)), x0 = (H - P.h) / Math.tan(35 * D);
        return make({
          tr, s0: (H - P.h) / Math.sin(35 * D), sEnd: tr.len - HW,
          deco: { floor: [-0.05, keys[2][0]], solid: true, dims: [{ x: -0.12, y1: 0, y2: P.h, gx: x0 }] },
          points: [{ id: 'A', nm: '半分の高さ', s: sAtY(tr, P.h / 2) }, { id: 'B', nm: '斜面の下', s: sAtX(tr, run) }, { id: 'C', nm: '右端', ev: 'end' }],
        });
      },
    },
    { id: 'valley', grp: 0, nm: '曲面（左右対称）', body: 'ball', bodyNm: '小球', params: [PH(0.2, 0.8, 0.05)], def: { h: 0.6 }, build: valley(0.9, 0.9) },
    { id: 'valley2', grp: 0, nm: '曲面（左右非対称）', body: 'ball', bodyNm: '小球', params: [PH(0.2, 0.8, 0.05)], def: { h: 0.6 }, build: valley(0.5, 1.4) },
    {
      id: 'jump', grp: 0, nm: '曲面から飛び出す', body: 'ball', bodyNm: '小球',
      params: [PH(0.5, 1.0, 0.05), { key: 'a', nm: '飛び出す角度', unit: '°', min: 30, max: 60, step: 15 }], def: { h: 0.8, a: 45 },
      build: P => {
        const Ht = 1.1, wl = 0.9, hL = 0.25, tn = Math.tan(P.a * D), dxL = 2 * hL / tn, aR = tn * tn / (4 * hL), pts = [];
        for (let i = 0; i <= 120; i++) { const x = wl * i / 120; pts.push([x, Ht * Math.pow((wl - x) / wl, 2)]); }
        for (let i = 1; i <= 100; i++) { const u = dxL * i / 100; pts.push([wl + u, aR * u * u]); }
        const tr = track(pts), x0 = wl - wl * Math.sqrt(P.h / Ht);
        return make({
          tr, s0: sAtX(tr, x0), endAt: 'launch',
          deco: { floor: [-0.05, null], solid: true, dims: [{ x: -0.12, y1: 0, y2: P.h, gx: x0 }, { x: wl + dxL + 0.1, y1: 0, y2: hL }] },
          points: [{ id: 'A', nm: '飛び出す瞬間', ev: 'launch' }, { id: 'B', nm: '飛んでいちばん高い所', ev: 'apex' }, { id: 'C', nm: '床に着く直前', ev: 'land' }],
        });
      },
    },
    {
      id: 'hosc', grp: 1, nm: '水平ばね振り子', body: 'cart', bodyNm: '台車',
      params: [Object.assign({}, PX, { nm: 'はじめの縮み' })], def: { x: 0.2 },
      build: P => {
        const L0 = 0.5, tr = track([[0, 0], [1.5, 0]]);
        return make({
          tr, s0: L0 + HW - P.x, spring: SPR(L0, HW, true),
          deco: { floor: [-0.05, 1.5], wall: { x: 0, y1: 0, y2: 0.45 }, natural: { x: L0 } },
          points: [{ id: 'A', nm: 'ばねが自然の長さ', s: L0 + HW }, { id: 'B', nm: 'いちばん伸びた所', ev: 'turn' }],
        });
      },
    },
    {
      id: 'push', grp: 1, nm: 'ばねで押し出す', body: 'cart', bodyNm: '台車',
      params: [PX], def: { x: 0.2 },
      build: P => {
        const L0 = 0.35, xe = 2.0, tr = track([[0, 0], [xe, 0]]);
        return make({
          tr, s0: L0 + HW - P.x, sEnd: xe - HW, spring: SPR(L0, HW, false),
          deco: { floor: [-0.05, xe], wall: { x: 0, y1: 0, y2: 0.45 } },
          points: [{ id: 'A', nm: 'ばねを離れた所', s: L0 + HW }, { id: 'B', nm: '右端', ev: 'end' }],
        });
      },
    },
    {
      id: 'vosc', grp: 2, nm: '鉛直ばね振り子', body: 'weight', bodyNm: 'おもり', vertical: true,
      params: [{ key: 'x', nm: 'はじめの伸び', unit: 'm', min: 0, max: 0.15, step: 0.05 }], def: { x: 0 },
      build: P => {
        // ばね定数 50 N/m（200 N/m では 1.0 kg のおもりが 0.1 m しか動かない）。いちばん下（自然の長さではなしたとき）を高さ 0 に
        const k = 50, L0 = 0.45, hb = 0.06, Yc = L0 + hb + 2 * M * g / k;
        return make({
          tr: track([[0, Yc], [0, Yc - 3]]), s0: L0 + hb + P.x, spring: { k, L0, off: hb, attached: true, h: 0 },
          deco: { ceil: { x1: -0.3, x2: 0.3, y: Yc }, natural: { y: Yc - L0 } },
          points: [{ id: 'A', nm: 'つり合いの位置', s: L0 + hb + M * g / k }, { id: 'B', nm: 'いちばん下', ev: 'turn' }],
          refRange: [-0.3, Yc],
        });
      },
    },
    {
      id: 'table', grp: 2, nm: 'ばね → 台から飛び出す', body: 'box', bodyNm: '小物体',
      params: [PX, { key: 'H', nm: '台の高さ', unit: 'm', min: 0.3, max: 1.0, step: 0.1 }], def: { x: 0.15, H: 0.6 },
      build: P => {
        const L0 = 0.35, tr = track([[0, P.H], [1.2, P.H]]);
        return make({
          tr, s0: L0 + BOX - P.x, spring: SPR(L0, BOX, false, 200, 0.1), endAt: 'launch',
          deco: { floor: [-0.05, null], solid: true, wall: { x: 0, y1: P.H, y2: P.H + 0.4 }, dims: [{ x: -0.12, y1: 0, y2: P.H }] },
          points: [{ id: 'A', nm: 'ばねを離れた所', s: L0 + BOX }, { id: 'B', nm: '台の端（飛び出す瞬間）', ev: 'launch' }, { id: 'C', nm: '床に着く直前', ev: 'land' }],
          refRange: [-0.2, P.H + 0.4],
        });
      },
    },
    { id: 'sclimb', grp: 2, nm: 'ばね → 斜面を登りきる', body: 'cart', bodyNm: '台車', params: [PX, PH(0, 0.8, 0.05, '斜面の高さ')], def: { x: 0.2, h: 0.3, d: 0 }, build: springSlope },
    { id: 'sturn', grp: 2, nm: 'ばね → 斜面の途中で戻る', body: 'cart', bodyNm: '台車', params: [PX, PH(0, 0.8, 0.05, '斜面の高さ')], def: { x: 0.2, h: 0.6, d: 0 }, build: springSlope },
    {
      id: 'srough', grp: 3, nm: 'ばね → 粗い面で止まる', body: 'cart', bodyNm: '台車',
      params: [PX, { key: 'd', nm: '粗い面の長さ', unit: 'm', min: 0.2, max: 1.6, step: 0.1 }], def: { x: 0.1, d: 1.0 },
      build: P => {
        const L0 = 0.35, r0 = 0.62, xe = 2.4, tr = track([[0, 0], [xe, 0]]);
        return make({
          tr, s0: L0 + HW - P.x, sEnd: xe - HW, spring: SPR(L0, HW, false), rough: [[r0, r0 + P.d]],
          deco: { floor: [-0.05, xe], wall: { x: 0, y1: 0, y2: 0.45 } },
          points: [{ id: 'A', nm: 'ばねを離れた所', s: L0 + HW }, { id: 'B', nm: '粗い面に入る所', s: r0 }, { id: 'C', nm: '止まった所', ev: 'stop' }],
        });
      },
    },
    {
      id: 'slrough', grp: 3, nm: '斜面 → 粗い面で止まる', body: 'cart', bodyNm: '台車',
      params: [PH(0.1, 0.4, 0.05)], def: { h: 0.25 },
      build: P => {
        const { H, run, keys } = slopeKeys(P.h, 1.75), tr = track(rounded(keys, 0.2)), x0 = (H - P.h) / Math.tan(35 * D);
        const ra = run + 0.1, rb = keys[2][0] - 0.05;
        return make({
          tr, s0: (H - P.h) / Math.sin(35 * D), sEnd: tr.len - HW, rough: [[sAtX(tr, ra), sAtX(tr, rb)]],
          deco: { floor: [-0.05, keys[2][0]], solid: true, dims: [{ x: -0.12, y1: 0, y2: P.h, gx: x0 }] },
          points: [{ id: 'A', nm: '斜面の下', s: sAtX(tr, run) }, { id: 'B', nm: '粗い面に入る所', s: sAtX(tr, ra) }, { id: 'C', nm: '止まった所', ev: 'stop' }],
        });
      },
    },
    {
      id: 'vrough', grp: 3, nm: '斜面 → 粗い底面 → 斜面', body: 'cart', bodyNm: '台車',
      params: [PH(0.3, 0.6, 0.05), { key: 'd', nm: '粗い面の長さ', unit: 'm', min: 0.2, max: 0.6, step: 0.1 }], def: { h: 0.5, d: 0.4 },
      build: P => {
        // 45° の斜面。角の丸めのぶん底を長くして、平らな所がちょうど d になるように
        const H = 0.7, run = H, r = 0.08, t = filletT(r, 45), xe = 2 * run + P.d + 2 * t;
        const tr = track(rounded([[0, H], [run, 0], [run + P.d + 2 * t, 0], [xe, H]], r));
        return make({
          tr, s0: (H - P.h) / Math.sin(45 * D), rough: [[sAtX(tr, run + t), sAtX(tr, run + t + P.d)]],
          deco: { floor: [-0.05, xe + 0.05], solid: true, dims: [{ x: -0.12, y1: 0, y2: P.h, gx: H - P.h }] },
          points: [{ id: 'A', nm: '右の斜面でいちばん高い所', ev: 'turn' }, { id: 'B', nm: '止まった所', ev: 'stop' }],
        });
      },
    },
    { id: 'sfclimb', grp: 3, nm: 'ばね → 粗い面 → 斜面を登りきる', body: 'cart', bodyNm: '台車', params: [PX, { key: 'd', nm: '粗い面の長さ', unit: 'm', min: 0.1, max: 0.6, step: 0.1 }, PH(0, 0.8, 0.05, '斜面の高さ')], def: { x: 0.2, d: 0.3, h: 0.2 }, build: springSlope },
    { id: 'sfback', grp: 3, nm: 'ばね → 粗い面 → 斜面を往復', body: 'cart', bodyNm: '台車', params: [PX, { key: 'd', nm: '粗い面の長さ', unit: 'm', min: 0.1, max: 0.6, step: 0.1 }, PH(0, 0.8, 0.05, '斜面の高さ')], def: { x: 0.2, d: 0.3, h: 0.4 }, build: springSlope },
  ];
  const GROUPS = ['重力（運動 ⇄ 重力）', 'ばね（運動 ⇄ ばね）', 'ばねと重力', '粗い面（摩擦力が仕事をする）'];

  return { g, M, F_ROUGH, HW, BOX, track, at, sAtX, sAtY, rounded, springAt, onRough, init, energies, step, scan, SCENES, GROUPS };
});
