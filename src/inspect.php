<?php
// 年間点検計画（Pマークなどの、定期的な点検業務。v1.108.0〜）。
//
//   inspection_items … 点検項目（名前・実施する月・期限・担当・確認者・アラート）。管理者が「会社の管理」で登録する
//   inspection_runs  … 月ごとの記録（項目 × 月 ごとに1行）。月の最初の営業日に、cron（notify）が起票する
//
// 起票すると、担当者の ToDo（【点検】項目名（○月分））を作り、期限の日をカレンダーに置く（予定は、ToDo と結びつく）。
// ToDo を完了にすると「実施済み」になり、確認者がいれば「確認待ち」、いなければそのまま「確認済み」になる。
// 年度は7月はじまり（INSPECT_FY_START）。年度の名前は、はじまりの年（2026年度 = 2026年7月〜2027年6月）。

const INSPECT_FY_START = 7;
const INSPECT_MAX_ITEMS = 60;
const INSPECT_TITLE_PREFIX = '【点検】';

/** 'YYYY-MM' が属する年度（はじまりの年） */
function inspect_fy_of(string $ym): int
{
    $y = (int)substr($ym, 0, 4);
    $m = (int)substr($ym, 5, 2);
    return $m >= INSPECT_FY_START ? $y : $y - 1;
}

/** 年度の12か月（'YYYY-MM'）。年度のはじまりの月から順に */
function inspect_fy_months(int $fy): array
{
    $out = [];
    for ($i = 0; $i < 12; $i++) {
        $m = INSPECT_FY_START + $i;
        $out[] = sprintf('%04d-%02d', $fy + ($m > 12 ? 1 : 0), (($m - 1) % 12) + 1);
    }
    return $out;
}

/** 月の番号（1〜12）の並びを、年度の順（7月はじまりなら 7,8,…,12,1,…,6）にそろえる */
function inspect_months_sorted(array $ms): array
{
    $ms = array_values(array_unique(array_filter(array_map('intval', $ms), function ($m) { return $m >= 1 && $m <= 12; })));
    usort($ms, function ($a, $b) {
        return (($a - INSPECT_FY_START + 12) % 12) <=> (($b - INSPECT_FY_START + 12) % 12);
    });
    return $ms;
}

function inspect_item_months(array $item): array
{
    return inspect_months_sorted(array_filter(explode(',', (string)$item['months']), 'strlen'));
}

function inspect_meta_get(string $key): string
{
    $r = row('SELECT meta_value FROM app_meta WHERE meta_key = ?', [$key]);
    return $r ? (string)$r['meta_value'] : '';
}

function inspect_meta_set(string $key, string $val): void
{
    q('DELETE FROM app_meta WHERE meta_key = ?', [$key]);
    q('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', [$key, $val]);
}

/** 期限の日。due_rule が 'last' ならその月の最終営業日、数字ならその日（休日なら前の営業日） */
function inspect_due_date(array $item, string $ym, BizCalendar $cal): string
{
    $rule = (string)$item['due_rule'];
    $y = (int)substr($ym, 0, 4);
    $m = (int)substr($ym, 5, 2);
    $last = (int)date('t', mktime(0, 0, 0, $m, 1, $y));
    $day = $rule === 'last' ? $last : max(1, min((int)$rule, $last));
    return $cal->shiftBack(sprintf('%04d-%02d-%02d', $y, $m, $day));
}

function inspect_due_label(array $item): string
{
    return (string)$item['due_rule'] === 'last' ? '月の最終営業日' : '月の' . (int)$item['due_rule'] . '日';
}

/** その月の最初の営業日（この日から、点検を起票する） */
function inspect_first_bizday(string $ym, BizCalendar $cal): string
{
    return $cal->shiftForward($ym . '-01');
}

/** 担当者・確認者に選べる社員か（有効な社員。家族のアカウントは選べない） */
function inspect_user_ok(int $id): bool
{
    return $id > 0 && row('SELECT id FROM users WHERE id = ? AND active = 1 AND role <> ?', [$id, 'family']) !== null;
}

