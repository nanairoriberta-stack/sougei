# 送迎表＋職場カレンダー（Google Apps Script版）

介護事業所（なないろ）の「送迎表アプリ」と、職員がスマホで使う「職場カレンダー（TimeTree風）」を、
Googleスプレッドシート＋Apps Script（GAS）の1つのウェブアプリとして動かすプロジェクト。
依頼者はエンジニアではない（介護事業所の担当者）。画面の文言・説明はすべて日本語で、専門用語を避ける。

## いちばん大事な約束（これを壊す変更はしない）
依頼者の最優先事項：**「各人が入力したデータが消える・保存されない・送迎表に反映されない」は絶対にダメ。**
過去に別アプリで「同時に開くとデータが消えた」「ネットが切れて消えた」経験がある。約200人が同時に使う。

- 読み込みに失敗した値で保存しない（空の画面を保存して上書き、を防ぐ。`loadFailed` で保存を止める）
- 文書まるごとの上書きをしない。サーバー側でロック（`LockService`）を取り、**3者マージ（base / mine / theirs、`SGKV.merge3`）**して保存
- 未送信の変更は即座に端末へ保存（localStorage）し、通信が戻ったら自動で再送。送る内容はその時点の写し（snapshot）
- 操作は冪等（同じ操作が二度届いても二重にならない。`opId`/`lastOp`）
- カレンダー→送迎表の反映は**サーバー側**で行う（送迎表の保存のたび・カレンダー操作のたびに `reconcile`）。画面側の反映は表示だけで保存しない
- 変更は必ず `変更履歴` シートに誰が・何をを残す

変更したら必ず `bash build.sh && bash test.sh ui` を通すこと（下記）。テストを弱めて通すのは禁止。

## 全体の形
```
職員のスマホ ──(ID＋4桁PIN)──▶ GASウェブアプリ ?page=calendar  … カレンダー（gas/calendar_app.js）
事務所PC     ──────────────▶ GASウェブアプリ ?page=sougei&e=v1|v2|v3 … 送迎表（sougei.jsx を束ねたもの）
                                   │ google.script.run → api(token, method, args)（gas/Code.gs の HANDLERS）
                                   ▼
                        スプレッドシート（隠しシート _docs に JSON を分割保存）
Claudeアプリ ─(カスタムコネクタ/MCP)─▶ Cloudflare中継 ─▶ GAS doPost(?mcp=1&k=鍵)（gas/Mcp.gs）
```
- GASは `executeAs: USER_DEPLOYING`、`access: ANYONE_ANONYMOUS`。認証はアプリ独自（職員番号＋PIN、セッション120日、5回失敗で15分ロック）
- 送迎表は3つの版を1本のコードで切替：`v1`=現体制版（〜10/31）、`v2`=新体制版（11/1〜）、`v3`=りんく・ぷれいす版。保存キーの頭に `''` / `'v2:'` / `'v3:'`
- 権限（`職員ID` シートC列）：`管理者` / `送迎表`（送迎表を編集できる）/ `一般`（カレンダーで自分の休み・予定だけ）

## ファイル
| ファイル | 中身 | 編集する？ |
|---|---|---|
| `sougei.jsx` | 送迎表アプリ本体（React、約1.2万行）。元は依頼者の v293。AI調整・💬AIと相談・🤖Claudeの案 を含む | ◯ |
| `gas/Code.gs` | サーバー：doGet、api/HANDLERS、認証、文書ストア、kv.merge/cas、カレンダー操作 cal.apply、反映、変更履歴、AI(API)中継 | ◯ |
| `gas/Mcp.gs` | Claudeのカスタムコネクタ（MCP、JSON-RPC）。道具：get_rules / get_day / get_master / get_week_pattern / propose / list_proposals / apply_proposal / discard_proposal | ◯ |
| `gas/calendar_app.js` `calendar_css.txt` `calendar_body.txt` | カレンダー画面（素のJS） | ◯ |
| `gas/gashost.js` | 画面共通：ログイン画面、PIN変更、`window.claude` 互換の口（db/user/downloads/sample）、ポーリング | ◯ |
| `gas/kvgas.js` | 送迎表の保存エンジン（端末保存・再送・マージ・ポーリング） | ◯ |
| `gas/sougei_boot.js` | 送迎表ページの起動 | ◯ |
| `calcore.js` | カレンダーの共通部品（画面とサーバーで同じコード。→ `Lib1_calcore.gs`） | ◯ |
| `kvsync.js` | merge3・eq・encKey（→ `Lib2_merge.gs`） | ◯ |
| `calsync.js` | カレンダー→送迎表の反映 `SGCal.reconcile`（→ `Lib3_calsync.gs`） | ◯ |
| `mcp/engine.js` | `sougei.jsx` の計算部分をサーバー用に束ねたもの（→ `Lib4_engine.gs`、グローバル `SGEngine`） | ✕ 生成物 |
| `mcp/relay-worker.mjs` | Cloudflare Worker の中継（→ `gas/out/relay_cloudflare.js`） | ◯ |
| `gas/out/` | **Googleに貼るファイル一式**（生成物） | ✕ |
| `build/` | 画面の束ね（esbuild＋Tailwind）。`build/shims` で React/three をグローバル（CDN）に向ける | shimsのみ |
| `history/` | 以前の作り方（元のv1/v2/v3 → パッチを順に当てて作っていた）。参考用。**使わない** | ✕ |

