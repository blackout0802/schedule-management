<?php
// 会議室の予約。
//
// 決まりごと（初期値。管理者が、画面の「会議室」で変えられるのは、先の予約の月数・営業時間・通知の時刻など）:
//   ・予約できるのは、全社員。変更・取り消しは、予約した本人と管理者だけ
//   ・30分単位。平日の 9:00〜18:00 だけ（土日・祝日・会社の休業日は不可）。管理者は、時間外・休業日にも入れられる
//   ・予約できるのは、今日から3か月先まで。当日の予約もよい。終了した予約は、変更も取り消しもできない
//   ・同じ部屋・同じ時間の二重予約は、できない。先に取った人が優先（割り込みはなし）
//   ・人数は必須。部屋の定員を超える人数は、予約できない（大会議室を少人数で使う予約には、応接室を勧める案内だけを出す）
//   ・用件と区分（委員会・打ち合わせ・来客・研修・その他）は必須。「非公開」にすると、他の人には「予約済」とだけ見える
//   ・Slack には、前日の夕方と当日の朝に、その日の予約をまとめて通知する
// 予約の追加・変更・取り消しは、管理者の「変更履歴」に残す（非公開の予約は、件名を残さない）。

const ROOM_KINDS = ['committee' => '委員会', 'meeting' => '打ち合わせ', 'visitor' => '来客', 'training' => '研修', 'other' => 'その他'];
const ROOM_STEP = 30;
const ROOM_MAX_ROOMS = 6;

function rooms_cfg_defaults(): array
{
    return [
        'advance_months' => 3,
        'open' => '09:00',
        'close' => '18:00',
        'small_hint_pax' => 4, // 大きい部屋を、この人数以下で予約するとき、小さい部屋を勧める案内を出す（0 = 出さない）
        'notify_prev' => ['on' => true, 'time' => '17:00'],
        'notify_today' => ['on' => true, 'time' => '08:30'],
    ];
}

function rooms_meta_get(string $key): string
{
    $r = row('SELECT meta_value FROM app_meta WHERE meta_key = ?', [$key]);
    return $r ? (string)$r['meta_value'] : '';
}

function rooms_meta_set(string $key, string $val): void
{
    q('DELETE FROM app_meta WHERE meta_key = ?', [$key]);
    q('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', [$key, $val]);
}

function rooms_time_ok($t): bool
{
    return is_string($t) && (bool)preg_match('/^([01]\d|2[0-3]):(00|30)$/', $t);
}

function rooms_notify_time_ok($t): bool
{
    return is_string($t) && (bool)preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t);
}

/** 保存されている設定（足りない項目は初期値で補う。壊れていても、初期値に戻るだけ） */
function rooms_cfg(): array
{
    $d = rooms_cfg_defaults();
    $j = json_decode(rooms_meta_get('rooms_cfg'), true);
    if (!is_array($j)) {
        return $d;
    }
    if (isset($j['advance_months']) && is_numeric($j['advance_months']) && (int)$j['advance_months'] >= 1 && (int)$j['advance_months'] <= 12) {
        $d['advance_months'] = (int)$j['advance_months'];
    }
    if (rooms_time_ok($j['open'] ?? null) && rooms_time_ok($j['close'] ?? null) && $j['open'] < $j['close']) {
        $d['open'] = $j['open'];
        $d['close'] = $j['close'];
    }
    if (isset($j['small_hint_pax']) && is_numeric($j['small_hint_pax']) && (int)$j['small_hint_pax'] >= 0 && (int)$j['small_hint_pax'] <= 50) {
        $d['small_hint_pax'] = (int)$j['small_hint_pax'];
    }
    foreach (['notify_prev', 'notify_today'] as $k) {
        if (isset($j[$k]) && is_array($j[$k])) {
            $d[$k]['on'] = isset($j[$k]['on']) ? (bool)$j[$k]['on'] : $d[$k]['on'];
            if (rooms_notify_time_ok($j[$k]['time'] ?? null)) {
                $d[$k]['time'] = $j[$k]['time'];
            }
        }
    }
    return $d;
}

