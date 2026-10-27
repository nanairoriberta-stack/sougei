"""会話しながら送迎表を組み替えるAIエージェント（💬 AIと相談）を送迎表アプリに追加する。
既存の「AI調整」のルール・状態の作り方・案の反映処理と、出力前チェックを、そのまま関数として取り出して使う（元の処理は変えない）"""
import sys
src = open("app2u.jsx", encoding="utf-8").read()
def cut(a, b, start=0, inclusive_b=False):
    i = src.index(a, start); j = src.index(b, i)
    return src[i:j + (len(b) if inclusive_b else 0)], i, j
def rep(a, b, n=1):
    global src
    c = src.count(a)
    if c != n: sys.exit(f"想定{n} 実際{c}: {a[:80]}")
    src = src.replace(a, b)

# --- (0) AI調整の不具合修正：移動便(あいのて→嫁島など)の乗客を「重複乗車」とみなして外し、移動便を消していた
rep('                  if (r.kind !== k || r.mode === "train") return r;', '                  if (r.kind !== k || r.mode === "train" || r.mode === "move") return r; // 移動便は送迎ではないので重複の対象外')
rep('                if (r.kind !== "meet" && r.kind !== "send") return true; // 回送・外出(他)は対象外', '                if (r.kind !== "meet" && r.kind !== "send") return true; // 回送・外出(他)は対象外\n                if (r.mode === "move") return true; // 移動便は乗客がいなくても残す')

# --- (1) 案の反映処理（AI調整の onApply の中身）を純粋な関数として取り出す
onapply = src.index('onApply={(changes, idMap, unresolvedFromAi, logInfo) => {')
pre, _, _ = cut("            const sByName = {}; sheetMaster.staff", "            updateSheet((prev) => {\n", onapply)
body, _, _ = cut("            updateSheet((prev) => {\n", "              return { ...prev, runs, blocks, staffOv: staffOv2 };\n            });", onapply, inclusive_b=True)
body = body[len("            updateSheet((prev) => {\n"):]
body = body[: body.rindex("            });")]
apply_fn = ("// AI案(changes)を送迎表1日分に当てはめた結果を返す(画面は変えない)。AI調整の反映処理と同じ内容\n"
            "function aiApplyPure(sheetMaster, prev, changes, idMap, logInfo) {\n" + pre +
            "  const next = ((prev) => {\n" + body + "  })(prev);\n"
            "  return { next, applied, dedupCount, capFixed, emptyRemoved };\n}\n")

# --- (2) 出力前チェック（handleExport の中身）を取り出す
chk, _, _ = cut("    const sheetData = { staffOv: {}, userAbsent: {}, userDept: {}, notes: \"\", contact: \"\", ...sheet,", "    if (!groups.length) {", src.index("const handleExport = async () => {"))
if chk.count("await sGet(`pattern:${wd}`)") != 1: sys.exit("patDay")
chk = chk.replace("await sGet(`pattern:${wd}`)", "patDayArg")
checks_fn = ("// 出力前チェックの結果(groups)を返す。Excel出力の前に出るチェックと同じ内容\n"
             "function collectSheetChecks(sheetMaster, sheet, date, patDayArg) {\n" + chk + "    return groups;\n}\n")

# --- (3) AIに渡す状態（AI調整の build と同じ）
bld, _, _ = cut("    const dn = (id) => { const d = master.departments.find((x) => x.id === id); return d ? d.name : \"\"; };\n    const ov = { ...(data.staffOv || {}) };",
                "    return { staffOn, users, vehicles, runs, helps, dn, unMeet, unSend, holdIds: [...holdIds, ...holdHelpIds] };", src.index("function AiAdjustModal("), inclusive_b=True)
wc_line = "    wcList.forEach((w) => { ov[w.id] = { ...(ov[w.id] || {}), ...(w.off ? { off: true } : { start: w.start, end: w.end }) }; });\n"
if bld.count(wc_line) != 1: sys.exit("wcList")
bld = bld.replace(wc_line, "")
ctx_fn = "// AIに渡す当日の状態(職員・利用者・車・便・ヘルプ・未割当・保留)\nfunction aiContextOf(master, data, weekday) {\n" + bld + "\n}\n"

# --- (4) ルール（AI調整のプロンプトと同じ）
bp = src.index("const buildPrompt = (p) => `")
rules, _, _ = cut("# 拠点間の車での移動時間(分・概算)\n", "\n# 現在の便", bp)
rules2, _, _ = cut("# ルール\n", "\n- 出力は次のJSONのみ", bp)
rules_fn = "// 送迎表のルール(AI調整と同じ)\nfunction aiRulesText(master) {\n  return `" + rules + "\n" + rules2 + "`;\n}\n"


