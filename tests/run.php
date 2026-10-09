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
require_once __DIR__ . '/../src/updater.php';
require_once __DIR__ . '/../src/share.php';

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
$legacyCfg = $tmp . '/legacy.php';
file_put_contents($legacyCfg, "<?php return ['db' => ['dsn' => 'sqlite::memory:'], 'off_tags' => ['有給', '午前半休', '午後半休', 'その他の休み']];");
$custom = $tmp . '/custom.php';
file_put_contents($custom, "<?php return ['db' => ['dsn' => 'sqlite::memory:'], 'off_tags' => ['有給', '特別休暇']];");
foreach ([[$legacyCfg, ['有給', '調整休', '午前半休', '午後半休']], [$custom, ['有給', '特別休暇']]] as [$f, $want]) {
    $out = trim((string)shell_exec('SCHEDULE_CONFIG=' . escapeshellarg($f) . ' ' . escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg('require ' . var_export(__DIR__ . '/../src/bootstrap.php', true) . '; echo json_encode(cfg("off_tags"), JSON_UNESCAPED_UNICODE);')));
    check('古い初期値の config は新しい並びになり、自分で変えた分類は保たれる(' . basename($f) . ')', json_decode($out, true), $want);
}

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

// ---- 予定の移動 ----
$mv = $mk($a, ['kind' => 'work', 'title' => '移動する業務', 'tag' => '打ち合わせ', 'start' => date('Y-m-d', strtotime('+70 day')), 'end' => date('Y-m-d', strtotime('+72 day'))]);
$newS = date('Y-m-d', strtotime('+80 day'));
$m2 = move_event($mv, $newS);
check('移動: 期間(3日間)を保ったまま動く', [$m2['start_date'], $m2['end_date']], [$newS, date('Y-m-d', strtotime($newS . ' +2 day'))]);
$sid3 = (int)(function () use ($a) { q("INSERT INTO series (owner_id,title,tag,rule_type,p_day,shift,created_at) VALUES (?,?,?,?,?,?,?)", [$a['id'], '移動元ルール', '定例業務', 'day', 10, 'none', now_str()]); return db()->lastInsertId(); })();
materialize_series($sid3);
$rec = row('SELECT * FROM events WHERE series_id = ? ORDER BY start_date LIMIT 1', [$sid3]);
$recMoved = move_event($rec, date('Y-m-d', strtotime($rec['start_date'] . ' +1 day')));
check('移動: 繰り返し予定の1回分を動かすと個別扱いになる', (int)$recMoved['detached'], 1);
q('UPDATE series SET p_day = 20 WHERE id = ?', [$sid3]); materialize_series($sid3);
check('移動: 個別扱いの回はルール変更で上書きされない', row('SELECT start_date FROM events WHERE id = ?', [$rec['id']])['start_date'], $recMoved['start_date']);
delete_series($sid3);

