"""送迎表(v293)を新しい保存方式・カレンダー連携に対応させる差分。元ファイルは変更せず app2.jsx を作る"""
import re, sys
import os
src = open(os.environ.get("SRC", "app.jsx"), encoding="utf-8").read()
n_ok = 0
def rep(old, new, count=1, label=""):
    global src, n_ok
    c = src.count(old)
    if c != count:
        sys.exit(f"[{label}] 想定{count}件 実際{c}件")
    src = src.replace(old, new); n_ok += 1

# 1. 保存層
start = src.index("// ---------- 共有ストレージ ----------")
end = src.index("// ---------- 初期データ(アップロードされた送迎表を元に作成) ----------")
src = src[:start] + r'''// ---------- 共有ストレージ(新方式) ----------
// 保存先はこのアーティファクトの共有データベース。読み書きは保存エンジン(kvsync.js)が行う:
// ・送信時にサーバーの最新を読み直し、差分だけを統合(全体を書き戻さない) ・キーごとの排他ロック
// ・未送信は値ごと端末に保存して自動再送 ・読めなかったキーには書かない ・他の人の変更をリアルタイムで取り込む
let KV = null;
const kvReady = new Promise((res) => { if (typeof window !== "undefined") window.__sgSetKV = (k) => { KV = k; res(k); }; });
const hasStorage = () => !!KV;
async function sGet(key) { key = nsKey(key); const kv = await kvReady; return kv.get(key); }
async function sList(prefix) {
  try {
    const kv = await kvReady;
    let keys = await kv.list(nsKey(prefix == null ? "" : prefix));
    // 同じ保存場所に他の版のデータもあるので、自分の版のキーだけにする
    if (NS) keys = keys.filter((k) => String(k).startsWith(NS)).map((k) => String(k).slice(NS.length));
    else keys = keys.filter((k) => !/^v\d+:/.test(String(k)));
    return keys;
  } catch (e) { return null; }
}
const sWatch = (key, cb) => (KV ? KV.watch(nsKey(key), cb) : () => {});
const sUpdate = async (key, fn) => { const kv = await kvReady; return kv.update(nsKey(key), fn); };
const sLoadFailed = (key) => !!(KV && KV.loadFailed(nsKey(key)));
// ---- データ一括バックアップ/復元 ----
async function exportAllData() {
  let keys = (await sList("")) || [];
  const names = keys.map((k) => (typeof k === "string" ? k : k && k.key)).filter(Boolean);
  const data = {};
  const kv = await kvReady;
  const pendingKeys = new Set(kv.entries().map((e) => e.key));
  if (kv.getMany) {
    // まとめて読む（未送信の編集があるキーは端末の内容を使う）
    const plain = names.filter((k) => !pendingKeys.has(nsKey(k)));
    for (let i = 0; i < plain.length; i += 40) {
      const rows = await kv.getMany(plain.slice(i, i + 40).map(nsKey));
      rows.forEach((r) => { if (r.value != null) data[NS ? String(r.key).slice(NS.length) : r.key] = r.value; });
    }
    for (const k of names.filter((k) => pendingKeys.has(nsKey(k)))) { const v = await sGet(k); if (v != null) data[k] = v; }
  } else {
    for (const k of names) { const v = await sGet(k); if (v != null) data[k] = v; }
  }
  return { app: "sougei-app", edition: EDITION, editionLabel: EDITION_LABEL, seedVersion: SEED_VERSION, exportedAt: new Date().toISOString(), keys: names.length, data };
}
async function importAllData(obj) {
  if (!obj || obj.app !== "sougei-app" || !obj.data) throw new Error("このアプリのバックアップファイルではありません");
  const kv = await kvReady;
  const entries = Object.entries(obj.data);
  if (kv.importMany) {
    // まとめて書き込む（1回あたり約40万字まで）。途中で失敗したら、もう一度「復元」すれば続きから正しく入る
    let batch = [], size = 0, done = 0;
    const flush = async () => { if (!batch.length) return; await kv.importMany(batch); done += batch.length; notify(`復元中… ${done} / ${entries.length}件(画面を閉じないでください)`); batch = []; size = 0; };
    for (const [k, v] of entries) { const n = JSON.stringify(v).length; if (size + n > 400000) await flush(); batch.push({ key: nsKey(k), value: v }); size += n; }
    await flush();
    return entries.length;
  }
  for (const [k, v] of entries) kv.replace(nsKey(k), v);
  const t0 = Date.now();
  while (Date.now() - t0 < 60 * 60000) {
    const st = kv.status();
    if (!st.queued && !st.running) return entries.length;
    if (st.paused) break;
    notify(`復元中… 残り${st.queued}件 / ${entries.length}件(画面を閉じないでください)`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("送信が終わっていません。右上の保存状況から再送してください(内容は端末に保存済みです)");
}
async function sSet(key, val) { key = nsKey(key); const kv = await kvReady; kv.put(key, val); return true; }

''' + src[end:]
n_ok += 1

