// 共通部品（変更しないでください）。画面側と同じコードをサーバーでも使います
/* チームカレンダー 保存コア — 画面から独立した保存・同期ロジック（テストと本番で同じコードを使う） */
(function (G) {
"use strict";
const SCHEMA = 1;              // データ形式の版。これより新しい形式のデータには書き込まない
const SHARDS = 4;              // 1日の予定を4つの文書に分けて同時書込の衝突を減らす
const LEASE_MS = 20000;        // 排他ロックの有効時間
const RELEASE_MS = 1000;       // 書込後はロックを1秒に縮めて次の人に譲る
const WRITE_DEADLINE = 5000;   // ロック取得からこの時間を過ぎたら書かずにやり直す
const CALL_TIMEOUT = 10000;    // 読込・ロックのタイムアウト
const SET_TIMEOUT = 5000;      // 書込のタイムアウト
const LOCK_WAIT_MAX = 90000;   // ロック待ちの上限（超えたら後で再送）
const MAX_BYTES = 240000;      // 1文書の上限（基盤は256KiB）
const MAX_COMMENTS = 100;
const TRASH_DAYS = 30;
const LABEL_KEYS = ["help", "ride", "leave", "user", "other", "hwork"];  // 以前の会議・外出・締切・社内イベントは「その他予定」として表示
const SG_TYPES = ["staff_off", "staff_plan", "user_absent", "user_time"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const PERM = ["invalid_argument", "quota_exceeded", "transform_error", "full", "outdated_client"];
const PAUSE = ["revoked", "not_granted", "capability_disabled", "capability_removed"];

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const shardOf = id => hash(id) % SHARDS;
const dayPath = (date, id) => `days/${date}_${shardOf(id)}`;
const cmPath = (key, id) => `cm/${key}_${shardOf(id)}`;
const lockOf = p => "locks/" + p.replace("/", "~");
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
const uid = (rnd) => { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < 20; i++) s += a[Math.floor(rnd() * a.length)]; return s; };
function utf8len(str){let n=0;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);if(c<0x80)n+=1;else if(c<0x800)n+=2;else if(c>=0xd800&&c<0xdc00){n+=4;i++}else n+=3}return n}
const bytes = o => utf8len(JSON.stringify(o));

/* ---------- 受け取ったデータは信用しない：形と長さをそろえる ---------- */
function normEvent(r, id, depth) {
  if (!r || typeof r !== "object" || !ID_RE.test(String(id))) return null;
  if (!DATE_RE.test(r.date)) return null;
  const date = r.date;
  const endDate = DATE_RE.test(r.endDate) && r.endDate >= date ? r.endDate : date;
  const start = TIME_RE.test(r.start) ? r.start : "", end = TIME_RE.test(r.end) ? r.end : "";
  const allDay = r.allDay === true || !start || !end;
  const e = {
    id: String(id), title: str(r.title, 80) || "（無題）", date, endDate, allDay,
    start: allDay ? "" : start, end: allDay ? "" : end,
    label: LABEL_KEYS.includes(r.label) ? r.label : "other",
    place: str(r.place, 80), memo: str(r.memo, 2000),
    members: Array.isArray(r.members) ? [...new Set(r.members.filter(x => typeof x === "string" && x.length <= 64))].slice(0, 100) : [],
    createdBy: typeof r.createdBy === "string" ? r.createdBy.slice(0, 64) : null, createdAt: str(r.createdAt, 40),
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy.slice(0, 64) : null, updatedAt: str(r.updatedAt, 40),
    rev: Number.isInteger(r.rev) && r.rev > 0 ? r.rev : 1, lastOp: str(r.lastOp, 80),
    cmKey: DATE_RE.test(r.cmKey) ? r.cmKey : date,
    deleted: r.deleted === true, deletedAt: str(r.deletedAt, 40),
    deletedBy: typeof r.deletedBy === "string" ? r.deletedBy.slice(0, 64) : null,
    prev: null,
    sg: normSg(r.sg),
  };
  if (!depth && r.prev && typeof r.prev === "object") e.prev = normEvent(r.prev, id, 1);
  return e;
}
function normDay(raw) {
  const out = {};
  const ev = raw && typeof raw.events === "object" && raw.events ? raw.events : {};
  for (const k of Object.keys(ev)) { const e = normEvent(ev[k], k, 0); if (e) out[k] = e; }
  return out;
}
function normComment(c) {
  if (!c || typeof c !== "object" || !ID_RE.test(String(c.id))) return null;
  const text = str(c.text, 500).trim(); if (!text) return null;
  return { id: String(c.id), text, by: typeof c.by === "string" ? c.by.slice(0, 64) : null, at: str(c.at, 40) };
}
function normCm(raw) {
  const out = {};
  const m = raw && typeof raw.comments === "object" && raw.comments ? raw.comments : {};
  for (const k of Object.keys(m)) {
    if (!ID_RE.test(k) || !Array.isArray(m[k])) continue;
    out[k] = m[k].map(normComment).filter(Boolean).slice(0, MAX_COMMENTS);
  }
  return out;
}
/* 送迎表への反映内容（職員・利用者は送迎表の名前で持つ） */
function normSg(x) {
  if (!x || typeof x !== "object" || !SG_TYPES.includes(x.type)) return null;
  const names = (a) => Array.isArray(a) ? [...new Set(a.filter((v) => typeof v === "string" && v && v.length <= 40))].slice(0, 80) : [];
  const t = (v) => (TIME_RE.test(v) ? v : "");
  return { type: x.type, staff: names(x.staff), users: names(x.users), meet: t(x.meet), send: t(x.send), noMeet: str(x.noMeet, 40), noSend: str(x.noSend, 40), half: x.type === "staff_off" && (x.half === "am" || x.half === "pm") ? x.half : "" };
}
const strip = e => { const x = clone(e); x.prev = null; return x; };

