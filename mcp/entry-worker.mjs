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
// 電波がないとき（2026-11-17 依頼者「オフラインでも最終みたカレンダーみれるように」）：入口のページを開けなければ、端末に置いた「最後に見た予定」の画面（/offline.html）を出す
const SW_JS = `const CN="nanairo-off-1",PRE=["/offline.html","/offline.js","/icon-192.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CN).then(c=>c.addAll(PRE)).catch(()=>{}));self.skipWaiting()});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CN).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);if(u.origin!==self.location.origin||u.pathname.startsWith("/push/"))return;
if(r.mode==="navigate"){e.respondWith(Promise.race([fetch(r),new Promise((_,no)=>setTimeout(()=>no(new Error("slow")),12000))]).catch(()=>caches.match("/offline.html").then(x=>x||new Response("電波がありません",{headers:{"content-type":"text/plain; charset=utf-8"}}))));return}
if(PRE.includes(u.pathname))e.respondWith(fetch(r).then(x=>{if(x.ok){const y=x.clone();caches.open(CN).then(c=>c.put(r,y))}return x}).catch(()=>caches.match(r)))});
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={title:"なないろ",body:e.data?e.data.text():""}}
e.waitUntil(self.registration.showNotification(d.title||"なないろ",{body:d.body||"",tag:d.tag||undefined,icon:"/icon-192.png",badge:"/icon-192.png",data:{url:d.url||"/"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();const u=new URL((e.notification.data&&e.notification.data.url)||"/",self.location.origin).href;
e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l){if("navigate"in c){c.focus();return c.navigate(u)}}return self.clients.openWindow(u)}))});`;
// 入口のページの中の小さなプログラム：アプリ（中のGoogleの画面）から「通知を受け取りますか」と頼まれたら、下に案内を出し、押されたら通知を登録してアプリに返す
// ログインを入口のページ（端末に残る）にも覚えておき、中のGoogleの画面の保存が消えても渡す（2026-11-22 依頼者「ログイン維持したままにならない」。
// iPhoneのホーム画面のアイコンから開くと、中のGoogleの画面（別のアドレス）の端末の保存は開くたびに消えることがある）。入口の中の画面にだけ渡す（mine）
const ENTRY_JS = `(function(){var bar=null,ask=null,app=null,TOK=/^[0-9a-f-]{40,90}$/;
function mine(w){var f=document.querySelector("iframe");if(!f||!w)return false;var ok=false;(function walk(x,d){if(ok||!x||d>6)return;if(x===w){ok=true;return}var n=0;try{n=x.length}catch(e){}for(var i=0;i<n;i++){try{walk(x[i],d+1)}catch(e){}}})(f.contentWindow,0);return ok}
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
function snap(d){try{if(!Array.isArray(d.ev)||d.ev.length>3000)return;var t=JSON.stringify({v:1,at:Number(d.at)||Date.now(),who:String(d.who||"").slice(0,40),from:String(d.from||""),to:String(d.to||""),ev:d.ev});if(t.length<3000000)localStorage.setItem("calSnap",t)}catch(e){}}
function chip(){if(navigator.onLine!==false||document.getElementById("offchip"))return;var a=document.createElement("a");a.id="offchip";a.href="/offline.html";a.textContent="📵 電波がありません：最後に見た予定を見る";document.body.appendChild(a)}
window.addEventListener("offline",chip);window.addEventListener("online",function(){var c=document.getElementById("offchip");if(c)c.remove()});setTimeout(chip,3000);
try{if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){})}catch(e){}
window.addEventListener("message",function(e){var d=e.data;if(!d||typeof d!=="object"||!/^https:\\/\\/([a-z0-9-]+\\.)*(google\\.com|googleusercontent\\.com)$/.test(e.origin))return;app=e.source;
if(d.sg==="push-ask"&&typeof d.key==="string"&&d.key.length>60){ask=d;check()}else if(d.sg==="push-off")off();else if(d.sg==="cal-saved"){if(window.parent!==window)try{window.parent.postMessage({sg:"cal-saved"},"*")}catch(x){}}else if(d.sg==="cal-snap")snap(d);else if(d.sg==="cal-snap-clear"){try{localStorage.removeItem("calSnap")}catch(x){}}
else if(d.sg==="keep-token"&&TOK.test(d.t||"")&&mine(e.source)){try{localStorage.setItem("sgTok",d.t)}catch(x){}}
else if(d.sg==="keep-token-clear"&&mine(e.source)){try{localStorage.removeItem("sgTok")}catch(x){}}
else if(d.sg==="keep-ops"&&mine(e.source)&&Array.isArray(d.ops)){try{var s=JSON.stringify(d.ops);if(s.length<1500000){if(d.ops.length)localStorage.setItem("sgOps",s);else localStorage.removeItem("sgOps")}}catch(x){}}
else if(d.sg==="need-ops"&&mine(e.source)){var o=[];try{o=JSON.parse(localStorage.getItem("sgOps")||"[]")}catch(x){}try{e.source.postMessage({sg:"ops",ops:Array.isArray(o)?o:[]},e.origin)}catch(x){}}
else if(d.sg==="need-token"&&mine(e.source)){var t="";try{t=localStorage.getItem("sgTok")||""}catch(x){}try{e.source.postMessage({sg:"token",t:TOK.test(t)?t:""},e.origin)}catch(x){}}});})();`;

