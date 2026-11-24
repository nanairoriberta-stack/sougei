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
  await offlineTest(W);
  await embedTest(W);
  await keepTest(W);
  await opsTest(W);
})().catch((e) => { console.error(e); process.exit(1); });

/* 電波がないときに最後に見た予定（2026-11-17 依頼者「オフラインでも最終みたカレンダーみれるように」）：
   本物のカレンダーの画面を入口のページの中で開く → 読んだ予定が入口のページの端末に残る → 電波がない画面（/offline.html）に出る。ログアウトで消える */
async function offlineTest(W) {
  const { makeGas } = require("../gas/fakegas.js"), D = path.join(__dirname, "../gas/out");
  const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Lib5_shift.gs", "Code.gs"].map((f) => path.join(D, f))); g.ctx.setup();
  const api = (t, m, a) => JSON.parse(JSON.stringify(g.ctx.api(t, m, JSON.parse(JSON.stringify(a)))));
  const rows = g.sheets.get("職員ID").data.slice(1).filter((r) => r[0] !== "" && r[0] !== undefined), pin0 = String(rows[0][3]);
  const t = api("", "auth.login", ["000", pin0, "node"]).data.token; api(t, "auth.changePin", [pin0, "5829"]);
  const td = new Date(), ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, today = ymd(td);
  const r = api(t, "cal.apply", [{ kind: "upsert", opId: "op_off00001", id: "ev_off00001", baseRev: null, ev: { title: "電波なしの試し 会議", date: today, endDate: today, allDay: false, start: "10:00", end: "11:00", label: "other", place: "本部", memo: "メモは残さない", members: [] } }]);
  assert.ok(r.data && r.data.status === "ok", "予定を入れる " + JSON.stringify(r).slice(0, 200));
  const key = api(t, "auth.deviceLink", []).data.key;
  const ORIGIN = "https://nanairo.example.workers.dev";
  const html = fs.readFileSync(path.join(D, "calendar.html"), "utf8").replace("/*__BOOT__*/", `window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_KEY="${key}";window.__SG_WRAP="${ORIGIN}";`);
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  await ctx.exposeFunction("__gasApi", (tk, m, a) => api(tk, m, a));
  await ctx.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { setTimeout(() => window.__gasApi(tk, m, a).then((r) => s && s(r), (e) => f && f(e)), 20); } }; })() } }; });
  let cut = false;   // 電波がない（入口のページにもつながらない）
  await ctx.route(ORIGIN + "/**", async (route) => { if (cut) return route.abort("internetdisconnected"); const q = await W.fetch(new Request(route.request().url(), { method: route.request().method() }), {});
    route.fulfill({ status: q.status, headers: Object.fromEntries(q.headers), body: Buffer.from(await q.arrayBuffer()) }); });
  await ctx.route("https://script.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await pg.goto(ORIGIN + "/?page=calendar");
  await pg.waitForFunction(() => { try { return (localStorage.getItem("calSnap") || "").includes("電波なしの試し"); } catch (e) { return false; } }, null, { timeout: 20000 });
  const snap = await pg.evaluate(() => JSON.parse(localStorage.getItem("calSnap")));
  const ev = snap.ev.find((e) => e.t === "電波なしの試し 会議");
  assert.ok(ev && ev.d === today && ev.s === "10:00" && ev.l === "その他予定" && ev.p === "本部" && ev.g === "other", "入口のページに残る " + JSON.stringify(ev));
  assert.ok(!JSON.stringify(snap).includes("メモは残さない") && !JSON.stringify(snap).includes(key), "メモ・鍵は残さない");
  // 電波がないときの画面
  await pg.goto(ORIGIN + "/offline.html");
  await pg.waitForSelector(".ev");
  const tx = await pg.textContent("#list"), info = await pg.textContent("#info");
  assert.ok(tx.includes("今日") && tx.includes("電波なしの試し 会議") && tx.includes("10:00〜11:00") && tx.includes("その他予定・本部"), tx.slice(0, 300));
  assert.ok(info.includes("に見た予定です"), info);
  await pg.screenshot({ path: path.join(__dirname, "g_entry_offline.png") });
  // 電波が切れたら上にお知らせ
  await pg.goto(ORIGIN + "/?page=calendar"); await pg.waitForTimeout(1500);
  await ctx.setOffline(true); await pg.evaluate(() => window.dispatchEvent(new Event("offline"))); await pg.waitForTimeout(300);
  assert.ok(await pg.locator("#offchip").isVisible(), "電波がないお知らせ");
  assert.strictEqual(await pg.getAttribute("#offchip", "href"), "/offline.html");
  await ctx.setOffline(false); await pg.evaluate(() => window.dispatchEvent(new Event("online"))); await pg.waitForTimeout(200);
  assert.strictEqual(await pg.locator("#offchip").count(), 0, "電波が戻ったら消える");
  // まったく電波がないときにアイコンから開く → 端末に置いた画面（サービスワーカー）が出る
  assert.ok(await pg.evaluate(() => !!navigator.serviceWorker.controller), "端末の小さなプログラムが入っている");
  cut = true; await ctx.setOffline(true);
  await pg.goto(ORIGIN + "/?page=calendar", { timeout: 20000 }); await pg.waitForSelector(".ev", { timeout: 5000 });
  assert.ok((await pg.textContent("#list")).includes("電波なしの試し 会議"), "電波がなくても最後に見た予定が出る");
  cut = false; await ctx.setOffline(false);
  await pg.goto(ORIGIN + "/?page=calendar"); await pg.waitForTimeout(1500);
  // ログアウトすると消える
  const fr = pg.frames().find((f) => f.url().startsWith("https://script.google.com"));
  await fr.evaluate(() => { window.location.reload = () => {}; });
  await fr.waitForSelector(".sgh-chip"); await fr.locator(".sgh-chip").first().click(); await fr.waitForTimeout(200);
  fr.page().once("dialog", (d) => d.accept()); await fr.click('[data-a="out"]'); await pg.waitForTimeout(800);
  assert.strictEqual(await pg.evaluate(() => localStorage.getItem("calSnap")), null, "ログアウトで消える");
  // 何も残っていない端末
  await pg.goto(ORIGIN + "/offline.html"); assert.ok((await pg.textContent("#info")).includes("まだ予定が残っていません"));
  assert.deepStrictEqual(errs.filter((e) => !/fonts|ERR_/.test(e)), [], "画面エラーなし");
  await b.close(); console.log("電波がないときの最後に見た予定 OK");
}

