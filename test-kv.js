/* 送迎表 保存エンジンの検証：実際の送迎表データ(v293の初期データ)を使い、本番と同じエンジンを模擬サーバーで動かす */
"use strict";
global.window = {};
const K = require("./kvsync.js");
const E = require("./eng.cjs");
const assert = require("assert");

const SCALE = 40;
const realStart = Date.now(), vStart = Date.parse("2026-10-26T08:00:00Z");
const now = () => vStart + (Date.now() - realStart) * SCALE;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms / SCALE)));
let seed = 777; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

class Server {
  constructor() { this.docs = new Map(); this.leases = new Map(); this.subs = new Map(); this.stats = { busy: 0, set: 0 }; }
  client(f = {}) {
    const s = this;
    const fault = Object.assign({ offline: false, hang: false, lat: [30, 250], lostAck: 0, slowSet: 0, readFail: false }, f);
    const lat = () => fault.lat[0] + rnd() * (fault.lat[1] - fault.lat[0]);
    async function call(fn, kind) {
      await sleep(lat());
      if (fault.offline || (kind === "get" && fault.readFail)) { if (fault.hang) await new Promise(() => {}); throw { code: "unavailable" }; }
      if (kind === "set" && fault.slowSet) await sleep(fault.slowSet);
      const out = fn();
      await sleep(lat());
      if (kind === "set" && rnd() < fault.lostAck) throw { code: "unavailable", message: "ack lost" };
      return out;
    }
    const snapOf = (p) => { const d = s.docs.get(p); return { exists: !!d, data: () => JSON.parse(d), metadata: {} }; };
    return {
      fault,
      collection: (c) => {
        const mk = (filters) => ({
          where: (f, op, v) => mk(filters.concat([[f, op, v]])), limit: () => mk(filters),
          get: () => call(() => ({ docs: [...s.docs.entries()].filter(([p]) => p.startsWith(c + "/") && p.split("/").length === 2).map(([p, v]) => ({ id: p.split("/")[1], data: () => JSON.parse(v) })).filter((d) => filters.every(([f, op, v]) => { const x = d.data()[f]; return op === ">=" ? x >= v : op === "<" ? x < v : op === "<=" ? x <= v : true; })) }), "get"),
        });
        return mk([]);
      },
      doc(path) {
        return {
          get: () => call(() => snapOf(path), "get"),
          set: (data) => call(() => { s.stats.set++; s.docs.set(path, JSON.stringify(data)); (s.subs.get(path) || []).forEach((cb) => setTimeout(() => cb(snapOf(path)), Math.max(1, lat() / SCALE))); }, "set"),
          delete: () => call(() => { s.docs.delete(path); }, "set"),
          acquire: ({ holder, ttlMs }) => call(() => {
            const ttl = Math.min(Math.max(ttlMs || 30000, 1000), 600000), l = s.leases.get(path), t = now();
            if (!l || l.exp <= t || l.holder === holder) { s.leases.set(path, { holder, exp: t + ttl }); return { acquired: true, expiresAt: new Date(t + ttl).toISOString() }; }
            s.stats.busy++; return { acquired: false, expiresAt: new Date(l.exp).toISOString() };
          }),
          onSnapshot: (cb) => { if (!s.subs.has(path)) s.subs.set(path, []); s.subs.get(path).push((x) => { if (!fault.offline) cb(x); }); setTimeout(() => cb(snapOf(path)), 1); return () => {}; },
        };
      },
    };
  }
  val(key) { const d = this.docs.get("kv/" + K.encKey(key)); if (!d) return null; const x = JSON.parse(d); if (x.parts) { let s = ""; for (let i = 0; i < x.parts; i++) s += JSON.parse(this.docs.get(`kvp/${K.encKey(key)}~${x.rev}~${i}`)).s; return JSON.parse(s); } return x.v; }
}
function memLS() { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); return true; }, del: (k) => m.delete(k), keys: (p) => [...m.keys()].filter((k) => k.startsWith(p)), persistent: true }; }
function client(server, fault, ls) { const conn = server.client(fault); const st = ls || memLS(); return { kv: K.createKV({ db: conn, store: st, now, sleep, random: rnd }), conn, ls: st }; }
async function settle(cs, max = 20 * 60e3) {
  const t0 = now();
  for (;;) {
    if (cs.every((c) => { const s = c.kv.status(); return (s.queued === 0 || s.paused) && !s.running; })) return now() - t0;
    if (now() - t0 > max) throw new Error("timeout");
    cs.forEach((c) => c.kv.kick()); await sleep(2000);
  }
}
const results = [];
async function test(name, fn) { const t = Date.now(); try { const info = await fn(); results.push({ name, ok: true, info: info || "" }); console.log("✔", name, info ? "— " + info : "", `(${Date.now() - t}ms)`); } catch (e) { results.push({ name, ok: false, info: String(e && e.stack || e) }); console.log("✘", name, e); } }

