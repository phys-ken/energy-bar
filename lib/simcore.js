/* シミュレーションの物理（ばね → 粗い面 → 斜面 の台車）。画面は js/sim.js。docs/decisions.md の 13。
 * 台車は点として扱う（車輪の回転は数えない）。道に沿った長さ s（m）で位置を持つ。
 *   壁 ─ ばね（自然長 L0）─ なめらかな床 ─ 粗い面（r0 から長さ d）─ なめらかな床 ─ 斜面（横 run、高さ h）─ 上の床（長さ plat）
 * ばねは台車に固定しない（押すだけ）。台車の左の端がばねの右の端に触れているあいだだけ押す。
 * 粗い面は台車の真ん中が上にあるあいだ、動く向きと逆に大きさ f の摩擦力。止まったら動かない（床は水平なので）。
 * 力学的エネルギー K + Us + Ug と、摩擦力がした仕事の大きさ Wf の和は、はじめの力学的エネルギーに等しい。
 * 数値の誤差で棒がずれないよう、毎ステップ K をこの関係から決め、速さをそれに合わせる。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const g = 9.8;
  // 台車を大きく見せるため、コースは短く（全体 2.5 m）、斜面は急に。台車の幅は 0.3 m（先生の指摘 2026-11-17「シミュレーションが小さい」）
  const GEO = { L0: 0.35, hw: 0.15, r0: 0.62, foot: 1.45, run: 0.6, plat: 0.5 };

  // p: { m, k, x, f, d, h, ref }（kg, N/m, m, N, m, m, m）
  function course(p) {
    const Ls = Math.hypot(GEO.run, p.h), sTop = GEO.foot + Ls;
    return {
      Ls, sTop, sEnd: sTop + GEO.plat - GEO.hw,
      s0: GEO.L0 + GEO.hw - p.x,
      rough: [GEO.r0, GEO.r0 + p.d],
      // 予想の点: A ばねを離れた所、B 斜面の下、C 斜面の上
      points: { A: GEO.L0 + GEO.hw, B: GEO.foot, C: sTop },
    };
  }
  // 道の上の点 → 床からの x, 高さ y, 傾き（度）, sinθ
  function where(p, s) {
    const c = course(p);
    if (s <= GEO.foot) return { x: s, y: 0, ang: 0, sin: 0 };
    if (s <= c.sTop) { const u = (s - GEO.foot) / c.Ls; return { x: GEO.foot + u * GEO.run, y: u * p.h, ang: Math.atan2(p.h, GEO.run) * 180 / Math.PI, sin: p.h / c.Ls }; }
    return { x: GEO.foot + GEO.run + (s - c.sTop), y: p.h, ang: 0, sin: 0 };
  }
  const comp = s => Math.max(0, GEO.L0 - (s - GEO.hw));
  const onRough = (p, s) => p.d > 0 && p.f > 0 && s >= GEO.r0 && s <= GEO.r0 + p.d;

  function energies(p, st) {
    const w = where(p, st.s), c = comp(st.s);
    const Us = 0.5 * p.k * c * c, Ug = p.m * g * (w.y - p.ref);
    const E0 = 0.5 * p.k * p.x * p.x + p.m * g * (0 - p.ref);
    const K = Math.max(0, E0 - Us - Ug - st.Wf);
    return { K, Us, Ug, Wf: st.Wf, E0, comp: c, y: w.y, v: st.v };
  }

  function init(p) { return { s: course(p).s0, v: 0, Wf: 0, t: 0, done: null }; }

  // dt 秒すすめる。止まったら st.done に理由（'friction' 粗い面で止まった / 'end' 右端に着いた / 'target' 予想の点 / 'short' 予想の点に届かず引き返した）
  function step(p, st, dt, target) {
    if (st.done) return st;
    const c = course(p), n = Math.max(1, Math.ceil(dt / 0.0005)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const w = where(p, st.s), rough = onRough(p, st.s);
      const F = p.k * comp(st.s) - p.m * g * w.sin;   // 摩擦のほかの力（道に沿って前向きが正）
      if (rough && st.v === 0) {
        if (Math.abs(F) <= p.f) { st.done = 'friction'; return st; }
      }
      let a = F / p.m;
      if (rough) a -= Math.sign(st.v || F) * p.f / p.m;
      let v = st.v + a * h;
      if (rough && st.v !== 0 && Math.sign(v) !== Math.sign(st.v)) v = 0;
      const s1 = st.s + v * h;
      // 摩擦力の仕事: 粗い面の上を動いた分だけ
      if (p.d > 0 && p.f > 0) {
        const lo = Math.max(Math.min(st.s, s1), GEO.r0), hi = Math.min(Math.max(st.s, s1), GEO.r0 + p.d);
        if (hi > lo) st.Wf += p.f * (hi - lo);
      }
      const vPrev = st.v;
      st.s = s1; st.v = v; st.t += h;
      // 速さをエネルギーの関係に合わせる（向きはそのまま。止まる直前は合わせない）
      const e = energies(p, st);
      if (Math.abs(st.v) > 0.05) st.v = Math.sign(st.v) * Math.sqrt(2 * e.K / p.m);
      if (st.s >= c.sEnd) { st.s = c.sEnd; st.done = 'end'; return st; }
      if (target != null && vPrev > 0 && st.s >= target) { st.done = 'target'; return st; }
      if (target != null && st.s < target && vPrev > 0 && st.v <= 0 && st.s > GEO.L0 + GEO.hw) { st.done = 'short'; return st; }
      if (rough && st.v === 0) {
        const F2 = p.k * comp(st.s) - p.m * g * where(p, st.s).sin;
        if (Math.abs(F2) <= p.f) { st.done = 'friction'; return st; }
      }
    }
    return st;
  }

  return { g, GEO, course, where, comp, onRough, energies, init, step };
});
