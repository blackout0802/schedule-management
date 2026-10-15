<?php
// 「元に戻す」: 予定・ToDo を消した直後に、取り消せるようにする。
//
// 消すときに、消した中身を、ログイン中のセッション（サーバー側）に控える（最大10件・10分まで）。画面には、控えを呼び出すための合言葉（トークン）だけを渡す。
// 画面から中身を送り返すのではないので、他人の予定を作ったり、権限をすり抜けたりはできない（控えは、消した本人のセッションにしか無い）。
// 復元は、元の番号（id）で入れ直す。予定は、繰り返しの1回分なら、「この回を消した」という記録も外す。ToDo は、結びついていた予定も結び直す。
// ToDo のコメント・画像は、消すときに一緒に消えてしまうので、戻せない（コメントのある ToDo は、控えない）。

const UNDO_KEEP = 10;
const UNDO_TTL = 600;

/** 控えて、トークンを返す */
function undo_stash(string $type, array $data): string
{
    session_boot();
    $list = $_SESSION['undo'] ?? [];
    $now = time();
    foreach ($list as $k => $v) { // 古いものを捨てる
        if ($now - (int)$v['at'] > UNDO_TTL) {
            unset($list[$k]);
        }
    }
    $token = bin2hex(random_bytes(12));
    $list[$token] = ['type' => $type, 'at' => $now, 'data' => $data];
    while (count($list) > UNDO_KEEP) {
        reset($list);
        unset($list[key($list)]);
    }
    $_SESSION['undo'] = $list;
    return $token;
}

/** 控えを取り出す（1度きり）。なければ null */
function undo_take(string $token, string $type): ?array
{
    session_boot();
    $v = $_SESSION['undo'][$token] ?? null;
    if (!$v || $v['type'] !== $type || time() - (int)$v['at'] > UNDO_TTL) {
        return null;
    }
    unset($_SESSION['undo'][$token]);
    return $v['data'];
}

/** 表の列名のうち、控えにあるものだけで、元の番号のまま入れ直す。入れた行を返す */
function undo_insert_row(string $table, array $row): array
{
    $cols = backup_columns($table);
    $use = array_values(array_filter(array_keys($row), function ($c) use ($cols) { return in_array($c, $cols, true) && preg_match('/^[A-Za-z0-9_]+$/', (string)$c); }));
    q("INSERT INTO $table (" . implode(',', $use) . ') VALUES (' . implode(',', array_fill(0, count($use), '?')) . ')', array_map(function ($c) use ($row) { return $row[$c]; }, $use));
    return row("SELECT * FROM $table WHERE id = ?", [$row['id']]);
}

/** 消した予定を戻す。戻した予定の行を返す（戻せなければ RuntimeException） */
function undo_event_restore(array $snap, array $user): array
{
    if (!can_edit_event($snap, $user)) {
        throw new RuntimeException('この予定は戻せません。');
    }
    if (row('SELECT 1 AS x FROM events WHERE id = ?', [$snap['id']])) {
        throw new RuntimeException('この予定は、すでにあります。');
    }
    if ($snap['series_id'] !== null) {
        if (row('SELECT 1 AS x FROM series WHERE id = ?', [$snap['series_id']])) {
            q('DELETE FROM series_skips WHERE series_id = ? AND ym = ?', [$snap['series_id'], $snap['ym']]); // 「この回を消した」という記録を外す
        } else {
            $snap['series_id'] = null;
            $snap['ym'] = null;
        }
    }
    if (($snap['todo_id'] ?? null) !== null) { // 結びついていたToDoが残っていて、別の予定に使われていなければ、結び直す
        $t = row('SELECT id FROM todos WHERE id = ?', [$snap['todo_id']]);
        $used = $t ? row('SELECT 1 AS x FROM events WHERE todo_id = ?', [$snap['todo_id']]) : true;
        if (!$t || $used) {
            $snap['todo_id'] = null;
        }
    }
    $snap['updated_at'] = now_str();
    $e = undo_insert_row('events', $snap);
    event_changed(null, $e);
    return $e;
}

/** 消したToDoを戻す（結びついていた予定も、結び直す） */
function undo_todo_restore(array $snap, array $user): array
{
    $t = $snap['todo'];
    if ((int)$t['owner_id'] !== (int)$user['id']) {
        throw new RuntimeException('このToDoは戻せません。');
    }
    if (row('SELECT 1 AS x FROM todos WHERE id = ?', [$t['id']])) {
        throw new RuntimeException('このToDoは、すでにあります。');
    }
    $todo = undo_insert_row('todos', $t);
    foreach ((array)($snap['events'] ?? []) as $eid) {
        q('UPDATE events SET todo_id = ? WHERE id = ? AND todo_id IS NULL', [$todo['id'], (int)$eid]);
    }
    return $todo;
}

/** 取り消した会議室の予約を戻す。戻した行を返す（戻せなければ RuntimeException） */
function undo_room_restore(array $snap, array $user): array
{
    if ((int)$snap['owner_id'] !== (int)$user['id'] && !is_admin($user)) {
        throw new RuntimeException('この予約は戻せません。');
    }
    if (row('SELECT 1 AS x FROM room_bookings WHERE id = ?', [$snap['id']])) {
        throw new RuntimeException('この予約は、すでにあります。');
    }
    if (rooms_is_past($snap)) {
        throw new RuntimeException('終了した予約は、戻せません。');
    }
    $c = rooms_conflict((int)$snap['room_id'], $snap['bdate'], room_min($snap['start_time']), room_min($snap['end_time']));
    if ($c) {
        throw new RuntimeException('取り消したあとに、同じ時間の予約が入ったため、戻せません。');
    }
    $snap['updated_at'] = now_str();
    $b = undo_insert_row('room_bookings', $snap);
    $room = row('SELECT name FROM rooms WHERE id = ?', [(int)$b['room_id']]);
    audit_log('room', 'add', rooms_audit_label($b, (string)($room['name'] ?? '')), '', '取り消しを元に戻しました');
    return $b;
}
