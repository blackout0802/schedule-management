<?php
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';
require_once SCHEDULE_APP_DIR . '/src/sso.php';

if (current_user()) {
    header('Location: index.php');
    exit;
}
// ポータルから自動で入る: ログインしていなければ、受け取り口（sso.php）からポータルへ行き、チケットを持って戻る。
// 戻ってきても入れなかったとき（?sso=理由）・ログアウトしたとき（?sso=out）・1分以内に行ったばかりのときは、行かずにこの画面を出す
$ssoWhy = (string)($_GET['sso'] ?? '');
if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $ssoWhy === '' && sso_on()) {
    session_boot();
    if (time() - (int)($_SESSION['sso_tried'] ?? 0) > 60) {
        $_SESSION['sso_tried'] = time();
        header('Location: sso.php');
        exit;
    }
}
$ssoMsg = [
    'nouser' => 'ポータルのメールアドレスが、このアプリに登録されていません。管理者に確かめるか、下からログインしてください。',
    'expired' => 'ポータルから入るのに時間がかかりすぎました。下からログインするか、ポータルからもう一度開いてください。',
    'invalid' => 'ポータルから正しく入れませんでした。下からログインしてください。',
    'off' => 'ポータルから入る仕組みが、このアプリで使えません。下からログインしてください。',
    'error' => 'ポータルから入る途中で、問題が起きました。下からログインしてください。',
][$ssoWhy] ?? '';
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
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="robots" content="noindex">
<title>ログイン｜<?= h($app) ?></title>
<link rel="stylesheet" href="assets/app.css">
<meta name="theme-color" content="#2155d6">
<link rel="manifest" href="manifest.php">
<link rel="icon" type="image/png" href="assets/icons/icon-192.png">
<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="<?= h(mb_substr($app, 0, 12)) ?>">
<script nonce="<?= csp_nonce() ?>">try{var t=JSON.parse(localStorage.getItem('sched.theme'));if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
</head>
<body class="login-page">
<main class="login-card">
  <h1><?= h($app) ?></h1>
  <p class="muted">会社から案内されたメールアドレスでログインしてください。</p>
  <?php if ($ssoMsg && !$error): ?><p class="error" role="alert"><?= h($ssoMsg) ?></p><?php endif; ?>
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
  <?php if (sso_on()): ?><p class="muted"><a href="sso.php">ポータルからログインする</a></p><?php endif; ?>
  <?php if (portal_url_ok()): ?><p class="muted login-portal"><a href="<?= h(sso_cfg('portal_url')) ?>" id="login-portal">← ポータルへ戻る</a></p><?php endif; ?>
</main>
</body>
</html>
