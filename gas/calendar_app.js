
"use strict";
const APP_VERSION="2026.10.30b";
const C=window.TCCore;
const LABELS=[{k:"help",n:"ヘルプ"},{k:"ride",n:"送迎"},{k:"user",n:"利用者休み"},{k:"extra",n:"利用日外利用"},{k:"monitor",n:"モニタリング"},{k:"shien",n:"支援会議"},{k:"leave",n:"職員休み"},{k:"hwork",n:"休日出勤"},{k:"shift",n:"職員時間変更"},{k:"other",n:"その他予定"}];
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
const S={cursor:new Date(new Date().getFullYear(),new Date().getMonth(),1),sel:TODAY,view:"month",mine:false,label:"all",biz:"all",
  server:{},loaded:false,me:null,canWrite:true,isAdmin:false,dbState:"connecting",online:navigator.onLine!==false};

/* 事業のタブ：全体／生活介護／放課後デイ。これまでの予定（biz なし）は生活介護。選んだタブはこの端末に覚える */
const BIZ=[{k:"all",n:"全体"},{k:"seikatsu",n:"生活介護"},{k:"houkago",n:"放課後デイ"}],BIZN={seikatsu:"生活介護",houkago:"放課後デイ"};
const bizOf=e=>e&&e.biz==="houkago"?"houkago":"seikatsu";
try{const b=ls&&ls.getItem("sg:biz");if(BIZ.some(x=>x.k===b))S.biz=b}catch{}
const newBiz=()=>S.biz==="houkago"?"houkago":"seikatsu";
const bizTag=e=>S.biz==="all"&&bizOf(e)==="houkago"?`<span class="tag-biz">放デイ</span>`:"";
function renderBiz(){document.documentElement.dataset.biz=S.biz;   // タブごとに背景の色を少し変える（全体＝薄い青・生活介護＝薄緑・放課後デイ＝薄ピンク）
  $("bizTabs").innerHTML=BIZ.map(b=>`<button role="tab" data-biz="${b.k}" aria-selected="${S.biz===b.k}">${b.n}</button>`).join("")}
function gridRange(){const s=addDays(S.cursor,-S.cursor.getDay());return{start:s,end:addDays(s,41)}}
function allEvents(){return core?Object.values(core.overlay(S.server)):Object.values(S.server)}
function visible(){return allEvents().filter(e=>!e.deleted&&pass(e))}
function pass(e){if(S.biz!=="all"&&bizOf(e)!==S.biz)return false;if(S.label!=="all"&&e.label!==S.label)return false;if(S.mine&&!isMine(e))return false;return true}
function isMine(e){const nm=(window.SGHost&&window.SGHost.me||{}).name;return!!((S.me&&e.members.includes(S.me))||(nm&&((e.tanto||[]).includes(nm)||(e.sg&&e.sg.staff||[]).includes(nm))))}
/* 予定の並び：ラベルの順（ヘルプ・送迎・利用者休み…その他予定）→ 何日も続く予定 → 終日 → 開始時刻 → タイトル。予定が入るたびにこの順で並び直る */
const LORDER=Object.fromEntries(LABELS.map((l,i)=>[l.k,i]));
function cmp(a,b){const la=LORDER[lab(a.label)]??99,lb=LORDER[lab(b.label)]??99;if(la!==lb)return la-lb;const sa=a.date!==a.endDate,sb=b.date!==b.endDate;if(sa!==sb)return sa?-1:1;if(a.allDay!==b.allDay)return a.allDay?-1:1;return(a.start||"").localeCompare(b.start||"")||a.title.localeCompare(b.title)}
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
    renderSync();renderBiz();renderFilters();renderNotices();
    const vis=visible();
    const ps=await profiles(vis.flatMap(e=>e.members));
    if(my!==seq)return;
    if(S.view==="month")renderGrid(vis);else if(S.view==="list")renderList(vis,ps);else renderTrash();
    renderPanel(vis,ps);renderDay(vis);if(SR.open)drawSearchResults();
    if(ed)liveCheck();
  }catch(e){
    $("app").insertAdjacentHTML("afterbegin",`<div class="render-err" style="grid-column:1/-1">画面を表示できませんでした（${esc(e&&e.message)}）。入力済みのデータは端末に保存されています。再読み込みしてください。</div>`);
  }
}
function renderSync(){
  const b=$("syncBtn"),t=$("syncText");let s="ok",txt="保存済み ✓";
  // 送迎表の右側に出ているときは、送り終わったら送迎表に知らせる（すぐ読み直して反映を見せる）
  if(core){const q=core.status().queued;if(S.lastQ>0&&!q&&window.parent!==window){try{window.parent.postMessage({sg:"cal-saved"},"*")}catch{}}S.lastQ=q}
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
  const d=draftGet();if(d&&!ed)n.push(["warn",`書きかけの予定「${esc(d.form.title||LMAP[d.form.label]?.n||"（無題）")}」が残っています（${fmtAt(d.savedAt)}）。`,`<button class="primary sm" data-draft-open>続きを書く</button><button class="ghost sm" data-draft-drop>破棄</button>`]);
  $("notices").innerHTML=n.map(([c,t,a])=>`<div class="note ${c}"><p>${t}</p>${a}</div>`).join("");
}
function chip(e){const span=e.date!==e.endDate;
  return`<button class="ev-chip${span?" span":""}${e.pending?" pend":""}" data-ev="${esc(e.id)}" style="--c:var(--l-${lab(e.label)})" aria-label="${esc(e.title)}">${bizTag(e)}${!span&&!e.allDay?`<b>${esc(e.start)}</b>`:""}<span>${esc(e.title)}</span></button>`}
function renderGrid(vis){
  fitGrid();
  const{start}=gridRange();const tm=S.cursor.getMonth();let html="";
  for(let i=0;i<42;i++){const d=addDays(start,i),k=ymd(d),evs=on(vis,k),hol=HOL[k];
    const cls=["cell",d.getMonth()!==tm&&"out",k===TODAY&&"today",k===S.sel&&"sel",d.getDay()===0&&"su",d.getDay()===6&&"sa",hol&&"hol"].filter(Boolean).join(" ");
    html+=`<div class="${cls}" role="button" tabindex="0" data-day="${k}" aria-label="${d.getMonth()+1}月${d.getDate()}日 ${evs.length}件"><div class="cell-head"><span class="num">${d.getDate()}</span>${hol?`<span class="hol-name">${hol}</span>`:""}<button type="button" class="cell-add" data-add-cell="${k}" tabindex="-1" aria-label="${d.getMonth()+1}月${d.getDate()}日に予定を追加" title="この日に予定を追加">＋</button></div>${(n=>evs.length>n?evs.slice(0,Math.max(1,n-1)).map(chip).join("")+`<span class="more">他${evs.length-Math.max(1,n-1)}件</span>`:evs.map(chip).join(""))(MAXC())}</div>`}
  $("grid").innerHTML=html;
}
function evRow(e,ps){
  const av=e.members.slice(0,6).map(id=>ps[id]?`<img src="${esc(ps[id].avatarUrl)}" alt="${esc(ps[id].name||"メンバー")}" title="${esc(ps[id].name||"メンバー")}">`:"").join("");
  return`<li><button class="ev-row" data-ev="${esc(e.id)}" style="--c:var(--l-${lab(e.label)})"><span class="stripe"></span><span><div class="t">${bizTag(e)}${esc(e.title)}</div><div class="meta"><span class="time">${timeText(e)}</span><span>${esc(LMAP[e.label]?.n||"その他")}</span>${e.place?`<span>${esc(e.place)}</span>`:""}${(e.tanto||[]).length?`<span>担当：${esc(e.tanto.join("・"))}</span>`:""}${e.pending?`<span class="tag-pend">未送信</span>`:""}${e.sg?`<span class="tag-sg">${esc(sgText(e.sg))}</span>`:""}</div>${av?`<div class="avatars">${av}</div>`:""}</span></button></li>`}
