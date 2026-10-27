/**
 * 送迎表・カレンダー サーバー（Google Apps Script）
 *
 * 保存の原則（手引き 5-1）をサーバー側で守る:
 *  ・クライアントは差分（自分が読んだ版と自分の版）を送り、サーバーがロックの中で最新と統合して書く
 *  ・すべての書込はスクリプトロック（LockService）の中で行う
 *  ・誰が・いつ・何を変えたかを「変更履歴」シートに残す
 *  ・職員ID＋暗証番号でログイン。暗証番号はそのまま保存しない（ソルト付きハッシュ）
 */

var APP = {
  VERSION: '2026.10.27d',
  SESSION_DAYS: 120,
  PIN_FAIL_LIMIT: 5,
  PIN_LOCK_MIN: 15,
  CHUNK: 45000,             // 1セルの上限(5万字)より小さく分割
  EDITIONS: { v1: '', v2: 'v2:', v3: 'v3:' },
  EDITION_LABEL: { v1: '現体制版', v2: '新体制版', v3: 'りんく・ぷれいす版' },
  ROLES: ['管理者', '送迎表', '一般'],
  SH: { ids: '職員ID', log: '変更履歴', auth: '_auth', sess: '_sessions', docs: '_docs' }
};

/* ================= 画面 ================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.mcp) return ContentService.createTextOutput(JSON.stringify({ name: '送迎表', message: 'これはClaudeのカスタムコネクタ用の接続先です。Claudeの「設定 → コネクタ → カスタムコネクタを追加」にこのURLを貼ってください。' })).setMimeType(ContentService.MimeType.JSON);
  var page = p.page === 'sougei' ? 'sougei' : 'calendar';
  var ed = APP.EDITIONS.hasOwnProperty(p.e) ? p.e : 'v1';
  var base = ScriptApp.getService().getUrl();
  var d = /^\d{4}-\d{2}-\d{2}$/.test(String(p.d || '')) ? String(p.d) : '';
  var js = function (v) { return JSON.stringify(v).replace(/</g, '\\u003c'); };
  var html = HtmlService.createHtmlOutputFromFile(page).getContent()
    .replace('/*__BOOT__*/', 'window.__SG_EDITION=' + js(ed) + ';window.__SG_BASE=' + js(base) + ';window.__SG_DATE=' + js(d) + ';');
  return HtmlService.createHtmlOutput(html)
    .setTitle(page === 'sougei' ? '送迎表（' + APP.EDITION_LABEL[ed] + '）' : 'カレンダー')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ================= 初期設定（最初に1回、エディタから実行） ================= */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mk = function (name, header, hide) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, header.length).setValues([header]); sh.setFrozenRows(1); }
    if (hide) sh.hideSheet();
    return sh;
  };
  var ids = mk(APP.SH.ids, ['職員番号', '名前', '権限', '初期暗証番号', '利用停止', '備考'], false);
  mk(APP.SH.log, ['日時', '職員番号', '名前', '種類', '対象', '内容'], false);
  mk(APP.SH.auth, ['職員番号', 'salt', 'hash', '失敗回数', 'ロック解除', '変更済み'], true);
  mk(APP.SH.sess, ['tokenHash', '職員番号', '期限', '端末'], true);
  mk(APP.SH.docs, ['path', 'rev', 'at', 'meta', 'parts'], true);
  if (ids.getLastRow() < 2) {
    ids.appendRow([txt_('000'), '管理者', '管理者', txt_(randomPin_()), '', '最初のログイン用。職員の登録が済んだら利用停止にしてください']);
  }
  syncStaffIds_();
  Logger.log('初期設定が完了しました。「職員ID」シートの000の初期暗証番号でログインできます。');
}

