"use strict";
global.window={};
const E=require("./eng.cjs"), C=require('./calsync.js'), assert=require('assert');
const m=E.mergeSeedMaster(null,E.seedMaster());
const p=E.resolveSeedPattern(m,E.SEED_PATTERNS.mon);
const sheet=Object.assign(E.emptySheet(),{runs:p.runs,blocks:p.blocks});
const S=n=>m.staff.find(s=>s.name===n), U=n=>m.users.find(u=>u.name===n);
const evs=[
 {id:'ev1',rev:1,date:'2026-11-02',endDate:'2026-11-02',allDay:true,title:'有給',sg:{type:'staff_off',staff:['八壁']}},
 {id:'ev2',rev:1,date:'2026-11-02',endDate:'2026-11-02',allDay:false,start:'13:00',end:'15:00',title:'研修',sg:{type:'staff_plan',staff:['日野','白戸']}},
 {id:'ev3',rev:1,date:'2026-11-02',endDate:'2026-11-02',allDay:true,title:'森 欠席',sg:{type:'user_absent',users:['森']}},
 {id:'ev4',rev:1,date:'2026-11-02',endDate:'2026-11-02',allDay:true,title:'受診後来所',sg:{type:'user_time',users:['中村'],meet:'10:30',noMeet:'受診後来所'}},
 {id:'ev5',rev:1,date:'2026-11-01',endDate:'2026-11-03',allDay:false,start:'15:00',end:'10:00',title:'出張',sg:{type:'staff_off',staff:['吉岡']}},
 {id:'ev6',rev:1,date:'2026-11-02',endDate:'2026-11-02',allDay:false,start:'09:00',end:'11:00',title:'不明',sg:{type:'staff_plan',staff:['存在しない人']}},
];
let r=C.reconcile(m,sheet,evs,'2026-11-02');
assert.strictEqual(r.staffOv[S('八壁').id].off,true);
assert.ok(r.blocks.some(b=>b.id===`cal_ev2_${S('日野').id}`&&b.time==='13:00'&&b.durMin===120));
assert.strictEqual(r.userAbsent[U('森').id],true);
assert.deepStrictEqual(r.userTime[U('中村').id],{meet:'10:30'}); assert.strictEqual(r.noRide[U('中村').id].meet,'受診後来所');
assert.ok(r.staffOv[S('吉岡').id].off,'中日の出張は終日不在');
assert.strictEqual(C.reconcile(m,r,evs,'2026-11-02'),r,'同じ内容なら変更なし（無限ループしない）');
const sum=C.summary(m,r,evs,'2026-11-02'); assert.ok(!sum.find(x=>x.id==='ev6'),'1人も当てはまらない予定はバッジに出さない'); const sum2=C.summary(m,r,[{...evs[1],id:'ev7',sg:{type:'staff_plan',staff:['日野','存在しない人']}}],'2026-11-02'); assert.deepStrictEqual(sum2[0].missing,['存在しない人']);
// 変更：研修を14時に → ブロック更新
const evs2=evs.map(e=>e.id==='ev2'?Object.assign({},e,{rev:2,start:'14:00'}):e);
let r2=C.reconcile(m,r,evs2,'2026-11-02'); assert.ok(r2.blocks.some(b=>b.id===`cal_ev2_${S('日野').id}`&&b.time==='14:00')); assert.strictEqual(r2.blocks.filter(b=>b.id===`cal_ev2_${S('日野').id}`).length,1);
// 手で中村の迎え時刻を変えてから予定削除 → 手の変更は残る。森の欠席は元に戻る
r2.userTime[U('中村').id]={meet:'11:00'};
const evs3=evs2.filter(e=>e.id!=='ev4'&&e.id!=='ev3'&&e.id!=='ev1');
let r3=C.reconcile(m,r2,evs3,'2026-11-02');
assert.deepStrictEqual(r3.userTime[U('中村').id],{meet:'11:00'},'手で変えた時刻は残す');
assert.ok(!(U('森').id in r3.userAbsent),'欠席は取り消し'); assert.ok(!r3.noRide[U('中村').id],'送迎なしは取り消し');
assert.ok(!(S('八壁').id in r3.staffOv),'休みは取り消し');
// パターン読込で予定が消えても補われる
const wiped=Object.assign({},r3,{blocks:p.blocks}); const r4=C.reconcile(m,wiped,evs3,'2026-11-02'); assert.ok(r4.blocks.some(b=>b.id===`cal_ev2_${S('白戸').id}`));
// 2台が同時に反映 → 同じID
assert.deepStrictEqual(C.reconcile(m,sheet,evs,'2026-11-02').blocks.map(b=>b.id),r.blocks.map(b=>b.id));
console.log('calsync OK');
// AM休・PM休：勤務時間の半分
{
 const yo=m.staff.find(s=>s.name==='余村慎')||m.staff[0];
 const e=[{id:'h1',rev:1,date:'2026-11-02',endDate:'2026-11-02',allDay:true,title:'AM休',sg:{type:'staff_off',staff:[yo.name],half:'am'}}];
 const x=C.reconcile(m,sheet,e,'2026-11-02'); const st=x.staffOv[yo.id];
 console.log('AM休',yo.name,yo.start,yo.end,(yo.shiftByDay||{})[1]||'',JSON.stringify(st));
 const e2=[{...e[0],rev:2,sg:{...e[0].sg,half:'pm'}}]; const y=C.reconcile(m,x,e2,'2026-11-02'); console.log('PM休',JSON.stringify(y.staffOv[yo.id]));
 const z=C.reconcile(m,y,[],'2026-11-02'); assert.ok(!(yo.id in z.staffOv),'取り消し');
}
console.log('half OK');
// ===== ラベルごとの項目：ヘルプ（開始時刻・行き先）・送迎（迎え・送りの変更）・休日出勤（時間） =====
{
 const D='2026-11-02', st=n=>S(n).id, us=n=>U(n).id;
 const dept=m.departments.find(d=>d.name==='津田');
 const L=[
  {id:'hp1',rev:1,date:D,endDate:D,allDay:false,start:'10:00',end:'11:00',title:'日野 ヘルプ（森）',sg:{type:'help',staff:['日野'],users:['森'],note:'森'}},
  {id:'hp2',rev:1,date:D,endDate:D,allDay:false,start:'14:00',end:'15:00',title:'ヘルプ（中村）',sg:{type:'help',staff:[],users:['中村'],note:'中村'}},
  {id:'hp3',rev:1,date:D,endDate:D,allDay:false,start:'13:00',end:'14:00',title:'白戸 ヘルプ（○○公民館）',sg:{type:'help',staff:['白戸'],users:[],note:'○○公民館'}},
  {id:'hp4',rev:1,date:D,endDate:D,allDay:false,start:'13:00',end:'14:00',title:'他の事業所',sg:{type:'help',staff:['存在しない人'],users:[],note:'どこか'}},
  {id:'rd1',rev:1,date:D,endDate:D,allDay:true,title:'森 家族送り・送り15:30',sg:{type:'user_time',users:['森'],noMeet:'家族送り',send:'15:30'}},
  {id:'rd2',rev:1,date:D,endDate:D,allDay:true,title:'中村 受診後送り・家族迎え',sg:{type:'user_time',users:['中村'],noMeet:'受診後送り',noSend:'家族迎え'}},
  {id:'hw1',rev:1,date:D,endDate:D,allDay:false,start:'09:00',end:'13:00',title:'八壁 休日出勤',sg:{type:'hwork',staff:['八壁'],dept:'津田'}},
 ];
 const x=C.reconcile(m,sheet,L,D);
 const hb=x.blocks.find(b=>b.id===`cal_hp1_${st('日野')}`);
 assert.ok(hb&&hb.kind==='help'&&hb.time==='10:00'&&hb.label==='森'&&hb.userIds[0]===us('森'),'ヘルプは担当職員の欄に（行き先＝利用者）');
 assert.strictEqual(hb.durMin,undefined,'長さは送迎表の決まり（開始時刻だけ入力）');
 assert.ok(x.blocks.some(b=>b.id==='cal_hp2___hold__'&&b.staffId==='__hold__'&&b.label==='中村'),'担当未定のヘルプは保留欄');
 const h3=x.blocks.find(b=>b.id===`cal_hp3_${st('白戸')}`); assert.ok(h3&&h3.label==='○○公民館'&&h3.userIds.length===0,'行き先が場所でも入る');
 assert.ok(!x.blocks.some(b=>String(b.id).startsWith('cal_hp4')),'この版の職員も利用者もいないヘルプは入れない');
 assert.strictEqual(x.noRide[us('森')].meet,'家族送り'); assert.strictEqual(x.userTime[us('森')].send,'15:30');
 assert.deepStrictEqual(x.noRide[us('中村')],{meet:'受診後送り',send:'家族迎え'},'受診後送り・家族迎え');
 assert.deepStrictEqual(x.staffOv[st('八壁')],{workToday:true,start:'9:00',end:'13:00',deptId:dept.id},'休日出勤：時間とその日の部署');
 assert.strictEqual(C.reconcile(m,x,L,D),x,'同じ内容なら変更なし');
 assert.strictEqual(x.runs.length,p.runs.length,'便はそのまま');
 // パターン読込で消えても入れ直す
 const wiped=Object.assign({},x,{blocks:p.blocks,staffOv:{},noRide:{},userTime:{}});
 const y=C.reconcile(m,wiped,L,D);
 assert.ok(y.blocks.some(b=>b.id===`cal_hp1_${st('日野')}`)&&y.staffOv[st('八壁')].workToday&&y.noRide[us('森')].meet==='家族送り','消えた分を補う');
 // 手で八壁の退勤を変えてから休日出勤を消す → 手の変更は残し、休日出勤は外す
 y.staffOv[st('八壁')]=Object.assign({},y.staffOv[st('八壁')],{end:'14:00'});
 const gone=C.reconcile(m,y,[],D);
 assert.ok(!gone.blocks.some(b=>String(b.id).startsWith('cal_')),'予定を消すとヘルプも外れる');
 assert.deepStrictEqual(gone.staffOv[st('八壁')],{end:'14:00'},'手で変えた退勤は残す');
 assert.ok(!gone.noRide[us('中村')]&&!gone.noRide[us('森')],'迎え・送りなしは取り消し');
 // 欠席（理由つき）も今までどおり
 const w=C.reconcile(m,sheet,[{id:'ua1',rev:1,date:D,endDate:D,allDay:true,title:'森 欠席',sg:{type:'user_absent',users:['森'],reason:'体調不良'}}],D);
 assert.strictEqual(w.userAbsent[us('森')],true);
 // バッジの表示
 const sm=C.summary(m,x,L,D);
 assert.strictEqual(sm.find(s=>s.id==='hp2').time,'14:00〜・中村・担当は未定（保留欄）');
 assert.strictEqual(sm.find(s=>s.id==='rd2').time,'迎えなし(受診後送り)・送りなし(家族迎え)');
 assert.ok(!sm.find(s=>s.id==='hp4'));
 const sm2=C.summary(m,x,[{...L[6],id:'hw9',sg:{...L[6].sg,dept:'ない部署'}}],D); assert.deepStrictEqual(sm2[0].missing,['ない部署']);
 // 古い端末から届く形でも壊れない（normSg）
 const T=require('./calcore.js');
 assert.strictEqual(T.normSg({type:'ride',users:['森']}),null,'使わなくなった種類は無視');
 assert.strictEqual(T.normSg({type:'staff_off',staff:['八壁'],dept:'y'}).dept,'','職員休みに部署は持たない');
 assert.deepStrictEqual(T.normEvent({date:D,title:'会議',tanto:['八壁','',1,'八壁']},'abcdef12',0).tanto,['八壁'],'担当（その他予定）');
}
console.log('labels OK');
// ===== 勤務時間変更 =====
{
 const D='2026-11-02', st=n=>S(n).id, tsu=m.departments.find(d=>d.name==='津田');
 const L=[{id:'sh1',rev:1,date:'2026-11-01',endDate:'2026-11-03',allDay:true,title:'八壁 出勤7:30・退勤19:00',sg:{type:'shift',staff:['八壁'],wstart:'07:30',wend:'19:00',reason:'早出'}},
  {id:'sh2',rev:1,date:D,endDate:D,allDay:true,title:'日野 退勤15:00',sg:{type:'shift',staff:['日野'],wend:'15:00',dept:'津田'}}];
 const x=C.reconcile(m,sheet,L,D);
 assert.deepStrictEqual(x.staffOv[st('八壁')],{start:'7:30',end:'19:00'},'出勤・退勤が変わる（何日も続く予定の中日も）');
 assert.deepStrictEqual(x.staffOv[st('日野')],{end:'15:00',deptId:tsu.id},'退勤だけ・その日の部署');
 assert.strictEqual(C.summary(m,x,L,D).find(s=>s.id==='sh1').time,'出勤7:30・退勤19:00');
 // 手で退勤を直してから予定を消す → 手の分は残り、出勤だけ元に戻る
 const h=JSON.parse(JSON.stringify(x)); h.staffOv[st('八壁')].end='18:00';
 const g=C.reconcile(m,h,[],D); assert.deepStrictEqual(g.staffOv[st('八壁')],{end:'18:00'}); assert.ok(!(st('日野') in g.staffOv));
 // パターン読込で消えても入れ直す
 assert.deepStrictEqual(C.reconcile(m,Object.assign({},x,{staffOv:{}}),L,D).staffOv[st('八壁')],{start:'7:30',end:'19:00'});
 const T=require('./calcore.js'); assert.strictEqual(T.normSg({type:'staff_off',staff:['x'],wstart:'07:00'}).wstart,'','勤務時間変更以外は時刻を持たない');
}
console.log('shift OK');
