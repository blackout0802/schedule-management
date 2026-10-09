<?php
// 使い方: php tests/run.php   （SQLite の一時DBを使うので、本番DBには触れません）
$tmp = sys_get_temp_dir() . '/sched_test_' . getmypid();
@mkdir($tmp);
// 既定は SQLite。MySQL/MariaDB で試す場合: SCHEDULE_TEST_DSN='mysql:host=localhost;dbname=xxx;charset=utf8mb4' SCHEDULE_TEST_USER=.. SCHEDULE_TEST_PASS=.. php tests/run.php
$dsn = getenv('SCHEDULE_TEST_DSN') ?: "sqlite:$tmp/t.sqlite";
$dbCfg = var_export(['dsn' => $dsn, 'user' => getenv('SCHEDULE_TEST_USER') ?: null, 'pass' => getenv('SCHEDULE_TEST_PASS') ?: null], true);
file_put_contents($tmp . '/config.php', "<?php return ['db' => $dbCfg, 'slack_webhook' => ''];");
putenv('SCHEDULE_CONFIG=' . $tmp . '/config.php');

require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/auth.php';
require_once __DIR__ . '/../src/events.php';
require_once __DIR__ . '/../src/slack.php';

$fail = 0;
$pass = 0;
function check(string $name, $actual, $expected): void
{
    global $fail, $pass;
    if ($actual === $expected) {
        $pass++;
    } else {
        $fail++;
        echo "NG  $name\n    期待: " . json_encode($expected, JSON_UNESCAPED_UNICODE) . "\n    実際: " . json_encode($actual, JSON_UNESCAPED_UNICODE) . "\n";
    }
}

// ---- 休みの分類 ----
check('休みの分類の並び', cfg('off_tags'), ['有給', '調整休', '午前半休', '午後半休']);

// ---- 祝日 ----
$h26 = Holidays::national(2026);
check('2026 元日', isset($h26['2026-01-01']), true);
check('2026 成人の日', $h26['2026-01-12'] ?? null, '成人の日');
check('2026 春分', isset($h26['2026-03-20']), true);
check('2026 憲法記念日が日曜→振替が5/6', $h26['2026-05-06'] ?? null, '休日（振替休日）');
check('2026 海の日', isset($h26['2026-07-20']), true);
check('2026 敬老の日', isset($h26['2026-09-21']), true);
check('2026 国民の休日', $h26['2026-09-22'] ?? null, '国民の休日');
check('2026 秋分', isset($h26['2026-09-23']), true);
check('2026 スポーツの日', isset($h26['2026-10-12']), true);
check('2026 勤労感謝の日', isset($h26['2026-11-23']), true);
check('2026 10/13は平日', isset($h26['2026-10-13']), false);
$h27 = Holidays::national(2027);
check('2027 春分が日曜→振替3/22', $h27['2027-03-22'] ?? null, '休日（振替休日）');
check('2027 成人の日', isset($h27['2027-01-11']), true);
check('2020 海の日(特例)', isset(Holidays::national(2020)['2020-07-23']), true);

// ---- 営業日 ----
$cal = new BizCalendar(['2026-12-29' => '年末休業']);
check('土曜は営業日でない', $cal->isBusinessDay('2026-10-10'), false);
check('祝日は営業日でない', $cal->isBusinessDay('2026-10-12'), false);
check('会社休業日は営業日でない', $cal->isBusinessDay('2026-12-29'), false);
check('平日は営業日', $cal->isBusinessDay('2026-10-13'), true);
check('前営業日（日曜→金曜）', $cal->shiftBack('2026-10-25'), '2026-10-23');

// ---- 繰り返しルール（ご提示の業務） ----
$base = ['p_day' => null, 'p_day2' => null, 'p_nth' => null, 'p_weekday' => null, 'p_count' => null, 'shift' => 'none', 'bizonly' => 0];
$rule = function (array $o) use ($base) { return array_merge($base, $o); };

