/* 送迎表 保存エンジン（Google版）
   サーバー（Apps Script）がロックの中で差分を統合するので、端末側は
   ・未送信を値ごと端末に保存して自動再送
   ・送信は時点のスナップショットで行い、成功した分だけ外す（送信中の新しい編集は新しい土台に載せ直して残す）
   ・読めなかったキーには書かない
   ・定期的に変更の有無を確認し、他の人の変更を画面に取り込む
   を受け持つ。画面からの使い方は claude.ai 版の保存エンジンと同じ。 */
(function (G) {
"use strict";
const SCHEMA = 1;
const SEND_DELAY = 800, PERSIST_DELAY = 400, CACHE_TTL = 3000;
const P = "sg:ob:";
const PERM = ["invalid_argument", "quota_exceeded", "too_large", "denied"];
const PAUSE = ["auth", "outdated_client"];
const { merge3, eq } = G.SGKV;
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

function createKVGas(o) {
  const call = o.call, store = o.store;
  const now = o.now || (() => Date.now());
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs || 20000;
  const S = { server: {}, failed: {}, entries: {}, watch: {}, cacheAt: {}, tokens: {}, running: false, paused: null, lastError: null, retryDelay: 0, timer: false, sendTimer: null, readOnly: false, notes: [] };
  const listeners = new Set(); const persistTimers = {}; let seqN = 0;
  const iso = () => new Date(now()).toISOString();
  const emit = (ev) => { for (const f of listeners) { try { f(ev || {}); } catch (e) {} } };

  for (const k of store.keys(P)) { try { const e = JSON.parse(store.get(k)); if (e && e.key != null) { if (e.state === "sending") e.state = "queued"; S.entries[e.key] = e; } } catch (e) {} }
  function persistNow(key) { clearTimeout(persistTimers[key]); delete persistTimers[key]; const e = S.entries[key]; if (!e) { store.del(P + key); return; } store.set(P + key, JSON.stringify(e)); }
  function persistSoon(key) { if (persistTimers[key]) return; persistTimers[key] = setTimeout(() => persistNow(key), PERSIST_DELAY); }
  function persistAll() { for (const k of Object.keys(persistTimers)) persistNow(k); }

  async function readDoc(key) { const r = await call("kv.get", key); return { rev: Number(r && r.rev) || 0, value: r ? r.value : null }; }

  async function get(key) {
    const e = S.entries[key];
    const fresh = S.server[key] && (S.watch[key] || now() - (S.cacheAt[key] || 0) < CACHE_TTL);
    if (!fresh) {
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        try { const r = await readDoc(key); S.server[key] = r; S.cacheAt[key] = now(); S.failed[key] = false; ok = true; }
        catch (err) { if (err && PAUSE.includes(err.code)) { S.paused = err.code; emit(); break; } if (i < 2) await sleep(700 * (i + 1)); }
      }
      if (!ok && !S.server[key]) { S.failed[key] = true; emit({ type: "loadFailed", key }); }
    }
    if (e) return clone(e.mine);
    return S.server[key] ? clone(S.server[key].value) : null;
  }
  const loadFailed = (key) => !!S.failed[key];

  function put(key, value, opt) {
    let e = S.entries[key];
    if (!e) {
      const sv = S.server[key]; const known = !!sv && !S.failed[key];
      e = S.entries[key] = { key, base: known ? clone(sv.value) : null, baseKnown: known, mine: null, state: "queued", seq: now() * 1000 + (seqN++ % 1000), at: iso() };
      if (S.failed[key]) { e.state = "blocked"; e.info = { code: "not_loaded" }; }
    }
    e.mine = clone(value); e.at = iso();
    if (opt && opt.replace) { e.replace = true; e.state = "queued"; delete e.info; }
    if (e.state === "queued" && e.baseKnown && !e.replace && eq(e.mine, e.base)) { delete S.entries[key]; persistNow(key); emit(); return; }
    if (JSON.stringify(e.mine).length < 120000) persistNow(key); else persistSoon(key);
    emit(); clearTimeout(S.sendTimer); S.sendTimer = setTimeout(() => process(), SEND_DELAY);
  }

  async function process() {
    if (S.running) return; S.running = true; emit();
    try {
      for (;;) {
        if (S.paused) break;
        const q = Object.values(S.entries).filter((x) => x.state === "queued").sort((a, b) => a.seq - b.seq);
        if (!q.length) { S.retryDelay = 0; S.lastError = null; break; }
        const e = q[0], sentMine = e.mine;
        let r;
        try { r = await call("kv.merge", { key: e.key, base: e.base, mine: sentMine, baseKnown: e.baseKnown, replace: !!e.replace }); }
        catch (err) {
          const c = (err && err.code) || "network";
          if (c === "invalid_argument" || c === "denied") S.readOnly = true;
          if (PAUSE.includes(c)) { S.paused = c; emit({ type: "paused", code: c }); break; }
          if (PERM.includes(c)) { e.state = "failed"; e.info = { code: c, message: err.message || "" }; persistNow(e.key); emit(); continue; }
          S.lastError = c; S.retryDelay = Math.min(S.retryDelay ? S.retryDelay * 2 : 3000, 60000); emit();
          if (!S.timer) { S.timer = true; sleep(S.retryDelay).then(() => { S.timer = false; process(); }); }
          break;
        }
        S.server[e.key] = { rev: r.rev, value: clone(r.value) }; S.cacheAt[e.key] = now(); S.failed[e.key] = false; S.tokens[e.key] = null;
        const cur = S.entries[e.key];
        let local = r.value, changed = false;
        if (cur === e && cur.mine === sentMine) { delete S.entries[e.key]; persistNow(e.key); changed = !eq(r.value, sentMine); }
        else if (cur) { const rb = merge3(sentMine, cur.mine, r.value).value; changed = !eq(rb, cur.mine); cur.base = clone(r.value); cur.baseKnown = true; delete cur.replace; cur.mine = rb; local = rb; persistNow(e.key); }
        if (r.conflicts) S.notes.push({ key: e.key, count: r.conflicts, at: iso() });
        if (changed) deliver(e.key, local, { merged: true, conflicts: r.conflicts || 0 });
        else if (r.conflicts) emit({ type: "conflict", key: e.key, count: r.conflicts });
        S.lastError = null; S.retryDelay = 0; emit();
      }
    } finally { S.running = false; emit(); }
  }

  function deliver(key, value, info) { const w = S.watch[key]; if (w) for (const cb of w) { try { cb(clone(value), info || {}); } catch (e) {} } emit(Object.assign({ type: "remote", key }, info || {})); }
  async function onRemote(key) {
    let r; try { r = await readDoc(key); } catch (err) { return; }
    const known = S.server[key];
    if (known && r.rev <= known.rev) return;
    S.server[key] = r; S.cacheAt[key] = now(); S.failed[key] = false;
    const e = S.entries[key];
    if (!e) { deliver(key, r.value, { remote: true }); return; }
    if (e.state === "blocked") { emit(); return; }
    const rb = merge3(e.baseKnown ? e.base : null, e.mine, r.value);
    e.base = clone(r.value); e.baseKnown = true; e.mine = rb.value; persistNow(key);
    deliver(key, rb.value, { remote: true, merged: true, conflicts: rb.conflicts.length });
  }
  function watch(key, cb) { (S.watch[key] || (S.watch[key] = new Set())).add(cb); return () => { const w = S.watch[key]; if (w) { w.delete(cb); if (!w.size) delete S.watch[key]; } }; }
  /* 変更の確認：見ているキーの版だけを問い合わせ、変わったものだけ読み直す */
  let pollBusy = false;
  async function poll(extra) {
    if (pollBusy || S.paused) return null; pollBusy = true;
    try {
      const keys = Object.keys(S.watch);
      const r = await call("sync.poll", Object.assign({ keys }, extra || {}));
      for (const k of keys) { const t = r.keys && r.keys[k]; if (t == null) continue; if (S.tokens[k] !== t) await onRemote(k); S.tokens[k] = t; }
      if (r && r.props != null && typeof window !== "undefined" && window.__sgPropsRev !== r.props) { window.__sgPropsRev = r.props; try { window.dispatchEvent(new Event("sg-props")); } catch (e) {} }
      return r;
    } catch (e) { if (e && PAUSE.includes(e.code)) { S.paused = e.code; emit({ type: "paused", code: e.code }); } return null; }
    finally { pollBusy = false; }
  }
  async function update(key, fn) {
    for (let i = 0; i < 6; i++) {
      const cur = await readDoc(key);
      const next = fn(clone(cur.value));
      if (next === undefined || eq(next, cur.value)) { S.server[key] = cur; S.cacheAt[key] = now(); return clone(cur.value); }
      let r;
      try { r = await call("kv.cas", { key, rev: cur.rev, value: next }); }
      catch (err) { if (err && (err.code === "invalid_argument" || err.code === "denied")) { S.readOnly = true; S.server[key] = cur; S.cacheAt[key] = now(); return clone(cur.value); } throw err; }
      if (!r.conflict) { S.server[key] = { rev: r.rev, value: clone(next) }; S.cacheAt[key] = now(); return clone(next); }
      await sleep(300 + Math.random() * 500);
    }
    throw { code: "busy" };
  }

  const api = {
    SCHEMA, merge3, eq,
    get, put, watch, poll, update, loadFailed,
    getMany: (keys) => call("kv.getMany", keys),
    importMany: (items) => call("kv.importMany", items),
    list: async (prefix) => { const keys = new Set(await call("kv.list", String(prefix || ""))); for (const k of Object.keys(S.entries)) if (k.startsWith(prefix || "")) keys.add(k); return [...keys]; },
    replace: (key, value) => put(key, value, { replace: true }),
    flushLocal: () => { persistAll(); process(); },
    kick: () => process(),
    resume: () => { S.paused = null; S.retryDelay = 0; process(); },
    on: (f) => { listeners.add(f); return () => listeners.delete(f); },
    entries: () => Object.values(S.entries).map((e) => ({ key: e.key, state: e.state, info: e.info || null, at: e.at })),
    discard: (key) => { delete S.entries[key]; persistNow(key); emit(); },
    force: (key) => { const e = S.entries[key]; if (!e) return; e.replace = true; e.state = "queued"; delete e.info; persistNow(key); emit(); process(); },
    unite: (key) => { const e = S.entries[key]; if (!e) return; e.baseKnown = false; e.base = null; e.state = "queued"; delete e.info; persistNow(key); emit(); process(); },
    retry: (key) => { const e = S.entries[key]; if (!e) return; e.state = "queued"; delete e.info; persistNow(key); S.paused = null; emit(); process(); },
    takeNotes: () => S.notes.splice(0),
    waitIdle: async (ms) => { const t0 = now(); persistAll(); process(); while (now() - t0 < (ms || 60000)) { const st = api.status(); if (!st.queued && !st.running) return true; if (st.paused) return false; await sleep(300); } return false; },
    status() {
      const es = Object.values(S.entries);
      return { queued: es.filter((e) => e.state === "queued").length, blocked: es.filter((e) => e.state === "blocked").length, failed: es.filter((e) => e.state === "failed").length,
        running: S.running, paused: S.paused, lastError: S.lastError, retryDelay: S.retryDelay, persistent: store.persistent, readOnly: S.readOnly, loadFailedKeys: Object.keys(S.failed).filter((k) => S.failed[k]) };
    },
  };
  if (Object.keys(S.entries).length) setTimeout(() => process(), 0);
  return api;
}
const API = { createKVGas };
if (typeof module !== "undefined" && module.exports) module.exports = API; else G.SGKVGas = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