# 2. 保存の予約 → エンジンへ即時に渡す（値ごと端末保存・送信はエンジンが管理）
s0 = src.index("  const saveTimers = useRef({});")
s1 = src.index("  useEffect(() => {\n    (async () => {\n      let m = await sGet(\"master\");")
src = src[:s0] + '''  const saveTimers = useRef({});
  const scheduleSave = (key, value) => { sSet(key, value); };
  // 日付・曜日の切替時: 未送信を端末に書き切り、送信を促す(通信を待たずに切り替えられる)
  const flushSaves = async () => { if (KV) KV.flushLocal(); };
  const [calEvents, setCalEvents] = useState({ date: null, list: [] });

''' + src[s1:]
n_ok += 1

# 3. マスタ読込：読めなければ何もしない／版更新はロックの中で1回だけ
rep('''      let m = await sGet("master");
      // 未保存、または古い版の初期データしか入っていない場合は最新の初期データに差し替える
      if (!m || !m.staff || m.staff.length === 0 || (m.seedVersion || 0) < SEED_VERSION) {
        // 丸ごと上書きせず、アプリ画面での追加・変更を残したままseedを取り込む
        const before = m && m.staff ? m.staff.length : 0;
        m = mergeSeedMaster(m, seedMaster());
        await sSet("master", m);''', '''      let m = await sGet("master");
      if (sLoadFailed("master")) return; // 読めなかったときは初期データで上書きしない(障害A)。画面上部に警告が出る
      // 未保存、または古い版の初期データしか入っていない場合は最新の初期データに差し替える
      if (!m || !m.staff || m.staff.length === 0 || (m.seedVersion || 0) < SEED_VERSION) {
        // 丸ごと上書きせず、アプリ画面での追加・変更を残したままseedを取り込む
        // 複数の端末が同時に開いても1回だけ行うよう、ロックの中で読み直してから更新する
        const before = m && m.staff ? m.staff.length : 0;
        m = await sUpdate("master", (cur) => ((!cur || !cur.staff || cur.staff.length === 0 || (cur.seedVersion || 0) < SEED_VERSION) ? mergeSeedMaster(cur, seedMaster()) : cur));''', label="master")
rep('''          const cur = await sGet(`pattern:${wd}`);
          const empty = !cur || (!(cur.runs || []).length && !(cur.blocks || []).length);
          if (empty) await sSet(`pattern:${wd}`, resolveSeedPattern(m, SEED_PATTERNS[key]));''', '''          await sUpdate(`pattern:${wd}`, (cur) => {
            const empty = !cur || (!(cur.runs || []).length && !(cur.blocks || []).length);
            return empty ? resolveSeedPattern(m, SEED_PATTERNS[key]) : cur;
          });''', label="seedpat")
rep('''      setMaster(m);
    })();
  }, []);
''', '''      setMaster(m);
    })();
  }, []);
  // 他の人がマスタを変えたら、開いている画面にもすぐ反映する
  useEffect(() => {
    if (!master) return;
    return sWatch("master", (v, info) => {
      if (v && v.staff) setMaster(v);
      if (info && info.conflicts) notify(`マスタの同じ項目を他の人も変更していました(${info.conflicts}か所)。後から保存した内容を残しています`, "warn");
    });
  }, [master ? 1 : 0]);
''', label="masterwatch")