/** 画面から来た設定を検べて、保存する。問題があれば RuntimeException（画面に出せる文） */
function rooms_cfg_save(array $in): array
{
    $cur = rooms_cfg();
    $adv = $in['advance_months'] ?? $cur['advance_months'];
    if (!is_numeric($adv) || (int)$adv < 1 || (int)$adv > 12) {
        throw new RuntimeException('先の予約は、1〜12か月の範囲で選んでください。');
    }
    $open = (string)($in['open'] ?? $cur['open']);
    $close = (string)($in['close'] ?? $cur['close']);
    if (!rooms_time_ok($open) || !rooms_time_ok($close)) {
        throw new RuntimeException('使える時間は、30分刻み（9:00 など）で入力してください。');
    }
    if ($open >= $close) {
        throw new RuntimeException('終わりの時刻は、始まりの時刻より後にしてください。');
    }
    $hint = $in['small_hint_pax'] ?? $cur['small_hint_pax'];
    if (!is_numeric($hint) || (int)$hint < 0 || (int)$hint > 50) {
        throw new RuntimeException('小さい部屋を勧める人数は、0〜50 で入力してください（0 なら、案内を出しません）。');
    }
    $new = ['advance_months' => (int)$adv, 'open' => $open, 'close' => $close, 'small_hint_pax' => (int)$hint];
    foreach (['notify_prev' => '前日', 'notify_today' => '当日'] as $k => $label) {
        $t = (string)($in[$k]['time'] ?? $cur[$k]['time']);
        if (!rooms_notify_time_ok($t)) {
            throw new RuntimeException("{$label}の通知の時刻は、09:00 の形式で入力してください。");
        }
        $new[$k] = ['on' => isset($in[$k]['on']) ? (bool)$in[$k]['on'] : $cur[$k]['on'], 'time' => $t];
    }
    rooms_meta_set('rooms_cfg', json_encode($new, JSON_UNESCAPED_UNICODE));
    return rooms_cfg();
}

/** 初めて使うときの部屋（大会議室 8名・応接室 4名）。部屋が1つもないときだけ入れる */
function rooms_seed_defaults(): void
{
    $r = row('SELECT COUNT(*) AS c FROM rooms');
    if ($r && (int)$r['c'] > 0) {
        return;
    }
    q('INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES (?,?,?,?,?,1)', ['大会議室', '大', 8, 'プロジェクター・ホワイトボード', 1]);
    q('INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES (?,?,?,?,?,1)', ['応接室', '応', 4, 'モニター', 2]);
}

/**
 * 初期の部屋を、会社の実際の部屋に合わせる（小会議室 → 応接室・4名、大会議室 → 8名）。一度だけ。
 * 名前が初期のままの部屋だけを直す（部屋の名前を自分で変えている場合は、そのまま）。何度実行しても安全。
 */
function rooms_migrate_v25(): void
{
    q("UPDATE rooms SET name = '応接室', short = '応', capacity = 4 WHERE name = '小会議室' AND short = '小'");
    q("UPDATE rooms SET capacity = 8 WHERE name = '大会議室' AND short = '大'");
}

function rooms_all(bool $onlyActive = true): array
{
    return rows('SELECT * FROM rooms ' . ($onlyActive ? 'WHERE active = 1 ' : '') . 'ORDER BY sort_order, id');
}

function room_for_client(array $r, int $index): array
{
    return ['id' => (int)$r['id'], 'name' => $r['name'], 'short' => $r['short'], 'capacity' => (int)$r['capacity'], 'equipment' => $r['equipment'],
        'active' => (int)$r['active'] === 1, 'slot' => $index % 4]; // slot: 画面での色の番号（0=青、1=オレンジ…）
}

function rooms_for_client(bool $onlyActive = true): array
{
    $out = [];
    foreach (rooms_all(false) as $i => $r) { // 色の番号は、使わなくした部屋も含めた並び順で決める（あとから色が入れ替わらないように）
        if (!$onlyActive || (int)$r['active'] === 1) {
            $out[] = room_for_client($r, $i);
        }
    }
    return $out;
}

function room_min(string $hhmm): int
{
    return (int)substr($hhmm, 0, 2) * 60 + (int)substr($hhmm, 3, 2);
}

function room_hm(int $m): string
{
    return sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
}

