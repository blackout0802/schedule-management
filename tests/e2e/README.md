# 画面テスト（ブラウザを動かして、画面ごと確かめる）

`tests/run.php`（部品ごとの自動テスト）とは別に、Chromium を実際に動かして、ログイン・カレンダー・ToDo・日報・共有リンク・バックアップなどを、画面から操作して確かめます。機能を変えたあとに、まず両方を流してください。

## 動かし方

```bash
bash tests/e2e/run.sh              # すべて（40本ほど。10分前後）
bash tests/e2e/run.sh who sum      # 名前を指定して、それだけ
bash tests/e2e/run.sh --list       # テストの一覧
```

- 必要なもの: php 7.4以上（PDO・GD）、node、Playwright（`npm i -g playwright@1.56.1`。CIも同じ版。`npx playwright install chromium` で Chromium も。版が古いと、CSPの制限で、`waitForFunction` が動かないことがあります）。
- データベースは、既定で **SQLite**（用意は不要）。MySQL / MariaDB で動かすときは、先に空のデータベースを作って:

  ```bash
  E2E_DSN='mysql:host=localhost;dbname=sched_e2e;charset=utf8mb4' E2E_DB_USER=sched E2E_DB_PASS=xxx bash tests/e2e/run.sh
  ```
  （そのデータベースの表は、テストのたびに、全部消して作り直されます。本番のデータベースは、絶対に指定しないでください）
- 使うポートは `8099`（アプリ）と `8098`（Slack の代わり）。使用中だと、始まる前に止まります。
- アプリは、`tests/e2e/.work/app` に**複製**して動かすので、本物の `data/`・`config.php` には触りません（`.work/` は git に入りません）。テストごとに、データベースを作り直し、管理者・山田・鈴木の3人（パスワードは `lib/seed.php`）を入れます。
- 終了コードは、全部成功なら 0。失敗したテストの名前と、最初のエラーが出ます。画面の写真などは `tests/e2e/.work/out/` に出ます。

## 構成

| 場所 | 内容 |
|---|---|
| `run.sh` | 実行用。アプリの複製・サーバー起動・データベースの作り直し・各テストの実行 |
| `suites/*.js` | 1本が1つのテスト（Playwright）。`NG` の行が1つでもあれば失敗。名前で指定できる |
| `lib/env.js` | テストの共通部分（`sql()`＝データベースへ直接SQL、`ago()`、`tableExists()`、Slack受信ログの場所） |
| `lib/seed.php`・`seed-demo.php` | 社員3人を作る／週をまたぐ予定など、見た目の確認用の予定を入れる（`seg` だけが使う） |
| `mock/hook.php` | Slack の代わり。送られた内容を `.work/slack.log` に残す |

## 主なテスト

| 名前 | 確かめること |
|---|---|
| `e2e` `add` `pv` `sv` `cx` `modal` | ログイン・予定の追加・版の切り替え・ショートカット・ダイアログ |
| `who` `sum` `kind2` `imp` `col` `rec` `hol` `seg` `dp` | 表示する人・月のまとめ・休みと業務の見え方・重要・色・繰り返し・祝日・週をまたぐ帯 |
| `dnd` `kb` `th` `tdlink` `tm` | ToDoのカンバン・カレンダーへのドラッグ・完了で取り消し線 |
| `memo4` `memo5` | 日報（日付の自動入れ替え・転記・貼り付け・過去の日報） |
| `tdshare` `tdc` `tdimg` | 業務ToDoの共有・コメント・画像の添付 |
| `lk` `sp` `famoff` `fldel` `flog` `dup` | 共有リンク（会社用・家族用）・家族の更新履歴・予定の複製 |
| `bk` `bk2` `au` `auddel` `sl` `sc` | バックアップ（手動・自動・アラート）・変更履歴・Slack通知 |
| `pcolor` | 全社の表示: 業務の先頭に名前・人ごとの色分け（休みは「休」バッジ）・同じ姓はフルネーム・本人が決めた色が優先 |
| `rooms` | 会議室の予約（部屋ごとの色・予約の決まり・非公開・取り消しと元に戻す・管理者の設定・Slack通知・スマホ幅） |
| `adm-mobile` `csp` `pw` `lp` `tips` `sw` `tomb` `fx` | スマホ幅・CSP違反なし・パスワード変更・ログイン制限・使い方・サーバーの更新反映など |

## テストを足す・直すとき

- 初期表示は「自分」です。他の人の予定・ToDoを見るテストは、先に `#who-sel`（カレンダー）や `#todo-mgr .todo-who select`（ToDo）で `all` を選んでください。
- 日付は、実行した日から計算してください（月や曜日が違っても通るように）。祝日が絡む予定は、`lib/seed-demo.php` のように、祝日を避けます。
- データベースの中を見るときは、`sql()` を使います（MySQL専用の SQL は避ける）。