/* 送迎表の右のカレンダー（2026-11-17 依頼者「開かなくなってる？」）：入口のページ → 送迎表（Google）→ 入口のページ（embed=1）→ カレンダー（Google）。
   入口のページは embed=1 のときだけ Google の画面の中にはめこめる。カレンダーの「保存した」は送迎表まで届く */
async function embedTest(W) {
  const ORIGIN = "https://nanairo.example.workers.dev";
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1200, height: 800 } }), pg = await ctx.newPage();
  await ctx.route(ORIGIN + "/**", async (route) => { const q = await W.fetch(new Request(route.request().url()), {});
    route.fulfill({ status: q.status, headers: Object.fromEntries(q.headers), body: Buffer.from(await q.arrayBuffer()) }); });
  await ctx.route("https://script.google.com/**", (route) => { const u = new URL(route.request().url());
    if (u.searchParams.get("page") === "calendar") return route.fulfill({ status: 200, contentType: "text/html",   // 中のカレンダー（保存したら親に知らせる）
      body: `<!DOCTYPE html><body><p id="cal">calendar ${u.searchParams.get("embed")} ${u.searchParams.get("wrap")}</p><script>setTimeout(()=>window.parent.postMessage({sg:"cal-saved"},"*"),300)</script></body>` });
    return route.fulfill({ status: 200, contentType: "text/html",   // 送迎表（右にカレンダーをはめこむ）
      body: `<!DOCTYPE html><body><p>sougei</p><iframe id="side" src="${ORIGIN}/?page=calendar&embed=1"></iframe><script>window.got=[];addEventListener("message",e=>{window.got.push(e.data&&e.data.sg)})</script></body>` }); });
  await pg.goto(ORIGIN + "/?page=sougei&e=v2"); await pg.waitForTimeout(2500);
  const sougei = pg.frames().find((f) => f.url().startsWith("https://script.google.com") && /page=sougei/.test(f.url()));
  const cal = pg.frames().find((f) => /page=calendar/.test(f.url()) && f.url().startsWith("https://script.google.com"));
  assert.ok(cal, "右のカレンダーが開く（はめこみを断られない） " + pg.frames().map((f) => f.url()).join(" | "));
  assert.strictEqual((await cal.textContent("#cal")).trim(), "calendar 1 " + ORIGIN, "中のカレンダーに embed=1 と入口が渡る");
  assert.ok((await sougei.evaluate(() => window.got)).includes("cal-saved"), "保存したら送迎表に知らせる（入口のページが中継）");
  // ほかのサイトの中には、embed でもはめこめない
  await ctx.route("https://evil.example.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!DOCTYPE html><iframe src="${ORIGIN}/?page=calendar&embed=1"></iframe>` }));
  const pg2 = await ctx.newPage(); await pg2.goto("https://evil.example.com/x"); await pg2.waitForTimeout(1500);
  assert.ok(!pg2.frames().some((f) => /page=calendar/.test(f.url()) && f.url().startsWith("https://script.google.com")), "ほかのサイトでは開かない");
  await b.close(); console.log("送迎表の右のカレンダー（入口のページ経由）OK");
}

