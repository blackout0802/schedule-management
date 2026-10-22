# 引き継ぎメモ（スケジュール管理アプリ）

新しいセッションの最初に、これを読んでください。最終更新: 2026-10-22 / 現在の版: **v1.79.0**（v1.78.0 までは本番に反映済み。v1.79.0 は別ブランチ `claude/schedule-to-daily-report-uars4x` に push ずみで、自動デプロイの対象外。本番に出すには、デプロイ対象のブランチへ取り込む）

## 1. アプリと作業場所

- 小さな会社向けの、PHP + MySQL(MariaDB)/SQLite のスケジュール管理アプリ。画面は日本語。
- リポジトリ: `blackout0802/schedule-management` / 作業ブランチ: `claude/intelligent-brahmagupta-qhk963`（ここに push する。別ブランチには push しない）
- 本番: `https://schedule-management.skym.ink/public/index.php`
- PR は、ユーザーが頼んだときだけ作る。

## 2. 毎回の進め方（ユーザーとの約束）

1. 実装する。
2. 確かめる: PHP 単体テスト（SQLite と MariaDB）、画面テスト（Playwright）。必要なら古い DB からのアップグレードも。
3. `src/version.php` の `APP_VERSION` を上げる。
4. コミット（メッセージの末尾に、指定のトレーラーを付ける）して、ブランチに push する。
5. 返事は日本語で、「**変えたこと／確かめたこと／確かめていないこと**」の3つを書く。
6. push のあと、GitHub Actions の結果を見る（約12分後に確認）。通ったら、ユーザーに実機確認を頼む。

ユーザーがパスワードや鍵をチャットに貼らないこと（Secrets は GitHub の設定画面だけ）。認証情報をコミットしない。

## 3. 自動デプロイ（GitHub Actions）

- `.github/workflows/test.yml`。ブランチに push すると、unit（PHP 7.4/8.1/8.3）・mariadb・compat・e2e が走り、**すべて通ったときだけ** `deploy` ジョブが FTPS でサーバーに反映する。
- 使うのは SamKirkland/FTP-Deploy-Action@v4.3.5。Secrets は `FTP_SERVER` `FTP_USERNAME` `FTP_PASSWORD` `FTP_SERVER_DIR`（ユーザーが登録済み）。
- `FTP_SERVER_DIR` は **public の親フォルダ**: `/skym.ink/public_html/schedule-management.skym.ink/`。末尾の `/` はワークフローが補う。`/public/` で終わる指定は、ガードが止める。
- 反映するのは `public/ src/ sql/ bin/`（`tools/stage_deploy.py stage` で 38 ファイルをそろえる）。除外: `install.php` `app_path.php` ドットファイル `config.php`。
- サーバーの `.ftp-deploy-sync-state-schedule.json` は消さない。ローカルで消したファイルは、サーバーからも消える。
- この作業環境からは、FTP も本番サイトも見えない（HTTPS のプロキシのみ）。Secrets の読み書きもできない。本番の確認はユーザーに頼む。
- zip でのシステム更新は、v1.77.0 で廃止済み（`update.php` `updater.php` を削除）。

## 4. 技術メモ

- PHP 7.4 以上（PDO: SQLite / MariaDB）。`SCHEMA_VERSION` は 28。
- フロントは `public/assets/app.js` 1本（ES5 の IIFE。**アロー関数・テンプレートリテラルは使わない**）。補助関数: `el()` `api()` `store()`（localStorage に JSON）`openModal`。設定ページへの埋め込みは `embedHost`。
- 画面の色はテーマ用の CSS トークン。ライト／ダーク／自動はアイコンで切り替え（`themeSwitch()`）。
- 設定の各項目は、クリックで開閉（状態は `store('sched.setOpen')`）。
- カレンダー: 月表示は4段、週表示は12段まで。あふれると「他 n件」。完了した予定は下に出る。
- ToDo の状態は `todos.doing`（0 未着手 / 1 進行中 / 2 保留）。
- 共有リンクは `share_links`（`created_by` あり）。共有ページで、リンクを作った本人だけに「← 自分の画面に戻る」を出す（サーバーは `mine` の true/false だけ返す）。

### 家族のアカウント（v1.76.x）

- 持ち主（社員）が家族を招待する。`users.role = 'family'`、`users.family_of` に持ち主の番号。1人の持ち主につき最大5人（`FAMILY_MAX`）。
- 家族が使える API は `FAMILY_ALLOWED_ACTIONS` だけ（それ以外は 403）。家族の予定は、常にプライベート／家族共有になる。
- 家族に見えるのは、持ち主の家族用リンクに見える予定と、持ち主の家族の予定。実装は `src/family.php` と、`src/events.php` の分岐。
- 家族は、ユーザー一覧・利用状況・監査ログ・家族の更新履歴には出ない。

### v1.78.0 で入れたもの

