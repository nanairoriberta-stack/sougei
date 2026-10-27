(function(){
"use strict";
const host=document.getElementById("cal-host");
const R=host.attachShadow({mode:"open"});
R.innerHTML="<style>\n/* Layout: sticky toolbar with sync status, month grid beside a day panel (stacks on phones); editor and sync details open as sheets. */\n:host{color-scheme:light;\n  --bg:#f3f5f4; --surface:#ffffff; --sunken:#eaeeec; --ink:#18201d; --muted:#5f6b66; --line:#dde3e0;\n  --accent:#13795b; --accent-ink:#ffffff; --accent-soft:#dff1ea;\n  --sun:#c93838; --sat:#2a62c4; --danger:#c23a32; --warn:#9a6a00; --warn-soft:#fbf1d6; --ok:#13795b;\n  --l-meeting:#3f63cf; --l-visit:#11897a; --l-deadline:#d0443a; --l-leave:#b8901a; --l-event:#8352c9; --l-user:#c2410c; --l-other:#6f7c86;\n  --font:\"Zen Kaku Gothic New\",\"Hiragino Kaku Gothic ProN\",\"Yu Gothic\",system-ui,sans-serif;\n  --mono:\"DM Mono\",ui-monospace,\"SFMono-Regular\",Menlo,monospace;\n  --radius:10px;\n}\n\n\n*{box-sizing:border-box}\n.calwrap{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:14px;line-height:1.55;min-height:100%}\nbutton,input,select,textarea{font:inherit;color:inherit}\nbutton{cursor:pointer}\nbutton:disabled{cursor:not-allowed;opacity:.45}\n:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n\n.gutter{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}\n\n.bar{position:sticky;top:0;z-index:5;background:var(--surface);border-bottom:1px solid var(--line)}\n.bar-in{max-width:1240px;margin:0 auto;padding-block:10px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}\n.brand{font-weight:700;font-size:15px;letter-spacing:.02em;display:flex;align-items:center;gap:8px;margin-right:auto}\n.brand i{width:10px;height:10px;border-radius:3px;background:var(--accent);display:inline-block}\n.ver{font-family:var(--mono);font-size:10px;font-weight:400;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 5px}\n.sync{height:30px;border-radius:999px;border:1px solid var(--line);background:var(--surface);padding:0 12px 0 10px;display:inline-flex;align-items:center;gap:7px;font-size:12px}\n.sync i{width:8px;height:8px;border-radius:50%;background:var(--ok)}\n.sync[data-s=\"busy\"] i{background:var(--warn);animation:pulse 1.2s infinite}\n.sync[data-s=\"warn\"]{border-color:var(--warn);background:var(--warn-soft)} .sync[data-s=\"warn\"] i{background:var(--warn)}\n.sync[data-s=\"bad\"]{border-color:var(--danger);color:var(--danger)} .sync[data-s=\"bad\"] i{background:var(--danger)}\n@keyframes pulse{50%{opacity:.3}}\n@media (prefers-reduced-motion:reduce){.sync i{animation:none!important}}\n.nav{display:flex;align-items:center;gap:6px}\n.month-label{font-size:20px;font-weight:700;min-width:8.5em;text-align:center;font-variant-numeric:tabular-nums}\n.month-label span{font-family:var(--mono);font-weight:500}\n.icon-btn{width:34px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;font-size:16px}\n.icon-btn:hover,.ghost:hover{background:var(--sunken)}\n.ghost{height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px}\n.ghost.sm,.primary.sm,.danger.sm{height:28px;padding:0 10px;font-size:12px}\n.seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}\n.seg button{border:0;background:var(--surface);height:32px;padding:0 12px;font-size:13px}\n.seg button[aria-pressed=\"true\"]{background:var(--ink);color:var(--surface)}\n.primary{height:34px;padding:0 14px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:13px}\n\n.filters{max-width:1240px;margin:0 auto;padding-block:12px 0;display:flex;flex-wrap:wrap;gap:6px}\n.chip{height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font-size:12px;display:inline-flex;align-items:center;gap:6px}\n.chip[aria-pressed=\"true\"]{border-color:var(--ink);background:var(--ink);color:var(--surface)}\n.dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}\n\n.notices{max-width:1240px;margin:0 auto;display:flex;flex-direction:column;gap:8px;padding-block:12px 0}\n.notices:empty{display:none}\n.note{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 12px;border-radius:8px;background:var(--sunken);color:var(--ink);font-size:13px}\n.note.warn{background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 45%,transparent)}\n.note.bad{border:1px solid var(--danger)}\n.note p{margin:0;flex:1 1 260px;min-width:0}\n\n.app{max-width:1240px;margin:0 auto;padding-block:12px 32px;display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start}\n@media (max-width:900px){.app{grid-template-columns:minmax(0,1fr)}}\n.cal{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;min-width:0}\n.dow,.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}\n.dow div{padding:8px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line);letter-spacing:.06em}\n.dow .su{color:var(--sun)} .dow .sa{color:var(--sat)}\n.cell{min-height:104px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:6px 6px 8px;display:flex;flex-direction:column;gap:3px;background:var(--surface);min-width:0;cursor:pointer}\n.cell:nth-child(7n){border-right:0}\n.cell.out{background:var(--sunken)} .cell.out .num{opacity:.5}\n.cell.sel{box-shadow:inset 0 0 0 2px var(--accent)}\n.cell-head{display:flex;align-items:baseline;gap:6px;min-width:0}\n.num{font-family:var(--mono);font-size:13px;font-weight:500;width:24px;height:24px;display:grid;place-items:center;border-radius:50%;flex:none}\n.cell.today .num{background:var(--accent);color:var(--accent-ink)}\n.cell.su .num,.cell.hol .num{color:var(--sun)} .cell.sa .num{color:var(--sat)}\n.cell.today.su .num,.cell.today.sa .num,.cell.today.hol .num{color:var(--accent-ink)}\n.hol-name{font-size:10px;color:var(--sun);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}\n.ev-chip{display:flex;align-items:center;gap:4px;font-size:11px;line-height:1.35;padding:2px 5px;border-radius:4px;background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--ink);white-space:nowrap;overflow:hidden;min-width:0;border:0;text-align:left;width:100%}\n.ev-chip.span{background:var(--c);color:var(--surface)}\n.ev-chip.pend{outline:1px dashed var(--warn);outline-offset:-1px}\n.ev-chip b{font-family:var(--mono);font-weight:500;font-size:10px;opacity:.8}\n.ev-chip span{overflow:hidden;text-overflow:ellipsis;min-width:0}\n.more{font-size:11px;color:var(--muted);padding-left:4px}\n@media (max-width:560px){\n  .cell{min-height:64px;padding:4px 3px}\n  .hol-name{display:none}\n  .ev-chip{height:5px;padding:0;font-size:0;background:var(--c)}\n  .ev-chip b,.ev-chip span{display:none}\n  .more{font-size:10px;padding-left:0}\n  .month-label{font-size:17px;min-width:auto}\n}\n.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}\n@media (min-width:901px){.panel{position:sticky;top:calc(env(safe-area-inset-top,0px) + 70px)}}\n.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}\n.panel-date{font-size:22px;font-weight:700;line-height:1.2}\n.panel-date small{display:block;font-size:12px;font-weight:500;color:var(--muted);margin-top:4px}\n.ev-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;min-width:0}\n.ev-row{display:grid;grid-template-columns:4px minmax(0,1fr);gap:10px;padding:10px 12px 10px 10px;border-radius:8px;background:var(--sunken);border:0;text-align:left;width:100%}\n.ev-row:hover{background:color-mix(in srgb,var(--c) 12%,var(--sunken))}\n.ev-row .stripe{border-radius:2px;background:var(--c)}\n.ev-row .t{font-weight:700;font-size:14px;overflow-wrap:anywhere}\n.meta{font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:2px}\n.time{font-family:var(--mono);font-variant-numeric:tabular-nums}\n.tag-pend{font-size:11px;color:var(--warn);font-weight:700}\n.avatars{display:flex;margin-top:6px}\n.avatars img{width:20px;height:20px;border-radius:50%;border:2px solid var(--sunken);margin-right:-6px}\n.empty{color:var(--muted);font-size:13px;padding:14px;border:1px dashed var(--line);border-radius:8px;text-align:center}\n.agenda{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:8px 16px 16px;min-width:0}\n.agenda h2{font-size:15px;margin:10px 0 4px}\n.agenda .sub{font-size:12px;color:var(--muted);margin:0 0 8px}\n.ag-day{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}\n.ag-day:last-child{border-bottom:0}\n.ag-date{font-family:var(--mono);font-size:20px;font-weight:500;line-height:1.1}\n.ag-date small{display:block;font-family:var(--font);font-size:11px;color:var(--muted);margin-top:4px}\n.ag-date.su,.ag-date.hol{color:var(--sun)} .ag-date.sa{color:var(--sat)}\n.trash-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 12px;border-radius:8px;background:var(--sunken)}\n.trash-row .grow{flex:1 1 220px;min-width:0}\n.render-err{padding:16px;border:1px solid var(--danger);border-radius:8px;color:var(--danger);background:var(--surface)}\n\n.overlay{position:fixed;inset:0;background:color-mix(in srgb,#000 45%,transparent);z-index:20;display:flex;align-items:center;justify-content:center;padding:16px;padding-top:max(16px,env(safe-area-inset-top,0px));padding-bottom:max(16px,env(safe-area-inset-bottom,0px))}\n.sheet{background:var(--surface);color:var(--ink);border-radius:14px;width:min(580px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column}\n.sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--surface);z-index:1}\n.sheet-head h2{margin:0;font-size:16px}\n.sheet-body{padding:16px 18px;display:flex;flex-direction:column;gap:14px}\n.field{display:flex;flex-direction:column;gap:6px;min-width:0}\n.field>label,.field>.lbl{font-size:12px;color:var(--muted);letter-spacing:.04em}\n.input{height:38px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:0 10px;width:100%;min-width:0}\ntextarea.input{height:auto;min-height:72px;padding:8px 10px;resize:vertical}\n.title-input{font-size:18px;font-weight:700;height:44px}\n.row{display:flex;gap:10px;flex-wrap:wrap}\n.row>.field{flex:1 1 130px}\n.check{display:inline-flex;align-items:center;gap:8px;font-size:13px}\n.labels{display:flex;flex-wrap:wrap;gap:6px}\n.labels label{position:relative}\n.labels input{position:absolute;opacity:0;inset:0}\n.labels span{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:999px;border:1px solid var(--line);font-size:12px;cursor:pointer}\n.labels input:checked+span{border-color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent);font-weight:700}\n.labels input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}\n.members{display:flex;flex-wrap:wrap;gap:6px}\n.member{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 4px;border-radius:999px;background:var(--sunken);font-size:12px}\n.member img{width:20px;height:20px;border-radius:50%}\n.member button{border:0;background:none;width:20px;height:20px;border-radius:50%;color:var(--muted)}\n.picker{position:relative}\n.hits{position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px color-mix(in srgb,#000 18%,transparent);z-index:2;max-height:240px;overflow:auto;padding:4px}\n.hits button{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:6px 8px;border-radius:6px;text-align:left}\n.hits button:hover,.hits button:focus-visible{background:var(--sunken)}\n.hits img{width:22px;height:22px;border-radius:50%}\n.err{color:var(--danger);font-size:12px;margin:0}\n.sheet-foot{display:flex;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid var(--line);position:sticky;bottom:0;background:var(--surface);flex-wrap:wrap}\n.spacer{flex:1}\n.danger{height:34px;padding:0 12px;border-radius:8px;border:1px solid color-mix(in srgb,var(--danger) 40%,var(--line));background:var(--surface);color:var(--danger);font-size:13px}\n.danger.solid{background:var(--danger);color:var(--surface);border-color:var(--danger)}\n.by{font-size:11px;color:var(--muted)}\n.comments{border-top:1px solid var(--line);padding:14px 18px 18px;display:flex;flex-direction:column;gap:10px}\n.comments h3{margin:0;font-size:13px}\n.cmt{display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px}\n.cmt img{width:24px;height:24px;border-radius:50%}\n.cmt .who{font-size:12px;font-weight:700}\n.cmt .who small{font-weight:400;color:var(--muted);font-family:var(--mono);margin-left:6px}\n.cmt p{margin:2px 0 0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}\n.cmt-form{display:flex;gap:8px}\n.cmt-form .input{flex:1}\n.op{border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px}\n.op h4{margin:0;font-size:13px}\n.cmp{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}\n.cmp div{background:var(--sunken);border-radius:8px;padding:8px 10px;font-size:12px;min-width:0;overflow-wrap:anywhere}\n.cmp b{display:block;font-size:11px;color:var(--muted);margin-bottom:2px}\n@media (max-width:480px){.cmp{grid-template-columns:minmax(0,1fr)}}\n.op .acts{display:flex;flex-wrap:wrap;gap:6px}\n.kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:13px}\n.kv dt{color:var(--muted)} .kv dd{margin:0;font-variant-numeric:tabular-nums}\n.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(20px + env(safe-area-inset-bottom,0px));background:var(--ink);color:var(--surface);padding:10px 16px;border-radius:8px;font-size:13px;z-index:30;max-width:calc(100% - 32px)}\n@media (prefers-reduced-motion:no-preference){.sheet{animation:up .18s ease-out}@keyframes up{from{transform:translateY(12px);opacity:.6}}}\n\n[hidden]{display:none!important}\n.back{height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px;font-weight:700}\n.sgbox{border:1px solid color-mix(in srgb,var(--l-user) 35%,var(--line));border-radius:10px;padding:12px;background:color-mix(in srgb,var(--l-user) 5%,var(--surface))}\n.sgbox .lbl{color:var(--l-user)!important;font-weight:700}\n.sgsub{display:flex;flex-direction:column;gap:8px;margin-top:8px}\n.sgchips{display:flex;flex-wrap:wrap;gap:6px}\n.sgchip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-size:12px}\n.sgchip button{border:0;background:none;width:22px;height:22px;border-radius:50%;color:var(--muted)}\n.sghits{border:1px solid var(--line);border-radius:8px;max-height:200px;overflow:auto;background:var(--surface)}\n.sghits button{display:flex;justify-content:space-between;gap:8px;width:100%;border:0;background:none;padding:6px 10px;text-align:left;font-size:13px}\n.sghits button:hover,.sghits button:focus-visible{background:var(--sunken)}\n.sghits small{color:var(--muted)}\n.tag-sg{font-size:11px;font-weight:700;color:var(--l-user)}\n</style><div class=\"calwrap\">\n\n<header class=\"bar\"><div class=\"bar-in gutter\">\n  <button class=\"back\" id=\"backBtn\">\u2190 \u9001\u8fce\u8868</button><div class=\"brand\"><i></i>\u30ab\u30ec\u30f3\u30c0\u30fc <span class=\"ver\" id=\"ver\"></span></div>\n  <button class=\"sync\" id=\"syncBtn\" data-s=\"busy\"><i></i><span id=\"syncText\">\u63a5\u7d9a\u4e2d\u2026</span></button>\n  <div class=\"nav\">\n    <button class=\"icon-btn\" id=\"prev\" aria-label=\"\u524d\u306e\u6708\">\u2039</button>\n    <div class=\"month-label\" id=\"monthLabel\"></div>\n    <button class=\"icon-btn\" id=\"next\" aria-label=\"\u6b21\u306e\u6708\">\u203a</button>\n    <button class=\"ghost\" id=\"todayBtn\">\u4eca\u65e5</button>\n  </div>\n  <div class=\"seg\" role=\"group\" aria-label=\"\u8868\u793a\u5207\u66ff\">\n    <button id=\"vMonth\" aria-pressed=\"true\">\u6708</button>\n    <button id=\"vList\" aria-pressed=\"false\">\u30ea\u30b9\u30c8</button>\n    <button id=\"vTrash\" aria-pressed=\"false\">\u30b4\u30df\u7bb1</button>\n  </div>\n  <button class=\"primary\" id=\"addBtn\">\uff0b \u4e88\u5b9a\u3092\u8ffd\u52a0</button>\n</div></header>\n\n<div class=\"filters gutter\" id=\"filters\"></div>\n<div class=\"notices gutter\" id=\"notices\"></div>\n\n<main class=\"app gutter\" id=\"app\">\n  <section id=\"monthView\" class=\"cal\" aria-label=\"\u6708\u9593\u30ab\u30ec\u30f3\u30c0\u30fc\">\n    <div class=\"dow\"><div class=\"su\">\u65e5</div><div>\u6708</div><div>\u706b</div><div>\u6c34</div><div>\u6728</div><div>\u91d1</div><div class=\"sa\">\u571f</div></div>\n    <div class=\"grid\" id=\"grid\"></div>\n  </section>\n  <section id=\"listView\" class=\"agenda\" hidden aria-label=\"\u4e88\u5b9a\u30ea\u30b9\u30c8\"></section>\n  <aside class=\"panel\" id=\"panel\" aria-live=\"polite\"></aside>\n</main>\n\n<div id=\"sheetRoot\"></div>\n<div class=\"toast\" id=\"toast\" role=\"status\" hidden></div>\n<input type=\"file\" id=\"restoreFile\" accept=\".json,application/json\" hidden>\n\n</div>";


const APP_VERSION="2026.10.26c";
const C=window.TCCore;
const LABELS=[{k:"meeting",n:"会議"},{k:"visit",n:"外出・訪問"},{k:"deadline",n:"締切"},{k:"leave",n:"休暇・不在"},{k:"event",n:"社内イベント"},{k:"user",n:"利用者"},{k:"other",n:"その他"}];
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
const $=id=>R.getElementById(id);
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
  $("panel").innerHTML=`<div class="panel-head"><div class="panel-date">${d.getMonth()+1}月${d.getDate()}日（${WD[d.getDay()]}）<small>${hol?esc(hol)+" · ":""}${evs.length}件の予定</small></div><button class="primary" data-add-day ${can?"":"disabled"}>この日に追加</button></div>${body}`;
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

/* ---------- 送迎表との連携 ---------- */
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

/* ---------- 予定の編集 ---------- */
let ed=null;
function openEditor(ev,day,draft){
  const ro=!(db&&S.canWrite&&core);
  const base=ev||null;
  const d=draft?draft.form:ev?{...ev,members:[...ev.members]}:{title:"",date:day||S.sel,endDate:day||S.sel,allDay:false,start:"10:00",end:"11:00",label:"meeting",place:"",memo:"",members:S.me?[S.me]:[],sg:null};
  ed={id:draft?draft.id:ev?.id||null,base:draft?draft.base:base,d,ro,confirmDel:false,comments:[],err:"",changed:false};
  drawSheet();
  unsubCm?.();unsubCm=null;
  if(ed.id&&db&&ed.base){try{unsubCm=db.doc(C.cmPath(ed.base.cmKey||ed.base.date,ed.id)).onSnapshot(s=>{if(!ed)return;const cm=s.exists?C.normCm(s.data()):{};ed.comments=cm[ed.id]||[];drawComments()},()=>{})}catch{}}
  setTimeout(()=>$("f-title")?.focus(),30);
}
function closeEditor(keepDraft){unsubCm?.();unsubCm=null;if(!keepDraft)draftDrop();ed=null;$("sheetRoot").innerHTML="";render()}
function readForm(){
  if(!$("f-title"))return;const d=ed.d;d.title=$("f-title").value.trim();d.allDay=$("f-allday").checked;d.date=$("f-date").value;d.endDate=$("f-enddate").value||d.date;
  d.start=$("f-start").value;d.end=$("f-end").value;d.label=R.querySelector('input[name="f-label"]:checked')?.value||"other";d.place=$("f-place").value.trim();d.memo=$("f-memo").value;readSg();
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
    <div class="field"><label for="f-title">タイトル</label><input class="input title-input" id="f-title" maxlength="80" value="${esc(d.title)}" placeholder="例：週次定例" ${v()}></div>
    <label class="check"><input type="checkbox" id="f-allday" ${d.allDay?"checked":""} ${ro?"disabled":""}>終日</label>
    <div class="row">
      <div class="field"><label for="f-date">開始日</label><input class="input" type="date" id="f-date" value="${esc(d.date)}" ${v()}></div>
      <div class="field" ${d.allDay?"hidden":""} id="w-start"><label for="f-start">開始時刻</label><input class="input" type="time" id="f-start" value="${esc(d.start||"10:00")}" step="300" ${v()}></div>
    </div>
    <div class="row">
      <div class="field"><label for="f-enddate">終了日</label><input class="input" type="date" id="f-enddate" value="${esc(d.endDate)}" ${v()}></div>
      <div class="field" ${d.allDay?"hidden":""} id="w-end"><label for="f-end">終了時刻</label><input class="input" type="time" id="f-end" value="${esc(d.end||"11:00")}" step="300" ${v()}></div>
    </div>
    <div class="field"><span class="lbl">ラベル</span><div class="labels">${LABELS.map(l=>`<label style="--c:var(--l-${l.k})"><input type="radio" name="f-label" id="f-label-${l.k}" value="${l.k}" ${d.label===l.k?"checked":""} ${ro?"disabled":""}><span><i class="dot" style="background:var(--c)"></i>${l.n}</span></label>`).join("")}</div></div>
    <div class="field"><label for="f-place">場所</label><input class="input" id="f-place" maxlength="80" value="${esc(d.place)}" placeholder="会議室A / オンライン など" ${v()}></div>
    <div class="field"><span class="lbl">参加者</span><div class="members" id="members"></div>
      ${ro?"":`<div class="picker"><input class="input" id="f-member" placeholder="名前で検索して追加" autocomplete="off"><div class="hits" id="hits" hidden></div></div>`}</div>
    <div class="field sgbox"><span class="lbl">送迎表に反映</span><div id="sgArea"></div></div>
    <div class="field"><label for="f-memo">メモ</label><textarea class="input" id="f-memo" maxlength="2000" placeholder="議題、持ち物、URL など" ${v()}>${esc(d.memo)}</textarea></div>
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
  if(d.sg){
    const who=d.sg.type.startsWith("staff")?d.sg.staff:d.sg.users;
    if(!who.length)return showErr("送迎表に反映する"+(d.sg.type.startsWith("staff")?"職員":"利用者")+"を選んでください。");
    if(d.sg.type==="user_time"&&!d.sg.meet&&!d.sg.send&&!d.sg.noMeet&&!d.sg.noSend)return showErr("変更する迎え・送りの時刻、または送迎なしの理由を入力してください。");
    if(!d.title)d.title=who.slice(0,3).join("・")+(who.length>3?"他":"")+" "+({staff_off:"休み",staff_plan:"予定",user_absent:"欠席",user_time:d.sg.noMeet||d.sg.noSend||"時間変更"}[d.sg.type]);
  }
  if(!d.title)return showErr("タイトルを入力してください。");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date))return showErr("開始日を選んでください。");
  if(d.endDate<d.date)return showErr("終了日は開始日以降にしてください。");
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
R.addEventListener("click",async e=>{
  const t=e.target;
  if(t.closest("[data-reload]")){location.reload();return}
  if(t.closest("[data-draft-open]")){const d=draftGet();if(d){const cur=d.id?allEvents().find(x=>x.id===d.id):null;openEditor(cur||d.base||null,null,d)}return}
  if(t.closest("[data-draft-drop]")){draftDrop();render();return}
  const evEl=t.closest("[data-ev]");
  if(evEl&&!t.closest("#sheetRoot")){const x=allEvents().find(z=>z.id===evEl.dataset.ev);if(x)openEditor(x);return}
  const day=t.closest("[data-day]");if(day){S.sel=day.dataset.day;render();return}
  if(t.closest("[data-add-day]")){openEditor(null,S.sel);return}
  const rs=t.closest("[data-restore]");if(rs){const x=allEvents().find(z=>z.id===rs.dataset.restore);if(x&&core){core.restore(x);toast("元に戻しました")}return}
  if(!$("ov"))return;
  if(t.id==="ov"||t.closest("[data-close]")){if(ed)closeEditor();else{$("sheetRoot").innerHTML=""}return}
  /* 同期画面 */
  const f=t.closest("[data-force]");if(f){core.force(f.dataset.force);openSync();return}
  const r=t.closest("[data-retry]");if(r){core.retry(r.dataset.retry);openSync();return}
  const da=t.closest("[data-discard-ask]");if(da){const slot=R.querySelector(`[data-confirm-slot="${CSS.escape(da.dataset.discardAsk)}"]`);slot.innerHTML=`<div class="acts" style="margin-top:4px"><span class="by" style="font-size:12px">この操作を取り消します。元には戻せません。</span><button class="danger solid sm" data-discard="${esc(da.dataset.discardAsk)}">取り消す</button></div>`;return}
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
  const sgp=t.closest("[data-sgpick]");if(sgp){readSg();const k=sgp.dataset.sgpick;const sg=ed.d.sg;if(sg&&!sg[k].includes(sgp.dataset.name))sg[k].push(sgp.dataset.name);drawSg();setTimeout(()=>{const i=$("f-sgq-"+k);if(i){i.focus();sgHits(k,"")}},0);draftSave();return}
  const sgr=t.closest("[data-sgrm]");if(sgr){readSg();const k=sgr.dataset.sgrm;if(ed.d.sg)ed.d.sg[k]=ed.d.sg[k].filter(n=>n!==sgr.dataset.name);drawSg();draftSave();return}
  if(!t.closest(".sgsub")){for(const k of["staff","users"]){const h=$("sghits-"+k);if(h)h.hidden=true}}
  const rm=t.closest("[data-rm]");if(rm){ed.d.members=ed.d.members.filter(i=>i!==rm.dataset.rm);drawMembers();draftSave();return}
  const pk=t.closest("[data-pick]");if(pk){if(!ed.d.members.includes(pk.dataset.pick))ed.d.members.push(pk.dataset.pick);$("f-member").value="";$("hits").hidden=true;drawMembers();draftSave();return}
  if(!t.closest(".picker")){const h=$("hits");if(h)h.hidden=true}
});
R.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users")){e.preventDefault();const b=$("sghits-"+e.target.id.slice(6))?.querySelector("[data-sgpick]");if(b)b.click();return}
  if(e.key==="Escape"&&$("ov")){if(ed)closeEditor(true);else $("sheetRoot").innerHTML="";return}
  const day=e.target.closest?.("[data-day]");if(day&&(e.key==="Enter"||e.key===" ")){e.preventDefault();S.sel=day.dataset.day;render()}
});
R.addEventListener("change",e=>{if(!ed)return;
  if(e.target.id==="f-sgtype"){readSg();const t=e.target.value;const want=t==="staff_off"?"leave":t.startsWith("user")?"user":null;if(want){const r=$("f-label-"+want);if(r)r.checked=true}if(t&&!SGN.loaded)loadNames().then(()=>{if(ed)drawSg()});drawSg();draftSave();return}
  if(e.target.id==="f-allday"){$("w-start").hidden=$("w-end").hidden=e.target.checked}
  if(e.target.id==="f-date"){const x=$("f-enddate");if(!x.value||x.value<e.target.value)x.value=e.target.value}
  draftSave()});
