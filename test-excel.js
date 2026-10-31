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
