// なないろ 入口のページ（Cloudflare Workers・無料枠で動きます）
// iPhoneのホーム画面のアイコンを「なないろ」の絵にし、Googleの「このアプリケーションは Google Apps Script のユーザーによって作成されたものです」の帯を出さないために、
// アプリ（Googleのウェブアプリ）をこのページの中にはめこんで出します。予定・送迎表・暗証番号などのデータはこのページを通りません（Googleとだけやり取りします）。
//
// 開くアドレス（<名前> は Cloudflare で付けた名前）
//   カレンダー      https://<名前>.workers.dev/
//   送迎表          https://<名前>.workers.dev/?page=sougei&e=v2   （e=v1 現体制版・v2 新体制版・v3 りんく・ぷれいす版）
//   シフト表        https://<名前>.workers.dev/?page=shift
//   ログインしたまま（自分専用）  https://<名前>.workers.dev/?page=calendar&k=…   （アプリのメニュー「📱 ログインしたままにする」で作れます。人に教えない）
//
// 下の APP_URL が、Googleのウェブアプリのアドレス（…/exec で終わるもの）です。デプロイのアドレスが変わったときだけ直してください。
// （Cloudflare の「設定 → 変数」に GAS_URL を入れた場合は、そちらが先に使われます）
const APP_URL = "__APP_URL__";

const ICON180 = "__ICON180__";   // なないろのアイコン（180×180、iPhone用）
const ICON192 = "__ICON192__";   // なないろのアイコン（192×192、Android用）

const TITLES = { calendar: "なないろカレンダー", sougei: "なないろ送迎表", shift: "なないろシフト表" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const b64bytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const EXEC_RE = /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/;

// アプリに渡してよい値だけを通す（ほかの値は捨てる）
const PASS = { page: /^(calendar|sougei|shift)$/, e: /^v[123]$/, d: /^\d{4}-\d{2}-\d{2}$/, k: /^[0-9a-f]{40,80}$/ };

export function entryPage(reqUrl, appUrl) {
  const u = new URL(reqUrl);
  const q = new URLSearchParams();
  for (const [name, re] of Object.entries(PASS)) { const v = u.searchParams.get(name); if (v && re.test(v)) q.set(name, v); }
  if (!q.get("page")) q.set("page", "calendar");
  q.set("wrap", u.origin);   // アプリ側は、画面どうしのリンクもこの入口を通す
  const src = appUrl + "?" + q.toString();
  const page = q.get("page"), title = TITLES[page] + (page === "sougei" ? ({ v1: "（現体制版）", v2: "（新体制版）", v3: "（りんく・ぷれいす版）" }[q.get("e") || "v1"] || "") : "");
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${esc(TITLES[page])}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<style>html,body{margin:0;height:100%;background:#fff}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
</head><body>
<iframe src="${esc(src)}" title="${esc(title)}" allow="clipboard-read; clipboard-write; fullscreen" referrerpolicy="no-referrer"></iframe>
</body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const appUrl = String((env && env.GAS_URL) || APP_URL).replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET" } });
    if (url.pathname === "/icon-180.png" || url.pathname === "/apple-touch-icon.png" || url.pathname === "/apple-touch-icon-precomposed.png")
      return new Response(b64bytes(ICON180), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    if (url.pathname === "/icon-192.png" || url.pathname === "/favicon.ico")
      return new Response(b64bytes(ICON192), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    if (url.pathname === "/manifest.webmanifest")
      return new Response(JSON.stringify({ name: "なないろ", short_name: "なないろ", start_url: "/", display: "standalone", background_color: "#ffffff", theme_color: "#ffffff",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-180.png", sizes: "180x180", type: "image/png" }] }),
        { headers: { "content-type": "application/manifest+json" } });
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    if (!EXEC_RE.test(appUrl)) return new Response("APP_URL（Googleのウェブアプリのアドレス …/exec）が入っていません", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(entryPage(request.url, appUrl), { headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",                       // 「ログインしたまま」の鍵がほかへ漏れないように
      "x-frame-options": "DENY",                              // この入口のページを、ほかのサイトの中にはめこませない
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; manifest-src 'self'; frame-src https://script.google.com https://*.googleusercontent.com; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
    } });
  },
};
