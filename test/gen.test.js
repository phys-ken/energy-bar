// node test/gen.test.js … 生成器の検査（全種類を何百回も作り、答えと図が成り立つか）
const G = require('../lib/gen.js'), E = require('../lib/ebar.js'), S = require('../lib/scene.js');
let ng = 0, n = 0;
const bad = (q, m) => { ng++; if (ng < 30) console.log('NG', q.qid, m); };
const units = G.UNITS.map(u => u.id);
// 「まえ」「あと」を場面の名前として使わない（先生の指摘 2026-11-15）。文中の「離れたあと」のような言い方も避ける
const NG_WORDS = /人が|重力場|失う|消える|あと|まえ|段\d/;
// 検査そのものが動いているか: 必ず当たる文で確かめる
if (!NG_WORDS.test('あとの運動エネルギー') || !NG_WORDS.test('段2')) { console.log('検査の正規表現が動いていない'); process.exit(1); }
for (const f of G.FORMATS) for (const u of units) {
  if (!G.available(f.n, [u]).length) continue;   // お金は「読む」だけ
  for (let i = 0; i < 300; i++) {
    let q;
    try { q = G.make(f.n, [u]); } catch (e) { ng++; console.log('例外', f.id, u, e.stack.split('\n').slice(0, 3).join(' ')); break; }
    n++;
    const q2 = G.regen(q.qid);
    if (JSON.stringify(q2) !== JSON.stringify(q)) bad(q, '作り直すと別の問題');
    const a = q.answer;
    if (a.kind === 'num') {
      if (!isFinite(a.value)) bad(q, '答えが数でない');
      if (!G.check(q, String(a.value))) bad(q, '正解で正解にならない');
      if (G.check(q, String(a.value + Math.abs(a.value) * 0.1 + 7))) bad(q, 'ずれた値で正解になる');   // 負の答えでも必ずずれる値
      if (a.tol && !G.check(q, G.f2(a.value).replace('−', '-'))) bad(q, '2 桁に丸めた答えが正解にならない ' + a.value + ' ' + G.f2(a.value));
      if (f.id === 'read' && a.value % (u === 'M' ? 100 : 10) !== 0) bad(q, '刻みでない ' + a.value);
    }
    if (a.kind === 'draw') {
      const t = a.target; if ([t.K, t.Us, t.Ug].some(v => v < 0 || v % 10)) bad(q, '記入の答えが 10 J 刻みでない');
      if (t.K + t.Us + t.Ug > 100) bad(q, '合計が 100 J を超える');
    }
    if (a.kind === 'choice') {
      const ss = a.choices.map(c => JSON.stringify([c.states.map(s => [s.K, s.Us, s.Ug]), c.opt.works.map(w => w && w.W)]));
      if (new Set(ss).size !== 3) bad(q, '選択肢が重なっている');
      a.choices.forEach(c => c.states.forEach(s => ['K', 'Us', 'Ug'].forEach(k => { if ((s[k] || 0) < 0) bad(q, '選択肢に負の棒'); })));
      if (!(a.correct >= 0 && a.correct < 3)) bad(q, '正解の番号');
    }
    const charts = [q.chart, q.explainChart, ...(a.kind === 'choice' ? a.choices : [])].filter(Boolean);
    for (const c of charts) {
      if ('unit' in c.opt && !(c.opt.unit > 0)) bad(q, '目盛りの刻みが数でない');
      if ('mmPerUnit' in c.opt && !(c.opt.mmPerUnit > 0)) bad(q, '目盛りの高さが数でない');
      for (const s of c.states) {
        for (const k of ['K', 'Us', 'Ug']) if ((s[k] || 0) < 0) bad(q, '負の棒 ' + k);
        if (!s.title || NG_WORDS.test(s.title)) bad(q, '棒グラフの見出しがない／「まえ・あと」: ' + s.title);
      }
      const svg = E.chart(c.states, c.opt); if (!/^<svg/.test(svg) || /NaN|undefined/.test(svg)) bad(q, '図がこわれている');
    }
    // 図はお金以外のどの問題にも入れる（先生の指摘: 認知負荷を減らす）
    if (u !== 'M' && !q.scene) bad(q, '場面の図がない');
    if (q.scene) {
      const svg = S.scene(q.scene); if (/NaN|undefined/.test(svg)) bad(q, '場面の図がこわれている');
      // 水平の動きは左から右だけ（先生の指摘 2026-11-16）: 水平の速さの矢印は右向き、水平の動きの線は右へ動く物体のもの
      for (const it of q.scene.items) {
        if (it.t === 'vel' && Math.abs(it.y1 - it.y2) < 1e-6 && !(it.x2 > it.x1)) bad(q, '水平の速さの矢印が左向き');
        if (it.t === 'motion' && it.uy === 0 && !(it.ux > 0)) bad(q, '左へ動く物体がある');
      }
      // 残像の線の長さ: 棒グラフの問題では、速いほう（運動エネルギーが大きいほう）の線が長い
      if (q.level !== 5 && q.chart) {
        const st = q.chart.states, KA = st[0].K || 0, KB = st[1].K || 0;
        const m = q.scene.items.filter(it => it.t === 'motion' && it.role);
        for (const it of m) {
          if (!(it.spd >= 0 && it.spd <= 1)) bad(q, '残像の線の速さの比がない');
          const want = Math.sqrt((it.role === 'A' ? KA : KB) / Math.max(KA, KB));
          if (Math.abs(it.spd - want) > 1e-9) bad(q, `残像の線の長さが速さと合わない ${it.role} ${it.spd} ${want}`);
        }
      }
      if (q.scene.items.some(it => it.label && NG_WORDS.test(it.label))) bad(q, '図の中に「まえ・あと」');
    }
    // 問題文と問いにはカッコを使わない（条件や図の説明は独立した文に。先生の指摘 2026-11-16）
    if (/[（）()]/.test(q.text + q.ask + (q.sys || ''))) bad(q, 'カッコがある: ' + q.text + ' / ' + q.ask);
    // 生徒役の検証で見つかった誤り（2026-11-16）が戻らないように
    if (/速さ 0(\.0)? m\/s で動いている/.test(q.text)) bad(q, '速さ 0 で「動いている」: ' + q.text);
    if (/エネルギーの合計/.test(q.ask + q.explain.join(''))) bad(q, '「エネルギーの合計」（合計の棒は力学的エネルギー）: ' + q.ask);
    if (a.kind === 'num' && a.tol && a.show) {
      const e3 = +Math.abs(a.value).toPrecision(3);
      if (Math.abs(e3 - Math.abs(a.value)) < 1e-9 && Math.abs(a.value) < 100 && Math.abs(+a.show.replace('−', '-') - a.value) > 1e-9) bad(q, `ちょうど 3 桁の答えを丸めている ${a.value} → ${a.show}`);
    }
    if (q.chart && q.scene && /床に下ろしたとき|持ち上げる前/.test(q.chart.states.map(s => s.title).join())) {
      const s0 = q.chart.states[0], s1 = q.chart.states[1];
      if (/持ち上げる前/.test(s0.title) && s0.Ug) bad(q, '床の上（図）なのに重力が 0 J でない');
      if (/床に下ろしたとき/.test(s1.title) && (s1.Ug || (q.explainChart.states[1].Ug))) bad(q, '床に下ろした（図）のに重力が 0 J でない');
    }
    // 先生の決定（2026-11-16）: 見出しが図A・図B なら、問題文に「図Aは…、図Bは…を表す。」がある。問いに場面の名前を「」で書かない
    const tt = (q.chart || q.explainChart || { states: [{}] }).states.map(s => s.title);
    if (tt[0] === '図A' && !/図Aは.+、図Bは.+を表す。/.test(q.text)) bad(q, '図A・図B の説明の文がない: ' + q.text);
    if (tt[0] === '図A' && /「/.test(q.ask)) bad(q, '図A・図B なのに問いに「」: ' + q.ask);
    if (/図の A/.test(q.text)) bad(q, '古い書き方「図の A」: ' + q.text);
    // 力学的エネルギーの問題で「合計」と書かない（お金は「お金の合計」でよい）
    if (u !== 'M' && /合計/.test(q.ask + q.explain.join('') + (a.why ? a.why.join('') : ''))) bad(q, '「合計」と書いている: ' + q.ask);
    if (u === 'M' && /エネルギーも同じ/.test(q.explain.join(''))) bad(q, 'お金の最後の 1 文が残っている');
    // 系は問題文の 1 文として書く（札にしない。先生の指摘 2026-11-16）
    if (!q.sys || !q.text.includes(`${q.sys}を系とする。`)) bad(q, '問題文に系が書かれていない: ' + q.text);
    if (/。 /.test(q.text)) bad(q, '文の切れ目に半角の空白: ' + q.text);
    const all = q.text + q.ask + q.explain.join('') + (a.why ? a.why.join('') : '');
    if (/undefined|NaN/.test(all)) bad(q, '文に undefined/NaN: ' + q.text + q.ask);
    const m = NG_WORDS.exec(all); if (m) bad(q, `使わない言葉「${m[0]}」: ` + all.slice(Math.max(0, m.index - 15), m.index + 15));
  }
}
console.log(`${n} 問を検査、NG ${ng}`);
process.exit(ng ? 1 : 0);
