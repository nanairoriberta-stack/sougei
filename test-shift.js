/* シフト表（マンション職員）：穴の判定・LINE文・基本パターンの下書き・希望のまとめ */
"use strict";
const assert = require("assert");
const S = require("./shiftcore.js");
const ym = "2026-11", cfg = S.cfgOf("m");
assert.strictEqual(S.daysOfMonth(ym).length, 30);
assert.strictEqual(S.label("2026-11-03"), "11/3(火)");
assert.deepStrictEqual(cfg.members.map((m) => m.name), ["余村慎", "横田", "秋山", "長島", "近藤", "宮永", "橋本", "野津"], "写真の男性職員");
// 女性：依頼者の表（6-9＝早、16-22＝遅、17-22・17-20・9-18 は時間つき）
{ const fc = S.cfgOf("f"), fm = S.draft({}, fc, "2026-11");
  assert.deepStrictEqual(fc.members.map((m) => m.name), ["窪田", "森", "川島", "杉谷", "角", "中谷", "川谷", "青木"]);
  assert.strictEqual(S.holes(fm, fc, "2026-11").length, 0, "基本シフトで全部埋まる");
  const sat = fm.days["2026-11-07"];   // 土曜
  assert.deepStrictEqual(Object.values(sat.e).map((x) => x.n), ["杉谷", "角", "中谷"]);
  assert.deepStrictEqual(Object.values(sat.l), [{ n: "窪田", t: "17~22" }, { n: "川島", t: "17~20" }, { n: "川谷", t: "17~22" }], "遅番の時間も");
  assert.deepStrictEqual(sat.d, ["青木(9~18)"], "日勤の時間も");
  assert.strictEqual(S.patOf(fc, { name: "青木" }, 6), "日"); assert.strictEqual(S.patOf(fc, { name: "森" }, 5), "休");
  assert.deepStrictEqual(S.offList(fm, fc, "2026-11-05"), ["川島", "角", "中谷", "青木"], "木曜の休み");
  // 女性は①〜③が1週ごとに1つずつずれる（基準の週＝11/2〜8 が表のとおり）
  const mon = (d) => Object.values(fm.days[d].e).map((x) => x.n);
  assert.deepStrictEqual(mon("2026-11-02"), ["川島", "杉谷", "中谷"], "基準の週は表のとおり");
  assert.deepStrictEqual(mon("2026-11-09"), ["中谷", "川島", "杉谷"], "次の週は ①→② ②→③ ③→①");
  assert.deepStrictEqual(mon("2026-11-16"), ["杉谷", "中谷", "川島"], "その次の週");
  assert.deepStrictEqual(Object.values(fm.days["2026-11-10"].l).map((x) => x.n), ["青木", "森"], "2人の枠も入れ替わる");
  assert.deepStrictEqual(Object.values(fm.days["2026-11-01"].e).map((x) => x.n), ["杉谷", "中谷", "川島"], "前の週（11/1の日曜）は逆に1つ戻る");
  assert.strictEqual(S.weeksFrom(fc, "2026-12-07"), 5, "月をまたいでも続く");
  assert.strictEqual(S.weeksFrom(S.cfgOf("m"), "2026-12-07"), 0, "男性はずらさない"); }
// 男性11月の表の法則：希望休で空いた枠は、まずその日に日勤の人を回す（11/8 横田・秋山が休み → 早に日勤の近藤・野津）
{ const mc = S.cfgOf("m"), d8 = S.draft({ wish: { "横田": { "2026-11-08": "休" }, "秋山": { "2026-11-08": "休" } } }, mc, "2026-11").days["2026-11-08"];
  assert.deepStrictEqual(Object.values(d8.e).map((x) => x.n), ["近藤", "野津"], "日勤の人が早へ（紙の表と同じ）");
  assert.deepStrictEqual(d8.d, [], "日勤は空く");
  const lm = { days: { "2026-11-09": { e: { 1: { n: "橋本" }, 2: { n: "野津" } }, l: { 2: { n: "橋本" }, 3: { n: "野津" } }, d: ["横田", "近藤(~13)"] } }, wish: { "秋山": { "2026-11-09": "休" } } };
  assert.ok(S.lineText(lm, mc, "2026-11", { withNames: true }).includes("・11/9(月) 遅①（入れそうな人：横田さん(日勤から)・近藤さん(日勤から)"), "LINE文でも日勤の人を先に"); }

// 何も入っていない月：要る枠がすべて穴（日2+2・月2+3・火〜木3+3・金3+2・土2+2）
const need = { 0: 4, 1: 5, 2: 6, 3: 6, 4: 6, 5: 5, 6: 4 };
assert.strictEqual(S.holes({}, cfg, ym).length, S.daysOfMonth(ym).reduce((a, d) => a + need[S.wdOf(d)], 0));

