<?php
// Slack の代わりのサーバー: 送られてきた内容を、E2E_SLACK_LOG に1行ずつ書く
file_put_contents(getenv('E2E_SLACK_LOG') ?: (__DIR__ . '/received.log'), file_get_contents('php://input') . "\n", FILE_APPEND);
echo 'ok';
