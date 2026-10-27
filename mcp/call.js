// 使い方: node mcp/call.js <道具名> '<引数JSON>'   … Claudeアプリがコネクタを呼ぶのと同じ経路(中継→Google)で呼ぶ
const T = require("./test-mcp.js"); const dev = require("./dev.json");
(async () => { const c = await T.connect(dev.mcp); const r = await c.callTool({ name: process.argv[2], arguments: JSON.parse(process.argv[3] || "{}") }); console.log(T.text(r)); await c.close(); })().catch((e) => { console.error("ERR", e.message); process.exit(1); });
