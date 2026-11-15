/**
 * record.js — 回答記録（QR①）と照合コード（QR②）。力のカードゲームの GitHub 版と同じ仕組み（docs/decisions.md 8）。
 * 生徒用の app.js と、先生用の verify.js の両方が使う。ルールを変えるときは RECORD_VERSION を上げる。
 *
 * QR① 記録データ
 *   ENERGY-BAR RECORD v1
 *   id=記録ID / name=名前 / course=段 単元 / start / end / score=得点 / limit=制限時間
 *   q01=種類-たね in=入れた答え ans=正解 ok|ng|timeout 秒数
 *   salt=ソルト
 *   rule=照合のしかた
 * QR② 照合コード
 *   ENERGY-BAR CHECK v1
 *   id=記録ID
 *   sha256=SHA-256( ソルト + 改行 + QR①の1行目から最後の q 行まで ) の16進64文字
 */
var RECORD_VERSION = 'v1';
var RECORD_SALT = 'bar-chart:stock-and-flow:shigoto-wa-yajirushi';
var RECORD_HEAD = 'ENERGY-BAR RECORD ' + RECORD_VERSION;
var CHECK_HEAD = 'ENERGY-BAR CHECK ' + RECORD_VERSION;
var RECORD_RULE = 'rule=QR2 sha256 = SHA-256(salt + LF + lines 1..last q of this QR); QR2 id = this id';

var recordLib = {
  pad2: function (n) { return n < 10 ? '0' + n : String(n); },
  formatLocalIso: function (d) {
    var off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', abs = Math.abs(off);
    return d.getFullYear() + '-' + this.pad2(d.getMonth() + 1) + '-' + this.pad2(d.getDate()) + 'T' + this.pad2(d.getHours()) + ':' +
      this.pad2(d.getMinutes()) + ':' + this.pad2(d.getSeconds()) + sign + this.pad2(Math.floor(abs / 60)) + ':' + this.pad2(abs % 60);
  },
  newRecordId: function () {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', buf = new Uint8Array(8), id = '';
    crypto.getRandomValues(buf);
    for (var i = 0; i < buf.length; i++) id += chars[buf[i] % chars.length];
    return id;
  },
  /** rec = { id, name, course, start, end, limitSec, items:[{ qid, input, ans, verdict, elapsedSec }] } */
  buildBody: function (rec) {
    var ok = rec.items.filter(function (it) { return it.verdict === 'ok'; }).length;
    var lines = [RECORD_HEAD, 'id=' + rec.id, 'name=' + String(rec.name).replace(/[\r\n]/g, ' '), 'course=' + rec.course,
      'start=' + this.formatLocalIso(rec.start), 'end=' + this.formatLocalIso(rec.end), 'score=' + ok + '/' + rec.items.length, 'limit=' + rec.limitSec + 's'];
    for (var i = 0; i < rec.items.length; i++) {
      var it = rec.items[i];
      lines.push('q' + this.pad2(i + 1) + '=' + it.qid + ' in=' + String(it.input).replace(/\s/g, '') + ' ans=' + it.ans + ' ' + it.verdict + ' ' + Number(it.elapsedSec).toFixed(1) + 's');
    }
    return lines.join('\n');
  },
  buildRecordText: function (body) { return body + '\nsalt=' + RECORD_SALT + '\n' + RECORD_RULE; },
  sha256Hex: function (text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      var arr = new Uint8Array(buf), hex = '';
      for (var i = 0; i < arr.length; i++) hex += (arr[i] < 16 ? '0' : '') + arr[i].toString(16);
      return hex;
    });
  },
  buildQrTexts: function (rec) {
    var body = this.buildBody(rec), recordText = this.buildRecordText(body);
    return this.sha256Hex(RECORD_SALT + '\n' + body).then(function (hex) {
      return { recordText: recordText, checkText: CHECK_HEAD + '\nid=' + rec.id + '\nsha256=' + hex, sha256: hex };
    });
  },
  parseRecordText: function (text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var out = { head: lines[0] || '', fields: {}, items: [], bodyLines: [], saltLine: '' }, saltIdx = -1;
    for (var i = 0; i < lines.length; i++) if (lines[i].indexOf('salt=') === 0) { saltIdx = i; break; }
    out.bodyLines = saltIdx >= 0 ? lines.slice(0, saltIdx) : lines.slice();
    out.saltLine = saltIdx >= 0 ? lines[saltIdx] : '';
    for (var j = 1; j < out.bodyLines.length; j++) {
      var line = out.bodyLines[j], eq = line.indexOf('=');
      if (eq < 0) continue;
      var key = line.slice(0, eq), val = line.slice(eq + 1);
      if (/^q\d+$/.test(key)) {
        var p = val.split(' ');
        out.items.push({ key: key, qid: p[0], input: (p[1] || '').replace(/^in=/, ''), ans: (p[2] || '').replace(/^ans=/, ''), verdict: p[3] || '', sec: p[4] || '', raw: val });
      } else out.fields[key] = val;
    }
    return out;
  },
  parseCheckText: function (text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n'), out = { head: lines[0] || '', id: '', sha256: '' };
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].indexOf('id=') === 0) out.id = lines[i].slice(3);
      if (lines[i].indexOf('sha256=') === 0) out.sha256 = lines[i].slice(7).toLowerCase();
    }
    return out;
  },
  verifyPair: function (recordText, checkText) {
    var rec = this.parseRecordText(recordText), chk = this.parseCheckText(checkText), reasons = [];
    if (rec.head !== RECORD_HEAD) reasons.push('QR①の1行目が「' + RECORD_HEAD + '」ではない');
    if (chk.head !== CHECK_HEAD) reasons.push('QR②の1行目が「' + CHECK_HEAD + '」ではない');
    if (rec.saltLine !== 'salt=' + RECORD_SALT) reasons.push('QR①のソルトが正しくない');
    if (!rec.fields.id || rec.fields.id !== chk.id) reasons.push('QR①とQR②の記録IDが一致しない');
    var okCount = rec.items.filter(function (it) { return it.verdict === 'ok'; }).length;
    if (rec.fields.score !== okCount + '/' + rec.items.length) reasons.push('score の行と q 行の正解数が合わない');
    return this.sha256Hex(RECORD_SALT + '\n' + rec.bodyLines.join('\n')).then(function (hex) {
      if (hex !== chk.sha256) reasons.push('ハッシュが一致しない（QR①の中身が書き換えられたか、QR②が別の記録のもの）');
      return { ok: reasons.length === 0, reasons: reasons, record: rec, check: chk, sha256: hex };
    });
  },
};
if (typeof module === 'object' && module.exports) module.exports = recordLib;
