// 場面の図をすべて 1 枚ずつ描く（目で確かめる用）: node samples/scenes.js
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const G = require('../lib/gen.js'), S = require('../lib/scene.js');
const out = path.join(__dirname, 'out', 'scenes'); fs.mkdirSync(out, { recursive: true });
let k = 0;
const r = G.rng('12345');
for (const [u, list] of Object.entries(G._SCEN)) list.forEach((f, i) => { const sc = f(G.rng('a1b2c' + i)); write(`s_${u}${i}`, sc.scene); });
for (const [u, list] of Object.entries(G._CALC)) list.forEach((f, i) => { let c = null, t = 0; while (!c && t < 20) c = f(G.rng((0xabc00 + t++ * 7 + i).toString(16))); if (c && c.scene) write(`c_${u}${i}`, c.scene); });
function write(name, spec) { const f = path.join(out, name + '.svg'); fs.writeFileSync(f, S.scene(spec)); execFileSync('rsvg-convert', ['-z', '2', '-o', f.replace('.svg', '.png'), f]); k++; }
console.log(k);
