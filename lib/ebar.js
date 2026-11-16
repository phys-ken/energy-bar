/* エネルギー棒グラフ（バーチャート）の描画。アプリ（ブラウザ）と Word 用の図（Node → rsvg-convert）の両方がこれを使う。
 * 決まりは docs/decisions.md の 2・3。要点:
 *  - 棒はストックだけ: 運動・ばね・重力 ｜ 合計。いつも 4 本、0 J も「0 J」と書く。
 *  - 仕事（フロー）は棒にしない。場面のあいだで「系の外｜系」の境を横切る矢印。正は下向き（入る）、負は上向き（出る）。
 *  - 合計は描き分ける: 白黒は「白抜き＋太枠」、ほかは「薄い灰色＋細枠」。合計の名前は太字。
 *  - 赤（カラー）／太字（白黒）は「答えで書き足したもの」だけ。
 *  - 負の値（基準面より下の重力）は基準線より下へ伸ばす（シミュレーション用）。
 * 単位は mm（印刷の実寸）。SVG の width/height も mm。アプリでは CSS で幅を合わせる。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EBar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENERGY = { keys: ['K', 'Us', 'Ug'], names: { K: '運動', Us: 'ばね', Ug: '重力', sum: '合計' }, unit: 'J', sys: ['系の外', '系'] };
  const MONEY = { keys: ['wallet', 'bank'], names: { wallet: '財布', bank: '貯金箱', sum: '合計' }, unit: '円', sys: ['外', '自分のお金'] };

  const LW = { guide: 0.2, thin: 0.3, obj: 0.45, thick: 0.9 };

  const THEMES = {
    mono: {
      ink: '#111111', grey: '#777777', guide: '#9a9a9a',
      fill: () => '#d4d4d4',
      sumFill: '#ffffff', sumStroke: '#111111', partStroke: '#111111',
      answer: '#111111', work: '#111111', workFill: '#ffffff', mono: true,
    },
    color: {
      ink: '#1b1b1b', grey: '#6b6b6b', guide: '#a8a8a8',
      // 色は 2 種類だけ: それぞれのエネルギー（運動・ばね・重力、財布・貯金箱）は同じ青、合計（力学的エネルギー）は桃色の太枠。
      // 元のプリントと同じ。棒ごとに色を変えるとちかちかする（先生の指摘 2026-11-16）
      fill: () => '#4a86b8',
      sumFill: '#f6c9d4', sumStroke: '#b8284f', partStroke: '#1b1b1b',
      answer: '#d0202a', work: '#1b1b1b', workFill: '#ffffff', mono: false,
    },
  };

  // 書体: 印刷（Word）は数字が Latin Modern・日本語が原ノ味（Obsidian のメモ）。
  // アプリは画面と同じ書体 1 つにそろえる（setFonts）。問題文と図で書体が変わると読みにくい（先生の指摘 2026-11-16）
  let FONT_NUM = "'Latin Modern Roman', 'LM Roman 10', 'Times New Roman', serif";
  let FONT_JA = "'Harano Aji Gothic', '原ノ味角ゴシック', 'BIZ UDPGothic', 'Hiragino Sans', 'Noto Sans JP', sans-serif";
  function setFonts(both) { FONT_NUM = both; FONT_JA = both; }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const n2 = x => +(+x).toFixed(2);
  const MINUS = '−';
  const fmtNum = v => {
    const r = Math.round(v * 1000) / 1000;
    return (r < 0 ? MINUS : '') + String(Math.abs(r));
  };
  const textW = (s, fs) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 && c !== ' ' && c !== MINUS ? fs : fs * 0.52), 0);

  function txt(x, y, s, o = {}) {
    const fs = o.fs || 4.6;
    const fam = o.ja ? FONT_JA : FONT_NUM;
    const halo = o.halo ? ` stroke="#fff" stroke-width="${n2(fs * 0.25)}" stroke-linejoin="round" paint-order="stroke"` : '';
    return `<text x="${n2(x)}" y="${n2(y)}" font-family="${fam}" font-size="${fs}" text-anchor="${o.anchor || 'middle'}"` +
      ` fill="${o.color || '#111'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${halo}>${esc(s)}</text>`;
  }
  const line = (x1, y1, x2, y2, c, w, dash) =>
    `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const rect = (x, y, w, h, fill, stroke, sw) =>
    `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(Math.max(w, 0))}" height="${n2(Math.max(h, 0))}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  function arrow(x1, y1, x2, y2, c, w, L) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    const bx = x2 - ux * L, by = y2 - uy * L, hw = L * 0.42;
    return line(x1, y1, bx + ux * 0.2, by + uy * 0.2, c, w) +
      `<polygon points="${n2(x2)},${n2(y2)} ${n2(bx - uy * hw)},${n2(by + ux * hw)} ${n2(bx + uy * hw)},${n2(by - ux * hw)}" fill="${c}"/>`;
  }

  const asSet = (v, all) => v === true ? new Set(all) : new Set(v || []);

  /**
   * layout(states, opt) と chart(states, opt)
   * states: [{ title, K, Us, Ug, hide, answer }]（お金は kind:'money' で wallet, bank）
   *   hide: true | ['K','sum',…] … 棒を描かず数値を「?」に
   *   answer: true | [...] … 答えで書き足した棒（カラー赤、白黒は数値を太字）
   *   blank: true … 棒も数値も描かない（記入用の空欄。名前と基準線は描く）
   * opt.works: [{ W, text, hide, answer, blank }] … 場面のあいだの仕事（null は仕事なし。blank は矢印を描く空欄）
   * opt.kind: 'energy' | 'money'。opt.unit: 1 目盛り（既定 10）。opt.mmPerUnit。opt.max / opt.min（目盛りの範囲）
   * opt.grid / opt.ref / opt.values(false で数値なし) / opt.theme / opt.fs / opt.fsName / opt.fsTitle
   */
  function layout(states, opt = {}) {
    const K = opt.kind === 'money' ? MONEY : ENERGY;
    const unit = opt.unit || 10, mpu = opt.mmPerUnit || 4.2;
    const fs = opt.fs || 4.6, fsName = opt.fsName || 3.9, fsTitle = opt.fsTitle || 5.0;
    const works = opt.works || [];
    const sums = states.map(s => K.keys.reduce((a, k) => a + (+s[k] || 0), 0));
    const vals = states.flatMap((s, i) => [...K.keys.map(k => +s[k] || 0), sums[i]]);
    const maxV = Math.max(opt.max || 0, ...vals, unit);
    const minV = Math.min(opt.min || 0, ...vals, 0);
    const unitsUp = Math.ceil(maxV / unit - 1e-9), unitsDown = Math.ceil(-minV / unit - 1e-9);
    const bw = opt.barW || 7.0, gap = opt.barGap || 3.6, sepGap = opt.sepGap || 4.0;
    // 端の棒の数値（「100 J」）が図の外にはみ出して切れないよう、数値の幅に合わせて左右をあける
    const maxAbs = Math.max(Math.abs(maxV), Math.abs(minV));
    const over = Math.max(0, (textW(fmtNum(maxAbs) + ' ' + K.unit, fs) - bw) / 2 + 0.4);
    const padL = Math.max(2.2, over), padR = Math.max(2.2, over), nb = K.keys.length;
    const panelW = padL + nb * bw + (nb - 1) * gap + 2 * sepGap + bw + padR;
    // blank: 紙の「かく」で、矢印を生徒が描く欄（境の線と場面のあいだの空きだけ用意して、矢印は描かない）
    const hasWork = works.some(w => w && (w.W || w.hide || w.blank));
    // 仕事の文（「手が支える力が／負の仕事をした」）が、両側の棒の数値と重ならない幅をとる
    // opt.gapText: 選択肢どうしで幅をそろえるときの、いちばん長い仕事の文（矢印のない選択肢も同じ幅・同じ大きさで描く）
    const textMax = Math.max(0, ...[...works.filter(w => w && w.text).map(w => w.text), opt.gapText || ''].flatMap(t => String(t).split('\n')).map(t => textW(t, opt.fsWork || 3.3)));
    const workGap = opt.workGap || (hasWork ? Math.max(26, textMax + fs * 2.2) : 8);
    const sysBand = hasWork ? 15 : 0;
    const top = 2 + sysBand + fsTitle + 3.5 + fs + 2;
    const baseY = top + unitsUp * mpu;
    const bottom = baseY + unitsDown * mpu + (unitsDown ? fs + 1 : 0) + 2.2 + fsName + 1.5;
    const W = states.length * panelW + (states.length - 1) * workGap;
    const xPanel = i => i * (panelW + workGap);
    const barX = (i, j) => j < nb ? xPanel(i) + padL + j * (bw + gap) : xPanel(i) + padL + nb * bw + (nb - 1) * gap + 2 * sepGap;
    return { K, unit, mpu, fs, fsName, fsTitle, works, sums, unitsUp, unitsDown, bw, gap, sepGap, padL, nb, panelW, hasWork, workGap, sysBand, top, baseY, bottom, W, H: bottom + 0.5, xPanel, barX };
  }

  function chart(states, opt = {}) {
    const T = THEMES[opt.theme || 'mono'];
    const L = layout(states, opt);
    const { K, unit, mpu, fs, fsName, fsTitle, works, sums, baseY, top, panelW, bw, nb } = L;
    const sig2 = v => { if (v === 0) return '0'; const a = Math.abs(v); let t = a >= 100 ? String(Math.round(a)) : String(+a.toPrecision(2)); if (a < 10 && !t.includes('.') && opt.fmt === 'sig2') t += '.0'; return (v < 0 ? MINUS : '') + t; };
    const fmtV = v => (opt.fmt === 'sig2' ? sig2(v) : fmtNum(v)) + ' ' + K.unit;
    let g = '';
    if (L.hasWork) {
      const yb = 2 + L.sysBand - 2.5;
      g += line(0, yb, L.W, yb, T.guide, LW.guide, '1.2 0.9');
      // 線の上に「系の外」だけ書く（線の下に「系」と書くと、場面の名前と重なる）
      g += txt(0.5, yb - 1.4, K.sys[0], { ja: true, fs: opt.fsWork || 3.4, anchor: 'start', color: T.grey });
    }
    states.forEach((s, i) => {
      const x0 = L.xPanel(i);
      const all = [...K.keys, 'sum'];
      const hideSet = asSet(s.hide, all), ansSet = asSet(s.answer, all);
      g += txt(x0 + panelW / 2, 2 + L.sysBand + fsTitle, s.title || '', { ja: true, fs: fsTitle, weight: 'bold', color: T.ink });
      if (opt.grid) for (let u = -L.unitsDown; u <= L.unitsUp; u++) if (u)
        g += line(x0 + 0.5, baseY - u * mpu, x0 + panelW - 0.5, baseY - u * mpu, T.guide, LW.guide, '0.6 0.8');
      if (opt.ref && i > 0 && !states[0].blank && !asSet(states[0].hide, all).has('sum')) {
        const yr = baseY - sums[0] / unit * mpu;
        g += line(x0 + 0.5, yr, x0 + panelW - 0.5, yr, T.grey, LW.guide * 1.5, '1.4 1.0');
      }
      const xs = L.barX(i, nb) - L.sepGap;
      g += line(xs, top - 1, xs, baseY + L.unitsDown * mpu, T.guide, LW.guide, '1.0 0.8');
      const bars = K.keys.map((k, j) => ({ k, x: L.barX(i, j), v: +s[k] || 0 }));
      bars.push({ k: 'sum', x: L.barX(i, nb), v: sums[i] });
      bars.forEach(b => {
        const isSum = b.k === 'sum', hidden = hideSet.has(b.k) || s.blank, ans = ansSet.has(b.k);
        const h = b.v / unit * mpu;       // 負なら下向き
        const yTop = Math.min(baseY, baseY - h), hh = Math.abs(h);
        const stroke = ans && !T.mono ? T.answer : (isSum ? T.sumStroke : T.partStroke);
        if (!hidden && b.v !== 0) {
          if (isSum) g += rect(b.x + LW.thick / 2, yTop + (h > 0 ? LW.thick / 2 : 0), bw - LW.thick, hh - LW.thick / 2, T.sumFill, stroke, LW.thick);
          else g += rect(b.x, yTop, bw, hh, T.fill(b.k), stroke, LW.thin);
        }
        if (opt.values !== false && !s.blank) {
          const label = hidden ? '?' : fmtV(b.v);
          const y = hidden || b.v >= 0 ? baseY - (hidden ? 0 : h) - 1.4 : baseY - h + fs * 0.95;
          g += txt(b.x + bw / 2, y, label, { fs, halo: true, color: ans ? T.answer : T.ink, weight: ans ? 'bold' : null });
        }
        g += txt(b.x + bw / 2, baseY + L.unitsDown * mpu + (L.unitsDown ? fs + 1 : 0) + 2.0 + fsName * 0.85, K.names[b.k],
          { ja: true, fs: fsName, color: T.ink, weight: isSum ? 'bold' : null });
      });
      g += line(x0, baseY, x0 + panelW, baseY, T.ink, LW.obj);
      if (i < states.length - 1 && !L.hasWork)
        g += line(x0 + panelW + L.workGap / 2, top - 4, x0 + panelW + L.workGap / 2, L.bottom, T.guide, LW.guide);
    });
    works.forEach((w, i) => {
      if (!w || w.blank || !(w.W || w.hide)) return;
      const cx = L.xPanel(i) + panelW + L.workGap / 2;
      const label = w.hide ? '? ' + K.unit : (w.W > 0 ? '+' : MINUS) + fmtNum(Math.abs(w.W)) + ' ' + K.unit;
      const bwid = Math.max(textW(label, fs) + 3.2, 13), bh = fs + 2.4, yBox = 1.2;
      const yIn = top + L.unitsUp * mpu * 0.35;
      const col = w.answer ? T.answer : T.work;
      if (!w.hide) {
        if (w.W > 0) g += arrow(cx, yBox + bh, cx, yIn, col, LW.thick, 2.6);
        else g += arrow(cx, yIn, cx, yBox + bh, col, LW.thick, 2.6);
      } else g += line(cx, yBox + bh, cx, yIn, col, LW.thick, '1.6 1.2');   // 向きも答えさせるときは線だけ
      g += rect(cx - bwid / 2, yBox, bwid, bh, T.workFill, col, LW.obj);
      g += txt(cx, yBox + bh - 1.5, label, { fs, color: col, weight: 'bold' });
      if (w.text) String(w.text).split('\n').forEach((t, k) =>
        g += txt(cx, yIn + 1.3 * (opt.fsWork || 3.3) + k * 1.15 * (opt.fsWork || 3.3), t, { ja: true, fs: opt.fsWork || 3.3, color: col, halo: true }));
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(L.W)}mm" height="${n2(L.H)}mm" viewBox="0 0 ${n2(L.W)} ${n2(L.H)}">` +
      (opt.bg !== false ? `<rect x="0" y="0" width="${n2(L.W)}" height="${n2(L.H)}" fill="#fff"/>` : '') + g + (opt.extra || '') + '</svg>';
    return svg;
  }

  return { chart, layout, THEMES, ENERGY, MONEY, LW, setFonts, txt, line, rect, arrow, esc, n2, fmtNum, MINUS };
});