# --- (5) ルール・利用者・職員・週間パターンの変更と、会話の画面
agent = r'''
/* ============================================================
   💬 AIと相談：会話しながら送迎表・利用者・ルール・週間パターンを変える
   ・AIの案はすべて「下書き」に当てはめる。送迎表は出力前チェックと同じ基準で確かめ、問題が残れば自動でAIに差し戻す(最大2回)
   ・「この案を反映」を押すまで何も変わらない。反映は相談中の他の人の変更と統合する(上書きしない)
   ============================================================ */
const AGENT_FIX_GROUPS = /重大エラー|乗せ忘れ|車両のエラー|時間のエラー|男性不在/;
const WDN = ["日", "月", "火", "水", "木", "金", "土"];
// ルールタブの各一覧と、項目の種類(名前は送迎表のマスタにある人・車だけ受け付ける)
const RULE_LISTS = {
  ngPairs: { name: "同乗NG", keys: { a: "user", b: "user" } },
  fixedRun: { name: "迎え・送りの固定担当", keys: { kind: "kind", user: "user", days: "days", staff: "staff" } },
  fixedVeh: { name: "車の固定担当", keys: { veh: "veh", before: "time", days: "days", staff: "staff" } },
  fixedBlock: { name: "予定・ヘルプの固定担当", keys: { label: "text", exact: "bool", kind: "bkind", time: "time", from: "time", days: "days", staff: "staff" } },
  requiredHelp: { name: "必須ヘルプ", keys: { user: "user", days: "days" } },
  helpTwo: { name: "2名体制のヘルプ", keys: { user: "user", days: "days" } },
  maleOnly: { name: "男性職員のみ対応", keys: { user: "user", from: "time", bathOnly: "bool" } },
  userVeh: { name: "利用者の基本の車", keys: { user: "user", veh: "veh" } },
  otherRules: { name: "その他のルール", keys: { text: "text", days: "days", check: "bool" } },
  aiNotes: { name: "AIへの追加ルール", keys: { text: "text" } },
  helpBase: { name: "ヘルプ表(曜日ごとの基本の担当)", keys: { label: "text", time: "time", byDay: "staffByDay" } },
};
const agTime = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? "" : v).trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${Number(m[1])}:${m[2]}` : null; };
const agDays = (v) => Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : null;
function agNormField(type, v, master) {
  if (type === "user") { const n = stripParen(String(v || "")); return master.users.some((u) => u.name === n) ? { v: n } : { err: `利用者「${v}」が見つかりません` }; }
  if (type === "staff") { const n = String(v || ""); return master.staff.some((s) => s.name === n) ? { v: n } : { err: `職員「${v}」が見つかりません` }; }
  if (type === "veh") { const n = String(v || ""); return master.vehicles.some((x) => x.name === n) ? { v: n } : { err: `車「${v}」が見つかりません` }; }
  if (type === "days") { const d = agDays(v); return d ? { v: d } : { err: "曜日は0(日)〜6(土)の数字の配列で指定します" }; }
  if (type === "time") { if (v == null || v === "") return { v: "" }; const t = agTime(v); return t ? { v: t } : { err: `時刻「${v}」が読めません` }; }
  if (type === "bool") return { v: !!v };
  if (type === "kind") return v === "meet" || v === "send" ? { v } : { err: "kind は meet(迎え) か send(送り)" };
  if (type === "staffByDay") {
    if (!v || typeof v !== "object") return { err: "byDay は {曜日番号:\"職員名\"} の形で指定します" };
    const out = {};
    for (const [k, nm] of Object.entries(v)) {
      const d = Number(k); if (!(d >= 0 && d <= 6)) return { err: `曜日「${k}」が読めません` };
      if (nm == null || nm === "") continue;
      const names = String(nm).split(/[・、,]/).map((x) => x.trim()).filter(Boolean);
      const bad = names.filter((n) => !master.staff.some((x) => x.name === n)); if (bad.length) return { err: `職員「${bad.join("・")}」が見つかりません` };
      out[d] = names.join("・");
    }
    return { v: out };
  }
  if (type === "bkind") return ["block", "help", ""].includes(v || "") ? { v: v || "" } : { err: "kind は block / help / 空" };
  const s = String(v == null ? "" : v).trim().slice(0, 200); return s ? { v: s } : { err: "内容が空です" };
}
function agNormRow(list, row, master, partial) {
  const spec = RULE_LISTS[list]; const out = {}; const errs = [];
  for (const [k, type] of Object.entries(spec.keys)) {
    if (!(k in (row || {}))) { if (!partial) { if (type === "days") out[k] = []; else if (type === "bool") out[k] = k === "check"; else if (type === "time" || type === "bkind") out[k] = ""; else errs.push(`${spec.name}: 「${k}」がありません`); } continue; }
    const r = agNormField(type, row[k], master); if (r.err) errs.push(`${spec.name}: ${r.err}`); else out[k] = r.v;
  }
  return { row: out, errs };
}
const agRowEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const agMatch = (row, m) => Object.keys(m).every((k) => agRowEq(Array.isArray(row[k]) ? [...row[k]].sort() : row[k], m[k]));
function agApplyRules(master, rules0, changes) {
  let rules = JSON.parse(JSON.stringify(rules0)); const errs = [];
  (changes || []).forEach((c) => {
    if (!c || !RULE_LISTS[c.list]) { errs.push(`ルールの種類「${c && c.list}」がありません`); return; }
    const list = c.list, rows = [...(rules[list] || [])];
    if (c.op === "add") {
      const r = agNormRow(list, c.row, master, false); if (r.errs.length) { errs.push(...r.errs); return; }
      if (!rows.some((x) => agRowEq(agNormRow(list, x, master, true).row, r.row))) rows.push(r.row);
    } else if (c.op === "delete" || c.op === "update") {
      const m = agNormRow(list, c.match, master, true); if (m.errs.length || !Object.keys(m.row).length) { errs.push(...(m.errs.length ? m.errs : [`${RULE_LISTS[list].name}: どれを${c.op === "delete" ? "消す" : "変える"}か(match)がありません`])); return; }
      const hit = rows.filter((x) => agMatch(x, m.row));
      if (!hit.length) { errs.push(`${RULE_LISTS[list].name}: 当てはまる行がありません(${JSON.stringify(c.match)})`); return; }
      if (c.op === "delete") { rules[list] = rows.filter((x) => !agMatch(x, m.row)); return; }
      const p = agNormRow(list, c.row, master, true); if (p.errs.length) { errs.push(...p.errs); return; }
      rules[list] = rows.map((x) => (agMatch(x, m.row) ? { ...x, ...p.row } : x)); return;
    } else { errs.push(`ルールの操作「${c.op}」は使えません(add / update / delete)`); return; }
    rules[list] = rows;
  });
  return { rules, errs };
}
// 職員・利用者・車両・部署タブの各欄。type: text / time / num / bool / days / date / dept / dayDept / dayTime / dayShift / noRide
const ENTITY_FIELDS = {
  staff: { list: "staff", name: "職員", fields: {
    name: ["text", "名前"], deptId: ["dept", "所属"], position: ["text", "役職"], emp: ["text", "雇用形態"], start: ["time", "出勤"], end: ["time", "退勤"],
    canDrive: ["bool", "運転可"], isMale: ["bool", "男性"], hasOwnCar: ["bool", "自家用車あり"], ownCarCap: ["num", "自家用車の定員"], helpOnly: ["bool", "ヘルプ専任"],
    offDays: ["days", "固定休"], shiftByDay: ["dayShift", "曜日別の勤務"], deptByDay: ["dayDept", "曜日別の勤務先"], subDeptId: ["dept?", "兼務先"], subDeptByDay: ["dayDept", "曜日別の兼務先"],
    retireDate: ["date?", "退職日"], awayFrom: ["time?", "中抜け開始"], awayTo: ["time?", "中抜け終了"], memo: ["text?", "メモ"],
    sortLast: ["bool", "列を右端に"], noGrid: ["bool", "送迎表に列を出さない"], hideInStaffList: ["bool", "職員一覧に出さない"], hideInPartList: ["bool", "部分表示に出さない"] } },
  user: { list: "users", name: "利用者", fields: {
    name: ["text", "名前"], deptId: ["dept", "利用先"], days: ["days", "利用曜日"], deptByDay: ["dayDept", "曜日ごとの利用先"], meetTime: ["time?", "迎えの時刻"], sendTime: ["time?", "送りの時刻"],
    timeByDay: ["dayTime", "曜日ごとの時刻"], wheelchair: ["bool", "車いす"], isMale: ["bool", "男性"], hasHelp: ["bool", "ヘルプあり"], helpTwo: ["bool", "ヘルプ2名"], helpNote: ["text?", "特記事項"],
    libertaAM: ["bool", "朝リベルタから乗る"], libertaPM: ["bool", "夕方リベルタへ送る"], libertaAMOffDays: ["days", "朝リベルタを使わない曜日"], libertaPMOffDays: ["days", "夕方リベルタを使わない曜日"],
    noRideDefault: ["noRide", "基本の送迎なし"], startDate: ["date?", "利用開始日"] } },
  vehicle: { list: "vehicles", name: "車両", fields: { name: ["text", "名前"], deptId: ["dept", "所属"], capNormal: ["num", "定員"], capWc: ["num", "車いす台数"], wheelchairOK: ["bool", "車いす可"], memo: ["text?", "メモ"] } },
  dept: { list: "departments", name: "部署", fields: { name: ["text", "名前"], maleGapMin: ["num", "男性不在を許す分数"], capMax: ["num?", "在席上限"], staffMax: ["num?", "職員の上限"], staffMin: ["num?", "職員の下限"] } },
};
const ENTITY_ALIAS = { dept: "deptId", meet: "meetTime", send: "sendTime", subDept: "subDeptId", cap: "capNormal" };
function agNormEntityField(type, v, m) {
  const opt = type.endsWith("?"); const t = opt ? type.slice(0, -1) : type;
  if (opt && (v === "" || v == null)) return { v: "" };
  const deptId = (n) => { const d = m.departments.find((x) => x.name === n || x.id === n); return d ? d.id : null; };
  const dayObj = (fn) => { if (!v || typeof v !== "object") return { err: "曜日番号をキーにした形で指定します" }; const out = {}; for (const [k, x] of Object.entries(v)) { const d = Number(k); if (!(d >= 0 && d <= 6)) return { err: `曜日「${k}」が読めません` }; if (x == null || x === "") { out[d] = null; continue; } const r = fn(x); if (r.err) return r; out[d] = r.v; } return { v: out, patch: true }; };
  switch (t) {
    case "text": { const x = String(v == null ? "" : v).trim().slice(0, 500); return x || opt ? { v: x } : { err: "空にはできません" }; }
    case "time": { const x = agTime(v); return x ? { v: x } : { err: `時刻「${v}」が読めません` }; }
    case "num": { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 999 ? { v: n } : { err: `数「${v}」が読めません` }; }
    case "bool": return { v: v === true || v === "true" || v === 1 || v === "はい" };
    case "days": { const d = agDays(v); return d ? { v: d } : { err: "曜日は0(日)〜6(土)の数字の配列で指定します" }; }
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? { v: String(v) } : { err: `日付「${v}」が読めません(2026-11-01 の形)` };
    case "dept": { const id = deptId(String(v)); return id ? { v: id } : { err: `部署「${v}」がありません` }; }
    case "dayDept": return dayObj((x) => { const id = deptId(String(x)); return id ? { v: id } : { err: `部署「${x}」がありません` }; });
    case "dayTime": return dayObj((x) => { if (typeof x !== "object") return { err: "曜日ごとの時刻は {meet, send} で指定します" }; const o = {}; for (const k of ["meet", "send"]) if (x[k]) { const tt = agTime(x[k]); if (!tt) return { err: `時刻「${x[k]}」が読めません` }; o[k] = tt; } return { v: o }; });
    case "dayShift": return dayObj((x) => { const st = agTime(x && x.start), en = agTime(x && x.end); return st && en ? { v: { start: st, end: en } } : { err: "曜日別の勤務は {start, end} で指定します" }; });
    case "noRide": { if (!v || typeof v !== "object") return { v: null }; const o = {}; if (v.meet) o.meet = String(v.meet).slice(0, 40); if (v.send) o.send = String(v.send).slice(0, 40); const md = agDays(v.meetDays), sd = agDays(v.sendDays); if (md && md.length) o.meetDays = md; if (sd && sd.length) o.sendDays = sd; return { v: Object.keys(o).length ? o : null }; }
    default: return { err: "この項目は変えられません" };
  }
}
// 利用者・職員・車両・部署の追加・変更・削除。簡単な書き方(days・dept・meet など)もそのまま受け付ける
function agApplyMaster(master0, changes) {
  let m = agClone(master0); const errs = [];
  (changes || []).forEach((c0) => {
    if (!c0 || !ENTITY_FIELDS[c0.target]) { errs.push("target は staff / user / vehicle / dept のどれかです"); return; }
    const spec = ENTITY_FIELDS[c0.target], L = spec.name;
    const set = { ...(c0.set || {}) };
    for (const [k, v] of Object.entries(c0)) if (!["target", "op", "name", "set", "fromDate"].includes(k)) set[k] = v;
    const op = c0.op || "update";
    let list = m[spec.list];
    if (op === "delete") {
      if (c0.target === "dept") { errs.push("部署の削除は部署タブで行ってください(所属している人が外れるため)"); return; }
      const x = list.find((y) => y.name === stripParen(String(c0.name || ""))); if (!x) { errs.push(`${L}「${c0.name}」が見つかりません`); return; }
      m = markDeleted({ ...m, [spec.list]: list.filter((y) => y.id !== x.id) }, spec.list, x); return;
    }
    let x;
    if (op === "add") {
      const nm = String(set.name || c0.name || "").trim(); if (!nm) { errs.push(`${L}の名前がありません`); return; }
      if (list.some((y) => y.name === nm)) { errs.push(`${L}「${nm}」はすでにいます`); return; }
      const d0 = m.departments[0] && m.departments[0].id;
      x = c0.target === "staff" ? { id: uid(), name: nm, deptId: d0, position: "", emp: "常勤", start: "8:30", end: "17:30", canDrive: true, memo: "" }
        : c0.target === "user" ? { id: uid(), name: nm, deptId: d0, meetTime: "", sendTime: "", wheelchair: false, hasHelp: true, helpNote: "", days: [] }
        : c0.target === "vehicle" ? { id: uid(), name: nm, deptId: d0, capNormal: 6, capWc: 0, wheelchairOK: false, memo: "" }
        : { id: uid(), name: nm, maleGapMin: 30 };
      list = [...list, x]; m = { ...m, [spec.list]: list };
    } else if (op === "update") {
      x = list.find((y) => y.name === stripParen(String(c0.name || ""))); if (!x) { errs.push(`${L}「${c0.name}」が見つかりません`); return; }
    } else { errs.push(`操作「${op}」は使えません(add / update / delete)`); return; }
    for (const [k0, v] of Object.entries(set)) {
      const k = ENTITY_ALIAS[k0] || k0; const f = spec.fields[k];
      if (!f) { errs.push(`${L}「${x.name}」: 「${k0}」という項目はありません`); continue; }
      if (k === "days" && c0.fromDate) { const d = agDays(v); if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(c0.fromDate)) errs.push(`${L}「${x.name}」: 利用曜日・日付が読めません`); else x.daysFrom = { ...(x.daysFrom || {}), [c0.fromDate]: d }; continue; }
      const r = agNormEntityField(f[0], v, m); if (r.err) { errs.push(`${L}「${x.name}」の${f[1]}: ${r.err}`); continue; }
      if (k === "name" && r.v !== x.name && list.some((y) => y.name === r.v)) { errs.push(`${L}「${r.v}」はすでにいます`); continue; }
      if (r.patch) { const cur = { ...(x[k] || {}) }; for (const [d, val] of Object.entries(r.v)) { if (val == null || (f[0] === "dayDept" && val === x.deptId)) delete cur[d]; else cur[d] = val; } x[k] = cur; }
      else if (r.v === null || (r.v === "" && f[0].endsWith("?") && f[0] !== "text?")) delete x[k];
      else x[k] = r.v;
    }
  });
  return { master: m, errs };
}
function agRuleRowText(list, r) {
  const d = (a) => (a && a.length ? a.map((x) => WDN[x]).join("") : "毎日");
  switch (list) {
    case "ngPairs": return `${r.a} と ${r.b}`;
    case "fixedRun": return `${r.user}の${r.kind === "send" ? "送り" : "迎え"}(${d(r.days)}) → ${r.staff}`;
    case "fixedVeh": return `${r.veh}の${r.before || ""}前の便(${d(r.days)}) → ${r.staff}`;
    case "fixedBlock": return `${r.label}${r.time ? " " + r.time : ""}${r.from ? " " + r.from + "以降" : ""}(${d(r.days)}) → ${r.staff}`;
    case "requiredHelp": case "helpTwo": return `${r.user}(${d(r.days)})`;
    case "maleOnly": return `${r.user}${r.bathOnly ? "の入浴" : ""}${r.from ? " " + r.from + "以降" : ""}`;
    case "userVeh": return `${r.user} → ${r.veh}`;
    case "helpBase": return `${r.time} ${r.label}：${Object.entries(r.byDay || {}).map(([k, v]) => `${WDN[k]}=${v}`).join("、") || "担当なし"}`;
    default: return `${r.text}${r.days && r.days.length ? `(${d(r.days)})` : ""}`;
  }
}
function agMasterDiff(a, b) {
  const out = [];
  const ra = rulesOf(a), rb = rulesOf(b);
  for (const [list, spec] of Object.entries(RULE_LISTS)) {
    const A = (ra[list] || []).map((x) => JSON.stringify(x)), B = (rb[list] || []).map((x) => JSON.stringify(x));
    B.filter((x) => !A.includes(x)).forEach((x) => out.push({ t: "add", text: `ルール「${spec.name}」に追加: ${agRuleRowText(list, JSON.parse(x))}` }));
    A.filter((x) => !B.includes(x)).forEach((x) => out.push({ t: "del", text: `ルール「${spec.name}」から削除: ${agRuleRowText(list, JSON.parse(x))}` }));
  }
  const dn = (m, id) => (m.departments.find((d) => d.id === id) || {}).name || "";
  const show = (m, type, v) => {
    const t = type.replace("?", "");
    if (v == null || v === "") return "なし";
    if (t === "bool") return v ? "はい" : "いいえ";
    if (t === "days") return (v || []).map((n) => WDN[n]).join("") || "なし";
    if (t === "dept") return dn(m, v) || "なし";
    if (t === "dayDept") return Object.entries(v || {}).map(([k, x]) => `${WDN[k]}${dn(m, x)}`).join("・") || "なし";
    if (t === "dayTime") return Object.entries(v || {}).map(([k, x]) => `${WDN[k]}(迎${x.meet || "基本"}・送${x.send || "基本"})`).join("・") || "なし";
    if (t === "dayShift") return Object.entries(v || {}).map(([k, x]) => `${WDN[k]}${x.start}〜${x.end}`).join("・") || "なし";
    if (t === "noRide") return [v.meet && `迎えなし(${v.meet}${v.meetDays ? "・" + v.meetDays.map((n) => WDN[n]).join("") : ""})`, v.send && `送りなし(${v.send}${v.sendDays ? "・" + v.sendDays.map((n) => WDN[n]).join("") : ""})`].filter(Boolean).join("・") || "なし";
    return String(v);
  };
  for (const spec of Object.values(ENTITY_FIELDS)) {
    const A = a[spec.list] || [], B = b[spec.list] || [];
    B.forEach((x) => {
      const o = A.find((y) => y.id === x.id);
      if (!o) { out.push({ t: "add", text: `${spec.name}を追加: ${x.name}` }); }
      for (const [k, f] of Object.entries(spec.fields)) {
        const ov = o ? o[k] : undefined, nv = x[k];
        if (!o && (nv == null || nv === "" || (Array.isArray(nv) && !nv.length))) continue;
        if (o && agRowEq(ov == null ? null : ov, nv == null ? null : nv)) continue;
        if (o && k === "name") { out.push({ t: "chg", text: `${spec.name}「${ov}」の名前 → ${nv}` }); continue; }
        out.push({ t: "chg", text: `${x.name}：${f[1]} ${o ? show(a, f[0], ov) + " → " : ""}${show(b, f[0], nv)}` });
      }
      if (o && !agRowEq(o.daysFrom || {}, x.daysFrom || {})) Object.entries(x.daysFrom || {}).forEach(([k, v]) => { if (!agRowEq((o.daysFrom || {})[k], v)) out.push({ t: "chg", text: `${x.name}：${k}から利用曜日を ${v.map((n) => WDN[n]).join("")} に` }); });
    });
    A.forEach((y) => { if (!B.some((x) => x.id === y.id)) out.push({ t: "del", text: `${spec.name}を削除: ${y.name}` }); });
  }
  return out;
}
function agentDiff(master, a, b) {
  const sN = (id) => (master.staff.find((s) => s.id === id) || {}).name || (id === HOLD_ID ? "保留" : "?");
  const vN = (id) => (resolveVehicle(master, id) || {}).name || "";
  const uN = (ids) => (ids || []).map((id) => (master.users.find((u) => u.id === id) || {}).name).filter(Boolean);
  const kN = (r) => r.kind === "meet" ? "迎" : r.kind === "send" ? "送" : "他";
  const out = [];
  const one = (x) => x.kind === "help" || x.kind === "block" ? `${x.time} ${x.label || "予定"}(${sN(x.staffId)}${vN(x.vehicleId) ? "・" + vN(x.vehicleId) : ""})` : `${x.time}【${kN(x)}】${sN(x.staffId)}${vN(x.vehicleId) ? "・" + vN(x.vehicleId) : ""}：${uN(x.userIds).join("・") || "(乗車なし)"}`;
  for (const k of ["runs", "blocks"]) {
    const A = new Map((a[k] || []).map((x) => [x.id, x])), B = new Map((b[k] || []).map((x) => [x.id, x]));
    for (const [id, x] of B) { const y = A.get(id); if (!y) out.push({ t: "add", text: one(x) }); else if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ t: "chg", text: one(y) + " → " + one(x) }); }
    for (const [id, y] of A) if (!B.has(id)) out.push({ t: "del", text: one(y) });
  }
  const so = (o) => o.off ? "休み" : [o.start && o.start + "から", o.end && o.end + "まで"].filter(Boolean).join("") || "通常";
  const ao = a.staffOv || {}, bo = b.staffOv || {};
  for (const id of new Set([...Object.keys(ao), ...Object.keys(bo)])) if (JSON.stringify(ao[id] || {}) !== JSON.stringify(bo[id] || {})) out.push({ t: "staff", text: `${sN(id)}：${so(ao[id] || {})} → ${so(bo[id] || {})}` });
  const aa = a.userAbsent || {}, ba = b.userAbsent || {};
  for (const id of new Set([...Object.keys(aa), ...Object.keys(ba)])) if (!!aa[id] !== !!ba[id]) out.push({ t: "user", text: `${uN([id])[0] || "?"}：${ba[id] ? "欠席に" : "欠席を取り消し"}` });
  return out;
}
function agentParse(text) {
  const s = String(text || ""); const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { const o = JSON.parse(s.slice(i, j + 1)); return o && typeof o === "object" ? o : null; } catch (e) { return null; }
}
const agClone = (x) => JSON.parse(JSON.stringify(x));
// その日の送迎表の欄(送迎表タブの下の欄・未割当パネルなど)
function agApplyDay(master, sheet0, dc) {
  const sh = agClone(sheet0); const errs = [];
  const U = (n) => master.users.find((u) => u.name === stripParen(String(n || ""))), S = (n) => master.staff.find((x) => x.name === String(n || ""));
  const D = (n) => master.departments.find((d) => d.name === n);
  for (const k of ["notes", "contact", "training"]) if (typeof dc[k] === "string") sh[k] = dc[k].slice(0, 3000);
  for (const k of ["notesAppend", "contactAppend"]) if (typeof dc[k] === "string" && dc[k].trim()) { const f = k.replace("Append", ""); sh[f] = (sh[f] ? sh[f] + "\n" : "") + dc[k].trim(); }
  (dc.userTime || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } const o = { ...((sh.userTime || {})[u.id] || {}) }; for (const k of ["meet", "send"]) if (k in x) { if (!x[k]) delete o[k]; else { const t = agTime(x[k]); if (!t) { errs.push(`${u.name}: 時刻「${x[k]}」が読めません`); continue; } o[k] = t; } } sh.userTime = { ...(sh.userTime || {}) }; if (Object.keys(o).length) sh.userTime[u.id] = o; else delete sh.userTime[u.id]; });
  (dc.noRide || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } const o = { ...((sh.noRide || {})[u.id] || {}) }; for (const k of ["meet", "send"]) if (k in x) { if (!x[k]) delete o[k]; else o[k] = String(x[k]).slice(0, 40); } sh.noRide = { ...(sh.noRide || {}) }; if (Object.keys(o).length) sh.noRide[u.id] = o; else delete sh.noRide[u.id]; });
  (dc.userAbsent || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } sh.userAbsent = { ...(sh.userAbsent || {}) }; if (x.absent === false) delete sh.userAbsent[u.id]; else sh.userAbsent[u.id] = true; });
  (dc.userDept || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } sh.userDept = { ...(sh.userDept || {}) }; if (!x.dept) delete sh.userDept[u.id]; else { const d = D(x.dept); if (!d) errs.push(`部署「${x.dept}」がありません`); else sh.userDept[u.id] = d.id; } });
  (dc.extraUse || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } sh.userExtra = { ...(sh.userExtra || {}) }; if (x.use === false) delete sh.userExtra[u.id]; else sh.userExtra[u.id] = true; });
  (dc.staff || []).forEach((x) => {
    const s = S(x && x.name); if (!s) { errs.push(`職員「${x && x.name}」が見つかりません`); return; }
    const o = { ...((sh.staffOv || {})[s.id] || {}) };
    if ("off" in x) { if (x.off) o.off = true; else delete o.off; }
    if ("workToday" in x) { if (x.workToday) o.workToday = true; else delete o.workToday; }
    for (const k of ["start", "end"]) if (k in x) { if (!x[k]) delete o[k]; else { const t = agTime(x[k]); if (!t) { errs.push(`${s.name}: 時刻「${x[k]}」が読めません`); continue; } o[k] = t; } }
    if ("dept" in x) { if (!x.dept) delete o.deptId; else { const d = D(x.dept); if (!d) errs.push(`部署「${x.dept}」がありません`); else o.deptId = d.id; } }
    sh.staffOv = { ...(sh.staffOv || {}) }; if (Object.keys(o).length) sh.staffOv[s.id] = o; else delete sh.staffOv[s.id];
  });
  return { sheet: sh, errs };
}
function agDayDiff(master, a, b) {
  const out = [];
  const uN = (id) => (master.users.find((u) => u.id === id) || {}).name || "?", sN = (id) => (master.staff.find((s) => s.id === id) || {}).name || "?", dN = (id) => (master.departments.find((d) => d.id === id) || {}).name || "";
  for (const [k, l] of [["notes", "特記事項"], ["contact", "連絡事項"], ["training", "訓練"]]) if ((a[k] || "") !== (b[k] || "")) out.push({ t: "chg", text: `${l}：${String(b[k] || "（空）").slice(0, 80)}` });
  const map = (k, fmt) => { const A = a[k] || {}, B = b[k] || {}; for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) if (JSON.stringify(A[id]) !== JSON.stringify(B[id])) out.push({ t: "chg", text: fmt(id, A[id], B[id]) }); };
  map("userTime", (id, x, y) => `${uN(id)}：この日の時刻 ${y ? `迎${y.meet || "基本"}・送${y.send || "基本"}` : "基本に戻す"}`);
  map("noRide", (id, x, y) => `${uN(id)}：送迎なし ${y ? [y.meet && `迎え(${y.meet})`, y.send && `送り(${y.send})`].filter(Boolean).join("・") : "取り消し"}`);
  map("userDept", (id, x, y) => `${uN(id)}：この日の利用先 ${y ? dN(y) : "いつもどおり"}`);
  map("userExtra", (id, x, y) => `${uN(id)}：${y ? "今日だけ利用" : "今日だけ利用を取り消し"}`);
  return out;
}
const AGENT_PATTERN_DAYS = [1, 2, 3, 4, 5, 6, 0];

function AgentChat({ master, sheet, date, onApply, onClose }) {
  const wd = weekdayOf(date);
  const base = useRef({ sheet: agClone(sheet), master: agClone(master), patterns: null });
  const [draft, setDraft] = useState(() => ({ sheet: agClone(sheet), master: agClone(master), patterns: null }));
  const [log, setLog] = useState([{ who: "ai", text: `${date}(${DAYS[wd]})の送迎表について相談できます。\n例:「安達が休み。代わりを入れて組み替えて」「中村さんは毎週月水金、水曜だけ津田を利用」「井上さんの入浴を木曜17時から火曜16時に変えて」「早川さんと青木さんは同じ便にしない」` }]);
  const [hist, setHist] = useState([]);
  const [shown, setShown] = useState([]);     // 中身をAIに渡している週間パターンの曜日
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const endRef = useRef(null);
  useEffect(() => { (async () => {
    const ps = {};
    for (const d of AGENT_PATTERN_DAYS) { try { ps[d] = (await sGet(`pattern:${d}`)) || null; } catch (e) { ps[d] = null; } }
    base.current.patterns = agClone(ps);
    setDraft((x) => ({ ...x, patterns: agClone(ps) }));
  })(); }, []);
  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: "end" }); }, [log, busy]);
  const dayMaster = (m, d, w, ds) => applyDayDept(m, w, d && d.staffOv, d && d.userDept, d && d.userExtra, ds);
  const gridOf = (d, dm, w) => ({ staffOv: {}, userAbsent: {}, userDept: {}, notes: "", contact: "", libertaOff: {}, libertaOn: {}, userTime: {}, runs: [], blocks: [], ...d, noRide: { ...noRideDefaults(dm, w), ...((d && d.noRide) || {}) } });
  const checksOf = (dr) => { const dm = dayMaster(dr.master, dr.sheet, wd, date); try { return collectSheetChecks(dm, dr.sheet, date, dr.patterns && dr.patterns[wd]); } catch (e) { return [{ icon: "⚠", title: "チェックできませんでした", items: [String((e && e.message) || e)] }]; } };
  const diffs = useMemo(() => {
    const out = [];
    agentDiff(dayMaster(draft.master, draft.sheet, wd, date), base.current.sheet, draft.sheet).forEach((x) => out.push({ ...x, area: `${date}の送迎表` }));
    agDayDiff(draft.master, base.current.sheet, draft.sheet).forEach((x) => out.push({ ...x, area: `${date}の送迎表` }));
    agMasterDiff(base.current.master, draft.master).forEach((x) => out.push({ ...x, area: "利用者・職員・ルール" }));
    if (draft.patterns && base.current.patterns) AGENT_PATTERN_DAYS.forEach((d) => {
      const a = base.current.patterns[d] || { runs: [], blocks: [] }, b = draft.patterns[d] || { runs: [], blocks: [] };
      if (JSON.stringify(a) !== JSON.stringify(b)) agentDiff(dayMaster(draft.master, null, d, null), a, b).forEach((x) => out.push({ ...x, area: `週間パターン(${WDN[d]}曜)` }));
    });
    return out;
  }, [draft]);
  const groups = useMemo(() => checksOf(draft), [draft]);

  const patternCtx = (dr, d) => {
    const dm = dayMaster(dr.master, null, d, null); const p = (dr.patterns || {})[d] || { runs: [], blocks: [] };
    const c = aiContextOf(dm, gridOf(p, dm, d), d);
    return { dm, c, idMap: { ...Object.fromEntries(c.runs.map((r) => [r.id, { t: "runs", id: r._id }])), ...Object.fromEntries(c.helps.map((h) => [h.id, { t: "blocks", id: h._id }])) } };
  };
  const stateText = (dr, days) => {
    const dm = dayMaster(dr.master, dr.sheet, wd, date); const p = aiContextOf(dm, gridOf(dr.sheet, dm, wd), wd);
    const idMap = { ...Object.fromEntries(p.runs.map((r) => [r.id, { t: "runs", id: r._id }])), ...Object.fromEntries(p.helps.map((h) => [h.id, { t: "blocks", id: h._id }])) };
    const g = checksOf(dr).map((x) => `■${x.title}\n` + x.items.slice(0, 15).map((i) => "・" + i).join("\n")).join("\n");
    const dn = (id) => (dr.master.departments.find((d) => d.id === id) || {}).name || "";
    const userBase = dr.master.users.map((u) => ({ name: u.name, days: (u.days || []).map((n) => WDN[n]).join(""), dept: dn(u.deptId), ...(u.wheelchair ? { wc: true } : {}), ...(u.helpNote ? { note: u.helpNote } : {}), ...(u.noRideDefault ? { noRideDefault: u.noRideDefault } : {}), ...(u.libertaAM || u.libertaPM ? { liberta: `${u.libertaAM ? "朝" : ""}${u.libertaPM ? "夕" : ""}` } : {}),
      ...(Object.keys(u.deptByDay || {}).length ? { deptByDay: Object.fromEntries(Object.entries(u.deptByDay).map(([k, v]) => [k, dn(v)])) } : {}),
      meet: u.meetTime || "", send: u.sendTime || "", ...(Object.keys(u.timeByDay || {}).length ? { timeByDay: u.timeByDay } : {}), ...(u.daysFrom ? { daysFrom: u.daysFrom } : {}) }));
    const staffBase = dr.master.staff.filter((s) => !s.retireDate).map((s) => ({ name: s.name, dept: dn(s.deptId), male: !!s.isMale, time: `${s.start}-${s.end}`, ...(s.position ? { position: s.position } : {}), ...(s.helpOnly ? { helpOnly: true } : {}), ...(Object.keys(s.deptByDay || {}).length ? { deptByDay: Object.fromEntries(Object.entries(s.deptByDay).map(([k, v]) => [k, dn(v)])) } : {}), ...(s.offDays && s.offDays.length ? { off: s.offDays.map((n) => WDN[n]).join("") } : {}), ...(Object.keys(s.shiftByDay || {}).length ? { shiftByDay: s.shiftByDay } : {}) }));
    const helpIdx = AGENT_PATTERN_DAYS.map((d) => { const pt = (dr.patterns || {})[d]; if (!pt) return null; const dmm = dayMaster(dr.master, null, d, null); const hs = (pt.blocks || []).map((b) => `${b.time} ${b.label || (b.kind === "help" ? "ヘルプ" : "予定")}(${(dmm.staff.find((s) => s.id === b.staffId) || {}).name || "保留"})`); return hs.length ? `${WDN[d]}曜: ${hs.join("、")}` : null; }).filter(Boolean).join("\n");
    const pats = {};
    const patText = days.map((d) => { const pc = patternCtx(dr, d); pats[d] = pc.idMap; return `# 週間パターン(${WDN[d]}曜 / day:${d})の便\n${JSON.stringify(pc.c.runs.map(({ _id, ...r }) => r))}\n# 週間パターン(${WDN[d]}曜 / day:${d})のヘルプ・予定\n${JSON.stringify(pc.c.helps.map(({ _id, ...r }) => r))}`; }).join("\n");
    const text = `【今の下書き ${date}(${DAYS[wd]}) ${EDITION_LABEL}】
# その日の職員(off:true=休み)
${JSON.stringify(p.staffOn)}
# その日の利用者(absent:true=欠席。meet/send=希望時刻、"なし(...)"=送迎不要)
${JSON.stringify(p.users)}
# 車両
${JSON.stringify(p.vehicles)}
# その日の便(idは今回だけ有効)
${JSON.stringify(p.runs.map(({ _id, ...r }) => r))}
# その日のヘルプ
${JSON.stringify(p.helps.map(({ _id, ...r }) => r))}
# 未割当  迎え: ${p.unMeet.join("・") || "なし"} / 送り: ${p.unSend.join("・") || "なし"}
# 保留の予定id: ${p.holdIds.join("、") || "なし"}
# 出力前チェックの結果
${g || "問題なし"}
# 利用者の基本(days=利用曜日、deptByDay=曜日ごとの利用先 0日〜6土、timeByDay=曜日ごとの時刻、daysFrom=その日付から利用曜日が変わる)
${JSON.stringify(userBase)}
# 職員の基本(time=勤務時間、off=固定休、shiftByDay=曜日別の勤務)
${JSON.stringify(staffBase)}
# 車両タブ
${JSON.stringify(dr.master.vehicles.map((v) => ({ name: v.name, dept: dn(v.deptId), cap: v.capNormal, wc: v.wheelchairOK ? v.capWc : 0, ...(v.memo ? { memo: v.memo } : {}) })))}
# 部署タブ
${JSON.stringify(dr.master.departments.map((d) => ({ name: d.name, maleGapMin: d.maleGapMin, ...(d.capMax != null ? { capMax: d.capMax } : {}), ...(d.staffMax != null ? { staffMax: d.staffMax } : {}), ...(d.staffMin != null ? { staffMin: d.staffMin } : {}) })))}
# その日の欄  特記事項: ${JSON.stringify(dr.sheet.notes || "")} / 連絡事項: ${JSON.stringify(dr.sheet.contact || "")} / 訓練: ${JSON.stringify(dr.sheet.training || "")}
# ルール設定(ルールタブ・ヘルプ表。日数は0日〜6土)
${JSON.stringify(Object.fromEntries(Object.keys(RULE_LISTS).map((k) => [k, rulesOf(dr.master)[k] || []])))}
# 週間パターンのヘルプ・予定の一覧(各曜日)
${helpIdx || "(未作成)"}
${patText}`;
    return { text, idMap, dm, pats };
  };
  const system = () => `あなたは介護事業所の送迎表アプリを、担当者と会話しながら整えるアシスタントです。アプリのすべてのタブの欄を変えられます。
1. その日の送迎表の便・ヘルプ(changes)と、その日の欄(dayChanges: 特記事項・連絡事項・訓練・送迎なし・時間変更・欠席・当日の勤務・当日の利用先・今日だけ利用)
2. 職員・利用者・車両・部署タブ(masterChanges: 追加・変更・削除)
3. ルールタブ・ヘルプ表(ruleChanges) 4. 週間パターンの便・ヘルプ(patternChanges)
※「車両の動き」「3Dマップ」は見るだけの画面で、便を変えると自動で変わります
- 毎回、担当者のメッセージの後に「今の下書き」が付きます。変更はこの下書きに対する差分として出します。idはその回の下書きのものだけを使います
- 変更は担当者が「反映」を押すまで入りません。迷う判断は案を作ったうえで返事に選択肢を書きます。質問だけなら変更は空にして答えます
- 「毎週」「いつも」の話は基本(masterChanges)・ルール・週間パターンの変更です。その日だけの話は changes です。毎週の変更が今日にも関わるなら、今日の送迎表(changes)も合わせて直します
- 入浴やヘルプの曜日・時刻を変えるときは、週間パターンの該当曜日のヘルプを動かします(元の曜日から delete、新しい曜日へ add)。ルールの必須ヘルプ(requiredHelp)・2名体制(helpTwo)・固定担当(fixedBlock)の曜日も合わせて直します
- 週間パターンの便の中身が必要なら "need":[曜日番号] を返すと、次の回でその曜日の便・ヘルプ(id付き)を渡します。ヘルプの一覧は毎回渡しています
- 下の「送迎のルール」の文と、ルール設定・AIへの追加ルール(aiNotes)が食い違うときは、ルール設定・追加ルールを優先します。担当者が決まりごとを変えたいと言ったら、ルール設定で表せるものはルール設定を、表せないものは aiNotes を変えます
- 削除(職員・利用者・車両の削除、ルールの削除)は、担当者がはっきり頼んだときだけ行います。退職は削除ではなく職員の退職日(retireDate)で表します
- 返事は日本語で短く(300字以内)。何を変えたか、残っている問題、確認したいことを書きます。変更の一覧は画面に出るので書き写さない

# 送迎のルール
${aiRulesText(master)}

# 出力(次のJSONだけ。前後に説明やコードフェンスを書かない。最初の文字は { 。使わないキーは省略してよい)
{"reply":"担当者への返事",
 "changes":[{"op":"update","id":"r1","staff":"職員名","veh":"車名(ヘルプは\\"自車\\"も可)","time":"8:30","users":["利用者名"],"dest":"部署名","dur":60},{"op":"add","kind":"迎|送|他|ヘルプ","time":"15:30","staff":"職員名","veh":"車名","users":["利用者名"],"label":"ヘルプ名","note":"補足"},{"op":"delete","id":"r2"}],
 "staffOff":["その日休みにする職員名"],"staffTime":[{"name":"職員名","start":"10:00","end":"15:00"}],"userAbsent":["その日欠席にする利用者名"],
 "dayChanges":{"notesAppend":"特記事項に足す文","contactAppend":"連絡事項に足す文","notes":"(全部書き換えるとき)","training":"訓練の欄","userTime":[{"name":"利用者名","meet":"10:30","send":""}],"noRide":[{"name":"利用者名","meet":"受診後来所","send":""}],"userAbsent":[{"name":"利用者名","absent":true}],"staff":[{"name":"職員名","off":true,"start":"10:00","end":"","workToday":true,"dept":"部署名"}],"userDept":[{"name":"利用者名","dept":"部署名"}],"extraUse":[{"name":"利用者名","use":true}]},
 "masterChanges":[{"target":"user|staff|vehicle|dept","op":"update|add|delete","name":"今の名前","fromDate":"2026-11-01(利用曜日をこの日から変えるとき)","set":{"欄の名前":"新しい値"}}],
 "ruleChanges":[{"op":"add","list":"ngPairs","row":{"a":"利用者名","b":"利用者名"}},{"op":"update","list":"fixedBlock","match":{"label":"透析","days":[3,4]},"row":{"staff":"職員名"}},{"op":"delete","list":"requiredHelp","match":{"user":"利用者名"}}],
 "patternChanges":[{"day":2,"changes":[…changesと同じ形。idはその曜日のもの(ヘルプの追加は id 不要)…]}],
 "need":[2],
 "unresolved":[{"item":"項目","reason":"理由"}]}
masterChanges の欄(set に書く。"" や null で空にする。曜日の欄は {"曜日番号":値} で、その曜日だけ変わる):
 staff: name,deptId(部署名),position,emp,start,end,canDrive,isMale,hasOwnCar,ownCarCap,helpOnly,offDays,shiftByDay{"3":{"start","end"}},deptByDay{"5":"部署名"},subDeptId(部署名),subDeptByDay,retireDate,awayFrom,awayTo,memo,sortLast,noGrid,hideInStaffList,hideInPartList
 user: name,deptId(部署名),days,deptByDay,meetTime,sendTime,timeByDay{"3":{"meet","send"}},wheelchair,isMale,hasHelp,helpTwo,helpNote,libertaAM,libertaPM,libertaAMOffDays,libertaPMOffDays,noRideDefault{"meet":"家族送り","send":"","meetDays":[1,4]},startDate
 vehicle: name,deptId(部署名),capNormal,capWc,wheelchairOK,memo / dept: name,maleGapMin,capMax,staffMax,staffMin
ヘルプ表: helpBase{label,time,byDay:{"1":"職員名","3":"職員名・職員名"}}(曜日ごとの基本の担当)
ルール設定の一覧と項目: ngPairs{a,b}=同乗NG / fixedRun{kind:"meet"|"send",user,days,staff}=迎え・送りの固定担当 / fixedVeh{veh,before,days,staff}=車の固定担当 / fixedBlock{label,exact,kind:"block"|"help"|"",time,from,days,staff}=予定・ヘルプの固定担当 / requiredHelp{user,days}=必須ヘルプ / helpTwo{user,days}=夕方2名体制 / maleOnly{user,from,bathOnly}=男性職員のみ / userVeh{user,veh}=基本の車 / otherRules{text,days,check}=その他のルール(出力前に確認) / aiNotes{text}=AIへの追加ルール。days は 0日〜6土 の数字。deptByDay・timeByDay の値を "" や null にするとその曜日の指定を消す。`;

  const callModel = async (messages) => {
    const sampler = window.claude && window.claude.use ? await window.claude.use("sample") : null;
    if (!sampler) throw new Error("この画面ではAIが使えません(管理者がAIの設定をすると使えます)");
    let res;
    try { res = await sampler(messages, { system: system(), modelTier: "default", cache: false, maxTokens: 4000 }); }
    catch (e) { throw new Error((e && e.message) || "AIに接続できませんでした"); }
    return String((res && res.text) || "");
  };
  // AIの出力を下書きに当てはめる(送迎表・基本・ルール・週間パターン)
  const applyAi = (dr, o, st) => {
    const errs = []; let next = { ...dr };
    if (Array.isArray(o.ruleChanges) && o.ruleChanges.length) { const r = agApplyRules(next.master, rulesOf(next.master), o.ruleChanges); errs.push(...r.errs); next = { ...next, master: { ...next.master, rules: r.rules } }; }
    if (Array.isArray(o.masterChanges) && o.masterChanges.length) { const r = agApplyMaster(next.master, o.masterChanges); errs.push(...r.errs); next = { ...next, master: r.master }; }
    const ch = Array.isArray(o.changes) ? o.changes.filter((c) => c && typeof c === "object") : [];
    const offNames = Array.isArray(o.staffOff) ? o.staffOff.map(String) : [];
    const times = Array.isArray(o.staffTime) ? o.staffTime.filter((x) => x && x.name) : [];
    let capFixed = [];
    if (ch.length || offNames.length || times.length) {
      const dm = dayMaster(next.master, next.sheet, wd, date);
      const r = aiApplyPure(dm, next.sheet, ch, st.idMap, { staffOff: offNames, staffTime: times, workChanges: [] });
      next = { ...next, sheet: r.next }; capFixed = r.capFixed;
      ch.forEach((c) => { if ((c.op === "update" || c.op === "delete") && !st.idMap[c.id]) errs.push(`その日の便・ヘルプ「${c.id}」が見つかりません`); });
    }
    if (o.dayChanges && typeof o.dayChanges === "object") { const r = agApplyDay(next.master, next.sheet, o.dayChanges); errs.push(...r.errs); next = { ...next, sheet: r.sheet }; }
    const ab = Array.isArray(o.userAbsent) ? o.userAbsent.map(String) : [];
    if (ab.length) { const ua = { ...(next.sheet.userAbsent || {}) }; ab.forEach((n) => { const u = next.master.users.find((x) => x.name === stripParen(n)); if (u) ua[u.id] = true; else errs.push(`利用者「${n}」が見つかりません`); }); next = { ...next, sheet: { ...next.sheet, userAbsent: ua } }; }
    if (Array.isArray(o.patternChanges) && o.patternChanges.length && next.patterns) {
      const ps = { ...next.patterns };
      o.patternChanges.forEach((pc) => {
        const d = Number(pc && pc.day); if (!(d >= 0 && d <= 6)) { errs.push(`週間パターンの曜日「${pc && pc.day}」が読めません`); return; }
        const pch = (Array.isArray(pc.changes) ? pc.changes : []).filter((c) => c && typeof c === "object");
        const idMap = st.pats[d] || patternCtx(next, d).idMap;
        pch.forEach((c) => { if ((c.op === "update" || c.op === "delete") && !idMap[c.id]) errs.push(`${WDN[d]}曜のパターンの「${c.id}」が見つかりません(先に need で中身を確認してください)`); });
        const ok = pch.filter((c) => c.op === "add" || idMap[c.id]);
        if (!ok.length) return;
        const dm = dayMaster(next.master, null, d, null);
        const cur = ps[d] || { runs: [], blocks: [], training: "" };
        const nx = aiApplyPure(dm, cur, ok, idMap, { staffOff: [], staffTime: [], workChanges: [] }).next;
        if (!("staffOv" in cur)) delete nx.staffOv;
        ps[d] = nx;
      });
      next = { ...next, patterns: ps };
    }
    return { next, errs, capFixed };
  };
  const changedCount = (a, b) => (JSON.stringify(a.sheet) !== JSON.stringify(b.sheet) ? 1 : 0) + (JSON.stringify(a.master) !== JSON.stringify(b.master) ? 1 : 0) + (JSON.stringify(a.patterns) !== JSON.stringify(b.patterns) ? 1 : 0);

  const send = async (userText) => {
    const t = String(userText || "").trim(); if (!t || busy) return;
    if (!draft.patterns) { setErr("週間パターンを読み込んでいます。少し待ってから送ってください"); return; }
    setInput(""); setErr("");
    setLog((l) => [...l, { who: "me", text: t }]);
    let dr = draft, h = hist, days = shown, fix = 0, needs = 0, msg = t, label = "【担当者】";
    const startDr = draft;   // この依頼の前の状態(もともとあった問題は差し戻さない)
    try {
      for (let guard = 0; guard < 8; guard++) {
        setBusy(label === "【自動チェック】" ? "チェックで見つかった問題をAIが直しています…" : label === "【資料】" ? "週間パターンをAIに見せています…" : "AIが考えています…");
        const st = stateText(dr, days);
        const messages = [...h, { role: "user", content: `${label}${msg}\n\n${st.text}` }];
        let text = await callModel(messages);
        let o = agentParse(text);
        if (!o) { text = await callModel([...messages, { role: "assistant", content: text }, { role: "user", content: "JSONとして読めませんでした。説明を付けず、指定のJSONだけをもう一度出してください。" }]); o = agentParse(text); }
        if (!o) throw new Error("AIの返事を読み取れませんでした。言い方を変えてもう一度送ってください");
        const r = applyAi(dr, o, st);
        const changed = changedCount(dr, r.next);
        dr = r.next;
        const extra = [
          ...r.errs.map((x) => `反映できなかった変更: ${x}`),
          ...(r.capFixed.length ? [`定員超過のため外した人: ${r.capFixed.join("、")}`] : []),
          ...((Array.isArray(o.unresolved) ? o.unresolved : []).map((x) => `未解決: ${x.item}(${x.reason})`)),
        ];
        if (o.reply) setLog((l) => [...l, { who: "ai", text: String(o.reply), note: changed ? "下書きを変更しました(右の一覧)" : "", extra }]);
        h = [...h, { role: "user", content: `${label}${msg}(このときの下書きは省略)` }, { role: "assistant", content: JSON.stringify(o) }];
        setDraft(dr); setHist(h);
        const need = (Array.isArray(o.need) ? o.need : []).map(Number).filter((d) => d >= 0 && d <= 6 && !days.includes(d));
        if (need.length && needs < 2) { needs++; days = [...days, ...need]; setShown(days); label = "【資料】"; msg = `週間パターン(${need.map((d) => WDN[d]).join("・")}曜)の中身を付けました。続けてください。`; continue; }
        if (r.errs.length && fix < 2) { fix++; label = "【自動チェック】"; msg = `次の変更は反映できませんでした。名前・idを直して出し直してください。\n${r.errs.slice(0, 20).join("\n")}`; setLog((l) => [...l, { who: "sys", text: `反映できない変更が${r.errs.length}件あったので、AIに直させています` }]); continue; }
        const probs = (x) => checksOf(x).filter((g) => AGENT_FIX_GROUPS.test(g.title)).flatMap((g) => g.items.map((i) => `${g.title}: ${i}`));
        const before = new Set(probs(startDr));
        const left = probs(dr).filter((x) => !before.has(x));
        if (left.length && changed && fix < 2) { fix++; label = "【自動チェック】"; msg = `今回の変更で、下書きの送迎表に次の問題が新しく出ました。直せるものは追加のchangesで直し、直せないものはunresolvedに理由を書いてください。\n${left.slice(0, 25).join("\n")}`; setLog((l) => [...l, { who: "sys", text: `チェックで${left.length}件の問題が見つかったので、AIに直させています` }]); continue; }
        break;
      }
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally { setBusy(""); }
  };

  const fixCount = groups.filter((g) => AGENT_FIX_GROUPS.test(g.title)).reduce((n, g) => n + g.items.length, 0);
  const areas = [...new Set(diffs.map((x) => x.area))];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-5xl h-full flex flex-col md:flex-row shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 min-w-0 flex flex-col border-r border-stone-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
            <div className="font-bold">💬 AIと相談 <span className="text-xs font-normal text-stone-500">{date}({DAYS[wd]})・{EDITION_LABEL}</span></div>
            <button className="px-2 text-xl text-stone-500" onClick={onClose} aria-label="閉じる">×</button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3 text-sm">
            {log.map((m, i) => (
              <div key={i} className={m.who === "me" ? "flex justify-end" : "flex"}>
                <div className={m.who === "me" ? "bg-sky-600 text-white rounded-2xl rounded-br-sm px-3 py-2 max-w-[85%] whitespace-pre-wrap" : m.who === "sys" ? "text-xs text-stone-500 italic" : "bg-stone-100 rounded-2xl rounded-bl-sm px-3 py-2 max-w-[85%] whitespace-pre-wrap"}>
                  {m.text}
                  {m.note ? <div className="text-xs text-emerald-700 font-bold mt-1">{m.note}</div> : null}
                  {(m.extra || []).map((x, j) => <div key={j} className="text-xs text-rose-700 mt-1">{x}</div>)}
                </div>
              </div>
            ))}
            {busy && <div className="text-xs text-stone-500">{busy}</div>}
            {err && <div className="text-xs text-rose-700 font-bold">⚠ {err}</div>}
            <div ref={endRef} />
          </div>
          <form className="p-3 border-t border-stone-200 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea id="agentInput" className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm resize-none" rows={2} value={input} placeholder="例: 井上さんの入浴を木曜17時から火曜16時に変えて"
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(input); } }} disabled={!!busy} />
            <button className="px-4 rounded-lg bg-sky-600 text-white font-bold disabled:opacity-40" disabled={!!busy || !input.trim()}>送信</button>
          </form>
        </div>
        <div className="w-full md:w-[26rem] flex flex-col max-h-[50vh] md:max-h-none">
          <div className="px-4 py-3 border-b border-stone-200 font-bold text-sm">変わる所 <span className="font-normal text-stone-500">{diffs.length}か所</span></div>
          <div className="flex-1 overflow-auto p-3 space-y-1 text-xs">
            {!diffs.length && <div className="text-stone-400">まだ変更はありません</div>}
            {areas.map((a) => (
              <div key={a} className="space-y-1 pb-2">
                <div className="font-bold text-stone-600 pt-1">{a}</div>
                {diffs.filter((x) => x.area === a).map((x, i) => (
                  <div key={i} className={`px-2 py-1 rounded ${x.t === "add" ? "bg-emerald-50 text-emerald-900" : x.t === "del" ? "bg-rose-50 text-rose-900 line-through" : "bg-amber-50 text-amber-900"}`}>
                    {x.t === "add" ? "＋ " : x.t === "del" ? "－ " : "↻ "}{x.text}
                  </div>
                ))}
              </div>
            ))}
            <div className="pt-3 font-bold text-sm text-stone-700">{date}のチェック <span className={fixCount ? "text-rose-700" : "text-emerald-700"}>{fixCount ? `要修正 ${fixCount}件` : "要修正なし"}</span></div>
            {groups.map((g, i) => (
              <details key={i} className="border border-stone-200 rounded px-2 py-1" open={AGENT_FIX_GROUPS.test(g.title)}>
                <summary className="cursor-pointer">{g.icon} {g.title}({g.items.length})</summary>
                {g.items.slice(0, 30).map((it, j) => <div key={j} className="pl-2 py-0.5 text-stone-600">{it}</div>)}
              </details>
            ))}
          </div>
          <div className="p-3 border-t border-stone-200 flex gap-2">
            <button className="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-40" disabled={!diffs.length || !!busy}
              onClick={() => onApply(base.current, draft, log.filter((m) => m.who === "me").map((m) => m.text))}>この案を反映</button>
            <button className="px-3 py-2 rounded-lg border border-stone-300 disabled:opacity-40" disabled={!diffs.length || !!busy}
              onClick={() => { setDraft(agClone(base.current)); setHist([]); setShown([]); setLog((l) => [...l, { who: "sys", text: "下書きを元に戻しました" }]); }}>案を捨てる</button>
          </div>
        </div>
      </div>
    </div>
  );
}
'''
# AI調整(いままでの機能)にも、ルール設定・追加ルールを優先する一文と追加ルールを入れる
rep("\n# ルール\n- 欠席者(absent:true)を便から外す。", "\n# ルール\n${aiExtraRulesText(master)}- 欠席者(absent:true)を便から外す。")
extra_fn = r'''// ルール設定とAIへの追加ルールを、AIの指示文に入れる形にする
function aiExtraRulesText(master) {
  const R = rulesOf(master);
  const notes = (R.aiNotes || []).map((x) => x && x.text).filter(Boolean);
  return "- 下の文とルールタブの設定・AIへの追加ルールが食い違うときは、ルールタブの設定・追加ルールを優先する\n" +
    (notes.length ? notes.map((t) => `- 【追加ルール】${t}\n`).join("") : "");
}
'''
rules_fn = rules_fn.replace("function aiRulesText(master) {\n  return `", "function aiRulesText(master) {\n  return `${aiExtraRulesText(master)}")
rep("export default function App() {", extra_fn + apply_fn + checks_fn + ctx_fn + rules_fn + agent + "\nexport default function App() {")

