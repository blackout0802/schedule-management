<?php
// アプリ本体（src フォルダなど）の場所を探します。次の順に見つかった場所を使います。
//
//  1. このフォルダの1つ上（プロジェクト一式をそのまま置いた場合）
//  2. このフォルダの2つ上にある schedule_app フォルダ
//     （例: …/public_html/サイト名/ に画面を置き、…/schedule_app/ に本体を置いた場合。公開フォルダの外なので安全）
//  3. 下の絶対パス（上の2つに当てはまらない配置のときだけ、実際の場所に書き換える）
$candidates = [
    __DIR__ . '/..',
    __DIR__ . '/../../schedule_app',
    '/home/ユーザー名/schedule_app',
];
foreach ($candidates as $c) {
    if (is_file($c . '/src/bootstrap.php')) {
        define('SCHEDULE_APP_DIR', realpath($c));
        return;
    }
}
http_response_code(500);
exit('アプリ本体（schedule_app フォルダ）が見つかりません。app_path.php の説明を確認してください。');
