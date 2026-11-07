// 共通部品（変更しないでください）。画面側と同じコードをサーバーでも使います
/* シフト表（マンション職員の早番・遅番）の共通部品。画面（gas/shift_app.js）とテストで同じコードを使う。
   1か月の文書：{ days: { "YYYY-MM-DD": { e:{"1":{n,t},…}, l:{…}, d:[名前…], note:"開所日" } },
                   wish: { 名前: { "YYYY-MM-DD": "休"|"AM休"|"PM休"|"早"|"遅"|"日" } }, wishNote: { 名前: "…" } }
   e=早番の枠（①②③）、l=遅番の枠、d=日勤。枠は {n:名前, t:"6~9"（時間の補足・任意）}。配列にせず番号の鍵で持つ（同時に別の枠を直しても混ざらない）
   設定：{ title, members:[{name, pat:{0:"休",1:"早",…,6:"日"}}], need:{0:{e:2,l:2},…} }（曜日 0=日〜6=土） */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SGShift = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const GROUPS = { m: "男性", f: "女性" };
  const KIND = { e: "早", l: "遅" };
  const MARK = ["", "①", "②", "③", "④", "⑤"];
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const WISHES = ["休", "AM休", "PM休", "早", "遅", "日"];
  const PAT = ["休", "早", "遅", "日", "早・遅"];
  const OFF_WISH = { "休": 1, "AM休": 1, "PM休": 1 };
  // 1日に要る枠の数（曜日ごと）。写真のシフト表（2026年11月・男性）から。画面の「設定」で変えられる
  const DEFAULT_NEED = { 0: { e: 2, l: 2 }, 1: { e: 2, l: 3 }, 2: { e: 3, l: 3 }, 3: { e: 3, l: 3 }, 4: { e: 3, l: 3 }, 5: { e: 3, l: 2 }, 6: { e: 2, l: 2 } };
  const pat = (a) => Object.fromEntries(a.map((v, i) => [i, v]));
  const HASHI_RULES = [{ n: "橋本", k: "e", cnt: 2, slot: 1 }, { n: "橋本", k: "e", cnt: 3, slot: 2 }, { n: "橋本", k: "l", cnt: 2, slot: 1 }, { n: "橋本", k: "l", cnt: 3, slot: 1 }];
  const DEFAULT_CFG = {
    m: { title: "リベルタけやき坂とおり シフト表（男性職員）", need: DEFAULT_NEED,
      // 職員ごとの決まり（2026-11-03 依頼者「橋本さんは遅番3人時には基本②」）。k=早e/遅l、cnt=その日の枠の数（空ならいつも）、slot=番号
      // 2026-11-07 依頼者「橋本は早番2名の時は基本①、早番3名の時は基本②、遅番2名の時は①、遅番3名の時も①」
      rules: HASHI_RULES, rulesV2: true, turnFree: ["野津", "橋本"],
      base: {
      // 基本シフト（曜日ごとに 早①②③・遅①②③・日勤 がだれか。2026-11-02 依頼者の表から。日曜の近藤さんは表に無く、紙のパターン（日）から日勤に）
      1: { e: ["橋本", "野津"], l: ["秋山", "橋本", "野津"], d: ["横田", "近藤"] },
      2: { e: ["横田", "橋本", "野津"], l: ["橋本", "長島", "野津"], d: ["余村慎", "近藤"] },
      3: { e: ["余村慎", "橋本", "横田"], l: ["橋本", "宮永", "長島"], d: [] },
      4: { e: ["余村慎", "橋本", "秋山"], l: ["橋本", "宮永", "長島"], d: [] },
      5: { e: ["秋山", "橋本", "野津"], l: ["橋本", "野津"], d: ["余村慎", "宮永", "近藤"] },
      6: { e: ["秋山", "近藤"], l: ["余村慎", "宮永"], d: ["横田", "野津", "長島"] },
      0: { e: ["横田", "秋山"], l: ["長島", "宮永"], d: ["野津", "近藤"] },
    }, members: [
      { name: "余村慎", pat: pat(["休", "休", "日", "早", "早", "日", "遅"]) },
      { name: "横田", pat: pat(["早", "日", "早", "早", "休", "休", "日"]) },
      { name: "秋山", pat: pat(["早", "遅", "休", "休", "早", "早", "早"]) },
      { name: "長島", pat: pat(["遅", "休", "遅", "遅", "遅", "休", "日"]) },
      { name: "近藤", pat: pat(["日", "日", "日", "休", "休", "日", "早"]) },
      { name: "宮永", pat: pat(["遅", "休", "休", "遅", "遅", "日", "遅"]) },
      { name: "橋本", pat: pat(["休", "早・遅", "早・遅", "早・遅", "早・遅", "早・遅", "休"]) },
      { name: "野津", pat: pat(["日", "早・遅", "早・遅", "休", "休", "早・遅", "日"]) },
    ] },
    // 女性（2026-11-02 依頼者の表。列は月〜日と読んだ。6-9＝早番、16-22＝遅番（いつもの時間なので補足なし）、17-22・17-20・9-18 は時間を添える）
    // 女性は早番・遅番の①〜③が1週ごとに1つずつずれる（rotate。基準の週＝rotateFrom の週の並びが表のとおり。2026-11-02 依頼者）
    f: { title: "リベルタけやき坂とおり シフト表（女性職員）", rotate: true, rotateFrom: "2026-11-02",
      need: { 0: { e: 3, l: 3 }, 1: { e: 3, l: 3 }, 2: { e: 3, l: 2 }, 3: { e: 3, l: 2 }, 4: { e: 2, l: 2 }, 5: { e: 3, l: 3 }, 6: { e: 3, l: 3 } },
      base: {
        1: { e: ["川島", "杉谷", "中谷"], l: ["森", "川谷", "青木"], d: [] },
        2: { e: ["窪田", "川島", "角"], l: ["森", "青木"], d: [] },
        3: { e: ["窪田", "杉谷", "中谷"], l: ["森", "角"], d: [] },
        4: { e: ["窪田", "杉谷"], l: ["森", "川谷"], d: [] },
        5: { e: ["窪田", "角", "中谷"], l: ["川島", "川谷", "青木"], d: [] },
        6: { e: ["杉谷", "角", "中谷"], l: ["窪田(17~22)", "川島(17~20)", "川谷(17~22)"], d: ["青木(9~18)"] },
        0: { e: ["川島", "杉谷", "中谷"], l: ["森(17~22)", "角(17~22)", "川谷(17~22)"], d: ["青木(9~18)"] },
      },
      members: ["窪田", "森", "川島", "杉谷", "角", "中谷", "川谷", "青木"].map((name) => ({ name, pat: {} })) },
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  /* 依頼者の紙のシフト表（2026年11月・男性）を最初から入れておく（2026-11-02 依頼者「今月の予定をカレンダーに組み込んで」）。
     サーバーにその月の表がまだ無いときだけ使う（一度保存すれば保存したものが使われる）。
     1日を「早:名前,名前|遅:…|日:…|休:…(印だけ)|注:開所日」で書く。名前(6~9) は時間の補足 */
  const SEED_SRC = {
    "m:2026-11": {
      days: {
        1: "早:秋山,横田|遅:長島,宮永|日:近藤,野津", 2: "早:橋本,野津|遅:宮永(16~22),橋本,野津|日:横田,近藤,秋山", 3: "早:横田,橋本,余村慎(6~9)|遅:橋本,長島,八壁(17~22)|注:開所日",
        4: "早:余村慎,橋本,横田|遅:橋本,宮永,長島", 5: "早:余村慎,橋本,秋山|遅:橋本,宮永,長島", 6: "早:秋山,余村慎(6~9),野津|遅:余村慎(16~22),野津|日:近藤(~13),宮永",
        7: "早:秋山,近藤|遅:余村慎,宮永|日:横田,長島,野津",
        8: "早:近藤,野津|遅:長島,宮永", 9: "早:橋本,野津|遅:近藤,橋本,野津|日:横田", 10: "早:横田,橋本,野津|遅:橋本,長島,野津|日:余村慎,近藤",
        11: "早:余村慎,橋本,宮永(6~9)|遅:橋本,宮永(17~22),長島", 12: "早:余村慎,橋本,秋山|遅:橋本,宮永,長島", 13: "早:秋山,横田(6~9),余村慎(6~9)|遅:宮永,余村慎(16~22)|日:近藤(~13)",
        14: "早:秋山,近藤|遅:余村慎,長島|日:横田",
        15: "早:秋山(6~9),横田|遅:長島,秋山(17~22)|日:近藤", 16: "早:橋本,横田|遅:秋山,橋本,近藤", 17: "早:横田,秋山(6~9),余村慎(6~9)|遅:秋山(17~22),長島,余村慎(16~22)|日:余村慎,近藤",
        18: "早:余村慎,橋本,横田|遅:橋本,宮永,長島", 19: "早:余村慎,橋本,秋山|遅:橋本,宮永,長島", 20: "早:秋山,橋本,野津|遅:橋本,野津|日:余村慎,近藤(~13),宮永",
        21: "早:秋山,近藤|遅:長島,野津|日:余村慎,横田,宮永|注:開所日",
        22: "早:秋山,横田|遅:長島,宮永|日:野津", 23: "早:橋本,秋山(6~9)|遅:近藤,橋本,余村慎(17~22)|日:横田,秋山|注:開所日", 24: "早:横田,橋本,野津|遅:橋本,長島,野津|日:余村慎,近藤",
        25: "早:余村慎,橋本,横田|遅:橋本,宮永,長島", 26: "早:余村慎(6~9),宮永(6~9),秋山|遅:余村慎(16~22),宮永(17~22),長島", 27: "早:秋山,橋本,野津|遅:橋本,野津|日:余村慎,近藤(~13),宮永",
        28: "早:秋山,近藤|遅:余村慎,宮永|日:横田,長島,野津",
        29: "早:野津,横田|遅:長島,秋山|日:近藤,宮永", 30: "早:橋本,野津|遅:秋山,橋本,野津|日:横田,近藤",
      },
      // 今月の希望休・希望勤務（紙の右下の欄）
      wish: { "余村慎": "3:休", "横田": "8:休,11:休", "秋山": "8:休,9:休,2:日,23:日,29:遅", "近藤": "22:休,6:PM休,13:PM休,20:PM休,27:PM休",
        "宮永": "14:休,15:休", "橋本": "6:休,13:休,17:休,26:休", "野津": "3:休,13:休,14:休,15:休,16:休,17:休,23:休" },
    },
  };
  function seedOf(key) {
    const src = SEED_SRC[key]; if (!src) return null;
    const ym = key.slice(2), out = { days: {}, wish: {} }, dd = (n) => `${ym}-${String(n).padStart(2, "0")}`;
    for (const [n, spec] of Object.entries(src.days)) {
      const d = { e: {}, l: {}, d: [] };
      for (const part of spec.split("|")) {
        const [k, v] = part.split(":"), list = (v || "").split(",").filter(Boolean);
        if (k === "早" || k === "遅") list.forEach((x, i) => { const s = /^(.+?)\((.+)\)$/.exec(x); d[k === "早" ? "e" : "l"][i + 1] = s ? { n: s[1], t: s[2] } : { n: x }; });
        else if (k === "日") d.d = list;
        else if (k === "注") d.note = v;
      }
      out.days[dd(n)] = d;
    }
    for (const [name, spec] of Object.entries(src.wish)) { out.wish[name] = {}; for (const x of spec.split(",")) { const [n, w] = x.split(":"); out.wish[name][dd(n)] = w; } }
    return out;
  }
  const SEED_MONTHS = Object.fromEntries(Object.keys(SEED_SRC).map((k) => [k, seedOf(k)]));
  // その月の表：保存されたものがあればそれ、なければ紙から写した最初の中身（無ければ空）
  // 紙の表は「遅番の次の日は早番にしない」で直したもの（2026-11-03 依頼者「シフト変更もしてください」。11/17 遅③ 余村慎→近藤（日勤から））
  const monthOf = (group, ym, saved) => saved || (SEED_MONTHS[`${group}:${ym}`] ? fixLateEarly(clone(SEED_MONTHS[`${group}:${ym}`]), cfgOf(group, null), ym).month : null);
  const cfgOf = (group, saved) => {
    const c = Object.assign(clone(DEFAULT_CFG[group] || DEFAULT_CFG.m), saved || {});
    // 以前の決まり（橋本 遅番3人のとき②だけ）のまま保存されている男性の表は、新しい決まりにする（1回だけ。設定で直した決まりはそのまま）
    if (group === "m" && saved && !saved.rulesV2) { if (!saved.rules || JSON.stringify(saved.rules) === JSON.stringify([{ n: "橋本", k: "l", cnt: 3, slot: 2 }])) c.rules = clone(HASHI_RULES); c.rulesV2 = true; }
    return c;
  };
  const pad = (n) => String(n).padStart(2, "0");
  // その月の日付（"YYYY-MM-DD"）。曜日は日付の文字から計算する（時差でずれないように UTC で）
  function daysOfMonth(ym) {
    const [y, m] = ym.split("-").map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${ym}-${pad(i + 1)}`);
  }
  const wdOf = (date) => new Date(date + "T00:00:00Z").getUTCDay();
  const label = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}(${WD[wdOf(date)]})`;
  const dayOf = (month, date) => ((month && month.days) || {})[date] || {};
  const slotName = (s) => (s && typeof s === "object" ? s.n : s) || "";
  const needOf = (cfg, date) => { const n = (cfg.need || DEFAULT_NEED)[wdOf(date)] || { e: 0, l: 0 }; return { e: Number(n.e) || 0, l: Number(n.l) || 0 }; };
  // 日勤は「近藤(~13)」のように時間を添えて書ける（紙のシフト表と同じ）。名前と時間に分ける
  const splitName = (x) => { const m = /^(.+?)\((.+)\)$/.exec(String(x || "").trim()); return m ? { n: m[1], t: m[2] } : { n: String(x || "").trim(), t: "" }; };
  // その日の割り当て（早・遅・日勤）を {n, t} の並びで
  function entries(month, date) {
    const d = dayOf(month, date), out = [];
    for (const k of ["e", "l"]) for (const s of Object.values(d[k] || {})) if (slotName(s)) out.push({ n: slotName(s), t: (s && s.t) || "" });
    for (const x of d.d || []) { const e = splitName(x); if (e.n) out.push(e); }
    return out;
  }
  // カレンダーに出す勤務（2026-11-07 依頼者「男性・女性のシフト表は全体カレンダーに自動で随時反映」）。1人1日1件：「余村慎 早番①」「橋本 早番②・遅番①」「近藤 日勤(9~18)」
  /* cfg を渡すと、基本シフト（曜日ごと）と同じ勤務の人は出さない（2026-11-07 依頼者「基本パターンから変更がある時のみ。余村 火曜は基本日勤だけど早番に変わったときに 余村 早番」）。
     比べるのは 早・遅・日勤 と時間の補足（①②③の番号は見ない＝女性の週ごとのずれは変更にしない）。基本では出る日に表に入っていなければ「名前 休み」（その日にだれかが入っているときだけ） */
  const sigOf = (list) => list.slice().sort().join("|");
  function baseSig(cfg, date, n) {
    const b = baseFor(cfg, date), out = [];
    if (b) { for (const k of ["e", "l"]) for (const x of b[k] || []) { const e = splitName(x); if (e.n === n) out.push(`${k}:${e.t}`); } for (const x of b.d || []) { const e = splitName(x); if (e.n === n) out.push(`d:${e.t}`); } return sigOf(out); }
    const m = (cfg.members || []).find((x) => x.name === n), p = m ? String((m.pat || {})[wdOf(date)] || "") : "";
    if (/早/.test(p)) out.push("e:"); if (/遅/.test(p)) out.push("l:"); if (p === "日") out.push("d:");
    return sigOf(out);
  }
  function calItems(month, ym, cfg) {
    const out = [];
    for (const date of daysOfMonth(ym)) {
      const d = dayOf(month, date), by = {}, order = [], sig = {};
      const put = (n, s) => { (sig[n] = sig[n] || []).push(s); };
      for (const k of ["e", "l"]) for (const sl of Object.values(d[k] || {})) { const n = slotName(sl); if (n) put(n, `${k}:${(sl && sl.t) || ""}`); }
      for (const x of d.d || []) { const e = splitName(x); if (e.n) put(e.n, `d:${e.t}`); }
      const add = (n, txt) => { if (!n) return; if (!by[n]) { by[n] = []; order.push(n); } by[n].push(txt); };
      for (const k of ["e", "l"]) for (const [i, sl] of Object.entries(d[k] || {}).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const n = slotName(sl), t = (sl && sl.t) || ""; add(n, `${KIND[k]}番${MARK[Number(i)] || ""}${t ? `(${t})` : ""}`);
      }
      for (const x of d.d || []) { const e = splitName(x); add(e.n, `日勤${e.t ? `(${e.t})` : ""}`); }
      for (const n of order) if (!cfg || sigOf(sig[n]) !== baseSig(cfg, date, n)) out.push({ date, name: n, title: `${n} ${by[n].join("・")}` });
      if (cfg && order.length) for (const m of cfg.members || []) if (!by[m.name] && baseSig(cfg, date, m.name)) out.push({ date, name: m.name, title: `${m.name} 休み` });
    }
    return out;
  }
  // その日に入っている人（早・遅・日勤）
  const workers = (month, date) => new Set(entries(month, date).map((e) => e.n));
  const wishOf = (month, name, date) => (((month && month.wish) || {})[name] || {})[date] || "";
  // 休み＝その日どこにも入っていない人。ただし早番・遅番・日勤など「出る」希望の人は休みに出さない（2026-11-07 依頼者「希望を早番にしたのに休みにも入っている」）
  const offList = (month, cfg, date) => (cfg.members || []).map((m) => m.name).filter((n) => !workers(month, date).has(n) && !(wishOf(month, n, date) && !OFF_WISH[wishOf(month, n, date)]));
  /* 自動でシフトを作る（2026-11-07 依頼者「希望が完了したらシフト作成を行ってほしい。そのボタン」）：
     基本パターンで下書き → 決まりどおりに並べ替え → 遅番の次の日の早番を替える → 残った空きに入れられる人（その日の日勤の人・空いている人）を入れる → もう一度決まりどおりに。
     手で入れた枠はそのまま（空いている枠だけ埋める）。希望休の人・遅番の次の日の早番は入れない */
  function autoShift(month, cfg, ym) {
    // 1. 希望の勤務（早番・遅番・日勤・ﾏﾝｼｮﾝのみ・時刻）を先に入れる（希望休は入れない）
    let m = clone(month || {}); m.days = m.days || {};
    const day = (date) => { const d = (m.days[date] = Object.assign({ e: {}, l: {}, d: [] }, m.days[date] || {})); d.e = Object.assign({}, d.e); d.l = Object.assign({}, d.l); d.d = (d.d || []).slice(); return d; };
    for (const date of daysOfMonth(ym)) for (const mb of cfg.members || []) {
      const w = wishOf(m, mb.name, date); if (!w || OFF_WISH[w] || workers(m, date).has(mb.name)) continue;
      const need = needOf(cfg, date), d = day(date), ks = ["e", "l"].filter((k) => w.includes(KIND[k]));
      if (!ks.length) { d.d.push(/^\d/.test(w) ? `${mb.name}(${w})` : mb.name); continue; }
      for (const k of ks) { const want = ruleSlot(cfg, mb.name, k, date); let i = want && !slotName(d[k][want]) ? want : 0;
        for (let x = need[k]; !i && x >= 1; x--) if (!slotName(d[k][x])) i = x;
        if (i) d[k][i] = { n: mb.name }; }
    }
    // 2. 基本シフトで下書き → 決まりの番号 → 遅番の次の日の早番を替える
    m = draft(m, cfg, ym); m = fixRules(m, cfg, ym); m = fixLateEarly(m, cfg, ym).month;
    // 3. 足りない枠：その日の日勤の人 → 早遅（その日の反対の番の人。野津・橋本さんを先に）→ 休日出勤（12日連続にならない人）。
    //    遅番の次の日の早番はさける（野津・橋本さんは除く）。どうしても入れない枠だけ、それを外してもう一度さがす
    const filled = [], free = new Set(cfg.turnFree || []);
    const turnNG = (n, date, k) => k === "e" ? lateBefore(m, date, n, cfg) : earlyAfter(m, date, n, cfg);
    const inKind_ = (date, k, n) => Object.values(dayOf(m, date)[k] || {}).some((x) => slotName(x) === n);
    const inDay = (date, n) => (dayOf(m, date).d || []).some((x) => splitName(x).n === n);
    const run = (n, date) => { let c = 1; for (let x = addDay(date, -1); workers(m, x).has(n); x = addDay(x, -1)) c++; for (let x = addDay(date, 1); workers(m, x).has(n); x = addDay(x, 1)) c++; return c; };
    const worked = (n) => daysOfMonth(ym).filter((x) => workers(m, x).has(n)).length;
    for (const h of holes(m, cfg, ym)) {
      const { date, kind: k } = h, other = k === "e" ? "l" : "e", wd = wdOf(date);
      const okW = (n) => n && !OFF_WISH[wishOf(m, n, date)] && !inKind_(date, k, n);
      let pick = null;
      for (const strict of [true, false]) {
        const ok = (n) => okW(n) && (!strict || !turnNG(n, date, k));
        const fromD = (dayOf(m, date).d || []).map((x) => splitName(x).n).find(ok);
        if (fromD) { pick = { n: fromD, how: "日勤から" }; break; }
        const dual = Object.values(dayOf(m, date)[other] || {}).map(slotName).filter(ok).sort((a, b) => (free.has(b) ? 1 : 0) - (free.has(a) ? 1 : 0))[0];
        if (dual) { pick = { n: dual, how: "早遅" }; break; }
        const hw = (cfg.members || []).map((x) => x.name).filter((n) => ok(n) && !workers(m, date).has(n) && run(n, date) < 12)
          .sort((a, b) => (kindFits(patOf(cfg, (cfg.members || []).find((x) => x.name === b), wd), k) ? 1 : 0) - (kindFits(patOf(cfg, (cfg.members || []).find((x) => x.name === a), wd), k) ? 1 : 0) || worked(a) - worked(b))[0];
        if (hw) { pick = { n: hw, how: "休日出勤" }; break; }
      }
      if (!pick) continue;
      const d = day(date); d[k][h.idx] = { n: pick.n };
      if (pick.how === "日勤から") d.d = d.d.filter((x) => splitName(x).n !== pick.n);
      filled.push({ date, kind: k, idx: h.idx, name: pick.n, how: pick.how, turn: turnNG(pick.n, date, k) });
    }
    m = fixRules(m, cfg, ym);
    return { month: m, filled, holes: holes(m, cfg, ym), conflicts: conflicts(m, cfg, ym), turns: lateEarly(m, cfg, ym) };
  }
  // 穴＝その曜日に要る枠のうち、だれも入っていない枠
  function holes(month, cfg, ym) {
    const out = [];
    for (const date of daysOfMonth(ym)) {
      const need = needOf(cfg, date), d = dayOf(month, date);
      for (const k of ["e", "l"]) for (let i = 1; i <= need[k]; i++) if (!slotName((d[k] || {})[i])) out.push({ date, kind: k, idx: i });
    }
    return out;
  }
  // 希望休なのに入っている人（希望とちがう）
  function conflicts(month, cfg, ym) {
    const out = [];
    // 「休」の希望なのに入っている／AM休・PM休なのに時間の補足なしで入っている（「近藤(~13)」のように時間を添えていればよい）
    for (const date of daysOfMonth(ym)) for (const n of workers(month, date)) {
      const w = wishOf(month, n, date); if (!OFF_WISH[w]) continue;
      if (w !== "休" && entries(month, date).filter((e) => e.n === n).every((e) => e.t)) continue;
      out.push({ date, name: n, wish: w });
    }
    return out;
  }
  // 職員ごとの決まり：その日・その種類でこの人が入る番号（決まりが無ければ 0）
  function ruleSlot(cfg, name, k, date) {
    const need = needOf(cfg, date)[k];
    const r = (cfg.rules || []).find((x) => x && x.n === name && x.k === k && (!Number(x.cnt) || Number(x.cnt) === need) && Number(x.slot) >= 1 && Number(x.slot) <= need);
    return r ? Number(r.slot) : 0;
  }
  const ruleText = (r) => `${r.n}さんは${KIND[r.k]}番${Number(r.cnt) ? `${r.cnt}人の日` : ""}は${MARK[r.slot] || r.slot}`;
  // 決まりとちがう（例：遅番3人の日に橋本さんが①）
  function ruleIssues(month, cfg, ym) {
    const out = [];
    for (const date of daysOfMonth(ym)) { const d = dayOf(month, date);
      for (const k of ["e", "l"]) for (const [i, x] of Object.entries(d[k] || {})) { const n = slotName(x), want = n && ruleSlot(cfg, n, k, date);
        if (want && want !== Number(i)) out.push({ date, name: n, kind: k, slot: want, now: Number(i) }); } }
    return out;
  }
  // 決まりどおりに並べ替える（決まりの番号の人と入れ替える。時間の補足も一緒に動く）
  function fixRules(month, cfg, ym) {
    const out = clone(month || {}); out.days = out.days || {};
    for (const x of ruleIssues(out, cfg, ym)) { const d = out.days[x.date], a = d[x.kind] = Object.assign({}, d[x.kind]);
      if (slotName(a[x.now]) !== x.name) continue;
      const y = a[x.slot]; a[x.slot] = a[x.now]; if (slotName(y)) a[x.now] = y; else delete a[x.now]; }
    return out;
  }
  // 遅番の次の日は早番にしない（2026-11-03 依頼者「基本、遅番の次の日は早番にならないように」）。
  // 基本シフトで早と遅の両方に入る曜日（橋本さん・野津さんの「早・遅」）の次の日は、依頼者の基本シフトどおりなので数えない
  const addDay = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const inKind = (month, date, k, n) => Object.values(dayOf(month, date)[k] || {}).some((s) => slotName(s) === n);
  // 遅番の次の日に早番でもよい人（2026-11-07 依頼者「野津・橋本を除いて」＝設定の turnFree）と、基本シフトで早・遅の両方の曜日
  const dualDay = (cfg, n, date) => { if ((cfg.turnFree || []).includes(n)) return true; const m = (cfg.members || []).find((x) => x.name === n); return !!m && patOf(cfg, m, wdOf(date)) === "早・遅"; };
  const lateBefore = (month, date, n, cfg) => { const p = addDay(date, -1); return inKind(month, p, "l", n) && !dualDay(cfg, n, p); };
  const earlyAfter = (month, date, n, cfg) => !dualDay(cfg, n, date) && inKind(month, addDay(date, 1), "e", n);
  function lateEarly(month, cfg, ym) {
    const out = [];
    for (const date of daysOfMonth(ym)) for (const [i, x] of Object.entries(dayOf(month, date).e || {})) { const n = slotName(x); if (n && lateBefore(month, date, n, cfg)) out.push({ date, name: n, slot: Number(i) }); }
    return out;
  }
  // 遅番の次の日の早番を、入れる人に替える（その日の日勤の人 → 早番のパターンの人。希望休・前の日が遅番の人は入れない）。替えられないものは left
  function fixLateEarly(month, cfg, ym) {
    const out = clone(month || {}); out.days = out.days || {}; const fixed = [], left = [];
    for (const x of lateEarly(out, cfg, ym)) {
      const d = out.days[x.date] = Object.assign({}, out.days[x.date]); d.e = Object.assign({}, d.e); d.d = (d.d || []).slice();
      const s = d.e[x.slot]; if (slotName(s) !== x.name) continue;
      const busy = workers(out, x.date), wd = wdOf(x.date), ok = (n) => n && !OFF_WISH[wishOf(out, n, x.date)] && !lateBefore(out, x.date, n, cfg) && !inKind(out, x.date, "e", n);
      const fromD = d.d.map((v) => splitName(v).n).find(ok);
      const other = fromD ? "" : ((cfg.members || []).find((m) => !busy.has(m.name) && ok(m.name) && /早/.test(patOf(cfg, m, wd))) || {}).name;
      const to = fromD || other;
      if (to) { if (fromD) d.d = d.d.filter((v) => splitName(v).n !== fromD);
        d.e[x.slot] = s.t ? { n: to, t: s.t } : { n: to }; fixed.push(Object.assign({}, x, { to, fromDay: !!fromD })); continue; }
      // 早番を替えられなければ、前の日の遅番を替える（前の日の日勤の人 → 遅番のパターンの人。次の日に早番の人は入れない）
      const p = addDay(x.date, -1), pd = out.days[p] = Object.assign({}, out.days[p]); pd.l = Object.assign({}, pd.l); pd.d = (pd.d || []).slice();
      const li = Object.keys(pd.l).find((i) => slotName(pd.l[i]) === x.name), ls = pd.l[li], pbusy = workers(out, p), pwd = wdOf(p);
      const okL = (n) => n && n !== x.name && !OFF_WISH[wishOf(out, n, p)] && !inKind(out, p, "l", n) && !inKind(out, x.date, "e", n);
      const fromPD = li ? pd.d.map((v) => splitName(v).n).find(okL) : "";
      const otherL = !li || fromPD ? "" : ((cfg.members || []).find((m) => !pbusy.has(m.name) && okL(m.name) && /遅/.test(patOf(cfg, m, pwd))) || {}).name;
      const toL = fromPD || otherL;
      if (!toL) { left.push(x); continue; }
      if (fromPD) pd.d = pd.d.filter((v) => splitName(v).n !== fromPD);
      pd.l[li] = ls && ls.t ? { n: toL, t: ls.t } : { n: toL };
      fixed.push(Object.assign({}, x, { late: { date: p, slot: Number(li), to: toL, fromDay: !!fromPD } }));
    }
    return { month: out, fixed, left };
  }
  // 穴に入れそうな人：その日まだ入っていない・希望休ではない（その曜日がいつも休みの人は後ろに）
  function candidates(month, cfg, date, kind) {
    const busy = workers(month, date), wd = wdOf(date);
    // その日に日勤の人（回せる人）を先に。次にその日入っていない人（その曜日のパターンが合う人が先）
    // 早番には前の日が遅番の人、遅番には次の日が早番の人は出さない（遅番の次の日は早番にしない）
    const turn = (n) => kind === "e" ? lateBefore(month, date, n, cfg) : earlyAfter(month, date, n, cfg);
    const dk = ((dayOf(month, date).d) || []).map((x) => splitName(x).n).filter((n) => n && !OFF_WISH[wishOf(month, n, date)] && !turn(n) && !Object.values(dayOf(month, date)[kind] || {}).some((s) => slotName(s) === n));
    return dk.map((n) => `${n}(日勤から)`).concat((cfg.members || []).filter((m) => !busy.has(m.name) && !OFF_WISH[wishOf(month, m.name, date)] && !turn(m.name))
      .map((m) => ({ m, ok: kindFits(patOf(cfg, m, wd), kind) ? 0 : 1 })).sort((a, b) => a.ok - b.ok).map((x) => x.m.name));
  }
  // 職員のその曜日のパターン（休・早・遅・日・早・遅）。基本シフトがあればそこから（早と遅の両方に入っていれば「早・遅」、どこにもいなければ「休」）
  function patOf(cfg, m, wd) {
    const b = cfg && cfg.base && cfg.base[wd];
    if (!b) return String(((m && m.pat) || {})[wd] || "");
    const n = m.name, has = (a) => (a || []).some((x) => splitName(x).n === n), inE = has(b.e), inL = has(b.l);
    return inE && inL ? "早・遅" : inE ? "早" : inL ? "遅" : has(b.d) ? "日" : "休";
  }
  // その日の基本シフト。1週ごとにずらす表は、基準の週から何週目かだけ ①→②→③→① と1つずつ送る（月曜はじまりの週）
  const mondayOf = (date) => { const t = Date.parse(date + "T00:00:00Z"), wd = new Date(t).getUTCDay(); return t - ((wd + 6) % 7) * 864e5; };
  function weeksFrom(cfg, date) { if (!cfg.rotate || !cfg.rotateFrom) return 0; return Math.round((mondayOf(date) - mondayOf(cfg.rotateFrom)) / (7 * 864e5)); }
  const rotate = (a, k) => { const n = (a || []).length; if (!n) return []; const r = ((k % n) + n) % n; return a.slice(n - r).concat(a.slice(0, n - r)); };
  function baseFor(cfg, date) {
    const b = (cfg.base || {})[wdOf(date)]; if (!b) return null;
    const k = weeksFrom(cfg, date);
    return k ? Object.assign({}, b, { e: rotate(b.e, k), l: rotate(b.l, k) }) : b;
  }
  const kindFits = (p, kind) => String(p || "").split("(")[0].includes(KIND[kind] || "?");
  // LINEに貼る文（穴の日ごとに1行）
  function lineText(month, cfg, ym, opts) {
    const o = opts || {}, hs = holes(month, cfg, ym), byDate = {};
    for (const h of hs) (byDate[h.date] = byDate[h.date] || []).push(h);
    const m = Number(ym.slice(5, 7)), name = o.groupName ? `（${o.groupName}）` : "";
    // 遅番の次の日の早番で、替わる人が見つからないもの（替わってくれる人を聞く）
    const le = fixLateEarly(month, cfg, ym).left, who4 = (date, k) => o.withNames ? candidates(month, cfg, date, k).slice(0, 4) : [];
    const nm = (w) => w.length ? `（入れそうな人：${w.map((n) => { const x = splitName(n); return x.n + "さん" + (x.t ? `(${x.t})` : ""); }).join("・")}）` : "";
    const leLines = le.map((x) => { const s = (dayOf(month, x.date).e || {})[x.slot]; return `・${label(x.date)} 早${MARK[x.slot] || x.slot}${s && s.t ? `(${s.t})` : ""}　${x.name}さんが前の日遅番のため${nm(who4(x.date, "e"))}`; });
    const leBlock = leLines.length ? ["", "次の早番を替わってくれる方はいませんか？（前の日が遅番の人が入っています）", ...leLines] : [];
    if (!hs.length && leLines.length) return [`【${m}月のシフト${name} 早番の交代のお願い】`, ...leBlock.slice(1), "", "替われる方は、日付を返信してください。", "よろしくお願いします。"].join("\n");
    if (!hs.length) return `【${m}月のシフト${name}】\n今月は空いている枠はありません。ありがとうございます。`;
    const lines = Object.keys(byDate).sort().map((date) => {
      const list = byDate[date].map((h) => `${KIND[h.kind]}${MARK[h.idx] || h.idx}`).join("・");
      const who = o.withNames ? [...new Set(byDate[date].flatMap((h) => candidates(month, cfg, date, h.kind)))].slice(0, 4) : [];
      return `・${label(date)} ${list}${who.length ? `（入れそうな人：${who.map((n) => { const x = splitName(n); return x.n + "さん" + (x.t ? `(${x.t})` : ""); }).join("・")}）` : ""}`;
    });
    return [`【${m}月のシフト${name} 出勤のお願い】`, "次の日に空きがあります。出勤できる方はいませんか？", "", ...lines, ...leBlock, "", "出勤できる方は、日付と「早・遅」を返信してください。", "よろしくお願いします。"].join("\n");
  }
  // 基本シフト（曜日ごとの ①②③ の担当）と希望から、空いている枠だけを埋めた下書き。入っている枠は変えない。
  // 基本の人が希望休などで入れない枠は、その曜日のパターンが合う人で埋め、それでも残れば空き（LINE文に出る）
  function draft(month, cfg, ym) {
    const out = clone(month || {}); out.days = out.days || {};
    for (const date of daysOfMonth(ym)) {
      const wd = wdOf(date), need = needOf(cfg, date), d = (out.days[date] = Object.assign({ e: {}, l: {}, d: [] }, out.days[date] || {}));
      d.e = Object.assign({}, d.e); d.l = Object.assign({}, d.l); d.d = (d.d || []).slice();
      const wantOf = (m) => { const w = wishOf(out, m.name, date); if (OFF_WISH[w]) return ""; return w || patOf(cfg, m, wd).split("(")[0]; };
      const b = baseFor(cfg, date), names = new Set((cfg.members || []).map((m) => m.name));
      for (const k of ["e", "l"]) {
        const inK = new Set(Object.values(d[k]).map(slotName)), placed = new Set();
        if (b) for (let i = 1; i <= need[k]; i++) {   // まず基本シフトの人を同じ番号の枠へ
          const bx = splitName((b[k] || [])[i - 1]), n = bx.n;   // 「窪田(17~22)」のように時間つきでもよい
          if (!slotName(d[k][i]) && n && names.has(n) && !OFF_WISH[wishOf(out, n, date)] && !inK.has(n) && !d.d.some((x) => splitName(x).n === n) && !(k === "e" ? lateBefore(out, date, n, cfg) : earlyAfter(out, date, n, cfg))) { d[k][i] = bx.t ? { n, t: bx.t } : { n }; inK.add(n); placed.add(i); }
        }
        const inD = (n) => (d.d || []).some((x) => splitName(x).n === n), inOther = (n) => Object.values(d[k === "e" ? "l" : "e"]).some((x) => slotName(x) === n);
        // 基本の人が入れない枠：①その曜日のパターンが合う人 ②その日に日勤の人を回す（男性11月の表の法則：希望休の穴はまず日勤の人が早・遅へ）
        const turn = (n) => k === "e" ? lateBefore(out, date, n, cfg) : earlyAfter(out, date, n, cfg);   // 遅番の次の日は早番にしない
        const pool = (cfg.members || []).filter((m) => wantOf(m).includes(KIND[k]) && !inK.has(m.name) && !inD(m.name) && !turn(m.name))
          .concat((cfg.members || []).filter((m) => wantOf(m) === "日" && !inK.has(m.name) && !inD(m.name) && !inOther(m.name) && !turn(m.name)));
        for (let i = 1; i <= need[k] && pool.length; i++) if (!slotName(d[k][i])) { const m = pool.shift(); d[k][i] = { n: m.name }; inK.add(m.name); placed.add(i); }
        // 職員ごとの決まりの番号へ（下書きで入れた枠どうし・空いた枠とだけ入れ替える。手で入れた枠は動かさない）
        for (const i of [...placed]) { const x = d[k][i], want = ruleSlot(cfg, slotName(x), k, date);
          if (want && want !== i && (placed.has(want) || !slotName(d[k][want]))) { const y = d[k][want]; d[k][want] = x; if (slotName(y)) d[k][i] = y; else delete d[k][i]; placed.add(want); } }
      }
      const busy = workers(out, date);
      for (const m of cfg.members || []) if (wantOf(m) === "日" && !busy.has(m.name)) d.d.push(((b && b.d) || []).find((x) => splitName(x).n === m.name) || m.name);   // 「青木(9~18)」の時間も
    }
    return out;
  }
  // 今月の希望をまとめた文（写真の「今月の希望休・希望勤務」の列）
  function wishSummary(month, name) {
    const w = ((month && month.wish) || {})[name] || {}, by = {};
    for (const date of Object.keys(w).sort()) if (w[date]) (by[w[date]] = by[w[date]] || []).push(`${Number(date.slice(8))}(${WD[wdOf(date)]})`);
    const note = (((month && month.wishNote) || {})[name] || "").trim();
    return [...Object.keys(by).map((k) => `${by[k].join("・")}：${k}`), note].filter(Boolean).join("　") || "なし";
  }
  /* Excel（紙のシフト表と同じカレンダーの形）。曜日ごとに2列（早・遅）、1週ごとに 日付・①〜③・日勤・休み の行。下に職員の曜日のパターンと今月の希望。A4横で1枚の幅に収める */
  function buildWorkbook(ExcelJS, month, cfg, ym, groupName) {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(`${Number(ym.slice(5, 7))}月`, { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } } });
    const thin = { style: "thin", color: { argb: "FF6B7BBF" } }, med = { style: "medium", color: { argb: "FF1E3A8A" } };
    const RED = "FFC2410C", BLUE = "FF1E40AF", GRAY = "FFF1F5F9", HOLE = "FFFEF3C7";
    for (let c = 1; c <= 14; c++) ws.getColumn(c).width = 12.5;
    const cell = (r, c, v, o) => { const x = ws.getCell(r, c); x.value = v; x.font = Object.assign({ name: "Meiryo UI", size: 10 }, (o && o.font) || {}); x.alignment = Object.assign({ vertical: "middle", wrapText: false }, (o && o.align) || {}); if (o && o.fill) x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: o.fill } }; return x; };
    const box = (r1, c1, r2, c2) => { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const x = ws.getCell(r, c); x.border = { top: r === r1 ? med : undefined, bottom: r === r2 ? med : undefined, left: c === c1 ? med : thin, right: c === c2 ? med : thin }; } };
    const [y, m] = ym.split("-").map(Number);
    ws.mergeCells(1, 1, 1, 14); cell(1, 1, `${y}年${m}月　${cfg.title || ("シフト表" + (groupName ? `（${groupName}）` : ""))}`, { font: { bold: true, size: 14 } }); ws.getRow(1).height = 24;
    {
      for (let ci = 0; ci < 7; ci++) { const wd = (ci + 1) % 7; ws.mergeCells(2, ci * 2 + 1, 2, ci * 2 + 2); const x = cell(2, ci * 2 + 1, `${WD[wd]}曜日`, { font: { bold: true, color: { argb: "FFFFFFFF" } }, align: { horizontal: "center" }, fill: wd === 0 ? "FFBE123C" : wd === 6 ? "FF1D4ED8" : "FF1E40AF" }); x.border = { top: med, bottom: med, left: med, right: med }; }
    }
    const days = daysOfMonth(ym), lead = (wdOf(days[0]) + 6) % 7, cells = Array(lead).fill(null).concat(days);   // 月曜始まり（2026-11-07 依頼者）
    while (cells.length % 7) cells.push(null);
    let r = 3;
    for (let w = 0; w < cells.length; w += 7) {
      const week = cells.slice(w, w + 7);
      const rows = Math.max(1, ...week.filter(Boolean).map((d) => { const n = needOf(cfg, d), dd = dayOf(month, d); return Math.max(n.e, n.l, ...Object.keys(dd.e || {}).map(Number), ...Object.keys(dd.l || {}).map(Number)); }));
      const r0 = r, rEnd = r0 + rows + 2;
      // 日勤・休みの行は折り返す。高さは長い日に合わせる（2列分の幅に全角でおよそ13文字。名前が多い月でも切れない）
      const lines = (k) => Math.max(1, ...week.filter(Boolean).map((date) => { const t = k === "d" ? `日勤：${(dayOf(month, date).d || []).join("、")}` : `休み：${offList(month, cfg, date).join("、")}`; return Math.ceil(t.length / 13); }));
      week.forEach((date, ci) => {
        const wd = date ? wdOf(date) : (ci + 1) % 7, c1 = ci * 2 + 1, c2 = c1 + 1;   // ci＝列（月曜から）、wd＝曜日（色に使う）
        if (!date) { for (let rr = r0; rr <= rEnd; rr++) { cell(rr, c1, "", { fill: GRAY }); cell(rr, c2, "", { fill: GRAY }); } box(r0, c1, rEnd, c2); return; }
        const d = dayOf(month, date), need = needOf(cfg, date), dd = d.note ? `　${d.note}` : "";
        ws.mergeCells(r0, c1, r0, c2); cell(r0, c1, `${Number(date.slice(8))}${dd}`, { font: { bold: true, color: { argb: wd === 0 ? "FFBE123C" : wd === 6 ? "FF1D4ED8" : "FF18201D" } }, align: { horizontal: "center" } });
        for (let i = 1; i <= rows; i++) for (const [k, c] of [["e", c1], ["l", c2]]) {
          const sl = (d[k] || {})[i], n = slotName(sl), req = i <= need[k];
          if (!n && !req) { cell(r0 + i, c, ""); continue; }
          cell(r0 + i, c, { richText: [{ text: `${KIND[k]}${MARK[i] || i}：`, font: { name: "Meiryo UI", size: 10, bold: true, color: { argb: k === "e" ? RED : BLUE } } }, { text: n ? n + (sl && sl.t ? `(${sl.t})` : "") : "空き", font: { name: "Meiryo UI", size: 10, bold: !n, color: { argb: n ? "FF18201D" : "FF92400E" } } }] }, Object.assign({ align: { shrinkToFit: true } }, n ? {} : { fill: HOLE }));   // 長い名前・時間は文字を小さくして枠に収める
        }
        ws.mergeCells(r0 + rows + 1, c1, r0 + rows + 1, c2); cell(r0 + rows + 1, c1, `日勤：${(d.d || []).join("、")}`, { font: { size: 9 }, align: { wrapText: true, vertical: "top" } });
        ws.mergeCells(rEnd, c1, rEnd, c2); cell(rEnd, c1, `休み：${offList(month, cfg, date).join("、")}`, { font: { size: 9 }, align: { wrapText: true, vertical: "top" } });
        box(r0, c1, rEnd, c2);
      });
      for (let rr = r0; rr <= rEnd; rr++) ws.getRow(rr).height = 16;
      ws.getRow(r0 + rows + 1).height = 13 * lines("d") + 3; ws.getRow(rEnd).height = 13 * lines("off") + 3;
      r = rEnd + 1;
    }
    // 下の表：職員ごとの曜日のパターンと今月の希望
    r += 1;
    const head = ["職員", ...WD, "今月の希望休・希望勤務"];
    head.forEach((h, i) => { const c = i === 8 ? 9 : i + 1; const x = cell(r, c, h, { font: { bold: true }, align: { horizontal: "center" }, fill: "FFE0E7FF" }); x.border = { top: thin, bottom: thin, left: thin, right: thin }; });
    ws.mergeCells(r, 9, r, 14);
    for (const mm of cfg.members || []) {
      r++;
      const row = [mm.name, ...WD.map((_, wd) => patOf(cfg, mm, wd))];
      row.forEach((v, i) => { const x = cell(r, i + 1, v, { align: { horizontal: "center" }, font: /休/.test(v) && i ? { color: { argb: "FFEA580C" }, bold: true } : i ? {} : { bold: true } }); x.border = { top: thin, bottom: thin, left: thin, right: thin }; });
      ws.mergeCells(r, 9, r, 14); cell(r, 9, wishSummary(month, mm.name), { font: { size: 9 } }); for (let c = 9; c <= 14; c++) ws.getCell(r, c).border = { top: thin, bottom: thin, left: c === 9 ? thin : undefined, right: c === 14 ? thin : undefined };
    }
    ws.views = [{ showGridLines: false }];
    return wb;
  }
  const fileName = (ym, groupName) => `シフト表_${groupName || ""}_${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月.xlsx`;
  return { autoShift, calItems, daysOfMonth, lateEarly, fixLateEarly, fixRules, ruleSlot, ruleText, ruleIssues, baseFor, weeksFrom, splitName, entries, monthOf, SEED_MONTHS, patOf, buildWorkbook, fileName, GROUPS, KIND, MARK, WD, WISHES, PAT, DEFAULT_NEED, DEFAULT_CFG, cfgOf, daysOfMonth, wdOf, label, slotName, needOf, workers, wishOf, offList, holes, conflicts, candidates, lineText, draft, wishSummary };
});
