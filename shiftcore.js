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
    m: { title: "リベルタけやき坂とおり シフト表（男性職員）", need: DEFAULT_NEED, members: [
      { name: "余村", pat: pat(["休", "休", "日", "早", "早", "日", "遅"]) },
      { name: "横田", pat: pat(["早", "日", "早", "早", "休", "休", "日"]) },
      { name: "秋山", pat: pat(["早", "遅", "休", "休", "早", "早", "早"]) },
      { name: "長島", pat: pat(["遅", "休", "遅", "遅", "遅", "休", "日"]) },
      { name: "近藤", pat: pat(["日", "日", "日", "休", "休", "日", "早"]) },
      { name: "宮永", pat: pat(["遅", "休", "休", "遅", "遅", "日", "遅"]) },
      { name: "橋本", pat: pat(["休", "早・遅", "早・遅", "早・遅", "早・遅", "早・遅", "休"]) },
      { name: "野津", pat: pat(["日", "早・遅", "早・遅", "休", "休", "早・遅", "日"]) },
    ] },
    f: { title: "リベルタけやき坂とおり シフト表（女性職員）", need: DEFAULT_NEED, members: [] },
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
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
  // その日に入っている人（早・遅・日勤）
  function workers(month, date) {
    const d = dayOf(month, date), out = new Set();
    for (const k of ["e", "l"]) for (const s of Object.values(d[k] || {})) if (slotName(s)) out.add(slotName(s));
    for (const n of d.d || []) if (n) out.add(n);
    return out;
  }
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
    for (const date of daysOfMonth(ym)) for (const n of workers(month, date)) { const w = wishOf(month, n, date); if (OFF_WISH[w]) out.push({ date, name: n, wish: w }); }
    return out;
  }
  // 穴に入れそうな人：その日まだ入っていない・希望休ではない（その曜日がいつも休みの人は後ろに）
  function candidates(month, cfg, date, kind) {
    const busy = workers(month, date), wd = wdOf(date);
    return (cfg.members || []).filter((m) => !busy.has(m.name) && !OFF_WISH[wishOf(month, m.name, date)])
      .map((m) => ({ m, ok: kindFits((m.pat || {})[wd], kind) ? 0 : 1 })).sort((a, b) => a.ok - b.ok).map((x) => x.m.name);
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
      return `・${label(date)} ${list}${who.length ? `（入れそうな人：${who.map((n) => n + "さん").join("・")}）` : ""}`;
    });
    return [`【${m}月のシフト${name} 出勤のお願い】`, "次の日に空きがあります。出勤できる方はいませんか？", "", ...lines, "", "出勤できる方は、日付と「早・遅」を返信してください。", "よろしくお願いします。"].join("\n");
  }
  // 基本パターン（下の表の曜日ごとの早・遅・日・休）と希望から、空いている枠だけを埋めた下書き。入っている枠は変えない
  function draft(month, cfg, ym) {
    const out = clone(month || {}); out.days = out.days || {};
    for (const date of daysOfMonth(ym)) {
      const wd = wdOf(date), need = needOf(cfg, date), d = (out.days[date] = Object.assign({ e: {}, l: {}, d: [] }, out.days[date] || {}));
      d.e = Object.assign({}, d.e); d.l = Object.assign({}, d.l); d.d = (d.d || []).slice();
      const wantOf = (m) => { const w = wishOf(out, m.name, date); if (OFF_WISH[w]) return ""; return w || String((m.pat || {})[wd] || "").split("(")[0]; };
      for (const k of ["e", "l"]) {
        const inK = new Set(Object.values(d[k]).map(slotName));
        const pool = (cfg.members || []).filter((m) => wantOf(m).includes(KIND[k]) && !inK.has(m.name) && !(d.d || []).includes(m.name));
        for (let i = 1; i <= need[k] && pool.length; i++) if (!slotName(d[k][i])) { const m = pool.shift(); d[k][i] = { n: m.name }; }
      }
      const busy = workers(out, date);
      for (const m of cfg.members || []) if (wantOf(m) === "日" && !busy.has(m.name)) d.d.push(m.name);
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
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(`${Number(ym.slice(5, 7))}月`, { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } } });
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
        ws.mergeCells(r0 + rows + 1, c1, r0 + rows + 1, c2); cell(r0 + rows + 1, c1, `日勤：${(d.d || []).join("、")}`, { font: { size: 9 } });
        ws.mergeCells(rEnd, c1, rEnd, c2); cell(rEnd, c1, `休み：${offList(month, cfg, date).join("、")}`, { font: { size: 9 } });
        box(r0, c1, rEnd, c2);
      });
      for (let rr = r0; rr <= rEnd; rr++) ws.getRow(rr).height = 16;
      r = rEnd + 1;
    }
    // 下の表：職員ごとの曜日のパターンと今月の希望
    r += 1;
    const head = ["職員", ...WD, "今月の希望休・希望勤務"];
    head.forEach((h, i) => { const c = i === 8 ? 9 : i + 1; const x = cell(r, c, h, { font: { bold: true }, align: { horizontal: "center" }, fill: "FFE0E7FF" }); x.border = { top: thin, bottom: thin, left: thin, right: thin }; });
    ws.mergeCells(r, 9, r, 14);
    for (const mm of cfg.members || []) {
      r++;
      const row = [mm.name, ...WD.map((_, wd) => String((mm.pat || {})[wd] || ""))];
      row.forEach((v, i) => { const x = cell(r, i + 1, v, { align: { horizontal: "center" }, font: /休/.test(v) && i ? { color: { argb: "FFEA580C" }, bold: true } : i ? {} : { bold: true } }); x.border = { top: thin, bottom: thin, left: thin, right: thin }; });
      ws.mergeCells(r, 9, r, 14); cell(r, 9, wishSummary(month, mm.name), { font: { size: 9 } }); for (let c = 9; c <= 14; c++) ws.getCell(r, c).border = { top: thin, bottom: thin, left: c === 9 ? thin : undefined, right: c === 14 ? thin : undefined };
    }
    ws.views = [{ showGridLines: false }];
    return wb;
  }
  const fileName = (ym, groupName) => `シフト表_${groupName || ""}_${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月.xlsx`;
  return { buildWorkbook, fileName, GROUPS, KIND, MARK, WD, WISHES, PAT, DEFAULT_NEED, DEFAULT_CFG, cfgOf, daysOfMonth, wdOf, label, slotName, needOf, workers, wishOf, offList, holes, conflicts, candidates, lineText, draft, wishSummary };
});
