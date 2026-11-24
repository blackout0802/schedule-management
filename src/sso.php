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
        && portal_url_ok()
        && strlen((string)base64_decode(sso_cfg('portal_pubkey'), true)) === 32;
}

/**
 * ポータルの段階6: この人は、ふつうのログイン（パスワード）を使えず、ポータルから入るか。
 * ポータルから一度でも入った人（portal_linked_at）だけ。管理者は、ポータルが止まったときのために、ふつうのログインも使える。
 * ポータルの仕組みが使えない（sso_on が false）ときと、設定 portal_only が false のときは、だれも止めない（入れなくならないように）
 */
function portal_only(array $u): bool
{
    return (bool)($GLOBALS['SSO_CFG']['portal_only'] ?? cfg('portal_only', true)) && sso_on() && !is_admin($u) && ($u['role'] ?? '') !== 'family' && (string)($u['portal_linked_at'] ?? '') !== '';
}

/** ポータルの URL が正しい形か（http は手元の確かめ用 portal_allow_http のときだけ） */
function portal_url_ok(): bool
{
    return (bool)preg_match(cfg('portal_allow_http', false) ? '~^https?://[^\s"\'<>?#]+/$~' : '~^https://[^\s"\'<>?#]+/$~', sso_cfg('portal_url'));
}

/**
 * 上の帯の「アプリ」: ポータルへ戻るリンクと、ほかのアプリへ移るリンク（設定 portal_apps）。このアプリ自身（portal_app_id）は除く。
 * 経理のアプリ（for = accounting）は、ポータルで経理か管理者の人（users.portal_acc。ポータルから入るたびに覚える）だけ。
 * リンクを出すだけで、開いた先では、それぞれのアプリとポータルが確かめる。ポータルの URL が正しくなければ null（メニューごと出さない）。
 * 家族のアカウントは、ポータルを使わないので null。（パスワード管理アプリの portal_nav と同じ決まり。直すときは両方とも）
 */
function portal_nav(array $u): ?array
{
    if (!portal_url_ok() || ($u['role'] ?? '') === 'family') {
        return null;
    }
    $re = cfg('portal_allow_http', false) ? '~^https?://[^\s"\'<>]+$~' : '~^https://[^\s"\'<>]+$~';
    $apps = [];
    foreach ((array)($GLOBALS['SSO_CFG']['portal_apps'] ?? cfg('portal_apps', [])) as $a) {
        if (!is_array($a) || !is_string($a['id'] ?? null) || !is_string($a['name'] ?? null) || $a['id'] === sso_cfg('portal_app_id')) {
            continue;
        }
        $acc = ($a['for'] ?? 'all') === 'accounting';
        if ($acc && (int)($u['portal_acc'] ?? 0) !== 1) {
            continue;
        }
        $href = (string)($a['sso'] ?? ($a['url'] ?? ''));
        if (!preg_match($re, $href)) {
            continue;
        }
        $apps[] = ['id' => $a['id'], 'name' => $a['name'], 'href' => $href, 'accounting' => $acc];
    }
    return ['portal' => sso_cfg('portal_url'), 'apps' => $apps];
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
    // 上の帯の「アプリ」で、経理のアプリを出すか（ポータルの一覧と同じく、経理か管理者）。入るたびに、ポータルの今の値にそろえる
    // portal_linked_at: ポータルから初めて入った日時（この人は、次からふつうのログインを使えない。portal_only）
    q('UPDATE users SET portal_acc = ?, portal_linked_at = COALESCE(portal_linked_at, ?) WHERE id = ?', [(($d['accounting'] ?? false) === true || ($d['admin'] ?? false) === true) ? 1 : 0, now_str(), $u['id']]);
    login_start($u);
    return '';
}