/* ---------- 文書の組み立て（容量ガードとゴミ箱の自動整理つき） ---------- */
function buildDay(path, events, nowIso) {
  const limit = nowIso ? new Date(Date.parse(nowIso) - TRASH_DAYS * 864e5).toISOString() : "";
  for (const k of Object.keys(events)) { const e = events[k]; if (e.deleted && e.deletedAt && limit && e.deletedAt < limit) delete events[k]; }
  const [date, sh] = path.slice(5).split("_");
  let maxEnd = date;
  for (const e of Object.values(events)) if (e.endDate > maxEnd) maxEnd = e.endDate;
  const doc = { v: SCHEMA, date, shard: Number(sh), maxEnd, events };
  if (bytes(doc) > MAX_BYTES) {
    const order = Object.values(events).filter(e => e.prev).sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""));
    for (const e of order) { e.prev = null; if (bytes(doc) <= MAX_BYTES) break; }
    if (bytes(doc) > MAX_BYTES) return null;
  }
  return doc;
}

/* ---------- 操作を、最新のサーバーデータに当てはめる（純粋関数） ---------- */
function baseOk(ex, op) { return !!ex && ((op.baseOp && ex.lastOp === op.baseOp) || (op.baseRev > 0 && ex.rev === op.baseRev)); }
function targetsOf(op) {
  if (op.kind === "comment") return [cmPath(op.cmKey, op.eventId)];
  if (op.kind === "upsert") { const a = dayPath(op.fromDate || op.ev.date, op.id), b = dayPath(op.ev.date, op.id); return a === b ? [a] : [a, b]; }
  return [dayPath(op.date, op.id)];
}
function outdated(raw) { return raw && Number(raw.v) > SCHEMA; }

