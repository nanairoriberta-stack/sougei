// 共通部品（変更しないでください）。画面側と同じコードをサーバーでも使います
/* 送迎表 保存エンジン — 旧来の window.storage(キー=値) を、共有データベース上で安全に置き換える
   原則（手引き 5-1）:
   ・全体を書き戻さない：送信時にサーバーの最新を読み直し、「自分が読んだ版」との差分だけを統合（3方向マージ）
   ・読めなかったときは書かない：読込に失敗したキーへの保存は止めて確認に回す
   ・未送信は値ごと端末に保存し、起動時・復帰時に自動再送
   ・送信は時点のスナップショットで行い、成功した分だけ外す（送信中の新しい編集は残る）
   ・書込はキーごとの排他ロック（リース）の中で行い、書込後に読み直して反映を確認 */
(function (G) {
"use strict";
const SCHEMA = 1;
const LEASE_MS = 20000, RELEASE_MS = 1000, WRITE_DEADLINE = 5000;
const CALL_TIMEOUT = 10000, SET_TIMEOUT = 6000, LOCK_WAIT_MAX = 90000;
const INLINE_MAX = 200000, PART_SIZE = 180000, MAX_PARTS = 16;
const SEND_DELAY = 800, PERSIST_DELAY = 400, CACHE_TTL = 3000;
const P = "sg:ob:";
const PERM = ["invalid_argument", "quota_exceeded", "transform_error", "too_large"];
const PAUSE = ["revoked", "not_granted", "capability_disabled", "capability_removed", "outdated_client"];

/* ---------- 値の比較・複製 ---------- */
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b || (a == null && b == null && a === b);
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) { if (!Array.isArray(b) || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false; return true; }
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!eq(a[k], b[k])) return false;
    return true;
  }
  return false;
}
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/* ---------- 3方向マージ ---------- */
const idOf = (x) => (isObj(x) && (typeof x.id === "string" || typeof x.id === "number") ? String(x.id) : null);
function idArr(a) { if (!Array.isArray(a)) return false; const s = new Set(); for (const x of a) { const id = idOf(x); if (id == null || s.has(id)) return false; s.add(id); } return true; }
const primArr = (a) => Array.isArray(a) && a.every((x) => x === null || typeof x !== "object");
function mergeIdArr(b, m, t, ctx, path) {
  const bm = new Map(b.map((x) => [idOf(x), x])), mm = new Map(m.map((x) => [idOf(x), x])), tm = new Map(t.map((x) => [idOf(x), x]));
  const out = new Map();
  const ids = new Set([...mm.keys(), ...tm.keys()]);
  for (const id of ids) {
    const inB = bm.has(id), inM = mm.has(id), inT = tm.has(id);
    if (inM && inT) out.set(id, m3(inB ? bm.get(id) : undefined, mm.get(id), tm.get(id), ctx, path + "[" + id + "]"));
    else if (inM) { if (!inB) out.set(id, mm.get(id)); else if (!eq(mm.get(id), bm.get(id))) { ctx.conflicts.push(path + "[" + id + "]"); out.set(id, mm.get(id)); } }
    else if (inT) { if (!inB) out.set(id, tm.get(id)); else if (!eq(tm.get(id), bm.get(id))) { ctx.conflicts.push(path + "[" + id + "]"); out.set(id, tm.get(id)); } }
  }
  // 並び順：相手が並べ替えていなければ自分の順、そうでなければ相手の順を骨組みにする
  const order = (arr, keep) => arr.map(idOf).filter((id) => keep.has(id));
  const theirsKept = order(t, bm), baseKeptT = order(b, tm);
  const theirsReordered = theirsKept.join("\u0001") !== baseKeptT.join("\u0001");
  const primary = theirsReordered ? t : m, secondary = theirsReordered ? m : t;
  const res = primary.map(idOf).filter((id) => out.has(id));
  const placed = new Set(res);
  const sec = secondary.map(idOf);
  sec.forEach((id, i) => {
    if (!out.has(id) || placed.has(id)) return;
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) { const k = res.indexOf(sec[j]); if (k >= 0) { pos = k + 1; break; } }
    res.splice(pos, 0, id); placed.add(id);
  });
  for (const id of out.keys()) if (!placed.has(id)) res.push(id);
  return res.map((id) => out.get(id));
}
function mergeSet(b, m, t) {
  const cnt = (a) => { const c = new Map(); a.forEach((x) => { const k = JSON.stringify(x); c.set(k, (c.get(k) || 0) + 1); }); return c; };
  const cb = cnt(b), cm = cnt(m);
  const removed = new Map(), added = [];
  for (const [k, n] of cb) { const d = n - (cm.get(k) || 0); if (d > 0) removed.set(k, d); }
  const seenB = new Map(cb);
  m.forEach((x) => { const k = JSON.stringify(x); const left = seenB.get(k) || 0; if (left > 0) seenB.set(k, left - 1); else added.push(x); });
  const res = [];
  t.forEach((x) => { const k = JSON.stringify(x); const r = removed.get(k) || 0; if (r > 0) removed.set(k, r - 1); else res.push(x); });
  const ct = cnt(res);
  added.forEach((x) => { const k = JSON.stringify(x); const have = ct.get(k) || 0; if (have > 0) ct.set(k, have - 1); else res.push(x); });
  return res;
}
function m3(b, m, t, ctx, path) {
  if (eq(m, t)) return m;
  if (eq(m, b)) return t;
  if (eq(t, b)) return m;
  if (isObj(m) && isObj(t)) {
    const bb = isObj(b) ? b : {};
    const out = {};
    const keys = [...Object.keys(t), ...Object.keys(m).filter((k) => !(k in t))];
    for (const k of keys) { const r = m3(bb[k], m[k], t[k], ctx, path + "." + k); if (r !== undefined) out[k] = r; }
    return out;
  }
  if (Array.isArray(m) && Array.isArray(t)) {
    const bb = Array.isArray(b) ? b : [];
    if (idArr(m) && idArr(t) && idArr(bb)) return mergeIdArr(bb, m, t, ctx, path);
    if (primArr(m) && primArr(t) && primArr(bb)) return mergeSet(bb, m, t);
  }
  ctx.conflicts.push(path || "(全体)");
  if (m === undefined) return t;   // 片方が削除・片方が変更 → 変更を残す（消さない側に倒す）
  if (t === undefined) return m;
  return m;                         // 同じ箇所を別々に変更 → 後から保存した人（自分）を優先
}
function merge3(base, mine, theirs) { const ctx = { conflicts: [] }; const value = m3(base, mine, theirs, ctx, ""); return { value, conflicts: ctx.conflicts }; }

