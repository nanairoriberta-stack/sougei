
"use strict";
const APP_VERSION="2026.10.27c";
const C=window.TCCore;
const LABELS=[{k:"help",n:"ヘルプ"},{k:"ride",n:"送迎"},{k:"leave",n:"職員休み"},{k:"user",n:"利用者休み"},{k:"other",n:"その他予定"},{k:"hwork",n:"休日出勤"}];
const LMAP=Object.fromEntries(LABELS.map(l=>[l.k,l]));
const HOL={
"2026-01-01":"元日","2026-01-12":"成人の日","2026-02-11":"建国記念の日","2026-02-23":"天皇誕生日","2026-03-20":"春分の日","2026-04-29":"昭和の日","2026-05-03":"憲法記念日","2026-05-04":"みどりの日","2026-05-05":"こどもの日","2026-05-06":"振替休日","2026-07-20":"海の日","2026-08-11":"山の日","2026-09-21":"敬老の日","2026-09-22":"国民の休日","2026-09-23":"秋分の日","2026-10-12":"スポーツの日","2026-11-03":"文化の日","2026-11-23":"勤労感謝の日",
"2027-01-01":"元日","2027-01-11":"成人の日","2027-02-11":"建国記念の日","2027-02-23":"天皇誕生日","2027-03-21":"春分の日","2027-03-22":"振替休日","2027-04-29":"昭和の日","2027-05-03":"憲法記念日","2027-05-04":"みどりの日","2027-05-05":"こどもの日","2027-07-19":"海の日","2027-08-11":"山の日","2027-09-20":"敬老の日","2027-09-23":"秋分の日","2027-10-11":"スポーツの日","2027-11-03":"文化の日","2027-11-23":"勤労感謝の日"};
const WD=["日","月","火","水","木","金","土"];
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse=s=>{const[a,b,c]=s.split("-").map(Number);return new Date(a,b-1,c)};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const lab=k=>LMAP[k]?k:"other";
const $=id=>document.getElementById(id);
const fmtAt=s=>{const d=new Date(s);return isNaN(d)?"":`${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`};

let ls=null;try{ls=window.localStorage}catch{}
const store=C.makeStore(ls||{getItem(){throw 0},setItem(){throw 0},removeItem(){},key(){return null},length:0});
let db=null,user=null,downloads=null,core=null,unsub=null,unsubCm=null;
let TODAY=ymd(new Date());
const S={cursor:new Date(new Date().getFullYear(),new Date().getMonth(),1),sel:TODAY,view:"month",mine:false,label:"all",
  server:{},loaded:false,me:null,canWrite:true,isAdmin:false,dbState:"connecting",online:navigator.onLine!==false};

function gridRange(){const s=addDays(S.cursor,-S.cursor.getDay());return{start:s,end:addDays(s,41)}}
function allEvents(){return core?Object.values(core.overlay(S.server)):Object.values(S.server)}
function visible(){return allEvents().filter(e=>!e.deleted&&pass(e))}
function pass(e){if(S.label!=="all"&&e.label!==S.label)return false;if(S.mine&&!(S.me&&e.members.includes(S.me)))return false;return true}
function cmp(a,b){const sa=a.date!==a.endDate,sb=b.date!==b.endDate;if(sa!==sb)return sa?-1:1;if(a.allDay!==b.allDay)return a.allDay?-1:1;return(a.start||"").localeCompare(b.start||"")||a.title.localeCompare(b.title)}
function on(list,day){return list.filter(e=>e.date<=day&&e.endDate>=day).sort(cmp)}
function timeText(e){const md=s=>{const d=parse(s);return`${d.getMonth()+1}/${d.getDate()}`};
  if(e.date!==e.endDate)return e.allDay?`${md(e.date)}–${md(e.endDate)}`:`${md(e.date)} ${e.start}–${md(e.endDate)} ${e.end}`;return e.allDay?"終日":`${e.start}–${e.end}`}
async function profiles(ids){if(!user||!ids.length)return{};try{return await user.profiles([...new Set(ids)])}catch{return{}}}
let tt;function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,3200)}

/* ---------- 描画（失敗しても白画面にしない） ---------- */
let seq=0,raf=0;
function render(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;renderSafe()})}
async function renderSafe(){
  const my=++seq;
  try{
    const y=S.cursor.getFullYear(),m=S.cursor.getMonth()+1;
    $("monthLabel").innerHTML=`<span>${y}</span>年<span>${m}</span>月`;
    for(const[id,v]of[["vMonth","month"],["vList","list"],["vTrash","trash"]])$(id).setAttribute("aria-pressed",S.view===v);
    $("monthView").hidden=S.view!=="month";$("listView").hidden=S.view==="month";
    $("addBtn").disabled=!(db&&S.canWrite&&core&&!core.status().paused);
    renderSync();renderFilters();renderNotices();
    const vis=visible();
    const ps=await profiles(vis.flatMap(e=>e.members));
    if(my!==seq)return;
    if(S.view==="month")renderGrid(vis);else if(S.view==="list")renderList(vis,ps);else renderTrash();
    renderPanel(vis,ps);
    if(ed)liveCheck();
  }catch(e){
    $("app").insertAdjacentHTML("afterbegin",`<div class="render-err" style="grid-column:1/-1">画面を表示できませんでした（${esc(e&&e.message)}）。入力済みのデータは端末に保存されています。再読み込みしてください。</div>`);
  }
}
function renderSync(){
  const b=$("syncBtn"),t=$("syncText");let s="ok",txt="保存済み ✓";
  if(S.dbState==="none"){s="bad";txt="共有に接続できません"}
  else if(!core){s="busy";txt="接続中…"}
  else{const st=core.status();
    if(st.paused){s="bad";txt=st.paused==="outdated_client"?"新しい版があります":"送信を停止中"}
    else if(st.conflicts.length||st.failed.length){s="bad";txt=`要確認 ${st.conflicts.length+st.failed.length}件`}
    else if(st.queued){s=S.online&&!st.lastError?"busy":"warn";txt=S.online&&!st.lastError?`送信中 ${st.queued}件`:`未送信 ${st.queued}件：自動で再送します`}
    else if(!S.loaded){s="busy";txt="読み込み中…"}
    else if(!S.online){s="warn";txt="オフライン"}}
  b.dataset.s=s;t.textContent=txt;
}
function renderFilters(){
  $("filters").innerHTML=[`<button class="chip" data-mine aria-pressed="${S.mine}" ${S.me?"":"disabled"}>自分が参加する予定</button>`,
    `<button class="chip" data-label="all" aria-pressed="${S.label==="all"}">すべて</button>`,
    ...LABELS.map(l=>`<button class="chip" data-label="${l.k}" aria-pressed="${S.label===l.k}"><i class="dot" style="background:var(--l-${l.k})"></i>${l.n}</button>`)].join("");
}
function renderNotices(){
  const n=[];
  if(S.dbState==="none")n.push(["bad","共有データに接続できません。claude.ai にサインインした状態で開くと、チームの予定を読み書きできます。",""]);
  if(S.dbState==="error")n.push(["bad","予定の読み込みが止まりました。表示中の予定は直前の内容です。入力は端末に保存されるので消えません。",`<button class="ghost sm" data-reload>再読み込み</button>`]);
  if(core&&core.status().paused==="outdated_client")n.push(["bad","このカレンダーの新しい版が使われています。古い版のまま書き込むとデータを壊すおそれがあるため、送信を止めています。入力した内容は端末に残っています。",`<button class="primary sm" data-reload>最新版を読み込む</button>`]);
  if(!S.canWrite&&S.dbState==="ok")n.push(["","閲覧のみの権限です。予定を追加・編集するには、共有メニューで「投稿者」以上の権限をもらってください。",""]);
  if(!store.persistent)n.push(["warn","このブラウザでは端末への一時保存が使えません（プライベートモードなど）。未送信の予定がある間は画面を閉じないでください。",""]);
  if(!S.online)n.push(["warn","オフラインです。追加・編集した予定は端末に保存され、接続が戻ると自動で送信されます。",""]);
  const d=draftGet();if(d&&!ed)n.push(["warn",`書きかけの予定「${esc(d.form.title||"（無題）")}」が残っています（${fmtAt(d.savedAt)}）。`,`<button class="primary sm" data-draft-open>続きを書く</button><button class="ghost sm" data-draft-drop>破棄</button>`]);
  $("notices").innerHTML=n.map(([c,t,a])=>`<div class="note ${c}"><p>${t}</p>${a}</div>`).join("");
}
function chip(e){const span=e.date!==e.endDate;
  return`<button class="ev-chip${span?" span":""}${e.pending?" pend":""}" data-ev="${esc(e.id)}" style="--c:var(--l-${lab(e.label)})" aria-label="${esc(e.title)}">${!span&&!e.allDay?`<b>${esc(e.start)}</b>`:""}<span>${esc(e.title)}</span></button>`}
