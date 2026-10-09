<?php
// 初回だけ使う設定ページ。テーブルを作り、最初の管理者を登録します。
// 登録が終わったら、このファイル（install.php）をサーバーから削除してください。
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';

$msg = '';
$done = false;
$err = '';
try {
    run_schema();
    $count = (int)(row('SELECT COUNT(*) AS c FROM users')['c']);
} catch (Throwable $e) {
    $err = 'データベースに接続できません。config.php の db の設定を確認してください。（' . $e->getMessage() . '）';
    $count = -1;
}
if ($count === 0 && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim((string)($_POST['name'] ?? ''));
    $email = trim((string)($_POST['email'] ?? ''));
    $pw = (string)($_POST['password'] ?? '');
    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($pw) < 8) {
        $err = '名前・メールアドレス・8文字以上のパスワードを入力してください。';
    } else {
        create_user($name, $email, $pw, 'admin');
        $done = true;
        $count = 1;
    }
}
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>初期設定｜<?= h(cfg('app_name')) ?></title>
<link rel="stylesheet" href="assets/app.css">
</head>
<body class="login-page">
<main class="login-card">
  <h1>初期設定</h1>
  <?php if ($err): ?><p class="error" role="alert"><?= h($err) ?></p><?php endif; ?>
  <?php if ($done): ?>
    <p>管理者を登録しました。</p>
    <p class="error">この install.php をサーバーから削除してください。</p>
    <p><a class="btn primary" href="login.php">ログイン画面へ</a></p>
  <?php elseif ($count > 0): ?>
    <p>すでに初期設定は完了しています。この install.php をサーバーから削除してください。</p>
    <p><a href="login.php">ログイン画面へ</a></p>
  <?php elseif ($count === 0): ?>
    <p class="muted">データベースの準備ができました。最初の管理者を登録します。</p>
    <form method="post">
      <label>名前<input name="name" required></label>
      <label>メールアドレス<input type="email" name="email" required></label>
      <label>パスワード（8文字以上）<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn primary" type="submit">管理者を登録する</button>
    </form>
  <?php endif; ?>
</main>
</body>
</html>