function applyOp(op, paths, raws) {
  for (const r of raws) if (outdated(r)) return { status: "outdated" };
  if (op.kind === "comment") {
    const cm = normCm(raws[0]); const list = cm[op.eventId] || [];
    if (list.some(c => c.id === op.comment.id)) return { status: "done" };
    if (list.length >= MAX_COMMENTS) return { status: "full" };
    cm[op.eventId] = list.concat([normComment(op.comment)]);
    const doc = { v: SCHEMA, date: op.cmKey, comments: cm };
    if (bytes(doc) > MAX_BYTES) return { status: "full" };
    return { status: "ok", writes: [{ path: paths[0], data: doc }], verify: { path: paths[0], check: d => (d.comments?.[op.eventId] || []).some(c => c && c.id === op.comment.id) } };
  }
  const id = op.id;
  if (op.kind === "upsert") {
    const from = dayPath(op.fromDate || op.ev.date, id), to = dayPath(op.ev.date, id);
    const A = normDay(raws[paths.indexOf(from)]), B = from === to ? A : normDay(raws[paths.indexOf(to)]);
    const exB = B[id], exA = A[id];
    if (exB && exB.lastOp === op.opId) {           // 前回の送信は届いていた（応答だけ消えた）
      if (from !== to && exA && exA.lastOp !== op.opId) { delete A[id]; const da = buildDay(from, A, op.at); return da ? { status: "ok", writes: [{ path: from, data: da }], verify: null } : { status: "full" }; }
      return { status: "done" };
    }
    const ex = exA;
    if (op.baseRev == null && !op.baseOp) {          // 新規作成
      if (ex || exB) return { status: "conflict", reason: "exists", theirs: ex || exB };
    } else if (!op.force) {
      if (!ex || ex.deleted) return { status: "conflict", reason: ex ? "deleted" : "missing", theirs: ex || null };
      if (!baseOk(ex, op)) return { status: "conflict", reason: "changed", theirs: ex };
    }
    const base = ex && !ex.deleted ? ex : null;
    const ne = normEvent(Object.assign({}, op.ev, {
      rev: (ex ? ex.rev : (exB ? exB.rev : 0)) + 1, lastOp: op.opId,
      createdBy: base ? base.createdBy : (ex ? ex.createdBy : op.by), createdAt: base ? base.createdAt : (ex ? ex.createdAt : op.at),
      updatedBy: op.by, updatedAt: op.at, cmKey: ex ? ex.cmKey : (exB ? exB.cmKey : op.ev.date), deleted: false,
    }), id, 1);
    if (!ne) return { status: "failed" };
    ne.prev = ex ? strip(ex) : null;
    const writes = [];
    B[id] = ne;
    const db_ = buildDay(to, B, op.at); if (!db_) return { status: "full" };
    writes.push({ path: to, data: db_ });            // 移動のときは「新しい日に書く」→「元の日から消す」の順（途中で切れても消えずに重複側に倒れる）
    if (from !== to) { delete A[id]; const da = buildDay(from, A, op.at); if (!da) return { status: "full" }; writes.push({ path: from, data: da }); }
    return { status: "ok", writes, verify: { path: to, check: d => d.events?.[id]?.lastOp === op.opId } };
  }
  const D = normDay(raws[0]); const ex = D[id];
  if (ex && ex.lastOp === op.opId) return { status: "done" };
  if (op.kind === "delete") {
    if (!ex || ex.deleted) return { status: "done" };
    if (!op.force && !baseOk(ex, op)) return { status: "conflict", reason: "changed", theirs: ex };
    D[id] = Object.assign(clone(ex), { deleted: true, deletedAt: op.at, deletedBy: op.by, rev: ex.rev + 1, lastOp: op.opId, prev: strip(ex) });
  } else if (op.kind === "restore") {
    if (!ex) return { status: "conflict", reason: "missing", theirs: null };
    if (!ex.deleted) return { status: "done" };
    D[id] = Object.assign(clone(ex), { deleted: false, deletedAt: "", deletedBy: null, rev: ex.rev + 1, lastOp: op.opId, updatedBy: op.by, updatedAt: op.at });
  } else return { status: "failed" };
  const d = buildDay(paths[0], D, op.at); if (!d) return { status: "full" };
  return { status: "ok", writes: [{ path: paths[0], data: d }], verify: { path: paths[0], check: x => x.events?.[id]?.lastOp === op.opId } };
}

/* ---------- 画面に出す一覧：サーバーの内容に未送信分を必ず重ねる ---------- */
function mergeDays(docs) {
  const map = {};
  for (const raw of docs) { if (!raw) continue; const ev = normDay(raw); for (const k in ev) if (!map[k] || ev[k].rev > map[k].rev) map[k] = ev[k]; }
  return map;
}

/* ---------- 端末ストレージ（失敗してもメモリで動き続ける） ---------- */
function makeStore(ls) {
  const mem = new Map(); let persistent = true;
  try { const k = "tc:probe"; ls.setItem(k, "1"); ls.removeItem(k); } catch { persistent = false; }
  return {
    get persistent() { return persistent; },
    get(k) { if (mem.has(k)) return mem.get(k); if (!persistent) return null; try { return ls.getItem(k); } catch { return null; } },
    set(k, v) { mem.set(k, v); if (!persistent) return false; try { ls.setItem(k, v); return true; } catch { persistent = false; return false; } },
    del(k) { mem.delete(k); if (!persistent) return; try { ls.removeItem(k); } catch {} },
    keys(prefix) {
      const s = new Set([...mem.keys()].filter(k => k.startsWith(prefix)));
      if (persistent) { try { for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(prefix)) s.add(k); } } catch {} }
      return [...s];
    },
  };
}

