<?php
// カレンダー購読（ICS）の配信。ログイン不要（URLの長いランダム文字列が、鍵）。読み取り専用。
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/ical.php';

header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');

$link = ical_link_find((string)($_GET['t'] ?? ''));
if (!$link) {
    usleep(300000);
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('このURLは無効です（停止されたか、URLが正しくありません）。');
}
$body = ical_render($link);
header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: inline; filename="schedule.ics"');
header('Cache-Control: private, max-age=300');
header('Content-Length: ' . strlen($body));
echo $body;
