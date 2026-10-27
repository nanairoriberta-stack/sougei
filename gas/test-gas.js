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

function newServer() { const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Code.gs"].map((f) => path.join(D, f))); g.ctx.setup(); return g; }
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

  await test("権限：一般職員は他人の休みを入れられない・送迎表を直接変更できない・端末の名乗りは使わず本人として記録", async () => {
    const { g } = await bootstrap();
    const d = device(g); const me = await d.login(noOf(g, "八壁"), pinOf(g, "八壁"));
    await d.call("cal.apply", { kind: "upsert", opId: "op_aaaaaaa1", id: "ev_aaaaaaa1", baseRev: null, ev: evOff("2026-11-03", "日野") }).then(() => assert.fail("他人の休み"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    await d.call("kv.merge", { key: "master", base: null, mine: { staff: [] }, baseKnown: false }).then(() => assert.fail("送迎表の変更"), (e) => assert.strictEqual(e.code, "invalid_argument"));
    await d.call("cal.apply", { kind: "upsert", opId: "op_aaaaaaa2", id: "ev_aaaaaaa2", baseRev: null, by: "999", ev: { title: "研修", date: "2026-11-03", endDate: "2026-11-03", allDay: true, label: "event" } });
    const day = Object.values(TC.mergeDays(await d.call("docs.query", { col: "days", from: "2026-11-03", to: "2026-11-03" })));
    assert.strictEqual(day[0].createdBy, me.no, "作成者はサーバーが決める");
    return "他人の休み・送迎表の変更を拒否、作成者は本人の番号";
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

  await test("予定を消すと送迎表からも外れる（作った本人か管理者だけ消せる）", async () => {
    const { g, admin } = await bootstrap();
    const date = "2026-11-11"; const E = engFor("v1"); const m = await admin.kv().get("master"); admin.kv().put("sheet:" + date, E.emptySheet()); await settleKV([admin]);
    const a = device(g); const me = await a.login(noOf(g, "白戸"), pinOf(g, "白戸")); a.cal(me.no).save(evOff(date, "白戸"), null); await settleCal([a]);
    const sid = m.staff.find((x) => x.name === "白戸").id;
    assert.ok((await admin.call("kv.get", "sheet:" + date)).value.staffOv[sid].off);
    const ev = Object.values(TC.mergeDays(await a.call("docs.query", { col: "days", from: date, to: date })))[0];
    const other = device(g); await other.login(noOf(g, "日野"), pinOf(g, "日野"));
    await other.call("cal.apply", { kind: "delete", opId: "op_bbbbbbb1", id: ev.id, date, baseRev: ev.rev }).then(() => assert.fail(), (e) => assert.strictEqual(e.code, "invalid_argument"));
    a._cal.remove(ev); await settleCal([a]);
    assert.ok(!((await admin.call("kv.get", "sheet:" + date)).value.staffOv || {})[sid], "休みが外れた");
    return "他の職員は消せない、本人が消すと送迎表から外れる";
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
    // 一般職員：利用者が関わるヘルプ・送迎は入れられない。休日出勤は自分の分だけ
    const ip = device(g); await ip.login(noOf(g, "八壁"), pinOf(g, "八壁"));
    for (const [i, e] of [help, ride, ev("日野 休日出勤", "hwork", { type: "hwork", staff: ["日野"] }, ["09:00", "13:00"])].entries())
      await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl0000" + i, id: "ev_lbl0000" + i, baseRev: null, ev: e }).then(() => assert.fail("入れられないはず " + e.title), (x) => assert.strictEqual(x.code, "invalid_argument"));
    await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00010", id: "ev_lbl00010", baseRev: null, ev: ev("八壁 休日出勤", "hwork", { type: "hwork", staff: ["八壁"], dept: "津田" }, ["09:00", "13:00"]) });
    await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00011", id: "ev_lbl00011", baseRev: null, ev: ev("日野 勤務時間変更", "shift", { type: "shift", staff: ["日野"], wend: "15:00" }) }).then(() => assert.fail("他人の勤務時間変更"), (x) => assert.strictEqual(x.code, "invalid_argument"));
    await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00012", id: "ev_lbl00012", baseRev: null, ev: ev("八壁 退勤15:00", "shift", { type: "shift", staff: ["八壁"], wend: "15:00" }) });
    // その他予定の担当は、送迎表に載せなければ誰でも書ける（予定に残る）
    await ip.call("cal.apply", { kind: "upsert", opId: "op_lbl00013", id: "ev_lbl00013", baseRev: null, ev: ev("会議", "other", null, ["13:00", "14:00"], { place: "2階", tanto: ["日野", "八壁"] }) });
    // 送迎表の担当者：ヘルプ・送迎を入れる
    const row = idRows(g).find((r) => r[1] === "白戸"); row[2] = "送迎表";
    const sg = device(g); const me = await sg.login(noOf(g, "白戸"), pinOf(g, "白戸"));
    const cal = sg.cal(me.no); cal.save(help, null); cal.save(ride, null); cal.save(place, null); await settleCal([sg]);
    const s = (await admin.call("kv.get", "sheet:" + date)).value;
    const S = (n) => m.staff.find((x) => x.name === n).id, U = (n) => m.users.find((x) => x.name === n).id;
    assert.deepStrictEqual(s.noRide[U("森")], { meet: "家族送り", send: "家族迎え" }, "家族送り・家族迎え → 迎えなし・送りなし（理由つき）");
    assert.strictEqual(s.runs.find((r) => r.id === mr.id).places[mu.id], "実家", "迎え先の変更 → 乗る便のその日だけの行き先");
    const hb = s.blocks.find((b) => b.calId && b.kind === "help");
    assert.ok(hb && hb.staffId === "__hold__" && hb.label === "中村" && hb.time === "10:00", "担当未定のヘルプは保留欄");
    assert.deepStrictEqual(s.staffOv[S("八壁")], { workToday: true, start: "9:00", end: "15:00", deptId: m.departments.find((d) => d.name === "津田").id }, "休日出勤（時間）＋勤務時間変更（退勤）");
    assert.strictEqual(s.runs.length, p.runs.length, "便はそのまま");
    const names = await sg.call("names.list"); assert.ok(names.depts.includes("津田") && names.users.length, "部署・利用者の一覧");
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