/* ---------- キー → 文書ID ---------- */
function encKey(k) {
  let s = "";
  for (const ch of String(k)) s += /[A-Za-z0-9_\-.:@+]/.test(ch) ? ch : "~" + ch.codePointAt(0).toString(16) + "~";
  if (s === "." || s === "..") s = "~2e~";
  return s;
}
function utf8len(str){let n=0;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);if(c<0x80)n+=1;else if(c<0x800)n+=2;else if(c>=0xd800&&c<0xdc00){n+=4;i++}else n+=3}return n}
const bytes = (str) => utf8len(str);
const uid = (rnd) => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < 16; i++) s += a[Math.floor(rnd() * a.length)]; return s; };

function createKV(o) {
  const db = o.db, store = o.store;
  const now = o.now || (() => Date.now());
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rnd = o.random || Math.random;
  const tab = o.tab || uid(rnd);
  const S = { server: {}, failed: {}, entries: {}, watch: {}, cacheAt: {}, running: false, paused: null, lastError: null, retryDelay: 0, timer: false, sendTimer: null, readOnly: false, notes: [] };
  const listeners = new Set();
  const persistTimers = {};
  let seqN = 0, writeN = 0;
  const T = (p, ms) => Promise.race([p, sleep(ms).then(() => { throw { code: "timeout" }; })]);
  const iso = () => new Date(now()).toISOString();
  const emit = (ev) => { for (const f of listeners) { try { f(ev || {}); } catch (e) {} } };

  /* 端末に保存されていた未送信を復元（障害D） */
  for (const k of store.keys(P)) {
    try { const e = JSON.parse(store.get(k)); if (e && e.key != null) { if (e.state === "sending") e.state = "queued"; S.entries[e.key] = e; } } catch (e) {}
  }
  function persistNow(key) {
    clearTimeout(persistTimers[key]); delete persistTimers[key];
    const e = S.entries[key];
    if (!e) { store.del(P + key); return; }
    store.set(P + key, JSON.stringify(e));
  }
  function persistSoon(key) { if (persistTimers[key]) return; persistTimers[key] = setTimeout(() => persistNow(key), PERSIST_DELAY); }
  function persistAll() { for (const k of Object.keys(persistTimers)) persistNow(k); }

  const mainRef = (key) => db.doc("kv/" + encKey(key));
  const partRef = (key, rev, i) => db.doc(`kvp/${encKey(key)}~${rev}~${i}`);

  async function readDoc(key, raw) {
    const snap = raw || await T(mainRef(key).get(), CALL_TIMEOUT);
    if (!snap || !snap.exists) return { rev: 0, value: null, w: null };
    const d = snap.data() || {};
    if (Number(d.sv) > SCHEMA) throw { code: "outdated_client" };
    let value = d.v === undefined ? null : d.v;
    if (d.parts) {
      const n = Math.min(Number(d.parts) || 0, MAX_PARTS); let str = "";
      for (let i = 0; i < n; i++) { const p = await T(partRef(key, d.rev, i).get(), CALL_TIMEOUT); if (!p.exists) throw { code: "unavailable", message: "part missing" }; str += (p.data() || {}).s || ""; }
      value = JSON.parse(str);
    }
    return { rev: Number(d.rev) || 0, value, w: d.w || null };
  }
  async function writeDoc(key, value, rev, token, prev) {
    const json = JSON.stringify(value);
    const base = { k: String(key), rev, w: token, at: iso(), sv: SCHEMA };
    if (bytes(json) <= INLINE_MAX) { await T(mainRef(key).set(Object.assign(base, { v: value })), SET_TIMEOUT); }
    else {
      const parts = []; for (let i = 0; i < json.length; i += PART_SIZE / 3) parts.push(json.slice(i, i + PART_SIZE / 3));
      if (parts.length > MAX_PARTS) throw { code: "too_large" };
      for (let i = 0; i < parts.length; i++) await T(partRef(key, rev, i).set({ s: parts[i] }), SET_TIMEOUT);
      await T(mainRef(key).set(Object.assign(base, { parts: parts.length })), SET_TIMEOUT);
    }
    if (prev && prev.parts) for (let i = 0; i < prev.parts; i++) { try { await T(partRef(key, prev.rev, i).delete(), CALL_TIMEOUT); } catch (e) {} }
  }
  async function lock(path, holder) {
    const t0 = now();
    for (;;) {
      const r = await T(db.doc(path).acquire({ holder, ttlMs: LEASE_MS }), CALL_TIMEOUT);
      if (r && r.acquired) return now();
      if (now() - t0 > LOCK_WAIT_MAX) throw { code: "busy" };
      let w = r && r.expiresAt ? Date.parse(r.expiresAt) - now() : 500;
      await sleep(Math.min(Math.max(w, 100), 3000) + Math.floor(rnd() * 300));
    }
  }

  /* ---------- 読込：失敗したら「読めなかった」と記録し、そのキーには書かない（障害A） ---------- */
  async function get(key) {
    const e = S.entries[key];
    const fresh = S.server[key] && (S.watch[key] || now() - (S.cacheAt[key] || 0) < CACHE_TTL);
    if (!fresh) {
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        try { const r = await readDoc(key); S.server[key] = { rev: r.rev, value: r.value }; S.cacheAt[key] = now(); S.failed[key] = false; ok = true; }
        catch (err) { if (err && err.code === "outdated_client") { S.paused = "outdated_client"; emit(); break; } if (i < 2) await sleep(700 * (i + 1)); }
      }
      if (!ok && !S.server[key]) { S.failed[key] = true; emit({ type: "loadFailed", key }); }
    }
    if (e && (e.state === "queued" || e.state === "blocked" || e.state === "failed")) return clone(e.mine);   // 未送信を必ず重ねる
    return S.server[key] ? clone(S.server[key].value) : null;
  }
  const loadFailed = (key) => !!S.failed[key];

  /* ---------- 保存：値ごと端末へ、少し待ってから送信 ---------- */
  function put(key, value, opt) {
    let e = S.entries[key];
    if (!e) {
      const sv = S.server[key];
      const known = !!sv && !S.failed[key];
      e = S.entries[key] = { key, base: known ? clone(sv.value) : null, baseKnown: known, mine: null, state: "queued", seq: now() * 1000 + (seqN++ % 1000), at: iso() };
      if (S.failed[key]) { e.state = "blocked"; e.info = { code: "not_loaded" }; }
    }
    e.mine = clone(value); e.at = iso();
    if (opt && opt.replace) { e.replace = true; e.state = "queued"; delete e.info; }
    if (e.state === "queued" && e.baseKnown && !e.replace && eq(e.mine, e.base)) { delete S.entries[key]; persistNow(key); emit(); return; }
    persistSoon(key); emit(); scheduleSend(SEND_DELAY);
  }
  function scheduleSend(ms) { clearTimeout(S.sendTimer); S.sendTimer = setTimeout(() => process(), ms); }

  async function sendOne(e) {
    const key = e.key;
    const snap = { base: e.base, mine: e.mine, baseKnown: e.baseKnown, replace: !!e.replace };
    const lockPath = "locks/kv~" + encKey(key);
    for (let attempt = 0; attempt < 6; attempt++) {
      const holder = `${tab}:${attempt}:${writeN++}`;
      let held = false, keep = false, t0 = 0;
      try {
        t0 = await lock(lockPath, holder); held = true;
        const cur = await readDoc(key);                         // ロック中に最新を読み直す
        let merged, conflicts = [];
        if (snap.replace) merged = snap.mine;
        else if (snap.baseKnown && eq(snap.base, cur.value)) merged = snap.mine;
        else { const r = merge3(snap.baseKnown ? snap.base : null, snap.mine, cur.value); merged = r.value; conflicts = r.conflicts; }
        let rev = cur.rev;
        if (!eq(merged, cur.value) || (snap.replace && cur.rev === 0)) {
          if (now() - t0 > WRITE_DEADLINE) continue;
          const token = `${tab}.${writeN++}`;
          let prevMeta = null;
          try { const raw = await T(mainRef(key).get(), CALL_TIMEOUT); const d = raw.exists ? raw.data() : null; if (d && d.parts) prevMeta = { rev: d.rev, parts: d.parts }; } catch (err) {}
          try { await writeDoc(key, merged, cur.rev + 1, token, prevMeta); }
          catch (err) { keep = true; throw err; }                // 届いたか不明 → ロックは期限まで保持
          const v = await T(mainRef(key).get(), CALL_TIMEOUT);    // 反映を確認
          const d = v.exists ? v.data() : null;
          if (!d || d.w !== token) throw { code: "lost" };
          rev = cur.rev + 1;
        }
        return { value: merged, rev, conflicts };
      } finally {
        if (held && !keep) { try { await T(db.doc(lockPath).acquire({ holder, ttlMs: RELEASE_MS }), CALL_TIMEOUT); } catch (err) {} }
      }
    }
    throw { code: "busy" };
  }

  async function process() {
    if (S.running) return; S.running = true; emit();
    try {
      for (;;) {
        if (S.paused) break;
        const q = Object.values(S.entries).filter((x) => x.state === "queued").sort((a, b) => a.seq - b.seq);
        if (!q.length) { S.retryDelay = 0; S.lastError = null; break; }
        const e = q[0];
        const sentMine = e.mine;
        let r;
        try { r = await sendOne(e); }
        catch (err) {
          const c = (err && err.code) || "network";
          if (c === "invalid_argument") S.readOnly = true;
          if (PAUSE.includes(c)) { S.paused = c; emit(); break; }
          if (PERM.includes(c)) { e.state = "failed"; e.info = { code: c }; persistNow(e.key); emit(); continue; }
          S.lastError = c; S.retryDelay = Math.min(S.retryDelay ? S.retryDelay * 2 : 2000, 60000); emit();
          if (!S.timer) { S.timer = true; sleep(S.retryDelay).then(() => { S.timer = false; process(); }); }
          break;
        }
        S.server[e.key] = { rev: r.rev, value: clone(r.value) }; S.cacheAt[e.key] = now(); S.failed[e.key] = false;
        const cur = S.entries[e.key];
        let local = r.value, changed = false;
        if (cur === e && cur.mine === sentMine) {                 // 送信中に新しい編集がなければ外す（障害C）
          delete S.entries[e.key]; persistNow(e.key);
          changed = !eq(r.value, sentMine);
        } else if (cur) {                                         // 送信中に増えた編集は、新しい土台の上に載せ直して残す
          const rb = merge3(sentMine, cur.mine, r.value).value;
          changed = !eq(rb, cur.mine);
          cur.base = clone(r.value); cur.baseKnown = true; delete cur.replace; cur.mine = rb; local = rb; persistNow(e.key);
        }
        if (r.conflicts.length) S.notes.push({ key: e.key, count: r.conflicts.length, at: iso() });
        if (changed) deliver(e.key, local, { merged: true, conflicts: r.conflicts.length });
        else if (r.conflicts.length) emit({ type: "conflict", key: e.key, count: r.conflicts.length });
        S.lastError = null; S.retryDelay = 0; emit();
      }
    } finally { S.running = false; emit(); }
  }

  /* ---------- 他の人の変更をリアルタイムで取り込む ---------- */
  function deliver(key, value, info) {
    const w = S.watch[key];
    if (w) for (const cb of w.cbs) { try { cb(clone(value), info || {}); } catch (e) {} }
    emit(Object.assign({ type: "remote", key }, info || {}));
  }
  async function onRemote(key, raw) {
    let r;
    try { r = await readDoc(key, raw); } catch (err) { if (err && err.code === "outdated_client") { S.paused = "outdated_client"; emit(); } return; }
    const known = S.server[key];
    if (known && r.rev <= known.rev) return;                      // 自分の書込の反映、または古い通知
    S.server[key] = { rev: r.rev, value: clone(r.value) }; S.cacheAt[key] = now(); S.failed[key] = false;
    const e = S.entries[key];
    if (!e) { deliver(key, r.value, { remote: true }); return; }
    if (e.state === "blocked") { emit(); return; }                // 読めなかった間の編集は確認待ちのまま
    const rb = merge3(e.baseKnown ? e.base : null, e.mine, r.value);
    e.base = clone(r.value); e.baseKnown = true; e.mine = rb.value; persistNow(key);
    deliver(key, rb.value, { remote: true, merged: true, conflicts: rb.conflicts.length });
  }
  function watch(key, cb) {
    let w = S.watch[key];
    if (!w) {
      w = S.watch[key] = { cbs: new Set(), unsub: null };
      try {
        w.unsub = mainRef(key).onSnapshot((snap) => { if (snap && snap.metadata && snap.metadata.hasPendingWrites) return; onRemote(key, snap); }, () => { emit({ type: "watchError", key }); });
      } catch (e) {}
    }
    w.cbs.add(cb);
    return () => { w.cbs.delete(cb); if (!w.cbs.size) { try { w.unsub && w.unsub(); } catch (e) {} delete S.watch[key]; } };
  }

  async function list(prefix) {
    const p = String(prefix == null ? "" : prefix);
    const keys = new Set();
    let q = db.collection("kv");
    if (p) q = q.where("k", ">=", p).where("k", "<", p + "");
    const snap = await T(q.limit(1000).get(), CALL_TIMEOUT);
    snap.docs.forEach((d) => { const x = d.data(); if (x && typeof x.k === "string" && x.k.startsWith(p)) keys.add(x.k); });
    for (const k of Object.keys(S.entries)) if (k.startsWith(p)) keys.add(k);
    return [...keys];
  }

  /* ロックの中で「読む→変える→書く」を1回で行う（版更新時の初期データ取り込みなど、
     複数の端末が同時に行うと重複しうる処理に使う） */
  async function update(key, fn) {
    const lockPath = "locks/kv~" + encKey(key);
    const holder = `${tab}:u:${writeN++}`;
    await lock(lockPath, holder);
    try {
      const cur = await readDoc(key);
      const next = fn(clone(cur.value));
      let rev = cur.rev;
      if (next !== undefined && !eq(next, cur.value)) {
        const token = `${tab}.${writeN++}`;
        await writeDoc(key, next, cur.rev + 1, token, null);
        const v = await T(mainRef(key).get(), CALL_TIMEOUT);
        if (!v.exists || v.data().w !== token) throw { code: "lost" };
        rev = cur.rev + 1;
      }
      const val = next === undefined ? cur.value : next;
      S.server[key] = { rev, value: clone(val) }; S.cacheAt[key] = now(); S.failed[key] = false;
      const e = S.entries[key];
      if (e && e.state !== "blocked") { const rb = merge3(e.baseKnown ? e.base : null, e.mine, val); e.base = clone(val); e.baseKnown = true; e.mine = rb.value; persistNow(key); return clone(rb.value); }
      return clone(val);
    } finally { try { await T(db.doc(lockPath).acquire({ holder, ttlMs: RELEASE_MS }), CALL_TIMEOUT); } catch (err) {} }
  }

  const api = {
    SCHEMA, merge3, eq, encKey, update,
    get tab() { return tab; },
    get, put, watch, list, loadFailed,
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
        running: S.running, paused: S.paused, lastError: S.lastError, retryDelay: S.retryDelay, persistent: store.persistent, readOnly: S.readOnly,
        loadFailedKeys: Object.keys(S.failed).filter((k) => S.failed[k]) };
    },
  };
  if (Object.keys(S.entries).length) setTimeout(() => process(), 0);   // 起動時に未送信を自動で再送
  return api;
}

const API = { createKV, merge3, eq, encKey, SCHEMA };
if (typeof module !== "undefined" && module.exports) module.exports = API; else G.SGKV = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