/* ================= 入口：すべての呼び出しはここを通る ================= */
function api(token, method, args) {
  try {
    if (method === 'auth.login') return ok_(login_(args[0], args[1], args[2]));
    var me = session_(token);
    if (!me) return err_('auth', 'ログインし直してください');
    var h = HANDLERS[method];
    if (!h) return err_('invalid_argument', '不明な操作です');
    return ok_(h(me, args || []));
  } catch (e) {
    if (e && e.code) return err_(e.code, e.message || '');
    console.error(e && e.stack || e);
    return err_('unavailable', String(e && e.message || e));
  }
}
var HANDLERS = {
  'auth.me': function (me) { return publicMe_(me); },
  'auth.logout': function (me, a) { logout_(a[0]); return true; },
  'auth.changePin': function (me, a) { return changePin_(me, a[0], a[1]); },
  'staff.list': function (me) { return staffList_(); },
  'kv.get': function (me, a) { return kvGet_(String(a[0])); },
  'kv.getMany': function (me, a) { var idx = docIndex_(); return (a[0] || []).slice(0, 60).map(function (k) { var d = docGet_(kvPath_(String(k)), idx); return { key: String(k), rev: d ? d.rev : 0, value: d ? d.value.v : null }; }); },
  'names.list': function (me) { return namesList_(); },
  'kv.importMany': function (me, a) { return kvImportMany_(me, a[0] || []); },
  'kv.list': function (me, a) { return kvList_(String(a[0] || '')); },
  'kv.merge': function (me, a) { return kvMerge_(me, a[0]); },
  'kv.cas': function (me, a) { return kvCas_(me, a[0]); },
  'sync.poll': function (me, a) { return poll_(a[0] || {}); },
  'docs.query': function (me, a) { return docsQuery_(a[0] || {}); },
  'docs.get': function (me, a) { return docGetPublic_(String(a[0])); },
  'cal.apply': function (me, a) { return calApply_(me, a[0]); },
  'log.list': function (me, a) { if (me.role !== '管理者') throw { code: 'denied', message: '管理者のみ' }; return logList_(a[0] || 200); },
  'ai.messages': function (me, a) { return aiMessages_(me, a[0]); },
  'prop.list': function (me) { if (me.role !== '管理者' && me.role !== '送迎表') return []; return propList_(); },
  'prop.apply': function (me, a) { return propApply_(me, String(a[0])); },
  'prop.discard': function (me, a) { if (me.role !== '管理者' && me.role !== '送迎表') throw { code: 'denied', message: '権限がありません' }; return propDiscard_(me, String(a[0])); }
};
function ok_(data) { return { ok: true, data: data }; }
function err_(code, message) { return { ok: false, code: code, message: message }; }
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw { code: 'busy', message: '混み合っています' };
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ================= 職員ID・ログイン ================= */
function sheet_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function rows_(name) { var sh = sheet_(name); var n = sh.getLastRow(); if (n < 2) return []; return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues(); }
function pad3_(n) { return ('000' + n).slice(-3); }
/* スプレッドシートは「0123」を数値123に、「=」「+」「-」で始まる文字を数式に変えてしまう。
   書くときは先頭に ' を付けて文字として保存し、読むときは形をそろえる */
