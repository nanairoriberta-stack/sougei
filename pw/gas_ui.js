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
  { const m1 = api(t, "kv.get", ["master"]).data.value; api(t, "kv.cas", [{ key: "v3:master", rev: 0, value: { ...m1, users: [{ ...m1.users[0], id: "k_hoshino", name: "星野こども" }], staff: [...m1.staff.slice(0, 3), { ...m1.staff[0], id: "st_hd1", name: "放デイ太郎" }] } }]); }   // りんく・ぷれいす版（放課後デイ）の利用者・職員
  { const s0 = api(t, "kv.get", ["sheet:" + date]).data.value, m0 = api(t, "kv.get", ["master"]).data.value;   // その他予定「黒田給食利用」（コマだけ消すの試し）
    api(t, "kv.merge", [{ key: "sheet:" + date, base: s0, baseKnown: true, mine: { ...s0, blocks: [...s0.blocks, { id: "blkNote1", kind: "block", time: "12:00", staffId: m0.staff.find((x) => x.name === "八壁").id, label: "黒田給食利用", vehicleId: "" }] } }]); }
  const yo = rows().find((r) => r[1] === "余村慎");
  const LOC = { "react.production.min.js": "node_modules/react/umd/react.production.min.js", "react-dom.production.min.js": "node_modules/react-dom/umd/react-dom.production.min.js", "three.min.js": "node_modules/three/build/three.min.js" };
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
  // スマホ：余村慎がログインして AM休 を押す
  const boot = `window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="${date}";`;
  const { pg, errs } = await open("calendar.html", { width: 390, height: 844 }, boot);
  await pg.waitForTimeout(800); await pg.screenshot({ path: "g_login.png" });
  await pg.fill("#sghNo", yo[0]); await pg.fill("#sghPin", String(yo[3])); await pg.click("#sghGo"); await pg.waitForTimeout(800);
  await pg.fill("#sghOld", String(yo[3])); await pg.fill("#sghNew", "3871"); await pg.fill("#sghNew2", "3871");
  await pg.evaluate(() => { const f = document.getElementById("sghPinF"); f.requestSubmit(); f.requestSubmit(); });   // 2回押し（Enterとクリック）でもエラーにならない await pg.waitForTimeout(2500);
  await pg.screenshot({ path: "g_cal.png" });
  await pg.click(`.cell[data-day="${date}"]`); await pg.waitForTimeout(400);   // スマホは日を押すと一覧が出て、その中に「休みを入れる」
  assert.strictEqual(await pg.locator("#qKind, .ds-quick, .quick").count(), 0, "「予定を入れる（この日）」の欄は出さない");
  await pg.click(".daysheet [data-add-day]"); await pg.waitForTimeout(400);   // ＋から職員休み（AM休）
  await pg.locator("label:has(#f-label-leave)").click(); await pg.waitForTimeout(300);
  await pg.locator('label:has(input[name="w-leave"][value="am"])').click(); await pg.waitForTimeout(300);
  await pg.click("[data-hsave]"); await pg.waitForTimeout(2500);
  await pg.click("[data-day-close]"); await pg.waitForTimeout(300);
  await pg.screenshot({ path: "g_cal_after.png" });
  await pg.click("#addBtn"); await pg.waitForTimeout(400); await pg.screenshot({ path: "g_editor.png" });
  // 一般職員もすべてのラベルを使える（2026-10-31〜）。ほかの職員の分も入れられる
  const dis = await pg.$$eval('input[name="f-label"]', (o) => o.filter((x) => x.disabled).map((x) => x.value));
  assert.deepStrictEqual(dis, [], "押せないラベルはない");
  assert.strictEqual(await pg.evaluate(() => document.querySelector('input[name="f-label"]:checked').value), "leave", "一般職員の新しい予定は職員休みから");
  for (const k of ["help", "ride", "user", "extra"]) {
    await pg.locator(`label:has(#f-label-${k})`).click(); await pg.waitForTimeout(250);
    assert.ok(await pg.locator("#f-sgq-users").isVisible(), k + "：利用者を選ぶ欄が出る");
  }
  await pg.locator("label:has(#f-label-help)").click(); await pg.waitForTimeout(250);
  assert.ok(await pg.locator("#w-dest").isVisible(), "ヘルプの行き先も入力できる");
  await pg.locator(".sheet").screenshot({ path: "g_label_all.png" });
  await pg.check("#f-label-hwork"); await pg.waitForTimeout(400);
  await pg.click('[data-sgrm="staff"][data-name="余村慎"]'); await pg.waitForTimeout(200);
  assert.strictEqual(await pg.locator("#f-sgq-staff").count(), 1, "最初は自分。×で外すとほかの職員を選べる（2026-10-31〜）");
  await pg.fill("#f-sgq-staff", "余村慎"); await pg.click('[data-sgpick="staff"][data-name="余村慎"]'); await pg.waitForTimeout(300);
  await pg.locator(".sgbox").screenshot({ path: "g_sgbox.png" });
  const self = await pg.locator(".sgbox .sgchip").innerText(); assert.ok(self.includes("余村慎"));
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
  api(t, "cal.apply", [{ kind: "upsert", opId: "op_pmleave1", id: "ev_pmleave1", baseRev: null, ev: { title: "高井 PM休", date, endDate: date, allDay: true, start: "", end: "", label: "leave", place: "", memo: "", members: [], sg: { type: "staff_off", staff: ["高井"], half: "pm" } } }]);   // PM休（退勤のコマ）
  const P = await open("sougei.html", { width: 1400, height: 900 }, boot);
  await P.pg.waitForTimeout(500); await P.pg.fill("#sghNo", "000"); await P.pg.fill("#sghPin", "5829"); await P.pg.click("#sghGo"); await P.pg.waitForTimeout(5000);
  await P.pg.screenshot({ path: "g_sougei.png" });
  { const tk = api(t, "kv.get", ["master"]).data.value.staff.find((x) => x.name === "高井");   // PM休：勤務の最後のコマに「退勤」
    const lv = P.pg.locator(`[data-leave="${tk.id}"]`); assert.strictEqual(await lv.count(), 1, "PM休の退勤のコマ"); assert.ok((await lv.innerText()).startsWith("退勤"));
    console.log("PM休の退勤:", await lv.innerText()); }
  { const body0 = await P.pg.locator("#root").innerText();   // 見ていない箱（送迎の抜け・使える車）は出さない
    assert.ok(!body0.includes("送迎の抜けがあります") && !body0.includes("🚗 使える車") && !body0.includes("全員に迎え・送りが入っています"), "右の箱を出さない"); }
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
  { // 職員・車両・利用者のタブは基本の部署の順（職員はパートが各部署の下）
    for (const tb of ["職員", "車両", "利用者"]) { await P.pg.click(`button:text-is("${tb}")`); await P.pg.waitForTimeout(400); }
    await P.pg.click('button:text-is("職員")'); await P.pg.waitForTimeout(300); await P.pg.screenshot({ path: "g_staff_tab.png" });
    const rowsDept = await P.pg.$$eval("[data-dept-row]", (rs) => rs.map((r) => ({ d: r.dataset.deptRow, bg: r.style.background, bt: r.style.borderTop })));
    assert.ok(rowsDept.every((r) => r.bg), "部署ごとに背景の色");
    const changes = rowsDept.filter((r, i) => i > 0 && rowsDept[i - 1].d !== r.d); assert.ok(changes.length >= 2 && changes.every((r) => r.bt.includes("3px")), "部署が変わる行に区切り線");
    assert.strictEqual(new Set(rowsDept.map((r) => r.d)).size, changes.length + 1, "同じ部署はまとまっている");
    { // 🖨 一覧を印刷：選んだ一覧だけを罫線つきの表で（A4）。印刷用の見えない枠に入る
      await P.pg.click("[data-print-btn]"); await P.pg.waitForTimeout(300);
      assert.ok(await P.pg.locator("[data-print-dialog]").isVisible(), "印刷の画面");
      assert.strictEqual(await P.pg.locator("[data-print-kind]:checked").count(), 5, "はじめは全部");
      await P.pg.locator("[data-print-dialog]").screenshot({ path: "g_print_dialog.png" });
      await P.pg.uncheck('[data-print-kind="users"]'); await P.pg.uncheck('[data-print-kind="rules"]');
      await P.pg.evaluate(() => { window.print = () => {}; });
      await P.pg.click("[data-print-go]"); await P.pg.waitForTimeout(800);
      const doc = await P.pg.$eval("[data-print-frame]", (f) => f.srcdoc);
      assert.deepStrictEqual([...doc.matchAll(/data-print-sec="(\w+)"/g)].map((x) => x[1]), ["staff", "vehicles", "help"], "選んだ一覧だけ");
      assert.ok(doc.includes("border:1px solid #000") && doc.includes("A4"), "罫線・A4");
      // テストの画面はファイルから開いているため、ブラウザがファイル名を使わない。画面が付けた名前と中身を確かめる
      await P.pg.evaluate(() => { const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = { name: this.download, href: this.href }; return; } return o.call(this); }; });
      await P.pg.click("[data-print-file]"); await P.pg.waitForTimeout(300);
      const f = await P.pg.evaluate(async () => ({ name: window.__dl.name, body: await (await fetch(window.__dl.href)).text() }));
      f.suggestedFilename = () => f.name;
      assert.ok(/送迎表の一覧_.*\.html$/.test(f.name) && f.body.includes('data-print-sec="staff"'), "ファイルにも保存できる " + f.name);
      await P.pg.click('[data-print-dialog] button:text-is("閉じる")'); await P.pg.waitForTimeout(200);
      console.log("一覧の印刷: 職員・車・ヘルプ表 / ファイル", f.suggestedFilename()); }
    { // 「⇄ 版の切替」は公開URL（…/exec）で開く。開いたときの __SG_BASE が届いていなくても中身用のアドレスへ飛ばない（2026-10-31 実機で真っ白）
      await P.pg.evaluate(() => { window.__SG_BASE = ""; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.target === "_top") { window.__go = this.getAttribute("href"); return; } return o.call(this); }; });
      await P.pg.click('button:has-text("版の切替")'); await P.pg.waitForTimeout(200);
      await P.pg.click('button:has-text("りんく・ぷれいす版")'); await P.pg.waitForTimeout(200);
      const go = await P.pg.evaluate(() => window.__go);
      assert.ok(/^https:\/\/script\.google\.com\/.*\/exec\?page=sougei&e=v3&d=2026-11-02$/.test(go || ""), "公開URLで、見ている日付のまま開く " + go);
      await P.pg.click(".sgh-chip"); await P.pg.waitForTimeout(200);   // 右下の名前のメニューのリンクも日付つき
      const hrefs = await P.pg.$$eval(".sgh-menu a", (as) => as.map((x) => x.getAttribute("href")));
      assert.ok(hrefs.some((h) => /e=v3&d=2026-11-02$/.test(h)) && hrefs.some((h) => /page=calendar&d=2026-11-02$/.test(h)), "メニューも日付つき " + hrefs.join(" "));
      await P.pg.click(".sgh-chip"); await P.pg.waitForTimeout(200);
      console.log("版の切替:", go); }
    { // 本物のGoogleでは、サーバーが画面に書いた版（__SG_EDITION）が届かないことがある → アドレス（?e=v3）から読む（2026-10-31 実機：りんく・ぷれいす版が現体制版で開いた）
      const R = await open("sougei.html", { width: 1400, height: 900 }, "", "sougei_noboot.html",
        () => { const w = setInterval(() => { if (window.google && window.google.script && !window.google.script.url) { window.google.script.url = { getLocation: (cb) => setTimeout(() => cb({ parameter: { page: "sougei", e: "v3" }, parameters: {}, hash: "" }), 50) }; clearInterval(w); } }, 0); });
      await R.pg.waitForTimeout(800); await R.pg.fill("#sghNo", "000"); await R.pg.fill("#sghPin", "5829"); await R.pg.click("#sghGo"); await R.pg.waitForTimeout(4000);
      assert.strictEqual(await R.pg.evaluate(() => window.__SG_EDITION), "v3", "アドレスの版");
      assert.ok((await R.pg.locator("body").innerText()).includes("りんく・ぷれいす版"), "りんく・ぷれいす版で開く");
      assert.deepStrictEqual(real(R.errs), [], "画面エラーなし");
      console.log("アドレスから版を読む: v3 で開いた"); await R.pg.context().close(); }
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(400);
    assert.deepStrictEqual(real(P.errs), [], "タブを開いても画面エラーなし"); }
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
  // Excel出力のあとにカレンダーが変わったら、送迎表の画面にお知らせ（ほかの日も）。その日を開くと上に帯
  { const d3 = "2026-11-03", s0 = api(t, "kv.get", ["sheet:" + date]).data.value;
    api(t, "kv.merge", [{ key: "sheet:" + d3, base: null, baseKnown: false, mine: { ...s0, calApplied: {}, exportedAt: "2026-11-02T06:00:00.000Z", exportSnap: {} } }]);
    api(t, "cal.apply", [{ kind: "upsert", opId: "op_expui001", id: "ev_expui001", baseRev: null, ev: { title: "白戸 休み", date: d3, endDate: d3, allDay: true, start: "", end: "", label: "leave", place: "", memo: "", members: [], sg: { type: "staff_off", staff: ["白戸"] } } }]);
    await P.pg.reload(); await P.pg.waitForTimeout(5000);
    const pop = await P.pg.locator("[data-exp-popup]").innerText();
    assert.ok(pop.includes("11月3日(火)のカレンダーに変更があります") && pop.includes("白戸 休み（追加）"), pop);
    await P.pg.locator("[data-exp-popup]").screenshot({ path: "g_exp_popup.png" });
    await P.pg.click('[data-exp-open="2026-11-03"]'); await P.pg.waitForTimeout(1500);
    assert.ok((await P.pg.locator("[data-exp-banner]").innerText()).includes("白戸 休み（追加）"), "その日の上に帯");
    assert.strictEqual(await P.pg.locator("[data-exp-popup]").count(), 0, "開いている日のお知らせは帯だけ");
    await P.pg.locator("[data-exp-banner]").screenshot({ path: "g_exp_banner.png" });
    await P.pg.click("[data-datepop]"); await P.pg.click('[data-day="2026-11-02"]'); await P.pg.waitForTimeout(1500);
    assert.ok(await P.pg.locator("[data-exp-popup]").isVisible(), "ほかの日を見ているとお知らせ");
    await P.pg.click("[data-exp-close]"); await P.pg.waitForTimeout(300); assert.strictEqual(await P.pg.locator("[data-exp-popup]").count(), 0, "閉じる");
    console.log("Excel出力後の変更:", pop.replace(/\n/g, " ")); }
  // 送迎表の右にカレンダーを出す（パソコン）。開いている間、送迎表はその分よける。幅と開いているかは端末に覚える
  { const calHtml = fs.readFileSync(path.join(D, "calendar.html"), "utf8").replace("/*__BOOT__*/", boot);
    await P.pg.route("https://script.google.com/**", (r) => r.fulfill({ body: calHtml, contentType: "text/html" }));   // 公開URLの代わりに、ここで作ったカレンダーを出す
    await P.pg.click("[data-calside-btn]"); await P.pg.waitForTimeout(400);
    assert.ok(await P.pg.locator("[data-calside]").isVisible(), "右にカレンダー");
    const src = await P.pg.locator("[data-calside-frame]").getAttribute("src"); assert.ok(/\/exec\?page=calendar&embed=1$/.test(src), src);
    const mr = await P.pg.evaluate(() => getComputedStyle(document.querySelector("#root > div")).marginRight); assert.strictEqual(mr, "440px", "送迎表は右をあける");
    const fr = P.pg.frameLocator("[data-calside-frame]");
    await fr.locator("#sghNo").waitFor({ timeout: 10000 }); await fr.locator("#sghNo").fill("000"); await fr.locator("#sghPin").fill("5829"); await fr.locator("#sghGo").click();
    await fr.locator(".cell").first().waitFor({ timeout: 10000 }); await P.pg.waitForTimeout(1500);
    assert.ok(await fr.locator("#addBtn").isVisible(), "右のカレンダーが動く（狭いのでスマホと同じ形）");
    await P.pg.screenshot({ path: "g_calside.png" });
    await P.pg.click("[data-calside-close]"); await P.pg.waitForTimeout(300); assert.strictEqual(await P.pg.locator("[data-calside]").count(), 0, "閉じる");
    console.log("右のカレンダー:", src); }
  { // パソコンのカレンダー：マスの日付の右を押すと、その日の予定を追加
    const C2 = await open("calendar.html", { width: 1280, height: 900 }, boot, "calendar_pc.html");
    await C2.pg.waitForTimeout(500); await C2.pg.fill("#sghNo", "000"); await C2.pg.fill("#sghPin", "5829"); await C2.pg.click("#sghGo"); await C2.pg.waitForTimeout(2500);
    await C2.pg.hover('.cell[data-day="2026-11-12"]'); await C2.pg.waitForTimeout(200);
    await C2.pg.locator('.cell[data-day="2026-11-12"] .cell-head').screenshot({ path: "g_cell_add.png" });
    await C2.pg.click('[data-add-cell="2026-11-12"]'); await C2.pg.waitForTimeout(400);
    assert.ok(await C2.pg.locator("#evForm").isVisible(), "日付の右で予定を追加"); assert.strictEqual(await C2.pg.inputValue("#f-date"), "2026-11-12");
    assert.deepStrictEqual(real(C2.errs), []); await C2.pg.context().close(); console.log("パソコンのカレンダー: 日付の右で追加"); }
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
    assert.ok(await Q.pg.locator("[data-req-col]").isVisible(), "りんく版の表に「生活介護へ依頼」の枠");
    assert.strictEqual(await Q.pg.evaluate(() => { const th = document.querySelector("[data-req-col]"); return th.previousElementSibling && th.previousElementSibling.textContent; }), "時間", "時間のすぐ右（2026-10-31〜。右端では見つけにくい）");
    assert.strictEqual(await Q.pg.locator('[data-req-cell] [data-item-id="rqUI"]').count(), 1, "依頼の便はその枠に出る");
    await Q.pg.screenshot({ path: "g_req_col.png" });
    await Q.pg.hover('[data-req-cell="16:00"]'); await Q.pg.click('[data-req-cell="16:00"] button[title*="生活介護へ依頼"]'); await Q.pg.waitForTimeout(400);
    assert.ok((await Q.pg.locator("[data-reqnote]").count()) === 1, "枠の＋で依頼の便を入れられる"); await Q.pg.click('button:text-is("キャンセル")'); await Q.pg.waitForTimeout(300);
    await Q.pg.click('[data-item-id="rqUI"]'); await Q.pg.waitForTimeout(400);
    assert.ok((await Q.pg.locator("[data-reqnote]").innerText()).includes("八壁"), "編集画面にも出る");
    await Q.pg.locator(".fixed [data-reqnote]").screenshot({ path: "g_req_note.png" }).catch(() => {});
    console.log("りんく依頼:", stTxt, "/ 画面エラー:", real(Q.errs)); assert.deepStrictEqual(real(Q.errs), []); await Q.pg.context().close(); }
  { // 生活介護の版（11/1からは新体制版）の表に「🤝 りんくからの依頼」の枠。担当が決まっていない依頼はここに出て、職員の欄へ動かすと担当が決まる
    const v3s = api(t, "kv.get", ["v3:sheet:" + date]).data.value, kid = api(t, "kv.get", ["v3:master"]).data.value.users[0];
    api(t, "kv.merge", [{ key: "v3:sheet:" + date, base: v3s, baseKnown: true, mine: { ...v3s, runs: [...v3s.runs, { id: "rqLK", kind: "send", time: "16:00", staffId: "__req__", vehicleId: "", userIds: [kid.id], staffRiderIds: [], note: "" }] } }]);
    const V = await open("sougei.html", { width: 1400, height: 900 }, boot.replace('__SG_EDITION="v1"', '__SG_EDITION="v2"'), "sougei_v2.html");
    await V.pg.waitForTimeout(500); await V.pg.fill("#sghNo", "000"); await V.pg.fill("#sghPin", "5829"); await V.pg.click("#sghGo"); await V.pg.waitForTimeout(5000);
    assert.ok(await V.pg.locator("[data-link-col]").isVisible(), "生活介護の表に「りんくからの依頼」の枠");
    assert.strictEqual(await V.pg.locator('[data-link-cell] [data-item-id="lk_rqLK"]').count(), 1, "担当未定の依頼は枠に出る");
    assert.strictEqual(await V.pg.locator('[data-link-cell] [data-item-id="lk_rqUI"]').count(), 0, "担当が決まった依頼は職員の欄");
    await V.pg.screenshot({ path: "g_link_col.png" });
    const m2 = api(t, "kv.get", ["v2:master"]).data.value, hino = m2.staff.find((x) => x.name === "日野");
    const heads = await V.pg.$$eval("thead th", (ths) => ths.map((x) => x.innerText.split("\n")[0].trim())); const ci = heads.indexOf("日野"); assert.ok(ci > 0, heads.join(","));
    await V.pg.click('[data-link-cell] [data-item-id="lk_rqLK"]'); await V.pg.waitForTimeout(400);   // 開いて担当に日野を選ぶ
    await V.pg.selectOption('select:has(option[value="__hold__"])', hino.id); await V.pg.click('button:text-is("保存")'); await V.pg.waitForTimeout(800);
    let lk = null; for (let i = 0; i < 20; i++) { await V.pg.waitForTimeout(400); lk = api(t, "kv.get", ["v2:sheet:" + date]).data.value.blocks.find((b) => b.id === "lk_rqLK"); if (lk && lk.staffId === hino.id) break; }
    assert.ok(lk && lk.staffId === hino.id, "担当を決めると職員の欄へ " + JSON.stringify(lk));
    assert.strictEqual(await V.pg.locator('[data-link-cell] [data-item-id="lk_rqLK"]').count(), 0, "枠から消える");
    let st3 = null; for (let i = 0; i < 20; i++) { await V.pg.waitForTimeout(300); st3 = (api(t, "kv.get", ["v3:sheet:" + date]).data.value.reqStatus || {}).rqLK; if (st3 && st3.staff) break; }
    assert.strictEqual(st3.staff, "日野", "りんく側にも担当が出る");
    assert.deepStrictEqual(real(V.errs), []); await V.pg.context().close(); console.log("りんくからの依頼の枠: OK"); }
  { // 生活介護のその日の表がまだ保存されていない日でも、りんく・ぷれいす版からの依頼が「りんくからの依頼」の枠に出る（2026-10-31 実機：10/1で出なかった）
    const D5 = "2026-10-01", m3 = api(t, "kv.get", ["v3:master"]).data.value;
    assert.ok(!api(t, "kv.get", ["sheet:" + D5]).data.value, "生活介護（現体制版）の10/1はまだ無い");
    api(t, "kv.cas", [{ key: "v3:sheet:" + D5, rev: 0, value: { runs: [{ id: "rqNEW", kind: "meet", time: "9:00", staffId: "__req__", vehicleId: "", userIds: [m3.users[0].id], staffRiderIds: [], note: "" }], blocks: [], staffOv: {} } }]);
    const W = await open("sougei.html", { width: 1400, height: 900 }, `window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="${D5}";`, "sougei_v1_1001.html");
    await W.pg.waitForTimeout(500); await W.pg.fill("#sghNo", "000"); await W.pg.fill("#sghPin", "5829"); await W.pg.click("#sghGo"); await W.pg.waitForTimeout(5000);
    assert.strictEqual(await W.pg.locator('[data-link-cell] [data-item-id="lk_rqNEW"]').count(), 1, "まだ保存されていない日でも依頼が出る");
    assert.ok((await W.pg.locator('[data-item-id="lk_rqNEW"]').innerText()).includes("りんく依頼"));
    await W.pg.screenshot({ path: "g_link_unsaved.png" });
    assert.deepStrictEqual(real(W.errs), []); await W.pg.context().close(); console.log("まだ無い日のりんく依頼: OK"); }
  console.log(await P.pg.evaluate(() => ({ react: !!window.React, root: document.getElementById("root").innerHTML.length, kv: !!window.__sgkv, setkv: typeof window.__sgSetKV, st: window.__sgkv && window.__sgkv.status() })));
  assert.strictEqual(await P.pg.getByRole("button", { name: /AI調整|AIと相談/ }).count(), 0, "料金がかかるAIのボタンは、キーが無ければ出ない");
  console.log("送迎表の表示:", (await P.pg.locator("text=/📅 カレンダー/").first().innerText().catch(() => "なし")), (await P.pg.locator('button[title="保存と同期の状況"]').innerText().catch(() => "なし")), "/ 画面エラー:", P.errs);
  // 管理者がカレンダーで「送迎」「ヘルプ」「利用者休み」「勤務時間変更」「その他予定」を入れる → 送迎表に反映
  // よみがな：送迎表の名前は「よみがな」シートに自動で並ぶ。読みを入れると、ひらがなで予測が出る
  const ys = g.sheets.get("よみがな"); assert.ok(ys && ys.data.some((r) => r[0] === "中村" && r[2] === "利用者"), "よみがなシートに利用者が並ぶ");
  ys.data.forEach((r) => { if (r[0] === "中村") r[1] = "なかむら"; if (r[0] === "日野") r[1] = "ひの"; });
  for (const k of [...g.cache.keys()]) if (k === "names5") g.cache.delete(k);
  const A = await open("calendar.html", { width: 390, height: 844 }, boot);
  await A.pg.waitForTimeout(500); await A.pg.fill("#sghNo", "000"); await A.pg.fill("#sghPin", "5829"); await A.pg.click("#sghGo"); await A.pg.waitForTimeout(2500);
  const pick = async (kind, name) => { await A.pg.fill("#f-sgq-" + kind, name); await A.pg.click(`[data-sgpick="${kind}"][data-name="${name}"]`); };
  await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300);
  assert.deepStrictEqual(await A.pg.$$eval('input[name="f-label"]', (o) => o.map((x) => x.value)), ["help", "ride", "user", "extra", "monitor", "shien", "leave", "hwork", "shift", "other"], "ラベルの並び");
  assert.strictEqual(await A.pg.evaluate(() => { const c = document.querySelector('input[name="f-label"]:checked'); return c && c.value + (document.activeElement === c ? ":focus" : ""); }), "help:focus", "開いたときはヘルプ");
  await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
  const add = async (label) => { await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-" + label); await A.pg.waitForTimeout(300); };
  const save = async (ms) => { await A.pg.click("[data-hsave]"); await A.pg.waitForTimeout(ms || 1500); };
  { // 職員時間変更の理由に「早出残業」（2026-10-31）
    await add("shift"); const fills = await A.pg.$$eval('[data-fill="w-reason"]', (b) => b.map((x) => x.textContent));
    assert.deepStrictEqual(fills, ["早出", "早出残業", "遅出", "残業", "遅刻・早退"]);
    await A.pg.click('[data-fill="w-reason"][data-v="早出残業"]'); await A.pg.waitForTimeout(200);
    assert.strictEqual(await A.pg.inputValue("#w-reason"), "早出残業", "押すと理由に入る");
    assert.strictEqual(await A.pg.locator("[data-ro-why]").count(), 0, "入力できる画面には理由の帯は出ない");
    await A.pg.locator("[data-close]").first().click(); await A.pg.waitForTimeout(300);
    if (await A.pg.locator("#evForm").count()) { await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(300); } }
  { // 職員時間変更の勤務：ﾏﾝｼｮﾝは時刻が入り送迎なし。9時間の職員（余村・森・窪田）は早6:00〜15:00、ほかは6:00〜14:00。休みは中抜け・時間休みの題名
    const D20 = "2026-11-20", setDay = async () => { await A.pg.fill("#f-date", D20); await A.pg.fill("#f-enddate", D20); };
    await add("shift"); await setDay(); await pick("staff", "森");
    assert.deepStrictEqual(await A.pg.$$eval('input[name="w-kinmu"]', (o) => o.map((x) => x.value)), ["", "早番", "遅番", "日勤", "早遅ﾏﾝｼｮﾝのみ", "早ﾏﾝｼｮﾝのみ", "遅ﾏﾝｼｮﾝのみ"]);
    await A.pg.locator('label:has(input[name="w-kinmu"][value="早ﾏﾝｼｮﾝのみ"])').click(); await A.pg.waitForTimeout(300);
    assert.deepStrictEqual([await A.pg.inputValue("#w-wst"), await A.pg.inputValue("#w-wet")], ["06:00", "15:00"], "森は9時間");
    assert.ok((await A.pg.locator(".sgbox").innerText()).includes("送迎（便）には入りません"));
    await A.pg.click('[data-sgrm="staff"][data-name="森"]'); await A.pg.waitForTimeout(200); await pick("staff", "八壁"); await A.pg.waitForTimeout(200);
    assert.deepStrictEqual([await A.pg.inputValue("#w-wst"), await A.pg.inputValue("#w-wet")], ["06:00", "14:00"], "ほかの職員は8時間");
    for (const [nm, end] of [["余村和", "14:00"], ["余村慎", "15:00"]]) {   // 9時間の余村は慎さんだけ
      await A.pg.click('.sgbox [data-sgrm="staff"]'); await A.pg.waitForTimeout(200); await pick("staff", nm); await A.pg.waitForTimeout(200);
      assert.strictEqual(await A.pg.inputValue("#w-wet"), end, nm); }
    await A.pg.click('.sgbox [data-sgrm="staff"]'); await A.pg.waitForTimeout(200); await pick("staff", "八壁"); await A.pg.waitForTimeout(200);
    await A.pg.locator(".sgbox").screenshot({ path: "g_kinmu.png" });
    await save(1500);
    await add("shift"); await setDay(); await pick("staff", "窪田"); await A.pg.locator('label:has(input[name="w-kinmu"][value="遅ﾏﾝｼｮﾝのみ"])').click(); await A.pg.waitForTimeout(300);
    assert.deepStrictEqual([await A.pg.inputValue("#w-wst"), await A.pg.inputValue("#w-wet")], ["13:00", "22:00"], "窪田の遅は13:00から");
    await save(1500);
    await add("shift"); await setDay(); await pick("staff", "日野"); await A.pg.locator('label:has(input[name="w-kinmu"][value="早番"])').click(); await A.pg.waitForTimeout(300);
    assert.ok((await A.pg.locator(".sgbox").innerText()).includes("早番の出勤・退勤の時刻を入れてください"), "早番は時刻を入れる");
    await A.pg.fill("#w-wst", "07:00"); await A.pg.fill("#w-wet", "16:00"); await save(1500);
    await add("leave"); await setDay(); await pick("staff", "白戸"); await A.pg.locator('label:has(input[name="w-leave"][value="naka"])').click(); await A.pg.waitForTimeout(300);
    await A.pg.fill("#f-start", "10:00"); await A.pg.fill("#f-end", "11:00"); await save(1500);
    await add("leave"); await setDay(); await pick("staff", "白戸"); await A.pg.locator('label:has(input[name="w-leave"][value="hours"])').click(); await A.pg.waitForTimeout(300);
    await A.pg.fill("#f-start", "13:00"); await A.pg.fill("#f-end", "15:00"); await save(1500);
    await add("leave"); await setDay(); await pick("staff", "安部"); await A.pg.locator('label:has(input[name="w-leave"][value="pm"])').click(); await A.pg.waitForTimeout(300); await save(1500);
    const evs = Object.values(api(t, "docs.query", [{ col: "days", from: D20, to: D20 }]).data.reduce((a, d) => Object.assign(a, d.events), {}));
    const by = (tt) => evs.find((e) => e.title === tt);
    assert.ok(by("八壁 早ﾏﾝｼｮﾝのみ") && by("八壁 早ﾏﾝｼｮﾝのみ").sg.noRide === true && by("八壁 早ﾏﾝｼｮﾝのみ").sg.wstart === "06:00", "題名・送迎なし " + evs.map((e) => e.title).join(","));
    assert.ok(by("窪田 遅ﾏﾝｼｮﾝのみ") && by("日野 早番") && !by("日野 早番").sg.noRide, "早番は送迎あり");
    assert.ok(by("白戸 中抜け") && by("白戸 2時間休み") && by("安部 PM休み"), "中抜け・時間休み・PM休みの題名 " + evs.map((e) => e.title).join(","));
    await A.pg.click(`.cell[data-day="${date}"]`); await A.pg.waitForTimeout(300); await A.pg.click("[data-day-close]"); await A.pg.waitForTimeout(300);   // 選んでいる日を元に戻す
    console.log("勤務・休みの題名:", evs.map((e) => e.title).join(" / ")); }
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
  console.log("予測:「なか」→", firstHit); await A.pg.fill("#w-dest", "○○病院"); await A.pg.fill("#f-start", "14:00"); await A.pg.check('input[name="w-hdur"][value="30"]'); await A.pg.waitForTimeout(200);   // ヘルプの時間：30分
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
  assert.strictEqual(hb.durMin, 30, "ヘルプの時間（30分）が送迎表に");
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
  { // スマホの月表示：スクロールしなくても1か月が見える（ブラウザの帯で画面が低いときも）。＋は右下の丸いボタン
    const fits = () => A.pg.evaluate(() => { scrollTo(0, 0); const g = document.getElementById("grid").getBoundingClientRect(); return { bottom: Math.round(g.bottom), vh: innerHeight }; });
    let f = await fits(); assert.ok(f.bottom <= f.vh, "1か月が画面に収まる " + JSON.stringify(f));
    await A.pg.setViewportSize({ width: 390, height: 640 }); await A.pg.waitForTimeout(600);
    f = await fits(); assert.ok(f.bottom <= f.vh, "画面が低くても収まる " + JSON.stringify(f)); await A.pg.screenshot({ path: "g_month_fit.png" });
    await A.pg.setViewportSize({ width: 390, height: 844 }); await A.pg.waitForTimeout(600);
    const fab = await A.pg.locator("#addBtn").boundingBox(); assert.ok(fab.x > 300 && fab.y > 700, "＋は右下 " + JSON.stringify(fab));
    console.log("スマホの月表示: 1画面に収まる"); }
  { // スマホの月表示：バーに題名。日付を押すとその日の一覧が下から出て、右上の＋で予定を入れる
    const chipTxt = await A.pg.locator(`.cell[data-day="${date}"] .ev-chip span`).first().innerText();
    assert.ok(chipTxt.length > 0 && await A.pg.locator(`.cell[data-day="${date}"] .ev-chip span`).first().isVisible(), "バーに題名が見える");
    await A.pg.locator(`.cell[data-day="${date}"]`).screenshot({ path: "g_cell.png" });
    await A.pg.click(`.cell[data-day="${date}"] .ev-chip >> nth=0`); await A.pg.waitForTimeout(300);
    assert.ok(await A.pg.locator(".daysheet").isVisible(), "日を押すとその日の一覧");
    const rows = await A.pg.locator(".daysheet .ds-row b").allInnerTexts(); assert.strictEqual(rows.length, await A.pg.locator("#panel .ev-row").count(), "その日の予定がぜんぶ並ぶ");
    await A.pg.screenshot({ path: "g_daysheet.png" });
    { const bgD = await A.pg.evaluate(() => getComputedStyle(document.querySelector(".daysheet")).backgroundColor), bgB = await A.pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.strictEqual(bgD, bgB, "日の一覧も月の背景と同じ色"); }
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
  { // 左右になぞると月が変わる。保存は月の読み直しを待たずに出る（遅れて届いた古い読み込みでも消えない）
    const cdp = await A.pg.context().newCDPSession(A.pg); await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const swipeX = async (dx, dy) => { await A.pg.waitForTimeout(400); /* 読み直しで表を描き直している間になぞらない */ const g = await A.pg.locator("#grid").boundingBox(); const x = g.x + g.width / 2, y = g.y + g.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (const f of [0.3, 0.6, 1]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * f, y: y + (dy || 0) * f }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await A.pg.waitForTimeout(400); };
    const lab = () => A.pg.locator("#monthLabel").innerText(), m0 = await lab();
    await swipeX(-160); const m1 = await lab(); assert.notStrictEqual(m1, m0, "左へなぞると次の月");
    await swipeX(160); assert.strictEqual(await lab(), m0, "右へなぞると前の月");
    await swipeX(40, 200); assert.strictEqual(await lab(), m0, "縦になぞっても月は変わらない");
    await swipeX(-160); assert.strictEqual(await lab(), m1);
    const day = await A.pg.locator("#grid .cell[data-day]:not(.out)").nth(14).getAttribute("data-day");
    await A.pg.evaluate(() => { window.__HOLDQ = 4000; window.__QN = 0; });
    A.pg.evaluate(() => window.SGHost.refreshCalendar());   // 保存の前に読み始めた分が、保存のあとに届く
    await A.pg.waitForTimeout(200);
    await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-other"); await A.pg.waitForTimeout(300);
    await A.pg.fill("#f-title", "速い保存の試し"); await A.pg.fill("#f-date", day); await A.pg.fill("#f-start", "10:00"); await A.pg.fill("#f-end", "11:00");
    const t0 = Date.now(); await A.pg.click("[data-hsave]");
    await A.pg.waitForFunction(() => document.getElementById("evForm") == null && !/送信中|未送信/.test(document.getElementById("syncText").textContent) && JSON.stringify(Object.keys(localStorage)).indexOf("tc:op:") < 0, null, { timeout: 3000 });
    const ms = Date.now() - t0;
    assert.ok(JSON.stringify(api(t, "docs.query", [{ col: "days", from: day, to: day }]).data).includes("速い保存の試し"), "サーバーに保存されている");
    assert.ok((await A.pg.locator("#grid").innerText()).includes("速い保存") || (await A.pg.locator(`#grid .cell[data-day="${day}"]`).textContent()).includes("速い保存"), "保存した予定が出ている");
    await A.pg.waitForTimeout(4500);
    assert.ok(await A.pg.evaluate(() => window.__QN) >= 1, "遅い読み込みが本当に届いた");
    assert.ok((await A.pg.locator(`#grid .cell[data-day="${day}"]`).textContent()).includes("速い保存"), "古い読み込みが後から届いても消えない");
    await A.pg.evaluate(() => { window.__HOLDQ = 0; });
    await swipeX(160); assert.strictEqual(await lab(), m0);
    await A.pg.click(`.cell[data-day="${date}"]`); await A.pg.waitForTimeout(300); await A.pg.click("[data-day-close]"); await A.pg.waitForTimeout(300);   // 選んでいる日を元に戻す
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await cdp.detach();
    console.log("左右になぞって月:", m0, "→", m1, "/ 保存済みまで", ms, "ms（月の読み直しは4秒かかる設定）"); }
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
  { // 休日出勤・職員時間変更の「その日の部署」：最初からその職員のいつもの部署（嫁島など）。いつもと同じなら変更なしで保存
    const m0 = api(t, "kv.get", ["v2:master"]).data.value, hi = m0.staff.find((x) => x.name === "日野"), dn = (id) => (m0.departments.find((x) => x.id === id) || {}).name;
    const usual = dn((hi.deptByDay || {})["1"] || hi.deptId);   // 11/2は月曜
    await A.pg.click("#addBtn"); await A.pg.waitForTimeout(300); await A.pg.check("#f-label-shift"); await A.pg.waitForTimeout(300);
    assert.ok(!(await A.pg.locator("#w-dept").innerText()).includes("いつもの部署"), "「いつもの部署」とは出さない");
    await A.pg.fill("#f-sgq-staff", "日野"); await A.pg.click('[data-sgpick="staff"][data-name="日野"]'); await A.pg.waitForTimeout(300);
    assert.strictEqual(await A.pg.inputValue("#w-dept"), usual, "最初から日野のいつもの部署");
    assert.ok((await A.pg.locator("#w-dept option:checked").innerText()).includes("（いつも）"));
    await A.pg.locator(".sgbox").screenshot({ path: "g_dept_usual.png" });
    await A.pg.locator("[data-close]").first().click(); await A.pg.waitForTimeout(300);
    if (await A.pg.locator("#evForm").count()) { await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(300); }
    console.log("その日の部署: 日野 →", usual); }
  { // 1つの予定に1人：休み・送迎・ヘルプ・その他予定の担当は1人選ぶと検索の欄が消える（×で外すと戻る）。モニタリング・支援会議の対応者だけ何人でも
    await add("leave"); await pick("staff", "八壁");
    assert.strictEqual(await A.pg.locator("#f-sgq-staff").count(), 0, "1人選んだら検索の欄は出ない");
    assert.ok((await A.pg.locator(".sgbox").innerText()).includes("1つの予定に1人です"));
    await A.pg.locator(".sgbox").screenshot({ path: "g_oneonly.png" });
    await A.pg.click('[data-sgrm="staff"][data-name="八壁"]'); await A.pg.waitForTimeout(200);
    assert.strictEqual(await A.pg.locator("#f-sgq-staff").count(), 1, "×で外すと選び直せる");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
    await add("help"); await pick("users", "中村"); assert.strictEqual(await A.pg.locator("#f-sgq-users").count(), 0, "ヘルプも1人");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
    await add("other"); await pick("staff", "八壁");
    assert.strictEqual(await A.pg.locator("#f-sgq-staff").count(), 0, "その他予定の担当も1人（2026-10-31〜）");
    assert.strictEqual(await A.pg.locator('.sgbox [data-sgrm="staff"]').count(), 1);
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
    await add("monitor"); await pick("staff", "八壁"); await pick("staff", "日野");
    assert.strictEqual(await A.pg.locator('.sgbox [data-sgrm="staff"]').count(), 2, "モニタリングの対応者は何人でも");
    await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(200);
    console.log("1つの予定に1人: 休み・ヘルプ・その他予定は1人 / モニタリングの対応者は複数"); }
  { // 事業の取り違え：放課後デイだけの職員の休みを生活介護に入れようとすると確認が出る。入れた予定には「⚠別の事業」の印
    await A.pg.click('[data-biz="seikatsu"]'); await A.pg.waitForTimeout(300);
    await add("leave"); await pick("staff", "放デイ太郎");
    await A.pg.click("[data-hsave]"); await A.pg.waitForTimeout(300);
    const msg = await A.pg.locator("#f-err").innerText(); assert.ok(msg.includes("「生活介護」の予定ですが、放デイ太郎さんは放課後デイの人です"), msg);
    await A.pg.click("[data-hsave]"); await A.pg.waitForTimeout(1500); assert.strictEqual(await A.pg.locator("#evForm").count(), 0, "もう一度押すと入る");
    const row = A.pg.locator("#panel .ev-row", { hasText: "放デイ太郎" }); assert.ok((await row.innerHTML()).includes("⚠別の事業"), "カレンダーに別の事業の印");
    await A.pg.click('[data-biz="all"]'); await A.pg.waitForTimeout(300);
    console.log("事業の取り違え:", msg.slice(0, 40)); }
  { // 放課後デイだけの職員がログインすると、最初は「放課後デイ」のタブ
    const r = rows().find((x) => x[1] === "放デイ太郎"); assert.ok(r, "職員IDに放デイ太郎");
    const H = await open("calendar.html", { width: 390, height: 844 }, boot, "calendar_hd.html");
    await H.pg.waitForTimeout(500); await H.pg.fill("#sghNo", String(r[0])); await H.pg.fill("#sghPin", String(r[3])); await H.pg.click("#sghGo"); await H.pg.waitForTimeout(800);
    await H.pg.fill("#sghOld", String(r[3])); await H.pg.fill("#sghNew", "4826"); await H.pg.fill("#sghNew2", "4826"); await H.pg.evaluate(() => document.getElementById("sghPinF").requestSubmit()); await H.pg.waitForTimeout(3000);
    assert.strictEqual(await H.pg.evaluate(() => document.documentElement.dataset.biz), "houkago", "放課後デイのタブから開く");
    await H.pg.click("#addBtn"); await H.pg.waitForTimeout(300); assert.ok(await H.pg.locator("#f-biz-houkago").isChecked(), "新しい予定も放課後デイ");
    assert.deepStrictEqual(real(H.errs), []); await H.pg.context().close(); console.log("放課後デイの職員: 最初は放課後デイのタブ"); }
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
  { const hb2 = api(t, "kv.get", ["sheet:" + date]).data.value.blocks.find((x) => x.calId && x.kind === "help");   // 送迎表でもヘルプの時間を選べる（カレンダーで選んだ30分が選ばれている）
    await P.pg.click(`[data-item-id="${hb2.id}"]`); await P.pg.waitForTimeout(400);
    assert.ok((await P.pg.locator("[data-help-dur] button.bg-sky-600").innerText()) === "30分", "送迎表のヘルプの時間");
    await P.pg.locator("[data-help-dur]").screenshot({ path: "g_help_dur.png" });
    await P.pg.click('[data-dur="60"]'); await P.pg.click('button:text-is("保存")'); await P.pg.waitForTimeout(1500);
    let d2 = null; for (let i = 0; i < 20 && !(d2 && d2.durMin === 60); i++) { await P.pg.waitForTimeout(500); d2 = api(t, "kv.get", ["sheet:" + date]).data.value.blocks.find((x) => x.id === hb2.id); }
    assert.strictEqual(d2.durMin, 60, "送迎表で1時間に変えられる"); console.log("ヘルプの時間: カレンダー30分 → 送迎表で1時間に"); }
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
