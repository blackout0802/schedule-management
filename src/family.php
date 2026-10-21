<?php
// 家族のアカウント（プライベートのカレンダーに、家族が書き込めるようにする）。
//
// 社員（持ち主）が、家族を招待する。家族は、role = 'family' のユーザーで、family_of に持ち主の番号が入る。
//   - 家族が見られるのは、「持ち主の家族用リンクに見えるもの」と「家族の予定」だけ（業務・社員・ToDo・会議室・設定は見えない）
//   - 家族が書けるのは、自分の予定だけ（プライベートの予定として、持ち主の家族に共有される）
//   - 持ち主のプライベート版には、家族の予定も出る（見るだけ）
// API は、家族のアカウントには、下の FAMILY_ALLOWED_ACTIONS だけを許す（api.php）。

const FAMILY_MAX = 5; // 1人の持ち主が招待できる家族の数（利用停止の人も数える）
const FAMILY_ALLOWED_ACTIONS = ['me', 'rev', 'events', 'event_save', 'event_delete', 'event_restore', 'event_move', 'event_duplicate', 'password_change', 'holidays_list'];

function is_family(array $u): bool
{
    return ($u['role'] ?? '') === 'family';
}

/** 家族のアカウントが、だれの家族か（持ち主の番号）。家族でなければ 0 */
function family_owner_id(array $u): int
{
    return is_family($u) ? (int)($u['family_of'] ?? 0) : 0;
}

/** その人（番号）は、家族のアカウントか */
function user_id_is_family(int $id): bool
{
    $r = row('SELECT role FROM users WHERE id = ?', [$id]);
    return $r !== null && $r['role'] === 'family';
}

/** 持ち主の家族のうち、使える（利用停止でない）人の番号 */
function family_member_ids(int $ownerId): array
{
    return array_map(function ($r) { return (int)$r['id']; }, rows("SELECT id FROM users WHERE role = 'family' AND family_of = ? AND active = 1 ORDER BY id", [$ownerId]));
}

/** 設定の画面に出す、持ち主の家族の一覧（利用停止の人も含む） */
function family_members(int $ownerId): array
{
    return array_map(function ($u) {
        return ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'active' => (int)$u['active'] === 1,
            'must_change_password' => (int)$u['must_change_password'] === 1, 'last_login_at' => $u['last_login_at'] ?? null];
    }, rows("SELECT id, name, email, active, must_change_password, last_login_at FROM users WHERE role = 'family' AND family_of = ? ORDER BY id", [$ownerId]));
}

/** 持ち主の家族のうち、指定した人（持ち主の家族でなければ null） */
function family_member_of(array $owner, int $id): ?array
{
    return row("SELECT * FROM users WHERE id = ? AND role = 'family' AND family_of = ?", [$id, (int)$owner['id']]);
}

/**
 * 家族を招待する（アカウントを作る）。一時パスワードを、ここで1度だけ返す。家族は、最初のログインで、自分のパスワードに変える。
 * @return array{0:int,1:string} [家族の番号, 一時パスワード]
 */
function family_add(array $owner, string $name, string $email): array
{
    if (is_family($owner)) {
        throw new RuntimeException('家族のアカウントからは、招待できません。');
    }
    $name = trim($name);
    $email = strtolower(trim($email));
    if ($name === '' || mb_strlen($name) > 60) {
        throw new RuntimeException('名前を60文字以内で入力してください。');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('メールアドレスを正しく入力してください（ログインに使います）。');
    }
    if ((int)row("SELECT COUNT(*) AS c FROM users WHERE role = 'family' AND family_of = ?", [(int)$owner['id']])['c'] >= FAMILY_MAX) {
        throw new RuntimeException('招待できる家族は、' . FAMILY_MAX . '人までです。使わない人は、削除してください。');
    }
    if (row('SELECT id FROM users WHERE email = ?', [$email])) {
        throw new RuntimeException('そのメールアドレスは使われています。');
    }
    $pw = make_temp_password();
    $id = create_user($name, $email, $pw, 'family', null, true);
    q('UPDATE users SET family_of = ? WHERE id = ?', [(int)$owner['id'], $id]);
    return [$id, $pw];
}

/** 家族のアカウントを消す。その人の予定も、いっしょに消える */
function family_delete(array $owner, int $id): bool
{
    $m = family_member_of($owner, $id);
    if (!$m) {
        return false;
    }
    q('DELETE FROM events WHERE owner_id = ?', [$id]);
    q('DELETE FROM login_fails WHERE email = ?', [$m['email']]);
    q('DELETE FROM users WHERE id = ?', [$id]);
    return true;
}

/**
 * 家族のアカウントに見える予定の条件（SQL の断片と値）。予定は e の別名で絞る。
 *   (1) 持ち主の家族用リンクに見えるもの（family_visible_cond と同じ）
 *   (2) 持ち主の家族（本人を含む）が入れた予定
 * @return array{0:string,1:array}
 */
function family_account_cond(array $user): array
{
    $owner = family_owner_id($user);
    [$fcond, $fparams] = family_visible_cond($owner);
    $ids = family_member_ids($owner);
    $ids[] = (int)$user['id']; // 本人（利用停止にされても、見えなくなるだけで、ここには来ない）
    $ids = array_values(array_unique($ids));
    $ph = implode(',', array_fill(0, count($ids), '?'));
    return ["((e.owner_id = ? AND ($fcond)) OR (e.owner_id IN ($ph) AND e.kind = 'private'))", array_merge([$owner], $fparams, $ids)];
}

/** 家族のアカウントは、この予定を見てよいか */
function family_can_see_event(array $e, array $user): bool
{
    [$cond, $params] = family_account_cond($user);
    return row("SELECT e.id FROM events e WHERE e.id = ? AND $cond", array_merge([(int)$e['id']], $params)) !== null;
}
