/* verify.js — 提出された回答記録画像の照合（先生用）。力のカードゲームの verify.js を元に、
 * 問題の作り直し（種類とたね → EGen.regen）と CSV を足した。
 * 1 枚の画像から 2 つの QR を読む：1 つ読めたらその場所を白く塗りつぶして、もう 1 度読む。
 */
'use strict';
const MAX_SCAN_WIDTH = 2000;
const verifier = {
  results: [],
  loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img); img.onerror = () => reject(new Error('画像を開けない'));
      img.src = URL.createObjectURL(file);
    });
  },
  scanQrs(img, maxCount) {
    const scale = Math.min(1, MAX_SCAN_WIDTH / img.naturalWidth), w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
    const found = [];
    for (let n = 0; n < maxCount; n++) {
      const res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (!res) break;
      found.push(res.data); this.mask(ctx, res.location);
    }
    return found;
  },
  mask(ctx, loc) {
    const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
    let cx = 0, cy = 0; pts.forEach(p => { cx += p.x / 4; cy += p.y / 4; });
    ctx.fillStyle = '#fff'; ctx.beginPath();
    pts.forEach((p, i) => { const x = cx + (p.x - cx) * 1.15, y = cy + (p.y - cy) * 1.15; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fill();
  },
  pickPair(texts) {
    let recordText = '', checkText = '';
    texts.forEach(t => { if (t.indexOf(RECORD_HEAD) === 0) recordText = t; else if (t.indexOf(CHECK_HEAD) === 0) checkText = t; });
    return { recordText, checkText };
  },
  async checkFile(file) {
    try {
      const img = await this.loadImage(file), texts = this.scanQrs(img, 4), pair = this.pickPair(texts);
      if (!pair.recordText || !pair.checkText)
        return { file: file.name, ok: false, readable: false, reasons: [`QR を 2 つ読み取れない（読めた数: ${texts.length}）。画像が切れていないか、ぼやけていないか確認`], record: null };
      const v = await recordLib.verifyPair(pair.recordText, pair.checkText);
      v.file = file.name; v.readable = true; return v;
    } catch (err) { return { file: file.name, ok: false, readable: false, reasons: [String(err.message || err)], record: null }; }
  },
  esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  // course 行は「単元,単元 出題形式」（例 K,Us read）
  courseName(c) {
    const m = /^([A-Za-z,]+) ([a-z]+)$/.exec(c || ''); if (!m) return c || '';
    const f = EGen.fmtOf(m[2]);
    return `${f ? f.name : m[2]}｜` + m[1].split(',').map(u => (EGen.UNITS.find(x => x.id === u) || { name: u }).name).join('・');
  },
  rows() {
    const idCount = {};
    this.results.forEach(r => { if (r.record && r.record.fields.id) idCount[r.record.fields.id] = (idCount[r.record.fields.id] || 0) + 1; });
    return this.results.map(r => {
      const f = (r.record && r.record.fields) || {}, notes = r.reasons.slice(), dup = f.id && idCount[f.id] > 1;
      if (dup) notes.push(`同じ記録IDの画像が ${idCount[f.id]} 枚ある（使い回しの疑い）`);
      const verdict = !r.readable ? '読めない' : r.ok ? (dup ? '本物・重複' : '本物') : '不一致';
      return { r, f, notes, verdict, when: f.start ? f.start.replace('T', ' ').slice(0, 19) : '' };
    });
  },
  render() {
    const cls = { '本物': 'ok', '本物・重複': 'warn', '不一致': 'ng', '読めない': 'warn' };
    const rows = this.rows();
    document.querySelector('#result-table tbody').innerHTML = rows.map((x, i) =>
      `<tr class="rec" data-i="${i}"><td>${this.esc(x.r.file)}</td><td><span class="${cls[x.verdict]}">${x.verdict}</span></td><td>${this.esc(x.f.name)}</td>` +
      `<td>${this.esc(this.courseName(x.f.course))}</td><td>${this.esc(x.f.score)}</td><td>${this.esc(x.when)}</td><td>${this.esc(x.f.id)}</td><td>${this.esc(x.notes.join(' / '))}</td></tr>`).join('');
    document.getElementById('result-table').hidden = false;
    document.getElementById('csv-btn').hidden = false;
    const okN = this.results.filter(r => r.ok).length;
    document.getElementById('summary').textContent = `${this.results.length} 枚を確認：本物 ${okN} 枚／それ以外 ${this.results.length - okN} 枚`;
  },
  showDetail(i) {
    const r = this.results[i], box = document.getElementById('detail');
    if (!r || !r.record) { box.innerHTML = ''; return; }
    const f = r.record.fields;
    let h = `<div class="detail"><b>${this.esc(f.name)}</b>　${this.esc(this.courseName(f.course))}　得点 ${this.esc(f.score)}`;
    r.record.items.forEach((it, k) => {
      let q = null; try { q = EGen.regen(it.qid); } catch (_) {}
      const v = it.verdict === 'ok' ? '<span class="ok">正解</span>' : it.verdict === 'timeout' ? '<span class="ng">時間切れ</span>' : '<span class="ng">不正解</span>';
      h += `<div class="qd"><div class="t"><b>問${k + 1}</b>　${v}　${this.esc(it.sec)}<br><code>${this.esc(it.qid)}</code><br>入れた答え <b>${this.esc(this.showAns(q, it.input))}</b>／正解 <b>${this.esc(this.showAns(q, it.ans))}</b>`;
      if (q) h += `<p>${q.text}<br><b>${q.ask}</b></p>`;
      h += `</div><div>`;
      if (q && q.scene) h += EScene.scene(q.scene);
      if (q && q.chart) h += EBar.chart(q.chart.states, Object.assign({}, q.chart.opt, { theme: 'color' }));
      if (q && q.explainChart) h += EBar.chart(q.explainChart.states, Object.assign({}, q.explainChart.opt, { theme: 'color' }));
      h += `</div></div>`;
    });
    box.innerHTML = h + '</div>';
    box.scrollIntoView({ behavior: 'smooth' });
  },
  showAns(q, s) {
    if (!q || s === '-' || s == null) return s;
    if (q.answer.kind === 'choice') return ['①', '②', '③'][+s] || s;   // アプリと同じ記号
    if (q.answer.kind === 'draw') { const p = String(s).split('/'); return `運動 ${p[0]}・ばね ${p[1]}・重力 ${p[2]}`; }
    return s + ' ' + q.answer.unit;
  },
  csv() {
    const head = ['画像', '判定', 'ニックネーム', '出題形式・単元', '得点', '回答日時', '記録ID', '理由・注意'];
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(',')].concat(this.rows().map(x => [x.r.file, x.verdict, x.f.name, this.courseName(x.f.course), x.f.score, x.when, x.f.id, x.notes.join(' / ')].map(q).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '回答記録の確認.csv'; a.click();
  },
  async onFiles(list) {
    const files = Array.from(list || []); if (!files.length) return;
    document.getElementById('summary').textContent = `${files.length} 枚を読み取り中…`;
    this.results = [];
    for (const f of files) this.results.push(await this.checkFile(f));
    this.render();
  },
  async onPaste() {
    const v = await recordLib.verifyPair(document.getElementById('paste-record').value.trim(), document.getElementById('paste-check').value.trim());
    const f = v.record.fields, out = document.getElementById('paste-result');
    out.textContent = (v.ok ? '本物' : '不一致：' + v.reasons.join(' / ')) + `\nニックネーム: ${f.name || ''}\n出題形式・単元: ${this.courseName(f.course)}\n得点: ${f.score || ''}\n開始: ${f.start || ''}\n記録ID: ${f.id || ''}`;
    out.hidden = false;
  },
};
document.getElementById('file-input').addEventListener('change', e => verifier.onFiles(e.target.files));
document.getElementById('paste-verify-btn').addEventListener('click', () => verifier.onPaste());
document.getElementById('csv-btn').addEventListener('click', () => verifier.csv());
document.querySelector('#result-table tbody').addEventListener('click', e => { const tr = e.target.closest('tr.rec'); if (tr) verifier.showDetail(+tr.dataset.i); });

// 自己テスト（?test）: 記録を作って照合し、作り直した問題の表示まで通す
if (/[?&]test/.test(location.search)) (async () => {
  const qs = EGen.quiz(EGen.fmtOf('draw').n, ['K', 'Us', 'Ug', 'C', 'F']);
  const items = qs.map(q => ({ qid: q.qid, input: EGen.fmtAns(q), ans: EGen.fmtAns(q), verdict: 'ok', elapsedSec: 3 }));
  const rec = { id: recordLib.newRecordId(), name: 'テスト', course: 'K,Us,Ug,C,F draw', start: new Date(), end: new Date(), limitSec: 45, items };
  const qr = await recordLib.buildQrTexts(rec);
  const v = await recordLib.verifyPair(qr.recordText, qr.checkText); v.file = 'x.png'; v.readable = true;
  verifier.results = [v, Object.assign({}, v, { file: 'y.png' })];
  verifier.render(); verifier.showDetail(0);
  const n = document.querySelectorAll('#detail .qd').length, dupe = /重複/.test(document.querySelector('#result-table').textContent);
  document.body.dataset.test = document.title = `TEST ${v.ok && n === 10 && dupe ? 'ALL OK' : 'FAIL'} | 本物 ${v.ok} / 問題の表示 ${n} / 重複の検出 ${dupe}`;
})();