function renderGrid(vis){
  const{start}=gridRange();const tm=S.cursor.getMonth();let html="";
  for(let i=0;i<42;i++){const d=addDays(start,i),k=ymd(d),evs=on(vis,k),hol=HOL[k];
    const cls=["cell",d.getMonth()!==tm&&"out",k===TODAY&&"today",k===S.sel&&"sel",d.getDay()===0&&"su",d.getDay()===6&&"sa",hol&&"hol"].filter(Boolean).join(" ");
    html+=`<div class="${cls}" role="button" tabindex="0" data-day="${k}" aria-label="${d.getMonth()+1}月${d.getDate()}日 ${evs.length}件"><div class="cell-head"><span class="num">${d.getDate()}</span>${hol?`<span class="hol-name">${hol}</span>`:""}</div>${evs.slice(0,3).map(chip).join("")}${evs.length>3?`<span class="more">他${evs.length-3}件</span>`:""}</div>`}
  $("grid").innerHTML=html;
}
function evRow(e,ps){
  const av=e.members.slice(0,6).map(id=>ps[id]?`<img src="${esc(ps[id].avatarUrl)}" alt="${esc(ps[id].name||"メンバー")}" title="${esc(ps[id].name||"メンバー")}">`:"").join("");
  return`<li><button class="ev-row" data-ev="${esc(e.id)}" style="--c:var(--l-${lab(e.label)})"><span class="stripe"></span><span><div class="t">${esc(e.title)}</div><div class="meta"><span class="time">${timeText(e)}</span><span>${esc(LMAP[e.label]?.n||"その他")}</span>${e.place?`<span>${esc(e.place)}</span>`:""}${e.pending?`<span class="tag-pend">未送信</span>`:""}${e.sg?`<span class="tag-sg">${esc(sgText(e.sg))}</span>`:""}</div>${av?`<div class="avatars">${av}</div>`:""}</span></button></li>`}
function renderPanel(vis,ps){
  const d=parse(S.sel),evs=on(vis,S.sel),hol=HOL[S.sel],can=db&&S.canWrite&&core;
  let body;
  if(!S.loaded&&S.dbState==="connecting")body=`<div class="empty">予定を読み込んでいます…</div>`;
  else if(!evs.length)body=`<div class="empty">この日の予定はまだありません。${can?"<br>「この日に追加」から登録できます。":""}</div>`;
  else body=`<ul class="ev-list">${evs.map(e=>evRow(e,ps)).join("")}</ul>`;
  const q=quickHtml();
  $("panel").innerHTML=q+`<div class="panel-head"><div class="panel-date">${d.getMonth()+1}月${d.getDate()}日（${WD[d.getDay()]}）<small>${hol?esc(hol)+" · ":""}${evs.length}件の予定</small></div><button class="primary" data-add-day ${can?"":"disabled"}>この日に追加</button></div>${body}`;
}
function renderList(vis,ps){
  const{start}=gridRange();const tm=S.cursor.getMonth();let html="";
  for(let i=0;i<42;i++){const d=addDays(start,i);if(d.getMonth()!==tm)continue;const k=ymd(d),evs=on(vis,k);if(!evs.length)continue;
    const c=[d.getDay()===0&&"su",d.getDay()===6&&"sa",HOL[k]&&"hol"].filter(Boolean).join(" ");
    html+=`<div class="ag-day"><div class="ag-date ${c}">${d.getMonth()+1}/${d.getDate()}<small>${WD[d.getDay()]}曜${HOL[k]?" · "+HOL[k]:""}</small></div><ul class="ev-list">${evs.map(e=>evRow(e,ps)).join("")}</ul></div>`}
  $("listView").innerHTML=html||`<div class="empty" style="margin-top:8px">${S.loaded?"この月の予定はありません。":"予定を読み込んでいます…"}</div>`;
}
function renderTrash(){
  const tm=S.cursor.getMonth(),y=S.cursor.getFullYear();
  const del=allEvents().filter(e=>e.deleted&&parse(e.date).getMonth()===tm&&parse(e.date).getFullYear()===y).sort((a,b)=>(b.deletedAt||"").localeCompare(a.deletedAt||""));
  const can=db&&S.canWrite&&core;
  $("listView").innerHTML=`<h2>ゴミ箱（${y}年${tm+1}月の予定）</h2><p class="sub">削除した予定は30日間ここに残り、元に戻せます。</p>${del.length?`<div class="ev-list">${del.map(e=>`<div class="trash-row"><div class="grow"><div class="t" style="font-weight:700">${esc(e.title)}</div><div class="meta"><span class="time">${parse(e.date).getMonth()+1}/${parse(e.date).getDate()} ${timeText(e)}</span><span>削除：${fmtAt(e.deletedAt)}</span>${e.pending?`<span class="tag-pend">未送信</span>`:""}</div></div><button class="ghost sm" data-restore="${esc(e.id)}" ${can?"":"disabled"}>元に戻す</button></div>`).join("")}</div>`:`<div class="empty">この月に削除された予定はありません。</div>`}`;
}

/* ---------- 受信（読込）：読めなかったときは何も書かない ---------- */
function subscribe(){
  if(!db)return;unsub?.();S.loaded=false;
  const{start,end}=gridRange();
  try{
    unsub=db.collection("days").where("maxEnd",">=",ymd(start)).where("date","<=",ymd(end)).limit(1000)
      .onSnapshot(snap=>{const docs=snap.docs.map(d=>d.data());S.server=C.mergeDays(docs);S.loaded=true;if(S.dbState==="error")S.dbState="ok";render()},
        ()=>{S.dbState="error";render()});
  }catch{S.dbState="error";render()}
}
function go(delta){S.cursor=new Date(S.cursor.getFullYear(),S.cursor.getMonth()+delta,1);subscribe();render()}

/* ---------- 書きかけ（端末に自動保存） ---------- */
const DKEY="tc:draft";
function draftGet(){try{const v=store.get(DKEY);return v?JSON.parse(v):null}catch{return null}}
let dT;function draftSave(){clearTimeout(dT);dT=setTimeout(()=>{if(!ed||ed.ro)return;try{readForm();store.set(DKEY,JSON.stringify({id:ed.id,base:ed.base,form:ed.d,savedAt:new Date().toISOString()}))}catch{}},500)}
function draftDrop(){clearTimeout(dT);store.del(DKEY)}

/* ---------- ラベルごとの入力項目と、送迎表への反映 ----------
   ラベルを選ぶと、そのラベルで入力する項目が出る。入力内容から「送迎表に反映」(sg) を組み立てる。
   ・ヘルプ … 利用者・担当職員・内容 → 送迎表の【ヘルプ】（担当未定は保留欄）
   ・送迎 … 迎え/送り/その他・利用者・運転する職員・車両・行き先 → 送迎表の便（運転未定は保留欄）
   ・職員休み … 職員・1日/AM休/PM休/時間・理由 → 休み・遅刻早退・不在
   ・利用者休み … 利用者・欠席 or 送迎の変更（迎え・送りそれぞれ いつもどおり/時刻変更/なし）・理由
   ・その他予定 … 題名・時間・場所・参加者・メモ（職員の予定として送迎表に載せることもできる）
   ・休日出勤 … 職員・いつもの勤務時間 or 時間指定・その日の部署 → 送迎表の出勤者に入る */
