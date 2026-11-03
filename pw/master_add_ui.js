// ブラウザでGoogle版の画面を動かす：google.script.run を Node 側の模擬サーバーにつなぐ
const { chromium } = require("playwright");
const assert = require("assert");
const path = require("path"), fs = require("fs");
const { makeGas } = require("../gas/fakegas.js");
global.window = {}; global.SGKV = require("../kvsync.js");
const engFor = (ed) => { global.window = { __SG_EDITION: ed }; delete require.cache[require.resolve("../eng.cjs")]; return require("../eng.cjs"); };
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
  const yo = rows().find((r) => r[1] === "余村慎");
  const LOC = { "react.production.min.js": "node_modules/react/umd/react.production.min.js", "react-dom.production.min.js": "node_modules/react-dom/umd/react-dom.production.min.js", "three.min.js": "node_modules/three/build/three.min.js", "exceljs.min.js": "node_modules/exceljs/dist/exceljs.min.js" };
  const b = await chromium.launch();
  async function open(file, vp, boot, outName, extraInit) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: "light" }); const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text().slice(0, 200)); });
    await pg.exposeFunction("__gasApi", (tk, m, a) => api(tk, m, a));
    await pg.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { const h = m === "docs.query" && window.__HOLDQ; if (h) window.__QN = (window.__QN || 0) + 1; setTimeout(() => window.__gasApi(tk, m, a).then((r) => setTimeout(() => s && s(r), h || 0), (e) => f && f(e)), 30); } }; })() } }; });
    if (extraInit) await pg.addInitScript(extraInit);
    await pg.route("https://**/*", async (r) => { const u = r.request().url(); for (const k in LOC) if (u.endsWith(k)) return r.fulfill({ path: LOC[k], contentType: "application/javascript" }); return r.abort(); });
    const html = fs.readFileSync(path.join(D, file), "utf8").replace("/*__BOOT__*/", boot);
    const out = "g_" + (outName || file);   // 同じ画面を別の版で開くときは別の名前（開き直したときに混ざらない）
    fs.writeFileSync(path.join(__dirname, out), html);
    await pg.goto("file://" + path.join(__dirname, out)); return { pg, errs };
  }
  // 職員・車両・利用者の「＋ ○○を追加」：足した行はいちばん下（ボタンのすぐ上）に出て、名前の欄に入れる（2026-11-03 依頼者「利用者を追加ボタンが効かない」）
  const boot = 'window.__SG_EDITION="v2";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="2026-11-02";';
  // カレンダーの予定（特記事項の自動の欄を見るため。2026-11-03 依頼者）
  const mv2 = api(t, "kv.get", ["v2:master"]).data.value, uN = mv2.users[0].name, pS = mv2.staff.find((x) => x.emp === "パート" && !x.hideInPartList) || mv2.staff[0];
  const putEv = (id, ev) => { const r = api(t, "cal.apply", [{ kind: "upsert", opId: "op_" + id, id, baseRev: null, ev: Object.assign({ date: "2026-11-02", endDate: "2026-11-02", allDay: true, start: "", end: "", label: "other", place: "", memo: "", members: [] }, ev) }]); assert.ok(r && r.ok !== false && !r.error, "予定を入れる " + JSON.stringify(r).slice(0, 200)); };
  putEv("ev_note0001", { title: uN + " 通院", allDay: false, start: "10:00", end: "12:00" });
  putEv("ev_note0002", { title: pS.name + " PM休み", label: "leave", sg: { type: "staff_off", staff: [pS.name], half: "pm" } });
  putEv("ev_note0003", { title: "松養生高２女性 現場実習" });
  const P = await open("sougei.html", { width: 1400, height: 900 }, boot, "master_add.html");
  await P.pg.waitForTimeout(500); await P.pg.fill("#sghNo", "000"); await P.pg.fill("#sghPin", "5829"); await P.pg.click("#sghGo"); await P.pg.waitForTimeout(5000);
  const where = () => P.pg.evaluate(() => { const rs = [...document.querySelectorAll("[data-row-id]")], a = document.activeElement, r = a && a.closest("[data-row-id]"), b = r && r.getBoundingClientRect();
    return { n: rs.length, at: r ? rs.indexOf(r) : -2, val: a && a.value, inView: !!b && b.top >= 0 && b.bottom <= innerHeight }; });
  for (const [tab, btn, key] of [["利用者", "+ 利用者を追加", "users"], ["職員", "+ 職員を追加", "staff"], ["車両", "+ 車両を追加", "vehicles"]]) {
    await P.pg.click(`button:text-is("${tab}")`); await P.pg.waitForTimeout(500);
    const c0 = api(t, "kv.get", ["v2:master"]).data.value[key].length;
    await P.pg.click(`button:text-is("${btn}")`); await P.pg.waitForTimeout(800);
    const w = await where(); assert.ok(w.at === w.n - 1 && w.val === "" && w.inView, tab + "：足した行がいちばん下で名前の欄に入る " + JSON.stringify(w));
    await P.pg.keyboard.type("テスト" + tab); await P.pg.waitForTimeout(300);
    const w2 = await where(); await P.pg.keyboard.press("Tab"); await P.pg.waitForTimeout(800);   // 名前は欄を離れたときに入る
    const w3 = await P.pg.evaluate(() => { const rs = [...document.querySelectorAll("[data-row-id]")]; return { n: rs.length, last: (rs[rs.length - 1].querySelector("input") || {}).value }; });
    assert.ok(w3.last === "テスト" + tab, tab + "：名前を入れても行が動かない（いちばん下のまま） " + JSON.stringify(w3)); assert.ok(w2.at === w2.n - 1 && w2.val === "テスト" + tab, tab + "：名前を入れても行が動かない " + JSON.stringify(w2));
    await P.pg.waitForTimeout(2500);
    const m = api(t, "kv.get", ["v2:master"]).data.value[key]; assert.ok(m.length === c0 + 1 && m.some((x) => x.name === "テスト" + tab), tab + "：保存された " + c0 + " " + JSON.stringify(m.slice(-2).map((x) => x.name)));
    console.log(tab + "を追加：いちばん下に出て名前を入力・保存 OK");
  }
  { // 部署でしぼっているときは、その部署の人として足す（しぼりで見えなくならない）
    await P.pg.click('button:text-is("利用者")'); await P.pg.waitForTimeout(500);
    const ms = api(t, "kv.get", ["v2:master"]).data.value, d2 = ms.departments[1];
    const sel = P.pg.locator("select").filter({ has: P.pg.locator(`option[value="${d2.id}"]`) }).first(); await sel.selectOption(d2.id); await P.pg.waitForTimeout(400);
    await P.pg.click('button:text-is("+ 利用者を追加")'); await P.pg.waitForTimeout(3000);
    const w = await where(); assert.ok(w.at === w.n - 1 && w.val === "", "しぼっていても見える " + JSON.stringify(w));
    const nu = api(t, "kv.get", ["v2:master"]).data.value.users.slice(-1)[0]; assert.strictEqual(nu.deptId, d2.id, "しぼっている部署で足す");
    console.log("部署でしぼっていても：" + d2.name + "の利用者として足す OK"); }
  { // 特記事項：利用者の予定は利用者、職員の休みは職員、どちらでもないものは連絡事項（カレンダーから自動）
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(2500);
    await P.pg.click('button:has-text("特記事項・男性カバー・配車を表示")'); await P.pg.waitForTimeout(500);
    const tx = async (sel) => (await P.pg.locator(sel).count()) ? await P.pg.locator(sel).innerText() : "";
    const au = await tx("[data-auto-user]"), as = await tx("[data-auto-staff]"), ab = await tx("[data-auto-biz]");
    assert.ok(au.includes(uN + " 通院 10:00〜12:00") && !au.includes(pS.name), "利用者の欄 " + au);
    assert.ok(as.includes(pS.name + " PM休み") && !as.includes(uN + " 通院"), "職員の欄 " + as);
    assert.ok(ab.includes("松養生高２女性 現場実習"), "連絡事項 " + ab);
    const pt = await tx(`[data-part="${pS.id}"]`); if (pS.emp === "パート") assert.ok(pt && !pt.includes(pS.end), "パート職員の出欠にPM休の退勤 " + pt + " / いつも " + pS.end);
    console.log("特記事項（カレンダーから）：利用者「" + au.split("\n")[1] + "」 職員「" + as.split("\n")[1] + "」 連絡事項「" + ab.split("\n").slice(-1)[0] + "」 パート「" + pt + "」"); }
  assert.deepStrictEqual(P.errs.filter((e) => !/net::ERR_FAILED|favicon/.test(e)), [], "画面エラーなし");
  console.log("画面エラー: []");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