- 新しい業務の予定の分類の初期値は「個人作業」（休み→業務の切替時も）。繰り返し業務の登録だけは「定例業務」のまま。
- 開始時刻を入れると、終了時刻に30分後が自動で入る（23:30 以降は 23:59）。手で入れた終了は変えない。自動で入れた終了は、開始を消すといっしょに消える。

### v1.79.0 で入れたもの（日報の自動反映）

- スケジュールに入っている**業務のToDo**（未完了）を、日報に自動で入れる（`memoAutoSync()`、`public/assets/app.js`）。
  - 進行中: 当日の項目へ。カレンダーに先の日付で置いてあるものは、その日付の日報へ（当日より先なら、置いた日が次回出勤日のときだけ次回出勤日の項目へ。それより遠い日は、まだ入れない）。
  - 未着手: 日付が決まっているものだけ、その日付の日報へ。日付 = カレンダーに置いた日（`sched`〜`sched_end`）。置いていなければ期限日。
  - 保留は入れない。完了は、これまでどおり `memoAddDone`（完了にした瞬間に、取り消し線つきで入る）。プライベートのToDoは入れない。
  - 一度入れた（または、すでに日報にある）ToDoは、**当日の見出しの `data-auto`**（「番号:日付」のカンマ区切り、最大40件）に控える。日報から消した行は、入れ直さない。日報に同じ文言の行があれば、足さない。
  - 起動のきっかけ: 日報を開いたとき（`memoReconcile` の中）、ToDoを読み込み直したとき（`syncMemoTodos`）。
- サーバー: `todo_with_event_dates()` が `sched_end`（置いた予定の最終日）も返す。`sanitize_memo_html()` が見出しの `data-auto` を通す（数字・`:`・`-`・`,` だけ、900文字まで）。雛形には `data-auto` を持ち込まない。
- 画面テスト `memoauto`（新規）。
- **ユーザーに確かめてもらうこと**: 「スケジュール」の意味を、「カレンダーに置いた／日付のあるToDo」と受け取った（カレンダーだけに直接入れた予定は、ToDoと結びついていなければ入らない）。進行中で日付のないToDoも、当日に入れる。意図と違えば直す。

## 5. テスト

- PHP 単体: `php tests/run.php`（SQLite）。約690件。
- MariaDB: 手元では `mariadbd --datadir=/tmp/mdb/data --socket=/tmp/mdb/s.sock --port=3399` を起動して、DB `sched_t` を **毎回 DROP/CREATE してから** 実行する。
  `SCHEDULE_TEST_DSN='mysql:host=127.0.0.1;port=3399;dbname=sched_t;charset=utf8mb4' SCHEDULE_TEST_USER=t SCHEDULE_TEST_PASS=tp php tests/run.php`
- 画面テスト: `bash tests/e2e/run.sh`（全部）／`bash tests/e2e/run.sh tm flog`（指定）。ポート 8099/8098、`TZ=Asia/Tokyo`。全部で約11分。
  - テストは `tests/e2e/suites/*.js`（68本）。失敗したスイートの `console.log` は出ない。デバッグはファイルに書き出す。
  - 設定のテストは、`tests/e2e/lib/preload.js` が全項目を開いた状態にする。
- 気をつけること:
  - 日付・時刻に依存するテスト（UTC と JST の日の境目、月末の月曜、マウスが残ってホバーの色になる、段の上限で予定が隠れる）は、CI でたまに落ちる。
  - 非同期の古い応答に注意（監査画面は `loadSeq` で対策済み）。
  - Playwright の `fill` は `change` が遅れて出ることがある。自動入力のテストでは、`Tab` を押してから次の欄を埋める。
  - 自分のシェルに当たる `pkill -f` は使わない。前面の `sleep` は使えない（待つときはループで）。

## 6. 今の状態（2026-10-22）

- v1.78.0: CI すべて成功、本番に反映済み。ユーザーが確認ずみ（版の表示・分類の初期値・終了の自動入力・共有ページの戻るボタン・zip 更新の削除）。
- v1.79.0: 日報の自動反映（上の説明）。作業ブランチ `claude/schedule-to-daily-report-uars4x`。
- **ユーザーが「家に帰ってから試す」と言っていること**: 家族の招待の実機確認（招待、家族の初回ログインとパスワード変更）と、スマホ表示。結果を待つ。気になる点が出たら直す。

## 7. 保留・今後の候補

- 家族のアカウントの範囲（自分の予定の入力＋家族用の閲覧だけ／最大5人／パスワードの再発行は持ち主）が、使ってみて足りるか。
- FTP やサーバーのパスワードを変えたら、GitHub の Secrets も更新が必要（ユーザーが GitHub の設定画面で行う）。
- そのほかに、約束して後回しにしたものは、記録にない。ユーザーから出たら、ここに足す。

## 8. 関連ファイル

- `README.md`（機能一覧）／`docs/DEPLOY.md`（11・11-2 に自動デプロイ）／`tests/e2e/README.md`（画面テスト一覧）
- `public/guide.php`（アプリ内の手引き）／`src/version.php`（版）
