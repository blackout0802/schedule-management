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
    foreach (series_preview($s, $monthsAhead, $cal) as $p) {
        $ym = $p['ym'];
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
