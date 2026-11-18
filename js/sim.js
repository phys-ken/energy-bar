/* シミュレーション（docs/decisions.md の 13）。物理と場面の形は lib/simcore.js。
 * 黒板に映す（iPad → プロジェクター）のが基本。黒い画面が既定で、線は太く、字は大きく。
 * 場面はプルダウンから選ぶ。4 つのまとまり（重力 / ばね / ばねと重力 / 粗い面）に分ける。値は ⚙ で動かせる。
 * 系はどの場面でも選べる: ばねを系に入れるか（ばねのある場面）、地球を系に入れるか（鉛直の場面だけ。ほかは地球をいつも入れる）。
 *   系の外の力（ばねの弾性力・重力・摩擦力）がした仕事は、棒にせず「系の外」から出入りする矢印。
 *   コースには系を黄色の細い点線で囲む（地球を入れるときは地面ごと。ばねを外すとそこだけへこむ）。文字は添えない。
 * 力の矢印（橙）: 系の外から仕事をする力だけ（＝棒グラフの仕事の矢印と 1 本ずつ対応）。垂直抗力は描かない。
 *   長さは力ごとの縮尺: 重力・摩擦力はいつも同じ長さ、ばねの弾性力はその場面の最大を同じ長さにして比例。
 *   鉛直ばね振り子で重力とばねの弾性力を両方描くときだけ共通の縮尺（つり合いの位置で同じ長さ）。
 * 棒グラフは「はじめ ｜ いま」。矢印の箱の値はそれまでの合計。
 * 予想の機能はやめた（画面が汚れる。先生の判断 2026-11-18）。予想する点のデータは simcore.js に残してある。
 * 基準面の点線は指で上下できる（物体より上にすると重力の棒は負）。
 * URL: ?test で自己テスト（body の data-test）。?s=場面&t=秒&ref=&nospring&noearth&noforce&light で見本の画面
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const UIFONT = '"BIZ UDPGothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif';
  EBar.setFonts(UIFONT);
  const qs = new URLSearchParams(location.search);
  const SC = ESim.SCENES;
  const ALIAS = { climb: 'sfclimb', turn: 'sturn', stop: 'srough', back: 'sfback' };   // 前の版の ?p=

  let scene = SC[0], P = {}, W = null, scanR = null, ref = 0, scale = null;
  const sys = { spring: true, earth: true };
  let dark = !qs.has('light'), adj = false;
  let st = null, st0 = null, running = false, slow = false, last = 0, trail = [], showF = !qs.has('noforce');

  const fmt2 = v => { const a = Math.abs(v); if (a < 0.005) return '0'; const t = a >= 100 ? String(Math.round(a)) : String(+a.toPrecision(2)); return (v < 0 ? '−' : '') + (a < 10 && !t.includes('.') ? t + '.0' : t); };
  const hasSpring = () => !!W.spring;
  const hasFric = () => W.f > 0 && W.rough.length > 0;
  const springIn = () => hasSpring() && sys.spring;
  const earthIn = () => !scene.vertical || sys.earth;
  const keys = () => ['K', ...(springIn() ? ['Us'] : []), ...(earthIn() ? ['Ug'] : [])];

  /* 目盛り: 走るあいだ動かさない。先に最後まで動かして調べた値の幅（scan）から、1 目盛りを 1・2・5 × 10ⁿ で決める */
  function calcScale() {
    const mg = W.m * ESim.g, hi = [0, scanR.K[1]], lo = [0];
    if (springIn()) hi.push(scanR.Us[1]);
    if (earthIn()) { lo.push(mg * (scanR.y[0] - ref)); hi.push(mg * (scanR.y[1] - ref)); }
    const sm = scanR.sum[(springIn() ? 's' : '') + (earthIn() ? 'e' : '')], sh = earthIn() ? -mg * ref : 0;
    lo.push(sm[0] + sh); hi.push(sm[1] + sh);
    const max = Math.max(...hi), min = Math.min(...lo);
    const raw = Math.max((max - min) / 8, 0.01), e = Math.pow(10, Math.floor(Math.log10(raw)));
    scale = { unit: [1, 2, 5, 10].map(k => k * e).find(u => u >= raw - 1e-12), max, min };
  }
  // 棒の数値は目盛りの 1/5 程度の刻み（細かく出すと隣の棒の数値と重なった）
  const rd = v => { const q = Math.pow(10, Math.floor(Math.log10(scale.unit / 5) + 1e-9)); return +(Math.round(v / q) * q).toPrecision(6) || 0; };

  /* ── コース（自前で描く。教室の後ろから見えるよう線を太く、字を大きく） ── */
  const U = 100;                       // 1 m = 100
  const X = x => x * U, Y = y => -y * U;
  const R_BALL = 0.1;
  const pal = () => dark
    // 灰色は黒地で暗すぎると後ろの席から読めない（初見のレビュー 2026-11-17）ので明るめ
    // sys: 系の囲み（黒地は黄色、白地は濃い黄色）。force: 力の矢印（黒地は橙、白地は濃い橙）
    ? { bg: '#0e1210', ink: '#f2f2ea', grey: '#c3c8bf', fill: '#1d2420', sys: '#ffd84d', force: '#ff7a59' }
    : { bg: '#ffffff', ink: '#151515', grey: '#6f6f6f', fill: '#ffffff', sys: '#b8860b', force: '#d9531e' };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const n1 = v => +v.toFixed(1);
  const ln = (x1, y1, x2, y2, col, sw, dash) => `<line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const tx = (x, y, s, fs, col, anchor = 'middle', wt = 700) => `<text x="${n1(x)}" y="${n1(y)}" font-size="${fs}" font-weight="${wt}" fill="${col}" text-anchor="${anchor}" font-family='${UIFONT}'>${esc(s)}</text>`;
  const head = (x, y, ux, uy, col, L, hw) => `<polygon points="${n1(x)},${n1(y)} ${n1(x - ux * L - uy * hw)},${n1(y - uy * L + ux * hw)} ${n1(x - ux * L + uy * hw)},${n1(y - uy * L - ux * hw)}" fill="${col}"/>`;
  const zig = (ax, ay, bx, by, col, n = 10, amp = 5.5) => {   // ばね（ジグザグ）。両端は少しまっすぐ
    const L = Math.hypot(bx - ax, by - ay) || 1e-6, ux = (bx - ax) / L, uy = (by - ay) / L, lead = Math.min(4, L / 4);
    let pts = `${n1(ax)},${n1(ay)} ${n1(ax + ux * lead)},${n1(ay + uy * lead)}`;
    for (let i = 0; i < n; i++) { const d = lead + (L - 2 * lead) * (i + 0.5) / n, s = i % 2 ? amp : -amp; pts += ` ${n1(ax + ux * d - uy * s)},${n1(ay + uy * d + ux * s)}`; }
    pts += ` ${n1(bx - ux * lead)},${n1(by - uy * lead)} ${n1(bx)},${n1(by)}`;
    return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
  };
  // 物体の接地点・向き・面の法線（飛んでいるあいだは飛び出したときの向きのまま）
  function bodyAt(s) {
    if (scene.vertical) return { x: s.x, y: s.y, ang: 0, nx: 0, ny: 1 };
    if (s.ph === 'fly') { const l = s.launch; return { x: s.x, y: s.y, ang: Math.atan2(l.ty, l.tx) * 180 / Math.PI, nx: -l.ty, ny: l.tx }; }
    const p = ESim.at(W.tr, s.s);
    return { x: p.x, y: p.y, ang: Math.atan2(p.ty, p.tx) * 180 / Math.PI, nx: -p.ty, ny: p.tx };
  }
  // 図の枠（m）。道・飾り・動く範囲を全部入れる
  function frameBox() {
    const xs = [...W.tr.pts.map(p => p[0]), scanR.x[0], scanR.x[1]], ys = [...W.tr.pts.map(p => p[1]), scanR.y[0], scanR.y[1], 0];
    const d = W.deco;
    // 鉛直の場面: 左に予想の点の文字、右に高さや「自然長」の文字
    if (scene.vertical) { const p = W.tr.pts; ys.splice(0, ys.length, p[0][1], scanR.y[0], scanR.y[1], 0); xs.splice(0, xs.length, -0.62, 0.3); }
    if (d.natural && d.natural.y != null) xs.push(0.78);
    if (d.floor) xs.push(d.floor[0], d.floor[1] == null ? scanR.x[1] + 0.25 : d.floor[1]);
    if (d.wall) { xs.push(d.wall.x - 0.05); ys.push(d.wall.y2); }
    if (d.ceil) { xs.push(d.ceil.x1, d.ceil.x2); ys.push(d.ceil.y + 0.08); }
    (d.dims || []).forEach(m => xs.push(m.x - 0.05, m.x + (m.x > 0 ? 0.62 : 0)));
    // 下は「粗い面」の字（床の 0.30 下）と系の囲みの線が重ならないだけあける
    const top = Math.max(...ys) + (scene.vertical ? 0.42 : 0.55), bot = Math.min(...ys) - 0.42;
    return { left: X(Math.min(...xs)) - 22, right: X(Math.max(...xs)) + 22, top: Y(top), bot: Y(bot) };
  }
  function courseSVG() {
    const c = pal(), d = W.deco, F = frameBox();
    let g = `<rect x="${n1(F.left)}" y="${n1(F.top)}" width="${n1(F.right - F.left)}" height="${n1(F.bot - F.top)}" fill="${c.bg}"/>`;
    // 基準面（指で上下に動かす）。床や台より先に描く（上に描くと、床と重なったとき床が点線に見えた）
    const yr = Y(ref);
    g += ln(F.left + 2, yr, F.right - 4, yr, c.grey, 2, '7 5');
    // 文字は右端の線の下（鉛直の場面は左端。右に置くと物体に重なった）
    const yl = ref < 0 || yr + 26 > F.bot ? yr - 6 : yr + 21;
    // 端から少し内側に（外側には系の囲みの線が通る）
    g += scene.vertical ? tx(F.left + 12, yl, '基準面 ⇕', 16, c.grey, 'start') : tx(F.right - 12, yl, '基準面 ⇕', 16, c.grey, 'end');
    // 飛んだ道すじ（点）
    trail.forEach(([x, y]) => { g += `<circle cx="${n1(X(x))}" cy="${n1(Y(y) - (scene.body === 'ball' ? R_BALL * U : 0))}" r="2.4" fill="${c.grey}"/>`; });
    // 床（下に短い斜線）
    if (d.floor) {
      const x1 = X(d.floor[0]), x2 = d.floor[1] == null ? F.right - 10 : X(d.floor[1]);
      for (let x = x1; x < x2 - 2; x += 9) g += ln(x + 6, 1.5, x, 7.5, c.grey, 1.2);
      g += ln(x1, 0, x2, 0, c.ink, 2.6);
    }
    // 台・斜面・曲面（道の下を塗る）と道
    if (!scene.vertical) {
      const pts = W.tr.pts.map(p => `${n1(X(p[0]))},${n1(Y(p[1]))}`).join(' ');
      if (d.solid) {
        const a = W.tr.pts[0], b = W.tr.pts[W.tr.pts.length - 1];
        g += `<polygon points="${pts} ${n1(X(b[0]))},0 ${n1(X(a[0]))},0" fill="${c.fill}" stroke="${c.ink}" stroke-width="2.6" stroke-linejoin="round"/>`;
      } else g += `<polyline points="${pts}" fill="none" stroke="${c.ink}" stroke-width="2.6" stroke-linejoin="round"/>`;
    }
    // 粗い面（太線＋濃い斜線）
    W.rough.forEach(([a, b]) => {
      const p = ESim.at(W.tr, a), q = ESim.at(W.tr, b), yy = Y(p.y);
      for (let x = X(p.x); x < X(q.x) - 2; x += 4) g += ln(x + 5, yy + 3, x, yy + 9, c.ink, 1.6);
      g += `<rect x="${n1(X(p.x))}" y="${n1(yy - 3.5)}" width="${n1(X(q.x - p.x))}" height="7" fill="${c.ink}"/>`;
      g += tx(X((p.x + q.x) / 2), yy + 30, '粗い面', 16, c.ink);
    });
    // 壁・天井
    if (d.wall) {
      g += ln(X(d.wall.x), Y(d.wall.y1), X(d.wall.x), Y(d.wall.y2), c.ink, 2.6);
      for (let y = Y(d.wall.y2) + 4; y < Y(d.wall.y1); y += 8) g += ln(X(d.wall.x), y, X(d.wall.x) - 6, y + 6, c.grey, 1.2);
    }
    if (d.ceil) {
      const yc = Y(d.ceil.y);
      g += ln(X(d.ceil.x1), yc, X(d.ceil.x2), yc, c.ink, 2.6);
      for (let x = X(d.ceil.x1); x < X(d.ceil.x2) - 2; x += 9) g += ln(x, yc, x + 6, yc - 6, c.grey, 1.2);
    }
    // 自然の長さ（振り子）
    if (d.natural) {
      // 「自然長」（物理の授業プリントの言い方）
      if (d.natural.x != null) { const xn = X(d.natural.x); g += ln(xn, -2, xn, Y(0.42), c.grey, 1.6, '5 4') + tx(xn, Y(0.42) - 6, '自然長', 16, c.grey); }
      else { const yn = Y(d.natural.y); g += ln(X(-0.28), yn, X(0.28), yn, c.grey, 1.6, '5 4') + tx(X(0.31), yn + 6, '自然長', 16, c.grey, 'start'); }
    }
    // 高さ（両矢印）。gx があれば、物体のはじめの位置まで点線
    (d.dims || []).forEach(m => {
      const dx = X(m.x), y1 = Y(m.y1), y2 = Y(m.y2);
      g += ln(dx, y2 + 6, dx, y1 - 6, c.ink, 1.6) + head(dx, y2, 0, -1, c.ink, 7, 3.2) + head(dx, y1, 0, 1, c.ink, 7, 3.2);
      if (m.gx != null) g += ln(dx, y2, X(m.gx), y2, c.grey, 1.4, '4 4');
      const lab = `${fmt2(m.y2 - m.y1)} m`;
      g += m.x < 0 ? tx(dx - 6, (y1 + y2) / 2 + 6, lab, 17, c.ink, 'end') : tx(dx + 6, (y1 + y2) / 2 + 6, lab, 17, c.ink, 'start');
    });
    // A・B などの点の印は描かない（予想の機能をやめたので使い道がない。先生の判断 2026-11-18）
    // ばね
    if (W.spring) {
      const sp = W.spring;
      if (scene.vertical) g += zig(X(0), Y(W.tr.pts[0][1]), X(st.x), Y(st.y + sp.off), c.ink, 12, 9);
      else {
        const a = ESim.at(W.tr, 0), sf = st.ph === 'fly' ? sp.L0 : (sp.attached ? st.s - sp.off : Math.min(st.s - sp.off, sp.L0)), b = ESim.at(W.tr, sf);
        g += zig(X(a.x), Y(a.y + sp.h), X(b.x), Y(b.y + sp.h), c.ink);
      }
    }
    // 物体
    const o = bodyAt(st);
    let cx = X(o.x), cy = Y(o.y), bc = { x: o.x, y: o.y };
    if (scene.body === 'cart') {
      const hw = ESim.HW * U;
      g += `<g transform="translate(${n1(cx)} ${n1(cy)}) rotate(${n1(-o.ang)})">` +
        `<rect x="${-hw}" y="-21" width="${2 * hw}" height="13" rx="1.5" fill="${c.fill}" stroke="${c.ink}" stroke-width="2.6"/>` +
        `<circle cx="${-hw + 6}" cy="-4" r="4" fill="${c.bg}" stroke="${c.ink}" stroke-width="2.2"/>` +
        `<circle cx="${hw - 6}" cy="-4" r="4" fill="${c.bg}" stroke="${c.ink}" stroke-width="2.2"/></g>`;
      bc = { x: o.x + o.nx * 0.14, y: o.y + o.ny * 0.14 };
    } else if (scene.body === 'box') {
      const b = ESim.BOX * U;
      g += `<g transform="translate(${n1(cx)} ${n1(cy)}) rotate(${n1(-o.ang)})"><rect x="${-b}" y="${-2 * b}" width="${2 * b}" height="${2 * b}" rx="1.5" fill="${c.fill}" stroke="${c.ink}" stroke-width="2.6"/></g>`;
      bc = { x: o.x + o.nx * ESim.BOX, y: o.y + o.ny * ESim.BOX };
    } else if (scene.body === 'ball') {
      bc = { x: o.x + o.nx * R_BALL, y: o.y + o.ny * R_BALL };
      g += `<circle cx="${n1(X(bc.x))}" cy="${n1(Y(bc.y))}" r="${R_BALL * U}" fill="${c.fill}" stroke="${c.ink}" stroke-width="2.6"/>`;
    } else {   // おもり（中心が点）
      g += `<rect x="${n1(cx - 11)}" y="${n1(cy - 6)}" width="22" height="12" rx="1.5" fill="${c.fill}" stroke="${c.ink}" stroke-width="2.6"/>`;
    }
    // 速さの矢印（物体の上か横、動く向き。長さは速さに比例）
    const e = ESim.energies(W, st, ref);
    if (e.speed > 0.05) {
      let ux, uy;
      if (st.ph === 'fly') { const v = Math.hypot(st.vx, st.vy); ux = st.vx / v; uy = -st.vy / v; }
      else { const p = ESim.at(W.tr, st.s), sg = Math.sign(st.v) || 1; ux = p.tx * sg; uy = -p.ty * sg; }
      const side = scene.vertical ? [0.22, 0] : [o.nx * 0.3, o.ny * 0.3];
      const bx = X(bc.x + side[0]) - ux * 6, by = Y(bc.y + side[1]) - uy * 6, L = Math.min(12 + e.speed * 12, 52);
      const ex = bx + ux * L, ey = by + uy * L;
      g += ln(bx, by, ex - ux * 6, ey - uy * 6, c.ink, 3) + head(ex, ey, ux, uy, c.ink, 9, 4.5);
    }
    if (showF) g += forceArrows(c, o, bc);
    g += sysLine(c, F, o, bc);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(F.left)} ${n1(F.top)} ${n1(F.right - F.left)} ${n1(F.bot - F.top)}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
  }
  // ばねの先（物体の側の端）の道のりの位置
  const springEnd = sp => st.ph === 'fly' ? sp.L0 : (sp.attached ? st.s - sp.off : Math.min(st.s - sp.off, sp.L0));

  /* 力の矢印: 系の外から仕事をする力だけ（棒グラフの仕事の矢印と 1 本ずつ対応）。垂直抗力は仕事をしないので描かない。
   * 作用点の黒丸から描き、まわりを背景の色でふちどる（台車の線と重なっても読める）。
   * 長さは力ごとの縮尺（N の値やほかの力との比は気にしない。先生の判断 2026-11-18）:
   *   重力・摩擦力はいつも F_LMAX。ばねの弾性力はその場面でいちばん大きいときを F_LMAX にして比例。
   *   鉛直ばね振り子で重力とばねの弾性力を両方描くときだけ共通の縮尺（つり合いの位置で同じ長さになる）。 */
  const F_LMAX = 60;   // 台車の幅の 2 倍
  function forceArrows(c, o, bc) {
    const mg = W.m * ESim.g, sp = W.spring, list = [];   // [作用点 x, y, 向き ux, uy（SVG）, 長さ]
    const FsMax = sp ? Math.sqrt(2 * sp.k * scanR.Us[1]) : 0;
    const both = scene.vertical && !earthIn() && sp && !springIn(), common = Math.max(FsMax, mg);
    if (!earthIn()) list.push([X(bc.x), Y(bc.y), 0, 1, both ? mg / common * F_LMAX : F_LMAX]);   // 重力: 重心から
    if (st.ph !== 'fly') {
      const p = ESim.at(W.tr, st.s);
      if (sp && !springIn()) {   // ばねの弾性力: ばねがつく面（台車の左の面のばねの高さ／おもりの上の面）
        const F = ESim.springAt(W, st.s).F, sg = Math.sign(F), L = Math.abs(F) / (both ? common : FsMax) * F_LMAX;
        if (scene.vertical) list.push([X(st.x), Y(st.y + sp.off), 0, sg, L]);   // 鉛直の道は下向きが s の正
        else { const a = ESim.at(W.tr, st.s - sp.off); list.push([X(a.x + o.nx * sp.h), Y(a.y + o.ny * sp.h), p.tx * sg, -p.ty * sg, L]); }
      }
      if (ESim.onRough(W, st.s) && st.v !== 0) {   // 摩擦力: 面と接する所。動く向きと逆
        const sg = -Math.sign(st.v);
        list.push([X(o.x), Y(o.y), p.tx * sg, -p.ty * sg, F_LMAX]);
      }
    }
    let halo = '', ink = '';
    list.forEach(([x, y, ux, uy, L]) => {
      if (!(L >= 12)) return;   // 短すぎる矢印は矢じりだけになるので描かない（ばねが自然の長さに近いとき）
      const ex = x + ux * L, ey = y + uy * L;
      halo += `<circle cx="${n1(x)}" cy="${n1(y)}" r="5.4" fill="${c.bg}"/>` + ln(x, y, ex - ux * 8, ey - uy * 8, c.bg, 6.6) + head(ex + ux * 1.8, ey + uy * 1.8, ux, uy, c.bg, 13.6, 7.4);
      ink += `<circle cx="${n1(x)}" cy="${n1(y)}" r="3.2" fill="${c.force}"/>` + ln(x, y, ex - ux * 8, ey - uy * 8, c.force, 2.4) + head(ex, ey, ux, uy, c.force, 10, 5.5);
    });
    return ink ? `<g class="force">${halo}${ink}</g>` : '';
  }

  /* 系の囲み: 黄色の細い点線。「系」「地球」の字は添えない（先生が説明する）。
   *   地球を入れるとき: 地面ごと囲む（枠いっぱいの四角）。ばねを外したら、ばねのところだけ外へへこませる。
   *   地球を外すとき（鉛直の場面）: 物体（とばね）だけを囲む。 */
  function sysLine(c, F, o, bc) {
    const pad = 9, sp = W.spring, spOut = sp && !springIn();
    const attr = `fill="none" stroke="${c.sys}" stroke-width="1.6" stroke-dasharray="7 5" stroke-linejoin="round" class="sysline"`;
    const path = pts => `<path d="M${pts.map(([x, y]) => `${n1(x)},${n1(y)}`).join(' L')} Z" ${attr}/>`;
    if (earthIn()) {
      // 上は左上の「速さ・高さ」の字にかからないよう少し下げる
      const L = F.left + 5, R = F.right - 5, T = F.top + 24, B = F.bot - 5;
      if (!spOut) return path([[L, T], [R, T], [R, B], [L, B]]);
      if (!scene.vertical) {   // 上から、壁とばねの先のあいだを、床（台）の面のすぐ上まで切り込む
        const a = ESim.at(W.tr, 0), b = ESim.at(W.tr, springEnd(sp));
        const touch = st.ph !== 'fly' && (sp.attached || st.s - sp.off <= sp.L0 + 1e-9);
        const x0 = X(W.deco.wall ? W.deco.wall.x : a.x) + 3, x1 = X(b.x) + (touch ? -1 : 3), yb = Y(a.y) - 3;
        return path([[L, T], [x0, T], [x0, yb], [x1, yb], [x1, T], [R, T], [R, B], [L, B]]);
      }
      // 鉛直: 左から、天井とおもりのあいだを切り込む
      const yt = Y(W.tr.pts[0][1]) + 3, yb = Y(st.y + sp.off) - 1, xr = X(0) + 9 + pad;
      return path([[L, T], [R, T], [R, B], [L, B], [L, yb], [xr, yb], [xr, yt], [L, yt]]);
    }
    let x0, x1, y0, y1;
    if (scene.body === 'ball') { const r = R_BALL * U + pad; x0 = X(bc.x) - r; x1 = X(bc.x) + r; y0 = Y(bc.y) - r; y1 = Y(bc.y) + r; }
    else { const cx = X(o.x), cy = Y(o.y); x0 = cx - 11 - pad; x1 = cx + 11 + pad; y0 = cy - 6 - pad; y1 = cy + 6 + pad; }   // おもり
    if (sp && !spOut) { y0 = Y(W.tr.pts[0][1]) + 4; x0 = Math.min(x0, X(0) - 9 - pad); x1 = Math.max(x1, X(0) + 9 + pad); }   // ばねも囲む（天井＝地球は外）
    return `<rect x="${n1(x0)}" y="${n1(y0)}" width="${n1(x1 - x0)}" height="${n1(y1 - y0)}" rx="12" ${attr}/>`;
  }

  /* ── 棒グラフ ── */
  // 仕事の矢印は太く大きく（先生の指摘 2026-11-18「矢印が小さすぎて見づらい」）。
  // 矢じりは広く（幅が線の約 2.7 倍。1.4 倍では線と変わらず向きが読みにくかった）。演習アプリの矢印は変えない
  const CH = () => ({ theme: dark ? 'chalk' : 'color', fs: 5.6, fsName: 4.6, fsTitle: 5.6, fsWork: 4.8, fsBox: 6.6, arrowK: 2.3, headK: 1.3, headW: 0.6, workDepth: 0.62, fmt: 'sig2', ref: true, barGap: 9, sepGap: 6, lwk: 1.7, keys: keys() });
  // スマホの幅では矢印の下の文を図に入れず、図の下に出す（文の幅のぶん棒グラフが小さくなった）
  const narrow = () => window.innerWidth < 600;
  const stateOf = (s, title) => { const e = ESim.energies(W, s, ref), o = { title }; keys().forEach(k => { o[k] = rd(e[k]); }); return o; };
  // 系の外の力がした仕事（はじめから今までの合計）。0 のあいだも場所はとっておく（ghost）
  function worksList(s) {
    const e0 = ESim.energies(W, st0, ref), e = ESim.energies(W, s, ref), nm = W.bodyNm, raw = [];
    if (hasSpring() && !springIn()) raw.push({ w: rd(e0.Us - e.Us), who: 'ばねの弾性力', sign: 1 });
    if (!earthIn()) raw.push({ w: rd(e0.Ug - e.Ug), who: '重力', sign: 1 });
    if (hasFric()) raw.push({ w: -rd(e.Wf), who: '摩擦力', sign: -1 });
    // 箱の値の合計を、棒の合計の差（どちらも丸めた値）にそろえる。別々に丸めると「+2.5 J」と棒の差 2.6 J が食い違った
    const ks = keys(), diff = ks.reduce((a, k) => a + rd(e[k]) - rd(e0[k]), 0), res = diff - raw.reduce((a, r) => a + r.w, 0);
    const big = raw.filter(r => r.w !== 0).sort((a, b) => (a.who === '摩擦力') - (b.who === '摩擦力') || Math.abs(b.w) - Math.abs(a.w))[0];
    if (big && Math.abs(res) > 1e-9) big.w = +(big.w + res).toPrecision(6);
    // 矢印の下の文は「摩擦力が台車に」だけ。正か負かは矢印の向きと箱の符号で分かる（同じことを何か所でも言わない。先生の指摘 2026-11-18）
    return raw.map(({ w, who }) => {
      const text = `${who}が${nm}に`;
      return w ? { W: w, who, text: narrow() ? null : text, cap: text } : { W: 0, who, ghost: true, text: narrow() ? null : text };
    });
  }
  const worksOpt = list => list.length === 0 ? [] : list.length === 1 ? [list[0]] : [list];
  const chartOpt = extra => Object.assign(CH(), { unit: scale.unit, max: scale.max, min: scale.min }, extra || {});
  function chartSVG() {
    return EBar.chart([stateOf(st0, 'はじめ'), stateOf(st, 'いま')], chartOpt({ works: worksOpt(worksList(st)) }));
  }

  function fit(svgHtml) {   // 枠いっぱいに縮める（縦横比は保つ）
    return svgHtml.replace(/<svg([^>]*?) width="[^"]*" height="[^"]*"/, '<svg$1 preserveAspectRatio="xMidYMid meet"');
  }
  function render() {
    $('course').innerHTML = courseSVG();
    $('chart').innerHTML = fit(chartSVG());
    // スマホ: 矢印の文は図の下に
    const caps = narrow() ? worksList(st).filter(w => !w.ghost).map(w => `${w.W > 0 ? '↓' : '↑'} ${w.cap}（${w.W > 0 ? '+' : '−'}${fmt2(Math.abs(w.W))} J）`) : [];
    $('fricCap').innerHTML = caps.map(esc).join('<br>');
    $('fricCap').classList.toggle('hidden', !caps.length);
    const e = ESim.energies(W, st, ref);
    $('readout').textContent = `速さ ${fmt2(e.speed)} m/s　高さ ${fmt2(e.y - ref)} m`;
    $('bRun').textContent = running ? '⏸ 止める' : (st.t === 0 ? '▶ 走らせる' : '▶ 続ける');
    $('bRun').disabled = !running && ['stop', 'end', 'land'].includes(st.done);
  }
  // 縦長の場面（鉛直）は、広い横長の画面では図と棒グラフを左右に並べる
  function layoutClass() {
    const F = frameBox();
    $('stage').classList.toggle('tall', (F.bot - F.top) / (F.right - F.left) > 0.8);
  }
  function renderSys() {
    // 系: 物体はいつも入れる。ばねは選べる（ばねのある場面）。地球は鉛直の場面だけ選べる。外せないものは薄いチェック欄
    const cb = (lab, on, k) => k
      ? `<button type="button" class="cb${on ? ' on' : ''}" data-k="${k}" aria-pressed="${on}"><span class="bx">${on ? '✓' : ''}</span>${lab}</button>`
      : `<span class="cb on lock" aria-disabled="true"><span class="bx">✓</span>${lab}</span>`;
    let h = `<span class="lab">系に含めるもの：</span>${cb(W.bodyNm, true)}`;
    if (hasSpring()) h += cb('ばね', sys.spring, 'spring');
    h += cb('地球', earthIn(), scene.vertical ? 'earth' : null);
    $('sys').innerHTML = h;
    $('sys').querySelectorAll('button').forEach(b => b.onclick = () => {
      sys[b.dataset.k] = !sys[b.dataset.k];
      calcScale();
      renderSys(); render();
    });
  }
  function renderBars() {
    $('preset').value = scene.id;
    $('bAdj').classList.toggle('on', adj);
    $('custom').classList.toggle('hidden', !adj);
    $('bForce').classList.toggle('on', showF);
    $('bForce').setAttribute('aria-pressed', showF);
    $('bTheme').textContent = dark ? '☀' : '🌙';
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name=theme-color]').content = dark ? '#0e1210' : '#fbfbf7';
    renderSys();
  }
  function renderCustom() {
    const fixed = [`質量 ${W.m.toFixed(1)} kg`];
    if (hasSpring()) fixed.push(`ばね定数 ${W.spring.k} N/m`);
    if (hasFric()) fixed.push(`摩擦力 ${W.f.toFixed(1)} N`);
    $('custom').innerHTML = scene.params.map(s => `<label class="sl"><span class="nm">${s.nm}</span><span class="val" id="v_${s.key}"></span>` +
      `<input type="range" id="s_${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${P[s.key]}"></label>`).join('') +
      `<span class="fixed">${fixed.join('・')}</span>`;
    scene.params.forEach(s => {
      const show = () => { $('v_' + s.key).textContent = `${(+P[s.key]).toFixed((String(s.step).split('.')[1] || '').length)} ${s.unit}`; };
      show();
      $('s_' + s.key).addEventListener('input', e => { P[s.key] = +e.target.value; show(); rebuild(false); });
    });
  }
  // 場面の形を作り直す（場面を変えた・値を動かした）
  function rebuild(newScene) {
    W = scene.build(Object.assign({}, P));
    W.bodyNm = scene.bodyNm;
    scanR = ESim.scan(W);
    ref = newScene ? W.ref0 : Math.max(W.refRange[0], Math.min(W.refRange[1], ref));
    calcScale(); resetRun(); layoutClass(); renderBars(); render();
  }
  function setScene(id) {
    scene = SC.find(s => s.id === (ALIAS[id] || id)) || SC[0];
    P = Object.assign({}, scene.def);
    rebuild(true); renderCustom();
  }

  /* ── 動かす ── */
  function advance(dt) {
    ESim.step(W, st, dt, null);
    if (st.ph === 'fly' && (!trail.length || st.t - trail.t > 0.035)) { trail.push([st.x, st.y]); trail.t = st.t; }
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05) * (slow ? 0.25 : 1); last = now;
    advance(dt);
    if (st.done) { running = false; done(); }
    render();
    if (running) requestAnimationFrame(frame);
  }
  // 文は何が起きたかだけ（摩擦力の仕事の値は矢印の箱に出ているので書かない）
  function done() {
    if (st.done === 'stop') msg('粗い面の上で止まりました。');
    else if (st.done === 'end') msg('右端に着きました。');
    else if (st.done === 'land') msg('床に着く直前で止めています。');
  }
  function msg(t) { $('msg').textContent = t; }
  function resetRun() {
    running = false; st = ESim.init(W); st0 = ESim.init(W); trail = []; msg('');
  }

  $('bRun').onclick = () => {
    if (running) { running = false; render(); return; }
    if (st.t === 0) msg('');
    running = true; last = performance.now(); requestAnimationFrame(frame); render();
  };
  $('bReset').onclick = () => { resetRun(); render(); };
  $('bSlow').onclick = () => { slow = !slow; $('bSlow').classList.toggle('on', slow); };
  $('bForce').onclick = () => { showF = !showF; renderBars(); render(); };
  $('bAdj').onclick = () => { adj = !adj; renderBars(); };
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

  /* 場面はプルダウン（4 つのまとまり） */
  $('preset').innerHTML = ESim.GROUPS.map((gname, gi) => `<optgroup label="${gname}">` +
    SC.filter(s => s.grp === gi).map(s => `<option value="${s.id}">${s.nm}</option>`).join('') + '</optgroup>').join('');
  $('preset').addEventListener('change', e => setScene(e.target.value));

  const toSvg = (svg, e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  /* 基準面を指で上下（0.05 m 刻み、場面ごとの範囲） */
  (function bindRef() {
    const box = $('course'); let drag = false;
    const set = e => {
      const y = -toSvg(box.querySelector('svg'), e).y / U, v = Math.round(y / 0.05) * 0.05;
      const nv = Math.max(W.refRange[0], Math.min(W.refRange[1], +v.toFixed(2)));
      if (nv !== ref) { ref = nv; calcScale(); render(); }
    };
    box.addEventListener('pointerdown', e => {
      const svg = box.querySelector('svg'); if (!svg) return;
      if (Math.abs(toSvg(svg, e).y - Y(ref)) > 16) return;
      drag = true; e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch (_) { /* 古いブラウザ */ }
    });
    box.addEventListener('pointermove', e => { if (drag) set(e); });
    const up = () => { drag = false; };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  })();

  // 見本の画面: ?s=場面&t=秒&ref=&nospring&noearth&noforce
  if (qs.has('nospring')) sys.spring = false;
  if (qs.has('noearth')) sys.earth = false;
  setScene(qs.get('s') || qs.get('p') || 'sfclimb');
  if (qs.has('ref')) { ref = +qs.get('ref'); calcScale(); }
  if (qs.has('t')) { const T = +qs.get('t'); while (!st.done && st.t < T) advance(1 / 60); if (st.done) done(); }
  render();

  /* ── 自己テスト ── */
  if (qs.has('test')) {
    const ng = [];
    const runAll = () => { let n = 0; while (!st.done && n++ < 1500) advance(1 / 60); };
    const expect = { fall: 'land', slope: 'end', valley: null, valley2: null, jump: 'land', hosc: null, push: 'end', vosc: null, table: 'land', sclimb: 'end', sturn: null, srough: 'stop', slrough: 'stop', vrough: 'stop', sfclimb: 'end', sfback: 'stop' };
    if (Object.keys(expect).length !== SC.length) ng.push('場面の数が合わない');
    const ys = {};
    for (const s of SC) {
      setScene(s.id);
      let errMax = 0, yMax = -Infinity, yMin = Infinity, n = 0;
      while (!st.done && n++ < 1500) {
        advance(1 / 60);
        const e = ESim.energies(W, st, ref);
        errMax = Math.max(errMax, Math.abs(e.K + e.Us + e.Ug + e.Wf - W.E0 + W.m * ESim.g * ref));
        yMax = Math.max(yMax, st.y); yMin = Math.min(yMin, st.y);
      }
      ys[s.id] = { yMax, yMin, speed: ESim.energies(W, st).speed, Wf: st.Wf };
      if (st.done !== expect[s.id]) ng.push(`${s.id}: ${st.done}`);
      if (errMax > 1e-6) ng.push(`${s.id}: 力学的エネルギーと摩擦力の仕事の和が変わる ${errMax}`);
      render();
      if (!/<svg/.test($('course').innerHTML) || !/<svg/.test($('chart').innerHTML)) ng.push(`${s.id}: 図が出ない`);
      if (!/class="sysline"/.test($('course').innerHTML)) ng.push(`${s.id}: 系の囲みが出ない`);
      if (/NaN/.test($('course').innerHTML)) ng.push(`${s.id}: コースの図に NaN`);
    }
    const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) ng.push(`${what} ${a}（${b} のはず）`); };
    near(ys.fall.speed, Math.sqrt(2 * 9.8 * 1.0), 1e-3, '自由落下: 床に着く速さ');
    near(ys.valley.yMax, 0.6, 3e-3, '曲面（対称）: 右側の高さ');
    near(ys.valley2.yMax, 0.6, 3e-3, '曲面（非対称）: 右側の高さ');
    near(ys.vosc.yMin, 0, 3e-3, '鉛直ばね振り子: いちばん下');
    near(ys.table.speed, Math.sqrt(200 * 0.15 * 0.15 + 2 * 9.8 * 0.6), 1e-3, '台から飛び出す: 床に着く速さ');
    near(ys.sturn.yMax, 4 / 9.8, 2e-3, 'ばね → 斜面の途中で戻る: いちばん高い所');
    near(ys.srough.Wf, 1.0, 1e-3, 'ばね → 粗い面: 摩擦力の仕事');
    near(ys.slrough.Wf, 9.8 * 0.25, 1e-3, '斜面 → 粗い面: 摩擦力の仕事');
    near(ys.vrough.Wf, 9.8 * 0.5, 1e-3, '斜面 → 粗い底面: 摩擦力の仕事');
    // 曲面から飛び出す: 飛んでいちばん高い所 = 0.25 + (v sin45°)²/2g、v² = 2g(0.80 − 0.25)
    setScene('jump'); { let ym = -Infinity, n = 0; while (!st.done && n++ < 1500) { advance(1 / 240); if (st.ph === 'fly') ym = Math.max(ym, st.y); }
      near(ym, 0.25 + 2 * 9.8 * 0.55 * 0.5 / (2 * 9.8), 2e-3, '曲面から飛び出す: いちばん高い所'); }
    // 摩擦の矢印（文は「摩擦力が台車に」だけ。正・負の文は出さない）と、止まったときの文
    setScene('srough'); runAll(); done(); render();
    if (!/摩擦力が台車に/.test($('chart').innerHTML)) ng.push('摩擦の矢印が出ない');
    if (/の仕事をした/.test($('chart').innerHTML)) ng.push('矢印の下に「正／負の仕事をした」が残っている');
    if ($('msg').textContent !== '粗い面の上で止まりました。') ng.push(`止まったときの文: ${$('msg').textContent}`);
    // 力の矢印: 系の外から仕事をする力だけ
    const hasF = () => /class="force"/.test(courseSVG());
    const stepTo = (T) => { while (!st.done && st.t < T) advance(1 / 240); };
    setScene('srough'); stepTo(0.01); if (hasF()) ng.push('ばねを系に入れているのに力の矢印が出る');
    stepTo(0.3); if (!(ESim.onRough(W, st.s) && st.v !== 0)) ng.push('粗い面の上の時刻の見込みちがい'); else if (!hasF()) ng.push('粗い面の上で摩擦力の矢印が出ない');
    sys.spring = false; setScene('srough'); stepTo(0.01); if (!hasF()) ng.push('ばねを系の外にしたのに弾性力の矢印が出ない');
    showF = false; if (hasF()) ng.push('「力の矢印」を消しても出る'); showF = true;
    sys.spring = true;
    setScene('sclimb'); { let any = false; for (let i = 0; i < 60; i++) { stepTo(st.t + 0.02); if (hasF()) any = true; } if (any) ng.push('地球もばねも系に入れた斜面で力の矢印が出る'); }
    setScene('fall'); stepTo(0.2); if (hasF()) ng.push('地球を系に入れた自由落下で重力の矢印が出る');
    sys.earth = false; setScene('fall'); stepTo(0.2); if (!hasF()) ng.push('地球を外した自由落下で重力の矢印が出ない');
    sys.earth = true;
    // 系のチェック欄: 外せないものは薄い（ボタンにしない）
    setScene('slope'); if ($('sys').querySelectorAll('.cb.lock').length !== 2 || $('sys').querySelector('button')) ng.push('斜面の場面のチェック欄（台車・地球は外せない）');
    setScene('vosc'); if ($('sys').querySelectorAll('button.cb').length !== 2) ng.push('鉛直ばね振り子でばね・地球を選べない');
    // 系: ばねを系の外に → ばねの棒がなく、弾性力の正の仕事の矢印
    setScene('push'); sys.spring = false; calcScale(); runAll(); render();
    const ch = $('chart').innerHTML;
    if (/>ばね</.test(ch)) ng.push('ばねを系の外にしても、ばねの棒がある');
    if (!/ばねの弾性力が台車に/.test(ch) || !/\+4\.0\sJ/.test(ch)) ng.push('ばねの弾性力の仕事（+4.0 J）の矢印が出ない');
    sys.spring = true; setScene('push'); render();
    if (!/>ばね</.test($('chart').innerHTML) || /弾性力が/.test($('chart').innerHTML)) ng.push('ばねを系に入れたのに棒がない／矢印が出る');
    // 鉛直: 地球を系の外に → 重力の棒がなく、重力の仕事の矢印
    setScene('fall'); sys.earth = false; calcScale(); runAll(); render();
    if (/>重力</.test($('chart').innerHTML) || !/重力が小球に/.test($('chart').innerHTML)) ng.push('地球を系の外にしたときの図');
    sys.earth = true;
    // 鉛直でない場面では地球を外せない
    setScene('slope'); if ($('sys').querySelector('[data-k=earth]')) ng.push('斜面の場面で地球を選べてしまう');
    // 基準面を台より上に: 重力の棒が負
    setScene('sfclimb'); ref = 0.6; calcScale(); render();
    if (!/−5\.9\sJ/.test($('chart').innerHTML)) ng.push('基準面を上げても重力の棒が負にならない');
    // 箱の値の合計 = 棒の合計の差（丸めた値どうし）。系の選び方を全部ためす
    for (const [id, sp, ea] of [['vosc', true, false], ['vosc', false, false], ['vosc', false, true], ['sfback', false, true], ['sfback', true, true], ['fall', true, false]]) {
      sys.spring = sp; sys.earth = ea; setScene(id);
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 7; j++) advance(1 / 60);
        const a = stateOf(st0, ''), b = stateOf(st, ''), d = keys().reduce((x, k) => x + b[k] - a[k], 0), w = worksList(st).reduce((x, q) => x + q.W, 0);
        if (Math.abs(d - w) > 1e-6) { ng.push(`${id}: 矢印の値 ${w} と棒の差 ${d}`); break; }
      }
    }
    sys.spring = true; sys.earth = true;
    setScene('sfclimb');
    document.body.dataset.test = ng.length ? 'NG: ' + ng.join(' / ') : 'TEST ALL OK';
  }
})();
