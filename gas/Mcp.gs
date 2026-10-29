/**
 * Claude（月額プラン）とつなぐ口：MCP（カスタムコネクタ）
 *
 * ・Claudeアプリで話した内容から、Claudeが送迎表を読み、組み替え案を「AIの案」として置く
 * ・案は送迎表画面の「🤖 Claudeの案」で担当者が確認して反映する（担当者が会話で「反映して」と言ったときだけ、Claudeが反映することもできる）
 * ・接続URLは職員ごと。誰がClaudeで何をしたかは「変更履歴」に残る
 * ・Googleのウェブアプリは返事のヘッダーや状態コードを選べないため、MCPの「JSONで返す」方式だけを使う
 */
var MCP = { VERSION: '2026.10.27c', SHEET: 'AI接続', PROTOCOLS: ['2025-06-18', '2025-03-26', '2024-11-05'] };

/* ---------- 接続URLの発行（管理者がエディタで実行） ----------
   「AI接続」シートのA列に職員番号を入れて issueConnectorUrls を実行すると、C列に接続URLが入る */
function issueConnectorUrls() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MCP.SHEET) || ss.insertSheet(MCP.SHEET);
  if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, 5).setValues([['職員番号', '名前', '接続URL（Claudeのカスタムコネクタに貼る）', '停止', '発行日']]); sh.setFrozenRows(1); }
  var base = appUrl_();   // テスト用の …/dev では Claude からつながらないので、公開URLを使う
  var n = sh.getLastRow(); if (n < 2) return 0;
  var rows = sh.getRange(2, 1, n - 1, 5).getValues(), made = 0;
  rows.forEach(function (r, i) {
    var no = normNo_(r[0]); if (!no || String(r[2]).trim()) return;
    var st = staffRow_(no); if (!st) { sh.getRange(i + 2, 2).setValue('（職員番号が見つかりません）'); return; }
    var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    sh.getRange(i + 2, 1, 1, 5).setValues([[txt_(no), safe_(st.name), base + '?mcp=1&k=' + key, '', new Date()]]);
    made++;
  });
  return made;
}
function mcpStaff_(key) {
  if (!key || String(key).length < 40) return null;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MCP.SHEET); if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < rows.length; i++) {
    var url = String(rows[i][2]);
    if (url.slice(url.length - String(key).length) === String(key) && /[?&]k=/.test(url)) {
      if (String(rows[i][3]).trim()) return null;
      var st = staffRow_(normNo_(rows[i][0])); if (!st || st.stopped) return null;
      if (st.role !== '管理者' && st.role !== '送迎表') return null;
      return { no: st.no, name: st.name, role: st.role };
    }
  }
  return null;
}

