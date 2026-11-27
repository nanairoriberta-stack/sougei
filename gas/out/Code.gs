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
  VERSION: '2026.11.27b',
  SESSION_DAYS: 3650,   // ログアウトするまで出ない（2026-11-07 依頼者。以前は120日）。使っているあいだは期限をのばす（session_）
  PIN_FAIL_LIMIT: 5,
  PIN_LOCK_MIN: 15,
  CHUNK: 45000,             // 1セルの上限(5万字)より小さく分割
  EDITIONS: { v1: '', v2: 'v2:', v3: 'v3:' },
  EDITION_LABEL: { v1: '現体制版', v2: '新体制版', v3: 'りんく・ぷれいす版' },
  ROLES: ['管理者', '送迎表', '一般'],
  SH: { ids: '職員ID', log: '変更履歴', auth: '_auth', sess: '_sessions', docs: '_docs', conf: '設定', yomi: 'よみがな' }
};

/* ================= 画面 ================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.mcp) return ContentService.createTextOutput(JSON.stringify({ name: '送迎表', message: 'これはClaudeのカスタムコネクタ用の接続先です。Claudeの「設定 → コネクタ → カスタムコネクタを追加」にこのURLを貼ってください。' })).setMimeType(ContentService.MimeType.JSON);
  if (p.page === 'check') return checkPage_();
  if (p.page === 'export') return exportForShift_(p);   // シフト表作成システム（別のアプリ）が読む連携の窓口（読むだけ。2026-11-10 依頼）
  var page = p.page === 'sougei' ? 'sougei' : p.page === 'shift' ? 'shift' : 'calendar';
  var ed = APP.EDITIONS.hasOwnProperty(p.e) ? p.e : 'v1';
  var base = appUrl_();
  var d = /^\d{4}-\d{2}-\d{2}$/.test(String(p.d || '')) ? String(p.d) : '';
  var js = function (v) { return JSON.stringify(v).replace(/</g, '\\u003c'); };
  var html = HtmlService.createHtmlOutputFromFile(page).getContent()
    .replace('/*__BOOT__*/', 'window.__SG_EDITION=' + js(ed) + ';window.__SG_BASE=' + js(base) + ';window.__SG_DATE=' + js(d) + ';');
  // 題名は「なないろ…」（iPhoneのホーム画面に追加したときの名前。2026-11-16 依頼者のアイコン「なないろ Calendar」）
  var title = page === 'sougei' ? 'なないろ送迎表（' + APP.EDITION_LABEL[ed] + '）' : page === 'shift' ? 'なないろシフト表' : 'なないろカレンダー';
  var out = HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  // ※ apple-mobile-web-app-title は Google が受け付けない（2026-11-16 実機「指定したメタタグはこのコンテキストでは使用できません」で画面が開かなくなった）。ホーム画面の名前は題名から
  // アイコン：「設定」シートB6の画像（Googleドライブで「リンクを知っている全員」にした画像のリンク）。iPhoneはこの小さな画像をホーム画面に使うことがある（必ずではない）
  var icon = iconUrl_();
  if (icon) { try { out = out.setFaviconUrl(icon); } catch (e) {} }
  return out
    // 送迎表の画面の右側に出すカレンダー（?page=calendar&embed=1）だけは、ほかの画面の中に出せるようにする
    // 入口のページ（Cloudflare、2026-11-16 依頼者「アイコンを画像に・上の帯を消したい」）から開いたとき（?wrap=https://入口）も中に出せるようにする
    .setXFrameOptionsMode((page === 'calendar' && p.embed === '1') || WRAP_RE.test(String(p.wrap || '')) ? HtmlService.XFrameOptionsMode.ALLOWALL : HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ================= スマホの通知（Web Push。2026-11-16 依頼者「通知機能」→ 方法1・全員・予定が入った時と今日の予定） =================
   入口のページ（「設定」シート B7）が暗号化して Apple・Google などの通知のサービスへ送る（Googleの側では暗号の計算ができないため）。
   鍵（VAPID）はスクリプト プロパティ PUSH_VAPID（はじめて使うときに入口のページで作ってもらう）。登録した端末は隠しシート _push（A=職員番号 B=宛先 C=鍵 D=鍵 E=登録日時） */
var PUSH_EP_RE = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chrome\.google\.com)\//i;
function entryUrl_() {
  try { var sh = sheet_(APP.SH.conf); var v = sh ? String(sh.getRange(7, 2).getValue()).trim().replace(/\/+$/, '') : ''; return WRAP_RE.test(v) ? v : ''; } catch (e) { return ''; }
}
function pushVapid_() {
  var entry = entryUrl_(); if (!entry) return null;
  var p = PropertiesService.getScriptProperties(), raw = p.getProperty('PUSH_VAPID');
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  var r = UrlFetchApp.fetch(entry + '/push/newkeys', { method: 'post', muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  var k = JSON.parse(r.getContentText()); if (!k || !k.publicKey || !k.privateJwk) return null;
  p.setProperty('PUSH_VAPID', JSON.stringify(k));
  return k;
}
function pushSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName('_push');
  if (!sh) { sh = ss.insertSheet('_push'); sh.getRange(1, 1, 1, 5).setValues([['職員番号', '宛先', 'p256dh', 'auth', '登録日時']]); try { sh.hideSheet(); } catch (e) {} }
  return sh;
}
function pushSubscribe_(me, sub) {
  if (!sub || !PUSH_EP_RE.test(String(sub.endpoint || '')) || String(sub.endpoint).length > 1000 || !sub.keys || !/^[A-Za-z0-9_-]{60,120}$/.test(sub.keys.p256dh || '') || !/^[A-Za-z0-9_-]{16,40}$/.test(sub.keys.auth || ''))
    throw { code: 'invalid_argument', message: '通知の登録の形がちがいます' };
  return withLock_(function () {
    var sh = pushSheet_(), n = sh.getLastRow(), rows = n > 1 ? sh.getRange(2, 1, n - 1, 5).getValues() : [];
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][1]) === sub.endpoint) sh.deleteRow(i + 2);
    sh.appendRow([txt_(me.no), txt_(sub.endpoint), txt_(sub.keys.p256dh), txt_(sub.keys.auth), txt_(new Date().toISOString())]);
    return { ok: true };
  });
}
function pushUnsubscribe_(me, endpoint) {
  return withLock_(function () {
    var sh = pushSheet_(), n = sh.getLastRow(), rows = n > 1 ? sh.getRange(2, 1, n - 1, 2).getValues() : [], c = 0;
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][1]) === String(endpoint || '')) { sh.deleteRow(i + 2); c++; }
    return { ok: true, removed: c };
  });
}
// 登録した全員（except＝その職員番号の端末は除く）に送る。12件ずつ入口のページへ（いっしょに送る）。届かなくなった宛先（404・410）は消す
/* 通知の種類ごとの受け取る・受け取らない（2026-11-21 依頼者「いままで設定した通知をそれぞれ選択できるように」）。人ごと（職員番号）にスクリプト プロパティ pp:<番号> に {種類:false} を持つ。無ければ全部受け取る
   new=予定が入った chg=変わった del=消された daily=毎朝の今日の予定 tomorrow=毎夕の明日の予定 self=自分で入れた予定も */
