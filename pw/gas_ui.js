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
  { const m1 = api(t, "kv.get", ["master"]).data.value; api(t, "kv.cas", [{ key: "v3:master", rev: 0, value: { ...m1, users: [{ ...m1.users[0], id: "k_hoshino", name: "星野こども" }], staff: m1.staff.slice(0, 3) } }]); }   // りんく・ぷれいす版（放課後デイ）の利用者
  { const s0 = api(t, "kv.get", ["sheet:" + date]).data.value, m0 = api(t, "kv.get", ["master"]).data.value;   // その他予定「黒田給食利用」（コマだけ消すの試し）
    api(t, "kv.merge", [{ key: "sheet:" + date, base: s0, baseKnown: true, mine: { ...s0, blocks: [...s0.blocks, { id: "blkNote1", kind: "block", time: "12:00", staffId: m0.staff.find((x) => x.name === "八壁").id, label: "黒田給食利用", vehicleId: "" }] } }]); }
  const yo = rows().find((r) => r[1] === "余村慎");
  const LOC = { "react.production.min.js": "node_modules/react/umd/react.production.min.js", "react-dom.production.min.js": "node_modules/react-dom/umd/react-dom.production.min.js", "three.min.js": "node_modules/three/build/three.min.js" };
  const b = await chromium.launch();
  async function open(file, vp, boot, outName) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: "light" }); const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text().slice(0, 200)); });
    await pg.exposeFunction("__gasApi", (tk, m, a) => api(tk, m, a));
    await pg.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { setTimeout(() => window.__gasApi(tk, m, a).then((r) => s && s(r), (e) => f && f(e)), 30); } }; })() } }; });
    await pg.route("https://**/*", async (r) => { const u = r.request().url(); for (const k in LOC) if (u.endsWith(k)) return r.fulfill({ path: LOC[k], contentType: "application/javascript" }); return r.abort(); });
    const html = fs.readFileSync(path.join(D, file), "utf8").replace("/*__BOOT__*/", boot);
    const out = "g_" + (outName || file);   // 同じ画面を別の版で開くときは別の名前（開き直したときに混ざらない）
    fs.writeFileSync(path.join(__dirname, out), html);
    await pg.goto("file://" + path.join(__dirname, out)); return { pg, errs };
  }
  // スマホ：余村慎がログインして AM休 を押す
  const boot = `window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="${date}";`;
  const { pg, errs } = await open("calendar.html", { width: 390, height: 844 }, boot);
  await pg.waitForTimeout(800); await pg.screenshot({ path: "g_login.png" });
  await pg.fill("#sghNo", yo[0]); await pg.fill("#sghPin", String(yo[3])); await pg.click("#sghGo"); await pg.waitForTimeout(800);
  await pg.fill("#sghOld", String(yo[3])); await pg.fill("#sghNew", "3871"); await pg.fill("#sghNew2", "3871");
  await pg.evaluate(() => { const f = document.getElementById("sghPinF"); f.requestSubmit(); f.requestSubmit(); });   // 2回押し（Enterとクリック）でもエラーにならない await pg.waitForTimeout(2500);
  await pg.screenshot({ path: "g_cal.png" });
  await pg.selectOption("#qKind", "am"); await pg.locator('.quick').screenshot({ path: 'g_quick.png' }); await pg.click('[data-quick]'); await pg.waitForTimeout(2500);
  await pg.screenshot({ path: "g_cal_after.png" });
  await pg.click("#addBtn"); await pg.waitForTimeout(400); await pg.screenshot({ path: "g_editor.png" });
  // 一般職員：利用者が関わるラベル（ヘルプ・送迎・利用者休み）は選べない。休日出勤は自分の分だけ
  const dis = await pg.$$eval('input[name="f-label"]', (o) => o.filter((x) => x.disabled).map((x) => x.value));
  assert.deepStrictEqual(dis.sort(), ["extra", "help", "ride", "user"]);
  await pg.check("#f-label-hwork"); await pg.waitForTimeout(400);
  await pg.locator(".sgbox").screenshot({ path: "g_sgbox.png" });
  const self = await pg.locator(".sgbox .sgchip").innerText(); assert.ok(self.includes("余村慎"));
  assert.strictEqual(await pg.locator("#f-sgq-staff").count(), 0, "他人を選ぶ欄は出ない");
  await pg.fill("#f-start", "09:00"); await pg.fill("#f-end", "17:00");      // 休日出勤は時間を入れる
  // スマホ：打っている間は下の帯を隠し、保存は右上（TimeTreeのように）
  assert.ok(await pg.evaluate(() => document.documentElement.classList.contains("kb")), "入力中の印");
  assert.ok(await pg.locator(".sheet-foot").isHidden(), "入力中は下の帯を隠す");
  assert.ok(await pg.locator("[data-hsave]").isVisible(), "右上に保存");
  await pg.click("[data-hsave]"); await pg.waitForTimeout(2500);
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
  // 日付ボタンの📅：カレンダーはボタンのすぐ下・左そろえに出る。日を押すとその日に
  { await P.pg.click("[data-datepop]"); await P.pg.waitForTimeout(200);
    const r = await P.pg.evaluate(() => { const b = document.querySelector("[data-datepop]").getBoundingClientRect(), p = document.querySelector('[aria-label="日付を選ぶ"]').getBoundingClientRect(); return { dx: Math.round(p.left - b.left), dy: Math.round(p.top - b.bottom) }; });
    await P.pg.locator('[aria-label="日付を選ぶ"]').screenshot({ path: "g_datepop.png" });
    assert.ok(Math.abs(r.dx) <= 1 && r.dy >= 0 && r.dy <= 8, "日付のカレンダーの位置 " + JSON.stringify(r));
    await P.pg.click('[data-day="2026-11-03"]'); await P.pg.waitForTimeout(400);
    assert.ok((await P.pg.locator("[data-datepop]").innerText()).startsWith("11/3"), "選んだ日に移る");
    await P.pg.click("[data-datepop]"); await P.pg.click('[data-day="2026-11-02"]'); await P.pg.waitForTimeout(1500);
    assert.ok((await P.pg.locator("[data-datepop]").innerText()).startsWith("11/2")); console.log("日付のカレンダー: ボタンの下", JSON.stringify(r)); }
  // 訓練送り：チェックしない人は送り漏れに出る（通常の送りが別にある）、「通常の送りと同じ」にチェックした人は出ない
  { const m0 = api(t, "kv.get", ["master"]).data.value, s0 = api(t, "kv.get", ["sheet:" + date]).data.value;
    const r0 = s0.runs.find((r) => r.kind === "send" && !r.mode && r.userIds.length && !r.trainBothIds && !r.trainUserIds); const un = m0.users.find((u) => u.id === r0.userIds[0]).name;
    const unsent = async () => (await P.pg.locator('[data-unasg="send"] button').allInnerTexts()).some((x) => x.startsWith(un));
    const edit = async (fn) => { await P.pg.click(`[data-item-id="${r0.id}"]`); await P.pg.waitForTimeout(300); await fn(); await P.pg.click('button:text-is("保存")'); await P.pg.waitForTimeout(1500); };
    const kindSel = () => P.pg.locator('select:has(option[value="train_send"])');
    assert.ok(!(await unsent()), "はじめは送り漏れにいない");
    await edit(async () => { await kindSel().selectOption("train_send"); assert.ok(await P.pg.locator("[data-trainsame]").isVisible(), "訓練送りの便に「通常の送りと同じ」の欄"); });
    assert.ok(await unsent(), "チェックなしの訓練送り → 送り漏れに出る");
    await edit(async () => { await P.pg.locator(`[data-same="${un}"]`).check(); await P.pg.locator(".fixed [data-trainsame]").screenshot({ path: "g_trainsame.png" }).catch(() => {}); });
    assert.ok(!(await unsent()), "「通常の送りと同じ」→ 送り漏れに出ない");
    const s1 = api(t, "kv.get", ["sheet:" + date]).data.value.runs.find((r) => r.id === r0.id); assert.ok(s1.mode === "train" && s1.trainBothIds.includes(r0.userIds[0]));
    await edit(async () => { await P.pg.locator(`[data-same="${un}"]`).uncheck(); await kindSel().selectOption("send"); });   // 元に戻す
    const s2 = api(t, "kv.get", ["sheet:" + date]).data.value.runs.find((r) => r.id === r0.id); assert.ok(!s2.mode && !s2.trainBothIds, "元に戻る");
    console.log("訓練送り:", un, "チェックなし→送り漏れ / 通常の送りと同じ→出ない"); }
  // ルール：「使い始める日」を選ぶと、その前の日までは前のルールのままと出る
  { await P.pg.click('button:text-is("ルール")'); await P.pg.waitForTimeout(400);
    assert.ok(await P.pg.locator("[data-rulefrom]").isVisible(), "ルールの画面に「使い始める日」");
    await P.pg.click("[data-rulefrom] [data-datepop]"); const day = await P.pg.locator("[data-rulefrom] [data-day]").nth(14).getAttribute("data-day");
    await P.pg.click(`[data-rulefrom] [data-day="${day}"]`); await P.pg.waitForTimeout(200);
    const txt = await P.pg.locator("[data-rulefrom]").innerText(); const [, mm, dd] = day.split("-").map(Number);
    assert.ok(txt.includes(`${mm}/${dd}からの送迎表`) && txt.includes(`${mm}/${dd - 1}までの送迎表`), txt);
    await P.pg.locator("[data-rulefrom]").screenshot({ path: "g_rulefrom.png" });
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(400);
    console.log("ルールの使い始める日:", txt.split("\n")[1]); }
  // その他予定「コマだけ消す」：表からは消えて、特記事項には残る。下の一覧から表に戻せる
  { assert.ok(await P.pg.locator('[data-item-id="blkNote1"]').isVisible(), "はじめは表にコマ");
    await P.pg.click('[data-item-id="blkNote1"]'); await P.pg.waitForTimeout(300);
    await P.pg.click("[data-note-only]"); await P.pg.waitForTimeout(800);
    assert.strictEqual(await P.pg.locator('[data-item-id="blkNote1"]').count(), 0, "表からコマが消える");
    let b1 = null; for (let i = 0; i < 20 && !(b1 && b1.noteOnly); i++) { await P.pg.waitForTimeout(500); b1 = api(t, "kv.get", ["sheet:" + date]).data.value.blocks.find((b) => b.id === "blkNote1"); }
    assert.ok(b1 && b1.noteOnly, "データは残る（サーバーにも保存）");
    const tg = P.pg.locator('button:has-text("特記事項・男性カバー・配車を表示")'); if (await tg.count()) { await tg.click(); await P.pg.waitForTimeout(300); }
    assert.ok((await P.pg.locator("[data-noteonly-list]").innerText()).includes("黒田給食利用"), "表に出していない予定の一覧");
    assert.ok((await P.pg.locator("#root").innerText()).includes("黒田給食利用 12:00〜"), "特記事項（自動）に残る");
    await P.pg.locator("[data-noteonly-list]").screenshot({ path: "g_noteonly.png" });
    await P.pg.click('[data-note-restore="blkNote1"]'); await P.pg.waitForTimeout(800);
    assert.ok(await P.pg.locator('[data-item-id="blkNote1"]').isVisible(), "表に戻す");
    console.log("コマだけ消す: 表から消えて特記事項に残る → 表に戻す"); }
  // りんく・ぷれいす版：担当を「生活介護へ依頼」にした便 → 生活介護（11/1からは新体制版）の保留欄に【りんく依頼】。担当・車が決まるとりんく側の便に出る
  { const v3m = api(t, "kv.get", ["v3:master"]).data.value, kid = v3m.users[0];
    api(t, "kv.merge", [{ key: "v3:sheet:" + date, base: null, baseKnown: false, mine: { runs: [{ id: "rqUI", kind: "meet", time: "15:00", staffId: "__req__", vehicleId: "", userIds: [kid.id], staffRiderIds: [], note: "" }], blocks: [] } }]);
    const lk = api(t, "kv.get", ["v2:sheet:" + date]).data.value.blocks.find((b) => b.id === "lk_rqUI"); assert.ok(lk && lk.staffId === "__hold__", "生活介護の保留欄に");
    const m1 = api(t, "kv.get", ["v2:master"]).data.value, st = m1.staff.find((x) => x.name === "八壁"), veh = m1.vehicles[0];
    api(t, "kv.merge", [{ key: "v2:sheet:" + date, base: null, baseKnown: false, mine: { ...api(t, "kv.get", ["v2:sheet:" + date]).data.value, blocks: api(t, "kv.get", ["v2:sheet:" + date]).data.value.blocks.map((b) => (b.id === "lk_rqUI" ? { ...b, staffId: st.id, vehicleId: veh.id } : b)) } }]);
    const Q = await open("sougei.html", { width: 1400, height: 900 }, boot.replace('__SG_EDITION="v1"', '__SG_EDITION="v3"'), "sougei_v3.html");
    await Q.pg.waitForTimeout(500); await Q.pg.fill("#sghNo", "000"); await Q.pg.fill("#sghPin", "5829"); await Q.pg.click("#sghGo"); await Q.pg.waitForTimeout(5000);
    const stTxt = await Q.pg.locator('[data-reqst="rqUI"]').innerText(); assert.ok(stTxt.includes(`生活介護：八壁・${veh.name}で対応`), stTxt);
    await Q.pg.locator('[data-item-id="rqUI"]').screenshot({ path: "g_req_chip.png" });
    await Q.pg.click('[data-item-id="rqUI"]'); await Q.pg.waitForTimeout(400);
    assert.ok((await Q.pg.locator("[data-reqnote]").innerText()).includes("八壁"), "編集画面にも出る");
    await Q.pg.locator(".fixed [data-reqnote]").screenshot({ path: "g_req_note.png" }).catch(() => {});
    console.log("りんく依頼:", stTxt, "/ 画面エラー:", real(Q.errs)); assert.deepStrictEqual(real(Q.errs), []); await Q.pg.context().close(); }
  console.log(await P.pg.evaluate(() => ({ react: !!window.React, root: document.getElementById("root").innerHTML.length, kv: !!window.__sgkv, setkv: typeof window.__sgSetKV, st: window.__sgkv && window.__sgkv.status() })));
  assert.strictEqual(await P.pg.getByRole("button", { name: /AI調整|AIと相談/ }).count(), 0, "料金がかかるAIのボタンは、キーが無ければ出ない");
  console.log("送迎表の表示:", (await P.pg.locator("text=/📅 カレンダー/").first().innerText().catch(() => "なし")), (await P.pg.locator('button[title="保存と同期の状況"]').innerText().catch(() => "なし")), "/ 画面エラー:", P.errs);
  // 管理者がカレンダーで「送迎」「ヘルプ」「利用者休み」「勤務時間変更」「その他予定」を入れる → 送迎表に反映
  // よみがな：送迎表の名前は「よみがな」シートに自動で並ぶ。読みを入れると、ひらがなで予測が出る
  const ys = g.sheets.get("よみがな"); assert.ok(ys && ys.data.some((r) => r[0] === "中村" && r[2] === "利用者"), "よみがなシートに利用者が並ぶ");
  ys.data.forEach((r) => { if (r[0] === "中村") r[1] = "なかむら"; if (r[0] === "日野") r[1] = "ひの"; });
  for (const k of [...g.cache.keys()]) if (k === "names3") g.cache.delete(k);
  const A = await open("calendar.html", { width: 390, height: 844 }, boot);
  await A.pg.waitForTimeout(500); await A.pg.fill("#sghNo", "000"); await A.pg.fill("#sghPin", "5829"); await A.pg.click("#sghGo"); await A.pg.waitForTimeout(2500);
  const pick = async (kind, name) => { await A.pg.fill("#f-sgq-" + kind, name); await A.pg.click(`[data-sgpick="${kind}"][data-name="${name}"]`); };
  await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300);
  assert.deepStrictEqual(await A.pg.$$eval('input[name="f-label"]', (o) => o.map((x) => x.value)), ["help", "ride", "user", "extra", "monitor", "shien", "leave", "hwork", "shift", "other"], "ラベルの並び");
  assert.strictEqual(await A.pg.evaluate(() => { const c = document.querySelector('input[name="f-label"]:checked'); return c && c.value + (document.activeElement === c ? ":focus" : ""); }), "help:focus", "開いたときはヘルプ");
  await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
  const add = async (label) => { await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-" + label); await A.pg.waitForTimeout(300); };
  const save = async (ms) => { await A.pg.click("[data-hsave]"); await A.pg.waitForTimeout(ms || 1500); };
  // 送迎：迎えは「受診後送り」、送りは時間変更
  await add("ride"); assert.strictEqual(await A.pg.locator("#f-title").count(), 0, "その他予定以外はタイトルの欄なし"); await pick("users", "森");
  const meetOpts = await A.pg.$$eval('input[name="w-meet"]', (o) => o.map((x) => x.parentElement.innerText));
  const sendOpts = await A.pg.$$eval('input[name="w-send"]', (o) => o.map((x) => x.parentElement.innerText));
  assert.deepStrictEqual(meetOpts, ["いつもどおり", "時間変更", "家族送り", "受診後送り"]); assert.deepStrictEqual(sendOpts, ["いつもどおり", "時間変更", "家族迎え"]);
  await A.pg.check('input[name="w-meet"][value="clinic"]'); await A.pg.waitForTimeout(200);
  await A.pg.evaluate(() => { document.querySelector("#sheetRoot .sheet").scrollTop = 400; });
  const before = await A.pg.evaluate(() => document.querySelector("#sheetRoot .sheet").scrollTop);
  await A.pg.check('input[name="w-send"][value="time"]'); await A.pg.waitForTimeout(200);
  const after = await A.pg.evaluate(() => document.querySelector("#sheetRoot .sheet").scrollTop);
  assert.ok(before > 100 && Math.abs(after - before) < 5, `「時間変更」を押しても画面の位置はそのまま（${before}→${after}）`);
  await A.pg.fill("#w-sendt", "15:30");
  assert.strictEqual(await A.pg.locator("#w-mplace").count(), 0, "受診後送りのときは迎え先の欄を出さない");
  await A.pg.fill("#w-splace", "病院");
  await A.pg.locator(".sheet").screenshot({ path: "g_ride.png" }); await save();
  // ヘルプ：担当・開始時刻・行き先（終了の時刻は出ない）
  await add("help"); assert.strictEqual(await A.pg.locator("#f-sgq-staff").count(), 0, "ヘルプに職員の欄はない");
  await A.pg.fill("#f-sgq-users", "なか"); await A.pg.waitForTimeout(450);
  { const r = await A.pg.evaluate(() => { const h = document.querySelector("#sheetRoot .sheet-head").getBoundingClientRect(), i = document.getElementById("f-sgq-users").getBoundingClientRect(), l = document.getElementById("sghits-users").getBoundingClientRect(); return { gap: i.top - h.bottom, hits: l.bottom, vh: innerHeight }; });
    assert.ok(r.gap >= 0 && r.gap < 90 && r.hits <= r.vh, "スマホ：名前を打つと、その欄が上に来て候補が見える " + JSON.stringify(r)); console.log("スマホの名前入力:", JSON.stringify(r)); }
  const firstHit = await A.pg.locator('#sghits-users [data-sgpick]').first().getAttribute("data-name"); assert.strictEqual(firstHit, "中村", "「なか」で中村が先頭に");
  await A.pg.fill("#f-sgq-users", "ナカ"); await A.pg.waitForTimeout(150);
  assert.strictEqual(await A.pg.locator('#sghits-users [data-sgpick]').first().getAttribute("data-name"), "中村", "カタカナでも");
  await A.pg.click('[data-sgpick="users"][data-name="中村"]');
  console.log("予測:「なか」→", firstHit); await A.pg.fill("#w-dest", "○○病院"); await A.pg.fill("#f-start", "14:00");
  assert.ok(await A.pg.locator("#w-end").isHidden(), "ヘルプは開始時刻だけ");
  await A.pg.locator(".sheet").screenshot({ path: "g_help.png" }); await save();
  // 利用者休み：欠席（理由つき）
  const absent = m.users.find((u) => !["森", "中村"].includes(u.name) && u.name.length >= 2).name;
  await add("user"); await pick("users", absent); await A.pg.click('[data-fill="w-reason"][data-v="体調不良"]'); await save();
  // 利用日外利用：その日だけ利用（送迎は未割当に出る）
  const exU = m.users.find((x) => !(x.days || []).includes(1) && !x.startDate && x.name !== absent);
  await add("extra"); await pick("users", exU.name); await A.pg.check('input[name="w-send"][value="time"]'); await A.pg.waitForTimeout(200); await A.pg.fill("#w-sendt", "15:00");
  await A.pg.locator(".sheet").screenshot({ path: "g_extra.png" }); await save();
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
  assert.strictEqual(s2.userExtra[exU.id], true, "利用日外利用 → 今日だけ利用"); assert.strictEqual(s2.userTime[exU.id].send, "15:00");
  assert.strictEqual(s2.staffOv[S("八壁")].end, "19:00", "勤務時間変更");
  const evs = Object.values(api(t, "docs.query", [{ col: "days", from: date, to: date }]).data).flatMap((d) => Object.values(d.events || {}));
  const mt = evs.find((e) => e.title === "会議"); assert.ok(mt && mt.place === "2階" && mt.tanto[0] === "日野" && !mt.sg, "その他予定：場所・担当（送迎表には載せない）");
  assert.ok(s2.blocks.some((x) => x.calId && x.kind === "block" && x.staffId === S("日野") && x.label === "モニタリング（森）" && x.time === "13:30"), "モニタリング → 対応者の予定");
  const tl = await A.pg.locator(".ev-row .t").allInnerTexts();
  { // 並び：ラベルの順（ヘルプ→送迎→利用者休み→利用日外利用→モニタリング→…→その他予定）
    const order = ["help", "ride", "user", "extra", "monitor", "shien", "leave", "hwork", "shift", "other"];
    const labs = await A.pg.$$eval("#panel .ev-row", (rows) => rows.map((r) => (r.getAttribute("style") || "").replace(/.*--l-([a-z]+).*/, "$1")));
    const idx = labs.map((l) => order.indexOf(l)); assert.deepStrictEqual(idx, [...idx].sort((x, y) => x - y), "ラベルの順に並ぶ: " + labs.join(","));
    console.log("並び:", labs.join(" → "));
  }
  for (const x of ["森 受診後送り・送り15:30・送り先病院", "中村 ヘルプ（○○病院）", `${absent} 欠席（体調不良）`, "八壁 退勤19:00（残業）", "会議", "モニタリング（森）"]) assert.ok(tl.includes(x), x + " / " + tl.join(","));
  assert.ok((await A.pg.locator(".ev-row", { hasText: "会議" }).innerText()).includes("担当：日野"), "一覧に担当");
  console.log("管理者が入力 →", tl.join(" / "), "→ 送迎表: 迎え", s2.noRide[U("森")].meet, "・送り", s2.userTime[U("森")].send, "・ヘルプ(保留欄)", hb.time, "・欠席", absent, "・八壁の退勤", s2.staffOv[S("八壁")].end, "/ 画面エラー:", real(A.errs));
  { // スマホの月表示：バーに題名。日付を押すとその日の一覧が下から出て、右上の＋で予定を入れる
    const chipTxt = await A.pg.locator(`.cell[data-day="${date}"] .ev-chip span`).first().innerText();
    assert.ok(chipTxt.length > 0 && await A.pg.locator(`.cell[data-day="${date}"] .ev-chip span`).first().isVisible(), "バーに題名が見える");
    await A.pg.locator(`.cell[data-day="${date}"]`).screenshot({ path: "g_cell.png" });
    await A.pg.click(`.cell[data-day="${date}"] .ev-chip >> nth=0`); await A.pg.waitForTimeout(300);
    assert.ok(await A.pg.locator(".daysheet").isVisible(), "日を押すとその日の一覧");
    const rows = await A.pg.locator(".daysheet .ds-row b").allInnerTexts(); assert.strictEqual(rows.length, await A.pg.locator("#panel .ev-row").count(), "その日の予定がぜんぶ並ぶ");
    await A.pg.screenshot({ path: "g_daysheet.png" });
    await A.pg.click(".daysheet [data-add-day]"); await A.pg.waitForTimeout(300);
    assert.ok(await A.pg.locator("#evForm").isVisible(), "＋で入力画面"); assert.strictEqual(await A.pg.inputValue("#f-date"), date, "その日の予定として");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(300);
    assert.ok(await A.pg.locator(".daysheet").isVisible(), "入力画面を閉じると一覧に戻る");
    await A.pg.click(".daysheet .ds-row >> nth=0"); await A.pg.waitForTimeout(300); assert.ok(await A.pg.locator("#evForm").isVisible(), "一覧の予定を押すと開く");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200); await A.pg.click("[data-day-close]"); await A.pg.waitForTimeout(300);
    assert.strictEqual(await A.pg.locator(".daysheet").count(), 0, "×で閉じる");
    // 上の部分を下へ引くと閉じる。少しだけなら元に戻る。なぞっても裏の月の画面は動かない
    await A.pg.click(`.cell[data-day="${date}"]`); await A.pg.waitForTimeout(300);
    assert.ok(await A.pg.evaluate(() => document.documentElement.classList.contains("dayopen")), "開いている間は裏を止める");
    const cdp = await A.pg.context().newCDPSession(A.pg); await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const swipe = async (sel, dys, hold) => { const g = await A.pg.locator(sel).boundingBox(); const x = g.x + g.width / 2, y = g.y + Math.min(g.height / 2, 20);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (const dy of dys) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy }] });
      if (hold) await A.pg.waitForTimeout(hold);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await A.pg.waitForTimeout(500); };
    const sy0 = await A.pg.evaluate(() => scrollY);
    await swipe(".ds-head h2", [-40, -120, -240]);
    assert.strictEqual(await A.pg.evaluate(() => scrollY), sy0, "上になぞっても裏の画面は動かない");
    await swipe(".ds-head h2", [20, 40], 400); assert.strictEqual(await A.pg.locator(".daysheet").count(), 1, "少しだけ引いたら戻る");
    await swipe(".ds-grip", [40, 100, 180, 260]);
    assert.strictEqual(await A.pg.locator(".daysheet").count(), 0, "下へ引くと閉じる");
    assert.ok(!(await A.pg.evaluate(() => document.documentElement.classList.contains("dayopen"))));
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await cdp.detach();
    console.log("スマホの日の一覧:", rows.length, "件 / バー:", chipTxt); }
  { // 事業のタブ：全体／生活介護／放課後デイ。これまでの予定は生活介護
    assert.deepStrictEqual(await A.pg.$$eval("#bizTabs [data-biz]", (b) => b.map((x) => x.textContent)), ["全体", "生活介護", "放課後デイ"]);
    const before = await A.pg.locator("#panel .ev-row").count();
    await A.pg.click('[data-biz="houkago"]'); await A.pg.waitForTimeout(300);
    assert.strictEqual(await A.pg.locator("#panel .ev-row").count(), 0, "放課後デイのタブでは生活介護の予定は出ない");
    const bgOf = async () => { await A.pg.waitForTimeout(300); return A.pg.evaluate(() => getComputedStyle(document.body).backgroundColor); };   // 色はなめらかに変わるので少し待つ
    assert.strictEqual(await bgOf(), "rgb(251, 236, 241)", "放課後デイは薄ピンク"); await A.pg.screenshot({ path: "g_bg_houkago.png" });
    await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300);
    assert.ok(await A.pg.locator("#f-biz-houkago").isChecked(), "放課後デイのタブで作ると放課後デイ");
    // 放課後デイの予定：利用者の候補はりんく・ぷれいす版の利用者だけ。生活介護に変えると現体制版・新体制版の利用者
    await A.pg.check("#f-label-user"); await A.pg.waitForTimeout(300);
    await A.pg.fill("#f-sgq-users", ""); await A.pg.waitForTimeout(200);
    const kidHits = await A.pg.$$eval("#sghits-users [data-sgpick]", (b) => b.map((x) => x.dataset.name));
    assert.deepStrictEqual(kidHits, ["星野こども"], "放課後デイは放課後デイの利用者だけ: " + kidHits.join(","));
    await A.pg.check("#f-biz-seikatsu"); await A.pg.fill("#f-sgq-users", "なか"); await A.pg.waitForTimeout(200);
    const adHits = await A.pg.$$eval("#sghits-users [data-sgpick]", (b) => b.map((x) => x.dataset.name));
    assert.ok(adHits.includes("中村") && !adHits.includes("星野こども"), "生活介護は生活介護の利用者: " + adHits.join(","));
    await A.pg.check("#f-biz-houkago");
    await A.pg.check("#f-label-other"); await A.pg.waitForTimeout(300); if (await A.pg.isChecked("#f-allday")) { await A.pg.uncheck("#f-allday"); await A.pg.waitForTimeout(200); }
    await A.pg.check("#f-label-other"); await A.pg.waitForTimeout(300); await A.pg.fill("#f-title", "放デイ会議"); await A.pg.fill("#f-start", "15:00"); await A.pg.fill("#f-end", "16:00");
    await A.pg.locator(".sheet").screenshot({ path: "g_biz_editor.png" }); await save(2500);
    assert.deepStrictEqual(await A.pg.locator("#panel .ev-row .t").allInnerTexts(), ["放デイ会議"], "放課後デイのタブ");
    await A.pg.click('[data-biz="seikatsu"]'); await A.pg.waitForTimeout(300);
    assert.strictEqual(await bgOf(), "rgb(232, 245, 236)", "生活介護は薄緑"); await A.pg.screenshot({ path: "g_bg_seikatsu.png" });
    assert.strictEqual(await A.pg.locator("#panel .ev-row").count(), before, "生活介護のタブ（これまでの予定）");
    await A.pg.click('[data-biz="all"]'); await A.pg.waitForTimeout(300);
    assert.strictEqual(await bgOf(), "rgb(234, 242, 251)", "全体は薄い青");
    assert.strictEqual(await A.pg.locator("#panel .ev-row").count(), before + 1, "全体のタブ");
    assert.ok((await A.pg.locator(".ev-row", { hasText: "放デイ会議" }).innerHTML()).includes("tag-biz"), "全体では放デイの印");
    await A.pg.screenshot({ path: "g_biz_all.png" });
    const evs2 = Object.values(api(t, "docs.query", [{ col: "days", from: date, to: date }]).data).flatMap((d) => Object.values(d.events || {}));
    assert.strictEqual(evs2.find((e) => e.title === "放デイ会議").biz, "houkago"); assert.strictEqual(evs2.find((e) => e.title === "会議").biz || "seikatsu", "seikatsu");
    console.log("事業のタブ: 生活介護", before, "件 / 放課後デイ 1件 / 全体", before + 1, "件"); }
  { // 二重に入れない：同じ予定がもう入っていたら知らせる。もう一度「保存」でそのまま入れられる
    const n0 = await A.pg.locator("#panel .ev-row", { hasText: "会議" }).count();
    await add("other"); await A.pg.fill("#f-title", "会議"); await A.pg.fill("#f-start", "13:00"); await A.pg.fill("#f-end", "14:00");
    await A.pg.click("[data-hsave]"); await A.pg.waitForTimeout(300);
    const msg = await A.pg.locator("#f-err").innerText(); assert.ok(msg.includes("同じ予定がもう入っています"), msg);
    await A.pg.click("[data-hsave]"); await A.pg.waitForTimeout(1500);
    assert.ok(!(await A.pg.locator("#evForm").count()), "もう一度押すと入る");
    assert.strictEqual(await A.pg.locator("#panel .ev-row", { hasText: "会議" }).count(), n0 + 1);
    console.log("二重の確認:", msg); }
  { // 1つの予定に1人：休み・送迎・ヘルプなどは1人選ぶと検索の欄が消える（×で外すと戻る）。その他予定の担当は何人でも
    await add("leave"); await pick("staff", "八壁");
    assert.strictEqual(await A.pg.locator("#f-sgq-staff").count(), 0, "1人選んだら検索の欄は出ない");
    assert.ok((await A.pg.locator(".sgbox").innerText()).includes("1つの予定に1人です"));
    await A.pg.locator(".sgbox").screenshot({ path: "g_oneonly.png" });
    await A.pg.click('[data-sgrm="staff"][data-name="八壁"]'); await A.pg.waitForTimeout(200);
    assert.strictEqual(await A.pg.locator("#f-sgq-staff").count(), 1, "×で外すと選び直せる");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
    await add("help"); await pick("users", "中村"); assert.strictEqual(await A.pg.locator("#f-sgq-users").count(), 0, "ヘルプも1人");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
    await add("other"); await pick("staff", "八壁"); await pick("staff", "日野");
    assert.strictEqual(await A.pg.locator('.sgbox [data-sgrm="staff"]').count(), 2, "その他予定の担当は何人でも");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
    console.log("1つの予定に1人: 休み・ヘルプは1人 / その他予定の担当は複数"); }
  { // 予定の検索：上の🔍。ほかの月の予定も出る。押すと開いて、閉じると検索に戻る
    api(t, "cal.apply", [{ kind: "upsert", opId: "op_srch0001", id: "ev_srch0001", baseRev: null, ev: { title: "余村慎検診", date: "2026-12-23", endDate: "2026-12-23", allDay: true, start: "", end: "", label: "other", place: "", memo: "", members: [] } }]);
    await A.pg.click("#searchBtn"); await A.pg.waitForTimeout(300);
    assert.ok(await A.pg.locator("#sq").isVisible() && await A.pg.evaluate(() => document.activeElement && document.activeElement.id === "sq"), "検索の欄にすぐ打てる");
    await A.pg.fill("#sq", "余村"); await A.pg.waitForTimeout(1500);
    const dates = await A.pg.locator(".sr-date b").allInnerTexts(), titles = await A.pg.locator(".sr-row .sr-t").allInnerTexts();
    assert.ok(dates.includes("2026年12月23日(水)") && titles.some((x) => x.includes("余村慎検診")), "ほかの月も: " + dates.join(","));
    assert.ok((await A.pg.locator(".sr-row .sr-t b").first().innerText()) === "余村", "言葉を太字");
    await A.pg.screenshot({ path: "g_search.png" });
    await A.pg.click('.sr-row:has-text("余村慎検診")'); await A.pg.waitForTimeout(800);
    assert.ok(await A.pg.locator("#evForm").isVisible(), "押すと開く"); assert.strictEqual(await A.pg.inputValue("#f-date"), "2026-12-23");
    assert.ok(await A.pg.locator("#liveNote").isHidden(), "ほかの月の予定でも「変更されました」は出ない");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(300); assert.ok(await A.pg.locator("#sq").isVisible(), "閉じると検索に戻る");
    await A.pg.click("[data-sr-close]"); await A.pg.waitForTimeout(200); assert.strictEqual(await A.pg.locator("#sq").count(), 0);
    await A.pg.click("#todayBtn"); await A.pg.waitForTimeout(300); await A.pg.evaluate((d) => { }, date);
    console.log("検索「余村」:", dates.join(" / ")); }
  assert.deepStrictEqual(real(A.errs), []);
  // 送迎表を開き直す → カレンダーから入った便・ヘルプが表に出る（画面エラーなし）
  P.errs.length = 0; await P.pg.reload(); await P.pg.waitForTimeout(5000);   // ログインは端末に残っている
  await P.pg.screenshot({ path: "g_sougei_after.png", fullPage: true });
  const body = await P.pg.locator("#root").innerText(); assert.ok(body.includes("受診後送り") && body.includes("中村"), "送迎表に受診後送り・ヘルプが出る");
  console.log("送迎表を開き直す → 森(受診後送り)・ヘルプ（中村）が表に出る / 画面エラー:", real(P.errs));
  assert.deepStrictEqual(real(P.errs), []);
  // 開いたときに公開URLが届かなくても（実機で起きた）、ログイン後にサーバーへ聞いて、メニューのリンクは公開URLになる
  {
    const N = await open("calendar.html", { width: 1200, height: 800 }, `window.__SG_EDITION="v1";window.__SG_BASE="";window.__SG_DATE="${date}";`);
    await N.pg.waitForTimeout(500); await N.pg.fill("#sghNo", "000"); await N.pg.fill("#sghPin", "5829"); await N.pg.click("#sghGo"); await N.pg.waitForTimeout(2500);
    await N.pg.click(".sgh-chip"); await N.pg.waitForTimeout(300);
    const hrefs = await N.pg.$$eval(".sgh-menu a", (a) => a.map((x) => x.getAttribute("href")));
    assert.ok(hrefs.length >= 3 && hrefs.every((h) => h.startsWith("https://script.google.com/macros/s/TEST/exec?page=sougei")), "メニューのリンクが公開URL: " + hrefs.join(" "));
    console.log("公開URLが届かないとき → ログイン後のリンク:", hrefs[0]);
  }
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
