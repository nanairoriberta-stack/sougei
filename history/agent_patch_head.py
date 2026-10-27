"""会話しながら送迎表を組み替えるAIエージェント（💬 AIと相談）を送迎表アプリに追加する。
既存の「AI調整」のルール・状態の作り方・案の反映処理と、出力前チェックを、そのまま関数として取り出して使う（元の処理は変えない）"""
import sys
src = open("app2u.jsx", encoding="utf-8").read()
def cut(a, b, start=0, inclusive_b=False):
    i = src.index(a, start); j = src.index(b, i)
    return src[i:j + (len(b) if inclusive_b else 0)], i, j
def rep(a, b, n=1):
    global src
    c = src.count(a)
    if c != n: sys.exit(f"想定{n} 実際{c}: {a[:80]}")
    src = src.replace(a, b)

# --- (0) AI調整の不具合修正：移動便(あいのて→嫁島など)の乗客を「重複乗車」とみなして外し、移動便を消していた
rep('                  if (r.kind !== k || r.mode === "train") return r;', '                  if (r.kind !== k || r.mode === "train" || r.mode === "move") return r; // 移動便は送迎ではないので重複の対象外')
rep('                if (r.kind !== "meet" && r.kind !== "send") return true; // 回送・外出(他)は対象外', '                if (r.kind !== "meet" && r.kind !== "send") return true; // 回送・外出(他)は対象外\n                if (r.mode === "move") return true; // 移動便は乗客がいなくても残す')

# --- (1) 案の反映処理（AI調整の onApply の中身）を純粋な関数として取り出す
onapply = src.index('onApply={(changes, idMap, unresolvedFromAi, logInfo) => {')
pre, _, _ = cut("            const sByName = {}; sheetMaster.staff", "            updateSheet((prev) => {\n", onapply)
body, _, _ = cut("            updateSheet((prev) => {\n", "              return { ...prev, runs, blocks, staffOv: staffOv2 };\n            });", onapply, inclusive_b=True)
body = body[len("            updateSheet((prev) => {\n"):]
body = body[: body.rindex("            });")]
apply_fn = ("// AI案(changes)を送迎表1日分に当てはめた結果を返す(画面は変えない)。AI調整の反映処理と同じ内容\n"
            "function aiApplyPure(sheetMaster, prev, changes, idMap, logInfo) {\n" + pre +
            "  const next = ((prev) => {\n" + body + "  })(prev);\n"
            "  return { next, applied, dedupCount, capFixed, emptyRemoved };\n}\n")

# --- (2) 出力前チェック（handleExport の中身）を取り出す
chk, _, _ = cut("    const sheetData = { staffOv: {}, userAbsent: {}, userDept: {}, notes: \"\", contact: \"\", ...sheet,", "    if (!groups.length) {", src.index("const handleExport = async () => {"))
if chk.count("await sGet(`pattern:${wd}`)") != 1: sys.exit("patDay")
chk = chk.replace("await sGet(`pattern:${wd}`)", "patDayArg")
checks_fn = ("// 出力前チェックの結果(groups)を返す。Excel出力の前に出るチェックと同じ内容\n"
             "function collectSheetChecks(sheetMaster, sheet, date, patDayArg) {\n" + chk + "    return groups;\n}\n")

# --- (3) AIに渡す状態（AI調整の build と同じ）
bld, _, _ = cut("    const dn = (id) => { const d = master.departments.find((x) => x.id === id); return d ? d.name : \"\"; };\n    const ov = { ...(data.staffOv || {}) };",
                "    return { staffOn, users, vehicles, runs, helps, dn, unMeet, unSend, holdIds: [...holdIds, ...holdHelpIds] };", src.index("function AiAdjustModal("), inclusive_b=True)
wc_line = "    wcList.forEach((w) => { ov[w.id] = { ...(ov[w.id] || {}), ...(w.off ? { off: true } : { start: w.start, end: w.end }) }; });\n"
if bld.count(wc_line) != 1: sys.exit("wcList")
bld = bld.replace(wc_line, "")
ctx_fn = "// AIに渡す当日の状態(職員・利用者・車・便・ヘルプ・未割当・保留)\nfunction aiContextOf(master, data, weekday) {\n" + bld + "\n}\n"

# --- (4) ルール（AI調整のプロンプトと同じ）
bp = src.index("const buildPrompt = (p) => `")
rules, _, _ = cut("# 拠点間の車での移動時間(分・概算)\n", "\n# 現在の便", bp)
rules2, _, _ = cut("# ルール\n", "\n- 出力は次のJSONのみ", bp)
rules_fn = "// 送迎表のルール(AI調整と同じ)\nfunction aiRulesText(master) {\n  return `" + rules + "\n" + rules2 + "`;\n}\n"

