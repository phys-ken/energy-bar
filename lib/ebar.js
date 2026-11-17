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

  // 合計の棒の名前は「力学的エネルギー」（2 行）。文と図の言葉をそろえる（先生の決定 2026-11-16）
  const ENERGY = { keys: ['K', 'Us', 'Ug'], names: { K: '運動', Us: 'ばね', Ug: '重力', sum: '力学的\nエネルギー' }, unit: 'J', sys: ['系の外', '系'] };
  const MONEY = { keys: ['wallet', 'bank'], names: { wallet: '財布', bank: '貯金箱', sum: '合計' }, unit: '円', sys: ['外', '自分のお金'] };

  const LW = { guide: 0.2, thin: 0.3, obj: 0.45, thick: 0.9 };
  // opt.lwk: 線をまとめて太くする（教室の後ろから見る画面）。既定は 1
  const scaleLW = k => { const o = {}; for (const key in LW) o[key] = LW[key] * k; return o; };

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
    // 黒い背景（シミュレーションを黒板に映す）。線と字はチョークの白、答え（予想）は黄色
    chalk: {
      ink: '#f2f2ea', grey: '#c9cec5', guide: '#9aa196', bg: '#0e1210',
      fill: () => '#5aa0e6',
      sumFill: '#ffb3c7', sumStroke: '#ff5c8a', partStroke: '#f2f2ea',
      answer: '#ffd84d', work: '#f2f2ea', workFill: '#0e1210', mono: false,
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
    const halo = o.halo ? ` stroke="${o.haloC || '#fff'}" stroke-width="${n2(fs * 0.25)}" stroke-linejoin="round" paint-order="stroke"` : '';
    return `<text x="${n2(x)}" y="${n2(y)}" font-family="${fam}" font-size="${fs}" text-anchor="${o.anchor || 'middle'}"` +
      ` fill="${o.color || '#111'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${halo}>${esc(s)}</text>`;
  }
  // 式（「½mv₀²」「−μ′mgx」）: 英字だけ斜体にする（物理量の記号は斜体）。数字・記号は立体のまま
  // 「_A」は 1 文字の添え字（h_A → h の右下に小さく A）。添え字は立体
  function mathTxt(x, y, s, o = {}) {
    const fs = o.fs || 4.6, d = n2(fs * 0.28);
    let cur = 0;
    const parts = String(s).split(/(_.|[A-Za-zμ]+)/).filter(p => p !== '').map(p => {
      if (p[0] === '_') { const r = `<tspan dy="${n2(d - cur)}" font-size="${n2(fs * 0.7)}">${esc(p[1])}</tspan>`; cur = d; return r; }
      const back = cur ? ` dy="${n2(-cur)}"` : ''; cur = 0;
      return /^[A-Za-zμ]+$/.test(p) ? `<tspan${back} font-style="italic">${esc(p)}</tspan>` : `<tspan${back}>${esc(p)}</tspan>`;
    }).join('');
    return txt(x, y, '\u0001', o).replace('\u0001', parts);
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
    // opt.keys: 系に入れたものの棒だけ描く（シミュレーションで系を選ぶ。ばねを系の外にすると「ばね」の棒はない）
    const K0 = opt.kind === 'money' ? MONEY : ENERGY;
    const K = opt.keys ? Object.assign({}, K0, { keys: opt.keys }) : K0;
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
    // labels: 数値のかわりに式（「mgh」）を書く（問題バンクの文字式の問題の解説用）。式の幅もはみ出さないように数える
    const labelMax = Math.max(0, ...states.flatMap(s => Object.values(s.labels || {})).map(t => textW(t, fs)));
    const over = Math.max(0, (Math.max(textW(fmtNum(maxAbs) + ' ' + K.unit, fs), labelMax) - bw) / 2 + 0.4);
    // 棒の名前も切れないように（右端の「力学的／エネルギー」は棒より広い）
    const nameLines = s => String(s).split('\n');
    const nameRows = Math.max(...Object.values(K.names).map(s => nameLines(s).length));
    const overName = Math.max(...nameLines(K.names.sum).map(t => (textW(t, fsName) - bw) / 2 + 0.4), 0);
    const padL = Math.max(2.2, over), padR = Math.max(2.2, over, overName), nb = K.keys.length;
    const panelW = padL + nb * bw + (nb - 1) * gap + 2 * sepGap + bw + padR;
    // blank: 紙の「かく」で、矢印を生徒が描く欄（境の線と場面のあいだの空きだけ用意して、矢印は描かない）
    // 場面のあいだの仕事は 1 つ、または配列で複数（「引く力 +64 J」と「摩擦力 −28 J」を並べる）
    // ghost: 場所だけとって描かない（シミュレーションで仕事が 0 のあいだ。矢印が出たとき図の幅が変わらないように）
    const arrows = works.map(w => (Array.isArray(w) ? w : [w]).filter(x => x && (x.W || x.hide || x.ghost)));
    const hasWork = works.some(w => (Array.isArray(w) ? w : [w]).some(x => x && (x.W || x.hide || x.blank || x.ghost)));
    // 仕事の文（「手が支える力が／負の仕事をした」）が、両側の棒の数値と重ならない幅をとる
    // opt.gapText: 選択肢どうしで幅をそろえるときの、いちばん長い仕事の文（矢印のない選択肢も同じ幅・同じ大きさで描く）
    const fsW = opt.fsWork || 3.3;
    const linesW = t => Math.max(0, ...String(t || '').split('\n').map(s => textW(s, fsW)));
    // 下の chart() の矢印の箱と同じ文字（数と単位のあいだは細い空白 U+2009）
    // fmt: 'sig2' なら棒の数値と同じく有効数字 2 桁（「+5.0 J」。「+5 J」と出ていた）
    const fmtW = v => opt.fmt === 'sig2' ? (v >= 100 ? String(Math.round(v)) : (t => v < 10 && !t.includes('.') ? t + '.0' : t)(String(+v.toPrecision(2)))) : fmtNum(v);
    const workLabel = w => w.hide ? '? ' + K.unit : w.label != null ? String(w.label) : (w.W > 0 ? '+' : MINUS) + fmtW(Math.abs(w.W)) + ' ' + K.unit;
    // 式（w.label）は太字の斜体で幅が広いので 1.25 倍に見積もる（「+mgh」が箱からはみ出した）
    // opt.fsBox: 矢印の箱の数値の大きさ（既定は棒の数値と同じ）
    const fsB = opt.fsBox || fs;
    const boxW = w => Math.max(textW(workLabel(w), fsB) * (w.label != null ? 1.25 : 1) + 3.2, 13);
    const arrowW = w => Math.max(linesW(w.text), boxW(w));
    const multiW = l => l.reduce((a, w) => a + arrowW(w), 0) + 4 * (l.length - 1);
    const textMax = Math.max(linesW(opt.gapText), ...works.map(w => (Array.isArray(w) ? [] : [w]).filter(x => x && x.text).map(x => linesW(x.text))).flat());
    const multiMax = Math.max(0, ...arrows.filter(l => l.length > 1).map(multiW));
    const workGap = opt.workGap || (hasWork ? Math.max(26, textMax + fs * 2.2, multiMax + fs * 2.2) : 8);
    const sysBand = hasWork ? 15 : 0;
    const top = 2 + sysBand + fsTitle + 3.5 + fs + 2;
    const baseY = top + unitsUp * mpu;
    const bottom = baseY + unitsDown * mpu + (unitsDown ? fs + 1 : 0) + 2.2 + fsName * (1 + 1.15 * (nameRows - 1)) + 1.5;
    const W = states.length * panelW + (states.length - 1) * workGap;
    const xPanel = i => i * (panelW + workGap);
    const barX = (i, j) => j < nb ? xPanel(i) + padL + j * (bw + gap) : xPanel(i) + padL + nb * bw + (nb - 1) * gap + 2 * sepGap;
    return { K, unit, mpu, fs, fsB, fsName, fsTitle, works, arrows, workLabel, boxW, arrowW, multiW, sums, unitsUp, unitsDown, bw, gap, sepGap, padL, nb, panelW, hasWork, workGap, sysBand, top, baseY, bottom, W, H: bottom + 0.5, xPanel, barX };
  }

  function chart(states, opt = {}) {
    const T = THEMES[opt.theme || 'mono'];
    const LW = scaleLW(opt.lwk || 1);
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
          const sym = s.labels && s.labels[b.k] != null ? String(s.labels[b.k]) : null;
          const label = hidden ? '?' : sym != null ? sym : fmtV(b.v);
          // 式は g・添え字が下にはみ出すので、少し上げる（棒の上の線が白い縁取りで消えた）
          const y = hidden || b.v >= 0 ? baseY - (hidden ? 0 : h) - (sym != null ? 2.4 : 1.4) : baseY - h + fs * 0.95;
          const o = { fs, halo: true, haloC: T.bg, color: ans ? T.answer : T.ink, weight: ans ? 'bold' : null };
          g += sym != null && !hidden ? mathTxt(b.x + bw / 2, y, label, o) : txt(b.x + bw / 2, y, label, o);
        }
        String(K.names[b.k]).split('\n').forEach((t, r) =>
          g += txt(b.x + bw / 2, baseY + L.unitsDown * mpu + (L.unitsDown ? fs + 1 : 0) + 2.0 + fsName * (0.85 + 1.15 * r), t,
            { ja: true, fs: fsName, color: T.ink, weight: isSum ? 'bold' : null }));
      });
      g += line(x0, baseY, x0 + panelW, baseY, T.ink, LW.obj);
      if (i < states.length - 1 && !L.hasWork)
        g += line(x0 + panelW + L.workGap / 2, top - 4, x0 + panelW + L.workGap / 2, L.bottom, T.guide, LW.guide);
    });
    // opt.arrowK: 矢印の線と矢じりを太く・大きく。opt.workDepth: 矢印の先（下の端）の深さ（目盛りの高さに対する割合）
    const ak = opt.arrowK || 1;
    L.arrows.forEach((list, i) => list.forEach((w, j) => {
      if (w.ghost) return;
      // 1 本なら場面のあいだの真ん中。複数なら横に並べる
      let cx = L.xPanel(i) + panelW + L.workGap / 2;
      if (list.length > 1) cx += -L.multiW(list) / 2 + list.slice(0, j).reduce((a, x) => a + L.arrowW(x) + 4, 0) + L.arrowW(w) / 2;
      const label = L.workLabel(w);
      const bwid = L.boxW(w), bh = L.fsB + 2.4, yBox = 1.2;
      const yIn = top + L.unitsUp * mpu * (opt.workDepth || 0.35);
      const col = w.answer ? T.answer : T.work;
      if (!w.hide) {
        if (w.W > 0) g += arrow(cx, yBox + bh, cx, yIn, col, LW.thick * ak, 2.6 * ak);
        else g += arrow(cx, yIn, cx, yBox + bh, col, LW.thick * ak, 2.6 * ak);
      } else g += line(cx, yBox + bh, cx, yIn, col, LW.thick, '1.6 1.2');   // 向きも答えさせるときは線だけ
      g += rect(cx - bwid / 2, yBox, bwid, bh, T.workFill, col, LW.obj);
      g += (w.label != null && !w.hide ? mathTxt : txt)(cx, yBox + bh - 1.5, label, { fs: L.fsB, color: col, weight: 'bold' });
      if (w.text) String(w.text).split('\n').forEach((t, k) =>
        g += txt(cx, yIn + 1.3 * (opt.fsWork || 3.3) + k * 1.15 * (opt.fsWork || 3.3), t, { ja: true, fs: opt.fsWork || 3.3, color: col, halo: true, haloC: T.bg }));
    }));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(L.W)}mm" height="${n2(L.H)}mm" viewBox="0 0 ${n2(L.W)} ${n2(L.H)}">` +
      (opt.bg !== false ? `<rect x="0" y="0" width="${n2(L.W)}" height="${n2(L.H)}" fill="${T.bg || '#fff'}"/>` : '') + g + (opt.extra || '') + '</svg>';
    return svg;
  }

  return { chart, layout, THEMES, ENERGY, MONEY, LW, setFonts, txt, line, rect, arrow, esc, n2, fmtNum, MINUS };
});