/* ---------- 入口 ---------- */
function doPost(e) {
  var p = (e && e.parameter) || {};
  if (!p.mcp) return ContentService.createTextOutput('{}').setMimeType(ContentService.MimeType.JSON);
  var me = mcpStaff_(p.k);
  var body; try { body = JSON.parse((e.postData && e.postData.contents) || 'null'); } catch (x) { body = null; }
  var out = function (o) { return ContentService.createTextOutput(o == null ? '' : JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  if (!body) return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  var one = function (msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return msg && msg.id != null ? { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid Request' } } : null;
    if (msg.id == null) return null; // 通知には返事をしない
    if (!me) return { jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: '接続URLが無効です。管理者に「AI接続」シートで発行し直してもらってください（権限は「管理者」か「送迎表」が必要です）' } };
    try { return { jsonrpc: '2.0', id: msg.id, result: mcpHandle_(me, msg.method, msg.params || {}) }; }
    catch (x) { return { jsonrpc: '2.0', id: msg.id, error: { code: x && x.rpc || -32603, message: (x && x.message) || String(x) } }; }
  };
  if (Array.isArray(body)) { var res = body.map(one).filter(function (x) { return x; }); return out(res.length ? res : null); }
  return out(one(body));
}
function mcpHandle_(me, method, params) {
  if (method === 'initialize') {
    var pv = MCP.PROTOCOLS.indexOf(params.protocolVersion) >= 0 ? params.protocolVersion : MCP.PROTOCOLS[0];
    return { protocolVersion: pv, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sougei-hyo', title: '送迎表', version: MCP.VERSION }, instructions: MCP_INSTRUCTIONS };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: MCP_TOOLS };
  if (method === 'tools/call') {
    var name = params.name, args = params.arguments || {};
    var fn = MCP_IMPL[name]; if (!fn) throw { rpc: -32602, message: '道具「' + name + '」はありません' };
    try { var text = fn(me, args); return { content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text) }] }; }
    catch (x) { return { content: [{ type: 'text', text: '失敗: ' + ((x && x.message) || String(x)) }], isError: true }; }
  }
  if (method === 'resources/list') return { resources: [] };
  if (method === 'prompts/list') return { prompts: [] };
  throw { rpc: -32601, message: 'Method not found: ' + method };
}

var MCP_INSTRUCTIONS = [
  'これは介護事業所の送迎表アプリです。担当者と会話しながら、送迎表・利用者・職員・車両・部署・ルール・ヘルプ表・週間パターンを整えます。',
  '1. 最初に get_rules で送迎のルールを読みます(会話ごとに1回)。',
  '2. その日の話なら get_day、毎週の話なら get_master や get_week_pattern で今の状態を読みます。ids(r1,h1など)はその回の状態でだけ有効です。',
  '3. 変更は propose で「AIの案」として置きます。送迎表はまだ変わりません。返ってきた「新しく出る問題」があれば直して propose(proposal_id付き)で出し直します。',
  '4. 担当者は送迎表画面の「🤖 Claudeの案」で確認して反映します。担当者が会話ではっきり「反映して」と言ったときだけ apply_proposal を使います。',
  '返事は日本語で短く。何を変えたか、残っている問題、確認したいことを伝えます。削除は担当者がはっきり頼んだときだけ行います。'
].join('\n');

var EDITION_PROP = { type: 'string', enum: ['v1', 'v2', 'v3'], description: 'v1=現体制版 v2=新体制版(11/1〜) v3=りんく・ぷれいす版。省略時は日付から自動(11/1以降はv2)' };
var CHANGE_ITEM = { type: 'object', description: '便・ヘルプの変更。{"op":"update","id":"r1","staff":"職員名","veh":"車名","time":"8:30","users":["利用者名"],"dest":"部署名","dur":60} / {"op":"add","kind":"迎|送|他|ヘルプ","time":"15:30","staff":"職員名","veh":"車名(ヘルプは自車も可)","users":["利用者名"],"label":"ヘルプ名"} / {"op":"delete","id":"r2"}' };
var MCP_TOOLS = [
  { name: 'get_rules', title: '送迎のルールを読む', description: '送迎表を組むときのルール(固定担当・男性職員・定員・時刻厳守など)の全文。会話の最初に1回読む。日付でルールが切り替わることがあるので、組む日の date を渡す', inputSchema: { type: 'object', properties: { edition: EDITION_PROP, date: { type: 'string', description: '組む日(YYYY-MM-DD)。その日に効くルールを返す。省略するといちばん新しいルール' } } }, annotations: { readOnlyHint: true } },
  { name: 'get_day', title: 'その日の送迎表を読む', description: 'その日の職員・利用者・車両・便・ヘルプ・未割当・保留と、Excel出力前と同じチェックの結果。proposal_id を付けるとその案を当てたあとの状態', inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, edition: EDITION_PROP, proposal_id: { type: 'string' } }, required: ['date'] }, annotations: { readOnlyHint: true } },
  { name: 'get_master', title: '利用者・職員・車両・部署・ルール設定を読む', description: '利用者の利用曜日・曜日ごとの利用先・時刻、職員の勤務・固定休、車両、部署、ルールタブ・ヘルプ表の設定', inputSchema: { type: 'object', properties: { edition: EDITION_PROP, proposal_id: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'get_week_pattern', title: '週間パターンを読む', description: 'ある曜日の週間パターンの便・ヘルプ(id付き)', inputSchema: { type: 'object', properties: { weekday: { type: 'integer', minimum: 0, maximum: 6, description: '0日〜6土' }, edition: EDITION_PROP, proposal_id: { type: 'string' } }, required: ['weekday'] }, annotations: { readOnlyHint: true } },
  { name: 'propose', title: '組み替え案を置く', description: '変更を「AIの案」として置く(送迎表はまだ変わらない)。返事に、変わる所・この案で新しく出る問題・反映できなかった変更が出る。proposal_id を付けるとその案に重ねて直す。dayChanges/masterChanges/ruleChanges の書き方は get_rules の末尾を参照', inputSchema: { type: 'object', properties: {
    date: { type: 'string', description: 'YYYY-MM-DD(その日の送迎表を変えるとき・チェックする日)' }, edition: EDITION_PROP, proposal_id: { type: 'string' }, title: { type: 'string', description: '案の名前(例: 安達休みの組み替え)' },
    changes: { type: 'array', items: CHANGE_ITEM }, staffOff: { type: 'array', items: { type: 'string' } }, staffTime: { type: 'array', items: { type: 'object' } }, userAbsent: { type: 'array', items: { type: 'string' } },
    dayChanges: { type: 'object' }, masterChanges: { type: 'array', items: { type: 'object' } }, ruleChanges: { type: 'array', items: { type: 'object' } },
    patternChanges: { type: 'array', items: { type: 'object', properties: { day: { type: 'integer' }, changes: { type: 'array', items: CHANGE_ITEM } } } } } } },
  { name: 'list_proposals', title: 'AIの案の一覧', description: 'まだ反映していないAIの案', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'apply_proposal', title: 'AIの案を反映する', description: '担当者が会話ではっきり「反映して」と言ったときだけ使う。相談中に他の人が変えた分と統合して反映する', inputSchema: { type: 'object', properties: { proposal_id: { type: 'string' } }, required: ['proposal_id'] }, annotations: { destructiveHint: false } },
  { name: 'discard_proposal', title: 'AIの案を捨てる', description: '置いた案を捨てる', inputSchema: { type: 'object', properties: { proposal_id: { type: 'string' } }, required: ['proposal_id'] } }
];

/* ---------- 状態の読み込み ---------- */
var WDN_ = ['日', '月', '火', '水', '木', '金', '土'];
function edOf_(args) { if (args.edition && APP.EDITIONS.hasOwnProperty(args.edition)) return args.edition; return args.date && String(args.date) >= '2026-11-01' ? 'v2' : 'v1'; }
function nsOf_(ed) { return APP.EDITIONS[ed]; }
function chkDate_(d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) throw { message: '日付は 2026-11-02 の形で指定してください' }; return String(d); }
function loadBase_(ed, date, days) {
  var idx = docIndex_(), ns = nsOf_(ed);
  var m = docGet_(kvPath_(ns + 'master'), idx); if (!m) throw { message: APP.EDITION_LABEL[ed] + 'のデータがまだありません(edition で v1=現体制版 / v2=新体制版 / v3=りんく・ぷれいす版 を指定できます)' };
  var st = { ed: ed, master: m.value.v, masterRev: m.rev, sheet: null, sheetRev: 0, patterns: {}, patRev: {} };
  if (date) { var s = docGet_(kvPath_(ns + 'sheet:' + date), idx); st.sheet = s ? s.value.v : SGEngine.emptySheet(); st.sheetRev = s ? s.rev : 0; st.sheetExists = !!s; }
  (days || []).forEach(function (d) { var p = docGet_(kvPath_(ns + 'pattern:' + d), idx); st.patterns[d] = p ? p.value.v : { runs: [], blocks: [], training: '' }; st.patRev[d] = p ? p.rev : 0; });
  return st;
}
function propGet_(id) { if (!/^[a-z0-9]{8,40}$/.test(String(id || ''))) throw { message: '案の番号が正しくありません' }; var d = docGet_('prop/' + id); if (!d || !d.value || d.value.status !== 'open') throw { message: 'この案は見つからないか、すでに反映・破棄されています' }; return d.value; }
function dayMaster_(m, sheet, wd, date) { return SGEngine.applyDayDept(m, wd, sheet && sheet.staffOv, sheet && sheet.userDept, sheet && sheet.userExtra, date); }
function grid_(d, dm, wd) { var g = { staffOv: {}, userAbsent: {}, userDept: {}, notes: '', contact: '', libertaOff: {}, libertaOn: {}, userTime: {}, runs: [], blocks: [] }; for (var k in d) g[k] = d[k]; var nr = SGEngine.noRideDefaults(dm, wd); for (var k2 in (d.noRide || {})) nr[k2] = d.noRide[k2]; g.noRide = nr; return g; }
function idMapOf_(c) { var m = {}; c.runs.forEach(function (r) { m[r.id] = { t: 'runs', id: r._id }; }); c.helps.forEach(function (h) { m[h.id] = { t: 'blocks', id: h._id }; }); return m; }
function strip_(arr) { return arr.map(function (x) { var o = {}; for (var k in x) if (k !== '_id') o[k] = x[k]; return o; }); }
function checksOf_(master, sheet, date, pat) { var wd = SGEngine.weekdayOf(date); return SGEngine.collectSheetChecks(dayMaster_(master, sheet, wd, date), sheet, date, pat); }
function problemsOf_(groups) { var out = []; groups.forEach(function (g) { if (/重大エラー|乗せ忘れ|車両のエラー|時間のエラー|男性不在/.test(g.title)) g.items.forEach(function (i) { out.push(g.title + ': ' + i); }); }); return out; }
function dayText_(master, sheet, date, pat) {
  var wd = SGEngine.weekdayOf(date), dm = dayMaster_(master, sheet, wd, date), c = SGEngine.aiContextOf(dm, grid_(sheet, dm, wd), wd);
  var g = checksOf_(master, sheet, date, pat).map(function (x) { return '■' + x.title + '\n' + x.items.slice(0, 20).map(function (i) { return '・' + i; }).join('\n'); }).join('\n');
  return '# ' + date + '(' + WDN_[wd] + ')\n# 職員(off:true=休み)\n' + JSON.stringify(c.staffOn) + '\n# 利用者(absent:true=欠席。meet/send=希望時刻、"なし(...)"=送迎不要)\n' + JSON.stringify(c.users) +
    '\n# 車両\n' + JSON.stringify(c.vehicles) + '\n# 便(idはこの状態でだけ有効)\n' + JSON.stringify(strip_(c.runs)) + '\n# ヘルプ・予定\n' + JSON.stringify(strip_(c.helps)) +
    '\n# 未割当  迎え: ' + (c.unMeet.join('・') || 'なし') + ' / 送り: ' + (c.unSend.join('・') || 'なし') + '\n# 保留の予定id: ' + (c.holdIds.join('、') || 'なし') +
    '\n# その日の欄  特記事項: ' + JSON.stringify(sheet.notes || '') + ' / 連絡事項: ' + JSON.stringify(sheet.contact || '') + '\n# チェック(Excel出力前と同じ)\n' + (g || '問題なし');
}
function stateFor_(args, needDays) {
  if (args.proposal_id) { var pr = propGet_(args.proposal_id); var dr = pr.draft; return { ed: pr.ed, date: pr.date, master: dr.master, sheet: dr.sheet, patterns: dr.patterns || {}, prop: pr }; }
  var ed = edOf_(args), b = loadBase_(ed, args.date, needDays || []);
  return { ed: ed, date: args.date, master: b.master, sheet: b.sheet, patterns: b.patterns, base: b };
}