var PUSH_KINDS = ['new', 'chg', 'del', 'daily', 'tomorrow', 'self'];
function pushPrefsAll_() { var all = {}; try { var p = PropertiesService.getScriptProperties().getProperties(); for (var k in p) if (/^pp:/.test(k)) { try { all[k.slice(3)] = JSON.parse(p[k]); } catch (e) {} } } catch (e) {} return all; }
function pushPrefs_(no) { var o = pushPrefsAll_()[normNo_(no)] || {}, r = {}; PUSH_KINDS.forEach(function (k) { r[k] = o[k] !== false; }); return r; }
function pushPrefsSet_(me, prefs) {
  var o = {}; PUSH_KINDS.forEach(function (k) { if (prefs && prefs[k] === false) o[k] = false; });
  PropertiesService.getScriptProperties().setProperty('pp:' + me.no, JSON.stringify(o));
  log_(me, '通知', '通知の設定', PUSH_KINDS.filter(function (k) { return o[k] === false; }).join(',') ? '受け取らない：' + PUSH_KINDS.filter(function (k) { return o[k] === false; }).join(',') : 'すべて受け取る');
  return pushPrefs_(me.no);
}
function pushSend_(payload, except, only, kind, by) {   // only＝この職員番号の人だけ（{番号:1}）。kind＝通知の種類（受け取らない人には送らない）、by＝入れた人の番号（「自分で入れた予定も」を切った人には送らない）
  var entry = entryUrl_(), v = entry ? pushVapid_() : null; if (!v) return { sent: 0 };
  var sh = pushSheet_(), n = sh.getLastRow(); if (n < 2) return { sent: 0 };
  var prefs = kind ? pushPrefsAll_() : {};
  var off = function (no) { var o = prefs[normNo_(no)]; return !!o && ((kind && o[kind] === false) || (by != null && normNo_(by) === normNo_(no) && o.self === false)); };
  var rows = sh.getRange(2, 1, n - 1, 4).getValues().filter(function (r) { return r[1] && String(r[0]) !== String(except || '') && (!only || only[normNo_(r[0])]) && !off(r[0]); });
  var reqs = [];
  for (var i = 0; i < rows.length; i += 12) reqs.push({ url: entry + '/push/send', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ vapid: v, subject: entry, payload: payload, items: rows.slice(i, i + 12).map(function (r) { return { endpoint: String(r[1]), keys: { p256dh: String(r[2]), auth: String(r[3]) } }; }) }) });
  if (!reqs.length) return { sent: 0 };
  var gone = {}, sent = 0;
  UrlFetchApp.fetchAll(reqs).forEach(function (r) {
    try { (JSON.parse(r.getContentText()).results || []).forEach(function (x) { if (x.status === 404 || x.status === 410) gone[x.endpoint] = 1; else if (x.status >= 200 && x.status < 300) sent++; }); } catch (e) {}
  });
  if (Object.keys(gone).length) withLock_(function () {
    var n2 = sh.getLastRow(), all = n2 > 1 ? sh.getRange(2, 2, n2 - 1, 1).getValues() : [];
    for (var j = all.length - 1; j >= 0; j--) if (gone[String(all[j][0])]) sh.deleteRow(j + 2);
  });
  return { sent: sent, gone: Object.keys(gone).length };
}
var PUSH_WD_ = ['日', '月', '火', '水', '木', '金', '土'];
function pushMd_(ds) { var p = String(ds).split('-').map(Number); if (p.length < 3 || !p[0]) return ''; var w = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); return p[1] + '/' + p[2] + '(' + PUSH_WD_[w] + ')'; }
// カレンダーに予定が入った・変わった・消された（入れた本人の端末には送らない）
function pushCal_(me, pu) {
  var entry = entryUrl_(); if (!entry || !pu || !pu.title) return null;
  var head = { 'new': '📅 予定が入りました', chg: '✏️ 予定が変わりました', del: '🗑 予定が消されました' }[pu.kind] || '📅 カレンダー';
  if (pu.mansion) head = head.replace('予定', 'マンションの予定');
  return pushSend_({ title: head, body: (pu.date ? pushMd_(pu.date) + ' ' : '') + pu.title + '（' + me.name + 'さん）', tag: 'ev_' + pu.id,
    url: '/?page=calendar' + (pu.date ? '&d=' + pu.date : '') }, null, pu.mansion ? mansionNos_() : null, pu.kind, me.no);   // 入れた本人にも送る（2026-11-21 依頼者「自分がカレンダーに入れたものが通知で届かない」）。マンションの予定はマンションの人だけに
}
// その日の予定（通知用。マンションの予定は入れない）
function pushDayList_(day) {
  var evMap = TCCore.mergeDays(docsQuery_({ col: 'days', from: day, to: day }));
  return Object.keys(evMap).map(function (k) { return evMap[k]; }).filter(function (e) { return e && !e.deleted && e.biz !== 'mansion' && e.date <= day && (e.endDate || e.date) >= day && e.title; })
    .sort(function (a, b) { return (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || String(a.start || '').localeCompare(String(b.start || '')) || String(a.title).localeCompare(String(b.title)); });
}
function pushDayMsg_(day, word, tag) {
  var list = pushDayList_(day);
  if (!list.length) return { title: '📅 ' + word + 'の予定 ' + pushMd_(day), body: word + 'の予定はありません', tag: tag, url: '/?page=calendar&d=' + day };
  var lines = list.slice(0, 8).map(function (e) { return (e.allDay || !e.start ? '' : String(e.start).replace(/^0/, '') + ' ') + e.title; });
  return { title: '📅 ' + word + 'の予定 ' + pushMd_(day) + '（' + list.length + '件）', body: lines.join('\n') + (list.length > 8 ? '\nほか' + (list.length - 8) + '件' : ''), tag: tag, url: '/?page=calendar&d=' + day };
}
// 毎朝の「今日の予定」（時間で動くきっかけ。setup・installPushTrigger で毎日7時台に入れる）
function pushDaily() {
  if (!entryUrl_()) return null;
  try { ensurePushTomorrow_(); } catch (e) {}   // 前からある所でも「明日の予定」のきっかけを入れる（エディタで実行しなくてよいように）
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  return pushSend_(pushDayMsg_(today, '今日', 'daily'), null, null, 'daily');
}
// 前の日の夕方の「明日の予定」（2026-11-21 依頼者「前日に明日の予定はこれですみたいな通知」。毎日18時台）
function pushTomorrow() {
  if (!entryUrl_()) return null;
  var tm = Utilities.formatDate(new Date(Date.now() + 864e5), 'Asia/Tokyo', 'yyyy-MM-dd');
  return pushSend_(pushDayMsg_(tm, '明日', 'tomorrow'), null, null, 'tomorrow');
}
function ensurePushTomorrow_() {
  if (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'pushTomorrow'; })) return;
  ScriptApp.newTrigger('pushTomorrow').timeBased().atHour(18).everyDays(1).inTimezone('Asia/Tokyo').create();
}
// 毎朝・毎夕の通知のきっかけを入れ直す（エディタで実行してもよい。setup でも入る）
function installPushTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); if (f === 'pushDaily' || f === 'pushTomorrow') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pushDaily').timeBased().atHour(7).everyDays(1).inTimezone('Asia/Tokyo').create();
  ScriptApp.newTrigger('pushTomorrow').timeBased().atHour(18).everyDays(1).inTimezone('Asia/Tokyo').create();
  return '毎朝7時台に「今日の予定」、毎夕18時台に「明日の予定」を通知します';
}
/* 入口のページのアドレス（https://〜 だけ。後ろに / や ? は付かない） */
var WRAP_RE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/;
/* アイコンの画像のアドレス（「設定」シートB6）。Googleドライブの共有リンク（…/file/d/ID/view や ?id=ID）は画像そのもののアドレスに直す。10分覚える */
function iconUrl_() {
  var c = null; try { c = CacheService.getScriptCache(); var hit = c.get('icon1'); if (hit != null) return hit; } catch (e) {}
  var v = '';
  try { var sh = sheet_(APP.SH.conf); v = sh ? String(sh.getRange(6, 2).getValue()).trim() : ''; } catch (e) {}
  var m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(v) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(v);
  var url = m ? 'https://lh3.googleusercontent.com/d/' + m[1] + '=s180' : /^https:\/\/[^\s<>"']+$/.test(v) ? v : '';
  try { if (c) c.put('icon1', url, 600); } catch (e) {}
  return url;
}
/* 公開URL（…/exec）。Googleの getUrl() はテスト用の …/dev（作った人しか開けない）を返すことがあるので、
   「設定」シートB2に貼った公開URLを優先する（2026-10-28 実機：スマホでメニューの送迎表が開けなかった） */
var APP_URL_RE = /^https:\/\/script\.google\.com\/(a\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/;
function appUrl_() {
  try {
    var sh = sheet_(APP.SH.conf); var v = sh ? String(sh.getRange(2, 2).getValue()).trim() : '';
    v = v.replace(/[?#].*$/, '').replace(/\/+$/, '');   // 「…/exec?page=calendar」のように後ろに付いていても使えるように
    if (APP_URL_RE.test(v)) return v;
  } catch (e) {}
  return ScriptApp.getService().getUrl();
}
/* ================= シフト表作成システムとの連携（?page=export&key=…&ym=YYYY-MM）=================
   2026-11-10 依頼（「カレンダーアプリ連携のお願い」）：シフト表作成システムが月を開くたびに、その月のシフト表（男性・女性）と予定を JSON で読む。
   読むだけ（書きかえない）。ログインの代わりに連携キー（スクリプト プロパティ EXPORT_KEY、エディタで issueExportKey を実行して作る）で守る。
   返す形は v:1 で固定（形を変えるときは v を上げて知らせる）。項目を足すのはかまわない */
var EXPORT_FORMAT = 'riberta-calendar-export';
function exportForShift_(q) {
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  var key = '';
  try { key = String(PropertiesService.getScriptProperties().getProperty('EXPORT_KEY') || ''); } catch (e) {}
  if (key.length < 32 || String(q.key || '') !== key) return out({ error: 'key' });
  var ym = String(q.ym || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return out({ error: 'ym' });
  try {
    return out(exportData_(ym));
  } catch (e) {
    return out({ error: 'server', message: String((e && e.message) || e) });
  }
}
function exportData_(ym) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  var first = ym + '-01', last = ym + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
  var idx = docIndex_(), shift = {};
  ['m', 'f'].forEach(function (g) {
    var c = docGet_('shift/' + g + '/cfg', idx), mo = docGet_('shift/' + g + '/' + ym, idx);
    var cfg = SGShift.cfgOf(g, c ? c.value : null), mv = SGShift.monthOf(g, ym, mo ? mo.value : null) || {};   // シフト表の画面と同じ中身（保存がまだの月は最初の中身）
    shift[g] = { members: (cfg.members || []).map(function (x) { return x.name; }), days: mv.days || {}, wish: mv.wish || {},
      fixed: SGShift.isFixed(mv, ym) };   // fixed（足した項目）：シフト表で「確定」した月か
  });
  var evMap = TCCore.mergeDays(docsQuery_({ col: 'days', from: first, to: last })), events = [];
  Object.keys(evMap).forEach(function (k) {
    var e = evMap[k]; if (!e || e.deleted) return;
    var end = e.endDate || e.date; if (!(e.date <= last && end >= first)) return;
    events.push({ id: e.id, date: e.date, endDate: end, title: e.title || '', label: e.label || 'other', deleted: false, sg: e.sg || null,
      allDay: !!e.allDay, start: e.start || '', end: e.end || '', biz: e.biz || 'seikatsu', users: e.users || [], tanto: e.tanto || [], memo: e.memo || '' });
  });
  events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1); });
  return { format: EXPORT_FORMAT, v: 1, ym: ym, generatedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss'+09:00'"), shift: shift, events: events };
}
/* 連携キーを作る（スクリプトエディタで実行。もう一度実行すると前のアドレスは使えなくなる）。
   できたアドレスは「設定」シートの4行目と、実行ログに出る。このアドレスはパスワードと同じように扱う */
function issueExportKey() {
  var k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('EXPORT_KEY', k);
  var url = appUrl_() + '?page=export&key=' + k;
  try { var sh = confSheet_(); sh.getRange(4, 1, 1, 2).setValues([['シフト表作成システムとの連携アドレス（パスワードと同じように扱う。issueExportKey をもう一度実行すると変わる）', txt_(url)]]); } catch (e) {}
  try { log_({ no: '', name: '（エディタ）' }, '連携', 'シフト表作成システム', '連携キーを作りました'); } catch (e) {}
  Logger.log(url);
  return url;
}
function confSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(APP.SH.conf);
  if (!sh) { sh = ss.insertSheet(APP.SH.conf); sh.getRange(1, 1, 2, 2).setValues([['項目', '値'], ['公開URL（デプロイの「ウェブアプリ」のURL。最後が /exec）', '']]); sh.setFrozenRows(1); }
  if (!String(sh.getRange(6, 1).getValue())) sh.getRange(6, 1).setValue('アイコンの画像（Googleドライブで「リンクを知っている全員」にした画像のリンク）');
  if (!String(sh.getRange(7, 1).getValue())) sh.getRange(7, 1).setValue('入口のページのアドレス（https://nanairo.〇〇.workers.dev。スマホの通知に使う）');
  return sh;
}

/* ================= 動作の確認画面（?page=check） =================
   画面が真っ白・「接続中…」のままのとき、どこまで動いているかを一覧で見せる。
   ファイル（calendar / sougei）に頼らずにここだけで作るので、ファイルが壊れていても開ける。秘密の情報は出さない */
function checkServer() {
  var out = { version: APP.VERSION, now: new Date().toISOString(), sheets: {}, files: {}, base: appUrl_() };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    [APP.SH.ids, APP.SH.log, APP.SH.auth, APP.SH.sess, APP.SH.docs].forEach(function (n) { out.sheets[n] = !!ss.getSheetByName(n); });
    var ids = ss.getSheetByName(APP.SH.ids); out.staffRows = ids ? Math.max(0, ids.getLastRow() - 1) : 0;
    var docs = ss.getSheetByName(APP.SH.docs); out.docRows = docs ? Math.max(0, docs.getLastRow() - 1) : 0;
  } catch (e) { out.sheetError = String(e && e.message || e); }
  ['calendar', 'sougei', 'shift'].forEach(function (f) {
    try { var c = HtmlService.createHtmlOutputFromFile(f).getContent(); out.files[f] = { len: c.length, end: /<\/html>\s*$/.test(c), boot: c.indexOf('/*__BOOT__*/') >= 0 }; }
    catch (e) { out.files[f] = { error: String(e && e.message || e) }; }
  });
  return out;
}
function checkPage_() {
  var html = '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>動作の確認</title><style>' +
    'body{margin:0;background:#f3f5f4;color:#18201d;font:15px/1.6 system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:16px}' +
    'h1{font-size:20px;margin:8px 0}li{list-style:none;background:#fff;border:1px solid #dde3e0;border-radius:8px;padding:10px 12px;margin:8px 0}' +
    'ul{padding:0}b.ok{color:#13795b}b.ng{color:#c23a32}b.wait{color:#9a6a00}small{color:#5f6b66;display:block;word-break:break-all}</style></head><body><main>' +
    '<h1>動作の確認（版 ' + APP.VERSION + '）</h1><p>この画面の写真を担当者に送ってください。1分ほどで全部の結果が出ます。</p><ul id="r"></ul></main><script>(0,eval)(' + JSON.stringify(checkScript_()).replace(/</g, '\\u003c') + ')</script></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('動作の確認').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function checkScript_() {
  return String(function () {
    var R = document.getElementById('r');
    function row(title) { var li = document.createElement('li'); li.innerHTML = '<b class="wait">…</b> ' + title + '<small></small>'; R.appendChild(li);
      return function (ok, note) { li.querySelector('b').className = ok ? 'ok' : 'ng'; li.querySelector('b').textContent = ok ? '✓' : '✗'; li.querySelector('small').textContent = note || ''; }; }
    var errs = row('画面の部品のエラー'); var errList = []; errs(true, 'ありません');
    window.addEventListener('error', function (e) { errList.push(e.message || 'エラー'); errs(false, errList.join(' / ')); });
    row('画面の表示')(true, navigator.userAgent);
    var ls = row('端末への一時保存（未送信を守るため）');
    try { localStorage.setItem('sg:check', '1'); localStorage.removeItem('sg:check'); ls(true, '使えます'); } catch (e) { ls(false, '使えません（プライベートモードなど）：' + e); }
    var run = window.google && google.script && google.script.run;
    var g = row('サーバーへの通り道（google.script.run）'); g(!!run, run ? 'あります' : 'ありません');
    function timed(title, fn, check) {
      var done = row(title), t0 = Date.now(), fin = false;
      var to = setTimeout(function () { if (!fin) { fin = true; done(false, '45秒たっても返事がありません。Chromeで複数のGoogleアカウントにログインしているときに起きやすいです。シークレットウィンドウ（Ctrl+Shift+N）で開き直して、もう一度この画面を見てください'); } }, 45000);
      fn(function (r) { if (fin) return; fin = true; clearTimeout(to); var c = check(r); done(c[0], c[1] + '（' + (Date.now() - t0) + 'ミリ秒）'); },
         function (e) { if (fin) return; fin = true; clearTimeout(to); done(false, '失敗：' + (e && e.message || e)); });
    }
    if (run) {
      timed('サーバーの返事', function (ok, ng) { google.script.run.withSuccessHandler(ok).withFailureHandler(ng).checkServer(); }, function (r) {
        if (!r) return [false, '返事が空でした'];
        var miss = Object.keys(r.sheets || {}).filter(function (k) { return !r.sheets[k]; });
        var f = r.files || {}, bad = [];
        ['calendar', 'sougei', 'shift'].forEach(function (n) { var x = f[n] || {}; if (x.error) bad.push(n + '：ファイルが見つかりません（名前は「' + n + '」）'); else if (!x.end) bad.push(n + '：最後まで貼れていません（' + x.len + '文字で切れています。全部消して貼り直してください）'); else if (!x.boot) bad.push(n + '：中身が違います（貼り直してください）'); });
        var note = '版 ' + r.version + '・職員ID ' + r.staffRows + '行・データ ' + r.docRows + '行・calendar ' + ((f.calendar || {}).len || 0) + '文字・sougei ' + ((f.sougei || {}).len || 0) + '文字';
        if (r.sheetError) return [false, 'スプレッドシートを読めません：' + r.sheetError];
        if (miss.length) return [false, 'シートがありません：' + miss.join('、') + '（エディタで setup を実行してください）。' + note];
        if (bad.length) return [false, bad.join(' / ') + '。' + note];
        return [true, note];
      });
      timed('画面どうしのつながり（公開URL）', function (ok, ng) { google.script.run.withSuccessHandler(ok).withFailureHandler(ng).checkServer(); }, function (r) {
        var b = String(r && r.base || '');
        if (/\/exec$/.test(b)) return [true, b];
        return [false, 'メニューのリンクが「' + b + '」（テスト用）になっています。スプレッドシートの「設定」シートのB2に、デプロイの「ウェブアプリ」のURL（最後が /exec）を貼ってください。「設定」シートが無ければ、エディタで setup をもう一度実行すると作られます'];
      });
      timed('ログインの窓口', function (ok, ng) { google.script.run.withSuccessHandler(ok).withFailureHandler(ng).api('', 'auth.me', []); }, function (r) {
        return r && r.ok === false && r.code === 'auth' ? [true, '動いています'] : [false, '思った返事と違います：' + JSON.stringify(r)];
      });
    }
    var cdn = row('送迎表の画面の部品（インターネットから読み込む React）');
    var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js';
    s.onload = function () { cdn(!!window.React, '読み込めました'); }; s.onerror = function () { cdn(false, '読み込めません。事業所のネットワークやセキュリティソフトが cdnjs.cloudflare.com を止めていないか確かめてください'); };
    document.head.appendChild(s);
  }) .replace(/^function \(\) \{/, '(function () {') + ')();';
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
  var ids = mk(APP.SH.ids, ['職員番号', '名前', '権限', '初期暗証番号', '利用停止', '備考', 'シフト表'], false);
  if (!String(ids.getRange(1, 7).getValue()).trim()) ids.getRange(1, 7).setValue('シフト表');   // 以前に作ったシートにも見出しを足す
  mk(APP.SH.log, ['日時', '職員番号', '名前', '種類', '対象', '内容'], false);
  mk(APP.SH.auth, ['職員番号', 'salt', 'hash', '失敗回数', 'ロック解除', '変更済み'], true);
  mk(APP.SH.sess, ['tokenHash', '職員番号', '期限', '端末'], true);
  mk(APP.SH.docs, ['path', 'rev', 'at', 'meta', 'parts'], true);
  confSheet_();
  if (ids.getLastRow() < 2) {
    ids.appendRow([txt_('000'), '管理者', '管理者', txt_(randomPin_()), '', '最初のログイン用。職員の登録が済んだら利用停止にしてください']);
  }
  syncStaffIds_();
  try { installPushTrigger(); } catch (e) { Logger.log('毎朝の通知のきっかけを入れられませんでした：' + e); }   // 毎朝の「今日の予定」の通知（2026-11-16）
  Logger.log('初期設定が完了しました。「職員ID」シートの000の初期暗証番号でログインできます。');
}

/* ================= 暗証番号の再発行（管理者がエディタから実行） =================
   「職員ID」シートの備考（F列）に「再発行」と書いた人だけ、新しい初期暗証番号をD列に出す。
   その人のログインは解除され（最長10分で切れる）、新しい番号でログイン → 自分の番号に変更、になる */
function resetPins() {
  var n = withLock_(function () {
    var sh = sheet_(APP.SH.ids), r = rows_(APP.SH.ids), done = [];
    r.forEach(function (x, i) {
      var memo = String(x[5] || '');
      if (!/再発行/.test(memo) || /再発行済み/.test(memo)) return;
      var no = normNo_(x[0]); if (!no) return;
      sh.getRange(i + 2, 4).setValue(txt_(randomPin_()));
      sh.getRange(i + 2, 6).setValue(safe_('再発行済み ' + today_()));
      setAuth_(no, { salt: '', hash: '', fails: 0, lockUntil: 0, changed: false });
      var ss = sheet_(APP.SH.sess), sr = rows_(APP.SH.sess);
      for (var j = 0; j < sr.length; j++) if (normNo_(sr[j][1]) === no) {
        ss.getRange(j + 2, 3).setValue(new Date(0));
        try { CacheService.getScriptCache().removeAll(['s:' + sr[j][0], 'm:' + sr[j][0]]); } catch (e) {}   // 覚えているログインもすぐ消す
      }
      done.push(no + ' ' + String(x[1]).trim());
    });
    if (done.length) log_({ no: '', name: '管理者（エディタ）' }, '暗証番号', '再発行', done.join('、'));
    return done.length;
  });
  Logger.log(n ? n + '人の暗証番号を再発行しました。「職員ID」シートD列の新しい番号を本人に伝えてください。' : '備考（F列）に「再発行」と書いた人がいません。');
  return n;
}

/* ================= 入口：すべての呼び出しはここを通る ================= */
function api(token, method, args) {
  var me = null;
  try {
    if (method === 'auth.login') return ok_(login_(args[0], args[1], args[2]));
    me = session_(token);
    if (!me) return err_('auth', 'ログインし直してください');
    var h = HANDLERS[method];
    if (!h) return err_('invalid_argument', '不明な操作です');
    return ok_(h(me, args || []));
  } catch (e) {
    // 保存できないときに原因が分かるよう、変更履歴にも残す（2026-11-07 依頼者「シフト表が未送信のまま」。ログインの誤りなどは残さない）
    if (e && e.code) { if (/^shift\./.test(method) || e.code === 'busy') log_(me || {}, 'エラー', method, (e.code || '') + '：' + (e.message || '')); return err_(e.code, e.message || ''); }
    console.error(e && e.stack || e);
    log_(me || {}, 'エラー', method, String(e && e.message || e) + ' ' + String(e && e.stack || '').slice(0, 300));
    return err_('unavailable', String(e && e.message || e));
  }
}
var HANDLERS = {
  'auth.me': function (me) { return publicMe_(me); },
  // iPhoneのSafariなどで、閉じるたびにログインが消える端末のために「ログインしたままのアドレス」を作る（2026-11-10 依頼者「毎回ログインを求められる」iPhone・Safari）。
  // 新しいログイン（10年）をもう1つ作り、その鍵をアドレスに付ける。ログアウト・暗証番号の変更・再発行で、ほかのログインと同じように使えなくなる
  'auth.deviceLink': function (me) { return deviceLink_(me); },
  'auth.logout': function (me, a) { logout_(a[0]); return true; },
  'auth.changePin': function (me, a) { return changePin_(me, a[0], a[1]); },
  'staff.list': function (me) { return staffList_(); },
  'kv.get': function (me, a) { return kvGet_(String(a[0])); },
  'kv.getMany': function (me, a) { var idx = docIndex_(); return (a[0] || []).slice(0, 60).map(function (k) { var d = docGet_(kvPath_(String(k)), idx); return { key: String(k), rev: d ? d.rev : 0, value: d ? d.value.v : null }; }); },
  'names.list': function (me) { return namesList_(); },
  'cal.search': function (me, a) { return calSearch_(a[0] || {}); },
  'cal.ttLeaveFix': function (me, a) { return ttLeaveFix_(me, !!((a[0] || {}).run)); },
  'app.base': function (me) { return appUrl_(); },   // 画面どうしのリンクに使う公開URL（開いたときに届かなかった場合の予備）
  'kv.importMany': function (me, a) { return kvImportMany_(me, a[0] || []); },
  'kv.list': function (me, a) { return kvList_(String(a[0] || '')); },
  'kv.merge': function (me, a) { return kvMerge_(me, a[0]); },
  'kv.cas': function (me, a) { return kvCas_(me, a[0]); },
  'sync.poll': function (me, a) { return poll_(a[0] || {}); },
  'sg.exportAlerts': function (me, a) { return exportAlerts_(String((a[0] || {}).ns || '')); },
  'shift.get': function (me, a) { return shiftGet_(me, a[0] || {}); },
  'shift.save': function (me, a) { return shiftSave_(me, a[0] || {}); },
  'shift.syncCal': function (me, a) { return shiftSyncCalApi_(me, a[0] || {}); },
  'shift.calFix': function (me, a) { return shiftCalFix_(me, a[0] || {}); },
  'sg.attendance': function (me, a) { return attendance_(me, a[0] || {}); },
  'sg.linkReqs': function (me, a) { return linkReqsOf_(String(a[0] || '')); },   // 生活介護の画面に、りんく・ぷれいす版からの依頼を出す（表示だけ）
  'docs.query': function (me, a) { return docsQuery_(a[0] || {}); },
  'docs.get': function (me, a) { return docGetPublic_(String(a[0])); },
  'cal.apply': function (me, a) { var r = calApply_(me, a[0]); var pu = r && r._push; if (r) delete r._push; if (pu) { try { pushCal_(me, pu); } catch (e) {} } return r; },
  // スマホの通知（入口のページの中で開いているとき。2026-11-16 依頼者）
  'push.key': function (me) { var v = pushVapid_(); return { key: v ? v.publicKey : null }; },
  'push.subscribe': function (me, a) { return pushSubscribe_(me, a[0]); },
  'mfile.list': function (me, a) { return mfileList_(a[0] || {}); },
  'mfile.get': function (me, a) { return mfileGet_(String(a[0] || '')); },
  'mfile.put': function (me, a) { return mfilePut_(me, a[0] || {}); },
  'mfile.del': function (me, a) { return mfileDel_(me, String(a[0] || '')); },
  'push.unsubscribe': function (me, a) { return pushUnsubscribe_(me, a[0]); },
  'push.prefs': function (me) { return pushPrefs_(me.no); },
  'push.setPrefs': function (me, a) { return pushPrefsSet_(me, a[0]); },
  'log.list': function (me, a) { if (me.role !== '管理者') throw { code: 'denied', message: '管理者のみ' }; return logList_(a[0] || 200); },
  'ai.messages': function (me, a) { return aiMessages_(me, a[0]); },
  'prop.list': function (me) { if (me.role !== '管理者' && me.role !== '送迎表') return []; return propList_(); },
  'prop.apply': function (me, a) { return propApply_(me, String(a[0])); },
  'prop.discard': function (me, a) { if (me.role !== '管理者' && me.role !== '送迎表') throw { code: 'denied', message: '権限がありません' }; return propDiscard_(me, String(a[0])); }
};
/* 画面への返事は必ず JSON の形にそろえる（日付などが混ざると、本物のGoogleでは返事がまるごと空で届くため） */
function ok_(data) { return { ok: true, data: data === undefined ? null : JSON.parse(JSON.stringify(data)) }; }
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
  for (var i = 0; i < r.length; i++) if (normNo_(r[i][0]) === no) return { row: i + 2, no: no, name: String(r[i][1]).trim(), role: APP.ROLES.indexOf(String(r[i][2]).trim()) >= 0 ? String(r[i][2]).trim() : '一般', initPin: pinOf_(r[i][3]), stopped: !!String(r[i][4]).trim(), shift: String(r[i][6] == null ? '' : r[i][6]).trim() };
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
    if (auth && (auth.fails || auth.lockUntil)) setAuth_(no, { fails: 0, lockUntil: 0 });   // 書く必要があるときだけ（ログインを速く）
    var token = Utilities.getUuid() + Utilities.getUuid();
    sheet_(APP.SH.sess).appendRow([hash_(token), txt_(no), new Date(now + APP.SESSION_DAYS * 864e5), safe_(String(device || '').slice(0, 80))]);
    log_({ no: no, name: st.name }, 'ログイン', String(device || '').slice(0, 40), '');
    var me = { no: no, name: st.name, role: st.role, mustChange: !(auth && auth.changed), shift: st.shift };
    return { token: token, me: publicMe_(me) };
  });
}
function deviceLink_(me) {
  return withLock_(function () {
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    sheet_(APP.SH.sess).appendRow([hash_(token), txt_(me.no), new Date(Date.now() + APP.SESSION_DAYS * 864e5), safe_('ホーム画面のアドレス')]);
    log_(me, 'ログイン', 'ホーム画面のアドレスを作成', '');
    return { key: token };
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
    if (me.tokenHash) try { CacheService.getScriptCache().remove('m:' + me.tokenHash); } catch (e) {}
    sheet_(APP.SH.ids).getRange(st.row, 4).setValue('（本人が変更済み）');
    log_(me, '暗証番号の変更', '', '');
    return true;
  });
}
function session_(token) {
  if (!token) return null;
  var th = hash_(String(token));
  var cache = CacheService.getScriptCache();
  // 毎回の操作で「職員ID」「_auth」のシートを読むと遅いので、ログインした人の情報は2分覚える。
  // 権限の変更・利用停止は最長2分で効く（暗証番号の変更・ログアウトではすぐ消す）
  var mk = cache.get('m:' + th);
  if (mk) { try { var mm = JSON.parse(mk); mm.tokenHash = th; return mm; } catch (e) {} }
  var hit = cache.get('s:' + th);
  var no = null;
  if (hit) no = hit;
  else {
    var r = rows_(APP.SH.sess), now = new Date();
    var hitRow = -1;
    for (var i = r.length - 1; i >= 0; i--) if (r[i][0] === th) { if (new Date(r[i][2]) > now) { no = normNo_(r[i][1]); hitRow = i; } break; }
    // 以前の120日のログインも、使っているうちは期限をのばす（残りが1年を切ったら10年先へ。10分に1回までしか読まないので書くのはまれ）
    if (no && hitRow >= 0 && new Date(r[hitRow][2]) < new Date(now.getTime() + 365 * 864e5)) {
      try { var lk = LockService.getScriptLock(); if (lk.tryLock(2000)) { try { var r2 = rows_(APP.SH.sess); if (r2[hitRow] && r2[hitRow][0] === th && new Date(r2[hitRow][2]) > new Date()) sheet_(APP.SH.sess).getRange(hitRow + 2, 3).setValue(new Date(Date.now() + APP.SESSION_DAYS * 864e5)); } finally { lk.releaseLock(); } } } catch (e) {}   // 混んでいるときは次の機会に
    }
    if (no) { try { cache.put('s:' + th, no, 600); } catch (e) {} }
  }
  if (!no) return null;
  var st = staffRow_(no);
  if (!st || st.stopped) return null;
  var auth = authRow_(no);
  var me = { no: no, name: st.name, role: st.role, mustChange: !(auth && auth.changed), shift: st.shift };
  try { cache.put('m:' + th, JSON.stringify(me), 120); } catch (e) {}
  me.tokenHash = th;
  return me;
}
function logout_(token) {
  var th = hash_(String(token || '')); CacheService.getScriptCache().remove('s:' + th); CacheService.getScriptCache().remove('m:' + th);
  withLock_(function () { var r = rows_(APP.SH.sess), sh = sheet_(APP.SH.sess); for (var i = 0; i < r.length; i++) if (r[i][0] === th) sh.getRange(i + 2, 3).setValue(new Date(0)); });
}
function publicMe_(me) { return { no: me.no, name: me.name, role: me.role, mustChange: !!me.mustChange, canSougei: me.role === '管理者' || me.role === '送迎表', admin: me.role === '管理者', version: APP.VERSION, aiApi: aiEnabled_(), shift: shiftGroups_(me), shiftOk: shiftGroups_(me).length > 0 || isShiftMember_(me.name), mansionOk: mansionOk_(me) }; }
/* 料金がかかるAI（API版の AI調整・AIと相談）を使えるか。キーを入れていなければ、送迎表の画面にボタンを出さない */
function aiEnabled_() { try { return !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'); } catch (e) { return false; } }
function staffList_() {
  return rows_(APP.SH.ids).filter(function (r) { return String(r[0]).trim() && !String(r[4]).trim(); })
    .map(function (r) { return { no: normNo_(r[0]), name: String(r[1]).trim() }; });
}
/* カレンダーで選ぶ利用者名（3つの版の合計）。マスタ全体（住所などのメモ）は配らない */
/* 予定の検索（1年前〜2年先）。題名・場所・メモ・担当・送迎表の対象（職員・利用者・理由・行き先）から探す。
   ひらがな・カタカナ・全角半角・空白の違いはそろえ、空白で区切った言葉はすべて含むものだけ。300件まで */
function calSearch_(q) {
  var norm = function (s) { return String(s || '').normalize('NFKC').replace(/[\u30a1-\u30f6]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }).replace(/\s+/g, '').toLowerCase(); };
  var terms = String(q.q || '').slice(0, 40).split(/[\s\u3000]+/).map(norm).filter(Boolean);
  if (!terms.length) return { items: [], more: false };
  var day = function (n) { var d = new Date(today_() + 'T00:00:00'); d.setDate(d.getDate() + n); return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); };
  var events = TCCore.mergeDays(docsQuery_({ col: 'days', from: day(-366), to: day(731) }));
  var biz = q.biz === 'houkago' || q.biz === 'seikatsu' || q.biz === 'mansion' ? q.biz : '';
  var hits = Object.keys(events).map(function (k) { return events[k]; }).filter(function (e) {
    if (!e || e.deleted) return false;
    var eb = e.biz === 'houkago' || e.biz === 'mansion' ? e.biz : 'seikatsu';
    if (biz ? eb !== biz : eb === 'mansion') return false;   // 全体の検索にはマンションの予定を入れない（マンションのタブで探す）
    var sg = e.sg || {};
    var hay = norm([e.title, e.place, e.memo, (e.tanto || []).join(' '), (e.users || []).join(' '), (sg.staff || []).join(' '), (sg.users || []).join(' '), sg.reason, sg.note, sg.meetPlace, sg.sendPlace].join(' '));
    return terms.every(function (t) { return hay.indexOf(t) >= 0; });
  });
  hits.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.start || '').localeCompare(String(b.start || '')); });
  return { items: hits.slice(0, 300), more: hits.length > 300 };
}
/* TimeTreeから写した「○○休み」（その他予定）を、名前が送迎表の職員なら「職員休み」にする（管理者だけ。2026-11-05 依頼者「11/12 岩田さんがパートの欄から消えない」）。
   run が false のときは直す予定の一覧だけ返す。直すときは普通の保存と同じ道（calApply_：ロック・変更履歴・送迎表への反映） */