/** 予約が終わっているか（終わった予約は、変更も取り消しもできない） */
function rooms_is_past(array $b, ?int $now = null): bool
{
    $now = $now ?? time();
    $today = date('Y-m-d', $now);
    if ($b['bdate'] < $today) {
        return true;
    }
    return $b['bdate'] === $today && room_min($b['end_time']) <= (int)date('G', $now) * 60 + (int)date('i', $now);
}

/** その人が、この予約を変更・取り消せるか（予約した本人と管理者。終わった予約は、だれもできない） */
function rooms_can_edit(array $b, array $user, ?int $now = null): bool
{
    return ((int)$b['owner_id'] === (int)$user['id'] || is_admin($user)) && !rooms_is_past($b, $now);
}

/** 同じ部屋・同じ日・重なる時間の予約 */
function rooms_conflict(int $roomId, string $date, int $s, int $e, int $ignoreId = 0): ?array
{
    foreach (rows('SELECT b.*, u.name AS owner_name FROM room_bookings b JOIN users u ON u.id = b.owner_id WHERE b.room_id = ? AND b.bdate = ? AND b.id <> ? ORDER BY b.start_time', [$roomId, $date, $ignoreId]) as $b) {
        if (room_min($b['start_time']) < $e && room_min($b['end_time']) > $s) {
            return $b;
        }
    }
    return null;
}

/** 休業日なら、その理由（土曜・日曜・祝日名・休業日の名前）。営業日なら null */
function rooms_closed_reason(string $date, ?BizCalendar $cal = null): ?string
{
    $cal = $cal ?? BizCalendar::fromDb();
    if ($cal->isBusinessDay($date)) {
        return null;
    }
    $w = (int)date('w', strtotime($date));
    $name = $cal->holidayName($date);
    return $name !== null ? $name : ($w === 0 ? '日曜日' : '土曜日');
}

/**
 * 予約の入力を検べる。一般の社員には、時間・日の決まりを守らせる（管理者は、営業時間外・休業日にも入れられる）。
 * @return array [data|null, エラー文|null]
 */
