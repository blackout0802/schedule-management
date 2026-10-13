<?php
// テスト用のデータベースを作り直す: 表と、3人の社員（管理者・山田・鈴木）。
require getenv('E2E_APP') . '/src/bootstrap.php';
require getenv('E2E_APP') . '/src/auth.php';
$pdo = db();
if (strpos(cfg('db')['dsn'], 'sqlite') !== 0) { // MySQL / MariaDB: 既存の表を消してから
    foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_NUM) as $t) { $pdo->exec('DROP TABLE `' . $t[0] . '`'); }
}
run_schema();
create_user('管理者 太郎', 'admin@example.com', 'adminpass1', 'admin');
create_user('山田 花子', 'yamada@example.com', 'yamadapass1');
create_user('鈴木 一郎', 'suzuki@example.com', 'suzukipass1');
