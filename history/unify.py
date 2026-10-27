"""3つの版（現体制・新体制・りんく）を1つのソースにまとめる。版はページを開くときに決まる（window.__SG_EDITION）"""
import re, sys
v1 = open("app.jsx", encoding="utf-8").read()
src = open("e3.jsx", encoding="utf-8").read()   # りんく版をもとにする（なないろの初期データも seedMasterNanairo として入っている）
def rep(a, b, n=1):
    global src
    c = src.count(a)
    if c != n: sys.exit(f"想定{n} 実際{c}: {a[:80]}")
    src = src.replace(a, b)

rep('''const EDITION = "v3";
const EDITION_LABEL = "りんく・ぷれいす版";            // 画面の帯に出す名前
const EDITION_NOTE = "";              // 帯の補足
const EDITION_COLOR = "bg-violet-100 text-violet-800 border-violet-400";''', '''const EDITION_INFO = {
  v1: { label: "現体制版", note: "〜10/31", color: "bg-stone-100 text-stone-600 border-stone-300", start: "" },
  v2: { label: "新体制版", note: "11/1〜", color: "bg-emerald-100 text-emerald-800 border-emerald-400", start: "2026-11-01" },
  v3: { label: "りんく・ぷれいす版", note: "", color: "bg-violet-100 text-violet-800 border-violet-400", start: "" },
};
const EDITION = (typeof window !== "undefined" && EDITION_INFO[window.__SG_EDITION]) ? window.__SG_EDITION : "v1";
const EDITION_LABEL = EDITION_INFO[EDITION].label;            // 画面の帯に出す名前
const EDITION_NOTE = EDITION_INFO[EDITION].note;              // 帯の補足
const EDITION_COLOR = EDITION_INFO[EDITION].color;
const EDITION_START = EDITION_INFO[EDITION].start;           // この版の運用開始日(これより前に開いたらこの日を表示)''')

pat_v1 = re.search(r"^const SEED_PATTERNS = .*$", v1, re.M).group(0)
rep("const SEED_PATTERNS = {}; // りんく・ぷれいす版は週間パターンを画面から作る",
    "const SEED_PATTERNS = EDITION === \"v3\" ? {} : " + pat_v1[len("const SEED_PATTERNS = "):].rstrip(";") + ";")

rep("function seedMaster() {\n  const d1 = uid();", "function seedMaster() { return EDITION === \"v3\" ? seedMasterLink() : seedMasterNanairo(); }\nfunction seedMasterLink() {\n  const d1 = uid();")

rep("  const [date, setDate] = useState(todayStr());", '''  const [date, setDate] = useState(() => {
    // 新体制版は開始日(11/1)より前に開いたらその日を表示。カレンダーから日付付きで開いたらその日
    const d0 = typeof window !== "undefined" && /^\\d{4}-\\d{2}-\\d{2}$/.test(window.__SG_DATE || "") ? window.__SG_DATE : "";
    if (d0) return d0;
    const t = todayStr();
    return EDITION_START && t < EDITION_START ? EDITION_START : t;
  });''')

# 版の切替：同じ仕組みの中の別ページへ移動する
i = src.index("function EditionSwitcher() {")
j = src.index("\n}\n", i) + 3
src = src[:i] + '''function EditionSwitcher() {
  const [open, setOpen] = useState(false);
  const base = (typeof window !== "undefined" && window.__SG_BASE) || "";
  const go = (q) => { const a = document.createElement("a"); a.href = base + q; a.target = "_top"; document.body.appendChild(a); a.click(); a.remove(); };
  return (
    <span className="relative self-end mb-0.5">
      <button className="text-[10px] px-1.5 py-0.5 rounded border border-stone-300 text-stone-500 hover:bg-stone-50" onClick={() => setOpen(!open)}>⇄ 版の切替</button>
      {open && (
        <span className="absolute left-0 top-6 z-50 bg-white border border-stone-300 rounded shadow-lg p-2 flex flex-col gap-1 min-w-[12rem]">
          {Object.entries(EDITION_INFO).map(([ed, info]) => (
            <button key={ed} disabled={ed === EDITION} className="text-left text-xs px-2 py-1 rounded hover:bg-stone-100 disabled:opacity-40" onClick={() => go(`?page=sougei&e=${ed}`)}>{info.label}{ed === EDITION ? "(表示中)" : ""}</button>
          ))}
          <button className="text-left text-xs px-2 py-1 rounded hover:bg-stone-100 text-violet-700" onClick={() => go("?page=calendar")}>📅 カレンダー</button>
        </span>
      )}
    </span>
  );
}
''' + src[j:]
open("unified.jsx", "w", encoding="utf-8").write(src)
print("unified.jsx", len(src))
