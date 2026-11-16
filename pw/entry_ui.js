// 入口のページ（Cloudflare）の画面：中のアプリ（Google）から頼まれたら「通知を受け取りますか」の案内が出る（2026-11-16）
const { chromium } = require("playwright");
const assert = require("assert");
const path = require("path"), fs = require("fs"), os = require("os");
(async () => {
  const src = fs.readFileSync(path.join(__dirname, "../gas/out/entry_cloudflare.js"), "utf8");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entry-ui-")), f = path.join(tmp, "e.mjs"); fs.writeFileSync(f, src);
  const W = (await import(f)).default;
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ["notifications"] }), pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  // 試しの画面（ヘッドレス）は通知が「拒否」のままなので、まだ聞かれていない新しいスマホと同じ「未設定」にする
  await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch (e) {} });
  // 入口のページは Worker の返事をそのまま返す。中の Google の画面は「通知を受け取りますか」と頼む小さな画面にする
  await ctx.route("https://nanairo.example.workers.dev/**", async (route) => {
    const r = await W.fetch(new Request(route.request().url(), { method: route.request().method() }), {});
    route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
  });
  await ctx.route("https://script.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html",
    body: `<!DOCTYPE html><body>app<script>window.top.postMessage({sg:"push-ask",key:"B${"x".repeat(86)}"},"https://nanairo.example.workers.dev")</script></body>` }));
  await pg.goto("https://nanairo.example.workers.dev/?page=calendar");
  await pg.waitForSelector("#pushbar", { timeout: 5000 });
  const t = await pg.textContent("#pushbar");
  assert.ok(t.includes("カレンダーに予定が入ったとき") && t.includes("受け取る") && t.includes("あとで"), t);
  await pg.screenshot({ path: path.join(__dirname, "g_entry_push.png") });
  await pg.click('#pushbar button:text-is("あとで")'); await pg.waitForTimeout(200);
  assert.strictEqual(await pg.locator("#pushbar").count(), 0, "あとで → 閉じる");
  await pg.reload(); await pg.waitForTimeout(1500);
  assert.strictEqual(await pg.locator("#pushbar").count(), 0, "あとでを押したら1週間は出さない");
  assert.deepStrictEqual(errs, [], "画面エラーなし");
  // ほかのサイトからの頼みは聞かない
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await pg.evaluate(() => window.postMessage({ sg: "push-ask", key: "B" + "x".repeat(86) }, "*")); await pg.waitForTimeout(500);
  assert.strictEqual(await pg.locator("#pushbar").count(), 0, "Google以外から頼まれても出さない");
  await b.close(); console.log("入口のページの通知の案内 OK");
})().catch((e) => { console.error(e); process.exit(1); });
