"""チームカレンダーを送迎表と同じページ(シャドウDOM内)で動くように変換し、送迎表への反映欄を追加する"""
import re, json, sys
css = open("cal_css.txt").read()
body = open("cal_body.txt").read()
js = open("cal_js.txt").read()

def rep(s, a, b, n=1):
    c = s.count(a)
    if c != n: sys.exit(f"想定{n} 実際{c}: {a[:70]}")
    return s.replace(a, b)

# ---------- CSS：シャドウDOM用（送迎表に合わせて明るい配色で統一） ----------
css = re.sub(r"@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme=\"light\"\]\)\{.*?color-scheme:dark\}\}", "", css, flags=re.S)
css = re.sub(r":root\[data-theme=\"dark\"\]\{.*?color-scheme:dark\}", "", css, flags=re.S)
css = css.replace(":root{", ":host{color-scheme:light;")
css = css.replace("--l-event:#8352c9;", "--l-event:#8352c9; --l-user:#c2410c;")
css = rep(css, "body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:14px;line-height:1.55}",
          ".calwrap{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:14px;line-height:1.55;min-height:100%}")
css = re.sub(r"body::before\{[^}]*\}", "", css)
css = css.replace(".bar{position:sticky;top:env(safe-area-inset-top,0px);", ".bar{position:sticky;top:0;")
css += """
[hidden]{display:none!important}
.back{height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px;font-weight:700}
.sgbox{border:1px solid color-mix(in srgb,var(--l-user) 35%,var(--line));border-radius:10px;padding:12px;background:color-mix(in srgb,var(--l-user) 5%,var(--surface))}
.sgbox .lbl{color:var(--l-user)!important;font-weight:700}
.sgsub{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.sgchips{display:flex;flex-wrap:wrap;gap:6px}
.sgchip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-size:12px}
.sgchip button{border:0;background:none;width:22px;height:22px;border-radius:50%;color:var(--muted)}
.sghits{border:1px solid var(--line);border-radius:8px;max-height:200px;overflow:auto;background:var(--surface)}
.sghits button{display:flex;justify-content:space-between;gap:8px;width:100%;border:0;background:none;padding:6px 10px;text-align:left;font-size:13px}
.sghits button:hover,.sghits button:focus-visible{background:var(--sunken)}
.sghits small{color:var(--muted)}
.tag-sg{font-size:11px;font-weight:700;color:var(--l-user)}
"""

# ---------- 画面の骨組み：送迎表へ戻るボタン ----------
body = rep(body, '<div class="brand"><i></i>チームカレンダー <span class="ver" id="ver"></span></div>',
           '<button class="back" id="backBtn">← 送迎表</button><div class="brand"><i></i>カレンダー <span class="ver" id="ver"></span></div>')

# ---------- スクリプト ----------
js = rep(js, 'const $=id=>document.getElementById(id);', 'const $=id=>R.getElementById(id);')
js = js.replace("document.querySelector(", "R.querySelector(")
for ev in ["click", "keydown", "change", "input", "focusin", "submit"]:
    js = js.replace(f'document.addEventListener("{ev}"', f'R.addEventListener("{ev}"')
js = rep(js, '{k:"event",n:"社内イベント"},', '{k:"event",n:"社内イベント"},{k:"user",n:"利用者"},')
js = rep(js, 'const APP_VERSION="2026.10.26b";', 'const APP_VERSION="2026.10.26c";')

