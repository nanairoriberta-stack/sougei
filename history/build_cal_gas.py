"""スマホ用カレンダー（Google版）：チームカレンダーに送迎表連携欄と「休み・AM休・PM休」ボタンを加える"""
import re, sys
css = open("cal_css.txt").read()
body = open("cal_body.txt").read()
js = open("cal_js.txt").read()
def rep(s, a, b, n=1):
    c = s.count(a)
    if c != n: sys.exit(f"想定{n} 実際{c}: {a[:70]}")
    return s.replace(a, b)

css = css.replace("--l-event:#8352c9;", "--l-event:#8352c9; --l-user:#c2410c; --l-help:#3f63cf; --l-ride:#11897a; --l-hwork:#8352c9;").replace("--l-event:#b58cf2;", "--l-event:#b58cf2; --l-user:#fb923c; --l-help:#7d9bff; --l-ride:#3fc7b2; --l-hwork:#b58cf2;")
css += """
.sgbox{border:1px solid color-mix(in srgb,var(--l-user) 35%,var(--line));border-radius:10px;padding:12px;background:color-mix(in srgb,var(--l-user) 5%,var(--surface))}
.sgbox .lbl{color:var(--l-user)!important;font-weight:700}
.sgsub{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.sgchips{display:flex;flex-wrap:wrap;gap:6px}
.sgchip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-size:12px}
.sgchip button{border:0;background:none;width:22px;height:22px;border-radius:50%;color:var(--muted)}
.sghits{border:1px solid var(--line);border-radius:8px;max-height:200px;overflow:auto;background:var(--surface)}
.sghits button{display:flex;justify-content:space-between;gap:8px;width:100%;border:0;background:none;padding:8px 10px;text-align:left;font-size:14px}
.sghits button:hover,.sghits button:focus-visible{background:var(--sunken)}
.sghits small{color:var(--muted)}
.tag-sg{font-size:11px;font-weight:700;color:var(--l-user)}
.quick{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;background:color-mix(in srgb,var(--l-leave) 10%,var(--surface));border:1px solid color-mix(in srgb,var(--l-leave) 35%,var(--line))}
.quick b{font-size:13px}
.quick .qrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
.quick .qrow select{height:48px;font-size:16px;font-weight:700}
.quick .qrow .primary{height:48px;padding:0 22px;font-size:16px}
.quick select{height:36px}
@media (max-width:560px){.bar-in .seg{order:5}.bar-in #addBtn{order:6}}
"""
body = rep(body, '<div class="brand"><i></i>チームカレンダー <span class="ver" id="ver"></span></div>', '<div class="brand"><i></i>カレンダー <span class="ver" id="ver"></span></div>')

js = rep(js, 'const LABELS=[{k:"meeting",n:"会議"},{k:"visit",n:"外出・訪問"},{k:"deadline",n:"締切"},{k:"leave",n:"休暇・不在"},{k:"event",n:"社内イベント"},{k:"other",n:"その他"}];',
         'const LABELS=[{k:"help",n:"ヘルプ"},{k:"ride",n:"送迎"},{k:"leave",n:"職員休み"},{k:"user",n:"利用者休み"},{k:"other",n:"その他予定"},{k:"hwork",n:"休日出勤"}];')
