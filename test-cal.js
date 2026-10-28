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