function ttLeaveFix_(me, run) {
  if (me.role !== '管理者') throw { code: 'invalid_argument', message: '管理者だけが使えます' };
  var idx = docIndex_(), staff = {};
  ['v1', 'v2', 'v3'].forEach(function (ed) { var d = docGet_(kvPath_(APP.EDITIONS[ed] + 'master'), idx), m = d ? d.value.v : null; ((m && m.staff) || []).forEach(function (x) { if (x && x.name) staff[String(x.name).trim()] = 1; }); });
  var day = function (n) { var d = new Date(today_() + 'T00:00:00'); d.setDate(d.getDate() + n); return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); };
  var events = TCCore.mergeDays(docsQuery_({ col: 'days', from: day(-366), to: day(731) })), out = [];
  Object.keys(events).forEach(function (k) {
    var e = events[k]; if (!e || e.deleted || !/^tt\d{8}_/.test(e.id) || (e.sg && e.sg.type) || e.label !== 'other') return;
    var m = /^(.+?)[\s\u3000]*(AM|PM|ＡＭ|ＰＭ)?[\s\u3000]*お?休み$/i.exec(String(e.title || '').trim()); if (!m) return;
    var name = m[1].replace(/[\s\u3000]+$/, ''); if (!staff[name]) return;
    var half = m[2] ? (/a/i.test(m[2].normalize('NFKC')) ? 'am' : 'pm') : '';
    out.push({ id: e.id, date: e.date, title: e.title, name: name, half: half, ev: e });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var list = out.map(function (x) { return { id: x.id, date: x.date, title: x.title, name: x.name, half: x.half }; });
  if (!run) return { items: list };
  var done = 0;
  out.forEach(function (x) {
    var e = x.ev, ev = {};
    ['title', 'date', 'endDate', 'allDay', 'start', 'end', 'place', 'memo', 'members', 'biz', 'tanto'].forEach(function (k) { if (e[k] !== undefined) ev[k] = e[k]; });
    ev.label = 'leave';
    ev.sg = { type: 'staff_off', staff: [x.name], users: [] }; if (x.half) { ev.sg.half = x.half; ev.allDay = true; }
    else if (!e.allDay) ev.sg.reason = '中抜け';
    var r = calApply_(me, { kind: 'upsert', opId: 'op_ttfix_' + e.id, id: e.id, baseRev: e.rev, ev: ev });
    if (r && r.status === 'ok') done++;
  });
  return { items: list, done: done };
}
/* Excel出力のあとにカレンダーの変更があった日（昨日以降）。送迎表の画面がときどき聞いて、お知らせを出す */
function exportAlerts_(ns) {
  if (['', 'v2:', 'v3:'].indexOf(ns) < 0) return [];
  var sh = sheet_(APP.SH.docs), n = sh.getLastRow(); if (n < 2) return [];
  // 過ぎた日（今日より前）のカレンダーの変更は知らせない（2026-11-25 依頼者「既に過ぎた日でカレンダーの変更があった場合は、送迎表には出ないように」→「お知らせを出さない」。以前は昨日から）
  var heads = sh.getRange(2, 1, n - 1, 4).getValues();
  var from = today_(), idx = null, out = [];
  heads.forEach(function (h) {
    var meta; try { meta = h[3] ? JSON.parse(h[3]) : {}; } catch (e) { return; }
    if (!meta.expChg || !meta.k || meta.k !== ns + 'sheet:' + meta.date || meta.date < from) return;
    idx = idx || docIndex_();
    var d = docGet_(String(h[0]), idx); if (!d || !d.value || !d.value.v) return;
    var ch = SGCal.exportChanges(d.value.v); if (!ch.length) return;
    out.push({ date: meta.date, exportedAt: d.value.v.exportedAt, changes: ch.slice(0, 20) });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return out.slice(0, 31);
}
function toMinG_(t) { var m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : 9999; }
function namesList_() {
  var c = CacheService.getScriptCache(), hit = c.get('names9');
  if (hit) return JSON.parse(hit);
  // 利用者の候補：生活介護＝現体制版・新体制版（users）、放課後デイ＝りんく・ぷれいす版（kids）
  // 職員がどちらの事業か（staffBiz：名前→["seikatsu"]/["houkago"]/両方）。カレンダーで最初に開くタブと、事業の取り違えの確認に使う
  var staffBiz = {}, staffDept = {}, helps = {}, kidHelps = {};
  var users = [], kids = [], seenK = {}, seen = {}, idx = docIndex_(), depts = [], seenD = {}, places = ['自宅', 'ﾘﾍﾞ'], seenP = { '自宅': 1, 'ﾘﾍﾞ': 1 };
  ['v1', 'v2', 'v3'].forEach(function (ed) { try {   // 1つの版でつまずいても、ほかの版の名前は出す（2026-11-23 依頼者「ヘルプで利用者の候補が出ない」）
    var d = docGet_(kvPath_(APP.EDITIONS[ed] + 'master'), idx); var m = d ? d.value.v : null; if (!m) return;
    m = SGCal.peopleWithPast(m);   // 日付の区切りにだけいる人（このあといなくなる人など）も候補に（2026-11-14）
    var dn = function (id) { var x = (m.departments || []).filter(function (y) { return y.id === id; })[0]; return x ? x.name : ''; };
    // 週間パターンでの迎え・送りの時刻（利用者タブに時刻が無い人のいつもの時刻。2026-11-12 依頼者「その利用者のデフォルトのその日の送り時間」）
    var patT = {}, hp = {};
    for (var pw = 0; pw < 7; pw++) { var pd = docGet_(kvPath_(APP.EDITIONS[ed] + 'pattern:' + pw), idx), pv = pd && pd.value ? pd.value.v : null;
      // いつものヘルプ（週間パターンのヘルプ。名前→曜日→[{t,l}]）。カレンダーのヘルプキャンセルで見せて選べるように（2026-11-27 依頼者「デフォルトのヘルプが目視できるか選択できるように」）
      ((pv && pv.blocks) || []).forEach(function (b) { if (!b || b.kind !== 'help' || !b.time || /^(cal_|lk_)/.test(String(b.id || ''))) return;
        (m.users || []).forEach(function (u) { if (!u || !u.name || !SGCal.helpOfUser(b.label, u.name)) return; var hu = (hp[u.name] = hp[u.name] || {}), a = (hu[pw] = hu[pw] || []);
          if (!a.some(function (x) { return toMinG_(x.t) === toMinG_(b.time); })) a.push({ t: b.time, l: String(b.label || '').trim() }); }); });
      ((pv && pv.runs) || []).forEach(function (r) { if (!r || (r.kind !== 'meet' && r.kind !== 'send') || !r.time) return; var ix = r.kind === 'meet' ? 0 : 1;
        (r.userIds || []).forEach(function (uid) { var a = (patT[uid] = patT[uid] || {}), b = (a[pw] = a[pw] || ['', '']); if (!b[ix] || toMinG_(r.time) < toMinG_(b[ix])) b[ix] = r.time; }); }); }
    var tbOf = function (u) { var tb = {}; for (var w = 0; w < 7; w++) { var o = (u.timeByDay || {})[w] || {}, pt = (patT[u.id] || {})[w] || ['', ''];
      var mt = o.meet || u.meetTime || pt[0] || '', st = o.send || u.sendTime || pt[1] || ''; if (mt || st) tb[w] = [mt, st]; } return tb; };
    Object.keys(hp).forEach(function (n) { Object.keys(hp[n]).forEach(function (w) { hp[n][w].sort(function (a, b) { return toMinG_(a.t) - toMinG_(b.t); }); }); });
    var hTo = ed === 'v3' ? kidHelps : helps; Object.keys(hp).forEach(function (n) { if (ed === 'v2' || !hTo[n]) hTo[n] = hp[n]; });   // 生活介護は新体制版を先に
    var bz = ed === 'v3' ? 'houkago' : 'seikatsu';
    (m.staff || []).forEach(function (st) { if (!st || !st.name || (st.retireDate && st.retireDate <= today_())) return; var a = staffBiz[st.name] || (staffBiz[st.name] = []); if (a.indexOf(bz) < 0) a.push(bz); });
    // 職員のいつもの部署（版ごと。曜日で違う人は w）。休日出勤・職員時間変更で、最初から「嫁島」などを出すため
    var sd = staffDept[ed] = {};
    (m.staff || []).forEach(function (st) { if (!st || !st.name) return; var w = {}; for (var k in (st.deptByDay || {})) { var n = dn(st.deptByDay[k]); if (n) w[k] = n; } sd[st.name] = { d: dn(st.baseDeptId || st.deptId), w: w };
      // いつもの勤務時間（曜日ごとは sb）と中抜け（a）。カレンダーの職員時間変更「中抜け」で最初から時刻を入れるため（2026-11-05）
      var sb = {}; for (var k2 in (st.shiftByDay || {})) { var x2 = st.shiftByDay[k2]; if (x2 && x2.start && x2.end) sb[k2] = [x2.start, x2.end]; }
      if (st.start && st.end) sd[st.name].t = [st.start, st.end];
      if (Object.keys(sb).length) sd[st.name].sb = sb;
      if (st.awayFrom && st.awayTo) sd[st.name].a = [st.awayFrom, st.awayTo]; });
    if (ed === 'v3') (m.users || []).forEach(function (u) { if (u && u.name && !seenK[u.name]) { seenK[u.name] = 1;
      var tb3 = tbOf(u);
      kids.push(Object.assign({ name: u.name, dept: dn(u.deptId), tm: [u.meetTime || '', u.sendTime || ''] }, Object.keys(tb3).length ? { tb: tb3 } : {})); } });
    else (m.users || []).forEach(function (u) {
      if (!u || !u.name) return; var isLib = !!(u.libertaAM || u.libertaPM);
      // いつもは家族送り・家族迎え（送迎なし）の人（馬場・猪原など）：fm/fs にその文言。カレンダーの送迎変更で「こちらから迎える／送る」を出すため（2026-11-11 依頼者）
      var fam = function (k) { var v = String((k === 'send' ? u.sendPlace : u.meetPlace) || '').trim(); if (v) return /^(家族|母|父)/.test(v) ? v : ''; var d = u.noRideDefault; return d && d[k] ? String(d[k]) : ''; };
      var fm = fam('meet'), fs = fam('send'), ext = Object.assign({}, isLib ? { lib: true } : {}, fm ? { fm: fm } : {}, fs ? { fs: fs } : {});
      // いつもの迎え・送りの時刻（tm=[迎え,送り]、tb=曜日ごと）。カレンダーの送迎変更で「時間・場所変更」の時刻に薄い灰色で入れる（2026-11-12 依頼者）。新体制版の値を優先
      var tb = tbOf(u);
      var tmx = { tm: [u.meetTime || '', u.sendTime || ''] }; if (Object.keys(tb).length) tmx.tb = tb;
      if (ed === 'v2') users.forEach(function (x) { if (x.name === u.name) { x.tm = tmx.tm; if (tmx.tb) x.tb = tmx.tb; else delete x.tb; } });
      Object.assign(ext, tmx);
      if (!seen[u.name]) { seen[u.name] = 1; users.push(Object.assign({ name: u.name, dept: dn(u.deptId) }, ext)); }
      else users.forEach(function (x) { if (x.name === u.name) Object.keys(ext).forEach(function (k) { if (!x[k]) x[k] = ext[k]; }); });
    });   // lib＝リベルタ（ﾏﾝｼｮﾝ）の利用者（2026-11-07 依頼者：リベルタ利用ラベルはその人たちだけ）
    // 休日出勤・勤務時間変更の部署を選ぶための名前（送迎表の名前で持ち、各版で名前から探す）
    // 迎え先・送り先の候補：利用者タブの「いつもの迎え先・送り先」（家族送り・家族迎えは別の選択肢なので除く）
    (m.users || []).forEach(function (u) { [u && u.meetPlace, u && u.sendPlace].forEach(function (v) { v = String(v || '').trim(); if (/^(リベルタ|リベ|ﾘﾍﾞﾙﾀ|ﾘﾍﾞ)$/.test(v)) v = 'ﾘﾍﾞ'; if (v && !/^(家族|母|父)/.test(v) && !seenP[v]) { seenP[v] = 1; places.push(v); } }); });
    (m.departments || []).forEach(function (d) { if (d && d.name && !seenD[d.name]) { seenD[d.name] = 1; depts.push(d.name); } });
  } catch (e) { console.error(e && e.stack || e); try { log_({}, 'エラー', 'names.list', ed + '：' + String(e && e.message || e) + ' ' + String(e && e.stack || '').slice(0, 300)); } catch (e2) {} } });
  // 送迎の「迎えなし・送りなし」の理由（送迎表のルール「家族送り・家族迎えなど」。どの版も変えていなければ初期の3つ）。2026-11-05 依頼者
  var noRide = { meet: [], send: [] }, anyNr = false;
  ['v2', 'v1', 'v3'].forEach(function (ed) {
    var d = docGet_(kvPath_(APP.EDITIONS[ed] + 'master'), idx), m = d ? d.value.v : null, rs = m && m.rules && m.rules.noRideReasons;
    if (!Array.isArray(rs)) return; anyNr = true;
    rs.forEach(function (x) { var t = String((x && x.text) || '').trim(), k = x && x.kind === 'send' ? 'send' : 'meet'; if (t && noRide[k].indexOf(t) < 0) noRide[k].push(t); });
  });
  if (!anyNr) noRide = { meet: ['家族送り', '受診後送り'], send: ['家族迎え'] };
  var out = { helps: helps, kidHelps: kidHelps, users: users, kids: kids, staffBiz: staffBiz, staffDept: staffDept, depts: depts, places: places, noRide: noRide, yomi: yomiMap_() };
  try { c.put('names9', JSON.stringify(out), 300); } catch (e) {}
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
  try { syncYomi_(); } catch (e) {}
  if (!names.length) return 0;
  var sh = sheet_(APP.SH.ids), r = rows_(APP.SH.ids);
  var have = {}, maxNo = 0;
  r.forEach(function (x) { have[String(x[1]).trim()] = true; maxNo = Math.max(maxNo, Number(normNo_(x[0])) || 0); });
  var add = [];
  names.forEach(function (n) { if (!have[n]) { maxNo++; add.push([txt_(pad3_(maxNo)), safe_(n), '一般', txt_(randomPin_()), '', '送迎表から自動登録']); } });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 6).setValues(add);
  return add.length;
}
/* 「よみがな」シート：A=名前・B=よみ（ひらがな。管理者が入れる）・C=職員/利用者。名前は送迎表から自動で足す。
   カレンダーで「た」と打つと「田中」などが出るようにするため（送迎表のデータには読みが無い） */
function syncYomi_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(APP.SH.yomi);
  if (!sh) { sh = ss.insertSheet(APP.SH.yomi); sh.getRange(1, 1, 1, 3).setValues([['名前', 'よみ（ひらがな。最初の数文字だけでも可）', '職員／利用者']]); sh.setFrozenRows(1); }
  var have = {}; (sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : []).forEach(function (r) { have[String(r[0]).trim()] = 1; });
  var add = [];
  ['v1', 'v2', 'v3'].forEach(function (ed) {
    var d = docGet_('kv/' + SGKV.encKey(APP.EDITIONS[ed] + 'master')); var m = d ? d.value.v : null; if (!m) return;
    [['職員', m.staff || []], ['利用者', m.users || []]].forEach(function (g) {
      g[1].forEach(function (x) { var n = x && String(x.name || '').trim(); if (n && !have[n]) { have[n] = 1; add.push([safe_(n), '', g[0]]); } });
    });
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  return add.length;
}
function yomiMap_() {
  var sh = sheet_(APP.SH.yomi), out = {}; if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { var n = String(r[0]).trim(), y = String(r[1]).trim(); if (n && y) out[n] = y; });
  return out;
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
  // 送迎表の1日分：Excel出力のあとにカレンダーの変更があれば、その数を目印に残す（sg.exportAlerts が一覧だけで探せるように）
  if (value && typeof value.k === 'string' && /(^|:)sheet:\d{4}-\d{2}-\d{2}$/.test(value.k) && value.v && value.v.exportedAt) {
    try { meta = Object.assign({}, meta || {}, { expChg: SGCal.exportChanges(value.v).length, date: value.k.slice(-10) }); } catch (e) {}
  }
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
  var k = path.indexOf('kv/') === 0 ? 'rev:' + path : path.indexOf('prop/') === 0 ? 'rev:props' : path.indexOf('shift/') === 0 ? 'rev:shift' : 'rev:cal';
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
      linkAfterSave_(key, merged, idx);
      log_(me, '送迎表', kvLabel_(key), diffSummary_(cur, merged) + (conflicts.length ? '（同じ箇所の同時変更 ' + conflicts.length + 'か所：この変更を優先）' : ''));
      if (/(^|:)master$/.test(key)) { syncStaffIds_(); try { CacheService.getScriptCache().remove('names9'); } catch (e) {} }
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
      docSet_(path, { k: key, v: v, by: me.no }, (cur ? cur.rev : 0) + 1, { k: key }, idx); n++; linkAfterSave_(key, v, idx);
    });
    log_(me, '送迎表', 'バックアップから復元', n + '件');
    syncStaffIds_(); try { CacheService.getScriptCache().remove('names9'); } catch (e) {}
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
    linkAfterSave_(key, a.value, idx);
    log_(me, '送迎表', kvLabel_(key), '初期データの取り込み');
    if (/(^|:)master$/.test(key)) { syncStaffIds_(); try { CacheService.getScriptCache().remove('names9'); } catch (e) {} }
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
  // 職員の休み・予定・休日出勤・勤務時間変更も、ほかの職員の分を入れられる（2026-10-31 依頼者。以前は本人の分だけ）。変更・削除もだれでも（2026-11-15）
  // 利用者が関わるもの（利用者休み・送迎の変更・利用日外利用・ヘルプ）も、すべての職員が入力できる
  var sg = op.kind === 'upsert' ? op.ev.sg : null;
  return withLock_(function () {
    var idx = docIndex_();
    var paths = TCCore.targetsOf(op);
    var raws = paths.map(function (p) { var d = docGet_(p, idx); return d ? d.value : null; });
    // 入れた予定は、だれでも変更・削除できる（2026-11-15 依頼者「入れたカレンダーの内容は誰でも編集できるように。変更に対応できるよう」。以前は送迎表に反映する予定は作った人か管理者だけ）。
    // だれが変えたかは変更履歴に残る（作った人 createdBy はそのまま）
    // マンションの予定は、マンションの人と管理者だけが入れる・直す・消す（前の内容・新しい内容のどちらかがマンションなら）
    if (op.kind !== 'comment') {
      var prevEv = null; raws.forEach(function (r) { var e = r && r.events && r.events[op.id]; if (e) prevEv = e; });
      if (((prevEv && prevEv.biz === 'mansion') || (op.ev && op.ev.biz === 'mansion')) && !mansionOk_(me))
        throw { code: 'permission_denied', message: 'マンションの予定は、マンションの勤務の人と管理者だけが入れられます' };
    }
    var res = TCCore.applyOp(op, paths, raws);
    if (res.status === 'outdated') return { status: 'failed' };
    if (res.status === 'conflict' && opAppliedBefore_(op.opId)) return { status: 'done' };   // 前に保存されていた同じ操作（重なりにしない＝古い内容で上書きさせない）
    if (res.status !== 'ok') return { status: res.status, reason: res.reason || null, theirs: res.theirs || null };
    res.writes.forEach(function (w) {
      var meta = w.path.indexOf('days/') === 0 ? { date: w.data.date, maxEnd: w.data.maxEnd } : { date: w.data.date };
      var d = docGet_(w.path, idx);
      docSet_(w.path, w.data, (d ? d.rev : 0) + 1, meta, idx);
    });
    var title = op.kind === 'comment' ? '' : (op.ev && op.ev.title) || (raws[0] && raws[0].events && raws[0].events[op.id] && raws[0].events[op.id].title) || '';
    log_(me, 'カレンダー', { upsert: op.baseRev == null && !op.baseOp ? '予定の作成' : '予定の変更', delete: '予定の削除', restore: '予定の復元', comment: 'コメント' }[op.kind], title + (sg ? '（送迎表：' + sgText_(sg) + '）' : ''));
    calJournal_(me, op, raws);   // 予定の控え（どの版にも戻せるように。2026-11-24 依頼者「カレンダーに入れたデータが絶対消えないように」）
    // 送迎表への反映でつまずいても、カレンダーの保存は「保存済み」にする（以前は反映のエラーで保存も失敗に見え、送り直すと「届いていた」扱いで反映がされないままだった）。
    // 反映は送迎表を開いた・保存したときにもう一度される。つまずいたことは変更履歴に「エラー」で残す
    if (op.kind !== 'comment') { try { reconcileDates_(op, raws, idx); } catch (e) { console.error(e && e.stack || e); log_(me, 'エラー', '送迎表への反映', title + '：' + String(e && e.message || e).slice(0, 200)); } }
    // 書いた日の文書を返す：画面はこれで表を直し、月の読み直しを待たずに「保存済み」にできる
    var docs = res.writes.filter(function (w) { return w.path.indexOf('days/') === 0; }).map(function (w) { return w.data; });
    // スマホの通知に使う中身（cal.apply の返事からは外す）。シフト表・TimeTreeから写した予定は知らせない
    var ex0 = null; raws.forEach(function (r) { var e = r && r.events && r.events[op.id]; if (e) ex0 = e; });
    var push = op.kind === 'comment' || /^(sh[mf]|tt)\d{8}_/.test(op.id) ? null : { id: op.id, title: title, date: (op.ev && op.ev.date) || (ex0 && ex0.date) || '', mansion: (op.ev && op.ev.biz === 'mansion') || (ex0 && ex0.biz === 'mansion') || false,
      kind: op.kind === 'delete' ? 'del' : op.kind === 'restore' ? 'new' : (ex0 && !ex0.deleted ? 'chg' : 'new') };
    return { status: 'ok', docs: docs, _push: push };
  });
}
/* 予定の控え（隠しシート「_予定の控え」）：カレンダーの保存のたびに、その操作の中身（新しい内容・消す前の内容）をまるごと1行ずつ足していく。
   書き換え・削除・ゴミ箱の自動整理（30日）のあとでも、どの時点の内容にも戻せる。控えを書けなくても保存は止めない */