function renderPanel(vis,ps){
  const d=parse(S.sel),evs=on(vis,S.sel),hol=HOL[S.sel],can=db&&S.canWrite&&core;
  let body;
  if(!S.loaded&&S.dbState==="connecting")body=`<div class="empty">予定を読み込んでいます…</div>`;
  else if(!evs.length)body=`<div class="empty">この日の予定はまだありません。${can?"<br>「この日に追加」から登録できます。":""}</div>`;
  else body=`<ul class="ev-list">${evs.map(e=>evRow(e,ps)).join("")}</ul>`;
  const q=isMob()?"":quickHtml();   // スマホでは日の一覧（下から出る）の中に出す
  $("panel").innerHTML=`<div class="panel-head"><div class="panel-date">${d.getMonth()+1}月${d.getDate()}日（${WD[d.getDay()]}）<small>${hol?esc(hol)+" · ":""}${evs.length}件の予定</small></div><button class="primary" data-add-day ${can?"":"disabled"}>この日に追加</button></div>${q}${body}`;
}
/* スマホ：日付を押すと、その日の予定の一覧が下から出る（TimeTreeのように）。右上の＋でその日に予定を入れる */
const isMob=()=>matchMedia("(max-width:560px)").matches;
// スマホの月表示はスクロールしなくても1か月が見えるように、マスの高さを画面に合わせ、入るだけの予定を出す
let CELLH=0;
const MAXC=()=>isMob()&&CELLH?Math.max(1,Math.floor((CELLH-20)/15)):isMob()?4:3;
function fitGrid(){
  const g=$("grid");if(!g)return;
  if(!isMob()||S.view!=="month"){CELLH=0;g.style.removeProperty("--cellh");return}
  const vh=window.visualViewport?visualViewport.height:innerHeight;
  const top=g.getBoundingClientRect().top+(window.scrollY||0);   // いちばん上まで戻したときの位置で合わせる
  CELLH=Math.max(48,Math.floor((vh-Math.max(0,top)-10)/6));
  g.style.setProperty("--cellh",CELLH+"px");
}
function dsRow(e){
  const tm=e.allDay||e.date!==e.endDate&&!(e.date===S.sel&&e.start)?`<span class="ds-time">終日</span>`:`<span class="ds-time">${esc(e.start)}<small>${esc(e.end)}</small></span>`;
  const sub=[LMAP[e.label]?.n||"その他",e.place,(e.tanto||[]).length?"担当："+e.tanto.join("・"):""].filter(Boolean).map(esc).join(" ・ ");
  return`<li><button class="ds-row" data-ev="${esc(e.id)}" style="--c:var(--l-${lab(e.label)})">${tm}<span class="ds-bar"></span><span class="ds-body"><b>${bizTag(e)}${esc(e.title)}</b><small>${sub}</small></span></button></li>`;
}
function renderDay(vis){
  const root=$("dayRoot");document.documentElement.classList.toggle("dayopen",!!S.dayOpen);   // 開いている間は裏の月の画面を動かさない
  if(!S.dayOpen){if(root.innerHTML)root.innerHTML="";return}
  const d=parse(S.sel),evs=on(vis,S.sel),hol=HOL[S.sel],can=db&&S.canWrite&&core;
  const keep=root.querySelector(".ds-list")?.scrollTop||0;
  root.innerHTML=`<div class="overlay day-ov" id="dayOv"><div class="sheet daysheet" role="dialog" aria-modal="true" aria-label="${d.getMonth()+1}月${d.getDate()}日の予定"><div class="ds-grip"></div>
    <div class="ds-head"><h2>${d.getMonth()+1}月${d.getDate()}日 ${WD[d.getDay()]}曜日${hol?`<small>${esc(hol)}</small>`:""}</h2>
      <button class="ds-add" data-add-day aria-label="この日に予定を追加" ${can?"":"disabled"}>＋</button><button class="icon-btn" data-day-close aria-label="閉じる">×</button></div>
    ${evs.length?`<ul class="ds-list">${evs.map(dsRow).join("")}</ul>`:`<div class="empty">${S.loaded?"この日の予定はまだありません。":"予定を読み込んでいます…"}${can&&S.loaded?"<br>右上の＋から入れられます。":""}</div>`}
    ${isMob()?`<div class="ds-quick">${quickHtml()}</div>`:""}
  </div></div>`;
  const l=root.querySelector(".ds-list");if(l)l.scrollTop=keep;
}
/* 日の一覧：上の部分（つまみ・日付）を下へ引くと閉じて月の画面に戻る。一覧がいちばん上のときは一覧を引いても閉じる。
   一覧の外をなぞっても裏の月の画面は動かない */
let dsDrag=null;
document.addEventListener("touchstart",e=>{const ov=e.target.closest&&e.target.closest("#dayOv");if(!ov){dsDrag=null;return}
  const head=e.target.closest(".ds-grip,.ds-head"),list=e.target.closest(".ds-list");
  dsDrag=(head&&!e.target.closest("button"))||(list&&list.scrollTop<=0)?{y:e.touches[0].clientY,t:Date.now(),dy:0,sheet:ov.querySelector(".daysheet"),fromList:!head}:null},{passive:true});
document.addEventListener("touchmove",e=>{const ov=e.target.closest&&e.target.closest("#dayOv");if(!ov)return;
  if(dsDrag){const dy=e.touches[0].clientY-dsDrag.y;
    if(dsDrag.fromList&&dy<0&&!dsDrag.dy){dsDrag=null;return}            // 一覧を上へ送るのはふつうのスクロール
    if(dsDrag){dsDrag.dy=Math.max(0,dy);if(dsDrag.sheet){dsDrag.sheet.style.transition="none";dsDrag.sheet.style.transform=`translateY(${dsDrag.dy}px)`}e.preventDefault();return}}
  const list=e.target.closest(".ds-list");if(!list||list.scrollHeight<=list.clientHeight+1)e.preventDefault();
},{passive:false});
document.addEventListener("touchend",()=>{if(!dsDrag)return;const d=dsDrag;dsDrag=null;const sh=d.sheet;if(!sh)return;
  sh.style.transition="transform .2s ease-out";
  if(d.dy>90||(d.dy>30&&Date.now()-d.t<250)){sh.style.transform="translateY(100%)";setTimeout(()=>{S.dayOpen=false;render()},180)}
  else sh.style.transform="";
});
/* ---------- 予定の検索（TimeTreeのように）：上の🔍から。1年前〜2年先の予定を、題名・名前・場所・メモなどで探す ----------
   サーバー（cal.search）の結果に、この端末の最新（まだ送っていない変更・削除）を重ねる。いまの事業のタブの予定だけ */