const HALF={am:"AM休",pm:"PM休"};
const RIDE={meet:"迎え",send:"送り",other_run:"その他の便"};
const SGT_SHORT={staff_off:"職員の休み",staff_plan:"職員の予定",user_absent:"欠席",user_time:"送迎の変更",help:"ヘルプ",ride:"送迎",hwork:"休日出勤"};
const PICK={leave:["有給","公休・希望休","研修・出張","体調不良"],user:["体調不良","受診","家族の用事","ショートステイ"],help:["家事","入浴","通院付き添い","買い物"],ride:["通院","買い物","行事"]};
const LABEL_OF_SG={staff_off:"leave",user_absent:"user",user_time:"user",help:"help",ride:"ride",hwork:"hwork",staff_plan:"other"};
const USER_LABELS=["help","ride","user"];          // 利用者が関わるラベル（送迎表の担当者だけが入力できる）
let SGN={staff:[],users:[],vehicles:[],depts:[],loaded:false};
async function loadNames(){
  const H=window.SGHost;if(!H)return;
  let r=null;try{r=await H.call("names.list")}catch{}
  if(!H.directory().length)await H.loadDirectory();
  SGN={staff:H.directory().filter(d=>d.no!=="000").map(d=>({name:d.name,dept:d.no})),users:r?r.users||[]:SGN.users,vehicles:r?r.vehicles||[]:SGN.vehicles,depts:r?r.depts||[]:SGN.depts,loaded:true};
}
const meInfo=()=>window.SGHost&&window.SGHost.me||{};
const canLabel=k=>{const me=meInfo();return!USER_LABELS.includes(k)||!!(me.canSougei||me.admin)};
const selfOnly=()=>!meInfo().admin;
function sgText(sg){if(!sg)return"";const who=[...(sg.staff||[]),...(sg.users||[])];const t=sg.half?HALF[sg.half]:sg.type==="ride"&&RIDE[sg.kind]&&sg.kind!=="other_run"?RIDE[sg.kind]:SGT_SHORT[sg.type]||"";return`送迎表：${t}（${who.slice(0,4).join("・")}${who.length>4?` 他${who.length-4}名`:""}）`}
/* 予定 → 入力欄の状態(w)。ラベルを切り替えても、選んだ人はそのまま残す */
function workOf(d){
  const sg=d.sg||{};
  return{staff:[...(sg.staff||[])],users:[...(sg.users||[])],reason:sg.reason||"",note:sg.note||"",kind:sg.kind||"meet",vehicle:sg.vehicle||"",dept:sg.dept||"",
    leave:sg.half||(sg.type==="staff_off"&&!d.allDay?"time":"day"),ukind:sg.type==="user_time"?"change":"absent",
    meetM:sg.meet?"time":sg.noMeet?"none":"same",sendM:sg.send?"time":sg.noSend?"none":"same",meet:sg.meet||"",send:sg.send||"",
    hw:sg.type==="hwork"&&!d.allDay?"time":"usual",plan:sg.type==="staff_plan"};
}
/* 入力欄の状態 → 送迎表に反映する内容 */
function sgOf(label,w){
  const base={staff:[...w.staff],users:[...w.users],meet:"",send:"",noMeet:"",noSend:"",half:"",reason:"",note:"",kind:"",vehicle:"",dept:""};
  if(label==="leave")return Object.assign(base,{type:"staff_off",users:[],half:w.leave==="am"||w.leave==="pm"?w.leave:"",reason:w.reason});
  if(label==="user"){
    if(w.ukind==="absent")return Object.assign(base,{type:"user_absent",staff:[],reason:w.reason});
    const why=w.reason;
    return Object.assign(base,{type:"user_time",staff:[],reason:why,meet:w.meetM==="time"?w.meet:"",send:w.sendM==="time"?w.send:"",noMeet:w.meetM==="none"?(why||"迎えなし"):"",noSend:w.sendM==="none"?(why||"送りなし"):""});
  }
  if(label==="help")return Object.assign(base,{type:"help",note:w.note});
  if(label==="ride")return Object.assign(base,{type:"ride",kind:w.kind,vehicle:w.vehicle,note:w.note});
  if(label==="hwork")return Object.assign(base,{type:"hwork",users:[],dept:w.dept});
  if(label==="other"&&w.plan)return Object.assign(base,{type:"staff_plan",users:[]});
  return null;
}
/* ラベルによって、終日かどうかは入力欄から決まる */
function fixTimes(d){
  const w=d.w;
  if(d.label==="leave")d.allDay=w.leave!=="time";
  else if(d.label==="user")d.allDay=true;
  else if(d.label==="help"||d.label==="ride")d.allDay=false;
  else if(d.label==="hwork")d.allDay=w.hw==="usual";
  if(d.label==="leave"&&w.leave!=="time"&&w.leave!=="day")d.endDate=d.date;
}
const staffSelf=d=>selfOnly()&&(d.label==="leave"||d.label==="hwork"||(d.label==="other"&&d.w.plan));
function drawSg(){
  if(!ed)return;const box=$("sgArea");if(!box)return;
  const d=ed.d,w=d.w,ro=ed.ro,me=meInfo(),L=d.label,dis=ro?"disabled":"";
  if(staffSelf(d)&&!ro)w.staff=me.name?[me.name]:[];
  const chips=(kind)=>{const list=w[kind];return list.length?`<div class="sgchips">${list.map((n,i)=>`<span class="sgchip">${esc(n)}${kind==="staff"&&L==="ride"?`<small>${i?"同乗":"運転"}</small>`:""}${ro?"":`<button type="button" data-sgrm="${kind}" data-name="${esc(n)}" aria-label="外す">×</button>`}</span>`).join("")}</div>`:""};
  const picker=(kind,ph)=>ro?"":`<input class="input" id="f-sgq-${kind}" placeholder="${ph}" autocomplete="off"><div class="sghits" id="sghits-${kind}" hidden></div>`;
  const who=(kind,title,ph,empty)=>`<div class="sgsub"><span class="lbl2">${title}</span>${chips(kind)||`<span class="by">${empty||"まだ選ばれていません"}</span>`}${picker(kind,ph)}</div>`;
  const self=`<div class="sgsub"><span class="lbl2">職員</span><div class="sgchips"><span class="sgchip" style="padding-right:10px">${esc(me.name||"")}（自分）</span></div></div>`;
  const radios=(name,cur,opts,c)=>`<div class="labels" role="radiogroup">${opts.map(([k,l])=>`<label style="--c:var(--l-${c||L})"><input type="radio" name="${name}" value="${k}" ${String(cur)===k?"checked":""} ${dis}><span>${l}</span></label>`).join("")}</div>`;
  const text=(id,val,ph,list,title)=>`<div class="sgsub"><label class="lbl2" for="${id}">${title}</label>${list?`<div class="fills">${list.map(x=>`<button type="button" class="fill${val===x?" on":""}" data-fill="${id}" data-v="${esc(x)}" ${dis}>${esc(x)}</button>`).join("")}</div>`:""}<input class="input" id="${id}" maxlength="40" value="${esc(val)}" placeholder="${ph}" ${ro?"readonly":""}></div>`;
  const hint=t=>`<p class="by sghint">${t}</p>`;
  let h="";
  if(!canLabel(L)&&!ro)h=hint("このラベルは送迎表の担当者が入力します。");
  else if(L==="help")h=who("users","だれのヘルプ（利用者）","利用者の名前で検索")+who("staff","担当する職員","職員の名前で検索","未定（送迎表の「保留」欄に入ります）")+text("w-note",w.note,"例：掃除と洗濯",PICK.help,"内容")
    +hint("開始・終了の時刻で、送迎表の担当職員の欄に【ヘルプ】として入ります。");
  else if(L==="ride")h=`<div class="sgsub"><span class="lbl2">種類</span>${radios("w-kind",w.kind,[["meet","迎え"],["send","送り"],["other_run","その他（通院・買い物など）"]])}</div>`
    +who("users","乗る利用者","利用者の名前で検索")+who("staff","運転する職員（2人目からは同乗）","職員の名前で検索","未定（送迎表の「保留」欄に入ります）")
    +`<div class="sgsub"><label class="lbl2" for="w-vehicle">車両</label><select class="input" id="w-vehicle" ${dis}><option value="">あとで決める</option>${[...new Set(SGN.vehicles.concat(w.vehicle?[w.vehicle]:[]))].map(v=>`<option ${v===w.vehicle?"selected":""}>${esc(v)}</option>`).join("")}</select></div>`
    +text("w-note",w.note,"例：○○医院",PICK.ride,"行き先・メモ")
    +hint("開始時刻に出る便として送迎表に入ります。いつもの便にも乗っている利用者は、送迎表で重なりの注意が出るので、どちらかを外してください。");
  else if(L==="leave")h=(staffSelf(d)?self:who("staff","休む職員","職員の名前で検索"))
    +`<div class="sgsub"><span class="lbl2">休みの形</span>${radios("w-leave",w.leave,[["day","1日"],["am","AM休"],["pm","PM休"],["time","時間で（遅刻・早退・中抜け）"]])}</div>`
    +text("w-reason",w.reason,"例：通院",PICK.leave,"理由（任意）")
    +hint(w.leave==="am"?"勤務時間の半分から出勤として送迎表に入ります。":w.leave==="pm"?"勤務時間の半分で退勤として送迎表に入ります。":w.leave==="time"?"開始〜終了の時刻を、送迎表でその職員の不在として入れます。":"送迎表でその日は休みになります。何日も続く休みは終了日を変えてください。");
  else if(L==="user"){
    const dir=(name,cur,t,tv,lbl)=>`<div class="sgsub"><span class="lbl2">${lbl}</span>${radios(name,cur,[["same","いつもどおり"],["time","時刻を変える"],["none",lbl+"なし"]])}${cur==="time"?`<input class="input" type="time" id="${t}" value="${esc(tv)}" step="300" aria-label="${lbl}の時刻" ${ro?"readonly":""}>`:""}</div>`;
    h=who("users","利用者","利用者の名前で検索")
    +`<div class="sgsub"><span class="lbl2">内容</span>${radios("w-ukind",w.ukind,[["absent","お休み（欠席）"],["change","送迎の変更（受診後に来所など）"]])}</div>`
    +(w.ukind==="change"?dir("w-meet",w.meetM,"w-meett",w.meet,"迎え")+dir("w-send",w.sendM,"w-sendt",w.send,"送り"):"")
    +text("w-reason",w.reason,"例：受診後に来所",PICK.user,"理由（任意）")
    +hint(w.ukind==="absent"?"送迎表でその日は欠席になります。何日も続くときは終了日を変えてください。":"変えるところだけ選んでください。「なし」の理由は送迎表にそのまま出ます。");
  }
  else if(L==="hwork")h=(staffSelf(d)?self:who("staff","出勤する職員","職員の名前で検索"))
    +`<div class="sgsub"><span class="lbl2">勤務時間</span>${radios("w-hw",w.hw,[["usual","いつもの勤務時間"],["time","時間を指定"]])}</div>`
    +`<div class="sgsub"><label class="lbl2" for="w-dept">その日の部署</label><select class="input" id="w-dept" ${dis}><option value="">いつもの部署</option>${[...new Set(SGN.depts.concat(w.dept?[w.dept]:[]))].map(v=>`<option ${v===w.dept?"selected":""}>${esc(v)}</option>`).join("")}</select></div>`
    +hint("固定休の日でも、送迎表のその日の出勤者に入ります。");
  else h=`<label class="check"><input type="checkbox" id="w-plan" ${w.plan?"checked":""} ${dis}>職員の予定として送迎表にも載せる（会議・研修・外出など）</label>`
    +(w.plan?(staffSelf(d)?self:who("staff","対象の職員","職員の名前で検索"))+hint("その時間の予定として職員の欄に入り、送迎と重なると注意が出ます。"):"");
  box.innerHTML=h+(L!=="other"||w.plan?(!SGN.loaded?`<span class="by">名前の一覧を読み込んでいます…</span>`:""):"");
}
function sgHits(kind,q){
  const h=$("sghits-"+kind);if(!h||!ed)return;const sel=new Set(ed.d.w[kind]||[]);
  const src=kind==="staff"?SGN.staff:SGN.users;const qq=String(q||"").trim();
  const list=src.filter(x=>!sel.has(x.name)&&(!qq||x.name.includes(qq)||x.dept.includes(qq))).slice(0,40);
  h.innerHTML=list.length?list.map(x=>`<button type="button" data-sgpick="${kind}" data-name="${esc(x.name)}"><span>${esc(x.name)}</span><small>${esc(x.dept)}</small></button>`).join(""):`<div class="by" style="padding:6px 10px">${SGN.loaded?"見つかりません":"読み込み中…"}</div>`;h.hidden=false;
}
function readSg(){
  if(!ed||!$("sgArea"))return;const w=ed.d.w;
  const rv=n=>{const x=document.querySelector(`input[name="${n}"]:checked`);return x?x.value:null};
  const iv=id=>{const x=$(id);return x?x.value.trim():null};
  for(const[n,k]of[["w-kind","kind"],["w-leave","leave"],["w-ukind","ukind"],["w-meet","meetM"],["w-send","sendM"],["w-hw","hw"]]){const v=rv(n);if(v!=null)w[k]=v}
  for(const[id,k]of[["w-note","note"],["w-reason","reason"],["w-meett","meet"],["w-sendt","send"],["w-vehicle","vehicle"],["w-dept","dept"]]){const v=iv(id);if(v!=null)w[k]=v}
  if($("w-plan"))w.plan=$("w-plan").checked;
}
/* 自動で付けるタイトル（空欄のとき） */
function autoTitle(label,sg){
  const nm=a=>a.slice(0,3).join("・")+(a.length>3?"他":"");
  if(!sg)return"";
  const r=sg.reason?`（${sg.reason}）`:"";
  if(sg.type==="staff_off")return`${nm(sg.staff)} ${sg.half?HALF[sg.half]:"休み"}${r}`;
  if(sg.type==="user_absent")return`${nm(sg.users)} 欠席${r}`;
  if(sg.type==="user_time")return`${nm(sg.users)} ${[sg.meet&&`迎え${sg.meet}`,sg.noMeet&&"迎えなし",sg.send&&`送り${sg.send}`,sg.noSend&&"送りなし"].filter(Boolean).join("・")}${r}`;
  if(sg.type==="help")return`${nm(sg.users)} ヘルプ${sg.note?`（${sg.note}）`:""}`;
  if(sg.type==="ride")return`${nm(sg.users)} ${sg.kind==="other_run"?"送迎":RIDE[sg.kind]}${sg.note?`（${sg.note}）`:""}`;
  if(sg.type==="hwork")return`${nm(sg.staff)} 休日出勤`;
  return"";
}
/* 入力の確認。問題があれば日本語のメッセージを返す */
function checkSg(d,sg){
  if(!canLabel(d.label))return"このラベルは送迎表の担当者だけが入力できます。";
  if(!sg)return"";
  if((sg.type==="staff_off"||sg.type==="hwork"||sg.type==="staff_plan")&&!sg.staff.length)return"職員を選んでください。";
  if((sg.type.startsWith("user")||sg.type==="help"||sg.type==="ride")&&!sg.users.length)return"利用者を選んでください。";
  if(sg.type==="user_time"){const w=d.w;
    if(w.meetM==="same"&&w.sendM==="same")return"迎え・送りのどちらを変えるか選んでください。";
    if((w.meetM==="time"&&!w.meet)||(w.sendM==="time"&&!w.send))return"変更後の時刻を入れてください。";}
  return"";
}
/* 休み・AM休・PM休ボタン：押すだけで自分（管理者は選んだ職員）の休みが入り、送迎表に反映される */
function quickHtml(){
  const me=window.SGHost&&window.SGHost.me;if(!me||!core)return"";
  const isStaff=SGN.staff.some(s=>s.name===me.name);
  if(!isStaff&&!me.admin)return"";
  const opts=me.admin?`<select class="input" id="qStaff">${(isStaff?[{name:me.name}]:[]).concat(SGN.staff.filter(s=>s.name!==me.name)).map(s=>`<option ${s.name===S.qStaff?"selected":""}>${esc(s.name)}</option>`).join("")}</select>`:"";
  return`<div class="quick"><b>${me.admin?"休みを入れる":"自分の休みを入れる"}（この日）</b>${opts}<div class="qrow"><select class="input" id="qKind" aria-label="休みの種類">${[["","休み（1日）"],["am","AM休"],["pm","PM休"]].map(([k,l])=>`<option value="${k}" ${String(S.qKind||"")===k?"selected":""}>${l}</option>`).join("")}</select><button class="primary" data-quick>入れる</button></div><span class="by">送迎表にも自動で反映されます。</span></div>`;
}
function quickOff(half){
  const me=window.SGHost.me;const name=me.admin&&$("qStaff")?$("qStaff").value:me.name;S.qStaff=name;
  const exist=allEvents().find(e=>!e.deleted&&e.sg&&e.sg.type==="staff_off"&&e.sg.staff.includes(name)&&e.date<=S.sel&&e.endDate>=S.sel);
  if(exist){toast("この日はすでに「"+exist.title+"」が入っています。変更はその予定を開いてください");openEditor(exist);return}
  const label=half?HALF[half]:"休み";
  core.save({title:`${name} ${label}`,date:S.sel,endDate:S.sel,allDay:true,start:"",end:"",label:"leave",place:"",memo:"",members:[],sg:{type:"staff_off",staff:[name],users:[],meet:"",send:"",noMeet:"",noSend:"",half:half||""}},null);
  toast(`${name}さんの${label}を入れました（送迎表に反映されます）`);render();
}