function calJournal_(me, op, raws) {
  try {
    var sh = sheet_('_予定の控え');
    if (!sh) { sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet('_予定の控え'); sh.appendRow(['日時', '職員番号', '操作', '予定ID', '日付', '中身（新しい内容）', '前の内容', '操作ID']); try { sh.hideSheet(); } catch (e) {} }
    var before = null; raws.forEach(function (r) { var e = r && r.events && r.events[op.id]; if (e) before = e; });
    var cut = function (v) { if (v == null) return ''; var s = JSON.stringify(v); return 'J' + (s.length > 45000 ? s.slice(0, 45000) : s); };
    var after = op.kind === 'upsert' ? op.ev : op.kind === 'comment' ? op.comment : null;
    // スプレッドシート全体のマスの数には上限（1000万）があるので、15万行（1日500件でおよそ10か月分）を超えたら、いちばん古い2万行を消す
    try { if (sh.getLastRow() > 150000) sh.deleteRows(2, 20000); } catch (e) {}
    sh.appendRow([new Date(), txt_(me.no || ''), op.kind, txt_(op.id), txt_((op.ev && op.ev.date) || op.date || op.cmKey || (before && before.date) || ''), cut(after), op.kind === 'comment' ? '' : cut(before), txt_(op.opId || '')]);
  } catch (e) { console.error(e && e.stack || e); }
}
/* この操作はもう前に保存されていたか（予定の控えの「操作ID」で探す）。入口のページから戻した控えなど、届いていたのに端末に残っていた古い操作が、
   あとでほかの人が直した予定と「重なり」になって、古い内容で上書きされないようにする（2026-11-24 依頼者「デバッグのプロの目線で再検証」） */
