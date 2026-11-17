# energy-bar

物理基礎「力学的エネルギー」のエネルギー棒グラフ教材。静的ページで、GitHub Pages から配信する。
決めごとは `docs/decisions.md`（棒の並び・描き分け・段・単元・時間・記録・言葉づかい・図）。

- 棒はエネルギー（ストック）だけ。仕事（フロー）は場面のあいだで「系の外｜系」の境を横切る矢印（正は入る下向き、負は出る上向き）。
- 仕事の主語は力（「人が押す力が台車に仕事をした」）。重力の系は「物体と地球」。

## ファイル

| ファイル | 中身 |
|---|---|
| `lib/ebar.js` | 棒グラフの描画（SVG、mm 実寸）。アプリと Word の図（Node → rsvg-convert）の両方が使う |
| `lib/scene.js` | 場面の図（床・粗い面・斜面・ばね・台車・力と速さの矢印・寸法）。力は作用点の黒丸から、長さは両矢印の直線 |
| `lib/gen.js` | 問題の生成器。`EGen.make(段, 単元)`、`EGen.regen('L2K-1a2b3c')` で同じ問題を作り直す |
| `index.html` `js/app.js` `css/app.css` | 演習アプリ（生徒用）。10 問・時間つき・結果の画像に QR 2 つ |
| `js/tools.js` | 計算用紙（手書き）と電卓 |
| `js/record.js` | 記録の QR①（`ENERGY-BAR RECORD v1`）と QR②（照合の sha256） |
| `verify.html` `js/verify.js` | 先生用：提出画像の照合・重複の検出・CSV・問題の作り直し |
| `sim.html` `js/sim.js` `css/sim.css` | シミュレーション（15 場面、系を選べる）。物理と場面の形は `lib/simcore.js` |
| `proto/scratch.html` | 最初の試作 |
| `samples/` | 図の見本を作るスクリプト（`node samples/make.js`、`node samples/scenes.js`） |

## 検査

- 生成器: `node test/gen.test.js` … 全種類を 300 回ずつ作り、作り直し・正誤判定・刻み・図の崩れ・使わない言葉を調べる（`NG 0`）
- アプリ: ローカルで `python3 -m http.server 8765 --bind 127.0.0.1` を立て、
  `google-chrome --headless=new --virtual-time-budget=15000 --dump-dom "http://127.0.0.1:8765/index.html?test"` の `data-test` が `TEST ALL OK`
  （電卓・計算用紙・お金だけなら「読む」だけ・4 つの出題形式それぞれ全問正解で記録が本物になるか・書き換えを見抜くか）
- 先生用ページ: 同じく `verify.html?test`
- シミュレーション: 同じく `sim.html?test`（15 場面それぞれの終わり方・力学的エネルギーと摩擦力の仕事の和が一定・
  落ちる速さ・曲面の高さ・飛んでいちばん高い所・摩擦力の仕事などを式の値と比べる・系の選び方で棒と矢印が変わる・矢印の値と棒の差がそろう・予想の点で止まる）。
  `sim.html?s=場面&t=1.2[&ref=0.6][&pt=A][&nospring][&noearth][&light]` でその時刻まで進めた画面を出す（場面の名前は `lib/simcore.js` の `SCENES`）
- 画面の確認: `index.html?demo=read|draw|choose|calc&q=種類-たね[&fb=1]` で、その問題（答えた後の画面）を出す
- 生成器の検査は「まえ」「あと」「段」などの使わない言葉と、図の入れ忘れも調べる

## 罠

- 解説の図の目盛り: 足りない棒を 0 で埋めずに合計を出すと NaN になり、目盛りが既定の 10 J に落ちて棒が小さくなった（`gen.js` の eChart）。検査に「目盛りが数か」を足した。
- 有効数字で正誤を決めない: ±3 % だけだと 13.5 → 14 が外れる。2 桁に丸めた幅も正解にした（`EGen.check`）。
