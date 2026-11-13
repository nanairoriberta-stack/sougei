/* シフト表（マンション職員の早番・遅番・日勤）の画面。?page=shift
   写真の紙のシフト表と同じ形：月のマス目に 早①②③・遅①②③・日勤・休み、下に職員ごとの曜日のパターンと今月の希望。
   組む人（「職員ID」G列・管理者）は枠を入れる・基本パターンで下書き・空きを見てLINE文を作る・設定。表の職員は自分の希望だけ。
   変更はすぐ端末に残し（sh:pend:…）、サーバーではロックの中で3者マージして保存（ほかの人の変更を消さない） */
(function () {
  "use strict";
  const H = window.SGHost, X = window.SGShift;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clone = (x) => JSON.parse(JSON.stringify(x == null ? null : x));
  const pad = (n) => String(n).padStart(2, "0");
  const today = new Date(), thisYm = /^\d{4}-\d{2}-\d{2}$/.test(window.__SG_DATE || "") ? window.__SG_DATE.slice(0, 7) : `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;   // ?d= があればその月
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  // 男性の表は、?d= が無ければ翌月から開く（2026-11-07 依頼者「男性は希望を入れる画面は翌月をデフォルトに」）
  const nextYm = (() => { const d = new Date(today.getFullYear(), today.getMonth() + 1, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })(), hasD = /^\d{4}-\d{2}-\d{2}$/.test(window.__SG_DATE || "");
  const S = { group: store.get("sh:group") === "f" ? "f" : "m", ym: store.get("sh:group") !== "f" && !hasD ? nextYm : thisYm, loaded: false, err: "", canEdit: false, member: false,
    cfg: null, cfgBase: null, month: null, monthBase: null, mode: "shift", wishWho: "", withNames: true, saving: 0, failed: "", pick: null, settings: null, showLine: false };
  const me = () => H.me || {};
  const cfg = () => X.cfgOf(S.group, S.cfg);
  const pendKey = (kind) => `sh:pend:${S.group}:${S.ym}:${kind}`;

  /* ---------- 読み込み・保存 ---------- */
  async function load(quiet) {
    if (!quiet) { S.loaded = false; S.err = ""; render(); }
    try {
      const r = await H.call("shift.get", { group: S.group, ym: S.ym });
      S.canEdit = r.canEdit; S.member = r.member; S.myName = r.myName || me().name;
      S.cfgBase = r.cfg.value; S.monthBase = r.month.value;
      // まだ送れていない変更が端末に残っていれば、それを重ねて送り直す（通信が切れても消えない）
      const pc = store.get(pendKey("cfg")), pm = store.get(pendKey("month"));
      S.cfg = pc ? JSON.parse(pc).mine : clone(r.cfg.value);
      S.month = pm ? JSON.parse(pm).mine : clone(r.month.value) || {};
      if (!S.wishWho || !cfg().members.some((m) => m.name === S.wishWho)) S.wishWho = cfg().members.some((m) => m.name === S.myName) ? S.myName : ((cfg().members[0] || {}).name || "");
      if (!S.canEdit) S.mode = "wish";
      S.loaded = true;
      if (pc) save("cfg", JSON.parse(pc).base, pendKey("cfg")); if (pm) save("month", JSON.parse(pm).base, pendKey("month"));
      // まだ当てていない希望（新しい版の前に入った希望など）に合わせて枠を空ける。組む人の画面で開いたときだけ（2026-11-11 依頼者「きえてないよ」）
      if (S.canEdit && !pm && S.month && !S.month.hidden) { const f = X.fitPending(S.month, S.ym); if (f !== S.month) { S.month = f; changed("month"); } }
      if (!S.resent) { S.resent = true; setTimeout(resendAll, 1500); }
    } catch (e) { S.err = (e && e.message) || "読み込めませんでした。通信を確かめて、もう一度開いてください"; S.loaded = false; }
    render();
  }
  const timers = {}, inflight = {}, again = {};
  // 送る先（男性/女性・月）は変更したときの表で決める。送っている間に月や男女を切り替えても、別の月の分と混ざらない
  // （2026-11-07 実機「未送信（自動で送り直します）：null is not an object (evaluating 'q.mine')」＝送っている間に12月へ切り替えて、11月の分を12月の名前で探していた）
  function changed(kind) {
    const base = kind === "cfg" ? S.cfgBase : S.monthBase, mine = kind === "cfg" ? S.cfg : S.month, key = pendKey(kind), g = S.group, ym = S.ym;
    const prev = store.get(key);
    store.set(key, JSON.stringify({ base: prev ? JSON.parse(prev).base : base, mine, g, ym, kind }));   // まず端末に残す（どの表のどの月か も一緒に）
    render(); clearTimeout(timers[key]); timers[key] = setTimeout(() => save(kind, undefined, key), 500);
  }
  async function save(kind, baseOverride, keyArg) {
    const key = keyArg || pendKey(kind);
    if (inflight[key]) { again[key] = true; return; }   // 同じ分を同時に2回送らない（終わってから送り直す）
    const raw = store.get(key); if (!raw) return;
    const p = JSON.parse(raw), base = baseOverride !== undefined ? baseOverride : p.base;
    const km = /^sh:pend:(m|f):(\d{4}-\d{2}):(cfg|month)$/.exec(key) || [];   // 以前の端末の分は、名前から男女・月を読む
    const g = p.g || km[1] || S.group, ym = p.ym || km[2] || S.ym, here = () => g === S.group && ym === S.ym;
    inflight[key] = true; S.saving++; render();
    try {
      const r = await H.call("shift.save", { group: g, ym, kind, base, baseKnown: true, mine: p.mine });
      const now = store.get(key);
      if (!now || now === raw) {   // 送った後に変わっていない（または別の送信で済んだ）
        store.del(key);
        if (here()) { if (kind === "cfg") { S.cfgBase = r.value; S.cfg = clone(r.value); } else { S.monthBase = r.value; S.month = clone(r.value); } }
      } else {                      // 送っている間にさらに直した → その分を、今の内容を土台にして続けて送る
        const q = JSON.parse(now); store.set(key, JSON.stringify(Object.assign({}, q, { base: r.value })));
        if (here()) { if (kind === "cfg") S.cfgBase = r.value; else S.monthBase = r.value; }
        again[key] = true;
      }
      S.failed = "";
      if (r.calLeft > 0) calSync(g, ym);   // はじめての月など、カレンダーへの書き込みが残っていれば続けて頼む
    } catch (e) { S.failed = ((e && e.message) || "保存できませんでした") + (e && e.code ? `［${e.code}］` : ""); setTimeout(() => save(kind, undefined, key), 15000); }
    inflight[key] = false; S.saving--;
    if (again[key]) { again[key] = false; setTimeout(() => save(kind, undefined, key), 50); }
    render();
  }
  // 端末に残っている、ほかの月・男女の送れていない分も送る（開いたとき）
  function resendAll() {
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k || !k.startsWith("sh:pend:")) continue; const km = /^sh:pend:(m|f):(\d{4}-\d{2}):(cfg|month)$/.exec(k); if (km) save(km[3], undefined, k); } } catch (e) {}
  }
  // シフト表 → 職場カレンダー：残りを少しずつ書く（2026-11-07）。失敗しても次に保存したときにまた書く
  let syncing = false;
  async function calSync(g, ym) {
    if (syncing) return; syncing = true; S.calSyncing = true; render();
    try { for (let i = 0; i < 20; i++) { const r = await H.call("shift.syncCal", { group: g || S.group, ym: ym || S.ym }); if (!r || !(r.left > 0)) break; } } catch (e) {}
    syncing = false; S.calSyncing = false; render();
  }
  const pendingCount = () => ["cfg", "month"].filter((k) => store.get(pendKey(k))).length;

  /* ---------- 枠・希望の変更 ---------- */
  const dayObj = (date) => { S.month = S.month || {}; S.month.days = S.month.days || {}; return (S.month.days[date] = Object.assign({ e: {}, l: {}, d: [] }, S.month.days[date] || {})); };
  function setSlot(date, k, i, name, t) {
    const d = dayObj(date); d[k] = Object.assign({}, d[k]);
    // 同じ日の同じ番（例：遅番）のほかの枠にいる人を選んだら入れ替える（2026-11-07 依頼者「遅番①と③の人を入れ替えたい」）。時間の補足はそれぞれの人に付いていく
    const other = name ? Object.keys(d[k]).find((j) => Number(j) !== Number(i) && X.slotName(d[k][j]) === name) : null;
    if (other) { const mine = d[k][i], theirs = d[k][other]; d[k][i] = theirs; if (X.slotName(mine)) d[k][other] = mine; else delete d[k][other]; changed("month"); toast(`${X.KIND[k]}${X.MARK[i] || i}と${X.KIND[k]}${X.MARK[other] || other}を入れ替えました`); return; }
    if (name) d[k][i] = t ? { n: name, t } : { n: name }; else delete d[k][i];
    changed("month");
  }
  // 基本シフトを変える（設定に保存。曜日ごと）
  function setBase(wd, fn) { const c = clone(cfg()); c.base = Object.assign({}, c.base); const b = Object.assign({ e: [], l: [], d: [] }, c.base[wd]); fn(b); c.base[wd] = b; S.cfg = c; changed("cfg"); }
  function setDayWorkers(date, names) { dayObj(date).d = names; changed("month"); }
  // 希望はボタンで選んでから日付を押す（2026-11-07 依頼者「休みや勤務をボタン式に。早番・遅番・マンション早のみなど＋その他で任意の時間」）。
  // 同じ希望の日をもう一度押すと消える。「消す」を選んで押しても消える。その他は「9:00~15:00」のように時刻で持つ
  const WISH_BTNS = [["休", "休み"], ["AM休", "AM休"], ["PM休", "PM休"], ["早", "早番"], ["遅", "遅番"], ["日", "日勤"], ["早ﾏﾝのみ", "早ﾏﾝｼｮﾝのみ"], ["遅ﾏﾝのみ", "遅ﾏﾝｼｮﾝのみ"], ["time", "その他(時刻)"], ["", "消す"]];
  S.pen = "休"; S.penFrom = ""; S.penTo = "";
  const penValue = () => S.pen === "time" ? (S.penFrom && S.penTo ? `${S.penFrom.replace(/^0/, "")}~${S.penTo.replace(/^0/, "")}` : S.penFrom ? `${S.penFrom.replace(/^0/, "")}~` : "") : S.pen;
  function cycleWish(date, noToggle) {
    const who = S.wishWho; if (!who || !date) return;
    const v = penValue(); if (S.pen === "time" && !v) { alert("その他は、時刻（何時から）を入れてから入れてください"); return; }
    S.month = S.month || {}; S.month.wish = Object.assign({}, S.month.wish); const w = Object.assign({}, S.month.wish[who]);
    if (!v || (!noToggle && w[date] === v)) delete w[date]; else w[date] = v;
    S.month.wish[who] = w;
    S.month = X.fitPending(S.month, S.ym);   // 希望に合わない番の枠を空ける（日勤の希望なら早番・遅番から外して日勤へ）。サーバーでも同じことをする
    changed("month");
  }
  // かんたん入力：職員・日にち・希望を選んで「入れる」（2026-11-07 依頼者「職員、何日、どの休みか出勤形態かをシンプルに選択だけで」）
  const wishText = (v) => ({ "休": "休み", "早": "早番", "遅": "遅番", "日": "日勤", "早ﾏﾝのみ": "早ﾏﾝｼｮﾝのみ", "遅ﾏﾝのみ": "遅ﾏﾝｼｮﾝのみ" })[v] || v;

  /* ---------- 描く ---------- */
  function render() {
    const root = $("shRoot"); if (!root) return;
    const c = cfg();
    const status = S.failed ? `<span class="st bad" data-sh-failed title="${esc(S.failed)}">未送信（自動で送り直します）：${esc(S.failed)}</span>` : S.saving || pendingCount() ? `<span class="st busy">保存中…</span>` : S.loaded ? `<span class="st ok">保存済み ✓${S.calSyncing ? "（カレンダーに反映中…）" : ""}</span>` : "";
    const [y, m] = S.ym.split("-").map(Number);
    let html = `<header class="sh-bar"><div class="sh-title">${esc(c.title)}</div>
      <nav class="sh-tabs">${Object.entries(X.GROUPS).map(([k, n]) => `<button data-group="${k}" aria-pressed="${S.group === k}">${n}</button>`).join("")}</nav>
      ${H.url("") ? `<button class="sh-cal" data-act="calendar" title="職場カレンダーに戻る">📅 カレンダー</button>` : ""}<div class="sh-month"><button data-mon="-1" aria-label="前の月">‹</button><b>${y}年${m}月</b><button data-mon="1" aria-label="次の月">›</button></div>${status}</header>`;
    if (S.err) { root.innerHTML = html + `<p class="sh-err">${esc(S.err)}</p>`; return; }
    if (!S.loaded) { root.innerHTML = html + `<p class="sh-wait">読み込んでいます…</p>`; return; }
    html += `<div class="sh-tools">` + (S.canEdit ? `<span class="seg"><button data-mode="shift" aria-pressed="${S.mode === "shift"}">シフトを組む</button><button data-mode="wish" aria-pressed="${S.mode === "wish"}">希望を入れる</button></span>
      <button data-act="auto" class="primary" data-auto title="希望が出そろったら押してください。基本パターン・決まり・希望・遅番の次の日は早番にしない、を見て、空いている枠を埋めます（手で入れた枠はそのまま）">🤖 シフトを自動で作る</button>
      <button data-act="draft" title="職員ごとの曜日のパターン（下の表）と希望から、空いている枠だけを埋めます">基本パターンで下書き</button>
      <button data-act="line" class="primary">空きを見てLINE文を作る</button><button data-act="excel" data-excel title="この月のシフト表を、紙と同じカレンダーの形でExcelに出します（A4横）">Excelで出力</button><button data-act="settings">設定（職員・枠の数）</button>` : `<span class="note">あなたの希望を入れられます（日付を押すたびに 休→PM休→AM休→早→遅→日→なし）</span>`) + `</div>`;
    if (S.mode === "wish") html += `<div class="sh-wishbar">希望を入れる人：${S.canEdit ? `<select id="shWho">${c.members.map((x) => `<option ${x.name === S.wishWho ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : `<b>${esc(S.wishWho)}</b>`}
      <span class="note">日付のマスを押すと、休み・早番などを選べます</span>
      <div class="wlist" data-wish-list>${(() => { const w = ((S.month && S.month.wish) || {})[S.wishWho] || {}, ds = Object.keys(w).sort();
        return ds.length ? ds.map((d) => `<span class="wi">${esc(X.label(d))} ${esc(wishText(w[d]))}${S.canEdit || S.wishWho === S.myName ? `<button type="button" data-wish-del="${d}" aria-label="消す">×</button>` : ""}</span>`).join("") : `<span class="note">${esc(S.wishWho)}さんの今月の希望はまだありません</span>`; })()}</div>
      <label class="wn">ひとこと：<input id="shWishNote" maxlength="80" value="${esc(((S.month && S.month.wishNote) || {})[S.wishWho] || "")}" placeholder="例：13〜17日 旅行"></label></div>`;
    // シフトの確定（2026-11-07 依頼者「管理者以外は確定までは見えないように。最終確定ボタン」）
    // 男性の表は、表の職員には希望を入れる画面だけ（2026-11-10 依頼者「男性の希望休のカレンダーは希望を入れる画面のみに」）。勤務は職場カレンダーで見る
    const wishOnly = !S.canEdit && S.group === "m";
    const fixed = X.isFixed(S.month, S.ym), hidden = wishOnly || (!S.canEdit && (!!(S.month && S.month.hidden) || !fixed)), fx = (S.month && S.month.fixed) || null;
    if (S.canEdit) html += fixed ? `<div class="sh-fix on" data-fix="on">✅ この月のシフトは<b>確定</b>しています（表の職員にも見え、職場カレンダーにも出ます）${fx && fx.at ? `<small>${esc(String(fx.at).slice(5, 10).replace("-", "/"))} ${esc(fx.by || "")}</small>` : ""}<button data-act="unfix">確定を取り消す</button></div>`
      : `<div class="sh-fix" data-fix="off">この月のシフトは<b>まだ確定していません</b>。組む人（管理者など）だけに見えています。表の職員には希望だけが見え、職場カレンダーにも出ません。<button data-act="fix" class="primary" data-fix-btn>✅ このシフトで確定する</button></div>`;
    else if (hidden && !wishOnly) html += `<div class="sh-fix" data-unfixed>この月のシフトはまだ確定していません。確定すると、ここに勤務が出ます（今は希望だけ入れられます）。</div>`;
    const hs = X.holes(S.month, c, S.ym), holeSet = new Set(hs.map((h) => `${h.date}|${h.kind}|${h.idx}`));
    const conf = X.conflicts(S.month, c, S.ym), confSet = new Set(conf.map((x) => `${x.date}|${x.name}`));
    const le = X.lateEarly(S.month, c, S.ym), leSet = new Set(le.map((x) => `${x.date}|e|${x.slot}`)), leFix = le.length ? X.fixLateEarly(S.month, c, S.ym) : { fixed: [], left: [] };
    const ri = X.ruleIssues(S.month, c, S.ym), riSet = new Set(ri.map((x) => `${x.date}|${x.kind}|${x.now}`));
    const ngI = X.ngIssues(S.month, c, S.ym), ngSet = new Set(ngI.map((x) => `${x.date}|${x.kind}|${x.slot}`));   // NGの条件とちがう枠（2026-11-13）
    const days = X.daysOfMonth(S.ym), lead = (X.wdOf(days[0]) + 6) % 7;   // 月曜始まり（2026-11-07 依頼者）
    if (!hidden) html += `<div class="sh-legend" data-legend><span class="e">赤＝早番</span>・<span class="l">青＝遅番</span>（①②③は番号）</div>`;
    // 希望を入れるだけの画面（男性の表の職員）はマスの高さをそろえて押しやすく（2026-11-13 依頼者「スマホで日付が縦にすごく狭くて打ちづらい」。.wo）。スマホの見出しは「月」だけ
    html += `<table class="sh-grid${wishOnly ? " wo" : ""}"><thead><tr>${[1, 2, 3, 4, 5, 6, 0].map((i) => `<th class="${i === 0 ? "su" : i === 6 ? "sa" : ""}">${X.WD[i]}<span class="wdx">曜日</span></th>`).join("")}</tr></thead><tbody>`;
    const cells = Array(lead).fill(null).concat(days);
    while (cells.length % 7) cells.push(null);
    for (let r = 0; r < cells.length; r += 7) {
      html += "<tr>" + cells.slice(r, r + 7).map((date) => {
        if (!date) return `<td class="empty"></td>`;
        const d = X.daysOfMonth ? (S.month && S.month.days || {})[date] || {} : {}, need = X.needOf(c, date);
        const slot = (k, i) => { const s = (d[k] || {})[i], n = X.slotName(s), hole = holeSet.has(`${date}|${k}|${i}`), bad = n && confSet.has(`${date}|${n}`);
          return `<button class="slot ${k}${hole ? " hole" : ""}${bad ? " bad" : ""}${riSet.has(`${date}|${k}|${i}`) ? " rule" : ""}${leSet.has(`${date}|${k}|${i}`) ? " turn" : ""}${ngSet.has(`${date}|${k}|${i}`) ? " ng" : ""}" data-slot="${date}|${k}|${i}" ${S.mode === "wish" ? "tabindex=-1" : ""}><i><b class="kk">${X.KIND[k]}</b>${X.MARK[i] || i}</i>${n ? esc(n) + (s && s.t ? `<small>(${esc(s.t)})</small>` : "") : hole ? "空き" : ""}</button>`; };
        const maxE = Math.max(need.e, ...Object.keys(d.e || {}).map(Number), 0), maxL = Math.max(need.l, ...Object.keys(d.l || {}).map(Number), 0);
        const rows = Math.max(maxE, maxL);
        let grid = "";   // スマホでは早番（赤）・遅番（青）を1列に並べ、名前が見えるようにする（2026-11-07 依頼者「スマホだと名前わからない」）
        if (!hidden) for (let i = 1; i <= rows; i++) grid += `<div class="pair">${i <= maxE ? slot("e", i) : `<span></span>`}${i <= maxL ? slot("l", i) : `<span></span>`}</div>`;
        const wishes = c.members.map((x) => [x.name, X.wishOf(S.month, x.name, date)]).filter((x) => x[1]);
        const off = X.offList(S.month, c, date);
        const wd = X.wdOf(date);
        return `<td class="day${wd === 0 ? " su" : wd === 6 ? " sa" : ""}${S.mode === "wish" ? " wishmode" : ""}" data-day="${date}"><div class="dnum">${Number(date.slice(8))}${d.note ? `<span class="dnote">${esc(d.note)}</span>` : ""}</div><div class="slots">${grid}</div>
          ${hidden ? "" : `<div class="line"><button class="dk" data-dk="${date}" ${S.mode === "wish" ? "tabindex=-1" : ""}>日勤：${esc((d.d || []).join("、"))}</button></div>
          <div class="line off">休み：${off.map((n) => `<span class="${X.wishOf(S.month, n, date) ? "w" : ""}">${esc(n)}</span>`).join("、")}</div>`}
          ${wishes.length ? `<div class="line wish">希望：${wishes.map(([n, w]) => `<span class="${/休/.test(w) ? "woff" : ""}">${esc(n)} ${esc(w)}</span>`).join("、")}</div>` : ""}</td>`;
      }).join("") + "</tr>";
    }
    html += `</tbody></table>`;
    // 基本シフト（曜日ごとに 早①②③・遅①②③・日勤 がだれか。依頼者の表と同じ並び：月〜日）。下書きはこの番号どおりに入る
    const WEEK = [1, 2, 3, 4, 5, 6, 0], B = c.base || {};
    const needWd = (wd, k) => Number(((c.need || X.DEFAULT_NEED)[wd] || {})[k]) || 0;
    const rowsOf = (k) => Math.max(1, ...WEEK.map((wd) => Math.max(needWd(wd, k), ((B[wd] || {})[k] || []).length)));
    const bCell = (wd, k, i) => { const n = ((B[wd] || {})[k] || [])[i - 1] || "", on = i <= needWd(wd, k) || n;
      return `<td class="${on ? "" : "na"}">${on ? (S.canEdit ? `<button data-bslot="${wd}|${k}|${i}">${esc(n) || "－"}</button>` : esc(n)) : ""}</td>`; };
    if (!wishOnly) html += `<h2 class="sh-h2">基本シフト（曜日ごと）<small>下書きはこの番号どおりに入ります${c.rotate && c.rotateFrom ? `。①〜③は1週ごとに1つずつずれます（この表は ${Number(c.rotateFrom.slice(5, 7))}/${Number(c.rotateFrom.slice(8))} の週の並び）` : ""}${S.canEdit ? "。マスを押すと変えられます" : ""}${(c.ng || []).length ? `<br>NGの条件：${(c.ng || []).map((r) => esc(X.ngText(r))).join("、")}（自動で作る・下書きで入れません）` : ""}${(c.rules || []).length ? `<br>職員ごとの決まり：${(c.rules || []).map((r) => esc(X.ruleText(r))).join("、")}（下書きはこの番号に入れます）` : ""}</small></h2>
      <table class="sh-base"><thead><tr><th></th>${WEEK.map((wd) => `<th class="${wd === 0 ? "su" : wd === 6 ? "sa" : ""}">${X.WD[wd]}</th>`).join("")}</tr></thead><tbody>
      ${["e", "l"].map((k) => Array.from({ length: rowsOf(k) }, (_, j) => `<tr class="${j === 0 ? "top" : ""}"><th>${j === 0 ? X.KIND[k] + "番" : ""}<i>${X.MARK[j + 1]}</i></th>${WEEK.map((wd) => bCell(wd, k, j + 1)).join("")}</tr>`).join("")).join("")}
      <tr class="top"><th>日勤</th>${WEEK.map((wd) => `<td>${S.canEdit ? `<button data-bd="${wd}">${esc(((B[wd] || {}).d || []).join("、")) || "－"}</button>` : esc(((B[wd] || {}).d || []).join("、"))}</td>`).join("")}</tr>
      <tr class="top off"><th>休み</th>${WEEK.map((wd) => `<td>${esc(c.members.filter((x) => X.patOf(c, x, wd) === "休").map((x) => x.name).join("、"))}</td>`).join("")}</tr></tbody></table>`;
    // 下の表：職員ごとの曜日のパターン（基本シフトから。早番・遅番・日勤・休み）と今月の希望
    if (!wishOnly) html += `<table class="sh-pat"><thead><tr><th>職員</th>${[1, 2, 3, 4, 5, 6, 0].map((i) => `<th>${X.WD[i]}</th>`).join("")}<th>今月の希望休・希望勤務</th></tr></thead><tbody>${c.members.map((x, mi) => `<tr><th>${esc(x.name)}</th>${[1, 2, 3, 4, 5, 6, 0].map((wd) => { const v = X.patOf(c, x, wd); return `<td class="${/休/.test(v) ? "p-off" : ""}">${S.canEdit && !B[wd] ? `<button data-pat="${mi}|${wd}">${esc(v) || "－"}</button>` : esc(v)}</td>`; }).join("")}<td class="sum">${esc(X.wishSummary(S.month, x.name))}</td></tr>`).join("") || `<tr><td colspan="9" class="none">職員がまだいません。「設定」から入れてください。</td></tr>`}</tbody></table>`;
    if (S.canEdit) html += `<section class="sh-holes" id="shHoles"><h2>空き ${hs.length}枠${conf.length ? `・希望とちがう ${conf.length}件` : ""}${ri.length ? `・決まりとちがう ${ri.length}件` : ""}${ngI.length ? `・NGの条件とちがう ${ngI.length}件` : ""}${le.length ? `・遅番の次の日に早番 ${le.length}件` : ""}</h2>
      ${le.length ? `<ul class="conf turnx" data-turn-list>${le.map((x) => `<li>${X.label(x.date)} 早${X.MARK[x.slot]} ${esc(x.name)}さんは前の日が遅番です</li>`).join("")}</ul>${leFix.fixed.length ? `<div class="acts"><button data-act="fixturn">替われる人に替える（${leFix.fixed.length}件）</button><span class="note">その日の日勤の人や早番の人に替えます。だめなら前の日の遅番を替えます${leFix.left.length ? `。残りの${leFix.left.length}件は替われる人がいないので、LINE文に入れています` : ""}</span></div>` : `<p class="note">替われる人が見つからないので、LINE文に入れています</p>`}` : ""}
      ${ri.length ? `<ul class="conf rulex" data-rule-list>${ri.map((x) => `<li>${X.label(x.date)} ${esc(x.name)}さんは${X.KIND[x.kind]}${X.MARK[x.slot]}の決まりですが${X.KIND[x.kind]}${X.MARK[x.now]}に入っています</li>`).join("")}</ul><div class="acts"><button data-act="fixrules">決まりどおりに並べ替える</button><span class="note">決まりの番号の人と入れ替えます</span></div>` : ""}
      ${ngI.length ? `<ul class="conf ngx" data-ng-list>${ngI.map((x) => `<li>${X.label(x.date)} ${esc(x.name)}さんは${X.WD[X.wdOf(x.date)]}曜日の${X.NG_K[x.kind]}はNGですが${x.kind === "d" ? "日勤" : X.KIND[x.kind] + X.MARK[x.slot]}に入っています</li>`).join("")}</ul>` : ""}
      ${conf.length ? `<ul class="conf" data-conf-list>${conf.map((x) => `<li>${X.label(x.date)} ${esc(x.name)}さんは「${esc(x.wish)}」の希望ですが入っています</li>`).join("")}</ul>` : ""}
      <label class="chk"><input type="checkbox" id="shNames" ${S.withNames ? "checked" : ""}>入れそうな人の名前も書く</label>
      <textarea id="shLine" readonly rows="${Math.min(16, 7 + hs.length)}">${esc(X.lineText(S.month, c, S.ym, { groupName: X.GROUPS[S.group], withNames: S.withNames }))}</textarea>
      <div class="acts"><button class="primary" data-act="copy">LINE文をコピー</button><span class="note">コピーしてLINEに貼り付けてください</span></div></section>`;
    root.innerHTML = html;
    drawPick(); drawSettings();
  }
  function drawPick() {
    const p = S.pick, el = $("shPick"); if (!el) return;
    if (!p) { el.innerHTML = ""; return; }
    if (p.wish) {   // 希望：日付を押すと出る（2026-11-07 依頼者「日付選んでポップアップで」）
      const cur = X.wishOf(S.month, S.wishWho, p.date);
      el.innerHTML = `<div class="ov" data-close-pick><div class="pk" data-wish-pick><h3>${X.label(p.date)} ${esc(S.wishWho)}さんの希望</h3>
        <div class="opts">${WISH_BTNS.filter(([k]) => k && k !== "time").map(([k, n]) => `<button class="opt${cur === k ? " on" : ""}" data-wpick="${esc(k)}">${esc(n)}</button>`).join("")}</div>
        <h4>その他（時刻）</h4><div class="wtime"><input type="time" id="shPenFrom" step="300" value="${esc(S.penFrom)}" aria-label="何時から">〜<input type="time" id="shPenTo" step="300" value="${esc(S.penTo)}" aria-label="何時まで"><button class="opt" data-wpick-time>この時刻で入れる</button></div>
        <div class="acts">${cur ? `<button data-wpick="">希望を消す（今：${esc(wishText(cur))}）</button>` : ""}<button data-close-pick>閉じる</button></div></div></div>`;
      return;
    }
    if (p.wd != null) {   // 基本シフトのマス
      const c = cfg(), b = (c.base || {})[p.wd] || {};
      if (p.k === "d") {
        const cur = new Set((b.d || []).map((x) => X.splitName(x).n));
        el.innerHTML = `<div class="ov" data-close-pick><div class="pk"><h3>基本シフト ${X.WD[p.wd]}曜日 日勤</h3>${c.members.map((x) => `<label class="opt"><input type="checkbox" data-bdn="${esc(x.name)}" ${cur.has(x.name) ? "checked" : ""}>${esc(x.name)}</label>`).join("")}
          <div class="acts"><button data-close-pick>閉じる</button><button class="primary" data-bd-save>決定</button></div></div></div>`;
        return;
      }
      const cur = X.splitName((b[p.k] || [])[p.i - 1] || "");
      el.innerHTML = `<div class="ov" data-close-pick><div class="pk"><h3>基本シフト ${X.WD[p.wd]}曜日 ${X.KIND[p.k]}${X.MARK[p.i] || p.i}</h3>
        <div class="opts">${c.members.map((x) => `<button class="opt${x.name === cur.n ? " on" : ""}" data-bpick="${esc(x.name)}">${esc(x.name)}<em>${esc(X.patOf(c, x, p.wd))}</em></button>`).join("")}</div>
        <label class="tm">時間（いつもの時間なら空欄。例：17~22）<input id="shBTime" maxlength="12" value="${esc(cur.t)}"></label>
        <div class="acts"><button data-bpick-clear>空きにする</button><button data-close-pick>閉じる</button></div></div></div>`;
      return;
    }
    const c = cfg(), d = (S.month && S.month.days || {})[p.date] || {};
    const busy = X.workers(S.month, p.date);
    if (p.k === "d") {
      const cur = new Set((d.d || []).map((x) => X.splitName(x).n));
      el.innerHTML = `<div class="ov" data-close-pick><div class="pk"><h3>${X.label(p.date)} 日勤</h3>${c.members.map((x) => { const w = X.wishOf(S.month, x.name, p.date); return `<label class="opt"><input type="checkbox" data-dkn="${esc(x.name)}" ${cur.has(x.name) ? "checked" : ""}>${esc(x.name)}${w ? `<em class="${/休/.test(w) ? "woff" : ""}">希望：${esc(w)}</em>` : ""}${!cur.has(x.name) && busy.has(x.name) ? `<em>ほかの枠に入っています</em>` : ""}</label>`; }).join("")}
        <div class="acts"><button data-close-pick>閉じる</button><button class="primary" data-dk-save>決定</button></div></div></div>`;
      return;
    }
    const s = (d[p.k] || {})[p.i], curN = X.slotName(s);
    el.innerHTML = `<div class="ov" data-close-pick><div class="pk"><h3>${X.label(p.date)} ${X.KIND[p.k]}${X.MARK[p.i] || p.i}</h3>
      <div class="opts">${c.members.map((x) => { const w = X.wishOf(S.month, x.name, p.date), sameK = Object.keys(d[p.k] || {}).find((j) => Number(j) !== p.i && X.slotName(d[p.k][j]) === x.name), inDay = !sameK && busy.has(x.name) && x.name !== curN;
        return `<button class="opt${x.name === curN ? " on" : ""}" data-pick="${esc(x.name)}">${esc(x.name)}${w ? `<em class="${/休/.test(w) ? "woff" : ""}">希望：${esc(w)}</em>` : ""}${inDay ? `<em>この日ほかに入っています</em>` : ""}${sameK ? `<em class="swap" data-swap>${X.KIND[p.k]}${X.MARK[sameK] || sameK}に入っています（押すと入れ替え）</em>` : ""}</button>`; }).join("")}</div>
      <p class="note">同じ日の${X.KIND[p.k]}番のほかの枠の人を押すと、この枠と入れ替わります</p>
      <label class="tm">時間（通しなら空欄。例：6~9、16~22）<input id="shTime" maxlength="12" value="${esc((s && s.t) || "")}"></label>
      <div class="acts"><button data-pick-clear>空きにする</button><button data-close-pick>閉じる</button></div></div></div>`;
  }
  function drawSettings() {
    const el = $("shSet"); if (!el) return;
    const st = S.settings; if (!st) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="ov"><div class="pk wide"><h3>設定（${X.GROUPS[S.group]}）</h3>
      <label class="tm">表の題<input id="stTitle" value="${esc(st.title)}" maxlength="60"></label>
      <h4>曜日ごとに要る枠の数（①〜）</h4><table class="need"><tr><th></th>${X.WD.map((w) => `<th>${w}</th>`).join("")}</tr>
      ${["e", "l"].map((k) => `<tr><th>${X.KIND[k]}番</th>${X.WD.map((w, wd) => `<td><select data-need="${k}|${wd}">${[0, 1, 2, 3, 4, 5].map((n) => `<option ${Number((st.need[wd] || {})[k]) === n ? "selected" : ""}>${n}</option>`).join("")}</select></td>`).join("")}</tr>`).join("")}</table>
      <label class="chk"><input type="checkbox" id="stRot" ${st.rotate ? "checked" : ""}>早番・遅番の①〜③を1週ごとに1つずつずらす（①→②→③→①）</label>
      <label class="tm">基本シフトの表が、どの週の並びか（その週の月曜日）<input type="date" id="stRotFrom" value="${esc(st.rotateFrom || "")}"></label>
      <h4>職員ごとの決まり（例：橋本さんは遅番3人の日は②）</h4><div class="mem">${(st.rules || []).map((r, i) => `<div class="mrow rrow"><select data-rn="${i}">${st.members.map((x) => `<option ${x.name === r.n ? "selected" : ""}>${esc(x.name)}</option>`).join("")}${st.members.some((x) => x.name === r.n) ? "" : `<option selected>${esc(r.n)}</option>`}</select>は
        <select data-rk="${i}">${["e", "l"].map((k) => `<option value="${k}" ${r.k === k ? "selected" : ""}>${X.KIND[k]}番</option>`).join("")}</select>が
        <select data-rc="${i}"><option value="0">何人でも</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(r.cnt) === n ? "selected" : ""}>${n}人の日</option>`).join("")}</select>は
        <select data-rs="${i}">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(r.slot) === n ? "selected" : ""}>${X.MARK[n]}</option>`).join("")}</select><button data-rdel="${i}">外す</button></div>`).join("")}</div>
      <button data-radd>＋ 決まりを足す</button>
      <h4>NGの条件（例：横田さんは土曜日の早番はNG。🤖自動で作る・下書きで入れません）</h4><div class="mem">${(st.ng || []).map((r, i) => `<div class="mrow rrow" data-ng-row="${i}"><select data-gn="${i}">${st.members.map((x) => `<option ${x.name === r.n ? "selected" : ""}>${esc(x.name)}</option>`).join("")}${st.members.some((x) => x.name === r.n) ? "" : `<option selected>${esc(r.n)}</option>`}</select>は
        <select data-gw="${i}"><option value="-1">毎日</option>${[1, 2, 3, 4, 5, 6, 0].map((wd) => `<option value="${wd}" ${Number(r.wd) === wd ? "selected" : ""}>${X.WD[wd]}曜日</option>`).join("")}</select>の
        <select data-gk="${i}">${Object.keys(X.NG_K).map((k) => `<option value="${k}" ${r.k === k ? "selected" : ""}>${X.NG_K[k]}</option>`).join("")}</select>はNG<button data-gdel="${i}">外す</button></div>`).join("")}</div>
      <button data-gadd>＋ NGの条件を足す</button>
      <h4>職員（上から順に下書きで入ります）</h4><div class="mem">${st.members.map((x, i) => `<div class="mrow"><input data-mname="${i}" value="${esc(x.name)}" maxlength="20"><button data-mup="${i}" aria-label="上へ">↑</button><button data-mdel="${i}" aria-label="外す">外す</button></div>`).join("")}</div>
      <button data-madd>＋ 職員を足す</button>
      <div class="acts"><button data-set-close>やめる</button><button class="primary" data-set-save>保存</button></div></div></div>`;
  }

  /* ---------- 操作 ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target, at = (sel) => t.closest(sel);
    if (at("[data-group]")) { S.group = at("[data-group]").dataset.group; store.set("sh:group", S.group); load(); return; }
    if (at("[data-mon]")) { const [y, m] = S.ym.split("-").map(Number), d = new Date(y, m - 1 + Number(at("[data-mon]").dataset.mon), 1); S.ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; load(); return; }
    if (at("[data-mode]")) { S.mode = at("[data-mode]").dataset.mode; render(); return; }
    if (!S.loaded) return;
    if (at("[data-wish-del]")) { if (!S.canEdit && S.wishWho !== S.myName) return; const d = at("[data-wish-del]").dataset.wishDel, who = S.wishWho; S.month.wish = Object.assign({}, S.month.wish); const w = Object.assign({}, S.month.wish[who]); delete w[d]; S.month.wish[who] = w; S.month = X.fitPending(S.month, S.ym); changed("month"); return; }
    if (at("[data-wpick]") && S.pick && S.pick.wish) { S.pen = at("[data-wpick]").dataset.wpick; cycleWish(S.pick.date, true); S.pick = null; drawPick(); return; }
    if (at("[data-wpick-time]") && S.pick && S.pick.wish) { S.penFrom = ($("shPenFrom") || {}).value || ""; S.penTo = ($("shPenTo") || {}).value || ""; if (!S.penFrom) { alert("何時からを入れてください"); return; } S.pen = "time"; cycleWish(S.pick.date, true); S.pick = null; drawPick(); return; }
    if (S.mode === "wish" && at("td.day") && !at(".ov")) { if (!S.canEdit && S.wishWho !== S.myName) return; S.pick = { date: at("td.day").dataset.day, wish: true }; drawPick(); return; }
    if (at("[data-slot]") && S.canEdit) { const [date, k, i] = at("[data-slot]").dataset.slot.split("|"); S.pick = { date, k, i: Number(i) }; drawPick(); return; }
    if (at("[data-dk]") && S.canEdit) { S.pick = { date: at("[data-dk]").dataset.dk, k: "d" }; drawPick(); return; }
    if (at("[data-pick]")) { const p = S.pick; setSlot(p.date, p.k, p.i, at("[data-pick]").dataset.pick, ($("shTime") || {}).value ? $("shTime").value.trim() : ""); S.pick = null; drawPick(); return; }
    if (at("[data-pick-clear]")) { const p = S.pick; setSlot(p.date, p.k, p.i, "", ""); S.pick = null; drawPick(); return; }
    if (at("[data-dk-save]")) {   // 「近藤(~13)」のように時間を添えた日勤は、そのまま残す
      const was = ((S.month && S.month.days || {})[S.pick.date] || {}).d || [];
      const names = [...document.querySelectorAll("[data-dkn]")].filter((x) => x.checked).map((x) => x.dataset.dkn).map((n) => was.find((w) => X.splitName(w).n === n) || n);
      setDayWorkers(S.pick.date, names); S.pick = null; drawPick(); return; }
    if (at("[data-bslot]") && S.canEdit) { const [wd, k, i] = at("[data-bslot]").dataset.bslot.split("|"); S.pick = { wd: Number(wd), k, i: Number(i) }; drawPick(); return; }
    if (at("[data-bd]") && S.canEdit) { S.pick = { wd: Number(at("[data-bd]").dataset.bd), k: "d" }; drawPick(); return; }
    if (at("[data-bpick]") || at("[data-bpick-clear]")) { const p = S.pick, tm = (($("shBTime") || {}).value || "").trim(), name = at("[data-bpick]") ? at("[data-bpick]").dataset.bpick + (tm ? `(${tm})` : "") : "";
      setBase(p.wd, (b) => { const a = (b[p.k] || []).slice(); while (a.length < p.i) a.push(""); a[p.i - 1] = name; while (a.length && !a[a.length - 1]) a.pop(); b[p.k] = a; }); S.pick = null; drawPick(); return; }
    if (at("[data-bd-save]")) { const was = ((cfg().base || {})[S.pick.wd] || {}).d || []; const names = [...document.querySelectorAll("[data-bdn]")].filter((x) => x.checked).map((x) => x.dataset.bdn).map((n) => was.find((w) => X.splitName(w).n === n) || n); const p = S.pick; setBase(p.wd, (b) => { b.d = names; }); S.pick = null; drawPick(); return; }
    if (at("[data-close-pick]") && (t.hasAttribute("data-close-pick") || t.tagName === "BUTTON")) { S.pick = null; drawPick(); return; }
    if (at("[data-pat]")) { const [mi, wd] = at("[data-pat]").dataset.pat.split("|").map(Number); const c = clone(cfg()); const cur = (c.members[mi].pat || {})[wd] || "";
      const next = X.PAT[(X.PAT.indexOf(cur) + 1) % X.PAT.length];   // 休→早→遅→日→早・遅→休
      c.members[mi].pat = Object.assign({}, c.members[mi].pat, { [wd]: next }); S.cfg = c; changed("cfg"); return; }
    const act = at("[data-act]") && at("[data-act]").dataset.act;
    if (act === "fixturn") { const r = X.fixLateEarly(S.month, cfg(), S.ym); S.month = r.month; changed("month");
      toast(`遅番の次の日の早番を替えました：${r.fixed.map((x) => x.late ? `${X.label(x.late.date)} 遅${X.MARK[x.late.slot]}→${x.late.to}` : `${X.label(x.date)} 早${X.MARK[x.slot]}→${x.to}`).join("、")}`); return; }
    if (act === "fixrules") { const n = X.ruleIssues(S.month, cfg(), S.ym).length; S.month = X.fixRules(S.month, cfg(), S.ym); changed("month"); toast(`決まりどおりに並べ替えました（${n}件）`); return; }
    if (act === "fix") {
      const hn = X.holes(S.month, cfg(), S.ym).length;
      if (!confirm(`${S.ym.replace("-", "年")}月のシフトを確定します。${hn ? `\n※まだ空きが ${hn}枠 あります。` : ""}\n確定すると、表の職員にも見え、職場カレンダーにも出ます。よろしいですか？`)) return;
      S.month = S.month || {}; S.month.fixed = { at: new Date().toISOString(), by: me().name || "" }; changed("month"); toast("確定しました。職員にも見え、カレンダーにも出ます"); return; }
    if (act === "unfix") {
      if (!confirm("確定を取り消します。表の職員には勤務が見えなくなり、職場カレンダーからも消えます。よろしいですか？")) return;
      S.month = S.month || {}; S.month.fixed = false; changed("month"); toast("確定を取り消しました"); return; }
    if (act === "auto") {
      if (!confirm(`${S.ym.replace("-", "年")}月のシフトを自動で作ります。\n希望・基本パターン・決まり・NGの条件・「遅番の次の日は早番にしない」を見て、空いている枠を埋めます。\n手で入れた枠はそのままです。よろしいですか？`)) return;
      const before = X.holes(S.month, cfg(), S.ym).length, r = X.autoShift(S.month, cfg(), S.ym); S.month = r.month; changed("month");
      const cnt = (h) => r.filled.filter((x) => x.how === h).length, hw = r.filled.filter((x) => x.how === "休日出勤");
      const msg = [`自動で作りました：空き ${before} → ${r.holes.length}`, cnt("日勤から") ? `日勤から ${cnt("日勤から")}枠` : "", cnt("早遅") ? `早遅 ${cnt("早遅")}枠` : "",
        hw.length ? `休日出勤 ${hw.length}枠（${hw.slice(0, 6).map((x) => `${X.label(x.date)} ${x.name}`).join("、")}${hw.length > 6 ? "…" : ""}）※本人に依頼してください` : "",
        r.turns.length ? `遅番の次の日の早番 ${r.turns.length}件（どうしても替われない分）` : "", r.conflicts.length ? `希望とちがう ${r.conflicts.length}件` : ""].filter(Boolean).join("・");
      S.autoMsg = msg; toast(msg + "。残りは下の「空き」とLINE文で確かめてください", 12000); return; }
    if (act === "draft") { const before = X.holes(S.month, cfg(), S.ym).length; S.month = X.draft(S.month, cfg(), S.ym); changed("month"); toast(`空いている枠を基本パターンで埋めました（空き ${before} → ${X.holes(S.month, cfg(), S.ym).length}）`); return; }
    if (act === "excel") { exportExcel(); return; }
    if (act === "calendar") { const u = H.url("?page=calendar"); if (u) { const l = document.createElement("a"); l.href = u; l.target = "_top"; document.body.appendChild(l); l.click(); l.remove(); } return; }
    if (act === "line") { const h = $("shHoles"); if (h) h.scrollIntoView({ behavior: "smooth" }); return; }
    if (act === "copy") { const ta = $("shLine"); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (x) {} if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(() => toast("コピーしました。LINEに貼り付けてください"), () => toast(ok ? "コピーしました" : "文を選んだので、長押しでコピーしてください")); else toast(ok ? "コピーしました" : "文を選んだので、長押しでコピーしてください"); return; }
    if (act === "settings") { const c = cfg(); S.settings = { title: c.title, need: clone(c.need), members: clone(c.members), rotate: !!c.rotate, rotateFrom: c.rotateFrom || "", rules: clone(c.rules || []), ng: clone(c.ng || []) }; drawSettings(); return; }
    if (at("[data-gadd]")) { readSettings(); S.settings.ng.push({ n: (S.settings.members[0] || {}).name || "", wd: 6, k: "e" }); drawSettings(); return; }
    if (at("[data-gdel]")) { readSettings(); S.settings.ng.splice(Number(at("[data-gdel]").dataset.gdel), 1); drawSettings(); return; }
    if (at("[data-radd]")) { readSettings(); S.settings.rules.push({ n: (S.settings.members[0] || {}).name || "", k: "l", cnt: 0, slot: 2 }); drawSettings(); return; }
    if (at("[data-rdel]")) { readSettings(); S.settings.rules.splice(Number(at("[data-rdel]").dataset.rdel), 1); drawSettings(); return; }
    if (at("[data-set-close]")) { S.settings = null; drawSettings(); return; }
    if (at("[data-madd]")) { readSettings(); S.settings.members.push({ name: "", pat: {} }); drawSettings(); return; }
    if (at("[data-mdel]")) { readSettings(); S.settings.members.splice(Number(at("[data-mdel]").dataset.mdel), 1); drawSettings(); return; }
    if (at("[data-mup]")) { readSettings(); const i = Number(at("[data-mup]").dataset.mup); if (i > 0) { const a = S.settings.members; [a[i - 1], a[i]] = [a[i], a[i - 1]]; } drawSettings(); return; }
    if (at("[data-set-save]")) { readSettings(); const st = S.settings; st.members = st.members.filter((x) => x.name.trim()).map((x) => Object.assign(x, { name: x.name.trim() }));
      S.cfg = Object.assign(clone(cfg()), { title: st.title.trim() || cfg().title, need: st.need, members: st.members, rotate: !!st.rotate && !!st.rotateFrom, rotateFrom: st.rotateFrom, rules: (st.rules || []).filter((r) => r.n), ng: (st.ng || []).filter((r) => r.n) }); S.settings = null; changed("cfg"); drawSettings(); toast("設定を保存しました"); return; }
  });
  function readSettings() {
    const st = S.settings; if (!st) return;
    const ti = $("stTitle"); if (ti) st.title = ti.value;
    if ($("stRot")) st.rotate = $("stRot").checked; if ($("stRotFrom")) st.rotateFrom = $("stRotFrom").value;
    const rv = (a, i) => { const x = document.querySelector(`[data-${a}="${i}"]`); return x ? x.value : ""; };
    (st.rules || []).forEach((r, i) => { if (!document.querySelector(`[data-rn="${i}"]`)) return; r.n = rv("rn", i); r.k = rv("rk", i); r.cnt = Number(rv("rc", i)); r.slot = Number(rv("rs", i)); });
    (st.ng || []).forEach((r, i) => { if (!document.querySelector(`[data-gn="${i}"]`)) return; r.n = rv("gn", i); r.wd = Number(rv("gw", i)); r.k = rv("gk", i); });
    document.querySelectorAll("[data-mname]").forEach((x) => { st.members[Number(x.dataset.mname)].name = x.value; });
    document.querySelectorAll("[data-need]").forEach((x) => { const [k, wd] = x.dataset.need.split("|"); st.need[wd] = Object.assign({}, st.need[wd], { [k]: Number(x.value) }); });
  }
  document.addEventListener("change", (e) => {
    if (e.target.id === "shWho") { S.wishWho = e.target.value; render(); }
    if (e.target.id === "shPenFrom") S.penFrom = e.target.value;
    if (e.target.id === "shPenTo") S.penTo = e.target.value;
    if (e.target.id === "shNames") { S.withNames = e.target.checked; render(); }
    if (e.target.id === "shWishNote") { S.month = S.month || {}; S.month.wishNote = Object.assign({}, S.month.wishNote, { [S.wishWho]: e.target.value.trim() }); changed("month"); }
  });
  // Excel出力：紙のシフト表と同じカレンダーの形（SGShift.buildWorkbook）。Excelの部品はそのときだけ読み込む
  let excelJs = null;
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    return excelJs || (excelJs = new Promise((ok, ng) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js"; sc.onload = () => ok(window.ExcelJS); sc.onerror = () => { excelJs = null; ng(new Error("Excelの部品を読み込めませんでした")); }; document.head.appendChild(sc); }));
  }
  async function exportExcel() {
    try {
      toast("Excelを作っています…");
      const ExcelJS = await loadExcelJS();
      const buf = await X.buildWorkbook(ExcelJS, S.month || {}, cfg(), S.ym, X.GROUPS[S.group]).xlsx.writeBuffer();
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = X.fileName(S.ym, X.GROUPS[S.group]); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast("Excelを出力しました");
    } catch (e) { toast((e && e.message) || "Excelを出力できませんでした"); }
  }
  let tt; function toast(m, ms) { const el = $("shToast"); if (!el) return; el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, ms || 3200); }
  window.addEventListener("online", () => { save("cfg"); save("month"); });

  H.ready.then(() => { load(); setInterval(() => { if (!S.saving && !pendingCount() && !S.pick && !S.settings && document.visibilityState !== "hidden") load(true); }, 30000); });
})();