function opAppliedBefore_(opId) {
  try {
    var sh = sheet_('_予定の控え'); if (!sh || !opId) return false;
    var last = sh.getLastRow(); if (last < 2) return false;
    var k = Math.min(last - 1, 30000), vals = sh.getRange(last - k + 1, 8, k, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).replace(/^'/, '') === opId) return true;
  } catch (e) {}
  return false;
}
function sgText_(sg) {
  var t = { staff_off: sg.half === 'am' ? 'AM休' : sg.half === 'pm' ? 'PM休' : '休み・不在', staff_plan: '職員の予定', user_absent: '欠席', user_extra: '利用日外利用' + [sg.meet ? ' 迎え' + sg.meet : '', sg.noMeet ? ' ' + sg.noMeet : '', sg.send ? ' 送り' + sg.send : '', sg.noSend ? ' ' + sg.noSend : ''].join(''),
    user_time: '送迎の変更' + [sg.meet ? ' 迎え' + sg.meet : '', sg.noMeet ? ' ' + sg.noMeet : '', sg.meetPlace ? ' 迎え先' + sg.meetPlace : '', sg.send ? ' 送り' + sg.send : '', sg.noSend ? ' ' + sg.noSend : '', sg.sendPlace ? ' 送り先' + sg.sendPlace : ''].join(''),
    help: 'ヘルプ', hwork: '休日出勤', shift: '職員時間変更' + (sg.wstart ? ' 出勤' + sg.wstart : '') + (sg.wend ? ' 退勤' + sg.wend : '') }[sg.type];
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
    if (ev.biz === 'mansion') ev.sg = null;   // マンションの予定は送迎表に反映しない
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
  if (md && md.value.v) {
    var events = TCCore.mergeDays(docsQuery_({ col: 'days', from: m[2], to: m[2] }));
    value = SGCal.reconcile(md.value.v, value, Object.keys(events).map(function (k) { return events[k]; }), m[2]);
  }
  return linkSheetValue_(m[1] || '', m[2], value, idx);
}
/* ===== りんく・ぷれいす版 → 生活介護 の送迎の依頼（calsync.js の linkReqs / linkApply / linkStatus） =====
   依頼先はその日の生活介護の版（11/1から新体制版、それより前は現体制版） */
function linkTargetNs_(date) { return String(date) >= '2026-11-01' ? 'v2:' : ''; }
function linkSheetValue_(ns, date, value, idx) {
  var tns = linkTargetNs_(date);
  if (ns === 'v3:') {                                   // りんく側：生活介護で決まった担当・車を写す
    var v3m = docGet_(kvPath_('v3:master'), idx), reqs = SGCal.linkReqs(value, v3m ? v3m.value.v : null);
    var td = docGet_(kvPath_(tns + 'sheet:' + date), idx), tm = docGet_(kvPath_(tns + 'master'), idx);
    var st = td && tm ? SGCal.linkStatus(td.value.v, tm.value.v) : null, out = {};
    reqs.forEach(function (q) { out[q.id] = st ? (st[q.id] || { staff: '', veh: '' }) : { pending: true }; });
    if (!SGKV.eq(out, value.reqStatus || {})) { value = JSON.parse(JSON.stringify(value)); if (reqs.length) value.reqStatus = out; else delete value.reqStatus; }
    return value;
  }
  if (ns !== tns) return value;
  var v3s = docGet_(kvPath_('v3:sheet:' + date), idx), v3m2 = v3s ? docGet_(kvPath_('v3:master'), idx) : null;
  return SGCal.linkApply(value, v3s ? SGCal.linkReqs(v3s.value.v, v3m2 ? v3m2.value.v : null) : []);
}
/* ================= シフト表（マンション職員の早番・遅番。2026-11-02 依頼者） =================
   男性・女性の2つ。「職員ID」シートG列（シフト表）に 男性／女性／両方 と書いた人と管理者が組める（作る・直す）。
   表に名前がある職員は、自分の希望（休・AM休・PM休・早・遅・日）だけ入れられる。
   保存は送迎表と同じく、ロックの中で3者マージ（ほかの人の変更を消さない）＋変更履歴 */
/* シフト表を組める人（2026-11-02 依頼者）：男性・女性の表の職員に加えて、この人たちは男性・女性の両方を組める。ほかの人は「職員ID」G列 */
var SHIFT_EDITORS_ = ['八壁', '井川', '久保田'];
function shiftNameIs_(name, short) { var a = String(name || '').replace(/[\s　]/g, ''), b = String(short || '').replace(/[\s　]/g, ''); return !!b && a.indexOf(b) === 0; }
/* ログインした人の名前（例「橋本 太郎」）→ シフト表の名前（「橋本」）。表の名前で希望を持つ */
function shiftMemberName_(cfg, name) { var x = (cfg.members || []).filter(function (m) { return shiftNameIs_(name, m.name); }).sort(function (a, b) { return b.name.length - a.name.length; })[0]; return x ? x.name : ''; }
function shiftGroups_(me) {
  if (me.role === '管理者') return ['m', 'f'];
  if (SHIFT_EDITORS_.some(function (n) { return shiftNameIs_(me.name, n); })) return ['m', 'f'];
  var v = String(me.shift || '');
  if (/両方|全|◯|○|〇/.test(v)) return ['m', 'f'];
  var out = []; if (/男/.test(v)) out.push('m'); if (/女/.test(v)) out.push('f'); return out;
}
/* マンションのカレンダー（2026-11-17 依頼者「マンションカレンダー。入れるのはマンションの勤務の人と管理者だけ」）：
   入れる・直す・消す・活動計画書を貼る・消すのは、管理者・シフト表を組む人（SHIFT_EDITORS_・G列）・シフト表（男性・女性）に名前がある職員。見るのは全員 */
function mansionOk_(me) { return !!me && (me.role === '管理者' || shiftGroups_(me).length > 0 || isShiftMember_(me.name)); }
function mansionNos_() {   // 通知を送る相手（マンションの予定はマンションの人だけに知らせる）
  var out = {}; rows_(APP.SH.ids).forEach(function (r) { if (!String(r[0]).trim() || String(r[4]).trim()) return;
    var me = { no: normNo_(r[0]), name: String(r[1]).trim(), role: String(r[2]).trim(), shift: String(r[6] == null ? '' : r[6]).trim() };
    if (mansionOk_(me)) out[me.no] = 1; });
  return out;
}
/* マンションの日ごとの活動計画書（2026-11-17 依頼者「日付を開いて、ワードやエクセルをドロップすると活動計画書ができるように」→「その日に貼り付けて見られる」）
   _docs に mfile/<日付>/<ID>（中身は base64、meta に 日付・名前・大きさ・種類・入れた人）。見るのは全員、貼る・消すのはマンションの人と管理者 */
var MFILE_MAX_ = 3 * 1024 * 1024;   // 1つ3MBまで（スプレッドシートに入れるため）
var MFILE_EXT_ = /\.(xlsx|xlsm|xls|docx|doc|pdf|png|jpe?g|gif|csv|txt)$/i;
function mfileList_(q) {
  var D = /^\d{4}-\d{2}-\d{2}$/, from = D.test(q.from) ? q.from : (D.test(q.date) ? q.date : ''), to = D.test(q.to) ? q.to : from;
  if (!from) throw { code: 'invalid_argument', message: '' };
  var sh = sheet_(APP.SH.docs), n = sh.getLastRow(); if (n < 2) return { items: [] };
  var out = [];
  sh.getRange(2, 1, n - 1, 4).getValues().forEach(function (r) {
    var p = String(r[0]); if (p.indexOf('mfile/') !== 0) return;
    var m = r[3] ? JSON.parse(r[3]) : {}; if (m.deleted || !(m.date >= from && m.date <= to)) return;
    out.push({ id: p.slice(6), date: m.date, name: m.name, size: m.size, type: m.type, by: m.byName || '', at: m.at || '' });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.at).localeCompare(String(b.at)); });
  return { items: out };
}
function mfilePath_(id) { if (!/^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{6,40}$/.test(id)) throw { code: 'invalid_argument', message: '' }; return 'mfile/' + id; }
function mfileGet_(id) {
  var d = docGet_(mfilePath_(id)); if (!d || !d.meta || d.meta.deleted) throw { code: 'not_found', message: 'このファイルはもうありません（消された可能性があります）' };
  return { name: d.meta.name, type: d.meta.type, size: d.meta.size, data: String(d.value || '') };
}
function mfilePut_(me, f) {
  if (!mansionOk_(me)) throw { code: 'permission_denied', message: '活動計画書を貼れるのは、マンションの勤務の人と管理者だけです' };
  var D = /^\d{4}-\d{2}-\d{2}$/, name = String(f.name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120), data = String(f.data || '');
  if (!D.test(f.date) || !name || !MFILE_EXT_.test(name)) throw { code: 'invalid_argument', message: 'Word・Excel・PDF・画像のファイルを入れてください' };
  if (!/^[A-Za-z0-9+\/=]*$/.test(data) || !data) throw { code: 'invalid_argument', message: 'ファイルを読み込めませんでした' };
  var size = Math.floor(data.length * 3 / 4) - (/==$/.test(data) ? 2 : /=$/.test(data) ? 1 : 0);
  if (size > MFILE_MAX_) throw { code: 'invalid_argument', message: 'ファイルが大きすぎます（3MBまで）' };
  var id = f.date + '/' + Utilities.getUuid().replace(/-/g, '').slice(0, 20), at = new Date().toISOString();
  var meta = { date: f.date, name: name, size: size, type: String(f.type || '').slice(0, 100), by: me.no, byName: me.name, at: at };
  withLock_(function () { docSet_(mfilePath_(id), data, 1, meta); });
  log_(me, 'マンション', '活動計画書を貼る', f.date + ' ' + name);
  return { id: id, date: f.date, name: name, size: size, type: meta.type, by: me.name, at: at };
}
function mfileDel_(me, id) {
  if (!mansionOk_(me)) throw { code: 'permission_denied', message: '活動計画書を消せるのは、マンションの勤務の人と管理者だけです' };
  var path = mfilePath_(id), name = '';
  withLock_(function () { var idx = docIndex_(), d = docGet_(path, idx); if (!d || d.meta.deleted) return;
    name = d.meta.name; docSet_(path, null, d.rev + 1, Object.assign({}, d.meta, { deleted: true, delBy: me.name, delAt: new Date().toISOString() }), idx); });
  if (name) log_(me, 'マンション', '活動計画書を消す', id.slice(0, 10) + ' ' + name);
  return { ok: true };
}
/* シフト表（男性・女性のどちらか）に名前がある職員か。カレンダーに「シフト表」のボタンを出すかどうかに使う */
function isShiftMember_(name) {
  if (!name) return false;
  try { var idx = docIndex_(); return ['m', 'f'].some(function (g) { var c = docGet_('shift/' + g + '/cfg', idx); return (SGShift.cfgOf(g, c ? c.value : null).members || []).some(function (x) { return shiftNameIs_(name, x.name); }); }); } catch (e) { return false; }
}
function shiftArgs_(a) {
  var group = a && a.group === 'f' ? 'f' : a && a.group === 'm' ? 'm' : '';
  var ym = String((a && a.ym) || '');
  if (!group || !/^\d{4}-\d{2}$/.test(ym)) throw { code: 'invalid_argument', message: 'シフト表の指定が正しくありません' };
  return { group: group, ym: ym, cfgPath: 'shift/' + group + '/cfg', monthPath: 'shift/' + group + '/' + ym };
}
function shiftGet_(me, a) {
  var q = shiftArgs_(a), idx = docIndex_();
  var c = docGet_(q.cfgPath, idx), m = docGet_(q.monthPath, idx);
  var cfg = SGShift.cfgOf(q.group, c ? c.value : null), canEdit = shiftGroups_(me).indexOf(q.group) >= 0;
  var mine = shiftMemberName_(cfg, me.name), member = !!mine;
  if (!canEdit && !member) throw { code: 'invalid_argument', message: 'このシフト表を見る権限がありません（「職員ID」シートG列か、表の職員に入っている人だけ）' };
  // その月がまだ保存されていなければ、紙から写した最初の中身（SGShift.monthOf。2026年11月・男性）
  var mv = SGShift.monthOf(q.group, q.ym, m ? m.value : null), calLeft = 0;
  // カレンダーに書いた予定が今の表・今の書き方とちがえば、画面に続けて書いてもらう（2026-11-26 依頼者「カレンダーが職員その他のまま変わってない」＝
  // 以前の書き方の予定は保存しないと書き直されなかった。開いただけで直す）
  try { calLeft = shiftCalStale_(q.group, q.ym, mv, idx) ? 1 : 0; } catch (e) {}
  return { cfg: { rev: c ? c.rev : 0, value: c ? c.value : null }, month: { rev: m ? m.rev : 0, value: canEdit ? mv : shiftHide_(mv, q.ym) }, canEdit: canEdit, member: member, myName: mine || me.name, calLeft: calLeft };
}
// 確定していない月は、組む人（管理者など）だけが勤務を見られる。表の職員には希望だけ渡す（2026-11-07 依頼者）
function shiftHide_(v, ym) {
  if (!v || SGShift.isFixed(v, ym)) return v;
  var o = JSON.parse(JSON.stringify(v)); o.days = {}; o.hidden = true; return o;
}
function shiftSave_(me, a) {
  var q = shiftArgs_(a), kind = a.kind === 'cfg' ? 'cfg' : 'month', canEdit = shiftGroups_(me).indexOf(q.group) >= 0;
  if (kind === 'cfg' && !canEdit) throw { code: 'invalid_argument', message: 'シフト表の設定を変える権限がありません' };
  return withLock_(function () {
    var idx = docIndex_(), path = kind === 'cfg' ? q.cfgPath : q.monthPath, cur = docGet_(path, idx);
    var theirs = cur ? cur.value : (kind === 'month' ? SGShift.monthOf(q.group, q.ym, null) : null), rev = cur ? cur.rev : 0, merged;
    if (!canEdit) {
      // 組む権限のない職員：自分の希望だけ（ほかの欄は送ってきても使わない）
      var c = docGet_(q.cfgPath, idx), cfg = SGShift.cfgOf(q.group, c ? c.value : null);
      var who = shiftMemberName_(cfg, me.name);
      if (!who) throw { code: 'invalid_argument', message: 'このシフト表に入れる権限がありません' };
      var pick = function (v, k) { return v && v[k] ? v[k][who] : undefined; };
      merged = JSON.parse(JSON.stringify(theirs || {}));
      ['wish', 'wishNote'].forEach(function (k) {
        var r = SGKV.merge3(pick(a.base, k), pick(a.mine, k), pick(theirs, k)).value;
        merged[k] = merged[k] || {}; if (r === undefined || r === null) delete merged[k][who]; else merged[k][who] = r;
      });
    } else merged = a.baseKnown && SGKV.eq(a.base, theirs) ? a.mine : SGKV.merge3(a.baseKnown ? a.base : null, a.mine, theirs).value;
    // 希望が変わった人・日は、その希望に合わない番の枠を空ける（日勤の希望なら早番・遅番から外して日勤へ。2026-11-11 依頼者）
    if (kind === 'month') merged = SGShift.fitWishes(theirs, merged, q.ym);
    if (!SGKV.eq(merged, theirs)) {
      rev = rev + 1;
      docSet_(path, merged, rev, { k: path }, idx);
      log_(me, 'シフト表', SGShift.GROUPS[q.group] + (kind === 'cfg' ? '（設定）' : ' ' + q.ym), canEdit ? (kind === 'cfg' ? '設定の変更' : (!!(merged && merged.fixed) !== !!(theirs && theirs.fixed) ? (merged && merged.fixed ? 'シフトを確定' : '確定を取り消し') : 'シフトの変更')) : '希望の変更');
    }
    // 組んだ勤務を職場カレンダーにも（2026-11-07 依頼者「自動で随時反映」）。失敗してもシフト表の保存は止めない
    var calLeft = 0;
    if (kind === 'month') { try { calLeft = shiftSyncCal_(q.group, q.ym, merged, idx); } catch (e) { Logger.log('シフト表→カレンダー：' + (e && e.message || e)); } }
    return { rev: rev, value: canEdit ? merged : shiftHide_(merged, q.ym), calLeft: calLeft };
  });
}
/* シフト表 → 職場カレンダー（2026-11-07 依頼者）。1人1日1件の「職員その他」の予定（例「余村慎 早番①」、終日）。
   送迎表には反映しない（sg なし。送迎表の勤務時間はいつもどおり）。ID は sh<m|f><YYYYMMDD>_<名前の目印>。
   前回カレンダーに書いた内容を shift/<g>/<YYYY-MM>/cal に覚えておき、変わった日の文書だけ書き直す（速さのため）。
   シフト表から消えた人・日は削除（ゴミ箱へ）。カレンダーで直しても、次にシフト表を保存したときシフト表の内容に戻る */
