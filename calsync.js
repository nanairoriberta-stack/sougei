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
const TYPE_LABEL = { staff_off: "職員の休み・不在", staff_plan: "職員の予定", user_absent: "利用者の欠席", user_time: "送迎の変更", user_extra: "利用日外利用", help: "ヘルプ", hwork: "休日出勤", shift: "職員時間変更" };
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
    const missingStaff = (ev.sg.staff || []).filter((n) => !staffBy.has(n)), missingUsers = (ev.sg.users || []).filter((n) => !userBy.has(n));
    const missing = [...missingStaff, ...missingUsers];
    const half = ev.sg.type === "staff_off" && (ev.sg.half === "am" || ev.sg.half === "pm") ? ev.sg.half : "";
    // ヘルプは、この版の職員も利用者（行き先）もいなければ、この版の送迎表には入れない（ほかの事業所の予定）
    if (ev.sg.type === "help" && !users.length && !staff.length) continue;
    const dept = (ev.sg.type === "hwork" || ev.sg.type === "shift") && ev.sg.dept ? (master.departments || []).find((d) => d.name === ev.sg.dept) : null;
    if ((ev.sg.type === "hwork" || ev.sg.type === "shift") && ev.sg.dept && !dept) { missing.push(ev.sg.dept); missingStaff.push(ev.sg.dept); }
    out.push({ id: ev.id, rev: ev.rev, type: ev.sg.type, title: ev.title || "", whole: half ? true : whole, from, to, staff, users, half, wd: wdOf(date), biz: ev.biz === "houkago" ? "houkago" : "seikatsu", missingStaff,
      meet: appTime(ev.sg.meet), send: appTime(ev.sg.send), noMeet: ev.sg.noMeet || "", noSend: ev.sg.noSend || "", missing,
      reason: ev.sg.reason || "", note: ev.sg.note || "", deptId: dept ? dept.id : "",
      wstart: appTime(ev.sg.wstart), wend: appTime(ev.sg.wend), meetPlace: ev.sg.meetPlace || "", sendPlace: ev.sg.sendPlace || "" });
  }
  return out;
}

