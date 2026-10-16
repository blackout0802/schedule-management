<?php
// 予定の取得・検証・保存。プライベート予定の扱いは、すべてこのファイルで決める。
//
// ルール:
//   private … 本人にしか返さない（管理者にも返さない）
//   work    … 全社員に見える。持ち主のプライベート版には、「家族に共有」にしたものだけ重なる
//   off     … 全社員に見える（プライベート版は、work と同じ）

require_once __DIR__ . '/attachments.php';
require_once __DIR__ . '/recurrence.php';
require_once __DIR__ . '/audit.php';

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

/**
 * 家族用リンクに見える予定の条件（SQLの断片と値）。持ち主の予定を e の別名で絞る。
 * (1) 予定ごとに「家族に共有」のもの (2) 本人が「休みを全て」にした場合の休み (3) 本人が選んだ分類の業務
 * 家族用リンクと、持ち主のプライベート版の表示は、この同じ条件で決める。
 * @return array{0:string,1:array} [条件, 値]
 */
function family_visible_cond(int $ownerId): array
{
    $fs = get_family_share(['id' => $ownerId]);
    $conds = ['e.family_shared = 1'];
    $params = [];
    if ($fs['off']) {
        $conds[] = "e.kind = 'off'";
    }
    if ($fs['tags']) {
        $conds[] = "(e.kind = 'work' AND e.tag IN (" . implode(',', array_fill(0, count($fs['tags']), '?')) . '))';
        $params = $fs['tags'];
    }
    return [implode(' OR ', $conds), $params];
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
 * @param array  $opts ['who' => 業務版で、特定の社員のid（なければ全社）]
 */
function list_events(array $user, string $from, string $to, string $view, array $opts = []): array
{
    $params = [$to, $from];
    if ($view === 'team') {
        // 業務版: プライベート予定は条件にすら含めない
        $where = "e.kind IN ('work','off')";
        if (!empty($opts['who'])) { // 特定の社員だけ（全社を見ているときは指定なし）
            $where .= ' AND e.owner_id = ?';
            $params[] = (int)$opts['who'];
        }
    } else {
        // プライベート版: 自分のプライベート予定と、「家族に共有」にした自分の業務・休み（家族が見るものと同じ）だけ。
        // 他の社員の予定は出さない（業務版で見る）
        [$fcond, $fparams] = family_visible_cond((int)$user['id']);
        $where = "(e.owner_id = ? AND (e.kind = 'private' OR ($fcond)))";
        $params = array_merge($params, [(int)$user['id']], $fparams);
    }
    $list = rows("SELECT e.*, u.name AS owner_name, t.done_at AS todo_done_at, t.doing AS todo_doing FROM events e JOIN users u ON u.id = e.owner_id LEFT JOIN todos t ON t.id = e.todo_id
                  WHERE e.start_date <= ? AND e.end_date >= ? AND $where ORDER BY e.start_date, e.start_time, e.id", $params);
    $colors = owner_colors_map();
    return array_map(function ($e) use ($user, $colors) {
        return event_for_client($e, $user, $colors);
    }, $list);
}

function can_edit_event(array $e, array $user): bool
{
    if ($e['kind'] === 'private') {
        return (int)$e['owner_id'] === (int)$user['id'];
    }
    return (int)$e['owner_id'] === (int)$user['id'] || is_admin($user);
}

/**
 * 社員ごとの「予定の色」（設定した項目だけ）。全員の画面で、その人の予定をその色で表示するために、予定と一緒に返す。
 * @return array<int,array<string,string>> 社員id => ['work' => '#rrggbb', ...]（1つも設定していない人は含まない）
 */
function owner_colors_map(): array
{
    $map = [];
    foreach (rows("SELECT id, prefs FROM users WHERE prefs <> ''") as $r) {
        $c = array_filter(get_prefs(['id' => (int)$r['id']])['colors'], function ($v) { return $v !== ''; });
        if ($c) {
            $map[(int)$r['id']] = $c;
        }
    }
    return $map;
}

function event_for_client(array $e, array $user, ?array $colorsMap = null): array
{
    $colorsMap = $colorsMap ?? owner_colors_map();
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
        'todo_id' => ($e['todo_id'] ?? null) !== null ? (int)$e['todo_id'] : null, // ToDoをカレンダーに置いた予定
        'done' => ($e['todo_done_at'] ?? null) !== null, // 元のToDoが完了（カレンダーでは取り消し線）
        'todo_status' => ($e['todo_id'] ?? null) === null ? null : (($e['todo_done_at'] ?? null) !== null ? 'done' : ((int)($e['todo_doing'] ?? 0) === 1 ? 'doing' : 'todo')), // 元のToDoの状態（予定の詳細で、変えられる）
        'owner_name' => $e['owner_name'] ?? '',
        'recurring' => $e['series_id'] !== null,
        'series_id' => $e['series_id'] !== null ? (int)$e['series_id'] : null,
        'editable' => can_edit_event($e, $user),
        'colors' => (object)($colorsMap[(int)$e['owner_id']] ?? []), // 持ち主が決めた色（なければ空 = 標準の色）
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
        $after = row('SELECT * FROM events WHERE id = ?', [$id]);
        event_changed($existing, $after);
        return $after;
    } else {
        q('INSERT INTO events (owner_id,title,kind,tag,start_date,end_date,start_time,end_time,note,family_shared,important,series_id,ym,detached,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,0,?,?,?)', [
            $data['owner_id'], $data['title'], $data['kind'], $data['tag'], $data['start'], $data['end'], $data['start_time'], $data['end_time'],
            $data['note'], $data['family_shared'] ?? 1, $data['important'] ?? 0, $user['id'], now_str(), now_str(),
        ]);
        $id = (int)db()->lastInsertId();
    }
    $after = row('SELECT * FROM events WHERE id = ?', [$id]);
    event_changed(null, $after);
    return $after;
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
    event_changed($e, null);
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
    $after = row('SELECT * FROM events WHERE id = ?', [$e['id']]);
    event_changed($e, $after);
    return $after;
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
        'done_at' => $t['done_at'] ?? null, 'status' => todo_status_of($t), 'due' => ($t['due_date'] ?? null) ?: null];
}

