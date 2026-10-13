<?php
// バックアップ（管理者）: データベースの中身を、パスワードで暗号化した1つのファイルにして保存・復元する。
//
// ・プライベートの予定・ToDo・メモも含めて保存する。ただし、ファイルは強い暗号（AES-256-GCM。鍵はパスワードから PBKDF2 で作る）で守られ、
//   パスワードが無いと、管理者でも中身を見られない（パスワードを忘れると、復元できない）
// ・config.php（データベースの接続設定）は含まれない。サーバーを作り直すときは、config.php を別に控えておく
// ・ファイルの形: 先頭に「SCHEDBK1」＋ 塩(16) ＋ IV(12) ＋ 繰り返し回数(4) ＋ 認証タグ(16) ＋ 暗号文（gzip した JSON）。
//   ファイルの先頭部分は改ざん検知（認証）の対象になっている

require_once __DIR__ . '/bootstrap.php';

class BackupException extends RuntimeException
{
}

/** 保存する表。ログイン失敗の記録（login_fails）は、保存しない */
const BACKUP_TABLES = ['users', 'series', 'events', 'series_skips', 'company_holidays', 'notification_log', 'todos', 'todo_comments', 'app_meta', 'memos', 'memo_days', 'share_links', 'event_log', 'audit_log'];
/** 復元しても、いまの値のままにする app_meta の項目（アプリの版・更新番号） */
const BACKUP_KEEP_META = ['schema_version', 'rev', 'backup_auto_pass', 'backup_auto_at', 'backup_auto_err', 'backup_auto_try', 'backup_manual_at', 'backup_first', 'backup_snooze', 'backup_alert_slack'];
const BACKUP_MAGIC = 'SCHEDBK1';
const BACKUP_PBKDF2_ITER = 200000;
const BACKUP_MIN_PASS = 8;

function backup_available(): bool
{
    return function_exists('openssl_encrypt') && in_array('aes-256-gcm', array_map('strtolower', openssl_get_cipher_methods()), true)
        && function_exists('gzencode') && function_exists('hash_pbkdf2');
}

function backup_check_pass(string $pass): void
{
    if (mb_strlen($pass) < BACKUP_MIN_PASS) {
        throw new BackupException('バックアップ用のパスワードは、' . BACKUP_MIN_PASS . '文字以上にしてください。');
    }
}

/** 全データを配列にする */
function backup_collect(): array
{
    $tables = [];
    $counts = [];
    foreach (BACKUP_TABLES as $t) {
        $tables[$t] = rows("SELECT * FROM $t");
        if ($t === 'app_meta') { // バックアップの設定そのもの（自動バックアップのパスワードなど）は、含めない
            $tables[$t] = array_values(array_filter($tables[$t], function ($r) { return !in_array($r['meta_key'], BACKUP_KEEP_META, true); }));
        }
        $counts[$t] = count($tables[$t]);
    }
    return ['format' => 1, 'app_version' => APP_VERSION, 'schema_version' => SCHEMA_VERSION, 'created_at' => now_str(), 'counts' => $counts, 'tables' => $tables];
}

function backup_encrypt(string $plain, string $pass): string
{
    if (!backup_available()) {
        throw new BackupException('このサーバーでは、暗号化（OpenSSL の AES-256-GCM）が使えません。');
    }
    backup_check_pass($pass);
    $salt = random_bytes(16);
    $iv = random_bytes(12);
    $iter = BACKUP_PBKDF2_ITER;
    $key = hash_pbkdf2('sha256', $pass, $salt, $iter, 32, true);
    $head = BACKUP_MAGIC . $salt . $iv . pack('N', $iter);
    $tag = '';
    $ct = openssl_encrypt(gzencode($plain, 6), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, $head, 16);
    if ($ct === false || strlen($tag) !== 16) {
        throw new BackupException('暗号化に失敗しました。');
    }
    return $head . $tag . $ct;
}

