#!/usr/bin/env bash
# 作り直し：sougei.jsx（送迎表の画面）と gas/ のファイルから、Googleに貼るファイル一式(gas/out/)を作る
set -euo pipefail
cd "$(dirname "$0")"
ESB=./node_modules/.bin/esbuild
SHIM="--alias:react=./mcp/shims/react.js --alias:three=./mcp/shims/three.js"
mkdir -p .gen
# Node（テスト）とサーバー(GAS)から使う関数。sougei.jsx の中の関数名を変えたらここも直す
EXP='seedMaster, REQ_ID, reqStatusText, canonHelpLabel, canonHelpBlocks, scheduleRules, rulesAtDate, mergeSeedMaster, resolveSeedPattern, SEED_PATTERNS, EDITION, emptySheet, applyDayDept, noRideDefaults, aiApplyPure, collectSheetChecks, aiContextOf, aiRulesText, agApplyRules, agApplyMaster, agMasterDiff, agentDiff, agApplyDay, agDayDiff, rulesOf, weekdayOf, DAYS, RULE_LISTS, ENTITY_FIELDS, resolveVehicle, HOLD_ID, buildWorkbook, buildExcelHtml, appVerLabel'
{ cat sougei.jsx; printf '\nexport { %s };\n' "$EXP"; } > .gen/eng_src.jsx

echo "0) 画面のプログラムの書き間違いがないか"
for f in calcore.js kvsync.js calsync.js gas/kvgas.js gas/gashost.js gas/sougei_boot.js gas/calendar_app.js; do node --check "$f"; done
echo "1) テスト用の部品 → eng.cjs"
$ESB .gen/eng_src.jsx --bundle --loader:.jsx=jsx --format=cjs --platform=node --log-level=warning $SHIM --outfile=eng.cjs
echo "2) サーバー用の計算部品 → mcp/engine.js"
$ESB mcp/engine_entry.js --bundle --loader:.jsx=jsx --format=iife --global-name=SGEngine --target=es2019 --minify --log-level=warning $SHIM --outfile=mcp/engine.js
echo "3) 送迎表の画面 → build/app.bundle.gas.js ＋ build/tw.css"
cp sougei.jsx build/app.jsx
( cd build
  ../node_modules/.bin/esbuild entry.jsx --bundle --loader:.jsx=jsx --format=iife --target=es2019 --minify --log-level=warning \
    --alias:react=./shims/react.js --alias:react-dom/client=./shims/react-dom.js --alias:react-dom=./shims/react-dom.js --alias:three=./shims/three.js \
    --outfile=app.bundle.gas.js
  ./node_modules/.bin/tailwindcss -c tw.config.js -i tw.in.css -o tw.css --minify 2>/dev/null )
echo "4) Googleに貼るファイル → gas/out/"
python3 assemble_gas.py