function shNameKey_(n) { var h = 5381; n = String(n); for (var i = 0; i < n.length; i++) h = ((h * 33) ^ n.charCodeAt(i)) >>> 0; return h.toString(36); }
// シフト表の予定は、その日の文書のうち1つ（_2）にまとめる（書く文書の数を1日1つにして速く）。IDの終わりで決める
function shCalId_(pre, date, name) {
  var base = pre + date.slice(8) + '_' + shNameKey_(name);
  for (var k = 0; k < 200; k++) { var id = k ? base + 'x' + k : base; if (/_2$/.test(TCCore.dayPath(date, id))) return id; }
  return base;
}
// カレンダーに書くべき予定（id → 中身）
function shiftCalWant_(group, ym, month, idx) {
  var cd = docGet_('shift/' + group + '/cfg', idx), items = SGShift.isFixed(month, ym) ? SGShift.calItems(month || {}, ym, SGShift.cfgOf(group, cd ? cd.value : null)) : [], pre = 'sh' + group + ym.replace('-', '');
  var want = {};
  // 送迎表に反映する中身（職員時間変更・休日出勤・職員休み。2026-11-26 依頼者「その他予定になっているが、勤務変更にしといてもらわないと送迎表に反映されない」）。
  // 前回書いた内容は題名だけでなく中身ごと覚える（sig。以前の「職員その他」で書いた分は書き直す）
  items.forEach(function (it) { var c = SGShift.calSgOf(it); if (!c) return; it.c = c; it.sig = JSON.stringify([it.title, c.label, c.allDay, c.start, c.end, c.sg]); want[shCalId_(pre, it.date, it.name)] = it; });
  return { want: want, pre: pre };
}
// 前回書いた内容と今の表がちがうか（開いたときに見る。書くのは shift.syncCal）
function shiftCalStale_(group, ym, month, idx) {
  var w = shiftCalWant_(group, ym, month, idx).want, lastDoc = docGet_('shift/' + group + '/' + ym + '/cal', idx), last = (lastDoc && lastDoc.value) || {};
  return Object.keys(w).some(function (id) { return last[id] !== w[id].sig; }) || Object.keys(last).some(function (id) { return !w[id]; });
}
var SH_SYNC_MAX = 8;   // 1回に書き直す日の文書の数（はじめての月は何回かに分けて書く。残りは画面が続けて頼む shift.syncCal）
function shiftSyncCal_(group, ym, month, idx) {
  // 確定するまではカレンダーに出さない（確定を取り消したら消す。2026-11-07 依頼者）
  var W = shiftCalWant_(group, ym, month, idx), want = W.want, pre = W.pre;
  var lastPath = 'shift/' + group + '/' + ym + '/cal', lastDoc = docGet_(lastPath, idx), last = (lastDoc && lastDoc.value) || {};
  var byPath = {}, touch = function (id, date) { var p = TCCore.dayPath(date, id); (byPath[p] = byPath[p] || { date: date, ids: [] }).ids.push(id); };
  Object.keys(want).forEach(function (id) { if (last[id] !== want[id].sig) touch(id, want[id].date); });
  Object.keys(last).forEach(function (id) { if (!want[id]) touch(id, ym + '-' + id.slice(pre.length, pre.length + 2)); });
  var all = Object.keys(byPath).sort(); if (!all.length) return 0;
  var paths = all.slice(0, SH_SYNC_MAX), done = {};
  var now = new Date().toISOString(), n = 0, dates = {};
  paths.forEach(function (p) {
    byPath[p].ids.forEach(function (id) { done[id] = 1; });
    var d = docGet_(p, idx), events = TCCore.normDay(d ? d.value : null), changed = false;
    byPath[p].ids.forEach(function (id) {
      var ex = events[id], it = want[id];
      if (it) {
        var c = it.c;
        if (ex && !ex.deleted && ex.title === it.title && ex.label === c.label && JSON.stringify(ex.sg) === JSON.stringify(TCCore.normSg ? TCCore.normSg(c.sg) : c.sg) && !!ex.allDay === c.allDay && (c.allDay || (ex.start === c.start && ex.end === c.end))) return;
        var ev = TCCore.normEvent({ title: it.title, date: it.date, endDate: it.date, allDay: c.allDay, start: c.start, end: c.end, label: c.label, biz: 'seikatsu', tanto: [it.name], sg: c.sg,
          memo: 'シフト表から自動で入った予定です。直すときはシフト表で直してください（ここで直しても、次にシフト表を保存すると戻ります）',
          createdBy: ex ? ex.createdBy : 'shift', createdAt: ex ? ex.createdAt : now, updatedBy: 'shift', updatedAt: now, rev: (ex ? ex.rev : 0) + 1, lastOp: 'shift' + now.replace(/\D/g, '') }, id, 0);
        if (ev) { events[id] = ev; changed = true; n++; dates[it.date] = 1; }
      } else if (ex && !ex.deleted) {
        var del = JSON.parse(JSON.stringify(ex)); del.deleted = true; del.deletedAt = now; del.deletedBy = 'shift'; del.rev = ex.rev + 1; del.updatedAt = now;
        events[id] = TCCore.normEvent(del, id, 0); changed = true; n++; dates[ex.date] = 1;
      }
    });
    if (!changed) return;
    var doc = TCCore.buildDay(p, events, now); if (!doc) return;   // 1日の文書が大きすぎるときは書かない（ほかの予定を守る）
    docSet_(p, doc, (d ? d.rev : 0) + 1, { date: doc.date, maxEnd: doc.maxEnd }, idx);
  });
  // 書いた分だけ「前回書いた内容」を進める（残りは次の呼び出しで書く）
  var keep = JSON.parse(JSON.stringify(last));
  Object.keys(done).forEach(function (id) { if (want[id]) keep[id] = want[id].sig; else delete keep[id]; });
  docSet_(lastPath, keep, (lastDoc ? lastDoc.rev : 0) + 1, { k: lastPath }, idx);
  // 書いた日の送迎表に反映（カレンダーで入れたときと同じ。まだ無い日は送迎表を開いたときに入る）
  try { reconcileDays_(Object.keys(dates), idx); } catch (e) { log_({ name: 'シフト表' }, 'エラー', '送迎表への反映', (e && e.message) || String(e)); }
  return all.length - paths.length;   // まだ書いていない日の文書の数
}
// 画面から：シフト表の残りをカレンダーに書く（はじめての月など。1回に SH_SYNC_MAX 日分）
function shiftSyncCalApi_(me, a) {
  var q = shiftArgs_(a);
  if (shiftGroups_(me).indexOf(q.group) < 0 && !isShiftMember_(me.name)) throw { code: 'invalid_argument', message: 'このシフト表に入れる権限がありません' };
  return withLock_(function () {
    var idx = docIndex_(), cur = docGet_(q.monthPath, idx), month = cur ? cur.value : SGShift.monthOf(q.group, q.ym, null);
    return { left: shiftSyncCal_(q.group, q.ym, month, idx) };
  });
}
/* カレンダーから：シフト表から入った予定が以前の書き方（職員その他・①②③つき）のままのとき、書き直してもらう（2026-11-26 依頼者「変わってない」＝
   シフト表を開かないと書き直されなかった。11月は男性の表を開いても12月から出るので書き直されていなかった）。
   だれが頼んでもよい（書くのはサーバーがシフト表から作った中身だけ。画面から中身は受け取らない）。書くことが無ければ何もしない */
