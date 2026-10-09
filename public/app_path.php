<?php
// アプリ本体（src フォルダなど）の場所を指定します。
//
// ・プロジェクト一式をそのままアップロードした場合（public が src と同じ階層にある）→ 何も変更しなくて大丈夫です。
// ・public フォルダの中身だけを公開フォルダ(public_html)へ置き、src などを公開フォルダの外に置いた場合
//   → 下の2行目の '/home/ユーザー名/schedule_app' を、実際の場所に書き換えてください。
define('SCHEDULE_APP_DIR', is_dir(__DIR__ . '/../src') ? realpath(__DIR__ . '/..') : '/home/ユーザー名/schedule_app');