var MCP_IMPL = {
  get_rules: function (me, a) {
    var b = loadBase_(edOf_(a), null, []), date = a.date ? chkDate_(a.date) : '';
    var m = date ? Object.assign({}, b.master, { rules: SGEngine.rulesAtDate(b.master, date) }) : b.master;
    return '# 送迎のルール(' + APP.EDITION_LABEL[b.ed] + (date ? '・' + date + 'に効くルール' : '') + ')\n' + SGEngine.aiRulesText(m) + '\n\n# propose の書き方(dayChanges・masterChanges・ruleChanges)\n' + MCP_FORMAT;
  },
  get_day: function (me, a) {
    var date = chkDate_(a.date || (a.proposal_id ? propGet_(a.proposal_id).date : ''));
    var s = stateFor_({ date: date, edition: a.edition, proposal_id: a.proposal_id }, [SGEngine.weekdayOf(date)]);
    if (s.prop && s.prop.date !== date) throw { message: 'この案は ' + s.prop.date + ' の案です' };
    var pat = (s.patterns || {})[SGEngine.weekdayOf(date)] || (loadBase_(s.ed, null, [SGEngine.weekdayOf(date)]).patterns[SGEngine.weekdayOf(date)]);
    return '【' + APP.EDITION_LABEL[s.ed] + (s.prop ? '・案「' + s.prop.title + '」を当てた状態' : (s.base && !s.base.sheetExists ? '・この日の送迎表はまだ作られていません(週間パターンから作るときは担当者に「パターンから読込」を頼む)' : '')) + '】\n' + dayText_(s.master, s.sheet, date, pat);
  },
  get_master: function (me, a) {
    var s = stateFor_({ edition: a.edition, proposal_id: a.proposal_id }, []); var m = s.master;
    var dn = function (id) { var d = m.departments.filter(function (x) { return x.id === id; })[0]; return d ? d.name : ''; };
    var days = function (a2) { return (a2 || []).map(function (n) { return WDN_[n]; }).join(''); };
    var mapD = function (o) { var r = {}; for (var k in (o || {})) r[k] = dn(o[k]); return r; };
    var R = SGEngine.rulesOf(m), rules = {}; Object.keys(SGEngine.RULE_LISTS).forEach(function (k) { rules[k] = R[k] || []; });
    return '【' + APP.EDITION_LABEL[s.ed] + '】\n# 利用者\n' + JSON.stringify(m.users.map(function (u) { return { name: u.name, days: days(u.days), dept: dn(u.deptId), deptByDay: mapD(u.deptByDay), meet: u.meetTime || '', send: u.sendTime || '', timeByDay: u.timeByDay || undefined, daysFrom: u.daysFrom || undefined, wc: !!u.wheelchair, male: !!u.isMale, note: u.helpNote || undefined, noRideDefault: u.noRideDefault || undefined, liberta: (u.libertaAM ? '朝' : '') + (u.libertaPM ? '夕' : '') || undefined }; })) +
      '\n# 職員\n' + JSON.stringify(m.staff.filter(function (x) { return !x.retireDate; }).map(function (x) { return { name: x.name, dept: dn(x.deptId), position: x.position || undefined, male: !!x.isMale, time: x.start + '-' + x.end, off: days(x.offDays) || undefined, shiftByDay: x.shiftByDay || undefined, deptByDay: mapD(x.deptByDay), helpOnly: x.helpOnly || undefined, canDrive: x.canDrive !== false }; })) +
      '\n# 車両\n' + JSON.stringify(m.vehicles.map(function (v) { return { name: v.name, dept: dn(v.deptId), cap: v.capNormal, wc: v.wheelchairOK ? v.capWc : 0, memo: v.memo || undefined }; })) +
      '\n# 部署\n' + JSON.stringify(m.departments.map(function (d) { return { name: d.name, maleGapMin: d.maleGapMin, capMax: d.capMax, staffMax: d.staffMax, staffMin: d.staffMin }; })) +
      '\n# ルール設定・ヘルプ表(days は 0日〜6土)\n' + JSON.stringify(rules);
  },
  get_week_pattern: function (me, a) {
    var d = Number(a.weekday); if (!(d >= 0 && d <= 6)) throw { message: 'weekday は 0(日)〜6(土)' };
    var s = stateFor_({ edition: a.edition, proposal_id: a.proposal_id }, [d]);
    var p = (s.patterns || {})[d] || loadBase_(s.ed, null, [d]).patterns[d];
    var dm = dayMaster_(s.master, null, d, null), c = SGEngine.aiContextOf(dm, grid_(p, dm, d), d);
    return '【' + APP.EDITION_LABEL[s.ed] + '・週間パターン ' + WDN_[d] + '曜(day:' + d + ')】\n# 便\n' + JSON.stringify(strip_(c.runs)) + '\n# ヘルプ・予定\n' + JSON.stringify(strip_(c.helps));
  },
  propose: function (me, a) { return propose_(me, a); },
  list_proposals: function (me) { var l = propList_(); return l.length ? l.map(function (p) { return p.id + ' 「' + p.title + '」 ' + p.edLabel + ' ' + (p.date || '') + ' ' + p.byName + ' ' + p.at.slice(0, 16).replace('T', ' ') + '（変わる所' + p.diff.length + 'か所）'; }).join('\n') : 'まだ反映していない案はありません'; },
  apply_proposal: function (me, a) { var r = propApply_(me, a.proposal_id); return '反映しました: ' + r.join('・'); },
  discard_proposal: function (me, a) { propDiscard_(me, a.proposal_id); return '案を捨てました'; }
};
var MCP_FORMAT = [
  'changes: 便・ヘルプの変更(update/add/delete)。staffOff:["その日休みにする職員"] staffTime:[{"name","start","end"}] userAbsent:["その日欠席の利用者"]',
  'dayChanges: {"notesAppend":"特記事項に足す","contactAppend":"連絡事項に足す","training":"訓練の欄","userTime":[{"name","meet","send"}],"noRide":[{"name","meet":"受診後来所","send":""}],"userAbsent":[{"name","absent":true}],"staff":[{"name","off":true,"start","end","workToday":true,"dept":"部署名"}],"userDept":[{"name","dept"}],"extraUse":[{"name","use":true}]}',
  'masterChanges: [{"target":"user|staff|vehicle|dept","op":"update|add|delete","name":"今の名前","fromDate":"2026-11-01(利用曜日をこの日から変えるとき)","set":{"欄":"値"}}]',
  '  staff の欄: name,deptId(部署名),position,emp,start,end,canDrive,isMale,hasOwnCar,ownCarCap,helpOnly,offDays,shiftByDay{"3":{"start","end"}},deptByDay{"5":"部署名"},subDeptId,subDeptByDay,retireDate,awayFrom,awayTo,memo',
  '  user の欄: name,deptId,days,deptByDay,meetTime,sendTime,timeByDay{"3":{"meet","send"}},wheelchair,isMale,hasHelp,helpTwo,helpNote,libertaAM,libertaPM,libertaAMOffDays,libertaPMOffDays,noRideDefault{"meet","send","meetDays","sendDays"},startDate',
  '  vehicle の欄: name,deptId,capNormal,capWc,wheelchairOK,memo / dept の欄: name,maleGapMin,capMax,staffMax,staffMin',
  'ruleChanges: [{"op":"add","list":"ngPairs","row":{"a","b"}},{"op":"update","list":"fixedBlock","match":{"label":"透析","days":[3,4]},"row":{"staff"}},{"op":"delete","list":"requiredHelp","match":{"user"}}]',
  '  一覧: ngPairs{a,b} fixedRun{kind:"meet"|"send",user,days,staff} fixedVeh{veh,before,days,staff} fixedBlock{label,exact,kind,time,from,days,staff} requiredHelp{user,days} helpTwo{user,days} maleOnly{user,from,bathOnly} userVeh{user,veh} otherRules{text,days,check} aiNotes{text} helpBase{label,time,byDay:{"2":"職員名・職員名"}}',
  'patternChanges: [{"day":2,"changes":[…changesと同じ形。idは get_week_pattern のもの…]}]',
  '入浴やヘルプの曜日・時刻を変えるときは、週間パターンの元の曜日から delete、新しい曜日へ add し、必須ヘルプ・2名体制・固定担当・ヘルプ表の曜日も合わせて直す'
].join('\n');

