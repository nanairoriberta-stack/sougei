"use strict";
global.window = { __SG_EDITION: "v1" };
const E = require("./eng.cjs"), assert = require("assert");
const results = []; const test = (n, f) => { try { const i = f(); results.push(n); console.log("✔", n, i ? "— " + i : ""); } catch (e) { console.log("✘", n, e && e.stack || e); process.exitCode = 1; } };
const m = E.mergeSeedMaster(null, E.seedMaster());
const date = "2026-11-02", wd = 1;
const pat = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon);
const sheet = Object.assign(E.emptySheet(), { runs: pat.runs.map((r, i) => ({ ...r, id: "r" + i })), blocks: pat.blocks.map((b, i) => ({ ...b, id: "b" + i })) });
const dm = E.applyDayDept(m, wd, sheet.staffOv, sheet.userDept, sheet.userExtra, date);
const grid = (d, mm) => ({ staffOv: {}, userAbsent: {}, userDept: {}, notes: "", contact: "", libertaOff: {}, libertaOn: {}, userTime: {}, ...d, noRide: { ...E.noRideDefaults(mm, wd), ...(d.noRide || {}) } });

test("出力前チェックを関数として取り出せる（Excel出力前のチェックと同じ）", () => {
  const g = E.collectSheetChecks(dm, sheet, date, pat);
  assert.ok(Array.isArray(g)); return g.map((x) => `${x.title}${x.items.length}`).join(" / ");
});
test("AIに渡す状態とルール文が作れる", () => {
  const c = E.aiContextOf(dm, grid(sheet, dm), wd); const r = E.aiRulesText(m);
  assert.ok(c.runs.length === sheet.runs.length && c.staffOn.length > 40); assert.ok(r.includes("ルールタブの設定・追加ルールを優先"));
  return `便${c.runs.length}・ヘルプ${c.helps.length}・ルール文${r.length}字`;
});
test("AIの変更案（担当の振替・便の追加・削除）を下書きに当てはめる。元の送迎表は変えない", () => {
  const c = E.aiContextOf(dm, grid(sheet, dm), wd);
  const idMap = { ...Object.fromEntries(c.runs.map((r) => [r.id, { t: "runs", id: r._id }])), ...Object.fromEntries(c.helps.map((h) => [h.id, { t: "blocks", id: h._id }])) };
  const before = JSON.stringify(sheet);
  const r = E.aiApplyPure(dm, sheet, [{ op: "update", id: "r2", staff: "日野" }, { op: "delete", id: "r3" }, { op: "add", kind: "ヘルプ", time: "14:00", staff: "白戸", veh: "自車", label: "テストヘルプ" }], idMap, { staffOff: ["安達"], staffTime: [], workChanges: [] });
  assert.strictEqual(JSON.stringify(sheet), before, "元の送迎表は変わらない");
  const n = r.next; const hino = dm.staff.find((s) => s.name === "日野").id, adachi = dm.staff.find((s) => s.name === "安達").id;
  assert.strictEqual(n.runs.find((x) => x.id === idMap.r2.id).staffId, hino); assert.ok(!n.runs.some((x) => x.id === idMap.r3.id));
  assert.ok(n.blocks.some((b) => b.label === "テストヘルプ")); assert.strictEqual(n.staffOv[adachi].off, true);
  return "担当変更・便削除・ヘルプ追加・安達の休み";
});
test("会話でルールを変える（同乗NG追加・透析の担当変更・必須ヘルプ削除・AIへの追加ルール）", () => {
  const R = E.rulesOf(m);
  const r = E.agApplyRules(m, R, [
    { op: "add", list: "ngPairs", row: { a: "早川", b: "青木" } },
    { op: "update", list: "fixedBlock", match: { label: "透析", days: [3, 4] }, row: { staff: "高井" } },
    { op: "delete", list: "requiredHelp", match: { user: "吉浦" } },
    { op: "add", list: "aiNotes", row: { text: "中村のリベ送は2便目" } },
    { op: "add", list: "ngPairs", row: { a: "存在しない人", b: "青木" } },
    { op: "delete", list: "fixedRun", match: { user: "早川" } },
  ]);
  assert.ok(r.rules.ngPairs.some((x) => x.a === "早川" && x.b === "青木"));
  assert.strictEqual(r.rules.fixedBlock.find((x) => x.label === "透析" && x.days.join() === "3,4").staff, "高井");
  assert.ok(!r.rules.requiredHelp.some((x) => x.user === "吉浦")); assert.strictEqual(r.rules.aiNotes[0].text, "中村のリベ送は2便目");
  assert.strictEqual(r.errs.length, 2, "名前の誤り・当てはまらない削除は反映せず理由を返す: " + r.errs.join(" | "));
  const d = E.agMasterDiff(m, { ...m, rules: r.rules }); assert.ok(d.length >= 4);
  return d.map((x) => x.text).join(" / ");
});
test("会話で利用者・職員の基本を変える（利用曜日・曜日ごとの利用先・時刻・11月からの変更・勤務時間）", () => {
  const r = E.agApplyMaster(m, [
    { target: "user", name: "中村", days: [1, 3, 5], deptByDay: { 3: "津田" }, timeByDay: { 3: { meet: "9:30" } } },
    { target: "user", name: "森", days: [1, 2, 3, 4, 5], fromDate: "2026-11-01" },
    { target: "staff", name: "高井", shiftByDay: { 3: { start: "10:00", end: "15:00" } } },
    { target: "user", name: "いない人", days: [1] },
    { target: "user", name: "中村", deptByDay: { 5: "存在しない部署" } },
  ]);
  const u = r.master.users.find((x) => x.name === "中村"), tsuda = r.master.departments.find((x) => x.name === "津田").id;
  assert.deepStrictEqual(u.days, [1, 3, 5]); assert.strictEqual(u.deptByDay[3], tsuda); assert.strictEqual(u.timeByDay[3].meet, "9:30");
  assert.deepStrictEqual(r.master.users.find((x) => x.name === "森").daysFrom["2026-11-01"], [1, 2, 3, 4, 5]);
  assert.strictEqual(r.errs.length, 2);
  const wed = E.applyDayDept(r.master, 3, null, null, null, "2026-11-04"); assert.strictEqual(wed.users.find((x) => x.name === "中村").deptId, tsuda, "水曜は津田として扱われる");
  assert.ok(m.users.find((x) => x.name === "中村").deptByDay === undefined || !m.users.find((x) => x.name === "中村").deptByDay[3], "元のマスタは変わらない");
  return E.agMasterDiff(m, r.master).map((x) => x.text).join(" / ");
});
test("入浴の曜日・時刻を変える（木曜パターンから削除し、火曜パターンへ追加）", () => {
  const thu = E.resolveSeedPattern(m, E.SEED_PATTERNS.thu), tue = E.resolveSeedPattern(m, E.SEED_PATTERNS.tue);
  const dmT = E.applyDayDept(m, 4, null, null, null, null), dmU = E.applyDayDept(m, 2, null, null, null, null);
  const cT = E.aiContextOf(dmT, grid(thu, dmT), 4); const bath = cT.helps.find((h) => /井上入浴/.test(h.label));
  assert.ok(bath, "木曜に井上入浴がある");
  const idT = Object.fromEntries(cT.helps.map((h) => [h.id, { t: "blocks", id: h._id }]));
  const t2 = E.aiApplyPure(dmT, thu, [{ op: "delete", id: bath.id }], idT, { staffOff: [], staffTime: [], workChanges: [] }).next;
  const u2 = E.aiApplyPure(dmU, tue, [{ op: "add", kind: "ヘルプ", time: "16:00", staff: "井川", veh: "自車", label: "井上入浴" }], {}, { staffOff: [], staffTime: [], workChanges: [] }).next;
  const cntT = (p) => p.blocks.filter((b) => /井上入浴/.test(b.label || "")).length;
  assert.strictEqual(cntT(t2), cntT(thu) - 1); assert.ok(u2.blocks.some((b) => b.label === "井上入浴" && b.time === "16:00"));
  return `木曜の井上入浴 ${cntT(thu)}→${cntT(t2)}件、火曜16:00に追加`;
});
test("移動便(あいのて→嫁島)は、案を当てはめても消えない（AI調整の不具合の修正）", () => {
  const c = E.aiContextOf(dm, grid(sheet, dm), wd);
  const idMap = Object.fromEntries(c.runs.map((r) => [r.id, { t: "runs", id: r._id }]));
  const mv = sheet.runs.find((r) => r.mode === "move"); assert.ok(mv, "月曜パターンに移動便がある");
  const r = E.aiApplyPure(dm, sheet, [{ op: "update", id: c.runs.find((x) => x._id === mv.id).id, time: "15:10" }], idMap, { staffOff: [], staffTime: [], workChanges: [] });
  const after = r.next.runs.find((x) => x.id === mv.id); assert.ok(after && after.userIds.length, "移動便と乗客が残る");
  return `${mv.time}→${after.time} ${mv.note || ""} 乗客${after.userIds.length}名`;
});
test("職員・利用者・車両・部署タブの全部の欄を変えられる（追加・変更・削除・名前の変更）", () => {
  const r = E.agApplyMaster(m, [
    { target: "staff", name: "日野", set: { isMale: true, position: "主任", ownCarCap: 4, retireDate: "2027-03-31", deptByDay: { 2: "津田" } } },
    { target: "user", name: "中村", set: { wheelchair: true, helpNote: "玄関で声かけ", noRideDefault: { meet: "家族送り", meetDays: [1, 4] }, libertaPMOffDays: [5] } },
    { target: "vehicle", name: "セレナ", set: { capNormal: 8, memo: "点検 11/10" } },
    { target: "dept", name: "津田", set: { staffMin: 2, capMax: 14 } },
    { target: "vehicle", op: "add", name: "新しい車", set: { dept: "川津", capNormal: 4, wheelchairOK: true, capWc: 1 } },
    { target: "staff", op: "add", name: "新人A", set: { dept: "嫁島", start: "9:00", end: "16:00", isMale: false } },
    { target: "user", name: "森", set: { name: "森一郎" } },
    { target: "vehicle", op: "delete", name: "カービィ" },
    { target: "dept", op: "delete", name: "川津" },
    { target: "staff", name: "日野", set: { 存在しない欄: 1 } },
  ]);
  const M = r.master;
  assert.strictEqual(M.staff.find((x) => x.name === "日野").isMale, true); assert.strictEqual(M.users.find((x) => x.name === "中村").noRideDefault.meet, "家族送り");
  assert.strictEqual(M.vehicles.find((x) => x.name === "セレナ").capNormal, 8); assert.strictEqual(M.departments.find((x) => x.name === "津田").staffMin, 2);
  assert.ok(M.vehicles.some((x) => x.name === "新しい車") && M.staff.some((x) => x.name === "新人A") && M.users.some((x) => x.name === "森一郎"));
  assert.ok(!M.vehicles.some((x) => x.name === "カービィ") && M.departments.some((x) => x.name === "川津"), "車は削除、部署の削除は断る");
  assert.strictEqual(r.errs.length, 2, r.errs.join(" | "));
  return E.agMasterDiff(m, M).length + "か所: " + E.agMasterDiff(m, M).slice(0, 6).map((x) => x.text).join(" / ");
});
test("その日の欄（特記事項・送迎なし・時間変更・欠席・当日の勤務・当日の利用先・今日だけ利用）", () => {
  const r = E.agApplyDay(m, sheet, { notesAppend: "雨のため早めに出発", noRide: [{ name: "中村", meet: "受診後来所" }], userTime: [{ name: "森", send: "15:30" }], userAbsent: [{ name: "星野" }], staff: [{ name: "高井", start: "10:00" }, { name: "白戸", off: true }], userDept: [{ name: "岡本", dept: "津田" }], extraUse: [{ name: "青木" }] });
  const s2 = r.sheet; const id = (n) => m.users.find((x) => x.name === n).id, sid = (n) => m.staff.find((x) => x.name === n).id;
  assert.ok(s2.notes.includes("雨")); assert.strictEqual(s2.noRide[id("中村")].meet, "受診後来所"); assert.strictEqual(s2.userTime[id("森")].send, "15:30");
  assert.ok(s2.userAbsent[id("星野")] && s2.staffOv[sid("高井")].start === "10:00" && s2.staffOv[sid("白戸")].off && s2.userExtra[id("青木")]);
  assert.strictEqual(r.errs.length, 0);
  return E.agDayDiff(m, sheet, s2).map((x) => x.text).join(" / ");
});
test("ヘルプ表（曜日ごとの基本の担当）を会話で変えられる", () => {
  const r = E.agApplyRules(m, E.rulesOf(m), [{ op: "add", list: "helpBase", row: { label: "井上入浴", time: "16:00", byDay: { 2: "井川・安部" } } }, { op: "add", list: "helpBase", row: { label: "x", time: "9:00", byDay: { 1: "いない人" } } }]);
  assert.strictEqual(r.rules.helpBase[0].byDay[2], "井川・安部"); assert.strictEqual(r.errs.length, 1);
  return E.agMasterDiff(m, { ...m, rules: r.rules }).map((x) => x.text).join(" / ");
});
console.log(`\n${results.length} passed`);
