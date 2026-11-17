// node bank/build.js … 生成器の問題を、問題バンク（mondai-bank）の形に書き出す。
// 出力は bank/out/ に置くだけ。2026-11-17 に 205 問を mondai-bank の data/items/220_energybar.json に取り込んだ。
// **取り込んだあとは、この出力でバンクのファイルを上書きしない。** 生成器を直すと同じ qid から別の問題ができる。
// 問題を足すときは ids.json の末尾に新しい id を足し、その問題だけをバンクの末尾に足す。ids.json は消さない。
//   bank/out/220_energybar.json      問題（バンクの items の形）
//   bank/out/figures/energybar/*.png 図（白黒、300 dpi）
// 選ぶ問題は bank/ids.json に固定する。一度バンクに入れた id と qid の対応は変えない（バンクの 3 つの禁止）。
// ids.json が無いときだけ、たねを決まった順に試して、場面が偏らないように選ぶ。
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const G = require('../lib/gen.js'), E = require('../lib/ebar.js'), S = require('../lib/scene.js');

const OUT = path.join(__dirname, 'out'), FIG = path.join(OUT, 'figures', 'energybar');
fs.mkdirSync(FIG, { recursive: true });
const IDS = path.join(__dirname, 'ids.json');

// 単元 → 教科書の節（東京書籍『改訂新編物理基礎』1 編 3 章）
const SECTION = { M: 23, K: 21, Us: 22, Ug: 22, C: 23, F: 24 };
const TOPIC = { M: 'お金で考える保存', K: '仕事と運動エネルギー', Us: '弾性力による位置エネルギー', Ug: '重力による位置エネルギー', C: '力学的エネルギーの保存', F: '力学的エネルギーが保存されない運動' };
// その問題が要求する、自分より前の節（19 仕事、21 運動エネルギー、22 位置エネルギー、23 保存）
const REQUIRES = { M: [], K: [19], Us: [19, 21], Ug: [19, 21], C: [19, 21, 22], F: [19, 21, 22, 23] };
// 想定の難しさ（1〜5）: 読む 1・かく 2・選ぶ 2・計算 3
const DIFF = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 };
const PER = { M: 5 };   // お金は 5 問、ほかは 10 問
const FMT_ID = { 2: 'read', 3: 'draw', 4: 'choose', 5: 'calc' };
const LABELS = ['①', '②', '③'];

// ---------- 問題を選ぶ ----------
function hex6(n) { return ('000000' + ((n * 2654435761) >>> 0).toString(16)).slice(-6); }
// 場面の型: 問題文と問いの骨組み（数を # にする）。見出しはほとんど「図A→図B」なので、場面の区別には使えない
const kindOf = q => (q.text + '|' + q.ask).replace(/[\d.]+/g, '#');
function choose() {
  const pick = [];
  for (const f of G.FORMATS) for (const u of G.UNITS.map(x => x.id)) {
    if (!G.available(f.n, [u]).length) continue;
    const type = u === 'M' ? 'L1M' : `L${f.n}${u}`;
    if (u === 'M' && f.n !== 2) continue;
    const want = PER[u] || 10;
    const byKind = new Map(), seen = new Set();
    for (let i = 1; i <= 600; i++) {
      const q = G.regen(`${type}-${hex6(i + f.n * 1000 + u.charCodeAt(0) * 7)}`);
      // 数値まで同じ問題を 2 回入れない（通読で、計算の同じ問題が 3 つ並んでいた 2026-11-17）
      // 選ぶ問題は文に数がなく、選択肢の図の数で区別する（答えの中に選択肢の棒が入っている）
      const same = q.text + '|' + q.ask + '|' + JSON.stringify(q.chart && q.chart.states) + '|' + JSON.stringify(q.answer);
      if (seen.has(same)) continue;
      seen.add(same);
      const k = kindOf(q);
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k).push(q);
    }
    // 場面の型を順にまわして 1 問ずつ取る（同じ型が続かない）
    const lists = [...byKind.values()], got = [];
    for (let r = 0; got.length < want; r++) {
      let any = false;
      for (const l of lists) if (l[r] && got.length < want) { got.push(l[r]); any = true; }
      if (!any) break;
    }
    got.forEach((q, i) => pick.push({ id: `EBG-${u}-${FMT_ID[f.n]}-${String(i + 1).padStart(2, '0')}`, qid: q.qid }));
  }
  return pick;
}

// ---------- 図 ----------
const PNG = (name, svg) => {
  const s = path.join(FIG, name + '.svg'), p = path.join(FIG, name + '.png');
  fs.writeFileSync(s, svg);
  execFileSync('rsvg-convert', ['-d', '300', '-p', '300', '-o', p, s]);
  fs.unlinkSync(s);
  // PNG に 300 dpi を書き込む（rsvg-convert は書かない）。書かないと Word が 96 dpi とみなし、図が約 3 倍に大きくなる
  execFileSync('magick', [p, '-units', 'PixelsPerInch', '-density', '300', p]);
  return `energybar/${name}.png`;
};
const chartSVG = c => E.chart(c.states, Object.assign({}, c.opt, { theme: 'mono' }));

