<?php
// 使い方: php sql.php "SQL"（テスト用のデータベースへ。SCHEDULE_CONFIG と E2E_APP は run.sh が設定する）
require getenv('E2E_APP') . '/src/bootstrap.php';
foreach (array_filter(array_map('trim', explode(';', (string)($argv[1] ?? '')))) as $stmt) {
    $st = db()->query($stmt);
    if ($st && $st->columnCount() > 0) {
        foreach ($st->fetchAll(PDO::FETCH_NUM) as $r) {
            echo implode("\t", array_map(function ($v) { return (string)$v; }, $r)), "\n";
        }
    }
}