/* ------------------------------------------------------------------
 * ToDoのコメント。業務のToDoは全員に見えるので、持ち主以外の社員も、コメントを付けられる（編集・完了はできない）。
 * プライベートのToDoには、付けられない（本人にしか見えないため）。
 * ------------------------------------------------------------------ */

const TODO_COMMENT_MAX = 500;
const TODO_COMMENT_LIMIT = 200; // 1つのToDoに付けられる数

/** [['id'=>1, ...], ...] に、コメントの数と、いちばん新しいコメントの番号（「新着」の目印用）を付ける */
function todo_with_comment_stats(array $todos): array
{
    if (!$todos) {
        return $todos;
    }
    $ids = array_map(function ($t) { return (int)$t['id']; }, $todos);
    $stat = [];
    foreach (rows('SELECT todo_id, COUNT(*) AS c, MAX(id) AS m FROM todo_comments WHERE todo_id IN (' . implode(',', $ids) . ') GROUP BY todo_id') as $r) {
        $stat[(int)$r['todo_id']] = [(int)$r['c'], (int)$r['m']];
    }
    return array_map(function ($t) use ($stat) {
        $s = $stat[(int)$t['id']] ?? [0, 0];
        $t['comments'] = $s[0];
        $t['last_comment_id'] = $s[1];
        return $t;
    }, $todos);
}

/** ToDo に、カレンダーに置いた日（いちばん早い予定の日。なければ null）を付ける */
function todo_with_event_dates(array $todos): array
{
    if (!$todos) {
        return $todos;
    }
    $ids = array_map(function ($t) { return (int)$t['id']; }, $todos);
    $d = [];
    foreach (rows('SELECT todo_id, MIN(start_date) AS d FROM events WHERE todo_id IN (' . implode(',', $ids) . ') GROUP BY todo_id') as $r) {
        $d[(int)$r['todo_id']] = $r['d'];
    }
    return array_map(function ($t) use ($d) {
        $t['sched'] = $d[(int)$t['id']] ?? null;
        return $t;
    }, $todos);
}