## 作る・試す
```bash
npm install && (cd build && npm install) && (cd pw && npm install && npx playwright install chromium)
bash build.sh        # → gas/out/ ができる
bash test.sh         # Nodeのテスト全部
bash test.sh ui      # ＋ブラウザ(Playwright)のテスト
```
- テスト：`test-kv.js`（保存エンジン・同時編集/通信断 10件）、`test-excel.js`（送迎表のExcel出力に版が入る）、`test-cal.js`（反映・AM/PM休・ヘルプ/送迎の変更/迎え先・送り先/休日出勤/勤務時間変更）、`test-agent.js`（AIと相談の適用 10件）、
  `gas/test-gas.js`（サーバー 27件。`gas/fakegas.js` が本物のスプレッドシートの癖まで再現）、`gas/test-ai.js`、
  `mcp/test-mcp.js`（公式MCPクライアントで35件。Googleの302転送も再現）、`pw/gas_ui.js`・`pw/agent_ui.js`（画面）
- `mcp/devserver.js`＋`mcp/call.js`：擬似Google＋中継を常駐させ、Claudeと同じ経路で道具を手で呼べる（`node mcp/call.js get_day '{"edition":"v1","date":"2026-11-02"}'`）
- `sougei.jsx` の関数をテスト/サーバーで使うときは `build.sh` の `EXP` と `mcp/engine_entry.js` に名前を足す

## 本番への出し方（依頼者がやる）
スプレッドシート → 拡張機能 → Apps Script に `gas/out/` の `.gs` と `.html`、`appsscript.json` を貼る →
初回はエディタで `setup` を実行 → デプロイ（ウェブアプリ）。更新は「デプロイを管理 → 編集 → 新バージョン」（URLは変わらない）。
`setup` が `職員ID` シートを作り、職員番号（3桁、自動）と初期PINを振る。管理者は `000`。
暗証番号の再発行：`職員ID` のF列（備考）に「再発行」と書いて、エディタで `resetPins` を実行 → D列に新しい初期番号、前のログインは切れる（キャッシュで最長10分）。
運用開始までの手順書（依頼者向け）は会話で Artifact として渡した（ファイルの貼り方・setup・デプロイ・データ移行・権限・試運転・職員への配布・日々の運用）。

## 送迎表のExcel出力に入る版
`appVerLabel()`（sougei.jsx）＝ `Ver293(2026.10.27f)`：Ver＋`SEED_VERSION`、括弧内はGoogle版の `APP.VERSION`（ログイン時に `SGHost.me.version` で届く）。
ファイル名 `送迎表_11月2日(月)_Ver293(2026.10.27f).xlsx`、表の一番下の行、印刷の右上に入る。**ファイルを直して出すたびに `gas/Code.gs` の `APP.VERSION`（と `calendar_app.js` の `APP_VERSION`）を上げる**（`SEED_VERSION` は上げるとマスタの初期データが入り直るので、版の区別のために上げない）。

## データの置き方（スプレッドシート）
- `_docs`（隠し）：1行1文書。A=パス、B=版(rev)、C=日時、D=meta(JSON)、E=分割数、F〜=JSON本体（45000字ごと、各セル頭に `J`）
  - 送迎表：`kv/<encKey(キー)>`。キーは `master`（利用者・職員・車両・部署・ルール）/ `sheet:YYYY-MM-DD` / `pattern:0〜6`（週間パターン）。版の頭 `v2:`/`v3:`
  - カレンダー：`days/…`（日ごと・シャード）、`cm/…`（コメント）。Claudeの案：`prop/<id>`
