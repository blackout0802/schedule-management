<?php
// サーバーの cron から毎日実行するスクリプト。
//
//   php bin/cron.php nightly   繰り返し業務を12か月先まで作る（深夜 0:30 ごろ）
//   php bin/cron.php morning   今日の休みを Slack へ通知（平日の朝 8:30 ごろ）
//   php bin/cron.php evening   明日の休みを Slack へ通知（平日の夕方 17:00 ごろ）
//
// cron が使えない場合は、config.php に cron_token を設定し、
//   https://…/bin/cron.php?mode=nightly&token=合言葉
// のように Web から呼ぶこともできます（bin フォルダを公開している場合のみ）。

require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/events.php';
require_once __DIR__ . '/../src/slack.php';

$isCli = PHP_SAPI === 'cli';
if (!$isCli) {
    $token = (string)cfg('cron_token', '');
    if ($token === '' || !hash_equals($token, (string)($_GET['token'] ?? ''))) {
        http_response_code(403);
        exit('forbidden');
    }
    header('Content-Type: text/plain; charset=utf-8');
}
$mode = $isCli ? ($argv[1] ?? 'nightly') : (string)($_GET['mode'] ?? 'nightly');
ensure_schema();
$cal = BizCalendar::fromDb();
$today = date('Y-m-d');
$tomorrow = date('Y-m-d', strtotime('+1 day'));

try {
    switch ($mode) {
        case 'nightly':
            echo '繰り返し予定: ' . materialize_all() . " 件を更新しました\n";
            break;
        case 'morning':
            materialize_all();
            if (!$cal->isBusinessDay($today)) {
                echo "営業日ではないため通知しません\n";
                break;
            }
            echo '本日の休み: ' . notify_offs_for_day($today, '本日') . " 件\n";
            break;
        case 'evening':
            if (!$cal->isBusinessDay($tomorrow)) {
                echo "明日は営業日ではないため通知しません\n";
                break;
            }
            echo '明日の休み: ' . notify_offs_for_day($tomorrow, '明日') . " 件\n";
            break;
        default:
            fwrite(STDERR, "mode は nightly / morning / evening のいずれかです\n");
            exit(1);
    }
} catch (Throwable $e) {
    error_log('[schedule cron] ' . $e->getMessage());
    echo 'エラー: ' . $e->getMessage() . "\n";
    exit(1);
}
