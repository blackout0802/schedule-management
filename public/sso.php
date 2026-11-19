<?php
// ポータルから自動で入る受け取り口（src/sso.php。決まりはポータルの docs/DESIGN.md の 6）。
//   GET : 合言葉 state を作ってセッションに覚え、ポータルへ移る
//   POST: ポータルのチケット（ticket）を確かめてログインし、画面（index.php）へ移る。入れなければ、ログインの画面に理由を出す
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';
require_once SCHEDULE_APP_DIR . '/src/sso.php';

header('Cache-Control: no-store');
try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $why = sso_receive((string)($_POST['ticket'] ?? ''));
        header('Location: ' . ($why === '' ? 'index.php' : 'login.php?sso=' . rawurlencode($why)), true, 303);
        exit;
    }
    if (!sso_on() || current_user()) { // 使わない設定のとき・ログイン済みのときは、いつもの画面へ（ポータルの一覧のリンクからも来る）
        header('Location: index.php', true, 303);
        exit;
    }
    header('Location: ' . sso_start(), true, 303);
} catch (Throwable $e) {
    error_log('[schedule] sso: ' . get_class($e));
    header('Location: login.php?sso=error', true, 303);
}