function rooms_validate_input(array $in, array $user, ?array $existing = null, ?int $now = null): array
{
    $now = $now ?? time();
    $cfg = rooms_cfg();
    $room = row('SELECT * FROM rooms WHERE id = ?', [(int)($in['room_id'] ?? 0)]);
    if (!$room || ((int)$room['active'] !== 1 && !($existing && (int)$existing['room_id'] === (int)$room['id']))) {
        return [null, '部屋を選んでください。'];
    }
    $date = (string)($in['date'] ?? '');
    if (!valid_date($date)) {
        return [null, '日付を正しく入力してください。'];
    }
    $st = (string)($in['start'] ?? '');
    $et = (string)($in['end'] ?? '');
    if (!rooms_time_ok($st) || !rooms_time_ok($et)) {
        return [null, '時間は、30分刻み（9:00、9:30 など）で入力してください。'];
    }
    $s = room_min($st);
    $e = room_min($et);
    if ($e <= $s) {
        return [null, '終了は、開始より後の時刻にしてください。'];
    }
    $today = date('Y-m-d', $now);
    if ($date < $today) {
        return [null, '過去の日付には、予約できません。'];
    }
    if ($date === $today && $e <= (int)date('G', $now) * 60 + (int)date('i', $now)) {
        return [null, 'この時間は、すでに終わっています。'];
    }
    if (!is_admin($user)) {
        $reason = rooms_closed_reason($date);
        if ($reason !== null) {
            return [null, md_ja($date) . 'は、休業日（' . $reason . '）のため、予約できません。必要なときは、管理者に連絡してください。'];
        }
        if ($s < room_min($cfg['open']) || $e > room_min($cfg['close'])) {
            return [null, '予約できる時間は、' . ltrim($cfg['open'], '0') . '〜' . ltrim($cfg['close'], '0') . ' です。それ以外の時間が必要なときは、管理者に連絡してください。'];
        }
        $limit = date('Y-m-d', strtotime('+' . $cfg['advance_months'] . ' month', $now));
        if ($date > $limit) {
            return [null, '予約できるのは、' . $cfg['advance_months'] . 'か月先（' . md_ja($limit) . '）までです。'];
        }
    }
    $pax = $in['pax'] ?? null;
    if (!is_numeric($pax) || (int)$pax < 1 || (int)$pax > 999) {
        return [null, '人数を入力してください。'];
    }
    $pax = (int)$pax;
    if ($pax > (int)$room['capacity']) {
        return [null, $room['name'] . 'の定員は' . (int)$room['capacity'] . '名です。人数を減らすか、別の部屋を選んでください。'];
    }
    $title = trim((string)($in['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 60) {
        return [null, '用件を、60文字以内で入力してください。'];
    }
    $kind = (string)($in['kind'] ?? '');
    if (!isset(ROOM_KINDS[$kind])) {
        return [null, '区分（委員会・打ち合わせ・来客・研修・その他）を選んでください。'];
    }
    $c = rooms_conflict((int)$room['id'], $date, $s, $e, $existing ? (int)$existing['id'] : 0);
    if ($c) {
        $mine = (int)$c['owner_id'] === (int)$user['id'] || is_admin($user);
        $what = (int)$c['is_private'] === 1 && !$mine ? '予約' : '「' . $c['title'] . '」（' . $c['owner_name'] . '）';
        return [null, $room['name'] . 'は、' . $c['start_time'] . '〜' . $c['end_time'] . ' に' . $what . 'が入っています。時間をずらすか、別の部屋を選んでください。'];
    }
    return [[
        'room_id' => (int)$room['id'], 'bdate' => $date, 'start_time' => $st, 'end_time' => $et, 'title' => $title, 'kind' => $kind,
        'pax' => $pax, 'is_private' => !empty($in['private']) ? 1 : 0,
    ], null];
}

function rooms_audit_label(array $b, string $roomName): string
{
    $when = audit_md($b['bdate']) . ' ' . $b['start_time'] . '〜' . $b['end_time'];
    $what = (int)$b['is_private'] === 1 ? '（非公開の予約）' : $b['title']; // 非公開の予約は、件名を残さない
    return '会議室｜' . $roomName . '　' . $when . '　' . $what;
}

/** 予約を作る・変更する（検べ済みの入力）。保存した行を返す */
function rooms_save(array $data, array $user, ?array $existing = null): array
{
    $now = now_str();
    if ($existing) {
        q('UPDATE room_bookings SET room_id=?, bdate=?, start_time=?, end_time=?, title=?, kind=?, pax=?, is_private=?, updated_at=?, updated_by=? WHERE id=?', [
            $data['room_id'], $data['bdate'], $data['start_time'], $data['end_time'], $data['title'], $data['kind'], $data['pax'], $data['is_private'], $now, (int)$user['id'], (int)$existing['id'],
        ]);
        $id = (int)$existing['id'];
    } else {
        q('INSERT INTO room_bookings (room_id, bdate, start_time, end_time, title, kind, pax, owner_id, is_private, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
            $data['room_id'], $data['bdate'], $data['start_time'], $data['end_time'], $data['title'], $data['kind'], $data['pax'], (int)$user['id'], $data['is_private'], $now, $now, (int)$user['id'],
        ]);
        $id = (int)db()->lastInsertId();
        // 同じ瞬間に、2人が同じ枠を取ったときのための確認。あとから入った（番号が大きい）ほうを、取り消す
        $dup = rooms_conflict((int)$data['room_id'], $data['bdate'], room_min($data['start_time']), room_min($data['end_time']), $id);
        if ($dup && (int)$dup['id'] < $id) {
            q('DELETE FROM room_bookings WHERE id = ?', [$id]);
            throw new RuntimeException('同じ時間に、先に別の予約が入りました。時間をずらすか、別の部屋を選んでください。');
        }
    }
    $saved = row('SELECT * FROM room_bookings WHERE id = ?', [$id]);
    $room = row('SELECT name FROM rooms WHERE id = ?', [(int)$saved['room_id']]);
    $detail = '';
    if ($existing) {
        $diff = [];
        foreach (['room_id' => '部屋', 'bdate' => '日付', 'start_time' => '開始', 'end_time' => '終了', 'pax' => '人数', 'is_private' => '非公開'] as $k => $label) {
            if ((string)$existing[$k] !== (string)$saved[$k]) {
                $diff[] = $label;
            }
        }
        if ($existing['title'] !== $saved['title'] && (int)$saved['is_private'] !== 1) {
            $diff[] = '用件';
        }
        $detail = $diff ? implode('・', $diff) . 'を変更' : '';
    }
    audit_log('room', $existing ? 'update' : 'add', rooms_audit_label($saved, (string)$room['name']), '', $detail);
    return $saved;
}

/** 予約を取り消す */
function rooms_delete(array $b): void
{
    $room = row('SELECT name FROM rooms WHERE id = ?', [(int)$b['room_id']]);
    q('DELETE FROM room_bookings WHERE id = ?', [(int)$b['id']]);
    audit_log('room', 'delete', rooms_audit_label($b, (string)($room['name'] ?? '')));
}

/** 画面に渡す形にする。非公開の予約は、本人と管理者以外には、「予約済」とだけ見せる（用件・区分・人数・予約した人は渡さない） */
function room_booking_for_client(array $b, array $user, ?int $now = null): array
{
    $mine = (int)$b['owner_id'] === (int)$user['id'];
    $mask = (int)$b['is_private'] === 1 && !$mine && !is_admin($user);
    return [
        'id' => (int)$b['id'], 'room_id' => (int)$b['room_id'], 'date' => $b['bdate'], 'start' => $b['start_time'], 'end' => $b['end_time'],
        'title' => $mask ? '予約済' : $b['title'], 'kind' => $mask ? 'other' : $b['kind'], 'pax' => $mask ? null : (int)$b['pax'],
        'owner_id' => $mask ? null : (int)$b['owner_id'], 'owner_name' => $mask ? '' : ($b['owner_name'] ?? ''),
        'private' => (int)$b['is_private'] === 1, 'masked' => $mask, 'mine' => $mine,
        'past' => rooms_is_past($b, $now), 'editable' => rooms_can_edit($b, $user, $now),
    ];
}

function rooms_list_bookings(string $from, string $to, array $user): array
{
    $out = [];
    foreach (rows('SELECT b.*, u.name AS owner_name FROM room_bookings b JOIN users u ON u.id = b.owner_id WHERE b.bdate BETWEEN ? AND ? ORDER BY b.bdate, b.start_time, b.id', [$from, $to]) as $b) {
        $out[] = room_booking_for_client($b, $user);
    }
    return $out;
}

/** 部屋の追加・変更（管理者）。使わなくした部屋は、予約を残したまま、新しい予約の選択肢から外れる */
function rooms_save_room(array $in): array
{
    $name = trim((string)($in['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 30) {
        throw new RuntimeException('部屋の名前を、30文字以内で入力してください。');
    }
    $short = trim((string)($in['short'] ?? ''));
    $short = $short === '' ? mb_substr($name, 0, 1) : mb_substr($short, 0, 1);
    $cap = $in['capacity'] ?? null;
    if (!is_numeric($cap) || (int)$cap < 1 || (int)$cap > 500) {
        throw new RuntimeException('定員を、1〜500 の数で入力してください。');
    }
    $eq = trim((string)($in['equipment'] ?? ''));
    if (mb_strlen($eq) > 60) {
        throw new RuntimeException('設備は、60文字以内で入力してください。');
    }
    $active = !isset($in['active']) || !empty($in['active']) ? 1 : 0;
    if (!empty($in['id'])) {
        $r = row('SELECT * FROM rooms WHERE id = ?', [(int)$in['id']]);
        if (!$r) {
            throw new RuntimeException('部屋が見つかりません。');
        }
        if ($active === 0 && (int)$r['active'] === 1 && count(rooms_all(true)) <= 1) {
            throw new RuntimeException('使える部屋が、1つもなくなってしまいます。');
        }
        $small = (int)$cap < (int)$r['capacity'];
        if ($small) { // 定員を減らしたとき、これから先の予約で、新しい定員を超える人数のものがあれば、知らせる（予約は、そのまま残す）
            $over = (int)row('SELECT COUNT(*) AS c FROM room_bookings WHERE room_id = ? AND bdate >= ? AND pax > ?', [(int)$r['id'], date('Y-m-d'), (int)$cap])['c'];
        }
        q('UPDATE rooms SET name=?, short=?, capacity=?, equipment=?, active=? WHERE id=?', [$name, $short, (int)$cap, $eq, $active, (int)$r['id']]);
        audit_log('room', 'update', '会議室の設定｜' . $name . '（定員' . (int)$cap . '名）', '', $active === 0 ? '使わない部屋にしました' : '');
        return ['id' => (int)$r['id'], 'over' => $small ? $over : 0];
    }
    if (count(rooms_all(false)) >= ROOM_MAX_ROOMS) {
        throw new RuntimeException('部屋は、' . ROOM_MAX_ROOMS . 'つまで登録できます。');
    }
    $max = row('SELECT COALESCE(MAX(sort_order), 0) AS m FROM rooms');
    q('INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES (?,?,?,?,?,?)', [$name, $short, (int)$cap, $eq, (int)$max['m'] + 1, $active]);
    $id = (int)db()->lastInsertId();
    audit_log('room', 'add', '会議室の設定｜' . $name . '（定員' . (int)$cap . '名）');
    return ['id' => $id, 'over' => 0];
}

// ---- Slack への通知（前日の夕方・当日の朝）----

/** Slack の文面に入れる文字を、そのまま表示される形にする（用件に <!channel> などを入れられても、全員への呼び出しにならないように） */
function rooms_slack_esc(string $s): string
{
    return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $s);
}

function rooms_notify_text(string $date, string $label): string
{
    $lines = [];
    foreach (rows('SELECT b.*, r.name AS room_name, u.name AS owner_name, u.slack_id FROM room_bookings b JOIN rooms r ON r.id = b.room_id JOIN users u ON u.id = b.owner_id WHERE b.bdate = ? ORDER BY b.start_time, r.sort_order, b.id', [$date]) as $b) {
        $who = preg_match('/^[UW][A-Z0-9]{6,}$/', (string)$b['slack_id']) ? '<@' . $b['slack_id'] . '>' : rooms_slack_esc((string)$b['owner_name']);
        $kind = ROOM_KINDS[$b['kind']] ?? '';
        $what = (int)$b['is_private'] === 1 ? '予約済（非公開）' : rooms_slack_esc((string)$b['title']) . ($kind !== '' ? '（' . $kind . '）' : '');
        $lines[] = '• ' . $b['start_time'] . '〜' . $b['end_time'] . '　' . rooms_slack_esc((string)$b['room_name']) . '　' . $what . '　' . $who;
    }
    return "【{$label}の会議室】" . md_ja($date) . "\n" . implode("\n", $lines) . "\n" . slack_link_text();
}

/** その日の予約を、まとめて1通で通知する。送った件数（なければ 0） */
function rooms_notify_day(string $date, string $label, string $key): int
{
    $n = (int)row('SELECT COUNT(*) AS c FROM room_bookings WHERE bdate = ?', [$date])['c'];
    if ($n === 0) {
        return 0;
    }
    $ref = ($key === 'notify_prev' ? 'roomprev:' : 'roomtoday:') . $date;
    if (!notify_once($ref)) {
        return 0;
    }
    $ok = slack_post(rooms_notify_text($date, $label));
    if (!$ok && slack_enabled()) {
        q('DELETE FROM notification_log WHERE ref = ?', [$ref]); // 送れなかったので、次回やり直せるようにする
    }
    return $n;
}

/** 時刻を過ぎた通知を送る（cron の notify から呼ぶ）。設定した時刻から3時間以内で、まだ送っていなければ送る */
function rooms_notify_due(?int $now = null): array
{
    $now = $now ?? time();
    $cfg = rooms_cfg();
    $msg = [];
    foreach (['notify_prev' => ['明日', 1], 'notify_today' => ['本日', 0]] as $key => [$label, $plus]) {
        if (!$cfg[$key]['on']) {
            continue;
        }
        $due = strtotime(date('Y-m-d', $now) . ' ' . $cfg[$key]['time'] . ':00');
        if ($now < $due || $now >= $due + 3 * 3600) {
            continue;
        }
        $n = rooms_notify_day(date('Y-m-d', strtotime("+{$plus} day", $now)), $label, $key);
        if ($n > 0) {
            $msg[] = "会議室の予約（{$label}）: {$n} 件を通知しました";
        }
    }
    return $msg;
}
