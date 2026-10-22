<?php
// 運用の手引き（管理者のみ）: 印刷してそのまま渡せる1ページ。この環境の値（場所・cron・バックアップの状態）が入る。
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';
require_once SCHEDULE_APP_DIR . '/src/backup.php';
require_once SCHEDULE_APP_DIR . '/src/usage.php';

$user = current_user();
if (!$user) {
    header('Location: login.php');
    exit;
}
if (!is_admin($user)) {
    http_response_code(403);
    exit('このページは管理者だけが使えます。');
}
if ((int)$user['must_change_password'] === 1) {
    header('Location: index.php');
    exit;
}
$appName = (string)cfg('app_name', 'スケジュール管理');
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$base = (string)cfg('base_url', '');
if ($base === '') {
    $base = ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '') . rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/';
}
$app = SCHEDULE_APP_DIR;
$php = '/usr/bin/php' . PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;
$auto = backup_auto_status();
$warns = usage_report()['warnings'];
$nWarn = count(array_filter($warns, function ($w) { return $w['level'] === 'warn'; }));
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="robots" content="noindex">
<title>運用の手引き｜<?= h($appName) ?></title>
<style>
:root { --bg:#f2f2f7; --paper:#fff; --ink:#1c1c1e; --muted:#6e6e73; --line:#d8d8de; --accent:#0a66c2; --code:#f3f3f6; --warn:#fff4e5; }
@media (prefers-color-scheme: dark) { :root { --bg:#0e1522; --paper:#162033; --ink:#e8eef8; --muted:#9aa8bd; --line:#2a3850; --accent:#6db3ff; --code:#1e2b43; --warn:#3a2a14; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.7 -apple-system, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif; }
.sheet { max-width: 820px; margin: 0 auto; padding: 20px 16px 48px; }
.paper { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 22px 26px 26px; }
h1 { font-size: 22px; margin: 0 0 2px; }
.sub { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
h2 { font-size: 16px; margin: 20px 0 6px; padding-bottom: 3px; border-bottom: 2px solid var(--line); break-after: avoid; }
p, ul, ol { margin: 4px 0 8px; }
ul, ol { padding-left: 1.4em; }
li { margin: 2px 0; }
code, pre { background: var(--code); border-radius: 5px; font: 12.5px/1.5 ui-monospace, Menlo, Consolas, monospace; }
code { padding: 1px 5px; overflow-wrap: anywhere; }
pre { padding: 8px 10px; margin: 6px 0; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 6px 0; }
th, td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: var(--code); font-weight: 600; white-space: nowrap; }
.note { background: var(--warn); border-radius: 8px; padding: 8px 12px; margin: 8px 0; font-size: 14px; }
.memo td { height: 2.2em; }
.tools { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.tools a, .tools button { font: inherit; font-size: 14px; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); text-decoration: none; cursor: pointer; }
.tools .p { background: var(--accent); border-color: var(--accent); color: #fff; }
@media print {
  body { background: #fff; color: #000; font-size: 11px; line-height: 1.5; }
  .sheet { max-width: none; padding: 0; } .paper { border: 0; padding: 0; } .tools { display: none; }
  h1 { font-size: 18px; } h2 { font-size: 13px; margin: 10px 0 3px; } p, ul, ol { margin: 2px 0 4px; } table { font-size: 10.5px; }
  code, pre { font-size: 10px; background: #f3f3f6; } .note { background: #fff4e5; }
  @page { size: A4; margin: 12mm; }
}
</style>
</head>
<body>
<div class="sheet">
  <div class="tools"><a href="index.php#settings">← 設定へ戻る</a><button class="p" type="button" id="print-btn">印刷する</button></div>
  <div class="paper">
    <h1><?= h($appName) ?>　運用の手引き</h1>
    <p class="sub">v<?= h(APP_VERSION) ?>　／　<?= h($base) ?>　／　<?= h(date('Y年n月j日')) ?> 時点<?= $nWarn ? '　／　<b>いま、対応が必要な項目が ' . $nWarn . ' 件あります（設定「利用状況」）</b>' : '' ?></p>

    <h2>1. 定期的にやること</h2>
    <table>
      <tr><th>いつ</th><th>何を</th></tr>
      <tr><td>月に1回</td><td>設定「バックアップ」で、手動のバックアップをダウンロードし、<b>サーバーとは別の場所</b>（パソコン・クラウド）に保管。パスワードは、ファイルとは別に控える。30日たつと、管理者の画面にお知らせが出ます。</td></tr>
      <tr><td>ときどき</td><td>設定「利用状況」を開き、「気をつけること」が無いか確認（自動バックアップ・cron・画像の容量・長く使っていない人）。</td></tr>
      <tr><td>会議室の使い方を変えるとき</td><td>設定「会議室の設定」で、部屋の名前・定員、予約できる時間・先の月数、Slack通知の時刻を変えます。年末年始などは「会社の休業日」に登録（その日は会議室も予約できなくなります。管理者だけは予約できます）。</td></tr>
      <tr><td>人が変わったとき</td><td>入社 → 「社員の管理」で追加。退職 → 同じ画面で<b>停止</b>（ログインできなくなり、予定の記録は残ります）。</td></tr>
      <tr><td>新しい版が出たとき</td><td>自動で反映されます（下の「3. 新しい版にする」）。画面を開き直して、版の数字を確認。</td></tr>
    </table>

    <h2>2. パスワードを忘れたとき</h2>
    <ul>
      <li><b>一般の社員:</b> 管理者が、設定「社員の管理」→ その人の「パスワードをリセット」。表示された一時パスワードを本人に伝えます（本人は、次のログインで自分のパスワードに変更）。</li>
      <li><b>管理者本人:</b> サーバーのコマンドで一時パスワードを作ります（Web からは動きません）。管理者を2人にしておくと、もう1人がリセットできます。
<pre>cd <?= h($app) . "\n" ?>php bin/reset_password.php 管理者のメールアドレス</pre></li>
      <li>短時間に失敗しすぎると、15分ほどロックされます。待てば元に戻ります。</li>
    </ul>

    <h2>3. 新しい版にする（自動で反映されます）</h2>
    <ol>
      <li>新しい版は、開発側が GitHub に上げます。自動テストにすべて成功すると、<b>サーバーへ自動で反映</b>されます（管理者の作業は、ありません）。</li>
      <li>反映後、画面を開き直し（Ctrl + F5）、画面タイトルの横の版の数字が上がったことを確認します（現在 <b>v<?= h(APP_VERSION) ?></b>）。</li>
      <li>データベースの変更（表や列の追加）は、画面を開いたときに、自動で行われます。</li>
    </ol>
    <p>データは、版を上げても消えません。念のため、大きな更新のあとは、手動バックアップを1つ取っておくと安心です。おかしくなったときは、開発側に連絡して、前の版に戻してもらいます。</p>

    <h2>4. バックアップと復元</h2>
    <ul>
      <li><b>自動:</b> <?= $auto['enabled'] ? '設定済み（毎日 3時以降に、暗号化して <code>data/backups/</code> に最大 ' . (int)$auto['keep'] . ' 件）。最後に作った日時: ' . h($auto['last_at'] ?: 'まだありません') . '。' : '<b>まだ設定されていません。</b>設定「バックアップ」でパスワードを決めると、毎日自動で保存されます。' ?>ただし同じサーバーの中なので、サーバーが壊れると一緒に失われます。</li>
      <li><b>手動:</b> 設定「バックアップ」→ ダウンロード。プライベートの予定も含みます（<b>パスワードを知る人だけ</b>が開けます）。</li>
      <li><b>復元:</b> 同じ画面で、ファイル＋パスワードを指定して「復元する」。復元すると、いまのデータはバックアップの内容に置き換わり、操作した管理者はいったんログアウトされます（管理者のいないバックアップは断られます）。</li>
      <li><b>含まれないもの:</b> <code>config.php</code>（DB の接続情報）と、ToDo の画像（<code>data/attachments/</code>）。必要なら別にコピー。</li>
      <li>サーバーのコマンドで復元: <code>BACKUP_PASSWORD=… php bin/restore_backup.php ファイル</code></li>
    </ul>

    <h2>5. 自動処理（cron）</h2>
    <p>サーバーパネルの cron に、次の2つを登録します。PHP のパスは、サーバーのマニュアルで要確認です（下は、いま動いている PHP <?= h(PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION) ?> からの推測）。</p>
    <pre>毎日 0:30      <?= h($php . ' ' . $app) ?>/bin/cron.php nightly
10分おき       <?= h($php . ' ' . $app) ?>/bin/cron.php notify</pre>
    <p><code>notify</code> は、Slack の朝・夕方の通知（会議室の予約の、前日の夕方・当日の朝の通知も）と、毎日の自動バックアップを動かします。登録していないと、どちらも動きません。動いているかは、設定「利用状況」で確認できます。</p>

    <h2>6. 困ったとき</h2>
    <table>
      <tr><th>症状</th><th>確認すること</th></tr>
      <tr><td>画面が開かない／真っ白</td><td>サーバーパネルでサーバー・PHP の状態を確認。更新直後なら、開発側に連絡して、前の版に戻してもらいます。エラーの記録は、サーバーパネルのエラーログに出ます。</td></tr>
      <tr><td>ログインできない</td><td>https で開いているか／メール・パスワードの入力／ロック（15分待つ）／パスワードのリセット（上の2）。</td></tr>
      <tr><td>Slack に通知が来ない</td><td>設定「Slack通知の送り先・テスト」でテスト送信。cron（notify）が動いているか、「利用状況」で確認。通知の時間は「Slack通知の時間・文面」。</td></tr>
      <tr><td>画像が貼れない</td><td>1枚 6MB まで、1コメント3枚・1ToDo 30枚まで。<code>data/attachments/</code> に書き込めるか、容量が足りているかを確認（「利用状況」）。</td></tr>
      <tr><td>自動バックアップが失敗する</td><td>「利用状況」にエラー内容が出ます。多くは、<code>data/backups/</code> に書き込めない／容量不足です。</td></tr>
      <tr><td>予定が重複・消えた</td><td>設定「変更履歴」で、誰がいつ何を変えたかを確認。削除した予定は、バックアップから戻せます。</td></tr>
    </table>

    <h2>7. 見える範囲（個人情報の扱い）</h2>
    <ul>
      <li><b>プライベートの予定・ToDo:</b> 本人だけ。管理者にも見えません（家族に共有を選んだものだけ、家族用リンクに出ます）。</li>
      <li><b>管理者に見えるもの:</b> 全員の業務の予定・休み・業務のToDo、変更履歴（プライベートの内容は記録されない）、利用状況（最後に使った日時などの数字）。</li>
      <li><b>バックアップには、プライベートの内容も含まれます。</b>ダウンロードしたファイルとパスワードは、管理者だけで厳重に保管してください。</li>
      <li>詳しくは <code>docs/共有される情報.md</code> を参照。</li>
    </ul>

    <h2>8. 安全のために</h2>
    <ul>
      <li>初期設定のあと、<code>install.php</code> をサーバーから削除する。<?= is_file(usage_public_dir() . '/install.php') ? '<b>（いま、まだ残っています）</b>' : '（削除済み）' ?></li>
      <li>https のアドレスだけを使う。ルートの <code>.htaccess</code>（外から見せない設定）を消さない。</li>
      <li>管理者は、必要な人だけに。退職した人は、すぐ「停止」にする。</li>
      <li>更新ファイルは、受け取り元が確かなものだけを適用する（zip に署名はありません）。</li>
    </ul>

    <h2>9. 控え（引き継ぎ用に、手書きで記入）</h2>
    <table class="memo">
      <tr><th style="width:11em">サーバー契約者</th><td></td></tr>
      <tr><th>サーバーパネルのURL・ID</th><td></td></tr>
      <tr><th>管理者（メール）</th><td></td></tr>
      <tr><th>バックアップの保管場所</th><td></td></tr>
      <tr><th>バックアップパスワードの保管場所</th><td></td></tr>
      <tr><th>Slack の管理者</th><td></td></tr>
    </table>
    <p class="sub">アプリ本体の場所: <code><?= h($app) ?></code></p>
  </div>
</div>
<script nonce="<?= csp_nonce() ?>">document.getElementById('print-btn').addEventListener('click', function () { window.print(); });</script>
</body>
</html>
