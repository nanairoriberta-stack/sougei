// 入口のページ（Cloudflare）のテスト（2026-11-16 依頼者「アイコンを画像に・Googleの帯を消す」）
import assert from "node:assert";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "entry-")), f = join(dir, "entry.mjs");
copyFileSync(new URL("../gas/out/entry_cloudflare.js", import.meta.url), f);
const W = (await import(f)).default;
const go = (path, init, env) => W.fetch(new Request("https://nanairo.example.workers.dev" + path, init), env || {});
const APP = "https://script.google.com/macros/s/AKfycbypH2gzteNmQPeK4iXtmNwJdn4psIH1ljacT6Y-yW2itASvamMyWHx5gNnpLgRKNoyPvg/exec";
let r = await go("/"), h = await r.text();
assert.strictEqual(r.status, 200);
assert.ok(h.includes('<link rel="apple-touch-icon" href="/icon-180.png">'), "iPhoneのアイコン");
const src = /<iframe src="([^"]+)"/.exec(h)[1].replace(/&amp;/g, "&");
assert.strictEqual(src, APP + "?page=calendar&wrap=" + encodeURIComponent("https://nanairo.example.workers.dev"), "アプリをはめこむ");
assert.ok(h.includes("<title>なないろカレンダー</title>"));
assert.strictEqual(r.headers.get("x-frame-options"), "DENY"); assert.strictEqual(r.headers.get("referrer-policy"), "no-referrer");
assert.ok(/frame-src https:\/\/script\.google\.com/.test(r.headers.get("content-security-policy")));
const key = "a".repeat(64);
h = await (await go(`/?page=sougei&e=v2&d=2026-11-20&k=${key}&evil=%3Cscript%3E`)).text();
const s2 = /<iframe src="([^"]+)"/.exec(h)[1].replace(/&amp;/g, "&");
assert.ok(s2.includes("page=sougei") && s2.includes("e=v2") && s2.includes("d=2026-11-20") && s2.includes("k=" + key) && !s2.includes("evil"), "決まった値だけ渡す " + s2);
assert.ok(h.includes("なないろ送迎表（新体制版）"));
h = await (await go("/?page=%3Cscript%3Ealert(1)%3C/script%3E&k=zz")).text();
assert.ok((h.match(/<script/gi) || []).length === 1 && h.includes('<script src="/entry.js"></script>') && !h.includes("alert(1)") && /page=calendar/.test(h) && !/k=zz/.test(h), "おかしな値は捨てる（入口自身のプログラム1つだけ）");
r = await go("/icon-180.png"); const b = new Uint8Array(await r.arrayBuffer());
assert.strictEqual(r.headers.get("content-type"), "image/png"); assert.deepStrictEqual([...b.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNGの画像");
assert.strictEqual((await go("/manifest.webmanifest")).status, 200);
assert.strictEqual((await go("/", { method: "POST" })).status, 405);
assert.strictEqual((await go("/other")).status, 404);
assert.strictEqual((await go("/", {}, { GAS_URL: "https://evil.example.com/" })).status, 500, "Googleのアドレス以外ははめこまない");
// ===== スマホの通知（Web Push） =====
const M = await import(f);
// RFC 8291 付録A の例と同じ結果になる（通知の暗号化が標準どおり）
const vec = await M.encryptPayload("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg", "When I grow up, I want to be a watermelon",
  { salt: "DGv6ra1nlYgDCS1FRnbzlw", asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8" });
assert.strictEqual(M.b64u(vec), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN", "RFC 8291 の例");
// 鍵を作る → 送り主の証明（VAPID）が公開鍵で確かめられる
const keys = await (await go("/push/newkeys", { method: "POST" })).json();
assert.ok(keys.publicKey.length > 80 && keys.privateJwk.d, "鍵");
const hdr = await M.vapidHeader("https://web.push.apple.com/abc", keys, "https://nanairo.example.workers.dev", 1700000000);
const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(hdr); const [h64, c64, s64] = jwt.split(".");
assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(M.unb64u(c64))), { aud: "https://web.push.apple.com", exp: 1700000000 + 43200, sub: "https://nanairo.example.workers.dev" });
const pub = await crypto.subtle.importKey("raw", M.unb64u(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, M.unb64u(s64), new TextEncoder().encode(h64 + "." + c64)), "署名が公開鍵で確かめられる");
// 端末の鍵を作って送る → 受け取った中身を端末の鍵で開ける
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)), authS = crypto.getRandomValues(new Uint8Array(16));
const sent = [];
const res = await M.sendPushes({ vapid: keys, subject: "https://nanairo.example.workers.dev", payload: { title: "📅 新しい予定", body: "11/20(木) 白戸 休み", url: "/?d=2026-11-20", tag: "ev_1" },
  items: [{ endpoint: "https://web.push.apple.com/QWERTY", keys: { p256dh: M.b64u(uaRaw), auth: M.b64u(authS) } }, { endpoint: "https://evil.example.com/x", keys: { p256dh: "a", auth: "b" } }] },
  async (u, init) => { sent.push({ u, init }); return { status: 201 }; });
assert.deepStrictEqual(res.map((r) => r.status), [201, 400], "通知のサービス以外へは送らない");
assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].init.headers["content-encoding"], "aes128gcm"); assert.ok(/^vapid t=/.test(sent[0].init.headers.authorization));
{ // 端末の側で開ける（RFC 8291 の受け取り側の計算）
  const body = sent[0].init.body, salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const hm = async (key, data) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), data));
  const hk = async (s, ikm, info, len) => (await hm(await hm(s, ikm), new Uint8Array([...info, 1]))).slice(0, len);
  const te = new TextEncoder();
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hk(authS, ecdh, new Uint8Array([...te.encode("WebPush: info\0"), ...uaRaw, ...asPub]), 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct));
  assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(pt.slice(0, -1))), { title: "📅 新しい予定", body: "11/20(木) 白戸 休み", url: "/?d=2026-11-20", tag: "ev_1" }, "端末で開ける");
}
assert.strictEqual((await go("/push/send", { method: "POST", body: "{}" })).status, 400, "鍵が無ければ送らない");
const sw = await go("/sw.js"); assert.ok((await sw.text()).includes("showNotification"), "通知を出すプログラム");
{ const st = await (await go("/sw.js")).text(); assert.ok(st.includes('"fetch"') && st.includes("/offline.html") && st.includes("caches.match"), "電波がないときは端末の画面"); }
{ const oh = await go("/offline.html"), ot = await oh.text(); assert.ok(oh.status === 200 && ot.includes('<script src="/offline.js"></script>') && (ot.match(/<script/gi) || []).length === 1 && /frame-ancestors 'none'/.test(oh.headers.get("content-security-policy")), "電波がないときの画面");
  const oj = await (await go("/offline.js")).text(); assert.ok(oj.includes("calSnap") && oj.includes("esc("), "最後に見た予定を出す（文字はエスケープ）"); }
const ej = await (await go("/entry.js")).text(); assert.ok(ej.includes("push-ask") && ej.includes("pushManager.subscribe"), "受け取る案内");
assert.ok(/script-src 'self'/.test((await go("/")).headers.get("content-security-policy")));
console.log("entry page OK（通知の暗号化は RFC 8291 の例と一致）");
