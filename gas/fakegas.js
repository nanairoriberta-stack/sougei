/* Google Apps Script の模擬環境：SpreadsheetApp・LockService・CacheService・Utilities などを最小限で再現し、
   本番と同じ .gs ファイルをそのまま読み込んで動かす */
"use strict";
const vm = require("vm"), fs = require("fs"), crypto = require("crypto");

function makeGas(files) {
  const sheets = new Map();
  const stats = { reads: 0, writes: 0, formulaErrors: [] };
  /* Googleスプレッドシートが文字列を書き込むときの自動変換を再現する
     ・先頭が ' → 文字列のまま（' は消える）
     ・数字だけ → 数値（先頭の0は消える） ・TRUE/FALSE → 真偽値 ・2026-11-02 → 日付
     ・= + - で始まる（数値でない）→ 数式として解釈され #ERROR! になる */
  function norm(v) {
    if (typeof v !== "string") return v;
    if (v.startsWith("'")) return v.slice(1);
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v.trim())) return Number(v);
    if (/^(true|false)$/i.test(v.trim())) return /^true$/i.test(v.trim());
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v.trim())) { const [y, m, d] = v.trim().split("-").map(Number); return new Date(y, m - 1, d); }
    if (/^[=+\-]/.test(v)) { stats.formulaErrors.push(v.slice(0, 40)); return "#ERROR!"; }
    return v;
  }
  function Sheet(name) {
    const data = []; let hidden = false, maxCols = 26;
    const cell = (r, c) => (data[r - 1] && data[r - 1][c - 1] !== undefined ? data[r - 1][c - 1] : "");
    const set = (r, c, v) => { while (data.length < r) data.push([]); data[r - 1][c - 1] = norm(v); if (c > maxCols) throw new Error("列が足りません"); };
    const self = {
      name, data,
      getLastRow: () => { for (let i = data.length; i > 0; i--) if (data[i - 1].some((x) => x !== "" && x !== undefined)) return i; return 0; },
      getLastColumn: () => Math.max(0, ...data.map((r) => r.length)),
      getMaxColumns: () => maxCols,
      insertColumnsAfter: (_, n) => { maxCols += n; },
      setFrozenRows() {}, hideSheet() { hidden = true; },
      appendRow: (vals) => { stats.writes++; const r = self.getLastRow() + 1; if (vals.length > maxCols) maxCols = vals.length; vals.forEach((v, i) => set(r, i + 1, v)); },
      getRange: (r, c, nr, nc) => {
        nr = nr || 1; nc = nc || 1;
        if (nc + c - 1 > 18278) throw new Error("range");
        return {
          getValues: () => (stats.reads++, Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j)))),
          setValues: (vals) => { stats.writes++; if (vals.length !== nr || vals[0].length !== nc) throw new Error(`setValues の大きさが範囲と合いません ${vals.length}x${vals[0].length} vs ${nr}x${nc}`); vals.forEach((row, i) => row.forEach((v, j) => { if (typeof v === "string" && v.length > 50000) throw new Error("セルの上限(5万字)を超えました"); set(r + i, c + j, v); })); },
          getValue: () => (stats.reads++, cell(r, c)), setValue: (v) => { stats.writes++; set(r, c, v); },
        };
      },
    };
    return self;
  }
  const ss = { getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => { const s = Sheet(n); sheets.set(n, s); return s; } };
  const cache = new Map();
  const ctx = {
    console, JSON, Date, Math, Object, Array, String, Number, Set, Map, RegExp, Error, Promise, Boolean, encodeURIComponent,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { if (String(v).length > 100000) throw new Error("cache too big"); cache.set(k, String(v)); },
      getAll: (ks) => Object.fromEntries(ks.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)])), putAll: (o) => { for (const k in o) cache.set(k, String(o[k])); }, remove: (k) => cache.delete(k),
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (alg, s) => [...crypto.createHash("sha256").update(String(s), "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString("base64"),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); return p; },
    },
    ContentService: { MimeType: { JSON: "application/json", TEXT: "text/plain" }, createTextOutput: (t) => { const o = { text: String(t == null ? "" : t), mime: "text/plain", setMimeType(m) { o.mime = m; return o; }, getContent: () => o.text }; return o; } },
    Session: { getScriptTimeZone: () => "Asia/Tokyo" },
    Logger: { log() {} },
    ScriptApp: { getService: () => ({ getUrl: () => "https://script.google.com/macros/s/TEST/exec" }) },
    HtmlService: (() => { const out = (html) => { const o = { html, title: "", setTitle(t) { o.title = t; return o; }, addMetaTag() { return o; }, setXFrameOptionsMode(m) { o.xfo = m; return o; }, getContent: () => html }; return o; };
      return { XFrameOptionsMode: { DEFAULT: 1, ALLOWALL: 2 }, createHtmlOutputFromFile: (n) => out(fs.readFileSync(require("path").join(__dirname, "out", n + ".html"), "utf8")), createHtmlOutput: out }; })(),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
  return { ctx, sheets, cache, stats };
}
module.exports = { makeGas };