/* ---------- 案を置く ---------- */
function clone_(x) { return JSON.parse(JSON.stringify(x)); }
function propose_(me, a) {
  return withLock_(function () {
    var prev = a.proposal_id ? propGet_(a.proposal_id) : null;
    var ed = prev ? prev.ed : edOf_(a);
    var date = prev ? prev.date : (a.date ? chkDate_(a.date) : '');
    if (prev && a.date && a.date !== prev.date) throw { message: 'この案は ' + prev.date + ' の案です。別の日は新しい案にしてください' };
    var pdays = []; (a.patternChanges || []).forEach(function (pc) { var d = Number(pc && pc.day); if (d >= 0 && d <= 6 && pdays.indexOf(d) < 0) pdays.push(d); });
    if (date) { var wdx = SGEngine.weekdayOf(date); if (pdays.indexOf(wdx) < 0) pdays.push(wdx); }
    var base = prev ? prev.base : null, draft = prev ? prev.draft : null;
    if (!prev) { var b = loadBase_(ed, date, pdays); base = { master: b.master, masterRev: b.masterRev, sheet: date ? b.sheet : null, sheetRev: b.sheetRev, patterns: b.patterns, patRev: b.patRev }; draft = { master: clone_(b.master), sheet: date ? clone_(b.sheet) : null, patterns: clone_(b.patterns) }; }
    else { var miss = pdays.filter(function (d) { return !(d in (draft.patterns || {})); }); if (miss.length) { var bb = loadBase_(ed, null, miss); miss.forEach(function (d) { base.patterns[d] = bb.patterns[d]; base.patRev[d] = bb.patRev[d]; draft.patterns[d] = clone_(bb.patterns[d]); }); } }
    var before = clone_(draft), errs = [];
    // ルール → 基本 → その日 → 週間パターン の順に当てる
    if ((a.ruleChanges || []).length) { var r1 = SGEngine.agApplyRules(draft.master, SGEngine.rulesOf(draft.master), a.ruleChanges); errs = errs.concat(r1.errs); draft.master.rules = r1.rules; }
    if ((a.masterChanges || []).length) { var r2 = SGEngine.agApplyMaster(draft.master, a.masterChanges); errs = errs.concat(r2.errs); draft.master = r2.master; }
    var hasDay = (a.changes || []).length || (a.staffOff || []).length || (a.staffTime || []).length || (a.userAbsent || []).length || a.dayChanges;
    if (hasDay) {
      if (!date) throw { message: 'その日の送迎表を変えるときは date を指定してください' };
      var wd = SGEngine.weekdayOf(date), dm = dayMaster_(draft.master, draft.sheet, wd, date), c = SGEngine.aiContextOf(dm, grid_(draft.sheet, dm, wd), wd), idMap = idMapOf_(c);
      (a.changes || []).forEach(function (ch) { if (ch && (ch.op === 'update' || ch.op === 'delete') && !idMap[ch.id]) errs.push('その日の便・ヘルプ「' + ch.id + '」が見つかりません(get_day で今のidを確認してください)'); });
      var ok = (a.changes || []).filter(function (ch) { return ch && (ch.op === 'add' || idMap[ch.id]); });
      if (ok.length || (a.staffOff || []).length || (a.staffTime || []).length) draft.sheet = SGEngine.aiApplyPure(dm, draft.sheet, ok, idMap, { staffOff: a.staffOff || [], staffTime: a.staffTime || [], workChanges: [] }).next;
      if (a.dayChanges) { var r3 = SGEngine.agApplyDay(draft.master, draft.sheet, a.dayChanges); errs = errs.concat(r3.errs); draft.sheet = r3.sheet; }
      (a.userAbsent || []).forEach(function (n) { var u = draft.master.users.filter(function (x) { return x.name === String(n); })[0]; if (!u) { errs.push('利用者「' + n + '」が見つかりません'); return; } draft.sheet.userAbsent = draft.sheet.userAbsent || {}; draft.sheet.userAbsent[u.id] = true; });
    }
    (a.patternChanges || []).forEach(function (pc) {
      var d = Number(pc && pc.day); if (!(d >= 0 && d <= 6)) { errs.push('週間パターンの曜日「' + (pc && pc.day) + '」が読めません'); return; }
      var cur = draft.patterns[d] || { runs: [], blocks: [], training: '' }, dmp = dayMaster_(draft.master, null, d, null), cp = SGEngine.aiContextOf(dmp, grid_(cur, dmp, d), d), im = idMapOf_(cp);
      var chs = (pc.changes || []).filter(function (ch) { if (ch && (ch.op === 'update' || ch.op === 'delete') && !im[ch.id]) { errs.push(WDN_[d] + '曜のパターンの「' + ch.id + '」が見つかりません(get_week_pattern で確認してください)'); return false; } return ch && (ch.op === 'add' || im[ch.id]); });
      if (!chs.length) return;
      var nx = SGEngine.aiApplyPure(dmp, cur, chs, im, { staffOff: [], staffTime: [], workChanges: [] }).next; if (!('staffOv' in cur)) delete nx.staffOv; draft.patterns[d] = nx;
    });
    var diff = diffAll_(base, draft, date);
    var newProblems = [];
    if (date) { var wd2 = SGEngine.weekdayOf(date); var p0 = problemsOf_(checksOf_(base.master, base.sheet, date, base.patterns[wd2])), p1 = problemsOf_(checksOf_(draft.master, draft.sheet, date, draft.patterns[wd2])); newProblems = p1.filter(function (x) { return p0.indexOf(x) < 0; }); }
    var id = prev ? prev.id : Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    var title = String(a.title || (prev && prev.title) || 'AIの案').slice(0, 60);
    var doc = { id: id, status: 'open', title: title, ed: ed, edLabel: APP.EDITION_LABEL[ed], date: date, by: me.no, byName: me.name, at: new Date().toISOString(), base: base, draft: draft, diff: diff, newProblems: newProblems, errors: errs, requests: ((prev && prev.requests) || []) };
    var idx = docIndex_(), cur0 = docGet_('prop/' + id, idx);
    docSet_('prop/' + id, doc, (cur0 ? cur0.rev : 0) + 1, { date: date, status: 'open' }, idx);
    if (!prev) log_(me, 'Claude', 'AIの案を作成', title + '（' + diff.length + 'か所）');
    return ['案「' + title + '」(proposal_id: ' + id + ')を' + (prev ? '更新し' : '置き') + 'ました。送迎表はまだ変わっていません。',
      '# 変わる所(' + diff.length + 'か所)', diff.map(function (x) { return '・[' + x.area + '] ' + x.text; }).join('\n') || 'なし',
      '# この案で新しく出る問題(元の送迎表と比べて・' + newProblems.length + '件)', newProblems.join('\n') || 'なし',
      errs.length ? '# 反映できなかった変更(直して proposal_id 付きで出し直してください)\n' + errs.join('\n') : '',
      '担当者は送迎表画面の「🤖 Claudeの案」で確認して反映できます。'].filter(function (x) { return x; }).join('\n');
  });
}
function diffAll_(base, draft, date) {
  var out = [];
  if (date && base.sheet) {
    var wd = SGEngine.weekdayOf(date), dm = dayMaster_(draft.master, draft.sheet, wd, date);
    SGEngine.agentDiff(dm, base.sheet, draft.sheet).concat(SGEngine.agDayDiff(draft.master, base.sheet, draft.sheet)).forEach(function (x) { out.push({ t: x.t, text: x.text, area: date + 'の送迎表' }); });
  }
  SGEngine.agMasterDiff(base.master, draft.master).forEach(function (x) { out.push({ t: x.t, text: x.text, area: '利用者・職員・車両・部署・ルール' }); });
  Object.keys(draft.patterns || {}).forEach(function (d) {
    if (SGKV.eq(base.patterns[d], draft.patterns[d])) return;
    SGEngine.agentDiff(dayMaster_(draft.master, null, Number(d), null), base.patterns[d] || { runs: [], blocks: [] }, draft.patterns[d]).forEach(function (x) { out.push({ t: x.t, text: x.text, area: '週間パターン(' + WDN_[d] + '曜)' }); });
  });
  return out;
}

