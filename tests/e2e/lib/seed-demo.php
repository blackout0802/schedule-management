<?php
chdir(getenv('E2E_APP'));
require 'src/bootstrap.php'; require 'src/auth.php'; require 'src/events.php';
$ym = date('Y-m');
$u = fn($e) => row('SELECT * FROM users WHERE email=?', [$e]);
$a = $u('admin@example.com'); $y = $u('yamada@example.com'); $s = $u('suzuki@example.com');
$add = function ($user, $kind, $title, $d1, $d2 = null, $tag = '', $st = '', $et = '', $imp = 0) use ($ym) {
    [$d, $err] = validate_event_input(['kind' => $kind, 'title' => $title, 'start' => "$ym-$d1", 'end' => $d2 ? "$ym-$d2" : '', 'tag' => $tag, 'start_time' => $st, 'end_time' => $et, 'important' => $imp], $user);
    if ($err) { echo $err, "\n"; return; }
    save_event($d, $user, null);
};
$add($a, 'work', '全体会議', '03', null, '全体会議', '10:00', '11:00', 1);
$add($a, 'work', '顧客訪問（大阪）', '06', null, '打ち合わせ', '14:00', '16:00');
$add($a, 'work', '月次レポート作成', '14', '16', '個人作業');
$add($a, 'work', '採用面接', '20', null, '打ち合わせ', '13:00', '14:30');
$add($a, 'work', '予算レビュー', '27', null, '定例業務', '10:00', '12:00');
$add($y, 'work', '見積書の確認', '08', null, '個人作業');
$add($y, 'work', '営業会議', '17', null, '定例業務', '09:30', '10:30');
$add($y, 'off', '休み', '09', null, '有給');
$add($y, 'off', '休み', '23', '24', '調整休');
$add($s, 'off', '休み', '10', null, '午前半休');
$add($s, 'work', '新商品の打ち合わせ', '15', null, '打ち合わせ', '15:00', '16:00');
$add($s, 'off', '休み', '28', null, '有給');
$add($a, 'private', '歯医者', '07', null, '', '18:00', '19:00');
$add($a, 'private', '家族で食事', '25', null, '', '19:00', '');
q('INSERT INTO series (owner_id,title,tag,rule_type,p_day,p_day2,p_nth,p_weekday,p_count,shift,bizonly,start_time,end_time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [$a['id'], '給与計算', '定例業務', 'day', 25, null, null, null, null, 'prev', 0, '', '', now_str()]);
materialize_series((int)db()->lastInsertId());
echo "seeded\n";
// 週をまたぐ予定の見え方を確かめるための予定（日付は、月ごとに土曜の位置が違うので、その月の10日以降の最初の土曜から決める）
$hol = Holidays::national((int)date('Y'));
$free = function (int $sat) use ($ym, $hol) { // 土曜の前後に、祝日がない
    for ($i = -2; $i <= 9; $i++) { if (isset($hol[date('Y-m-d', strtotime("$ym-" . sprintf('%02d', $sat) . " $i day"))])) { return false; } }
    return true;
};
$sat = 10; while ((int)date('N', strtotime("$ym-" . sprintf('%02d', $sat))) !== 6 || !$free($sat)) { $sat++; if ($sat > 20) { break; } }
$dd = function (int $n) { return sprintf('%02d', $n); };
$add($a, 'work', 'ギャップ業務', $dd($sat - 2), $dd($sat + 2), '個人作業'); // 木〜月（土日をはさむ）
$add($y, 'off', '連休', $dd($sat + 7), $dd($sat + 9), '有給'); // 土〜月（行をまたいで、そのまま続く）