const SR={open:false,q:"",items:[],loading:false,err:"",more:false,seq:0,timer:0};
function openSearch(){SR.open=true;document.documentElement.classList.add("srchopen");renderSearch();setTimeout(()=>{const i=$("sq");if(i)i.focus()},30)}
function closeSearch(){SR.open=false;clearTimeout(SR.timer);SR.seq++;$("searchRoot").innerHTML="";document.documentElement.classList.remove("srchopen")}
const srTerms=()=>SR.q.split(/[\s\u3000]+/).map(kanaNorm).filter(Boolean);
function srMatch(e,terms){const sg=e.sg||{};const hay=kanaNorm([e.title,e.place,e.memo,(e.tanto||[]).join(" "),(sg.staff||[]).join(" "),(sg.users||[]).join(" "),sg.reason,sg.note,sg.meetPlace,sg.sendPlace,LMAP[e.label]?.n].join(" "));return terms.every(t=>hay.includes(t))}
function srList(){
  const terms=srTerms();if(!terms.length)return[];
  const ok=e=>e&&!e.deleted&&srMatch(e,terms)&&(S.biz==="all"||bizOf(e)===S.biz);
  const local=new Map(allEvents().map(e=>[e.id,e])),out=new Map();
  for(const e of SR.items){const l=local.get(e.id)||e;if(ok(l))out.set(l.id,l)}
  for(const e of local.values())if(ok(e))out.set(e.id,e);
  return[...out.values()].sort((a,b)=>a.date.localeCompare(b.date)||cmp(a,b));
}
function doSearch(){
  clearTimeout(SR.timer);const q=SR.q.trim();const my=++SR.seq;
  if(!q){SR.items=[];SR.loading=false;SR.more=false;drawSearchResults();return}
  SR.loading=true;drawSearchResults();
  SR.timer=setTimeout(async()=>{let r=null,err="";
    try{if(window.SGHost)r=await window.SGHost.call("cal.search",{q,biz:S.biz==="all"?"":S.biz})}catch(e){err="通信できないため、この端末で読み込んだ月の予定だけから探しています。"}
    if(my!==SR.seq)return;SR.items=r?r.items||[]:[];SR.more=!!(r&&r.more);SR.err=err;SR.loading=false;drawSearchResults()},300);
}
function hl(t){let h=esc(t);for(const w of SR.q.split(/[\s\u3000]+/).filter(Boolean)){const ew=esc(w);if(ew&&!/[&;]/.test(ew))h=h.split(ew).join(`<b>${ew}</b>`)}return h}   // 題名の中の言葉を太字に
function drawSearchResults(){
  const box=$("sres");if(!box)return;
  const clr=document.querySelector("[data-sr-clear]");if(clr)clr.hidden=!SR.q;
  if(!SR.q.trim()){box.innerHTML=`<div class="empty">名前・題名・場所などで探せます（1年前〜2年先の予定）。<br>空白で区切ると、すべての言葉を含む予定だけ出ます。</div>`;return}
  const list=srList(),g=new Map();for(const e of list){if(!g.has(e.date))g.set(e.date,[]);g.get(e.date).push(e)}
  let h="";for(const[d,evs]of g){const x=parse(d);
    h+=`<div class="sr-day"><div class="sr-date"><b>${x.getFullYear()}年${x.getMonth()+1}月${x.getDate()}日(${WD[x.getDay()]})</b><span>${evs.length}件の予定</span></div>${evs.map(e=>`<button class="sr-row" data-srev="${esc(e.id)}" style="--c:var(--l-${lab(e.label)})"><span class="ds-bar"></span><span class="ds-body"><span class="sr-t">${bizTag(e)}${hl(e.title)}</span><small>${esc(timeText(e))}${e.place?" ・ "+esc(e.place):""}</small></span></button>`).join("")}</div>`}
  box.innerHTML=(SR.err?`<p class="sr-note">${esc(SR.err)}</p>`:"")+(h||`<div class="empty">${SR.loading?"探しています…":"見つかりませんでした"}</div>`)+(SR.loading&&h?`<p class="sr-note">ほかの月も探しています…</p>`:"")+(SR.more?`<p class="sr-note">300件より多く見つかりました。言葉を足してしぼってください。</p>`:"");
}
function renderSearch(){
  if(!SR.open)return;
  if(!$("sq"))$("searchRoot").innerHTML=`<div class="overlay sr-ov" id="srOv"><div class="sheet srsheet" role="dialog" aria-modal="true" aria-label="予定を検索">
    <div class="sr-head"><button class="icon-btn" data-sr-close aria-label="閉じる">×</button><h2>予定を検索</h2><span class="sr-sp"></span></div>
    <div class="sr-bar"><span class="sr-ico" aria-hidden="true">🔍</span><input id="sq" class="input" type="search" enterkeyhint="search" placeholder="名前・題名・場所など" autocomplete="off" value="${esc(SR.q)}"><button type="button" class="sr-clear" data-sr-clear aria-label="消す" hidden>×</button></div>
    <div class="sr-res" id="sres"></div></div></div>`;
  drawSearchResults();
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
   ・ヘルプ … 担当職員・開始時刻・行き先 → 送迎表の【ヘルプ】（担当未定は保留欄）
   ・送迎 … 利用者・迎え（いつもどおり/時間変更/家族送り/受診後送り）・送り（いつもどおり/時間変更/家族迎え）・迎え先・送り先の変更
   ・職員休み … 職員・1日/AM休/PM休/時間 → 休み・半休・不在
   ・利用者休み … 利用者・理由（任意） → 欠席
   ・その他予定 … 時間・場所・担当（職員の予定として送迎表に載せることもできる）
   ・休日出勤 … 職員・時間・その日の部署 → 送迎表の出勤者に入る
   ・勤務時間変更 … 職員・出勤／退勤（いつもどおり or 時刻を変える）・その日の部署・理由 → その日の勤務時間
   ・モニタリング／支援会議 … 利用者・時間・場所・対応者 → 対応者の予定（その時間は送迎と重なると注意が出る） */
const HALF={am:"AM休",pm:"PM休"};
const SGT_SHORT={staff_off:"職員の休み",staff_plan:"職員の予定",user_absent:"欠席",user_time:"送迎の変更",user_extra:"利用日外利用",help:"ヘルプ",hwork:"休日出勤",shift:"職員時間変更"};
const PICK={user:["体調不良","受診","家族の用事","ショートステイ"],shift:["早出","遅出","残業","遅刻・早退"]};
const NO_MEET={fam:"家族送り",clinic:"受診後送り"},NO_SEND={fam:"家族迎え"};   // 送迎表の「迎えなし・送りなし」の理由としてそのまま出る
const LABEL_OF_SG={staff_off:"leave",user_absent:"user",user_time:"ride",user_extra:"extra",help:"help",hwork:"hwork",shift:"shift",staff_plan:"other"};
const USER_LABELS=["help","ride","user","extra"];          // 利用者が関わるラベル（送迎表の担当者だけが入力できる）
const PLAN_LABELS=["monitor","shien"];             // モニタリング・支援会議：利用者・時間・場所・対応者。対応者の予定として送迎表に入る
let SGN={staff:[],users:[],depts:[],places:[],yomi:{},loaded:false};
async function loadNames(){
  const H=window.SGHost;if(!H)return;
  let r=null;try{r=await H.call("names.list")}catch{}
  if(!H.directory().length)await H.loadDirectory();
  SGN={staff:H.directory().filter(d=>d.no!=="000").map(d=>({name:d.name,dept:d.no})),users:r?r.users||[]:SGN.users,kids:r?r.kids||[]:(SGN.kids||[]),depts:r?r.depts||[]:SGN.depts,places:r?r.places||[]:SGN.places,yomi:r?r.yomi||{}:SGN.yomi,loaded:true};
}
const meInfo=()=>window.SGHost&&window.SGHost.me||{};
const canLabel=k=>{const me=meInfo();return!USER_LABELS.includes(k)||!!(me.canSougei||me.admin)};
const selfOnly=()=>!meInfo().admin;
function sgText(sg){if(!sg)return"";const who=[...(sg.staff||[]),...(sg.users||[])];const t=sg.half?HALF[sg.half]:SGT_SHORT[sg.type]||"";return`送迎表：${t}（${who.slice(0,4).join("・")}${who.length>4?` 他${who.length-4}名`:""}）`}
/* 予定 → 入力欄の状態(w)。ラベルを切り替えても、選んだ人はそのまま残す */
function workOf(d){
  const sg=d.sg||{};
  const mOf=v=>Object.keys(NO_MEET).find(k=>NO_MEET[k]===v)||(/受診/.test(v)?"clinic":"fam");
  return{staff:[...(sg.staff||d.tanto||[])],users:[...(sg.users||[])],reason:sg.reason||"",dest:sg.type==="help"&&sg.note!==(sg.users||[])[0]?sg.note||"":"",dept:sg.dept||"",
    leave:sg.half||(sg.type==="staff_off"&&!d.allDay?"time":"day"),
    meetM:sg.meet?"time":sg.noMeet?mOf(sg.noMeet):"same",sendM:sg.send?"time":sg.noSend?"fam":"same",meet:sg.meet||"",send:sg.send||"",mplace:sg.meetPlace||"",splace:sg.sendPlace||"",
    plan:sg.type==="staff_plan",wsM:sg.wstart?"time":"same",weM:sg.wend?"time":"same",wstart:sg.wstart||"",wend:sg.wend||""};
}
/* 入力欄の状態 → 送迎表に反映する内容 */
function sgOf(label,w){
  const base={staff:[...w.staff],users:[...w.users],meet:"",send:"",noMeet:"",noSend:"",half:"",reason:"",note:"",dept:"",wstart:"",wend:"",meetPlace:"",sendPlace:""};
  if(label==="leave")return Object.assign(base,{type:"staff_off",users:[],half:w.leave==="am"||w.leave==="pm"?w.leave:""});
  if(label==="user")return Object.assign(base,{type:"user_absent",staff:[],reason:w.reason});
  if(label==="ride"||label==="extra")return Object.assign(base,{type:label==="extra"?"user_extra":"user_time",staff:[],meet:w.meetM==="time"?w.meet:"",send:w.sendM==="time"?w.send:"",noMeet:NO_MEET[w.meetM]||"",noSend:NO_SEND[w.sendM]||"",
    meetPlace:NO_MEET[w.meetM]?"":w.mplace.trim(),sendPlace:NO_SEND[w.sendM]?"":w.splace.trim()});   // 迎えなし・送りなしのときは行き先なし
  if(label==="help")return Object.assign(base,{type:"help",staff:[],note:w.dest.trim()});   // 職員は選ばない（送迎表の保留欄に入り、担当者が割り当てる）
  if(label==="hwork")return Object.assign(base,{type:"hwork",users:[],dept:w.dept});
  if(label==="shift")return Object.assign(base,{type:"shift",users:[],dept:w.dept,reason:w.reason,wstart:w.wsM==="time"?w.wstart:"",wend:w.weM==="time"?w.wend:""});
  if(PLAN_LABELS.includes(label))return Object.assign(base,{type:"staff_plan"});
  if(label==="other"&&w.plan)return Object.assign(base,{type:"staff_plan",users:[]});
  return null;
}
const addMin=(t,n)=>{const m=/^(\d{1,2}):(\d{2})$/.exec(t||"");if(!m)return"";const x=Math.min(23*60+59,Number(m[1])*60+Number(m[2])+n);return`${pad(Math.floor(x/60))}:${pad(x%60)}`};
/* ラベルによって、終日かどうかは入力欄から決まる */
function fixTimes(d){
  const w=d.w;
  if(d.label==="leave")d.allDay=w.leave!=="time";
  else if(d.label==="user"||d.label==="ride"||d.label==="extra"||d.label==="shift")d.allDay=true;
  else if(d.label==="help"){d.allDay=false;d.endDate=d.date;if(d.start)d.end=addMin(d.start,60)}   // ヘルプは開始時刻だけ（長さは送迎表の決まり）
  else if(d.label==="hwork"||PLAN_LABELS.includes(d.label))d.allDay=false;
  if(d.label==="leave"&&w.leave!=="time"&&w.leave!=="day")d.endDate=d.date;
}
const staffSelf=d=>selfOnly()&&(d.label==="leave"||d.label==="hwork"||d.label==="shift");
function drawSg(){
  if(!ed)return;const box=$("sgArea");if(!box)return;
  const d=ed.d,w=d.w,ro=ed.ro,me=meInfo(),L=d.label,dis=ro?"disabled":"";
  if(staffSelf(d)&&!ro)w.staff=me.name?[me.name]:[];
  const chips=(kind)=>{const list=w[kind];return list.length?`<div class="sgchips">${list.map(n=>`<span class="sgchip">${esc(n)}${ro?"":`<button type="button" data-sgrm="${kind}" data-name="${esc(n)}" aria-label="外す">×</button>`}</span>`).join("")}</div>`:""};
  // 1つの予定に1人（休み・送迎・ヘルプなど）：1人選んだら検索の欄は出さない（変えるときは×で外す）
  const picker=(kind,ph)=>ro?"":oneOnly(L,kind)&&(w[kind]||[]).length?hint("1つの予定に1人です。ほかの人は別の予定で入れてください（変えるときは×で外します）。"):`<input class="input" id="f-sgq-${kind}" placeholder="${ph}" autocomplete="off"><div class="sghits" id="sghits-${kind}" hidden></div>`;
  const who=(kind,title,ph,empty)=>`<div class="sgsub"><span class="lbl2">${title}</span>${chips(kind)||`<span class="by">${empty||"まだ選ばれていません"}</span>`}${picker(kind,ph)}</div>`;
  const self=`<div class="sgsub"><span class="lbl2">職員</span><div class="sgchips"><span class="sgchip" style="padding-right:10px">${esc(me.name||"")}（自分）</span></div></div>`;
  const radios=(name,cur,opts)=>`<div class="labels" role="radiogroup">${opts.map(([k,l])=>`<label style="--c:var(--l-${L})"><input type="radio" name="${name}" value="${k}" ${String(cur)===k?"checked":""} ${dis}><span>${l}</span></label>`).join("")}</div>`;
  const text=(id,val,ph,list,title)=>`<div class="sgsub"><label class="lbl2" for="${id}">${title}</label>${list?`<div class="fills">${list.map(x=>`<button type="button" class="fill${val===x?" on":""}" data-fill="${id}" data-v="${esc(x)}" ${dis}>${esc(x)}</button>`).join("")}</div>`:""}<input class="input" id="${id}" maxlength="40" value="${esc(val)}" placeholder="${ph}" ${ro?"readonly":""}></div>`;
  const dept=()=>`<div class="sgsub"><label class="lbl2" for="w-dept">その日の部署</label><select class="input" id="w-dept" ${dis}><option value="">いつもの部署</option>${[...new Set(SGN.depts.concat(w.dept?[w.dept]:[]))].map(v=>`<option ${v===w.dept?"selected":""}>${esc(v)}</option>`).join("")}</select></div>`;
  const tm=(name,cur,id,tv,lbl,opts)=>`<div class="sgsub"><span class="lbl2">${lbl}</span>${radios(name,cur,opts)}${cur==="time"?`<input class="input" type="time" id="${id}" value="${esc(tv)}" step="300" aria-label="${lbl}の時刻" ${ro?"readonly":""}>`:""}</div>`;
  const hint=t=>`<p class="by sghint">${t}</p>`;
  const place=(id,val,title,ph)=>`<div class="sgsub"><label class="lbl2" for="${id}">${title}</label><input class="input" id="${id}" maxlength="40" list="w-place-list" value="${esc(val)}" placeholder="${ph}" autocomplete="off" ${ro?"readonly":""}></div>`;
  let h="";
  if(!canLabel(L)&&!ro)h=hint("このラベルは送迎表の担当者が入力します。");
  else if(L==="help")h=who("users","利用者","利用者の名前で検索")
    +`<div class="sgsub"><label class="lbl2" for="w-dest">行き先（家以外のときだけ）</label><input class="input" id="w-dest" maxlength="40" value="${esc(w.dest)}" placeholder="例：○○病院" autocomplete="off" ${ro?"readonly":""}></div>`
    +hint("開始時刻に、送迎表の「保留」欄へ【ヘルプ】として入ります。担当する職員は送迎表で割り当ててください（終わりの時刻は送迎表の決まりどおり）。");
  else if(L==="ride"||L==="extra")h=who("users","利用者","利用者の名前で検索")
    +tm("w-meet",w.meetM,"w-meett",w.meet,"迎え",[["same",L==="extra"?"いつもの時刻":"いつもどおり"],["time","時間変更"],["fam","家族送り"],["clinic","受診後送り"]])
    +(NO_MEET[w.meetM]?"":place("w-mplace",w.mplace,"迎え先の変更（いつもと違うときだけ）","例：実家・ﾘﾍﾞ"))
    +tm("w-send",w.sendM,"w-sendt",w.send,"送り",[["same",L==="extra"?"いつもの時刻":"いつもどおり"],["time","時間変更"],["fam","家族迎え"]])
    +(NO_SEND[w.sendM]?"":place("w-splace",w.splace,"送り先の変更（いつもと違うときだけ）","例：実家・病院"))
    +`<datalist id="w-place-list">${SGN.places.map(v=>`<option value="${esc(v)}"></option>`).join("")}</datalist>`
    +(L==="extra"?hint("利用日でない日に来る人です。送迎表のその日に「今日だけ利用」として入り、迎え・送りが「未割当」に出るので、送迎表で便を決めてください。何日か続くときは終了日を変えてください。"):"")
    +(L==="extra"?"":hint("変えるところだけ入れてください。家族送り・受診後送り・家族迎えは、送迎表で「迎えなし・送りなし」として理由つきで入ります。迎え先・送り先は、その日その人が乗る便に「その日だけの行き先」として入ります（まだ便に入っていなければ、入れたときに入ります）。何日も続くときは終了日を変えてください。"));
  else if(L==="leave")h=(staffSelf(d)?self:who("staff","休む職員","職員の名前で検索"))
    +`<div class="sgsub"><span class="lbl2">休みの形</span>${radios("w-leave",w.leave,[["day","1日"],["am","AM休"],["pm","PM休"],["time","時間で（中抜け・通院など）"]])}</div>`
    +hint((w.leave==="am"?"勤務時間の真ん中＋30分から出勤として送迎表に入ります（8:30〜17:30なら13:30から）。":w.leave==="pm"?"勤務時間の真ん中−30分で退勤として送迎表に入ります（8:30〜17:30なら12:30まで）。":w.leave==="time"?"開始〜終了の時刻を、送迎表でその職員の不在として入れます。":"送迎表でその日は休みになります。何日も続く休みは終了日を変えてください。")+"休みの時間にかかる、この職員の担当の便・ヘルプは送迎表の「保留」に移ります（予定を消すと元に戻ります）。");
  else if(L==="user")h=who("users","利用者","利用者の名前で検索")+text("w-reason",w.reason,"例：通院",PICK.user,"理由（任意）")
    +hint("送迎表でその日は欠席になります。何日も続くときは終了日を変えてください。迎え・送りだけ変わるときは「送迎」のラベルを使ってください。");
  else if(L==="hwork")h=(staffSelf(d)?self:who("staff","出勤する職員","職員の名前で検索"))+dept()
    +hint("下の開始・終了の時刻で、送迎表のその日の出勤者に入ります（固定休の日でも）。");
  else if(L==="shift")h=(staffSelf(d)?self:who("staff","職員","職員の名前で検索"))
    +tm("w-ws",w.wsM,"w-wst",w.wstart,"出勤",[["same","いつもどおり"],["time","時刻を変える"]])+tm("w-we",w.weM,"w-wet",w.wend,"退勤",[["same","いつもどおり"],["time","時刻を変える"]])
    +dept()+text("w-reason",w.reason,"例：送迎の応援",PICK.shift,"理由（任意）")
    +hint("送迎表のその日の勤務時間（出勤・退勤）が変わります。何日も続くときは終了日を変えてください。");
  else if(PLAN_LABELS.includes(L))h=who("users","利用者","利用者の名前で検索")+who("staff","対応者","職員の名前で検索")
    +`<div class="sgsub"><label class="lbl2" for="f-place">場所</label><input class="input" id="f-place" maxlength="80" value="${esc(d.place)}" placeholder="例：自宅・事業所・○○病院" ${ro?"readonly":""}></div>`
    +hint("対応者の予定として、送迎表のその時間に入ります（送迎と重なると注意が出ます）。")+(!meInfo().canSougei?hint("対応者に自分以外を入れるときは、送迎表の担当者か管理者に入れてもらってください。"):"");
  else h=who("staff","担当","職員の名前で検索","なし")
    +`<label class="check"><input type="checkbox" id="w-plan" ${w.plan?"checked":""} ${dis}>担当の職員の予定として送迎表にも載せる（会議・研修・外出など）</label>`
    +(w.plan?hint("その時間の予定として担当の職員の欄に入り、送迎と重なると注意が出ます。"):"");
  box.innerHTML=h+(!SGN.loaded?`<span class="by">名前の一覧を読み込んでいます…</span>`:"");
}
/* 読みをそろえる：カタカナ→ひらがな、半角→全角、空白なし */
/* 1つの予定に1人だけ（2026-10-29 依頼者）。その他予定の担当と、モニタリング・支援会議の対応者だけは何人でも */
const oneOnly=(L,kind)=>!(L==="other"||(PLAN_LABELS.includes(L)&&kind==="staff"));
function kanaNorm(s){return String(s||"").normalize("NFKC").replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/\s+/g,"").toLowerCase()}
function sgHits(kind,q){
  const h=$("sghits-"+kind);if(!h||!ed)return;const sel=new Set(ed.d.w[kind]||[]);
  // 利用者の候補：放課後デイの予定は送迎表のりんく・ぷれいす版の利用者、生活介護は現体制版・新体制版の利用者
  const kidsMode=kind!=="staff"&&bizOf(ed.d)==="houkago";
  const src=kind==="staff"?SGN.staff:kidsMode?(SGN.kids||[]):SGN.users;const qq=String(q||"").trim();
  // 予測：「た」→ 田中・田原（「よみがな」シートの読みの頭）、「田」→ 田中（名前の頭）。頭が合うものを先に
  const qn=kanaNorm(qq),Y=SGN.yomi||{};
  const scored=src.filter(x=>!sel.has(x.name)).map(x=>{const n=kanaNorm(x.name),y=kanaNorm(Y[x.name]||"");
    const s=!qn?2:(n.startsWith(qn)||(y&&y.startsWith(qn)))?0:(n.includes(qn)||(y&&y.includes(qn)))?1:String(x.dept).includes(qq)?2:9;return{x,s,k:y||n}}).filter(o=>o.s<9);
  scored.sort((a,b)=>a.s-b.s||a.k.localeCompare(b.k,"ja"));
  const list=scored.slice(0,qn?12:40).map(o=>o.x);
  h.innerHTML=list.length?list.map(x=>`<button type="button" data-sgpick="${kind}" data-name="${esc(x.name)}"><span>${esc(x.name)}${Y[x.name]?` <small>${esc(Y[x.name])}</small>`:""}</span><small>${esc(x.dept)}</small></button>`).join(""):`<div class="by" style="padding:6px 10px">${!SGN.loaded?"読み込み中…":kidsMode&&!(SGN.kids||[]).length?"放課後デイ（りんく・ぷれいす）の利用者がまだいません。送迎表の「りんく・ぷれいす版」の利用者タブで登録すると、ここに出ます。":"見つかりません"}</div>`;h.hidden=false;
}
function readSg(){
  if(!ed||!$("sgArea"))return;const w=ed.d.w;
  const rv=n=>{const x=document.querySelector(`input[name="${n}"]:checked`);return x?x.value:null};
  const iv=id=>{const x=$(id);return x?x.value.trim():null};
  for(const[n,k]of[["w-leave","leave"],["w-meet","meetM"],["w-send","sendM"],["w-ws","wsM"],["w-we","weM"]]){const v=rv(n);if(v!=null)w[k]=v}
  for(const[id,k]of[["w-dest","dest"],["w-mplace","mplace"],["w-splace","splace"],["w-reason","reason"],["w-meett","meet"],["w-sendt","send"],["w-dept","dept"],["w-wst","wstart"],["w-wet","wend"]]){const v=iv(id);if(v!=null)w[k]=v}
  if($("w-plan"))w.plan=$("w-plan").checked;
  if($("f-place"))ed.d.place=$("f-place").value.trim();   // 場所が項目の中にあるラベル（モニタリング・支援会議）でも書きかけを残す
}
/* 自動で付けるタイトル（空欄のとき） */
function autoTitle(label,sg,w){
  const nm=a=>a.slice(0,3).join("・")+(a.length>3?"他":"");
  if(!sg)return"";
  if(PLAN_LABELS.includes(label))return`${LMAP[label].n}（${nm(sg.users)||"利用者"}）`;
  const r=sg.reason?`（${sg.reason}）`:"";
  if(sg.type==="staff_off")return`${nm(sg.staff)} ${sg.half?HALF[sg.half]:"休み"}`;
  if(sg.type==="user_absent")return`${nm(sg.users)} 欠席${r}`;
  if(sg.type==="user_extra")return`${nm(sg.users)} 利用日外利用${[sg.noMeet,sg.noSend].filter(Boolean).map(x=>`・${x}`).join("")}`;
  if(sg.type==="user_time")return`${nm(sg.users)} ${[sg.meet&&`迎え${sg.meet}`,sg.noMeet,sg.meetPlace&&`迎え先${sg.meetPlace}`,sg.send&&`送り${sg.send}`,sg.noSend,sg.sendPlace&&`送り先${sg.sendPlace}`].filter(Boolean).join("・")}`;
  if(sg.type==="help")return`${nm(sg.users)} ヘルプ${sg.note?`（${sg.note}）`:""}`;
  if(sg.type==="hwork")return`${nm(sg.staff)} 休日出勤`;
  if(sg.type==="shift")return`${nm(sg.staff)} ${[sg.wstart&&`出勤${sg.wstart}`,sg.wend&&`退勤${sg.wend}`].filter(Boolean).join("・")||"部署変更"}${r}`;
  return"";
}
/* 入力の確認。問題があれば日本語のメッセージを返す */
function checkSg(d,sg){
  if(!canLabel(d.label))return"このラベルは送迎表の担当者だけが入力できます。";
  if(!sg)return"";
  const w=d.w;
  if((sg.type==="staff_off"||sg.type==="hwork"||sg.type==="shift")&&!sg.staff.length)return"職員を選んでください。";
  if(sg.type==="staff_plan"&&PLAN_LABELS.includes(d.label)){
    if(!sg.users.length)return"利用者を選んでください。";
    if(!sg.staff.length)return"対応者を選んでください。";
    if(!meInfo().canSougei&&!(sg.staff.length===1&&sg.staff[0]===meInfo().name))return"対応者に自分以外を入れられるのは、送迎表の担当者と管理者だけです。対応者を自分だけにしてください。";}
  if(sg.type==="staff_plan"){
    if(!sg.staff.length)return"送迎表に載せるときは、担当の職員を選んでください。";
    if(selfOnly()&&!(sg.staff.length===1&&sg.staff[0]===meInfo().name))return"送迎表に載せられるのは自分の予定だけです。担当を自分だけにするか、チェックを外してください。";}
  if(sg.type.startsWith("user")&&!sg.users.length)return"利用者を選んでください。";
  if(sg.type==="help"&&!sg.users.length)return"利用者を選んでください。";
  if(sg.type==="shift"){
    if(w.wsM==="same"&&w.weM==="same"&&!w.dept)return"出勤・退勤のどちらを変えるか（または部署）を選んでください。";
    if((w.wsM==="time"&&!w.wstart)||(w.weM==="time"&&!w.wend))return"変更後の時刻を入れてください。";}
  if(sg.type==="user_time"){
    if(w.meetM==="same"&&w.sendM==="same"&&!sg.meetPlace&&!sg.sendPlace)return"迎え・送り（時間・迎え先・送り先）のどれを変えるか選んでください。";
    if((w.meetM==="time"&&!w.meet)||(w.sendM==="time"&&!w.send))return"変更後の時刻を入れてください。";}
  return"";
}
/* 休み・AM休・PM休ボタン：押すだけで自分（管理者は選んだ職員）の休みが入り、送迎表に反映される */
function quickHtml(){
  const me=window.SGHost&&window.SGHost.me;if(!me||!core)return"";
  const isStaff=SGN.staff.some(s=>s.name===me.name);
  if(!isStaff&&!me.admin)return"";
  if(SGN.loaded&&!SGN.staff.length)return`<div class="quick"><b>休みを入れる</b><span class="by">送迎表のデータ（職員）を入れると、ここで職員を選んで休みを入れられます。</span></div>`;
  const opts=me.admin?`<select class="input" id="qStaff">${(isStaff?[{name:me.name}]:[]).concat(SGN.staff.filter(s=>s.name!==me.name)).map(s=>`<option ${s.name===S.qStaff?"selected":""}>${esc(s.name)}</option>`).join("")}</select>`:"";
  return`<div class="quick"><b>${me.admin?"休みを入れる":"自分の休みを入れる"}（この日）</b>${opts}<div class="qrow"><select class="input" id="qKind" aria-label="休みの種類">${[["","休み（1日）"],["am","AM休"],["pm","PM休"]].map(([k,l])=>`<option value="${k}" ${String(S.qKind||"")===k?"selected":""}>${l}</option>`).join("")}</select><button class="primary" data-quick>入れる</button></div><span class="by">送迎表にも自動で反映されます。</span></div>`;
}
function quickOff(half){
  const me=window.SGHost.me;const name=me.admin&&$("qStaff")?$("qStaff").value:me.name;S.qStaff=name;
  const exist=allEvents().find(e=>!e.deleted&&e.sg&&e.sg.type==="staff_off"&&e.sg.staff.includes(name)&&e.date<=S.sel&&e.endDate>=S.sel);
  if(exist){toast("この日はすでに「"+exist.title+"」が入っています。変更はその予定を開いてください");openEditor(exist);return}
  const label=half?HALF[half]:"休み";
  core.save({title:`${name} ${label}`,date:S.sel,endDate:S.sel,allDay:true,start:"",end:"",label:"leave",biz:newBiz(),place:"",memo:"",members:[],sg:{type:"staff_off",staff:[name],users:[],meet:"",send:"",noMeet:"",noSend:"",half:half||""}},null);
  toast(`${name}さんの${label}を入れました（送迎表に反映されます）`);render();
}