js = rep(js, 'allDay:false,start:"10:00",end:"11:00",label:"meeting",', 'allDay:false,start:"10:00",end:"11:00",label:"other",')
js = rep(js, 'const APP_VERSION="2026.10.26b";', 'const APP_VERSION="2026.10.27b";')
js = rep(js, '/* ---------- 予定の編集 ---------- */', r'''/* ---------- 送迎表との連携 ---------- */
const SGT={staff_off:"職員の休み・不在",staff_plan:"職員の予定（会議・外出・研修など）",user_absent:"利用者の欠席",user_time:"利用者の時間変更（受診後来所など）"};
const SGT_SHORT={staff_off:"職員の休み",staff_plan:"職員の予定",user_absent:"欠席",user_time:"時間変更"};
const HALF={am:"AM休",pm:"PM休"};
let SGN={staff:[],users:[],loaded:false};
async function loadNames(){
  const H=window.SGHost;if(!H)return;
  let users=[];try{users=(await H.call("names.list")).users||[]}catch{users=SGN.users}
  if(!H.directory().length)await H.loadDirectory();
  SGN={staff:H.directory().filter(d=>d.no!=="000").map(d=>({name:d.name,dept:d.no})),users,loaded:true};
}
function sgText(sg){if(!sg)return"";const who=[...(sg.staff||[]),...(sg.users||[])];return`送迎表：${sg.half?HALF[sg.half]:SGT_SHORT[sg.type]||""}（${who.slice(0,4).join("・")}${who.length>4?` 他${who.length-4}名`:""}）`}
function drawSg(){
  if(!ed)return;const box=$("sgArea");if(!box)return;
  const sg=ed.d.sg||{type:""};const ro=ed.ro;
  const me=window.SGHost&&window.SGHost.me||{};const selfOnly=!me.admin;
  if(selfOnly&&(sg.type==="staff_off"||sg.type==="staff_plan")&&!ro){sg.staff=[me.name];ed.d.sg=sg}
  const types=Object.entries(SGT).filter(([k])=>me.canSougei||me.admin||k.startsWith("staff")||k===sg.type);
  const staffT=sg.type==="staff_off"||sg.type==="staff_plan",userT=sg.type==="user_absent"||sg.type==="user_time";
  const chips=(kind)=>{const list=(sg[kind]||[]);return list.length?`<div class="sgchips">${list.map(n=>`<span class="sgchip">${esc(n)}${ro?"":`<button type="button" data-sgrm="${kind}" data-name="${esc(n)}" aria-label="外す">×</button>`}</span>`).join("")}</div>`:`<span class="by">まだ選ばれていません</span>`};
  const picker=(kind,ph)=>ro?"":`<input class="input" id="f-sgq-${kind}" placeholder="${ph}" autocomplete="off"><div class="sghits" id="sghits-${kind}" hidden></div>`;
  box.innerHTML=`<select class="input" id="f-sgtype" ${ro?"disabled":""}><option value="">反映しない</option>${types.map(([k,v])=>`<option value="${k}" ${sg.type===k?"selected":""}>${selfOnly&&k.startsWith("staff")?v.replace("職員の","自分の"):v}</option>`).join("")}</select>
  ${sg.type==="staff_off"?`<div class="sgsub"><div class="labels">${[["","終日・時間指定"],["am","AM休"],["pm","PM休"]].map(([k,l])=>`<label style="--c:var(--l-leave)"><input type="radio" name="f-sghalf" value="${k}" ${String(sg.half||"")===k?"checked":""} ${ro?"disabled":""}><span>${l}</span></label>`).join("")}</div></div>`:""}
  ${staffT?`<div class="sgsub"><span class="by">対象の職員</span>${selfOnly?`<div class="sgchips"><span class="sgchip" style="padding-right:10px">${esc(me.name)}（自分）</span></div>`:chips("staff")+picker("staff","職員の名前で検索")}<span class="by">${sg.type==="staff_off"?(sg.half?"AM休はその人の勤務時間の半分から出勤、PM休は半分で退勤として送迎表に入ります。":"終日なら送迎表で休みに、時間指定ならその時間の不在として入ります。"):"その時間の予定として担当職員の欄に入り、送迎と重なると警告が出ます。"}</span></div>`:""}
  ${userT?`<div class="sgsub"><span class="by">対象の利用者</span>${chips("users")}${picker("users","利用者の名前で検索")}</div>`:""}
  ${sg.type==="user_time"?`<div class="sgsub"><div class="row"><div class="field"><label for="f-sgmeet">迎えの時刻</label><input class="input" type="time" id="f-sgmeet" value="${esc(sg.meet||"")}" step="300" ${ro?"readonly":""}></div><div class="field"><label for="f-sgsend">送りの時刻</label><input class="input" type="time" id="f-sgsend" value="${esc(sg.send||"")}" step="300" ${ro?"readonly":""}></div></div>
    <div class="row"><div class="field"><label for="f-sgnomeet">迎えなし（理由）</label><input class="input" id="f-sgnomeet" maxlength="40" value="${esc(sg.noMeet||"")}" placeholder="例：受診後来所" ${ro?"readonly":""}></div><div class="field"><label for="f-sgnosend">送りなし（理由）</label><input class="input" id="f-sgnosend" maxlength="40" value="${esc(sg.noSend||"")}" placeholder="例：家族迎え" ${ro?"readonly":""}></div></div>
    <span class="by">変える項目だけ入力してください。空欄の項目はいつもどおりです。</span></div>`:""}
  ${sg.type&&!SGN.loaded?`<span class="by">名前の一覧を読み込んでいます…</span>`:""}`;
}
function sgHits(kind,q){
  const h=$("sghits-"+kind);if(!h||!ed)return;const sel=new Set((ed.d.sg&&ed.d.sg[kind])||[]);
  const src=kind==="staff"?SGN.staff:SGN.users;const qq=String(q||"").trim();
  const list=src.filter(x=>!sel.has(x.name)&&(!qq||x.name.includes(qq)||x.dept.includes(qq))).slice(0,40);
  h.innerHTML=list.length?list.map(x=>`<button type="button" data-sgpick="${kind}" data-name="${esc(x.name)}"><span>${esc(x.name)}</span><small>${esc(x.dept)}</small></button>`).join(""):`<div class="by" style="padding:6px 10px">${SGN.loaded?"見つかりません":"読み込み中…"}</div>`;h.hidden=false;
}
function readSg(){
  if(!ed||!$("f-sgtype"))return;const t=$("f-sgtype").value;
  if(!t){ed.d.sg=null;return}
  const sg=Object.assign({type:t,staff:[],users:[],meet:"",send:"",noMeet:"",noSend:"",half:""},ed.d.sg||{},{type:t});
  if($("f-sgmeet")){sg.meet=$("f-sgmeet").value;sg.send=$("f-sgsend").value;sg.noMeet=$("f-sgnomeet").value.trim();sg.noSend=$("f-sgnosend").value.trim()}
  const hf=document.querySelector('input[name="f-sghalf"]:checked');sg.half=t==="staff_off"&&hf?hf.value:"";
  ed.d.sg=sg;
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

/* ---------- 予定の編集 ---------- */''')
js = rep(js, '''    <div class="field"><label for="f-memo">メモ</label>''', '''    <div class="field sgbox"><span class="lbl">送迎表に反映</span><div id="sgArea"></div></div>
    <div class="field"><label for="f-memo">メモ</label>''')