function txt_(v) { return "'" + String(v == null ? '' : v); }
function safe_(v) { v = String(v == null ? '' : v); return /^[=+\-@']/.test(v) ? "'" + v : v; }
function pinOf_(v) { var s = String(v == null ? '' : v).replace(/[^0-9]/g, ''); return s && s.length < 4 && typeof v === 'number' ? ('0000' + s).slice(-4) : s; }
function randomPin_() { var s = ''; for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 10); return s; }
function hash_(s) { return 'h:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function staffRow_(no) {
  var r = rows_(APP.SH.ids);
  for (var i = 0; i < r.length; i++) if (normNo_(r[i][0]) === no) return { row: i + 2, no: no, name: String(r[i][1]).trim(), role: APP.ROLES.indexOf(String(r[i][2]).trim()) >= 0 ? String(r[i][2]).trim() : '一般', initPin: pinOf_(r[i][3]), stopped: !!String(r[i][4]).trim() };
  return null;
}
function normNo_(no) { var s = String(no == null ? '' : no).replace(/[^0-9]/g, ''); return s ? pad3_(Number(s)) : ''; }
function login_(no, pin, device) {
  no = normNo_(no); pin = String(pin || '').replace(/[^0-9]/g, '');
  if (!no || pin.length < 4) throw { code: 'login', message: '職員番号と4桁の暗証番号を入力してください' };
  return withLock_(function () {
    var st = staffRow_(no);
    if (!st || st.stopped) throw { code: 'login', message: '職員番号または暗証番号が違います' };
    var auth = authRow_(no);
    var now = Date.now();
    if (auth && auth.lockUntil > now) throw { code: 'locked', message: '暗証番号を続けて間違えたため、' + Math.ceil((auth.lockUntil - now) / 60000) + '分間ログインできません' };
    var good = auth && auth.changed ? hash_(auth.salt + pin) === auth.hash : (st.initPin && pin === st.initPin);
    if (!good) {
      var fails = (auth ? auth.fails : 0) + 1;
      setAuth_(no, { fails: fails >= APP.PIN_FAIL_LIMIT ? 0 : fails, lockUntil: fails >= APP.PIN_FAIL_LIMIT ? now + APP.PIN_LOCK_MIN * 60000 : 0 });
      throw { code: 'login', message: '職員番号または暗証番号が違います' };
    }
    setAuth_(no, { fails: 0, lockUntil: 0 });
    var token = Utilities.getUuid() + Utilities.getUuid();
    sheet_(APP.SH.sess).appendRow([hash_(token), txt_(no), new Date(now + APP.SESSION_DAYS * 864e5), safe_(String(device || '').slice(0, 80))]);
    log_({ no: no, name: st.name }, 'ログイン', String(device || '').slice(0, 40), '');
    var me = { no: no, name: st.name, role: st.role, mustChange: !(auth && auth.changed) };
    return { token: token, me: publicMe_(me) };
  });
}
function authRow_(no) {
  var r = rows_(APP.SH.auth);
  for (var i = 0; i < r.length; i++) if (normNo_(r[i][0]) === no) return { row: i + 2, salt: String(r[i][1]), hash: String(r[i][2]), fails: Number(r[i][3]) || 0, lockUntil: Number(r[i][4]) || 0, changed: String(r[i][5]) === '1' };
  return null;
}
function setAuth_(no, patch) {
  var a = authRow_(no) || { salt: '', hash: '', fails: 0, lockUntil: 0, changed: false };
  for (var k in patch) a[k] = patch[k];
  var vals = [[txt_(no), txt_(a.salt), txt_(a.hash), a.fails, a.lockUntil, a.changed ? '1' : '']];
  var sh = sheet_(APP.SH.auth);
  if (a.row) sh.getRange(a.row, 1, 1, 6).setValues(vals); else sh.appendRow(vals[0]);
}
function changePin_(me, oldPin, newPin) {
  newPin = String(newPin || '').replace(/[^0-9]/g, '');
  if (newPin.length !== 4) throw { code: 'invalid_argument', message: '新しい暗証番号は4桁の数字にしてください' };
  if (/^(\d)\1{3}$/.test(newPin) || newPin === '1234' || newPin === '0123') throw { code: 'invalid_argument', message: '推測されやすい番号です。別の番号にしてください' };
  return withLock_(function () {
    var st = staffRow_(me.no), auth = authRow_(me.no);
    var good = auth && auth.changed ? hash_(auth.salt + String(oldPin)) === auth.hash : (st.initPin && String(oldPin) === st.initPin);
    if (!good) throw { code: 'login', message: '今の暗証番号が違います' };
    var salt = Utilities.getUuid();
    setAuth_(me.no, { salt: salt, hash: hash_(salt + newPin), changed: true, fails: 0, lockUntil: 0 });
    sheet_(APP.SH.ids).getRange(st.row, 4).setValue('（本人が変更済み）');
    log_(me, '暗証番号の変更', '', '');
    return true;
  });
}
function session_(token) {
  if (!token) return null;
  var th = hash_(String(token));
  var cache = CacheService.getScriptCache();
  var hit = cache.get('s:' + th);
  var no = null;
  if (hit) no = hit;
  else {
    var r = rows_(APP.SH.sess), now = new Date();
    for (var i = r.length - 1; i >= 0; i--) if (r[i][0] === th) { if (new Date(r[i][2]) > now) no = normNo_(r[i][1]); break; }
    if (no) { try { cache.put('s:' + th, no, 600); } catch (e) {} }
  }
  if (!no) return null;
  var st = staffRow_(no);
  if (!st || st.stopped) return null;
  var auth = authRow_(no);
  return { no: no, name: st.name, role: st.role, mustChange: !(auth && auth.changed), tokenHash: th };
}
function logout_(token) {
  var th = hash_(String(token || '')); CacheService.getScriptCache().remove('s:' + th);
  withLock_(function () { var r = rows_(APP.SH.sess), sh = sheet_(APP.SH.sess); for (var i = 0; i < r.length; i++) if (r[i][0] === th) sh.getRange(i + 2, 3).setValue(new Date(0)); });
}
function publicMe_(me) { return { no: me.no, name: me.name, role: me.role, mustChange: !!me.mustChange, canSougei: me.role === '管理者' || me.role === '送迎表', admin: me.role === '管理者', version: APP.VERSION }; }
function staffList_() {
  return rows_(APP.SH.ids).filter(function (r) { return String(r[0]).trim() && !String(r[4]).trim(); })
    .map(function (r) { return { no: normNo_(r[0]), name: String(r[1]).trim() }; });
}
/* カレンダーで選ぶ利用者名（3つの版の合計）。マスタ全体（住所などのメモ）は配らない */
function namesList_() {
  var c = CacheService.getScriptCache(), hit = c.get('names2');
  if (hit) return JSON.parse(hit);
  var users = [], seen = {}, idx = docIndex_(), vehicles = [], depts = [], seenV = {}, seenD = {};
  ['v1', 'v2', 'v3'].forEach(function (ed) {
    var d = docGet_(kvPath_(APP.EDITIONS[ed] + 'master'), idx); var m = d ? d.value.v : null; if (!m) return;
    var dn = function (id) { var x = (m.departments || []).filter(function (y) { return y.id === id; })[0]; return x ? x.name : ''; };
    (m.users || []).forEach(function (u) { if (u && u.name && !seen[u.name]) { seen[u.name] = 1; users.push({ name: u.name, dept: dn(u.deptId) }); } });
    // 送迎の車両・休日出勤の部署を選ぶための名前（送迎表の名前で持ち、各版で名前から探す）
    (m.vehicles || []).forEach(function (v) { if (v && v.name && !seenV[v.name]) { seenV[v.name] = 1; vehicles.push(v.name); } });
    (m.departments || []).forEach(function (d) { if (d && d.name && !seenD[d.name]) { seenD[d.name] = 1; depts.push(d.name); } });
  });
  var out = { users: users, vehicles: vehicles, depts: depts };
  try { c.put('names2', JSON.stringify(out), 300); } catch (e) {}
  return out;
}
/* 送迎表の職員マスタ（3つの版）から職員番号を自動で振る。既にある名前は番号を変えない */
function syncStaffIds_() {
  var names = [];
  ['v1', 'v2', 'v3'].forEach(function (ed) {
    var m = docGet_('kv/' + SGKV.encKey(APP.EDITIONS[ed] + 'master'));
    var v = m ? m.value.v : null;
    (v && v.staff || []).forEach(function (s) { if (s && s.name && names.indexOf(s.name) < 0 && !(s.retireDate && s.retireDate <= today_())) names.push(s.name); });
  });
  if (!names.length) return 0;
  var sh = sheet_(APP.SH.ids), r = rows_(APP.SH.ids);
  var have = {}, maxNo = 0;
  r.forEach(function (x) { have[String(x[1]).trim()] = true; maxNo = Math.max(maxNo, Number(normNo_(x[0])) || 0); });
  var add = [];
  names.forEach(function (n) { if (!have[n]) { maxNo++; add.push([txt_(pad3_(maxNo)), safe_(n), '一般', txt_(randomPin_()), '', '送迎表から自動登録']); } });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 6).setValues(add);
  return add.length;
}
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd'); }

