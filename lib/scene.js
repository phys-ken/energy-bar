/* 場面の図（台車・ばね・斜面など）。描き方は docs/figure-style.md（リードαに合わせた）。
 * 物は黒、補助線は灰色の点線、答えは赤／太字。線 0.2・0.45・0.9 mm。
 * 力は作用点（黒丸）から描く。速さは細い矢印。長さ・高さは両矢印の直線＋点線の補助線。
 * 場所は A・B の記号（物体の左上）。ばねはコイル。動きは点線の道すじに矢じり。
 * 図は中身に合わせて自動で切り詰める（空白の大きな図にしない）。
 *
 * 単位は mm、y は下向き。scene({items:[…], pad}, {theme}) → SVG 文字列。items の種類:
 *   floor {x1,x2,y,up}          床（下に短い斜線。up で上＝天井）
 *   rough {x1,x2,y,label}       粗い面（太線＋濃い斜線、線の下に「粗い面」）
 *   slope {x1,y1,x2,y2,rough,ghost} 斜面・ひも（rough で太線、ghost で灰色の点線）
 *   wall  {x,y1,y2,side}        壁（side=-1 で斜線が左）
 *   spring {x1,x2,y,h,n,ghost}  コイルばね（x1 が壁側）。縮めても輪の数は同じで、詰まって見える
 *   cart  {x,y,ang,ghost}       台車（x は中心、y は接地点）
 *   block {x,y,s,ang,ghost}     小物体
 *   ball  {x,y,r,ghost}         小球（y は中心）
 *   pt    {x,y,s,anchor}        場所の記号（A・B）
 *   force {x1,y1,x2,y2,label,lx,ly,anchor} 力（作用点に黒丸、0.9 mm）
 *   vel   {x1,y1,x2,y2,label,lx,ly,anchor,grey} 速さ（0.6 mm）
 *   path  {pts:[[x,y]…], arrow} 動きの道すじ（灰色の点線、終わりに矢じり）
 *   ref   {x1,x2,y,label,below} 基準面（灰色の点線＋文字を右端に）
 *   vdim  {x,y1,y2,label,side,ex,ex2} 高さ（両矢印。ex/ex2 から補助線）
 *   hdim  {x1,x2,y,off,label,side} 長さ（床から off 離した両矢印、両端に補助線）
 *   guide {x1,y1,x2,y2}         補助線
 *   text  {x,y,s,anchor,fs,color}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ebar.js'));
  else root.EScene = factory(root.EBar);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const { LW, txt, line, n2 } = E;
  const LW_V = 0.6;   // 速さの矢印

  function scene(spec, opt = {}) {
    const ink = '#111', grey = '#8a8a8a';
    const fs = opt.fs || 4.2;
    let g = '';
    // 外枠: 描いたものの範囲を集める
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    const tw = (s, f) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 && c !== ' ' && c !== '−' ? f : f * 0.55), 0);
    const T = (x, y, s, o = {}) => {   // 文字（範囲も数える）
      const f = o.fs || fs, w = tw(s, f), a = o.anchor || 'middle';
      const xl = a === 'start' ? x : a === 'end' ? x - w : x - w / 2;
      add(xl, y - f * 0.85); add(xl + w, y + f * 0.2);
      return txt(x, y, s, Object.assign({ fs: f }, o));
    };
    const L = (xa, ya, xb, yb, c, w, d) => { add(xa, ya); add(xb, yb); return line(xa, ya, xb, yb, c, w, d); };
    const dash = gh => gh ? ` stroke-dasharray="1.2 0.9"` : '';
    const isJa = s => /[^\x00-\x7F −₀₁]/.test(s);
    function hatch(xa, xb, y, c, up, step = 1.8, len = 1.6) {
      let s = '';
      for (let x = xa + 0.6; x < xb; x += step) s += L(x, y, x - len, up ? y - len : y + len, c, LW.guide);
      return s;
    }
    function head(px, py, ux, uy, c, Lh, hw) {
      const bx = px - ux * Lh, by = py - uy * Lh;
      add(px, py); add(bx, by);
      return `<polygon points="${n2(px)},${n2(py)} ${n2(bx - uy * hw)},${n2(by + ux * hw)} ${n2(bx + uy * hw)},${n2(by - ux * hw)}" fill="${c}"/>`;
    }
    function arrowLine(xa, ya, xb, yb, c, w, Lh) {
      const dx = xb - xa, dy = yb - ya, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
      return L(xa, ya, xb - ux * Lh * 0.9, yb - uy * Lh * 0.9, c, w) + head(xb, yb, ux, uy, c, Lh, Lh * 0.42);
    }
    function dimLine(xa, ya, xb, yb, c) {
      const dx = xb - xa, dy = yb - ya, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, Lh = 1.5;
      return L(xa + ux * Lh * 0.8, ya + uy * Lh * 0.8, xb - ux * Lh * 0.8, yb - uy * Lh * 0.8, c, LW.guide * 1.5) + head(xb, yb, ux, uy, c, Lh, 0.55) + head(xa, ya, -ux, -uy, c, Lh, 0.55);
    }

    for (const it of spec.items) {
      const col = it.ghost ? grey : ink;
      switch (it.t) {
        case 'floor': g += L(it.x1, it.y, it.x2, it.y, ink, LW.obj) + hatch(it.x1, it.x2, it.y, grey, !!it.up); break;
        case 'rough':
          g += L(it.x1, it.y, it.x2, it.y, ink, LW.thick) + hatch(it.x1, it.x2, it.y, ink, false, 1.0, 1.8);
          g += T((it.x1 + it.x2) / 2, it.y + 2.4 + fs, it.label || '粗い面', { ja: true, fs: fs * 0.85 });
          break;
        case 'slope': g += L(it.x1, it.y1, it.x2, it.y2, it.ghost ? grey : ink, it.rough ? LW.thick : LW.obj, it.ghost ? '1.2 0.9' : null); break;
        case 'wall': {
          const sd = it.side || -1;
          g += L(it.x, it.y1, it.x, it.y2, ink, LW.obj);
          for (let y = it.y1 + 0.6; y < it.y2; y += 1.8) g += L(it.x, y, it.x + 1.6 * sd, y + 1.6, grey, LW.guide);
          break;
        }
        case 'spring': {
          // コイル: 長くした円（サイクロイドに近い曲線）。x = 進み + R sinθ、y = −R cosθ
          const n = it.n || 9, h = it.h || 3.6, yc = it.y - h / 2 - 0.4, len = it.x2 - it.x1, lead = 1.0;
          const pitch = (len - 2 * lead - h * 0.5) / n, R = h / 2;
          let d = `M ${n2(it.x1)} ${n2(yc)} L ${n2(it.x1 + lead)} ${n2(yc)}`;
          for (let k = 0; k <= n * 24; k++) {
            const th = k / 24 * 2 * Math.PI, x = it.x1 + lead + R * 0.5 + pitch * th / (2 * Math.PI) - R * 0.5 * Math.cos(th) + R * 0.5 * 0, y = yc - R * Math.sin(th);
            d += ` L ${n2(x)} ${n2(y)}`;
          }
          d += ` L ${n2(it.x2)} ${n2(yc)}`;
          add(it.x1, yc - R); add(it.x2, yc + R);
          g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${LW.thin}" stroke-linejoin="round"${dash(it.ghost)}/>`;
          break;
        }
        case 'cart': {
          const w = it.w || 10, h = it.h || 4.6, r = 1.4, a = it.ang || 0;
          const tr = `translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2(-a)})`;
          add(it.x - w / 2 - 1, it.y - h - 2 * r - 1); add(it.x + w / 2 + 1, it.y + 0.5);
          g += `<g transform="${tr}"><rect x="${n2(-w / 2)}" y="${n2(-h - 2 * r)}" width="${w}" height="${h}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${dash(it.ghost)}/>` +
            `<circle cx="${n2(-w / 2 + 2.3)}" cy="${n2(-r)}" r="${r}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${dash(it.ghost)}/>` +
            `<circle cx="${n2(w / 2 - 2.3)}" cy="${n2(-r)}" r="${r}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${dash(it.ghost)}/></g>`;
          break;
        }
        case 'block': {
          const s = it.s || 5.5;
          add(it.x - s / 2 - 1, it.y - s - 1); add(it.x + s / 2 + 1, it.y);
          g += `<g transform="translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2(-(it.ang || 0))})"><rect x="${n2(-s / 2)}" y="${n2(-s)}" width="${s}" height="${s}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${dash(it.ghost)}/></g>`;
          break;
        }
        case 'ball': {
          const r = it.r || 2.0;
          add(it.x - r, it.y - r); add(it.x + r, it.y + r);
          g += `<circle cx="${n2(it.x)}" cy="${n2(it.y)}" r="${r}" fill="#fff" stroke="${col}" stroke-width="${LW.obj}"${dash(it.ghost)}/>`;
          break;
        }
        case 'pt': g += T(it.x, it.y, it.s, { anchor: it.anchor || 'middle', fs: fs * 1.05 }); break;
        case 'force':
          g += arrowLine(it.x1, it.y1, it.x2, it.y2, ink, LW.thick, 2.6);
          g += `<circle cx="${n2(it.x1)}" cy="${n2(it.y1)}" r="0.75" fill="${ink}"/>`;
          if (it.label) g += T(it.lx, it.ly, it.label, { ja: isJa(it.label), anchor: it.anchor || 'middle', halo: true });
          break;
        case 'vel': {
          const c = it.grey ? grey : ink;
          g += arrowLine(it.x1, it.y1, it.x2, it.y2, c, LW_V, 2.0);
          if (it.label) g += T(it.lx, it.ly, it.label, { ja: isJa(it.label), anchor: it.anchor || 'middle', color: c, halo: true });
          break;
        }
        case 'path': {
          const p = it.pts;
          let d = `M ${n2(p[0][0])} ${n2(p[0][1])}`;
          p.slice(1).forEach(q => { d += ` L ${n2(q[0])} ${n2(q[1])}`; add(q[0], q[1]); });
          add(p[0][0], p[0][1]);
          g += `<path d="${d}" fill="none" stroke="${grey}" stroke-width="${LW.guide * 1.5}" stroke-dasharray="1.0 0.8"/>`;
          if (it.arrow !== false) {
            const a = p[p.length - 2], b = p[p.length - 1], dd = Math.hypot(b[0] - a[0], b[1] - a[1]);
            g += head(b[0], b[1], (b[0] - a[0]) / dd, (b[1] - a[1]) / dd, grey, 1.8, 0.75);
          }
          break;
        }
        case 'ref':
          g += L(it.x1, it.y, it.x2, it.y, grey, LW.guide * 2, '1.4 1.0');
          // label: '' なら文字を書かない（文字を別の場所に置くとき）
          if (it.label !== '') g += T(it.x2, it.below ? it.y + fs * 0.95 : it.y - 1.2, it.label || '基準面', { ja: true, fs: fs * 0.8, anchor: 'end', color: grey });
          break;
        case 'vdim': {
          const sd = it.side || 1, mid = (it.y1 + it.y2) / 2;
          if (it.ex != null) g += L(it.ex, it.y1, it.x + 1.2 * Math.sign(it.x - it.ex || 1), it.y1, grey, LW.guide, '0.8 0.8');
          if (it.ex2 != null) g += L(it.ex2, it.y2, it.x + 1.2 * Math.sign(it.x - it.ex2 || 1), it.y2, grey, LW.guide, '0.8 0.8');
          g += dimLine(it.x, it.y1, it.x, it.y2, ink);
          g += T(it.x + sd * 1.4, mid + fs * 0.35, it.label, { anchor: sd < 0 ? 'end' : 'start', halo: true, ja: isJa(it.label) });
          break;
        }
        case 'hdim': {
          const sd = it.side || 1, yy = it.y + (it.off || 10) * sd;
          g += L(it.x1, it.y + 0.4 * sd, it.x1, yy + 1.2 * sd, grey, LW.guide, '0.8 0.8') + L(it.x2, it.y + 0.4 * sd, it.x2, yy + 1.2 * sd, grey, LW.guide, '0.8 0.8');
          g += dimLine(it.x1, yy, it.x2, yy, ink);
          const w = tw(it.label, fs) + 1.6;
          g += `<rect x="${n2((it.x1 + it.x2) / 2 - w / 2)}" y="${n2(yy - fs * 0.6)}" width="${n2(w)}" height="${n2(fs * 1.2)}" fill="#fff"/>`;
          g += T((it.x1 + it.x2) / 2, yy + fs * 0.35, it.label, {});
          break;
        }
        case 'guide': g += L(it.x1, it.y1, it.x2, it.y2, grey, LW.guide * 1.5, '0.8 0.8'); break;
        case 'text': g += T(it.x, it.y, it.s, { ja: true, fs: it.fs || fs, anchor: it.anchor || 'middle', color: it.color === 'grey' ? grey : ink, halo: true }); break;
      }
    }
    const p = spec.pad != null ? spec.pad : 1.5;
    const vx = x0 - p, vy = y0 - p, W = x1 - x0 + 2 * p, H = y1 - y0 + 2 * p;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(W)}mm" height="${n2(H)}mm" viewBox="${n2(vx)} ${n2(vy)} ${n2(W)} ${n2(H)}">` +
      `<rect x="${n2(vx)}" y="${n2(vy)}" width="${n2(W)}" height="${n2(H)}" fill="#fff"/>` + g + '</svg>';
  }

  return { scene };
});
