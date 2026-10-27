/* 送迎表のExcel出力：どの版で出したかが、表（一番下の行・印刷の右上）とファイル名に入る */
"use strict";
global.window = {};
const assert = require("assert");
const E = require("./eng.cjs");
const ExcelJS = require("./pw/node_modules/exceljs");
(async () => {
  const m = E.mergeSeedMaster(null, E.seedMaster());
  const p = E.resolveSeedPattern(m, E.SEED_PATTERNS.mon);
  const sheet = Object.assign(E.emptySheet(), { runs: p.runs, blocks: p.blocks });
  const date = "2026-11-02";
  assert.strictEqual(E.appVerLabel(), "Ver293", "ログイン前（Google版の版が分からない）");
  global.window.SGHost = { me: { version: "2026.10.27f" } };
  const ver = E.appVerLabel(); assert.strictEqual(ver, "Ver293(2026.10.27f)");
  const wb = E.buildWorkbook(ExcelJS, m, sheet, date);
  E.buildWorkbook(ExcelJS, m, sheet, date, { wb, sheetName: "送迎表(ヘルプ車なし)", hideHelpVeh: true, gridOnly: true });
  // いったんファイルにして読み直す（Excelで開ける形か）
  const back = new ExcelJS.Workbook(); await back.xlsx.load(await wb.xlsx.writeBuffer());
  for (const name of ["送迎表", "送迎表(ヘルプ車なし)"]) {
    const ws = back.getWorksheet(name); assert.ok(ws, name);
    const last = ws.getRow(ws.rowCount).getCell(1).value;
    assert.ok(String(last).includes("送迎表 " + ver) && String(last).includes("2026-11-02(月)"), name + " の一番下: " + last);
    assert.ok(ws.headerFooter.oddHeader.includes(ver), name + " の印刷の右上: " + ws.headerFooter.oddHeader);
    console.log(name, "→", last, "／印刷:", ws.headerFooter.oddHeader);
  }
  assert.ok(back.getWorksheet("車両の動き"), "車両の動きのシートはそのまま");
  // 予備の簡易形式(.xls)
  assert.ok(E.buildExcelHtml(m, sheet, date).includes(ver), ".xls の見出しにも");
  // ファイル名に使う文字（Windowsで使えない文字が入らない）
  assert.ok(!/[\\/:*?"<>|]/.test(ver), "ファイル名に使える");
  console.log("excel OK");
})().catch((e) => { console.error(e); process.exit(1); });