/* ---------- 予定の編集 ---------- */
let ed=null;
function openEditor(ev,day,draft){
  const ro=!(db&&S.canWrite&&core);
  const base=ev||null;
  const d=draft?draft.form:ev?{...ev,members:[...ev.members]}:{title:"",date:day||S.sel,endDate:day||S.sel,allDay:false,start:"10:00",end:"11:00",label:"other",place:"",memo:"",members:S.me?[S.me]:[],sg:null};
  if(d.sg&&LABEL_OF_SG[d.sg.type])d.label=LABEL_OF_SG[d.sg.type];
  if(!d.w)d.w=workOf(d);
  ed={id:draft?draft.id:ev?.id||null,base:draft?draft.base:base,d,ro:ro||(!!ev&&!canLabel(d.label)),confirmDel:false,comments:[],err:"",changed:false};
  if(!SGN.loaded)loadNames().then(()=>{if(ed)drawSg()});
  drawSheet();
  unsubCm?.();unsubCm=null;
  if(ed.id&&db&&ed.base){try{unsubCm=db.doc(C.cmPath(ed.base.cmKey||ed.base.date,ed.id)).onSnapshot(s=>{if(!ed)return;const cm=s.exists?C.normCm(s.data()):{};ed.comments=cm[ed.id]||[];drawComments()},()=>{})}catch{}}
  setTimeout(()=>$("f-title")?.focus(),30);
}
function closeEditor(keepDraft){unsubCm?.();unsubCm=null;if(!keepDraft)draftDrop();ed=null;$("sheetRoot").innerHTML="";render()}
function readForm(){
  if(!$("f-title"))return;const d=ed.d;d.title=$("f-title").value.trim();d.allDay=$("f-allday").checked;d.date=$("f-date").value;d.endDate=$("f-enddate").value||d.date;
  d.start=$("f-start").value;d.end=$("f-end").value;d.label=document.querySelector('input[name="f-label"]:checked')?.value||"other";d.place=$("f-place")?$("f-place").value.trim():d.place;d.memo=$("f-memo").value;readSg();fixTimes(d);
}
function liveCheck(){
  if(!ed||!ed.base||!ed.id)return;const cur=core?core.overlay(S.server)[ed.id]:S.server[ed.id];
  const changed=!cur||cur.deleted||(cur.rev!==ed.base.rev&&!cur.pending);
  if(changed!==ed.changed){ed.changed=changed;const b=$("liveNote");if(b)b.hidden=!changed}
}
function drawSheet(){
  const d=ed.d,ro=ed.ro,v=x=>ro?"readonly":"";
  $("sheetRoot").innerHTML=`<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t">
  <div class="sheet-head"><h2 id="sh-t">${ed.id?"予定の詳細":"新しい予定"}</h2><button class="icon-btn" data-close aria-label="閉じる">×</button></div>
  <form class="sheet-body" id="evForm" novalidate>
    <div class="note warn" id="liveNote" ${ed.changed?"":"hidden"}><p>この予定は、開いている間に他の人が変更または削除しました。このまま保存すると、どちらを残すか確認する画面が出ます。</p></div>
    <div class="field"><span class="lbl">ラベル</span><div class="labels">${LABELS.map(l=>`<label style="--c:var(--l-${l.k})"><input type="radio" name="f-label" id="f-label-${l.k}" value="${l.k}" ${d.label===l.k?"checked":""} ${ro||(!canLabel(l.k)&&d.label!==l.k)?"disabled":""}><span><i class="dot" style="background:var(--c)"></i>${l.n}</span></label>`).join("")}</div></div>
    <div class="field sgbox" style="--sc:var(--l-${lab(d.label)})"><span class="lbl">${esc(LMAP[d.label]?.n||"その他予定")}で入力する項目</span><div id="sgArea"></div></div>
    <div class="field"><label for="f-title">タイトル${d.label==="other"&&!d.w.plan?"":"（空欄なら自動で付きます）"}</label><input class="input title-input" id="f-title" maxlength="80" value="${esc(d.title)}" placeholder="${d.label==="other"?"例：週次定例":"例："+esc(autoTitle(d.label,sgOf(d.label,Object.assign({},d.w,{staff:d.w.staff.length?d.w.staff:["○○"],users:d.w.users.length?d.w.users:["○○"]})))||"")}" ${v()}></div>
    <label class="check" ${d.label==="other"?"":"hidden"}><input type="checkbox" id="f-allday" ${d.allDay?"checked":""} ${ro?"disabled":""}>終日</label>
    <div class="row">
      <div class="field"><label for="f-date">開始日</label><input class="input" type="date" id="f-date" value="${esc(d.date)}" ${v()}></div>
      <div class="field" ${d.allDay?"hidden":""} id="w-start"><label for="f-start">${d.label==="ride"?"出発の時刻":"開始時刻"}</label><input class="input" type="time" id="f-start" value="${esc(d.start||"10:00")}" step="300" ${v()}></div>
    </div>
    <div class="row">
      <div class="field"><label for="f-enddate">終了日</label><input class="input" type="date" id="f-enddate" value="${esc(d.endDate)}" ${v()}></div>
      <div class="field" ${d.allDay?"hidden":""} id="w-end"><label for="f-end">${d.label==="ride"?"戻りの時刻":"終了時刻"}</label><input class="input" type="time" id="f-end" value="${esc(d.end||"11:00")}" step="300" ${v()}></div>
    </div>
    ${d.label==="other"?`<div class="field"><label for="f-place">場所</label><input class="input" id="f-place" maxlength="80" value="${esc(d.place)}" placeholder="会議室A / オンライン など" ${v()}></div>`:""}
    <div class="field" ${d.label==="other"||d.label==="help"||d.label==="ride"?"":"hidden"}><span class="lbl">参加者（カレンダーで「自分の予定」に出す人）</span><div class="members" id="members"></div>
      ${ro?"":`<div class="picker"><input class="input" id="f-member" placeholder="名前で検索して追加" autocomplete="off"><div class="hits" id="hits" hidden></div></div>`}</div>
    <div class="field"><label for="f-memo">メモ</label><textarea class="input" id="f-memo" maxlength="2000" placeholder="${d.label==="other"?"議題、持ち物、URL など":"伝えたいこと（送迎表には出ません）"}" ${v()}>${esc(d.memo)}</textarea></div>
    <p class="err" id="f-err" ${ed.err?"":"hidden"}>${esc(ed.err)}</p>
    ${ed.base&&ed.base.updatedBy?`<p class="by" id="byline"></p>`:""}
    ${ed.base&&ed.base.prev&&!ro&&!ed.base.pending?`<div><button type="button" class="ghost sm" data-revert>1つ前の内容に戻す</button> <span class="by">「${esc(ed.base.prev.title)}」${timeText(ed.base.prev)}</span></div>`:""}
  </form>
  <div class="sheet-foot">${ro?`<span class="by">閲覧のみ</span><span class="spacer"></span><button class="ghost" data-close>閉じる</button>`:
    ed.confirmDel?`<span class="by">この予定をゴミ箱に移します（30日間は元に戻せます）。</span><span class="spacer"></span><button class="ghost" data-cancel-del>やめる</button><button class="danger solid" data-do-del>削除する</button>`:
    `${ed.base?`<button class="danger" data-del>削除</button>`:""}<span class="spacer"></span><button class="ghost" data-close>キャンセル</button><button class="primary" data-save>保存</button>`}</div>
  ${ed.base?`<div class="comments"><h3>コメント</h3><div id="cmts"></div>${!ro?`<form class="cmt-form" id="cmtForm"><input class="input" id="f-cmt" maxlength="500" placeholder="コメントを書く" autocomplete="off"><button class="primary">送信</button></form>`:""}</div>`:""}
  </div></div>`;
  drawMembers();drawComments();drawSg();
  if(ed.base&&ed.base.updatedBy)profiles([ed.base.updatedBy]).then(ps=>{const b=$("byline");if(b)b.textContent=`最終更新：${ps[ed.base.updatedBy]?.name||"メンバー"}（${fmtAt(ed.base.updatedAt)}）`});
}
async function drawMembers(){
  if(!ed)return;const ids=ed.d.members,box=$("members");if(!box)return;
  if(!ids.length){box.innerHTML=`<span class="by">まだいません</span>`;return}
  const ps=await profiles(ids);if(!ed)return;
  box.innerHTML=ids.map(id=>`<span class="member"><img src="${esc(ps[id]?.avatarUrl||"")}" alt=""><span>${esc(ps[id]?.name||"メンバー")}${ps[id]?.isMe?"（自分）":""}</span>${ed.ro?"":`<button type="button" data-rm="${esc(id)}" aria-label="参加者から外す">×</button>`}</span>`).join("");
}
async function drawComments(){
  const box=$("cmts");if(!box||!ed)return;
  const pend=core?core.pendingComments(ed.id).filter(p=>!ed.comments.some(c=>c.id===p.id)):[];
  const all=ed.comments.concat(pend);
  if(!all.length){box.innerHTML=`<span class="by">まだコメントはありません</span>`;return}
  const ps=await profiles(all.map(c=>c.by).filter(Boolean));if(!ed)return;
  box.innerHTML=all.map(c=>{const p=ps[c.by]||{};return`<div class="cmt"><img src="${esc(p.avatarUrl||"")}" alt=""><div><div class="who">${esc(p.name||"メンバー")}<small>${fmtAt(c.at)}</small>${c.pending?` <span class="tag-pend">未送信</span>`:""}${c.failed?` <span class="tag-pend">送信できません</span>`:""}</div><p>${esc(c.text)}</p></div></div>`}).join("");
}
function showErr(m){ed.err=m;const e=$("f-err");if(e){e.textContent=m;e.hidden=!m}}
function save(){
  readForm();const d=ed.d;
  d.sg=sgOf(d.label,d.w);
  const bad=checkSg(d,d.sg);if(bad)return showErr(bad);
  if(!d.title)d.title=autoTitle(d.label,d.sg);
  if(!d.title)return showErr("タイトルを入力してください。");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date))return showErr("開始日を選んでください。");
  if(d.endDate<d.date)return showErr("終了日は開始日以降にしてください。");
  if(!d.allDay&&!d.start)return showErr("開始時刻を入れてください。");
  if(!d.allDay&&d.endDate===d.date&&d.end<=d.start)return showErr("終了時刻は開始時刻より後にしてください。");
  const ev={title:d.title,date:d.date,endDate:d.endDate,allDay:d.allDay,start:d.allDay?"":d.start,end:d.allDay?"":d.end,label:lab(d.label),place:d.place,memo:d.memo,members:d.members,sg:d.sg||null};
  const r=core.save(ev,ed.base);
  closeEditor();S.sel=ev.date;
  const dd=parse(ev.date);if(dd.getMonth()!==S.cursor.getMonth()||dd.getFullYear()!==S.cursor.getFullYear()){S.cursor=new Date(dd.getFullYear(),dd.getMonth(),1);subscribe()}
  toast(r.persisted?"保存しました（送信が終わるまで右上に件数が出ます）":"保存しました。送信が終わるまでこの画面を閉じないでください");
  render();
}