function shiftCalFix_(me, a) {
  var q = shiftArgs_(a), idx0 = docIndex_(), cur0 = docGet_(q.monthPath, idx0), m0 = cur0 ? cur0.value : SGShift.monthOf(q.group, q.ym, null);
  if (!shiftCalStale_(q.group, q.ym, m0, idx0)) return { left: 0 };
  return withLock_(function () {
    var idx = docIndex_(), cur = docGet_(q.monthPath, idx), month = cur ? cur.value : SGShift.monthOf(q.group, q.ym, null);
    return { left: shiftSyncCal_(q.group, q.ym, month, idx) };
  });
}
/* 期間の出欠一覧（2026-11-07 依頼者「長期休暇だと誰がいて誰がいないか一覧でわかるようにエクセルで。特定の期間を選んで」）。
   日ごとに、その日の送迎表（まだ無い日は空の表）にカレンダーの予定を反映した内容で、利用者は ○（来る）/休（欠席）/空（利用日でない）、
   職員は ○（出勤。時間を変えた日は時刻つき）/休（休み）/公休（固定休）。生活介護は11/1から新体制版・それより前は現体制版、放課後デイはりんく・ぷれいす版。保存はしない（見るだけ） */
function attendance_(me, a) {
  if (!(me.role === '管理者' || me.role === '送迎表')) throw { code: 'invalid_argument', message: '出欠の一覧は、送迎表の担当者・管理者だけが出せます' };
  var D = /^\d{4}-\d{2}-\d{2}$/, from = String(a.from || ''), to = String(a.to || ''), biz = a.biz === 'houkago' ? 'houkago' : 'seikatsu';
  if (!D.test(from) || !D.test(to) || to < from) throw { code: 'invalid_argument', message: '期間（はじめの日・おわりの日）を正しく選んでください' };
  var dates = [], d0 = new Date(from + 'T00:00:00Z');
  while (true) { var ds = Utilities.formatDate(d0, 'UTC', 'yyyy-MM-dd'); if (ds > to) break; dates.push(ds); if (dates.length > 93) throw { code: 'invalid_argument', message: '期間は3か月（93日）までにしてください' }; d0 = new Date(d0.getTime() + 864e5); }
  var idx = docIndex_(), evMap = TCCore.mergeDays(docsQuery_({ col: 'days', from: from, to: to })), events = Object.keys(evMap).map(function (k) { return evMap[k]; });
  var masters = {}, users = {}, staff = {}, uOrder = [], sOrder = [];
  var mOf = function (ns) { if (!(ns in masters)) { var md = docGet_(kvPath_(ns + 'master'), idx); masters[ns] = md && md.value ? md.value.v : null; } return masters[ns]; };
  var dn = function (m, id) { var x = (m.departments || []).filter(function (y) { return y.id === id; })[0]; return x ? x.name : ''; };
  var out = dates.map(function (date) {
    var ns = biz === 'houkago' ? 'v3:' : linkTargetNs_(date), m = mOf(ns); if (!m) return { date: date };
    m = SGCal.peopleAt(m, date);   // その日の職員・利用者（日付で切り替わる変更。2026-11-14）
    var sd = docGet_(kvPath_(ns + 'sheet:' + date), idx);
    var v = sd && sd.value && sd.value.v ? sd.value.v : { runs: [], blocks: [], staffOv: {}, userAbsent: {}, userExtra: {}, noRide: {}, userTime: {} };
    v = SGCal.reconcile(m, v, events, date);
    var wd = new Date(date + 'T00:00:00Z').getUTCDay(), ov = v.staffOv || {}, ab = v.userAbsent || {}, ux = v.userExtra || {};
    (m.users || []).forEach(function (u) {
      if (!u || !u.name) return;
      var on = (u.days || []).indexOf(wd) >= 0 || !!ux[u.id];
      if (!users[u.name]) { users[u.name] = { name: u.name, dept: dn(m, u.deptId), cells: {} }; uOrder.push(u.name); }
      users[u.name].cells[date] = !on ? '' : ab[u.id] ? '休' : '○';
    });
    (m.staff || []).forEach(function (s) {
      if (!s || !s.name || (s.retireDate && s.retireDate <= date)) return;
      var o = ov[s.id] || {}, fixed = (s.offDays || []).indexOf(wd) >= 0 && !o.workToday;
      if (!staff[s.name]) { staff[s.name] = { name: s.name, dept: dn(m, s.deptId), part: s.emp === 'パート', cells: {} }; sOrder.push(s.name); }
      staff[s.name].cells[date] = o.off ? '休' : fixed ? '公休' : '○' + (o.start || o.end ? '(' + (o.start || '') + '〜' + (o.end || '') + ')' : '');
    });
    return { date: date };
  });
  return { from: from, to: to, biz: biz, dates: out.map(function (x) { return x.date; }),
    users: uOrder.map(function (n) { return users[n]; }), staff: sOrder.map(function (n) { return staff[n]; }) };
}
/* りんく・ぷれいす版のその日の依頼（生活介護の画面で表示するため）。生活介護のその日の表がまだ保存されていなくても出せるように
   （2026-10-31 実機：まだ保存されていない日の生活介護の表に依頼が出なかった） */
