"""Claude（カスタムコネクタ）が置いた「AIの案」を、送迎表画面で確認・反映・破棄する画面を追加する。app3u.jsx → app4u.jsx"""
src = open("app3u.jsx", encoding="utf-8").read()
def rep(a, b):
    global src
    assert src.count(a) == 1, ("anchor", a[:60], src.count(a))
    src = src.replace(a, b)

comp = r'''
/* ===== Claudeの案（Claudeアプリのカスタムコネクタから届いた組み替え案） ===== */
function useClaudeProposals() {
  const host = typeof window !== "undefined" ? window.SGHost : null;
  const [list, setList] = useState([]);
  const load = useCallback(async () => {
    if (!host || !host.me || !host.me.canSougei) return;
    try { const r = await host.call("prop.list", []); setList((r || []).filter((p) => p.ed === (window.__SG_EDITION || "v1"))); } catch (e) {}
  }, [host]);
  useEffect(() => {
    if (!host) return;
    let alive = true; host.ready.then(() => alive && load());
    const on = () => load(); window.addEventListener("sg-props", on);
    return () => { alive = false; window.removeEventListener("sg-props", on); };
  }, [host, load]);
  return { enabled: !!host, list, load };
}
function ClaudeProposals({ list, reload, onClose, onOpenDate }) {
  const host = window.SGHost;
  const [busy, setBusy] = useState("");
  const act = async (p, kind) => {
    if (kind === "discard" && !window.confirm(`「${p.title}」を捨てますか？`)) return;
    setBusy(p.id);
    try {
      const r = await host.call(kind === "apply" ? "prop.apply" : "prop.discard", [p.id]);
      if (window.__sgkv && window.__sgkv.poll) await window.__sgkv.poll();
      notify(kind === "apply" ? `Claudeの案「${p.title}」を反映しました(${(r || []).join("・") || "変更なし"})` : `案「${p.title}」を捨てました`);
      await reload();
      if (kind === "apply") onClose();
    } catch (e) { notify("できませんでした: " + ((e && e.message) || e), "error"); await reload(); }
    finally { setBusy(""); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-bold">🤖 Claudeの案 <span className="text-xs font-normal text-stone-500">Claudeアプリで相談して作った案です。反映するまで送迎表は変わりません</span></div>
          <button className={btnSec} onClick={onClose}>閉じる</button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4">
          {!list.length && <div className="text-sm text-stone-500">まだ反映していない案はありません。Claudeアプリで「送迎表」コネクタを使って相談すると、ここに届きます。</div>}
          {list.map((p) => {
            const areas = {}; (p.diff || []).forEach((d) => (areas[d.area] = areas[d.area] || []).push(d.text));
            return (
              <div key={p.id} className="border border-stone-300 rounded-lg p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <div className="font-bold">{p.title}</div>
                  <div className="text-xs text-stone-500">{p.date ? p.date + " ・ " : ""}{p.byName} ・ {String(p.at || "").slice(5, 16).replace("T", " ")}</div>
                </div>
                {Object.keys(areas).map((a) => (
                  <div key={a} className="mt-2">
                    <div className="text-xs font-semibold text-stone-600">{a}</div>
                    <ul className="text-sm list-disc pl-5">{areas[a].slice(0, 40).map((t, i) => <li key={i}>{t}</li>)}{areas[a].length > 40 && <li>ほか{areas[a].length - 40}か所</li>}</ul>
                  </div>
                ))}
                {!(p.diff || []).length && <div className="text-sm text-stone-500 mt-2">変わる所はありません</div>}
                {(p.newProblems || []).length > 0 && <div className="mt-2 text-sm bg-amber-50 border border-amber-300 rounded p-2"><b>この案で新しく出る問題</b><ul className="list-disc pl-5">{p.newProblems.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
                {(p.errors || []).length > 0 && <div className="mt-2 text-sm bg-stone-50 border border-stone-300 rounded p-2"><b>当てられなかった変更</b><ul className="list-disc pl-5">{p.errors.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
                <div className="flex gap-2 mt-3">
                  <button className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-3 py-2 rounded-md disabled:opacity-50" disabled={!!busy} onClick={() => act(p, "apply")}>{busy === p.id ? "反映中…" : "この案を反映"}</button>
                  {p.date && <button className={btnSec} disabled={!!busy} onClick={() => onOpenDate(p.date)}>{p.date} を開く</button>}
                  <button className={btnSec} disabled={!!busy} onClick={() => act(p, "discard")}>捨てる</button>
                </div>
              </div>
            );
          })}
          <div className="text-xs text-stone-500">反映するときは、相談中にほかの人やカレンダーが変えた分と統合します(上書きしません)。誰が反映したかは変更履歴に残ります。</div>
        </div>
      </div>
    </div>
  );
}
'''
rep("function AgentChat({ master, sheet, date, onApply, onClose }) {", comp + "\nfunction AgentChat({ master, sheet, date, onApply, onClose }) {")
rep("  const [date, setDate] = useState(() => {", "  const claudeProps = useClaudeProposals();\n  const [date, setDate] = useState(() => {")
rep('''<button className={btnSec} onClick={() => setModal({ type: "agent" })} title="AIと会話しながら、送迎表・利用者の利用曜日・入浴の曜日や時刻・ルールを変えます。反映するまで何も変わりません">💬 AIと相談</button>''',
    '''<button className={btnSec} onClick={() => setModal({ type: "agent" })} title="AIと会話しながら、送迎表・利用者の利用曜日・入浴の曜日や時刻・ルールを変えます。反映するまで何も変わりません">💬 AIと相談</button>
              {claudeProps.enabled && claudeProps.list.length > 0 && <button className="bg-amber-100 border border-amber-400 hover:bg-amber-200 text-amber-900 text-sm font-semibold px-3 py-2 rounded-md" onClick={() => { claudeProps.load(); setModal({ type: "claudeProps" }); }} title="Claudeアプリで相談して作った組み替え案を確認して反映します">🤖 Claudeの案 {claudeProps.list.length}</button>}''')
rep('''      {modal && modal.type === "agent" && master && sheet && (''', '''      {modal && modal.type === "claudeProps" && (
        <ClaudeProposals list={claudeProps.list} reload={claudeProps.load} onClose={() => setModal(null)} onOpenDate={(d) => { setModal(null); setTab && setTab("sheet"); setDate(d); }} />
      )}
      {modal && modal.type === "agent" && master && sheet && (''')
rep('import React, { useState, useEffect, useRef, useMemo } from "react";', 'import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";')
open("app4u.jsx", "w", encoding="utf-8").write(src)
print("app4u.jsx", len(src))
