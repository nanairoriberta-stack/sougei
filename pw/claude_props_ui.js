const { chromium } = require("playwright"); const path = require("path"), fs = require("fs");
const dev = require("../mcp/dev.json"); const D = path.join(__dirname, "../gas/out");
const api = async (m, a) => (await (await fetch(dev.api, { method: "POST", body: JSON.stringify({ tk: dev.token, m, a }) })).json());
(async () => {
  const LOC = { "react.production.min.js": "node_modules/react/umd/react.production.min.js", "react-dom.production.min.js": "node_modules/react-dom/umd/react-dom.production.min.js", "three.min.js": "node_modules/three/build/three.min.js" };
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.exposeFunction("__gasApi", async (tk, m, a) => (await (await fetch(dev.api, { method: "POST", body: JSON.stringify({ tk, m, a }) })).json()));
  await pg.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { setTimeout(() => window.__gasApi(tk, m, a).then((r) => s && s(r), (e) => f && f(e)), 30); } }; })() } }; });
  await pg.route("https://**/*", async (r) => { const u = r.request().url(); for (const k in LOC) if (u.endsWith(k)) return r.fulfill({ path: LOC[k], contentType: "application/javascript" }); return r.abort(); });
  const html = fs.readFileSync(path.join(D, "sougei.html"), "utf8").replace("/*__BOOT__*/", `window.__SG_EDITION="v1";window.__SG_BASE="https://x/exec";window.__SG_DATE="${dev.date}";`);
  fs.writeFileSync(path.join(__dirname, "c_sougei.html"), html);
  await pg.goto("file://" + path.join(__dirname, "c_sougei.html")); await pg.waitForTimeout(600);
  await pg.fill("#sghNo", "000"); await pg.fill("#sghPin", "5829"); await pg.click("#sghGo"); await pg.waitForTimeout(5000);
  const btn = pg.getByRole("button", { name: /Claudeの案/ }); console.log("ボタン:", await btn.innerText());
  // 確認している間に、別の職員が同じ日の連絡事項を書いた
  const cur = (await api("kv.get", ["sheet:" + dev.date])).data; cur.value.contact = "別の職員が書いた連絡(消えてはいけない)"; console.log("他の人の保存:", JSON.stringify((await api("kv.cas", [{ key: "sheet:" + dev.date, rev: cur.rev, value: cur.value }])).ok));
  await btn.click(); await pg.waitForTimeout(800); await pg.screenshot({ path: path.join(__dirname, "c_panel.png") });
  await pg.getByRole("button", { name: "この案を反映" }).click(); await pg.waitForTimeout(5000);
  await pg.screenshot({ path: path.join(__dirname, "c_after.png") });
  const s = (await api("kv.get", ["sheet:" + dev.date])).data.value, mm = (await api("kv.get", ["master"])).data.value;
  const id = (n) => mm.staff.find((x) => x.name === n).id; const who = (t, u) => { const r = s.runs.find((r) => r.time === t && (r.userIds || []).length && JSON.stringify(r).includes(mm.users.find((x) => x.name === u).id)); return r && mm.staff.find((x) => x.id === r.staffId).name; };
  console.log("安達:", JSON.stringify(s.staffOv[id("安達")]), "/ 安達の便:", s.runs.filter((r) => r.staffId === id("安達")).length);
  console.log("15:30 勝部→", who("15:30", "勝部"), " 16:00 八壁→", who("16:00", "八壁"), " 17:00 竹田寛→", who("17:00", "竹田寛"));
  console.log("連絡事項:", s.contact, "/ 特記事項:", s.notes, "/ AI記録:", s.aiLog);
  console.log("ボタン残り:", await pg.getByRole("button", { name: /Claudeの案/ }).count(), "/ 画面に安達休み表示:", (await pg.locator("body").innerText()).includes("安達さん休み"));
  console.log("変更履歴:", JSON.stringify((await api("log.list", [5])).data.map((r) => [r.name || r[2], r.kind || r[3], r.target || r[4]]).slice(0, 4)));
  console.log("画面エラー:", errs); await b.close();
})();