- `職員ID`・`変更履歴`・`設定`（B2=公開URL）・`よみがな`（A=名前・B=よみ・C=職員/利用者。名前は送迎表から自動で足す `syncYomi_`、読みは管理者が入れる）・`_auth`・`_sessions`・`AI接続`（コネクタの鍵）
- **スプレッドシートの自動変換に注意**：`"000"`→0、`"0123"`→123、`=`/`+`/`-`/`@` で始まる文字→数式、日付→Date。
  書くときは `txt_()`（先頭に `'`）か `safe_()`、PINは `pinOf_()`、職員番号は `normNo_()`、ハッシュは `h:` 付き。`fakegas.js` はこの変換を再現する
- CacheService は1値100KBまで（日本語はUTF-8で数える `utf8len_`）

## カレンダー → 送迎表の反映
予定に `sg:{type, staff[], users[], meet, send, noMeet, noSend, half, reason, note, dept, wstart, wend, meetPlace, sendPlace}` を付けると、その日の送迎表に自動反映（`calsync.js`）。
職員・利用者・部署は**送迎表の名前**で持ち、各版のマスタで名前から探す（見つからない名前は「反映されていません」と表示）。
- `staff_off`：職員の休み・不在。`half:"am"|"pm"` は**その職員のその曜日の勤務時間の真ん中**で区切る（夜勤の日またぎ対応）
- `staff_plan`：職員の予定（送迎表の「予定」欄へ）
- `user_extra`：利用日外利用 → `userExtra[利用者ID]=true`（送迎表の「今日だけ利用」。その日の利用者になり、迎え・送りが未割当に出る）。迎え・送りの変更・迎え先/送り先は `user_time` と同じ
- `user_absent`：利用者の欠席 / `user_time`：送迎の変更（迎え：時間変更/家族送り/受診後送り、送り：時間変更/家族迎え。家族送りなどは `noMeet`/`noSend` に理由としてそのまま入る）
  - 迎え先・送り先の変更（`meetPlace`/`sendPlace`）→ その日その人が乗る迎え／送りの便の `places[利用者ID]`（送迎表の「その日だけの行き先」）。
    まだ便に入っていなければ記録だけして、便に入った保存のときに入れる（`healPlaces`）。別の便に移しても付いていく。
    手で別の行き先にした便は触らない。予定を消すと、反映した値のままの便だけ元の行き先に戻す。候補は `names.list` の `places`
- `help`：ヘルプ → `blocks` に `kind:"help"`（ID `cal_<予定ID>_<職員ID>`、開始時刻だけ・長さは送迎表の決まり（`durMin` を付けない）。
  2026-10-28〜 カレンダーでは職員を選ばず**利用者**を選ぶ → 保留欄 `__hold__` に `label`=利用者名、家以外の行き先は `note`（（ ）書きで出る）。
  担当者が送迎表で職員の欄へ動かしても同じIDなので残る。以前の職員つきの予定（`staff`）も今までどおり職員の欄に入る
- （以前あった「送迎＝臨時の便を作る `ride`」は 2026-10-27 に廃止。送迎ラベルは `user_time`）
- `hwork`：休日出勤 → `staffOv` に `workToday:true`（＋時間指定なら start/end、部署を選んだら deptId）
- `shift`：勤務時間変更 → `staffOv` に start（出勤）/ end（退勤）/ deptId（その日の部署）。空の項目はいつもどおり。何日も続く予定は各日に入る
- ヘルプは**その版の職員も利用者もいなければ、その版には入れない**（他の事業所の予定で保留欄が埋まらないように）
- 一般職員は自分の `staff_off` / `staff_plan` / `hwork` / `shift` だけ。`user_*`・`help` は送迎表権限のみ（サーバーでも `calApply_` で検査）
- 反映済みの記録（calApplied: prev/mine）を持ち、予定を消したら項目単位で元に戻す。パターン読込などで消えた分は heal で戻す
- カレンダーの「休みを入れる」：プルダウン（休み（1日）/AM休/PM休）＋入れるボタン