# 送迎表の名前一覧（職員・利用者）。3つの版のマスタから集める
js = rep(js, '/* ---------- 予定の編集 ---------- */', r'''/* ---------- 送迎表との連携 ---------- */
const SGT={staff_off:"職員の休み・不在",staff_plan:"職員の予定（会議・外出・研修など）",user_absent:"利用者の欠席",user_time:"利用者の時間変更（受診後来所など）"};
const SGT_SHORT={staff_off:"職員の休み",staff_plan:"職員の予定",user_absent:"欠席",user_time:"時間変更"};
let SGN={staff:[],users:[],loaded:false};
async function loadNames(){
  const kv=window.__sgkv;if(!kv)return;
  const staff=new Map(),users=new Map();
  for(const k of["master","v2:master","v3:master"]){
    let m=null;try{m=await kv.get(k)}catch{}
    if(!m||!m.staff)continue;
    const dn=id=>(m.departments||[]).find(d=>d.id===id)?.name||"";
    for(const s of m.staff){if(!s||!s.name||s.retireDate&&s.retireDate<=TODAY)continue;if(!staff.has(s.name))staff.set(s.name,dn(s.deptId))}
    for(const u of m.users||[]){if(!u||!u.name)continue;if(!users.has(u.name))users.set(u.name,dn(u.deptId))}
  }
  SGN={staff:[...staff].map(([name,dept])=>({name,dept})),users:[...users].map(([name,dept])=>({name,dept})),loaded:true};
}
function sgText(sg){if(!sg)return"";const who=[...(sg.staff||[]),...(sg.users||[])];return`送迎表：${SGT_SHORT[sg.type]||""}（${who.slice(0,4).join("・")}${who.length>4?` 他${who.length-4}名`:""}）`}
function drawSg(){
  if(!ed)return;const box=$("sgArea");if(!box)return;
  const sg=ed.d.sg||{type:""};const ro=ed.ro;
  const staffT=sg.type==="staff_off"||sg.type==="staff_plan",userT=sg.type==="user_absent"||sg.type==="user_time";
  const chips=(kind)=>{const list=(sg[kind]||[]);return list.length?`<div class="sgchips">${list.map(n=>`<span class="sgchip">${esc(n)}${ro?"":`<button type="button" data-sgrm="${kind}" data-name="${esc(n)}" aria-label="外す">×</button>`}</span>`).join("")}</div>`:`<span class="by">まだ選ばれていません</span>`};
  const picker=(kind,ph)=>ro?"":`<input class="input" id="f-sgq-${kind}" placeholder="${ph}" autocomplete="off"><div class="sghits" id="sghits-${kind}" hidden></div>`;
  box.innerHTML=`<select class="input" id="f-sgtype" ${ro?"disabled":""}><option value="">反映しない</option>${Object.entries(SGT).map(([k,v])=>`<option value="${k}" ${sg.type===k?"selected":""}>${v}</option>`).join("")}</select>
  ${staffT?`<div class="sgsub"><span class="by">対象の職員</span>${chips("staff")}${picker("staff","職員の名前で検索")}<span class="by">${sg.type==="staff_off"?"終日なら送迎表で休みに、時間指定ならその時間の不在として入ります。":"その時間の予定として担当職員の欄に入り、送迎と重なると警告が出ます。"}</span></div>`:""}
  ${userT?`<div class="sgsub"><span class="by">対象の利用者</span>${chips("users")}${picker("users","利用者の名前で検索")}</div>`:""}
  ${sg.type==="user_time"?`<div class="sgsub"><div class="row"><div class="field"><label for="f-sgmeet">迎えの時刻</label><input class="input" type="time" id="f-sgmeet" value="${esc(sg.meet||"")}" step="300" ${ro?"readonly":""}></div><div class="field"><label for="f-sgsend">送りの時刻</label><input class="input" type="time" id="f-sgsend" value="${esc(sg.send||"")}" step="300" ${ro?"readonly":""}></div></div>
    <div class="row"><div class="field"><label for="f-sgnomeet">迎えなし（理由）</label><input class="input" id="f-sgnomeet" maxlength="40" value="${esc(sg.noMeet||"")}" placeholder="例：受診後来所" ${ro?"readonly":""}></div><div class="field"><label for="f-sgnosend">送りなし（理由）</label><input class="input" id="f-sgnosend" maxlength="40" value="${esc(sg.noSend||"")}" placeholder="例：家族迎え" ${ro?"readonly":""}></div></div>
    <span class="by">変える項目だけ入力してください。空欄の項目はいつもどおりです。</span></div>`:""}
  ${sg.type&&!SGN.loaded?`<span class="by">送迎表の名前一覧を読み込んでいます…</span>`:""}`;
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
  const sg=Object.assign({type:t,staff:[],users:[],meet:"",send:"",noMeet:"",noSend:""},ed.d.sg||{},{type:t});
  if($("f-sgmeet")){sg.meet=$("f-sgmeet").value;sg.send=$("f-sgsend").value;sg.noMeet=$("f-sgnomeet").value.trim();sg.noSend=$("f-sgnosend").value.trim()}
  ed.d.sg=sg;
}

/* ---------- 予定の編集 ---------- */''')

# 編集画面に送迎表欄を追加
js = rep(js, '''    <div class="field"><label for="f-memo">メモ</label>''', '''    <div class="field sgbox"><span class="lbl">送迎表に反映</span><div id="sgArea"></div></div>
    <div class="field"><label for="f-memo">メモ</label>''')
js = rep(js, '  drawMembers();drawComments();\n  if(ed.base&&ed.base.updatedBy)', '  drawMembers();drawComments();drawSg();\n  if(ed.base&&ed.base.updatedBy)')
js = rep(js, 'members:S.me?[S.me]:[]};', 'members:S.me?[S.me]:[],sg:null};')
js = rep(js, 'd.place=$("f-place").value.trim();d.memo=$("f-memo").value;\n}', 'd.place=$("f-place").value.trim();d.memo=$("f-memo").value;readSg();\n}')
# 保存時の確認と自動タイトル
js = rep(js, '''  if(!d.title)return showErr("タイトルを入力してください。");''', '''  if(d.sg){
    const who=d.sg.type.startsWith("staff")?d.sg.staff:d.sg.users;
    if(!who.length)return showErr("送迎表に反映する"+(d.sg.type.startsWith("staff")?"職員":"利用者")+"を選んでください。");
    if(d.sg.type==="user_time"&&!d.sg.meet&&!d.sg.send&&!d.sg.noMeet&&!d.sg.noSend)return showErr("変更する迎え・送りの時刻、または送迎なしの理由を入力してください。");
    if(!d.title)d.title=who.slice(0,3).join("・")+(who.length>3?"他":"")+" "+({staff_off:"休み",staff_plan:"予定",user_absent:"欠席",user_time:d.sg.noMeet||d.sg.noSend||"時間変更"}[d.sg.type]);
  }
  if(!d.title)return showErr("タイトルを入力してください。");''')
