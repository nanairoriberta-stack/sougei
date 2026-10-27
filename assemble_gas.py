import json, os
O='gas/out/'
rd=lambda p: open(p,encoding='utf-8').read()
def js(p): return rd(p).replace('</script>','<\\/script>')
cal_html = f'''<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<title>カレンダー</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap">
<style>[hidden]{{display:none!important}}body{{margin:0}}{rd('gas/calendar_css.txt')}</style>
</head><body>
{rd('gas/calendar_body.txt')}
<script>/*__BOOT__*/window.__SG_PAGE="calendar";</script>
<script>{js('calcore.js')}</script>
<script>{js('gas/gashost.js')}</script>
<script>{js('gas/calendar_app.js')}</script>
</body></html>'''
sg_html = f'''<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>送迎表</title>
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
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>{js('calcore.js')}</script>
<script>{js('kvsync.js')}</script>
<script>{js('calsync.js')}</script>
<script>{js('gas/kvgas.js')}</script>
<script>{js('gas/gashost.js')}</script>
<script>{js('gas/sougei_boot.js')}</script>
<script>{js('build/app.bundle.gas.js')}</script>
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
