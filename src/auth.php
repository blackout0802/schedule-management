<?php
// ログイン・セッション・CSRF対策。メールアドレス＋パスワード方式。

function session_boot(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('schedsess');
    ini_set('session.use_strict_mode', '1'); // サーバーが発行していないセッションIDは受け付けない
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function current_user(): ?array
{
    session_boot();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) {
        return null;
    }
    $u = row('SELECT id,name,email,role,slack_id,active,must_change_password FROM users WHERE id = ?', [$id]);
    return ($u && (int)$u['active'] === 1) ? $u : null;
}

function is_admin(array $u): bool
{
    return $u['role'] === 'admin';
}

/* ログイン失敗の回数制限: 同じメールアドレスで8回、同じ接続元で30回失敗したら、15分間は試せない */
const LOGIN_MAX_PER_EMAIL = 8;
const LOGIN_MAX_PER_IP = 30;
const LOGIN_WINDOW_SEC = 900;

function client_ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

function login_locked(string $email): bool
{
    try {
        $since = date('Y-m-d H:i:s', time() - LOGIN_WINDOW_SEC);
        $e = row('SELECT COUNT(*) AS c FROM login_fails WHERE email = ? AND failed_at >= ?', [$email, $since]);
        $i = row('SELECT COUNT(*) AS c FROM login_fails WHERE ip = ? AND failed_at >= ?', [client_ip(), $since]);
        return (int)$e['c'] >= LOGIN_MAX_PER_EMAIL || (int)$i['c'] >= LOGIN_MAX_PER_IP;
    } catch (Throwable $t) {
        return false; // 記録用のテーブルがまだ無い（更新直後）ときは、制限なしで続ける
    }
}

function login_record_fail(string $email): void
{
    try {
        q('INSERT INTO login_fails (email, ip, failed_at) VALUES (?,?,?)', [substr($email, 0, 190), client_ip(), now_str()]);
        q('DELETE FROM login_fails WHERE failed_at < ?', [date('Y-m-d H:i:s', time() - 86400)]);
    } catch (Throwable $t) {
        // 記録できなくても、ログインの判定そのものは続ける
    }
}

/** @return ?array ユーザー。失敗なら null（$locked が true なら、回数制限で試せなかった） */
function login_attempt(string $email, string $password, ?bool &$locked = null): ?array
{
    $email = strtolower(trim($email));
    $locked = false;
    if (login_locked($email)) {
        $locked = true;
        usleep(300000);
        return null;
    }
    $u = row('SELECT * FROM users WHERE email = ?', [$email]);
    if (!$u || (int)$u['active'] !== 1 || !password_verify($password, $u['password_hash'])) {
        login_record_fail($email);
        usleep(700000); // 失敗時は少し待たせる
        return null;
    }
    try {
        q('DELETE FROM login_fails WHERE email = ?', [$email]);
    } catch (Throwable $t) {
        // 何もしない
    }
    session_boot();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    return $u;
}

function logout(): void
{
    session_boot();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 3600, $p['path'], $p['domain'] ?? '', $p['secure'], $p['httponly']);
    }
    session_destroy();
}

function csrf_token(): string
{
    session_boot();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
    }
    return $_SESSION['csrf'];
}

function csrf_valid(?string $token): bool
{
    session_boot();
    return !empty($_SESSION['csrf']) && is_string($token) && hash_equals($_SESSION['csrf'], $token);
}

/** $mustChange=true なら、最初のログイン時にパスワードの変更を求める（管理者が初期パスワードを決めて登録する場合） */
function create_user(string $name, string $email, string $password, string $role = 'member', ?string $slackId = null, bool $mustChange = false): int
{
    q('INSERT INTO users (name,email,password_hash,role,slack_id,active,must_change_password,created_at) VALUES (?,?,?,?,?,1,?,?)', [
        $name, strtolower(trim($email)), password_hash($password, PASSWORD_DEFAULT), $role, $slackId ?: null, $mustChange ? 1 : 0, now_str(),
    ]);
    return (int)db()->lastInsertId();
}