// ---- ToDo ----
[$td1, $e1] = validate_todo_input(['kind' => 'work', 'title' => '見積書を作る', 'tag' => '個人作業']);
check('ToDo: 入力が通る', $e1, null);
$todoA = save_todo($td1, $a, null);
[$td2] = validate_todo_input(['kind' => 'private', 'title' => '歯医者の予約', 'tag' => '個人作業', 'note' => 'メモ']);
$todoP = save_todo($td2, $a, null);
check('ToDo: プライベートは分類が空になる', $todoP['tag'], '');
check('ToDo: 不正な種類を拒否', validate_todo_input(['kind' => 'off', 'title' => 'x'])[1] !== null, true);
check('ToDo: 空の内容を拒否', validate_todo_input(['kind' => 'work', 'title' => '  '])[1] !== null, true);
check('ToDo: 本人の画面(プライベート版)には全部出る', array_column(list_todos($a, 'me'), 'title'), ['見積書を作る', '歯医者の予約']);
check('ToDo: 業務版にはプライベートのToDoを出さない', array_column(list_todos($a, 'team'), 'title'), ['見積書を作る']);
check('ToDo: 他の社員・管理者には見えない', [list_todos($b, 'me'), list_todos($admin, 'me')], [[], []]);
check('ToDo: 他人のToDoは取得できない', [find_todo((int)$todoA['id'], $b), find_todo((int)$todoA['id'], $admin)], [null, null]);
// 並べ替え
[$tdx] = validate_todo_input(['kind' => 'work', 'title' => '3つ目', 'tag' => 'その他']); $todoC = save_todo($tdx, $a, null);
check('ToDo: 追加した順に並ぶ', array_column(list_todos($a, 'me'), 'title'), ['見積書を作る', '歯医者の予約', '3つ目']);
reorder_todos([(int)$todoC['id'], (int)$todoA['id'], (int)$todoP['id']], $a);
check('ToDo: 並べ替えが保存される', array_column(list_todos($a, 'me'), 'title'), ['3つ目', '見積書を作る', '歯医者の予約']);
reorder_todos([(int)$todoA['id'], (int)$todoC['id']], $a); // 業務版のように、プライベートが見えていない並べ替え
check('ToDo: 見えていない項目の位置は動かさない', array_column(list_todos($a, 'me'), 'title'), ['見積書を作る', '3つ目', '歯医者の予約']);
reorder_todos([(int)$todoA['id'], (int)$todoC['id']], $b); // 他人は動かせない
check('ToDo: 他人の並べ替えは効かない', array_column(list_todos($a, 'me'), 'title'), ['見積書を作る', '3つ目', '歯医者の予約']);
q('DELETE FROM todos WHERE id = ?', [$todoC['id']]);
// 日付へドラッグ → 予定になる（ToDoは消える）
$dd = date('Y-m-d', strtotime('+90 day'));
$ev = schedule_todo($todoA, $dd, $a);
check('ToDo→予定: 業務の予定として作られる', [$ev['kind'], $ev['title'], $ev['tag'], $ev['start_date'], $ev['end_date'], (int)$ev['owner_id']], ['work', '見積書を作る', '個人作業', $dd, $dd, (int)$a['id']]);
check('ToDo→予定: ToDoは消える', find_todo((int)$todoA['id'], $a), null);
check('ToDo→予定: 全社員に見える', in_array('見積書を作る', $titles(list_events($b, $dd, $dd, 'team')), true), true);
$evP = schedule_todo($todoP, $dd, $a);
check('ToDo→予定: プライベートのToDoはプライベートの予定になり、他人に見えない', [$evP['kind'], in_array('歯医者の予約', $titles(list_events($b, $dd, $dd, 'team')), true)], ['private', false]);
// 予定をToDoに戻す
$back = event_to_todo($ev, $a);
check('予定→ToDo: 内容が引き継がれる', [$back['title'], $back['kind'], $back['tag']], ['見積書を作る', 'work', '個人作業']);
check('予定→ToDo: 予定は消える', row('SELECT id FROM events WHERE id = ?', [$ev['id']]), null);
$thrown = function (callable $f) { try { $f(); return false; } catch (RuntimeException $x) { return true; } };
check('予定→ToDo: 休みは戻せない', $thrown(function () use ($a, $mk, $today) { event_to_todo($mk($a, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => date('Y-m-d', strtotime('+95 day'))]), $a); }), true);
$rec2 = row('SELECT * FROM events WHERE series_id IS NOT NULL LIMIT 1');
check('予定→ToDo: 繰り返し由来は戻せない', $rec2 === null ? true : $thrown(function () use ($rec2, $a) { event_to_todo($rec2, $a); }), true);
check('予定→ToDo: 他人の予定は戻せない', $thrown(function () use ($admin, $mv) { event_to_todo(row('SELECT * FROM events WHERE id = ?', [$mv['id']]), $admin); }), true);