js = rep(js, '  drawMembers();drawComments();\n  if(ed.base&&ed.base.updatedBy)', '  drawMembers();drawComments();drawSg();\n  if(ed.base&&ed.base.updatedBy)')
js = rep(js, 'members:S.me?[S.me]:[]};', 'members:S.me?[S.me]:[],sg:null};')
js = rep(js, 'd.place=$("f-place").value.trim();d.memo=$("f-memo").value;\n}', 'd.place=$("f-place").value.trim();d.memo=$("f-memo").value;readSg();\n}')
js = rep(js, '''  if(!d.title)return showErr("タイトルを入力してください。");''', '''  if(d.sg){
    const who=d.sg.type.startsWith("staff")?d.sg.staff:d.sg.users;
    if(!who.length)return showErr("送迎表に反映する"+(d.sg.type.startsWith("staff")?"職員":"利用者")+"を選んでください。");
    if(d.sg.type==="user_time"&&!d.sg.meet&&!d.sg.send&&!d.sg.noMeet&&!d.sg.noSend)return showErr("変更する迎え・送りの時刻、または送迎なしの理由を入力してください。");
    if(d.sg.half){d.allDay=true;d.endDate=d.date}
    if(!d.title)d.title=who.slice(0,3).join("・")+(who.length>3?"他":"")+" "+(d.sg.half?HALF[d.sg.half]:{staff_off:"休み",staff_plan:"予定",user_absent:"欠席",user_time:d.sg.noMeet||d.sg.noSend||"時間変更"}[d.sg.type]);
  }
  if(!d.title)return showErr("タイトルを入力してください。");''')
js = rep(js, 'const ev={title:d.title,date:d.date,endDate:d.endDate,allDay:d.allDay,start:d.allDay?"":d.start,end:d.allDay?"":d.end,label:lab(d.label),place:d.place,memo:d.memo,members:d.members};',
         'const ev={title:d.title,date:d.date,endDate:d.endDate,allDay:d.allDay,start:d.allDay?"":d.start,end:d.allDay?"":d.end,label:lab(d.label),place:d.place,memo:d.memo,members:d.members,sg:d.sg||null};')
js = rep(js, 'core.save({title:p.title,date:p.date,endDate:p.endDate,allDay:p.allDay,start:p.start,end:p.end,label:p.label,place:p.place,memo:p.memo,members:p.members},ed.base)',
         'core.save({title:p.title,date:p.date,endDate:p.endDate,allDay:p.allDay,start:p.start,end:p.end,label:p.label,place:p.place,memo:p.memo,members:p.members,sg:p.sg||null},ed.base)')
