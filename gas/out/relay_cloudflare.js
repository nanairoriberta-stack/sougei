// 送迎表 ⇄ Claude の中継（Cloudflare Workers・無料枠で動きます）
// Googleのウェブアプリは返事を必ず「302 転送」で返すため、Claudeなどの接続側が転送をたどらないことがあります。
// この中継がGoogleへの転送をたどり、結果をそのまま返します。中身は保存しません。
//
// 設定: Workers の「設定 → 変数」に GAS_URL（送迎表のウェブアプリURL、…/exec で終わるもの）を入れる
// Claudeに貼るURL: https://<この中継の名前>.workers.dev/mcp/<接続URLの k= の後ろの文字>
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = /^\/mcp\/([0-9a-f]{40,128})\/?$/.exec(url.pathname);
    if (!m) return new Response("Not found", { status: 404 });
    if (request.method === "GET" || request.method === "DELETE") return new Response(null, { status: 405, headers: { allow: "POST" } });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const body = await request.text();
    if (body.length > 1_000_000) return new Response("Too large", { status: 413 });
    const target = String(env.GAS_URL || "").replace(/\?.*$/, "") + "?mcp=1&k=" + m[1];
    let res;
    try {
      res = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body, redirect: "follow" });
    } catch (e) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Googleにつながりませんでした" } }, 502);
    }
    const text = await res.text();
    if (!res.ok) return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Googleの返事が異常です (" + res.status + ")" } }, 502);
    if (!text.trim()) return new Response(null, { status: 202 });             // 通知だけのときは「受け取りました」
    if (text.trimStart().charAt(0) === "<") return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Googleがログイン画面を返しました。ウェブアプリの「アクセスできるユーザー」を「全員」にしてください" } }, 502);
    return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  },
};
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });
