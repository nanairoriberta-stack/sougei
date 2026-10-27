#!/usr/bin/env bash
# 全テスト。ブラウザのテスト(pw/)は「bash test.sh ui」
set -uo pipefail
cd "$(dirname "$0")"
run() { echo "== $1"; node "$1" 2>&1 | grep -v "Warning\|Reparsing\|To eliminate\|trace-warnings" | tail -${2:-2}; }
run test-kv.js; run test-cal.js; run test-agent.js; run gas/test-gas.js; run gas/test-ai.js; run mcp/test-mcp.js
if [ "${1:-}" = ui ]; then (cd pw && for f in gas_ui.js agent_ui.js; do echo "== pw/$f"; node $f 2>&1 | tail -4; done); fi
