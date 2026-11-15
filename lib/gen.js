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
  const UNITS = [
    { id: 'K', name: '仕事と運動エネルギー' },
    { id: 'Us', name: '弾性力による位置エネルギー' },
    { id: 'Ug', name: '重力による位置エネルギー' },
    { id: 'C', name: '力学的エネルギー保存則' },
    { id: 'F', name: '力学的エネルギーが保存しない場合' },
  ];
  const LEVELS = [
    { n: 1, name: 'お金で考える', time: 30 },
    { n: 2, name: '棒グラフを読む', time: 30 },
    { n: 3, name: '棒グラフをかく', time: 45 },
    { n: 4, name: '場面から選ぶ', time: 30 },
    { n: 5, name: '速さ・高さを求める', time: 90 },
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
  // 有効数字 2 桁（100 以上は整数）。負は − 記号
  function f2(x) {
    const s = x < 0 ? MINUS : '';
    x = Math.abs(x);
    if (x === 0) return '0';
    if (x >= 100) return s + String(Math.round(x));
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
  const J = v => `${f2(v)} J`;
  const Jx = v => `${v < 0 ? MINUS : ''}${Math.abs(v)} J`;   // 段 2〜4（10 J 刻みのちょうどの値）

  // 図の目盛り: 最大値が 5〜10 目盛りに収まる 1・2・5 系の刻み
  function niceUnit(maxV) {
    const raw = maxV / 7, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
    return 10 * p;
  }
  const r3 = x => Math.round(x * 1000) / 1000;

  /* ---------- 場面の図 ---------- */
  const SC = {
    // 水平面: spring（左にばね）・rough:[x1,x2]・from/to（物体の位置）・obj・push（押す力）・v0/v（速さの矢印の文字）
    flat(o) {
      const y = 26, items = [], W = 96;
      let x0 = 4;
      if (o.spring) { items.push({ t: 'wall', x: 4, y1: y - 9, y2: y }); x0 = 4; }
      items.push({ t: 'floor', x1: 4, x2: W - 2, y });
      if (o.rough) items.push({ t: 'rough', x1: o.rough[0], x2: o.rough[1], y });
      const obj = o.obj || 'cart', hw = obj === 'cart' ? 4.5 : 2.5;
      // ばねは、台車が触れている位置まで（縮める場面は「あと」の位置まで縮めて描く）
      if (o.spring) items.push({ t: 'spring', x1: x0, x2: (o.springTo != null ? o.springTo : (o.from || 24)) - hw, y: y - 1.2, h: 3 });
      items.push({ t: obj, x: o.from || 24, y, label: o.fromLabel || '' });
      if (o.to != null) items.push({ t: obj, x: o.to, y, ghost: true, label: o.toLabel || '' });
      // 力は作用点（物体の面の中央、黒丸）から描く。押す力は後ろの面から進む向きへ
      const yc = y - (obj === 'cart' ? 4.7 : 2.5), fx = o.from || 24;
      // 矢印は物体の外まで十分に出す（物体の幅 + 7 mm）
      if (o.push) items.push({ t: 'arrow', dot: true, x1: fx - hw, y1: yc, x2: fx + hw + 7, y2: yc, label: o.push, lx: fx - hw - 1.6, ly: yc + 1.5, anchor: 'end' });
      // 左向きに押す力（ばねを手で押し縮める）。右の面の上寄りから（ばねと重ならない高さ）
      if (o.pushLeft) items.push({ t: 'arrow', dot: true, x1: fx + hw, y1: y - 4.2, x2: fx - hw - 1.5, y2: y - 4.2, label: o.pushLeft, lx: fx + hw + 1.6, ly: y - 2.7, anchor: 'start' });
      if (o.v0) items.push({ t: 'arrow', x1: (o.from || 24) + hw + 0.8, y1: y - 10.5, x2: (o.from || 24) + hw + 9, y2: y - 10.5, label: o.v0, lx: (o.from || 24), ly: y - 12.5 });
      if (o.v && o.to != null) items.push({ t: 'arrow', x1: o.to + hw + 0.8, y1: y - 10.5, x2: o.to + hw + 9, y2: y - 10.5, label: o.v, lx: o.to, ly: y - 12.5, color: 'grey' });
      if (o.dlabel && o.rough) items.push({ t: 'hdim', x1: o.rough[0], x2: o.rough[1], y, off: 11, label: o.dlabel, side: 1 });
      return { w: W, h: o.dlabel ? 42 : (o.rough ? 36 : 31), items };
    },
    // 落下・投げ上げ・持ち上げ: hlabel・top/bottom の物体・矢印
    vert(o) {
      const ground = 46, top = 16, x = 30, items = [];
      items.push({ t: 'floor', x1: 8, x2: 60, y: ground });
      items.push({ t: 'ref', x1: 8, x2: 90, y: ground, label: o.refLabel || '基準面（床）' });
      const obj = o.obj || 'ball';
      // 手の力がある場面は、物体の名前を左に置く（真上は力の矢印が通る）
      const lpos = (o.mode === 'lift' || o.mode === 'lower') ? 'left' : null;
      const put = (yy, ghost, label) => obj === 'ball' ? items.push({ t: 'ball', x, y: yy - 2.2, r: 2.2, ghost, label }) : items.push({ t: 'block', x, y: yy, ghost, label, s: 5, lpos });
      // mid: 「途中」の場面。あとの物体を中ほどの高さに描く
      const mid = (top + ground) / 2 + 3;
      if (o.mode === 'fall') { put(top, false, o.topLabel); put(o.mid ? mid : ground, true, o.bottomLabel); }
      if (o.mode === 'up') { put(ground, false, o.bottomLabel); put(o.mid ? mid : top, true, o.topLabel); }
      if (o.mode === 'shelf') put(top, false, o.topLabel);   // 高いところにあるだけ（矢印なし）
      // 手の力: 作用点は物体の下の面の中央（手で下から支える）。上向き
      if (o.mode === 'lift') { put(ground, false, o.bottomLabel); put(top, true, o.topLabel); items.push({ t: 'arrow', dot: true, x1: x, y1: ground, x2: x, y2: ground - 12, label: o.force || '手が持ち上げる力', lx: x + 2, ly: ground - 8.5, anchor: 'start' }); }
      if (o.mode === 'lower') { put(top, false, o.topLabel); put(ground, true, o.bottomLabel); items.push({ t: 'arrow', dot: true, x1: x, y1: top, x2: x, y2: top - 12, label: o.force || '手が支える力', lx: x + 2, ly: top - 7, anchor: 'start' }); }
      if (o.v) items.push({ t: 'arrow', x1: x - 6, y1: (o.mode === 'up' ? ground - 3 : ground - 6), x2: x - 6, y2: (o.mode === 'up' ? ground - 13 : ground + 4 - 6), label: o.v, lx: x - 8, ly: (o.mode === 'up' ? ground - 8 : ground - 3), anchor: 'end' });
      // 高さ: 物体の下の面（ボールは中心）から補助線を横に引き、床まで両矢印
      if (o.hlabel) {
        const hand = o.mode === 'lift' || o.mode === 'lower', yt = obj === 'ball' ? top - 2.2 : top;
        items.push({ t: 'vdim', x: hand ? x - 10 : x + 9, ex: hand ? x - 2.5 : x + 2.5, y1: yt, y2: ground, label: o.hlabel, side: hand ? -1 : 1 });
      }
      return { w: 92, h: 52, items };
    },
    // 斜面: 左上から右下へ。spring（上の台にばね）・rough（下の床）・up（右へ上る斜面）
    slope(o) {
      const items = [], ground = 38, topY = 12;
      if (o.up) {   // 左の床（ばね）→ 右へ上る斜面
        if (o.spring) items.push({ t: 'wall', x: 4, y1: ground - 9, y2: ground });
        items.push({ t: 'floor', x1: 4, x2: 52, y: ground });
        if (o.rough) items.push({ t: 'rough', x1: o.rough[0], x2: o.rough[1], y: ground });
        items.push({ t: 'slope', x1: 52, y1: ground, x2: 82, y2: topY });
        items.push({ t: 'floor', x1: 82, x2: 94, y: topY });
        if (o.spring) items.push({ t: 'spring', x1: 4, x2: 13, y: ground - 1.2, h: 3 });
        // 斜面の上の位置 u（0 = 下端、1 = 上端）。台車は斜面に沿って傾ける
        const A = Math.atan2(ground - topY, 30), on = u => ({ x: 52 + 30 * u, y: ground - (ground - topY) * u });
        const cartOn = (u, ghost, label) => { const p = on(u); items.push({ t: 'cart', x: p.x, y: p.y, ang: A * 180 / Math.PI, ghost, label }); return p; };
        if (o.pull) {
          // ひもが引く力: 作用点は台車の前の面の中央。斜面に沿って上向き
          const p = cartOn(0.3, false, '');
          if (o.fromLabel) items.push({ t: 'text', x: p.x + 2, y: p.y + 5.5, s: o.fromLabel, anchor: 'start' });
          cartOn(0.75, true, o.toLabel || '');
          const c = Math.cos(A), s = Math.sin(A), fx = p.x + c * 4.5 - s * 4.7, fy = p.y - s * 4.5 - c * 4.7;
          items.push({ t: 'arrow', dot: true, x1: fx, y1: fy, x2: fx + c * 10, y2: fy - s * 10, label: o.pull, lx: fx - 2, ly: fy - 6, anchor: 'end' });
        } else {
          items.push({ t: 'cart', x: 17.5, y: ground, label: o.fromLabel || '' });
          if (o.toTop) cartOn(0.8, true, o.toLabel || '');
          if (o.toMid) cartOn(0.47, true, o.toLabel || '');
        }
        items.push({ t: 'ref', x1: 4, x2: 52, y: ground, label: '基準面' });
        if (o.hlabel) items.push({ t: 'vdim', x: 90, ex2: 52, y1: topY, y2: ground, label: o.hlabel, side: 1 });
        if (o.dlabel && o.rough) items.push({ t: 'hdim', x1: o.rough[0], x2: o.rough[1], y: ground, off: 11, label: o.dlabel, side: 1 });
        return { w: 100, h: o.dlabel ? 58 : (o.rough ? 48 : 44), items };
      }
      return SC.slopeDown(o);
    },
    // 左上の台から右下へすべり下りる斜面（上に速さの矢印の文字が入るよう、少し下げて描く）
    slopeDown(o) {
      const items = [], ground = 44, topY = 18;
      items.push({ t: 'floor', x1: 4, x2: 16, y: topY });
      items.push({ t: 'slope', x1: 16, y1: topY, x2: 46, y2: ground });
      items.push({ t: 'floor', x1: 46, x2: 96, y: ground });
      if (o.rough) items.push({ t: 'rough', x1: o.rough[0], x2: o.rough[1], y: ground });
      if (o.roughSlope) items.push({ t: 'text', x: 33, y: topY + 9, s: '粗い斜面', anchor: 'start' }, { t: 'slope', x1: 16, y1: topY, x2: 46, y2: ground, rough: true });
      const obj = o.obj || 'block';
      items.push({ t: obj, x: 10, y: topY, label: o.fromLabel || '' });
      if (o.to != null) items.push({ t: obj, x: o.to, y: ground, ghost: true, label: o.toLabel || '' });
      items.push({ t: 'ref', x1: 16, x2: 96, y: ground, label: '基準面' });
      // 高さ: 台の面から補助線を横にのばし、斜面の右で床まで両矢印
      if (o.hlabel) items.push({ t: 'vdim', x: 52, ex: 16, y1: topY, y2: ground, label: o.hlabel, side: 1 });
      if (o.v0) items.push({ t: 'arrow', x1: 13, y1: topY - 8, x2: 21, y2: topY - 8, label: o.v0, lx: 10, ly: topY - 10 });
      if (o.dlabel && o.rough) items.push({ t: 'hdim', x1: o.rough[0], x2: o.rough[1], y: ground, off: 11, label: o.dlabel, side: 1 });
      return { w: 100, h: o.dlabel ? 62 : (o.rough ? 52 : 48), items };
    },
    pendulum(o) {
      const items = [], px = 40, py = 4, L = 30;
      items.push({ t: 'floor', x1: 28, x2: 52, y: py, up: true });   // 天井（斜線は上）
      const a = 50 * Math.PI / 180, bx = px - L * Math.sin(a), by = py + L * Math.cos(a);
      items.push({ t: 'text', x: px, y: py + L + 10, s: '' });
      const ln = { t: 'arrow' }; void ln;
      return { w: 80, h: 44, items: items.concat([
        { t: 'ball', x: bx, y: by, r: 2.2, label: o.fromLabel || '' },
        { t: 'ball', x: px, y: py + L, r: 2.2, ghost: true, label: o.toLabel || '' },
        { t: 'ref', x1: 10, x2: 74, y: py + L + 2.2, label: '基準面' },
      ]), lines: [[px, py, bx, by], [px, py, px, py + L]] };
    },
  };
  // 振り子のひもは scene の items に line が無いので、text のかわりに細い spring を使わず、ここで足す
  function withStrings(spec) {
    if (!spec.lines) return spec;
    const extra = spec.lines.map(([x1, y1, x2, y2], i) => ({ t: 'slope', x1, y1, x2, y2, ghost: i > 0 }));
    return { w: spec.w, h: spec.h, items: spec.items.concat(extra) };
  }

  /* ---------- 段 2〜4 の場面（10 J 刻み、合計 100 J まで） ---------- */
  // 返り値: { sys, desc, before:{K,Us,Ug}, after:{…}, work:{W,by}|null, hint, scene, titles, why:{…} }
  const z = o => ({ K: o.K || 0, Us: o.Us || 0, Ug: o.Ug || 0 });
  const SCEN = {
    K: [
      r => { const a = r.step(0, 50, 10), w = r.step(10, 40, 10);
        return { sys: '台車', desc: 'なめらかな水平面上の台車を、手で押して速くした。', before: z({ K: a }), after: z({ K: a + w }), work: { W: w, by: '手が押す力' },
          hint: 'なめらかな水平面上なので、高さは変わらず、ばねもない。', scene: SC.flat({ from: 34, to: 74, push: '押す力', fromLabel: 'まえ', toLabel: 'あと' }) }; },
      r => { const a = r.step(30, 90, 10), w = r.step(10, a, 10);
        return { sys: '物体', desc: w === a ? '粗い水平面上をすべる物体が、摩擦力を受けて止まった。' : '粗い水平面上をすべる物体が、摩擦力を受けて遅くなった。',
          before: z({ K: a }), after: z({ K: a - w }), work: { W: -w, by: '摩擦力' }, hint: '水平面上なので、高さは変わらない。',
          scene: SC.flat({ obj: 'block', from: 16, to: 70, rough: [10, 80], fromLabel: 'まえ', toLabel: 'あと' }) }; },
    ],
    Us: [
      r => { const a = r.step(20, 80, 10);
        return { sys: '台車とばね', desc: 'なめらかな水平面上で、ばねを押し縮めて台車を止めておき、静かに放した。台車はばねから離れて動いた。',
          before: z({ Us: a }), after: z({ K: a }), work: null, hint: 'ばねから離れたあとは、ばねは自然の長さにもどっている。',
          scene: SC.flat({ spring: true, from: 20, to: 66, fromLabel: 'まえ', toLabel: 'あと' }), titles: ['放す前', '離れたあと'] }; },
      r => { const a = r.step(30, 90, 10), b = r.step(10, a - 10, 10);
        return { sys: '台車とばね', desc: `なめらかな水平面上を走ってきた台車が、ばねを押し縮めはじめた。ばねのエネルギーが ${b} J になったとき（台車はまだ動いている）を「あと」とする。`,
          before: z({ K: a }), after: z({ K: a - b, Us: b }), work: null, hint: `あとのばねのエネルギーは ${b} J。`,
          scene: SC.flat({ spring: true, from: 66, to: 26, springTo: 26, fromLabel: 'まえ', toLabel: 'あと' }) }; },
      r => { const a = r.step(20, 90, 10);
        return { sys: '台車とばね', desc: 'なめらかな水平面上を走ってきた台車が、ばねを押し縮め、いちばん縮んだところで一瞬止まった。',
          before: z({ K: a }), after: z({ Us: a }), work: null, hint: 'いちばん縮んだとき、台車は一瞬止まっている。',
          scene: SC.flat({ spring: true, from: 66, to: 20, springTo: 20, fromLabel: 'まえ', toLabel: 'あと' }), titles: ['ぶつかる前', 'いちばん縮んだとき'] }; },
      r => { const w = r.step(10, 60, 10);
        return { sys: 'ばね', desc: '自然の長さのばねを、手でゆっくり押し縮めた。', before: z({}), after: z({ Us: w }), work: { W: w, by: '手が押す力' },
          hint: 'ゆっくり押したので、運動エネルギーは考えなくてよい。', scene: SC.flat({ spring: true, obj: 'block', from: 24, pushLeft: '手が押す力', fromLabel: '' }) }; },
    ],
    Ug: [
      r => { const a = r.step(0, 40, 10), w = r.step(10, 50, 10);
        return { sys: '物体と地球', desc: '床の上の物体を、手でゆっくり持ち上げた（床を基準面とする）。', before: z({ Ug: a }), after: z({ Ug: a + w }), work: { W: w, by: '手が持ち上げる力' },
          hint: 'ゆっくり持ち上げたので、運動エネルギーは 0 のまま。', scene: SC.vert({ mode: 'lift', obj: 'block', bottomLabel: 'まえ', topLabel: 'あと' }) }; },
      r => { const a = r.step(30, 90, 10), w = r.step(10, a, 10);
        return { sys: '物体と地球', desc: '棚の上の物体を、手で支えながらゆっくり下ろした（床を基準面とする）。', before: z({ Ug: a }), after: z({ Ug: a - w }), work: { W: -w, by: '手が支える力' },
          hint: 'ゆっくり下ろしたので、運動エネルギーは 0 のまま。', scene: SC.vert({ mode: 'lower', obj: 'block', topLabel: 'まえ', bottomLabel: 'あと' }) }; },
    ],
    C: [
      r => { const a = r.step(30, 90, 10), full = r.f() < 0.5, b = full ? a : r.step(10, a - 10, 10);
        return { sys: '物体と地球', desc: full ? '物体を静かに落とした。床に着く直前を「あと」とする（床を基準面とし、空気抵抗は考えない）。' : `物体を静かに落とした。落ちている途中で、重力による位置エネルギーが ${a - b} J になったところを「あと」とする（床を基準面とし、空気抵抗は考えない）。`,
          before: z({ Ug: a }), after: z({ K: b, Ug: a - b }), work: null, hint: full ? '床に着く直前は、高さが 0。' : `あとの重力による位置エネルギーは ${a - b} J。`,
          scene: SC.vert({ mode: 'fall', mid: !full, topLabel: 'まえ', bottomLabel: 'あと' }) }; },
      r => { const a = r.step(30, 90, 10), top = r.f() < 0.5, b = top ? a : r.step(10, a - 10, 10);
        return { sys: '物体と地球', desc: top ? 'ボールを真上に投げ上げた。いちばん高いところを「あと」とする（投げた位置を基準面とし、空気抵抗は考えない）。' : `ボールを真上に投げ上げた。上っている途中で、重力による位置エネルギーが ${b} J になったところを「あと」とする（投げた位置を基準面とし、空気抵抗は考えない）。`,
          before: z({ K: a }), after: z({ K: a - b, Ug: b }), work: null, hint: top ? 'いちばん高いところでは、ボールは一瞬止まる。' : `あとの重力による位置エネルギーは ${b} J。`,
          scene: SC.vert({ mode: 'up', mid: !top, bottomLabel: 'まえ', topLabel: 'あと', refLabel: '基準面（投げた位置）' }) }; },
      r => { const a = r.step(20, 70, 10), c = r.step(0, 30, 10);
        return { sys: '物体と地球', desc: c ? `なめらかな斜面の上で、物体に初速度を与えてすべり下ろした。斜面の下の水平面に着いたところを「あと」とする（水平面を基準面とする）。` : 'なめらかな斜面の上で物体を静かに放した。斜面の下の水平面に着いたところを「あと」とする（水平面を基準面とする）。',
          before: z({ K: c, Ug: a }), after: z({ K: a + c }), work: null, hint: '水平面に着いたとき、高さは 0。',
          scene: SC.slope({ to: 70, fromLabel: 'まえ', toLabel: 'あと', v0: c ? '' : null }) }; },
      r => { const a = r.step(40, 90, 10), top = r.f() < 0.5, b = top ? a : r.step(10, a - 10, 10);
        return { sys: '台車とばねと地球', desc: top ? 'なめらかな水平面で、ばねを押し縮めて台車を放した。台車はなめらかな斜面を上り、いちばん高いところで一瞬止まった（水平面を基準面とする）。' : `なめらかな水平面で、ばねを押し縮めて台車を放した。台車はなめらかな斜面を上り、重力による位置エネルギーが ${b} J になったところを「あと」とする（水平面を基準面とする）。`,
          before: z({ Us: a }), after: z({ K: a - b, Ug: b }), work: null, hint: top ? 'いちばん高いところでは一瞬止まり、ばねは自然の長さ。' : `あとの重力による位置エネルギーは ${b} J。ばねは自然の長さ。`,
          scene: SC.slope({ up: true, spring: true, toTop: top, toMid: !top, fromLabel: 'まえ', toLabel: 'あと' }) }; },
      r => { const a = r.step(20, 80, 10);
        return { sys: 'おもりと地球', desc: '振り子のおもりを、ひもを張ったまま持ち上げて静かに放した。いちばん低いところを「あと」とする（いちばん低い位置を基準面とし、空気抵抗は考えない）。',
          before: z({ Ug: a }), after: z({ K: a }), work: null, hint: 'いちばん低いところで高さは 0。ひもが引く力は運動の向きに垂直なので仕事をしない。',
          scene: withStrings(SC.pendulum({ fromLabel: 'まえ', toLabel: 'あと' })) }; },
    ],
    F: [
      r => { const a = r.step(30, 90, 10), w = r.step(10, a, 10);
        return { sys: '物体', desc: w === a ? '水平面上をすべってきた物体が、粗い面に入って止まった。' : '水平面上をすべってきた物体が、粗い面を通りぬけた。',
          before: z({ K: a }), after: z({ K: a - w }), work: { W: -w, by: '摩擦力' }, hint: '水平面上なので、高さは変わらない。',
          scene: SC.flat({ obj: 'block', from: 14, to: w === a ? 60 : 84, rough: [32, 72], fromLabel: 'まえ', toLabel: 'あと' }) }; },
      r => { const a = r.step(30, 90, 10), w = r.step(10, a, 10);
        return { sys: '台車とばね', desc: w === a ? 'ばねを押し縮めて台車を放した。台車はばねから離れ、粗い面に入って止まった。' : 'ばねを押し縮めて台車を放した。台車はばねから離れ、粗い面を通りぬけた。',
          before: z({ Us: a }), after: z({ K: a - w }), work: { W: -w, by: '摩擦力' }, hint: 'ばねから離れたあとは、ばねは自然の長さ。水平面なので高さは変わらない。',
          scene: SC.flat({ spring: true, from: 20, to: w === a ? 62 : 86, rough: [40, 76], fromLabel: 'まえ', toLabel: 'あと' }) }; },
      r => { const a = r.step(40, 90, 10), w = r.step(10, a - 10, 10);
        return { sys: '物体と地球', desc: '粗い斜面の上で物体を静かに放した。物体は斜面をすべり下り、斜面の下の水平面に着いた（水平面を基準面とする）。',
          before: z({ Ug: a }), after: z({ K: a - w }), work: { W: -w, by: '摩擦力' }, hint: `水平面に着いたとき、高さは 0。摩擦力がした仕事は ${MINUS}${w} J。`,
          scene: SC.slope({ to: 60, roughSlope: true, fromLabel: 'まえ', toLabel: 'あと' }) }; },
      r => { const c = r.step(10, 30, 10), a = r.step(0, 30, 10), w = r.step(10, Math.min(50, 100 - c - a), 10);
        return { sys: '台車と地球', desc: 'なめらかな斜面に沿って、ひもで台車を一定の速さで引き上げた（斜面の下を基準面とする）。',
          before: z({ K: c, Ug: a }), after: z({ K: c, Ug: a + w }), work: { W: w, by: 'ひもが引く力' }, hint: '一定の速さなので、運動エネルギーは変わらない。',
          scene: SC.slope({ up: true, toMid: true, pull: 'ひもが引く力', fromLabel: 'まえ', toLabel: 'あと' }) }; },
    ],
  };

  const NAMEJ = { K: '運動エネルギー', Us: '弾性力による位置エネルギー', Ug: '重力による位置エネルギー', sum: '合計' };
  const tot = s => s.K + s.Us + s.Ug;

  function chartOf(sc, overrides = {}) {
    const titles = sc.titles || ['まえ', 'あと'];
    const max = Math.max(tot(sc.before), tot(sc.after), 40);
    return {
      states: [Object.assign({ title: titles[0] }, sc.before, overrides.b || {}), Object.assign({ title: titles[1] }, sc.after, overrides.a || {})],
      opt: { works: [sc.work ? Object.assign({ W: sc.work.W, text: workText(sc.work) }, overrides.w || {}) : null], ref: overrides.ref !== false, grid: !!overrides.grid, max: overrides.grid ? Math.ceil(max / 10) * 10 + 10 : undefined, values: overrides.values },
    };
  }
  const workText = w => w.W > 0 ? `${w.by}が\n仕事をした` : `${w.by}が\n負の仕事をした`;
  const workSentence = w => w.W > 0 ? `${w.by}が物体に ${Jx(w.W)} の仕事をした` : `${w.by}が物体に ${Jx(w.W)} の仕事（負の仕事）をした`;
  function sysLine(sc) { return `系：${sc.sys}`; }

  function explainBalance(sc) {
    const b = tot(sc.before), a = tot(sc.after);
    if (!sc.work) return `外から仕事をされていないので、合計は ${Jx(b)} のまま変わりません。`;
    return `${workSentence(sc.work).replace('物体に', `${sc.sys.split('と')[0]}に`)}ので、合計は ${Jx(b)} → ${Jx(a)} と${sc.work.W > 0 ? '増え' : '減り'}ました。`;
  }

  /* ---------- 段 1: お金 ---------- */
  function genMoney(r) {
    const kind = r.pick(['in', 'out', 'move', 'move_in']);
    const w0 = r.step(100, 500, 100), b0 = r.step(0, 400, 100);
    let w1 = w0, b1 = b0, flow = 0, text, by = '';
    if (kind === 'in') { flow = r.step(100, 400, 100); w1 = w0 + flow; text = `財布に ${w0} 円、貯金箱に ${b0} 円ある。おこづかいを ${flow} 円もらって財布に入れた。`; by = 'おこづかい'; }
    if (kind === 'out') { flow = -r.step(100, w0, 100); w1 = w0 + flow; text = `財布に ${w0} 円、貯金箱に ${b0} 円ある。財布から ${-flow} 円のお菓子を買った。`; by = 'お菓子'; }
    if (kind === 'move') { const m = r.step(100, w0, 100); w1 = w0 - m; b1 = b0 + m; text = `財布に ${w0} 円、貯金箱に ${b0} 円ある。財布から ${m} 円を貯金箱に移した。`; }
    if (kind === 'move_in') { flow = r.step(100, 300, 100); const m = r.step(100, w0 + flow, 100); w1 = w0 + flow - m; b1 = b0 + m; text = `財布に ${w0} 円、貯金箱に ${b0} 円ある。おこづかいを ${flow} 円もらって財布に入れ、そのあと財布から ${m} 円を貯金箱に移した。`; by = 'おこづかい'; }
    const askT = r.pick(kind === 'move' ? ['wallet', 'bank', 'sum'] : ['wallet', 'sum', 'bank']);
    const ansV = askT === 'wallet' ? w1 : askT === 'bank' ? b1 : w1 + b1;
    const askName = { wallet: 'あとの財布', bank: 'あとの貯金箱', sum: 'あとの合計' }[askT];
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
    exp.push('エネルギーも同じです。系の中で移り変わるだけなら合計は変わらず、仕事で出入りしたぶんだけ合計が変わります。');
    return {
      unit: null, sys: '自分のお金（財布と貯金箱）', text, ask: `${askName}はいくらか。`,
      chart: { states: [{ title: 'まえ', wallet: w0, bank: b0 }, { title: 'あと', wallet: w1, bank: b1, hide: hideA }], opt },
      answer: { kind: 'num', value: ansV, tol: 0, unit: '円' },
      explain: exp,
      explainChart: { states: [{ title: 'まえ', wallet: w0, bank: b0 }, { title: 'あと', wallet: w1, bank: b1, answer: [askT] }], opt },
      variant: kind,
    };
  }

  /* ---------- 段 2: 棒グラフを読む ---------- */
  function genRead(r, unit) {
    const sc = r.pick(SCEN[unit])(r);
    const cands = [];
    ['K', 'Us', 'Ug'].forEach(k => { if (sc.after[k]) cands.push({ st: 'a', k }); });
    ['K', 'Us', 'Ug'].forEach(k => { if (sc.before[k] && (sc.work || cands.length)) cands.push({ st: 'b', k }); });
    cands.push({ st: 'a', k: 'sum' });
    if (sc.work) cands.push({ st: 'w' }, { st: 'w' });
    const t = r.pick(cands);
    const ch = chartOf(sc);
    let ask, value, hideNote = '';
    if (t.st === 'w') {
      ch.opt.works[0].hide = true; ch.opt.works[0].text = sc.work.W > 0 ? `${sc.work.by}が\nした仕事` : `${sc.work.by}が\nした仕事`;
      ask = `${sc.work.by}がした仕事は何 J か。`; value = sc.work.W;
      if (sc.work.W < 0) hideNote = '（負の仕事なら − をつける）';
    } else {
      const which = t.st === 'a' ? 1 : 0;
      ch.states[which].hide = t.k === 'sum' ? ['K', 'Us', 'Ug', 'sum'] : [t.k, 'sum'];
      if (which === 0) ch.opt.ref = false;
      ask = `${t.st === 'a' ? 'あと' : 'まえ'}の${NAMEJ[t.k]}は何 J か。`;
      value = t.k === 'sum' ? tot(t.st === 'a' ? sc.after : sc.before) : (t.st === 'a' ? sc.after : sc.before)[t.k];
    }
    const ex = chartOf(sc);
    if (t.st === 'w') ex.opt.works[0].answer = true;
    else ex.states[t.st === 'a' ? 1 : 0].answer = [t.k];
    const e = [explainBalance(sc)];
    if (t.st !== 'w' && t.k !== 'sum') e.push(`合計から、ほかの棒を引くと ${NAMEJ[t.k]}は ${Jx(value)}。`);
    return { unit, sys: sc.sys, text: sc.desc, ask: ask + hideNote, chart: ch, scene: null, answer: { kind: 'num', value, tol: 0, unit: 'J' }, explain: e, explainChart: ex };
  }

  /* ---------- 段 3: 棒グラフをかく ---------- */
  function genDraw(r, unit) {
    const sc = r.pick(SCEN[unit])(r);
    const ch = chartOf(sc, { grid: true });
    ch.states[1].blank = true;
    const ex = chartOf(sc, { grid: true });
    ex.states[1].answer = true;
    return {
      unit, sys: sc.sys, text: `${sc.desc}${sc.hint ? ' ' + sc.hint : ''}`, ask: '「あと」の棒を動かして、棒グラフをかけ（1 目盛り 10 J）。',
      chart: ch, scene: sc.scene, answer: { kind: 'draw', target: { K: sc.after.K, Us: sc.after.Us, Ug: sc.after.Ug } },
      explain: [explainBalance(sc), `あとは 運動 ${Jx(sc.after.K)}・ばね ${Jx(sc.after.Us)}・重力 ${Jx(sc.after.Ug)}。`], explainChart: ex,
    };
  }

  /* ---------- 段 4: 場面から選ぶ ---------- */
  function genChoose(r, unit) {
    const sc = r.pick(SCEN[unit])(r);
    const base = () => chartOf(sc, { values: false });
    const opts = [{ c: base(), why: `正解。${explainBalance(sc)}` }];
    const ds = [];
    const B = tot(sc.before);
    // (1) 仕事があるのに矢印がない（合計が変わるのに）
    if (sc.work) {
      const c = base(); c.opt.works = [null];
      ds.push({ c, why: `合計が変わっているのに、仕事の矢印がありません。${sc.work.by}が仕事をしています。` });
      // (2) 向きが逆
      const w2 = -sc.work.W, after2 = Object.assign({}, sc.after);
      const key = ['K', 'Us', 'Ug'].find(k => sc.after[k] - sc.before[k] !== 0) || 'K';
      after2[key] = sc.before[key] + w2 + (sc.after[key] - sc.before[key] - sc.work.W);
      if (after2[key] >= 0 && tot(after2) >= 0) {
        const c2 = chartOf({ ...sc, after: after2, work: { W: w2, by: sc.work.by } }, { values: false });
        ds.push({ c: c2, why: sc.work.W > 0 ? `${sc.work.by}は運動の向きにはたらくので、仕事は正（入る矢印）です。` : `${sc.work.by}は運動と逆向きにはたらくので、仕事は負（出る矢印）です。` });
      }
    } else {
      // (3) 系の中の力（重力・ばねの力）の仕事を外から足してしまう
      const gain = r.step(10, 30, 10);
      const after3 = Object.assign({}, sc.after); after3.K += gain;
      const who = /地球/.test(sc.sys) ? '重力' : 'ばねの力';
      ds.push({ c: chartOf({ ...sc, after: after3, work: { W: gain, by: who } }, { values: false }), why: `系に${/地球/.test(sc.sys) ? '地球' : 'ばね'}を入れているので、${who}の仕事を外から足すと二重に数えてしまいます。` });
      // (4) 合計が減る（エネルギーが消える）
      const k = ['K', 'Us', 'Ug'].find(k2 => sc.after[k2] >= 20) || 'K';
      const after4 = Object.assign({}, sc.after); after4[k] = Math.max(0, after4[k] - r.step(10, 20, 10));
      if (tot(after4) !== tot(sc.after)) ds.push({ c: chartOf({ ...sc, after: after4 }, { values: false }), why: '外から仕事をされていないので、合計は減りません。' });
    }
    // (5) 行き先の棒がちがう
    const moved = ['K', 'Us', 'Ug'].filter(k => sc.after[k] > 0);
    if (moved.length) {
      const from = r.pick(moved), others = ['K', 'Us', 'Ug'].filter(k => k !== from);
      const to = r.pick(others);
      const after5 = Object.assign({}, sc.after); after5[to] += after5[from]; after5[from] = 0;
      const okForm = unit !== 'K' || to === 'K';
      if (okForm && JSON.stringify(after5) !== JSON.stringify(sc.after))
        ds.push({ c: chartOf({ ...sc, after: after5 }, { values: false }), why: `あとの${NAMEJ[from]}が 0 になっていますが、${sc.hint || '場面をよく読みましょう。'}` });
    }
    const picked = r.shuffle(ds).slice(0, 2);
    while (picked.length < 2) {   // 足りないときは合計を増やした図
      const after6 = Object.assign({}, sc.after); after6.K += 10 * (picked.length + 1);
      picked.push({ c: chartOf({ ...sc, after: after6 }, { values: false }), why: '外からの仕事より多く、合計が増えています。' });
    }
    const all = r.shuffle([opts[0], ...picked]);
    void B;
    return {
      unit, sys: sc.sys, text: sc.desc, ask: '「まえ」と「あと」の棒グラフとして正しいものを選べ。',
      chart: null, scene: sc.scene,
      answer: { kind: 'choice', choices: all.map(o => o.c), correct: all.indexOf(opts[0]), why: all.map(o => o.why) },
      explain: [explainBalance(sc)], explainChart: chartOf(sc),
    };
  }

  /* ---------- 段 5: 計算 ---------- */
  const eChart = (b0, a0, w, titles) => {
    const rs = o => ({ K: r3(o.K || 0), Us: r3(o.Us || 0), Ug: r3(o.Ug || 0) });
    const b = rs(b0), a = rs(a0);   // 足りない棒を 0 で埋めてから（埋めないと合計が NaN になり、目盛りが既定の 10 J に落ちていた）
    const vals = [tot(b), tot(a), ...Object.values(b), ...Object.values(a)];
    const u = niceUnit(Math.max(...vals));
    return { states: [Object.assign({ title: titles ? titles[0] : 'まえ' }, rs(b)), Object.assign({ title: titles ? titles[1] : 'あと' }, a, { answer: ['K', 'Us', 'Ug'].filter(k => a[k]).concat('sum') })],
      opt: { unit: u, mmPerUnit: 28 / (Math.max(...vals) / u), works: [w ? { W: r3(w.W), text: workText(w) } : null], ref: true, values: true, fmt: 'sig2' } };
  };
  const CALC = {
    K: [
      // 仕事 → 速さ
      r => { const m = r.pick([0.5, 1.0, 2.0, 4.0]), v0 = r.pick([0, 1.0, 2.0, 3.0]), v = r.pick([2, 3, 4, 5, 6].filter(x => x > v0)), W = 0.5 * m * (v * v - v0 * v0);
        return { sys: '台車', text: `なめらかな水平面上を速さ ${fv(v0)} m/s で動いている質量 ${fv(m)} kg の台車を、運動の向きに押した。押す力が台車にした仕事は ${fv(W)} J だった。`, ask: '押したあとの台車の速さは何 m/s か。',
          value: v, unit: 'm/s', scene: SC.flat({ from: 34, to: 74, push: '押す力', v0: v0 ? `${fv(v0)} m/s` : '', v: '?', fromLabel: '', toLabel: '' }),
          explain: [`まえの運動エネルギー ½ × ${fv(m)} × ${fv(v0)}² = ${J(0.5 * m * v0 * v0)}`, `押す力の仕事 +${J(W)} を足して、あとの運動エネルギーは ${J(0.5 * m * v * v)}`, `½ × ${fv(m)} × v² = ${f2(0.5 * m * v * v)} より v = ${f2(v)} m/s`],
          ec: eChart({ K: 0.5 * m * v0 * v0 }, { K: 0.5 * m * v * v }, { W, by: '押す力' }) }; },
      // 速さの変化 → 仕事
      r => { const m = r.pick([1.0, 2.0, 4.0, 5.0]), v0 = r.pick([2, 3, 4]), v = r.pick([4, 5, 6, 8].filter(x => x > v0)), W = 0.5 * m * (v * v - v0 * v0);
        return { sys: '物体', text: `なめらかな水平面上を速さ ${fv(v0)} m/s で動いている質量 ${fv(m)} kg の物体に、運動の向きに力を加え続けたところ、速さが ${fv(v)} m/s になった。`, ask: 'この力が物体にした仕事は何 J か。',
          value: W, unit: 'J', scene: SC.flat({ obj: 'block', from: 30, to: 72, push: '力', v0: `${fv(v0)} m/s`, v: `${fv(v)} m/s` }),
          explain: [`まえ ½ × ${fv(m)} × ${fv(v0)}² = ${J(0.5 * m * v0 * v0)}、あと ½ × ${fv(m)} × ${fv(v)}² = ${J(0.5 * m * v * v)}`, `運動エネルギーの増えたぶんが仕事なので ${J(W)}`],
          ec: eChart({ K: 0.5 * m * v0 * v0 }, { K: 0.5 * m * v * v }, { W, by: '力' }) }; },
      // ブレーキ → 距離
      r => { const m = r.pick([1000, 1200, 1500, 2000]), v = r.pick([10, 15, 20]), d = r.pick([20, 25, 30, 40, 50]), F = 0.5 * m * v * v / d;
        return { sys: '自動車', text: `質量 ${m} kg の自動車が速さ ${v} m/s で走っていたところ、ブレーキをかけてタイヤがすべり、止まった。路面から受ける摩擦力の大きさは ${Math.round(F)} N で一定だった。`, ask: 'ブレーキをかけてから止まるまでにすべった距離は何 m か。',
          value: d, unit: 'm', scene: SC.flat({ obj: 'cart', from: 18, to: 76, rough: [24, 78], v0: `${v} m/s`, fromLabel: '', toLabel: '止まる' }),
          explain: [`まえの運動エネルギー ½ × ${m} × ${v}² = ${J(0.5 * m * v * v)}`, `摩擦力の仕事 −${Math.round(F)} × d が、これをすべて 0 にする`, `${Math.round(F)} × d = ${f2(0.5 * m * v * v)} より d = ${f2(d)} m`],
          ec: eChart({ K: 0.5 * m * v * v }, { K: 0 }, { W: -0.5 * m * v * v, by: '摩擦力' }) }; },
    ],
    Us: [
      r => { const k = r.pick([20, 40, 50, 80, 100, 200, 400]), x = r.pick([0.05, 0.10, 0.20, 0.30].filter(xx => 0.5 * k * xx * xx <= 20)), E = 0.5 * k * x * x;
        return { sys: 'ばね', text: `ばね定数 ${k} N/m のばねを、自然の長さから ${fv(x, 2)} m 縮めた。`, ask: 'ばねにたくわえられた弾性力による位置エネルギーは何 J か。',
          value: E, unit: 'J', scene: null, explain: [`½kx² = ½ × ${k} × ${fv(x, 2)}² = ${J(E)}`], ec: eChart({}, { Us: E }, { W: E, by: '押す力' }) }; },
      r => { const m = r.pick([0.25, 0.5, 1.0, 2.0]), rr = r.pick([4, 5, 6, 8, 10, 12, 14, 20]), k = m * rr * rr; if (k < 20 || k > 400) return null;
        const x = r.pick([0.05, 0.10, 0.15, 0.20, 0.25]), v = rr * x, E = 0.5 * k * x * x;
        return { sys: '台車とばね', text: `なめらかな水平面上で、ばね定数 ${fv(k)} N/m のばねを ${fv(x, 2)} m 縮め、質量 ${fv(m)} kg の台車を押しあてて静かに放した。`, ask: 'ばねから離れたあとの台車の速さは何 m/s か。',
          value: v, unit: 'm/s', scene: SC.flat({ spring: true, from: 20, to: 66, v: '?', fromLabel: '', toLabel: '' }),
          explain: [`ばねのエネルギー ½ × ${fv(k)} × ${fv(x, 2)}² = ${J(E)} がすべて運動エネルギーになる`, `½ × ${fv(m)} × v² = ${f2(E)} より v = ${f2(v)} m/s`],
          ec: eChart({ Us: E }, { K: E }, null, ['放す前', '離れたあと']) }; },
      r => { const m = r.pick([0.5, 1.0, 2.0]), rr = r.pick([5, 10, 20]), k = m * rr * rr; if (k < 20 || k > 400) return null;
        const v = r.pick([0.5, 1.0, 1.5, 2.0]), x = v / rr, E = 0.5 * m * v * v;
        return { sys: '台車とばね', text: `なめらかな水平面上を速さ ${fv(v)} m/s で走ってきた質量 ${fv(m)} kg の台車が、ばね定数 ${fv(k)} N/m のばねにぶつかり、ばねを押し縮めた。`, ask: 'ばねはいちばん縮んだとき、自然の長さから何 m 縮んでいるか。',
          value: x, unit: 'm', scene: SC.flat({ spring: true, from: 66, to: 20, springTo: 20, v0: `${fv(v)} m/s` }),
          explain: [`運動エネルギー ½ × ${fv(m)} × ${fv(v)}² = ${J(E)} がすべてばねのエネルギーになる`, `½ × ${fv(k)} × x² = ${f2(E)} より x = ${f2(x)} m`],
          ec: eChart({ K: E }, { Us: E }, null, ['ぶつかる前', 'いちばん縮んだとき']) }; },
    ],
    Ug: [
      r => { const m = r.pick([0.5, 1.0, 2.0, 5.0, 10]), h = r.pick([0.5, 1.0, 1.5, 2.0, 3.0, 5.0]), E = m * G * h;
        return { sys: '物体と地球', text: `質量 ${fv(m)} kg の物体が、床から高さ ${fv(h)} m の棚の上にある（重力加速度 9.8 m/s²、床を基準面とする）。`, ask: '物体の重力による位置エネルギーは何 J か。',
          value: E, unit: 'J', scene: SC.vert({ mode: 'shelf', obj: 'block', hlabel: `${fv(h)} m` }), explain: [`mgh = ${fv(m)} × 9.8 × ${fv(h)} = ${J(E)}`], ec: null }; },
      r => { const m = r.pick([1.0, 2.0, 5.0]), H = r.pick([1.5, 1.8, 2.0]), d = r.pick([0.7, 0.8, 1.0]), h = r3(H - d), E = m * G * h;
        return { sys: '物体と地球', text: `質量 ${fv(m)} kg の物体が、床から高さ ${fv(H)} m の棚の上にある。床から高さ ${fv(d)} m の机の面を基準面とする（重力加速度 9.8 m/s²）。`, ask: '物体の重力による位置エネルギーは何 J か。',
          value: E, unit: 'J', scene: null, explain: [`基準面からの高さは ${fv(H)} − ${fv(d)} = ${fv(h)} m`, `mgh = ${fv(m)} × 9.8 × ${fv(h)} = ${J(E)}`], ec: null }; },
      r => { const m = r.pick([2.0, 5.0, 10, 20]), h = r.pick([0.5, 1.0, 1.5, 2.0]), W = m * G * h;
        return { sys: '物体と地球', text: `床の上の質量 ${fv(m)} kg の物体を、手でゆっくり高さ ${fv(h)} m まで持ち上げた（重力加速度 9.8 m/s²）。`, ask: '手が持ち上げる力が物体にした仕事は何 J か。',
          value: W, unit: 'J', scene: SC.vert({ mode: 'lift', obj: 'block', hlabel: `${fv(h)} m` }),
          explain: ['ゆっくり持ち上げたので運動エネルギーは 0 のまま', `手が持ち上げる力の仕事が、重力による位置エネルギーの増加 mgh = ${fv(m)} × 9.8 × ${fv(h)} = ${J(W)} になる`],
          ec: eChart({}, { Ug: W }, { W, by: '手が持ち上げる力' }) }; },
    ],
    C: [
      r => { const n = r.int(3, 20), h = r3(0.1 * n * n), v = r3(1.4 * n), m = r.pick([0.5, 1.0, 2.0]), E = m * G * h;
        return { sys: '物体と地球', text: `質量 ${fv(m)} kg の物体を、床から高さ ${fv(h)} m のところで静かに放した（重力加速度 9.8 m/s²、空気抵抗は考えない）。`, ask: '床に着く直前の速さは何 m/s か。',
          value: v, unit: 'm/s', scene: SC.vert({ mode: 'fall', hlabel: `${fv(h)} m`, v: '?' }),
          explain: [`重力による位置エネルギー mgh = ${f2(E)} J がすべて運動エネルギーになる`, `½ × ${fv(m)} × v² = ${f2(E)} より v² = ${f2(2 * G * h)}、v = ${f2(v)} m/s`],
          ec: eChart({ Ug: E }, { K: E }) }; },
      r => { const n = r.int(3, 15), h = r3(0.1 * n * n), v = r3(1.4 * n), m = r.pick([0.2, 0.5, 1.0]), E = 0.5 * m * v * v;
        return { sys: 'ボールと地球', text: `質量 ${fv(m)} kg のボールを、速さ ${fv(v)} m/s で真上に投げ上げた（重力加速度 9.8 m/s²、空気抵抗は考えない）。`, ask: '投げた位置から何 m の高さまで上がるか。',
          value: h, unit: 'm', scene: SC.vert({ mode: 'up', v: `${fv(v)} m/s`, refLabel: '基準面（投げた位置）', hlabel: '?' }),
          explain: [`運動エネルギー ½ × ${fv(m)} × ${fv(v)}² = ${f2(E)} J がすべて重力による位置エネルギーになる`, `${fv(m)} × 9.8 × h = ${f2(E)} より h = ${f2(h)} m`],
          ec: eChart({ K: E }, { Ug: E }, null, ['投げた直後', 'いちばん高いところ']) }; },
      r => { const k0 = r.int(0, 4), n = r.int(k0 + 3, 12), v0 = r3(1.4 * k0), v = r3(1.4 * n), h = r3(0.1 * (n * n - k0 * k0)), m = r.pick([1.0, 2.0, 3.0]);
        return { sys: '物体と地球', text: k0 ? `高さ ${fv(h)} m のなめらかな斜面の上で、質量 ${fv(m)} kg の物体に斜面に沿って速さ ${fv(v0)} m/s を与えた（重力加速度 9.8 m/s²）。` : `高さ ${fv(h)} m のなめらかな斜面の上で、質量 ${fv(m)} kg の物体を静かに放した（重力加速度 9.8 m/s²）。`, ask: '斜面の下の水平面に着いたときの速さは何 m/s か。',
          value: v, unit: 'm/s', scene: SC.slope({ to: 70, hlabel: `${fv(h)} m`, v0: k0 ? `${fv(v0)} m/s` : null }),
          explain: [`まえ: 運動 ${J(0.5 * m * v0 * v0)}、重力 ${fv(m)} × 9.8 × ${fv(h)} = ${J(m * G * h)}`, `あとは重力 0 なので、運動エネルギー = ${J(0.5 * m * v * v)}`, `½ × ${fv(m)} × v² = ${f2(0.5 * m * v * v)} より v = ${f2(v)} m/s`],
          ec: eChart({ K: 0.5 * m * v0 * v0, Ug: m * G * h }, { K: 0.5 * m * v * v }) }; },
      r => { const k = r.pick([100, 200, 400]), x = r.pick([0.10, 0.20]), m = r.pick([0.5, 1.0, 2.0]), E = 0.5 * k * x * x, h = E / (m * G);
        if (h < 0.05) return null;
        return { sys: '台車とばねと地球', text: `なめらかな水平面上で、ばね定数 ${k} N/m のばねを ${fv(x, 2)} m 縮め、質量 ${fv(m)} kg の台車を押しあてて静かに放した。台車はなめらかな斜面を上った（重力加速度 9.8 m/s²）。`, ask: '台車は水平面から何 m の高さまで上がるか。',
          value: h, unit: 'm', scene: SC.slope({ up: true, spring: true, toTop: true, hlabel: '?' }),
          explain: [`ばねのエネルギー ½ × ${k} × ${fv(x, 2)}² = ${J(E)}`, `いちばん高いところでは一瞬止まるので、これがすべて重力による位置エネルギーになる`, `${fv(m)} × 9.8 × h = ${f2(E)} より h = ${f2(h)} m`],
          ec: eChart({ Us: E }, { Ug: E }, null, ['放す前', 'いちばん高いところ']) }; },
    ],
    F: [
      r => { const m = r.pick([1.0, 2.0, 4.0]), v = r.pick([2, 3, 4, 5, 6]), F = r.pick([1, 2, 4, 5]), E = 0.5 * m * v * v, d = E / F;
        return { sys: '物体', text: `水平面上を速さ ${fv(v)} m/s ですべってきた質量 ${fv(m)} kg の物体が、粗い面に入って止まった。粗い面から受ける摩擦力の大きさは ${fv(F)} N で一定だった。`, ask: '粗い面に入ってから止まるまでにすべった距離は何 m か。',
          value: d, unit: 'm', scene: SC.flat({ obj: 'block', from: 16, to: 64, rough: [28, 82], v0: `${fv(v)} m/s`, toLabel: '止まる' }),
          explain: [`運動エネルギー ½ × ${fv(m)} × ${fv(v)}² = ${J(E)}`, `摩擦力の仕事 −${fv(F)} × d で、これがすべて 0 になる`, `${fv(F)} × d = ${f2(E)} より d = ${f2(d)} m`],
          ec: eChart({ K: E }, { K: 0 }, { W: -E, by: '摩擦力' }) }; },
      r => { const m = r.pick([1.0, 2.0, 5.0]), v = r.pick([2, 4, 6]), d = r.pick([2.0, 4.0, 5.0, 8.0]), E = 0.5 * m * v * v, F = E / d;
        return { sys: '物体', text: `水平面上を速さ ${fv(v)} m/s ですべってきた質量 ${fv(m)} kg の物体が、粗い面に入り、${fv(d)} m すべって止まった。`, ask: '物体が粗い面から受けた摩擦力の大きさは何 N か（一定とする）。',
          value: F, unit: 'N', scene: SC.flat({ obj: 'block', from: 16, to: 66, rough: [28, 70], v0: `${fv(v)} m/s`, dlabel: `${fv(d)} m` }),
          explain: [`運動エネルギー ½ × ${fv(m)} × ${fv(v)}² = ${J(E)}`, `摩擦力の仕事 −F × ${fv(d)} がこれを 0 にする`, `F × ${fv(d)} = ${f2(E)} より F = ${f2(F)} N`],
          ec: eChart({ K: E }, { K: 0 }, { W: -E, by: '摩擦力' }) }; },
      r => { const m = r.pick([1.0, 2.0]), h = r.pick([0.5, 1.0, 2.0]), F = r.pick([2.0, 4.9, 9.8]), E = m * G * h, d = E / F;
        return { sys: '物体と地球', text: `高さ ${fv(h)} m のなめらかな斜面の上で、質量 ${fv(m)} kg の物体を静かに放した。物体は斜面をすべり下り、水平な粗い面に入って止まった。粗い面から受ける摩擦力の大きさは ${fv(F)} N で一定だった（重力加速度 9.8 m/s²）。`, ask: '粗い面に入ってから止まるまでにすべった距離は何 m か。',
          value: d, unit: 'm', scene: SC.slope({ to: 74, rough: [50, 92], hlabel: `${fv(h)} m`, toLabel: '止まる' }),
          explain: [`はじめの重力による位置エネルギー ${fv(m)} × 9.8 × ${fv(h)} = ${J(E)}`, `斜面の下で運動エネルギー ${J(E)}。摩擦力の仕事 −${fv(F)} × d がこれを 0 にする`, `${fv(F)} × d = ${f2(E)} より d = ${f2(d)} m`],
          ec: eChart({ Ug: E }, { K: 0 }, { W: -E, by: '摩擦力' }, ['はじめ', '止まったとき']) }; },
      r => { const F = r.pick([2.0, 3.0, 5.0, 10]), d = r.pick([1.5, 2.0, 4.0, 6.0]), W = -F * d, m = r.pick([1.0, 2.0]);
        return { sys: '物体', text: `粗い水平面上をすべる質量 ${fv(m)} kg の物体が、${fv(d)} m すべるあいだ、大きさ ${fv(F)} N の摩擦力を受け続けた。`, ask: 'このあいだに摩擦力が物体にした仕事は何 J か（負の仕事なら − をつける）。',
          value: W, unit: 'J', scene: SC.flat({ obj: 'block', from: 20, to: 70, rough: [12, 84], dlabel: `${fv(d)} m` }),
          explain: ['摩擦力は運動と逆向きなので、仕事は負', `W = −${fv(F)} × ${fv(d)} = ${J(W)}`], ec: null }; },
    ],
  };

  function genCalc(r, unit) {
    let c = null, tries = 0;
    while (!c && tries++ < 20) c = r.pick(CALC[unit])(r);
    return { unit, sys: c.sys, text: c.text, ask: c.ask, chart: null, scene: c.scene,
      answer: { kind: 'num', value: c.value, tol: 0.03, unit: c.unit, show: f2(c.value) },
      explain: c.explain, explainChart: c.ec };
  }

  /* ---------- 入口 ---------- */
  // 種類の記号: L<段><単元>  例 L2K, L5C。お金は L1M
  function typeOf(level, unit) { return level === 1 ? 'L1M' : `L${level}${unit}`; }
  function available(level, units) {
    if (level === 1) return ['M'];
    return units.filter(u => !(level === 4 && u === 'K' && false));
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
    q.qid = `${type}-${seed}`; q.type = type; q.level = level;
    if (q.unit === undefined) q.unit = unit;
    return q;
  }
  function make(level, units, seed) {
    const s = seed || newSeed();
    const r = rng(s);
    const us = available(level, units);
    const u = level === 1 ? 'M' : us[Math.floor(r.f() * us.length)];
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

  return { make, regen, quiz, check, fmtIn, fmtAns, UNITS, LEVELS, available, rng, f2, newSeed, _SCEN: SCEN, _CALC: CALC };
});