// ① 月初3営業日（2026-10: 1(木)2(金)5(月) / 2026-11: 2(月)4(水)5(木)※11/3は祝日 / 2027-01: 4(月)5(火)6(水)※1/1祝日,1/2-3土日）
$r1 = $rule(['rule_type' => 'first_bizdays', 'p_count' => 3]);
check('①2026-10', rule_dates($r1, 2026, 10, $cal), ['2026-10-01', '2026-10-05']);
check('①2026-11（文化の日を除く）', rule_dates($r1, 2026, 11, $cal), ['2026-11-02', '2026-11-05']);
check('①2027-01（元日・土日を除く）', rule_dates($r1, 2027, 1, $cal), ['2027-01-04', '2027-01-06']);

// ② 10日〜15日の平日（2026-10: 10(土)→12は祝日→13〜15 / 2026-11: 10(火)〜13(金)、14-15は土日→10〜13）
$r2 = $rule(['rule_type' => 'range', 'p_day' => 10, 'p_day2' => 15, 'bizonly' => 1]);
check('②2026-10', rule_dates($r2, 2026, 10, $cal), ['2026-10-13', '2026-10-15']);
check('②2026-11', rule_dates($r2, 2026, 11, $cal), ['2026-11-10', '2026-11-13']);

// ③ 20日〜25日（営業日のみ。2026-10: 20(火)〜23(金)、24-25は土日）
$r3 = $rule(['rule_type' => 'range', 'p_day' => 20, 'p_day2' => 25, 'bizonly' => 1]);
check('③2026-10', rule_dates($r3, 2026, 10, $cal), ['2026-10-20', '2026-10-23']);
check('③2026-11（11/23祝日）', rule_dates($r3, 2026, 11, $cal), ['2026-11-20', '2026-11-25']);

// ④ 25日（休日なら前営業日）
$r4 = $rule(['rule_type' => 'day', 'p_day' => 25, 'shift' => 'prev']);
check('④2026-10（日曜→金曜）', rule_dates($r4, 2026, 10, $cal), ['2026-10-23', '2026-10-23']);
check('④2026-11（水曜）', rule_dates($r4, 2026, 11, $cal), ['2026-11-25', '2026-11-25']);
check('④2027-12-25(土)→24', rule_dates($r4, 2027, 12, $cal), ['2027-12-24', '2027-12-24']);

// その他の種類
check('第2水曜', rule_dates($rule(['rule_type' => 'weekday_nth', 'p_nth' => 2, 'p_weekday' => 3]), 2026, 10, $cal), ['2026-10-14', '2026-10-14']);
check('第1月曜', rule_dates($rule(['rule_type' => 'weekday_nth', 'p_nth' => 1, 'p_weekday' => 1]), 2026, 10, $cal), ['2026-10-05', '2026-10-05']);
check('最終金曜', rule_dates($rule(['rule_type' => 'weekday_nth', 'p_nth' => -1, 'p_weekday' => 5]), 2026, 10, $cal), ['2026-10-30', '2026-10-30']);
check('第5月曜が無い月', rule_dates($rule(['rule_type' => 'weekday_nth', 'p_nth' => 5, 'p_weekday' => 1]), 2026, 2, $cal), null);
check('最終営業日', rule_dates($rule(['rule_type' => 'last_bizday']), 2027, 1, $cal), ['2027-01-29', '2027-01-29']);
check('31日指定は2月末に丸める', rule_dates($rule(['rule_type' => 'day', 'p_day' => 31]), 2026, 2, $cal), ['2026-02-28', '2026-02-28']);

// ---- DB・展開・権限 ----
run_schema();
foreach (['users','series','events','series_skips','company_holidays','notification_log'] as $t) { db()->exec("DELETE FROM $t"); }
$admin = row('SELECT * FROM users WHERE id = ?', [create_user('管理者', 'admin@example.com', 'password1', 'admin')]);
$a = row('SELECT * FROM users WHERE id = ?', [create_user('山田', 'a@example.com', 'password1')]);
$b = row('SELECT * FROM users WHERE id = ?', [create_user('鈴木', 'b@example.com', 'password1')]);
check('ログイン成功', login_attempt('A@example.com', 'password1') !== null, true);
$tmpUser = row('SELECT * FROM users WHERE id = ?', [create_user('新人', 'new@example.com', 'initpass1', 'member', null, true)]);
check('管理者が登録した人は初回パスワード変更が必要', (int)$tmpUser['must_change_password'], 1);
check('通常登録は変更不要', (int)$a['must_change_password'], 0);
check('ログイン失敗', login_attempt('a@example.com', 'wrong') === null, true);