// 11/2(月)：写真どおりに入れる → 穴なし。橋本は早①と遅②の両方
const month = { days: { "2026-11-02": { e: { 1: { n: "橋本" }, 2: { n: "野津" } }, l: { 1: { n: "宮永", t: "16~22" }, 2: { n: "橋本" }, 3: { n: "野津" } }, d: ["横田", "近藤", "秋山"] } },
  wish: { "余村慎": { "2026-11-03": "休" }, "近藤": { "2026-11-06": "PM休", "2026-11-13": "PM休" } }, wishNote: { "野津": "13〜17日 休" } };
assert.ok(!S.holes(month, cfg, ym).some((h) => h.date === "2026-11-02"), "11/2は埋まっている");
assert.deepStrictEqual(S.offList(month, cfg, "2026-11-02"), ["余村慎", "長島"], "休み＝どこにも入っていない人");

// 11/3(火)：早①②だけ入っている → 早③・遅①②③が穴
month.days["2026-11-03"] = { e: { 1: { n: "横田" }, 2: { n: "橋本" } }, l: {}, d: [] };
const h3 = S.holes(month, cfg, ym).filter((h) => h.date === "2026-11-03").map((h) => h.kind + h.idx);
assert.deepStrictEqual(h3, ["e3", "l1", "l2", "l3"]);
// 入れそうな人：その日入っていない・希望休ではない（余村慎は3日休み希望）。遅番の曜日の人が先
const c3 = S.candidates(month, cfg, "2026-11-03", "l");
assert.ok(!c3.includes("余村慎") && !c3.includes("横田") && !c3.includes("橋本"), c3.join());
assert.strictEqual(c3[0], "長島", "火曜が遅の長島が先");

// LINE文
const txt = S.lineText(month, cfg, ym, { groupName: "男性", withNames: true });
assert.ok(txt.startsWith("【11月のシフト（男性） 出勤のお願い】"), txt);
assert.ok(txt.includes("・11/3(火) 早③・遅①・遅②・遅③（入れそうな人："), txt);
assert.ok(!txt.includes("11/2(月)"), "埋まっている日は出さない");
assert.ok(txt.includes("出勤できる方は、日付と「早・遅」を返信してください。"));
assert.ok(!S.lineText(month, cfg, ym, {}).includes("入れそうな人"), "名前なしも選べる");
const full = { days: Object.fromEntries(S.daysOfMonth(ym).map((d) => [d, { e: { 1: { n: "a" }, 2: { n: "b" }, 3: { n: "c" } }, l: { 1: { n: "d" }, 2: { n: "e" }, 3: { n: "f" } } }])) };
assert.ok(S.lineText(full, cfg, ym, {}).includes("空いている枠はありません"));

// 希望休なのに入っている
month.days["2026-11-06"] = { e: { 1: { n: "近藤" } } };
assert.deepStrictEqual(S.conflicts(month, cfg, ym), [{ date: "2026-11-06", name: "近藤", wish: "PM休" }]);

// 基本パターンの下書き：空いている枠だけ埋める。入っている枠・希望休は守る
const dr = S.draft(month, cfg, ym);
assert.deepStrictEqual(dr.days["2026-11-02"], Object.assign({}, month.days["2026-11-02"], { e: month.days["2026-11-02"].e, l: month.days["2026-11-02"].l }), "埋まっていた日はそのまま");
assert.strictEqual(dr.days["2026-11-03"].e[1].n, "横田", "入っている枠は変えない");
assert.ok(!S.workers(dr, "2026-11-03").has("余村慎"), "希望休の日は入れない");
const wed = dr.days["2026-11-04"];   // 水曜の基本シフト（依頼者の表）：早①余村慎・②橋本・③横田、遅①橋本・②宮永・③長島
assert.deepStrictEqual(Object.values(wed.e).map((s) => s.n), ["余村慎", "橋本", "横田"], "基本シフトの番号どおり");
assert.deepStrictEqual(Object.values(wed.l).map((s) => s.n), ["橋本", "宮永", "長島"], "早・遅の橋本は両方に入る");
assert.strictEqual(S.patOf(cfg, cfg.members.find((m) => m.name === "橋本"), 3), "早・遅", "パターンは基本シフトから");
assert.strictEqual(S.patOf(cfg, cfg.members.find((m) => m.name === "近藤"), 3), "休");
// 基本の人が希望休 → その番号の枠は、その曜日のパターンが合う別の人（いなければ空き）
const m3 = { wish: { "宮永": { "2026-11-04": "休" } } }, dr3 = S.draft(m3, cfg, ym);
assert.ok(!S.workers(dr3, "2026-11-04").has("宮永"));
// 紙のシフト表（2026年11月・男性）を最初から入れておく。まだ保存していない月だけ
const nov = S.monthOf("m", "2026-11", null);
assert.deepStrictEqual(nov.days["2026-11-06"].e[2], { n: "余村慎", t: "6~9" });
assert.deepStrictEqual(nov.days["2026-11-06"].d, ["近藤(~13)", "宮永"], "日勤に時間を添えられる");
assert.strictEqual(nov.days["2026-11-03"].note, "開所日");
assert.strictEqual(S.holes(nov, cfg, ym).length, 0, "紙の表は全部埋まっている");
assert.deepStrictEqual(S.conflicts(nov, cfg, ym), [{ date: "2026-11-03", name: "余村慎", wish: "休" }], "PM休の近藤(~13)は時間つきなので希望どおり。余村慎の3日は紙でも希望休なのに6~9");
assert.deepStrictEqual(S.offList(nov, cfg, "2026-11-06"), ["横田", "長島", "橋本"]);
assert.strictEqual(S.wishSummary(nov, "近藤"), "6(金)・13(金)・20(金)・27(金)：PM休　22(日)：休");
assert.strictEqual(S.monthOf("m", "2026-12", null), null, "ほかの月は空から");
assert.strictEqual(S.monthOf("m", "2026-11", { days: {} }).days["2026-11-06"], undefined, "保存したものがあればそれを使う");
assert.ok(S.holes(dr, cfg, ym).length < S.holes(month, cfg, ym).length, "下書きで穴が減る");
// 長島が11/11(水)に希望休 → その日の遅③が空く（その日がLINE文に出る）
const m2 = JSON.parse(JSON.stringify(month)); m2.wish["長島"] = { "2026-11-11": "休" };
const dr2 = S.draft(m2, cfg, ym);
assert.deepStrictEqual(S.holes(dr2, cfg, ym).filter((h) => h.date === "2026-11-11").map((h) => h.kind + h.idx), ["l3"], "希望休で空いた枠が穴に残る");
assert.ok(S.lineText(dr2, cfg, ym, {}).includes("・11/11(水) 遅③"));