// ---- ToDoの完了 ----
[$dA] = validate_todo_input(['kind' => 'work', 'title' => '完了テストA']); $tdA = save_todo($dA, $a, null);
[$dB] = validate_todo_input(['kind' => 'work', 'title' => '完了テストB']); $tdB = save_todo($dB, $a, null);
[$dP] = validate_todo_input(['kind' => 'private', 'title' => '完了テスト私用']); $tdP = save_todo($dP, $a, null);
set_todo_done($tdA, true); set_todo_done($tdP, true);
check('完了: 完了にすると、未完了のリストから消える', in_array('完了テストA', array_column(list_todos($a, 'me'), 'title'), true), false);
check('完了: 完了リストに入り、完了日時が付く', [array_column(list_done_todos($a, 'me'), 'title'), list_done_todos($a, 'me')[0]['done_at'] !== null], [['完了テスト私用', '完了テストA'], true]);
check('完了: 業務版の完了リストには業務のToDoだけ', array_column(list_done_todos($a, 'team'), 'title'), ['完了テストA']);
check('完了: 他の社員には完了リストも見えない', [list_done_todos($b, 'me'), list_done_todos($admin, 'me')], [[], []]);
check('完了: 完了したToDoは予定にできない', $thrown(function () use ($tdA, $a) { schedule_todo(find_todo((int)$tdA['id'], $a), '2026-12-01', $a); }), true);
reorder_todos([(int)$tdA['id'], (int)$tdB['id']], $a);
check('完了: 並べ替えは未完了だけが対象', find_todo((int)$tdA['id'], $a)['done_at'] !== null, true);
set_todo_done(find_todo((int)$tdA['id'], $a), false);
$act = array_column(list_todos($a, 'me'), 'title');
check('完了: 未完了に戻すと、リストの末尾に入る', end($act), '完了テストA');
check('完了: 戻すと完了リストから消える', in_array('完了テストA', array_column(list_done_todos($a, 'me'), 'title'), true), false);
check('完了: 業務版で完了を一括削除しても、プライベートの完了は残る', [clear_done_todos($a, 'team'), array_column(list_done_todos($a, 'me'), 'title')], [0, ['完了テスト私用']]);
set_todo_done(find_todo((int)$tdB['id'], $a), true);
check('完了: 一括削除（プライベート版）で全て消える', [clear_done_todos($a, 'me'), list_done_todos($a, 'me')], [2, []]);
foreach (list_todos($a, 'me') as $leftover) { q('DELETE FROM todos WHERE id = ?', [$leftover['id']]); }

// ---- 日報メモ ----
check('メモ: 取り消し線と改行は残る', sanitize_memo_html('<div>終わった<s>商品の登録</s></div><div><br></div><div>次</div>'), '<div>終わった<s>商品の登録</s></div><div><br></div><div>次</div>');
check('メモ: strike/del は s にそろう', sanitize_memo_html('<strike>a</strike><del>b</del>'), '<s>a</s><s>b</s>');
check('メモ: p は div になる', sanitize_memo_html('<p>x</p>'), '<div>x</div>');
check('メモ: 属性は全て消える', sanitize_memo_html('<div onclick="alert(1)" style="color:red"><s class="x" onmouseover="y()">t</s></div>'), '<div><s>t</s></div>');
check('メモ: script・style は中身ごと消える', sanitize_memo_html('a<script>alert(1)</script>b<style>*{}</style>c'), 'abc');
check('メモ: 許可外のタグ(a/img/iframe)は消え、文字は残る', sanitize_memo_html('<a href="javascript:x">link</a><img src=x onerror=y>z<iframe src=x></iframe>'), 'linkz');
check('メモ: 文字としての < は無害のまま', strpos(sanitize_memo_html('1 &lt; 2 &lt;script&gt;'), '<script') === false, true);
save_memo('<div><s>終わった業務</s></div><div>これから</div>', $a);
check('メモ: 保存して読み出せる', get_memo($a), '<div><s>終わった業務</s></div><div>これから</div>');
check('メモ: 他の人のメモは空（本人だけ）', [get_memo($b), get_memo($admin)], ['', '']);
save_memo('<div>上書き</div>', $a);
check('メモ: 上書き保存', get_memo($a), '<div>上書き</div>');
check('メモ: 長すぎると拒否', $thrown(function () use ($a) { save_memo(str_repeat('あ', MEMO_MAX_CHARS + 1), $a); }), true);

