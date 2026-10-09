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

function login_attempt(string $email, string $password): ?array
{
    $u = row('SELECT * FROM users WHERE email = ?', [strtolower(trim($email))]);
    if (!$u || (int)$u['active'] !== 1 || !password_verify($password, $u['password_hash'])) {
        usleep(700000); // 総当たり対策のため失敗時は少し待たせる
        return null;
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
