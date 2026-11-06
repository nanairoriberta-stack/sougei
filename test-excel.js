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
  { // 中抜け（2026-11-05 依頼者）：カレンダーの中抜けの「不在」はコマを出さず灰色。職員のいつもの中抜け（新見 14:00〜16:00）も灰色
    const yk = m.staff.find((x) => x.name === "日野"), ni = m.staff.find((x) => x.name === "新見");
    const dm = E.applyDayDept(m, 1, null, null, null, date);
    const sh4 = Object.assign({}, sheet, { blocks: [...sheet.blocks.filter((b) => b.staffId !== yk.id), { id: "cal_evnk_" + yk.id, kind: "block", time: "13:00", durMin: 60, staffId: yk.id, label: "不在（日野 中抜け）", calId: "evnk" }] });
    const wb4 = E.buildWorkbook(ExcelJS, dm, sh4, date); const b4 = new ExcelJS.Workbook(); await b4.xlsx.load(await wb4.xlsx.writeBuffer());
    const ws = b4.getWorksheet("送迎表"); let cy = 0, cn2 = 0; const rowOf = {};
    ws.eachRow((row, rn) => row.eachCell((c, cn) => { const v = String(c.value || ""); if (v === yk.name) cy = cn; if (v === ni.name) cn2 = cn; if (cn === 1 && /^\d{1,2}:\d{2}$/.test(v)) rowOf[v] = rn; }));
    const fillOf = (r, c) => ((ws.getRow(r).getCell(c).fill || {}).fgColor || {}).argb, val = (r, c) => String(ws.getRow(r).getCell(c).value || "");
    assert.ok(cy && cn2 && rowOf["13:00"] && rowOf["14:00"] && rowOf["15:00"] && rowOf["16:00"], "表の位置 " + JSON.stringify(rowOf));
    assert.strictEqual(fillOf(rowOf["13:00"], cy), "FFF5F5F4", "中抜け（カレンダー）13:00は灰色"); assert.strictEqual(fillOf(rowOf["13:00"] + 1, cy), "FFF5F5F4");
    assert.notStrictEqual(fillOf(rowOf["14:00"], cy), "FFF5F5F4", "14:00から白"); assert.ok(!val(rowOf["13:00"], cy).includes("不在"), "コマの文字は出さない");
    assert.strictEqual(fillOf(rowOf["14:00"], cn2), "FFF5F5F4", "新見さんのいつもの中抜け 14:00は灰色"); assert.strictEqual(fillOf(rowOf["15:00"] + 1, cn2), "FFF5F5F4");
    assert.notStrictEqual(fillOf(rowOf["16:00"], cn2), "FFF5F5F4", "16:00から白"); assert.notStrictEqual(fillOf(rowOf["13:00"] + 1, cn2), "FFF5F5F4");
    assert.ok(E.buildAutoNotes(dm, sh4.blocks).staffNotes.some((l) => l.startsWith("不在（日野 中抜け）")), "特記事項(職員)には残る");
    console.log("中抜けのExcel OK");
  }
  { // 出力したExcelを取り込む：車つきのその他予定（例：ケロ／会議）は1つのコマのまま戻る（2026-10-30）
    const yk = m.staff.find((x) => x.name === "八壁"), kero = m.vehicles.find((v) => /ケロ/.test(v.name)) || m.vehicles[0];
    const sh3 = Object.assign({}, sheet, { blocks: [...sheet.blocks, { id: "bk1", kind: "block", time: "13:00", staffId: yk.id, label: "会議", vehicleId: kero.id }] });
    const dm3 = E.applyDayDept(m, 1, null, null, null, date);
    const wb3 = E.buildWorkbook(ExcelJS, dm3, sh3, date); const b3 = new ExcelJS.Workbook(); await b3.xlsx.load(await wb3.xlsx.writeBuffer());
    const ws3 = b3.getWorksheet("送迎表"), aoa = [];
    ws3.eachRow({ includeEmpty: true }, (row, rn) => { const a = []; row.eachCell({ includeEmpty: true }, (c, cn) => { const v = c.value; a[cn - 1] = v && v.richText ? v.richText.map((x) => x.text).join("") : v; }); aoa[rn - 1] = a; });
    const back3 = E.importMondayGrid(aoa, dm3);
    const kb = back3.blocks.filter((b) => b.staffId === yk.id && b.time === "13:00");
    assert.ok(kb.some((b) => b.label === "会議" && b.vehicleId === kero.id), "会議に車が付いて戻る: " + JSON.stringify(kb));
    assert.ok(!back3.blocks.some((b) => b.staffId === yk.id && (b.label === kero.name || /^ケロ/.test(b.label))), "車の名前だけのコマはできない");
    console.log("取り込み：車つきの予定は1つのコマ OK");
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
 assert.ok(!/井上入浴|黒田入浴/.test(JSON.stringify(chk)),'チェックの文に「井上入浴」「黒田入浴」が出ない（藤井入浴などほかの入浴はそのままの名前＝2026-11-04 から車なしのエラーに名前が出る）');
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
// 男性不在のエラー（2026-11-06 依頼者）：時間ごとの男性のいない区間はエラーにしない。利用者がいるのに一日中男性職員がいない部署だけエラー
{
 const E6=E;   // 同じ版のまま（読み直すと先に走っている出力の試しが混ざる）
 const m=E6.mergeSeedMaster(null,E6.seedMaster()), date='2026-11-02', p=E6.resolveSeedPattern(m,E6.SEED_PATTERNS.mon);
 const sheet=Object.assign(E6.emptySheet(),{runs:p.runs,blocks:p.blocks}), dm=E6.applyDayDept(m,1,null,null,null,date);
 const txt=(g)=>JSON.stringify(g);
 const g1=E6.collectSheetChecks(dm,sheet,date,null);
 assert.ok(!/男性職員不在が許容時間/.test(txt(g1)),'男性のいない区間はエラーにしない');
 // 嫁島の男性職員を全員休みにする → その部署は「一日中男性職員がいません」
 const yome=dm.departments.find((d)=>d.name==='嫁島');
 const ov={}; dm.staff.filter((s)=>s.isMale).forEach((s)=>{ ov[s.id]={off:true}; });
 const g2=E6.collectSheetChecks(dm,Object.assign({},sheet,{staffOv:ov}),date,null), t2=txt(g2);
 assert.ok(t2.includes('嫁島: 利用者がいるのに、一日中男性職員がいません'),'一日中男性がいないときはエラー '+t2.slice(0,300));
 assert.ok(g2.some((g)=>/男性が一日中いない/.test(g.title)),'見出し');
 // 車がどこにいるかの想定のエラー（出発時に○○に居る想定・基地に戻らない・1日の最終位置）は出さない（2026-11-06 依頼者）。以前は月〜金の初期パターンで6件出ていた
 { let n=0; [['mon',1,'2026-11-02'],['tue',2,'2026-11-03'],['wed',3,'2026-11-04'],['thu',4,'2026-11-05'],['fri',5,'2026-11-06']].forEach(([k,wd,d])=>{ const pp=E6.resolveSeedPattern(m,E6.SEED_PATTERNS[k]); const sh=Object.assign(E6.emptySheet(),{runs:pp.runs,blocks:pp.blocks});
   n+=(JSON.stringify(E6.collectSheetChecks(E6.applyDayDept(m,wd,null,null,null,d),sh,d,null)).match(/居る想定|最終位置|基地\(/g)||[]).length; }); assert.strictEqual(n,0,'車の位置の想定のエラーは出さない'); }
 console.log('male all-day OK', (g2.find((g)=>/男性が一日中/.test(g.title))||{items:[]}).items[0]);
}
// 紙で確かめる一覧（職員・車・ヘルプ表・利用者・ルール）：罫線つき・A4（職員・利用者は横）・並びは基本の部署の順（2026-10-31）
{
 const assert=require('assert'); const E6=require('./eng.cjs'); const m6=E6.mergeSeedMaster(null,E6.seedMaster());
 const secs=E6.masterPrintSections(m6);
 assert.deepStrictEqual(secs.map(s=>s.key),['staff','vehicles','help','users','rules']);
 const st=secs[0]; const today=new Date().toISOString().slice(0,10);
 assert.strictEqual(st.rows.length,m6.staff.filter(s=>!(s.retireDate&&s.retireDate<=today)).length,'職員は全員（退職した人を除く）');
 assert.deepStrictEqual(st.rows.map(r=>r[1]),E6.byBaseDept(m6,m6.staff.filter(s=>!(s.retireDate&&s.retireDate<=today)),E6.partLast).map(s=>s.name),'画面と同じ並び');
 assert.strictEqual(secs[1].rows.length,m6.vehicles.length); assert.strictEqual(secs[3].rows.length,m6.users.length);
 assert.ok(secs[4].rows.length>0,'ルールも出る');
 const m7=JSON.parse(JSON.stringify(m6)); m7.rules=Object.assign({},m7.rules,{helpBase:[{time:'10:00',label:'井上ヘルプ',byDay:{1:'日野',3:'八壁'}}]});
 const hp=E6.masterPrintSections(m7,['help'])[0]; assert.deepStrictEqual(hp.rows[0].slice(0,4),['10:00','井上ヘルプ','日野',''],'ヘルプ表は時刻・ヘルプ・月〜日');
 assert.ok(E6.buildPrintHtml(m6,['help']).includes('登録がありません'),'空のときもわかる');
 assert.ok(st.land&&secs[3].land&&!secs[1].land,'職員・利用者はA4横');
 const html=E6.buildPrintHtml(m6,['vehicles','rules']);
 assert.ok(/@page\{size:A4 portrait/.test(html)&&/@page land\{size:A4 landscape/.test(html),'A4');
 assert.ok(/th,td\{border:1px solid #000/.test(html),'罫線');
 assert.strictEqual((html.match(/data-print-sec=/g)||[]).length,2,'選んだものだけ');
 assert.ok(html.includes(m6.vehicles[0].name)&&!html.includes('<h1>職員'),'車はあり・職員はなし');
 assert.ok(!E6.buildPrintHtml(Object.assign({},m6,{users:[{id:'x',name:'<b>悪</b>',deptId:'',days:[]}]}),['users']).includes('<b>悪</b>'),'名前の < は文字のまま');
 require('fs').writeFileSync('pw/print_sample.html',E6.buildPrintHtml(m6));
 console.log('print lists OK', secs.map(s=>s.title+s.rows.length).join(' / '));
}
// りんく・ぷれいす版の初期データ（2026-10-31）：部署ぷれいす・車①〜④・職員6名・利用者1〜20。以前の仮の名前は中のIDのまま直す
{
 const assert=require('assert'); const E8=require('./eng.cjs');
 const f=E8.seedMasterLink();
 assert.deepStrictEqual(f.departments.map(d=>d.name),['ぷれいす']);
 assert.deepStrictEqual(f.vehicles.map(v=>v.name),['車①','車②','車③','車④']);
 assert.deepStrictEqual(f.staff.map(s=>s.name),['小瀧','鳥屋尾','石倉','山本','職員1','白戸']);
 assert.deepStrictEqual(f.users.map(u=>u.name),Array.from({length:20},(_,i)=>'利用者'+(i+1)));
 assert.ok(f.users.slice(0,10).every(u=>u.session==='am')&&f.users.slice(10).every(u=>u.session==='pm'),'1〜10は午前・11〜20は午後');
 // 以前の初期データ
 const d='d_old', st=(n)=>({id:'s_'+n,name:n,deptId:d,memo:'仮登録。職員タブで実名・勤務時間・性別に変更してください'});
 const old={departments:[{id:d,name:'りんく・ぷれいす'}],staff:[1,2,3,4,5].map(i=>st('職員'+i)),vehicles:[1,2,3].map(i=>({id:'v'+i,name:'車'+i,deptId:d})),
  users:[...Array.from({length:10},(_,i)=>({id:'a'+i,name:'午前'+(i+1),deptId:d})),...Array.from({length:10},(_,i)=>({id:'p'+i,name:'午後'+(i+1),deptId:d}))]};
 old.staff[3].name='山田';   // 画面で名前を変えた人はそのまま
 const u=E8.upgradeLinkSeed(old);
 assert.ok(u.linkSeed2&&u.departments[0].name==='ぷれいす'&&u.departments[0].id===d,'部署はIDのまま名前だけ');
 assert.deepStrictEqual(u.staff.map(s=>s.id+':'+s.name),['s_職員1:小瀧','s_職員2:鳥屋尾','s_職員3:石倉','s_職員4:山田','s_職員5:職員1',u.staff[5].id+':山本',u.staff[6].id+':白戸'],'IDのまま名前を直し、足りない人を足す');
 assert.ok(u.staff.slice(5).every(s=>s.deptId===d),'足した人もぷれいす');
 assert.deepStrictEqual(u.vehicles.map(v=>v.name),['車①','車②','車③','車④']); assert.strictEqual(u.vehicles[0].id,'v1');
 assert.strictEqual(u.users.find(x=>x.id==='a0').name,'利用者1'); assert.strictEqual(u.users.find(x=>x.id==='p9').name,'利用者20'); assert.strictEqual(u.users.length,20);
 assert.strictEqual(E8.upgradeLinkSeed(u),u,'2回目は何もしない');
 const real={departments:[{id:'x',name:'嫁島'}],staff:[{id:'y',name:'八壁',deptId:'x'}],vehicles:[],users:[]};
 const r2=E8.upgradeLinkSeed(real); assert.deepStrictEqual(r2.staff,real.staff,'ふつうのデータは触らない'); assert.ok(r2.linkSeed2);
 console.log('link seed OK', u.staff.map(s=>s.name).join('・'));
}

// カレンダーのその日の予定 → 特記事項（利用者・職員）・連絡事項。パート職員のPM休・中抜けもパート欄に（2026-11-03 依頼者）
(async () => {
  // 上のテストと同時に動くので、window や読み込みはそのまま使う
  const E9 = require("./eng.cjs"), C9 = require("./calsync.js");
  const m = E9.mergeSeedMaster(null, E9.seedMaster()), date = "2026-11-02";
  const p = E9.resolveSeedPattern(m, E9.SEED_PATTERNS.mon);
  const ev = (id, title, o) => Object.assign({ id, rev: 1, date, endDate: date, allDay: true, title, biz: "seikatsu" }, o || {});
  const evs = [
    ev("e1", "中村 受診後来所", { sg: { type: "user_time", users: ["中村"], meet: "10:30", noMeet: "受診後送り" } }),
    ev("e2", "松浦通院", { allDay: false, start: "10:00", end: "12:00" }),               // TimeTreeから写した予定（利用者の名前）
    ev("e10", "松養生高２女性 現場実習"),                                                   // どちらの名前も無い → 連絡事項
    ev("e3", "中村 歯科", { allDay: false, start: "15:30", end: "16:30" }),             // 利用者の名前が入った予定
    ev("e4", "三島 PM休み", { sg: { type: "staff_off", staff: ["三島"], half: "pm" } }),
    ev("e5", "鳥屋尾 中抜け", { allDay: false, start: "13:00", end: "15:00", sg: { type: "staff_off", staff: ["鳥屋尾"], reason: "中抜け" } }),
    ev("e6", "八壁 研修"),                                                                 // 職員の名前が入った予定
    ev("e7", "森 欠席", { sg: { type: "user_absent", users: ["森"] } }),                  // 欠席は欠席の欄にあるので出さない
    ev("e8", "放デイ 遠足", { biz: "houkago" }),                                          // ほかの事業の予定は出さない
    ev("e9", "消した予定 中村", { deleted: true }),
  ];
  const cn = E9.calNoteLines(m, evs, date, "v1");
  assert.deepStrictEqual(cn.user, ["中村 受診後来所", "松浦通院 10:00〜12:00", "中村 歯科 15:30〜16:30"], JSON.stringify(cn));
  assert.deepStrictEqual(cn.staff, ["三島 PM休み", "八壁 研修", "鳥屋尾 中抜け 13:00〜15:00"], JSON.stringify(cn));
  assert.deepStrictEqual(cn.biz, ["松養生高２女性 現場実習"], "名前の無い予定は連絡事項");
  const sh = C9.reconcile(m, Object.assign(E9.emptySheet(), { runs: p.runs, blocks: p.blocks }), evs, date);
  const an = E9.buildAutoNotes(m, sh.blocks);
  assert.ok(an.staffNotes.some((l) => l.startsWith("不在（鳥屋尾 中抜け）")), "カレンダーから入った不在のコマは職員へ " + JSON.stringify(an.staffNotes));
  assert.ok(!an.bizNotes.some((l) => l.includes("鳥屋尾")), "連絡事項には出さない");
  const wb = E9.buildWorkbook(ExcelJS, m, Object.assign({}, sh, { calNotes: cn }), date);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(await wb.xlsx.writeBuffer());
  const txt = []; back.getWorksheet("送迎表").eachRow((r) => r.eachCell((c) => txt.push(String(c.value && c.value.richText ? c.value.richText.map((x) => x.text).join("") : c.value || ""))));
  const all = txt.join("\n"), has = (s) => assert.ok(all.includes(s), "Excelに「" + s + "」");
  ["中村 受診後来所", "中村 歯科 15:30〜16:30", "三島 PM休み", "八壁 研修", "松浦通院 10:00〜12:00", "松養生高２女性 現場実習"].forEach(has);
  const ms = m.staff.find((s) => s.name === "三島"), mt = m.staff.find((s) => s.name === "鳥屋尾");
  has(`三島 ${ms.start}〜${sh.staffOv[ms.id].end}`);   // PM休はパート欄の退勤が早くなる
  assert.ok(!all.includes("森 欠席"), "欠席は特記事項に出さない");
  if (!(mt.offDays || []).includes(1)) has("鳥屋尾"), assert.ok(/鳥屋尾 [^\n]*\(13:00〜15:00不在\)/.test(all), "中抜けはパート欄に（不在）");
  console.log("cal notes OK", cn.user.length, cn.staff.length, cn.biz.length, "/ パート:", (all.match(/三島 [^\n]*/) || [""])[0]);
})().catch((e) => { console.error(e); process.exit(1); });

// ヘルプに車が無いときは出力前の確認でエラー・ヘルプの車にバス（2026-11-04 依頼者）
(async () => {
  const E10 = require("./eng.cjs"), m = E10.mergeSeedMaster(null, E10.seedMaster()), date = "2026-11-02";
  const p = E10.resolveSeedPattern(m, E10.SEED_PATTERNS.mon);
  const st = m.staff.find((s) => s.name === "八壁");
  const blocks = [...p.blocks.map((b) => (b.kind === "help" && !b.vehicleId ? { ...b, vehicleId: "__walk__" } : b)),
    { id: "hb1", kind: "help", time: "14:00", staffId: st.id, label: "中村ヘルプ", vehicleId: "__bus__" },
    { id: "hb2", kind: "help", time: "15:00", staffId: st.id, label: "森ヘルプ", vehicleId: "" },
    { id: "hb3", kind: "help", time: "15:30", staffId: "__hold__", label: "保留のヘルプ", vehicleId: "" },
    { id: "hb4", kind: "help", time: "16:00", staffId: st.id, label: "コマだけ消したヘルプ", vehicleId: "", noteOnly: true }];
  assert.deepStrictEqual(E10.helpNoCarWarn(m, { blocks }), ["八壁 15:00【ヘルプ】森ヘルプ: 車が入っていません(公用車・自車・バス・徒歩から選んでください)"], "車なしのヘルプだけ（保留・コマだけ消したものは除く）");
  const sh = Object.assign(E10.emptySheet(), { runs: p.runs, blocks });
  const wb = E10.buildWorkbook(ExcelJS, m, sh, date);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(await wb.xlsx.writeBuffer());
  const txt = []; back.getWorksheet("送迎表").eachRow((r) => r.eachCell((c) => txt.push(String(c.value && c.value.richText ? c.value.richText.map((x) => x.text).join("") : c.value || ""))));
  const cell = txt.find((x) => x.includes("[ﾍﾙﾌﾟ]") && x.includes("中村")) || "";   // Excelは半角（[ﾍﾙﾌﾟ] ﾊﾞｽ 中村）
  assert.ok(/ﾊﾞｽ|バス/.test(cell), "Excelのヘルプにバス " + JSON.stringify(cell));
  console.log("help car OK", JSON.stringify(cell));
})().catch((e) => { console.error(e); process.exit(1); });

// 利用者の休み：別の行・セルではなく、利用者の枠の中に段落を分けて「休み：〇〇」（2026-11-04 依頼者）
(async () => {
  const E11 = require("./eng.cjs"), m = E11.mergeSeedMaster(null, E11.seedMaster()), date = "2026-11-02";
  const p = E11.resolveSeedPattern(m, E11.SEED_PATTERNS.mon);
  const wd = 1, us = m.users.filter((u) => (u.days || []).includes(wd));
  const a = us[0], b = us.find((u) => u.deptId === a.deptId && u.id !== a.id);
  const sh = Object.assign(E11.emptySheet(), { runs: p.runs, blocks: p.blocks, userAbsent: { [a.id]: true, [b.id]: true } });
  const wb = E11.buildWorkbook(ExcelJS, m, sh, date);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(await wb.xlsx.writeBuffer());
  const ws = back.getWorksheet("送迎表"), cells = [];
  ws.eachRow((r, ri) => r.eachCell((c, ci) => cells.push({ ri, ci, v: String(c.value && c.value.richText ? c.value.richText.map((x) => x.text).join("") : c.value || "") })));
  const kana = (s) => E11.toHankakuKana ? E11.toHankakuKana(s) : s;
  const cell = cells.find((x) => x.v.includes("\n\n休み：") && x.v.includes(kana(a.name)) && x.v.includes(kana(b.name)));
  assert.ok(cell, "利用者の枠の中に「休み：」 " + JSON.stringify(cells.filter((x) => x.v.includes("休み")).map((x) => x.v).slice(0, 4)));
  assert.ok(!cell.v.split("休み：")[0].includes(kana(a.name)), "休みの人は来る人の並びに入れない");
  assert.ok(!cells.some((x) => x.v.includes("(車)") || x.v.includes("(ｸﾙﾏ)")), "利用者の名前のあとの「(車)」は出さない（2026-11-05 依頼者）");
  assert.ok(!cells.some((x) => x.ci === 1 && x.v === "休み"), "「休み」の行は無くなった");
  console.log("absent in user cell OK", JSON.stringify(cell.v.slice(-40)));
})().catch((e) => { console.error(e); process.exit(1); });

// 表と「送迎」の間の細い空行（高さ6）は出さない（印刷で上の行の文字を隠すことがあった。2026-11-04 依頼者）
(async () => {
  const E12 = require("./eng.cjs"), m = E12.mergeSeedMaster(null, E12.seedMaster()), p = E12.resolveSeedPattern(m, E12.SEED_PATTERNS.mon);
  const wb = E12.buildWorkbook(ExcelJS, m, Object.assign(E12.emptySheet(), { runs: p.runs, blocks: p.blocks }), "2026-11-02");
  const back = new ExcelJS.Workbook(); await back.xlsx.load(await wb.xlsx.writeBuffer());
  const ws = back.getWorksheet("送迎表"); const thin = [];
  ws.eachRow({ includeEmpty: true }, (r, ri) => { if (r.height != null && r.height < 10) thin.push(ri + ":" + r.height); });
  assert.deepStrictEqual(thin, [], "細い空行が無い");
  let sogeiRow = 0; ws.eachRow((r, ri) => { if (!sogeiRow && String(r.getCell(1).value || "") === "送迎") sogeiRow = ri; });
  assert.ok(sogeiRow > 2 && ws.getRow(sogeiRow - 1).height >= 15 && /\d{1,2}:\d{2}/.test(String(ws.getRow(sogeiRow - 2).getCell(1).value || "")), "「送迎」のすぐ上は表の最後の時間（30分ずつ2行）" + sogeiRow);
  console.log("no thin row OK (送迎は" + sogeiRow + "行目、すぐ上は " + ws.getRow(sogeiRow - 2).getCell(1).value + " の行)");
})().catch((e) => { console.error(e); process.exit(1); });

// Excelの文字が切れないように行の高さを確かめる（2026-11-05 依頼者「文字の下の方が切れることがある」）
(async () => {
  const E13 = require("./eng.cjs"), m = E13.mergeSeedMaster(null, E13.seedMaster()), p = E13.resolveSeedPattern(m, E13.SEED_PATTERNS.mon);
  // 長いメモ（特記事項）と長い名前の予定を入れても、出力したあとにもう一度確かめると直す行が無い（＝もう足りている）
  const long = Array.from({ length: 14 }, (_, i) => `メモ${i + 1} ずっと長い特記事項の文です。折り返しても切れないように`).join("\n");
  const sh = Object.assign(E13.emptySheet(), { runs: p.runs, blocks: [...p.blocks, { id: "lb1", kind: "block", time: "10:00", staffId: p.blocks[0].staffId, label: "とても長い名前の予定（市役所で手続きのあと病院へ寄って書類を受け取る）" }], notes: long, contact: long, notesStaff: long });
  const wb = E13.buildWorkbook(ExcelJS, m, sh, "2026-11-02");
  for (const name of ["送迎表", "車両の動き"]) assert.strictEqual(E13.fitRowHeights(wb.getWorksheet(name)), 0, name + "：出力の時点で高さが足りている");
  // 低すぎる行は高くなる（1つのセル・縦に結合したセル）
  const ws = new ExcelJS.Workbook().addWorksheet("t");
  ws.getColumn(1).width = 11; ws.getColumn(2).width = 11;
  ws.getCell(1, 1).value = "あいうえおかきくけこさしすせそたちつてと"; ws.getCell(1, 1).font = { size: 11 }; ws.getCell(1, 1).alignment = { wrapText: true }; ws.getRow(1).height = 15;
  ws.mergeCells(2, 2, 3, 2); ws.getCell(2, 2).value = "一\n二\n三\n四\n五\n六"; ws.getCell(2, 2).font = { size: 11 }; ws.getCell(2, 2).alignment = { wrapText: true }; ws.getRow(2).height = 15; ws.getRow(3).height = 15;
  assert.strictEqual(E13.fitRowHeights(ws), 2);
  assert.ok(ws.getRow(1).height >= 4 * 11 * 1.5, "4行ぶん以上 " + ws.getRow(1).height);
  assert.ok(ws.getRow(2).height + ws.getRow(3).height >= 6 * 11 * 1.5, "結合したセルは合わせて6行ぶん以上");
  assert.strictEqual(E13.fitRowHeights(ws), 0, "2回目は何もしない");
  console.log("fit row heights OK", Math.round(ws.getRow(1).height), Math.round(ws.getRow(2).height + ws.getRow(3).height));
})().catch((e) => { console.error(e); process.exit(1); });

// 用紙いっぱいに：列の幅をいくつか試して、一番大きく印刷できる幅で出す（2026-11-05 依頼者「余白がかなりある」）
(async () => {
  const E14 = require("./eng.cjs"), m = E14.mergeSeedMaster(null, E14.seedMaster());
  for (const k of ["mon", "thu"]) {
    const p = E14.resolveSeedPattern(m, E14.SEED_PATTERNS[k]), sh = Object.assign(E14.emptySheet(), { runs: p.runs, blocks: p.blocks });
    const sc = (w) => E14.printScaleOf(E14.buildWorkbook(ExcelJS, m, sh, "2026-11-02", w ? { colw: w } : {}).getWorksheet("送迎表"));
    const w = E14.bestColW(ExcelJS, m, sh, "2026-11-02"), s0 = sc(11), s1 = sc(w);
    assert.ok(s1 >= s0, "今までより小さくならない");
    for (const x of [10, 12, 14, 16]) assert.ok(s1 + 0.005 >= sc(x), `幅${x}より大きく出る`);
    console.log(`fill page OK ${k}: 列の幅 ${w}（印刷の倍率 ${Math.round(s0 * 100)}% → ${Math.round(s1 * 100)}%）`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

// 休みの職員の列は印刷に出さない（2026-11-05 依頼者「ウ」）。その人に残っていたコマは保留の列へ、休みの人は特記事項(職員)に
(async () => {
  const E15 = require("./eng.cjs"), m = E15.mergeSeedMaster(null, E15.seedMaster()), date = "2026-11-02";
  const p = E15.resolveSeedPattern(m, E15.SEED_PATTERNS.mon);
  const withItem = p.blocks.find((b) => b.staffId && b.staffId !== "__hold__" && !b.noteOnly), offA = m.staff.find((s) => s.id === withItem.staffId);
  const offB = m.staff.find((s) => s.id !== offA.id && s.emp !== "パート" && !s.noGrid && !(s.offDays || []).includes(1));
  const base = Object.assign(E15.emptySheet(), { runs: p.runs, blocks: p.blocks });
  const sh = Object.assign({}, base, { staffOv: { [offA.id]: { off: true }, [offB.id]: { off: true } } });
  const read = async (s) => { const wb = E15.buildWorkbook(ExcelJS, m, s, date, { colw: E15.bestColW(ExcelJS, m, s, date) }); const back = new ExcelJS.Workbook(); await back.xlsx.load(await wb.xlsx.writeBuffer()); const ws = back.getWorksheet("送迎表"), t = []; ws.eachRow((r, ri) => r.eachCell((c, ci) => t.push({ ri, ci, v: String(c.value || "") }))); return { ws, t, sc: E15.printScaleOf(wb.getWorksheet("送迎表")) }; };
  const a = await read(base), b = await read(sh);
  const nameRow = (x) => { const hit = x.t.find((c) => c.v === E15.toHankakuKana(offB.name) || c.v === offB.name); return hit ? hit.ri : -1; };
  const ri = nameRow(a);
  assert.ok(ri > 0, "いつもは列がある");
  assert.ok(!b.t.some((c) => c.ri === ri && (c.v === offB.name || c.v === E15.toHankakuKana(offB.name) || /\(休/.test(c.v))), "休みの人の列は出さない");
  assert.strictEqual(b.ws.columnCount, a.ws.columnCount - 2 + (a.t.some((c) => c.v === "保留") ? 0 : 1), "列が2つ減る（保留の列が無かった日は1つ増える）");
  const lbl = E15.toHankakuKana(withItem.label);
  assert.ok(b.t.some((c) => c.v.includes(lbl) && b.t.some((h) => h.ci === c.ci && h.v === "保留")), "休みの人のコマは保留の列に（消えない） " + lbl);
  assert.ok(b.t.some((c) => c.v.includes("休み：") && c.v.includes(E15.toHankakuKana(offA.name)) && c.v.includes(E15.toHankakuKana(offB.name))), "特記事項(職員)に「休み：」");
  const bestOf = (s, o) => { let best = 0; for (const w of [10.5, 11, 11.5, 12, 12.5, 13, 14, 15]) best = Math.max(best, E15.printScaleOf(E15.buildWorkbook(ExcelJS, m, s, date, Object.assign({ colw: w }, o)).getWorksheet("送迎表"))); return best; };
  // 実際はカレンダーで休みにするとその人のコマは保留へ移る（calsync）。同じ状態で、休みの列を出す・出さないを比べる
  const toHold = (x) => (x.staffId === offA.id || x.staffId === offB.id ? Object.assign({}, x, { staffId: "__hold__" }) : x);
  const real = Object.assign({}, sh, { runs: sh.runs.map(toHold), blocks: sh.blocks.map(toHold) });
  const shown = bestOf(real, { showOffCols: true }), hidden = bestOf(real, {});
  assert.ok(hidden >= shown, "休みの列を出さないほうが大きく印刷できる " + shown + " " + hidden);
  console.log("off columns hidden OK", offA.name, offB.name, "同じ日で 休みの列あり", Math.round(shown * 1000) / 10 + "% → なし", Math.round(hidden * 1000) / 10 + "%");
})().catch((e) => { console.error(e); process.exit(1); });