// ---- 共有リンク（家族用・会社用） ----
$sd = date('Y-m-d', strtotime('+120 day'));
$pubShared = $mk($a, ['kind' => 'private', 'title' => '家族に共有する予定', 'start' => $sd, 'note' => '場所メモ']);
$pubHidden = $mk($a, ['kind' => 'private', 'title' => '共有しない予定', 'start' => $sd, 'family_shared' => 0]);
$bPriv = $mk($b, ['kind' => 'private', 'title' => '鈴木の私的予定', 'start' => $sd]);
$wk = $mk($a, ['kind' => 'work', 'title' => '共有される業務', 'tag' => '打ち合わせ', 'start' => $sd, 'note' => '社内メモ']);
$of = $mk($b, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $sd]);
check('家族共有: プライベートの初期値は「共有する」', (int)$pubShared['family_shared'], 1);
check('家族共有: チェックを外すと共有しない', (int)$pubHidden['family_shared'], 0);
check('家族共有: 業務・休みの初期値は「共有しない」（選んだものだけ共有）', [(int)validate_event_input(['kind' => 'work', 'title' => 'x', 'start' => $sd], $a)[0]['family_shared'], (int)validate_event_input(['kind' => 'off', 'title' => 'x', 'tag' => '有給', 'start' => $sd], $a)[0]['family_shared']], [0, 0]);
check('家族共有: 業務・休みも、チェックすれば共有できる', [(int)validate_event_input(['kind' => 'work', 'title' => 'x', 'start' => $sd, 'family_shared' => 1], $a)[0]['family_shared'], (int)validate_event_input(['kind' => 'off', 'title' => 'x', 'tag' => '有給', 'start' => $sd, 'family_shared' => true], $a)[0]['family_shared']], [1, 1]);
// リンクの作成・作り直し・停止
check('リンク: 一般社員は会社用を作れない', $thrown(function () use ($a) { share_link_create('company', $a); }), true);
check('リンク: 種類の不正を拒否', $thrown(function () use ($a) { share_link_create('x', $a); }), true);
$fl = share_link_create('family', $a);
check('リンク: 家族用は48文字のランダム文字列', share_valid_token($fl['token']), true);
check('リンク: 文字列から本人のリンクが見つかる', (int)share_link_find($fl['token'])['owner_id'], (int)$a['id']);
$fl2 = share_link_create('family', $a);
check('リンク: 作り直すと別の文字列になる', $fl2['token'] !== $fl['token'], true);
check('リンク: 作り直すと、古いURLは使えない', share_link_find($fl['token']), null);
check('リンク: 本人ごとに別のリンク', share_link_create('family', $b)['token'] !== $fl2['token'], true);
check('リンク: 不正な文字列は無効（空・短い・SQL・大文字）', [share_link_find(''), share_link_find('abc'), share_link_find("' OR 1=1 --"), share_link_find(strtoupper($fl2['token']))], [null, null, null, null]);
// 家族用の見える範囲
$fam = share_link_find($fl2['token']);
$famTitles = array_column(share_events($fam, $sd, $sd), 'title');
check('家族用: 「共有する」プライベート予定だけが見える', $famTitles, ['家族に共有する予定']);
check('家族用: 共有しない予定・他人の予定・業務・休みは出ない', [in_array('共有しない予定', $famTitles, true), in_array('鈴木の私的予定', $famTitles, true), in_array('共有される業務', $famTitles, true), count(array_filter(share_events($fam, $sd, $sd), function ($e) { return $e['kind'] !== 'private'; }))], [false, false, false, 0]);
check('家族用: メモも見える（本人が共有した予定だから）', share_events($fam, $sd, $sd)[0]['note'], '場所メモ');
check('家族用: 期間の外は出ない', share_events($fam, date('Y-m-d', strtotime($sd . ' +1 day')), date('Y-m-d', strtotime($sd . ' +5 day'))), []);
// 共有をあとから外すと、すぐ見えなくなる
$tmpShared = $mk($a, ['kind' => 'private', 'title' => 'あとで外す', 'start' => $sd]);
check('家族用: 共有中は見える', in_array('あとで外す', array_column(share_events($fam, $sd, $sd), 'title'), true), true);
[$dd2] = validate_event_input(['kind' => 'private', 'title' => 'あとで外す', 'start' => $sd, 'family_shared' => 0], $a);
save_event($dd2, $a, $tmpShared);
check('家族用: チェックを外すと、すぐ見えなくなる', in_array('あとで外す', array_column(share_events($fam, $sd, $sd), 'title'), true), false);
// 会社用の見える範囲
$cl = share_link_create('company', $admin);
$comp = share_link_find($cl['token']);
$compEv = share_events($comp, $sd, $sd);
check('会社用: 業務と休みが見える', array_column($compEv, 'title'), ['共有される業務', '休み']);
check('会社用: プライベートは（共有にチェックがあっても）絶対に出ない', count(array_filter($compEv, function ($e) { return $e['kind'] === 'private'; })), 0);
check('会社用: メモは出さない', array_unique(array_column($compEv, 'note')), ['']);
check('会社用: 管理者が停止すると使えなくなる', (function () use ($admin, $cl) { share_link_revoke('company', $admin); return share_link_find($cl['token']); })(), null);
check('リンク: 一般社員は会社用リンクを止められない', $thrown(function () use ($a) { share_link_revoke('company', $a); }), true);
// 利用停止になった本人の家族用リンクは使えない
q('UPDATE users SET active = 0 WHERE id = ?', [$b['id']]);
$bl = share_link_create('family', $b);
check('リンク: 利用停止の本人の家族用リンクは無効', share_link_find($bl['token']), null);
q('UPDATE users SET active = 1 WHERE id = ?', [$b['id']]);
share_link_revoke('family', $a); share_link_revoke('family', $b);
check('リンク: 停止すると使えない', share_link_find($fl2['token']), null);
// ---- 既存の予定（業務・休み・繰り返し）を家族に共有する ----
$fd = date('Y-m-d', strtotime('+150 day'));
$fw1 = $mk($a, ['kind' => 'work', 'title' => '共有しない業務', 'tag' => '打ち合わせ', 'start' => $fd]);
$fw2 = $mk($a, ['kind' => 'work', 'title' => '個別に共有する業務', 'tag' => '打ち合わせ', 'start' => $fd, 'family_shared' => 1]);
$fw3 = $mk($a, ['kind' => 'work', 'title' => '全体会議の業務', 'tag' => '全体会議', 'start' => $fd]);
$fo1 = $mk($a, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $fd]);
$bw = $mk($b, ['kind' => 'work', 'title' => '鈴木の業務', 'tag' => '打ち合わせ', 'start' => $fd, 'family_shared' => 1]);
$famL = share_link_find(share_link_create('family', $a)['token']);
$fam1 = function () use ($famL, $fd) { return array_column(share_events($famL, $fd, $fd), 'title'); };
check('既存予定の共有: 初期状態では、業務・休みは家族に見えない', in_array('共有しない業務', $fam1(), true) || in_array('休み', $fam1(), true), false);
check('既存予定の共有: チェックした業務だけが家族に見える', $fam1(), ['個別に共有する業務']);
[$ed] = validate_event_input(['kind' => 'work', 'title' => '共有しない業務', 'tag' => '打ち合わせ', 'start' => $fd, 'family_shared' => 1], $a);
save_event($ed, $a, $fw1);
check('既存予定の共有: 既存の業務を編集してチェックすると、すぐ家族に見える', in_array('共有しない業務', $fam1(), true), true);
check('既存予定の共有: 他の人（鈴木）の業務は、チェックがあっても見えない', in_array('鈴木の業務', $fam1(), true), false);
save_family_share($a, true, ['全体会議']);
check('範囲の設定: 休みを全て見せる + 分類「全体会議」の業務を見せる', $fam1(), ['共有しない業務', '個別に共有する業務', '全体会議の業務', '休み']);
check('範囲の設定: 設定は保存され、読み出せる', get_family_share($a), ['off' => true, 'tags' => ['全体会議']]);
save_family_share($a, false, ['存在しない分類', '打ち合わせ', '全体会議']);
check('範囲の設定: 存在しない分類は捨て、並びは設定どおり', get_family_share($a), ['off' => false, 'tags' => ['全体会議', '打ち合わせ']]);
check('範囲の設定: 打ち合わせ+全体会議の業務が全て見える（休みは外した）', $fam1(), ['共有しない業務', '個別に共有する業務', '全体会議の業務']);
save_family_share($a, false, []);
check('範囲の設定: 全て外すと、チェックした予定だけに戻る', $fam1(), ['共有しない業務', '個別に共有する業務']);
check('範囲の設定: 他の人の設定は影響しない', get_family_share($b), ['off' => false, 'tags' => []]);
// 会社用リンクは、家族への共有設定に関係なく変わらない
$compL = share_link_find(share_link_create('company', $admin)['token']);
check('会社用リンクは、家族への共有設定に関係しない（プライベートなし・メモなし）', [count(array_filter(share_events($compL, $fd, $fd), function ($e) { return $e['kind'] === 'private'; })), array_unique(array_column(share_events($compL, $fd, $fd), 'note'))], [0, ['']]);
// 管理者が他の人の予定を編集しても、持ち主の共有設定は変わらない
[$adm] = validate_event_input(['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $fd, 'family_shared' => 1], $admin);
save_event($adm, $admin, $fo1);
check('管理者が編集しても、持ち主の「共有しない」は変わらない', (int)row('SELECT family_shared FROM events WHERE id = ?', [$fo1['id']])['family_shared'], 0);
[$own] = validate_event_input(['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $fd, 'family_shared' => 1], $a);
save_event($own, $a, $fo1);
check('持ち主が編集すれば、共有できる', in_array('休み', $fam1(), true), true);
// 繰り返しで自動作成される予定・ToDoから作る予定の初期値は「共有しない」
q("INSERT INTO series (owner_id,title,tag,rule_type,p_day,shift,created_at) VALUES (?,?,?,?,?,?,?)", [$a['id'], '共有確認ルール', '定例業務', 'day', 18, 'none', now_str()]);
$sidF = (int)db()->lastInsertId(); materialize_series($sidF);
check('繰り返しで自動作成された予定は、初期状態では共有されない', array_unique(array_map('intval', array_column(rows('SELECT family_shared FROM events WHERE series_id = ?', [$sidF]), 'family_shared'))), [0]);
save_family_share($a, false, ['定例業務']);
$recDate = row('SELECT start_date FROM events WHERE series_id = ? ORDER BY start_date LIMIT 1', [$sidF])['start_date'];
check('分類を選ぶと、繰り返しの予定（既存分）がまとめて家族に見える', in_array('共有確認ルール', array_column(share_events($famL, $recDate, $recDate), 'title'), true), true);
save_family_share($a, false, []); delete_series($sidF);
[$wt] = validate_todo_input(['kind' => 'work', 'title' => '共有確認ToDo']);
check('業務のToDoの初期値は「共有しない」、プライベートは「共有する」', [$wt['family_shared'], validate_todo_input(['kind' => 'private', 'title' => 'x'])[0]['family_shared']], [0, 1]);
$wtEv = schedule_todo(save_todo($wt, $a, null), $fd, $a);
check('業務のToDoから作った予定は、初期状態では共有されない', (int)$wtEv['family_shared'], 0);
// 一回限りのデータ移行: 旧版で初期値(1)のまま入っている業務・休みは「共有しない」に戻り、プライベートは触らない
q("UPDATE events SET family_shared = 1 WHERE kind IN ('work','off')"); q("UPDATE todos SET family_shared = 1 WHERE kind = 'work'");
$mp = $mk($a, ['kind' => 'private', 'title' => '移行確認の私用', 'start' => $fd, 'family_shared' => 0]);
$mp2 = $mk($a, ['kind' => 'private', 'title' => '移行確認の私用2', 'start' => $fd]);
q("DELETE FROM app_meta WHERE meta_key = 'schema_version'"); q("INSERT INTO app_meta (meta_key, meta_value) VALUES ('schema_version', '6')");
ensure_schema();
check('データ移行: 旧版の業務・休みの共有指定は、全て「共有しない」に戻る', [(int)row("SELECT COUNT(*) AS c FROM events WHERE kind IN ('work','off') AND family_shared = 1")['c'], (int)row("SELECT COUNT(*) AS c FROM todos WHERE kind = 'work' AND family_shared = 1")['c']], [0, 0]);
check('データ移行: プライベートの共有指定（共有する・しない）は、そのまま', [(int)row('SELECT family_shared FROM events WHERE id = ?', [$mp['id']])['family_shared'], (int)row('SELECT family_shared FROM events WHERE id = ?', [$mp2['id']])['family_shared']], [0, 1]);
ensure_schema();
check('データ移行: 2回目以降は何もしない（あとから選んだ共有を消さない）', (function () use ($fo1) { q('UPDATE events SET family_shared = 1 WHERE id = ?', [$fo1['id']]); ensure_schema(); return (int)row('SELECT family_shared FROM events WHERE id = ?', [$fo1['id']])['family_shared']; })(), 1);

// 複製・ToDo⇔予定でも「共有しない」を引き継ぐ
[$dup] = duplicate_event($pubHidden, [date('Y-m-d', strtotime($sd . ' +9 day'))], $a);
check('共有設定: 複製しても「共有しない」を引き継ぐ', (int)$dup[0]['family_shared'], 0);
$tdBack = event_to_todo($pubHidden, $a);
check('共有設定: ToDoに戻しても「共有しない」を引き継ぐ', $tdBack['family_shared'], 0);
$evBack = schedule_todo(find_todo((int)$tdBack['id'], $a), $sd, $a);
check('共有設定: ToDoから予定にしても「共有しない」のまま', (int)$evBack['family_shared'], 0);
[$tdN] = validate_todo_input(['kind' => 'private', 'title' => '共有ToDo']);
check('共有設定: プライベートToDoの初期値は「共有する」', $tdN['family_shared'], 1);

// ---- 自動更新(ensure_schema) ----
ensure_schema();
check('スキーマの版が記録される', (int)row("SELECT meta_value AS v FROM app_meta WHERE meta_key = 'schema_version'")['v'], SCHEMA_VERSION);
db()->exec('DROP TABLE todos'); q("DELETE FROM app_meta WHERE meta_key = 'schema_version'");
ensure_schema();
check('テーブルが無くなっていても、ensure_schema で自動で作り直される', (int)row('SELECT COUNT(*) AS c FROM todos')['c'], 0);

// Slack 通知の重複防止
check('通知は1回目だけ true', notify_once('test:1'), true);
check('同じ通知は2回目 false', notify_once('test:1'), false);
check('Webhook未設定でも休み通知は例外にならない', notify_offs_for_day($today, '本日') >= 1, true);
check('通知の二重送信防止(同日2回目は0件)', notify_offs_for_day($today, '本日'), 0);


// ---- システム更新（updater） ----
$U = $tmp . '/upd'; mkdir($U); mkdir("$U/web"); mkdir("$U/app"); mkdir("$U/app/src");
file_put_contents("$U/app/src/a.php", "<?php // OLD\n");
file_put_contents("$U/app/src/same.php", "<?php // SAME\n");
file_put_contents("$U/web/config.php", "SERVER-SECRET");
$mkzip = function (array $entries, string $name) use ($U) {
    $z = new ZipArchive(); $path = "$U/$name"; $z->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    foreach ($entries as $k => $v) { $z->addFromString($k, $v); }
    $z->close(); return $path;
};
$thr = function (callable $f) { try { $f(); return null; } catch (UpdaterException $x) { return $x->getMessage(); } };
$zipOk = $mkzip([
    'src/a.php' => "<?php // NEW\n", 'src/same.php' => "<?php // SAME\n", 'src/b.php' => "<?php // B\n",
    'public/assets/app.js' => '// js', 'public/install.php' => '<?php // 入れてはいけない', 'public/app_path.php' => '<?php // 上書き禁止',
    'src/config.php' => '<?php // 上書き禁止', 'config.php' => '<?php // 上書き禁止', 'tests/run.php' => '<?php // 対象外', 'src/run.sh' => 'rm -rf /',
    'src/.htaccess' => 'x', 'public/.env' => 'x',
], 'ok.zip');
$r = updater_apply($zipOk, "$U/web", "$U/app");
check('更新: 対象の3ファイルだけが変わる', $r['changed'], ['src/a.php', 'src/b.php', 'public/assets/app.js']);
check('更新: 同じ内容のファイルは変更なし扱い', $r['unchanged'], 1);
check('更新: 対象外(install/app_path/config/tests/.sh/.htaccess等)は飛ばす', $r['skipped'], 8);
check('更新: 新しい内容が書き込まれる', [file_get_contents("$U/app/src/a.php"), file_get_contents("$U/web/assets/app.js")], ["<?php // NEW\n", '// js']);
check('更新: install.php / app_path.php / config.php は作られない・変わらない', [is_file("$U/web/install.php"), is_file("$U/web/app_path.php"), file_get_contents("$U/web/config.php"), is_file("$U/app/src/config.php")], [false, false, 'SERVER-SECRET', false]);
check('更新: バックアップが作られる', count(updater_backups("$U/app")), 1);
// 元に戻す
$n = updater_restore($r['backup'], "$U/web", "$U/app");
check('復元: 更新前の内容に戻る', [file_get_contents("$U/app/src/a.php"), is_file("$U/app/src/b.php"), is_file("$U/web/assets/app.js")], ["<?php // OLD\n", false, false]);
// 危険な zip は全体を拒否し、何も書かない
$before = file_get_contents("$U/app/src/a.php");
check('拒否: ../ を含む zip', $thr(function () use ($mkzip, $U) { updater_apply($mkzip(['src/x.php' => '<?php', '../evil.php' => '<?php'], 'bad1.zip'), "$U/web", "$U/app"); }) !== null, true);
check('拒否: 絶対パスを含む zip', $thr(function () use ($mkzip, $U) { updater_apply($mkzip(['/etc/evil.php' => '<?php'], 'bad2.zip'), "$U/web", "$U/app"); }) !== null, true);
check('拒否: 文法が壊れた PHP を含む zip(全体を中止)', $thr(function () use ($mkzip, $U) { updater_apply($mkzip(['src/a.php' => "<?php echo 'x'", 'src/fine.php' => '<?php echo 1;'], 'bad3.zip'), "$U/web", "$U/app"); }) !== null, true);
check('拒否した更新では、何も書き換わらない', [file_get_contents("$U/app/src/a.php"), is_file("$U/app/src/fine.php"), is_file("$U/app/src/../evil.php")], [$before, false, false]);
check('拒否: 更新できるファイルが無い zip', $thr(function () use ($mkzip, $U) { updater_apply($mkzip(['README.md' => 'x', 'docs/a.md' => 'x'], 'none.zip'), "$U/web", "$U/app"); }) !== null, true);
// GitHub の Download ZIP（先頭にフォルダが付く）
$r2 = updater_apply($mkzip(['repo-main/src/gh.php' => '<?php // GH', 'repo-main/public/assets/gh.css' => 'a{}', 'repo-main/README.md' => 'x', 'repo-main/tests/run.php' => '<?php'], 'gh.zip'), "$U/web", "$U/app");
check('GitHubのzip: 先頭フォルダを外して適用', [$r2['changed'], is_file("$U/app/src/gh.php"), is_file("$U/web/assets/gh.css")], [['src/gh.php', 'public/assets/gh.css'], true, true]);
check('復元: 名前の検証(../ を拒否)', $thr(function () use ($U) { updater_restore('../x.zip', "$U/web", "$U/app"); }) !== null, true);

echo "\n結果: 成功 $pass / 失敗 $fail\n";
// 後片付け
$rm = function ($p) use (&$rm) { if (is_dir($p) && !is_link($p)) { foreach (scandir($p) as $f) { if ($f !== '.' && $f !== '..') { $rm($p . '/' . $f); } } @rmdir($p); } else { @unlink($p); } };
$rm($tmp);
exit($fail ? 1 : 0);
