<?php
// このファイルを config.php という名前でコピーして、値を書き換えてください。
// config.php は秘密の情報を含むため、Git には含めません。
return [
    // データベース（スターレンタルサーバーのサーバーパネルで作成した情報）
    'db' => [
        'dsn'  => 'mysql:host=localhost;dbname=データベース名;charset=utf8mb4',
        'user' => 'データベースのユーザー名',
        'pass' => 'データベースのパスワード',
    ],
    // 手元で試すだけなら SQLite も使えます（その場合は上の db をコメントアウト）
    // 'db' => ['dsn' => 'sqlite:' . __DIR__ . '/data/app.sqlite'],

    'app_name' => 'スケジュール管理',
    'timezone' => 'Asia/Tokyo',

    // Slack の Incoming Webhook URL（空のままなら通知しません）
    'slack_webhook' => '',
    // Slack通知に付けるアプリのURL（例: https://example.com/schedule/public/）
    'base_url' => '',

    // 他の人の更新を画面に自動で反映する間隔（秒）。5〜600。0 にすると自動更新しない
    'poll_seconds' => 20,

    // cron から CLI で実行できない場合の予備（Web経由で bin/cron.php を呼ぶ時の合言葉）。使わなければ空のまま
    'cron_token' => '',

    // 予定のタグ（プライベート版で「表示する業務」を選ぶ単位）
    'work_tags' => ['全体会議', '打ち合わせ', '定例業務', '個人作業', 'その他'],
    'off_tags'  => ['有給', '調整休', '午前半休', '午後半休'],
];
