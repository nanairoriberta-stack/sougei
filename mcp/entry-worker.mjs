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

// ================= スマホの通知（Web Push。2026-11-16 依頼者「通知機能」→ 方法1・全員・予定が入った時と今日の予定） =================
// 通知の暗号化（RFC 8291 aes128gcm）と送り主の証明（VAPID、RFC 8292）をここで行う（Googleの側では暗号の計算ができないため）。
// 鍵（VAPID）は Google 側（スクリプト プロパティ）が持ち、送るたびに渡す＝この入口のページは何も保存しない。
const enc = new TextEncoder();
export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key, data) { const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, data)); }
async function hkdf(salt, ikm, info, len) { const prk = await hmac(salt, ikm); return (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len); }
const jwkFromRaw = (raw, d) => ({ kty: "EC", crv: "P-256", x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33, 65)), ...(d ? { d } : {}), ext: true });
// 通知の中身を、受け取る端末の鍵で暗号化する（opts.salt・opts.asPrivate はテスト用）
export async function encryptPayload(p256dh, auth, plaintext, opts = {}) {
  const ua = unb64u(p256dh), authSecret = unb64u(auth);
  let asPriv, asPubRaw;
  if (opts.asPrivate) { asPubRaw = unb64u(opts.asPublic); asPriv = await crypto.subtle.importKey("jwk", jwkFromRaw(asPubRaw, opts.asPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]); }
  else { const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]); asPriv = kp.privateKey; asPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); }
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPriv, 256));
  const ikm = await hkdf(authSecret, ecdh, cat(enc.encode("WebPush: info\0"), ua, asPubRaw), 32);
  const salt = opts.salt ? unb64u(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(typeof plaintext === "string" ? enc.encode(plaintext) : plaintext, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // 4096
  return cat(salt, rs, new Uint8Array([asPubRaw.length]), asPubRaw, ct);
}
// 送り主の証明（VAPID の JWT）。送り先のサービス（Apple・Google など）ごとに1つ
export async function vapidHeader(endpoint, vapid, subject, nowSec) {
  const aud = new URL(endpoint).origin, now = nowSec || Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))), c = b64u(enc.encode(JSON.stringify({ aud, exp: now + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...vapid.privateJwk, key_ops: ["sign"], ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(h + "." + c));
  return "vapid t=" + h + "." + c + "." + b64u(sig) + ", k=" + vapid.publicKey;
}
// 送ってよい通知のサービス（ほかのアドレスへは送らない）
const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chrome\.google\.com)(\/|$)/i;
export async function sendPushes(body, fetchFn) {
  const items = (body.items || []).slice(0, 12), out = [], auths = {};
  const payload = JSON.stringify(body.payload || {}).slice(0, 3000);
  for (const it of items) {
    try {
      if (!it || !PUSH_HOST.test(String(it.endpoint || "")) || !it.keys) { out.push({ endpoint: it && it.endpoint, status: 400 }); continue; }
      const aud = new URL(it.endpoint).origin;
      if (!auths[aud]) auths[aud] = await vapidHeader(it.endpoint, body.vapid, body.subject);
      const data = await encryptPayload(it.keys.p256dh, it.keys.auth, payload);
      const r = await (fetchFn || fetch)(it.endpoint, { method: "POST", headers: { authorization: auths[aud], "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "normal", topic: String(body.payload && body.payload.tag || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined }, body: data });
      out.push({ endpoint: it.endpoint, status: r.status });
    } catch (e) { out.push({ endpoint: it && it.endpoint, status: 0, error: String(e && e.message || e).slice(0, 200) }); }
  }
  return out;
}
export async function newVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey), raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { publicKey: b64u(raw), privateJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d } };
}
// 端末の中で動く小さなプログラム（通知を出す・押したら開く）
const SW_JS = `self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={title:"なないろ",body:e.data?e.data.text():""}}
e.waitUntil(self.registration.showNotification(d.title||"なないろ",{body:d.body||"",tag:d.tag||undefined,icon:"/icon-192.png",badge:"/icon-192.png",data:{url:d.url||"/"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();const u=new URL((e.notification.data&&e.notification.data.url)||"/",self.location.origin).href;
e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l){if("navigate"in c){c.focus();return c.navigate(u)}}return self.clients.openWindow(u)}))});`;
// 入口のページの中の小さなプログラム：アプリ（中のGoogleの画面）から「通知を受け取りますか」と頼まれたら、下に案内を出し、押されたら通知を登録してアプリに返す
const ENTRY_JS = `(function(){var bar=null,ask=null,app=null;
function standalone(){return window.navigator.standalone===true||window.matchMedia("(display-mode: standalone)").matches}
function ios(){return /iPhone|iPad|iPod/.test(navigator.userAgent)}
function ok(){return "serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window}
function reply(m){try{app&&app.postMessage(m,"*")}catch(e){}}
function hide(){if(bar){bar.remove();bar=null}}
function show(html,btns){hide();bar=document.createElement("div");bar.id="pushbar";bar.innerHTML='<p>'+html+'</p>';(btns||[]).forEach(function(b){var x=document.createElement("button");x.textContent=b[0];x.onclick=b[1];if(b[2])x.className=b[2];bar.appendChild(x)});document.body.appendChild(bar)}
function b64(s){s=s.replace(/-/g,"+").replace(/_/g,"/");s+="===".slice((s.length+3)%4);var r=atob(s),o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o}
async function sub(){try{var p=await Notification.requestPermission();if(p!=="granted"){show("通知は許可されませんでした。あとで受け取るときは、iPhoneの「設定 → 通知 → なないろ」で許可してください。",[["閉じる",hide]]);return}
var reg=await navigator.serviceWorker.register("/sw.js");await navigator.serviceWorker.ready;var s=await reg.pushManager.getSubscription();
if(!s)s=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(ask.key)});reply({sg:"push-sub",sub:s.toJSON()});hide()}catch(e){show("通知を登録できませんでした（"+(e&&e.message||e)+"）",[["閉じる",hide]])}}
async function check(){if(!ok()){if(ios()&&!standalone())show("通知を受け取るには、この画面を<b>ホーム画面に追加</b>して、ホーム画面のなないろのアイコンから開いてください。",[["閉じる",hide]]);return}
try{var reg=await navigator.serviceWorker.getRegistration("/");var s=reg&&await reg.pushManager.getSubscription();if(s&&Notification.permission==="granted"){reply({sg:"push-sub",sub:s.toJSON()});return}}catch(e){}
if(Notification.permission==="denied")return;try{if(localStorage.getItem("pushLater")&&Date.now()-Number(localStorage.getItem("pushLater"))<7*864e5&&!ask.force)return}catch(e){}
show("🔔 カレンダーに予定が入ったときと、毎朝の今日の予定を、このスマホにお知らせします。",[["受け取る",sub,"go"],["あとで",function(){try{localStorage.setItem("pushLater",String(Date.now()))}catch(e){}hide()}]])}
async function off(){try{var reg=await navigator.serviceWorker.getRegistration("/");var s=reg&&await reg.pushManager.getSubscription();if(s){var ep=s.endpoint;await s.unsubscribe();reply({sg:"push-unsub",endpoint:ep})}}catch(e){}}
window.addEventListener("message",function(e){var d=e.data;if(!d||typeof d!=="object"||!/^https:\\/\\/([a-z0-9-]+\\.)*(google\\.com|googleusercontent\\.com)$/.test(e.origin))return;app=e.source;
if(d.sg==="push-ask"&&typeof d.key==="string"&&d.key.length>60){ask=d;check()}else if(d.sg==="push-off")off()});})();`;

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
<style>html,body{margin:0;height:100%;background:#fff}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}
#pushbar{position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:9;background:#fff;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:12px;font:15px/1.5 -apple-system,"Hiragino Sans",sans-serif;color:#1f2937}
#pushbar p{margin:0 0 8px}#pushbar button{font:inherit;padding:8px 14px;margin-right:8px;border-radius:10px;border:1px solid #cbd5e1;background:#f1f5f9}#pushbar button.go{background:#2563eb;color:#fff;border-color:#2563eb;font-weight:700}</style>
</head><body>
<iframe src="${esc(src)}" title="${esc(title)}" allow="clipboard-read; clipboard-write; fullscreen" referrerpolicy="no-referrer"></iframe>
<script src="/entry.js"></script>
</body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const appUrl = String((env && env.GAS_URL) || APP_URL).replace(/[?#].*$/, "").replace(/\/+$/, "");
    // 通知を送る（Google 側から呼ぶ）。鍵は Google 側が持ち、毎回渡す。送り先は通知のサービスだけ・1回12件まで（無料の範囲の計算時間に収める）
    if (request.method === "POST" && url.pathname === "/push/send") {
      let body; try { body = await request.json(); } catch (e) { return new Response("bad json", { status: 400 }); }
      if (!body || !body.vapid || !body.vapid.privateJwk || !body.vapid.publicKey || !/^(mailto:|https:)/.test(String(body.subject || ""))) return new Response("bad request", { status: 400 });
      return new Response(JSON.stringify({ results: await sendPushes(body) }), { headers: { "content-type": "application/json" } });
    }
    if (request.method === "POST" && url.pathname === "/push/newkeys") return new Response(JSON.stringify(await newVapidKeys()), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET" } });
    if (url.pathname === "/sw.js") return new Response(SW_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" } });
    if (url.pathname === "/entry.js") return new Response(ENTRY_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
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
      "content-security-policy": "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; manifest-src 'self'; frame-src https://script.google.com https://*.googleusercontent.com; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
    } });
  },
};
