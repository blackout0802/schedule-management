<?php
// 管理者向けの「利用状況」。誰がいつ使ったか／容量／バックアップ／cron が動いているか／気をつけること、をまとめて返す。
//
// 見せるのは、数と日時だけ。予定・ToDo・日報の中身や、プライベートの件名は、ここには出さない。
// 「最後にログインした日時」「最後に使った日時」は、この画面のためだけに users に残す（変更履歴には残さない）。

require_once __DIR__ . '/backup.php';

const USAGE_ATTACH_WARN_BYTES = 500 * 1048576; // 画像がこれを超えたら、整理を促す
const USAGE_DISK_WARN_BYTES = 500 * 1048576;   // サーバーの空きがこれより少ないと注意
const USAGE_IDLE_DAYS = 90;                    // この日数、使っていない人は「長く使っていない」
const USAGE_CRON_NOTIFY_STALE = 3600;          // notify の cron が、この秒数 動いていなければ止まっている
const USAGE_CRON_NIGHTLY_STALE = 129600;       // nightly は、36時間

/** cron が動いた印（bin/cron.php から呼ぶ）。失敗しても本来の処理は止めない */
function usage_cron_mark(string $mode): void
{
    if (!in_array($mode, ['notify', 'nightly'], true)) {
        return;
    }
    try {
        backup_meta_set('cron_' . $mode . '_at', now_str());
    } catch (Throwable $e) {
        error_log('[schedule usage] ' . $e->getMessage());
    }
}

/** フォルダの直下のファイルの、個数と合計バイト数（. で始まる管理用ファイルは数えない） */
function usage_dir_stats(string $dir, string $glob = '*'): array
{
    $n = 0;
    $bytes = 0;
    foreach (glob($dir . '/' . $glob) ?: [] as $f) {
        if (is_file($f) && basename($f)[0] !== '.') {
            $n++;
            $bytes += (int)@filesize($f);
        }
    }
    return ['count' => $n, 'bytes' => $bytes];
}

function usage_db_info(): array
{
    $dsn = (string)cfg('db')['dsn'];
    try {
        if (strpos($dsn, 'sqlite') === 0) {
            $path = substr($dsn, strlen('sqlite:'));
            return ['type' => 'SQLite', 'version' => (string)row('SELECT sqlite_version() AS v')['v'], 'bytes' => is_file($path) ? (int)filesize($path) : null];
        }
        $r = row('SELECT SUM(data_length + index_length) AS b FROM information_schema.tables WHERE table_schema = DATABASE()');
        return ['type' => 'MySQL / MariaDB', 'version' => (string)row('SELECT VERSION() AS v')['v'], 'bytes' => $r && $r['b'] !== null ? (int)$r['b'] : null];
    } catch (Throwable $e) {
        return ['type' => '', 'version' => '', 'bytes' => null];
    }
}

/** 画面の置き場所（install.php がある場所）。Web から呼ばれたときは、そのスクリプトのフォルダ */
function usage_public_dir(): string
{
    $s = (string)($_SERVER['SCRIPT_FILENAME'] ?? '');
    if ($s !== '' && PHP_SAPI !== 'cli') {
        return dirname($s);
    }
    return dirname(__DIR__) . '/public';
}

function usage_count(string $table): int
{
    try {
        return (int)row("SELECT COUNT(*) AS c FROM $table")['c'];
    } catch (Throwable $e) {
        return 0;
    }
}

/** 秒数 → 「3日前」のような言い方の元になる、経過日数。日時が空なら null */
function usage_days_since(?string $at, ?int $now = null): ?int
{
    if ($at === null || !preg_match('/^\d{4}-\d{2}-\d{2}/', $at)) {
        return null;
    }
    $t = strtotime($at);
    return $t === false ? null : (int)floor((($now ?? time()) - $t) / 86400);
}

