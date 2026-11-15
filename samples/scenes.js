// 場面の図の全数調査用: すべての場面（分かれ道ごと）を 1 枚ずつ描く。node samples/scenes.js
// SCEN（棒グラフの問題）と CALC（計算の問題）の各場面を、たねを変えて作り、図の形がちがうものだけ残す。
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const G = require('../lib/gen.js'), S = require('../lib/scene.js');
const out = path.join(__dirname, 'out', 'audit'); fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) fs.unlinkSync(path.join(out, f));
const list = [];
const sig = sc => JSON.stringify(sc.items.map(it => [it.t, it.s || '', Math.round((it.x || it.x1 || 0)), Math.round(it.y || it.y1 || 0)]));
for (const [u, arr] of Object.entries(G._SCEN)) arr.forEach((f, i) => {
  const seen = new Set();
  for (let k = 0; k < 60; k++) { const sc = G._finalize(f(G.rng((0x100000 + k * 7919).toString(16)))); const s = sig(sc.scene); if (seen.has(s)) continue; seen.add(s); list.push({ name: `S_${u}${i}_${seen.size}`, sc: sc.scene, text: sc.desc }); }
});
for (const [u, arr] of Object.entries(G._CALC)) arr.forEach((f, i) => {
  const seen = new Set();
  for (let k = 0; k < 60; k++) { const c = f(G.rng((0x200000 + k * 7919).toString(16))); if (!c || !c.scene) continue; const sc = { items: c.scene.items.filter(it => it.t !== 'pt') }; const s = sig(sc); if (seen.has(s)) continue; seen.add(s); list.push({ name: `C_${u}${i}_${seen.size}`, sc, text: c.text }); }
});
for (const it of list) { const f = path.join(out, it.name + '.svg'); fs.writeFileSync(f, S.scene(it.sc)); execFileSync('rsvg-convert', ['-z', '3', '-o', f.replace('.svg', '.png'), f]); }
fs.writeFileSync(path.join(out, 'list.tsv'), list.map(it => `${it.name}\t${it.text}`).join('\n'));
console.log(list.length);