# ルールタブに「AIへの追加ルール」を足す
rep("const EMPTY_RULES = { ngPairs: [], fixedRun: [], fixedVeh: [], fixedBlock: [], requiredHelp: [], helpTwo: [], maleOnly: [], userVeh: [], helpBase: [], otherRules: [] };",
    "const EMPTY_RULES = { ngPairs: [], fixedRun: [], fixedVeh: [], fixedBlock: [], requiredHelp: [], helpTwo: [], maleOnly: [], userVeh: [], helpBase: [], otherRules: [], aiNotes: [] };")
i = src.index('rows={r.otherRules || []} onChange={(rows) => setKey("otherRules", rows)}')
j = src.index("        ]} />\n", i) + len("        ]} />\n")
src = src[:j] + '''      <RuleRows title="⑩ AIへの追加ルール" note="AI調整・AIと相談のときだけAIが読む決まりごとです。「💬 AIと相談」で話して変えることもできます"
        rows={r.aiNotes || []} onChange={(rows) => setKey("aiNotes", rows)} onAdd={add("aiNotes")} blank={{ text: "" }}
        cols={[
          { key: "text", label: "内容", cell: (x, s) => <input className="w-96 border border-stone-300 rounded px-1 py-1 text-sm" value={x.text || ""} onChange={(e) => s({ text: e.target.value })} placeholder="例:中村のリベルタへの送りは2便目(17:00)に固定" /> },
        ]} />
''' + src[j:]

