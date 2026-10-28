/* 送迎表ページ（Google版）の起動：ログイン後に保存エンジンをつなぐ */
(function () {
  "use strict";
  const bar = document.getElementById("sg-alert");
  function alertBar(msg, kind, actions) {
    bar.className = "sg-alert " + (kind || ""); bar.innerHTML = "";
    const p = document.createElement("span"); p.textContent = msg; bar.appendChild(p);
    (actions || []).forEach(([label, fn]) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; bar.appendChild(b); });
    const x = document.createElement("button"); x.textContent = "×"; x.setAttribute("aria-label", "閉じる"); x.onclick = () => { bar.hidden = true; }; bar.appendChild(x);
    bar.hidden = false;
  }
  window.__sgAlert = alertBar;
  window.__SG_PAGE = "sougei";
  const H = window.SGHost;
  const kv = SGKVGas.createKVGas({ call: H.call, store: H.store });
  window.__sgkv = kv;
  H.onLogin(() => kv.resume());
  kv.on((ev) => {
    if (ev.type === "loadFailed") alertBar("データを読み込めませんでした。通信を確認して再読み込みしてください。読み込めなかった内容は保存しません（上書き事故を防ぐため）。", "bad", [["再読み込み", () => location.reload()]]);
  });
  H.ready.then(async (me) => {
    const db = await window.claude.use("db");
    window.__sgWatchCalendar = (date, cb) => db.collection("days").where("maxEnd", ">=", date).where("date", "<=", date)
      .onSnapshot((s) => cb(Object.values(TCCore.mergeDays(s.docs.map((d) => d.data())))));
    const hand = () => (window.__sgSetKV ? window.__sgSetKV(kv) : setTimeout(hand, 20)); hand();
    if (!me.canSougei) alertBar("閲覧のみです。送迎表を変更するには、管理者に「送迎表」の権限をもらってください。", "warn");
    if (!H.store.persistent) alertBar("このブラウザでは端末への一時保存が使えません（プライベートモードなど）。未送信の内容がある間は画面を閉じないでください。", "warn");
    window.__sgOpenCalendar = (date) => { if (!H.url("")) { alertBar("カレンダーを開くには、スプレッドシートの「設定」シートのB2に公開URL（最後が /exec）を貼ってください。", "warn"); return; } const a = document.createElement("a"); a.href = H.url("?page=calendar" + (date ? "&d=" + date : "")); a.target = "_top"; document.body.appendChild(a); a.click(); a.remove(); };
    H.startPolling(20000);
  });
  // 画面の部品（いちばん大きいところ）が動かないとき、真っ白のままにせず理由を出す
  setTimeout(() => {
    if (window.__sgSetKV) return;
    const noReact = !window.React || !window.ReactDOM;
    alertBar(noReact
      ? "送迎表の画面の部品（インターネットから読み込む部分）を読み込めませんでした。通信を確かめて再読み込みしてください。"
      : "送迎表の画面を最後まで読み込めませんでした。Apps Script の「sougei」が最後まで貼れているか（一番下が </body></html> か）を確かめ、貼り直してから「デプロイを管理 → 新バージョン」をしてください。", "bad", [["再読み込み", () => location.reload()]]);
  }, 20000);
  window.addEventListener("online", () => kv.resume());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") kv.flushLocal(); else kv.kick(); });
  window.addEventListener("pagehide", () => kv.flushLocal());
  window.addEventListener("beforeunload", (e) => { const st = kv.status(); if (st.queued && !st.persistent) { e.preventDefault(); e.returnValue = ""; } });
  setInterval(() => { if (kv.status().queued && navigator.onLine !== false) kv.kick(); }, 30000);
})();
