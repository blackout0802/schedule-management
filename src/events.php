<?php
// 予定の取得・検証・保存。プライベート予定の扱いは、すべてこのファイルで決める。
//
// ルール:
//   private … 本人にしか返さない（管理者にも返さない）
//   work    … 全社員に見える。プライベート版ではタグで絞り込める
//   off     … 全社員に見える

require_once __DIR__ . '/recurrence.php';

/**
 * 「家族に共有する」の値。指定があればそれに従い、なければ種類ごとの初期値。
 * プライベート = 共有する（外した予定だけ隠す） / 業務・休み = 共有しない（選んだものだけ共有）
 */
function family_flag(string $kind, array $in): int
{
    if (array_key_exists('family_shared', $in)) {
        return empty($in['family_shared']) ? 0 : 1;
    }
    return $kind === 'private' ? 1 : 0;
}

function allowed_tags(string $kind): array
{
    if ($kind === 'work') {
        return cfg('work_tags');
    }
    if ($kind === 'off') {
        return cfg('off_tags');
    }
    return [];
}

/**
 * 画面に返す予定の一覧。
 * @param string $view 'team'（業務版）または 'me'（プライベート版）
 * @param array  $opts ['tags' => 表示する業務タグ, 'showOff' => 同僚の休みを出すか, 'who' => 業務版で、特定の社員のid（なければ全社）]
 */
