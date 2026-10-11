<?php
// サーバーのコマンドから、暗号化したバックアップを復元する（画面が開けないときなど）。
//
//   php bin/restore_backup.php バックアップのファイル            パスワードは、あとで聞かれる（入力は画面に出ない）
//   BACKUP_PASSWORD=パスワード php bin/restore_backup.php ファイル  環境変数で渡す
//
// いまのデータは、すべてバックアップの内容に置き換わる（途中で失敗したときは元のまま）。コマンド（CLI）からだけ実行できる。

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('forbidden');
}
require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/audit.php';
require_once __DIR__ . '/../src/backup.php';

$file = (string)($argv[1] ?? '');
if ($file === '' || !is_file($file)) {
    fwrite(STDERR, "使い方: php bin/restore_backup.php バックアップのファイル\n");
    exit(1);
}
$pass = (string)(getenv('BACKUP_PASSWORD') ?: '');
if ($pass === '') {
    fwrite(STDOUT, 'バックアップ用のパスワード: ');
    if (function_exists('shell_exec') && DIRECTORY_SEPARATOR === '/') {
        @shell_exec('stty -echo 2>/dev/null');
    }
    $pass = rtrim((string)fgets(STDIN), "\r\n");
    if (function_exists('shell_exec') && DIRECTORY_SEPARATOR === '/') {
        @shell_exec('stty echo 2>/dev/null');
    }
    fwrite(STDOUT, "\n");
}
try {
    $d = backup_inspect(backup_decrypt((string)file_get_contents($file), $pass));
    fwrite(STDOUT, 'バックアップの作成日時: ' . ($d['created_at'] ?? '不明') . "\nいまのデータを、すべて置き換えます。続けるには「復元する」と入力: ");
    if (trim((string)fgets(STDIN)) !== '復元する') {
        fwrite(STDERR, "中止しました。\n");
        exit(1);
    }
    $n = backup_restore_data($d);
    audit_log('security', 'restore', 'バックアップから復元（コマンド）', '', ((string)($d['created_at'] ?? '')) . ' 作成のバックアップ（' . array_sum($n) . '件）');
    fwrite(STDOUT, "復元しました。\n");
    foreach ($n as $t => $c) {
        fwrite(STDOUT, "  $t: $c\n");
    }
} catch (BackupException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
