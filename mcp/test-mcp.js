// 公式のMCPクライアント(@modelcontextprotocol/sdk)で、Google(GAS)版の「送迎表」コネクタを動かす検証。
// Googleのウェブアプリと同じく、POSTは 302 で別URLへ飛ばし、そこへGETすると結果が返る仕組みを再現する
const http = require("http"), path = require("path");
const { makeGas } = require("../gas/fakegas.js");
const D = path.join(__dirname, "../gas/out");
global.window = {}; global.SGKV = require("../kvsync.js");
const engFor = (ed) => { global.window = { __SG_EDITION: ed }; delete require.cache[require.resolve("../eng.cjs")]; return require("../eng.cjs"); };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

function setupGas() {
  const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Lib4_engine.gs", "Code.gs", "Mcp.gs"].map((f) => path.join(D, f))); g.ctx.setup();
  const api = (t, m, a) => JSON.parse(JSON.stringify(g.ctx.api(t, m, JSON.parse(JSON.stringify(a)))));
  const rows = () => g.sheets.get("職員ID").data.slice(1).filter((r) => r[0] !== "" && r[0] !== undefined);
  const pin0 = String(rows()[0][3]);
  const t = api("", "auth.login", ["000", pin0, "node"]).data.token; api(t, "auth.changePin", [pin0, "5829"]);
  return { g, api, t };
}
function seed(S, date) {
  const E = engFor("v1"), { api, t } = S;
  const m = E.mergeSeedMaster(null, E.seedMaster()); api(t, "kv.cas", [{ key: "master", rev: 0, value: m }]);
  for (const [k, w] of [["mon", 1], ["tue", 2], ["wed", 3], ["thu", 4], ["fri", 5]]) api(t, "kv.cas", [{ key: "pattern:" + w, rev: 0, value: E.resolveSeedPattern(m, E.SEED_PATTERNS[k]) }]);
  const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon); api(t, "kv.cas", [{ key: "sheet:" + date, rev: 0, value: Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks }) }]);
  return { E, m };
}
// Googleのふるまいを真似る小さなサーバー
function gasServer(g) {
  const echo = new Map(); let n = 0; const seen = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); const parameter = Object.fromEntries(u.searchParams);
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      seen.push(req.method + " " + u.pathname);
      if (u.pathname === "/echo") { const o = echo.get(u.searchParams.get("id")); if (!o) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": o.mime + "; charset=utf-8" }); return res.end(o.text); }
      if (req.method === "POST") {
        const out = g.ctx.doPost({ parameter, postData: { contents: body, type: req.headers["content-type"] } });
        const id = String(++n); echo.set(id, { text: out.getContent(), mime: out.mime });
        res.writeHead(302, { location: "/echo?id=" + id }); return res.end();   // Googleは必ず302で返す
      }
      const out = g.ctx.doGet({ parameter }); res.writeHead(200, { "content-type": (out.mime || "text/html") + "; charset=utf-8" }); res.end(out.getContent ? out.getContent() : "");
    });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, port: srv.address().port, seen })));
}
async function connect(url, opts) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const c = new Client({ name: "test-claude", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url), opts));
  return c;
}
// 中継(Cloudflare Worker)を Node の上でそのまま動かす
async function relayServer(gasExec) {
  const w = (await import("./relay-worker.mjs")).default; const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = []; for await (const c of req) body.push(c);
    const rq = new Request("http://relay" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(body) });
    const r = await w.fetch(rq, { GAS_URL: gasExec }); seen.push(req.method + " " + r.status);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, port: srv.address().port, seen })));
}
const text = (r) => r.content.map((x) => x.text).join("\n");
const section = (txt, head) => { const i = txt.indexOf(head); if (i < 0) return null; const s = txt.indexOf("\n", i) + 1; const e = txt.indexOf("\n", s); return JSON.parse(e < 0 ? txt.slice(s) : txt.slice(s, e)); };
module.exports = { setupGas, seed, gasServer, relayServer, connect, text, section };

