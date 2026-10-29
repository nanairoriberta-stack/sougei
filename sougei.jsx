import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as THREE from "three";

/* ============================================================
   介護事業所 送迎表アプリ v2
   - 4部署共有(共有ストレージ保存)
   - 固定パターン(曜日別) + 当日変更
   - 車両・職員の条件から自動提案
   - 休み切替(休みは右端へ) / 保留列 / 利用曜日チェック / Excel出力
   ============================================================ */

// ---------- 定数 ----------
const DAYS = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 表示は月〜日
const SLOT = 30;
const GRID_START = 6 * 60;
const GRID_END = 22 * 60;
const HOLD_ID = "__hold__";
// りんく・ぷれいす版で「生活介護へ依頼」にした便の担当(生活介護の送迎表の保留欄に【りんく依頼】として出る。calsync.js の REQ_ID と同じ)
const REQ_ID = "__req__";
// 依頼した便の、生活介護での対応のようす(sheet.reqStatus はサーバーが書く)
const reqStatusText = (st) => !st ? "生活介護へ依頼" : st.pending ? "生活介護へ依頼(生活介護のこの日の表ができたら入ります)" : st.staff ? `生活介護：${st.staff}${st.veh ? "・" + st.veh : ""}で対応` : "生活介護へ依頼(担当を決めているところ)";
// 料金がかかるAI（API版の 🤖 AI調整・💬 AIと相談）は、Googleのスクリプトのプロパティにキーを入れたときだけボタンを出す（依頼者は使わない判断）。
// 月額プランのClaudeから届く「🤖 Claudeの案」はこれとは別で、いつも出る
const aiApiOn = () => !!(typeof window !== "undefined" && window.SGHost && window.SGHost.me && window.SGHost.me.aiApi);
const SEED_VERSION = 293; // マスタ初期データの版。上げると次回起動時に自動で最新seedへ更新
// Excelに書き出す「どの版で出したか」。Ver293=送迎表の版、括弧内=Google版のファイルの版（gas/Code.gs の APP.VERSION。ログイン時に届く）
const appVerLabel = () => {
  const b = typeof window !== "undefined" && window.SGHost && window.SGHost.me && window.SGHost.me.version;
  return `Ver${SEED_VERSION}${b ? `(${b})` : ""}`;
};

// ===== 版(体制)の設定 =====
// このファイルがどの版かを決める。v1=現体制版 / v2=新体制版(11/1〜) / v3=りんく・ぷれいす版
// ・保存データは版ごとに完全に分かれる(キーの先頭に名前空間が付く)
// ・他の版のURLは画面の「⇄ 版の切替」から登録できる(コードの編集は不要)
const EDITION_INFO = {
  v1: { label: "現体制版", note: "〜10/31", color: "bg-stone-100 text-stone-600 border-stone-300", start: "" },
  v2: { label: "新体制版", note: "11/1〜", color: "bg-emerald-100 text-emerald-800 border-emerald-400", start: "2026-11-01" },
  v3: { label: "りんく・ぷれいす版", note: "", color: "bg-violet-100 text-violet-800 border-violet-400", start: "" },
};
const EDITION = (typeof window !== "undefined" && EDITION_INFO[window.__SG_EDITION]) ? window.__SG_EDITION : "v1";
const EDITION_LABEL = EDITION_INFO[EDITION].label;            // 画面の帯に出す名前
const EDITION_NOTE = EDITION_INFO[EDITION].note;              // 帯の補足
const EDITION_COLOR = EDITION_INFO[EDITION].color;
const EDITION_START = EDITION_INFO[EDITION].start;           // この版の運用開始日(これより前に開いたらこの日を表示)
// 切替先の一覧。urlは画面から登録でき、ここに書いた値は初期値として使われる
const EDITION_LINKS = [
  { edition: "v1", label: "現体制版", url: "" },
  { edition: "v2", label: "新体制版(11/1〜)", url: "" },
  { edition: "v3", label: "りんく・ぷれいす版", url: "" },
];
// 保存キーの名前空間。v1は従来のキーをそのまま使う(既存データを守るため接頭辞なし)
const NS = EDITION === "v1" ? "" : `${EDITION}:`;
const nsKey = (key) => (NS && !String(key).startsWith(NS) ? NS + key : key);
const SEED_PATTERNS = EDITION === "v3" ? {} : {"mon": {"runs": [{"kind": "meet", "time": "8:00", "staffName": "八壁", "vehName": "鬼滅", "userNames": ["成相"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "吉岡", "vehName": "ピカチュウ", "userNames": ["中村", "森", "竹田真", "星野", "森井", "岡本", "田中慶"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "白戸", "vehName": "セレナ", "userNames": ["楢木", "太田", "小川"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "八壁", "vehName": "マイメロ", "userNames": ["野津彩", "早川", "田原"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "日野", "vehName": "チョッパー", "userNames": ["赤山", "小林"], "riderNames": []}, {"kind": "own_move", "time": "8:30", "staffName": "石原", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "own_move", "time": "8:30", "staffName": "村松", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "own_move", "time": "8:30", "staffName": "岡部", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "藤原", "vehName": "ムック", "userNames": ["山崎", "森口", "梶谷奏"], "riderNames": [], "note": "あい迎①"}, {"kind": "meet", "time": "8:30", "staffName": "伊達", "vehName": "鬼滅", "userNames": ["錦織り"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "日野", "vehName": "チョッパー", "userNames": ["勝部", "ホン"], "riderNames": []}, {"kind": "own_move", "time": "9:00", "staffName": "春日", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "石原", "vehName": "トラッキー", "userNames": ["岩垣", "松本"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "余村和", "vehName": "ノンタン", "userNames": ["青山", "藤井"], "riderNames": [], "note": "あい迎②"}, {"kind": "meet", "time": "9:00", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["米原", "錦織秀"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "横田", "vehName": "ミッフィー", "userNames": ["八壁", "竹田寛"], "riderNames": []}, {"kind": "meet", "time": "9:30", "staffName": "川島", "vehName": "ドラ", "userNames": ["園山", "津田", "菊谷"], "riderNames": []}, {"kind": "send", "mode": "train", "time": "10:00", "staffName": "日野", "vehName": "トラッキー", "userNames": ["早川"], "riderNames": []}, {"kind": "meet", "mode": "train", "time": "11:00", "staffName": "藤原", "vehName": "ムック", "userNames": ["成相"], "riderNames": []}, {"kind": "meet", "mode": "train", "time": "12:00", "staffName": "石原", "vehName": "トラッキー", "userNames": ["早川"], "riderNames": []}, {"kind": "send", "time": "13:00", "staffName": "日野", "vehName": "マイメロ", "userNames": ["黒田"], "riderNames": []}, {"kind": "send", "time": "13:00", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["森口"], "riderNames": []}, {"kind": "send", "time": "13:30", "staffName": "余村和", "vehName": "ノンタン", "userNames": [], "riderNames": []}, {"kind": "send", "time": "14:30", "staffName": "藤原", "vehName": "ノンタン", "userNames": [], "riderNames": []}, {"kind": "send", "time": "15:00", "staffName": "岡部", "vehName": "トラッキー", "userNames": ["錦織秀"], "riderNames": []}, {"kind": "send", "time": "15:00", "staffName": "藤原", "vehName": "鬼滅", "userNames": ["青山"], "riderNames": []}, {"kind": "send", "time": "15:00", "staffName": "伊達", "vehName": "ムック", "userNames": ["梶谷奏", "山崎", "錦織り"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "高井", "vehName": "セレナ", "userNames": ["竹田真", "園山"], "riderNames": []}, {"kind": "send", "time": "15:30", "staffName": "安達", "vehName": "ケロッピー", "userNames": ["勝部", "ホン"], "riderNames": []}, {"kind": "send", "time": "15:30", "staffName": "吉岡", "vehName": "ピカチュウ", "userNames": ["楢木", "太田", "田中慶"], "riderNames": []}, {"kind": "send", "time": "15:30", "staffName": "日野", "vehName": "マイメロ", "userNames": ["早川", "岩垣", "野津彩", "米原"], "riderNames": []}, {"kind": "send", "time": "15:30", "staffName": "岡部", "vehName": "トラッキー", "userNames": ["赤山", "小林"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "石原", "vehName": "チョッパー", "userNames": ["田原"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "安達", "vehName": "ピカチュウ", "userNames": ["八壁", "小川", "野津周"], "riderNames": []}, {"kind": "send", "time": "17:00", "staffName": "白戸", "vehName": "セレナ", "userNames": ["森", "星野", "菊谷", "津田", "岡本", "森井", "中村"], "riderNames": []}, {"kind": "send", "time": "17:00", "staffName": "安達", "vehName": "ケロッピー", "userNames": ["竹田寛"], "riderNames": []}, {"kind": "send", "time": "17:30", "staffName": "八壁", "vehName": "鬼滅", "userNames": ["成相"], "riderNames": []}, {"kind": "send", "time": "17:30", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["藤井"], "riderNames": [], "note": "あい施錠"}, {"kind": "send", "mode": "move", "time": "15:00", "staffName": "藤原", "vehName": "", "userNames": ["成相"], "riderNames": [], "note": "あいのて→嫁島"}, {"kind": "send", "time": "16:00", "staffName": "池田", "vehName": "", "userNames": ["田中か"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "池田", "vehName": "ケロッピー", "userNames": ["田中か"], "riderNames": []}, {"kind": "send", "mode": "train", "time": "14:15", "staffName": "", "vehName": "", "userNames": ["松本"], "riderNames": [], "trainBothNames": ["松本"], "note": "東部(訓練)"}, {"kind": "send", "mode": "train", "time": "15:00", "staffName": "", "vehName": "", "userNames": ["増野"], "riderNames": [], "trainBothNames": ["増野"], "note": "東部(訓練)"}], "blocks": [{"kind": "help", "time": "8:00", "staffName": "井川", "label": "黒田ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "8:00", "staffName": "久保田", "label": "藤井ヘルプ", "vehName": "カービィ"}, {"kind": "block", "time": "8:30", "staffName": "高井", "label": "嫁島受入"}, {"kind": "block", "time": "8:30", "staffName": "成瀬", "label": "川津開錠"}, {"kind": "block", "time": "8:30", "staffName": "余村和", "label": "あい開錠"}, {"kind": "block", "time": "9:00", "staffName": "吉岡", "label": "野津周受入"}, {"kind": "help", "time": "9:30", "staffName": "余村和", "label": "野津涼ヘルプ"}, {"kind": "block", "time": "9:30", "staffName": "近藤", "label": "松本対応"}, {"kind": "block", "time": "10:00", "staffName": "池田", "label": "ピカ・セレナ交換"}, {"kind": "help", "time": "10:00", "staffName": "近藤", "label": "尾原ヘルプ"}, {"kind": "block", "time": "12:00", "staffName": "高井", "label": "透析"}, {"kind": "help", "time": "15:00", "staffName": "余村和", "label": "吉浦ヘルプ", "vehName": "__own__", "durMin": 60}, {"kind": "help", "time": "16:00", "staffName": "橋本", "label": "伊達ヘルプ", "vehName": "__own__"}, {"kind": "block", "time": "16:00", "staffName": "高井", "label": "薬セット"}, {"kind": "block", "time": "16:00", "staffName": "日野", "label": "同:八壁"}, {"kind": "block", "time": "16:00", "staffName": "成瀬", "label": "猪原対応"}, {"kind": "help", "time": "17:00", "staffName": "余村和", "label": "青山ヘルプ", "vehName": "__own__"}, {"kind": "help", "time": "16:00", "staffName": "横田", "label": "黒田ヘルプ", "vehName": "ミッフィー"}, {"kind": "help", "time": "16:00", "staffName": "近藤", "label": "黒田ヘルプ"}, {"kind": "help", "time": "17:00", "staffName": "井川", "label": "井上ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "17:00", "staffName": "近藤", "label": "井上ヘルプ", "vehName": "__own__"}, {"kind": "block", "time": "17:00", "staffName": "田邊", "label": "透析"}, {"kind": "block", "time": "17:30", "staffName": "成瀬", "label": "川津施錠"}, {"kind": "help", "time": "18:00", "staffName": "余村和", "label": "竹田寛ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "18:00", "staffName": "井川", "label": "藤井ヘルプ"}, {"kind": "help", "time": "16:00", "staffName": "余村和", "label": "曳野ヘルプ"}], "training": ["早川 10:30〜(東部)", "成相 10:30〜(東部)", "松本 14:15〜(東部)", "増野 15:00〜(東部)"]}, "tue": {"runs": [{"kind": "send", "mode": "train", "time": "8:00", "staffName": "吉岡", "vehName": "ケロッピー", "userNames": ["野津彩"], "riderNames": [], "trainDropNames": ["野津彩"], "note": "自宅→そのまま訓練先へ(迎え兼)"}, {"kind": "meet", "time": "8:30", "staffName": "安達", "vehName": "ピカチュウ", "userNames": ["赤山", "園山", "森", "竹田真", "星野", "岡本", "菊谷"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "安部", "vehName": "ミッフィー", "userNames": ["森井"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "八壁", "vehName": "マイメロ", "userNames": ["梶谷奏", "田原", "錦織り"], "riderNames": ["日野"]}, {"kind": "own_move", "time": "8:30", "staffName": "成瀬", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "石原", "vehName": "トラッキー", "userNames": ["松本"], "riderNames": [], "note": "野津彩東部迎"}, {"kind": "own_move", "time": "8:30", "staffName": "村松", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "岡部", "vehName": "チョッパー", "userNames": ["錦織秀", "米原"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "藤原", "vehName": "鬼滅", "userNames": [], "riderNames": [], "note": "開錠"}, {"kind": "meet", "time": "8:30", "staffName": "伊達", "vehName": "ガチャ", "userNames": ["山崎", "森口"], "riderNames": [], "note": "あい迎①"}, {"kind": "meet", "time": "9:00", "staffName": "高井", "vehName": "ケロッピー", "userNames": ["田中か"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "安部", "vehName": "セレナ", "userNames": ["太田", "八壁", "小川", "野津周", "早川"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "吉岡", "vehName": "チョッパー", "userNames": ["橋本", "田中慶"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "成瀬", "vehName": "トラッキー", "userNames": ["黒田"], "riderNames": []}, {"kind": "own_move", "time": "9:00", "staffName": "春日", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "藤原", "vehName": "ノンタン", "userNames": ["青山", "増野", "藤井"], "riderNames": [], "note": "あい迎②"}, {"kind": "meet", "time": "9:00", "staffName": "田邊", "vehName": "ムック", "userNames": ["岩垣", "梶谷光"], "riderNames": [], "note": "吉岡津田送り"}, {"kind": "meet", "time": "9:30", "staffName": "川島", "vehName": "ドラ", "userNames": ["中村", "津田"], "riderNames": []}, {"kind": "meet", "mode": "train", "time": "10:00", "staffName": "田邊", "vehName": "ムック", "userNames": ["成相"], "riderNames": []}, {"kind": "send", "time": "12:40", "staffName": "八壁", "vehName": "トラッキー", "userNames": ["錦織秀"], "riderNames": [], "note": "13:00着の単独送り"}, {"kind": "send", "time": "14:30", "staffName": "日野", "vehName": "トラッキー", "userNames": ["黒田"], "riderNames": [], "mode": "train", "trainBothNames": ["黒田"], "note": "川津14:30発 東部リハ送り"}, {"kind": "send", "time": "14:00", "staffName": "伊達", "vehName": "ムック", "userNames": ["青山", "松本"], "riderNames": []}, {"kind": "send", "time": "15:00", "staffName": "高井", "vehName": "ドナルド", "userNames": ["田中か"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "白戸", "vehName": "セレナ", "userNames": ["園山", "森", "竹田真", "星野", "岡本", "津田", "菊谷"], "riderNames": []}, {"kind": "send", "time": "15:00", "staffName": "日野", "vehName": "マイメロ", "userNames": ["梶谷奏", "野津彩", "米原", "錦織り"], "riderNames": ["八壁"]}, {"kind": "send", "time": "15:00", "staffName": "田邊", "vehName": "鬼滅", "userNames": ["増野"], "riderNames": []}, {"kind": "send", "time": "15:30", "staffName": "村松", "vehName": "トラッキー", "userNames": ["田原"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "池田", "vehName": "ケロッピー", "userNames": ["赤山"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "安達", "vehName": "ピカチュウ", "userNames": ["田中慶", "太田", "野津周", "橋本"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "吉岡", "vehName": "ミッフィー", "userNames": ["八壁", "小川"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "藤原", "vehName": "鬼滅", "userNames": ["岩垣", "山崎", "森口"], "riderNames": []}, {"kind": "send", "time": "17:00", "staffName": "伊達", "vehName": "ムック", "userNames": ["梶谷光"], "riderNames": []}, {"kind": "send", "time": "17:00", "staffName": "田邊", "vehName": "", "userNames": ["藤井"], "riderNames": []}, {"kind": "send", "time": "18:00", "staffName": "田邊", "vehName": "", "userNames": ["成相"], "riderNames": []}, {"kind": "send", "time": "18:00", "staffName": "新見", "vehName": "セレナ", "userNames": ["森井", "中村"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "日野", "vehName": "マイメロ", "userNames": ["早川"], "note": "相性の分離便(梶谷奏と同乗NGのため)"}, {"kind": "meet", "mode": "train", "time": "9:30", "staffName": "", "vehName": "", "userNames": ["野津彩"], "riderNames": [], "note": "東部から迎え(松本・石田をあいのてへ送った後に東部へ)"}], "blocks": [{"kind": "help", "time": "8:00", "staffName": "井川", "label": "黒田ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "8:00", "staffName": "余村慎", "label": "藤井ヘルプ", "vehName": "__own__"}, {"kind": "help", "time": "9:30", "staffName": "窪田", "label": "星野ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "9:30", "staffName": "余村慎", "label": "野津涼ヘルプ", "vehName": "ノンタン"}, {"kind": "block", "time": "12:00", "staffName": "石原", "label": "早退"}, {"kind": "block", "time": "12:00", "staffName": "高井", "label": "透析"}, {"kind": "block", "time": "15:30", "staffName": "八壁", "label": "尾原実習打ち合わせ"}, {"kind": "block", "time": "16:00", "staffName": "田邊", "label": "透析"}, {"kind": "help", "time": "17:00", "staffName": "近藤", "label": "井上ヘルプ", "vehName": "__own__"}, {"kind": "help", "time": "17:00", "staffName": "余村慎", "label": "井上ヘルプ", "vehName": "__own__"}, {"kind": "block", "time": "17:30", "staffName": "田邊", "label": "施錠"}, {"kind": "help", "time": "18:00", "staffName": "井川", "label": "藤井ヘルプ"}, {"kind": "help", "time": "15:00", "staffName": "長島", "label": "赤山入浴(津田)"}], "training": ["黒田15:00~", "田原16:00~", "成相10:40迎え", "野津彩9:00～", "野津彩"]}, "fri": {"runs": [{"kind": "send", "mode": "train", "time": "8:00", "staffName": "田邊", "vehName": "ケロッピー", "userNames": ["野津彩"], "riderNames": [], "trainDropNames": ["野津彩"], "note": "自宅→そのまま訓練先へ(迎え兼)"}, {"kind": "meet", "time": "8:30", "staffName": "安達", "vehName": "ピカチュウ", "userNames": ["赤山", "中村", "竹田真", "星野", "岡本", "園山"], "note": "リベ迎①(8:15赤山から拾う)"}, {"kind": "meet", "time": "8:30", "staffName": "白戸", "vehName": "セレナ", "userNames": ["太田", "小川", "野津周", "戸井", "須山", "楢木"], "note": "リベ迎②"}, {"kind": "meet", "time": "8:30", "staffName": "日野", "vehName": "マイメロ", "userNames": ["早川", "岩垣", "小林", "青木", "田原", "米原"], "note": "リベ迎③+川津自宅組"}, {"kind": "meet", "time": "8:30", "staffName": "安部", "vehName": "ミッフィー", "userNames": ["森井"]}, {"kind": "meet", "time": "9:00", "staffName": "安達", "vehName": "ピカチュウ", "userNames": ["田中慶"]}, {"kind": "meet", "time": "9:00", "staffName": "成瀬", "vehName": "チョッパー", "userNames": ["黒田"]}, {"kind": "meet", "time": "9:00", "staffName": "藤原", "vehName": "鬼滅", "userNames": ["増野", "青山", "藤井", "松本", "梶谷奏"], "note": "あい迎(同乗:八壁)"}, {"kind": "meet", "time": "9:00", "staffName": "新見", "vehName": "ドラ", "userNames": ["森", "津田"], "note": "リベ発"}, {"kind": "meet", "time": "9:30", "staffName": "伊達", "vehName": "ムック", "userNames": ["山崎", "錦織り"], "note": "厚生センター迎え"}, {"kind": "meet", "time": "9:00", "staffName": "池田", "userNames": ["三澤"], "note": "徒歩迎え", "mode": "walk"}, {"kind": "meet", "time": "10:30", "staffName": "日野", "vehName": "マイメロ", "userNames": ["野津彩"], "note": "訓練迎え", "mode": "train"}, {"kind": "send", "time": "15:00", "staffName": "藤原", "vehName": "鬼滅", "userNames": ["森口"]}, {"kind": "send", "time": "15:00", "staffName": "伊達", "vehName": "ガチャ", "userNames": ["増野"], "note": "東部(訓練)", "mode": "train", "trainBothNames": ["増野"]}, {"kind": "send", "time": "15:00", "staffName": "池田", "vehName": "ケロッピー", "userNames": ["赤山"], "note": "津田へ入浴(15:00〜)", "mode": "move"}, {"kind": "send", "time": "15:30", "staffName": "春日", "vehName": "トラッキー", "userNames": ["黒田"], "note": "東部リハ送り15:30発(単独)", "mode": "train", "trainBothNames": ["黒田"]}, {"kind": "send", "time": "16:00", "staffName": "高井", "vehName": "セレナ", "userNames": ["園山", "竹田真", "三澤"], "note": "三澤帰宅同乗"}, {"kind": "send", "time": "16:00", "staffName": "白戸", "vehName": "ミッフィー", "userNames": ["森井", "小川", "田中慶"]}, {"kind": "send", "time": "16:00", "staffName": "安部", "vehName": "ピカチュウ", "userNames": ["太田", "野津周", "戸井", "須山", "楢木"], "note": "リベ送①"}, {"kind": "send", "time": "16:00", "staffName": "石原", "vehName": "チョッパー", "userNames": ["小林", "青木", "田原"]}, {"kind": "send", "time": "16:00", "staffName": "伊達", "vehName": "ムック", "userNames": ["山崎", "青山", "松本"], "note": "厚生センター16時送り・青山ヘルプへ"}, {"kind": "send", "time": "16:00", "staffName": "村松", "userNames": ["錦織り"], "note": "車は当日調整"}, {"kind": "send", "time": "16:30", "staffName": "日野", "vehName": "マイメロ", "userNames": ["野津彩", "岩垣", "米原", "梶谷奏"], "note": "リベ送②(混載)"}, {"kind": "send", "time": "17:00", "staffName": "高井", "vehName": "セレナ", "userNames": ["森", "星野", "岡本", "津田", "早川", "中村"], "note": "リベ送③"}, {"kind": "send", "time": "17:00", "staffName": "池田", "vehName": "ケロッピー", "userNames": ["赤山"], "note": "入浴後帰宅"}, {"kind": "send", "time": "17:30", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["藤井"]}], "blocks": [{"kind": "help", "time": "8:00", "staffName": "井川", "label": "黒田ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "8:00", "staffName": "余村慎", "label": "藤井ヘルプ", "vehName": "__own__"}, {"kind": "help", "time": "9:30", "staffName": "余村和", "label": "野津涼ヘルプ"}, {"kind": "help", "time": "10:00", "staffName": "近藤", "label": "尾原ヘルプ"}, {"kind": "help", "time": "16:00", "staffName": "余村和", "label": "青山ヘルプ"}, {"kind": "help", "time": "18:00", "staffName": "余村慎", "label": "竹田寛ヘルプ", "note": "他のヘルプがすべて終わった後(残業可)"}, {"kind": "help", "time": "18:00", "staffName": "井川", "label": "藤井ヘルプ"}, {"kind": "block", "time": "8:30", "staffName": "成瀬", "label": "かわつ開錠"}, {"kind": "block", "time": "9:00", "staffName": "高井", "label": "請求事務・薬セット"}, {"kind": "block", "time": "9:30", "staffName": "近藤", "label": "松本介助"}, {"kind": "block", "time": "10:30", "staffName": "伊達", "label": "増野・山崎モニタリング"}, {"kind": "block", "time": "12:00", "staffName": "伊達", "label": "透析"}, {"kind": "block", "time": "15:00", "staffName": "川島", "label": "野津彩受診"}, {"kind": "block", "time": "17:00", "staffName": "成瀬", "label": "猪原対応"}, {"kind": "block", "time": "17:00", "staffName": "田邊", "label": "透析"}, {"kind": "block", "time": "18:00", "staffName": "田邊", "label": "あいのて施錠"}, {"kind": "block", "time": "14:00", "staffName": "中谷", "label": "退勤"}, {"kind": "block", "time": "14:00", "staffName": "秋山", "label": "退勤"}, {"kind": "block", "time": "18:00", "staffName": "近藤", "label": "退勤"}, {"kind": "help", "time": "16:00", "staffName": "余村慎", "label": "曳野ヘルプ"}, {"kind": "help", "time": "11:00", "staffName": "余村慎", "label": "伊達ヘルプ"}, {"kind": "help", "time": "17:00", "staffName": "余村慎", "label": "井上入浴"}, {"kind": "help", "time": "17:00", "staffName": "近藤", "label": "井上入浴"}], "training": ["増野 15:00〜", "黒田 16:00〜", "野津彩"]}, "wed": {"runs": [{"kind": "meet", "time": "8:00", "staffName": "八壁", "vehName": "ガチャ", "userNames": ["成相"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "高井", "vehName": "ピカチュウ", "userNames": ["中村", "園山", "竹田真", "星野", "岡本", "菊谷", "田中慶"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "白戸", "vehName": "セレナ", "userNames": ["野津周", "八壁", "戸井", "須山", "太田", "小川", "楢木"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "安達", "vehName": "ケロッピー", "userNames": ["森井"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "吉岡", "vehName": "ミッフィー", "userNames": ["田中か"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "八壁", "vehName": "マイメロ", "userNames": ["赤山", "田原", "青木", "岩垣", "野津彩", "小林"], "riderNames": []}, {"kind": "own_move", "time": "8:30", "staffName": "石原", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "own_move", "time": "8:30", "staffName": "村松", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "own_move", "time": "8:30", "staffName": "岡部", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "藤原", "vehName": "鬼滅", "userNames": ["石田"], "riderNames": [], "note": "成相同乗 日野同乗"}, {"kind": "meet", "time": "8:30", "staffName": "伊達", "vehName": "ムック", "userNames": ["山崎", "梶谷奏"], "riderNames": [], "note": "あい迎①"}, {"kind": "meet", "mode": "walk", "time": "9:00", "staffName": "池田", "vehName": "", "userNames": ["門脇"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "吉岡", "vehName": "ミッフィー", "userNames": ["橋本"], "riderNames": []}, {"kind": "own_move", "time": "9:00", "staffName": "春日", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "岡部", "vehName": "トラッキー", "userNames": ["勝部", "ホン"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "余村和", "vehName": "ノンタン", "userNames": ["藤井"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["錦織り", "米原", "錦織秀"], "riderNames": []}, {"kind": "meet", "time": "9:30", "staffName": "余村慎", "vehName": "ドラ", "userNames": ["森", "津田"], "riderNames": []}, {"kind": "meet", "time": "9:30", "staffName": "岡部", "vehName": "トラッキー", "userNames": ["増野"], "riderNames": []}, {"kind": "meet", "time": "9:30", "staffName": "余村和", "vehName": "ノンタン", "userNames": ["青山"], "riderNames": []}, {"kind": "send", "time": "12:40", "staffName": "成瀬", "vehName": "トラッキー", "userNames": ["錦織秀"], "riderNames": [], "note": "13:00着の単独送り"}, {"kind": "send", "time": "14:30", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["山崎"], "riderNames": []}, {"kind": "send", "time": "15:00", "staffName": "安達", "vehName": "ミッフィー", "userNames": ["八壁", "橋本"], "riderNames": []}, {"kind": "send", "time": "15:00", "staffName": "吉岡", "vehName": "ピカチュウ", "userNames": ["野津周", "田中慶", "楢木", "太田", "小川", "戸井", "須山"], "riderNames": []}, {"kind": "send", "time": "15:30", "staffName": "成瀬", "vehName": "トラッキー", "userNames": ["黒田", "田原"], "riderNames": [], "note": "川津15:30発。田原は東部リハへ(黒田の自宅送りに同乗)", "trainBothNames": ["田原"]}, {"kind": "send", "time": "17:00", "staffName": "石原", "vehName": "トラッキー", "userNames": ["岩垣"], "riderNames": []}, {"kind": "send", "time": "15:30", "staffName": "藤原", "vehName": "ガチャ", "userNames": [], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "白戸", "vehName": "セレナ", "userNames": ["竹田真", "園山", "岡本", "門脇"], "riderNames": [], "note": "門脇帰宅同乗"}, {"kind": "send", "time": "16:00", "staffName": "池田", "vehName": "チョッパー", "userNames": ["勝部", "ホン"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "八壁", "vehName": "マイメロ", "userNames": ["野津彩", "青木", "米原"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "岡部", "vehName": "トラッキー", "userNames": ["小林", "赤山"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "日野", "vehName": "鬼滅", "userNames": ["錦織り"], "riderNames": ["藤原"]}, {"kind": "send", "time": "16:00", "staffName": "伊達", "vehName": "ムック", "userNames": ["石田", "梶谷奏"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["青山"], "riderNames": []}, {"kind": "send", "time": "17:00", "staffName": "白戸", "vehName": "セレナ", "userNames": ["星野", "森", "津田", "菊谷"], "riderNames": []}, {"kind": "send", "time": "17:30", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["藤井"], "riderNames": [], "note": "施錠"}, {"kind": "send", "time": "18:00", "staffName": "八壁", "vehName": "ガチャ", "userNames": ["成相"], "riderNames": []}, {"kind": "send", "time": "18:00", "staffName": "日野", "vehName": "セレナ", "userNames": ["森井", "中村"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "吉岡", "vehName": "", "userNames": ["田中か"], "riderNames": []}, {"kind": "send", "mode": "train", "time": "16:00", "staffName": "", "vehName": "", "userNames": ["増野"], "riderNames": [], "trainBothNames": ["増野"], "note": "東部(訓練)"}], "blocks": [{"kind": "help", "time": "8:00", "staffName": "井川", "label": "黒田ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "8:00", "staffName": "久保田", "label": "藤井ヘルプ", "vehName": "カービィ"}, {"kind": "block", "time": "8:30", "staffName": "成瀬", "label": "開錠"}, {"kind": "block", "time": "8:30", "staffName": "余村和", "label": "あいのて開錠"}, {"kind": "help", "time": "9:30", "staffName": "余村和", "label": "野津涼ヘルプ"}, {"kind": "block", "time": "12:00", "staffName": "伊達", "label": "藤井透析"}, {"kind": "help", "time": "15:00", "staffName": "余村和", "label": "伊達ヘルプ"}, {"kind": "help", "time": "16:00", "staffName": "安部", "label": "黒田入浴ヘルプ", "vehName": "__own__"}, {"kind": "help", "time": "16:00", "staffName": "長島", "label": "黒田ヘルプ", "vehName": "__own__"}, {"kind": "help", "time": "16:00", "staffName": "余村和", "label": "青山ヘルプ"}, {"kind": "help", "time": "18:00", "staffName": "井川", "label": "藤井ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "17:00", "staffName": "八壁", "label": "野津涼ヘルプ"}, {"kind": "block", "time": "17:00", "staffName": "田邊", "label": "藤井透析"}, {"kind": "block", "time": "17:30", "staffName": "成瀬", "label": "施錠"}, {"kind": "block", "time": "12:00", "staffName": "池田", "label": "透析"}, {"kind": "help", "time": "9:00", "staffName": "窪田", "label": "松浦ヘルプ"}, {"kind": "help", "time": "17:00", "staffName": "余村和", "label": "曳野ヘルプ"}, {"kind": "help", "time": "17:00", "staffName": "安部", "label": "井上入浴"}, {"kind": "help", "time": "17:00", "staffName": "井川", "label": "井上入浴"}], "training": ["山崎15:00~", "増野16:00~", "田原16:00~"]}, "thu": {"runs": [{"kind": "meet", "time": "8:30", "staffName": "白戸", "vehName": "ミッフィー", "userNames": ["森井"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "池田", "vehName": "ピカチュウ", "userNames": ["森", "岡本", "園山", "竹田真", "中村", "星野"], "riderNames": [], "note": "リベ迎①"}, {"kind": "meet", "time": "8:30", "staffName": "安部", "vehName": "セレナ", "userNames": ["太田", "戸井", "須山", "小川", "楢木"], "riderNames": [], "note": "リベ迎②"}, {"kind": "meet", "time": "8:30", "staffName": "八壁", "vehName": "マイメロ", "userNames": ["赤山", "野津彩", "田原", "黒田"], "riderNames": []}, {"kind": "meet", "time": "8:30", "staffName": "日野", "vehName": "鬼滅", "userNames": ["松本", "石田"], "riderNames": [], "note": "藤原同乗"}, {"kind": "own_move", "time": "8:30", "staffName": "成瀬", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "石原", "vehName": "チョッパー", "userNames": ["米原", "錦織秀"], "riderNames": []}, {"kind": "own_move", "time": "8:30", "staffName": "石原", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "own_move", "time": "8:30", "staffName": "村松", "vehName": "", "userNames": [], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "余村和", "vehName": "ノンタン", "userNames": ["増野", "青山", "藤井"], "riderNames": [], "note": "あい迎②"}, {"kind": "meet", "time": "8:30", "staffName": "伊達", "vehName": "ムック", "userNames": ["梶谷奏", "山崎", "森口"], "riderNames": [], "note": "あい迎①・森口は東部おろし", "trainDropNames": ["森口"]}, {"kind": "meet", "time": "9:00", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["錦織り", "岩垣"], "riderNames": []}, {"kind": "meet", "time": "9:30", "staffName": "藤原", "vehName": "鬼滅", "userNames": ["井上"], "riderNames": [], "note": "自宅→東部(10時着)"}, {"kind": "meet", "time": "11:00", "staffName": "成瀬", "vehName": "チョッパー", "userNames": ["梶谷光"], "riderNames": [], "note": "梶谷光迎え"}, {"kind": "other_run", "time": "11:00", "staffName": "藤原", "vehName": "鬼滅", "userNames": ["井上"], "riderNames": [], "note": "森口迎え （東部）"}, {"kind": "send", "time": "15:30", "staffName": "八壁", "vehName": "マイメロ", "userNames": ["黒田", "田原"], "riderNames": [], "note": "川津15:30発。田原は東部リハへ(黒田の自宅送りに同乗)", "trainBothNames": ["田原"]}, {"kind": "send", "time": "15:00", "staffName": "石原", "vehName": "チョッパー", "userNames": ["錦織秀"], "riderNames": [], "note": "（送り後嫁島へ）"}, {"kind": "send", "time": "15:30", "staffName": "余村和", "vehName": "鬼滅", "userNames": ["青山", "松本", "錦織り"], "riderNames": [], "note": "リベ送(錦織り)含む"}, {"kind": "send", "time": "15:00", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["森口"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "白戸", "vehName": "ミッフィー", "userNames": ["小川"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "村松", "vehName": "トラッキー", "userNames": ["井上"], "riderNames": []}, {"kind": "send", "time": "16:00", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["増野"], "riderNames": []}, {"kind": "send", "time": "17:00", "staffName": "八壁", "vehName": "マイメロ", "userNames": ["野津彩", "梶谷光", "米原", "赤山"], "riderNames": []}, {"kind": "send", "time": "17:30", "staffName": "田邊", "vehName": "ガチャ", "userNames": ["藤井"], "riderNames": []}, {"kind": "send", "time": "18:00", "staffName": "新見", "vehName": "セレナ", "userNames": ["森井", "中村"], "riderNames": []}, {"kind": "meet", "time": "9:00", "staffName": "成瀬", "vehName": "トラッキー", "userNames": ["勝部", "ホン"]}, {"kind": "meet", "time": "9:00", "staffName": "池田", "vehName": "ピカチュウ", "userNames": ["田中慶"]}, {"kind": "meet", "time": "9:30", "staffName": "新見", "vehName": "ドラ", "userNames": ["津田"], "note": "リベ発"}, {"kind": "send", "time": "15:30", "staffName": "池田", "vehName": "ドナルド", "userNames": ["勝部", "ホン"], "note": "プール送り(津田さん同乗・17:00プール迎えあり)"}, {"kind": "send", "time": "15:30", "staffName": "伊達", "vehName": "ムック", "userNames": ["山崎"], "note": "厚生センター送16時着"}, {"kind": "send", "time": "16:00", "staffName": "伊達", "vehName": "ムック", "userNames": ["岩垣", "梶谷奏"]}, {"kind": "send", "time": "16:00", "staffName": "安達", "vehName": "ピカチュウ", "userNames": ["田中慶", "太田", "野津周", "戸井", "須山", "楢木"], "note": "リベ送(津田)"}, {"kind": "send", "time": "16:00", "staffName": "高井", "vehName": "セレナ", "userNames": ["園山", "森", "竹田真", "星野", "岡本", "三澤"], "note": "リベ送(嫁島)・三澤帰宅同乗"}, {"kind": "send", "time": "17:00", "staffName": "白戸", "vehName": "チョッパー", "userNames": ["津田"], "note": "プール迎え→リベルタ"}, {"kind": "meet", "time": "9:00", "staffName": "安達", "userNames": ["三澤"], "note": "徒歩迎え", "mode": "walk"}, {"kind": "send", "mode": "train", "time": "10:15", "staffName": "", "vehName": "", "userNames": ["井上"], "riderNames": [], "note": "東部(訓練)"}, {"kind": "meet", "mode": "train", "time": "12:00", "staffName": "", "vehName": "", "userNames": ["井上", "森口"], "riderNames": [], "note": "東部(訓練迎え)"}, {"kind": "meet", "mode": "train", "time": "11:40", "staffName": "", "vehName": "", "userNames": ["梶谷光"], "riderNames": [], "note": "医療センターへリハ迎え(11:40着)"}], "blocks": [{"kind": "help", "time": "8:00", "staffName": "井川", "label": "黒田ヘルプ", "vehName": "ドナルド"}, {"kind": "help", "time": "8:00", "staffName": "久保田", "label": "藤井ヘルプ", "vehName": "カービィ"}, {"kind": "help", "time": "9:00", "staffName": "久保田", "label": "松浦ヘルプ", "vehName": "ケロッピー"}, {"kind": "help", "time": "9:30", "staffName": "余村和", "label": "野津涼ヘルプ"}, {"kind": "help", "time": "11:00", "staffName": "久保田", "label": "松浦ヘルプ"}, {"kind": "block", "time": "9:30", "staffName": "余村慎", "label": "松本トイレ対応", "note": "あいのて"}, {"kind": "block", "time": "11:00", "staffName": "安達", "label": "セレナとピカ交換"}, {"kind": "block", "time": "12:00", "staffName": "池田", "label": "透析"}, {"kind": "help", "time": "16:00", "staffName": "安部", "label": "黒田入浴"}, {"kind": "block", "time": "16:00", "staffName": "春日", "label": "退勤"}, {"kind": "help", "time": "16:00", "staffName": "余村和", "label": "黒田入浴"}, {"kind": "help", "time": "17:00", "staffName": "井川", "label": "井上入浴"}, {"kind": "help", "time": "17:00", "staffName": "安部", "label": "井上入浴"}, {"kind": "help", "time": "17:00", "staffName": "余村和", "label": "野津涼ヘルプ"}, {"kind": "block", "time": "17:00", "staffName": "田邊", "label": "藤井（透析）"}, {"kind": "block", "time": "18:00", "staffName": "田邊", "label": "あいのて施錠"}, {"kind": "block", "time": "17:00", "staffName": "村松", "label": "猪原対応"}, {"kind": "block", "time": "17:30", "staffName": "村松", "label": "自車　退勤"}, {"kind": "block", "time": "17:30", "staffName": "岡部", "label": "自車　退勤"}, {"kind": "help", "time": "18:00", "staffName": "井川", "label": "藤井入浴"}, {"kind": "help", "time": "14:00", "staffName": "窪田", "label": "松浦ヘルプ"}], "training": ["井上", "梶谷光", "田原"]}};

const DEPT_COLORS = [
  { band: "bg-sky-500", soft: "bg-sky-50", chip: "bg-sky-100 border-sky-300 text-sky-900", text: "text-sky-700", hex: "#e0f2fe" },
  { band: "bg-amber-500", soft: "bg-amber-50", chip: "bg-amber-100 border-amber-300 text-amber-900", text: "text-amber-700", hex: "#fef3c7" },
  { band: "bg-emerald-500", soft: "bg-emerald-50", chip: "bg-emerald-100 border-emerald-300 text-emerald-900", text: "text-emerald-700", hex: "#d1fae5" },
  { band: "bg-rose-500", soft: "bg-rose-50", chip: "bg-rose-100 border-rose-300 text-rose-900", text: "text-rose-700", hex: "#ffe4e6" },
  { band: "bg-violet-500", soft: "bg-violet-50", chip: "bg-violet-100 border-violet-300 text-violet-900", text: "text-violet-700", hex: "#ede9fe" },
  { band: "bg-cyan-600", soft: "bg-cyan-50", chip: "bg-cyan-100 border-cyan-300 text-cyan-900", text: "text-cyan-700", hex: "#cffafe" },
];

const RUN_KINDS = { meet: "迎", send: "送", other_run: "他", own_move: "自車" };

// ---------- ユーティリティ ----------
const uid = () => Math.random().toString(36).slice(2, 10);

// 配列内で、fromId の要素を toId の位置へ移動した新しい配列を返す
function reorderById(arr, fromId, toId) {
  if (fromId === toId) return arr;
  const fromIdx = arr.findIndex((x) => x.id === fromId);
  const toIdx = arr.findIndex((x) => x.id === toId);
  if (fromIdx < 0 || toIdx < 0) return arr;
  const next = [...arr];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

// 全角カタカナ→半角カナ変換(Excel出力の省スペース用)
const HK_MAP = {
  "ガ":"ｶﾞ","ギ":"ｷﾞ","グ":"ｸﾞ","ゲ":"ｹﾞ","ゴ":"ｺﾞ","ザ":"ｻﾞ","ジ":"ｼﾞ","ズ":"ｽﾞ","ゼ":"ｾﾞ","ゾ":"ｿﾞ",
  "ダ":"ﾀﾞ","ヂ":"ﾁﾞ","ヅ":"ﾂﾞ","デ":"ﾃﾞ","ド":"ﾄﾞ","バ":"ﾊﾞ","ビ":"ﾋﾞ","ブ":"ﾌﾞ","ベ":"ﾍﾞ","ボ":"ﾎﾞ",
  "パ":"ﾊﾟ","ピ":"ﾋﾟ","プ":"ﾌﾟ","ペ":"ﾍﾟ","ポ":"ﾎﾟ","ヴ":"ｳﾞ",
  "ア":"ｱ","イ":"ｲ","ウ":"ｳ","エ":"ｴ","オ":"ｵ","カ":"ｶ","キ":"ｷ","ク":"ｸ","ケ":"ｹ","コ":"ｺ",
  "サ":"ｻ","シ":"ｼ","ス":"ｽ","セ":"ｾ","ソ":"ｿ","タ":"ﾀ","チ":"ﾁ","ツ":"ﾂ","テ":"ﾃ","ト":"ﾄ",
  "ナ":"ﾅ","ニ":"ﾆ","ヌ":"ﾇ","ネ":"ﾈ","ノ":"ﾉ","ハ":"ﾊ","ヒ":"ﾋ","フ":"ﾌ","ヘ":"ﾍ","ホ":"ﾎ",
  "マ":"ﾏ","ミ":"ﾐ","ム":"ﾑ","メ":"ﾒ","モ":"ﾓ","ヤ":"ﾔ","ユ":"ﾕ","ヨ":"ﾖ",
  "ラ":"ﾗ","リ":"ﾘ","ル":"ﾙ","レ":"ﾚ","ロ":"ﾛ","ワ":"ﾜ","ヲ":"ｦ","ン":"ﾝ",
  "ァ":"ｧ","ィ":"ｨ","ゥ":"ｩ","ェ":"ｪ","ォ":"ｫ","ッ":"ｯ","ャ":"ｬ","ュ":"ｭ","ョ":"ｮ","ー":"ｰ","・":"･",
};
function toHankakuKana(str) {
  return String(str).replace(/[ァ-ヴー・]/g, (ch) => HK_MAP[ch] || ch);
}
const ZK_MAP = Object.fromEntries(Object.entries(HK_MAP).map(([z, h]) => [h, z]));
function toZenkakuKana(str) {
  // 濁点・半濁点付きの2文字を先に、次に単独文字を変換
  return String(str).replace(/[｡-ﾟ][ﾞﾟ]|[｡-ﾟ]/g, (ch) => ZK_MAP[ch] || ch);
}
// 車名の短縮形(Excel出力用)。指定した車だけ短縮し、他は正式名のまま。
const VEH_SHORT_NAMES = { "ピカチュウ": "ピカ", "チョッパー": "チョ", "ケロッピー": "ケロ", "ミッフィー": "ミフィ", "トラッキー": "トラ", "カービィ": "カビィ", "ドナルド": "ドナ" };
function makeVehShortMap(vehicles) {
  const map = {};
  vehicles.forEach((v) => { map[v.id] = VEH_SHORT_NAMES[v.name] || v.name; });
  return map;
}

// 勤務時間帯の判定: 0=日勤, 1=早番(8時前開始), 2=遅番(12時以降開始)
function shiftRank(s) {
  const st = toMin(s.start);
  if (st == null) return 0;
  if (st >= 12 * 60) return 2;
  if (st < 8 * 60) return 1;
  return 0;
}

// 送迎表の列順キー: 通常部署(部署順) → リベルタ職員(兼務先部署ごと、その中で日勤→早番→遅番) → 右端固定(橋本・野津・与倉)
function staffColKey(master, s, wd) {
  const di = (id) => { const i = master.departments.findIndex((d) => d.id === id); return i < 0 ? 98 : i; };
  const dept = master.departments.find((d) => d.id === (s.baseDeptId || s.deptId));
  const isLib = dept && /リベルタ|その他|他$/.test(dept.name);
  // リベ職員の兼務先: 当日の移動◆ > 曜日別(subDeptByDay) > 基本(subDeptId)。
  // 兼務先が変わった日はその部署のリベ枠(リベルタ→◯◯)へ列が寄る(例: 角が川津→津田なら→津田の位置へ)
  const effSub = (s.baseDeptId ? s.deptId : "") || (wd != null ? subDeptOf(s, wd) : "") || s.subDeptId || "";
  const sub = effSub ? di(effSub) : 99;
  if (s.sortLast) return 2000 + sub * 4 + shiftRank(s);
  if (isLib) return 1000 + sub * 4 + shiftRank(s);
  // 曜日別の勤務先(deptByDay)があればその部署の列グループへ。
  // ただし当日の部署が解決済み(dayApplied)なら、その結果を使う。
  // 以前はここで曜日別を再適用していたため、当日「あいのて→川津」に変えても列だけ旧部署に残り、
  // 部署の帯が別部署の列に割り込んで見える不具合になっていた。
  const eff = (s.dayApplied || s.baseDeptId) ? s.deptId : ((wd != null && (s.deptByDay || {})[wd]) || s.deptId);
  return di(eff);
}
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// 日付ボタンのカレンダー。ブラウザ標準の日付選びは出る位置がずれる（Googleの画面の中では特に）ので、ボタンのすぐ下に自前で出す
function DatePop({ date, setDate, empty }) {
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState(() => (date || todayStr()).slice(0, 7));
  useEffect(() => { if (open) setYm((date || todayStr()).slice(0, 7)); }, [open, date]);
  useEffect(() => { if (!open) return; const k = (e) => { if (e.key === "Escape") setOpen(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open]);
  const d = new Date((date || todayStr()) + "T00:00:00");
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate();
  const ds = (n) => `${y}-${String(m).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
  const move = (k) => { const t = new Date(y, m - 1 + k, 1); setYm(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`); };
  const today = todayStr();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <span className="relative inline-flex">
      <button type="button" data-datepop className="inline-flex items-center border border-stone-300 rounded-md px-3 py-1.5 text-sm font-bold text-stone-700 bg-white cursor-pointer hover:bg-stone-50" title="クリックで日付を選択" onClick={() => setOpen((o) => !o)}>
        {date || !empty ? `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})` : empty}
        <span className="ml-1.5 text-stone-400 font-normal">📅</span>
      </button>
      {open && (<>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-white border border-stone-300 rounded-lg shadow-lg p-2 text-sm" role="dialog" aria-label="日付を選ぶ">
          <div className="flex items-center justify-between mb-1">
            <button type="button" className="px-2 py-1 rounded hover:bg-stone-100" onClick={() => move(-1)} aria-label="前の月">‹</button>
            <span className="font-bold text-stone-700">{y}年{m}月</span>
            <button type="button" className="px-2 py-1 rounded hover:bg-stone-100" onClick={() => move(1)} aria-label="次の月">›</button>
          </div>
          <div className="grid grid-cols-7 text-center gap-0.5">
            {DAYS.map((w, i) => <span key={w} className={`text-xs py-1 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-stone-500"}`}>{w}</span>)}
            {cells.map((n, i) => n == null ? <span key={"b" + i} /> : (
              <button type="button" key={n} data-day={ds(n)} onClick={() => { setDate(ds(n)); setOpen(false); }}
                className={`py-1 rounded ${ds(n) === date ? "bg-teal-600 text-white font-bold" : ds(n) === today ? "ring-1 ring-teal-500 text-stone-800" : i % 7 === 0 ? "text-red-500 hover:bg-stone-100" : i % 7 === 6 ? "text-blue-500 hover:bg-stone-100" : "text-stone-700 hover:bg-stone-100"}`}>{n}</button>
            ))}
          </div>
          <div className="flex justify-end mt-1"><button type="button" className="text-xs text-teal-700 px-2 py-1 rounded hover:bg-stone-100" onClick={() => { setDate(today); setOpen(false); }}>今日</button></div>
        </div>
      </>)}
    </span>
  );
}
// ファイル名用の日付。曜日をかっこ付きで添える(例: 2026-08-26(水))
const dateWithDay = (dateStr) => `${dateStr}(${DAYS[weekdayOf(dateStr)]})`;
const weekdayOf = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};
const toMin = (t) => {
  if (!t) return null;
  const m = String(t).match(/(\d{1,2})[:：](\d{1,2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};
// 人員カウントに含めない職員(所属は嫁島扱いだが現場人員に数えない)
const HEADCOUNT_EXCLUDE = new Set(["与倉", "古田"]);
// 同乗NGペア(相性)。同じ便に乗せると警告し、自動割当も同乗させない
// ===== 制限ルール =====
// 以前はコードに直接書いていた制限を master.rules に持たせ、アプリの「ルール」タブから
// 追加・変更・削除できるようにした。画面で変えた内容はファイルを差し替えても消えない。
const SEED_RULES = {
  // 同乗NG(この2人は同じ便に乗せない)
  ngPairs: [{ a: "早川", b: "梶谷光" }, { a: "早川", b: "梶谷奏" }, { a: "田原", b: "青木" }],
  // 利用者ごとの迎え・送りの固定担当(曜日別)。担当が休みの日は代役可(警告なし)
  fixedRun: [
    { kind: "meet", user: "田中か", days: [1], staff: "池田" },
    { kind: "meet", user: "田中か", days: [2], staff: "高井" },
    { kind: "meet", user: "田中か", days: [3], staff: "吉岡" },
    { kind: "meet", user: "田中慶", days: [1], staff: "吉岡" },
    { kind: "meet", user: "田中慶", days: [2, 5], staff: "安達" },
    { kind: "meet", user: "田中慶", days: [3], staff: "高井" },
    { kind: "meet", user: "田中慶", days: [4], staff: "池田" },
    { kind: "send", user: "成相", days: [1, 3], staff: "八壁" },
    { kind: "send", user: "成相", days: [2], staff: "田邊" },
  ],
  // 車ごとの固定担当(朝のピカ便など)。beforeの時刻より前の迎え便が対象
  fixedVeh: [
    { veh: "ピカチュウ", before: "12:00", days: [1], staff: "吉岡" },
    { veh: "ピカチュウ", before: "12:00", days: [2, 5], staff: "安達" },
    { veh: "ピカチュウ", before: "12:00", days: [3], staff: "高井" },
    { veh: "ピカチュウ", before: "12:00", days: [4], staff: "池田" },
  ],
  // 予定・ヘルプの固定担当。exact=ラベル完全一致 / time=その時刻だけ / from=この時刻以降だけ
  fixedBlock: [
    { label: "透析", exact: true, kind: "block", time: "12:00", from: "", days: [1, 2], staff: "高井" },
    { label: "透析", exact: true, kind: "block", time: "12:00", from: "", days: [3, 4], staff: "池田" },
    { label: "透析", exact: true, kind: "block", time: "12:00", from: "", days: [5], staff: "伊達" },
    { label: "藤井", exact: false, kind: "help", time: "", from: "15:00", days: [1, 2, 3, 4, 5], staff: "井川" },
  ],
  // 毎週必ず入るヘルプ(入っていなければ警告)
  requiredHelp: [
    { user: "曳野", days: [1, 3, 5] }, { user: "吉浦", days: [1] }, { user: "松浦", days: [3, 4] },
    { user: "野津涼", days: [1, 2, 3, 4, 5] }, { user: "伊達", days: [1, 3, 5] },
    { user: "尾原", days: [1, 2, 5] }, { user: "猪原", days: [1, 4, 5] },
    { user: "井上", days: [1, 2, 3, 4, 5] }, { user: "黒田", days: [1, 2, 3, 4, 5] },
    { user: "藤井", days: [1, 2, 3, 4, 5] }, { user: "青山", days: [1, 3, 5] }, { user: "竹田寛", days: [1, 5] },
  ],
  // 夕方(15時以降)に2名体制が必要なヘルプ
  helpTwo: [{ user: "黒田", days: [1, 3, 4] }, { user: "井上", days: [1, 2, 3, 4, 5] }],
  // 男性職員のみ対応可。from=この時刻以降だけ / bathOnly=入浴のときだけ
  maleOnly: [
    { user: "赤山", from: "", bathOnly: true }, { user: "曳野", from: "", bathOnly: false },
    { user: "竹田寛", from: "", bathOnly: false }, { user: "黒田", from: "", bathOnly: false },
    { user: "井上", from: "15:00", bathOnly: false },
  ],
  // 利用者ごとの基本の車(別の車に乗っていれば警告)
  userVeh: [{ user: "勝部", veh: "ピカチュウ" }, { user: "ホン", veh: "ピカチュウ" }],
};
const EMPTY_RULES = { ngPairs: [], fixedRun: [], fixedVeh: [], fixedBlock: [], requiredHelp: [], helpTwo: [], maleOnly: [], userVeh: [], helpBase: [], otherRules: [], aiNotes: [] };
const seedRules = () => JSON.parse(JSON.stringify(EDITION === "v3" ? EMPTY_RULES : SEED_RULES));
// master.rules を安全に取り出す(未設定の項目は空配列)
const rulesOf = (master) => {
  const r = { ...EMPTY_RULES, ...((master && master.rules) || {}) };
  return { ...r, helpBase: canonHelpBase(r.helpBase) };
};
// ---------- ヘルプ名の統合 ----------
// 「井上入浴」「黒田入浴(ヘルプ)」は、同じ時刻の「井上ヘルプ」「黒田ヘルプ」と同じもの(2026-10-29 依頼者)。
// 保存されている名前は変えず、表示・判定・Excel出力・ヘルプ表でこの名前にそろえる(画面で開いて保存し直すとこの名前で残る)
const HELP_LABEL_MERGE = /^(井上|黒田)入浴(ヘルプ)?$/;
const canonHelpLabel = (label) => { const t = String(label || "").trim(); const m = HELP_LABEL_MERGE.exec(t); return m ? m[1] + "ヘルプ" : label; };
const canonHelpBlocks = (blocks) => (blocks || []).map((b) => (b && b.kind === "help" && HELP_LABEL_MERGE.test(String(b.label || "").trim()) ? { ...b, label: canonHelpLabel(b.label) } : b));
// ヘルプ表の行(helpBase)も同じ名前にそろえ、同じ名前・同じ時刻の行は1つにまとめる(曜日ごとの担当は「・」でつなぐ)
const canonHelpBase = (list) => {
  if (!(list || []).some((r) => r && HELP_LABEL_MERGE.test(String(r.label || "").trim()))) return list;
  const out = [];
  (list || []).forEach((r) => {
    if (!r) return;
    const label = canonHelpLabel(r.label);
    const same = out.find((x) => x.label === label && String(x.time || "").trim() === String(r.time || "").trim());
    if (!same) { out.push({ ...r, label }); return; }
    const byDay = { ...(same.byDay || {}) };
    Object.entries(r.byDay || {}).forEach(([d, v]) => {
      const names = [...String(byDay[d] || "").split("・"), ...String(v || "").split("・")].map((x) => x.trim()).filter(Boolean);
      byDay[d] = [...new Set(names)].join("・");
    });
    Object.assign(same, { ...r, ...same, label, byDay });
  });
  return out;
};
// ---------- 日付で切り替わるルール ----------
// master.rulesUntil = [{ until: "YYYY-MM-DD", rules }](古い順)。その日までの送迎表は rules、最後の区切りの翌日からは master.rules(いまのルール)
// 例: 10/11からルールが変わる → [{ until: "2026-10-10", rules: 前のルール }]。10/10までの送迎表は前のルールのまま
const rulesAtDate = (master, dateStr) => {
  if (dateStr) for (const v of (master && master.rulesUntil) || []) if (v && String(dateStr) <= v.until) return v.rules || {};
  return (master && master.rules) || {};
};
const dayBeforeStr = (ds) => { const [y, m, d] = String(ds).split("-").map(Number); const t = new Date(y, m - 1, d - 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
// ルールの変更(oldM → newM)を「from の日から」効くように並べ直す。from が空ならすべての日(前の区切りの分にも同じ変更を入れる)
function scheduleRules(oldM, newM, from) {
  if (!oldM || !newM) return newM;
  const oldR = rulesOf(oldM), newR = rulesOf(newM);
  const keys = [...new Set([...Object.keys(oldR), ...Object.keys(newR)])].filter((k) => JSON.stringify(oldR[k]) !== JSON.stringify(newR[k]));
  let list = (oldM.rulesUntil || []).filter((v) => v && v.until).map((v) => ({ ...v })).sort((a, b) => (a.until < b.until ? -1 : 1));
  if (!keys.length) return newM;
  const patch = (r) => { const o = { ...EMPTY_RULES, ...(r || {}) }; keys.forEach((k) => { o[k] = newR[k]; }); return o; };
  if (from) {
    const pd = dayBeforeStr(from);
    const i = list.findIndex((v) => v.until >= pd);
    if (i < 0) list.push({ until: pd, rules: oldR });                       // いまのルールを前日までの分として残す
    else if (list[i].until > pd) list.splice(i, 0, { until: pd, rules: list[i].rules });
    list = list.map((v) => (v.until >= from ? { ...v, rules: patch(v.rules) } : v));
  } else list = list.map((v) => ({ ...v, rules: patch(v.rules) }));
  // 次の区切り(いまのルール)と中身が同じ区切りは要らない
  const same = (a, b) => JSON.stringify(rulesOf({ rules: a })) === JSON.stringify(rulesOf({ rules: b }));
  const out = list.filter((v, j) => !same(v.rules, j + 1 < list.length ? list[j + 1].rules : newR));
  if (!out.length && !(oldM.rulesUntil || []).length) return { ...newM, rules: newR };
  return { ...newM, rules: newR, rulesUntil: out };
}
// ルールの対象時間かどうか(time=その時刻だけ / from=この時刻以降だけ)
const ruleTimeHit = (row, t) => {
  if (row.time) return t != null && t === toMin(row.time);
  if (row.from) return t != null && t >= toMin(row.from);
  return true;
};
// その職員がその日休み(代役OK)かどうか
const ruleStaffOff = (master, sheetData, wd, name) => {
  const s = (master.staff || []).find((x) => x.name === name);
  if (!s) return true;
  const ov = ((sheetData && sheetData.staffOv) || {})[s.id] || {};
  return ov.off === true || !!s.retireDate || ((s.offDays || []).includes(wd) && !ov.workToday);
};
const ngPartnersOf = (master, uid2) => {
  const me = master.users.find((u) => u.id === uid2);
  if (!me) return [];
  const names = (rulesOf(master).ngPairs || [])
    .filter((p) => p && (p.a === me.name || p.b === me.name))
    .map((p) => (p.a === me.name ? p.b : p.a));
  return master.users.filter((u) => names.includes(u.name)).map((u) => u.id);
};
// リベルタ職員の当日の兼務先(曜日別subDeptByDayがあれば優先、なければ基本の兼務先)
const subDeptOf = (s, wd) => ((s.subDeptByDay || {})[wd]) || s.subDeptId || "";
// 退職判定: retireDate("2026-07-20"形式)以降の日付では不在扱い(列・人数・選択肢から除外、担当分は保留へ)
const isRetiredOn = (s, dateStr) => !!(s && s.retireDate && dateStr && String(dateStr) >= s.retireDate);
// その日付で退職済みの職員が担当している便・予定を保留へ付け替える
const remapRetired = (m, dateStr, items) => {
  const retired = new Set((m.staff || []).filter((s) => isRetiredOn(s, dateStr)).map((s) => s.id));
  if (!retired.size) return items;
  return (items || []).map((x) => ({
    ...x,
    ...(retired.has(x.staffId) ? { staffId: HOLD_ID } : {}),
    ...(Array.isArray(x.staffRiderIds) ? { staffRiderIds: x.staffRiderIds.filter((id) => !retired.has(id)) } : {}),
  }));
};
// 人数カウント・出発地判定に使う「当日の実所属」。
// 優先順位: 当日部署の変更・曜日別部署(baseDeptIdが付く) > リベルタ職員の兼務先 > 所属。
// リベルタ以外の職員に残った古い兼務先設定は無視する(部署変更後に人数が旧部署に残るバグ対策)
const belongDeptOf = (master, s, wd) => {
  if (s.baseDeptId) return s.deptId;
  const d = master.departments.find((x) => x.id === s.deptId);
  if (d && /リベルタ/.test(d.name)) return subDeptOf(s, wd) || s.deptId;
  return s.deptId;
};
// 基本が送迎なしの利用者(馬場=家族送迎、猪原=母送迎など)の初期値。シート側で削除・変更可能。
// meetDays/sendDaysを指定すると、その曜日だけ送迎なし(例: 野津周=月木の朝のみ家族送り)
const noRideDefaults = (m, wd) => {
  const o = {};
  (m.users || []).forEach((u) => {
    // 利用者タブの「いつもの迎え先・送り先」が家族送り・家族迎えなら送迎なし。
    // 空欄なら以前からの基本の送迎なし(馬場・猪原など)を使う
    const e = {};
    ["meet", "send"].forEach((k) => {
      const v = String((k === "send" ? u.sendPlace : u.meetPlace) || "").trim();
      if (v) { if (/^(家族|母|父)/.test(v)) e[k] = v; return; }
      const d = u.noRideDefault;
      if (d && d[k] && (!d[k + "Days"] || wd == null || d[k + "Days"].includes(wd))) e[k] = d[k];
    });
    if (e.meet || e.send) o[u.id] = e;
  });
  return o;
};
// 生活介護の活動時間帯。この間は活動用の車が送迎に使えない(嫁島=ピカチュウ、津田=セレナ、川津=マイメロ、あいのて=任意の2台を空けておく)
// リベルタのサービス計画実績CSV(介護ソフト出力・Shift-JIS)を解析。
// 列: 実施予定日,予定開始,予定終了,実施日,サービス名,修正開始,修正終了,利用者名,実績担当,予定担当
// → 日付ごとに「利用者の朝(10時まで)の最終サービス終了時刻」を返す。9:00以前=リベ迎1便目、9:00超=2便目(ドラ)の判定に使う
function parseLibCsv(text) {
  // "2026-07-16" -> { am: {"小川薫": "8:30"(朝サービスの最終終了)}, pm: {"小川薫": "16:30"(夕方サービスの最初の開始)} }
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  const unq = (s) => String(s == null ? "" : s).trim().replace(/^"+|"+$/g, "").trim(); // 引用符("...")を除去
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < 8) continue;
    const date = unq(c[0]);
    const end = unq(c[6]) || unq(c[2]);   // 終了(修正があれば優先)
    const st = unq(c[5]) || unq(c[1]);    // 開始(修正があれば優先)
    const name = unq(c[7]).replace(/[\s\u3000]/g, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) continue;
    const d = (out[date] = out[date] || { am: {}, pm: {}, stf: {} });
    d.stf = d.stf || {};
    const em = toMin(end), sm = toMin(st);
    if (em != null && em <= 10 * 60) { // 朝: 10時までに終わるサービスの最終終了時刻
      if (!d.am[name] || toMin(d.am[name]) < em) d.am[name] = end;
    }
    if (sm != null && sm >= 14 * 60) { // 夕: 14時以降に始まるサービスの最初の開始時刻
      if (!d.pm[name] || toMin(d.pm[name]) > sm) d.pm[name] = st;
    }
    // 職員(予定担当優先)のサービス時間帯: 送迎表との重複チェックに使う
    const who = unq(c[9]) || unq(c[8]);
    if (who && sm != null && em != null && em > sm) (d.stf[who] = d.stf[who] || []).push([sm, em, name]);
  }
  return out;
}
// ケアウィングCSVと送迎表の照合: 利用者の過不足・便の時間帯・職員のサービス重複を検出
function libCsvDiff(master, data, dayMap, wd) {
  const out = [];
  const am = dayMap.am || dayMap, pm = dayMap.pm || {}, stf = dayMap.stf || {};
  const { isLibOn } = makeLibNameHelpers(data || {}, wd);
  const absent = (data && data.userAbsent) || {};
  const amBy = {}, pmBy = {};
  Object.entries(am).forEach(([fn, t]) => { const u = matchUserByFullName(master.users, fn); if (u) amBy[u.id] = toMin(t); });
  Object.entries(pm).forEach(([fn, t]) => { const u = matchUserByFullName(master.users, fn); if (u) pmBy[u.id] = toMin(t); });

  // ① 利用者の過不足(CSVのサービス有無 vs アプリのリベルタ設定)
  master.users.forEach((u) => {
    if (!(u.days || []).includes(wd) || absent[u.id]) return;
    if (!u.libertaAM && !u.libertaPM) return; // リベルタ利用者のみ対象
    const libAM = isLibOn(u, "meet"), libPM = isLibOn(u, "send");
    if (amBy[u.id] != null && !libAM) out.push(`利用者${u.name}: CSVに朝サービスあり(〜${toStr(amBy[u.id])})ですが、アプリは「朝は自宅」設定です`);
    if (amBy[u.id] == null && libAM) out.push(`利用者${u.name}: アプリはリベ迎(朝リベルタ)ですが、CSVにこの日の朝サービスがありません`);
    if (pmBy[u.id] != null && !libPM) out.push(`利用者${u.name}: CSVに夕サービスあり(${toStr(pmBy[u.id])}〜)ですが、アプリは「夕は自宅」設定です`);
    if (pmBy[u.id] == null && libPM) out.push(`利用者${u.name}: アプリはリベ送ですが、CSVにこの日の夕サービスがありません`);
  });

  // ② 便の時間帯の不一致
  const d1 = master.departments.find((d) => d.name === "嫁島");
  const d2 = master.departments.find((d) => d.name === "津田");
  const dora = master.vehicles.find((v) => v.name === "ドラ");
  master.users.forEach((u) => { // 迎え(嫁島): 9:00超のサービス=ドラ2便目
    if (!d1 || u.deptId !== d1.id) return;
    const em = amBy[u.id];
    if (em == null || absent[u.id] || !(u.days || []).includes(wd) || !isLibOn(u, "meet")) return;
    const run = (data.runs || []).find((r) => r.kind === "meet" && !r.mode && (r.userIds || []).includes(u.id));
    if (!run) return;
    const onDora = dora && run.vehicleId === dora.id;
    if (em > 9 * 60 && !onDora) out.push(`利用者${u.name}: 朝サービスが${toStr(em)}までなので2便目(ドラ9:30)のはずが、${run.time}の便に乗っています`);
    if (em <= 9 * 60 && onDora) out.push(`利用者${u.name}: 朝サービスは${toStr(em)}までなので1便目で行けますが、2便目(ドラ)に乗っています`);
  });
  [d1, d2].forEach((dept) => { // 送り(嫁島・津田): 17時以降サービス=遅い便
    if (!dept) return;
    const libSendRuns = (data.runs || []).filter((r) => r.kind === "send" && !r.mode &&
      (r.userIds || []).some((id) => { const x = master.users.find((y) => y.id === id); return x && x.deptId === dept.id && isLibOn(x, "send"); }))
      .sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0));
    if (libSendRuns.length < 2) return;
    const firstId = libSendRuns[0].id, lastId = libSendRuns[libSendRuns.length - 1].id;
    master.users.forEach((u) => {
      if (u.deptId !== dept.id) return;
      const sm = pmBy[u.id];
      if (sm == null || absent[u.id] || !(u.days || []).includes(wd) || !isLibOn(u, "send")) return;
      const run = libSendRuns.find((r) => (r.userIds || []).includes(u.id));
      if (!run) return;
      if (sm >= 17 * 60 && run.id === firstId) out.push(`利用者${u.name}(${dept.name}): 夕サービスは${toStr(sm)}からなので2便目でよいのに、1便目(${run.time})に乗っています`);
      if (sm < 17 * 60 && run.id === lastId) out.push(`利用者${u.name}(${dept.name}): 夕サービスが${toStr(sm)}から始まるので1便目が必要ですが、2便目(${run.time})に乗っています`);
    });
  });

  // ③ 職員のリベルタサービスと送迎表の重複
  Object.entries(stf).forEach(([fn, ivs]) => {
    let best = null;
    master.staff.forEach((s) => { if (fn.startsWith(s.name) && (!best || s.name.length > best.name.length)) best = s; });
    if (!best) return;
    const hit = (t0, d0, iv) => iv[0] < t0 + d0 && t0 < iv[1];
    // このサービスの利用者を含む予定は「同じ活動」なので重複として扱わない
    const sameActivity = (iv, item) => {
      const svcUser = iv[2] ? matchUserByFullName(master.users, iv[2]) : null;
      if (!svcUser) return false;
      if ((item.userIds || []).includes(svcUser.id)) return true;
      if (String(item.label || "").startsWith(svcUser.name)) return true;
      return false;
    };
    (data.runs || []).forEach((r) => {
      const t0 = toMin(r.time);
      if (t0 == null) return;
      if (r.staffId !== best.id && !(r.staffRiderIds || []).includes(best.id)) return;
      const d0 = Number(r.durMin) || SLOT;
      ivs.forEach((iv) => {
        const svcNm = iv[2] ? ((matchUserByFullName(master.users, iv[2]) || {}).name || "") : "";
        if (hit(t0, d0, iv) && !sameActivity(iv, r)) out.push(`職員${best.name}: リベルタで${toStr(iv[0])}〜${toStr(iv[1])}に${svcNm ? svcNm + "の" : ""}サービス予定がありますが、送迎表で${r.time}の便(別の予定)に入っています`);
      });
    });
    (data.blocks || []).forEach((b) => {
      const t0 = toMin(b.time);
      if (t0 == null || b.staffId !== best.id) return;
      const d0 = helpDurMin(b);
      ivs.forEach((iv) => {
        const svcNm = iv[2] ? ((matchUserByFullName(master.users, iv[2]) || {}).name || "") : "";
        if (hit(t0, d0, iv) && !sameActivity(iv, b)) out.push(`職員${best.name}: リベルタで${toStr(iv[0])}〜${toStr(iv[1])}に${svcNm ? svcNm + "の" : ""}サービス予定がありますが、送迎表で${b.time}の「${b.label || "予定"}」(別の予定)の担当になっています`);
      });
    });
  });
  return [...new Set(out)];
}

// CSVのフルネーム(例: 小川薫)をアプリの短い名前(小川)に対応付け。最長一致で森/森井などの取り違えを防ぐ
function matchUserByFullName(users, fullName) {
  let best = null;
  users.forEach((u) => {
    if (fullName.startsWith(u.name) && (!best || u.name.length > best.name.length)) best = u;
  });
  return best;
}

// ヘルプの既定所要時間(分): 基本60分、伊達さんのヘルプのみ30分。予定に所要時間(durMin)が設定されていればそれを最優先
const helpDurMin = (b) => Number(b.durMin) || (b.kind === "help" ? (/伊達/.test(b.label || "") ? 30 : 60) : SLOT);
// 重なり(時間重複)のエラー判定用: 所要時間を設定していないヘルプは、その時刻の枠(30分)だけとして扱う
// (以前は1時間とみなしていたため、すぐ後の予定と「重なっています」のエラーになっていた)
const overlapDurMin = (b) => Number(b.durMin) || SLOT;
// 拠点の住所: 嫁島=松江市嫁島町10-12 / 津田=津田町308-1 / 川津=学園2丁目29-10 / あいのて=黒田町469-6 / リベルタ=上乃木4丁目6-5
// 拠点間の車での概算移動時間(分)。市街地の平均速度で見た概算なので、実測で直してよい
const DEPT_TRAVEL_MIN = {
  "嫁島|津田": 10, "嫁島|川津": 15, "嫁島|あいのて": 11, "嫁島|リベルタ": 5,
  "津田|川津": 10, "津田|あいのて": 15, "津田|リベルタ": 10,
  "川津|あいのて": 10, "川津|リベルタ": 15,
  "あいのて|リベルタ": 12,
};
// 部署名(「リベルタ・他」等の表記ゆれ込み)から移動時間を引く
const deptTravelMin = (a, b) => {
  const norm = (x) => String(x || "").replace(/・他.*$/, "").replace(/リベルタ.*/, "リベルタ");
  const A = norm(a), B = norm(b);
  if (!A || !B || A === B) return 0;
  return DEPT_TRAVEL_MIN[`${A}|${B}`] || DEPT_TRAVEL_MIN[`${B}|${A}`] || 15;
};
const ACTIVITY_WINDOWS = [[10 * 60 + 30, 12 * 60], [13 * 60 + 30, 15 * 60]];
const ACTIVITY_VEHICLES = { "ピカチュウ": "嫁島", "セレナ": "津田", "マイメロ": "川津" };
const inActivityWindow = (t, end) => ACTIVITY_WINDOWS.some(([a, b]) => t < b && end > a);
const TIME_GAP_WARN_MIN = 75; // 回り便は出発と自宅着に30-60分の差が出るため、75分以上のズレだけ警告 // 利用者の希望時刻と便の時刻のズレ警告の閾値(分)
const toStr = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const to24 = (t) => { const m2 = toMin(t); return m2 == null ? "" : `${String(Math.floor(m2 / 60)).padStart(2, "0")}:${String(m2 % 60).padStart(2, "0")}`; };
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- ドラッグ&ドロップ ----------
// dataTransferはdrop時しか読めないため、モジュール変数で共有する
let DRAG = null;
const dragStart = (payload) => (e) => {
  DRAG = payload;
  try { e.dataTransfer.setData("text/plain", JSON.stringify(payload)); } catch (err) {}
  e.dataTransfer.effectAllowed = "move";
};
const dragEnd = () => { DRAG = null; };

// ---------- アプリ内通知・確認(サンドボックスではalert/confirmが使えないため) ----------
let _notify = () => {};
let _ask = () => Promise.resolve(false);
const notify = (msg, type = "info") => _notify(msg, type);
const ask = (msg) => _ask(msg);

// ---------- 共有ストレージ(新方式) ----------
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

// ---------- 初期データ(アップロードされた送迎表を元に作成) ----------
// ===== りんく・ぷれいす版の初期データ =====
// 職員5名・利用者は午前10名/午後10名(全員 月〜金)。名前は仮なので画面から実名に変更してください。
// 画面で変えた名前・時刻・曜日などは、今後ファイルを差し替えても消えません。
// ★送迎の時刻は仮です。決まったら LP_TIMES を書き換えるか、画面の利用者タブで変更してください
const LP_TIMES = {
  am: { meet: "9:00", send: "12:00" },   // 午前の利用者: 迎え / 送り
  pm: { meet: "13:00", send: "16:00" },  // 午後の利用者: 迎え / 送り
};
// 曜日別の勤務時間のうち、基本と同じもの(効果のないもの)を取り除く
function stripSameShift(s) {
  const sb = s && s.shiftByDay;
  if (!sb || !Object.keys(sb).length) return s;
  const next = {};
  Object.entries(sb).forEach(([wd, v]) => {
    if (!v) return;
    if (toMin(v.start) === toMin(s.start) && toMin(v.end) === toMin(s.end)) return;
    next[wd] = v;
  });
  const out = { ...s };
  if (Object.keys(next).length) out.shiftByDay = next; else delete out.shiftByDay;
  return out;
}

function seedMaster() { return EDITION === "v3" ? seedMasterLink() : seedMasterNanairo(); }
function seedMasterLink() {
  const d1 = uid();
  const departments = [{ id: d1, name: "りんく・ぷれいす", maleGapMin: 30 }];
  const WEEK = [1, 2, 3, 4, 5];
  const staff = [1, 2, 3, 4, 5].map((i) => ({
    id: uid(), name: `職員${i}`, deptId: d1, position: "", emp: "常勤",
    start: "8:30", end: "17:30", canDrive: true, isMale: false, hasOwnCar: false, ownCarCap: 3,
    sortLast: false, hideInPartList: false, subDeptId: "", offDays: [0, 6],
    memo: "仮登録。職員タブで実名・勤務時間・性別に変更してください",
  }));
  const vh = (name, capNormal, wheelchairOK, capWc) => ({ id: uid(), name, deptId: d1, capNormal, capWc, wheelchairOK, memo: "仮登録。車両タブで実際の車に変更してください" });
  const vehicles = [vh("車1", 7, false, 0), vh("車2", 7, false, 0), vh("車3", 4, true, 2)];
  const us = (name, slot) => ({
    id: uid(), name, deptId: d1,
    meetTime: LP_TIMES[slot].meet, sendTime: LP_TIMES[slot].send,
    wheelchair: false, hasHelp: false, helpTwo: false,
    helpNote: slot === "am" ? "午前利用" : "午後利用", session: slot,
    days: WEEK, isMale: true,
  });
  const users = [
    ...Array.from({ length: 10 }, (_, i) => us(`午前${i + 1}`, "am")),
    ...Array.from({ length: 10 }, (_, i) => us(`午後${i + 1}`, "pm")),
  ];
  return { departments, staff: staff.map(stripSameShift), vehicles, users, rules: seedRules(), seeded: true, seedVersion: SEED_VERSION };
}

// なないろ(現体制・新体制)版の初期データ。この版では使わない(参考として残す)
function seedMasterNanairo() {
  const d1 = uid(), d2 = uid(), d3 = uid(), d4 = uid(), d5 = uid();
  const departments = [
    { id: d1, name: "嫁島", maleGapMin: 30 },
    { id: d2, name: "津田", maleGapMin: 30, capMax: 12, staffMax: 4, staffMin: 3 }, // 在席12名上限+職員は駐車4台の都合で最大4名・最低3名
    { id: d3, name: "川津", maleGapMin: 30 },
    { id: d4, name: "あいのて", maleGapMin: 30 },
    { id: d5, name: "リベルタ・他", maleGapMin: 30 },
  ]; // maleGapMin=男性職員ゼロを許容する連続分数(部署ごと)
  // 各職員の固定休(曜日)。1=月〜6=土, 0=日。あとから職員タブで変更可能。
  const OFF = {
    "橋本": [6, 0], "八壁": [6, 0], "久保田": [2, 5], "白戸": [6, 0], "成瀬": [6, 0],
    "青木": [3, 4], "安達": [6, 0], "吉岡": [4, 5], "毎熊": [6, 0], "藤原": [6, 0],
    "野津": [3, 4], "小瀧": [2, 3], "森": [5, 6], "鳥屋尾": [6, 0], "伊達": [6, 0],
    "日野": [6, 0], "余村和": [2, 0], "横田": [4, 5], "高井": [6, 0], "与倉": [6, 0],
    "秋山": [2, 3], "川島": [3, 4], "杉谷": [2, 5], "新見": [6, 0], "岩田": [6, 0],
    "古田": [6, 0], "池田": [6, 0], "近藤": [3, 4], "田邊": [6, 0], "中谷": [2, 4],
    "長見": [6, 0], "岡部": [6, 0], "石原": [6, 0], "大垣": [6, 0], "春日": [6, 0],
    "山崎": [6, 0], "村松": [6, 0],
    // 追加職員の固定休
    "安部": [1, 0], "田中": [1, 2, 3, 4, 5, 6, 0], "窪田": [1, 0], "余村慎": [1, 0], "宮永": [1, 2],
    "飯塚": [2, 3, 4], "角": [1, 4], "長島": [1, 5], "長田": [6, 0], "落合": [6, 0], "小川": [1, 5, 6, 0],
  };
  // 男性職員(男性カバー集計の対象)
  const MALES = MALE_STAFF;
  const NO_DRIVE = new Set(["宮永"]); // パート以外で運転不可の職員
  const SORT_LAST = new Set(["橋本", "野津", "与倉"]); // 送迎表で常に右端に配置する職員
  // Excel下段の「パート職員」欄に表示しないパート
  const HIDE_PART = new Set(["飯塚", "小川", "柳原沙", "柳原栄", "外谷", "足立", "長田", "落合"]);
  // リベルタ職員の兼務先部署(元Excelの「よめしま/つだ/あいのて」注記より)
  const SUB_DEPT = {
    "杉谷": d1, "青木": d1, "新見": d1, "余村慎": d1, "宮永": d1, "長島": d1,
    "森": d2, "川島": d2, "窪田": d2, "横田": d2, "秋山": d2, "小瀧": d2,
    "近藤": d4, "中谷": d4, "角": d3,
  };
  // 曜日別の兼務先(1=月..5=金)。余村慎は金曜のみ津田
  const SUB_DEPT_BY_DAY = { "小瀧": { 4: d1, 5: d1 } }; // 小瀧=木・金は嫁島(余村慎は毎日嫁島)
  const st = (name, deptId, position, emp, start, end) => ({
    id: uid(), name, deptId, position: position || "", emp: emp || "常勤",
    start: start || "8:30", end: end || "17:30",
    canDrive: (emp || "常勤") !== "パート" && !NO_DRIVE.has(name), // パートと指定者は運転不可
    isMale: MALES.has(name), hasOwnCar: false, ownCarCap: 3,
    sortLast: SORT_LAST.has(name),
    hideInPartList: HIDE_PART.has(name),
    subDeptId: SUB_DEPT[name] || "",
    ...(SUB_DEPT_BY_DAY[name] ? { subDeptByDay: SUB_DEPT_BY_DAY[name] } : {}),
    offDays: OFF[name] || [], memo: "",
  });
  const staff = [
    { ...st("久保田", d1, "㋬管理者", "常勤", "8:30", "17:30"), hideInStaffList: true, helpOnly: true }, // 下段職員欄に載せない・基本送迎はつけない(ヘルプ専任)
    st("高井", d1, "看護師", "常勤", "8:30", "17:30"),
    st("池田", d1, "看護師", "常勤", "8:30", "17:30"),
    st("安達", d1, "専従", "常勤", "8:30", "17:30"),
    st("吉岡", d1, "兼務", "常勤", "8:30", "17:30"),
    st("井川", d1, "管理者", "常勤", "8:30", "17:30"),
    { ...st("与倉", d1, "", "常勤", "", ""), noGrid: true, helpOnly: true }, // 送迎表の列には出さない(人数カウントも除外済み)
    st("古田", d1, "", "嘱託", "6:00", "13:30"), // 嫁島・嘱託6:00〜13:30。送迎表の列と下段の職員欄に表示する
    st("白戸", d2, "専従", "常勤", "8:30", "17:30"),
    st("安部", d2, "主任", "常勤", "8:30", "17:30"),
    { ...st("八壁", d3, "管理者・サビ菅", "常勤", "8:30", "17:30"), deptByDay: { 5: d4 } },
    { ...st("日野", d3, "主任", "常勤", "8:30", "17:30"), deptByDay: { 3: d4, 4: d4 } }, // 水木はあいのて
    st("成瀬", d3, "専従", "常勤", "8:30", "17:30"),
    st("春日", d3, "嘱託", "常勤", "8:30", "17:30"),
    st("石原", d3, "看護師", "常勤", "8:30", "17:30"),
    st("村松", d3, "看護師", "常勤", "8:30", "17:30"),
    { ...st("岡部", d3, "", "常勤", "8:30", "17:30"), retireDate: "2026-07-20" }, // 7/20以降は退職(その日以降の送迎表から消え、担当分は保留へ)
    { ...st("余村和", d4, "兼務", "常勤", "8:30", "17:30"), deptByDay: { 5: d3 } },
    st("藤原", d4, "専従", "常勤", "8:30", "17:30"),
    st("伊達", d4, "看護師", "常勤", "8:30", "17:30"),
    st("田邊", d4, "看護師", "常勤", "9:00", "18:00"),
    st("橋本", d5, "", "常勤", "6:00", "22:00"),
    st("野津", d5, "", "常勤", "6:00", "22:00"),
    st("横田", d5, "兼務", "常勤", "9:00", "18:00"),
    st("秋山", d5, "兼務", "常勤", "14:00", "22:00"),
    st("近藤", d5, "兼務", "常勤", "9:00", "18:00"),
    st("森", d5, "兼務", "常勤", "13:00", "22:00"),
    st("杉谷", d5, "兼務", "常勤", "14:00", "22:00"),
    st("川島", d5, "兼務", "常勤", "6:00", "14:00"),
    st("中谷", d5, "兼務", "常勤", "6:00", "14:00"),
    st("小瀧", d5, "兼務", "常勤", "6:00", "13:30"),
    st("青木", d5, "兼務", "常勤", "14:30", "22:00"),
    st("新見", d5, "兼務", "常勤", "9:30", "19:00"),
    st("窪田", d5, "兼務", "常勤", "9:00", "17:30"),
    st("余村慎", d5, "兼務", "常勤", "9:00", "17:30"),
    st("宮永", d5, "嘱託・兼務", "常勤", "13:00", "22:00"),
    st("角", d5, "兼務", "常勤", "8:00", "17:00"),
    st("長島", d5, "兼務", "常勤", "8:00", "17:00"),
    st("三島", d1, "", "パート", "9:00", "16:00"), // 嫁島・パート
    st("毎熊", d1, "", "パート", "9:00", "16:00"),
    st("鳥屋尾", d1, "", "パート", "9:00", "16:00"),
    st("岩田", d1, "", "パート", "9:00", "16:00"),
    st("大垣", d1, "", "パート", "9:00", "12:00"),
    st("長見", d4, "", "パート", "9:00", "17:00"),
    st("田中", d4, "", "パート", "9:00", "13:00"),
    st("飯塚", d5, "", "パート", "9:00", "17:00"),
    st("小川", d5, "", "パート", "9:00", "17:00"),
    st("柳原沙", d5, "", "パート", "8:30", "17:30"),
    st("柳原栄", d5, "", "パート", "8:30", "17:30"),
    st("外谷", d5, "", "パート", "8:30", "17:30"),
    st("足立", d5, "", "パート", "8:30", "17:30"),
    st("長田", d5, "", "パート", "9:00", "16:00"),
    st("落合", d5, "", "パート", "9:00", "16:00"),
  ];
  // 通勤ルール: リベ職員と成瀬・村松・春日以外は基本嫁島出勤(そこから公用車で移動)。
  // 成瀬・村松・春日は自車で自部署(川津)に直接出勤・直帰。リベ職員は早番=リベ発・遅番=最終リベルタ行き
  // ※変更もありえるため、職員マスタのhasOwnCar(自車)で切り替えられる
  staff.forEach((s) => { if (["成瀬", "村松", "春日"].includes(s.name)) s.hasOwnCar = true; });
  const vh = (name, deptId, capNormal, wheelchairOK, capWc, memo) => ({
    id: uid(), name, deptId, capNormal, capWc, wheelchairOK, memo: memo || "",
  });
  // 車両(定員・車いす対応は実測値)。画像の並び順どおり。
  const vehicles = [
    // 嫁島
    vh("ドナルド", d1, 4, true, 3),
    vh("セレナ", d1, 8, false, 3),
    vh("カービィ", d1, 4, false, 3, "ヘルプ用(送迎には基本使わない。車が無い時のみ可)"),
    vh("ケロッピー", d1, 4, true, 3),
    vh("トラッキー", d3, 4, true, 4), // 所属・基地とも川津
    // 津田
    vh("ピカチュウ", d2, 7, false, 3),
    vh("ミッフィー", d2, 4, false, 3),
    // 川津
    vh("マイメロ", d3, 10, true, 10, "車いす 2台"),
    vh("チョッパー", d3, 4, true, 3),
    // あいのて
    vh("ガチャ", d4, 4, true, 4),
    vh("ムック", d4, 7, true, 4),
    vh("ノンタン", d4, 4, true, 4),
    vh("鬼滅", d4, 7, true, 4),
    // リベルタ
    vh("ドラ", d5, 4, false, 3, "井川 8:30〜17:30 固定"),
  ];
  // 15時以降のヘルプが2名体制の利用者
  const HELP_TWO = new Set(["井上", "黒田"]);
  // 利用者(名前・部署・利用曜日・曜日別部署は確定値。曜日: 月1火2水3木4金5土6日0)
  const LIBERTA_USERS = new Set(["中村", "岡本", "森", "小川", "太田", "八壁", "野津周", "梶谷光", "早川", "須山", "森井", "星野", "津田", "楢木", "橋本", "菊谷", "岩垣", "錦織り", "戸井", "園山", "野津彩", "竹田真"]);
  // 曜日別の例外(自宅スタート=am / 自宅帰り=pm)。曜日: 月1火2水3木4金5
  const LIBERTA_OFF = {
    "野津周": { am: [1, 4], pm: [3] },
    "八壁": { am: [1] },
    "岩垣": { am: [1, 4], pm: [3] },
    "梶谷光": { am: [1] },
    "森井": { am: [3, 4, 5], pm: [2, 3, 4] },
  };
  const us = (name, deptId, days, deptByDay) => ({
    id: uid(), name, deptId, meetTime: "", sendTime: "", wheelchair: false, hasHelp: true,
    helpTwo: HELP_TWO.has(name), helpNote: "", days: days || [],
    ...(deptByDay ? { deptByDay } : {}),
    // リベルタ利用フラグ(朝・夕)。各利用曜日で有効。OffDaysは基本設定として外す曜日(自宅スタート/自宅帰り)
    ...(LIBERTA_USERS.has(name) ? {
      libertaAM: true, libertaPM: true,
      ...(LIBERTA_OFF[name] ? { libertaAMOffDays: LIBERTA_OFF[name].am || [], libertaPMOffDays: LIBERTA_OFF[name].pm || [] } : {}),
    } : {}),
  });
  const helpUser = (name, deptId, days = []) => ({
    id: uid(), name, deptId, meetTime: "", sendTime: "", wheelchair: false, hasHelp: true,
    helpTwo: HELP_TWO.has(name), helpNote: days.length ? "" : "ヘルプのみ", days,
  });
  const users = [
    // 嫁島
    us("中村", d1, [1, 2, 3, 4, 5]), // 金曜は自宅へ帰る日あり(帰宅時刻は記入シートで確認中)
    us("園山", d1, [1, 2, 3, 4, 5]),
    us("森", d1, [1, 2, 3, 4, 5]),
    us("竹田真", d1, [1, 2, 3, 4, 5]),
    us("星野", d1, [1, 2, 3, 4, 5]),
    us("森井", d1, [1, 2, 3, 4, 5], { 4: d2, 5: d2 }),
    us("馬場", d1, [1, 2, 3, 4, 5]),
    us("岡本", d1, [1, 2, 3, 4, 5]),
    us("津田", d1, [1, 2, 3, 4, 5]),
    us("菊谷", d1, [1, 2, 3]),
    us("藤井", d1, [1, 2, 3, 4, 5], { 5: d4 }), // 基本は嫁島、金曜のみあいのて
    // 津田
    us("楢木", d2, [1, 2, 3, 4, 5]),
    us("田中慶", d2, [1, 2, 3, 4, 5]),
    us("太田", d2, [1, 2, 3, 4, 5]),
    us("八壁", d2, [1, 2, 3]),
    us("勝部", d2, [1, 3, 4]),
    us("小川", d2, [1, 2, 3, 4, 5]),
    us("野津周", d2, [1, 2, 3, 4, 5]),
    // 川津
    us("黒田", d3, [1, 2, 3, 4, 5]),
    us("田原", d3, [1, 2, 3, 4, 5]),
    us("野津彩", d3, [1, 2, 3, 4, 5]),
    us("赤山", d3, [1, 2, 3, 4, 5], { 2: d1, 5: d1 }),
    us("岩垣", d3, [1, 2, 3, 4, 5], { 2: d4, 4: d4 }),
    us("錦織秀", d3, [1, 2, 3, 4]),
    us("早川", d3, [1, 2, 5]),
    us("猪原", d3, [1, 4, 5]),
    us("ホン", d3, [1, 3, 4]),
    us("小林", d3, [1, 3, 5]),
    us("米原", d3, [1, 2, 3, 4, 5]),
    us("田中か", d1, [1, 2, 3]),
    us("三澤", d1, [4, 5]),
    // あいのて
    us("増野", d4, [1, 2, 3, 4, 5]),
    us("山崎", d4, [1, 2, 3, 4, 5]),
    us("松本", d4, [1, 2, 4, 5]),
    us("青山", d4, [1, 2, 3, 4, 5]),
    us("梶谷奏", d4, [1, 2, 3, 4, 5]),
    us("錦織り", d4, [1, 2, 3, 4, 5], { 2: d3 }),
    us("森口", d4, [1, 2, 4, 5]),
    us("成相", d4, [1, 2, 3]),
    { ...helpUser("曳野", d5, []), startDate: "2026-08-05", helpNote: "2026/8/5から利用開始。月曜の担当は余村和(16:00)。月・水・金の16時または17時にヘルプ(1名で可)。入浴等の介助は男性職員のみ対応可" },
    // ヘルプ・少日数利用
    helpUser("井上", d4, [4]),
    helpUser("竹田寛", d2, [1]),
    helpUser("野津涼", d5),
    helpUser("吉浦", d5),
    helpUser("伊達", d5),
    helpUser("尾原", d5),
    { ...helpUser("松浦", d5), wheelchair: true }, // 車いす(カービィは車いす不可のため移送には使わない)
    // 新規
    us("梶谷光", d3, [2, 4], { 2: d4 }),
    // 水曜利用(2026年度新体制の水曜送迎表より)
    us("門脇", d1, [3]),
    us("戸井", d2, [3, 4, 5]),
    us("須山", d2, [3, 4, 5]),
    us("石田", d4, [2, 3, 4]),
    us("青木", d3, [3, 5]),
    us("橋本", d2, [2, 3]),
  ];
  users.forEach((u) => u.days.sort((a, b) => a - b));
  // 勤務シフト表(2026年度)から: 曜日別の勤務時間と固定休
  const STAFF_SHIFTS = {"安部": {"offDays": [0, 1], "shiftByDay": {"2": {"start": "8:15", "end": "17:30", "code": "正日B"}, "3": {"start": "8:15", "end": "17:30", "code": "正日B"}, "4": {"start": "8:15", "end": "17:30", "code": "正日B"}, "5": {"start": "8:15", "end": "17:30", "code": "正日B"}, "6": {"start": "8:45", "end": "18:00", "code": "正日D"}}}, "橋本": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "6:00", "end": "21:00", "code": "早遅変"}, "2": {"start": "6:00", "end": "22:00", "code": "正早遅"}, "3": {"start": "6:00", "end": "22:00", "code": "正早遅"}, "4": {"start": "6:00", "end": "22:00", "code": "正早遅"}, "5": {"start": "6:00", "end": "22:00", "code": "正早遅"}}}, "八壁": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "18:00", "code": "正日C"}, "2": {"start": "8:30", "end": "18:00", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "久保田": {"offDays": [2, 5], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "6": {"start": "9:00", "end": "18:00", "code": "正日E"}, "0": {"start": "9:00", "end": "18:00", "code": "正日E"}}}, "井川": {"offDays": [], "shiftByDay": {"1": {"start": "8:15", "end": "17:30", "code": "正日B"}, "2": {"start": "8:15", "end": "17:30", "code": "正日B"}, "3": {"start": "8:15", "end": "17:30", "code": "正日B"}, "4": {"start": "8:15", "end": "17:30", "code": "正日B"}, "5": {"start": "8:15", "end": "17:30", "code": "正日B"}, "6": {"start": "9:00", "end": "18:00", "code": "正日E"}, "0": {"start": "9:00", "end": "18:00", "code": "正日E"}}}, "白戸": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "2": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "成瀬": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "2": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "田中": {"offDays": [0, 1, 2, 3, 4, 5, 6], "shiftByDay": {"1": {"start": "9:00", "end": "13:00", "code": "パ"}, "2": {"start": "9:00", "end": "13:00", "code": "パ"}, "3": {"start": "9:00", "end": "13:00", "code": "パ"}, "4": {"start": "9:00", "end": "13:00", "code": "パ"}, "5": {"start": "9:00", "end": "13:00", "code": "パ"}}}, "青木": {"offDays": [3, 4], "shiftByDay": {"1": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "2": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "5": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "6": {"start": "9:00", "end": "17:30", "code": "嘱日D"}, "0": {"start": "9:00", "end": "17:30", "code": "嘱日D"}}}, "安達": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:15", "end": "17:30", "code": "正日B"}, "2": {"start": "8:15", "end": "17:30", "code": "正日B"}, "3": {"start": "8:15", "end": "17:30", "code": "正日B"}, "4": {"start": "8:15", "end": "17:30", "code": "正日B"}, "5": {"start": "8:15", "end": "17:30", "code": "正日B"}}}, "吉岡": {"offDays": [4, 5], "shiftByDay": {"1": {"start": "8:15", "end": "17:30", "code": "正日B"}, "2": {"start": "8:00", "end": "17:30", "code": "正日B"}, "3": {"start": "8:15", "end": "17:30", "code": "正日B"}, "6": {"start": "8:45", "end": "18:00", "code": "正日D"}, "0": {"start": "8:45", "end": "18:00", "code": "正日D"}}}, "毎熊": {"offDays": [0, 2, 4, 5, 6], "shiftByDay": {"1": {"start": "9:00", "end": "16:00", "code": "パ3"}, "3": {"start": "9:00", "end": "16:00", "code": "パ3"}}}, "藤原": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:15", "end": "17:30", "code": "正日B"}, "2": {"start": "8:15", "end": "17:30", "code": "正日B"}, "3": {"start": "8:15", "end": "17:30", "code": "正日B"}, "4": {"start": "8:15", "end": "17:30", "code": "正日B"}, "5": {"start": "8:15", "end": "17:30", "code": "正日B"}}}, "野津": {"offDays": [3, 4], "shiftByDay": {"1": {"start": "6:00", "end": "22:00", "code": "正早遅"}, "2": {"start": "6:00", "end": "22:00", "code": "正早遅"}, "5": {"start": "6:00", "end": "22:00", "code": "正早遅"}, "6": {"start": "9:00", "end": "18:00", "code": "正日E"}, "0": {"start": "9:00", "end": "18:00", "code": "正日E"}}}, "小瀧": {"offDays": [2, 3], "shiftByDay": {"1": {"start": "6:00", "end": "13:30", "code": "嘱早"}, "4": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "5": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "6": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "0": {"start": "11:30", "end": "19:00", "code": "嘱遅変"}}}, "窪田": {"offDays": [0, 1], "shiftByDay": {"2": {"start": "6:00", "end": "15:00", "code": "正早9"}, "3": {"start": "6:00", "end": "15:00", "code": "正早9"}, "4": {"start": "6:00", "end": "15:00", "code": "正早9"}, "5": {"start": "6:00", "end": "15:00", "code": "正早9"}, "6": {"start": "13:00", "end": "22:00", "code": "正遅9"}}}, "森": {"offDays": [5, 6], "shiftByDay": {"1": {"start": "13:00", "end": "22:00", "code": "正遅9"}, "2": {"start": "13:00", "end": "22:00", "code": "正遅9"}, "3": {"start": "13:00", "end": "22:00", "code": "正遅9"}, "4": {"start": "13:00", "end": "22:00", "code": "正遅9"}, "0": {"start": "13:00", "end": "22:00", "code": "正遅9"}}}, "鳥屋尾": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "9:00", "end": "16:00", "code": "パ3"}, "2": {"start": "9:00", "end": "16:00", "code": "パ3"}, "3": {"start": "9:00", "end": "16:00", "code": "パ3"}, "4": {"start": "9:00", "end": "16:00", "code": "パ3"}, "5": {"start": "9:00", "end": "16:00", "code": "パ3"}}}, "伊達": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "2": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "日野": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "2": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "余村慎": {"offDays": [0, 1], "shiftByDay": {"2": {"start": "9:00", "end": "18:00", "code": "正日E"}, "3": {"start": "6:00", "end": "15:00", "code": "正早9"}, "4": {"start": "6:00", "end": "15:00", "code": "正早9"}, "5": {"start": "9:00", "end": "18:00", "code": "日"}, "6": {"start": "13:00", "end": "22:00", "code": "正遅9"}}}, "横田": {"offDays": [4, 5], "shiftByDay": {"1": {"start": "9:00", "end": "18:00", "code": "正日E"}, "2": {"start": "6:00", "end": "14:00", "code": "正早8"}, "3": {"start": "6:00", "end": "14:00", "code": "正早8"}, "6": {"start": "9:00", "end": "18:00", "code": "正日E"}, "0": {"start": "6:00", "end": "14:00", "code": "正早8"}}}, "高井": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "2": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "与倉": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "9:30", "end": "18:30", "code": "正日F"}, "2": {"start": "9:30", "end": "18:30", "code": "正日F"}, "3": {"start": "9:30", "end": "18:30", "code": "正日F"}, "4": {"start": "9:30", "end": "18:30", "code": "正日F"}, "5": {"start": "9:30", "end": "18:30", "code": "正日F"}}}, "宮永": {"offDays": [1, 2], "shiftByDay": {"3": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "4": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "5": {"start": "9:00", "end": "17:30", "code": "嘱日D"}, "6": {"start": "14:30", "end": "22:00", "code": "嘱遅"}, "0": {"start": "14:30", "end": "22:00", "code": "嘱遅"}}}, "秋山": {"offDays": [2, 3], "shiftByDay": {"1": {"start": "14:00", "end": "22:00", "code": "正遅8"}, "4": {"start": "6:00", "end": "14:00", "code": "正早8"}, "5": {"start": "6:00", "end": "14:00", "code": "早"}, "6": {"start": "6:00", "end": "14:00", "code": "正早8"}, "0": {"start": "6:00", "end": "14:00", "code": "正早8"}}}, "柳原沙": {"offDays": [], "shiftByDay": {"1": {"start": "5:00", "end": "29:00", "code": "フリー"}, "2": {"start": "5:00", "end": "29:00", "code": "フリー"}, "3": {"start": "5:00", "end": "29:00", "code": "フリー"}, "4": {"start": "5:00", "end": "29:00", "code": "フリー"}, "5": {"start": "5:00", "end": "29:00", "code": "フリー"}, "6": {"start": "5:00", "end": "29:00", "code": "フリー"}, "0": {"start": "5:00", "end": "29:00", "code": "フリー"}}}, "外谷": {"offDays": [], "shiftByDay": {"1": {"start": "5:00", "end": "29:00", "code": "フリー"}, "2": {"start": "5:00", "end": "29:00", "code": "フリー"}, "3": {"start": "5:00", "end": "29:00", "code": "フリー"}, "4": {"start": "5:00", "end": "29:00", "code": "フリー"}, "5": {"start": "5:00", "end": "29:00", "code": "フリー"}, "6": {"start": "5:00", "end": "29:00", "code": "フリー"}, "0": {"start": "5:00", "end": "29:00", "code": "フリー"}}}, "飯塚": {"offDays": [2, 3, 4], "shiftByDay": {"1": {"start": "22:00", "end": "6:00", "code": "宿直P"}, "5": {"start": "22:00", "end": "6:00", "code": "宿直P"}, "6": {"start": "22:00", "end": "6:00", "code": "宿直P"}, "0": {"start": "22:00", "end": "6:00", "code": "宿直P"}}}, "川島": {"offDays": [3, 4], "shiftByDay": {"1": {"start": "6:00", "end": "14:00", "code": "正早8"}, "2": {"start": "6:00", "end": "14:00", "code": "正早8"}, "5": {"start": "14:00", "end": "22:00", "code": "正遅8"}, "6": {"start": "12:00", "end": "20:00", "code": "正遅変"}, "0": {"start": "6:00", "end": "14:00", "code": "正早8"}}}, "足立": {"offDays": [], "shiftByDay": {"1": {"start": "5:00", "end": "29:00", "code": "フリー"}, "2": {"start": "5:00", "end": "29:00", "code": "フリー"}, "3": {"start": "5:00", "end": "29:00", "code": "フリー"}, "4": {"start": "5:00", "end": "29:00", "code": "フリー"}, "5": {"start": "5:00", "end": "29:00", "code": "フリー"}, "6": {"start": "5:00", "end": "29:00", "code": "フリー"}, "0": {"start": "5:00", "end": "29:00", "code": "フリー"}}}, "杉谷": {"offDays": [2, 5], "shiftByDay": {"1": {"start": "14:00", "end": "22:00", "code": "正遅8"}, "3": {"start": "6:00", "end": "14:00", "code": "正早8"}, "4": {"start": "6:00", "end": "14:00", "code": "正早8"}, "6": {"start": "6:00", "end": "14:00", "code": "正早8"}, "0": {"start": "6:00", "end": "14:00", "code": "正早8"}}}, "角": {"offDays": [1, 4], "shiftByDay": {"2": {"start": "6:00", "end": "14:00", "code": "正早8"}, "3": {"start": "14:00", "end": "22:00", "code": "正遅8"}, "5": {"start": "6:00", "end": "14:00", "code": "正早8"}, "6": {"start": "6:00", "end": "14:00", "code": "正早8"}, "0": {"start": "14:00", "end": "22:00", "code": "正遅8"}}}, "長島": {"offDays": [1, 5], "shiftByDay": {"2": {"start": "14:00", "end": "22:00", "code": "正遅8"}, "3": {"start": "14:00", "end": "22:00", "code": "正遅8"}, "4": {"start": "14:00", "end": "22:00", "code": "正遅8"}, "6": {"start": "9:00", "end": "18:00", "code": "正日E"}, "0": {"start": "14:00", "end": "22:00", "code": "正遅8"}}}, "柳原栄": {"offDays": [], "shiftByDay": {"1": {"start": "5:00", "end": "29:00", "code": "フリー"}, "2": {"start": "5:00", "end": "29:00", "code": "フリー"}, "3": {"start": "5:00", "end": "29:00", "code": "フリー"}, "4": {"start": "5:00", "end": "29:00", "code": "フリー"}, "5": {"start": "5:00", "end": "29:00", "code": "フリー"}, "6": {"start": "5:00", "end": "29:00", "code": "フリー"}, "0": {"start": "5:00", "end": "29:00", "code": "フリー"}}}, "長田": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "13:30", "code": "パ2"}, "2": {"start": "8:30", "end": "13:30", "code": "パ2"}, "3": {"start": "8:30", "end": "13:30", "code": "パ2"}, "4": {"start": "8:30", "end": "13:30", "code": "パ2"}, "5": {"start": "8:30", "end": "13:30", "code": "パ2"}}}, "新見": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "9:30", "end": "19:00", "code": "日"}, "2": {"start": "9:30", "end": "19:00", "code": "日"}, "3": {"start": "9:30", "end": "19:00", "code": "日"}, "4": {"start": "9:30", "end": "19:00", "code": "日"}, "5": {"start": "9:00", "end": "19:00", "code": "日"}}}, "岩田": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "9:00", "end": "16:00", "code": "パ3"}, "2": {"start": "9:00", "end": "16:00", "code": "パ3"}, "3": {"start": "9:00", "end": "16:00", "code": "パ3"}, "4": {"start": "9:00", "end": "16:00", "code": "パ3"}, "5": {"start": "9:00", "end": "16:00", "code": "パ3"}}}, "古田": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "6:00", "end": "13:30", "code": "嘱調2"}, "2": {"start": "6:00", "end": "13:30", "code": "嘱調2"}, "3": {"start": "6:00", "end": "13:30", "code": "嘱調2"}, "4": {"start": "6:00", "end": "13:30", "code": "嘱調2"}, "5": {"start": "6:00", "end": "13:30", "code": "嘱調2"}}}, "余村和": {"offDays": [0, 2], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}, "6": {"start": "9:00", "end": "18:00", "code": "正日E"}}}, "池田": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "2": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "近藤": {"offDays": [3, 4], "shiftByDay": {"1": {"start": "9:00", "end": "18:00", "code": "正日E"}, "2": {"start": "9:00", "end": "18:00", "code": "正日E"}, "5": {"start": "9:00", "end": "18:00", "code": "正日E"}, "6": {"start": "6:00", "end": "14:00", "code": "正早8"}, "0": {"start": "9:00", "end": "18:00", "code": "正日E"}}}, "田邊": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "9:00", "end": "18:00", "code": "正日E"}, "2": {"start": "9:00", "end": "18:00", "code": "正日E"}, "3": {"start": "9:00", "end": "18:00", "code": "正日E"}, "4": {"start": "9:00", "end": "18:00", "code": "正日E"}, "5": {"start": "9:00", "end": "18:00", "code": "正日E"}}}, "中谷": {"offDays": [2, 4], "shiftByDay": {"1": {"start": "6:00", "end": "14:00", "code": "正早8"}, "3": {"start": "6:00", "end": "14:00", "code": "正早8"}, "5": {"start": "6:00", "end": "14:00", "code": "正早8"}, "6": {"start": "6:00", "end": "14:00", "code": "正早8"}, "0": {"start": "6:00", "end": "14:00", "code": "正早8"}}}, "落合": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "14:30", "end": "16:30", "code": "パ5"}, "2": {"start": "14:30", "end": "16:30", "code": "パ5"}, "3": {"start": "14:30", "end": "16:30", "code": "パ5"}, "4": {"start": "14:30", "end": "16:30", "code": "パ5"}, "5": {"start": "14:30", "end": "16:30", "code": "パ5"}}}, "長見": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "9:00", "end": "17:00", "code": "パ4"}, "2": {"start": "9:00", "end": "17:00", "code": "パ4"}, "3": {"start": "9:00", "end": "17:00", "code": "パ4"}, "4": {"start": "9:00", "end": "17:00", "code": "パ4"}, "5": {"start": "9:00", "end": "17:00", "code": "パ4"}}}, "岡部": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "2": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "石原": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "正日C"}, "2": {"start": "8:30", "end": "17:30", "code": "正日C"}, "3": {"start": "8:30", "end": "17:30", "code": "正日C"}, "4": {"start": "8:30", "end": "17:30", "code": "正日C"}, "5": {"start": "8:30", "end": "17:30", "code": "正日C"}}}, "小川": {"offDays": [0, 1, 5, 6], "shiftByDay": {"2": {"start": "22:00", "end": "6:00", "code": "宿直P"}, "3": {"start": "22:00", "end": "6:00", "code": "宿直P"}, "4": {"start": "22:00", "end": "6:00", "code": "宿直P"}}}, "大垣": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "9:00", "end": "12:00", "code": "パ6"}, "2": {"start": "9:00", "end": "12:00", "code": "パ6"}, "3": {"start": "9:00", "end": "12:00", "code": "パ6"}, "4": {"start": "9:00", "end": "12:00", "code": "パ6"}, "5": {"start": "9:00", "end": "12:00", "code": "パ6"}}}, "春日": {"offDays": [0, 6], "shiftByDay": {"1": {"start": "8:30", "end": "17:30", "code": "嘱日C"}, "2": {"start": "8:30", "end": "17:30", "code": "嘱日C"}, "3": {"start": "8:30", "end": "17:30", "code": "嘱日C"}, "4": {"start": "8:30", "end": "17:30", "code": "嘱日C"}, "5": {"start": "8:30", "end": "17:30", "code": "嘱日C"}}}};
  staff.forEach((s) => {
    const sh = STAFF_SHIFTS[s.name];
    if (sh) {
      s.offDays = sh.offDays;
      s.shiftByDay = sh.shiftByDay;
      // 基本時間は月〜金の最初の勤務日の時間に合わせる
      for (const wd of [1, 2, 3, 4, 5]) {
        if (sh.shiftByDay[wd]) { s.start = sh.shiftByDay[wd].start; s.end = sh.shiftByDay[wd].end; break; }
      }
    }
  });
  // 中抜け勤務(6〜9時+17〜22時、9〜17時は不在)
  staff.forEach((s) => {
    if (s.name === "野津" || s.name === "橋本") { s.awayFrom = "9:00"; s.awayTo = "17:00"; }
  });
  // 井川を職員列の先頭へ
  {
    const i2 = staff.findIndex((s) => s.name === "井川");
    if (i2 > 0) { const [ik] = staff.splice(i2, 1); staff.unshift(ik); }
  }
  // 利用者一覧シート(手書き)から読み取った迎え/送り時刻。byDay=曜日別の時刻(1=月..5=金)
  const USER_TIMES = {
    // 嫁島
    "藤井": { meet: "9:00", send: "17:30" },
    "馬場": { send: "17:00", note: "基本は家族送り・家族迎え(送迎なし)。送迎する場合は片道15分程度、送りは17:00嫁島発(17:15頃着)", noRide: { meet: "家族送り", send: "家族迎え" } },
    "中村": { send: "16:40", note: "リベルタへの送りは2便目(17:00)に固定(1便目16:00には乗せない)。帰宅の送りは17:00以降に自宅着(所要約20分→16:40より前に出発しない)" },
    "門脇": { meet: "9:00", send: "16:00", note: "基本は徒歩で単独送迎(片道5分程度)。雨天でも基本は徒歩、台風など悪天候のときのみ車(他の便に同乗可)" },
    "津田": { note: "木曜はプール(16:00着)。15:40頃プールへ送り、17:00頃プール迎え" },
    "森井": { byDay: { 2: { send: "17:50" }, 3: { meet: "9:00", send: "17:50" }, 4: { meet: "9:00", send: "17:50" }, 5: { meet: "9:00" } }, note: "自宅の乗降場所は温泉駅(表記も温泉駅)。水木金9:00迎え・火水木17:50送り、他はリベルタ" },
    // 津田
    "田中慶": { meet: "9:30", send: "16:00", note: "迎え・送りとも乗降場所はベル。片道30分程度" },
    "勝部": { meet: "9:30", send: "15:00", note: "時刻厳守。地区:島根町。ホンと同方向(まとめて回ると効率的)。送りははばたきへ16:15着希望(15:00頃に出発してドライブしながら向かう)" },
    "野津周": {
      byDay: { 3: { send: "15:00" } }, // 水曜は15:00着で自宅へ送り
      noRide: { meet: "家族送り", meetDays: [1, 4] }, // 月・木の朝は家族が施設へ送る
      note: "朝:月・木は家族が施設へ送る(迎えなし)。水曜は15:00着で自宅へ送り(他の夕はリベルタ)",
    },
    "八壁": { byDay: { 1: { meet: "9:00" } }, note: "月曜の朝のみ自宅から迎え(9:00頃)。他の朝はリベルタ" },
    "竹田寛": { meet: "9:30", send: "17:00", note: "介助は男性職員のみ対応可。時刻厳守。嫁島から片道20分・津田から片道30分。本人の行動の早さにより待つこともある。迎えが9:45を過ぎたら親の送りになるはず。乗り込みが大変な時があり、常勤職員がいる時の迎えが望ましい" },
    "橋本": { meet: "9:30", send: "17:30", note: "時刻厳守。地区:東光台(嫁島から25分・津田から15〜20分)。送りは17:30まででよい" },
    // 川津
    "野津彩": { note: "時刻は±10分OK(リベルタ発着・嫁島から5分・川津から15分)。訓練(東部)の迎え: 火曜9:30・金曜10:30。車椅子だが座位可能" },
    "黒田": { meet: "9:50", send: "15:30", byDay: { 2: { send: "14:30" }, 5: { send: "15:30" } }, note: "時刻は±10分OK。地区:シューズ愛ランド裏手(嫁島から15分・川津から5分)。送り先: 火曜(14:30頃)と金曜(15:30)は東部へ。他の曜日は自宅" },
    "田原": { meet: "9:30", send: "17:00", byDay: { 2: { send: "15:45" }, 4: { send: "15:45" } }, note: "時刻は±10分OK。地区:プラバホール近く(嫁島から10分・川津から13分)。同方向: 月=小林・赤山/金=青木・小林。火・木は15:45に東部(訓練)へ送り" },
    "赤山": { meet: "8:40", send: "17:30", note: "朝の迎え8:40は時刻厳守・夕は±10分OK。地区:青い看板(嫁島から12分・川津から15分)。火・金15時頃に津田で入浴ヘルプ(基本担当:長島)。入浴介助は男性職員のみ対応可(女性不可)。①嫁島の男性職員が津田へ連れて行き入浴介助まで、②送迎のみで入浴は津田の男性職員、の2パターン" },
    "岩垣": { meet: "9:30", send: "16:00", note: "時刻は±10分OK。自宅は嫁島から20分・川津から10分。自宅迎え(月・木)は9:30。自宅送り(水)は16:00〜17:00の間に着けばよい" },
    "錦織秀": { meet: "9:15", send: "15:30", byDay: { 2: { send: "13:00" }, 3: { send: "13:00" } }, note: "時刻は±10分OK。迎えは9:15。米原と同じ便のときは米原の後に迎え(9:40ごろ)。自宅は嫁島から15分・川津から15分。火・水は13:00に出発して送り。車椅子だが座位可能" },
    "八壁": { note: "月曜の迎えは9:00で確定(行動援護はなし)" },
    "猪原": { note: "送迎なし(母と来所・母迎え)。土曜のみ自宅迎え(9:00ごろ)", noRide: { meet: "母と来所", send: "母迎え" } },
    "ホン": { meet: "9:30", send: "15:00", note: "時刻厳守。迎えは風の丘9:30(嫁島から15分・川津から20分)。送りははばたきへ16:15着。15:00頃に施設を出発してドライブしながら向かう。勝部と同方向" },
    "小林": { meet: "9:00", send: "16:30", note: "時刻厳守。自宅は嫁島から12分・川津から15分。同方向: 月=田原・赤山/水=青木・赤山/金=青木・田原。送りは16:30または17:00" },
    "早川": { note: "時刻は±10分OK(リベルタ発着・嫁島から5分・川津から15分)。車椅子だが座位可能。梶谷光・梶谷奏と同乗NG" },
    "梶谷光": { note: "時刻は±10分OK(リベルタ発着・嫁島から5分・川津から15分)。早川と同乗NG" },
    "米原": { meet: "9:30", send: "16:30", note: "時刻は±10分OK。自宅は嫁島から7分・川津から15分。送りはリベルタ行き" },
    "田中か": { send: "16:00", note: "16:30までに自宅着(片道15分程度→16:15までに出発)" },
    "三澤": { meet: "9:00", send: "16:00", note: "基本は徒歩で単独送迎(片道5分程度・門脇と同じ場所から)。雨天でも基本は徒歩、台風など悪天候のときのみ車(他の便に同乗可)" },
    "青木": { meet: "9:00", send: "17:00", note: "時刻は±10分OK。自宅は嫁島から12分・川津から15分。同方向: 水=小林・赤山/金=小林・田原" },
    // あいのて
    "増野": { meet: "8:45", send: "16:45", note: "時刻厳守。地区:黒田町(嫁島から15分・あいのてから1分)。青山・藤井と同方向。事業所から近いため順番はおのずと1番か最後になる" },
    "山崎": { meet: "9:00", send: "17:00", note: "時刻は±10分OK。地区:八雲(嫁島から20分・あいのてから30分)。朝は森口・梶谷奏、夕は梶谷奏と同方向。送迎の順番は最後が望ましい。木曜はお母さんが買い物のため17時以降に自宅へ送る" },
    "松本": { meet: "8:50", send: "16:00", byDay: { 1: { send: "16:45" }, 2: { send: "12:15" } }, note: "時刻は±10分OK。石田と同方向(嫁島から15分・あいのてから10分)。送りは月16:45・火12:15・他16:00" },
    "青山": { meet: "9:00", send: "16:00", note: "時刻は±10分OK。地区:外中原(嫁島から15分・あいのてから5分)。藤井と同方向。松本さんが1日利用の日は松本さんと同方向" }, // 9時前後
    "梶谷奏": { meet: "8:45", send: "16:30", note: "時刻は±10分OK。地区:古志原(嫁島から10分・あいのてから15分)。山崎と同方向。冬場は暗くなる前に送る(16:30には自宅着)" }, // 16:30前後
    "錦織り": { note: "送り先はマンション。後部座席が安全で本人も好む(助手席は物を捨てたりすることがあり危ない)" },
    "森口": { meet: "9:30", send: "15:30", note: "時刻は±10分OK。地区:東出雲(嫁島から35分・あいのてから40分)。山崎と同方向" },
    "成相": { meet: "8:00", send: "17:30", note: "隔週で火曜に医療センターへ10:30迎え(隔週のため当日の予定を確認)。時刻厳守。朝の迎えは嫁島で乗車(基本固定)。嫁島から鬼滅などであいのてへ移動。送り17:30か18:30(母の希望でまちまち)。夕方の他事業所への移動は嫁島固定→嫁島から自宅送りの中継" },
    "井上": { meet: "9:30", send: "17:00", note: "生活介護の利用は木曜のみ(送迎は木曜だけ)。入浴介助は8/13から毎日(月〜金)・男性職員2名。時刻は±10分OK。朝は1人で待っている。送りは入浴の時間までに(17:00まで)。8/13に引っ越し予定(住所変更に注意)。8/13から毎日夕方の入浴介助が必要(男性職員2名で対応)" },
    "石田": { meet: "8:40", send: "16:30", noRide: { send: "プールのため家族迎え", sendDays: [4] }, note: "朝は時刻厳守・夕は±10分OK。地区:CoCo壱番屋・学園のうしろ(マンション201)。松本と同方向。迎えはインターホン(201)を押して外で待つ。帰りはインターホンを押して本人1人で上がる。毎週木曜はプールのため家族迎え(送りなし)。プールがない週のみ16:30に送り" },
  };
  // 利用者の性別(男女○付きシートより)。ここに無い利用者は男性
  const FEMALE_USERS = new Set(["園山", "星野", "森井", "津田", "菊谷", "田中か", "楢木", "野津彩", "岩垣", "猪原", "青木", "梶谷奏", "錦織り", "森口", "石田", "松浦"]);
  users.forEach((u) => { u.isMale = !FEMALE_USERS.has(u.name); });
  users.forEach((u) => {
    const ti = USER_TIMES[u.name];
    if (!ti) return;
    if (ti.meet) u.meetTime = ti.meet;
    if (ti.send) u.sendTime = ti.send;
    if (ti.byDay) u.timeByDay = ti.byDay;
    if (ti.note) u.helpNote = u.helpNote ? u.helpNote + " / " + ti.note : ti.note;
    if (ti.noRide) u.noRideDefault = ti.noRide; // 基本の送迎なし(新しいシート作成時に自動登録)
  });
  return { departments, staff: staff.map(stripSameShift), vehicles, users, rules: seedRules(), seeded: true, seedVersion: SEED_VERSION };
}
const emptySheet = () => ({ runs: [], blocks: [], staffOv: {}, userAbsent: {}, userDept: {}, notes: "", contact: "", training: "", noRide: {}, libertaOff: {}, libertaOn: {}, userTime: {} });
const emptyPattern = () => ({ runs: [], blocks: [] });

// ---------- 曜日別・当日別の部署を反映したマスタを作る ----------
// 優先順位:当日の指定 > 曜日別設定 > 基本部署。移動中は baseDeptId を持つ。
// seed(初期データ)を取り込みつつ、アプリ画面で行った追加・変更を残す。
// ・seedにしかいない人  → 追加する(新しく登録した職員・利用者・車)
// ・両方にいる人        → seedの内容を基本にしつつ、アプリで変えた項目は残す
// ・アプリにしかいない人 → そのまま残す(画面から追加した人が消えないようにする)
// 突き合わせは名前で行い、idはアプリ側の既存idを維持する(予定の担当が外れないため)
// 画面から削除した人の名前をマスタに記録する(seed更新時に復活させないため)
const markDeleted = (m, kind, item) => {
  const names = (item && typeof item === "object") ? [item.name, item._seed && item._seed.name] : [item];
  const add = names.filter(Boolean);
  if (!add.length) return m;
  const d = { ...(m._deleted || {}) };
  d[kind] = [...new Set([...(d[kind] || []), ...add])];
  return { ...m, _deleted: d };
};

function mergeSeedList(oldList, seedList, editedKeysOf, deletedNames) {
  const out = [];
  const usedOld = new Set();
  (seedList || []).forEach((sd) => {
    const prev = (oldList || []).find((o) => o.name && o.name === sd.name && !usedOld.has(o.id))
      // 画面で名前を変えた人(例: 職員1→山田)は、取り込んだ時の名前で突き合わせる
      || (oldList || []).find((o) => o._seed && o._seed.name === sd.name && !usedOld.has(o.id));
    if (!prev) {
      // 画面で削除された人はseedから復活させない
      if (deletedNames && deletedNames.has(sd.name)) return;
      out.push({ ...sd, _seed: { ...sd } });
      return;
    }
    usedOld.add(prev.id);
    // seedを土台に、アプリ側で編集された項目だけ上書きして戻す
    const keep = {};
    (editedKeysOf ? editedKeysOf(prev, sd) : []).forEach((k) => { keep[k] = prev[k]; });
    out.push({ ...sd, id: prev.id, ...keep, _seed: { ...sd } });
  });
  // アプリだけに存在する人(画面から追加した人)は末尾に残す
  (oldList || []).forEach((o) => { if (!usedOld.has(o.id)) out.push(o); });
  return out;
}

// アプリ側で編集された項目を検出する。
// 各人には前回取り込んだseed値を _seed に控えてあるので、
//   アプリの値 ≠ 前回のseed値 → 画面で変えた   → アプリの値を残す
//   アプリの値 = 前回のseed値 → 画面で触っていない → 新しいseedの値を採用する
// これでこちらの修正(古田を嘱託6:00-13:30にする等)もきちんと反映される。
const editedKeys = (keys) => (prev, sd) => {
  const base = prev._seed || {};
  return keys.filter((k) => {
    const a = prev[k];
    if (a === undefined) return false;                     // アプリ側に無い項目は触らない
    if (!(k in base)) return JSON.stringify(a) !== JSON.stringify(sd[k]); // 初回は従来どおり
    return JSON.stringify(a) !== JSON.stringify(base[k]);  // 前回seedから変わっていれば画面での変更
  });
};

function mergeSeedMaster(oldMaster, seed) {
  if (!oldMaster || !oldMaster.staff || !oldMaster.staff.length) {
    // 初回はseedをそのまま採用し、次回の比較用に_seedを控える
    const stamp = (l) => (l || []).map((x) => ({ ...x, _seed: { ...x } }));
    return { ...seed, staff: stamp(seed.staff), vehicles: stamp(seed.vehicles), users: stamp(seed.users) };
  }
  // 画面で削除された人はseedから復活させない。
  // 削除の記録はマスタの_deletedに名前で残す(削除時にその場で記録できないため、
  // 前回のseed一覧と今のマスタを突き合わせて、居なくなった人を削除済みとみなす)
  const prevDel = oldMaster._deleted || {};
  const deletedNamesOf = (kind) => new Set(prevDel[kind] || []);
  const delStaff = deletedNamesOf("staff");
  const delVeh = deletedNamesOf("vehicles");
  const delUser = deletedNamesOf("users");
  // 部署は名前が同じものを維持(idが変わると全員の所属が外れるため)
  const departments = (seed.departments || []).map((d) => {
    const prev = (oldMaster.departments || []).find((o) => o.name === d.name);
    return prev ? { ...d, id: prev.id } : d;
  });
  const deptIdOf = (seedDeptId) => {
    const sd = (seed.departments || []).find((d) => d.id === seedDeptId);
    const kept = sd && departments.find((d) => d.name === sd.name);
    return kept ? kept.id : seedDeptId;
  };
  // 所属だけでなく、曜日別部署・兼務先・曜日別の兼務先も付け替える(付け替えないと存在しない部署を指す)
  const mapDays = (o) => {
    if (!o || typeof o !== "object") return o;
    const n = {};
    Object.entries(o).forEach(([k, v]) => { n[k] = v ? deptIdOf(v) : v; });
    return n;
  };
  const fixDept = (x) => {
    if (!x) return x;
    const y = { ...x };
    if (y.deptId) y.deptId = deptIdOf(y.deptId);
    if (y.deptByDay) y.deptByDay = mapDays(y.deptByDay);
    if (y.subDeptId) y.subDeptId = deptIdOf(y.subDeptId);
    if (y.subDeptByDay) y.subDeptByDay = mapDays(y.subDeptByDay);
    return y;
  };
  // すでに存在しない部署を指している曜日別部署・兼務先を直す(初期データにいる人はその値、いない人は外す)
  const validIds = new Set(departments.map((d) => d.id));
  const repair = (list, seedList) => (list || []).map((x) => {
    const sd = (seedList || []).find((y) => y.name === x.name);
    let y = x;
    const badDays = (o) => o && Object.values(o).some((v) => v && !validIds.has(v));
    const cleanDays = (o) => { const n = {}; Object.entries(o || {}).forEach(([k, v]) => { if (v && validIds.has(v)) n[k] = v; }); return n; };
    if (badDays(y.deptByDay)) y = { ...y, deptByDay: sd && sd.deptByDay && !badDays(sd.deptByDay) ? { ...sd.deptByDay } : cleanDays(y.deptByDay) };
    if (y.subDeptId && !validIds.has(y.subDeptId)) y = { ...y, subDeptId: sd && sd.subDeptId && validIds.has(sd.subDeptId) ? sd.subDeptId : "" };
    if (badDays(y.subDeptByDay)) y = { ...y, subDeptByDay: sd && sd.subDeptByDay && !badDays(sd.subDeptByDay) ? { ...sd.subDeptByDay } : cleanDays(y.subDeptByDay) };
    if (y.deptId && !validIds.has(y.deptId) && sd && validIds.has(sd.deptId)) y = { ...y, deptId: sd.deptId };
    return y;
  });
  const seedStaff = (seed.staff || []).map(fixDept), seedUsers = (seed.users || []).map(fixDept);
  return {
    ...seed,
    departments,
    staff: repair(mergeSeedList(oldMaster.staff, seedStaff,
      editedKeys(["name", "deptId", "position", "emp", "start", "end", "canDrive", "isMale", "hasOwnCar", "ownCarCap", "offDays", "memo", "shiftByDay", "deptByDay", "subDeptId", "noGrid", "hideInStaffList", "hideInPartList", "helpOnly", "sortLast", "retireDate"]), delStaff), seedStaff),
    vehicles: mergeSeedList(oldMaster.vehicles, (seed.vehicles || []).map(fixDept),
      editedKeys(["name", "deptId", "cap", "wc", "memo"]), delVeh),
    users: repair(mergeSeedList(oldMaster.users, seedUsers,
      editedKeys(["name", "deptId", "days", "daysFrom", "meet", "send", "note", "memo", "wc", "isMale", "deptByDay"]), delUser), seedUsers),
    seedVersion: seed.seedVersion,
    // ルールは画面で編集するものなので、すでにあればそのまま残す
    rules: oldMaster.rules || seed.rules,
    ...(oldMaster.rulesUntil ? { rulesUntil: oldMaster.rulesUntil } : {}),   // 日付で切り替わるルールも残す
    _deleted: { staff: [...delStaff], vehicles: [...delVeh], users: [...delUser] },
  };
}


/* ============================================================
   ヘルプ表: 「基本この曜日はこの人がこのヘルプに入る」を登録する
   rules.helpBase = [{ label, time, byDay: { 1:"井川", ... } }]
   ============================================================ */
const helpKey = (label, time) => `${String(label || "").trim()}@${String(time || "").trim()}`;
// 週間パターン(全曜日)からヘルプを集めて、行(ラベル+時刻)ごとに曜日別の担当をまとめる
function collectHelpRows(master, patterns) {
  const rows = {};
  const sName = (id) => (master.staff.find((s) => s.id === id) || {}).name || "";
  DAY_ORDER.forEach((wd) => {
    const p = (patterns || {})[wd];
    if (!p) return;
    (p.blocks || []).forEach((b) => {
      if (b.kind !== "help") return;
      const k = helpKey(b.label, b.time);
      if (!rows[k]) rows[k] = { label: String(b.label || "").trim(), time: String(b.time || "").trim(), pattern: {}, count: 0 };
      // 同じ曜日に同じヘルプが2件(2名体制)ある場合は「・」でつなぐ
      const cur = rows[k].pattern[wd];
      const nm = sName(b.staffId) || "保留";
      rows[k].pattern[wd] = cur ? `${cur}・${nm}` : nm;
      rows[k].count++;
    });
  });
  return rows;
}
// 基本担当を引く(ラベル+時刻で一致。無ければ同じラベルが1件だけならそれを使う)
function helpBaseFor(rules, label, time) {
  const list = (rules.helpBase || []).filter((r) => r && r.label);
  const lb = String(canonHelpLabel(label) || "").trim(), tm = String(time || "").trim();
  const exact = list.find((r) => r.label === lb && String(r.time || "").trim() === tm);
  if (exact) return exact;
  const byLabel = list.filter((r) => r.label === lb);
  return byLabel.length === 1 ? byLabel[0] : null;
}
// その日のヘルプのうち、基本担当と違うものを拾う(基本担当が休みの日は対象外)
// ヘルプ表の1マス(ヘルプ名・時刻・曜日・選んだ人)がルールに反していないか
// 戻り値: { errors: [...](赤: 出力時にも確認が出る), infos: [...](黄: お知らせ) }
// helpBaseAll を渡すと、2名体制を同じ時刻の別の行(黒田ヘルプ+黒田入浴ヘルプなど)と合わせて数える
function helpBaseCellIssues(master, label, time, wd, names, helpBaseAll) {
  const R = rulesOf(master);
  const errors = [], infos = [];
  const lb = String(label || "").trim();
  const t = toMin(time);
  const ns = (names || []).filter(Boolean);
  if (!ns.length) return { errors, infos };
  // 男性のみ
  (R.maleOnly || []).forEach((row) => {
    if (!row || !row.user || !lb.startsWith(row.user)) return;
    if (row.bathOnly && !/入浴/.test(lb)) return;
    if (row.from && (t == null || t < toMin(row.from))) return;
    const fem = ns.filter((n) => { const s = (master.staff || []).find((x) => x.name === n); return s && !s.isMale; });
    if (fem.length) errors.push(`${row.user}は男性職員のみ対応可です(${fem.join("・")}は女性)`);
  });
  // 2名体制(15時以降)。同じ曜日・同じ時刻の、同じ利用者のヘルプ行をまとめて数える
  (R.helpTwo || []).forEach((row) => {
    if (!row || !row.user || !(row.days || []).includes(Number(wd)) || !lb.startsWith(row.user)) return;
    if (t == null || t < 15 * 60) return;
    let cnt = 0;
    const list = helpBaseAll && helpBaseAll.length ? helpBaseAll : [{ label: lb, time, byDay: { [wd]: ns.join("・") } }];
    list.forEach((hb) => {
      if (!String(hb.label || "").startsWith(row.user) || toMin(hb.time) !== t) return;
      const v = (hb.byDay || {})[wd];
      if (v) cnt += String(v).split("・").map((x) => x.trim()).filter(Boolean).length;
    });
    if (cnt < 2) errors.push(`${DAYS[wd]}曜の${row.user}は夕方2名体制です(いま${cnt}名)`);
  });
  // 固定担当ルール(ヘルプ)と違う人 → ヘルプ表が優先されるのでお知らせだけ
  (R.fixedBlock || []).forEach((row) => {
    if (!row || !row.staff || !(row.days || []).includes(Number(wd))) return;
    if (row.kind && row.kind !== "help") return;
    const hit = row.exact ? lb === row.label : lb.startsWith(row.label);
    if (!hit || !ruleTimeHit(row, t)) return;
    if (!ns.includes(row.staff)) infos.push(`ルールの固定担当は${row.staff}です(ヘルプ表のほうを優先します)`);
  });
  return { errors, infos };
}

function helpBaseWarn(master, sheetData, wd) {
  const out = [];
  const rules = rulesOf(master);
  if (!(rules.helpBase || []).length || wd == null) return out;
  const sName = (id) => { const s = (master.staff || []).find((x) => x.id === id); return s ? s.name : "保留"; };
  // 同じヘルプ(名前+時刻)をまとめる。2名体制は2件そろって1つの組として見る
  const groups = {};
  (sheetData.blocks || []).forEach((b) => {
    if (b.kind !== "help") return;
    const k = helpKey(b.label, b.time);
    if (!groups[k]) groups[k] = { label: b.label, time: b.time, names: [] };
    groups[k].names.push(sName(b.staffId));
  });
  Object.values(groups).forEach((g) => {
    const row = helpBaseFor(rules, g.label, g.time);
    const want = row && (row.byDay || {})[wd];
    if (!want) return;
    const wants = String(want).split("・").map((x) => x.trim()).filter(Boolean);
    // 基本の担当のうち、その日休みでないのに入っていない人がいれば確認を出す
    const missing = wants.filter((n) => !g.names.includes(n) && !ruleStaffOff(master, sheetData, wd, n));
    if (!missing.length) return;
    out.push(`${g.time} ${g.label}: 基本は${wants.join("・")}ですが ${g.names.join("・") || "担当なし"} になっています`);
  });
  return out;
}

function applyDayDept(master, wd, staffOv, userDept, userExtra, dateStr) {
  const sd = staffOv || {}, ud = userDept || {}, ux = userExtra || {};
  const staff = master.staff.map((s) => {
    const d = (sd[s.id] && sd[s.id].deptId) || (s.deptByDay || {})[wd] || s.deptId;
    // 曜日別勤務時間(当日変更が優先されるので、ここでは基本+曜日別のみ反映)
    const shift = (s.shiftByDay || {})[wd];
    // dayApplied: 当日の部署(当日変更>曜日別>所属)を解決済みという印。
    // これが付いた職員は、以降で曜日別(deptByDay)を再適用してはいけない(当日変更が打ち消されるため)
    let ns = { ...s, dayApplied: true };
    if (d !== s.deptId) ns = { ...ns, deptId: d, baseDeptId: s.deptId };
    if (shift && shift.start && shift.end) ns = { ...ns, start: shift.start, end: shift.end, shiftLabel: true };
    return ns;
  });
  const users = master.users.map((u) => {
    const d = ud[u.id] || (u.deptByDay || {})[wd] || u.deptId;
    let nu = d === u.deptId ? u : { ...u, deptId: d, baseDeptId: u.deptId };
    // 開始日(startDate)より前の日付では利用しない扱いにする(例: 8/5から利用開始)
    if (nu.startDate && dateStr && String(dateStr) < String(nu.startDate)) nu = { ...nu, days: [], beforeStart: true };
    // daysFrom: その日付以降は利用曜日が変わる(例: 8/13から月〜金に増える)
    if (nu.daysFrom && dateStr) {
      const keys = Object.keys(nu.daysFrom).filter((k) => String(dateStr) >= String(k)).sort();
      if (keys.length) nu = { ...nu, days: nu.daysFrom[keys[keys.length - 1]] };
    }
    // 「今日だけ利用」: 本来は利用曜日でない人を当日だけ利用日として扱う(未割当・自動割当・警告の判定が通常どおり効く)
    if (ux[u.id] && wd != null && !((u.days || []).includes(wd))) nu = { ...nu, days: [...(u.days || []), wd], extraUseDay: true };
    return nu;
  });
  // その日の送迎表に効くルール(日付で切り替わるルールがあれば、その日の分)
  const rules = dateStr && (master.rulesUntil || []).length ? { rules: rulesAtDate(master, dateStr) } : {};
  return { ...master, ...rules, staff, users };
}

// ---------- 車両の解決(公用車 or 職員の自車) ----------
// vehicleId が "own:<staffId>" の場合は職員の自家用車を表す
// 送迎以外の予定(ブロック)を「利用者に関するもの(特記事項)」と「業務連絡」に振り分け
function buildAutoNotes(master, blocks) {
  const userNameSet = master.users.map((u) => u.name).filter(Boolean);
  const startsWithUser = (label) => userNameSet.some((n) => label.startsWith(n) || label.includes(n));
  const userNotes = [], bizNotes = [];
  [...(blocks || [])]
    .filter((b) => (b.label || "").trim())
    .sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0))
    .forEach((b) => {
      const line = `${(b.label || "").trim()} ${b.time}〜`;
      if (startsWithUser((b.label || "").trim())) userNotes.push(line);
      else bizNotes.push(line);
    });
  // 同じ内容+同じ時刻は1つに統合(例:2名体制のヘルプが2件登録されていても表記は1つ)
  return { userNotes: [...new Set(userNotes)], bizNotes: [...new Set(bizNotes)] };
}

// seedのパターン(名前ベース)を現在のマスタのIDに解決してpattern形式へ
function resolveSeedPattern(master, sp) {
  if (!sp) return { runs: [], blocks: [] };
  const sByName = {}; master.staff.forEach((s) => { sByName[s.name] = s.id; });
  const uByName = {};
  master.users.forEach((u) => {
    uByName[u.name] = u.id;
    // 訓練の表記(◯◯迎(訓送)・◯◯送(訓練)・◯◯(訓迎)など)や自宅表記付きでも同じ人として照合する
    ["迎(訓送)終", "迎(訓送)", "迎(訓練)", "送(訓練)", "(訓迎)", "(訓送)", "(訓)", "(訓練)", "(自宅)", "(温泉駅)"].forEach((sfx) => { uByName[u.name + sfx] = u.id; });
  });
  const vByName = {}; master.vehicles.forEach((v) => { vByName[v.name] = v.id; });
  // 短縮表記(ピカ等)でも照合できるようにする
  const vShort = makeVehShortMap(master.vehicles);
  master.vehicles.forEach((v) => { if (vShort[v.id] && !vByName[vShort[v.id]]) vByName[vShort[v.id]] = v.id; });
  const runs = (sp.runs || []).map((r) => ({
    id: uid(), kind: r.kind, ...(r.mode ? { mode: r.mode } : {}), time: r.time,
    staffId: sByName[r.staffName] || HOLD_ID,
    vehicleId: vByName[r.vehName] || "",
    userIds: (r.userNames || []).map((n) => uByName[n]).filter(Boolean),
    staffRiderIds: (r.riderNames || []).map((n) => sByName[n]).filter(Boolean),
    note: r.note || "",
    ...(r.trainNames ? { trainUserIds: r.trainNames.map((n) => uByName[n]).filter(Boolean) } : {}),
    ...(r.trainBothNames ? { trainBothIds: r.trainBothNames.map((n) => uByName[n]).filter(Boolean) } : {}),
    ...(r.trainDropNames ? { trainDropIds: r.trainDropNames.map((n) => uByName[n]).filter(Boolean) } : {}),
  }));
  const blocks = (sp.blocks || []).map((b) => {
    const staffId = sByName[b.staffName] || HOLD_ID;
    // ヘルプの車両: "__own__"=担当職員の自車、それ以外は公用車名で解決
    let vehicleId = "";
    if (b.vehName === "__own__") vehicleId = staffId !== HOLD_ID ? "own:" + staffId : "";
    else if (b.vehName) vehicleId = vByName[b.vehName] || "";
    // 「○○ヘルプ」のラベルから対象利用者を解決(できた場合のみ)
    let userIds = [];
    if (b.kind === "help") {
      const mm = String(b.label || "").match(/^(.+?)ヘルプ$/);
      if (mm && uByName[mm[1].trim()]) userIds = [uByName[mm[1].trim()]];
    }
    return { id: uid(), kind: b.kind, time: b.time, staffId, label: b.label, vehicleId, userIds };
  });
  return { runs, blocks, training: (sp.training || []).join("\n") };
}

function resolveVehicle(master, vehicleId) {
  if (!vehicleId) return null;
  if (String(vehicleId).startsWith("own:")) {
    const s = master.staff.find((x) => x.id === String(vehicleId).slice(4));
    if (!s) return null;
    // 自車は本人(運転者)のみ乗車。利用者・同乗は乗せない前提で定員0。
    return {
      id: vehicleId, name: "自車", deptId: s.deptId,
      capNormal: s.ownCarCap != null ? s.ownCarCap : 0, capWc: 0, wheelchairOK: false,
      own: true, ownerId: s.id, ownerOnly: true,
    };
  }
  return master.vehicles.find((v) => v.id === vehicleId) || null;
}

// ---------- 男性職員の在席集計 ----------
// ある時刻に、各部署に「在席している男性」が何人いるかを返す。
// 在席 = 出勤中(勤務時間内・休み/固定休でない) かつ その時刻に送迎/ヘルプ/予定で外に出ていない
function maleCoverage(master, data, wd, timeMin) {
  const ov = data.staffOv || {};
  const working = (s) => {
    if (!s.isMale) return false;
    if (HEADCOUNT_EXCLUDE.has(s.name)) return false; // 与倉・古田は人員に数えない
    const o = ov[s.id] || {};
    if (o.off) return false;
    if (wd != null && (s.offDays || []).includes(wd) && !o.workToday) return false;
    const st = toMin(o.start || s.start), en = toMin(o.end || s.end);
    if (st != null && timeMin < st) return false; // 遅刻・出勤前
    if (en != null && timeMin >= en) return false; // 早退・退勤後
    const aw0 = toMin(s.awayFrom), aw1 = toMin(s.awayTo);
    if (aw0 != null && aw1 != null && timeMin >= aw0 && timeMin < aw1) return false; // 中抜けの不在時間帯
    return true;
  };
  // その時刻に外出中(便の運転/同乗、ブロック)の職員ID
  const away = new Set();
  (data.runs || []).forEach((r) => {
    const t = toMin(r.time);
    const dur = Number(r.durMin) || 60; // 所要時間設定があればそれを拘束時間に、なければ約1時間
    if (t != null && timeMin >= t && timeMin < t + dur) {
      if (r.staffId) away.add(r.staffId);
      (r.staffRiderIds || []).forEach((id) => away.add(id));
    }
  });
  (data.blocks || []).forEach((b) => {
    const t = toMin(b.time);
    const dur = b.kind === "help" ? helpDurMin(b) : (Number(b.durMin) || 60);
    if (t != null && timeMin >= t && timeMin < t + dur) away.add(b.staffId);
  });
  const perDept = {};
  master.departments.forEach((d) => { perDept[d.id] = { present: [], away: [] }; });
  master.staff.forEach((s) => {
    if (!working(s)) return;
    // リベルタ職員は兼務先部署に帰属させてカウント
    const belong = belongDeptOf(master, s, wd);
    if (!perDept[belong]) perDept[belong] = { present: [], away: [] };
    if (away.has(s.id)) perDept[belong].away.push(s);
    else perDept[belong].present.push(s);
  });
  return perDept;
}

// ============================================================
// Excel送迎表(日付シート)→ 週間パターン 取り込みロジック
// aoa = SheetJSで読んだ2次元配列(sheet_to_json header:1)
// master = 現在のマスタ(照合用)
// 返り値: { runs, blocks, unmatched, log }
// ============================================================

const VEH_ALIAS = {
  "ドナルド": "ドナルド", "ドラ": "ドナルド", "セレナ": "セレナ", "カービィ": "カービィ",
  "ピカ": "ピカチュウ", "ピカチュウ": "ピカチュウ", "ミッフィー": "ミッフィー", "ミッフィ": "ミッフィー",
  "ケロ": "ケロッピー", "ケロッピー": "ケロッピー", "マイメロ": "マイメロ", "マイメ": "マイメロ",
  "トラッキー": "トラッキー", "トラ": "トラッキー", "チョッパー": "チョッパー", "チョ": "チョッパー",
  "ガチャ": "ガチャ", "ムック": "ムック", "ノンタン": "ノンタン", "ノン": "ノンタン", "鬼滅": "鬼滅",
};

// 便でも利用者でもない補助語(予定ブロック or 無視)
const BLOCK_WORDS = ["受入", "開錠", "施錠", "対応", "透析", "モニタリング", "薬セット", "回収", "交換", "受付",
  "起床", "退勤", "出勤", "請求事務", "受診", "入浴", "介助", "医療センター", "早退", "休み", "モニ"];
const IGNORE_WORDS = ["よめしま", "よめ", "つだ", "あいのて", "あい", "かわつ", "かわつへ", "リベ",
  "①便", "②便", "便", "自車", "迎え", "送り", "迎", "送", "川津勤務", "同乗", "東部", "退勤"];

function toMinLoose(t) {
  if (!t) return null;
  const m = String(t).replace(/：/g, ":").match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fmtTime(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}
const cleanName = (s) => String(s || "").replace(/[\s\u3000（）()◆★]/g, "").trim();

// 男性職員(人数集計・列並びで使用)
const MALE_STAFF = new Set(["井川", "八壁", "岡部", "余村和", "横田", "秋山", "橋本", "野津", "近藤", "余村慎", "宮永", "長島", "安部"]);

// 括弧内の地名・補足を除去(利用者名照合用)。例 "早川(東部)"→"早川", "岩垣(自宅)"→"岩垣"
const stripParen = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").trim();

// 職員の実効勤務時間: 日別上書き(staffOv) → 曜日別シフト(shiftByDay) → 基本(start/end)
function staffTimeOf(s, weekday, ov) {
  const sh = (s.shiftByDay || {})[weekday] || {};
  return {
    start: (ov && ov.start) || sh.start || s.start,
    end: (ov && ov.end) || sh.end || s.end,
  };
}

// 利用者の実効利用時間: 日別上書き(sheet.userTime) → 曜日別(user.timeByDay) → 基本(meetTime/sendTime)
function userTimeOf(u, weekday, sheetUserTime) {
  const dayOv = (u.timeByDay || {})[weekday] || {};
  const shOv = (sheetUserTime || {})[u.id] || {};
  return {
    meet: shOv.meet || dayOv.meet || u.meetTime || "",
    send: shOv.send || dayOv.send || u.sendTime || "",
  };
}

// 名前文字列を利用者IDへ。空白区切り → 連結名は貪欲マッチで分割
function matchUsers(text, userIndex, userNames, unmatchedSet) {
  const ids = [];
  const parts = String(text).split(/[\s\u3000・､、]+/).filter(Boolean);
  for (let raw of parts) {
    raw = stripParen(raw);
    let key = cleanName(raw);
    if (!key) continue;
    if (userIndex[key]) { ids.push(userIndex[key]); continue; }
    // 連結名(例 野津彩早川 / 赤山小林)を前方最長一致で分割
    let rest = key, matchedAny = false, guard = 0;
    while (rest && guard++ < 8) {
      let hit = null;
      for (let len = Math.min(4, rest.length); len >= 2; len--) {
        const cand = rest.slice(0, len);
        if (userIndex[cand]) { hit = { id: userIndex[cand], len }; break; }
      }
      if (!hit) break;
      ids.push(hit.id); rest = rest.slice(hit.len); matchedAny = true;
    }
    if (!matchedAny && key.length >= 2) unmatchedSet.add(raw);
    else if (rest && rest.length >= 2) unmatchedSet.add(rest);
  }
  return ids;
}

// 括弧内が職員名なら同乗職員とみなす。例 "(吉岡)" "(八壁、村松)"
function matchRiders(text, staffByName) {
  const ids = [];
  const m = String(text).match(/[（(]([^）)]+)[）)]/);
  if (!m) return ids;
  m[1].split(/[\s\u3000・､、,]+/).filter(Boolean).forEach((p) => {
    const s = staffByName[cleanName(p)];
    if (s) ids.push(s.id);
  });
  return ids;
}

// このアプリが出力したExcel(月日/部署/氏名の縦ヘッダー形式)を読み戻す
function importAppExport(aoa, master) {
  const z = (v) => toZenkakuKana(String(v == null ? "" : v).replace(/\r/g, ""));
  const nameRow = aoa[4] || [];
  const colStaff = {};
  const colFlag = {}; // 列ごとの当日情報: { off, workToday, moved }
  for (let c = 1; c < nameRow.length; c++) {
    let n = z(nameRow[c]).trim();
    if (!n) continue;
    const moved = /◆/.test(n);              // ◆=当日は別部署で勤務
    const workToday = /\(休出\)/.test(n);    // 固定休だが本日出勤
    const off = /\(休\)/.test(n);            // 当日休み
    n = n.replace(/\(休出\)|\(休\)/g, "").replace(/[◆★]/g, "").trim();
    if (!n) continue;
    colStaff[c] = n;
    if (moved || workToday || off) colFlag[c] = { moved, workToday, off };
  }
  let gridStart = -1;
  for (let r2 = 5; r2 < aoa.length; r2++) {
    if (/^\d{1,2}:\d{2}$/.test(String((aoa[r2] || [])[0] || "").trim())) { gridStart = r2; break; }
  }
  let gridEnd = aoa.length;
  for (let r2 = Math.max(gridStart, 0); r2 < aoa.length; r2++) {
    const v = String((aoa[r2] || [])[0] || "").trim();
    if (["利用者", "職員", "配車", "送迎"].includes(v)) { gridEnd = r2; break; }
  }
  const sByName = {}; master.staff.forEach((s) => { sByName[s.name] = s.id; });
  const uByName = {};
  master.users.forEach((u) => {
    uByName[u.name] = u.id;
    // 訓練の表記(◯◯迎(訓送)・◯◯送(訓練)・◯◯(訓迎)など)や自宅表記付きでも同じ人として照合する
    ["迎(訓送)終", "迎(訓送)", "迎(訓練)", "送(訓練)", "(訓迎)", "(訓送)", "(訓)", "(訓練)", "(自宅)", "(温泉駅)"].forEach((sfx) => { uByName[u.name + sfx] = u.id; });
  });
  const vByName = {}; master.vehicles.forEach((v) => { vByName[v.name] = v.id; });
  // 短縮表記(ピカ等)でも照合できるようにする
  const vShort2 = makeVehShortMap(master.vehicles);
  master.vehicles.forEach((v) => { if (vShort2[v.id] && !vByName[vShort2[v.id]]) vByName[vShort2[v.id]] = v.id; });
  const KMAP = { "迎": "meet", "送": "send", "他": "other_run" };
  // ---- 職員の当日情報(休み・休出・遅刻早退・当日部署)の読み戻し ----
  const staffOvOut = {};
  {
    const setOv = (id, patch) => { staffOvOut[id] = { ...(staffOvOut[id] || {}), ...patch }; };
    const rowIdxByLabel = (label) => {
      for (let r0 = 0; r0 < Math.min(8, aoa.length); r0++) if (z((aoa[r0] || [])[0]).trim() === label) return r0;
      return -1;
    };
    const deptRowIdx = rowIdxByLabel("部署"), timeRowIdx = rowIdxByLabel("時間");
    // 部署帯は結合セルのため先頭列にしか値が無い→左から引き継いで各列の当日部署名を出す
    const colDept = {};
    if (deptRowIdx >= 0) {
      let cur = "";
      for (let c = 1; c < nameRow.length; c++) {
        const v = z((aoa[deptRowIdx] || [])[c]).trim();
        if (v) cur = v.split("\n")[0].replace(/\(休み\)$/, "").trim(); // 「リベルタ・他\n→津田」は1行目のみ
        colDept[c] = cur;
      }
    }
    const deptByName2 = {}; master.departments.forEach((d) => { deptByName2[d.name] = d.id; });
    for (let c = 1; c < nameRow.length; c++) {
      const sid = sByName[colStaff[c]];
      if (!sid) continue;
      const s0 = master.staff.find((x) => x.id === sid);
      const fl = colFlag[c] || {};
      if (fl.off) setOv(sid, { off: true });
      if (fl.workToday) setOv(sid, { workToday: true });
      if (fl.moved && colDept[c]) {
        const did = deptByName2[colDept[c]];
        if (did && s0 && did !== s0.deptId) setOv(sid, { deptId: did });
      }
      // 時間行「9:30〜\n17:30(\nメモ)」: マスタの基本時間と違えば遅刻・早退等として反映
      if (timeRowIdx >= 0 && !fl.off && s0) {
        const tv = z((aoa[timeRowIdx] || [])[c]);
        if (tv.trim() && tv.trim() !== "休み") {
          const lines = tv.split("\n").map((x) => x.trim()).filter(Boolean);
          const mt = (lines[0] || "").match(/(\d{1,2}:\d{2})/);
          const me = (lines[1] || "").match(/(\d{1,2}:\d{2})/);
          const note = lines.slice(2).join(" ");
          if (mt && toMin(mt[1]) !== toMin(s0.start)) setOv(sid, { start: mt[1] });
          if (me && toMin(me[1]) !== toMin(s0.end)) setOv(sid, { end: me[1] });
          if (note) setOv(sid, { note });
        }
      }
    }
  }
  // 下段「送迎」欄(4名以上の便のタイトルと乗車者一覧)を先に読み、タイトル→利用者名のマップを作る
  const titleMap = {};
  for (let r3 = Math.max(gridEnd, 0); r3 < aoa.length; r3++) {
    for (let c3 = 0; c3 < (aoa[r3] || []).length; c3++) {
      const v3 = z((aoa[r3] || [])[c3]);
      if (!v3 || !/[迎送][①-⑳]/.test(v3)) continue;
      v3.split("\n").forEach((ln3) => {
        const mm3 = ln3.trim().match(/^(.{1,4}[迎送][①-⑳])\((\d{1,2}:\d{2})[^)]*\)\s*(.+)$/);
        if (mm3) titleMap[mm3[1]] = mm3[3].split("・").map((x) => x.trim()).filter(Boolean);
      });
    }
  }
  const runs = [], blocks = [], unmatched = new Set(), log = [];
  // ---- 特記事項(利用者)・連絡事項パネルの読み戻し ----
  // ■送迎なし(馬場(家族送り)等)・■利用時間変更・■リベルタ泊あり/なし は構造データに復元し、
  // それ以外の手入力行は特記事項テキストとして取り込む
  const extra = { noRide: {}, userTime: {}, libertaOn: {}, libertaOff: {}, userAbsent: {}, notes: "", contact: "", notesStaff: "" };
  const findPanel = (header) => {
    for (let r3 = Math.max(gridEnd, 0); r3 < aoa.length; r3++) {
      for (let c3 = 0; c3 < (aoa[r3] || []).length; c3++) {
        if (z((aoa[r3] || [])[c3]).trim() !== header) continue;
        for (let r4 = r3 + 1; r4 < Math.min(aoa.length, r3 + 12); r4++) {
          const v4 = (aoa[r4] || [])[c3];
          if (v4 != null && String(v4).trim()) return z(v4);
        }
      }
    }
    return "";
  };
  {
    const noteText = findPanel("特記事項(利用者)");
    if (noteText) {
      let sec = null, manual = false;
      const manualLines = [];
      for (const raw3 of noteText.split("\n")) {
        const ln3 = raw3.trim();
        if (!ln3) continue;
        if (/^─+$/.test(ln3)) break; // 区切り線以降は予定ブロック由来の自動行(グリッドから復元済み)
        if (ln3 === "■欠席") { sec = "absent"; manual = false; continue; }
        if (ln3 === "■利用時間変更") { sec = "time"; manual = false; continue; }
        if (ln3 === "■リベルタ泊あり(臨時)") { sec = "libOn"; manual = false; continue; }
        if (ln3 === "■リベルタ泊なし") { sec = "libOff"; manual = false; continue; }
        if (ln3 === "■送迎なし") { sec = "noRide"; manual = false; continue; }
        if (!manual && sec === "absent") {
          ln3.split(/[・、,]/).map((x) => x.trim()).filter(Boolean).forEach((nm4) => {
            const id4 = uByName[nm4] || uByName[stripParen(nm4)];
            if (id4) extra.userAbsent[id4] = true;
          });
          continue;
        }
        const m3 = !manual && sec ? ln3.match(/^(.+?)\((.+)\)$/) : null;
        const uid3 = m3 ? (uByName[m3[1].trim()] || uByName[stripParen(m3[1].trim())]) : null;
        if (m3 && uid3) {
          const body = m3[2].trim();
          if (sec === "time") {
            const mt = body.match(/迎\s*(\d{1,2}:\d{2})/), st = body.match(/送\s*(\d{1,2}:\d{2})/);
            if (mt || st) extra.userTime[uid3] = { ...(mt ? { meet: mt[1] } : {}), ...(st ? { send: st[1] } : {}) };
          } else if (sec === "libOn" || sec === "libOff") {
            const o = { ...(body.includes("朝") ? { am: true } : {}), ...(body.includes("夕") ? { pm: true } : {}) };
            if (o.am || o.pm) extra[sec === "libOn" ? "libertaOn" : "libertaOff"][uid3] = o;
          } else if (sec === "noRide") {
            // 「家族送り」=家族が施設へ送ってくる→迎えなし、「家族迎え」=家族が迎えに来る→送りなし。
            // 「迎えなし・迎え不要」等の打ち消し表記はその方向自体をなしにする。判別不能な理由は両方に設定
            const o = {};
            body.split("、").map((x) => x.trim()).filter(Boolean).forEach((p3) => {
              const hasMeet = /迎/.test(p3), hasSend = /送/.test(p3);
              const negated = /(なし|無し|不要)/.test(p3);
              if (hasSend && !hasMeet) { const k4 = negated ? "send" : "meet"; o[k4] = o[k4] || p3; }
              else if (hasMeet && !hasSend) { const k4 = negated ? "meet" : "send"; o[k4] = o[k4] || p3; }
              else { o.meet = o.meet || p3; o.send = o.send || p3; }
            });
            if (o.meet || o.send) extra.noRide[uid3] = o;
          }
        } else {
          // 名前(内容)形式でない行が出たら、以降は手入力の特記事項として扱う
          manual = true;
          manualLines.push(ln3);
        }
      }
      extra.notes = manualLines.join("\n");
    }
    const staffNoteText = findPanel("特記事項(職員)");
    if (staffNoteText) extra.notesStaff = staffNoteText.split("\n").map((x) => x.trim()).filter(Boolean).join("\n");
    const contactText = findPanel("連絡事項");
    if (contactText) {
      // 「〜 15:00〜」形式の行は予定ブロック由来(グリッドから復元済み)のため除外
      extra.contact = contactText.split("\n").map((x) => x.trim()).filter((x) => x && !/\d{1,2}:\d{2}〜$/.test(x)).join("\n");
    }
  }
  const seen = new Set();
  // 30分行はラベルが空のため、最初の時刻を基準に行位置から時刻を計算する
  const baseT = gridStart >= 0 ? toMin(String((aoa[gridStart] || [])[0] || "").trim()) : null;
  for (let r2 = gridStart; r2 >= 0 && r2 < gridEnd; r2++) {
    const labelT = String((aoa[r2] || [])[0] || "").trim();
    const rowTime = /^\d{1,2}:\d{2}$/.test(labelT) ? labelT : (baseT != null ? toStr(baseT + (r2 - gridStart) * 30) : null);
    if (!rowTime) continue;
    for (let c = 1; c < nameRow.length; c++) {
      const staffName = colStaff[c];
      if (!staffName) continue;
      const raw = (aoa[r2] || [])[c];
      if (raw == null || !String(raw).trim()) continue;
      const text = z(raw);
      const parts = text.split(/(?=【|\[|※)/).filter((x) => x.trim());
      for (const part of parts) {
        if (part.startsWith("※")) {
          const label = part.slice(1).trim();
          if (label) {
            const dk0 = staffName + "|" + rowTime + "|block|" + label;
            if (!seen.has(dk0)) {
              seen.add(dk0);
              blocks.push({ id: uid(), kind: "block", time: rowTime, staffId: sByName[staffName] || HOLD_ID, label, vehicleId: "", userIds: [] });
            }
          }
          continue;
        }
        const mHead = part.match(/^[【\[](.+?)[】\]]([\s\S]*)/);
        if (!mHead) {
          // 見出しなしのテキスト=その他の予定(1行ずつ別の予定として復元)
          part.split("\n").map((x) => x.trim()).filter(Boolean).forEach((raw2) => {
            const mt2 = raw2.match(/^(.*?)[\s\u3000]*(\d{1,2}:\d{2})[〜~]?$/);
            const label = mt2 ? mt2[1].trim() : raw2;
            const tm2 = mt2 ? mt2[2] : null;
            if (/便に同乗$/.test(label)) return; // 同乗表示は元の便から復元されるためスキップ
            const dk0 = staffName + "|" + rowTime + "|block|" + label;
            if (seen.has(dk0)) return;
            seen.add(dk0);
            blocks.push({ id: uid(), kind: "block", time: tm2 || rowTime, staffId: sByName[staffName] || HOLD_ID, label, vehicleId: "", userIds: [] });
          });
          continue;
        }
        const kindLabel = mHead[1];
        const rest = mHead[2];
        const dk = staffName + "|" + rowTime + "|" + part.trim();
        if (seen.has(dk)) continue;
        seen.add(dk);
        const tmm = String(rest).split("\n")[0].match(/(\d{1,2}:\d{2})/); // 1行目(見出し行)の時刻のみ採用
        const time = tmm ? tmm[1] : rowTime;
        const staffId = sByName[staffName] || HOLD_ID;
        if (!sByName[staffName]) unmatched.add(staffName);
        if (kindLabel === "ヘルプ" || kindLabel === "予定") {
          const lines = rest.split("\n").map((x) => x.trim()).filter(Boolean);
          let vehicleId = "", label = "";
          if (lines.length) {
            const first = lines[0].replace(/\d{1,2}:\d{2}/, "").trim();
            if (first === "自車") { vehicleId = staffId !== HOLD_ID ? "own:" + staffId : ""; label = (lines[1] || "").trim(); }
            else if (first && vByName[first]) { vehicleId = vByName[first]; label = (lines[1] || "").trim(); }
            else { label = (lines[1] || lines[0] || "").trim(); }
          }
          if (!label) label = lines[lines.length - 1] || "";
          let userIds = [];
          if (kindLabel === "ヘルプ") {
            if (label && !/(ヘルプ|入浴)$/.test(label)) label = label + "ヘルプ"; // 出力時に省いた「ヘルプ」を復元(入浴はそのまま)
            const mu = label.match(/^(.+?)ヘルプ$/);
            if (mu && uByName[mu[1].trim()]) userIds = [uByName[mu[1].trim()]];
          }
          blocks.push({ id: uid(), kind: kindLabel === "ヘルプ" ? "help" : "block", time, staffId, label, vehicleId, userIds });
        } else if (kindLabel === "自車") {
          runs.push({ id: uid(), kind: "own_move", time, staffId, vehicleId: staffId !== HOLD_ID ? "own:" + staffId : "", userIds: [], staffRiderIds: [], note: "" });
        } else {
          const mMode = kindLabel.match(/^(徒歩|訓練|移動)(迎|送)$/);
          const kind = mMode ? KMAP[mMode[2]] : KMAP[kindLabel];
          const mode = mMode ? ({ "徒歩": "walk", "訓練": "train", "移動": "move" })[mMode[1]] : undefined;
          if (!kind) continue;
          const lines = rest.split("\n").map((x) => x.trim()).filter(Boolean);
          let vehicleId = "", bodyLines = lines;
          if (lines.length) {
            const first = lines[0].replace(/\d{1,2}:\d{2}/, "").trim();
            if (first && vByName[first]) { vehicleId = vByName[first]; bodyLines = lines.slice(1); }
            else if (first === "") bodyLines = lines.slice(1);
            else if (first === "車未定") bodyLines = lines.slice(1);
          }
          const userIds = [], staffRiderIds = [];
          let note = "";
          for (const ln of bodyLines) {
            if (/^同乗?:/.test(ln)) {
              ln.replace(/^同乗?:/, "").split("・").map((x) => x.replace(/[◆★]/g, "").trim()).filter(Boolean).forEach((n) => {
                if (sByName[n]) staffRiderIds.push(sByName[n]); else unmatched.add(n);
              });
            } else if (titleMap[ln.trim()]) {
              // タイトル便(例:津田送①): 下段「送迎」欄の一覧から乗車者を復元
              titleMap[ln.trim()].forEach((n) => { const id2 = uByName[n] || uByName[stripParen(n)]; if (id2) userIds.push(id2); else unmatched.add(n); });
            } else {
              const cand = ln.split("・").map((x) => x.trim()).filter(Boolean);
              const uidOf = (x) => uByName[x] || uByName[stripParen(x)]; // 「森井(帰宅)」等の補足付きも照合
              const anyUser = cand.some((x) => uidOf(x));
              if (anyUser) {
                cand.forEach((x) => { const id2 = uidOf(x); if (id2) userIds.push(id2); else note = note ? note + " " + x : x; });
              } else {
                note = note ? note + " " + ln : ln;
              }
            }
          }
          runs.push({ id: uid(), kind, mode, time, staffId, vehicleId, userIds: [...new Set(userIds)], staffRiderIds: [...new Set(staffRiderIds)], note });
        }
      }
    }
  }
  // 訓練枠(「訓練」ヘッダーの下の行)
  const training = [];
  for (let r2 = gridEnd; r2 < aoa.length; r2++) {
    for (let c = 0; c < (aoa[r2] || []).length; c++) {
      if (String((aoa[r2] || [])[c] || "").trim() === "訓練") {
        for (let c2 = c; c2 < c + 8; c2++) {
          const t = (aoa[r2 + 1] || [])[c2];
          if (t && String(t).trim()) z(t).split("\n").map((x) => x.trim()).filter(Boolean).forEach((l) => training.push(l));
        }
      }
    }
  }
  const extraCnt = Object.keys(extra.noRide).length + Object.keys(extra.userTime).length + Object.keys(extra.libertaOn).length + Object.keys(extra.libertaOff).length;
  log.push(`アプリ出力形式として読み取り: 便${runs.length}件・予定${blocks.length}件・訓練${training.length}行`);
  if (extraCnt || extra.notes || extra.contact) {
    const dd = [];
    if (Object.keys(extra.noRide).length) dd.push(`送迎なし${Object.keys(extra.noRide).length}名`);
    if (Object.keys(extra.userTime).length) dd.push(`時間変更${Object.keys(extra.userTime).length}名`);
    if (Object.keys(extra.libertaOn).length) dd.push(`リベ泊あり${Object.keys(extra.libertaOn).length}名`);
    if (Object.keys(extra.libertaOff).length) dd.push(`リベ泊なし${Object.keys(extra.libertaOff).length}名`);
    if (extra.notes) dd.push(`特記${extra.notes.split("\n").length}行`);
    if (extra.contact) dd.push(`連絡${extra.contact.split("\n").length}行`);
    log.push(`特記事項欄も復元: ${dd.join("・")}`);
  }
  if (Object.keys(staffOvOut).length) log.push(`職員の当日情報も復元: ${Object.keys(staffOvOut).length}名(休み・休出・遅刻早退・当日部署)`);
  // 元ファイルの日付・曜日(A1「月日」の隣のセル。例: 2026-07-31(金))
  let srcDate = "", srcWd = null;
  {
    const cell = z((aoa[0] || [])[1] || "").trim();
    const md = cell.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (md) {
      srcDate = `${md[1]}-${String(md[2]).padStart(2, "0")}-${String(md[3]).padStart(2, "0")}`;
      const dt = new Date(Number(md[1]), Number(md[2]) - 1, Number(md[3]));
      if (!isNaN(dt.getTime())) srcWd = dt.getDay();
    }
    if (srcWd == null) {
      const mw = cell.match(/[((]([日月火水木金土])[))]/);
      if (mw) srcWd = "日月火水木金土".indexOf(mw[1]);
    }
    if (srcDate) log.push(`元ファイルの日付: ${srcDate}${srcWd != null ? "(" + DAYS[srcWd] + ")" : ""}`);
  }
  if (extra.notesStaff) log.push(`特記事項(職員)も復元: ${extra.notesStaff.split("\n").length}行`);
  return { runs, blocks, training: training.join("\n"), ...extra, staffOv: staffOvOut, unmatched: [...unmatched], log, srcDate, srcWd };
}

function importMondayGrid(aoa, master) {
  // このアプリが出力したExcel(A1=月日、5行目=氏名)は専用ロジックで読み戻す
  if (String((aoa[0] || [])[0] || "").trim() === "月日" && String((aoa[4] || [])[0] || "").trim() === "氏名") {
    return importAppExport(aoa, master);
  }
  const log = [];
  const unmatched = new Set();
  // インデックス
  const userIndex = {};
  master.users.forEach((u) => { userIndex[cleanName(u.name)] = u.id; });
  // 旧名・表記ゆれのエイリアス(古い送迎表の取り込み用)
  const USER_ALIASES = { "田中よ": "田中慶", "錦織里": "錦織り", "野津": "野津周", "竹田ま": "竹田真" };
  Object.entries(USER_ALIASES).forEach(([alias, real]) => {
    const u = master.users.find((x) => x.name === real);
    if (u) userIndex[cleanName(alias)] = u.id;
  });
  const staffByName = {};
  master.staff.forEach((s) => { staffByName[cleanName(s.name)] = s; });
  const vehByName = {};
  master.vehicles.forEach((v) => { vehByName[v.name] = v.id; });
  // 短縮車名(ピカ・ドナ等)でも照合できるように
  Object.entries(makeVehShortMap(master.vehicles)).forEach(([vid, short]) => {
    if (!vehByName[short]) vehByName[short] = vid;
  });

  // 職員列(5行目=index4 に名前) を検出
  const nameRow = aoa[4] || [];
  const staffCols = [];
  for (let c = 1; c < nameRow.length; c++) {
    const nm = cleanName(nameRow[c]);
    if (nm && staffByName[nm]) staffCols.push({ col: c, staff: staffByName[nm] });
  }
  // 列構造の自動判定:職員列の平均間隔が2に近ければ「2列/人」、1に近ければ「1列/人」
  let twoCol = false;
  if (staffCols.length >= 2) {
    const gaps = [];
    for (let i = 1; i < staffCols.length; i++) gaps.push(staffCols[i].col - staffCols[i - 1].col);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    twoCol = median >= 2;
  }
  log.push(`職員列 ${staffCols.length} 名を検出(${twoCol ? "2列/人・月曜型" : "1列/人・火金型"})`);

  // 各行の時刻(A列=index0, 7行目以降=index6〜)
  const rowTime = [];
  let last = 8 * 60;
  for (let r = 6; r < aoa.length; r++) {
    const a = aoa[r] ? aoa[r][0] : null;
    const tm = toMinLoose(a);
    if (tm != null) last = tm;
    // Excelのtimeは "8:00:00" 形式や小数の場合あり
    if (a != null && tm == null && typeof a === "number") {
      last = Math.round(a * 24 * 60);
    }
    rowTime[r] = last;
  }

  const runs = [];
  const blocks = [];

  // グリッド本体は 7行目(index6)〜30行目(index29)あたり
  const GRID_TOP = 6, GRID_BOT = Math.min(aoa.length, 30);
  for (const { col, staff } of staffCols) {
    let curRun = null; // 現在組み立て中の便
    for (let r = GRID_TOP; r < GRID_BOT; r++) {
      const left = aoa[r] ? aoa[r][col] : null;
      const right = twoCol ? (aoa[r] ? aoa[r][col + 1] : null) : null;
      const cell = left != null && String(left).trim() ? String(left).trim() : null;
      const rcell = right != null && String(right).trim() ? String(right).trim() : null;
      if (!cell && !rcell) continue;
      const t = rowTime[r] != null ? rowTime[r] : 8 * 60;

      const veh = cell && VEH_ALIAS[cell.replace(/[\s\u3000]/g, "")];
      if (veh) {
        // 新しい便の開始
        curRun = {
          id: uid(), kind: t < 12 * 60 ? "meet" : "send", time: fmtTime(t),
          staffId: staff.id, vehicleId: vehByName[veh] || "", userIds: [], staffRiderIds: [], note: "",
        };
        runs.push(curRun);
        continue;
      }
      if (cell && cell.endsWith("ヘルプ")) {
        blocks.push({ id: uid(), kind: "help", time: fmtTime(t), staffId: staff.id, label: cell });
        curRun = null;
        continue;
      }
      // 「◯◯起床」「◯◯受診」など利用者名+行為の接尾辞 → 予定ブロック(利用者は照合しておく)
      const suffixWord = ["起床", "受診", "入浴", "介助", "対応"].find((w) => cell && cell.endsWith(w) && cell.length > w.length);
      if (suffixWord) {
        blocks.push({ id: uid(), kind: "block", time: fmtTime(t), staffId: staff.id, label: cell });
        continue;
      }
      // Excelの時刻シリアル(小数)や時間文字列("16:00～19:00")は無視
      if (cell && (/^\d*\.\d+$/.test(cell) || /\d{1,2}[:：]\d{2}\s*[~～\-]/.test(cell))) continue;
      if (cell && BLOCK_WORDS.some((w) => cell === w || cell.includes(w))) {
        blocks.push({ id: uid(), kind: "block", time: fmtTime(t), staffId: staff.id, label: cell });
        curRun = null;
        continue;
      }
      // 括弧内が職員名なら同乗として直近の便へ
      const riderIds = [
        ...matchRiders(cell || "", staffByName),
        ...matchRiders(rcell || "", staffByName),
      ];
      if (riderIds.length && curRun) {
        riderIds.forEach((id) => { if (id !== curRun.staffId && !curRun.staffRiderIds.includes(id)) curRun.staffRiderIds.push(id); });
        // 括弧のみのセル(利用者名なし)はここで終了
        const bareNoParen = stripParen(cell || rcell || "");
        if (!cleanName(bareNoParen)) continue;
      }
      // 「◯◯便」など他人の便名・地名は無視(ただし利用者名照合は試す)
      const bare = cell || rcell;
      if (!bare) continue;
      if (IGNORE_WORDS.some((w) => bare.includes(w)) && !userIndex[cleanName(stripParen(bare))]) {
        if (curRun && !VEH_ALIAS[bare]) curRun.note = (curRun.note ? curRun.note + " " : "") + bare;
        continue;
      }
      // 利用者名として照合(左・右両方)
      const ids = [
        ...matchUsers(cell || "", userIndex, null, unmatched),
        ...matchUsers(rcell || "", userIndex, null, unmatched),
      ];
      if (ids.length) {
        if (curRun) {
          ids.forEach((id) => { if (!curRun.userIds.includes(id)) curRun.userIds.push(id); });
        } else {
          // 便がまだ無い→時刻だけの利用者。仮の便(車未定)を作る
          curRun = {
            id: uid(), kind: t < 12 * 60 ? "meet" : "send", time: fmtTime(t),
            staffId: staff.id, vehicleId: "", userIds: [...ids], staffRiderIds: [], note: "",
          };
          runs.push(curRun);
        }
      }
    }
  }

  // 利用者も車両もない空便は捨てる
  const cleanRuns = runs.filter((r) => r.userIds.length > 0 || r.vehicleId);
  log.push(`便 ${cleanRuns.length} 件、予定ブロック ${blocks.length} 件を作成`);
  if (unmatched.size) log.push(`未照合の名前 ${unmatched.size} 件: ${[...unmatched].slice(0, 20).join("・")}`);

  return { runs: cleanRuns, blocks, unmatched: [...unmatched], log };
}


// ---------- 警告判定 ----------
// 週間パターン(いつもの形)での担当を引く。当日の表と見比べて「担当がいつもと違う」警告に使う
const _patStaffCache = new WeakMap();
function patternStaffAt(master, wd, run) {
  if (!master || wd == null || !run || !run.time) return null;
  const key = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][wd];
  const sp = SEED_PATTERNS[key];
  if (!sp) return null;
  let byWd = _patStaffCache.get(master);
  if (!byWd) { byWd = {}; _patStaffCache.set(master, byWd); }
  if (!byWd[wd]) {
    const sByName = {}; master.staff.forEach((s) => { sByName[s.name] = s.id; });
    const vByName = {}; master.vehicles.forEach((v) => { vByName[v.name] = v.id; });
    const vShort = makeVehShortMap(master.vehicles);
    master.vehicles.forEach((v) => { if (vShort[v.id] && !vByName[vShort[v.id]]) vByName[vShort[v.id]] = v.id; });
    const exact = {}, byTime = {};
    (sp.runs || []).forEach((r) => {
      const sid = sByName[r.staffName];
      if (!sid) return;
      const vid = vByName[r.vehName] || "";
      const k1 = `${r.kind}|${r.time}|${vid}`;
      exact[k1] = exact[k1] === undefined ? sid : "__multi__"; // 車なしの便などキーが重なる場合は特定しない
      const k2 = `${r.kind}|${r.time}`;
      byTime[k2] = byTime[k2] === undefined ? sid : "__multi__"; // 同時刻に複数便あるときは特定しない
    });
    byWd[wd] = { exact, byTime };
  }
  const { exact, byTime } = byWd[wd];
  const hit = exact[`${run.kind}|${run.time}|${run.vehicleId || ""}`];
  if (hit) return hit === "__multi__" ? null : hit;
  const t2 = byTime[`${run.kind}|${run.time}`];
  return t2 && t2 !== "__multi__" ? t2 : null;
}

function runWarnings(run, master, data, wd) {
  const w = [];
  const t = toMin(run.time);
  const ovAll = data.staffOv || {};
  const stf = master.staff.find((s) => s.id === run.staffId);
  const veh = resolveVehicle(master, run.vehicleId);
  const usersSel = run.userIds.map((id) => master.users.find((u) => u.id === id)).filter(Boolean);
  const riders = (run.staffRiderIds || []).map((id) => master.staff.find((s) => s.id === id)).filter(Boolean);
  const wcCount = usersSel.filter((u) => u.wheelchair).length;
  // 職員の時間重複: 所要時間(durMin、未設定は30分)ベースで判定
  const busyAt = (sid) => {
    if (t == null) return false;
    const durMe = Number(run.durMin) || SLOT;
    const hit = (x) => {
      const t2 = toMin(x.time);
      if (t2 == null) return false;
      const d2 = overlapDurMin(x);
      return t2 < t + durMe && t < t2 + d2;
    };
    return data.runs.some((r) => r.id !== run.id && (r.staffId === sid || (r.staffRiderIds || []).includes(sid)) && hit(r)) ||
      data.blocks.some((b) => b.id !== run.id && b.staffId === sid && !/施錠/.test(b.label || "") && hit(b));
  };
  // 同じ利用者が同じ種別の別の便にも乗っていないか(時間帯に関係なくすべて警告)
  // ※種別は移動手段込みで判定: 通常の迎えと「訓練迎」は別種なので、訓練帰りの再迎えは訓練迎で登録すれば警告は出ない
  if (run.kind === "meet" || run.kind === "send") {
    // その便の中での実効モード: 訓練フラグ(trainUserIds)の人は mode:"train" と同じ扱い
    const effMode = (r, id) => ((r.trainUserIds || []).includes(id) ? "train" : (r.mode || ""));
    (run.userIds || []).forEach((id) => {
      const dup = data.runs.some((r) => r.id !== run.id && r.kind === run.kind && effMode(r, id) === effMode(run, id) && (r.userIds || []).includes(id));
      if (dup) {
        const u = master.users.find((x) => x.id === id);
        const MODE_JP = { walk: "徒歩", train: "訓練", move: "移動" };
        if (u) w.push(`${u.name}の${MODE_JP[run.mode] || ""}${run.kind === "meet" ? "迎え" : "送り"}が重複`);
      }
    });
  }
  // 利用曜日でない利用者が乗っていないか
  if (wd != null) {
    (run.userIds || []).forEach((id) => {
      const u = master.users.find((x) => x.id === id);
      if (u && !(u.days || []).includes(wd)) w.push(`${u.name}は${DAYS[wd]}曜の利用日ではない`);
    });
  }
  // 登録済みの迎え/送り時刻と大幅にズレていないか(TIME_GAP_WARN_MIN分以上)
  // ※訓練・徒歩・移動便は対象外。リベルタから乗る(朝)/リベルタへ帰る(夕)日はその方向の個別時刻を適用しない
  if ((run.kind === "meet" || run.kind === "send") && !run.mode && t != null && wd != null) {
    const { isLibOn } = makeLibNameHelpers(data, wd);
    (run.userIds || []).forEach((id) => {
      const u = master.users.find((x) => x.id === id);
      if (!u) return;
      if ((u.libertaAM || u.libertaPM) && isLibOn(u, run.kind)) return;
      const want = userTimeOf(u, wd, data.userTime)[run.kind];
      const wm = toMin(want);
      if (wm != null && Math.abs(wm - t) >= TIME_GAP_WARN_MIN) {
        if ((run.trainUserIds || []).includes(u.id) || (run.trainBothIds || []).includes(u.id)) return; // 訓練の迎え/送りは自宅の希望時刻の対象外
        w.push(`${u.name}の希望${run.kind === "meet" ? "迎え" : "送り"}(${want})と${Math.abs(wm - t)}分ズレ`);
      }
    });
  }
  // 公用車の二重使用・不在チェック(所要時間ベース)
  if (run.vehicleId && !String(run.vehicleId).startsWith("own:") && t != null && veh) {
    const dur = Number(run.durMin) || SLOT;
    const others = [
      ...(data.runs || []).filter((r2) => r2.id !== run.id && r2.vehicleId === run.vehicleId),
      ...(data.blocks || []).filter((b2) => b2.id !== run.id && b2.vehicleId === run.vehicleId),
    ].filter((x) => {
      const t2 = toMin(x.time);
      if (t2 == null) return false;
      const d2 = helpDurMin(x);
      return t2 < t + dur && t < t2 + d2;
    });
    if (others.length) w.push(`${veh.name}は${others.map((x) => x.time).join("・")}の別の予定と重なる(この時間この車は使えない)`);
    const isTrainRun = run.mode === "train" || (run.trainUserIds || []).length > 0 || (run.trainBothIds || []).length > 0 || (run.trainDropIds || []).length > 0; // 訓練の人は活動車が途中で拾ってよい
    if (!isTrainRun && ACTIVITY_VEHICLES[veh.name] && inActivityWindow(t, t + dur)) {
      w.push(`活動時間(10:30〜12:00・13:30〜15:00)は${veh.name}が${ACTIVITY_VEHICLES[veh.name]}の生活介護で使用中`);
    }
    else if (run.kind !== "meet") {
      // この予定がその車の最後の予定なら、1日の最終帰着地(基地)に戻るかを確認
      const tripsV = buildVehicleTrips(data)[run.vehicleId] || [];
      const myTrip = tripsV.find((e) => e.id === run.id);
      if (myTrip && !tripsV.some((e) => e.id !== run.id && e.end > myTrip.end)) {
        const lastSendT2 = tripsV.filter((e) => e.kind === "send").reduce((a, e) => Math.max(a, e.t), -1);
        const home2 = vehicleHomeOf(master, veh);
        let fin2 = home2;
        [...tripsV].sort((a, b) => a.end - b.end).forEach((e) => { fin2 = vehicleAfterPos(master, veh, e, fin2, lastSendT2); });
        if (fin2 && fin2 !== home2) {
          const dn2 = (id) => { const d = master.departments.find((x) => x.id === id); return d ? d.name : "?"; };
          w.push(`この予定の後、${veh.name}が基地(${dn2(home2)})に戻りません(最終位置:${dn2(fin2)})`);
        }
      }
      // 出発時にこの部署へ車が居るか(朝の迎えは全車共通スタートのため対象外)
      const { pos } = vehiclePosBefore(master, data, run.vehicleId, t);
      const expDept = stf ? belongDeptOf(master, stf, wd) : "";
      // ピカ・セレナは日中(13時頃)に嫁島⇔津田で入れ替える運用のため、13時以降は出発地チェックの対象外
      const swapCar = (veh.name === "ピカチュウ" || veh.name === "セレナ") && t >= 13 * 60;
      // 通勤ルール: 自車通勤者とリベ職員以外は嫁島出勤なので、朝(10時前)に嫁島の車で出るのは正常
      const libD0 = master.departments.find((x) => /リベルタ/.test(x.name));
      const yokaId0 = (master.departments.find((x) => x.name.startsWith("嫁島")) || {}).id;
      const commuteFromYoka = stf && !stf.hasOwnCar && !(libD0 && stf.deptId === libD0.id) && t < 10 * 60 && pos === yokaId0;
      if (!swapCar && !commuteFromYoka && pos && expDept && pos !== expDept) {
        const dn = (id) => { const d = master.departments.find((x) => x.id === id); return d ? d.name : "?"; };
        w.push(`出発時、${veh.name}は${dn(pos)}に居る想定(この予定は${dn(expDept)}発)。前の便の行先を変えるか車を替えてください`);
      }
    }
  }
  if (stf) {
    if (run.mode !== "walk" && !stf.canDrive && !(veh && veh.ownerOnly)) w.push("運転不可の職員");
    const ov = ovAll[stf.id] || {};
    if (ov.off) w.push("休みの職員");
    if (wd != null && (stf.offDays || []).includes(wd) && !ov.workToday) w.push("固定休の職員");
    const eff0 = staffTimeOf(stf, wd, ov);
    const st = toMin(eff0.start), en = toMin(eff0.end);
    {
      const aw0 = toMin(stf.awayFrom), aw1 = toMin(stf.awayTo);
      if (aw0 != null && aw1 != null && t != null && t >= aw0 && t < aw1) w.push("不在の時間帯(中抜け)");
    }
    if (t != null && st != null && en != null && !stf.noTimeWarn) {
      // 8時出勤は無く、始業前は早出残業の扱い。終業後は残業。大きく外れる場合のみ「勤務時間外」
      if (t < st) w.push(t >= st - 60 ? `早出残業(${toStr(t)}〜・始業${toStr(st)})` : "勤務時間外");
      else if (t + SLOT > en) w.push(t < en + 60 ? `残業(〜${toStr(t + SLOT)}・終業${toStr(en)})` : "勤務時間外");
    }
    if (busyAt(stf.id)) w.push("職員の時間重複");
    if (stf.helpOnly && (run.kind === "meet" || run.kind === "send")) w.push(`🚫エラー: ${stf.name}は送迎に入れられません(ヘルプ専任)。別の職員に変更してください`);
    if (run.mode === "walk") {
      const wu = (run.userIds || []).map((id) => master.users.find((x) => x.id === id)).find(Boolean);
      if (wu && belongDeptOf(master, stf, wd) !== wu.deptId) w.push(`徒歩送迎は${(master.departments.find((d) => d.id === wu.deptId) || {}).name || "同じ部署"}の職員が担当してください(他部署の職員は直帰できません)`);
    }
  } else if (run.staffId !== REQ_ID) {
    w.push("担当未定(保留)");
  }
  if (veh && !veh.ownerOnly) {
    if (veh.own && stf && veh.ownerId !== stf.id) w.push("自車の持ち主と運転者が違う");
    if (wcCount > 0 && !veh.wheelchairOK) w.push("車いす非対応の車");
    const cap = wcCount > 0 ? veh.capWc : veh.capNormal;
    const total = usersSel.length + riders.length + 1; // 運転手を含めた乗車人数
    if (total > cap) w.push(`定員超過(運転手込み ${total}/${cap})`);
    // リベルタ職員の時間帯ルール(明らかな違反のみ警告。9:30便など「10時ごろ」の範囲は許容)
    if (stf) {
      const libDept1 = master.departments.find((d2) => /リベルタ/.test(d2.name));
      if (libDept1 && stf.deptId === libDept1.id && t != null) {
        const eff1 = staffTimeOf(stf, wd, ovAll);
        const st1 = toMin(eff1.start), en1 = toMin(eff1.end);
        if (st1 != null && st1 < 9 * 60 && t < 9 * 60) w.push("リベルタの早番職員は基本10時ごろから各事業所へ(9時前の便は不可)");
        if (en1 != null && en1 > 19 * 60 && t >= 15 * 60 + 30) w.push("リベルタの遅番職員は15:30頃にはリベルタへ(以降の便は担当不可)");
      }
    }
    // 同乗NG(相性)チェック
    (run.userIds || []).forEach((id1) => {
      const ngIds = ngPartnersOf(master, id1);
      const hit = (run.userIds || []).find((id2) => id2 !== id1 && ngIds.includes(id2));
      if (hit) {
        const n1 = (master.users.find((u) => u.id === id1) || {}).name;
        const n2 = (master.users.find((u) => u.id === hit) || {}).name;
        const key = [n1, n2].sort().join("と");
        if (!w.some((x) => x.includes(key))) w.push(`${key}は同乗NG(相性)`);
      }
    });
    // 利用者ごとの基本の車(勝部・ホン=ピカなど)
    if (veh && !veh.own && !run.mode) {
      (rulesOf(master).userVeh || []).forEach((row) => {
        if (!row || !row.user || !row.veh) return;
        if (!usersSel.some((u) => u.name === row.user)) return;
        if (veh.name === row.veh) return;
        const key2 = `${row.user}は基本${row.veh}`;
        if (!w.some((x) => x.includes(key2))) w.push(`${key2}の便です(現在: ${veh.name})`);
      });
    }
  }
  riders.forEach((rs) => {
    const o = ovAll[rs.id] || {};
    if (rs.id === run.staffId) w.push(`${rs.name}が運転者と同乗の両方`);
    if (o.off) w.push(`同乗:${rs.name}は休み`);
    if (wd != null && (rs.offDays || []).includes(wd) && !o.workToday) w.push(`同乗:${rs.name}は固定休`);
    if (busyAt(rs.id)) w.push(`同乗:${rs.name}の時間重複`);
  });
  if (data.userAbsent && usersSel.some((u) => data.userAbsent[u.id])) w.push("欠席者を含む");
  // 利用者ごとの「朝の迎えの固定担当」(曜日別)。ここに無い人は週間パターンとの照合だけで判定する
  if (stf && (run.kind === "meet" || run.kind === "send") && !run.mode && wd != null) {
    usersSel.forEach((u) => {
      const row = (rulesOf(master).fixedRun || []).find((x) => x && x.user === u.name && x.kind === run.kind && (x.days || []).includes(wd));
      const expName = row && row.staff;
      if (!expName || expName === stf.name) return;
      const ex = master.staff.find((s) => s.name === expName);
      if (!ex) return;
      const o2 = ovAll[ex.id] || {};
      const off2 = o2.off === true || !!ex.retireDate || ((ex.offDays || []).includes(wd) && !o2.workToday);
      if (!off2) w.push(`${u.name}の${run.kind === "meet" ? "迎え" : "送り"}の担当はいつも${expName}です(現在: ${stf.name})`);
    });
  }
  // ※ 週間パターンとの自動照合による「担当がいつもと違う」警告は廃止。
  //   こちらで推測した割り当てまで警告になってしまうため、明示的に決まっている担当
  //   (朝のピカ便・12:00の透析・田中慶/田中かの迎え・成相の送り)だけをエラー判定の対象にする。
  if (t != null && run.vehicleId) {
    const dupVeh = data.runs.some((r) => r.id !== run.id && r.vehicleId === run.vehicleId && Math.abs(toMin(r.time) - t) < SLOT);
    if (dupVeh) w.push("車両の時間重複");
  }
  return w;
}

// ---------- 自動提案 ----------
function computeSuggestion({ deptId, time, userIds, includeOtherDept, master, data, weekday }) {
  const t = toMin(time);
  const selUsers = userIds.map((id) => master.users.find((u) => u.id === id)).filter(Boolean);
  const n = selUsers.length;
  const wc = selUsers.filter((u) => u.wheelchair).length;

  const vehBusy = (vid) => t != null && data.runs.some((r) => r.vehicleId === vid && Math.abs(toMin(r.time) - t) < SLOT);
  const ownAvailable = (s) => {
    const ov = (data.staffOv || {})[s.id] || {};
    if (ov.off) return false;
    if (weekday != null && (s.offDays || []).includes(weekday) && !ov.workToday) return false;
    return true;
  };
  const ownCars = master.staff.filter((s) => s.hasOwnCar && ownAvailable(s)).map((s) => resolveVehicle(master, "own:" + s.id));

  const vehicles = [...master.vehicles, ...ownCars]
    .filter((v) => includeOtherDept || v.deptId === deptId)
    .map((v) => {
      const cap = wc > 0 ? (v.wheelchairOK ? v.capWc : 0) : v.capNormal;
      return { v, cap, busy: vehBusy(v.id), ok: cap >= n + 1 && n > 0 }; // 運転手ぶんの席も確保
    })
    .filter((x) => x.ok)
    .sort((a, b) => {
      const ad = a.v.deptId === deptId ? 0 : 1, bd = b.v.deptId === deptId ? 0 : 1;
      if (ad !== bd) return ad - bd;
      if (!!a.v.own !== !!b.v.own) return a.v.own ? 1 : -1; // 公用車を優先
      if (a.busy !== b.busy) return a.busy ? 1 : -1;
      return (a.cap - n) - (b.cap - n);
    });

  const drivers = master.staff
    .filter((s) => {
      if (!s.canDrive) return false;
      const ov = (data.staffOv || {})[s.id] || {};
      if (ov.off) return false;
      if (weekday != null && (s.offDays || []).includes(weekday) && !ov.workToday) return false;
      const eff0 = staffTimeOf(s, weekday, ov);
      const st = toMin(eff0.start), en = toMin(eff0.end);
      const aw0 = toMin(s.awayFrom), aw1 = toMin(s.awayTo);
      if (aw0 != null && aw1 != null && t != null && t >= aw0 && t < aw1) return false;
      if (t != null && st != null && en != null && (t < st || t + SLOT > en)) return false;
      return true;
    })
    .map((s) => {
      const busy =
        t != null &&
        (data.runs.some((r) => (r.staffId === s.id || (r.staffRiderIds || []).includes(s.id)) && Math.abs(toMin(r.time) - t) < SLOT) ||
          data.blocks.some((b) => b.staffId === s.id && Math.abs(toMin(b.time) - t) < SLOT));
      return { s, busy };
    })
    .filter((x) => !x.busy)
    .sort((a, b) => {
      const ad = a.s.deptId === deptId ? 0 : 1, bd = b.s.deptId === deptId ? 0 : 1;
      return ad - bd;
    });

  return { vehicles: vehicles.slice(0, 6), drivers: drivers.slice(0, 10), n, wc };
}

/* ============================================================
   Excel出力(A4横・1ページに収める・セル内改行)
   ============================================================ */
// 自宅迎え/自宅送りの表記を個別に変えたい利用者(既定は迎え・送りとも(自宅))
const HOME_LABEL_OVERRIDE = { "森井": { meet: "温泉駅", send: "温泉駅" } };

// ---------- リベルタ利用の当日判定と補足付き氏名(Excel出力共通) ----------
// 便の中で「訓練迎え/訓練送り」の人に付ける表記((訓迎)/(訓送))。通常便に訓練の人を混載できる
// trainUserIds = 訓練の迎え/送り(通常の送迎とは別枠。通常の迎え/送りは未割り当てのまま残る)
// trainBothIds = 訓練の迎え/送りが通常の迎え/送りを兼ねる人(その日の迎え/送りとして数える)
// trainDropIds = 自宅で拾ってそのまま訓練先へ送る人(その日の「迎え」として数える。訓練送りの便を別に作らなくてよい)
// この便がその利用者の通常の迎え/送りとして数えられるか。数えるなら "meet"/"send"、数えないなら null
function rideKindOf(r, id) {
  if (!r) return null;
  if ((r.trainEndIds || []).includes(id)) return "both"; // 自宅→訓練先で1日終了(帰りは家族など): 迎え・送りの両方に数える
  if ((r.trainDropIds || []).includes(id)) return "meet"; // 自宅→訓練先: 便の種別によらず迎え扱い
  if ((r.trainBothIds || []).includes(id)) return r.kind === "send" ? "send" : "meet"; // 訓練が通常の迎え/送りを兼ねる
  if (r.mode === "move") return null; // 部署間移動は通常の迎え/送りに数えない(移動しても迎え・送りは別に必要)
  if (r.mode === "train" || (r.trainUserIds || []).includes(id)) return null; // 別枠の訓練
  return r.kind === "meet" || r.kind === "send" ? r.kind : null;
}
function countsAsRide(r, id) { return !!rideKindOf(r, id); }
// 便の判定結果(meet/send/both)がその種別に当てはまるか
function rideIs(k, kind) { return !!k && (k === kind || k === "both"); }
// AI調整が返すメモのうち、便の意味に関わるものだけ残す(調整理由のメモは表に載せない)
const AI_NOTE_KEEP = /(リベ迎|リベ送|あい迎|あい送|移動|回送|訓練|同乗)/;
const keepAiNote = (n) => { const s = String(n || "").trim(); return s && AI_NOTE_KEEP.test(s) ? s : ""; };

const trainSfx = (it, u, kind) => {
  if (!it) return "";
  if ((it.trainEndIds || []).includes(u.id)) return "迎(訓送)終"; // 自宅→訓練先で1日終了(送りも不要)
  if ((it.trainDropIds || []).includes(u.id)) return "迎(訓送)"; // 自宅→そのまま訓練先へ
  if ((it.trainBothIds || []).includes(u.id)) return kind === "meet" ? "迎(訓練)" : kind === "send" ? "送(訓練)" : "(訓練)";
  return (it.trainUserIds || []).includes(u.id) ? (kind === "meet" ? "(訓迎)" : kind === "send" ? "(訓送)" : "(訓)") : "";
};
// 朝リベルタなし=自宅から迎え、夕リベルタなし=自宅へ送り→便の名前に「(自宅)」を付ける
// 利用者の「いつもの迎え先・送り先」(未設定は自宅)
// 行き先の表記ゆれをそろえる(リベルタ・リベ・ﾘﾍﾞﾙﾀ → ﾘﾍﾞ)
function normPlace(v) {
  const t = String(v || "").trim();
  return /^(リベルタ|リベ|ﾘﾍﾞﾙﾀ|ﾘﾍﾞ)$/.test(t) ? "ﾘﾍﾞ" : t;
}

// 家族が連れてくる・迎えに来る(=送迎なし)の行き先か
function isFamilyPlace(v) {
  return /^(家族|母|父)/.test(String(v || "").trim());
}

// 以前からある「基本の送迎なし」(曜日指定つき)。曜日が分からないときは、曜日指定のあるものは使わない
function noRideBaseOf(u, kind2, wd) {
  const d = u && u.noRideDefault;
  if (!d || !d[kind2]) return "";
  const days = d[kind2 + "Days"];
  if (days && !(wd != null && days.includes(wd))) return "";
  return String(d[kind2]);
}

// いつもが「送迎なし(家族送り・家族迎えなど)」ならその文言、ふつうに送迎するなら ""
function familyDefaultOf(u, kind2, wd) {
  if (!u) return "";
  const v = normPlace(kind2 === "send" ? u.sendPlace : u.meetPlace);
  if (v) return isFamilyPlace(v) ? v : ""; // 利用者タブで書いた値が最優先
  return noRideBaseOf(u, kind2, wd);
}

function defPlaceOf(u, kind2, wd) {
  if (!u) return "自宅";
  const v = normPlace(kind2 === "send" ? u.sendPlace : u.meetPlace);
  if (v) return v;
  const nr = noRideBaseOf(u, kind2, wd);
  if (nr) return nr;
  // リベルタ利用の人は、空欄ならリベルタ(その曜日がリベルタ休み=自宅スタート/自宅帰りなら自宅)
  const lib = kind2 === "send" ? u.libertaPM : u.libertaAM;
  if (lib) {
    const off = (kind2 === "send" ? u.libertaPMOffDays : u.libertaAMOffDays) || [];
    return wd != null && off.includes(wd) ? "自宅" : "ﾘﾍﾞ";
  }
  return "自宅";
}

// 行き先の入力候補: 自宅・リベルタ + 利用者タブで登録済みの行き先
// kind2="meet"なら家族送り、"send"なら家族迎えも候補に入れる。指定なし(便の行き先変更)は家族系を出さない
function placeOptionsOf(master, kind2) {
  const set = new Set(["自宅", "ﾘﾍﾞ"]);
  if (kind2 === "meet") set.add("家族送り");
  if (kind2 === "send") set.add("家族迎え");
  (master.users || []).forEach((u) => {
    [u.meetPlace, u.sendPlace].forEach((v) => {
      const t = normPlace(v);
      if (t && (kind2 || !isFamilyPlace(t))) set.add(t);
    });
  });
  return [...set];
}

// その便で「いつもと違う行き先」になっている人を拾う(便に乗っている人だけ)
function placeChangesOf(run) {
  const p = run && run.places;
  if (!p) return [];
  return (run.userIds || [])
    .map((id) => ({ id, place: normPlace(p[id]) }))
    .filter((x) => x.place);
}

function makeLibNameHelpers(sheet, wd) {
  const libOffMap = sheet.libertaOff || {};
  const libOnMap = sheet.libertaOn || {}; // 基本は泊なしの日に「今日だけ泊まる」上書き
  const isLibOn = (u, kind2) => {
    const ap = kind2 === "meet" ? "am" : "pm";
    const base = kind2 === "meet"
      ? !!u.libertaAM && !(u.libertaAMOffDays || []).includes(wd)
      : !!u.libertaPM && !(u.libertaPMOffDays || []).includes(wd);
    if ((libOnMap[u.id] || {})[ap]) return true;
    return base && !(libOffMap[u.id] || {})[ap];
  };
  const nameHome = (u, kind2, run) => {
    // その日だけ行き先を変えた人は、名前のうしろに(変更先)を出す
    const pov = run && run.places ? normPlace((run.places || {})[u.id]) : "";
    if (pov) return u.name + `(${pov})`;
    const ov2 = HOME_LABEL_OVERRIDE[u.name] || {};
    if (kind2 === "send" && u.libertaPM && !isLibOn(u, "send")) return u.name + `(${ov2.send || "自宅"})`;
    if (kind2 === "meet" && u.libertaAM && !isLibOn(u, "meet")) return u.name + `(${ov2.meet || "自宅"})`;
    return u.name;
  };
  return { isLibOn, nameHome };
}

function buildExcelHtml(master, sheet, date) {
  const BR = '<br style="mso-data-placement:same-cell">';
  const wd = weekdayOf(date);
  const { nameHome } = makeLibNameHelpers(sheet, wd); // 「(自宅)」「(帰宅)」の補足付き氏名
  const deptIndex = (id) => master.departments.findIndex((d) => d.id === id);
  const deptName = (id) => { const d = master.departments[deptIndex(id)]; return d ? d.name : ""; };
  const hexOf = (id) => DEPT_COLORS[Math.max(0, deptIndex(id)) % DEPT_COLORS.length].hex;
  const ov = sheet.staffOv || {};
  const absent = sheet.userAbsent || {};

  // 列:出勤職員(部署順) → 休み職員 → 保留(あれば)
  const byDept = [...master.staff].sort((a, b) => staffColKey(master, a, wd) - staffColKey(master, b, wd));
  const actives = byDept.filter((s) => !(ov[s.id] && ov[s.id].off));
  const offs = byDept.filter((s) => ov[s.id] && ov[s.id].off);
  const known = new Set(master.staff.map((s) => s.id));
  const holdItems = [
    ...sheet.runs.filter((r) => r.staffId === HOLD_ID || !known.has(r.staffId)),
    ...sheet.blocks.filter((b) => b.staffId === HOLD_ID || !known.has(b.staffId)),
  ];
  const cols = [...actives, ...offs];
  const totalCols = 1 + cols.length + (holdItems.length ? 1 : 0);

  // セル内容
  const itemText = (it, isRun) => {
    if (isRun) {
      const veh = master.vehicles.find((v) => v.id === it.vehicleId);
      const names = it.userIds.map((id) => { const u = master.users.find((x) => x.id === id); return u ? nameHome(u, it.kind, it) + trainSfx(it, u, it.kind) : ""; }).filter(Boolean);
      const MODE_LABEL2 = { walk: "徒歩", train: "訓練", move: "移動" };
      let s = it.kind === "own_move" ? `【自車】${esc(it.time)}`
        : it.mode === "walk" ? `【徒歩${RUN_KINDS[it.kind] || "送"}】${esc(it.time)}`
        : it.mode ? `【${MODE_LABEL2[it.mode] || ""}${RUN_KINDS[it.kind] || "送"}】${veh ? esc(veh.name) + " " : ""}${esc(it.time)}`
        : `【${RUN_KINDS[it.kind] || "送"}】${veh ? esc(veh.name) : "車未定"} ${esc(it.time)}`;
      if (names.length) s += BR + esc(names.join("・"));
      if (it.note) s += BR + esc(it.note);
      return s;
    }
    return `【${it.kind === "help" ? "ヘルプ" : "予定"}】${esc(it.time)}${BR}${esc(it.label)}${it.note ? esc(`(${it.note})`) : ""}`;
  };
  const colKey = (sid) => (sid === HOLD_ID || !known.has(sid) ? HOLD_ID : sid);
  const cellMap = {};
  const putIt = (sid, time, txt) => {
    const t = toMin(time);
    if (t == null) return;
    const slot = Math.max(GRID_START, Math.min(GRID_END - SLOT, Math.floor(t / SLOT) * SLOT));
    const k = `${colKey(sid)}:${slot}`;
    (cellMap[k] = cellMap[k] || []).push(txt);
  };
  sheet.runs.forEach((r) => putIt(r.staffId, r.time, itemText(r, true)));
  sheet.blocks.forEach((b) => putIt(b.staffId, b.time, itemText(b, false)));

  const usedSlots = [];
  for (let m = GRID_START; m < GRID_END; m += SLOT) {
    const has = cols.some((s) => cellMap[`${s.id}:${m}`]) || cellMap[`${HOLD_ID}:${m}`];
    if (has) usedSlots.push(m);
  }

  let rows = "";
  // タイトル行
  rows += `<tr><td colspan="${totalCols}" style="border:none;font-size:12pt;font-weight:bold">送迎表　${esc(date)}(${DAYS[wd]})　<span style="font-size:9pt;font-weight:normal;color:#78716c">${esc(appVerLabel())}</span></td></tr>`;
  // 部署行
  rows += `<tr><td class="h">部署</td>`;
  cols.forEach((s) => { rows += `<td class="h" style="background:${hexOf(s.deptId)}">${esc(deptName(s.deptId))}</td>`; });
  if (holdItems.length) rows += `<td class="h" style="background:#f5f5f4">保留</td>`;
  rows += `</tr>`;
  // 形態・職位行
  rows += `<tr><td class="h">形態・職位</td>`;
  cols.forEach((s) => { rows += `<td class="s">${esc(s.emp)}${s.position ? BR + esc(s.position) : ""}</td>`; });
  if (holdItems.length) rows += `<td class="s">担当未定</td>`;
  rows += `</tr>`;
  // 氏名行
  rows += `<tr><td class="h">氏名</td>`;
  cols.forEach((s) => {
    const o = ov[s.id] || {};
    rows += `<td class="h" style="${o.off ? "background:#e7e5e4;color:#78716c" : ""}">${esc(s.name)}${o.off ? "(休)" : ""}</td>`;
  });
  if (holdItems.length) rows += `<td class="h">―</td>`;
  rows += `</tr>`;
  // 時間行
  rows += `<tr><td class="h">時間</td>`;
  cols.forEach((s) => {
    const o = ov[s.id] || {};
    const tm = o.off ? "休み" : `${esc(o.start || s.start)}〜${esc(o.end || s.end)}`;
    rows += `<td class="s" style="${o.off ? "background:#e7e5e4" : ""}">${tm}${o.note ? BR + esc(o.note) : ""}</td>`;
  });
  if (holdItems.length) rows += `<td class="s">要再割当</td>`;
  rows += `</tr>`;
  // タイムグリッド
  usedSlots.forEach((m) => {
    rows += `<tr><td class="t">${toStr(m)}</td>`;
    cols.forEach((s) => {
      const items = cellMap[`${s.id}:${m}`] || [];
      const o = ov[s.id] || {};
      rows += `<td class="c" style="${o.off ? "background:#f5f5f4" : ""}">${items.join(BR + "――" + BR)}</td>`;
    });
    if (holdItems.length) {
      const items = cellMap[`${HOLD_ID}:${m}`] || [];
      rows += `<td class="c" style="background:#fef9c3">${items.join(BR + "――" + BR)}</td>`;
    }
    rows += `</tr>`;
  });

  // 下部セクション
  const wide = totalCols - 1;
  const secRow = (label, html, bg) =>
    `<tr><td class="h"${bg ? ` style="background:${bg}"` : ""}>${label}</td><td class="c" colspan="${wide}">${html}</td></tr>`;
  rows += `<tr><td colspan="${totalCols}" style="border:none;height:8pt"></td></tr>`;

  master.departments.forEach((d) => {
    const names = master.users.filter((u) => u.deptId === d.id && !absent[u.id]).map((u) => esc(u.name) + (u.wheelchair ? "(車)" : ""));
    if (names.length) rows += secRow(`利用者:${esc(d.name)}`, names.join("・"), hexOf(d.id));
  });
  const absentNames = master.users.filter((u) => absent[u.id]).map((u) => esc(u.name));
  if (absentNames.length) rows += secRow("本日欠席", absentNames.join("・"), "#e7e5e4");

  master.departments.forEach((d) => {
    const vs = master.vehicles.filter((v) => v.deptId === d.id)
      .map((v) => `${esc(v.name)}(${v.capNormal}名/車いす${v.wheelchairOK ? v.capWc + "名" : "不可"})`);
    if (vs.length) rows += secRow(`配車:${esc(d.name)}`, vs.join("・"), hexOf(d.id));
  });

  if (sheet.notes) rows += secRow("特記事項", esc(sheet.notes).replace(/\n/g, BR));
  if (sheet.contact) rows += secRow("連絡事項", esc(sheet.contact).replace(/\n/g, BR));

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml>
<x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>送迎表</x:Name>
<x:WorksheetOptions>
<x:FitToPage/>
<x:Print>
<x:ValidPrinterInfo/>
<x:PaperSizeIndex>9</x:PaperSizeIndex>
<x:FitWidth>1</x:FitWidth>
<x:FitHeight>1</x:FitHeight>
</x:Print>
</x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
</xml><![endif]-->
<style>
@page { mso-page-orientation: landscape; margin: 0.3in 0.25in 0.3in 0.25in; }
table { border-collapse: collapse; }
td { border: 0.5pt solid #808080; vertical-align: top; font-size: 8pt; font-family: "Yu Gothic", "Meiryo", sans-serif; padding: 1pt 2pt; white-space: normal; }
td.h { font-weight: bold; background: #f5f5f4; text-align: center; }
td.s { font-size: 7pt; text-align: center; color: #444; }
td.t { font-weight: bold; background: #fafaf9; text-align: right; font-size: 8pt; width: 36pt; }
td.c { width: 58pt; }
</style>
</head>
<body><table>${rows}</table></body></html>`;
}

function downloadExcel(master, sheet, date) {
  const html = buildExcelHtml(master, sheet, date);
  const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `送迎表_${dateWithDay(date)}_${appVerLabel()}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ============================================================
   Excel出力(本物の.xlsx / ExcelJS使用)
   列幅・結合・色・折り返し・A4横1ページ設定をファイルに埋め込む
   ============================================================ */
let excelJsPromise = null;
function loadExcelJS() {
  if (typeof window !== "undefined" && window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelJsPromise) {
    excelJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
      s.onload = () => resolve(window.ExcelJS);
      s.onerror = () => { excelJsPromise = null; reject(new Error("ExcelJS load failed")); };
      document.head.appendChild(s);
    });
  }
  return excelJsPromise;
}

// 月次集計: 各利用者×日付の送迎有無(1)。訓練送迎(mode=train)は数えない。部署ごとにシートを分けて印刷できる
// ---- 利用者一覧(部署ごとにシート分け・縦一覧) ----
function buildUserListWorkbook(ExcelJSlib, master) {
  const wb = new ExcelJSlib.Workbook();
  const DAYN = ["日", "月", "火", "水", "木", "金", "土"];
  const WDS = [1, 2, 3, 4, 5];
  const deptShort = (id) => {
    const d = master.departments.find((x) => x.id === id);
    return d ? d.name.replace(/リベルタ.*/, "リベ").slice(0, 2) : "?";
  };
  const libTxt = (u) => {
    if (!u.libertaAM && !u.libertaPM) return "";
    const base = u.libertaAM && u.libertaPM ? "朝・夕" : u.libertaAM ? "朝のみ" : "夕のみ";
    const ex = [];
    if (u.libertaAM && (u.libertaAMOffDays || []).length) ex.push("朝:" + u.libertaAMOffDays.map((d) => DAYN[d]).join("") + "は自宅");
    if (u.libertaPM && (u.libertaPMOffDays || []).length) ex.push("夕:" + u.libertaPMOffDays.map((d) => DAYN[d]).join("") + "は自宅");
    return base + (ex.length ? `(${ex.join(" / ")})` : "");
  };
  const timeByDayTxt = (u) => {
    const tbd = u.timeByDay || {};
    return WDS.filter((wd) => tbd[wd] && (tbd[wd].meet || tbd[wd].send))
      .map((wd) => `${DAYN[wd]}:${tbd[wd].meet ? "迎" + tbd[wd].meet : ""}${tbd[wd].meet && tbd[wd].send ? "/" : ""}${tbd[wd].send ? "送" + tbd[wd].send : ""}`)
      .join(" ");
  };
  const thin = { style: "thin", color: { argb: "FF999999" } };
  const allBorder = { top: thin, left: thin, bottom: thin, right: thin };
  master.departments.forEach((d) => {
    const list = master.users.filter((u) => u.deptId === d.id);
    if (!list.length) return;
    const safe = d.name.replace(/[\\\/\?\*\[\]:]/g, "").slice(0, 31) || "部署";
    const ws = wb.addWorksheet(safe, { views: [{ state: "frozen", ySplit: 2 }] });
    ws.columns = [
      { width: 4 }, { width: 12 },
      { width: 5 }, { width: 5 }, { width: 5 }, { width: 5 }, { width: 5 },
      { width: 9 }, { width: 9 }, { width: 11 }, { width: 11 }, { width: 22 }, { width: 6 }, { width: 8 }, { width: 22 }, { width: 24 },
    ];
    // 1行目: 部署名 + 人数
    ws.mergeCells(1, 1, 1, 16);
    const title = ws.getCell(1, 1);
    title.value = `${d.name} 利用者一覧(${list.length}名)`;
    title.font = { bold: true, size: 12 };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    title.border = allBorder;
    // 2行目: 見出し
    const heads = ["No.", "氏名", "月", "火", "水", "木", "金", "迎え時刻", "送り時刻", "いつもの迎え先", "いつもの送り先", "曜日別時間", "車いす", "ヘルプ", "リベルタ", "特記"];
    const hr = ws.getRow(2);
    heads.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, size: 9 };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } };
      c.border = allBorder;
    });
    // 3行目〜: 利用者(マスタの並び順のまま縦に)
    list.forEach((u, i) => {
      const row = ws.getRow(3 + i);
      const dayCell = (wd) => {
        if (!(u.days || []).includes(wd)) return "";
        const ov = (u.deptByDay || {})[wd];
        return ov && ov !== u.deptId ? deptShort(ov) : "○";
      };
      const vals = [
        i + 1, u.name,
        dayCell(1), dayCell(2), dayCell(3), dayCell(4), dayCell(5),
        u.meetTime || "", u.sendTime || "", defPlaceOf(u, "meet"), defPlaceOf(u, "send"), timeByDayTxt(u),
        u.wheelchair ? "○" : "", u.hasHelp ? (u.helpTwo ? "○(2名)" : "○") : "",
        libTxt(u), u.helpNote || "",
      ];
      vals.forEach((v, j) => {
        const c = row.getCell(j + 1);
        c.value = v;
        c.font = { size: 9 };
        c.border = allBorder;
        c.alignment = { vertical: "middle", wrapText: j >= 11, horizontal: j >= 2 && j <= 6 || j === 0 || j === 12 || j === 13 ? "center" : "left" };
      });
      // 曜日別部署の例外マスは色付け
      [1, 2, 3, 4, 5].forEach((wd, k) => {
        if ((u.deptByDay || {})[wd] && (u.deptByDay || {})[wd] !== u.deptId && (u.days || []).includes(wd)) {
          row.getCell(3 + k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
        }
      });
    });
    ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  });
  return wb;
}

function buildMonthlySummary(ExcelJSlib, master, days2, mode = "count") {
  const wb = new ExcelJSlib.Workbook();
  // 集計: mark[date][userId] = {meet, send}(count=1 / time=便の時刻。迎えは最初、送りは最後の便)
  const mark = {};
  days2.forEach(({ date, sheet }) => {
    const m2 = (mark[date] = {});
    ((sheet && sheet.runs) || []).forEach((r2) => {
      if ((r2.kind !== "meet" && r2.kind !== "send") || r2.mode === "train") return;
      (r2.userIds || []).forEach((id) => {
        const e = (m2[id] = m2[id] || {});
        if (mode === "time") {
          const t = toMin(r2.time);
          if (t == null) return;
          const cur = e[r2.kind + "T"];
          const better = cur == null || (r2.kind === "meet" ? t < cur : t > cur);
          if (better) { e[r2.kind + "T"] = t; e[r2.kind] = r2.time; }
        } else {
          e[r2.kind] = 1;
        }
      });
    });
  });
  const thin = { style: "thin", color: { argb: "FF9CA3AF" } };
  const B = { top: thin, bottom: thin, left: thin, right: thin };
  const renderDept = (wsName, users) => {
    const ws = wb.addWorksheet(wsName.slice(0, 28), {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.6, bottom: 0.3, header: 0.1, footer: 0.1 } },
      views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
    });
    const set2 = (r2, c2, v2, opt = {}) => {
      const c = ws.getCell(r2, c2);
      c.value = v2;
      c.font = { name: "Yu Gothic", size: opt.size || 10, bold: true };
      c.alignment = { vertical: "middle", horizontal: opt.hAlign || "center", wrapText: false };
      if (opt.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opt.fill } };
      c.border = B;
    };
    set2(1, 1, wsName, { hAlign: "left" }); set2(2, 1, "日付", { fill: "FFF5F5F4" });
    set2(1, 2, "", {}); set2(2, 2, "曜", { fill: "FFF5F5F4" });
    ws.getColumn(1).width = 9; ws.getColumn(2).width = 4;
    // A4横(約128文字幅)を使い切るように、人数に応じて列幅を自動調整
    const colW = Math.max(mode === "time" ? 5 : 3.5, Math.min(9, (128 - 13) / (users.length * 2)));
    users.forEach((u, i) => {
      const c0 = 3 + i * 2;
      ws.mergeCells(1, c0, 1, c0 + 1);
      set2(1, c0, u.name, { fill: "FFFef9C3", size: 9 });
      set2(2, c0, "迎", { size: 9, fill: "FFF5F5F4" });
      set2(2, c0 + 1, "送", { size: 9, fill: "FFF5F5F4" });
      ws.getColumn(c0).width = colW; ws.getColumn(c0 + 1).width = colW;
    });
    ws.getRow(1).height = 16; ws.getRow(2).height = 14;
    let r2 = 3;
    const tot = {};
    days2.forEach(({ date }) => {
      const d = new Date(date + "T00:00:00");
      set2(r2, 1, `${d.getMonth() + 1}月${d.getDate()}日`, { size: 9, hAlign: "right" });
      set2(r2, 2, DAYS[d.getDay()], { size: 9, fill: d.getDay() === 0 || d.getDay() === 6 ? "FFFEE2E2" : undefined });
      users.forEach((u, i) => {
        const e = (mark[date] || {})[u.id] || {};
        set2(r2, 3 + i * 2, e.meet || "", { size: mode === "time" ? 8 : 9 });
        set2(r2, 3 + i * 2 + 1, e.send || "", { size: mode === "time" ? 8 : 9 });
        const t = (tot[u.id] = tot[u.id] || { meet: 0, send: 0 });
        t.meet += e.meet ? 1 : 0; t.send += e.send ? 1 : 0;
      });
      ws.getRow(r2).height = 16;
      r2++;
    });
    set2(r2, 1, "合計", { fill: "FFFef9C3", hAlign: "right" });
    set2(r2, 2, "", { fill: "FFFef9C3" });
    users.forEach((u, i) => {
      const t = tot[u.id] || { meet: 0, send: 0 };
      set2(r2, 3 + i * 2, t.meet || "", { size: 9, fill: "FFFef9C3" });
      set2(r2, 3 + i * 2 + 1, t.send || "", { size: 9, fill: "FFFef9C3" });
    });
    ws.getRow(r2).height = 15;
  };
  // 部署ごとにシートを作成(利用者がいる部署のみ。リベルタ・他は集計対象外)
  master.departments.forEach((d) => {
    if (d.name === "リベルタ・他") return;
    const users = master.users.filter((u) => u.deptId === d.id);
    if (users.length) renderDept(d.name, users);
  });
  return wb;
}

// 車両の所在シミュレーション: 各スロットで各車がどの部署にいるか(移動中はnull)
// ルール: 朝は基地スタート(トラッキー・チョッパー=川津、ノンタン=あいのて、ドラ=リベルタ、他=嫁島)。迎え後は自部署へ、最後の送りの後は帰着地へ。ヘルプ中は不在。
// ---------- 車両の動きシミュレーション ----------
// 公用車を使う便・ヘルプを「トリップ」化。durMin=所要時間(分、未設定は30分)、destDeptId=終了後の行先部署(未設定は既定ルール)
function buildVehicleTrips(sheetData) {
  const trips = {};
  const add = (x, kind) => {
    const t = toMin(x.time);
    if (!x.vehicleId || String(x.vehicleId).startsWith("own:") || t == null) return;
    (trips[x.vehicleId] = trips[x.vehicleId] || []).push({
      id: x.id, t, end: t + helpDurMin(x), kind, dest: x.destDeptId || "", time: x.time, staffId: x.staffId,
      train: x.mode === "train" || (x.trainUserIds || []).length > 0 || (x.trainBothIds || []).length > 0 || (x.trainDropIds || []).length > 0,
    });
  };
  (sheetData.runs || []).forEach((r2) => { if ((r2.kind === "meet" || r2.kind === "send" || r2.kind === "other_run") && (r2.mode !== "walk" || r2.vehicleId)) add(r2, r2.kind); });
  (sheetData.blocks || []).forEach((b2) => add(b2, "help"));
  Object.values(trips).forEach((a) => a.sort((x, y) => x.t - y.t || x.end - y.end));
  return trips;
}

function vehicleHomeOf(master, v) {
  // 車両の基地(朝のスタート地点=1日の最終帰着地):
  //   トラッキー=川津・ノンタン=あいのて・ドラ=リベルタ、それ以外は全て嫁島スタート→嫁島終了
  const byName = (nm) => (master.departments.find((x) => x.name.startsWith(nm)) || {}).id;
  if (v.name === "ドラ") return byName("リベルタ") || v.deptId;
  if (v.name === "トラッキー") return byName("川津") || v.deptId;
  if (v.name === "ノンタン") return byName("あいのて") || v.deptId;
  return byName("嫁島") || v.deptId;
}

// トリップ終了後の車の位置。行先指定があれば最優先、なければ従来ルール(迎え後=所属、最終送り後=帰着地、ヘルプ・外出後=出発地へ戻る)
function vehicleAfterPos(master, v, trip, prevPos, lastSendT) {
  if (trip.dest) return trip.dest;
  if (trip.kind === "meet") return v.deptId;
  if (trip.kind === "send") return trip.t >= lastSendT ? vehicleHomeOf(master, v) : v.deptId;
  return prevPos; // ヘルプ・その他外出は出発地に戻る
}

// 指定時刻の直前に車がどの部署にいるか(その時刻に別トリップ中なら { pos: null, busy: trip })
function vehiclePosBefore(master, sheetData, vid, t) {
  const v = master.vehicles.find((x) => x.id === vid);
  if (!v || t == null) return { pos: null, busy: null };
  const trips = buildVehicleTrips(sheetData)[vid] || [];
  const lastSendT = trips.filter((e) => e.kind === "send").reduce((a, e) => Math.max(a, e.t), -1);
  const busy = trips.find((e) => e.t < t && e.end > t) || null; // tの時点でトリップ中
  let pos = vehicleHomeOf(master, v);
  // 車の置き場所は「終了した順」に更新する(重なりがあっても最後に終わった予定の行先が残る)
  [...trips].sort((a, b) => a.end - b.end).forEach((e) => {
    if (e.end <= t) pos = vehicleAfterPos(master, v, e, pos, lastSendT);
  });
  return busy ? { pos: null, busy } : { pos, busy: null };
}

function simulateVehicles(master, sheetData, slots) {
  const tripsAll = buildVehicleTrips(sheetData);
  const posAt = {};
  master.vehicles.forEach((v) => {
    const trips = tripsAll[v.id] || [];
    const lastSendT = trips.filter((e) => e.kind === "send").reduce((a, e) => Math.max(a, e.t), -1);
    const byEnd = [...trips].sort((a, b) => a.end - b.end); // 置き場所の更新は終了順
    let pos = vehicleHomeOf(master, v);
    let ti = 0;
    const map2 = {};
    slots.forEach((s2) => {
      while (ti < byEnd.length && byEnd[ti].end <= s2) { pos = vehicleAfterPos(master, v, byEnd[ti], pos, lastSendT); ti++; }
      const moving = trips.some((e) => e.t < s2 + SLOT && e.end > s2);
      map2[s2] = moving ? null : pos;
    });
    posAt[v.id] = map2;
  });
  return posAt;
}

// 車両の競合一覧(時間の重なり)を全件出す(車両の動き画面用)
function vehicleConflictList(master, sheetData) {
  const out = [];
  const tripsAll = buildVehicleTrips(sheetData);
  const vShort = makeVehShortMap(master.vehicles);
  Object.entries(tripsAll).forEach(([vid, trips]) => {
    const v = master.vehicles.find((x) => x.id === vid);
    if (!v) return;
    for (let i = 0; i < trips.length; i++) {
      for (let j = i + 1; j < trips.length; j++) {
        if (trips[j].t < trips[i].end) {
          const sn = (sid) => { const s = master.staff.find((x) => x.id === sid); return s ? s.name : "保留"; };
          out.push(`${vShort[v.id] || v.name}: ${trips[i].time}(${sn(trips[i].staffId)})と${trips[j].time}(${sn(trips[j].staffId)})の予定が重なっています(所要時間ベース)`);
        } else break;
      }
    }
  });
  // 生活介護の活動時間チェック: 固定活動車の使用と、あいのての空き2台確保
  {
    const winLabel = ([a, b]) => `${toStr(a)}〜${toStr(b)}`;
    Object.entries(tripsAll).forEach(([vid, trips]) => {
      const v = master.vehicles.find((x) => x.id === vid);
      if (!v || !ACTIVITY_VEHICLES[v.name]) return;
      trips.forEach((e) => {
        if (e.train) return; // 訓練の迎え/送りは活動に出ている車が途中で拾ってよい
        ACTIVITY_WINDOWS.forEach((w2) => {
          if (e.t < w2[1] && e.end > w2[0]) out.push(`${vShort[v.id] || v.name}: ${e.time}の予定が活動時間(${winLabel(w2)}・${ACTIVITY_VEHICLES[v.name]}の生活介護で使用)と重なっています`);
        });
      });
    });
    const ai = master.departments.find((d) => d.name === "あいのて");
    if (ai) {
      const aiVehicles = master.vehicles.filter((v) => v.deptId === ai.id);
      ACTIVITY_WINDOWS.forEach((w2) => {
        const busy = aiVehicles.filter((v) => (tripsAll[v.id] || []).some((e) => !e.train && e.t < w2[1] && e.end > w2[0]));
        const free = aiVehicles.length - busy.length;
        if (free < 2) out.push(`あいのて: 活動時間(${winLabel(w2)})に空き車が${free}台しかありません(生活介護用に2台必要)。${busy.map((v) => vShort[v.id] || v.name).join("・")}が送迎で使用中`);
      });
    }
  }
  // 最終帰着地チェック: 1日の終わりに基地(ノンタン=あいのて、チョッパー=川津、他=嫁島)へ戻っているか
  master.vehicles.forEach((v) => {
    const trips = tripsAll[v.id] || [];
    if (!trips.length) return;
    const lastSendT = trips.filter((e) => e.kind === "send").reduce((a, e) => Math.max(a, e.t), -1);
    const home = vehicleHomeOf(master, v);
    let fin = home;
    [...trips].sort((a, b) => a.end - b.end).forEach((e) => { fin = vehicleAfterPos(master, v, e, fin, lastSendT); });
    if (fin && fin !== home) {
      const dn = (id) => { const d = master.departments.find((x) => x.id === id); return d ? d.name : "?"; };
      out.push(`${vShort[v.id] || v.name}: 1日の最終位置が${dn(fin)}になっています(${dn(home)}着で終わる必要があります)。最後の予定の行先を確認してください`);
    }
  });
  return out;
}


/* ============================================================
   マスタExcel(職員・利用者・車両・週間パターンを1ファイルに)
   出力したExcelをそのまま取り込める。名前をキーに突き合わせ、Excelに無いものは消さない。
   ============================================================ */
const MS_STAFF = "職員", MS_USER = "利用者", MS_VEH = "車両", MS_PAT = "週間パターン", MS_RULE = "ルール", MS_DEPT = "部署", MS_HELP = "ヘルプ表";
// ルールの種類(Excelの「種類」列。ここの文字と一致した行だけ取り込む)
const RULE_T = { ng: "同乗NG", meet: "迎えの固定担当", send: "送りの固定担当", veh: "車の固定担当",
  block: "予定の固定担当", req: "必ず入るヘルプ", two: "2名体制のヘルプ", male: "男性職員のみ", uveh: "基本の車", hbase: "ヘルプの基本担当", other: "その他のルール" };
const daysToStr = (days) => DAY_ORDER.filter((d) => (days || []).includes(d)).map((d) => DAYS[d]).join("・");
const strToDays = (s) => {
  const out = [];
  String(s == null ? "" : s).split("").forEach((ch) => { const i = DAYS.indexOf(ch); if (i >= 0 && !out.includes(i)) out.push(i); });
  return out.sort((a, b) => a - b);
};
const xYes = (v) => (v ? "○" : "");
const xIsYes = (v) => /^[○◯〇oO✓はい有1]|true/i.test(String(v == null ? "" : v).trim());
const xStr = (v) => String(v == null ? "" : v).trim();
const xNum = (v) => { const n = Number(String(v == null ? "" : v).replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : null; };
// 曜日別の勤務時間: "月8:30-18:00(正日C) 火…"
const shiftToStr = (sb) => Object.entries(sb || {}).sort((a, b) => Number(a[0]) - Number(b[0]))
  .map(([wd, v]) => `${DAYS[Number(wd)]}${v.start}-${v.end}${v.code ? `(${v.code})` : ""}`).join(" ");
const strToShift = (s) => {
  const out = {};
  String(s == null ? "" : s).replace(/([日月火水木金土])\s*(\d{1,2}:\d{2})\s*[-〜~]\s*(\d{1,2}:\d{2})(?:\s*[(（]([^)）]*)[)）])?/g,
    (_, d, a, b, c) => { const i = DAYS.indexOf(d); if (i >= 0) out[i] = { start: a, end: b, ...(c ? { code: c } : {}) }; return ""; });
  return out;
};
// 曜日別の部署: "金=あいのて"
const deptDayToStr = (map, master) => Object.entries(map || {}).sort((a, b) => Number(a[0]) - Number(b[0]))
  .map(([wd, id]) => `${DAYS[Number(wd)]}=${(master.departments.find((d) => d.id === id) || {}).name || ""}`).join(" ");
const strToDeptDay = (s, master) => {
  const out = {};
  String(s == null ? "" : s).split(/[\s,、]+/).filter(Boolean).forEach((part) => {
    const m = part.match(/^([日月火水木金土])\s*=\s*(.+)$/);
    if (!m) return;
    const i = DAYS.indexOf(m[1]); const d = master.departments.find((x) => x.name === m[2].trim());
    if (i >= 0 && d) out[i] = d.id;
  });
  return out;
};
// 利用者の曜日別時刻: "火送13:00 水送13:00"
const timeDayToStr = (map) => Object.entries(map || {}).sort((a, b) => Number(a[0]) - Number(b[0]))
  .flatMap(([wd, v]) => [v.meet ? `${DAYS[Number(wd)]}迎${v.meet}` : "", v.send ? `${DAYS[Number(wd)]}送${v.send}` : ""].filter(Boolean)).join(" ");
const strToTimeDay = (s) => {
  const out = {};
  String(s == null ? "" : s).replace(/([日月火水木金土])\s*(迎|送)\s*(\d{1,2}:\d{2})/g, (_, d, k, t) => {
    const i = DAYS.indexOf(d); if (i >= 0) out[i] = { ...(out[i] || {}), [k === "迎" ? "meet" : "send"]: t };
    return "";
  });
  return out;
};
// 利用曜日の変更日: "2026-08-13→月火水木金"
const daysFromToStr = (map) => Object.entries(map || {}).sort().map(([d, list]) => `${d}→${daysToStr(list)}`).join(" / ");
const strToDaysFrom = (s) => {
  const out = {};
  String(s == null ? "" : s).split("/").map((x) => x.trim()).filter(Boolean).forEach((part) => {
    const m = part.match(/^(\d{4}-\d{2}-\d{2})\s*[→>]\s*(.+)$/);
    if (m) out[m[1]] = strToDays(m[2]);
  });
  return out;
};
const RUN_KIND_JP = { meet: "迎え", send: "送り", other_run: "その他の便", own_move: "自車移動" };
const RUN_JP_KIND = { "迎え": "meet", "送り": "send", "その他の便": "other_run", "自車移動": "own_move" };
const MODE_JP = { walk: "徒歩", train: "訓練", move: "移動" };
const JP_MODE = { "徒歩": "walk", "訓練": "train", "移動": "move" };

function buildMasterWorkbook(ExcelJS, master, patterns) {
  const wb = new ExcelJS.Workbook();
  const dn = (id) => (master.departments.find((d) => d.id === id) || {}).name || "";
  const head = (ws, cols) => {
    ws.columns = cols.map((c) => ({ header: c[0], key: c[0], width: c[1] }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };


  // ---- 部署(先頭シート。職員・利用者・車両はこの名前で部署を指定する) ----
  const ws0 = wb.addWorksheet(MS_DEPT);
  head(ws0, [["部署名", 16], ["男性ゼロを許容する分", 18], ["在席の上限(人)", 14], ["職員の上限(人)", 14], ["職員の下限(人)", 14]]);
  master.departments.forEach((d) => ws0.addRow([d.name, d.maleGapMin == null ? "" : d.maleGapMin,
    d.capMax == null ? "" : d.capMax, d.staffMax == null ? "" : d.staffMax, d.staffMin == null ? "" : d.staffMin]));
  // ---- 職員 ----
  const ws1 = wb.addWorksheet(MS_STAFF);
  head(ws1, [["名前", 12], ["部署", 12], ["役職", 14], ["雇用", 8], ["出勤", 8], ["退勤", 8], ["運転", 6], ["男性", 6],
    ["固定休", 10], ["曜日別の勤務", 46], ["曜日別の部署", 16], ["兼務先", 12], ["自車", 6], ["自車定員", 8],
    ["右端に並べる", 10], ["パート欄に出さない", 12], ["表に出さない", 10], ["職員欄に出さない", 12], ["ヘルプ専任", 8], ["退職日", 12], ["備考", 24]]);
  master.staff.forEach((s) => ws1.addRow([s.name, dn(s.deptId), s.position || "", s.emp || "常勤", s.start || "", s.end || "",
    xYes(s.canDrive), xYes(s.isMale), daysToStr(s.offDays), shiftToStr(s.shiftByDay), deptDayToStr(s.deptByDay, master),
    dn(s.subDeptId), xYes(s.hasOwnCar), s.ownCarCap == null ? "" : s.ownCarCap, xYes(s.sortLast), xYes(s.hideInPartList),
    xYes(s.noGrid), xYes(s.hideInStaffList), xYes(s.helpOnly), s.retireDate || "", s.memo || ""]));

  // ---- 利用者 ----
  const ws2 = wb.addWorksheet(MS_USER);
  head(ws2, [["名前", 12], ["部署", 12], ["利用曜日", 12], ["迎え", 8], ["送り", 8], ["曜日別の時刻", 28],
    ["いつもの迎え先", 14], ["いつもの送り先", 14],
    ["車いす", 6], ["ヘルプ", 6], ["2名体制", 8], ["男性", 6], ["リベ朝", 6], ["リベ夕", 6],
    ["曜日別の部署", 16], ["利用開始日", 12], ["曜日の変更", 24], ["メモ", 50]]);
  master.users.forEach((u) => ws2.addRow([u.name, dn(u.deptId), daysToStr(u.days), u.meetTime || "", u.sendTime || "",
    timeDayToStr(u.timeByDay), u.meetPlace || "", u.sendPlace || "", xYes(u.wheelchair), xYes(u.hasHelp), xYes(u.helpTwo), xYes(u.isMale),
    xYes(u.libertaAM), xYes(u.libertaPM), deptDayToStr(u.deptByDay, master), u.startDate || "",
    daysFromToStr(u.daysFrom), u.helpNote || ""]));

  // ---- 車両 ----
  const ws3 = wb.addWorksheet(MS_VEH);
  head(ws3, [["名前", 14], ["部署", 12], ["定員(運転手込み)", 14], ["車いす時の定員", 14], ["車いす可", 8], ["備考", 30]]);
  master.vehicles.forEach((v) => ws3.addRow([v.name, dn(v.deptId), v.capNormal == null ? "" : v.capNormal,
    v.capWc == null ? "" : v.capWc, xYes(v.wheelchairOK), v.memo || ""]));

  // ---- 週間パターン ----
  const ws4 = wb.addWorksheet(MS_PAT);
  head(ws4, [["曜日", 6], ["区分", 8], ["種別", 12], ["時刻", 8], ["担当", 10], ["車", 12], ["利用者", 44],
    ["同乗職員", 16], ["メモ・予定名", 28], ["所要分", 7], ["移動", 7], ["訓練(降ろし)", 14], ["訓練(往復)", 14], ["訓練(終了)", 14], ["行き先変更", 24]]);
  const sName = (id) => (master.staff.find((x) => x.id === id) || {}).name || (id === HOLD_ID ? "保留" : "");
  const uName = (id) => (master.users.find((x) => x.id === id) || {}).name || "";
  const vName = (id) => {
    if (!id) return "";
    if (String(id).startsWith("own:")) return "自車";
    return (master.vehicles.find((x) => x.id === id) || {}).name || "";
  };
  DAY_ORDER.forEach((wd) => {
    const p = (patterns || {})[wd];
    if (!p) return;
    (p.runs || []).slice().sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0)).forEach((r) => {
      ws4.addRow([DAYS[wd], "便", RUN_KIND_JP[r.kind] || r.kind, r.time, sName(r.staffId), vName(r.vehicleId),
        (r.userIds || []).map(uName).filter(Boolean).join("・"),
        (r.staffRiderIds || []).map(sName).filter(Boolean).join("・"),
        r.note || "", "", MODE_JP[r.mode] || "",
        (r.trainDropIds || []).map(uName).join("・"), (r.trainBothIds || []).map(uName).join("・"), (r.trainEndIds || []).map(uName).join("・"),
        placeChangesOf(r).map((x) => `${uName(x.id)}=${x.place}`).join(" ")]);
    });
    (p.blocks || []).slice().sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0)).forEach((b) => {
      ws4.addRow([DAYS[wd], b.kind === "help" ? "ヘルプ" : "予定", "", b.time, sName(b.staffId), vName(b.vehicleId),
        (b.userIds || []).map(uName).filter(Boolean).join("・"), "", b.label || "", b.durMin || "", "", "", "", "", ""]);
    });
    if (p.training) ws4.addRow([DAYS[wd], "訓練メモ", "", "", "", "", "", "", p.training, "", "", "", "", "", ""]);
  });


  // ---- ヘルプ表(この曜日はこの人、という基本の担当。2名体制は「A・B」) ----
  const ws6 = wb.addWorksheet(MS_HELP);
  head(ws6, [["時刻", 8], ["ヘルプ", 20], ...DAY_ORDER.map((wd) => [DAYS[wd], 14])]);
  {
    const R = rulesOf(master);
    const hb = [...(R.helpBase || [])].sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0) || String(a.label).localeCompare(String(b.label), "ja"));
    hb.forEach((r) => ws6.addRow([r.time || "", r.label || "", ...DAY_ORDER.map((wd) => (r.byDay || {})[wd] || "")]));
  }
  // ---- ルール ----
  const ws5 = wb.addWorksheet(MS_RULE);
  head(ws5, [["種類", 18], ["対象1", 14], ["対象2", 14], ["曜日", 12], ["担当", 10],
    ["この時刻だけ", 11], ["この時刻以降", 11], ["この時刻より前", 12], ["条件", 16]]);
  {
    const R = rulesOf(master);
    const add = (type, o) => ws5.addRow([type, o.t1 || "", o.t2 || "", o.days || "", o.staff || "",
      o.only || "", o.from || "", o.before || "", o.cond || ""]);
    (R.ngPairs || []).forEach((x) => add(RULE_T.ng, { t1: x.a, t2: x.b }));
    (R.fixedRun || []).forEach((x) => add(x.kind === "send" ? RULE_T.send : RULE_T.meet, { t1: x.user, days: daysToStr(x.days), staff: x.staff }));
    (R.fixedVeh || []).forEach((x) => add(RULE_T.veh, { t1: x.veh, days: daysToStr(x.days), staff: x.staff, before: x.before }));
    (R.fixedBlock || []).forEach((x) => add(RULE_T.block, {
      t1: x.label, t2: x.kind === "help" ? "ヘルプ" : x.kind === "block" ? "予定" : "",
      days: daysToStr(x.days), staff: x.staff, only: x.time, from: x.from, cond: x.exact ? "完全一致" : "",
    }));
    (R.requiredHelp || []).forEach((x) => add(RULE_T.req, { t1: x.user, days: daysToStr(x.days) }));
    (R.helpTwo || []).forEach((x) => add(RULE_T.two, { t1: x.user, days: daysToStr(x.days) }));
    (R.maleOnly || []).forEach((x) => add(RULE_T.male, { t1: x.user, from: x.from, cond: x.bathOnly ? "入浴のみ" : "" }));
    (R.userVeh || []).forEach((x) => add(RULE_T.uveh, { t1: x.user, t2: x.veh }));
    (R.otherRules || []).forEach((x) => add(RULE_T.other, { t1: x.text, days: daysToStr(x.days), cond: x.check !== false ? "出力前に確認" : "" }));
    // ※ ヘルプの基本担当は「ヘルプ表」シートに出します
  }
  return wb;
}

// Excelを読み戻して {master, patterns, log} を作る。名前で突き合わせ、無い行は追加。Excelに無い既存データは消さない。
function parseMasterWorkbook(XLSX, wb, master0) {
  const log = [];
  const aoaOf = (name) => {
    const ws = wb.Sheets[name];
    if (!ws) return null;
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  };
  const master = JSON.parse(JSON.stringify(master0));
  const deptId = (name) => {
    const n = xStr(name);
    const d = master.departments.find((x) => x.name === n);
    return d ? d.id : (master.departments[0] || {}).id;
  };
  const colIdx = (headRow) => { const o = {}; (headRow || []).forEach((h, i) => { o[xStr(h)] = i; }); return o; };


  // ---- 部署(ほかのシートより先に読む) ----
  const a0 = aoaOf(MS_DEPT);
  if (a0 && a0.length > 1) {
    const c = colIdx(a0[0]); let add = 0, upd = 0;
    a0.slice(1).forEach((row) => {
      const name = xStr(row[c["部署名"]]);
      if (!name) return;
      const base = { name };
      const n1 = xNum(row[c["男性ゼロを許容する分"]]); if (n1 != null) base.maleGapMin = n1;
      const n2 = xNum(row[c["在席の上限(人)"]]); if (n2 != null) base.capMax = n2;
      const n3 = xNum(row[c["職員の上限(人)"]]); if (n3 != null) base.staffMax = n3;
      const n4 = xNum(row[c["職員の下限(人)"]]); if (n4 != null) base.staffMin = n4;
      const cur = master.departments.find((d) => d.name === name);
      if (cur) { Object.assign(cur, base); upd++; } else { master.departments.push({ id: uid(), ...base }); add++; }
    });
    log.push(`部署: ${upd}件を更新・${add}件を追加`);
  }
  // ---- 職員 ----
  const a1 = aoaOf(MS_STAFF);
  if (a1 && a1.length > 1) {
    const c = colIdx(a1[0]); let add = 0, upd = 0;
    a1.slice(1).forEach((row) => {
      const name = xStr(row[c["名前"]]);
      if (!name) return;
      const base = {
        name, deptId: deptId(row[c["部署"]]), position: xStr(row[c["役職"]]), emp: xStr(row[c["雇用"]]) || "常勤",
        start: xStr(row[c["出勤"]]), end: xStr(row[c["退勤"]]), canDrive: xIsYes(row[c["運転"]]), isMale: xIsYes(row[c["男性"]]),
        offDays: strToDays(row[c["固定休"]]), shiftByDay: strToShift(row[c["曜日別の勤務"]]),
        deptByDay: strToDeptDay(row[c["曜日別の部署"]], master),
        subDeptId: xStr(row[c["兼務先"]]) ? deptId(row[c["兼務先"]]) : "",
        hasOwnCar: xIsYes(row[c["自車"]]), ownCarCap: xNum(row[c["自車定員"]]) == null ? 3 : xNum(row[c["自車定員"]]),
        sortLast: xIsYes(row[c["右端に並べる"]]), hideInPartList: xIsYes(row[c["パート欄に出さない"]]),
        noGrid: xIsYes(row[c["表に出さない"]]), hideInStaffList: xIsYes(row[c["職員欄に出さない"]]),
        helpOnly: xIsYes(row[c["ヘルプ専任"]]), retireDate: xStr(row[c["退職日"]]), memo: xStr(row[c["備考"]]),
      };
      const cur = master.staff.find((s) => s.name === name || (s._seed && s._seed.name === name));
      if (cur) { Object.assign(cur, base); upd++; } else { master.staff.push({ id: uid(), ...base }); add++; }
    });
    log.push(`職員: ${upd}名を更新・${add}名を追加`);
  }

  // ---- 利用者 ----
  const a2 = aoaOf(MS_USER);
  if (a2 && a2.length > 1) {
    const c = colIdx(a2[0]); let add = 0, upd = 0;
    a2.slice(1).forEach((row) => {
      const name = xStr(row[c["名前"]]);
      if (!name) return;
      const base = {
        name, deptId: deptId(row[c["部署"]]), days: strToDays(row[c["利用曜日"]]),
        meetTime: xStr(row[c["迎え"]]), sendTime: xStr(row[c["送り"]]), timeByDay: strToTimeDay(row[c["曜日別の時刻"]]),
        wheelchair: xIsYes(row[c["車いす"]]), hasHelp: xIsYes(row[c["ヘルプ"]]), helpTwo: xIsYes(row[c["2名体制"]]),
        isMale: xIsYes(row[c["男性"]]), libertaAM: xIsYes(row[c["リベ朝"]]), libertaPM: xIsYes(row[c["リベ夕"]]),
        deptByDay: strToDeptDay(row[c["曜日別の部署"]], master), startDate: xStr(row[c["利用開始日"]]),
        daysFrom: strToDaysFrom(row[c["曜日の変更"]]), helpNote: xStr(row[c["メモ"]]),
      };
      // 古いExcel(この列が無い)を取り込んでも、今の設定を消さない
      if (c["いつもの迎え先"] != null) base.meetPlace = xStr(row[c["いつもの迎え先"]]);
      if (c["いつもの送り先"] != null) base.sendPlace = xStr(row[c["いつもの送り先"]]);
      if (!Object.keys(base.timeByDay).length) delete base.timeByDay;
      if (!Object.keys(base.daysFrom).length) delete base.daysFrom;
      const cur = master.users.find((u) => u.name === name || (u._seed && u._seed.name === name));
      if (cur) { Object.assign(cur, base); upd++; } else { master.users.push({ id: uid(), ...base }); add++; }
    });
    log.push(`利用者: ${upd}名を更新・${add}名を追加`);
  }

  // ---- 車両 ----
  const a3 = aoaOf(MS_VEH);
  if (a3 && a3.length > 1) {
    const c = colIdx(a3[0]); let add = 0, upd = 0;
    a3.slice(1).forEach((row) => {
      const name = xStr(row[c["名前"]]);
      if (!name) return;
      const base = {
        name, deptId: deptId(row[c["部署"]]),
        capNormal: xNum(row[c["定員(運転手込み)"]]) == null ? 0 : xNum(row[c["定員(運転手込み)"]]),
        capWc: xNum(row[c["車いす時の定員"]]) == null ? 0 : xNum(row[c["車いす時の定員"]]),
        wheelchairOK: xIsYes(row[c["車いす可"]]), memo: xStr(row[c["備考"]]),
      };
      const cur = master.vehicles.find((v) => v.name === name || (v._seed && v._seed.name === name));
      if (cur) { Object.assign(cur, base); upd++; } else { master.vehicles.push({ id: uid(), ...base }); add++; }
    });
    log.push(`車両: ${upd}台を更新・${add}台を追加`);
  }

  // ---- 週間パターン ----
  const patterns = {};
  const a4 = aoaOf(MS_PAT);
  const unknown = new Set();
  const unknownRule = new Set();
  if (a4 && a4.length > 1) {
    const c = colIdx(a4[0]);
    const sId = (n) => {
      const v = xStr(n); if (!v) return HOLD_ID;
      if (v === "保留") return HOLD_ID;
      const s = master.staff.find((x) => x.name === v); if (!s) { unknown.add(`職員「${v}」`); return HOLD_ID; }
      return s.id;
    };
    const uIds = (txt) => xStr(txt).split(/[・,、]/).map((x) => x.trim()).filter(Boolean).map((n) => {
      const u = master.users.find((x) => x.name === n); if (!u) { unknown.add(`利用者「${n}」`); return null; }
      return u.id;
    }).filter(Boolean);
    const vId = (n, staffId) => {
      const v = xStr(n); if (!v) return "";
      if (v === "自車") return staffId && staffId !== HOLD_ID ? "own:" + staffId : "";
      const veh = master.vehicles.find((x) => x.name === v); if (!veh) { unknown.add(`車「${v}」`); return ""; }
      return veh.id;
    };
    a4.slice(1).forEach((row) => {
      const wd = DAYS.indexOf(xStr(row[c["曜日"]]));
      if (wd < 0) return;
      const sec = xStr(row[c["区分"]]);
      if (!patterns[wd]) patterns[wd] = { runs: [], blocks: [], training: "" };
      if (sec === "訓練メモ") { patterns[wd].training = xStr(row[c["メモ・予定名"]]); return; }
      const staffId = sId(row[c["担当"]]);
      if (sec === "便") {
        const kind = RUN_JP_KIND[xStr(row[c["種別"]])] || "meet";
        const mode = JP_MODE[xStr(row[c["移動"]])] || "";
        const drop = uIds(row[c["訓練(降ろし)"]]), both = uIds(row[c["訓練(往復)"]]), end = uIds(row[c["訓練(終了)"]]);
        // 行き先変更「森=実家 中村=病院」を {利用者ID: 行き先} に戻す
        const pl = {};
        xStr(row[c["行き先変更"]]).split(/[\s、,]+/).filter(Boolean).forEach((seg) => {
          const i2 = seg.indexOf("=");
          if (i2 < 1) return;
          const nm = seg.slice(0, i2).trim(), pv = seg.slice(i2 + 1).trim();
          const u2 = master.users.find((x) => x.name === nm);
          if (!u2) { unknown.add(`利用者「${nm}」`); return; }
          if (pv) pl[u2.id] = pv;
        });
        patterns[wd].runs.push({
          id: uid(), kind, time: xStr(row[c["時刻"]]), staffId, vehicleId: vId(row[c["車"]], staffId),
          userIds: uIds(row[c["利用者"]]),
          staffRiderIds: xStr(row[c["同乗職員"]]).split(/[・,、]/).map((x) => x.trim()).filter(Boolean)
            .map((n) => { const s = master.staff.find((x) => x.name === n); if (!s) { unknown.add(`職員「${n}」`); return null; } return s.id; }).filter(Boolean),
          note: xStr(row[c["メモ・予定名"]]),
          ...(mode ? { mode } : {}),
          ...(drop.length ? { trainDropIds: drop } : {}),
          ...(both.length ? { trainBothIds: both } : {}),
          ...(end.length ? { trainEndIds: end } : {}),
          ...(Object.keys(pl).length ? { places: pl } : {}),
        });
      } else if (sec === "ヘルプ" || sec === "予定") {
        patterns[wd].blocks.push({
          id: uid(), kind: sec === "ヘルプ" ? "help" : "block", time: xStr(row[c["時刻"]]), staffId,
          label: xStr(row[c["メモ・予定名"]]), vehicleId: vId(row[c["車"]], staffId), userIds: uIds(row[c["利用者"]]),
          ...(xNum(row[c["所要分"]]) ? { durMin: xNum(row[c["所要分"]]) } : {}),
        });
      }
    });
    const n = Object.keys(patterns).length;
    if (n) log.push(`週間パターン: ${Object.keys(patterns).map((wd) => DAYS[wd]).join("・")}曜の${Object.values(patterns).reduce((a, p) => a + p.runs.length + p.blocks.length, 0)}件を置き換え`);
  }

  // ---- ルール ----
  const a5 = aoaOf(MS_RULE);
  if (a5 && a5.length > 1) {
    const c = colIdx(a5[0]);
    const R = { ngPairs: [], fixedRun: [], fixedVeh: [], fixedBlock: [], requiredHelp: [], helpTwo: [], maleOnly: [], userVeh: [], helpBase: [], otherRules: [] };
    let n = 0;
    a5.slice(1).forEach((row) => {
      const type = xStr(row[c["種類"]]);
      const t1 = xStr(row[c["対象1"]]), t2 = xStr(row[c["対象2"]]);
      const days = strToDays(row[c["曜日"]]), staff = xStr(row[c["担当"]]);
      const only = xStr(row[c["この時刻だけ"]]), from = xStr(row[c["この時刻以降"]]), before = xStr(row[c["この時刻より前"]]);
      const cond = xStr(row[c["条件"]]);
      if (!type || (!t1 && !t2)) return;
      n++;
      if (type === RULE_T.ng) R.ngPairs.push({ a: t1, b: t2 });
      else if (type === RULE_T.meet) R.fixedRun.push({ kind: "meet", user: t1, days, staff });
      else if (type === RULE_T.send) R.fixedRun.push({ kind: "send", user: t1, days, staff });
      else if (type === RULE_T.veh) R.fixedVeh.push({ veh: t1, before: before || "12:00", days, staff });
      else if (type === RULE_T.block) R.fixedBlock.push({
        label: t1, exact: /完全一致/.test(cond), kind: t2 === "ヘルプ" ? "help" : t2 === "予定" ? "block" : "",
        time: only, from, days, staff,
      });
      else if (type === RULE_T.req) R.requiredHelp.push({ user: t1, days });
      else if (type === RULE_T.two) R.helpTwo.push({ user: t1, days });
      else if (type === RULE_T.male) R.maleOnly.push({ user: t1, from, bathOnly: /入浴/.test(cond) });
      else if (type === RULE_T.uveh) R.userVeh.push({ user: t1, veh: t2 });
      else if (type === RULE_T.other) R.otherRules.push({ text: t1, days, check: /確認/.test(cond) });
      else if (type === RULE_T.hbase) {
        const byDay = {};
        String(cond).split(/[\s,、]+/).filter(Boolean).forEach((part) => {
          const mm = part.match(/^([日月火水木金土])\s*=\s*(.+)$/);
          if (mm) { const i2 = DAYS.indexOf(mm[1]); if (i2 >= 0) byDay[i2] = mm[2].trim(); }
        });
        if (Object.keys(byDay).length) R.helpBase.push({ label: t1, time: only, byDay });
      }
      else { n--; unknownRule.add(type); }
    });
    master.rules = R;
    log.push(`ルール: ${n}件を反映`);
    if (unknownRule.size) log.push(`⚠ 分からない種類の行は読み飛ばしました: ${[...unknownRule].join("、")}`);
  }


  // ---- ヘルプ表(基本の担当) ----
  const a6 = aoaOf(MS_HELP);
  if (a6 && a6.length > 1) {
    const c = colIdx(a6[0]);
    const list = [];
    a6.slice(1).forEach((row) => {
      const label = xStr(row[c["ヘルプ"]]);
      if (!label) return;
      const byDay = {};
      DAY_ORDER.forEach((wd) => {
        const v = xStr(row[c[DAYS[wd]]]);
        if (v) byDay[wd] = v;
      });
      // 担当をまだ選んでいない行(ヘルプ表で追加しただけ)も残す
      list.push({ label, time: xStr(row[c["時刻"]]), byDay, ...(Object.keys(byDay).length ? {} : { manual: true }) });
    });
    master.rules = { ...EMPTY_RULES, ...(master.rules || {}), helpBase: list };
    log.push(`ヘルプ表: ${list.length}件の基本担当を反映`);
  }

  if (unknown.size) log.push(`⚠ 見つからなかった名前(その項目は空にしました): ${[...unknown].join("、")}`);
  return { master, patterns, log };
}

// opts.wb を渡すとそのワークブックにシートを足す。opts.hideHelpVeh=true でヘルプの車名を出さない
function buildWorkbook(ExcelJS, master, sheet, date, opts = {}) {
  if (sheet) sheet = { ...sheet, blocks: canonHelpBlocks(sheet.blocks) };   // 井上入浴→井上ヘルプ など
  const hideHelpVeh = !!opts.hideHelpVeh;
  const wd = weekdayOf(date);
  const deptIndex = (id) => master.departments.findIndex((d) => d.id === id);
  const deptName = (id) => { const d = master.departments[deptIndex(id)]; return d ? d.name : ""; };
  const HEX = ["FFE0F2FE", "FFFEF3C7", "FFD1FAE5", "FFFFE4E6", "FFEDE9FE", "FFCFFAFE"];
  const argbOf = (id) => HEX[Math.max(0, deptIndex(id)) % HEX.length];
  const GRAY = "FFE7E5E4", HOLDBG = "FFFEF9C3", HEADBG = "FFF5F5F4", TIMEBG = "FFFAFAF9";

  const ov = sheet.staffOv || {};
  const absent = sheet.userAbsent || {};
  const fxOff = (s) => (s.offDays || []).includes(wd);
  const wToday = (s) => !!(ov[s.id] && ov[s.id].workToday);
  // 送迎グリッドに出す職員(パートは除外し、下部の職員欄のみに表示)
  const byDept = [...master.staff]
    .filter((s) => s.emp !== "パート" && !s.noGrid && (!fxOff(s) || wToday(s)))
    .sort((a, b) => staffColKey(master, a, wd) - staffColKey(master, b, wd));
  const workingSet = new Set(byDept.map((s) => s.id));
  const actives = byDept.filter((s) => !(ov[s.id] && ov[s.id].off));
  const offs = byDept.filter((s) => ov[s.id] && ov[s.id].off);
  const known = new Set(master.staff.map((s) => s.id));
  const holdCount =
    sheet.runs.filter((r) => r.staffId === HOLD_ID || !known.has(r.staffId) || !workingSet.has(r.staffId)).length +
    sheet.blocks.filter((b) => b.staffId === HOLD_ID || !known.has(b.staffId) || !workingSet.has(b.staffId)).length;
  const cols = [...actives, ...offs];
  const hasHold = holdCount > 0;
  const nCols = 1 + cols.length + (hasHold ? 1 : 0);
  const isOff = (s) => !!(ov[s.id] && ov[s.id].off);

  // セル内容の組み立て
  const colKey = (sid) => (sid === HOLD_ID || !known.has(sid) || !workingSet.has(sid) ? HOLD_ID : sid);
  // 利用者3名以上の便は、グリッドにはタイトル(例:津田送①)だけを表示し、乗車者一覧は下段「送迎」欄に出す
  const CIRCLED = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
  const deptShort = (id) => { const d = master.departments.find((x) => x.id === id); return d ? d.name.replace(/リベルタ.*/, "リベ").slice(0, 2) : ""; };
  const runTitles = {};
  const runLibExtra = {}; // リベ便に同乗する「リベルタ利用でない人」の名前(グリッドのセルに出す)
  // リベルタ利用が有効か(朝=迎え・夕=送り。日別の「泊なし」調整を反映)。
  // 朝なし=迎え便に「(自宅)」、夕なし=送り便に「(帰宅)」の補足付き氏名も共通ヘルパーから取得
  const libOffMap = sheet.libertaOff || {};
  const libOnMap = sheet.libertaOn || {}; // 基本は泊なしの日に「今日だけ泊まる」上書き(特記事項欄の表示で使用)
  const { isLibOn, nameHome } = makeLibNameHelpers(sheet, wd);
  {
    const big = sheet.runs
      .filter((r2) => (r2.kind === "meet" || r2.kind === "send") && !r2.mode && (r2.userIds || []).length >= 3)
      .sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0));
    const counters = {};
    big.forEach((r2) => {
      const usersOf = (r2.userIds || []).map((uid2) => master.users.find((x) => x.id === uid2)).filter(Boolean);
      const libs = usersOf.filter((u) => isLibOn(u, r2.kind));
      let key;
      if (libs.length >= 1) {
        // リベルタ利用者(その方向で有効)が1人でも乗る便は「リベ迎/リベ送」。
        // リベルタ利用でない同乗者は集約せず、全員セルに個別表示する
        key = "リベ" + (r2.kind === "meet" ? "迎" : "送");
        runLibExtra[r2.id] = usersOf.filter((u) => !isLibOn(u, r2.kind)).map((u) => nameHome(u, r2.kind === "send" ? "send" : "meet", r2));
      } else {
        const cnt = {};
        usersOf.forEach((u) => { cnt[u.deptId] = (cnt[u.deptId] || 0) + 1; });
        const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
        key = (top ? deptShort(top[0]) : "送迎") + (r2.kind === "meet" ? "迎" : "送");
      }
      counters[key] = (counters[key] || 0) + 1;
      runTitles[r2.id] = key + (CIRCLED[counters[key]] || counters[key]);
    });
  }

  // 表示幅(全角=1、半角=0.5)。名前が途中で折り返されないよう、区切りのよい位置で改行を入れる
  const dispW0 = (s) => [...String(s)].reduce((a, ch) => a + (/[\uFF61-\uFF9F\x20-\x7E]/.test(ch) ? 0.5 : 1), 0);
  const CELL_W = 4.9; // 列幅11・12pt太字で全角4.9文字ぶん
  const wrapJoin = (arr, maxW) => {
    const lines = [];
    let cur = "";
    arr.forEach((n) => {
      const seg = cur ? cur + "・" + n : n;
      if (cur && dispW0(toHankakuKana(seg)) > maxW) { lines.push(cur); cur = n; }
      else cur = seg;
    });
    if (cur) lines.push(cur);
    return lines.join("\n");
  };
  // 車名は短縮表記(ピカチュウ→ピカ)。配車欄には正式名を出す(対照用)。
  const vehShort = makeVehShortMap(master.vehicles);
  const shortName = (veh) => (veh ? (veh.own ? veh.name : vehShort[veh.id] || veh.name) : "");
  const itemText = (it, isRun) => {
    if (isRun) {
      const veh = resolveVehicle(master, it.vehicleId);
      const names = it.userIds.map((id) => { const u = master.users.find((x) => x.id === id); const k2 = it.kind === "send" ? "send" : "meet"; return u ? nameHome(u, k2, it) + trainSfx(it, u, k2) : ""; }).filter(Boolean);
      const MODE_LABEL = { walk: "徒歩", train: "訓練", move: "移動" };
      let s = it.kind === "own_move" ? "[自車]"
        : it.mode === "walk" ? `[徒歩${RUN_KINDS[it.kind] || "送"}]`
        : it.mode ? `[${MODE_LABEL[it.mode] || ""}${RUN_KINDS[it.kind] || "送"}]${veh ? shortName(veh) : ""}`
        : `[${RUN_KINDS[it.kind] || "送"}]${veh ? shortName(veh) : "車未定"}`;
      if (runTitles[it.id]) {
        if (/^リベ/.test(runTitles[it.id])) {
          // リベ便: 乗車順のとおりに「個別名 / リベ①(リベルタ組) / 個別名」を並べる
          const segs2 = [];
          let placed = false, buf = [];
          (it.userIds || []).forEach((id) => {
            const u = master.users.find((x) => x.id === id);
            if (!u) return;
            if (isLibOn(u, it.kind)) {
              if (buf.length) { segs2.push(wrapJoin(buf, CELL_W)); buf = []; }
              if (!placed) { segs2.push(runTitles[it.id]); placed = true; }
            } else buf.push(nameHome(u, it.kind, it) + trainSfx(it, u, it.kind));
          });
          if (buf.length) segs2.push(wrapJoin(buf, CELL_W));
          if (!placed) segs2.unshift(runTitles[it.id]);
          s += "\n" + segs2.join("\n");
        } else {
          s += "\n" + runTitles[it.id];
        }
      } else if (names.length) s += "\n" + wrapJoin(names, CELL_W);
      const riders = (it.staffRiderIds || []).map((id) => { const x = master.staff.find((y) => y.id === id); return x ? x.name : ""; }).filter(Boolean);
      if (riders.length) {
        // 折返しの行にも「同:」を付ける(読み戻し時に利用者と混同しないため)
        const rl = wrapJoin(riders, CELL_W - 2);
        s += "\n" + rl.split("\n").map((l) => "同:" + l).join("\n");
      }
      if (it.note) s += "\n" + it.note;
      return s;
    }
    // ブロック(ヘルプ・その他予定)。車が付く場合は【ヘルプ】の次の行に車名を出す(名前の途中折返し防止)
    const bveh = resolveVehicle(master, it.vehicleId);
    const bvName = bveh ? shortName(bveh) : "";
    if (it.kind === "help") {
      // 見出し[ヘルプ]と重複するため、ラベル末尾の「ヘルプ」は出力しない(黒田ヘルプ→黒田)
      const lbl = (String(it.label || "").replace(/ヘルプ$/, "").trim() || it.label) + (it.note ? `(${it.note})` : "");
      // ヘルプ車なしのシートでは車名の行を出さない(利用者に渡す用)
      return `[ヘルプ]${bvName && !hideHelpVeh ? "\n" + bvName : ""}\n${lbl}`;
    }
    // 予定はラベルのみ(印なし)
    return `${bvName ? bvName + "\n" : ""}${it.label}`;
  };
  const cellMap = {};
  const put = (sid, time, txt, rank, ord, ownRank = 1) => {
    const t = toMin(time);
    if (t == null) return;
    const slot = Math.max(GRID_START, Math.min(GRID_END - SLOT, Math.floor(t / SLOT) * SLOT));
    const k = `${colKey(sid)}:${slot}`;
    (cellMap[k] = cellMap[k] || []).push({ t: txt, k: rank, o: ord, tm: time, slot, oc: ownRank });
  };
  // 同じセル内の表示順。アプリ画面(TimeGrid)と同じ規則にする:
  //  ①自車ランク(午前の自車→通常→午後の自車) ②ord(手動並べ替え) ③種類ランク(ordが無い場合の保険)
  const RANK = { meet: 0, send: 1, other_run: 1.5, help: 2, own_move: 3, block: 4 };
  const ownCarRankOf = (item) => {
    const isOwn = /自車/.test(item.label || "") || String(item.vehicleId || "").startsWith("own:");
    if (!isOwn) return 1;
    const t = toMin(item.time);
    return t != null && t >= 12 * 60 ? 2 : 0;
  };
  sheet.runs.forEach((r) => put(r.staffId, r.time, itemText(r, true), RANK[r.kind] != null ? RANK[r.kind] : 1, r.ord, ownCarRankOf(r)));
  // 同乗職員の欄にも「〇〇便に同乗」を出す
  sheet.runs.forEach((r) => (r.staffRiderIds || []).forEach((rid) => {
    const st2 = master.staff.find((s) => s.id === r.staffId);
    put(rid, r.time, `${st2 ? st2.name : ""}便に同乗`, (RANK[r.kind] != null ? RANK[r.kind] : 1) + 0.05, r.ord != null ? r.ord + 0.05 : null, ownCarRankOf(r));
  }));
  sheet.blocks.forEach((b) => put(b.staffId, b.time, itemText(b, false), b.kind === "help" ? RANK.help : RANK.block, b.ord, ownCarRankOf(b)));
  // 予定がある時間の範囲を求め、その範囲を30分刻みで全て行にする(8:00と8:30は別の行)
  const HOUR = 60;
  let minT = null, maxT = null;
  for (let m = GRID_START; m < GRID_END; m += SLOT) {
    if (cols.some((s) => cellMap[`${s.id}:${m}`]) || cellMap[`${HOLD_ID}:${m}`]) {
      if (minT == null) minT = m;
      maxT = m;
    }
  }
  if (minT == null) { minT = 8 * 60; maxT = 17 * 60; }
  const startHour = Math.floor(minT / HOUR) * HOUR;
  const endHour = Math.ceil((maxT + SLOT) / HOUR) * HOUR;
  const usedSlots = [];
  for (let m = startHour; m < endHour; m += SLOT) usedSlots.push(m);
  // セルは30分スロットのまま使う(まとめない)
  const cellMapH = cellMap;

  const wb = opts.wb || new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName || "送迎表", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1, // 1ページに収める(縦の行高で用紙を埋めつつ収まる)
      horizontalCentered: true,
      verticalCentered: false,
      margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0.1, footer: 0.1 },
    },
    views: [{ showGridLines: false }],
  });

  // 列幅
  const COLW = 11;
  ws.getColumn(1).width = 8.5;
  for (let i = 0; i < cols.length; i++) ws.getColumn(2 + i).width = COLW;
  if (hasHold) ws.getColumn(2 + cols.length).width = COLW + 1;

  const thin = { style: "thin", color: { argb: "FF808080" } };
  const faint = { style: "hair", color: { argb: "FFD8D8D8" } }; // ごく薄い線
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
  const SIDE_ONLY = { left: thin, right: thin }; // 縦線のみ(時間の横区切りを消す)
  const setCell = (row, col, value, opt = {}) => {
    const c = ws.getCell(row, col);
    c.value = typeof value === "string" ? toHankakuKana(value) : value;
    c.font = { name: "Yu Gothic", size: opt.size || 11, bold: true, color: opt.color ? { argb: opt.color } : undefined };
    c.alignment = { vertical: opt.vAlign || "top", horizontal: opt.hAlign, wrapText: true };
    if (opt.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opt.fill } };
    if (opt.sideOnly) c.border = SIDE_ONLY;
    else if (!opt.noBorder) c.border = BORDER;
    return c;
  };
  const borderRange = (row, from, to) => { for (let cc = from; cc <= to; cc++) ws.getCell(row, cc).border = BORDER; };
  // 行の高さ見積り(折り返しを考慮):colWidth幅に全角charsChars文字が入る想定
  const dispW = (s) => [...String(s)].reduce((a, ch) => a + (/[\uFF61-\uFF9F\x20-\x7E]/.test(ch) ? 0.5 : 1), 0);
  const calcLines = (txt, chars) =>
    txt ? txt.split("\n").reduce((a, l) => a + Math.max(1, Math.ceil(dispW(l) / Math.max(2, chars))), 0) : 1;
  const CHARS_PER_COL = 4.9; // 幅11・12pt太字でおよそ全角4.9文字
  const LINE_H = 18.5;
  const segChars = (from, to) => Math.max(4, Math.floor(((to - from + 1) * COLW) / 3.0));

  let r = 1;
  // 月日行(左端ラベル+日付)
  setCell(r, 1, "月日", { bold: true, fill: HEADBG, hAlign: "center", vAlign: "middle" });
  ws.mergeCells(r, 2, r, Math.max(2, nCols));
  setCell(r, 2, `${date}(${DAYS[wd]})`, { size: 13, bold: true, vAlign: "middle" });
  borderRange(r, 2, Math.max(2, nCols));
  ws.getRow(r).height = 15;
  r++;

  // 部署行(同一部署はセル結合。リベルタ職員は兼務先ごとに分け、最上部にその日の兼務先を表示)
  setCell(r, 1, "部署", { bold: true, fill: HEADBG, hAlign: "center", vAlign: "middle" });
  {
    const isLibDept = (id) => { const d = master.departments.find((x) => x.id === id); return !!d && /リベルタ|その他|他$/.test(d.name); };
    // 当日の部署変更 > 曜日別の勤務先(八壁=金あいのて等) > 所属。
    // 以前は曜日別を優先していたため、当日「あいのて→川津」に変えてもExcelだけ旧部署のままになっていた。
    // アプリ画面・人数集計と同じ belongDeptOf に統一する。
    const effDept = (s) => belongDeptOf(master, s, wd);
    const bandKey = (s) => effDept(s) + "|" + (isLibDept(s.deptId) ? subDeptOf(s, wd) : "") + "|" + (isOff(s) ? 1 : 0);
    let anyTwoLine = false;
    let i = 0;
    while (i < cols.length) {
      let j = i;
      while (j + 1 < cols.length && bandKey(cols[j + 1]) === bandKey(cols[i])) j++;
      const from = 2 + i, to = 2 + j;
      if (to > from) ws.mergeCells(r, from, r, to);
      let label = deptName(effDept(cols[i])) + (isOff(cols[i]) ? "(休み)" : "");
      const subId2 = isLibDept(cols[i].deptId) ? subDeptOf(cols[i], wd) : "";
      const sub = subId2 ? master.departments.find((d) => d.id === subId2) : null;
      if (sub) { label += "\n→" + sub.name; anyTwoLine = true; }
      setCell(r, from, label, {
        bold: true, fill: isOff(cols[i]) ? GRAY : argbOf(effDept(cols[i])), hAlign: "center", vAlign: "middle", size: sub ? 9 : 11,
      });
      borderRange(r, from, to);
      i = j + 1;
    }
    if (hasHold) setCell(r, 2 + cols.length, "保留", { bold: true, fill: HOLDBG, hAlign: "center", vAlign: "middle" });
    ws.getRow(r).height = anyTwoLine ? 28 : 20;
  }
  r++;

  // 形態行
  setCell(r, 1, "形態", { size: 9, fill: HEADBG, hAlign: "center", vAlign: "middle" });
  cols.forEach((s, i) => {
    setCell(r, 2 + i, s.emp || "", { size: 9, hAlign: "center", fill: isOff(s) ? GRAY : undefined, color: "FF57534E" });
  });
  if (hasHold) setCell(r, 2 + cols.length, "", { fill: HOLDBG });
  ws.getRow(r).height = 15;
  r++;

  // 職位行(「管理者・サビ管」→「管理者/サビ管」の縦2行表記にして列幅を節約)
  setCell(r, 1, "職位", { size: 9, fill: HEADBG, hAlign: "center", vAlign: "middle" });
  const roleWrap = (p) => String(p || "").replace(/[・･]/g, "\n");
  let maxRoleLines = 1;
  cols.forEach((s, i) => {
    const t = roleWrap(s.position);
    maxRoleLines = Math.max(maxRoleLines, t ? t.split("\n").length : 1);
    setCell(r, 2 + i, t, { size: 9, hAlign: "center", vAlign: "middle", fill: isOff(s) ? GRAY : undefined, color: "FF57534E" });
  });
  if (hasHold) setCell(r, 2 + cols.length, "担当未定", { size: 9, hAlign: "center", fill: HOLDBG });
  ws.getRow(r).height = 13 * maxRoleLines + 3;
  r++;

  // 氏名行
  setCell(r, 1, "氏名", { bold: true, fill: HEADBG, hAlign: "center", vAlign: "middle" });
  cols.forEach((s, i) => {
    const off = isOff(s);
    setCell(r, 2 + i, s.name + (off ? "(休)" : "") + (fxOff(s) && wToday(s) ? "(休出)" : ""), {
      bold: true, size: 11, fill: off ? GRAY : undefined, color: off ? "FF78716C" : undefined, hAlign: "center", vAlign: "middle",
    });
  });
  if (hasHold) setCell(r, 2 + cols.length, "―", { bold: true, fill: HOLDBG, hAlign: "center", vAlign: "middle" });
  ws.getRow(r).height = 20;
  r++;

  // 時間行(縦3行表示: 開始 / 〜 / 終了。列幅を狭くするため)
  setCell(r, 1, "時間", { size: 9, fill: HEADBG, hAlign: "center", vAlign: "middle" });
  cols.forEach((s, i) => {
    const o = ov[s.id] || {};
    const txt = o.off ? "休み" : `${o.start || s.start}〜\n${o.end || s.end}` + (o.note ? `\n${o.note}` : "");
    setCell(r, 2 + i, txt, { size: 9, hAlign: "center", vAlign: "middle", fill: o.off ? GRAY : undefined, color: o.start || o.end || o.note ? "FFB45309" : "FF57534E" });
  });
  if (hasHold) setCell(r, 2 + cols.length, "要再\n割当", { size: 9, hAlign: "center", vAlign: "middle", fill: HOLDBG });
  ws.getRow(r).height = 29;
  r++;

  // ---- タイムグリッド(行高: 均等+必要な行だけ拡大) ----
  const PAGE_H = 900; // 実測調整値
  const usedAbove = 110;
  const estBelow = 470; // 下段まとめの見積もり
  const gridBudget = Math.max(200, PAGE_H - usedAbove - estBelow);
  const MIN_ROW = 12;
  const baseH = Math.max(MIN_ROW, gridBudget / Math.max(1, usedSlots.length));
  // セルの内容が多い場合、直下のスロットが空いていれば2マス分に縦マージして流し込む
  const colIds = [...cols.map((s) => s.id), ...(hasHold ? [HOLD_ID] : [])];
  const linesOf = (cid, m) => {
    const items = cellMapH[`${cid}:${m}`] || [];
    return items.length ? calcLines(toHankakuKana(items.map((x) => x.t).join("\n")), CHARS_PER_COL) : 0;
  };
  const spill = {}; // `${cid}:${m}` -> true(下スロットへ縦マージする)
  usedSlots.forEach((m, i) => {
    const next = usedSlots[i + 1];
    colIds.forEach((cid) => {
      const ln = linesOf(cid, m);
      if (ln >= 3 && next != null && linesOf(cid, next) === 0 && !spill[`${cid}:${usedSlots[i - 1]}`]) {
        spill[`${cid}:${m}`] = true;
      }
    });
  });
  // ※ 以前はここで「上下スロットの内容を1つのセルにまとめる」処理を行っていたが、
  //   まとめると下スロットの便・予定の時刻が上スロットの時刻として取り込まれてしまうため廃止。
  //   各スロットは自分の行に出す(行の高さは内容に応じて自動で広がる)。
  const needH = usedSlots.map((m, i) => {
    let maxH = 0;
    colIds.forEach((cid) => {
      const ln = linesOf(cid, m);
      if (ln) {
        const total = ln * 20 + 2;
        // 下に流し込む場合は半分ずつ(このスロットの負担は半分)
        maxH = Math.max(maxH, spill[`${cid}:${m}`] ? Math.ceil(total / 2) : total);
      }
      // 上のスロットから流れ込んでいる分の負担
      const prev = usedSlots[i - 1];
      if (prev != null && spill[`${cid}:${prev}`]) {
        maxH = Math.max(maxH, Math.ceil((linesOf(cid, prev) * 20 + 2) / 2));
      }
    });
    return maxH;
  });
  usedSlots.forEach((m, i) => {
    setCell(r, 1, m % 60 === 0 ? toStr(m) : "", { bold: true, size: 11, fill: TIMEBG, hAlign: "right", vAlign: "top", sideOnly: true });
    const prevM = usedSlots[i - 1];
    cols.forEach((s, i2) => {
      if (prevM != null && spill[`${s.id}:${prevM}`]) return; // 上のセルの縦マージ範囲なので触らない
      const items = (cellMapH[`${s.id}:${m}`] || []).slice().sort((a, b) => ((a.oc != null ? a.oc : 1) - (b.oc != null ? b.oc : 1)) || ((a.o != null ? a.o : 999) - (b.o != null ? b.o : 999)) || (a.k - b.k));
      if (spill[`${s.id}:${m}`]) { try { ws.mergeCells(r, 2 + i2, r + 1, 2 + i2); } catch (e) {} }
      setCell(r, 2 + i2, items.map((x) => x.t).join("\n"), { fill: isOff(s) ? "FFF5F5F4" : undefined, sideOnly: true, size: 12 });
    });
    if (hasHold) {
      if (!(prevM != null && spill[`${HOLD_ID}:${prevM}`])) {
        const items = (cellMapH[`${HOLD_ID}:${m}`] || []).slice().sort((a, b) => ((a.oc != null ? a.oc : 1) - (b.oc != null ? b.oc : 1)) || ((a.o != null ? a.o : 999) - (b.o != null ? b.o : 999)) || (a.k - b.k));
        if (spill[`${HOLD_ID}:${m}`]) { try { ws.mergeCells(r, 2 + cols.length, r + 1, 2 + cols.length); } catch (e) {} }
        setCell(r, 2 + cols.length, items.map((x) => x.t).join("\n"), { fill: HOLDBG, sideOnly: true, size: 12 });
      }
    }
    ws.getRow(r).height = Math.max(baseH, needH[i]);
    r++;
  });

  // 空行
  ws.getRow(r).height = 6;
  r++;

  // ---- 下部まとめ:部署が横並び+右に特記エリア ----
  const YELLOW = "FFFEF08A";
  const { userNotes, bizNotes } = buildAutoNotes(master, sheet.blocks);
  const manualNoteLines = [];
  if ((sheet.notes || "").trim()) sheet.notes.trim().split("\n").forEach((l) => l && manualNoteLines.push(l));
  const autoNoteLines = [...userNotes];
  const contactLines = [];
  if ((sheet.contact || "").trim()) sheet.contact.trim().split("\n").forEach((l) => l && contactLines.push(l));
  // 連絡事項には施錠・開錠・透析・退勤・受入・車両交換・薬セットは載せない(グリッドの予定枠に出ているため)
  const CONTACT_SKIP = /(施錠|開錠|解錠|透析|退勤|受入|交換|薬)/;
  bizNotes.forEach((l) => { if (!CONTACT_SKIP.test(String(l))) contactLines.push(l); });
  // AI調整の記録(反映後・未確認のもの)。画面の「確認済み」ボタンで消すとここにも出なくなる
  if ((sheet.aiLog || "").trim()) {
    contactLines.push("【AI調整の記録】");
    sheet.aiLog.trim().split("\n").forEach((l) => l && contactLines.push(l));
  }
  const trainingLines = String(sheet.training || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const deptsUsed = master.departments.filter((d) =>
    !/リベルタ|その他|他$/.test(d.name) &&
    (master.users.some((u) => u.deptId === d.id) || byDept.some((s) => s.deptId === d.id) || master.vehicles.some((v) => v.deptId === d.id)));
  const dataStart = 2, dataEnd = Math.max(3, nCols);
  const dataCols = dataEnd - dataStart + 1;
  const noteW = Math.min(Math.max(6, Math.floor(dataCols * 0.38)), Math.max(2, dataCols - deptsUsed.length * 2));
  const deptArea = Math.max(deptsUsed.length, dataCols - noteW);
  const per = Math.max(1, Math.floor(deptArea / Math.max(1, deptsUsed.length)));
  const segs = deptsUsed.map((d, i) => ({
    d,
    from: dataStart + i * per,
    to: i === deptsUsed.length - 1 ? dataStart + deptArea - 1 : dataStart + (i + 1) * per - 1,
  }));
  const noteFrom = dataStart + deptArea, noteTo = dataEnd;
  const hasNote = noteTo >= noteFrom;
  // 送迎(タイトル便)の一覧はグリッド直下の全幅枠に出す
  const bigRuns = sheet.runs.filter((r2) => runTitles[r2.id]).sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0));
  const libHelp2 = makeLibNameHelpers(sheet, weekdayOf(date));
  const bigRunLines = bigRuns.map((r2) => {
    const veh = resolveVehicle(master, r2.vehicleId);
    // リベ迎・リベ送・あい迎などリベルタ発着の便は、リベルタ発着の人だけを印字する
    // (自宅組の同乗者はグリッド側のチップに「+名前」で出るため、二重表示を防ぐ)
    const isLibTitle = /^リベ/.test(runTitles[r2.id] || "");
    const names = (r2.userIds || [])
      .map((id) => master.users.find((x) => x.id === id))
      .filter((u) => !!u)
      .filter((u) => !isLibTitle || ((u.libertaAM || u.libertaPM) && libHelp2.isLibOn(u, r2.kind === "send" ? "send" : "meet")))
      .map((u) => nameHome(u, r2.kind, r2) + trainSfx(r2, u, r2.kind));
    return `${runTitles[r2.id]}(${r2.time}${veh ? " " + (veh.own ? veh.name : (makeVehShortMap(master.vehicles)[veh.id] || veh.name)) : ""})${names.length ? " " + names.join("・") : ""}`;
  });
  const mergeSet = (row, from, to, val, opt) => {
    if (to > from) ws.mergeCells(row, from, row, to);
    setCell(row, from, val, opt || {});
    borderRange(row, from, to);
  };

  const sectionRows = (label, rightHeader, textOf, countOf, rightText) => {
    const hr = r, cr = r + 1;
    ws.mergeCells(hr, 1, cr, 1);
    setCell(hr, 1, label, { bold: true, size: 10, fill: HEADBG, hAlign: "center", vAlign: "middle" });
    ws.getCell(cr, 1).border = BORDER;
    segs.forEach(({ d, from, to }) => {
      const cnt = countOf ? countOf(d.id) : null;
      mergeSet(hr, from, to, d.name + (cnt != null ? `(${cnt}${typeof cnt === "number" ? "名" : ""})` : ""), { bold: true, fill: argbOf(d.id), hAlign: "center", vAlign: "middle" });
    });
    const panels = Array.isArray(rightText) && rightText.length && typeof rightText[0] === "object" && rightText[0] !== null && "header" in rightText[0]
      ? rightText
      : (rightHeader != null ? [{ header: rightHeader, lines: Array.isArray(rightText) ? rightText : String(rightText || "").split("\n").filter((x) => x !== "") }] : []);
    const panelRanges = [];
    if (hasNote && panels.length) {
      const total = noteTo - noteFrom + 1;
      if (panels.length >= 2) {
        const weights = panels.map((p) => p.w || 1);
        const wsum = weights.reduce((a, b) => a + b, 0);
        let cur = noteFrom;
        panels.forEach((p, pi) => {
          const w = pi === panels.length - 1
            ? Math.max(1, noteTo - cur + 1)
            : Math.max(2, Math.round(total * weights[pi] / wsum));
          panelRanges.push([cur, Math.min(noteTo, cur + w - 1)]);
          cur += w;
        });
      } else panelRanges.push([noteFrom, noteTo]);
      panels.forEach((p, pi) => {
        if (!panelRanges[pi]) return;
        mergeSet(hr, panelRanges[pi][0], panelRanges[pi][1], p.header, { bold: true, fill: YELLOW, hAlign: "center", vAlign: "middle" });
      });
    }
    ws.getRow(hr).height = 15;
    let maxL = 1;
    segs.forEach(({ d, from, to }) => {
      const txt = textOf(d.id) || "";
      maxL = Math.max(maxL, calcLines(toHankakuKana(txt), segChars(from, to)));
      mergeSet(cr, from, to, txt, {});
    });
    if (hasNote && panels.length) {
      panels.forEach((p, pi) => {
        if (!panelRanges[pi]) return;
        const [pf, pt] = panelRanges[pi];
        const lines = p.lines || [];
        const noteColsTotal = pt - pf + 1;
        // 1チャンクに最低3列(約10文字)を確保して、細かい分割による折返し倍増を防ぐ
        let ncol = 1;
        const maxCol = Math.max(1, Math.floor(noteColsTotal / 3));
        if (lines.length > 4) ncol = Math.min(3, maxCol);
        else if (lines.length > 2) ncol = Math.min(2, maxCol);
        ncol = Math.max(1, Math.min(ncol, noteColsTotal));
        const perCol = Math.ceil(lines.length / ncol) || 1;
        const colW = Math.floor(noteColsTotal / ncol);
        for (let ci = 0; ci < ncol; ci++) {
          const cf = pf + ci * colW;
          const ct = ci === ncol - 1 ? pt : cf + colW - 1;
          const chunk = lines.slice(ci * perCol, (ci + 1) * perCol).join("\n");
          maxL = Math.max(maxL, calcLines(toHankakuKana(chunk), segChars(cf, ct)));
          mergeSet(cr, cf, ct, chunk, {});
        }
        for (let cc = pf; cc <= pt; cc++) {
          ws.getCell(cr, cc).border = {
            top: thin, bottom: thin,
            left: cc === pf ? thin : undefined,
            right: cc === pt ? thin : undefined,
          };
        }
      });
    }
    ws.getRow(cr).height = Math.max(17, maxL * LINE_H + 2);
    r = cr + 1;
  };

  // 全幅の1枠(左ラベル+全幅テキスト)
  const mergedChars = Math.max(10, Math.floor(((nCols - 1) * COLW) / 3.0));
  const secRow = (label, text, fill) => {
    setCell(r, 1, label, { bold: true, size: 9, fill: fill || HEADBG, hAlign: "center", vAlign: "middle" });
    const to = Math.max(2, nCols);
    if (to > 2) ws.mergeCells(r, 2, r, to);
    setCell(r, 2, text, {});
    borderRange(r, 2, to);
    const lines = Math.max(calcLines(toHankakuKana(text), mergedChars), Math.ceil(label.length / 3));
    ws.getRow(r).height = Math.max(18, lines * LINE_H + 3);
    r++;
  };

  // ---- ゾーン: 送迎(左・3列) / 特記事項(利用者)=右端の縦長枠(送迎〜利用者をまたぐ) ----
  const noRideMap = sheet.noRide || {};
  // 送迎なしの利用者は1人1行で「名前(迎え理由、送り理由)」に統合
  const noRideLines = master.users
    .filter((u) => (u.days || []).includes(wd) && !absent[u.id] && ((noRideMap[u.id] || {}).meet || (noRideMap[u.id] || {}).send))
    .map((u) => {
      const nr = noRideMap[u.id] || {};
      const parts = [nr.meet, nr.send].filter(Boolean);
      return `${u.name}(${parts.join("、")})`;
    });
  const libOnLines = master.users
    .filter((u) => (u.days || []).includes(wd) && !absent[u.id] && ((libOnMap[u.id] || {}).am || (libOnMap[u.id] || {}).pm))
    .map((u) => { const o = libOnMap[u.id]; return `${u.name}(${[o.am ? "朝" : "", o.pm ? "夕" : ""].filter(Boolean).join("・")})`; });
  const libOffLines = master.users
    .filter((u) => (u.days || []).includes(wd) && !absent[u.id] && ((libOffMap[u.id] || {}).am || (libOffMap[u.id] || {}).pm))
    .map((u) => { const o = libOffMap[u.id]; return `${u.name}(${[o.am ? "朝" : "", o.pm ? "夕" : ""].filter(Boolean).join("・")})`; });
  const userTimeMap = sheet.userTime || {};
  // 迎えの時間は表(Excel)には明記しない方針のため、送りの変更のみ記載する(迎えはアプリ内の警告・吹き出しでのみ使用)
  const timeChangeLines = master.users
    .filter((u) => (u.days || []).includes(wd) && !absent[u.id] && userTimeMap[u.id] && userTimeMap[u.id].send)
    .map((u) => { const t = userTimeMap[u.id]; return `${u.name}(送${t.send})`; });
  const absentNoteLines = master.users
    .filter((u) => (u.days || []).includes(wd) && absent[u.id])
    .map((u) => u.name);
  const noteLines2 = [
    ...(absentNoteLines.length ? ["■欠席", absentNoteLines.join("・")] : []),
    ...(timeChangeLines.length ? ["■利用時間変更", ...timeChangeLines] : []),
    ...(libOnLines.length ? ["■リベルタ泊あり(臨時)", ...libOnLines] : []),
    ...(libOffLines.length ? ["■リベルタ泊なし", ...libOffLines] : []),
    ...(noRideLines.length ? ["■送迎なし", ...noRideLines] : []),
    ...manualNoteLines,
    ...((noRideLines.length || manualNoteLines.length) && autoNoteLines.length ? ["────"] : []),
    ...autoNoteLines,
  ];
  const zoneTop = r;
  const leftEnd = noteFrom - 1; // 左側(送迎・部署)の右端
  const hasSogei = bigRunLines.length > 0;
  if (hasSogei) {
    // 送迎ヘッダー(左)+特記ヘッダー(右)を同じ行に
    mergeSet(zoneTop, 1, leftEnd, "送迎", { bold: true, fill: YELLOW, hAlign: "center", vAlign: "middle" });
    if (hasNote) mergeSet(zoneTop, noteFrom, noteTo, "特記事項(利用者)", { bold: true, fill: YELLOW, hAlign: "center", vAlign: "middle" });
    ws.getRow(zoneTop).height = 15;
    r++;
    // 送迎内容(左側を3列)
    const ncol2 = bigRunLines.length > 6 ? 3 : bigRunLines.length > 3 ? 2 : 1;
    const perCol2 = Math.ceil(bigRunLines.length / ncol2);
    const colW2 = Math.floor(leftEnd / ncol2);
    let maxL2 = 1;
    for (let ci = 0; ci < ncol2; ci++) {
      const cf = 1 + ci * colW2;
      const ct = ci === ncol2 - 1 ? leftEnd : cf + colW2 - 1;
      const chunk = bigRunLines.slice(ci * perCol2, (ci + 1) * perCol2).join("\n");
      maxL2 = Math.max(maxL2, calcLines(toHankakuKana(chunk), segChars(cf, ct)));
      if (ct > cf) ws.mergeCells(r, cf, r, ct);
      setCell(r, cf, chunk, { vAlign: "top" });
      // 結合セルは親セル1回だけに罫線を設定する(2列目以降への代入は親を上書きしてleftが消えるため)
      ws.getCell(r, cf).border = {
        top: thin, bottom: thin,
        left: thin,
        right: ci === ncol2 - 1 ? thin : undefined,
      };
    }
    ws.getRow(r).height = Math.max(17, maxL2 * LINE_H + 2);
    r++;
  }

  // ---- 利用者(左:部署のみ) ----
  const uHr = r, uCr = r + 1;
  setCell(uHr, 1, "利用者", { bold: true, size: 12, fill: HEADBG, hAlign: "center", vAlign: "middle" });
  ws.mergeCells(uHr, 1, uCr, 1);
  ws.getCell(uCr, 1).border = BORDER;
  {
    let maxLu = 1;
    segs.forEach(({ d, from, to }) => {
      const list = master.users.filter((u) => u.deptId === d.id && !absent[u.id] && (u.days || []).includes(wd));
      mergeSet(uHr, from, to, `${d.name}(${list.length}名)`, { bold: true, fill: argbOf(d.id), hAlign: "center", vAlign: "middle" });
      const txt = list.map((u) => u.name + (u.wheelchair ? "(車)" : "")).join("・");
      maxLu = Math.max(maxLu, calcLines(toHankakuKana(txt), segChars(from, to)));
      mergeSet(uCr, from, to, txt, {});
    });
    if (!hasSogei && hasNote) mergeSet(uHr, noteFrom, noteTo, "特記事項(利用者)", { bold: true, fill: YELLOW, hAlign: "center", vAlign: "middle" });
    ws.getRow(uHr).height = 15;
    ws.getRow(uCr).height = Math.max(17, maxLu * LINE_H + 2);
  }
  r = uCr + 1;

  // ---- 休み(欠席の利用者): 利用者行の直下・部署ごとに表示 ----
  const absRow = r;
  {
    setCell(absRow, 1, "休み", { bold: true, size: 11, fill: GRAY, hAlign: "center", vAlign: "middle" });
    ws.getCell(absRow, 1).border = BORDER;
    let maxLa = 1;
    segs.forEach(({ d, from, to }) => {
      const list = master.users.filter((u) => u.deptId === d.id && absent[u.id] && (u.days || []).includes(wd));
      const txt = list.map((u) => u.name).join("・");
      maxLa = Math.max(maxLa, calcLines(toHankakuKana(txt), segChars(from, to)));
      mergeSet(absRow, from, to, txt, { fill: GRAY });
    });
    ws.getRow(absRow).height = Math.max(15, maxLa * LINE_H + 2);
  }
  r = absRow + 1;

  // ---- 特記事項の内容: 右端の縦長枠(送迎内容行〜利用者内容行を縦マージ・2カラム) ----
  if (hasNote) {
    const cTop = hasSogei ? zoneTop + 1 : uCr;
    const cBottom = absRow; // 休み行まで含めて縦にマージ
    const totalN = noteTo - noteFrom + 1;
    const maxColN = Math.max(1, Math.floor(totalN / 3));
    const ncolN = Math.max(1, Math.min(noteLines2.length > 6 ? 2 : 1, maxColN));
    const perN = Math.ceil(noteLines2.length / ncolN) || 1;
    const colWN = Math.floor(totalN / ncolN);
    let needN = 0;
    const chunksN = [];
    for (let ci = 0; ci < ncolN; ci++) {
      const cf = noteFrom + ci * colWN;
      const ct = ci === ncolN - 1 ? noteTo : cf + colWN - 1;
      const chunk = noteLines2.slice(ci * perN, (ci + 1) * perN).join("\n");
      chunksN.push([cf, ct, chunk]);
      needN = Math.max(needN, calcLines(toHankakuKana(chunk), segChars(cf, ct)) * LINE_H + 3);
    }
    let acc = 0;
    for (let rr = cTop; rr <= cBottom; rr++) acc += ws.getRow(rr).height || 17;
    if (acc < needN) ws.getRow(uCr).height = (ws.getRow(uCr).height || 17) + (needN - acc);
    chunksN.forEach(([cf, ct, chunk]) => {
      if (cBottom > cTop || ct > cf) ws.mergeCells(cTop, cf, Math.max(cTop, cBottom), ct);
      setCell(cTop, cf, chunk, { vAlign: "top" });
    });
    for (let rr = cTop; rr <= cBottom; rr++) {
      for (let cc = noteFrom; cc <= noteTo; cc++) {
        ws.getCell(rr, cc).border = {
          top: rr === cTop ? thin : undefined,
          bottom: rr === cBottom ? thin : undefined,
          left: cc === noteFrom ? thin : undefined,
          right: cc === noteTo ? thin : undefined,
        };
      }
    }
  }

  // ---- 職員 / 連絡事項+訓練 ----
  const allStaffToday = master.staff.filter((s) => !s.hideInStaffList && (!fxOff(s) || wToday(s)));
  const deptMembers = (deptId) => allStaffToday.filter((s) =>
    (s.deptId === deptId || belongDeptOf(master, s, wd) === deptId) && !((ov[s.id] || {}).off));
  const effShiftRank = (s) => {
    const o = ov[s.id] || {};
    const st = o.start || ((s.shiftByDay || {})[wd] || {}).start || s.start;
    return shiftRank({ start: st });
  };
  const staffCountOf = (deptId) => {
    const ms = deptMembers(deptId);
    const am = ms.filter((s) => effShiftRank(s) !== 2).length;
    const pm = ms.filter((s) => effShiftRank(s) !== 1).length;
    return `${am}→${pm}`;
  };
  sectionRows(
    "職員",
    null,
    (deptId) => {
      const deco = (s) => s.name + (fxOff(s) && wToday(s) ? "(休出)" : "");
      const isOffToday = (s) => !!((ov[s.id] || {}).off);
      // 元リベルタの職員(当日部署変更◆で移動して来た人も含む)は、日勤の名簿ではなく「早:/遅:」の分類側に入れる
      const libId = (master.departments.find((d) => /リベルタ/.test(d.name)) || {}).id;
      const fromLib = (s) => s.deptId === libId || s.baseDeptId === libId;
      const own = allStaffToday.filter((s) => (((s.deptByDay || {})[wd]) || s.deptId) === deptId && !isOffToday(s) && (deptId === libId || !fromLib(s)));
      const subs = allStaffToday.filter((s) => deptId !== libId && fromLib(s) && belongDeptOf(master, s, wd) === deptId && !isOffToday(s));
      const subDay = subs.filter((s) => effShiftRank(s) === 0);
      const early = subs.filter((s) => effShiftRank(s) === 1).map(deco).join("・");
      const late = subs.filter((s) => effShiftRank(s) === 2).map(deco).join("・");
      const el = [early ? "早:" + early : "", late ? "遅:" + late : ""].filter(Boolean).join(" ");
      return [
        [...own.filter((s) => s.emp !== "パート"), ...subDay].map(deco).join("・"),
        own.filter((s) => s.emp === "パート").map(deco).join("・"),
        el,
      ].filter(Boolean).join("\n");
    },
    staffCountOf,
    [{ header: "連絡事項", lines: contactLines }, { header: "特記事項(職員)", lines: String(sheet.notesStaff || "").split("\n").filter(Boolean) }, { header: "訓練", lines: trainingLines }]
  );

  // ---- 配車 / パート職員 ----
  // 当日休み(パート出欠パネルで休みにした人)は載せない
  const partList = master.staff.filter((s) => s.emp === "パート" && !s.hideInPartList && (!fxOff(s) || wToday(s)) && !((ov[s.id] || {}).off))
    .map((s) => `${s.name} ${s.start}〜${s.end}`);
  sectionRows(
    "配車",
    "パート職員",
    (deptId) => master.vehicles.filter((v) => v.deptId === deptId).map((v) => v.name).join("・"),
    null,
    partList
  );

  // ---- 欠席・備考(全幅) ----
  const absentNames = master.users.filter((u) => absent[u.id]).map((u) => u.name);

  const anyMoved = cols.some((s) => s.baseDeptId);
  // ◆印はExcelでは使用しない(列の部署帯で当日の勤務先が分かるため)

  // ---- どの版で出したか(表の一番下と、印刷したときの右上) ----
  {
    const ver = appVerLabel();
    const vr = ws.rowCount + 2;
    ws.mergeCells(vr, 1, vr, nCols);
    const vc = ws.getCell(vr, 1);
    vc.value = `出力: 送迎表 ${ver}　${EDITION_LABEL}　${date}(${DAYS[wd]})`;
    vc.font = { name: "Yu Gothic", size: 9, color: { argb: "FF78716C" } };
    vc.alignment = { horizontal: "right", vertical: "middle" };
    ws.headerFooter = { oddHeader: `&R&8送迎表 ${ver.replace(/&/g, "&&")}` };
  }

  // ---- 第2シート: 車両の動き(各部署にどの車がいつ残っているか) ----
  // ※ ヘルプ車なしシートを作る2回目の呼び出しでは作らない(同じシートが二重にできるため)
  if (!opts.gridOnly) {
    const ws2 = wb.addWorksheet("車両の動き", {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1,
        margins: { left: 0.25, right: 0.25, top: 0.6, bottom: 0.3, header: 0.1, footer: 0.1 } },
    });
    const set2 = (row, col, value, opt = {}) => {
      const c = ws2.getCell(row, col);
      c.value = typeof value === "string" ? toHankakuKana(value) : value;
      c.font = { name: "Yu Gothic", size: opt.size || 12, bold: true, color: opt.color ? { argb: opt.color } : undefined };
      c.alignment = { vertical: opt.vAlign || "top", horizontal: opt.hAlign || "left", wrapText: true };
      if (opt.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opt.fill } };
      c.border = BORDER;
    };
    const vehDepts = master.departments.filter((d) => master.vehicles.some((v) => v.deptId === d.id));
    const posAt = simulateVehicles(master, sheet, usedSlots);
    // 描画
    let r2 = 1;
    ws2.mergeCells(r2, 1, r2, 1 + vehDepts.length);
    set2(r2, 1, `車両の動き ${date}(${DAYS[wd]}) — 各部署に残っている車`, { size: 13, hAlign: "center", vAlign: "middle" });
    ws2.getRow(r2).height = 20;
    r2++;
    set2(r2, 1, "時刻", { size: 10, fill: HEADBG, hAlign: "center", vAlign: "middle" });
    vehDepts.forEach((d, i) => set2(r2, 2 + i, d.name, { fill: argbOf(d.id), hAlign: "center", vAlign: "middle" }));
    ws2.getRow(r2).height = 18;
    r2++;
    ws2.getColumn(1).width = 7;
    vehDepts.forEach((d, i) => { ws2.getColumn(2 + i).width = 26; });
    usedSlots.forEach((s2) => {
      set2(r2, 1, s2 % 60 === 0 ? toStr(s2) : "", { size: 10, fill: TIMEBG, hAlign: "right", vAlign: "top" });
      vehDepts.forEach((d, i) => {
        const here = master.vehicles.filter((v) => posAt[v.id] && posAt[v.id][s2] === d.id)
          .map((v) => vehShort[v.id] || v.name);
        set2(r2, 2 + i, here.join("・"), {});
      });
      ws2.getRow(r2).height = 20;
      r2++;
    });
  }

  return wb;
}

async function exportExcel(master, sheet, date) {
  try {
    const ExcelJS = await loadExcelJS();
    // 1枚目=通常(ヘルプにも車名あり) / 2枚目=ヘルプの車名だけ消したもの
    const wb = buildWorkbook(ExcelJS, master, sheet, date);
    buildWorkbook(ExcelJS, master, sheet, date, { wb, sheetName: "送迎表(ヘルプ車なし)", hideHelpVeh: true, gridOnly: true });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `送迎表_${dateWithDay(date)}_${appVerLabel()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  } catch (e) {
    console.error(e);
    notify("Excelライブラリの読み込みに失敗したため、簡易形式(.xls)で出力します。", "error");
    downloadExcel(master, sheet, date);
  }
}

/* ============================================================
   共通UI部品
   ============================================================ */
/* ============================================================
   通常外のヘルプ・その他予定(その日だけの予定)の突き合わせ
   sheet.extraHelps = [{ id, kind: "help"|"block", time, userId, note }]
   「通常」= その曜日の週間パターンにある同じ種別の予定(+ヘルプ表の基本担当があるヘルプ)
   ============================================================ */
const EXTRA_KIND_JP = { help: "ヘルプ", block: "その他予定" };
// 名前のうしろに続いてよい区切り(これ以外が続く場合は別人の名前の可能性があるので一致させない)
const NAME_SEP_RE = /^(\s|[・･、,，()（）［］\[\]「」:：/／\-－~〜]|ヘルプ|入浴|家事|通院|トイレ|対応|付き?添い?|送|迎|受診|透析|さん|様|氏)/;
// 予定の時刻+名前を「通常」判定用のキーに(時刻は分に直して比べる)
function extraKeyOf(label, time) {
  const t = toMin(time);
  return `${String(canonHelpLabel(label) || "").trim()}@${t == null ? String(time || "").trim() : t}`;
}
// 予定名がその利用者の名前で始まり、うしろが区切られているか(最長一致の人がその利用者であること)
function labelStartsWithUser(master, label, u) {
  const lb = String(label || "").trim();
  if (!u || !u.name || !lb.startsWith(u.name)) return false;
  const longer = (master.users || []).some((x) => x.id !== u.id && x.name && x.name.length > u.name.length && lb.startsWith(x.name));
  if (longer) return false;
  const rest = lb.slice(u.name.length);
  return rest === "" || NAME_SEP_RE.test(rest);
}
// 予定名から利用者を推定(最長一致+区切りあり)
function userFromLabel(master, label) {
  return [...(master.users || [])].filter((u) => u.name).sort((a, b) => b.name.length - a.name.length)
    .find((u) => labelStartsWithUser(master, label, u)) || null;
}
function extraHelpMatch(master, e, h) {
  const kind = (e && e.kind) || "help";
  if (!e || !h || h.kind !== kind) return false;
  if (e.time && toMin(e.time) != null && toMin(h.time) !== toMin(e.time)) return false;
  if (e.userId) {
    // 予定側で利用者を選んでいれば、それだけで判定する
    if ((h.userIds || []).length) return h.userIds.includes(e.userId);
    // 利用者が選ばれていない予定だけ、名前(区切りあり・最長一致)で判定する
    const u = (master.users || []).find((x) => x.id === e.userId);
    return labelStartsWithUser(master, h.label, u);
  }
  const t = String(e.note || "").trim();
  return !!t && String(h.label || "").includes(t);
}

function extraHelpCheck(master, sheetData, wd, patternForDay) {
  const items = (sheetData.blocks || []).filter((b) => b.kind === "help" || b.kind === "block");
  const regular = { help: new Set(), block: new Set() };
  ((patternForDay && patternForDay.blocks) || []).forEach((b) => {
    if (regular[b.kind]) regular[b.kind].add(extraKeyOf(b.label, b.time));
  });
  (rulesOf(master).helpBase || []).forEach((r) => { if (wd != null && (r.byDay || {})[wd]) regular.help.add(extraKeyOf(r.label, r.time)); });
  const entries = (sheetData.extraHelps || []).filter((e) => e && (e.userId || String(e.note || "").trim()));
  const status = {};
  const missing = [];
  entries.forEach((e) => {
    const h = items.find((x) => extraHelpMatch(master, e, x));
    status[e.id] = h || null;
    if (!h) missing.push(e);
  });
  // 週間パターンが無い曜日は「通常」が分からないので、欄に無いものの確認はしない
  const hasPattern = regular.help.size + regular.block.size > 0;
  const unlisted = [];
  if (hasPattern) {
    const seen = new Set();
    items.forEach((h) => {
      const k = h.kind + "|" + extraKeyOf(h.label, h.time);
      if (regular[h.kind].has(extraKeyOf(h.label, h.time)) || seen.has(k)) return;
      if (entries.some((e) => extraHelpMatch(master, e, h))) return;
      seen.add(k);
      unlisted.push(h);
    });
  }
  return { status, missing, unlisted, hasPattern };
}

function extraHelpLabel(master, e) {
  const u = (master.users || []).find((x) => x.id === e.userId);
  return [EXTRA_KIND_JP[e.kind || "help"], e.time, u ? u.name : "", String(e.note || "").trim()].filter(Boolean).join(" ");
}

// 同じ予定(種別+名前+時刻)の担当職員をまとめる(2名体制は「A・B」)
function extraStaffOf(master, blocks, h) {
  const sName = (id) => (id === HOLD_ID ? "保留" : (master.staff.find((s) => s.id === id) || {}).name || "保留");
  return (blocks || [])
    .filter((b) => b.kind === h.kind && extraKeyOf(b.label, b.time) === extraKeyOf(h.label, h.time))
    .map((b) => sName(b.staffId)).join("・");
}

function ExtraHelpPanel({ master, sheet, wd, patternForDay, onChange }) {
  const list = sheet.extraHelps || [];
  const chk = extraHelpCheck(master, sheet, wd, patternForDay);
  const staffOf = (h) => extraStaffOf(master, sheet.blocks, h);
  const setRow = (id, patch) => onChange(list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const addRow = (init) => onChange([...list, { id: uid(), kind: "help", time: "", userId: "", note: "", ...(init || {}) }]);
  const delRow = (id) => onChange(list.filter((e) => e.id !== id));
  const today = master.users.filter((u) => (u.days || []).includes(wd));
  const others = master.users.filter((u) => !(u.days || []).includes(wd));
  const addFromItem = (h) => {
    const sel = (h.userIds || [])[0] ? master.users.find((x) => x.id === h.userIds[0]) : userFromLabel(master, h.label);
    let rest = String(h.label || "");
    if (sel && rest.startsWith(sel.name)) rest = rest.slice(sel.name.length);
    rest = rest.replace(/^[\s・･]+/, "").replace(/^ヘルプ$/, "").trim();
    addRow({ kind: h.kind, time: h.time || "", userId: sel ? sel.id : "", note: sel ? (rest || h.note || "") : (h.label || "") });
  };
  return (
    <div className="bg-white border border-violet-300 rounded-lg p-3 mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-bold text-violet-800 text-sm">通常外のヘルプ・その他予定(この日だけ)</div>
        <div className="text-[11px] text-stone-500">
          その日だけのヘルプや予定を書いておくと、送迎表に入っているかを確かめます。送迎表にある通常外の予定(この曜日の週間パターンに無いもの)がこの欄に無いときも、Excel出力の前に確認が出ます。
        </div>
      </div>
      {list.length > 0 && (
        <table className="text-sm mt-2 w-full">
          <thead>
            <tr className="text-[11px] text-stone-500 text-left">
              <th className="p-1 w-28">種別</th><th className="p-1 w-20">時刻</th><th className="p-1 w-36">利用者</th><th className="p-1">内容</th><th className="p-1 w-56">送迎表</th><th className="p-1 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => {
              const h = chk.status[e.id];
              const empty = !e.userId && !String(e.note || "").trim();
              return (
                <tr key={e.id} className="border-t border-stone-100">
                  <td className="p-1">
                    <select className={inputCls} value={e.kind || "help"} onChange={(ev) => setRow(e.id, { kind: ev.target.value })}>
                      <option value="help">ヘルプ</option>
                      <option value="block">その他予定</option>
                    </select>
                  </td>
                  <td className="p-1"><input className={inputCls} value={e.time || ""} placeholder="16:00" onChange={(ev) => setRow(e.id, { time: ev.target.value })} /></td>
                  <td className="p-1">
                    <select className={inputCls} value={e.userId || ""} onChange={(ev) => setRow(e.id, { userId: ev.target.value })}>
                      <option value="">—</option>
                      <optgroup label="この日の利用者">{today.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
                      <optgroup label="その他">{others.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
                    </select>
                  </td>
                  <td className="p-1"><input className={inputCls} value={e.note || ""} placeholder={(e.kind || "help") === "block" ? "例:会議・研修・受診同行" : "例:家事・入浴・通院付き添い"} onChange={(ev) => setRow(e.id, { note: ev.target.value })} /></td>
                  <td className="p-1 text-xs">
                    {empty ? <span className="text-stone-400">利用者か内容を入れてください</span>
                      : h ? <span className="text-emerald-700 font-semibold">✓ あり({h.time} {h.label}/{staffOf(h)})</span>
                      : <span className="text-rose-600 font-bold">⚠ 送迎表にまだ入っていません</span>}
                  </td>
                  <td className="p-1"><button className="text-rose-500 text-xs hover:underline" onClick={() => delRow(e.id)}>削除</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="flex gap-2 mt-2">
        <button className={btnSec} onClick={() => addRow({ kind: "help" })}>+ ヘルプを追加</button>
        <button className={btnSec} onClick={() => addRow({ kind: "block" })}>+ その他予定を追加</button>
      </div>
      {chk.unlisted.length > 0 && (
        <div className="mt-2 bg-amber-50 border border-amber-300 rounded p-2">
          <div className="text-[11px] font-bold text-amber-800 mb-1">送迎表にある通常外の予定で、この欄に無いもの</div>
          <div className="flex flex-col gap-1">
            {chk.unlisted.map((h) => (
              <div key={h.id} className="flex items-center gap-2 text-xs">
                <span className="text-[10px] px-1 rounded bg-amber-200 text-amber-900">{EXTRA_KIND_JP[h.kind]}</span>
                <span className="text-stone-700">{h.time} {h.label}(担当: {staffOf(h)})</span>
                <button className="px-2 py-0.5 rounded border border-amber-400 text-amber-800 hover:bg-amber-100" onClick={() => addFromItem(h)}>この欄に追加</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!chk.hasPattern && (
        <div className="text-[11px] text-stone-400 mt-1">※ この曜日の週間パターンがまだ無いため、「欄に無い通常外の予定」の確認はしていません。</div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  // 入力欄で文字をドラッグ選択して枠外でマウスを離すと閉じてしまう事故を防ぐ:
  // 「背景でマウスを押し、背景で離した」時だけ閉じる
  const downOnBg = useRef(false);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 overflow-y-auto"
      onMouseDown={(e) => { downOnBg.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnBg.current) onClose(); downOnBg.current = false; }}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-md"} mt-6 mb-6 flex flex-col`} style={{ maxHeight: "calc(100vh - 3rem)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 shrink-0">
          <div className="font-bold text-stone-800">{title}</div>
          <button className="text-stone-400 hover:text-stone-700 text-xl leading-none px-1" onClick={onClose}>×</button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-stone-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-stone-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400";

// 重複チェック付きの名前入力。入力確定時(フォーカスアウト/Enter)に同名がいればエラーを出して元に戻す。
function NameInput({ value, onCommit, checkDup, placeholder }) {
  const [v, setV] = useState(value || "");
  useEffect(() => { setV(value || ""); }, [value]);
  const commit = () => {
    const t = v.trim();
    if (t === (value || "")) return;
    if (t && checkDup(t)) {
      notify(`「${t}」は既に登録されています。同じ表記では登録できません。名前の後ろに一文字加えるなどで区別してください(例:田中よ / 田中か)`, "warn");
      setV(value || "");
      return;
    }
    onCommit(t);
  };
  return (
    <input className={inputCls} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}
const btnPri = "bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold px-4 py-2 rounded-md disabled:opacity-40 disabled:cursor-not-allowed";
const btnSec = "bg-white border border-stone-300 hover:bg-stone-50 text-stone-700 text-sm font-semibold px-3 py-2 rounded-md";
const btnDanger = "text-rose-600 hover:bg-rose-50 border border-rose-200 text-sm px-3 py-2 rounded-md";

/* ============================================================
   利用者選択(検索付き)
   ============================================================ */
function UserPicker({ master, selected, onChange, absentMap, deptFirst, helpOnly, hideIds, weekday }) {
  const [q, setQ] = useState("");
  const depts = [...master.departments].sort((a, b) => (a.id === deptFirst ? -1 : b.id === deptFirst ? 1 : 0));
  return (
    <div className="border border-stone-200 rounded-md">
      <input
        className="w-full px-2 py-1.5 text-sm border-b border-stone-200 rounded-t-md focus:outline-none"
        placeholder="利用者を検索…" value={q} onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-52 overflow-y-auto p-2">
        {depts.map((d) => {
          const list = master.users.filter((u) =>
            u.deptId === d.id && (!q || u.name.includes(q)) && (!helpOnly || u.hasHelp !== false) &&
            // ヘルプ対象の選択時は曜日フィルタなし(伊達・吉浦などヘルプのみの方は利用日=空のため)
            (helpOnly || weekday == null || (u.days || []).includes(weekday) || selected.includes(u.id)) &&
            (!hideIds || !hideIds.has(u.id) || selected.includes(u.id)));
          if (!list.length) return null;
          const color = (DEPT_COLORS[master.departments.findIndex((x) => x.id === d.id) % DEPT_COLORS.length] || DEPT_COLORS[0]);
          return (
            <div key={d.id} className="mb-2">
              <div className={`text-xs font-bold ${color.text} mb-1`}>{d.name}</div>
              <div className="flex flex-wrap gap-1">
                {list.map((u) => {
                  const on = selected.includes(u.id);
                  const isAbsent = absentMap && absentMap[u.id];
                  return (
                    <button key={u.id} disabled={isAbsent}
                      onClick={() => onChange(on ? selected.filter((x) => x !== u.id) : [...selected, u.id])}
                      className={`text-xs px-2 py-1 rounded border ${
                        isAbsent ? "bg-stone-100 text-stone-400 border-stone-200 line-through"
                          : on ? "bg-sky-600 text-white border-sky-600"
                          : "bg-white border-stone-300 text-stone-700 hover:bg-stone-50"
                      }`}>
                      {u.name}{u.baseDeptId && "◆"}{u.wheelchair && <span className="ml-0.5">♿</span>}{isAbsent && "(欠)"}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   同乗する職員の選択
   ============================================================ */
function StaffPicker({ master, selected, onChange, excludeId }) {
  return (
    <div className="border border-stone-200 rounded-md p-2 max-h-40 overflow-y-auto">
      {master.departments.map((d, di) => {
        const list = master.staff.filter((s) => s.deptId === d.id && s.id !== excludeId);
        if (!list.length) return null;
        const c = (DEPT_COLORS[di % DEPT_COLORS.length] || DEPT_COLORS[0]);
        return (
          <div key={d.id} className="mb-1.5">
            <div className={`text-xs font-bold ${c.text} mb-0.5`}>{d.name}</div>
            <div className="flex flex-wrap gap-1">
              {list.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <button key={s.id}
                    onClick={() => onChange(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                    className={`text-xs px-2 py-1 rounded border ${on ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-stone-300 text-stone-700 hover:bg-stone-50"}`}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   予定の追加・編集モーダル
   ============================================================ */
function ItemModal({ master, data, weekday, initial, onSave, onDelete, onClose }) {
  // 徒歩は「車両=徒歩」で管理するので、種別は迎え/送りのまま扱う(訓練・移動は従来どおり種別で持つ)
  const [kind, setKind] = useState(
    initial.mode && initial.mode !== "walk" && (initial.kind === "meet" || initial.kind === "send")
      ? initial.mode + "_" + initial.kind : (initial.kind || "meet")
  );
  const [time, setTime] = useState(initial.time || "8:30");
  const [staffId, setStaffId] = useState(initial.staffId || "");
  const [vehicleId, setVehicleId] = useState(initial.mode === "walk" ? "__walk__" : (initial.vehicleId || ""));
  const [userIds, setUserIds] = useState(initial.userIds || []);
  const [label, setLabel] = useState(initial.label || "");
  const [note, setNote] = useState(initial.note || "");
  const [staffRiderIds, setStaffRiderIds] = useState(initial.staffRiderIds || []);
  const [durMin, setDurMin] = useState(initial.durMin ? String(initial.durMin) : "");
  const [destDeptId, setDestDeptId] = useState(initial.destDeptId || "");
  const [places, setPlaces] = useState({ ...(initial.places || {}) }); // その日だけの行き先変更 {利用者ID: 行き先}
  const [trainIds, setTrainIds] = useState(initial.trainUserIds || []); // この便の中で訓練迎え/訓練送りの人(別枠)
  const [bothIds, setBothIds] = useState(initial.trainBothIds || []); // 訓練だが通常の迎え/送りも兼ねる人
  const [dropIds, setDropIds] = useState(initial.trainDropIds || []); // 自宅で拾ってそのまま訓練先へ送る人
  const [endIds, setEndIds] = useState(initial.trainEndIds || []); // 自宅→訓練先でその日は終了(送りも不要)
  // 徒歩・訓練の迎え送り(walk_meet等)は「迎え/送り+移動手段」として分解して扱う
  const mode = kind.startsWith("walk_") ? "walk" : kind.startsWith("train_") ? "train" : kind.startsWith("move_") ? "move" : "";
  const baseKind = mode ? kind.split("_")[1] : kind;
  const isOwn = baseKind === "own_move";
  const isHelp = baseKind === "help";
  const isRun = baseKind === "meet" || baseKind === "send" || baseKind === "other_run" || isOwn;
  // 車両を選べる種別(送迎系 + ヘルプ)。自車以外は常に車両欄を出し、徒歩もこの欄で選ぶ
  const canPickVehicle = (isRun && !isOwn) || isHelp;
  const known = new Set(master.staff.map((s) => s.id));
  const effStaffId = staffId && !known.has(staffId) && staffId !== HOLD_ID && staffId !== REQ_ID ? HOLD_ID : staffId;
  const canReq = EDITION === "v3" && (baseKind === "meet" || baseKind === "send");
  const stf = master.staff.find((s) => s.id === effStaffId);
  const veh = resolveVehicle(master, vehicleId);
  const wcCount = userIds.map((id) => master.users.find((u) => u.id === id)).filter((u) => u && u.wheelchair).length;
  const cap = veh ? (wcCount > 0 ? veh.capWc : veh.capNormal) : null;
  const totalRide = userIds.length + staffRiderIds.length + 1; // 運転手を含める

  const save = () => {
    if (toMin(time) == null) { notify("時刻を「8:30」の形式で入力してください", "warn"); return; }
    if (!effStaffId) { notify("担当職員(または保留)を選んでください", "warn"); return; }
    if (isOwn) {
      // 自車:本人が自家用車で移動。車両=own:本人、利用者・同乗なし
      onSave({ target: "runs", item: { id: initial.id || uid(), kind: baseKind, time, staffId: effStaffId, vehicleId: "own:" + effStaffId, userIds: [], staffRiderIds: [], note } });
    } else if (isRun) {
      const trainSel = trainIds.filter((id) => userIds.includes(id));
      const bothSel = bothIds.filter((id) => userIds.includes(id));
      const dropSel = dropIds.filter((id) => userIds.includes(id));
      const endSel = endIds.filter((id) => userIds.includes(id));
      const isWalkVeh = vehicleId === "__walk__";
      // 行き先変更: 便に乗っている人の分だけ残す(チェックしたのに空欄なら止める)
      const placesOut = {};
      let placeBlank = "";
      userIds.forEach((id) => {
        if (!Object.prototype.hasOwnProperty.call(places, id)) return;
        const v = normPlace(places[id]);
        const uu = master.users.find((u) => u.id === id);
        // いつもと同じ行き先を選んだ場合は「変更なし」(名前のうしろにも出さない)
        if (v && uu && v === defPlaceOf(uu, baseKind === "send" ? "send" : "meet", weekday)) return;
        if (v) placesOut[id] = v;
        else if (!placeBlank) placeBlank = (master.users.find((u) => u.id === id) || {}).name || "";
      });
      if (placeBlank) { notify(`${placeBlank}さんの変更後の行き先を入力してください`, "warn"); return; }
      onSave({ target: "runs", item: { id: initial.id || uid(), kind: baseKind, mode: isWalkVeh ? "walk" : (mode || undefined), time, staffId: effStaffId, vehicleId: isWalkVeh ? "" : vehicleId, userIds, staffRiderIds: staffRiderIds.filter((id) => id !== effStaffId), note, durMin: durMin ? Number(durMin) : undefined, destDeptId: destDeptId || undefined, trainUserIds: trainSel.length ? trainSel : undefined, trainBothIds: bothSel.length ? bothSel : undefined, trainDropIds: dropSel.length ? dropSel : undefined, trainEndIds: endSel.length ? endSel : undefined, places: Object.keys(placesOut).length ? placesOut : undefined } });
    } else if (isHelp) {
      // ヘルプ:blocksに保存しつつ、車両・利用者も保持(公用車・自車で行くヘルプに対応)
      const uNames = userIds.map((id) => (master.users.find((u) => u.id === id) || {}).name).filter(Boolean);
      const autoLabel = uNames.length ? uNames.join("・") + "ヘルプ" : (label.trim() || "ヘルプ");
      // 自車が選択されていれば、現在の担当職員の自車に合わせる
      const vId = String(vehicleId).startsWith("own:") && effStaffId && effStaffId !== HOLD_ID ? "own:" + effStaffId : vehicleId;
      onSave({ target: "blocks", item: { id: initial.id || uid(), kind: baseKind, time, staffId: effStaffId, label: autoLabel, vehicleId: vId, userIds, note: note.trim() || undefined, durMin: durMin ? Number(durMin) : undefined, destDeptId: destDeptId || undefined } });
    } else {
      if (!label.trim()) { notify("内容を入力してください", "warn"); return; }
      onSave({ target: "blocks", item: { id: initial.id || uid(), kind: baseKind, time, staffId: effStaffId, label: label.trim(), vehicleId: vehicleId && !String(vehicleId).startsWith("own:") ? vehicleId : "", durMin: durMin ? Number(durMin) : undefined, destDeptId: destDeptId || undefined } });
    }
  };

  return (
    <Modal title={initial.id ? "予定を編集" : "予定を追加"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="種別">
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="meet">迎え(送迎)</option>
            <option value="send">送り(送迎)</option>
            <option value="train_meet">訓練迎</option>
            <option value="train_send">訓練送</option>
            <option value="move_send">部署間移動(送り)</option>
            <option value="own_move">自車(自家用車で移動)</option>
            <option value="help">ヘルプ</option>
            <option value="block">その他予定(会議・透析等)</option>
          </select>
        </Field>
        <Field label="時刻">
          <input className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} placeholder="8:30" />
        </Field>
        <Field label="担当職員(保留=担当未定として右端の保留列へ)">
          <select className={inputCls} value={effStaffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">選択してください</option>
            <option value={HOLD_ID}>★ 保留(担当未定)</option>
            {(canReq || effStaffId === REQ_ID) && <option value={REQ_ID}>🤝 生活介護へ依頼(担当・車は生活介護で決める)</option>}
            {master.departments.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {master.staff.filter((s) => s.deptId === d.id && !(s.helpOnly && isRun && !isOwn && (mode || "") !== "move")).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {!s.canDrive && isRun && !isOwn ? "(運転不可)" : ""}
                    {weekday != null && (s.offDays || []).includes(weekday) && !((data.staffOv || {})[s.id] || {}).workToday ? "(固定休)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {effStaffId === REQ_ID && <div className="text-[11px] text-amber-800 mt-1" data-reqnote>生活介護の送迎表の保留欄に【りんく依頼】として出ます。担当と車は生活介護で決め、決まるとここと表に出ます。いまの状態：{reqStatusText((data.reqStatus || {})[initial.id])}</div>}
        </Field>
        {isOwn ? (
          <Field label="">
            <div className="text-xs text-stone-500 pt-6">選んだ職員が自家用車で移動します(利用者は乗せません)。</div>
          </Field>
        ) : canPickVehicle ? (
          <Field label={isHelp ? "車両(公用車・自車で行く場合に選択)" : "車両"}>
            <select className={inputCls} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">{isHelp ? "車なし(徒歩・その他)" : "選択してください"}</option>
              {!isHelp && <option value="__walk__">🚶 徒歩(車を使わない・徒歩迎え/徒歩送りになります)</option>}
              {isHelp && effStaffId && effStaffId !== HOLD_ID && (
                <option value={"own:" + effStaffId}>担当職員の自車で行く</option>
              )}
              {master.departments.map((dpt) => {
                const vs = master.vehicles.filter((v) => v.deptId === dpt.id);
                if (!vs.length) return null;
                return (
                  <optgroup key={dpt.id} label={dpt.name}>
                    {vs.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}(定員{v.capNormal}/♿{v.wheelchairOK ? v.capWc : "不可"})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>
        ) : (
          <Field label="内容">
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例:透析 / 会議 / 受入" />
          </Field>
        )}
      </div>

      {!isRun && !isHelp && !isOwn && (
        <Field label="車両(この予定で公用車を使う場合に選択)">
          <select className={inputCls} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">車なし</option>
            {master.departments.map((dpt) => {
              const vs = master.vehicles.filter((v) => v.deptId === dpt.id);
              if (!vs.length) return null;
              return (
                <optgroup key={dpt.id} label={dpt.name}>
                  {vs.map((v) => <option key={v.id} value={v.id}>{v.name}(定員{v.capNormal}/♿{v.wheelchairOK ? v.capWc : "不可"})</option>)}
                </optgroup>
              );
            })}
          </select>
        </Field>
      )}

      {(baseKind === "meet" || baseKind === "send") && userIds.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-bold text-stone-600">いつもと違う{baseKind === "meet" ? "迎え" : "送り"}先(チェックした人だけ名前のうしろに出ます)</div>
          <div className="text-[11px] text-stone-400 mb-1">
            利用者タブで決めた「いつもの{baseKind === "meet" ? "迎え" : "送り"}先」と違うときだけチェックして、今日の行き先を書いてください。送迎表の名前が「{userIds.length ? (master.users.find((x) => x.id === userIds[0]) || {}).name || "氏名" : "氏名"}(実家)」のように変わり、Excel出力の前に最終確認が出ます。
          </div>
          <div className="flex flex-wrap gap-1.5">
            {userIds.map((id) => {
              const u = master.users.find((x) => x.id === id);
              if (!u) return null;
              const def = defPlaceOf(u, baseKind === "send" ? "send" : "meet", weekday);
              const on = Object.prototype.hasOwnProperty.call(places, id);
              return (
                <div key={id} className={`border rounded px-1.5 py-1 ${on ? "border-amber-400 bg-amber-50" : "border-stone-200 bg-white"}`}>
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={on}
                      onChange={(e) => setPlaces((prev) => {
                        const n = { ...prev };
                        if (e.target.checked) n[id] = ""; else delete n[id];
                        return n;
                      })} />
                    <span className={on ? "font-bold text-amber-800" : "text-stone-600"}>{u.name}</span>
                    <span className="text-[10px] text-stone-400">いつも:{def}</span>
                  </label>
                  {on && (
                    <input className="mt-0.5 w-32 border border-amber-300 rounded px-1 py-0.5 text-xs" list="place-opts-run"
                      value={places[id]} placeholder="例:実家・ﾘﾍﾞ"
                      onChange={(e) => setPlaces((prev) => ({ ...prev, [id]: e.target.value }))} />
                  )}
                </div>
              );
            })}
          </div>
          <datalist id="place-opts-run">{placeOptionsOf(master).map((p) => <option key={p} value={p} />)}</datalist>
        </div>
      )}

      {canPickVehicle && !isHelp && userIds.length > 0 && mode === "train" && (
        // 訓練迎・訓練送の便：1人ずつ「通常の迎え/送りと同じ」かどうかだけ選ぶ（チェックすると迎え漏れ・送り漏れに出ない）
        <div className="mt-2 rounded-md border border-indigo-200 bg-indigo-50/50 p-2" data-trainsame>
          <div className="text-xs font-bold text-stone-700">通常の{baseKind === "meet" ? "迎え" : "送り"}と同じにする人</div>
          <div className="text-[11px] text-stone-500 mb-1">
            {baseKind === "meet"
              ? "チェックした人は、この訓練迎えが今日の迎えになります（訓練先から拾ってそのまま来所など）。迎え漏れに出ません。チェックしない人は、通常の迎えが別にある扱いです。"
              : "チェックした人は、この訓練送りが今日の送りになります（訓練先へ送ってそのまま終わりなど）。送り漏れに出ません。チェックしない人は、通常の送りが別にある扱いです。"}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {userIds.map((id) => {
              const u = master.users.find((x) => x.id === id);
              if (!u) return null;
              const on = bothIds.includes(id);
              return (
                <label key={id} className="inline-flex items-center gap-1 text-sm cursor-pointer">
                  <input type="checkbox" data-same={u.name} checked={on}
                    onChange={() => { setBothIds((prev) => (on ? prev.filter((x) => x !== id) : [...prev, id])); if (!on) { setTrainIds((prev) => prev.filter((x) => x !== id)); setDropIds((prev) => prev.filter((x) => x !== id)); setEndIds((prev) => prev.filter((x) => x !== id)); } }} />
                  {u.name}{on ? <span className="text-[11px] text-indigo-700 font-bold">{baseKind === "meet" ? "迎(訓練)" : "送(訓練)"}</span> : ""}
                </label>
              );
            })}
          </div>
        </div>
      )}
      {canPickVehicle && !isHelp && userIds.length > 0 && (mode || "") === "" && (
        // 通常の迎え・送りの便に訓練の人を乗せるとき（ふだんは閉じておく）
        <details className="mt-2" open={[...trainIds, ...bothIds, ...dropIds, ...endIds].some((id) => userIds.includes(id))}>
          <summary className="text-xs font-bold text-stone-600 cursor-pointer">訓練の人を乗せるとき（開く）</summary>
          {(mode || "") === "" && <>
          <div className="text-xs font-bold text-stone-600">訓練{kind === "meet" ? "迎え" : "送り"}の人(タップで切替・名前に{kind === "meet" ? "(訓迎)" : "(訓送)"}が付きます)</div>
          <div className="text-[11px] text-stone-400 mb-1">通常の{kind === "meet" ? "迎え" : "送り"}と訓練の{kind === "meet" ? "迎え" : "送り"}を同じ便に混ぜるときに使います。訓練の人は希望時刻ズレ・重複の警告対象外になります。</div>
          <div className="flex flex-wrap gap-1">
            {userIds.map((id) => {
              const u = master.users.find((x) => x.id === id);
              if (!u) return null;
              const on = trainIds.includes(id);
              return (
                <button key={id} type="button"
                  onClick={() => { setTrainIds((prev) => (on ? prev.filter((x) => x !== id) : [...prev, id])); if (!on) { setBothIds((prev) => prev.filter((x) => x !== id)); setDropIds((prev) => prev.filter((x) => x !== id)); } }}
                  className={`text-xs px-2 py-0.5 rounded-full border ${on ? "bg-violet-600 text-white border-violet-600" : "bg-white text-stone-600 border-stone-300 hover:border-violet-400"}`}>
                  {u.name}{on ? (kind === "meet" ? "(訓迎)" : "(訓送)") : ""}
                </button>
              );
            })}
          </div>
          </>}
          {(kind === "meet" || kind === "send") && ((mode || "") === "" || mode === "train") && (
            <div className="mt-2">
              <div className="text-xs font-bold text-stone-600">この便が通常の{kind === "meet" ? "迎え" : "送り"}も兼ねる人(タップで切替・名前に{kind === "meet" ? "迎(訓練)" : "送(訓練)"}が付きます)</div>
              <div className="text-[11px] text-stone-400 mb-1">
                {kind === "meet"
                  ? "訓練先から拾ってそのまま来所する場合に使います。選んだ人はこの便が本日の迎えとして数えられ、未割り当てに残りません。"
                  : "来所後そのまま訓練先へ送って終了する場合に使います。選んだ人はこの便が本日の送りとして数えられ、未割り当てに残りません。"}
              </div>
              <div className="flex flex-wrap gap-1">
                {userIds.map((id) => {
                  const u = master.users.find((x) => x.id === id);
                  if (!u) return null;
                  const on2 = bothIds.includes(id);
                  return (
                    <button key={id} type="button"
                      onClick={() => {
                        setBothIds((prev) => (on2 ? prev.filter((x) => x !== id) : [...prev, id]));
                        if (!on2) { setTrainIds((prev) => prev.filter((x) => x !== id)); setDropIds((prev) => prev.filter((x) => x !== id)); } // 他の訓練指定とは排他
                      }}
                      className={`text-xs px-2 py-0.5 rounded-full border ${on2 ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-stone-600 border-stone-300 hover:border-indigo-400"}`}>
                      {u.name}{on2 ? (kind === "meet" ? "迎(訓練)" : "送(訓練)") : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(kind === "meet" || kind === "send") && ((mode || "") === "" || mode === "train") && (
            <div className="mt-2">
              <div className="text-xs font-bold text-stone-600">自宅で拾ってそのまま訓練先へ送る人(タップで切替・名前に迎(訓送)が付きます)</div>
              <div className="text-[11px] text-stone-400 mb-1">朝、自宅から乗せてそのまま訓練先へ届ける便です。選んだ人はこの便が本日の迎えとして数えられ、訓練送りの便を別に作る必要はありません(帰りは訓練迎えか送りで登録)。</div>
              <div className="flex flex-wrap gap-1">
                {userIds.map((id) => {
                  const u = master.users.find((x) => x.id === id);
                  if (!u) return null;
                  const on3 = dropIds.includes(id);
                  return (
                    <button key={id} type="button"
                      onClick={() => {
                        setDropIds((prev) => (on3 ? prev.filter((x) => x !== id) : [...prev, id]));
                        if (!on3) { setTrainIds((prev) => prev.filter((x) => x !== id)); setBothIds((prev) => prev.filter((x) => x !== id)); setEndIds((prev) => prev.filter((x) => x !== id)); }
                      }}
                      className={`text-xs px-2 py-0.5 rounded-full border ${on3 ? "bg-teal-600 text-white border-teal-600" : "bg-white text-stone-600 border-stone-300 hover:border-teal-400"}`}>
                      {u.name}{on3 ? "迎(訓送)" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(kind === "meet" || kind === "send") && ((mode || "") === "" || mode === "train") && (
            <div className="mt-2">
              <div className="text-xs font-bold text-stone-600">この便で1日が終わる人(送りも不要・タップで切替・名前に迎(訓送)終が付きます)</div>
              <div className="text-[11px] text-stone-400 mb-1">自宅→訓練先へ送ってそのまま終了(帰りは家族など)の場合に使います。選んだ人は迎え・送りの両方が済んだ扱いになり、どちらも未割り当てに残りません。</div>
              <div className="flex flex-wrap gap-1">
                {userIds.map((id) => {
                  const u = master.users.find((x) => x.id === id);
                  if (!u) return null;
                  const on4 = endIds.includes(id);
                  return (
                    <button key={id} type="button"
                      onClick={() => {
                        setEndIds((prev) => (on4 ? prev.filter((x) => x !== id) : [...prev, id]));
                        if (!on4) { setTrainIds((prev) => prev.filter((x) => x !== id)); setBothIds((prev) => prev.filter((x) => x !== id)); setDropIds((prev) => prev.filter((x) => x !== id)); }
                      }}
                      className={`text-xs px-2 py-0.5 rounded-full border ${on4 ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-600 border-stone-300 hover:border-emerald-400"}`}>
                      {u.name}{on4 ? "迎(訓送)終" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </details>
      )}

      {!isOwn && vehicleId && vehicleId !== "__walk__" && !String(vehicleId).startsWith("own:") && (
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Field label="所要時間(車が戻るまで・アプリ内のみ)">
            <select className={inputCls} value={durMin} onChange={(e) => setDurMin(e.target.value)}>
              <option value="">30分(既定)</option>
              {[45, 60, 75, 90, 120, 150, 180, 240].map((m) => (
                <option key={m} value={m}>{m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? m % 60 + "分" : ""}` : `${m}分`}</option>
              ))}
            </select>
          </Field>
          <Field label="行先(終了後どの事業所に置くか)">
            <select className={inputCls} value={destDeptId} onChange={(e) => setDestDeptId(e.target.value)}>
              <option value="">既定(迎え後=所属 / 最終送り後=帰着地 / ヘルプ後=出発地)</option>
              {master.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}に置く</option>
              ))}
            </select>
          </Field>
          <div className="col-span-2 text-[11px] text-stone-400 -mt-2">この設定はExcelには出ません。「車両の動き」タブと車両の不在・重複エラーの計算に使われます。</div>
        </div>
      )}

      {((isRun && !isOwn) || isHelp) && (() => {
        // 迎え・送りの両方がすでに割り当て済みの利用者は選択欄から隠す(編集中の便は判定から除外)
        const meetSet = new Set(), sendSet = new Set();
        (data.runs || []).forEach((r) => {
          if (r.id === initial.id) return;
          (r.userIds || []).forEach((uid2) => {
            // 訓練迎え/訓練送り(便ごと訓練 or 訓練フラグ)は通常の送迎とは別枠なので「済み」に数えない
            const rk2 = rideKindOf(r, uid2);
            if (!rk2) return;
            if (rk2 === "meet") meetSet.add(uid2);
            if (r.kind === "send") sendSet.add(uid2);
          });
        });
        const bothDone = new Set([...meetSet].filter((x) => sendSet.has(x)));
        // 編集中と同じ種別(迎えなら迎え)にすでに入っている人は選択欄に出さない
        const hideSet = kind === "meet" ? meetSet : kind === "send" ? sendSet : bothDone;
        const hideLabel = kind === "meet" ? "迎え済み" : kind === "send" ? "送り済み" : "迎え送り済み";
        // 「送迎なし」に登録された人もこの種別では選択欄に出さない(すでに乗せている場合は残す)
        const noRideMap2 = data.noRide || {};
        master.users.forEach((u2) => {
          const nr2 = noRideMap2[u2.id] || {};
          const blocked = kind === "meet" ? nr2.meet : kind === "send" ? nr2.send : (nr2.meet && nr2.send);
          if (blocked && !userIds.includes(u2.id)) hideSet.add(u2.id);
        });
        return (
        <Field label={isHelp
          ? `ヘルプ対象の利用者 ${userIds.length}名(ヘルプ有の利用者から選択)`
          : `乗車する利用者 ${userIds.length}名${wcCount ? `(うち車いす${wcCount}名)` : ""}${hideSet.size ? `(${hideLabel}の${hideSet.size}名は非表示)` : ""}`}>
          <UserPicker master={master} selected={userIds} onChange={setUserIds} absentMap={data.userAbsent} weekday={weekday}
            deptFirst={stf ? stf.deptId : null} helpOnly={isHelp} hideIds={isHelp ? null : hideSet} />
          {!isHelp && userIds.length > 1 && (
            <div className="mt-1.5 flex flex-wrap gap-1 items-center bg-stone-50 border border-stone-200 rounded p-1">
              <span className="text-[11px] font-bold text-stone-500">乗車順(◀▶で移動 / Excelのセル・リベ①の位置に反映):</span>
              {userIds.map((id, i) => {
                const u = master.users.find((x) => x.id === id);
                const mv = (d) => {
                  const j = i + d;
                  if (j < 0 || j >= userIds.length) return;
                  const a = userIds.slice();
                  [a[i], a[j]] = [a[j], a[i]];
                  setUserIds(a);
                };
                return (
                  <span key={id} className="inline-flex items-center text-xs rounded border bg-white border-stone-300 overflow-hidden">
                    <button className="px-1 py-0.5 text-stone-400 hover:bg-stone-100 disabled:opacity-20" disabled={i === 0} onClick={() => mv(-1)}>◀</button>
                    <span className="px-1 py-0.5 text-stone-700">{i + 1}.{u ? u.name : "?"}</span>
                    <button className="px-1 py-0.5 text-stone-400 hover:bg-stone-100 disabled:opacity-20" disabled={i === userIds.length - 1} onClick={() => mv(1)}>▶</button>
                  </span>
                );
              })}
            </div>
          )}
        </Field>
        );
      })()}

      {isRun && !isOwn && (
        <Field label={`同乗する職員(運転者以外に乗る職員) ${staffRiderIds.length}名${cap != null ? ` / 運転手込み合計${totalRide}名・この車の定員${cap}名` : ""}`}>
          <StaffPicker master={master} selected={staffRiderIds} onChange={setStaffRiderIds} excludeId={effStaffId} />
        </Field>
      )}

      {isRun && (() => {
        const tmpRun = { id: initial.id || "__tmp__", kind, time, staffId: effStaffId, vehicleId, userIds, staffRiderIds };
        const warns = effStaffId ? runWarnings(tmpRun, master, data, weekday) : [];
        if (!warns.length) return null;
        return (
          <div className="bg-rose-50 border border-rose-300 rounded-md p-2 mb-3">
            <div className="text-xs font-bold text-rose-700 mb-1">⚠ この予定の警告(表の三角マークの理由)</div>
            <ul className="text-xs text-rose-700 list-disc pl-4">
              {warns.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        );
      })()}

      {(isRun || isHelp) && (
        <Field label="メモ(任意)">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={isHelp ? "例:歯科受診 / 入浴介助 / ②のパターン" : "例:①便 / 東部経由"} />
        </Field>
      )}

      <div className="flex justify-between mt-4 sticky bottom-0 bg-white border-t border-stone-200 py-2 -mx-4 px-4 rounded-b-xl">
        <div>
          {initial.id && (
            <button className={btnDanger} onClick={() => onDelete()}>削除</button>
          )}
        </div>
        <div className="flex gap-2">
          <button className={btnSec} onClick={onClose}>キャンセル</button>
          <button className={btnPri} onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
   自動提案モーダル
   ============================================================ */
function SuggestModal({ master, data, weekday, initial, onAdd, onClose }) {
  const [deptId, setDeptId] = useState(initial.deptId || master.departments[0].id);
  const [kind, setKind] = useState(initial.kind || "meet");
  const [time, setTime] = useState(initial.time || "8:30");
  const [userIds, setUserIds] = useState(initial.userIds || []);
  const [includeOther, setIncludeOther] = useState(false);
  const [result, setResult] = useState(null);
  const [pickVeh, setPickVeh] = useState("");
  const [pickDrv, setPickDrv] = useState("");

  const calc = () => {
    if (toMin(time) == null) { notify("時刻を「8:30」の形式で入力してください", "warn"); return; }
    if (!userIds.length) { notify("利用者を選んでください", "warn"); return; }
    const r = computeSuggestion({ deptId, time, userIds, includeOtherDept: includeOther, master, data, weekday });
    setResult(r);
    setPickVeh(r.vehicles.length ? r.vehicles[0].v.id : "");
    setPickDrv(r.drivers.length ? r.drivers[0].s.id : "");
  };

  return (
    <Modal title="自動提案(条件から候補を出す)" onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-3">
        <Field label="部署">
          <select className={inputCls} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            {master.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="種別">
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="meet">迎え</option>
            <option value="send">送り</option>
          </select>
        </Field>
        <Field label="時刻">
          <input className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} placeholder="8:30" />
        </Field>
      </div>
      <Field label="乗せる利用者">
        {(() => {
          const meetSet = new Set(), sendSet = new Set();
          (data.runs || []).forEach((r) => (r.userIds || []).forEach((u2) => {
            const rk3 = rideKindOf(r, u2);
            if (!rk3) return; // 訓練は別枠(兼用・訓練送りは数える)
            if (rk3 === "meet") meetSet.add(u2);
            if (r.kind === "send") sendSet.add(u2);
          }));
          const bothDone = new Set([...meetSet].filter((x) => sendSet.has(x)));
          return <UserPicker master={master} selected={userIds} onChange={setUserIds} absentMap={data.userAbsent} deptFirst={deptId} hideIds={bothDone} weekday={weekday} />;
        })()}
      </Field>
      <label className="flex items-center gap-2 text-sm text-stone-600 mb-3">
        <input type="checkbox" checked={includeOther} onChange={(e) => setIncludeOther(e.target.checked)} />
        他部署の車両も候補に含める
      </label>
      <button className={btnPri} onClick={calc}>候補を計算する</button>

      {result && (
        <div className="mt-4 border-t border-stone-200 pt-3">
          <div className="text-sm text-stone-600 mb-2">
            利用者{result.n}名{result.wc ? `(車いす${result.wc}名)` : ""}が乗れる組み合わせ:
          </div>
          {!result.vehicles.length && (
            <div className="text-sm text-rose-600 font-semibold mb-2">条件に合う車両がありません(定員・車いす対応をご確認ください)</div>
          )}
          {!result.drivers.length && (
            <div className="text-sm text-rose-600 font-semibold mb-2">この時間に運転できる職員がいません(勤務時間・休み・重複をご確認ください)</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-bold text-stone-500 mb-1">車両の候補</div>
              {result.vehicles.map(({ v, cap, busy }) => (
                <label key={v.id} className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded border mb-1 cursor-pointer ${pickVeh === v.id ? "border-sky-500 bg-sky-50" : "border-stone-200"}`}>
                  <input type="radio" name="veh" checked={pickVeh === v.id}
                    onChange={() => {
                      setPickVeh(v.id);
                      if (v.own && result.drivers.some((x) => x.s.id === v.ownerId)) setPickDrv(v.ownerId);
                    }} />
                  <span className="font-semibold">{v.name}</span>
                  <span className="text-xs text-stone-500">定員{cap}名 {busy && <span className="text-amber-600 font-semibold">同時刻に使用中⚠</span>}</span>
                </label>
              ))}
            </div>
            <div>
              <div className="text-xs font-bold text-stone-500 mb-1">運転者の候補</div>
              <div className="max-h-48 overflow-y-auto">
                {result.drivers.map(({ s }) => {
                  const d = master.departments.find((x) => x.id === s.deptId);
                  return (
                    <label key={s.id} className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded border mb-1 cursor-pointer ${pickDrv === s.id ? "border-sky-500 bg-sky-50" : "border-stone-200"}`}>
                      <input type="radio" name="drv" checked={pickDrv === s.id} onChange={() => setPickDrv(s.id)} />
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-xs text-stone-500">{d ? d.name : ""}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button className={btnPri} disabled={!pickVeh || !pickDrv}
              onClick={() => onAdd({ id: uid(), kind, time, staffId: pickDrv, vehicleId: pickVeh, userIds, note: "" })}>
              この組み合わせで表に追加
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   休日出勤の設定モーダル(固定休の職員をその日だけ出勤させる)
   ============================================================ */
function HolidayWorkModal({ master, wd, staffOv, onToggle, onClose }) {
  const list = master.staff.filter((s) => (s.offDays || []).includes(wd));
  return (
    <Modal title={`休日出勤の設定(${DAYS[wd]}曜日が固定休の職員)`} onClose={onClose}>
      <div className="text-xs text-stone-500 mb-2">
        固定休の職員はこの日の表に表示されません。出勤する日はここで「出勤に追加」すると列が現れます(氏名に「休出」バッジが付きます)。
      </div>
      {list.length === 0 && <div className="text-sm text-stone-500">本日({DAYS[wd]}曜)が固定休の職員はいません。職員タブの「固定休」で設定できます。</div>}
      {list.map((s) => {
        const on = !!(((staffOv || {})[s.id] || {}).workToday);
        const d = master.departments.find((x) => x.id === s.deptId);
        return (
          <div key={s.id} className="flex items-center justify-between border-b border-stone-100 py-1.5 gap-2">
            <div className="min-w-0">
              <span className="font-semibold text-sm">{s.name}</span>{" "}
              <span className="text-xs text-stone-500">{d ? d.name : ""} {s.start}〜{s.end}</span>
              {on && <span className="ml-1 text-xs font-bold text-emerald-700">休出中</span>}
            </div>
            <button className={`${on ? btnDanger : btnSec} shrink-0`} onClick={() => onToggle(s.id, !on)}>
              {on ? "休日出勤を解除" : "出勤に追加"}
            </button>
          </div>
        );
      })}
      <div className="flex justify-end mt-3"><button className={btnPri} onClick={onClose}>閉じる</button></div>
    </Modal>
  );
}

/* ============================================================
   男性職員カバー状況(部署×時間帯)
   ============================================================ */
// 「利用者が居るのに男性職員ゼロ」の連続時間を部署ごとに判定。
// 連続時間が部署の許容(maleGapMin、既定30分)以内なら "warn"(黄)、超えたらその連続区間全体を "over"(赤)
function maleGapStatus(master, calc) {
  const res = {};
  master.departments.forEach((d) => {
    const tol = d.maleGapMin != null && d.maleGapMin !== "" ? Number(d.maleGapMin) : 30;
    const map = {};
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const over = run.length * SLOT > tol;
      run.forEach((t2) => { map[t2] = over ? "over" : "warn"; });
      run = [];
    };
    calc.forEach((c) => {
      const cc = c.cnt[d.id] || { u: 0 };
      const mc = c.per[d.id] || { present: [] };
      if (cc.u > 0 && mc.present.length === 0) run.push(c.t); else flush();
    });
    flush();
    res[d.id] = map;
  });
  return res;
}

// 部署×時間帯の人員(利用者数・在席職員数・送迎等で外出中の職員数・男性)を計算(人数表と車両の動きで共用)
function buildCoverageCalc(master, data, wd, hours) {
  const belongOf = (s) => belongDeptOf(master, s, wd); // 当日移動 > リベルタの兼務先 > 所属
  {
    const ovAll = data.staffOv || {};
    const absent = data.userAbsent || {};
    const userDept = data.userDept || {};
    // 利用者の在所: 便の迎え〜送り(なければ利用時間設定)
    const uRange = [];
    master.users.forEach((u) => {
      if (!(u.days || []).includes(wd) || absent[u.id]) return;
      let mi = null, mx = null;
      (data.runs || []).forEach((r) => {
        if (!(r.userIds || []).includes(u.id)) return;
        const t = toMin(r.time);
        if (t == null) return;
        if (r.kind === "meet" && (mi == null || t < mi)) mi = t;
        if (r.kind === "send" && (mx == null || t > mx)) mx = t;
      });
      const ut = userTimeOf(u, wd, data.userTime);
      if (mi == null) mi = toMin(ut.meet);
      if (mx == null) mx = toMin(ut.send);
      if (mi == null && mx == null) return;
      uRange.push({ from: mi != null ? mi : 9 * 60, to: mx != null ? mx : 16 * 60, dept: userDept[u.id] || u.deptId });
    });
    return hours.map((t) => {
      const per = maleCoverage(master, data, wd, t); // 男性の在席/外出(兼務先ベース)
      const cnt = {};
      master.departments.forEach((d) => { cnt[d.id] = { u: 0, s: 0, sOut: 0 }; });
      // 送迎・ヘルプで外出中の職員(所要時間: 設定値、未設定は約1時間)
      const awayTrip = new Set();
      (data.runs || []).forEach((r) => {
        const tr = toMin(r.time);
        const dur = Number(r.durMin) || 60;
        if (tr != null && t >= tr && t < tr + dur) {
          if (r.staffId) awayTrip.add(r.staffId);
          (r.staffRiderIds || []).forEach((id) => awayTrip.add(id));
        }
      });
      (data.blocks || []).forEach((b2) => {
        const tr = toMin(b2.time);
        const dur = b2.kind === "help" ? helpDurMin(b2) : (Number(b2.durMin) || 60);
        if (tr != null && t >= tr && t < tr + dur && b2.staffId) awayTrip.add(b2.staffId);
      });
      uRange.forEach((r) => { if (t >= r.from && t < r.to && cnt[r.dept]) cnt[r.dept].u++; });
      master.staff.forEach((s) => {
        if (HEADCOUNT_EXCLUDE.has(s.name)) return; // 与倉・古田は人員に数えない
        const o = ovAll[s.id] || {};
        if (o.off) return;
        if ((s.offDays || []).includes(wd) && !o.workToday) return;
        const eff = staffTimeOf(s, wd, o);
        const st = toMin(eff.start), en = toMin(eff.end);
        if (st == null || en == null || t < st || t + SLOT > en) return;
        const aw0 = toMin(s.awayFrom), aw1 = toMin(s.awayTo);
        if (aw0 != null && aw1 != null && t >= aw0 && t < aw1) return; // 中抜け不在
        const b = cnt[belongOf(s)];
        if (!b) return;
        if (awayTrip.has(s.id)) b.sOut++; // 送迎・ヘルプで外出中(所要時間を反映)
        else b.s++;
      });
      return { t, per, cnt };
    });
  }
}

function MaleCoveragePanel({ master, data, date }) {
  const wd = weekdayOf(date);
  // 30分刻み 8:30〜17:30
  const hours = [];
  for (let t = 8 * 60 + 30; t <= 17 * 60 + 30; t += SLOT) hours.push(t);
  const belongOf = (s) => belongDeptOf(master, s, wd);
  const calc = useMemo(() => buildCoverageCalc(master, data, wd, hours), [master, data, wd]);
  const gap = useMemo(() => maleGapStatus(master, calc), [master, calc]);
  const depts = master.departments.filter((d) => master.users.some((u) => u.deptId === d.id) || master.staff.some((s) => belongOf(s) === d.id));
  return (
    <div className="bg-white border border-stone-300 rounded-lg p-3">
      <div className="font-bold text-stone-700 text-sm mb-1">人数・男性カバー(部署 × 時間帯)</div>
      <div className="text-[11px] text-stone-500 mb-2">各部署の<b>上段=利用者数、下段=在席職員数</b>((外n)=送迎・ヘルプで外出中の職員数(所要時間を反映)、♂=うち男性、( )=外出中の男性)。リベルタ職員は兼務先でカウント、シフト・休み・中抜けを反映。職員数は常勤・パートを含む在席数(外出中を除く)で、与倉・古田は数えません。<span className="text-rose-600 font-bold">濃い赤=職員ゼロ(許容なし)</span>・<span className="text-rose-400 font-bold">うすい赤=男性ゼロが部署の許容分数超え</span>・<span className="text-amber-600 font-bold">黄=男性ゼロ(許容内)</span>。許容分数は部署タブで設定。</div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="border border-stone-200 bg-stone-50 px-1 py-0.5 sticky left-0" colSpan={2}>部署</th>
              {calc.map(({ t }) => (
                <th key={t} className={`border border-stone-200 bg-stone-50 px-1 py-0.5 font-normal ${t % 60 === 0 ? "text-stone-600" : "text-stone-300"}`}>{toStr(t)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => {
              const c = (DEPT_COLORS[master.departments.findIndex((x) => x.id === d.id) % DEPT_COLORS.length] || DEPT_COLORS[0]);
              const cellState = (t, per, cnt) => {
                const cc = cnt[d.id] || { u: 0, s: 0, sOut: 0 };
                const mc = per[d.id] || { present: [], away: [] };
                const mN = mc.present.length, mA = mc.away.length;
                const noStaff = cc.u > 0 && cc.s === 0;
                const gs = (gap[d.id] || {})[t]; // "warn"=男性ゼロ(許容内) / "over"=許容超え
                const capOver = d.capMax != null && d.capMax !== "" && cc.u + cc.s > Number(d.capMax); // 在席上限オーバー
                const stOver = d.staffMax != null && d.staffMax !== "" && cc.s > Number(d.staffMax); // 職員上限(駐車制約)オーバー
                const stUnder = d.staffMin != null && d.staffMin !== "" && cc.u > 0 && cc.s < Number(d.staffMin); // 職員下限割れ(利用者が居る時間帯)
                const empty = cc.u === 0 && cc.s === 0 && !(cc.sOut || 0);
                const bg = noStaff ? "bg-rose-200 text-rose-800 font-bold" : stUnder ? "bg-rose-100 text-rose-700 font-bold" : capOver || stOver ? "bg-orange-200 text-orange-900 font-bold" : gs === "over" ? "bg-rose-100 text-rose-700 font-bold" : gs === "warn" ? "bg-amber-50 text-amber-700" : empty ? "text-stone-300" : "text-stone-700";
                const tip = `利用者${cc.u}名 / 在席職員${cc.s}名` + (capOver ? ` / ⚠在席${cc.u + cc.s}名で上限${d.capMax}名を超過` : "") + (stOver ? ` / ⚠職員${cc.s}名で上限${d.staffMax}名を超過(駐車${d.staffMax}台分)` : "") + (stUnder ? ` / 🚨職員${cc.s}名で最低${d.staffMin}名を下回っています` : "") + (cc.sOut ? ` / 送迎等で外出中${cc.sOut}名` : "") + (mN ? ` / 男性:${mc.present.map((s) => s.name).join("・")}` : " / 男性なし") + (mA ? ` / 外出中男性:${mc.away.map((s) => s.name).join("・")}` : "");
                return { cc, mN, mA, bg, tip, empty };
              };
              return (
                <React.Fragment key={d.id}>
                  <tr>
                    <td rowSpan={2} className={`border border-stone-300 px-1 py-0.5 font-bold whitespace-nowrap sticky left-0 align-middle ${c.chip}`}>{d.name}</td>
                    <td className="border border-stone-200 bg-stone-50 px-1 py-0.5 text-[10px] text-stone-500 whitespace-nowrap">利用者</td>
                    {calc.map(({ t, per, cnt }) => {
                      const { cc, bg, tip, empty } = cellState(t, per, cnt);
                      return (
                        <td key={t} title={tip}
                          className={`border border-stone-200 px-1 py-0.5 text-center whitespace-nowrap ${bg}`}>
                          {empty ? "-" : cc.u}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b-2 border-stone-300">
                    <td className="border border-stone-200 bg-stone-50 px-1 py-0.5 text-[10px] text-stone-500 whitespace-nowrap">職員</td>
                    {calc.map(({ t, per, cnt }) => {
                      const { cc, mN, mA, bg, tip, empty } = cellState(t, per, cnt);
                      return (
                        <td key={t} title={tip}
                          className={`border border-stone-200 border-b-2 border-b-stone-300 px-1 py-0.5 text-center whitespace-nowrap ${bg}`}>
                          {empty ? "-" : <>
                            {cc.s}
                            {cc.sOut ? <span className="text-[9px] text-orange-500">(外{cc.sOut})</span> : null}
                            <span className="text-[9px] text-sky-600 align-bottom">♂{mN}{mA ? `(${mA})` : ""}</span>
                          </>}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   男性職員カバー状況ここまで
   ============================================================ */

/* ============================================================
   自動割当エンジン(決定的アルゴリズム)
   AIと違い、コード化された制約を総当たりでチェックして一瞬で確実に割り当てる。
   対象: ①保留の便・ヘルプへの担当割当 ②未割当利用者の便への配置(必要なら便を新設)
   制約: 勤務時間・休み・時間重複(職員/車両)・車の位置・定員・車いす・ヘルプ専任・
         リベルタ職員の送迎回避・希望時刻±60分・徒歩単独送迎
   ============================================================ */
function autoAssignSheet(master, data, wd) {
  const actions = [];
  const unresolved = [];
  let runs = (data.runs || []).map((r) => ({ ...r, userIds: [...(r.userIds || [])] }));
  let blocks = (data.blocks || []).map((b) => ({ ...b }));
  const libDeptObj = master.departments.find((d) => /リベルタ/.test(d.name));
  const libId = libDeptObj ? libDeptObj.id : "";
  const yome = master.departments.find((d) => d.name === "嫁島");
  const ovAll = data.staffOv || {};
  const absent = data.userAbsent || {};
  const nr = data.noRide || {};
  const dn = (id) => ((master.departments.find((d) => d.id === id) || {}).name || "?");
  const slots = []; for (let t0 = 6 * 60; t0 <= 20 * 60; t0 += SLOT) slots.push(t0);
  const clampSlot = (t0) => Math.max(slots[0], Math.min(slots[slots.length - 1], Math.floor(t0 / SLOT) * SLOT));

  const working = (s) => {
    const ov = ovAll[s.id] || {};
    if (ov.off) return false;
    if ((s.offDays || []).includes(wd) && !ov.workToday) return false;
    return true;
  };
  const inWork = (s, t0, dur) => {
    const eff = staffTimeOf(s, wd, ovAll[s.id] || {});
    const a = toMin(eff.start), b = toMin(eff.end);
    if (a == null || b == null) return true;
    return t0 >= a && t0 + dur <= b;
  };
  const staffBusy = (sid, t0, dur, exceptId) => {
    const hit = (x, d2) => { const t2 = toMin(x.time); return t2 != null && t2 < t0 + dur && t0 < t2 + d2; };
    return runs.some((r) => r.id !== exceptId && r.mode !== "walk" && (r.staffId === sid || (r.staffRiderIds || []).includes(sid)) && hit(r, Number(r.durMin) || SLOT))
      || blocks.some((b) => b.id !== exceptId && b.staffId === sid && hit(b, helpDurMin(b)));
  };
  const vehFree = (vid, t0, dur, exceptId) => {
    const trips = buildVehicleTrips({ runs, blocks })[vid] || [];
    return !trips.some((e) => e.id !== exceptId && e.t < t0 + dur && t0 < e.end);
  };
  const vehAt = (vid, t0) => {
    const pos = simulateVehicles(master, { runs, blocks }, slots);
    return (pos[vid] || {})[clampSlot(t0)];
  };
  const loadOf = () => {
    const load = {};
    runs.forEach((r) => { load[r.staffId] = (load[r.staffId] || 0) + 1; });
    blocks.forEach((b) => { load[b.staffId] = (load[b.staffId] || 0) + 1; });
    return load;
  };

  // 職員を選ぶ(同部署優先→リベ職員は送迎で後回し→予定の少ない人)
  const pickStaff = ({ t: t0, dur, deptId, needDrive, isHelp, exceptId }) => {
    const cands = master.staff.filter((s) => {
      if (s.noGrid) return false; // 与倉・古田など送迎表に出さない職員は割当対象外
      if (s.retireDate) return false; // 退職者は代役候補にしない
      if (!working(s)) return false;
      // リベルタ職員の時間帯ルール: 早番(9時前始業)は10時以降に各事業所へ、遅番(19時以降終業)は15:30にはリベルタへ帰る。
      // ヘルプは被らない限り可なので対象外(送迎のみ制限)
      if (!isHelp) {
        const libDept0 = master.departments.find((d2) => /リベルタ/.test(d2.name));
        if (libDept0 && s.deptId === libDept0.id) {
          const eff0 = staffTimeOf(s, wd, ovAll);
          const st0 = toMin(eff0.start), en0 = toMin(eff0.end);
          if (st0 != null && st0 < 9 * 60 && t0 < 10 * 60) return false; // 早番は10時前の送迎NG
          if (en0 != null && en0 > 19 * 60 && t0 + dur > 15 * 60 + 30) return false; // 遅番は15:30以降の送迎NG
        }
      }
      if (!isHelp && s.helpOnly) return false; // 久保田等は送迎不可
      if (needDrive && !s.canDrive) return false;
      if (!inWork(s, t0, dur)) return false;
      if (staffBusy(s.id, t0, dur, exceptId)) return false;
      const aw0 = toMin(s.awayFrom), aw1 = toMin(s.awayTo);
      if (aw0 != null && aw1 != null && t0 < aw1 && t0 + dur > aw0) return false;
      // 直帰ルール: 他部署の予定が勤務終了30分前以降に終わる割当は不可(自車のある自部署へ戻れない)
      if (belongDeptOf(master, s, wd) !== deptId) {
        const eff2 = staffTimeOf(s, wd, ovAll[s.id] || {});
        const en2 = toMin(eff2.end);
        if (en2 != null && t0 + dur > en2 - 30) return false;
      }
      return true;
    });
    const load = loadOf();
    const score = (s) => (belongDeptOf(master, s, wd) === deptId ? 0 : 20)
      + (s.deptId === libId && !isHelp ? 50 : 0)   // リベルタ職員は送迎の候補として後回し
      + (isHelp && s.deptId === libId ? -3 : 0)    // ヘルプはむしろリベ職員を少し優先
      + (load[s.id] || 0);
    cands.sort((a, b2) => score(a) - score(b2) || a.name.localeCompare(b2.name));
    return cands[0] || null;
  };
  // 車を選ぶ(職員の部署にある空き車→嫁島の空き車)
  const pickVehicle = ({ t: t0, dur, deptId, needWc }) => {
    const ok = (v) => (!needWc || v.wheelchairOK) && vehFree(v.id, t0, dur) && !(ACTIVITY_VEHICLES[v.name] && inActivityWindow(t0, t0 + dur));
    let v = master.vehicles.find((v2) => ok(v2) && vehAt(v2.id, t0) === deptId);
    if (!v && yome) v = master.vehicles.find((v2) => ok(v2) && vehAt(v2.id, t0) === yome.id);
    return v || null;
  };

  // ---- ① 保留の便へ担当を割り当て ----
  runs.forEach((r) => {
    if (r.staffId !== HOLD_ID) return;
    if (r.kind !== "meet" && r.kind !== "send" && r.kind !== "other_run") return;
    const t0 = toMin(r.time);
    if (t0 == null) return;
    const dur = Number(r.durMin) || SLOT;
    const firstU = master.users.find((u) => (r.userIds || []).includes(u.id));
    const deptId = (firstU && firstU.deptId) || (yome && yome.id);
    const needDrive = !!r.vehicleId && !String(r.vehicleId).startsWith("own:") && r.mode !== "walk";
    const s = pickStaff({ t: t0, dur, deptId, needDrive, isHelp: false, exceptId: r.id });
    if (s) {
      r.staffId = s.id;
      actions.push(`保留の${r.time} ${r.kind === "meet" ? "迎え" : r.kind === "send" ? "送り" : "外出"}便 → 担当を${s.name}に`);
    } else {
      unresolved.push(`保留の${r.time}の便: この時間に入れる職員が見つかりません(勤務時間・重複をすべて確認済み)`);
    }
  });

  // ---- ② 保留のヘルプへ担当+移動手段 ----
  blocks.forEach((b) => {
    if (b.kind !== "help" || b.staffId !== HOLD_ID) return;
    const t0 = toMin(b.time);
    if (t0 == null) return;
    const dur = helpDurMin(b);
    const maleOnly = /赤山/.test(b.label || "") && /入浴/.test((b.label || "") + (b.note || ""));
    const uHelp = master.users.find((u) => (b.userIds || []).includes(u.id));
    const deptId = (uHelp && uHelp.deptId) || (yome && yome.id);
    let s = pickStaff({ t: t0, dur, deptId, needDrive: false, isHelp: true, exceptId: b.id });
    if (maleOnly && s && !s.isMale) {
      s = master.staff.filter((x) => x.isMale && working(x) && inWork(x, t0, dur) && !staffBusy(x.id, t0, dur, b.id))[0] || null;
    }
    if (!s) { unresolved.push(`保留のヘルプ「${b.label}」(${b.time}): 担当できる職員が見つかりません`); return; }
    b.staffId = s.id;
    if (!b.vehicleId) {
      const v = pickVehicle({ t: t0, dur, deptId: belongDeptOf(master, s, wd), needWc: false });
      b.vehicleId = v ? v.id : (s.canDrive ? "own:" + s.id : "");
      actions.push(`保留のヘルプ「${b.label}」(${b.time}) → ${s.name}(${v ? v.name : "自車"})`);
    } else {
      actions.push(`保留のヘルプ「${b.label}」(${b.time}) → 担当を${s.name}に`);
    }
  });

  // ---- ③ 未割当利用者を便へ(既存便への追加を優先、無ければ新設) ----
  ["meet", "send"].forEach((kind) => {
    const asg = new Set();
    runs.forEach((r) => {
      (r.userIds || []).forEach((id) => { if (rideIs(rideKindOf(r, id), kind)) asg.add(id); });
    });
    const todo = master.users.filter((u) => (u.days || []).includes(wd) && !absent[u.id] && !(nr[u.id] || {})[kind] && !asg.has(u.id));
    todo.sort((a, b2) => (toMin(userTimeOf(a, wd, data.userTime)[kind]) || 0) - (toMin(userTimeOf(b2, wd, data.userTime)[kind]) || 0));

    todo.forEach((u) => {
      let want = toMin(userTimeOf(u, wd, data.userTime)[kind]);
      if (want == null) want = kind === "meet" ? 9 * 60 : 16 * 60; // 未設定は標準時刻(迎え9:00/送り16:00)扱い
      const isWalkUser = /徒歩で単独/.test(u.helpNote || "");
      // 既存便から候補を探す
      const cands = runs.filter((r) => {
        if (r.kind !== kind || r.mode || r.staffId === HOLD_ID) return false;
        const stf = master.staff.find((s) => s.id === r.staffId);
        if (!stf) return false;
        // 部署の一致: 便の担当の実所属か、既存の乗車者に同部署が居ること
        const sameDept = belongDeptOf(master, stf, wd) === u.deptId ||
          (r.userIds || []).some((id) => { const x = master.users.find((y) => y.id === id); return x && x.deptId === u.deptId; });
        if (!sameDept) return false;
        const t0 = toMin(r.time);
        if (t0 == null) return false;
        if (want != null && Math.abs(t0 - want) > 60) return false; // 希望±60分
        const veh = resolveVehicle(master, r.vehicleId);
        if (veh) {
          const riders = (r.userIds || []).length + (r.staffRiderIds || []).length;
          const wcCount = (r.userIds || []).filter((id) => { const x = master.users.find((y) => y.id === id); return x && x.wheelchair; }).length;
          if (u.wheelchair && !veh.wheelchairOK) return false;
          if (veh.ownerOnly) {
            if (riders + 1 > veh.capNormal) return false; // 自車は従来どおり
          } else {
            // 警告(定員超過)と同じ数え方: 追加後の利用者+同乗職員+運転手 が 定員(車いすがいれば車いす時の定員) 以内
            const wcAfter = wcCount + (u.wheelchair ? 1 : 0);
            const cap = wcAfter > 0 ? (veh.capWc || 0) : veh.capNormal;
            if (riders + 1 + 1 > cap) return false;
          }
        } else if (u.wheelchair) return false;
        return true;
      });
      const ngIds0 = ngPartnersOf(master, u.id);
      const cands2 = ngIds0.length ? cands.filter((c) => !(c.userIds || []).some((id2) => ngIds0.includes(id2))) : cands.slice(); // slice: 同じ配列を空にしないため
      cands.length = 0; cands.push(...cands2);
      cands.sort((a, b2) => Math.abs((toMin(a.time) || 0) - (want || 0)) - Math.abs((toMin(b2.time) || 0) - (want || 0)));
      if (cands.length) {
        cands[0].userIds.push(u.id);
        actions.push(`${u.name}を${cands[0].time}の${kind === "meet" ? "迎え" : "送り"}便へ追加`);
        return;
      }
      // 新設
      const t0 = clampSlot(want != null ? (kind === "meet" ? Math.max(6 * 60, want - SLOT) : want) : (kind === "meet" ? 9 * 60 : 16 * 60));
      if (isWalkUser) {
        let s = pickStaff({ t: t0, dur: SLOT, deptId: u.deptId, needDrive: false, isHelp: false });
        // 徒歩の単独送迎は必ず同じ部署の職員(他部署の職員では直帰できない)
        if (s && belongDeptOf(master, s, wd) !== u.deptId) s = null;
        if (!s) { unresolved.push(`${u.name}の${kind === "meet" ? "迎え" : "送り"}(徒歩): 同じ部署で入れる職員が見つかりません`); return; }
        runs.push({ id: uid(), kind, mode: "walk", time: toStr(t0), staffId: s.id, vehicleId: "", userIds: [u.id], staffRiderIds: [] });
        actions.push(`${u.name}の${kind === "meet" ? "迎え" : "送り"}を新設(徒歩・${toStr(t0)}・${s.name})`);
        return;
      }
      const s = pickStaff({ t: t0, dur: SLOT, deptId: u.deptId, needDrive: true, isHelp: false });
      if (!s) { unresolved.push(`${u.name}の${kind === "meet" ? "迎え" : "送り"}(${want != null ? toStr(want) : "時刻未設定"}): この時間に運転できる職員が見つかりません`); return; }
      const v = pickVehicle({ t: t0, dur: SLOT, deptId: belongDeptOf(master, s, wd), needWc: !!u.wheelchair });
      if (!v) { unresolved.push(`${u.name}の${kind === "meet" ? "迎え" : "送り"}(${toStr(t0)}): 使える車がありません(${dn(belongDeptOf(master, s, wd))}にも嫁島にも空きなし)`); return; }
      runs.push({ id: uid(), kind, time: toStr(t0), staffId: s.id, vehicleId: v.id, userIds: [u.id], staffRiderIds: [] });
      actions.push(`${u.name}の${kind === "meet" ? "迎え" : "送り"}を新設(${toStr(t0)}・${s.name}・${v.name})`);
    });
  });

  return { runs, blocks, actions, unresolved };
}

/* ============================================================
   いま使える車パネル(送迎表タブのサイドに表示するコンパクト版)
   ============================================================ */
function VehicleNowPanel({ master, data, hoverTime }) {
  const safeData = data || { runs: [], blocks: [] };
  const slots = useMemo(() => { const a = []; for (let t = 6 * 60; t <= 19 * 60; t += SLOT) a.push(t); return a; }, []);
  const posAt = useMemo(() => simulateVehicles(master, safeData, slots), [master, safeData, slots]);
  const nowSlotOf = () => {
    const d0 = new Date();
    const m0 = d0.getHours() * 60 + Math.floor(d0.getMinutes() / SLOT) * SLOT;
    return Math.max(slots[0], Math.min(slots[slots.length - 1], m0));
  };
  const [sel, setSel] = useState(nowSlotOf());
  const [follow, setFollow] = useState(true); // 表のマスにポインターを載せると時刻が連動(手動で時刻を触ると一時停止)
  useEffect(() => {
    if (!follow || hoverTime == null) return;
    const t2 = Math.max(slots[0], Math.min(slots[slots.length - 1], Math.floor(hoverTime / SLOT) * SLOT));
    setSel(t2);
  }, [hoverTime, follow, slots]);
  const vShort = {};
  master.vehicles.forEach((v) => { vShort[v.id] = v.name.slice(0, 3); });
  const CHIP = ["bg-sky-100 border-sky-300", "bg-amber-100 border-amber-300", "bg-emerald-100 border-emerald-300", "bg-rose-100 border-rose-300", "bg-violet-100 border-violet-300"];
  const deptIdx = (id) => Math.max(0, master.departments.findIndex((d) => d.id === id)) % CHIP.length;
  const depts = master.departments.filter((d) => master.vehicles.some((v) => v.deptId === d.id || (posAt[v.id] && posAt[v.id][sel] === d.id)));
  const inAct = (v) => ACTIVITY_VEHICLES[v.name] && inActivityWindow(sel, sel + SLOT);
  const moving = master.vehicles.filter((v) => posAt[v.id] && posAt[v.id][sel] === null);
  return (
    <div className="border-2 border-sky-200 bg-sky-50/60 rounded-lg p-2 mb-3">
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        <span className="font-bold text-sky-900 text-xs">🚗 使える車</span>
        <button className="text-[10px] px-1 rounded border border-stone-300 bg-white" onClick={() => { setFollow(false); setSel((s) => Math.max(slots[0], s - SLOT)); }}>◀</button>
        <select className="text-[11px] border border-stone-300 rounded px-0.5 py-0.5 bg-white" value={sel} onChange={(e) => { setFollow(false); setSel(Number(e.target.value)); }}>
          {slots.map((s) => <option key={s} value={s}>{toStr(s)}</option>)}
        </select>
        <button className="text-[10px] px-1 rounded border border-stone-300 bg-white" onClick={() => { setFollow(false); setSel((s) => Math.min(slots[slots.length - 1], s + SLOT)); }}>▶</button>
        <button className="text-[10px] px-1.5 rounded border border-sky-400 bg-sky-100 text-sky-800 font-bold" title="現在時刻に戻し、表のマスとの連動を再開します" onClick={() => { setFollow(true); setSel(nowSlotOf()); }}>今</button>
        <span className={`text-[9px] ${follow ? "text-sky-600" : "text-stone-400"}`} title="表のマスにポインターを載せると、その時間帯に自動で切り替わります">{follow ? "連動中" : "固定"}</span>
      </div>
      <div className="space-y-0.5">
        {depts.map((d) => {
          const here = master.vehicles.filter((v) => posAt[v.id] && posAt[v.id][sel] === d.id);
          return (
            <div key={d.id} className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] font-bold text-stone-500 w-12 shrink-0">{d.name.slice(0, 4)}:</span>
              {here.length === 0 ? <span className="text-[10px] text-rose-500 font-bold">なし</span> : here.map((v) => (
                inAct(v)
                  ? <span key={v.id} className="text-[10px] px-1 rounded border border-stone-300 bg-stone-100 text-stone-400 line-through" title={`${ACTIVITY_VEHICLES[v.name]}の活動で使用中`}>{vShort[v.id]}</span>
                  : <span key={v.id} className={`text-[10px] px-1 rounded border font-bold ${CHIP[deptIdx(v.deptId)]}`}>{vShort[v.id]}</span>
              ))}
            </div>
          );
        })}
        {moving.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-bold text-stone-400 w-12 shrink-0">移動中:</span>
            {moving.map((v) => <span key={v.id} className="text-[10px] px-1 rounded border border-stone-300 bg-white text-stone-400">{vShort[v.id]}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   リベルタ実績CSVモーダル: CSV取込(月単位保存)と、当日のリベ迎振り分け
   ============================================================ */
function LibCsvModal({ master, date, hasSheet, onAssign, onDiff, onClose }) {
  const [saved, setSaved] = useState(null);   // 保存済みデータ(全期間)
  const [preview, setPreview] = useState(null); // 今回読み込んだ{日数, マッチ, 未マッチ}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { (async () => setSaved((await sGet("libSvcCsv")) || {}))(); }, []);

  const processText = async (text) => {
    setBusy(true);
    setErr("");
    try {
      const parsed = parseLibCsv(text);
      const dates = Object.keys(parsed).sort();
      if (!dates.length) { setErr("CSVから日付・時刻を読み取れませんでした(介護ソフトの計画実績CSVか確認してください)"); setBusy(false); return; }
      const matched = new Set(), unmatched = new Set();
      dates.forEach((d) => Object.keys(parsed[d]).forEach((fn) => {
        const u = matchUserByFullName(master.users, fn);
        if (u) matched.add(fn); else unmatched.add(fn);
      }));
      const merged = { ...(saved || {}), ...parsed }; // 日付単位で上書きマージ
      await sSet("libSvcCsv", merged);
      setSaved(merged);
      setPreview({ from: dates[0], to: dates[dates.length - 1], days: dates.length, matched: matched.size, unmatched: [...unmatched] });
    } catch (e1) {
      console.error(e1);
      setErr("CSVの読み込みでエラー: " + String((e1 && e1.message) || e1));
    }
    setBusy(false);
  };

  const onFile = async (file) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text = "";
    try { text = new TextDecoder("shift-jis").decode(buf); } catch (e0) { text = new TextDecoder("utf-8").decode(buf); }
    if (!/実施予定日|予定開始/.test(text.slice(0, 300))) {
      const t2 = new TextDecoder("utf-8").decode(buf);
      if (/実施予定日|予定開始/.test(t2.slice(0, 300))) text = t2;
    }
    await processText(text);
  };

  const onPaste = async () => {
    setErr("");
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !/実施予定日|予定開始/.test(text.slice(0, 300))) {
        setErr("クリップボードにCSVデータが見つかりません。エクスポートツールを先に実行してください(CSVの中身が自動でコピーされます)");
        return;
      }
      await processText(text);
    } catch (e2) {
      setErr("クリップボードを読み取れませんでした。ブラウザの許可を確認するか、下のファイル選択を使ってください");
    }
  };

  const dayData = saved && saved[date];
  return (
    <Modal title="🚌 リベルタ実績CSV(朝サービス→リベ迎の振り分け)" onClose={onClose} wide>
      <p className="text-sm text-stone-600 mb-2">
        介護ソフトの計画実績CSVから、利用者ごとの<b>朝サービスの終了時刻</b>と<b>夕方サービスの開始時刻</b>を記録します。
        <b>迎え</b>: 嫁島行きは 9:00までに終わる人=1便目(ピカ) / 9:00超=2便目(ドラ・9:30)。津田行きは1台のまま。
        <b>送り</b>: 嫁島・津田とも 16:30までにサービスがある人=1便目 / 17:00以降の人=2便目。
        月が変わったら新しいCSVを読み込むだけでOKです(日付単位で上書き保存)。
      </p>
      <div className="mb-3 border-2 border-dashed border-sky-300 rounded-lg p-3 bg-sky-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); }}>
        <div className="flex items-center gap-2 flex-wrap">
          <button className={btnPri} onClick={onPaste}>📋 クリップボードから読み込み</button>
          <span className="text-xs text-stone-500">エクスポートツール実行後はこのボタンだけでOK</span>
        </div>
        <div className="text-xs text-stone-400 mt-2">または CSVファイルをここにドラッグ&ドロップ / <input type="file" accept=".csv" className="text-xs" onChange={(e) => onFile(e.target.files && e.target.files[0])} /></div>
        {busy && <div className="text-xs text-stone-500 mt-1">読み込み中…</div>}
      </div>
      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 mb-3">{err}</div>}
      {preview && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 rounded p-2 mb-3">
          ✓ {preview.from}〜{preview.to}({preview.days}日分)を保存しました。利用者の照合: {preview.matched}名
          {preview.unmatched.length > 0 && (
            <div className="text-amber-700 mt-1">⚠ アプリの利用者と一致しなかった名前: {preview.unmatched.join("・")}(振り分け対象外)</div>
          )}
        </div>
      )}
      <div className="text-sm border border-stone-200 rounded p-2 mb-3">
        {(() => {
          const am = dayData ? (dayData.am || dayData) : null; // 旧形式(フラット)も朝として扱う
          const pm = dayData ? (dayData.pm || {}) : null;
          return (
            <>
              <b>{date} のデータ:</b> {am && Object.keys(am).length ? `朝${Object.keys(am).length}名` : "朝なし"} / {pm && Object.keys(pm).length ? `夕${Object.keys(pm).length}名` : "夕なし"}
              {am && Object.keys(am).length > 0 && (
                <div className="text-xs text-stone-500 mt-1 max-h-20 overflow-y-auto">
                  朝: {Object.entries(am).sort((a, b) => toMin(a[1]) - toMin(b[1])).map(([n, t]) => `${n}(〜${t})`).join(" / ")}
                </div>
              )}
              {pm && Object.keys(pm).length > 0 && (
                <div className="text-xs text-stone-500 mt-1 max-h-20 overflow-y-auto">
                  夕: {Object.entries(pm).sort((a, b) => toMin(a[1]) - toMin(b[1])).map(([n, t]) => `${n}(${t}〜)`).join(" / ")}
                </div>
              )}
            </>
          );
        })()}
      </div>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>閉じる</button>
        <button className={btnSec} disabled={!dayData || !hasSheet} title="振り分けはせず、CSVと現在の送迎表の違い(利用者の過不足・便の時間帯・職員のサービス重複)だけを確認します"
          onClick={() => onDiff && onDiff(dayData)}>🔍 送迎表と照合</button>
        <button className={btnPri} disabled={!dayData || !hasSheet} title={!hasSheet ? "先に送迎表を作成してください(パターンから読込)" : ""}
          onClick={() => onAssign(dayData)}>この日のリベ迎・リベ送を振り分ける</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   AI調整モーダル(当日の欠席・休みを踏まえてAIが便を組み替え)
   ============================================================ */
function AiAdjustModal({ master, data, weekday, focusUserName, focusKind, onApply, onClose }) {
  const [stage, setStage] = useState("confirm"); // confirm | busy | result | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [instruction, setInstruction] = useState(""); // 最初の自由入力(今日の状況・要望)
  // 勤務変更フォーム: {id, name, off?:true, start?, end?} の配列。反映時にstaffOvへ確実に登録される
  const [wcList, setWcList] = useState([]);
  const [wcStaffId, setWcStaffId] = useState("");
  const [wcStart, setWcStart] = useState("");
  const [wcEnd, setWcEnd] = useState("");
  const addWc = (off) => {
    const s = master.staff.find((x) => x.id === wcStaffId);
    if (!s) { return; }
    if (!off && !wcStart && !wcEnd) return;
    setWcList((prev) => [...prev.filter((x) => x.id !== s.id), off ? { id: s.id, name: s.name, off: true } : { id: s.id, name: s.name, start: wcStart || undefined, end: wcEnd || undefined }]);
    setWcStaffId(""); setWcStart(""); setWcEnd("");
  };
  const [followup, setFollowup] = useState("");       // 結果への追加指示
  const [convo, setConvo] = useState(null);           // 対話履歴(作り直し用)
  const [idMap, setIdMap] = useState({});
  const [refInfo, setRefInfo] = useState({}); // id("r1"等)→人が読める説明(時刻・担当・乗車者)

  const build = () => {
    const dn = (id) => { const d = master.departments.find((x) => x.id === id); return d ? d.name : ""; };
    const ov = { ...(data.staffOv || {}) };
    wcList.forEach((w) => { ov[w.id] = { ...(ov[w.id] || {}), ...(w.off ? { off: true } : { start: w.start, end: w.end }) }; });
    const absent = data.userAbsent || {};
    const { isLibOn } = makeLibNameHelpers(data, weekday);
    const staffOn = master.staff.filter((s) => !s.noGrid).map((s) => {
      const o = ov[s.id] || {};
      const off = !!o.off || ((s.offDays || []).includes(weekday) && !o.workToday);
      const libDept = master.departments.find((d2) => /リベルタ/.test(d2.name));
      return { name: s.name, dept: dn(belongDeptOf(master, s, weekday)), time: `${o.start || s.start}-${o.end || s.end}`, male: !!s.isMale, ...(libDept && s.deptId === libDept.id ? { lib: true } : {}), ...(s.helpOnly ? { helpOnly: true } : {}), off };
    });
    const users = master.users.filter((u) => (u.days || []).includes(weekday)).map((u) => {
      const nr = (data.noRide || {})[u.id] || {};
      const t = userTimeOf(u, weekday, data.userTime);
      return {
        name: u.name, dept: dn(u.deptId), male: !!u.isMale, absent: !!absent[u.id], wc: !!u.wheelchair,
        libAM: (u.libertaAM || u.libertaPM) ? isLibOn(u, "meet") : false,
        libPM: (u.libertaAM || u.libertaPM) ? isLibOn(u, "send") : false,
        meet: nr.meet ? `なし(${nr.meet})` : (t.meet || ""),
        send: nr.send ? `なし(${nr.send})` : (t.send || ""),
        ...(u.helpNote ? { note: u.helpNote } : {}),
      };
    });
    const vehicles = master.vehicles.map((v) => ({ name: v.name, dept: dn(v.deptId), base: dn(vehicleHomeOf(master, v)), cap: v.capNormal, wc: v.wheelchairOK ? v.capWc : 0, ...(v.memo ? { note: v.memo } : {}) }));
    const runs = (data.runs || []).map((r, i) => ({
      id: "r" + (i + 1), _id: r.id,
      kind: r.kind === "meet" ? "迎" : r.kind === "send" ? "送" : "他", mode: r.mode || "", time: r.time, dur: Number(r.durMin) || 30,
      ...(r.destDeptId ? { dest: dn(r.destDeptId) } : {}),
      staff: (master.staff.find((s) => s.id === r.staffId) || {}).name || (r.staffId === HOLD_ID ? "保留" : "?"),
      veh: (resolveVehicle(master, r.vehicleId) || {}).name || "",
      users: (r.userIds || []).map((id) => (master.users.find((u) => u.id === id) || {}).name).filter(Boolean),
    }));
    // 未割当(迎え/送りがどの便にも入っていない人。訓練は別枠、送迎なし・欠席は除外)
    const asgMeet = new Set(), asgSend = new Set();
    (data.runs || []).forEach((r) => {
      if (r.kind !== "meet" && r.kind !== "send") return;
      (r.userIds || []).forEach((id) => { const k9 = rideKindOf(r, id); if (k9 && k9 !== "send") asgMeet.add(id); if (k9 && k9 !== "meet") asgSend.add(id); });
    });
    const nrAll = data.noRide || {};
    const schedUsers = master.users.filter((u) => (u.days || []).includes(weekday) && !absent[u.id]);
    const unMeet = schedUsers.filter((u) => !(nrAll[u.id] || {}).meet && !asgMeet.has(u.id)).map((u) => u.name);
    const unSend = schedUsers.filter((u) => !(nrAll[u.id] || {}).send && !asgSend.has(u.id)).map((u) => u.name);
    const helps = (data.blocks || []).filter((b) => b.kind === "help").map((b, i) => ({
      id: "h" + (i + 1), _id: b.id, time: b.time,
      staff: (master.staff.find((s) => s.id === b.staffId) || {}).name || (b.staffId === HOLD_ID ? "保留" : "?"),
      label: b.label || "", veh: (resolveVehicle(master, b.vehicleId) || {}).name || "",
      dur: helpDurMin(b),
      ...(b.note ? { note: b.note } : {}),
    }));
    const holdIds = runs.filter((r) => r.staff === "保留" || r.staff === "?").map((r) => r.id);
    const holdHelpIds = helps.filter((h) => h.staff === "保留" || h.staff === "?").map((h) => h.id);
    return { staffOn, users, vehicles, runs, helps, dn, unMeet, unSend, holdIds: [...holdIds, ...holdHelpIds] };
  };

  const buildPrompt = (p) => `あなたは介護事業所の送迎表作成の専門家です。本日(${DAYS[weekday]}曜)の送迎表を、当日の欠席・職員の休みを踏まえて必要最小限だけ調整してください。${focusUserName ? `\n【最優先タスク】未割当の「${focusUserName}」を適切な${focusKind === "meet" ? "迎え" : "送り"}便に割り当ててください(既存便への追加を優先、無理なら新設)。他の変更はこの割当に必要な範囲だけにしてください。` : ""}${wcList.length ? `\n【本日の勤務変更(登録済み・staffOnに反映済み)】${wcList.map((w) => w.off ? `${w.name}=休み` : `${w.name}=${w.start || "?"}〜${w.end || "?"}`).join("、")}。この職員の担当は勤務時間内に収まるよう振り替えること。` : ""}${instruction.trim() ? `\n【今日の状況・要望(必ず考慮)】\n${instruction.trim()}` : ""}

# 職員(off:true=本日休み。休みの職員に便を担当させない)
${JSON.stringify(p.staffOn)}
# 利用者(male=性別(true=男性)。absent:true=本日欠席→便から外す。libAM=朝リベルタから乗る/libPM=夕リベルタへ送る。meet/send=希望時刻、"なし(...)"=送迎不要。note=特記事項なので必ず考慮する)
${JSON.stringify(p.users)}
# 車両(dept=所属、base=朝の出発地=1日の最終帰着地、cap=定員、wc=車いす台数。noteに「ヘルプ用」とある車は送迎便には基本使わず、他に車が無い時のみ使用可)
${JSON.stringify(p.vehicles)}
# 拠点間の車での移動時間(分・概算)
${Object.entries(DEPT_TRAVEL_MIN).map(([k, v]) => k.replace("|", "→") + ":" + v).join("、")}
# 現在の便(dur=所要分、dest=終了後に車を置く事業所)
${JSON.stringify(p.runs.map(({ _id, ...rest }) => rest))}
# 現在のヘルプ(id "h◯"、dur=所要分。担当職員(staff)や時刻の変更を提案してよい。ヘルプの所要は基本60分、伊達のヘルプのみ30分を見込む)
${JSON.stringify(p.helps.map(({ _id, ...rest }) => rest))}
# 【必須タスク1】未割当の解消(以下の全員を必ずいずれかの便に入れる。1人も残さないこと)
迎えが未割当: ${p.unMeet.length ? p.unMeet.join("・") : "なし"}
送りが未割当: ${p.unSend.length ? p.unSend.join("・") : "なし"}
# 【必須タスク2】保留(担当未定)の解消(以下の予定に必ず出勤中の職員を割り当てる。保留のまま残さないこと)
保留の予定id: ${p.holdIds.length ? p.holdIds.join("、") : "なし"}

# ルール
${aiExtraRulesText(master)}- 欠席者(absent:true)を便から外す。担当職員が休み(off:true)の便は出勤中の職員へ振り替える(同じ部署を優先)
- 各事業所で「利用者が居るのに男性職員(male:true)がゼロ」の時間が連続で許容分数を超えないように運転手を選ぶ。許容: ${master.departments.map((d) => `${d.name}=${d.maleGapMin != null ? d.maleGapMin : 30}分`).join("、")}
- 【必須】未割当ゼロ: 上の「未割当」リストの全員を必ず便に入れる。既存便への追加を優先し、時間・定員が合わなければ便を新設する。1人も残さないこと。変更件数の上限より優先する
- 【必須】重複禁止: 1人の利用者は同じ種別(迎え/送り)で1つの便にだけ乗せる。利用者を別の便へ移すときは、移動先(addまたはusers追加のupdate)と、移動元の便からその人を外したupdate(usersを除外後の配列で指定)の両方を必ず出すこと。移動元の除外を忘れると重複になる
- 【必須】定員超過禁止: 便に利用者を追加・移動する前に必ず人数を数えること。(その便の利用者数+同乗職員数)が車の定員(cap)を超える案は出してはいけない。車いす(wc:true)の人数はその車の車いす枠(capWc)以内。乗せたい人数が入らない場合は、より大きい車への変更か便の分割を提案する
- 【必須】空の便禁止: 利用者が1人も乗らない迎え/送り便を作らない・残さない。必ず「誰を送迎するか」を先に決め、その後にその便に合う車を充てる順で考えること。利用者を全員移動して空になる便は削除(remove)のchangeを出す。車や職員の移動だけの便が必要なときは種別「他」を使うか、noteに「移動」「回送」と書く(その場合は利用者なしでも残る)
- 在席上限: ${master.departments.filter((d) => d.capMax != null && d.capMax !== "").map((d) => `${d.name}は各時間帯の在席人数(職員+利用者の合計)が${d.capMax}名を超えないように配置する`).join("。") || "なし"}。超えそうな場合は利用者の他事業所への中継移動や応援の出し方で調整する
- 職員数の上限: ${master.departments.filter((d) => d.staffMax != null && d.staffMax !== "").map((d) => `${d.name}は駐車場の制約で同じ時間帯に居られる職員が最大${d.staffMax}名(公用車と自車を合わせて${d.staffMax}台分)`).join("。") || "なし"}。応援や当日移動でこれを超える配置にしない
- 職員数の下限: ${master.departments.filter((d) => d.staffMin != null && d.staffMin !== "").map((d) => `${d.name}は利用者が居る時間帯の在席職員を最低${d.staffMin}名確保する`).join("。") || "なし"}。送迎・ヘルプで同時に出すぎて下回らないように組む
- リベルタ職員(lib:true)は基本、送迎便の担当にしない(ヘルプの担当を優先してあてる)。送迎の振替先はリベルタ以外の職員を優先し、どうしても居ない場合のみリベルタ職員を使う。既にパターンで担当している便(リベ迎のドラ便など)はそのままでよい
- リベルタ職員(lib:true)は基本、自家用車で各事業所へ移動する(公用車での通勤移動はしない。ドラ便担当者がドラをリベルタへ戻した後も自車で移動)
- 朝の直行ルール: 朝一に「自家用車で移動」の予定が付く職員は、嫁島以外の自部署へ直行する職員である。その移動時間帯(重なる30分)に同じ職員へ便・ヘルプを入れてはいけない(移動と送迎は同時にできない)。その職員に朝の便を任せたい場合は、移動が終わって自部署に着いた後の時刻の便にする。移動チップを作るときも同時刻の予定と重複させない
- 職員の直帰ルール: 成瀬・村松・春日は自車で川津に直接出勤しているため、1日の最後は川津に居る状態で終わらせる(最後の送迎で他部署や嫁島に行ったまま終わる案は不可)。それ以外の職員(リベ職員を除く)は嫁島出勤なので、1日の最後は公用車の終業回送とあわせて嫁島へ戻る形でよい。勤務終了の30分前以降に終わる予定を他部署の職員に割り当てない(例: 川津の成瀬が16時退勤なのに嫁島の三澤の16:00徒歩送りを担当する、は不可)
- 徒歩の単独送迎(門脇・三澤)は必ず利用者と同じ部署(嫁島)の職員が担当する。他部署の職員には割り当てない
- 中村のリベルタへの送りは2便目(17:00)に固定。1便目(16:00)や混載便に乗せない
- 中村の帰宅送り(自宅方面)は17:00以降に自宅着とする。所要約20分なので16:40より前に出発する便に乗せない
- 馬場は基本家族送迎(送迎なし)。送迎する場合は片道15分程度で、送りは17:00に嫁島を出発する(17:15頃着)
- 田中かの送りは16:30までに自宅着とする。片道15分程度なので16:15までに嫁島を出発する便に乗せる
- 同乗NG(相性): 早川と梶谷光、早川と梶谷奏は同じ便に乗せない
- 時刻厳守の利用者: ホン(迎9:30・はばたき16:15着)、小林(迎9:00・送16:30)、赤山の朝8:40。この3件は時刻をずらす提案をしない。他の川津利用者は±10分まで可
- 川津の回り便の組み合わせ目安: 月=田原・小林・赤山/水=青木・小林・赤山/金=青木・小林・田原。錦織秀は米原と同じ便なら米原の後に迎え(9:40ごろ)
- 野津彩・早川・錦織秀は車椅子だが座位可能。マイメロに車椅子3名利用でもこの3名は同乗できる
- 【必須】保留ゼロ: staff:"保留"の予定すべてに出勤中の職員を割り当てる(updateでstaffを指定)。時間帯が空いている同じ事業所の職員を優先
- 出力前の自己確認: changesを適用した結果、未割当リストの全員が便に入り、保留の予定すべてにstaffが付いていることを確認してから出力する
- どうしても割り当てられないもの(車・職員の時間がすべて重なる等)は、矛盾した案を無理に出さず "unresolved" に項目と理由を書いて残す(空なら省略可)
- 状況・要望の文中に職員の休み・欠勤(例: 「安達休み」「高井は病欠」)が書かれていたら: ①その職員を休み扱いにして担当便・ヘルプをすべて他の職員へ振り替え、②"staffOff"にその職員名を列挙する(アプリ側で休み登録される)。書かれていなければstaffOffは省略可
- 状況・要望の文中に職員の勤務時間変更(例: 「高井は10時から」「安達は15時で早退」)が書かれていたら: ①その時間外の担当を振り替え、②"staffTime"に名前と開始・終了を入れる(アプリ側で時間変更登録される)。片方だけの変更なら、変わらない方は元の時刻を入れる
- 送迎不要("なし")の人は便に乗せない。すでにその方向の便に乗っている場合は必ず外す。乗せ忘れ(利用予定・欠席でない・その方向の便に居ない人)がいれば既存便に追加するか便を新設
- 便の時刻と乗車者の希望時刻(meet/send)が${TIME_GAP_WARN_MIN}分以上ズレている便は、元パターンの時刻がずれていることが多いので、便の時刻を希望時刻付近へ振り直すか、その利用者を時間帯の合う別の便へ移す。迎え便は施設発のため希望到着の30〜60分前の出発が目安。時刻を変える場合は同乗者全員の希望・職員の勤務時間・車の空きと両立する時刻を選ぶこと
- 定員(cap)を守る。車いす(wc:true)の人は wc>0 の車のみ
- 便の時刻は担当職員の勤務時間内にする
- 職員や車が足りない場合は、他の事業所の職員+車で応援してよい(例: A事業所の利用者をB事業所の職員がB事業所の車で送迎)。その際は職員と車を同じ事業所の組み合わせにする
- 1つの便に複数事業所の利用者を混載してよい(例: C事業所の職員がC事業所の車で、A事業所とB事業所の利用者をまとめて送迎)
- ある事業所の職員が居なくなる時間帯は、その事業所の利用者を先に別事業所へ移動させ(kind:"他"の移動便、noteに「◯◯へ移動」と書く)、後で移動先の事業所から自宅へ送る2段構成にしてよい。その場合、後の送り便の出発事業所は移動先になる
- 同じ車・同じ職員を、時間の重なる複数の予定(time〜time+dur分)に入れない
- 朝の送迎の基本形: リベルタ職員(lib:true)以外の職員は朝は嫁島スタート(自家用車で直接自分の事業所へ行く場合を除く)。各職員は最初または2回目の迎え便で利用者を乗せ、そのまま自分の担当事業所へ向かう(嫁島発→利用者宅→担当事業所着)。朝の迎え便の組み立てはこの形を前提にする
- 朝のピカチュウ便(リベ迎え+田中便)の担当は曜日で固定: 月=安達、火=吉岡、水=高井、木=池田、金=安達。固定担当が休みの日以外は変更しない(固定担当が休みなら同じ事業所の職員で代役)
- 朝8:00のヘルプの固定: 黒田ヘルプ=井川がドナルドで(平日毎日)。藤井ヘルプ=火・金は余村慎が自車で、月・水・木は久保田がカービィで。担当が休みの日以外は変更しない
- 野津涼のヘルプの担当は火曜=余村慎、それ以外の曜日=余村和で固定。担当が休みの日以外は変更しない
- 12:00の透析対応の担当は固定: 月・火=高井、水・木=池田、金=伊達。担当が休みの日以外は変更しない
- リベルタ職員の時間帯ルール: 早番(9時前始業)は基本10時ごろから各事業所へ行くので、10時前の送迎便を新たに割り当てない(既存の9:30便は容認)。遅番(19時以降終業)は15:30頃にはリベルタに行くので、15:30以降の送迎便を割り当てない。ヘルプは被らない限りどちらも可
- 車の基地(朝のスタート=1日の最終帰着地): トラッキー=川津、ノンタン=あいのて、ドラ=リベルタ、それ以外は全て嫁島。1日の最後は各車を基地へ戻す形で便を組む
- 職員の通勤: リベ職員と成瀬・村松・春日以外は基本嫁島出勤で、そこから公用車で各事業所へ移動する(1日の最後も公用車の終業回送とあわせて嫁島へ戻る)。成瀬・村松・春日は自車で川津に直接出勤・直帰。リベ早番=リベ発→10時ごろ自車で各事業所→事業所で終了。リベ遅番=各事業所発→最終は自車でリベルタへ
- 入浴対応はヘルプ扱い。「入浴」とある予定は種別「ヘルプ」として職員を振ること(黒田・井上の15時以降は2名体制ルールも適用)。入浴を送迎便として扱わない
- リベルタへの送り(リベ送)の基本時刻: 嫁島=1便目16:00・2便目17:00。津田=同じく1便目16:00・2便目17:00。川津=17:00の1便のみ。あいのて=17:00(定員的に1便で乗り切らない場合のみ2便目を追加)。この基本時刻から大きく変えない
- リベ送の車: 嫁島発=セレナ、津田発=ピカチュウを基本にする。朝はピカ=嫁島行き・セレナ=津田行きなので、日中のどこか(活動や昼の移動のついで)で2台を入れ替える運用。夕方のリベ送でこの組み合わせから変えない
- リベルタ発の朝の便構成(毎日): 嫁島行きは8:30が1便目(ピカチュウ)、9:30に2便目・3便目(うち1台はドラ)。シエル行きは9:00に1〜2便。9:30のドラ便の職員は利用者を嫁島へ送った後、ドラを1人でリベルタへ戻し(ドラの基地=リベルタ)、その後は自家用車で自分の事業所へ移動する。この便構成は変えない
- 車の動き: 朝はbaseから出発→迎え後は職員の事業所に置かれる→途中の送り後も職員の事業所→最後の送りの後はbaseへ戻る。送りの出発時にその車がその事業所に無い組み合わせは避ける
- 応援・中継・車の移動を計画するときは、上の拠点間移動時間を所要(dur)に見込む。例: 津田の職員が川津の利用者を応援送迎するなら往路10分+送迎時間+復路10分
- helpOnly:trueの職員(久保田)は送迎便(迎え・送り)の担当にしない。ヘルプの担当のみ可
- 黒田・井上の夕方(15時以降)のヘルプは必ず同じ時刻に職員2名(同時刻のヘルプ2件)にする
- 窪田に松浦以外のヘルプを担当させる日は、窪田を嫁島配置(兼務先でなく嫁島側)として扱う
- 松浦は車いす。カービィは車いす不可のため、松浦のヘルプ・移送にはカービィを使わない(ケロッピーなど車いす対応車を使う)
- 錦織りは後部座席に乗せる(助手席は物を捨てたりすることがあり危ない)
- 時刻厳守の利用者(津田): 勝部(迎9:30・はばたき16:15着)、竹田寛(迎9:30・9:45を過ぎたら親の送りになる)、橋本(迎9:30・送17:30)
- 時刻厳守の利用者(あいのて): 増野(迎8:45/送16:45)、成相(迎8:00・嫁島で乗車)、石田の朝(迎8:40)。他のあいのて利用者は±10分可
- 竹田寛の迎えは乗り込みが大変な時があるため、常勤職員が担当するのが望ましい
- 津田の夕方の送りはケアウイングの予定次第で当日変動が多い。16:00ごろに嫁島から津田へ回る送り便を基本形として組んでよい(常勤2名のため15:50までの送り出しが難しい)
- 安部は水・木の16:00から黒田のヘルプに入る(現場では「シエルヘルプ」と呼ぶが黒田ヘルプと同じもの。二重に登録しない)
- 訓練がある利用者の送迎は4パターン: ④迎え(自宅で拾ってそのまま訓練先へ送る。例: 火曜・金曜の朝8:00の野津彩)。この便は「自宅で拾ってそのまま訓練先へ送る人」に登録し、表示は迎(訓送)。その日の迎えとして数えるので訓練送りの便を別に作らない
- 訓練がある利用者の送迎は3パターン: ①迎え→訓練送り→訓練迎え→送り(訓練の2便は別枠) ②迎え(訓練迎えが通常の迎えを兼ねる)→送り ③迎え→送り(訓練送りが通常の送りを兼ねる)。②③の便は「通常の迎え/送りも兼ねる人」に登録し、表示は迎(訓練)/送(訓練)になる。兼用にした人はその日の迎え/送りとして数えるので未割り当てにしない
- あい迎(あい迎①②など)はリベルタ発ではない。乗客(山崎・森口・梶谷奏・青山・藤井など)は自宅から拾ってあいのてへ送る通常の迎え便
- ヘルプの担当ルール: 女性利用者(male:false)のヘルプ(松浦のヘルプを除く)は、火曜・金曜以外は久保田を優先して担当にする(久保田は火・金が固定休)。男性利用者(male:true)の歯科受診ヘルプは、リベルタ所属(lib:true)の男性職員を優先する。赤山の入浴ヘルプは男性職員(male:true)のみ担当可(女性は不可)
- ヘルプの移動手段(必須): ヘルプには必ず車を付ける。使えるのは(a)担当職員がその時間に居る部署に置いてある公用車(車の現在地は「朝はbase→迎え後は職員の部署」の動きで判断)か、(b)担当職員の自車(veh:"自車")のどちらかだけ。他の部署にある車を割り当ててはいけない。部署に空き車が無ければ自車にする
- 生活介護の活動時間(10:30〜12:00と13:30〜15:00)は次の車が活動に使われ送迎に使えない: 嫁島=ピカチュウ、津田=セレナ、川津=マイメロ。あいのては4台のうち任意の2台を活動用に空けておく(=この時間帯にあいのての車を3台以上送迎に使わない)。例外: 訓練の人の迎え・送り(訓迎/訓送)は、活動に出ている車が活動の途中で拾ってよい
- 車の配置が良くない場合(送りの時刻にその事業所に車が無い等)は、便の "dest"(終了後に車を置く事業所)や "dur"(所要分)の変更・車の入れ替えを提案してよい。「この車は◯時以降△△に置いた方がよい」等の配置の助言があればnotesに書く
- 問題のない便は変更しない(changesに含めない)
- 変更が多い場合は重要なもの(未割当の解消・欠席・休み・送迎なし・重複の解消)を優先する。未割当の解消に必要な変更は件数の目安(15件)を超えてもよい
- 出力は次のJSONのみ。JSONの前後に説明文・前置き・コードフェンスを一切書かない。最初の文字は必ず { にする:
{"changes":[{"op":"update","id":"r1","staff":"職員名","veh":"車名(ヘルプは\"自車\"も可)","time":"8:30","users":["利用者名"],"dest":"部署名","dur":60},{"op":"add","kind":"迎","time":"15:30","staff":"職員名","veh":"車名","users":["利用者名"],"note":"補足"},{"op":"delete","id":"r2"}],"unresolved":[{"item":"利用者名や予定id","reason":"割り当てられない理由(例: 15:00台は全車使用中/職員の時間がすべて重複)"}],"staffOff":["状況・要望の文中で休みと書かれていた職員名"],"staffTime":[{"name":"文中で勤務時間の変更が書かれていた職員名","start":"10:00","end":"15:00"}],"notes":"変更理由と車の配置の助言(200字以内)"}
updateでは変更するキーだけ書けばよい。idが"h◯"のヘルプもupdateで担当(staff)・時刻(time)・車(veh)を変更できる。kindは「迎」「送」「他」(他=事業所間の移動便など)。destは車を置く事業所名、durは所要分。変更が不要なら {"changes":[],"notes":"調整不要"} と返す。`;

  const [busyMsg, setBusyMsg] = useState("");
  const [lastRaw, setLastRaw] = useState(""); // エラー時にAIの生の応答冒頭を見せる(原因調査用)
  const callAI = async (messages) => {
    setStage("busy");
    setBusyMsg("");
    try {
      // 途中で切れたJSONでも、完成している変更までを救出して読み取る
      const salvageJson = (s) => {
        const i0 = s.indexOf("{");
        if (i0 < 0) return null;
        const body = s.slice(i0);
        let cut = body.length;
        while (cut > 1) {
          const cand = body.slice(0, cut).replace(/,\s*$/, ""); // 末尾の中途半端なカンマは落とす
          for (const tail of ["", "]}", "}]}", '"}]}', '"]}']) {
            try {
              const p2 = JSON.parse(cand + tail);
              if (p2 && Array.isArray(p2.changes)) return p2;
            } catch (e2) { /* 次の候補へ */ }
          }
          const k2 = body.lastIndexOf("}", cut - 2);
          if (k2 < 0) break;
          cut = k2 + 1;
        }
        return null;
      };

      let msgs = [...messages];
      let allChanges = [];
      const notesAcc = [];
      const unresolvedAcc = [];
      const staffOffAcc = new Set();
      const staffTimeAcc = new Map(); // name -> {start, end}
      let stillTruncated = false;
      let jsonRetried = false; // JSON形式エラー時の自動出し直しは1回まで
      const MAX_ROUNDS = 10; // 完了するまで自動継続(暴走防止の安全上限のみ10回)
      let prevCount = -1; // 進捗チェック用: 新しい変更が増えなくなったら打ち切り

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        if (round > 1) setBusyMsg(`変更案が多いため、完了するまで続きを自動取得しています(${round}回目)…`);
        const sampler = window.claude && window.claude.use ? await window.claude.use("sample") : null;
        if (!sampler) throw new Error("この画面ではAI調整が使えません(claude.aiで開き、AIの利用を許可してください)");
        let sres;
        try { sres = await sampler(msgs, { modelTier: "default", cache: false }); }
        catch (e9) { throw new Error(e9 && e9.code === "rate_limited" ? "AIの利用が混み合っています。少し待ってからもう一度試してください" : e9 && e9.code === "not_granted" ? "AIの利用が許可されていません" : "AIに接続できませんでした"); }
        const dataRes = { content: [{ type: "text", text: sres.text || "" }], stop_reason: sres.truncated ? "max_tokens" : "end_turn" };
        const text = (dataRes.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
        const clean = text.replace(/```json|```/g, "").trim();
        let parsed = null;
        try { parsed = JSON.parse(clean); } catch (e0) { parsed = salvageJson(clean); }
        if (parsed && !Array.isArray(parsed.changes)) parsed = null;
        if (!parsed) {
          if (allChanges.length === 0 && !jsonRetried) {
            // 1回だけ、AIに「JSONだけで出し直して」と自動で修正依頼する
            jsonRetried = true;
            setBusyMsg("応答の形式を修正中(自動リトライ)…");
            msgs = [...msgs, { role: "assistant", content: text }, { role: "user", content: '出力がJSONとして読み取れませんでした。説明文・前置き・コードフェンスを一切書かず、{"changes":[...],"notes":"..."} のJSONだけをもう一度出してください。最初の文字は必ず { にしてください。' }];
            round--; // このラウンドをやり直す
            continue;
          }
          if (allChanges.length === 0) {
            setLastRaw((text || "").slice(0, 400));
            throw new Error("AIの応答からJSONを読み取れませんでした。もう一度試してください(下に応答の冒頭を表示しています)");
          }
          break; // 続き取得中の失敗は、それまでの分で確定
        }
        allChanges = [...allChanges, ...parsed.changes];
        if (Array.isArray(parsed.unresolved)) unresolvedAcc.push(...parsed.unresolved);
        if (Array.isArray(parsed.staffOff)) parsed.staffOff.forEach((n) => n && staffOffAcc.add(String(n)));
        if (Array.isArray(parsed.staffTime)) parsed.staffTime.forEach((x) => x && x.name && staffTimeAcc.set(String(x.name), { start: x.start || "", end: x.end || "" }));
        if (parsed.notes && parsed.notes !== "完了") notesAcc.push(parsed.notes);
        msgs = [...msgs, { role: "assistant", content: text }];
        if (dataRes.stop_reason !== "max_tokens") { stillTruncated = false; break; }
        stillTruncated = true;
        // 進捗チェック: 重複除去後の件数が前回から増えていなければ、同じ内容の繰り返しとみなして打ち切る
        const seenChk = new Set();
        const uniqCount = allChanges.filter((c) => {
          if (c.op === "add") return true;
          const k = `${c.op}|${c.id}`;
          if (seenChk.has(k)) return false;
          seenChk.add(k);
          return true;
        }).length;
        if (uniqCount === prevCount) break;
        prevCount = uniqCount;
        if (round < MAX_ROUNDS) {
          msgs = [...msgs, { role: "user", content: '応答が途中で切れました。ここまでに提案済みの変更は繰り返さず、残りの変更案だけを同じJSON形式({"changes":[...],"notes":"..."})で出してください。残りが無ければ {"changes":[],"notes":"完了"} と返してください。' }];
        }
      }

      // 同じ便への重複した変更(自動継続で同じ案が再送された場合)を除去
      const seen = new Set();
      const merged = allChanges.filter((c) => {
        if (c.op === "add") return true;
        const k = `${c.op}|${c.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      setConvo(msgs);
      setResult({ parsed: { changes: merged, unresolved: unresolvedAcc, staffOff: [...staffOffAcc], staffTime: [...staffTimeAcc.entries()].map(([name, t]) => ({ name, ...t })), notes: notesAcc.join(" / ") + (stillTruncated ? " ※安全のため自動継続を停止しました。反映後にもう一度AI調整すると残りを確認できます" : "") } });
      setFollowup("");
      setStage("result");
    } catch (err) {
      console.error(err);
      setError(String((err && err.message) || err));
      setStage("error");
    }
  };

  const start = () => {
    const p = build();
    setIdMap({
      ...Object.fromEntries(p.runs.map((r) => [r.id, { t: "runs", id: r._id }])),
      ...Object.fromEntries(p.helps.map((h) => [h.id, { t: "blocks", id: h._id }])),
    });
    const info = {};
    p.runs.forEach((r) => {
      const who = r.users.length ? `: ${r.users.slice(0, 3).join("・")}${r.users.length > 3 ? `ほか${r.users.length - 3}名` : ""}` : "";
      const kindName = r.kind === "迎" ? "迎え便" : r.kind === "送" ? "送り便" : "外出・移動の便";
      info[r.id] = `${r.time}の${kindName}(${r.staff}${r.veh ? "・" + r.veh : ""}${who})`;
    });
    p.helps.forEach((h) => { info[h.id] = `${h.time}のヘルプ「${h.label}」(${h.staff})`; });
    setRefInfo(info);
    callAI([{ role: "user", content: buildPrompt(p) }]);
  };

  const refine = () => {
    if (!convo || !followup.trim()) return;
    callAI([...convo, { role: "user", content: `追加の指示: ${followup.trim()}\n上記を反映して、同じJSON形式で変更案の全体を出し直してください(前回の案は置き換え)。` }]);
  };

  const changeLabel = (c) => {
    const isHelp2 = String(c.id || "").startsWith("h") || c.kind === "ヘルプ";
    const ref = refInfo[c.id] || (isHelp2 ? "ヘルプ" : "便");
    if (c.op === "delete") return `🗑 削除: ${ref}`;
    const parts = [];
    if (c.staff) parts.push(`担当を${c.staff}に`);
    if (c.veh) parts.push(`車を${c.veh}に`);
    if (c.time) parts.push(`時刻を${c.time}に`);
    if (c.dest) parts.push(`終了後は車を${c.dest}に置く`);
    if (c.dur) parts.push(`所要${c.dur}分`);
    if (Array.isArray(c.users)) parts.push(`乗車を「${c.users.join("・") || "なし"}」に`);
    if (c.note) parts.push(`メモ: ${c.note}`);
    if (c.label) parts.push(`内容: ${c.label}`);
    if (c.op === "add") {
      const kindName = c.kind === "ヘルプ" ? "ヘルプ" : c.kind === "迎" ? "迎え便" : c.kind === "送" ? "送り便" : "外出・移動の便";
      return `➕ 新しく作る: ${c.time || ""}の${kindName} — ${parts.join(" / ")}`;
    }
    return `✏ 変更: ${ref} — ${parts.join(" / ")}`;
  };

  return (
    <Modal title="🤖 AI調整(当日の欠席・休みを反映)" onClose={onClose} wide>
      {stage === "confirm" && (
        <div>
          <p className="text-sm text-stone-600 mb-2">
            {focusUserName ? <><b>「{focusUserName}」の{focusKind === "meet" ? "迎え" : "送り"}の割り当て</b>を最優先に、</> : null}現在の表(通常はパターンから読込済み)をベースに、本日の<b>欠席者・送迎なし・休みの職員・時間変更</b>を踏まえてAIが便を組み替えます。車の配置(行先・所要時間)の見直しも提案します。
          </p>
          <div className="mb-2 border border-sky-200 bg-sky-50 rounded-lg p-2">
            <div className="text-xs font-bold text-sky-800 mb-1">🏠 職員の休み・勤務時間変更(ここで入れると確実に反映されます)</div>
            <div className="flex items-center gap-1 flex-wrap">
              <select className="text-sm border border-stone-300 rounded px-1 py-1 bg-white" value={wcStaffId} onChange={(e) => setWcStaffId(e.target.value)}>
                <option value="">職員を選択…</option>
                {master.departments.map((d2) => (
                  <optgroup key={d2.id} label={d2.name}>
                    {master.staff.filter((s) => s.deptId === d2.id && !s.noGrid).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <button className="text-xs px-2 py-1 rounded border border-rose-300 bg-white text-rose-700 font-bold hover:bg-rose-50 disabled:opacity-40" disabled={!wcStaffId} onClick={() => addWc(true)}>休みにする</button>
              <span className="text-xs text-stone-400 mx-1">|</span>
              <input type="time" className="text-sm border border-stone-300 rounded px-1 py-0.5 bg-white" value={wcStart} onChange={(e) => setWcStart(e.target.value)} />
              <span className="text-xs text-stone-500">〜</span>
              <input type="time" className="text-sm border border-stone-300 rounded px-1 py-0.5 bg-white" value={wcEnd} onChange={(e) => setWcEnd(e.target.value)} />
              <button className="text-xs px-2 py-1 rounded border border-sky-300 bg-white text-sky-700 font-bold hover:bg-sky-50 disabled:opacity-40" disabled={!wcStaffId || (!wcStart && !wcEnd)} onClick={() => addWc(false)}>時間変更</button>
            </div>
            {wcList.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {wcList.map((w) => (
                  <span key={w.id} className={`text-xs px-2 py-0.5 rounded-full border font-bold ${w.off ? "bg-rose-100 border-rose-300 text-rose-800" : "bg-sky-100 border-sky-300 text-sky-800"}`}>
                    {w.name}: {w.off ? "休み" : `${w.start || ""}〜${w.end || ""}`}
                    <button className="ml-1 text-stone-400 hover:text-stone-700" onClick={() => setWcList((prev) => prev.filter((x) => x.id !== w.id))}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="mb-2">
            <div className="text-xs font-bold text-stone-600 mb-1">今日の状況・要望(自由入力・任意)</div>
            <textarea className={`${inputCls} h-20`} value={instruction} onChange={(e) => setInstruction(e.target.value)}
              placeholder="例: 今日は10時に会議、13時に受診対応、15時に来客の予定があるので考慮して / 午後は嫁島の車が足りなくなりがちなので早めに戻して / セレナは今日使わない" />
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
            AIの提案は下書きです。結果画面で追加の指示を出して作り直すこともできます。反映後は必ず表と⚠警告を確認してください。生成には10〜30秒ほどかかります。
          </p>
          <div className="flex justify-end gap-2">
            <button className={btnSec} onClick={onClose}>キャンセル</button>
            <button className={btnPri} onClick={start}>AIに調整案を作らせる</button>
          </div>
        </div>
      )}
      {stage === "busy" && (
        <div className="py-10 text-center text-stone-500">
          <div className="text-3xl mb-2 animate-pulse">🤖</div>
          AIが本日の条件を確認して調整案を作成中です…(10〜30秒)
          {busyMsg && <div className="text-xs text-sky-700 mt-2 font-bold">{busyMsg}</div>}
        </div>
      )}
      {stage === "error" && (
        <div>
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 mb-3">エラー: {error}</p>
          {lastRaw && (
            <div className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded p-2 mb-3 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              <b>AIの応答(冒頭):</b> {lastRaw}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button className={btnSec} onClick={onClose}>閉じる</button>
            <button className={btnPri} onClick={() => (convo ? callAI(convo.slice(0, -1)) : start())}>もう一度試す</button>
          </div>
        </div>
      )}
      {stage === "result" && result && (
        <div>
          <div className="text-sm text-stone-700 bg-sky-50 border border-sky-200 rounded p-2 mb-3">
            <b>AIのコメント:</b> {result.parsed.notes || "(なし)"}
          </div>
          {((result.parsed.staffOff || []).length > 0 || (result.parsed.staffTime || []).length > 0 || wcList.length > 0) && (
            <div className="text-sm text-sky-900 bg-sky-50 border border-sky-300 rounded p-2 mb-3">
              🏠 反映時に<b>勤務情報を登録</b>:
              {[
                ...wcList.map((w) => `${w.name}=${w.off ? "休み" : `${w.start || ""}〜${w.end || ""}`}(フォーム入力)`),
                ...(result.parsed.staffOff || []).map((n) => `${n}=休み`),
                ...(result.parsed.staffTime || []).map((x) => `${x.name}=${x.start || "?"}〜${x.end || "?"}`),
              ].join("、")}
            </div>
          )}
          {Array.isArray(result.parsed.unresolved) && result.parsed.unresolved.length > 0 && (
            <div className="text-sm text-amber-900 bg-amber-50 border-2 border-amber-400 rounded p-2 mb-3">
              <div className="font-bold">⚠ AIが割り当てられなかったもの({result.parsed.unresolved.length}件)</div>
              {result.parsed.unresolved.map((x, i) => <div key={i}>・{x.item}: {x.reason}</div>)}
            </div>
          )}
          {result.parsed.changes.length === 0 ? (
            <p className="text-sm text-stone-500 mb-3">変更は提案されませんでした(調整不要)。</p>
          ) : (
            <div className="text-sm mb-3 max-h-60 overflow-y-auto border border-stone-200 rounded p-2">
              {result.parsed.changes.map((c, i) => (
                <div key={i} className="py-0.5 border-b border-stone-100 last:border-0">{changeLabel(c)}</div>
              ))}
            </div>
          )}
          <div className="mb-3">
            <div className="text-xs font-bold text-stone-600 mb-1">気に入らない点があれば追加の指示を(対話で作り直し)</div>
            <div className="flex gap-2">
              <input className={inputCls} value={followup} onChange={(e) => setFollowup(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && followup.trim()) refine(); }}
                placeholder="例: 8:30のセレナ便は変えないで / 赤山の入浴は②のパターンで / 移動便は使わずに組んで" />
              <button className={btnSec + " shrink-0"} disabled={!followup.trim()} onClick={refine}>作り直す</button>
            </div>
          </div>
          <div className="flex justify-end gap-2 sticky bottom-0 bg-white pt-2">
            <button className={btnSec} onClick={onClose}>キャンセル</button>
            {result.parsed.changes.length > 0 && (
              <button className={btnPri} onClick={() => onApply(result.parsed.changes, idMap, result.parsed.unresolved || [], { notes: result.parsed.notes || "", lines: result.parsed.changes.map(changeLabel), staffOff: result.parsed.staffOff || [], staffTime: result.parsed.staffTime || [], workChanges: wcList, userRequest: instruction })}>この案を表に反映</button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   Excel取り込みモーダル(日付シート→週間パターン)
   ============================================================ */
function ImportModal({ master, weekday, targetLabel, onApply, onClose }) {
  const tgt = targetLabel || `${DAYS[weekday]}曜パターン`; // 取り込み先の表示名(日別 or 週間パターン)
  const [stage, setStage] = useState("pick"); // pick → sheets → preview
  const [wbInfo, setWbInfo] = useState(null); // { XLSX, wb, sheetNames }
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadXLSX = () =>
    new Promise((resolve, reject) => {
      if (window.XLSX) return resolve(window.XLSX);
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error("XLSX load failed"));
      document.head.appendChild(s);
    });

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      setWbInfo({ XLSX, wb, sheetNames: wb.SheetNames });
      // このアプリが出力したExcelは必ず「送迎表」シートなので、あればシート選択を省略して即解析
      const auto = wb.SheetNames.find((n) => String(n).trim() === "送迎表") || (wb.SheetNames.length === 1 ? wb.SheetNames[0] : null);
      if (auto) {
        try {
          const aoa = XLSX.utils.sheet_to_json(wb.Sheets[auto], { header: 1, raw: true, defval: null });
          setResult({ ...importMondayGrid(aoa, master), sheetName: auto });
          setStage("preview");
        } catch (e2) { setStage("sheets"); }
      } else setStage("sheets");
    } catch (err) {
      console.error(err);
      notify("Excelの読み込みに失敗しました。ファイル形式をご確認ください。", "error");
    }
    setBusy(false);
  };

  const pickSheet = (name) => {
    try {
      const { XLSX, wb } = wbInfo;
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      const res = importMondayGrid(aoa, master);
      setResult({ ...res, sheetName: name });
      setStage("preview");
    } catch (err) {
      console.error(err);
      notify("シートの解析に失敗しました。", "error");
    }
  };

  const uname = (id) => { const u = master.users.find((x) => x.id === id); return u ? u.name : "?"; };
  const sname = (id) => { const s = master.staff.find((x) => x.id === id); return s ? s.name : "?"; };
  const vname = (id) => { const v = resolveVehicle(master, id); return v ? v.name : "(車未定)"; };

  return (
    <Modal title={`Excelから${tgt}に取り込み`} onClose={onClose} wide>
      {stage === "pick" && (
        <div>
          <p className="text-sm text-stone-600 mb-3">
            既存の送迎表Excelファイルを選ぶと、上部の時間×職員グリッドを読み取り、車両・利用者をこのアプリのマスタと照合して<strong>{tgt}</strong>の候補を作ります。
          </p>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
            自動読み取りのため完璧ではありません。取り込み後、表を見て手直しする前提でお使いください。マスタに無い名前・表記ゆれは「未照合」として一覧表示します。
          </p>
          <input type="file" accept=".xlsx,.xls" onChange={onFile} className="text-sm" disabled={busy} />
          {busy && <div className="text-sm text-stone-500 mt-2">読み込み中…</div>}
        </div>
      )}

      {stage === "sheets" && wbInfo && (
        <div>
          <p className="text-sm text-stone-600 mb-2">取り込むシート(その曜日の送迎表)を選んでください:</p>
          <div className="max-h-64 overflow-y-auto grid grid-cols-2 gap-1">
            {wbInfo.sheetNames.map((n) => (
              <button key={n} className="text-sm text-left px-2 py-1.5 border border-stone-300 rounded hover:bg-sky-50" onClick={() => pickSheet(n)}>
                {n}
              </button>
            ))}
          </div>
          <button className={`${btnSec} mt-3`} onClick={() => setStage("pick")}>← ファイルを選び直す</button>
        </div>
      )}

      {stage === "preview" && result && (
        <div>
          <div className="bg-stone-50 border border-stone-200 rounded p-2 mb-3 text-xs text-stone-600">
            {result.log.map((l, i) => <div key={i}>・{l}</div>)}
          </div>
          <div className="text-sm font-bold text-stone-700 mb-1">便 {result.runs.length}件(先頭のみ表示)</div>
          <div className="max-h-40 overflow-y-auto border border-stone-200 rounded p-2 mb-2 text-xs">
            {result.runs.map((r) => (
              <div key={r.id} className="mb-0.5">
                <span className="font-semibold">{r.kind === "meet" ? "迎" : "送"} {r.time}</span> {sname(r.staffId)}→{vname(r.vehicleId)}
                {r.userIds.length ? " : " + r.userIds.map(uname).join("・") : " (利用者なし)"}
                {r.staffRiderIds.length ? " 〔同乗:" + r.staffRiderIds.map(sname).join("・") + "〕" : ""}
              </div>
            ))}
          </div>
          <div className="text-sm font-bold text-stone-700 mb-1">予定・ヘルプ {result.blocks.length}件</div>
          <div className="max-h-24 overflow-y-auto border border-stone-200 rounded p-2 mb-2 text-xs">
            {result.blocks.map((b) => <span key={b.id} className="inline-block mr-2">{b.time} {sname(b.staffId)}:{b.label}</span>)}
          </div>
          {result.unmatched.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded p-2 mb-3 text-xs text-rose-700">
              <div className="font-bold mb-0.5">未照合の名前 {result.unmatched.length}件(マスタ未登録か表記ゆれ。取り込み後に手動追加してください):</div>
              {result.unmatched.join("・")}
            </div>
          )}
          {result.srcWd != null && weekday != null && result.srcWd !== weekday && (
            <div className="bg-rose-100 border-2 border-rose-400 rounded p-2 mb-3 text-sm text-rose-800 font-bold">
              ⚠ 曜日が違います: 読み込んだファイルは<u>{DAYS[result.srcWd]}曜{result.srcDate ? `(${result.srcDate})` : ""}</u>の送迎表ですが、取り込み先は<u>{DAYS[weekday]}曜</u>です。このまま取り込んでよいですか?
            </div>
          )}
          <div className="bg-amber-50 border border-amber-200 rounded p-2 mb-3 text-xs text-amber-800">
            この内容で<strong>{tgt}を置き換えます</strong>(現在の{tgt}の内容は消えます)。
          </div>
          <div className="flex justify-between">
            <button className={btnSec} onClick={() => { setResult(null); setStage("pick"); }}>← ファイルを選び直す</button>
            <button className={btnPri} onClick={() => {
              // 曜日が違う場合は上の赤い警告で確認済み(このボタンが確定操作)
              onApply(result);
            }}>この内容で{tgt}に取り込む</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   曜日別部署の編集モーダル(職員・利用者共通)
   ============================================================ */
// 曜日別の勤務時間(早番・遅番・日勤など)を設定
function DayShiftModal({ name, baseStart, baseEnd, value, onSave, onClose }) {
  const [map, setMap] = useState(() => {
    const m = {};
    Object.entries(value || {}).forEach(([k, v]) => { m[k] = { ...v }; });
    return m;
  });
  const setDay = (i, field, val) => {
    setMap((prev) => {
      const n = { ...prev };
      const cur = { ...(n[i] || {}) };
      cur[field] = val;
      if (!cur.start && !cur.end) delete n[i]; else n[i] = cur;
      return n;
    });
  };
  const presets = [
    { label: "早番", start: "7:00", end: "16:00" },
    { label: "日勤", start: baseStart, end: baseEnd },
    { label: "遅番", start: "10:00", end: "19:00" },
    { label: "夜勤", start: "13:00", end: "22:00" },
  ];
  const applyPreset = (i, p) => setMap((prev) => ({ ...prev, [i]: { start: p.start, end: p.end } }));
  return (
    <Modal title={`${name} の曜日別 勤務時間`} onClose={onClose} wide>
      <div className="text-xs text-stone-500 mb-3">
        曜日ごとに勤務時間(早番・遅番・日勤など)が決まっている場合に設定します。未設定の曜日は基本時間({baseStart}〜{baseEnd})になります。ここで設定した時間は日別の送迎表・自動提案・男性カバーに反映されます。当日の早退・遅刻はこれまでどおり職員名クリックで個別に変更できます。
      </div>
      <div className="space-y-1.5">
        {DAY_ORDER.map((i) => {
          const cur = map[i] || {};
          const set = !!(cur.start || cur.end);
          return (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <span className={`w-6 text-sm font-bold text-center ${i === 0 ? "text-rose-600" : i === 6 ? "text-sky-600" : "text-stone-700"}`}>{DAYS[i]}</span>
              <input className="w-20 border border-stone-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400" placeholder={baseStart} value={cur.start || ""} onChange={(e) => setDay(i, "start", e.target.value.trim())} />
              <span className="text-stone-400">〜</span>
              <input className="w-20 border border-stone-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400" placeholder={baseEnd} value={cur.end || ""} onChange={(e) => setDay(i, "end", e.target.value.trim())} />
              <div className="flex gap-0.5">
                {presets.map((p) => (
                  <button key={p.label} className="text-[11px] px-1.5 py-0.5 rounded border border-stone-300 bg-white hover:bg-sky-50 text-stone-600"
                    onClick={() => applyPreset(i, p)} title={`${p.start}〜${p.end}`}>{p.label}</button>
                ))}
                {set && (
                  <button className="text-[11px] px-1.5 py-0.5 rounded border border-rose-200 bg-white hover:bg-rose-50 text-rose-500"
                    onClick={() => setDay(i, "start", "") || setMap((prev) => { const n = { ...prev }; delete n[i]; return n; })}>基本</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button className="text-[11px] px-2 py-1 rounded border border-rose-300 bg-white hover:bg-rose-50 text-rose-600" onClick={() => setMap({})}>全曜日を基本({baseStart}〜{baseEnd})に戻す</button>
        <span className="text-[11px] text-stone-400">プリセットの早番/遅番/夜勤の時刻は目安です。実際の時刻に直接書き換えてください。</span>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className={btnSec} onClick={onClose}>キャンセル</button>
        <button className={btnPri} onClick={() => {
          // 両方揃っている曜日のみ保存
          const clean = {};
          // 基本と同じ時間の曜日は保存しない(基本の時間を変えたときにそのまま追従させるため)
          Object.entries(map).forEach(([k, v]) => {
            if (!(v.start && v.end)) return;
            if (toMin(v.start) === toMin(baseStart) && toMin(v.end) === toMin(baseEnd)) return;
            clean[k] = { start: v.start, end: v.end };
          });
          onSave(clean);
        }}>保存</button>
      </div>
    </Modal>
  );
}

function DayDeptModal({ master, name, baseDeptId, value, onSave, onClose }) {
  const [map, setMap] = useState({ ...(value || {}) });
  const baseName = (master.departments.find((d) => d.id === baseDeptId) || {}).name || "";
  return (
    <Modal title={`${name} の曜日別部署`} onClose={onClose}>
      <div className="text-xs text-stone-500 mb-2">
        曜日によって所属部署が違う場合に設定します。未設定の曜日は基本部署({baseName})のままです。設定すると週間パターン・日別の送迎表・自動提案・Excel出力すべてに反映されます。
      </div>
      <div className="flex gap-1 mb-3">
        {DAY_ORDER.map((i) => {
          const did = map[i] || baseDeptId;
          const ci = master.departments.findIndex((d) => d.id === did);
          const c = DEPT_COLORS[Math.max(0, ci) % DEPT_COLORS.length];
          return (
            <span key={i} className={`text-xs w-8 h-8 rounded border flex items-center justify-center font-bold ${c.chip} ${map[i] ? "ring-2 ring-stone-500" : ""}`}
              title={(master.departments[ci] || {}).name || ""}>
              {DAYS[i]}
            </span>
          );
        })}
      </div>
      {DAY_ORDER.map((i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          <span className={`w-8 text-sm font-bold text-center ${i === 0 ? "text-rose-600" : i === 6 ? "text-sky-600" : "text-stone-700"}`}>{DAYS[i]}</span>
          <select
            className={inputCls}
            value={map[i] || ""}
            onChange={(e) =>
              setMap((prev) => {
                const n = { ...prev };
                if (e.target.value) n[i] = e.target.value; else delete n[i];
                return n;
              })
            }>
            <option value="">基本({baseName})</option>
            {master.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      ))}
      <div className="flex justify-end gap-2 mt-3">
        <button className={btnSec} onClick={onClose}>キャンセル</button>
        <button className={btnPri} onClick={() => onSave(map)}>保存</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   職員の当日変更モーダル(休み・時間・部署移動・予定の保留)
   ============================================================ */
function StaffOvModal({ master, staff, ov, itemCount, fixedOffToday, onSave, onMoveDept, onHoldAll, onClose }) {
  const [off, setOff] = useState(!!ov.off);
  const [start, setStart] = useState(ov.start || "");
  const [end, setEnd] = useState(ov.end || "");
  const [note, setNote] = useState(ov.note || "");
  const [dayDept, setDayDept] = useState(ov.deptId || "");
  const [workToday, setWorkToday] = useState(!!ov.workToday);
  const wdDeptInfo = staff.deptByDay && Object.keys(staff.deptByDay).length > 0;
  return (
    <Modal title={`${staff.name} の変更`} onClose={onClose}>
      {fixedOffToday && (
        <label className="flex items-center gap-2 text-sm font-semibold text-emerald-800 mb-3 bg-emerald-50 border border-emerald-200 rounded-md p-2">
          <input type="checkbox" checked={workToday} onChange={(e) => setWorkToday(e.target.checked)} />
          本日出勤する(休日出勤)※外すとこの日の表から消えます
        </label>
      )}
      <label className="flex items-center gap-2 text-sm font-semibold text-stone-700 mb-3">
        <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} />
        本日休み(表の右端に移動します)
      </label>
      <div className="text-xs text-stone-500 mb-1">遅刻・早退・時短はここで本日の出退勤を変更します(送迎・男性カバーの判定に反映されます)。</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`出勤(通常 ${staff.start})／遅刻はここを遅く`}>
          <input className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} placeholder="例:10:00" disabled={off} />
        </Field>
        <Field label={`退勤(通常 ${staff.end})／早退はここを早く`}>
          <input className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} placeholder="例:15:00" disabled={off} />
        </Field>
      </div>
      <Field label="本日の部署(この日だけ別の部署で動く場合)">
        <select className={inputCls} value={dayDept} onChange={(e) => setDayDept(e.target.value)}>
          <option value="">通常どおり{wdDeptInfo ? "(曜日別設定があれば優先)" : ""}</option>
          {master.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="メモ">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例:午後から出勤" />
      </Field>

      {itemCount > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-md p-2 mb-3">
          <div className="text-xs text-amber-800 mb-1.5">この職員は本日 {itemCount} 件の予定を担当しています。休みや退職の場合、まとめて「保留」列へ移して、あとから別の職員に割り当て直せます。</div>
          <button className={btnSec} onClick={async () => { if (await ask(`${staff.name}の本日の予定 ${itemCount}件をすべて保留へ移しますか?`)) onHoldAll(); }}>
            予定をすべて保留へ移す
          </button>
        </div>
      )}

      <Field label="基本部署の変更(毎日に影響・すぐ反映 / 曜日で違う場合は職員タブの「曜日別」で設定)">
        <select className={inputCls} value={staff.baseDeptId || staff.deptId} onChange={(e) => onMoveDept(e.target.value)}>
          {master.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>

      <div className="flex justify-end gap-2 mt-2">
        <button className={btnSec} onClick={onClose}>キャンセル</button>
        <button
          className={btnPri}
          onClick={() => onSave({ off, start: start.trim(), end: end.trim(), note: note.trim(), ...(dayDept ? { deptId: dayDept } : {}), ...(workToday ? { workToday: true } : {}) })}>
          保存
        </button>
      </div>
    </Modal>
  );
}

/* ============================================================
   タイムグリッド(時間 × 職員 + 保留列)
   ============================================================ */
function TimeGrid({ master, data, deptFilter, weekday, sheetMode, gridHeight, searchQ, activeSearchId, onCell, onItem, onStaff, onToggleOff, onMoveItem, onDeleteItem, onSetOrder, onRemoveRider, onDropUserOnRun, onDropUserOnCell, onDropVehicleOnRun, onDropVehicleOnCell, onHoverTime }) {
  const gridScrollRef = useRef(null);
  const topScrollRef = useRef(null);
  const [gridScrollW, setGridScrollW] = useState(2000);
  useEffect(() => {
    const upd = () => { const g = gridScrollRef.current; if (g) setGridScrollW(g.scrollWidth); };
    upd();
    const t1 = setTimeout(upd, 300);
    window.addEventListener("resize", upd);
    return () => { clearTimeout(t1); window.removeEventListener("resize", upd); };
  });  // 自宅迎え/自宅送りの補足付き氏名(Excelと共通のルール)
  const libNameHome = useMemo(() => (weekday != null ? makeLibNameHelpers(data, weekday).nameHome : null), [data, weekday]);
  // 検索ジャンプ: 現在のヒットへ自動スクロール
  useEffect(() => {
    if (!activeSearchId) return;
    const el = document.querySelector(`[data-item-id="${activeSearchId}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [activeSearchId]);
  // ページ内検索(Ctrl+F): 利用者・職員・車・メモに一致するチップを強調
  const sq = (searchQ || "").trim();
  const hitRun = (item) => {
    if (!sq) return false;
    const names = (item.userIds || []).map((id) => { const u = master.users.find((x) => x.id === id); return u ? u.name : ""; });
    const riders = (item.staffRiderIds || []).map((id) => { const s = master.staff.find((x) => x.id === id); return s ? s.name : ""; });
    const stf = master.staff.find((s) => s.id === item.staffId);
    const veh = resolveVehicle(master, item.vehicleId);
    return [...names, ...riders, stf ? stf.name : "", veh ? veh.name : "", item.note || ""].some((x) => x && x.includes(sq));
  };
  const hitBlock = (b) => {
    if (!sq) return false;
    const stf = master.staff.find((s) => s.id === b.staffId);
    return (b.label || "").includes(sq) || (stf && stf.name.includes(sq));
  };
  const deptIndex = (id) => master.departments.findIndex((d) => d.id === id);
  const known = new Set(master.staff.map((s) => s.id));
  const ovMap = data.staffOv || {};
  const [overKey, setOverKey] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, target, item }
  // 固定休の判定:休日出勤(workToday)がなければその日は非表示
  const fixedOff = (s) => weekday != null && (s.offDays || []).includes(weekday);
  const worksToday = (s) => s.emp !== "パート" && (!fixedOff(s) || !!((ovMap[s.id] || {}).workToday));
  // 表示列と同じ条件(パート・グリッド非表示の職員は列がないため、その予定は保留列へ出す)
  const workingSet = new Set(master.staff.filter((s) => s.emp !== "パート" && !s.noGrid && worksToday(s)).map((s) => s.id));

  // マス(セル)へのドロップ受け入れ判定
  const cellAccepts = () =>
    DRAG && (DRAG.t === "run" || DRAG.t === "block" || DRAG.t === "user" || DRAG.t === "veh");
  const cellDrop = (colId, slotMin) => (e) => {
    e.preventDefault();
    setOverKey(null);
    if (!DRAG) return;
    if (DRAG.t === "run" || DRAG.t === "block") onMoveItem(DRAG.t === "run" ? "runs" : "blocks", DRAG.id, colId, slotMin);
    else if (DRAG.t === "user") onDropUserOnCell(DRAG, colId, toStr(slotMin));
    else if (DRAG.t === "veh") onDropVehicleOnCell(DRAG.vehicleId, colId, toStr(slotMin));
    DRAG = null;
  };
  const cellDragOver = (key) => (e) => {
    if (!cellAccepts()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overKey !== key) setOverKey(key);
  };

  let cols = master.staff.filter((s) => s.emp !== "パート" && !s.noGrid && worksToday(s) && (deptFilter === "all" || belongDeptOf(master, s, weekday) === deptFilter || s.deptId === deptFilter));
  cols = [...cols].sort((a, b) => staffColKey(master, a) - staffColKey(master, b));
  // 休みの職員は右端へ
  const actives = cols.filter((s) => !(ovMap[s.id] && ovMap[s.id].off));
  const offs = cols.filter((s) => ovMap[s.id] && ovMap[s.id].off);
  cols = [...actives, ...offs];

  const slots = [];
  for (let m = GRID_START; m < GRID_END; m += SLOT) slots.push(m);

  const colKey = (sid) => (sid === HOLD_ID || !known.has(sid) || !workingSet.has(sid) ? HOLD_ID : sid);
  const cellMap = {};
  const put = (staffId, time, obj) => {
    const t = toMin(time);
    if (t == null) return;
    const slot = Math.max(GRID_START, Math.min(GRID_END - SLOT, Math.floor(t / SLOT) * SLOT));
    const key = `${colKey(staffId)}:${slot}`;
    (cellMap[key] = cellMap[key] || []).push(obj);
  };
  data.runs.forEach((r) => put(r.staffId, r.time, { type: "run", item: r }));
  // 同乗職員の列にも表示(クリックで元の便を編集)
  data.runs.forEach((r) => (r.staffRiderIds || []).forEach((rid) => put(rid, r.time, { type: "rider", item: r, riderId: rid })));
  data.blocks.forEach((b) => put(b.staffId, b.time, { type: "block", item: b }));

  const holdCount = Object.keys(cellMap).filter((k) => k.startsWith(HOLD_ID)).reduce((a, k) => a + cellMap[k].length, 0);

  // 予定チップの上に別の予定(便・ブロック)をドラッグ: 同じマス内なら上下の並べ替え、別マスからなら移動+その位置に挿入
  // 自車の予定は、朝(12時前)は必ずセルの一番上・夕方は一番下に置く(出勤してから送迎/送迎を終えてから退勤)
  const ownCarRank = (x) => {
    const it = (x && x.item) || {};
    const isOwn = /自車/.test(it.label || "") || String(it.vehicleId || "").startsWith("own:");
    if (!isOwn) return 1;
    const t = toMin(it.time);
    return t != null && t >= 12 * 60 ? 2 : 0;
  };
  const byOrd = (a, b) => (ownCarRank(a) - ownCarRank(b)) || ((a.item.ord != null ? a.item.ord : 999) - (b.item.ord != null ? b.item.ord : 999));
  const chipSortOver = (targetItem) => (e) => {
    if (!DRAG || (DRAG.t !== "run" && DRAG.t !== "block") || DRAG.id === targetItem.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rc = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rc.top + rc.height / 2 ? "before" : "after";
    const k2 = `ord:${targetItem.id}:${pos}`;
    if (overKey !== k2) setOverKey(k2);
  };
  const chipSortDrop = (items, colId, slotMin, targetItem) => (e) => {
    if (!DRAG || (DRAG.t !== "run" && DRAG.t !== "block") || DRAG.id === targetItem.id) return;
    e.preventDefault();
    e.stopPropagation();
    const rc = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rc.top + rc.height / 2;
    setOverKey(null);
    const sorted = items.filter((x) => x.type !== "rider").slice().sort(byOrd);
    const ids = sorted.map((x) => x.item.id).filter((id) => id !== DRAG.id);
    let at = ids.indexOf(targetItem.id);
    if (at < 0) at = ids.length; else if (!before) at += 1;
    ids.splice(at, 0, DRAG.id);
    // 別のマスから落とした場合は、まずこのマスへ移動してから並び順を確定
    if (!sorted.some((x) => x.item.id === DRAG.id)) onMoveItem(DRAG.t === "run" ? "runs" : "blocks", DRAG.id, colId, slotMin);
    onSetOrder && onSetOrder(ids.map((id2, i3) => ({ id: id2, ord: i3 })));
    DRAG = null;
  };
  // 並べ替え中の挿入位置インジケータ(上辺/下辺の青線)
  const sortIndicator = (id) =>
    overKey === `ord:${id}:before` ? " border-t-4 border-t-sky-500" : overKey === `ord:${id}:after` ? " border-b-4 border-b-sky-500" : "";

  const renderItems = (items, cellColId, cellSlotMin) =>
    items.slice().sort(byOrd).map(({ type, item, riderId }) => {
      if (type === "rider") {
        const st2 = master.staff.find((s) => s.id === item.staffId);
        return (
          <button key={item.id + ":rider"}
            className={`block w-full text-left rounded border border-dashed border-stone-300 bg-stone-50 text-stone-500 mb-0.5 text-[10px] px-1 py-0.5 hover:bg-stone-100 ${sq && !hitRun(item) ? "opacity-40" : ""}`}
            title="クリックで元の便を編集 / 右クリックで同乗を外す"
            onClick={() => onItem({ target: "runs", item })}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, target: "rider", item, riderId }); }}>
            {st2 ? st2.name : ""}便に同乗 {item.time}
          </button>
        );
      }
      if (type === "run") {
        const veh = resolveVehicle(master, item.vehicleId);
        const stf = master.staff.find((s) => s.id === item.staffId);
        const di = veh ? deptIndex(veh.deptId) % DEPT_COLORS.length : stf ? deptIndex(stf.deptId) % DEPT_COLORS.length : 0;
        const c = DEPT_COLORS[di] || DEPT_COLORS[0];
        const riders = item.userIds
          .map((id) => master.users.find((x) => x.id === id))
          .filter(Boolean);
        const warns = runWarnings(item, master, data, weekday);
        const rKey = `run:${item.id}`;
        return (
          <div key={item.id}
            draggable
            onDragStart={dragStart({ t: "run", id: item.id })}
            onDragEnd={(e) => { dragEnd(e); setOverKey(null); }}
            onDragOver={(e) => {
              if (DRAG && (DRAG.t === "user" || DRAG.t === "veh")) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                if (overKey !== rKey) setOverKey(rKey);
              } else chipSortOver(item)(e);
            }}
            onDrop={(e) => {
              if (DRAG && (DRAG.t === "user" || DRAG.t === "veh")) {
                e.preventDefault();
                e.stopPropagation();
                setOverKey(null);
                if (DRAG.t === "user") onDropUserOnRun(DRAG, item.id);
                else onDropVehicleOnRun(DRAG.vehicleId, item.id);
                DRAG = null;
              } else chipSortDrop(items, cellColId, cellSlotMin, item)(e);
            }}
            onClick={() => onItem({ target: "runs", item })}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, target: "runs", item }); }}
            data-item-id={item.id}
            className={`block w-full text-left rounded border px-1 py-0.5 mb-0.5 ${c.chip} hover:brightness-95 cursor-grab active:cursor-grabbing ${overKey === rKey ? "ring-2 ring-sky-500" : ""} ${activeSearchId === item.id ? "ring-4 ring-rose-500" : hitRun(item) ? "ring-4 ring-amber-400" : sq ? "opacity-40" : ""}${sortIndicator(item.id)}`}
            title={warns.length ? warns.join(" / ") : "クリックで編集 / 右クリックで削除 / ドラッグで移動・マス内の並べ替え"}>
            <div className="text-[10px] font-bold leading-tight">
              <span className="inline-flex items-center gap-0.5">
                <span className="bg-white/70 rounded px-0.5">{RUN_KINDS[item.kind] || "送"}</span>
                {item.time}
                {warns.length > 0 && <span className="text-rose-600">⚠</span>}
              </span>
              {item.staffId === REQ_ID && <span className={`block truncate rounded px-0.5 ${(((data.reqStatus || {})[item.id]) || {}).staff ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`} data-reqst={item.id}>🤝{reqStatusText((data.reqStatus || {})[item.id])}</span>}
              <span className="block truncate">{item.kind === "own_move" ? "自家用車で移動" : item.mode === "walk" ? "徒歩" : item.mode === "train" ? (veh ? "訓練 " + veh.name : "訓練先") : item.mode === "move" ? (veh ? "移動 " + veh.name : "部署間移動") : veh ? veh.name : "車未定"}</span>
            </div>
            {riders.length > 0 && (
              <div className="text-[10px] leading-tight flex flex-wrap gap-x-0.5">
                {riders.map((u) => {
                  const ut = userTimeOf(u, weekday, data.userTime);
                  // 迎え便なら迎え時刻だけ、送り便なら送り時刻だけを表示
                  const tt = item.kind === "meet" ? `${u.name} 迎え${ut.meet || "未設定"}` : item.kind === "send" ? `${u.name} 送り${ut.send || "未設定"}` : "";
                  // 自宅迎え/自宅送りの補足(Excelと同じ表記を画面にも出す)
                  const placeOv = String(((item.places || {})[u.id]) || "").trim();
                  const homeSuffix = libNameHome ? libNameHome(u, item.kind, item).slice(u.name.length) : "";
                  return (
                  <span key={u.id}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); dragStart({ t: "user", userId: u.id, fromRunId: item.id })(e); }}
                    onDragEnd={dragEnd}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded px-0.5 bg-white/50 hover:bg-white cursor-grab active:cursor-grabbing"
                    title={tt}>
                    {u.name}{u.wheelchair ? "♿" : ""}{(item.trainDropIds || []).includes(u.id) ? <span className="text-[9px] text-violet-700 font-bold">迎(訓送)</span> : (item.trainBothIds || []).includes(u.id) ? <span className="text-[9px] text-violet-700 font-bold">{item.kind === "meet" ? "迎(訓練)" : "送(訓練)"}</span> : (item.trainUserIds || []).includes(u.id) ? <span className="text-[9px] text-violet-600 font-bold">{item.kind === "meet" ? "(訓迎)" : "(訓送)"}</span> : null}{homeSuffix ? <span className={`text-[9px] ${placeOv ? "font-bold text-amber-800 bg-amber-200 rounded px-0.5" : "text-rose-600"}`} title={placeOv ? `いつもの${item.kind === "send" ? "送り" : "迎え"}先(${defPlaceOf(u, item.kind === "send" ? "send" : "meet", weekday)})と違います` : ""}>{placeOv ? "✓" + homeSuffix : homeSuffix}</span> : null}
                  </span>
                  );
                })}
              </div>
            )}
            {(item.staffRiderIds || []).length > 0 && (
              <div className="text-[10px] leading-tight font-semibold underline decoration-dotted">
                同乗:{(item.staffRiderIds || []).map((id) => { const s = master.staff.find((x) => x.id === id); return s ? s.name : ""; }).filter(Boolean).join("・")}
              </div>
            )}
            {item.note && <div className="text-[10px] leading-tight opacity-70">{item.note}</div>}
          </div>
        );
      }
      const isHelp = item.kind === "help";
      return (
        <div key={item.id}
          draggable
          onDragStart={dragStart({ t: "block", id: item.id })}
          onDragEnd={(e) => { dragEnd(e); setOverKey(null); }}
          onDragOver={chipSortOver(item)}
          onDrop={chipSortDrop(items, cellColId, cellSlotMin, item)}
          onClick={() => onItem({ target: "blocks", item })}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, target: "blocks", item }); }}
          data-item-id={item.id}
          className={`block w-full text-left rounded border px-1 py-0.5 mb-0.5 cursor-grab active:cursor-grabbing ${
            isHelp ? "bg-orange-50 border-orange-300 text-orange-900" : "bg-stone-100 border-stone-300 text-stone-700"
          } hover:brightness-95 ${activeSearchId === item.id ? "ring-4 ring-rose-500" : hitBlock(item) ? "ring-4 ring-amber-400" : sq ? "opacity-40" : ""}${sortIndicator(item.id)}`}
          title="クリックで編集 / 右クリックで削除 / ドラッグで移動・マス内の並べ替え">
          <div className="text-[10px] font-bold leading-tight">
            {isHelp ? "ヘルプ " : ""}{item.time}
            {item.vehicleId && (() => { const v = resolveVehicle(master, item.vehicleId); return v ? " " + v.name : ""; })()}
          </div>
          <div className="text-[10px] leading-tight">{item.label}{item.note ? <span className="text-stone-500">({item.note})</span> : null}</div>
        </div>
      );
    });

  return (
    <>
    {/* 上部にも横スクロールバーを出す(下端が画面外でも操作できるように・本体と同期) */}
    <div ref={topScrollRef} className="always-scrollbar mb-1 rounded" style={{ overflowX: "scroll", overflowY: "hidden", height: 15 }}
      onScroll={(e) => { const g = gridScrollRef.current; if (g && g.scrollLeft !== e.currentTarget.scrollLeft) g.scrollLeft = e.currentTarget.scrollLeft; }}>
      <div style={{ width: gridScrollW, height: 1 }} />
    </div>
    <div ref={gridScrollRef} className="always-scrollbar border border-stone-300 rounded-lg bg-white" style={{ maxHeight: gridHeight || "62vh", overflow: "scroll" }}
      onScroll={(e) => { const t = topScrollRef.current; if (t && t.scrollLeft !== e.currentTarget.scrollLeft) t.scrollLeft = e.currentTarget.scrollLeft; }}>
      {/* 横・縦のスクロールバーを常に表示(Macでも隠れないように) */}
      <style>{`.always-scrollbar{scrollbar-width:auto;scrollbar-color:rgba(120,113,108,.55) rgba(0,0,0,.06);}
.always-scrollbar::-webkit-scrollbar{width:13px;height:13px;-webkit-appearance:none;}
.always-scrollbar::-webkit-scrollbar-track{background:rgba(0,0,0,.06);}
.always-scrollbar::-webkit-scrollbar-thumb{background:rgba(120,113,108,.55);border-radius:7px;border:3px solid transparent;background-clip:content-box;}
.always-scrollbar::-webkit-scrollbar-thumb:hover{background:rgba(87,83,78,.75);border:3px solid transparent;background-clip:content-box;}`}</style>
      {ctxMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}>
          <div
            className="absolute bg-white border border-stone-300 rounded-md shadow-lg py-1 text-sm min-w-[140px]"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 160), top: Math.min(ctxMenu.y, window.innerHeight - 90) }}
            onClick={(e) => e.stopPropagation()}>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-sky-50 text-stone-700"
              onClick={() => { onItem({ target: ctxMenu.target === "rider" ? "runs" : ctxMenu.target, item: ctxMenu.item }); setCtxMenu(null); }}>
              ✏ {ctxMenu.target === "rider" ? "元の便を編集" : "編集"}
            </button>
            {ctxMenu.target !== "rider" && (() => {
              // 同じマス内の予定を上下に並べ替え
              const it = ctxMenu.item;
              const key = `${colKey(it.staffId)}:${Math.max(GRID_START, Math.min(GRID_END - SLOT, Math.floor((toMin(it.time) || 0) / SLOT) * SLOT))}`;
              const cellItems = (cellMap[key] || []).filter((x) => x.type !== "rider")
                .slice().sort((a, b) => ((a.item.ord != null ? a.item.ord : 999) - (b.item.ord != null ? b.item.ord : 999)));
              if (cellItems.length < 2) return null;
              const idx = cellItems.findIndex((x) => x.item.id === it.id);
              const move = (dir) => {
                const j = idx + dir;
                if (j < 0 || j >= cellItems.length) return;
                const ordered = cellItems.slice();
                const [sp] = ordered.splice(idx, 1);
                ordered.splice(j, 0, sp);
                onSetOrder && onSetOrder(ordered.map((x, i3) => ({ id: x.item.id, ord: i3 })));
                setCtxMenu(null);
              };
              return (
                <>
                  <button disabled={idx <= 0} className="w-full text-left px-3 py-1.5 hover:bg-sky-50 text-stone-700 disabled:opacity-30" onClick={() => move(-1)}>▲ マス内で上へ</button>
                  <button disabled={idx >= cellItems.length - 1} className="w-full text-left px-3 py-1.5 hover:bg-sky-50 text-stone-700 disabled:opacity-30" onClick={() => move(1)}>▼ マス内で下へ</button>
                </>
              );
            })()}
            {ctxMenu.target !== "rider" && (() => {
              // マスをまたぐ移動: 上下=時間帯、左右=隣の職員
              const it = ctxMenu.item;
              const t = toMin(it.time);
              const slot = t != null ? Math.max(GRID_START, Math.min(GRID_END - SLOT, Math.floor(t / SLOT) * SLOT)) : null;
              const tgt = ctxMenu.target === "runs" ? "runs" : "blocks";
              const colIdx = cols.findIndex((s) => s.id === colKey(it.staffId));
              const shiftT = (d) => { if (slot == null) return; onMoveItem && onMoveItem(tgt, it.id, it.staffId, slot + d * SLOT); setCtxMenu(null); };
              const shiftC = (d) => {
                const j = colIdx + d;
                if (j < 0 || j >= cols.length) return;
                onMoveItem && onMoveItem(tgt, it.id, cols[j].id, slot != null ? slot : toMin(it.time));
                setCtxMenu(null);
              };
              return (
                <>
                  <div className="border-t border-stone-100 my-0.5" />
                  <div className="flex">
                    <button disabled={slot == null || slot <= GRID_START} className="flex-1 px-2 py-1.5 hover:bg-emerald-50 text-stone-700 disabled:opacity-30" title="30分早い時間へ" onClick={() => shiftT(-1)}>⬆︎</button>
                    <button disabled={slot == null || slot >= GRID_END - SLOT} className="flex-1 px-2 py-1.5 hover:bg-emerald-50 text-stone-700 disabled:opacity-30" title="30分遅い時間へ" onClick={() => shiftT(1)}>⬇︎</button>
                    <button disabled={colIdx <= 0} className="flex-1 px-2 py-1.5 hover:bg-emerald-50 text-stone-700 disabled:opacity-30" title="左の職員へ" onClick={() => shiftC(-1)}>⬅︎</button>
                    <button disabled={colIdx < 0 || colIdx >= cols.length - 1} className="flex-1 px-2 py-1.5 hover:bg-emerald-50 text-stone-700 disabled:opacity-30" title="右の職員へ" onClick={() => shiftC(1)}>➡︎</button>
                  </div>
                </>
              );
            })()}
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-rose-600"
              onClick={() => {
                if (ctxMenu.target === "rider") onRemoveRider && onRemoveRider(ctxMenu.item.id, ctxMenu.riderId);
                else onDeleteItem && onDeleteItem({ target: ctxMenu.target, item: ctxMenu.item });
                setCtxMenu(null);
              }}>
              🗑 {ctxMenu.target === "rider" ? "同乗を外す" : "削除"}
            </button>
          </div>
        </div>
      )}
      <table className="border-collapse" style={{ minWidth: (cols.length + 1) * 80 + 44 }}>
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 bg-stone-100 border border-stone-300 text-[10px] text-stone-500 px-0.5 w-11 min-w-11">時間</th>
            {cols.map((s) => {
              const di = deptIndex(s.deptId) % DEPT_COLORS.length;
              const c = DEPT_COLORS[di] || DEPT_COLORS[0];
              const ov = ovMap[s.id] || {};
              return (
                <th key={s.id} className={`border border-stone-300 p-0 min-w-20 w-20 align-top ${ov.off ? "bg-stone-100" : "bg-white"}`}>
                  <div className={`${ov.off ? "bg-stone-400" : c.band} h-1.5`} />
                  <div className="px-1 py-0.5 cursor-pointer" onClick={() => onStaff && onStaff(s)} title={sheetMode ? "クリックで休み・時間・部署の変更" : "クリックで部署の変更"}>
                    <div className={`text-[13px] font-bold leading-tight truncate ${ov.off ? "line-through text-stone-400" : "text-stone-800"}`}>
                      {s.name}
                      {ov.off && <span className="ml-0.5 text-[10px] text-rose-600 font-bold">休</span>}
                      {fixedOff(s) && ov.workToday && <span className="ml-0.5 text-[9px] text-emerald-700 font-bold border border-emerald-400 rounded px-0.5">休出</span>}
                    </div>
                    <div className={`text-[9px] leading-tight truncate ${s.baseDeptId ? "text-amber-700 font-bold" : "text-stone-500"}`}>
                      {master.departments[deptIndex(s.deptId)] ? master.departments[deptIndex(s.deptId)].name : ""}
                      {(() => { const dd = master.departments.find((x) => x.id === s.deptId); if (!dd || !/リベルタ/.test(dd.name)) return ""; const sd = subDeptOf(s, weekday); const d2 = sd && master.departments.find((x) => x.id === sd); return d2 ? `(${d2.name})` : ""; })()}
                      {s.baseDeptId ? "◆" : ""}
                      {s.emp === "パート" ? "・P" : ""}
                    </div>
                    <div className={`text-[9px] leading-tight ${ov.start || ov.end ? "text-amber-700 font-bold" : "text-stone-500"}`}>
                      {ov.off ? "休み" : `${ov.start || s.start}-${ov.end || s.end}`}
                      {!ov.off && ov.start && toMin(ov.start) > toMin(s.start) ? "遅" : ""}
                      {!ov.off && ov.end && toMin(ov.end) < toMin(s.end) ? "早" : ""}
                    </div>
                    {ov.note && <div className="text-[10px] text-amber-700">{ov.note}</div>}
                  </div>
                  {sheetMode && (
                    <div className="px-0.5 pb-0.5">
                      <button
                        className={`w-full text-[9px] rounded border px-0.5 py-0.5 ${
                          ov.off ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100" : "bg-white border-stone-300 text-stone-500 hover:bg-rose-50 hover:text-rose-600"
                        }`}
                        onClick={(e) => { e.stopPropagation(); onToggleOff(s); }}>
                        {ov.off ? "出勤に戻す" : "休みに"}
                      </button>
                    </div>
                  )}
                </th>
              );
            })}
            <th className="border border-stone-300 border-dashed p-0 min-w-20 w-20 align-top bg-yellow-50">
              <div className="bg-yellow-400 h-1.5" />
              <div className="px-1 py-0.5">
                <div className="text-[13px] font-bold text-yellow-800">保留</div>
                <div className="text-[9px] text-yellow-700 leading-tight">未定{holdCount}件</div>
                <div className="text-[9px] text-yellow-700/70 leading-tight">クリックで再割当</div>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {slots.map((m) => {
            // この時間帯(行)に予定があるか(全職員+保留)
            const rowHasItem =
              cols.some((s) => (cellMap[`${s.id}:${m}`] || []).length) ||
              (cellMap[`${HOLD_ID}:${m}`] || []).length;
            const emptyCell = rowHasItem ? "" : "h-5"; // 空行は細く、予定行は内容に応じて伸びる
            return (
            <tr key={m} onMouseEnter={onHoverTime ? () => onHoverTime(m) : undefined}>
              <td className={`sticky left-0 z-10 bg-stone-50 border border-stone-200 text-[11px] text-right pr-1 align-top leading-none py-0.5 ${m % 60 === 0 ? "font-bold text-stone-600" : "text-stone-400"}`}>
                {toStr(m)}
              </td>
              {cols.map((s) => {
                const items = cellMap[`${s.id}:${m}`] || [];
                const ov = ovMap[s.id] || {};
                const st = toMin(ov.start || s.start), en = toMin(ov.end || s.end);
                const offGrid = ov.off || (st != null && en != null && (m + SLOT <= st || m >= en));
                const cKey = `${s.id}:${m}`;
                return (
                  <td key={s.id}
                    onDragOver={cellDragOver(cKey)}
                    onDragLeave={() => { if (overKey === cKey) setOverKey(null); }}
                    onDrop={cellDrop(s.id, m)}
                    className={`border border-stone-200 align-top p-0.5 ${emptyCell} ${offGrid ? "bg-stone-100/80" : "bg-white"} group ${overKey === cKey ? "outline outline-2 outline-sky-500 bg-sky-50" : ""}`}>
                    {renderItems(items, s.id, m)}
                    <button className="w-full text-stone-300 text-xs opacity-0 group-hover:opacity-100 hover:text-sky-600 leading-none" onClick={() => onCell(s.id, toStr(m))}>+</button>
                  </td>
                );
              })}
              <td
                onDragOver={cellDragOver(`${HOLD_ID}:${m}`)}
                onDragLeave={() => { if (overKey === `${HOLD_ID}:${m}`) setOverKey(null); }}
                onDrop={cellDrop(HOLD_ID, m)}
                className={`border border-stone-200 border-dashed align-top p-0.5 ${emptyCell} bg-yellow-50/50 group ${overKey === `${HOLD_ID}:${m}` ? "outline outline-2 outline-yellow-500 bg-yellow-100" : ""}`}>
                {renderItems(cellMap[`${HOLD_ID}:${m}`] || [], HOLD_ID, m)}
                <button className="w-full text-yellow-500/40 text-xs opacity-0 group-hover:opacity-100 hover:text-yellow-700 leading-none" onClick={() => onCell(HOLD_ID, toStr(m))}>+</button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

/* ============================================================
   抜けチェック(利用曜日なのに迎え・送り未入力)
   ============================================================ */
// 2名体制ヘルプ(黒田・井上)の不足チェック: 同じ時刻のヘルプに2名割り当てられているか
// 夕方に2名体制のヘルプが必要な曜日(黒田=月水木の入浴、井上=月火木)。ここに無い曜日は未登録でも警告しない
// 井上は生活介護の利用は木曜のみだが、入浴介助は8/13から毎日(月〜金)入る
function helpTwoShortages(master, sheetData, wd) {
  const out = [];
  const absent2 = sheetData.userAbsent || {};
  (rulesOf(master).helpTwo || []).forEach((row) => {
    if (!row || !row.user) return;
    const u = (master.users || []).find((x) => x.name === row.user);
    if (!u || u.beforeStart || absent2[u.id]) return;
    if (wd != null && !(row.days || []).includes(wd)) return;
    const groups = {};
    (sheetData.blocks || []).forEach((b) => {
      if (b.kind !== "help") return;
      const t = toMin(b.time);
      if (t == null || t < 15 * 60) return;
      const hit = (b.userIds || []).includes(u.id) || String(b.label || "").startsWith(u.name);
      if (hit) groups[b.time] = (groups[b.time] || 0) + 1;
    });
    if (Object.keys(groups).length === 0) {
      out.push(`${u.name}のヘルプが1件も入っていません(15時以降に2名体制のヘルプが必要です)`);
      return;
    }
    Object.entries(groups).forEach(([tm, n]) => {
      if (n < 2) out.push(`${u.name}ヘルプ ${tm} は2名体制が必要です(現在${n}名)。同じ時刻でもう1名のヘルプを追加してください`);
    });
  });
  return out;
}

function kubotaPlacementWarn(master, sheetData, wd) {
  const out = [];
  const kub = (master.staff || []).find((s) => s.name === "窪田");
  if (!kub) return out;
  const otherHelps = (sheetData.blocks || []).filter((b) =>
    b.kind === "help" && b.staffId === kub.id && !String(b.label || "").startsWith("松浦"));
  if (!otherHelps.length) return out;
  const yome = (master.departments || []).find((d) => d.name === "嫁島");
  const cur = belongDeptOf(master, kub, wd);
  if (yome && cur !== yome.id) {
    const curName = ((master.departments || []).find((d) => d.id === cur) || {}).name || "?";
    out.push(`窪田に松浦以外のヘルプ(${otherHelps.map((b) => `${b.time} ${b.label}`).join("・")})が入っているため嫁島配置が必要ですが、現在は${curName}配置です。職員名をクリックして当日部署を嫁島に変更してください`);
  }
  return out;
}

// 予定・ヘルプの固定担当(透析・夕方の藤井ヘルプなど)。担当が休みの日は代役可(警告なし)
function fixedBlockWarn(master, sheetData, wd) {
  const out = [];
  const rows = (rulesOf(master).fixedBlock || []).filter((r) => r && r.staff && (r.days || []).includes(wd));
  if (!rows.length) return out;
  const R0 = rulesOf(master);
  (sheetData.blocks || []).forEach((b) => {
    const lb = String(b.label || "").trim();
    const t = toMin(b.time);
    // ヘルプ表でこの曜日の基本の担当を決めているヘルプは、ヘルプ表のほうで確認する(二重・矛盾した確認を出さない)
    if (b.kind === "help") {
      const hb = helpBaseFor(R0, lb, b.time);
      if (hb && (hb.byDay || {})[wd]) return;
    }
    rows.forEach((row) => {
      const hitLabel = row.exact ? lb === row.label : lb.startsWith(row.label);
      if (!hitLabel || !ruleTimeHit(row, t)) return;
      if (row.kind && b.kind !== row.kind) return; // 種類(ヘルプ/予定)の指定があれば合うものだけ
      if (ruleStaffOff(master, sheetData, wd, row.staff)) return;
      const s = (master.staff || []).find((x) => x.id === b.staffId);
      if (s && s.name === row.staff) return;
      out.push(`${b.time}の「${lb}」の担当は${"月火水木金"[wd - 1]}曜=${row.staff}です(現在: ${s ? s.name : "保留"})`);
    });
  });
  return out;
}

// 毎週必ず入るヘルプ(ルールで登録)。登録が無ければ警告する。利用開始前の人は対象外
function requiredHelpWarn(master, sheetData, wd) {
  const out = [];
  (rulesOf(master).requiredHelp || []).forEach((row) => {
    if (!row || !row.user || !(row.days || []).includes(wd)) return;
    const u = (master.users || []).find((x) => x.name === row.user);
    if (!u || u.beforeStart) return;
    const n = (sheetData.blocks || []).filter((b) => String(b.label || "").startsWith(row.user)).length;
    if (n === 0) out.push(`${row.user}のヘルプが入っていません(${"月火水木金"[wd - 1]}曜は必要です)`);
  });
  return out;
}

// 車ごとの固定担当(朝のピカ便など)。固定担当が休みの日は代役可(エラーなし)
function pikaStaffWarn(master, sheetData, wd) {
  const out = [];
  (rulesOf(master).fixedVeh || []).forEach((row) => {
    if (!row || !row.staff || !row.veh || !(row.days || []).includes(wd)) return;
    if (ruleStaffOff(master, sheetData, wd, row.staff)) return;
    const veh = (master.vehicles || []).find((v) => v.name === row.veh);
    if (!veh) return;
    const limit = toMin(row.before || "12:00");
    (sheetData.runs || []).forEach((r) => {
      if (r.kind !== "meet" || r.mode || r.vehicleId !== veh.id) return;
      const t = toMin(r.time);
      if (t == null || (limit != null && t >= limit)) return;
      const actual = (master.staff || []).find((s) => s.id === r.staffId);
      if (actual && actual.name !== row.staff) {
        out.push(`朝の${row.veh}便(${r.time})の基本担当は${"月火水木金"[wd - 1]}曜=${row.staff}です(現在: ${actual.name})`);
      }
    });
  });
  return out;
}

// 男性職員のみ対応可のヘルプ・入浴(ルールで登録)
function maleOnlyHelpWarn(master, sheetData) {
  const out = [];
  const rows = (rulesOf(master).maleOnly || []).filter((r) => r && r.user);
  if (!rows.length) return out;
  (sheetData.blocks || []).forEach((b) => {
    const lb = String(b.label || "");
    const t = toMin(b.time);
    rows.forEach((row) => {
      if (!lb.startsWith(row.user)) return;
      if (row.bathOnly && !/入浴/.test(lb + (b.note || ""))) return;
      if (row.from && (t == null || t < toMin(row.from))) return;
      const stf = (master.staff || []).find((s) => s.id === b.staffId);
      if (stf && !stf.isMale) out.push(`${lb}(${b.time})の担当が${stf.name}になっています。${row.user}は男性職員のみ対応可です`);
    });
  });
  return out;
}

function blockOverlapWarn(master, sheetData) {
  const out = [];
  const bl = (sheetData.blocks || []).filter((b) => b.staffId && b.staffId !== HOLD_ID && toMin(b.time) != null);
  const byStaff = {};
  bl.forEach((b) => { (byStaff[b.staffId] = byStaff[b.staffId] || []).push(b); });
  Object.entries(byStaff).forEach(([sid, list]) => {
    const s = (master.staff || []).find((x) => x.id === sid);
    if (!s) return;
    const arr = list.slice().sort((a, b) => toMin(a.time) - toMin(b.time));
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const a0 = toMin(a.time), a1 = a0 + overlapDurMin(a), b0 = toMin(b.time);
        if (b0 >= a1) break;
        out.push(`${s.name}の予定が重なっています: ${a.time} ${a.label || "予定"} と ${b.time} ${b.label || "予定"}(どちらかを別の職員か別の時刻に)`);
      }
    }
  });
  return out;
}

function MissingAlert({ master, sheet, date }) {
  const wd = weekdayOf(date);
  const absent = sheet.userAbsent || {};
  const scheduled = master.users.filter((u) => (u.days || []).includes(wd) && !absent[u.id]);
  if (!scheduled.length) {
    const anyDays = master.users.some((u) => (u.days || []).length);
    if (!anyDays) {
      return (
        <div className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg p-2 mb-3">
          「利用者」タブで利用曜日を設定すると、この画面で迎え・送りの入力漏れを自動チェックします。
        </div>
      );
    }
    return null;
  }
  const inRuns = (kind) => {
    const set = new Set();
    sheet.runs.forEach((r) => {
      r.userIds.forEach((id) => { if (rideIs(rideKindOf(r, id), kind)) set.add(id); });
    });
    return set;
  };
  const meetSet = inRuns("meet"), sendSet = inRuns("send");
  const noRide = sheet.noRide || {};
  const missMeet = scheduled.filter((u) => !meetSet.has(u.id) && !(noRide[u.id] || {}).meet);
  const missSend = scheduled.filter((u) => !sendSet.has(u.id) && !(noRide[u.id] || {}).send);
  const twoShort = [...requiredHelpWarn(master, sheet, wd), ...fixedBlockWarn(master, sheet, wd), ...blockOverlapWarn(master, sheet), ...helpTwoShortages(master, sheet, wd), ...kubotaPlacementWarn(master, sheet, wd), ...maleOnlyHelpWarn(master, sheet), ...pikaStaffWarn(master, sheet, wd)]; // 2名体制+窪田配置+男性限定+ピカ固定担当+夕方藤井=井川
  const twoBox = twoShort.length > 0 && (
    <div className="text-sm text-rose-800 bg-rose-50 border-2 border-rose-400 rounded-lg p-3 mb-3">
      <div className="font-bold mb-1">🚨 ヘルプ体制のエラー</div>
      {twoShort.map((w, i) => <div key={i}>・{w}</div>)}
    </div>
  );
  if (!missMeet.length && !missSend.length) {
    return (
      <>
      {twoBox}
      <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2 mb-3">
        ✓ 本日({DAYS[wd]})利用予定の{scheduled.length}名全員に迎え・送りが入っています。
      </div>
      </>
    );
  }
  return (
    <>
    {twoBox}
    <div className="text-sm text-rose-800 bg-rose-50 border-2 border-rose-300 rounded-lg p-3 mb-3">
      <div className="font-bold mb-1">⚠ 送迎の抜けがあります(本日 {DAYS[wd]}曜日に利用予定)</div>
      {missMeet.length > 0 && (
        <div className="mb-0.5"><span className="font-semibold">迎え未入力({missMeet.length}名):</span> {missMeet.map((u) => u.name).join("・")}</div>
      )}
      {missSend.length > 0 && (
        <div><span className="font-semibold">送り未入力({missSend.length}名):</span> {missSend.map((u) => u.name).join("・")}</div>
      )}
      <div className="text-xs text-rose-600 mt-1">{aiApiOn() ? "下の未割当一覧から名前をクリックするとAI調整(その人の割り当て)が開きます。" : "下の未割当一覧から名前を表の便へドラッグして割り当ててください。"}欠席の場合は欠席にしてください。</div>
    </div>
    </>
  );
}

/* ============================================================
   未割当・欠席パネル
   ============================================================ */
/* 車両の動きタブ: 各部署にどの車がいつ残っているか(Excelの2枚目シートと同じ計算) */
// ---------- 🚌 3Dマップ: 全体は真上2Dレイアウト・区画内は3D表現 ----------
function Sim3D({ master, data, weekday, height, compact, widthHint }) {
  const wrapRef = useRef(null);
  const [playing, setPlaying] = useState(false); // 最初は一時停止
  const [speed, setSpeed] = useState(30); // デフォルトはゆっくり
  const [clockMin, setClockMin] = useState(7 * 60 + 30);
  const clockRef = useRef(7 * 60 + 30);
  const playRef = useRef(false);
  const speedRef = useRef(30);
  const [webglNg, setWebglNg] = useState(false);
  const [zoomUi, setZoomUi] = useState(185); // 表示倍率(%)
  const applyZoomRef = useRef(null);
  const applyViewRef = useRef(null);
  const [focus3d, setFocus3d] = useState("all"); // 部署フォーカス
  const [alerts, setAlerts] = useState([]); // いま起きている不自然な動き
  const [anomalyList, setAnomalyList] = useState([]); // 1日分の一覧
  const alertsKeyRef = useRef("");
  useEffect(() => { playRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  useEffect(() => {
    let alive = true;
    let renderer, raf;
    const el = wrapRef.current;
    if (!el) return;
    const cleanupRef = { current: null };
    (async () => {
      let scene, camera;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch (e) { setWebglNg(true); return; }
      if (!alive) return;
      const W = el.clientWidth || 900, H = height || 520;
      renderer.setSize(W, H);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      el.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf7f6f2);

      // ---- 真上見下ろしの平行投影カメラ(全体=2Dの田の字・中身=3D) ----
      const VIEW = 84; // 表示する世界の幅
      const aspect = W / H;
      camera = new THREE.OrthographicCamera(-VIEW / 2 * aspect, VIEW / 2 * aspect, VIEW / 2, -VIEW / 2, 0.1, 300);
      let panX = 0, panZ = 0, zoom = (zoomUi || 100) / 100;
      const setCam = () => {
        camera.position.set(panX, 70, panZ + 26); // 少し斜めから=箱や人が立体に見える
        camera.lookAt(panX, 0, panZ);
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
      };
      setCam();
      scene.add(new THREE.AmbientLight(0xffffff, 0.85));
      const sun = new THREE.DirectionalLight(0xffffff, 0.55);
      sun.position.set(10, 40, 15);
      scene.add(sun);

      // ---- 4事業所の正方形区画(2×2の田の字)。リベルタは画面外(上方向) ----
      const HEXES = [0x38bdf8, 0xf59e0b, 0x34d399, 0xfb7185];
      const ZW = 27, ZH = 18, HW = ZW / 2, HH = ZH / 2, GAPX = 17, GAPZ = 4.2; // 横長の区画。左右の間は駐車帯
      const CX = HW + GAPX / 2, CZ = HH + GAPZ / 2;
      const P4 = [[-CX, -CZ], [CX, -CZ], [-CX, CZ], [CX, CZ]];
      const deptsAll = master.departments.map((d) => ({ id: d.id, name: d.name.replace(/リベルタ.*/, "リベルタ") }));
      const libD = deptsAll.find((d) => /リベルタ/.test(d.name));
      const depts4 = deptsAll.filter((d) => !/リベルタ/.test(d.name)).slice(0, 4).map((d, i) => ({ ...d, x: P4[i][0], z: P4[i][1], hex: HEXES[i % 4] }));
      const LIB_POS = { x: 0, z: -(ZH * 2 + 16) };
      const zoneOf = (id) => depts4.find((d) => d.id === id);
      const posOfDept = (id) => (libD && id === libD.id) ? LIB_POS : (zoneOf(id) || depts4[0]);

      const mkLabel = (text, size, color, bold) => {
        const cv = document.createElement("canvas");
        cv.width = 320; cv.height = 64;
        const g = cv.getContext("2d");
        g.font = (bold ? "bold " : "") + "36px sans-serif";
        g.fillStyle = color || "#333";
        g.textAlign = "center";
        g.fillText(text, 160, 44);
        const tx = new THREE.CanvasTexture(cv);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthTest: false }));
        sp.scale.set(size, size / 5, 1);
        return { sp, cv, g, tx };
      };

      const zoneCountLabels = {};
      depts4.forEach((d) => {
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(ZW, ZH), new THREE.MeshLambertMaterial({ color: d.hex, transparent: true, opacity: 0.14 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(d.x, 0, d.z);
        scene.add(floor);
        const pts = [[-HW, -HH], [HW, -HH], [HW, HH], [-HW, HH], [-HW, -HH]].map(([a, b]) => new THREE.Vector3(d.x + a, 0.03, d.z + b));
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: d.hex })));
        // 駐車場(枠の外側・部署色の薄い床)で車の帰属を分かりやすく
        const pk = new THREE.Mesh(new THREE.PlaneGeometry(3.6, ZH), new THREE.MeshLambertMaterial({ color: d.hex, transparent: true, opacity: 0.08 }));
        pk.rotation.x = -Math.PI / 2;
        pk.position.set(d.x + (d.x < 0 ? HW + 2.1 : -(HW + 2.1)), 0.005, d.z);
        scene.add(pk);
        // 部署名(区画の内側・上端)
        const nm = mkLabel(d.name, 9, "#111", true);
        nm.sp.position.set(d.x, 0.1, d.z - HH + 0.9);
        scene.add(nm.sp);
        // 集計(区画の内側・下端): 職員n(男m) 利用者u
        const ct = mkLabel("", 11, "#333", true);
        ct.sp.position.set(d.x, 0.1, d.z + HH + 1.2);
        scene.add(ct.sp);
        zoneCountLabels[d.id] = ct;
      });

      const mkPerson = (name, bodyHex) => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.66, 1.7, 10), new THREE.MeshLambertMaterial({ color: bodyHex }));
        body.position.y = 0.95;
        g.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), new THREE.MeshLambertMaterial({ color: 0xffe0c4 }));
        head.position.y = 2.35;
        g.add(head);
        const lb = mkLabel(name, 7.4, "#222", true);
        lb.sp.position.y = 3.7;
        g.add(lb.sp);
        return g;
      };

      const TRIP = 24;
      const staffOf = (id) => master.staff.find((s) => s.id === id);
      const ov = data.staffOv || {};
      const wd = weekday;
      const libHelp3 = makeLibNameHelpers(data, wd);
      // リベルタ発着の便か: 乗客の過半がリベルタ利用(その方向)ならリベ便とみなす(noteが無くても判定できる)
      const isLibRun = (r, dir) => {
        if (/リベ迎|リベ送/.test(r.note || "")) return true; // noteの明示が最優先(あい迎はリベルタ発ではない)
        const us2 = (r.userIds || []).map((id) => master.users.find((u) => u.id === id)).filter(Boolean);
        if (!us2.length) return false;
        const n2 = us2.filter((u) => (u.libertaAM || u.libertaPM) && libHelp3.isLibOn(u, dir)).length;
        return n2 > 0 && n2 >= us2.length / 2;
      };

      // ---- 職員(区画の上半分)。男性=紺の塊(左)・女性=えんじの塊(右) ----
      const staffFigs = [];
      master.staff.filter((s) => !s.noGrid && s.emp !== "パート").forEach((s) => {
        let belong = belongDeptOf(master, s, wd);
        if (libD && belong === libD.id) belong = subDeptOf(s, wd) || s.deptId;
        const dep = zoneOf(belong);
        if (!dep) return;
        const o = ov[s.id] || {};
        const eff = staffTimeOf(s, wd, ov);
        const st = toMin(o.start || eff.start), en = toMin(o.end || eff.end);
        const off = (o.off === true) || ((s.offDays || []).includes(wd) && !o.workToday);
        if (off || st == null || en == null) return;
        const fig = mkPerson(s.name, s.isMale ? 0x1d4ed8 : 0xbe123c);
        scene.add(fig);
        // リベルタ所属: 早番は10:00から各事業所に登場、遅番は15:30でリベルタへ(=非表示)
        // 当日◆移動や兼務先変更で deptId が変わっていても、元がリベ職員なら同じルールを適用
        const isLibStaff = libD && (s.deptId === libD.id || s.baseDeptId === libD.id);
        const vs = isLibStaff && st < 9 * 60 ? Math.max(st, 10 * 60) : st;
        const ve = isLibStaff && en > 19 * 60 ? Math.min(en, 15 * 60 + 30) : en;
        // ヘルプ・予定(黒田ヘルプ等)の時間帯は現場に居るため区画から不在
        const busy = (data.blocks || [])
          .filter((b) => b.staffId === s.id && toMin(b.time) != null)
          .map((b) => [toMin(b.time), toMin(b.time) + helpDurMin(b)]);
        staffFigs.push({ s, fig, dep, st: vs, en: ve, male: !!s.isMale, busy, isLib: isLibStaff });
      });
      // 男女で塊を分けて整列(男=左側・女=右側)
      const layoutGroup = (figs, dep, zTop) => {
        const males = figs.filter((f) => f.male), fems = figs.filter((f) => !f.male);
        const place = (list, x0) => list.forEach((f, i) => {
          const cols = 4;
          f.hx = dep.x + x0 + (i % cols) * 3.0;
          f.hz = dep.z + zTop + Math.floor(i / cols) * 2.8;
        });
        place(males, -HW + 2.2);
        place(fems, 2.0);
      };
      depts4.forEach((d) => layoutGroup(staffFigs.filter((f) => f.dep.id === d.id), d, -HH + 3.0));

      // ---- 利用者(区画の下半分)。男性=水色の塊(左)・女性=ピンクの塊(右) ----
      const userFigs = [];
      master.users.filter((u) => (u.days || []).includes(wd) && !(data.userAbsent || {})[u.id]).forEach((u) => {
        const dep = zoneOf(u.deptId);
        if (!dep) return;
        const mr = (data.runs || []).find((r) => r.kind === "meet" && !r.mode && (r.userIds || []).includes(u.id));
        const sr = (data.runs || []).find((r) => r.kind === "send" && !r.mode && (r.userIds || []).includes(u.id));
        const fig = mkPerson(u.name, u.isMale ? 0x60a5fa : 0xf9a8d4);
        scene.add(fig);
        userFigs.push({ u, fig, dep, male: !!u.isMale, inAt: mr ? toMin(mr.time) + TRIP : 9 * 60, outAt: sr ? toMin(sr.time) : 16 * 60 });
      });
      depts4.forEach((d) => layoutGroup(userFigs.filter((f) => f.dep.id === d.id), d, 0.2));

      // ---- 車(名前+♿可否ラベル) ----
      const runsAll = (data.runs || []).filter((r) => r.vehicleId && !String(r.vehicleId).startsWith("own:") && r.mode !== "walk" && toMin(r.time) != null);
      // 駐車スロット: 枠の外側(左列の部署は右外・右列の部署は左外)に縦列。1列9台、あふれたら外側へもう1列
      const parkSlot = (c, p2) => {
        if (p2 === LIB_POS) return { x: p2.x - 10 + (c.slot % 8) * 3.1, z: p2.z };
        const col = Math.floor(c.slot / 9);
        // 自部署の枠に密着させて停める(左列=枠のすぐ右・右列=枠のすぐ左)→ 左右の車列が離れて帰属が分かる
        const outX = p2.x < 0 ? p2.x + HW + 1.5 + col * 3.4 : p2.x - HW - 1.5 - col * 3.4;
        return { x: outX, z: p2.z - HH + 1.5 + (c.slot % 9) * 2.05 };
      };
      const carObjs = [];
      master.vehicles.forEach((v, vi) => {
        const homeId = vehicleHomeOf(master, v);
        const home = posOfDept(homeId);
        const trips = runsAll.filter((r) => r.vehicleId === v.id).sort((a, b) => toMin(a.time) - toMin(b.time)).map((r) => {
          const st = staffOf(r.staffId);
          const dd = st ? posOfDept(belongDeptOf(master, st, wd)) : home;
          const isLibMeet = r.kind === "meet" && isLibRun(r, "meet");
          const isLibSend = r.kind === "send" && isLibRun(r, "send");
          return { t0: toMin(r.time), t1: toMin(r.time) + TRIP, dest: isLibSend ? LIB_POS : dd, origin0: isLibMeet ? LIB_POS : null, riders: (r.userIds || []).length, staffId: r.staffId };
        });
        // 回送(空車移動)を自動補完: リベ迎の前=基地→リベルタ、リベ送の後=リベルタ→基地
        const FERRY = 12; // 回送の所要(分)
        const trips2 = [];
        let pos = home;
        trips.forEach((tp, ti) => {
          if (tp.origin0 && pos !== LIB_POS) {
            trips2.push({ t0: tp.t0 - FERRY, t1: tp.t0, origin: pos, dest: LIB_POS, riders: 0, staffId: tp.staffId, ferry: true });
            pos = LIB_POS;
          }
          tp.origin = pos;
          trips2.push(tp);
          pos = tp.dest;
          if (tp.dest === LIB_POS) {
            const nx = trips[ti + 1];
            if (!(nx && nx.origin0 && nx.t0 - tp.t1 < 40)) {
              trips2.push({ t0: tp.t1, t1: tp.t1 + FERRY, origin: LIB_POS, dest: home, riders: 0, staffId: tp.staffId, ferry: true });
              pos = home;
            }
          }
        });
        // 終業回送: 最終便が基地以外で終わる場合、基地へ戻る回送を自動補完(実運用の暗黙の回送)
        if (trips2.length) {
          const lastT = trips2[trips2.length - 1];
          const hp = home === LIB_POS ? LIB_POS : home;
          if (lastT.dest !== hp) {
            trips2.push({ t0: lastT.t1 + 6, t1: lastT.t1 + 6 + FERRY, origin: lastT.dest, dest: hp, riders: 0, staffId: lastT.staffId, ferry: true, closing: true });
          }
        }
        trips.length = 0; trips.push(...trips2);
        const g = new THREE.Group();
        const dcol = (zoneOf(v.deptId) || { hex: 0xa78bfa }).hex;
        const bodyMat = new THREE.MeshLambertMaterial({ color: dcol });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 1.0), bodyMat);
        body.position.y = 0.6;
        g.add(body);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.9), new THREE.MeshLambertMaterial({ color: 0xffffff }));
        cab.position.set(-0.2, 1.15, 0);
        g.add(cab);
        [-0.62, 0.62].forEach((dx) => [-0.45, 0.45].forEach((dz) => {
          const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.15, 10), new THREE.MeshLambertMaterial({ color: 0x333333 }));
          wh.rotation.x = Math.PI / 2;
          wh.position.set(dx, 0.24, dz);
          g.add(wh);
        }));
        const dots = [];
        for (let i = 0; i < 7; i++) {
          const sph = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), new THREE.MeshLambertMaterial({ color: 0x555555 }));
          sph.position.set(-0.65 + (i % 4) * 0.43, 1.25, i < 4 ? 0.58 : -0.58);
          sph.visible = false;
          g.add(sph);
          dots.push(sph);
        }
        // 車名 + 車いす可否(♿=可・♿×=不可を色でも区別)
        const lb = mkLabel(v.name + (v.wheelchairOK ? " ♿" : ""), 5.4, v.wheelchairOK ? "#065f46" : "#111", true);
        lb.sp.position.y = 2.35;
        g.add(lb.sp);
        // 運転席の玉(走行中に運転者の色で表示)
        const driverMat = new THREE.MeshLambertMaterial({ color: 0x1d4ed8 });
        const driverDot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), driverMat);
        driverDot.position.set(-0.2, 1.55, 0);
        driverDot.visible = false;
        g.add(driverDot);
        // 駐車位置: 枠の外側(左列の部署=枠の右側・右列の部署=枠の左側)に縦列駐車
        const sameHome = carObjs.filter((c) => c.homeId === homeId).length;
        const sp0 = parkSlot({ slot: sameHome }, home);
        const px = sp0.x, pz = sp0.z;
        g.position.set(px, 0, pz);
        scene.add(g);
        carObjs.push({ g, v, homeId, trips, dots, parkX: px, parkZ: pz, bodyMat, baseHex: dcol, slot: sameHome, lb, driverDot, driverMat, curKey: "" });
      });

      // ---- 不自然な動きの検知 ----
      const deptNameOf = (p2) => p2 === LIB_POS ? "リベルタ" : ((depts4.find((d) => d.x === p2.x && d.z === p2.z) || {}).name || "?");
      const fmtT = (t2) => `${Math.floor(t2 / 60)}:${String(t2 % 60).padStart(2, "0")}`;
      const anomalies = [];
      carObjs.forEach((c) => {
        const home = posOfDept(c.homeId);
        c.trips.forEach((tp, i2) => {
          if (i2 > 0) {
            const prev = c.trips[i2 - 1];
            if (!tp.ferry && !prev.ferry && tp.t0 - prev.t0 < 10) anomalies.push({ t: tp.t0, car: c, text: `🚗 ${c.v.name}: ${fmtT(prev.t0)}の便の直後(${fmtT(tp.t0)})にまた出発(間隔が10分未満)` });
            if (tp.ferry && !tp.closing && prev.t1 > tp.t0) anomalies.push({ t: tp.t0, car: c, text: `🚗 ${c.v.name}: ${fmtT(prev.t1)}まで前の便があり、リベルタへの回送時間が足りない` });
            if (!tp.ferry && prev.ferry && prev.t1 > tp.t0) anomalies.push({ t: tp.t0, car: c, text: `🚗 ${c.v.name}: リベルタからの回送(〜${fmtT(prev.t1)})が${fmtT(tp.t0)}の便に間に合わない` });
          }
        });
        // 運転者の交代チェック: 同じ場所で引き継ぐのが正常。場所が繋がらない・走行中の交代はエラー
        c.trips.forEach((tp, i2) => {
          if (i2 === 0) return;
          const prev = c.trips[i2 - 1];
          if (prev.staffId !== tp.staffId && !prev.ferry && !tp.ferry) {
            const pn = (staffOf(prev.staffId) || {}).name || "?";
            const cn = (staffOf(tp.staffId) || {}).name || "?";
            if (prev.dest !== tp.origin) {
              anomalies.push({ t: tp.t0, car: c, text: `🚗 ${c.v.name}: ${fmtT(tp.t0)}に運転が${pn}→${cn}に変わるが、${deptNameOf(prev.dest)}と${deptNameOf(tp.origin)}で場所が繋がらない(車の受け渡しができない)` });
            } else if (tp.t0 < prev.t1) {
              anomalies.push({ t: tp.t0, car: c, text: `🚗 ${c.v.name}: 走行中(〜${fmtT(prev.t1)})に運転が${pn}→${cn}へ交代している` });
            }
          }
        });
        // 終業回送を補完済みなら情報として表示(赤エラーではなく青)。補完不能(最終が基地)のケースはそもそも問題なし
        const closing = c.trips.find((tp) => tp.closing);
        if (closing) anomalies.push({ t: closing.t0, info: true, text: `ℹ ${c.v.name}: 最終便の後、${deptNameOf(closing.origin)}→基地(${deptNameOf(home)})への回送が必要(${fmtT(closing.t0)}ごろ)` });
      });
      // 職員の瞬間移動(運転の連続で場所が飛ぶ)
      const stTrips = {};
      carObjs.forEach((c) => c.trips.forEach((tp) => { (stTrips[tp.staffId] = stTrips[tp.staffId] || []).push({ ...tp, isLibOrigin: !!tp.origin0 }); }));
      Object.values(stTrips).forEach((list) => list.sort((a, b) => a.t0 - b.t0));
      Object.entries(stTrips).forEach(([sid, list]) => {
        const s = staffOf(sid);
        if (!s) return;
        list.sort((a, b) => a.t0 - b.t0);
        for (let i2 = 1; i2 < list.length; i2++) {
          const prev = list[i2 - 1], cur = list[i2];
          if (cur.t0 - prev.t1 < 8 && prev.dest !== cur.origin) {
            anomalies.push({ t: cur.t0, text: `👤 ${s.name}: ${fmtT(cur.t0)}に${deptNameOf(prev.dest)}から${deptNameOf(cur.origin)}へ瞬間移動(移動時間がない)` });
          }
        }
      });
      // 職員の出勤・帰着ルール:
      //   嫁島の職員=嫁島発着 / 自車の職員=自部署発着 / リベ早番=リベ発→事業所終了 / リベ遅番=事業所発→最終リベルタ行き
      const zoneNameAt = (p2) => p2 === LIB_POS ? "リベルタ" : deptNameOf(p2);
      Object.entries(stTrips).forEach(([sid, list]) => {
        const s = staffOf(sid);
        if (!s) return;
        list.sort((a, b) => a.t0 - b.t0);
        const isLibS = libD && s.deptId === libD.id;
        const eff2 = staffTimeOf(s, wd, ov);
        const st2 = toMin(eff2.start), en2 = toMin(eff2.end);
        const early = isLibS && st2 != null && st2 < 9 * 60;
        const late = isLibS && en2 != null && en2 > 19 * 60;
        let belong2 = belongDeptOf(master, s, wd);
        if (libD && belong2 === libD.id) belong2 = subDeptOf(s, wd) || s.deptId;
        const belongPos = posOfDept(belong2);
        const yokaPos = depts4[0]; // 嫁島(先頭部署)
        const expStart = early ? LIB_POS : (s.hasOwnCar || late ? belongPos : yokaPos);
        const expEnd = late ? LIB_POS : (s.hasOwnCar || early ? belongPos : yokaPos);
        // 嫁島出勤の職員(自車なし・リベ以外)は公用車に同乗してどこへでも移動できるため、朝・終の場所はエラーにしない。
        // 確実に矛盾になるのは「自車で通勤している職員が自部署以外で終わる」「リベ遅番がリベルタ以外で終わる」のみ
        const nonFerry = list.filter((x) => !x.ferry);
        const first = nonFerry[0];
        const lastAll = list[list.length - 1]; // 終業回送(車と一緒に嫁島へ戻る)も含めた最終位置
        if (s.hasOwnCar && !isLibS) {
          if (lastAll && lastAll.dest !== belongPos) {
            anomalies.push({ t: lastAll.t1, text: `👤 ${s.name}: 自車通勤なのに最終が${zoneNameAt(lastAll.dest)}で終わる(自車のある${zoneNameAt(belongPos)}に戻れない)` });
          }
          if (first && !first.isLibOrigin && first.origin !== belongPos && first.origin !== yokaPos) {
            anomalies.push({ t: first.t0, text: `👤 ${s.name}: 自車通勤(${zoneNameAt(belongPos)})なのに朝一の便が${zoneNameAt(first.origin)}発` });
          }
        } else if (isLibS && late) {
          if (lastAll && lastAll.dest !== LIB_POS) {
            anomalies.push({ t: lastAll.t1, text: `👤 ${s.name}: リベ遅番なのに最終が${zoneNameAt(lastAll.dest)}で終わる(最終は自車でリベルタ行きのはず)` });
          }
        }
      });
      // データ世代ズレの検出(バージョン更新でマスタが作り直され、シートのIDが古い場合)
      const knownS = new Set(master.staff.map((s2) => s2.id));
      const knownV = new Set(master.vehicles.map((v2) => v2.id));
      const stale = (data.runs || []).filter((r) => (r.staffId && r.staffId !== HOLD_ID && !knownS.has(r.staffId)) || (r.vehicleId && !String(r.vehicleId).startsWith("own:") && r.vehicleId !== "__walk__" && !knownV.has(r.vehicleId))).length;
      if (stale > 0) anomalies.unshift({ t: 7 * 60 + 30, text: `⚠ ${stale}件の便が現在の職員・車両と結び付いていません(データの世代ズレ)。送迎表タブで「パターンから読込」をやり直すと直ります` });
      anomalies.sort((a, b) => a.t - b.t);
      setAnomalyList(anomalies.map((a) => ({ t: a.t, text: a.text, info: !!a.info })));

      const lerp = (a, b, t) => a + (b - a) * t;
      let last = performance.now();
      const tick = (now) => {
        if (!alive) return;
        raf = requestAnimationFrame(tick);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (playRef.current) {
          clockRef.current += dt * speedRef.current / 60 * 10;
          if (clockRef.current > 19 * 60) clockRef.current = 7 * 60 + 30;
          setClockMin(Math.floor(clockRef.current));
        }
        const T = clockRef.current;
        const drivingNow = new Set();
        const slotAt = parkSlot;
        carObjs.forEach((c) => {
          let x = c.parkX, z = c.parkZ, riders = 0, moving = false, ang = 0;
          for (const tp of c.trips) {
            if (T < tp.t0) break;
            if (T <= tp.t1) {
              const s0 = slotAt(c, tp.origin), s1 = slotAt(c, tp.dest);
              const f = (T - tp.t0) / (tp.t1 - tp.t0);
              x = lerp(s0.x, s1.x, f);
              z = lerp(s0.z, s1.z, f);
              riders = tp.riders;
              moving = true;
              ang = Math.atan2(s1.x - s0.x, s1.z - s0.z);
              drivingNow.add(tp.staffId);
            } else { const s1 = slotAt(c, tp.dest); x = s1.x; z = s1.z; }
          }
          c.g.position.set(x, 0, z);
          if (moving) c.g.rotation.y = ang + Math.PI / 2;
          c.dots.forEach((d, i) => { d.visible = moving && i < riders; });
          // 運転手の玉と車ラベル(運転者名)
          const curTrip = c.trips.find((tp) => T >= tp.t0 && T <= tp.t1);
          const drv = curTrip ? staffOf(curTrip.staffId) : null;
          c.driverDot.visible = !!(moving && drv);
          if (drv) c.driverMat.color.setHex(drv.isMale ? 0x1d4ed8 : 0xbe123c);
          const key3 = drv ? drv.name : "";
          if (key3 !== c.curKey) {
            c.curKey = key3;
            c.lb.g.clearRect(0, 0, 320, 64);
            c.lb.g.font = "bold 36px sans-serif";
            c.lb.g.fillStyle = c.v.wheelchairOK ? "#065f46" : "#111";
            c.lb.g.textAlign = "center";
            c.lb.g.fillText(c.v.name + (c.v.wheelchairOK ? " ♿" : "") + (key3 ? " " + key3 : ""), 160, 44);
            c.lb.tx.needsUpdate = true;
          }
        });
        staffFigs.forEach((f) => {
          if (!(T >= f.st && T < f.en) || drivingNow.has(f.s.id) || (f.busy || []).some(([b0, b1]) => T >= b0 && T < b1)) { f.fig.visible = false; return; }
          // 便の履歴から現在の居場所(区画)を推定: 最初の便までは出発地、便後は到着地
          const list3 = stTrips[f.s.id];
          let at = f.dep; // 既定=所属区画
          if (list3 && list3.length) {
            const sorted3 = list3;
            if (T < sorted3[0].t0) at = f.isLib ? f.dep : sorted3[0].origin;
            else {
              for (let i3 = sorted3.length - 1; i3 >= 0; i3--) {
                if (T > sorted3[i3].t1) { at = sorted3[i3].dest; break; }
              }
            }
          }
          if (at === LIB_POS) { f.fig.visible = false; return; } // リベルタ滞在中は画面外
          const zone3 = at && at.x != null ? at : f.dep;
          f.fig.visible = true;
          f.fig.position.set(zone3.x + (f.hx - f.dep.x), 0, zone3.z + (f.hz - f.dep.z));
        });
        userFigs.forEach((f) => {
          const here = T >= f.inAt && T < f.outAt;
          f.fig.visible = here;
          if (here) f.fig.position.set(f.hx, 0, f.hz);
        });
        // 下部の集計: 職員n(男m) 利用者u
        // 不自然な動きの発生中: バナー+該当車を赤点滅
        const act = anomalies.filter((a) => !a.info && T >= a.t - 1 && T <= a.t + 8);
        const key2 = act.map((a) => a.text).join("|");
        if (key2 !== alertsKeyRef.current) { alertsKeyRef.current = key2; setAlerts(act.map((a) => a.text)); }
        const blink = Math.sin(now / 120) > 0;
        carObjs.forEach((c) => {
          const hot = act.some((a) => a.car === c);
          if (c.bodyMat) c.bodyMat.color.setHex(hot && blink ? 0xdc2626 : c.baseHex);
        });
        depts4.forEach((d) => {
          const sf = staffFigs.filter((f) => f.dep.id === d.id && f.fig.visible);
          const uf = userFigs.filter((f) => f.dep.id === d.id && f.fig.visible);
          const males = sf.filter((f) => f.male).length;
          const lb = zoneCountLabels[d.id];
          lb.g.clearRect(0, 0, 320, 64);
          lb.g.font = "bold 34px sans-serif";
          lb.g.fillStyle = "#1f2937";
          lb.g.textAlign = "center";
          lb.g.fillText(`職員${sf.length}(男${males}) 利用者${uf.length}`, 160, 44);
          lb.tx.needsUpdate = true;
        });
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(tick);

      // ドラッグ=パン(2D地図の移動)・ホイール=ズーム
      let drag = null;
      const dom = renderer.domElement;
      dom.style.cursor = "grab";
      dom.addEventListener("mousedown", (e) => { drag = { x: e.clientX, y: e.clientY, px: panX, pz: panZ }; dom.style.cursor = "grabbing"; });
      window.addEventListener("mousemove", (e) => {
        if (drag) {
          const k = VIEW / (H * zoom);
          panX = drag.px - (e.clientX - drag.x) * k;
          panZ = drag.pz - (e.clientY - drag.y) * k;
          setCam();
        }
      });
      window.addEventListener("mouseup", () => { drag = null; dom.style.cursor = "grab"; });
      dom.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(4, zoom * (e.deltaY > 0 ? 0.9 : 1.12))); setCam(); setZoomUi(Math.round(zoom * 100)); }, { passive: false });
      applyZoomRef.current = (z2) => { zoom = Math.max(0.5, Math.min(4, z2)); setCam(); };
      applyViewRef.current = (x2, z2, zm2) => { panX = x2; panZ = z2; zoom = Math.max(0.5, Math.min(4, zm2)); setCam(); setZoomUi(Math.round(zoom * 100)); };

      cleanupRef.current = () => { cancelAnimationFrame(raf); try { renderer.dispose(); el.removeChild(dom); } catch (e) {} };
    })();
    return () => { alive = false; if (cleanupRef.current) cleanupRef.current(); if (el) el.innerHTML = ""; };
  }, [master, data, weekday, height, widthHint]);

  const hh = Math.floor(clockMin / 60), mm = String(clockMin % 60).padStart(2, "0");
  return (
    <div>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <button className={btnPri} onClick={() => setPlaying((p) => !p)}>{playing ? "⏸ 一時停止" : "▶ 再生"}</button>
        <button className={btnSec} title="30分戻る(押すと一時停止)" onClick={() => {
          const v = Math.max(7 * 60 + 30, Math.ceil(clockRef.current / 30) * 30 - 30);
          clockRef.current = v; setClockMin(v); setPlaying(false);
        }}>⏮ 30分</button>
        <button className={btnSec} title="30分進む(押すと一時停止)" onClick={() => {
          const v = Math.min(19 * 60, Math.floor(clockRef.current / 30) * 30 + 30);
          clockRef.current = v; setClockMin(v); setPlaying(false);
        }}>30分 ⏭</button>
        <span className="text-2xl font-bold tabular-nums">{hh}:{mm}</span>
        <input type="range" min={7 * 60 + 30} max={19 * 60} value={clockMin} className="flex-1 min-w-40"
          onChange={(e) => { const v = Number(e.target.value); clockRef.current = v; setClockMin(v); }} />
        <select className="border border-stone-300 rounded px-1.5 py-1 text-sm" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          <option value={30}>ゆっくり</option>
          <option value={60}>ふつう</option>
          <option value={150}>はやい</option>
        </select>
        <span className="text-xs text-stone-500 whitespace-nowrap">🔍 {zoomUi}%</span>
        <input type="range" min={50} max={400} value={zoomUi} className="w-28"
          onChange={(e) => { const v = Number(e.target.value); setZoomUi(v); if (applyZoomRef.current) applyZoomRef.current(v / 100); }} />
      </div>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-xs text-stone-500">表示:</span>
        {[["all", "全体"], ...master.departments.filter((dd) => !/リベルタ/.test(dd.name)).slice(0, 4).map((dd, i) => [String(i), dd.name])].map(([k, label]) => (
          <span key={k} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer select-none ${focus3d === k ? "bg-stone-700 text-white border-stone-700 font-bold" : "bg-white border-stone-300 hover:bg-stone-100"}`}
            onClick={() => {
              setFocus3d(k);
              if (!applyViewRef.current) return;
              if (k === "all") { applyViewRef.current(0, 0, 1.85); return; }
              const CX = 27 / 2 + 12 / 2, CZ = 18 / 2 + 4.2 / 2;
              const P = [[-CX, -CZ], [CX, -CZ], [-CX, CZ], [CX, CZ]][Number(k)];
              applyViewRef.current(P[0], P[1], 3.2);
            }}>{label}</span>
        ))}
      </div>
      {!compact && <div className="text-xs text-stone-500 mb-1">🖱 ドラッグ=地図の移動、ホイール=拡大縮小。各区画: 上段=職員(紺=男・えんじ=女)、下段=利用者(水色=男・ピンク=女)で男女別の塊。車のラベル: ♿=車いす可 / ♿×=不可。リベルタ行きの車は画面の上方向(場外)へ。</div>}
      {webglNg ? (
        <div className="p-10 text-center text-stone-500 bg-white border border-stone-200 rounded">この環境では3D表示(WebGL)が使えません。ブラウザで開くと表示されます。</div>
      ) : (
        <>
          <div className="relative">
            <div ref={wrapRef} className="rounded-lg overflow-hidden border border-stone-200 bg-white" />
            {alerts.length > 0 && (
              <div className="absolute inset-0 pointer-events-none rounded-lg border-4 border-red-500 bg-red-500/10 animate-pulse" />
            )}
          </div>
          {alerts.length > 0 && (
            <div className="mt-1">
              {alerts.map((a, i) => (
                <div key={i} className="bg-red-600 text-white text-sm font-bold rounded px-3 py-1.5 mb-1 shadow">⚠ {a}</div>
              ))}
            </div>
          )}
        </>
      )}
      {anomalyList.length > 0 && (
        <div className="mt-2 border border-red-200 bg-red-50 rounded p-2 max-h-28 overflow-y-auto">
          <div className="text-xs font-bold text-red-700 mb-1">⚠ 不自然な動き {anomalyList.filter((a) => !a.info).length}件 / ℹ 情報 {anomalyList.filter((a) => a.info).length}件(クリックでその時刻へ)</div>
          {anomalyList.map((a, i) => (
            <div key={i} className={`text-xs cursor-pointer hover:underline ${a.info ? "text-sky-700" : "text-red-800"}`}
              onClick={() => { clockRef.current = Math.max(7 * 60 + 30, a.t - 2); setClockMin(Math.floor(clockRef.current)); }}>
              {Math.floor(a.t / 60)}:{String(a.t % 60).padStart(2, "0")} — {a.text}
            </div>
          ))}
        </div>
      )}
      {anomalyList.filter((a) => !a.info).length === 0 && !webglNg && (
        <div className="mt-2 text-xs text-emerald-700">✓ この日の車と職員の動きに不自然な点はありません</div>
      )}
    </div>
  );
}

function VehicleTimeline({ master, data, weekday }) {
  const CHIP = ["bg-sky-100 border-sky-300", "bg-amber-100 border-amber-300", "bg-emerald-100 border-emerald-300", "bg-rose-100 border-rose-300", "bg-violet-100 border-violet-300"];
  const deptIdx = (id) => Math.max(0, master.departments.findIndex((d) => d.id === id)) % CHIP.length;
  const slots = useMemo(() => {
    let lo = 8 * 60, hi = 18 * 60 + SLOT;
    [...(data.runs || []), ...(data.blocks || [])].forEach((x) => {
      const t = toMin(x.time);
      if (t == null) return;
      lo = Math.min(lo, Math.floor(t / SLOT) * SLOT);
      hi = Math.max(hi, Math.floor(t / SLOT) * SLOT + SLOT);
    });
    const a = [];
    for (let t = lo; t < hi; t += SLOT) a.push(t);
    return a;
  }, [data]);
  const posAt = useMemo(() => simulateVehicles(master, data, slots), [master, data, slots]);
  const conflicts = useMemo(() => vehicleConflictList(master, data), [master, data]);
  const vehShort = useMemo(() => makeVehShortMap(master.vehicles), [master]);
  // 人員(利用者数・在席職員数)も同じ時間軸で計算して各マスに併記
  // 「今」の時間帯(30分刻みに丸め)と、確認したい時刻の選択
  const nowSlotOf = () => {
    const d0 = new Date();
    const m0 = d0.getHours() * 60 + Math.floor(d0.getMinutes() / SLOT) * SLOT;
    return Math.max(slots[0], Math.min(slots[slots.length - 1], m0));
  };
  const [selSlot, setSelSlot] = useState(nowSlotOf());
  const selRowRef = useRef(null);
  useEffect(() => {
    if (selRowRef.current) selRowRef.current.scrollIntoView({ block: "center" });
  }, [selSlot]);
  const covCalc = useMemo(() => (weekday == null ? [] : buildCoverageCalc(master, data, weekday, slots)), [master, data, weekday, slots]);
  const covAt = useMemo(() => { const m = {}; covCalc.forEach((c2) => { m[c2.t] = c2; }); return m; }, [covCalc]);
  const gapSt = useMemo(() => maleGapStatus(master, covCalc), [master, covCalc]);
  const belongOf2 = (s) => belongDeptOf(master, s, weekday);
  const vehDepts = master.departments.filter((d) =>
    master.vehicles.some((v) => v.deptId === d.id) ||
    master.users.some((u) => u.deptId === d.id) ||
    master.staff.some((s) => belongOf2(s) === d.id));
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-3 max-w-[1080px]">
      <div className="font-bold text-stone-700 mb-1">車両の動きと人員配置 <span className="font-normal text-xs text-stone-400">(各時間帯にその事業所に残っている車と人員)</span></div>
      <div className="text-[11px] text-stone-500 mb-2">朝のスタート=1日の最終帰着地=基地(ノンタン=あいのて、チョッパー=川津、ドラ=リベルタ、その他=嫁島)。所要時間の間は右端の移動中・外出中に入り、終了後は「行先」に置かれます。各マス下段:<b><span className="text-emerald-700">利:n</span>=その時間に居る利用者数 / <span className="text-violet-700">職:n</span>=在席職員数(常勤・パート含む、与倉・古田は除く) / <span className="text-orange-600">(外n)</span>=送迎・ヘルプで外に出ている職員数 / <span className="text-sky-700">男:n</span>=在席の男性職員数</b>。<span className="text-rose-600 font-bold">濃い赤=職員ゼロ(許容なし)</span>・<span className="text-rose-400 font-bold">うすい赤=男性ゼロが許容超え</span>・<span className="text-amber-600 font-bold">黄=男性ゼロ(許容内)</span>。</div>
      {conflicts.length > 0 && (
        <div className="text-xs text-rose-800 bg-rose-50 border-2 border-rose-300 rounded-lg p-2 mb-2">
          <div className="font-bold">🚨 車両の時間重複({conflicts.length}件)</div>
          {conflicts.map((c2, i2) => <div key={i2}>・{c2}</div>)}
        </div>
      )}
      <div className="border-2 border-sky-300 bg-sky-50 rounded-lg p-2 mb-2">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="font-bold text-sky-900 text-sm">🚗 {toStr(selSlot)} に使える車</span>
          <button className="text-xs px-2 py-0.5 rounded border border-stone-300 bg-white hover:bg-stone-50" onClick={() => setSelSlot((s0) => Math.max(slots[0], s0 - SLOT))}>◀ 30分前</button>
          <select className="text-xs border border-stone-300 rounded px-1 py-0.5 bg-white" value={selSlot} onChange={(e) => setSelSlot(Number(e.target.value))}>
            {slots.map((s0) => <option key={s0} value={s0}>{toStr(s0)}</option>)}
          </select>
          <button className="text-xs px-2 py-0.5 rounded border border-stone-300 bg-white hover:bg-stone-50" onClick={() => setSelSlot((s0) => Math.min(slots[slots.length - 1], s0 + SLOT))}>30分後 ▶</button>
          <button className="text-xs px-2 py-0.5 rounded border border-sky-400 bg-sky-100 text-sky-800 font-bold hover:bg-sky-200" onClick={() => setSelSlot(nowSlotOf())}>今</button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {vehDepts.filter((d) => master.vehicles.some((v) => v.deptId === d.id) || master.vehicles.some((v) => posAt[v.id] && posAt[v.id][selSlot] === d.id)).map((d) => {
            const here = master.vehicles.filter((v) => posAt[v.id] && posAt[v.id][selSlot] === d.id);
            const inAct = (v) => ACTIVITY_VEHICLES[v.name] && inActivityWindow(selSlot, selSlot + SLOT);
            return (
              <div key={d.id} className="flex items-center gap-1">
                <span className="text-xs font-bold text-stone-600">{d.name}:</span>
                {here.length === 0 ? <span className="text-xs text-rose-500 font-bold">なし</span> : here.map((v) => (
                  inAct(v)
                    ? <span key={v.id} className="text-[11px] px-1 py-0.5 rounded border border-stone-300 bg-stone-100 text-stone-400 line-through" title={`${ACTIVITY_VEHICLES[v.name]}の生活介護活動で使用中(訓練の人はついでに拾えます)`}>{vehShort[v.id] || v.name}活動</span>
                    : <span key={v.id} className={`text-[11px] px-1 py-0.5 rounded border font-bold ${CHIP[deptIdx(v.deptId)]}`}>{vehShort[v.id] || v.name}</span>
                ))}
              </div>
            );
          })}
          {(() => {
            const moving = master.vehicles.filter((v) => posAt[v.id] && posAt[v.id][selSlot] === null);
            return moving.length ? (
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-stone-400">移動中:</span>
                {moving.map((v) => <span key={v.id} className="text-[11px] px-1 py-0.5 rounded border border-stone-300 bg-white text-stone-400">{vehShort[v.id] || v.name}</span>)}
              </div>
            ) : null;
          })()}
        </div>
        {inActivityWindow(selSlot, selSlot + SLOT) && (
          <div className="text-[11px] text-amber-700 mt-1">⚠ 活動時間帯です: あいのては2台を活動用に空けておく必要があります(打ち消し表示の車は活動で使用中)</div>
        )}
      </div>
      <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
        <table className="border-collapse w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: 44 }} />
            {vehDepts.map((d) => (
              <col key={d.id} style={{ width: `${(86 / Math.max(1, vehDepts.length)).toFixed(2)}%` }} />
            ))}
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 bg-stone-100 border border-stone-300 px-2 py-1 text-xs">時刻</th>
              {vehDepts.map((d) => (
                <th key={d.id} className={`sticky top-0 border border-stone-300 px-2 py-1 text-xs ${CHIP[deptIdx(d.id)]}`}>{d.name}</th>
              ))}
              <th className="sticky top-0 bg-stone-200 border border-stone-300 px-2 py-1 text-xs">移動中・外出中</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s2) => (
              <tr key={s2} ref={s2 === selSlot ? selRowRef : null} className={s2 === selSlot ? "bg-amber-50 ring-2 ring-inset ring-amber-300" : ""}>
                <td className={`border border-stone-200 px-1 py-0.5 text-right text-xs font-bold align-top ${s2 === selSlot ? "text-amber-700 bg-amber-100" : s2 % 60 === 0 ? "text-stone-700 bg-stone-50" : "text-stone-300"}`}>
                  {s2 % 60 === 0 || s2 === selSlot ? toStr(s2) : ""}
                </td>
                {vehDepts.map((d) => {
                  const here = master.vehicles.filter((v) => posAt[v.id] && posAt[v.id][s2] === d.id);
                  const c3 = covAt[s2];
                  const cc = c3 ? (c3.cnt[d.id] || { u: 0, s: 0, sOut: 0 }) : null;
                  const mc = c3 ? (c3.per[d.id] || { present: [], away: [] }) : null;
                  const hasPeople = cc && (cc.u || cc.s || cc.sOut);
                  const noStaff = cc && cc.u > 0 && cc.s === 0;
                  const capOver2 = cc && d.capMax != null && d.capMax !== "" && cc.u + cc.s > Number(d.capMax);
                  const stOver2 = cc && d.staffMax != null && d.staffMax !== "" && cc.s > Number(d.staffMax);
                  const stUnder2 = cc && d.staffMin != null && d.staffMin !== "" && cc.u > 0 && cc.s < Number(d.staffMin);
                  const gs = (gapSt[d.id] || {})[s2]; // "warn"=男性ゼロ(許容内) / "over"=許容超え
                  return (
                    <td key={d.id} className="border border-stone-200 px-1 py-0.5 align-top">
                      {here.length > 0 && (
                        <div className="grid grid-cols-4 gap-0.5 justify-items-start">
                          {here.map((v) => (
                            <span key={v.id} className={`text-[11px] leading-tight px-1 py-0.5 rounded border whitespace-nowrap ${CHIP[deptIdx(v.deptId)]}`}>{vehShort[v.id] || v.name}</span>
                          ))}
                        </div>
                      )}
                      {hasPeople ? (
                        <div className={`${here.length ? "mt-1 " : ""}text-sm font-bold leading-tight rounded px-1 ${noStaff ? "bg-rose-200 ring-1 ring-rose-400" : stUnder2 ? "bg-rose-100 ring-1 ring-rose-300" : capOver2 || stOver2 ? "bg-orange-200 ring-1 ring-orange-400" : gs === "over" ? "bg-rose-100 ring-1 ring-rose-300" : gs === "warn" ? "bg-amber-100" : ""}`}
                          title={`利用者${cc.u}名 / 職員${cc.s}名(在席・パート含む)${capOver2 ? ` / ⚠在席${cc.u + cc.s}名で上限${d.capMax}名を超過` : ""}${stOver2 ? ` / ⚠職員${cc.s}名で上限${d.staffMax}名を超過(駐車${d.staffMax}台分)` : ""}${stUnder2 ? ` / 🚨職員${cc.s}名で最低${d.staffMin}名を下回っています` : ""}${cc.sOut ? ` / 送迎等で外出中${cc.sOut}名` : ""} / 男性職員${mc.present.length}名${mc.away.length ? `(うち外出中${mc.away.length})` : ""} ※与倉・古田は含みません`}>
                          <span className="whitespace-nowrap text-emerald-700">利:{cc.u}</span>{" "}
                          <span className="whitespace-nowrap text-violet-700">職:{cc.s}{cc.sOut ? <span className="text-orange-600">(外{cc.sOut})</span> : null}</span>{" "}
                          <span className="whitespace-nowrap text-sky-700">男:{mc.present.length}</span>
                        </div>
                      ) : null}
                    </td>
                  );
                })}
                <td className="border border-stone-200 px-1 py-0.5 align-top bg-stone-50">
                  <div className="flex flex-wrap gap-0.5">
                    {master.vehicles.filter((v) => posAt[v.id] && posAt[v.id][s2] === null).map((v) => (
                      <span key={v.id} className="text-[11px] leading-tight px-1 py-0.5 rounded border border-stone-400 bg-white text-stone-500">🚗{vehShort[v.id] || v.name}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* 「迎え/送りが不要(理由あり)」ゾーン: 未割当チップをドラッグ→その場で理由を入力。Excelの特記事項に「迎え無し: 名前(理由)」で出る */
function NoRideZone({ master, weekday, noRide, kind, label, onSetNoRide }) {
  const [ov, setOv] = useState(false);
  const [pendingId, setPendingId] = useState(null); // 理由入力中の利用者ID
  const [reasonText, setReasonText] = useState("");
  const list = master.users.filter((u) => (noRide[u.id] || {})[kind] && (u.days || []).includes(weekday));
  const pendingUser = pendingId ? master.users.find((x) => x.id === pendingId) : null;
  const commit = () => {
    const t = reasonText.trim();
    if (pendingId && t) onSetNoRide(pendingId, kind, t);
    setPendingId(null);
    setReasonText("");
  };
  return (
    <div className={`mb-2 border-2 border-dashed rounded p-1.5 ${ov ? "border-amber-500 bg-amber-50" : "border-stone-200 bg-stone-50"}`}
      onDragOver={(e) => {
        if (DRAG && DRAG.t === "user" && !DRAG.fromRunId) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (!ov) setOv(true); }
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) setOv(false); }}
      onDrop={(e) => {
        setOv(false);
        if (DRAG && DRAG.t === "user" && !DRAG.fromRunId) {
          e.preventDefault(); e.stopPropagation();
          const uid2 = DRAG.userId;
          DRAG = null;
          setPendingId(uid2);
          setReasonText("");
        }
      }}>
      <div className="text-[11px] font-bold text-stone-500">{label}不要(理由あり) — 上の未割当から利用者をここへドラッグ。Excelでは「{label}無し: 名前(理由)」と特記事項に出ます</div>
      {pendingId && (
        <div className="mt-1 bg-white border border-amber-400 rounded p-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs font-bold text-stone-700 whitespace-nowrap">{pendingUser ? pendingUser.name : ""}:</span>
            {(kind === "meet" ? ["家族送", "受診後来所", "訓練迎えで来所"] : ["家族迎", "訓練送りで終了"]).map((preset) => (
              <button key={preset} className="text-xs px-2 py-0.5 rounded border border-amber-400 bg-amber-50 text-stone-700 hover:bg-amber-100 font-bold"
                onClick={() => { onSetNoRide(pendingId, kind, preset); setPendingId(null); setReasonText(""); }}>
                {preset}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <input autoFocus value={reasonText} onChange={(e) => setReasonText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setPendingId(null); setReasonText(""); } }}
              className="border border-stone-300 rounded px-1.5 py-0.5 text-xs flex-1 outline-none focus:border-amber-500"
              placeholder="その他の理由を入力" />
            <button className="text-xs px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40" disabled={!reasonText.trim()} onClick={commit}>登録</button>
            <button className="text-xs px-1.5 py-0.5 rounded border border-stone-300 hover:bg-stone-100" onClick={() => { setPendingId(null); setReasonText(""); }}>取消</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1">
        {list.length === 0 && !pendingId && <span className="text-[11px] text-stone-400">なし</span>}
        {list.map((u) => (
          <span key={u.id} className="inline-flex items-center text-xs rounded border bg-amber-100 border-amber-300 text-stone-700 overflow-hidden">
            <button className="px-2 py-0.5 hover:brightness-95" title="クリックで理由を編集"
              onClick={() => { setPendingId(u.id); setReasonText((noRide[u.id] || {})[kind] || ""); }}>
              {u.name}({(noRide[u.id] || {})[kind]})
            </button>
            <button className="px-1 py-0.5 border-l border-amber-300 text-stone-500 hover:bg-rose-100 hover:text-rose-600" title="解除して未割当に戻す"
              onClick={() => onSetNoRide(u.id, kind, null)}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

/* 本日だけの利用時間の変更(早退・遅刻など)。基本や曜日別の設定はそのまま、この日のみ上書き */
function UserTimeZone({ master, weekday, userTime, onSet }) {
  const [open, setOpen] = useState(false);
  const [selId, setSelId] = useState("");
  const users = master.users.filter((u) => (u.days || []).includes(weekday));
  const changed = users.filter((u) => userTime[u.id] && (userTime[u.id].meet || userTime[u.id].send));
  return (
    <div className="mb-2 border border-amber-200 bg-amber-50 rounded p-1.5">
      <button className="w-full text-left text-[11px] font-bold text-amber-700" onClick={() => setOpen(!open)}>
        {open ? "▼" : "▶"} 利用時間の変更(本日) {changed.length ? `— ${changed.length}名` : ""}
        <span className="font-normal text-amber-400"> クリックで{open ? "閉じる" : "開く"}</span>
      </button>
      {open && (
        <div className="mt-1">
          <div className="flex items-center gap-1 flex-wrap">
            <select className="border border-stone-300 rounded px-1 py-0.5 text-xs bg-white" value={selId} onChange={(e) => setSelId(e.target.value)}>
              <option value="">利用者を選択...</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {selId && (() => {
              const u = users.find((x) => x.id === selId);
              const base = userTimeOf(u, weekday, {});
              const cur = userTime[selId] || {};
              const setF = (field, val) => onSet(selId, field, val);
              return (
                <>
                  <span className="text-[10px] text-stone-400">迎(通常 {base.meet || "-"})</span>
                  <input className="w-16 border border-stone-300 rounded px-1 py-0.5 text-xs" value={cur.meet || ""} placeholder={base.meet || "8:30"} onChange={(e) => setF("meet", e.target.value)} />
                  <span className="text-[10px] text-stone-400">送(通常 {base.send || "-"})</span>
                  <input className="w-16 border border-stone-300 rounded px-1 py-0.5 text-xs" value={cur.send || ""} placeholder={base.send || "16:00"} onChange={(e) => setF("send", e.target.value)} />
                </>
              );
            })()}
          </div>
          {changed.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {changed.map((u) => {
                const t = userTime[u.id];
                return (
                  <span key={u.id} className="inline-flex items-center text-xs rounded border bg-white border-amber-300 px-1.5 py-0.5 gap-1">
                    {u.name} {t.meet ? `迎${t.meet}` : ""}{t.meet && t.send ? "・" : ""}{t.send ? `送${t.send}` : ""}
                    <button className="text-stone-400 hover:text-rose-500" title="この変更を取り消す"
                      onClick={() => { onSet(u.id, "meet", ""); onSet(u.id, "send", ""); }}>×</button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="text-[10px] text-stone-400 mt-1">Excelの特記事項に「■利用時間変更」で出ます。</div>
        </div>
      )}
    </div>
  );
}

/* リベルタ調整: 基本ONの日は泊なしに、基本OFFの日は臨時で泊ありに、朝・夕を個別に切替できる */
function LibertaZone({ master, weekday, libertaOff, libertaOn, onToggle }) {
  const [open, setOpen] = useState(false);
  const libUsers = master.users.filter((u) => (u.libertaAM || u.libertaPM) && (u.days || []).includes(weekday));
  if (!libUsers.length) return null;
  const baseOf = (u, ap) => ap === "am"
    ? !!u.libertaAM && !(u.libertaAMOffDays || []).includes(weekday)
    : !!u.libertaPM && !(u.libertaPMOffDays || []).includes(weekday);
  const effOf = (u, ap) => (libertaOn[u.id] || {})[ap] ? true : baseOf(u, ap) && !(libertaOff[u.id] || {})[ap];
  const changed = libUsers.filter((u) => ["am", "pm"].some((ap) => effOf(u, ap) !== baseOf(u, ap))).length;
  return (
    <div className="mb-2 border border-violet-200 bg-violet-50 rounded p-1.5">
      <button className="w-full text-left text-[11px] font-bold text-violet-700" onClick={() => setOpen(!open)}>
        {open ? "▼" : "▶"} リベルタ泊の調整(本日) {changed ? `— 変更${changed}名` : ""}
        <span className="font-normal text-violet-400"> クリックで{open ? "閉じる" : "開く"}</span>
      </button>
      {open && (
        <>
          <div className="text-[10px] text-stone-500 mt-1">紫=リベルタ利用 / グレー=自宅。クリックで本日だけ切替(基本設定と違う状態は赤枠)。朝=迎え、夕=送り。</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {libUsers.map((u) => (
              <span key={u.id} className="inline-flex items-center text-xs rounded border bg-white border-violet-200 overflow-hidden">
                <span className="px-1.5 py-0.5 text-stone-700">{u.name}</span>
                {["am", "pm"].map((ap) => {
                  if (!(ap === "am" ? u.libertaAM : u.libertaPM)) return null;
                  const base = baseOf(u, ap), eff = effOf(u, ap);
                  const diff = eff !== base;
                  return (
                    <button key={ap}
                      className={`px-1.5 py-0.5 border-l ${diff ? "border-rose-400 ring-1 ring-inset ring-rose-400" : "border-violet-200"} ${eff ? "bg-violet-100 text-violet-700" : "bg-stone-200 text-stone-400 line-through"}`}
                      onClick={() => {
                        if (base) onToggle(u.id, ap, eff ? "off" : null);
                        else onToggle(u.id, ap, eff ? null : "on");
                      }}
                      title={`${ap === "am" ? "朝(迎え)" : "夕(送り)"}: ${eff ? "リベルタ利用" : "自宅"}${diff ? "(本日のみ変更中)" : ""} — クリックで切替`}>
                      {ap === "am" ? "朝" : "夕"}
                    </button>
                  );
                })}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function UnassignedPanel({ master, data, weekday, onPick, onToggleAbsent, extraUse, onToggleExtraUse, onRemoveUserFromRun, onSetUserDept, onSetNoRide, onToggleLiberta, onSetUserTime }) {
  const [over, setOver] = useState(false);
  const noRide = data.noRide || {};
  const assigned = { meet: new Set(), send: new Set() };
  data.runs.forEach((r) => {
    if (r.kind !== "meet" && r.kind !== "send") return;
    r.userIds.forEach((id) => { const k9 = rideKindOf(r, id); if (k9 && k9 !== "send") assigned.meet.add(id); if (k9 && k9 !== "meet") assigned.send.add(id); });
  });
  const absent = data.userAbsent || {};
  const row = (kind, label) => (
    <div className="mb-2">
      <div className="text-xs font-bold text-stone-500 mb-1">{label}が未割当(本日利用予定の人 / {onPick ? "クリックでAI調整 / " : ""}表の便へドラッグでも可)</div>
      <div className="flex flex-wrap gap-1" data-unasg={kind}>
        {master.departments.map((d, di) => {
          const c = (DEPT_COLORS[di % DEPT_COLORS.length] || DEPT_COLORS[0]);
          return master.users
            .filter((u) => u.deptId === d.id && (u.days || []).includes(weekday) && !assigned[kind].has(u.id) && !absent[u.id] && !(noRide[u.id] || {})[kind])
            .map((u) => {
              return (
                <button key={u.id}
                  draggable
                  onDragStart={dragStart({ t: "user", userId: u.id, kind })}
                  onDragEnd={dragEnd}
                  className={`text-xs px-2 py-1 rounded border ${c.chip} hover:brightness-95 cursor-grab active:cursor-grabbing`}
                  onClick={() => onPick && onPick(kind, u)}
                  title={`${u.name} ${kind === "meet" ? "迎え" : "送り"}${userTimeOf(u, weekday, data.userTime)[kind] || "未設定"}`}>
                  {u.name}{u.baseDeptId && "◆"}{u.wheelchair && "♿"}
                  <span className="opacity-60 ml-0.5">{userTimeOf(u, weekday, data.userTime)[kind]}</span>
                </button>
              );
            });
        })}
      </div>
    </div>
  );
  const absentList = master.users.filter((u) => absent[u.id]);
  return (
    <div
      className={`bg-white border rounded-lg p-3 ${over ? "border-sky-500 border-2 bg-sky-50" : "border-stone-300"}`}
      onDragOver={(e) => {
        if (DRAG && DRAG.t === "user" && DRAG.fromRunId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); }
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => {
        if (DRAG && DRAG.t === "user" && DRAG.fromRunId) { e.preventDefault(); onRemoveUserFromRun(DRAG); DRAG = null; }
        setOver(false);
      }}>
      <div className="font-bold text-stone-700 text-sm mb-2">未割当・欠席の管理 <span className="font-normal text-xs text-stone-400">(便から利用者をここへドラッグすると便から外れます)</span></div>
      <LibertaZone master={master} weekday={weekday} libertaOff={data.libertaOff || {}} libertaOn={data.libertaOn || {}} onToggle={onToggleLiberta} />
      <UserTimeZone master={master} weekday={weekday} userTime={data.userTime || {}} onSet={onSetUserTime} />
      {row("meet", "迎え")}
      <NoRideZone master={master} weekday={weekday} noRide={noRide} kind="meet" label="迎え" onSetNoRide={onSetNoRide} />
      {row("send", "送り")}
      <NoRideZone master={master} weekday={weekday} noRide={noRide} kind="send" label="送り" onSetNoRide={onSetNoRide} />
      <div>
        <div className="text-xs font-bold text-stone-500 mb-1">本日欠席(クリックで戻す)</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {absentList.length === 0 && <span className="text-xs text-stone-400">欠席なし</span>}
          {absentList.map((u) => (
            <button key={u.id} className="text-xs px-2 py-1 rounded border bg-stone-200 border-stone-300 text-stone-500 line-through" onClick={() => onToggleAbsent(u.id)}>
              {u.name}
            </button>
          ))}
        </div>
        <details>
          <summary className="text-xs text-sky-700 cursor-pointer">欠席にする利用者を選ぶ…</summary>
          <div className="flex flex-wrap gap-1 mt-1">
            {master.users.filter((u) => !absent[u.id]).map((u) => (
              <button key={u.id} className="text-xs px-2 py-1 rounded border bg-white border-stone-300 text-stone-600 hover:bg-rose-50" onClick={() => onToggleAbsent(u.id)}>
                {u.name}
              </button>
            ))}
          </div>
        </details>
        {onToggleExtraUse && (
          <>
            <div className="text-xs font-bold text-stone-500 mb-1 mt-2">今日だけ利用(クリックで戻す)</div>
            <div className="flex flex-wrap gap-1 mb-1">
              {master.users.filter((u) => (extraUse || {})[u.id]).length === 0 && <span className="text-xs text-stone-400">なし</span>}
              {master.users.filter((u) => (extraUse || {})[u.id]).map((u) => (
                <button key={u.id} className="text-xs px-2 py-1 rounded border bg-emerald-100 border-emerald-300 text-emerald-800 font-bold" onClick={() => onToggleExtraUse(u.id)}>
                  {u.name}＋
                </button>
              ))}
            </div>
            <details>
              <summary className="text-xs text-sky-700 cursor-pointer">通常は休みだが今日は利用する人を追加…</summary>
              <div className="text-[11px] text-stone-400 mt-1">追加するとその日だけ利用日として扱われ、未割当リスト・自動割当・AI調整の対象になります(翌日以降には影響しません)。</div>
              <div className="flex flex-wrap gap-1 mt-1 max-h-40 overflow-y-auto">
                {master.users.filter((u) => !(u.days || []).includes(weekday) && !(extraUse || {})[u.id]).map((u) => (
                  <button key={u.id} className="text-xs px-2 py-1 rounded border bg-white border-stone-300 text-stone-600 hover:bg-emerald-50" onClick={() => onToggleExtraUse(u.id)}>
                    {u.name}
                  </button>
                ))}
              </div>
            </details>
          </>
        )}
        {onSetUserDept && (
          <details className="mt-2">
            <summary className="text-xs text-sky-700 cursor-pointer">本日だけ部署が違う利用者を設定…(◆印が付きます)</summary>
            <div className="mt-1 max-h-52 overflow-y-auto border border-stone-200 rounded p-1">
              {master.users.map((u) => (
                <div key={u.id} className="flex items-center gap-1 mb-1">
                  <span className={`text-xs w-20 shrink-0 truncate ${u.baseDeptId ? "font-bold text-amber-700" : "text-stone-700"}`}>
                    {u.name}{u.baseDeptId && "◆"}
                  </span>
                  <select
                    className="flex-1 border border-stone-300 rounded px-1 py-0.5 text-xs bg-white"
                    value={(data.userDept || {})[u.id] || ""}
                    onChange={(e) => onSetUserDept(u.id, e.target.value || null)}>
                    <option value="">通常どおり</option>
                    {master.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   マスタ編集テーブル(検索・部署絞り込み付き)
   ============================================================ */
function DeptSelect({ master, value, onChange }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {master.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );
}

function FilterBar({ master, q, setQ, dept, setDept, placeholder }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      <input className={`${inputCls} w-48`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      <select className={`${inputCls} w-36`} value={dept} onChange={(e) => setDept(e.target.value)}>
        <option value="all">全部署</option>
        {master.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </div>
  );
}

function StaffTab({ master, update }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [dayEdit, setDayEdit] = useState(null);
  const [shiftEdit, setShiftEdit] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const onDropRow = (toId) => {
    if (dragId && dragId !== toId) update((m) => ({ ...m, staff: reorderById(m.staff, dragId, toId) }));
    setDragId(null); setOverId(null);
  };
  const upd = (id, patch) => update((m) => ({ ...m, staff: m.staff.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  // 基本の出勤・退勤を変えたら、基本と同じ時間だった曜日別も一緒に動かす(曜日別のほうが優先されるため)
  const setBaseTime = (st, field, val) => update((m) => ({
    ...m,
    staff: m.staff.map((x) => {
      if (x.id !== st.id) return x;
      const old = x[field];
      const sb = x.shiftByDay ? { ...x.shiftByDay } : null;
      if (sb) Object.keys(sb).forEach((wd) => { if (sb[wd] && sb[wd][field] === old) sb[wd] = { ...sb[wd], [field]: val }; });
      return { ...x, [field]: val, ...(sb ? { shiftByDay: sb } : {}) };
    }),
  }));
  // 基本と違う曜日別(=基本を変えても変わらない曜日)
  const shiftDiffOf = (st) => Object.entries(st.shiftByDay || {})
    .filter(([, v]) => v && !(toMin(v.start) === toMin(st.start) && toMin(v.end) === toMin(st.end)))
    .sort((a, b) => DAY_ORDER.indexOf(Number(a[0])) - DAY_ORDER.indexOf(Number(b[0])));
  const resetShift = async (st) => {
    if (!(await ask(`${st.name}の曜日別の勤務時間をすべて消して、毎日 基本の時間(${st.start}〜${st.end})にしますか?`))) return;
    upd(st.id, { shiftByDay: {} });
  };
  const del = async (id) => {
    if (!(await ask("この職員を削除しますか?\n(担当していた予定は自動的に「保留」列に移り、あとから別の職員に割り当て直せます)"))) return;
    update((m) => markDeleted({ ...m, staff: m.staff.filter((s) => s.id !== id) }, "staff", m.staff.find((s) => s.id === id)));
  };
  const add = () =>
    update((m) => ({
      ...m,
      staff: [...m.staff, { id: uid(), name: "", deptId: m.departments[0].id, position: "", emp: "常勤", start: "8:30", end: "17:30", canDrive: true, memo: "" }],
      _deleted: m._deleted,
    }));
  const list = master.staff.filter((s) => (dept === "all" || s.deptId === dept) && (!q || s.name.includes(q)));
  const canReorder = dept === "all" && !q; // 全件表示のときだけ並べ替え可
  return (
    <div className="bg-white border border-stone-300 rounded-lg p-3 overflow-x-auto">
      <FilterBar master={master} q={q} setQ={setQ} dept={dept} setDept={setDept} placeholder="職員名で検索…" />
      <div className="text-xs text-stone-500 mb-2">左端の <span className="font-bold">⠿</span> をつかんで上下にドラッグすると並び順を変えられます(検索・部署で絞り込んでいない時)。「曜日別部署」の色チップで各曜日の所属が分かります(クリックで編集)。勤務時間が曜日で違う場合は「曜日別」ボタンから設定。「固定休」で選んだ曜日はその日の表に出ません。「男性」で男性カバー集計に使います。自家用車で移動する日は送迎表の予定で種別「自車」を選びます。削除した職員の予定は「保留」列に移ります。</div>
      <DeptColorLegend master={master} />
      <table className="text-sm min-w-[900px]" style={{ width: "auto" }}>
        <thead>
          <tr className="text-xs text-stone-500 text-left bg-stone-200">
            <th className="p-1 w-4"></th><th className="p-1">氏名</th><th className="p-1">基本部署</th><th className="p-1">兼務先</th><th className="p-1">曜日別部署</th><th className="p-1">固定休</th><th className="p-1">形態</th><th className="p-1">職位</th>
            <th className="p-1">勤務時間</th><th className="p-1"></th><th className="p-1"></th><th className="p-1"></th>
          </tr>
        </thead>
        <tbody>
          {list.map((s, ri) => (
            <tr key={s.id}
              onDragOver={canReorder ? (e) => { e.preventDefault(); if (overId !== s.id) setOverId(s.id); } : undefined}
              onDrop={canReorder ? () => onDropRow(s.id) : undefined}
              className={`border-t border-stone-100 ${ri % 2 ? "bg-stone-100" : "bg-white"} hover:bg-amber-100 ${overId === s.id && dragId ? "outline outline-2 outline-sky-400" : ""}`}>
              <td className="p-0 text-center align-middle whitespace-nowrap">
                {canReorder ? (
                  <span
                    draggable
                    onDragStart={() => setDragId(s.id)}
                    onDragEnd={() => { setDragId(null); setOverId(null); }}
                    className="cursor-grab active:cursor-grabbing text-stone-400 hover:text-stone-700 select-none px-1"
                    title="ドラッグで並べ替え">⠿</span>
                ) : null}
                <span className="text-[11px] text-stone-400 tabular-nums pr-0.5">{ri + 1}</span>
              </td>
              <td className="p-1 w-28"><NameInput value={s.name} onCommit={(t) => upd(s.id, { name: t })} checkDup={(t) => master.staff.some((x) => x.id !== s.id && x.name === t)} /></td>
              <td className="p-1 w-28"><DeptSelect master={master} value={s.deptId} onChange={(v) => upd(s.id, { deptId: v })} /></td>
              <td className="p-1 w-24">
                <select className={inputCls} value={s.subDeptId || ""} onChange={(e) => upd(s.id, { subDeptId: e.target.value })} title="リベルタ職員の兼務先。送迎表ではこの部署ごとに右側へまとまります">
                  <option value="">なし</option>
                  {master.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </td>
              <td className="p-1 w-px whitespace-nowrap">
                <DeptDayChips master={master} entity={s} onClick={() => setDayEdit(s)} />
              </td>
              <td className="p-1 w-px whitespace-nowrap">
                <DayPicker days={s.offDays} onChange={(d) => upd(s.id, { offDays: d })} />
              </td>
              <td className="p-1 w-20">
                <select className={inputCls} value={s.emp} onChange={(e) => upd(s.id, { emp: e.target.value })}>
                  <option>常勤</option><option>パート</option>
                </select>
              </td>
              <td className="p-1 w-28"><input className={inputCls} value={s.position} onChange={(e) => upd(s.id, { position: e.target.value })} /></td>
              <td className="p-1 w-px whitespace-nowrap">
                <div className="flex items-center gap-1">
                  <input className="w-16 border border-stone-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400" value={s.start} onChange={(e) => setBaseTime(s, "start", e.target.value)} title="基本の出勤" />
                  <span className="text-stone-400 text-xs">〜</span>
                  <input className="w-16 border border-stone-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400" value={s.end} onChange={(e) => setBaseTime(s, "end", e.target.value)} title="基本の退勤" />
                  <button
                    className={`text-[11px] px-1.5 py-1 rounded border whitespace-nowrap ${Object.keys(s.shiftByDay || {}).length ? "border-sky-400 bg-sky-50 text-sky-700 font-semibold" : "border-stone-300 bg-white text-stone-500"} hover:bg-sky-100`}
                    onClick={() => setShiftEdit(s)} title="曜日別の勤務時間(早番・遅番など)">
                    曜日別{Object.keys(s.shiftByDay || {}).length ? `(${Object.keys(s.shiftByDay).length})` : ""}
                  </button>
                </div>
                {shiftDiffOf(s).length > 0 && (
                  <div className="text-[10px] text-amber-700 mt-0.5 leading-tight">
                    曜日別が優先: {shiftDiffOf(s).map(([wd, v]) => `${DAYS[wd]}${v.start}-${v.end}`).join(" ")}
                    <button className="ml-1 underline text-sky-700" onClick={() => resetShift(s)} title="曜日別を消して毎日基本の時間にする">基本にそろえる</button>
                  </div>
                )}
              </td>
              <td className="p-1 w-px whitespace-nowrap text-center px-2">
                <div className="text-[10px] text-stone-400 leading-none mb-0.5">運転</div>
                <input type="checkbox" checked={s.canDrive} onChange={(e) => upd(s.id, { canDrive: e.target.checked })} />
              </td>
              <td className="p-1 w-px whitespace-nowrap text-center px-2">
                <div className="text-[10px] text-stone-400 leading-none mb-0.5">男性</div>
                <input type="checkbox" checked={!!s.isMale} onChange={(e) => upd(s.id, { isMale: e.target.checked })} />
              </td>
              <td className="p-1 text-center"><button className="text-rose-500 text-xs hover:underline" onClick={() => del(s.id)}>削除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className={`${btnSec} mt-2`} onClick={add}>+ 職員を追加</button>
      {dayEdit && (
        <DayDeptModal
          master={master}
          name={dayEdit.name}
          baseDeptId={dayEdit.deptId}
          value={dayEdit.deptByDay}
          onSave={(map) => { upd(dayEdit.id, { deptByDay: map }); setDayEdit(null); }}
          onClose={() => setDayEdit(null)}
        />
      )}
      {shiftEdit && (
        <DayShiftModal
          name={shiftEdit.name}
          baseStart={shiftEdit.start}
          baseEnd={shiftEdit.end}
          value={shiftEdit.shiftByDay}
          onSave={(map) => { upd(shiftEdit.id, { shiftByDay: map }); setShiftEdit(null); }}
          onClose={() => setShiftEdit(null)}
        />
      )}
    </div>
  );
}

function VehicleTab({ master, update }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const onDropRow = (toId) => {
    if (dragId && dragId !== toId) update((m) => ({ ...m, vehicles: reorderById(m.vehicles, dragId, toId) }));
    setDragId(null); setOverId(null);
  };
  const upd = (id, patch) => update((m) => ({ ...m, vehicles: m.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  const del = async (id) => {
    if (!(await ask("この車両を削除しますか?"))) return;
    update((m) => markDeleted({ ...m, vehicles: m.vehicles.filter((v) => v.id !== id) }, "vehicles", m.vehicles.find((v) => v.id === id)));
  };
  const add = () =>
    update((m) => ({
      ...m,
      vehicles: [...m.vehicles, { id: uid(), name: "", deptId: m.departments[0].id, capNormal: 6, capWc: 3, wheelchairOK: true, memo: "" }],
    }));
  return (
    <div className="bg-white border border-stone-300 rounded-lg p-3 overflow-x-auto">
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
        初期データの定員は仮の値です。実際の「車いすなしで乗れる人数」「車いすありで乗れる人数」に修正してください。左端の <span className="font-bold">⠿</span> をつかんで上下にドラッグすると並び順を変えられます。
      </div>
      <table className="text-sm w-full min-w-[700px]">
        <thead>
          <tr className="text-xs text-stone-500 text-left">
            <th className="p-1 w-4"></th><th className="p-1">車両名</th><th className="p-1">配置部署</th>
            <th className="p-1">定員(車いすなし)</th><th className="p-1 text-center">車いす対応</th>
            <th className="p-1">定員(車いすあり)</th><th className="p-1">メモ</th><th className="p-1"></th>
          </tr>
        </thead>
        <tbody>
          {master.vehicles.map((v) => (
            <tr key={v.id}
              onDragOver={(e) => { e.preventDefault(); if (overId !== v.id) setOverId(v.id); }}
              onDrop={() => onDropRow(v.id)}
              className={`border-t border-stone-100 ${overId === v.id && dragId ? "outline outline-2 outline-sky-400" : ""}`}>
              <td className="p-0 text-center align-middle">
                <span draggable
                  onDragStart={() => setDragId(v.id)}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  className="cursor-grab active:cursor-grabbing text-stone-400 hover:text-stone-700 select-none px-1"
                  title="ドラッグで並べ替え">⠿</span>
              </td>
              <td className="p-1 w-32"><input className={inputCls} value={v.name} onChange={(e) => upd(v.id, { name: e.target.value })} /></td>
              <td className="p-1 w-32"><DeptSelect master={master} value={v.deptId} onChange={(x) => upd(v.id, { deptId: x })} /></td>
              <td className="p-1 w-24"><input type="number" min="0" className={inputCls} value={v.capNormal} onChange={(e) => upd(v.id, { capNormal: Number(e.target.value) || 0 })} /></td>
              <td className="p-1 text-center"><input type="checkbox" checked={v.wheelchairOK} onChange={(e) => upd(v.id, { wheelchairOK: e.target.checked })} /></td>
              <td className="p-1 w-24"><input type="number" min="0" className={inputCls} value={v.capWc} disabled={!v.wheelchairOK} onChange={(e) => upd(v.id, { capWc: Number(e.target.value) || 0 })} /></td>
              <td className="p-1"><input className={inputCls} value={v.memo} onChange={(e) => upd(v.id, { memo: e.target.value })} /></td>
              <td className="p-1"><button className="text-rose-500 text-xs hover:underline" onClick={() => del(v.id)}>削除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className={`${btnSec} mt-2`} onClick={add}>+ 車両を追加</button>
    </div>
  );
}

// 曜日ごとの所属部署を色チップで表示(クリックで編集画面へ)
function DeptDayChips({ master, entity, onClick }) {
  return (
    <button className="flex gap-0.5" onClick={onClick} title="クリックで曜日別部署を編集">
      {DAY_ORDER.map((i) => {
        const did = (entity.deptByDay || {})[i] || entity.deptId;
        const ci = master.departments.findIndex((d) => d.id === did);
        const c = DEPT_COLORS[Math.max(0, ci) % DEPT_COLORS.length];
        const overridden = !!(entity.deptByDay || {})[i];
        const dname = (master.departments[ci] || {}).name || "";
        return (
          <span key={i}
            title={`${DAYS[i]}曜:${dname}${overridden ? "(曜日別設定)" : ""}`}
            className={`text-[10px] w-5 h-5 rounded border flex items-center justify-center font-bold ${c.chip} ${overridden ? "ring-2 ring-stone-500" : ""}`}>
            {DAYS[i]}
          </span>
        );
      })}
    </button>
  );
}

function DeptColorLegend({ master }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500 mb-2">
      <span>部署の色:</span>
      {master.departments.map((d, i) => (
        <span key={d.id} className={`px-1.5 py-0.5 rounded border ${DEPT_COLORS[i % DEPT_COLORS.length].chip}`}>{d.name}</span>
      ))}
      <span className="ml-1">/ 濃い枠=曜日別設定あり</span>
    </div>
  );
}

function DayPicker({ days, onChange }) {
  const cur = days || [];
  return (
    <div className="flex gap-0.5">
      {DAY_ORDER.map((i) => {
        const on = cur.includes(i);
        return (
          <button key={i}
            className={`text-[10px] w-5 h-5 rounded border font-bold ${
              on ? (i === 0 ? "bg-rose-500 border-rose-500 text-white" : i === 6 ? "bg-sky-500 border-sky-500 text-white" : "bg-stone-700 border-stone-700 text-white")
                : "bg-white border-stone-300 text-stone-400 hover:bg-stone-50"
            }`}
            onClick={() => onChange(on ? cur.filter((x) => x !== i) : [...cur, i])}>
            {DAYS[i]}
          </button>
        );
      })}
    </div>
  );
}

function UserTab({ master, update }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [dayEdit, setDayEdit] = useState(null);
  const [timeEdit, setTimeEdit] = useState(null); // 曜日別の利用時間を展開中の利用者ID
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const onDropRow = (toId) => {
    if (dragId && dragId !== toId) update((m) => ({ ...m, users: reorderById(m.users, dragId, toId) }));
    setDragId(null); setOverId(null);
  };
  const upd = (id, patch) => update((m) => ({ ...m, users: m.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  const del = async (id) => {
    if (!(await ask("この利用者を削除しますか?"))) return;
    update((m) => markDeleted({ ...m, users: m.users.filter((u) => u.id !== id) }, "users", m.users.find((u) => u.id === id)));
  };
  const add = () =>
    update((m) => ({
      ...m,
      users: [...m.users, { id: uid(), name: "", deptId: m.departments[0].id, meetTime: "", sendTime: "", wheelchair: false, hasHelp: true, helpNote: "", days: [] }],
    }));
  const list = master.users.filter((u) => (dept === "all" || u.deptId === dept) && (!q || u.name.includes(q)));
  const canReorder = dept === "all" && !q;
  const exportXlsx = async () => {
    try {
      const ExcelJS = await loadExcelJS();
      const wb = buildUserListWorkbook(ExcelJS, master);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `利用者一覧_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (err) {
      console.error(err);
      alert("Excel出力に失敗しました: " + err.message);
    }
  };
  return (
    <div className="bg-white border border-stone-300 rounded-lg p-3 overflow-x-auto">
      <div className="flex items-start gap-2">
        <div className="flex-1"><FilterBar master={master} q={q} setQ={setQ} dept={dept} setDept={setDept} placeholder="利用者名で検索…" /></div>
        <button className="shrink-0 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700"
          onClick={exportXlsx} title="部署ごとにシートを分けた利用者一覧(.xlsx)をダウンロード">
          📥 利用者一覧をExcel出力
        </button>
      </div>
      <div className="text-xs text-stone-500 mb-2">
        左端の <span className="font-bold">⠿</span> をつかんで上下にドラッグすると並び順を変えられます(絞り込んでいない時)。<span className="font-semibold">利用曜日</span>を設定すると、その曜日の送迎表で迎え・送りの入力漏れを自動チェックします。「曜日別部署」の色チップで各曜日の所属が一目で分かります(クリックで編集)。<span className="font-semibold">いつもの迎え先・送り先</span>は空欄なら自宅(リベルタ利用の人はﾘﾍﾞ)です。入力欄をクリックすると候補が出ます。「家族送り」「家族迎え」にした人は送迎なしが基本になり、便に入れたときは出力前に確認が出ます。その日だけ行き先が違うときは、送迎表で便をひらいてチェックすると名前のうしろに(行き先)が付き、Excel出力の前に最終確認が出ます。
      </div>
      <DeptColorLegend master={master} />
      <table className="text-sm w-full min-w-[1020px]">
        <thead>
          <tr className="text-xs text-stone-500 text-left">
            <th className="p-1 w-4"></th><th className="p-1">氏名</th><th className="p-1">基本部署</th><th className="p-1">曜日別部署</th><th className="p-1">利用曜日</th><th className="p-1">迎え時刻</th>
            <th className="p-1">送り時刻</th><th className="p-1">いつもの迎え先</th><th className="p-1">いつもの送り先</th><th className="p-1 text-center">車いす</th><th className="p-1 text-center">ヘルプ有</th><th className="p-1">ヘルプ・特記</th><th className="p-1"></th>
          </tr>
        </thead>
        <tbody>
          {list.map((u, ri) => (
            <React.Fragment key={u.id}>
            <tr
              onDragOver={canReorder ? (e) => { e.preventDefault(); if (overId !== u.id) setOverId(u.id); } : undefined}
              onDrop={canReorder ? () => onDropRow(u.id) : undefined}
              className={`border-t border-stone-100 ${overId === u.id && dragId ? "outline outline-2 outline-sky-400" : ""}`}>
              <td className="p-0 text-center align-middle whitespace-nowrap">
                <span className="text-[11px] text-stone-400 tabular-nums pl-0.5">{ri + 1}</span>
                {canReorder ? (
                  <span draggable
                    onDragStart={() => setDragId(u.id)}
                    onDragEnd={() => { setDragId(null); setOverId(null); }}
                    className="cursor-grab active:cursor-grabbing text-stone-400 hover:text-stone-700 select-none px-1"
                    title="ドラッグで並べ替え">⠿</span>
                ) : null}
              </td>
              <td className="p-1 w-28"><NameInput value={u.name} onCommit={(t) => upd(u.id, { name: t })} checkDup={(t) => master.users.some((x) => x.id !== u.id && x.name === t)} /></td>
              <td className="p-1 w-32"><DeptSelect master={master} value={u.deptId} onChange={(x) => upd(u.id, { deptId: x })} /></td>
              <td className="p-1">
                <DeptDayChips master={master} entity={u} onClick={() => setDayEdit(u)} />
              </td>
              <td className="p-1"><DayPicker days={u.days} onChange={(d) => upd(u.id, { days: d })} /></td>
              <td className="p-1 w-24">
                <input className={inputCls} value={u.meetTime} placeholder="8:30" onChange={(e) => upd(u.id, { meetTime: e.target.value })} />
              </td>
              <td className="p-1 w-24">
                <input className={inputCls} value={u.sendTime} placeholder="16:00" onChange={(e) => upd(u.id, { sendTime: e.target.value })} />
                <button className={`text-[10px] hover:underline ${Object.keys(u.timeByDay || {}).length ? "text-amber-600 font-bold" : "text-sky-600"}`}
                  onClick={() => setTimeEdit(timeEdit === u.id ? null : u.id)}>
                  {Object.keys(u.timeByDay || {}).length ? `曜日別あり(${Object.keys(u.timeByDay || {}).length})` : "曜日別に設定"}
                </button>
              </td>
              <td className="p-1 w-24">
                <input className={inputCls} list="place-opts-meet" value={u.meetPlace || ""} placeholder={defPlaceOf(u, "meet")} title="いつもの迎え先。空欄なら自宅(リベルタ利用の人はﾘﾍﾞ)。「家族送り」にすると、朝は送迎なしが基本になります" onChange={(e) => upd(u.id, { meetPlace: e.target.value })} />
              </td>
              <td className="p-1 w-24">
                <input className={inputCls} list="place-opts-send" value={u.sendPlace || ""} placeholder={defPlaceOf(u, "send")} title="いつもの送り先。空欄なら自宅(リベルタ利用の人はﾘﾍﾞ)。「家族迎え」にすると、夕方は送迎なしが基本になります" onChange={(e) => upd(u.id, { sendPlace: e.target.value })} />
              </td>
              <td className="p-1 text-center"><input type="checkbox" checked={u.wheelchair} onChange={(e) => upd(u.id, { wheelchair: e.target.checked })} /></td>
              <td className="p-1 text-center"><input type="checkbox" checked={u.hasHelp !== false} onChange={(e) => upd(u.id, { hasHelp: e.target.checked })} title="ヘルプの対象になる利用者" /></td>
              <td className="p-1"><input className={inputCls} value={u.helpNote} placeholder="例:朝移動支援 / 家事15:00〜" onChange={(e) => upd(u.id, { helpNote: e.target.value })} /></td>
              <td className="p-1"><button className="text-rose-500 text-xs hover:underline" onClick={() => del(u.id)}>削除</button></td>
            </tr>
            {timeEdit === u.id && (
              <tr>
                <td></td>
                <td colSpan={12} className="p-2 bg-amber-50 border-y border-amber-200">
                  <div className="text-[11px] font-bold text-amber-700 mb-1">{u.name}の曜日別の利用時間(空欄=基本の時間を使う)</div>
                  <div className="flex flex-wrap gap-2">
                    {(u.days || []).map((wd) => {
                      const t = (u.timeByDay || {})[wd] || {};
                      const setT = (field, val) => {
                        const tbd = { ...(u.timeByDay || {}) };
                        const cur = { ...(tbd[wd] || {}) };
                        if (val) cur[field] = val; else delete cur[field];
                        if (Object.keys(cur).length) tbd[wd] = cur; else delete tbd[wd];
                        upd(u.id, { timeByDay: tbd });
                      };
                      return (
                        <div key={wd} className={`border rounded p-1.5 bg-white ${(u.timeByDay || {})[wd] ? "border-amber-400" : "border-stone-200"}`}>
                          <div className="text-xs font-bold text-stone-600 text-center">{DAYS[wd]}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[10px] text-stone-400">迎</span>
                            <input className="w-14 border border-stone-300 rounded px-1 py-0.5 text-xs" value={t.meet || ""} placeholder={u.meetTime || "-"} onChange={(e) => setT("meet", e.target.value)} />
                            <span className="text-[10px] text-stone-400">送</span>
                            <input className="w-14 border border-stone-300 rounded px-1 py-0.5 text-xs" value={t.send || ""} placeholder={u.sendTime || "-"} onChange={(e) => setT("send", e.target.value)} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </td>
              </tr>
            )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <datalist id="place-opts-meet">{placeOptionsOf(master, "meet").map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="place-opts-send">{placeOptionsOf(master, "send").map((p) => <option key={p} value={p} />)}</datalist>
      <button className={`${btnSec} mt-2`} onClick={add}>+ 利用者を追加</button>
      {dayEdit && (
        <DayDeptModal
          master={master}
          name={dayEdit.name}
          baseDeptId={dayEdit.deptId}
          value={dayEdit.deptByDay}
          onSave={(map) => { upd(dayEdit.id, { deptByDay: map }); setDayEdit(null); }}
          onClose={() => setDayEdit(null)}
        />
      )}
    </div>
  );
}



/* ============================================================
   ヘルプ表タブ(週間パターンのヘルプと連動)
   ============================================================ */
function HelpBoardTab({ master, update, patterns: patterns0, loading, onDeletePattern, onAddPattern }) {
  // 井上入浴→井上ヘルプ など、同じヘルプは同じ名前で並べる
  const patterns = useMemo(() => Object.fromEntries(Object.entries(patterns0 || {}).map(([k, p]) => [k, p ? { ...p, blocks: canonHelpBlocks(p.blocks) } : p])), [patterns0]);
  const rules = rulesOf(master);
  const rows = collectHelpRows(master, patterns || {});
  const WDS = [1, 2, 3, 4, 5, 6, 0];
  const useWds = WDS.filter((wd) => (patterns || {})[wd] || Object.values(rows).some((r) => r.pattern[wd]));
  const wds = [...new Set([1, 2, 3, 4, 5, ...useWds])].sort((a, b) => WDS.indexOf(a) - WDS.indexOf(b));
  const keys = Object.keys(rows).sort((a, b) => {
    const ra = rows[a], rb = rows[b];
    return (toMin(ra.time) || 0) - (toMin(rb.time) || 0) || ra.label.localeCompare(rb.label, "ja");
  });
  // 基本担当だけがあってパターンに無い行も表示する
  (rules.helpBase || []).forEach((r) => { const k = helpKey(r.label, r.time); if (!rows[k]) { rows[k] = { label: r.label, time: r.time, pattern: {}, count: 0 }; keys.push(k); } });
  keys.sort((a, b) => (toMin(rows[a].time) || 0) - (toMin(rows[b].time) || 0) || rows[a].label.localeCompare(rows[b].label, "ja"));
  // 新しいヘルプの追加(週間パターンに無いヘルプもヘルプ表で作れる)
  const [addOpen, setAddOpen] = useState(false);
  const [addTime, setAddTime] = useState("");
  const [addUser, setAddUser] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const addLabelAuto = addLabel.trim() || (addUser ? addUser + "ヘルプ" : "");
  const addHelpRow = () => {
    const label = addLabelAuto, time = addTime.trim();
    if (!label) { notify("利用者かヘルプ名を入れてください", "warn"); return; }
    if (toMin(time) == null) { notify("時刻を「16:00」の形で入れてください", "warn"); return; }
    if (rows[helpKey(label, time)]) { notify(`「${time} ${label}」はすでにヘルプ表にあります`, "warn"); return; }
    update((m) => {
      const R = rulesOf(m);
      return { ...m, rules: { ...R, helpBase: [...(R.helpBase || []), { label, time, byDay: {}, manual: true }] } };
    });
    notify(`「${time} ${label}」を追加しました。曜日ごとの担当を選んでください`);
    setAddTime(""); setAddUser(""); setAddLabel(""); setAddOpen(false);
  };
  // 基本の担当があるのに週間パターンに入っていない曜日
  const missingInPattern = (r) => {
    const b = helpBaseFor(rules, r.label, r.time);
    return Object.entries((b && b.byDay) || {}).filter(([wd, nm]) => nm && !r.pattern[wd]).map(([wd]) => Number(wd));
  };
  const pushToPattern = async (r) => {
    const days = missingInPattern(r);
    if (!days.length || !onAddPattern) return;
    const b = helpBaseFor(rules, r.label, r.time);
    if (!(await ask(`「${r.time} ${r.label}」を週間パターン(${days.map((wd) => DAYS[wd]).join("・")})に入れます。\n担当はヘルプ表で選んだ人になります。よろしいですか?`))) return;
    const n = await onAddPattern(r.label, r.time, days.reduce((o, wd) => ({ ...o, [wd]: b.byDay[wd] }), {}));
    notify(`週間パターンに${n}件入れました`);
  };


  // slot=0/1 で1人ずつ変更する(2名体制のヘルプ用)。保存は従来どおり「A・B」の形
  const setBase = (label, time, wd, slot, name, slots) => update((m) => {
    const R = rulesOf(m);
    const list = [...(R.helpBase || [])];
    let i = list.findIndex((r) => r.label === label && String(r.time || "") === String(time || ""));
    if (i < 0) { list.push({ label, time, byDay: {} }); i = list.length - 1; }
    const byDay = { ...(list[i].byDay || {}) };
    const cur = String(byDay[wd] || "").split("・").map((x) => x.trim());
    const next = [];
    for (let k = 0; k < slots; k++) next.push(k === slot ? name : (cur[k] || ""));
    const joined = next.filter(Boolean).join("・");
    if (joined) byDay[wd] = joined; else delete byDay[wd];
    list[i] = { ...list[i], byDay };
    return { ...m, rules: { ...R, helpBase: list.filter((r) => r.manual || Object.keys(r.byDay || {}).length) } };
  });

  // 行の削除: まず基本の担当を消し、週間パターンにも入っていれば続けて消すか聞く
  const delRow = async (r) => {
    const inPattern = Object.keys(r.pattern || {}).length > 0;
    const base = helpBaseFor(rules, r.label, r.time);
    const hasBase = !!(base && (base.manual || Object.keys(base.byDay || {}).length));
    if (!hasBase && !inPattern) return;
    const head = `「${r.time} ${r.label}」`;
    if (hasBase) {
      if (!(await ask(`${head}の「基本の担当」を削除します。よろしいですか?` + (inPattern ? "\n(このあと、週間パターンからも消すか確認します)" : "")))) return;
      update((m) => ({
        ...m,
        rules: { ...rulesOf(m), helpBase: (rulesOf(m).helpBase || []).filter((x) => !(x.label === r.label && String(x.time || "") === String(r.time || ""))) },
      }));
    }
    if (inPattern && onDeletePattern) {
      const days = Object.keys(r.pattern).map((wd) => DAYS[wd]).join("・");
      if (await ask(`週間パターン(${days})からも${head}のヘルプを削除しますか?\n\nOK = 週間パターンからも削除する\nキャンセル = 週間パターンはそのまま残す`)) {
        const n = await onDeletePattern(r.label, r.time);
        notify(`${head}を削除しました(週間パターンから${n}件)`);
        return;
      }
    }
    notify(hasBase ? "基本の担当を削除しました(週間パターンはそのまま)" : "削除する基本の担当はありません");
  };

  const fillFromPattern = async () => {
    const n = keys.reduce((a, k) => a + Object.keys(rows[k].pattern).length, 0);
    if (!n) { notify("週間パターンにヘルプがありません", "warn"); return; }
    if (!(await ask(`いま週間パターンに入っているヘルプの担当(${n}件)を、そのまま「基本の担当」として登録します。\nすでに登録済みの基本担当は上書きされます。よろしいですか?`))) return;
    update((m) => {
      const R = rulesOf(m);
      const list = [];
      keys.forEach((k) => {
        const r = rows[k];
        const byDay = {};
        Object.entries(r.pattern).forEach(([wd, nm]) => { if (nm && nm !== "保留") byDay[wd] = nm; });
        if (Object.keys(byDay).length) list.push({ label: r.label, time: r.time, byDay });
      });
      // 週間パターンに無い行(ヘルプ表で追加したもの)は消さずに残す
      (R.helpBase || []).forEach((x) => {
        const k = helpKey(x.label, x.time);
        if (rows[k] && Object.keys(rows[k].pattern || {}).length) return;
        if (!list.some((y) => helpKey(y.label, y.time) === k)) list.push(x);
      });
      return { ...m, rules: { ...R, helpBase: list } };
    });
    notify("週間パターンの担当を基本として登録しました");
  };
  const clearAll = async () => {
    if (!(await ask("登録した「基本の担当」をすべて消しますか?"))) return;
    update((m) => ({ ...m, rules: { ...rulesOf(m), helpBase: [] } }));
    notify("基本の担当を消しました");
  };

  const staffNames = [...master.staff].map((s) => s.name);
  // 2名体制のヘルプか(週間パターンに2件あるか、ルール⑥の2名体制に載っていて15時以降)
  const isTwoRow = (r) => {
    if (Object.values(r.pattern || {}).some((v) => String(v).includes("・"))) return true;
    const t = toMin(r.time);
    return (rules.helpTwo || []).some((x) => x && x.user && String(r.label || "").startsWith(x.user)) && t != null && t >= 15 * 60;
  };
  const cellSelect = (r, wd) => {
    const base = helpBaseFor(rules, r.label, r.time);
    const want = base && (base.byDay || {})[wd] ? String(base.byDay[wd]) : "";
    const now = r.pattern[wd] || "";
    const slots = isTwoRow(r) ? 2 : 1;
    const wantArr = want.split("・").map((x) => x.trim()).filter(Boolean);
    const nowArr = now.split("・").map((x) => x.trim()).filter(Boolean);
    // 並び順の違いは「ちがう」としない(安部・井川 と 井川・安部 は同じ)
    const diff = wantArr.length && nowArr.length && JSON.stringify([...wantArr].sort()) !== JSON.stringify([...nowArr].sort());
    // ルールとの食い違い(赤=出力時にも確認が出る / 黄=お知らせ)
    const iss = helpBaseCellIssues(master, r.label, r.time, wd, wantArr, rules.helpBase || []);
    const bad = iss.errors.length > 0;
    const isFemale = (n) => { const s = master.staff.find((x) => x.name === n); return s && !s.isMale; };
    const maleOnlyRow = (rules.maleOnly || []).some((row) => row && row.user && String(r.label || "").startsWith(row.user)
      && (!row.bathOnly || /入浴/.test(r.label || "")) && (!row.from || (toMin(r.time) != null && toMin(r.time) >= toMin(row.from))));
    const one = (slot) => (
      <select key={slot}
        className={`w-full border rounded px-1 py-1 text-xs bg-white ${bad && wantArr[slot] ? "border-rose-500 text-rose-700 font-semibold" : wantArr[slot] ? "border-sky-400 font-semibold" : "border-stone-300 text-stone-400"} ${slot ? "mt-0.5" : ""}`}
        value={wantArr[slot] || ""} onChange={(e) => setBase(r.label, r.time, wd, slot, e.target.value, slots)}>
        <option value="">{slots > 1 ? (slot === 0 ? "— 1人目" : "— 2人目") : "—"}</option>
        {staffNames.map((n) => <option key={n} value={n}>{n}{maleOnlyRow && isFemale(n) ? "(女性・不可)" : ""}</option>)}
      </select>
    );
    return (
      <td key={wd} className={`px-1 py-1 align-top border-l border-stone-200 ${bad ? "bg-rose-50" : diff ? "bg-amber-50" : ""}`}>
        {Array.from({ length: slots }, (_, k) => one(k))}
        <div className={`text-[10px] mt-0.5 truncate ${diff ? "text-amber-700 font-bold" : "text-stone-400"}`}
          title={now ? `週間パターンの担当: ${now}` : "週間パターンにこの曜日のヘルプはありません"}>
          {now ? (diff ? `現在: ${now}` : now) : "—"}
        </div>
        {iss.errors.map((m, i) => <div key={"e" + i} className="text-[10px] leading-tight mt-0.5 text-rose-700 font-bold">⚠ {m}</div>)}
        {iss.infos.map((m, i) => <div key={"i" + i} className="text-[10px] leading-tight mt-0.5 text-amber-700">ℹ {m}</div>)}
      </td>
    );
  };

  // ルールと食い違うマスの数(赤のみ)
  const ruleBadCount = keys.reduce((a, k) => {
    const r = rows[k];
    return a + wds.filter((wd) => {
      const b = helpBaseFor(rules, r.label, r.time); const w = b && (b.byDay || {})[wd];
      if (!w) return false;
      const ns = String(w).split("・").map((x) => x.trim()).filter(Boolean);
      return helpBaseCellIssues(master, r.label, r.time, wd, ns, rules.helpBase || []).errors.length > 0;
    }).length;
  }, 0);

  const diffCount = keys.reduce((a, k) => {
    const r = rows[k];
    return a + wds.filter((wd) => {
      const b = helpBaseFor(rules, r.label, r.time); const w = b && (b.byDay || {})[wd];
      if (!w || !r.pattern[wd]) return false;
      const sa = String(w).split("・").map((x) => x.trim()).filter(Boolean).sort();
      const sb = String(r.pattern[wd]).split("・").map((x) => x.trim()).filter(Boolean).sort();
      return JSON.stringify(sa) !== JSON.stringify(sb);
    }).length;
  }, 0);

  return (
    <div className="bg-white border border-stone-300 rounded-lg p-3 overflow-x-auto">
      <div className="text-xs text-stone-500 mb-2">
        週間パターンに入っているヘルプの一覧です。<b>この曜日はこの人</b>という基本の担当を選んでおくと、
        日々の送迎表でそれ以外の人になっているときに<b>Excel出力前の最終確認</b>に出ます。
        下の小さい文字は、いまの週間パターンの担当です(ちがう場合は黄色)。夕方の黒田・井上のような2名体制のヘルプは、1人目・2人目を別々に選べます。「＋ ヘルプを追加」で新しいヘルプの行を作れます(担当を選んだあと「週間パターンに入れる」で毎週の表にも入ります)。右端の「削除」で、基本の担当や、週間パターンのヘルプそのものを消せます。<br />ルールとの関係: 男性のみ・2名体制に反するマスは赤くなります。ルールの「予定・ヘルプの固定担当」と重なる場合は、<b>ヘルプ表のほうを優先</b>します(ルールはヘルプ表に無い時刻のヘルプにだけ効きます)。
      </div>
      <div className="mb-2">
        {!addOpen ? (
          <button className="px-3 py-1.5 rounded-md bg-sky-600 text-white text-sm font-bold hover:bg-sky-700" onClick={() => setAddOpen(true)}>＋ ヘルプを追加</button>
        ) : (
          <div className="flex items-end gap-2 flex-wrap bg-sky-50 border border-sky-300 rounded p-2">
            <label className="text-[11px] text-stone-600">時刻<br />
              <input className="w-20 border border-stone-300 rounded px-1 py-1 text-sm" value={addTime} placeholder="16:00" onChange={(e) => setAddTime(e.target.value)} />
            </label>
            <label className="text-[11px] text-stone-600">利用者<br />
              <select className="border border-stone-300 rounded px-1 py-1 text-sm bg-white" value={addUser} onChange={(e) => setAddUser(e.target.value)}>
                <option value="">—</option>
                {master.users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-stone-600">ヘルプ名(空欄なら「利用者名+ヘルプ」)<br />
              <input className="w-44 border border-stone-300 rounded px-1 py-1 text-sm" value={addLabel} placeholder={addUser ? addUser + "ヘルプ" : "例:増野入浴"} onChange={(e) => setAddLabel(e.target.value)} />
            </label>
            <button className="px-3 py-1 rounded bg-sky-600 text-white text-sm font-bold hover:bg-sky-700" onClick={addHelpRow}>追加</button>
            <button className="px-2 py-1 rounded border border-stone-300 text-sm bg-white" onClick={() => setAddOpen(false)}>やめる</button>
            {addLabelAuto && <span className="text-[11px] text-stone-500">→「{addTime || "時刻"} {addLabelAuto}」の行ができます</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <button className={`${btnSec} text-xs py-1`} onClick={fillFromPattern}>週間パターンの担当を基本として一括登録</button>
        <button className={`${btnSec} text-xs py-1`} onClick={clearAll}>基本の担当をすべて消す</button>
        <span className="text-[11px] text-stone-500">
          ヘルプ{keys.length}種類 / 基本を登録済み {(rules.helpBase || []).length}件
          {diffCount ? <b className="text-amber-700 ml-1">／ 週間パターンと違う: {diffCount}件</b> : ""}
          {ruleBadCount ? <b className="text-rose-700 ml-1">／ ルールと食い違う: {ruleBadCount}件(赤いマス)</b> : ""}
        </span>
      </div>
      {loading ? <div className="text-sm text-stone-500 p-4">読み込み中…</div> : (
        <table className="text-sm min-w-[760px]">
          <thead>
            <tr className="text-xs text-stone-600 bg-stone-100">
              <th className="px-2 py-1 text-left w-20">時刻</th>
              <th className="px-2 py-1 text-left w-44">ヘルプ</th>
              {wds.map((wd) => <th key={wd} className="px-1 py-1 w-28 border-l border-stone-200">{DAYS[wd]}</th>)}
              <th className="px-1 py-1 w-14 border-l border-stone-200">削除</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const r = rows[k];
              return (
                <tr key={k} className="border-t border-stone-200 align-top">
                  <td className="px-2 py-1 whitespace-nowrap font-mono text-xs">{r.time}</td>
                  <td className="px-2 py-1 font-bold text-[13px]">
                    {r.label}
                    {(() => {
                      const miss = missingInPattern(r);
                      if (!miss.length) return Object.keys(r.pattern || {}).length ? null : <div className="text-[10px] font-normal text-stone-400">週間パターンには未登録</div>;
                      return (
                        <div>
                          <button className="mt-0.5 text-[10px] font-normal px-1.5 py-0.5 rounded border border-sky-400 text-sky-700 hover:bg-sky-50"
                            title="ヘルプ表で選んだ担当のまま、週間パターンにこのヘルプを入れます" onClick={() => pushToPattern(r)}>
                            週間パターンに入れる({miss.map((wd) => DAYS[wd]).join("")})
                          </button>
                        </div>
                      );
                    })()}
                  </td>
                  {wds.map((wd) => cellSelect(r, wd))}
                  <td className="px-1 py-1 border-l border-stone-200 text-center">
                    <button className="text-[11px] px-1.5 py-0.5 rounded border border-rose-300 text-rose-600 hover:bg-rose-50"
                      title="このヘルプの基本の担当を削除します(週間パターンから消すかは続けて選べます)" onClick={() => delRow(r)}>削除</button>
                  </td>
                </tr>
              );
            })}
            {!keys.length && <tr><td colSpan={3 + wds.length} className="px-2 py-4 text-sm text-stone-400">ヘルプがありません。上の「＋ ヘルプを追加」で作るか、週間パターンにヘルプを入れてください。</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ============================================================
   ルール(制限)タブ: これまでコードに書いていた制限を画面から編集する
   ============================================================ */
function RuleRows({ title, note, rows, cols, onChange, onAdd, blank }) {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div className="mb-4 border border-stone-300 rounded-lg bg-white">
      <div className="px-2 py-1.5 bg-stone-100 border-b border-stone-300 rounded-t-lg">
        <span className="font-bold text-sm">{title}</span>
        {note && <span className="ml-2 text-[11px] text-stone-500">{note}</span>}
        <button className="float-right text-[11px] px-2 py-0.5 rounded bg-sky-600 text-white font-bold hover:bg-sky-700" onClick={() => onAdd(blank)}>＋ 追加</button>
      </div>
      <div className="p-2 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-xs text-stone-500 text-left">
              {cols.map((c) => <th key={c.key} className="px-1 pb-1 font-normal whitespace-nowrap">{c.label}</th>)}
              <th className="px-1 pb-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-stone-200">
                {cols.map((c) => <td key={c.key} className="px-1 py-1 align-middle">{c.cell(r, (patch) => set(i, patch))}</td>)}
                <td className="px-1 py-1">
                  <button className="text-[11px] px-1.5 py-0.5 rounded border border-rose-300 text-rose-600 hover:bg-rose-50" onClick={() => del(i)}>削除</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={cols.length + 1} className="px-1 py-2 text-xs text-stone-400">(登録なし)</td></tr>}
          </tbody>
        </table>
        <button className={`${btnSec} mt-2 text-xs py-1`} onClick={() => onAdd(blank)}>＋ このルールを追加</button>
      </div>
    </div>
  );
}

// ルールの変更を「何日から」効かせるか。日付を入れると、その前の日までの送迎表は前のルールのまま
const mdStr = (ds) => { const [, m, d] = String(ds).split("-").map(Number); return `${m}/${d}`; };
function RuleFromBar({ master, from, setFrom, rawUpdate }) {
  const list = (master.rulesUntil || []).filter((v) => v && v.until);
  return (
    <div className="mb-3 p-2 rounded-lg border border-amber-300 bg-amber-50" data-rulefrom>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold text-stone-700">このあとのルール変更を使い始める日</span>
        <DatePop date={from} setDate={setFrom} empty="日付を選ぶ（空欄＝すべての日）" />
        {from && <button type="button" className="text-xs px-2 py-1 rounded border border-stone-300 bg-white hover:bg-stone-50" onClick={() => setFrom("")}>日付の指定をやめる</button>}
      </div>
      <div className="text-xs text-stone-600 mt-1">
        {from
          ? <>これから行う変更は <b>{mdStr(from)}からの送迎表</b> にだけ効きます。<b>{mdStr(dayBeforeStr(from))}までの送迎表</b> は、これまでのルールのままです。</>
          : "日付を入れないと、変更はすべての日の送迎表に効きます（これまでどおり）。ルールが変わる日が決まっているときは、先に日付を入れてから変更してください。"}
      </div>
      {list.length > 0 && (
        <div className="text-xs text-stone-700 mt-1.5 border-t border-amber-200 pt-1.5">
          <div className="font-bold">日付で切り替わるルール（下に出ているのは、いちばん新しいルールです）</div>
          {list.map((v, i) => (
            <div key={v.until} className="flex items-center gap-2 mt-0.5" data-rulecut={v.until}>
              <span>{i === 0 ? "" : mdStr(list[i - 1].until) + "の翌日"}〜{mdStr(v.until)}：その時のルール</span>
              <button type="button" className="text-[11px] px-1.5 py-0.5 rounded border border-stone-300 bg-white hover:bg-rose-50"
                onClick={async () => { if (await ask(`${mdStr(v.until)}までの区切りを消しますか?\n消すと、その日までの送迎表にも新しいほうのルールが効きます。`)) rawUpdate((m) => ({ ...m, rulesUntil: (m.rulesUntil || []).filter((x) => x.until !== v.until) })); }}>区切りを消す</button>
            </div>
          ))}
          <div className="mt-0.5">{mdStr(list[list.length - 1].until)}の翌日から：いま下に出ているルール</div>
        </div>
      )}
    </div>
  );
}
function RulesTab({ master, update }) {
  const r = rulesOf(master);
  const setKey = (key, rows) => update((m) => ({ ...m, rules: { ...rulesOf(m), [key]: rows } }));
  const add = (key) => (blank) => setKey(key, [...(r[key] || []), { ...blank }]);
  const userNames = [...master.users].map((u) => u.name).sort();
  const staffNames = [...master.staff].map((s) => s.name).sort();
  const vehNames = master.vehicles.map((v) => v.name);
  const sel = (list) => (val, onPick, ph) => (
    <select className="border border-stone-300 rounded px-1 py-1 text-sm bg-white" value={val || ""} onChange={(e) => onPick(e.target.value)}>
      <option value="">{ph || "選択"}</option>
      {list.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
  const selUser = sel(userNames), selStaff = sel(staffNames), selVeh = sel(vehNames);
  const timeInput = (val, onPick, ph) => (
    <input className="w-20 border border-stone-300 rounded px-1 py-1 text-sm" placeholder={ph} value={val || ""} onChange={(e) => onPick(e.target.value)} />
  );
  const resetAll = async () => {
    if (!(await ask("ルールをすべて初期値に戻しますか?\n(画面で追加・変更したルールは失われます)"))) return;
    update((m) => ({ ...m, rules: seedRules() }));
    notify("ルールを初期値に戻しました");
  };
  return (
    <div className="bg-white border border-stone-300 rounded-lg p-3">
      <div className="text-xs text-stone-500 mb-3">
        送迎表のエラー判定に使う「決まりごと」をここで変更できます。変更はすぐ反映され、アプリを新しいファイルで開き直しても消えません。
        <b className="ml-1">担当が休みの日は代役でもエラーになりません。</b>
        <button className="ml-2 text-[11px] px-1.5 py-0.5 rounded border border-stone-300 hover:bg-stone-50" onClick={resetAll}>初期値に戻す</button>
      </div>

      <RuleRows title="① 同乗NG(この2人は同じ便にしない)" note="どちらの順番でも効きます"
        rows={r.ngPairs} onChange={(rows) => setKey("ngPairs", rows)} onAdd={add("ngPairs")} blank={{ a: "", b: "" }}
        cols={[
          { key: "a", label: "利用者", cell: (x, s) => selUser(x.a, (v) => s({ a: v })) },
          { key: "b", label: "利用者", cell: (x, s) => selUser(x.b, (v) => s({ b: v })) },
        ]} />

      <RuleRows title="② 迎え・送りの固定担当" note="例: 田中慶の月曜の迎えは吉岡"
        rows={r.fixedRun} onChange={(rows) => setKey("fixedRun", rows)} onAdd={add("fixedRun")} blank={{ kind: "meet", user: "", days: [], staff: "" }}
        cols={[
          { key: "user", label: "利用者", cell: (x, s) => selUser(x.user, (v) => s({ user: v })) },
          { key: "kind", label: "迎え/送り", cell: (x, s) => (
            <select className="border border-stone-300 rounded px-1 py-1 text-sm bg-white" value={x.kind || "meet"} onChange={(e) => s({ kind: e.target.value })}>
              <option value="meet">迎え</option><option value="send">送り</option>
            </select>) },
          { key: "days", label: "曜日", cell: (x, s) => <DayPicker days={x.days} onChange={(d) => s({ days: d })} /> },
          { key: "staff", label: "担当", cell: (x, s) => selStaff(x.staff, (v) => s({ staff: v })) },
        ]} />

      <RuleRows title="③ 車の固定担当(朝のピカ便など)" note="指定の時刻より前の迎え便が対象"
        rows={r.fixedVeh} onChange={(rows) => setKey("fixedVeh", rows)} onAdd={add("fixedVeh")} blank={{ veh: "", before: "12:00", days: [], staff: "" }}
        cols={[
          { key: "veh", label: "車", cell: (x, s) => selVeh(x.veh, (v) => s({ veh: v })) },
          { key: "before", label: "この時刻より前", cell: (x, s) => timeInput(x.before, (v) => s({ before: v }), "12:00") },
          { key: "days", label: "曜日", cell: (x, s) => <DayPicker days={x.days} onChange={(d) => s({ days: d })} /> },
          { key: "staff", label: "担当", cell: (x, s) => selStaff(x.staff, (v) => s({ staff: v })) },
        ]} />

      <RuleRows title="④ 予定・ヘルプの固定担当(透析など)" note="名前=予定の先頭の文字。完全一致にすると「藤井透析」などを含めません。ヘルプ表で基本の担当を決めたヘルプは、ヘルプ表のほうが優先されます"
        rows={r.fixedBlock} onChange={(rows) => setKey("fixedBlock", rows)} onAdd={add("fixedBlock")} blank={{ label: "", exact: false, kind: "", time: "", from: "", days: [], staff: "" }}
        cols={[
          { key: "label", label: "予定の名前", cell: (x, s) => <input className="w-24 border border-stone-300 rounded px-1 py-1 text-sm" value={x.label || ""} onChange={(e) => s({ label: e.target.value })} placeholder="透析" /> },
          { key: "exact", label: "完全一致", cell: (x, s) => <input type="checkbox" checked={!!x.exact} onChange={(e) => s({ exact: e.target.checked })} /> },
          { key: "kind", label: "種類", cell: (x, s) => (
            <select className="border border-stone-300 rounded px-1 py-1 text-sm bg-white" value={x.kind || ""} onChange={(e) => s({ kind: e.target.value })}>
              <option value="">どちらも</option><option value="help">ヘルプ</option><option value="block">予定</option>
            </select>) },
          { key: "time", label: "この時刻だけ", cell: (x, s) => timeInput(x.time, (v) => s({ time: v }), "12:00") },
          { key: "from", label: "この時刻以降", cell: (x, s) => timeInput(x.from, (v) => s({ from: v }), "15:00") },
          { key: "days", label: "曜日", cell: (x, s) => <DayPicker days={x.days} onChange={(d) => s({ days: d })} /> },
          { key: "staff", label: "担当", cell: (x, s) => selStaff(x.staff, (v) => s({ staff: v })) },
        ]} />

      <RuleRows title="⑤ 必ず入るヘルプ" note="その曜日にヘルプが1件も無ければエラー"
        rows={r.requiredHelp} onChange={(rows) => setKey("requiredHelp", rows)} onAdd={add("requiredHelp")} blank={{ user: "", days: [] }}
        cols={[
          { key: "user", label: "利用者", cell: (x, s) => selUser(x.user, (v) => s({ user: v })) },
          { key: "days", label: "曜日", cell: (x, s) => <DayPicker days={x.days} onChange={(d) => s({ days: d })} /> },
        ]} />

      <RuleRows title="⑥ 2名体制が必要なヘルプ(15時以降)" note="同じ時刻に2名そろっていなければエラー"
        rows={r.helpTwo} onChange={(rows) => setKey("helpTwo", rows)} onAdd={add("helpTwo")} blank={{ user: "", days: [] }}
        cols={[
          { key: "user", label: "利用者", cell: (x, s) => selUser(x.user, (v) => s({ user: v })) },
          { key: "days", label: "曜日", cell: (x, s) => <DayPicker days={x.days} onChange={(d) => s({ days: d })} /> },
        ]} />

      <RuleRows title="⑦ 男性職員のみ対応可" note="入浴のみ=予定名に「入浴」が付くときだけ"
        rows={r.maleOnly} onChange={(rows) => setKey("maleOnly", rows)} onAdd={add("maleOnly")} blank={{ user: "", from: "", bathOnly: false }}
        cols={[
          { key: "user", label: "利用者", cell: (x, s) => selUser(x.user, (v) => s({ user: v })) },
          { key: "from", label: "この時刻以降", cell: (x, s) => timeInput(x.from, (v) => s({ from: v }), "15:00") },
          { key: "bathOnly", label: "入浴のみ", cell: (x, s) => <input type="checkbox" checked={!!x.bathOnly} onChange={(e) => s({ bathOnly: e.target.checked })} /> },
        ]} />

      <RuleRows title="⑧ 利用者の基本の車" note="別の車に乗っているとエラー(例: 勝部・ホン=ピカ)"
        rows={r.userVeh} onChange={(rows) => setKey("userVeh", rows)} onAdd={add("userVeh")} blank={{ user: "", veh: "" }}
        cols={[
          { key: "user", label: "利用者", cell: (x, s) => selUser(x.user, (v) => s({ user: v })) },
          { key: "veh", label: "基本の車", cell: (x, s) => selVeh(x.veh, (v) => s({ veh: v })) },
        ]} />

      <RuleRows title="⑨ その他のルール" note="上の①〜⑧に当てはまらない決まりごとを自由に書けます。「出力前に確認」にチェックを入れると、その曜日のExcel出力前に確認として出ます(自動の判定はしません)"
        rows={r.otherRules || []} onChange={(rows) => setKey("otherRules", rows)} onAdd={add("otherRules")} blank={{ text: "", days: [], check: true }}
        cols={[
          { key: "text", label: "内容", cell: (x, s) => <input className="w-80 border border-stone-300 rounded px-1 py-1 text-sm" value={x.text || ""} onChange={(e) => s({ text: e.target.value })} placeholder="例:金曜の夕方は嫁島に男性職員を1名残す" /> },
          { key: "days", label: "曜日(空欄=毎日)", cell: (x, s) => <DayPicker days={x.days} onChange={(d) => s({ days: d })} /> },
          { key: "check", label: "出力前に確認", cell: (x, s) => <input type="checkbox" checked={x.check !== false} onChange={(e) => s({ check: e.target.checked })} /> },
        ]} />
      <RuleRows title="⑩ AIへの追加ルール" note="AI調整・AIと相談のときだけAIが読む決まりごとです。「💬 AIと相談」で話して変えることもできます"
        rows={r.aiNotes || []} onChange={(rows) => setKey("aiNotes", rows)} onAdd={add("aiNotes")} blank={{ text: "" }}
        cols={[
          { key: "text", label: "内容", cell: (x, s) => <input className="w-96 border border-stone-300 rounded px-1 py-1 text-sm" value={x.text || ""} onChange={(e) => s({ text: e.target.value })} placeholder="例:中村のリベルタへの送りは2便目(17:00)に固定" /> },
        ]} />
    </div>
  );
}

function DeptTab({ master, update, onReseed }) {
  const upd = (id, name) => update((m) => ({ ...m, departments: m.departments.map((d) => (d.id === id ? { ...d, name } : d)) }));
  const updGap = (id, v) => update((m) => ({ ...m, departments: m.departments.map((d) => (d.id === id ? { ...d, maleGapMin: v === "" ? "" : Number(v) } : d)) }));
  const updCap = (id, v) => update((m) => ({ ...m, departments: m.departments.map((d) => (d.id === id ? { ...d, capMax: v === "" ? undefined : Number(v) } : d)) }));
  const updStaffMax = (id, v) => update((m) => ({ ...m, departments: m.departments.map((d) => (d.id === id ? { ...d, staffMax: v === "" ? undefined : Number(v) } : d)) }));
  const updStaffMin = (id, v) => update((m) => ({ ...m, departments: m.departments.map((d) => (d.id === id ? { ...d, staffMin: v === "" ? undefined : Number(v) } : d)) }));
  const del = async (id) => {
    const used = master.staff.some((s) => s.deptId === id) || master.vehicles.some((v) => v.deptId === id) || master.users.some((u) => u.deptId === id);
    if (used) { notify("この部署に所属する職員・車両・利用者がいるため削除できません。先に移動してください。", "warn"); return; }
    if (!(await ask("この部署を削除しますか?"))) return;
    update((m) => ({ ...m, departments: m.departments.filter((d) => d.id !== id) }));
  };
  const add = () => update((m) => ({ ...m, departments: [...m.departments, { id: uid(), name: "新しい部署" }] }));
  return (
    <div className="bg-white border border-stone-300 rounded-lg p-3 max-w-md">
      {master.departments.map((d, i) => (
        <div key={d.id} className="flex items-center gap-2 mb-2">
          <span className={`w-3 h-3 rounded-full ${DEPT_COLORS[i % DEPT_COLORS.length].band}`} />
          <input className={inputCls} value={d.name} onChange={(e) => upd(d.id, e.target.value)} />
          <label className="flex items-center gap-1 text-xs text-stone-500 shrink-0" title="利用者が居るのに男性職員がゼロの状態を、何分まで許容するか(超えると人数表・車両の動きで赤表示)">
            男性不在
            <input type="number" min="0" step="15" className="w-14 border border-stone-300 rounded px-1 py-0.5 text-right"
              value={d.maleGapMin != null ? d.maleGapMin : 30} onChange={(e) => updGap(d.id, e.target.value)} />
            分迄可
          </label>
          <label className="flex items-center gap-1 text-xs text-stone-500 shrink-0" title="その時間帯に居る職員+利用者の合計がこの人数を超えると、人数表・車両の動きで警告色になります(空欄=制限なし)">
            在席上限
            <input type="number" min="0" step="1" className="w-12 border border-stone-300 rounded px-1 py-0.5 text-right"
              value={d.capMax != null ? d.capMax : ""} placeholder="－" onChange={(e) => updCap(d.id, e.target.value)} />
            名
          </label>
          <label className="flex items-center gap-1 text-xs text-stone-500 shrink-0" title="駐車場などの制約で、同じ時間帯に居られる職員数の上限(空欄=制限なし)。超えると人数表・車両の動きで警告色になります">
            職員上限
            <input type="number" min="0" step="1" className="w-12 border border-stone-300 rounded px-1 py-0.5 text-right"
              value={d.staffMax != null ? d.staffMax : ""} placeholder="－" onChange={(e) => updStaffMax(d.id, e.target.value)} />
            名
          </label>
          <label className="flex items-center gap-1 text-xs text-stone-500 shrink-0" title="利用者が居る時間帯に必要な最低職員数(空欄=チェックなし)。下回ると人数表・車両の動きでエラー色になります">
            職員下限
            <input type="number" min="0" step="1" className="w-12 border border-stone-300 rounded px-1 py-0.5 text-right"
              value={d.staffMin != null ? d.staffMin : ""} placeholder="－" onChange={(e) => updStaffMin(d.id, e.target.value)} />
            名
          </label>
          <button className="text-rose-500 text-xs hover:underline shrink-0" onClick={() => del(d.id)}>削除</button>
        </div>
      ))}
      <button className={`${btnSec} mt-1`} onClick={add}>+ 部署を追加</button>

      <div className="mt-6 pt-4 border-t border-stone-200">
        <div className="text-sm font-bold text-stone-700 mb-1">初期データの読み込み</div>
        <div className="text-xs text-stone-500 mb-2">
          既存のExcel月曜表から抽出した職員38名・利用者40名・車両13台のマスタを読み込みます。<span className="text-rose-600 font-semibold">現在の職員・利用者・車両・部署はすべて置き換わります</span>(日別の送迎表・週間パターンは消えません)。最初のセットアップ時にお使いください。
        </div>
        <button className={btnDanger} onClick={onReseed}>Excelの初期データを読み込む(マスタを置き換え)</button>
      </div>
    </div>
  );
}

/* ============================================================
   メインアプリ
   ============================================================ */
// ===== 版の切替ボタン =====
// 他の版(別のアーティファクト)をタブで開く。URLはこの版の保存領域に覚えておく
function EditionSwitcher() {
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

function AppInner() {
  const [tab, setTab] = useState("sheet");
  const [master, setMaster] = useState(null);
  const [saveState, setSaveState] = useState("idle");

  const claudeProps = useClaudeProposals();
  const [date, setDate] = useState(() => {
    // 新体制版は開始日(11/1)より前に開いたらその日を表示。カレンダーから日付付きで開いたらその日
    const d0 = typeof window !== "undefined" && /^\d{4}-\d{2}-\d{2}$/.test(window.__SG_DATE || "") ? window.__SG_DATE : "";
    if (d0) return d0;
    const t = todayStr();
    return EDITION_START && t < EDITION_START ? EDITION_START : t;
  });
  const [sheet, setSheet] = useState(null);
  // Undo/Redo履歴。日別シートと週間パターンで別々に持つ。
  // past=戻れる過去の状態(古い→新しい)、future=進める未来の状態(新しい→古い)
  const histRef = useRef({ sheet: { past: [], future: [] }, pattern: { past: [], future: [] } });
  const [histTick, setHistTick] = useState(0); // ボタンの活性/非活性を再描画させるためのカウンタ
  const HIST_MAX = 50; // 保持する履歴の上限(古いものから捨てる)
  const [sheetExists, setSheetExists] = useState(false);
  const [deptFilter, setDeptFilter] = useState("all");
  const [show3d, setShow3d] = useState(false); // 送迎表と3Dの2画面表示
  const [panel3d, setPanel3d] = useState({ x: null, y: null, w: 640, h: 360 }); // 3Dパネルの位置とサイズ
  const [sidePanel, setSidePanel] = useState(true); // 未割当パネル(右固定)の表示
  const [panelsOpen, setPanelsOpen] = useState(false); // 下部パネル(特記・男性カバー・配車)の開閉。初期は閉じて軽く

  // 日付を1日進める/戻す
  const shiftDate = (delta) => {
    const [y, mo, d] = date.split("-").map(Number);
    const dt = new Date(y, mo - 1, d + delta);
    setDate(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
  };

  const [weekday, setWeekday] = useState(weekdayOf(todayStr()));
  const [pattern, setPattern] = useState(null);
  const [copyFrom, setCopyFrom] = useState(1);

  const [modal, setModal] = useState(null);
  // ページ内検索(Ctrl+F / Escで解除 / Enter・◀▶で次のヒットへ)
  const [searchQ, setSearchQ] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setTab("sheet");
        setTimeout(() => { if (searchRef.current) searchRef.current.focus(); }, 60);
      } else if (e.key === "Escape") {
        setSearchQ("");
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const tag = (document.activeElement && document.activeElement.tagName) || "";
        if (!["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
          setSearchIdx((i) => i + (e.key === "ArrowRight" ? 1 : -1));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // アプリ内通知(トースト)と確認ダイアログ
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [confirmBox, setConfirmBox] = useState(null); // {msg, resolve}
  useEffect(() => {
    _notify = (msg, type) => {
      setToast({ msg, type });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 5000);
    };
    _ask = (msg) => new Promise((resolve) => setConfirmBox({ msg, resolve }));
    return () => { _notify = () => {}; _ask = () => Promise.resolve(false); };
  }, []);
  const answerConfirm = (val) => {
    if (confirmBox) confirmBox.resolve(val);
    setConfirmBox(null);
  };

  const saveTimers = useRef({});
  const scheduleSave = (key, value) => { sSet(key, value); };
  // 日付・曜日の切替時: 未送信を端末に書き切り、送信を促す(通信を待たずに切り替えられる)
  const flushSaves = async () => { if (KV) KV.flushLocal(); };
  const [calEvents, setCalEvents] = useState({ date: null, list: [] });

  useEffect(() => {
    (async () => {
      let m = await sGet("master");
      if (sLoadFailed("master")) return; // 読めなかったときは初期データで上書きしない(障害A)。画面上部に警告が出る
      // 未保存、または古い版の初期データしか入っていない場合は最新の初期データに差し替える
      if (!m || !m.staff || m.staff.length === 0 || (m.seedVersion || 0) < SEED_VERSION) {
        // 丸ごと上書きせず、アプリ画面での追加・変更を残したままseedを取り込む
        // 複数の端末が同時に開いても1回だけ行うよう、ロックの中で読み直してから更新する
        const before = m && m.staff ? m.staff.length : 0;
        m = await sUpdate("master", (cur) => ((!cur || !cur.staff || cur.staff.length === 0 || (cur.seedVersion || 0) < SEED_VERSION) ? mergeSeedMaster(cur, seedMaster()) : cur));
        if (before) notify(`アプリ版をv${SEED_VERSION}に更新しました(職員${before}→${m.staff.length}名。画面で追加・変更した内容はそのままです)`, "info");
        // 週間パターンは「まだ作られていない曜日」だけ初期パターンを入れる。
        // (以前は毎回上書きしていたため、「パターンに保存」した内容が版を上げるたびに消えていた)
        for (const [wd, key] of [[1, "mon"], [2, "tue"], [3, "wed"], [4, "thu"], [5, "fri"]]) {
          if (!SEED_PATTERNS[key]) continue;
          await sUpdate(`pattern:${wd}`, (cur) => {
            const empty = !cur || (!(cur.runs || []).length && !(cur.blocks || []).length);
            return empty ? resolveSeedPattern(m, SEED_PATTERNS[key]) : cur;
          });
        }
      }
      setMaster(m);
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

  const updateMaster = (fn) =>
    setMaster((prev) => {
      const next = fn(prev);
      scheduleSave("master", next);
      return next;
    });
  // ルールの変更：「使い始める日」が入っていれば、その前の日までの送迎表は前のルールのまま(scheduleRules)
  const [ruleFrom, setRuleFrom] = useState("");
  const updateRules = (fn) => updateMaster((m) => scheduleRules(m, fn(m), ruleFrom));

  useEffect(() => {
    if (!master) return;
    let alive = true;
    // 別の日を開いたら履歴はクリア(前の日の状態に戻ってしまうのを防ぐ)
    histRef.current.sheet = { past: [], future: [] };
    setHistTick((v) => v + 1);
    setSheet(null);
    (async () => {
      await flushSaves();
      const s = await sGet(`sheet:${date}`);
      if (!alive) return;
      if (sLoadFailed(`sheet:${date}`)) return; // 読めなかった日は空の表を作らない(障害A)
      setSheet(s || emptySheet());
      setSheetExists(!!s);
    })();
    return () => { alive = false; };
  }, [date, master ? 1 : 0]);

  // 他の人がこの日の送迎表を変えたら、開いている画面にもすぐ反映する(自分の未送信の編集は残したまま統合)
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

  const updateSheet = (fn, opt) =>
    setSheet((prev) => {
      const next = fn(prev);
      // 履歴に積む(undo/redoによる復元時はskipHist=trueで積まない)
      if (!(opt && opt.skipHist) && prev) {
        const h = histRef.current.sheet;
        h.past.push(prev);
        if (h.past.length > HIST_MAX) h.past.shift();
        h.future = [];
        setHistTick((v) => v + 1);
      }
      scheduleSave(`sheet:${date}`, next);
      setSheetExists(true);
      return next;
    });

  // Undo/Redo本体。日別シート(sheet)と週間パターン(pattern)のどちらを対象にするかはタブで決まる
  const histTarget = () => (tab === "pattern" ? "pattern" : "sheet");
  const canUndo = () => histRef.current[histTarget()].past.length > 0;
  const canRedo = () => histRef.current[histTarget()].future.length > 0;
  const doUndo = () => {
    const t = histTarget();
    const h = histRef.current[t];
    if (!h.past.length) { notify("これ以上戻れません", "warn"); return; }
    const prevState = h.past.pop();
    if (t === "pattern") {
      setPattern((cur) => { h.future.push(cur); scheduleSave(`pattern:${weekday}`, prevState); return prevState; });
    } else {
      setSheet((cur) => { h.future.push(cur); scheduleSave(`sheet:${date}`, prevState); return prevState; });
    }
    setHistTick((v) => v + 1);
    notify("1つ前に戻しました", "info");
  };
  const doRedo = () => {
    const t = histTarget();
    const h = histRef.current[t];
    if (!h.future.length) { notify("これ以上進めません", "warn"); return; }
    const nextState = h.future.pop();
    if (t === "pattern") {
      setPattern((cur) => { h.past.push(cur); scheduleSave(`pattern:${weekday}`, nextState); return nextState; });
    } else {
      setSheet((cur) => { h.past.push(cur); scheduleSave(`sheet:${date}`, nextState); return nextState; });
    }
    setHistTick((v) => v + 1);
    notify("やり直しました", "info");
  };

  useEffect(() => {
    if (!master || tab !== "pattern") return;
    let alive = true;
    // 別の曜日を開いたら履歴はクリア
    histRef.current.pattern = { past: [], future: [] };
    setHistTick((v) => v + 1);
    setPattern(null);
    (async () => {
      await flushSaves();
      let p = await sGet(`pattern:${weekday}`);
      if (!alive) return;
      if (sLoadFailed(`pattern:${weekday}`)) return; // 読めなかった曜日は初期パターンで上書きしない
      // 未作成または空の曜日は、初期パターン(月=1/火=2/金=5)があれば自動投入
      const isEmpty = !p || (!(p.runs || []).length && !(p.blocks || []).length);
      if (isEmpty) {
        const seedKey = weekday === 1 ? "mon" : weekday === 2 ? "tue" : weekday === 3 ? "wed" : weekday === 4 ? "thu" : weekday === 5 ? "fri" : null;
        if (seedKey && SEED_PATTERNS[seedKey]) {
          const seeded = resolveSeedPattern(master, SEED_PATTERNS[seedKey]);
          p = await sUpdate(`pattern:${weekday}`, (cur) => ((!cur || (!(cur.runs || []).length && !(cur.blocks || []).length)) ? seeded : cur));
        }
      }
      setPattern(p || emptyPattern());
    })();
    return () => { alive = false; };
  }, [weekday, tab, master ? 1 : 0]);

  useEffect(() => {
    if (!master || tab !== "pattern") return;
    return sWatch(`pattern:${weekday}`, (v, info) => {
      if (!v) return;
      histRef.current.pattern = { past: [], future: [] };
      setHistTick((x) => x + 1);
      setPattern(v);
      if (info && info.conflicts) notify(`パターンの同じ箇所を他の人も変更していました(${info.conflicts}か所)。後から保存した内容を残しています`, "warn");
    });
  }, [weekday, tab, master ? 1 : 0]);

  const updatePattern = (fn, opt) =>
    setPattern((prev) => {
      const next = fn(prev);
      if (!(opt && opt.skipHist) && prev) {
        const h = histRef.current.pattern;
        h.past.push(prev);
        if (h.past.length > HIST_MAX) h.past.shift();
        h.future = [];
        setHistTick((v) => v + 1);
      }
      scheduleSave(`pattern:${weekday}`, next);
      return next;
    });

  // キーボードショートカット: Ctrl+Z=戻る、Ctrl+Y / Ctrl+Shift+Z=進む
  // 入力欄の中では効かせない(文字の打ち消しを優先)
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target;
      const tag = el && el.tagName ? el.tagName.toUpperCase() : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
      const k = String(e.key || "").toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const loadFromPattern = async () => {
    const wd = weekdayOf(date);
    // 常に保存済みの最新パターンを読む(起動時の初期データ上書きと、メモリ上の古い値の競合を避ける)
    let p = await sGet(`pattern:${wd}`);
    if (!p && wd === weekday && pattern) p = pattern;
    // それでも無ければ初期パターン(火・金)を使う
    if (!p || (!(p.runs || []).length && !(p.blocks || []).length)) {
      const seedKey = wd === 1 ? "mon" : wd === 2 ? "tue" : wd === 3 ? "wed" : wd === 4 ? "thu" : wd === 5 ? "fri" : null;
      if (seedKey && SEED_PATTERNS[seedKey]) {
        const seeded = resolveSeedPattern(master, SEED_PATTERNS[seedKey]);
        p = await sUpdate(`pattern:${wd}`, (cur) => ((!cur || (!(cur.runs || []).length && !(cur.blocks || []).length)) ? seeded : cur));
      }
    }
    if (!p || (!(p.runs || []).length && !(p.blocks || []).length)) {
      notify(`${DAYS[wd]}曜日のパターンがまだ作られていません。「週間パターン」タブで作成してください。`, "warn");
      return;
    }
    if (sheet && (sheet.runs.length || sheet.blocks.length)) {
      if (!(await ask("現在の表の内容をパターンで置き換えます。よろしいですか?"))) return;
    }
    updateSheet((prev) => ({
      ...(prev || emptySheet()),
      runs: remapRetired(master, date, (p.runs || []).map((r) => ({ ...r, id: r.id ? `${r.id}@${date}` : uid() }))),
      blocks: remapRetired(master, date, canonHelpBlocks(p.blocks || []).map((b) => ({ ...b, id: b.id ? `${b.id}@${date}` : uid() }))),
      training: p.training || (prev && prev.training) || "",
      // パターンが特記情報(Excel取り込み由来)を持っていれば一緒に反映(無い場合は現状維持)
      noRide: { ...noRideDefaults(master, weekdayOf(date)), ...((prev && prev.noRide) || {}), ...(p.noRide || {}) },
      ...(p.userTime && Object.keys(p.userTime).length ? { userTime: p.userTime } : {}),
      ...(p.libertaOn && Object.keys(p.libertaOn).length ? { libertaOn: p.libertaOn } : {}),
      ...(p.libertaOff && Object.keys(p.libertaOff).length ? { libertaOff: p.libertaOff } : {}),
      ...(p.notes ? { notes: p.notes } : {}),
      ...(p.contact ? { contact: p.contact } : {}),
      ...(p.staffOv && Object.keys(p.staffOv).length ? { staffOv: p.staffOv } : {}),
    }));
    notify(`${DAYS[wd]}曜日のパターン(${(p.runs || []).length + (p.blocks || []).length}件)を読み込みました`);
    // 読み込んだ内容をすぐ書き切る(直後に日付移動やリロードをしても消えないように)
    setTimeout(() => { flushSaves(); }, 100);
  };

  // 今表示している日の内容を、その曜日の週間パターンとして保存する(パターンから読込の逆)
  const saveToPattern = async () => {
    const wd = weekdayOf(date);
    if (!sheet || (!(sheet.runs || []).length && !(sheet.blocks || []).length)) {
      notify("保存する内容がありません。先に送迎表を作ってください。", "warn");
      return;
    }
    const cur = await sGet(`pattern:${wd}`);
    const curN = cur ? (cur.runs || []).length + (cur.blocks || []).length : 0;
    const newN = (sheet.runs || []).length + (sheet.blocks || []).length;
    if (!(await ask(`${DAYS[wd]}曜日の週間パターンを、${date}の内容(${newN}件)で置き換えます。\n` +
      (curN ? `今のパターン(${curN}件)は上書きされ、元に戻せません。\n` : "") +
      "よろしいですか?"))) return;
    // その日限りの情報(休み・当日の時間変更・欠席など)は持ち込まない。
    // 便と予定、訓練、乗車なし、利用時間、リベルタ通いの設定だけをパターンにする
    const p = {
      runs: (sheet.runs || []).map((r) => ({ ...r, id: uid() })),
      blocks: (sheet.blocks || []).map((b) => ({ ...b, id: uid() })),
      training: sheet.training || "",
      noRide: sheet.noRide || {},
      userTime: sheet.userTime || {},
      libertaOn: sheet.libertaOn || {},
      libertaOff: sheet.libertaOff || {},
    };
    await sSet(`pattern:${wd}`, p);
    if (wd === weekday) setPattern(p); // 週間パターンのタブを開いていたら表示も更新
    notify(`${date}の内容を${DAYS[wd]}曜日のパターン(${newN}件)として保存しました`);
  };

  const isPattern = tab === "pattern";
  const curData = isPattern ? pattern : sheet;
  const curUpdate = isPattern ? updatePattern : updateSheet;
  const curWd = isPattern ? weekday : weekdayOf(date);

  const [gridHoverTime, setGridHoverTime] = useState(null); // 表のマスのポインター位置(使える車パネルが連動)

  // ワンタッチ: クリップボードのCSVを取込→保存→この日の振り分けまで一気に実行
  const quickLibCsv = async () => {
    if (!sheet) { notify("先に送迎表を作成してください(パターンから読込)", "warn"); return; }
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch (e) { setModal({ type: "libCsv" }); return; }
    if (!text || !/実施予定日|予定開始/.test(text.slice(0, 300))) {
      setModal({ type: "libCsv" });
      notify("クリップボードにCSVが見つからないため、取込画面を開きました(エクスポートツールを先に実行するとコピーされます)", "warn");
      return;
    }
    const parsed = parseLibCsv(text);
    if (!Object.keys(parsed).length) { setModal({ type: "libCsv" }); notify("CSVを読み取れませんでした。取込画面から確認してください", "warn"); return; }
    const merged = { ...((await sGet("libSvcCsv")) || {}), ...parsed };
    await sSet("libSvcCsv", merged);
    const dayMap = merged[date];
    if (!dayMap) { notify(`CSVを保存しました(${Object.keys(parsed).length}日分)。ただし ${date} のデータは含まれていませんでした`, "warn"); return; }
    assignLibFromDay(dayMap);
  };

  // 全自動: アプリを開いた時・ウィンドウに戻った時にクリップボードを確認し、
  // リベルタ実績CSVが入っていれば取込→この日の振り分けまで自動実行する(同じCSVは二重処理しない)
  const lastLibCsvSig = useRef("");
  useEffect(() => {
    let alive = true;
    const tryAuto = async () => {
      if (!alive || tab !== "sheet" || !sheet) return;
      let text = "";
      try { text = await navigator.clipboard.readText(); } catch (e) { return; } // 権限なし等は静かにスキップ
      if (!text || !/実施予定日|予定開始/.test(text.slice(0, 300))) return;
      const sig = text.length + ":" + text.slice(0, 120);
      if (lastLibCsvSig.current === sig) return;
      const savedSig = await sGet("libSvcCsvSig");
      if (savedSig === sig) { lastLibCsvSig.current = sig; return; } // 既に取込済みのCSV
      lastLibCsvSig.current = sig;
      const parsed = parseLibCsv(text);
      if (!Object.keys(parsed).length) return;
      const merged = { ...((await sGet("libSvcCsv")) || {}), ...parsed };
      await sSet("libSvcCsv", merged);
      await sSet("libSvcCsvSig", sig);
      const dayMap = merged[date];
      if (dayMap) {
        assignLibFromDay(dayMap);
        notify("📋 クリップボードのリベCSVを自動取込して振り分けました");
      } else {
        notify(`📋 リベCSVを自動取込しました(${Object.keys(parsed).length}日分)。${date} のデータは含まれていません`, "warn");
      }
    };
    window.addEventListener("focus", tryAuto);
    const t0 = setTimeout(tryAuto, 800); // 開いた直後にも一度
    return () => { alive = false; clearTimeout(t0); window.removeEventListener("focus", tryAuto); };
  }, [tab, sheet, date]);

  // リベルタ実績CSVの1日分データ(am/pm)から、リベ迎・リベ送の便を振り分ける(モーダルとワンタッチボタンで共用)
  const assignLibFromDay = (dayMap) => {
    let finalRunsLib = null;
            const am = dayMap.am || dayMap; // 旧形式互換
            const pm = dayMap.pm || {};
            const d1 = sheetMaster.departments.find((d) => d.name === "嫁島");
            const d2 = sheetMaster.departments.find((d) => d.name === "津田");
            const dora = sheetMaster.vehicles.find((v) => v.name === "ドラ");
            const wd2 = weekdayOf(date);
            const { isLibOn } = makeLibNameHelpers(dataForGrid || {}, wd2);
            const absent = (dataForGrid && dataForGrid.userAbsent) || {};
            const nm = (ids) => ids.map((id) => (sheetMaster.users.find((u) => u.id === id) || {}).name).filter(Boolean).join("・");
            const timeOf = (map, u) => {
              const hit = Object.keys(map).find((fn) => fn.startsWith(u.name) && (matchUserByFullName(sheetMaster.users, fn) || {}).id === u.id);
              return hit ? toMin(map[hit]) : null;
            };
            const libUsersOf = (dept, kind) => sheetMaster.users.filter((u) =>
              (u.days || []).includes(wd2) && !absent[u.id] && dept && u.deptId === dept.id && (u.libertaAM || u.libertaPM) && isLibOn(u, kind));
            const msgs = [];
            updateSheet((prev) => {
              let runs = [...(prev.runs || [])];

              // ===== 迎え: 嫁島行きのみ 9:00まで=1便目 / 9:00超=2便目(ドラ9:30) =====
              {
                const targets = libUsersOf(d1, "meet");
                const g1 = [], g2 = [], noData = [];
                targets.forEach((u) => {
                  const em = timeOf(am, u);
                  if (em == null) noData.push(u.name);
                  else if (em > 9 * 60) g2.push(u.id);
                  else g1.push(u.id);
                });
                if (g1.length || g2.length) {
                  const tgtSet = new Set([...g1, ...g2]);
                  const cand = runs.filter((r) => r.kind === "meet" && !r.mode && (r.userIds || []).some((id) => tgtSet.has(id)));
                  const runA = cand.find((r) => { const v = resolveVehicle(sheetMaster, r.vehicleId); return v && v.name === "ピカチュウ"; }) || cand.sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0))[0];
                  const runB = runs.find((r) => r.kind === "meet" && !r.mode && dora && r.vehicleId === dora.id);
                  runs = runs.map((r) => (r.kind === "meet" && !r.mode ? { ...r, userIds: (r.userIds || []).filter((id) => !tgtSet.has(id)) } : r));
                  if (runA) runs = runs.map((r) => (r.id === runA.id ? { ...r, userIds: [...(r.userIds || []), ...g1] } : r));
                  if (g2.length) {
                    if (runB) runs = runs.map((r) => (r.id === runB.id ? { ...r, userIds: [...(r.userIds || []), ...g2] } : r));
                    else runs.push({ id: uid(), kind: "meet", time: "9:30", staffId: HOLD_ID, vehicleId: dora ? dora.id : "", userIds: g2, note: "リベ2便目(9:30サービス)" });
                  }
                  msgs.push(`迎え(嫁島) 1便: ${nm(g1) || "なし"} / 2便(ドラ9:30): ${nm(g2) || "なし"}${noData.length ? ` / データなし: ${noData.join("・")}` : ""}`);
                }
              }

              // ===== 送り: 嫁島・津田とも 17:00より前にサービス=1便目 / 17:00以降=2便目 =====
              [d1, d2].forEach((dept) => {
                if (!dept) return;
                const targets = libUsersOf(dept, "send");
                const g1 = [], g2 = [], noData = [];
                targets.forEach((u) => {
                  const sm = timeOf(pm, u);
                  if (sm == null) noData.push(u.name);
                  else if (sm >= 17 * 60) g2.push(u.id);
                  else g1.push(u.id);
                });
                if (!g1.length && !g2.length) return;
                const tgtSet = new Set([...g1, ...g2]);
                // この部署の対象者を乗せている送り便(時刻順)
                const cand = runs.filter((r) => r.kind === "send" && !r.mode && (r.userIds || []).some((id) => tgtSet.has(id)))
                  .sort((a, b) => (toMin(a.time) || 0) - (toMin(b.time) || 0));
                const runA = cand[0];
                const runB = cand.length > 1 ? cand[cand.length - 1] : null;
                runs = runs.map((r) => (r.kind === "send" && !r.mode ? { ...r, userIds: (r.userIds || []).filter((id) => !tgtSet.has(id)) } : r));
                if (runA) runs = runs.map((r) => (r.id === runA.id ? { ...r, userIds: [...(r.userIds || []), ...g1] } : r));
                else if (g1.length) runs.push({ id: uid(), kind: "send", time: "16:00", staffId: HOLD_ID, vehicleId: "", userIds: g1, note: `リベ送1便目(${dept.name})` });
                if (g2.length) {
                  if (runB) runs = runs.map((r) => (r.id === runB.id ? { ...r, userIds: [...(r.userIds || []), ...g2] } : r));
                  else runs.push({ id: uid(), kind: "send", time: "17:00", staffId: HOLD_ID, vehicleId: "", userIds: g2, note: `リベ送2便目(${dept.name}・17時以降サービス)` });
                }
                msgs.push(`送り(${dept.name}) 1便: ${nm(g1) || "なし"} / 2便: ${nm(g2) || "なし"}${noData.length ? ` / データなし: ${noData.join("・")}` : ""}`);
              });

              finalRunsLib = runs;
              return { ...prev, runs };
            });
            // 振り分け後、ケアウィングCSVと送迎表の違いを自動照合
            const diffs = finalRunsLib ? libCsvDiff(sheetMaster, { ...dataForGrid, runs: finalRunsLib }, dayMap, wd2) : [];
            if (diffs.length) setModal({ type: "libDiff", items: diffs });
            else setModal(null);
            if (msgs.length) notify("リベ迎・リベ送を振り分けました — " + msgs.join(" ◆ ") + (diffs.length ? ` / ⚠照合で${diffs.length}件の違いを検出` : " / 照合OK(違いなし)"));
            else notify("この日のリベルタ利用者のサービスデータが見つかりませんでした", "warn");
  };
  const dataForGrid = useMemo(
    () => (curData ? {
      staffOv: {}, userAbsent: {}, userDept: {}, notes: "", contact: "", libertaOff: {}, libertaOn: {}, userTime: {},
      ...curData,
      // 退職者(日付基準)の担当分は保留列に表示(パターン編集時はそのまま)
      ...(!isPattern && master ? {
        runs: remapRetired(master, date, curData.runs || []),
        blocks: canonHelpBlocks(remapRetired(master, date, curData.blocks || [])),
      } : { blocks: canonHelpBlocks(curData.blocks || []) }),
      // 基本の送迎なし(馬場・猪原・野津周の月木・石田の木など)を常に合成(シート/取り込みの設定が優先)
      noRide: { ...noRideDefaults(master, curWd), ...(curData.noRide || {}) },
    } : null),
    [curData, master, curWd, isPattern, date]
  );


  // 曜日別・当日別の部署を反映したマスタ(表示・提案・出力用)
  const sheetMaster = useMemo(
    () => {
      if (!master) return null;
      const m2 = applyDayDept(master, weekdayOf(date), sheet && sheet.staffOv, sheet && sheet.userDept, sheet && sheet.userExtra, date);
      // 退職日以降の職員は列・人数・選択肢から除外
      return { ...m2, staff: m2.staff.filter((s) => !isRetiredOn(s, date)) };
    },
    [master, date, sheet && sheet.staffOv, sheet && sheet.userDept, sheet && sheet.userExtra]
  );

  // 検索ヒット(時刻順)と現在位置
  const searchHits = useMemo(() => {
    const q = (searchQ || "").trim();
    if (!q || !sheetMaster || !dataForGrid) return [];
    const un = (id) => { const u = sheetMaster.users.find((x) => x.id === id); return u ? u.name : ""; };
    const sn = (id) => { const s = sheetMaster.staff.find((x) => x.id === id); return s ? s.name : ""; };
    const hitRun = (r) =>
      [...(r.userIds || []).map(un), ...(r.staffRiderIds || []).map(sn), sn(r.staffId),
        (resolveVehicle(sheetMaster, r.vehicleId) || {}).name || "", r.note || ""].some((x) => x && x.includes(q));
    const hitBlock = (b) => (b.label || "").includes(q) || sn(b.staffId).includes(q);
    return [
      ...dataForGrid.runs.filter(hitRun).map((r) => ({ id: r.id, t: toMin(r.time) || 0 })),
      ...dataForGrid.blocks.filter(hitBlock).map((b) => ({ id: b.id, t: toMin(b.time) || 0 })),
    ].sort((a, b) => a.t - b.t).map((x) => x.id);
  }, [searchQ, dataForGrid, sheetMaster]);
  const activeSearchId = searchHits.length ? searchHits[((searchIdx % searchHits.length) + searchHits.length) % searchHits.length] : null;
  const searchJump = (dir) => { if (searchHits.length) setSearchIdx((i) => i + dir); };
  const patternMaster = useMemo(
    () => (master ? applyDayDept(master, weekday, null, null) : null),
    [master, weekday]
  );
  const curMaster = isPattern ? patternMaster : sheetMaster;

  const saveItem = ({ target, item }) =>
    curUpdate((prev) => {
      const base = { ...(prev || (isPattern ? emptyPattern() : emptySheet())) };
      const other = target === "runs" ? "blocks" : "runs";
      base[other] = (base[other] || []).filter((x) => x.id !== item.id);
      const list = (base[target] || []).filter((x) => x.id !== item.id);
      base[target] = [...list, item];
      return base;
    });

  const deleteItem = (target, id) =>
    curUpdate((prev) => ({ ...prev, [target]: prev[target].filter((x) => x.id !== id) }));

  // ---------- ドラッグ&ドロップの反映 ----------
  const moveItem = (target, id, newStaffId, slotMin) =>
    curUpdate((prev) => ({
      ...prev,
      [target]: prev[target].map((x) => {
        if (x.id !== id) return x;
        const t = toMin(x.time);
        const offset = t != null ? t % SLOT : 0;
        return { ...x, staffId: newStaffId, time: toStr(slotMin + offset) };
      }),
    }));

  // 移動元の便が空(乗車0名)になったら、その枠を自動で消す(ドラッグ移動時のみ)
  const dropEmptySrc = (runs, fromRunId) => runs.filter((r) => !(r.id === fromRunId && (r.userIds || []).length === 0));

  const dropUserOnRun = (drag, runId) =>
    curUpdate((prev) => ({
      ...prev,
      runs: dropEmptySrc(prev.runs.map((r) => {
        if (drag.fromRunId && r.id === drag.fromRunId && r.id !== runId)
          return { ...r, userIds: r.userIds.filter((x) => x !== drag.userId) };
        if (r.id === runId)
          return r.userIds.includes(drag.userId) ? r : { ...r, userIds: [...r.userIds, drag.userId] };
        return r;
      }), drag.fromRunId),
    }));

  const dropVehicleOnRun = (vehicleId, runId) =>
    curUpdate((prev) => ({ ...prev, runs: prev.runs.map((r) => (r.id === runId ? { ...r, vehicleId } : r)) }));

  const dropUserOnCell = (drag, staffId, time) => {
    if (drag.fromRunId) {
      // 便に乗っている利用者を空きマスへ: 元の便から外し、車未定の新しい便をその場に作る
      curUpdate((prev) => {
        const srcRun = (prev.runs || []).find((r) => r.id === drag.fromRunId);
        const kind = (srcRun && srcRun.kind) || drag.kind || "meet";
        return {
          ...prev,
          runs: [
            ...dropEmptySrc(prev.runs.map((r) => (r.id === drag.fromRunId ? { ...r, userIds: (r.userIds || []).filter((x) => x !== drag.userId) } : r)), drag.fromRunId),
            { id: uid(), kind, ...(srcRun && srcRun.mode ? { mode: srcRun.mode } : {}), time, staffId, vehicleId: "", userIds: [drag.userId], staffRiderIds: [], note: "" },
          ],
        };
      });
      return;
    }
    setModal({ type: "item", initial: { staffId, time, kind: drag.kind || "meet", userIds: [drag.userId] } });
  };

  const dropVehicleOnCell = (vehicleId, staffId, time) =>
    setModal({ type: "item", initial: { staffId, time, kind: "meet", vehicleId } });

  const removeUserFromRun = (drag) => {
    if (!drag.fromRunId) return;
    curUpdate((prev) => ({
      ...prev,
      runs: dropEmptySrc(prev.runs.map((r) => (r.id === drag.fromRunId ? { ...r, userIds: r.userIds.filter((x) => x !== drag.userId) } : r)), drag.fromRunId),
    }));
  };

  // ---- Excel出力(保留・送迎漏れがあれば警告してから) ----
  const handleMonthly = async (mode = "count") => {
    if (!sheetMaster) return;
    const ym = date.slice(0, 7);
    const [yy, mm] = ym.split("-").map(Number);
    notify(`${mm}月分を集計しています...`);
    await flushSaves(); // 直前の編集も含める
    const last = new Date(yy, mm, 0).getDate();
    const dates = [];
    for (let d = 1; d <= last; d++) dates.push(`${ym}-${String(d).padStart(2, "0")}`);
    // 保存済みの日だけ読み込む(リクエスト回数を最小化。共有ストレージにはレート制限がある)
    let existKeys = await sList(`sheet:${ym}`);
    if (existKeys == null) existKeys = dates.map((ds) => `sheet:${ds}`); // list不可の環境では全日
    const existSet = new Set(existKeys);
    const sheets = [];
    for (let i = 0; i < dates.length; i += 4) {
      const batch = await Promise.all(dates.slice(i, i + 4).map((ds) => existSet.has(`sheet:${ds}`) ? sGet(`sheet:${ds}`) : Promise.resolve(null)));
      sheets.push(...batch);
    }
    const days2 = dates.map((ds, i) => ({ date: ds, sheet: sheets[i] }));
    const withData = days2.filter((x) => x.sheet && ((x.sheet.runs || []).length || (x.sheet.blocks || []).length)).length;
    if (!withData) {
      notify(`${mm}月の保存済みシートが0日です。送迎表(日別)で各日を開いて「パターンから読込」すると、その日が集計対象になります`, "warn");
      return;
    }
    try {
      const ExcelJS = await loadExcelJS();
      const wb = buildMonthlySummary(ExcelJS, sheetMaster, days2, mode);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${mode === "time" ? "利用時間実績" : "送迎集計"}_${ym}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      notify(`${mm}月の${mode === "time" ? "利用時間実績" : "送迎集計"}を出力しました(データのある日: ${withData}日)`);
    } catch (e) {
      notify("集計の出力に失敗しました: " + e.message, "warn");
    }
  };



  // ヘルプ表タブ用: 全曜日の週間パターンを読み込む
  const [allPatterns, setAllPatterns] = useState(null);
  useEffect(() => {
    if (!master || tab !== "helpboard") return;
    let alive = true;
    setAllPatterns(null);
    (async () => {
      await flushSaves();
      const out = {};
      for (const wd of DAY_ORDER) {
        const p = await sGet(`pattern:${wd}`);
        if (p && ((p.runs || []).length || (p.blocks || []).length)) out[wd] = p;
      }
      if (alive) setAllPatterns(out);
    })();
    return () => { alive = false; };
  }, [tab, master ? 1 : 0]);

  // 送迎表の「通常外のヘルプ」用: 表示中の日の曜日の週間パターン(=通常のヘルプ)を読む
  const [dayPattern, setDayPattern] = useState(null);
  useEffect(() => {
    if (!master || !date) return;
    let alive = true;
    (async () => {
      const p = await sGet(`pattern:${weekdayOf(date)}`);
      if (alive) setDayPattern(p || { runs: [], blocks: [] });
    })();
    return () => { alive = false; };
  }, [date, tab, master ? 1 : 0]);

  // ヘルプ表からの削除: 週間パターン(全曜日)から同じヘルプ(名前+時刻)を消す
  // ヘルプ表から週間パターンへ: 指定の曜日に、同じヘルプ(名前+時刻)を担当つきで入れる。2名体制「A・B」は2件にする
  const addHelpToPatterns = async (label, time, byDay) => {
    const lb = String(label || "").trim(), tm = String(time || "").trim();
    const next = { ...(allPatterns || {}) };
    const u = userFromLabel(master, lb);
    let added = 0;
    for (const [wdS, names] of Object.entries(byDay || {})) {
      const wd = Number(wdS);
      const p = next[wd] || (await sGet(`pattern:${wd}`)) || { runs: [], blocks: [], training: "" };
      if ((p.blocks || []).some((b) => b.kind === "help" && String(b.label || "").trim() === lb && toMin(b.time) === toMin(tm))) continue;
      const add = String(names || "").split("・").map((x) => x.trim()).filter(Boolean).map((nm) => {
        const s = master.staff.find((x) => x.name === nm);
        return { id: uid(), kind: "help", time: tm, staffId: s ? s.id : HOLD_ID, label: lb, vehicleId: "", userIds: u ? [u.id] : [] };
      });
      if (!add.length) continue;
      added += add.length;
      const np = { runs: [], training: "", ...p, blocks: [...(p.blocks || []), ...add] };
      next[wd] = np;
      await sSet(`pattern:${wd}`, np);
      if (wd === weekday) setPattern(np);
    }
    setAllPatterns(next);
    return added;
  };

  const deleteHelpFromPatterns = async (label, time) => {
    const lb = String(label || "").trim(), tm = String(time || "").trim();
    const next = { ...(allPatterns || {}) };
    let removed = 0;
    for (const wd of DAY_ORDER) {
      const p = next[wd];
      if (!p) continue;
      const before = (p.blocks || []).length;
      const blocks = (p.blocks || []).filter((b) => !(b.kind === "help" && String(canonHelpLabel(b.label) || "").trim() === String(canonHelpLabel(lb) || "").trim() && String(b.time || "").trim() === tm));
      if (blocks.length === before) continue;
      removed += before - blocks.length;
      const np = { ...p, blocks };
      next[wd] = np;
      await sSet(`pattern:${wd}`, np);
      if (Number(wd) === weekday) setPattern(np);
    }
    setAllPatterns(next);
    return removed;
  };

  // ---- マスタExcel(職員・利用者・車両・週間パターン)の出力/取込 ----
  const exportMasterExcel = async () => {
    if (!master) return;
    try {
      await flushSaves();
      const patterns = {};
      for (const wd of DAY_ORDER) {
        const p = await sGet(`pattern:${wd}`);
        if (p && ((p.runs || []).length || (p.blocks || []).length)) patterns[wd] = p;
      }
      const ExcelJS = await loadExcelJS();
      const wb = buildMasterWorkbook(ExcelJS, master, patterns);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `送迎マスタ_${todayStr()}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      notify(`マスタExcelを出力しました(部署${master.departments.length}・職員${master.staff.length}名・利用者${master.users.length}名・車${master.vehicles.length}台・パターン${Object.keys(patterns).length}曜日・ヘルプ表・ルール)`);
    } catch (e) {
      console.error(e);
      notify("マスタExcelの出力に失敗しました", "error");
    }
  };

  const importMasterExcel = async (file) => {
    if (!file || !master) return;
    try {
      const XLSX = await new Promise((resolve, reject) => {
        if (window.XLSX) return resolve(window.XLSX);
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => reject(new Error("XLSX load failed"));
        document.head.appendChild(s);
      });
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const names = wb.SheetNames.map((n) => String(n).trim());
      if (![MS_STAFF, MS_USER, MS_VEH, MS_PAT, MS_RULE, MS_DEPT, MS_HELP].some((n) => names.includes(n))) {
        notify("このファイルにはマスタのシート(部署・職員・利用者・車両・週間パターン・ヘルプ表・ルール)がありません", "error");
        return;
      }
      const res = parseMasterWorkbook(XLSX, wb, master);
      const msg = `次の内容で取り込みます。よろしいですか?\n\n${res.log.join("\n")}\n\n` +
        `※ Excelに無い部署・職員・利用者・車両は消さずに残します\n※ 週間パターンはExcelにある曜日だけ丸ごと置き換えます\n※ ヘルプ表とルールはExcelの内容で丸ごと置き換えます`;
      if (!(await ask(msg))) return;
      await sSet("master", res.master);
      setMaster(res.master);
      for (const wd of Object.keys(res.patterns)) {
        const prev = (await sGet(`pattern:${wd}`)) || {};
        // 乗車なし・利用時間など、パターンに付いている他の情報は残す
        const next = { ...prev, ...res.patterns[wd] };
        await sSet(`pattern:${wd}`, next);
        if (Number(wd) === weekday) setPattern(next);
      }
      notify(`マスタExcelを取り込みました(${res.log.join(" / ")})`);
    } catch (e) {
      console.error(e);
      notify("マスタExcelの取り込みに失敗しました。出力したファイルの列名を変えていないか確認してください", "error");
    }
  };

  const handleExport = async () => {
    if (!sheet || !sheetMaster) return;
    const sheetData = { staffOv: {}, userAbsent: {}, userDept: {}, notes: "", contact: "", ...sheet, blocks: canonHelpBlocks((sheet && sheet.blocks) || []),
      noRide: { ...noRideDefaults(sheetMaster, weekdayOf(date)), ...((sheet && sheet.noRide) || {}) } };
    const wd = weekdayOf(date);
    // 保留件数(担当未定+担当者が表にいない予定)を出力時と同じ基準で数える
    const known = new Set(sheetMaster.staff.map((s) => s.id));
    const ovv = sheetData.staffOv || {};
    const working = new Set(
      sheetMaster.staff.filter((s) => !(s.offDays || []).includes(wd) || !!(ovv[s.id] || {}).workToday).map((s) => s.id)
    );
    const isHold = (sid) => sid !== REQ_ID && (sid === HOLD_ID || !known.has(sid) || !working.has(sid));
    const holdCount =
      sheetData.runs.filter((r) => isHold(r.staffId)).length + sheetData.blocks.filter((b) => isHold(b.staffId)).length;
    // 送迎漏れ(利用予定日なのに迎え・送りが未入力)
    const absent = sheetData.userAbsent || {};
    const scheduled = sheetMaster.users.filter((u) => (u.days || []).includes(wd) && !absent[u.id]);
    const inRuns = (kind) => {
      const set = new Set();
      sheetData.runs.forEach((r) => {
        r.userIds.forEach((id) => { if (rideIs(rideKindOf(r, id), kind)) set.add(id); });
      });
      return set;
    };
    const meetSet = inRuns("meet"), sendSet = inRuns("send");
    const noRideChk = sheetData.noRide || {};
    const missMeet = scheduled.filter((u) => !meetSet.has(u.id) && !(noRideChk[u.id] || {}).meet).map((u) => u.name);
    const missSend = scheduled.filter((u) => !sendSet.has(u.id) && !(noRideChk[u.id] || {}).send).map((u) => u.name);

    // ヘルプ表で決めた基本の担当と違うものを最終確認用に一覧化
    const helpDiffList = helpBaseWarn(sheetMaster, sheetData, wd);

    // 送迎なし(受診後来所・家族送迎など)の人を最終確認用に一覧化
    const noRideList = [];
    scheduled.forEach((u) => {
      const nrU = noRideChk[u.id] || {};
      const txt = (k) => (typeof nrU[k] === "string" && nrU[k] ? nrU[k] : "送迎なし");
      // いつもどおり(利用者タブの家族送り・家族迎えと同じ)なら確認しない
      // いつもが家族送迎(家族送り・家族迎え・母迎えなど)の人に、家族系の理由(家族送・家族迎・母迎え…)が付いていれば
      // 文言が少し違ってもいつもどおりとみなす。受診後来所など家族以外の理由は確認に出す
      const isUsual = (k) => { const f = familyDefaultOf(u, k, wd); const r0 = txt(k); return !!f && (normPlace(r0) === normPlace(f) || isFamilyPlace(r0)); };
      const nm = nrU.meet && !isUsual("meet"), ns = nrU.send && !isUsual("send");
      if (nm && ns) noRideList.push(`${u.name}: 迎え・送りとも入れていません(${txt("meet")} / ${txt("send")})`);
      else if (nm) noRideList.push(`${u.name}: 迎えを入れていません(${txt("meet")})`);
      else if (ns) noRideList.push(`${u.name}: 送りを入れていません(${txt("send")})`);
    });

    // 迎え先・送り先がいつもと違う人を最終確認用に一覧化
    const placeList = [];
    (sheetData.runs || []).forEach((r) => {
      if (r.kind !== "meet" && r.kind !== "send") return;
      const k2 = r.kind === "send" ? "send" : "meet";
      placeChangesOf(r).forEach((x) => {
        const u = sheetMaster.users.find((y) => y.id === x.id);
        if (!u || familyDefaultOf(u, k2, wd)) return;
        placeList.push(`${u.name}: ${k2 === "send" ? "送り" : "迎え"}先が「${x.place}」になっています(いつもは${defPlaceOf(u, k2, wd)}) — ${r.time}の便`);
      });
    });

    // いつもは家族送り・家族迎え(送迎なし)なのに、便に入っている人
    scheduled.forEach((u) => {
      ["meet", "send"].forEach((k) => {
        const fam = familyDefaultOf(u, k, wd);
        if (!fam) return;
        const r = (sheetData.runs || []).find((x) => x.kind === k && (x.userIds || []).includes(u.id));
        if (!r) return;
        const pl = normPlace((r.places || {})[u.id]);
        placeList.push(`${u.name}: いつもは${fam}ですが、${r.time}の${k === "send" ? "送り" : "迎え"}便に入っています${pl ? `(行き先: ${pl})` : ""}`);
      });
    });

    // 通常外のヘルプ・その他予定: 欄と送迎表を両方向で突き合わせる
    const extraList = [];
    {
      const patDay = await sGet(`pattern:${wd}`);
      const xc = extraHelpCheck(sheetMaster, sheetData, wd, patDay);
      xc.missing.forEach((e) => extraList.push(`${extraHelpLabel(sheetMaster, e)}: 通常外の欄にありますが、送迎表に入っていません`));
      xc.unlisted.forEach((h) => {
        extraList.push(`${EXTRA_KIND_JP[h.kind]} ${h.time} ${h.label}(担当: ${extraStaffOf(sheetMaster, sheetData.blocks, h)}): 週間パターンに無い通常外の${EXTRA_KIND_JP[h.kind]}ですが、通常外の欄に書かれていません`);
      });
    }

    // その他のルール(チェックを入れたもの)を出力前の確認に出す
    const otherRuleList = (rulesOf(sheetMaster).otherRules || [])
      .filter((x) => x && String(x.text || "").trim() && x.check !== false && (!(x.days || []).length || (x.days || []).includes(wd)))
      .map((x) => String(x.text).trim());

    // ==== 出力前チェック: エラーを種類ごとに集め、段階的に確認するモーダルへ ====
    const critical = [], vehErr = [], timeErr = [], otherErr = [];
    sheetData.runs.forEach((r) => {
      const ws2 = runWarnings(r, sheetMaster, sheetData, wd).filter((w) => w !== "担当未定(保留)");
      const stf = sheetMaster.staff.find((s) => s.id === r.staffId);
      const pre = `${stf ? stf.name : "保留"} ${r.time}【${RUN_KINDS[r.kind] || "予定"}】: `;
      ws2.forEach((w) => {
        if (/🚫/.test(w)) critical.push(pre + w);
        else if (/定員|車いす|車両|車が|車は/.test(w)) vehErr.push(pre + w);
        else if (/勤務時間外|固定休|休み|時間帯|重複/.test(w)) timeErr.push(pre + w);
        else otherErr.push(pre + w);
      });
    });
    if (holdCount) critical.push(`保留(担当未定)の予定が ${holdCount} 件残っています`);
    [...requiredHelpWarn(sheetMaster, sheetData, wd), ...fixedBlockWarn(sheetMaster, sheetData, wd), ...blockOverlapWarn(sheetMaster, sheetData), ...helpTwoShortages(sheetMaster, sheetData, wd), ...kubotaPlacementWarn(sheetMaster, sheetData, wd), ...maleOnlyHelpWarn(sheetMaster, sheetData), ...pikaStaffWarn(sheetMaster, sheetData, wd)].forEach((w) => critical.push(w));

    const rideMiss = [];
    if (missMeet.length) rideMiss.push(`迎えが未入力(${missMeet.length}名): ${missMeet.join("・")}`);
    if (missSend.length) rideMiss.push(`送りが未入力(${missSend.length}名): ${missSend.join("・")}`);

    // 男性不在(許容超)・職員数の区間チェック
    const maleErr = [];
    {
      const hours2 = [];
      for (let t2 = 8 * 60; t2 <= 18 * 60; t2 += SLOT) hours2.push(t2);
      const calc2 = buildCoverageCalc(sheetMaster, sheetData, wd, hours2);
      const gs2 = maleGapStatus(sheetMaster, calc2);
      const rangeText = (list) => {
        const out2 = [];
        let st2 = null, prev = null;
        list.forEach((t2) => {
          if (st2 == null) { st2 = t2; prev = t2; return; }
          if (t2 === prev + SLOT) { prev = t2; return; }
          out2.push([st2, prev + SLOT]); st2 = t2; prev = t2;
        });
        if (st2 != null) out2.push([st2, prev + SLOT]);
        return out2.map(([a, b2]) => `${toStr(a)}〜${toStr(b2)}`).join("、");
      };
      sheetMaster.departments.forEach((d) => {
        const overs = hours2.filter((t2) => (gs2[d.id] || {})[t2] === "over");
        if (overs.length) maleErr.push(`${d.name}: 男性職員不在が許容時間を超える区間 → ${rangeText(overs)}`);
        const tol = d.staffMin != null && d.staffMin !== "";
        if (tol) {
          const unders = hours2.filter((t2) => { const cc = (calc2.find((c) => c.t === t2) || {}).cnt; const v = cc && cc[d.id]; return v && v.u > 0 && v.s < Number(d.staffMin); });
          if (unders.length) maleErr.push(`${d.name}: 在席職員が最低${d.staffMin}名を下回る区間 → ${rangeText(unders)}`);
        }
        if (d.staffMax != null && d.staffMax !== "") {
          const overs2 = hours2.filter((t2) => { const cc = (calc2.find((c) => c.t === t2) || {}).cnt; const v = cc && cc[d.id]; return v && v.s > Number(d.staffMax); });
          if (overs2.length) maleErr.push(`${d.name}: 職員が上限${d.staffMax}名(駐車制約)を超える区間 → ${rangeText(overs2)}`);
        }
      });
    }

    const groups = [];
    const addG = (icon, title, items, advice) => { if (items.length) groups.push({ icon, title, items, advice }); };
    addG("🚫", "重大エラー(修正を強くお勧め)", critical, "保留・体制の不備は表の信頼性に直結します。⚙自動割当かAI調整で解消できます");
    addG("👥", "乗せ忘れ(未割当)", rideMiss, "未割当パネルからドラッグするか、名前をクリックしてAIに割り当てさせてください");
    addG("🧑\u200d🤝\u200d🧑", "ヘルプの担当が基本と違う(最終確認)", helpDiffList, "ヘルプ表で決めた「この曜日はこの人」と違う担当になっています。代わりで良ければそのまま進めてください");
    addG("🆘", "通常外のヘルプ・その他予定の確認", extraList, "画面下の「通常外のヘルプ・その他予定」欄と、送迎表に入っている予定が合っていません。入れ忘れ・書き忘れがないか確認してください");
    addG("🏥", "送迎なしの人の最終確認", noRideList, "受診後来所・家族送迎などで送迎を入れていない人です。本当にこの扱いでよいか確認してください");
    addG("🏠", "いつもと違う送り先・迎え先(最終確認)", placeList, "利用者タブの「いつもの迎え先・送り先」(自宅・ﾘﾍﾞ・家族送り・家族迎えなど)と違っています。この内容で合っていれば、そのまま進めてください");
    addG("🚗", "車両のエラー(定員・重複・位置)", vehErr, "🚗使える車パネルで空き車を確認して差し替えてください");
    addG("⏰", "時間のエラー(勤務時間外・重複)", timeErr, "職員名クリックで勤務時間の確認、または担当の変更を");
    addG("🚻", "男性不在・職員数の区間", maleErr, "人数・男性カバー表で該当時間帯の色を確認してください");
    addG("📋", "その他の警告", otherErr, "");
    addG("📌", "その他のルール(確認)", otherRuleList, "ルールタブ「⑨ その他のルール」で確認を求めている決まりごとです。守れていればそのまま進めてください");

    if (!groups.length) {
      notify("✓ チェックOK(エラーなし)。Excelを出力します");
      exportExcel(sheetMaster, sheetData, date);
      return;
    }
    setModal({ type: "exportCheck", groups, idx: 0 });
  };

  // 自動割当ウィザードの回答をシートに反映してから実行
  const runAutoAssignNow = () => {
    setSheet((cur) => {
      const dfg = { staffOv: {}, userAbsent: {}, userDept: {}, notes: "", noRide: {}, userTime: {}, ...cur,
        noRide: { ...noRideDefaults(sheetMaster, weekdayOf(date)), ...((cur && cur.noRide) || {}) } };
      const res = autoAssignSheet(sheetMaster, dfg, weekdayOf(date));
      const next = { ...cur, runs: res.runs, blocks: res.blocks };
      // 自動割当は変更が大きいので必ず履歴に積む(丸ごと取り消せるようにする)
      if (cur) {
        const h = histRef.current.sheet;
        h.past.push(cur);
        if (h.past.length > HIST_MAX) h.past.shift();
        h.future = [];
        setHistTick((v) => v + 1);
      }
      scheduleSave(`sheet:${date}`, next);
      setTimeout(() => setModal({ type: "autoAssign", actions: res.actions, unresolved: res.unresolved }), 0);
      return next;
    });
  };
  const applyWizardAndRun = (wiz) => {
    if (!sheet) return;
    updateSheet((prev) => {
      let runs = [...(prev.runs || [])];
      let blocks = [...(prev.blocks || [])];
      const staffOv = { ...(prev.staffOv || {}) };
      const offSet = new Set(wiz.offStaff);
      wiz.offStaff.forEach((sid) => { staffOv[sid] = { ...(staffOv[sid] || {}), off: true }; });
      wiz.timeStaff.forEach((x) => { if (x.start || x.end) staffOv[x.id] = { ...(staffOv[x.id] || {}), off: false, start: x.start, end: x.end }; });
      const userAbsent = { ...(prev.userAbsent || {}) };
      wiz.absentUsers.forEach((uid) => { userAbsent[uid] = true; });
      const userTime = { ...(prev.userTime || {}) };
      wiz.meetChanges.forEach((x) => { if (x.time) userTime[x.id] = { ...(userTime[x.id] || {}), meet: x.time }; });
      wiz.sendChanges.forEach((x) => { if (x.time) userTime[x.id] = { ...(userTime[x.id] || {}), send: x.time }; });
      // 休みの職員の便・ヘルプは保留化(自動割当が代役を入れる)
      runs = runs.map((r) => (offSet.has(r.staffId) ? { ...r, staffId: HOLD_ID } : r));
      blocks = blocks.map((b) => (offSet.has(b.staffId) ? { ...b, staffId: HOLD_ID } : b));
      // 時間変更で勤務外になった予定も保留化
      wiz.timeStaff.forEach((x) => {
        const st = toMin(x.start), en = toMin(x.end);
        const out = (t0, dur) => (st != null && t0 < st) || (en != null && t0 + dur > en);
        runs = runs.map((r) => (r.staffId === x.id && out(toMin(r.time), 30) ? { ...r, staffId: HOLD_ID } : r));
        blocks = blocks.map((b) => (b.staffId === x.id && out(toMin(b.time), 30) ? { ...b, staffId: HOLD_ID } : b));
      });
      // 欠席の利用者は全便から除去
      const absSet = new Set(wiz.absentUsers);
      if (absSet.size) runs = runs.map((r) => ({ ...r, userIds: (r.userIds || []).filter((id) => !absSet.has(id)), trainUserIds: (r.trainUserIds || []).filter((id) => !absSet.has(id)), trainBothIds: (r.trainBothIds || []).filter((id) => !absSet.has(id)), trainDropIds: (r.trainDropIds || []).filter((id) => !absSet.has(id)) }));
      // その他の予定を予定チップとして書き込み(自動割当はこの時間帯を避けて割り当てる)
      (wiz.otherPlans || []).forEach((x) => {
        if (!x.label || !x.time) return;
        // 入浴・ヘルプは種別「ヘルプ」で登録(入浴対応はヘルプ扱い)
        const kind2 = /入浴|ヘルプ/.test(x.label) ? "help" : "block";
        blocks.push({ id: uid(), kind: kind2, time: toStr(toMin(x.time)), staffId: x.id, label: x.label });
      });
      // 迎え/送りの時間変更者は該当種別の便からいったん外す(自動割当が新しい時刻の便に入れ直す)
      const meetSet = new Set(wiz.meetChanges.filter((x) => x.time).map((x) => x.id));
      const sendSet = new Set(wiz.sendChanges.filter((x) => x.time).map((x) => x.id));
      runs = runs.map((r) => {
        if (r.mode === "train") return r;
        if (r.kind === "meet" && meetSet.size) return { ...r, userIds: (r.userIds || []).filter((id) => !meetSet.has(id)) };
        if (r.kind === "send" && sendSet.size) return { ...r, userIds: (r.userIds || []).filter((id) => !sendSet.has(id)) };
        return r;
      });
      return { ...prev, runs, blocks, staffOv, userAbsent, userTime };
    });
    setModal(null);
    setTimeout(runAutoAssignNow, 400);
  };

  // 段階チェックを通過(または承知)した後の実出力
  const doExportNow = () => {
    if (!sheet) return;
    const sheetData = { staffOv: {}, userAbsent: {}, userDept: {}, notes: "", contact: "", ...sheet, blocks: canonHelpBlocks((sheet && sheet.blocks) || []),
      noRide: { ...noRideDefaults(sheetMaster, weekdayOf(date)), ...((sheet && sheet.noRide) || {}) } };
    exportExcel(sheetMaster, sheetData, date);
  };

  const countStaffItems = (staffId) =>
    sheet ? sheet.runs.filter((r) => r.staffId === staffId).length + sheet.blocks.filter((b) => b.staffId === staffId).length : 0;

  const moveStaffItemsToHold = (staffId) =>
    updateSheet((prev) => ({
      ...prev,
      runs: prev.runs.map((r) => (r.staffId === staffId ? { ...r, staffId: HOLD_ID } : r)),
      blocks: prev.blocks.map((b) => (b.staffId === staffId ? { ...b, staffId: HOLD_ID } : b)),
    }));

  const toggleOff = async (s) => {
    if (!sheet) return;
    const ov = (sheet.staffOv || {})[s.id] || {};
    const nowOff = !ov.off;
    let moveHold = false;
    if (nowOff) {
      const cnt = countStaffItems(s.id);
      if (cnt > 0) moveHold = await ask(`${s.name}を休みにします。担当していた${cnt}件の予定を「保留」列へ移しますか?\n(キャンセル=予定はそのまま残す)`);
    }
    updateSheet((prev) => ({
      ...prev,
      runs: moveHold ? prev.runs.map((r) => (r.staffId === s.id ? { ...r, staffId: HOLD_ID } : r)) : prev.runs,
      blocks: moveHold ? prev.blocks.map((b) => (b.staffId === s.id ? { ...b, staffId: HOLD_ID } : b)) : prev.blocks,
      staffOv: { ...(prev.staffOv || {}), [s.id]: { ...ov, off: nowOff } },
    }));
  };

  const tabs = [
    ["sheet", "送迎表(日別)"],
    ["vehmove", "車両の動き"],
    ["sim3d", "🚌 3Dマップ"],
    ["pattern", "週間パターン"],
    ["staff", "職員"],
    ["vehicles", "車両"],
    ["users", "利用者"],
    ["depts", "部署"],
    ["helpboard", "ヘルプ表"],
    ["rules", "ルール"],
  ];

  if (!master) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center text-stone-500 font-sans">
        読み込み中…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 font-sans text-stone-800 pb-10">
      <div className="bg-white border-b border-stone-300 sticky top-0 z-40">
        <div className="px-3 pt-2 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-black tracking-wide">送迎表</span>
            {/* どちらの版を見ているかを常に表示。データは版ごとに完全に分かれている */}
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded border self-end mb-0.5 ${EDITION_COLOR}`}
              title={`この版のデータは他の版とは完全に分かれています(保存領域: ${NS || "既定"})`}>
              {EDITION_LABEL}<span className="font-normal ml-1 opacity-70">{EDITION_NOTE}</span>
            </span>
            <EditionSwitcher />
            <span className="text-[10px] text-stone-400 font-normal self-end mb-0.5" title="アプリの版数。サポート時にお伝えください">{`v${SEED_VERSION}`}</span>
            <button className="text-[10px] px-1.5 py-0.5 rounded border border-stone-300 text-stone-500 hover:bg-stone-50 self-end mb-0.5"
              title="全データ(マスタ・週間パターン・日別送迎表・リベCSV)を1つのファイルに保存します。アプリを新しい版に乗り換える前に押してください"
              onClick={async () => {
                try {
                  const obj = await exportAllData();
                  const json = JSON.stringify(obj);
                  // ダウンロードを試みる(環境によってはブロックされるため、モーダルでコピー手段も出す)
                  try {
                    const blob = new Blob([json], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `送迎表データ_${new Date().toISOString().slice(0, 10)}.json`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
                  } catch (e2) {}
                  setModal({ type: "backup", json, keys: obj.keys });
                } catch (e) { notify("バックアップに失敗: " + String((e && e.message) || e), "warn"); }
              }}>💾 バックアップ</button>
            <label className="text-[10px] px-1.5 py-0.5 rounded border border-stone-300 text-stone-500 hover:bg-stone-50 self-end mb-0.5 cursor-pointer"
              title="バックアップファイル(.json)から全データを復元します。現在のデータは上書きされます">
              📂 復元
              <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                const f = e.target.files && e.target.files[0];
                e.target.value = "";
                if (!f) return;
                if (!(await ask("バックアップからデータを復元します。この画面の現在のデータ(同じ項目)は上書きされます。よろしいですか?"))) return;
                try {
                  const obj = JSON.parse(await f.text());
                  const n = await importAllData(obj);
                  notify(`${n}件のデータを復元し、全員に共有しました。画面を再読み込みします…`);
                  setTimeout(() => { try { window.location.reload(); } catch (e2) {} }, 1200);
                } catch (e3) { notify("復元に失敗: " + String((e3 && e3.message) || e3), "warn"); }
              }} />
            </label>
            <span className="text-xs text-stone-400">4部署共有</span>
          </div>
          <div className="text-xs flex items-center gap-2 flex-wrap">
            <CalBadge master={master} sheet={sheet} calEvents={calEvents} date={date} />
            <SyncBadge />
          </div>
        </div>
        <div className="px-3 flex gap-1 overflow-x-auto">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-sm font-semibold border-b-2 whitespace-nowrap ${
                tab === k ? "border-sky-600 text-sky-700" : "border-transparent text-stone-500 hover:text-stone-700"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 max-w-full">
        {/* ---------- 日別送迎表 ---------- */}
        {tab === "sheet" && (
          <div className="flex items-start gap-3">
            {/* 左:送迎表本体 */}
            <div className="flex-1 min-w-0">
            {/* 操作バー(1行) */}
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              <button className={`${btnSec} px-2`} onClick={() => setDate(todayStr())} title="今日に移動">今日</button>
              <button className={`${btnSec} px-2`} onClick={() => shiftDate(-1)} title="前日">←</button>
              <DatePop date={date} setDate={setDate} />
              <button className={`${btnSec} px-2`} onClick={() => shiftDate(1)} title="翌日">→</button>
              <span className="inline-flex items-center gap-0.5 mr-1 pl-1 border-l border-stone-300">
                <button
                  className={`${btnSec} px-2 ${canUndo() ? "" : "opacity-30 cursor-not-allowed"}`}
                  disabled={!canUndo()}
                  onClick={doUndo}
                  title="直前の編集を取り消します (Ctrl+Z)">↶ 戻る</button>
                <button
                  className={`${btnSec} px-2 ${canRedo() ? "" : "opacity-30 cursor-not-allowed"}`}
                  disabled={!canRedo()}
                  onClick={doRedo}
                  title="取り消した編集をやり直します (Ctrl+Y / Ctrl+Shift+Z)">↷ 進む</button>
              </span>
              <button className={btnSec} onClick={loadFromPattern} title="この曜日の週間パターンを読み込んで、今の表を置き換えます">パターンから読込</button>
              <button className={btnSec} onClick={saveToPattern} title="今表示している日の内容を、この曜日の週間パターンとして保存します(その日限りの休み・時間変更は含みません)">パターンに保存</button>
              <button className={btnSec} onClick={() => setModal({ type: "importDay" })} title="この日の送迎表だけをExcelから直接取り込みます(週間パターンは変更しません)">📥 Excel取込</button>
              <button className={btnSec} onClick={handleExport}>📄 Excel出力</button>
              <button className={btnPri} onClick={() => {
                if (!sheet) { notify("先に送迎表を作成してください(パターンから読込)", "warn"); return; }
                setModal({ type: "autoWizard", step: 0, offStaff: [], timeStaff: [], absentUsers: [], meetChanges: [], sendChanges: [], otherPlans: [] });
              }} title="今日の休み・時間変更を1つずつ確認してから、保留と未割当を制約チェック付きで確実に割り当てます">⚙ 自動割当</button>
              <button className={show3d ? btnPri : btnSec} onClick={() => setShow3d((v) => !v)} title="送迎表を編集しながら3Dマップを右下に並べて表示します">🚌 3D並列{show3d ? "ON" : ""}</button>
              {aiApiOn() && <button className={btnSec} onClick={() => setModal({ type: "aiAdjust" })} title="当日の欠席・送迎なし・職員の休みを踏まえて、AIが便の組み替え案を作ります">🤖 AI調整</button>}
              {aiApiOn() && <button className={btnSec} onClick={() => setModal({ type: "agent" })} title="AIと会話しながら、送迎表・利用者の利用曜日・入浴の曜日や時刻・ルールを変えます。反映するまで何も変わりません">💬 AIと相談</button>}
              {claudeProps.enabled && claudeProps.list.length > 0 && <button className="bg-amber-100 border border-amber-400 hover:bg-amber-200 text-amber-900 text-sm font-semibold px-3 py-2 rounded-md" onClick={() => { claudeProps.load(); setModal({ type: "claudeProps" }); }} title="Claudeアプリで相談して作った組み替え案を確認して反映します">🤖 Claudeの案 {claudeProps.list.length}</button>}
              <button className={btnPri} onClick={quickLibCsv} title="エクスポートツール実行後に押すだけ: クリップボードのCSVを取り込み、この日のリベ迎・リベ送を自動で振り分けます">📋🚌 リベCSV取込→振り分け</button>
              <button className={btnSec} onClick={() => setModal({ type: "libCsv" })} title="CSVの取込状況の確認・ファイルからの取込・振り分けのやり直し">🚌 詳細</button>
              <button className={btnSec} onClick={() => handleMonthly("count")} title="表示中の月の送迎有無を集計(訓練送迎は数えません)">📊 月次集計</button>
              <button className={btnSec} onClick={() => handleMonthly("time")} title="表示中の月の利用時間(乗った便の時刻)を一覧化">🕐 時間実績</button>
              <div className="inline-flex items-center gap-1">
                <div className="relative inline-flex items-center">
                  <input ref={searchRef} value={searchQ}
                    onChange={(e) => { setSearchQ(e.target.value); setSearchIdx(0); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); searchJump(e.shiftKey ? -1 : 1); }
                      if (e.key === "ArrowDown") { e.preventDefault(); searchJump(1); }
                      if (e.key === "ArrowUp") { e.preventDefault(); searchJump(-1); }
                    }}
                    className="border border-stone-300 rounded-lg px-2 py-1.5 text-sm w-44 focus:border-sky-500 outline-none"
                    placeholder="🔍 検索(Ctrl+F)" />
                  {searchQ && (
                    <button className="absolute right-1 text-stone-400 hover:text-stone-600 text-sm px-1" onClick={() => setSearchQ("")} title="クリア(Esc)">✕</button>
                  )}
                </div>
                {searchQ && (
                  <>
                    <span className="text-xs text-stone-500 whitespace-nowrap">{searchHits.length ? `${((searchIdx % searchHits.length) + searchHits.length) % searchHits.length + 1}/${searchHits.length}` : "0件"}</span>
                    <button className="px-1.5 py-1 rounded border border-stone-300 text-sm hover:bg-stone-100" onClick={() => searchJump(-1)} title="前へ(Shift+Enter / ↑)">◀</button>
                    <button className="px-1.5 py-1 rounded border border-stone-300 text-sm hover:bg-stone-100" onClick={() => searchJump(1)} title="次へ(Enter / ↓)">▶</button>
                  </>
                )}
              </div>
              {master.staff.some((s) => (s.offDays || []).includes(weekdayOf(date))) && (
                <button className={btnSec} onClick={() => sheet && setModal({ type: "holiday" })}>➕ 休日出勤</button>
              )}
              {!sidePanel && (
                <button className={btnSec} onClick={() => setSidePanel(true)}>📋 未割当パネル</button>
              )}
            </div>

            {!sheet ? (
              <div className="text-stone-500 text-sm p-6 text-center">読み込み中…</div>
            ) : (
              <>
                {!sheetExists && sheet.runs.length === 0 && sheet.blocks.length === 0 && (
                  <div className="bg-sky-50 border border-sky-200 text-sky-900 text-sm rounded-lg p-3 mb-3">
                    この日の送迎表はまだありません。「パターンから読込」で{DAYS[weekdayOf(date)]}曜日の固定パターンを取り込むか、表のマスをクリックして直接追加してください。
                  </div>
                )}
                <div className="text-xs text-stone-500 mb-1">
                  💡 予定・利用者名・車両はマウスでつかんでドラッグできます(予定→別のマスへ移動、利用者→別の便へ、車両→便に落として交換)
                </div>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-xs text-stone-500">表示:</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer select-none ${deptFilter === "all" ? "bg-stone-700 text-white border-stone-700 font-bold" : "bg-white border-stone-300 hover:bg-stone-100"}`} onClick={() => setDeptFilter("all")}>全部署</span>
                  {master.departments.map((dpt, di) => {
                    const c2 = (DEPT_COLORS[di % DEPT_COLORS.length] || DEPT_COLORS[0]);
                    const on2 = deptFilter === dpt.id;
                    return (
                      <span key={dpt.id} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer select-none ${c2.chip} ${on2 ? "ring-2 ring-stone-700 font-bold" : "opacity-80 hover:opacity-100"}`} onClick={() => setDeptFilter(on2 ? "all" : dpt.id)}>{dpt.name}</span>
                    );
                  })}
                </div>
                <TimeGrid
                  searchQ={searchQ}
                  activeSearchId={activeSearchId}
                  onHoverTime={setGridHoverTime}
                  master={sheetMaster}
                  data={dataForGrid}
                  deptFilter={deptFilter}
                  weekday={weekdayOf(date)}
                  sheetMode={true}
                  gridHeight={panelsOpen ? "52vh" : "calc(100vh - 220px)"}
                  onCell={(staffId, time) => setModal({ type: "item", initial: { staffId, time } })}
                  onItem={({ target, item }) => setModal({ type: "item", initial: { ...item }, editTarget: target })}
                  onStaff={(s) => setModal({ type: "staffOv", staffId: s.id })}
                  onToggleOff={toggleOff}
                  onMoveItem={moveItem}
                  onRemoveRider={(runId, riderId) =>
                    curUpdate((prev) => ({
                      ...prev,
                      runs: (prev.runs || []).map((r) => (r.id === runId ? { ...r, staffRiderIds: (r.staffRiderIds || []).filter((x) => x !== riderId) } : r)),
                    }))
                  }
                onSetOrder={(updates) =>
                    curUpdate((prev) => {
                      const apply = (arr) => arr.map((x) => { const u = updates.find((v) => v.id === x.id); return u ? { ...x, ord: u.ord } : x; });
                      return { ...prev, runs: apply(prev.runs || []), blocks: apply(prev.blocks || []) };
                    })
                  }
                  onDeleteItem={({ target, item }) => {
                    // 右クリックからの削除は確認なしで即実行
                    curUpdate((prev) => ({ ...prev, [target]: prev[target].filter((x) => x.id !== item.id) }));
                  }}
                  onDropUserOnRun={dropUserOnRun}
                  onDropUserOnCell={dropUserOnCell}
                  onDropVehicleOnRun={dropVehicleOnRun}
                  onDropVehicleOnCell={dropVehicleOnCell}
                />

                {sheet && !isPattern && sheetMaster && (
                  <ExtraHelpPanel master={sheetMaster} sheet={sheet} wd={weekdayOf(date)} patternForDay={dayPattern}
                    onChange={(list) => updateSheet((prev) => ({ ...prev, extraHelps: list }))} />
                )}

                <div className="mt-2">
                  <button
                    className="text-xs text-stone-600 hover:text-stone-900 border border-stone-300 rounded px-3 py-1.5 bg-white"
                    onClick={() => setPanelsOpen((v) => !v)}>
                    {panelsOpen ? "▲ 特記事項・男性カバー・配車を隠す" : "▼ 特記事項・男性カバー・配車を表示"}
                  </button>
                </div>

                {panelsOpen && (() => {
                  const { userNotes, bizNotes } = buildAutoNotes(sheetMaster, sheet.blocks || []);
                  return (
                  <div className="bg-white border border-stone-300 rounded-lg p-3 mt-3">
                    <div className="font-bold text-stone-700 text-sm mb-2">特記事項(利用者)</div>
                    <textarea className={`${inputCls} h-16`} value={sheet.notes}
                      onChange={(e) => updateSheet((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="利用者に関する手入力の特記事項(例:朝移動支援休み)。Excelの右側「特記事項(利用者)」に印字されます。" />
                    <div className="font-bold text-stone-700 text-sm mb-1 mt-2">特記事項(職員)</div>
                    <textarea className={`${inputCls} h-14`} value={sheet.notesStaff || ""}
                      onChange={(e) => updateSheet((prev) => ({ ...prev, notesStaff: e.target.value }))}
                      placeholder="職員に関する手入力の特記事項(例:研修・面談・会議)。Excelの職員段「特記事項(職員)」欄に印字されます。" />
                    {userNotes.length > 0 && (
                      <div className="mt-1.5 bg-yellow-50 border border-yellow-200 rounded p-2">
                        <div className="text-[11px] font-bold text-yellow-800 mb-0.5">📋 送迎表から自動(利用者に関する予定)</div>
                        <div className="text-xs text-stone-700 space-y-0.5">
                          {userNotes.map((n, i) => <div key={i}>{n}</div>)}
                        </div>
                      </div>
                    )}
                    <div className="font-bold text-stone-700 text-sm mb-2 mt-3">連絡事項</div>
                    <textarea className={`${inputCls} h-16`} value={sheet.contact}
                      onChange={(e) => updateSheet((prev) => ({ ...prev, contact: e.target.value }))}
                      placeholder="手入力の連絡事項(例:早川 10:30〜東部)。送迎表の受入・開錠・透析等は下に自動表示されます。" />
                    <div className="font-bold text-stone-700 text-sm mb-2 mt-3">訓練</div>
                    <textarea className={`${inputCls} h-16`} value={sheet.training || ""}
                      onChange={(e) => updateSheet((prev) => ({ ...prev, training: e.target.value }))}
                      placeholder="訓練の予定を1行ずつ(例:早川 10:30〜(東部))。Excelでは連絡事項の隣の「訓練」枠に出ます。" />
                    {bizNotes.length > 0 && (
                      <div className="mt-1.5 bg-sky-50 border border-sky-200 rounded p-2">
                        <div className="text-[11px] font-bold text-sky-800 mb-0.5">📋 送迎表から自動(業務・その他の予定)</div>
                        <div className="text-xs text-stone-700 space-y-0.5">
                          {bizNotes.map((n, i) => <div key={i}>{n}</div>)}
                        </div>
                      </div>
                    )}
                    <div className="text-[11px] text-stone-400 mt-2">
                      ※ 自動部分は送迎表に入れた「ヘルプ・その他予定」から自動でまとまります(利用者名で始まるものは特記事項、それ以外は連絡事項)。手入力欄と合わせてExcelに出力されます。
                    </div>
                  </div>
                  );
                })()}

                {panelsOpen && (() => {
                  const parts = master.staff.filter((s) => s.emp === "パート" || s.noGrid);
                  if (!parts.length) return null;
                  const wd2 = weekdayOf(date);
                  return (
                    <div className="bg-white border border-stone-300 rounded-lg p-3 mt-3">
                      <div className="font-bold text-stone-700 text-sm mb-1">パート職員の本日出欠 <span className="font-normal text-xs text-stone-400">(名前をクリックで休み⇔出勤を切り替え。Excel下段の職員欄・人数に反映)</span></div>
                      <div className="flex flex-wrap gap-1">
                        {parts.map((s) => {
                          const fx = (s.offDays || []).includes(wd2);
                          const o = (sheet.staffOv || {})[s.id] || {};
                          const isOff = fx ? !o.workToday : !!o.off;
                          return (
                            <button key={s.id}
                              className={`text-xs px-2 py-1 rounded border ${isOff ? "bg-stone-100 text-stone-400 border-stone-200 line-through" : "bg-emerald-50 text-emerald-800 border-emerald-300"}`}
                              title={fx ? "この曜日は固定休(クリックで休日出勤⇔休み)" : "クリックで本日の休み⇔出勤"}
                              onClick={() => updateSheet((prev) => {
                                const ov2 = { ...(prev.staffOv || {}) };
                                const cur = { ...(ov2[s.id] || {}) };
                                if (fx) cur.workToday = !cur.workToday;
                                else cur.off = !cur.off;
                                ov2[s.id] = cur;
                                return { ...prev, staffOv: ov2 };
                              })}>
                              {s.name} {s.start}-{s.end}{isOff ? "(休)" : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {panelsOpen && (
                <div className="mt-3">
                  <MaleCoveragePanel master={sheetMaster} data={dataForGrid} date={date} />
                </div>
                )}

                {panelsOpen && (
                <div className="bg-white border border-stone-300 rounded-lg p-3 mt-3">
                  <div className="font-bold text-stone-700 text-sm mb-2">
                    配車(部署ごとの車両) <span className="font-normal text-xs text-stone-400">(車を表の便にドラッグ=車両交換 / 空きマスにドラッグ=新しい便を作成)</span>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {master.departments.map((d, di) => {
                      const c = (DEPT_COLORS[di % DEPT_COLORS.length] || DEPT_COLORS[0]);
                      const vs = master.vehicles.filter((v) => v.deptId === d.id);
                      if (!vs.length) return null;
                      return (
                        <div key={d.id}>
                          <div className={`text-xs font-bold ${c.text} mb-1`}>{d.name}</div>
                          <div className="flex flex-wrap gap-1">
                            {vs.map((v) => (
                              <span key={v.id}
                                draggable
                                onDragStart={dragStart({ t: "veh", vehicleId: v.id })}
                                onDragEnd={dragEnd}
                                className={`text-xs px-2 py-1 rounded border ${c.chip} cursor-grab active:cursor-grabbing hover:brightness-95`}
                                title="表へドラッグして使用">
                                🚐 {v.name} <span className="opacity-60">{v.capNormal}名/♿{v.wheelchairOK ? `${v.capWc}名` : "×"}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                )}
                {/* 狭い画面(パネル非表示時)は従来どおり下に表示 */}
                <div className="md:hidden mt-3">
                  <MissingAlert master={sheetMaster} sheet={dataForGrid} date={date} />
                  {sheet && (sheet.aiLog || "").trim() && (
                    <div className="text-sm text-indigo-900 bg-indigo-50 border-2 border-indigo-300 rounded-lg p-3 mb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold">🤖 AI調整の記録(Excelの連絡事項にも印字されます)</div>
                        <button className="shrink-0 text-xs px-2 py-1 rounded border border-indigo-400 bg-white text-indigo-700 font-bold hover:bg-indigo-100"
                          onClick={() => updateSheet((prev) => ({ ...prev, aiLog: "" }))}>
                          ✓ 確認済み — 画面とExcelから消す
                        </button>
                      </div>
                      <div className="whitespace-pre-wrap text-xs mt-1 max-h-48 overflow-y-auto">{sheet.aiLog}</div>
                    </div>
                  )}
                  <VehicleNowPanel master={sheetMaster} data={dataForGrid} hoverTime={gridHoverTime} />
                  <UnassignedPanel
                    master={sheetMaster}
                    data={dataForGrid}
                    weekday={weekdayOf(date)}
                    onRemoveUserFromRun={removeUserFromRun}
                    onSetNoRide={(userId, kind, reason) =>
                      updateSheet((prev) => {
                        const nr = { ...((prev && prev.noRide) || {}) };
                        const cur = { ...(nr[userId] || {}) };
                        if (reason) cur[kind] = reason; else delete cur[kind];
                        if (Object.keys(cur).length) nr[userId] = cur; else delete nr[userId];
                        return { ...prev, noRide: nr };
                      })
                    }
                    onToggleLiberta={(userId, ap, mode) =>
                      updateSheet((prev) => {
                        const setMap = (map, val) => {
                          const m2 = { ...((prev && prev[map]) || {}) };
                          const cur = { ...(m2[userId] || {}) };
                          if (val) cur[ap] = true; else delete cur[ap];
                          if (Object.keys(cur).length) m2[userId] = cur; else delete m2[userId];
                          return m2;
                        };
                        return { ...prev, libertaOff: setMap("libertaOff", mode === "off"), libertaOn: setMap("libertaOn", mode === "on") };
                      })
                    }
                    onSetUserTime={(userId, field, val) =>
                      updateSheet((prev) => {
                        const ut = { ...((prev && prev.userTime) || {}) };
                        const cur = { ...(ut[userId] || {}) };
                        if (val) cur[field] = val; else delete cur[field];
                        if (Object.keys(cur).length) ut[userId] = cur; else delete ut[userId];
                        return { ...prev, userTime: ut };
                      })
                    }
                    onSetUserDept={(id, deptId) =>
                      updateSheet((prev) => {
                        const m = { ...(prev.userDept || {}) };
                        if (deptId) m[id] = deptId; else delete m[id];
                        return { ...prev, userDept: m };
                      })
                    }
                    onPick={aiApiOn() ? (kind, u) =>
                      setModal({ type: "aiAdjust", focusUserName: u.name, focusKind: kind }) : undefined
                    }
                    extraUse={(curData && curData.userExtra) || {}}
                    onToggleExtraUse={(id) =>
                      updateSheet((prev) => {
                        const ue = { ...(prev.userExtra || {}) };
                        if (ue[id]) delete ue[id]; else ue[id] = true;
                        return { ...prev, userExtra: ue };
                      })
                    }
                    onToggleAbsent={(id) =>
                      updateSheet((prev) => {
                        const ua = { ...(prev.userAbsent || {}) };
                        const nowAbsent = !ua[id];
                        if (ua[id]) delete ua[id]; else ua[id] = true;
                        // 欠席にした時点で、その人を全便(迎え・送り・訓練フラグ・ヘルプの乗車)から自動で外す
                        const strip = (arr) => (arr || []).map((x) => ({
                          ...x,
                          ...(Array.isArray(x.userIds) && x.userIds.includes(id) ? { userIds: x.userIds.filter((z) => z !== id) } : {}),
                          ...(Array.isArray(x.trainUserIds) && x.trainUserIds.includes(id) ? { trainUserIds: x.trainUserIds.filter((z) => z !== id) } : {}),
                        }));
                        return nowAbsent
                          ? { ...prev, userAbsent: ua, runs: strip(prev.runs), blocks: strip(prev.blocks) }
                          : { ...prev, userAbsent: ua };
                      })
                    }
                  />
                </div>
              </>
            )}
            </div>

            {/* 右:未割当・欠席パネル(独立領域・スクロールしても常に表示) */}
            {sheet && sidePanel && (
              <div className="w-80 shrink-0 sticky top-20 hidden md:block">
                <div className="bg-stone-50 border border-stone-300 rounded-lg shadow-md flex flex-col" style={{ maxHeight: "calc(100vh - 90px)" }}>
                  <div className="flex items-center justify-between px-3 py-2 border-b border-stone-300 bg-white rounded-t-lg">
                    <div className="text-sm font-bold text-stone-700">📋 未割当・欠席</div>
                    <button className="text-xs text-stone-500 hover:text-stone-800 border border-stone-300 rounded px-2 py-1 bg-white" onClick={() => setSidePanel(false)}>
                      ✕ 閉じる
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2">
                    <MissingAlert master={sheetMaster} sheet={dataForGrid} date={date} />
                  {sheet && (sheet.aiLog || "").trim() && (
                    <div className="text-sm text-indigo-900 bg-indigo-50 border-2 border-indigo-300 rounded-lg p-3 mb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold">🤖 AI調整の記録(Excelの連絡事項にも印字されます)</div>
                        <button className="shrink-0 text-xs px-2 py-1 rounded border border-indigo-400 bg-white text-indigo-700 font-bold hover:bg-indigo-100"
                          onClick={() => updateSheet((prev) => ({ ...prev, aiLog: "" }))}>
                          ✓ 確認済み — 画面とExcelから消す
                        </button>
                      </div>
                      <div className="whitespace-pre-wrap text-xs mt-1 max-h-48 overflow-y-auto">{sheet.aiLog}</div>
                    </div>
                  )}
                    <VehicleNowPanel master={sheetMaster} data={dataForGrid} hoverTime={gridHoverTime} />
                    <UnassignedPanel
                      master={sheetMaster}
                      data={dataForGrid}
                      weekday={weekdayOf(date)}
                      onRemoveUserFromRun={removeUserFromRun}
                      onSetNoRide={(userId, kind, reason) =>
                        updateSheet((prev) => {
                          const nr = { ...((prev && prev.noRide) || {}) };
                          const cur = { ...(nr[userId] || {}) };
                          if (reason) cur[kind] = reason; else delete cur[kind];
                          if (Object.keys(cur).length) nr[userId] = cur; else delete nr[userId];
                          return { ...prev, noRide: nr };
                        })
                      }
                      onToggleLiberta={(userId, ap, mode) =>
                        updateSheet((prev) => {
                          const setMap = (map, val) => {
                            const m2 = { ...((prev && prev[map]) || {}) };
                            const cur = { ...(m2[userId] || {}) };
                            if (val) cur[ap] = true; else delete cur[ap];
                            if (Object.keys(cur).length) m2[userId] = cur; else delete m2[userId];
                            return m2;
                          };
                          return { ...prev, libertaOff: setMap("libertaOff", mode === "off"), libertaOn: setMap("libertaOn", mode === "on") };
                        })
                      }
                      onSetUserTime={(userId, field, val) =>
                        updateSheet((prev) => {
                          const ut = { ...((prev && prev.userTime) || {}) };
                          const cur = { ...(ut[userId] || {}) };
                          if (val) cur[field] = val; else delete cur[field];
                          if (Object.keys(cur).length) ut[userId] = cur; else delete ut[userId];
                          return { ...prev, userTime: ut };
                        })
                      }
                      onSetUserDept={(id, deptId) =>
                        updateSheet((prev) => {
                          const m = { ...(prev.userDept || {}) };
                          if (deptId) m[id] = deptId; else delete m[id];
                          return { ...prev, userDept: m };
                        })
                      }
                      onPick={aiApiOn() ? (kind, u) =>
                        setModal({ type: "aiAdjust", focusUserName: u.name, focusKind: kind }) : undefined
                      }
                      extraUse={(curData && curData.userExtra) || {}}
                    onToggleExtraUse={(id) =>
                      updateSheet((prev) => {
                        const ue = { ...(prev.userExtra || {}) };
                        if (ue[id]) delete ue[id]; else ue[id] = true;
                        return { ...prev, userExtra: ue };
                      })
                    }
                    onToggleAbsent={(id) =>
                        updateSheet((prev) => {
                          const ua = { ...(prev.userAbsent || {}) };
                          const nowAbsent = !ua[id];
                          if (ua[id]) delete ua[id]; else ua[id] = true;
                          // 欠席にした時点で、その人を全便(迎え・送り・訓練フラグ・ヘルプの乗車)から自動で外す
                          const strip = (arr) => (arr || []).map((x) => ({
                            ...x,
                            ...(Array.isArray(x.userIds) && x.userIds.includes(id) ? { userIds: x.userIds.filter((z) => z !== id) } : {}),
                            ...(Array.isArray(x.trainUserIds) && x.trainUserIds.includes(id) ? { trainUserIds: x.trainUserIds.filter((z) => z !== id) } : {}),
                          }));
                          return nowAbsent
                            ? { ...prev, userAbsent: ua, runs: strip(prev.runs), blocks: strip(prev.blocks) }
                            : { ...prev, userAbsent: ua };
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- 週間パターン ---------- */}
        {tab === "vehmove" && sheetMaster && dataForGrid && (
          <div>
            <div className="text-sm text-stone-500 mb-2">📅 {date}({DAYS[weekdayOf(date)]}) の送迎表をもとに計算しています(日付は「送迎表(日別)」タブで変更)</div>
            <VehicleTimeline master={sheetMaster} data={dataForGrid} weekday={weekdayOf(date)} />
          </div>
        )}

        {show3d && tab === "sheet" && sheetMaster && dataForGrid && (
          <div className="fixed z-40 bg-white border border-stone-300 rounded-xl shadow-2xl overflow-hidden"
            style={{ left: panel3d.x != null ? panel3d.x : undefined, top: panel3d.y != null ? panel3d.y : undefined,
                     right: panel3d.x == null ? 12 : undefined, bottom: panel3d.y == null ? 12 : undefined,
                     width: panel3d.w, userSelect: "none" }}>
            <div className="flex items-center justify-between px-3 py-1.5 bg-stone-100 border-b border-stone-200 cursor-move"
              onMouseDown={(e) => {
                const box = e.currentTarget.parentElement.getBoundingClientRect();
                const sx = e.clientX - box.left, sy = e.clientY - box.top;
                const mv = (ev) => setPanel3d((p) => ({ ...p, x: Math.max(0, ev.clientX - sx), y: Math.max(0, ev.clientY - sy) }));
                const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
                window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
              }}>
              <span className="text-sm font-bold">🚌 3Dマップ({date} {DAYS[weekdayOf(date)]})— つかんで移動・右下で拡大</span>
              <button className="text-stone-500 hover:text-red-500 font-bold px-2" onMouseDown={(e) => e.stopPropagation()} onClick={() => setShow3d(false)}>×</button>
            </div>
            <div className="p-2">
              <Sim3D master={sheetMaster} data={dataForGrid} weekday={weekdayOf(date)} height={panel3d.h} widthHint={panel3d.w} compact />
            </div>
            <div className="absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize bg-stone-200 rounded-tl"
              onMouseDown={(e) => {
                e.preventDefault();
                const sw = panel3d.w, sh = panel3d.h, sx = e.clientX, sy = e.clientY;
                const mv = (ev) => setPanel3d((p) => ({ ...p, w: Math.max(380, sw + ev.clientX - sx), h: Math.max(240, sh + ev.clientY - sy) }));
                const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
                window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
              }} title="ドラッグでサイズ変更" />
          </div>
        )}

        {tab === "sim3d" && sheetMaster && dataForGrid && (
          <div>
            <div className="text-sm text-stone-500 mb-2">📅 {date}({DAYS[weekdayOf(date)]}) の送迎表を3Dで再生します(日付は「送迎表(日別)」タブで変更)</div>
            <Sim3D master={sheetMaster} data={dataForGrid} weekday={weekdayOf(date)} />
          </div>
        )}

        {tab === "pattern" && (
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="flex rounded-md overflow-hidden border border-stone-300">
                {DAYS.map((d, i) => (
                  <button key={i} onClick={() => setWeekday(i)}
                    className={`px-3 py-1.5 text-sm font-bold ${weekday === i ? "bg-sky-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>
                    {d}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 text-sm">
                <select className={`${inputCls} w-24`} value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))}>
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}曜日</option>)}
                </select>
                <button className={btnSec}
                  onClick={async () => {
                    if (copyFrom === weekday) return;
                    const p = await sGet(`pattern:${copyFrom}`);
                    if (!p || (!p.runs.length && !p.blocks.length)) { notify("コピー元のパターンが空です", "warn"); return; }
                    if (!(await ask(`${DAYS[copyFrom]}曜日の内容を${DAYS[weekday]}曜日にコピーします(上書き)。よろしいですか?`))) return;
                    updatePattern(() => ({
                      runs: p.runs.map((r) => ({ ...r, id: uid() })),
                      blocks: p.blocks.map((b) => ({ ...b, id: uid() })),
                    }));
                    notify(`${DAYS[copyFrom]}曜日の内容を${DAYS[weekday]}曜日にコピーしました`);
                  }}>
                  からコピー
                </button>
              </div>
              <button className={btnPri} onClick={() => setModal({ type: "import" })}>📥 Excelから取り込み</button>
            </div>
            <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg p-2 mb-3">
              ここで組んだ{DAYS[weekday]}曜日の固定パターンは、日別の送迎表で「パターンから読込」を押すと取り込まれます。退職などで職員がいなくなった予定は自動的に「保留」列に表示され、クリックして別の職員へ割り当て直せます。
            </div>
            {!pattern ? (
              <div className="text-stone-500 text-sm p-6 text-center">読み込み中…</div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-xs text-stone-500">表示:</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer select-none ${deptFilter === "all" ? "bg-stone-700 text-white border-stone-700 font-bold" : "bg-white border-stone-300 hover:bg-stone-100"}`} onClick={() => setDeptFilter("all")}>全部署</span>
                  {patternMaster.departments.map((dpt, di) => {
                    const c2 = (DEPT_COLORS[di % DEPT_COLORS.length] || DEPT_COLORS[0]);
                    const on2 = deptFilter === dpt.id;
                    return (
                      <span key={dpt.id} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer select-none ${c2.chip} ${on2 ? "ring-2 ring-stone-700 font-bold" : "opacity-80 hover:opacity-100"}`} onClick={() => setDeptFilter(on2 ? "all" : dpt.id)}>{dpt.name}</span>
                    );
                  })}
                </div>
              <TimeGrid
                searchQ={searchQ}
                activeSearchId={activeSearchId}
                master={patternMaster}
                data={dataForGrid}
                deptFilter={deptFilter}
                weekday={weekday}
                sheetMode={false}
                onCell={(staffId, time) => setModal({ type: "item", initial: { staffId, time } })}
                onItem={({ target, item }) => setModal({ type: "item", initial: { ...item }, editTarget: target })}
                onStaff={(s) => setModal({ type: "staffOv", staffId: s.id })}
                onToggleOff={() => {}}
                onMoveItem={moveItem}
                onSetOrder={(updates) =>
                  curUpdate((prev) => {
                    const apply = (arr) => arr.map((x) => { const u = updates.find((v) => v.id === x.id); return u ? { ...x, ord: u.ord } : x; });
                    return { ...prev, runs: apply(prev.runs || []), blocks: apply(prev.blocks || []) };
                  })
                }
                onDeleteItem={async ({ target, item }) => {
                  const label = target === "runs"
                    ? `${RUN_KINDS[item.kind] || "送迎"} ${item.time}`
                    : `${item.label || "予定"} ${item.time}`;
                  if (!(await ask(`このパターンの予定を削除しますか?\n\n${label}`))) return;
                  curUpdate((prev) => ({ ...prev, [target]: prev[target].filter((x) => x.id !== item.id) }));
                }}
                onDropUserOnRun={dropUserOnRun}
                onDropUserOnCell={dropUserOnCell}
                onDropVehicleOnRun={dropVehicleOnRun}
                onDropVehicleOnCell={dropVehicleOnCell}
              />
              </>
            )}
          </div>
        )}

        {["staff", "vehicles", "users", "pattern", "rules", "depts", "helpboard"].includes(tab) && (
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <button className={`${btnSec} text-xs py-1`} onClick={exportMasterExcel} title="部署・職員・利用者・車両・週間パターン・ヘルプ表・ルールを1つのExcelにまとめて書き出します">📘 マスタExcel出力</button>
            <label className={`${btnSec} text-xs py-1 cursor-pointer`} title="出力したExcelを編集して、そのまま取り込めます">
              📥 マスタExcel取込
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) importMasterExcel(f); }} />
            </label>
            <span className="text-[11px] text-stone-500">部署・職員・利用者・車両・週間パターン・ヘルプ表・ルールを1つのExcelでやりとりできます。新しい版への引っ越しにも使えます</span>
          </div>
        )}
        {tab === "staff" && <StaffTab master={master} update={updateMaster} />}
        {tab === "vehicles" && <VehicleTab master={master} update={updateMaster} />}
        {tab === "users" && <UserTab master={master} update={updateMaster} />}
        {(tab === "helpboard" || tab === "rules") && <RuleFromBar master={master} from={ruleFrom} setFrom={setRuleFrom} rawUpdate={updateMaster} />}
        {tab === "helpboard" && <HelpBoardTab master={master} update={updateRules} patterns={allPatterns || {}} loading={!allPatterns} onDeletePattern={deleteHelpFromPatterns} onAddPattern={addHelpToPatterns} />}
        {tab === "rules" && <RulesTab master={master} update={updateRules} />}
        {tab === "depts" && <DeptTab master={master} update={updateMaster} onReseed={async () => {
          if (!(await ask("Excelから抽出した初期マスタ(職員38・利用者40・車両13)を読み込みます。\n現在の職員・利用者・車両・部署は置き換わります。よろしいですか?"))) return;
          const fresh = seedMaster();
          setMaster(fresh);
          scheduleSave("master", fresh);
          notify("初期マスタを読み込みました。氏名や勤務時間をご確認ください。");
        }} />}
      </div>

      <div className="px-3 text-[11px] text-stone-400">
        ※ このアプリのデータは、このアプリを開く全員に共有されます。Excel出力は通常のExcelファイル(.xlsx)で保存されます。 <b>アプリ版: v{SEED_VERSION}</b>(この番号が古い場合は最新のファイルでアプリを開き直してください)
      </div>

      {/* ---------- モーダル ---------- */}
      {modal && modal.type === "item" && curData && (
        <ItemModal
          master={curMaster}
          data={dataForGrid}
          weekday={isPattern ? weekday : weekdayOf(date)}
          initial={modal.initial}
          onSave={(payload) => { saveItem(payload); setModal(null); }}
          onDelete={() => {
            const t = modal.editTarget || ((modal.initial.kind === "help" || modal.initial.kind === "block") ? "blocks" : "runs");
            deleteItem(t, modal.initial.id);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal && modal.type === "staffOv" && (() => {
        const stf = master.staff.find((s) => s.id === modal.staffId);
        if (!stf) return null;
        const inSheet = tab === "sheet" && sheet;
        return (
          <StaffOvModal
            master={master}
            staff={stf}
            ov={inSheet ? (sheet.staffOv || {})[stf.id] || {} : {}}
            itemCount={inSheet ? countStaffItems(stf.id) : 0}
            fixedOffToday={inSheet && (stf.offDays || []).includes(weekdayOf(date))}
            onSave={async (ov) => {
              if (!inSheet) { setModal(null); return; }
              // 休みに変えたときは、「休みに」ボタンと同じく担当の予定を保留へ移すか聞く
              const wasOff = !!((sheet.staffOv || {})[stf.id] || {}).off;
              const cnt = countStaffItems(stf.id);
              let moveHold = false;
              setModal(null);
              if (ov.off && !wasOff && cnt > 0) moveHold = await ask(`${stf.name}を休みにします。担当していた${cnt}件の予定を「保留」列へ移しますか?\n(キャンセル=予定はそのまま残す)`);
              updateSheet((prev) => ({
                ...prev,
                runs: moveHold ? prev.runs.map((r) => (r.staffId === stf.id ? { ...r, staffId: HOLD_ID } : r)) : prev.runs,
                blocks: moveHold ? prev.blocks.map((b) => (b.staffId === stf.id ? { ...b, staffId: HOLD_ID } : b)) : prev.blocks,
                staffOv: { ...(prev.staffOv || {}), [stf.id]: ov },
              }));
            }}
            onMoveDept={(deptId) => updateMaster((m) => ({ ...m, staff: m.staff.map((s) => (s.id === stf.id ? { ...s, deptId } : s)) }))}
            onHoldAll={() => { if (inSheet) moveStaffItemsToHold(stf.id); setModal(null); }}
            onClose={() => setModal(null)}
          />
        );
      })()}

      {modal && modal.type === "holiday" && sheet && (
        <HolidayWorkModal
          master={sheetMaster}
          wd={weekdayOf(date)}
          staffOv={sheet.staffOv || {}}
          onToggle={(id, on) =>
            updateSheet((prev) => {
              const so = { ...(prev.staffOv || {}) };
              so[id] = { ...(so[id] || {}), workToday: on };
              if (!on) delete so[id].workToday;
              return { ...prev, staffOv: so };
            })
          }
          onClose={() => setModal(null)}
        />
      )}

      {modal && modal.type === "claudeProps" && (
        <ClaudeProposals list={claudeProps.list} reload={claudeProps.load} onClose={() => setModal(null)} onOpenDate={(d) => { setModal(null); setTab && setTab("sheet"); setDate(d); }} />
      )}
      {modal && modal.type === "agent" && master && sheet && (
        <AgentChat master={master} sheet={sheet} date={date} onClose={() => setModal(null)}
          onApply={async (base, draft, requests) => {
            // 相談中に他の人・カレンダーで変わった分と統合して反映(上書きしない)
            const M = (b, d, c) => (window.SGKV ? window.SGKV.merge3(b, d, c).value : d);
            const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
            const stamp = new Date().toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
            const line = `◆${stamp} AIと相談して反映` + (requests.length ? `(依頼: ${requests.slice(-3).join(" / ").slice(0, 200)})` : "");
            if (!same(base.master, draft.master)) updateMaster((cur) => M(base.master, draft.master, cur));
            if (!same(base.sheet, draft.sheet)) updateSheet((cur) => { const merged = M(base.sheet, draft.sheet, cur); return { ...merged, aiLog: (merged.aiLog ? merged.aiLog + "\n" : "") + line }; });
            const days = Object.keys(draft.patterns || {}).filter((d) => !same((base.patterns || {})[d], draft.patterns[d]));
            for (const d of days) {
              if (tab === "pattern" && String(weekday) === String(d)) updatePattern((cur) => M(base.patterns[d], draft.patterns[d], cur));
              else { const cur = await sGet(`pattern:${d}`); sSet(`pattern:${d}`, M(base.patterns[d], draft.patterns[d], cur)); }
            }
            setModal(null);
            notify(`AIと相談した案を反映しました(${[!same(base.sheet, draft.sheet) && "送迎表", !same(base.master, draft.master) && "利用者・職員・ルール", days.length && `週間パターン${days.length}曜日`].filter(Boolean).join("・")})`);
          }} />
      )}
      {modal && modal.type === "aiAdjust" && sheetMaster && dataForGrid && (
        <AiAdjustModal
          master={sheetMaster}
          data={dataForGrid}
          weekday={weekdayOf(date)}
          focusUserName={modal.focusUserName}
          focusKind={modal.focusKind}
          onApply={(changes, idMap, unresolvedFromAi, logInfo) => {
            // 名前→IDに引き直して便へ適用
            const sByName = {}; sheetMaster.staff.forEach((s) => { sByName[s.name] = s.id; });
            const vByName = {}; sheetMaster.vehicles.forEach((v) => { vByName[v.name] = v.id; });
            const uByName = {}; sheetMaster.users.forEach((u) => { uByName[u.name] = u.id; });
            const dByName = {}; sheetMaster.departments.forEach((d) => { dByName[d.name] = d.id; });
            let applied = 0;
            let dedupCount = 0; // 重複乗車の自動整理件数
            const capFixed = []; // 定員超過で便から外した人(未割当へ戻る)
            let emptyRemoved = 0; // 利用者ゼロで自動削除した便の数
            const offNames = (logInfo && logInfo.staffOff) || [];
            const timeChanges = (logInfo && logInfo.staffTime) || [];
            const formWc = (logInfo && logInfo.workChanges) || [];
            let finalRuns = null, finalBlocks = null; // 反映結果(残り検証用)
            updateSheet((prev) => {
              let runs = [...(prev.runs || [])];
              let blocks = [...(prev.blocks || [])];
              const pin = new Map(); // 今回の変更で利用者が明示的に置かれた便(userId→runId)。重複整理で優先する
              const touched = new Set(); // 今回のAI操作で作成・変更・調整した便(空になったら削除する対象)
              changes.forEach((c) => {
                const ref = idMap[c.id]; // { t: "runs"|"blocks", id }
                if (c.op === "delete" && ref) {
                  if (ref.t === "blocks") blocks = blocks.filter((b) => b.id !== ref.id);
                  else runs = runs.filter((r) => r.id !== ref.id);
                  applied++;
                } else if (c.op === "update" && ref) {
                  const patch = (x) => {
                    const newStaffId = (c.staff && sByName[c.staff]) || x.staffId;
                    const isOwnCar = c.veh === "自車" || c.veh === "自家用車";
                    return {
                      ...x,
                      ...(c.time ? { time: c.time } : {}),
                      ...(c.staff && sByName[c.staff] ? { staffId: sByName[c.staff] } : {}),
                      ...(isOwnCar && newStaffId && newStaffId !== HOLD_ID ? { vehicleId: "own:" + newStaffId }
                        : (c.veh && vByName[c.veh] ? { vehicleId: vByName[c.veh] } : {})),
                      ...(c.dur ? { durMin: Number(c.dur) } : {}),
                      ...(c.dest && dByName[c.dest] ? { destDeptId: dByName[c.dest] } : {}),
                    };
                  };
                  if (ref.t === "blocks") {
                    blocks = blocks.map((b) => (b.id === ref.id ? { ...patch(b), ...(c.label ? { label: c.label } : {}) } : b));
                  } else {
                    runs = runs.map((r) => r.id === ref.id ? {
                      ...patch(r),
                      ...(Array.isArray(c.users) ? { userIds: c.users.map((n) => uByName[stripParen(n)]).filter(Boolean) } : {}),
                      ...(keepAiNote(c.note) ? { note: keepAiNote(c.note) } : {}),
                    } : r);
                    touched.add(ref.id);
                    if (Array.isArray(c.users)) {
                      const rk = (runs.find((r) => r.id === ref.id) || {}).kind || "meet";
                      c.users.map((n) => uByName[stripParen(n)]).filter(Boolean).forEach((u2) => pin.set(rk + "|" + u2, ref.id));
                    }
                  }
                  applied++;
                } else if (c.op === "add") {
                  if (c.kind === "ヘルプ") {
                    const stId = (c.staff && sByName[c.staff]) || HOLD_ID;
                    const isOwnCar = c.veh === "自車" || c.veh === "自家用車";
                    blocks.push({
                      id: uid(), kind: "help", time: c.time || "9:00",
                      staffId: stId,
                      vehicleId: isOwnCar && stId !== HOLD_ID ? "own:" + stId : ((c.veh && vByName[c.veh]) || ""),
                      label: c.label || c.note || "ヘルプ", userIds: [],
                      ...(c.dur ? { durMin: Number(c.dur) } : {}),
                    });
                  } else {
                    const newRunId = uid();
                    touched.add(newRunId);
                    const newKind = c.kind === "送" ? "send" : c.kind === "他" ? "other_run" : "meet";
                    const newUserIds = (c.users || []).map((n) => uByName[stripParen(n)]).filter(Boolean);
                    newUserIds.forEach((u2) => pin.set(newKind + "|" + u2, newRunId));
                    runs.push({
                      id: newRunId, kind: c.kind === "送" ? "send" : c.kind === "他" ? "other_run" : "meet", time: c.time || "8:30",
                      staffId: (c.staff && sByName[c.staff]) || HOLD_ID,
                      vehicleId: (c.veh && vByName[c.veh]) || "",
                      userIds: newUserIds,
                      ...(keepAiNote(c.note) ? { note: keepAiNote(c.note) } : {}),
                      ...(c.dest && dByName[c.dest] ? { destDeptId: dByName[c.dest] } : {}),
                      ...(c.dur ? { durMin: Number(c.dur) } : {}),
                    });
                  }
                  applied++;
                }
              });
              // フォーム入力・自由入力から読み取った職員の休み・時間変更をアプリの勤務設定にも登録
              let staffOv2 = prev.staffOv || {};
              formWc.forEach((w) => {
                staffOv2 = { ...staffOv2, [w.id]: { ...(staffOv2[w.id] || {}), ...(w.off ? { off: true } : { start: w.start, end: w.end }) } };
              });
              offNames.forEach((nm2) => {
                const st2 = sheetMaster.staff.find((s) => s.name === nm2 || nm2.startsWith(s.name));
                if (st2) staffOv2 = { ...staffOv2, [st2.id]: { ...(staffOv2[st2.id] || {}), off: true } };
              });
              timeChanges.forEach((x) => {
                const st2 = sheetMaster.staff.find((s) => s.name === x.name || String(x.name).startsWith(s.name));
                if (st2) staffOv2 = { ...staffOv2, [st2.id]: { ...(staffOv2[st2.id] || {}), ...(x.start ? { start: x.start } : {}), ...(x.end ? { end: x.end } : {}) } };
              });
              // 反映後の自動整理: 同じ人が同じ種別(迎え/送り)の複数便に残っていたら、
              // AIの変更で明示された便を優先し、それ以外から自動で外す(訓練フラグは別種別なので対象外)
              ["meet", "send"].forEach((k) => {
                const seen = new Set();
                runs = runs.map((r) => {
                  if (r.kind !== k || r.mode === "train" || r.mode === "move") return r; // 移動便は送迎ではないので重複の対象外
                  const kept = (r.userIds || []).filter((u2) => {
                    if ((r.trainUserIds || []).includes(u2)) return true;
                    const pk = k + "|" + u2;
                    if (pin.has(pk) && pin.get(pk) !== r.id) { dedupCount++; touched.add(r.id); return false; }
                    if (seen.has(u2)) { dedupCount++; touched.add(r.id); return false; }
                    seen.add(u2);
                    return true;
                  });
                  return kept.length === (r.userIds || []).length ? r : { ...r, userIds: kept };
                });
              });
              // 定員超過の自動調整: AIの案で定員を超えた便は、後から追加された人(配列の末尾)から外して未割当へ戻す
              runs = runs.map((r) => {
                if (r.mode === "walk") return r;
                const veh = resolveVehicle(sheetMaster, r.vehicleId);
                if (!veh || veh.own) return r;
                const isWc = (id) => { const u2 = sheetMaster.users.find((x) => x.id === id); return !!(u2 && u2.wheelchair); };
                const wcMax = veh.wheelchairOK ? (veh.capWc || 0) : 0;
                let ids = [...(r.userIds || [])];
                const riderStaff = (r.staffRiderIds || []).length;
                while (ids.length && (ids.length + riderStaff > veh.capNormal || ids.filter(isWc).length > wcMax)) {
                  // 車いす超過なら末尾側の車いすの人、通常超過なら末尾の人を外す
                  const overWc = ids.filter(isWc).length > wcMax;
                  let idx = ids.length - 1;
                  if (overWc) { for (let k2 = ids.length - 1; k2 >= 0; k2--) { if (isWc(ids[k2])) { idx = k2; break; } } }
                  const removed = ids.splice(idx, 1)[0];
                  touched.add(r.id);
                  const nm3 = (sheetMaster.users.find((x) => x.id === removed) || {}).name || "?";
                  capFixed.push(`${nm3}(${r.time}の${r.kind === "meet" ? "迎え" : r.kind === "send" ? "送り" : ""}便・${veh.name}定員${veh.capNormal})`);
                }
                return ids.length === (r.userIds || []).length ? r : { ...r, userIds: ids };
              });
              // 空の便の自動削除: 「今回のAI操作で作成・変更した便」が空になった場合のみ削除。
              // 元からある移動用の便や、メモ・名称に「移動」「回送」とある便は利用者ゼロでも残す
              runs = runs.filter((r) => {
                if (r.kind !== "meet" && r.kind !== "send") return true; // 回送・外出(他)は対象外
                if (r.mode === "move") return true; // 移動便は乗客がいなくても残す
                if (!touched.has(r.id)) return true; // 今回触っていない便は消さない
                if (/移動|回送/.test((r.note || "") + (r.label || ""))) return true;
                const riders = (r.userIds || []).length + (r.trainUserIds || []).length + (r.staffRiderIds || []).length;
                if (riders === 0) { emptyRemoved++; return false; }
                return true;
              });
              finalRuns = runs; finalBlocks = blocks;
              return { ...prev, runs, blocks, staffOv: staffOv2 };
            });
            // 反映後の残り(未割当・保留)を検証してポップアップで知らせる
            const wd2 = weekdayOf(date);
            const leftover = [];
            if (finalRuns) {
              const nr2 = (dataForGrid && dataForGrid.noRide) || {};
              const ab2 = (dataForGrid && dataForGrid.userAbsent) || {};
              const am2 = new Set(), sm2 = new Set();
              finalRuns.forEach((r) => {
                if (r.kind !== "meet" && r.kind !== "send") return;
                (r.userIds || []).forEach((id) => { const k9 = rideKindOf(r, id); if (k9 && k9 !== "send") am2.add(id); if (k9 && k9 !== "meet") sm2.add(id); });
              });
              sheetMaster.users.filter((u) => (u.days || []).includes(wd2) && !ab2[u.id]).forEach((u) => {
                if (!(nr2[u.id] || {}).meet && !am2.has(u.id)) leftover.push(`迎え未割当: ${u.name}`);
                if (!(nr2[u.id] || {}).send && !sm2.has(u.id)) leftover.push(`送り未割当: ${u.name}`);
              });
              const known2 = new Set(sheetMaster.staff.map((s) => s.id));
              const holdOf = (x, lbl) => { if (x.staffId === HOLD_ID || !known2.has(x.staffId)) leftover.push(`保留(担当未定): ${x.time} ${lbl}`); };
              finalRuns.forEach((r) => holdOf(r, `【${RUN_KINDS[r.kind] || "予定"}】${(r.userIds || []).map((id) => (sheetMaster.users.find((u) => u.id === id) || {}).name).filter(Boolean).join("・")}`));
              finalBlocks.forEach((b) => { if (b.kind === "help") holdOf(b, b.label || "ヘルプ"); });
            }
            // AI調整に書いた「今日の状況・要望」をシートの特記事項へ自動転記(2度打ち不要)。同じ文は重複させない
            const reqText = String((logInfo && logInfo.userRequest) || "").trim();
            if (reqText) {
              updateSheet((prev) => {
                const cur = String(prev.notes || "");
                if (cur.includes(reqText)) return prev;
                return { ...prev, notes: (cur ? cur + "\n" : "") + reqText };
              });
            }
            capFixed.forEach((x) => leftover.push(`定員超過のため便から外しました: ${x} → 未割当に戻っています`));
            (unresolvedFromAi || []).forEach((x) => leftover.push(`AI申告: ${x.item}(${x.reason})`));
            // AI提案の全文をシートに記録(画面上部とExcel連絡事項に出る。「確認済み」ボタンで消える)
            if (logInfo && (logInfo.notes || (logInfo.lines || []).length)) {
              const stamp = new Date().toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
              const logText = [
                `◆${stamp} AI調整を反映(${applied}件)`,
                logInfo.notes ? `コメント: ${logInfo.notes}` : "",
                ...(logInfo.lines || []),
              ].filter(Boolean).join("\n");
              updateSheet((prev) => ({ ...prev, aiLog: (prev.aiLog ? prev.aiLog + "\n" : "") + logText }));
            }
            if (leftover.length) {
              setModal({ type: "aiLeftover", items: [...new Set(leftover)] });
            } else {
              setModal(null);
            }
            notify(`AI調整案を反映しました(${applied}件の変更${dedupCount ? `・重複していた${dedupCount}件の乗車を自動整理` : ""}${capFixed.length ? `・定員超過${capFixed.length}件を自動修正` : ""}${emptyRemoved ? `・空の便${emptyRemoved}件を削除` : ""}${offNames.length || formWc.length || timeChanges.length ? `・勤務情報を${offNames.length + formWc.length + timeChanges.length}件登録` : ""})。⚠警告が出ていないか確認してください`);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal && modal.type === "libCsv" && sheetMaster && (
        <LibCsvModal
          master={sheetMaster}
          date={date}
          hasSheet={!!sheet}
          onAssign={assignLibFromDay}
          onDiff={(dayMap) => {
            const diffs = libCsvDiff(sheetMaster, dataForGrid, dayMap, weekdayOf(date));
            if (diffs.length) setModal({ type: "libDiff", items: diffs });
            else { setModal(null); notify("✓ 照合OK — ケアウィングCSVと送迎表に違いはありません"); }
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal && modal.type === "libDiff" && (
        <Modal title="🔍 ケアウィングCSVとの照合結果" onClose={() => setModal(null)}>
          <p className="text-sm text-stone-600 mb-2">リベルタのサービス予定(CSV)と送迎表を突き合わせて、次の違いが見つかりました。確認して必要なら修正してください。</p>
          <div className="text-sm border border-amber-300 bg-amber-50 rounded p-2 mb-3 max-h-72 overflow-y-auto">
            {modal.items.map((x, i) => <div key={i} className="py-0.5 border-b border-amber-100 last:border-0">・{x}</div>)}
          </div>
          <div className="text-xs text-stone-500 mb-3">※「アプリは自宅設定」系はリベルタ泊の調整パネルで切替できます。職員の重複はAI調整か手動で担当を変更してください。</div>
          <div className="flex justify-end">
            <button className={btnPri} onClick={() => setModal(null)}>閉じる</button>
          </div>
        </Modal>
      )}

      {modal && modal.type === "backup" && (
        <Modal title="💾 バックアップ / 復元" onClose={() => setModal(null)}>
          <div className="text-sm mb-1">全データ({modal.keys}件)をまとめました。ファイルのダウンロードが「ブロックされました」と出る環境では、下の<b>📋コピー</b>を使ってください。</div>
          <div className="border border-stone-300 rounded p-2 mb-2 bg-stone-50">
            <div className="text-xs font-bold text-stone-600 mb-1">この端末から持ち出す(バックアップ)</div>
            <div className="flex gap-2 items-center">
              <button className={btnPri} onClick={async () => {
                try {
                  await navigator.clipboard.writeText(modal.json);
                  notify("バックアップデータをコピーしました。メモ帳やLINEのKeep等に貼り付けて保存してください");
                } catch (e) {
                  // クリップボードAPIが使えない場合はテキストエリアを表示して手動コピー
                  setModal({ ...modal, showText: true });
                }
              }}>📋 データをコピー</button>
              <span className="text-xs text-stone-500">約{Math.round(modal.json.length / 1024)}KB</span>
            </div>
            {modal.showText && (
              <textarea className="w-full h-24 mt-2 text-[10px] border border-stone-300 rounded p-1" readOnly value={modal.json} onFocus={(e) => e.target.select()} />
            )}
          </div>
          <div className="border border-stone-300 rounded p-2 bg-stone-50">
            <div className="text-xs font-bold text-stone-600 mb-1">この端末に取り込む(復元) — コピーしたデータを下に貼り付け</div>
            <textarea className="w-full h-20 text-[10px] border border-stone-300 rounded p-1" placeholder="ここにバックアップデータを貼り付けて「復元」を押してください" value={modal.pasteText || ""} onChange={(e) => setModal({ ...modal, pasteText: e.target.value })} />
            <button className={btnSec} disabled={!(modal.pasteText || "").trim()} onClick={async () => {
              try {
                const obj = JSON.parse(modal.pasteText);
                const n = await importAllData(obj);
                notify(`${n}件のデータを復元しました。画面を読み込み直します`);
                setTimeout(() => window.location.reload(), 800);
              } catch (e) { notify("復元に失敗: " + String((e && e.message) || e), "warn"); }
            }}>📂 貼り付けたデータで復元</button>
          </div>
        </Modal>
      )}

      {modal && modal.type === "autoWizard" && (() => {
        const wd0 = weekdayOf(date);
        const wiz = modal;
        const upd = (patch) => setModal({ ...wiz, ...patch });
        const staffList = sheetMaster.staff.filter((s) => !s.noGrid && !(s.retireDate && date >= s.retireDate)).slice().sort((a, b) => (a.deptId > b.deptId ? 1 : -1));
        const userList = sheetMaster.users.filter((u) => (u.days || []).includes(wd0)).slice().sort((a, b) => (a.deptId > b.deptId ? 1 : a.deptId < b.deptId ? -1 : 0));
        const deptNm = (id) => ((sheetMaster.departments.find((d) => d.id === id) || {}).name || "").slice(0, 1);
        // 部署ごとのブロック分け表示: 「嫁) ○○ ○○」の段組み
        const GroupedNames = ({ list, deptOf, render, maxH }) => (
          <div className={`${maxH || "max-h-56"} overflow-y-auto mb-2 space-y-1.5`}>
            {sheetMaster.departments.map((dpt, di) => {
              const members = list.filter((x) => deptOf(x) === dpt.id);
              if (!members.length) return null;
              const c2 = (DEPT_COLORS[di % DEPT_COLORS.length] || DEPT_COLORS[0]);
              return (
                <div key={dpt.id} className={`flex items-start gap-1.5 rounded p-1 ${c2.soft}`}>
                  <span className={`text-xs font-bold ${c2.text} whitespace-nowrap pt-1`}>{dpt.name.slice(0, dpt.name.startsWith("あ") ? 4 : 2)})</span>
                  <div className="flex flex-wrap gap-1.5">{members.map(render)}</div>
                </div>
              );
            })}
          </div>
        );
        // 表と同じ部署色でチップを塗り分け(選択中は濃い枠+チェック印)
        const deptChip = (deptId2, on) => {
          const di2 = sheetMaster.departments.findIndex((d) => d.id === deptId2);
          const c2 = DEPT_COLORS[Math.max(0, di2) % DEPT_COLORS.length];
          return `text-xs px-2 py-1 rounded-full border cursor-pointer select-none ${c2.chip} ${on ? "ring-2 ring-stone-700 font-bold" : "opacity-90 hover:opacity-100"}`;
        };
        const steps = ["職員の休み", "職員の時間変更", "利用者の休み", "迎えの時間変更", "送りの時間変更", "その他の予定"];
        const TimeRows = ({ list, onChange, single }) => (
          <div className="space-y-1 mb-2">
            {list.map((x, i) => {
              const nm = (sheetMaster.staff.find((s) => s.id === x.id) || sheetMaster.users.find((u) => u.id === x.id) || {}).name || "?";
              return (
                <div key={x.id} className="flex items-center gap-2 text-sm bg-sky-50 border border-sky-200 rounded px-2 py-1">
                  <span className="font-bold flex-1">{nm}</span>
                  {single ? (
                    <input type="time" className="border border-stone-300 rounded px-1 text-sm" value={x.time || ""} onChange={(e) => onChange(list.map((y, j) => (j === i ? { ...y, time: e.target.value } : y)))} />
                  ) : (
                    <>
                      <input type="time" className="border border-stone-300 rounded px-1 text-sm" value={x.start || ""} onChange={(e) => onChange(list.map((y, j) => (j === i ? { ...y, start: e.target.value } : y)))} />
                      <span className="text-stone-400">〜</span>
                      <input type="time" className="border border-stone-300 rounded px-1 text-sm" value={x.end || ""} onChange={(e) => onChange(list.map((y, j) => (j === i ? { ...y, end: e.target.value } : y)))} />
                    </>
                  )}
                  <button className="text-stone-400 hover:text-red-500 font-bold px-1" onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button>
                </div>
              );
            })}
            {!list.length && <div className="text-xs text-stone-400">下の名前をタップすると追加されます</div>}
          </div>
        );
        const stepBody = () => {
          if (wiz.step === 0) return (
            <>
              <div className="text-sm mb-2">今日、<b>休みの職員</b>はいますか?(名前をタップして選択。いなければそのまま「次へ」)</div>
              <GroupedNames list={staffList} deptOf={(s) => belongDeptOf(sheetMaster, s, wd0)} render={(s) => { const on = wiz.offStaff.includes(s.id); return (
                <span key={s.id} className={deptChip(belongDeptOf(sheetMaster, s, wd0), on)} onClick={() => upd({ offStaff: on ? wiz.offStaff.filter((x) => x !== s.id) : [...wiz.offStaff, s.id] })}>{on ? "✓" : ""}{s.name}</span>
              ); }} />
            </>
          );
          if (wiz.step === 1) return (
            <>
              <div className="text-sm mb-2"><b>勤務時間が変わる職員</b>はいますか?(名前をタップ→時間を入力)</div>
              <TimeRows list={wiz.timeStaff} onChange={(l) => upd({ timeStaff: l })} />
              <GroupedNames maxH="max-h-44" list={staffList.filter((s) => !wiz.offStaff.includes(s.id))} deptOf={(s) => belongDeptOf(sheetMaster, s, wd0)} render={(s) => { const on = wiz.timeStaff.some((x) => x.id === s.id); return (
                <span key={s.id} className={deptChip(belongDeptOf(sheetMaster, s, wd0), on)} onClick={() => { if (on) return; const eff = staffTimeOf(s, wd0, {}); upd({ timeStaff: [...wiz.timeStaff, { id: s.id, start: to24(eff.start), end: to24(eff.end) }] }); }}>{on ? "✓" : ""}{s.name}</span>
              ); }} />
            </>
          );
          if (wiz.step === 2) return (
            <>
              <div className="text-sm mb-2">今日、<b>お休み(欠席)の利用者</b>はいますか?(名前をタップして選択)</div>
              <GroupedNames list={userList} deptOf={(u) => u.deptId} render={(u) => { const on = wiz.absentUsers.includes(u.id); return (
                <span key={u.id} className={deptChip(u.deptId, on)} onClick={() => upd({ absentUsers: on ? wiz.absentUsers.filter((x) => x !== u.id) : [...wiz.absentUsers, u.id] })}>{on ? "✓" : ""}{u.name}</span>
              ); }} />
            </>
          );
          if (wiz.step === 3 || wiz.step === 4) {
            const isMeet = wiz.step === 3;
            const key = isMeet ? "meetChanges" : "sendChanges";
            return (
              <>
                <div className="text-sm mb-2"><b>{isMeet ? "迎え" : "送り"}の時間に変更がある利用者</b>はいますか?(名前をタップ→希望時刻を入力)</div>
                <TimeRows single list={wiz[key]} onChange={(l) => upd({ [key]: l })} />
                <GroupedNames maxH="max-h-44" list={userList.filter((u) => !wiz.absentUsers.includes(u.id))} deptOf={(u) => u.deptId} render={(u) => { const on = wiz[key].some((x) => x.id === u.id); return (
                  <span key={u.id} className={deptChip(u.deptId, on)} onClick={() => { if (on) return; const tw = userTimeOf(u, wd0, (sheet && sheet.userTime) || {}); upd({ [key]: [...wiz[key], { id: u.id, time: to24(isMeet ? tw.meet : tw.send) }] }); }}>{on ? "✓" : ""}{u.name}</span>
                ); }} />
              </>
            );
          }
          // 6/6: その他の予定(透析・受診・早退・対応など。同じ職員に複数件OK)
          return (
            <>
              <div className="text-sm mb-2">今日の<b>その他の予定</b>はありますか?(透析・受診・早退・対応など。名前をタップ→時刻と内容を記入。同じ人に複数件も可)</div>
              <div className="space-y-1 mb-2">
                {wiz.otherPlans.map((x, i) => {
                  const nm = (sheetMaster.staff.find((s) => s.id === x.id) || {}).name || "?";
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm bg-sky-50 border border-sky-200 rounded px-2 py-1">
                      <span className="font-bold">{nm}</span>
                      <input type="time" className="border border-stone-300 rounded px-1 text-sm" value={x.time || ""} onChange={(e) => upd({ otherPlans: wiz.otherPlans.map((y, j) => (j === i ? { ...y, time: e.target.value } : y)) })} />
                      <input type="text" placeholder="内容(例: 透析・受診付き添い)" className="border border-stone-300 rounded px-1.5 py-0.5 text-sm flex-1" value={x.label || ""} onChange={(e) => upd({ otherPlans: wiz.otherPlans.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} />
                      <button className="text-stone-400 hover:text-red-500 font-bold px-1" onClick={() => upd({ otherPlans: wiz.otherPlans.filter((_, j) => j !== i) })}>×</button>
                    </div>
                  );
                })}
                {!wiz.otherPlans.length && <div className="text-xs text-stone-400">下の名前をタップすると行が追加されます</div>}
              </div>
              <GroupedNames maxH="max-h-40" list={staffList.filter((s) => !wiz.offStaff.includes(s.id))} deptOf={(s) => belongDeptOf(sheetMaster, s, wd0)} render={(s) => (
                <span key={s.id} className={deptChip(belongDeptOf(sheetMaster, s, wd0), false)} onClick={() => upd({ otherPlans: [...wiz.otherPlans, { id: s.id, time: "10:00", label: "" }] })}>{s.name}</span>
              )} />
            </>
          );
        };
        const counts = [wiz.offStaff.length, wiz.timeStaff.length, wiz.absentUsers.length, wiz.meetChanges.length, wiz.sendChanges.length, wiz.otherPlans.length];
        return (
          <Modal title={`⚙ 自動割当の前に確認 ${wiz.step + 1}/6: ${steps[wiz.step]}`} onClose={() => setModal(null)}>
            <div className="flex items-center gap-1 mb-2">
              {steps.map((st2, i) => (
                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${i === wiz.step ? "bg-sky-600 text-white font-bold" : i < wiz.step ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-400"}`}>{i + 1}{counts[i] ? `(${counts[i]})` : ""}</span>
              ))}
            </div>
            {stepBody()}
            <div className="flex justify-between items-center mt-1">
              <div className="flex gap-2">
                {wiz.step > 0 && <button className={btnSec} onClick={() => upd({ step: wiz.step - 1 })}>← 戻る</button>}
                <button className="text-xs text-stone-400 underline" onClick={() => applyWizardAndRun(wiz)}>質問をとばして実行</button>
              </div>
              {wiz.step < 5 ? (
                <button className={btnPri} onClick={() => upd({ step: wiz.step + 1 })}>{counts[wiz.step] ? `次へ(${counts[wiz.step]}件)` : "なし — 次へ"}</button>
              ) : (
                <button className={btnPri} onClick={() => applyWizardAndRun(wiz)}>⚙ この内容で自動割当を実行</button>
              )}
            </div>
          </Modal>
        );
      })()}

      {modal && modal.type === "exportCheck" && (() => {
        const g = modal.groups[modal.idx];
        const isLast = modal.idx === modal.groups.length - 1;
        return (
          <Modal title={`出力前チェック ${modal.idx + 1}/${modal.groups.length}: ${g.icon} ${g.title}`} onClose={() => { setModal(null); notify("出力を中止しました", "warn"); }}>
            <div className="flex items-center gap-1 mb-2">
              {modal.groups.map((gg, i) => (
                <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${i === modal.idx ? "bg-sky-600 text-white font-bold" : i < modal.idx ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-400"}`}>
                  {gg.icon}{gg.items.length}
                </span>
              ))}
            </div>
            <div className="text-sm font-bold text-stone-700 mb-1">{g.title}({g.items.length}件)</div>
            <div className="text-sm border border-amber-300 bg-amber-50 rounded p-2 mb-2 max-h-64 overflow-y-auto">
              {g.items.map((x, i) => <div key={i} className="py-0.5 border-b border-amber-100 last:border-0">・{x}</div>)}
            </div>
            {g.advice && <div className="text-xs text-stone-500 mb-3">💡 {g.advice}</div>}
            <div className="flex justify-between items-center">
              <button className={btnSec} onClick={() => { setModal(null); notify("出力を中止しました。修正後にもう一度Excel出力を押してください", "warn"); }}>✋ 中止して直す</button>
              {isLast ? (
                <button className={btnPri} onClick={() => { setModal(null); doExportNow(); }}>⚠ 確認済み — Excelを出力する</button>
              ) : (
                <button className={btnPri} onClick={() => setModal({ ...modal, idx: modal.idx + 1 })}>確認した — 次のチェックへ({modal.groups.length - modal.idx - 1}種類)</button>
              )}
            </div>
          </Modal>
        );
      })()}

      {modal && modal.type === "autoAssign" && (
        <Modal title="⚙ 自動割当の結果" onClose={() => setModal(null)}>
          {modal.actions.length === 0 && modal.unresolved.length === 0 && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2 mb-3">✓ 保留・未割当はありませんでした(すべて割当済みです)。</p>
          )}
          {modal.actions.length > 0 && (
            <div className="mb-3">
              <div className="text-sm font-bold text-emerald-800 mb-1">✓ 割り当てました({modal.actions.length}件)</div>
              <div className="text-sm border border-emerald-200 bg-emerald-50 rounded p-2 max-h-56 overflow-y-auto">
                {modal.actions.map((a, i) => <div key={i} className="py-0.5">・{a}</div>)}
              </div>
            </div>
          )}
          {modal.unresolved.length > 0 && (
            <div className="mb-3">
              <div className="text-sm font-bold text-amber-800 mb-1">⚠ 割り当てできなかったもの({modal.unresolved.length}件)</div>
              <div className="text-sm border border-amber-300 bg-amber-50 rounded p-2 max-h-40 overflow-y-auto">
                {modal.unresolved.map((a, i) => <div key={i} className="py-0.5">・{a}</div>)}
              </div>
              <div className="text-xs text-stone-500 mt-1">時間をずらす・欠席/送迎なしにする等の判断が必要です。状況を書いてAI調整に相談することもできます。</div>
            </div>
          )}
          <div className="text-xs text-stone-500 mb-3">※自動割当はルールを機械的に全チェックして確定的に組みます(一瞬・毎回同じ結果)。「今日は◯◯だから…」のような事情の考慮はAI調整を使ってください。反映後は⚠警告も確認を。</div>
          <div className="flex justify-end">
            <button className={btnPri} onClick={() => setModal(null)}>閉じる</button>
          </div>
        </Modal>
      )}

      {modal && modal.type === "aiLeftover" && (
        <Modal title="⚠ 割り当てできなかったもの" onClose={() => setModal(null)}>
          <p className="text-sm text-stone-600 mb-2">AI調整を反映しましたが、次の項目はまだ割り当てが必要です(車・職員の時間が合わない等)。手動で調整するか、状況を追加指示に書いてもう一度AI調整してください。</p>
          <div className="text-sm border border-amber-300 bg-amber-50 rounded p-2 mb-3 max-h-64 overflow-y-auto">
            {modal.items.map((x, i) => <div key={i} className="py-0.5">・{x}</div>)}
          </div>
          <div className="flex justify-end">
            <button className={btnPri} onClick={() => setModal(null)}>閉じる</button>
          </div>
        </Modal>
      )}

      {modal && modal.type === "importDay" && (
        <ImportModal
          master={sheetMaster || master}
          weekday={weekdayOf(date)}
          targetLabel={(() => { const d = new Date(date + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})の送迎表`; })()}
          onApply={(res) => {
            // この日のシートだけに反映(週間パターンは変更しない)
            updateSheet((prev) => ({
              ...(prev || emptySheet()),
              runs: remapRetired(master, date, res.runs || []),
              blocks: remapRetired(master, date, res.blocks || []),
              training: res.training || "",
              noRide: { ...noRideDefaults(sheetMaster, weekdayOf(date)), ...(res.noRide || {}) },
              ...(res.userAbsent && Object.keys(res.userAbsent).length ? { userAbsent: res.userAbsent } : {}),
              ...(res.userTime && Object.keys(res.userTime).length ? { userTime: res.userTime } : {}),
              ...(res.libertaOn && Object.keys(res.libertaOn).length ? { libertaOn: res.libertaOn } : {}),
              ...(res.libertaOff && Object.keys(res.libertaOff).length ? { libertaOff: res.libertaOff } : {}),
              ...(res.notes ? { notes: res.notes } : {}),
              ...(res.notesStaff ? { notesStaff: res.notesStaff } : {}),
              ...(res.contact ? { contact: res.contact } : {}),
              ...(res.staffOv && Object.keys(res.staffOv).length ? { staffOv: res.staffOv } : {}),
            }));
            setModal(null);
            const d = new Date(date + "T00:00:00");
            notify(`${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})の送迎表に取り込みました(便${res.runs.length}件・予定${res.blocks.length}件)。週間パターンは変更していません。`);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal && modal.type === "import" && (
        <ImportModal
          master={patternMaster || master}
          weekday={weekday}
          onApply={async (res) => {
            const next = {
              runs: res.runs, blocks: res.blocks, training: res.training || "",
              noRide: res.noRide || {}, userTime: res.userTime || {},
              libertaOn: res.libertaOn || {}, libertaOff: res.libertaOff || {},
              notes: res.notes || "", contact: res.contact || "",
              staffOv: res.staffOv || {},
            };
            setPattern(next);
            await sSet(`pattern:${weekday}`, next); // 遅延なしで確実に保存
            setModal(null);
            notify(`${DAYS[weekday]}曜パターンに取り込みました(便${res.runs.length}件・予定${res.blocks.length}件)。「送迎表(日別)」で「パターンから読込」を押すと反映されます。`);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {/* ---------- アプリ内通知(トースト) ---------- */}
      {toast && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] max-w-md w-[92%] rounded-lg shadow-lg px-4 py-3 text-sm font-semibold whitespace-pre-wrap cursor-pointer ${
            toast.type === "warn" ? "bg-amber-100 border border-amber-400 text-amber-900"
            : toast.type === "error" ? "bg-rose-100 border border-rose-400 text-rose-900"
            : "bg-stone-800 text-white"
          }`}
          onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      )}

      {/* ---------- アプリ内確認ダイアログ ---------- */}
      {confirmBox && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => answerConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-4 flex flex-col" style={{ maxHeight: "calc(100vh - 4rem)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm text-stone-800 whitespace-pre-wrap mb-3 overflow-y-auto border border-stone-100 rounded p-2" style={{ minHeight: 0 }}>{confirmBox.msg}</div>
            <div className="flex justify-end gap-2 shrink-0">
              <button className={btnSec} onClick={() => answerConfirm(false)}>キャンセル</button>
              <button className={btnPri} onClick={() => answerConfirm(true)}>はい</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- エラーバウンダリ(万一の実行時エラーでも真っ白にしない) ----------
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "sans-serif", color: "#44403c" }}>
          <h2 style={{ color: "#b91c1c" }}>表示中に問題が発生しました</h2>
          <p>お手数ですが、ページを再読み込みしてください。改善しない場合は、この画面のメッセージをお知らせください。</p>
          <pre style={{ background: "#f5f5f4", padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap", overflow: "auto" }}>
            {String(this.state.error && this.state.error.message || this.state.error)}
          </pre>
          <button
            onClick={() => { try { window.location.reload(); } catch (e) {} }}
            style={{ marginTop: 8, padding: "8px 16px", background: "#0369a1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ===== 保存状況(実態と一致させる：サーバーで反映を確認するまで「保存済み」にしない) =====
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
                  {/* ほかの事業の予定(りんく・ぷれいす版の放課後デイ／それ以外の版の生活介護)の利用者は、この版にいなくて当然なので出さない */}
                  {(() => { const miss = (EDITION === "v3") !== (it.biz === "houkago") ? (it.missingStaff || []) : it.missing; return miss.length > 0 && <div className="text-[12px] text-rose-700">送迎表に見つからない名前: {miss.join("、")}(反映されていません)</div>; })()}
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

// ルール設定とAIへの追加ルールを、AIの指示文に入れる形にする
function aiExtraRulesText(master) {
  const R = rulesOf(master);
  const notes = (R.aiNotes || []).map((x) => x && x.text).filter(Boolean);
  return "- 下の文とルールタブの設定・AIへの追加ルールが食い違うときは、ルールタブの設定・追加ルールを優先する\n" +
    (notes.length ? notes.map((t) => `- 【追加ルール】${t}\n`).join("") : "");
}
// AI案(changes)を送迎表1日分に当てはめた結果を返す(画面は変えない)。AI調整の反映処理と同じ内容
function aiApplyPure(sheetMaster, prev, changes, idMap, logInfo) {
            const sByName = {}; sheetMaster.staff.forEach((s) => { sByName[s.name] = s.id; });
            const vByName = {}; sheetMaster.vehicles.forEach((v) => { vByName[v.name] = v.id; });
            const uByName = {}; sheetMaster.users.forEach((u) => { uByName[u.name] = u.id; });
            const dByName = {}; sheetMaster.departments.forEach((d) => { dByName[d.name] = d.id; });
            let applied = 0;
            let dedupCount = 0; // 重複乗車の自動整理件数
            const capFixed = []; // 定員超過で便から外した人(未割当へ戻る)
            let emptyRemoved = 0; // 利用者ゼロで自動削除した便の数
            const offNames = (logInfo && logInfo.staffOff) || [];
            const timeChanges = (logInfo && logInfo.staffTime) || [];
            const formWc = (logInfo && logInfo.workChanges) || [];
            let finalRuns = null, finalBlocks = null; // 反映結果(残り検証用)
  const next = ((prev) => {
              let runs = [...(prev.runs || [])];
              let blocks = [...(prev.blocks || [])];
              const pin = new Map(); // 今回の変更で利用者が明示的に置かれた便(userId→runId)。重複整理で優先する
              const touched = new Set(); // 今回のAI操作で作成・変更・調整した便(空になったら削除する対象)
              changes.forEach((c) => {
                const ref = idMap[c.id]; // { t: "runs"|"blocks", id }
                if (c.op === "delete" && ref) {
                  if (ref.t === "blocks") blocks = blocks.filter((b) => b.id !== ref.id);
                  else runs = runs.filter((r) => r.id !== ref.id);
                  applied++;
                } else if (c.op === "update" && ref) {
                  const patch = (x) => {
                    const newStaffId = (c.staff && sByName[c.staff]) || x.staffId;
                    const isOwnCar = c.veh === "自車" || c.veh === "自家用車";
                    return {
                      ...x,
                      ...(c.time ? { time: c.time } : {}),
                      ...(c.staff && sByName[c.staff] ? { staffId: sByName[c.staff] } : {}),
                      ...(isOwnCar && newStaffId && newStaffId !== HOLD_ID ? { vehicleId: "own:" + newStaffId }
                        : (c.veh && vByName[c.veh] ? { vehicleId: vByName[c.veh] } : {})),
                      ...(c.dur ? { durMin: Number(c.dur) } : {}),
                      ...(c.dest && dByName[c.dest] ? { destDeptId: dByName[c.dest] } : {}),
                    };
                  };
                  if (ref.t === "blocks") {
                    blocks = blocks.map((b) => (b.id === ref.id ? { ...patch(b), ...(c.label ? { label: c.label } : {}) } : b));
                  } else {
                    runs = runs.map((r) => r.id === ref.id ? {
                      ...patch(r),
                      ...(Array.isArray(c.users) ? { userIds: c.users.map((n) => uByName[stripParen(n)]).filter(Boolean) } : {}),
                      ...(keepAiNote(c.note) ? { note: keepAiNote(c.note) } : {}),
                    } : r);
                    touched.add(ref.id);
                    if (Array.isArray(c.users)) {
                      const rk = (runs.find((r) => r.id === ref.id) || {}).kind || "meet";
                      c.users.map((n) => uByName[stripParen(n)]).filter(Boolean).forEach((u2) => pin.set(rk + "|" + u2, ref.id));
                    }
                  }
                  applied++;
                } else if (c.op === "add") {
                  if (c.kind === "ヘルプ") {
                    const stId = (c.staff && sByName[c.staff]) || HOLD_ID;
                    const isOwnCar = c.veh === "自車" || c.veh === "自家用車";
                    blocks.push({
                      id: uid(), kind: "help", time: c.time || "9:00",
                      staffId: stId,
                      vehicleId: isOwnCar && stId !== HOLD_ID ? "own:" + stId : ((c.veh && vByName[c.veh]) || ""),
                      label: c.label || c.note || "ヘルプ", userIds: [],
                      ...(c.dur ? { durMin: Number(c.dur) } : {}),
                    });
                  } else {
                    const newRunId = uid();
                    touched.add(newRunId);
                    const newKind = c.kind === "送" ? "send" : c.kind === "他" ? "other_run" : "meet";
                    const newUserIds = (c.users || []).map((n) => uByName[stripParen(n)]).filter(Boolean);
                    newUserIds.forEach((u2) => pin.set(newKind + "|" + u2, newRunId));
                    runs.push({
                      id: newRunId, kind: c.kind === "送" ? "send" : c.kind === "他" ? "other_run" : "meet", time: c.time || "8:30",
                      staffId: (c.staff && sByName[c.staff]) || HOLD_ID,
                      vehicleId: (c.veh && vByName[c.veh]) || "",
                      userIds: newUserIds,
                      ...(keepAiNote(c.note) ? { note: keepAiNote(c.note) } : {}),
                      ...(c.dest && dByName[c.dest] ? { destDeptId: dByName[c.dest] } : {}),
                      ...(c.dur ? { durMin: Number(c.dur) } : {}),
                    });
                  }
                  applied++;
                }
              });
              // フォーム入力・自由入力から読み取った職員の休み・時間変更をアプリの勤務設定にも登録
              let staffOv2 = prev.staffOv || {};
              formWc.forEach((w) => {
                staffOv2 = { ...staffOv2, [w.id]: { ...(staffOv2[w.id] || {}), ...(w.off ? { off: true } : { start: w.start, end: w.end }) } };
              });
              offNames.forEach((nm2) => {
                const st2 = sheetMaster.staff.find((s) => s.name === nm2 || nm2.startsWith(s.name));
                if (st2) staffOv2 = { ...staffOv2, [st2.id]: { ...(staffOv2[st2.id] || {}), off: true } };
              });
              timeChanges.forEach((x) => {
                const st2 = sheetMaster.staff.find((s) => s.name === x.name || String(x.name).startsWith(s.name));
                if (st2) staffOv2 = { ...staffOv2, [st2.id]: { ...(staffOv2[st2.id] || {}), ...(x.start ? { start: x.start } : {}), ...(x.end ? { end: x.end } : {}) } };
              });
              // 反映後の自動整理: 同じ人が同じ種別(迎え/送り)の複数便に残っていたら、
              // AIの変更で明示された便を優先し、それ以外から自動で外す(訓練フラグは別種別なので対象外)
              ["meet", "send"].forEach((k) => {
                const seen = new Set();
                runs = runs.map((r) => {
                  if (r.kind !== k || r.mode === "train" || r.mode === "move") return r; // 移動便は送迎ではないので重複の対象外
                  const kept = (r.userIds || []).filter((u2) => {
                    if ((r.trainUserIds || []).includes(u2)) return true;
                    const pk = k + "|" + u2;
                    if (pin.has(pk) && pin.get(pk) !== r.id) { dedupCount++; touched.add(r.id); return false; }
                    if (seen.has(u2)) { dedupCount++; touched.add(r.id); return false; }
                    seen.add(u2);
                    return true;
                  });
                  return kept.length === (r.userIds || []).length ? r : { ...r, userIds: kept };
                });
              });
              // 定員超過の自動調整: AIの案で定員を超えた便は、後から追加された人(配列の末尾)から外して未割当へ戻す
              runs = runs.map((r) => {
                if (r.mode === "walk") return r;
                const veh = resolveVehicle(sheetMaster, r.vehicleId);
                if (!veh || veh.own) return r;
                const isWc = (id) => { const u2 = sheetMaster.users.find((x) => x.id === id); return !!(u2 && u2.wheelchair); };
                const wcMax = veh.wheelchairOK ? (veh.capWc || 0) : 0;
                let ids = [...(r.userIds || [])];
                const riderStaff = (r.staffRiderIds || []).length;
                while (ids.length && (ids.length + riderStaff > veh.capNormal || ids.filter(isWc).length > wcMax)) {
                  // 車いす超過なら末尾側の車いすの人、通常超過なら末尾の人を外す
                  const overWc = ids.filter(isWc).length > wcMax;
                  let idx = ids.length - 1;
                  if (overWc) { for (let k2 = ids.length - 1; k2 >= 0; k2--) { if (isWc(ids[k2])) { idx = k2; break; } } }
                  const removed = ids.splice(idx, 1)[0];
                  touched.add(r.id);
                  const nm3 = (sheetMaster.users.find((x) => x.id === removed) || {}).name || "?";
                  capFixed.push(`${nm3}(${r.time}の${r.kind === "meet" ? "迎え" : r.kind === "send" ? "送り" : ""}便・${veh.name}定員${veh.capNormal})`);
                }
                return ids.length === (r.userIds || []).length ? r : { ...r, userIds: ids };
              });
              // 空の便の自動削除: 「今回のAI操作で作成・変更した便」が空になった場合のみ削除。
              // 元からある移動用の便や、メモ・名称に「移動」「回送」とある便は利用者ゼロでも残す
              runs = runs.filter((r) => {
                if (r.kind !== "meet" && r.kind !== "send") return true; // 回送・外出(他)は対象外
                if (r.mode === "move") return true; // 移動便は乗客がいなくても残す
                if (!touched.has(r.id)) return true; // 今回触っていない便は消さない
                if (/移動|回送/.test((r.note || "") + (r.label || ""))) return true;
                const riders = (r.userIds || []).length + (r.trainUserIds || []).length + (r.staffRiderIds || []).length;
                if (riders === 0) { emptyRemoved++; return false; }
                return true;
              });
              finalRuns = runs; finalBlocks = blocks;
              return { ...prev, runs, blocks, staffOv: staffOv2 };
  })(prev);
  return { next, applied, dedupCount, capFixed, emptyRemoved };
}
// 出力前チェックの結果(groups)を返す。Excel出力の前に出るチェックと同じ内容
function collectSheetChecks(sheetMaster, sheet, date, patDayArg) {
    const sheetData = { staffOv: {}, userAbsent: {}, userDept: {}, notes: "", contact: "", ...sheet, blocks: canonHelpBlocks((sheet && sheet.blocks) || []),
      noRide: { ...noRideDefaults(sheetMaster, weekdayOf(date)), ...((sheet && sheet.noRide) || {}) } };
    const wd = weekdayOf(date);
    // 保留件数(担当未定+担当者が表にいない予定)を出力時と同じ基準で数える
    const known = new Set(sheetMaster.staff.map((s) => s.id));
    const ovv = sheetData.staffOv || {};
    const working = new Set(
      sheetMaster.staff.filter((s) => !(s.offDays || []).includes(wd) || !!(ovv[s.id] || {}).workToday).map((s) => s.id)
    );
    const isHold = (sid) => sid !== REQ_ID && (sid === HOLD_ID || !known.has(sid) || !working.has(sid));
    const holdCount =
      sheetData.runs.filter((r) => isHold(r.staffId)).length + sheetData.blocks.filter((b) => isHold(b.staffId)).length;
    // 送迎漏れ(利用予定日なのに迎え・送りが未入力)
    const absent = sheetData.userAbsent || {};
    const scheduled = sheetMaster.users.filter((u) => (u.days || []).includes(wd) && !absent[u.id]);
    const inRuns = (kind) => {
      const set = new Set();
      sheetData.runs.forEach((r) => {
        r.userIds.forEach((id) => { if (rideIs(rideKindOf(r, id), kind)) set.add(id); });
      });
      return set;
    };
    const meetSet = inRuns("meet"), sendSet = inRuns("send");
    const noRideChk = sheetData.noRide || {};
    const missMeet = scheduled.filter((u) => !meetSet.has(u.id) && !(noRideChk[u.id] || {}).meet).map((u) => u.name);
    const missSend = scheduled.filter((u) => !sendSet.has(u.id) && !(noRideChk[u.id] || {}).send).map((u) => u.name);

    // ヘルプ表で決めた基本の担当と違うものを最終確認用に一覧化
    const helpDiffList = helpBaseWarn(sheetMaster, sheetData, wd);

    // 送迎なし(受診後来所・家族送迎など)の人を最終確認用に一覧化
    const noRideList = [];
    scheduled.forEach((u) => {
      const nrU = noRideChk[u.id] || {};
      const txt = (k) => (typeof nrU[k] === "string" && nrU[k] ? nrU[k] : "送迎なし");
      // いつもどおり(利用者タブの家族送り・家族迎えと同じ)なら確認しない
      // いつもが家族送迎(家族送り・家族迎え・母迎えなど)の人に、家族系の理由(家族送・家族迎・母迎え…)が付いていれば
      // 文言が少し違ってもいつもどおりとみなす。受診後来所など家族以外の理由は確認に出す
      const isUsual = (k) => { const f = familyDefaultOf(u, k, wd); const r0 = txt(k); return !!f && (normPlace(r0) === normPlace(f) || isFamilyPlace(r0)); };
      const nm = nrU.meet && !isUsual("meet"), ns = nrU.send && !isUsual("send");
      if (nm && ns) noRideList.push(`${u.name}: 迎え・送りとも入れていません(${txt("meet")} / ${txt("send")})`);
      else if (nm) noRideList.push(`${u.name}: 迎えを入れていません(${txt("meet")})`);
      else if (ns) noRideList.push(`${u.name}: 送りを入れていません(${txt("send")})`);
    });

    // 迎え先・送り先がいつもと違う人を最終確認用に一覧化
    const placeList = [];
    (sheetData.runs || []).forEach((r) => {
      if (r.kind !== "meet" && r.kind !== "send") return;
      const k2 = r.kind === "send" ? "send" : "meet";
      placeChangesOf(r).forEach((x) => {
        const u = sheetMaster.users.find((y) => y.id === x.id);
        if (!u || familyDefaultOf(u, k2, wd)) return;
        placeList.push(`${u.name}: ${k2 === "send" ? "送り" : "迎え"}先が「${x.place}」になっています(いつもは${defPlaceOf(u, k2, wd)}) — ${r.time}の便`);
      });
    });

    // いつもは家族送り・家族迎え(送迎なし)なのに、便に入っている人
    scheduled.forEach((u) => {
      ["meet", "send"].forEach((k) => {
        const fam = familyDefaultOf(u, k, wd);
        if (!fam) return;
        const r = (sheetData.runs || []).find((x) => x.kind === k && (x.userIds || []).includes(u.id));
        if (!r) return;
        const pl = normPlace((r.places || {})[u.id]);
        placeList.push(`${u.name}: いつもは${fam}ですが、${r.time}の${k === "send" ? "送り" : "迎え"}便に入っています${pl ? `(行き先: ${pl})` : ""}`);
      });
    });

    // 通常外のヘルプ・その他予定: 欄と送迎表を両方向で突き合わせる
    const extraList = [];
    {
      const patDay = patDayArg;
      const xc = extraHelpCheck(sheetMaster, sheetData, wd, patDay);
      xc.missing.forEach((e) => extraList.push(`${extraHelpLabel(sheetMaster, e)}: 通常外の欄にありますが、送迎表に入っていません`));
      xc.unlisted.forEach((h) => {
        extraList.push(`${EXTRA_KIND_JP[h.kind]} ${h.time} ${h.label}(担当: ${extraStaffOf(sheetMaster, sheetData.blocks, h)}): 週間パターンに無い通常外の${EXTRA_KIND_JP[h.kind]}ですが、通常外の欄に書かれていません`);
      });
    }

    // その他のルール(チェックを入れたもの)を出力前の確認に出す
    const otherRuleList = (rulesOf(sheetMaster).otherRules || [])
      .filter((x) => x && String(x.text || "").trim() && x.check !== false && (!(x.days || []).length || (x.days || []).includes(wd)))
      .map((x) => String(x.text).trim());

    // ==== 出力前チェック: エラーを種類ごとに集め、段階的に確認するモーダルへ ====
    const critical = [], vehErr = [], timeErr = [], otherErr = [];
    sheetData.runs.forEach((r) => {
      const ws2 = runWarnings(r, sheetMaster, sheetData, wd).filter((w) => w !== "担当未定(保留)");
      const stf = sheetMaster.staff.find((s) => s.id === r.staffId);
      const pre = `${stf ? stf.name : "保留"} ${r.time}【${RUN_KINDS[r.kind] || "予定"}】: `;
      ws2.forEach((w) => {
        if (/🚫/.test(w)) critical.push(pre + w);
        else if (/定員|車いす|車両|車が|車は/.test(w)) vehErr.push(pre + w);
        else if (/勤務時間外|固定休|休み|時間帯|重複/.test(w)) timeErr.push(pre + w);
        else otherErr.push(pre + w);
      });
    });
    if (holdCount) critical.push(`保留(担当未定)の予定が ${holdCount} 件残っています`);
    [...requiredHelpWarn(sheetMaster, sheetData, wd), ...fixedBlockWarn(sheetMaster, sheetData, wd), ...blockOverlapWarn(sheetMaster, sheetData), ...helpTwoShortages(sheetMaster, sheetData, wd), ...kubotaPlacementWarn(sheetMaster, sheetData, wd), ...maleOnlyHelpWarn(sheetMaster, sheetData), ...pikaStaffWarn(sheetMaster, sheetData, wd)].forEach((w) => critical.push(w));

    const rideMiss = [];
    if (missMeet.length) rideMiss.push(`迎えが未入力(${missMeet.length}名): ${missMeet.join("・")}`);
    if (missSend.length) rideMiss.push(`送りが未入力(${missSend.length}名): ${missSend.join("・")}`);

    // 男性不在(許容超)・職員数の区間チェック
    const maleErr = [];
    {
      const hours2 = [];
      for (let t2 = 8 * 60; t2 <= 18 * 60; t2 += SLOT) hours2.push(t2);
      const calc2 = buildCoverageCalc(sheetMaster, sheetData, wd, hours2);
      const gs2 = maleGapStatus(sheetMaster, calc2);
      const rangeText = (list) => {
        const out2 = [];
        let st2 = null, prev = null;
        list.forEach((t2) => {
          if (st2 == null) { st2 = t2; prev = t2; return; }
          if (t2 === prev + SLOT) { prev = t2; return; }
          out2.push([st2, prev + SLOT]); st2 = t2; prev = t2;
        });
        if (st2 != null) out2.push([st2, prev + SLOT]);
        return out2.map(([a, b2]) => `${toStr(a)}〜${toStr(b2)}`).join("、");
      };
      sheetMaster.departments.forEach((d) => {
        const overs = hours2.filter((t2) => (gs2[d.id] || {})[t2] === "over");
        if (overs.length) maleErr.push(`${d.name}: 男性職員不在が許容時間を超える区間 → ${rangeText(overs)}`);
        const tol = d.staffMin != null && d.staffMin !== "";
        if (tol) {
          const unders = hours2.filter((t2) => { const cc = (calc2.find((c) => c.t === t2) || {}).cnt; const v = cc && cc[d.id]; return v && v.u > 0 && v.s < Number(d.staffMin); });
          if (unders.length) maleErr.push(`${d.name}: 在席職員が最低${d.staffMin}名を下回る区間 → ${rangeText(unders)}`);
        }
        if (d.staffMax != null && d.staffMax !== "") {
          const overs2 = hours2.filter((t2) => { const cc = (calc2.find((c) => c.t === t2) || {}).cnt; const v = cc && cc[d.id]; return v && v.s > Number(d.staffMax); });
          if (overs2.length) maleErr.push(`${d.name}: 職員が上限${d.staffMax}名(駐車制約)を超える区間 → ${rangeText(overs2)}`);
        }
      });
    }

    const groups = [];
    const addG = (icon, title, items, advice) => { if (items.length) groups.push({ icon, title, items, advice }); };
    addG("🚫", "重大エラー(修正を強くお勧め)", critical, "保留・体制の不備は表の信頼性に直結します。⚙自動割当かAI調整で解消できます");
    addG("👥", "乗せ忘れ(未割当)", rideMiss, "未割当パネルからドラッグするか、名前をクリックしてAIに割り当てさせてください");
    addG("🧑\u200d🤝\u200d🧑", "ヘルプの担当が基本と違う(最終確認)", helpDiffList, "ヘルプ表で決めた「この曜日はこの人」と違う担当になっています。代わりで良ければそのまま進めてください");
    addG("🆘", "通常外のヘルプ・その他予定の確認", extraList, "画面下の「通常外のヘルプ・その他予定」欄と、送迎表に入っている予定が合っていません。入れ忘れ・書き忘れがないか確認してください");
    addG("🏥", "送迎なしの人の最終確認", noRideList, "受診後来所・家族送迎などで送迎を入れていない人です。本当にこの扱いでよいか確認してください");
    addG("🏠", "いつもと違う送り先・迎え先(最終確認)", placeList, "利用者タブの「いつもの迎え先・送り先」(自宅・ﾘﾍﾞ・家族送り・家族迎えなど)と違っています。この内容で合っていれば、そのまま進めてください");
    addG("🚗", "車両のエラー(定員・重複・位置)", vehErr, "🚗使える車パネルで空き車を確認して差し替えてください");
    addG("⏰", "時間のエラー(勤務時間外・重複)", timeErr, "職員名クリックで勤務時間の確認、または担当の変更を");
    addG("🚻", "男性不在・職員数の区間", maleErr, "人数・男性カバー表で該当時間帯の色を確認してください");
    addG("📋", "その他の警告", otherErr, "");
    addG("📌", "その他のルール(確認)", otherRuleList, "ルールタブ「⑨ その他のルール」で確認を求めている決まりごとです。守れていればそのまま進めてください");

    return groups;
}
// AIに渡す当日の状態(職員・利用者・車・便・ヘルプ・未割当・保留)
function aiContextOf(master, data, weekday) {
    const dn = (id) => { const d = master.departments.find((x) => x.id === id); return d ? d.name : ""; };
    const ov = { ...(data.staffOv || {}) };
    const absent = data.userAbsent || {};
    const { isLibOn } = makeLibNameHelpers(data, weekday);
    const staffOn = master.staff.filter((s) => !s.noGrid).map((s) => {
      const o = ov[s.id] || {};
      const off = !!o.off || ((s.offDays || []).includes(weekday) && !o.workToday);
      const libDept = master.departments.find((d2) => /リベルタ/.test(d2.name));
      return { name: s.name, dept: dn(belongDeptOf(master, s, weekday)), time: `${o.start || s.start}-${o.end || s.end}`, male: !!s.isMale, ...(libDept && s.deptId === libDept.id ? { lib: true } : {}), ...(s.helpOnly ? { helpOnly: true } : {}), off };
    });
    const users = master.users.filter((u) => (u.days || []).includes(weekday)).map((u) => {
      const nr = (data.noRide || {})[u.id] || {};
      const t = userTimeOf(u, weekday, data.userTime);
      return {
        name: u.name, dept: dn(u.deptId), male: !!u.isMale, absent: !!absent[u.id], wc: !!u.wheelchair,
        libAM: (u.libertaAM || u.libertaPM) ? isLibOn(u, "meet") : false,
        libPM: (u.libertaAM || u.libertaPM) ? isLibOn(u, "send") : false,
        meet: nr.meet ? `なし(${nr.meet})` : (t.meet || ""),
        send: nr.send ? `なし(${nr.send})` : (t.send || ""),
        ...(u.helpNote ? { note: u.helpNote } : {}),
      };
    });
    const vehicles = master.vehicles.map((v) => ({ name: v.name, dept: dn(v.deptId), base: dn(vehicleHomeOf(master, v)), cap: v.capNormal, wc: v.wheelchairOK ? v.capWc : 0, ...(v.memo ? { note: v.memo } : {}) }));
    const runs = (data.runs || []).map((r, i) => ({
      id: "r" + (i + 1), _id: r.id,
      kind: r.kind === "meet" ? "迎" : r.kind === "send" ? "送" : "他", mode: r.mode || "", time: r.time, dur: Number(r.durMin) || 30,
      ...(r.destDeptId ? { dest: dn(r.destDeptId) } : {}),
      staff: (master.staff.find((s) => s.id === r.staffId) || {}).name || (r.staffId === HOLD_ID ? "保留" : "?"),
      veh: (resolveVehicle(master, r.vehicleId) || {}).name || "",
      users: (r.userIds || []).map((id) => (master.users.find((u) => u.id === id) || {}).name).filter(Boolean),
    }));
    // 未割当(迎え/送りがどの便にも入っていない人。訓練は別枠、送迎なし・欠席は除外)
    const asgMeet = new Set(), asgSend = new Set();
    (data.runs || []).forEach((r) => {
      if (r.kind !== "meet" && r.kind !== "send") return;
      (r.userIds || []).forEach((id) => { const k9 = rideKindOf(r, id); if (k9 && k9 !== "send") asgMeet.add(id); if (k9 && k9 !== "meet") asgSend.add(id); });
    });
    const nrAll = data.noRide || {};
    const schedUsers = master.users.filter((u) => (u.days || []).includes(weekday) && !absent[u.id]);
    const unMeet = schedUsers.filter((u) => !(nrAll[u.id] || {}).meet && !asgMeet.has(u.id)).map((u) => u.name);
    const unSend = schedUsers.filter((u) => !(nrAll[u.id] || {}).send && !asgSend.has(u.id)).map((u) => u.name);
    const helps = (data.blocks || []).filter((b) => b.kind === "help").map((b, i) => ({
      id: "h" + (i + 1), _id: b.id, time: b.time,
      staff: (master.staff.find((s) => s.id === b.staffId) || {}).name || (b.staffId === HOLD_ID ? "保留" : "?"),
      label: b.label || "", veh: (resolveVehicle(master, b.vehicleId) || {}).name || "",
      dur: helpDurMin(b),
      ...(b.note ? { note: b.note } : {}),
    }));
    const holdIds = runs.filter((r) => r.staff === "保留" || r.staff === "?").map((r) => r.id);
    const holdHelpIds = helps.filter((h) => h.staff === "保留" || h.staff === "?").map((h) => h.id);
    return { staffOn, users, vehicles, runs, helps, dn, unMeet, unSend, holdIds: [...holdIds, ...holdHelpIds] };
}
// 送迎表のルール(AI調整と同じ)
function aiRulesText(master) {
  return `${aiExtraRulesText(master)}# 拠点間の車での移動時間(分・概算)
${Object.entries(DEPT_TRAVEL_MIN).map(([k, v]) => k.replace("|", "→") + ":" + v).join("、")}
# ルール
- 欠席者(absent:true)を便から外す。担当職員が休み(off:true)の便は出勤中の職員へ振り替える(同じ部署を優先)
- 各事業所で「利用者が居るのに男性職員(male:true)がゼロ」の時間が連続で許容分数を超えないように運転手を選ぶ。許容: ${master.departments.map((d) => `${d.name}=${d.maleGapMin != null ? d.maleGapMin : 30}分`).join("、")}
- 【必須】未割当ゼロ: 上の「未割当」リストの全員を必ず便に入れる。既存便への追加を優先し、時間・定員が合わなければ便を新設する。1人も残さないこと。変更件数の上限より優先する
- 【必須】重複禁止: 1人の利用者は同じ種別(迎え/送り)で1つの便にだけ乗せる。利用者を別の便へ移すときは、移動先(addまたはusers追加のupdate)と、移動元の便からその人を外したupdate(usersを除外後の配列で指定)の両方を必ず出すこと。移動元の除外を忘れると重複になる
- 【必須】定員超過禁止: 便に利用者を追加・移動する前に必ず人数を数えること。(その便の利用者数+同乗職員数)が車の定員(cap)を超える案は出してはいけない。車いす(wc:true)の人数はその車の車いす枠(capWc)以内。乗せたい人数が入らない場合は、より大きい車への変更か便の分割を提案する
- 【必須】空の便禁止: 利用者が1人も乗らない迎え/送り便を作らない・残さない。必ず「誰を送迎するか」を先に決め、その後にその便に合う車を充てる順で考えること。利用者を全員移動して空になる便は削除(remove)のchangeを出す。車や職員の移動だけの便が必要なときは種別「他」を使うか、noteに「移動」「回送」と書く(その場合は利用者なしでも残る)
- 在席上限: ${master.departments.filter((d) => d.capMax != null && d.capMax !== "").map((d) => `${d.name}は各時間帯の在席人数(職員+利用者の合計)が${d.capMax}名を超えないように配置する`).join("。") || "なし"}。超えそうな場合は利用者の他事業所への中継移動や応援の出し方で調整する
- 職員数の上限: ${master.departments.filter((d) => d.staffMax != null && d.staffMax !== "").map((d) => `${d.name}は駐車場の制約で同じ時間帯に居られる職員が最大${d.staffMax}名(公用車と自車を合わせて${d.staffMax}台分)`).join("。") || "なし"}。応援や当日移動でこれを超える配置にしない
- 職員数の下限: ${master.departments.filter((d) => d.staffMin != null && d.staffMin !== "").map((d) => `${d.name}は利用者が居る時間帯の在席職員を最低${d.staffMin}名確保する`).join("。") || "なし"}。送迎・ヘルプで同時に出すぎて下回らないように組む
- リベルタ職員(lib:true)は基本、送迎便の担当にしない(ヘルプの担当を優先してあてる)。送迎の振替先はリベルタ以外の職員を優先し、どうしても居ない場合のみリベルタ職員を使う。既にパターンで担当している便(リベ迎のドラ便など)はそのままでよい
- リベルタ職員(lib:true)は基本、自家用車で各事業所へ移動する(公用車での通勤移動はしない。ドラ便担当者がドラをリベルタへ戻した後も自車で移動)
- 朝の直行ルール: 朝一に「自家用車で移動」の予定が付く職員は、嫁島以外の自部署へ直行する職員である。その移動時間帯(重なる30分)に同じ職員へ便・ヘルプを入れてはいけない(移動と送迎は同時にできない)。その職員に朝の便を任せたい場合は、移動が終わって自部署に着いた後の時刻の便にする。移動チップを作るときも同時刻の予定と重複させない
- 職員の直帰ルール: 成瀬・村松・春日は自車で川津に直接出勤しているため、1日の最後は川津に居る状態で終わらせる(最後の送迎で他部署や嫁島に行ったまま終わる案は不可)。それ以外の職員(リベ職員を除く)は嫁島出勤なので、1日の最後は公用車の終業回送とあわせて嫁島へ戻る形でよい。勤務終了の30分前以降に終わる予定を他部署の職員に割り当てない(例: 川津の成瀬が16時退勤なのに嫁島の三澤の16:00徒歩送りを担当する、は不可)
- 徒歩の単独送迎(門脇・三澤)は必ず利用者と同じ部署(嫁島)の職員が担当する。他部署の職員には割り当てない
- 中村のリベルタへの送りは2便目(17:00)に固定。1便目(16:00)や混載便に乗せない
- 中村の帰宅送り(自宅方面)は17:00以降に自宅着とする。所要約20分なので16:40より前に出発する便に乗せない
- 馬場は基本家族送迎(送迎なし)。送迎する場合は片道15分程度で、送りは17:00に嫁島を出発する(17:15頃着)
- 田中かの送りは16:30までに自宅着とする。片道15分程度なので16:15までに嫁島を出発する便に乗せる
- 同乗NG(相性): 早川と梶谷光、早川と梶谷奏は同じ便に乗せない
- 時刻厳守の利用者: ホン(迎9:30・はばたき16:15着)、小林(迎9:00・送16:30)、赤山の朝8:40。この3件は時刻をずらす提案をしない。他の川津利用者は±10分まで可
- 川津の回り便の組み合わせ目安: 月=田原・小林・赤山/水=青木・小林・赤山/金=青木・小林・田原。錦織秀は米原と同じ便なら米原の後に迎え(9:40ごろ)
- 野津彩・早川・錦織秀は車椅子だが座位可能。マイメロに車椅子3名利用でもこの3名は同乗できる
- 【必須】保留ゼロ: staff:"保留"の予定すべてに出勤中の職員を割り当てる(updateでstaffを指定)。時間帯が空いている同じ事業所の職員を優先
- 出力前の自己確認: changesを適用した結果、未割当リストの全員が便に入り、保留の予定すべてにstaffが付いていることを確認してから出力する
- どうしても割り当てられないもの(車・職員の時間がすべて重なる等)は、矛盾した案を無理に出さず "unresolved" に項目と理由を書いて残す(空なら省略可)
- 状況・要望の文中に職員の休み・欠勤(例: 「安達休み」「高井は病欠」)が書かれていたら: ①その職員を休み扱いにして担当便・ヘルプをすべて他の職員へ振り替え、②"staffOff"にその職員名を列挙する(アプリ側で休み登録される)。書かれていなければstaffOffは省略可
- 状況・要望の文中に職員の勤務時間変更(例: 「高井は10時から」「安達は15時で早退」)が書かれていたら: ①その時間外の担当を振り替え、②"staffTime"に名前と開始・終了を入れる(アプリ側で時間変更登録される)。片方だけの変更なら、変わらない方は元の時刻を入れる
- 送迎不要("なし")の人は便に乗せない。すでにその方向の便に乗っている場合は必ず外す。乗せ忘れ(利用予定・欠席でない・その方向の便に居ない人)がいれば既存便に追加するか便を新設
- 便の時刻と乗車者の希望時刻(meet/send)が${TIME_GAP_WARN_MIN}分以上ズレている便は、元パターンの時刻がずれていることが多いので、便の時刻を希望時刻付近へ振り直すか、その利用者を時間帯の合う別の便へ移す。迎え便は施設発のため希望到着の30〜60分前の出発が目安。時刻を変える場合は同乗者全員の希望・職員の勤務時間・車の空きと両立する時刻を選ぶこと
- 定員(cap)を守る。車いす(wc:true)の人は wc>0 の車のみ
- 便の時刻は担当職員の勤務時間内にする
- 職員や車が足りない場合は、他の事業所の職員+車で応援してよい(例: A事業所の利用者をB事業所の職員がB事業所の車で送迎)。その際は職員と車を同じ事業所の組み合わせにする
- 1つの便に複数事業所の利用者を混載してよい(例: C事業所の職員がC事業所の車で、A事業所とB事業所の利用者をまとめて送迎)
- ある事業所の職員が居なくなる時間帯は、その事業所の利用者を先に別事業所へ移動させ(kind:"他"の移動便、noteに「◯◯へ移動」と書く)、後で移動先の事業所から自宅へ送る2段構成にしてよい。その場合、後の送り便の出発事業所は移動先になる
- 同じ車・同じ職員を、時間の重なる複数の予定(time〜time+dur分)に入れない
- 朝の送迎の基本形: リベルタ職員(lib:true)以外の職員は朝は嫁島スタート(自家用車で直接自分の事業所へ行く場合を除く)。各職員は最初または2回目の迎え便で利用者を乗せ、そのまま自分の担当事業所へ向かう(嫁島発→利用者宅→担当事業所着)。朝の迎え便の組み立てはこの形を前提にする
- 朝のピカチュウ便(リベ迎え+田中便)の担当は曜日で固定: 月=安達、火=吉岡、水=高井、木=池田、金=安達。固定担当が休みの日以外は変更しない(固定担当が休みなら同じ事業所の職員で代役)
- 朝8:00のヘルプの固定: 黒田ヘルプ=井川がドナルドで(平日毎日)。藤井ヘルプ=火・金は余村慎が自車で、月・水・木は久保田がカービィで。担当が休みの日以外は変更しない
- 野津涼のヘルプの担当は火曜=余村慎、それ以外の曜日=余村和で固定。担当が休みの日以外は変更しない
- 12:00の透析対応の担当は固定: 月・火=高井、水・木=池田、金=伊達。担当が休みの日以外は変更しない
- リベルタ職員の時間帯ルール: 早番(9時前始業)は基本10時ごろから各事業所へ行くので、10時前の送迎便を新たに割り当てない(既存の9:30便は容認)。遅番(19時以降終業)は15:30頃にはリベルタに行くので、15:30以降の送迎便を割り当てない。ヘルプは被らない限りどちらも可
- 車の基地(朝のスタート=1日の最終帰着地): トラッキー=川津、ノンタン=あいのて、ドラ=リベルタ、それ以外は全て嫁島。1日の最後は各車を基地へ戻す形で便を組む
- 職員の通勤: リベ職員と成瀬・村松・春日以外は基本嫁島出勤で、そこから公用車で各事業所へ移動する(1日の最後も公用車の終業回送とあわせて嫁島へ戻る)。成瀬・村松・春日は自車で川津に直接出勤・直帰。リベ早番=リベ発→10時ごろ自車で各事業所→事業所で終了。リベ遅番=各事業所発→最終は自車でリベルタへ
- 入浴対応はヘルプ扱い。「入浴」とある予定は種別「ヘルプ」として職員を振ること(黒田・井上の15時以降は2名体制ルールも適用)。入浴を送迎便として扱わない
- リベルタへの送り(リベ送)の基本時刻: 嫁島=1便目16:00・2便目17:00。津田=同じく1便目16:00・2便目17:00。川津=17:00の1便のみ。あいのて=17:00(定員的に1便で乗り切らない場合のみ2便目を追加)。この基本時刻から大きく変えない
- リベ送の車: 嫁島発=セレナ、津田発=ピカチュウを基本にする。朝はピカ=嫁島行き・セレナ=津田行きなので、日中のどこか(活動や昼の移動のついで)で2台を入れ替える運用。夕方のリベ送でこの組み合わせから変えない
- リベルタ発の朝の便構成(毎日): 嫁島行きは8:30が1便目(ピカチュウ)、9:30に2便目・3便目(うち1台はドラ)。シエル行きは9:00に1〜2便。9:30のドラ便の職員は利用者を嫁島へ送った後、ドラを1人でリベルタへ戻し(ドラの基地=リベルタ)、その後は自家用車で自分の事業所へ移動する。この便構成は変えない
- 車の動き: 朝はbaseから出発→迎え後は職員の事業所に置かれる→途中の送り後も職員の事業所→最後の送りの後はbaseへ戻る。送りの出発時にその車がその事業所に無い組み合わせは避ける
- 応援・中継・車の移動を計画するときは、上の拠点間移動時間を所要(dur)に見込む。例: 津田の職員が川津の利用者を応援送迎するなら往路10分+送迎時間+復路10分
- helpOnly:trueの職員(久保田)は送迎便(迎え・送り)の担当にしない。ヘルプの担当のみ可
- 黒田・井上の夕方(15時以降)のヘルプは必ず同じ時刻に職員2名(同時刻のヘルプ2件)にする
- 窪田に松浦以外のヘルプを担当させる日は、窪田を嫁島配置(兼務先でなく嫁島側)として扱う
- 松浦は車いす。カービィは車いす不可のため、松浦のヘルプ・移送にはカービィを使わない(ケロッピーなど車いす対応車を使う)
- 錦織りは後部座席に乗せる(助手席は物を捨てたりすることがあり危ない)
- 時刻厳守の利用者(津田): 勝部(迎9:30・はばたき16:15着)、竹田寛(迎9:30・9:45を過ぎたら親の送りになる)、橋本(迎9:30・送17:30)
- 時刻厳守の利用者(あいのて): 増野(迎8:45/送16:45)、成相(迎8:00・嫁島で乗車)、石田の朝(迎8:40)。他のあいのて利用者は±10分可
- 竹田寛の迎えは乗り込みが大変な時があるため、常勤職員が担当するのが望ましい
- 津田の夕方の送りはケアウイングの予定次第で当日変動が多い。16:00ごろに嫁島から津田へ回る送り便を基本形として組んでよい(常勤2名のため15:50までの送り出しが難しい)
- 安部は水・木の16:00から黒田のヘルプに入る(現場では「シエルヘルプ」と呼ぶが黒田ヘルプと同じもの。二重に登録しない)
- 訓練がある利用者の送迎は4パターン: ④迎え(自宅で拾ってそのまま訓練先へ送る。例: 火曜・金曜の朝8:00の野津彩)。この便は「自宅で拾ってそのまま訓練先へ送る人」に登録し、表示は迎(訓送)。その日の迎えとして数えるので訓練送りの便を別に作らない
- 訓練がある利用者の送迎は3パターン: ①迎え→訓練送り→訓練迎え→送り(訓練の2便は別枠) ②迎え(訓練迎えが通常の迎えを兼ねる)→送り ③迎え→送り(訓練送りが通常の送りを兼ねる)。②③の便は「通常の迎え/送りも兼ねる人」に登録し、表示は迎(訓練)/送(訓練)になる。兼用にした人はその日の迎え/送りとして数えるので未割り当てにしない
- あい迎(あい迎①②など)はリベルタ発ではない。乗客(山崎・森口・梶谷奏・青山・藤井など)は自宅から拾ってあいのてへ送る通常の迎え便
- ヘルプの担当ルール: 女性利用者(male:false)のヘルプ(松浦のヘルプを除く)は、火曜・金曜以外は久保田を優先して担当にする(久保田は火・金が固定休)。男性利用者(male:true)の歯科受診ヘルプは、リベルタ所属(lib:true)の男性職員を優先する。赤山の入浴ヘルプは男性職員(male:true)のみ担当可(女性は不可)
- ヘルプの移動手段(必須): ヘルプには必ず車を付ける。使えるのは(a)担当職員がその時間に居る部署に置いてある公用車(車の現在地は「朝はbase→迎え後は職員の部署」の動きで判断)か、(b)担当職員の自車(veh:"自車")のどちらかだけ。他の部署にある車を割り当ててはいけない。部署に空き車が無ければ自車にする
- 生活介護の活動時間(10:30〜12:00と13:30〜15:00)は次の車が活動に使われ送迎に使えない: 嫁島=ピカチュウ、津田=セレナ、川津=マイメロ。あいのては4台のうち任意の2台を活動用に空けておく(=この時間帯にあいのての車を3台以上送迎に使わない)。例外: 訓練の人の迎え・送り(訓迎/訓送)は、活動に出ている車が活動の途中で拾ってよい
- 車の配置が良くない場合(送りの時刻にその事業所に車が無い等)は、便の "dest"(終了後に車を置く事業所)や "dur"(所要分)の変更・車の入れ替えを提案してよい。「この車は◯時以降△△に置いた方がよい」等の配置の助言があればnotesに書く
- 問題のない便は変更しない(changesに含めない)
- 変更が多い場合は重要なもの(未割当の解消・欠席・休み・送迎なし・重複の解消)を優先する。未割当の解消に必要な変更は件数の目安(15件)を超えてもよい`;
}

/* ============================================================
   💬 AIと相談：会話しながら送迎表・利用者・ルール・週間パターンを変える
   ・AIの案はすべて「下書き」に当てはめる。送迎表は出力前チェックと同じ基準で確かめ、問題が残れば自動でAIに差し戻す(最大2回)
   ・「この案を反映」を押すまで何も変わらない。反映は相談中の他の人の変更と統合する(上書きしない)
   ============================================================ */
const AGENT_FIX_GROUPS = /重大エラー|乗せ忘れ|車両のエラー|時間のエラー|男性不在/;
const WDN = ["日", "月", "火", "水", "木", "金", "土"];
// ルールタブの各一覧と、項目の種類(名前は送迎表のマスタにある人・車だけ受け付ける)
const RULE_LISTS = {
  ngPairs: { name: "同乗NG", keys: { a: "user", b: "user" } },
  fixedRun: { name: "迎え・送りの固定担当", keys: { kind: "kind", user: "user", days: "days", staff: "staff" } },
  fixedVeh: { name: "車の固定担当", keys: { veh: "veh", before: "time", days: "days", staff: "staff" } },
  fixedBlock: { name: "予定・ヘルプの固定担当", keys: { label: "text", exact: "bool", kind: "bkind", time: "time", from: "time", days: "days", staff: "staff" } },
  requiredHelp: { name: "必須ヘルプ", keys: { user: "user", days: "days" } },
  helpTwo: { name: "2名体制のヘルプ", keys: { user: "user", days: "days" } },
  maleOnly: { name: "男性職員のみ対応", keys: { user: "user", from: "time", bathOnly: "bool" } },
  userVeh: { name: "利用者の基本の車", keys: { user: "user", veh: "veh" } },
  otherRules: { name: "その他のルール", keys: { text: "text", days: "days", check: "bool" } },
  aiNotes: { name: "AIへの追加ルール", keys: { text: "text" } },
  helpBase: { name: "ヘルプ表(曜日ごとの基本の担当)", keys: { label: "text", time: "time", byDay: "staffByDay" } },
};
const agTime = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? "" : v).trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${Number(m[1])}:${m[2]}` : null; };
const agDays = (v) => Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : null;
function agNormField(type, v, master) {
  if (type === "user") { const n = stripParen(String(v || "")); return master.users.some((u) => u.name === n) ? { v: n } : { err: `利用者「${v}」が見つかりません` }; }
  if (type === "staff") { const n = String(v || ""); return master.staff.some((s) => s.name === n) ? { v: n } : { err: `職員「${v}」が見つかりません` }; }
  if (type === "veh") { const n = String(v || ""); return master.vehicles.some((x) => x.name === n) ? { v: n } : { err: `車「${v}」が見つかりません` }; }
  if (type === "days") { const d = agDays(v); return d ? { v: d } : { err: "曜日は0(日)〜6(土)の数字の配列で指定します" }; }
  if (type === "time") { if (v == null || v === "") return { v: "" }; const t = agTime(v); return t ? { v: t } : { err: `時刻「${v}」が読めません` }; }
  if (type === "bool") return { v: !!v };
  if (type === "kind") return v === "meet" || v === "send" ? { v } : { err: "kind は meet(迎え) か send(送り)" };
  if (type === "staffByDay") {
    if (!v || typeof v !== "object") return { err: "byDay は {曜日番号:\"職員名\"} の形で指定します" };
    const out = {};
    for (const [k, nm] of Object.entries(v)) {
      const d = Number(k); if (!(d >= 0 && d <= 6)) return { err: `曜日「${k}」が読めません` };
      if (nm == null || nm === "") continue;
      const names = String(nm).split(/[・、,]/).map((x) => x.trim()).filter(Boolean);
      const bad = names.filter((n) => !master.staff.some((x) => x.name === n)); if (bad.length) return { err: `職員「${bad.join("・")}」が見つかりません` };
      out[d] = names.join("・");
    }
    return { v: out };
  }
  if (type === "bkind") return ["block", "help", ""].includes(v || "") ? { v: v || "" } : { err: "kind は block / help / 空" };
  const s = String(v == null ? "" : v).trim().slice(0, 200); return s ? { v: s } : { err: "内容が空です" };
}
function agNormRow(list, row, master, partial) {
  const spec = RULE_LISTS[list]; const out = {}; const errs = [];
  for (const [k, type] of Object.entries(spec.keys)) {
    if (!(k in (row || {}))) { if (!partial) { if (type === "days") out[k] = []; else if (type === "bool") out[k] = k === "check"; else if (type === "time" || type === "bkind") out[k] = ""; else errs.push(`${spec.name}: 「${k}」がありません`); } continue; }
    const r = agNormField(type, row[k], master); if (r.err) errs.push(`${spec.name}: ${r.err}`); else out[k] = r.v;
  }
  return { row: out, errs };
}
const agRowEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const agMatch = (row, m) => Object.keys(m).every((k) => agRowEq(Array.isArray(row[k]) ? [...row[k]].sort() : row[k], m[k]));
function agApplyRules(master, rules0, changes) {
  let rules = JSON.parse(JSON.stringify(rules0)); const errs = [];
  (changes || []).forEach((c) => {
    if (!c || !RULE_LISTS[c.list]) { errs.push(`ルールの種類「${c && c.list}」がありません`); return; }
    const list = c.list, rows = [...(rules[list] || [])];
    if (c.op === "add") {
      const r = agNormRow(list, c.row, master, false); if (r.errs.length) { errs.push(...r.errs); return; }
      if (!rows.some((x) => agRowEq(agNormRow(list, x, master, true).row, r.row))) rows.push(r.row);
    } else if (c.op === "delete" || c.op === "update") {
      const m = agNormRow(list, c.match, master, true); if (m.errs.length || !Object.keys(m.row).length) { errs.push(...(m.errs.length ? m.errs : [`${RULE_LISTS[list].name}: どれを${c.op === "delete" ? "消す" : "変える"}か(match)がありません`])); return; }
      const hit = rows.filter((x) => agMatch(x, m.row));
      if (!hit.length) { errs.push(`${RULE_LISTS[list].name}: 当てはまる行がありません(${JSON.stringify(c.match)})`); return; }
      if (c.op === "delete") { rules[list] = rows.filter((x) => !agMatch(x, m.row)); return; }
      const p = agNormRow(list, c.row, master, true); if (p.errs.length) { errs.push(...p.errs); return; }
      rules[list] = rows.map((x) => (agMatch(x, m.row) ? { ...x, ...p.row } : x)); return;
    } else { errs.push(`ルールの操作「${c.op}」は使えません(add / update / delete)`); return; }
    rules[list] = rows;
  });
  return { rules, errs };
}
// 職員・利用者・車両・部署タブの各欄。type: text / time / num / bool / days / date / dept / dayDept / dayTime / dayShift / noRide
const ENTITY_FIELDS = {
  staff: { list: "staff", name: "職員", fields: {
    name: ["text", "名前"], deptId: ["dept", "所属"], position: ["text", "役職"], emp: ["text", "雇用形態"], start: ["time", "出勤"], end: ["time", "退勤"],
    canDrive: ["bool", "運転可"], isMale: ["bool", "男性"], hasOwnCar: ["bool", "自家用車あり"], ownCarCap: ["num", "自家用車の定員"], helpOnly: ["bool", "ヘルプ専任"],
    offDays: ["days", "固定休"], shiftByDay: ["dayShift", "曜日別の勤務"], deptByDay: ["dayDept", "曜日別の勤務先"], subDeptId: ["dept?", "兼務先"], subDeptByDay: ["dayDept", "曜日別の兼務先"],
    retireDate: ["date?", "退職日"], awayFrom: ["time?", "中抜け開始"], awayTo: ["time?", "中抜け終了"], memo: ["text?", "メモ"],
    sortLast: ["bool", "列を右端に"], noGrid: ["bool", "送迎表に列を出さない"], hideInStaffList: ["bool", "職員一覧に出さない"], hideInPartList: ["bool", "部分表示に出さない"] } },
  user: { list: "users", name: "利用者", fields: {
    name: ["text", "名前"], deptId: ["dept", "利用先"], days: ["days", "利用曜日"], deptByDay: ["dayDept", "曜日ごとの利用先"], meetTime: ["time?", "迎えの時刻"], sendTime: ["time?", "送りの時刻"],
    timeByDay: ["dayTime", "曜日ごとの時刻"], wheelchair: ["bool", "車いす"], isMale: ["bool", "男性"], hasHelp: ["bool", "ヘルプあり"], helpTwo: ["bool", "ヘルプ2名"], helpNote: ["text?", "特記事項"],
    libertaAM: ["bool", "朝リベルタから乗る"], libertaPM: ["bool", "夕方リベルタへ送る"], libertaAMOffDays: ["days", "朝リベルタを使わない曜日"], libertaPMOffDays: ["days", "夕方リベルタを使わない曜日"],
    noRideDefault: ["noRide", "基本の送迎なし"], startDate: ["date?", "利用開始日"] } },
  vehicle: { list: "vehicles", name: "車両", fields: { name: ["text", "名前"], deptId: ["dept", "所属"], capNormal: ["num", "定員"], capWc: ["num", "車いす台数"], wheelchairOK: ["bool", "車いす可"], memo: ["text?", "メモ"] } },
  dept: { list: "departments", name: "部署", fields: { name: ["text", "名前"], maleGapMin: ["num", "男性不在を許す分数"], capMax: ["num?", "在席上限"], staffMax: ["num?", "職員の上限"], staffMin: ["num?", "職員の下限"] } },
};
const ENTITY_ALIAS = { dept: "deptId", meet: "meetTime", send: "sendTime", subDept: "subDeptId", cap: "capNormal" };
function agNormEntityField(type, v, m) {
  const opt = type.endsWith("?"); const t = opt ? type.slice(0, -1) : type;
  if (opt && (v === "" || v == null)) return { v: "" };
  const deptId = (n) => { const d = m.departments.find((x) => x.name === n || x.id === n); return d ? d.id : null; };
  const dayObj = (fn) => { if (!v || typeof v !== "object") return { err: "曜日番号をキーにした形で指定します" }; const out = {}; for (const [k, x] of Object.entries(v)) { const d = Number(k); if (!(d >= 0 && d <= 6)) return { err: `曜日「${k}」が読めません` }; if (x == null || x === "") { out[d] = null; continue; } const r = fn(x); if (r.err) return r; out[d] = r.v; } return { v: out, patch: true }; };
  switch (t) {
    case "text": { const x = String(v == null ? "" : v).trim().slice(0, 500); return x || opt ? { v: x } : { err: "空にはできません" }; }
    case "time": { const x = agTime(v); return x ? { v: x } : { err: `時刻「${v}」が読めません` }; }
    case "num": { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 999 ? { v: n } : { err: `数「${v}」が読めません` }; }
    case "bool": return { v: v === true || v === "true" || v === 1 || v === "はい" };
    case "days": { const d = agDays(v); return d ? { v: d } : { err: "曜日は0(日)〜6(土)の数字の配列で指定します" }; }
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? { v: String(v) } : { err: `日付「${v}」が読めません(2026-11-01 の形)` };
    case "dept": { const id = deptId(String(v)); return id ? { v: id } : { err: `部署「${v}」がありません` }; }
    case "dayDept": return dayObj((x) => { const id = deptId(String(x)); return id ? { v: id } : { err: `部署「${x}」がありません` }; });
    case "dayTime": return dayObj((x) => { if (typeof x !== "object") return { err: "曜日ごとの時刻は {meet, send} で指定します" }; const o = {}; for (const k of ["meet", "send"]) if (x[k]) { const tt = agTime(x[k]); if (!tt) return { err: `時刻「${x[k]}」が読めません` }; o[k] = tt; } return { v: o }; });
    case "dayShift": return dayObj((x) => { const st = agTime(x && x.start), en = agTime(x && x.end); return st && en ? { v: { start: st, end: en } } : { err: "曜日別の勤務は {start, end} で指定します" }; });
    case "noRide": { if (!v || typeof v !== "object") return { v: null }; const o = {}; if (v.meet) o.meet = String(v.meet).slice(0, 40); if (v.send) o.send = String(v.send).slice(0, 40); const md = agDays(v.meetDays), sd = agDays(v.sendDays); if (md && md.length) o.meetDays = md; if (sd && sd.length) o.sendDays = sd; return { v: Object.keys(o).length ? o : null }; }
    default: return { err: "この項目は変えられません" };
  }
}
// 利用者・職員・車両・部署の追加・変更・削除。簡単な書き方(days・dept・meet など)もそのまま受け付ける
function agApplyMaster(master0, changes) {
  let m = agClone(master0); const errs = [];
  (changes || []).forEach((c0) => {
    if (!c0 || !ENTITY_FIELDS[c0.target]) { errs.push("target は staff / user / vehicle / dept のどれかです"); return; }
    const spec = ENTITY_FIELDS[c0.target], L = spec.name;
    const set = { ...(c0.set || {}) };
    for (const [k, v] of Object.entries(c0)) if (!["target", "op", "name", "set", "fromDate"].includes(k)) set[k] = v;
    const op = c0.op || "update";
    let list = m[spec.list];
    if (op === "delete") {
      if (c0.target === "dept") { errs.push("部署の削除は部署タブで行ってください(所属している人が外れるため)"); return; }
      const x = list.find((y) => y.name === stripParen(String(c0.name || ""))); if (!x) { errs.push(`${L}「${c0.name}」が見つかりません`); return; }
      m = markDeleted({ ...m, [spec.list]: list.filter((y) => y.id !== x.id) }, spec.list, x); return;
    }
    let x;
    if (op === "add") {
      const nm = String(set.name || c0.name || "").trim(); if (!nm) { errs.push(`${L}の名前がありません`); return; }
      if (list.some((y) => y.name === nm)) { errs.push(`${L}「${nm}」はすでにいます`); return; }
      const d0 = m.departments[0] && m.departments[0].id;
      x = c0.target === "staff" ? { id: uid(), name: nm, deptId: d0, position: "", emp: "常勤", start: "8:30", end: "17:30", canDrive: true, memo: "" }
        : c0.target === "user" ? { id: uid(), name: nm, deptId: d0, meetTime: "", sendTime: "", wheelchair: false, hasHelp: true, helpNote: "", days: [] }
        : c0.target === "vehicle" ? { id: uid(), name: nm, deptId: d0, capNormal: 6, capWc: 0, wheelchairOK: false, memo: "" }
        : { id: uid(), name: nm, maleGapMin: 30 };
      list = [...list, x]; m = { ...m, [spec.list]: list };
    } else if (op === "update") {
      x = list.find((y) => y.name === stripParen(String(c0.name || ""))); if (!x) { errs.push(`${L}「${c0.name}」が見つかりません`); return; }
    } else { errs.push(`操作「${op}」は使えません(add / update / delete)`); return; }
    for (const [k0, v] of Object.entries(set)) {
      const k = ENTITY_ALIAS[k0] || k0; const f = spec.fields[k];
      if (!f) { errs.push(`${L}「${x.name}」: 「${k0}」という項目はありません`); continue; }
      if (k === "days" && c0.fromDate) { const d = agDays(v); if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(c0.fromDate)) errs.push(`${L}「${x.name}」: 利用曜日・日付が読めません`); else x.daysFrom = { ...(x.daysFrom || {}), [c0.fromDate]: d }; continue; }
      const r = agNormEntityField(f[0], v, m); if (r.err) { errs.push(`${L}「${x.name}」の${f[1]}: ${r.err}`); continue; }
      if (k === "name" && r.v !== x.name && list.some((y) => y.name === r.v)) { errs.push(`${L}「${r.v}」はすでにいます`); continue; }
      if (r.patch) { const cur = { ...(x[k] || {}) }; for (const [d, val] of Object.entries(r.v)) { if (val == null || (f[0] === "dayDept" && val === x.deptId)) delete cur[d]; else cur[d] = val; } x[k] = cur; }
      else if (r.v === null || (r.v === "" && f[0].endsWith("?") && f[0] !== "text?")) delete x[k];
      else x[k] = r.v;
    }
  });
  return { master: m, errs };
}
function agRuleRowText(list, r) {
  const d = (a) => (a && a.length ? a.map((x) => WDN[x]).join("") : "毎日");
  switch (list) {
    case "ngPairs": return `${r.a} と ${r.b}`;
    case "fixedRun": return `${r.user}の${r.kind === "send" ? "送り" : "迎え"}(${d(r.days)}) → ${r.staff}`;
    case "fixedVeh": return `${r.veh}の${r.before || ""}前の便(${d(r.days)}) → ${r.staff}`;
    case "fixedBlock": return `${r.label}${r.time ? " " + r.time : ""}${r.from ? " " + r.from + "以降" : ""}(${d(r.days)}) → ${r.staff}`;
    case "requiredHelp": case "helpTwo": return `${r.user}(${d(r.days)})`;
    case "maleOnly": return `${r.user}${r.bathOnly ? "の入浴" : ""}${r.from ? " " + r.from + "以降" : ""}`;
    case "userVeh": return `${r.user} → ${r.veh}`;
    case "helpBase": return `${r.time} ${r.label}：${Object.entries(r.byDay || {}).map(([k, v]) => `${WDN[k]}=${v}`).join("、") || "担当なし"}`;
    default: return `${r.text}${r.days && r.days.length ? `(${d(r.days)})` : ""}`;
  }
}
function agMasterDiff(a, b) {
  const out = [];
  const ra = rulesOf(a), rb = rulesOf(b);
  for (const [list, spec] of Object.entries(RULE_LISTS)) {
    const A = (ra[list] || []).map((x) => JSON.stringify(x)), B = (rb[list] || []).map((x) => JSON.stringify(x));
    B.filter((x) => !A.includes(x)).forEach((x) => out.push({ t: "add", text: `ルール「${spec.name}」に追加: ${agRuleRowText(list, JSON.parse(x))}` }));
    A.filter((x) => !B.includes(x)).forEach((x) => out.push({ t: "del", text: `ルール「${spec.name}」から削除: ${agRuleRowText(list, JSON.parse(x))}` }));
  }
  const dn = (m, id) => (m.departments.find((d) => d.id === id) || {}).name || "";
  const show = (m, type, v) => {
    const t = type.replace("?", "");
    if (v == null || v === "") return "なし";
    if (t === "bool") return v ? "はい" : "いいえ";
    if (t === "days") return (v || []).map((n) => WDN[n]).join("") || "なし";
    if (t === "dept") return dn(m, v) || "なし";
    if (t === "dayDept") return Object.entries(v || {}).map(([k, x]) => `${WDN[k]}${dn(m, x)}`).join("・") || "なし";
    if (t === "dayTime") return Object.entries(v || {}).map(([k, x]) => `${WDN[k]}(迎${x.meet || "基本"}・送${x.send || "基本"})`).join("・") || "なし";
    if (t === "dayShift") return Object.entries(v || {}).map(([k, x]) => `${WDN[k]}${x.start}〜${x.end}`).join("・") || "なし";
    if (t === "noRide") return [v.meet && `迎えなし(${v.meet}${v.meetDays ? "・" + v.meetDays.map((n) => WDN[n]).join("") : ""})`, v.send && `送りなし(${v.send}${v.sendDays ? "・" + v.sendDays.map((n) => WDN[n]).join("") : ""})`].filter(Boolean).join("・") || "なし";
    return String(v);
  };
  for (const spec of Object.values(ENTITY_FIELDS)) {
    const A = a[spec.list] || [], B = b[spec.list] || [];
    B.forEach((x) => {
      const o = A.find((y) => y.id === x.id);
      if (!o) { out.push({ t: "add", text: `${spec.name}を追加: ${x.name}` }); }
      for (const [k, f] of Object.entries(spec.fields)) {
        const ov = o ? o[k] : undefined, nv = x[k];
        if (!o && (nv == null || nv === "" || (Array.isArray(nv) && !nv.length))) continue;
        if (o && agRowEq(ov == null ? null : ov, nv == null ? null : nv)) continue;
        if (o && k === "name") { out.push({ t: "chg", text: `${spec.name}「${ov}」の名前 → ${nv}` }); continue; }
        out.push({ t: "chg", text: `${x.name}：${f[1]} ${o ? show(a, f[0], ov) + " → " : ""}${show(b, f[0], nv)}` });
      }
      if (o && !agRowEq(o.daysFrom || {}, x.daysFrom || {})) Object.entries(x.daysFrom || {}).forEach(([k, v]) => { if (!agRowEq((o.daysFrom || {})[k], v)) out.push({ t: "chg", text: `${x.name}：${k}から利用曜日を ${v.map((n) => WDN[n]).join("")} に` }); });
    });
    A.forEach((y) => { if (!B.some((x) => x.id === y.id)) out.push({ t: "del", text: `${spec.name}を削除: ${y.name}` }); });
  }
  return out;
}
function agentDiff(master, a, b) {
  const sN = (id) => (master.staff.find((s) => s.id === id) || {}).name || (id === HOLD_ID ? "保留" : "?");
  const vN = (id) => (resolveVehicle(master, id) || {}).name || "";
  const uN = (ids) => (ids || []).map((id) => (master.users.find((u) => u.id === id) || {}).name).filter(Boolean);
  const kN = (r) => r.kind === "meet" ? "迎" : r.kind === "send" ? "送" : "他";
  const out = [];
  const one = (x) => x.kind === "help" || x.kind === "block" ? `${x.time} ${x.label || "予定"}(${sN(x.staffId)}${vN(x.vehicleId) ? "・" + vN(x.vehicleId) : ""})` : `${x.time}【${kN(x)}】${sN(x.staffId)}${vN(x.vehicleId) ? "・" + vN(x.vehicleId) : ""}：${uN(x.userIds).join("・") || "(乗車なし)"}`;
  for (const k of ["runs", "blocks"]) {
    const A = new Map((a[k] || []).map((x) => [x.id, x])), B = new Map((b[k] || []).map((x) => [x.id, x]));
    for (const [id, x] of B) { const y = A.get(id); if (!y) out.push({ t: "add", text: one(x) }); else if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ t: "chg", text: one(y) + " → " + one(x) }); }
    for (const [id, y] of A) if (!B.has(id)) out.push({ t: "del", text: one(y) });
  }
  const so = (o) => o.off ? "休み" : [o.start && o.start + "から", o.end && o.end + "まで"].filter(Boolean).join("") || "通常";
  const ao = a.staffOv || {}, bo = b.staffOv || {};
  for (const id of new Set([...Object.keys(ao), ...Object.keys(bo)])) if (JSON.stringify(ao[id] || {}) !== JSON.stringify(bo[id] || {})) out.push({ t: "staff", text: `${sN(id)}：${so(ao[id] || {})} → ${so(bo[id] || {})}` });
  const aa = a.userAbsent || {}, ba = b.userAbsent || {};
  for (const id of new Set([...Object.keys(aa), ...Object.keys(ba)])) if (!!aa[id] !== !!ba[id]) out.push({ t: "user", text: `${uN([id])[0] || "?"}：${ba[id] ? "欠席に" : "欠席を取り消し"}` });
  return out;
}
function agentParse(text) {
  const s = String(text || ""); const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { const o = JSON.parse(s.slice(i, j + 1)); return o && typeof o === "object" ? o : null; } catch (e) { return null; }
}
const agClone = (x) => JSON.parse(JSON.stringify(x));
// その日の送迎表の欄(送迎表タブの下の欄・未割当パネルなど)
function agApplyDay(master, sheet0, dc) {
  const sh = agClone(sheet0); const errs = [];
  const U = (n) => master.users.find((u) => u.name === stripParen(String(n || ""))), S = (n) => master.staff.find((x) => x.name === String(n || ""));
  const D = (n) => master.departments.find((d) => d.name === n);
  for (const k of ["notes", "contact", "training"]) if (typeof dc[k] === "string") sh[k] = dc[k].slice(0, 3000);
  for (const k of ["notesAppend", "contactAppend"]) if (typeof dc[k] === "string" && dc[k].trim()) { const f = k.replace("Append", ""); sh[f] = (sh[f] ? sh[f] + "\n" : "") + dc[k].trim(); }
  (dc.userTime || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } const o = { ...((sh.userTime || {})[u.id] || {}) }; for (const k of ["meet", "send"]) if (k in x) { if (!x[k]) delete o[k]; else { const t = agTime(x[k]); if (!t) { errs.push(`${u.name}: 時刻「${x[k]}」が読めません`); continue; } o[k] = t; } } sh.userTime = { ...(sh.userTime || {}) }; if (Object.keys(o).length) sh.userTime[u.id] = o; else delete sh.userTime[u.id]; });
  (dc.noRide || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } const o = { ...((sh.noRide || {})[u.id] || {}) }; for (const k of ["meet", "send"]) if (k in x) { if (!x[k]) delete o[k]; else o[k] = String(x[k]).slice(0, 40); } sh.noRide = { ...(sh.noRide || {}) }; if (Object.keys(o).length) sh.noRide[u.id] = o; else delete sh.noRide[u.id]; });
  (dc.userAbsent || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } sh.userAbsent = { ...(sh.userAbsent || {}) }; if (x.absent === false) delete sh.userAbsent[u.id]; else sh.userAbsent[u.id] = true; });
  (dc.userDept || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } sh.userDept = { ...(sh.userDept || {}) }; if (!x.dept) delete sh.userDept[u.id]; else { const d = D(x.dept); if (!d) errs.push(`部署「${x.dept}」がありません`); else sh.userDept[u.id] = d.id; } });
  (dc.extraUse || []).forEach((x) => { const u = U(x && x.name); if (!u) { errs.push(`利用者「${x && x.name}」が見つかりません`); return; } sh.userExtra = { ...(sh.userExtra || {}) }; if (x.use === false) delete sh.userExtra[u.id]; else sh.userExtra[u.id] = true; });
  (dc.staff || []).forEach((x) => {
    const s = S(x && x.name); if (!s) { errs.push(`職員「${x && x.name}」が見つかりません`); return; }
    const o = { ...((sh.staffOv || {})[s.id] || {}) };
    if ("off" in x) { if (x.off) o.off = true; else delete o.off; }
    if ("workToday" in x) { if (x.workToday) o.workToday = true; else delete o.workToday; }
    for (const k of ["start", "end"]) if (k in x) { if (!x[k]) delete o[k]; else { const t = agTime(x[k]); if (!t) { errs.push(`${s.name}: 時刻「${x[k]}」が読めません`); continue; } o[k] = t; } }
    if ("dept" in x) { if (!x.dept) delete o.deptId; else { const d = D(x.dept); if (!d) errs.push(`部署「${x.dept}」がありません`); else o.deptId = d.id; } }
    sh.staffOv = { ...(sh.staffOv || {}) }; if (Object.keys(o).length) sh.staffOv[s.id] = o; else delete sh.staffOv[s.id];
  });
  return { sheet: sh, errs };
}
function agDayDiff(master, a, b) {
  const out = [];
  const uN = (id) => (master.users.find((u) => u.id === id) || {}).name || "?", sN = (id) => (master.staff.find((s) => s.id === id) || {}).name || "?", dN = (id) => (master.departments.find((d) => d.id === id) || {}).name || "";
  for (const [k, l] of [["notes", "特記事項"], ["contact", "連絡事項"], ["training", "訓練"]]) if ((a[k] || "") !== (b[k] || "")) out.push({ t: "chg", text: `${l}：${String(b[k] || "（空）").slice(0, 80)}` });
  const map = (k, fmt) => { const A = a[k] || {}, B = b[k] || {}; for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) if (JSON.stringify(A[id]) !== JSON.stringify(B[id])) out.push({ t: "chg", text: fmt(id, A[id], B[id]) }); };
  map("userTime", (id, x, y) => `${uN(id)}：この日の時刻 ${y ? `迎${y.meet || "基本"}・送${y.send || "基本"}` : "基本に戻す"}`);
  map("noRide", (id, x, y) => `${uN(id)}：送迎なし ${y ? [y.meet && `迎え(${y.meet})`, y.send && `送り(${y.send})`].filter(Boolean).join("・") : "取り消し"}`);
  map("userDept", (id, x, y) => `${uN(id)}：この日の利用先 ${y ? dN(y) : "いつもどおり"}`);
  map("userExtra", (id, x, y) => `${uN(id)}：${y ? "今日だけ利用" : "今日だけ利用を取り消し"}`);
  return out;
}
const AGENT_PATTERN_DAYS = [1, 2, 3, 4, 5, 6, 0];


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

function AgentChat({ master, sheet, date, onApply, onClose }) {
  const wd = weekdayOf(date);
  const base = useRef({ sheet: agClone(sheet), master: agClone(master), patterns: null });
  const [draft, setDraft] = useState(() => ({ sheet: agClone(sheet), master: agClone(master), patterns: null }));
  const [log, setLog] = useState([{ who: "ai", text: `${date}(${DAYS[wd]})の送迎表について相談できます。\n例:「安達が休み。代わりを入れて組み替えて」「中村さんは毎週月水金、水曜だけ津田を利用」「井上さんの入浴を木曜17時から火曜16時に変えて」「早川さんと青木さんは同じ便にしない」` }]);
  const [hist, setHist] = useState([]);
  const [shown, setShown] = useState([]);     // 中身をAIに渡している週間パターンの曜日
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const endRef = useRef(null);
  useEffect(() => { (async () => {
    // 7曜日を同時に読む（1つずつだと本物のGoogleでは10〜20秒かかった）
    const ps = {};
    await Promise.all(AGENT_PATTERN_DAYS.map(async (d) => { try { ps[d] = (await sGet(`pattern:${d}`)) || null; } catch (e) { ps[d] = null; } }));
    base.current.patterns = agClone(ps);
    setDraft((x) => ({ ...x, patterns: agClone(ps) }));
  })(); }, []);
  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: "end" }); }, [log, busy]);
  const dayMaster = (m, d, w, ds) => applyDayDept(m, w, d && d.staffOv, d && d.userDept, d && d.userExtra, ds);
  const gridOf = (d, dm, w) => ({ staffOv: {}, userAbsent: {}, userDept: {}, notes: "", contact: "", libertaOff: {}, libertaOn: {}, userTime: {}, runs: [], blocks: [], ...d, noRide: { ...noRideDefaults(dm, w), ...((d && d.noRide) || {}) } });
  const checksOf = (dr) => { const dm = dayMaster(dr.master, dr.sheet, wd, date); try { return collectSheetChecks(dm, dr.sheet, date, dr.patterns && dr.patterns[wd]); } catch (e) { return [{ icon: "⚠", title: "チェックできませんでした", items: [String((e && e.message) || e)] }]; } };
  const diffs = useMemo(() => {
    const out = [];
    agentDiff(dayMaster(draft.master, draft.sheet, wd, date), base.current.sheet, draft.sheet).forEach((x) => out.push({ ...x, area: `${date}の送迎表` }));
    agDayDiff(draft.master, base.current.sheet, draft.sheet).forEach((x) => out.push({ ...x, area: `${date}の送迎表` }));
    agMasterDiff(base.current.master, draft.master).forEach((x) => out.push({ ...x, area: "利用者・職員・ルール" }));
    if (draft.patterns && base.current.patterns) AGENT_PATTERN_DAYS.forEach((d) => {
      const a = base.current.patterns[d] || { runs: [], blocks: [] }, b = draft.patterns[d] || { runs: [], blocks: [] };
      if (JSON.stringify(a) !== JSON.stringify(b)) agentDiff(dayMaster(draft.master, null, d, null), a, b).forEach((x) => out.push({ ...x, area: `週間パターン(${WDN[d]}曜)` }));
    });
    return out;
  }, [draft]);
  const groups = useMemo(() => checksOf(draft), [draft]);

  const patternCtx = (dr, d) => {
    const dm = dayMaster(dr.master, null, d, null); const p = (dr.patterns || {})[d] || { runs: [], blocks: [] };
    const c = aiContextOf(dm, gridOf(p, dm, d), d);
    return { dm, c, idMap: { ...Object.fromEntries(c.runs.map((r) => [r.id, { t: "runs", id: r._id }])), ...Object.fromEntries(c.helps.map((h) => [h.id, { t: "blocks", id: h._id }])) } };
  };
  const stateText = (dr, days) => {
    const dm = dayMaster(dr.master, dr.sheet, wd, date); const p = aiContextOf(dm, gridOf(dr.sheet, dm, wd), wd);
    const idMap = { ...Object.fromEntries(p.runs.map((r) => [r.id, { t: "runs", id: r._id }])), ...Object.fromEntries(p.helps.map((h) => [h.id, { t: "blocks", id: h._id }])) };
    const g = checksOf(dr).map((x) => `■${x.title}\n` + x.items.slice(0, 15).map((i) => "・" + i).join("\n")).join("\n");
    const dn = (id) => (dr.master.departments.find((d) => d.id === id) || {}).name || "";
    const userBase = dr.master.users.map((u) => ({ name: u.name, days: (u.days || []).map((n) => WDN[n]).join(""), dept: dn(u.deptId), ...(u.wheelchair ? { wc: true } : {}), ...(u.helpNote ? { note: u.helpNote } : {}), ...(u.noRideDefault ? { noRideDefault: u.noRideDefault } : {}), ...(u.libertaAM || u.libertaPM ? { liberta: `${u.libertaAM ? "朝" : ""}${u.libertaPM ? "夕" : ""}` } : {}),
      ...(Object.keys(u.deptByDay || {}).length ? { deptByDay: Object.fromEntries(Object.entries(u.deptByDay).map(([k, v]) => [k, dn(v)])) } : {}),
      meet: u.meetTime || "", send: u.sendTime || "", ...(Object.keys(u.timeByDay || {}).length ? { timeByDay: u.timeByDay } : {}), ...(u.daysFrom ? { daysFrom: u.daysFrom } : {}) }));
    const staffBase = dr.master.staff.filter((s) => !s.retireDate).map((s) => ({ name: s.name, dept: dn(s.deptId), male: !!s.isMale, time: `${s.start}-${s.end}`, ...(s.position ? { position: s.position } : {}), ...(s.helpOnly ? { helpOnly: true } : {}), ...(Object.keys(s.deptByDay || {}).length ? { deptByDay: Object.fromEntries(Object.entries(s.deptByDay).map(([k, v]) => [k, dn(v)])) } : {}), ...(s.offDays && s.offDays.length ? { off: s.offDays.map((n) => WDN[n]).join("") } : {}), ...(Object.keys(s.shiftByDay || {}).length ? { shiftByDay: s.shiftByDay } : {}) }));
    const helpIdx = AGENT_PATTERN_DAYS.map((d) => { const pt = (dr.patterns || {})[d]; if (!pt) return null; const dmm = dayMaster(dr.master, null, d, null); const hs = (pt.blocks || []).map((b) => `${b.time} ${b.label || (b.kind === "help" ? "ヘルプ" : "予定")}(${(dmm.staff.find((s) => s.id === b.staffId) || {}).name || "保留"})`); return hs.length ? `${WDN[d]}曜: ${hs.join("、")}` : null; }).filter(Boolean).join("\n");
    const pats = {};
    const patText = days.map((d) => { const pc = patternCtx(dr, d); pats[d] = pc.idMap; return `# 週間パターン(${WDN[d]}曜 / day:${d})の便\n${JSON.stringify(pc.c.runs.map(({ _id, ...r }) => r))}\n# 週間パターン(${WDN[d]}曜 / day:${d})のヘルプ・予定\n${JSON.stringify(pc.c.helps.map(({ _id, ...r }) => r))}`; }).join("\n");
    const text = `【今の下書き ${date}(${DAYS[wd]}) ${EDITION_LABEL}】
# その日の職員(off:true=休み)
${JSON.stringify(p.staffOn)}
# その日の利用者(absent:true=欠席。meet/send=希望時刻、"なし(...)"=送迎不要)
${JSON.stringify(p.users)}
# 車両
${JSON.stringify(p.vehicles)}
# その日の便(idは今回だけ有効)
${JSON.stringify(p.runs.map(({ _id, ...r }) => r))}
# その日のヘルプ
${JSON.stringify(p.helps.map(({ _id, ...r }) => r))}
# 未割当  迎え: ${p.unMeet.join("・") || "なし"} / 送り: ${p.unSend.join("・") || "なし"}
# 保留の予定id: ${p.holdIds.join("、") || "なし"}
# 出力前チェックの結果
${g || "問題なし"}
# 利用者の基本(days=利用曜日、deptByDay=曜日ごとの利用先 0日〜6土、timeByDay=曜日ごとの時刻、daysFrom=その日付から利用曜日が変わる)
${JSON.stringify(userBase)}
# 職員の基本(time=勤務時間、off=固定休、shiftByDay=曜日別の勤務)
${JSON.stringify(staffBase)}
# 車両タブ
${JSON.stringify(dr.master.vehicles.map((v) => ({ name: v.name, dept: dn(v.deptId), cap: v.capNormal, wc: v.wheelchairOK ? v.capWc : 0, ...(v.memo ? { memo: v.memo } : {}) })))}
# 部署タブ
${JSON.stringify(dr.master.departments.map((d) => ({ name: d.name, maleGapMin: d.maleGapMin, ...(d.capMax != null ? { capMax: d.capMax } : {}), ...(d.staffMax != null ? { staffMax: d.staffMax } : {}), ...(d.staffMin != null ? { staffMin: d.staffMin } : {}) })))}
# その日の欄  特記事項: ${JSON.stringify(dr.sheet.notes || "")} / 連絡事項: ${JSON.stringify(dr.sheet.contact || "")} / 訓練: ${JSON.stringify(dr.sheet.training || "")}
# ルール設定(ルールタブ・ヘルプ表。日数は0日〜6土)
${JSON.stringify(Object.fromEntries(Object.keys(RULE_LISTS).map((k) => [k, rulesOf(dr.master)[k] || []])))}
# 週間パターンのヘルプ・予定の一覧(各曜日)
${helpIdx || "(未作成)"}
${patText}`;
    return { text, idMap, dm, pats };
  };
  const system = () => `あなたは介護事業所の送迎表アプリを、担当者と会話しながら整えるアシスタントです。アプリのすべてのタブの欄を変えられます。
1. その日の送迎表の便・ヘルプ(changes)と、その日の欄(dayChanges: 特記事項・連絡事項・訓練・送迎なし・時間変更・欠席・当日の勤務・当日の利用先・今日だけ利用)
2. 職員・利用者・車両・部署タブ(masterChanges: 追加・変更・削除)
3. ルールタブ・ヘルプ表(ruleChanges) 4. 週間パターンの便・ヘルプ(patternChanges)
※「車両の動き」「3Dマップ」は見るだけの画面で、便を変えると自動で変わります
- 毎回、担当者のメッセージの後に「今の下書き」が付きます。変更はこの下書きに対する差分として出します。idはその回の下書きのものだけを使います
- 変更は担当者が「反映」を押すまで入りません。迷う判断は案を作ったうえで返事に選択肢を書きます。質問だけなら変更は空にして答えます
- 「毎週」「いつも」の話は基本(masterChanges)・ルール・週間パターンの変更です。その日だけの話は changes です。毎週の変更が今日にも関わるなら、今日の送迎表(changes)も合わせて直します
- 入浴やヘルプの曜日・時刻を変えるときは、週間パターンの該当曜日のヘルプを動かします(元の曜日から delete、新しい曜日へ add)。ルールの必須ヘルプ(requiredHelp)・2名体制(helpTwo)・固定担当(fixedBlock)の曜日も合わせて直します
- 週間パターンの便の中身が必要なら "need":[曜日番号] を返すと、次の回でその曜日の便・ヘルプ(id付き)を渡します。ヘルプの一覧は毎回渡しています
- 下の「送迎のルール」の文と、ルール設定・AIへの追加ルール(aiNotes)が食い違うときは、ルール設定・追加ルールを優先します。担当者が決まりごとを変えたいと言ったら、ルール設定で表せるものはルール設定を、表せないものは aiNotes を変えます
- 削除(職員・利用者・車両の削除、ルールの削除)は、担当者がはっきり頼んだときだけ行います。退職は削除ではなく職員の退職日(retireDate)で表します
- 返事は日本語で短く(300字以内)。何を変えたか、残っている問題、確認したいことを書きます。変更の一覧は画面に出るので書き写さない

# 送迎のルール
${aiRulesText(master)}

# 出力(次のJSONだけ。前後に説明やコードフェンスを書かない。最初の文字は { 。使わないキーは省略してよい)
{"reply":"担当者への返事",
 "changes":[{"op":"update","id":"r1","staff":"職員名","veh":"車名(ヘルプは\\"自車\\"も可)","time":"8:30","users":["利用者名"],"dest":"部署名","dur":60},{"op":"add","kind":"迎|送|他|ヘルプ","time":"15:30","staff":"職員名","veh":"車名","users":["利用者名"],"label":"ヘルプ名","note":"補足"},{"op":"delete","id":"r2"}],
 "staffOff":["その日休みにする職員名"],"staffTime":[{"name":"職員名","start":"10:00","end":"15:00"}],"userAbsent":["その日欠席にする利用者名"],
 "dayChanges":{"notesAppend":"特記事項に足す文","contactAppend":"連絡事項に足す文","notes":"(全部書き換えるとき)","training":"訓練の欄","userTime":[{"name":"利用者名","meet":"10:30","send":""}],"noRide":[{"name":"利用者名","meet":"受診後来所","send":""}],"userAbsent":[{"name":"利用者名","absent":true}],"staff":[{"name":"職員名","off":true,"start":"10:00","end":"","workToday":true,"dept":"部署名"}],"userDept":[{"name":"利用者名","dept":"部署名"}],"extraUse":[{"name":"利用者名","use":true}]},
 "masterChanges":[{"target":"user|staff|vehicle|dept","op":"update|add|delete","name":"今の名前","fromDate":"2026-11-01(利用曜日をこの日から変えるとき)","set":{"欄の名前":"新しい値"}}],
 "ruleChanges":[{"op":"add","list":"ngPairs","row":{"a":"利用者名","b":"利用者名"}},{"op":"update","list":"fixedBlock","match":{"label":"透析","days":[3,4]},"row":{"staff":"職員名"}},{"op":"delete","list":"requiredHelp","match":{"user":"利用者名"}}],
 "patternChanges":[{"day":2,"changes":[…changesと同じ形。idはその曜日のもの(ヘルプの追加は id 不要)…]}],
 "need":[2],
 "unresolved":[{"item":"項目","reason":"理由"}]}
masterChanges の欄(set に書く。"" や null で空にする。曜日の欄は {"曜日番号":値} で、その曜日だけ変わる):
 staff: name,deptId(部署名),position,emp,start,end,canDrive,isMale,hasOwnCar,ownCarCap,helpOnly,offDays,shiftByDay{"3":{"start","end"}},deptByDay{"5":"部署名"},subDeptId(部署名),subDeptByDay,retireDate,awayFrom,awayTo,memo,sortLast,noGrid,hideInStaffList,hideInPartList
 user: name,deptId(部署名),days,deptByDay,meetTime,sendTime,timeByDay{"3":{"meet","send"}},wheelchair,isMale,hasHelp,helpTwo,helpNote,libertaAM,libertaPM,libertaAMOffDays,libertaPMOffDays,noRideDefault{"meet":"家族送り","send":"","meetDays":[1,4]},startDate
 vehicle: name,deptId(部署名),capNormal,capWc,wheelchairOK,memo / dept: name,maleGapMin,capMax,staffMax,staffMin
ヘルプ表: helpBase{label,time,byDay:{"1":"職員名","3":"職員名・職員名"}}(曜日ごとの基本の担当)
ルール設定の一覧と項目: ngPairs{a,b}=同乗NG / fixedRun{kind:"meet"|"send",user,days,staff}=迎え・送りの固定担当 / fixedVeh{veh,before,days,staff}=車の固定担当 / fixedBlock{label,exact,kind:"block"|"help"|"",time,from,days,staff}=予定・ヘルプの固定担当 / requiredHelp{user,days}=必須ヘルプ / helpTwo{user,days}=夕方2名体制 / maleOnly{user,from,bathOnly}=男性職員のみ / userVeh{user,veh}=基本の車 / otherRules{text,days,check}=その他のルール(出力前に確認) / aiNotes{text}=AIへの追加ルール。days は 0日〜6土 の数字。deptByDay・timeByDay の値を "" や null にするとその曜日の指定を消す。`;

  const callModel = async (messages) => {
    const sampler = window.claude && window.claude.use ? await window.claude.use("sample") : null;
    if (!sampler) throw new Error("この画面ではAIが使えません(管理者がAIの設定をすると使えます)");
    let res;
    try { res = await sampler(messages, { system: system(), modelTier: "default", cache: false, maxTokens: 4000 }); }
    catch (e) { throw new Error((e && e.message) || "AIに接続できませんでした"); }
    return String((res && res.text) || "");
  };
  // AIの出力を下書きに当てはめる(送迎表・基本・ルール・週間パターン)
  const applyAi = (dr, o, st) => {
    const errs = []; let next = { ...dr };
    if (Array.isArray(o.ruleChanges) && o.ruleChanges.length) { const r = agApplyRules(next.master, rulesOf(next.master), o.ruleChanges); errs.push(...r.errs); next = { ...next, master: { ...next.master, rules: r.rules } }; }
    if (Array.isArray(o.masterChanges) && o.masterChanges.length) { const r = agApplyMaster(next.master, o.masterChanges); errs.push(...r.errs); next = { ...next, master: r.master }; }
    const ch = Array.isArray(o.changes) ? o.changes.filter((c) => c && typeof c === "object") : [];
    const offNames = Array.isArray(o.staffOff) ? o.staffOff.map(String) : [];
    const times = Array.isArray(o.staffTime) ? o.staffTime.filter((x) => x && x.name) : [];
    let capFixed = [];
    if (ch.length || offNames.length || times.length) {
      const dm = dayMaster(next.master, next.sheet, wd, date);
      const r = aiApplyPure(dm, next.sheet, ch, st.idMap, { staffOff: offNames, staffTime: times, workChanges: [] });
      next = { ...next, sheet: r.next }; capFixed = r.capFixed;
      ch.forEach((c) => { if ((c.op === "update" || c.op === "delete") && !st.idMap[c.id]) errs.push(`その日の便・ヘルプ「${c.id}」が見つかりません`); });
    }
    if (o.dayChanges && typeof o.dayChanges === "object") { const r = agApplyDay(next.master, next.sheet, o.dayChanges); errs.push(...r.errs); next = { ...next, sheet: r.sheet }; }
    const ab = Array.isArray(o.userAbsent) ? o.userAbsent.map(String) : [];
    if (ab.length) { const ua = { ...(next.sheet.userAbsent || {}) }; ab.forEach((n) => { const u = next.master.users.find((x) => x.name === stripParen(n)); if (u) ua[u.id] = true; else errs.push(`利用者「${n}」が見つかりません`); }); next = { ...next, sheet: { ...next.sheet, userAbsent: ua } }; }
    if (Array.isArray(o.patternChanges) && o.patternChanges.length && next.patterns) {
      const ps = { ...next.patterns };
      o.patternChanges.forEach((pc) => {
        const d = Number(pc && pc.day); if (!(d >= 0 && d <= 6)) { errs.push(`週間パターンの曜日「${pc && pc.day}」が読めません`); return; }
        const pch = (Array.isArray(pc.changes) ? pc.changes : []).filter((c) => c && typeof c === "object");
        const idMap = st.pats[d] || patternCtx(next, d).idMap;
        pch.forEach((c) => { if ((c.op === "update" || c.op === "delete") && !idMap[c.id]) errs.push(`${WDN[d]}曜のパターンの「${c.id}」が見つかりません(先に need で中身を確認してください)`); });
        const ok = pch.filter((c) => c.op === "add" || idMap[c.id]);
        if (!ok.length) return;
        const dm = dayMaster(next.master, null, d, null);
        const cur = ps[d] || { runs: [], blocks: [], training: "" };
        const nx = aiApplyPure(dm, cur, ok, idMap, { staffOff: [], staffTime: [], workChanges: [] }).next;
        if (!("staffOv" in cur)) delete nx.staffOv;
        ps[d] = nx;
      });
      next = { ...next, patterns: ps };
    }
    return { next, errs, capFixed };
  };
  const changedCount = (a, b) => (JSON.stringify(a.sheet) !== JSON.stringify(b.sheet) ? 1 : 0) + (JSON.stringify(a.master) !== JSON.stringify(b.master) ? 1 : 0) + (JSON.stringify(a.patterns) !== JSON.stringify(b.patterns) ? 1 : 0);

  const send = async (userText) => {
    const t = String(userText || "").trim(); if (!t || busy) return;
    if (!draft.patterns) { setErr("週間パターンを読み込んでいます。少し待ってから送ってください"); return; }
    setInput(""); setErr("");
    setLog((l) => [...l, { who: "me", text: t }]);
    let dr = draft, h = hist, days = shown, fix = 0, needs = 0, msg = t, label = "【担当者】";
    const startDr = draft;   // この依頼の前の状態(もともとあった問題は差し戻さない)
    try {
      for (let guard = 0; guard < 8; guard++) {
        setBusy(label === "【自動チェック】" ? "チェックで見つかった問題をAIが直しています…" : label === "【資料】" ? "週間パターンをAIに見せています…" : "AIが考えています…");
        const st = stateText(dr, days);
        const messages = [...h, { role: "user", content: `${label}${msg}\n\n${st.text}` }];
        let text = await callModel(messages);
        let o = agentParse(text);
        if (!o) { text = await callModel([...messages, { role: "assistant", content: text }, { role: "user", content: "JSONとして読めませんでした。説明を付けず、指定のJSONだけをもう一度出してください。" }]); o = agentParse(text); }
        if (!o) throw new Error("AIの返事を読み取れませんでした。言い方を変えてもう一度送ってください");
        const r = applyAi(dr, o, st);
        const changed = changedCount(dr, r.next);
        dr = r.next;
        const extra = [
          ...r.errs.map((x) => `反映できなかった変更: ${x}`),
          ...(r.capFixed.length ? [`定員超過のため外した人: ${r.capFixed.join("、")}`] : []),
          ...((Array.isArray(o.unresolved) ? o.unresolved : []).map((x) => `未解決: ${x.item}(${x.reason})`)),
        ];
        if (o.reply) setLog((l) => [...l, { who: "ai", text: String(o.reply), note: changed ? "下書きを変更しました(右の一覧)" : "", extra }]);
        h = [...h, { role: "user", content: `${label}${msg}(このときの下書きは省略)` }, { role: "assistant", content: JSON.stringify(o) }];
        setDraft(dr); setHist(h);
        const need = (Array.isArray(o.need) ? o.need : []).map(Number).filter((d) => d >= 0 && d <= 6 && !days.includes(d));
        if (need.length && needs < 2) { needs++; days = [...days, ...need]; setShown(days); label = "【資料】"; msg = `週間パターン(${need.map((d) => WDN[d]).join("・")}曜)の中身を付けました。続けてください。`; continue; }
        if (r.errs.length && fix < 2) { fix++; label = "【自動チェック】"; msg = `次の変更は反映できませんでした。名前・idを直して出し直してください。\n${r.errs.slice(0, 20).join("\n")}`; setLog((l) => [...l, { who: "sys", text: `反映できない変更が${r.errs.length}件あったので、AIに直させています` }]); continue; }
        const probs = (x) => checksOf(x).filter((g) => AGENT_FIX_GROUPS.test(g.title)).flatMap((g) => g.items.map((i) => `${g.title}: ${i}`));
        const before = new Set(probs(startDr));
        const left = probs(dr).filter((x) => !before.has(x));
        if (left.length && changed && fix < 2) { fix++; label = "【自動チェック】"; msg = `今回の変更で、下書きの送迎表に次の問題が新しく出ました。直せるものは追加のchangesで直し、直せないものはunresolvedに理由を書いてください。\n${left.slice(0, 25).join("\n")}`; setLog((l) => [...l, { who: "sys", text: `チェックで${left.length}件の問題が見つかったので、AIに直させています` }]); continue; }
        break;
      }
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally { setBusy(""); }
  };

  const fixCount = groups.filter((g) => AGENT_FIX_GROUPS.test(g.title)).reduce((n, g) => n + g.items.length, 0);
  const areas = [...new Set(diffs.map((x) => x.area))];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-5xl h-full flex flex-col md:flex-row shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 min-w-0 flex flex-col border-r border-stone-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
            <div className="font-bold">💬 AIと相談 <span className="text-xs font-normal text-stone-500">{date}({DAYS[wd]})・{EDITION_LABEL}</span></div>
            <button className="px-2 text-xl text-stone-500" onClick={onClose} aria-label="閉じる">×</button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3 text-sm">
            {log.map((m, i) => (
              <div key={i} className={m.who === "me" ? "flex justify-end" : "flex"}>
                <div className={m.who === "me" ? "bg-sky-600 text-white rounded-2xl rounded-br-sm px-3 py-2 max-w-[85%] whitespace-pre-wrap" : m.who === "sys" ? "text-xs text-stone-500 italic" : "bg-stone-100 rounded-2xl rounded-bl-sm px-3 py-2 max-w-[85%] whitespace-pre-wrap"}>
                  {m.text}
                  {m.note ? <div className="text-xs text-emerald-700 font-bold mt-1">{m.note}</div> : null}
                  {(m.extra || []).map((x, j) => <div key={j} className="text-xs text-rose-700 mt-1">{x}</div>)}
                </div>
              </div>
            ))}
            {busy && <div className="text-xs text-stone-500">{busy}</div>}
            {err && <div className="text-xs text-rose-700 font-bold">⚠ {err}</div>}
            <div ref={endRef} />
          </div>
          <form className="p-3 border-t border-stone-200 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea id="agentInput" className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm resize-none" rows={2} value={input} placeholder="例: 井上さんの入浴を木曜17時から火曜16時に変えて"
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(input); } }} disabled={!!busy} />
            <button className="px-4 rounded-lg bg-sky-600 text-white font-bold disabled:opacity-40" disabled={!!busy || !input.trim()}>送信</button>
          </form>
        </div>
        <div className="w-full md:w-[26rem] flex flex-col max-h-[50vh] md:max-h-none">
          <div className="px-4 py-3 border-b border-stone-200 font-bold text-sm">変わる所 <span className="font-normal text-stone-500">{diffs.length}か所</span></div>
          <div className="flex-1 overflow-auto p-3 space-y-1 text-xs">
            {!diffs.length && <div className="text-stone-400">まだ変更はありません</div>}
            {areas.map((a) => (
              <div key={a} className="space-y-1 pb-2">
                <div className="font-bold text-stone-600 pt-1">{a}</div>
                {diffs.filter((x) => x.area === a).map((x, i) => (
                  <div key={i} className={`px-2 py-1 rounded ${x.t === "add" ? "bg-emerald-50 text-emerald-900" : x.t === "del" ? "bg-rose-50 text-rose-900 line-through" : "bg-amber-50 text-amber-900"}`}>
                    {x.t === "add" ? "＋ " : x.t === "del" ? "－ " : "↻ "}{x.text}
                  </div>
                ))}
              </div>
            ))}
            <div className="pt-3 font-bold text-sm text-stone-700">{date}のチェック <span className={fixCount ? "text-rose-700" : "text-emerald-700"}>{fixCount ? `要修正 ${fixCount}件` : "要修正なし"}</span></div>
            {groups.map((g, i) => (
              <details key={i} className="border border-stone-200 rounded px-2 py-1" open={AGENT_FIX_GROUPS.test(g.title)}>
                <summary className="cursor-pointer">{g.icon} {g.title}({g.items.length})</summary>
                {g.items.slice(0, 30).map((it, j) => <div key={j} className="pl-2 py-0.5 text-stone-600">{it}</div>)}
              </details>
            ))}
          </div>
          <div className="p-3 border-t border-stone-200 flex gap-2">
            <button className="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-40" disabled={!diffs.length || !!busy}
              onClick={() => onApply(base.current, draft, log.filter((m) => m.who === "me").map((m) => m.text))}>この案を反映</button>
            <button className="px-3 py-2 rounded-lg border border-stone-300 disabled:opacity-40" disabled={!diffs.length || !!busy}
              onClick={() => { setDraft(agClone(base.current)); setHist([]); setShown([]); setLog((l) => [...l, { who: "sys", text: "下書きを元に戻しました" }]); }}>案を捨てる</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
