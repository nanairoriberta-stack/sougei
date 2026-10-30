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
  { // PM休（12:30まで）の職員：12:00のコマに「退勤」、12:30からは灰色。AM休（13:30から）の職員：13:00までは灰色
    const st1 = m.staff.find((x) => x.name === "八壁"), st2 = m.staff.find((x) => x.name === "日野");
    const dm = E.applyDayDept(m, 1, null, null, null, date);
    const sh2 = Object.assign({}, sheet, { staffOv: { [st1.id]: { end: "12:30" }, [st2.id]: { start: "13:30" } } });
    const wb2 = E.buildWorkbook(ExcelJS, dm, sh2, date); const b2 = new ExcelJS.Workbook(); await b2.xlsx.load(await wb2.xlsx.writeBuffer());
    const ws = b2.getWorksheet("送迎表"); let col1 = 0, col2 = 0, row12 = 0, row1230 = 0, row13 = 0;
    ws.eachRow((row, rn) => row.eachCell((c, cn) => { const v = String(c.value || ""); if (v === st1.name) col1 = cn; if (v === st2.name) col2 = cn; if (cn === 1 && v === "12:00") row12 = rn; if (cn === 1 && v === "13:00") row13 = rn; }));
    row1230 = row12 + 1;
    assert.ok(col1 && col2 && row12 && row13, "表の位置");
    assert.ok(String(ws.getRow(row12).getCell(col1).value || "").includes("退勤"), "PM休：12:00に退勤");
    const fillOf = (r, c) => ((ws.getRow(r).getCell(c).fill || {}).fgColor || {}).argb;
    assert.strictEqual(fillOf(row1230, col1), "FFF5F5F4", "PM休：12:30からは灰色"); assert.notStrictEqual(fillOf(row12, col1), "FFF5F5F4");
    assert.strictEqual(fillOf(row13, col2), "FFF5F5F4", "AM休：13:00は灰色"); assert.notStrictEqual(fillOf(row13 + 1, col2), "FFF5F5F4", "AM休：13:30から白");
    console.log("PM休・AM休のExcel OK");
  }
  console.log("excel OK");
})().catch((e) => { console.error(e); process.exit(1); });
// ===== 井上入浴・黒田入浴は同じ時刻の井上ヘルプ・黒田ヘルプにそろえる（2026-10-29） =====
{
 const assert=require('assert'); const E2=require('./eng.cjs');
 assert.strictEqual(E2.canonHelpLabel('井上入浴'),'井上ヘルプ'); assert.strictEqual(E2.canonHelpLabel('黒田入浴ヘルプ'),'黒田ヘルプ');
 assert.strictEqual(E2.canonHelpLabel('黒田入浴'),'黒田ヘルプ'); assert.strictEqual(E2.canonHelpLabel('赤山入浴(津田)'),'赤山入浴(津田)','ほかの人はそのまま');
 const bl=E2.canonHelpBlocks([{kind:'help',label:'井上入浴',time:'17:00'},{kind:'block',label:'黒田入浴',time:'16:00'},{kind:'help',label:'藤井入浴'}]);
 assert.deepStrictEqual(bl.map(b=>b.label),['井上ヘルプ','黒田入浴','藤井入浴']);
 const m0=E2.mergeSeedMaster(null,E2.seedMaster()); const m1=JSON.parse(JSON.stringify(m0));
 m1.rules=Object.assign({},m1.rules,{helpBase:[{label:'井上ヘルプ',time:'17:00',byDay:{1:'井川'}},{label:'井上入浴',time:'17:00',byDay:{1:'近藤',3:'安部・井川'}}]});
 const hb=E2.rulesOf(m1).helpBase; assert.strictEqual(hb.length,1); assert.deepStrictEqual(hb[0].byDay,{1:'井川・近藤',3:'安部・井川'},'ヘルプ表の行もまとまる');
 // 木曜（井上入浴・黒田入浴）のパターンで、2名体制の警告が出ず、Excelにも「井上ヘルプ」で出る
 const p=E2.resolveSeedPattern(m0,E2.SEED_PATTERNS.thu); const sh=Object.assign(E2.emptySheet(),{runs:p.runs,blocks:p.blocks});
 const date='2026-11-05'; const chk=E2.collectSheetChecks(E2.applyDayDept(m0,4,null,null,null,date),sh,date,p);
 assert.ok(!JSON.stringify(chk).includes('入浴'),'チェックの文に「井上入浴」「黒田入浴」が出ない');
 console.log('help merge OK');
}
// ===== 職員・車両・利用者の一覧は基本の部署の順（嫁島・津田・川津・あいのて・リベ）。同じ部署の中は今までの並び（2026-10-29） =====
{
 const assert=require('assert'); const E3=require('./eng.cjs');
 const m=E3.mergeSeedMaster(null,E3.seedMaster()); const dn=(id)=>(m.departments.find(d=>d.id===id)||{}).name||'';
 const rank=(n)=>["嫁島","津田","川津","あいのて","リベ"].findIndex(x=>n.startsWith(x));
 for(const key of ['users','staff','vehicles']){
  const shuffled=[...m[key]].reverse(); const out=E3.byBaseDept(m,shuffled);
  const rs=out.map(x=>rank(dn(x.deptId))); assert.deepStrictEqual(rs,[...rs].sort((a,b)=>a-b),key+' 部署の順');
  const firstDept=out.filter(x=>x.deptId===out[0].deptId).map(x=>x.id); assert.deepStrictEqual(firstDept,shuffled.filter(x=>x.deptId===out[0].deptId).map(x=>x.id),key+' 部署の中は元の並び');
 }
 // 職員はパートを各部署の下に
 const st=E3.byBaseDept(m,[...m.staff].reverse(),E3.partLast);
 for(const d of m.departments){const xs=st.filter(x=>x.deptId===d.id).map(x=>x.emp==="パート"?1:0);assert.deepStrictEqual(xs,[...xs].sort((a,b)=>a-b),d.name+' パートは下');}
 assert.ok(m.staff.some(x=>x.emp==="パート"),'見本にパートがいる');
 console.log('dept order OK');
}
// ===== PM休・早退：勤務の最後のコマに「退勤」、勤務時間の外は灰色（AM休も）（2026-10-30） =====
{
 const assert=require('assert'); const E4=require('./eng.cjs');
 const s={id:'x',start:'8:30',end:'17:30'};
 assert.strictEqual(E4.earlyLeaveSlot(s,{end:'12:30'},[]),12*60,'PM休(12:30まで)は12:00のコマに退勤');
 assert.strictEqual(E4.earlyLeaveSlot(s,{end:'17:30'},[]),null,'いつもどおりなら出さない');
 assert.strictEqual(E4.earlyLeaveSlot(s,{end:'12:30'},[{staffId:'x',label:'退勤',time:'12:00'}]),null,'もう退勤の予定があれば出さない');
 assert.strictEqual(E4.earlyLeaveSlot(s,{start:'13:30'},[]),null,'AM休は退勤を出さない');
 assert.ok(E4.outOfShiftSlot(s,{end:'12:30'},12*60+30)&&!E4.outOfShiftSlot(s,{end:'12:30'},12*60),'PM休の後は灰色');
 assert.ok(E4.outOfShiftSlot(s,{start:'13:30'},13*60)&&!E4.outOfShiftSlot(s,{start:'13:30'},13*60+30),'AM休の前は灰色');
 assert.ok(!E4.outOfShiftSlot(s,{},7*60),'時間を変えていない人は今までどおり');
 console.log('leave slot OK');
}
// ===== 灰色の時間（休み・AM休・PM休）に入ったコマは、出力前の確認で「時間のエラー」（2026-10-30） =====
{
 const assert=require('assert'); const E5=require('./eng.cjs');
 const m=E5.mergeSeedMaster(null,E5.seedMaster()); const date='2026-11-02', wd=1;
 const S=(n)=>m.staff.find(x=>x.name===n); const dm=E5.applyDayDept(m,wd,null,null,null,date);
 const a=S('八壁'), b=S('日野'), c=S('高井');
 const sheet=Object.assign(E5.emptySheet(),{
  staffOv:{[a.id]:{off:true},[b.id]:{start:'13:30'},[c.id]:{end:'12:30'}},
  runs:[{id:'r1',kind:'meet',time:'9:00',staffId:b.id,vehicleId:'',userIds:[],staffRiderIds:[]},{id:'r2',kind:'send',time:'13:00',staffId:b.id,vehicleId:'',userIds:[],staffRiderIds:[]},{id:'r3',kind:'send',time:'12:30',staffId:c.id,vehicleId:'',userIds:[],staffRiderIds:[]},{id:'r4',kind:'meet',time:'12:00',staffId:c.id,vehicleId:'',userIds:[],staffRiderIds:[]}],
  blocks:[{id:'b1',kind:'help',time:'10:00',staffId:a.id,label:'中村ヘルプ'},{id:'b2',kind:'block',time:'15:00',staffId:c.id,label:'会議'},{id:'b3',kind:'block',time:'14:00',staffId:b.id,label:'会議'}]});
 const w=(id)=>E5.runWarnings(sheet.runs.find(r=>r.id===id),dm,sheet,wd).join(' ');
 assert.ok(w('r1').includes('勤務時間外(この日は13:30から出勤)'),'AM休の9:00の便: '+w('r1'));
 assert.ok(w('r2').includes('勤務時間外'),'AM休の13:00の便（13:30より前）: '+w('r2'));
 assert.ok(w('r3').includes('勤務時間外(この日は12:30で退勤)'),'PM休の12:30の便: '+w('r3'));
 assert.ok(!w('r4').includes('勤務時間外'),'PM休の12:00の便はよい: '+w('r4'));
 const bw=E5.offTimeBlockWarn(dm,sheet,wd).join(' / ');
 assert.ok(bw.includes('八壁 10:00【中村ヘルプ】: 休みの職員に入っています'),bw);
 assert.ok(bw.includes('高井 15:00【会議】: 勤務時間外(この日は12:30で退勤)'),bw);
 assert.ok(!bw.includes('日野 14:00'),'AM休の14:00の予定はよい');
 const chk=JSON.stringify(E5.collectSheetChecks(dm,sheet,date,null));
 assert.ok(chk.includes('休みの職員に入っています')&&chk.includes('勤務時間外(この日は12:30で退勤)'),'出力前の確認に出る');
 console.log('off-time check OK');
}
