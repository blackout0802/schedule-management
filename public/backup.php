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
audit_set_actor($user);
$csrf = csrf_token();
$err = '';
$msg = '';
$restored = null;
$available = backup_available();

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
                header('Content-Type: application/octet-stream');
                header('Content-Disposition: attachment; filename="' . $b['name'] . '"');
                header('Content-Length: ' . strlen($b['blob']));
                header('Cache-Control: no-store');
                echo $b['blob'];
                exit;
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
            }
        } catch (BackupException $e) {
            $err = $e->getMessage();
        } catch (Throwable $e) {
            error_log('[schedule backup] ' . $e->getMessage());
            $err = 'エラーが起きました。（' . $e->getMessage() . '）';
        }
    }
}
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
      <ul><?php foreach ($restored as $t => $n): if (isset($names[$t])): ?><li><?= h($names[$t]) ?>: <?= (int)$n ?>件</li><?php endif; endforeach; ?></ul>
      <p style="margin:6px 0 0">データを入れ替えたので、いちど<a href="login.php">ログインし直して</a>ください。</p>
    </div>
  <?php endif; ?>
  <?php if (!$available): ?><p class="error">このサーバーでは、暗号化（OpenSSL の AES-256-GCM）が使えないため、バックアップを作れません。</p><?php endif; ?>

  <section class="card">
    <h2 style="margin:0;font-size:17px">バックアップを作る（ダウンロード）</h2>
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