/* ---------- 予定の編集 ---------- */
let ed=null;
function openEditor(ev,day,draft){
  const ro=!(db&&S.canWrite&&core);
  const base=ev||null;
  // 新しい予定は「ヘルプ」から（ヘルプを入れられない一般職員は「職員休み」から）
  const d=draft?draft.form:ev?{...ev,members:[...ev.members]}:{title:"",date:day||S.sel,endDate:day||S.sel,allDay:false,start:"10:00",end:"11:00",label:canLabel("help")?"help":"leave",place:"",memo:"",members:S.me?[S.me]:[],sg:null,biz:newBiz()};
  if(d.sg&&LABEL_OF_SG[d.sg.type]&&!(d.sg.type==="staff_plan"&&PLAN_LABELS.includes(d.label)))d.label=LABEL_OF_SG[d.sg.type];
  if(!d.w)d.w=workOf(d);
  if(!ev&&!draft){fixTimes(d);try{window.SGHost&&window.SGHost.pollOnce&&window.SGHost.pollOnce()}catch{}}   // 新しい予定を入れる前に、ほかの人の分を読み直す   // 最初に選ばれているラベルに合わせて終日・時刻をそろえる
  ed={id:draft?draft.id:ev?.id||null,base:draft?draft.base:base,d,ro:ro||(!!ev&&!canLabel(d.label)),confirmDel:false,comments:[],err:"",changed:false};
  if(!SGN.loaded)loadNames().then(()=>{if(ed)drawSg()});
  drawSheet();
  unsubCm?.();unsubCm=null;
  if(ed.id&&db&&ed.base){try{unsubCm=db.doc(C.cmPath(ed.base.cmKey||ed.base.date,ed.id)).onSnapshot(s=>{if(!ed)return;const cm=s.exists?C.normCm(s.data()):{};ed.comments=cm[ed.id]||[];drawComments()},()=>{})}catch{}}
  setTimeout(()=>{const c=document.querySelector('input[name="f-label"]:checked');(c||$("f-title")||{focus(){}}).focus()},30);   // 選んであるラベルに合わせる
}
function closeEditor(keepDraft){unsubCm?.();unsubCm=null;if(!keepDraft)draftDrop();ed=null;$("sheetRoot").innerHTML="";render()}
function readForm(){
  if(!$("f-date"))return;const d=ed.d;if($("f-title"))d.title=$("f-title").value.trim();d.allDay=$("f-allday").checked;d.date=$("f-date").value;d.endDate=$("f-enddate").value||d.date;
  d.start=$("f-start").value;d.end=$("f-end").value;d.label=document.querySelector('input[name="f-label"]:checked')?.value||"other";d.biz=document.querySelector('input[name="f-biz"]:checked')?.value||bizOf(d);d.place=$("f-place")?$("f-place").value.trim():d.place;d.memo=$("f-memo").value;readSg();fixTimes(d);
}
function liveCheck(){
  if(!ed||!ed.base||!ed.id||!S.loaded)return;const cur=core?core.overlay(S.server)[ed.id]:S.server[ed.id];
  const changed=!cur||cur.deleted||(cur.rev!==ed.base.rev&&!cur.pending);
  if(changed!==ed.changed){ed.changed=changed;const b=$("liveNote");if(b)b.hidden=!changed}
}
function drawSheet(){
  const keep=document.querySelector("#sheetRoot .sheet")?.scrollTop||0;   // 「時間変更」などを押して作り直しても、見ていた位置のまま
  const d=ed.d,ro=ed.ro,v=x=>ro?"readonly":"";
  // ラベルごとの項目。その他予定は「時間・場所・担当」の順になるよう、場所の下に出す
  const box=`<div class="field sgbox" style="--sc:var(--l-${lab(d.label)})"><span class="lbl">${esc(LMAP[d.label]?.n||"その他予定")}で入力する項目</span><div id="sgArea"></div></div>`;
  $("sheetRoot").innerHTML=`<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t">
  <div class="sheet-head"><h2 id="sh-t">${ed.id?"予定の詳細":"新しい予定"}</h2><button class="icon-btn" data-close aria-label="閉じる">×</button>${ro||ed.confirmDel?"":`<button type="button" class="primary head-save" data-hsave>保存</button>`}</div>
  <form class="sheet-body" id="evForm" novalidate>
    <div class="note warn" id="liveNote" ${ed.changed?"":"hidden"}><p>この予定は、開いている間に他の人が変更または削除しました。このまま保存すると、どちらを残すか確認する画面が出ます。</p></div>
    <div class="field"><span class="lbl">事業</span><div class="labels bizpick">${["seikatsu","houkago"].map(k=>`<label style="--c:var(--b-${k})"><input type="radio" name="f-biz" id="f-biz-${k}" value="${k}" ${bizOf(d)===k?"checked":""} ${ro?"disabled":""}><span>${BIZN[k]}</span></label>`).join("")}</div></div>
    <div class="field"><span class="lbl">ラベル</span><div class="labels lblpick">${LABELS.map(l=>`<label style="--c:var(--l-${l.k})"><input type="radio" name="f-label" id="f-label-${l.k}" value="${l.k}" ${d.label===l.k?"checked":""} ${ro||(!canLabel(l.k)&&d.label!==l.k)?"disabled":""}><span><i class="dot" style="background:var(--c)"></i>${l.n}</span></label>`).join("")}</div></div>
    ${d.label==="other"?"":box}
    ${d.label==="other"?`<div class="field"><label for="f-title">タイトル</label><input class="input title-input" id="f-title" maxlength="80" value="${esc(d.title)}" placeholder="例：週次定例" ${v()}></div>`:""}
    <label class="check" ${d.label==="other"?"":"hidden"}><input type="checkbox" id="f-allday" ${d.allDay?"checked":""} ${ro?"disabled":""}>終日</label>
    <div class="row">
      <div class="field"><label for="f-date">開始日</label><input class="input" type="date" id="f-date" value="${esc(d.date)}" ${v()}></div>
      <div class="field" ${d.allDay?"hidden":""} id="w-start"><label for="f-start">${d.label==="hwork"?"出勤の時刻":"開始時刻"}</label><input class="input" type="time" id="f-start" value="${esc(d.start||"10:00")}" step="300" ${v()}></div>
    </div>
    <div class="row">
      <div class="field" ${d.label==="help"?"hidden":""}><label for="f-enddate">終了日</label><input class="input" type="date" id="f-enddate" value="${esc(d.endDate)}" ${v()}></div>
      <div class="field" ${d.allDay||d.label==="help"?"hidden":""} id="w-end"><label for="f-end">${d.label==="hwork"?"退勤の時刻":"終了時刻"}</label><input class="input" type="time" id="f-end" value="${esc(d.end||"11:00")}" step="300" ${v()}></div>
    </div>
    ${d.label==="other"?`<div class="field"><label for="f-place">場所</label><input class="input" id="f-place" maxlength="80" value="${esc(d.place)}" placeholder="会議室A / オンライン など" ${v()}></div>`:""}
    ${d.label==="other"?box:""}
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
  if(keep){const sh=document.querySelector("#sheetRoot .sheet");if(sh)sh.scrollTop=keep}
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
function showErr(m){ed.err=m;const e=$("f-err");if(e){e.textContent=m;e.hidden=!m;if(m&&e.scrollIntoView)e.scrollIntoView({block:"center"})}}
/* 同じ予定がもう入っていないか（ほかの人が先に入れた・続けて二度入れたなど）。新しい予定のときだけ見る。
   同じラベル・事業・種類・半休・開始時刻で、日が重なり、同じ職員・利用者（いなければ同じ題名）なら同じとみなす */
function dupOf(ev){
  const key=e=>[lab(e.label),bizOf(e),e.sg?e.sg.type:"",e.sg?e.sg.half||"":"",e.allDay?"":e.start].join("|");
  const who=e=>new Set([...((e.sg&&e.sg.staff)||[]),...((e.sg&&e.sg.users)||[])]);
  const k=key(ev),w=who(ev);
  return allEvents().find(e=>!e.deleted&&e.date<=ev.endDate&&e.endDate>=ev.date&&key(e)===k&&(w.size?[...w].some(n=>who(e).has(n)):e.title===ev.title));
}
function save(){
  readForm();const d=ed.d;
  d.sg=sgOf(d.label,d.w);
  const bad=checkSg(d,d.sg);if(bad)return showErr(bad);
  if(!ed.base)for(const k of["staff","users"])if(oneOnly(d.label,k)&&(d.w[k]||[]).length>1)return showErr("1つの予定に1人です。ほかの人は×で外して、別の予定で入れてください。");
  // その他予定だけタイトルを入れてもらう。ほかのラベルは入力した内容から毎回付け直す（直したときに古い題名が残らない）
  if(d.label!=="other")d.title=autoTitle(d.label,d.sg)||LMAP[d.label]?.n||d.title;
  if(!d.title)return showErr("タイトルを入力してください。");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date))return showErr("開始日を選んでください。");
  if(d.endDate<d.date)return showErr("終了日は開始日以降にしてください。");
  if(!d.allDay&&!d.start)return showErr("開始時刻を入れてください。");
  if(!d.allDay&&d.endDate===d.date&&d.end<=d.start)return showErr("終了時刻は開始時刻より後にしてください。");
  const ev={title:d.title,date:d.date,endDate:d.endDate,allDay:d.allDay,start:d.allDay?"":d.start,end:d.allDay?"":d.end,label:lab(d.label),biz:bizOf(d),place:d.place,memo:d.memo,members:d.members,tanto:d.label==="other"?[...d.w.staff]:[],sg:d.sg||null};
  if(!ed.base){const dup=dupOf(ev);if(dup&&ed.dupWarned!==dup.id){ed.dupWarned=dup.id;return showErr(`同じ予定がもう入っています（${dup.date.slice(5).replace("-","/")}「${dup.title}」）。それでも入れるときは、もう一度「保存」を押してください。`)}}
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
      const rows=[["開始日","終了日","終日","開始","終了","タイトル","事業","ラベル","場所","担当","参加者","メモ","状態","更新日時"]].concat(events.sort((a,b)=>a.date.localeCompare(b.date)||cmp(a,b)).map(e=>[e.date,e.endDate,e.allDay?"終日":"",e.start,e.end,e.title,BIZN[bizOf(e)],LMAP[e.label].n,e.place,(e.tanto||[]).join("、"),e.members.map(id=>ps[id]?.name||"メンバー").join("、"),e.memo,e.deleted?"削除済み":"",fmtAt(e.updatedAt)]));
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
$("searchBtn").onclick=openSearch;
$("todayBtn").onclick=()=>{TODAY=ymd(new Date());S.sel=TODAY;const c=new Date(new Date().getFullYear(),new Date().getMonth(),1);if(+c!==+S.cursor){S.cursor=c;subscribe()}render()};
$("vMonth").onclick=()=>{S.view="month";render()};$("vList").onclick=()=>{S.view="list";render()};$("vTrash").onclick=()=>{S.view="trash";render()};
$("addBtn").onclick=()=>openEditor(null,S.sel);
$("syncBtn").onclick=openSync;
$("bizTabs").addEventListener("click",e=>{const b=e.target.closest("[data-biz]");if(!b)return;S.biz=b.dataset.biz;try{ls&&ls.setItem("sg:biz",S.biz)}catch{}render()});
$("filters").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;if(b.hasAttribute("data-mine"))S.mine=!S.mine;else S.label=b.dataset.label;render()});
$("restoreFile").addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];e.target.value="";if(f)planRestore(f)});
document.addEventListener("click",async e=>{
  const t=e.target;
  if(t.closest("[data-reload]")){location.reload();return}
  if(t.closest("[data-draft-open]")){const d=draftGet();if(d){const cur=d.id?allEvents().find(x=>x.id===d.id):null;openEditor(cur||d.base||null,null,d)}return}
  if(t.closest("[data-draft-drop]")){draftDrop();render();return}
  if(t.id==="dayOv"||t.closest("[data-day-close]")){S.dayOpen=false;render();return}
  const ac=t.closest("[data-add-cell]");   // パソコン：日付の右を押すとその日の予定を追加
  if(ac&&!isMob()){if(db&&S.canWrite&&core){S.sel=ac.dataset.addCell;openEditor(null,ac.dataset.addCell)}return}
  if(t.closest("[data-sr-close]")){closeSearch();return}
  if(t.closest("[data-sr-clear]")){SR.q="";const i=$("sq");if(i){i.value="";i.focus()}doSearch();return}
  const srEl=t.closest("[data-srev]");
  if(srEl){const e=srList().find(x=>x.id===srEl.dataset.srev);if(e){   // 検索した予定を開く。その月のカレンダーへ移ってから開く（閉じると検索に戻る）
    const d=parse(e.date);S.sel=e.date;if(d.getMonth()!==S.cursor.getMonth()||d.getFullYear()!==S.cursor.getFullYear()){S.cursor=new Date(d.getFullYear(),d.getMonth(),1);subscribe()}
    openEditor((allEvents().find(x=>x.id===e.id))||e)}return}
  const cellEl=t.closest(".cell[data-day]");
  if(cellEl&&matchMedia("(max-width:560px)").matches){S.sel=cellEl.dataset.day;S.dayOpen=true;render();return}   // スマホは日を押すとその日の一覧
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
  if(t.closest("[data-save]")||t.closest("[data-hsave]")){save();return}
  if(t.closest("[data-del]")){readForm();ed.confirmDel=true;drawSheet();return}
  if(t.closest("[data-cancel-del]")){ed.confirmDel=false;drawSheet();return}
  if(t.closest("[data-do-del]")){core.remove(ed.base);closeEditor();toast("ゴミ箱に移しました（30日間は元に戻せます）");return}
  if(t.closest("[data-revert]")){const p=ed.base.prev;core.save({title:p.title,date:p.date,endDate:p.endDate,allDay:p.allDay,start:p.start,end:p.end,label:p.label,biz:bizOf(p),place:p.place,memo:p.memo,members:p.members,tanto:p.tanto||[],sg:p.sg||null},ed.base);closeEditor();toast("1つ前の内容に戻しました");return}
  const fl=t.closest("[data-fill]");if(fl){const i=$(fl.dataset.fill);if(i){i.value=i.value===fl.dataset.v?"":fl.dataset.v;readSg();drawSg();draftSave()}return}
  const sgp=t.closest("[data-sgpick]");if(sgp){readSg();const k=sgp.dataset.sgpick;const w=ed.d.w;if(oneOnly(ed.d.label,k))w[k]=[sgp.dataset.name];else if(!w[k].includes(sgp.dataset.name))w[k].push(sgp.dataset.name);drawSg();setTimeout(()=>{const i=$("f-sgq-"+k);if(i){i.focus();sgHits(k,"")}},0);draftSave();return}
  const sgr=t.closest("[data-sgrm]");if(sgr){readSg();const k=sgr.dataset.sgrm;ed.d.w[k]=ed.d.w[k].filter(n=>n!==sgr.dataset.name);drawSg();draftSave();return}
  if(!t.closest(".sgsub")){for(const k of["staff","users"]){const h=$("sghits-"+k);if(h)h.hidden=true}}
  const rm=t.closest("[data-rm]");if(rm){ed.d.members=ed.d.members.filter(i=>i!==rm.dataset.rm);drawMembers();draftSave();return}
  const pk=t.closest("[data-pick]");if(pk){if(!ed.d.members.includes(pk.dataset.pick))ed.d.members.push(pk.dataset.pick);$("f-member").value="";$("hits").hidden=true;drawMembers();draftSave();return}
  if(!t.closest(".picker")){const h=$("hits");if(h)h.hidden=true}
});
document.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users")){e.preventDefault();const b=$("sghits-"+e.target.id.slice(6))?.querySelector("[data-sgpick]");if(b)b.click();return}
  if(e.key==="Escape"&&$("ov")){if(ed)closeEditor(true);else $("sheetRoot").innerHTML="";return}
  if(e.key==="Escape"&&S.dayOpen){S.dayOpen=false;render();return}
  if(e.key==="Escape"&&SR.open){closeSearch();return}
  if(e.key==="Enter"&&e.target.id==="sq"){e.target.blur();return}   // 検索ボタンでキーボードを閉じて結果を見る
  const day=e.target.closest?.("[data-day]");if(day&&(e.key==="Enter"||e.key===" ")){e.preventDefault();S.sel=day.dataset.day;render()}
});
document.addEventListener("change",e=>{if(ed&&e.target.name==="f-biz"){ed.d.biz=e.target.value;["users"].forEach(k=>{const i=$("f-sgq-"+k);if(i&&document.activeElement===i)sgHits(k,i.value)})}

  if(e.target.id==="qStaff"){S.qStaff=e.target.value;return}
  if(e.target.id==="qKind"){S.qKind=e.target.value;return}
  if(!ed)return;
  // ラベル・休みの形などを変えたら、入力欄を作り直す（入力済みの値は残す）
  if(e.target.name==="f-label"||e.target.id==="w-plan"||["w-leave","w-meet","w-send","w-ws","w-we"].includes(e.target.name)){
    readForm();drawSheet();draftSave();return}
  if(e.target.id==="f-allday"){$("w-start").hidden=$("w-end").hidden=e.target.checked}
  if(e.target.id==="f-date"){const x=$("f-enddate");if(!x.value||x.value<e.target.value)x.value=e.target.value}
  draftSave()});
async function search(q){const h=$("hits");if(!h||!user)return;let res=[];try{res=await user.search(q)}catch{}if(!ed)return;res=res.filter(p=>!ed.d.members.includes(p.id));
  h.innerHTML=res.length?res.map(p=>`<button type="button" data-pick="${esc(p.id)}"><img src="${esc(p.avatarUrl)}" alt=""><span>${esc(p.name)}${p.isMe?"（自分）":""}</span></button>`).join(""):`<div class="by" style="padding:6px 8px">${q?"見つかりません":"名前を入力してください"}</div>`;h.hidden=false}
document.addEventListener("input",e=>{if(e.target.id==="sq"){SR.q=e.target.value;doSearch();return}if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){sgHits(e.target.id.slice(6),e.target.value);return}if(e.target.id==="f-member")search(e.target.value);else if(ed&&e.target.closest("#evForm"))draftSave()});
// スマホ：キーボードが出たら画面の高さを見えている所に合わせ、打っている欄を上の方へ（TimeTreeのように）
const MOB=()=>matchMedia("(max-width:560px)").matches;
function fitVV(){const vv=window.visualViewport,r=document.documentElement;if(!vv)return;
  r.style.setProperty("--vvh",vv.height+"px");r.style.setProperty("--vvt",vv.offsetTop+"px")}
let rzT=0;window.addEventListener("resize",()=>{clearTimeout(rzT);rzT=setTimeout(()=>{if(S.view==="month")render()},150)});   // 画面の向き・大きさが変わったらマスの高さを合わせ直す
if(window.visualViewport){visualViewport.addEventListener("resize",fitVV);visualViewport.addEventListener("scroll",fitVV);fitVV()}
const TYPING=el=>el&&el.closest&&el.closest("#sheetRoot .sheet")&&(el.tagName==="TEXTAREA"||(el.tagName==="INPUT"&&!/^(checkbox|radio|button|submit)$/.test(el.type)));
function bringUp(el){const sh=el.closest(".sheet"),hd=sh&&sh.querySelector(".sheet-head");if(!sh||!hd)return;
  const top=(el.closest(".sgsub,.field")||el).getBoundingClientRect().top-hd.getBoundingClientRect().bottom-8;
  if(Math.abs(top)>4)sh.scrollTop+=top}
document.addEventListener("focusin",e=>{if(!MOB()||!TYPING(e.target))return;document.documentElement.classList.add("kb");
  if(/^f-sgq-/.test(e.target.id))[60,350].forEach(ms=>setTimeout(()=>{fitVV();if(document.activeElement===e.target)bringUp(e.target)},ms))});
document.addEventListener("focusout",()=>setTimeout(()=>{if(!TYPING(document.activeElement))document.documentElement.classList.remove("kb")},120));
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
  window.SGHost.startPolling(20000);   // ほかの人が入れた予定が早く出るように（二重に入れるのを防ぐ）
  window.SGHost.onLogin(()=>core.kick());
  core.on(()=>{render();if(ed)drawComments();else if($("ov")&&$("sy-t"))openSync()});
  S.dbState="ok";subscribe();core.kick();render();   // 起動時に未送信を自動で再送（障害D）
  setInterval(()=>{if(core.status().queued&&S.online)core.kick()},30000);
})();
