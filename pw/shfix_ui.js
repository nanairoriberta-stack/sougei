// 2026-11-26 依頼者「変わってない」（12/4）：シフト表の予定が以前の書き方のままなら、カレンダーを見ただけで書き直す（shift.calFix）
// ブラウザでGoogle版の画面を動かす：google.script.run を Node 側の模擬サーバーにつなぐ
const { chromium } = require("playwright");
const assert = require("assert");
const path = require("path"), fs = require("fs");
const { makeGas } = require("../gas/fakegas.js");
global.window = {}; global.SGKV = require("../kvsync.js");
const engFor = (ed) => { global.window = { __SG_EDITION: ed }; delete require.cache[require.resolve("../eng.cjs")]; return require("../eng.cjs"); };
// ラベルは2段（2026-11-05）：1段目（職員／利用者／その他予定）を押してから2段目
const pickLabel = async (pg, k) => { const g = { leave: "staff", late: "staff", early: "staff", shift: "staff", hwork: "staff", sother: "staff", other: "other" }[k] || "user"; await pg.locator(`label:has(#f-grp-${g})`).click(); await pg.waitForTimeout(250); if (k !== "other") await pg.locator(`label:has(#f-label-${k})`).click(); };
const D = path.join(__dirname, "../gas/out");
(async () => {
  const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Lib5_shift.gs", "Code.gs"].map((f) => path.join(D, f))); g.ctx.setup();
  const api = (t, m, a) => JSON.parse(JSON.stringify(g.ctx.api(t, m, JSON.parse(JSON.stringify(a)))));
  const rows = () => g.sheets.get("職員ID").data.slice(1).filter((r) => r[0] !== "" && r[0] !== undefined);
  const pin0 = String(rows()[0][3]);
  let t = api("", "auth.login", ["000", pin0, "node"]).data.token; api(t, "auth.changePin", [pin0, "5829"]);
  const date = "2026-11-02";
  for (const ed of ["v1", "v2"]) { const E = engFor(ed), ns = ed === "v1" ? "" : "v2:"; const m = E.mergeSeedMaster(null, E.seedMaster()); api(t, "kv.cas", [{ key: ns + "master", rev: 0, value: m }]); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon); api(t, "kv.cas", [{ key: ns + "sheet:" + date, rev: 0, value: Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks }) }]); }
  { const m1 = api(t, "kv.get", ["master"]).data.value; api(t, "kv.cas", [{ key: "v3:master", rev: 0, value: { ...m1, users: [{ ...m1.users[0], id: "k_hoshino", name: "星野こども" }], staff: [...m1.staff.slice(0, 3), { ...m1.staff[0], id: "st_hd1", name: "放デイ太郎" }] } }]); }   // りんく・ぷれいす版（放課後デイ）の利用者・職員
  { const s0 = api(t, "kv.get", ["sheet:" + date]).data.value, m0 = api(t, "kv.get", ["master"]).data.value;   // その他予定「黒田給食利用」（コマだけ消すの試し）
    api(t, "kv.merge", [{ key: "sheet:" + date, base: s0, baseKnown: true, mine: { ...s0, blocks: [...s0.blocks, { id: "blkNote1", kind: "block", time: "12:00", staffId: m0.staff.find((x) => x.name === "八壁").id, label: "黒田給食利用", vehicleId: "" }] } }]); }
  { const E2 = engFor("v2"), m2 = api(t, "kv.get", ["v2:master"]).data.value; api(t, "kv.cas", [{ key: "v2:pattern:1", rev: 0, value: E2.resolveSeedPattern(m2, E2.SEED_PATTERNS.mon) }]); }   // 月曜の週間パターン（いつもの時刻・2026-11-12）
  const yo = rows().find((r) => r[1] === "余村慎");
  const LOC = { "react.production.min.js": "node_modules/react/umd/react.production.min.js", "react-dom.production.min.js": "node_modules/react-dom/umd/react-dom.production.min.js", "three.min.js": "node_modules/three/build/three.min.js", "exceljs.min.js": "node_modules/exceljs/dist/exceljs.min.js", "mammoth.browser.min.js": "node_modules/mammoth/mammoth.browser.min.js" };
  const b = await chromium.launch();
  async function open(file, vp, boot, outName, extraInit) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: "light" }); const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text().slice(0, 200)); });
    await pg.exposeFunction("__gasApi", (tk, m, a) => { const r = api(tk, m, a); return r; });
    await pg.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { if (m === "names.list" && window.__failNames) { setTimeout(() => f && f(new Error("テストの失敗")), 30); return; } const h = m === "docs.query" && window.__HOLDQ; if (h) window.__QN = (window.__QN || 0) + 1; setTimeout(() => window.__gasApi(tk, m, a).then((r) => setTimeout(() => s && s(r), h || 0), (e) => f && f(e)), 30); } }; })() } }; });
    if (extraInit) await pg.addInitScript(extraInit);
    await pg.route("https://**/*", async (r) => { const u = r.request().url(); for (const k in LOC) if (u.endsWith(k)) return r.fulfill({ path: LOC[k], contentType: "application/javascript" }); return r.abort(); });
    const html = fs.readFileSync(path.join(D, file), "utf8").replace("/*__BOOT__*/", boot);
    const out = "g_" + (outName || file);   // 同じ画面を別の版で開くときは別の名前（開き直したときに混ざらない）
    fs.writeFileSync(path.join(__dirname, out), html);
    await pg.goto("file://" + path.join(__dirname, out)); return { pg, errs };
  }

  const r0 = api(t, "cal.apply", [{ kind: "upsert", opId: "op_shold01", id: "shm20261103_old1", baseRev: null, ev: { title: "余村慎 早番③(6~9)", date: "2026-11-03", endDate: "2026-11-03", allDay: true, start: "", end: "", label: "sother", place: "", memo: "", members: [], tanto: ["余村慎"] } }]);
  assert.ok(r0.ok, "以前の書き方（職員その他・①つき）の予定を入れる");
  const ev3 = () => Object.values(api(t, "docs.query", [{ col: "days", from: "2026-11-03", to: "2026-11-03" }]).data.reduce((a2, d) => Object.assign(a2, d.events), {})).filter((e) => /^shm/.test(e.id)).map((e) => [e.id, e.title, e.label, !!e.sg, e.deleted]);
  assert.ok(!ev3().some((e) => e[3]), "まだ書き直していない");
  const A = await open("calendar.html", { width: 1280, height: 900 }, 'window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="2026-11-03";try{localStorage.setItem("sg:dGo",JSON.stringify({d:"2026-11-03",at:Date.now()}))}catch(e){}', "cal_shfix.html");
  await A.pg.waitForTimeout(800); if (await A.pg.locator("#sghNo").count()) { await A.pg.fill("#sghNo", "000"); await A.pg.fill("#sghPin", "5829"); await A.pg.click("#sghGo"); }
  await A.pg.waitForTimeout(8000);
  let ok = false; for (let i = 0; i < 30 && !ok; i++) { ok = ev3().some((e) => e[1] === "余村慎 早番(6~9)" && e[2] === "shift" && e[3] && !e[4]); if (!ok) await A.pg.waitForTimeout(500); }
  assert.ok(ok, "カレンダーを見ただけでシフト表の予定が職員時間変更に書き直される " + JSON.stringify(ev3()));
  assert.ok(ev3().some((e) => / 休み$/.test(e[1]) && e[2] === "leave" && e[3]), "休みは職員休み");
  assert.ok(ev3().filter((e) => !e[4] && e[0] !== "shm20261103_old1").every((e) => !/[①②③]/.test(e[1]) && e[3]), "番号なし・送迎表に反映");
  assert.deepStrictEqual(A.errs.filter((x) => !/Failed to load resource/.test(x)), [], "画面エラーなし");
  console.log("シフトの予定の書き直し（カレンダーを見ただけで）OK", ev3().length);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
