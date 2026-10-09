<?php
// 予定の取得・検証・保存。プライベート予定の扱いは、すべてこのファイルで決める。
//
// ルール:
//   private … 本人にしか返さない（管理者にも返さない）
//   work    … 全社員に見える。プライベート版ではタグで絞り込める
//   off     … 全社員に見える

require_once __DIR__ . '/recurrence.php';

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
 * @param array  $opts ['tags' => 表示する業務タグ, 'showOff' => 同僚の休みを出すか]
 */
function list_events(array $user, string $from, string $to, string $view, array $opts = []): array
{
    $params = [$to, $from];
    if ($view === 'team') {
        // 業務版: プライベート予定は条件にすら含めない
        $where = "kind IN ('work','off')";
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
    ], null];
}

function save_event(array $data, array $user, ?array $existing): array
{
    if ($existing) {
        // 持ち主と種類は編集で変えない（取り違えを防ぐ）
        $data['owner_id'] = (int)$existing['owner_id'];
        $data['kind'] = $existing['kind'];
        q('UPDATE events SET title=?, kind=?, tag=?, start_date=?, end_date=?, start_time=?, end_time=?, note=?, detached=?, updated_at=? WHERE id=?', [
            $data['title'], $data['kind'], $data['tag'], $data['start'], $data['end'], $data['start_time'], $data['end_time'], $data['note'],
            $existing['series_id'] !== null ? 1 : 0, now_str(), $existing['id'],
        ]);
        $id = (int)$existing['id'];
    } else {
        q('INSERT INTO events (owner_id,title,kind,tag,start_date,end_date,start_time,end_time,note,series_id,ym,detached,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,0,?,?,?)', [
            $data['owner_id'], $data['title'], $data['kind'], $data['tag'], $data['start'], $data['end'], $data['start_time'], $data['end_time'],
            $data['note'], $user['id'], now_str(), now_str(),
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
        ], $user, null);
    }
    return [$created, $skipped];
}