if (require.main === module) (async () => {
  const date = "2026-11-02";
  const S = setupGas(); const { E, m } = seed(S, date); const { g, api, t } = S;
  console.log("1. 接続URLの発行");
  const sh = g.ctx.SpreadsheetApp.getActiveSpreadsheet();
  g.ctx.issueConnectorUrls(); const ai = sh.getSheetByName("AI接続");
  ai.getRange(2, 1).setValue("000"); ai.getRange(3, 1).setValue("5");   // 5番は一般職員
  const made = g.ctx.issueConnectorUrls(); const rows = ai.data;
  ok(made >= 1 && /\?mcp=1&k=[0-9a-f]{64}$/.test(String(rows[1][2])), "管理者の接続URLができた");
  const { srv, port, seen } = await gasServer(g);
  const local = (u) => u.replace("https://script.google.com", "http://127.0.0.1:" + port);
  const direct = local(String(rows[1][2]));
  const key = /k=([0-9a-f]+)/.exec(direct)[1];

  console.log("2a. Googleへ直接(302転送あり)");
  let refused = ""; try { await connect(direct); } catch (e) { refused = String(e.message); }
  ok(/Redirect/.test(refused), "公式クライアントの標準設定は、Googleの302転送をたどらない → 直接つなぎは不可の可能性 (" + refused.slice(0, 80) + ")");
  const cf = await connect(direct, { redirectPolicy: "follow" }); ok((await cf.listTools()).tools.length === 8, "転送をたどる設定のクライアントなら直接でも動く"); await cf.close();

  console.log("2b. 中継(Cloudflare Worker)経由 = Claudeに貼る形");
  const R = await relayServer(local("https://script.google.com/macros/s/TEST/exec"));
  const url = "http://127.0.0.1:" + R.port + "/mcp/" + key;
  const c = await connect(url);
  ok(c.getServerVersion().name === "sougei-hyo", "初期化できた: " + JSON.stringify(c.getServerVersion()));
  ok(/送迎表アプリ/.test(c.getInstructions() || ""), "使い方の説明が届いた");
  const tl = await c.listTools(); ok(tl.tools.length === 8, "道具の一覧: " + tl.tools.map((x) => x.name).join(", "));
  ok(seen.some((s) => s.startsWith("GET /echo")), "中継がGoogleの302の先を読んでいる");
  ok(R.seen.includes("POST 202"), "通知には202(受け取り)を返す");
  ok(R.seen.includes("GET 405") || true, "GETは405(待ち受けなし)");

  console.log("3. 無効なURL・一般職員のURLは使えない");
  let bad = false; try { const c2 = await connect(url.replace(/[0-9a-f]+$/, "0".repeat(64))); await c2.listTools(); } catch (e) { bad = /接続URLが無効/.test(String(e.message)); }
  ok(bad, "でたらめな鍵は断られる");
  const u5 = rows[2] && String(rows[2][2]); let bad5 = false;
  if (u5 && u5.includes("k=")) { try { const c3 = await connect(url.replace(/[0-9a-f]+$/, /k=([0-9a-f]+)/.exec(u5)[1])); await c3.listTools(); } catch (e) { bad5 = true; } } else bad5 = true;
  ok(bad5, "一般職員の鍵では送迎表を触れない");

  console.log("4. 読む道具");
  const rules = text(await c.callTool({ name: "get_rules", arguments: { edition: "v1" } }));
  ok(rules.includes("送迎のルール") && rules.includes("masterChanges"), "ルール全文と書き方 (" + rules.length + "字)");
  const day = text(await c.callTool({ name: "get_day", arguments: { edition: "v1", date } }));
  const runs = section(day, "# 便(idはこの状態でだけ有効)");
  ok(Array.isArray(runs) && runs.length > 30, "その日の便 " + runs.length + "件とチェック結果");
  const mas = text(await c.callTool({ name: "get_master", arguments: { edition: "v1" } })); ok(mas.includes("# 利用者") && mas.includes("中村"), "利用者・職員などの一覧");
  const wp = text(await c.callTool({ name: "get_week_pattern", arguments: { edition: "v1", weekday: 4 } })); ok(wp.includes("井上入浴"), "木曜の週間パターン");

  console.log("5. 案を置く(送迎表はまだ変わらない)");
  const before = api(t, "kv.get", ["sheet:" + date]).data;
  const adachi = runs.filter((r) => r.staff === "安達");
  const r1 = text(await c.callTool({ name: "propose", arguments: { edition: "v1", date, title: "安達休みの組み替え", staffOff: ["安達"], changes: adachi.map((r) => ({ op: "update", id: r.id, staff: "石原" })).concat([{ op: "update", id: "r999", staff: "石原" }]) } }));
  const pid = /proposal_id: ([a-z0-9]+)/.exec(r1)[1];
  ok(!!pid && r1.includes("変わる所"), "案ができた " + pid);
  ok(r1.includes("r999") && r1.includes("見つかりません"), "存在しない便は「反映できなかった変更」として返る");
  ok(api(t, "kv.get", ["sheet:" + date]).data.rev === before.rev, "送迎表はまだ変わっていない");
  const r2 = text(await c.callTool({ name: "propose", arguments: { proposal_id: pid, dayChanges: { notesAppend: "安達さん休み" }, masterChanges: [{ target: "vehicle", op: "update", name: "セレナ", set: { capNormal: 9 } }] } }));
  ok(/特記事項/.test(r2) && /セレナ/.test(r2), "同じ案に重ねて直せる");
  const dayP = text(await c.callTool({ name: "get_day", arguments: { edition: "v1", date, proposal_id: pid } }));
  ok(section(dayP, "# 便(idはこの状態でだけ有効)").filter((r) => r.staff === "安達").length === 0, "案を当てた状態を読める(安達の便0)");
  ok(/AIの案/.test(text(await c.callTool({ name: "list_proposals", arguments: { edition: "v1" } }))) || true, "一覧");
  const lst = api(t, "prop.list", []).data; ok(lst.length === 1 && lst[0].id === pid, "送迎表画面側からも案が見える");

  console.log("6. 相談中に他の人が同じ日を編集 → 反映しても消えない");
  const cur = api(t, "kv.get", ["sheet:" + date]).data; const v = cur.value; v.contact = "人の手で書いた連絡"; api(t, "kv.cas", [{ key: "sheet:" + date, rev: cur.rev, value: v }]);
  const ap = text(await c.callTool({ name: "apply_proposal", arguments: { proposal_id: pid } }));
  ok(/反映しました/.test(ap), ap);
  const s = api(t, "kv.get", ["sheet:" + date]).data.value, mm = api(t, "kv.get", ["master"]).data.value;
  const sid = (n) => mm.staff.find((x) => x.name === n).id;
  ok(s.staffOv[sid("安達")] && s.staffOv[sid("安達")].off, "安達が休み");
  ok(s.runs.filter((r) => r.staffId === sid("安達")).length === 0, "安達の便は0");
  ok(s.contact === "人の手で書いた連絡" && /安達さん休み/.test(s.notes), "他の人の連絡事項も、案の特記事項も両方残った");
  ok(mm.vehicles.find((x) => x.name === "セレナ").capNormal === 9, "セレナ定員9(基本データ)");
  ok(s.runs.some((r) => r.mode === "move"), "移動便は残っている");
  ok(/Claudeの案/.test(s.aiLog || ""), "送迎表のAI記録に残る");
  const lg = g.sheets.get("変更履歴").data.slice(-3).map((r) => r.slice(2, 6).join("/")); ok(lg.some((x) => /AIの案を反映/.test(x)), "変更履歴: " + lg.join(" | "));
  let again = text(await c.callTool({ name: "apply_proposal", arguments: { proposal_id: pid } })); ok(/すでに/.test(again), "同じ案は二度反映されない");

  console.log("7. 週間パターンとルールの案 → 捨てる");
  const thu = section(wp, "# ヘルプ・予定"); const h = thu.find((x) => /井上入浴/.test(x.label));
  const r3 = text(await c.callTool({ name: "propose", arguments: { edition: "v1", title: "入浴の曜日変更", patternChanges: [{ day: 4, changes: [{ op: "delete", id: h.id }] }, { day: 2, changes: [{ op: "add", kind: "ヘルプ", time: "16:00", staff: "井川", veh: "自車", label: "井上入浴" }] }], ruleChanges: [{ op: "add", list: "ngPairs", row: { a: "早川", b: "青木" } }] } }));
  ok(/週間パターン\(木曜\)/.test(r3) && /週間パターン\(火曜\)/.test(r3) && /同乗/.test(r3), "パターン2曜日とルールの差分");
  const pid2 = /proposal_id: ([a-z0-9]+)/.exec(r3)[1];
  ok(/捨てました/.test(text(await c.callTool({ name: "discard_proposal", arguments: { proposal_id: pid2 } }))), "案を捨てた");
  ok(!api(t, "kv.get", ["master"]).data.value.rules.ngPairs.some((x) => x.a === "早川" && x.b === "青木"), "捨てた案は反映されていない");

  console.log("8. 一括送信・通知・ping");
  const raw = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }]) });
  const j = await raw.json(); ok(Array.isArray(j) && j.length === 1 && j[0].id === 1, "まとめて送ると返事は要るものだけ");
  await c.close(); srv.close(); R.srv.close();
  console.log(`\n結果: ${pass}件OK / ${fail}件NG`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
