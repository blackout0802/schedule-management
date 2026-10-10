<?php
// 共有リンクの閲覧ページ（ログイン不要・閲覧専用）。
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/share.php';

header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer'); // リンクの文字列を、他のサイトへ漏らさない
header('Cache-Control: no-store');

$token = (string)($_GET['t'] ?? '');
$link = share_link_find($token);
if (!$link) {
    usleep(300000);
    http_response_code(404);
    ?><!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>無効なリンク</title><link rel="stylesheet" href="assets/app.css"></head>
    <body class="login-page"><main class="login-card"><h1>このリンクは無効です</h1><p class="muted">リンクが停止されたか、URLが正しくありません。共有してくれた方に確認してください。</p></main></body></html><?php
    exit;
}
$v = @filemtime(__DIR__ . '/assets/app.js') ?: 1;
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title><?= h(share_title($link)) ?></title>
<link rel="stylesheet" href="assets/app.css?v=<?= $v ?>">
<script nonce="<?= csp_nonce() ?>">try{var t=JSON.parse(localStorage.getItem('sched.theme'));if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
</head>
<body>
<div id="app" data-csrf=""><p class="muted" style="padding:24px">読み込み中…</p></div>
<script nonce="<?= csp_nonce() ?>">window.SCHEDULE_POLL_MS = <?= (int)poll_ms() ?>; window.SCHEDULE_BUILD = <?= json_encode(app_build()) ?>;</script>
<script nonce="<?= csp_nonce() ?>">window.SCHEDULE_SHARE = { token: <?= json_encode($token) ?>, kind: <?= json_encode($link['kind']) ?> };</script>
<script src="assets/app.js?v=<?= $v ?>"></script>
</body>
</html>
