<?php
// ホーム画面に追加（アプリとして開く）ための設定。ログインしていなくても読める（中身は、アプリの名前とアイコンだけ）。
//   manifest.php        … ログインして使う画面（index.php）用
//   manifest.php?t=…    … 共有リンク（家族用・会社用）用。ホーム画面から、その共有ページが開く
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/share.php';

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Robots-Tag: noindex, nofollow');

$app = (string)cfg('app_name', 'スケジュール管理');
$name = $app;
$start = 'index.php';
$token = (string)($_GET['t'] ?? '');
if ($token !== '') {
    try {
        $link = share_link_find($token);
    } catch (Throwable $e) {
        $link = null;
    }
    if (!$link) {
        http_response_code(404);
        echo json_encode(['name' => $app]);
        exit;
    }
    $name = share_title($link);
    $start = 'share.php?t=' . $token;
}
$short = mb_substr($token !== '' ? ($link['kind'] === 'family' ? '予定（家族用）' : '業務カレンダー') : $app, 0, 12);
echo json_encode([
    'name' => $name,
    'short_name' => $short,
    'id' => $start,
    'start_url' => $start,
    'scope' => './',
    'display' => 'standalone',
    'orientation' => 'any',
    'lang' => 'ja',
    'background_color' => '#f3f6fa',
    'theme_color' => '#2155d6',
    'icons' => [
        ['src' => 'assets/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => 'assets/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => 'assets/icons/icon-maskable-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