/** @return string 復元した JSON 文字列。パスワードが違う・壊れているときは BackupException */
function backup_decrypt(string $blob, string $pass): string
{
    if (!backup_available()) {
        throw new BackupException('このサーバーでは、暗号化（OpenSSL の AES-256-GCM）が使えません。');
    }
    $hl = 8 + 16 + 12 + 4;
    if (strlen($blob) < $hl + 16 + 1 || substr($blob, 0, 8) !== BACKUP_MAGIC) {
        throw new BackupException('バックアップのファイルではありません（形式が違います）。');
    }
    $salt = substr($blob, 8, 16);
    $iv = substr($blob, 24, 12);
    $iter = unpack('N', substr($blob, 36, 4))[1];
    if ($iter < 1000 || $iter > 5000000) {
        throw new BackupException('バックアップのファイルが壊れています。');
    }
    $head = substr($blob, 0, $hl);
    $tag = substr($blob, $hl, 16);
    $ct = substr($blob, $hl + 16);
    $key = hash_pbkdf2('sha256', $pass, $salt, $iter, 32, true);
    $gz = openssl_decrypt($ct, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, $head);
    if ($gz === false) {
        throw new BackupException('パスワードが違うか、ファイルが壊れています。');
    }
    $plain = @gzdecode($gz);
    if ($plain === false) {
        throw new BackupException('バックアップのファイルが壊れています。');
    }
    return $plain;
}

/** 暗号化したバックアップ（ファイルの中身）を作る。個数は、画面に出す確認用 */
function backup_create(string $pass): array
{
    $data = backup_collect();
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        throw new BackupException('バックアップの作成に失敗しました。');
    }
    return ['blob' => backup_encrypt($json, $pass), 'counts' => $data['counts'], 'name' => 'schedule-backup-' . date('Ymd-His') . '.enc'];
}

/** 表の列名（いまのデータベースにある列） */
function backup_columns(string $table): array
{
    $st = db()->query("SELECT * FROM $table WHERE 1 = 0");
    $cols = [];
    for ($i = 0; $i < $st->columnCount(); $i++) {
        $m = $st->getColumnMeta($i);
        $cols[] = $m['name'];
    }
    return $cols;
}

/** 中身の確認だけ（復元はしない）: 個数などを返す */
function backup_inspect(string $json): array
{
    $d = json_decode($json, true);
    if (!is_array($d) || ($d['format'] ?? 0) !== 1 || !isset($d['tables']) || !is_array($d['tables'])) {
        throw new BackupException('バックアップの中身を読み取れません。');
    }
    if ((int)($d['schema_version'] ?? 0) > SCHEMA_VERSION) {
        throw new BackupException('このバックアップは、いまより新しい版（v' . h((string)($d['app_version'] ?? '?')) . '）で作られています。先にシステム更新で、最新の版にしてください。');
    }
    return $d;
}

/**
 * バックアップの内容で、データを丸ごと置き換える（途中で失敗したら、元のまま）。
 * @return array 表ごとの件数
 */
