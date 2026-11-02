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
  const S = { group: store.get("sh:group") === "f" ? "f" : "m", ym: thisYm, loaded: false, err: "", canEdit: false, member: false,
    cfg: null, cfgBase: null, month: null, monthBase: null, mode: "shift", wishWho: "", withNames: true, saving: 0, failed: "", pick: null, settings: null, showLine: false };
  const me = () => H.me || {};
  const cfg = () => X.cfgOf(S.group, S.cfg);
  const pendKey = (kind) => `sh:pend:${S.group}:${S.ym}:${kind}`;

  /* ---------- 読み込み・保存 ---------- */
  async function load(quiet) {
    if (!quiet) { S.loaded = false; S.err = ""; render(); }
    try {
      const r = await H.call("shift.get", { group: S.group, ym: S.ym });
      S.canEdit = r.canEdit; S.member = r.member;
      S.cfgBase = r.cfg.value; S.monthBase = r.month.value;
      // まだ送れていない変更が端末に残っていれば、それを重ねて送り直す（通信が切れても消えない）
      const pc = store.get(pendKey("cfg")), pm = store.get(pendKey("month"));
      S.cfg = pc ? JSON.parse(pc).mine : clone(r.cfg.value);
      S.month = pm ? JSON.parse(pm).mine : clone(r.month.value) || {};
      if (!S.wishWho || !cfg().members.some((m) => m.name === S.wishWho)) S.wishWho = cfg().members.some((m) => m.name === me().name) ? me().name : ((cfg().members[0] || {}).name || "");
      if (!S.canEdit) S.mode = "wish";
      S.loaded = true;
      if (pc) save("cfg", JSON.parse(pc).base); if (pm) save("month", JSON.parse(pm).base);
    } catch (e) { S.err = (e && e.message) || "読み込めませんでした。通信を確かめて、もう一度開いてください"; S.loaded = false; }
    render();
  }
  const timers = {};
  function changed(kind) {
    const base = kind === "cfg" ? S.cfgBase : S.monthBase, mine = kind === "cfg" ? S.cfg : S.month;
    const prev = store.get(pendKey(kind));
    store.set(pendKey(kind), JSON.stringify({ base: prev ? JSON.parse(prev).base : base, mine }));   // まず端末に残す
    render(); clearTimeout(timers[kind]); timers[kind] = setTimeout(() => save(kind), 500);
  }
  async function save(kind, baseOverride) {
    const raw = store.get(pendKey(kind)); if (!raw) return;
    const p = JSON.parse(raw), base = baseOverride !== undefined ? baseOverride : p.base;
    S.saving++; render();
    try {
      const r = await H.call("shift.save", { group: S.group, ym: S.ym, kind, base, baseKnown: true, mine: p.mine });
      const now = store.get(pendKey(kind));
      if (now === raw) { store.del(pendKey(kind)); if (kind === "cfg") { S.cfgBase = r.value; S.cfg = clone(r.value); } else { S.monthBase = r.value; S.month = clone(r.value); } }
      else { const q = JSON.parse(now); store.set(pendKey(kind), JSON.stringify({ base: r.value, mine: q.mine })); if (kind === "cfg") S.cfgBase = r.value; else S.monthBase = r.value; setTimeout(() => save(kind), 50); }
      S.failed = "";
    } catch (e) { S.failed = (e && e.message) || "保存できませんでした"; setTimeout(() => save(kind), 15000); }
    S.saving--; render();
  }
  const pendingCount = () => ["cfg", "month"].filter((k) => store.get(pendKey(k))).length;

  /* ---------- 枠・希望の変更 ---------- */
  const dayObj = (date) => { S.month = S.month || {}; S.month.days = S.month.days || {}; return (S.month.days[date] = Object.assign({ e: {}, l: {}, d: [] }, S.month.days[date] || {})); };
  function setSlot(date, k, i, name, t) {
    const d = dayObj(date); d[k] = Object.assign({}, d[k]);
    if (name) d[k][i] = t ? { n: name, t } : { n: name }; else delete d[k][i];
    changed("month");
  }
  function setDayWorkers(date, names) { dayObj(date).d = names; changed("month"); }
  const WISH_CYCLE = ["休", "PM休", "AM休", "早", "遅", "日", ""];
  function cycleWish(date) {
    const who = S.wishWho; if (!who) return;
    S.month = S.month || {}; S.month.wish = Object.assign({}, S.month.wish); const w = Object.assign({}, S.month.wish[who]);
    const next = WISH_CYCLE[(WISH_CYCLE.indexOf(w[date] || "") + 1) % WISH_CYCLE.length];
    if (next) w[date] = next; else delete w[date];
    S.month.wish[who] = w; changed("month");
  }

  /* ---------- 描く ---------- */
  function render() {
    const root = $("shRoot"); if (!root) return;
    const c = cfg();
    const status = S.failed ? `<span class="st bad">未送信（自動で送り直します）：${esc(S.failed)}</span>` : S.saving || pendingCount() ? `<span class="st busy">保存中…</span>` : S.loaded ? `<span class="st ok">保存済み ✓</span>` : "";
    const [y, m] = S.ym.split("-").map(Number);
    let html = `<header class="sh-bar"><div class="sh-title">${esc(c.title)}</div>
      <nav class="sh-tabs">${Object.entries(X.GROUPS).map(([k, n]) => `<button data-group="${k}" aria-pressed="${S.group === k}">${n}</button>`).join("")}</nav>
      <div class="sh-month"><button data-mon="-1" aria-label="前の月">‹</button><b>${y}年${m}月</b><button data-mon="1" aria-label="次の月">›</button></div>${status}</header>`;
    if (S.err) { root.innerHTML = html + `<p class="sh-err">${esc(S.err)}</p>`; return; }
    if (!S.loaded) { root.innerHTML = html + `<p class="sh-wait">読み込んでいます…</p>`; return; }
    html += `<div class="sh-tools">` + (S.canEdit ? `<span class="seg"><button data-mode="shift" aria-pressed="${S.mode === "shift"}">シフトを組む</button><button data-mode="wish" aria-pressed="${S.mode === "wish"}">希望を入れる</button></span>
      <button data-act="draft" title="職員ごとの曜日のパターン（下の表）と希望から、空いている枠だけを埋めます">基本パターンで下書き</button>
      <button data-act="line" class="primary">空きを見てLINE文を作る</button><button data-act="settings">設定（職員・枠の数）</button>` : `<span class="note">あなたの希望を入れられます（日付を押すたびに 休→PM休→AM休→早→遅→日→なし）</span>`) + `</div>`;
    if (S.mode === "wish") html += `<div class="sh-wishbar">希望を入れる人：${S.canEdit ? `<select id="shWho">${c.members.map((x) => `<option ${x.name === S.wishWho ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : `<b>${esc(S.wishWho)}</b>`}
      <span class="note">日付のマスを押すたびに 休→PM休→AM休→早→遅→日→なし</span>
      <label class="wn">ひとこと：<input id="shWishNote" maxlength="80" value="${esc(((S.month && S.month.wishNote) || {})[S.wishWho] || "")}" placeholder="例：13〜17日 旅行"></label></div>`;
    const hs = X.holes(S.month, c, S.ym), holeSet = new Set(hs.map((h) => `${h.date}|${h.kind}|${h.idx}`));
    const conf = X.conflicts(S.month, c, S.ym), confSet = new Set(conf.map((x) => `${x.date}|${x.name}`));
    const days = X.daysOfMonth(S.ym), lead = X.wdOf(days[0]);
    html += `<table class="sh-grid"><thead><tr>${X.WD.map((w, i) => `<th class="${i === 0 ? "su" : i === 6 ? "sa" : ""}">${w}曜日</th>`).join("")}</tr></thead><tbody>`;
    const cells = Array(lead).fill(null).concat(days);
    while (cells.length % 7) cells.push(null);
    for (let r = 0; r < cells.length; r += 7) {
      html += "<tr>" + cells.slice(r, r + 7).map((date) => {
        if (!date) return `<td class="empty"></td>`;
        const d = X.daysOfMonth ? (S.month && S.month.days || {})[date] || {} : {}, need = X.needOf(c, date);
        const slot = (k, i) => { const s = (d[k] || {})[i], n = X.slotName(s), hole = holeSet.has(`${date}|${k}|${i}`), bad = n && confSet.has(`${date}|${n}`);
          return `<button class="slot ${k}${hole ? " hole" : ""}${bad ? " bad" : ""}" data-slot="${date}|${k}|${i}" ${S.mode === "wish" ? "tabindex=-1" : ""}><i>${X.KIND[k]}${X.MARK[i] || i}</i>${n ? esc(n) + (s && s.t ? `<small>(${esc(s.t)})</small>` : "") : hole ? "空き" : ""}</button>`; };
        const maxE = Math.max(need.e, ...Object.keys(d.e || {}).map(Number), 0), maxL = Math.max(need.l, ...Object.keys(d.l || {}).map(Number), 0);
        const rows = Math.max(maxE, maxL);
        let grid = "";
        for (let i = 1; i <= rows; i++) grid += `<div class="pair">${i <= maxE ? slot("e", i) : `<span></span>`}${i <= maxL ? slot("l", i) : `<span></span>`}</div>`;
        const wishes = c.members.map((x) => [x.name, X.wishOf(S.month, x.name, date)]).filter((x) => x[1]);
        const off = X.offList(S.month, c, date);
        const wd = X.wdOf(date);
        return `<td class="day${wd === 0 ? " su" : wd === 6 ? " sa" : ""}${S.mode === "wish" ? " wishmode" : ""}" data-day="${date}"><div class="dnum">${Number(date.slice(8))}${d.note ? `<span class="dnote">${esc(d.note)}</span>` : ""}</div>${grid}
          <div class="line"><button class="dk" data-dk="${date}" ${S.mode === "wish" ? "tabindex=-1" : ""}>日勤：${esc((d.d || []).join("、"))}</button></div>
          <div class="line off">休み：${off.map((n) => `<span class="${X.wishOf(S.month, n, date) ? "w" : ""}">${esc(n)}</span>`).join("、")}</div>
          ${wishes.length ? `<div class="line wish">希望：${wishes.map(([n, w]) => `<span class="${/休/.test(w) ? "woff" : ""}">${esc(n)} ${esc(w)}</span>`).join("、")}</div>` : ""}</td>`;
      }).join("") + "</tr>";
    }
    html += `</tbody></table>`;
    // 下の表：職員ごとの曜日のパターン（早番・遅番・日勤・固定休）と今月の希望
    html += `<table class="sh-pat"><thead><tr><th>職員</th>${X.WD.map((w) => `<th>${w}</th>`).join("")}<th>今月の希望休・希望勤務</th></tr></thead><tbody>${c.members.map((x, mi) => `<tr><th>${esc(x.name)}</th>${X.WD.map((w, wd) => { const v = (x.pat || {})[wd] || ""; return `<td class="${/休/.test(v) ? "p-off" : ""}">${S.canEdit ? `<button data-pat="${mi}|${wd}">${esc(v) || "－"}</button>` : esc(v)}</td>`; }).join("")}<td class="sum">${esc(X.wishSummary(S.month, x.name))}</td></tr>`).join("") || `<tr><td colspan="9" class="none">職員がまだいません。「設定」から入れてください。</td></tr>`}</tbody></table>`;
    if (S.canEdit) html += `<section class="sh-holes" id="shHoles"><h2>空き ${hs.length}枠${conf.length ? `・希望とちがう ${conf.length}件` : ""}</h2>
      ${conf.length ? `<ul class="conf">${conf.map((x) => `<li>${X.label(x.date)} ${esc(x.name)}さんは「${esc(x.wish)}」の希望ですが入っています</li>`).join("")}</ul>` : ""}
      <label class="chk"><input type="checkbox" id="shNames" ${S.withNames ? "checked" : ""}>入れそうな人の名前も書く</label>
      <textarea id="shLine" readonly rows="${Math.min(16, 7 + hs.length)}">${esc(X.lineText(S.month, c, S.ym, { groupName: X.GROUPS[S.group], withNames: S.withNames }))}</textarea>
      <div class="acts"><button class="primary" data-act="copy">LINE文をコピー</button><span class="note">コピーしてLINEに貼り付けてください</span></div></section>`;
    root.innerHTML = html;
    drawPick(); drawSettings();
  }
  function drawPick() {
    const p = S.pick, el = $("shPick"); if (!el) return;
    if (!p) { el.innerHTML = ""; return; }
    const c = cfg(), d = (S.month && S.month.days || {})[p.date] || {};
    const busy = X.workers(S.month, p.date);
    if (p.k === "d") {
      const cur = new Set(d.d || []);
      el.innerHTML = `<div class="ov" data-close-pick><div class="pk"><h3>${X.label(p.date)} 日勤</h3>${c.members.map((x) => { const w = X.wishOf(S.month, x.name, p.date); return `<label class="opt"><input type="checkbox" data-dkn="${esc(x.name)}" ${cur.has(x.name) ? "checked" : ""}>${esc(x.name)}${w ? `<em class="${/休/.test(w) ? "woff" : ""}">希望：${esc(w)}</em>` : ""}${!cur.has(x.name) && busy.has(x.name) ? `<em>ほかの枠に入っています</em>` : ""}</label>`; }).join("")}
        <div class="acts"><button data-close-pick>閉じる</button><button class="primary" data-dk-save>決定</button></div></div></div>`;
      return;
    }
    const s = (d[p.k] || {})[p.i], curN = X.slotName(s);
    el.innerHTML = `<div class="ov" data-close-pick><div class="pk"><h3>${X.label(p.date)} ${X.KIND[p.k]}${X.MARK[p.i] || p.i}</h3>
      <div class="opts">${c.members.map((x) => { const w = X.wishOf(S.month, x.name, p.date), inDay = busy.has(x.name) && x.name !== curN;
        return `<button class="opt${x.name === curN ? " on" : ""}" data-pick="${esc(x.name)}">${esc(x.name)}${w ? `<em class="${/休/.test(w) ? "woff" : ""}">希望：${esc(w)}</em>` : ""}${inDay ? `<em>この日ほかに入っています</em>` : ""}</button>`; }).join("")}</div>
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
    if (S.mode === "wish" && at("td.day")) { if (!S.canEdit && S.wishWho !== me().name) return; cycleWish(at("td.day").dataset.day); return; }
    if (at("[data-slot]") && S.canEdit) { const [date, k, i] = at("[data-slot]").dataset.slot.split("|"); S.pick = { date, k, i: Number(i) }; drawPick(); return; }
    if (at("[data-dk]") && S.canEdit) { S.pick = { date: at("[data-dk]").dataset.dk, k: "d" }; drawPick(); return; }
    if (at("[data-pick]")) { const p = S.pick; setSlot(p.date, p.k, p.i, at("[data-pick]").dataset.pick, ($("shTime") || {}).value ? $("shTime").value.trim() : ""); S.pick = null; drawPick(); return; }
    if (at("[data-pick-clear]")) { const p = S.pick; setSlot(p.date, p.k, p.i, "", ""); S.pick = null; drawPick(); return; }
    if (at("[data-dk-save]")) { const names = [...document.querySelectorAll("[data-dkn]")].filter((x) => x.checked).map((x) => x.dataset.dkn); setDayWorkers(S.pick.date, names); S.pick = null; drawPick(); return; }
    if (at("[data-close-pick]") && (t.hasAttribute("data-close-pick") || t.tagName === "BUTTON")) { S.pick = null; drawPick(); return; }
    if (at("[data-pat]")) { const [mi, wd] = at("[data-pat]").dataset.pat.split("|").map(Number); const c = clone(cfg()); const cur = (c.members[mi].pat || {})[wd] || "";
      const next = X.PAT[(X.PAT.indexOf(cur) + 1) % X.PAT.length];   // 休→早→遅→日→早・遅→休
      c.members[mi].pat = Object.assign({}, c.members[mi].pat, { [wd]: next }); S.cfg = c; changed("cfg"); return; }
    const act = at("[data-act]") && at("[data-act]").dataset.act;
    if (act === "draft") { const before = X.holes(S.month, cfg(), S.ym).length; S.month = X.draft(S.month, cfg(), S.ym); changed("month"); toast(`空いている枠を基本パターンで埋めました（空き ${before} → ${X.holes(S.month, cfg(), S.ym).length}）`); return; }
    if (act === "line") { const h = $("shHoles"); if (h) h.scrollIntoView({ behavior: "smooth" }); return; }
    if (act === "copy") { const ta = $("shLine"); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (x) {} if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(() => toast("コピーしました。LINEに貼り付けてください"), () => toast(ok ? "コピーしました" : "文を選んだので、長押しでコピーしてください")); else toast(ok ? "コピーしました" : "文を選んだので、長押しでコピーしてください"); return; }
    if (act === "settings") { const c = cfg(); S.settings = { title: c.title, need: clone(c.need), members: clone(c.members) }; drawSettings(); return; }
    if (at("[data-set-close]")) { S.settings = null; drawSettings(); return; }
    if (at("[data-madd]")) { readSettings(); S.settings.members.push({ name: "", pat: {} }); drawSettings(); return; }
    if (at("[data-mdel]")) { readSettings(); S.settings.members.splice(Number(at("[data-mdel]").dataset.mdel), 1); drawSettings(); return; }
    if (at("[data-mup]")) { readSettings(); const i = Number(at("[data-mup]").dataset.mup); if (i > 0) { const a = S.settings.members; [a[i - 1], a[i]] = [a[i], a[i - 1]]; } drawSettings(); return; }
    if (at("[data-set-save]")) { readSettings(); const st = S.settings; st.members = st.members.filter((x) => x.name.trim()).map((x) => Object.assign(x, { name: x.name.trim() }));
      S.cfg = Object.assign(clone(cfg()), { title: st.title.trim() || cfg().title, need: st.need, members: st.members }); S.settings = null; changed("cfg"); drawSettings(); toast("設定を保存しました"); return; }
  });
  function readSettings() {
    const st = S.settings; if (!st) return;
    const ti = $("stTitle"); if (ti) st.title = ti.value;
    document.querySelectorAll("[data-mname]").forEach((x) => { st.members[Number(x.dataset.mname)].name = x.value; });
    document.querySelectorAll("[data-need]").forEach((x) => { const [k, wd] = x.dataset.need.split("|"); st.need[wd] = Object.assign({}, st.need[wd], { [k]: Number(x.value) }); });
  }
  document.addEventListener("change", (e) => {
    if (e.target.id === "shWho") { S.wishWho = e.target.value; render(); }
    if (e.target.id === "shNames") { S.withNames = e.target.checked; render(); }
    if (e.target.id === "shWishNote") { S.month = S.month || {}; S.month.wishNote = Object.assign({}, S.month.wishNote, { [S.wishWho]: e.target.value.trim() }); changed("month"); }
  });
  let tt; function toast(m) { const el = $("shToast"); if (!el) return; el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, 3200); }
  window.addEventListener("online", () => { save("cfg"); save("month"); });

  H.ready.then(() => { load(); setInterval(() => { if (!S.saving && !pendingCount() && !S.pick && !S.settings && document.visibilityState !== "hidden") load(true); }, 30000); });
})();