// ---------- 1 問をバンクの形に ----------
const Jtxt = v => (v < 0 ? '−' : '') + String(Math.abs(Math.round(v * 1000) / 1000));
function toItem({ id, qid }) {
  const q = G.regen(qid), a = q.answer, u = q.unit || 'M';
  const figs = [];
  if (q.scene) figs.push(PNG(`${id}_scene`, S.scene(q.scene)));
  const it = {
    id, topic: 'energy_bar_chart', topic_label: `エネルギー棒グラフ（${TOPIC[u]}）`, difficulty_intended: DIFF[q.level],
    textbook: { part: 1, chapter: 3, section: SECTION[u] }, textbook_adv: null, scope: 'physics_basic',
    requires: REQUIRES[u].map(s => ({ part: 1, chapter: 3, section: s })), exposure: 'original',
    source: { kind: 'original', name: 'エネルギー棒グラフ 問題の生成器', locator: qid, drive_file_id: null },
    derived_from: qid, origin: 'ai_generated', shelf: 'course', topics: ['エネルギー棒グラフ'],
    chained: false, scaffolded_by: [], group_id: null, group_stem: null, group_figures: null, sub_label: null, sub_index: null,
    question_type: a.kind === 'num' && q.level === 5 ? 'calculation' : 'concept',
    stem: `${q.text}\n${q.ask}`, choices: [], answer: '', explanation: q.explain.join('\n'), rubric: null,
    figure: null, figures: null, answer_figures: null, explanation_figures: null,
    review: { status: 'unreviewed', rating: null, reviewed_at: null, comment: '' },
    stats: { n: 0, p: null, it_corr: null, option_rates: {}, administered: [] },
  };
  if (q.level <= 2) {                      // 棒グラフを読む（お金も）
    it.type = 'numeric';
    figs.push(PNG(`${id}_chart`, chartSVG(q.chart)));
    it.answer = `${Jtxt(a.value)} ${a.unit}`;
    it.answer_figures = [PNG(`${id}_ans`, chartSVG(q.explainChart))];
  } else if (q.level === 3) {              // 棒グラフをかく: 紙では棒と仕事の矢印の両方をかく
    it.type = 'drawing';
    const c = JSON.parse(JSON.stringify(q.chart));
    c.opt.works = [{ blank: true }];       // 仕事がない場面でも欄は同じ（欄の有無で答えが分からないように）
    figs.push(PNG(`${id}_chart`, chartSVG(c)));
    const t1 = q.chart.states[1].title;
    it.stem = `${q.text}\n${/^図[AB]$/.test(t1) ? t1 : `「${t1}」`}の棒グラフをかき、仕事があれば、その矢印と値をかけ。1 目盛りは 10 J である。`;
    const ex = JSON.parse(JSON.stringify(q.explainChart));
    if (ex.opt.works[0]) ex.opt.works[0].answer = true;
    it.answer_figures = [PNG(`${id}_ans`, chartSVG(ex))];
    const t = a.target, w = q.explainChart.opt.works[0];
    it.rubric = `棒: 運動 ${t.K} J・ばね ${t.Us} J・重力 ${t.Ug} J・力学的エネルギー ${t.K + t.Us + t.Ug} J。` +
      (w ? `矢印: ${w.W > 0 ? '系に入る下向き' : '系から出る上向き'}、${w.W > 0 ? '+' : '−'}${Math.abs(w.W)} J。` : '矢印: かかない（仕事なし）。');
    it.answer = it.rubric;   // 答えが空だと、バンクで「採点できる問題」に数えられない
  } else if (q.level === 4) {              // 場面から選ぶ
    it.type = 'choice';
    it.choices = a.choices.map((c, i) => ({ label: LABELS[i], text: '', figure: PNG(`${id}_c${i + 1}`, chartSVG(c)), misconception: i === a.correct ? null : a.mis[i] }));
    it.answer = LABELS[a.correct];
    it.explanation = a.why.map((w, i) => `${LABELS[i]} ${w.replace(/^正解。/, '')}`).join('\n');
  } else {                                 // 計算
    it.type = 'numeric';
    it.answer = `${G.f2(a.value)} ${a.unit}`;
    if (q.explainChart) it.explanation_figures = [PNG(`${id}_exp`, chartSVG(q.explainChart))];
  }
  it.figures = figs.length ? figs : null;
  return it;
}

let ids = fs.existsSync(IDS) ? JSON.parse(fs.readFileSync(IDS, 'utf8')) : null;
if (!ids) { ids = choose(); fs.writeFileSync(IDS, JSON.stringify(ids, null, 1) + '\n'); }
const items = ids.map(toItem);
const meta = { source: 'エネルギー棒グラフ 問題の生成器（phys-ken/energy-bar の lib/gen.js）', batch: 'energybar', extracted: new Date().toISOString().slice(0, 10), schema_version: 2, origin: 'ai_generated' };
fs.writeFileSync(path.join(OUT, '220_energybar.json'), JSON.stringify({ meta, questions: items }, null, 1) + '\n');
const count = {}; items.forEach(it => { const k = it.id.split('-').slice(1, 3).join('-'); count[k] = (count[k] || 0) + 1; });
console.log(items.length, '問', JSON.stringify(count));
