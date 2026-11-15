/* エネルギー棒グラフ（バーチャート）の描画。アプリ（ブラウザ）と Word 用の図（Node → rsvg-convert）の両方がこれを使う。
 *
 * 決まり（先生と決めたこと）
 *  - 棒はエネルギー（ストック）だけ: 運動・ばね・重力 ｜ 合計。いつも 4 本、0 J も「0 J」と書く。
 *  - 仕事（フロー）は棒にしない。場面と場面のあいだに、上の「系の外」から入る矢印（＋）／外へ出る矢印（−）で表す。
 *  - 合計は、ほかの 3 本と描き分ける: 白黒では「白抜き＋太枠」、ほかの 3 本は「薄い灰色＋細枠」。
 *  - 赤（カラー）／太字（白黒）は「答えで書き足したもの」だけ。
 *
 * 単位は mm（印刷したときの実寸）。SVG の width/height も mm で出す。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EBar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEYS = ['K', 'Us', 'Ug'];
  const NAMES = { K: '運動', Us: 'ばね', Ug: '重力', sum: '合計' };

  // 線の太さ（Obsidian のメモ: 補助線 0.2・物 0.45・力の矢印 0.9 mm）
  const LW = { guide: 0.2, thin: 0.3, obj: 0.45, thick: 0.9 };

  const THEMES = {
    mono: {
      ink: '#111111', grey: '#777777', guide: '#9a9a9a',
      fill: { K: '#d4d4d4', Us: '#d4d4d4', Ug: '#d4d4d4' },
      sumFill: '#ffffff', sumStroke: '#111111',
      partStroke: '#111111',
      answer: '#111111', answerWeight: 'bold',
      work: '#111111', workFill: '#ffffff',
    },
    color: {
      ink: '#1b1b1b', grey: '#6b6b6b', guide: '#a8a8a8',
      fill: { K: '#3d7fb3', Us: '#3f9e68', Ug: '#d98f1e' },
      sumFill: '#f6c9d4', sumStroke: '#b8284f',
      partStroke: '#1b1b1b',
      answer: '#d0202a', answerWeight: 'bold',
      work: '#1b1b1b', workFill: '#ffffff',
    },
  };

  const FONT_NUM = "'Latin Modern Roman', 'LM Roman 10', 'Times New Roman', serif";
  const FONT_JA = "'Harano Aji Gothic', '原ノ味角ゴシック', 'Hiragino Sans', 'Noto Sans JP', sans-serif";

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const n2 = x => +(+x).toFixed(2);
  const MINUS = '−';
  const fmtJ = v => (v < 0 ? MINUS : '') + String(Math.abs(v)) + ' J';

  // 文字列の幅の見積もり（mm）。全角は 1 字 = fs、半角は 0.5 fs
  const textW = (s, fs) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 && c !== ' ' && c !== MINUS ? fs : fs * 0.52), 0);

  function txt(x, y, s, o = {}) {
    const fs = o.fs || 4.6;
    const fam = o.ja ? FONT_JA : FONT_NUM;
    const anchor = o.anchor || 'middle';
    const halo = o.halo ? ` stroke="#fff" stroke-width="${n2(fs * 0.25)}" stroke-linejoin="round" paint-order="stroke"` : '';
    return `<text x="${n2(x)}" y="${n2(y)}" font-family="${fam}" font-size="${fs}" text-anchor="${anchor}"` +
      ` fill="${o.color || '#111'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${halo}>${esc(s)}</text>`;
  }
  const line = (x1, y1, x2, y2, c, w, dash) =>
    `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="butt"/>`;
  const rect = (x, y, w, h, fill, stroke, sw, dash) =>
    `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

  // 矢じりつきの矢印（太さ w、矢じりの長さ L）
  function arrow(x1, y1, x2, y2, c, w, L) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    const bx = x2 - ux * L, by = y2 - uy * L, hw = L * 0.42;
    return line(x1, y1, bx + ux * 0.2, by + uy * 0.2, c, w) +
      `<polygon points="${n2(x2)},${n2(y2)} ${n2(bx - uy * hw)},${n2(by + ux * hw)} ${n2(bx + uy * hw)},${n2(by - ux * hw)}" fill="${c}"/>`;
  }

  /**
   * chart(states, opt) → SVG 文字列
   * states: [{ title:'まえ', K:20, Us:0, Ug:40, hide:false|true|['K',…], answer:false|true|['K',…] }, …]
   *   hide   … その棒を描かず、値の欄を「?」にする（問題用）。true なら 4 本とも。
   *   answer … 解説で書き足した棒（カラーは赤、白黒は数値を太字）
   * opt.works: 場面のあいだの仕事 [{ W:30, text:'仕事をされた' }, …]（states.length-1 個。null は仕事なし）
   * opt.unit : 1 目盛りの J（既定 10）。opt.mmPerUnit: 1 目盛りの高さ（mm）
   * opt.grid : 目盛りの点線を描く（記入用）。opt.ref: まえの合計の高さに点線をのばす
   * opt.theme: 'mono' | 'color'
   */
  function chart(states, opt = {}) {
    const T = THEMES[opt.theme || 'mono'];
    const unit = opt.unit || 10;
    const mpu = opt.mmPerUnit || 4.2;
    const works = opt.works || [];
    const fs = opt.fs || 4.6;           // 数値（印刷で数字の高さ約 3 mm）
    const fsName = opt.fsName || 3.9;   // 棒の名前（2 字が棒の間隔に収まる大きさ）
    const fsTitle = opt.fsTitle || 5.0; // 場面の名前

    // 縦の大きさ: いちばん大きい値（合計）＋余白
    const sums = states.map(s => KEYS.reduce((a, k) => a + (+s[k] || 0), 0));
    const maxV = Math.max(opt.max || 0, ...sums, unit);
    const units = Math.ceil(maxV / unit);
    const plotH = units * mpu;

    // 横: 3 本 + 区切り + 合計
    const bw = opt.barW || 7.0, gap = opt.barGap || 3.6, sepGap = opt.sepGap || 4.0;
    const padL = 2.2, padR = 2.2;
    const panelW = padL + 3 * bw + 2 * gap + 2 * sepGap + bw + padR;
    const hasWork = works.some(w => w && w.W);
    const workGap = opt.workGap || (hasWork ? 26 : 8);   // 場面のあいだ（仕事の矢印が入る）
    const sysBand = hasWork ? 15 : 0;                    // 上の「系の外」の帯
    const top = 2 + sysBand + fsTitle + 3.5 + fs + 2;    // 場面名と最上の数値の分
    const baseY = top + plotH;
    const bottom = baseY + 2.2 + fsName + 1.5;
    const W = states.length * panelW + (states.length - 1) * workGap;
    const H = bottom + 0.5;

    let g = '';
    const xPanel = i => i * (panelW + workGap);

    // 系の外の帯（仕事があるときだけ）
    if (hasWork) {
      const yb = 2 + sysBand - 2.5;
      g += line(0, yb, W, yb, T.guide, LW.guide, '1.2 0.9');
      g += txt(0.5, yb - 1.4, '系の外', { ja: true, fs: 3.4, anchor: 'start', color: T.grey });
      g += txt(0.5, yb + 4.0, '系', { ja: true, fs: 3.4, anchor: 'start', color: T.grey });
    }

    states.forEach((s, i) => {
      const x0 = xPanel(i);
      const hideSet = s.hide === true ? new Set([...KEYS, 'sum']) : new Set(s.hide || []);
      const ansSet = s.answer === true ? new Set([...KEYS, 'sum']) : new Set(s.answer || []);
      // 場面名
      g += txt(x0 + panelW / 2, 2 + sysBand + fsTitle, s.title || '', { ja: true, fs: fsTitle, weight: 'bold', color: T.ink });
      // 目盛りの点線
      if (opt.grid) for (let u = 1; u <= units; u++)
        g += line(x0 + 0.5, baseY - u * mpu, x0 + panelW - 0.5, baseY - u * mpu, T.guide, LW.guide, '0.6 0.8');
      // まえの合計の高さ
      if (opt.ref && i > 0) {
        const yr = baseY - sums[0] / unit * mpu;
        g += line(x0 + 0.5, yr, x0 + panelW - 0.5, yr, T.grey, LW.guide * 1.5, '1.4 1.0');
      }
      const bars = KEYS.map((k, j) => ({ k, x: x0 + padL + j * (bw + gap), v: +s[k] || 0 }));
      bars.push({ k: 'sum', x: x0 + padL + 3 * bw + 2 * gap + 2 * sepGap, v: sums[i] });
      // 合計の前の区切り
      const xs = x0 + padL + 3 * bw + 2 * gap + sepGap;
      g += line(xs, top - 1, xs, baseY, T.guide, LW.guide, '1.0 0.8');

      bars.forEach(b => {
        const isSum = b.k === 'sum', hidden = hideSet.has(b.k), ans = ansSet.has(b.k);
        const h = b.v / unit * mpu;
        if (!hidden && b.v > 0) {
          if (isSum) g += rect(b.x + LW.thick / 2, baseY - h + LW.thick / 2, bw - LW.thick, h - LW.thick / 2, T.sumFill, ans && opt.theme === 'color' ? T.answer : T.sumStroke, LW.thick);
          else g += rect(b.x, baseY - h, bw, h, T.fill[b.k], ans && opt.theme === 'color' ? T.answer : T.partStroke, LW.thin);
        }
        // 数値（棒の上）。隠すときは「?」
        if (opt.values !== false) {
          const label = hidden ? '?' : fmtJ(b.v);
          const y = baseY - (hidden ? 0 : h) - 1.4;
          g += txt(b.x + bw / 2, y, label, {
            fs, halo: true,
            color: ans ? T.answer : T.ink,
            weight: ans ? T.answerWeight : null,   // 太字は「答え」だけ（白黒で合計と混ざらないように）
          });
        }
        // 名前（基準線の下）
        g += txt(b.x + bw / 2, baseY + 2.0 + fsName * 0.85, NAMES[b.k], { ja: true, fs: fsName, color: T.ink, weight: isSum ? 'bold' : null });
      });
      // 基準線（0 J）
      g += line(x0, baseY, x0 + panelW, baseY, T.ink, LW.obj);
      // 場面の区切り（縦の細線）
      if (i < states.length - 1 && !hasWork)
        g += line(x0 + panelW + workGap / 2, top - 4, x0 + panelW + workGap / 2, bottom, T.guide, LW.guide);
    });

    // 仕事の矢印: 場面のあいだ、系の外の帯を横切る。＋は下向き（入る）、−は上向き（出る）
    works.forEach((w, i) => {
      if (!w || !w.W) return;
      const cx = xPanel(i) + panelW + workGap / 2;
      const yb = 2 + sysBand - 2.5;            // 帯の線
      const label = (w.W > 0 ? '+' : MINUS) + Math.abs(w.W) + ' J';
      const bwid = Math.max(textW(label, fs) + 3.2, 13), bh = fs + 2.4;
      const yBox = 1.2;                          // 箱は帯の上（系の外）
      const yIn = top + plotH * 0.35;           // 矢印の先（系の中）
      const ans = w.answer;
      const col = ans ? T.answer : T.work;
      if (w.W > 0) g += arrow(cx, yBox + bh, cx, yIn, col, LW.thick, 2.6);
      else g += arrow(cx, yIn, cx, yBox + bh, col, LW.thick, 2.6);
      g += rect(cx - bwid / 2, yBox, bwid, bh, T.workFill, col, LW.obj);
      g += txt(cx, yBox + bh - 1.5, label, { fs, color: col, weight: 'bold' });
      if (w.text) {
        // 説明（矢印の横、系の中）。縦書きにせず 2 行まで
        const lines = String(w.text).split('\n');
        lines.forEach((t, k) => g += txt(cx, yIn + 4.2 + k * 3.8, t, { ja: true, fs: 3.3, color: col, halo: true }));
      }
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(W)}mm" height="${n2(H)}mm" viewBox="0 0 ${n2(W)} ${n2(H)}">` +
      (opt.bg !== false ? `<rect x="0" y="0" width="${n2(W)}" height="${n2(H)}" fill="#fff"/>` : '') + g + '</svg>';
  }

  return { chart, THEMES, NAMES, KEYS, LW };
});
