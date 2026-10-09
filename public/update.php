<?php
// システム更新（管理者のみ）。更新用の zip を選ぶだけで、アプリのファイルを差し替えます。
// 更新前のファイルは自動でバックアップされ、このページから元に戻せます。
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';
require_once SCHEDULE_APP_DIR . '/src/updater.php';

$user = current_user();
if (!$user) {
    header('Location: login.php');
    exit;
}
if (!is_admin($user)) {
    http_response_code(403);
    exit('このページは管理者だけが使えます。');
}
$csrf = csrf_token();
$msg = '';
$err = '';
$result = null;
$appDir = SCHEDULE_APP_DIR;
$publicDir = __DIR__;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $me = row('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
    if (!csrf_valid($_POST['csrf'] ?? null)) {
        $err = '画面の有効期限が切れました。ページを再読み込みして、もう一度お試しください。';
    } elseif (!password_verify((string)($_POST['password'] ?? ''), $me['password_hash'])) {
        // ファイルを書き換える操作なので、毎回パスワードを確認する
        usleep(700000);
        $err = 'パスワードが違います。管理者ご自身のログインパスワードを入力してください。';
    } else {
        try {
            if (($_POST['action'] ?? '') === 'upload') {
                $f = $_FILES['zip'] ?? null;
                if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
                    $codes = [UPLOAD_ERR_INI_SIZE => 'ファイルが大きすぎます。', UPLOAD_ERR_FORM_SIZE => 'ファイルが大きすぎます。', UPLOAD_ERR_NO_FILE => 'zip ファイルを選んでください。'];
                    throw new UpdaterException($codes[$f['error'] ?? UPLOAD_ERR_NO_FILE] ?? 'アップロードに失敗しました。');
                }
                $result = updater_apply($f['tmp_name'], $publicDir, $appDir);
                $msg = $result['changed'] ? count($result['changed']) . ' 個のファイルを更新しました。' : '更新するファイルはありませんでした（すべて最新です）。';
            } elseif (($_POST['action'] ?? '') === 'restore') {
                $n = updater_restore((string)($_POST['backup'] ?? ''), $publicDir, $appDir);
                $msg = 'バックアップ（' . h($_POST['backup']) . '）の状態に戻しました（' . $n . ' 個のファイル）。';
            }
        } catch (UpdaterException $e) {
            $err = $e->getMessage();
        } catch (Throwable $e) {
            error_log('[schedule update] ' . $e->getMessage());
            $err = '更新中にエラーが起きました。（' . $e->getMessage() . '）';
        }
    }
}
$backups = updater_backups($appDir);
$hasZip = class_exists('ZipArchive');
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>システム更新｜<?= h(cfg('app_name')) ?></title>
<link rel="stylesheet" href="assets/app.css">
<style>.upd{max-width:720px;margin:32px auto;padding:0 16px;display:grid;gap:16px}.upd .card{background:var(--surface)}.upd ul{margin:6px 0;padding-left:1.3em}.upd code{font-size:.9em}</style>
</head>
<body>
<main class="upd">
  <h1 style="margin:0;font-size:22px">システム更新</h1>
  <p class="muted" style="margin:0">現在のバージョン: <b><?= h(APP_VERSION) ?></b>　<a href="index.php">← 予定の画面へ戻る</a></p>

  <?php if ($err): ?><p class="error" role="alert"><?= h($err) ?></p><?php endif; ?>
  <?php if ($msg): ?><p class="notice" role="status"><?= $msg ?></p><?php endif; ?>
  <?php if ($result && $result['changed']): ?>
    <div class="card">
      <b>更新したファイル</b>
      <ul><?php foreach ($result['changed'] as $c): ?><li><code><?= h($c) ?></code></li><?php endforeach; ?></ul>
      <p class="hint">変更なし: <?= (int)$result['unchanged'] ?> 個／対象外として飛ばしたもの: <?= (int)$result['skipped'] ?> 個</p>
      <p><a class="btn primary" href="index.php">画面を開き直す</a>　<span class="hint">表示が古いままのときは、Ctrl + F5 で強制再読み込みしてください。</span></p>
    </div>
  <?php endif; ?>

  <section class="card">
    <h2 style="margin:0;font-size:17px">更新する</h2>
    <?php if (!$hasZip): ?>
      <p class="error">このサーバーでは zip を扱えません（PHPのZip拡張がありません）。更新ファイルは FTP で直接アップロードしてください。</p>
    <?php else: ?>
    <p class="hint">渡された更新用の zip（<code>update-….zip</code>）を選んでください。GitHub の「Download ZIP」で取得した zip もそのまま使えます。<code>config.php</code>（データベースの設定）などは、上書きされません。</p>
    <form method="post" enctype="multipart/form-data" class="form">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="upload">
      <label>更新用の zip<input type="file" name="zip" accept=".zip,application/zip" required></label>
      <label>あなた（管理者）のパスワード<input type="password" name="password" required autocomplete="current-password"></label>
      <div class="actions"><button class="btn primary" type="submit">更新する</button></div>
    </form>
    <?php endif; ?>
  </section>

  <section class="card">
    <h2 style="margin:0;font-size:17px">元に戻す</h2>
    <?php if (!$backups): ?>
      <p class="hint">まだバックアップはありません。更新するたびに、更新前のファイルが自動で保存されます（新しい <?= (int)UPDATER_KEEP_BACKUPS ?> 件まで）。</p>
    <?php else: ?>
      <p class="hint">更新後におかしくなったときは、更新前の状態に戻せます。</p>
      <form method="post" class="form">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="restore">
        <label>戻す時点
          <select name="backup">
            <?php foreach ($backups as $b): ?>
              <option value="<?= h($b) ?>"><?= h(preg_replace('/^update-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/', '$1/$2/$3 $4:$5:$6 の更新の直前', $b)) ?></option>
            <?php endforeach; ?>
          </select>
        </label>
        <label>あなた（管理者）のパスワード<input type="password" name="password" required autocomplete="current-password"></label>
        <div class="actions"><button class="btn danger" type="submit">この時点に戻す</button></div>
      </form>
    <?php endif; ?>
  </section>
</main>
</body>
</html>