/* ---------- 案の一覧・反映・破棄（Claudeからも送迎表画面からも使う） ---------- */
function propList_() {
  var sh = sheet_(APP.SH.docs), n = sh.getLastRow(); if (n < 2) return [];
  var heads = sh.getRange(2, 1, n - 1, 4).getValues(), out = [], idx = docIndex_();
  heads.forEach(function (h) { if (String(h[0]).indexOf('prop/') !== 0) return; var meta = h[3] ? JSON.parse(h[3]) : {}; if (meta.status !== 'open') return; var d = docGet_(String(h[0]), idx); if (!d || d.value.status !== 'open') return; var v = d.value; out.push({ id: v.id, title: v.title, ed: v.ed, edLabel: v.edLabel, date: v.date, byName: v.byName, at: v.at, diff: v.diff, newProblems: v.newProblems, errors: v.errors }); });
  return out.sort(function (x, y) { return y.at < x.at ? -1 : 1; });
}
function propApply_(me, id) {
  if (me.role !== '管理者' && me.role !== '送迎表') throw { code: 'invalid_argument', message: '反映できるのは「管理者」「送迎表」の権限の人だけです' };
  return withLock_(function () {
    var pr = propGet_(id), idx = docIndex_(), ns = nsOf_(pr.ed), done = [];
    var merge = function (b, d, c) { return SGKV.merge3(b, d, c).value; };
    if (!SGKV.eq(pr.base.master, pr.draft.master)) {
      var mp = kvPath_(ns + 'master'), mc = docGet_(mp, idx);
      docSet_(mp, { k: ns + 'master', v: merge(pr.base.master, pr.draft.master, mc ? mc.value.v : null), by: me.no }, (mc ? mc.rev : 0) + 1, { k: ns + 'master' }, idx); done.push('利用者・職員・車両・部署・ルール');
      syncStaffIds_(); try { CacheService.getScriptCache().remove('names3'); } catch (e) {}
    }
    if (pr.date && pr.base.sheet && !SGKV.eq(pr.base.sheet, pr.draft.sheet)) {
      var key = ns + 'sheet:' + pr.date, sp = kvPath_(key), sc = docGet_(sp, idx);
      var v = merge(pr.base.sheet, pr.draft.sheet, sc ? sc.value.v : null);
      var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm');
      v.aiLog = (v.aiLog ? v.aiLog + '\n' : '') + '◆' + stamp + ' Claudeの案「' + pr.title + '」を反映(' + me.name + ')';
      v = reconcileSheetValue_(key, v, idx);
      docSet_(sp, { k: key, v: v, by: me.no }, (sc ? sc.rev : 0) + 1, { k: key }, idx); linkAfterSave_(key, v, idx); done.push(pr.date + 'の送迎表');
    }
    Object.keys(pr.draft.patterns || {}).forEach(function (d) {
      if (SGKV.eq(pr.base.patterns[d], pr.draft.patterns[d])) return;
      var pk = ns + 'pattern:' + d, pp = kvPath_(pk), pc = docGet_(pp, idx);
      docSet_(pp, { k: pk, v: merge(pr.base.patterns[d], pr.draft.patterns[d], pc ? pc.value.v : null), by: me.no }, (pc ? pc.rev : 0) + 1, { k: pk }, idx); done.push('週間パターン(' + WDN_[d] + '曜)');
    });
    pr.status = 'applied'; pr.appliedBy = me.no; pr.appliedAt = new Date().toISOString();
    var cur = docGet_('prop/' + id, idx); docSet_('prop/' + id, pr, cur.rev + 1, { date: pr.date, status: 'applied' }, idx);
    log_(me, 'Claude', 'AIの案を反映', pr.title + '（' + done.join('・') + '）');
    return done;
  });
}
function propDiscard_(me, id) {
  return withLock_(function () { var pr = propGet_(id), idx = docIndex_(), cur = docGet_('prop/' + id, idx); pr.status = 'discarded'; docSet_('prop/' + id, pr, cur.rev + 1, { date: pr.date, status: 'discarded' }, idx); log_(me, 'Claude', 'AIの案を破棄', pr.title); return true; });
}
