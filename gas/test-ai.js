// サーバーのAI中継：APIキーは画面に出さない・指示文とモデルを渡す・混雑時は分かる言葉で返す
"use strict";
const path = require("path"), assert = require("assert"); const { makeGas } = require("./fakegas.js"); global.window = {};
const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Code.gs"].map((f) => path.join(__dirname, "out", f))); g.ctx.setup();
const api = (t, m, a) => JSON.parse(JSON.stringify(g.ctx.api(t, m, a)));
const pin = String(g.sheets.get("職員ID").data[1][3]); const t = api("", "auth.login", ["000", pin, "x"]).data.token; api(t, "auth.changePin", [pin, "5829"]);
let r = api(t, "ai.messages", [{ messages: [{ role: "user", content: "hi" }] }]); assert.strictEqual(r.code, "not_granted"); console.log("✔ APIキー未設定:", r.message);
let sent = null, code = 200;
g.ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k === "ANTHROPIC_API_KEY" ? "sk-test" : null) }) };
g.ctx.UrlFetchApp = { fetch: (u, o) => { sent = { u, o }; return { getResponseCode: () => code, getContentText: () => JSON.stringify(code === 200 ? { content: [{ type: "text", text: '{"reply":"ok"}' }], stop_reason: "end_turn" } : { error: { message: "overloaded" } }) }; } };
r = api(t, "ai.messages", [{ messages: [{ role: "user", content: "hi" }], system: "送迎のルール", maxTokens: 4000 }]);
const pl = JSON.parse(sent.o.payload); assert.strictEqual(r.data.text, '{"reply":"ok"}'); assert.strictEqual(pl.system, "送迎のルール"); assert.strictEqual(pl.model, "claude-sonnet-5-5"); assert.strictEqual(sent.o.headers["x-api-key"], "sk-test");
assert.ok(!JSON.stringify(r).includes("sk-test"), "キーは画面に返らない"); console.log("✔ 指示文・モデル・上限を渡し、キーは画面に返さない");
code = 529; r = api(t, "ai.messages", [{ messages: [{ role: "user", content: "hi" }] }]); assert.strictEqual(r.code, "unavailable"); console.log("✔ 混雑時:", r.message);
const d = require("./fakegas.js"); const pin2 = g.sheets.get("職員ID").data.find((x) => x[1] === "日野"); 
console.log("3/3 passed");
