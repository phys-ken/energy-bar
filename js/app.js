/* エネルギー棒グラフ 演習（生徒用）。決まりは docs/decisions.md。
 * ホーム（ニックネーム・単元・出題形式）→ 10 問（時間つき）→ 結果（記録の画像と QR）。
 * 画面: 問題文と問いは 1 か所、その下に図、そのすぐ下で答える（先生の指摘 2026-11-15）。
 * URL: ?test で自己テスト（結果をタイトルに出す）。?demo=形式&q=種類-たね[&fb=1] で見本表示
 */
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const LS = { name: 'ebar.nick', format: 'ebar.format', units: 'ebar.units' };
  const N_Q = 10;
  const APP_CHART = { theme: 'color', fs: 5.2, fsName: 4.4, fsTitle: 5.0, fsWork: 4.2 };   // スマホで数字が 14 px 以上になる大きさ

  const st = { format: 'read', units: ['M'], quiz: null };
  // 図の文字も画面と同じ書体に（問題文と図で書体が変わらないように）
  EBar.setFonts('"BIZ UDPGothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif');

  /* ---------- ホーム ---------- */
  function renderHome() {
    $('name').value = localStorage.getItem(LS.name) || '';
    st.format = localStorage.getItem(LS.format) || 'read';
    try { st.units = JSON.parse(localStorage.getItem(LS.units)) || ['M']; } catch (_) { st.units = ['M']; }
    $('units').innerHTML = EGen.UNITS.map(u => `<label data-u="${u.id}"><input type="checkbox" value="${u.id}">${u.name}</label>`).join('');
    $('formats').innerHTML = EGen.FORMATS.map(f => `<button type="button" data-f="${f.id}">${f.name}<span class="t">1 問 ${f.time} 秒</span></button>`).join('');
    syncHome();
  }
  const okFormats = () => EGen.FORMATS.filter(f => EGen.available(f.n, st.units).length).map(f => f.id);
  function syncHome() {
    document.querySelectorAll('#units label').forEach(l => {
      const on = st.units.includes(l.dataset.u); l.classList.toggle('on', on); l.querySelector('input').checked = on;
    });
    const ok = okFormats();
    if (!ok.includes(st.format) && ok.length) st.format = ok[0];
    document.querySelectorAll('#formats button').forEach(b => {
      b.classList.toggle('on', b.dataset.f === st.format);
      b.disabled = !ok.includes(b.dataset.f);
    });
  }
  $('units').addEventListener('change', () => { st.units = [...document.querySelectorAll('#units input:checked')].map(i => i.value); syncHome(); });
  $('formats').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; st.format = b.dataset.f; syncHome(); });
  $('start').onclick = () => {
    const name = $('name').value.trim();
    if (!name) { $('homeMsg').textContent = 'ニックネームを入れてください（本名は入れないでください）。'; $('name').focus(); return; }
    if (!st.units.length) { $('homeMsg').textContent = '単元を 1 つ以上選んでください。'; return; }
    if (!okFormats().includes(st.format)) { $('homeMsg').textContent = '出題形式を選んでください。'; return; }
    $('homeMsg').textContent = '';
    localStorage.setItem(LS.name, name); localStorage.setItem(LS.format, st.format); localStorage.setItem(LS.units, JSON.stringify(st.units));
    startQuiz();
  };

  function show(view) { ['vHome', 'vQuiz', 'vResult'].forEach(v => $(v).classList.toggle('hidden', v !== view)); }

  /* ---------- 10 問 ---------- */
  function startQuiz() {
    const f = EGen.fmtOf(st.format);
    st.quiz = { format: f, units: st.units.slice(), limit: f.time, qs: EGen.quiz(f.n, st.units, N_Q), i: 0, items: [],
      id: recordLib.newRecordId(), start: new Date(), name: $('name').value.trim() };
    Pad.reset(); Calc.clear();
    show('vQuiz');
    renderQ();
  }

  let timer = null, t0 = 0, answered = false, input = '', drawVal = null;
  const cur = () => st.quiz.qs[st.quiz.i];
  function chartSVG(c, extra) { return EBar.chart(c.states, Object.assign({}, c.opt, APP_CHART, extra || {})); }

  function renderQ() {
    const qz = st.quiz, q = cur();
    answered = false; input = ''; drawVal = null;
    $('qFormat').innerHTML = `<span class="lbl">${qz.format.name}</span>`;
    $('qNum').textContent = `${qz.i + 1} / ${qz.qs.length}`;
    $('qSys').textContent = q.sys ? `系：${q.sys}` : '';
    $('qSys').classList.toggle('hidden', !q.sys);
    $('qText').innerHTML = q.text;
    $('qAsk').innerHTML = q.ask;
    $('qScene').innerHTML = q.scene ? EScene.scene(q.scene, { theme: 'color' }) : '';
    // 場面の図は中身に合わせて切り詰めてあるので、幅いっぱいに引きのばさず、実寸 × 一定の倍率で出す（文字が約 15 px）
    const ssvg = $('qScene').querySelector('svg');
    if (ssvg) { const mm = parseFloat(ssvg.getAttribute('width')); ssvg.style.width = Math.round(mm * 3.6) + 'px'; ssvg.style.maxWidth = '100%'; }
    $('feedback').classList.add('hidden'); $('feedback').innerHTML = '';
    $('answerArea').classList.remove('hidden');
    const ch = $('qChart'); ch.className = 'chart';
    const a = q.answer;
    if (a.kind === 'num') {
      ch.innerHTML = q.chart ? chartSVG(q.chart) : '';
      $('answerArea').innerHTML = `<div class="ansrow"><span class="anslbl">答え</span><div id="ansbox" class="ansbox empty">数を入れる</div><span class="unit">${a.unit}</span></div>` +
        `<div class="keypad" id="keypad">${['7', '8', '9', '⌫', '4', '5', '6', '−', '1', '2', '3', '.'].map(k => `<button type="button" data-k="${k}">${k}</button>`).join('')}` +
        `<button type="button" data-k="0" class="wide">0</button><button type="button" data-k="ok" class="wide go">決定</button></div>`;
      $('keypad').addEventListener('click', onKey);
    } else if (a.kind === 'draw') {
      ch.classList.add('draw');
      drawVal = { K: 0, Us: 0, Ug: 0 };
      ch.innerHTML = drawSVG();
      bindDraw();
      $('answerArea').innerHTML = `<div class="drawbtns"><button type="button" id="dReset">0 にもどす</button><button type="button" id="dOk" class="primary">決定</button></div>`;
      $('dReset').onclick = () => { drawVal = { K: 0, Us: 0, Ug: 0 }; redrawDraw(); };
      $('dOk').onclick = () => finish(drawVal);
    } else if (a.kind === 'choice') {
      ch.className = 'chart wide';
      ch.innerHTML = `<div class="choices">${a.choices.map((c, i) => `<div class="choice" data-i="${i}"><span class="mk">${'ABC'[i]}</span>${chartSVG(c, { fs: 5.0 })}</div>`).join('')}</div>`;
      ch.querySelectorAll('.choice').forEach(el => el.onclick = () => { if (!answered) { el.classList.add('sel'); finish(+el.dataset.i); } });
      $('answerArea').innerHTML = `<p class="dim">正しい棒グラフをタップして答える</p>`;
    }
    $('figs').classList.toggle('stack', a.kind === 'choice');
    $('qscroll').scrollTop = 0;
    Pad.load('q' + qz.i);
    startTimer();
  }

  /* 数字キー */
  function onKey(e) {
    const b = e.target.closest('button'); if (!b || answered) return;
    const k = b.dataset.k;
    if (k === 'ok') { if (input === '' || input === '-' || input === '.') return; finish(input); return; }
    if (k === '⌫') input = input.slice(0, -1);
    else if (k === '−') input = input.startsWith('-') ? input.slice(1) : '-' + input;
    else if (k === '.') { if (!input.includes('.')) input += (input === '' || input === '-' ? '0' : '') + '.'; }
    else if (input.replace(/[-.]/g, '').length < 8) input = (input === '0' ? '' : input === '-0' ? '-' : input) + k;
    showInput();
  }
  function showInput() {
    const box = $('ansbox'); if (!box) return;
    box.textContent = input === '' ? '数を入れる' : input.replace('-', '−');
    box.classList.toggle('empty', input === '');
  }

  /* 棒グラフをかく（終わりの場面の 3 本をドラッグ。10 J 刻み） */
  function drawStates() {
    const c = cur().chart, s1 = Object.assign({}, c.states[1], drawVal, { blank: false });
    return { states: [c.states[0], s1], opt: Object.assign({}, c.opt, APP_CHART) };
  }
  function drawSVG() { const d = drawStates(); return EBar.chart(d.states, d.opt); }
  function redrawDraw() {
    const svg = $('qChart').querySelector('svg'), tmp = document.createElement('div');
    tmp.innerHTML = drawSVG(); svg.innerHTML = tmp.querySelector('svg').innerHTML;
  }
  function bindDraw() {
    const svg = $('qChart').querySelector('svg');
    let col = null;
    const geo = () => { const d = drawStates(); return EBar.layout(d.states, d.opt); };
    const toSvg = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const set = (e, L) => {
      const p = toSvg(e), k = ['K', 'Us', 'Ug'][col];
      drawVal[k] = Math.max(0, Math.min(L.unitsUp * L.unit, Math.round((L.baseY - p.y) / L.mpu) * L.unit));
      redrawDraw();
    };
    svg.addEventListener('pointerdown', e => {
      if (answered) return;
      const L = geo(), p = toSvg(e); col = null;
      for (let j = 0; j < 3; j++) { const x = L.barX(1, j); if (p.x >= x - L.gap / 2 && p.x <= x + L.bw + L.gap / 2) col = j; }
      if (col === null) return;
      e.preventDefault(); cap(svg, e.pointerId); set(e, L);
    });
    svg.addEventListener('pointermove', e => { if (col !== null && !answered) set(e, geo()); });
    const up = () => { col = null; };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    ['touchstart', 'touchmove'].forEach(t => svg.addEventListener(t, e => { if (col !== null) e.preventDefault(); }, { passive: false }));
  }

  /* 時間 */
  function startTimer() {
    stopTimer(); t0 = performance.now();
    const lim = st.quiz.limit * 1000, bar = $('timerBar'), txt = $('timerTxt');
    const tick = () => {
      const left = Math.max(0, lim - (performance.now() - t0));
      bar.style.transform = `scaleX(${left / lim})`; bar.classList.toggle('low', left < 10000);
      txt.textContent = Math.ceil(left / 1000) + '秒';
      if (left <= 0) { finish(null, true); return; }
      timer = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopTimer() { if (timer) cancelAnimationFrame(timer); timer = null; }

  /* 答えた／時間切れ */
  function finish(value, timedOut) {
    if (answered) return;
    answered = true; stopTimer();
    const qz = st.quiz, q = cur(), elapsed = Math.min(qz.limit, (performance.now() - t0) / 1000);
    const ok = !timedOut && EGen.check(q, q.answer.kind === 'num' ? String(value) : value);
    qz.items.push({ qid: q.qid, input: timedOut ? '-' : EGen.fmtIn(q, value), ans: EGen.fmtAns(q), verdict: timedOut ? 'timeout' : (ok ? 'ok' : 'ng'), elapsedSec: elapsed });
    Pad.save('q' + qz.i);
    showFeedback(q, ok, timedOut, value);
  }
  function correctText(q) {
    const a = q.answer;
    if (a.kind === 'num') return `正解は <b>${(a.show || EGen.f2(a.value)).replace('-', '−')} ${a.unit}</b>`;
    if (a.kind === 'draw') return `正解は 運動 <b>${a.target.K} J</b>・ばね <b>${a.target.Us} J</b>・重力 <b>${a.target.Ug} J</b>`;
    return `正解は <b>${'ABC'[a.correct]}</b>`;
  }
  function showFeedback(q, ok, timedOut, value) {
    const a = q.answer;
    let h = (timedOut ? '<div class="verdict ng">時間切れ</div>' : ok ? '<div class="verdict ok">正解</div>' : '<div class="verdict ng">不正解</div>') + `<div>${correctText(q)}</div>`;
    if (a.kind === 'choice') {
      $('qChart').querySelectorAll('.choice').forEach((el, i) => { el.classList.toggle('right', i === a.correct); el.classList.toggle('wrong', i === value && i !== a.correct); });
      if (!ok && value != null) h += `<p><b>${'ABC'[value]}</b>：${a.why[value]}</p>`;
      h += `<p><b>${'ABC'[a.correct]}</b>：${a.why[a.correct].replace(/^正解。/, '')}</p>`;
    } else h += `<ul>${q.explain.map(s => `<li>${s}</li>`).join('')}</ul>`;
    // 答えの棒グラフは、図を増やさずに同じ場所の図を入れ替える（問題の図か解答の図か分からなくならないように。先生の指摘 2026-11-16）
    if (q.explainChart && a.kind !== 'choice') { $('qChart').className = 'chart'; $('qChart').innerHTML = chartSVG(q.explainChart); }
    const last = st.quiz.i === st.quiz.qs.length - 1;
    h += `<button type="button" class="big primary next" id="next">${last ? '結果を見る' : '次へ'}</button>`;
    $('answerArea').classList.add('hidden');
    $('feedback').innerHTML = h; $('feedback').classList.remove('hidden');
    $('feedback').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('next').onclick = next;
  }
  function next() {
    const qz = st.quiz;
    if (qz.i < qz.qs.length - 1) { qz.i++; renderQ(); return; }
    qz.end = new Date(); closeSheet(); Calc.close();
    showResult();
  }

  /* ---------- 結果と記録 ---------- */
  // 記録の course 行: 「単元,単元 出題形式」（例 K,Us read）
  const courseOf = qz => qz.units.join(',') + ' ' + qz.format.id;
  const courseTitle = qz => `${qz.format.name}｜` + qz.units.map(u => EGen.UNITS.find(x => x.id === u).name).join('・');
  function showResult() {
    const qz = st.quiz, ok = qz.items.filter(it => it.verdict === 'ok').length;
    show('vResult');
    $('rScore').textContent = `${ok} / ${qz.items.length}`;
    $('rClear').classList.toggle('hidden', ok !== qz.items.length);
    $('rList').innerHTML = qz.items.map((it, i) => {
      const q = qz.qs[i], lab = it.verdict === 'ok' ? '<span class="ok">正解</span>' : it.verdict === 'timeout' ? '<span class="ng">時間切れ</span>' : '<span class="ng">不正解</span>';
      return `<li>${lab}　${q.ask.replace(/<[^>]+>/g, '').slice(0, 30)}　<span class="dim">${it.elapsedSec.toFixed(1)} 秒</span></li>`;
    }).join('');
    const rec = { id: qz.id, name: qz.name, course: courseOf(qz), start: qz.start, end: qz.end, limitSec: qz.limit, items: qz.items };
    $('recordImg').removeAttribute('src');
    return recordLib.buildQrTexts(rec).then(qr => {
      const url = drawRecord(rec, qr, qz, ok);
      $('recordImg').src = url; $('recordDl').href = url; $('recordDl').download = `回答記録_${qz.id}.png`;
      return qr;
    });
  }
  function drawQr(ctx, text, x, y, size) {
    const qr = qrcode(0, 'L'); qr.addData(text, 'Byte'); qr.make();
    const n = qr.getModuleCount(), quiet = 4, cell = Math.floor(size / (n + quiet * 2)), real = cell * (n + quiet * 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, real, real); ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell, cell);
    return real;
  }
  function drawRecord(rec, qr, qz, ok) {
    const W = 1080, pad = 56, rowH = 50, qrSize = 600, H = 330 + rec.items.length * rowH + 30 + qrSize + 40;
    const cv = $('recordCanvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), font = '"BIZ UDPGothic", "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#1f5fbf'; ctx.fillRect(0, 0, W, 12);
    ctx.textBaseline = 'top'; ctx.fillStyle = '#151515'; ctx.font = '700 40px ' + font;
    ctx.fillText('エネルギー棒グラフ 演習 回答記録', pad, 44);
    ctx.font = '400 24px ' + font; ctx.fillStyle = '#555';
    const ct = courseTitle(qz) + '（1 問 ' + rec.limitSec + ' 秒）';
    ctx.fillText(ct.length > 40 ? ct.slice(0, 40) + '…' : ct, pad, 98);
    const info = [['ニックネーム', rec.name], ['回答日時', recordLib.formatLocalIso(rec.start).replace('T', ' ').slice(0, 19) + ' 〜 ' + recordLib.formatLocalIso(rec.end).slice(11, 19)], ['記録ID', rec.id]];
    ctx.font = '400 28px ' + font;
    info.forEach((r, i) => { ctx.fillStyle = '#6e767d'; ctx.fillText(r[0], pad, 156 + i * 42); ctx.fillStyle = '#151515'; ctx.fillText(String(r[1]), pad + 190, 156 + i * 42); });
    ctx.textAlign = 'right'; ctx.font = '400 26px ' + font; ctx.fillStyle = '#555'; ctx.fillText('得点', W - pad, 30);
    ctx.font = '700 84px ' + font; ctx.fillStyle = ok === rec.items.length ? '#14803a' : '#151515';
    ctx.fillText(ok + ' / ' + rec.items.length, W - pad, 60);
    if (ok === rec.items.length) { ctx.font = '800 44px ' + font; ctx.fillStyle = '#14803a'; ctx.fillText('クリア', W - pad, 158); }
    ctx.textAlign = 'left';
    const top = 330; ctx.fillStyle = '#151515'; ctx.fillRect(pad, top - 6, W - pad * 2, 2);
    ctx.font = '400 26px ' + font;
    rec.items.forEach((it, k) => {
      const y = top + k * rowH + 10;
      ctx.fillStyle = '#151515'; ctx.fillText('問' + (k + 1), pad, y); ctx.fillText(it.qid, pad + 90, y);
      ctx.fillStyle = it.verdict === 'ok' ? '#14803a' : '#c62828';
      ctx.fillText(it.verdict === 'ok' ? '正解' : it.verdict === 'timeout' ? '時間切れ' : '不正解', pad + 560, y);
      ctx.fillStyle = '#555'; ctx.textAlign = 'right'; ctx.fillText(Number(it.elapsedSec).toFixed(1) + '秒', W - pad, y); ctx.textAlign = 'left';
      ctx.fillStyle = '#d8dce0'; ctx.fillRect(pad, top + (k + 1) * rowH - 2, W - pad * 2, 1);
    });
    const qrTop = top + rec.items.length * rowH + 30;   // 記録データ（大きく）と照合コード（小さく）。見出しは付けない
    drawQr(ctx, qr.recordText, pad - 8, qrTop, qrSize);
    drawQr(ctx, qr.checkText, W - pad - 340 + 8, qrTop, 340);
    return cv.toDataURL('image/png');
  }
  $('again').onclick = () => startQuiz();
  $('home').onclick = () => { show('vHome'); syncHome(); };

  /* ---------- 外から使う口（電卓の「答に入れる」・自己テスト） ---------- */
  window.App = { setInput(v) { if (answered || !cur() || cur().answer.kind !== 'num') return; input = String(v).replace('−', '-'); showInput(); } };

  renderHome();

  /* ---------- 見本（画面の確認用） ---------- */
  const dm = /[?&]demo=([a-z]+)/.exec(location.search);
  if (dm) {
    $('name').value = '見本'; st.format = dm[1]; st.units = EGen.UNITS.map(u => u.id);
    startQuiz();
    const sd = /[?&]q=(L\d[A-Za-z]+-[0-9a-f]+)/.exec(location.search);
    if (sd) { st.quiz.qs[0] = EGen.regen(sd[1]); renderQ(); }
    stopTimer();
    if (/[?&]fb=1/.test(location.search)) { const a = cur().answer; finish(a.kind === 'choice' ? (a.correct + 1) % 3 : a.kind === 'draw' ? { K: 0, Us: 0, Ug: 0 } : '1'); }
  }

  /* ---------- 自己テスト ---------- */
  if (/[?&]test/.test(location.search)) setTimeout(selfTest, 300);
  async function selfTest() {
    const out = [], ok = (n, c) => out.push((c ? 'OK ' : 'NG ') + n);
    const E = Calc.evaluate;
    ok('四則', E('2×9.8×10') === 196); ok('ルート', E('√196') === 14); ok('2√2', Math.abs(E('2√2') - 2 * Math.SQRT2) < 1e-12);
    let err = ''; try { E('5÷0'); } catch (x) { err = x; } ok('0で割る', err === 'div0');
    $('bSheet').click(); await new Promise(r => setTimeout(r, 300));
    const cv = Pad._test.cv, r = cv.getBoundingClientRect();
    const fire = (t, x, y, type = 'pen') => cv.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: type, clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, pressure: .5, buttons: t === 'pointerup' ? 0 : 1 }));
    fire('pointerdown', 40, 40); for (let i = 1; i <= 10; i++) fire('pointermove', 40 + i * 8, 40 + i * 3); fire('pointerup', 120, 70);
    ok('ペンで1本', Pad.count() === 1);
    fire('pointerdown', 60, 60, 'touch'); fire('pointermove', 120, 90, 'touch'); fire('pointerup', 120, 90, 'touch');
    ok('ペン使用後は指を無視', Pad.count() === 1);
    closeSheet();
    // ホーム: お金だけ選ぶと「読む」以外は押せない
    st.units = ['M']; syncHome();
    ok('お金だけなら読むだけ', [...document.querySelectorAll('#formats button')].filter(b => !b.disabled).map(b => b.dataset.f).join() === 'read');
    // 各出題形式を、全部の単元で 1 回ずつ全問正解で通す
    $('name').value = 'テスト';
    for (const f of EGen.FORMATS) {
      st.format = f.id; st.units = EGen.UNITS.map(u => u.id);
      try {
        startQuiz();
        for (let i = 0; i < N_Q; i++) {
          const a = cur().answer;
          if (a.kind === 'draw') { Object.assign(drawVal, a.target); redrawDraw(); finish(drawVal); }
          else if (a.kind === 'choice') finish(a.correct);
          else { App.setInput(String(a.value)); finish(String(a.value)); }
          if (i < N_Q - 1) next(); else { st.quiz.end = new Date(); closeSheet(); Calc.close(); }
        }
        const qr = await showResult();
        const v = await recordLib.verifyPair(qr.recordText, qr.checkText);
        ok(`${f.name} 全問正解で記録が本物`, v.ok && st.quiz.items.every(it => it.verdict === 'ok'));
        ok(`${f.name} 書き換えを見抜く`, !(await recordLib.verifyPair(qr.recordText.replace('score=10/10', 'score=9/10'), qr.checkText)).ok);
      } catch (e) { ok(`${f.name} 例外 ${e.message}`, false); console.error(e); }
    }
    document.title = 'TEST ' + (out.every(s => s.startsWith('OK')) ? 'ALL OK' : 'FAIL') + ' | ' + out.join(' / ');
    document.body.dataset.test = document.title;
  }
})();
