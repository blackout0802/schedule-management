<?php
// 共通の読み込み・設定・DB・小さな便利関数。PHP 7.4 以上で動くように書いています。
define('APP_ROOT', dirname(__DIR__));
require_once __DIR__ . '/version.php';

/** 設定ファイル(config.php)の場所 */
function config_file_path(): string
{
    return getenv('SCHEDULE_CONFIG') ?: APP_ROOT . '/config.php';
}

function app_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = config_file_path();
        if (!is_file($file)) {
            throw new RuntimeException('config.php が見つかりません。config.sample.php をコピーして作成してください。');
        }
        $defaults = [
            'app_name' => 'スケジュール管理',
            'timezone' => 'Asia/Tokyo',
            'slack_webhook' => '',
            'base_url' => '',
            'cron_token' => '',
            'poll_seconds' => 20,
            'work_tags' => ['全体会議', '打ち合わせ', '定例業務', '個人作業', 'その他'],
            'off_tags' => ['有給', '調整休', '欠勤', '午前半休', '午後半休'],
        ];
        $cfg = array_merge($defaults, require $file);
        // 古い版の config.sample.php からコピーした設定に残っている、昔の初期値のままの分類は、新しい初期値に置き換える
        // （自分で変えた分類は、そのまま使う）
        if (in_array($cfg['off_tags'], [['有給', '午前半休', '午後半休', 'その他の休み'], ['有給', '調整休', '午前半休', '午後半休']], true)) {
            $cfg['off_tags'] = $defaults['off_tags'];
        }
    }
    return $cfg;
}

/** いま動いているアプリの版（更新のたびに変わる）。開いたままの画面が、更新に気づいて自動で開き直すために使う */
function app_build(): string
{
    return APP_VERSION . '.' . (@filemtime(__DIR__ . '/version.php') ?: 0);
}

/** 画面の自動更新の間隔（ミリ秒）。0 なら自動更新しない */
function poll_ms(): int
{
    $s = (int)cfg('poll_seconds', 20);
    return $s <= 0 ? 0 : max(5, min(600, $s)) * 1000;
}

function cfg(string $key, $default = null)
{
    $c = app_config();
    return array_key_exists($key, $c) ? $c[$key] : $default;
}

date_default_timezone_set((string)(is_file(config_file_path()) ? cfg('timezone', 'Asia/Tokyo') : 'Asia/Tokyo'));

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
    // 画面に出るデータ（予定・ToDo・繰り返し・休業日・社員）を書き換えたら、更新番号を進める。
    // 開いている画面は、この番号が変わったときだけ、自動で表示を更新する。書き込み処理を足しても入れ忘れが出ないよう、ここで一括して行う
    if (preg_match('/^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:events|todos|series|series_skips|company_holidays|users)\b/i', $sql)) {
        rev_mark_dirty();
    }
    return $st;
}

/**
 * 更新番号を進めるのは、書き込みのたびではなく、リクエストの最後（応答を返す直前）に1回だけ。
 * ・MySQL は、直前の INSERT のあとに別の文を実行すると lastInsertId() が 0 に戻るため、途中では実行しない
 * ・cron のように書き込みが多い処理でも、増やすのは1回で済む
 */
function rev_mark_dirty(): void
{
    static $registered = false;
    $GLOBALS['schedule_rev_dirty'] = true;
    if (!$registered) {
        $registered = true;
        register_shutdown_function('flush_rev'); // 応答を返す前に flush されなかった場合の保険
    }
}

function flush_rev(): void
{
    if (empty($GLOBALS['schedule_rev_dirty'])) {
        return;
    }
    $GLOBALS['schedule_rev_dirty'] = false;
    bump_rev();
}

/** いまの更新番号（このリクエストで書き込んだ分は、先に反映してから返す） */
function data_rev(): int
{
    flush_rev();
    $st = db()->prepare('SELECT meta_value FROM app_meta WHERE meta_key = ?');
    $st->execute(['rev']);
    $r = $st->fetch();
    return $r ? (int)$r['meta_value'] : 0;
}

function bump_rev(): void
{
    static $busy = false;
    if ($busy) {
        return;
    }
    $busy = true;
    try {
        $st = db()->prepare("UPDATE app_meta SET meta_value = meta_value + 1 WHERE meta_key = 'rev'");
        $st->execute();
        if ($st->rowCount() === 0) {
            try {
                db()->prepare("INSERT INTO app_meta (meta_key, meta_value) VALUES ('rev', '1')")->execute();
            } catch (PDOException $e) {
                // 同時に作られた。そのままで良い
            }
        }
    } catch (PDOException $e) {
        // app_meta がまだ無い古い版からの更新の途中。更新番号は、なくても動く
    } finally {
        $busy = false;
    }
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
    migrate_data();
}

/**
 * データベースの構造が古ければ、足りないテーブル・列を自動で作る（画面を開いたときと cron の開始時に呼ぶ）。
 * アプリのファイルだけを差し替えて更新しても、データベースの手作業が要らないようにするための仕組み。
 */
