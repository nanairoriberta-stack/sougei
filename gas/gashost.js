/* Google版の土台：ログイン（職員番号＋暗証番号）、サーバー呼び出し、変更の確認、画面部品の橋渡し */
(function (G) {
"use strict";
const ED = G.__SG_EDITION || "v1", BASE = G.__SG_BASE || "";
let ls = null; try { ls = G.localStorage; } catch (e) {}
const store = G.TCCore.makeStore(ls || { getItem() { throw 0; }, setItem() { throw 0; }, removeItem() {}, key() { return null; }, length: 0 });
const TK = "sg:token", MK = "sg:me", DK = "sg:dir";
let token = store.get(TK) || "";
let me = null; try { me = JSON.parse(store.get(MK) || "null"); } catch (e) {}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- サーバー呼び出し（30秒で打ち切り） ---------- */
function rawCall(method, args) {
  return new Promise((res, rej) => {
    const run = G.google && G.google.script && G.google.script.run;
    if (!run) { rej({ code: "unavailable", message: "サーバーに接続できません" }); return; }
    run.withSuccessHandler((r) => { if (!r) return rej({ code: "unavailable" }); if (r.ok) res(r.data); else rej({ code: r.code, message: r.message }); })
       .withFailureHandler((e) => rej({ code: "unavailable", message: String((e && e.message) || e) }))
       .api(token, method, args);
  });
}
const listeners = new Set();
async function call(method, ...args) {
  try {
    const limit = method === "ai.messages" ? 180000 : 45000;   // AIは返事に時間がかかる
    return await Promise.race([rawCall(method, args), new Promise((_, rej) => setTimeout(() => rej({ code: "timeout", message: method === "ai.messages" ? "AIの返事が時間内に届きませんでした。もう一度送ってください" : "" }), limit))]);
  } catch (e) {
    if (e && e.code === "auth" && method !== "auth.login") { needLogin("ログインの有効期限が切れました。もう一度ログインしてください"); }
    throw e;
  }
}

/* ---------- ログイン画面 ---------- */
const css = `
.sgh-ov{position:fixed;inset:0;z-index:5000;background:#eef3f1;display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,sans-serif;color:#18201d}
.sgh-card{background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.12);width:min(380px,100%);padding:24px;display:flex;flex-direction:column;gap:14px}
.sgh-card h1{margin:0;font-size:20px} .sgh-card p{margin:0;font-size:13px;color:#5f6b66;line-height:1.6}
.sgh-card label{font-size:12px;color:#5f6b66;display:flex;flex-direction:column;gap:6px}
.sgh-card input{height:48px;border:1px solid #cfd8d4;border-radius:10px;padding:0 14px;font-size:22px;letter-spacing:.2em;font-family:ui-monospace,Menlo,monospace}
.sgh-card button.go{height:48px;border:0;border-radius:10px;background:#13795b;color:#fff;font-size:16px;font-weight:700}
.sgh-card button.go:disabled{opacity:.5}
.sgh-err{color:#c23a32;font-size:13px;min-height:1em}
.sgh-chip{position:fixed;right:max(10px,env(safe-area-inset-right,0px));bottom:max(10px,env(safe-area-inset-bottom,0px));z-index:4000;background:#18201d;color:#fff;border:0;border-radius:999px;padding:7px 14px;font:12px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.2)}
.sgh-chip{transition:opacity .2s} body:has(.fixed.inset-0) .sgh-chip{display:none}
.sgh-menu{position:fixed;right:max(10px,env(safe-area-inset-right,0px));bottom:calc(50px + env(safe-area-inset-bottom,0px));z-index:4001;background:#fff;color:#18201d;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:6px;display:flex;flex-direction:column;min-width:220px;font:14px system-ui,sans-serif}
.sgh-menu button,.sgh-menu a{border:0;background:none;text-align:left;padding:10px 12px;border-radius:8px;color:inherit;text-decoration:none;font:inherit;cursor:pointer}
.sgh-menu button:hover,.sgh-menu a:hover{background:#eef3f1}
.sgh-menu small{display:block;padding:8px 12px 4px;color:#5f6b66}
.sgh-log{max-height:70vh;overflow:auto;font-size:12px}
.sgh-log table{border-collapse:collapse;width:100%} .sgh-log td{border-bottom:1px solid #e5ebe8;padding:6px;vertical-align:top}
`;
const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
let readyResolve; const ready = new Promise((r) => (readyResolve = r));
let ov = null;
function showOverlay(html) { if (!ov) { ov = document.createElement("div"); ov.className = "sgh-ov"; document.body.appendChild(ov); } ov.innerHTML = html; ov.hidden = false; }
function hideOverlay() { if (ov) ov.remove(); ov = null; }
function needLogin(msg) {
  showOverlay(`<form class="sgh-card" id="sghLogin" autocomplete="off">
    <h1>ログイン</h1><p>${esc(msg || "職員番号と暗証番号を入力してください。番号が分からない場合は管理者に確認してください。")}</p>
    <label>職員番号<input id="sghNo" inputmode="numeric" maxlength="3" placeholder="001" autocomplete="username"></label>
    <label>暗証番号（4桁）<input id="sghPin" type="password" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="current-password"></label>
    <div class="sgh-err" id="sghErr"></div><button class="go" id="sghGo">ログイン</button></form>`);
  const f = document.getElementById("sghLogin");
  setTimeout(() => document.getElementById("sghNo").focus(), 50);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = document.getElementById("sghGo"); b.disabled = true; document.getElementById("sghErr").textContent = "";
    try {
      const r = await rawCall("auth.login", [document.getElementById("sghNo").value, document.getElementById("sghPin").value, (navigator.userAgent || "").slice(0, 60)]);
      token = r.token; store.set(TK, token); setMe(r.me);
      if (r.me.mustChange) return askNewPin(true);
      done();
    } catch (err) { document.getElementById("sghErr").textContent = (err && err.message) || "ログインできませんでした。通信を確認してください"; b.disabled = false; }
  };
}
function askNewPin(first, oldPin) {
  showOverlay(`<form class="sgh-card" id="sghPinF" autocomplete="off">
    <h1>${first ? "暗証番号を決めてください" : "暗証番号の変更"}</h1>
    <p>${first ? "初期の暗証番号から、自分だけが知る4桁の番号に変えてください。" : ""}同じ数字の並びや1234は使えません。</p>
    <label>今の暗証番号<input id="sghOld" type="password" inputmode="numeric" maxlength="4"></label>
    <label>新しい暗証番号（4桁）<input id="sghNew" type="password" inputmode="numeric" maxlength="4"></label>
    <label>もう一度<input id="sghNew2" type="password" inputmode="numeric" maxlength="4"></label>
    <div class="sgh-err" id="sghErr"></div><button class="go">決定</button>${first ? "" : `<button type="button" id="sghCancel" style="border:0;background:none;color:#5f6b66">やめる</button>`}</form>`);
  const c = document.getElementById("sghCancel"); if (c) c.onclick = () => hideOverlay();
  document.getElementById("sghPinF").onsubmit = async (e) => {
    e.preventDefault();
    const n1 = document.getElementById("sghNew").value, n2 = document.getElementById("sghNew2").value;
    if (n1 !== n2) { document.getElementById("sghErr").textContent = "新しい暗証番号が一致しません"; return; }
    try { await call("auth.changePin", document.getElementById("sghOld").value, n1); setMe(Object.assign({}, me, { mustChange: false })); if (first) done(); else { hideOverlay(); toastHost("暗証番号を変更しました"); } }
    catch (err) { document.getElementById("sghErr").textContent = (err && err.message) || "変更できませんでした"; }
  };
}
function setMe(m) { me = m; store.set(MK, JSON.stringify(m)); renderChip(); }
function done() { hideOverlay(); renderChip(); readyResolve(me); for (const f of listeners) { try { f(me); } catch (e) {} } loadDirectory(); }
function logout() { const t = token; token = ""; store.del(TK); store.del(MK); me = null; rawCall("auth.logout", [t]).catch(() => {}); location.reload(); }

/* ---------- 右下の「ログイン中」 ---------- */
let chip = null, menu = null;
function url(q) { return BASE + q; }
function renderChip() {
  if (!me) { if (chip) chip.remove(); chip = null; return; }
  if (!chip) { chip = document.createElement("button"); chip.className = "sgh-chip"; chip.onclick = toggleMenu; document.body.appendChild(chip); }
  chip.textContent = `${me.no} ${me.name}`;
}
function toggleMenu() {
  if (menu) { menu.remove(); menu = null; return; }
  menu = document.createElement("div"); menu.className = "sgh-menu";
  const page = G.__SG_PAGE || "calendar";
  const links = [];
  if (page !== "calendar") links.push(`<a href="${esc(url("?page=calendar"))}" target="_top">📅 カレンダー</a>`);
  if (me.canSougei || me.admin) [["v1", "現体制版"], ["v2", "新体制版"], ["v3", "りんく・ぷれいす版"]].forEach(([e, l]) => { if (!(page === "sougei" && e === ED)) links.push(`<a href="${esc(url("?page=sougei&e=" + e))}" target="_top">🚌 送迎表（${l}）</a>`); });
  menu.innerHTML = `<small>${esc(me.no)} ${esc(me.name)}（${esc(me.role)}）</small>${links.join("")}${me.admin ? `<button data-a="log">📝 変更履歴</button>` : ""}<button data-a="pin">🔑 暗証番号を変更</button><button data-a="out">ログアウト</button><small>版 ${esc(me.version || "")}</small>`;
  menu.onclick = (e) => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    menu.remove(); menu = null;
    if (a.dataset.a === "out") logout(); else if (a.dataset.a === "pin") askNewPin(false); else if (a.dataset.a === "log") showLog();
  };
  document.body.appendChild(menu);
}
async function showLog() {
  showOverlay(`<div class="sgh-card" style="width:min(900px,100%)"><h1>変更履歴</h1><div class="sgh-log" id="sghLog">読み込み中…</div><button class="go" id="sghClose">閉じる</button></div>`);
  document.getElementById("sghClose").onclick = hideOverlay;
  try {
    const rows = await call("log.list", 300);
    document.getElementById("sghLog").innerHTML = `<table>${rows.map((r) => `<tr><td>${esc(new Date(r.at).toLocaleString("ja-JP"))}</td><td>${esc(r.no)} ${esc(r.name)}</td><td>${esc(r.kind)}</td><td>${esc(r.target)}</td><td>${esc(r.detail)}</td></tr>`).join("")}</table><p>全件はスプレッドシートの「変更履歴」シートで見られます。</p>`;
  } catch (e) { document.getElementById("sghLog").textContent = (e && e.message) || "読み込めませんでした"; }
}
let tt; function toastHost(m) { let t = document.getElementById("sghToast"); if (!t) { t = document.createElement("div"); t.id = "sghToast"; t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:70px;background:#18201d;color:#fff;padding:10px 16px;border-radius:8px;font:13px system-ui;z-index:6000"; document.body.appendChild(t); } t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 3000); }

/* ---------- 職員名簿（参加者の選択・名前の表示に使う） ---------- */
let directory = []; try { directory = JSON.parse(store.get(DK) || "[]"); } catch (e) {}
async function loadDirectory() { try { directory = await call("staff.list"); store.set(DK, JSON.stringify(directory)); } catch (e) {} }
function avatar(name, no) {
  const colors = ["#3f63cf", "#11897a", "#d0443a", "#b8901a", "#8352c9", "#c2410c", "#0e7490", "#4d7c0f"];
  let h = 0; for (const ch of String(no)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = colors[h % colors.length], ini = esc(String(name || "?").slice(0, 2));
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="${c}"/><text x="20" y="25" font-size="14" text-anchor="middle" fill="#fff" font-family="sans-serif">${ini}</text></svg>`);
}
const prof = (no) => { const d = directory.find((x) => x.no === no); const name = d ? d.name : ""; return { id: no, name, avatarUrl: avatar(name || no, no), color: "#555", email: null, isMe: !!(me && me.no === no), guest: false }; };
const userShim = {
  id: async () => (me ? me.no : null), me: async () => Object.assign(prof(me && me.no), { canEdit: !!(me && me.admin), isOwner: false }),
  isOwner: async () => false, canEdit: async () => !!(me && me.admin), can: async () => true,
  profiles: async (ids) => Object.fromEntries([].concat(ids || []).map((id) => [id, prof(id)])),
  search: async (q) => { const s = String(q || "").trim(); return directory.filter((d) => !s || d.name.includes(s) || d.no.includes(s)).slice(0, 8).map((d) => prof(d.no)); },
};

/* ---------- 変更の確認（見ている間だけ。スマホは60秒、送迎表は20秒ごと） ---------- */
let calTok = null; const calSubs = new Set();
async function pollOnce() {
  if (!me || document.visibilityState === "hidden") return;
  let r = null;
  try { r = G.__sgkv && G.__sgkv.poll ? await G.__sgkv.poll() : await call("sync.poll", { keys: [] }); } catch (e) {}
  if (!r) return;
  if (r.cal !== calTok) for (const f of calSubs) { try { f(); } catch (e) {} }   // 最初の確認でも読み直す
  calTok = r.cal;
}
function startPolling(ms) { setInterval(pollOnce, ms); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pollOnce(); }); G.addEventListener("focus", pollOnce); G.addEventListener("online", pollOnce); }

/* ---------- カレンダー用のデータ窓口（読み取りはサーバー、書込は操作単位でサーバーへ） ---------- */
function makeQuery(col, filters) {
  const range = () => { let from = "", to = ""; for (const [f, op, v] of filters) { if (op === ">=") from = from && from > v ? from : v; if (op === "<=") to = to < v ? to : v; } return { col, from, to }; };
  const local = (docs) => docs.filter((d) => filters.every(([f, op, v]) => op === ">=" ? d[f] >= v : op === "<=" ? d[f] <= v : op === "<" ? d[f] < v : op === "==" ? d[f] === v : true));
  const fetchDocs = async () => local(await call("docs.query", range())).map((d, i) => ({ id: String(i), exists: true, data: () => d, metadata: {} }));
  return {
    where: (f, op, v) => makeQuery(col, filters.concat([[f, op, v]])), orderBy() { return this; }, limit() { return this; },
    get: async () => { const docs = await fetchDocs(); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; },
    onSnapshot(next, error) {
      let alive = true;
      const run = async () => { try { const docs = await fetchDocs(); if (alive) next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }); } catch (e) { if (alive && e && e.code === "auth") return; } };
      run(); calSubs.add(run);
      return () => { alive = false; calSubs.delete(run); };
    },
  };
}
const dbShim = {
  collection: (c) => makeQuery(c, []),
  doc: (path) => ({
    get: async () => { const r = await call("docs.get", path); return { exists: r.exists, data: () => r.data, metadata: {} }; },
    onSnapshot(next) { let alive = true; const run = async () => { try { const r = await call("docs.get", path); if (alive) next({ exists: r.exists, data: () => r.data, metadata: {} }); } catch (e) {} }; run(); calSubs.add(run); return () => { alive = false; calSubs.delete(run); }; },
    collection: () => makeQuery("none", []),
  }),
};
const downloadsShim = {
  save: async ({ filename, data }) => {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000); return { status: "saved" };
  },
};
const sampleShim = Object.assign(async (input, opts) => {
  const msgs = typeof input === "string" ? [{ role: "user", content: input }] : input;
  return call("ai.messages", { messages: msgs, system: (opts && opts.system) || "", maxTokens: (opts && opts.maxTokens) || 4000 });
}, { limits: async () => ({ images: false }) });
G.claude = { use: async (n) => { await ready; return { db: dbShim, user: userShim, downloads: downloadsShim, sample: sampleShim }[n] || null; } };

G.SGHost = { ready, call, store, get me() { return me; }, edition: ED, base: BASE, url, onLogin: (f) => listeners.add(f), startPolling, pollOnce, refreshCalendar: () => Promise.all([...calSubs].map((f) => f())), runOp: async (op) => { const r = await call("cal.apply", op); if (r && r.status === "ok") { try { await Promise.all([...calSubs].map((f) => f())); } catch (e) {} } return r; }, toast: toastHost, directory: () => directory, loadDirectory };

/* ---------- 起動：保存済みのログインがあれば、通信できなくてもそのまま使える（未送信は端末に保存） ---------- */
function boot() {
  if (token && me && !me.mustChange) { done(); call("auth.me").then((m) => setMe(Object.assign({}, m))).catch(() => {}); }
  else if (token && me && me.mustChange) askNewPin(true);
  else needLogin();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(typeof globalThis !== "undefined" ? globalThis : this);
