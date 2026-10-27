// ブラウザでGoogle版の画面を動かす：google.script.run を Node 側の模擬サーバーにつなぐ
const { chromium } = require("playwright");
const assert = require("assert");
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
  // 一般職員：利用者が関わるラベル（ヘルプ・送迎・利用者休み）は選べない。休日出勤は自分の分だけ
  const dis = await pg.$$eval('input[name="f-label"]', (o) => o.filter((x) => x.disabled).map((x) => x.value));
  assert.deepStrictEqual(dis.sort(), ["help", "ride", "user"]);
  await pg.check("#f-label-hwork"); await pg.waitForTimeout(400);
  await pg.locator(".sgbox").screenshot({ path: "g_sgbox.png" });
  const self = await pg.locator(".sgbox .sgchip").innerText(); assert.ok(self.includes("余村慎"));
  assert.strictEqual(await pg.locator("#f-sgq-staff").count(), 0, "他人を選ぶ欄は出ない");
  await pg.click("[data-save]"); await pg.waitForTimeout(2500);
  console.log("一般職員が選べないラベル:", dis.join("/"), "/ 休日出勤の職員:", self);
  const m = api(t, "kv.get", ["master"]).data.value, s = api(t, "kv.get", ["sheet:" + date]).data.value; const sid = m.staff.find((x) => x.name === "余村慎").id;
  assert.ok(s.staffOv[sid].start && s.staffOv[sid].workToday, "AM休と休日出勤が送迎表に");
  console.log("スマホでAM休＋休日出勤 → 送迎表:", JSON.stringify(s.staffOv[sid]), "/ 画面エラー:", errs);
  const real = (a) => a.filter((x) => !/Failed to load resource/.test(x));   // 外部への通信はテストでは止めている（フォント・画像）
  assert.deepStrictEqual(real(errs), []);
  // 事務所PC：管理者が送迎表（現体制版）を開く
  const P = await open("sougei.html", { width: 1400, height: 900 }, boot);
  await P.pg.waitForTimeout(500); await P.pg.fill("#sghNo", "000"); await P.pg.fill("#sghPin", "5829"); await P.pg.click("#sghGo"); await P.pg.waitForTimeout(5000);
  await P.pg.screenshot({ path: "g_sougei.png" });
  console.log(await P.pg.evaluate(() => ({ react: !!window.React, root: document.getElementById("root").innerHTML.length, kv: !!window.__sgkv, setkv: typeof window.__sgSetKV, st: window.__sgkv && window.__sgkv.status() })));
  console.log("送迎表の表示:", (await P.pg.locator("text=/📅 カレンダー/").first().innerText().catch(() => "なし")), (await P.pg.locator('button[title="保存と同期の状況"]').innerText().catch(() => "なし")), "/ 画面エラー:", P.errs);
  // 管理者がカレンダーで「送迎」「ヘルプ」「利用者休み（迎えなし）」を入れる → 送迎表に便・ヘルプ・迎えなし
  const A = await open("calendar.html", { width: 390, height: 844 }, boot);
  await A.pg.waitForTimeout(500); await A.pg.fill("#sghNo", "000"); await A.pg.fill("#sghPin", "5829"); await A.pg.click("#sghGo"); await A.pg.waitForTimeout(2500);
  const pick = async (kind, name) => { await A.pg.fill("#f-sgq-" + kind, name); await A.pg.click(`[data-sgpick="${kind}"][data-name="${name}"]`); };
  const veh = m.vehicles[0].name;
  await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-ride"); await A.pg.waitForTimeout(300);
  await A.pg.check('input[name="w-kind"][value="other_run"]'); await A.pg.waitForTimeout(200);
  await pick("users", "森"); await pick("staff", "白戸"); await pick("staff", "吉岡");
  await A.pg.selectOption("#w-vehicle", veh); await A.pg.click('[data-fill="w-note"][data-v="通院"]');
  await A.pg.fill("#f-start", "09:30"); await A.pg.fill("#f-end", "10:30");
  await A.pg.locator(".sheet").screenshot({ path: "g_ride.png" });
  await A.pg.click("[data-save]"); await A.pg.waitForTimeout(1500);
  await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-help"); await A.pg.waitForTimeout(300);
  await pick("users", "中村"); await A.pg.click('[data-fill="w-note"][data-v="入浴"]'); await A.pg.fill("#f-start", "14:00"); await A.pg.fill("#f-end", "15:00");
  await A.pg.click("[data-save]"); await A.pg.waitForTimeout(1500);
  await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-user"); await A.pg.waitForTimeout(300);
  await pick("users", "森"); await A.pg.check('input[name="w-ukind"][value="change"]'); await A.pg.waitForTimeout(200);
  await A.pg.check('input[name="w-meet"][value="none"]'); await A.pg.waitForTimeout(200); await A.pg.click('[data-fill="w-reason"][data-v="受診"]');
  await A.pg.locator(".sheet").screenshot({ path: "g_user.png" });
  await A.pg.click("[data-save]"); await A.pg.waitForTimeout(1500);
  await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-shift"); await A.pg.waitForTimeout(300);
  await pick("staff", "八壁"); await A.pg.check('input[name="w-we"][value="time"]'); await A.pg.waitForTimeout(200);
  await A.pg.fill("#w-wet", "19:00"); await A.pg.click('[data-fill="w-reason"][data-v="残業"]');
  await A.pg.locator(".sheet").screenshot({ path: "g_shift.png" });
  await A.pg.click("[data-save]"); await A.pg.waitForTimeout(2500);
  const s2 = api(t, "kv.get", ["sheet:" + date]).data.value; const S = (n) => m.staff.find((x) => x.name === n).id, U = (n) => m.users.find((x) => x.name === n).id;
  const run = s2.runs.find((r) => r.calId);
  assert.ok(run && run.kind === "other_run" && run.time === "9:30" && run.staffId === S("白戸") && run.staffRiderIds[0] === S("吉岡") && run.vehicleId === m.vehicles[0].id && run.note === "通院", JSON.stringify(run));
  const hb = s2.blocks.find((x) => x.calId && x.kind === "help"); assert.ok(hb && hb.staffId === "__hold__" && hb.note === "入浴" && hb.time === "14:00");
  assert.strictEqual(s2.noRide[U("森")].meet, "受診");
  assert.strictEqual(s2.staffOv[S("八壁")].end, "19:00", "勤務時間変更");
  const titles = A.pg.locator(".ev-row .t"); const tl = await titles.allInnerTexts();
  assert.ok(tl.includes("森 送迎（通院）") && tl.includes("中村 ヘルプ（入浴）") && tl.includes("森 迎えなし（受診）") && tl.includes("八壁 退勤19:00（残業）"), tl.join(","));
  console.log("管理者が入力 →", tl.filter((x) => /送迎|ヘルプ|迎えなし|退勤/.test(x)).join(" / "), "→ 送迎表: 便", run.time, "・ヘルプ(保留欄)", hb.time, "・迎えなし", s2.noRide[U("森")].meet, "・八壁の退勤", s2.staffOv[S("八壁")].end, "/ 画面エラー:", A.errs);
  assert.deepStrictEqual(real(A.errs), []);
  // 送迎表を開き直す → カレンダーから入った便・ヘルプが表に出る（画面エラーなし）
  P.errs.length = 0; await P.pg.reload(); await P.pg.waitForTimeout(5000);   // ログインは端末に残っている
  await P.pg.screenshot({ path: "g_sougei_after.png", fullPage: true });
  const body = await P.pg.locator("#root").innerText(); assert.ok(body.includes("通院") && body.includes("入浴"), "送迎表に便・ヘルプが出る");
  console.log("送迎表を開き直す → 便（通院）・ヘルプ（入浴）が表に出る / 画面エラー:", real(P.errs));
  assert.deepStrictEqual(real(P.errs), []);
  await b.close();
})();
