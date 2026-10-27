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
// ===== ラベルごとの項目：ヘルプ・送迎・休日出勤 =====
{
 const D='2026-11-02', st=n=>S(n).id, us=n=>U(n).id;
 const veh=m.vehicles[0], dept=m.departments.find(d=>d.name==='津田');
 const L=[
  {id:'hp1',rev:1,date:D,endDate:D,allDay:false,start:'10:00',end:'11:30',title:'森 ヘルプ（入浴）',sg:{type:'help',staff:['日野'],users:['森'],note:'入浴'}},
  {id:'hp2',rev:1,date:D,endDate:D,allDay:false,start:'14:00',end:'15:00',title:'中村 ヘルプ',sg:{type:'help',staff:[],users:['中村'],note:''}},
  {id:'rd1',rev:1,date:D,endDate:D,allDay:false,start:'09:15',end:'10:00',title:'森 送迎（通院）',sg:{type:'ride',kind:'other_run',staff:['白戸','吉岡'],users:['森'],vehicle:veh.name,note:'○○医院'}},
  {id:'rd2',rev:1,date:D,endDate:D,allDay:false,start:'16:00',end:'16:30',title:'中村 送り',sg:{type:'ride',kind:'send',staff:[],users:['中村'],vehicle:'',note:''}},
  {id:'rd3',rev:1,date:D,endDate:D,allDay:false,start:'16:00',end:'16:30',title:'他の事業所',sg:{type:'ride',kind:'send',staff:['白戸'],users:['存在しない利用者']}},
  {id:'hw1',rev:1,date:D,endDate:D,allDay:true,title:'久保田 休日出勤',sg:{type:'hwork',staff:['久保田'],dept:'津田'}},
  {id:'hw2',rev:1,date:D,endDate:D,allDay:false,start:'09:00',end:'13:00',title:'八壁 休日出勤',sg:{type:'hwork',staff:['八壁'],dept:''}},
 ];
 const x=C.reconcile(m,sheet,L,D);
 const hb=x.blocks.find(b=>b.id===`cal_hp1_${st('日野')}`);
 assert.ok(hb&&hb.kind==='help'&&hb.time==='10:00'&&hb.durMin===90&&hb.label==='森'&&hb.note==='入浴'&&hb.userIds[0]===us('森'),'ヘルプは担当職員の欄に');
 assert.ok(x.blocks.some(b=>b.id==='cal_hp2___hold__'&&b.staffId==='__hold__'),'担当未定のヘルプは保留欄');
 const r1=x.runs.find(r=>r.id==='cal_rd1');
 assert.ok(r1&&r1.kind==='other_run'&&r1.time==='9:15'&&r1.staffId===st('白戸')&&r1.vehicleId===veh.id,'送迎は便として入る（1人目が運転）');
 assert.deepStrictEqual(r1.staffRiderIds,[st('吉岡')],'2人目からは同乗'); assert.deepStrictEqual(r1.userIds,[us('森')]); assert.strictEqual(r1.note,'○○医院');
 const r2=x.runs.find(r=>r.id==='cal_rd2'); assert.ok(r2&&r2.kind==='send'&&r2.staffId==='__hold__'&&r2.vehicleId==='','運転未定は保留欄');
 assert.ok(!x.runs.some(r=>r.id==='cal_rd3'),'この版にいない利用者の送迎は入れない'); assert.ok(!x.calApplied.rd3);
 assert.deepStrictEqual(x.staffOv[st('久保田')],{workToday:true,deptId:dept.id},'休日出勤：出勤＋その日の部署');
 assert.deepStrictEqual(x.staffOv[st('八壁')],{workToday:true,start:'9:00',end:'13:00'},'休日出勤：時間指定');
 assert.strictEqual(C.reconcile(m,x,L,D),x,'同じ内容なら変更なし');
 // パターン読込で便・ヘルプ・休日出勤が消えても入れ直す。手で直した便はそのまま
 const wiped=Object.assign({},x,{runs:p.runs,blocks:p.blocks,staffOv:{}});
 const y=C.reconcile(m,wiped,L,D);
 assert.ok(y.runs.some(r=>r.id==='cal_rd1')&&y.blocks.some(b=>b.id===`cal_hp1_${st('日野')}`)&&y.staffOv[st('久保田')].workToday,'消えた分を補う');
 const hand=JSON.parse(JSON.stringify(y)); hand.runs.find(r=>r.id==='cal_rd2').staffId=st('日野');
 assert.strictEqual(C.reconcile(m,hand,L,D).runs.find(r=>r.id==='cal_rd2').staffId,st('日野'),'送迎表で運転を決めたら、それを残す');
 // 予定を変更：時刻 → 便も移る（重複しない）
 const L2=L.map(e=>e.id==='rd1'?Object.assign({},e,{rev:2,start:'09:45'}):e);
 const z=C.reconcile(m,y,L2,D); assert.strictEqual(z.runs.filter(r=>r.id==='cal_rd1').length,1); assert.strictEqual(z.runs.find(r=>r.id==='cal_rd1').time,'9:45');
 // 手で八壁の退勤を変えてから休日出勤を消す → 手の変更は残し、休日出勤は外す
 z.staffOv[st('八壁')]=Object.assign({},z.staffOv[st('八壁')],{end:'14:00'});
 const gone=C.reconcile(m,z,[],D);
 assert.ok(!gone.runs.some(r=>String(r.id).startsWith('cal_'))&&!gone.blocks.some(b=>String(b.id).startsWith('cal_')),'予定を消すと便・ヘルプも外れる');
 assert.deepStrictEqual(gone.staffOv[st('八壁')],{end:'14:00'},'手で変えた退勤は残す');
 assert.ok(!(st('久保田') in gone.staffOv),'休日出勤は取り消し');
 assert.strictEqual(gone.runs.length,p.runs.length,'いつもの便はそのまま');
 // 理由つきの休み・欠席も今までどおり
 const w=C.reconcile(m,sheet,[{id:'lv1',rev:1,date:D,endDate:D,allDay:true,title:'八壁 休み（有給）',sg:{type:'staff_off',staff:['八壁'],reason:'有給'}},{id:'ua1',rev:1,date:D,endDate:D,allDay:true,title:'森 欠席',sg:{type:'user_absent',users:['森'],reason:'体調不良'}}],D);
 assert.strictEqual(w.staffOv[st('八壁')].off,true); assert.strictEqual(w.userAbsent[us('森')],true);
 // バッジの表示
 const sm=C.summary(m,x,L,D);
 assert.strictEqual(sm.find(s=>s.id==='hp2').time,'14:00〜15:00・担当は未定（保留欄）');
 assert.strictEqual(sm.find(s=>s.id==='rd1').time,'その他の便 9:15・○○医院'); assert.strictEqual(sm.find(s=>s.id==='hw1').time,'いつもの勤務時間');
 assert.ok(!sm.find(s=>s.id==='rd3'));
 const sm2=C.summary(m,x,[{...L[2],id:'rd9',sg:{...L[2].sg,vehicle:'ない車'}}],D); assert.deepStrictEqual(sm2[0].missing,['ない車']);
 // 古い端末から届く、項目の少ない形でも壊れない（normSg）
 const T=require('./calcore.js'); const n=T.normSg({type:'ride',users:['森'],kind:'xx'}); assert.strictEqual(n.kind,'other_run'); assert.strictEqual(n.reason,'');
 assert.strictEqual(T.normSg({type:'staff_off',staff:['八壁'],vehicle:'x',dept:'y'}).vehicle,'','職員休みに車両は持たない');
}
console.log('labels OK');
