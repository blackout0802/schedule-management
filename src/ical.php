<?php
// カレンダーの購読（iCalendar / ICS）。iPhone の標準カレンダーや Google カレンダーに、URLで取り込める（読み取り専用）。
//
//   自分用   … 自分の全予定（業務・休み・プライベート）。本人だけに秘密のURL
//   家族用   … 家族用の共有リンクと同じ範囲（本人が「家族に共有」と決めた予定だけ）
//   会社用   … 会社用の共有リンクと同じ範囲（業務と休み。プライベートは含まない）。管理者だけが作れる
//
// URLは、推測できない長いランダム文字列。作り直す／止めると、古いURLはすぐ使えなくなる（取り込んだ側は、次の更新から空になる）。
// 予定は、いまの月の2か月前から13か月先まで。時刻のある予定は UTC に直して出すので、VTIMEZONE は要らない。
// 取り込んだ側の更新は、Apple は数分〜、Google は半日〜1日おき（こちらでは変えられない）。

require_once __DIR__ . '/share.php';

const ICAL_KINDS = ['me' => 'ics_me', 'family' => 'ics_fam', 'company' => 'ics_co'];
const ICAL_MAX_EVENTS = 5000;

function ical_owner_key(string $kind, array $user): int
{
    return $kind === 'company' ? 0 : (int)$user['id'];
}

function ical_link_get(string $kind, array $user): ?array
{
    return row('SELECT * FROM share_links WHERE kind = ? AND owner_id = ?', [ICAL_KINDS[$kind], ical_owner_key($kind, $user)]);
}

/** 作る（あれば、作り直す）。会社用は管理者だけ */
function ical_link_create(string $kind, array $user): array
{
    if (!isset(ICAL_KINDS[$kind])) {
        throw new RuntimeException('購読の種類が正しくありません。');
    }
    if ($kind === 'company' && !is_admin($user)) {
        throw new RuntimeException('会社用の購読URLは、管理者だけが作れます。');
    }
    $token = share_new_token();
    if (ical_link_get($kind, $user)) {
        q('UPDATE share_links SET token = ?, created_by = ?, created_at = ? WHERE kind = ? AND owner_id = ?', [$token, $user['id'], now_str(), ICAL_KINDS[$kind], ical_owner_key($kind, $user)]);
    } else {
        q('INSERT INTO share_links (kind, owner_id, token, created_by, created_at) VALUES (?,?,?,?,?)', [ICAL_KINDS[$kind], ical_owner_key($kind, $user), $token, $user['id'], now_str()]);
    }
    return ical_link_get($kind, $user);
}

function ical_link_revoke(string $kind, array $user): void
{
    if (!isset(ICAL_KINDS[$kind])) {
        throw new RuntimeException('購読の種類が正しくありません。');
    }
    if ($kind === 'company' && !is_admin($user)) {
        throw new RuntimeException('会社用の購読URLは、管理者だけが止められます。');
    }
    q('DELETE FROM share_links WHERE kind = ? AND owner_id = ?', [ICAL_KINDS[$kind], ical_owner_key($kind, $user)]);
}

/** 画面用: 自分が作れる購読URLの一覧 [{kind, path}] */
function ical_links_for(array $user): array
{
    $out = [];
    foreach (['me', 'family', 'company'] as $k) {
        if ($k === 'company' && !is_admin($user)) {
            continue;
        }
        $l = ical_link_get($k, $user);
        $out[] = ['kind' => $k, 'path' => $l ? 'ical.php?t=' . $l['token'] : null, 'created_at' => $l ? $l['created_at'] : null];
    }
    return $out;
}

/** 配信のとき、URLの文字列から探す。無効・持ち主が利用停止なら null。['kind' => me|family|company, 'owner_id' => ..., 'owner_name' => ...] */
function ical_link_find(string $token): ?array
{
    if (!share_valid_token($token)) {
        return null;
    }
    $l = row('SELECT * FROM share_links WHERE token = ?', [$token]);
    if (!$l) {
        return null;
    }
    $kind = array_search($l['kind'], ICAL_KINDS, true);
    if ($kind === false) {
        return null; // 共有リンク（share.php）のトークンでは、購読できない
    }
    $name = '';
    if ($kind !== 'company') {
        $u = row('SELECT id, name FROM users WHERE id = ? AND active = 1', [$l['owner_id']]);
        if (!$u) {
            return null;
        }
        $name = $u['name'];
    }
    return ['kind' => $kind, 'owner_id' => (int)$l['owner_id'], 'owner_name' => $name];
}

