// スマホの見え方の確認用：カレンダーを iPhone 相当(390x844)・小さい機種(360x740)で開いて、主な画面を撮る
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const { makeGas } = require("../gas/fakegas.js");
global.window = {}; global.SGKV = require("../kvsync.js");
const engFor = (ed) => { global.window = { __SG_EDITION: ed }; delete require.cache[require.resolve("../eng.cjs")]; return require("../eng.cjs"); };
const D = path.join(__dirname, "../gas/out");
const OUT = process.argv[2] || __dirname;
(async () => {
  const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Code.gs"].map((f) => path.join(D, f))); g.ctx.setup();
  const api = (t, m, a) => JSON.parse(JSON.stringify(g.ctx.api(t, m, JSON.parse(JSON.stringify(a)))));
  const rows = () => g.sheets.get("職員ID").data.slice(1).filter((r) => r[0] !== "" && r[0] !== undefined);
  const pin0 = String(rows()[0][3]);
  let t = api("", "auth.login", ["000", pin0, "node"]).data.token; api(t, "auth.changePin", [pin0, "5829"]);
  const date = "2026-11-02";
  const E = engFor("v1"); const m = E.mergeSeedMaster(null, E.seedMaster()); api(t, "kv.cas", [{ key: "master", rev: 0, value: m }]);
  // 見本の予定（いろいろなラベル・長い題名）
  const ev = (id, o) => api(t, "cal.apply", [{ kind: "upsert", opId: "op_" + id, id: "ev_" + id, baseRev: null, ev: Object.assign({ date, endDate: date, allDay: true, start: "", end: "", place: "", memo: "", members: [] }, o) }]);
  ev("a0000001", { title: "八壁 休み", label: "leave", sg: { type: "staff_off", staff: ["八壁"] } });
  ev("a0000002", { title: "日野 AM休", label: "leave", sg: { type: "staff_off", staff: ["日野"], half: "am" } });
  ev("a0000003", { title: "森 受診後送り・送り15:30・送り先病院", label: "ride", sg: { type: "user_time", users: ["森"], noMeet: "受診後送り", send: "15:30", sendPlace: "病院" } });
  ev("a0000004", { title: "白戸 ヘルプ（中村）", label: "help", allDay: false, start: "14:00", end: "15:00", sg: { type: "help", staff: ["白戸"], users: ["中村"], note: "中村" } });
  ev("a0000005", { title: "モニタリング（森）", label: "monitor", allDay: false, start: "13:30", end: "14:30", place: "自宅", sg: { type: "staff_plan", staff: ["日野"], users: ["森"] } });
  ev("a0000006", { title: "全体会議（今月の振り返りと来月の送迎体制について）", label: "other", allDay: false, start: "17:30", end: "18:30", place: "2階 会議室", tanto: ["八壁", "日野", "白戸"] });
  ev("a0000007", { title: "吉岡 退勤19:00（残業）", label: "shift", sg: { type: "shift", staff: ["吉岡"], wend: "19:00" } });
  ev("a0000008", { title: "支援会議（中村）", label: "shien", date: "2026-11-05", endDate: "2026-11-05", allDay: false, start: "10:00", end: "11:00", sg: { type: "staff_plan", staff: ["白戸"], users: ["中村"] } });
  ev("a0000009", { title: "成相 欠席（体調不良）", label: "user", date: "2026-11-04", endDate: "2026-11-06", sg: { type: "user_absent", users: ["成相"], reason: "体調不良" } });
  for (let i = 0; i < 4; i++) ev("b000000" + i, { title: ["石原 休み", "村松 PM休", "久保田 休日出勤", "池田 休み"][i], label: ["leave", "leave", "hwork", "leave"][i], date: "2026-11-1" + (i + 1), endDate: "2026-11-1" + (i + 1) });
  const LOC = { "react.production.min.js": "node_modules/react/umd/react.production.min.js", "react-dom.production.min.js": "node_modules/react-dom/umd/react-dom.production.min.js", "three.min.js": "node_modules/three/build/three.min.js" };
  const b = await chromium.launch();
  for (const [vw, vh, tag] of [[390, 844, "390"], [360, 740, "360"]]) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" }); const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
    await pg.exposeFunction("__gasApi", (tk, mm, a) => api(tk, mm, a));
    await pg.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { setTimeout(() => window.__gasApi(tk, m, a).then((r) => s && s(r), (e) => f && f(e)), 20); } }; })() } }; });
    await pg.route("https://**/*", async (r) => { const u = r.request().url(); for (const k in LOC) if (u.endsWith(k)) return r.fulfill({ path: LOC[k], contentType: "application/javascript" }); return r.abort(); });
    const boot = `window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="${date}";`;
    const html = fs.readFileSync(path.join(D, "calendar.html"), "utf8").replace("/*__BOOT__*/", boot);
    fs.writeFileSync(path.join(__dirname, "m_calendar.html"), html);
    await pg.goto("file://" + path.join(__dirname, "m_calendar.html")); await pg.waitForTimeout(600);
    await pg.screenshot({ path: `${OUT}/${tag}_0login.png` });
    await pg.fill("#sghNo", "000"); await pg.fill("#sghPin", "5829"); await pg.click("#sghGo"); await pg.waitForTimeout(2500);
    const sw = async (n) => { const w = await pg.evaluate(() => document.documentElement.scrollWidth); console.log(tag, n, "横幅", w, w > vw ? "← はみ出し" : ""); };
    await pg.screenshot({ path: `${OUT}/${tag}_1top.png` }); await sw("最初");
    await pg.screenshot({ path: `${OUT}/${tag}_2full.png`, fullPage: true });
    await pg.click("#addBtn"); await pg.waitForTimeout(400); await pg.screenshot({ path: `${OUT}/${tag}_3editor.png` }); await sw("新しい予定");
    await pg.check("#f-label-ride"); await pg.waitForTimeout(300); await pg.screenshot({ path: `${OUT}/${tag}_4ride.png`, fullPage: false }); await sw("送迎");
    await pg.keyboard.press("Escape"); await pg.waitForTimeout(300);
    await pg.click("#syncBtn"); await pg.waitForTimeout(400); await pg.screenshot({ path: `${OUT}/${tag}_5sync.png` }); await sw("同期");
    await pg.keyboard.press("Escape"); await pg.waitForTimeout(300);
    await pg.click(".sgh-chip"); await pg.waitForTimeout(300); await pg.screenshot({ path: `${OUT}/${tag}_6menu.png` });
    console.log(tag, "画面エラー", errs);
    // 送迎表（スマホで開いたとき）
    const html2 = fs.readFileSync(path.join(D, "sougei.html"), "utf8").replace("/*__BOOT__*/", boot);
    fs.writeFileSync(path.join(__dirname, "m_sougei.html"), html2);
    await pg.goto("file://" + path.join(__dirname, "m_sougei.html")); await pg.waitForTimeout(5000);
    await pg.screenshot({ path: `${OUT}/${tag}_7sougei.png` }); await sw("送迎表");
    await ctx.close();
  }
  await b.close();
})();
