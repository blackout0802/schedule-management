<?php
// JSON API。画面（public/assets/app.js）からだけ呼ばれる。
// 読み取りは GET、変更は POST（X-CSRF-Token 必須）。

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/events.php';
require_once __DIR__ . '/slack.php';
require_once __DIR__ . '/backup.php';
require_once __DIR__ . '/share.php';
require_once __DIR__ . '/usage.php';
require_once __DIR__ . '/undo.php';
require_once __DIR__ . '/ical.php';

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
        'p_count' => $s['p_count'] === null ? null : (int)$s['p_count'], 'p_interval' => (int)($s['p_interval'] ?? 1), 'p_anchor' => ($s['p_anchor'] ?? null) ?: null,
        'shift' => $s['shift'], 'bizonly' => (int)$s['bizonly'], 'start_time' => $s['start_time'], 'end_time' => $s['end_time'], 'todo_auto' => (int)($s['todo_auto'] ?? 0) === 1,
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
        'shift' => 'none', 'bizonly' => 0, 'todo_auto' => !empty($in['todo_auto']) ? 1 : 0, 'p_interval' => 1, 'p_anchor' => null,
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
        case 'weekly':
            $s['p_weekday'] = $int('p_weekday', 0, 6);
            $s['p_interval'] = $int('p_interval', 1, 4) ?? 1;
            $anchor = trim((string)($in['p_anchor'] ?? ''));
            if ($anchor !== '' && !valid_date($anchor)) {
                return [null, '数え始める日を正しく入力してください。'];
            }
            $s['p_anchor'] = $anchor !== '' ? $anchor : date('Y-m-d');
            $sh = (string)($in['shift'] ?? 'none');
            $s['shift'] = in_array($sh, ['none', 'prev', 'next'], true) ? $sh : 'none';
            if ($s['p_weekday'] === null) {
                return [null, '曜日を選んでください。'];
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

/** GET（画面を開くだけ）でも使ってよい、読むだけの操作。これ以外は、POST（CSRFトークンの確認つき）だけ受け付ける */
const API_READ_ACTIONS = ['me', 'rev', 'events', 'todo_list', 'todo_comments', 'todo_file', 'share_list', 'slack_status', 'slack_cfg',
    'memo_get', 'memo_history', 'series_list', 'users_list', 'family_list', 'family_log_list', 'audit_list', 'holidays_list', 'usage_get', 'rooms_list'];

function handle_api(): void
{
    $user = current_user();
    if (!$user) {
        api_fail('ログインが必要です。', 401);
    }
    audit_set_actor($user); // 変更履歴に残す「操作した人」
    $action = (string)($_GET['action'] ?? '');
    $isPost = $_SERVER['REQUEST_METHOD'] === 'POST';
    if (!$isPost && !in_array($action, API_READ_ACTIONS, true)) {
        // 外のサイトのリンクを踏ませる（GET）だけで、書き換えられないようにする（CSRFの確認は POST だけにある）
        api_fail('この操作は、画面から行ってください。', 405);
    }
    $in = [];
    if ($isPost) {
        if (!csrf_valid($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
            api_fail('画面の有効期限が切れました。ページを再読み込みしてください。', 403);
        }
        if (strpos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') === 0) {
            $in = $_POST; // 画像つきのコメント（ファイルは $_FILES）
        } else {
            $in = json_decode((string)file_get_contents('php://input'), true);
            if (!is_array($in)) {
                api_fail('リクエストの形式が正しくありません。');
            }
        }
    }
    if ($action === 'rev') {
        // 画面の自動更新用。何も書き換えず、すぐ返す（待たせない・負担をかけない）
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        api_out(['rev' => data_rev(), 'build' => app_build()]);
    }
    $cal = BizCalendar::fromDb();

    // 初期パスワードのままの人は、パスワードを変更するまで他の操作ができない
    if ((int)$user['must_change_password'] === 1 && !in_array($action, ['me', 'password_change'], true)) {
        api_fail('最初にパスワードを変更してください。', 403);
    }

    // 家族のアカウントは、予定の閲覧・自分の予定の変更・パスワードの変更だけ（業務・社員・ToDo・会議室・設定などは、すべて使えない）
    if (is_family($user) && !in_array($action, FAMILY_ALLOWED_ACTIONS, true)) {
        api_fail('家族のアカウントでは使えない操作です。', 403);
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
                'family_owner_name' => is_family($user) ? (string)(row('SELECT name FROM users WHERE id = ?', [family_owner_id($user)])['name'] ?? '') : null, // 家族のアカウントのとき、持ち主の名前
                'family_owner_offmark' => is_family($user) ? get_prefs(['id' => family_owner_id($user)])['offmark']['me'] : null, // 家族のアカウントのとき、持ち主の休みの出し方（プライベート版の設定）
                'backup_alert' => is_admin($user) ? backup_alert_for_screen() : null, // 月1回の手動バックアップのお知らせ（管理者だけ）
                'prefs' => get_prefs($user),
                'work_tags' => cfg('work_tags'),
                'off_tags' => cfg('off_tags'),
                'users' => is_family($user) ? [] : array_map(function ($u) {
                    return ['id' => (int)$u['id'], 'name' => $u['name']];
                }, rows("SELECT id, name FROM users WHERE active = 1 AND role <> 'family' ORDER BY name")),
            ]);

        case 'events':
            $from = (string)($_GET['from'] ?? '');
            $to = (string)($_GET['to'] ?? '');
            if (!valid_date($from) || !valid_date($to) || $to < $from || strtotime($to) - strtotime($from) > 100 * 86400) {
                api_fail('期間が正しくありません。');
            }
            $rev = data_rev(); // データを読む前の番号（読んでいる間に更新されても、次の確認で見つかるように）
            $view = ($_GET['view'] ?? 'team') === 'me' || is_family($user) ? 'me' : 'team'; // 家族のアカウントは、いつも、プライベート版
            $holidays = holiday_map($from, $to);
            $out = [
                'events' => list_events($user, $from, $to, $view, ['who' => ctype_digit((string)($_GET['who'] ?? '')) ? (int)$_GET['who'] : 0]),
                'holidays' => $holidays,
                'rev' => $rev,
            ];
            if ($view === 'team') { // 会議室の予約も、カレンダーに出す（全社は全部、特定の人は、その人が予約した・参加者の予約）
                $out['rooms'] = rooms_list_for_calendar($from, $to, $user, ctype_digit((string)($_GET['who'] ?? '')) ? (int)$_GET['who'] : 0);
                $out['room_defs'] = rooms_for_client(false);
            }
            $sum = (string)($_GET['sum'] ?? ''); // 表示している月（YYYY-MM）。あれば、その月の自分の出勤日・休みの日数も返す
            if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $sum) && !is_family($user)) {
                $out['summary'] = month_summary_multi(summary_users($user, $view, ctype_digit((string)($_GET['who'] ?? '')) ? (int)$_GET['who'] : 0), $sum);
            }
            api_out($out);

        case 'event_save':
            if (is_family($user)) { // 家族の予定は、いつも、プライベート（持ち主の家族に共有）。ToDo・持ち主の指定は受け付けない
                $in['kind'] = 'private';
                $in['family_shared'] = 1;
                unset($in['owner_id']);
                $in['todo_status'] = '';
            }
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
            if ($existing && ($saved['todo_id'] ?? null) !== null) {
                event_sync_todo($saved); // ToDoから置いた予定を編集したら、元のToDoの件名・メモなども同じにする
                if ($saved['kind'] === 'off') {
                    $saved['todo_id'] = null;
                }
            }
            $todoMade = event_attach_todo($saved, $user, (string)($in['todo_status'] ?? '')); // 「ToDoリストにも入れる」が選ばれていたら、ToDoも作る
            if ($todoMade) {
                $saved['todo_id'] = (int)$todoMade['id'];
                $saved['todo_done_at'] = $todoMade['done_at'];
                $saved['todo_doing'] = $todoMade['doing'];
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
            series_make_todos(null, (int)$user['id']); // 「毎回ToDoにも入れる」の繰り返し業務で、そろそろ実施日が近い回の ToDo を作る（cron がなくても、開けば作られる）
            $rev = data_rev();
            $out = ['todos' => list_todos($user, $tv), 'done' => list_done_todos($user, $tv), 'rev' => $rev];
            if ($tv === 'team') {
                $out['others'] = list_others_todos($user); // 業務のToDoは、全員に見える（見るだけ）
            }
            api_out($out);

        case 'todo_comments': // ToDoのコメント一覧（業務のToDoは全員、プライベートは本人だけ）
            $t = todo_for_comments((int)($_GET['id'] ?? 0), $user);
            if (!$t) {
                api_fail('ToDoが見つかりません。', 404);
            }
            api_out(['comments' => todo_comments_list($t, $user), 'todo' => ['id' => (int)$t['id'], 'title' => $t['title'], 'kind' => $t['kind'], 'owner_id' => (int)$t['owner_id'], 'owner_name' => $t['owner_name'], 'status' => todo_status_of($t)]]);

        case 'todo_comment_add':
            $t = todo_for_comments((int)($in['id'] ?? 0), $user);
            if (!$t) {
                api_fail('ToDoが見つかりません。', 404);
            }
            [$ok, $err] = todo_comment_add($t, $user, (string)($in['body'] ?? ''));
            if ($err) {
                api_fail($err);
            }
            api_out(['ok' => true, 'comment_id' => $ok['id']]);

        case 'todo_comment_upload': // 画像つきのコメント（multipart）。画像は3枚まで。画像だけ（文字なし）でもよい
            $t = todo_for_comments((int)($in['id'] ?? 0), $user);
            if (!$t) {
                api_fail('ToDoが見つかりません。', 404);
            }
            $up = [];
            $fl = $_FILES['files'] ?? null;
            if ($fl && is_array($fl['name'] ?? null)) {
                foreach ($fl['name'] as $i => $nm) {
                    if (($fl['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
                        continue;
                    }
                    $up[] = ['name' => $nm, 'tmp_name' => $fl['tmp_name'][$i], 'error' => $fl['error'][$i], 'size' => $fl['size'][$i]];
                }
            }
            if (count($up) > ATTACH_MAX_PER_COMMENT) {
                api_fail('1つのコメントに付けられる画像は、' . ATTACH_MAX_PER_COMMENT . '枚までです。');
            }
            try {
                $proc = array_map('attach_process', $up); // 先に全部を検査する（1枚でもだめなら、何も保存しない）
                [$ok, $err] = todo_comment_add($t, $user, (string)($in['body'] ?? ''), count($proc));
                if ($err) {
                    api_fail($err);
                }
                foreach ($proc as $p) {
                    attach_store((int)$ok['id'], (int)$t['id'], $p);
                }
            } catch (AttachException $x) {
                api_fail($x->getMessage());
            }
            api_out(['ok' => true, 'comment_id' => $ok['id']]);

        case 'todo_file': // コメントの画像（見てよいToDoのものだけ）
            $f = attach_find((int)($_GET['id'] ?? 0), $user);
            if (!$f || !empty($f['missing'])) {
                http_response_code(404);
                header('Content-Type: text/plain; charset=utf-8');
                exit('画像が見つかりません。');
            }
            if (session_status() === PHP_SESSION_ACTIVE) {
                session_write_close();
            }
            header('Content-Type: ' . $f['mime']);
            header('Content-Length: ' . (int)filesize(attach_dir() . '/' . $f['stored']));
            header('Content-Disposition: inline; filename="image-' . (int)$f['id'] . '.' . (preg_replace('/^.*\./', '', $f['stored'])) . '"');
            header('Cache-Control: private, no-store'); // ToDoを非公開にした・消したあとも、見えたまま残らないように
            readfile(attach_dir() . '/' . $f['stored']);
            exit;

        case 'todo_comment_delete':
            if (!todo_comment_delete((int)($in['id'] ?? 0), $user)) {
                api_fail('このコメントは、削除できません。', 403);
            }
            api_out(['ok' => true]);

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
            if (!in_array($st, ['todo', 'doing', 'hold', 'done'], true)) {
                api_fail('状態は「未着手・進行中・保留・完了」のどれかです。');
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
            api_out(['links' => $out, 'family_share' => get_family_share($user), 'ical' => ical_links_for($user)]);

        case 'share_options':
            api_out(['family_share' => save_family_share($user, !empty($in['off']), is_array($in['tags'] ?? null) ? $in['tags'] : [])]);

        case 'slack_status': // Slack通知の状態（管理者）
            require_admin($user);
            api_out(['slack' => slack_status()]);

        case 'slack_add': // 送り先を、チャンネル名を付けて登録する（管理者）
            require_admin($user);
            try {
                $nd = slack_dest_add((string)($in['name'] ?? ''), trim((string)($in['webhook'] ?? '')));
            } catch (RuntimeException $e) {
                api_fail($e->getMessage());
            }
            audit_log('slack', 'add', '送り先を追加: ' . $nd['name'], '', 'Webhook URL は記録しません');
            api_out(['slack' => slack_status()]);

        case 'slack_delete': // 登録した送り先を消す（管理者）
            require_admin($user);
            $dn = '';
            foreach (slack_dests() as $dd) { if ($dd['id'] === (string)($in['id'] ?? '')) { $dn = $dd['name']; } }
            try {
                slack_dest_delete((string)($in['id'] ?? ''));
            } catch (RuntimeException $e) {
                api_fail($e->getMessage());
            }
            audit_log('slack', 'delete', '送り先を削除: ' . $dn);
            api_out(['slack' => slack_status()]);

        case 'slack_use': // 使う送り先を選ぶ（管理者）
            require_admin($user);
            try {
                slack_dest_use((string)($in['id'] ?? ''));
            } catch (RuntimeException $e) {
                api_fail($e->getMessage());
            }
            audit_log('slack', 'update', '通知の送り先を切り替え', '', '→ ' . slack_status()['active_name']);
            api_out(['slack' => slack_status()]);

        case 'slack_cfg': // 通知の時間・文面の設定（管理者）
            require_admin($user);
            api_out(['cfg' => slack_cfg(), 'defaults' => slack_cfg_defaults(), 'placeholders' => SLACK_PLACEHOLDERS, 'preview' => slack_preview(slack_cfg())]);

        case 'slack_cfg_preview': // 保存前の入力のまま、文面の見本を返す（管理者）
            require_admin($user);
            try {
                api_out(['preview' => slack_preview(slack_cfg_clean(is_array($in['cfg'] ?? null) ? $in['cfg'] : []))]);
            } catch (RuntimeException $e) {
                api_out(['error' => $e->getMessage()]);
            }

        case 'slack_cfg_save': // 通知の時間・文面を保存する（管理者）
            require_admin($user);
            try {
                $c = slack_cfg_save(is_array($in['cfg'] ?? null) ? $in['cfg'] : []);
            } catch (RuntimeException $e) {
                api_fail($e->getMessage());
            }
            audit_log('slack', 'update', '通知の時間・文面を変更', '', '朝 ' . ($c['morning']['on'] ? $c['morning']['time'] : 'オフ') . '／夕方 ' . ($c['evening']['on'] ? $c['evening']['time'] : 'オフ') . '／休みなし通知 ' . ($c['empty']['on'] ? 'オン' : 'オフ'));
            api_out(['cfg' => $c, 'preview' => slack_preview($c)]);

        case 'slack_test': // テスト通知を送る（管理者）
            require_admin($user);
            if (!slack_enabled()) {
                api_fail('送り先（Webhook URL）がまだ設定されていません。', 400);
            }
            $kind = in_array($in['kind'] ?? 'simple', ['morning', 'evening'], true) ? $in['kind'] : 'simple';
            api_out(['result' => slack_post_detailed(slack_test_message($kind, $user)), 'kind' => $kind]);

        case 'offmark_save': // 自分の休みの出し方（業務版・プライベート版ごと。本人の画面と、家族用リンク・家族の画面）
            api_out(['prefs' => save_offmark_pref($user, is_array($in['offmark'] ?? null) ? $in['offmark'] : [])]);

        case 'prefs_save': // 予定の色（本人の画面だけ）
            api_out(['prefs' => save_color_prefs($user, is_array($in['colors'] ?? null) ? $in['colors'] : [], array_key_exists('offday', $in) ? $in['offday'] : null)]);

        case 'share_create':
            try {
                $l = share_link_create((string)($in['kind'] ?? ''), $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage(), 403);
            }
            audit_log('share', 'add', ($l['kind'] === 'company' ? '会社用' : '家族用') . 'リンクを作成（作り直し）', $l['kind'] === 'family' ? $user['name'] : '');
            api_out(['kind' => $l['kind'], 'path' => 'share.php?t=' . $l['token']]);

        case 'ical_create': // カレンダー購読のURLを作る（作り直す）
            try {
                $l = ical_link_create((string)($in['kind'] ?? ''), $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage(), 403);
            }
            $kn = ['me' => '自分用', 'family' => '家族用', 'company' => '会社用'][(string)$in['kind']];
            audit_log('share', 'add', 'カレンダー購読URL（' . $kn . '）を作成（作り直し）', $in['kind'] === 'company' ? '' : $user['name']);
            api_out(['kind' => (string)$in['kind'], 'path' => 'ical.php?t=' . $l['token']]);

        case 'ical_revoke':
            try {
                ical_link_revoke((string)($in['kind'] ?? ''), $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage(), 403);
            }
            $kn = ['me' => '自分用', 'family' => '家族用', 'company' => '会社用'][(string)($in['kind'] ?? '')] ?? '';
            audit_log('share', 'delete', 'カレンダー購読URL（' . $kn . '）を停止', ($in['kind'] ?? '') === 'company' ? '' : $user['name']);
            api_out(['ok' => true]);

        case 'share_revoke':
            try {
                share_link_revoke((string)($in['kind'] ?? ''), $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage(), 403);
            }
            audit_log('share', 'delete', (($in['kind'] ?? '') === 'company' ? '会社用' : '家族用') . 'リンクを停止', ($in['kind'] ?? '') === 'family' ? $user['name'] : '');
            api_out(['ok' => true]);

        case 'memo_get':
            api_out(get_memo_state($user));

        case 'memo_save':
            if (!isset($in['html']) || !is_string($in['html'])) {
                api_fail('日報の内容がありません。');
            }
            try {
                save_memo($in['html'], $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            api_out(['ok' => true, 'saved_at' => date('H:i')]);

        case 'memo_template_save':
            if (!isset($in['html']) || !is_string($in['html'])) {
                api_fail('雛形の内容がありません。');
            }
            try {
                $tpl = memo_template_save($in['html'], $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            api_out(['ok' => true, 'tpl' => $tpl]);

        case 'memo_history':
            $h = memo_history_get((string)($_GET['day'] ?? ''), $user);
            if ($h === null) {
                api_fail('その日の日報はありません。', 404);
            }
            api_out(['html' => $h]);

        case 'todo_reorder':
            reorder_todos(is_array($in['ids'] ?? null) ? $in['ids'] : [], $user);
            api_out(['ok' => true]);

        case 'todo_delete':
            $t = find_todo((int)($in['id'] ?? 0), $user);
            if (!$t) {
                api_fail('ToDoが見つかりません。', 404);
            }
            $hasComments = (int)row('SELECT COUNT(*) AS c FROM todo_comments WHERE todo_id = ?', [$t['id']])['c'] > 0;
            $undo = $hasComments ? null : undo_stash('todo', ['todo' => $t, 'events' => array_map('intval', array_column(rows('SELECT id FROM events WHERE todo_id = ?', [$t['id']]), 'id'))]); // コメントのあるToDoは、戻せない
            todo_detach_events('SELECT id FROM todos WHERE id = ?', [$t['id']]);
            todo_comments_purge('SELECT id FROM todos WHERE id = ?', [$t['id']]);
            q('DELETE FROM todos WHERE id = ?', [$t['id']]);
            api_out(['ok' => true, 'undo' => $undo]);

        case 'todo_restore': // 消したToDoを戻す（「元に戻す」）
            $snap = undo_take((string)($in['undo'] ?? ''), 'todo');
            if (!$snap) {
                api_fail('元に戻せる時間（10分）が過ぎたか、すでに戻しました。', 410);
            }
            try {
                $back = undo_todo_restore($snap, $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            api_out(['ok' => true, 'todo' => todo_for_client($back)]);

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
            $undo = undo_stash('event', $e); // 消した直後なら、「元に戻す」で戻せるように、控える
            delete_event($e);
            $forgot = !empty($in['forget_log']) ? family_log_forget_event((int)$e['owner_id'], (int)$e['id']) : 0; // 家族の更新履歴にも残さない
            api_out(['ok' => true, 'undo' => $undo, 'forgot' => $forgot]);

        case 'event_restore': // 消した予定を戻す（「元に戻す」）
            $snap = undo_take((string)($in['undo'] ?? ''), 'event');
            if (!$snap) {
                api_fail('元に戻せる時間（10分）が過ぎたか、すでに戻しました。', 410);
            }
            try {
                $back = undo_event_restore($snap, $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            $back['owner_name'] = (row('SELECT name FROM users WHERE id = ?', [$back['owner_id']]))['name'];
            api_out(['ok' => true, 'event' => event_for_client($back, $user)]);

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
                q('UPDATE series SET title=?, tag=?, rule_type=?, p_day=?, p_day2=?, p_nth=?, p_weekday=?, p_count=?, shift=?, bizonly=?, start_time=?, end_time=?, todo_auto=?, p_interval=?, p_anchor=? WHERE id=?', [
                    $s['title'], $s['tag'], $s['rule_type'], $s['p_day'], $s['p_day2'], $s['p_nth'], $s['p_weekday'], $s['p_count'], $s['shift'], $s['bizonly'],
                    $s['start_time'], $s['end_time'], $s['todo_auto'], $s['p_interval'], $s['p_anchor'], $cur['id'],
                ]);
                $sid = (int)$cur['id'];
            } else {
                q('INSERT INTO series (owner_id,title,tag,rule_type,p_day,p_day2,p_nth,p_weekday,p_count,shift,bizonly,start_time,end_time,todo_auto,p_interval,p_anchor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
                    $user['id'], $s['title'], $s['tag'], $s['rule_type'], $s['p_day'], $s['p_day2'], $s['p_nth'], $s['p_weekday'], $s['p_count'], $s['shift'], $s['bizonly'],
                    $s['start_time'], $s['end_time'], $s['todo_auto'], $s['p_interval'], $s['p_anchor'], now_str(),
                ]);
                $sid = (int)db()->lastInsertId();
            }
            $n = materialize_series($sid, $cal);
            $so = row('SELECT name FROM users WHERE id = ?', [empty($cur) ? $user['id'] : $cur['owner_id']]);
            audit_log('series', empty($in['id']) ? 'add' : 'update', $s['title'], $so ? $so['name'] : '', empty($cur) ? '' : ($cur['title'] !== $s['title'] ? '名前「' . $cur['title'] . '」→「' . $s['title'] . '」' : 'ルールを変更'));
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
            $so = row('SELECT name FROM users WHERE id = ?', [$cur['owner_id']]);
            audit_log('series', 'delete', $cur['title'], $so ? $so['name'] : '');
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
            audit_log('series', 'add', '例のルール ' . count(EXAMPLE_SERIES) . '件をまとめて登録', $user['name']);
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
            $_SESSION['pwv'] = substr((string)row('SELECT password_hash FROM users WHERE id = ?', [$user['id']])['password_hash'], 7, 22); // この端末は、そのまま使い続けられる
            audit_log('security', 'update', '自分のパスワードを変更', $user['name']);
            api_out(['ok' => true]);

        case 'users_list':
            require_admin($user);
            api_out(['users' => array_map(function ($u) {
                return ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'active' => (int)$u['active'], 'must_change_password' => (int)$u['must_change_password']];
            }, rows("SELECT id,name,email,role,active,must_change_password FROM users WHERE role <> 'family' ORDER BY id"))]);

        case 'user_save':
            require_admin($user);
            $name = trim((string)($in['name'] ?? ''));
            $email = strtolower(trim((string)($in['email'] ?? '')));
            $role = ($in['role'] ?? 'member') === 'admin' ? 'admin' : 'member';
            $active = isset($in['active']) ? ((int)$in['active'] ? 1 : 0) : 1;
            $pw = (string)($in['password'] ?? '');
            if ($name === '' || mb_strlen($name) > 60 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                api_fail('名前とメールアドレスを正しく入力してください。');
            }
            if (!empty($in['id'])) {
                $target = row("SELECT * FROM users WHERE id = ? AND role <> 'family'", [(int)$in['id']]); // 家族のアカウントは、持ち主だけが管理する
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
                q('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=?', [$name, $email, $role, $active, $target['id']]);
                $ch = [];
                if ($target['name'] !== $name) { $ch[] = '名前「' . $target['name'] . '」→「' . $name . '」'; }
                if ($target['email'] !== $email) { $ch[] = 'メールアドレスを変更'; }
                if ($target['role'] !== $role) { $ch[] = '権限 ' . ($target['role'] === 'admin' ? '管理者' : '一般') . ' → ' . ($role === 'admin' ? '管理者' : '一般'); }
                if ((int)$target['active'] !== $active) { $ch[] = $active ? '利用を再開' : '利用を停止'; }
                if ($pw !== '') { $ch[] = 'パスワードを設定'; }
                if ($ch) { audit_log('user', 'update', $name, $name, implode('／', $ch)); }
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
                create_user($name, $email, $pw, $role, null, true);
                audit_log('user', 'add', $name, $name, '権限: ' . ($role === 'admin' ? '管理者' : '一般'));
            }
            api_out(['ok' => true]);

        case 'user_reset_password': // パスワードのリセット（管理者）。一時パスワードを作り、本人は次のログインで変更する
            require_admin($user);
            $tid = (int)($in['id'] ?? 0);
            if ($tid === (int)$user['id']) {
                api_fail('自分のパスワードは、「設定」の「パスワードの変更」で変えられます。');
            }
            if (user_id_is_family($tid)) {
                api_fail('家族のアカウントは、持ち主が管理します。', 403);
            }
            try {
                $tmp = reset_user_password($tid);
            } catch (RuntimeException $e) {
                api_fail($e->getMessage(), 404);
            }
            $tu = row('SELECT name FROM users WHERE id = ?', [$tid]);
            audit_log('user', 'reset', 'パスワードをリセット', $tu ? $tu['name'] : '', '一時パスワードを発行（次のログインで本人が変更）');
            api_out(['password' => $tmp]);

        case 'family_list': // 自分が招待した家族（持ち主だけ）
            api_out(['members' => family_members((int)$user['id']), 'max' => FAMILY_MAX]);

        case 'family_add': // 家族を招待する（アカウントを作り、一時パスワードを1度だけ返す）
            try {
                [$fid, $tmp] = family_add($user, (string)($in['name'] ?? ''), (string)($in['email'] ?? ''));
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            audit_log('user', 'add', '家族のアカウントを追加', $user['name'], '持ち主: ' . $user['name']); // 家族の名前は、管理者の履歴には残さない
            $mail = !empty($in['send_mail']) ? (family_invite_mail($user, trim((string)($in['name'] ?? '')), strtolower(trim((string)($in['email'] ?? ''))), $tmp) ? 'sent' : 'failed') : 'skipped'; // 招待メール（一時パスワードつき）。失敗しても、アカウントはできていて、画面に一時パスワードが出る
            api_out(['ok' => true, 'id' => $fid, 'password' => $tmp, 'mail' => $mail, 'members' => family_members((int)$user['id'])]);

        case 'family_name_save': // 家族のアカウントが、自分の表示名を変える（家族の名前は、管理者の履歴には残さない）
            try {
                $name = family_set_name($user, (string)($in['name'] ?? ''));
            } catch (RuntimeException $x) {
                api_fail($x->getMessage(), is_family($user) ? 400 : 403);
            }
            api_out(['ok' => true, 'name' => $name]);

        case 'family_reset_password': // 家族のパスワードをリセットする（一時パスワードを1度だけ返す）
            $m = family_member_of($user, (int)($in['id'] ?? 0));
            if (!$m) {
                api_fail('家族が見つかりません。', 404);
            }
            api_out(['password' => reset_user_password((int)$m['id'])]);

        case 'family_set_active': // 家族の利用を止める・再開する（止めると、ログインできず、予定も見えなくなる）
            $m = family_member_of($user, (int)($in['id'] ?? 0));
            if (!$m) {
                api_fail('家族が見つかりません。', 404);
            }
            q('UPDATE users SET active = ? WHERE id = ?', [empty($in['active']) ? 0 : 1, (int)$m['id']]);
            api_out(['ok' => true, 'members' => family_members((int)$user['id'])]);

        case 'family_delete': // 家族のアカウントを消す（その人の予定も消える）
            if (!family_delete($user, (int)($in['id'] ?? 0))) {
                api_fail('家族が見つかりません。', 404);
            }
            api_out(['ok' => true, 'members' => family_members((int)$user['id'])]);

        case 'family_log_list': // 自分の家族用リンクに見える更新履歴（持ち主が確認・削除するための一覧）
            api_out(family_event_log((int)$user['id'], 200));

        case 'family_log_delete': // 家族用の更新履歴を削除（自分の分だけ。1件、または、すべて）
            if (!empty($in['all'])) {
                $n = family_log_delete((int)$user['id'], null);
            } else {
                if (empty($in['id']) || !is_numeric($in['id'])) {
                    api_fail('削除する履歴を選んでください。');
                }
                $n = family_log_delete((int)$user['id'], (int)$in['id']);
            }
            if ($n > 0) {
                audit_log('share', 'delete', '家族用の更新履歴を削除', $user['name'], $n . '件'); // 中身（予定の件名）は、管理者の履歴には残さない
            }
            api_out(['ok' => true, 'deleted' => $n]);

        case 'backup_snooze': // 手動バックアップのお知らせを、7日間だけ消す（管理者）
            require_admin($user);
            backup_snooze(7);
            api_out(['ok' => true]);

        case 'usage_get': // 利用状況（管理者）: 最終ログイン・容量・バックアップ・cron・注意点
            require_admin($user);
            api_out(usage_report());

        case 'audit_list': // 変更履歴（管理者）
            require_admin($user);
            api_out(audit_list(['type' => (string)($_GET['type'] ?? ''), 'actor' => (int)($_GET['actor'] ?? 0), 'q' => (string)($_GET['q'] ?? ''), 'before' => (int)($_GET['before'] ?? 0), 'limit' => (int)($_GET['limit'] ?? 50)]) + ['types' => AUDIT_TYPES]);

        case 'audit_delete': // 変更履歴の削除（管理者）。1件／○日より前／すべて
            require_admin($user);
            if (!empty($in['all'])) {
                $n = audit_delete('all');
            } elseif (!empty($in['older_than_days'])) {
                if (!is_numeric($in['older_than_days']) || (int)$in['older_than_days'] < 1) {
                    api_fail('日数を正しく指定してください。');
                }
                $n = audit_delete('older', (int)$in['older_than_days']);
            } else {
                if (empty($in['id']) || !is_numeric($in['id'])) {
                    api_fail('削除する履歴を選んでください。');
                }
                $n = audit_delete('one', (int)$in['id']);
            }
            api_out(['ok' => true, 'deleted' => $n]);

        case 'rooms_list': // 会議室の一覧と、期間内の予約（非公開の予約は、本人と管理者以外には「予約済」とだけ見える）
            $from = (string)($_GET['from'] ?? '');
            $to = (string)($_GET['to'] ?? '');
            if (!valid_date($from) || !valid_date($to) || $to < $from || strtotime($to) - strtotime($from) > 100 * 86400) {
                api_fail('期間が正しくありません。');
            }
            $rev = data_rev();
            $closed = [];
            for ($t = strtotime($from), $end = strtotime($to); $t <= $end; $t = strtotime('+1 day', $t)) {
                $d = date('Y-m-d', $t);
                $why = rooms_closed_reason($d, $cal);
                if ($why !== null) {
                    $closed[$d] = $why;
                }
            }
            api_out(['rooms' => rooms_for_client(false), 'bookings' => rooms_list_bookings($from, $to, $user), 'closed' => (object)$closed,
                'cfg' => rooms_cfg(), 'kinds' => ROOM_KINDS, 'today' => date('Y-m-d'), 'now' => date('H:i'), 'rev' => $rev]);

        case 'room_booking_save':
            $existing = null;
            if (!empty($in['id'])) {
                $existing = row('SELECT * FROM room_bookings WHERE id = ?', [(int)$in['id']]);
                if (!$existing) {
                    api_fail('予約が見つかりません。', 404);
                }
                if (!rooms_can_edit($existing, $user)) {
                    api_fail(rooms_is_past($existing) ? '終了した予約は、変更できません。' : 'この予約を変更できるのは、予約した本人と管理者だけです。', 403);
                }
            }
            [$data, $err] = rooms_validate_input($in, $user, $existing);
            if ($err) {
                api_fail($err);
            }
            try {
                $saved = rooms_save($data, $user, $existing);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage(), 409);
            }
            $saved['owner_name'] = (row('SELECT name FROM users WHERE id = ?', [$saved['owner_id']]))['name'];
            api_out(['booking' => room_booking_for_client($saved, $user)]);

        case 'room_booking_delete':
            $b = row('SELECT * FROM room_bookings WHERE id = ?', [(int)($in['id'] ?? 0)]);
            if (!$b) {
                api_fail('予約が見つかりません。', 404);
            }
            if (!rooms_can_delete($b, $user)) {
                api_fail(rooms_is_past($b) ? '終了した予約は、取り消せません（管理者は取り消せます）。' : 'この予約を取り消せるのは、予約した本人と管理者だけです。', 403);
            }
            $undo = undo_stash('room_booking', $b); // 取り消した直後なら、「元に戻す」で戻せるように、控える
            rooms_delete($b);
            api_out(['ok' => true, 'undo' => $undo]);

        case 'room_booking_restore': // 取り消した予約を戻す（「元に戻す」）
            $snap = undo_take((string)($in['undo'] ?? ''), 'room_booking');
            if (!$snap) {
                api_fail('元に戻せる時間（10分）が過ぎたか、すでに戻しました。', 410);
            }
            try {
                $back = undo_room_restore($snap, $user);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            $back['owner_name'] = (row('SELECT name FROM users WHERE id = ?', [$back['owner_id']]))['name'];
            api_out(['ok' => true, 'booking' => room_booking_for_client($back, $user)]);

        case 'room_save': // 部屋の追加・変更（管理者）
            require_admin($user);
            try {
                $r = rooms_save_room($in);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            api_out(['ok' => true, 'id' => $r['id'], 'over' => $r['over']]);

        case 'rooms_cfg_save': // 予約の決まり・通知の時刻（管理者）
            require_admin($user);
            try {
                $cfgNew = rooms_cfg_save($in);
            } catch (RuntimeException $x) {
                api_fail($x->getMessage());
            }
            audit_log('room', 'update', '会議室の予約ルール｜先の予約 ' . $cfgNew['advance_months'] . 'か月・' . $cfgNew['open'] . '〜' . $cfgNew['close']);
            api_out(['ok' => true, 'cfg' => $cfgNew]);

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
            audit_log('holiday', 'add', $name . '　' . ($d === $d2 ? audit_md($d) : audit_md($d) . '〜' . audit_md($d2)), '', $added . '日分を追加');
            api_out(['ok' => true, 'added' => $added]);

        case 'holiday_delete':
            require_admin($user);
            $ids = is_array($in['ids'] ?? null) ? $in['ids'] : [$in['id'] ?? 0]; // 続いた休みは、まとめて消せる
            foreach (array_slice($ids, 0, 100) as $hid) {
                $hrow = row('SELECT hdate, name FROM company_holidays WHERE id = ?', [(int)$hid]);
                q('DELETE FROM company_holidays WHERE id = ?', [(int)$hid]);
                if ($hrow) { audit_log('holiday', 'delete', $hrow['name'] . '　' . audit_md($hrow['hdate'])); }
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