# 4. 日別シート：読めなければ空の表を作らない＋リアルタイム取り込み＋カレンダー反映
rep('''      const s = await sGet(`sheet:${date}`);
      if (!alive) return;
      setSheet(s || emptySheet());''', '''      const s = await sGet(`sheet:${date}`);
      if (!alive) return;
      if (sLoadFailed(`sheet:${date}`)) return; // 読めなかった日は空の表を作らない(障害A)
      setSheet(s || emptySheet());''', label="sheetload")
rep('''  const updateSheet = (fn, opt) =>''', '''  // 他の人がこの日の送迎表を変えたら、開いている画面にもすぐ反映する(自分の未送信の編集は残したまま統合)
  useEffect(() => {
    if (!master) return;
    return sWatch(`sheet:${date}`, (v, info) => {
      if (!v) return;
      histRef.current.sheet = { past: [], future: [] }; // 他の人の変更を「戻る」で消さないよう履歴は区切る
      setHistTick((x) => x + 1);
      setSheet(v); setSheetExists(true);
      if (info && info.conflicts) notify(`同じ便・予定を他の人も変更していました(${info.conflicts}か所)。後から保存した内容を残しています`, "warn");
    });
  }, [date, master ? 1 : 0]);
  // カレンダーの予定(職員の休み・予定、利用者の欠席・時間変更)を読み込む
  useEffect(() => {
    if (!master || !window.__sgWatchCalendar) return;
    setCalEvents({ date: null, list: [] });
    return window.__sgWatchCalendar(date, (list) => setCalEvents({ date, list }));
  }, [date, master ? 1 : 0]);
  // カレンダーの予定をこの日の送迎表に反映(予定の変更・削除で自動的に取り消し)。読み込めていない間は何もしない
  useEffect(() => {
    if (!master || !sheet || !window.SGCal || calEvents.date !== date) return;
    const next = window.SGCal.reconcile(master, sheet, calEvents.list, date);
    if (next === sheet) return;
    setSheet(next);
    // 保存はしない：サーバーが送迎表を保存するたびに、最新のカレンダーをロックの中で当てはめる
    // (古いカレンダーの一覧で上書きして、休みが消えたり戻ったりするのを防ぐ)
  }, [sheet, calEvents, master, date, sheetExists]);

  const updateSheet = (fn, opt) =>''', label="sheetwatch")

# 5. 週間パターン
rep('''      let p = await sGet(`pattern:${weekday}`);
      if (!alive) return;
      // 未作成または空の曜日は、初期パターン(月=1/火=2/金=5)があれば自動投入''', '''      let p = await sGet(`pattern:${weekday}`);
      if (!alive) return;
      if (sLoadFailed(`pattern:${weekday}`)) return; // 読めなかった曜日は初期パターンで上書きしない
      // 未作成または空の曜日は、初期パターン(月=1/火=2/金=5)があれば自動投入''', label="patload")
rep('''          p = resolveSeedPattern(master, SEED_PATTERNS[seedKey]);
          await sSet(`pattern:${weekday}`, p);''', '''          const seeded = resolveSeedPattern(master, SEED_PATTERNS[seedKey]);
          p = await sUpdate(`pattern:${weekday}`, (cur) => ((!cur || (!(cur.runs || []).length && !(cur.blocks || []).length)) ? seeded : cur));''', label="patseed")
rep('''  const updatePattern = (fn, opt) =>''', '''  useEffect(() => {
    if (!master || tab !== "pattern") return;
    return sWatch(`pattern:${weekday}`, (v, info) => {
      if (!v) return;
      histRef.current.pattern = { past: [], future: [] };
      setHistTick((x) => x + 1);
      setPattern(v);
      if (info && info.conflicts) notify(`パターンの同じ箇所を他の人も変更していました(${info.conflicts}か所)。後から保存した内容を残しています`, "warn");
    });
  }, [weekday, tab, master ? 1 : 0]);

  const updatePattern = (fn, opt) =>''', label="patwatch")