# --- (6) ボタンと画面の呼び出し
rep('''<button className={btnSec} onClick={() => setModal({ type: "aiAdjust" })} title="当日の欠席・送迎なし・職員の休みを踏まえて、AIが便の組み替え案を作ります">🤖 AI調整</button>''',
    '''<button className={btnSec} onClick={() => setModal({ type: "aiAdjust" })} title="当日の欠席・送迎なし・職員の休みを踏まえて、AIが便の組み替え案を作ります">🤖 AI調整</button>
              <button className={btnSec} onClick={() => setModal({ type: "agent" })} title="AIと会話しながら、送迎表・利用者の利用曜日・入浴の曜日や時刻・ルールを変えます。反映するまで何も変わりません">💬 AIと相談</button>''')
rep('''      {modal && modal.type === "aiAdjust" && sheetMaster && dataForGrid && (''', '''      {modal && modal.type === "agent" && master && sheet && (
        <AgentChat master={master} sheet={sheet} date={date} onClose={() => setModal(null)}
          onApply={async (base, draft, requests) => {
            // 相談中に他の人・カレンダーで変わった分と統合して反映(上書きしない)
            const M = (b, d, c) => (window.SGKV ? window.SGKV.merge3(b, d, c).value : d);
            const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
            const stamp = new Date().toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
            const line = `◆${stamp} AIと相談して反映` + (requests.length ? `(依頼: ${requests.slice(-3).join(" / ").slice(0, 200)})` : "");
            if (!same(base.master, draft.master)) updateMaster((cur) => M(base.master, draft.master, cur));
            if (!same(base.sheet, draft.sheet)) updateSheet((cur) => { const merged = M(base.sheet, draft.sheet, cur); return { ...merged, aiLog: (merged.aiLog ? merged.aiLog + "\\n" : "") + line }; });
            const days = Object.keys(draft.patterns || {}).filter((d) => !same((base.patterns || {})[d], draft.patterns[d]));
            for (const d of days) {
              if (tab === "pattern" && String(weekday) === String(d)) updatePattern((cur) => M(base.patterns[d], draft.patterns[d], cur));
              else { const cur = await sGet(`pattern:${d}`); sSet(`pattern:${d}`, M(base.patterns[d], draft.patterns[d], cur)); }
            }
            setModal(null);
            notify(`AIと相談した案を反映しました(${[!same(base.sheet, draft.sheet) && "送迎表", !same(base.master, draft.master) && "利用者・職員・ルール", days.length && `週間パターン${days.length}曜日`].filter(Boolean).join("・")})`);
          }} />
      )}
      {modal && modal.type === "aiAdjust" && sheetMaster && dataForGrid && (''')
open("app3u.jsx", "w", encoding="utf-8").write(src)
print("app3u.jsx", len(src))