const wdOf = (date) => { const [y, m, d] = String(date).split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
/* その日の勤務時間（曜日別の勤務 → 基本）の真ん中から off 分ずらした時刻。真ん中は15分単位に切り下げ
   半休は昼休みの分をはさむ：8:30〜17:30 の人は AM休＝13:30から・PM休＝12:30まで（真ん中13:00の±30分） */
function midOf(s, wd, off) {
  const sh = (s.shiftByDay || {})[wd] || {};
  const st = toMinX(sh.start || s.start || "8:30"), en = toMinX(sh.end || s.end || "17:30");
  if (st == null || en == null || en === st) return null;
  const end = en < st ? en + 1440 : en;                     // 夜勤（22:00〜6:00など日をまたぐ勤務）
  return fmt(((Math.floor((st + end) / 2 / 15) * 15) + (off || 0) + 1440) % 1440);
}

function blocksOf(spec) {
  if (spec.type === "help") {                              // ヘルプ：開始時刻に【ヘルプ（利用者）】。職員が無ければ保留欄（担当者が送迎表で割り当てる）。長さは送迎表の決まり（既定1時間）
    if (!spec.from) return [];
    const who = spec.staff.length ? spec.staff.map((s) => s.id) : [HOLD_ID];
    const names = spec.users.map((u) => u.name).join("・");
    const note = names && spec.note && spec.note !== names ? spec.note : "";   // 家以外の行き先は（ ）書きで出る
    return who.map((sid) => Object.assign({ id: `cal_${spec.id}_${sid}`, kind: "help", time: spec.from, staffId: sid,
      label: names || spec.note, vehicleId: "", userIds: spec.users.map((u) => u.id), calId: spec.id }, note ? { note } : {}));
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
  for (const [uid, r] of Object.entries(rec.userExtra || {})) set("userExtra", uid, r.prev, r.mine);
  // 迎え先・送り先：反映した値のままの便だけ元に戻す（手で別の行き先に変えていたら触らない）
  for (const [key, e] of Object.entries(rec.places || {})) {
    const [k, uid] = key.split(":");
    for (const r of next.runs || []) {
      if (r.kind !== k || !r.places || r.places[uid] !== e.mine) continue;
      const pl = Object.assign({}, r.places);
      if (r.id === e.run && e.prev != null) pl[uid] = e.prev; else delete pl[uid];
      if (Object.keys(pl).length) r.places = pl; else delete r.places;
    }
  }
  // 保留へ移した便・予定：まだ保留のままなら元の担当に戻す（手で誰かに割り当てていたら触らない）
  for (const h of rec.held || []) {
    const it = (next[h.t] || []).find((x) => x.id === h.id);
    if (it && it.staffId === HOLD_ID) it.staffId = h.staff;
  }
  const ids = new Set(rec.blocks || []);
  if (ids.size) next.blocks = (next.blocks || []).filter((b) => !ids.has(b.id));
}

function applySpec(next, spec) {
  const rec = { rev: spec.rev, title: spec.title, type: spec.type, staffOv: {}, userAbsent: {}, userTime: {}, noRide: {}, userExtra: {}, blocks: [] };
  const put = (field, id, val) => {
    const map = next[field] || (next[field] = {});
    const prev = map[id] === undefined ? null : clone(map[id]);
    map[id] = val; rec[field][id] = { prev, mine: clone(val) };
  };
  if (spec.type === "staff_off" && spec.half) spec.staff.forEach((s) => {
    const mid = midOf(s, spec.wd, spec.half === "am" ? 30 : -30); if (!mid) return;
    // AM休 = 勤務時間の半分＋30分から出勤 / PM休 = 勤務時間の半分−30分で退勤（送迎表の遅刻・早退と同じ扱い）
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
  // 休み・半休・不在・勤務時間変更で、勤務していない時間にかかるその職員の便・予定（ヘルプなど）は保留へ移す。
  // 移したものは記録し、予定を消したら（まだ保留のままなら）元の担当に戻す。反映した時だけ動かす（その後に手で戻したものは触らない）
  if (spec.type === "staff_off" || spec.type === "shift") spec.staff.forEach((s) => {
    const ov = (next.staffOv || {})[s.id] || {};
    const st = toMinX(spec.type === "shift" ? spec.wstart : spec.half === "am" ? ov.start : ""), en = toMinX(spec.type === "shift" ? spec.wend : spec.half === "pm" ? ov.end : "");
    const f = toMinX(spec.from), t = toMinX(spec.to === "24:00" ? "23:59" : spec.to);
    const off = (t0, dur) => t0 == null ? false
      : spec.type === "staff_off" && spec.whole && !spec.half ? true
      : spec.type === "staff_off" && !spec.whole ? (f != null && t != null && t0 < t && t0 + dur > f)
      : (st != null && t0 < st) || (en != null && t0 + dur > en);
    for (const t2 of ["runs", "blocks"]) for (const it of next[t2] || []) {
      if (it.staffId !== s.id || String(it.id || "").startsWith("cal_")) continue;   // カレンダーから入れた「不在」「予定」はそのまま
      if (!off(toMinX(it.time), Number(it.durMin) || 30)) continue;
      it.staffId = HOLD_ID; (rec.held = rec.held || []).push({ t: t2, id: it.id, staff: s.id });
    }
  });
  if (spec.type === "user_absent") spec.users.forEach((u) => put("userAbsent", u.id, true));
  // 利用日外利用：その日だけ利用日にする（送迎表の「今日だけ利用」）。迎え・送りが未割当として出るので担当者が気づける
  if (spec.type === "user_extra") spec.users.forEach((u) => put("userExtra", u.id, true));
  if (spec.type === "user_time" || spec.type === "user_extra") spec.users.forEach((u) => {
    if (spec.meet || spec.send) put("userTime", u.id, Object.assign({}, (next.userTime || {})[u.id] || {}, spec.meet ? { meet: spec.meet } : {}, spec.send ? { send: spec.send } : {}));
    if (spec.noMeet || spec.noSend) put("noRide", u.id, Object.assign({}, (next.noRide || {})[u.id] || {}, spec.noMeet ? { meet: spec.noMeet } : {}, spec.noSend ? { send: spec.noSend } : {}));
  });
  // 迎え先・送り先：その日その人が乗る迎え／送りの便に「その日だけの行き先」を入れる。まだ便に入っていなければ、入ったときに入れる（healPlaces）
  if (spec.type === "user_time" || spec.type === "user_extra") for (const [k, place] of [["meet", spec.meetPlace], ["send", spec.sendPlace]]) {
    if (!place) continue;
    rec.places = rec.places || {};
    spec.users.forEach((u) => {
      const r = runOf(next, k, u.id);
      if (!r) { rec.places[`${k}:${u.id}`] = { run: null, prev: null, mine: place }; return; }
      const prev = r.places && r.places[u.id] !== undefined ? r.places[u.id] : null;
      r.places = Object.assign({}, r.places, { [u.id]: place });
      rec.places[`${k}:${u.id}`] = { run: r.id, prev, mine: place };
    });
  }
  const bl = blocksOf(spec);
  next.blocks = (next.blocks || []).filter((b) => !bl.some((x) => x.id === b.id)).concat(bl);
  rec.blocks = bl.map((b) => b.id);
  return rec;
}

/* 反映済みなのに、パターン読込・Excel取込などで消えてしまった項目を入れ直す。
   手で別の値に変えた項目（休み→出勤など）はそのまま */
function heal(sheet, rec, work) {
  let changed = false;
  for (const field of ["staffOv", "userTime", "noRide", "userAbsent", "userExtra"]) {
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

const runOf = (sheet, k, uid) => (sheet.runs || []).find((r) => r.kind === k && (r.userIds || []).includes(uid));
/* 迎え先・送り先の補い：便に入った（入り直した）のに行き先が入っていなければ入れる。手で入れた行き先はそのまま */
function healPlaces(get, work, id) {
  const rec = get().calApplied[id];
  for (const [key, e] of Object.entries(rec.places || {})) {
    const [k, uid] = key.split(":");
    const r = runOf(get(), k, uid);
    if (!r || (r.places && r.places[uid] !== undefined)) continue;
    const n = work(); const rr = n.runs.find((x) => x.id === r.id);
    rr.places = Object.assign({}, rr.places, { [uid]: e.mine });
    n.calApplied[id].places[key] = { run: r.id, prev: null, mine: e.mine };
  }
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
    healPlaces(() => next || sheet, work, sp.id);
    const bl = blocksOf(sp); const have = new Set(((next || sheet).blocks || []).map((b) => b.id));
    if (bl.some((b) => !have.has(b.id))) { const n = work(); n.blocks = (n.blocks || []).filter((b) => !bl.some((x) => x.id === b.id)).concat(bl); }
  }
  if (next && next.calApplied && !Object.keys(next.calApplied).length) delete next.calApplied;
  return next || sheet;
}

/* 画面表示用：その日に反映中のカレンダー予定 */
function summary(master, sheet, events, date) {
  return summary0(master, sheet, events, date).map((x) => {           // 保留へ移した数（まだ保留のままのもの）も見せる
    const rec = ((sheet && sheet.calApplied) || {})[x.id];
    const n = ((rec && rec.held) || []).filter((h) => ((sheet[h.t] || []).find((y) => y.id === h.id) || {}).staffId === HOLD_ID).length;
    return n ? Object.assign(x, { time: `${x.time ? x.time + "・" : ""}担当の予定${n}件を保留へ` }) : x;
  });
}
function summary0(master, sheet, events, date) {
  return specsFor(master, events, date).filter((s) => s.staff.length || s.users.length).map((s) => ({ id: s.id, type: s.type, typeLabel: TYPE_LABEL[s.type], title: s.title,
    who: [...s.staff.map((x) => x.name), ...s.users.map((x) => x.name)], missing: s.missing, missingStaff: s.missingStaff, biz: s.biz,
    time: s.half ? (s.half === "am" ? "AM休（午後から出勤）" : "PM休（午前で退勤）") :
      s.type === "help" ? `${s.from}〜${s.note ? `・${s.note}` : ""}${s.staff.length ? "" : "・担当は未定（保留欄）"}` :
      s.type === "shift" ? [s.wstart && `出勤${s.wstart}`, s.wend && `退勤${s.wend}`].filter(Boolean).join("・") || "部署の変更" :
      s.type === "hwork" ? (s.whole ? "いつもの勤務時間" : `${s.from}〜${s.to}`) : s.type === "user_time" || s.type === "user_extra" ? [s.type === "user_extra" ? "今日だけ利用" : "", s.meet && `迎え${s.meet}`, s.meetPlace && `迎え先:${s.meetPlace}`, s.send && `送り${s.send}`, s.sendPlace && `送り先:${s.sendPlace}`, s.noMeet && `迎えなし(${s.noMeet})`, s.noSend && `送りなし(${s.noSend})`].filter(Boolean).join("・") : s.type === "user_absent" || s.whole ? "終日" : `${s.from}〜${s.to}` }));
}

/* ===== りんく・ぷれいす版（放課後デイ）→ 生活介護への送迎の依頼 =====
   りんく・ぷれいす版で担当を「生活介護へ依頼」(REQ_ID) にした迎え・送りの便を、その日の生活介護の送迎表の保留欄に
   【りんく依頼】として出す（ID lk_<便のID>、kind:"help"）。担当・車は生活介護が決め、それをりんく側に返す（linkStatus）。
   時刻・名前・行き先の変更は付いていく。取り消されたら、まだ保留ならそのまま消し、担当が決まっていれば【取消】と付けて残す（担当者が消す） */
const REQ_ID = "__req__";
function linkReqs(sheet, master) {
  const un = (id) => (((master && master.users) || []).find((u) => u.id === id) || {}).name || "";
  return ((sheet && sheet.runs) || []).filter((r) => r && r.staffId === REQ_ID && (r.kind === "meet" || r.kind === "send")).map((r) => ({
    id: r.id, kind: r.kind, time: r.time || "", names: (r.userIds || []).map(un).filter(Boolean),
    place: Object.values(r.places || {}).filter(Boolean).join("・"), note: String(r.note || "").trim(), durMin: r.durMin }));
}
const linkLabel = (q) => `【りんく依頼】${q.names.join("・") || "（名前なし）"} ${q.kind === "meet" ? "迎え" : "送り"}`;
function linkApply(sheet, reqs) {
  if (!sheet) return sheet;
  let next = null;
  const work = () => (next || (next = clone(sheet)));
  const cur = () => next || sheet;
  const want = new Set(reqs.map((q) => "lk_" + q.id));
  for (const q of reqs) {
    const id = "lk_" + q.id, label = linkLabel(q), note = [q.place, q.note].filter(Boolean).join("・");
    const b = (cur().blocks || []).find((x) => x && x.id === id);
    if (!b) {                                                   // 新しい依頼（パターン読込などで消えた分もここで戻る）
      const n = work(); n.blocks = (n.blocks || []).concat([Object.assign({ id, kind: "help", time: q.time, staffId: HOLD_ID, label, vehicleId: "", userIds: [], linkReq: q.id },
        note ? { note } : {}, q.durMin ? { durMin: q.durMin } : {})]);
      continue;
    }
    if (b.label !== label || b.time !== q.time || (b.note || "") !== note || b.linkCancelled || b.linkReq !== q.id) {
      const n = work(), x = n.blocks.find((y) => y && y.id === id);
      x.label = label; x.time = q.time; x.linkReq = q.id; delete x.linkCancelled;
      if (note) x.note = note; else delete x.note;
    }
  }
  for (const b of (cur().blocks || []).slice()) {
    if (!b || !String(b.id || "").startsWith("lk_") || want.has(b.id)) continue;
    if (b.staffId === HOLD_ID) { const n = work(); n.blocks = n.blocks.filter((x) => !(x && x.id === b.id)); }
    else if (!b.linkCancelled) { const n = work(), x = n.blocks.find((y) => y && y.id === b.id); x.linkCancelled = true; if (!String(x.label || "").startsWith("【取消】")) x.label = "【取消】" + x.label; }
  }
  return next || sheet;
}
/* 生活介護の送迎表で決まった担当・車（りんく側の便ID → {staff, veh}）。担当が決まっていなければ staff は空 */
function linkStatus(sheet, master) {
  const out = {};
  for (const b of (sheet && sheet.blocks) || []) {
    if (!b || !b.linkReq || b.linkCancelled) continue;
    const st = ((master && master.staff) || []).find((s) => s.id === b.staffId);
    const vid = String(b.vehicleId || ""), veh = ((master && master.vehicles) || []).find((v) => v.id === vid);
    out[b.linkReq] = { staff: st ? st.name : "", veh: veh ? veh.name : vid.startsWith("own:") ? "自車" : "" };
  }
  return out;
}

const API = { reconcile, specsFor, summary, TYPE_LABEL, appTime, REQ_ID, linkReqs, linkApply, linkStatus };
if (typeof module !== "undefined" && module.exports) module.exports = API; else G.SGCal = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
