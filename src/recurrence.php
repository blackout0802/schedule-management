<?php
// 繰り返しルール（series）から、各月の具体的な日付を求めて events に展開する。
//
// rule_type:
//   day           毎月 p_day 日。休日なら shift（prev=前営業日 / next=翌営業日 / none=そのまま）
//   weekday_nth   毎月 第 p_nth 週の p_weekday 曜日（p_nth = -1 で最終週）
//   first_bizdays 月初から p_count 営業日（1営業日目〜p_count営業日目の期間）
//   range         毎月 p_day 日〜p_day2 日の期間。bizonly=1 なら営業日だけに切り詰める
//   last_bizday   毎月の最終営業日

require_once __DIR__ . '/holidays.php';

const RULE_TYPES = ['day', 'weekday_nth', 'first_bizdays', 'range', 'last_bizday'];

function clamp_day(int $y, int $m, int $d): string
{
    $last = (int)date('t', mktime(0, 0, 0, $m, 1, $y));
    return sprintf('%04d-%02d-%02d', $y, $m, max(1, min($d, $last)));
}

/**
 * 指定した月の発生日を返す。その月に発生しなければ null。
 * @return array{0:string,1:string}|null [開始日, 終了日]
 */
function rule_dates(array $s, int $y, int $m, BizCalendar $cal): ?array
{
    switch ($s['rule_type']) {
        case 'day':
            $d = clamp_day($y, $m, (int)$s['p_day']);
            if ($s['shift'] === 'prev') {
                $d = $cal->shiftBack($d);
            } elseif ($s['shift'] === 'next') {
                $d = $cal->shiftForward($d);
            }
            return [$d, $d];

        case 'weekday_nth':
            $wd = (int)$s['p_weekday'];
            $nth = (int)$s['p_nth'];
            if ($nth === -1) {
                $d = (int)date('t', mktime(0, 0, 0, $m, 1, $y));
                while ((int)date('w', mktime(0, 0, 0, $m, $d, $y)) !== $wd) {
                    $d--;
                }
            } else {
                $first = (int)date('w', mktime(0, 0, 0, $m, 1, $y));
                $d = 1 + (($wd - $first + 7) % 7) + 7 * ($nth - 1);
                if ($d > (int)date('t', mktime(0, 0, 0, $m, 1, $y))) {
                    return null;
                }
            }
            $date = sprintf('%04d-%02d-%02d', $y, $m, $d);
            return [$date, $date];

        case 'first_bizdays':
            $n = max(1, (int)$s['p_count']);
            $cur = sprintf('%04d-%02d-01', $y, $m);
            $start = $end = null;
            $count = 0;
            for ($i = 0; $i < 31; $i++) {
                if ((int)substr($cur, 5, 2) !== $m) {
                    break;
                }
                if ($cal->isBusinessDay($cur)) {
                    $count++;
                    if ($start === null) {
                        $start = $cur;
                    }
                    $end = $cur;
                    if ($count >= $n) {
                        break;
                    }
                }
                $cur = date('Y-m-d', strtotime($cur . ' +1 day'));
            }
            return $start === null ? null : [$start, $end];

        case 'range':
            $from = clamp_day($y, $m, (int)$s['p_day']);
            $to = clamp_day($y, $m, (int)$s['p_day2']);
            if ($to < $from) {
                return null;
            }
            if ((int)$s['bizonly'] === 1) {
                $from = $cal->shiftForward($from);
                $to = $cal->shiftBack($to);
                if ($from > $to || substr($from, 0, 7) !== substr($to, 0, 7)) {
                    return null;
                }
            }
            return [$from, $to];

        case 'last_bizday':
            $d = $cal->shiftBack(clamp_day($y, $m, 31));
            return [$d, $d];
    }
    return null;
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

function rule_label(array $s): string
{
    $shift = ['none' => '', 'prev' => '（休日なら前営業日）', 'next' => '（休日なら翌営業日）'];
    switch ($s['rule_type']) {
        case 'day':
            return '毎月' . (int)$s['p_day'] . '日' . ($shift[$s['shift']] ?? '');
        case 'weekday_nth':
            $n = (int)$s['p_nth'] === -1 ? '最終' : '第' . (int)$s['p_nth'];
            return '毎月 ' . $n . WEEKDAY_JA[(int)$s['p_weekday']] . '曜日';
        case 'first_bizdays':
            return '毎月初の ' . (int)$s['p_count'] . '営業日';
        case 'range':
            return '毎月' . (int)$s['p_day'] . '日〜' . (int)$s['p_day2'] . '日' . ((int)$s['bizonly'] === 1 ? '（営業日のみ）' : '');
        case 'last_bizday':
            return '毎月の最終営業日';
    }
    return '';
}

/** 今月から $monthsAhead か月先までの発生日を返す（保存はしない） */
function series_preview(array $s, int $monthsAhead, BizCalendar $cal): array
{
    $out = [];
    $base = new DateTime('first day of this month');
    for ($i = 0; $i <= $monthsAhead; $i++) {
        $dt = (clone $base)->modify("+$i month");
        $y = (int)$dt->format('Y');
        $m = (int)$dt->format('n');
        $r = rule_dates($s, $y, $m, $cal);
        $out[] = ['ym' => sprintf('%04d-%02d', $y, $m), 'start' => $r ? $r[0] : null, 'end' => $r ? $r[1] : null];
    }
    return $out;
}

/** 本人が丸1日休みの日（日付 => true）。午前・午後の半休は、その日も働くので含めない */
function owner_leave_days(int $ownerId): array
{
    $set = [];
    $from = date('Y-m-01', strtotime('-1 month'));
    foreach (rows("SELECT start_date, end_date FROM events WHERE kind = 'off' AND owner_id = ? AND tag NOT LIKE ? AND end_date >= ?", [$ownerId, '%半休%', $from]) as $e) {
        $n = 0;
        for ($t = strtotime($e['start_date']); $t <= strtotime($e['end_date']) && $n < 400; $t = strtotime('+1 day', $t), $n++) {
            $set[date('Y-m-d', $t)] = true;
        }
    }
    return $set;
}

/**
 * 繰り返し業務の日付から、本人が休みの日を除く（休みを優先）。
 * - 期間のある業務: 先頭・末尾の休みの日を削る。残る営業日が無ければ、その月は作らない（途中の休みの日は、画面で隠す）
 * - 1日だけの業務: 休みの日に当たったら、同じ月の中で、直前の「営業日で休みでない日」に移す。無ければ作らない
 * @return ?array{0:string,1:string}
 */
function apply_leave_priority(string $start, string $end, array $leave, BizCalendar $cal): ?array
{
    if (!$leave) {
        return [$start, $end];
    }
    if ($start === $end) {
        if (!isset($leave[$start])) {
            return [$start, $end];
        }
        $ym = substr($start, 0, 7);
        $d = $start;
        for ($i = 0; $i < 31; $i++) {
            $d = date('Y-m-d', strtotime($d . ' -1 day'));
            if (substr($d, 0, 7) !== $ym) {
                return null;
            }
            if ($cal->isBusinessDay($d) && !isset($leave[$d])) {
                return [$d, $d];
            }
        }
        return null;
    }
    while ($start <= $end && isset($leave[$start])) {
        $start = date('Y-m-d', strtotime($start . ' +1 day'));
    }
    while ($end >= $start && isset($leave[$end])) {
        $end = date('Y-m-d', strtotime($end . ' -1 day'));
    }
    if ($start > $end) {
        return null;
    }
    for ($d = $start; $d <= $end; $d = date('Y-m-d', strtotime($d . ' +1 day'))) {
        if ($cal->isBusinessDay($d) && !isset($leave[$d])) {
            return [$start, $end];
        }
    }
    return null;
}

/** その人の繰り返し業務を、休みを優先して組み直す */
function rematerialize_owner(int $ownerId): int
{
    $cal = BizCalendar::fromDb();
    $n = 0;
    foreach (rows('SELECT id FROM series WHERE owner_id = ?', [$ownerId]) as $r) {
        $n += materialize_series((int)$r['id'], $cal);
    }
    return $n;
}

/**
 * 1つのルールを今月から12か月先まで events に展開する（何度実行しても同じ結果になる）。
 * - 個別に編集した予定（detached=1）と、スキップ指定した月には触れない
 * - ルールを変更した場合は、未編集の予定が新しい日付に更新される
 */
function materialize_series(int $seriesId, ?BizCalendar $cal = null, int $monthsAhead = 12): int
{
    $s = row('SELECT * FROM series WHERE id = ?', [$seriesId]);
    if (!$s) {
        return 0;
    }
    $cal = $cal ?: BizCalendar::fromDb();
    $skips = array_column(rows('SELECT ym FROM series_skips WHERE series_id = ?', [$seriesId]), 'ym');
    $existing = [];
    foreach (rows('SELECT * FROM events WHERE series_id = ?', [$seriesId]) as $e) {
        $existing[$e['ym']] = $e;
    }
    $changed = 0;
    $thisMonth = date('Y-m');
    $leave = owner_leave_days((int)$s['owner_id']);
    foreach (series_preview($s, $monthsAhead, $cal) as $p) {
        $ym = $p['ym'];
        if ($p['start'] !== null) { // 本人が休みの日は、繰り返し業務の日にしない（休みを優先）
            $adj = apply_leave_priority($p['start'], $p['end'], $leave, $cal);
            $p['start'] = $adj ? $adj[0] : null;
            $p['end'] = $adj ? $adj[1] : null;
        }
        $ev = $existing[$ym] ?? null;
        if (in_array($ym, $skips, true) || ($ev && (int)$ev['detached'] === 1)) {
            continue;
        }
        if ($p['start'] === null) {
            if ($ev) {
                q('DELETE FROM events WHERE id = ?', [$ev['id']]);
                $changed++;
            }
            continue;
        }
        if ($ev) {
            if ($ev['start_date'] !== $p['start'] || $ev['end_date'] !== $p['end'] || $ev['title'] !== $s['title']
                || $ev['tag'] !== $s['tag'] || $ev['start_time'] !== $s['start_time'] || $ev['end_time'] !== $s['end_time']
                || (int)$ev['owner_id'] !== (int)$s['owner_id']) {
                q('UPDATE events SET owner_id=?, title=?, tag=?, start_date=?, end_date=?, start_time=?, end_time=?, updated_at=? WHERE id=?', [
                    $s['owner_id'], $s['title'], $s['tag'], $p['start'], $p['end'], $s['start_time'], $s['end_time'], now_str(), $ev['id'],
                ]);
                $changed++;
            }
        } elseif ($ym >= $thisMonth) {
            q('INSERT INTO events (owner_id,title,kind,tag,start_date,end_date,start_time,end_time,note,family_shared,series_id,ym,detached,created_by,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,0,?,?,0,?,?,?)', [
                $s['owner_id'], $s['title'], 'work', $s['tag'], $p['start'], $p['end'], $s['start_time'], $s['end_time'], '',
                $seriesId, $ym, $s['owner_id'], now_str(), now_str(),
            ]);
            $changed++;
        }
    }
    return $changed;
}

function materialize_all(int $monthsAhead = 12): int
{
    $cal = BizCalendar::fromDb();
    $n = 0;
    foreach (rows('SELECT id FROM series') as $r) {
        $n += materialize_series((int)$r['id'], $cal, $monthsAhead);
    }
    return $n;
}

/** ルールを削除する。今日以降の未編集の予定は消し、過去分は通常の予定として残す */
function delete_series(int $seriesId): void
{
    q('DELETE FROM events WHERE series_id = ? AND detached = 0 AND end_date >= ?', [$seriesId, date('Y-m-d')]);
    q('UPDATE events SET series_id = NULL, ym = NULL WHERE series_id = ?', [$seriesId]);
    q('DELETE FROM series_skips WHERE series_id = ?', [$seriesId]);
    q('DELETE FROM series WHERE id = ?', [$seriesId]);
}