/* ---------- 同期状況の画面（競合・失敗の解決） ---------- */
function openSync(){
  const st=core?core.status():null;
  const sum=e=>e?`<b>${esc(e.title)}</b>${e.deleted?"（削除済み）":""}<br>${esc(e.date)} ${esc(timeText(e))}${e.place?"<br>"+esc(e.place):""}`:"<b>見つかりません</b>（削除または日付変更）";
  const kindName={upsert:"予定の保存",delete:"予定の削除",restore:"予定の復元",comment:"コメント"};
  const reason={changed:"あなたが開いた後に、他の人がこの予定を変更しました。",deleted:"他の人がこの予定を削除しました。",missing:"予定が見つかりません（他の人が削除または日付を変更しました）。",exists:"同じ予定がすでにあります。"};
  const code={invalid_argument:"権限がないため保存できませんでした。",quota_exceeded:"保存できる量の上限に達しました。管理者に連絡してください。",full:"この日またはこの予定の保存量が上限です（コメントは1件の予定につき100件まで）。",outdated_client:"新しい版のデータのため、この版からは書き込めません。最新版を読み込んでから再送してください。",failed:"データの形が正しくないため保存できませんでした。"};
  const opHtml=op=>{const mine=op.kind==="upsert"?op.ev:op.kind==="comment"?null:null;const theirs=op.info&&op.info.theirs?C.normEvent(op.info.theirs,op.info.theirs.id||"xxxxxxxx",0):null;
    const body=op.kind==="comment"?`<div class="cmp"><div><b>あなたのコメント</b>${esc(op.comment.text)}</div></div>`:op.kind==="upsert"?`<div class="cmp"><div><b>あなたの入力</b>${sum(C.normEvent(op.ev,op.id,0))}</div><div><b>現在の内容</b>${sum(theirs)}</div></div>`:`<div class="cmp"><div><b>操作</b>${kindName[op.kind]}</div><div><b>現在の内容</b>${sum(theirs)}</div></div>`;
    const conflict=op.state==="conflict";
    return`<div class="op"><h4>${kindName[op.kind]||"操作"}（${fmtAt(op.at)}）</h4><p class="by" style="font-size:12px;margin:0">${conflict?reason[op.info?.reason]||"他の人の変更と重なりました。":code[op.info?.code]||"送信できませんでした。"}</p>${body}
    <div class="acts">${conflict?`<button class="primary sm" data-force="${esc(op.opId)}">自分の内容で上書き</button><button class="ghost sm" data-discard-ask="${esc(op.opId)}">現在の内容を残す（自分の操作を取り消す）</button>`:`<button class="primary sm" data-retry="${esc(op.opId)}">もう一度送る</button><button class="ghost sm" data-copy="${esc(op.opId)}">内容をコピー</button><button class="ghost sm" data-discard-ask="${esc(op.opId)}">破棄</button>`}</div><div data-confirm-slot="${esc(op.opId)}"></div></div>`};
  const issues=st?st.conflicts.concat(st.failed):[];
  $("sheetRoot").innerHTML=`<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sy-t">
  <div class="sheet-head"><h2 id="sy-t">保存と同期の状況</h2><button class="icon-btn" data-close aria-label="閉じる">×</button></div>
  <div class="sheet-body">
    <dl class="kv"><dt>共有データ</dt><dd>${S.dbState==="ok"?(S.loaded?"接続中・最新":"読み込み中"):S.dbState==="error"?"読み込み停止中":S.dbState==="none"?"接続できません":"接続中…"}</dd>
    <dt>通信</dt><dd>${S.online?"オンライン":"オフライン"}</dd>
    <dt>未送信</dt><dd>${st?st.queued:0}件${st&&st.queued?(st.lastError?`（${Math.round(st.retryDelay/1000)}秒ごとに自動で再送）`:"（送信中）"):""}</dd>
    <dt>端末への一時保存</dt><dd>${store.persistent?"有効（画面を閉じても未送信は消えません）":"使えません（画面を閉じると未送信が消えます）"}</dd>
    <dt>アプリの版</dt><dd><span class="time">${APP_VERSION}</span>（データ形式 ${C.SCHEMA}）</dd></dl>
    <div class="row"><button class="ghost sm" data-resend ${st&&st.queued?"":"disabled"}>今すぐ再送</button><button class="ghost sm" data-reload>最新版を読み込み直す</button></div>
    ${issues.length?`<h3 style="margin:6px 0 0;font-size:14px">確認が必要な操作 ${issues.length}件</h3>${issues.map(opHtml).join("")}`:`<p class="by" style="font-size:13px;margin:0">確認が必要な操作はありません。</p>`}
    ${S.isAdmin?`<div class="op"><h4>バックアップ（編集者のみ）</h4><p class="by" style="font-size:12px;margin:0">全期間の予定とコメントを端末に保存します。月末に1回保存しておくと、万一のときに戻せます。復元は「サーバーにない予定」と「削除された予定」だけを戻し、今ある予定は上書きしません。</p><div class="acts"><button class="primary sm" data-export="json">バックアップを保存（JSON）</button><button class="ghost sm" data-export="csv">一覧をCSVで保存</button><button class="ghost sm" data-restore-file>バックアップから復元</button></div><div id="bkSlot"></div></div>`:""}
  </div></div></div>`;
}