function ensure_schema(): void
{
    try {
        $r = row('SELECT meta_value FROM app_meta WHERE meta_key = ?', ['schema_version']);
        $cur = $r ? (int)$r['meta_value'] : 0;
    } catch (PDOException $e) {
        $cur = 0; // app_meta がまだ無い（古い版からの更新）
    }
    if ($cur >= SCHEMA_VERSION) {
        return;
    }
    run_schema();
    if ($cur < 7) {
        // 家族への共有が「プライベート」だけだった版では、業務・休みの共有指定が初期値(1)のまま入っている。
        // 業務・休みは「自分で選んだものだけ共有」にするので、一度だけ全て「共有しない」に戻す（プライベートは触らない）
        q("UPDATE events SET family_shared = 0 WHERE kind IN ('work', 'off')");
        q("UPDATE todos SET family_shared = 0 WHERE kind = 'work'");
    }
    q('DELETE FROM app_meta WHERE meta_key = ?', ['schema_version']);
    q('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', ['schema_version', (string)SCHEMA_VERSION]);
}

/** 休みの分類の名称変更（その他の休み → 調整休）を、登録済みの予定にも反映する。何度実行しても安全 */
function migrate_data(): void
{
    q("UPDATE events SET tag = '調整休' WHERE kind = 'off' AND tag = 'その他の休み'");
}

/** 古いバージョンで作ったテーブルに、後から増えた列を足す（何度実行しても安全） */
function migrate_schema(): void
{
    try {
        db()->query('SELECT must_change_password FROM users LIMIT 1')->fetchAll();
    } catch (PDOException $e) {
        db()->exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    }
    foreach (['family_share_off' => 'INTEGER NOT NULL DEFAULT 0', 'family_share_tags' => "VARCHAR(500) NOT NULL DEFAULT ''", 'prefs' => "VARCHAR(500) NOT NULL DEFAULT ''"] as $col => $def) {
        try {
            db()->query("SELECT $col FROM users LIMIT 1")->fetchAll();
        } catch (PDOException $e) {
            db()->exec("ALTER TABLE users ADD COLUMN $col $def");
        }
    }
    foreach (['events', 'todos'] as $t) {
        try {
            db()->query("SELECT family_shared FROM $t LIMIT 1")->fetchAll();
        } catch (PDOException $e) {
            // 既存のプライベート予定・ToDoは「家族に共有する」(1)が初期値
            db()->exec("ALTER TABLE $t ADD COLUMN family_shared INTEGER NOT NULL DEFAULT 1");
        }
    }
    try {
        db()->query('SELECT done_at FROM todos LIMIT 1')->fetchAll();
    } catch (PDOException $e) {
        db()->exec('ALTER TABLE todos ADD COLUMN done_at DATETIME NULL');
    }
    try {
        db()->query('SELECT important FROM events LIMIT 1')->fetchAll();
    } catch (PDOException $e) {
        db()->exec('ALTER TABLE events ADD COLUMN important INTEGER NOT NULL DEFAULT 0');
    }
    try {
        db()->query('SELECT doing FROM todos LIMIT 1')->fetchAll();
    } catch (PDOException $e) {
        db()->exec('ALTER TABLE todos ADD COLUMN doing INTEGER NOT NULL DEFAULT 0');
    }
    try {
        db()->query('SELECT sort_order FROM todos LIMIT 1')->fetchAll();
    } catch (PDOException $e) {
        db()->exec('ALTER TABLE todos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    }
    // 家族用の更新履歴に、削除された予定を「取消線」で見せるための、予定の種類と時刻
    foreach (['kind' => 'VARCHAR(10)', 'start_time' => 'VARCHAR(5)', 'end_time' => 'VARCHAR(5)'] as $col => $type) {
        try {
            db()->query("SELECT $col FROM event_log LIMIT 1")->fetchAll();
        } catch (PDOException $e) {
            db()->exec("ALTER TABLE event_log ADD COLUMN $col $type NOT NULL DEFAULT ''");
        }
    }
    // app_meta の値の欄が 100 文字だった版（Slack の送り先を複数登録するには足りない）。MySQL/MariaDB だけ広げる（SQLite の TEXT は制限なし）
    if (db()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
        try {
            db()->exec('ALTER TABLE app_meta MODIFY meta_value VARCHAR(2000) NOT NULL');
        } catch (PDOException $e) {
            error_log('[schedule] app_meta の拡張に失敗しました: ' . $e->getMessage());
        }
    }
}

/** 画面ごとに作る使い捨ての印。これを付けた <script> だけが動く（外から差し込まれた文字列は動かない） */
function csp_nonce(): string
{
    static $n = null;
    if ($n === null) {
        $n = rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');
    }
    return $n;
}

if (PHP_SAPI !== 'cli' && !headers_sent()) {
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    // 外部のスクリプト・画像・通信・フォーム送信を許さない（画面に紛れ込んだ文字列が悪さをしにくくなる）
    header("Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-" . csp_nonce() . "'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')) {
        header('Strict-Transport-Security: max-age=15552000'); // 以後、ブラウザは https でしか開かない（約半年）
    }
}
