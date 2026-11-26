/* Google版の検証：本番と同じ .gs をそのまま模擬環境で動かし、端末側も本番と同じ同期エンジンを使う */
"use strict";
const path = require("path"), assert = require("assert");
const { makeGas } = require("./fakegas.js");
const D = path.join(__dirname, "out");
global.window = {};
global.SGKV = require("../kvsync.js");
const TC = require("../calcore.js");
const { createKVGas } = require("./kvgas.js");
const SC = require("../calsync.js");

const SCALE = 40, realStart = Date.now(), vStart = Date.parse("2026-10-26T08:00:00+09:00");
const now = () => vStart + (Date.now() - realStart) * SCALE;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms / SCALE)));
let seed = 4242; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const engFor = (ed) => { global.window = { __SG_EDITION: ed }; delete require.cache[require.resolve("../eng.cjs")]; return require("../eng.cjs"); };

function newServer() { const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Lib5_shift.gs", "Code.gs"].map((f) => path.join(D, f))); g.ctx.setup(); return g; }
function memStore() { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); return true; }, del: (k) => m.delete(k), keys: (p) => [...m.keys()].filter((k) => k.startsWith(p)), persistent: true }; }
/* 端末：google.script.run の代わりに、通信の遅れ・切断・応答消失を挟んでサーバーの api() を呼ぶ */
function device(g, fault = {}, store) {
  const f = Object.assign({ offline: false, lostAck: 0, lat: [40, 300] }, fault);
  const st = store || memStore(); let token = st.get("tk") || "";
  const lat = () => f.lat[0] + rnd() * (f.lat[1] - f.lat[0]);
  async function raw(method, args) {
    await sleep(lat());
    if (f.offline) throw { code: "unavailable" };
    const r = JSON.parse(JSON.stringify(g.ctx.api(token, method, JSON.parse(JSON.stringify(args)))));
    await sleep(lat());
    if (rnd() < f.lostAck && method !== "auth.login") throw { code: "unavailable", message: "応答が消えた" };
    if (!r.ok) throw { code: r.code, message: r.message };
    return r.data;
  }
  const call = (m, ...a) => raw(m, a);
  const d = { f, st, call, raw,
    async login(no, pin) { const r = await raw("auth.login", [no, pin, "test"]); token = r.token; st.set("tk", token); return r.me; },
    setToken(t) { token = t; } };
  d.kv = () => (d._kv || (d._kv = createKVGas({ call, store: st, now, sleep })));
  d.cal = (me) => (d._cal || (d._cal = TC.createCore({ db: null, store: TC.makeStore(lsOf(st)), now, sleep, random: rnd, me, runOp: (op) => call("cal.apply", op) })));
  return d;
}
function lsOf(st) { return { getItem: (k) => st.get("c:" + k), setItem: (k, v) => st.set("c:" + k, v), removeItem: (k) => st.del("c:" + k), key: (i) => st.keys("c:")[i] ? st.keys("c:")[i].slice(2) : null, get length() { return st.keys("c:").length; } }; }
const idRows = (g) => g.sheets.get("職員ID").data.slice(1).filter((r) => r[0] !== "" && r[0] !== undefined);
const pinOf = (g, name) => String(idRows(g).find((r) => r[1] === name)[3]);
const noOf = (g, name) => String(idRows(g).find((r) => r[1] === name)[0]);
async function settleKV(ds) { for (let i = 0; i < 400; i++) { if (ds.every((d) => { const s = d.kv().status(); return !s.queued && !s.running; })) return; ds.forEach((d) => d.kv().kick()); await sleep(2000); } throw new Error("kv timeout"); }
async function settleCal(ds) { for (let i = 0; i < 400; i++) { if (ds.every((d) => { const s = d._cal.status(); return !s.queued && !s.running; })) return; ds.forEach((d) => d._cal.kick()); await sleep(2000); } throw new Error("cal timeout"); }
const results = [];
async function test(name, fn) { const t = Date.now(); try { const info = await fn(); results.push({ name, ok: true, info: info || "" }); console.log("✔", name, info ? "— " + info : "", `(${Date.now() - t}ms)`); } catch (e) { results.push({ name, ok: false, info: String(e && e.stack || e) }); console.log("✘", name, e && e.stack || e); } }
const evOff = (date, name, half) => ({ title: `${name} ${half ? (half === "am" ? "AM休" : "PM休") : "休み"}`, date, endDate: date, allDay: true, start: "", end: "", label: "leave", place: "", memo: "", members: [], sg: { type: "staff_off", staff: [name], users: [], meet: "", send: "", noMeet: "", noSend: "", half: half || "" } });

/* 管理者が初期設定し、3つの版のマスタと送迎表を作るところまで */
async function bootstrap() {
  const g = newServer();
  const admin = device(g);
  const pin0 = pinOf(g, "管理者");
  const me = await admin.login("000", pin0); assert.ok(me.mustChange);
  await admin.call("auth.changePin", pin0, "5829");
  for (const ed of ["v1", "v2", "v3"]) {
    const E = engFor(ed); const ns = ed === "v1" ? "" : ed + ":";
    await admin.kv().update(ns + "master", (cur) => cur || E.mergeSeedMaster(null, E.seedMaster()));
  }
  return { g, admin };
}

