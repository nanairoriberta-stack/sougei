import json, os
O='gas/out/'
# 画面の部品でエラーが出たり、インターネットから読み込む部品が届かなかったら、画面の下に出す（F12を使わなくても原因が分かるように）
GUARD = '''<script>(function(){var n=0;function show(m){if(n++>4)return;var d=document.createElement("div");d.style.cssText="position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#fff1f2;color:#9f1239;border:1px solid #fda4af;border-radius:8px;padding:8px 10px;font:12px/1.5 system-ui,sans-serif;white-space:pre-wrap;word-break:break-all";d.textContent="画面でエラーが出ました（この写真を担当者に送ってください。押すと消えます）\\n"+m;d.onclick=function(){d.remove()};(document.body||document.documentElement).appendChild(d)}
window.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="SCRIPT"&&t.src){show("読み込めませんでした: "+t.src);return}if(t&&t!==window)return;show((e.message||"")+(e.filename?"\\n"+String(e.filename).split("/").pop()+":"+e.lineno:""))},true);
window.addEventListener("unhandledrejection",function(e){var r=e.reason;if(r instanceof Error)show("（あとで起きたエラー）"+r.message)})})();</script>'''
rd=lambda p: open(p,encoding='utf-8').read()
def js(p): return ev(rd(p))
# Googleは画面をいったん自分の仕組みで読み直してから書き出す。そのとき、プログラムの中の「タグに見える文字」（<form や </div> など）で
# プログラムを途中で切ってしまうことがある（2026-10-28 実機で「Unexpected end of input」）。そこで、プログラムは「<」を1つも含まない
# 文字列にして渡し、画面の中で実行する（中身は同じ。読み込みの速さもほぼ変わらない）
def lit(c): return json.dumps(c, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
# 大きなプログラム（送迎表は約65万字）を1つの長い文字列にすると、Googleの書き出しが受け付けないことがあるので、2万字ずつの行に分けて渡す
def ev(code):
    parts = [code[i:i + 20000] for i in range(0, len(code), 20000)] or ['']
    return '(0,eval)([\n' + ',\n'.join(lit(x) for x in parts) + '\n].join(""))'
# 開くときの版（e）・日付（d）は、Googleのアドレスからも読む（google.script.url.getLocation）。
# サーバーが画面に書き込んだ値（/*__BOOT__*/ の置きかえ）が本物のGoogleで届かず、りんく・ぷれいす版を開いても現体制版になった（2026-10-31 実機）。
# そのため画面のプログラムはすぐには動かさず（RUN に積む）、アドレスを読んでから順に動かす。読めない・遅いとき（2.5秒）はそのまま動かす
def runjs(p): return 'window.__sgRun.push(function(){' + js(p) + '});'
START = ev('''(function(){var done=false;function go(){if(done)return;done=true;var r=window.__sgRun;for(var i=0;i<r.length;i++){try{r[i]()}catch(e){(function(x){setTimeout(function(){throw x})})(e)}}}
try{var u=window.google&&google.script&&google.script.url;if(u&&u.getLocation){var t=setTimeout(go,2500);u.getLocation(function(l){clearTimeout(t);var p=(l&&l.parameter)||{};
if(/^v[123]$/.test(p.e||""))window.__SG_EDITION=p.e;if(/^\\d{4}-\\d{2}-\\d{2}$/.test(p.d||""))window.__SG_DATE=p.d;go()});return}}catch(e){}go()})();''')
cal_html = f'''<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<title>カレンダー</title>
{GUARD}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap" media="print" onload="this.media='all'">
<style>[hidden]{{display:none!important}}body{{margin:0}}{rd('gas/calendar_css.txt')}</style>
</head><body>
{rd('gas/calendar_body.txt')}
<script>/*__BOOT__*/window.__SG_PAGE="calendar";</script>
<script>window.__SG_PAGE="calendar";window.__sgRun=[];</script>
<script>{runjs('calcore.js')}</script>
<script>{runjs('gas/gashost.js')}</script>
<script>{runjs('gas/calendar_app.js')}</script>
<script>{START}</script>
</body></html>'''
sg_html = f'''<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>送迎表</title>
{GUARD}
<style>{rd('build/tw.css')}
:root{{color-scheme:light}} html,body{{background:#f5f5f4;color:#292524}}
.sg-alert{{position:fixed;left:50%;transform:translateX(-50%);top:8px;z-index:2000;display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:min(720px,calc(100% - 24px));padding:10px 12px;border-radius:8px;font:13px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.18);background:#fff7ed;color:#7c2d12;border:1px solid #fdba74}}
.sg-alert.bad{{background:#fff1f2;color:#9f1239;border-color:#fda4af}} .sg-alert span{{flex:1 1 260px}}
.sg-alert button{{border:1px solid currentColor;background:#fff;border-radius:6px;padding:2px 10px;color:inherit;cursor:pointer}}
[hidden]{{display:none!important}}
</style></head><body>
<div id="sg-alert" class="sg-alert" hidden></div>
<div id="root"></div>
<script>/*__BOOT__*/</script>
<script>window.__sgRun=[];</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>{runjs('calcore.js')}</script>
<script>{runjs('kvsync.js')}</script>
<script>{runjs('calsync.js')}</script>
<script>{runjs('gas/kvgas.js')}</script>
<script>{runjs('gas/gashost.js')}</script>
<script>{runjs('gas/sougei_boot.js')}</script>
<script>{runjs('build/app.bundle.gas.js')}</script>
<script>{START}</script>
</body></html>'''
open(O+'calendar.html','w',encoding='utf-8').write(cal_html)
open(O+'sougei.html','w',encoding='utf-8').write(sg_html)
open(O+'Code.gs','w',encoding='utf-8').write(rd('gas/Code.gs'))
hdr='// 共通部品（変更しないでください）。画面側と同じコードをサーバーでも使います\n'
open(O+'Lib1_calcore.gs','w',encoding='utf-8').write(hdr+rd('calcore.js'))
open(O+'Lib2_merge.gs','w',encoding='utf-8').write(hdr+rd('kvsync.js'))
open(O+'Lib3_calsync.gs','w',encoding='utf-8').write(hdr+rd('calsync.js'))
open(O+'Lib4_engine.gs','w',encoding='utf-8').write(hdr+rd('mcp/engine.js'))
open(O+'Mcp.gs','w',encoding='utf-8').write(rd('gas/Mcp.gs'))
# zipにしてWindowsで開いても名前が化けないよう、Googleに貼らない2つも英字の名前にする（手順書はメモ帳で化けないようBOM付き）
open(O+'relay_cloudflare.js','w',encoding='utf-8').write(rd('mcp/relay-worker.mjs'))
open(O+'Claude_connect.txt','w',encoding='utf-8-sig').write(rd('gas/Claude接続の手順.txt'))
open(O+'appsscript.json','w').write(json.dumps({"timeZone":"Asia/Tokyo","runtimeVersion":"V8","exceptionLogging":"STACKDRIVER","webapp":{"executeAs":"USER_DEPLOYING","access":"ANYONE_ANONYMOUS"}},indent=2))
for f in sorted(os.listdir(O)): print(f, os.path.getsize(O+f))
