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
  const DEFAULT_CFG = {
    m: { title: "リベルタけやき坂とおり シフト表（男性職員）", need: DEFAULT_NEED, base: {
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
  const monthOf = (group, ym, saved) => saved || (SEED_MONTHS[`${group}:${ym}`] ? clone(SEED_MONTHS[`${group}:${ym}`]) : null);
  const cfgOf = (group, saved) => Object.assign(clone(DEFAULT_CFG[group] || DEFAULT_CFG.m), saved || {});
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
  // その日に入っている人（早・遅・日勤）
  const workers = (month, date) => new Set(entries(month, date).map((e) => e.n));
  const wishOf = (month, name, date) => (((month && month.wish) || {})[name] || {})[date] || "";
  // 休み＝その日にどこにも入っていない人（写真の「休み：」の行）
  const offList = (month, cfg, date) => (cfg.members || []).map((m) => m.name).filter((n) => !workers(month, date).has(n));
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
  // 穴に入れそうな人：その日まだ入っていない・希望休ではない（その曜日がいつも休みの人は後ろに）
  function candidates(month, cfg, date, kind) {
    const busy = workers(month, date), wd = wdOf(date);
    // その日に日勤の人（回せる人）を先に。次にその日入っていない人（その曜日のパターンが合う人が先）
    const dk = ((dayOf(month, date).d) || []).map((x) => splitName(x).n).filter((n) => n && !OFF_WISH[wishOf(month, n, date)] && !Object.values(dayOf(month, date)[kind] || {}).some((s) => slotName(s) === n));
    return dk.map((n) => `${n}(日勤から)`).concat((cfg.members || []).filter((m) => !busy.has(m.name) && !OFF_WISH[wishOf(month, m.name, date)])
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
    if (!hs.length) return `【${m}月のシフト${name}】\n今月は空いている枠はありません。ありがとうございます。`;
    const lines = Object.keys(byDate).sort().map((date) => {
      const list = byDate[date].map((h) => `${KIND[h.kind]}${MARK[h.idx] || h.idx}`).join("・");
      const who = o.withNames ? [...new Set(byDate[date].flatMap((h) => candidates(month, cfg, date, h.kind)))].slice(0, 4) : [];
      return `・${label(date)} ${list}${who.length ? `（入れそうな人：${who.map((n) => { const x = splitName(n); return x.n + "さん" + (x.t ? `(${x.t})` : ""); }).join("・")}）` : ""}`;
    });
    return [`【${m}月のシフト${name} 出勤のお願い】`, "次の日に空きがあります。出勤できる方はいませんか？", "", ...lines, "", "出勤できる方は、日付と「早・遅」を返信してください。", "よろしくお願いします。"].join("\n");
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
        const inK = new Set(Object.values(d[k]).map(slotName));
        if (b) for (let i = 1; i <= need[k]; i++) {   // まず基本シフトの人を同じ番号の枠へ
          const bx = splitName((b[k] || [])[i - 1]), n = bx.n;   // 「窪田(17~22)」のように時間つきでもよい
          if (!slotName(d[k][i]) && n && names.has(n) && !OFF_WISH[wishOf(out, n, date)] && !inK.has(n) && !d.d.some((x) => splitName(x).n === n)) { d[k][i] = bx.t ? { n, t: bx.t } : { n }; inK.add(n); }
        }
        const inD = (n) => (d.d || []).some((x) => splitName(x).n === n), inOther = (n) => Object.values(d[k === "e" ? "l" : "e"]).some((x) => slotName(x) === n);
        // 基本の人が入れない枠：①その曜日のパターンが合う人 ②その日に日勤の人を回す（男性11月の表の法則：希望休の穴はまず日勤の人が早・遅へ）
        const pool = (cfg.members || []).filter((m) => wantOf(m).includes(KIND[k]) && !inK.has(m.name) && !inD(m.name))
          .concat((cfg.members || []).filter((m) => wantOf(m) === "日" && !inK.has(m.name) && !inD(m.name) && !inOther(m.name)));
        for (let i = 1; i <= need[k] && pool.length; i++) if (!slotName(d[k][i])) { const m = pool.shift(); d[k][i] = { n: m.name }; inK.add(m.name); }
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
      for (let wd = 0; wd < 7; wd++) { ws.mergeCells(2, wd * 2 + 1, 2, wd * 2 + 2); const x = cell(2, wd * 2 + 1, `${WD[wd]}曜日`, { font: { bold: true, color: { argb: "FFFFFFFF" } }, align: { horizontal: "center" }, fill: wd === 0 ? "FFBE123C" : wd === 6 ? "FF1D4ED8" : "FF1E40AF" }); x.border = { top: med, bottom: med, left: med, right: med }; }
    }
    const days = daysOfMonth(ym), lead = wdOf(days[0]), cells = Array(lead).fill(null).concat(days);
    while (cells.length % 7) cells.push(null);
    let r = 3;
    for (let w = 0; w < cells.length; w += 7) {
      const week = cells.slice(w, w + 7);
      const rows = Math.max(1, ...week.filter(Boolean).map((d) => { const n = needOf(cfg, d), dd = dayOf(month, d); return Math.max(n.e, n.l, ...Object.keys(dd.e || {}).map(Number), ...Object.keys(dd.l || {}).map(Number)); }));
      const r0 = r, rEnd = r0 + rows + 2;
      // 日勤・休みの行は折り返す。高さは長い日に合わせる（2列分の幅に全角でおよそ13文字。名前が多い月でも切れない）
      const lines = (k) => Math.max(1, ...week.filter(Boolean).map((date) => { const t = k === "d" ? `日勤：${(dayOf(month, date).d || []).join("、")}` : `休み：${offList(month, cfg, date).join("、")}`; return Math.ceil(t.length / 13); }));
      week.forEach((date, wd) => {
        const c1 = wd * 2 + 1, c2 = c1 + 1;
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
  return { baseFor, weeksFrom, splitName, entries, monthOf, SEED_MONTHS, patOf, buildWorkbook, fileName, GROUPS, KIND, MARK, WD, WISHES, PAT, DEFAULT_NEED, DEFAULT_CFG, cfgOf, daysOfMonth, wdOf, label, slotName, needOf, workers, wishOf, offList, holes, conflicts, candidates, lineText, draft, wishSummary };
});