/* ================= 文書の保存（シート _docs。大きい値は複数セルに分割） ================= */
function docIndex_() {
  var sh = sheet_(APP.SH.docs), n = sh.getLastRow();
  var idx = {};
  if (n >= 2) sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r, i) { if (r[0]) idx[r[0]] = { row: i + 2, rev: Number(r[1]) || 0 }; });
  return idx;
}
var DOC_MEMO_ = {};
function docGet_(path, idx) {
  idx = idx || docIndex_();
  var hit = idx[path];
  if (!hit) return null;
  var mk = path + ':' + hit.rev;
  if (/master$/.test(path) && DOC_MEMO_[mk]) return DOC_MEMO_[mk];
  var got = docGetRaw_(path, hit);
  if (/master$/.test(path)) DOC_MEMO_[mk] = got;
  return got;
}
function docGetRaw_(path, hit) {
  var sh = sheet_(APP.SH.docs);
  var head = sh.getRange(hit.row, 1, 1, 5).getValues()[0];
  var parts = Number(head[4]) || 0;
  var str = parts ? joinParts_(sh.getRange(hit.row, 6, 1, parts).getValues()[0]) : 'null';
  return { rev: Number(head[1]) || 0, at: head[2], meta: head[3] ? JSON.parse(head[3]) : {}, value: JSON.parse(str) };
}
function docSet_(path, value, rev, meta, idx) {
  idx = idx || docIndex_();
  var sh = sheet_(APP.SH.docs);
  var str = JSON.stringify(value);
  var chunks = [];
  for (var i = 0; i < str.length; i += APP.CHUNK) chunks.push('J' + str.slice(i, i + APP.CHUNK));
  if (!chunks.length) chunks.push('Jnull');
  var row = idx[path] ? idx[path].row : sh.getLastRow() + 1;
  var oldParts = idx[path] ? Number(sh.getRange(row, 5).getValue()) || 0 : 0;
  var need = 5 + Math.max(chunks.length, oldParts);
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  var vals = [path, rev, new Date(), JSON.stringify(meta || {}), chunks.length].concat(chunks);
  for (var j = chunks.length; j < oldParts; j++) vals.push('');
  sh.getRange(row, 1, 1, vals.length).setValues([vals]);
  idx[path] = { row: row, rev: rev };
  bump_(path);
}
function joinParts_(cells) { return cells.map(function (c) { c = String(c); return c.charAt(0) === 'J' ? c.slice(1) : c; }).join(''); }
function utf8len_(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? (i++, 4) : 3; } return n; }
/* 変更通知用のカウンタ（端末は定期的にこれだけを確認する） */
function bump_(path) {
  var c = CacheService.getScriptCache();
  var k = path.indexOf('kv/') === 0 ? 'rev:' + path : path.indexOf('prop/') === 0 ? 'rev:props' : 'rev:cal';
  try { c.put(k, String(Date.now()), 21600); } catch (e) {}
}
function docGetPublic_(path) {
  if (!/^(days|cm)\//.test(path)) throw { code: 'invalid_argument', message: '' };
  var d = docGet_(path); return d ? { exists: true, rev: d.rev, data: d.value } : { exists: false };
}
function docsQuery_(q) {
  // カレンダー用：日付の範囲にかかる文書（days/ または cm/）
  var col = q.col === 'cm' ? 'cm' : 'days';
  var from = String(q.from || ''), to = String(q.to || '\uf8ff');
  var sh = sheet_(APP.SH.docs), n = sh.getLastRow(); if (n < 2) return [];
  var heads = sh.getRange(2, 1, n - 1, 5).getValues(), out = [];
  for (var i = 0; i < heads.length; i++) {
    var p = String(heads[i][0]); if (p.indexOf(col + '/') !== 0) continue;
    var meta = heads[i][3] ? JSON.parse(heads[i][3]) : {};
    var date = meta.date || '', maxEnd = meta.maxEnd || date;
    if (col === 'days' ? !(maxEnd >= from && date <= to) : !(date >= from && date <= to)) continue;
    out.push({ row: i + 2, path: p, rev: Number(heads[i][1]) || 0, parts: Number(heads[i][4]) || 0 });
  }
  var cache = CacheService.getScriptCache();
  var keys = out.map(function (x) { return 'd:' + x.path + ':' + x.rev; });
  var hit = keys.length ? cache.getAll(keys) : {};
  var put = {};
  var res = out.map(function (x, j) {
    if (hit[keys[j]]) return JSON.parse(hit[keys[j]]);
    var str = x.parts ? joinParts_(sh.getRange(x.row, 6, 1, x.parts).getValues()[0]) : 'null';
    if (utf8len_(str) < 90000) put[keys[j]] = str;   // キャッシュは1件100KBまで（日本語は1文字3バイト）
    return JSON.parse(str);
  });
  if (Object.keys(put).length) { try { cache.putAll(put, 21600); } catch (e) {} }
  return res;
}

/* ================= 送迎表データ（キー＝値） ================= */
function kvPath_(key) { return 'kv/' + SGKV.encKey(key); }
function kvGet_(key) { var d = docGet_(kvPath_(key)); return d ? { rev: d.rev, value: d.value.v } : { rev: 0, value: null }; }
function kvList_(prefix) {
  var sh = sheet_(APP.SH.docs), n = sh.getLastRow(), out = [];
  if (n < 2) return out;
  sh.getRange(2, 1, n - 1, 4).getValues().forEach(function (r) { if (String(r[0]).indexOf('kv/') !== 0) return; var meta = r[3] ? JSON.parse(r[3]) : {}; if (meta.k && meta.k.indexOf(prefix) === 0) out.push(meta.k); });
  return out;
}
function canWriteKey_(me, key) {
  if (me.role === '管理者') return true;
  if (me.role === '送迎表') return true;
  return false;
}
function editionOfKey_(key) { var m = /^(v\d):/.exec(key); return m ? m[1] : 'v1'; }
function kvLabel_(key) {
  var ed = editionOfKey_(key), k = key.replace(/^v\d:/, '');
  var what = k === 'master' ? '職員・利用者・車のマスタ' : k.indexOf('sheet:') === 0 ? k.slice(6) + ' の送迎表' : k.indexOf('pattern:') === 0 ? '週間パターン(' + '日月火水木金土'.charAt(Number(k.slice(8))) + '曜)' : k;
  return APP.EDITION_LABEL[ed] + ' ' + what;
}
function kvMerge_(me, a) {
  var key = String(a.key);
  if (!canWriteKey_(me, key)) throw { code: 'invalid_argument', message: '送迎表を変更する権限がありません' };
  return withLock_(function () {
    var idx = docIndex_(), path = kvPath_(key);
    var curDoc = docGet_(path, idx);
    var cur = curDoc ? curDoc.value.v : null, rev = curDoc ? curDoc.rev : 0;
    var merged, conflicts = [];
    if (a.replace) merged = a.mine;
    else if (a.baseKnown && SGKV.eq(a.base, cur)) merged = a.mine;
    else { var r = SGKV.merge3(a.baseKnown ? a.base : null, a.mine, cur); merged = r.value; conflicts = r.conflicts; }
    // 送迎表を保存するたびに、その時点の最新のカレンダー（休み・欠席など）をロックの中で当てはめる。
    // 端末の画面が古くても、反映が抜けたり、消した予定が戻ったりしない
    merged = reconcileSheetValue_(key, merged, idx);
    if (!SGKV.eq(merged, cur) || (a.replace && !curDoc)) {
      rev = rev + 1;
      docSet_(path, { k: key, v: merged, by: me.no }, rev, { k: key }, idx);
      log_(me, '送迎表', kvLabel_(key), diffSummary_(cur, merged) + (conflicts.length ? '（同じ箇所の同時変更 ' + conflicts.length + 'か所：この変更を優先）' : ''));
      if (/(^|:)master$/.test(key)) { syncStaffIds_(); try { CacheService.getScriptCache().remove('names2'); } catch (e) {} }
    }
    return { rev: rev, value: merged, conflicts: conflicts.length };
  });
}
/* バックアップからの復元（管理者のみ）。まとめて書き込む */
function kvImportMany_(me, items) {
  if (me.role !== '管理者') throw { code: 'invalid_argument', message: '復元は管理者だけができます' };
  return withLock_(function () {
    var idx = docIndex_(), n = 0;
    items.slice(0, 200).forEach(function (it) {
      var key = String(it.key), path = kvPath_(key), cur = docGet_(path, idx);
      var v = reconcileSheetValue_(key, it.value, idx);
      if (cur && SGKV.eq(cur.value.v, v)) return;
      docSet_(path, { k: key, v: v, by: me.no }, (cur ? cur.rev : 0) + 1, { k: key }, idx); n++;
    });
    log_(me, '送迎表', 'バックアップから復元', n + '件');
    syncStaffIds_(); try { CacheService.getScriptCache().remove('names2'); } catch (e) {}
    return { written: n };
  });
}
/* 版を上げたときの初期データ取り込みなど「読んだ版のままなら書く」 */
function kvCas_(me, a) {
  var key = String(a.key);
  if (!canWriteKey_(me, key)) throw { code: 'invalid_argument', message: '送迎表を変更する権限がありません' };
  return withLock_(function () {
    var idx = docIndex_(), path = kvPath_(key), curDoc = docGet_(path, idx);
    var rev = curDoc ? curDoc.rev : 0;
    if (rev !== Number(a.rev)) return { conflict: true, rev: rev, value: curDoc ? curDoc.value.v : null };
    a.value = reconcileSheetValue_(key, a.value, idx);
    docSet_(path, { k: key, v: a.value, by: me.no }, rev + 1, { k: key }, idx);
    log_(me, '送迎表', kvLabel_(key), '初期データの取り込み');
    if (/(^|:)master$/.test(key)) { syncStaffIds_(); try { CacheService.getScriptCache().remove('names2'); } catch (e) {} }
    return { conflict: false, rev: rev + 1, value: a.value };
  });
}
function diffSummary_(a, b) {
  if (!a) return '新規作成';
  if (!b || typeof b !== 'object') return '変更';
  var out = [];
  ['runs', 'blocks'].forEach(function (k) {
    if (!Array.isArray(a[k]) || !Array.isArray(b[k])) return;
    var ia = {}, ib = {}; a[k].forEach(function (x) { ia[x.id] = x; }); b[k].forEach(function (x) { ib[x.id] = x; });
    var add = 0, del = 0, chg = 0;
    for (var id in ib) { if (!ia[id]) add++; else if (JSON.stringify(ia[id]) !== JSON.stringify(ib[id])) chg++; }
    for (var id2 in ia) if (!ib[id2]) del++;
    var nm = k === 'runs' ? '便' : '予定';
    if (add) out.push(nm + '追加' + add); if (chg) out.push(nm + '変更' + chg); if (del) out.push(nm + '削除' + del);
  });
  [['staffOv', '職員の当日設定'], ['userAbsent', '欠席'], ['userTime', '時間変更'], ['noRide', '送迎なし'], ['staff', '職員'], ['users', '利用者'], ['vehicles', '車']].forEach(function (p) {
    if (JSON.stringify(a[p[0]]) !== JSON.stringify(b[p[0]])) out.push(p[1]);
  });
  return out.join('・') || '変更';
}

/* ================= 変更の確認（端末は30〜60秒ごとに呼ぶ） ================= */
function poll_(q) {
  var c = CacheService.getScriptCache(), out = { keys: {}, cal: c.get('rev:cal') || '0', props: c.get('rev:props') || '0' };
  var keys = (q.keys || []).slice(0, 20);
  var need = [];
  keys.forEach(function (k) { var v = c.get('rev:' + kvPath_(k)); if (v) out.keys[k] = v; else need.push(k); });
  if (need.length) { var idx = docIndex_(); need.forEach(function (k) { var h = idx[kvPath_(k)]; out.keys[k] = h ? 'r' + h.rev : '0'; }); }
  return out;
}

/* ================= カレンダー ================= */
function calApply_(me, op) {
  op = sanitizeOp_(op);
  op.by = me.no;                                   // 誰の操作かはサーバーが決める（端末の申告は使わない）
  if (op.comment) op.comment.by = me.no;
  // 職員の休み・予定・休日出勤・勤務時間変更は本人の分だけ（管理者は全員分）。利用者が関わるもの（利用者休み・ヘルプ・送迎）は送迎表の担当以上
  var sg = op.kind === 'upsert' ? op.ev.sg : null;
  if (sg) {
    if ((sg.type === 'staff_off' || sg.type === 'staff_plan' || sg.type === 'hwork' || sg.type === 'shift') && me.role !== '管理者' && !(sg.staff.length === 1 && sg.staff[0] === me.name))
      throw { code: 'invalid_argument', message: '他の職員の休み・予定・休日出勤・勤務時間変更は管理者だけが入力できます' };
    if ((sg.type === 'user_absent' || sg.type === 'user_time' || sg.type === 'help' || sg.type === 'ride') && me.role === '一般')
      throw { code: 'invalid_argument', message: '利用者休み・ヘルプ・送迎は送迎表の担当者だけが入力できます' };
  }
  return withLock_(function () {
    var idx = docIndex_();
    var paths = TCCore.targetsOf(op);
    var raws = paths.map(function (p) { var d = docGet_(p, idx); return d ? d.value : null; });
    if (op.kind !== 'comment' && me.role !== '管理者') {
      // 送迎表に反映する予定の変更・削除は、作った本人か管理者だけ
      var ex = null; raws.forEach(function (r) { var ev = r && r.events && r.events[op.id]; if (ev) ex = ev; });
      if (ex && ex.sg && ex.createdBy && ex.createdBy !== me.no) throw { code: 'invalid_argument', message: '送迎表に反映する予定は、作った人か管理者だけが変更できます' };
    }
    var res = TCCore.applyOp(op, paths, raws);
    if (res.status === 'outdated') return { status: 'failed' };
    if (res.status !== 'ok') return { status: res.status, reason: res.reason || null, theirs: res.theirs || null };
    res.writes.forEach(function (w) {
      var meta = w.path.indexOf('days/') === 0 ? { date: w.data.date, maxEnd: w.data.maxEnd } : { date: w.data.date };
      var d = docGet_(w.path, idx);
      docSet_(w.path, w.data, (d ? d.rev : 0) + 1, meta, idx);
    });
    var title = op.kind === 'comment' ? '' : (op.ev && op.ev.title) || (raws[0] && raws[0].events && raws[0].events[op.id] && raws[0].events[op.id].title) || '';
    log_(me, 'カレンダー', { upsert: op.baseRev == null && !op.baseOp ? '予定の作成' : '予定の変更', delete: '予定の削除', restore: '予定の復元', comment: 'コメント' }[op.kind], title + (sg ? '（送迎表：' + sgText_(sg) + '）' : ''));
    if (op.kind !== 'comment') reconcileDates_(op, raws, idx);
    return { status: 'ok' };
  });
}
function sgText_(sg) {
  var t = { staff_off: sg.half === 'am' ? 'AM休' : sg.half === 'pm' ? 'PM休' : '休み・不在', staff_plan: '職員の予定', user_absent: '欠席', user_time: '時間変更',
    help: 'ヘルプ', ride: { meet: '迎え', send: '送り' }[sg.kind] || '送迎', hwork: '休日出勤', shift: '勤務時間変更' + (sg.wstart ? ' 出勤' + sg.wstart : '') + (sg.wend ? ' 退勤' + sg.wend : '') }[sg.type];
  return t + ' ' + sg.staff.concat(sg.users).join('・') + (sg.reason || sg.note ? '（' + (sg.reason || sg.note) + '）' : '');
}
function sanitizeOp_(op) {
  if (!op || typeof op !== 'object') throw { code: 'invalid_argument', message: '' };
  var kinds = ['upsert', 'delete', 'restore', 'comment'];
  if (kinds.indexOf(op.kind) < 0) throw { code: 'invalid_argument', message: '' };
  var ID = /^[A-Za-z0-9_-]{6,64}$/, D = /^\d{4}-\d{2}-\d{2}$/;
  var o = { kind: op.kind, opId: String(op.opId || '').slice(0, 80), id: String(op.id || ''), at: new Date().toISOString(), force: !!op.force };
  if (!ID.test(o.opId) || !ID.test(o.id)) throw { code: 'invalid_argument', message: '' };
  o.baseRev = op.baseRev == null ? null : Number(op.baseRev);
  o.baseOp = op.baseOp && ID.test(String(op.baseOp)) ? String(op.baseOp) : null;
  if (o.kind === 'upsert') {
    var ev = TCCore.normEvent(op.ev, o.id, 1);
    if (!ev) throw { code: 'invalid_argument', message: '予定の内容が正しくありません' };
    o.ev = ev; o.fromDate = D.test(op.fromDate) ? op.fromDate : ev.date;
  } else if (o.kind === 'comment') {
    o.eventId = o.id; o.cmKey = D.test(op.cmKey) ? op.cmKey : '';
    if (!o.cmKey) throw { code: 'invalid_argument', message: '' };
    var text = String((op.comment && op.comment.text) || '').slice(0, 500).trim();
    var cid = String((op.comment && op.comment.id) || '');
    if (!text || !ID.test(cid)) throw { code: 'invalid_argument', message: '' };
    o.comment = { id: cid, text: text, at: o.at };
  } else { o.date = D.test(op.date) ? op.date : ''; if (!o.date) throw { code: 'invalid_argument', message: '' }; }
  return o;
}
/* 送迎表1日分に、その日のカレンダーの予定を当てはめる */
function reconcileSheetValue_(key, value, idx) {
  var m = /^(v\d:)?sheet:(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m || !value || typeof value !== 'object') return value;
  var md = docGet_(kvPath_((m[1] || '') + 'master'), idx);
  if (!md || !md.value.v) return value;
  var events = TCCore.mergeDays(docsQuery_({ col: 'days', from: m[2], to: m[2] }));
  return SGCal.reconcile(md.value.v, value, Object.keys(events).map(function (k) { return events[k]; }), m[2]);
}
/* 予定の前後の日付について、既にある送迎表へ反映（取り消しも）する */
function reconcileDates_(op, rawsBefore, idx) {
  var dates = {};
  var addRange = function (a, b) { if (!a) return; b = b || a; var d = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00'), n = 0; while (d <= e && n++ < 62) { dates[Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd')] = 1; d.setDate(d.getDate() + 1); } };
  rawsBefore.forEach(function (r) { var ev = r && r.events && r.events[op.id]; if (ev) addRange(ev.date, ev.endDate); });
  if (op.ev) addRange(op.ev.date, op.ev.endDate);
  Object.keys(dates).forEach(function (date) {
    var events = null;
    ['v1', 'v2', 'v3'].forEach(function (ed) {
      var ns = APP.EDITIONS[ed], sp = kvPath_(ns + 'sheet:' + date), sd = docGet_(sp, idx);
      if (!sd) return;                                  // まだ作られていない日は、送迎表を開いたときに反映
      var md = docGet_(kvPath_(ns + 'master'), idx); if (!md) return;
      if (!events) events = TCCore.mergeDays(docsQuery_({ col: 'days', from: date, to: date }));
      var list = Object.keys(events).map(function (k) { return events[k]; });
      var next = SGCal.reconcile(md.value.v, sd.value.v, list, date);
      if (next !== sd.value.v && !SGKV.eq(next, sd.value.v)) {
        docSet_(sp, { k: ns + 'sheet:' + date, v: next, by: 'calendar' }, sd.rev + 1, { k: ns + 'sheet:' + date }, idx);
      }
    });
  });
}

