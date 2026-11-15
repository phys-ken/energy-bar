/* 場面の図（台車・ばね・斜面など）。棒グラフと同じ決まり（docs/decisions.md 11）:
 * 物は黒、補助線は灰色の点線、答えは赤／太字。線 0.2・0.45・0.9 mm。
 * 力は作用点（黒丸）から描く。長さ・高さは問題集（リードα）の形: 両矢印の細い直線に数値＋補助線（先生の指摘 2026-11-15。円弧はやめた）。
 * 単位は mm、y は下向き。scene({w, h, items:[…]}, {theme}) → SVG 文字列。
 * items の種類:
 *   floor {x1,x2,y}            床（下に短い斜線）
 *   rough {x1,x2,y}            粗い面（床の下を濃い斜線＋「粗い面」）
 *   slope {x1,y1,x2,y2}        斜面（なめらか）。下は塗らず、斜線を少し
 *   wall  {x,y1,y2}            壁（右側に斜線）
 *   spring {x1,x2,y,h}         ばね（ギザギザ、x1 が壁側）
 *   cart  {x,y,ghost,label,ang} 台車（x は中心、y は床の高さ）。ghost で灰色の点線
 *   block {x,y,ghost,label,ang} 小物体（四角）
 *   ball  {x,y,r,ghost,label}  ボール（y は中心）
 *   arrow {x1,y1,x2,y2,label,lx,ly,color} 力・速さの矢印（0.9 mm）
 *   ref   {x1,x2,y,label}      基準面（灰色の点線＋「基準面」）
 *   vdim  {x,y1,y2,label,side} 高さ（縦の弧。side=-1 で左にふくらむ）
 *   hdim  {x1,x2,y,label,side} 長さ（横の弧。side=-1 で上にふくらむ）
 *   text  {x,y,s,anchor,fs,color}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ebar.js'));
  else root.EScene = factory(root.EBar);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const { LW, txt, line, n2 } = E;

  function hatch(x1, x2, y, c, dir = 1, step = 1.8, len = 1.6, up = false) {
    let s = '';
    for (let x = x1 + 0.6; x < x2; x += step) s += line(x, y, x - len * dir, up ? y - len : y + len, c, LW.guide);
    return s;
  }
  // 寸法線: 細い線（0.2 mm × 1.5）と、両端の小さい矢じり
  function dimLine(x1, y1, x2, y2, c) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, L = 1.5, hw = 0.55;
    const head = (px, py, sx, sy) => `<polygon points="${n2(px)},${n2(py)} ${n2(px - sx * L - sy * hw)},${n2(py - sy * L + sx * hw)} ${n2(px - sx * L + sy * hw)},${n2(py - sy * L - sx * hw)}" fill="${c}"/>`;
    return line(x1 + ux * L * 0.8, y1 + uy * L * 0.8, x2 - ux * L * 0.8, y2 - uy * L * 0.8, c, LW.guide * 1.5) + head(x2, y2, ux, uy) + head(x1, y1, -ux, -uy);
  }
  function arcPath(x1, y1, x2, y2, bulge, c) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
    const nx = -dy / d * bulge, ny = dx / d * bulge;
    return `<path d="M ${n2(x1)} ${n2(y1)} Q ${n2(mx + 2 * nx)} ${n2(my + 2 * ny)} ${n2(x2)} ${n2(y2)}" fill="none" stroke="${c}" stroke-width="${LW.guide * 1.6}"/>`;
  }

  function scene(spec, opt = {}) {
    const ink = '#111', grey = '#8a8a8a', red = opt.theme === 'color' ? '#d0202a' : '#111';
    const fs = opt.fs || 4.4;
    let g = '';
    const ghostAttr = gh => gh ? ` stroke-dasharray="1.2 0.9"` : '';
    for (const it of spec.items) {
      const col = it.ghost ? grey : ink;
      switch (it.t) {
        case 'floor':
          g += line(it.x1, it.y, it.x2, it.y, ink, LW.obj) + hatch(it.x1, it.x2, it.y, grey, 1, 1.8, 1.6, !!it.up);
          break;
        case 'rough': {
          g += line(it.x1, it.y, it.x2, it.y, ink, LW.thick);
          g += hatch(it.x1, it.x2, it.y, ink, 1, 1.0, 1.8);
          g += txt((it.x1 + it.x2) / 2, it.y + 2.0 + fs, it.label || '粗い面', { ja: true, fs: fs * 0.85, color: ink });
          break;
        }
        case 'slope': {   // ghost: 灰色の点線（振り子の「あと」のひも）。rough: 太線（粗い斜面）
          g += line(it.x1, it.y1, it.x2, it.y2, it.ghost ? grey : ink, it.rough ? LW.thick : LW.obj, it.ghost ? '1.2 0.9' : null);
          break;
        }
        case 'wall':
          g += line(it.x, it.y1, it.x, it.y2, ink, LW.obj);
          for (let y = it.y1 + 0.6; y < it.y2; y += 1.8) g += line(it.x, y, it.x - 1.6, y + 1.6, grey, LW.guide);
          break;
        case 'spring': {
          const n = it.n || 8, h = it.h || 3, y = it.y - h / 2 - 0.6, L = it.x2 - it.x1, lead = Math.min(1.5, L * 0.12);
          let d = `M ${n2(it.x1)} ${n2(y)} L ${n2(it.x1 + lead)} ${n2(y)}`;
          for (let k = 0; k < n; k++) {
            const xa = it.x1 + lead + (L - 2 * lead) * (k + 0.5) / n;
            d += ` L ${n2(xa)} ${n2(y + (k % 2 ? h / 2 : -h / 2))}`;
          }
          d += ` L ${n2(it.x2 - lead)} ${n2(y)} L ${n2(it.x2)} ${n2(y)}`;
          g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${LW.obj}" stroke-linejoin="round"${ghostAttr(it.ghost)}/>`;
          break;
        }
        case 'cart': {
          const w = it.w || 9, h = it.h || 4.2, r = 1.3, ang = (it.ang || 0) * Math.PI / 180;
          const tr = `translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2(-it.ang || 0)})`;
          g += `<g transform="${tr}"><rect x="${n2(-w / 2)}" y="${n2(-h - 2 * r)}" width="${w}" height="${h}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${ghostAttr(it.ghost)}/>` +
            `<circle cx="${n2(-w / 2 + 2.2)}" cy="${n2(-r)}" r="${r}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${ghostAttr(it.ghost)}/>` +
            `<circle cx="${n2(w / 2 - 2.2)}" cy="${n2(-r)}" r="${r}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${ghostAttr(it.ghost)}/></g>`;
          void ang;
          if (it.label) g += txt(it.x, it.y - h - 2 * r - 1.6, it.label, { ja: true, fs, color: col });
          break;
        }
        case 'block': {
          const s = it.s || 5;
          g += `<g transform="translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2(-it.ang || 0)})"><rect x="${n2(-s / 2)}" y="${n2(-s)}" width="${s}" height="${s}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${ghostAttr(it.ghost)}/></g>`;
          if (it.label) g += it.lpos === 'left'
            ? txt(it.x - s / 2 - 1.4, it.y - s / 2 + fs * 0.35, it.label, { ja: true, fs, color: col, anchor: 'end' })
            : txt(it.x, it.y - s - 1.6, it.label, { ja: true, fs, color: col });
          break;
        }
        case 'ball':
          g += `<circle cx="${n2(it.x)}" cy="${n2(it.y)}" r="${it.r || 2.2}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${ghostAttr(it.ghost)}/>`;
          if (it.label) g += txt(it.x + (it.r || 2.2) + 1.2, it.y + fs * 0.35, it.label, { ja: true, fs, anchor: 'start', color: col });
          break;
        case 'arrow': {
          const c = it.color === 'red' ? red : (it.color === 'grey' ? grey : ink);
          g += E.arrow(it.x1, it.y1, it.x2, it.y2, c, LW.thick, 2.6);
          // 力は作用点を黒丸ではっきり示す（速さの矢印には付けない）
          if (it.dot) g += `<circle cx="${n2(it.x1)}" cy="${n2(it.y1)}" r="0.75" fill="${c}"/>`;
          if (it.label) g += txt(it.lx != null ? it.lx : it.x2, it.ly != null ? it.ly : it.y2 - 1.8, it.label, { fs, color: c, halo: true, anchor: it.anchor || 'middle', ja: /[^\x00-\x7F −]/.test(it.label) && !/^[\x00-\x7F − =.]+$/.test(it.label) });
          break;
        }
        case 'ref':
          g += line(it.x1, it.y, it.x2, it.y, grey, LW.guide * 2, '1.4 1.0');
          g += txt(it.x2, it.y - 1.2, it.label || '基準面', { ja: true, fs: fs * 0.8, anchor: 'end', color: grey });
          break;
        // 長さ・高さ（リードαなど問題集の形）: 両端に矢じりのある細い直線、途中に数値。物の端から灰色の点線の補助線。
        case 'vdim': {   // x の縦線で y1〜y2。ex を与えると、(ex, y1) から補助線を横に引く。数値は side 側（1 = 右）
          const side = it.side || 1, mid = (it.y1 + it.y2) / 2;
          if (it.ex != null) g += line(it.ex, it.y1, it.x + 1.2 * Math.sign(it.x - it.ex || 1), it.y1, grey, LW.guide, '0.8 0.8');
          if (it.ex2 != null) g += line(it.ex2, it.y2, it.x + 1.2 * Math.sign(it.x - it.ex2 || 1), it.y2, grey, LW.guide, '0.8 0.8');
          g += dimLine(it.x, it.y1, it.x, it.y2, ink);
          g += txt(it.x + side * 1.4, mid + fs * 0.35, it.label, { fs, anchor: side < 0 ? 'end' : 'start', halo: true });
          break;
        }
        case 'hdim': {   // 床（y）の x1〜x2 を、off だけ下（side=1）に引いた線で示す。数値は線の途中（白抜き）
          const side = it.side || 1, yy = it.y + (it.off || 10) * side;
          g += line(it.x1, it.y + 0.4 * side, it.x1, yy + 1.2 * side, grey, LW.guide, '0.8 0.8') + line(it.x2, it.y + 0.4 * side, it.x2, yy + 1.2 * side, grey, LW.guide, '0.8 0.8');
          g += dimLine(it.x1, yy, it.x2, yy, ink);
          const tw = E.txt ? String(it.label).length * fs * 0.5 + 1.6 : 8;
          g += `<rect x="${n2((it.x1 + it.x2) / 2 - tw / 2)}" y="${n2(yy - fs * 0.6)}" width="${n2(tw)}" height="${n2(fs * 1.2)}" fill="#fff"/>`;
          g += txt((it.x1 + it.x2) / 2, yy + fs * 0.35, it.label, { fs });
          break;
        }
        case 'guide':
          g += line(it.x1, it.y1, it.x2, it.y2, grey, LW.guide * 1.5, '0.8 0.8');
          break;
        case 'text':
          g += txt(it.x, it.y, it.s, { ja: true, fs: it.fs || fs, anchor: it.anchor || 'middle', color: it.color === 'grey' ? grey : ink, halo: true });
          break;
      }
    }
    const W = spec.w, H = spec.h;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(W)}mm" height="${n2(H)}mm" viewBox="0 0 ${n2(W)} ${n2(H)}">` +
      `<rect x="0" y="0" width="${n2(W)}" height="${n2(H)}" fill="#fff"/>` + g + '</svg>';
  }

  return { scene };
});