function linkReqsOf_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  var idx = docIndex_(), s = docGet_(kvPath_('v3:sheet:' + date), idx); if (!s) return [];
  var m = docGet_(kvPath_('v3:master'), idx);
  return SGCal.linkReqs(s.value.v, m ? m.value.v : null);
}
/* 保存のあと、相手の版の送迎表にも伝える（ロックの中で呼ぶ）。相手の送迎表がまだ無い日は、作られたときに入る */
function linkAfterSave_(key, value, idx) {
  var m = /^(v\d:)?sheet:(\d{4}-\d{2}-\d{2})$/.exec(key); if (!m) return;
  var ns = m[1] || '', date = m[2], tns = linkTargetNs_(date);
  var other = ns === 'v3:' ? tns + 'sheet:' + date : ns === tns ? 'v3:sheet:' + date : null; if (!other) return;
  var od = docGet_(kvPath_(other), idx); if (!od) return;
  var next = reconcileSheetValue_(other, od.value.v, idx);
  if (!SGKV.eq(next, od.value.v)) {
    docSet_(kvPath_(other), { k: other, v: next, by: 'link' }, od.rev + 1, { k: other }, idx);
    log_({ no: 'link', name: '自動' }, '送迎表', kvLabel_(other), ns === 'v3:' ? 'りんく・ぷれいす版からの送迎の依頼を反映' : '生活介護で決まった担当・車を反映');
  }
}
/* 予定の前後の日付について、既にある送迎表へ反映（取り消しも）する */
// 何日も続く予定（長い入院・長期休暇など）も、1年分までその日の送迎表に反映する（2026-11-24。以前は62日まで＝それより後の日は送迎表を保存し直すまで反映されなかった）。まだ作られていない日は読むだけで何もしないので軽い
function reconcileDates_(op, rawsBefore, idx) {
  var dates = {};
  var addRange = function (a, b) { if (!a) return; b = b || a; var d = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00'), n = 0; while (d <= e && n++ < 370) { dates[Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd')] = 1; d.setDate(d.getDate() + 1); } };
  rawsBefore.forEach(function (r) { var ev = r && r.events && r.events[op.id]; if (ev) addRange(ev.date, ev.endDate); });
  if (op.ev) addRange(op.ev.date, op.ev.endDate);
  reconcileDays_(Object.keys(dates), idx);
}
function reconcileDays_(dateList, idx) {
  (dateList || []).forEach(function (date) {
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