const master = E.mergeSeedMaster(null, E.seedMaster());
const sheetFrom = (wd, key) => { const p = E.resolveSeedPattern(master, E.SEED_PATTERNS[key]); return Object.assign(E.emptySheet(), { runs: p.runs.map((r, i) => Object.assign({}, r, { id: "r" + i })), blocks: (p.blocks || []).map((b, i) => Object.assign({}, b, { id: "b" + i })) }); };
const staffIds = master.staff.map((s) => s.id), userIds = master.users.map((u) => u.id);

(async () => {
  await test("2人が同じ日の送迎表を同時に編集（別々の便）→ 両方の変更が残る（障害B）", async () => {
    const s = new Server(); const a = client(s), b = client(s);
    const base = sheetFrom(1, "mon"); a.kv.put("sheet:2026-10-26", base); await settle([a]);
    const va = await a.kv.get("sheet:2026-10-26"), vb = await b.kv.get("sheet:2026-10-26");
    va.runs[0].time = "7:45"; va.runs[0].note = "Aさんが変更";
    vb.runs[5].staffId = staffIds[10]; vb.blocks.push({ id: "bx", kind: "block", time: "13:00", staffId: staffIds[3], label: "Bさん追加の予定" });
    vb.userAbsent[userIds[2]] = true;
    a.kv.put("sheet:2026-10-26", va); b.kv.put("sheet:2026-10-26", vb);
    await settle([a, b]);
    const f = s.val("sheet:2026-10-26");
    assert.strictEqual(f.runs[0].time, "7:45"); assert.strictEqual(f.runs[0].note, "Aさんが変更");
    assert.strictEqual(f.runs[5].staffId, staffIds[10]); assert.ok(f.blocks.some((x) => x.id === "bx")); assert.strictEqual(f.userAbsent[userIds[2]], true);
    assert.strictEqual(f.runs.length, base.runs.length);
    return "A: 便の時刻・メモ／B: 担当変更・予定追加・欠席 → すべて保存";
  });

  await test("10人が同じ日を同時に編集（各自が別の便・予定・欠席・時間変更）→ 全員分が残る、便の重複・消失なし", async () => {
    const s = new Server(); const seedC = client(s); const base = sheetFrom(3, "wed"); seedC.kv.put("sheet:2026-10-28", base); await settle([seedC]);
    const cs = Array.from({ length: 10 }, () => client(s));
    const vals = await Promise.all(cs.map((c) => c.kv.get("sheet:2026-10-28")));
    cs.forEach((c, i) => { const v = vals[i]; v.runs[i].note = "編集" + i; v.blocks.push({ id: "new" + i, kind: "block", time: "14:00", staffId: staffIds[i], label: "追加" + i }); v.userTime[userIds[i]] = { meet: "10:" + (10 + i) }; if (i === 9) v.runs.splice(20, 1); c.kv.put("sheet:2026-10-28", v); });
    await settle(cs);
    const f = s.val("sheet:2026-10-28");
    for (let i = 0; i < 10; i++) { assert.strictEqual(f.runs.find((r) => r.id === "r" + i).note, "編集" + i); assert.ok(f.blocks.some((b) => b.id === "new" + i)); assert.strictEqual(f.userTime[userIds[i]].meet, "10:" + (10 + i)); }
    assert.strictEqual(f.runs.length, base.runs.length - 1, "削除も反映"); assert.ok(!f.runs.some((r) => r.id === "r20"));
    assert.strictEqual(new Set(f.runs.map((r) => r.id)).size, f.runs.length);
    return `10人×4種類の編集＋便の削除1件 → すべて反映、便${f.runs.length}件・重複0`;
  });

  await test("同じ便の同じ項目を2人が別々に変更 → 後から保存した人の内容になり、競合として通知される（黙って消えない）", async () => {
    const s = new Server(); const a = client(s), b = client(s); a.kv.put("sheet:2026-10-29", sheetFrom(4, "thu")); await settle([a]);
    const va = await a.kv.get("sheet:2026-10-29"), vb = await b.kv.get("sheet:2026-10-29");
    va.runs[2].staffId = staffIds[1]; vb.runs[2].staffId = staffIds[2];
    let noted = 0; b.kv.on((ev) => { if (ev.type === "conflict" || (ev.type === "remote" && ev.conflicts)) noted++; });
    a.kv.put("sheet:2026-10-29", va); await settle([a]); b.kv.put("sheet:2026-10-29", vb); await settle([b]);
    assert.strictEqual(s.val("sheet:2026-10-29").runs[2].staffId, staffIds[2]);
    assert.ok(noted >= 1 || b.kv.takeNotes().length >= 1, "通知あり");
    return "後の保存が優先、競合を通知";
  });

  await test("開きっぱなしの画面に、他の人の変更がリアルタイムで反映される（自分の未送信の編集も残る）", async () => {
    const s = new Server(); const a = client(s), b = client(s); a.kv.put("master", master); await settle([a]);
    let shown = await b.kv.get("master"); b.kv.watch("master", (v) => { shown = v; });
    await sleep(500);
    const mine = JSON.parse(JSON.stringify(shown)); mine.staff[0].start = "7:00"; b.kv.conn = b.conn; b.conn.fault.offline = true; b.kv.put("master", mine); shown = mine;
    const va = await a.kv.get("master"); va.staff[1].end = "18:30"; a.kv.put("master", va); await settle([a]);
    b.conn.fault.offline = false; await sleep(3000); b.kv.kick(); await settle([b]); await sleep(2000);
    const f = s.val("master");
    assert.strictEqual(f.staff[0].start, "7:00"); assert.strictEqual(f.staff[1].end, "18:30");
    assert.strictEqual(shown.staff[1].end, "18:30", "画面に他の人の変更が入る"); assert.strictEqual(shown.staff[0].start, "7:00", "自分の変更も残る");
    return "職員マスタで検証：相手の変更が画面に入り、自分の変更も保存";
  });

  await test("通信断中に編集 → アプリを閉じる → 再起動で自動再送し、その間の他の人の変更とも統合（障害D）", async () => {
    const s = new Server(); const a = client(s); a.kv.put("sheet:2026-11-02", sheetFrom(1, "mon")); await settle([a]);
    const ls = memLS(); const off = client(s, { offline: true, hang: true }, ls);
    off.kv.watch("sheet:2026-11-02", () => {});
    off.conn.fault.offline = false; const v0 = await off.kv.get("sheet:2026-11-02"); off.conn.fault.offline = true;
    v0.runs[1].note = "通信断中の編集"; v0.userAbsent[userIds[7]] = true; off.kv.put("sheet:2026-11-02", v0);
    v0.runs[3].time = "9:15"; off.kv.put("sheet:2026-11-02", v0);
    off.kv.flushLocal(); await sleep(15000);
    assert.ok(ls.keys("sg:ob:").length === 1, "値ごと端末に保存");
    const va = await a.kv.get("sheet:2026-11-02"); va.runs[10].note = "他の人の編集"; a.kv.put("sheet:2026-11-02", va); await settle([a]);
    const re = client(s, {}, ls);                                 // 端末ストレージだけを引き継いで再起動
    const shown = await re.kv.get("sheet:2026-11-02");
    assert.strictEqual(shown.runs[1].note, "通信断中の編集", "再起動直後の画面に未送信が重なる");
    await settle([re]);
    const f = s.val("sheet:2026-11-02");
    assert.strictEqual(f.runs[1].note, "通信断中の編集"); assert.strictEqual(f.runs[3].time, "9:15"); assert.strictEqual(f.userAbsent[userIds[7]], true); assert.strictEqual(f.runs[10].note, "他の人の編集");
    assert.strictEqual(ls.keys("sg:ob:").length, 0, "送信後は端末から消える");
    return "再起動後に自動再送、他の人の編集も残る";
  });

  await test("読込に失敗した日は保存しない（障害A：『読めない＝空』で上書きしない）", async () => {
    const s = new Server(); const a = client(s); const real = sheetFrom(2, "tue"); a.kv.put("sheet:2026-11-03", real); await settle([a]);
    const b = client(s, { readFail: true });
    const got = await b.kv.get("sheet:2026-11-03");
    assert.strictEqual(got, null); assert.ok(b.kv.loadFailed("sheet:2026-11-03"));
    b.kv.put("sheet:2026-11-03", E.emptySheet());                // アプリが空の表を作って保存しようとしても…
    await sleep(5000); b.conn.fault.readFail = false; b.kv.kick(); await sleep(5000);
    assert.strictEqual(s.val("sheet:2026-11-03").runs.length, real.runs.length, "サーバーの表は無傷");
    assert.strictEqual(b.kv.status().blocked, 1, "確認待ちとして保持");
    return `通信断の端末からの空の表は送られず、${real.runs.length}便そのまま。入力は確認待ちで保持`;
  });

  await test("書込の応答が30%消える環境で8人が交互に編集 → 二重登録0・欠落0", async () => {
    const s = new Server(); const a = client(s); a.kv.put("sheet:2026-11-04", sheetFrom(3, "wed")); await settle([a]);
    const cs = Array.from({ length: 8 }, () => client(s, { lostAck: 0.3 }));
    for (let round = 0; round < 3; round++) {
      const vals = await Promise.all(cs.map((c) => c.kv.get("sheet:2026-11-04")));
      cs.forEach((c, i) => { vals[i].blocks.push({ id: `L${round}_${i}`, kind: "block", time: "11:00", staffId: staffIds[i], label: `R${round}-${i}` }); c.kv.put("sheet:2026-11-04", vals[i]); });
      await settle(cs);
    }
    const f = s.val("sheet:2026-11-04"); const added = f.blocks.filter((b) => /^L\d_\d$/.test(b.id));
    assert.strictEqual(added.length, 24); assert.strictEqual(new Set(f.blocks.map((b) => b.id)).size, f.blocks.length);
    return "24/24件、重複0";
  });

  await test("書込が遅れて届く端末があっても他の人の変更を消さない", async () => {
    const s = new Server(); const a = client(s); a.kv.put("pattern:1", E.resolveSeedPattern(master, E.SEED_PATTERNS.mon)); await settle([a]);
    const slow = client(s, { slowSet: 9000 }); const others = Array.from({ length: 5 }, () => client(s));
    const v = await slow.kv.get("pattern:1"); v.runs[0].note = "遅い端末"; slow.kv.put("pattern:1", v); await sleep(1500);
    const vs = await Promise.all(others.map((c) => c.kv.get("pattern:1"))); others.forEach((c, i) => { vs[i].runs[i + 1].note = "通常" + i; c.kv.put("pattern:1", vs[i]); });
    await sleep(14000); slow.conn.fault.slowSet = 0; await settle([slow, ...others]);
    const f = s.val("pattern:1"); assert.strictEqual(f.runs[0].note, "遅い端末"); for (let i = 0; i < 5; i++) assert.strictEqual(f.runs[i + 1].note, "通常" + i);
    return "6人分すべて反映";
  });

  await test("大きなデータ（200KB超）も分割して保存・復元できる", async () => {
    const s = new Server(); const a = client(s);
    const big = JSON.parse(JSON.stringify(master)); big.memo = "あ".repeat(120000); a.kv.put("master", big); await settle([a]);
    const b = client(s); const got = await b.kv.get("master"); assert.ok(K.eq(got, big)); assert.ok(s.docs.has(`kvp/master~1~0`));
    got.staff[0].name = got.staff[0].name + "（改）"; b.kv.put("master", got); await settle([b]); assert.ok(K.eq(s.val("master"), got)); assert.ok(!s.docs.has(`kvp/master~1~0`), "古い分割は掃除");
    return "分割保存・読込・更新・旧分割の削除OK";
  });

  await test("3方向マージの基本性質（無関係な変更の共存・削除と変更の衝突では変更を残す・並べ替え）", async () => {
    const b = { runs: [{ id: "a", t: 1 }, { id: "b", t: 1 }, { id: "c", t: 1 }], x: { p: 1, q: 1 }, tags: ["x", "y"] };
    const m = { runs: [{ id: "c", t: 1 }, { id: "a", t: 2 }, { id: "b", t: 1 }], x: { p: 2, q: 1 }, tags: ["x", "y", "z"] };
    const t = { runs: [{ id: "a", t: 1 }, { id: "c", t: 1 }, { id: "d", t: 1 }], x: { p: 1, q: 3 }, tags: ["y"] };
    const r = K.merge3(b, m, t).value;
    const ids = r.runs.map((x) => x.id); assert.deepStrictEqual([...ids].sort(), ["a", "c", "d"]); assert.ok(ids.indexOf("c") < ids.indexOf("a"), "自分の並べ替え"); assert.ok(ids.indexOf("c") < ids.indexOf("d"), "相手の追加は相手の並びの位置"); assert.strictEqual(r.runs.find((x) => x.id === "a").t, 2);
    assert.deepStrictEqual(r.x, { p: 2, q: 3 }); assert.deepStrictEqual(r.tags, ["y", "z"]);
    const r2 = K.merge3({ runs: [{ id: "a", t: 1 }] }, { runs: [] }, { runs: [{ id: "a", t: 9 }] });
    assert.deepStrictEqual(r2.value.runs, [{ id: "a", t: 9 }]); assert.strictEqual(r2.conflicts.length, 1);
    return "並べ替え・追加・削除・項目別の統合・削除と変更の衝突（変更を残す）";
  });

  const ok = results.filter((r) => r.ok).length; console.log(`\n${ok}/${results.length} passed`);
  require("fs").writeFileSync(__dirname + "/results-kv.json", JSON.stringify(results, null, 1));
  process.exit(ok === results.length ? 0 : 1);
})();