/* ---------- バックアップ・復元（編集者のみ） ---------- */
async function fetchAll(){
  const days=[],cms=[];const y0=2026,y1=new Date().getFullYear()+3;
  for(let y=y0;y<=y1;y++)for(const[a,b]of[["01-01","06-30"],["07-01","12-31"]]){
    const s1=await db.collection("days").where("date",">=",`${y}-${a}`).where("date","<=",`${y}-${b}`).limit(1000).get();days.push(...s1.docs.map(d=>d.data()));
    const s2=await db.collection("cm").where("date",">=",`${y}-${a}`).where("date","<=",`${y}-${b}`).limit(1000).get();cms.push(...s2.docs.map(d=>d.data()));
  }
  return{days,cms};
}
async function doExport(kind){
  const slot=$("bkSlot");slot.innerHTML=`<p class="by">データを集めています…</p>`;
  try{
    const{days,cms}=await fetchAll();const events=Object.values(C.mergeDays(days));
    const stamp=ymd(new Date());let data,filename;
    if(kind==="json"){const comments={};for(const c of cms){const m=C.normCm(c);for(const k in m)comments[k]=(comments[k]||[]).concat(m[k])}
      data=JSON.stringify({app:"team-calendar",schema:C.SCHEMA,version:APP_VERSION,exportedAt:new Date().toISOString(),events,comments},null,1);filename=`チームカレンダー_バックアップ_${stamp}.json`}
    else{const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;const ps=await profiles(events.flatMap(e=>e.members));
      const rows=[["開始日","終了日","終日","開始","終了","タイトル","ラベル","場所","参加者","メモ","状態","更新日時"]].concat(events.sort((a,b)=>a.date.localeCompare(b.date)||cmp(a,b)).map(e=>[e.date,e.endDate,e.allDay?"終日":"",e.start,e.end,e.title,LMAP[e.label].n,e.place,e.members.map(id=>ps[id]?.name||"メンバー").join("、"),e.memo,e.deleted?"削除済み":"",fmtAt(e.updatedAt)]));
      data="﻿"+rows.map(r=>r.map(q).join(",")).join("\r\n");filename=`チームカレンダー_一覧_${stamp}.csv`}
    if(!downloads){slot.innerHTML=`<p class="err">この画面では保存機能が使えません。</p>`;return}
    await downloads.save({filename,data});slot.innerHTML=`<p class="by">保存しました（予定 ${events.length}件）。</p>`;
  }catch(e){slot.innerHTML=`<p class="err">${e&&e.code==="declined"?"保存を取りやめました。":"保存できませんでした。通信状況を確認してもう一度お試しください。"}</p>`}
}
let restorePlan=null;
async function planRestore(file){
  const slot=$("bkSlot");if(!slot)return;slot.innerHTML=`<p class="by">バックアップを確認しています…</p>`;
  try{
    const j=JSON.parse(await file.text());if(!j||j.app!=="team-calendar"||!Array.isArray(j.events))throw new Error("format");
    if(Number(j.schema)>C.SCHEMA){slot.innerHTML=`<p class="err">新しい版で作られたバックアップです。最新版を読み込んでから復元してください。</p>`;return}
    const{days}=await fetchAll();const cur=C.mergeDays(days);
    const add=[],undel=[];
    for(const raw of j.events){const e=C.normEvent(raw,raw&&raw.id,0);if(!e||e.deleted)continue;const c=cur[e.id];if(!c)add.push(e);else if(c.deleted)undel.push(c)}
    restorePlan={add,undel};
    slot.innerHTML=`<p style="font-size:13px;margin:8px 0">戻す予定：サーバーにない予定 ${add.length}件、ゴミ箱から戻す予定 ${undel.length}件。今ある予定は変更しません。</p><div class="acts"><button class="primary sm" data-restore-go ${add.length+undel.length?"":"disabled"}>復元する</button><button class="ghost sm" data-restore-cancel>やめる</button></div>`;
  }catch{slot.innerHTML=`<p class="err">このファイルはバックアップとして読み込めませんでした。チームカレンダーで保存したJSONファイルを選んでください。</p>`}
}

