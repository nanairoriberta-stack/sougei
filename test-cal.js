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