// 電波がないときの画面（最後に見た予定・見るだけ）
const OFFLINE_HTML = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>なないろカレンダー（電波なし）</title>
<link rel="icon" type="image/png" href="/icon-192.png"><style>
body{margin:0;background:#f8fafc;color:#1f2937;font:15px/1.5 -apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e2e8f0;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;z-index:2}
header h1{font-size:17px;margin:0}header p{margin:2px 0 8px;color:#64748b;font-size:13px}header button{font:inherit;padding:7px 14px;border-radius:10px;border:1px solid #2563eb;background:#2563eb;color:#fff;font-weight:700}
main{padding:8px 12px calc(24px + env(safe-area-inset-bottom));max-width:720px;margin:0 auto}
.day{margin:14px 0 4px;font-weight:700;color:#334155}.day.today{color:#dc2626}.day.sun{color:#dc2626}.day.sat{color:#2563eb}
.ev{display:flex;gap:10px;background:#fff;border:1px solid #e2e8f0;border-left:4px solid #94a3b8;border-radius:8px;padding:7px 10px;margin:4px 0}
.ev.g-staff{background:#eff6ff;border-left-color:#3b82f6}.ev.g-user{background:#fff7ed;border-left-color:#f97316}.ev.g-other{background:#f8fafc}
.tm{min-width:62px;color:#475569;font-size:13px}.tt{font-weight:600}.sub{color:#64748b;font-size:12px}.none{color:#64748b;padding:24px 4px}
.tag{font-size:11px;background:#fce7f3;color:#9d174d;border-radius:6px;padding:0 5px;margin-left:4px}</style></head>
<body><header><h1>📵 電波がありません</h1><p id="info">最後に見た予定を出しています（見るだけ）。</p><button id="retry">もう一度つなぐ</button></header><main id="list"></main><script src="/offline.js"></script></body></html>`;
const OFFLINE_JS = `(function(){var WD="日月火水木金土";function p2(n){return(n<10?"0":"")+n}function ymd(d){return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate())}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
document.getElementById("retry").onclick=function(){location.href="/"};
var s=null;try{s=JSON.parse(localStorage.getItem("calSnap")||"null")}catch(e){}var L=document.getElementById("list"),I=document.getElementById("info");
if(!s||!Array.isArray(s.ev)){I.textContent="この端末には、まだ予定が残っていません。電波のあるところで一度カレンダーを開くと、次から電波がなくても見られます。";return}
var at=new Date(s.at);I.textContent=(at.getMonth()+1)+"/"+at.getDate()+" "+p2(at.getHours())+":"+p2(at.getMinutes())+" に見た予定です（見るだけ。新しい予定・変更は電波が戻ってから）。";
var by={},today=ymd(new Date());s.ev.forEach(function(e){if(!e||!e.d)return;var d=new Date(e.d+"T00:00:00"),end=e.e&&e.e>=e.d?e.e:e.d,n=0;while(ymd(d)<=end&&n<62){var k=ymd(d);if(k>=s.from&&k<=s.to)(by[k]=by[k]||[]).push(e);d.setDate(d.getDate()+1);n++}});
var days=Object.keys(by).sort();if(!days.length){L.innerHTML='<p class="none">予定はありません。</p>';return}var h="",first=null;
days.forEach(function(k){var d=new Date(k+"T00:00:00"),w=d.getDay(),cls="day"+(k===today?" today":w===0?" sun":w===6?" sat":"");if(!first&&k>=today)first=k;
h+='<div class="'+cls+'" id="d'+k+'">'+(d.getMonth()+1)+"月"+d.getDate()+"日("+WD[w]+")"+(k===today?"　今日":"")+"</div>";
by[k].sort(function(a,b){return(a.a?0:1)-(b.a?0:1)||String(a.s).localeCompare(String(b.s))}).forEach(function(e){var tm=e.a?"終日":(e.d===k?e.s:"")+"〜"+(e.e===k?e.n:"");
h+='<div class="ev g-'+esc(e.g)+'"><div class="tm">'+esc(tm)+'</div><div><div class="tt">'+esc(e.t)+(e.b===2?'<span class="tag">マンション</span>':e.b?'<span class="tag">放デイ</span>':"")+'</div><div class="sub">'+esc(e.l)+(e.p?"・"+esc(e.p):"")+"</div></div></div>"})});
L.innerHTML=h;var f=document.getElementById("d"+(first||days[days.length-1]));if(f)setTimeout(function(){f.scrollIntoView({block:"start"});window.scrollBy(0,-90)},30)})();`;

// アプリに渡してよい値だけを通す（ほかの値は捨てる）
const PASS = { page: /^(calendar|sougei|shift)$/, e: /^v[123]$/, d: /^\d{4}-\d{2}-\d{2}$/, k: /^[0-9a-f]{40,80}$/, embed: /^1$/ };   // embed=1＝送迎表の右に出すカレンダー
// ホーム画面に追加したアイコンから開くアドレス（manifest の start_url）。画面・版・ログインしたままの鍵（k）を残す（日付・embed は残さない）。
// 2026-11-21 依頼者「ログイン維持する画面がやはり毎回ログインを求められる」：以前は start_url が "/" で、ホーム画面のアイコンから開くと鍵が落ちていた
function startQuery(u) {
  const q = new URLSearchParams();
  for (const name of ["page", "e", "k"]) { const v = u.searchParams.get(name); if (v && PASS[name].test(v)) q.set(name, v); }
  return q.toString();
}

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
<link rel="manifest" href="/manifest.webmanifest${startQuery(u) ? "?" + esc(startQuery(u)) : ""}">
<style>html,body{margin:0;height:100%;background:#fff}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}
#pushbar{position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:9;background:#fff;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:12px;font:15px/1.5 -apple-system,"Hiragino Sans",sans-serif;color:#1f2937}
#offchip{position:fixed;left:50%;transform:translateX(-50%);top:calc(6px + env(safe-area-inset-top));z-index:9;background:#1f2937;color:#fff;border-radius:999px;padding:7px 14px;font:14px -apple-system,"Hiragino Sans",sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.25)}
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
    if (url.pathname === "/offline.html") return new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; script-src 'self'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" } });
    if (url.pathname === "/offline.js") return new Response(OFFLINE_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === "/entry.js") return new Response(ENTRY_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === "/icon-180.png" || url.pathname === "/apple-touch-icon.png" || url.pathname === "/apple-touch-icon-precomposed.png")
      return new Response(b64bytes(ICON180), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    if (url.pathname === "/icon-192.png" || url.pathname === "/favicon.ico")
      return new Response(b64bytes(ICON192), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    if (url.pathname === "/manifest.webmanifest")
      return new Response(JSON.stringify({ name: "なないろ", short_name: "なないろ", start_url: "/" + (startQuery(url) ? "?" + startQuery(url) : ""), scope: "/", display: "standalone", background_color: "#ffffff", theme_color: "#ffffff",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-180.png", sizes: "180x180", type: "image/png" }] }),
        { headers: { "content-type": "application/manifest+json", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    if (!EXEC_RE.test(appUrl)) return new Response("APP_URL（Googleのウェブアプリのアドレス …/exec）が入っていません", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    // 送迎表の右に出すカレンダー（embed=1）だけは、なないろの送迎表（Googleの画面）の中にはめこめる。ほかはどこにもはめこませない
    const embed = url.searchParams.get("embed") === "1";
    const h = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",                       // 「ログインしたまま」の鍵がほかへ漏れないように
      "content-security-policy": "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; manifest-src 'self'; frame-src https://script.google.com https://*.googleusercontent.com; frame-ancestors "
        + (embed ? "'self' https://script.google.com https://*.googleusercontent.com" : "'none'") + "; base-uri 'none'",
      "x-content-type-options": "nosniff",
    };
    if (!embed) h["x-frame-options"] = "DENY";                // この入口のページを、ほかのサイトの中にはめこませない
    return new Response(entryPage(request.url, appUrl), { headers: h });
  },
};
