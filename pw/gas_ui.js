// ブラウザでGoogle版の画面を動かす：google.script.run を Node 側の模擬サーバーにつなぐ
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const { makeGas } = require("../gas/fakegas.js");
global.window = {}; global.SGKV = require("../kvsync.js");
const engFor = (ed) => { global.window = { __SG_EDITION: ed }; delete require.cache[require.resolve("../eng.cjs")]; return require("../eng.cjs"); };
const D = path.join(__dirname, "../gas/out");
(async () => {
  const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Code.gs"].map((f) => path.join(D, f))); g.ctx.setup();
  const api = (t, m, a) => JSON.parse(JSON.stringify(g.ctx.api(t, m, JSON.parse(JSON.stringify(a)))));
  const rows = () => g.sheets.get("職員ID").data.slice(1).filter((r) => r[0] !== "" && r[0] !== undefined);
  const pin0 = String(rows()[0][3]);
  let t = api("", "auth.login", ["000", pin0, "node"]).data.token; api(t, "auth.changePin", [pin0, "5829"]);
  const date = "2026-11-02";
  for (const ed of ["v1", "v2"]) { const E = engFor(ed), ns = ed === "v1" ? "" : "v2:"; const m = E.mergeSeedMaster(null, E.seedMaster()); api(t, "kv.cas", [{ key: ns + "master", rev: 0, value: m }]); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon); api(t, "kv.cas", [{ key: ns + "sheet:" + date, rev: 0, value: Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks }) }]); }
  const yo = rows().find((r) => r[1] === "余村慎");
  const LOC = { "react.production.min.js": "node_modules/react/umd/react.production.min.js", "react-dom.production.min.js": "node_modules/react-dom/umd/react-dom.production.min.js", "three.min.js": "node_modules/three/build/three.min.js" };
  const b = await chromium.launch();
  async function open(file, vp, boot) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: "light" }); const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text().slice(0, 200)); });
    await pg.exposeFunction("__gasApi", (tk, m, a) => api(tk, m, a));
    await pg.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { setTimeout(() => window.__gasApi(tk, m, a).then((r) => s && s(r), (e) => f && f(e)), 30); } }; })() } }; });
    await pg.route("https://**/*", async (r) => { const u = r.request().url(); for (const k in LOC) if (u.endsWith(k)) return r.fulfill({ path: LOC[k], contentType: "application/javascript" }); return r.abort(); });
    const html = fs.readFileSync(path.join(D, file), "utf8").replace("/*__BOOT__*/", boot);
    fs.writeFileSync(path.join(__dirname, "g_" + file), html);
    await pg.goto("file://" + path.join(__dirname, "g_" + file)); return { pg, errs };
  }
  // スマホ：余村慎がログインして AM休 を押す
  const boot = `window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="${date}";`;
  const { pg, errs } = await open("calendar.html", { width: 390, height: 844 }, boot);
  await pg.waitForTimeout(800); await pg.screenshot({ path: "g_login.png" });
  await pg.fill("#sghNo", yo[0]); await pg.fill("#sghPin", String(yo[3])); await pg.click("#sghGo"); await pg.waitForTimeout(800);
  await pg.fill("#sghOld", String(yo[3])); await pg.fill("#sghNew", "3871"); await pg.fill("#sghNew2", "3871"); await pg.click("#sghPinF .go"); await pg.waitForTimeout(2500);
  await pg.screenshot({ path: "g_cal.png" });
  await pg.selectOption('#qKind', 'am'); await pg.locator('.quick').screenshot({ path: 'g_quick.png' }); await pg.click('[data-quick]'); await pg.waitForTimeout(2500);
  await pg.screenshot({ path: "g_cal_after.png" });
  await pg.click("#addBtn"); await pg.waitForTimeout(400); await pg.screenshot({ path: "g_editor.png" });
  const opts = await pg.$$eval("#f-sgtype option", (o) => o.map((x) => x.textContent));
  await pg.selectOption("#f-sgtype", "staff_off"); await pg.waitForTimeout(400);
  await pg.locator(".sgbox").screenshot({ path: "g_sgbox.png" });
  console.log("一般職員の選択肢:", opts.join(" / "), "/ 他人を選ぶ欄:", await pg.locator("#f-sgq-staff").count());
  const m = api(t, "kv.get", ["master"]).data.value, s = api(t, "kv.get", ["sheet:" + date]).data.value; const sid = m.staff.find((x) => x.name === "余村慎").id;
  console.log("スマホでAM休 → 送迎表:", JSON.stringify(s.staffOv[sid]), "/ 画面エラー:", errs);
  // 事務所PC：管理者が送迎表（現体制版）を開く
  const P = await open("sougei.html", { width: 1400, height: 900 }, boot);
  await P.pg.waitForTimeout(500); await P.pg.fill("#sghNo", "000"); await P.pg.fill("#sghPin", "5829"); await P.pg.click("#sghGo"); await P.pg.waitForTimeout(5000);
  await P.pg.screenshot({ path: "g_sougei.png" });
  console.log(await P.pg.evaluate(() => ({ react: !!window.React, root: document.getElementById("root").innerHTML.length, kv: !!window.__sgkv, setkv: typeof window.__sgSetKV, st: window.__sgkv && window.__sgkv.status() })));
  console.log("送迎表の表示:", (await P.pg.locator("text=/📅 カレンダー/").first().innerText().catch(() => "なし")), (await P.pg.locator('button[title="保存と同期の状況"]').innerText().catch(() => "なし")), "/ 画面エラー:", P.errs);
  await b.close();
})();
