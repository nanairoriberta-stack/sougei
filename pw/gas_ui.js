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
  await pg.fill("#sghOld", String(yo[3])); await pg.fill("#sghNew", "3871"); await pg.fill("#sghNew2", "3871");
  await pg.evaluate(() => { const f = document.getElementById("sghPinF"); f.requestSubmit(); f.requestSubmit(); });   // 2回押し（Enterとクリック）でもエラーにならない await pg.waitForTimeout(2500);
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
  await pg.fill("#f-start", "09:00"); await pg.fill("#f-end", "17:00");      // 休日出勤は時間を入れる
  await pg.click("[data-save]"); await pg.waitForTimeout(2500);
  console.log("一般職員が選べないラベル:", dis.join("/"), "/ 休日出勤の職員:", self);
  const m = api(t, "kv.get", ["master"]).data.value, s = api(t, "kv.get", ["sheet:" + date]).data.value; const sid = m.staff.find((x) => x.name === "余村慎").id;
  assert.ok(s.staffOv[sid].workToday && s.staffOv[sid].start === "9:00" && s.staffOv[sid].end === "17:00", "休日出勤（時間）が送迎表に");
  console.log("スマホでAM休＋休日出勤 → 送迎表:", JSON.stringify(s.staffOv[sid]), "/ 画面エラー:", errs);
  const real = (a) => a.filter((x) => !/Failed to load resource/.test(x));   // 外部への通信はテストでは止めている（フォント・画像）
  assert.deepStrictEqual(real(errs), []);
  // 事務所PC：管理者が送迎表（現体制版）を開く
  const P = await open("sougei.html", { width: 1400, height: 900 }, boot);
  await P.pg.waitForTimeout(500); await P.pg.fill("#sghNo", "000"); await P.pg.fill("#sghPin", "5829"); await P.pg.click("#sghGo"); await P.pg.waitForTimeout(5000);
  await P.pg.screenshot({ path: "g_sougei.png" });
  console.log(await P.pg.evaluate(() => ({ react: !!window.React, root: document.getElementById("root").innerHTML.length, kv: !!window.__sgkv, setkv: typeof window.__sgSetKV, st: window.__sgkv && window.__sgkv.status() })));
  console.log("送迎表の表示:", (await P.pg.locator("text=/📅 カレンダー/").first().innerText().catch(() => "なし")), (await P.pg.locator('button[title="保存と同期の状況"]').innerText().catch(() => "なし")), "/ 画面エラー:", P.errs);
  // 管理者がカレンダーで「送迎」「ヘルプ」「利用者休み」「勤務時間変更」「その他予定」を入れる → 送迎表に反映
  const A = await open("calendar.html", { width: 390, height: 844 }, boot);
  await A.pg.waitForTimeout(500); await A.pg.fill("#sghNo", "000"); await A.pg.fill("#sghPin", "5829"); await A.pg.click("#sghGo"); await A.pg.waitForTimeout(2500);
  const pick = async (kind, name) => { await A.pg.fill("#f-sgq-" + kind, name); await A.pg.click(`[data-sgpick="${kind}"][data-name="${name}"]`); };
  const add = async (label) => { await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-" + label); await A.pg.waitForTimeout(300); };
  const save = async (ms) => { await A.pg.click("[data-save]"); await A.pg.waitForTimeout(ms || 1500); };
  // 送迎：迎えは「受診後送り」、送りは時間変更
  await add("ride"); assert.strictEqual(await A.pg.locator("#f-title").count(), 0, "その他予定以外はタイトルの欄なし"); await pick("users", "森");
  const meetOpts = await A.pg.$$eval('input[name="w-meet"]', (o) => o.map((x) => x.parentElement.innerText));
  const sendOpts = await A.pg.$$eval('input[name="w-send"]', (o) => o.map((x) => x.parentElement.innerText));
  assert.deepStrictEqual(meetOpts, ["いつもどおり", "時間変更", "家族送り", "受診後送り"]); assert.deepStrictEqual(sendOpts, ["いつもどおり", "時間変更", "家族迎え"]);
  await A.pg.check('input[name="w-meet"][value="clinic"]'); await A.pg.waitForTimeout(200);
  await A.pg.check('input[name="w-send"][value="time"]'); await A.pg.waitForTimeout(200); await A.pg.fill("#w-sendt", "15:30");
  assert.strictEqual(await A.pg.locator("#w-mplace").count(), 0, "受診後送りのときは迎え先の欄を出さない");
  await A.pg.fill("#w-splace", "病院");
  await A.pg.locator(".sheet").screenshot({ path: "g_ride.png" }); await save();
  // ヘルプ：担当・開始時刻・行き先（終了の時刻は出ない）
  await add("help"); assert.strictEqual(await A.pg.locator("#f-sgq-staff").count(), 0, "ヘルプに職員の欄はない"); await pick("users", "中村"); await A.pg.fill("#w-dest", "○○病院"); await A.pg.fill("#f-start", "14:00");
  assert.ok(await A.pg.locator("#w-end").isHidden(), "ヘルプは開始時刻だけ");
  await A.pg.locator(".sheet").screenshot({ path: "g_help.png" }); await save();
  // 利用者休み：欠席（理由つき）
  const absent = m.users.find((u) => !["森", "中村"].includes(u.name) && u.name.length >= 2).name;
  await add("user"); await pick("users", absent); await A.pg.click('[data-fill="w-reason"][data-v="体調不良"]'); await save();
  // 職員休みは理由の欄なし
  await add("leave"); assert.strictEqual(await A.pg.locator("#w-reason").count(), 0, "職員休みに理由の欄はない"); await A.pg.click("[data-close]"); await A.pg.waitForTimeout(300);
  // 勤務時間変更
  await add("shift"); await pick("staff", "八壁"); await A.pg.check('input[name="w-we"][value="time"]'); await A.pg.waitForTimeout(200);
  await A.pg.fill("#w-wet", "19:00"); await A.pg.click('[data-fill="w-reason"][data-v="残業"]');
  await A.pg.locator(".sheet").screenshot({ path: "g_shift.png" }); await save();
  // その他予定：時間・場所・担当
  await add("other"); assert.strictEqual(await A.pg.locator("#f-title").count(), 1, "その他予定はタイトルあり"); await A.pg.fill("#f-title", "会議"); await A.pg.fill("#f-start", "13:00"); await A.pg.fill("#f-end", "14:00"); await A.pg.fill("#f-place", "2階"); await pick("staff", "日野");
  await A.pg.locator(".sheet").screenshot({ path: "g_other.png" }); await save(2500);
  // モニタリング：利用者・時間・場所・対応者
  await add("monitor"); await pick("users", "森"); await pick("staff", "日野"); await A.pg.fill("#f-start", "13:30"); await A.pg.fill("#f-end", "14:30"); await A.pg.fill("#f-place", "自宅");
  await A.pg.locator(".sheet").screenshot({ path: "g_monitor.png" }); await save(2500);
  const s2 = api(t, "kv.get", ["sheet:" + date]).data.value; const S = (n) => m.staff.find((x) => x.name === n).id, U = (n) => m.users.find((x) => x.name === n).id;
  assert.strictEqual(s2.noRide[U("森")].meet, "受診後送り"); assert.strictEqual(s2.userTime[U("森")].send, "15:30");
  { const sr = s2.runs.find((r) => r.kind === "send" && r.userIds.includes(U("森"))); assert.ok(!sr || sr.places[U("森")] === "病院", "送り先（便に入っていれば）"); console.log("送り先:", sr ? sr.places[U("森")] : "（まだ便なし）"); }
  const hb = s2.blocks.find((x) => x.calId && x.kind === "help"); assert.ok(hb && hb.staffId === "__hold__" && hb.label === "中村" && hb.note === "○○病院" && hb.time === "14:00", JSON.stringify(hb));
  assert.strictEqual(s2.userAbsent[U(absent)], true, "欠席");
  assert.strictEqual(s2.staffOv[S("八壁")].end, "19:00", "勤務時間変更");
  const evs = Object.values(api(t, "docs.query", [{ col: "days", from: date, to: date }]).data).flatMap((d) => Object.values(d.events || {}));
  const mt = evs.find((e) => e.title === "会議"); assert.ok(mt && mt.place === "2階" && mt.tanto[0] === "日野" && !mt.sg, "その他予定：場所・担当（送迎表には載せない）");
  assert.ok(s2.blocks.some((x) => x.calId && x.kind === "block" && x.staffId === S("日野") && x.label === "モニタリング（森）" && x.time === "13:30"), "モニタリング → 対応者の予定");
  const tl = await A.pg.locator(".ev-row .t").allInnerTexts();
  for (const x of ["森 受診後送り・送り15:30・送り先病院", "中村 ヘルプ（○○病院）", `${absent} 欠席（体調不良）`, "八壁 退勤19:00（残業）", "会議", "モニタリング（森）"]) assert.ok(tl.includes(x), x + " / " + tl.join(","));
  assert.ok((await A.pg.locator(".ev-row", { hasText: "会議" }).innerText()).includes("担当：日野"), "一覧に担当");
  console.log("管理者が入力 →", tl.join(" / "), "→ 送迎表: 迎え", s2.noRide[U("森")].meet, "・送り", s2.userTime[U("森")].send, "・ヘルプ(保留欄)", hb.time, "・欠席", absent, "・八壁の退勤", s2.staffOv[S("八壁")].end, "/ 画面エラー:", real(A.errs));
  assert.deepStrictEqual(real(A.errs), []);
  // 送迎表を開き直す → カレンダーから入った便・ヘルプが表に出る（画面エラーなし）
  P.errs.length = 0; await P.pg.reload(); await P.pg.waitForTimeout(5000);   // ログインは端末に残っている
  await P.pg.screenshot({ path: "g_sougei_after.png", fullPage: true });
  const body = await P.pg.locator("#root").innerText(); assert.ok(body.includes("受診後送り") && body.includes("中村"), "送迎表に受診後送り・ヘルプが出る");
  console.log("送迎表を開き直す → 森(受診後送り)・ヘルプ（中村）が表に出る / 画面エラー:", real(P.errs));
  assert.deepStrictEqual(real(P.errs), []);
  // 動作の確認画面（?page=check）：全部 ✓ になる。普段の画面でエラーが出たら、画面の下に理由が出る
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage();
    await pg.exposeFunction("__gasCall", (fn, a) => JSON.parse(JSON.stringify(fn === "api" ? g.ctx.api(...a) : g.ctx[fn](...a))));
    await pg.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { const o = { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x) };
      for (const n of ["api", "checkServer"]) o[n] = (...a) => { setTimeout(() => window.__gasCall(n, a).then((r) => s && s(r), (e) => f && f(e)), 20); }; return o; })() } }; });
    await pg.route("https://**/*", async (r) => { const u = r.request().url(); for (const k in LOC) if (u.endsWith(k)) return r.fulfill({ path: LOC[k], contentType: "application/javascript" }); return r.abort(); });
    fs.writeFileSync(path.join(__dirname, "c_check.html"), g.ctx.doGet({ parameter: { page: "check" } }).getContent());
    await pg.goto("file://" + path.join(__dirname, "c_check.html")); await pg.waitForTimeout(1500);
    const items = await pg.locator("li").allInnerTexts(); await pg.screenshot({ path: "g_check.png", fullPage: true });
    const bad = items.filter((x) => x.startsWith("✗") || x.startsWith("…"));
    assert.deepStrictEqual(bad, [], "確認画面がすべて ✓"); assert.ok(items.some((x) => x.includes("sougei") && x.includes("文字")));
    console.log("確認画面:", items.map((x) => x.split("\n")[0]).join(" / "));
    await pg.goto("file://" + path.join(__dirname, "g_calendar.html")); await pg.waitForTimeout(800);
    await pg.evaluate(() => setTimeout(() => { throw new Error("テストのエラー"); }, 0)); await pg.waitForTimeout(300);
    const box = await pg.locator("text=画面でエラーが出ました").first().innerText(); assert.ok(box.includes("テストのエラー"), box);
    console.log("エラーの表示:", box.replace(/\n/g, " "));
    await ctx.close();
  }
  await b.close();
})();