function usage_report(?int $now = null): array
{
    $now = $now ?? time();

    // ---- 社員 ----
    $users = array_map(function ($u) use ($now) {
        return ['id' => (int)$u['id'], 'name' => $u['name'], 'role' => $u['role'], 'active' => (int)$u['active'],
            'must_change' => (int)$u['must_change_password'], 'last_login' => $u['last_login_at'] ?: null, 'last_seen' => $u['last_seen_at'] ?: null,
            'idle_days' => usage_days_since($u['last_seen_at'] ?: ($u['last_login_at'] ?: null), $now)];
    }, rows("SELECT id,name,role,active,must_change_password,last_login_at,last_seen_at FROM users WHERE role <> 'family' ORDER BY active DESC, id"));

    // ---- 容量 ----
    $adir = attach_dir();
    $att = ['count' => 0, 'bytes' => 0, 'by_user' => []];
    try {
        $r = row('SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS b FROM todo_comment_files');
        $att['count'] = (int)$r['c'];
        $att['bytes'] = (int)$r['b'];
        $att['by_user'] = array_map(function ($x) {
            return ['name' => $x['name'], 'count' => (int)$x['c'], 'bytes' => (int)$x['b']];
        }, rows('SELECT u.name AS name, COUNT(*) AS c, SUM(f.size) AS b FROM todo_comment_files f JOIN todo_comments c ON c.id = f.comment_id JOIN users u ON u.id = c.author_id GROUP BY u.id, u.name ORDER BY b DESC'));
    } catch (Throwable $e) {
        // 表がまだ無い
    }
    $att['disk_bytes'] = usage_dir_stats($adir)['bytes'];
    $bk = usage_dir_stats(backup_dir(), 'auto-*.enc');
    $free = @disk_free_space(dirname(__DIR__));
    $total = @disk_total_space(dirname(__DIR__));

    // ---- バックアップ ----
    $auto = backup_auto_status();
    $manual = backup_alert_status($now);
    $backup = ['auto_enabled' => $auto['enabled'], 'auto_last' => $auto['last_at'] ?: null, 'auto_error' => $auto['last_error'] ?: null,
        'auto_files' => count($auto['files']), 'auto_keep' => $auto['keep'], 'manual_last' => $manual['last'], 'manual_days' => $manual['days'], 'manual_overdue' => $manual['overdue']];

    // ---- cron ----
    $cron = ['notify' => backup_meta('cron_notify_at') ?: null, 'nightly' => backup_meta('cron_nightly_at') ?: null];

    // ---- Slack ----
    $slack = ['configured' => false, 'name' => ''];
    try {
        if (function_exists('slack_status')) {
            $s = slack_status();
            $slack = ['configured' => (bool)$s['configured'], 'name' => (string)$s['active_name']];
        }
    } catch (Throwable $e) {
        // 何もしない
    }

    $out = [
        'version' => APP_VERSION, 'php' => PHP_VERSION, 'db' => usage_db_info(), 'timezone' => date_default_timezone_get(), 'now' => date('Y-m-d H:i:s', $now),
        'users' => $users,
        'counts' => ['events' => usage_count('events'), 'series' => usage_count('series'), 'todos' => usage_count('todos'), 'memos' => usage_count('memos'), 'audit' => usage_count('audit_log')],
        'storage' => ['attachments' => $att, 'backups' => $bk, 'disk_free' => $free === false ? null : (int)$free, 'disk_total' => $total === false ? null : (int)$total],
        'backup' => $backup, 'cron' => $cron, 'slack' => $slack,
    ];
    $out['warnings'] = usage_warnings($out, $now);
    return $out;
}

