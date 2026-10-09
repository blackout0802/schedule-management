<?php
// 共通の読み込み・設定・DB・小さな便利関数。PHP 7.4 以上で動くように書いています。
define('APP_ROOT', dirname(__DIR__));

function app_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = getenv('SCHEDULE_CONFIG') ?: APP_ROOT . '/config.php';
        if (!is_file($file)) {
            throw new RuntimeException('config.php が見つかりません。config.sample.php をコピーして作成してください。');
        }
        $defaults = [
            'app_name' => 'スケジュール管理',
            'timezone' => 'Asia/Tokyo',
            'slack_webhook' => '',
            'base_url' => '',
            'cron_token' => '',
            'work_tags' => ['全体会議', '打ち合わせ', '定例業務', '個人作業', 'その他'],
            'off_tags' => ['有給', '午前半休', '午後半休', 'その他の休み'],
        ];
        $cfg = array_merge($defaults, require $file);
    }
    return $cfg;
}

function cfg(string $key, $default = null)
{
    $c = app_config();
    return array_key_exists($key, $c) ? $c[$key] : $default;
}

date_default_timezone_set((string)(is_file(getenv('SCHEDULE_CONFIG') ?: APP_ROOT . '/config.php') ? cfg('timezone', 'Asia/Tokyo') : 'Asia/Tokyo'));

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = cfg('db');
        $pdo = new PDO($c['dsn'], $c['user'] ?? null, $c['pass'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        if (strpos($c['dsn'], 'sqlite') === 0) {
            $pdo->exec('PRAGMA foreign_keys = ON');
        }
    }
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function rows(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function row(string $sql, array $params = []): ?array
{
    $r = q($sql, $params)->fetch();
    return $r === false ? null : $r;
}

function now_str(): string
{
    return date('Y-m-d H:i:s');
}

function h($s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function valid_date(string $s): bool
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m)) {
        return false;
    }
    return checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}

function valid_time(string $s): bool
{
    return $s === '' || (bool)preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $s);
}

function dow_ja(string $date): string
{
    $w = ['日', '月', '火', '水', '木', '金', '土'];
    return $w[(int)date('w', strtotime($date))];
}

/** "2026-10-08" → "10/8（木）" */
function md_ja(string $date): string
{
    $t = strtotime($date);
    return (int)date('n', $t) . '/' . (int)date('j', $t) . '（' . dow_ja($date) . '）';
}

/** schema.*.sql を実行してテーブルを作る（何度実行しても安全） */
function run_schema(): void
{
    $dsn = cfg('db')['dsn'];
    $file = APP_ROOT . '/sql/schema.' . (strpos($dsn, 'sqlite') === 0 ? 'sqlite' : 'mysql') . '.sql';
    $sql = file_get_contents($file);
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        db()->exec($stmt);
    }
    migrate_schema();
}

/** 古いバージョンで作ったテーブルに、後から増えた列を足す（何度実行しても安全） */
function migrate_schema(): void
{
    try {
        db()->query('SELECT must_change_password FROM users LIMIT 1')->fetchAll();
    } catch (PDOException $e) {
        db()->exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    }
}

if (PHP_SAPI !== 'cli' && !headers_sent()) {
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
}