### カレンダーのラベルと入力項目（2026-10-27）
`help`=ヘルプ、`ride`=送迎、`leave`=職員休み、`user`=利用者休み、`other`=その他予定、`hwork`=休日出勤、`shift`=職員時間変更（画面の名前。以前は勤務時間変更）、`extra`=利用日外利用、`monitor`=モニタリング、`shien`=支援会議（以前の「会議」`meeting` と混ざらないよう別の名前）。
以前の `meeting/visit/deadline/event` は `normEvent` で `other` 扱い。編集画面はラベルが一番上で、選んだラベルの項目だけが出る（`calendar_app.js` の `drawSg`）。
ラベルが反映の種類を決める（`sgOf`）。開いた予定の `sg.type` からラベルを合わせる（`LABEL_OF_SG`）。タイトルは空欄なら自動（`autoTitle`）。

| ラベル | 入力項目 | 送迎表へ |
|---|---|---|
| ヘルプ | 利用者・開始時刻・行き先（家以外のときだけ） | 保留欄に【ヘルプ（利用者）】（担当は送迎表で割り当て） |
| 送迎 | 利用者・迎え（いつもどおり/時間変更/家族送り/受診後送り）・送り（いつもどおり/時間変更/家族迎え）・迎え先／送り先の変更（迎えなし・送りなしのときは出さない） | 時刻・迎えなし/送りなし（理由つき）・便の行き先 |
| 職員休み | 職員・1日/AM休/PM休/時間で（中抜け・通院など）。**理由は聞かない** | 休み・半休・不在 |
| 利用者休み | 利用者・理由（任意） | 欠席 |
| 利用日外利用 | 利用者・迎え／送り（いつもの時刻・時間変更・家族送り(迎え)など）・迎え先／送り先 | 今日だけ利用（未割当に出る）＋送迎の変更 |
| その他予定 | タイトル・時間・場所・担当（職員、予定の `tanto` に残る）・「担当の職員の予定として送迎表にも載せる」 | （載せるときだけ）予定 |
| 休日出勤 | 職員・出勤〜退勤の時刻（必須）・その日の部署 | 出勤（休出）＋時刻 |
| 職員時間変更 | 職員・出勤／退勤（それぞれ いつもどおり/時刻を変える）・その日の部署・理由（早出/遅出/残業/遅刻・早退） | その日の勤務時間・部署 |
| モニタリング／支援会議 | 利用者・時間・場所・対応者（すべて必須） | 対応者の予定（`staff_plan` に `users` 付き。ラベルは予定の `label` で見分ける） |

一般職員にはヘルプ・送迎・利用者休み・利用日外利用のラベルは押せない（灰色）。職員休み・休日出勤・勤務時間変更・職員の予定は自分の分だけ。
モニタリング・支援会議の対応者は、一般職員は自分だけ、送迎表の担当者と管理者は誰でも（サーバーの `calApply_` で `label` を見て許可）。
部署の選択肢・ヘルプの行き先の候補はサーバーの `names.list`（キャッシュ名 `names2`）から。
名前の入力は予測（`sgHits`）：「よみがな」シートの読みの頭・名前の頭が合うものを先に（カタカナ・半角もそろえる `kanaNorm`）。ラベルの並びは ヘルプ・送迎・利用者休み・利用日外利用・モニタリング・支援会議・職員休み・休日出勤・職員時間変更・その他予定。新しい予定は「ヘルプ」が選ばれた状態（一般職員は「職員休み」）。日の欄・リスト・月のマスの予定もこのラベルの順に並ぶ（`cmp`：ラベル→何日も続く→終日→時刻→タイトル）。モニタリング・支援会議の場所は利用者・対応者のすぐ下。項目を作り直しても画面の位置は保つ（`drawSheet` の keep）。
参加者（members）の入力欄は出さない（既存のデータは残す）。「自分の予定」は参加者・担当・送迎表の対象職員に自分が入っているもの。

## AI
1. **🤖 AI調整・💬 AIと相談**（送迎表画面）：サーバー `ai.messages` が Anthropic API を呼ぶ（スクリプトプロパティ `ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL` 既定 `claude-sonnet-5-5`）。
   1回ごとに料金がかかるため**依頼者は使わない判断**。2026-10-28〜 キー未設定ならボタンを出さない（サーバーの `aiEnabled_` → `me.aiApi`、画面の `aiApiOn()`）。
   中身（組み替えの仕組み）はClaudeの案と共通なので残す。`pw/agent_ui.js` は `aiEnabled_` を true にして試す
