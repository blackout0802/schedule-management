<?php
// 使い方: php tests/run.php   （SQLite の一時DBを使うので、本番DBには触れません）
$tmp = sys_get_temp_dir() . '/sched_test_' . getmypid();
@mkdir($tmp);
// 既定は SQLite。MySQL/MariaDB で試す場合: SCHEDULE_TEST_DSN='mysql:host=localhost;dbname=xxx;charset=utf8mb4' SCHEDULE_TEST_USER=.. SCHEDULE_TEST_PASS=.. php tests/run.php
$dsn = getenv('SCHEDULE_TEST_DSN') ?: "sqlite:$tmp/t.sqlite";
$dbCfg = var_export(['dsn' => $dsn, 'user' => getenv('SCHEDULE_TEST_USER') ?: null, 'pass' => getenv('SCHEDULE_TEST_PASS') ?: null], true);
file_put_contents($tmp . '/config.php', "<?php return ['db' => $dbCfg, 'slack_webhook' => '', 'base_url' => 'https://example.test/public/index.php'];");
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
check('休みの分類の並び', cfg('off_tags'), ['有給', '調整休', '欠勤', '午前半休', '午後半休']);
$legacyCfg = $tmp . '/legacy.php';
file_put_contents($legacyCfg, "<?php return ['db' => ['dsn' => 'sqlite::memory:'], 'off_tags' => ['有給', '午前半休', '午後半休', 'その他の休み']];");
$custom = $tmp . '/custom.php';
file_put_contents($custom, "<?php return ['db' => ['dsn' => 'sqlite::memory:'], 'off_tags' => ['有給', '特別休暇']];");
$prevCfg = $tmp . '/prev.php';
file_put_contents($prevCfg, "<?php return ['db' => ['dsn' => 'sqlite::memory:'], 'off_tags' => ['有給', '調整休', '午前半休', '午後半休']];");
$newOff = ['有給', '調整休', '欠勤', '午前半休', '午後半休'];
foreach ([[$legacyCfg, $newOff], [$prevCfg, $newOff], [$custom, ['有給', '特別休暇']]] as [$f, $want]) {
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
create_user('試験', 'lock@example.com', 'rightpass1');
for ($i = 0; $i < LOGIN_MAX_PER_EMAIL; $i++) { login_attempt('lock@example.com', 'wrong' . $i); }
$lk = null; $lkRes = login_attempt('lock@example.com', 'rightpass1', $lk);
check('ログイン制限: 失敗が続くと、正しいパスワードでも試せない', [$lkRes, $lk], [null, true]);
check('ログイン制限: 大文字小文字・空白が違っても同じメールとして数える', (function () { $l = null; login_attempt(' LOCK@example.com ', 'rightpass1', $l); return $l; })(), true);
$okOther = null; $okRes = login_attempt('a@example.com', 'password1', $okOther);
check('ログイン制限: 他のメールアドレスには影響しない', [$okRes !== null, $okOther], [true, false]);
q('UPDATE login_fails SET failed_at = ? WHERE email = ?', [date('Y-m-d H:i:s', time() - LOGIN_WINDOW_SEC - 60), 'lock@example.com']);
$lk2 = null; $res2 = login_attempt('lock@example.com', 'rightpass1', $lk2);
check('ログイン制限: 15分たつと、また試せて、成功すると失敗の記録が消える', [$res2 !== null, $lk2, (int)row('SELECT COUNT(*) AS c FROM login_fails WHERE email = ?', ['lock@example.com'])['c']], [true, false, 0]);
check('ログイン制限: 存在しないメールアドレスも数える（有無を探れない）', (function () { for ($i = 0; $i < LOGIN_MAX_PER_EMAIL; $i++) { login_attempt('nobody@example.com', 'x'); } $l = null; login_attempt('nobody@example.com', 'x', $l); return $l; })(), true);
db()->exec('DELETE FROM login_fails');

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

// ---- ToDoのカンバン（状態: 未着手・進行中・完了） ----
[$kA] = validate_todo_input(['kind' => 'work', 'title' => 'カンバンA']); $kbA = save_todo($kA, $a, null);
[$kB] = validate_todo_input(['kind' => 'work', 'title' => 'カンバンB']); $kbB = save_todo($kB, $a, null);
[$kC] = validate_todo_input(['kind' => 'private', 'title' => 'カンバンC']); $kbC = save_todo($kC, $a, null);
$stOf = function (array $u) { $m = []; foreach (list_todos($u, 'me') as $t) { $m[$t['title']] = $t['status']; } foreach (list_done_todos($u, 'me') as $t) { $m[$t['title']] = $t['status']; } return $m; };
check('カンバン: 新しいToDoは未着手', $stOf($a)['カンバンA'], 'todo');
set_todo_status($kbA, 'doing');
check('カンバン: 進行中にできる（未完了のリストに残る）', [$stOf($a)['カンバンA'], find_todo((int)$kbA['id'], $a)['done_at']], ['doing', null]);
set_todo_status(find_todo((int)$kbA['id'], $a), 'done');
check('カンバン: 進行中から完了へ', [$stOf($a)['カンバンA'], find_todo((int)$kbA['id'], $a)['done_at'] !== null, (int)find_todo((int)$kbA['id'], $a)['doing']], ['done', true, 0]);
set_todo_status(find_todo((int)$kbA['id'], $a), 'doing');
check('カンバン: 完了から進行中へ戻せる', [$stOf($a)['カンバンA'], find_todo((int)$kbA['id'], $a)['done_at']], ['doing', null]);
set_todo_status(find_todo((int)$kbA['id'], $a), 'todo');
check('カンバン: 進行中から未着手へ戻せる', $stOf($a)['カンバンA'], 'todo');
set_todo_status(find_todo((int)$kbB['id'], $a), 'doing');
set_todo_status(find_todo((int)$kbC['id'], $a), 'doing');
reorder_todos([(int)$kbC['id'], (int)$kbB['id']], $a);
$doingOrder = array_column(array_filter(list_todos($a, 'me'), function ($t) { return $t['status'] === 'doing'; }), 'title');
check('カンバン: 進行中の列の並べ替え', array_values($doingOrder), ['カンバンC', 'カンバンB']);
check('カンバン: 業務版は業務の進行中だけ', array_column(array_filter(list_todos($a, 'team'), function ($t) { return $t['status'] === 'doing'; }), 'title'), ['カンバンB']);
check('カンバン: 進行中のToDoも予定にできる（ToDoは消える）', (function () use ($kbB, $a) { schedule_todo(find_todo((int)$kbB['id'], $a), '2026-12-02', $a); return find_todo((int)$kbB['id'], $a); })(), null);
check('カンバン: 他の人のToDoは見えない・操作できない', [find_todo((int)$kbC['id'], $b), array_column(list_todos($b, 'me'), 'title')], [null, []]);
foreach (list_todos($a, 'me') as $leftover) { q('DELETE FROM todos WHERE id = ?', [$leftover['id']]); }
q("DELETE FROM events WHERE title = 'カンバンB'");

// ---- 月のまとめ（出勤日・休みの日数） ----
$sumU = row('SELECT * FROM users WHERE id = ?', [create_user('集計', 'sum@example.com', 'password1')]);
$sumO = row('SELECT * FROM users WHERE id = ?', [create_user('集計他', 'sumo@example.com', 'password1')]);
$mkOff = function (array $u, string $tag, string $s, string $e) use ($mk) { return $mk($u, ['kind' => 'off', 'title' => '', 'tag' => $tag, 'start' => $s, 'end' => $e]); };
// 2026年11月: 平日は21日。祝日は 11/3(文化の日)・11/23(勤労感謝の日) の2日 → 営業日19日
$s0 = month_summary($sumU, '2026-11');
check('月のまとめ: 営業日（土日祝を除く）', $s0['biz_days'], 19);
check('月のまとめ: 休みが無ければ、出勤日=営業日。有給・欠勤は0日で出る', [$s0['work_days'], $s0['off_days'], array_column($s0['by_tag'], 'days', 'tag')], [19.0, 0.0, ['有給' => 0.0, '欠勤' => 0.0]]);
$mkOff($sumU, '有給', '2026-11-02', '2026-11-02');            // 月曜 1日
$mkOff($sumU, '有給', '2026-11-05', '2026-11-09');            // 木〜月: 平日3日（土日を除く）
$mkOff($sumU, '欠勤', '2026-11-12', '2026-11-12');            // 1日
$mkOff($sumU, '午前半休', '2026-11-16', '2026-11-16');        // 0.5日
$mkOff($sumU, '午後半休', '2026-11-16', '2026-11-16');        // 同じ日の午後 → 日としては1日まで
$mkOff($sumU, '調整休', '2026-11-21', '2026-11-23');          // 土・日・祝 → 営業日ではないので数えない
$mkOff($sumO, '有給', '2026-11-17', '2026-11-18');            // 他人の休みは数えない
$s1 = month_summary($sumU, '2026-11');
check('月のまとめ: 休みの日数（半休は同じ日でも1日まで・土日祝は数えない）', $s1['off_days'], 6.0);
check('月のまとめ: 出勤日 = 営業日 - 休みの日', $s1['work_days'], 13.0);
check('月のまとめ: 分類ごとの内訳（有給・調整休・欠勤・午前半休・午後半休の順）', array_column($s1['by_tag'], 'days', 'tag'), ['有給' => 4.0, '欠勤' => 1.0, '午前半休' => 0.5, '午後半休' => 0.5]);
$mkOff($sumU, '有給', '2026-10-30', '2026-11-03');            // 月をまたぐ → 11月の分だけ（11/2 は上と重なる）
check('月のまとめ: 月をまたぐ休みは、その月の分だけ（同じ日・同じ分類は1日まで）', [month_summary($sumU, '2026-11')['off_days'], array_column(month_summary($sumU, '2026-11')['by_tag'], 'days', 'tag')['有給']], [6.0, 4.0]);
check('月のまとめ: 別の月には影響しない', month_summary($sumU, '2026-10')['off_days'], 1.0);
check('月のまとめ: 他人の分は、他人の画面だけ', month_summary($sumO, '2026-11')['off_days'], 2.0);
check('月のまとめ: 会社の休業日は営業日から引かれる', (function () use ($sumU) { q("INSERT INTO company_holidays (hdate, name) VALUES ('2026-11-27', '創立記念日')"); $r = month_summary($sumU, '2026-11')['biz_days']; q("DELETE FROM company_holidays WHERE hdate = '2026-11-27'"); return $r; })(), 18);
check('休みの分類に「欠勤」がある', in_array('欠勤', allowed_tags('off'), true), true);
$multi = month_summary_multi([['id' => $sumU['id'], 'name' => '集計'], ['id' => $sumO['id'], 'name' => '集計他']], '2026-11');
check('月のまとめ（複数人）: 社員ごとに、出勤日・休みの日数が出る', array_map(function ($p) { return [$p['name'], $p['work_days'], $p['off_days']]; }, $multi['people']), [['集計', 13.0, 6.0], ['集計他', 17.0, 2.0]]);
check('月のまとめ（複数人）: 営業日は全員共通', $multi['biz_days'], 19);
check('月のまとめ（複数人）: 本人の内訳は、他の人と混ざらない', array_column($multi['people'][1]['by_tag'], 'days', 'tag'), ['有給' => 2.0, '欠勤' => 0.0]);
$sumNames = function (array $l) { return array_column($l, 'name'); };
$allSum = summary_users($sumO, 'team', 0);
check('月のまとめに出す人: 業務版で全社なら、全社員（自分が先頭）', [$allSum[0]['id'], count($allSum) === (int)row('SELECT COUNT(*) AS c FROM users WHERE active = 1')['c']], [(int)$sumO['id'], true]);
check('月のまとめに出す人: 社員を選んだら、その人だけ', array_column(summary_users($sumO, 'team', (int)$sumU['id']), 'id'), [(int)$sumU['id']]);
check('月のまとめに出す人: プライベート版は、自分だけ', array_column(summary_users($sumO, 'me', 0), 'id'), [(int)$sumO['id']]);
check('月のまとめに出す人: 停止中の社員は出ない', (function () use ($sumU, $sumO) { q('UPDATE users SET active = 0 WHERE id = ?', [$sumU['id']]); $r = array_column(summary_users($sumO, 'team', 0), 'id'); q('UPDATE users SET active = 1 WHERE id = ?', [$sumU['id']]); return in_array((int)$sumU['id'], $r, true); })(), false);
q("DELETE FROM events WHERE owner_id IN (?, ?)", [$sumU['id'], $sumO['id']]);

// ---- 業務版: 表示する人（全社 / 個人） ----
$wA = $mk($a, ['kind' => 'work', 'title' => '表示A', 'tag' => '定例業務', 'start' => '2027-03-02', 'end' => '2027-03-02']);
$wB = $mk($b, ['kind' => 'work', 'title' => '表示B', 'tag' => '定例業務', 'start' => '2027-03-02', 'end' => '2027-03-02']);
$wBo = $mk($b, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2027-03-03', 'end' => '2027-03-03']);
$wBp = $mk($b, ['kind' => 'private', 'title' => '表示B私用', 'start' => '2027-03-02', 'end' => '2027-03-02']);
$titles = function (array $l) { $t = array_column($l, 'title'); sort($t); return $t; };
check('表示する人: 全社なら、全員の業務・休み（プライベートは無し）', $titles(list_events($a, '2027-03-01', '2027-03-31', 'team')), ['休み', '表示A', '表示B']);
check('表示する人: 特定の社員だけ（その人の業務と休み。プライベートは出ない）', $titles(list_events($a, '2027-03-01', '2027-03-31', 'team', ['who' => (int)$b['id']])), ['休み', '表示B']);
check('表示する人: 自分を選べば、自分の分だけ', $titles(list_events($a, '2027-03-01', '2027-03-31', 'team', ['who' => (int)$a['id']])), ['表示A']);
check('表示する人: 存在しない社員なら、空', list_events($a, '2027-03-01', '2027-03-31', 'team', ['who' => 99999]), []);
check('表示する人: 管理者でも、他人のプライベートは出ない', in_array('表示B私用', array_column(list_events($admin, '2027-03-01', '2027-03-31', 'team', ['who' => (int)$b['id']]), 'title'), true), false);
q("DELETE FROM events WHERE start_date >= '2027-03-01' AND start_date <= '2027-03-31'");

// ---- 重要な予定 ----
$impNew = $mk($a, ['kind' => 'work', 'title' => '重要テスト', 'tag' => '定例業務', 'start' => '2027-04-05', 'end' => '2027-04-05', 'important' => 1]);
check('重要: 登録時に重要にできる', [(int)$impNew['important'], event_for_client($impNew, $a)['important']], [1, true]);
check('重要: 指定しなければ、重要ではない', (int)$mk($a, ['kind' => 'work', 'title' => '普通', 'tag' => '定例業務', 'start' => '2027-04-06', 'end' => '2027-04-06'])['important'], 0);
[$dUp] = validate_event_input(['kind' => 'work', 'title' => '重要テスト(改)', 'tag' => '定例業務', 'start' => '2027-04-05', 'end' => '2027-04-05'], $a); // important を送らない更新
$impUp = save_event($dUp, $a, $impNew);
check('重要: 更新で指定がなければ、そのまま保たれる', (int)$impUp['important'], 1);
[$dOff] = validate_event_input(['kind' => 'work', 'title' => '重要テスト(改)', 'tag' => '定例業務', 'start' => '2027-04-05', 'end' => '2027-04-05', 'important' => false], $a);
check('重要: 外せる', (int)save_event($dOff, $a, $impUp)['important'], 0);
[$dOn] = validate_event_input(['kind' => 'work', 'title' => '重要テスト(改)', 'tag' => '定例業務', 'start' => '2027-04-05', 'end' => '2027-04-05', 'important' => true], $admin);
check('重要: 管理者も、他の人の予定を重要にできる', (int)save_event($dOn, $admin, row('SELECT * FROM events WHERE id = ?', [$impNew['id']]))['important'], 1);
[$dupC] = duplicate_event(row('SELECT * FROM events WHERE id = ?', [$impNew['id']]), ['2027-04-12'], $a);
check('重要: 複製しても、重要のまま', (int)$dupC[0]['important'], 1);
check('重要: 他の社員の画面にも、重要として届く', (function () use ($b) { foreach (list_events($b, '2027-04-01', '2027-04-30', 'team') as $e) { if ($e['title'] === '重要テスト(改)' && $e['start'] === '2027-04-05') return $e['important']; } return null; })(), true);
q("DELETE FROM events WHERE start_date >= '2027-04-01' AND start_date <= '2027-04-30'");

// ---- 家族用の更新履歴 ----
db()->exec('DELETE FROM event_log');
save_family_share($a, false, []);
$lg = function () use ($a) { return array_reverse(family_event_log((int)$a['id'])['entries']); }; // 古い順
$lgLast = function () use ($lg) { $l = $lg(); return $l[count($l) - 1]; };
$lp = $mk($a, ['kind' => 'private', 'title' => '歯医者', 'start' => '2027-05-10', 'end' => '2027-05-10', 'start_time' => '10:00']);
check('更新履歴: 家族に見える予定を追加すると「追加」が残る', array_map(function ($e) { return [$e['action'], $e['title'], $e['from']]; }, $lg()), [['add', '歯医者', '2027-05-10']]);
[$u1] = validate_event_input(['kind' => 'private', 'title' => '歯医者', 'start' => '2027-05-12', 'end' => '2027-05-12', 'start_time' => '14:00'], $a);
$lp = save_event($u1, $a, $lp);
check('更新履歴: 日付と時刻の変更が、前後つきで残る', $lg()[1]['detail'], '日付 5/10 → 5/12／時刻 10:00 → 14:00');
[$u2] = validate_event_input(['kind' => 'private', 'title' => '歯医者（定期）', 'start' => '2027-05-12', 'end' => '2027-05-12', 'start_time' => '14:00', 'note' => '保険証', 'important' => 1], $a);
$lp = save_event($u2, $a, $lp);
check('更新履歴: 件名・メモ・重要の変更', $lg()[2]['detail'], '件名「歯医者」→「歯医者（定期）」／メモを更新／重要にしました');
$n0 = count($lg()); save_event($u2, $a, $lp);
check('更新履歴: 内容が変わらない保存は残さない', count($lg()), $n0);
move_event($lp, '2027-05-20');
check('更新履歴: ドラッグでの移動も残る', $lg()[3]['detail'], '日付 5/12 → 5/20');
$wk = $mk($a, ['kind' => 'work', 'title' => '共有しない業務', 'tag' => '打ち合わせ', 'start' => '2027-05-11', 'end' => '2027-05-11']);
check('更新履歴: 家族に見えない予定（業務の非共有）は、記録そのものを残さない', array_column($lg(), 'title'), ['歯医者', '歯医者', '歯医者（定期）', '歯医者（定期）']);
[$u3] = validate_event_input(['kind' => 'work', 'title' => '共有しない業務', 'tag' => '打ち合わせ', 'start' => '2027-05-11', 'end' => '2027-05-11', 'family_shared' => 1], $a);
$wk = save_event($u3, $a, $wk);
check('更新履歴: 共有にチェックした業務は、その時点で「追加」になる', [$lgLast()['action'], $lgLast()['title']], ['add', '共有しない業務']);
[$u4] = validate_event_input(['kind' => 'work', 'title' => '共有しない業務', 'tag' => '打ち合わせ', 'start' => '2027-05-11', 'end' => '2027-05-11', 'family_shared' => 0], $a);
$wk = save_event($u4, $a, $wk);
check('更新履歴: 共有を外すと「削除」（家族の画面から消えるため）', $lgLast()['action'], 'delete');
$off = $mk($a, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2027-05-14', 'end' => '2027-05-14']);
check('更新履歴: 家族に見せない設定の休みは記録しない', count(array_filter($lg(), function ($e) { return $e['title'] === '休み'; })), 0);
save_family_share($a, true, []);
[$u5] = validate_event_input(['kind' => 'off', 'title' => '', 'tag' => '欠勤', 'start' => '2027-05-15', 'end' => '2027-05-15'], $a);
$off = save_event($u5, $a, $off);
$offLog = $lgLast();
check('更新履歴: 休みは「休み」とだけ。種類（有給→欠勤）は書かない・日付の変更だけ残る', [$offLog['title'], $offLog['detail']], ['休み', '日付 5/14 → 5/15']);
delete_event($lp);
check('更新履歴: 削除すると「削除」が残る', [$lgLast()['action'], $lgLast()['title']], ['delete', '歯医者（定期）']);
$mk($b, ['kind' => 'private', 'title' => '鈴木の私用', 'start' => '2027-05-10', 'end' => '2027-05-10']);
check('更新履歴: 他の人の予定は、自分の履歴に出ない', in_array('鈴木の私用', array_column($lg(), 'title'), true), false);
check('更新履歴: 他の人の履歴には、その人の分だけ', array_column(family_event_log((int)$b['id'])['entries'], 'title'), ['鈴木の私用']);
db()->exec('DELETE FROM event_log');
q("DELETE FROM events WHERE start_date >= '2027-05-01' AND start_date <= '2027-05-31'");
save_family_share($a, false, []);

// ---- 繰り返し業務と休みが重なるとき、休みを優先 ----
$lvO = row('SELECT * FROM users WHERE id = ?', [create_user('休み優先', 'leave@example.com', 'password1')]);
q("INSERT INTO series (owner_id,title,tag,rule_type,p_day,p_day2,bizonly,shift,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [$lvO['id'], '期間の業務', '定例業務', 'range', 8, 12, 1, 'none', now_str()]);
$sidR = (int)db()->lastInsertId();
q("INSERT INTO series (owner_id,title,tag,rule_type,p_day,shift,created_at) VALUES (?,?,?,?,?,?,?)", [$lvO['id'], '1日の業務', '定例業務', 'day', 15, 'none', now_str()]);
$sidD = (int)db()->lastInsertId();
$cal0 = BizCalendar::fromDb(); materialize_series($sidR, $cal0, 12); materialize_series($sidD, $cal0, 12);
$occ = function (int $sid, string $ym) { $r = row('SELECT start_date, end_date FROM events WHERE series_id = ? AND ym = ?', [$sid, $ym]); return $r ? [$r['start_date'], $r['end_date']] : null; };
check('休み優先: 休みが無ければ、ルールどおり（6/8〜6/11・6/15）', [$occ($sidR, '2027-06'), $occ($sidD, '2027-06')], [['2027-06-08', '2027-06-11'], ['2027-06-15', '2027-06-15']]);
$lv1 = $mk($lvO, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2027-06-11', 'end' => '2027-06-11']);
check('休み優先: 期間の末尾が休みなら、その日を外す（6/8〜6/10）', $occ($sidR, '2027-06'), ['2027-06-08', '2027-06-10']);
$lv2 = $mk($lvO, ['kind' => 'off', 'title' => '', 'tag' => '調整休', 'start' => '2027-06-08', 'end' => '2027-06-08']);
check('休み優先: 先頭も休みなら、先頭も外す（6/9〜6/10）', $occ($sidR, '2027-06'), ['2027-06-09', '2027-06-10']);
$lv3 = $mk($lvO, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2027-06-09', 'end' => '2027-06-10']);
check('休み優先: 期間の全部が休みなら、その月は作らない', $occ($sidR, '2027-06'), null);
$lvMid = $mk($lvO, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2027-06-15', 'end' => '2027-06-15']);
check('休み優先: 1日の業務が休みの日に当たったら、直前の営業日（6/14）に移す', $occ($sidD, '2027-06'), ['2027-06-14', '2027-06-14']);
$lvMid2 = $mk($lvO, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2027-06-12', 'end' => '2027-06-14']);
check('休み優先: 直前も休みなら、休みでない前の営業日まで戻る（6/8〜6/15 が休み → 6/7）', $occ($sidD, '2027-06'), ['2027-06-07', '2027-06-07']);
delete_event(row('SELECT * FROM events WHERE id = ?', [$lv1['id']])); delete_event(row('SELECT * FROM events WHERE id = ?', [$lv2['id']])); delete_event(row('SELECT * FROM events WHERE id = ?', [$lv3['id']]));
check('休み優先: 休みを消すと、元の日付に戻る（期間）', $occ($sidR, '2027-06'), ['2027-06-08', '2027-06-11']);
delete_event(row('SELECT * FROM events WHERE id = ?', [$lvMid['id']]));
delete_event(row('SELECT * FROM events WHERE id = ?', [$lvMid2['id']]));
check('休み優先: 休みを削除（delete_event）すると、1日の業務も元の日（6/15）に戻る', $occ($sidD, '2027-06'), ['2027-06-15', '2027-06-15']);
$half = $mk($lvO, ['kind' => 'off', 'title' => '', 'tag' => '午前半休', 'start' => '2027-06-15', 'end' => '2027-06-15']);
check('休み優先: 半休の日は、その日も働くので、動かさない', $occ($sidD, '2027-06'), ['2027-06-15', '2027-06-15']);
$other = $mk($b, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2027-06-15', 'end' => '2027-06-15']);
check('休み優先: 他の人の休みは、関係ない', $occ($sidD, '2027-06'), ['2027-06-15', '2027-06-15']);
$mv = $mk($lvO, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2027-06-22', 'end' => '2027-06-22']);
move_event($mv, '2027-06-15');
check('休み優先: 休みをドラッグで動かしても、反映される（6/15 に移した → 6/14）', $occ($sidD, '2027-06'), ['2027-06-14', '2027-06-14']);
q("DELETE FROM events WHERE owner_id IN (?, ?) AND kind = 'off' AND start_date >= '2027-06-01' AND start_date <= '2027-06-30'", [$lvO['id'], $b['id']]);
q('DELETE FROM events WHERE series_id IN (?, ?)', [$sidR, $sidD]); q('DELETE FROM series WHERE id IN (?, ?)', [$sidR, $sidD]);

// ---- 個人の色の設定 ----
check('色の設定: 初期は、すべて標準の色（空）', get_prefs($a)['colors'], ['work' => '', 'rec' => '', 'off' => '', 'private' => '']);
save_color_prefs($a, ['work' => '#2155D6', 'rec' => '#9a4a00', 'off' => 'red', 'private' => '#12345', 'evil' => '#000000']);
check('色の設定: #rrggbb だけが保存され（小文字にそろう）、不正な値・知らない項目は捨てる', get_prefs($a)['colors'], ['work' => '#2155d6', 'rec' => '#9a4a00', 'off' => '', 'private' => '']);
check('色の設定: 他の人の設定には影響しない', get_prefs($b)['colors'], ['work' => '', 'rec' => '', 'off' => '', 'private' => '']);
save_color_prefs($a, []);
save_color_prefs($a, ['work' => '#c0392b', 'off' => '#2b8a3e']);
$colEv = $mk($a, ['kind' => 'work', 'title' => '色テスト', 'tag' => '定例業務', 'start' => '2027-07-05', 'end' => '2027-07-05']);
$colOwn = function (array $viewer) { foreach (list_events($viewer, '2027-07-01', '2027-07-31', 'team') as $e) { if ($e['title'] === '色テスト') return (array)$e['colors']; } return null; };
check('色の設定: 持ち主の色が、予定と一緒に、他の人（鈴木・管理者）の画面にも届く', [$colOwn($b), $colOwn($admin)], [['work' => '#c0392b', 'off' => '#2b8a3e'], ['work' => '#c0392b', 'off' => '#2b8a3e']]);
check('色の設定: 色を決めていない人の予定は、標準（空）', (function () use ($mk, $b) { $x = $mk($b, ['kind' => 'work', 'title' => '色なしの人', 'tag' => '定例業務', 'start' => '2027-07-06', 'end' => '2027-07-06']); foreach (list_events($b, '2027-07-01', '2027-07-31', 'team') as $e) { if ($e['title'] === '色なしの人') return (array)$e['colors']; } return null; })(), []);
check('色の設定: 共有リンク（会社用）にも、持ち主の色が付く', (function () use ($admin) { $l = share_link_find(share_link_create('company', $admin)['token']); foreach (share_events($l, '2027-07-01', '2027-07-31') as $e) { if ($e['title'] === '色テスト') return (array)$e['colors']; } return null; })(), ['work' => '#c0392b', 'off' => '#2b8a3e']);
q("DELETE FROM events WHERE start_date >= '2027-07-01' AND start_date <= '2027-07-31'");
save_color_prefs($a, []);
check('色の設定: 空で保存すると、標準の色に戻る', get_prefs($a)['colors'], ['work' => '', 'rec' => '', 'off' => '', 'private' => '']);

// ---- Slack通知の設定とテスト ----
check('Slack: 画面から登録できるのは、Slack の Webhook URL だけ', array_map('slack_valid_webhook', ['https://hooks.slack.com/services/T0123ABC/B0123ABC/abcdEFGH1234abcdEFGH1234', 'http://hooks.slack.com/services/T0/B0/x', 'https://evil.example.com/services/T0/B0/x', 'https://hooks.slack.com/services/T0/B0', 'https://hooks.slack.com/services/T0/B0/x/../../y', '']), [true, false, false, false, false, false]);
$U1 = 'https://hooks.slack.com/services/T0123ABC/B0123ABC/abcdEFGH1234abcdEFGH1234';
$U2 = 'https://hooks.slack.com/services/T0123ABC/B0456DEF/zyxwVUTS9876zyxwVUTS9876';
$wasUrl = slack_webhook_url();
check('Slack: 最初は、画面での登録なし', [slack_dests(), slack_status()['source']], [[], $wasUrl !== '' ? 'config' : 'none']);
$d1 = slack_dest_add('#休み連絡', $U1);
check('Slack: 最初の1件は、そのまま使う送り先になる', [slack_webhook_url(), slack_active_id() === $d1['id'], slack_enabled(), slack_status()['source'], slack_status()['active_name']], [$U1, true, true, 'ui', '#休み連絡']);
$d2 = slack_dest_add('#全体連絡', $U2);
check('Slack: 2件目を足しても、使う送り先は変わらない。一覧は名前で分かる', [slack_webhook_url(), array_column(slack_status()['dests'], 'name')], [$U1, array_merge($wasUrl !== '' ? ['config.php の設定'] : [], ['#休み連絡', '#全体連絡'])]);
slack_dest_use($d2['id']);
check('Slack: プルダウンで選んだ送り先に切り替わる', [slack_webhook_url(), slack_status()['active_name']], [$U2, '#全体連絡']);
$st = slack_status();
check('Slack: 状態には URL そのものを含めない（伏せた形だけ）', [strpos(json_encode($st), 'abcdEFGH1234abcdEFGH1234') === false, strpos(json_encode($st), 'zyxwVUTS9876zyxwVUTS9876') === false, $st['masked']], [true, true, 'https://hooks.slack.com/…9876']);
$bad = [];
foreach ([['', $U1], ['x', 'https://evil.example.com/services/T0/B0/x'], ['#全体連絡', 'https://hooks.slack.com/services/T9/B9/zzzz'], ['#別名', $U1], [str_repeat('あ', 31), 'https://hooks.slack.com/services/T9/B9/zzzz']] as $c) {
    try { slack_dest_add($c[0], $c[1]); $bad[] = 'ok'; } catch (RuntimeException $e) { $bad[] = 'ng'; }
}
check('Slack: 名前なし・Slack以外のURL・同じ名前・同じURL・長すぎる名前は、登録できない', $bad, ['ng', 'ng', 'ng', 'ng', 'ng']);
$n = 0; try { slack_dest_use('nothing'); } catch (RuntimeException $e) { $n = 1; }
check('Slack: 登録にない送り先は選べない', $n, 1);
slack_dest_delete($d2['id']);
check('Slack: 使用中の送り先を消すと、残りの先頭に切り替わる', [slack_webhook_url(), count(slack_dests())], [$U1, 1]);
slack_dest_delete($d1['id']);
check('Slack: 全部消すと、config.php の設定に戻る', [slack_webhook_url(), slack_status()['source']], [$wasUrl, $wasUrl !== '' ? 'config' : 'none']);
slack_meta_set('slack_webhook', $U1); // 古い版（1件だけ登録）のデータ
check('Slack: 古い版で登録した1件は、「登録済みの送り先」として引き継がれる', [slack_webhook_url(), array_column(slack_dests(), 'name')], [$U1, ['登録済みの送り先']]);
$d3 = slack_dest_add('#新しい', $U2);
check('Slack: 引き継いだ後に追加しても、古い登録は消えない（一覧に取り込まれる）', [array_column(slack_dests(), 'name'), slack_meta_get('slack_webhook'), slack_webhook_url()], [['登録済みの送り先', '#新しい'], '', $U1]);
slack_dest_delete($d3['id']); slack_dest_delete('old');
check('Slack: 引き継いだ1件も消せる', [slack_dests(), slack_webhook_url()], [[], $wasUrl]);
check('Slack: 送り先が無いとき、テスト送信は失敗として詳細を返す', (function () { $r = slack_post_detailed('x'); return [$r['ok'], $r['error'] !== '']; })(), slack_enabled() ? [false, true] : [false, true]);
check('Slack: テスト文面（接続確認）にアプリ名・送信者が入る', (function () use ($a) { $m = slack_test_message('simple', $a); return strpos($m, 'テスト') !== false && strpos($m, $a['name']) !== false; })(), true);
check('Slack: テスト文面（見本）は、実際の通知と同じ形。名前だけで、メンションは付かない', (function () use ($a) { $m = slack_test_message('morning', array_merge($a, ['slack_id' => 'U01ABCDEF23'])); return [strpos($m, '【本日のお休み】') !== false, strpos($m, '• ' . $a['name']) !== false, strpos($m, '<@') === false, strpos($m, 'テスト') !== false]; })(), [true, true, true, true]);

$tok = static function (): string { $l = row("SELECT token FROM share_links WHERE kind = 'company' AND owner_id = 0"); return $l ? $l['token'] : ''; };
q("DELETE FROM share_links WHERE kind = 'company'");
check('Slack: 会社用リンクが無いときは、ログイン後に業務版が開く入口', [slack_open_url(), slack_link_kind()], ['https://example.test/public/index.php?view=team', 'login']);
$lk = share_link_create('company', array_merge($a, ['role' => 'admin']));
check('Slack: 会社用リンクがあれば、通知のリンクはそれ（ログイン不要の業務版）', [slack_open_url(), slack_link_kind(), strpos(slack_link_text(), '<https://example.test/public/share.php?t=' . $lk['token'] . '|スケジュールを開く>') !== false], ['https://example.test/public/share.php?t=' . $lk['token'], 'company', true]);
$old = $lk['token'];
$lk = share_link_create('company', array_merge($a, ['role' => 'admin']));
check('Slack: 会社用リンクを作り直すと、通知のリンクも新しいものになる', [slack_open_url() === 'https://example.test/public/share.php?t=' . $lk['token'], $old !== $lk['token']], [true, true]);
share_link_revoke('company', array_merge($a, ['role' => 'admin']));
check('Slack: 会社用リンクを止めると、入口に戻る', slack_link_kind(), 'login');
check('Slack: 見本の通知にも、同じリンクが付く', strpos(slack_test_message('evening', $a), 'view=team|スケジュールを開く>') !== false, true);

// ---- Slack: 通知の時間・文面 ----
$dflt = slack_cfg_defaults();
$e1 = ['start_date' => '2031-03-12', 'end_date' => '2031-03-12', 'tag' => '有給'];
check('Slack文面: 初期値は、名前だけ（分類・期間・@メンションは出ない）', off_line($e1, '山田 花子'), '• 山田 花子');
check('Slack文面: 初期値の朝・夕方の文面。{リンク}が空の行は消える', [slack_day_text('morning', '2031-03-12', ['• X'], $dflt), slack_day_text('evening', '2031-03-12', ['• X'], $dflt)], ["【本日のお休み】3/12（水）
• X
" . slack_link_text(), "【明日のお休み】3/12（水）
• X
" . slack_link_text()]);
$c = $dflt; $c['line'] = '{名前}さん（{分類}）'; $c['morning']['tpl'] = "おはようございます！{日付}は{人数}名がお休みです。\n\n{休み一覧}";
check('Slack文面: 好きな文面・1人分の表示・差し込みが使える（空行は残る）', slack_day_text('morning', '2031-03-12', [off_line($e1, '山田', $c), off_line($e1, '鈴木', $c)], $c), "おはようございます！3/12（水）は2名がお休みです。\n\n山田さん（有給）\n鈴木さん（有給）");
$bad = [];
foreach ([['morning', ['tpl' => '休みなし']], ['morning', ['tpl' => "{休み一覧} {なまえ}"]], ['morning', ['tpl' => '']], ['morning', ['tpl' => str_repeat('あ', 251) . '{休み一覧}']], ['morning', ['tpl' => '{休み一覧}', 'time' => '25:00']], ['line', 'abc']] as [$k, $v]) {
    $in = $dflt; $in[$k] = is_array($v) ? array_merge($in[$k], $v) : $v;
    try { slack_cfg_clean($in); $bad[] = 'ok'; } catch (RuntimeException $x) { $bad[] = 'ng'; }
}
check('Slack文面: {休み一覧}が無い・使えない差し込み・空・長すぎ・おかしい時刻・名前が無い1人分は、保存できない', $bad, ['ng', 'ng', 'ng', 'ng', 'ng', 'ng']);
$in = $dflt; $in['morning']['time'] = '9:05'; $in['evening']['on'] = false;
$saved = slack_cfg_save($in);
check('Slack文面: 保存した設定が使われる（時刻は 09:05 にそろう）', [$saved['morning']['time'], slack_cfg()['evening']['on']], ['09:05', false]);
q("DELETE FROM events WHERE kind = 'off' AND start_date = '2031-03-12'");
$mk($a, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2031-03-12', 'end' => '2031-03-12']);
$t = function ($hm) { return strtotime("2031-03-12 $hm:00"); };
$nr = function () { q("DELETE FROM notification_log WHERE ref LIKE 'today:2031%' OR ref LIKE 'tomorrow:2031%'"); };
$nr(); $r0 = notify_due($t('09:04')); $nr(); $r1 = notify_due($t('09:10')); $r2 = notify_due($t('09:20')); $nr(); $r3 = notify_due($t('12:30'));
check('Slack時間: 設定した時刻の前は送らない／過ぎたら送る／同じ日に2回は送らない／3時間以上過ぎたら送らない', [count($r0), count($r1), count($r2), count($r3)], [0, 1, 0, 0]);
$in = $saved; $in['morning']['on'] = false; slack_cfg_save($in); $nr();
check('Slack時間: 画面で止めた通知は、送らない（従来の cron.php morning でも）', [count(notify_due($t('09:10'))), notify_offs_for_day('2031-03-12', '本日')], [0, 0]);
$in = $saved; $in['morning']['on'] = true; $in['evening']['on'] = true; $in['evening']['time'] = '17:00'; slack_cfg_save($in); $nr();
$mk($a, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2031-03-13', 'end' => '2031-03-13']);
check('Slack時間: 夕方の通知は、翌営業日の休みを送る', array_map(function ($x) { return strpos($x, '明日の休み') === 0; }, notify_due($t('17:05'))), [true]);
$sat = strtotime('2031-03-15 09:10:00'); // 土曜日
$mk($a, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2031-03-15', 'end' => '2031-03-15']); $nr();
check('Slack時間: 土日・休業日は送らない', count(notify_due($sat)), 0);
// 休みの人がいない営業日にも、「休みなし」と通知する
q("DELETE FROM events WHERE kind = 'off' AND start_date BETWEEN '2031-03-12' AND '2031-03-15'");
$in = slack_cfg_defaults(); $in['morning']['time'] = '08:30'; $in['evening']['time'] = '17:00'; slack_cfg_save($in); $nr();
$sentF = null; $sentN = notify_offs_for_day('2031-03-12', '本日', $sentF);
check('休みなし: 営業日で休みの人がいなければ、「休みなし」と通知する（0件・送った扱い）', [$sentN, $sentF], [0, true]);
$sentN2 = notify_offs_for_day('2031-03-12', '本日', $sentF2);
check('休みなし: 同じ日に2回は送らない', [$sentN2, $sentF2], [0, false]);
check('休みなし: 文面は「休みなし」が休み一覧の代わりに入る（人数は0）', [slack_day_text('morning', '2031-03-12', [], slack_cfg_defaults()), slack_day_text('evening', '2031-03-12', [], slack_cfg_defaults())], ["【本日のお休み】3/12（水）\n休みなし\n" . slack_link_text(), "【明日のお休み】3/12（水）\n休みなし\n" . slack_link_text()]);
$nr(); $m1 = notify_due($t('08:40'));
check('休みなし: 朝の通知の時刻を過ぎたら、休みなしと通知する', array_map(function ($x) { return strpos($x, '休みなし') !== false; }, $m1), [true]);
check('休みなし: 土日・休業日は、休みなしでも送らない', [count(notify_due($sat)), count(notify_due(strtotime('2031-03-16 09:00:00')))], [0, 0]);
$in['empty'] = ['on' => false, 'text' => '休みなし']; slack_cfg_save($in); $nr();
check('休みなし: 画面でオフにすれば、休みの人がいない日は送らない', [count(notify_due($t('08:40'))), notify_offs_for_day('2031-03-12', '本日')], [0, 0]);
$in['empty'] = ['on' => true, 'text' => '本日は全員出勤です']; slack_cfg_save($in);
check('休みなし: 表示する文言を変えられる', strpos(slack_day_text('morning', '2031-03-12', []), '本日は全員出勤です') !== false, true);
$badE = []; foreach (['', str_repeat('あ', 51)] as $txt) { $x = slack_cfg_defaults(); $x['empty']['text'] = $txt; try { slack_cfg_clean($x); $badE[] = 'ok'; } catch (RuntimeException $e) { $badE[] = 'ng'; } }
check('休みなし: 文言が空・長すぎは、保存できない', $badE, ['ng', 'ng']);
slack_meta_set('slack_cfg', '');
$pv = slack_preview(slack_cfg_clean($dflt));
check('Slack文面: プレビューは、保存前の入力のまま作れる', [strpos($pv['morning'], '山田 花子') !== false, strpos($pv['morning'], '鈴木 一郎') !== false, strpos($pv['evening'], '明日のお休み') !== false], [true, true, true]);
slack_meta_set('slack_cfg', '');
slack_meta_set('slack_cfg', json_encode(['line' => '• {名前}　{分類}　{期間}', 'mention' => true, 'reg' => ['on' => true, 'tpl' => 'x{休み一覧}']], JSON_UNESCAPED_UNICODE));
check('Slack文面: 以前の初期値（名前・分類・期間）のまま保存されていた設定は、名前だけに変わり、昔の項目（登録通知・メンション）は無視される', [slack_cfg()['line'], isset(slack_cfg()['reg']), isset(slack_cfg()['mention'])], ['• {名前}', false, false]);
check('Slack文面: 設定を消すと、初期値に戻る', slack_cfg(), slack_cfg_defaults());
slack_meta_set('slack_cfg', '{壊れたJSON');
check('Slack文面: 設定が壊れていても、初期値で動く', slack_cfg(), slack_cfg_defaults());
slack_meta_set('slack_cfg', '');
q("DELETE FROM events WHERE kind = 'off' AND start_date BETWEEN '2031-03-12' AND '2031-03-15'");

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
// 削除された予定は、家族用に取消線で残る（家族が確認して消すまで）
$gone = $mk($a, ['kind' => 'private', 'title' => '消す予定', 'start' => $sd, 'start_time' => '10:00', 'end_time' => '11:00']);
$goneId = (int)$gone['id'];
delete_event(row('SELECT * FROM events WHERE id = ?', [$goneId]));
$tomb = array_values(array_filter(share_events($fam, $sd, $sd), function ($e) { return !empty($e['deleted']); }));
check('削除した予定: 家族用に、取消線つき（deleted）で残る。件名・日付・時刻が分かる', [count($tomb), $tomb[0]['title'], $tomb[0]['start'], $tomb[0]['start_time'], $tomb[0]['id'] < 0, $tomb[0]['editable'], $tomb[0]['note']], [1, '消す予定', $sd, '10:00', true, false, '']);
check('削除した予定: 期間の外には出ない', array_filter(share_events($fam, date('Y-m-d', strtotime($sd . ' +10 day')), date('Y-m-d', strtotime($sd . ' +12 day'))), function ($e) { return !empty($e['deleted']); }), []);
check('削除した予定: 本人以外の家族用・会社用には出ない', [count(array_filter(share_events(share_link_find(share_link_create('family', $b)['token']), $sd, $sd), function ($e) { return !empty($e['deleted']); })), count(array_filter(share_events(share_link_find(share_link_create('company', $admin)['token']), $sd, $sd), function ($e) { return !empty($e['deleted']); }))], [0, 0]);
q('UPDATE users SET family_share_off = 1 WHERE id = ?', [$a['id']]);
$lvGone2 = $mk($a, ['kind' => 'off', 'title' => '通院', 'tag' => '有給', 'start' => $sd, 'end' => $sd]);
delete_event(row('SELECT * FROM events WHERE id = ?', [$lvGone2['id']]));
$tl = array_values(array_filter(share_events($fam, $sd, $sd), function ($e) { return !empty($e['deleted']) && $e['kind'] === 'off'; }));
check('削除した休み: 取消線で残るが、件名・種類は出ない（「休み」とだけ）', [count($tl), $tl[0]['title'], $tl[0]['tag']], [1, '休み', '']);
q('UPDATE users SET family_share_off = 0 WHERE id = ?', [$a['id']]);
$un = $mk($a, ['kind' => 'work', 'title' => '非共有の業務', 'tag' => '打ち合わせ', 'start' => $sd, 'end' => $sd]);
delete_event(row('SELECT * FROM events WHERE id = ?', [$un['id']]));
check('削除した予定: 家族に見えていなかった予定は、残らない（件名が漏れない）', in_array('非共有の業務', array_column(share_events($fam, $sd, $sd), 'title'), true), false);
q('UPDATE event_log SET changed_at = ? WHERE event_id = ? AND action = ?', [date('Y-m-d H:i:s', time() - (TOMBSTONE_KEEP_DAYS + 1) * 86400), $goneId, 'delete']);
check('削除した予定: ' . TOMBSTONE_KEEP_DAYS . '日たつと、確認しなくても消える', in_array('消す予定', array_column(share_events($fam, $sd, $sd), 'title'), true), false);
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
$fo2 = $mk($a, ['kind' => 'off', 'title' => '家族旅行', 'tag' => '欠勤', 'start' => $fd, 'family_shared' => 1]);
$famOff = array_values(array_filter(share_events($famL, $fd, $fd), function ($e) { return $e['kind'] === 'off'; }));
check('家族用: 休みは、種類（有給・欠勤）も件名も出さず、単に「休み」', [$famOff[0]['title'], $famOff[0]['tag']], ['休み', '']);
$compOff = array_values(array_filter(share_events(share_link_find(share_link_create('company', $admin)['token']), $fd, $fd), function ($e) { return $e['kind'] === 'off' && $e['owner_id'] === (int)$GLOBALS['a']['id']; }));
check('会社用: 休みは、今までどおり分類つき（有給・欠勤）', array_column($compOff, 'tag') === ['有給', '欠勤'] || array_column($compOff, 'tag') === ['欠勤', '有給'], true);
q('DELETE FROM events WHERE id = ?', [$fo2['id']]);
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

// ---- 画面の自動更新（更新番号） ----
$rv0 = data_rev();
check('更新番号: 読み取りだけでは増えない', [list_events($a, '2026-01-01', '2026-01-31', 'team'), data_rev()][1], $rv0);
$rvEv = $mk($a, ['kind' => 'work', 'title' => '更新番号の確認', 'tag' => 'その他', 'start' => date('Y-m-d', strtotime('+200 day'))]);
$rv1 = data_rev();
check('更新番号: 予定を登録すると増える', $rv1 > $rv0, true);
move_event($rvEv, date('Y-m-d', strtotime('+201 day'))); $rv2 = data_rev();
check('更新番号: 予定を動かすと増える', $rv2 > $rv1, true);
[$rvEd] = validate_event_input(['kind' => 'work', 'title' => '更新番号の確認(編集)', 'tag' => 'その他', 'start' => date('Y-m-d', strtotime('+201 day'))], $a); save_event($rvEd, $a, row('SELECT * FROM events WHERE id = ?', [$rvEv['id']])); $rv3 = data_rev();
check('更新番号: 予定を編集すると増える', $rv3 > $rv2, true);
delete_event(row('SELECT * FROM events WHERE id = ?', [$rvEv['id']])); $rv4 = data_rev();
check('更新番号: 予定を削除すると増える', $rv4 > $rv3, true);
[$rvT] = validate_todo_input(['kind' => 'work', 'title' => '更新番号ToDo']); $rvTd = save_todo($rvT, $a, null); $rv5 = data_rev();
check('更新番号: ToDoを追加すると増える', $rv5 > $rv4, true);
set_todo_done($rvTd, true); $rv6 = data_rev();
check('更新番号: ToDoを完了にすると増える', $rv6 > $rv5, true);
q('DELETE FROM todos WHERE id = ?', [$rvTd['id']]); $rv7 = data_rev();
check('更新番号: ToDoを削除すると増える', $rv7 > $rv6, true);
q("INSERT INTO company_holidays (hdate, name) VALUES ('2030-01-02', '更新番号の確認')"); $rv8 = data_rev();
check('更新番号: 会社の休業日を足すと増える', $rv8 > $rv7, true);
q("DELETE FROM company_holidays WHERE hdate = '2030-01-02'");
$rv9 = data_rev(); save_memo('<div>メモは画面の予定に関係しない</div>', $a);
check('更新番号: メモの保存では増えない（自分のメモを書くたびに、他の人の画面を更新させない）', data_rev(), $rv9);
$rv10 = data_rev(); share_link_create('family', $a);
check('更新番号: 共有リンクの作成では増えない', data_rev(), $rv10);
q("INSERT INTO series (owner_id,title,tag,rule_type,p_day,shift,created_at) VALUES (?,?,?,?,?,?,?)", [$a['id'], '更新番号ルール', '定例業務', 'day', 3, 'none', now_str()]);
$rvS = (int)db()->lastInsertId(); $rv11 = data_rev(); materialize_series($rvS); $rv12 = data_rev();
check('更新番号: 繰り返しの予定の自動作成でも増える（cronで作られた予定を、開いている画面に反映する）', $rv12 > $rv11, true);
$rv13 = data_rev(); materialize_series($rvS);
check('更新番号: 変更のない再実行（毎晩のcron）では増えない', data_rev(), $rv13);
delete_series($rvS);
flush_rev();
check('更新番号: 古い版（app_metaに番号が無い）でも動く', (function () { q("DELETE FROM app_meta WHERE meta_key = 'rev'"); $z = data_rev(); bump_rev(); return [$z, data_rev()]; })(), [0, 1]);
check('更新番号: 1回のリクエストで書き込みが何件あっても、番号は1だけ進む', (function () use ($a) { flush_rev(); $r0 = data_rev(); for ($i = 0; $i < 5; $i++) { q('UPDATE users SET name = name WHERE id = ?', [$a['id']]); } return data_rev() - $r0; })(), 1);
check('更新番号: 書き込み(INSERT)のあとでも lastInsertId が正しい（MySQLで0に戻らない）', (function () use ($a) { q('INSERT INTO todos (owner_id, title, kind, tag, note, family_shared, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?)', [$a['id'], 'ID確認', 'work', '', '', 0, 999, now_str()]); $id = (int)db()->lastInsertId(); $ok = (bool)row('SELECT id FROM todos WHERE id = ?', [$id]); q('DELETE FROM todos WHERE id = ?', [$id]); return $ok; })(), true);

check('自動更新の間隔: 既定は20秒', poll_ms(), 20000);
check('自動更新の間隔の範囲（0=なし、5〜600秒）', (function () use ($tmp) { $o = []; foreach ([0, 1, 30, 9999] as $v) { file_put_contents($tmp . '/poll.php', "<?php return ['db' => ['dsn' => 'sqlite::memory:'], 'poll_seconds' => $v];"); $o[] = (int)trim((string)shell_exec('SCHEDULE_CONFIG=' . escapeshellarg($tmp . '/poll.php') . ' ' . escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg('require ' . var_export(__DIR__ . '/../src/bootstrap.php', true) . '; echo poll_ms();'))); } return $o; })(), [0, 5000, 30000, 600000]);

// ---- 予定の種類を、あとから変える ----
$kd = date('Y-m-d', strtotime('+250 day'));
$ke = $mk($a, ['kind' => 'work', 'title' => '種類を変える予定', 'tag' => '打ち合わせ', 'start' => $kd, 'note' => 'メモ', 'start_time' => '10:00']);
$chg = function (array $ev, array $user, string $kind, array $extra = []) {
    [$d, $err] = validate_event_input(array_merge(['kind' => $kind, 'title' => $ev['title'], 'tag' => $extra['tag'] ?? '', 'start' => $ev['start_date'], 'end' => $ev['end_date'], 'start_time' => $ev['start_time'], 'end_time' => $ev['end_time'], 'note' => $ev['note']], $extra), $user);
    if ($err) { throw new RuntimeException($err); }
    return save_event($d, $user, row('SELECT * FROM events WHERE id = ?', [$ev['id']]));
};
$k1 = $chg($ke, $a, 'off', ['tag' => '有給']);
check('種類変更: 業務→休み（分類は休みの分類になり、時刻・メモ・日付は保たれる）', [$k1['kind'], $k1['tag'], $k1['start_time'], $k1['note'], $k1['start_date'], (int)$k1['owner_id']], ['off', '有給', '10:00', 'メモ', $kd, (int)$a['id']]);
check('種類変更: 休みになった予定は、他の人にも休みとして見える', in_array('種類を変える予定', array_column(list_events($b, $kd, $kd, 'team'), 'title'), true) && array_column(list_events($b, $kd, $kd, 'team'), 'kind', 'title')['種類を変える予定'] === 'off', true);
$k2 = $chg($k1, $a, 'private', ['family_shared' => 1]);
check('種類変更: 休み→プライベート（分類は空になる）', [$k2['kind'], $k2['tag']], ['private', '']);
check('種類変更: プライベートにすると、他の人・管理者には見えなくなる', [in_array('種類を変える予定', array_column(list_events($b, $kd, $kd, 'team'), 'title'), true), in_array('種類を変える予定', array_column(list_events($admin, $kd, $kd, 'team'), 'title'), true), find_event((int)$k2['id'], $admin)], [false, false, null]);
check('種類変更: プライベートにした予定は、本人には見える', in_array('種類を変える予定', array_column(list_events($a, $kd, $kd, 'me', ['tags' => cfg('work_tags'), 'showOff' => true]), 'title'), true), true);
$k3 = $chg($k2, $a, 'work', ['tag' => '全体会議', 'family_shared' => 0]);
check('種類変更: プライベート→業務（分類を選べる・家族への共有は共有しない）', [$k3['kind'], $k3['tag'], (int)$k3['family_shared']], ['work', '全体会議', 0]);
check('種類変更: 業務になった予定は、全員に見える', in_array('種類を変える予定', array_column(list_events($b, $kd, $kd, 'team'), 'title'), true), true);
check('種類変更: 不正な分類は、その種類の既定に直る', $chg($k3, $a, 'off', ['tag' => '全体会議'])['tag'], '有給');
// 繰り返しの1回分の種類を変えると、個別の予定になる
q("INSERT INTO series (owner_id,title,tag,rule_type,p_day,shift,created_at) VALUES (?,?,?,?,?,?,?)", [$a['id'], '種類変更の繰り返し', '定例業務', 'day', 5, 'none', now_str()]);
$sidK = (int)db()->lastInsertId(); materialize_series($sidK);
$recK = row('SELECT * FROM events WHERE series_id = ? ORDER BY start_date LIMIT 1', [$sidK]);
$recK2 = $chg($recK, $a, 'off', ['tag' => '有給']);
check('種類変更: 繰り返しの1回分を変えると、個別扱い(detached)になる', [$recK2['kind'], (int)$recK2['detached']], ['off', 1]);
q('UPDATE series SET title = ? WHERE id = ?', ['種類変更の繰り返し(名前変更)', $sidK]); materialize_series($sidK);
check('種類変更: ルールを変えても、種類を変えた回は上書きされない', row('SELECT kind, title FROM events WHERE id = ?', [$recK['id']]), ['kind' => 'off', 'title' => '種類変更の繰り返し']);
delete_series($sidK);

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
$um = umask(0); // 新しいファイルが666になってしまうサーバーを想定
$r = updater_apply($zipOk, "$U/web", "$U/app");
umask($um);
check('更新: 作られるファイルの権限は644（誰でも書ける666にならない）', [substr(sprintf('%o', fileperms("$U/web/assets/app.js")), -3), substr(sprintf('%o', fileperms("$U/app/src/a.php")), -3)], ['644', '644']);
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