$today = date('Y-m-d');
$ym = date('Y-m');
$mk = function (array $user, array $in) {
    [$d, $err] = validate_event_input($in, $user);
    if ($err) {
        throw new RuntimeException($err);
    }
    return save_event($d, $user, null);
};
$mk($a, ['kind' => 'private', 'title' => '歯医者', 'start' => $today]);
$mk($a, ['kind' => 'work', 'title' => 'A社 打ち合わせ', 'tag' => '打ち合わせ', 'start' => $today]);
$mk($a, ['kind' => 'work', 'title' => '資料作成', 'tag' => '個人作業', 'start' => $today]);
$mk($a, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $today]);
$titles = function (array $list) { $t = array_column($list, 'title'); sort($t); return $t; };

check('業務版: 他人にはプライベートが見えない', $titles(list_events($b, $today, $today, 'team')), ['A社 打ち合わせ', '休み', '資料作成']);
check('業務版: 管理者にもプライベートは見えない', in_array('歯医者', $titles(list_events($admin, $today, $today, 'team')), true), false);
check('業務版: 本人は(業務版では)プライベートを見ない', in_array('歯医者', $titles(list_events($a, $today, $today, 'team')), true), false);
check('プライベート版: 他人にはプライベートが見えない', in_array('歯医者', $titles(list_events($b, $today, $today, 'me', ['tags' => cfg('work_tags'), 'showOff' => true])), true), false);
check('プライベート版: 管理者にもプライベートは見えない', in_array('歯医者', $titles(list_events($admin, $today, $today, 'me', ['tags' => cfg('work_tags'), 'showOff' => true])), true), false);
check('プライベート版: 本人には見える', in_array('歯医者', $titles(list_events($a, $today, $today, 'me', ['tags' => cfg('work_tags'), 'showOff' => true])), true), true);
check('プライベート版: タグで絞り込み(打ち合わせのみ)', $titles(list_events($b, $today, $today, 'me', ['tags' => ['打ち合わせ'], 'showOff' => false])), ['A社 打ち合わせ']);
check('プライベート版: 同僚の休みを表示', $titles(list_events($b, $today, $today, 'me', ['tags' => [], 'showOff' => true])), ['休み']);
check('プライベート版: 自分の休みは常に表示', $titles(list_events($a, $today, $today, 'me', ['tags' => [], 'showOff' => false])), ['休み', '歯医者']);

$priv = row("SELECT * FROM events WHERE kind='private'");
check('他人のプライベートは find_event で見つからない', find_event((int)$priv['id'], $admin), null);
check('本人は find_event で見つかる', find_event((int)$priv['id'], $a) !== null, true);
$off = row("SELECT * FROM events WHERE kind='off'");
check('休みは本人が編集可', can_edit_event($off, $a), true);
check('休みは他の一般社員は編集不可', can_edit_event($off, $b), false);
check('休みは管理者が編集可', can_edit_event($off, $admin), true);