/** 配信する予定（見せてよいものだけを、SQLで絞る）。[{id,title,kind,tag,start,end,start_time,end_time,note,owner_name,done,important,updated}] */
function ical_events(array $link, string $from, string $to): array
{
    if ($link['kind'] === 'me') {
        $list = rows("SELECT e.*, u.name AS owner_name, t.done_at AS todo_done_at FROM events e JOIN users u ON u.id = e.owner_id LEFT JOIN todos t ON t.id = e.todo_id
                      WHERE e.owner_id = ? AND e.start_date <= ? AND e.end_date >= ? ORDER BY e.start_date, e.start_time, e.id", [$link['owner_id'], $to, $from]);
        return array_map(function ($e) {
            return ['id' => (int)$e['id'], 'title' => $e['title'], 'kind' => $e['kind'], 'tag' => $e['tag'], 'start' => $e['start_date'], 'end' => $e['end_date'],
                'start_time' => $e['start_time'], 'end_time' => $e['end_time'], 'note' => $e['note'], 'owner_name' => $e['owner_name'],
                'done' => ($e['todo_done_at'] ?? null) !== null, 'important' => (int)$e['important'] === 1, 'updated' => $e['updated_at'] ?? ''];
        }, $list);
    }
    $shareLink = $link['kind'] === 'company' ? ['kind' => 'company', 'owner_id' => 0] : ['kind' => 'family', 'owner_id' => $link['owner_id'], 'owner_name' => $link['owner_name']];
    $out = [];
    foreach (share_events($shareLink, $from, $to) as $e) {
        if (!empty($e['deleted'])) {
            continue; // 家族用の「削除された予定」の取消線は、購読には出さない
        }
        $out[] = ['id' => (int)$e['id'], 'title' => $e['title'], 'kind' => $e['kind'], 'tag' => $e['tag'], 'start' => $e['start'], 'end' => $e['end'],
            'start_time' => $e['start_time'], 'end_time' => $e['end_time'], 'note' => $e['note'], 'owner_name' => $e['owner_name'],
            'done' => !empty($e['done']), 'important' => !empty($e['important']), 'updated' => ''];
    }
    return $out;
}

/** iCalendar の文字列の、エスケープ */
function ical_escape(string $s): string
{
    $s = str_replace(["\\", ";", ",", "\r\n", "\r", "\n"], ["\\\\", "\;", "\\,", "\\n", "\\n", "\\n"], $s);
    return $s;
}

/** 1行が75バイトを超えないように、折り返す（UTF-8の文字の途中では切らない）。行ごとに CRLF を付けて返す */
function ical_fold(string $line): string
{
    if (strlen($line) <= 75) {
        return $line . "\r\n";
    }
    $out = '';
    $cur = '';
    $limit = 75;
    foreach (preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
        if (strlen($cur) + strlen($ch) > $limit) {
            $out .= $cur . "\r\n";
            $cur = ' ';
            $limit = 75;
        }
        $cur .= $ch;
    }
    return $out . $cur . "\r\n";
}

/** 'Y-m-d' と 'H:i' を、アプリの時間帯で読んで、UTC の 'Ymd\THis\Z' にする */
function ical_utc(string $date, string $time): string
{
    $tz = new DateTimeZone(date_default_timezone_get());
    $d = DateTimeImmutable::createFromFormat('Y-m-d H:i', $date . ' ' . $time, $tz);
    if (!$d) {
        $d = new DateTimeImmutable($date . ' 00:00', $tz);
    }
    return $d->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
}

/** 配信する ICS の全文 */
function ical_render(array $link, ?int $now = null): string
{
    $now = $now ?? time();
    $from = date('Y-m-01', strtotime('-2 months', $now));
    $to = date('Y-m-t', strtotime('+13 months', $now));
    $host = parse_url((string)cfg('base_url', ''), PHP_URL_HOST) ?: ($_SERVER['HTTP_HOST'] ?? 'schedule.local');
    $names = ['me' => '予定（自分）', 'family' => $link['owner_name'] . ' さんの予定（家族用）', 'company' => '業務カレンダー（会社）'];
    $calName = cfg('app_name', 'スケジュール管理') . '｜' . $names[$link['kind']];
    $lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//schedule-management//JP', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'X-WR-CALNAME:' . ical_escape($calName), 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
    $stamp = gmdate('Ymd\THis\Z', $now);
    foreach (array_slice(ical_events($link, $from, $to), 0, ICAL_MAX_EVENTS) as $e) {
        $title = $e['title'] !== '' ? $e['title'] : ($e['kind'] === 'off' ? '休み' : '（件名なし）');
        if ($e['kind'] === 'off' && $e['tag'] !== '' && $e['title'] !== '' && $e['title'] !== $e['tag'] && $link['kind'] !== 'family') {
            $title .= '（' . $e['tag'] . '）';
        } elseif ($e['kind'] === 'off' && $e['title'] === '' && $e['tag'] !== '' && $link['kind'] !== 'family') {
            $title = '休み（' . $e['tag'] . '）';
        }
        if ($link['kind'] === 'company') {
            $title = $e['owner_name'] . '　' . $title; // 会社用は、誰の予定かを、先頭に
        }
        if (!empty($e['done'])) {
            $title = '✓ ' . $title;
        }
        if (!empty($e['important'])) {
            $title = '★ ' . $title;
        }
        $desc = [];
        if ($e['note'] !== '') {
            $desc[] = $e['note'];
        }
        if ($e['tag'] !== '' && $e['kind'] === 'work') {
            $desc[] = '分類: ' . $e['tag'];
        }
        $ev = ['BEGIN:VEVENT', 'UID:schedule-' . $link['kind'] . '-' . $e['id'] . '@' . $host, 'DTSTAMP:' . $stamp];
        if ($e['start_time'] !== '') {
            $endTime = $e['end_time'] !== '' ? $e['end_time'] : null;
            $endDate = $e['end'];
            if ($endTime === null) { // 終了時刻がなければ、開始の1時間後
                $endDate = $e['start'];
                $endTime = date('H:i', strtotime($e['start_time']) + 3600);
                if ($endTime < $e['start_time']) {
                    $endTime = '23:59';
                }
            }
            $ev[] = 'DTSTART:' . ical_utc($e['start'], $e['start_time']);
            $ev[] = 'DTEND:' . ical_utc($endDate, $endTime);
        } else {
            $ev[] = 'DTSTART;VALUE=DATE:' . str_replace('-', '', $e['start']);
            $ev[] = 'DTEND;VALUE=DATE:' . date('Ymd', strtotime($e['end'] . ' +1 day')); // 終日の終わりは「その翌日」と書く決まり
        }
        $ev[] = 'SUMMARY:' . ical_escape($title);
        if ($desc) {
            $ev[] = 'DESCRIPTION:' . ical_escape(implode("\n", $desc));
        }
        if ($e['tag'] !== '') {
            $ev[] = 'CATEGORIES:' . ical_escape($e['tag']);
        }
        if (!empty($e['important'])) {
            $ev[] = 'PRIORITY:1';
        }
        if ($e['updated'] !== '' && strtotime($e['updated'])) {
            $ev[] = 'LAST-MODIFIED:' . gmdate('Ymd\THis\Z', strtotime($e['updated']));
        }
        $ev[] = 'TRANSP:' . ($e['kind'] === 'off' ? 'TRANSPARENT' : 'OPAQUE');
        if ($link['kind'] === 'me' && $e['start_time'] !== '' && $e['kind'] !== 'off') { // 自分用だけ、15分前の通知（Apple のカレンダーなどが使う）
            array_push($ev, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' . ical_escape($title), 'TRIGGER:-PT15M', 'END:VALARM');
        }
        $ev[] = 'END:VEVENT';
        $lines = array_merge($lines, $ev);
    }
    $lines[] = 'END:VCALENDAR';
    return implode('', array_map('ical_fold', $lines));
}