js = rep(js, '${e.pending?`<span class="tag-pend">未送信</span>`:""}</div>${av?', '${e.pending?`<span class="tag-pend">未送信</span>`:""}${e.sg?`<span class="tag-sg">${esc(sgText(e.sg))}</span>`:""}</div>${av?')
# 日のパネルに定型ボタン
js = rep(js, '''  $("panel").innerHTML=`<div class="panel-head">''', '''  const q=quickHtml();
  $("panel").innerHTML=q+`<div class="panel-head">''')
# クリック操作
js = rep(js, '''  const rs=t.closest("[data-restore]");''', '''  const qk=t.closest("[data-quick]");if(qk&&!t.closest("#sheetRoot")){const k=$("qKind")?$("qKind").value:"";S.qKind=k;quickOff(k);return}
  const rs=t.closest("[data-restore]");''')
js = rep(js, '''  const rm=t.closest("[data-rm]");''', '''  const sgp=t.closest("[data-sgpick]");if(sgp){readSg();const k=sgp.dataset.sgpick;const sg=ed.d.sg;if(sg&&!sg[k].includes(sgp.dataset.name))sg[k].push(sgp.dataset.name);drawSg();setTimeout(()=>{const i=$("f-sgq-"+k);if(i){i.focus();sgHits(k,"")}},0);draftSave();return}
  const sgr=t.closest("[data-sgrm]");if(sgr){readSg();const k=sgr.dataset.sgrm;if(ed.d.sg)ed.d.sg[k]=ed.d.sg[k].filter(n=>n!==sgr.dataset.name);drawSg();draftSave();return}
  if(!t.closest(".sgsub")){for(const k of["staff","users"]){const h=$("sghits-"+k);if(h)h.hidden=true}}
  const rm=t.closest("[data-rm]");''')
js = rep(js, '''document.addEventListener("change",e=>{if(!ed)return;''', '''document.addEventListener("change",e=>{
  if(e.target.id==="qStaff"){S.qStaff=e.target.value;return}
  if(e.target.id==="qKind"){S.qKind=e.target.value;return}
  if(!ed)return;
  if(e.target.name==="f-sghalf"){readSg();drawSg();draftSave();return}
  if(e.target.id==="f-sgtype"){readSg();const t=e.target.value;const want=t==="staff_off"?"leave":t.startsWith("user")?"user":null;if(want){const r=$("f-label-"+want);if(r)r.checked=true}if(t&&!SGN.loaded)loadNames().then(()=>{if(ed)drawSg()});drawSg();draftSave();return}''')
js = rep(js, '''document.addEventListener("input",e=>{if(e.target.id==="f-member")search(e.target.value);''', '''document.addEventListener("input",e=>{if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){sgHits(e.target.id.slice(6),e.target.value);return}if(e.target.id==="f-member")search(e.target.value);''')
js = rep(js, '''document.addEventListener("focusin",e=>{if(e.target.id==="f-member")search(e.target.value)});''', '''document.addEventListener("focusin",e=>{if(e.target.id==="f-member")search(e.target.value);if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){if(!SGN.loaded)loadNames().then(()=>sgHits(e.target.id.slice(6),e.target.value));sgHits(e.target.id.slice(6),e.target.value)}});''')
js = rep(js, '''document.addEventListener("keydown",e=>{''', '''document.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users")){e.preventDefault();const b=$("sghits-"+e.target.id.slice(6))?.querySelector("[data-sgpick]");if(b)b.click();return}''')
# 起動：ログインを待ち、操作はサーバーに送る
js = rep(js, '''(async()=>{
  if(!window.claude||!window.claude.use){S.dbState="none";render();return}''', '''(async()=>{
  await window.SGHost.ready;
  if(/^\\d{4}-\\d{2}-\\d{2}$/.test(window.__SG_DATE||"")){S.sel=window.__SG_DATE;const d=parse(S.sel);S.cursor=new Date(d.getFullYear(),d.getMonth(),1)}''')
js = rep(js, '  core=C.createCore({db,store,me:S.me});', '  core=C.createCore({db,store,me:S.me,runOp:window.SGHost.runOp});\n  loadNames().then(()=>render());\n  window.SGHost.startPolling(60000);\n  window.SGHost.onLogin(()=>core.kick());')
open("gas/calendar_app.js", "w").write(js)
open("gas/calendar_css.txt", "w").write(css)
open("gas/calendar_body.txt", "w").write(body)
print("ok", len(js))