/** @return array{0:?array,1:?string} */
function inspect_validate_item(array $in, ?array $existing = null): array
{
    $title = trim((string)($in['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 60) {
        return [null, '項目の名前を60文字以内で入力してください。'];
    }
    $plan = trim((string)($in['plan'] ?? ''));
    if ($plan === '') {
        $plan = 'Pマーク';
    }
    if (mb_strlen($plan) > 30) {
        return [null, '計画の名前は30文字以内にしてください。'];
    }
    $ms = $in['months'] ?? null;
    $ms = is_array($ms) ? $ms : array_filter(explode(',', (string)$ms), 'strlen');
    $months = inspect_months_sorted($ms);
    if (!$months) {
        return [null, '実施する月を1つ以上選んでください。'];
    }
    $due = (string)($in['due_rule'] ?? 'last');
    if ($due !== 'last' && !(ctype_digit($due) && (int)$due >= 1 && (int)$due <= 28)) {
        return [null, '期限は「最終営業日」か、1〜28日で選んでください。'];
    }
    $days = (int)($in['alert_days'] ?? 7);
    if ($days < 0 || $days > 30) {
        return [null, '事前のアラートは、期限の0〜30日前にしてください（0 は送らない）。'];
    }
    $owner = (int)($in['owner_id'] ?? 0);
    if (!inspect_user_ok($owner)) {
        return [null, '担当者を選んでください。'];
    }
    $checker = (int)($in['checker_id'] ?? 0);
    if ($checker > 0 && !inspect_user_ok($checker)) {
        return [null, '確認者を選び直してください。'];
    }
    if ($checker === $owner) {
        $checker = 0; // 担当者と同じ人は、確認者にしない（実施で確認済みになる）
    }
    $steps = trim(str_replace("\r", '', (string)($in['steps'] ?? '')));
    if (mb_strlen($steps) > 400) {
        return [null, '点検の手順は400文字以内にしてください。'];
    }
    $flag = function (string $k, int $def) use ($in) {
        return array_key_exists($k, $in) ? (!empty($in[$k]) ? 1 : 0) : $def;
    };
    return [[
        'plan' => $plan, 'title' => $title, 'months' => implode(',', $months), 'due_rule' => $due, 'alert_days' => $days,
        'alert_due' => $flag('alert_due', $existing ? (int)$existing['alert_due'] : 1),
        'alert_late' => $flag('alert_late', $existing ? (int)$existing['alert_late'] : 1),
        'alert_check' => $flag('alert_check', $existing ? (int)$existing['alert_check'] : 1),
        'owner_id' => $owner, 'checker_id' => $checker > 0 ? $checker : null, 'steps' => $steps,
        'need_attach' => $flag('need_attach', $existing ? (int)$existing['need_attach'] : 0),
        'active' => $flag('active', $existing ? (int)$existing['active'] : 1),
    ], null];
}

/**
 * 項目を変更・削除できるか。管理者と、その項目を登録した人。
 * 登録（追加）は、管理者でなくても、社員なら誰でもできる（マネージャーの代わりに、委任されて登録することがあるため）
 */
function inspect_can_edit(array $item, array $user): bool
{
    return is_admin($user) || ($item['created_by'] !== null && (int)$item['created_by'] === (int)$user['id']);
}

/** 項目を保存する（$by = 新しく登録した人の番号）。保存したあと、今月が実施月で、起票の日を過ぎていれば、すぐ起票する */
function inspect_item_save(array $data, ?array $existing, ?int $now = null, ?int $by = null): array
{
    if ($existing) {
        q('UPDATE inspection_items SET plan=?, title=?, months=?, due_rule=?, alert_days=?, alert_due=?, alert_late=?, alert_check=?, owner_id=?, checker_id=?, steps=?, need_attach=?, active=? WHERE id=?', [
            $data['plan'], $data['title'], $data['months'], $data['due_rule'], $data['alert_days'], $data['alert_due'], $data['alert_late'], $data['alert_check'],
            $data['owner_id'], $data['checker_id'], $data['steps'], $data['need_attach'], $data['active'], $existing['id'],
        ]);
        $id = (int)$existing['id'];
        if ((int)$existing['owner_id'] !== (int)$data['owner_id']) { // 担当者を変えたら、起票ずみで未実施の月の ToDo・予定も、新しい担当者に移す
            foreach (rows('SELECT todo_id FROM inspection_runs WHERE item_id = ? AND status = ? AND todo_id IS NOT NULL', [$id, 'open']) as $r) {
                q('UPDATE todos SET owner_id = ? WHERE id = ? AND done_at IS NULL', [$data['owner_id'], $r['todo_id']]);
                q('UPDATE events SET owner_id = ? WHERE todo_id = ?', [$data['owner_id'], $r['todo_id']]);
            }
        }
    } else {
        $max = row('SELECT MAX(sort_order) AS m FROM inspection_items');
        q('INSERT INTO inspection_items (plan, title, months, due_rule, alert_days, alert_due, alert_late, alert_check, owner_id, checker_id, steps, need_attach, active, sort_order, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
            $data['plan'], $data['title'], $data['months'], $data['due_rule'], $data['alert_days'], $data['alert_due'], $data['alert_late'], $data['alert_check'],
            $data['owner_id'], $data['checker_id'], $data['steps'], $data['need_attach'], $data['active'], (int)($max['m'] ?? 0) + 1, $by, now_str(),
        ]);
        $id = (int)db()->lastInsertId();
    }
    $item = row('SELECT * FROM inspection_items WHERE id = ?', [$id]);
    inspect_issue_current($item, $now);
    return $item;
}

/** 今月が実施月で、起票の日（その月の最初の営業日）を過ぎていれば、いま起票する（なければ作る） */
function inspect_issue_current(array $item, ?int $now = null, ?BizCalendar $cal = null): ?array
{
    if ((int)$item['active'] !== 1) {
        return null;
    }
    $now = $now ?? time();
    $cal = $cal ?? BizCalendar::fromDb();
    $ym = date('Y-m', $now);
    if (!in_array((int)substr($ym, 5, 2), inspect_item_months($item), true) || date('Y-m-d', $now) < inspect_first_bizday($ym, $cal)) {
        return null;
    }
    return inspect_issue($item, $ym, $cal);
}

/** 項目の、ある月の記録を作る（ToDo と、期限の日の予定も作る）。もうあれば、何もしない（null） */
function inspect_issue(array $item, string $ym, BizCalendar $cal): ?array
{
    if (row('SELECT id FROM inspection_runs WHERE item_id = ? AND ym = ?', [$item['id'], $ym])) {
        return null;
    }
    $due = inspect_due_date($item, $ym, $cal);
    try {
        q('INSERT INTO inspection_runs (item_id, ym, due_date, status, created_at) VALUES (?,?,?,?,?)', [$item['id'], $ym, $due, 'open', now_str()]);
    } catch (PDOException $e) {
        return null; // 同時に起票された
    }
    $runId = (int)db()->lastInsertId();
    $owner = row('SELECT * FROM users WHERE id = ? AND active = 1', [$item['owner_id']]);
    if ($owner) {
        $m = (int)substr($ym, 5, 2);
        $tags = cfg('work_tags');
        $tag = in_array('定例業務', $tags, true) ? '定例業務' : $tags[count($tags) - 1];
        $steps = trim((string)$item['steps']);
        $note = ($steps !== '' ? "点検の手順:\n" . $steps : '') . ((int)$item['need_attach'] === 1 ? ($steps !== '' ? "\n" : '') . '※完了にするとき、点検記録の添付が必要です（コメントに添付）' : '');
        $note = mb_substr($note, 0, 500);
        $title = INSPECT_TITLE_PREFIX . $item['title'] . '（' . $m . '月分）';
        $todo = save_todo(['kind' => 'work', 'title' => $title, 'tag' => $tag, 'note' => $note, 'family_shared' => 0, 'due_date' => $due], ['id' => (int)$owner['id']], null);
        // 期限の日をカレンダーに置く（ToDo と結びついた業務の予定）。自動で作るので、変更履歴には残さない
        q('INSERT INTO events (owner_id,title,kind,tag,start_date,end_date,start_time,end_time,note,family_shared,important,participants,series_id,ym,detached,created_by,created_at,updated_at,todo_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,0,?,?,?,?)', [
            $owner['id'], $title, 'work', $tag, $due, $due, '', '', $note, 0, 0, '', $owner['id'], now_str(), now_str(), $todo['id'],
        ]);
        q('UPDATE inspection_runs SET todo_id = ? WHERE id = ?', [$todo['id'], $runId]);
    }
    return row('SELECT * FROM inspection_runs WHERE id = ?', [$runId]);
}

/**
 * cron（notify）から呼ぶ。今月が実施月の項目を、起票の日（月の最初の営業日）から起票する。1日1回だけ調べる。
 * @return string[] 実行結果のメッセージ
 */
function inspect_issue_due(?int $now = null): array
{
    $now = $now ?? time();
    try {
        $today = date('Y-m-d', $now);
        if (inspect_meta_get('inspect_issued') === $today) {
            return [];
        }
        $cal = BizCalendar::fromDb();
        if ($today < inspect_first_bizday(date('Y-m', $now), $cal)) {
            return []; // まだ月の最初の営業日ではない
        }
        $n = 0;
        foreach (rows('SELECT * FROM inspection_items WHERE active = 1 ORDER BY sort_order, id') as $item) {
            if (inspect_issue_current($item, $now, $cal)) {
                $n++;
            }
        }
        inspect_meta_set('inspect_issued', $today);
        return $n > 0 ? ['年間点検: ' . $n . ' 件を起票しました'] : [];
    } catch (Throwable $e) {
        error_log('[schedule inspect] ' . $e->getMessage());
        return ['年間点検の起票でエラー: ' . $e->getMessage()];
    }
}

/** 記録の見た目の状態: done=確認済み / wait=確認待ち / now=今月・未実施 / late=期限を過ぎた */
function inspect_status_of(array $run, string $today): string
{
    if ($run['status'] === 'checked') {
        return 'done';
    }
    if ($run['status'] === 'done') {
        return 'wait';
    }
    return $run['due_date'] < $today ? 'late' : 'now';
}

function inspect_late_days(array $run, string $today): int
{
    return max(0, (int)round((strtotime($today) - strtotime($run['due_date'])) / 86400));
}

function inspect_run_for_client(array $run, array $item, string $today, array $user): array
{
    $st = inspect_status_of($run, $today);
    $admin = is_admin($user);
    $isOwner = (int)$item['owner_id'] === (int)$user['id'];
    $isChecker = $item['checker_id'] !== null && (int)$item['checker_id'] === (int)$user['id'];
    $files = 0;
    if (!empty($run['todo_alive'])) {
        $files = (int)row('SELECT COUNT(*) AS c FROM todo_comment_files WHERE todo_id = ?', [$run['todo_id']])['c'];
    }
    return [
        'ym' => $run['ym'], 'month' => (int)substr($run['ym'], 5, 2), 'status' => $st, 'run_id' => (int)$run['id'], 'due' => $run['due_date'],
        'done_at' => $run['done_at'] ?: null, 'done_by' => (string)($run['done_name'] ?? ''), 'checked_at' => $run['checked_at'] ?: null, 'checked_by' => (string)($run['checked_name'] ?? ''),
        'note' => (string)$run['note'], 'todo_id' => !empty($run['todo_alive']) ? (int)$run['todo_id'] : null, 'files' => $files,
        'late_days' => $st === 'late' ? inspect_late_days($run, $today) : 0,
        'can_done' => $run['status'] === 'open' && ($admin || $isOwner),
        'can_check' => $run['status'] === 'done' && ($admin || $isChecker),
        'can_reopen' => $run['status'] === 'done' ? ($admin || $isOwner) : ($run['status'] === 'checked' && $admin),
        'can_uncheck' => $run['status'] === 'checked' && $item['checker_id'] !== null && ($admin || $isChecker),
    ];
}

function inspect_item_for_client(array $item, array $user): array
{
    return [
        'id' => (int)$item['id'], 'plan' => $item['plan'], 'title' => $item['title'], 'months' => inspect_item_months($item),
        'due_rule' => (string)$item['due_rule'], 'due_label' => inspect_due_label($item), 'alert_days' => (int)$item['alert_days'],
        'alert_due' => (int)$item['alert_due'] === 1, 'alert_late' => (int)$item['alert_late'] === 1, 'alert_check' => (int)$item['alert_check'] === 1,
        'owner_id' => (int)$item['owner_id'], 'owner_name' => (string)($item['owner_name'] ?? ''),
        'checker_id' => $item['checker_id'] === null ? null : (int)$item['checker_id'], 'checker_name' => (string)($item['checker_name'] ?? ''),
        'steps' => (string)$item['steps'], 'need_attach' => (int)$item['need_attach'] === 1, 'active' => (int)$item['active'] === 1,
        'mine' => (int)$item['owner_id'] === (int)$user['id'] || ($item['checker_id'] !== null && (int)$item['checker_id'] === (int)$user['id']),
        'can_edit' => inspect_can_edit($item, $user), 'created_by_name' => (string)($item['created_by_name'] ?? ''),
    ];
}

/** 点検項目の一覧（会社の管理の登録画面用。やめた項目も含む） */
function inspect_items_all(array $user): array
{
    $out = [];
    foreach (rows('SELECT i.*, o.name AS owner_name, c.name AS checker_name, b.name AS created_by_name, (SELECT COUNT(*) FROM inspection_runs r WHERE r.item_id = i.id) AS runs FROM inspection_items i
        LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN users c ON c.id = i.checker_id LEFT JOIN users b ON b.id = i.created_by ORDER BY i.sort_order, i.id') as $item) {
        $c = inspect_item_for_client($item, $user);
        $c['runs'] = (int)$item['runs'];
        $out[] = $c;
    }
    return $out;
}

/** 年間計画の表（1年度分）。項目ごとに、年度の12か月のマス */
function inspect_overview(int $fy, array $user, ?int $now = null): array
{
    $now = $now ?? time();
    $today = date('Y-m-d', $now);
    $curYm = date('Y-m', $now);
    $cal = BizCalendar::fromDb();
    $months = inspect_fy_months($fy);
    $runs = [];
    foreach (rows('SELECT r.*, t.id AS todo_alive, du.name AS done_name, cu.name AS checked_name FROM inspection_runs r
        LEFT JOIN todos t ON t.id = r.todo_id LEFT JOIN users du ON du.id = r.done_by LEFT JOIN users cu ON cu.id = r.checked_by
        WHERE r.ym >= ? AND r.ym <= ?', [$months[0], $months[11]]) as $r) {
        $runs[$r['item_id'] . '|' . $r['ym']] = $r;
    }
    $items = [];
    foreach (rows('SELECT i.*, o.name AS owner_name, c.name AS checker_name, b.name AS created_by_name FROM inspection_items i
        LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN users c ON c.id = i.checker_id LEFT JOIN users b ON b.id = i.created_by ORDER BY i.sort_order, i.id') as $item) {
        $cells = [];
        $itemMonths = inspect_item_months($item);
        foreach ($months as $ym) {
            $run = $runs[$item['id'] . '|' . $ym] ?? null;
            if ($run) {
                $cells[$ym] = inspect_run_for_client($run, $item, $today, $user);
            } elseif ((int)$item['active'] === 1 && in_array((int)substr($ym, 5, 2), $itemMonths, true) && $ym >= $curYm) {
                $cells[$ym] = ['ym' => $ym, 'month' => (int)substr($ym, 5, 2), 'status' => 'plan', 'run_id' => null, 'due' => inspect_due_date($item, $ym, $cal)];
            }
        }
        if (!$cells && !((int)$item['active'] === 1 && $fy >= inspect_fy_of($curYm))) {
            continue; // 記録も予定もない項目は、いまの年度と先の年度では出す（登録したのに見えない、を避ける）。過去の年度・やめた項目は、記録があるときだけ
        }
        $c = inspect_item_for_client($item, $user);
        $c['cells'] = (object)$cells;
        $items[] = $c;
    }
    $plans = array_values(array_unique(array_map(function ($i) { return $i['plan']; }, $items)));
    $curFy = inspect_fy_of($curYm);
    return ['fy' => $fy, 'fy_start' => INSPECT_FY_START, 'months' => array_map(function ($ym) { return ['ym' => $ym, 'm' => (int)substr($ym, 5, 2)]; }, $months),
        'cur_ym' => $curYm, 'cur_fy' => $curFy, 'today' => $today, 'items' => $items, 'plans' => $plans, 'summary' => inspect_summary($user, $now)];
}

/** 画面の上のボタンの件数・帯のための集計（全部の年度の、未実施・確認待ち） */
function inspect_summary(array $user, ?int $now = null): array
{
    $now = $now ?? time();
    $today = date('Y-m-d', $now);
    $curYm = date('Y-m', $now);
    $c = ['items' => 0, 'now' => 0, 'late' => 0, 'wait' => 0, 'mine' => 0, 'today' => $today, 'ym' => $curYm];
    $c['items'] = (int)row('SELECT COUNT(*) AS c FROM inspection_items WHERE active = 1')['c'];
    foreach (rows('SELECT r.*, i.owner_id, i.checker_id FROM inspection_runs r JOIN inspection_items i ON i.id = r.item_id WHERE i.active = 1 AND r.status <> ?', ['checked']) as $r) {
        $st = inspect_status_of($r, $today);
        $c[$st]++;
        $mineOwner = (int)$r['owner_id'] === (int)$user['id'] && ($st === 'now' || $st === 'late');
        $mineCheck = $r['checker_id'] !== null && (int)$r['checker_id'] === (int)$user['id'] && $st === 'wait';
        if ($mineOwner || $mineCheck) {
            $c['mine']++;
        }
    }
    return $c;
}

/* ------------------------------------------------------------------
 * 実施・確認
 * ------------------------------------------------------------------ */

function inspect_run_label(array $run, array $item): string
{
    return '点検｜' . $item['title'] . '（' . (int)substr($run['ym'], 5, 2) . '月分）';
}

/** 実施済みにする（内部）。確認者がいなければ、そのまま確認済み */
function inspect_apply_done(array $run, array $item, int $byId, string $date, string $note = ''): void
{
    if ($item['checker_id'] === null) {
        q('UPDATE inspection_runs SET status = ?, done_at = ?, done_by = ?, checked_at = ?, checked_by = NULL, note = ? WHERE id = ?', ['checked', $date, $byId, $date, $note, $run['id']]);
    } else {
        q('UPDATE inspection_runs SET status = ?, done_at = ?, done_by = ?, checked_at = NULL, checked_by = NULL, note = ? WHERE id = ?', ['done', $date, $byId, $note, $run['id']]);
    }
    audit_log('inspect', 'update', inspect_run_label($run, $item), '', $item['checker_id'] === null ? '実施済み（確認済み）' : '実施済み（確認待ち）');
}

function inspect_apply_reopen(array $run, array $item): void
{
    q('UPDATE inspection_runs SET status = ?, done_at = NULL, done_by = NULL, checked_at = NULL, checked_by = NULL WHERE id = ?', ['open', $run['id']]);
    audit_log('inspect', 'update', inspect_run_label($run, $item), '', '実施を取り消し（未実施に戻す）');
}

/** この点検の ToDo を完了にするとき、添付が必要なのに無ければ、その理由（なければ null） */
function inspect_todo_block(array $todo): ?string
{
    $r = row('SELECT r.id FROM inspection_runs r JOIN inspection_items i ON i.id = r.item_id WHERE r.todo_id = ? AND i.need_attach = 1', [$todo['id']]);
    if (!$r) {
        return null;
    }
    $n = (int)row('SELECT COUNT(*) AS c FROM todo_comment_files WHERE todo_id = ?', [$todo['id']])['c'];
    return $n > 0 ? null : 'この点検は、完了にするとき点検記録の添付が必要です。ToDoのコメントに、記録（写真・PDF など）を添付してから完了にしてください。';
}

/** 年間計画の画面から、実施済み・確認済みなどにする。ToDo も、同じ状態にそろえる */
function inspect_run_mark(array $run, string $action, array $user, array $in = []): array
{
    $item = row('SELECT * FROM inspection_items WHERE id = ?', [$run['item_id']]);
    if (!$item) {
        throw new RuntimeException('点検項目が見つかりません。', 404);
    }
    $admin = is_admin($user);
    $isOwner = (int)$item['owner_id'] === (int)$user['id'];
    $isChecker = $item['checker_id'] !== null && (int)$item['checker_id'] === (int)$user['id'];
    $todo = $run['todo_id'] !== null ? row('SELECT * FROM todos WHERE id = ?', [$run['todo_id']]) : null;
    $today = date('Y-m-d');
    switch ($action) {
        case 'done':
            if ($run['status'] !== 'open') {
                throw new RuntimeException('すでに実施済みです。');
            }
            if (!$admin && !$isOwner) {
                throw new RuntimeException('実施済みにできるのは、担当者と管理者だけです。', 403);
            }
            $date = (string)($in['date'] ?? '');
            $date = $date !== '' && valid_date($date) && $date <= $today ? $date : $today;
            $note = mb_substr(trim((string)($in['note'] ?? '')), 0, 500);
            if ($todo && ($why = inspect_todo_block($todo)) !== null) {
                throw new RuntimeException($why);
            }
            inspect_apply_done($run, $item, (int)$user['id'], $date, $note);
            if ($todo && $todo['done_at'] === null) {
                $after = set_todo_done($todo, true);
                todo_done_sync_events($todo, $after);
            }
            break;
        case 'check':
            if ($run['status'] !== 'done') {
                throw new RuntimeException('確認できるのは、実施済み（確認待ち）の点検だけです。');
            }
            if (!$admin && !$isChecker) {
                throw new RuntimeException('確認できるのは、確認者と管理者だけです。', 403);
            }
            q('UPDATE inspection_runs SET status = ?, checked_at = ?, checked_by = ? WHERE id = ?', ['checked', $today, $user['id'], $run['id']]);
            audit_log('inspect', 'update', inspect_run_label($run, $item), '', '確認済み');
            break;
        case 'uncheck':
            if ($run['status'] !== 'checked' || $item['checker_id'] === null) {
                throw new RuntimeException('確認を取り消せない状態です。');
            }
            if (!$admin && !$isChecker) {
                throw new RuntimeException('確認を取り消せるのは、確認者と管理者だけです。', 403);
            }
            q('UPDATE inspection_runs SET status = ?, checked_at = NULL, checked_by = NULL WHERE id = ?', ['done', $run['id']]);
            audit_log('inspect', 'update', inspect_run_label($run, $item), '', '確認を取り消し（確認待ちに戻す）');
            break;
        case 'reopen':
            if ($run['status'] === 'open') {
                throw new RuntimeException('まだ実施していません。');
            }
            if (!$admin && !($run['status'] === 'done' && $isOwner)) {
                throw new RuntimeException('実施の取り消しができるのは、確認前なら担当者、確認後は管理者です。', 403);
            }
            inspect_apply_reopen($run, $item);
            if ($todo && $todo['done_at'] !== null) {
                $after = set_todo_done($todo, false);
                todo_done_sync_events($todo, $after);
            }
            break;
        default:
            throw new RuntimeException('操作が正しくありません。');
    }
    return row('SELECT * FROM inspection_runs WHERE id = ?', [$run['id']]);
}

/**
 * ToDo を完了にした／完了を取り消したとき、結びついた点検の記録も合わせる（api の todo_done・todo_status から呼ぶ）。
 * 完了: 未実施の記録を、実施済みに（確認者がいれば確認待ち）。取り消し: 実施済み・確認済みの記録を、未実施に戻す
 */
function inspect_todo_changed(array $before, array $after): void
{
    $wasDone = ($before['done_at'] ?? null) !== null;
    $isDone = ($after['done_at'] ?? null) !== null;
    if ($wasDone === $isDone) {
        return;
    }
    $run = row('SELECT * FROM inspection_runs WHERE todo_id = ?', [$after['id']]);
    if (!$run) {
        return;
    }
    $item = row('SELECT * FROM inspection_items WHERE id = ?', [$run['item_id']]);
    if (!$item) {
        return;
    }
    if ($isDone && $run['status'] === 'open') {
        inspect_apply_done($run, $item, (int)$after['owner_id'], substr((string)$after['done_at'], 0, 10));
    } elseif (!$isDone && $run['status'] !== 'open') {
        inspect_apply_reopen($run, $item);
    }
}

/* ------------------------------------------------------------------
 * Slack のアラート（cron の notify から。朝の通知の時刻に送る）
 * ------------------------------------------------------------------ */

function inspect_slack_who(?int $id): string
{
    if (!$id) {
        return 'なし';
    }
    $u = row('SELECT name, slack_id FROM users WHERE id = ?', [$id]);
    if (!$u) {
        return 'なし';
    }
    return preg_match('/^[UW][A-Z0-9]{6,}$/', (string)$u['slack_id']) ? '<@' . $u['slack_id'] . '>' : rooms_slack_esc((string)$u['name']);
}

function inspect_slack_text(string $head, array $run, array $item, string $extra = ''): string
{
    $m = (int)substr($run['ym'], 5, 2);
    return $head . "\n" . rooms_slack_esc((string)$item['title']) . '（' . $m . '月分）　期限 ' . audit_md($run['due_date']) . $extra . "\n"
        . '担当: ' . inspect_slack_who((int)$item['owner_id']) . '　確認: ' . inspect_slack_who($item['checker_id'] === null ? null : (int)$item['checker_id']) . "\n" . slack_link_text();
}

/** 1通送る。送れなかったら、次の cron でやり直せるよう、送った記録を消す */
function inspect_slack_send(string $ref, string $text): bool
{
    if (!notify_once($ref)) {
        return false;
    }
    $ok = slack_post($text);
    if (!$ok && slack_enabled()) {
        q('DELETE FROM notification_log WHERE ref = ?', [$ref]);
        return false;
    }
    return true;
}

/**
 * 点検のアラート。朝の通知の時刻（Slack通知の設定）から3時間のあいだに、まだ送っていなければ送る（土日祝は送らない）。
 *   期限の○日前（その日が休みなら、次の営業日。期限の日より前のときだけ）／期限の当日／期限を過ぎた最初の営業日
 * 実施済みになって確認待ちになったものは、時刻に関係なく、すぐ確認者へ知らせる（確認者が決まっている項目だけ）。
 * @return string[]
 */
function inspect_notify_due(?int $now = null): array
{
    $now = $now ?? time();
    $msg = [];
    try {
        if ((int)row('SELECT COUNT(*) AS c FROM inspection_items WHERE active = 1')['c'] === 0) {
            return [];
        }
        $cal = BizCalendar::fromDb();
        $today = date('Y-m-d', $now);
        $time = slack_cfg()['morning']['time'];
        $at = strtotime($today . ' ' . $time . ':00');
        $morning = $cal->isBusinessDay($today) && $now >= $at && $now < $at + 3 * 3600;
        $rows = rows('SELECT r.*, i.title AS i_title, i.owner_id, i.checker_id, i.alert_days, i.alert_due, i.alert_late, i.alert_check FROM inspection_runs r JOIN inspection_items i ON i.id = r.item_id WHERE i.active = 1 AND r.status <> ? ORDER BY r.due_date, r.id', ['checked']);
        foreach ($rows as $r) {
            $item = ['title' => $r['i_title'], 'owner_id' => $r['owner_id'], 'checker_id' => $r['checker_id']];
            if ($r['status'] === 'done') {
                if ((int)$r['alert_check'] === 1 && $r['checker_id'] !== null && inspect_slack_send('inspchk:' . $r['id'], inspect_slack_text('【確認をお願いします】', $r, $item, '　実施: ' . audit_md((string)$r['done_at'])))) {
                    $msg[] = '年間点検（確認依頼）: ' . $r['i_title'] . ' を通知しました';
                }
                continue;
            }
            if (!$morning) {
                continue;
            }
            $due = $r['due_date'];
            $days = (int)round((strtotime($due) - strtotime($today)) / 86400);
            if ($due < $today) {
                if ((int)$r['alert_late'] === 1 && inspect_slack_send('insplate:' . $r['id'], inspect_slack_text('【点検が遅れています】', $r, $item, '（' . inspect_late_days($r, $today) . '日超過）'))) {
                    $msg[] = '年間点検（遅れ）: ' . $r['i_title'] . ' を通知しました';
                }
            } elseif ($due === $today) {
                if ((int)$r['alert_due'] === 1 && inspect_slack_send('inspdue:' . $r['id'], inspect_slack_text('【点検の期限は今日です】', $r, $item))) {
                    $msg[] = '年間点検（当日）: ' . $r['i_title'] . ' を通知しました';
                }
            } elseif ((int)$r['alert_days'] > 0) {
                $pre = $cal->shiftForward(date('Y-m-d', strtotime($due . ' -' . (int)$r['alert_days'] . ' day')));
                if ($pre === $today && $pre < $due && inspect_slack_send('inspre:' . $r['id'], inspect_slack_text('【点検アラート】期限まで' . $days . '日', $r, $item))) {
                    $msg[] = '年間点検（事前）: ' . $r['i_title'] . ' を通知しました';
                }
            }
        }
    } catch (Throwable $e) {
        error_log('[schedule inspect notify] ' . $e->getMessage());
        $msg[] = '年間点検の通知でエラー: ' . $e->getMessage();
    }
    return $msg;
}