2. **Claudeアプリ（月額プラン）＋カスタムコネクタ**（`gas/Mcp.gs`）：依頼者が選んだ方向。
   Claudeは `propose` で「案」を置くだけ → 送迎表画面の「🤖 Claudeの案」で担当者が反映（サーバーで3者マージ）。
   接続URLは `issueConnectorUrls()` で職員ごとに発行（`AI接続` シート、権限 管理者/送迎表のみ）。
   **Googleは POST に必ず302転送で返し、公式MCPクライアント(1.32)は既定でそれを辿らない** → Cloudflare Worker 中継（`/mcp/<鍵>`）経由が前提。
   手順は `gas/Claude接続の手順.txt`（gas/out では `Claude_connect.txt`）

## まだ確かめていない／残っていること
- [x] 各ラベルの入力項目と、ヘルプ・送迎・休日出勤の送迎表への反映（依頼者の確認待ち：理由・内容の選択肢は仮）
- [ ] 本物のGoogle上での動作（ここまでは `fakegas.js` の再現環境でのみ検証）
- [ ] 本物の claude.ai からカスタムコネクタでつながるか、Cloudflare中継の実地確認
- [x] AIボタン（API版）はキーが無ければ隠す（2026-10-28 依頼者の判断）
- [ ] 約200人同時の負荷（GASの同時実行上限30・LockServiceの待ち）を実環境で計測

## 過去にあった不具合（同じ穴に落ちないために）
- `normNo_(0)` が空になり管理者000がログイン不能 → `no == null` で判定
- PINの先頭0が消える、`+`で始まるハッシュが数式になる、履歴セルが数式になる → txt_/safe_/h:
- `?d=` からのXSS → 日付の形を検査し `<` をエスケープ
- 後から作った日・パターン読込で消えた休みが反映されない、古い画面が反映を戻す → サーバー反映＋heal＋項目単位で戻す
- AI調整の重複除去が移動便（`mode:"move"`、例：成相 あいのて→嫁島）を消した → move は対象外
- 画面が真っ白：esbuild で react の解決ずれ → `--alias` で shims に固定
- `collectSheetChecks` の引数名衝突（TDZ）→ `patDayArg`
- **スマホでメニューの送迎表が開けない（「ファイルを開くことができません」）**（2026-10-28 実機）：`ScriptApp.getService().getUrl()` がテスト用の `…/dev`
  （作った人しか開けない）を返し、メニューのリンク・Claude接続URLがそれになっていた → `appUrl_()`：「設定」シートB2の公開URL（`…/exec`）を優先。
  画面側（gashost）も `…/dev` のときは開いたときのURL（referrer）が `…/exec` ならそれを使う。確認画面に「画面どうしのつながり」
  さらに実機で、公開URLが分からないまま作ったメニューのリンクが中身用のアドレス（`…googleusercontent.com/userCodeAppPanel?page=sougei…`）を指し、
  送迎表が真っ白になった → 公開URL（`…/exec`）が分からないときはリンクを作らず「設定シートB2に貼って」と出す。B2は後ろの `?page=…` を落として読む。
  B2を入れても開いたときの `__SG_BASE` が届かなかった（原因未確認）ので、ログイン後に `app.base` でサーバーに聞き、端末にも覚える（gashost の `learnBase`・`sg:base`）
- **本物のGoogleで画面が真っ白／カレンダーが「接続中…」のまま**（2026-10-28 実機）：Googleは画面をいったん自分の仕組み（mae_html_user の document.write）で書き出し、
  プログラムの中の「タグに見える文字」でログインの土台（gashost）を途中で切った（`Failed to execute 'write' … Unexpected end of input`）。
  → `assemble_gas.py` の `ev()` で、画面のプログラムはすべて「<」を含まない文字列にして `(0,eval)(…)` で実行する。確認画面のプログラムも同じ。
  送迎表（約65万字）は1つの長い文字列だと真っ白のままになったので、2万字ずつの文字列に分けて `[…].join("")` でつなぐ（2026-10-28）。
  `gas/test-gas.js` で「画面のプログラムに < がない」ことを検査。fakegas はこの書き出しを再現しないので、実機で確かめる。
  困ったときは `…/exec?page=check`（確認画面）と、画面の下に出る赤い枠（GUARD）を見る
