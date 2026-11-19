<?php
// ポータルから自動で入る（ポータルの段階2）。決まりは、ポータル（blackout0802/portal）の docs/DESIGN.md の 6。
// ポータルが署名したチケット（Ed25519・60秒）を受け取り口 public/sso.php で確かめ、パスワードを聞かずにログインする。
// state（受け取り口で作り、この端末のセッションに覚えた合言葉）は1回だけ使える。チケットの使い回しと、ほかの人のチケットを送りつけるログインを防ぐ。
// PHP 7.4 でも動く書き方にする（CI の unit が 7.4 でも流れる）。

const SSO_STATE_SECONDS = 600; // ポータルへ行って戻るまでの時間

/** 設定（portal_url・portal_app_id・portal_pubkey）。テストでは $GLOBALS['SSO_CFG'] で上書きできる */
function sso_cfg(string $key): string
{
    return (string)($GLOBALS['SSO_CFG'][$key] ?? cfg($key, ''));
}

/** ポータルから自動で入る仕組みを使えるか（ポータルの URL と、確かめる鍵があり、PHP に sodium がある） */
function sso_on(): bool
{
    return function_exists('sodium_crypto_sign_verify_detached')
        && preg_match('~^https://[^\s"\'<>?#]+/$~', sso_cfg('portal_url'))
        && strlen((string)base64_decode(sso_cfg('portal_pubkey'), true)) === 32;
}

/**
 * ポータルのチケットを確かめて、中身を返す。正しくなければ null（理由は $why: invalid | expired）。
 * 形: v1.<中身 base64url>.<署名 base64url>。署名は Ed25519 で「portal-ticket-v1.<中身>」に。
 * （この関数は、パスワード管理アプリにも同じものがある。直すときは両方とも）
 */
function portal_ticket_verify(string $ticket, string $pubB64, string $aud, int $now, ?string &$why = null): ?array
{
    $why = 'invalid';
    $pk = base64_decode($pubB64, true);
    $p = explode('.', $ticket);
    if (!is_string($pk) || strlen($pk) !== 32 || strlen($ticket) > 4000 || count($p) !== 3 || $p[0] !== 'v1') {
        return null;
    }
    $sig = base64_decode(strtr($p[2], '-_', '+/'), true);
    if (!is_string($sig) || strlen($sig) !== 64) {
        return null;
    }
    try {
        if (!sodium_crypto_sign_verify_detached($sig, 'portal-ticket-v1.' . $p[1], $pk)) {
            return null;
        }
    } catch (Throwable $e) {
        return null;
    }
    $d = json_decode((string)base64_decode(strtr($p[1], '-_', '+/'), true), true);
    if (!is_array($d) || ($d['v'] ?? null) !== 1 || ($d['iss'] ?? null) !== 'portal' || ($d['aud'] ?? null) !== $aud
        || !is_int($d['iat'] ?? null) || !is_int($d['exp'] ?? null) || !is_string($d['email'] ?? null) || !is_string($d['state'] ?? null)) {
        return null;
    }
    if ($d['exp'] < $now || $d['iat'] > $now + 30 || $d['exp'] - $d['iat'] > 120) {
        $why = 'expired';
        return null;
    }
    $why = '';
    return $d;
}

/** 受け取り口（GET）: state を作ってセッションに覚え、ポータルへ移る URL を返す */
function sso_start(): string
{
    session_boot();
    $state = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    $_SESSION['sso_state'] = ['v' => $state, 'at' => time()];
    return sso_cfg('portal_url') . 'sso.php?app=' . rawurlencode(sso_cfg('portal_app_id')) . '&state=' . rawurlencode($state);
}

/**
 * 受け取り口（POST）: チケットを確かめて、ログインする。
 * @return string '' ならログインした。ほかは理由: invalid | expired | nouser | off
 */
function sso_receive(string $ticket): string
{
    if (!sso_on()) {
        return 'off';
    }
    session_boot();
    $st = $_SESSION['sso_state'] ?? null;
    unset($_SESSION['sso_state']); // 合っても合わなくても、1回で使えなくする
    $d = portal_ticket_verify($ticket, sso_cfg('portal_pubkey'), sso_cfg('portal_app_id'), time(), $why);
    if (!$d) {
        return $why;
    }
    if (!is_array($st) || !is_string($st['v'] ?? null) || time() - (int)($st['at'] ?? 0) > SSO_STATE_SECONDS || !hash_equals($st['v'], $d['state'])) {
        return 'expired';
    }
    $u = row('SELECT * FROM users WHERE email = ?', [strtolower(trim($d['email']))]);
    if (!$u || (int)$u['active'] !== 1) {
        return 'nouser';
    }
    login_start($u);
    return '';
}