/* ログインしたまま（2026-11-22 依頼者「ログイン維持したままにならない」）：iPhoneのホーム画面から開くと中のGoogleの画面の端末の保存が消えることがある。
   入口のページにもログインを覚え、中の画面の保存が消えていてもそれでログインする。ログアウトで消える。ほかのサイトには渡さない */
async function keepTest(W) {
  const { makeGas } = require("../gas/fakegas.js"), D = path.join(__dirname, "../gas/out");
  const g = makeGas(["Lib1_calcore.gs", "Lib2_merge.gs", "Lib3_calsync.gs", "Lib5_shift.gs", "Code.gs"].map((f) => path.join(D, f))); g.ctx.setup();
  const api = (t, m, a) => JSON.parse(JSON.stringify(g.ctx.api(t, m, JSON.parse(JSON.stringify(a)))));
  const rows = g.sheets.get("職員ID").data.slice(1).filter((r) => r[0] !== "" && r[0] !== undefined), pin0 = String(rows[0][3]);
  const t0 = api("", "auth.login", ["000", pin0, "node"]).data.token; api(t0, "auth.changePin", [pin0, "5829"]);
  const ORIGIN = "https://nanairo.example.workers.dev";
  const html = fs.readFileSync(path.join(D, "calendar.html"), "utf8").replace("/*__BOOT__*/", `window.__SG_EDITION="v1";window.__SG_BASE="https://script.google.com/macros/s/TEST/exec";window.__SG_WRAP="${ORIGIN}";`);
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  await ctx.exposeFunction("__gasApi", (tk, m, a) => api(tk, m, a));
  await ctx.addInitScript(() => { window.google = { script: { run: (function mk(s, f) { return { withSuccessHandler: (x) => mk(x, f), withFailureHandler: (x) => mk(s, x), api: (tk, m, a) => { setTimeout(() => window.__gasApi(tk, m, a).then((r) => s && s(r), (e) => f && f(e)), 20); } }; })() } }; });
  await ctx.route(ORIGIN + "/**", async (route) => { const q = await W.fetch(new Request(route.request().url(), { method: route.request().method() }), {});
    route.fulfill({ status: q.status, headers: Object.fromEntries(q.headers), body: Buffer.from(await q.arrayBuffer()) }); });
  await ctx.route("https://script.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const frame = () => pg.frames().find((f) => f.url().startsWith("https://script.google.com"));
  await pg.goto(ORIGIN + "/?page=calendar"); await pg.waitForTimeout(500);
  let fr = frame(); await fr.waitForSelector("#sghNo", { timeout: 8000 });
  await fr.fill("#sghNo", "000"); await fr.fill("#sghPin", "5829"); await fr.click("#sghGo");
  await fr.waitForSelector(".sgh-chip", { timeout: 8000 });
  await pg.waitForFunction(() => /^[0-9a-f-]{40,90}$/.test(localStorage.getItem("sgTok") || ""), null, { timeout: 5000 });
  // 中の画面の端末の保存が消えた（iPhoneのホーム画面から開き直したとき）→ ログインの画面を出さずに開く
  await fr.evaluate(() => localStorage.clear());
  await pg.reload(); await pg.waitForTimeout(500); fr = frame();
  await fr.waitForSelector(".sgh-chip", { timeout: 8000 });
  assert.strictEqual(await fr.locator("#sghNo").count(), 0, "ログインの画面を出さない");
  assert.ok(await fr.evaluate(() => !!localStorage.getItem("sg:token")), "中の画面にもまた覚える");
  // ほかのサイト（入口のページの中でない画面）が聞いても渡さない
  const got = await pg.evaluate(() => new Promise((res) => { const w = window.open("about:blank"); let r = "none"; window.addEventListener("message", (e) => { if (e.data && e.data.sg === "token") r = e.data.t; }); window.postMessage({ sg: "need-token" }, "*"); setTimeout(() => { try { w.close(); } catch (e) {} res(r); }, 500); }));
  assert.strictEqual(got, "none", "入口の外には渡さない");
  // ログアウトすると入口のページの分も消える
  await fr.evaluate(() => { window.location.reload = () => {}; });
  await fr.locator(".sgh-chip").first().click(); await fr.waitForTimeout(200);
  pg.once("dialog", (d) => d.accept()); await fr.click('[data-a="out"]'); await pg.waitForTimeout(800);
  assert.strictEqual(await pg.evaluate(() => localStorage.getItem("sgTok")), null, "ログアウトで消える");
  // 使えなくなったログイン（暗証番号の変更など）を覚えていたら、ふつうのログインの画面
  await pg.evaluate(() => localStorage.setItem("sgTok", "0123456789abcdef0123456789abcdef0123456789abcdef"));
  await pg.reload(); await pg.waitForTimeout(500); fr = frame();
  await fr.waitForSelector("#sghNo", { timeout: 8000 });
  await pg.waitForFunction(() => localStorage.getItem("sgTok") === null, null, { timeout: 5000 });
  assert.deepStrictEqual(errs.filter((e) => !/fonts|ERR_/.test(e)), [], "画面エラーなし");
  await b.close(); console.log("入口のページでログインしたまま OK");
}

/* まだ送れていない予定の控え（2026-11-24 依頼者「カレンダーに入れたデータが絶対消えないように」）：中の画面が入口のページに控え、開き直したときに返してもらう。ほかのサイトには渡さない */
async function opsTest(W) {
  const ORIGIN = "https://nanairo.example.workers.dev";
  const b = await chromium.launch(), ctx = await b.newContext(), pg = await ctx.newPage();
  await ctx.route(ORIGIN + "/**", async (route) => { const q = await W.fetch(new Request(route.request().url()), {});
    route.fulfill({ status: q.status, headers: Object.fromEntries(q.headers), body: Buffer.from(await q.arrayBuffer()) }); });
  await ctx.route("https://script.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!DOCTYPE html><body><script>
    window.got=[];window.gotD=[];addEventListener("message",e=>{if(e.data&&e.data.sg==="ops"){window.got.push(e.data.ops);window.gotD.push(e.data.draft)}});
    window.keepD=(d)=>window.top.postMessage({sg:"keep-draft",draft:d},"${ORIGIN}");
    window.keep=(ops)=>window.top.postMessage({sg:"keep-ops",ops},"${ORIGIN}");window.ask=()=>window.top.postMessage({sg:"need-ops"},"${ORIGIN}");</script></body>` }));
  await pg.goto(ORIGIN + "/?page=calendar"); await pg.waitForTimeout(800);
  const fr = () => pg.frames().find((f) => f.url().startsWith("https://script.google.com"));
  const op = { opId: "op_test0001", seq: 1, kind: "upsert", id: "ev_test0001", state: "queued", ev: { title: "電波なしで入れた予定", date: "2026-12-01" } };
  await fr().evaluate((o) => window.keep([o]), op); await pg.waitForTimeout(200);
  assert.ok((await pg.evaluate(() => localStorage.getItem("sgOps") || "")).includes("電波なしで入れた予定"), "入口のページに控える");
  await pg.reload(); await pg.waitForTimeout(800);   // 閉じて開き直した（中の画面の保存は消えている）
  await fr().evaluate(() => window.ask()); await pg.waitForTimeout(300);
  const got = await fr().evaluate(() => window.got);
  assert.strictEqual(got.length, 1); assert.strictEqual(got[0][0].opId, "op_test0001", "開き直すと返してもらえる");
  await fr().evaluate(() => window.keepD({ id: null, form: { title: "書きかけの試し" }, savedAt: "x" })); await pg.waitForTimeout(200);   // 書きかけも
  await fr().evaluate(() => window.ask()); await pg.waitForTimeout(300);
  assert.strictEqual((await fr().evaluate(() => window.gotD))[1].form.title, "書きかけの試し", "書きかけも返してもらえる");
  await fr().evaluate(() => window.keepD(null)); await pg.waitForTimeout(200);
  assert.strictEqual(await pg.evaluate(() => localStorage.getItem("sgDraft")), null, "書きかけを消したら控えも消える");
  await fr().evaluate(() => window.keep([])); await pg.waitForTimeout(200);
  assert.strictEqual(await pg.evaluate(() => localStorage.getItem("sgOps")), null, "送り終わったら控えを消す");
  // ほかのサイト（入口の中でない窓）が聞いても渡さない
  await pg.evaluate((o) => localStorage.setItem("sgOps", JSON.stringify([o])), op);
  const r = await pg.evaluate(() => new Promise((res) => { let v = "none"; addEventListener("message", (e) => { if (e.data && e.data.sg === "ops") v = "got"; }); window.postMessage({ sg: "need-ops" }, "*"); setTimeout(() => res(v), 500); }));
  assert.strictEqual(r, "none", "入口の外には渡さない");
  await b.close(); console.log("未送信の予定の控え（入口のページ）OK");
}
