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
 // 8:30〜17:30 の人：AM休は13:30から、PM休は12:30まで（真ん中13:00の±30分）
 const m2=JSON.parse(JSON.stringify(m)); const y2=m2.staff.find(s=>s.id===yo.id); y2.start='8:30'; y2.end='17:30'; y2.shiftByDay={};
 assert.strictEqual(C.reconcile(m2,sheet,e,'2026-11-02').staffOv[yo.id].start,'13:30','AM休は13:30から');
 assert.strictEqual(C.reconcile(m2,sheet,e2,'2026-11-02').staffOv[yo.id].end,'12:30','PM休は12:30まで');
}
console.log('half OK');
// 休み・AM休・PM休・不在・勤務時間変更：勤務していない時間にかかる、その職員の便・予定は保留へ。予定を消すと（保留のままなら）元の担当へ
{
 const D='2026-11-02', wd=1, H='__hold__';
 const mine=(sh,id)=>[...sh.runs,...sh.blocks].filter(x=>x.staffId===id&&!String(x.id).startsWith('cal_'));
 const busy=m.staff.map(s=>({s,n:mine(sheet,s.id).length})).sort((a,b)=>b.n-a.n)[0].s;   // 予定の多い職員で試す
 const m2=JSON.parse(JSON.stringify(m)); const b2=m2.staff.find(s=>s.id===busy.id); b2.start='8:30'; b2.end='17:30'; b2.shiftByDay={};
 const tm=t=>{const [h,mm]=t.split(':').map(Number);return h*60+mm};
 const all=mine(sheet,busy.id); assert.ok(all.length>=2,'試す職員に予定がある');
 const ev=(o)=>[Object.assign({id:'hd1',rev:1,date:D,endDate:D,allDay:true,title:'休み',sg:{type:'staff_off',staff:[busy.name]}},o)];
 // 1日休み → 全部保留
 let x=C.reconcile(m2,sheet,ev({}),D);
 assert.strictEqual(mine(x,busy.id).length,0,'1日休みは全部保留');
 assert.strictEqual(x.calApplied.hd1.held.length,all.length);
 all.forEach(a=>assert.strictEqual([...x.runs,...x.blocks].find(y=>y.id===a.id).staffId,H));
 // 保留のうち1件を手で別の職員に → 予定を消しても、それは触らない。ほかは元の担当へ
 const other=m2.staff.find(s=>s.id!==busy.id).id; x=JSON.parse(JSON.stringify(x)); const moved=[...x.runs,...x.blocks].find(y=>y.id===all[0].id); moved.staffId=other;
 let y=C.reconcile(m2,x,[],D);
 assert.strictEqual([...y.runs,...y.blocks].find(z=>z.id===all[0].id).staffId,other,'手で割り当てたものはそのまま');
 assert.strictEqual(mine(y,busy.id).length,all.length-1,'ほかは元の担当へ');
 // AM休（13:30から）→ 13:30より前に始まるものだけ保留
 x=C.reconcile(m2,sheet,ev({sg:{type:'staff_off',staff:[busy.name],half:'am'}}),D);
 const amHeld=all.filter(a=>tm(a.time)<tm('13:30')).map(a=>a.id).sort();
 assert.deepStrictEqual(x.calApplied.hd1.held.map(h=>h.id).sort(),amHeld,'AM休は13:30より前');
 assert.ok(mine(x,busy.id).every(a=>tm(a.time)>=tm('13:30')));
 // PM休（12:30まで）→ 12:30を越えるものが保留
 x=C.reconcile(m2,sheet,ev({sg:{type:'staff_off',staff:[busy.name],half:'pm'}}),D);
 assert.ok(mine(x,busy.id).every(a=>tm(a.time)+(Number(a.durMin)||30)<=tm('12:30')),'PM休は12:30まで');
 assert.strictEqual((x.calApplied.hd1.held||[]).length+mine(x,busy.id).length,all.length);
 // 時間で不在（例 10:00〜11:00）→ その時間にかかるものだけ
 x=C.reconcile(m2,sheet,ev({allDay:false,start:'10:00',end:'11:00',title:'通院'}),D);
 (x.calApplied.hd1.held||[]).forEach(h=>{const a=all.find(z=>z.id===h.id);assert.ok(tm(a.time)<tm('11:00')&&tm(a.time)+(Number(a.durMin)||30)>tm('10:00'))});
 // 勤務時間変更（出勤11:00）→ 11:00より前が保留。予定を消すと戻る
 x=C.reconcile(m2,sheet,ev({title:'遅出',sg:{type:'shift',staff:[busy.name],wstart:'11:00'}}),D);
 assert.ok(mine(x,busy.id).every(a=>tm(a.time)>=tm('11:00')));
 y=C.reconcile(m2,x,[],D); assert.strictEqual(mine(y,busy.id).length,all.length,'消すと元どおり');
 x=C.reconcile(m2,sheet,ev({sg:{type:'staff_off',staff:[busy.name],half:'am'}}),D);
 assert.ok(C.summary(m2,x,ev({sg:{type:'staff_off',staff:[busy.name],half:'am'}}),D)[0].time.includes(`担当の予定${amHeld.length}件を保留へ`),'送迎表の「反映中」に保留の件数');
 // 反映したあとで休みの人に入った便・予定（パターン読込・取込・以前の版で反映済みの休みなど）も保存のときに保留へ（2026-10-31 依頼者）
 x=C.reconcile(m2,sheet,ev({}),D); x=JSON.parse(JSON.stringify(x));
 const fresh=all.map((a,i)=>Object.assign({},a,{id:'new'+i,staffId:busy.id}));   // パターンを読み直して、休みの人に新しい便・予定が入った
 x.runs=x.runs.concat(fresh.filter(a=>sheet.runs.some(r=>r.id===all[fresh.indexOf(a)].id))); x.blocks=x.blocks.concat(fresh.filter(a=>sheet.blocks.some(r=>r.id===all[fresh.indexOf(a)].id)));
 assert.strictEqual(mine(x,busy.id).length,all.length,'休みの人に入っている');
 y=C.reconcile(m2,x,ev({}),D);
 assert.strictEqual(mine(y,busy.id).length,0,'保存すると保留へ');
 assert.ok(fresh.every(a=>[...y.runs,...y.blocks].find(z=>z.id===a.id).staffId===H));
 assert.strictEqual(y.calApplied.hd1.held.length,all.length*2,'移したものを記録');
 // 以前の版で反映した休み（held の記録なし）も、保存のときに保留へ
 x=C.reconcile(m2,sheet,ev({}),D); x=JSON.parse(JSON.stringify(x)); for(const a of all){const z=[...x.runs,...x.blocks].find(q=>q.id===a.id);z.staffId=busy.id} delete x.calApplied.hd1.held;
 y=C.reconcile(m2,x,ev({}),D); assert.strictEqual(mine(y,busy.id).length,0,'以前の反映でも保留へ');
 // 保留から手で休みの人に戻したもの（記録あり）は、もう動かさない
 y=JSON.parse(JSON.stringify(y)); [...y.runs,...y.blocks].find(z=>z.id===all[0].id).staffId=busy.id;
 const y2=C.reconcile(m2,y,ev({}),D); assert.strictEqual([...y2.runs,...y2.blocks].find(z=>z.id===all[0].id).staffId,busy.id,'手で戻したものはそのまま');
 // AM休：あとから入った13:30より前のものだけ保留へ
 x=C.reconcile(m2,sheet,ev({sg:{type:'staff_off',staff:[busy.name],half:'am'}}),D); x=JSON.parse(JSON.stringify(x));
 x.blocks.push({id:'newAm',kind:'block',time:'9:00',staffId:busy.id,label:'会議'},{id:'newPm',kind:'block',time:'15:00',staffId:busy.id,label:'記録'});
 y=C.reconcile(m2,x,ev({sg:{type:'staff_off',staff:[busy.name],half:'am'}}),D);
 assert.strictEqual(y.blocks.find(b=>b.id==='newAm').staffId,H); assert.strictEqual(y.blocks.find(b=>b.id==='newPm').staffId,busy.id);
 // 予定を消すと、保留のままのものは元の担当へ
 const y3=C.reconcile(m2,y,[],D); assert.strictEqual(y3.blocks.find(b=>b.id==='newAm').staffId,busy.id,'消すと戻る');
 // 職員時間変更「ﾏﾝｼｮﾝのみ」（送迎なし。2026-10-31）：勤務時間はその時刻、送迎表には載るが便はすべて保留へ（予定はそのまま）。予定を消すと戻る
 {const T=require('./calcore.js');const nm=T.normEvent({id:'ev_mz00001',title:'x',date:D,endDate:D,allDay:true,label:'shift',sg:{type:'shift',staff:[busy.name],wstart:'06:00',wend:'15:00',reason:'早ﾏﾝｼｮﾝのみ',noRide:true}},'ev_mz00001',0);
  assert.strictEqual(nm.sg.noRide,true,'送迎なしは残る');
  const n2=T.normEvent({id:'ev_mz00001',title:'x',date:D,endDate:D,allDay:true,label:'shift',sg:{type:'shift',staff:[busy.name],wstart:'06:00'}},'ev_mz00001',0); assert.ok(!('noRide' in n2.sg),'ふつうの時間変更には付かない');}
 const mz=ev({id:'mz1',title:'早ﾏﾝｼｮﾝのみ',sg:{type:'shift',staff:[busy.name],wstart:'06:00',wend:'15:00',reason:'早ﾏﾝｼｮﾝのみ',noRide:true}});
 x=C.reconcile(m2,sheet,mz,D);
 assert.deepStrictEqual(x.staffOv[busy.id],{start:'6:00',end:'15:00',noRide:true},'時刻と送迎なし');
 assert.strictEqual(x.runs.filter(r=>r.staffId===busy.id).length,0,'便はすべて保留へ');
 const runsB=sheet.runs.filter(r=>r.staffId===busy.id).map(r=>r.id); assert.ok(runsB.length>0,'試す職員に便がある');
 runsB.forEach(id=>assert.strictEqual(x.runs.find(r=>r.id===id).staffId,H));
 assert.ok(C.summary(m2,x,mz,D)[0].time.includes('送迎なし'),'反映中に送迎なし');
 y=C.reconcile(m2,x,[],D); assert.ok(!(y.staffOv||{})[busy.id],'消すと時刻・送迎なしも外れる'); assert.strictEqual(y.runs.filter(r=>r.staffId===busy.id).length,runsB.length,'便も戻る');
 {const w=E.runWarnings(Object.assign({},sheet.runs.find(r=>r.id===runsB[0]),{staffId:busy.id}),m2,x,wd); assert.ok(w.some(t=>t.includes('送迎なし')),'送迎なしの人に便を入れると注意 '+w.join(','));}
 console.log('hold OK', busy.name, '予定', all.length, '件 / AM休で保留', amHeld.length, '件');
}
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
 assert.strictEqual(hb.durMin,60,'ヘルプの時間（1時間）が送迎表の長さに（2026-10-30〜 30分・1時間などを選べる）');
 { const h30=C.reconcile(m,sheet,[{id:'hq30',rev:1,date:D,endDate:D,allDay:false,start:'15:00',end:'15:30',title:'ヘルプ（森）',sg:{type:'help',staff:[],users:['森'],note:'森'}}],D).blocks.find(b=>b.id==='cal_hq30___hold__');
   assert.ok(h30&&h30.durMin===30&&h30.time==='15:00','30分のヘルプ'); }
 assert.ok(x.blocks.some(b=>b.id==='cal_hp2___hold__'&&b.staffId==='__hold__'&&b.label==='中村'),'担当未定のヘルプは保留欄');
 const h3=x.blocks.find(b=>b.id===`cal_hp3_${st('白戸')}`); assert.ok(h3&&h3.label==='○○公民館'&&h3.userIds.length===0,'行き先が場所でも入る');
 assert.ok(!x.blocks.some(b=>String(b.id).startsWith('cal_hp4')),'この版の職員も利用者もいないヘルプは入れない');
 // 2026-11-09 依頼者「カレンダーの『園山 ヘルプ』が送迎表に出ていない」：利用者の名前がこの版に見つからなくても、同じ事業の予定なら名前のまま保留へ（だまって消さない）
 { const ms=[{id:'hm1',rev:1,date:D,endDate:D,allDay:false,start:'10:00',end:'11:00',title:'園山X ヘルプ',sg:{type:'help',staff:[],users:['園山X'],note:''}}];
   const hx=C.reconcile(m,sheet,ms,D).blocks.find(b=>b.id==='cal_hm1___hold__');
   assert.ok(hx&&hx.label==='園山X'&&hx.time==='10:00','見つからない名前のヘルプも保留の欄に名前のまま');
   assert.deepStrictEqual(C.specsFor(m,ms,D)[0].missing,['園山X'],'「送迎表に見つからない名前」に出る');
   assert.ok(C.summary(m,sheet,ms,D).some(x=>x.id==='hm1'&&x.missing.includes('園山X')),'送迎表の「反映中」に名前つきで出る');
   assert.ok(!C.reconcile(m,sheet,[Object.assign({},ms[0],{biz:'houkago'})],D).blocks.some(b=>b.id==='cal_hm1___hold__'),'放課後デイの予定は生活介護の送迎表に入れない（今までどおり）');
   const hy=C.reconcile(m,sheet,[Object.assign({},ms[0],{sg:{type:'help',staff:[],users:['園山'],note:''}})],D).blocks.find(b=>b.id==='cal_hm1___hold__');
   assert.ok(hy&&hy.label==='園山'&&hy.userIds[0]===us('園山'),'園山さん（送迎表にいる人）は保留の欄に'); }
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
// ヘルプ（2026-10-28〜）：職員は選ばず利用者。保留欄に【ヘルプ（利用者）】、家以外の行き先は（ ）書き
{
 const D='2026-11-02';
 const x=C.reconcile(m,sheet,[{id:'hq1',rev:1,date:D,endDate:D,allDay:false,start:'10:30',end:'11:30',title:'森 ヘルプ（○○病院）',sg:{type:'help',staff:[],users:['森'],note:'○○病院'}},
   {id:'hq2',rev:1,date:D,endDate:D,allDay:false,start:'13:00',end:'14:00',title:'中村 ヘルプ',sg:{type:'help',staff:[],users:['中村'],note:''}}],D);
 const a=x.blocks.find(b=>b.id==='cal_hq1___hold__'); assert.ok(a&&a.staffId==='__hold__'&&a.label==='森'&&a.note==='○○病院'&&a.time==='10:30'&&a.userIds[0]===U('森').id,'利用者のヘルプは保留欄');
 const b=x.blocks.find(b=>b.id==='cal_hq2___hold__'); assert.ok(b&&b.label==='中村'&&!('note' in b),'行き先なし');
 // 送迎表で担当を割り当てても（同じ札のまま職員の欄へ）、そのまま残る
 const y=JSON.parse(JSON.stringify(x)); y.blocks.find(b=>b.id==='cal_hq1___hold__').staffId=S('日野').id;
 assert.strictEqual(C.reconcile(m,y,[{id:'hq1',rev:1,date:D,endDate:D,allDay:false,start:'10:30',end:'11:30',title:'',sg:{type:'help',staff:[],users:['森'],note:'○○病院'}},{id:'hq2',rev:1,date:D,endDate:D,allDay:false,start:'13:00',end:'14:00',title:'',sg:{type:'help',staff:[],users:['中村'],note:''}}],D).blocks.find(b=>b.id==='cal_hq1___hold__').staffId,S('日野').id,'割り当てた担当は残る');
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
// ===== 送迎：迎え先・送り先の変更 =====
{
 const D='2026-11-02';
 const inRun=(k)=>{const r=sheet.runs.find(r=>r.kind===k&&r.userIds.length);return{r,u:m.users.find(u=>u.id===r.userIds[0])}};
 const {r:mr,u:mu}=inRun('meet'); const {r:sr,u:su}=inRun('send');
 const free=m.users.find(u=>!sheet.runs.some(r=>r.kind==='meet'&&r.userIds.includes(u.id)));
 const L=[{id:'pl1',rev:1,date:D,endDate:D,allDay:true,title:'迎え先',sg:{type:'user_time',users:[mu.name],meetPlace:'実家'}},
  {id:'pl2',rev:1,date:D,endDate:D,allDay:true,title:'送り先',sg:{type:'user_time',users:[su.name],sendPlace:'病院',send:'15:00'}},
  {id:'pl3',rev:1,date:D,endDate:D,allDay:true,title:'まだ便にいない人',sg:{type:'user_time',users:[free.name],meetPlace:'ﾘﾍﾞ'}}];
 const x=C.reconcile(m,sheet,L,D);
 assert.strictEqual(x.runs.find(r=>r.id===mr.id).places[mu.id],'実家','乗る迎えの便に、その日だけの迎え先');
 assert.strictEqual(x.runs.find(r=>r.id===sr.id).places[su.id],'病院','乗る送りの便に、その日だけの送り先'); assert.strictEqual(x.userTime[su.id].send,'15:00');
 assert.ok(!x.runs.some(r=>r.places&&r.places[free.id]),'便にいない人はまだ入れない');
 assert.strictEqual(C.reconcile(m,x,L,D),x,'同じ内容なら変更なし');
 // 送迎表で便に入れる → 次の保存で迎え先が入る
 const y=JSON.parse(JSON.stringify(x)); const tr=y.runs.find(r=>r.kind==='meet'&&r.id!==mr.id); tr.userIds.push(free.id);
 const y2=C.reconcile(m,y,L,D); assert.strictEqual(y2.runs.find(r=>r.id===tr.id).places[free.id],'ﾘﾍﾞ','便に入ったら迎え先が入る');
 // 別の便に移しても付いていく。手で別の行き先にした分はそのまま
 const z=JSON.parse(JSON.stringify(y2)); const a=z.runs.find(r=>r.id===mr.id); a.userIds=a.userIds.filter(i=>i!==mu.id); delete a.places[mu.id]; if(!Object.keys(a.places).length)delete a.places;
 const other=z.runs.find(r=>r.kind==='meet'&&r.id!==mr.id&&r.id!==tr.id); other.userIds.push(mu.id);
 z.runs.find(r=>r.id===sr.id).places[su.id]='自宅';
 const z2=C.reconcile(m,z,L,D);
 assert.strictEqual(z2.runs.find(r=>r.id===other.id).places[mu.id],'実家','移した便にも迎え先');
 assert.strictEqual(z2.runs.find(r=>r.id===sr.id).places[su.id],'自宅','手で変えた送り先は残す');
 // パターン読込で便が作り直されても入れ直す
 const w=Object.assign({},z2,{runs:JSON.parse(JSON.stringify(p.runs))}); const w2=C.reconcile(m,w,L,D);
 assert.strictEqual(w2.runs.find(r=>r.id===mr.id).places[mu.id],'実家');
 // 予定を消す → 反映した行き先だけ外れる（手で変えた送り先は残る）
 const g=C.reconcile(m,z2,[],D);
 assert.ok(!g.runs.some(r=>r.places&&(r.places[mu.id]==='実家'||r.places[free.id]==='ﾘﾍﾞ')),'迎え先は外れる');
 assert.strictEqual(g.runs.find(r=>r.id===sr.id).places[su.id],'自宅');
 // もともとその日だけの行き先があった便は、消したら元の行き先に戻る
 const base=JSON.parse(JSON.stringify(sheet)); base.runs.find(r=>r.id===mr.id).places={[mu.id]:'ﾘﾍﾞ'};
 const b1=C.reconcile(m,base,[L[0]],D); assert.strictEqual(b1.runs.find(r=>r.id===mr.id).places[mu.id],'実家');
 assert.deepStrictEqual(C.reconcile(m,b1,[],D).runs.find(r=>r.id===mr.id).places,{[mu.id]:'ﾘﾍﾞ'},'元の行き先に戻る');
 assert.strictEqual(C.summary(m,x,L,D).find(s=>s.id==='pl2').time,'送り15:00・送り先:病院');
 const T=require('./calcore.js'); assert.strictEqual(T.normSg({type:'user_absent',users:['x'],meetPlace:'a'}).meetPlace,'','欠席に迎え先は持たない');
}
console.log('place OK');
// ===== モニタリング・支援会議：対応者の予定として入る =====
{
 const D='2026-11-02';
 const L=[{id:'mo1',rev:1,date:D,endDate:D,allDay:false,start:'13:30',end:'14:30',label:'monitor',place:'自宅',title:'モニタリング（森）',sg:{type:'staff_plan',staff:['日野'],users:['森']}}];
 const x=C.reconcile(m,sheet,L,D);
 const b=x.blocks.find(b=>b.id===`cal_mo1_${S('日野').id}`);
 assert.ok(b&&b.kind==='block'&&b.time==='13:30'&&b.durMin===60&&b.label==='モニタリング（森）','対応者の欄に予定');
 assert.deepStrictEqual(C.summary(m,x,L,D)[0].who,['日野','森']);
 assert.ok(!C.reconcile(m,x,[],D).blocks.some(b=>b.id.startsWith('cal_mo1')),'消すと外れる');
 const T=require('./calcore.js');
 assert.strictEqual(T.normEvent({date:D,title:'支援会議',label:'shien'},'abcdef12',0).label,'shien');
 assert.strictEqual(T.normEvent({date:D,title:'会議',label:'meeting'},'abcdef13',0).label,'other','以前の「会議」は支援会議にならない');
}
console.log('monitor OK');
// ===== 利用日外利用：その日だけ利用日にする（送迎表の「今日だけ利用」）。迎え・送りの変更も一緒に =====
{
 const D='2026-11-02', wd=1;
 const u=m.users.find(x=>!(x.days||[]).includes(wd)&&!x.startDate); assert.ok(u,'月曜が利用日でない人');
 const L=[{id:'ex1',rev:1,date:D,endDate:D,allDay:true,title:u.name+' 利用日外利用',sg:{type:'user_extra',users:[u.name],send:'15:00',noMeet:'家族送り'}}];
 const x=C.reconcile(m,sheet,L,D);
 assert.strictEqual(x.userExtra[u.id],true,'今日だけ利用'); assert.strictEqual(x.userTime[u.id].send,'15:00'); assert.strictEqual(x.noRide[u.id].meet,'家族送り');
 const dm=E.applyDayDept(m,wd,x.staffOv,x.userDept,x.userExtra,D).users.find(y=>y.id===u.id); assert.ok(dm.extraUseDay&&dm.days.includes(wd),'送迎表でその日の利用者になる');
 assert.strictEqual(C.reconcile(m,x,L,D),x,'同じ内容なら変更なし');
 const wiped=Object.assign({},x,{userExtra:{}}); assert.strictEqual(C.reconcile(m,wiped,L,D).userExtra[u.id],true,'消えても入れ直す');
 const g=C.reconcile(m,x,[],D); assert.ok(!(g.userExtra||{})[u.id]&&!(g.noRide||{})[u.id]&&!(g.userTime||{})[u.id],'予定を消すと元に戻る');
 assert.ok(C.summary(m,x,L,D)[0].time.startsWith('今日だけ利用'));
 const T=require('./calcore.js'); assert.strictEqual(T.normSg({type:'user_extra',users:[u.name],meetPlace:'実家'}).meetPlace,'実家');
 assert.strictEqual(T.normEvent({date:D,title:'x',label:'extra'},'abcdef14',0).label,'extra');
}
console.log('extra OK');
// ===== 日付で切り替わるルール：10/11から変える → 10/10までの送迎表は前のルール =====
{
 const R=x=>JSON.stringify(x);
 const at=(mm,d)=>E.applyDayDept(mm,E.weekdayOf(d),null,null,null,d).rules;
 const base=JSON.parse(JSON.stringify(m)); base.rules=Object.assign({},base.rules||{}); delete base.rulesUntil;
 const old=R((base.rules.ngPairs)||[]), ng1=[{a:'森',b:'中村'}], ng0=JSON.parse(old);
 const chg=(mm,key,val,from)=>E.scheduleRules(mm,Object.assign({},mm,{rules:Object.assign({},mm.rules,{[key]:val})}),from);
 let a=chg(base,'ngPairs',ng1,'2026-10-11');
 assert.strictEqual(R(at(a,'2026-10-10').ngPairs||[]),old,'10/10は前のルール');
 assert.strictEqual(R(at(a,'2026-10-11').ngPairs),R(ng1),'10/11から新しいルール');
 assert.strictEqual(R(E.applyDayDept(a,1,null,null).rules.ngPairs),R(ng1),'日付なし（週間パターン）は新しいルール');
 assert.deepStrictEqual(a.rulesUntil.map(v=>v.until),['2026-10-10']);
 // 日付なしの変更はすべての日に
 const ht=[{staff:'八壁',time:'9:00'}]; let b=chg(a,'helpTwo',ht,'');
 assert.strictEqual(R(at(b,'2026-10-01').helpTwo),R(ht)); assert.strictEqual(R(at(b,'2026-10-20').helpTwo),R(ht));
 assert.strictEqual(R(at(b,'2026-10-10').ngPairs||[]),old,'前の区切りはそのまま');
 // もっと前の日（10/5から）の変更：10/4までは元、10/5〜は変わる。10/11からの分も変わる
 const uv=[{user:'森',veh:'ドラ'}]; let c=chg(b,'userVeh',uv,'2026-10-05');
 assert.notStrictEqual(R(at(c,'2026-10-04').userVeh),R(uv)); assert.strictEqual(R(at(c,'2026-10-05').userVeh),R(uv));
 assert.strictEqual(R(at(c,'2026-10-10').userVeh),R(uv)); assert.strictEqual(R(at(c,'2026-10-12').userVeh),R(uv));
 assert.strictEqual(R(at(c,'2026-10-10').ngPairs||[]),old); assert.deepStrictEqual(c.rulesUntil.map(v=>v.until),['2026-10-04','2026-10-10']);
 // 後の日（10/20から）の変更：10/11〜10/19は変わらない
 const fb=[{staff:'日野',time:'13:00',label:'会議',days:[1]}]; let d=chg(c,'fixedBlock',fb,'2026-10-20');
 assert.notStrictEqual(R(at(d,'2026-10-19').fixedBlock),R(fb)); assert.strictEqual(R(at(d,'2026-10-20').fixedBlock),R(fb));
 assert.strictEqual(R(at(d,'2026-10-19').ngPairs),R(ng1));
 // 10/11からの変更を元に戻す → 要らなくなった区切りは消える
 let e=chg(d,'ngPairs',ng0,'2026-10-11');
 assert.ok(!e.rulesUntil.some(v=>v.until==='2026-10-10'),'同じ中身の区切りは消える');
 assert.strictEqual(R(at(e,'2026-10-10').ngPairs||[]),old); assert.strictEqual(R(at(e,'2026-10-15').ngPairs||[]),old);
 // 区切りのないマスタは今までどおり（rulesUntil を作らない）
 assert.ok(!('rulesUntil' in chg(base,'helpTwo',ht,'')),'日付なしの変更で区切りは作らない');
 console.log('rules by date OK', e.rulesUntil.map(v=>v.until).join(','));
}

// モニタリング・支援会議：対応者が決まっていなければ保留の欄へ（2026-11-05 依頼者）。送迎表で職員の欄へ動かしたら、予定を直してもそのまま
{
  const m2 = E.mergeSeedMaster(null, E.seedMaster()), sh2 = Object.assign(E.emptySheet(), { runs: [], blocks: [] });
  const mon = { id: 'evmonH', rev: 1, date: '2026-11-02', endDate: '2026-11-02', allDay: false, start: '13:30', end: '14:30', title: 'モニタリング（森）', label: 'monitor', sg: { type: 'staff_plan', staff: [], users: ['森'] } };
  let r2 = C.reconcile(m2, sh2, [mon], '2026-11-02');
  const hb = r2.blocks.find((b) => b.id === 'cal_evmonH_hold');
  assert.ok(hb && hb.staffId === '__hold__' && hb.time === '13:30' && hb.durMin === 60 && hb.label === 'モニタリング（森）', '保留にコマ ' + JSON.stringify(r2.blocks));
  const moved = { ...r2, blocks: r2.blocks.map((b) => (b.id === hb.id ? { ...b, staffId: S('八壁').id } : b)) };
  const r3 = C.reconcile(m2, moved, [{ ...mon, rev: 2, start: '14:00', end: '15:00' }], '2026-11-02');
  const hb3 = r3.blocks.find((b) => b.id === 'cal_evmonH_hold');
  assert.ok(hb3.staffId === S('八壁').id && hb3.time === '14:00', '動かした担当はそのまま・時刻は付いていく ' + JSON.stringify(hb3));
  assert.ok(!C.reconcile(m2, sh2, [{ ...mon, sg: { type: 'staff_plan', staff: [], users: ['いない子'] } }], '2026-11-02').blocks.length, 'この版の利用者でなければ入れない');
  const r4 = C.reconcile(m2, r3, [], '2026-11-02'); assert.ok(!r4.blocks.some((b) => b.id === 'cal_evmonH_hold'), '予定を消すとコマも消える');
  console.log('monitor hold OK');
}
// ===== 中抜け勤務（2026-11-05 依頼者：新見 9:30〜14:00と16:00〜19:00、野津・橋本 6:00〜9:00と17:00〜22:00） =====
{
  const D = '2026-11-02', ni = S('新見');
  assert.ok(ni && ni.start === '9:30' && ni.end === '19:00' && ni.awayFrom === '14:00' && ni.awayTo === '16:00', '新見さんの中抜け（初期データ） ' + JSON.stringify(ni && { s: ni.start, e: ni.end, a: ni.awayFrom, b: ni.awayTo }));
  for (const n of ['野津', '橋本']) { const x = S(n); assert.ok(x.awayFrom === '9:00' && x.awayTo === '17:00', n + 'の中抜け'); }
  // 前から使っている送迎表（中抜けなし）には1回だけ入れる。もう入っている人・手で消した後は触らない
  const old = JSON.parse(JSON.stringify(m)); old.staff.forEach((s) => { if (s.name === '新見') { delete s.awayFrom; delete s.awayTo; } }); delete old.away1;
  const up = E.upgradeAway1(old); assert.strictEqual(up.staff.find((s) => s.name === '新見').awayFrom, '14:00'); assert.ok(up.away1);
  const cleared = JSON.parse(JSON.stringify(up)); cleared.staff.find((s) => s.name === '新見').awayFrom = ''; assert.strictEqual(E.upgradeAway1(cleared), cleared, '2回目は何もしない');
  // 送迎表：中抜けの時間は灰色・その日の上書き・中抜けなし
  assert.deepStrictEqual(E.awayOf(ni, {}), { from: '14:00', to: '16:00' });
  assert.deepStrictEqual(E.awayOf(ni, { awayFrom: '13:00', awayTo: '15:30' }), { from: '13:00', to: '15:30' }, 'その日の中抜け');
  assert.deepStrictEqual(E.awayMin(ni, { noAway: true }), [null, null], 'この日はなし');
  assert.ok(E.outOfShiftSlot(ni, {}, 14 * 60) && E.outOfShiftSlot(ni, {}, 15 * 60 + 30) && !E.outOfShiftSlot(ni, {}, 16 * 60) && !E.outOfShiftSlot(ni, {}, 13 * 60 + 30), '中抜けの時間は灰色');
  const w = E.offTimeBlockWarn(m, { blocks: [{ id: 'b1', staffId: ni.id, time: '14:30', durMin: 30, kind: 'help', label: '中村ヘルプ' }], staffOv: {} }, 1);
  assert.ok(w.some((x) => /中抜けの時間\(14:00〜16:00は不在\)/.test(x)), '中抜けの時間に入ったヘルプは時間のエラー ' + w.join('/'));
  // カレンダーの職員時間変更「中抜け」：その日の中抜け → staffOv。かかる便・予定は保留へ、予定を消すと元に戻る
  const sh = Object.assign(E.emptySheet(), { blocks: [{ id: 'nb1', staffId: ni.id, time: '13:30', durMin: 30, kind: 'help', label: 'ヘルプ' }, { id: 'nb2', staffId: ni.id, time: '10:00', durMin: 30, kind: 'help', label: 'ヘルプ2' }] });
  const ev1 = { id: 'evaw1', rev: 1, date: D, endDate: D, allDay: true, title: '新見 中抜け', sg: { type: 'shift', staff: ['新見'], wstart: '09:30', wend: '19:00', afrom: '13:00', ato: '15:00', reason: '中抜け' } };
  const T = require('./calcore.js'); const nz = T.normSg(ev1.sg); assert.ok(nz.afrom === '13:00' && nz.ato === '15:00', '中抜けの時刻を持つ');
  assert.ok(!('afrom' in T.normSg({ type: 'staff_off', staff: ['x'], afrom: '13:00', ato: '15:00' })), '職員時間変更だけ');
  const r1 = C.reconcile(m, sh, [{ ...ev1, sg: nz }], D);
  assert.deepStrictEqual(r1.staffOv[ni.id], { start: '9:30', end: '19:00', awayFrom: '13:00', awayTo: '15:00' });
  assert.strictEqual(r1.blocks.find((b) => b.id === 'nb1').staffId, E.HOLD_ID, '中抜けにかかる予定は保留へ');
  assert.strictEqual(r1.blocks.find((b) => b.id === 'nb2').staffId, ni.id, 'かからない予定はそのまま');
  assert.ok(/中抜け13:00〜15:00/.test(C.summary(m, r1, [{ ...ev1, sg: nz }], D).find((x) => x.id === 'evaw1').time));
  const r2 = C.reconcile(m, r1, [], D);
  assert.ok(!(ni.id in r2.staffOv), '予定を消すと元に戻る'); assert.strictEqual(r2.blocks.find((b) => b.id === 'nb1').staffId, ni.id, '保留から元の担当へ');
  const r3 = C.reconcile(m, sh, [{ ...ev1, sg: T.normSg({ type: 'shift', staff: ['新見'], noAway: true }) }], D);
  assert.deepStrictEqual(r3.staffOv[ni.id], { noAway: true }, 'この日は中抜けなし');
  console.log('away OK');
}
// ===== 遅刻・早退（職員時間変更の中身）・家族迎えの時刻（2026-11-06 依頼者） =====
{
  const D = '2026-11-02', T = require('./calcore.js'), ks = S('春日'), mo = U('森');
  assert.ok(T.normEvent({ id: 'evlate1', title: 'x', date: D, endDate: D, allDay: true, label: 'late' }, 'evlate1', 0).label === 'late', 'ラベル late/early を残す');
  const L = [{ id: 'evl1', rev: 1, date: D, endDate: D, allDay: true, title: '春日 10:00出勤（遅刻）', label: 'late', sg: T.normSg({ type: 'shift', staff: ['春日'], wstart: '10:00', reason: '遅刻' }) },
    { id: 'eve1', rev: 1, date: D, endDate: D, allDay: true, title: '春日 15:30早退', label: 'early', sg: T.normSg({ type: 'shift', staff: ['春日'], wend: '15:30', reason: '早退' }) },
    { id: 'evf1', rev: 1, date: D, endDate: D, allDay: true, title: '森 家族迎え16:30', label: 'ride', sg: T.normSg({ type: 'user_time', users: ['森'], noSend: '家族迎え16:30' }) }];
  const x = C.reconcile(m, sheet, L, D);
  assert.deepStrictEqual(x.staffOv[ks.id], { start: '10:00', end: '15:30' }, '遅刻と早退の両方');
  assert.strictEqual(x.noRide[mo.id].send, '家族迎え16:30', '家族迎えは時刻つきの理由で入る');
  assert.ok(!(x.userTime || {})[mo.id], '送りの時刻（便）は変えない');
  console.log('late/early/family time OK');
}
// ===== ヘルプキャンセル（いつものヘルプをその日だけなし。2026-11-07 依頼者） =====
{
  const D = '2026-11-02', T = require('./calcore.js');
  const hs = sheet.blocks.filter((b) => b.kind === 'help');
  const nm = ['中村', '黒田', '井上'].find((n) => hs.some((b) => String(b.label).startsWith(n))); assert.ok(nm, '月曜のパターンにヘルプがある');
  const mine = hs.filter((b) => String(b.label).startsWith(nm)); const t0 = mine[0].time;
  assert.ok(T.normSg({ type: 'help_cancel', users: [nm], at: '16:00' }).at === '16:00' && !('at' in T.normSg({ type: 'help', users: [nm], at: '16:00' })), 'at はキャンセルだけ');
  const ev = (sg) => [{ id: 'evhc1', rev: 1, date: D, endDate: D, allDay: true, title: nm + ' ヘルプキャンセル', label: 'hcancel', sg: T.normSg(sg) }];
  const all = C.reconcile(m, sheet, ev({ type: 'help_cancel', users: [nm] }), D);
  assert.strictEqual(all.blocks.filter((b) => b.kind === 'help' && String(b.label).startsWith(nm)).length, 0, 'その日のその人のヘルプは全部なし');
  assert.strictEqual(all.blocks.length, sheet.blocks.length - mine.length, 'ほかのコマはそのまま');
  assert.ok(/ヘルプをなしに（\d+件）/.test(C.summary(m, all, ev({ type: 'help_cancel', users: [nm] }), D)[0].time));
  const one = C.reconcile(m, sheet, ev({ type: 'help_cancel', users: [nm], at: t0.padStart(5, '0') }), D);   // 画面の時刻は 08:00 の形
  assert.strictEqual(one.blocks.filter((b) => String(b.label).startsWith(nm) && b.time === t0).length, 0, '時刻を選ぶとその時刻だけ');
  assert.strictEqual(one.blocks.filter((b) => String(b.label).startsWith(nm)).length, mine.filter((b) => b.time !== t0).length);
  // パターン読込でまた入っても消える・予定を消すと元に戻る
  const re = C.reconcile(m, Object.assign({}, all, { blocks: [...all.blocks, ...mine.map((b) => ({ ...b, id: b.id + 'x' }))] }), ev({ type: 'help_cancel', users: [nm] }), D);
  assert.strictEqual(re.blocks.filter((b) => String(b.label).startsWith(nm)).length, 0, 'パターン読込でまた入っても消す');
  const back = C.reconcile(m, re, [], D);
  assert.strictEqual(back.blocks.filter((b) => String(b.label).startsWith(nm)).length, mine.length, '予定を消すと元に戻る（二重にならない）');
  // 名前が似た人は消さない（森 と 森井）
  const s2 = Object.assign({}, sheet, { blocks: [{ id: 'm1', kind: 'help', time: '10:00', label: '森井ヘルプ', staffId: S('日野').id }, { id: 'm2', kind: 'help', time: '11:00', label: '森ヘルプ', staffId: S('日野').id }] });
  const r2 = C.reconcile(m, s2, [{ id: 'evhc2', rev: 1, date: D, endDate: D, allDay: true, title: '森 ヘルプキャンセル', sg: T.normSg({ type: 'help_cancel', users: ['森'] }) }], D);
  assert.deepStrictEqual(r2.blocks.map((b) => b.label), ['森井ヘルプ'], '森井さんのヘルプは残す');
  console.log('help cancel OK', nm, mine.length + '件');
}
// ===== リベルタ利用（ﾏﾝｼｮﾝの泊まり なし/あり。〇日の夜から〜〇日の朝。2026-11-07 依頼者） =====
{
  const T = require('./calcore.js'), nk = U('中村');
  const ev = { id: 'evlib1', rev: 1, date: '2026-11-02', endDate: '2026-11-04', allDay: true, title: '中村 リベルタなし（2日夜〜4日朝）', label: 'liberta', sg: T.normSg({ type: 'liberta', users: ['中村'], lib: 'off', lfrom: 'pm', lto: 'am' }) };
  assert.deepStrictEqual([ev.sg.lib, ev.sg.lfrom, ev.sg.lto], ['off', 'pm', 'am']);
  const on = (date) => C.reconcile(m, sheet, [ev], date);
  assert.deepStrictEqual(on('2026-11-02').libertaOff[nk.id], { pm: true }, '開始日は夜だけ');
  assert.deepStrictEqual(on('2026-11-03').libertaOff[nk.id], { am: true, pm: true }, '間の日は朝・夜');
  assert.deepStrictEqual(on('2026-11-04').libertaOff[nk.id], { am: true }, '終了日は朝だけ');
  assert.ok(!(on('2026-11-05').libertaOff || {})[nk.id], '次の日は入らない');
  const r = on('2026-11-03'); assert.ok(!((C.reconcile(m, r, [], '2026-11-03').libertaOff || {})[nk.id]), '予定を消すと元に戻る');
  assert.match(C.summary(m, r, [ev], '2026-11-03')[0].time, /リベルタ朝・夜なし/);
  const one = C.reconcile(m, sheet, [{ ...ev, id: 'evlib2', endDate: '2026-11-02', sg: T.normSg({ type: 'liberta', users: ['中村'], lib: 'on', lfrom: 'am', lto: 'am' }) }], '2026-11-02');
  assert.deepStrictEqual(one.libertaOn[nk.id], { am: true }, '同じ日の朝だけ・あり');
  // パターン読込などで消えても入れ直す
  assert.deepStrictEqual(C.reconcile(m, Object.assign({}, r, { libertaOff: {} }), [ev], '2026-11-03').libertaOff[nk.id], { am: true, pm: true });
  console.log('liberta OK');
}
// 迎えなし（受診後来所など）・送りなしにしたら、その日の迎え／送りの便から外す・予定を消すと元の便の元の位置に戻る・パターン読込でまた入っても外す（2026-11-10 依頼者）
{
 const D='2026-11-02';
 const mr=sheet.runs.find(r=>r.kind==='meet'&&(r.userIds||[]).length>=2), uid=mr.userIds[1], un=m.users.find(u=>u.id===uid).name;
 const sr=sheet.runs.find(r=>r.kind==='send'&&(r.userIds||[]).includes(uid));
 const ev={id:'pl1',rev:1,date:D,endDate:D,allDay:true,title:un+' 受診後来所',sg:{type:'user_time',users:[un],noMeet:'受診後来所'}};
 const x=C.reconcile(m,sheet,[ev],D);
 assert.deepStrictEqual(x.noRide[uid],{meet:'受診後来所'});
 assert.ok(!x.runs.some(r=>r.kind==='meet'&&(r.userIds||[]).includes(uid)),'迎えの便から外れる');
 if(sr) assert.ok(x.runs.find(r=>r.id===sr.id).userIds.includes(uid),'送りの便はそのまま');
 assert.deepStrictEqual(sheet.runs.find(r=>r.id===mr.id).userIds,mr.userIds,'元の表は変えない');
 assert.strictEqual(C.reconcile(m,x,[ev],D),x,'同じ内容なら変更なし');
 const back=C.reconcile(m,x,[],D);
 assert.deepStrictEqual(back.runs.find(r=>r.id===mr.id).userIds,mr.userIds,'予定を消すと元の便の元の位置に戻る');
 assert.ok(!(back.noRide||{})[uid],'迎えなしも外れる');
 // パターン読込で便が元に戻ったら、また外す
 const wiped=Object.assign({},x,{runs:JSON.parse(JSON.stringify(sheet.runs))});
 assert.ok(!C.reconcile(m,wiped,[ev],D).runs.some(r=>r.kind==='meet'&&(r.userIds||[]).includes(uid)),'パターン読込で戻っても外す');
 // 送迎表で迎えなしの理由を手で別のものに変えたら、便に乗せても外さない
 { const h=JSON.parse(JSON.stringify(x)); h.noRide[uid]={meet:'手で変えた理由'}; h.runs.find(r=>r.id===mr.id).userIds.push(uid); const hr=C.reconcile(m,h,[ev],D);
   assert.ok(hr.runs.find(r=>r.id===mr.id).userIds.includes(uid),'理由を手で変えたあとは便から外さない'); }
 // 手で別の迎えの便に乗せたら、予定を消しても二重にしない
 const other=x.runs.find(r=>r.kind==='meet'&&r.id!==mr.id); const y=JSON.parse(JSON.stringify(x)); y.runs.find(r=>r.id===other.id).userIds.push(uid);
 const yb=C.reconcile(m,y,[],D); assert.strictEqual(yb.runs.filter(r=>r.kind==='meet'&&r.userIds.includes(uid)).length,1,'手で乗せた便だけ（二重にしない）');
 // 送りなし（家族迎え）も送りの便から外す
 if(sr){ const z=C.reconcile(m,sheet,[{id:'pl2',rev:1,date:D,endDate:D,allDay:true,title:un+' 家族迎え',sg:{type:'user_time',users:[un],noSend:'家族迎え'}}],D);
   assert.ok(!z.runs.some(r=>r.kind==='send'&&r.userIds.includes(uid)),'送りの便から外れる'); }
 console.log('noRide pull OK',un);
}
// いつもは家族送迎の人（馬場）を、この日はこちらから迎える（2026-11-11 依頼者「送迎変更ラベルで」）
{
 const D='2026-11-02', u=m.users.find(x=>x.name==='馬場');
 assert.ok(u&&u.noRideDefault&&u.noRideDefault.meet,'馬場はいつも家族送り');
 const ev={id:'ev_go000001',rev:1,date:D,endDate:D,allDay:true,title:'馬場 こちらから迎え9:00',label:'ride',sg:{type:'user_time',users:['馬場'],staff:[],meet:'9:00',goMeet:true}};
 const x=C.reconcile(m,sheet,[ev],D), nr=(x.noRide||{})[u.id];
 assert.ok(nr&&nr.meet===''&&nr.send===u.noRideDefault.send,'迎えだけ送迎する・送りはいつもの家族迎え '+JSON.stringify(nr));
 assert.strictEqual((x.userTime||{})[u.id].meet,'9:00','迎えの時刻');
 // 送迎表の画面と同じ合わせ方（いつもの送迎なし＋その日の値）で、迎えは送迎する＝未割当に出る
 const eff=Object.assign({},{[u.id]:u.noRideDefault},x.noRide||{})[u.id];
 assert.ok(!eff.meet&&eff.send,'迎えは送迎なしでなくなる');
 const back=C.reconcile(m,x,[],D);
 assert.ok(!(back.noRide||{})[u.id]&&!((back.userTime||{})[u.id]||{}).meet,'予定を消すといつもどおり '+JSON.stringify((back.noRide||{})[u.id]));
 const both={...ev,id:'ev_go000002',sg:{...ev.sg,goSend:true,send:'17:00'}}, xb=C.reconcile(m,sheet,[both],D);
 assert.deepStrictEqual(xb.noRide[u.id],{meet:'',send:''},'迎え・送りとも');
 console.log('go meet OK');
}
// 欠席にした人は迎え・送りの便から外す・パターン読込でまた入っても外す・予定を消すと戻る（2026-11-11 依頼者「欠席者含むになっていじれない」）
{
 const D='2026-11-02', r0=sheet.runs.find(r=>r.kind==='meet'&&(r.userIds||[]).length), uid0=r0.userIds[0], un=m.users.find(u=>u.id===uid0).name;
 const ev={id:'ev_abs00001',rev:1,date:D,endDate:D,allDay:true,title:un+' 欠席',label:'user',sg:{type:'user_absent',users:[un],staff:[]}};
 const x=C.reconcile(m,sheet,[ev],D);
 assert.ok(x.userAbsent[uid0]&&!x.runs.some(r=>(r.userIds||[]).includes(uid0)),'欠席の人は便から外れる');
 const re=JSON.parse(JSON.stringify(x)); re.runs=JSON.parse(JSON.stringify(sheet.runs));   // パターン読込でまた入った
 assert.ok(!C.reconcile(m,re,[ev],D).runs.some(r=>(r.userIds||[]).includes(uid0)),'パターン読込のあとも外す');
 const back=C.reconcile(m,x,[],D);
 assert.ok(!back.userAbsent[uid0]&&back.runs.find(r=>r.id===r0.id).userIds.includes(uid0),'予定を消すと元の便に戻る');
 console.log('absent pull OK',un);
}
// 休日出勤の中抜け（2026-11-10 依頼者「6:00〜9:00と17:00〜22:00のときは9:00〜17:00が不在の網掛けに」）
{
 const D='2026-11-02', sid=S('白戸').id;
 const ev={id:'ev_hwa00001',rev:1,date:D,endDate:D,allDay:false,start:'06:00',end:'22:00',title:'白戸 休日出勤（中抜け09:00〜17:00）',sg:{type:'hwork',staff:['白戸'],afrom:'09:00',ato:'17:00'}};
 const TC=require('./calcore.js'); const n=TC.normEvent(ev,ev.id,0); assert.deepStrictEqual([n.sg.afrom,n.sg.ato],['09:00','17:00'],'カレンダーに中抜けが残る');
 const x=C.reconcile(m,sheet,[n],D);
 assert.deepStrictEqual(x.staffOv[sid],{workToday:true,start:'6:00',end:'22:00',awayFrom:'9:00',awayTo:'17:00'},'送迎表の中抜け（灰色）に入る');
 assert.ok(!(C.reconcile(m,x,[],D).staffOv||{})[sid],'予定を消すと外れる');
 const n2=TC.normEvent(Object.assign({},ev,{sg:{type:'hwork',staff:['白戸'],noAway:true}}),ev.id,0);
 assert.strictEqual(C.reconcile(m,sheet,[n2],D).staffOv[sid].noAway,true,'この日は中抜けなし');
 console.log('hwork away OK');
}
// 利用者その他（時間あり）は保留の欄にコマ（2026-11-10 依頼者「山崎 入浴」がコマに出ない）。終日は出さない
{
 const D='2026-11-02', un=m.users[0].name;
 const ev={id:'ev_uoth0001',rev:1,date:D,endDate:D,allDay:false,start:'10:00',end:'11:00',title:un+' 入浴',label:'uother',users:[un]};
 const x=C.reconcile(m,sheet,[ev],D), b=x.blocks.find(b=>b.id==='cal_ev_uoth0001_hold');
 assert.ok(b&&b.staffId==='__hold__'&&b.time==='10:00'&&b.durMin===60&&b.label===un+' 入浴','保留の欄にコマ '+JSON.stringify(b));
 assert.ok(!C.reconcile(m,x,[],D).blocks.some(b=>b.id==='cal_ev_uoth0001_hold'),'予定を消すとコマも消える');
 // 終日も 8:30 にコマ（「終日」は付けない。2026-11-10 依頼者）
 const ad=Object.assign({},ev,{allDay:true,start:'',end:''}), xa=C.reconcile(m,sheet,[ad],D), ba=xa.blocks.find(b=>b.id==='cal_ev_uoth0001_hold');
 assert.ok(ba&&ba.time==='8:30'&&ba.label===un+' 入浴'&&ba.staffId==='__hold__','終日は8:30にコマ '+JSON.stringify(ba));
 // 送迎表で「コマだけ消す」にしたら、予定を直しても消したまま
 const xn=JSON.parse(JSON.stringify(x)); xn.blocks.find(b=>b.id==='cal_ev_uoth0001_hold').noteOnly=true;
 assert.strictEqual(C.reconcile(m,xn,[ev],D).blocks.find(b=>b.id==='cal_ev_uoth0001_hold').noteOnly,true,'そのまま');
 const ev2=Object.assign({},ev,{rev:2,start:'10:30',end:'11:30'}), xr=C.reconcile(m,xn,[ev2],D).blocks.find(b=>b.id==='cal_ev_uoth0001_hold');
 assert.ok(xr&&xr.noteOnly===true&&xr.time==='10:30','予定の時刻を直しても消したまま（時刻は付いていく） '+JSON.stringify(xr));
 // 題名に利用者の名前が無い以前の予定でも、コマは「名前 内容」（2026-11-10 依頼者「利用者が消えてただのその他予定で表示」）
 { const e3=Object.assign({},ev,{id:'ev_uoth0003',title:'入浴'}), b3=C.reconcile(m,sheet,[e3],D).blocks.find(b=>b.id==='cal_ev_uoth0003_hold');
   assert.ok(b3&&b3.label===un+' 入浴'&&(b3.userIds||[]).length===1,'名前つき '+JSON.stringify(b3));
   const e4=Object.assign({},ev,{id:'ev_uoth0004',title:''}), b4=C.reconcile(m,sheet,[e4],D).blocks.find(b=>b.id==='cal_ev_uoth0004_hold');
   assert.ok(b4&&b4.label===un+' その他','題名なし '+JSON.stringify(b4)); }
 console.log('uother koma OK');
}
// 職員その他・その他予定もコマ（2026-11-10 依頼者「その他予定もコマで。利用者・職員のその他と同じように」）
{
 const D='2026-11-02', st=m.staff.find(s=>!s.part&&s.name)||m.staff[0];
 const so={id:'ev_soth0001',rev:1,date:D,endDate:D,allDay:false,start:'13:00',end:'14:00',title:st.name+' 研修',label:'sother',tanto:[st.name]};
 const x=C.reconcile(m,sheet,[so],D), b=x.blocks.find(b=>b.id==='cal_ev_soth0001_'+st.id);
 assert.ok(b&&b.staffId===st.id&&b.time==='13:00'&&b.durMin===60,'職員その他は担当の欄にコマ '+JSON.stringify(b));
 const sa=Object.assign({},so,{allDay:true,start:'',end:''}), ba=C.reconcile(m,sheet,[sa],D).blocks.find(b=>b.id==='cal_ev_soth0001_'+st.id);
 assert.ok(ba&&ba.time==='8:30'&&ba.durMin===60,'終日は8:30から1時間 '+JSON.stringify(ba));
 const ot={id:'ev_oth00001',rev:1,date:D,endDate:D,allDay:false,start:'15:00',end:'15:30',title:'避難訓練',label:'other',tanto:[]};
 const xo=C.reconcile(m,sheet,[ot],D), bo=xo.blocks.find(b=>b.id==='cal_ev_oth00001_hold');
 assert.ok(bo&&bo.staffId==='__hold__'&&bo.label==='避難訓練'&&bo.durMin===30,'担当なしのその他予定は保留の欄 '+JSON.stringify(bo));
 const ot2=Object.assign({},ot,{id:'ev_oth00002',tanto:[st.name]}), bo2=C.reconcile(m,sheet,[ot2],D).blocks.find(b=>b.id==='cal_ev_oth00002_'+st.id);
 assert.ok(bo2&&bo2.staffId===st.id,'担当つきのその他予定は担当の欄');
 // ほかの事業・シフト表の予定・TimeTreeの予定・ほかの事業でこの版にいない担当はコマにしない
 const no=[Object.assign({},ot,{id:'ev_oth00003',biz:'houkago'}),Object.assign({},so,{id:'ev_oth00005',tanto:['だれでもない人'],biz:'houkago'}),
   Object.assign({},so,{id:'shm20261102_a'}),Object.assign({},ot,{id:'tt20261102_01'})];
 const xn=C.reconcile(m,sheet,no,D);
 assert.ok(!xn.blocks.some(b=>/ev_oth0000[35]|shm2026|tt2026/.test(b.id)),'入れない '+JSON.stringify(xn.blocks.filter(b=>/^cal_/.test(b.id))));
 // 担当がこの版の職員にいなくても、同じ事業の予定なら保留の欄に出して「見つからない名前」に出す（2026-11-11 依頼者「小瀧研修 出てない（現体制版）」）
 // TimeTreeから写した予定を職員その他に直したものはコマにする（写したままのその他予定はしない）
 const tts=Object.assign({},so,{id:'tt20261102_02'}), xt=C.reconcile(m,sheet,[tts],D);
 assert.ok(xt.blocks.some(b=>b.calId==='tt20261102_02'),'TimeTreeの予定を職員その他に直したらコマ');
 const kt=Object.assign({},so,{id:'ev_oth00004',title:'小瀧X 研修',tanto:['小瀧X'],allDay:true,start:'',end:''}), xk=C.reconcile(m,sheet,[kt],D), bk=xk.blocks.find(b=>b.calId==='ev_oth00004');
 assert.ok(bk&&bk.staffId==='__hold__'&&bk.label==='小瀧X 研修'&&bk.time==='8:30','保留の欄 '+JSON.stringify(bk));
 const sk=C.summary(m,xk,[kt],D).find(x=>x.id==='ev_oth00004');
 assert.ok(sk&&(sk.missingStaff||[]).includes('小瀧X'),'反映中に見つからない名前 '+JSON.stringify(sk));
 assert.ok(!C.reconcile(m,xo,[],D).blocks.some(b=>b.id==='cal_ev_oth00001_hold'),'予定を消すとコマも消える');
 console.log('other koma OK');
}
