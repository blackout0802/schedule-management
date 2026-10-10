<?php
// 管理者がパスワードを忘れたときなど、画面からリセットできない場合に、サーバーのコマンドで一時パスワードを設定する。
//
//   php bin/reset_password.php メールアドレス            一時パスワードを作って表示する
//   php bin/reset_password.php メールアドレス 新しいパスワード   指定したパスワード（8文字以上）にする
//
// 設定したあと、本人が次にログインしたときに、パスワードの変更を求められる。ログインの失敗によるロックも解除する。
// コマンド（CLI）からだけ実行できる（Web からは動かない）。

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('forbidden');
}
require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/auth.php';

$email = strtolower(trim((string)($argv[1] ?? '')));
if ($email === '') {
    fwrite(STDERR, "使い方: php bin/reset_password.php メールアドレス [新しいパスワード]\n");
    exit(1);
}
ensure_schema();
$u = row('SELECT id, name FROM users WHERE email = ?', [$email]);
if (!$u) {
    fwrite(STDERR, "そのメールアドレスの社員が見つかりません。\n");
    exit(1);
}
try {
    $pw = reset_user_password((int)$u['id'], isset($argv[2]) ? (string)$argv[2] : null);
} catch (RuntimeException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
echo "{$u['name']} さんのパスワードをリセットしました。\n一時パスワード: {$pw}\n（次にログインしたとき、パスワードの変更を求められます）\n";
