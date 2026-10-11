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
const BACKUP_TABLES = ['users', 'series', 'events', 'series_skips', 'company_holidays', 'notification_log', 'todos', 'app_meta', 'memos', 'share_links', 'event_log', 'audit_log'];
/** 復元しても、いまの値のままにする app_meta の項目（アプリの版・更新番号） */
const BACKUP_KEEP_META = ['schema_version', 'rev'];
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
