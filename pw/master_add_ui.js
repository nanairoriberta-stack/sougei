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
  let failCas = false;   // 書き込みを失敗させる（送迎表を開くときの手直しが失敗しても開けるかの試し）
  const b = await chromium.launch();
  async function open(file, vp, boot, outName, extraInit) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: "light" }); const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text().slice(0, 200)); });
    await pg.exposeFunction("__gasApi", (tk, m, a) => (failCas && m === "kv.cas" ? { ok: false, error: { code: "busy", message: "こみあっています" } } : api(tk, m, a)));
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
  putEv("ev_kotaki01", { title: "小瀧 研修", label: "sother", tanto: ["小瀧"] });   // 職員その他・終日（2026-11-11 依頼者「小瀧 研修 出てない」）
  putEv("ev_away0001", { title: "日野 中抜け", label: "leave", allDay: false, start: "13:00", end: "15:00", sg: { type: "staff_off", staff: ["日野"], reason: "中抜け" } });   // 中抜けは灰色（コマにしない。2026-11-05 依頼者）
  { // Excelから取り込んだような通常外のヘルプ（同じものが2件、保留・18:00）。「送迎表にある通常外の予定で、この欄に無いもの」から消せる（2026-11-04 依頼者）
    const s0 = api(t, "kv.get", ["v2:sheet:2026-11-02"]).data.value;
    const add = [{ id: "imp_x1", kind: "help", time: "18:00", staffId: "__hold__", label: "増野(いきいき)ヘルプ", vehicleId: "" }, { id: "imp_x2", kind: "help", time: "18:00", staffId: "__hold__", label: "増野(いきいき)ヘルプ", vehicleId: "", noteOnly: true }];
    api(t, "kv.merge", [{ key: "v2:sheet:2026-11-02", base: s0, baseKnown: true, mine: { ...s0, blocks: [...s0.blocks, ...add] } }]);
    const E2 = engFor("v2"), mm = api(t, "kv.get", ["v2:master"]).data.value;   // 月曜の週間パターン（「通常」が分かるように）
    api(t, "kv.cas", [{ key: "v2:pattern:1", rev: 0, value: E2.resolveSeedPattern(mm, E2.SEED_PATTERNS.mon) }]); }
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
  { // ルール⑪ 家族送り・家族迎えなど：追加・変更・削除 → 保存され、カレンダーの選択肢（names.list）に出る（2026-11-05 依頼者）
    await P.pg.click('button:text-is("ルール")'); await P.pg.waitForTimeout(500);
    const sec = P.pg.locator("div.mb-4", { has: P.pg.locator("text=⑪ 家族送り・家族迎えなど") });
    assert.strictEqual(await sec.locator("[data-nr-text]").count(), 3, "最初は 家族送り・受診後送り・家族迎え");
    await sec.locator("[data-nr-text]").nth(1).fill("受診後に来所"); await P.pg.waitForTimeout(200);   // 変更
    await sec.locator('button:text-is("＋ 追加")').click(); await P.pg.waitForTimeout(200);
    await sec.locator("[data-nr-text]").nth(3).fill("母送り"); await P.pg.waitForTimeout(200);          // 追加（迎え）
    await sec.locator("tbody tr").nth(2).locator("button").last().click(); await P.pg.waitForTimeout(300);   // 削除（家族迎え）
    await P.pg.waitForTimeout(3000);
    const nr = api(t, "kv.get", ["v2:master"]).data.value.rules.noRideReasons;
    assert.deepStrictEqual(nr.map((x) => x.kind + ":" + x.text), ["meet:家族送り", "meet:受診後に来所", "meet:母送り"], "保存 " + JSON.stringify(nr));
    for (const k of [...g.cache.keys()]) if (k === "names8") g.cache.delete(k);
    const nl = api(t, "names.list", []).data.noRide;
    assert.deepStrictEqual(nl, { meet: ["家族送り", "受診後に来所", "母送り"], send: [] }, "カレンダーの選択肢 " + JSON.stringify(nl));
    console.log("ルール⑪ 送迎なしの理由：変更・追加・削除 → カレンダーの選択肢", JSON.stringify(nl)); }
  { // 部署でしぼっているときは、その部署の人として足す（しぼりで見えなくならない）
    await P.pg.click('button:text-is("利用者")'); await P.pg.waitForTimeout(500);
    const ms = api(t, "kv.get", ["v2:master"]).data.value, d2 = ms.departments[1];
    const sel = P.pg.locator("select").filter({ has: P.pg.locator(`option[value="${d2.id}"]`) }).first(); await sel.selectOption(d2.id); await P.pg.waitForTimeout(400);
    await P.pg.click('button:text-is("+ 利用者を追加")'); await P.pg.waitForTimeout(3000);
    const w = await where(); assert.ok(w.at === w.n - 1 && w.val === "", "しぼっていても見える " + JSON.stringify(w));
    const nu = api(t, "kv.get", ["v2:master"]).data.value.users.slice(-1)[0]; assert.strictEqual(nu.deptId, d2.id, "しぼっている部署で足す");
    console.log("部署でしぼっていても：" + d2.name + "の利用者として足す OK"); }
  { // 検索で「コマだけ消す」にした予定へ
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(1500);
    // 検索「いきいき」：表のコマ（1件目）と、「コマだけ消す」にした予定（2件目＝下の特記事項の欄が開いてその行へ）。2026-11-04 依頼者「1/1と出るけど画面が移動しない」
    await P.pg.fill('input[placeholder="🔍 検索(Ctrl+F)"]', "いきいき"); await P.pg.waitForTimeout(800);
    const hitAt = () => P.pg.evaluate(() => { const el = document.querySelector(".ring-rose-500"); if (!el) return null; const a = el.getBoundingClientRect(); return { id: el.getAttribute("data-item-id") || el.getAttribute("data-noteonly-id"), inView: a.top >= 0 && a.bottom <= innerHeight }; });
    const h1 = await hitAt(); await P.pg.keyboard.press("Enter"); await P.pg.waitForTimeout(1000); const h2 = await hitAt();
    assert.ok(h1 && h1.inView && h2 && h2.inView && new Set([h1.id, h2.id]).size === 2 && [h1.id, h2.id].includes("imp_x2"), "表のコマとコマだけ消した予定の両方へ移る " + JSON.stringify([h1, h2]));
    assert.ok((await P.pg.locator("text=表に出していない予定・下の特記事項の欄").count()) + (await P.pg.locator("[data-noteonly-list]").count()) >= 1, "特記事項の欄が開く");
    await P.pg.fill('input[placeholder="🔍 検索(Ctrl+F)"]', ""); await P.pg.waitForTimeout(300);
    console.log("検索「いきいき」：表のコマと、コマだけ消した予定（特記事項の欄）へ移る OK");
    // 「通常外のヘルプ・その他予定(この日だけ)」の欄はなくした（2026-11-05 依頼者）。画面にも出前の確認にも出ない・データは残す
    assert.strictEqual(await P.pg.locator("text=通常外のヘルプ・その他予定(この日だけ)").count(), 0, "欄が無い");
    assert.strictEqual(await P.pg.locator("[data-unlisted-del]").count(), 0);
    assert.strictEqual(api(t, "kv.get", ["v2:sheet:2026-11-02"]).data.value.blocks.filter((b) => /増野/.test(b.label || "")).length, 2, "送迎表のコマはそのまま");
    console.log("通常外のヘルプ・その他予定の欄：なし OK"); }
  { // 検索：ヒットの場所へ表が動く（右の方の職員の列でも。2026-11-03 依頼者「検索してもその場所に画面が移動しない」）
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(1500);
    const shv = api(t, "kv.get", ["v2:sheet:2026-11-02"]).data.value, mv = api(t, "kv.get", ["v2:master"]).data.value;
    const cnt = {}; shv.runs.forEach((r) => (r.userIds || []).forEach((id) => (cnt[id] = (cnt[id] || 0) + 1)));
    const uid2 = Object.keys(cnt).find((id) => cnt[id] >= 2) || shv.runs.find((r) => (r.userIds || []).length).userIds[0];
    const nm = mv.users.find((u) => u.id === uid2).name;
    const inView = () => P.pg.evaluate(() => { const el = document.querySelector(".ring-rose-500"), g = el && el.closest(".always-scrollbar"); if (!el || !g) return null;
      const a = el.getBoundingClientRect(), r = g.getBoundingClientRect(); return { ok: a.left >= r.left && a.right <= r.right && a.top >= r.top && a.bottom <= r.bottom && a.top >= 0 && a.bottom <= innerHeight, x: Math.round(a.left), gl: g.scrollLeft }; });
    await P.pg.fill('input[placeholder="🔍 検索(Ctrl+F)"]', nm); await P.pg.waitForTimeout(800);
    const seen = [];
    for (let i = 0; i < 3; i++) { const v = await inView(); assert.ok(v && v.ok, `検索「${nm}」${i + 1}件目が見える所に ` + JSON.stringify(v)); seen.push(v.gl); await P.pg.keyboard.press("Enter"); await P.pg.waitForTimeout(600); }
    await P.pg.evaluate(() => { const g = document.querySelector(".always-scrollbar[style*='62vh'], .always-scrollbar.border"); if (g) g.scrollLeft = 0; });
    await P.pg.fill('input[placeholder="🔍 検索(Ctrl+F)"]', ""); await P.pg.waitForTimeout(300);
    console.log(`検索「${nm}」：ヒットの場所へ表が動く（横の位置 ${seen.join("→")}）`); }
  { // 特記事項：利用者の予定は利用者、職員の休みは職員、どちらでもないものは連絡事項（カレンダーから自動）
    await P.pg.waitForTimeout(1000);
    if (await P.pg.locator('button:has-text("特記事項・男性カバー・配車を表示")').count()) { await P.pg.click('button:has-text("特記事項・男性カバー・配車を表示")'); await P.pg.waitForTimeout(500); }   // 検索で開いていればそのまま
    const tx = async (sel) => (await P.pg.locator(sel).count()) ? await P.pg.locator(sel).innerText() : "";
    const au = await tx("[data-auto-user]"), as = await tx("[data-auto-staff]"), ab = await tx("[data-auto-biz]");
    assert.ok(au.includes(uN + " 通院 10:00〜12:00") && !au.includes(pS.name), "利用者の欄 " + au);
    assert.ok(as.includes(pS.name + " PM休み") && !as.includes(uN + " 通院"), "職員の欄 " + as);
    assert.ok(ab.includes("松養生高２女性 現場実習"), "連絡事項 " + ab);
    const pt = await tx(`[data-part="${pS.id}"]`); if (pS.emp === "パート") assert.ok(pt && !pt.includes(pS.end), "パート職員の出欠にPM休の退勤 " + pt + " / いつも " + pS.end);
    console.log("特記事項（カレンダーから）：利用者「" + au.split("\n")[1] + "」 職員「" + as.split("\n")[1] + "」 連絡事項「" + ab.split("\n").slice(-1)[0] + "」 パート「" + pt + "」"); }
  { // 中抜け（2026-11-05 依頼者）：カレンダーの中抜けはコマを出さず灰色・新見さんのいつもの中抜け（14:00〜16:00）も灰色。職員のタブで直せる
    const mv = api(t, "kv.get", ["v2:master"]).data.value, ni = mv.staff.find((x) => x.name === "新見"), hi = mv.staff.find((x) => x.name === "日野");
    assert.ok(api(t, "kv.get", ["v2:sheet:2026-11-02"]).data.value.blocks.some((b) => b.id === "cal_ev_away0001_" + hi.id), "データには不在のコマがある");
    const cellOf = (sid, hm) => P.pg.evaluate(([sid, hm]) => { const th = document.querySelector(`[data-away="${sid}"], [data-staff-col="${sid}"]`); const hd = th && th.closest("th"); if (!hd) return null;
      const tr = hd.closest("tr"), ci = [...tr.children].indexOf(hd), body = hd.closest("table").querySelectorAll("tbody tr");
      for (const r of body) { const c0 = r.children[0]; if (c0 && c0.textContent.trim() === hm) { const td = r.children[ci]; return td ? { grey: /bg-stone-100/.test(td.className), text: td.innerText } : null; } } return null; }, [sid, hm]);
    assert.match(await P.pg.locator(`[data-away="${ni.id}"]`).innerText(), /中抜け14:00-16:00/, "新見さんの欄に中抜け");
    const n14 = await cellOf(ni.id, "14:00"), n13 = await cellOf(ni.id, "13:00"), n16 = await cellOf(ni.id, "16:00");
    assert.ok(n14 && n14.grey && n13 && !n13.grey && n16 && !n16.grey, "新見さん 14:00は灰色・13:00と16:00は白 " + JSON.stringify([n13, n14, n16]));
    assert.strictEqual(await P.pg.evaluate((sid) => { const hd = document.querySelector(`[data-away="${sid}"]`) || document.querySelector("th"); return [...document.querySelectorAll("table")].filter((t) => t.querySelector("[data-away]")).map((t) => t.innerText).join("").includes("不在（日野"); }, ni.id), false, "カレンダーの中抜けは表にコマで出さない（特記事項には出る）");
    await P.pg.click('button:text-is("職員")'); await P.pg.waitForTimeout(500);
    assert.strictEqual(await P.pg.locator(`[data-away-from="${ni.id}"]`).inputValue(), "14:00", "職員のタブに中抜け");
    await P.pg.fill(`[data-away-from="${hi.id}"]`, "12:00"); await P.pg.fill(`[data-away-to="${hi.id}"]`, "12:30"); await P.pg.waitForTimeout(3000);
    const h2 = api(t, "kv.get", ["v2:master"]).data.value.staff.find((x) => x.id === hi.id); assert.ok(h2.awayFrom === "12:00" && h2.awayTo === "12:30", "職員のタブで入れた中抜けが保存される");
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(1500);
    const g13 = await cellOf(hi.id, "13:00"), g12 = await cellOf(hi.id, "12:00");
    assert.ok(g13 && g13.grey && g12 && g12.grey, "日野さん：カレンダーの中抜け13:00・職員のタブの中抜け12:00も灰色 " + JSON.stringify([g12, g13]));
    console.log("中抜け：灰色（コマにしない）・職員のタブで入れられる OK"); }
  { // 職員その他「小瀧 研修」（終日）が小瀧さんの欄の8:30にコマで出る（2026-11-11 依頼者「出てない・検索でも引っかからない」）
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(1500);
    const kt = await P.pg.$$eval('[data-item-id^="cal_ev_kotaki01"]', (l) => l.map((x) => x.innerText));
    const sv = api(t, "kv.get", ["v2:sheet:2026-11-02"]).data.value, kb = sv.blocks.find((b) => b.calId === "ev_kotaki01");
    assert.ok(kt.some((x) => x.includes("小瀧 研修")), "表にコマ " + JSON.stringify(kt) + " / 保存 " + JSON.stringify(kb));
    console.log("小瀧 研修のコマ OK", JSON.stringify(kb && { t: kb.time, s: kb.staffId })); }
  { // ヘルプ可（2026-11-11 依頼者「職員の所にヘルプ可のチェックボックス、表示の一番右にヘルプ可の人だけ表示されるボタン」）
    const mv = api(t, "kv.get", ["v2:master"]).data.value, hi = mv.staff.find((x) => x.name === "日野");
    await P.pg.click('button:text-is("職員")'); await P.pg.waitForTimeout(500);
    await P.pg.check(`[data-help-ok="${hi.id}"]`); await P.pg.waitForTimeout(3000);
    assert.strictEqual(api(t, "kv.get", ["v2:master"]).data.value.staff.find((x) => x.id === hi.id).helpOk, true, "ヘルプ可が保存される");
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(1500);
    const cols = () => P.pg.$$eval("[data-staff-col]", (l) => [...new Set(l.map((x) => x.getAttribute("data-staff-col")))]);
    const all = await cols();
    const chips = await P.pg.$$eval("[data-help-filter]", (l) => l.map((x) => x.previousElementSibling && x.previousElementSibling.textContent));
    assert.ok(chips.length >= 1, "表示：の一番右にヘルプ可");
    await P.pg.click("[data-help-filter] >> nth=0"); await P.pg.waitForTimeout(500);
    const only = await cols();
    assert.deepStrictEqual(only, [hi.id], "ヘルプ可の人だけの列 " + JSON.stringify(only) + " / 全部 " + all.length);
    await P.pg.click("[data-help-filter] >> nth=0"); await P.pg.waitForTimeout(500);
    assert.strictEqual((await cols()).length, all.length, "もう一度押すと全部署");
    console.log("ヘルプ可：職員のタブのチェック・表示のボタン OK", all.length, "→", only.length); }
  { // 週間パターンを印刷（Excel）・ヘルプ表は週間パターンとは別（2026-11-06 依頼者）
    await P.pg.click('button:text-is("週間パターン")'); await P.pg.waitForTimeout(1200);
    await P.pg.click('button:text-is("月")'); await P.pg.waitForTimeout(1200);
    // ダウンロードは画面の中で受け取る（ファイル名と中身）
    await P.pg.evaluate(() => { window.__dl = null; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = { name: this.download, href: this.href }; return; } return o.call(this); }; });
    await P.pg.click("[data-pattern-print]");
    await P.pg.waitForFunction(() => window.__dl, null, { timeout: 20000 });
    const got = await P.pg.evaluate(async () => { const r = await fetch(window.__dl.href); const b = new Uint8Array(await r.arrayBuffer()); return { name: window.__dl.name, bytes: Array.from(b) }; });
    const fn = got.name; assert.ok(/^週間パターン_月曜日_.*\.xlsx$/.test(fn), "週間パターンのExcel " + fn);
    const ExcelJS = require("exceljs"); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(got.bytes));
    const ws = wb.getWorksheet("送迎表"); assert.match(String(ws.getRow(1).getCell(2).value), /^月曜日の週間(パターン|ﾊﾟﾀｰﾝ)$/, "日付のかわりに「月曜日の週間パターン」（Excelは半角カナ）");
    let n = 0; ws.eachRow((row) => row.eachCell((c) => { if (/ﾍﾙﾌﾟ|迎|送/.test(String(c.value || ""))) n++; })); assert.ok(n > 10, "便・ヘルプが入っている " + n);
    await P.pg.click('button:text-is("ヘルプ表")'); await P.pg.waitForTimeout(150);
    assert.strictEqual(await P.pg.locator("text=読み込み中…").count(), 0, "ヘルプ表は開いてすぐ出る（週間パターンを読みに行かない。2026-11-07）"); await P.pg.waitForTimeout(650);
    const hb = (api(t, "kv.get", ["v2:master"]).data.value.rules || {}).helpBase || [];
    assert.ok(await P.pg.locator("text=ヘルプ表に登録したヘルプはありません").count() === (hb.length ? 0 : 1), "週間パターンのヘルプは行にしない（登録" + hb.length + "件）");
    assert.strictEqual(await P.pg.locator('button:has-text("週間パターンの担当を基本として一括登録")').count(), 0, "週間パターンからの一括登録はなし");
    await P.pg.click('button:text-is("＋ ヘルプを追加")'); await P.pg.waitForTimeout(300);
    console.log("週間パターンの印刷:", fn, "／ヘルプ表は登録した行だけ"); }
  { // 送迎表の日付選びも月曜始まり（2026-11-07 依頼者「すべてのカレンダー」）
    await P.pg.click('button:text-is("送迎表(日別)")'); await P.pg.waitForTimeout(800);
    await P.pg.click("[data-datepop]"); await P.pg.waitForTimeout(200);
    const heads = await P.pg.$$eval('[aria-label="日付を選ぶ"] .grid > span.text-xs', (o) => o.map((x) => x.textContent));
    assert.deepStrictEqual(heads, ["月", "火", "水", "木", "金", "土", "日"], "日付選びは月曜から " + heads.join(""));
    const firstBtn = await P.pg.$eval('[aria-label="日付を選ぶ"] .grid button[data-day]', (b) => ({ d: b.dataset.day, col: [...b.parentElement.children].indexOf(b) - 7 }));
    assert.strictEqual(firstBtn.col, (new Date(firstBtn.d + "T00:00:00").getDay() + 6) % 7, "1日が正しい曜日の列 " + JSON.stringify(firstBtn));
    await P.pg.keyboard.press("Escape"); await P.pg.waitForTimeout(200); }
  { // 期間の出欠（Excel）：右下の名前のボタン → メニュー → 期間を選んで出す（2026-11-07 依頼者）
    await P.pg.evaluate(() => { window.__dl = null; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = { name: this.download, href: this.href }; return; } return o.call(this); }; });
    await P.pg.click(".sgh-chip"); await P.pg.waitForTimeout(200); await P.pg.click('.sgh-menu [data-a="att"]'); await P.pg.waitForTimeout(200);
    await P.pg.fill("#sghAttFrom", "2026-11-01"); await P.pg.fill("#sghAttTo", "2026-11-07"); await P.pg.click("[data-att-go]");
    await P.pg.waitForFunction(() => window.__dl, null, { timeout: 20000 });
    const got = await P.pg.evaluate(async () => { const r = await fetch(window.__dl.href); return { name: window.__dl.name, bytes: Array.from(new Uint8Array(await r.arrayBuffer())) }; });
    assert.strictEqual(got.name, "出欠一覧_生活介護_2026-11-01〜2026-11-07.xlsx");
    const ExcelJS = require("exceljs"); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(got.bytes));
    const wu = wb.getWorksheet("利用者"), wsf = wb.getWorksheet("職員"); assert.ok(wu && wsf, "利用者・職員のシート");
    assert.deepStrictEqual([3, 4, 9].map((c) => String(wu.getCell(2, c).value)), ["11/1(日)", "11/2(月)", "11/7(土)"], "日付の列");
    let marks = 0; wu.eachRow((row, rn) => { if (rn > 2) row.eachCell((c) => { if (c.value === "○") marks++; }); }); assert.ok(marks > 50, "来る人の○ " + marks);
    assert.ok(String(wsf.getCell(1, 1).value).includes("公休＝固定休"));
    assert.match(await P.pg.locator("#sghAttMsg").innerText(), /出しました/);
    await P.pg.click("#sghAttClose"); await P.pg.waitForTimeout(200);
    console.log("期間の出欠（Excel）:", got.name, "○", marks); }
  assert.deepStrictEqual(P.errs.filter((e) => !/net::ERR_FAILED|favicon/.test(e)), [], "画面エラーなし");
  // 送迎表を開くときの手直し（中抜けの初期値）が書き込みの失敗で止まっても、「読み込み中…」のままにしないで開く（2026-11-09 依頼者「読み込みがすごい時間かかってる」）
  { const m1 = api(t, "kv.get", ["master"]).data.value, r1 = api(t, "kv.get", ["master"]).data.rev; const { away1, ...noFlag } = m1;
    api(t, "kv.cas", [{ key: "master", rev: r1, value: noFlag }]); failCas = true;
    const L = await open("sougei.html", { width: 1200, height: 800 }, 'window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_DATE="2026-11-02";', "loading_v1.html");
    await L.pg.waitForTimeout(500); await L.pg.fill("#sghNo", "000"); await L.pg.fill("#sghPin", "5829"); await L.pg.click("#sghGo");
    await L.pg.waitForSelector("[data-loading-step]", { timeout: 5000 }).then(async () => assert.match(await L.pg.locator("[data-loading-step]").innerText(), /を読んでいます（\d+秒）/), () => {});
    await L.pg.waitForTimeout(6000);
    assert.strictEqual(await L.pg.locator("[data-loading]").count(), 0, "手直しが失敗しても送迎表が開く");
    assert.ok(await L.pg.locator('button:text-is("職員")').count() > 0, "送迎表の画面");
    failCas = false; await L.pg.context().close(); console.log("読み込み：手直しが失敗しても開く OK"); }
  console.log("画面エラー: []");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