// 旧名称「その他の休み」の予定が「調整休」に移行される
q("INSERT INTO events (owner_id,title,kind,tag,start_date,end_date,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [$a['id'], '旧データ', 'off', 'その他の休み', $today, $today, $a['id'], now_str(), now_str()]);
migrate_data();
check('旧名称の休みが調整休になる', row("SELECT tag FROM events WHERE title = '旧データ'")['tag'], '調整休');
[$dT] = validate_event_input(['kind' => 'off', 'title' => 'x', 'tag' => 'ありえない分類', 'start' => $today], $a);
check('不明な分類の休みは先頭(有給)になる', $dT['tag'], '有給');
[$dT2] = validate_event_input(['kind' => 'off', 'title' => 'x', 'tag' => '調整休', 'start' => $today], $a);
check('調整休を選べる', $dT2['tag'], '調整休');

// 休みの代理登録: 管理者のみ owner_id が有効
[$d1] = validate_event_input(['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $today, 'owner_id' => $b['id']], $admin);
check('管理者は他の社員の休みを登録できる', $d1['owner_id'], (int)$b['id']);
[$d2] = validate_event_input(['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $today, 'owner_id' => $b['id']], $a);
check('一般社員が owner_id を指定しても自分になる', $d2['owner_id'], (int)$a['id']);
[$d3] = validate_event_input(['kind' => 'private', 'title' => 'x', 'start' => $today, 'owner_id' => $b['id']], $admin);
check('プライベートは必ず本人（管理者でも）', $d3['owner_id'], (int)$admin['id']);
check('不正な日付はエラー', validate_event_input(['kind' => 'work', 'title' => 'x', 'start' => '2026-02-30'], $a)[1] !== null, true);
check('終了日が開始日より前はエラー', validate_event_input(['kind' => 'work', 'title' => 'x', 'start' => '2026-10-10', 'end' => '2026-10-09'], $a)[1] !== null, true);

// 繰り返しの展開
q("INSERT INTO series (owner_id,title,tag,rule_type,p_day,shift,created_at) VALUES (?,?,?,?,?,?,?)", [$a['id'], '月次締め', '定例業務', 'day', 25, 'prev', now_str()]);
$sid = (int)db()->lastInsertId();
$n1 = materialize_series($sid);
check('12か月先まで13件(今月含む)作られる', (int)row('SELECT COUNT(*) AS c FROM events WHERE series_id = ?', [$sid])['c'], 13);
check('もう一度実行しても増えない（冪等）', materialize_series($sid), 0);
check('展開された予定は全員に見える業務', row('SELECT kind FROM events WHERE series_id = ? LIMIT 1', [$sid])['kind'], 'work');

// 1回分だけ編集 → ルール変更でも上書きされない
$ev = row('SELECT * FROM events WHERE series_id = ? ORDER BY start_date LIMIT 1 OFFSET 2', [$sid]);
[$d] = validate_event_input(['kind' => 'work', 'title' => '月次締め(前倒し)', 'tag' => '定例業務', 'start' => $ev['start_date'], 'end' => $ev['end_date']], $a);
save_event($d, $a, $ev);
q('UPDATE series SET p_day = 20 WHERE id = ?', [$sid]);
materialize_series($sid);
check('個別編集した回は保たれる', row('SELECT title FROM events WHERE id = ?', [$ev['id']])['title'], '月次締め(前倒し)');
check('他の回はルール変更が反映される', row('SELECT COUNT(*) AS c FROM events WHERE series_id = ? AND title = ? AND substr(start_date,9,2) IN (\'20\',\'18\',\'19\')', [$sid, '月次締め'])['c'] >= 10, true);

// 1回分を削除 → 復活しない
$ev2 = row('SELECT * FROM events WHERE series_id = ? AND detached = 0 ORDER BY start_date LIMIT 1 OFFSET 1', [$sid]);
delete_event($ev2);
materialize_series($sid);
check('削除した回は復活しない', row('SELECT COUNT(*) AS c FROM events WHERE id = ? OR (series_id = ? AND ym = ?)', [$ev2['id'], $sid, $ev2['ym']])['c'], 0);

// ルール削除: 今日以降の未編集分が消え、編集済みは通常の予定として残る
delete_series($sid);
check('ルール削除後、未編集の将来分は消える', (int)row("SELECT COUNT(*) AS c FROM events WHERE title = '月次締め'")['c'], 0);
check('編集済みの回は通常の予定として残る', (int)row("SELECT COUNT(*) AS c FROM events WHERE title = '月次締め(前倒し)' AND series_id IS NULL")['c'], 1);

// ---- 予定の複製 ----
$d0 = date('Y-m-d', strtotime('+30 day')); $d1 = date('Y-m-d', strtotime('+32 day'));
$srcOff = $mk($a, ['kind' => 'off', 'title' => '', 'tag' => '調整休', 'start' => $d0, 'end' => $d1, 'note' => 'メモ', 'start_time' => '09:00', 'end_time' => '12:00']);
$t1 = date('Y-m-d', strtotime('+40 day')); $t2 = date('Y-m-d', strtotime('+50 day'));
[$cr, $sk] = duplicate_event($srcOff, [$t1, $t2, $t1], $a);
check('複製: 日付の重複を除いて2件作られる', [count($cr), $sk], [2, 0]);
check('複製: 3日間の期間が引き継がれる', [$cr[0]['start_date'], $cr[0]['end_date']], [$t1, date('Y-m-d', strtotime($t1 . ' +2 day'))]);
check('複製: 件名・分類・時刻・メモ・種類・持ち主が同じ', [$cr[1]['title'], $cr[1]['tag'], $cr[1]['start_time'], $cr[1]['end_time'], $cr[1]['note'], $cr[1]['kind'], (int)$cr[1]['owner_id']], ['休み', '調整休', '09:00', '12:00', 'メモ', 'off', (int)$a['id']]);
[$cr2, $sk2] = duplicate_event($srcOff, [$t1], $a);
check('複製: 同じ予定がある日付は飛ばす（二重登録しない）', [count($cr2), $sk2], [0, 1]);
// 管理者が他の社員の休みを複製 → 持ち主は元の社員のまま
[$cr3] = duplicate_event($srcOff, [date('Y-m-d', strtotime('+60 day'))], $admin);
check('複製: 管理者が複製しても持ち主は元の社員', (int)$cr3[0]['owner_id'], (int)$a['id']);
// プライベートの複製はプライベートのまま、他人には見えない
$srcPriv = $mk($a, ['kind' => 'private', 'title' => '秘密の予定', 'start' => $d0]);
[$cr4] = duplicate_event($srcPriv, [$t1], $a);
check('複製: プライベートはプライベートのまま', $cr4[0]['kind'], 'private');
check('複製: 他の社員・管理者にはコピーも見えない', [in_array('秘密の予定', $titles(list_events($b, $t1, $t1, 'team')), true), in_array('秘密の予定', $titles(list_events($admin, $t1, $t1, 'me', ['tags' => cfg('work_tags'), 'showOff' => true])), true)], [false, false]);
check('複製: 他人のプライベートは複製元として見つからない', find_event((int)$srcPriv['id'], $b), null);
check('複製: 一般社員は他人の休みを複製できない（編集権限なし）', can_edit_event($srcOff, $b), false);
// 繰り返し予定の複製 → 通常の予定になる
$sid2 = (int)(function () use ($a) { q("INSERT INTO series (owner_id,title,tag,rule_type,p_day,shift,created_at) VALUES (?,?,?,?,?,?,?)", [$a['id'], '複製元ルール', '定例業務', 'day', 15, 'none', now_str()]); return db()->lastInsertId(); })();
materialize_series($sid2);
$srcSeries = row('SELECT * FROM events WHERE series_id = ? ORDER BY start_date LIMIT 1', [$sid2]);
[$cr5] = duplicate_event($srcSeries, [date('Y-m-d', strtotime($srcSeries['start_date'] . ' +3 day'))], $a);
check('複製: 繰り返し予定のコピーは通常の予定', [$cr5[0]['series_id'], $cr5[0]['ym']], [null, null]);
delete_series($sid2);

// Slack 通知の重複防止
check('通知は1回目だけ true', notify_once('test:1'), true);
check('同じ通知は2回目 false', notify_once('test:1'), false);
check('Webhook未設定でも休み通知は例外にならない', notify_offs_for_day($today, '本日') >= 1, true);
check('通知の二重送信防止(同日2回目は0件)', notify_offs_for_day($today, '本日'), 0);

echo "\n結果: 成功 $pass / 失敗 $fail\n";
// 後片付け
array_map('unlink', glob($tmp . '/*'));
@rmdir($tmp);
exit($fail ? 1 : 0);