function backup_restore_data(array $d): array
{
    ensure_schema(); // 足りない列・表があれば、先に作る（古い版のデータベースでも復元できるように）
    $pdo = db();
    $done = [];
    $pdo->beginTransaction();
    try {
        foreach (array_reverse(BACKUP_TABLES) as $t) {
            if (!isset($d['tables'][$t])) {
                continue; // 古い版のバックアップに無い表は、そのまま残す
            }
            if ($t === 'app_meta') {
                $in = implode(',', array_fill(0, count(BACKUP_KEEP_META), '?'));
                $pdo->prepare("DELETE FROM app_meta WHERE meta_key NOT IN ($in)")->execute(BACKUP_KEEP_META);
            } else {
                $pdo->exec("DELETE FROM $t");
            }
        }
        foreach (BACKUP_TABLES as $t) {
            if (!isset($d['tables'][$t]) || !is_array($d['tables'][$t])) {
                continue;
            }
            $cols = backup_columns($t);
            $n = 0;
            foreach ($d['tables'][$t] as $r) {
                if (!is_array($r)) {
                    continue;
                }
                if ($t === 'app_meta' && in_array($r['meta_key'] ?? '', BACKUP_KEEP_META, true)) {
                    continue;
                }
                $use = array_values(array_filter(array_keys($r), function ($c) use ($cols) { return in_array($c, $cols, true) && preg_match('/^[A-Za-z0-9_]+$/', (string)$c); }));
                if (!$use) {
                    continue;
                }
                $pdo->prepare("INSERT INTO $t (" . implode(',', $use) . ') VALUES (' . implode(',', array_fill(0, count($use), '?')) . ')')
                    ->execute(array_map(function ($c) use ($r) { return $r[$c]; }, $use));
                $n++;
            }
            $done[$t] = $n;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw new BackupException('復元に失敗したため、データは元のままです。（' . $e->getMessage() . '）');
    }
    bump_rev();
    return $done;
}


// =====================================================================
// 自動バックアップ（サーバーの data/backups/ に、毎日1回、暗号化して保存）と、月1回の手動バックアップのお知らせ
//   パスワード … config.php の backup_password、なければ、バックアップの画面で設定したもの（app_meta.backup_auto_pass）
//   保存先     … data/backups/auto-日時.enc（Web からは見えない場所。新しい backup_keep 件（既定30）だけ残す）
//   動かし方   … cron の notify（5〜10分おき）の中で、毎日 3:00 以降に1回だけ作る（cron を増やす必要なし）。bin/cron.php backup でも作れる
//   お知らせ   … 手動でダウンロードしてから30日たつと、管理者の画面に出る（7日間は消せる）。Slack にも送る設定にできる
// =====================================================================
const BACKUP_AUTO_HOUR = 3;
const BACKUP_ALERT_DAYS = 30;

function backup_meta(string $key): string
{
    try {
        $r = row('SELECT meta_value FROM app_meta WHERE meta_key = ?', [$key]);
        return $r ? (string)$r['meta_value'] : '';
    } catch (Throwable $e) {
        return '';
    }
}

function backup_meta_set(string $key, string $val): void
{
    q('DELETE FROM app_meta WHERE meta_key = ?', [$key]);
    if ($val !== '') {
        q('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', [$key, $val]);
    }
}

function backup_dir(): string
{
    return dirname(__DIR__) . '/data/backups';
}

/** 自動バックアップのパスワード（config.php が優先）。無ければ ''（自動バックアップは動かない） */
function backup_auto_password(): string
{
    $c = (string)cfg('backup_password', '');
    return $c !== '' ? $c : backup_meta('backup_auto_pass');
}

function backup_keep_count(): int
{
    return max(3, min(365, (int)cfg('backup_keep', 30)));
}

/** 保存してある自動バックアップの一覧（新しい順）。[{name,size,at}] */
function backup_auto_files(): array
{
    $out = [];
    foreach (glob(backup_dir() . '/auto-*.enc') ?: [] as $f) {
        if (preg_match('/^auto-(\d{8})-(\d{6})(?:-(\d+))?\.enc$/', basename($f), $m)) {
            $out[] = ['name' => basename($f), 'size' => (int)filesize($f), 'at' => substr($m[1], 0, 4) . '-' . substr($m[1], 4, 2) . '-' . substr($m[1], 6, 2) . ' ' . substr($m[2], 0, 2) . ':' . substr($m[2], 2, 2),
                'sort' => $m[1] . $m[2] . sprintf('%04d', (int)($m[3] ?? 0))];
        }
    }
    usort($out, function ($a, $b) { return strcmp($b['sort'], $a['sort']); });
    return $out;
}

function backup_auto_status(): array
{
    $src = (string)cfg('backup_password', '') !== '' ? 'config' : (backup_meta('backup_auto_pass') !== '' ? 'db' : '');
    return ['enabled' => $src !== '', 'source' => $src, 'last_at' => backup_meta('backup_auto_at'), 'last_error' => backup_meta('backup_auto_err'), 'files' => backup_auto_files(), 'keep' => backup_keep_count()];
}

/** 自動バックアップを今すぐ作る。作ったファイル名を返す。失敗したら BackupException（失敗は記録される） */
function backup_auto_run(): string
{
    $pass = backup_auto_password();
    try {
        if ($pass === '') {
            throw new BackupException('自動バックアップのパスワードが設定されていません。');
        }
        $dir = backup_dir();
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new BackupException('保存先のフォルダ（data/backups）を作れません。');
        }
        if (!is_file($dir . '/.htaccess')) { // Web から見えないように（二重の守り。ファイル自体も暗号化されている）
            @file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n");
        }
        $b = backup_create($pass);
        $base = 'auto-' . date('Ymd-His');
        $name = $base . '.enc';
        for ($i = 2; is_file($dir . '/' . $name) && $i < 100; $i++) { // 同じ秒に2回作っても、上書きしない
            $name = $base . '-' . $i . '.enc';
        }
        $tmp = $dir . '/.tmp-' . getmypid() . '.part';
        if (@file_put_contents($tmp, $b['blob']) === false || !@rename($tmp, $dir . '/' . $name)) {
            @unlink($tmp);
            throw new BackupException('バックアップのファイルを書き込めません（保存先の空き容量・権限を確認してください）。');
        }
        @chmod($dir . '/' . $name, 0600);
        $files = backup_auto_files();
        foreach (array_slice($files, backup_keep_count()) as $old) { // 古いものを消す
            @unlink($dir . '/' . $old['name']);
        }
        backup_meta_set('backup_auto_at', now_str());
        backup_meta_set('backup_auto_err', '');
        return $name;
    } catch (Throwable $e) {
        backup_meta_set('backup_auto_err', now_str() . ' ' . mb_substr($e->getMessage(), 0, 200));
        throw $e instanceof BackupException ? $e : new BackupException($e->getMessage());
    }
}