js = rep(js, 'const ev={title:d.title,date:d.date,endDate:d.endDate,allDay:d.allDay,start:d.allDay?"":d.start,end:d.allDay?"":d.end,label:lab(d.label),place:d.place,memo:d.memo,members:d.members};',
         'const ev={title:d.title,date:d.date,endDate:d.endDate,allDay:d.allDay,start:d.allDay?"":d.start,end:d.allDay?"":d.end,label:lab(d.label),place:d.place,memo:d.memo,members:d.members,sg:d.sg||null};')
js = rep(js, 'core.save({title:p.title,date:p.date,endDate:p.endDate,allDay:p.allDay,start:p.start,end:p.end,label:p.label,place:p.place,memo:p.memo,members:p.members},ed.base)',
         'core.save({title:p.title,date:p.date,endDate:p.endDate,allDay:p.allDay,start:p.start,end:p.end,label:p.label,place:p.place,memo:p.memo,members:p.members,sg:p.sg||null},ed.base)')
# 一覧に送迎表への反映を表示
js = rep(js, '${e.pending?`<span class="tag-pend">未送信</span>`:""}</div>${av?', '${e.pending?`<span class="tag-pend">未送信</span>`:""}${e.sg?`<span class="tag-sg">${esc(sgText(e.sg))}</span>`:""}</div>${av?')
# 送迎表欄の操作
js = rep(js, '''  const rm=t.closest("[data-rm]");''', '''  const sgp=t.closest("[data-sgpick]");if(sgp){readSg();const k=sgp.dataset.sgpick;const sg=ed.d.sg;if(sg&&!sg[k].includes(sgp.dataset.name))sg[k].push(sgp.dataset.name);drawSg();setTimeout(()=>{const i=$("f-sgq-"+k);if(i){i.focus();sgHits(k,"")}},0);draftSave();return}
  const sgr=t.closest("[data-sgrm]");if(sgr){readSg();const k=sgr.dataset.sgrm;if(ed.d.sg)ed.d.sg[k]=ed.d.sg[k].filter(n=>n!==sgr.dataset.name);drawSg();draftSave();return}
  if(!t.closest(".sgsub")){for(const k of["staff","users"]){const h=$("sghits-"+k);if(h)h.hidden=true}}
  const rm=t.closest("[data-rm]");''')
js = rep(js, '''R.addEventListener("change",e=>{if(!ed)return;''', '''R.addEventListener("change",e=>{if(!ed)return;
  if(e.target.id==="f-sgtype"){readSg();const t=e.target.value;const want=t==="staff_off"?"leave":t.startsWith("user")?"user":null;if(want){const r=$("f-label-"+want);if(r)r.checked=true}if(t&&!SGN.loaded)loadNames().then(()=>{if(ed)drawSg()});drawSg();draftSave();return}''')
js = rep(js, '''R.addEventListener("input",e=>{if(e.target.id==="f-member")search(e.target.value);''', '''R.addEventListener("input",e=>{if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){sgHits(e.target.id.slice(6),e.target.value);return}if(e.target.id==="f-member")search(e.target.value);''')
js = rep(js, '''R.addEventListener("focusin",e=>{if(e.target.id==="f-member")search(e.target.value)});''', '''R.addEventListener("focusin",e=>{if(e.target.id==="f-member")search(e.target.value);if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){if(!SGN.loaded)loadNames().then(()=>sgHits(e.target.id.slice(6),e.target.value));sgHits(e.target.id.slice(6),e.target.value)}});''')
js = rep(js, '''R.addEventListener("keydown",e=>{''', '''R.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users")){e.preventDefault();const b=$("sghits-"+e.target.id.slice(6))?.querySelector("[data-sgpick]");if(b)b.click();return}''')
# 起動：送迎表と同じページで動く。開く・戻る
js = rep(js, '''$("ver").textContent="v"+APP_VERSION;''', '''$("ver").textContent="v"+APP_VERSION;
$("backBtn").onclick=()=>{if(ed)closeEditor(true);$("sheetRoot").innerHTML="";host.hidden=true;document.documentElement.style.overflow=""};
window.__sgOpenCalendar=(date)=>{host.hidden=false;document.documentElement.style.overflow="hidden";host.scrollTop=0;
  if(date&&/^\\d{4}-\\d{2}-\\d{2}$/.test(date)){S.sel=date;const d=parse(date);const c=new Date(d.getFullYear(),d.getMonth(),1);if(+c!==+S.cursor){S.cursor=c;subscribe()}}
  loadNames().then(()=>{if(ed)drawSg()});render()};''')

out = "(function(){\n\"use strict\";\nconst host=document.getElementById(\"cal-host\");\nconst R=host.attachShadow({mode:\"open\"});\nR.innerHTML=" + json.dumps("<style>" + css + "</style><div class=\"calwrap\">" + body + "</div>") + ";\n" + js.replace('"use strict";', "", 1) + "\n})();\n"
open("calendar.js", "w").write(out)
print("calendar.js", len(out))