# 6. パターンから読込：同じパターンを2人が同時に読み込んでも便が重複しないよう、IDをパターン由来で決める
rep('''      runs: remapRetired(master, date, (p.runs || []).map((r) => ({ ...r, id: uid() }))),
      blocks: remapRetired(master, date, (p.blocks || []).map((b) => ({ ...b, id: uid() }))),''', '''      runs: remapRetired(master, date, (p.runs || []).map((r) => ({ ...r, id: r.id ? `${r.id}@${date}` : uid() }))),
      blocks: remapRetired(master, date, (p.blocks || []).map((b) => ({ ...b, id: b.id ? `${b.id}@${date}` : uid() }))),''', label="loadpat")
rep('''        p = resolveSeedPattern(master, SEED_PATTERNS[seedKey]);
        await sSet(`pattern:${wd}`, p);''', '''        const seeded = resolveSeedPattern(master, SEED_PATTERNS[seedKey]);
        p = await sUpdate(`pattern:${wd}`, (cur) => ((!cur || (!(cur.runs || []).length && !(cur.blocks || []).length)) ? seeded : cur));''', label="loadpatseed")

# 7. 保存状態の表示 → 実態と一致する表示(保存エンジンの状態)＋カレンダー
rep('''          <div className="text-xs">
            {saveState === "saving" && <span className="text-stone-400">保存中…</span>}
            {saveState === "saved" && <span className="text-emerald-600">✓ 保存済み(全員に共有)</span>}
            {saveState === "error" && <span className="text-rose-600 font-bold">⚠ 保存できませんでした。通信環境を確認してください</span>}
          </div>''', '''          <div className="text-xs flex items-center gap-2 flex-wrap">
            <CalBadge master={master} sheet={sheet} calEvents={calEvents} date={date} />
            <SyncBadge />
          </div>''', label="badge")

# 8. ブロックされる確認ダイアログ(画面内に警告が出ているので不要)
rep('''              if (result.srcWd != null && weekday != null && result.srcWd !== weekday) {
                const ok = window.confirm(`読み込んだファイルは${DAYS[result.srcWd]}曜${result.srcDate ? `(${result.srcDate})` : ""}の送迎表ですが、取り込み先は${DAYS[weekday]}曜です。\\n曜日が違いますが取り込みますか?`);
                if (!ok) return;
              }
              onApply(result);''', '''              // 曜日が違う場合は上の赤い警告で確認済み(このボタンが確定操作)
              onApply(result);''', label="confirm")

# 9. 復元：送信完了を待ってから再読み込み
rep('''                  notify(`${n}件のデータを復元しました。画面を再読み込みします…`);''', '''                  notify(`${n}件のデータを復元し、全員に共有しました。画面を再読み込みします…`);''', label="restore")

