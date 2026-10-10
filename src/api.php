<?php
// JSON API。画面（public/assets/app.js）からだけ呼ばれる。
// 読み取りは GET、変更は POST（X-CSRF-Token 必須）。

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/events.php';
require_once __DIR__ . '/slack.php';
require_once __DIR__ . '/share.php';

function api_out($data, int $code = 200): void
{
    flush_rev(); // 更新番号を、応答より先に進めておく（応答を受け取った画面が、最新の番号で動き出せるように）
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function api_fail(string $msg, int $code = 400): void
{
    api_out(['error' => $msg], $code);
}

function series_for_client(array $s, array $user, BizCalendar $cal): array
{
    return [
        'id' => (int)$s['id'], 'title' => $s['title'], 'tag' => $s['tag'], 'rule_type' => $s['rule_type'],
        'p_day' => $s['p_day'] === null ? null : (int)$s['p_day'], 'p_day2' => $s['p_day2'] === null ? null : (int)$s['p_day2'],
        'p_nth' => $s['p_nth'] === null ? null : (int)$s['p_nth'], 'p_weekday' => $s['p_weekday'] === null ? null : (int)$s['p_weekday'],
        'p_count' => $s['p_count'] === null ? null : (int)$s['p_count'],
        'shift' => $s['shift'], 'bizonly' => (int)$s['bizonly'], 'start_time' => $s['start_time'], 'end_time' => $s['end_time'],
        'owner_name' => $s['owner_name'] ?? '', 'label' => rule_label($s),
        'editable' => (int)$s['owner_id'] === (int)$user['id'] || is_admin($user),
        'next' => array_slice(array_values(array_filter(series_preview($s, 3, $cal), function ($p) {
            return $p['start'] !== null && $p['end'] >= date('Y-m-d');
        })), 0, 3),
    ];
}

function validate_series_input(array $in): array
{
    $type = (string)($in['rule_type'] ?? '');
    if (!in_array($type, RULE_TYPES, true)) {
        return [null, 'ルールの種類を選んでください。'];
    }
    $title = trim((string)($in['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 100) {
        return [null, '件名を100文字以内で入力してください。'];
    }
    $tag = (string)($in['tag'] ?? '定例業務');
    if (!in_array($tag, cfg('work_tags'), true)) {
        $tag = '定例業務';
    }
    $st = (string)($in['start_time'] ?? '');
    $et = (string)($in['end_time'] ?? '');
    if (!valid_time($st) || !valid_time($et)) {
        return [null, '時刻は 09:30 の形式で入力してください。'];
    }
    $s = [
        'rule_type' => $type, 'title' => $title, 'tag' => $tag, 'start_time' => $st, 'end_time' => $et,
        'p_day' => null, 'p_day2' => null, 'p_nth' => null, 'p_weekday' => null, 'p_count' => null,
        'shift' => 'none', 'bizonly' => 0,
    ];
    $int = function ($k, $min, $max) use ($in) {
        $v = $in[$k] ?? null;
        return (is_numeric($v) && (int)$v >= $min && (int)$v <= $max) ? (int)$v : null;
    };
    switch ($type) {
        case 'day':
            $s['p_day'] = $int('p_day', 1, 31);
            $s['shift'] = in_array($in['shift'] ?? 'none', ['none', 'prev', 'next'], true) ? $in['shift'] : 'none';
            if ($s['p_day'] === null) {
                return [null, '日（1〜31）を入力してください。'];
            }
            break;
        case 'weekday_nth':
            $s['p_nth'] = ($in['p_nth'] ?? null) == -1 ? -1 : $int('p_nth', 1, 5);
            $s['p_weekday'] = $int('p_weekday', 0, 6);
            if ($s['p_nth'] === null || $s['p_weekday'] === null) {
                return [null, '第何週の何曜日かを選んでください。'];
            }
            break;
        case 'first_bizdays':
            $s['p_count'] = $int('p_count', 1, 20);
            if ($s['p_count'] === null) {
                return [null, '営業日の数（1〜20）を入力してください。'];
            }
            break;
        case 'range':
            $s['p_day'] = $int('p_day', 1, 31);
            $s['p_day2'] = $int('p_day2', 1, 31);
            $s['bizonly'] = !empty($in['bizonly']) ? 1 : 0;
            if ($s['p_day'] === null || $s['p_day2'] === null || $s['p_day2'] < $s['p_day']) {
                return [null, '開始日と終了日を正しく入力してください。'];
            }
            break;
    }
    return [$s, null];
}

const EXAMPLE_SERIES = [
    ['title' => '請求処理', 'rule_type' => 'first_bizdays', 'p_count' => 3],
    ['title' => '給与計算の準備', 'rule_type' => 'range', 'p_day' => 10, 'p_day2' => 15, 'bizonly' => 1],
    ['title' => '棚卸し', 'rule_type' => 'range', 'p_day' => 20, 'p_day2' => 25, 'bizonly' => 1],
    ['title' => 'シフト提出', 'rule_type' => 'day', 'p_day' => 25, 'shift' => 'prev'],
    ['title' => '住民税の金額チェック', 'rule_type' => 'day', 'p_day' => 25, 'shift' => 'prev'],
    ['title' => '支払請求書のスキャン', 'rule_type' => 'day', 'p_day' => 25, 'shift' => 'prev'],
];

function handle_api(): void
{
    $user = current_user();
    if (!$user) {
        api_fail('ログインが必要です。', 401);
    }
    $action = (string)($_GET['action'] ?? '');
    $isPost = $_SERVER['REQUEST_METHOD'] === 'POST';
    $in = [];
    if ($isPost) {
        if (!csrf_valid($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
            api_fail('画面の有効期限が切れました。ページを再読み込みしてください。', 403);
        }
        $in = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($in)) {
            api_fail('リクエストの形式が正しくありません。');
        }
    }
    if ($action === 'rev') {
        // 画面の自動更新用。何も書き換えず、すぐ返す（待たせない・負担をかけない）
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        api_out(['rev' => data_rev()]);
    }
    $cal = BizCalendar::fromDb();

    // 初期パスワードのままの人は、パスワードを変更するまで他の操作ができない
    if ((int)$user['must_change_password'] === 1 && !in_array($action, ['me', 'password_change'], true)) {
        api_fail('最初にパスワードを変更してください。', 403);
    }

    switch ($action) {
        case 'me':
            ensure_schema(); // アプリのファイルを更新したあと、足りないテーブルを自動で作る
            migrate_data(); // 画面を開くたびに、名称変更の反映漏れがないようにする（軽い1文）
            api_out([
                'user' => ['id' => (int)$user['id'], 'name' => $user['name'], 'email' => $user['email'], 'role' => $user['role'],
                    'must_change_password' => (int)$user['must_change_password'] === 1],
                'csrf' => csrf_token(),
                'app_name' => cfg('app_name'),
                'app_version' => APP_VERSION,
                'family_share' => get_family_share($user),
                'work_tags' => cfg('work_tags'),
                'off_tags' => cfg('off_tags'),
                'slack' => slack_enabled(),
                'users' => array_map(function ($u) {
                    return ['id' => (int)$u['id'], 'name' => $u['name']];
                }, rows('SELECT id, name FROM users WHERE active = 1 ORDER BY name')),
            ]);

        case 'events':
            $from = (string)($_GET['from'] ?? '');
            $to = (string)($_GET['to'] ?? '');
            if (!valid_date($from) || !valid_date($to) || $to < $from || strtotime($to) - strtotime($from) > 100 * 86400) {
                api_fail('期間が正しくありません。');
            }
            $rev = data_rev(); // データを読む前の番号（読んでいる間に更新されても、次の確認で見つかるように）
            $view = ($_GET['view'] ?? 'team') === 'me' ? 'me' : 'team';
            $tags = isset($_GET['tags']) && $_GET['tags'] !== '' ? explode(',', (string)$_GET['tags']) : [];
            $holidays = holiday_map($from, $to);
            $out = [
                'events' => list_events($user, $from, $to, $view, ['tags' => $tags, 'showOff' => ($_GET['off'] ?? '1') === '1', 'who' => ctype_digit((string)($_GET['who'] ?? '')) ? (int)$_GET['who'] : 0]),
                'holidays' => $holidays,
                'rev' => $rev,
            ];
            $sum = (string)($_GET['sum'] ?? ''); // 表示している月（YYYY-MM）。あれば、その月の自分の出勤日・休みの日数も返す
            if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $sum)) {
                $out['summary'] = month_summary($user, $sum);
            }
            api_out($out);

        case 'event_save':
            $existing = null;
            if (!empty($in['id'])) {
                $existing = find_event((int)$in['id'], $user);
                if (!$existing) {
                    api_fail('予定が見つかりません。', 404);
                }
                if (!can_edit_event($existing, $user)) {
                    api_fail('この予定は編集できません。', 403);
                }
                // 種類（業務・休み・プライベート）は、あとから変えられる。ただし、変えられるのは持ち主だけ
                $newKind = (string)($in['kind'] ?? $existing['kind']);
                if (!in_array($newKind, ['work', 'off', 'private'], true)) {
                    $newKind = $existing['kind'];
                }
                if ($newKind !== $existing['kind'] && (int)$existing['owner_id'] !== (int)$user['id']) {
                    api_fail('予定の種類を変えられるのは、予定の持ち主だけです。', 403);
                }
                $in['kind'] = $newKind;
            }
            [$data, $err] = validate_event_input($in, $user);
            if ($err) {
                api_fail($err);
            }
            $saved = save_event($data, $user, $existing);
            // 休みの登録（新規、または、ほかの種類から「休み」に変えたとき）は、Slackに通知する
            if ($saved['kind'] === 'off' && (!$existing || $existing['kind'] !== 'off')) {
                $owner = row('SELECT id,name,slack_id FROM users WHERE id = ?', [$saved['owner_id']]);
                notify_off_registered($saved, $owner, $user);
            }
            $saved['owner_name'] = (row('SELECT name FROM users WHERE id = ?', [$saved['owner_id']]))['name'];
            api_out(['event' => event_for_client($saved, $user)]);

        case 'event_duplicate':
            $src = find_event((int)($in['id'] ?? 0), $user);
            if (!$src) {
                api_fail('予定が見つかりません。', 404);
            }
            if (!can_edit_event($src, $user)) {
                api_fail('この予定は複製できません。', 403);
            }
            $dates = is_array($in['dates'] ?? null) ? array_values(array_filter($in['dates'], 'is_string')) : [];
            if (!$dates || count($dates) > 31) {
                api_fail('複製先の日付を1〜31件で指定してください。');
            }
            foreach ($dates as $d) {
                if (!valid_date($d)) {
                    api_fail('日付を正しく入力してください。');
                }
            }
            [$created, $skipped] = duplicate_event($src, $dates, $user);
            if ($created && $src['kind'] === 'off') {
                $owner = row('SELECT id,name,slack_id FROM users WHERE id = ?', [$src['owner_id']]);
                notify_offs_registered($created, $owner, $user);
            }
            api_out(['created' => count($created), 'skipped' => $skipped]);

        case 'event_move':
            $e = find_event((int)($in['id'] ?? 0), $user);
            if (!$e) {
                api_fail('予定が見つかりません。', 404);
            }
            if (!can_edit_event($e, $user)) {
                api_fail('この予定は動かせません。', 403);
            }
            $to = (string)($in['start'] ?? '');
            if (!valid_date($to)) {
                api_fail('日付を正しく入力してください。');
            }
            $moved = move_event($e, $to);
            api_out(['ok' => true, 'start' => $moved['start_date'], 'end' => $moved['end_date']]);

        case 'todo_list':
            $tv = ($_GET['view'] ?? 'me') === 'team' ? 'team' : 'me';
            $rev = data_rev();
            api_out(['todos' => list_todos($user, $tv), 'done' => list_done_todos($user, $tv), 'rev' => $rev]);

        case 'todo_done':
            $t = find_todo((int)($in['id'] ?? 0), $user);
            if (!$t) {
                api_fail('ToDoが見つかりません。', 404);
            }
            set_todo_done($t, !empty($in['done']));
            api_out(['ok' => true]);

        case 'todo_status':
            $t = find_todo((int)($in['id'] ?? 0), $user);
            if (!$t) {
                api_fail('ToDoが見つかりません。', 404);
            }
            $st = (string)($in['status'] ?? '');
            if (!in_array($st, ['todo', 'doing', 'done'], true)) {
                api_fail('状態は「未着手・進行中・完了」のどれかです。');
            }
            set_todo_status($t, $st);
            if ($st !== 'done' && is_array($in['ids'] ?? null)) {
                reorder_todos($in['ids'], $user); // 移した先の列での並び
            }
            api_out(['ok' => true]);

        case 'todo_clear_done':
            api_out(['deleted' => clear_done_todos($user, ($in['view'] ?? 'me') === 'team' ? 'team' : 'me')]);

        case 'todo_save':
            $existing = null;
            if (!empty($in['id'])) {
                $existing = find_todo((int)$in['id'], $user);
                if (!$existing) {
                    api_fail('ToDoが見つかりません。', 404);
                }
            }
            [$data, $err] = validate_todo_input($in);
            if ($err) {
                api_fail($err);
            }
            api_out(['todo' => todo_for_client(save_todo($data, $user, $existing))]);

        case 'share_list':
            $out = [];
            foreach (['family', 'company'] as $k) {
                if ($k === 'company' && !is_admin($user)) {
                    continue;
                }
                $l = share_link_get($k, $user);
                $out[] = ['kind' => $k, 'path' => $l ? 'share.php?t=' . $l['token'] : null, 'created_at' => $l ? $l['created_at'] : null];
            }
            api_out(['links' => $out, 'family_share' => get_family_share($user)]);

        case 'share_options':
            api_out(['family_share' => save_family_share($user, !empty($in['off']), is_array($in['tags'] ?? null) ? $in['tags'] : [])]);

        case 'share_create':
            try {
                $l = share_link_create((string)($in['kind'] ?? ''), $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage(), 403);
            }
            api_out(['kind' => $l['kind'], 'path' => 'share.php?t=' . $l['token']]);

        case 'share_revoke':
            try {
                share_link_revoke((string)($in['kind'] ?? ''), $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage(), 403);
            }
            api_out(['ok' => true]);

        case 'memo_get':
            api_out(['html' => get_memo($user)]);

        case 'memo_save':
            try {
                save_memo((string)($in['html'] ?? ''), $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            api_out(['ok' => true, 'saved_at' => date('H:i')]);

        case 'todo_reorder':
            reorder_todos(is_array($in['ids'] ?? null) ? $in['ids'] : [], $user);
            api_out(['ok' => true]);

        case 'todo_delete':
            $t = find_todo((int)($in['id'] ?? 0), $user);
            if (!$t) {
                api_fail('ToDoが見つかりません。', 404);
            }
            q('DELETE FROM todos WHERE id = ?', [$t['id']]);
            api_out(['ok' => true]);

        case 'todo_schedule':
            $t = find_todo((int)($in['id'] ?? 0), $user);
            if (!$t) {
                api_fail('ToDoが見つかりません。', 404);
            }
            $date = (string)($in['date'] ?? '');
            if (!valid_date($date)) {
                api_fail('日付を正しく入力してください。');
            }
            try {
                $ev = schedule_todo($t, $date, $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            api_out(['ok' => true, 'event_id' => (int)$ev['id']]);

        case 'event_to_todo':
            $e = find_event((int)($in['id'] ?? 0), $user);
            if (!$e) {
                api_fail('予定が見つかりません。', 404);
            }
            if (!can_edit_event($e, $user)) {
                api_fail('この予定はToDoに戻せません。', 403);
            }
            try {
                $todo = event_to_todo($e, $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            api_out(['ok' => true, 'todo' => todo_for_client($todo)]);

        case 'event_delete':
            $e = find_event((int)($in['id'] ?? 0), $user);
            if (!$e) {
                api_fail('予定が見つかりません。', 404);
            }
            if (!can_edit_event($e, $user)) {
                api_fail('この予定は削除できません。', 403);
            }
            delete_event($e);
            api_out(['ok' => true]);

        case 'series_list':
            $list = rows('SELECT s.*, u.name AS owner_name FROM series s JOIN users u ON u.id = s.owner_id ORDER BY s.title');
            api_out(['series' => array_map(function ($s) use ($user, $cal) {
                return series_for_client($s, $user, $cal);
            }, $list)]);

        case 'series_preview':
            [$s, $err] = validate_series_input($in);
            if ($err) {
                api_fail($err);
            }
            api_out(['preview' => series_preview($s, 7, $cal), 'label' => rule_label($s)]);

        case 'series_save':
            [$s, $err] = validate_series_input($in);
            if ($err) {
                api_fail($err);
            }
            if (!empty($in['id'])) {
                $cur = row('SELECT * FROM series WHERE id = ?', [(int)$in['id']]);
                if (!$cur) {
                    api_fail('ルールが見つかりません。', 404);
                }
                if ((int)$cur['owner_id'] !== (int)$user['id'] && !is_admin($user)) {
                    api_fail('このルールは編集できません。', 403);
                }
                q('UPDATE series SET title=?, tag=?, rule_type=?, p_day=?, p_day2=?, p_nth=?, p_weekday=?, p_count=?, shift=?, bizonly=?, start_time=?, end_time=? WHERE id=?', [
                    $s['title'], $s['tag'], $s['rule_type'], $s['p_day'], $s['p_day2'], $s['p_nth'], $s['p_weekday'], $s['p_count'], $s['shift'], $s['bizonly'],
                    $s['start_time'], $s['end_time'], $cur['id'],
                ]);
                $sid = (int)$cur['id'];
            } else {
                q('INSERT INTO series (owner_id,title,tag,rule_type,p_day,p_day2,p_nth,p_weekday,p_count,shift,bizonly,start_time,end_time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
                    $user['id'], $s['title'], $s['tag'], $s['rule_type'], $s['p_day'], $s['p_day2'], $s['p_nth'], $s['p_weekday'], $s['p_count'], $s['shift'], $s['bizonly'],
                    $s['start_time'], $s['end_time'], now_str(),
                ]);
                $sid = (int)db()->lastInsertId();
            }
            $n = materialize_series($sid, $cal);
            api_out(['ok' => true, 'id' => $sid, 'created_or_updated' => $n]);

        case 'series_delete':
            $cur = row('SELECT * FROM series WHERE id = ?', [(int)($in['id'] ?? 0)]);
            if (!$cur) {
                api_fail('ルールが見つかりません。', 404);
            }
            if ((int)$cur['owner_id'] !== (int)$user['id'] && !is_admin($user)) {
                api_fail('このルールは削除できません。', 403);
            }
            delete_series((int)$cur['id']);
            api_out(['ok' => true]);

        case 'series_seed':
            if (row('SELECT id FROM series LIMIT 1')) {
                api_fail('すでにルールが登録されています。');
            }
            foreach (EXAMPLE_SERIES as $ex) {
                $s = array_merge(['tag' => '定例業務', 'p_day' => null, 'p_day2' => null, 'p_nth' => null, 'p_weekday' => null, 'p_count' => null,
                    'shift' => 'none', 'bizonly' => 0, 'start_time' => '', 'end_time' => ''], $ex);
                q('INSERT INTO series (owner_id,title,tag,rule_type,p_day,p_day2,p_nth,p_weekday,p_count,shift,bizonly,start_time,end_time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
                    $user['id'], $s['title'], $s['tag'], $s['rule_type'], $s['p_day'], $s['p_day2'], $s['p_nth'], $s['p_weekday'], $s['p_count'], $s['shift'], $s['bizonly'],
                    $s['start_time'], $s['end_time'], now_str(),
                ]);
                materialize_series((int)db()->lastInsertId(), $cal);
            }
            api_out(['ok' => true]);

        case 'password_change':
            $me = row('SELECT * FROM users WHERE id = ?', [$user['id']]);
            $new = (string)($in['new_password'] ?? '');
            if (!password_verify((string)($in['current_password'] ?? ''), $me['password_hash'])) {
                api_fail('現在のパスワードが違います。');
            }
            if (mb_strlen($new) < 8) {
                api_fail('新しいパスワードは8文字以上にしてください。');
            }
            if (hash_equals((string)($in['current_password'] ?? ''), $new)) {
                api_fail('現在のパスワードとは別のパスワードにしてください。');
            }
            q('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $user['id']]);
            api_out(['ok' => true]);

        case 'users_list':
            require_admin($user);
            api_out(['users' => array_map(function ($u) {
                return ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'slack_id' => $u['slack_id'] ?? '', 'active' => (int)$u['active'], 'must_change_password' => (int)$u['must_change_password']];
            }, rows('SELECT id,name,email,role,slack_id,active,must_change_password FROM users ORDER BY id'))]);

        case 'user_save':
            require_admin($user);
            $name = trim((string)($in['name'] ?? ''));
            $email = strtolower(trim((string)($in['email'] ?? '')));
            $role = ($in['role'] ?? 'member') === 'admin' ? 'admin' : 'member';
            $slack = trim((string)($in['slack_id'] ?? ''));
            $active = isset($in['active']) ? ((int)$in['active'] ? 1 : 0) : 1;
            $pw = (string)($in['password'] ?? '');
            if ($name === '' || mb_strlen($name) > 60 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                api_fail('名前とメールアドレスを正しく入力してください。');
            }
            if ($slack !== '' && !preg_match('/^[UW][A-Z0-9]{6,}$/', $slack)) {
                api_fail('SlackのメンバーIDは U から始まる英数字です（例: U01ABCDEF23）。');
            }
            if (!empty($in['id'])) {
                $target = row('SELECT * FROM users WHERE id = ?', [(int)$in['id']]);
                if (!$target) {
                    api_fail('社員が見つかりません。', 404);
                }
                if ((int)$target['id'] === (int)$user['id'] && ($role !== 'admin' || !$active)) {
                    api_fail('自分自身の管理者権限と利用状態は変更できません。');
                }
                $dup = row('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $target['id']]);
                if ($dup) {
                    api_fail('そのメールアドレスは使われています。');
                }
                q('UPDATE users SET name=?, email=?, role=?, slack_id=?, active=? WHERE id=?', [$name, $email, $role, $slack ?: null, $active, $target['id']]);
                if ($pw !== '') {
                    if (mb_strlen($pw) < 8) {
                        api_fail('パスワードは8文字以上にしてください。');
                    }
                    // 管理者が決めたパスワードなので、本人が次にログインしたとき変更してもらう
                    q('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), (int)$target['id'] === (int)$user['id'] ? 0 : 1, $target['id']]);
                }
            } else {
                if (mb_strlen($pw) < 8) {
                    api_fail('パスワードは8文字以上にしてください。');
                }
                if (row('SELECT id FROM users WHERE email = ?', [$email])) {
                    api_fail('そのメールアドレスは使われています。');
                }
                create_user($name, $email, $pw, $role, $slack ?: null, true);
            }
            api_out(['ok' => true]);

        case 'holidays_list':
            api_out(['holidays' => rows('SELECT id, hdate, name FROM company_holidays ORDER BY hdate')]);

        case 'holiday_save':
            require_admin($user);
            $d = (string)($in['hdate'] ?? '');
            $d2 = (string)($in['hdate_end'] ?? '') !== '' ? (string)$in['hdate_end'] : $d; // 終了日が空なら、その1日だけ
            $name = trim((string)($in['name'] ?? ''));
            if (!valid_date($d) || !valid_date($d2) || $name === '' || mb_strlen($name) > 60) {
                api_fail('日付と名前を正しく入力してください。');
            }
            if ($d2 < $d) {
                api_fail('終了日は開始日以降にしてください。');
            }
            if (strtotime($d2) - strtotime($d) > 59 * 86400) {
                api_fail('一度に登録できるのは、60日間までです。');
            }
            $added = 0;
            for ($t = strtotime($d), $end = strtotime($d2); $t <= $end; $t = strtotime('+1 day', $t)) {
                $day = date('Y-m-d', $t);
                if (!row('SELECT id FROM company_holidays WHERE hdate = ?', [$day])) { // すでにある日は、そのまま
                    q('INSERT INTO company_holidays (hdate, name) VALUES (?, ?)', [$day, $name]);
                    $added++;
                }
            }
            materialize_all(); // 営業日が変わるので繰り返し予定を再計算
            api_out(['ok' => true, 'added' => $added]);

        case 'holiday_delete':
            require_admin($user);
            $ids = is_array($in['ids'] ?? null) ? $in['ids'] : [$in['id'] ?? 0]; // 続いた休みは、まとめて消せる
            foreach (array_slice($ids, 0, 100) as $hid) {
                q('DELETE FROM company_holidays WHERE id = ?', [(int)$hid]);
            }
            materialize_all();
            api_out(['ok' => true]);
    }
    api_fail('不明な操作です。', 404);
}

function require_admin(array $user): void
{
    if (!is_admin($user)) {
        api_fail('管理者のみ実行できます。', 403);
    }
}
