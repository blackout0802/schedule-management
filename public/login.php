<?php
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';

if (current_user()) {
    header('Location: index.php');
    exit;
}
$error = '';
$email = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    session_boot();
    $email = (string)($_POST['email'] ?? '');
    if (!csrf_valid($_POST['csrf'] ?? null)) {
        $error = '画面の有効期限が切れました。もう一度お試しください。';
    } elseif (login_attempt($email, (string)($_POST['password'] ?? ''), $locked)) {
        header('Location: index.php');
        exit;
    } else {
        $error = $locked ? 'ログインの失敗が続いたため、15分ほど待ってからもう一度お試しください。' : 'メールアドレスまたはパスワードが違います。';
    }
}
$csrf = csrf_token();
$app = cfg('app_name');
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ログイン｜<?= h($app) ?></title>
<link rel="stylesheet" href="assets/app.css">
</head>
<body class="login-page">
<main class="login-card">
  <h1><?= h($app) ?></h1>
  <p class="muted">会社から案内されたメールアドレスでログインしてください。</p>
  <?php if ($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php endif; ?>
  <form method="post" autocomplete="on">
    <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
    <label>メールアドレス
      <input type="email" name="email" value="<?= h($email) ?>" required autofocus autocomplete="username">
    </label>
    <label>パスワード
      <input type="password" name="password" required autocomplete="current-password">
    </label>
    <button type="submit" class="btn primary">ログイン</button>
  </form>
</main>
</body>
</html>