/** 保存済みの自動バックアップを、名前から探す（../ などを防ぐため、一覧にあるものだけ）。無ければ null */
function backup_auto_file_path(string $name): ?string
{
    foreach (backup_auto_files() as $f) {
        if ($f['name'] === $name) {
            return backup_dir() . '/' . $name;
        }
    }
    return null;
}

/** cron から呼ぶ。今日まだ作っていなければ（3時以降に）作る。メッセージの配列を返す */
function backup_auto_due(?int $now = null): array
{
    $now = $now ?? time();
    if (backup_auto_password() === '' || (int)date('G', $now) < BACKUP_AUTO_HOUR) {
        return [];
    }
    $last = backup_meta('backup_auto_at');
    if ($last !== '' && substr($last, 0, 10) === date('Y-m-d', $now)) {
        return []; // 今日は作成済み
    }
    $try = (int)backup_meta('backup_auto_try');
    if ($try > 0 && $now - $try < 3600) {
        return []; // 失敗したあとは、1時間あけてやり直す
    }
    backup_meta_set('backup_auto_try', (string)$now);
    try {
        return ['自動バックアップを作成しました（' . backup_auto_run() . '）'];
    } catch (BackupException $e) {
        return ['自動バックアップに失敗しました: ' . $e->getMessage()];
    }
}

// ---- 月1回の手動バックアップのお知らせ ----

function backup_manual_mark(): void
{
    backup_meta_set('backup_manual_at', now_str());
    backup_meta_set('backup_snooze', '');
}

/** 手動バックアップのお知らせの状態。基準日は、最後に手動でダウンロードした日（まだ無ければ、この機能を初めて確認した日） */
function backup_alert_status(?int $now = null): array
{
    $now = $now ?? time();
    $last = backup_meta('backup_manual_at');
    $base = $last;
    if ($base === '') {
        $base = backup_meta('backup_first');
        if ($base === '') {
            $base = date('Y-m-d H:i:s', $now);
            backup_meta_set('backup_first', $base);
        }
    }
    $days = (int)floor(($now - strtotime($base)) / 86400);
    $snooze = (int)backup_meta('backup_snooze');
    return ['overdue' => $days >= BACKUP_ALERT_DAYS, 'days' => $days, 'last' => $last !== '' ? $last : null, 'snoozed' => $snooze > $now, 'slack' => backup_meta('backup_alert_slack') === '1'];
}

function backup_snooze(int $days = 7): void
{
    backup_meta_set('backup_snooze', (string)(time() + $days * 86400));
}

/** 画面に出すお知らせ（管理者だけ）。出す必要がなければ null */
function backup_alert_for_screen(): ?array
{
    $s = backup_alert_status();
    if (!$s['overdue'] || $s['snoozed']) {
        return null;
    }
    return ['days' => $s['days'], 'last' => $s['last']];
}

/** cron から呼ぶ。お知らせの時期（30日以上）で、Slack通知がオンなら、月に1回だけ Slack へ送る */
function backup_alert_due(?int $now = null): array
{
    $now = $now ?? time();
    $s = backup_alert_status($now);
    if (!$s['overdue'] || !$s['slack'] || (int)date('G', $now) < 9 || !function_exists('slack_post') || !slack_enabled()) {
        return [];
    }
    if (!notify_once('backup-alert-' . date('Ym', $now))) {
        return [];
    }
    $url = slack_base_dir() !== '' ? slack_base_dir() . 'backup.php' : '';
    $txt = '【管理者の方へ】月1回の手動バックアップの時期です。' . ($s['last'] ? '（最後にダウンロードしたのは ' . substr($s['last'], 0, 10) . '）' : '（まだ一度もダウンロードしていません）')
        . "\nバックアップの画面から、ファイルをダウンロードして、別の場所に保管してください。" . ($url !== '' ? "\n" . $url : '');
    return slack_post($txt) ? ['手動バックアップのお知らせをSlackへ送りました'] : [];
}

/** cron の notify から呼ぶ、バックアップ関係の処理 */
function backup_cron_tasks(?int $now = null): array
{
    $msg = [];
    try {
        $msg = array_merge($msg, backup_auto_due($now), backup_alert_due($now));
    } catch (Throwable $e) {
        error_log('[schedule backup cron] ' . $e->getMessage());
        $msg[] = 'バックアップ処理でエラー: ' . $e->getMessage();
    }
    return $msg;
}
