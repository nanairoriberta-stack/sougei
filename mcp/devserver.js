// 検証用の常駐サーバー：Google版の送迎表(擬似)＋中継。ブラウザ用の /api も出す
const http = require("http"), fs = require("fs"), path = require("path");
const T = require("./test-mcp.js");
(async () => {
  const date = "2026-11-02"; const S = T.setupGas(); T.seed(S, date); const { g, api, t } = S;
  const sh = g.ctx.SpreadsheetApp.getActiveSpreadsheet(); g.ctx.issueConnectorUrls(); sh.getSheetByName("AI接続").getRange(2, 1).setValue("000"); g.ctx.issueConnectorUrls();
  const key = /k=([0-9a-f]+)/.exec(String(sh.getSheetByName("AI接続").data[1][2]))[1];
  const G = await T.gasServer(g);
  const R = await T.relayServer("http://127.0.0.1:" + G.port + "/macros/s/TEST/exec");
  const A = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { const { tk, m, a } = JSON.parse(b); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(api(tk, m, a))); }); });
  A.listen(8790, "127.0.0.1");
  fs.writeFileSync(path.join(__dirname, "dev.json"), JSON.stringify({ mcp: "http://127.0.0.1:" + R.port + "/mcp/" + key, api: "http://127.0.0.1:8790", token: t, date }));
  console.log("ready", R.port);
})();