/* ---------- 操作 ---------- */
$("prev").onclick=()=>go(-1);$("next").onclick=()=>go(1);
$("todayBtn").onclick=()=>{TODAY=ymd(new Date());S.sel=TODAY;const c=new Date(new Date().getFullYear(),new Date().getMonth(),1);if(+c!==+S.cursor){S.cursor=c;subscribe()}render()};
$("vMonth").onclick=()=>{S.view="month";render()};$("vList").onclick=()=>{S.view="list";render()};$("vTrash").onclick=()=>{S.view="trash";render()};
$("addBtn").onclick=()=>openEditor(null,S.sel);
$("syncBtn").onclick=openSync;
$("filters").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;if(b.hasAttribute("data-mine"))S.mine=!S.mine;else S.label=b.dataset.label;render()});
$("restoreFile").addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];e.target.value="";if(f)planRestore(f)});
document.addEventListener("click",async e=>{
  const t=e.target;
  if(t.closest("[data-reload]")){location.reload();return}
  if(t.closest("[data-draft-open]")){const d=draftGet();if(d){const cur=d.id?allEvents().find(x=>x.id===d.id):null;openEditor(cur||d.base||null,null,d)}return}
  if(t.closest("[data-draft-drop]")){draftDrop();render();return}
  const evEl=t.closest("[data-ev]");
  if(evEl&&!t.closest("#sheetRoot")){const x=allEvents().find(z=>z.id===evEl.dataset.ev);if(x)openEditor(x);return}
  const day=t.closest("[data-day]");if(day){S.sel=day.dataset.day;render();return}
  if(t.closest("[data-add-day]")){openEditor(null,S.sel);return}
  const qk=t.closest("[data-quick]");if(qk&&!t.closest("#sheetRoot")){const k=$("qKind")?$("qKind").value:"";S.qKind=k;quickOff(k);return}
  const rs=t.closest("[data-restore]");if(rs){const x=allEvents().find(z=>z.id===rs.dataset.restore);if(x&&core){core.restore(x);toast("元に戻しました")}return}
  if(!$("ov"))return;
  if(t.id==="ov"||t.closest("[data-close]")){if(ed)closeEditor();else{$("sheetRoot").innerHTML=""}return}
  /* 同期画面 */
  const f=t.closest("[data-force]");if(f){core.force(f.dataset.force);openSync();return}
  const r=t.closest("[data-retry]");if(r){core.retry(r.dataset.retry);openSync();return}
  const da=t.closest("[data-discard-ask]");if(da){const slot=document.querySelector(`[data-confirm-slot="${CSS.escape(da.dataset.discardAsk)}"]`);slot.innerHTML=`<div class="acts" style="margin-top:4px"><span class="by" style="font-size:12px">この操作を取り消します。元には戻せません。</span><button class="danger solid sm" data-discard="${esc(da.dataset.discardAsk)}">取り消す</button></div>`;return}
  const dd=t.closest("[data-discard]");if(dd){core.discard(dd.dataset.discard);openSync();return}
  const cp=t.closest("[data-copy]");if(cp){const op=core.list().find(o=>o.opId===cp.dataset.copy);const txt=op?(op.kind==="comment"?op.comment.text:op.ev?`${op.ev.title}\n${op.ev.date} ${op.ev.start||""}-${op.ev.end||""}\n${op.ev.place||""}\n${op.ev.memo||""}`:op.kind):"";
    try{await navigator.clipboard.writeText(txt);toast("コピーしました")}catch{toast("コピーできませんでした")}return}
  if(t.closest("[data-resend]")){core.resume();openSync();return}
  const ex=t.closest("[data-export]");if(ex){doExport(ex.dataset.export);return}
  if(t.closest("[data-restore-file]")){$("restoreFile").click();return}
  if(t.closest("[data-restore-cancel]")){restorePlan=null;$("bkSlot").innerHTML="";return}
  if(t.closest("[data-restore-go]")&&restorePlan){for(const e of restorePlan.add)core.save(Object.assign({},e),null);for(const e of restorePlan.undel)core.restore(e);
    $("bkSlot").innerHTML=`<p class="by">復元を始めました（${restorePlan.add.length+restorePlan.undel.length}件）。右上の件数が消えたら完了です。</p>`;restorePlan=null;render();return}
  /* 編集画面 */
  if(!ed)return;
  if(t.closest("[data-save]")){save();return}
  if(t.closest("[data-del]")){readForm();ed.confirmDel=true;drawSheet();return}
  if(t.closest("[data-cancel-del]")){ed.confirmDel=false;drawSheet();return}
  if(t.closest("[data-do-del]")){core.remove(ed.base);closeEditor();toast("ゴミ箱に移しました（30日間は元に戻せます）");return}
  if(t.closest("[data-revert]")){const p=ed.base.prev;core.save({title:p.title,date:p.date,endDate:p.endDate,allDay:p.allDay,start:p.start,end:p.end,label:p.label,place:p.place,memo:p.memo,members:p.members,sg:p.sg||null},ed.base);closeEditor();toast("1つ前の内容に戻しました");return}
  const fl=t.closest("[data-fill]");if(fl){const i=$(fl.dataset.fill);if(i){i.value=i.value===fl.dataset.v?"":fl.dataset.v;readSg();drawSg();draftSave()}return}
  const sgp=t.closest("[data-sgpick]");if(sgp){readSg();const k=sgp.dataset.sgpick;const w=ed.d.w;if(!w[k].includes(sgp.dataset.name))w[k].push(sgp.dataset.name);drawSg();setTimeout(()=>{const i=$("f-sgq-"+k);if(i){i.focus();sgHits(k,"")}},0);draftSave();return}
  const sgr=t.closest("[data-sgrm]");if(sgr){readSg();const k=sgr.dataset.sgrm;ed.d.w[k]=ed.d.w[k].filter(n=>n!==sgr.dataset.name);drawSg();draftSave();return}
  if(!t.closest(".sgsub")){for(const k of["staff","users"]){const h=$("sghits-"+k);if(h)h.hidden=true}}
  const rm=t.closest("[data-rm]");if(rm){ed.d.members=ed.d.members.filter(i=>i!==rm.dataset.rm);drawMembers();draftSave();return}
  const pk=t.closest("[data-pick]");if(pk){if(!ed.d.members.includes(pk.dataset.pick))ed.d.members.push(pk.dataset.pick);$("f-member").value="";$("hits").hidden=true;drawMembers();draftSave();return}
  if(!t.closest(".picker")){const h=$("hits");if(h)h.hidden=true}
});
document.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users")){e.preventDefault();const b=$("sghits-"+e.target.id.slice(6))?.querySelector("[data-sgpick]");if(b)b.click();return}
  if(e.key==="Escape"&&$("ov")){if(ed)closeEditor(true);else $("sheetRoot").innerHTML="";return}
  const day=e.target.closest?.("[data-day]");if(day&&(e.key==="Enter"||e.key===" ")){e.preventDefault();S.sel=day.dataset.day;render()}
});
document.addEventListener("change",e=>{
  if(e.target.id==="qStaff"){S.qStaff=e.target.value;return}
  if(e.target.id==="qKind"){S.qKind=e.target.value;return}
  if(!ed)return;
  // ラベル・休みの形などを変えたら、入力欄を作り直す（入力済みの値は残す）
  if(e.target.name==="f-label"||e.target.id==="w-plan"||["w-kind","w-leave","w-ukind","w-meet","w-send","w-hw"].includes(e.target.name)){
    readForm();drawSheet();draftSave();return}
  if(e.target.id==="f-allday"){$("w-start").hidden=$("w-end").hidden=e.target.checked}
  if(e.target.id==="f-date"){const x=$("f-enddate");if(!x.value||x.value<e.target.value)x.value=e.target.value}
  draftSave()});
