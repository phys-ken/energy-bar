/* 問題の生成器。アプリと Word の両方が使う（docs/decisions.md 4〜9・11）。
 *   EGen.make(level, units, seed?) → 問題 1 つ
 *   EGen.regen(qid)               → 同じ問題を作り直す（qid = 種類-たね。記録の QR に書く）
 *   EGen.UNITS / EGen.LEVELS / EGen.available(level, units)
 * 問題の形:
 *   { qid, type, level, unit, sys, text, chart:{states,opt}|null, scene:spec|null, ask,
 *     answer: {kind:'num', value, tol, unit} | {kind:'choice', choices:[{states,opt}], correct, why:[]} | {kind:'draw', target:{K,Us,Ug}},
 *     explain: [文…], explainChart:{states,opt}|null }
 * 文は自前で作る HTML 片（<b> と <sub> だけ）。
 * 言葉: 仕事の主語は力、受け手は物体。重力の系は「物体と地球」。「失う・消える」は使わない。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = 9.8;
  // 生徒は「単元」を選び、そのあと「出題形式」を選ぶ（「段」とは言わない。先生の指摘 2026-11-15）。
  // 単元の先頭はサンプル（お金）。お金は「棒グラフを読む」だけ。
  const UNITS = [
    { id: 'M', name: 'サンプル：お金の場合', formats: ['read'] },
    { id: 'K', name: '仕事と運動エネルギー' },
    { id: 'Us', name: '弾性力による位置エネルギー' },
    { id: 'Ug', name: '重力による位置エネルギー' },
    { id: 'C', name: '力学的エネルギー保存則' },
    { id: 'F', name: '力学的エネルギーが保存しない場合' },
  ];
  // n は問題の種類の記号（qid の L<n>）に使う内部の番号。画面には出さない
  const FORMATS = [
    { id: 'read', n: 2, name: '棒グラフを読む', time: 30 },
    { id: 'draw', n: 3, name: '棒グラフをかく', time: 45 },
    { id: 'choose', n: 4, name: '場面から棒グラフを選ぶ', time: 30 },
    { id: 'calc', n: 5, name: '速さ・高さなどを計算する', time: 90 },
  ];

  /* ---------- 乱数（たねから同じ列） ---------- */
  function rng(seedHex) {
    let a = parseInt(seedHex, 16) >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r = {
      f: next,
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      pick: arr => arr[Math.floor(next() * arr.length)],
      step: (lo, hi, st) => lo + st * Math.floor(next() * (Math.floor((hi - lo) / st + 1e-9) + 1)),
      shuffle: arr => { const a2 = arr.slice(); for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2; },
    };
    return r;
  }
  const newSeed = () => {
    const b = new Uint32Array(1);
    (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(b) : (b[0] = Math.floor(Math.random() * 2 ** 32));
    return b[0].toString(16).padStart(8, '0').slice(0, 6);
  };

  /* ---------- 数の書き方 ---------- */
  const MINUS = '−';
  // 答えと解説の数の書き方。ちょうど 3 桁以内で表せる値はそのまま（16.8 m/s を 17 に丸めない）、
  // それ以外は有効数字 2 桁（100 以上は整数）。負は − 記号
  function f2(x) {
    const s = x < 0 ? MINUS : '';
    x = Math.abs(x);
    if (x === 0) return '0';
    if (x >= 100) return s + String(Math.round(x));
    const e3 = +x.toPrecision(3);
    const e2 = +x.toPrecision(2);
    if (Math.abs(e3 - x) < 1e-9 * Math.max(1, x) && Math.abs(e2 - x) > 1e-9 * Math.max(1, x)) return s + String(e3);   // 3 桁が要るときだけ
    let t = x.toPrecision(2);
    if (/e/.test(t)) t = String(+t);
    return s + t;
  }
  // 与える値（ちょうどの値。小数第 2 位まで、末尾の 0 は 2 桁目まで残す）
  function fv(x, digits) {
    if (digits != null) return (x < 0 ? MINUS : '') + Math.abs(x).toFixed(digits);
    const r = Math.round(x * 1000) / 1000;
    let t = String(Math.abs(r));
    if (Math.abs(r) < 10 && !t.includes('.')) t += '.0';     // 2.0 kg のように 2 桁
    return (r < 0 ? MINUS : '') + t;
  }
  // 問題文・解説の中は普通の空白（細い空白 U+2009 は書体が切りかわって見えることがある。先生の指摘 2026-11-16）
  const J = v => `${f2(v)} J`;
  const Jx = v => `${v < 0 ? MINUS : ''}${Math.abs(v)} J`;   // 段 2〜4（10 J 刻みのちょうどの値）

  // 図の目盛り: 最大値が 5〜10 目盛りに収まる 1・2・5 系の刻み
  function niceUnit(maxV) {
    const raw = maxV / 7, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
    return 10 * p;
  }
  const r3 = x => Math.round(x * 1000) / 1000;

  /* ---------- 場面の図（docs/figure-style.md。リードαに合わせた） ----------
   * どの場面の物体も実線で描き、A・B の記号を左上に置く（灰色の点線にしない。先生の指摘 2026-11-16）。
   * 記号は { t:'pt', role:'A'|'B' }。計算の問題で記号を使わないときは genCalc で取り除く。 */
  const OBJ = { cart: { hw: 5, h: 7.4 }, block: { hw: 2.75, h: 5.5 } };
  const ptAt = (x, yTop, hw, role) => ({ t: 'pt', x: x - hw - 0.9, y: yTop - 0.6, s: role, role, anchor: 'end' });
  const SC = {
    // 水平面。水平の動きは必ず左から右（先生の指摘 2026-11-16: 水平方向の初速度は必ず右向き）。
    //   spring: 左の壁のばね（打ち出す）／ springRight: 右の壁のばね（左から走ってきて縮める）。springTo でばねが触れる物体の位置
    //   push（左の面から右へ押す力）・pushInto（ばねへ押しこむ短い力）・v0/v（速さの文字、'' なら矢印だけ）・moveB/stopB・dlabel・x2（床の右端）
    flat(o) {
      const y = 20, items = [], obj = o.obj || 'cart', { hw, h } = OBJ[obj];
      const fx = o.from != null ? o.from : 24, xEnd = o.x2 || (o.springRight ? 84 : 96);
      if (o.spring) items.push({ t: 'wall', x: 2, y1: y - 10, y2: y });
      if (o.springRight) items.push({ t: 'wall', x: xEnd, y1: y - 10, y2: y, side: 1 });
      items.push({ t: 'floor', x1: 2, x2: xEnd, y });
      if (o.rough) items.push({ t: 'rough', x1: o.rough[0], x2: o.rough[1], y });
      // ばねは、物体が触れている位置まで（縮める場面は縮んだ位置まで。輪が詰まって見える）
      if (o.spring) items.push({ t: 'spring', x1: 2, x2: (o.springTo != null ? o.springTo : fx) - hw, y });
      if (o.springRight) items.push({ t: 'spring', x1: (o.springTo != null ? o.springTo : fx) + hw, x2: xEnd, y });
      items.push({ t: obj, x: fx, y }, ptAt(fx, y - h, hw, 'A'));
      if (o.to != null) items.push({ t: obj, x: o.to, y }, ptAt(o.to, y - h, hw, 'B'));
      // 力は作用点（物体の面の中央、黒丸）から、物体の外まで十分に出す
      const yc = y - h / 2 - (obj === 'cart' ? 1.4 : 0);
      if (o.push) items.push({ t: 'force', x1: fx - hw, y1: yc, x2: fx + hw + 7, y2: yc, label: o.push, lx: fx - hw - 1.6, ly: yc + 1.5, anchor: 'end' });
      // ばねへ押しこむ力: 左の面から右向き、ばねに重ならない長さ
      if (o.pushInto) items.push({ t: 'force', x1: fx - hw, y1: y - h + 1.2, x2: fx + hw + 1.5, y2: y - h + 1.2, label: o.pushInto, lx: fx - hw - 1.6, ly: y - h + 2.6, anchor: 'end' });
      // 速さ: 物体の上に細い右向きの矢印、文字は矢印の上。role（A・B）は finalize が速さに合わせて長さを変える目印
      const vArrow = (x, s, role) => items.push({ t: 'vel', role, x1: x - hw * 0.3, y1: y - h - 3.2, x2: x + hw * 0.3 + 7, y2: y - h - 3.2, label: s, lx: x + 3.5, ly: y - h - 4.6 });
      if (o.v0 != null) vArrow(fx, o.v0, 'A');
      if (o.v != null && o.to != null) vArrow(o.to, o.v, 'B');
      // 動きの線（動いている物体の後ろに「≡」）と、止まった物体の「v = 0」
      // 押す力の場面の A は、後ろに力の文字があるので動きの線を付けない（速さの矢印で分かる）
      const moveA = o.moveA != null ? o.moveA : (o.v0 != null && !o.push);
      if (moveA) items.push({ t: 'motion', role: 'A', x: fx, y: y - h / 2, ux: 1, uy: 0, half: hw });
      if (o.to != null && o.moveB) items.push({ t: 'motion', role: 'B', x: o.to, y: y - h / 2, ux: 1, uy: 0, half: hw });
      // 「v = 0」は物体の右（右にばねがあるときは物体の真上）
      if (o.to != null && o.stopB) items.push(o.springRight
        ? { t: 'vzero', x: o.to + 1, y: y - h - 1.6 }
        : { t: 'vzero', x: o.to + hw + 1.2, y: y - h / 2 + 1.4, anchor: 'start' });
      if (o.dlabel && o.rough) items.push({ t: 'hdim', x1: o.rough[0], x2: o.rough[1], y, off: 11, label: o.dlabel, side: 1 });
      return { items };
    },
    // 落下・投げ上げ・持ち上げ: hlabel・top/bottom の物体・矢印
    // 鉛直の動き: mode = fall（落下）| up（投げ上げ）| lift（持ち上げ）| lower（下ろす）| shelf（高い所にある）。
    // mid で終わりの位置を途中に。物体は x の列、記号は左、道すじの点線は右（x+4.5）、高さは右（x+11）
    vert(o) {
      const ground = 40, top = 10, x = 14, items = [], obj = o.obj || 'ball';
      const mid = ground - (ground - top) * 0.6;   // 途中の位置（A の速さの矢印と重ならない高さ）
      items.push({ t: 'floor', x1: 0, x2: 30, y: ground });
      if (o.desk) {
        // 机の面を基準面にする場面: 棚の高さは左に、机（天板と脚は実線）とその高さは右に。基準面の点線は机の面の高さ
        const yd = ground - (ground - top) * o.desk / o.H;
        items.push({ t: 'slope', x1: 26, y1: yd, x2: 42, y2: yd }, { t: 'slope', x1: 28, y1: yd, x2: 28, y2: ground }, { t: 'slope', x1: 40, y1: yd, x2: 40, y2: ground });
        items.push({ t: 'ref', x1: 20, x2: 58, y: yd, label: '基準面' });
        items.push({ t: 'vdim', x: 46, ex: 42, y1: yd, y2: ground, label: `${fv(o.desk)} m`, side: 1 });
        items.push({ t: 'floor', x1: 0, x2: 50, y: ground });
      } else items.push({ t: 'ref', x1: 0, x2: 44, y: ground, label: '基準面' });
      const r = 2.0, hw = obj === 'ball' ? r : OBJ.block.hw, hh = obj === 'ball' ? 2 * r : OBJ.block.h;
      // yy は物体の下の面（ボールは下の端）
      const put = (yy, role) => {
        items.push(obj === 'ball' ? { t: 'ball', x, y: yy - r, r } : { t: 'block', x, y: yy });
        if (role) items.push(ptAt(x, yy - hh, hw, role));
      };
      const yA = { fall: top, up: ground, lift: ground, lower: top, shelf: top }[o.mode];
      const yB = { fall: o.mid ? mid : ground, up: o.mid ? mid : top, lift: top, lower: ground }[o.mode];
      if (o.mode === 'shelf') items.push({ t: 'floor', x1: x - 6, x2: x + 6, y: top });   // 棚
      put(yA, o.mode === 'shelf' ? null : 'A');
      if (yB != null) put(yB, 'B');
      // 道すじ（点線＋矢じり）: 落下・投げ上げ
      if (o.mode === 'fall') items.push({ t: 'path', pts: [[x + 4.5, yA - hh / 2], [x + 4.5, yB - hh / 2]] });
      if (o.mode === 'up') items.push({ t: 'path', pts: [[x + 4.5, yA - hh / 2], [x + 4.5, yB - hh / 2]] });
      // 動きの線: 落ちている B は上に、上っている途中の B は下に。いちばん高い所の B は「v = 0」
      if (o.mode === 'fall') items.push({ t: 'motion', role: 'B', x, y: yB - hh / 2, ux: 0, uy: 1, half: hh / 2 });
      if (o.mode === 'up' && o.mid) items.push({ t: 'motion', role: 'B', x, y: yB - hh / 2, ux: 0, uy: -1, half: hh / 2 });
      if (o.mode === 'up' && !o.mid) items.push({ t: 'vzero', x: x - 1, y: yB - hh - 1.6, anchor: 'start' });
      // 手の力: 作用点は物体の下の面の中央（手で下から支える）。上向き。文字は右
      if (o.mode === 'lift' || o.mode === 'lower')
        items.push({ t: 'force', x1: x, y1: yA, x2: x, y2: yA - hh - 7, label: o.force || (o.mode === 'lift' ? '手が持ち上げる力' : '手が支える力'), lx: x + 2, ly: yA - hh - 3, anchor: 'start' });
      // 速さ: 投げ上げは A から上向き（文字は左）、落下は B から下向き（文字は左）
      if (o.v != null && o.mode === 'up') items.push({ t: 'vel', role: 'A', x1: x, y1: yA - hh - 0.6, x2: x, y2: yA - hh - 8, label: o.v, lx: x - 2.6, ly: yA - hh - 4, anchor: 'end' });
      if (o.v != null && o.mode === 'fall') items.push({ t: 'vel', x1: x - 4.5, y1: yB - hh - 6, x2: x - 4.5, y2: yB - hh + 1, label: o.v, lx: x - 6, ly: yB - hh - 1.5, anchor: 'end' });
      // 高さ: 上の物体の高さから補助線を右に引き、床まで両矢印
      if (o.hlabel) {
        const yt = Math.min(yA, yB != null ? yB : yA) - (obj === 'ball' ? r : 0);
        // 手の力の場面と机の場面は、右に別のものがあるので、高さは左に（記号 A・B を使わない計算の問題だけ）
        const hand = o.mode === 'lift' || o.mode === 'lower' || !!o.desk;
        items.push({ t: 'vdim', x: hand ? x - 9 : x + 11, ex: hand ? x - hw : x + hw, y1: yt, y2: ground, label: o.hlabel, side: hand ? -1 : 1 });
      }
      return { items };
    },
    // 斜面: 左上から右下へ。spring（上の台にばね）・rough（下の床）・up（右へ上る斜面）
    // 斜面。up なし: 左上の台から右下へすべり下りる（to で床の上の終わりの位置）。up: 左の床（ばね）から右へ上る
    slope(o) {
      return o.up ? SC.slopeUp(o) : SC.slopeDown(o);
    },
    slopeUp(o) {
      const items = [], ground = 30, topY = 8, xs = 40, xt = 64;   // 斜面の下端 xs、上端 xt
      if (o.spring) items.push({ t: 'wall', x: 2, y1: ground - 10, y2: ground });
      items.push({ t: 'floor', x1: 2, x2: xs, y: ground });
      if (o.rough) items.push({ t: 'rough', x1: o.rough[0], x2: o.rough[1], y: ground });
      items.push({ t: 'slope', x1: xs, y1: ground, x2: xt, y2: topY }, { t: 'floor', x1: xt, x2: xt + 12, y: topY });
      // 斜面の上の位置 u（0 = 下端、1 = 上端）。台車は斜面に沿って傾ける
      const A = Math.atan2(ground - topY, xt - xs), deg = A * 180 / Math.PI, c = Math.cos(A), s = Math.sin(A);
      const on = u => ({ x: xs + (xt - xs) * u, y: ground - (ground - topY) * u });
      const cartOn = (u, role) => {
        const p = on(u);
        items.push({ t: 'cart', x: p.x, y: p.y, ang: deg });
        // 記号は台車の左上（斜面に垂直な向きに少し離す）
        items.push({ t: 'pt', x: p.x - c * 6 - s * 8, y: p.y + s * 6 - c * 8, s: role, role, anchor: 'middle' });
        return p;
      };
      if (o.pull) {
        // ひもが引く力: 作用点は台車の前の面の中央。斜面に沿って上向き
        // A と B を離し（矢印が B に届かない）、力の文字は斜面の外側（左上）に
        const p = cartOn(0.12, 'A');
        const q = cartOn(0.86, 'B');
        const fx = p.x + c * 5 - s * 3.7, fy = p.y - s * 5 - c * 3.7;
        items.push({ t: 'force', x1: fx, y1: fy, x2: fx + c * 8, y2: fy - s * 8, label: o.pull, lx: fx + c * 4 - 2, ly: fy - s * 4 - 4, anchor: 'end' });
        // 一定の速さで動いているので、A にも B にも動きの線（斜面の下側に）
        [p, q].forEach((r, i) => items.push({ t: 'motion', role: 'AB'[i], x: r.x - s * 3.7, y: r.y - c * 3.7, ux: c, uy: -s, half: 5 }));
      } else {
        const xa = o.spring ? 16 : 12;
        if (o.spring) items.push({ t: 'spring', x1: 2, x2: xa - OBJ.cart.hw, y: ground });
        items.push({ t: 'cart', x: xa, y: ground }, ptAt(xa, ground - OBJ.cart.h, OBJ.cart.hw, 'A'));
        const u = o.toTop ? 0.82 : o.toMid ? 0.45 : null;
        if (u != null) {
          const q = cartOn(u, 'B');
          // 道すじ: A から床を通って斜面を B まで（台車の中ほどの高さに点線）
          const nx = -s * 3.7, ny = -c * 3.7, back = OBJ.cart.hw + 1.5;
          items.push({ t: 'path', pts: [[xa + OBJ.cart.hw + 1, ground - 3.7], [xs - 3.7 * Math.tan(A / 2), ground - 3.7], [q.x - c * back + nx, q.y + s * back + ny]] });
          if (o.toTop) items.push({ t: 'vzero', x: q.x + 4, y: q.y - 10, anchor: 'start' });
          else items.push({ t: 'motion', role: 'B', x: q.x + nx, y: q.y + ny, ux: c, uy: -s, half: 5 });
        }
      }
      // 基準面の文字: 台車が斜面にあるとき（ひもで引く）は床の左端、それ以外は斜面の下端の手前
      // 基準面の文字: ひもで引く場面は床の左端の上、それ以外（道すじの点線が床の上を通る）は床の線の下
      if (o.pull) items.push({ t: 'ref', x1: 2, x2: xs, y: ground, label: '' }, { t: 'text', x: 2.5, y: ground - 1.2, s: '基準面', anchor: 'start', fs: 3.4, color: 'grey' });
      else items.push({ t: 'ref', x1: 2, x2: xs, y: ground, label: '' }, { t: 'text', x: xs - 0.5, y: ground + 4.8, s: '基準面', anchor: 'end', fs: 3.4, color: 'grey' });
      if (o.hlabel) items.push({ t: 'vdim', x: xt + 8, ex2: xs, y1: topY, y2: ground, label: o.hlabel, side: 1 });
      if (o.dlabel && o.rough) items.push({ t: 'hdim', x1: o.rough[0], x2: o.rough[1], y: ground, off: 11, label: o.dlabel, side: 1 });
      return { items };
    },
    slopeDown(o) {
      const items = [], ground = 32, topY = 8, xs = 10, xe = 32, xEnd = o.x2 || 80;   // 台の端 xs、斜面の下端 xe
      items.push({ t: 'floor', x1: 0, x2: xs, y: topY });
      items.push({ t: 'slope', x1: xs, y1: topY, x2: xe, y2: ground, rough: !!o.roughSlope });
      items.push({ t: 'floor', x1: xe, x2: xEnd, y: ground });
      if (o.rough) items.push({ t: 'rough', x1: o.rough[0], x2: o.rough[1], y: ground });
      if (o.roughSlope) items.push({ t: 'text', x: (xs + xe) / 2 + 3, y: (topY + ground) / 2 - 1, s: '粗い斜面', anchor: 'start' });
      const obj = o.obj || 'block', { hw, h } = OBJ[obj];
      items.push({ t: obj, x: 5, y: topY }, ptAt(5, topY - h, hw, 'A'));
      if (o.to != null) {
        items.push({ t: obj, x: o.to, y: ground }, ptAt(o.to, ground - h, hw, 'B'));
        // 道すじ: A から台・斜面・床に沿って B の手前まで（物体の中ほどの高さに点線）
        const yo = h / 2, k = yo * Math.tan(Math.atan2(ground - topY, xe - xs) / 2);
        items.push({ t: 'path', pts: [[5 + hw + 1, topY - yo], [xs + k, topY - yo], [xe + k, ground - yo], [o.to - hw - 1.6, ground - yo]] });
        if (o.stopB) items.push({ t: 'vzero', x: o.to + hw + 1.2, y: ground - h / 2 + 1.4, anchor: 'start' });
        else items.push({ t: 'motion', role: 'B', x: o.to, y: ground - yo, ux: 1, uy: 0, half: hw });
      }
      // 基準面の文字は左の空いている所（台の下）に
      items.push({ t: 'ref', x1: 0, x2: xEnd, y: ground, label: '' }, { t: 'text', x: 0.5, y: ground - 1.2, s: '基準面', anchor: 'start', fs: 3.4, color: 'grey' });
      // 高さ: 台の面から補助線を右へのばし、斜面の右で床まで両矢印
      if (o.hlabel) items.push({ t: 'vdim', x: xe + 4, ex: xs, y1: topY, y2: ground, label: o.hlabel, side: 1 });
      if (o.v0 != null) items.push({ t: 'vel', role: 'A', x1: 5, y1: topY - h - 3.2, x2: 13, y2: topY - h - 3.2, label: o.v0, lx: 9, ly: topY - h - 4.6 });
      if (o.dlabel && o.rough) items.push({ t: 'hdim', x1: o.rough[0], x2: o.rough[1], y: ground, off: 11, label: o.dlabel, side: 1 });
      return { items };
    },
    // 振り子: 支点から、A は持ち上げた位置、B はいちばん低い位置。A から B へ円弧の点線
    pendulum() {
      const items = [], px = 22, py = 2, Lr = 24, a = 50 * Math.PI / 180, r = 2.0;
      const ax = px - Lr * Math.sin(a), ay = py + Lr * Math.cos(a), bx = px, by = py + Lr;
      items.push({ t: 'floor', x1: px - 8, x2: px + 8, y: py, up: true });   // 天井（斜線は上）
      items.push({ t: 'slope', x1: px, y1: py, x2: ax, y2: ay }, { t: 'slope', x1: px, y1: py, x2: bx, y2: by - r });
      const arc = []; for (let k = 0; k <= 12; k++) { const t = a * (1 - k / 12) - 0.06; arc.push([px - (Lr + 3) * Math.sin(t), py + (Lr + 3) * Math.cos(t)]); }
      items.push({ t: 'path', pts: arc });
      items.push({ t: 'ball', x: ax, y: ay, r }, { t: 'pt', x: ax - r - 1, y: ay - r, s: 'A', role: 'A', anchor: 'end' });
      items.push({ t: 'ball', x: bx, y: by, r }, { t: 'pt', x: bx + r + 1.2, y: by - r, s: 'B', role: 'B', anchor: 'start' });
      items.push({ t: 'motion', role: 'B', x: bx, y: by, ux: 1, uy: 0, half: r });   // いちばん低い所では右へ動いている
      items.push({ t: 'ref', x1: px - 22, x2: px + 22, y: by + r, label: '基準面', below: true });
      return { items };
    },
  };

  /* ---------- 棒グラフの問題の場面（10 J 刻み、合計 100 J まで） ----------
   * 返り値: { sys, desc, titles:[はじめの場面の名前, 終わりの場面の名前], before:{K,Us,Ug}, after:{…}, work:{W,by}|null, hint, scene }
   * 「まえ」「あと」とは書かない（先生の指摘 2026-11-15）。場面の名前で問い、棒グラフの見出しも場面の名前にする。
   * 図の中の物体の名前（fromLabel/toLabel）も場面の名前（finalize で入れる）。 */
  const z = o => ({ K: o.K || 0, Us: o.Us || 0, Ug: o.Ug || 0 });
  const SCEN = {
    K: [
      r => { const a = r.step(0, 50, 10), w = r.step(10, 40, 10);
        return { sys: '台車', titles: ['押しはじめ', '押し終わり'], desc: 'なめらかな水平面上の台車を、手で押して速くした。',
          before: z({ K: a }), after: z({ K: a + w }), work: { W: w, by: '手が押す力' },
          hint: '水平面上なので、高さは変わらない。', scene: SC.flat({ from: 34, to: 74, push: '押す力', v0: a ? '' : null, moveB: true }) }; },
      r => { const a = r.step(30, 90, 10), w = r.step(10, a, 10), stop = w === a;
        return { sys: '物体', titles: ['粗い面に入るとき', stop ? '止まったとき' : '粗い面を出るとき'],
          desc: stop ? '水平面上をすべってきた物体が、粗い面に入り、摩擦力を受けて止まった。' : '水平面上をすべってきた物体が、粗い面を通りぬけるあいだ、摩擦力を受けて遅くなった。',
          before: z({ K: a }), after: z({ K: a - w }), work: { W: -w, by: '摩擦力' }, hint: '水平面上なので、高さは変わらない。',
          scene: SC.flat({ obj: 'block', from: 24, to: stop ? 58 : 82, rough: [27, 72], v0: '', moveB: !stop, stopB: stop }) }; },
    ],
    Us: [
      r => { const a = r.step(20, 80, 10);
        return { sys: '台車とばね', titles: ['放す直前', 'ばねから離れたとき'], desc: 'なめらかな水平面上で、ばねを押し縮めて台車を止めておき、静かに放した。台車はばねから離れて動いた。',
          before: z({ Us: a }), after: z({ K: a }), work: null, hint: 'ばねから離れたとき、ばねは自然の長さにもどっている。',
          scene: SC.flat({ spring: true, from: 20, to: 66, moveB: true }) }; },
      r => { const a = r.step(30, 90, 10), b = r.step(10, a - 10, 10);
        return { sys: '台車とばね', titles: ['ばねに触れる直前', 'ばねを縮めている途中'], desc: `なめらかな水平面上を走ってきた台車が、ばねを押し縮めはじめた。ばねを縮めている途中で、弾性力による位置エネルギーが ${b} J になった。`,
          before: z({ K: a }), after: z({ K: a - b, Us: b }), work: null, hint: '',   // 値は問題文にある（同じことを 2 度書かない）
          scene: SC.flat({ springRight: true, from: 14, to: 56, springTo: 56, v0: '', moveB: true }) }; },
      r => { const a = r.step(20, 90, 10);
        return { sys: '台車とばね', titles: ['ばねに触れる直前', 'いちばん縮んだとき'], desc: 'なめらかな水平面上を走ってきた台車が、ばねを押し縮め、いちばん縮んだところで一瞬止まった。',
          before: z({ K: a }), after: z({ Us: a }), work: null, hint: '',   // 「一瞬止まった」は問題文にある
          scene: SC.flat({ springRight: true, from: 14, to: 64, springTo: 64, v0: '', stopB: true }) }; },
      r => { const w = r.step(10, 60, 10);
        return { sys: 'ばね', titles: ['自然の長さのとき', '押し縮めたとき'], desc: '自然の長さのばねを、手でゆっくり押し縮めた。', before: z({}), after: z({ Us: w }), work: { W: w, by: '手が押す力' },
          hint: 'ゆっくり押したので、運動エネルギーは 0 のままである。', scene: SC.flat({ springRight: true, obj: 'block', from: 30, x2: 50, pushInto: '手が押す力', noLabel: true }) }; },
    ],
    Ug: [
      // 図は A を床、B を高いところに描くので、床の上から持ち上げる（はじめの重力は 0 J）
      r => { const w = r.step(10, 60, 10);
        return { sys: '物体と地球', titles: ['持ち上げる前', '持ち上げたとき'], desc: '床の上の物体を、手でゆっくり持ち上げた。床を基準面とする。', before: z({}), after: z({ Ug: w }), work: { W: w, by: '手が持ち上げる力' },
          hint: 'ゆっくり持ち上げたので、運動エネルギーは 0 のままである。', scene: SC.vert({ mode: 'lift', obj: 'block' }) }; },
      // 図は B を床に描くので、床まで下ろす（終わりの重力は 0 J）
      r => { const a = r.step(30, 90, 10);
        return { sys: '物体と地球', titles: ['下ろす前', '床に下ろしたとき'], desc: '持ち上げていた物体を、手で支えながらゆっくり床まで下ろした。床を基準面とする。', before: z({ Ug: a }), after: z({}), work: { W: -a, by: '手が支える力' },
          hint: 'ゆっくり下ろしたので、運動エネルギーは 0 のままである。', scene: SC.vert({ mode: 'lower', obj: 'block' }) }; },
    ],
    C: [
      r => { const a = r.step(30, 90, 10), full = r.f() < 0.5, b = full ? a : r.step(10, a - 10, 10);
        return { sys: '物体と地球', titles: ['放した瞬間', full ? '床に着く直前' : '落ちている途中'],
          desc: (full ? '物体を静かに放して落とした。' : `物体を静かに放して落とした。落ちている途中で、重力による位置エネルギーが ${a - b} J になった。`) + '床を基準面とし、空気抵抗は考えない。',
          before: z({ Ug: a }), after: z({ K: b, Ug: a - b }), work: null, hint: full ? '床に着く直前の高さは 0 である。' : '',
          scene: SC.vert({ mode: 'fall', mid: !full }) }; },
      r => { const a = r.step(30, 90, 10), top = r.f() < 0.5, b = top ? a : r.step(10, a - 10, 10);
        return { sys: 'ボールと地球', titles: ['投げた直後', top ? 'いちばん高いところ' : '上っている途中'],
          desc: (top ? 'ボールを真上に投げ上げた。' : `ボールを真上に投げ上げた。上っている途中で、重力による位置エネルギーが ${b} J になった。`) + '投げた位置を基準面とし、空気抵抗は考えない。',
          before: z({ K: a }), after: z({ K: a - b, Ug: b }), work: null, hint: top ? 'いちばん高いところで、ボールの速さは 0 になる。' : '',
          scene: SC.vert({ mode: 'up', mid: !top, v: '' }) }; },
      r => { const a = r.step(20, 70, 10), c = r.step(0, 30, 10);
        return { sys: '物体と地球', titles: [c ? 'すべりはじめ' : '放した瞬間', '水平面に着いたとき'],
          desc: (c ? 'なめらかな斜面の上で、物体に斜面に沿って下向きの速さを与えた。物体は斜面の下の水平面に着いた。' : 'なめらかな斜面の上で物体を静かに放した。物体は斜面をすべり下り、斜面の下の水平面に着いた。') + '水平面を基準面とする。',
          before: z({ K: c, Ug: a }), after: z({ K: a + c }), work: null, hint: '水平面に着いたときの高さは 0 である。',
          scene: SC.slope({ to: 70, v0: c ? '' : null }) }; },
      r => { const a = r.step(40, 90, 10), top = r.f() < 0.5, b = top ? a : r.step(10, a - 10, 10);
        return { sys: '台車とばねと地球', titles: ['放す直前', top ? 'いちばん高いところ' : '斜面を上っている途中'],
          desc: (top ? 'なめらかな水平面で、ばねを押し縮めて台車を放した。台車はなめらかな斜面を上り、いちばん高いところで一瞬止まった。' : `なめらかな水平面で、ばねを押し縮めて台車を放した。台車はなめらかな斜面を上り、上っている途中で重力による位置エネルギーが ${b} J になった。`) + '水平面を基準面とする。',
          before: z({ Us: a }), after: z({ K: a - b, Ug: b }), work: null, hint: '台車がばねから離れると、ばねは自然の長さにもどる。',
          scene: SC.slope({ up: true, spring: true, toTop: top, toMid: !top }) }; },
      r => { const a = r.step(20, 80, 10);
        return { sys: 'おもりと地球', titles: ['放した瞬間', 'いちばん低いところ'], desc: '振り子のおもりを、ひもを張ったまま持ち上げて静かに放した。いちばん低い位置を基準面とし、空気抵抗は考えない。',
          before: z({ Ug: a }), after: z({ K: a }), work: null, hint: 'いちばん低いところの高さは 0 である。ひもが引く力は運動の向きに垂直なので、仕事をしない。',
          scene: SC.pendulum() }; },
    ],
    F: [
      r => { const a = r.step(30, 90, 10), w = r.step(10, a, 10), stop = w === a;
        return { sys: '物体', titles: ['粗い面に入るとき', stop ? '止まったとき' : '粗い面を出るとき'],
          desc: stop ? '水平面上をすべってきた物体が、粗い面に入って止まった。' : '水平面上をすべってきた物体が、粗い面を通りぬけた。',
          before: z({ K: a }), after: z({ K: a - w }), work: { W: -w, by: '摩擦力' }, hint: '水平面上なので、高さは変わらない。',
          scene: SC.flat({ obj: 'block', from: 28, to: stop ? 58 : 82, rough: [31, 72], v0: '', moveB: !stop, stopB: stop }) }; },
      r => { const a = r.step(30, 90, 10), w = r.step(10, a, 10), stop = w === a;
        return { sys: '台車とばね', titles: ['放す直前', stop ? '止まったとき' : '粗い面を出るとき'],
          desc: stop ? 'ばねを押し縮めて台車を放した。台車はばねから離れ、粗い面に入って止まった。' : 'ばねを押し縮めて台車を放した。台車はばねから離れ、粗い面を通りぬけた。',
          before: z({ Us: a }), after: z({ K: a - w }), work: { W: -w, by: '摩擦力' }, hint: 'ばねから離れると、ばねは自然の長さにもどる。水平面上なので、高さは変わらない。',
          scene: SC.flat({ spring: true, from: 20, to: stop ? 62 : 86, rough: [40, 76], moveB: !stop, stopB: stop }) }; },
      r => { const a = r.step(40, 90, 10), w = r.step(10, a - 10, 10);
        return { sys: '物体と地球', titles: ['放した瞬間', '水平面に着いたとき'], desc: `粗い斜面の上で物体を静かに放した。物体は斜面をすべり下り、斜面の下の水平面に着いた。そのあいだに摩擦力がした仕事は ${MINUS}${w} J だった。水平面を基準面とする。`,
          before: z({ Ug: a }), after: z({ K: a - w }), work: { W: -w, by: '摩擦力' }, workInText: true, hint: '水平面に着いたときの高さは 0 である。',
          scene: SC.slope({ to: 60, roughSlope: true }) }; },
      r => { const c = r.step(10, 30, 10), a = r.step(0, 30, 10), w = r.step(10, Math.min(50, 100 - c - a), 10);
        return { sys: '台車と地球', titles: ['A 点を通るとき', 'B 点を通るとき'], desc: 'なめらかな斜面に沿って、ひもで台車を一定の速さで引き上げた。台車は A 点、B 点の順に通った。斜面の下を基準面とする。',
          before: z({ K: c, Ug: a }), after: z({ K: c, Ug: a + w }), work: { W: w, by: 'ひもが引く力' }, hint: '速さが一定なので、運動エネルギーは変わらない。',
          scene: SC.slope({ up: true, toMid: true, pull: 'ひもが引く力' }), figLabels: ['A', 'B'] }; },
    ],
  };
  // 図の A・B と場面の名前を、問題文の終わりで結びつける（図に A・B が両方あるときだけ。片方だけなら記号を消す）
  function finalize(sc) {
    sc = withSpeeds(sc);
    const roles = new Set(sc.scene.items.filter(it => it.t === 'pt').map(it => it.role));
    // 場面の名前はこの 1 文だけに書き、問い・棒グラフの見出しは「図A」「図B」で呼ぶ（先生の決定 2026-11-16）
    if (roles.has('A') && roles.has('B') && !sc.figLabels)
      // カッコは使わず、独立した文にする（先生の指摘 2026-11-16）
      return Object.assign({}, sc, { desc: `${sc.desc}図Aは${sc.titles[0]}、図Bは${sc.titles[1]}を表す。`, names: sc.titles, titles: ['図A', '図B'] });
    if (sc.figLabels) return sc;
    return Object.assign({}, sc, { scene: stripPts(sc.scene) });
  }
  const stripPts = s => s && Object.assign({}, s, { items: s.items.filter(it => it.t !== 'pt') });
  // 速いときは残像の線（≡）と速さの矢印を長く、遅いときは短く（先生の指摘 2026-11-16）。
  // 速さは運動エネルギーの平方根に比例するので、A と B のうち速いほうを 1 とした比 √(K / Kmax) を使う
  function withSpeeds(sc, kA, kB) {
    const K = { A: kA != null ? kA : sc.before.K, B: kB != null ? kB : sc.after.K }, Kmax = Math.max(K.A, K.B);
    if (!(Kmax > 0)) return sc;
    const spd = role => Math.sqrt(K[role] / Kmax);
    const items = sc.scene.items.map(it => {
      if (!it.role || !K.hasOwnProperty(it.role)) return it;
      if (it.t === 'motion') return Object.assign({}, it, { spd: spd(it.role) });
      if (it.t === 'vel' && !it.label) {   // 数値のない矢印だけ長さを変える（数値つきは問題の値を書いてあるので変えない）
        const f = 0.35 + 0.65 * spd(it.role);
        return Object.assign({}, it, { x2: it.x1 + (it.x2 - it.x1) * f, y2: it.y1 + (it.y2 - it.y1) * f });
      }
      return it;
    });
    return Object.assign({}, sc, { scene: Object.assign({}, sc.scene, { items }) });
  }
  const pickScen = (r, unit) => finalize(r.pick(SCEN[unit])(r));

  const NAMEJ = { K: '運動エネルギー', Us: '弾性力による位置エネルギー', Ug: '重力による位置エネルギー', sum: '力学的エネルギー' };
  // 問いの中の場面の呼び方: 「図A」はそのまま、場面の名前は「」でくくる
  const qn = t => /^図[AB]$/.test(t) ? t : `「${t}」`;
  const NAME1 = { K: '運動', Us: 'ばね', Ug: '重力' };   // 棒の名前
  const tot = s => s.K + s.Us + s.Ug;

  function chartOf(sc, overrides = {}) {
    const titles = sc.titles;   // 場面の名前（「まえ」「あと」は使わない）
    const max = Math.max(tot(sc.before), tot(sc.after), 40);
    return {
      states: [Object.assign({ title: titles[0] }, sc.before, overrides.b || {}), Object.assign({ title: titles[1] }, sc.after, overrides.a || {})],
      opt: { works: [sc.work ? Object.assign({ W: sc.work.W, text: workText(sc.work) }, overrides.w || {}) : null], ref: overrides.ref !== false, grid: !!overrides.grid, max: overrides.grid ? Math.ceil(max / 10) * 10 + 10 : undefined, values: overrides.values },
    };
  }
  const workText = w => w.W > 0 ? `${w.by}が\n仕事をした` : `${w.by}が\n負の仕事をした`;
  const workSentence = w => `${w.by}が物体に ${Jx(w.W)} の仕事をした`;
  function sysLine(sc) { return `系：${sc.sys}`; }

  function explainBalance(sc) {
    const b = tot(sc.before), a = tot(sc.after);
    if (!sc.work) return `系の外から仕事をされていないので、力学的エネルギーは ${Jx(b)} のままです。`;
    return `${workSentence(sc.work).replace('物体に', `${sc.sys.split('と')[0]}に`)}ので、力学的エネルギーは ${Jx(b)} → ${Jx(a)} と${sc.work.W > 0 ? '増え' : '減り'}ました。`;
  }

  /* ---------- 段 1: お金 ---------- */
  function genMoney(r) {
    const kind = r.pick(['in', 'out', 'move', 'move_in']);
    const w0 = r.step(100, 500, 100), b0 = r.step(0, 400, 100);
    let w1 = w0, b1 = b0, flow = 0, text, by = '', titles;
    if (kind === 'in') { flow = r.step(100, 400, 100); w1 = w0 + flow; text = `財布に ${w0} 円、貯金箱に ${b0} 円ある。おこづかいを ${flow} 円もらって財布に入れた。`; by = 'おこづかい'; titles = ['もらう前', 'もらったとき']; }
    if (kind === 'out') { flow = -r.step(100, w0, 100); w1 = w0 + flow; text = `財布に ${w0} 円、貯金箱に ${b0} 円ある。財布から ${-flow} 円のお菓子を買った。`; by = 'お菓子'; titles = ['買う前', '買ったとき']; }
    if (kind === 'move') { const m = r.step(100, w0, 100); w1 = w0 - m; b1 = b0 + m; text = `財布に ${w0} 円、貯金箱に ${b0} 円ある。財布から ${m} 円を貯金箱に移した。`; titles = ['移す前', '移したとき']; }
    if (kind === 'move_in') { flow = r.step(100, 300, 100); const m = r.step(100, w0 + flow, 100); w1 = w0 + flow - m; b1 = b0 + m; text = `財布に ${w0} 円、貯金箱に ${b0} 円ある。おこづかいを ${flow} 円もらって財布に入れ、続けて財布から ${m} 円を貯金箱に移した。`; by = 'おこづかい'; titles = ['もらう前', '移し終えたとき']; }
    const askT = r.pick(kind === 'move' ? ['wallet', 'bank', 'sum'] : ['wallet', 'sum', 'bank']);
    const ansV = askT === 'wallet' ? w1 : askT === 'bank' ? b1 : w1 + b1;
    const askName = `${titles[1]}の` + { wallet: '財布のお金', bank: '貯金箱のお金', sum: 'お金の合計' }[askT];
    const hideA = askT === 'sum' ? ['wallet', 'bank', 'sum'] : [askT, 'sum'];
    const max = Math.max(w0 + b0, w1 + b1);
    const works = [flow ? { W: flow, text: flow > 0 ? `${by}を\nもらった` : `${by}に\n使った` } : null];
    // お金の棒は名前（貯金箱）と数（300 円）が長いので、棒を太く・間を広く
    const opt = { kind: 'money', unit: 100, mmPerUnit: 3.2, works, ref: true, max, barW: 11, barGap: 6 };
    const exp = [];
    if (kind === 'move' || kind === 'move_in') exp.push('財布から貯金箱へ移しても、自分のお金の合計は変わりません。');
    if (flow > 0) exp.push(`外から ${flow} 円が入ったので、合計は ${w0 + b0} 円 → ${w1 + b1} 円と増えました。`);
    if (flow < 0) exp.push(`外へ ${-flow} 円が出ていったので、合計は ${w0 + b0} 円 → ${w1 + b1} 円と減りました。`);
    if (!flow) exp.push(`外とのお金の出入りがないので、合計は ${w0 + b0} 円のままです。`);
    return {
      unit: null, sys: '財布と貯金箱', text, ask: `${askName}はいくらか。`,
      chart: { states: [{ title: titles[0], wallet: w0, bank: b0 }, { title: titles[1], wallet: w1, bank: b1, hide: hideA }], opt },
      answer: { kind: 'num', value: ansV, tol: 0, unit: '円' },
      explain: exp,
      explainChart: { states: [{ title: titles[0], wallet: w0, bank: b0 }, { title: titles[1], wallet: w1, bank: b1, answer: [askT] }], opt },
      variant: kind,
    };
  }

  /* ---------- 段 2: 棒グラフを読む ---------- */
  function genRead(r, unit) {
    const sc = pickScen(r, unit);
    const cands = [];
    ['K', 'Us', 'Ug'].forEach(k => { if (sc.after[k]) cands.push({ st: 'a', k }); });
    ['K', 'Us', 'Ug'].forEach(k => { if (sc.before[k] && (sc.work || cands.length)) cands.push({ st: 'b', k }); });
    cands.push({ st: 'a', k: 'sum' });
    // 問題文に仕事の値が書いてある場面では、仕事を問わない（読めば答えが書いてある）
    if (sc.work && !sc.workInText) cands.push({ st: 'w' }, { st: 'w' });
    const t = r.pick(cands);
    const ch = chartOf(sc);
    let ask, value, hideNote = '';
    if (t.st === 'w') {
      ch.opt.works[0].hide = true; ch.opt.works[0].text = sc.work.W > 0 ? `${sc.work.by}が\nした仕事` : `${sc.work.by}が\nした仕事`;
      ask = `${sc.work.by}が${sc.sys.split('と')[0]}にした仕事は何 J か。`; value = sc.work.W;   // 「だれが」「だれに」を書く
      hideNote = '仕事が負のときは − をつけて答えよ。';   // 正のときも書く（負のときだけ書くと答えの符号が分かってしまう）
    } else {
      const which = t.st === 'a' ? 1 : 0;
      ch.states[which].hide = t.k === 'sum' ? ['K', 'Us', 'Ug', 'sum'] : [t.k, 'sum'];
      if (which === 0) ch.opt.ref = false;
      // 合計の棒は力学的エネルギー（摩擦のある場面で「エネルギーの合計が減る」と書かない）
      ask = `${sc.titles[which]}の${t.k === 'sum' ? '力学的エネルギー' : NAMEJ[t.k]}は何 J か。`;
      value = t.k === 'sum' ? tot(t.st === 'a' ? sc.after : sc.before) : (t.st === 'a' ? sc.after : sc.before)[t.k];
    }
    const ex = chartOf(sc);
    if (t.st === 'w') ex.opt.works[0].answer = true;
    else ex.states[t.st === 'a' ? 1 : 0].answer = [t.k];
    const e = [explainBalance(sc)];
    if (t.st !== 'w' && t.k !== 'sum') {
      // 引き算を数で見せる（「ほかの棒を引くと」だけでは、どの棒を引いたか追えない）
      const which = t.st === 'a' ? 1 : 0, s = which ? sc.after : sc.before, others = ['K', 'Us', 'Ug'].filter(k => k !== t.k && s[k]);
      e.push(others.length
        ? `${sc.titles[which]}の力学的エネルギー ${Jx(tot(s))} から${others.map(k => `${NAME1[k]} ${Jx(s[k])}`).join(' と')} を引くと、${NAMEJ[t.k]}は ${Jx(value)} です。`
        : `${sc.titles[which]}はほかの棒が 0 J なので、${NAMEJ[t.k]}は力学的エネルギーと同じ ${Jx(value)} です。`);
    }
    // 場面の図も必ず入れる（先生の指摘: 図があると読む負担が減る）
    return { unit, sys: sc.sys, text: sc.desc, ask: ask + hideNote, chart: ch, scene: sc.scene, answer: { kind: 'num', value, tol: 0, unit: 'J' }, explain: e, explainChart: ex };
  }

  /* ---------- 段 3: 棒グラフをかく ---------- */
  function genDraw(r, unit) {
    const sc = pickScen(r, unit);
    const ch = chartOf(sc, { grid: true });
    ch.states[1].blank = true;
    const ex = chartOf(sc, { grid: true });
    ex.states[1].answer = true;
    return {
      unit, sys: sc.sys, text: `${sc.desc}${sc.hint || ''}`, ask: `${qn(sc.titles[1])}の棒を指で動かして、棒グラフをかけ。1 目盛りは 10 J である。`,
      chart: ch, scene: sc.scene, answer: { kind: 'draw', target: { K: sc.after.K, Us: sc.after.Us, Ug: sc.after.Ug } },
      explain: [explainBalance(sc), `${sc.titles[1]}の棒は、運動 ${Jx(sc.after.K)}、ばね ${Jx(sc.after.Us)}、重力 ${Jx(sc.after.Ug)} です。`], explainChart: ex,
    };
  }

  /* ---------- 段 4: 場面から選ぶ ---------- */
  // 場面から選ぶ: 棒グラフには数値を出す。誤りの選択肢は誤りが 1 つだけで、数値を見れば分かるもの。
  // 解説は「どこが」「なぜ」違うかを数値で書く（先生の指摘 2026-11-16: B がなぜ違うのか分からない）
  function genChoose(r, unit) {
    const sc = pickScen(r, unit);
    const base = () => chartOf(sc);
    const t1 = sc.titles[1], B0 = tot(sc.before), A1 = tot(sc.after), obj = sc.sys.split('と')[0];
    const opts = [{ c: base(), why: `正解。${explainBalance(sc)}` }];
    const ds = [];
    if (sc.work) {
      const { by, W } = sc.work;
      // (1) 仕事の矢印がない（棒は正しい）→ 矢印がないのに合計が変わっている
      const c = base(); c.opt.works = [null];
      ds.push({ c, mis: '外からの仕事を矢印で表さない（力学的エネルギーが変わる理由を考えない）', why: `仕事の矢印がないのに、力学的エネルギーが ${Jx(B0)} → ${Jx(A1)} と変わっています。${by}が${obj}に ${Jx(W)} の仕事をしているので、矢印が要ります。` });
      // (2) 仕事の向きが逆（棒も、その向きに合わせて計算してある）
      const w2 = -W, after2 = Object.assign({}, sc.after);
      const key = ['K', 'Us', 'Ug'].find(k => sc.after[k] - sc.before[k] !== 0) || 'K';
      after2[key] = sc.after[key] - 2 * W;
      if (after2[key] >= 0)
        ds.push({ c: chartOf({ ...sc, after: after2, work: { W: w2, by } }), mis: '仕事の正負（力の向きと動く向きの関係）を取り違える', why: `仕事の向きが逆です。${by}は${obj}の動く向きと${W > 0 ? '同じ向き' : '逆向き'}にはたらくので、仕事は${W > 0 ? '正で、系に入る下向きの矢印になります。' : '負で、系から出る上向きの矢印になります。'}力学的エネルギーは ${Jx(B0)} → ${Jx(A1)} と${W > 0 ? '増え' : '減り'}ます。` });
    } else {
      // (3) 系の中の力の仕事を、外から入る矢印として足してしまう
      const who = /地球/.test(sc.sys) ? '重力' : /ばね/.test(sc.sys) ? 'ばねの力' : null;
      if (who) {
        const gain = r.step(10, 30, 10), after3 = Object.assign({}, sc.after); after3.K += gain;
        ds.push({ c: chartOf({ ...sc, after: after3, work: { W: gain, by: who } }), mis: '系の中の力（重力・弾性力）の仕事を、外からの仕事として二重に数える', why: `「${who}が仕事をした」矢印があり、力学的エネルギーが ${Jx(B0)} → ${Jx(A1 + gain)} に増えています。${/地球/.test(sc.sys) ? '地球' : 'ばね'}も系に入れているので、${who}の仕事は系の中のやりとりで、${who === '重力' ? '重力による位置エネルギー' : '弾性力による位置エネルギー'}の変化としてすでに数えています。力学的エネルギーは ${Jx(B0)} のままです。` });
      }
      // (4) 仕事がないのに合計が減る
      const k = ['K', 'Us', 'Ug'].find(k2 => sc.after[k2] >= 20) || ['K', 'Us', 'Ug'].find(k2 => sc.after[k2] >= 10);
      if (k) {
        const d = Math.min(sc.after[k], r.step(10, 20, 10)), after4 = Object.assign({}, sc.after); after4[k] -= d;
        ds.push({ c: chartOf({ ...sc, after: after4 }), mis: '動くとエネルギーが自然に減っていくと考える', why: `系の外から仕事をされていないのに、力学的エネルギーが ${Jx(B0)} → ${Jx(A1 - d)} に減っています。仕事の出入りがなければ、力学的エネルギーは ${Jx(B0)} のまま変わりません。` });
      }
    }
    // (5) 合計は正しいが、分け方がちがう（エネルギーを別の棒に入れている）
    const moved = ['K', 'Us', 'Ug'].filter(k => sc.after[k] > 0);
    if (moved.length) {
      // 移す先は、その系にある棒だけ（ばねのない系に弾性力の位置エネルギーを入れない）
      const has = k => k === 'K' || (k === 'Us' && /ばね/.test(sc.sys)) || (k === 'Ug' && /地球/.test(sc.sys));
      const from = r.pick(moved), cand = ['K', 'Us', 'Ug'].filter(k => k !== from && has(k)), to = cand.length ? r.pick(cand) : null;
      if (to) {
        const after5 = Object.assign({}, sc.after); after5[to] += after5[from]; after5[from] = 0;
        const reason = `正しくは、${t1}の${NAMEJ[from]}は ${Jx(sc.after[from])}、${NAMEJ[to]}は ${Jx(sc.after[to])} です。` + (sc.hint ? sc.hint.replace(/。?$/, '。') : '');
        ds.push({ c: chartOf({ ...sc, after: after5 }), mis: 'エネルギーの種類の振り分けを誤る（速さ・高さ・ばねの縮みと結びつけない）', why: `力学的エネルギーは合っていますが、${t1}の${NAMEJ[from]}が 0 J、${NAMEJ[to]}が ${Jx(after5[to])} になっています。${reason}` });
      }
    }
    const picked = r.shuffle(ds).slice(0, 2);
    while (picked.length < 2) {   // 足りないときは合計を増やした図
      const add = 10 * (picked.length + 1), after6 = Object.assign({}, sc.after); after6.K += add;
      picked.push({ c: chartOf({ ...sc, after: after6 }), mis: '力学的エネルギーの変化を仕事と結びつけない', why: `力学的エネルギーが ${Jx(B0)} → ${Jx(A1 + add)} になっていますが、${sc.work ? `仕事は ${Jx(sc.work.W)} なので ${Jx(A1)}` : `仕事の出入りがないので ${Jx(B0)} のまま`}のはずです。` });
    }
    const all = r.shuffle([opts[0], ...picked]);
    // 3 つの棒グラフを同じ幅・同じ文字の大きさにそろえる。矢印のない選択肢にも、境の線と同じ幅の空きを置く
    const texts = all.map(o => o.c.opt.works[0] && o.c.opt.works[0].text).filter(Boolean);
    if (texts.length) {
      const longest = texts.reduce((a, b) => (b.length > a.length ? b : a));
      all.forEach(o => { o.c.opt.gapText = longest; if (!o.c.opt.works[0]) o.c.opt.works = [{ blank: true }]; });
    }
    return {
      unit, sys: sc.sys, text: sc.desc, ask: `${qn(sc.titles[0])}と${qn(sc.titles[1])}の棒グラフとして正しいものを選べ。`,
      chart: null, scene: sc.scene,
      answer: { kind: 'choice', choices: all.map(o => o.c), correct: all.indexOf(opts[0]), why: all.map(o => o.why), mis: all.map(o => o.mis || null) },
      explain: [explainBalance(sc)], explainChart: chartOf(sc),
    };
  }

  /* ---------- 段 5: 計算 ---------- */
  const eChart = (b0, a0, w, titles) => {
    const rs = o => ({ K: r3(o.K || 0), Us: r3(o.Us || 0), Ug: r3(o.Ug || 0) });
    const b = rs(b0), a = rs(a0);   // 足りない棒を 0 で埋めてから（埋めないと合計が NaN になり、目盛りが既定の 10 J に落ちていた）
    const vals = [tot(b), tot(a), ...Object.values(b), ...Object.values(a)];
    const u = niceUnit(Math.max(...vals));
    return { states: [Object.assign({ title: titles[0] }, b), Object.assign({ title: titles[1] }, a, { answer: ['K', 'Us', 'Ug'].filter(k => a[k]).concat('sum') })],
      opt: { unit: u, mmPerUnit: 28 / (Math.max(...vals) / u), works: [w ? { W: r3(w.W), text: workText(w) } : null], ref: true, values: true, fmt: 'sig2' } };
  };
  const CALC = {
    K: [
      // 仕事 → 速さ
      r => { const m = r.pick([0.5, 1.0, 2.0, 4.0]), v0 = r.pick([0, 1.0, 2.0, 3.0]), v = r.pick([2, 3, 4, 5, 6].filter(x => x > v0)), W = 0.5 * m * (v * v - v0 * v0);
        // 速さ 0 のときは「動いている」「運動の向き」と書かない
        const start = v0 ? `なめらかな水平面上を速さ ${fv(v0)} m/s で動いている質量 ${fv(m)} kg の台車を、運動の向きに押した。` : `なめらかな水平面上で静止している質量 ${fv(m)} kg の台車を、水平に押した。`;
        return { sys: '台車', text: `${start}押す力が台車にした仕事は ${fv(W)} J だった。`, ask: '押し終えたときの台車の速さは何 m/s か。',
          value: v, unit: 'm/s', scene: SC.flat({ from: 34, to: 74, push: '押す力', v0: v0 ? `${fv(v0)} m/s` : null, v: '?', moveB: true }),
          explain: [v0 ? `押しはじめの運動エネルギー ½ × ${fv(m)} × ${fv(v0)}² = ${J(0.5 * m * v0 * v0)}` : '押しはじめは静止しているので、運動エネルギーは 0 J', `押す力の仕事 +${J(W)} を足して、押し終わりの運動エネルギーは ${J(0.5 * m * v * v)}`, `½ × ${fv(m)} × v² = ${f2(0.5 * m * v * v)} より v = ${f2(v)} m/s`],
          ec: eChart({ K: 0.5 * m * v0 * v0 }, { K: 0.5 * m * v * v }, { W, by: '押す力' }, ['押しはじめ', '押し終わり']) }; },
      // 速さの変化 → 仕事
      r => { const m = r.pick([1.0, 2.0, 4.0, 5.0]), v0 = r.pick([2, 3, 4]), v = r.pick([4, 5, 6, 8].filter(x => x > v0)), W = 0.5 * m * (v * v - v0 * v0);
        return { sys: '物体', text: `なめらかな水平面上を速さ ${fv(v0)} m/s で動いている質量 ${fv(m)} kg の物体に、運動の向きに力を加え続けたところ、速さが ${fv(v)} m/s になった。`, ask: 'この力が物体にした仕事は何 J か。',
          value: W, unit: 'J', scene: SC.flat({ obj: 'block', from: 30, to: 72, push: '力', v0: `${fv(v0)} m/s`, v: `${fv(v)} m/s`, moveB: true }),
          explain: [`はじめ ½ × ${fv(m)} × ${fv(v0)}² = ${J(0.5 * m * v0 * v0)}、${fv(v)} m/s になったとき ½ × ${fv(m)} × ${fv(v)}² = ${J(0.5 * m * v * v)}`, `運動エネルギーの増えたぶんが仕事なので ${J(W)}`],
          ec: eChart({ K: 0.5 * m * v0 * v0 }, { K: 0.5 * m * v * v }, { W, by: '力' }, [`${fv(v0)} m/s のとき`, `${fv(v)} m/s のとき`]) }; },
      // ブレーキ → 距離
      // 摩擦力は重さの 0.5〜0.8 倍ほど（実際の急ブレーキに近い値）。F = m × k、d = v² ÷ 2k
      r => { const m = r.pick([1000, 1200, 1500, 2000]), v = r.pick([10, 20]), k = r.pick([5, 8]), F = m * k, d = 0.5 * m * v * v / F;
        return { sys: '自動車', text: `質量 ${m} kg の自動車が速さ ${v} m/s で走っていたところ、ブレーキをかけてタイヤがすべり、止まった。路面から受ける摩擦力の大きさは ${Math.round(F)} N で一定だった。`, ask: 'ブレーキをかけてから止まるまでにすべった距離は何 m か。',
          value: d, unit: 'm', scene: SC.flat({ obj: 'cart', from: 18, to: 76, rough: [24, 78], v0: `${v} m/s`, stopB: true }),
          explain: [`ブレーキをかけたときの運動エネルギー ½ × ${m} × ${v}² = ${J(0.5 * m * v * v)}`, `摩擦力の仕事 −${Math.round(F)} × d が、これをすべて 0 にする`, `${Math.round(F)} × d = ${f2(0.5 * m * v * v)} より d = ${f2(d)} m`],
          ec: eChart({ K: 0.5 * m * v * v }, { K: 0 }, { W: -0.5 * m * v * v, by: '摩擦力' }, ['ブレーキをかけたとき', '止まったとき']) }; },
    ],
    Us: [
      r => { const k = r.pick([20, 40, 50, 80, 100, 200, 400]), x = r.pick([0.05, 0.10, 0.20, 0.30].filter(xx => 0.5 * k * xx * xx <= 20)), E = 0.5 * k * x * x;
        return { sys: 'ばね', text: `ばね定数 ${k} N/m のばねを、自然の長さから ${fv(x, 2)} m 縮めた。`, ask: 'ばねにたくわえられた弾性力による位置エネルギーは何 J か。',
          value: E, unit: 'J', scene: SC.flat({ springRight: true, obj: 'block', from: 30, x2: 50, pushInto: '押す力', noLabel: true }), explain: [`½kx² = ½ × ${k} × ${fv(x, 2)}² = ${J(E)}`], ec: eChart({}, { Us: E }, { W: E, by: '押す力' }, ['自然の長さのとき', '縮めたとき']) }; },
      r => { const m = r.pick([0.25, 0.5, 1.0, 2.0]), rr = r.pick([4, 5, 6, 8, 10, 12, 14, 20]), k = m * rr * rr; if (k < 20 || k > 400) return null;
        const x = r.pick([0.05, 0.10, 0.15, 0.20, 0.25]), v = rr * x, E = 0.5 * k * x * x;
        return { sys: '台車とばね', text: `なめらかな水平面上で、ばね定数 ${fv(k)} N/m のばねを ${fv(x, 2)} m 縮め、質量 ${fv(m)} kg の台車を押しあてて静かに放した。`, ask: 'ばねから離れたときの台車の速さは何 m/s か。',
          value: v, unit: 'm/s', scene: SC.flat({ spring: true, from: 20, to: 66, v: '?', moveB: true }),
          explain: [`弾性力による位置エネルギー ½ × ${fv(k)} × ${fv(x, 2)}² = ${J(E)} がすべて運動エネルギーになる`, `½ × ${fv(m)} × v² = ${f2(E)} より v = ${f2(v)} m/s`],
          ec: eChart({ Us: E }, { K: E }, null, ['放す直前', 'ばねから離れたとき']) }; },
      r => { const m = r.pick([0.5, 1.0, 2.0]), rr = r.pick([5, 10, 20]), k = m * rr * rr; if (k < 20 || k > 400) return null;
        const v = r.pick([0.5, 1.0, 1.5, 2.0]), x = v / rr, E = 0.5 * m * v * v;
        return { sys: '台車とばね', text: `なめらかな水平面上を速さ ${fv(v)} m/s で走ってきた質量 ${fv(m)} kg の台車が、ばね定数 ${fv(k)} N/m のばねにぶつかり、ばねを押し縮めた。`, ask: 'ばねはいちばん縮んだとき、自然の長さから何 m 縮んでいるか。',
          value: x, unit: 'm', scene: SC.flat({ springRight: true, from: 14, to: 64, springTo: 64, v0: `${fv(v)} m/s`, stopB: true }),
          explain: [`運動エネルギー ½ × ${fv(m)} × ${fv(v)}² = ${J(E)} がすべて弾性力による位置エネルギーになる`, `½ × ${fv(k)} × x² = ${f2(E)} より x = ${f2(x)} m`],
          ec: eChart({ K: E }, { Us: E }, null, ['ぶつかる前', 'いちばん縮んだとき']) }; },
    ],
    Ug: [
      r => { const m = r.pick([0.5, 1.0, 2.0, 5.0, 10]), h = r.pick([0.5, 1.0, 1.5, 2.0, 3.0, 5.0]), E = m * G * h;
        return { sys: '物体と地球', text: `質量 ${fv(m)} kg の物体が、床から高さ ${fv(h)} m の棚の上にある。重力加速度の大きさを 9.8 m/s² とし、床を基準面とする。`, ask: '物体の重力による位置エネルギーは何 J か。',
          value: E, unit: 'J', scene: SC.vert({ mode: 'shelf', obj: 'block', hlabel: `${fv(h)} m` }), explain: [`mgh = ${fv(m)} × 9.8 × ${fv(h)} = ${J(E)}`], ec: null }; },
      r => { const m = r.pick([1.0, 2.0, 5.0]), H = r.pick([1.5, 1.8, 2.0]), d = r.pick([0.7, 0.8, 1.0]), h = r3(H - d), E = m * G * h;
        return { sys: '物体と地球', text: `質量 ${fv(m)} kg の物体が、床から高さ ${fv(H)} m の棚の上にある。床から高さ ${fv(d)} m の机の面を基準面とし、重力加速度の大きさを 9.8 m/s² とする。`, ask: '物体の重力による位置エネルギーは何 J か。',
          value: E, unit: 'J', scene: SC.vert({ mode: 'shelf', obj: 'block', hlabel: `${fv(H)} m`, desk: d, deskLabel: `机の面（基準面）`, H }), explain: [`基準面からの高さは ${fv(H)} − ${fv(d)} = ${fv(h)} m`, `mgh = ${fv(m)} × 9.8 × ${fv(h)} = ${J(E)}`], ec: null }; },
      r => { const m = r.pick([2.0, 5.0, 10, 20]), h = r.pick([0.5, 1.0, 1.5, 2.0]), W = m * G * h;
        return { sys: '物体と地球', text: `床の上の質量 ${fv(m)} kg の物体を、手でゆっくり高さ ${fv(h)} m まで持ち上げた。重力加速度の大きさを 9.8 m/s² とする。`, ask: '手が持ち上げる力が物体にした仕事は何 J か。',
          value: W, unit: 'J', scene: SC.vert({ mode: 'lift', obj: 'block', hlabel: `${fv(h)} m` }),
          explain: ['ゆっくり持ち上げたので運動エネルギーは 0 のまま', `手が持ち上げる力の仕事が、重力による位置エネルギーの増加 mgh = ${fv(m)} × 9.8 × ${fv(h)} = ${J(W)} になる`],
          ec: eChart({}, { Ug: W }, { W, by: '手が持ち上げる力' }, ['持ち上げる前', '持ち上げたとき']) }; },
    ],
    C: [
      r => { const n = r.int(3, 20), h = r3(0.1 * n * n), v = r3(1.4 * n), m = r.pick([0.5, 1.0, 2.0]), E = m * G * h;
        return { sys: '物体と地球', text: `質量 ${fv(m)} kg の物体を、床から高さ ${fv(h)} m のところで静かに放した。重力加速度の大きさを 9.8 m/s² とし、空気抵抗は考えない。`, ask: '床に着く直前の速さは何 m/s か。',
          value: v, unit: 'm/s', scene: SC.vert({ mode: 'fall', hlabel: `${fv(h)} m`, v: '?' }),
          explain: [`重力による位置エネルギー mgh = ${f2(E)} J がすべて運動エネルギーになる`, `½ × ${fv(m)} × v² = ${f2(E)} より v² = ${f2(2 * G * h)}、v = ${f2(v)} m/s`],
          ec: eChart({ Ug: E }, { K: E }, null, ['放した瞬間', '床に着く直前']) }; },
      r => { const n = r.int(3, 15), h = r3(0.1 * n * n), v = r3(1.4 * n), m = r.pick([0.2, 0.5, 1.0]), E = 0.5 * m * v * v;
        return { sys: 'ボールと地球', text: `質量 ${fv(m)} kg のボールを、速さ ${fv(v)} m/s で真上に投げ上げた。重力加速度の大きさを 9.8 m/s² とし、空気抵抗は考えない。`, ask: '投げた位置から何 m の高さまで上がるか。',
          value: h, unit: 'm', scene: SC.vert({ mode: 'up', v: `${fv(v)} m/s`, hlabel: '?' }),
          explain: [`運動エネルギー ½ × ${fv(m)} × ${fv(v)}² = ${f2(E)} J がすべて重力による位置エネルギーになる`, `${fv(m)} × 9.8 × h = ${f2(E)} より h = ${f2(h)} m`],
          ec: eChart({ K: E }, { Ug: E }, null, ['投げた直後', 'いちばん高いところ']) }; },
      r => { const k0 = r.int(0, 4), n = r.int(k0 + 3, 12), v0 = r3(1.4 * k0), v = r3(1.4 * n), h = r3(0.1 * (n * n - k0 * k0)), m = r.pick([1.0, 2.0, 3.0]);
        return { sys: '物体と地球', text: k0 ? `高さ ${fv(h)} m のなめらかな斜面の上で、質量 ${fv(m)} kg の物体に斜面に沿って下向きに速さ ${fv(v0)} m/s を与えた。重力加速度の大きさを 9.8 m/s² とする。` : `高さ ${fv(h)} m のなめらかな斜面の上で、質量 ${fv(m)} kg の物体を静かに放した。重力加速度の大きさを 9.8 m/s² とする。`, ask: '斜面の下の水平面に着いたときの速さは何 m/s か。',
          value: v, unit: 'm/s', scene: SC.slope({ to: 70, hlabel: `${fv(h)} m`, v0: k0 ? `${fv(v0)} m/s` : null }),
          explain: [`斜面の上: 運動 ${J(0.5 * m * v0 * v0)}、重力 ${fv(m)} × 9.8 × ${fv(h)} = ${J(m * G * h)}`, `水平面では重力 0 なので、運動エネルギー = ${J(0.5 * m * v * v)}`, `½ × ${fv(m)} × v² = ${f2(0.5 * m * v * v)} より v = ${f2(v)} m/s`],
          ec: eChart({ K: 0.5 * m * v0 * v0, Ug: m * G * h }, { K: 0.5 * m * v * v }, null, [k0 ? 'すべりはじめ' : '放した瞬間', '水平面に着いたとき']) }; },
      r => { const k = r.pick([100, 200, 400]), x = r.pick([0.10, 0.20]), m = r.pick([0.5, 1.0, 2.0]), E = 0.5 * k * x * x, h = E / (m * G);
        if (h < 0.05) return null;
        return { sys: '台車とばねと地球', text: `なめらかな水平面上で、ばね定数 ${k} N/m のばねを ${fv(x, 2)} m 縮め、質量 ${fv(m)} kg の台車を押しあてて静かに放した。台車はなめらかな斜面を上った。重力加速度の大きさを 9.8 m/s² とする。`, ask: '台車は水平面から何 m の高さまで上がるか。',
          value: h, unit: 'm', scene: SC.slope({ up: true, spring: true, toTop: true, hlabel: '?' }),
          explain: [`弾性力による位置エネルギー ½ × ${k} × ${fv(x, 2)}² = ${J(E)}`, `いちばん高いところでは速さが 0 になるので、これがすべて重力による位置エネルギーになる`, `${fv(m)} × 9.8 × h = ${f2(E)} より h = ${f2(h)} m`],
          ec: eChart({ Us: E }, { Ug: E }, null, ['放す直前', 'いちばん高いところ']) }; },
    ],
    F: [
      r => { const m = r.pick([1.0, 2.0, 4.0]), v = r.pick([2, 3, 4, 5, 6]), F = r.pick([1, 2, 4, 5]), E = 0.5 * m * v * v, d = E / F;
        return { sys: '物体', text: `水平面上を速さ ${fv(v)} m/s ですべってきた質量 ${fv(m)} kg の物体が、粗い面に入って止まった。粗い面から受ける摩擦力の大きさは ${fv(F)} N で一定だった。`, ask: '粗い面に入ってから止まるまでにすべった距離は何 m か。',
          value: d, unit: 'm', scene: SC.flat({ obj: 'block', from: 16, to: 64, rough: [28, 82], v0: `${fv(v)} m/s`, stopB: true }),
          explain: [`運動エネルギー ½ × ${fv(m)} × ${fv(v)}² = ${J(E)}`, `摩擦力の仕事 −${fv(F)} × d で、これがすべて 0 になる`, `${fv(F)} × d = ${f2(E)} より d = ${f2(d)} m`],
          ec: eChart({ K: E }, { K: 0 }, { W: -E, by: '摩擦力' }, ['粗い面に入るとき', '止まったとき']) }; },
      r => { const m = r.pick([1.0, 2.0, 5.0]), v = r.pick([2, 4, 6]), d = r.pick([2.0, 4.0, 5.0, 8.0]), E = 0.5 * m * v * v, F = E / d;
        return { sys: '物体', text: `水平面上を速さ ${fv(v)} m/s ですべってきた質量 ${fv(m)} kg の物体が、粗い面に入り、${fv(d)} m すべって止まった。粗い面から受ける摩擦力の大きさは一定とする。`, ask: '物体が粗い面から受けた摩擦力の大きさは何 N か。',
          value: F, unit: 'N', scene: SC.flat({ obj: 'block', from: 16, to: 66, rough: [28, 70], v0: `${fv(v)} m/s`, dlabel: `${fv(d)} m`, stopB: true }),
          explain: [`運動エネルギー ½ × ${fv(m)} × ${fv(v)}² = ${J(E)}`, `摩擦力の仕事 −F × ${fv(d)} がこれを 0 にする`, `F × ${fv(d)} = ${f2(E)} より F = ${f2(F)} N`],
          ec: eChart({ K: E }, { K: 0 }, { W: -E, by: '摩擦力' }, ['粗い面に入るとき', '止まったとき']) }; },
      r => { const m = r.pick([1.0, 2.0]), h = r.pick([0.5, 1.0, 2.0]), F = r.pick([2.0, 4.9, 9.8]), E = m * G * h, d = E / F;
        return { sys: '物体と地球', text: `高さ ${fv(h)} m のなめらかな斜面の上で、質量 ${fv(m)} kg の物体を静かに放した。物体は斜面をすべり下り、水平な粗い面に入って止まった。粗い面から受ける摩擦力の大きさは ${fv(F)} N で一定だった。重力加速度の大きさを 9.8 m/s² とする。`, ask: '粗い面に入ってから止まるまでにすべった距離は何 m か。',
          value: d, unit: 'm', scene: SC.slope({ to: 74, rough: [50, 92], hlabel: `${fv(h)} m`, stopB: true }),
          explain: [`はじめの重力による位置エネルギー ${fv(m)} × 9.8 × ${fv(h)} = ${J(E)}`, `斜面の下で運動エネルギー ${J(E)}。摩擦力の仕事 −${fv(F)} × d がこれを 0 にする`, `${fv(F)} × d = ${f2(E)} より d = ${f2(d)} m`],
          ec: eChart({ Ug: E }, { K: 0 }, { W: -E, by: '摩擦力' }, ['放した瞬間', '止まったとき']) }; },
      r => { const F = r.pick([2.0, 3.0, 5.0, 10]), d = r.pick([1.5, 2.0, 4.0, 6.0]), W = -F * d, m = r.pick([1.0, 2.0]);
        return { sys: '物体', text: `粗い水平面上をすべる質量 ${fv(m)} kg の物体が、${fv(d)} m すべるあいだ、大きさ ${fv(F)} N の摩擦力を受け続けた。`, ask: 'このあいだに摩擦力が物体にした仕事は何 J か。仕事が負のときは − をつけて答えよ。',
          value: W, unit: 'J', scene: SC.flat({ obj: 'block', from: 20, to: 70, rough: [12, 84], dlabel: `${fv(d)} m` }),
          explain: ['摩擦力は運動と逆向きなので、仕事は負', `W = −${fv(F)} × ${fv(d)} = ${J(W)}`], ec: null }; },
    ],
  };

  function genCalc(r, unit) {
    let c = null, tries = 0;
    while (!c && tries++ < 20) c = r.pick(CALC[unit])(r);
    // 計算の問題は文で場面を書くので、図の A・B は使わない
    return { unit, sys: c.sys, text: c.text, ask: c.ask, chart: null, scene: stripPts(c.scene),
      answer: { kind: 'num', value: c.value, tol: 0.03, unit: c.unit, show: f2(c.value) },
      explain: c.explain, explainChart: c.ec };
  }

  /* ---------- 入口 ---------- */
  // 種類の記号: L<段><単元>  例 L2K, L5C。お金は L1M
  // level は出題形式の内部番号（2 読む・3 かく・4 選ぶ・5 計算）。お金は L1M
  function typeOf(level, unit) { return unit === 'M' ? 'L1M' : `L${level}${unit}`; }
  const fmtOf = id => FORMATS.find(f => f.id === id);
  // 選んだ単元のうち、その出題形式で出せるもの
  function available(level, units) {
    const f = FORMATS.find(x => x.n === level);
    return units.filter(u => { const U = UNITS.find(x => x.id === u); return U && (!U.formats || U.formats.includes(f.id)); });
  }
  function build(type, seed) {
    const r = rng(seed);
    const level = +type[1], unit = type.slice(2);
    let q;
    if (level === 1) q = genMoney(r);
    else if (level === 2) q = genRead(r, unit);
    else if (level === 3) q = genDraw(r, unit);
    else if (level === 4) q = genChoose(r, unit);
    else q = genCalc(r, unit);
    // 系は札にせず、問題文の 1 文として書く（先生の指摘 2026-11-16）
    if (q.sys) q.text += `${q.sys}を系とする。`;
    q.qid = `${type}-${seed}`; q.type = type; q.level = level;
    if (q.unit === undefined) q.unit = unit;
    return q;
  }
  function make(level, units, seed) {
    const s = seed || newSeed();
    const r = rng(s);
    const us = available(level, units);
    if (!us.length) throw new Error('この出題形式で出せる単元がない');
    const u = us[Math.floor(r.f() * us.length)];
    return build(typeOf(level, u), s);
  }
  function regen(qid) {
    const m = /^(L\d[A-Za-z]+)-([0-9a-f]+)$/.exec(qid);
    if (!m) throw new Error('qid の形がちがう: ' + qid);
    return build(m[1], m[2]);
  }
  // 10 問のセット（同じ問題が続かないように、たねを変える）
  function quiz(level, units, n = 10) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(make(level, units));
    return out;
  }
  function check(q, input) {
    const a = q.answer;
    if (a.kind === 'num') {
      if (input === null || input === '' || isNaN(+input)) return false;
      const v = +input;
      if (a.tol) {
        // ±3 %、または有効数字 2 桁に丸めた範囲（13.5 → 13・14 のどちらも正解）。有効数字では正誤を決めない
        const av = Math.abs(a.value), half = av ? Math.pow(10, Math.floor(Math.log10(av)) - 1) / 2 : 0;
        return Math.abs(v - a.value) <= Math.max(av * a.tol, half) + 1e-9;
      }
      return Math.abs(v - a.value) < 1e-9;
    }
    if (a.kind === 'choice') return input === a.correct;
    if (a.kind === 'draw') return input && input.K === a.target.K && input.Us === a.target.Us && input.Ug === a.target.Ug;
    return false;
  }
  // 記録に書く「入れた答え」と「正解」
  function fmtIn(q, input) {
    if (input === null || input === undefined) return '-';
    if (q.answer.kind === 'draw') return `${input.K}/${input.Us}/${input.Ug}`;
    return String(input);
  }
  function fmtAns(q) {
    const a = q.answer;
    if (a.kind === 'draw') return `${a.target.K}/${a.target.Us}/${a.target.Ug}`;
    if (a.kind === 'choice') return String(a.correct);
    return String(r3(a.value));
  }

  return { make, regen, quiz, check, fmtIn, fmtAns, UNITS, FORMATS, fmtOf, available, rng, f2, newSeed, _SCEN: SCEN, _CALC: CALC, _finalize: finalize };
});