# 10. 同期状態とカレンダーのバッジ(App の直前に追加)
rep('''export default function App() {''', r'''// ===== 保存状況(実態と一致させる：サーバーで反映を確認するまで「保存済み」にしない) =====
function useKVStatus() {
  const [, setTick] = useState(0);
  useEffect(() => { let off = null; kvReady.then((kv) => { off = kv.on(() => setTick((x) => x + 1)); setTick((x) => x + 1); }); return () => off && off(); }, []);
  return KV ? KV.status() : null;
}
function SyncBadge() {
  const st = useKVStatus();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  useEffect(() => { const a = () => setOnline(true), b = () => setOnline(false); window.addEventListener("online", a); window.addEventListener("offline", b); return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); }; }, []);
  if (!st) return <span className="text-stone-400">接続中…</span>;
  const issues = st.blocked + st.failed;
  let cls = "border-emerald-300 text-emerald-700 bg-emerald-50", txt = "✓ 保存済み(全員に共有)";
  if (st.paused) { cls = "border-rose-400 text-rose-700 bg-rose-50 font-bold"; txt = st.paused === "outdated_client" ? "⚠ 新しい版があります。再読み込みしてください" : "⚠ 送信を停止中"; }
  else if (st.loadFailedKeys.length) { cls = "border-rose-400 text-rose-700 bg-rose-50 font-bold"; txt = "⚠ 読み込めなかったデータがあります"; }
  else if (issues) { cls = "border-rose-400 text-rose-700 bg-rose-50 font-bold"; txt = `⚠ 要確認 ${issues}件`; }
  else if (st.queued) { const waiting = !online || st.lastError; cls = waiting ? "border-amber-400 text-amber-800 bg-amber-50 font-bold" : "border-stone-300 text-stone-500 bg-white"; txt = waiting ? `未送信 ${st.queued}件：自動で再送します` : `送信中 ${st.queued}件…`; }
  else if (!online) { cls = "border-amber-400 text-amber-800 bg-amber-50"; txt = "オフライン"; }
  return (
    <>
      <button className={`px-2 py-0.5 rounded-full border ${cls}`} onClick={() => setOpen(true)} title="保存と同期の状況">{txt}</button>
      {open && <SyncPanel onClose={() => setOpen(false)} online={online} />}
    </>
  );
}
function SyncPanel({ onClose, online }) {
  const st = useKVStatus();
  const [confirmKey, setConfirmKey] = useState(null);
  if (!st) return null;
  const list = KV.entries().filter((e) => e.state !== "queued");
  const nameOf = (k) => { const s = String(k).replace(/^v\d+:/, ""); if (s === "master") return "職員・利用者・車のマスタ"; if (s.startsWith("sheet:")) return `${s.slice(6)} の送迎表`; if (s.startsWith("pattern:")) return `週間パターン(${DAYS[Number(s.slice(8))] || s.slice(8)}曜)`; if (s.startsWith("libSvcCsv")) return "リベCSV"; return s; };
  const why = (e) => e.state === "blocked" ? "読み込めなかった間に編集された内容です。そのまま送ると、読めなかった本来の内容を上書きするおそれがあるため止めています。" : ({ invalid_argument: "権限がないため保存できませんでした。", quota_exceeded: "保存できる量の上限に達しました。管理者に連絡してください。", too_large: "データが大きすぎて保存できません。" }[e.info && e.info.code] || "送信できませんでした。");
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b"><b>保存と同期の状況</b><button className="px-2 text-lg" onClick={onClose} aria-label="閉じる">×</button></div>
        <div className="p-4 space-y-3">
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-stone-500">通信</dt><dd>{online ? "オンライン" : "オフライン"}</dd>
            <dt className="text-stone-500">未送信</dt><dd>{st.queued}件{st.queued ? (st.lastError ? `(${Math.round(st.retryDelay / 1000)}秒ごとに自動で再送)` : "(送信中)") : ""}</dd>
            <dt className="text-stone-500">端末への一時保存</dt><dd>{st.persistent ? "有効(画面を閉じても未送信は消えません)" : "使えません(画面を閉じると未送信が消えます)"}</dd>
            <dt className="text-stone-500">アプリの版</dt><dd>{`v${SEED_VERSION}`}・{EDITION_LABEL}・保存形式{KV.SCHEMA}</dd>
          </dl>
          {st.loadFailedKeys.length > 0 && <div className="p-2 rounded border border-rose-300 bg-rose-50 text-rose-800 text-[13px]">読み込めなかったデータ: {st.loadFailedKeys.map(nameOf).join("、")}。この間の内容は保存しません。通信を確認して再読み込みしてください。</div>}
          <div className="flex gap-2 flex-wrap">
            <button className="px-3 py-1 rounded border border-stone-300 disabled:opacity-40" disabled={!st.queued} onClick={() => KV.resume()}>今すぐ再送</button>
            <button className="px-3 py-1 rounded border border-stone-300" onClick={() => { try { window.location.reload(); } catch (e) {} }}>最新版を読み込み直す</button>
          </div>
          {list.length === 0 ? <p className="text-stone-500 text-[13px]">確認が必要な保存はありません。</p> : list.map((e) => (
            <div key={e.key} className="border rounded p-3 space-y-2">
              <div className="font-bold">{nameOf(e.key)}</div>
              <p className="text-[12px] text-stone-600">{why(e)}</p>
              {confirmKey === e.key ? (
                <div className="flex gap-2 flex-wrap items-center"><span className="text-[12px]">この編集を取り消します。元には戻せません。</span><button className="px-3 py-1 rounded bg-rose-600 text-white" onClick={() => { KV.discard(e.key); setConfirmKey(null); }}>取り消す</button><button className="px-3 py-1 rounded border" onClick={() => setConfirmKey(null)}>やめる</button></div>
              ) : e.state === "blocked" ? (
                <div className="flex gap-2 flex-wrap">
                  <button className="px-3 py-1 rounded border border-stone-300" onClick={() => setConfirmKey(e.key)}>この編集を取り消す(推奨)</button>
                  <button className="px-3 py-1 rounded border border-stone-300" onClick={() => KV.unite(e.key)}>サーバーの内容と合わせて保存</button>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <button className="px-3 py-1 rounded bg-sky-600 text-white" onClick={() => KV.retry(e.key)}>もう一度送る</button>
                  <button className="px-3 py-1 rounded border border-stone-300" onClick={() => setConfirmKey(e.key)}>取り消す</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
// ===== カレンダーから反映中の予定 =====
function CalBadge({ master, sheet, calEvents, date }) {
  const [open, setOpen] = useState(false);
  const items = master && window.SGCal && calEvents.date === date ? window.SGCal.summary(master, sheet, calEvents.list, date) : [];
  return (
    <>
      <button className="px-2 py-0.5 rounded-full border border-violet-300 text-violet-800 bg-violet-50" onClick={() => (items.length ? setOpen(true) : window.__sgOpenCalendar && window.__sgOpenCalendar(date))}
        title="カレンダーに入力された休み・予定・欠席・時間変更をこの日の送迎表に反映しています">📅 カレンダー{items.length ? ` 反映${items.length}件` : ""}</button>
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-3" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b"><b>{date} にカレンダーから反映中</b><button className="px-2 text-lg" onClick={() => setOpen(false)} aria-label="閉じる">×</button></div>
            <div className="p-4 space-y-2">
              <p className="text-[12px] text-stone-500">変更・取り消しはカレンダーで行ってください。カレンダーの予定を消すと、送迎表からも自動で外れます。</p>
              {items.map((it) => (
                <div key={it.id} className="border rounded p-2">
                  <div className="text-[11px] text-violet-700 font-bold">{it.typeLabel}</div>
                  <div className="font-bold">{it.title}</div>
                  <div className="text-[12px] text-stone-600">{it.who.join("、") || "(対象者なし)"}・{it.time}</div>
                  {it.missing.length > 0 && <div className="text-[12px] text-rose-700">送迎表に見つからない名前: {it.missing.join("、")}(反映されていません)</div>}
                </div>
              ))}
              <button className="px-3 py-1 rounded bg-violet-600 text-white" onClick={() => { setOpen(false); window.__sgOpenCalendar && window.__sgOpenCalendar(date); }}>カレンダーを開く</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {''', label="components")

# 11. AI調整：外部APIへの直接接続は使えないため、閲覧画面のClaude呼び出し(sample)を使う
rep('''        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, messages: msgs }),
        });
        const dataRes = await res.json();
        if (dataRes.error) throw new Error(dataRes.error.message || "APIエラー");''', '''        const sampler = window.claude && window.claude.use ? await window.claude.use("sample") : null;
        if (!sampler) throw new Error("この画面ではAI調整が使えません(claude.aiで開き、AIの利用を許可してください)");
        let sres;
        try { sres = await sampler(msgs, { modelTier: "default", cache: false }); }
        catch (e9) { throw new Error(e9 && e9.code === "rate_limited" ? "AIの利用が混み合っています。少し待ってからもう一度試してください" : e9 && e9.code === "not_granted" ? "AIの利用が許可されていません" : "AIに接続できませんでした"); }
        const dataRes = { content: [{ type: "text", text: sres.text || "" }], stop_reason: sres.truncated ? "max_tokens" : "end_turn" };''', label="ai")

open(os.environ.get("OUT", "app2.jsx"), "w", encoding="utf-8").write(src)
print("patched", n_ok)