async function search(q){const h=$("hits");if(!h||!user)return;let res=[];try{res=await user.search(q)}catch{}if(!ed)return;res=res.filter(p=>!ed.d.members.includes(p.id));
  h.innerHTML=res.length?res.map(p=>`<button type="button" data-pick="${esc(p.id)}"><img src="${esc(p.avatarUrl)}" alt=""><span>${esc(p.name)}${p.isMe?"（自分）":""}</span></button>`).join(""):`<div class="by" style="padding:6px 8px">${q?"見つかりません":"名前を入力してください"}</div>`;h.hidden=false}
document.addEventListener("input",e=>{if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){sgHits(e.target.id.slice(6),e.target.value);return}if(e.target.id==="f-member")search(e.target.value);else if(ed&&e.target.closest("#evForm"))draftSave()});
document.addEventListener("focusin",e=>{if(e.target.id==="f-member")search(e.target.value);if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){if(!SGN.loaded)loadNames().then(()=>sgHits(e.target.id.slice(6),e.target.value));sgHits(e.target.id.slice(6),e.target.value)}});
document.addEventListener("submit",e=>{e.preventDefault();
  if(e.target.id==="cmtForm"){const i=$("f-cmt");const v=i.value.trim();if(v&&ed&&ed.base&&core){core.comment(ed.base,v);i.value="";drawComments()}}
  else if(e.target.id==="evForm"&&ed&&!ed.ro)save()});
window.addEventListener("online",()=>{S.online=true;core?.resume();render()});
window.addEventListener("offline",()=>{S.online=false;render()});
function wake(){const t=ymd(new Date());if(t!==TODAY){const wasToday=S.sel===TODAY;TODAY=t;if(wasToday){S.sel=t;const c=new Date(new Date().getFullYear(),new Date().getMonth(),1);if(+c!==+S.cursor){S.cursor=c;subscribe()}}}core?.kick();render()}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")wake()});
window.addEventListener("focus",wake);
window.addEventListener("beforeunload",e=>{if(core&&core.status().queued&&!store.persistent){e.preventDefault();e.returnValue=""}});

/* ---------- 起動 ---------- */
$("ver").textContent="v"+APP_VERSION;
render();
(async()=>{
  await window.SGHost.ready;
  if(/^\d{4}-\d{2}-\d{2}$/.test(window.__SG_DATE||"")){S.sel=window.__SG_DATE;const d=parse(S.sel);S.cursor=new Date(d.getFullYear(),d.getMonth(),1)}
  try{user=await window.claude.use("user")}catch{user=null}
  try{db=await window.claude.use("db")}catch{db=null}
  try{downloads=await window.claude.use("downloads")}catch{downloads=null}
  if(user){try{S.me=await user.id()}catch{}try{if(await user.can("data.write")===false)S.canWrite=false}catch{}try{S.isAdmin=await user.canEdit()}catch{}}
  if(!db){S.dbState="none";render();return}
  core=C.createCore({db,store,me:S.me,runOp:window.SGHost.runOp});
  loadNames().then(()=>render());
  window.SGHost.startPolling(60000);
  window.SGHost.onLogin(()=>core.kick());
  core.on(()=>{render();if(ed)drawComments();else if($("ov")&&$("sy-t"))openSync()});
  S.dbState="ok";subscribe();core.kick();render();   // 起動時に未送信を自動で再送（障害D）
  setInterval(()=>{if(core.status().queued&&S.online)core.kick()},30000);
})();
