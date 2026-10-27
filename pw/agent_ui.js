// 「💬 AIと相談」を画面ごと動かす検証。AIの代わりに、届いた依頼と状態を読んで決まった返事をする代役を使う
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const { makeGas } = require("../gas/fakegas.js");
global.window = {}; global.SGKV = require("../kvsync.js");
const engFor = (ed) => { global.window = { __SG_EDITION: ed }; delete require.cache[require.resolve("../eng.cjs")]; return require("../eng.cjs"); };
const D = path.join(__dirname, "../gas/out");
const section = (text, head) => { const i = text.indexOf(head); if (i < 0) return null; const s = text.indexOf("\n", i) + 1; const e = text.indexOf("\n", s); return JSON.parse(text.slice(s, e)); };
const calls = [];
function fakeAI(body) {
  const last = body.messages[body.messages.length - 1].content;
  calls.push(last.slice(0, 40));
  const ask = last.split("\n")[0];   // 依頼の1行目だけで判断する(状態の文に含まれる言葉に反応しない)
  const out = (o) => ({ text: JSON.stringify(o), truncated: false });
  if (!body.system || !body.system.includes("送迎のルール")) return out({ reply: "system なし" });
  if (last.startsWith("【自動チェック】")) return out({ reply: "残りは担当者の判断が必要なため、このままにします。", changes: [] });
  if (ask.includes("安達が休み")) {
    const runs = section(last, "# その日の便(idは今回だけ有効)");
    const mine = runs.filter((r) => r.staff === "安達");
    return out({ reply: `安達さんを休みにし、担当していた${mine.length}便を石原さんに振り替えました。`, staffOff: ["安達"], changes: mine.map((r) => ({ op: "update", id: r.id, staff: "石原" })) });
  }
  if (ask.includes("ヘルプ表")) return out({ reply: "ヘルプ表に火曜16:00の井上入浴(井川・安部)を入れました。", ruleChanges: [{ op: "add", list: "helpBase", row: { label: "井上入浴", time: "16:00", byDay: { 2: "井川・安部" } } }] });
  if (ask.includes("入浴") || ask.startsWith("【資料】")) {
    if (!last.includes("day:4)のヘルプ")) return out({ reply: "木曜と火曜のパターンを確認します。", need: [4, 2] });
    const helps = section(last, "# 週間パターン(木曜 / day:4)のヘルプ・予定");
    const h = helps.find((x) => /井上入浴/.test(x.label) && x.time === "17:00");
    return out({ reply: "木曜17:00の井上入浴(1件)を外し、火曜16:00に入れました。", patternChanges: [{ day: 4, changes: [{ op: "delete", id: h.id }] }, { day: 2, changes: [{ op: "add", kind: "ヘルプ", time: "16:00", staff: "井川", veh: "自車", label: "井上入浴" }] }] });
  }
  if (ask.includes("同じ便にしない")) return out({ reply: "同乗NGに早川さん×青木さんを追加しました。", ruleChanges: [{ op: "add", list: "ngPairs", row: { a: "早川", b: "青木" } }] });
  if (ask.includes("毎週月水金")) return out({ reply: "中村さんの利用曜日を月水金にし、水曜は津田にしました。", masterChanges: [{ target: "user", name: "中村", days: [1, 3, 5], deptByDay: { 3: "津田" } }] });
  if (ask.includes("セレナ")) return out({ reply: "セレナの定員を8にし、津田の職員の下限を2名にしました。", masterChanges: [{ target: "vehicle", name: "セレナ", set: { capNormal: 8 } }, { target: "dept", name: "津田", set: { staffMin: 2 } }] });
  if (ask.includes("受診")) return out({ reply: "森さんを受診後来所(迎えなし)にし、特記事項に書きました。", dayChanges: { noRide: [{ name: "森", meet: "受診後来所" }], notesAppend: "森さん 受診後来所" } });
  return out({ reply: "わかりません", changes: [] });
}
(async () => {
  const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Code.gs"].map((f) => path.join(D, f))); g.ctx.setup();
  g.ctx.aiMessages_ = (me, body) => fakeAI(body);
  const api = (t, m, a) => JSON.parse(JSON.stringify(g.ctx.api(t, m, JSON.parse(JSON.stringify(a)))));
  const rows = () => g.sheets.get("職員ID").data.slice(1).filter((r) => r[0] !== "" && r[0] !== undefined);
  const pin0 = String(rows()[0][3]);
  const t = api("", "auth.login", ["000", pin0, "node"]).data.token; api(t, "auth.changePin", [pin0, "5829"]);
  const date = "2026-11-02"; const E = engFor("v1");
  const m = E.mergeSeedMaster(null, E.seedMaster()); api(t, "kv.cas", [{ key: "master", rev: 0, value: m }]);
  for (const [k, w] of [["mon", 1], ["tue", 2], ["wed", 3], ["thu", 4], ["fri", 5]]) api(t, "kv.cas", [{ key: "pattern:" + w, rev: 0, value: E.resolveSeedPattern(m, E.SEED_PATTERNS[k]) }]);
  const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon); api(t, "kv.cas", [{ key: "sheet:" + date, rev: 0, value: Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks }) }]);
  const LOC = { "react.production.min.js": "node_modules/react/umd/react.production.min.js", "react-dom.production.min.js": "node_modules/react-dom/umd/react-dom.production.min.js", "three.min.js": "node_modules/three/build/three.min.js" };
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.exposeFunction("__gasApi", (tk, mm, a) => api(tk, mm, a));
  await pg.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { setTimeout(() => window.__gasApi(tk, m, a).then((r) => s && s(r), (e) => f && f(e)), 30); } }; })() } }; });
  await pg.route("https://**/*", async (r) => { const u = r.request().url(); for (const k in LOC) if (u.endsWith(k)) return r.fulfill({ path: LOC[k], contentType: "application/javascript" }); return r.abort(); });
  const html = fs.readFileSync(path.join(D, "sougei.html"), "utf8").replace("/*__BOOT__*/", `window.__SG_EDITION="v1";window.__SG_BASE="https://x/exec";window.__SG_DATE="${date}";`);
  fs.writeFileSync(path.join(__dirname, "a_sougei.html"), html);
  await pg.goto("file://" + path.join(__dirname, "a_sougei.html")); await pg.waitForTimeout(600);
  await pg.fill("#sghNo", "000"); await pg.fill("#sghPin", "5829"); await pg.click("#sghGo"); await pg.waitForTimeout(5000);
  await pg.getByRole("button", { name: "💬 AIと相談" }).click(); await pg.waitForTimeout(1500);
  const say = async (txt) => { await pg.fill("#agentInput", txt); await pg.getByRole("button", { name: "送信", exact: true }).click(); for (let i = 0; i < 60; i++) { await pg.waitForTimeout(300); if (await pg.locator("#agentInput").isEnabled()) break; } await pg.waitForTimeout(300); };
  await say("安達が休み。代わりを入れて組み替えて");
  await say("井上さんの入浴を木曜17時から火曜16時に変えて");
  await say("早川さんと青木さんは同じ便にしない");
  await say("中村さんは毎週月水金、水曜は津田を利用");
  await say("セレナを8人乗りにして、津田は職員を最低2人に");
  await say("森さんは今日受診してから来る");
  await say("ヘルプ表の火曜に井上入浴を井川と安部で入れて");
  await pg.screenshot({ path: "a_chat.png" });
  const diffText = await pg.locator("text=変わる所").locator("xpath=../..").innerText();
  console.log("右の一覧:\n" + diffText.split("\n").slice(0, 40).join("\n"));
  const before = api(t, "kv.get", ["sheet:" + date]).data.value;
  await pg.getByRole("button", { name: "この案を反映" }).click(); await pg.waitForTimeout(6000);
  const s = api(t, "kv.get", ["sheet:" + date]).data.value, mm = api(t, "kv.get", ["master"]).data.value;
  const p4 = api(t, "kv.get", ["pattern:4"]).data.value, p2 = api(t, "kv.get", ["pattern:2"]).data.value;
  const id = (n) => mm.staff.find((x) => x.name === n).id;
  const cnt = (pp, re, tm) => pp.blocks.filter((x) => re.test(x.label || "") && (!tm || x.time === tm)).length;
  console.log("---- 反映後のサーバーの内容 ----");
  console.log("安達の休み:", JSON.stringify(s.staffOv[id("安達")]), "/ 安達の便:", s.runs.filter((r) => r.staffId === id("安達")).length, "→ 石原の便:", s.runs.filter((r) => r.staffId === id("石原")).length, "(前", before.runs.filter((r) => r.staffId === id("石原")).length, ")");
  console.log("木曜17:00の井上入浴:", cnt(E.resolveSeedPattern(m, E.SEED_PATTERNS.thu), /井上入浴/, "17:00"), "→", cnt(p4, /井上入浴/, "17:00"), "/ 火曜16:00の井上入浴:", cnt(p2, /井上入浴/, "16:00"));
  console.log("同乗NG 早川×青木:", mm.rules.ngPairs.some((x) => x.a === "早川" && x.b === "青木"));
  const u = mm.users.find((x) => x.name === "中村"); console.log("中村:", JSON.stringify(u.days), "水曜の利用先:", (mm.departments.find((d) => d.id === (u.deptByDay || {})[3]) || {}).name);
  console.log("セレナ定員:", mm.vehicles.find((v) => v.name === "セレナ").capNormal, "/ 津田の下限:", mm.departments.find((d) => d.name === "津田").staffMin, "/ ヘルプ表:", JSON.stringify(mm.rules.helpBase));
  const mori = mm.users.find((x) => x.name === "森").id; console.log("森の送迎なし:", JSON.stringify(s.noRide[mori]), "/ 特記事項:", s.notes);
  const mv = s.runs.find((r) => r.mode === "move"); console.log("移動便(成相):", mv ? mv.time + " " + (mv.note || "") : "消えた");
  console.log("AIへの依頼回数:", calls.length, calls.map((c) => c.slice(0, 12)).join(" | "));
  console.log("変更履歴:", g.sheets.get("変更履歴").data.slice(-4).map((r) => r.slice(2, 6).join(" / ")).join("\n  "));
  console.log("画面エラー:", errs);
  await b.close();
})();
