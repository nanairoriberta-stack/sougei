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
  // バックアップから復元（2026-11-03 依頼者：TimeTreeの予定をカレンダーに入れる。out_zip のファイルと同じ形を作って試す）
  // 読み直しでバックアップの欄を開き直しても「復元する」が消えない・同じファイルを2回入れても二重にならない
  const C = require("../calcore.js");
  const evs = [["tt20261112_01", "2026-11-12", "", "", "石原休み"], ["tt20261112_07", "2026-11-12", "10:00", "12:00", "松浦通院"], ["tt20261113_11", "2026-11-13", "09:30", "10:30", "山崎　９時30分更生センターお迎え"]]
    .map(([id, date, start, end, title]) => C.normEvent({ title, date, start, end, allDay: !start, label: "other", memo: "TimeTreeから写しました", rev: 1 }, id, 0));
  const buf = Buffer.from(JSON.stringify({ app: "team-calendar", schema: C.SCHEMA, events: evs, comments: {} }));
  const boot = 'window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="2026-11-12";';
  const A = await open("calendar.html", { width: 1200, height: 900 }, boot, "restore_cal.html");
  await A.pg.waitForTimeout(500); await A.pg.fill("#sghNo", "000"); await A.pg.fill("#sghPin", "5829"); await A.pg.click("#sghGo"); await A.pg.waitForTimeout(2500);
  const restore = async () => {
    if (!(await A.pg.locator("#bkSlot").isVisible())) { await A.pg.click("#syncBtn"); await A.pg.waitForTimeout(500); }
    await A.pg.locator("#restoreFile").setInputFiles({ name: "tt.json", mimeType: "application/json", buffer: buf });
    await A.pg.waitForSelector("[data-restore-go]", { timeout: 15000 });
    const msg = await A.pg.locator("#bkSlot").innerText();
    if (await A.pg.locator("[data-restore-go]:not([disabled])").count()) { await A.pg.click("[data-restore-go]"); await A.pg.waitForTimeout(6000);
      assert.ok((await A.pg.locator("#bkSlot").innerText()).includes("復元を始めました"), "読み直しても欄が消えない"); }
    return msg; };
  const api0 = g.ctx.api; let nq = 0; g.ctx.api = (tk, m, a) => { if (m === "docs.query") nq++; return api0(tk, m, a); };
  const m1 = await restore(); assert.ok(m1.includes("サーバーにない予定 3件"), m1);
  assert.ok(nq <= 6, "ファイルの予定がある期間だけ読む（以前は4年分で32回） " + nq); console.log("復元の読み込み回数:", nq);
  const r = api(t, "cal.search", [{ q: "松浦通院" }]).data.items; assert.ok(r.length === 1 && r[0].start === "10:00" && r[0].label === "other", JSON.stringify(r));
  assert.strictEqual(api(t, "cal.search", [{ q: "更生センター" }]).data.items.length, 1);
  const m2 = await restore(); assert.ok(m2.includes("サーバーにない予定 0件"), "2回目は0件（二重にならない） " + m2);
  assert.strictEqual(api(t, "cal.search", [{ q: "松浦通院" }]).data.items.length, 1, "二重に入らない");
  { // 名前を選ぶとき、部署ごとにまとめて出す（嫁島／ 八壁・井川…。2026-11-04 依頼者）
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(300);
    await A.pg.click("#addBtn"); await A.pg.waitForTimeout(400);
    await A.pg.locator("label:has(#f-label-leave)").click(); await A.pg.waitForTimeout(300);
    await A.pg.focus("#f-sgq-staff"); await A.pg.waitForTimeout(1500);
    const heads = await A.pg.$$eval("#sghits-staff .sghd", (x) => x.map((e) => e.textContent));
    assert.ok(heads.length >= 3 && heads[0] === "嫁島", "部署の見出し（嫁島から） " + JSON.stringify(heads));
    const under = await A.pg.evaluate(() => { const out = {}; let cur = ""; for (const el of document.querySelectorAll("#sghits-staff > *")) { if (el.classList.contains("sghd")) cur = el.textContent; else (out[cur] = out[cur] || []).push(el.dataset.name); } return out; });
    const mv = api(t, "kv.get", ["v2:master"]).data.value, yome = mv.departments.find((d) => d.name === "嫁島");
    const y1 = mv.staff.find((s) => s.deptId === yome.id && (under["嫁島"] || []).includes(s.name));
    assert.ok(y1, "嫁島の見出しの下に嫁島の職員 " + JSON.stringify((under["嫁島"] || []).slice(0, 5)));
    await A.pg.fill("#f-sgq-staff", "八壁"); await A.pg.waitForTimeout(400);
    assert.strictEqual(await A.pg.locator("#sghits-staff [data-sgpick]").first().getAttribute("data-name"), "八壁", "入力すると合う人が先頭");
    console.log("名前の選択：部署ごと", heads.slice(0, 5).join("／"), "… 嫁島：", (under["嫁島"] || []).slice(0, 3).join("・"));
    // 利用者の名前も部署ごと
    await A.pg.locator("label:has(#f-label-user)").click(); await A.pg.waitForTimeout(300);
    await A.pg.focus("#f-sgq-users"); await A.pg.waitForTimeout(800);
    const uh = await A.pg.$$eval("#sghits-users .sghd", (x) => x.map((e) => e.textContent));
    assert.ok(uh.length >= 3 && uh[0] === "嫁島", "利用者も部署の見出し " + JSON.stringify(uh));
    console.log("利用者の選択：部署ごと", uh.slice(0, 5).join("／"));
    await A.pg.keyboard.press("Escape"); }
  assert.deepStrictEqual(A.errs.filter((e) => !/net::ERR_FAILED|favicon/.test(e)), [], "画面エラーなし");
  console.log("バックアップから復元：3件 → 2回目は0件 / 画面エラー: []");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
