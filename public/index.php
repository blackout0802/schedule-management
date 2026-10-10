<?php
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';

if (!current_user()) {
    header('Location: login.php');
    exit;
}
$app = cfg('app_name');
$v = @filemtime(__DIR__ . '/assets/app.js') ?: 1; // 更新時にブラウザのキャッシュを避ける
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?= h($app) ?></title>
<link rel="stylesheet" href="assets/app.css?v=<?= $v ?>">
</head>
<body>
<script nonce="<?= csp_nonce() ?>">window.SCHEDULE_POLL_MS = <?= (int)poll_ms() ?>; window.SCHEDULE_BUILD = <?= json_encode(app_build()) ?>;</script>
<div id="app" data-csrf="<?= h(csrf_token()) ?>"><p class="muted" style="padding:24px">読み込み中…</p></div>
<script src="assets/app.js?v=<?= $v ?>"></script>
</body>
</html>