/* ---------- 同期エンジン ---------- */
function createCore(o) {
  const db = o.db, store = o.store;
  const now = o.now || (() => Date.now());
  const sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const rnd = o.random || Math.random;
  const tab = o.tab || uid(rnd);
  let me = o.me || null;
  const listeners = new Set();
  let running = false, retryTimer = false, retryDelay = 0, paused = null, lastError = null, seqN = 0;
  const P = "tc:op:";

  const emit = () => { for (const f of listeners) { try { f(); } catch {} } };
  const T = (p, ms) => Promise.race([p, sleep(ms).then(() => { throw { code: "timeout" }; })]);
  const iso = () => new Date(now()).toISOString();

  function list() {
    const ops = [];
    for (const k of store.keys(P)) { const v = store.get(k); if (!v) continue; try { const op = JSON.parse(v); if (op && op.opId) ops.push(op); } catch {} }
    return ops.sort((a, b) => a.seq - b.seq);
  }
  const keyOf = op => P + String(op.seq).padStart(16, "0") + ":" + op.opId;
  function put(op) { return store.set(keyOf(op), JSON.stringify(op)); }
  function drop(op) { store.del(keyOf(op)); }

  function enqueue(op) {
    op.opId = op.opId || uid(rnd); op.seq = now() * 1000 + (seqN++ % 1000); op.state = "queued";
    op.by = me; op.at = iso();
    const saved = put(op);           // 送る前に「値ごと」端末に保存（障害D）
    emit(); kick();
    return { opId: op.opId, persisted: saved && store.persistent };
  }

  async function lock(path, holder) {
    const t0 = now();
    for (;;) {
      const r = await T(db.doc(path).acquire({ holder, ttlMs: LEASE_MS }), CALL_TIMEOUT);
      if (r && r.acquired) return now();
      if (now() - t0 > LOCK_WAIT_MAX) throw { code: "busy" };
      let w = r && r.expiresAt ? Date.parse(r.expiresAt) - now() : 500;
      w = Math.min(Math.max(w, 100), 3000) + Math.floor(rnd() * 300);
      await sleep(w);
    }
  }

  async function run(op) {
    if (o.runOp) return o.runOp(op);
    for (let attempt = 0; attempt < 6; attempt++) {
      const paths = targetsOf(op).slice();
      const order = paths.slice().sort();
      const holder = `${tab}:${op.opId}:${attempt}`;
      const held = []; let first = null, keep = false, restart = false;
      try {
        for (const p of order) { const t = await lock(lockOf(p), holder); held.push(lockOf(p)); if (first == null) first = t; }
        if (now() - first > WRITE_DEADLINE) { restart = true; continue; }
        const snaps = await Promise.all(paths.map(p => T(db.doc(p).get(), CALL_TIMEOUT)));
        const raws = snaps.map(s => (s && s.exists ? s.data() : null));   // 読めなかったら上の行で例外 → 何も書かない（障害A）
        const res = applyOp(op, paths, raws);
        if (res.status === "outdated") throw { code: "outdated_client" };
        if (res.status !== "ok") return res;
        for (const w of res.writes) {
          if (now() - first > WRITE_DEADLINE) { restart = true; break; }
          try { await T(db.doc(w.path).set(w.data), SET_TIMEOUT); }
          catch (e) { keep = true; throw e; }       // 届いたか不明 → ロックを解放せず期限まで持つ
        }
        if (restart) continue;
        if (res.verify) {
          const v = await T(db.doc(res.verify.path).get(), CALL_TIMEOUT);
          if (!(v && v.exists && res.verify.check(v.data()))) throw { code: "lost" };
        }
        return res;
      } finally {
        if (!keep) for (const l of held) { try { await T(db.doc(l).acquire({ holder, ttlMs: RELEASE_MS }), CALL_TIMEOUT); } catch {} }
      }
    }
    throw { code: "busy" };
  }

  async function process() {
    if (running) return; running = true;
    try {
      for (;;) {
        if (paused) break;
        const q = list().filter(x => x.state === "queued");
        if (!q.length) { retryDelay = 0; lastError = null; break; }
        const op = q[0];
        let r;
        try { r = await run(op); }
        catch (e) {
          const c = (e && e.code) || "network";
          if (PERM.includes(c)) { op.state = "failed"; op.info = { code: c }; put(op); if (c === "outdated_client") { paused = c; } emit(); continue; }
          if (PAUSE.includes(c)) { paused = c; emit(); break; }
          lastError = c; retryDelay = Math.min(retryDelay ? retryDelay * 2 : 2000, 60000); emit(); schedule(retryDelay); break;
        }
        if (r.status === "ok" || r.status === "done") { drop(op); lastError = null; retryDelay = 0; }   // 成功した操作だけ外す（障害C）
        else if (r.status === "conflict") { op.state = "conflict"; op.info = { reason: r.reason, theirs: r.theirs || null }; put(op); }
        else { op.state = "failed"; op.info = { code: r.status }; put(op); }
        emit();
      }
    } finally { running = false; }
  }
  function schedule(ms) { if (retryTimer) return; retryTimer = true; sleep(ms).then(() => { retryTimer = false; kick(); }); }
  function kick() { process(); }

  /* 画面の操作 → 操作データ */
  function pendingFor(id) { const q = list().filter(x => x.state === "queued" && (x.id === id)); return q.length ? q[q.length - 1] : null; }
  function baseFields(ev) {
    const p = pendingFor(ev.id);
    return p ? { baseOp: p.opId, baseRev: -1 } : { baseOp: null, baseRev: ev.rev };
  }
  const api = {
    SCHEMA, normEvent, normDay, normCm, mergeDays, applyOp, targetsOf, dayPath, cmPath, shardOf, buildDay,
    get tab() { return tab; },
    setMe(id) { me = id; },
    on(f) { listeners.add(f); return () => listeners.delete(f); },
    list, kick,
    status() {
      const ops = list();
      return { queued: ops.filter(x => x.state === "queued").length, conflicts: ops.filter(x => x.state === "conflict"), failed: ops.filter(x => x.state === "failed"), running, paused, lastError, persistent: store.persistent, retryDelay };
    },
    newId() { return uid(rnd); },
    save(ev, editing) {   // ev: 画面の入力値（date, title...）
      const id = editing ? editing.id : (ev.id || uid(rnd));
      const op = { kind: "upsert", id, ev: Object.assign({}, ev, { id }), fromDate: editing ? editing.date : ev.date, baseRev: null, baseOp: null };
      if (editing) Object.assign(op, baseFields(editing));
      return enqueue(op);
    },
    remove(ev) { return enqueue(Object.assign({ kind: "delete", id: ev.id, date: ev.date }, baseFields(ev))); },
    restore(ev) { return enqueue({ kind: "restore", id: ev.id, date: ev.date }); },
    comment(ev, text) {
      const c = { id: uid(rnd), text: String(text).slice(0, 500), by: me, at: iso() };
      return enqueue({ kind: "comment", id: ev.id, eventId: ev.id, cmKey: ev.cmKey || ev.date, comment: c });
    },
    force(opId) { const op = list().find(x => x.opId === opId); if (!op) return; op.force = true; op.state = "queued"; delete op.info; put(op); emit(); kick(); },
    retry(opId) { const op = list().find(x => x.opId === opId); if (!op) return; op.state = "queued"; delete op.info; put(op); paused = null; emit(); kick(); },
    discard(opId) { const op = list().find(x => x.opId === opId); if (op) { drop(op); emit(); } },
    resume() { paused = null; retryDelay = 0; kick(); },
    /* サーバーの一覧に未送信の操作を重ねる（障害D：読込時に必ず重ねる） */
    overlay(serverMap) {
      const m = {};
      for (const k in serverMap) m[k] = Object.assign({}, serverMap[k], { pending: false });
      for (const op of list()) {
        if (op.state !== "queued") continue;
        const ex = m[op.id];
        if (op.kind === "upsert") { const ne = normEvent(Object.assign({}, op.ev, { rev: ex ? ex.rev : 1, cmKey: ex ? ex.cmKey : op.ev.date, createdBy: ex ? ex.createdBy : op.by, prev: ex ? ex.prev : null }), op.id, 0); if (ne) m[op.id] = Object.assign(ne, { pending: true }); }
        else if (op.kind === "delete" && ex) m[op.id] = Object.assign({}, ex, { deleted: true, pending: true });
        else if (op.kind === "restore" && ex) m[op.id] = Object.assign({}, ex, { deleted: false, pending: true });
      }
      return m;
    },
    pendingComments(eventId) { return list().filter(x => x.kind === "comment" && x.eventId === eventId && x.state !== "conflict").map(x => Object.assign({}, x.comment, { pending: x.state === "queued", failed: x.state === "failed" })); },
  };
  return api;
}

const API = { normSg, SG_TYPES, createCore, makeStore, normEvent, normDay, normCm, mergeDays, applyOp, targetsOf, dayPath, cmPath, shardOf, buildDay, SCHEMA, SHARDS, LEASE_MS, MAX_BYTES, MAX_COMMENTS };
if (typeof module !== "undefined" && module.exports) module.exports = API; else G.TCCore = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
