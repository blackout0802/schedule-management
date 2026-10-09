<?php
// 共有リンク用の、閲覧専用API。ログイン不要。GET だけを受け付け、何も書き換えない。
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/events.php';
require_once SCHEDULE_APP_DIR . '/src/share.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');

function share_out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        share_out(['error' => '閲覧専用です。'], 405);
    }
    $link = share_link_find((string)($_GET['t'] ?? ''));
    if (!$link) {
        usleep(300000);
        share_out(['error' => 'このリンクは無効です。'], 404);
    }
    $action = (string)($_GET['action'] ?? '');
    if ($action === 'rev') {
        share_out(['rev' => data_rev()]);
    }
    if ($action === 'meta') {
        share_out(['kind' => $link['kind'], 'title' => share_title($link), 'app_name' => cfg('app_name')]);
    }
    if ($action === 'events') {
        $from = (string)($_GET['from'] ?? '');
        $to = (string)($_GET['to'] ?? '');
        if (!valid_date($from) || !valid_date($to) || $to < $from || strtotime($to) - strtotime($from) > 100 * 86400) {
            share_out(['error' => '期間が正しくありません。'], 400);
        }
        $rev = data_rev();
        share_out(['events' => share_events($link, $from, $to), 'holidays' => share_holidays($from, $to), 'rev' => $rev]);
    }
    share_out(['error' => '不明な操作です。'], 404);
} catch (Throwable $e) {
    error_log('[schedule share] ' . $e->getMessage());
    share_out(['error' => 'サーバーでエラーが起きました。'], 500);
}
