// 見本の図を作る: node samples/make.js → samples/out/*.svg, *.png
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const E = require('../lib/ebar.js');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
const S = {
  // ① 押して速くする（正の仕事）
  push: [[{ title: 'まえ', K: 20 }, { title: 'あと', K: 50 }], { works: [{ W: 30, text: '人が押す力が\n台車に仕事をした' }], ref: true }],
  // ② 落下（仕事なし、保存）
  fall: [[{ title: '高いところ', Ug: 60 }, { title: '途中', K: 30, Ug: 30 }, { title: '地面の直前', K: 60 }], { ref: true }],
  // ③ ばね → 粗い面で止まる（2025 第6回の例）
  spring: [[{ title: 'はじめ', Us: 40 }, { title: 'B点', K: 40 }, { title: '静止', K: 0 }], { works: [null, { W: -40, text: '摩擦力が\n負の仕事をした' }], ref: true }],
  // ④ 問題: あとを記入させる（目盛りつき、あとは空）
  q_draw: [[{ title: 'まえ', K: 10, Ug: 30 }, { title: 'あと', hide: true }], { works: [{ W: 20, text: '仕事をされた' }], grid: true, max: 60 }],
  // ⑤ その解説: 書き足した棒を赤／太字
  a_draw: [[{ title: 'まえ', K: 10, Ug: 30 }, { title: 'あと', K: 30, Ug: 30, answer: ['K', 'sum'] }], { works: [{ W: 20, text: '仕事をされた' }], grid: true, ref: true, max: 60 }],
};
for (const [name, [st, o]] of Object.entries(S)) for (const theme of ['mono', 'color']) {
  const f = path.join(out, `${name}_${theme}.svg`);
  fs.writeFileSync(f, E.chart(st, { ...o, theme }));
  execFileSync('rsvg-convert', ['-z', '3', '-o', f.replace(/\.svg$/, '.png'), f]);
}
console.log('ok', fs.readdirSync(out).length);