/** コメントを付けたり読んだりできるToDo（持ち主か、業務のToDoで持ち主が利用中の社員のもの）。なければ null */
function todo_for_comments(int $id, array $user): ?array
{
    $t = row("SELECT t.*, u.name AS owner_name FROM todos t JOIN users u ON u.id = t.owner_id
              WHERE t.id = ? AND (t.owner_id = ? OR (t.kind = 'work' AND u.active = 1))", [$id, $user['id']]);
    return $t ?: null;
}

function todo_comments_list(array $todo, array $user): array
{
    $rows = rows('SELECT c.*, u.name AS author_name FROM todo_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.todo_id = ? ORDER BY c.id', [$todo['id']]);
    $files = attach_files_of_comments(array_map(function ($c) { return (int)$c['id']; }, $rows));
    return array_map(function ($c) use ($todo, $user, $files) {
        return ['id' => (int)$c['id'], 'author_id' => (int)$c['author_id'], 'author_name' => $c['author_name'] ?? '（退職した社員）', 'body' => $c['body'], 'at' => $c['created_at'], 'files' => $files[(int)$c['id']] ?? [],
            'can_delete' => (int)$c['author_id'] === (int)$user['id'] || (int)$todo['owner_id'] === (int)$user['id'] || is_admin($user)];
    }, $rows);
}

/** @return array{0:?array,1:?string} */
function todo_comment_add(array $todo, array $user, string $body, int $fileCount = 0): array
{
    $body = trim(str_replace("\r\n", "\n", $body));
    if ($body === '' && $fileCount === 0) {
        return [null, 'コメントを入力するか、画像を選んでください。'];
    }
    if (mb_strlen($body) > TODO_COMMENT_MAX) {
        return [null, 'コメントは' . TODO_COMMENT_MAX . '文字以内にしてください。'];
    }
    if ($todo['kind'] !== 'work') {
        return [null, 'プライベートのToDoには、コメントを付けられません。'];
    }
    if ((int)row('SELECT COUNT(*) AS c FROM todo_comments WHERE todo_id = ?', [$todo['id']])['c'] >= TODO_COMMENT_LIMIT) {
        return [null, 'このToDoのコメントは、上限（' . TODO_COMMENT_LIMIT . '件）に達しています。'];
    }
    if ($fileCount > 0 && (int)row('SELECT COUNT(*) AS c FROM todo_comment_files WHERE todo_id = ?', [$todo['id']])['c'] + $fileCount > ATTACH_MAX_PER_TODO) {
        return [null, 'このToDoに付けられる画像は、全部で' . ATTACH_MAX_PER_TODO . '枚までです。'];
    }
    q('INSERT INTO todo_comments (todo_id, author_id, body, created_at) VALUES (?,?,?,?)', [$todo['id'], $user['id'], $body, now_str()]);
    return [['id' => (int)db()->lastInsertId()], null];
}

/** ToDoを消すときに、そのコメントと画像も消す（$todoIdsSql は、ToDoの番号を選ぶ SELECT 文）。 */
function todo_comments_purge(string $todoIdsSql, array $params): void
{
    attach_delete_where("todo_id IN ($todoIdsSql)", $params);
    q("DELETE FROM todo_comments WHERE todo_id IN ($todoIdsSql)", $params);
}

/** コメントを消せるのは、書いた人・ToDoの持ち主・管理者 */
function todo_comment_delete(int $commentId, array $user): bool
{
    $c = row('SELECT c.*, t.owner_id AS todo_owner FROM todo_comments c LEFT JOIN todos t ON t.id = c.todo_id WHERE c.id = ?', [$commentId]);
    if (!$c) {
        return false;
    }
    if ((int)$c['author_id'] !== (int)$user['id'] && (int)($c['todo_owner'] ?? 0) !== (int)$user['id'] && !is_admin($user)) {
        return false;
    }
    attach_delete_where('comment_id = ?', [$commentId]);
    q('DELETE FROM todo_comments WHERE id = ?', [$commentId]);
    return true;
}

/**
 * 業務のToDoは、社員全員に見える（見るだけ。変えられるのは持ち主だけ）。プライベートのToDoは、本人だけ。
 * 他の社員の業務のToDo（未完了・完了したもの新しい順）。業務版のリスト画面で、持ち主の名前つきで出す。
 * @return array{todos:array,done:array}
 */
function list_others_todos(array $user, int $doneLimit = 30): array
{
    $map = function (array $t): array {
        return ['id' => (int)$t['id'], 'title' => $t['title'], 'kind' => 'work', 'tag' => $t['tag'], 'note' => $t['note'], 'family_shared' => false,
            'done_at' => $t['done_at'] ?? null, 'status' => todo_status_of($t), 'owner_id' => (int)$t['owner_id'], 'owner_name' => $t['owner_name'], 'editable' => false];
    };
    $base = "SELECT t.*, u.name AS owner_name FROM todos t JOIN users u ON u.id = t.owner_id WHERE t.kind = 'work' AND t.owner_id <> ? AND u.active = 1";
    return [
        'todos' => todo_with_comment_stats(array_map($map, rows($base . ' AND t.done_at IS NULL ORDER BY u.name, t.sort_order, t.id', [$user['id']]))),
        'done' => todo_with_comment_stats(array_map($map, rows($base . ' AND t.done_at IS NOT NULL ORDER BY t.done_at DESC, t.id DESC LIMIT ' . (int)$doneLimit, [$user['id']]))),
    ];
}

/** 業務版は業務のToDoだけ、プライベート版はプライベートのToDoだけ（分けて見せる） */
function todo_view_kind(string $view): string
{
    return $view === 'team' ? 'work' : 'private';
}

/** 未完了のToDo。@param string $view 'team' なら業務のToDoだけ、'me' ならプライベートのToDoだけ */
function list_todos(array $user, string $view): array
{
    $sql = 'SELECT * FROM todos WHERE owner_id = ? AND done_at IS NULL AND kind = ? ORDER BY sort_order, id';
    return todo_with_event_dates(todo_with_comment_stats(array_map('todo_for_client', rows($sql, [$user['id'], todo_view_kind($view)]))));
}

/** 完了したToDo（新しい順）。業務版は業務のToDoだけ、プライベート版はプライベートのToDoだけ */
function list_done_todos(array $user, string $view, int $limit = 100): array
{
    $sql = 'SELECT * FROM todos WHERE owner_id = ? AND done_at IS NOT NULL AND kind = ? ORDER BY done_at DESC, id DESC LIMIT ' . (int)$limit;
    return todo_with_event_dates(todo_with_comment_stats(array_map('todo_for_client', rows($sql, [$user['id'], todo_view_kind($view)]))));
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

/** 完了したToDoをまとめて消す。業務版は業務のものだけ、プライベート版はプライベートのものだけ */
function clear_done_todos(array $user, string $view): int
{
    $k = todo_view_kind($view);
    todo_detach_events('SELECT id FROM todos WHERE owner_id = ? AND done_at IS NOT NULL AND kind = ?', [$user['id'], $k]);
    todo_comments_purge('SELECT id FROM todos WHERE owner_id = ? AND done_at IS NOT NULL AND kind = ?', [$user['id'], $k]);
    $st = q('DELETE FROM todos WHERE owner_id = ? AND done_at IS NOT NULL AND kind = ?', [$user['id'], $k]);
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
    $data = ['kind' => $kind, 'title' => $title, 'tag' => $tag, 'note' => $note, 'family_shared' => $fam];
    if (array_key_exists('due', $in)) { // 期限日（空なら、期限なし）。送られてこなければ、いまの期限日を変えない
        $due = trim((string)$in['due']);
        if ($due !== '' && !valid_date($due)) {
            return [null, '期限日を正しく入力してください。'];
        }
        $data['due_date'] = $due !== '' ? $due : null;
    }
    return [$data, null];
}

function save_todo(array $data, array $user, ?array $existing): array
{
    if ($existing) {
        q('UPDATE todos SET title = ?, kind = ?, tag = ?, note = ?, family_shared = ? WHERE id = ?', [$data['title'], $data['kind'], $data['tag'], $data['note'], $data['family_shared'], $existing['id']]);
        if (array_key_exists('due_date', $data)) {
            q('UPDATE todos SET due_date = ? WHERE id = ?', [$data['due_date'], $existing['id']]);
        }
        $id = (int)$existing['id'];
        if ($existing['kind'] !== $data['kind'] || $existing['title'] !== $data['title'] || $existing['note'] !== $data['note']
            || ($data['kind'] === 'work' && $existing['tag'] !== $data['tag']) || (int)$existing['family_shared'] !== (int)$data['family_shared']) {
            todo_sync_events($id, $data); // 件名・メモ・種類・分類・共有を変えたら、カレンダーに置いた予定も同じにする（プライベートにしたのに、予定が全員に見えたままにならないように。件名も揃える）
        }
    } else {
        $max = row('SELECT MAX(sort_order) AS m FROM todos WHERE owner_id = ?', [$user['id']]);
        q('INSERT INTO todos (owner_id, title, kind, tag, note, family_shared, due_date, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [$user['id'], $data['title'], $data['kind'], $data['tag'], $data['note'], $data['family_shared'], $data['due_date'] ?? null, (int)($max['m'] ?? 0) + 1, now_str()]);
        $id = (int)db()->lastInsertId();
    }
    return row('SELECT * FROM todos WHERE id = ?', [$id]);
}

/**
 * ToDo を、指定した日のカレンダーの予定として置く。ToDo は消えず、自動で「進行中」になり、リストにも残る。
 * 完了にすると、カレンダーの予定に取り消し線が引かれる。すでに置いてあるToDoは、新しい日に動く（予定は1つ）。
 * 業務のToDoは全社員に見える業務の予定になる。
 */
function schedule_todo(array $todo, string $date, array $user): array
{
    if ($todo['done_at'] !== null) {
        throw new RuntimeException('完了したToDoは予定にできません。先に未完了に戻してください。');
    }
    $linked = row('SELECT * FROM events WHERE todo_id = ? AND owner_id = ? ORDER BY id LIMIT 1', [$todo['id'], $user['id']]);
    if ($linked) {
        $event = move_event($linked, $date);
    } else {
        $event = save_event([
            'kind' => $todo['kind'], 'title' => $todo['title'], 'tag' => $todo['tag'], 'start' => $date, 'end' => $date,
            'start_time' => '', 'end_time' => '', 'note' => $todo['note'], 'owner_id' => (int)$user['id'],
            'family_shared' => (int)$todo['family_shared'],
        ], $user, null);
        q('UPDATE events SET todo_id = ? WHERE id = ?', [$todo['id'], $event['id']]);
        $event['todo_id'] = (int)$todo['id'];
    }
    set_todo_status($todo, 'doing');
    return $event;
}

/**
 * カレンダーで作った（ToDoと結びついていない）予定を、ToDoリストにも入れる。予定とToDoは結びつき、状態（未着手・進行中・完了）は、どちらからでも変えられる。
 * 入れられるのは、自分の業務・プライベートの予定（休みは入れない）。毎月の繰り返しから作られた予定は、その1回分だけが ToDo になる（完了にすると、その回だけ取り消し線）。入れたら ToDo を、入れなかったら null を返す
 */
function event_attach_todo(array $e, array $user, string $status): ?array
{
    if (!in_array($status, ['todo', 'doing', 'done'], true) || $e['kind'] === 'off'
        || ($e['todo_id'] ?? null) !== null || (int)$e['owner_id'] !== (int)$user['id']) {
        return null;
    }
    $todo = save_todo(['kind' => $e['kind'], 'title' => $e['title'], 'tag' => $e['kind'] === 'work' ? $e['tag'] : '', 'note' => $e['note'], 'family_shared' => (int)$e['family_shared']], $user, null);
    q('UPDATE events SET todo_id = ? WHERE id = ?', [$todo['id'], $e['id']]);
    return set_todo_status($todo, $status);
}

/**
 * 結びついた予定を編集したとき、元のToDoの件名・メモ・種類・分類・共有を、予定に合わせる（ToDoリスト・日報に、古い名前が残らないように）。
 * 予定を「休み」に変えたときは、結びつきを外す（休みはToDoにならない）。ToDoの状態（未着手・進行中・完了）と期限日は、変えない
 */
function event_sync_todo(array $e): void
{
    if (($e['todo_id'] ?? null) === null) {
        return;
    }
    if ($e['kind'] === 'off') {
        q('UPDATE events SET todo_id = NULL WHERE id = ?', [$e['id']]);
        return;
    }
    q('UPDATE todos SET title = ?, kind = ?, tag = ?, note = ?, family_shared = ? WHERE id = ? AND owner_id = ?',
        [$e['title'], $e['kind'], $e['kind'] === 'work' ? $e['tag'] : '', $e['note'], (int)$e['family_shared'], $e['todo_id'], $e['owner_id']]);
}

/** ToDoの種類を変えたとき、結びついた予定の種類・分類・共有を、ToDoに合わせる（家族用の更新履歴にも、変更として残す） */
function todo_sync_events(int $todoId, array $data): void
{
    foreach (rows('SELECT * FROM events WHERE todo_id = ?', [$todoId]) as $before) {
        q('UPDATE events SET kind = ?, tag = ?, family_shared = ?, title = ?, note = ?, updated_at = ? WHERE id = ?', [$data['kind'], $data['kind'] === 'work' ? $data['tag'] : '', $data['family_shared'], $data['title'], $data['note'], now_str(), $before['id']]);
        event_changed($before, row('SELECT * FROM events WHERE id = ?', [$before['id']]));
    }
}

/** 消すToDoと結びついた予定は、ふつうの予定として残す（結びつきだけ外す） */
function todo_detach_events(string $todoIdsSql, array $params): void
{
    q("UPDATE events SET todo_id = NULL WHERE todo_id IN ($todoIdsSql)", $params);
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
    $todo = ($e['todo_id'] ?? null) !== null ? find_todo((int)$e['todo_id'], $user) : null; // ToDoから置いた予定は、元のToDoに戻す
    if (!$todo) {
        $todo = save_todo(['kind' => $e['kind'], 'title' => $e['title'], 'tag' => $e['tag'], 'note' => $e['note'], 'family_shared' => (int)$e['family_shared']], $user, null);
    }
    q('DELETE FROM events WHERE id = ?', [$e['id']]);
    event_changed($e, null);
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

/**
 * メモのHTMLを安全な形にする。許すのは div / br / s（取り消し線）だけ。属性・スクリプトは全て消す。
 * ただし div の印は残す: data-todo（元のToDoの番号。数字だけ）・data-st（todo / doing / done）・data-tr（転記された行）、
 * 日付の行の data-md（cur / next）と data-date（YYYY-MM-DD）。
 */
function sanitize_memo_html(string $html): string
{
    $html = mb_substr($html, 0, MEMO_MAX_CHARS * 3);
    $html = preg_replace('#<(script|style|iframe|object|embed|template)\b[^>]*>.*?</\1\s*>#is', '', $html);
    $html = strip_tags($html, '<div><p><br><s><strike><del>');
    // 許す形の目印だけを残し、それ以外の「<」は、文字（&lt;）にする（「< script>」のような、空白をはさんだ形も、タグにならない）
    $html = preg_replace_callback('#<(/?)(div|p|br|s|strike|del)\b([^>]*)>#i', function ($m) {
        $tag = strtolower($m[2]);
        if ($m[1] === '' && $tag === 'div') {
            $attrs = '';
            if (preg_match('#data-md\\s*=\\s*["\']?(cur|next)\\b#i', $m[3], $a) && preg_match('#data-date\\s*=\\s*["\']?(\\d{4}-\\d{2}-\\d{2})#', $m[3], $d)) {
                return '<div data-md="' . strtolower($a[1]) . '" data-date="' . $d[1] . '">'; // 日付の行
            }
            if (preg_match('#data-todo\\s*=\\s*["\']?(\\d{1,10})#i', $m[3], $a)) {
                $attrs .= ' data-todo="' . (int)$a[1] . '"';
                if (preg_match('#data-st\\s*=\\s*["\']?(todo|doing|done)\\b#i', $m[3], $b)) {
                    $attrs .= ' data-st="' . strtolower($b[1]) . '"';
                }
            }
            if (preg_match('#data-tr\\s*=\\s*["\']?1#', $m[3])) {
                $attrs .= ' data-tr="1"'; // 次回出勤日に転記された行
            }
            return '<div' . $attrs . '>';
        }
        return '<' . $m[1] . $tag . '>'; // 属性を全て取り除く
    }, $html);
    $html = preg_replace('#<(/?)(strike|del)>#i', '<$1s>', $html);
    $html = preg_replace('#<(/?)p>#i', '<$1div>', $html);
    $html = preg_replace('#<br\s*/?>#i', '<br>', $html);
    return preg_replace('#<(?!/?(?:div|br|s)(?:\s[^>]*)?>)#i', '&lt;', $html);
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

/* ------------------------------------------------------------------
 * 日報メモは、1つの入力欄（本人だけ）。文章の中の、「【10/13　予定・To Do】」の行（当日）と、
 * 「【10/14　予定・To Do】」の行（次回出勤日）の日付は、出勤日に合わせて自動で入れ替わる（画面側で書き換える）。
 * 当日の項目のうち、取り消し線のないものは、次回出勤日に転記される。日が進むと、次回出勤日の項目が、当日の項目になる。
 * 行の印（div の data-*）: data-md=cur/next と data-date = 日付の行 / data-tr = 転記された行 / data-todo, data-st = ToDoから入れた行。
 * 日が進んだときの前日の日報は、memo_days に、日ごとの控えとして残す（取り戻せるように）。
 * ------------------------------------------------------------------ */

const MEMO_KEEP_DAYS = 120;

/**
 * 出勤日。平日で、祝日・会社の休業日ではなく、本人の（終日の）休みでもない日。半休の日は出勤日に数える。
 * @return string[] $from（を含む）以降の出勤日を、$count 日分（見つからなければ、あるだけ）
 */
function work_days_from(array $user, string $from, int $count = 2): array
{
    $to = date('Y-m-d', strtotime($from . ' +120 day'));
    $hol = holiday_map($from, $to);
    $off = [];
    foreach (rows("SELECT tag, start_date, end_date FROM events WHERE kind = 'off' AND owner_id = ? AND start_date <= ? AND end_date >= ?", [$user['id'], $to, $from]) as $e) {
        if (mb_strpos((string)$e['tag'], '半休') !== false) {
            continue;
        }
        for ($t = strtotime(max($e['start_date'], $from)), $end = strtotime(min($e['end_date'], $to)); $t <= $end; $t = strtotime('+1 day', $t)) {
            $off[date('Y-m-d', $t)] = true;
        }
    }
    $days = [];
    for ($t = strtotime($from), $end = strtotime($to); $t <= $end && count($days) < $count; $t = strtotime('+1 day', $t)) {
        $d = date('Y-m-d', $t);
        if ((int)date('N', $t) <= 5 && !isset($hol[$d]) && !isset($off[$d])) {
            $days[] = $d;
        }
    }
    return $days;
}

/** 日報の本文から、「当日」の行の日付（なければ null） */
function memo_cur_date(string $html): ?string
{
    return preg_match('#<div data-md="cur" data-date="(\d{4}-\d{2}-\d{2})"#', $html, $m) ? $m[1] : null;
}

/**
 * 日報の状態。cur = 当日の日付 / next = 次回出勤日 / html = 本文（まだ無ければ空）。
 * seed = 本文がまだ構造化されていないとき（以前の版からの更新）の、引き継ぎ元。
 */
function get_memo_state(array $user): array
{
    $today = date('Y-m-d');
    $days = work_days_from($user, $today, 2);
    while (count($days) < 2) { // 出勤日が見つからない（長期休暇中など）ときも、2つ出す
        $days[] = date('Y-m-d', strtotime(($days ? end($days) : $today) . ' +1 day'));
    }
    $r = row('SELECT body FROM memos WHERE owner_id = ?', [$user['id']]);
    $html = $r ? sanitize_memo_html((string)$r['body']) : '';
    $out = ['today' => $today, 'cur' => $days[0], 'next' => $days[1], 'html' => $html, 'history' => memo_history_days($user), 'tpl' => memo_template_get($user)];
    if (strpos($html, 'data-md="cur"') === false) {
        $seed = ['cur' => '', 'next' => '', 'old' => $html];
        foreach (['cur', 'next'] as $k) {
            $d = row('SELECT body FROM memo_days WHERE owner_id = ? AND day = ?', [$user['id'], $out[$k]]);
            $seed[$k] = $d ? sanitize_memo_html((string)$d['body']) : '';
        }
        $out['html'] = '';
        $out['seed'] = $seed;
    }
    return $out;
}

/* 日報の雛形（本人が決める）。「雛形に戻す」と、初めて開いたときに使う文面。app_meta に、本人ごとに1つ（memo_tpl_<社員番号>）。
 * 項目（当日・次回出勤日の下の行）は含めない。日付の行（data-md）は、2つ必要（日付は、使うときに入れ替わる）。 */
const MEMO_TPL_MAX = 1900; // 文字数（app_meta の値は 2000 文字まで）

function memo_template_get(array $user): string
{
    $r = row('SELECT meta_value FROM app_meta WHERE meta_key = ?', ['memo_tpl_' . (int)$user['id']]);
    return $r ? sanitize_memo_html((string)$r['meta_value']) : '';
}

/** 雛形を保存する（空にすると、標準の雛形に戻る）。保存した雛形を返す */
function memo_template_save(string $html, array $user): string
{
    $key = 'memo_tpl_' . (int)$user['id'];
    $clean = trim($html) === '' ? '' : sanitize_memo_html($html);
    $clean = preg_replace('#\s+data-(todo|st|tr)="[^"]*"#', '', $clean); // 項目の印は、雛形に持ち込まない
    if ($clean !== '') {
        if (substr_count($clean, 'data-md="cur"') !== 1 || substr_count($clean, 'data-md="next"') !== 1) {
            throw new RuntimeException('日付の行（「【10/15　予定・To Do】」）が、当日・次回出勤日の2つ必要です。');
        }
        if (mb_strlen($clean) > MEMO_TPL_MAX) {
            throw new RuntimeException('雛形が長すぎます。挨拶・締めの文を短くしてください。');
        }
    }
    q('DELETE FROM app_meta WHERE meta_key = ?', [$key]);
    if ($clean !== '') {
        q('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', [$key, $clean]);
    }
    return $clean;
}

/** 日報を保存する。日が進んでいたら（当日の日付が変わったら）、前の日報を、その日の控えとして残す */
function save_memo(string $html, array $user): string
{
    $clean = sanitize_memo_html($html);
    if (mb_strlen(strip_tags($clean)) > MEMO_MAX_CHARS) {
        throw new RuntimeException('メモが長すぎます（' . MEMO_MAX_CHARS . '文字まで）。');
    }
    $r = row('SELECT body FROM memos WHERE owner_id = ?', [$user['id']]);
    if ($r) {
        $oldDay = memo_cur_date((string)$r['body']);
        $newDay = memo_cur_date($clean);
        if ($oldDay !== null && $newDay !== null && $newDay > $oldDay) {
            if (row('SELECT 1 AS x FROM memo_days WHERE owner_id = ? AND day = ?', [$user['id'], $oldDay])) {
                q('UPDATE memo_days SET body = ?, updated_at = ? WHERE owner_id = ? AND day = ?', [$r['body'], now_str(), $user['id'], $oldDay]);
            } else {
                q('INSERT INTO memo_days (owner_id, day, body, updated_at) VALUES (?,?,?,?)', [$user['id'], $oldDay, $r['body'], now_str()]);
            }
            q('DELETE FROM memo_days WHERE owner_id = ? AND day < ?', [$user['id'], date('Y-m-d', strtotime('-' . MEMO_KEEP_DAYS . ' day'))]);
        }
        q('UPDATE memos SET body = ?, updated_at = ? WHERE owner_id = ?', [$clean, now_str(), $user['id']]);
    } else {
        q('INSERT INTO memos (owner_id, body, updated_at) VALUES (?,?,?)', [$user['id'], $clean, now_str()]);
    }
    return $clean;
}

/** 過去の日報（日が進んだときの控え）の日付。新しい順 */
function memo_history_days(array $user, int $limit = 60): array
{
    return array_map(function ($r) { return substr((string)$r['day'], 0, 10); },
        rows('SELECT day FROM memo_days WHERE owner_id = ? ORDER BY day DESC LIMIT ' . (int)$limit, [$user['id']]));
}

function memo_history_get(string $day, array $user): ?string
{
    if (!valid_date($day)) {
        return null;
    }
    $r = row('SELECT body FROM memo_days WHERE owner_id = ? AND day = ?', [$user['id'], $day]);
    return $r ? sanitize_memo_html((string)$r['body']) : null;
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
 * その月の、指定した社員たちの出勤日・休みの日数。営業日は「平日で、祝日・会社の休業日でない日」。
 * 休みは営業日の分だけ数える（土日祝にまたがる休みは、平日の分だけ）。午前・午後の半休は0.5日。
 * @param array<int,array{id:int|string,name:string}> $users
 * @return array{month:string,biz_days:int,people:array<int,array{id:int,name:string,off_days:float,work_days:float,by_tag:array<int,array{tag:string,days:float}>}>}
 */
function month_summary_multi(array $users, string $ym): array
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
    $people = [];
    foreach ($users as $u) {
        $perDay = [];
        $perDayTag = [];
        foreach (rows("SELECT tag, start_date, end_date FROM events WHERE kind = 'off' AND owner_id = ? AND start_date <= ? AND end_date >= ?", [$u['id'], $last, $first]) as $e) {
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
        $off = (float)array_sum($perDay);
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
        $people[] = ['id' => (int)$u['id'], 'name' => (string)$u['name'], 'off_days' => $off, 'work_days' => count($biz) - $off, 'by_tag' => $list];
    }
    return ['month' => $ym, 'biz_days' => count($biz), 'people' => $people];
}

/**
 * その月の、自分の出勤日・休みの日数（month_summary_multi の1人分）。
 * @return array{month:string,biz_days:int,off_days:float,work_days:float,by_tag:array<int,array{tag:string,days:float}>}
 */
function month_summary(array $user, string $ym): array
{
    $m = month_summary_multi([['id' => $user['id'], 'name' => $user['name'] ?? '']], $ym);
    $p = $m['people'][0];
    return ['month' => $m['month'], 'biz_days' => $m['biz_days'], 'off_days' => $p['off_days'], 'work_days' => $p['work_days'], 'by_tag' => $p['by_tag']];
}

/**
 * 月のまとめに出す社員。業務版で全社なら全社員（自分が先頭）、特定の社員を選んでいればその人だけ。プライベート版は自分だけ。
 * @return array<int,array{id:int,name:string}>
 */
function summary_users(array $user, string $view, int $who): array
{
    $all = array_map(function ($u) { return ['id' => (int)$u['id'], 'name' => $u['name']]; }, rows('SELECT id, name FROM users WHERE active = 1 ORDER BY name'));
    if ($view !== 'team') {
        return [['id' => (int)$user['id'], 'name' => $user['name']]];
    }
    if ($who > 0) {
        return array_values(array_filter($all, function ($u) use ($who) { return $u['id'] === $who; }));
    }
    usort($all, function ($a, $b) use ($user) { return ($b['id'] === (int)$user['id']) <=> ($a['id'] === (int)$user['id']); }); // 自分が先頭
    return $all;
}


/* ------------------------------------------------------------------
 * 家族用リンクの「更新履歴」。家族に見える予定の追加・変更・削除だけを、いつ・何をしたかつきで残す。
 * 家族に見えない予定（業務・プライベートの非共有など）は、記録そのものを残さない。
 * ------------------------------------------------------------------ */

const EVENT_LOG_KEEP_DAYS = 120;

/** この予定は、持ち主の家族用リンクに見えるか（share_events と同じ条件） */
function event_family_visible(array $e): bool
{
    if ((int)$e['family_shared'] === 1) {
        return true;
    }
    $fs = get_family_share(['id' => (int)$e['owner_id']]);
    if ($e['kind'] === 'off' && $fs['off']) {
        return true;
    }
    return $e['kind'] === 'work' && in_array($e['tag'], $fs['tags'], true);
}

function log_md(string $d): string
{
    return (int)substr($d, 5, 2) . '/' . (int)substr($d, 8, 2);
}

function log_span(array $e): string
{
    return $e['start_date'] === $e['end_date'] ? log_md($e['start_date']) : log_md($e['start_date']) . '〜' . log_md($e['end_date']);
}

function log_time(array $e): string
{
    if ($e['start_time'] === '' && $e['end_time'] === '') {
        return '時刻なし';
    }
    return $e['start_time'] . ($e['end_time'] !== '' ? '〜' . $e['end_time'] : '');
}

/** 変更前後の違いを、家族に見せてよい範囲の文章にする。休みは、日付・時刻・メモだけ（種類や件名は見せない） */
function event_change_detail(array $b, array $a): string
{
    $parts = [];
    $off = $a['kind'] === 'off';
    if (!$off && $b['kind'] !== 'off' && $b['title'] !== $a['title']) {
        $parts[] = '件名「' . $b['title'] . '」→「' . $a['title'] . '」';
    }
    if ($b['start_date'] !== $a['start_date'] || $b['end_date'] !== $a['end_date']) {
        $parts[] = '日付 ' . log_span($b) . ' → ' . log_span($a);
    }
    if ($b['start_time'] !== $a['start_time'] || $b['end_time'] !== $a['end_time']) {
        $parts[] = '時刻 ' . log_time($b) . ' → ' . log_time($a);
    }
    if (!$off && $b['kind'] === 'work' && $a['kind'] === 'work' && $b['tag'] !== $a['tag']) {
        $parts[] = '分類 ' . $b['tag'] . ' → ' . $a['tag'];
    }
    if ($b['note'] !== $a['note']) {
        $parts[] = 'メモを更新';
    }
    if ((int)($b['important'] ?? 0) !== (int)($a['important'] ?? 0)) {
        $parts[] = (int)$a['important'] === 1 ? '重要にしました' : '重要を外しました';
    }
    return mb_substr(implode('／', $parts), 0, 480);
}

/** 予定の変更を、家族用の更新履歴に残す（家族に見えるものだけ）。記録に失敗しても、予定の保存は止めない */
function log_event_change(?array $before, ?array $after): void
{
    try {
        $vb = $before !== null && event_family_visible($before);
        $va = $after !== null && event_family_visible($after);
        if (!$vb && !$va) {
            return;
        }
        if ($vb && $va) {
            $action = 'update';
            $detail = event_change_detail($before, $after);
            if ($detail === '') {
                return; // 家族に見える内容は変わっていない
            }
            $ref = $after;
        } elseif ($va) {
            $action = 'add';
            $detail = '';
            $ref = $after;
        } else { // 削除された、または家族に見えなくなった
            $action = 'delete';
            $detail = '';
            $ref = $before;
        }
        $title = $ref['kind'] === 'off' ? '休み' : $ref['title'];
        q('INSERT INTO event_log (event_id, owner_id, action, title, date_from, date_to, detail, changed_at, kind, start_time, end_time) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
            $ref['id'], $ref['owner_id'], $action, mb_substr($title, 0, 100), $ref['start_date'], $ref['end_date'], $detail, now_str(),
            $ref['kind'], (string)$ref['start_time'], (string)$ref['end_time'],
        ]);
        q('DELETE FROM event_log WHERE changed_at < ?', [date('Y-m-d H:i:s', time() - EVENT_LOG_KEEP_DAYS * 86400)]);
    } catch (Throwable $t) {
        error_log('[schedule] 更新履歴の記録に失敗: ' . $t->getMessage());
    }
}

/**
 * 家族用リンクで、削除された予定を、取消線つきで残しておく日数。家族が「確認した」で消すか、この日数が過ぎると消える。
 */
const TOMBSTONE_KEEP_DAYS = 30;

/**
 * 削除された予定を、カレンダーに取消線で出すための一覧。
 * 予定そのものが消えているものだけ（「家族に共有」を外しただけの予定は、すぐ見えなくなる。件名を残さないため）。持ち主が消した予定の「見せ方」は、share_events と同じ（休みは「休み」とだけ）。
 * @param int[] $visibleIds いま家族に見えている予定の id（念のため、重ならないようにする）
 */
function family_tombstones(int $ownerId, string $from, string $to, array $visibleIds, array $colors): array
{
    try {
        $rows = rows("SELECT l.* FROM event_log l WHERE l.owner_id = ? AND l.action = 'delete' AND l.kind <> '' AND l.changed_at >= ? AND l.date_from <= ? AND l.date_to >= ?
                  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = l.event_id)
                  AND NOT EXISTS (SELECT 1 FROM event_log n WHERE n.owner_id = l.owner_id AND n.event_id = l.event_id AND n.id > l.id)
                  ORDER BY l.date_from, l.id", [$ownerId, date('Y-m-d H:i:s', time() - TOMBSTONE_KEEP_DAYS * 86400), $to, $from]);
    } catch (PDOException $e) {
        error_log('[schedule] 削除された予定の取得に失敗（更新直後で、データベースの更新が済んでいない可能性）: ' . $e->getMessage());
        return [];
    }
    $own = row('SELECT name FROM users WHERE id = ?', [$ownerId]);
    $out = [];
    foreach ($rows as $r) {
        if (in_array((int)$r['event_id'], $visibleIds, true)) {
            continue;
        }
        $out[] = [
            'id' => -(int)$r['id'], 'log_id' => (int)$r['id'], 'deleted' => true, 'deleted_at' => $r['changed_at'],
            'title' => $r['title'], 'kind' => $r['kind'], 'tag' => '', 'start' => $r['date_from'], 'end' => $r['date_to'],
            'start_time' => $r['start_time'], 'end_time' => $r['end_time'], 'note' => '', 'owner_id' => $ownerId, 'owner_name' => $own ? $own['name'] : '',
            'recurring' => false, 'series_id' => null, 'family_shared' => true, 'important' => false, 'editable' => false,
            'colors' => (object)($colors[$ownerId] ?? []),
        ];
    }
    return $out;
}

/**
 * 家族用リンクに見せる更新履歴（新しい順）。
 * @return array{now:string,recent_since:string,entries:array<int,array<string,mixed>>}
 */
function family_event_log(int $ownerId, int $limit = 100): array
{
    $rows = rows('SELECT * FROM event_log WHERE owner_id = ? ORDER BY id DESC LIMIT ' . (int)$limit, [$ownerId]);
    return [
        'now' => now_str(),
        'last_id' => $rows ? (int)$rows[0]['id'] : 0, // 「どこまで見たか」を、時刻ではなく番号で覚えるため
        'recent_since' => date('Y-m-d H:i:s', time() - 3 * 86400), // 前回見た時刻を覚えられないブラウザ用の目安
        'entries' => array_map(function ($r) {
            return ['id' => (int)$r['id'], 'event_id' => (int)$r['event_id'], 'action' => $r['action'], 'title' => $r['title'],
                'from' => $r['date_from'], 'to' => $r['date_to'], 'detail' => $r['detail'], 'at' => $r['changed_at']];
        }, $rows),
    ];
}


/**
 * 家族用の更新履歴を削除する（予定の持ち主が、自分の分だけ）。$id が null なら、自分の分をすべて。削除した件数を返す。
 * 削除された予定の「取消線」表示（家族が確認するまで残る）も、この記録から作っているので、記録といっしょに消える。
 * 予定そのものは消えない。
 */
function family_log_delete(int $ownerId, ?int $id): int
{
    if ($id === null) {
        return q('DELETE FROM event_log WHERE owner_id = ?', [$ownerId])->rowCount();
    }
    return q('DELETE FROM event_log WHERE owner_id = ? AND id = ?', [$ownerId, $id])->rowCount();
}


/** 予定が追加・変更・削除されたあとの後始末（休みが動いたら繰り返し業務を組み直す。家族用の更新履歴に残す） */
function event_changed(?array $before, ?array $after): void
{
    $ref = $after ?? $before;
    if ($ref !== null && (($before['kind'] ?? '') === 'off' || ($after['kind'] ?? '') === 'off')) {
        try {
            rematerialize_owner((int)$ref['owner_id']); // 休みを優先して、その人の繰り返し業務の日付を決め直す
        } catch (Throwable $t) {
            error_log('[schedule] 繰り返し業務の組み直しに失敗: ' . $t->getMessage());
        }
    }
    log_event_change($before, $after);
    try {
        audit_event_change($before, $after); // 管理者用の変更履歴（プライベートの予定は記録しない）
    } catch (Throwable $t) {
        error_log('[schedule] 変更履歴の記録に失敗: ' . $t->getMessage());
    }
}


/* ------------------------------------------------------------------
 * 個人の表示設定（予定の色）。本人の画面だけに効く。
 * ------------------------------------------------------------------ */

const COLOR_KEYS = ['work', 'rec', 'off', 'private']; // 単発の業務・繰り返しの業務・休み・プライベート

/** カレンダーで「休みの人がいる日」のセルを薄く塗りつぶす設定（本人の画面だけ）。色は '#rrggbb'、空文字なら標準の色 */
function clean_offday($v): array
{
    $v = is_array($v) ? $v : [];
    $c = isset($v['color']) ? (string)$v['color'] : '';
    return ['on' => !array_key_exists('on', $v) || !empty($v['on']), 'color' => preg_match('/^#[0-9a-fA-F]{6}$/', $c) ? strtolower($c) : ''];
}

/** @return array{colors:array<string,string>,offday:array{on:bool,color:string}} 色は '#rrggbb'。空文字なら、標準の色 */
function get_prefs(array $user): array
{
    $r = row('SELECT prefs FROM users WHERE id = ?', [$user['id']]);
    $j = $r && $r['prefs'] !== '' ? json_decode($r['prefs'], true) : [];
    $colors = [];
    foreach (COLOR_KEYS as $k) {
        $v = is_array($j) && isset($j['colors'][$k]) ? (string)$j['colors'][$k] : '';
        $colors[$k] = preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? strtolower($v) : '';
    }
    return ['colors' => $colors, 'offday' => clean_offday(is_array($j) ? ($j['offday'] ?? null) : null)];
}

/** 色の設定を保存する。#rrggbb 以外（空欄を含む）は「標準の色」に戻す。$offday が null なら、休みの日のセルの設定は、いまのまま */
function save_color_prefs(array $user, array $in, $offday = null): array
{
    $colors = [];
    foreach (COLOR_KEYS as $k) {
        $v = isset($in[$k]) ? (string)$in[$k] : '';
        $colors[$k] = preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? strtolower($v) : '';
    }
    $off = $offday === null ? get_prefs($user)['offday'] : clean_offday($offday);
    q('UPDATE users SET prefs = ? WHERE id = ?', [json_encode(['colors' => $colors, 'offday' => $off]), $user['id']]);
    return ['colors' => $colors, 'offday' => $off];
}