(async () => {
  await test("初期設定 → 管理者ログイン → 送迎表のマスタから職員番号を自動で振る", async () => {
    const { g } = await bootstrap();
    const rows = idRows(g);
    assert.strictEqual(rows[0][0], "000");
    const names = rows.map((r) => r[1]);
    assert.ok(names.includes("余村慎") && names.includes("八壁") && names.includes("職員1"));
    assert.strictEqual(new Set(rows.map((r) => r[0])).size, rows.length, "番号の重複なし");
    assert.ok(rows.every((r) => /^\d{4}$/.test(String(r[3])) || r[0] === "000"), "初期暗証番号");
    return `職員${rows.length - 1}名に番号（${rows[1][0]}〜${rows[rows.length - 1][0]}）と初期暗証番号を自動発行`;
  });

  await test("ログインの安全性：暗証番号の誤り5回でロック・偽のトークンは拒否・暗証番号はそのまま保存しない", async () => {
    const { g } = await bootstrap();
    const d = device(g); const no = noOf(g, "余村慎");
    for (let i = 0; i < 5; i++) await d.login(no, "0000").then(() => assert.fail("入れてはいけない"), (e) => assert.strictEqual(e.code, "login"));
    await d.login(no, pinOf(g, "余村慎")).then(() => assert.fail("ロック中"), (e) => assert.strictEqual(e.code, "locked"));
    const x = device(g); x.setToken("偽物のトークン"); await x.call("kv.get", "master").then(() => assert.fail(), (e) => assert.strictEqual(e.code, "auth"));
    const auth = g.sheets.get("_auth").data; assert.ok(!JSON.stringify(auth).includes("5829"), "管理者の新しい暗証番号が平文で残っていない");
    const easy = device(g); await easy.login(noOf(g, "八壁"), pinOf(g, "八壁")); await easy.call("auth.changePin", pinOf(g, "八壁"), "1111").then(() => assert.fail(), (e) => assert.ok(/推測/.test(e.message)));
    return "5回失敗でロック、偽トークン拒否、ハッシュ保存、推測されやすい番号は拒否";
  });

  await test("スマホで「AM休」を押す → 送迎表（現体制版・新体制版）に勤務時間の半分からの出勤として自動反映", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-02";
    for (const ns of ["", "v2:"]) { const E = engFor(ns ? "v2" : "v1"); const m = await admin.kv().get(ns + "master"); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon); admin.kv().put(ns + "sheet:" + date, Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks })); }
    await settleKV([admin]);
    const yo = device(g); const me = await yo.login(noOf(g, "余村慎"), pinOf(g, "余村慎")); await yo.call("auth.changePin", pinOf(g, "余村慎"), "3871");
    const cal = yo.cal(me.no); cal.save(evOff(date, "余村慎", "am"), null); await settleCal([yo]);
    for (const ns of ["", "v2:"]) {
      const m = (await admin.call("kv.get", ns + "master")).value; const s = (await admin.call("kv.get", ns + "sheet:" + date)).value;
      const sid = m.staff.find((x) => x.name === "余村慎").id; assert.ok(s.staffOv[sid] && s.staffOv[sid].start, ns + " 反映");
    }
    const s1 = (await admin.call("kv.get", "sheet:" + date)).value, m1 = (await admin.call("kv.get", "master")).value; const st = m1.staff.find((x) => x.name === "余村慎");
    const log = g.sheets.get("変更履歴").data.slice(1).map((r) => r.join(" | "));
    assert.ok(log.some((l) => l.includes("余村慎") && l.includes("AM休")), "変更履歴に本人の名前で記録");
    return `余村慎（${st.start}〜${st.end}）→ ${s1.staffOv[st.id].start} から出勤。変更履歴：「${log.find((l) => l.includes("AM休")).split(" | ").slice(1, 6).join(" / ")}」`;
  });

  await test("権限：一般職員もほかの職員の休みを入れられる（作った人として記録・ほかの人も直せる）・送迎表を直接変更できない・端末の名乗りは使わず本人として記録", async () => {
    const { g } = await bootstrap();
    const d = device(g); const me = await d.login(noOf(g, "八壁"), pinOf(g, "八壁"));
    assert.strictEqual((await d.call("cal.apply", { kind: "upsert", opId: "op_aaaaaaa1", id: "ev_aaaaaaa1", baseRev: null, ev: evOff("2026-11-03", "日野") })).status, "ok", "ほかの職員の休みも入れられる（2026-10-31〜）");
    { const o = device(g); await o.login(noOf(g, "白戸"), pinOf(g, "白戸")); const ex = Object.values(TC.mergeDays(await o.call("docs.query", { col: "days", from: "2026-11-03", to: "2026-11-03" }))).find((e) => e.id === "ev_aaaaaaa1");
      // 作った人でなくても変えられる（2026-11-15 依頼者「入れたカレンダーの内容は誰でも編集できるように」）。作った人はそのまま
      const up = await o.call("cal.apply", { kind: "upsert", opId: "op_aaaaaaa9", id: "ev_aaaaaaa1", baseRev: ex.rev, ev: Object.assign({}, ex, { title: "日野 休み（直した）" }) });
      assert.strictEqual(up.status, "ok", "ほかの職員が入れた予定も直せる");
      const ex2 = Object.values(TC.mergeDays(await o.call("docs.query", { col: "days", from: "2026-11-03", to: "2026-11-03" }))).find((e) => e.id === "ev_aaaaaaa1");
      assert.strictEqual(ex2.title, "日野 休み（直した）"); assert.strictEqual(ex2.createdBy, me.no, "作った人は八壁のまま"); }
    await d.call("kv.merge", { key: "master", base: null, mine: { staff: [] }, baseKnown: false }).then(() => assert.fail("送迎表の変更"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    const ar = await d.call("cal.apply", { kind: "upsert", opId: "op_aaaaaaa2", id: "ev_aaaaaaa2", baseRev: null, by: "999", ev: { title: "研修", date: "2026-11-03", endDate: "2026-11-03", allDay: true, label: "event" } });
    const day = Object.values(TC.mergeDays(await d.call("docs.query", { col: "days", from: "2026-11-03", to: "2026-11-03" })));
    assert.strictEqual(day[0].createdBy, me.no, "作成者はサーバーが決める");
    assert.ok(ar.docs && ar.docs.some((x) => x.date === "2026-11-03" && x.events.ev_aaaaaaa2), "書いた日の文書が返る（画面はこれで表を直す）");
    return "ほかの職員の休みは入れられ、作った人以外は消せない・送迎表の変更を拒否、作成者は本人の番号";
  });

  await test("朝に50人が一斉に自分の休み・AM休・PM休を入れる → 50件すべて保存・送迎表にも50人分反映", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-04"; const E = engFor("v2");
    const m = await admin.kv().get("v2:master"); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.wed);
    admin.kv().put("v2:sheet:" + date, Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks })); await settleKV([admin]);
    const names = m.staff.map((s) => s.name).filter((n) => idRows(g).some((r) => r[1] === n)).slice(0, 50);
    const ds = []; for (const n of names) { const d = device(g); const me = await d.login(noOf(g, n), pinOf(g, n)); d.cal(me.no); ds.push([d, n]); }
    ds.forEach(([d, n], i) => d._cal.save(evOff(date, n, ["", "am", "pm"][i % 3]), null));
    await settleCal(ds.map((x) => x[0]));
    const evs = Object.values(TC.mergeDays(await admin.call("docs.query", { col: "days", from: date, to: date })));
    assert.strictEqual(evs.length, 50, "予定 " + evs.length);
    const s = (await admin.call("kv.get", "v2:sheet:" + date)).value;
    const ids = names.map((n) => m.staff.find((x) => x.name === n).id);
    const reflected = ids.filter((id) => s.staffOv[id] && (s.staffOv[id].off || s.staffOv[id].start || s.staffOv[id].end)).length;
    const miss = names.filter((n, i) => { const id = ids[i]; return !(s.staffOv[id] && (s.staffOv[id].off || s.staffOv[id].start || s.staffOv[id].end)); }).map((n) => { const x = m.staff.find((y) => y.name === n); return n + " " + x.start + "-" + x.end + " " + JSON.stringify((x.shiftByDay || {})[3] || "") + " half=" + ["", "am", "pm"][names.indexOf(n) % 3]; });
    assert.strictEqual(reflected, 50, "送迎表への反映 " + reflected + " 未反映: " + miss.join(", "));
    assert.strictEqual(s.runs.length, p.runs.length, "便は1件も消えていない");
    return "予定50/50件、送迎表の反映50/50人、便はそのまま";
  });

  await test("電波のない所で休みを入れる → アプリを閉じる → 次に開いたとき自動で送られる（1回だけ）", async () => {
    const { g } = await bootstrap();
    const st = memStore(); const d = device(g, {}, st); const me = await d.login(noOf(g, "日野"), pinOf(g, "日野"));
    d.f.offline = true; const c = d.cal(me.no); c.save(evOff("2026-11-05", "日野"), null); c.save(evOff("2026-11-06", "日野", "pm"), null);
    await sleep(20000); assert.strictEqual(c.status().queued, 2, "端末に2件保持");
    const shown = Object.values(c.overlay({})).filter((e) => e.pending).length; assert.strictEqual(shown, 2, "画面には未送信として表示");
    const d2 = device(g, {}, st); const c2 = d2.cal(me.no); await settleCal([d2]);
    const evs = Object.values(TC.mergeDays(await d2.call("docs.query", { col: "days", from: "2026-11-01", to: "2026-11-30" })));
    assert.strictEqual(evs.filter((e) => e.sg && e.sg.staff[0] === "日野").length, 2);
    return "2件とも再起動後に1回ずつ保存";
  });

  await test("応答が30%消える回線で20人が休みを入れる → 二重登録0", async () => {
    const { g } = await bootstrap();
    const m = (await device(g).call.bind(null)) && null;
    const names = idRows(g).map((r) => r[1]).filter((n) => n !== "管理者").slice(0, 20);
    const ds = []; for (const n of names) { const d = device(g, { lostAck: 0.3 }); const me = await d.login(noOf(g, n), pinOf(g, n)); d.cal(me.no).save(evOff("2026-11-09", n), null); ds.push(d); }
    await settleCal(ds);
    const chk = device(g); await chk.login("000", "5829");
    const evs = Object.values(TC.mergeDays(await chk.call("docs.query", { col: "days", from: "2026-11-09", to: "2026-11-09" })));
    assert.strictEqual(evs.length, 20); assert.strictEqual(new Set(evs.map((e) => e.sg.staff[0])).size, 20);
    return "20/20件、重複0";
  });

  await test("送迎表を事務所の3台で同時に編集 → 全員の変更が残る（サーバー側のロック内で統合）", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-10"; const E = engFor("v2"); const m = await admin.kv().get("v2:master"); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.tue);
    admin.kv().put("v2:sheet:" + date, Object.assign(E.emptySheet(), { runs: p.runs.map((r, i) => Object.assign({}, r, { id: "r" + i })), blocks: p.blocks })); await settleKV([admin]);
    const ed = []; for (const n of ["八壁", "日野", "白戸"]) { const nn = noOf(g, n); g.sheets.get("職員ID").data.find((r) => String(r[0]) === nn)[2] = "送迎表"; const d = device(g); await d.login(nn, pinOf(g, n)); ed.push(d); }
    const vals = await Promise.all(ed.map((d) => d.kv().get("v2:sheet:" + date)));
    vals[0].runs[0].note = "八壁が変更"; vals[1].runs[1].note = "日野が変更"; vals[2].userAbsent[m.users[3].id] = true;
    ed.forEach((d, i) => d.kv().put("v2:sheet:" + date, vals[i])); await settleKV(ed);
    const s = (await admin.call("kv.get", "v2:sheet:" + date)).value;
    assert.strictEqual(s.runs[0].note, "八壁が変更"); assert.strictEqual(s.runs[1].note, "日野が変更"); assert.strictEqual(s.userAbsent[m.users[3].id], true);
    const log = g.sheets.get("変更履歴").data.slice(1).filter((r) => r[3] === "送迎表" && String(r[4]).includes(date));
    assert.ok(["八壁", "日野", "白戸"].every((n) => log.some((r) => r[2] === n)), "3人とも履歴に名前");
    return "3人分すべて保存、変更履歴に3人の名前";
  });

  await test("予定を消すと送迎表からも外れる（だれでも消せる）", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-11"; const E = engFor("v1"); const m = await admin.kv().get("master"); admin.kv().put("sheet:" + date, E.emptySheet()); await settleKV([admin]);
    const a = device(g); const me = await a.login(noOf(g, "白戸"), pinOf(g, "白戸")); a.cal(me.no).save(evOff(date, "白戸"), null); await settleCal([a]);
    const sid = m.staff.find((x) => x.name === "白戸").id;
    assert.ok((await admin.call("kv.get", "sheet:" + date)).value.staffOv[sid].off);
    const ev = Object.values(TC.mergeDays(await a.call("docs.query", { col: "days", from: date, to: date })))[0];
    const other = device(g); await other.login(noOf(g, "日野"), pinOf(g, "日野"));
    // ほかの職員も消せる（2026-11-15 依頼者「誰でも編集できるように」）→ 送迎表から外れる・変更履歴に消した人
    assert.strictEqual((await other.call("cal.apply", { kind: "delete", opId: "op_bbbbbbb1", id: ev.id, date, baseRev: ev.rev })).status, "ok", "ほかの職員も消せる");
    await settleCal([a]);
    assert.ok(!((await admin.call("kv.get", "sheet:" + date)).value.staffOv || {})[sid], "休みが外れた");
    assert.ok(g.sheets.get("変更履歴").data.slice(1).some((r) => r.join(" ").includes("日野")), "変更履歴に消した人");
    return "ほかの職員も消せる、消すと送迎表から外れる";
  });

  await test("ラベルごとの項目：ヘルプ・送迎（迎え・送りの変更）・休日出勤・勤務時間変更・担当が送迎表に反映される（権限つき・消すと外れる）", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-02"; const E = engFor("v1"); const m = await admin.kv().get("master"); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon);
    admin.kv().put("sheet:" + date, Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks })); await settleKV([admin]);
    const ev = (title, label, sg, t, extra) => Object.assign({ title, date, endDate: date, allDay: !t, start: t ? t[0] : "", end: t ? t[1] : "", label, place: "", memo: "", members: [], sg }, extra || {});
    const help = ev("ヘルプ（中村）", "help", { type: "help", staff: [], users: ["中村"], note: "中村" }, ["10:00", "11:00"]);
    const ride = ev("森 家族送り・家族迎え", "ride", { type: "user_time", users: ["森"], noMeet: "家族送り", noSend: "家族迎え" });
    const mr = p.runs.find((r) => r.kind === "meet" && r.userIds.length), mu = m.users.find((u) => u.id === mr.userIds[0]);
    const place = ev(mu.name + " 迎え先実家", "ride", { type: "user_time", users: [mu.name], meetPlace: "実家" });
    // 一般職員：すべてのラベルを使える（2026-10-31〜。ヘルプ・送迎・利用者休み・利用日外利用も）。休日出勤などは自分の分だけ
    const ip = device(g); await ip.login(noOf(g, "八壁"), pinOf(g, "八壁"));
    assert.strictEqual((await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00000", id: "ev_lbl00000", baseRev: null, ev: Object.assign(ev("日野 休日出勤", "hwork", { type: "hwork", staff: ["日野"] }, ["09:00", "13:00"]), { date: "2026-11-03", endDate: "2026-11-03" }) })).status, "ok", "ほかの職員の休日出勤も入れられる");
    const d3 = (e) => Object.assign({}, e, { date: "2026-11-03", endDate: "2026-11-03" });   // 下の確認と混ざらないよう別の日に
    for (const [i, e] of [help, ride, ev("森 利用日外利用", "extra", { type: "user_extra", users: ["森"] }), ev("園山 欠席", "user", { type: "user_absent", users: ["園山"] })].entries())
      assert.strictEqual((await ip.call("cal.apply", { kind: "upsert", opId: "op_lblg000" + i, id: "ev_lblg000" + i, baseRev: null, ev: d3(e) })).status, "ok", "一般職員も入れられる " + e.title);
    await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00010", id: "ev_lbl00010", baseRev: null, ev: ev("八壁 休日出勤", "hwork", { type: "hwork", staff: ["八壁"], dept: "津田" }, ["09:00", "13:00"]) });
    assert.strictEqual((await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00011", id: "ev_lbl00011", baseRev: null, ev: Object.assign(ev("日野 勤務時間変更", "shift", { type: "shift", staff: ["日野"], wend: "15:00" }), { date: "2026-11-03", endDate: "2026-11-03" }) })).status, "ok", "ほかの職員の職員時間変更も入れられる");
    await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00012", id: "ev_lbl00012", baseRev: null, ev: ev("八壁 退勤15:00", "shift", { type: "shift", staff: ["八壁"], wend: "15:00" }) });
    // その他予定の担当は、送迎表に載せなければ誰でも書ける（予定に残る）
    await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00013", id: "ev_lbl00013", baseRev: null, ev: ev("会議", "other", null, ["13:00", "14:00"], { place: "2階", tanto: ["日野", "八壁"] }) });
    // 送迎表の担当者：ヘルプ・送迎を入れる
    const row = idRows(g).find((r) => r[1] === "白戸"); row[2] = "送迎表";
    const sg = device(g); const me = await sg.login(noOf(g, "白戸"), pinOf(g, "白戸"));
    const exU = m.users.find((x) => !(x.days || []).includes(1) && !x.startDate);
    const cal = sg.cal(me.no); cal.save(help, null); cal.save(ride, null); cal.save(place, null); cal.save(ev(exU.name + " 利用日外利用", "extra", { type: "user_extra", users: [exU.name] }), null); await settleCal([sg]);
    const s = (await admin.call("kv.get", "sheet:" + date)).value;
    const S = (n) => m.staff.find((x) => x.name === n).id, U = (n) => m.users.find((x) => x.name === n).id;
    assert.deepStrictEqual(s.noRide[U("森")], { meet: "家族送り", send: "家族迎え" }, "家族送り・家族迎え → 迎えなし・送りなし（理由つき）");
    assert.strictEqual(s.userExtra[exU.id], true, "利用日外利用 → 送迎表の今日だけ利用");
    assert.strictEqual(s.runs.find((r) => r.id === mr.id).places[mu.id], "実家", "迎え先の変更 → 乗る便のその日だけの行き先");
    const hb = s.blocks.find((b) => b.calId && b.kind === "help");
    assert.ok(hb && hb.staffId === "__hold__" && hb.label === "中村" && hb.time === "10:00", "担当未定のヘルプは保留欄");
    assert.deepStrictEqual(s.staffOv[S("八壁")], { workToday: true, start: "9:00", end: "15:00", deptId: m.departments.find((d) => d.name === "津田").id }, "休日出勤（時間）＋勤務時間変更（退勤）");
    assert.strictEqual(s.runs.length, p.runs.length, "便はそのまま");
    const names = await sg.call("names.list"); assert.ok(names.depts.includes("津田") && names.users.length, "部署・利用者の一覧");
    // モニタリング・支援会議・その他予定：ほかの職員を対応者・担当にできる（2026-10-31〜 一般職員も）
    const mon = (who, extra) => ev("モニタリング（森）", "monitor", { type: "staff_plan", staff: who, users: ["森"] }, ["13:30", "14:30"], Object.assign({ place: "自宅" }, extra));
    await sg.call("cal.apply", { kind: "upsert", opId: "op_mon00001", id: "ev_mon00001", baseRev: null, ev: mon(["日野"]) });
    assert.strictEqual((await sg.call("cal.apply", { kind: "upsert", opId: "op_mon00002", id: "ev_mon00002", baseRev: null, ev: Object.assign(mon(["日野"]), { label: "other", title: "その他" }) })).status, "ok", "その他予定でほかの職員を担当に");
    assert.strictEqual((await ip.call("cal.apply", { kind: "upsert", opId: "op_mon00003", id: "ev_mon00003", baseRev: null, ev: Object.assign(mon(["日野"]), { date: "2026-11-03", endDate: "2026-11-03" }) })).status, "ok", "一般職員もほかの職員を対応者に");
    await ip.call("cal.apply", { kind: "upsert", opId: "op_mon00004", id: "ev_mon00004", baseRev: null, ev: Object.assign(mon(["八壁"]), { title: "支援会議（森）", label: "shien" }) });
    const sm = (await admin.call("kv.get", "sheet:" + date)).value;
    assert.ok(sm.blocks.some((b) => b.calId === "ev_mon00001" && b.staffId === S("日野") && b.time === "13:30"), "モニタリング → 対応者の予定");
    assert.ok(sm.blocks.some((b) => b.calId === "ev_mon00004" && b.staffId === S("八壁")), "支援会議 → 自分の予定");
    const evs = Object.values(TC.mergeDays(await sg.call("docs.query", { col: "days", from: date, to: date })));
    const mt = evs.find((e) => e.title === "会議"); assert.deepStrictEqual([mt.place, mt.tanto, mt.sg], ["2階", ["日野", "八壁"], null], "その他予定：場所・担当");
    const log = g.sheets.get("変更履歴").data.slice(1).map((r) => r.join(" | "));
    assert.ok(log.some((l) => l.includes("白戸") && l.includes("送迎表：送迎の変更 家族送り 家族迎え 森")), "変更履歴に内容つきで記録");
    assert.ok(log.some((l) => l.includes("送迎の変更 迎え先実家 " + mu.name)), "迎え先も変更履歴に");
    // 送迎の予定を消す → 迎えなし・送りなしが外れる
    cal.remove(evs.find((e) => e.title === ride.title)); await settleCal([sg]);
    const s2 = (await admin.call("kv.get", "sheet:" + date)).value;
    assert.ok(!(s2.noRide || {})[U("森")] && s2.blocks.some((b) => b.calId && b.kind === "help"), "送迎の変更だけ外れる");
    assert.strictEqual(s2.runs.find((r) => r.id === mr.id).places[mu.id], "実家", "別の予定の迎え先は残る");
    return `家族送り・家族迎え→迎えなし・送りなし、迎え先→便の行き先、ヘルプ→保留欄10:00、休日出勤→9:00〜（津田）・勤務時間変更→退勤15:00、その他予定の担当。一般職員のヘルプ・送迎・他人の休日出勤/勤務時間変更は拒否`;
  });

  await test("暗証番号の再発行：備考に「再発行」と書いて resetPins → 新しい番号でだけログインでき、前のログインは切れる", async () => {
    const { g } = await bootstrap();
    const d = device(g); const no = noOf(g, "日野"); await d.login(no, pinOf(g, "日野")); await d.call("auth.changePin", pinOf(g, "日野"), "4826");
    await d.call("auth.me");
    const row = idRows(g).findIndex((r) => r[1] === "日野"); const ids = g.sheets.get("職員ID").data;
    ids[row + 1][5] = "暗証番号を忘れた 再発行";
    assert.strictEqual(g.ctx.resetPins(), 1);
    assert.strictEqual(g.ctx.resetPins(), 0, "2回実行しても同じ人を再発行しない");
    const fresh = pinOf(g, "日野"); assert.ok(/^\d{4}$/.test(fresh), "新しい初期番号");
    for (const k of [...g.cache.keys()]) if (k.startsWith("s:")) g.cache.delete(k);   // 10分のログイン記憶が切れた後
    await d.call("auth.me").then(() => assert.fail("前のログインは切れる"), (e) => assert.strictEqual(e.code, "auth"));
    const d2 = device(g);
    await d2.login(no, "4826").then(() => assert.fail("前の番号"), (e) => assert.strictEqual(e.code, "login"));
    const me = await d2.login(no, fresh); assert.ok(me.mustChange, "ログイン後に自分の番号への変更を求める");
    const log = g.sheets.get("変更履歴").data.slice(1).map((r) => r.join(" | "));
    assert.ok(log.some((l) => l.includes("再発行") && l.includes("日野")));
    return "前の番号は使えず、新しい初期番号でログイン → 変更を求める。変更履歴に記録";
  });

  await test("画面への返事に日付が混ざっても空にならない（本物のGoogleは日付入りの返事を空で届けるため、JSONの形にそろえる）", async () => {
    const { g } = await bootstrap();
    const r = g.ctx.ok_({ at: new Date(Date.UTC(2026, 10, 2)), list: [new Date(0)], none: undefined });
    assert.strictEqual(typeof r.data.at, "string"); assert.strictEqual(r.data.list[0], "1970-01-01T00:00:00.000Z");
    assert.ok(!Object.prototype.toString.call(r.data.at).includes("Date"));
    assert.strictEqual(g.ctx.ok_(undefined).data, null);
    return "日付は文字に、undefined は null に";
  });

  await test("動作の確認画面（?page=check）：ファイルが最後まで貼れているか・シートがあるかを返し、秘密は出さない", async () => {
    const { g } = await bootstrap();
    const r = JSON.parse(JSON.stringify(g.ctx.checkServer()));
    assert.ok(r.files.sougei.end && r.files.calendar.end && r.files.sougei.boot, "2つのファイルが最後まである");
    assert.ok(Object.values(r.sheets).every(Boolean));
    const html = g.ctx.doGet({ parameter: { page: "check" } }).getContent();
    assert.ok(html.includes("動作の確認") && html.includes("checkServer"));
    const all = JSON.stringify(r) + html;
    const secrets = [pinOf(g, "管理者"), ...g.sheets.get("_auth").data.slice(1).flatMap((x) => [x[1], x[2]]), ...g.sheets.get("_sessions").data.slice(1).map((x) => x[0])].map(String).filter((x) => x.length >= 4);
    assert.ok(secrets.length >= 1 && secrets.every((x) => !all.includes(x)), "暗証番号・ハッシュ・ログインの鍵は出さない");
    return `sougei ${r.files.sougei.len}文字・calendar ${r.files.calendar.len}文字、シート${Object.keys(r.sheets).length}枚`;
  });

  await test("画面のプログラムに「<」を含めない（Googleが画面を書き出すとき、タグに見える文字でプログラムを途中で切るため）", async () => {
    const { g } = await bootstrap();
    const pages = { calendar: g.ctx.doGet({ parameter: {} }).getContent(), sougei: g.ctx.doGet({ parameter: { page: "sougei" } }).getContent(), check: g.ctx.doGet({ parameter: { page: "check" } }).getContent() };
    const out = [];
    for (const [n, h] of Object.entries(pages)) {
      const scripts = [...h.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      assert.ok(scripts.length >= 1, n);
      scripts.forEach((x, i) => assert.ok(!x.includes("<"), `${n} の ${i + 1}番目のプログラムに < がある`));
      out.push(`${n} ${scripts.length}個`);
    }
    return out.join("・");
  });

  await test("スマホの通知：設定B7に入口のページ → 端末を登録、予定が入ると入れた人以外に送る、届かない宛先は消す、毎朝の今日の予定（2026-11-16 依頼者）", async () => {
    const { g } = await bootstrap();
    assert.ok(g.ctx.ScriptApp._triggers.some((t) => t.fn === "pushDaily" && t.hour === 7), "setup で毎朝7時台のきっかけ");
    const a = device(g); const ma = await a.login(noOf(g, "八壁"), pinOf(g, "八壁"));
    const b = device(g); await b.login(noOf(g, "日野"), pinOf(g, "日野"));
    assert.deepStrictEqual(await b.call("push.key"), { key: null }, "B7 が空なら通知は使わない");
    const conf = g.sheets.get("設定"); assert.ok(String(conf.data[6][0]).includes("入口のページ"), "setup で7行目に見出し");
    conf.data[6][1] = "https://nanairo.example.workers.dev/";
    const calls = [], keys = { publicKey: "B" + "x".repeat(86), privateJwk: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } };
    let statusOf = () => 201;
    g.ctx.UrlFetchApp = {
      fetch: (u, o) => { calls.push({ u, o }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(keys) }; },
      fetchAll: (reqs) => reqs.map((r) => { const body = JSON.parse(r.payload); calls.push({ u: r.url, body }); return { getContentText: () => JSON.stringify({ results: body.items.map((it) => ({ endpoint: it.endpoint, status: statusOf(it.endpoint) })) }) }; }),
    };
    assert.strictEqual((await b.call("push.key")).key, keys.publicKey, "はじめは入口のページで鍵を作ってもらう");
    assert.strictEqual(calls[0].u, "https://nanairo.example.workers.dev/push/newkeys");
    await b.call("push.key"); assert.strictEqual(calls.length, 1, "鍵は覚えておく（2回目は作らない）");
    const sub = (ep) => ({ endpoint: ep, keys: { p256dh: "B" + "p".repeat(86), auth: "a".repeat(22) } });
    await b.call("push.subscribe", sub("https://web.push.apple.com/HINO1"));
    await a.call("push.subscribe", sub("https://web.push.apple.com/YAKABE1"));
    await b.call("push.subscribe", sub("https://web.push.apple.com/HINO1"));   // 同じ宛先をもう一度 → 1行のまま
    await b.call("push.subscribe", sub("https://evil.example.com/x")).then(() => assert.fail("通知のサービス以外"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    assert.strictEqual(g.sheets.get("_push").data.length - 1, 2, "2台");
    // 八壁が予定を入れる → 日野の端末にだけ（日付は今日と重ならない過去の日。2026-11-20 に今日と重なって「今日の予定」が2件になった）
    calls.length = 0;
    await a.call("cal.apply", { kind: "upsert", opId: "op_push0001", id: "ev_push0001", baseRev: null, ev: evOff("2025-11-20", "日野") });
    const sent = calls.filter((c) => c.u.endsWith("/push/send"));
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(sent[0].body.items.map((x) => x.endpoint).sort(), ["https://web.push.apple.com/HINO1", "https://web.push.apple.com/YAKABE1"], "入れた本人にも送る（2026-11-21 依頼者「自分がカレンダーに入れたものが通知で届かない」）");
    assert.strictEqual(sent[0].body.payload.title, "📅 予定が入りました");
    assert.ok(/11\/20\(木\) 日野 休み（八壁さん）/.test(sent[0].body.payload.body), sent[0].body.payload.body);
    assert.strictEqual(sent[0].body.payload.url, "/?page=calendar&d=2025-11-20"); assert.strictEqual(sent[0].body.subject, "https://nanairo.example.workers.dev");
    const r = await a.call("cal.apply", { kind: "upsert", opId: "op_push0002", id: "ev_push0001", baseRev: 1, ev: Object.assign(evOff("2025-11-20", "日野"), { title: "日野 休み（直した）" }) });
    assert.ok(!("_push" in r), "画面への返事には入れない");
    assert.strictEqual(calls.filter((c) => c.u.endsWith("/push/send")).pop().body.payload.title, "✏️ 予定が変わりました");
    // 届かなくなった宛先（410）は消す
    statusOf = (ep) => (/HINO/.test(ep) ? 410 : 201); calls.length = 0;
    await a.call("cal.apply", { kind: "upsert", opId: "op_push0003", id: "ev_push0003", baseRev: null, ev: evOff("2025-11-21", "日野") });
    assert.strictEqual(g.sheets.get("_push").data.length - 1, 1, "日野の端末は消えた");
    statusOf = () => 201;
    // 毎朝の今日の予定
    await b.call("push.subscribe", sub("https://web.push.apple.com/HINO2")); calls.length = 0;
    const today = g.ctx.Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
    await a.call("cal.apply", { kind: "upsert", opId: "op_push0004", id: "ev_push0004", baseRev: null, ev: evOff(today, "白戸") }); calls.length = 0;
    g.ctx.pushDaily();
    const d = calls.find((c) => c.u.endsWith("/push/send")).body;
    assert.ok(/^📅 今日の予定 .+（1件）$/.test(d.payload.title) && d.payload.body.includes("白戸 休み"), JSON.stringify(d.payload));
    assert.strictEqual(d.items.length, 2, "毎朝は全員（入れた人も）");
    // 前の日の夕方の「明日の予定」（2026-11-21 依頼者）。前からある所でも、朝の通知のときにきっかけが入る
    assert.ok(g.ctx.ScriptApp._triggers.some((t) => t.fn === "pushTomorrow" && t.hour === 18), "毎夕18時台のきっかけ");
    const tmr = g.ctx.Utilities.formatDate(new Date(Date.now() + 864e5), "Asia/Tokyo", "yyyy-MM-dd");
    await a.call("cal.apply", { kind: "upsert", opId: "op_push0005", id: "ev_push0005", baseRev: null, ev: evOff(tmr, "春日") }); calls.length = 0;
    g.ctx.pushTomorrow();
    const d2 = calls.find((c) => c.u.endsWith("/push/send")).body;
    assert.ok(/^📅 明日の予定 .+（1件）$/.test(d2.payload.title) && d2.payload.body.includes("春日 休み") && !d2.payload.body.includes("白戸"), JSON.stringify(d2.payload));
    assert.strictEqual(d2.payload.tag, "tomorrow"); assert.strictEqual(d2.payload.url, "/?page=calendar&d=" + tmr);
    { // 通知の種類ごとに選ぶ（2026-11-21 依頼者「いままで設定した通知をそれぞれ選択できるように」）。人ごと
      assert.deepStrictEqual(await b.call("push.prefs"), { new: true, chg: true, del: true, daily: true, tomorrow: true, self: true }, "はじめは全部受け取る");
      const p2 = await b.call("push.setPrefs", { new: false, tomorrow: false, daily: true, evil: false });
      assert.deepStrictEqual(p2, { new: false, chg: true, del: true, daily: true, tomorrow: false, self: true }, "決まった種類だけ覚える");
      await a.call("push.setPrefs", { self: false });
      const eps = () => calls.filter((c) => c.u.endsWith("/push/send")).flatMap((c) => c.body.items.map((x) => x.endpoint)).sort();
      calls.length = 0; await a.call("cal.apply", { kind: "upsert", opId: "op_push0006", id: "ev_push0006", baseRev: null, ev: evOff(tmr, "井川") });
      assert.deepStrictEqual(eps(), [], "日野は「入った」を切った・八壁は「自分で入れた」を切った → だれにも送らない");
      calls.length = 0; await a.call("cal.apply", { kind: "upsert", opId: "op_push0007", id: "ev_push0006", baseRev: 1, ev: Object.assign(evOff(tmr, "井川"), { title: "井川 休み（直した）" }) });
      assert.deepStrictEqual(eps(), ["https://web.push.apple.com/HINO2"], "「変わった」は日野に届く（八壁は自分なので届かない）");
      calls.length = 0; g.ctx.pushTomorrow();
      assert.deepStrictEqual(eps(), ["https://web.push.apple.com/YAKABE1"], "明日の予定は切った日野には届かない");
      calls.length = 0; await b.call("cal.apply", { kind: "upsert", opId: "op_push0008", id: "ev_push0008", baseRev: null, ev: evOff(tmr, "春日") });
      assert.deepStrictEqual(eps(), ["https://web.push.apple.com/YAKABE1"], "日野が入れた → 八壁に届く（日野は「入った」を切っている）");
      assert.ok(g.sheets.get("変更履歴").data.some((r) => String(r[3]) === "通知"), "変更履歴に残る");
    }
    g.ctx.ScriptApp._triggers.length = 0; assert.ok(/明日の予定/.test(g.ctx.installPushTrigger()));
    assert.deepStrictEqual(g.ctx.ScriptApp._triggers.map((t) => t.fn + t.hour).sort(), ["pushDaily7", "pushTomorrow18"], "エディタで入れ直すと2つ");
    return d.payload.title + " / " + sent[0].body.payload.body;
  });
  await test("アイコン・題名：「設定」シートB6のGoogleドライブの画像をアイコンに、題名は「なないろ…」（2026-11-16 依頼者のアイコン）", async () => {
    const { g } = await bootstrap();
    const conf = g.sheets.get("設定"); assert.ok(String(conf.data[5][0]).includes("アイコンの画像"), "setup で6行目に「アイコンの画像」");
    let o = g.ctx.doGet({ parameter: {} }); assert.strictEqual(o.title, "なないろカレンダー"); assert.ok(!("apple-mobile-web-app-title" in (o.meta || {})), "Googleが受け付けないメタタグは使わない（2026-11-16 実機で画面が開かなくなった）"); assert.ok(!o.favicon, "空ならアイコンなし");
    conf.data[5][1] = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing";
    g.ctx.CacheService.getScriptCache().remove("icon1");
    o = g.ctx.doGet({ parameter: { page: "sougei", e: "v2" } });
    assert.strictEqual(o.favicon, "https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345=s180", "ドライブの共有リンクを画像のアドレスに");
    assert.ok(/^なないろ送迎表（/.test(o.title), o.title);
    assert.strictEqual(g.ctx.doGet({ parameter: { page: "shift" } }).title, "なないろシフト表");
    return o.favicon;
  });
  await test("公開URL：Googleがテスト用の …/dev を返しても、「設定」シートB2の公開URLでメニューのリンク・Claude接続URLを作る", async () => {
    const { g } = await bootstrap();
    const real = g.ctx.ScriptApp; g.ctx.ScriptApp = { getService: () => ({ getUrl: () => "https://script.google.com/macros/s/HEADID/dev" }) };
    const boot = () => /window\.__SG_BASE=("[^"]*")/.exec(g.ctx.doGet({ parameter: {} }).getContent())[1];
    assert.strictEqual(JSON.parse(boot()), "https://script.google.com/macros/s/HEADID/dev", "設定が空ならGoogleのURLのまま");
    assert.ok(g.sheets.get("設定"), "setup で「設定」シートができる");
    assert.strictEqual(JSON.parse(JSON.stringify(g.ctx.checkServer())).base, "https://script.google.com/macros/s/HEADID/dev", "確認画面で分かる");
    const pub = "https://script.google.com/macros/s/AKfycbPUBLIC_123/exec";
    g.sheets.get("設定").data[1][1] = pub;
    assert.strictEqual(JSON.parse(boot()), pub, "設定した公開URLを使う");
    g.sheets.get("設定").data[1][1] = pub + "?page=calendar";
    assert.strictEqual(JSON.parse(boot()), pub, "後ろに ?page=… が付いていても使える");
    g.sheets.get("設定").data[1][1] = "https://evil.example.com/exec";
    assert.strictEqual(JSON.parse(boot()), "https://script.google.com/macros/s/HEADID/dev", "Googleの公開URL以外は使わない");
    g.ctx.ScriptApp = real;
    return "…/dev → 設定の …/exec を使う（それ以外のURLは無視）";
  });

  await test("よみがな：送迎表の職員・利用者が「よみがな」シートに自動で並び、入れた読みがカレンダーに届く", async () => {
    const { g, admin } = await bootstrap();
    const ys = g.sheets.get("よみがな"); assert.ok(ys, "シートができる");
    const rows = ys.data.slice(1); assert.ok(rows.some((r) => r[0] === "八壁" && r[2] === "職員") && rows.some((r) => r[0] === "中村" && r[2] === "利用者"));
    const n0 = rows.length; g.ctx.syncYomi_(); assert.strictEqual(ys.data.length - 1, n0, "2回目は増えない（重複なし）");
    rows.find((r) => r[0] === "中村")[1] = "なかむら";
    for (const k of [...g.cache.keys()]) if (k === "names8") g.cache.delete(k);
    const nl = await admin.call("names.list"); assert.strictEqual(nl.yomi["中村"], "なかむら"); assert.ok(!("八壁" in nl.yomi), "空の読みは送らない");
    return `職員と利用者 ${n0}名が並ぶ。読みは names.list で届く`;
  });

  await test("大きなマスタ（セル上限5万字を超える）も分割して保存・読み込み", async () => {
    const { g, admin } = await bootstrap();
    const raw = g.sheets.get("_docs").data.find((r) => r[0] === "kv/master");
    assert.ok(Number(raw[4]) >= 2, "分割数 " + raw[4]);
    const v = (await admin.call("kv.get", "master")).value; assert.ok(v.staff.length === 53);
    return `マスタは${raw[4]}セルに分割して保存`;
  });


  /* ---------- 「消えない・保存される・送迎表に反映される」の重点検証 ---------- */
  await test("スプレッドシートの自動変換：管理者000・0で始まる暗証番号（手入力で数値になった場合も）でログインできる", async () => {
    const { g } = await bootstrap();
    const row = idRows(g).find((r) => r[1] === "日野"); row[3] = 123;          // 「0123」と手で入れて数値123になった状態
    const d = device(g); const me = await d.login(String(row[0]), "0123"); assert.strictEqual(me.name, "日野");
    const a = device(g); await a.login("000", "5829");
    assert.strictEqual(g.stats.formulaErrors.length, 0, "数式化: " + g.stats.formulaErrors.join(","));
    const auth = g.sheets.get("_auth").data.slice(1); assert.ok(auth.filter((r) => r[2] !== "").every((r) => String(r[2]).startsWith("h:")) && auth.some((r) => r[2] !== ""), "ハッシュが文字として保存");
    return "000・0123ともにログイン可、数式化0件";
  });

  await test("送迎表がまだ無い日に休みを入れる → 後日その日の送迎表を初めて保存したときに休みが入る", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-16"; const yo = device(g); const me = await yo.login(noOf(g, "八壁"), pinOf(g, "八壁"));
    yo.cal(me.no).save(evOff(date, "八壁", "pm"), null); await settleCal([yo]);
    assert.strictEqual((await admin.call("kv.get", "v2:sheet:" + date)).value, null, "まだ送迎表は無い");
    const E = engFor("v2"); const m = await admin.kv().get("v2:master"); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon);
    admin.kv().put("v2:sheet:" + date, Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks })); await settleKV([admin]);   // パターンから読込→保存
    const s = (await admin.call("kv.get", "v2:sheet:" + date)).value; const sid = m.staff.find((x) => x.name === "八壁").id;
    assert.ok(s.staffOv[sid] && s.staffOv[sid].end, "PM休が入る");
    return `保存した時点で反映（八壁 ${s.staffOv[sid].end} 退勤）`;
  });

  await test("パターン読込・Excel取込で休みが上書きされても、保存したときに入れ直される（手で出勤に変えた分はそのまま）", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-17"; const E = engFor("v1"); const m = await admin.kv().get("master");
    admin.kv().put("sheet:" + date, E.emptySheet()); await settleKV([admin]);
    for (const n of ["白戸", "日野"]) { const d = device(g); const me = await d.login(noOf(g, n), pinOf(g, n)); d.cal(me.no).save(evOff(date, n), null); await settleCal([d]); }
    const s0 = await admin.kv().get("sheet:" + date); const id1 = m.staff.find((x) => x.name === "白戸").id, id2 = m.staff.find((x) => x.name === "日野").id;
    assert.ok(s0.staffOv[id1].off && s0.staffOv[id2].off);
    const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.tue);
    const wiped = Object.assign({}, s0, { runs: p.runs, blocks: p.blocks, staffOv: { [id2]: { off: false } } });   // パターンで当日設定が消え、日野は手で出勤に
    admin.kv().put("sheet:" + date, wiped); await settleKV([admin]);
    const s1 = (await admin.call("kv.get", "sheet:" + date)).value;
    assert.strictEqual(s1.staffOv[id1].off, true, "消えた休みは入れ直す"); assert.strictEqual(s1.staffOv[id2].off, false, "手で出勤にした分は尊重");
    return "上書きで消えた休みは自動で復活、手で出勤に変えた人はそのまま";
  });

  await test("送迎表の画面が古いカレンダーのまま保存しても、消した休みが戻らない・新しい休みが消えない", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-18"; const E = engFor("v1"); const m = await admin.kv().get("master");
    admin.kv().put("sheet:" + date, E.emptySheet()); await settleKV([admin]);
    const a = device(g); const meA = await a.login(noOf(g, "石原"), pinOf(g, "石原")); a.cal(meA.no).save(evOff(date, "石原"), null); await settleCal([a]);
    const pc = device(g); g.sheets.get("職員ID").data.find((r) => String(r[1]) === "高井")[2] = "送迎表"; await pc.login(noOf(g, "高井"), pinOf(g, "高井"));
    const stale = await pc.kv().get("sheet:" + date);                        // PCはこの時点の内容（石原の休みあり）
    const evA = Object.values(TC.mergeDays(await a.call("docs.query", { col: "days", from: date, to: date })))[0];
    a._cal.remove(evA); await settleCal([a]);                                // 石原の休みを削除
    const b = device(g); const meB = await b.login(noOf(g, "村松"), pinOf(g, "村松")); b.cal(meB.no).save(evOff(date, "村松", "am"), null); await settleCal([b]);   // 村松のAM休を追加
    const mine = JSON.parse(JSON.stringify(stale)); mine.notes = "PCで書いたメモ";
    const sidM = m.staff.find((x) => x.name === "村松").id;
    delete (mine.staffOv || {})[sidM]; if (mine.calApplied) for (const k of Object.keys(mine.calApplied)) if (k !== evA.id) delete mine.calApplied[k];   // 古い一覧での当てはめ（村松を外し、石原を残す）
    pc.kv().put("sheet:" + date, mine); await settleKV([pc]);
    const s = (await admin.call("kv.get", "sheet:" + date)).value; const sidI = m.staff.find((x) => x.name === "石原").id;
    assert.ok(!(s.staffOv || {})[sidI] || !s.staffOv[sidI].off, "消した休みは戻らない"); assert.ok(s.staffOv[sidM] && s.staffOv[sidM].start, "新しい休みは消えない"); assert.strictEqual(s.notes, "PCで書いたメモ");
    return "石原（削除済み）は戻らず、村松のAM休は残り、PCのメモも保存";
  });

  await test("PCで送迎表を編集し続けている最中に、スマホから15人が休みを入れる → 編集も休みも全部残る", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-19"; const E = engFor("v2"); const m = await admin.kv().get("v2:master"); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.thu);
    admin.kv().put("v2:sheet:" + date, Object.assign(E.emptySheet(), { runs: p.runs.map((r, i) => Object.assign({}, r, { id: "r" + i })), blocks: p.blocks })); await settleKV([admin]);
    const names = m.staff.map((s) => s.name).filter((n) => idRows(g).some((r) => r[1] === n)).slice(0, 15);
    const phones = []; for (const n of names) { const d = device(g); const me = await d.login(noOf(g, n), pinOf(g, n)); d.cal(me.no); phones.push([d, n]); }
    phones.forEach(([d, n], i) => d._cal.save(evOff(date, n, ["", "am", "pm"][i % 3]), null));
    for (let i = 0; i < 12; i++) { const v = await admin.kv().get("v2:sheet:" + date); v.runs[i].note = "PC編集" + i; admin.kv().put("v2:sheet:" + date, v); await sleep(700); }
    await Promise.all([settleCal(phones.map((x) => x[0])), settleKV([admin])]);
    const s = (await admin.call("kv.get", "v2:sheet:" + date)).value;
    for (let i = 0; i < 12; i++) assert.strictEqual(s.runs.find((r) => r.id === "r" + i).note, "PC編集" + i, "PCの編集" + i);
    const ok = names.filter((n) => { const id = m.staff.find((x) => x.name === n).id; const o = s.staffOv[id] || {}; return o.off || o.start || o.end; }).length;
    assert.strictEqual(ok, 15, "休みの反映 " + ok);
    return "PCの編集12/12、休み15/15人";
  });

  await test("= + - で始まるタイトル・メモ・名前も、そのまま保存される（数式にならない）", async () => {
    const { g, admin } = await bootstrap();
    const d = device(g); const me = await d.login(noOf(g, "白戸"), pinOf(g, "白戸"));
    const ev = { title: "=SUM(A1) 会議", date: "2026-11-20", endDate: "2026-11-20", allDay: true, label: "meeting", memo: "+α -1便 @注意", place: "-", members: [] };
    d.cal(me.no).save(ev, null); await settleCal([d]);
    const got = Object.values(TC.mergeDays(await d.call("docs.query", { col: "days", from: "2026-11-20", to: "2026-11-20" })))[0];
    assert.strictEqual(got.title, ev.title); assert.strictEqual(got.memo, ev.memo);
    const v = await admin.kv().get("sheet:2026-11-20") || engFor("v1").emptySheet(); v.notes = "-5分早く出る"; admin.kv().put("sheet:2026-11-20", v); await settleKV([admin]);
    assert.strictEqual((await admin.call("kv.get", "sheet:2026-11-20")).value.notes, "-5分早く出る");
    assert.strictEqual(g.stats.formulaErrors.length, 0, "数式化: " + g.stats.formulaErrors.join(","));
    return "タイトル・メモ・送迎表メモ・変更履歴とも元どおり";
  });

  await test("アプリを閉じる直前の入力も端末に残る（送迎表・カレンダーとも）", async () => {
    const { g, admin } = await bootstrap();
    admin.f.offline = true;
    const v = engFor("v1").emptySheet(); v.notes = "閉じる直前"; admin.kv().put("sheet:2026-11-24", v);
    assert.ok(admin.st.keys("sg:ob:").length === 1, "送迎表：その場で端末に保存");
    const d = device(g); const me = await d.login(noOf(g, "日野"), pinOf(g, "日野")); d.f.offline = true; d.cal(me.no).save(evOff("2026-11-24", "日野"), null);
    assert.ok(d.st.keys("c:tc:op:").length === 1, "カレンダー：その場で端末に保存");
    return "どちらも入力した瞬間に端末へ保存";
  });

  await test("バックアップ → 復元（まとめて書き込み）で内容が一致する", async () => {
    const { g, admin } = await bootstrap();
    const E = engFor("v1"); const m = await admin.kv().get("master"); const items = [];
    for (let i = 1; i <= 30; i++) { const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon); items.push({ key: "sheet:2026-12-" + String(i).padStart(2, "0"), value: Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks, notes: "日" + i }) }); }
    for (let i = 0; i < items.length; i += 10) await admin.kv().importMany(items.slice(i, i + 10));
    const back = await admin.kv().getMany(items.map((x) => x.key));
    assert.ok(back.every((r, i) => SGKV.eq(r.value, items[i].value)));
    const d = device(g); await d.login(noOf(g, "日野"), pinOf(g, "日野"));
    await d.kv().importMany(items.slice(0, 1)).then(() => assert.fail("一般は復元できない"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    return "30日分を一括で書込・読込して一致、一般職員は復元不可";
  });

  await test("画面URLに不正な値を入れても、スクリプトとして埋め込まれない", async () => {
    const { g } = await bootstrap();
    const out = g.ctx.doGet({ parameter: { page: "sougei", e: "v2", d: '</script><script>alert(1)</script>' } }).getContent();
    assert.ok(!out.includes("<script>alert(1)"), "埋め込まれていない"); assert.ok(out.includes('window.__SG_EDITION="v2"'));
    const out2 = g.ctx.doGet({ parameter: { d: "2026-11-02" } }).getContent(); assert.ok(out2.includes('window.__SG_DATE="2026-11-02"'));
    return "日付以外の値は捨てる";
  });

  await test("りんく・ぷれいす版 → 生活介護への送迎の依頼（担当・車が返る・時刻が付いていく・取り消し）", async () => {
    const { g, admin } = await bootstrap();
    const kv = admin.kv(), get = async (k) => (await admin.call("kv.get", k)).value, date = "2026-11-25";
    await kv.update("v3:master", (m) => ({ ...m, users: [...(m.users || []), { id: "k1", name: "星野こども", days: [3], deptId: ((m.departments || [])[0] || {}).id }] }));
    const E2 = engFor("v2"), m2 = await get("v2:master"), p = E2.resolveSeedPattern(m2, E2.SEED_PATTERNS.wed);
    kv.put("v2:sheet:" + date, Object.assign(E2.emptySheet(), { runs: p.runs, blocks: p.blocks })); await settleKV([admin]);
    const req = (id, time) => ({ id, kind: "meet", time, staffId: "__req__", vehicleId: "", userIds: ["k1"], places: { k1: "○○小学校" }, note: "", staffRiderIds: [] });
    kv.put("v3:sheet:" + date, Object.assign(E2.emptySheet(), { runs: [req("rq1", "15:00")] })); await settleKV([admin]);
    let s2 = await get("v2:sheet:" + date), lk = s2.blocks.find((b) => b.id === "lk_rq1");
    assert.ok(lk && lk.staffId === "__hold__" && lk.kind === "help" && lk.label === "【りんく依頼】星野こども 迎え" && lk.note === "○○小学校" && lk.time === "15:00", JSON.stringify(lk));
    assert.deepStrictEqual((await get("v3:sheet:" + date)).reqStatus, { rq1: { staff: "", veh: "" } }, "りんく側：担当を決めているところ");
    // 生活介護で担当・車を決める → りんく側に出る
    const st = m2.staff.find((x) => x.canDrive !== false) || m2.staff[0], veh = m2.vehicles[0];
    await kv.update("v2:sheet:" + date, (v) => ({ ...v, blocks: v.blocks.map((b) => (b.id === "lk_rq1" ? { ...b, staffId: st.id, vehicleId: veh.id } : b)) })); await settleKV([admin]);
    assert.deepStrictEqual((await get("v3:sheet:" + date)).reqStatus.rq1, { staff: st.name, veh: veh.name }, "生活介護の担当・車がりんく側に");
    // りんく側で時刻を変える → 付いていく（担当はそのまま）
    await kv.update("v3:sheet:" + date, (v) => ({ ...v, runs: v.runs.map((r) => ({ ...r, time: "15:30" })) })); await settleKV([admin]);
    lk = (await get("v2:sheet:" + date)).blocks.find((b) => b.id === "lk_rq1"); assert.ok(lk.time === "15:30" && lk.staffId === st.id, "時刻が付いていく");
    // 担当が決まったあとに取り消す → 【取消】を付けて残す（生活介護の担当者が消す）
    await kv.update("v3:sheet:" + date, (v) => ({ ...v, runs: [] })); await settleKV([admin]);
    lk = (await get("v2:sheet:" + date)).blocks.find((b) => b.id === "lk_rq1"); assert.ok(lk && lk.linkCancelled && lk.label.startsWith("【取消】"), JSON.stringify(lk));
    // まだ保留の依頼を取り消す → 消える
    await kv.update("v3:sheet:" + date, (v) => ({ ...v, runs: [req("rq2", "16:00")] })); await settleKV([admin]);
    assert.ok((await get("v2:sheet:" + date)).blocks.some((b) => b.id === "lk_rq2"));
    await kv.update("v3:sheet:" + date, (v) => ({ ...v, runs: [] })); await settleKV([admin]);
    assert.ok(!(await get("v2:sheet:" + date)).blocks.some((b) => b.id === "lk_rq2"), "保留のままなら消える");
    // 生活介護のその日の表がまだ無い → りんく側は「表ができたら入る」。表ができたら入る
    const d2 = "2026-11-26";
    kv.put("v3:sheet:" + d2, Object.assign(E2.emptySheet(), { runs: [req("rq3", "14:00")] })); await settleKV([admin]);
    assert.deepStrictEqual((await get("v3:sheet:" + d2)).reqStatus, { rq3: { pending: true } });
    kv.put("v2:sheet:" + d2, E2.emptySheet()); await settleKV([admin]);
    assert.ok((await get("v2:sheet:" + d2)).blocks.some((b) => b.id === "lk_rq3"), "表ができたら入る");
    assert.deepStrictEqual((await get("v3:sheet:" + d2)).reqStatus, { rq3: { staff: "", veh: "" } });
    // 10/31までは現体制版へ
    kv.put("v1:sheet:2026-10-28".replace("v1:", ""), E2.emptySheet()); kv.put("v3:sheet:2026-10-28", Object.assign(E2.emptySheet(), { runs: [req("rq4", "15:00")] })); await settleKV([admin]);
    assert.ok((await get("sheet:2026-10-28")).blocks.some((b) => b.id === "lk_rq4"), "10/31までは現体制版");
    const logs = g.sheets.get("変更履歴").data.map((r) => r.join(" "));
    assert.ok(logs.some((x) => x.includes("りんく・ぷれいす版からの送迎の依頼を反映")) && logs.some((x) => x.includes("生活介護で決まった担当・車を反映")), "変更履歴に残る");
    return `依頼→保留欄に【りんく依頼】→ 担当「${st.name}・${veh.name}」がりんく側に → 時刻変更・取り消し（【取消】）・表がまだ無い日も`;
  });

  await test("予定の検索（ほかの月も・ひらがな/カタカナ・空白で絞る・事業・削除は出ない）", async () => {
    const { admin } = await bootstrap();
    const ev = (id, date, title, o) => admin.call("cal.apply", { kind: "upsert", opId: "op_s" + id, id: "ev_s" + id, baseRev: null, ev: Object.assign({ title, date, endDate: date, allDay: true, start: "", end: "", label: "other", place: "", memo: "", members: [] }, o || {}) });
    await ev("0000001", "2026-10-25", "黒田さんパソコン支援　余村慎　翌週に変更", { allDay: false, start: "14:00", end: "16:00" });
    await ev("0000002", "2026-11-01", "黒田さんパソコン支援　余村慎", { allDay: false, start: "14:00", end: "16:00" });
    await ev("0000003", "2026-12-23", "余村慎検診");
    await ev("0000004", "2027-03-03", "会議", { place: "ヘルプ室", biz: "houkago" });
    await ev("0000005", "2026-11-10", "八壁 休み", { label: "leave", sg: { type: "staff_off", staff: ["余村慎"] } });
    await ev("0000006", "2026-11-11", "消した予定 余村慎");
    await admin.call("cal.apply", { kind: "delete", opId: "op_sdel0001", id: "ev_s0000006", date: "2026-11-11", baseRev: 1 });
    const q = async (text, biz) => (await admin.call("cal.search", { q: text, biz })).items.map((e) => e.date + " " + e.title);
    const r1 = await q("余村");
    assert.deepStrictEqual(r1, ["2026-10-25 黒田さんパソコン支援　余村慎　翌週に変更", "2026-11-01 黒田さんパソコン支援　余村慎", "2026-11-10 八壁 休み", "2026-12-23 余村慎検診"], r1.join(" / "));
    assert.deepStrictEqual(await q("余村 パソコン 翌週"), ["2026-10-25 黒田さんパソコン支援　余村慎　翌週に変更"], "空白で区切ると全部の言葉を含むもの");
    assert.deepStrictEqual(await q("へるぷ"), ["2027-03-03 会議"], "ひらがなでカタカナの場所");
    assert.deepStrictEqual(await q("会議", "seikatsu"), [], "事業のタブでしぼる");
    assert.deepStrictEqual(await q("会議", "houkago"), ["2027-03-03 会議"]);
    assert.deepStrictEqual(await q(" "), []);
    return `「余村」で${r1.length}件（10月〜12月、職員休みの対象も）・削除した予定は出ない`;
  });

  await test("Excel出力のあとにカレンダーが変わった日を知らせる（sg.exportAlerts）", async () => {
    const { admin } = await bootstrap();
    // 日付は今日（日本時間）。過ぎた日（昨日）は知らせない（2026-11-25 依頼者）
    const jst = (o) => new Date(Date.now() + 9 * 3600e3 + o * 864e5).toISOString().slice(0, 10);
    const kv = admin.kv(), get = async (k) => (await admin.call("kv.get", k)).value, date = jst(0), past = jst(-1);
    const E = engFor("v1"), m = await get("master"), p = E.resolveSeedPattern(m, E.SEED_PATTERNS.wed);
    kv.put("sheet:" + date, Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks })); await settleKV([admin]);
    await admin.call("cal.apply", { kind: "upsert", opId: "op_exp00001", id: "ev_exp00001", baseRev: null, ev: evOff(date, "日野") });
    // Excelを出力した（そのときのカレンダーの反映を残す）
    const C = require("../calsync.js");
    await kv.update("sheet:" + date, (v) => ({ ...v, exportedAt: "2026-11-24T06:00:00.000Z", exportSnap: C.exportSnapOf(v) })); await settleKV([admin]);
    assert.deepStrictEqual(await admin.call("sg.exportAlerts", { ns: "" }), [], "出力した直後は何もない");
    // そのあとカレンダーに休みが入る・前の休みが消える
    await admin.call("cal.apply", { kind: "upsert", opId: "op_exp00002", id: "ev_exp00002", baseRev: null, ev: evOff(date, "八壁", "am") });
    await admin.call("cal.apply", { kind: "delete", opId: "op_exp00003", id: "ev_exp00001", date, baseRev: 1 });
    const al = await admin.call("sg.exportAlerts", { ns: "" });
    assert.strictEqual(al.length, 1); assert.strictEqual(al[0].date, date);
    assert.deepStrictEqual(al[0].changes.map((c) => c.title + "（" + c.what + "）").sort(), ["八壁 AM休（追加）", "日野 休み（取り消し）"].sort());
    assert.deepStrictEqual(await admin.call("sg.exportAlerts", { ns: "v2:" }), [], "ほかの版には出ない");
    { // 過ぎた日（昨日）は、出力のあとにカレンダーが変わっても知らせない
      kv.put("sheet:" + past, Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks })); await settleKV([admin]);
      await kv.update("sheet:" + past, (v) => ({ ...v, exportedAt: "2026-11-01T06:00:00.000Z", exportSnap: C.exportSnapOf(v) })); await settleKV([admin]);
      await admin.call("cal.apply", { kind: "upsert", opId: "op_exp00009", id: "ev_exp00009", baseRev: null, ev: evOff(past, "日野") });
      assert.ok(!(await admin.call("sg.exportAlerts", { ns: "" })).some((a) => a.date === past), "過ぎた日は知らせない");
      assert.ok(C.exportChanges((await admin.call("kv.get", "sheet:" + past)).value).length > 0, "送迎表の中身はカレンダーに合わせて変わる（今までどおり）"); }
    // もう一度出力すると消える
    await kv.update("sheet:" + date, (v) => ({ ...v, exportedAt: "2026-11-24T07:00:00.000Z", exportSnap: C.exportSnapOf(v) })); await settleKV([admin]);
    assert.deepStrictEqual(await admin.call("sg.exportAlerts", { ns: "" }), []);
    return `出力のあと「${al[0].changes.map((c) => c.title + "（" + c.what + "）").join("・")}」→ もう一度出力で消える`;
  });

  await test("送迎表の右に出すカレンダーだけ、ほかの画面の中に出せる（embed=1）", async () => {
    const { g } = await bootstrap();
    const xfo = (p) => g.ctx.doGet({ parameter: p }).xfo;
    assert.strictEqual(xfo({ page: "calendar", embed: "1" }), 2, "右に出すカレンダーは中に出せる");
    assert.strictEqual(xfo({ page: "calendar" }), 1, "ふつうのカレンダーは今までどおり");
    assert.strictEqual(xfo({ page: "sougei", embed: "1" }), 1, "送迎表は中に出さない");
    // 入口のページ（Cloudflare）から開いたとき（wrap=https://入口）は、どの画面も中に出せる（2026-11-16）
    assert.strictEqual(xfo({ page: "sougei", e: "v2", wrap: "https://nanairo.example.workers.dev" }), 2, "入口のページの中の送迎表");
    assert.strictEqual(xfo({ wrap: "https://nanairo.example.workers.dev" }), 2, "入口のページの中のカレンダー");
    for (const bad of ["http://x.example.com", "https://x.example.com/path", "javascript:alert(1)", "https://x.example.com\"><script>"]) assert.strictEqual(xfo({ wrap: bad }), 1, "おかしな入口は今までどおり " + bad);
    return "page=calendar&embed=1・入口のページ（wrap）だけ ALLOWALL";
  });

  await test("TimeTreeから写した「○○休み」（その他予定）を職員休みに：名前が送迎表の職員のものだけ・送迎表に反映・管理者だけ", async () => {
    const { g, admin } = await bootstrap();
    const E2 = engFor("v2"), m2 = (await admin.call("kv.get", "v2:master")).value, p = E2.resolveSeedPattern(m2, E2.SEED_PATTERNS.thu);
    await admin.call("kv.cas", { key: "v2:sheet:2026-11-12", rev: 0, value: Object.assign(E2.emptySheet(), { runs: p.runs, blocks: p.blocks }) });
    const ev = (id, title, o) => admin.call("cal.apply", { kind: "upsert", opId: "op_" + id, id, baseRev: null, ev: Object.assign({ title, date: id.slice(2, 6) + "-" + id.slice(6, 8) + "-" + id.slice(8, 10), allDay: true, start: "", end: "", label: "other", place: "", memo: "TimeTreeから写しました", members: [] }, o || {}) });
    await ev("tt20261112_05", "岩田休み"); await ev("tt20261112_07", "松浦通院", { allDay: false, start: "10:00", end: "12:00" });
    await ev("tt20261113_04", "近藤PM休み"); await ev("tt20261112_13", "石倉休み", { allDay: false, start: "17:00", end: "18:00" });
    await ev("ev_other001", "八壁 休み", { date: "2026-11-12" });   // TimeTreeから写したものではない（IDが tt… でない）ので触らない
    const dry = await admin.call("cal.ttLeaveFix", { run: false });
    assert.deepStrictEqual(dry.items.map((x) => x.date + " " + x.name + (x.half ? ":" + x.half : "")), ["2026-11-12 岩田", "2026-11-12 石倉", "2026-11-13 近藤:pm"], "石倉さんはりんく・ぷれいす版の職員 " + JSON.stringify(dry.items));
    const r = await admin.call("cal.ttLeaveFix", { run: true }); assert.strictEqual(r.done, dry.items.length);
    const it = (await admin.call("cal.search", { q: "岩田休み" })).items[0];
    assert.ok(it.label === "leave" && it.sg.type === "staff_off" && it.sg.staff[0] === "岩田" && it.title === "岩田休み", JSON.stringify(it));
    const kd = (await admin.call("cal.search", { q: "近藤PM休み" })).items[0]; assert.strictEqual(kd.sg.half, "pm");
    const sh = (await admin.call("kv.get", "v2:sheet:2026-11-12")).value, iw = m2.staff.find((s) => s.name === "岩田");
    assert.strictEqual((sh.staffOv[iw.id] || {}).off, true, "送迎表で岩田さんが休み（パート欄から消える）");
    assert.strictEqual((await admin.call("cal.search", { q: "松浦通院" })).items[0].label, "other", "名前が職員でない予定はそのまま");
    assert.strictEqual((await admin.call("cal.search", { q: "八壁 休み" })).items[0].label, "other", "TimeTreeから写したもの以外はそのまま");
    assert.strictEqual((await admin.call("cal.ttLeaveFix", { run: false })).items.length, 0, "2回目は0件");
    const ippan = device(g); await ippan.login(noOf(g, "日野"), pinOf(g, "日野"));
    await ippan.call("cal.ttLeaveFix", { run: true }).then(() => assert.fail("一般は使えない"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    return `${r.done}件を職員休みに（${dry.items.map((x) => x.title).join("・")}）・送迎表の岩田さんが休み`;
  });

  await test("シフト表（男性・女性）：G列の人と管理者が組める・表の職員は自分の希望だけ・同時に直しても消えない・変更履歴", async () => {
    const { g, admin } = await bootstrap();
    const ids = g.sheets.get("職員ID").data;
    assert.strictEqual(String(ids[0][6]), "シフト表", "G列の見出し");
    const row = (nm) => ids.find((r) => r[1] === nm);
    row("白戸")[6] = "男性"; row("安部")[6] = "女性";
    const shiro = device(g); await shiro.login(noOf(g, "白戸"), pinOf(g, "白戸"));
    const yoko = device(g); await yoko.login(noOf(g, "横田"), pinOf(g, "横田"));   // 写真の表の職員（G列なし）
    const hachi = device(g); await hachi.login(noOf(g, "安部"), pinOf(g, "安部"));
    for (const nm of ["八壁", "井川"]) {   // 依頼者が決めた組む人（G列なしで男性・女性の両方）
      const d = device(g); await d.login(noOf(g, nm), pinOf(g, nm));
      assert.ok((await d.call("shift.get", { group: "m", ym: "2026-11" })).canEdit && (await d.call("shift.get", { group: "f", ym: "2026-11" })).canEdit, nm + "は両方組める");
    }
    const q = { group: "m", ym: "2026-11" };
    const g0 = await shiro.call("shift.get", q);
    assert.ok(g0.canEdit && g0.month.rev === 0, "G列「男性」の人は男性の表を組める");
    assert.deepStrictEqual((await admin.call("shift.get", { group: "f", ym: "2026-11" })).canEdit, true, "管理者は両方");
    const gy = await yoko.call("shift.get", q); assert.ok(!gy.canEdit && gy.member && gy.myName === "横田", "表の職員は見られる（組めない）");
    assert.ok((await yoko.call("auth.me")).shiftOk, "表の職員にはカレンダーにシフト表のボタン");
    const nobody = device(g); await nobody.login(noOf(g, "日野"), pinOf(g, "日野"));
    assert.ok(!(await nobody.call("auth.me")).shiftOk, "表にもG列にもない職員にはボタンを出さない");
    await hachi.call("shift.get", q).then(() => assert.fail("女性だけの人は男性の表を見られない"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    assert.ok((await hachi.call("shift.get", { group: "f", ym: "2026-11" })).canEdit);
    // 2人が同じ月の別の日を同時に直す → どちらも残る
    const base = null;
    await shiro.call("shift.save", Object.assign({ kind: "month", base, baseKnown: true, mine: { days: { "2026-11-02": { e: { 1: { n: "橋本" } } } } } }, q));
    const r2 = await admin.call("shift.save", Object.assign({ kind: "month", base, baseKnown: true, mine: { days: { "2026-11-03": { l: { 1: { n: "長島" } } } } } }, q));
    assert.strictEqual(r2.value.days["2026-11-02"].e[1].n, "橋本", "先に保存した日が消えない");
    assert.strictEqual(r2.value.days["2026-11-03"].l[1].n, "長島");
    // 組んだ勤務は職場カレンダーにも自動で入る（職員その他・終日・送迎表には反映しない）。直すと付いていき、外すと消える（2026-11-07 依頼者）
    assert.ok(r2.calLeft > 0, "はじめての月はカレンダーへの書き込みを何回かに分ける（1回が長くならないように） " + r2.calLeft);
    let loops = 0; while ((await yoko.call("shift.syncCal", q)).left > 0) loops++;   // 画面が続けて頼む（表の職員でもよい）
    assert.ok(loops < 20, "残りを書く " + loops);
    const calOf = async (date) => Object.values((await admin.call("docs.query", { col: "days", from: date, to: date })).reduce((a, d) => Object.assign(a, d.events), {})).filter((e) => /^shm/.test(e.id));
    // 2026-11-07 依頼者「基本パターンから変更がある時のみ反映」：基本シフトとちがう人だけ（11/2 宮永さんの遅番(16~22)・秋山さんの日勤）
    let c2 = await calOf("2026-11-02"); const hb = c2.find((e) => /^宮永 /.test(e.title) && !e.deleted);
    // 2026-11-26 依頼者：題名に①②③は付けない・送迎表に反映する「職員時間変更」（以前は職員その他で反映されなかった）
    assert.ok(hb && hb.title === "宮永 遅番(16~22)" && hb.label === "hwork" && !hb.allDay && hb.start === "16:00" && hb.end === "22:00" && hb.sg && hb.sg.type === "hwork" && hb.sg.staff[0] === "宮永" && hb.tanto[0] === "宮永", "カレンダーに「宮永 遅番(16~22)」（月曜は基本では休み＝休日出勤） " + JSON.stringify(hb));
    assert.ok(!c2.some((e) => !e.deleted && /^橋本 /.test(e.title)), "基本シフトどおりの橋本さんは出さない " + c2.map((e) => e.title).join(","));
    assert.ok(c2.some((e) => !e.deleted && e.title === "秋山 日勤"), "その日のほかの人の変更も入る");
    const allNov = (await admin.call("docs.query", { col: "days", from: "2026-11-01", to: "2026-11-30" })).reduce((a, d) => a + Object.values(d.events).filter((e) => /^shm/.test(e.id) && !e.deleted).length, 0);
    assert.ok(allNov > 20 && allNov < 100, "11月の基本とちがう分だけ " + allNov);
    const cur2 = (await admin.call("shift.get", q)).month.value, nx = JSON.parse(JSON.stringify(cur2)), D4 = "2026-11-04";
    await admin.call("kv.cas", { key: "v2:sheet:" + D4, rev: 0, value: engFor("v2").emptySheet() });   // その日の送迎表がある → シフト表の保存で反映される
    const was = ((nx.days[D4] || {}).e || {})[1]; nx.days[D4] = nx.days[D4] || { e: {}, l: {}, d: [] }; nx.days[D4].e = Object.assign({}, nx.days[D4].e, { 1: { n: "近藤", t: "6~9" } });
    await admin.call("shift.save", Object.assign({ kind: "month", base: cur2, baseKnown: true, mine: nx }, q));
    const c4 = await calOf(D4);
    assert.ok(c4.some((e) => !e.deleted && /^近藤 .*早番\(6~9\)/.test(e.title) && !/①/.test(e.title)), "入れ替えると付いていく " + c4.filter((e) => !e.deleted).map((e) => e.title).join(","));
    if (was && was.n && was.n !== "近藤") assert.ok(!c4.some((e) => !e.deleted && e.title.startsWith(was.n + " ") && /早番(?!.*日勤)/.test(e.title) && e.sg && e.sg.wstart === "06:00"), "外した人（" + was.n + "）の早番は消える");
    { const m2 = (await admin.call("kv.get", "v2:master")).value, sh4 = (await admin.call("kv.get", "v2:sheet:" + D4)).value, kd = m2 && m2.staff.find((s) => s.name === "近藤");
      if (kd) { const ov = (sh4.staffOv || {})[kd.id] || {}; assert.ok(/^0?6:00$/.test(ov.start) && /^0?9:00$/.test(ov.end) && ov.workToday, "シフト表の勤務が送迎表に入る（近藤 水曜は基本休み＝休日出勤 6:00〜9:00） " + JSON.stringify(ov)); }
      else assert.ok(Object.keys(sh4.calApplied || {}).some((k) => /^shm20261104_/.test(k)), "送迎表に反映の記録 " + JSON.stringify(Object.keys(sh4.calApplied || {}))); }
    const sk = (await admin.call("docs.query", { col: "days", from: "2026-11-02", to: "2026-11-02" })); assert.ok(sk.length >= 1);
    // 同じ内容で保存し直しても、カレンダーは書き直さない（変わった日だけ）
    const revBefore = JSON.stringify((await admin.call("docs.query", { col: "days", from: "2026-11-01", to: "2026-11-30" })).map((d) => d.date + d.shard + Object.values(d.events).map((e) => e.rev).join()));
    const cur3 = (await admin.call("shift.get", q)).month.value; const nx3 = JSON.parse(JSON.stringify(cur3)); nx3.days["2026-11-20"] = nx3.days["2026-11-20"] || { e: {}, l: {}, d: [] }; nx3.days["2026-11-20"].note = "メモ";
    await admin.call("shift.save", Object.assign({ kind: "month", base: cur3, baseKnown: true, mine: nx3 }, q));
    const revAfter = JSON.stringify((await admin.call("docs.query", { col: "days", from: "2026-11-01", to: "2026-11-30" })).map((d) => d.date + d.shard + Object.values(d.events).map((e) => e.rev).join()));
    assert.strictEqual(revAfter, revBefore, "勤務が変わらなければカレンダーはそのまま");
    assert.strictEqual((await admin.call("shift.get", q)).calLeft, 0, "書き直すものが無ければ開いても何もしない");
    { // 2026-11-26 依頼者「カレンダー職員のシフトその他のまま変わってない」：以前の書き方（職員その他・題名だけ覚えていた）のままの月は、開いただけで書き直す
      const lp = "shift/m/2026-11/cal", ix = g.ctx.docIndex_(), ld = g.ctx.docGet_(lp, ix), old = {};
      Object.keys(ld.value).forEach((k) => { old[k] = JSON.parse(ld.value[k])[0]; });
      g.ctx.docSet_(lp, old, ld.rev + 1, { k: lp }, ix);
      const D2 = "2026-11-02", dp = Object.values((await admin.call("docs.query", { col: "days", from: D2, to: D2 }))).find((d) => Object.keys(d.events).some((k) => /^shm20261102_/.test(k)));
      const ix2 = g.ctx.docIndex_(), p2 = g.ctx.TCCore.dayPath(D2, Object.keys(dp.events).find((k) => /^shm20261102_/.test(k))), raw = g.ctx.docGet_(p2, ix2);
      assert.ok(raw && raw.value && raw.value.events, "その日の文書 " + p2); if (raw) { const v = JSON.parse(JSON.stringify(raw.value)); for (const k of Object.keys(v.events || {})) if (/^shm/.test(k)) { v.events[k].label = "sother"; delete v.events[k].sg; v.events[k].title = v.events[k].title.replace("遅番", "遅番①"); } g.ctx.docSet_(p2, v, raw.rev + 1, {}, ix2); }
      const gr = await admin.call("shift.get", q); assert.strictEqual(gr.calLeft, 1, "以前の書き方のままなら開いたときに知らせる");
      let n = 0; while ((await admin.call("shift.syncCal", q)).left > 0 && n < 20) n++;
      assert.strictEqual((await admin.call("shift.get", q)).calLeft, 0, "書き直したあとは何もしない");
      const hb3 = (await calOf(D2)).find((e) => /^宮永 /.test(e.title) && !e.deleted);
      assert.ok(hb3 && hb3.label === "hwork" && hb3.sg && hb3.sg.type === "hwork" && hb3.title === "宮永 遅番(16~22)", "職員その他・①つきの予定が書き直される " + JSON.stringify(hb3 && { l: hb3.label, t: hb3.title, sg: hb3.sg && hb3.sg.type }) + " raw=" + !!raw); }
    // 表の職員：自分の希望だけ。ほかの欄・ほかの人の希望は送っても使わない
    const cur = (await yoko.call("shift.get", q)).month.value;
    const evil = JSON.parse(JSON.stringify(cur)); evil.days = {}; evil.wish = Object.assign({}, cur.wish, { "横田": { "2026-11-08": "休" }, "秋山": Object.assign({}, (cur.wish || {})["秋山"], { "2026-11-10": "休" }) }); evil.wishNote = { "横田": "8日 休みたい" };
    const r3 = await yoko.call("shift.save", Object.assign({ kind: "month", base: cur, baseKnown: true, mine: evil }, q));
    assert.strictEqual(r3.value.wish["横田"]["2026-11-08"], "休", "自分の希望は入る");
    assert.ok(!(r3.value.wish["秋山"] || {})["2026-11-10"], "ほかの人の希望は入らない");
    assert.strictEqual(r3.value.days["2026-11-02"].e[1].n, "橋本", "シフトは消えない");
    assert.strictEqual(r3.value.wishNote["横田"], "8日 休みたい");
    // 確定（2026-11-07 依頼者「管理者以外は確定までは見えないように。最終確定ボタン」）：12月は確定するまで表の職員には勤務が見えず、カレンダーにも出ない
    { const q12 = { group: "m", ym: "2026-12" }, D = "2026-12-01";
      const a0 = (await admin.call("shift.get", q12)).month.value, a1 = JSON.parse(JSON.stringify(a0 || {})); a1.days = { [D]: { e: { 1: { n: "近藤" } }, l: {}, d: [] } };
      await admin.call("shift.save", Object.assign({ kind: "month", base: a0, baseKnown: true, mine: a1 }, q12));
      while ((await admin.call("shift.syncCal", q12)).left > 0);
      const y0 = (await yoko.call("shift.get", q12)).month.value || {};
      assert.ok(y0.hidden && !Object.keys(y0.days || {}).length, "確定前は表の職員に勤務が見えない");
      assert.strictEqual((await admin.call("shift.get", q12)).month.value.days[D].e[1].n, "近藤", "組む人には見える");
      const cal12 = async () => (await admin.call("docs.query", { col: "days", from: "2026-12-01", to: "2026-12-31" })).reduce((a, d) => a + Object.values(d.events).filter((e) => /^shm/.test(e.id) && !e.deleted).length, 0);
      assert.strictEqual(await cal12(), 0, "確定前はカレンダーに出ない");
      const yw = JSON.parse(JSON.stringify(y0)); yw.wish = { "横田": { "2026-12-05": "休" } };
      const ry = await yoko.call("shift.save", Object.assign({ kind: "month", base: y0, baseKnown: true, mine: yw }, q12));
      assert.ok(ry.value.hidden && !Object.keys(ry.value.days).length, "保存の返事にも勤務は入れない");
      const a2 = (await admin.call("shift.get", q12)).month.value;
      assert.strictEqual(a2.days[D].e[1].n, "近藤", "表の職員の希望の保存で勤務は消えない"); assert.strictEqual(a2.wish["横田"]["2026-12-05"], "休");
      const a3 = JSON.parse(JSON.stringify(a2)); a3.fixed = { at: "2026-11-25T09:00:00Z", by: "管理者" };
      await admin.call("shift.save", Object.assign({ kind: "month", base: a2, baseKnown: true, mine: a3 }, q12)); while ((await admin.call("shift.syncCal", q12)).left > 0);
      assert.strictEqual((await yoko.call("shift.get", q12)).month.value.days[D].e[1].n, "近藤", "確定すると表の職員にも見える");
      assert.ok(await cal12() > 0, "確定するとカレンダーに出る");
      const a4 = (await admin.call("shift.get", q12)).month.value, a5 = JSON.parse(JSON.stringify(a4)); a5.fixed = false;
      await admin.call("shift.save", Object.assign({ kind: "month", base: a4, baseKnown: true, mine: a5 }, q12)); while ((await admin.call("shift.syncCal", q12)).left > 0);
      assert.strictEqual(await cal12(), 0, "確定を取り消すとカレンダーから消える");
      assert.ok((await yoko.call("shift.get", q12)).month.value.hidden, "また見えなくなる");
      { // 表の職員が日勤の希望を入れると、サーバーでその日の早番・遅番の枠を空けて日勤へ（2026-11-11 依頼者「早の秋山の欄を空ける」）
        const D2 = "2026-12-12", b0 = (await admin.call("shift.get", q12)).month.value, b1 = JSON.parse(JSON.stringify(b0)); b1.days[D2] = { e: { 1: { n: "横田" } }, l: { 1: { n: "近藤" } }, d: [] };
        await admin.call("shift.save", Object.assign({ kind: "month", base: b0, baseKnown: true, mine: b1 }, q12));
        const y1 = (await yoko.call("shift.get", q12)).month.value, y2 = JSON.parse(JSON.stringify(y1)); y2.wish = Object.assign({}, y2.wish, { "横田": Object.assign({}, (y2.wish || {})["横田"], { [D2]: "日" }) });
        await yoko.call("shift.save", Object.assign({ kind: "month", base: y1, baseKnown: true, mine: y2 }, q12));
        const b2 = (await admin.call("shift.get", q12)).month.value;
        assert.ok(!b2.days[D2].e[1] && b2.days[D2].d.includes("横田") && b2.days[D2].l[1].n === "近藤", "早番の枠を空けて日勤へ " + JSON.stringify(b2.days[D2])); }
      const lg = g.sheets.get("変更履歴").data.slice(1).map((r) => r.join(" | "));
      assert.ok(lg.some((l) => l.includes("2026-12") && l.includes("シフトを確定")) && lg.some((l) => l.includes("確定を取り消し")), "変更履歴に確定・取り消し"); }
    await yoko.call("shift.save", Object.assign({ kind: "cfg", base: null, baseKnown: true, mine: { members: [] } }, q)).then(() => assert.fail("設定は変えられない"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    // 設定（職員・曜日ごとの枠の数）
    await hachi.call("shift.save", { group: "f", ym: "2026-11", kind: "cfg", base: null, baseKnown: true, mine: { members: [{ name: "女性A", pat: { 1: "早" } }], need: { 1: { e: 2, l: 2 } } } });
    const gf = await hachi.call("shift.get", { group: "f", ym: "2026-11" });
    assert.deepStrictEqual(gf.cfg.value.members.map((m) => m.name), ["女性A"]);
    const log = g.sheets.get("変更履歴").data.slice(1).map((r) => r.join(" | "));
    assert.ok(log.some((l) => l.includes("シフト表") && l.includes("男性 2026-11") && l.includes("希望の変更") && l.includes("横田")), "変更履歴");
    assert.ok(g.ctx.doGet({ parameter: { page: "shift" } }).getContent().includes("SGShift"), "?page=shift でシフト表の画面");
    return "白戸＝男性を組める・横田＝自分の希望だけ・八壁＝女性だけ、別の日の同時保存はどちらも残る";
  });

  await test("期間の出欠一覧（長期休暇）：日ごとに利用者の来る/休み・職員の出勤/休み/公休、カレンダーの休みも入る・送迎表の担当者と管理者だけ（2026-11-07 依頼者）／リベルタの利用者の目印", async () => {
    const { g, admin } = await bootstrap();
    const E = engFor("v2"), m2 = (await admin.call("kv.get", "v2:master")).value;
    const op = (id, ev) => admin.call("cal.apply", { kind: "upsert", opId: "op_" + id, id: "ev_" + id, baseRev: null, ev });
    const base = (date, title, label, sg, end) => ({ title, date, endDate: end || date, allDay: true, start: "", end: "", label, place: "", memo: "", members: [], sg });
    assert.strictEqual((await op("att00001", base("2026-11-03", "中村 欠席", "user", { type: "user_absent", users: ["中村"] }))).status, "ok");
    assert.strictEqual((await op("att00002", base("2026-11-02", "八壁 休み", "leave", { type: "staff_off", staff: ["八壁"] }, "2026-11-03"))).status, "ok");
    assert.strictEqual((await op("att00003", base("2026-11-04", "日野 10:00出勤（遅刻）", "late", { type: "shift", staff: ["日野"], wstart: "10:00", reason: "遅刻" }))).status, "ok");
    const r = await admin.call("sg.attendance", { from: "2026-10-31", to: "2026-11-04", biz: "seikatsu" });
    assert.deepStrictEqual(r.dates, ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    const nk = r.users.find((u) => u.name === "中村"), hy = r.staff.find((s) => s.name === "八壁"), hn = r.staff.find((s) => s.name === "日野");
    assert.strictEqual(nk.cells["2026-11-02"], "○", "利用日は○"); assert.strictEqual(nk.cells["2026-11-03"], "休", "カレンダーの欠席は休"); assert.strictEqual(nk.cells["2026-11-01"], "", "利用日でない日は空き");
    assert.strictEqual(hy.cells["2026-11-02"], "休"); assert.strictEqual(hy.cells["2026-11-03"], "休", "何日も続く休み");
    assert.strictEqual(hn.cells["2026-11-04"], "○(10:00〜)", "時間を変えた日は時刻つき");
    assert.ok(r.staff.some((s) => Object.values(s.cells).includes("公休")), "固定休は公休");
    const v1n = r.users.find((u) => u.name === "中村"); assert.ok(v1n.cells["2026-10-31"] !== undefined, "10/31は現体制版の表から");
    assert.ok(!(await admin.call("kv.get", "v2:sheet:2026-11-03")).value, "出欠を出しても送迎表は作らない（見るだけ）");
    const ippan = device(g); await ippan.login(noOf(g, "日野"), pinOf(g, "日野"));
    await ippan.call("sg.attendance", { from: "2026-11-02", to: "2026-11-03" }).then(() => assert.fail("一般は出せない"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    await admin.call("sg.attendance", { from: "2026-11-01", to: "2027-03-01" }).then(() => assert.fail("長すぎる"), (e) => assert.ok(/93日/.test(e.message)));
    // リベルタ（ﾏﾝｼｮﾝ）の利用者の目印：リベルタ利用ラベルの候補はこの人たちだけ
    for (const k of [...g.cache.keys()]) if (k === "names8") g.cache.delete(k);
    const nl = await admin.call("names.list");
    const libN = nl.users.filter((u) => u.lib).map((u) => u.name), want = m2.users.filter((u) => u.libertaAM || u.libertaPM).map((u) => u.name);
    assert.ok(libN.length > 10 && want.every((n) => libN.includes(n)) && !nl.users.find((u) => !u.lib && want.includes(u.name)), "リベルタの利用者 " + libN.length + "名");
    return `出欠：利用者${r.users.length}名・職員${r.staff.length}名×${r.dates.length}日／リベルタの利用者${libN.length}名`;
  });

  await test("ログインはログアウトするまで続く：期限は10年・以前の120日のログインも使っているうちにのびる・ログアウトで切れる（2026-11-07 依頼者）", async () => {
    const { g, admin } = await bootstrap();
    const sess = () => g.sheets.get("_sessions").data.slice(1);
    const yrs = (d) => (new Date(d) - Date.now()) / (365 * 864e5);
    const last = sess()[sess().length - 1]; assert.ok(yrs(last[2]) > 9, "新しいログインの期限は10年 " + last[2]);
    // 以前のログイン（残り30日）→ 使うと10年先へ
    const row = sess().length; g.sheets.get("_sessions").data[row][2] = new Date(Date.now() + 30 * 864e5);
    for (const k of [...g.cache.keys()]) if (/^[sm]:/.test(k)) g.cache.delete(k);
    await admin.call("auth.me");
    assert.ok(yrs(g.sheets.get("_sessions").data[row][2]) > 9, "使うと期限がのびる " + g.sheets.get("_sessions").data[row][2]);
    // ログインしたままのアドレス（iPhoneのSafari向け。2026-11-10 依頼者）：鍵でログインでき、ログアウトすると使えなくなる
    const dl = await admin.call("auth.deviceLink"); assert.ok(/^[0-9a-f]{64}$/.test(dl.key), "鍵 " + dl.key);
    assert.strictEqual(String(sess()[sess().length - 1][3]), "ホーム画面のアドレス");
    const kr = g.ctx.api(dl.key, "auth.me", []); assert.ok(kr.ok && kr.data.no === "000", "鍵でログインできる " + JSON.stringify(kr));
    g.ctx.api(dl.key, "auth.logout", [dl.key]);
    assert.ok(!g.ctx.api(dl.key, "auth.me", []).ok, "ログアウトすると鍵は使えない");
    await admin.call("auth.logout", admin.token || "").catch(() => {});
    return "期限 " + Math.round(yrs(g.sheets.get("_sessions").data[row][2])) + "年・ホーム画面のアドレス";
  });
  await test("マンションのカレンダー：入れる・直す・消すのはマンションの人と管理者だけ・送迎表に出ない・活動計画書を貼る/見る/消す（2026-11-17 依頼者）", async () => {
    const { g, admin } = await bootstrap();
    const a = device(g); const ma = await a.login(noOf(g, "八壁"), pinOf(g, "八壁"));   // シフト表を組む人＝マンションの人
    const b = device(g); const mb = await b.login(noOf(g, "日野"), pinOf(g, "日野"));   // ほかの職員
    assert.strictEqual(ma.mansionOk, true, "八壁さんは入れられる"); assert.strictEqual(mb.mansionOk, false, "日野さんは見るだけ");
    const ev = (t, extra) => Object.assign({ title: t, date: "2026-11-20", endDate: "2026-11-20", allDay: false, start: "10:00", end: "11:00", label: "mevent", biz: "mansion", place: "マンション1F", memo: "", members: [], sg: { type: "staff_off", staff: ["八壁"], users: [] } }, extra || {});
    await b.call("cal.apply", { kind: "upsert", opId: "op_mns00001", id: "ev_mns00001", baseRev: null, ev: ev("誕生日会") }).then(() => assert.fail("日野さんは入れられない"), (e) => assert.strictEqual(e.code, "permission_denied"));
    assert.strictEqual((await a.call("cal.apply", { kind: "upsert", opId: "op_mns00002", id: "ev_mns00002", baseRev: null, ev: ev("誕生日会") })).status, "ok");
    assert.strictEqual((await a.call("cal.apply", { kind: "upsert", opId: "op_mns00003", id: "ev_mns00003", baseRev: null, ev: ev("会議", { label: "other", tanto: ["八壁"], sg: null }) })).status, "ok");
    const days = await b.call("docs.query", { col: "days", from: "2026-11-20", to: "2026-11-20" });
    const evs = Object.assign({}, ...days.map((d) => d.events || {}));
    assert.ok(evs.ev_mns00002 && evs.ev_mns00002.biz === "mansion" && !evs.ev_mns00002.sg, "マンションの予定（送迎表の中身は外す）");
    await b.call("cal.apply", { kind: "delete", opId: "op_mns00004", id: "ev_mns00002", date: "2026-11-20" }).then(() => assert.fail("日野さんは消せない"), (e) => assert.strictEqual(e.code, "permission_denied"));
    await b.call("cal.apply", { kind: "upsert", opId: "op_mns00005", id: "ev_mns00002", baseRev: evs.ev_mns00002.rev, ev: ev("誕生日会", { biz: "seikatsu", label: "other", sg: null }) }).then(() => assert.fail("日野さんは別の事業に移せない"), (e) => assert.strictEqual(e.code, "permission_denied"));
    const sh = (await admin.call("kv.get", "v2:sheet:2026-11-20"));
    const blocks = ((sh && sh.value) || {}).blocks || [];
    assert.ok(!blocks.some((x) => /ev_mns/.test(x.id)), "送迎表にコマを出さない（担当のあるその他でも）");
    // 活動計画書
    const xlsx = Buffer.from("PK\u0003\u0004 test excel").toString("base64");
    await b.call("mfile.put", { date: "2026-11-20", name: "活動計画書.xlsx", type: "", data: xlsx }).then(() => assert.fail("日野さんは貼れない"), (e) => assert.strictEqual(e.code, "permission_denied"));
    await a.call("mfile.put", { date: "2026-11-20", name: "ウイルス.exe", data: xlsx }).then(() => assert.fail("Word・Excel など以外"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    await a.call("mfile.put", { date: "2026-11-20", name: "大きい.xlsx", data: "A".repeat(4300000) }).then(() => assert.fail("3MBまで"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    const f = await a.call("mfile.put", { date: "2026-11-20", name: "活動計画書.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: xlsx });
    await a.call("mfile.put", { date: "2026-11-21", name: "21日.docx", data: xlsx });
    const l1 = (await b.call("mfile.list", { from: "2026-11-20", to: "2026-11-20" })).items;
    assert.deepStrictEqual(l1.map((x) => [x.name, x.by]), [["活動計画書.xlsx", "八壁"]], "ほかの職員も一覧で見られる（日付ごと）");
    assert.strictEqual((await b.call("mfile.list", { from: "2026-11-01", to: "2026-11-30" })).items.length, 2, "月の分");
    assert.strictEqual((await b.call("mfile.get", f.id)).data, xlsx, "中身が同じ");
    await b.call("mfile.del", f.id).then(() => assert.fail("日野さんは消せない"), (e) => assert.strictEqual(e.code, "permission_denied"));
    await a.call("mfile.del", f.id);
    assert.strictEqual((await b.call("mfile.list", { date: "2026-11-20" })).items.length, 0, "消える");
    await b.call("mfile.get", f.id).then(() => assert.fail("消したものは開けない"), (e) => assert.strictEqual(e.code, "not_found"));
    await b.call("mfile.get", "../kv/master").then(() => assert.fail("ほかの文書は読めない"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    const logs = g.sheets.get("変更履歴").data.map((r) => r.join("|")).join("\n");
    assert.ok(logs.includes("活動計画書を貼る") && logs.includes("活動計画書を消す"), "変更履歴");
    return "入れる人だけ・送迎表に出ない・活動計画書 OK";
  });
  await test("シフト表作成システムとの連携（?page=export）：キーで読むだけ・シフト表と予定がv1の形で出る（2026-11-10 依頼）", async () => {
    const { g, admin } = await bootstrap();
    const get = (p) => JSON.parse(g.ctx.doGet({ parameter: p }).getContent());
    assert.deepStrictEqual(get({ page: "export", key: "x", ym: "2026-12" }), { error: "key" }, "キーを作る前は読めない");
    const url = g.ctx.issueExportKey(), key = /key=([0-9a-f]{64})$/.exec(url)[1];
    assert.ok(/\?page=export&key=/.test(url), url);
    assert.deepStrictEqual(get({ page: "export", key: key.slice(0, -1) + (key.endsWith("0") ? "1" : "0"), ym: "2026-12" }), { error: "key" }, "キーを1文字変えると読めない");
    assert.deepStrictEqual(get({ page: "export", key, ym: "2026-13" }), { error: "ym" });
    // シフト表（12月・男性）と予定（休み・何日も続くリベルタ・前の月から続く予定・ほかの月・消した予定）
    const q = { group: "m", ym: "2026-12" };
    await admin.call("shift.save", Object.assign({ kind: "month", base: null, baseKnown: true, mine: { days: { "2026-12-01": { e: { 1: { n: "橋本" }, 2: { n: "野津", t: "6~9" } }, d: ["横田"] } }, wish: { "秋山": { "2026-12-08": "休" } } } }, q));
    const up = (id, ev) => admin.call("cal.apply", { kind: "upsert", opId: "op_" + id.slice(3), id, baseRev: null, ev });
    await up("ev_exp00001", evOff("2026-12-20", "日野"));
    await up("ev_exp00002", Object.assign(evOff("2026-11-30", "日野"), { title: "中村 リベルタなし", endDate: "2026-12-02", label: "liberta", sg: { type: "liberta", staff: [], users: ["中村"], lib: "off", lfrom: "pm", lto: "am" } }));
    await up("ev_exp00003", evOff("2027-01-05", "日野"));
    const r = get({ page: "export", key, ym: "2026-12" });
    assert.strictEqual(r.format, "riberta-calendar-export"); assert.strictEqual(r.v, 1); assert.strictEqual(r.ym, "2026-12"); assert.ok(r.generatedAt);
    assert.ok(r.shift.m.members.includes("橋本") && r.shift.f && Array.isArray(r.shift.f.members), "男性・女性の職員");
    assert.deepStrictEqual(r.shift.m.days["2026-12-01"].e["2"], { n: "野津", t: "6~9" }, "シフト表の中身");
    assert.strictEqual(r.shift.m.wish["秋山"]["2026-12-08"], "休", "希望");
    const ids = r.events.map((e) => e.id);
    assert.ok(ids.includes("ev_exp00001") && ids.includes("ev_exp00002") && !ids.includes("ev_exp00003"), "その月にかかる予定だけ " + ids);
    const lib = r.events.find((e) => e.id === "ev_exp00002");
    assert.ok(lib.sg.type === "liberta" && lib.sg.lfrom === "pm" && lib.sg.lto === "am" && lib.endDate === "2026-12-02", "リベルタの泊まり " + JSON.stringify(lib.sg));
    assert.strictEqual(r.events.find((e) => e.id === "ev_exp00001").sg.type, "staff_off");
    // 11月は紙の表から写した最初の中身（保存がまだでも）
    const n11 = get({ page: "export", key, ym: "2026-11" });
    assert.ok(Object.keys(n11.shift.m.days).length > 20 && n11.shift.m.fixed === true, "11月の男性は最初の中身");
    // 読むだけ：何も書かない
    const w0 = g.stats.writes; get({ page: "export", key, ym: "2026-12" }); assert.strictEqual(g.stats.writes, w0, "書きこまない");
    return "連携のアドレス: …" + url.slice(-30);
  });
  await test("カレンダーのデータが消えない（2026-11-24 依頼者「絶対消えないように」）：つまずく1件で後ろが止まらない・送迎表の反映エラーでも保存・予定の控え・入口のページの控えから戻す", async () => {
    const { g, admin } = await bootstrap();
    const d = device(g); const me = await d.login(noOf(g, "日野"), pinOf(g, "日野"));
    const q = async (from, to) => Object.values(TC.mergeDays(await d.call("docs.query", { col: "days", from, to })));
    // ① サーバーでつまずく1件（ここでは日野の11/10）があっても、そのあとに入れた予定は先に保存される。つまずいた1件も端末に残り、直れば送られる
    let bad = true;
    const st1 = memStore(); const c1 = TC.createCore({ db: null, store: TC.makeStore(lsOf(st1)), now: Date.now, sleep, random: rnd, me: me.no,
      runOp: (op) => (bad && op.ev && op.ev.date === "2026-11-10") ? Promise.reject({ code: "unavailable", message: "テストのつまずき" }) : d.call("cal.apply", op) });
    c1.save(Object.assign(evOff("2026-11-10", "日野"), { id: "ev_stuck001" }), null);
    c1.save(Object.assign(evOff("2026-11-11", "日野"), { id: "ev_after001" }), null);
    c1.save(Object.assign(evOff("2026-11-12", "日野", "am"), { id: "ev_after002" }), null);
    for (let i = 0; i < 40 && (await q("2026-11-11", "2026-11-12")).filter((e) => /ev_after/.test(e.id)).length < 2; i++) await sleep(1000);
    assert.strictEqual((await q("2026-11-11", "2026-11-12")).filter((e) => /ev_after/.test(e.id)).length, 2, "つまずいた1件のあとの予定も保存される");
    assert.strictEqual(c1.status().queued, 1, "つまずいた1件は端末に残る");
    assert.ok(c1.list()[0].tries >= 1 && c1.list()[0].lastCode === "unavailable");
    bad = false; c1.kick(); for (let i = 0; i < 60 && c1.status().queued; i++) { await sleep(1000); c1.kick(); }
    assert.ok((await q("2026-11-10", "2026-11-10")).some((e) => e.id === "ev_stuck001"), "直れば送られる");
    // ② 権限で入れられない（マンションの予定）は「要確認」に残し、ほかを止めない
    const c2 = TC.createCore({ db: null, store: TC.makeStore(lsOf(memStore())), now: Date.now, sleep, random: rnd, me: me.no, runOp: (op) => d.call("cal.apply", op) });
    c2.save({ id: "ev_mans0001", title: "マンションの会", date: "2026-11-13", endDate: "2026-11-13", allDay: true, start: "", end: "", label: "mevent", biz: "mansion", place: "", memo: "", members: [] }, null);
    c2.save(Object.assign(evOff("2026-11-13", "日野"), { id: "ev_after003" }), null);
    for (let i = 0; i < 40 && c2.status().queued; i++) await sleep(1000);
    assert.strictEqual(c2.status().failed.length, 1, "入れられない1件は要確認"); assert.strictEqual(c2.status().failed[0].info.code, "permission_denied");
    assert.ok((await q("2026-11-13", "2026-11-13")).some((e) => e.id === "ev_after003"), "ほかは保存");
    // ③ 送迎表への反映でつまずいても、カレンダーの保存は保存済み。変更履歴に「エラー」
    await admin.call("kv.cas", { key: "v2:sheet:2026-11-16", rev: 0, value: engFor("v2").emptySheet() });
    const orig = g.ctx.SGCal.reconcile; g.ctx.SGCal.reconcile = () => { throw new Error("テストの反映エラー"); };
    let r; try { r = await d.call("cal.apply", { kind: "upsert", opId: "op_recon001", id: "ev_recon001", baseRev: null, ev: evOff("2026-11-16", "日野") }); } finally { g.ctx.SGCal.reconcile = orig; }
    assert.strictEqual(r.status, "ok", "反映でつまずいても保存は成功");
    assert.ok((await q("2026-11-16", "2026-11-16")).some((e) => e.id === "ev_recon001"), "予定は保存されている");
    assert.ok(g.sheets.get("変更履歴").data.some((row) => row[3] === "エラー" && row[4] === "送迎表への反映" && String(row[5]).includes("テストの反映エラー")), "変更履歴にエラー");
    // ④ 予定の控え：作った・直した・消した中身がまるごと残る（30日たってゴミ箱から消えても戻せる）
    const ev1 = (await q("2026-11-16", "2026-11-16")).find((e) => e.id === "ev_recon001");
    await d.call("cal.apply", { kind: "upsert", opId: "op_recon002", id: "ev_recon001", baseRev: ev1.rev, fromDate: "2026-11-16", ev: Object.assign(evOff("2026-11-16", "日野", "pm"), { title: "日野 PM休み（直した）" }) });
    const ev2 = (await q("2026-11-16", "2026-11-16")).find((e) => e.id === "ev_recon001");
    await d.call("cal.apply", { kind: "delete", opId: "op_recon003", id: "ev_recon001", date: "2026-11-16", baseRev: ev2.rev });
    const jr = g.sheets.get("_予定の控え").data.filter((row) => String(row[3]).replace(/^'/, "") === "ev_recon001");
    assert.deepStrictEqual(jr.map((row) => row[2]), ["upsert", "upsert", "delete"], "3回の操作が残る");
    assert.strictEqual(JSON.parse(String(jr[1][5]).slice(1)).title, "日野 PM休み（直した）", "新しい内容");
    assert.strictEqual(JSON.parse(String(jr[1][6]).slice(1)).title, "日野 休み", "前の内容");
    assert.strictEqual(JSON.parse(String(jr[2][6]).slice(1)).title, "日野 PM休み（直した）", "消す前の内容");
    // ⑤ 入口のページに控えた未送信の操作を、端末の保存が消えたあとに戻す（iPhone）。二重にならない・もう届いていた新しい予定は「重なり」にしない
    const off = memStore(); const cOff = TC.createCore({ db: null, store: TC.makeStore(lsOf(off)), now: Date.now, sleep, random: rnd, me: me.no, runOp: () => Promise.reject({ code: "network" }) });
    cOff.save(Object.assign(evOff("2026-11-17", "日野"), { id: "ev_adopt001" }), null);
    await sleep(300); const kept = JSON.parse(JSON.stringify(cOff.list()));   // 入口のページに控えた内容
    assert.strictEqual(kept.length, 1);
    const cNew = TC.createCore({ db: null, store: TC.makeStore(lsOf(memStore())), now: Date.now, sleep, random: rnd, me: me.no, runOp: (op) => d.call("cal.apply", op) });
    assert.strictEqual(cNew.adopt(kept), 1, "戻した"); assert.strictEqual(cNew.adopt(kept), 0, "端末にあるものは二度入れない");
    for (let i = 0; i < 40 && cNew.status().queued; i++) await sleep(1000);
    assert.ok((await q("2026-11-17", "2026-11-17")).some((e) => e.id === "ev_adopt001"), "電波のない所で入れて閉じた予定が保存される");
    assert.strictEqual(cNew.adopt(kept), 1); for (let i = 0; i < 40 && cNew.status().queued; i++) await sleep(1000);   // 送ったあとにまた戻ってきても
    assert.strictEqual(cNew.status().conflicts.length + cNew.status().failed.length, 0, "届いていた分は「届いていた」で終わる");
    assert.strictEqual((await q("2026-11-17", "2026-11-17")).filter((e) => e.id === "ev_adopt001").length, 1, "二重にならない");
    const ev3 = (await q("2026-11-17", "2026-11-17")).find((e) => e.id === "ev_adopt001");
    await d.call("cal.apply", { kind: "upsert", opId: "op_adopt002", id: "ev_adopt001", baseRev: ev3.rev, fromDate: "2026-11-17", ev: Object.assign(evOff("2026-11-17", "日野", "am"), { title: "日野 AM休み" }) });
    const cOld = TC.createCore({ db: null, store: TC.makeStore(lsOf(memStore())), now: Date.now, sleep, random: rnd, me: me.no, runOp: (op) => d.call("cal.apply", op) });
    assert.strictEqual(cOld.adopt(kept), 1);
    for (let i = 0; i < 40 && cOld.status().queued; i++) await sleep(1000);
    assert.strictEqual(cOld.status().conflicts.length, 0, "古い控え（もう届いた新しい予定）は重なりにしない");
    assert.strictEqual((await q("2026-11-17", "2026-11-17")).find((e) => e.id === "ev_adopt001").title, "日野 AM休み", "あとで直した内容はそのまま");
    // ⑥ 前に保存されていた古い操作がもう一度届いても（入口の控えなど）、そのあとほかの人が直した内容を上書きしない・「重なり」にもしない
    const opA = { kind: "upsert", opId: "op_old00001", id: "ev_old00001", baseRev: null, ev: evOff("2026-11-18", "日野") };
    assert.strictEqual((await d.call("cal.apply", opA)).status, "ok");
    const e1 = (await q("2026-11-18", "2026-11-18")).find((e) => e.id === "ev_old00001");
    const opB = { kind: "upsert", opId: "op_old00002", id: "ev_old00001", baseRev: e1.rev, fromDate: "2026-11-18", ev: Object.assign(evOff("2026-11-18", "日野", "pm"), { title: "日野 PM休み（あとで直した）" }) };
    assert.strictEqual((await d.call("cal.apply", opB)).status, "ok");
    const e2 = (await q("2026-11-18", "2026-11-18")).find((e) => e.id === "ev_old00001");
    const opC = { kind: "upsert", opId: "op_old00003", id: "ev_old00001", baseRev: e1.rev, fromDate: "2026-11-18", ev: Object.assign(evOff("2026-11-18", "日野"), { title: "日野 休み（古い直し）" }) };
    assert.strictEqual((await d.call("cal.apply", opC)).status, "conflict", "本当に重なった直しは今までどおり「重なり」");
    assert.strictEqual((await d.call("cal.apply", opA)).status, "done", "前に保存された新しい予定の操作は「届いていた」");
    const opB2 = Object.assign({}, opB); await d.call("cal.apply", { kind: "upsert", opId: "op_old00004", id: "ev_old00001", baseRev: e2.rev, fromDate: "2026-11-18", ev: Object.assign(evOff("2026-11-18", "日野", "am"), { title: "日野 AM休み（さらに直した）" }) });
    assert.strictEqual((await d.call("cal.apply", opB2)).status, "done", "前に保存された直しの操作がもう一度届いても「届いていた」（上書きしない）");
    assert.strictEqual((await q("2026-11-18", "2026-11-18")).find((e) => e.id === "ev_old00001").title, "日野 AM休み（さらに直した）", "いちばん新しい内容のまま");
    // ⑦ 端末の時計が戻っても、あとに入れた操作はあとに送る
    { let t = 2000000; const cT = TC.createCore({ db: null, store: TC.makeStore(lsOf(memStore())), now: () => t, sleep, random: rnd, me: me.no, runOp: () => Promise.reject({ code: "network" }) });
      cT.save(Object.assign(evOff("2026-11-19", "日野"), { id: "ev_clock001" }), null); t = 1000000;
      cT.save(Object.assign(evOff("2026-11-19", "日野"), { id: "ev_clock002" }), null);
      assert.deepStrictEqual(cT.list().map((x) => x.id), ["ev_clock001", "ev_clock002"], "入れた順に並ぶ"); }
    // ⑧ 何日も続く予定（100日）は、62日より後の日の送迎表にも反映される
    await admin.call("kv.cas", { key: "v2:sheet:2027-03-20", rev: 0, value: engFor("v2").emptySheet() });
    await d.call("cal.apply", { kind: "upsert", opId: "op_long0001", id: "ev_long0001", baseRev: null, ev: Object.assign(evOff("2026-12-20", "日野"), { endDate: "2027-03-29", title: "日野 長期休み" }) });
    const sh = (await admin.call("kv.get", "v2:sheet:2027-03-20")).value, hi = (await admin.call("kv.get", "v2:master")).value.staff.find((x) => x.name === "日野");
    assert.ok(sh.staffOv && sh.staffOv[hi.id] && sh.staffOv[hi.id].off, "90日目の送迎表も休み " + JSON.stringify(sh.staffOv));
    return "つまずき・権限・反映エラー・控え・入口から戻す・前に届いた操作・時計・長い予定 OK";
  });

  await test("何日も続く利用者の休み（1/1〜1/3）を消すと、どの日の送迎表からも休みが消えて便に戻る（2026-11-25 依頼者）", async () => {
    const { g, admin } = await bootstrap();
    const E2 = engFor("v2"), m2 = (await admin.call("kv.get", "v2:master")).value;
    const days = ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04", "2027-01-05"];
    for (const d of days) { const p = E2.resolveSeedPattern(m2, E2.SEED_PATTERNS[["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(d + "T00:00:00").getDay()]] || {});
      await admin.call("kv.cas", { key: "v2:sheet:" + d, rev: 0, value: Object.assign(E2.emptySheet(), { runs: p.runs || [], blocks: p.blocks || [] }) }); }
    const nm = "中村", uid = m2.users.find((u) => u.name === nm).id;
    const riding = (sh) => (sh.runs || []).some((r) => (r.userIds || []).includes(uid));
    const before = {}; for (const d of days) before[d] = riding((await admin.call("kv.get", "v2:sheet:" + d)).value);
    const ev = { title: nm + " 休み", date: "2027-01-01", endDate: "2027-01-05", allDay: true, start: "", end: "", label: "user", place: "", memo: "", members: [], sg: { type: "user_absent", users: [nm] } };
    assert.strictEqual((await admin.call("cal.apply", { kind: "upsert", opId: "op_mabs0001", id: "ev_mabs0001", baseRev: null, ev })).status, "ok");
    for (const d of days) { const sh = (await admin.call("kv.get", "v2:sheet:" + d)).value; assert.strictEqual(sh.userAbsent[uid], true, "休み " + d); assert.ok(!riding(sh), "便から外れる " + d); }
    const stale = {}; for (const d of days) stale[d] = (await admin.call("kv.get", "v2:sheet:" + d)).value;   // 消す前に開いていた画面の送迎表（休みが入っている）
    const saved = (await admin.call("cal.search", { q: nm + " 休み" })).items.find((x) => x.id === "ev_mabs0001");
    assert.strictEqual((await admin.call("cal.apply", { kind: "delete", opId: "op_mabs0002", id: "ev_mabs0001", date: saved.date, baseRev: saved.rev })).status, "ok");
    for (const d of days) { const sh = (await admin.call("kv.get", "v2:sheet:" + d)).value;
      assert.ok(!sh.userAbsent[uid], "消すと休みが消える " + d + " " + JSON.stringify(sh.userAbsent)); assert.strictEqual(riding(sh), before[d], "便に戻る " + d); }
    // 消す前から開いていた画面が、休みの入った古い内容のまま保存しても、休みは戻らない
    for (const d of days) { const mine = JSON.parse(JSON.stringify(stale[d])); mine.memo = "画面で書いたメモ";
      await admin.call("kv.merge", { key: "v2:sheet:" + d, base: stale[d], mine, baseKnown: true });
      const sh = (await admin.call("kv.get", "v2:sheet:" + d)).value; assert.ok(!sh.userAbsent[uid] && sh.memo === "画面で書いたメモ", "古い画面の保存 " + d + " " + JSON.stringify(sh.userAbsent)); assert.strictEqual(riding(sh), before[d], "便 " + d); }
    // 送迎表がまだ無かった日を、休みが入った画面の内容で初めて保存しても
    { const d = "2027-01-06", ev2 = Object.assign({}, ev, { date: d, endDate: d });
      await admin.call("cal.apply", { kind: "upsert", opId: "op_mabs0003", id: "ev_mabs0003", baseRev: null, ev: ev2 });
      const shown = E2.emptySheet(); const C = require("../calsync.js"); const disp = C.reconcile(m2, shown, [Object.assign({ id: "ev_mabs0003", rev: 1 }, ev2)], d);
      assert.ok(disp.userAbsent[uid], "画面には休み");
      const sv = (await admin.call("cal.search", { q: nm + " 休み" })).items.find((x) => x.id === "ev_mabs0003");
      await admin.call("cal.apply", { kind: "delete", opId: "op_mabs0004", id: "ev_mabs0003", date: d, baseRev: sv.rev });
      await admin.call("kv.merge", { key: "v2:sheet:" + d, base: null, mine: disp, baseKnown: true });
      const sh = (await admin.call("kv.get", "v2:sheet:" + d)).value; assert.ok(!sh.userAbsent[uid], "まだ無かった日を休みの入った内容で保存しても休みは戻らない " + JSON.stringify(sh.userAbsent)); }
    return Object.entries(before).filter(([, v]) => v).length + "日分の便に戻る";
  });

  await test("サーバー処理の重さ（シートの読み書き回数）", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-25"; const E = engFor("v1"); const m = await admin.kv().get("master"); const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.wed);
    admin.kv().put("sheet:" + date, Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks })); await settleKV([admin]);
    const d = device(g); const me = await d.login(noOf(g, "日野"), pinOf(g, "日野"));
    const r0 = g.stats.reads, w0 = g.stats.writes; await d.call("cal.apply", { kind: "upsert", opId: "op_ccccccc1", id: "ev_ccccccc1", baseRev: null, ev: evOff(date, "日野") });
    const cr = g.stats.reads - r0, cw = g.stats.writes - w0;
    const v = await admin.kv().get("sheet:" + date); v.notes = "x"; const r1 = g.stats.reads, w1 = g.stats.writes; admin.kv().put("sheet:" + date, v); await settleKV([admin]);
    const kr = g.stats.reads - r1, kw = g.stats.writes - w1;
    const est = (r, w) => ((r * 0.12 + w * 0.25)).toFixed(1);
    return `休み1件: 読み${cr}回・書き${cw}回（実機の目安 約${est(cr, cw)}秒）／送迎表の保存1回: 読み${kr}回・書き${kw}回（約${est(kr, kw)}秒）`;
  });
  const okN = results.filter((r) => r.ok).length; console.log(`\n${okN}/${results.length} passed`);
  require("fs").writeFileSync(path.join(__dirname, "results-gas.json"), JSON.stringify(results, null, 1));
  process.exit(okN === results.length ? 0 : 1);
})();
