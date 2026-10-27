// 共通部品（変更しないでください）。画面側と同じコードをサーバーでも使います
/* カレンダー → 送迎表 の自動反映（純粋関数）
   カレンダーの予定に付いた「送迎表に反映」(sg) を、その日の送迎表に当てはめる。
   ・反映した内容は sheet.calApplied に記録し、予定の変更・削除で元に戻せるようにする
   ・作る便・予定のIDはカレンダーの予定IDから決まる（複数の端末が同時に反映しても重複しない）
   ・手で変えた箇所は、取り消し時に上書きしない */
(function (G) {
"use strict";
const toMinX = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const appTime = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? `${Number(m[1])}:${m[2]}` : ""; };
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TYPE_LABEL = { staff_off: "職員の休み・不在", staff_plan: "職員の予定", user_absent: "利用者の欠席", user_time: "利用者の時間変更", help: "ヘルプ", hwork: "休日出勤", shift: "勤務時間変更" };
const HOLD_ID = "__hold__";                                  // 送迎表の「保留」欄（担当がまだ決まっていないヘルプ）

function specsFor(master, events, date) {
  const staffBy = new Map((master.staff || []).map((s) => [s.name, s]));
  const userBy = new Map((master.users || []).map((u) => [u.name, u]));
  const out = [];
  for (const ev of events || []) {
    if (!ev || ev.deleted || !ev.sg || !ev.sg.type) continue;
    if (!(ev.date <= date && ev.endDate >= date)) continue;
    const whole = !!ev.allDay || (ev.date < date && ev.endDate > date);
    const from = whole ? "" : appTime(ev.date === date ? ev.start : "0:00");
    const to = whole ? "" : (ev.endDate === date ? appTime(ev.end) : "24:00");
    const staff = (ev.sg.staff || []).map((n) => staffBy.get(n)).filter(Boolean);
    const users = (ev.sg.users || []).map((n) => userBy.get(n)).filter(Boolean);
    const missing = [...(ev.sg.staff || []).filter((n) => !staffBy.has(n)), ...(ev.sg.users || []).filter((n) => !userBy.has(n))];
    const half = ev.sg.type === "staff_off" && (ev.sg.half === "am" || ev.sg.half === "pm") ? ev.sg.half : "";
    // ヘルプは、この版の職員も利用者（行き先）もいなければ、この版の送迎表には入れない（ほかの事業所の予定）
    if (ev.sg.type === "help" && !users.length && !staff.length) continue;
    const dept = (ev.sg.type === "hwork" || ev.sg.type === "shift") && ev.sg.dept ? (master.departments || []).find((d) => d.name === ev.sg.dept) : null;
    if ((ev.sg.type === "hwork" || ev.sg.type === "shift") && ev.sg.dept && !dept) missing.push(ev.sg.dept);
    out.push({ id: ev.id, rev: ev.rev, type: ev.sg.type, title: ev.title || "", whole: half ? true : whole, from, to, staff, users, half, wd: wdOf(date),
      meet: appTime(ev.sg.meet), send: appTime(ev.sg.send), noMeet: ev.sg.noMeet || "", noSend: ev.sg.noSend || "", missing,
      reason: ev.sg.reason || "", note: ev.sg.note || "", deptId: dept ? dept.id : "",
      wstart: appTime(ev.sg.wstart), wend: appTime(ev.sg.wend) });
  }
  return out;
}

const wdOf = (date) => { const [y, m, d] = String(date).split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
/* その日の勤務時間（曜日別の勤務 → 基本）の真ん中。15分単位に切り下げ */
function midOf(s, wd) {
  const sh = (s.shiftByDay || {})[wd] || {};
  const st = toMinX(sh.start || s.start || "8:30"), en = toMinX(sh.end || s.end || "17:30");
  if (st == null || en == null || en === st) return null;
  const end = en < st ? en + 1440 : en;                     // 夜勤（22:00〜6:00など日をまたぐ勤務）
  return fmt((Math.floor((st + end) / 2 / 15) * 15) % 1440);
}

function blocksOf(spec) {
  if (spec.type === "help") {                              // ヘルプ：開始時刻に、担当職員の欄へ【ヘルプ】（行き先）。担当が未定なら保留欄。長さは送迎表の決まり（既定1時間）
    if (!spec.from) return [];
    const who = spec.staff.length ? spec.staff.map((s) => s.id) : [HOLD_ID];
    return who.map((sid) => ({ id: `cal_${spec.id}_${sid}`, kind: "help", time: spec.from, staffId: sid,
      label: spec.note || spec.users.map((u) => u.name).join("・"), vehicleId: "", userIds: spec.users.map((u) => u.id), calId: spec.id }));
  }
  if (spec.type !== "staff_off" && spec.type !== "staff_plan") return [];
  if (spec.type === "staff_off" && (spec.whole || spec.half)) return [];
  return spec.staff.map((s) => {
    const from = spec.whole ? (s.start || "8:30") : spec.from;
    const to = spec.whole ? (s.end || "17:30") : spec.to;
    const dur = Math.max(15, (toMinX(to) ?? toMinX(from) + 60) - toMinX(from));
    return { id: `cal_${spec.id}_${s.id}`, kind: "block", time: from, durMin: dur, staffId: s.id,
      label: spec.type === "staff_off" ? `不在（${spec.title}）` : spec.title, calId: spec.id };
  });
}

const isObj = (x) => x != null && typeof x === "object" && !Array.isArray(x);
/* 反映で変えた項目（off / start / end / meet / send） */
const appliedKeys = (prev, mine) => Object.keys(mine || {}).filter((k) => !isObj(prev) || !same(prev[k], mine[k]));
function revert(next, rec) {
  const set = (field, id, prev, mine) => {
    const map = next[field] || (next[field] = {});
    const cur = map[id];
    if (isObj(cur) && isObj(mine)) {                        // 項目ごとに戻す。手で変えた項目には触らない
      const out = Object.assign({}, cur);
      for (const k of appliedKeys(prev, mine)) if (same(out[k], mine[k])) { if (isObj(prev) && prev[k] !== undefined) out[k] = prev[k]; else delete out[k]; }
      if (Object.keys(out).length) map[id] = out; else delete map[id];
      return;
    }
    if (!same(cur, mine)) return;                           // 手で変えていたら触らない
    if (prev == null) delete map[id]; else map[id] = prev;
  };
  for (const [sid, r] of Object.entries(rec.staffOv || {})) set("staffOv", sid, r.prev, r.mine);
  for (const [uid, r] of Object.entries(rec.userAbsent || {})) set("userAbsent", uid, r.prev, r.mine);
  for (const [uid, r] of Object.entries(rec.userTime || {})) set("userTime", uid, r.prev, r.mine);
  for (const [uid, r] of Object.entries(rec.noRide || {})) set("noRide", uid, r.prev, r.mine);
  const ids = new Set(rec.blocks || []);
  if (ids.size) next.blocks = (next.blocks || []).filter((b) => !ids.has(b.id));
}

function applySpec(next, spec) {
  const rec = { rev: spec.rev, title: spec.title, type: spec.type, staffOv: {}, userAbsent: {}, userTime: {}, noRide: {}, blocks: [] };
  const put = (field, id, val) => {
    const map = next[field] || (next[field] = {});
    const prev = map[id] === undefined ? null : clone(map[id]);
    map[id] = val; rec[field][id] = { prev, mine: clone(val) };
  };
  if (spec.type === "staff_off" && spec.half) spec.staff.forEach((s) => {
    const mid = midOf(s, spec.wd); if (!mid) return;
    // AM休 = 勤務時間の半分から出勤 / PM休 = 勤務時間の半分で退勤（送迎表の遅刻・早退と同じ扱い）
    put("staffOv", s.id, Object.assign({}, (next.staffOv || {})[s.id] || {}, spec.half === "am" ? { start: mid } : { end: mid }));
  });
  else if (spec.type === "staff_off" && spec.whole) spec.staff.forEach((s) => put("staffOv", s.id, Object.assign({}, (next.staffOv || {})[s.id] || {}, { off: true })));
  // 休日出勤：固定休の日でも出勤に。時間指定ならその時間、部署を選んだらその日の部署
  if (spec.type === "hwork") spec.staff.forEach((s) => put("staffOv", s.id, Object.assign({}, (next.staffOv || {})[s.id] || {}, { workToday: true },
    spec.whole ? {} : { start: spec.from, end: spec.to === "24:00" ? "23:59" : spec.to }, spec.deptId ? { deptId: spec.deptId } : {})));
  // 勤務時間変更：その日の出勤・退勤の時刻（送迎表の遅刻・早退・早出・残業と同じ欄）。部署を選んだらその日の部署
  if (spec.type === "shift") spec.staff.forEach((s) => {
    const patch = Object.assign({}, spec.wstart ? { start: spec.wstart } : {}, spec.wend ? { end: spec.wend } : {}, spec.deptId ? { deptId: spec.deptId } : {});
    if (Object.keys(patch).length) put("staffOv", s.id, Object.assign({}, (next.staffOv || {})[s.id] || {}, patch));
  });
  if (spec.type === "user_absent") spec.users.forEach((u) => put("userAbsent", u.id, true));
  if (spec.type === "user_time") spec.users.forEach((u) => {
    if (spec.meet || spec.send) put("userTime", u.id, Object.assign({}, (next.userTime || {})[u.id] || {}, spec.meet ? { meet: spec.meet } : {}, spec.send ? { send: spec.send } : {}));
    if (spec.noMeet || spec.noSend) put("noRide", u.id, Object.assign({}, (next.noRide || {})[u.id] || {}, spec.noMeet ? { meet: spec.noMeet } : {}, spec.noSend ? { send: spec.noSend } : {}));
  });
  const bl = blocksOf(spec);
  next.blocks = (next.blocks || []).filter((b) => !bl.some((x) => x.id === b.id)).concat(bl);
  rec.blocks = bl.map((b) => b.id);
  return rec;
}

/* 反映済みなのに、パターン読込・Excel取込などで消えてしまった項目を入れ直す。
   手で別の値に変えた項目（休み→出勤など）はそのまま */
function heal(sheet, rec, work) {
  let changed = false;
  for (const field of ["staffOv", "userTime", "noRide", "userAbsent"]) {
    for (const [id, r] of Object.entries(rec[field] || {})) {
      const cur = (sheet[field] || {})[id];
      if (isObj(r.mine)) {
        const miss = appliedKeys(r.prev, r.mine).filter((k) => !isObj(cur) || cur[k] === undefined);
        if (!miss.length) continue;
        const n = work(); n[field] = n[field] || {};
        const base = isObj(n[field][id]) ? n[field][id] : {};
        n[field][id] = Object.assign({}, base, Object.fromEntries(miss.map((k) => [k, r.mine[k]])));
        changed = true;
      } else if (cur === undefined && r.mine !== undefined && r.mine !== null) {
        const n = work(); n[field] = n[field] || {}; n[field][id] = r.mine; changed = true;
      }
    }
  }
  return changed;
}

/* sheet を events に合わせる。変更がなければ同じ sheet を返す */
function reconcile(master, sheet, events, date) {
  if (!master || !sheet) return sheet;
  const specs = specsFor(master, events, date);
  const applied = sheet.calApplied || {};
  const want = new Map(specs.map((s) => [s.id, s]));
  let next = null;
  const work = () => (next || (next = clone(sheet)));
  for (const [id, rec] of Object.entries(applied)) {
    const sp = want.get(id);
    if (!sp || sp.rev !== rec.rev) { const n = work(); revert(n, rec); delete n.calApplied[id]; }
  }
  for (const sp of specs) {
    const cur = (next || sheet).calApplied && (next || sheet).calApplied[sp.id];
    if (!cur) { const n = work(); n.calApplied = n.calApplied || {}; n.calApplied[sp.id] = applySpec(n, sp); continue; }
    // 反映済みの予定は、消えてしまった項目と便・予定の欠けを補う（パターン読込・Excel取込で消えた場合など）
    heal(next || sheet, cur, work);
    const bl = blocksOf(sp); const have = new Set(((next || sheet).blocks || []).map((b) => b.id));
    if (bl.some((b) => !have.has(b.id))) { const n = work(); n.blocks = (n.blocks || []).filter((b) => !bl.some((x) => x.id === b.id)).concat(bl); }
  }
  if (next && next.calApplied && !Object.keys(next.calApplied).length) delete next.calApplied;
  return next || sheet;
}

/* 画面表示用：その日に反映中のカレンダー予定 */
function summary(master, sheet, events, date) {
  return specsFor(master, events, date).filter((s) => s.staff.length || s.users.length).map((s) => ({ id: s.id, type: s.type, typeLabel: TYPE_LABEL[s.type], title: s.title,
    who: [...s.staff.map((x) => x.name), ...s.users.map((x) => x.name)], missing: s.missing,
    time: s.half ? (s.half === "am" ? "AM休（午後から出勤）" : "PM休（午前で退勤）") :
      s.type === "help" ? `${s.from}〜${s.note ? `・${s.note}` : ""}${s.staff.length ? "" : "・担当は未定（保留欄）"}` :
      s.type === "shift" ? [s.wstart && `出勤${s.wstart}`, s.wend && `退勤${s.wend}`].filter(Boolean).join("・") || "部署の変更" :
      s.type === "hwork" ? (s.whole ? "いつもの勤務時間" : `${s.from}〜${s.to}`) : s.type === "user_time" ? [s.meet && `迎え${s.meet}`, s.send && `送り${s.send}`, s.noMeet && `迎えなし(${s.noMeet})`, s.noSend && `送りなし(${s.noSend})`].filter(Boolean).join("・") : s.type === "user_absent" || s.whole ? "終日" : `${s.from}〜${s.to}` }));
}

const API = { reconcile, specsFor, summary, TYPE_LABEL, appTime };
if (typeof module !== "undefined" && module.exports) module.exports = API; else G.SGCal = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