// 希望のまとめ（写真の「今月の希望休・希望勤務」）
assert.strictEqual(S.wishSummary(month, "近藤"), "6(金)・13(金)：PM休");
assert.strictEqual(S.wishSummary(month, "野津"), "13〜17日 休");
assert.strictEqual(S.wishSummary(month, "長島"), "なし");
console.log("shift OK", S.holes(dr, cfg, ym).length, "の穴が下書きのあとに残る");

// Excel（紙のシフト表と同じカレンダーの形）：題・曜日・各日の早遅・日勤・休み・空き・下の表
(async () => {
  const ExcelJS = require("./pw/node_modules/exceljs");
  const S2 = require("./shiftcore.js"), cfg2 = S2.cfgOf("m");
  let mo = S2.draft({ wish: { "秋山": { "2026-11-09": "休" } } }, cfg2, "2026-11");
  delete mo.days["2026-11-11"].l[3];   // 1つ空ける
  mo.days["2026-11-03"].e[3] = { n: "余村慎", t: "6~9" };
  const wb = S2.buildWorkbook(ExcelJS, mo, cfg2, "2026-11", "男性");
  const buf = await wb.xlsx.writeBuffer();
  require("fs").writeFileSync("pw/shift_sample.xlsx", Buffer.from(buf));
  const back = new ExcelJS.Workbook(); await back.xlsx.load(buf); const ws = back.worksheets[0];
  const txt = (c) => { const v = c.value; return v && v.richText ? v.richText.map((x) => x.text).join("") : String(v == null ? "" : v); };
  const all = []; ws.eachRow((row, r) => row.eachCell((c, col) => all.push({ r, col, t: txt(c) })));
  const find = (re) => all.find((x) => re.test(x.t));
  assert.strictEqual(txt(ws.getCell(1, 1)), "2026年11月　リベルタけやき坂とおり シフト表（男性職員）");
  assert.deepStrictEqual([1, 3, 5, 7, 9, 11, 13].map((c) => txt(ws.getCell(2, c))), ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"]);
  const d2 = find(/^2$/); assert.ok(d2 && d2.col === 3, "11/2は月曜の列");
  assert.strictEqual(txt(ws.getCell(d2.r + 1, 3)), "早①：橋本"); assert.strictEqual(txt(ws.getCell(d2.r + 3, 4)), "遅③：野津");
  assert.ok(find(/^早③：余村慎\(6~9\)$/), "時間の補足");
  const hole = find(/^遅③：空き$/); assert.ok(hole && ws.getCell(hole.r, hole.col).fill.fgColor.argb === "FFFEF3C7", "空きは黄色");
  assert.ok(find(/^休み：秋山、近藤、野津$/), "休みの行");
  assert.ok(find(/^日勤：/), "日勤の行");
  const pt = find(/^今月の希望休・希望勤務$/); assert.ok(pt);
  assert.ok(find(/^9\(月\)：休$/), "下の表に今月の希望");
  assert.strictEqual(ws.pageSetup.orientation, "landscape"); assert.strictEqual(ws.pageSetup.fitToWidth, 1); assert.strictEqual(ws.pageSetup.fitToHeight, 1, "A4横1枚に収める");
  assert.strictEqual(S2.fileName("2026-11", "男性"), "シフト表_男性_2026年11月.xlsx");
  console.log("shift excel OK");
})().catch((e) => { console.error(e); process.exit(1); });