/** 気をつけること。level: warn（対応が必要）／info（知っておくとよい） */
function usage_warnings(array $u, int $now): array
{
    $w = [];
    $add = function (string $level, string $text) use (&$w) {
        $w[] = ['level' => $level, 'text' => $text];
    };
    if (is_file(usage_public_dir() . '/install.php')) {
        $add('warn', '初期設定用の install.php がサーバーに残っています。第三者に使われないよう、削除してください。');
    }
    if (PHP_SAPI !== 'cli' && empty($_SERVER['HTTPS']) && (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') !== 'https')) {
        $add('warn', 'いま、https ではない（暗号化されない）接続で開いています。https のアドレスで開いてください。');
    }
    $b = $u['backup'];
    if (!$b['auto_enabled']) {
        $add('warn', '自動バックアップが設定されていません。設定「バックアップ」でパスワードを決めると、毎日自動で保存されます。');
    } else {
        if ($b['auto_error']) {
            $add('warn', '自動バックアップが失敗しています（' . $b['auto_error'] . '）。');
        }
        $d = usage_days_since($b['auto_last'], $now);
        if ($d === null) {
            $add('info', '自動バックアップは、まだ一度も作られていません（毎日 3:00 以降の、cron の通知処理のときに作られます）。');
        } elseif ($d >= 2) {
            $add('warn', '自動バックアップが、' . $d . '日間、作られていません。cron が動いているか確認してください。');
        }
    }
    if ($b['manual_overdue']) {
        $add('warn', '手動のバックアップ（ダウンロードして別の場所に保管）が、' . $b['manual_days'] . '日間 行われていません。サーバーが壊れても残せるよう、月1回は取ってください。');
    }
    $nt = $u['cron']['notify'];
    if ($nt === null) {
        $add('info', '通知用の cron（notify）が動いた記録がまだありません。登録していれば、10分以内に表示されます。（登録していないと、Slack通知と自動バックアップは動きません）');
    } elseif ($now - (int)strtotime($nt) > USAGE_CRON_NOTIFY_STALE) {
        $add('warn', '通知用の cron（notify）が、1時間以上動いていません。最後は ' . $nt . ' です。サーバーパネルの cron 設定を確認してください。');
    }
    $ni = $u['cron']['nightly'];
    if ($ni !== null && $now - (int)strtotime($ni) > USAGE_CRON_NIGHTLY_STALE) {
        $add('warn', '毎日の繰り返し予定の作成（nightly の cron）が、1日半以上動いていません。最後は ' . $ni . ' です。');
    }
    $att = $u['storage']['attachments'];
    if ($att['bytes'] >= USAGE_ATTACH_WARN_BYTES) {
        $add('warn', 'ToDoの画像が ' . usage_size($att['bytes']) . ' になりました。不要なコメント・ToDoの画像を整理してください。');
    }
    $free = $u['storage']['disk_free'];
    if ($free !== null && $free < USAGE_DISK_WARN_BYTES) {
        $add('warn', 'サーバーのディスクの空きが ' . usage_size($free) . ' しかありません。');
    }
    $admins = 0;
    $mustChange = [];
    $idle = [];
    foreach ($u['users'] as $x) {
        if (!$x['active']) {
            continue;
        }
        if ($x['role'] === 'admin') {
            $admins++;
        }
        if ($x['must_change']) {
            $mustChange[] = $x['name'];
        }
        if ($x['idle_days'] !== null && $x['idle_days'] >= USAGE_IDLE_DAYS) {
            $idle[] = $x['name'];
        }
    }
    if ($admins === 1) {
        $add('info', '管理者が1人だけです。その人がパスワードを忘れると、サーバーのコマンドでしか戻せません。もう1人、管理者にしておくと安心です。');
    }
    if ($mustChange) {
        $add('info', '初回のパスワードをまだ変更していない人がいます: ' . implode('、', $mustChange));
    }
    if ($idle) {
        $add('info', USAGE_IDLE_DAYS . '日以上、使っていない人がいます: ' . implode('、', $idle) . '（退職などで不要なら、「社員の管理」で停止にできます）');
    }
    return $w;
}

function usage_size(int $bytes): string
{
    if ($bytes >= 1073741824) {
        return round($bytes / 1073741824, 1) . ' GB';
    }
    if ($bytes >= 1048576) {
        return round($bytes / 1048576, 1) . ' MB';
    }
    return max(0, (int)round($bytes / 1024)) . ' KB';
}
