<?php
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/api.php';
try {
    handle_api();
} catch (Throwable $e) {
    error_log('[schedule] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    api_fail('サーバーでエラーが起きました。時間をおいてもう一度お試しください。', 500);
}