/* ================= 変更履歴 ================= */
function log_(me, kind, target, detail) {
  try { sheet_(APP.SH.log).appendRow([new Date(), txt_(me.no || ''), safe_(me.name || ''), safe_(kind), safe_(target || ''), safe_(String(detail || '').slice(0, 500))]); } catch (e) {}
}
function logList_(n) {
  var sh = sheet_(APP.SH.log), last = sh.getLastRow(); if (last < 2) return [];
  var k = Math.min(Number(n) || 200, 1000, last - 1);
  return sh.getRange(last - k + 1, 1, k, 6).getValues().reverse().map(function (r) { return { at: new Date(r[0]).toISOString(), no: String(r[1]), name: String(r[2]), kind: String(r[3]), target: String(r[4]), detail: String(r[5]) }; });
}

/* ================= AI調整（任意。スクリプトのプロパティ ANTHROPIC_API_KEY を設定したときだけ使える） ================= */
function aiMessages_(me, body) {
  if (!(me.role === '管理者' || me.role === '送迎表')) throw { code: 'invalid_argument', message: '権限がありません' };
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw { code: 'not_granted', message: 'AI調整は設定されていません（管理者がAPIキーを設定すると使えます）' };
  var msgs = (body && body.messages || []).slice(-24).map(function (m) { return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 200000) }; });
  var payload = { model: PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || 'claude-sonnet-5-5', max_tokens: Math.min(Number(body && body.maxTokens) || 4000, 8000), messages: msgs };
  if (body && body.system) payload.system = String(body.system).slice(0, 100000);
  var res;
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(payload)
    });
  } catch (e) { throw { code: 'unavailable', message: 'AIの応答が時間内に返りませんでした。依頼を短くするか、もう一度送ってください' }; }
  var j = JSON.parse(res.getContentText());
  if (res.getResponseCode() === 429 || res.getResponseCode() === 529) throw { code: 'unavailable', message: 'AIが混み合っています。少し待ってからもう一度送ってください' };
  if (j.error) throw { code: 'unavailable', message: j.error.message || 'AIエラー' };
  return { text: (j.content || []).filter(function (x) { return x.type === 'text'; }).map(function (x) { return x.text; }).join('\n'), truncated: j.stop_reason === 'max_tokens' };
}