async function search(q){const h=$("hits");if(!h||!user)return;let res=[];try{res=await user.search(q)}catch{}if(!ed)return;res=res.filter(p=>!ed.d.members.includes(p.id));
  h.innerHTML=res.length?res.map(p=>`<button type="button" data-pick="${esc(p.id)}"><img src="${esc(p.avatarUrl)}" alt=""><span>${esc(p.name)}${p.isMe?"（自分）":""}</span></button>`).join(""):`<div class="by" style="padding:6px 8px">${q?"見つかりません":"名前を入力してください"}</div>`;h.hidden=false}
R.addEventListener("input",e=>{if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){sgHits(e.target.id.slice(6),e.target.value);return}if(e.target.id==="f-member")search(e.target.value);else if(ed&&e.target.closest("#evForm"))draftSave()});
R.addEventListener("focusin",e=>{if(e.target.id==="f-member")search(e.target.value);if(e.target.id==="f-sgq-staff"||e.target.id==="f-sgq-users"){if(!SGN.loaded)loadNames().then(()=>sgHits(e.target.id.slice(6),e.target.value));sgHits(e.target.id.slice(6),e.target.value)}});
R.addEventListener("submit",e=>{e.preventDefault();
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
$("backBtn").onclick=()=>{if(ed)closeEditor(true);$("sheetRoot").innerHTML="";host.hidden=true;document.documentElement.style.overflow=""};
window.__sgOpenCalendar=(date)=>{host.hidden=false;document.documentElement.style.overflow="hidden";host.scrollTop=0;
  if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)){S.sel=date;const d=parse(date);const c=new Date(d.getFullYear(),d.getMonth(),1);if(+c!==+S.cursor){S.cursor=c;subscribe()}}
  loadNames().then(()=>{if(ed)drawSg()});render()};
render();
(async()=>{
  if(!window.claude||!window.claude.use){S.dbState="none";render();return}
  try{user=await window.claude.use("user")}catch{user=null}
  try{db=await window.claude.use("db")}catch{db=null}
  try{downloads=await window.claude.use("downloads")}catch{downloads=null}
  if(user){try{S.me=await user.id()}catch{}try{if(await user.can("data.write")===false)S.canWrite=false}catch{}try{S.isAdmin=await user.canEdit()}catch{}}
  if(!db){S.dbState="none";render();return}
  core=C.createCore({db,store,me:S.me});
  core.on(()=>{render();if(ed)drawComments();else if($("ov")&&$("sy-t"))openSync()});
  S.dbState="ok";subscribe();core.kick();render();   // 起動時に未送信を自動で再送（障害D）
  setInterval(()=>{if(core.status().queued&&S.online)core.kick()},30000);
})();

})();
