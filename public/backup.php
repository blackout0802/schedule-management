<?php
// バックアップ（管理者のみ）: パスワードで暗号化したバックアップを、ダウンロードする／アップロードして復元する。
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';
require_once SCHEDULE_APP_DIR . '/src/audit.php';
require_once SCHEDULE_APP_DIR . '/src/backup.php';

$user = current_user();
if (!$user) {
    header('Location: login.php');
    exit;
}
if (!is_admin($user)) {
    http_response_code(403);
    exit('このページは管理者だけが使えます。');
}
if ((int)$user['must_change_password'] === 1) { // 一時パスワードのままでは、使えない（先にパスワードを変更する）
    header('Location: index.php');
    exit;
}
audit_set_actor($user);
$csrf = csrf_token();
$err = '';
$msg = '';
$restored = null;
$available = backup_available();
$flash = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_valid($_POST['csrf'] ?? null)) {
        $err = '画面の有効期限が切れました。ページを再読み込みして、もう一度お試しください。';
    } else {
        try {
            $act = (string)($_POST['action'] ?? '');
            if ($act === 'download') {
                $p1 = (string)($_POST['pass'] ?? '');
                if ($p1 !== (string)($_POST['pass2'] ?? '')) {
                    throw new BackupException('パスワードが、2回で一致しません。');
                }
                backup_check_pass($p1);
                audit_log('security', 'backup', 'バックアップをダウンロード', '', 'データを暗号化して保存'); // 先に記録する（このバックアップの中にも、この記録が入る）
                $b = backup_create($p1);
                backup_manual_mark(); // 月1回のお知らせは、ここから数え直す
                header('Content-Type: application/octet-stream');
                header('Content-Disposition: attachment; filename="' . $b['name'] . '"');
                header('Content-Length: ' . strlen($b['blob']));
                header('Cache-Control: no-store');
                echo $b['blob'];
                exit;
            } elseif ($act === 'auto_set') {
                if ((string)cfg('backup_password', '') !== '') {
                    throw new BackupException('自動バックアップのパスワードは、config.php（backup_password）で設定されています。');
                }
                $p1 = (string)($_POST['pass'] ?? '');
                if ($p1 !== (string)($_POST['pass2'] ?? '')) {
                    throw new BackupException('パスワードが、2回で一致しません。');
                }
                backup_check_pass($p1);
                backup_meta_set('backup_auto_pass', $p1);
                backup_meta_set('backup_auto_try', '');
                audit_log('security', 'update', '自動バックアップを設定', '', '毎日1回、サーバーに暗号化して保存');
                $msg = '自動バックアップを有効にしました。毎日、3時以降の最初の定期実行で作成されます。すぐに作るときは「いま作成する」を押してください。';
            } elseif ($act === 'auto_off') {
                backup_meta_set('backup_auto_pass', '');
                audit_log('security', 'update', '自動バックアップを停止', '', '保存済みのファイルは残ります');
                $msg = '自動バックアップを止めました（保存済みのファイルは、そのまま残ります）。';
            } elseif ($act === 'auto_run') {
                $name = backup_auto_run();
                $msg = '自動バックアップを作成しました（' . h($name) . '）。';
            } elseif ($act === 'auto_download') {
                $path = backup_auto_file_path((string)($_POST['name'] ?? ''));
                if (!$path) {
                    throw new BackupException('そのファイルは見つかりません。');
                }
                audit_log('security', 'backup', '保存済みの自動バックアップをダウンロード', '', basename($path));
                header('Content-Type: application/octet-stream');
                header('Content-Disposition: attachment; filename="' . basename($path) . '"');
                header('Content-Length: ' . filesize($path));
                header('Cache-Control: no-store');
                readfile($path);
                exit;
            } elseif ($act === 'alert_set') {
                backup_meta_set('backup_alert_slack', !empty($_POST['slack']) ? '1' : '');
                $msg = !empty($_POST['slack']) ? '月1回のお知らせを、Slackにも送るようにしました。' : 'お知らせは、画面の中だけにしました（Slackには送りません）。';
            } elseif ($act === 'restore') {
                $f = $_FILES['file'] ?? null;
                if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
                    throw new BackupException('バックアップのファイルを選んでください。（大きすぎる場合は、サーバーの設定の上限を超えています）');
                }
                if (trim((string)($_POST['confirm'] ?? '')) !== '復元する') {
                    throw new BackupException('確認のため、「復元する」と入力してください。');
                }
                $json = backup_decrypt((string)file_get_contents($f['tmp_name']), (string)($_POST['pass'] ?? ''));
                $d = backup_inspect($json);
                $restored = backup_restore_data($d);
                audit_log('security', 'restore', 'バックアップから復元', '', ((string)($d['created_at'] ?? '')) . ' 作成のバックアップ（' . array_sum($restored) . '件）');
                $msg = '復元しました。（バックアップの作成日時: ' . h((string)($d['created_at'] ?? '不明')) . '）';
                logout(); // 社員の表が入れ替わるので、いまのログインは終える（同じ番号の別の人として操作してしまわないように）
            }
        } catch (BackupException $e) {
            $err = $e->getMessage();
        } catch (Throwable $e) {
            error_log('[schedule backup] ' . $e->getMessage());
            $err = 'エラーが起きました。（' . $e->getMessage() . '）';
        }
    }
}
$auto = backup_auto_status();
$alert = backup_alert_status();
$fmtSize = function ($n) { return $n >= 1048576 ? round($n / 1048576, 1) . ' MB' : max(1, (int)round($n / 1024)) . ' KB'; };
$names = ['users' => '社員', 'events' => '予定', 'series' => '繰り返し業務', 'todos' => 'ToDo', 'memos' => 'メモ', 'share_links' => '共有リンク', 'company_holidays' => '会社の休業日', 'event_log' => '予定の変更記録', 'audit_log' => '変更履歴'];
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>バックアップ｜<?= h(cfg('app_name')) ?></title>
<script nonce="<?= csp_nonce() ?>">try{var t=localStorage.getItem('sched.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
<link rel="stylesheet" href="assets/app.css">
<style>.upd{max-width:720px;margin:32px auto;padding:0 16px;display:grid;gap:16px}.upd .card{background:var(--surface)}.upd ul{margin:6px 0;padding-left:1.3em}.upd code{font-size:.9em}</style>
</head>
<body>
<main class="upd">
  <h1 style="margin:0;font-size:24px;letter-spacing:-.02em">バックアップ</h1>
  <p class="muted" style="margin:0"><a href="index.php#settings">← 設定へ戻る</a></p>

  <?php if ($err): ?><p class="error" role="alert"><?= h($err) ?></p><?php endif; ?>
  <?php if ($msg): ?>
    <div class="notice" role="status"><?= $msg ?>
      <?php if ($restored !== null): ?>
        <ul><?php foreach ($restored as $t => $n): if (isset($names[$t])): ?><li><?= h($names[$t]) ?>: <?= (int)$n ?>件</li><?php endif; endforeach; ?></ul>
        <p style="margin:6px 0 0">データを入れ替えたので、いちど<a href="login.php">ログインし直して</a>ください。</p>
      <?php endif; ?>
    </div>
  <?php endif; ?>
  <?php if (!$available): ?><p class="error">このサーバーでは、暗号化（OpenSSL の AES-256-GCM）が使えないため、バックアップを作れません。</p><?php endif; ?>

  <section class="card" id="auto">
    <h2 style="margin:0;font-size:17px">自動バックアップ（サーバーに保存）</h2>
    <p class="hint">毎日1回、暗号化したバックアップを、サーバーの <code>data/backups/</code> に自動で保存します（新しい<?= (int)$auto['keep'] ?>個だけ残し、古いものは消えます）。Slack通知用の定期実行（<code>bin/cron.php notify</code>）の中で動くので、新しい定期実行の登録は要りません。</p>
    <p><b>状態: <?= $auto['enabled'] ? '有効' : '無効（パスワード未設定）' ?></b><?php if ($auto['last_at']): ?>　最後に作成: <?= h($auto['last_at']) ?><?php endif; ?></p>
    <?php if ($auto['last_error']): ?><p class="error" role="alert">直近の失敗: <?= h($auto['last_error']) ?></p><?php endif; ?>
    <?php if ($auto['source'] === 'config'): ?>
      <p class="hint">パスワードは、<code>config.php</code>（<code>backup_password</code>）で設定されています。</p>
    <?php else: ?>
      <form method="post" class="form" autocomplete="off">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="auto_set">
        <p class="hint">自動バックアップ用のパスワードを決めます（手動のものとは別でも、同じでも構いません）。<b>このパスワードは、サーバーのデータベースに保存されます</b>（サーバーに侵入された場合は、自動バックアップの中身も読まれます）。もっと安全にしたい場合は、<code>config.php</code> に <code>'backup_password' =&gt; '…'</code> と書く方法もあります。</p>
        <label>自動バックアップ用のパスワード（<?= (int)BACKUP_MIN_PASS ?>文字以上）<input type="password" name="pass" minlength="<?= (int)BACKUP_MIN_PASS ?>" required autocomplete="new-password"></label>
        <label>もう一度（確認）<input type="password" name="pass2" minlength="<?= (int)BACKUP_MIN_PASS ?>" required autocomplete="new-password"></label>
        <div class="actions"><button class="btn primary" type="submit"<?= $available ? '' : ' disabled' ?>><?= $auto['enabled'] ? 'パスワードを変更する' : '自動バックアップを有効にする' ?></button></div>
      </form>
      <?php if ($auto['enabled']): ?>
        <form method="post" class="form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="auto_off"><div class="actions"><button class="btn small danger" type="submit">自動バックアップを止める</button></div></form>
      <?php endif; ?>
    <?php endif; ?>
    <?php if ($auto['enabled']): ?>
      <form method="post" class="form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="auto_run"><div class="actions"><button class="btn small" type="submit">いま作成する</button></div></form>
    <?php endif; ?>
    <?php if ($auto['files']): ?>
      <table class="t"><thead><tr><th>保存済みのバックアップ</th><th>大きさ</th><th></th></tr></thead><tbody>
      <?php foreach ($auto['files'] as $f): ?>
        <tr><td><?= h($f['at']) ?></td><td><?= h($fmtSize($f['size'])) ?></td><td>
          <form method="post" style="margin:0"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="auto_download"><input type="hidden" name="name" value="<?= h($f['name']) ?>"><button class="btn small" type="submit">ダウンロード</button></form></td></tr>
      <?php endforeach; ?>
      </tbody></table>
    <?php endif; ?>
    <p class="hint">サーバーそのものが壊れると、この自動バックアップも一緒に失われます。<b>月に1回は、下の手動バックアップをダウンロードして、別の場所に保管してください。</b></p>
  </section>

  <section class="card" id="alert">
    <h2 style="margin:0;font-size:17px">月1回の手動バックアップのお知らせ</h2>
    <p>最後に手動でダウンロードしたのは: <b><?= $alert['last'] ? h($alert['last']) : 'まだありません' ?></b>（<?= (int)$alert['days'] ?>日前<?= $alert['last'] ? '' : '・この機能を使い始めてから' ?>）</p>
    <p class="hint">手動でダウンロードしてから<?= (int)BACKUP_ALERT_DAYS ?>日たつと、管理者の画面（カレンダーの上）に、お知らせが出ます（「あとで」を押すと、7日間は出ません）。</p>
    <form method="post" class="form">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="alert_set">
      <label class="check" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="slack" value="1" style="width:auto"<?= $alert['slack'] ? ' checked' : '' ?>> Slackにも送る（お知らせの時期になったら、月に1回。送り先のチャンネルの全員に見えます）</label>
      <div class="actions"><button class="btn small" type="submit">保存</button></div>
    </form>
  </section>

  <section class="card">
    <h2 style="margin:0;font-size:17px">手動バックアップ（ダウンロード）</h2>
    <p class="hint">社員・予定（<b>プライベートの予定も含む</b>）・繰り返し業務・ToDo・メモ・共有リンク・Slackの送り先・変更履歴など、データベースの中身を、<b>パスワードで暗号化した1つのファイル</b>にして保存します。パスワードを知らない人は、管理者でも中身を見られません。</p>
    <p class="hint"><b>パスワードを忘れると、復元できません。</b>パスワードは、ファイルとは別の場所に控えてください。<code>config.php</code>（データベースの接続設定）は、バックアップに含まれないので、別に控えておいてください。</p>
    <form method="post" class="form" autocomplete="off">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="download">
      <label>バックアップ用のパスワード（<?= (int)BACKUP_MIN_PASS ?>文字以上。ログインのパスワードとは別のものを）<input type="password" name="pass" minlength="<?= (int)BACKUP_MIN_PASS ?>" required autocomplete="new-password"></label>
      <label>もう一度（確認）<input type="password" name="pass2" minlength="<?= (int)BACKUP_MIN_PASS ?>" required autocomplete="new-password"></label>
      <div class="actions"><button class="btn primary" type="submit"<?= $available ? '' : ' disabled' ?>>バックアップをダウンロード</button></div>
    </form>
  </section>

  <section class="card">
    <h2 style="margin:0;font-size:17px">バックアップから復元する</h2>
    <p class="hint"><b>いまのデータは、すべてバックアップの内容に置き換わります。</b>元に戻せないので、先に今のバックアップを取っておくと安心です。途中で失敗したときは、データは元のままです。ログインの情報も入れ替わるので、復元のあとは、ログインし直してください。</p>
    <form method="post" enctype="multipart/form-data" class="form" id="restore-form" autocomplete="off">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="restore">
      <label>バックアップのファイル（schedule-backup-日時.enc）<input type="file" name="file" required></label>
      <label>バックアップ用のパスワード<input type="password" name="pass" required autocomplete="off"></label>
      <label>確認のため「復元する」と入力<input type="text" name="confirm" placeholder="復元する" required autocomplete="off"></label>
      <div class="actions"><button class="btn danger" type="submit"<?= $available ? '' : ' disabled' ?>>復元する</button></div>
    </form>
  </section>
</main>
<script nonce="<?= csp_nonce() ?>">
var rf = document.getElementById('restore-form');
if (rf) rf.addEventListener('submit', function (e) { if (!window.confirm('いまのデータを、すべてバックアップの内容に置き換えます。元に戻せません。よろしいですか？')) e.preventDefault(); });
</script>
</body>
</html>