function list_events(array $user, string $from, string $to, string $view, array $opts = []): array
{
    $params = [$to, $from];
    if ($view === 'team') {
        // 業務版: プライベート予定は条件にすら含めない
        $where = "kind IN ('work','off')";
        if (!empty($opts['who'])) { // 特定の社員だけ（全社を見ているときは指定なし）
            $where .= ' AND e.owner_id = ?';
            $params[] = (int)$opts['who'];
        }
    } else {
        $tags = array_values(array_intersect($opts['tags'] ?? cfg('work_tags'), cfg('work_tags')));
        $parts = ["(kind = 'private' AND owner_id = ?)"];
        $params[] = $user['id'];
        if ($tags) {
            $parts[] = "(kind = 'work' AND tag IN (" . implode(',', array_fill(0, count($tags), '?')) . '))';
            $params = array_merge($params, $tags);
        }
        if (!empty($opts['showOff'])) {
            $parts[] = "kind = 'off'"; // 同僚の休みも表示
        } else {
            $parts[] = "(kind = 'off' AND owner_id = ?)"; // 自分の休みだけ
            $params[] = $user['id'];
        }
        $where = '(' . implode(' OR ', $parts) . ')';
    }
    $list = rows("SELECT e.*, u.name AS owner_name FROM events e JOIN users u ON u.id = e.owner_id
                  WHERE e.start_date <= ? AND e.end_date >= ? AND $where ORDER BY e.start_date, e.start_time, e.id", $params);
    return array_map(function ($e) use ($user) {
        return event_for_client($e, $user);
    }, $list);
}

function can_edit_event(array $e, array $user): bool
{
    if ($e['kind'] === 'private') {
        return (int)$e['owner_id'] === (int)$user['id'];
    }
    return (int)$e['owner_id'] === (int)$user['id'] || is_admin($user);
}

function event_for_client(array $e, array $user): array
{
    return [
        'id' => (int)$e['id'],
        'title' => $e['title'],
        'kind' => $e['kind'],
        'tag' => $e['tag'],
        'start' => $e['start_date'],
        'end' => $e['end_date'],
        'start_time' => $e['start_time'],
        'end_time' => $e['end_time'],
        'note' => $e['note'],
        'owner_id' => (int)$e['owner_id'],
        'family_shared' => (int)$e['family_shared'] === 1,
        'important' => (int)($e['important'] ?? 0) === 1,
        'owner_name' => $e['owner_name'] ?? '',
        'recurring' => $e['series_id'] !== null,
        'series_id' => $e['series_id'] !== null ? (int)$e['series_id'] : null,
        'editable' => can_edit_event($e, $user),
    ];
}

/** 他人のプライベート予定は「存在しない」ものとして扱う */
function find_event(int $id, array $user): ?array
{
    $e = row('SELECT * FROM events WHERE id = ?', [$id]);
    if (!$e) {
        return null;
    }
    if ($e['kind'] === 'private' && (int)$e['owner_id'] !== (int)$user['id']) {
        return null;
    }
    return $e;
}

/** @return array{0:?array,1:?string} [整えた入力, エラーメッセージ] */
function validate_event_input(array $in, array $user): array
{
    $kind = (string)($in['kind'] ?? '');
    if (!in_array($kind, ['work', 'off', 'private'], true)) {
        return [null, '種類を選んでください。'];
    }
    $title = trim((string)($in['title'] ?? ''));
    if ($kind === 'off' && $title === '') {
        $title = '休み';
    }
    if ($title === '' || mb_strlen($title) > 100) {
        return [null, '件名を100文字以内で入力してください。'];
    }
    $start = (string)($in['start'] ?? '');
    $end = (string)($in['end'] ?? '') ?: $start;
    if (!valid_date($start) || !valid_date($end)) {
        return [null, '日付を正しく入力してください。'];
    }
    if ($end < $start) {
        return [null, '終了日は開始日以降にしてください。'];
    }
    $st = (string)($in['start_time'] ?? '');
    $et = (string)($in['end_time'] ?? '');
    if (!valid_time($st) || !valid_time($et)) {
        return [null, '時刻は 09:30 の形式で入力してください。'];
    }
    $tag = (string)($in['tag'] ?? '');
    if ($kind === 'private') {
        $tag = '';
    } elseif (!in_array($tag, allowed_tags($kind), true)) {
        $list = allowed_tags($kind);
        $tag = $kind === 'off' ? $list[0] : $list[count($list) - 1]; // 休みは先頭（有給）、業務は末尾（その他）
    }
    $note = trim((string)($in['note'] ?? ''));
    if (mb_strlen($note) > 500) {
        return [null, 'メモは500文字以内にしてください。'];
    }
    // 持ち主: プライベートは必ず本人。休みだけ、管理者が他の社員分を登録できる
    $owner = (int)$user['id'];
    if ($kind === 'off' && is_admin($user) && !empty($in['owner_id'])) {
        $o = row('SELECT id FROM users WHERE id = ? AND active = 1', [(int)$in['owner_id']]);
        if (!$o) {
            return [null, '社員が見つかりません。'];
        }
        $owner = (int)$o['id'];
    }
    return [[
        'kind' => $kind, 'title' => $title, 'tag' => $tag, 'start' => $start, 'end' => $end,
        'start_time' => $st, 'end_time' => $et, 'note' => $note, 'owner_id' => $owner,
        // プライベートの予定だけが対象。指定がなければ「家族に共有する」
        'family_shared' => family_flag($kind, $in),
        // 「重要」（カレンダーで目立たせる）。指定がなければ、いまの状態のまま
        'important' => array_key_exists('important', $in) ? (empty($in['important']) ? 0 : 1) : null,
    ], null];
}

function save_event(array $data, array $user, ?array $existing): array
{
    if ($existing) {
        // 持ち主は編集で変えない。種類は変えられる（変えてよい人かの判定は、呼び出し側で行う）
        $data['owner_id'] = (int)$existing['owner_id'];
        if ((int)$existing['owner_id'] !== (int)$user['id']) {
            $data['family_shared'] = (int)$existing['family_shared']; // 家族への共有は持ち主だけが決める（管理者の編集では変えない）
        }
        q('UPDATE events SET title=?, kind=?, tag=?, start_date=?, end_date=?, start_time=?, end_time=?, note=?, family_shared=?, important=?, detached=?, updated_at=? WHERE id=?', [
            $data['title'], $data['kind'], $data['tag'], $data['start'], $data['end'], $data['start_time'], $data['end_time'], $data['note'],
            $data['family_shared'] ?? 1, $data['important'] ?? (int)$existing['important'], $existing['series_id'] !== null ? 1 : 0, now_str(), $existing['id'],
        ]);
        $id = (int)$existing['id'];
    } else {
        q('INSERT INTO events (owner_id,title,kind,tag,start_date,end_date,start_time,end_time,note,family_shared,important,series_id,ym,detached,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,0,?,?,?)', [
            $data['owner_id'], $data['title'], $data['kind'], $data['tag'], $data['start'], $data['end'], $data['start_time'], $data['end_time'],
            $data['note'], $data['family_shared'] ?? 1, $data['important'] ?? 0, $user['id'], now_str(), now_str(),
        ]);
        $id = (int)db()->lastInsertId();
    }
    return row('SELECT * FROM events WHERE id = ?', [$id]);
}

function delete_event(array $e): void
{
    if ($e['series_id'] !== null && $e['ym'] !== null) {
        // 繰り返しの1回分を消した場合、次回の自動作成で復活しないよう記録する
        $exists = row('SELECT 1 AS x FROM series_skips WHERE series_id = ? AND ym = ?', [$e['series_id'], $e['ym']]);
        if (!$exists) {
            q('INSERT INTO series_skips (series_id, ym) VALUES (?, ?)', [$e['series_id'], $e['ym']]);
        }
    }
    q('DELETE FROM events WHERE id = ?', [$e['id']]);
}

/**
 * 予定を、指定した日付へ複製する。件名・分類・時刻・メモ・持ち主を引き継ぎ、期間（何日間か）も同じにする。
 * 繰り返しルール由来の予定を複製した場合、コピーは通常の予定になる。
 * 同じ内容の予定がすでにある日付は、二重にならないよう飛ばす。
 * @param string[] $dates 複製先の開始日（Y-m-d）
 * @return array{0:array,1:int} [作った予定の一覧, 飛ばした件数]
 */
function duplicate_event(array $src, array $dates, array $user): array
{
    $span = (int)round((strtotime($src['end_date']) - strtotime($src['start_date'])) / 86400);
    $created = [];
    $skipped = 0;
    foreach (array_values(array_unique($dates)) as $d) {
        $end = date('Y-m-d', strtotime($d . " +$span day"));
        $dup = row('SELECT id FROM events WHERE owner_id = ? AND kind = ? AND title = ? AND start_date = ? AND end_date = ? AND start_time = ? AND end_time = ?', [
            $src['owner_id'], $src['kind'], $src['title'], $d, $end, $src['start_time'], $src['end_time'],
        ]);
        if ($dup) {
            $skipped++;
            continue;
        }
        $created[] = save_event([
            'kind' => $src['kind'], 'title' => $src['title'], 'tag' => $src['tag'], 'start' => $d, 'end' => $end,
            'start_time' => $src['start_time'], 'end_time' => $src['end_time'], 'note' => $src['note'], 'owner_id' => (int)$src['owner_id'],
            'family_shared' => (int)$src['family_shared'], 'important' => (int)$src['important'],
        ], $user, null);
    }
    return [$created, $skipped];
}

/* ------------------------------------------------------------------
 * 予定の移動、ToDo（本人だけの未定のやること）
 * ToDo は持ち主本人にしか返さない。業務版では「業務」のToDoだけを返す（プライベートのToDoを画面共有で見せないため）。
 * ------------------------------------------------------------------ */

/** 予定を別の日に動かす（何日間かは変えない）。繰り返し予定の1回分を動かした場合は、以後ルール変更で上書きしない */
function move_event(array $e, string $newStart): array
{
    $span = (int)round((strtotime($e['end_date']) - strtotime($e['start_date'])) / 86400);
    $newEnd = date('Y-m-d', strtotime($newStart . " +$span day"));
    q('UPDATE events SET start_date = ?, end_date = ?, detached = ?, updated_at = ? WHERE id = ?', [
        $newStart, $newEnd, $e['series_id'] !== null ? 1 : 0, now_str(), $e['id'],
    ]);
    return row('SELECT * FROM events WHERE id = ?', [$e['id']]);
}

/** ToDoの状態: todo（未着手）/ doing（進行中）/ done（完了） */
function todo_status_of(array $t): string
{
    if (($t['done_at'] ?? null) !== null) {
        return 'done';
    }
    return (int)($t['doing'] ?? 0) === 1 ? 'doing' : 'todo';
}

function todo_for_client(array $t): array
{
    return ['id' => (int)$t['id'], 'title' => $t['title'], 'kind' => $t['kind'], 'tag' => $t['tag'], 'note' => $t['note'], 'family_shared' => (int)$t['family_shared'] === 1,
        'done_at' => $t['done_at'] ?? null, 'status' => todo_status_of($t)];
}

/** 未完了のToDo。@param string $view 'team' なら業務のToDoだけ */
function list_todos(array $user, string $view): array
{
    $sql = 'SELECT * FROM todos WHERE owner_id = ? AND done_at IS NULL' . ($view === 'team' ? " AND kind = 'work'" : '') . ' ORDER BY sort_order, id';
    return array_map('todo_for_client', rows($sql, [$user['id']]));
}

/** 完了したToDo（新しい順）。業務版では業務のToDoだけ */
function list_done_todos(array $user, string $view, int $limit = 100): array
{
    $sql = 'SELECT * FROM todos WHERE owner_id = ? AND done_at IS NOT NULL' . ($view === 'team' ? " AND kind = 'work'" : '') . ' ORDER BY done_at DESC, id DESC LIMIT ' . (int)$limit;
    return array_map('todo_for_client', rows($sql, [$user['id']]));
}

/** 完了にする／未完了に戻す。戻したToDoは、リストの末尾に入る */
function set_todo_done(array $todo, bool $done): array
{
    if ($done) {
        q('UPDATE todos SET done_at = ?, doing = 0 WHERE id = ?', [now_str(), $todo['id']]);
    } else {
        $max = row('SELECT MAX(sort_order) AS m FROM todos WHERE owner_id = ?', [$todo['owner_id']]);
        q('UPDATE todos SET done_at = NULL, doing = 0, sort_order = ? WHERE id = ?', [(int)($max['m'] ?? 0) + 1, $todo['id']]);
    }
    return row('SELECT * FROM todos WHERE id = ?', [$todo['id']]);
}

/**
 * ToDoの状態を変える（カンバンの列の移動）。todo=未着手 / doing=進行中 / done=完了。
 * 完了から戻すときは、リストの末尾に入る（並びは、続けて reorder_todos で決める）
 */
function set_todo_status(array $todo, string $status): array
{
    if ($status === 'done') {
        if ($todo['done_at'] === null) {
            return set_todo_done($todo, true);
        }
        return $todo;
    }
    if ($todo['done_at'] !== null) {
        $todo = set_todo_done($todo, false);
    }
    q('UPDATE todos SET doing = ? WHERE id = ?', [$status === 'doing' ? 1 : 0, $todo['id']]);
    return row('SELECT * FROM todos WHERE id = ?', [$todo['id']]);
}

/** 完了したToDoをまとめて消す。業務版では業務のものだけ */
function clear_done_todos(array $user, string $view): int
{
    $st = q('DELETE FROM todos WHERE owner_id = ? AND done_at IS NOT NULL' . ($view === 'team' ? " AND kind = 'work'" : ''), [$user['id']]);
    return $st->rowCount();
}

function find_todo(int $id, array $user): ?array
{
    return row('SELECT * FROM todos WHERE id = ? AND owner_id = ?', [$id, $user['id']]);
}

/** @return array{0:?array,1:?string} */
function validate_todo_input(array $in): array
{
    $kind = (string)($in['kind'] ?? 'work');
    if (!in_array($kind, ['work', 'private'], true)) {
        return [null, 'ToDoの種類は「業務」か「プライベート」です。'];
    }
    $title = trim((string)($in['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 100) {
        return [null, '内容を100文字以内で入力してください。'];
    }
    $note = trim((string)($in['note'] ?? ''));
    if (mb_strlen($note) > 500) {
        return [null, 'メモは500文字以内にしてください。'];
    }
    $tag = '';
    if ($kind === 'work') {
        $tags = cfg('work_tags');
        $tag = in_array((string)($in['tag'] ?? ''), $tags, true) ? (string)$in['tag'] : $tags[count($tags) - 1];
    }
    $fam = family_flag($kind, $in);
    return [['kind' => $kind, 'title' => $title, 'tag' => $tag, 'note' => $note, 'family_shared' => $fam], null];
}

function save_todo(array $data, array $user, ?array $existing): array
{
    if ($existing) {
        q('UPDATE todos SET title = ?, kind = ?, tag = ?, note = ?, family_shared = ? WHERE id = ?', [$data['title'], $data['kind'], $data['tag'], $data['note'], $data['family_shared'], $existing['id']]);
        $id = (int)$existing['id'];
    } else {
        $max = row('SELECT MAX(sort_order) AS m FROM todos WHERE owner_id = ?', [$user['id']]);
        q('INSERT INTO todos (owner_id, title, kind, tag, note, family_shared, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?)', [$user['id'], $data['title'], $data['kind'], $data['tag'], $data['note'], $data['family_shared'], (int)($max['m'] ?? 0) + 1, now_str()]);
        $id = (int)db()->lastInsertId();
    }
    return row('SELECT * FROM todos WHERE id = ?', [$id]);
}

/** ToDo を、指定した日の予定にする（ToDo は消える）。業務のToDoは全社員に見える業務の予定になる */
function schedule_todo(array $todo, string $date, array $user): array
{
    if ($todo['done_at'] !== null) {
        throw new RuntimeException('完了したToDoは予定にできません。先に未完了に戻してください。');
    }
    $event = save_event([
        'kind' => $todo['kind'], 'title' => $todo['title'], 'tag' => $todo['tag'], 'start' => $date, 'end' => $date,
        'start_time' => '', 'end_time' => '', 'note' => $todo['note'], 'owner_id' => (int)$user['id'],
        'family_shared' => (int)$todo['family_shared'],
    ], $user, null);
    q('DELETE FROM todos WHERE id = ?', [$todo['id']]);
    return $event;
}

/** 自分の予定を、ToDo に戻す（予定は消える）。休み・繰り返し予定は戻せない */
function event_to_todo(array $e, array $user): array
{
    if ($e['kind'] === 'off') {
        throw new RuntimeException('休みはToDoに戻せません。');
    }
    if ($e['series_id'] !== null) {
        throw new RuntimeException('毎月の繰り返しから作られた予定は、ToDoに戻せません。');
    }
    if ((int)$e['owner_id'] !== (int)$user['id']) {
        throw new RuntimeException('他の人の予定は、ToDoに戻せません。');
    }
    $todo = save_todo(['kind' => $e['kind'], 'title' => $e['title'], 'tag' => $e['tag'], 'note' => $e['note'], 'family_shared' => (int)$e['family_shared']], $user, null);
    q('DELETE FROM events WHERE id = ?', [$e['id']]);
    return $todo;
}

/**
 * ToDo の並びを保存する。$ids は、画面に見えている ToDo を上から並べた id。
 * 業務版では「業務」だけが見えているので、見えていないToDo（プライベート）の並びは変えない。
 */
function reorder_todos(array $ids, array $user): void
{
    $ids = array_values(array_unique(array_map('intval', $ids)));
    $own = [];
    foreach (rows('SELECT id, sort_order FROM todos WHERE owner_id = ? AND done_at IS NULL', [$user['id']]) as $r) {
        $own[(int)$r['id']] = (int)$r['sort_order'];
    }
    $ids = array_values(array_filter($ids, function ($id) use ($own) { return isset($own[$id]); }));
    if (count($ids) < 2) {
        return;
    }
    // 見えている ToDo が使っていた順番の番号を、新しい並びに割り当て直す（見えていないものの位置は動かさない）
    $slots = array_map(function ($id) use ($own) { return $own[$id]; }, $ids);
    sort($slots);
    $prev = null;
    foreach ($ids as $i => $id) {
        $n = $slots[$i];
        if ($prev !== null && $n <= $prev) {
            $n = $prev + 1; // 同じ番号が重なっていたときの保険
        }
        q('UPDATE todos SET sort_order = ? WHERE id = ? AND owner_id = ?', [$n, $id, $user['id']]);
        $prev = $n;
    }
}

/* ------------------------------------------------------------------
 * 日報用のメモ（本人だけ）。書式は「改行」と「取り消し線」だけを残す。
 * ------------------------------------------------------------------ */

const MEMO_MAX_CHARS = 12000;

/** メモのHTMLを安全な形にする。許すのは div / br / s（取り消し線）だけ。属性・スクリプトは全て消す */
function sanitize_memo_html(string $html): string
{
    $html = mb_substr($html, 0, MEMO_MAX_CHARS * 3);
    $html = preg_replace('#<(script|style|iframe|object|embed|template)\b[^>]*>.*?</\1\s*>#is', '', $html);
    $html = strip_tags($html, '<div><p><br><s><strike><del>');
    $html = preg_replace('#<\s*(/?)\s*([a-z0-9]+)\b[^>]*>#i', '<$1$2>', $html); // 属性を全て取り除く
    $html = preg_replace('#<(/?)(strike|del)>#i', '<$1s>', $html);
    $html = preg_replace('#<(/?)p>#i', '<$1div>', $html);
    $html = preg_replace('#<br\s*/?>#i', '<br>', $html);
    return $html;
}

/** 本人が決める「家族に見せる範囲」: 休みを全て見せるか / 見せる業務の分類 */
function get_family_share(array $user): array
{
    $r = row('SELECT family_share_off, family_share_tags FROM users WHERE id = ?', [$user['id']]);
    $tags = $r && $r['family_share_tags'] !== '' ? array_values(array_intersect(explode(',', $r['family_share_tags']), cfg('work_tags'))) : [];
    return ['off' => $r && (int)$r['family_share_off'] === 1, 'tags' => $tags];
}

function save_family_share(array $user, bool $off, array $tags): array
{
    $tags = array_values(array_intersect(cfg('work_tags'), array_map('strval', $tags))); // 設定にある分類だけ、決まった順で
    q('UPDATE users SET family_share_off = ?, family_share_tags = ? WHERE id = ?', [$off ? 1 : 0, implode(',', $tags), $user['id']]);
    return ['off' => $off, 'tags' => $tags];
}

function get_memo(array $user): string
{
    $r = row('SELECT body FROM memos WHERE owner_id = ?', [$user['id']]);
    return $r ? sanitize_memo_html($r['body']) : '';
}

function save_memo(string $html, array $user): string
{
    $clean = sanitize_memo_html($html);
    if (mb_strlen(strip_tags($clean)) > MEMO_MAX_CHARS) {
        throw new RuntimeException('メモが長すぎます（' . MEMO_MAX_CHARS . '文字まで）。');
    }
    if (row('SELECT owner_id FROM memos WHERE owner_id = ?', [$user['id']])) {
        q('UPDATE memos SET body = ?, updated_at = ? WHERE owner_id = ?', [$clean, now_str(), $user['id']]);
    } else {
        q('INSERT INTO memos (owner_id, body, updated_at) VALUES (?,?,?)', [$user['id'], $clean, now_str()]);
    }
    return $clean;
}


/* ------------------------------------------------------------------
 * 月のまとめ（出勤日・休みの日数）。自分の分だけ。
 * ------------------------------------------------------------------ */

/** 期間内の祝日・会社の休業日（日付 => 名前） */
function holiday_map(string $from, string $to): array
{
    $holidays = [];
    for ($y = (int)substr($from, 0, 4); $y <= (int)substr($to, 0, 4); $y++) {
        $holidays += Holidays::national($y);
    }
    foreach (rows('SELECT hdate, name FROM company_holidays WHERE hdate BETWEEN ? AND ?', [$from, $to]) as $r) {
        $holidays[$r['hdate']] = $r['name'];
    }
    return $holidays;
}

/**
 * その月の、自分の出勤日・休みの日数。営業日は「平日で、祝日・会社の休業日でない日」。
 * 休みは営業日の分だけ数える（土日祝にまたがる休みは、平日の分だけ）。午前・午後の半休は0.5日。
 * @return array{month:string,biz_days:int,off_days:float,work_days:float,by_tag:array<int,array{tag:string,days:float}>}
 */
function month_summary(array $user, string $ym): array
{
    $first = $ym . '-01';
    $last = date('Y-m-t', strtotime($first));
    $hol = holiday_map($first, $last);
    $biz = [];
    for ($t = strtotime($first), $end = strtotime($last); $t <= $end; $t = strtotime('+1 day', $t)) {
        $d = date('Y-m-d', $t);
        if ((int)date('N', $t) <= 5 && !isset($hol[$d])) {
            $biz[$d] = true;
        }
    }
    $perDay = [];
    $perDayTag = [];
    foreach (rows("SELECT tag, start_date, end_date FROM events WHERE kind = 'off' AND owner_id = ? AND start_date <= ? AND end_date >= ?", [$user['id'], $last, $first]) as $e) {
        $tag = $e['tag'] !== '' ? $e['tag'] : '休み';
        $w = mb_strpos($tag, '半休') !== false ? 0.5 : 1.0;
        $from = max($e['start_date'], $first);
        $to = min($e['end_date'], $last);
        for ($t = strtotime($from), $end = strtotime($to); $t <= $end; $t = strtotime('+1 day', $t)) {
            $d = date('Y-m-d', $t);
            if (isset($biz[$d])) {
                $perDay[$d] = min(1.0, ($perDay[$d] ?? 0.0) + $w); // 同じ日に午前・午後の半休が2つあっても、1日まで
                $perDayTag[$tag][$d] = min(1.0, ($perDayTag[$tag][$d] ?? 0.0) + $w); // 同じ分類を重ねて登録しても、1日は1日
            }
        }
    }
    $byTag = array_map('array_sum', $perDayTag);
    $off = array_sum($perDay);
    $order = array_merge(cfg('off_tags'), ['休み']);
    $list = [];
    foreach ($order as $tag) {
        // 有給と欠勤は、0日でも表示する（休みの内訳がひと目で分かるように）
        if (isset($byTag[$tag]) || in_array($tag, ['有給', '欠勤'], true)) {
            $list[] = ['tag' => $tag, 'days' => (float)($byTag[$tag] ?? 0.0)];
            unset($byTag[$tag]);
        }
    }
    foreach ($byTag as $tag => $days) { // 設定から外れた分類で登録済みのもの
        $list[] = ['tag' => (string)$tag, 'days' => (float)$days];
    }
    return ['month' => $ym, 'biz_days' => count($biz), 'off_days' => (float)$off, 'work_days' => count($biz) - (float)$off, 'by_tag' => $list];
}
