<?php
// 使い方: php tests/run.php   （SQLite の一時DBを使うので、本番DBには触れません）
$tmp = sys_get_temp_dir() . '/sched_test_' . getmypid() . '_' . bin2hex(random_bytes(3)); // 前の実行の残りと、混ざらないように
mkdir($tmp);
// 既定は SQLite。MySQL/MariaDB で試す場合: SCHEDULE_TEST_DSN='mysql:host=localhost;dbname=xxx;charset=utf8mb4' SCHEDULE_TEST_USER=.. SCHEDULE_TEST_PASS=.. php tests/run.php
$dsn = getenv('SCHEDULE_TEST_DSN') ?: "sqlite:$tmp/t.sqlite";
$dbCfg = var_export(['dsn' => $dsn, 'user' => getenv('SCHEDULE_TEST_USER') ?: null, 'pass' => getenv('SCHEDULE_TEST_PASS') ?: null], true);
file_put_contents($tmp . '/config.php', "<?php return ['db' => $dbCfg, 'slack_webhook' => '', 'base_url' => 'https://example.test/public/index.php'];");
putenv('SCHEDULE_CONFIG=' . $tmp . '/config.php');

require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/auth.php';
require_once __DIR__ . '/../src/events.php';
require_once __DIR__ . '/../src/slack.php';
require_once __DIR__ . '/../src/share.php';
require_once __DIR__ . '/../src/backup.php';
require_once __DIR__ . '/../src/usage.php';
require_once __DIR__ . '/../src/undo.php';
require_once __DIR__ . '/../src/ical.php';
require_once __DIR__ . '/../src/api.php';

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
// 他人が、わざと間違えて、本人を締め出せない（8回は、その接続元だけに効く）
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
for ($i = 0; $i < LOGIN_MAX_PER_EMAIL; $i++) { login_attempt('a@example.com', 'wrong' . $i); }
$lkAtk = null; login_attempt('a@example.com', 'password1', $lkAtk);
$_SERVER['REMOTE_ADDR'] = '198.51.100.7';
$lkMe = null; $okMe = login_attempt('a@example.com', 'password1', $lkMe);
check('ログイン制限: 攻撃者の接続元だけが止まり、本人は、別の接続元から入れる', [$lkAtk, $lkMe, $okMe !== null], [true, false, true]);
db()->exec('DELETE FROM login_fails');
for ($k = 0; $k < LOGIN_MAX_PER_EMAIL_ANY; $k++) { q('INSERT INTO login_fails (email, ip, failed_at) VALUES (?,?,?)', ['a@example.com', '192.0.2.' . ($k % 250), now_str()]); }
$lkAny = null; login_attempt('a@example.com', 'password1', $lkAny);
check('ログイン制限: 多数の接続元から攻撃されたときは、そのメールアドレスを止める', $lkAny, true);
db()->exec('DELETE FROM login_fails'); unset($_SERVER['REMOTE_ADDR']);
$_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.20, 10.0.0.1';
check('ログイン制限: X-Forwarded-For は、設定で許したときだけ使う（既定は使わない）', client_ip() === '' || client_ip() !== '198.51.100.20', true);
unset($_SERVER['HTTP_X_FORWARDED_FOR']);

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
$pv = function (array $u) use ($today, $titles) { return $titles(list_events($u, $today, $today, 'me')); };
check('プライベート版: 他人にはプライベートが見えない', in_array('歯医者', $pv($b), true), false);
check('プライベート版: 管理者にもプライベートは見えない', in_array('歯医者', $pv($admin), true), false);
check('プライベート版: 本人には見える（共有にしていない業務・休みは出ない）', $pv($a), ['歯医者']);
check('プライベート版: 他の社員の業務・休みは出ない', $pv($b), []);
q("UPDATE events SET family_shared = 1 WHERE title = 'A社 打ち合わせ'");
check('プライベート版: 「家族に共有」にした業務が重なる', $pv($a), ['A社 打ち合わせ', '歯医者']);
check('プライベート版: 共有にしても他の社員のプライベート版には出ない', $pv($b), []);
save_family_share($a, true, ['個人作業']);
check('プライベート版: 「まとめて共有」の休み・業務分類も重なる（家族用リンクと同じ）', $pv($a), ['A社 打ち合わせ', '休み', '歯医者', '資料作成']);
check('プライベート版: 家族用リンクに見える予定と一致する（プライベートは初期値が共有）', $pv($a), $titles(share_events(['kind' => 'family', 'owner_id' => $a['id']], $today, $today)));
save_family_share($a, false, []);
q("UPDATE events SET family_shared = 0 WHERE title = 'A社 打ち合わせ'");
check('プライベート版: 共有を外すと、また出ない', $pv($a), ['歯医者']);

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
check('削除した回は復活しない', (int)row('SELECT COUNT(*) AS c FROM events WHERE id = ? OR (series_id = ? AND ym = ?)', [$ev2['id'], $sid, $ev2['ym']])['c'], 0);

// ルール削除: 今日以降の未編集分が消え、編集済みは通常の予定として残る
delete_series($sid);
check('ルール削除後、未編集の将来分は消える', (int)row("SELECT COUNT(*) AS c FROM events WHERE title = '月次締め' AND end_date >= ?", [date('Y-m-d')])['c'], 0); // 今日より前の回は、ふつうの予定として残る（実行する日によって、あるかないかが変わる）
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
check('複製: 他の社員・管理者にはコピーも見えない', [in_array('秘密の予定', $titles(list_events($b, $t1, $t1, 'team')), true), in_array('秘密の予定', $titles(list_events($admin, $t1, $t1, 'me')), true)], [false, false]);
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
// ToDoの一覧は、業務版（業務だけ）・プライベート版（プライベートだけ）で分かれる。ここは、種類を問わず、並び順どおりに全部見る
$todosAll = function (array $u) { return todo_with_event_dates(todo_with_comment_stats(array_map('todo_for_client', rows('SELECT * FROM todos WHERE owner_id = ? AND done_at IS NULL ORDER BY sort_order, id', [$u['id']])))); };
check('ToDo: プライベート版には、プライベートのToDoだけが出る（業務のToDoは、業務版）', [array_column(list_todos($a, 'me'), 'title'), array_column($todosAll($a), 'title')], [['歯医者の予約'], ['見積書を作る', '歯医者の予約']]);
check('ToDo: 業務版にはプライベートのToDoを出さない', array_column(list_todos($a, 'team'), 'title'), ['見積書を作る']);
check('ToDo: 他の社員・管理者には見えない', [list_todos($b, 'me'), list_todos($admin, 'me')], [[], []]);
check('ToDo: 他人のToDoは取得できない', [find_todo((int)$todoA['id'], $b), find_todo((int)$todoA['id'], $admin)], [null, null]);
// 並べ替え
[$tdx] = validate_todo_input(['kind' => 'work', 'title' => '3つ目', 'tag' => 'その他']); $todoC = save_todo($tdx, $a, null);
check('ToDo: 追加した順に並ぶ', array_column($todosAll($a), 'title'), ['見積書を作る', '歯医者の予約', '3つ目']);
reorder_todos([(int)$todoC['id'], (int)$todoA['id'], (int)$todoP['id']], $a);
check('ToDo: 並べ替えが保存される', array_column($todosAll($a), 'title'), ['3つ目', '見積書を作る', '歯医者の予約']);
reorder_todos([(int)$todoA['id'], (int)$todoC['id']], $a); // 業務版のように、プライベートが見えていない並べ替え
check('ToDo: 見えていない項目の位置は動かさない', array_column($todosAll($a), 'title'), ['見積書を作る', '3つ目', '歯医者の予約']);
reorder_todos([(int)$todoA['id'], (int)$todoC['id']], $b); // 他人は動かせない
check('ToDo: 他人の並べ替えは効かない', array_column($todosAll($a), 'title'), ['見積書を作る', '3つ目', '歯医者の予約']);
q('DELETE FROM todos WHERE id = ?', [$todoC['id']]);
// 日付へドラッグ → カレンダーの予定になる（ToDoは消えず、自動で「進行中」になる）
$dd = date('Y-m-d', strtotime('+90 day'));
$ev = schedule_todo($todoA, $dd, $a);
check('ToDo→予定: 業務の予定として作られる', [$ev['kind'], $ev['title'], $ev['tag'], $ev['start_date'], $ev['end_date'], (int)$ev['owner_id']], ['work', '見積書を作る', '個人作業', $dd, $dd, (int)$a['id']]);
check('ToDo→予定: ToDoは残り、自動で進行中になる', todo_status_of(find_todo((int)$todoA['id'], $a)), 'doing');
check('ToDo→予定: 予定はToDoと結びつく', (int)row('SELECT todo_id FROM events WHERE id = ?', [$ev['id']])['todo_id'], (int)$todoA['id']);
check('ToDo→予定: リストのToDoに、置いた日が付く', array_column(array_filter($todosAll($a), function ($t) use ($todoA) { return $t['id'] === (int)$todoA['id']; }), 'sched'), [$dd]);
check('ToDo→予定: リストのToDoに、置いた予定の最終日も付く（日報の自動反映用）', array_column(array_filter($todosAll($a), function ($t) use ($todoA) { return $t['id'] === (int)$todoA['id']; }), 'sched_end'), [$dd]);
check('ToDo→予定: 全社員に見える', in_array('見積書を作る', $titles(list_events($b, $dd, $dd, 'team')), true), true);
check('ToDo→予定: 予定は、完了していないので取り消し線なし', array_column(array_filter(list_events($a, $dd, $dd, 'team'), function ($e) { return $e['title'] === '見積書を作る'; }), 'done'), [false]);
set_todo_status(find_todo((int)$todoA['id'], $a), 'done');
check('ToDo完了: カレンダーの予定が「完了」（取り消し線）になる', array_column(array_filter(list_events($b, $dd, $dd, 'team'), function ($e) { return $e['title'] === '見積書を作る'; }), 'done'), [true]);
check('ToDo完了: 家族用・会社用リンクにも「完了」が出る', [array_column(share_events(['kind' => 'company', 'owner_id' => 0], $dd, $dd), 'done')], [[true]]);
set_todo_status(find_todo((int)$todoA['id'], $a), 'doing');
check('ToDo完了を戻すと、取り消し線も外れる', array_column(array_filter(list_events($a, $dd, $dd, 'team'), function ($e) { return $e['title'] === '見積書を作る'; }), 'done'), [false]);
$dd2 = date('Y-m-d', strtotime('+91 day'));
$ev2 = schedule_todo(find_todo((int)$todoA['id'], $a), $dd2, $a);
check('ToDo→予定: もう一度置くと、予定は増えず、新しい日へ動く', [(int)$ev2['id'] === (int)$ev['id'], $ev2['start_date'], (int)row('SELECT COUNT(*) AS c FROM events WHERE todo_id = ?', [$todoA['id']])['c']], [true, $dd2, 1]);
$ev = $ev2;
$evP = schedule_todo($todoP, $dd, $a);
check('ToDo→予定: プライベートのToDoはプライベートの予定になり、他人に見えない', [$evP['kind'], in_array('歯医者の予約', $titles(list_events($b, $dd, $dd, 'team')), true)], ['private', false]);
// ToDoの種類を、業務 → プライベートに変えたら、置いた予定も、プライベートになる（他の人・共有リンクに、見えたままにならない）
$tkSrc = save_todo(['kind' => 'work', 'title' => '種類を変えるToDo', 'tag' => '打ち合わせ', 'note' => 'メモ', 'family_shared' => 0], $a, null);
$tkEv = schedule_todo($tkSrc, $dd, $a);
check('ToDo種類変更: 業務の間は、他の人に予定が見える', in_array('種類を変えるToDo', $titles(list_events($b, $dd, $dd, 'team')), true), true);
save_todo(['kind' => 'private', 'title' => '種類を変えるToDo', 'tag' => '', 'note' => 'メモ', 'family_shared' => 1], $a, find_todo((int)$tkSrc['id'], $a));
check('ToDo種類変更: プライベートにすると、置いた予定も、プライベートになり、他の人に見えない', [row('SELECT kind FROM events WHERE id = ?', [$tkEv['id']])['kind'], in_array('種類を変えるToDo', $titles(list_events($b, $dd, $dd, 'team')), true), in_array('種類を変えるToDo', array_column(share_events(['kind' => 'company', 'owner_id' => 0], $dd, $dd), 'title'), true)], ['private', false, false]);
save_todo(['kind' => 'work', 'title' => '種類を変えるToDo', 'tag' => '打ち合わせ', 'note' => 'メモ', 'family_shared' => 0], $a, find_todo((int)$tkSrc['id'], $a));
check('ToDo種類変更: 業務に戻すと、予定も業務に戻る（分類つき）', [row('SELECT kind FROM events WHERE id = ?', [$tkEv['id']])['kind'], row('SELECT tag FROM events WHERE id = ?', [$tkEv['id']])['tag']], ['work', '打ち合わせ']);
q('DELETE FROM events WHERE id = ?', [$tkEv['id']]); q('DELETE FROM todos WHERE id = ?', [$tkSrc['id']]);
// パスワードを変えたら、ほかの端末のログインは終わる
$pwOld = row('SELECT password_hash FROM users WHERE id = ?', [$a['id']])['password_hash'];
$_SESSION = []; login_attempt('a@example.com', 'password1');
check('セッション: ログインした端末は、使える', (int)((current_user() ?: [])['id'] ?? 0), (int)$a['id']);
q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash('newpass-xyz-1', PASSWORD_DEFAULT), $a['id']]);
check('セッション: パスワードが変わると、前のログインは使えない', current_user(), null);
q('UPDATE users SET password_hash = ? WHERE id = ?', [$pwOld, $a['id']]);
$_SESSION = ['uid' => (int)$a['id']]; // この版より前のログイン（印が無い）は、そのまま使える
check('セッション: 印のない古いログインは、そのまま使えて、印が付く', [(int)((current_user() ?: [])['id'] ?? 0), isset($_SESSION['pwv'])], [(int)$a['id'], true]);
$_SESSION = [];
// 予定をToDoに戻す（ToDoから置いた予定は、元のToDoに戻る）
$back = event_to_todo($ev, $a);
check('予定→ToDo: ToDoから置いた予定は、元のToDoに戻る（増えない）', [(int)$back['id'], $back['title'], $back['kind'], $back['tag']], [(int)$todoA['id'], '見積書を作る', 'work', '個人作業']);
check('予定→ToDo: 予定は消える', row('SELECT id FROM events WHERE id = ?', [$ev['id']]), null);
$sd1 = schedule_todo(find_todo((int)$todoA['id'], $a), $dd, $a);
q('DELETE FROM todos WHERE id = ?', [$todoA['id']]); todo_detach_events('SELECT ' . (int)$todoA['id'], []);
check('ToDoを消すと、結びついた予定は、ふつうの予定として残る', [row('SELECT todo_id FROM events WHERE id = ?', [$sd1['id']])['todo_id'], row('SELECT id FROM events WHERE id = ?', [$sd1['id']]) !== null], [null, true]);
q('DELETE FROM events WHERE id = ?', [$sd1['id']]);
$back = save_todo(['kind' => 'work', 'title' => '見積書を作る', 'tag' => '個人作業', 'note' => '', 'family_shared' => 0], $a, null);
$todoA = $back;
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
check('完了: 完了にすると、未完了のリストから消える', in_array('完了テストA', array_column($todosAll($a), 'title'), true), false);
check('完了: 完了リストに入り、完了日時が付く（業務版は業務、プライベート版はプライベートだけ）', [array_column(list_done_todos($a, 'me'), 'title'), array_column(list_done_todos($a, 'team'), 'title'), list_done_todos($a, 'me')[0]['done_at'] !== null], [['完了テスト私用'], ['完了テストA'], true]);
check('完了: 業務版の完了リストには業務のToDoだけ', array_column(list_done_todos($a, 'team'), 'title'), ['完了テストA']);
check('完了: 他の社員には完了リストも見えない', [list_done_todos($b, 'me'), list_done_todos($admin, 'me')], [[], []]);
check('完了: 完了したToDoは予定にできない', $thrown(function () use ($tdA, $a) { schedule_todo(find_todo((int)$tdA['id'], $a), '2026-12-01', $a); }), true);
reorder_todos([(int)$tdA['id'], (int)$tdB['id']], $a);
check('完了: 並べ替えは未完了だけが対象', find_todo((int)$tdA['id'], $a)['done_at'] !== null, true);
set_todo_done(find_todo((int)$tdA['id'], $a), false);
$act = array_column($todosAll($a), 'title');
check('完了: 未完了に戻すと、リストの末尾に入る', end($act), '完了テストA');
check('完了: 戻すと完了リストから消える', in_array('完了テストA', array_column(list_done_todos($a, 'team'), 'title'), true), false);
check('完了: 業務版で完了を一括削除しても、プライベートの完了は残る', [clear_done_todos($a, 'team'), array_column(list_done_todos($a, 'me'), 'title')], [0, ['完了テスト私用']]);
set_todo_done(find_todo((int)$tdB['id'], $a), true);
check('完了: 一括削除は、見ている版の分だけ（プライベート版はプライベート、業務版は業務）', [clear_done_todos($a, 'me'), list_done_todos($a, 'team') !== [], clear_done_todos($a, 'team'), list_done_todos($a, 'me'), list_done_todos($a, 'team')], [1, true, 1, [], []]);
foreach ($todosAll($a) as $leftover) { q('DELETE FROM todos WHERE id = ?', [$leftover['id']]); }

// ---- ToDoのカンバン（状態: 未着手・進行中・完了） ----
[$kA] = validate_todo_input(['kind' => 'work', 'title' => 'カンバンA']); $kbA = save_todo($kA, $a, null);
[$kB] = validate_todo_input(['kind' => 'work', 'title' => 'カンバンB']); $kbB = save_todo($kB, $a, null);
[$kC] = validate_todo_input(['kind' => 'private', 'title' => 'カンバンC']); $kbC = save_todo($kC, $a, null);
$stOf = function (array $u) { $m = []; foreach (array_merge(list_todos($u, 'me'), list_todos($u, 'team'), list_done_todos($u, 'me'), list_done_todos($u, 'team')) as $t) { $m[$t['title']] = $t['status']; } return $m; };
check('カンバン: 新しいToDoは未着手', $stOf($a)['カンバンA'], 'todo');
set_todo_status($kbA, 'doing');
check('カンバン: 進行中にできる（未完了のリストに残る）', [$stOf($a)['カンバンA'], find_todo((int)$kbA['id'], $a)['done_at']], ['doing', null]);
set_todo_status(find_todo((int)$kbA['id'], $a), 'done');
check('カンバン: 進行中から完了へ', [$stOf($a)['カンバンA'], find_todo((int)$kbA['id'], $a)['done_at'] !== null, (int)find_todo((int)$kbA['id'], $a)['doing']], ['done', true, 0]);
set_todo_status(find_todo((int)$kbA['id'], $a), 'doing');
check('カンバン: 完了から進行中へ戻せる', [$stOf($a)['カンバンA'], find_todo((int)$kbA['id'], $a)['done_at']], ['doing', null]);
set_todo_status(find_todo((int)$kbA['id'], $a), 'hold');
check('カンバン: 保留にできる（未完了のリストに残り、状態は「保留」。進行中ではない）', [$stOf($a)['カンバンA'], (int)find_todo((int)$kbA['id'], $a)['doing'], find_todo((int)$kbA['id'], $a)['done_at']], ['hold', 2, null]);
check('カンバン: 保留のToDoも、業務版の一覧に出る（業務のとき）', in_array('カンバンA', array_column(list_todos($a, 'team'), 'title'), true) || in_array('カンバンA', array_column(list_todos($a, 'me'), 'title'), true), true);
set_todo_status(find_todo((int)$kbA['id'], $a), 'doing');
check('カンバン: 保留から進行中へ戻せる', $stOf($a)['カンバンA'], 'doing');
set_todo_status(find_todo((int)$kbA['id'], $a), 'hold'); set_todo_status(find_todo((int)$kbA['id'], $a), 'done');
check('カンバン: 保留から完了にすると、保留は外れる（戻すと未着手）', [$stOf($a)['カンバンA'], (int)find_todo((int)$kbA['id'], $a)['doing']], ['done', 0]);
set_todo_status(find_todo((int)$kbA['id'], $a), 'todo');
check('カンバン: 進行中から未着手へ戻せる', $stOf($a)['カンバンA'], 'todo');
set_todo_status(find_todo((int)$kbB['id'], $a), 'doing');
set_todo_status(find_todo((int)$kbC['id'], $a), 'doing');
reorder_todos([(int)$kbC['id'], (int)$kbB['id']], $a);
$doingOrder = array_column(array_filter($todosAll($a), function ($t) { return $t['status'] === 'doing'; }), 'title');
check('カンバン: 進行中の列の並べ替え', array_values($doingOrder), ['カンバンC', 'カンバンB']);
check('カンバン: 業務版は業務の進行中だけ', array_column(array_filter(list_todos($a, 'team'), function ($t) { return $t['status'] === 'doing'; }), 'title'), ['カンバンB']);
check('カンバン: 進行中のToDoも予定にできる（ToDoは残り、進行中のまま）', (function () use ($kbB, $a) { schedule_todo(find_todo((int)$kbB['id'], $a), '2026-12-02', $a); return todo_status_of(find_todo((int)$kbB['id'], $a)); })(), 'doing');
check('カンバン: 他の人のToDoは見えない・操作できない', [find_todo((int)$kbC['id'], $b), array_column($todosAll($b), 'title')], [null, []]);
foreach ($todosAll($a) as $leftover) { q('DELETE FROM todos WHERE id = ?', [$leftover['id']]); }
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
check('休みの日のセル: 初期は、オン・標準の色', get_prefs($b)['offday'], ['on' => true, 'color' => '']);
save_color_prefs($b, [], ['on' => false, 'color' => '#CFE4FC']);
check('休みの日のセル: オフ・色を保存できる（小文字にそろう）。色の設定とは別に保たれる', [get_prefs($b)['offday'], get_prefs($b)['colors']['work']], [['on' => false, 'color' => '#cfe4fc'], '']);
save_color_prefs($b, ['work' => '#2155d6']);
check('休みの日のセル: 色の設定だけを保存しても、この設定は変わらない', get_prefs($b)['offday'], ['on' => false, 'color' => '#cfe4fc']);
save_color_prefs($b, [], ['on' => true, 'color' => 'red']);
check('休みの日のセル: 不正な色は標準に戻る', get_prefs($b)['offday'], ['on' => true, 'color' => '']);
save_color_prefs($b, []);
check('休みの日のセル: 他の人の設定には影響しない', get_prefs($a)['offday'], ['on' => true, 'color' => '']);

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

// ---- パスワードのリセット ----
$rid = create_user('リセット太郎', 'reset@example.com', 'oldpassword1');
for ($i = 0; $i < 3; $i++) { login_attempt('reset@example.com', 'bad'); }
$tmpPw = reset_user_password($rid);
check('リセット: 一時パスワードは12文字で、読み間違えやすい文字（0 O 1 l I）を含まない', [strlen($tmpPw), preg_match('/[0O1lI]/', $tmpPw)], [12, 0]);
check('リセット: 古いパスワードでは入れず、一時パスワードで入れる', [login_attempt('reset@example.com', 'oldpassword1') === null, login_attempt('reset@example.com', $tmpPw) !== null], [true, true]);
check('リセット: 次のログインで、パスワードの変更を求める', (int)row('SELECT must_change_password AS m FROM users WHERE id = ?', [$rid])['m'], 1);
check('リセット: ログイン失敗のロックも解除される', (int)row("SELECT COUNT(*) AS c FROM login_fails WHERE email = 'reset@example.com'")['c'], 0);
check('リセット: 毎回違うパスワードになる', reset_user_password($rid) !== $tmpPw, true);
check('リセット: 指定したパスワードにもできる（8文字以上）', [reset_user_password($rid, 'my-new-pass1'), login_attempt('reset@example.com', 'my-new-pass1') !== null], ['my-new-pass1', true]);
$e1 = null; try { reset_user_password($rid, 'short'); } catch (RuntimeException $x) { $e1 = 'ng'; }
$e2 = null; try { reset_user_password(999999); } catch (RuntimeException $x) { $e2 = 'ng'; }
check('リセット: 短いパスワード・存在しない社員は、エラー', [$e1, $e2], ['ng', 'ng']);
q('DELETE FROM users WHERE id = ?', [$rid]);

// ---- 変更履歴（管理者用）----
q('DELETE FROM audit_log');
audit_set_actor($b);
$au1 = $mk($a, ['kind' => 'work', 'title' => '履歴テストの会議', 'tag' => '打ち合わせ', 'start' => '2031-05-12', 'end' => '2031-05-12']);
[$auD] = validate_event_input(['kind' => 'work', 'title' => '履歴テストの会議（変更）', 'tag' => '全体会議', 'start' => '2031-05-13', 'end' => '2031-05-13', 'start_time' => '10:00'], $a);
save_event($auD, $a, $au1);
delete_event(row('SELECT * FROM events WHERE id = ?', [$au1['id']]));
$al = audit_list([])['entries']; $al = array_reverse($al);
check('変更履歴: 予定の追加・変更・削除が、順に残る', array_column($al, 'action'), ['add', 'update', 'delete']);
check('変更履歴: 操作した人（鈴木）と、予定の持ち主（山田）が分かる', [$al[0]['actor'], $al[0]['target'], $al[0]['type_name']], [$b['name'], $a['name'], '予定']);
check('変更履歴: 変更の内容（件名・分類・日付・時刻）が出る', [strpos($al[1]['detail'], '件名「履歴テストの会議」→「履歴テストの会議（変更）」') !== false, strpos($al[1]['detail'], '分類 打ち合わせ → 全体会議') !== false, strpos($al[1]['detail'], '日付 5/12 → 5/13') !== false, strpos($al[1]['detail'], '時刻 時刻なし → 10:00') !== false], [true, true, true, true]);
check('変更履歴: ラベルに、種類・件名・日付が入る', $al[0]['label'], '業務｜履歴テストの会議　5/12');
$cnt = (int)row('SELECT COUNT(*) AS c FROM audit_log')['c'];
$pv = $mk($a, ['kind' => 'private', 'title' => '私的な予定', 'start' => '2031-05-20']);
[$pvD] = validate_event_input(['kind' => 'private', 'title' => '私的な予定（変更）', 'start' => '2031-05-21'], $a); save_event($pvD, $a, $pv);
delete_event(row('SELECT * FROM events WHERE id = ?', [$pv['id']]));
check('変更履歴: プライベートの予定は、追加・変更・削除のどれも記録しない', (int)row('SELECT COUNT(*) AS c FROM audit_log')['c'], $cnt);
$pv2 = $mk($a, ['kind' => 'private', 'title' => '秘密の件名', 'start' => '2031-05-22']);
[$pv2D] = validate_event_input(['kind' => 'work', 'title' => '公開した件名', 'tag' => '打ち合わせ', 'start' => '2031-05-22'], $a); save_event($pv2D, $a, $pv2);
$last = audit_list([])['entries'][0];
check('変更履歴: プライベートから業務に変えたときは、変更後の件名だけ。元の（秘密の）件名は出ない', [strpos($last['label'] . $last['detail'], '秘密の件名') === false, strpos($last['label'], '公開した件名') !== false, strpos($last['detail'], 'プライベート') !== false], [true, true, true]);
[$pv3D] = validate_event_input(['kind' => 'private', 'title' => '再び秘密', 'start' => '2031-05-22'], $a); save_event($pv3D, $a, row('SELECT * FROM events WHERE id = ?', [$pv2['id']]));
$last2 = audit_list([])['entries'][0];
check('変更履歴: 業務からプライベートに変えたときは、元の（公開されていた）件名だけ。新しい件名は出ない', [strpos($last2['label'] . $last2['detail'], '再び秘密') === false, strpos($last2['label'], '公開した件名') !== false], [true, true]);
delete_event(row('SELECT * FROM events WHERE id = ?', [$pv2['id']]));
audit_log('user', 'reset', 'パスワードをリセット', '山田 花子', '一時パスワードを発行');
audit_set_actor(null); audit_log('holiday', 'add', '年末年始休業　12/29〜1/3', '', '6日分を追加');
check('変更履歴: 種類・操作した人・検索で絞り込める', [count(audit_list(['type' => 'user'])['entries']), count(audit_list(['type' => 'holiday'])['entries']), count(audit_list(['actor' => (int)$b['id'], 'type' => 'user'])['entries']), count(audit_list(['q' => '年末年始'])['entries']), count(audit_list(['q' => '%'])['entries'])], [1, 1, 1, 1, 0]);
check('変更履歴: システムの操作は「（システム）」', audit_list(['type' => 'holiday'])['entries'][0]['actor'], '（システム）');
for ($i = 0; $i < 5; $i++) { audit_log('slack', 'update', "ページ{$i}"); }
$pg1 = audit_list(['limit' => 3]); $pg2 = audit_list(['limit' => 3, 'before' => end($pg1['entries'])['id']]);
check('変更履歴: 新しい順に、ページを分けて読める', [count($pg1['entries']), $pg1['has_more'], $pg2['entries'][0]['id'] < end($pg1['entries'])['id'], $pg1['entries'][0]['label']], [3, true, true, 'ページ4']);
q("UPDATE audit_log SET at = ? WHERE label = 'ページ0'", [date('Y-m-d H:i:s', time() - (AUDIT_KEEP_DAYS + 2) * 86400)]);
for ($i = 0; $i < 400; $i++) { audit_log('slack', 'update', 'x'); if ((int)row("SELECT COUNT(*) AS c FROM audit_log WHERE label = 'ページ0'")['c'] === 0) break; }
check('変更履歴: 1年たった記録は、自動で消える', (int)row("SELECT COUNT(*) AS c FROM audit_log WHERE label = 'ページ0'")['c'], 0);
q('DELETE FROM audit_log'); audit_set_actor(null);

// ---- 日報メモ ----
check('メモ: 取り消し線と改行は残る', sanitize_memo_html('<div>終わった<s>商品の登録</s></div><div><br></div><div>次</div>'), '<div>終わった<s>商品の登録</s></div><div><br></div><div>次</div>');
check('メモ: strike/del は s にそろう', sanitize_memo_html('<strike>a</strike><del>b</del>'), '<s>a</s><s>b</s>');
check('メモ: p は div になる', sanitize_memo_html('<p>x</p>'), '<div>x</div>');
check('メモ: 属性は全て消える', sanitize_memo_html('<div onclick="alert(1)" style="color:red"><s class="x" onmouseover="y()">t</s></div>'), '<div><s>t</s></div>');
check('メモ: script・style は中身ごと消える', sanitize_memo_html('a<script>alert(1)</script>b<style>*{}</style>c'), 'abc');
check('メモ: 許可外のタグ(a/img/iframe)は消え、文字は残る', sanitize_memo_html('<a href="javascript:x">link</a><img src=x onerror=y>z<iframe src=x></iframe>'), 'linkz');
check('メモ: 文字としての < は無害のまま', strpos(sanitize_memo_html('1 &lt; 2 &lt;script&gt;'), '<script') === false, true);
check('メモ: 空白をはさんだ「< script>」は、タグにならない（文字になる）', [strpos(sanitize_memo_html('< script>alert(1)< /script>'), '<script') === false, strpos(sanitize_memo_html('< img src=x onerror=y>z'), '<img') === false], [true, true]);
check('メモ: 出力に残る「<」は、許した目印だけ', preg_match_all('#<(?!/?(?:div|br|s)(?:\s[^>]*)?>)#', sanitize_memo_html('a<b>c< i>d<IMG src=x><script>e</script>< div>f<s>g</s><br/>')), 0);
check('メモ: ToDoの印（data-todo / data-st）は残り、他の属性は消える', sanitize_memo_html('<div data-todo="12" data-st="done" onclick="x()" style="a:b"><s>終わった</s></div>'), '<div data-todo="12" data-st="done"><s>終わった</s></div>');
check('メモ: ToDoの印は数字と決まった状態だけ（それ以外は捨てる）', sanitize_memo_html('<div data-todo="1;alert(1)" data-st="x"><s>t</s></div><div data-todo="abc">u</div><div data-todo="5" data-st="evil">v</div>'), '<div data-todo="1"><s>t</s></div><div>u</div><div data-todo="5">v</div>');
check('メモ: div 以外には、ToDoの印は付かない', sanitize_memo_html('<s data-todo="3">t</s>'), '<s>t</s>');
check('メモ: 日付の行の data-auto（自動で入れたToDoの控え）は残る。数字・「:」・「-」・「,」だけ', sanitize_memo_html('<div data-md="cur" data-date="2026-03-02" data-auto="12:2026-03-03,15:-">x</div><div data-md="next" data-date="2026-03-03" data-auto="1&quot;onclick=x">y</div>'), '<div data-md="cur" data-date="2026-03-02" data-auto="12:2026-03-03,15:-">x</div><div data-md="next" data-date="2026-03-03" data-auto="1">y</div>');
check('メモ: 日付の行でなければ、data-auto は付かない', sanitize_memo_html('<div data-auto="1:2026-01-01">a</div><s data-auto="2:-">b</s>'), '<div>a</div><s>b</s>');
$ms = get_memo_state($a);
check('日報: 当日と次回出勤日の日付が返る（どちらも平日で、当日の方が前）', [$ms['cur'] < $ms['next'], (int)date('N', strtotime($ms['cur'])) <= 5, (int)date('N', strtotime($ms['next'])) <= 5], [true, true, true]);
check('日報: 最初は本文が空（予定やToDoを自動で入れない）', [$ms['html'], isset($ms['seed']) ? $ms['seed']['old'] : null], ['', '']);
$doc = '<div>お疲れ様です。</div><div data-md="cur" data-date="' . $ms['cur'] . '">【x】</div><div><br></div><div><s>終わった業務</s></div><div>これから</div><div><br></div><div data-md="next" data-date="' . $ms['next'] . '">【y】</div><div data-todo="7" data-st="doing" data-tr="1">これから</div>';
save_memo($doc, $a);
check('日報: 1つの入力欄に保存して読み出せる（日付の行・転記の印・ToDoの印が残る）', get_memo_state($a)['html'], $doc);
check('日報: 構造化されていれば、引き継ぎ元（seed）は付かない', isset(get_memo_state($a)['seed']), false);
check('日報: 他の人の日報は空（本人だけ）', [get_memo_state($b)['html'], get_memo_state($admin)['html']], ['', '']);
// 日報の雛形（本人が決める）
$tpl = '<div>こんにちは。</div><div><br></div><div data-md="cur" data-date="2026-03-02">【3/2　本日の予定】</div><div><br></div><div data-todo="5" data-st="todo">消える項目</div><div><br></div><div data-md="next" data-date="2026-03-03">【3/3　明日の予定】</div><div><br></div><div>以上。</div>';
check('日報の雛形: 初めは無い（標準の雛形を使う）', get_memo_state($a)['tpl'], '');
$tsaved = memo_template_save($tpl, $a);
check('日報の雛形: 保存して読み出せる。項目の印（ToDoの印）は持ち込まない。日付の行の印は残る', [get_memo_state($a)['tpl'] === $tsaved, strpos($tsaved, 'data-todo') === false, strpos($tsaved, 'data-md="cur"') !== false, strpos($tsaved, '本日の予定') !== false], [true, true, true, true]);
$tplAuto = memo_template_save(str_replace('data-date="2026-03-02"', 'data-date="2026-03-02" data-auto="5:2026-03-02"', $tpl), $a);
check('日報の雛形: 自動で入れたToDoの控え（data-auto）は、持ち込まない', [strpos($tplAuto, 'data-auto') === false, strpos($tplAuto, 'data-md="cur"') !== false], [true, true]);
memo_template_save($tpl, $a);
check('日報の雛形: 他の人には、見えない（本人ごと）', [get_memo_state($b)['tpl'], get_memo_state($admin)['tpl']], ['', '']);
$badT = [];
foreach (['<div>日付の行がない</div>', '<div data-md="cur" data-date="2026-03-02">【3/2】</div><div>次回の行がない</div>', '<div data-md="cur" data-date="2026-03-02">【3/2】</div><div data-md="next" data-date="2026-03-03">【3/3】</div><div>' . str_repeat('あ', 2000) . '</div>'] as $bad) {
    try { memo_template_save($bad, $a); $badT[] = 'ok'; } catch (RuntimeException $x) { $badT[] = 'ng'; }
}
check('日報の雛形: 日付の行が2つ無い・長すぎるものは、保存できない（いまの雛形は、そのまま）', [$badT, get_memo_state($a)['tpl'] === $tsaved], [['ng', 'ng', 'ng'], true]);
memo_template_save('', $a);
check('日報の雛形: 空で保存すると、標準の雛形に戻る', get_memo_state($a)['tpl'], '');
check('日報: 不正な印は捨てる（日付・種類・転記）', sanitize_memo_html('<div data-md="evil" data-date="2026-01-01">a</div><div data-md="cur" data-date="x">b</div><div data-tr="2">c</div>'), '<div>a</div><div>b</div><div>c</div>');
check('日報: s や br には印が付かない', sanitize_memo_html('<s data-md="cur" data-date="2026-01-01">t</s>'), '<s>t</s>');
check('日報: 長すぎると拒否', $thrown(function () use ($a) { save_memo(str_repeat('あ', MEMO_MAX_CHARS + 1), $a); }), true);
check('日報: 日が進んでいない保存では、控えは増えない', count(memo_history_days($a)), 0);
$nd = date('Y-m-d', strtotime($ms['next'] . ' +1 day')); // 日が進んだ（当日の日付が変わった）ときの保存
save_memo('<div data-md="cur" data-date="' . $ms['next'] . '">【z】</div><div>次の日の内容</div>', $a);
check('日報: 日が進むと、前の日報が、その日の控えとして残る', [memo_history_days($a), memo_history_get($ms['cur'], $a)], [[$ms['cur']], $doc]);
check('日報: 控えは本人だけ・不正な日付は無し', [memo_history_get($ms['cur'], $b), memo_history_get('2026-13-45', $a)], [null, null]);
save_memo('<div data-md="cur" data-date="' . $ms['cur'] . '">【過去に戻った】</div>', $a);
check('日報: 日付が戻る保存では、控えを作らない（上書きしない）', memo_history_get($ms['cur'], $a), $doc);
// 出勤日: 土日祝・本人の終日の休みは飛ばす。半休は出勤日
$wd0 = date('Y-m-d', strtotime('next monday +400 day'));
$wl = work_days_from($a, date('Y-m-d'), 60); $hm = holiday_map(date('Y-m-d'), date('Y-m-d', strtotime('+130 day')));
check('出勤日: 60日分、全て平日で、祝日・会社の休業日ではない', [count($wl), count(array_filter($wl, function ($d) use ($hm) { return (int)date('N', strtotime($d)) > 5 || isset($hm[$d]); }))], [60, 0]);
$sat = date('Y-m-d', strtotime('next saturday +300 day'));
check('出勤日: 土曜に見ると、次の出勤日は平日', (int)date('N', strtotime(work_days_from($a, $sat, 1)[0])) <= 5, true);
$mon = date('Y-m-d', strtotime('next monday +300 day'));
$firstWd = work_days_from($a, $mon, 3);
$offEv = $mk($a, ['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $firstWd[0]]);
check('出勤日: 本人の終日の休みの日は、出勤日にならない', work_days_from($a, $mon, 2), array_slice($firstWd, 1, 2));
check('出勤日: 他の人の休みは影響しない', work_days_from($b, $mon, 3), $firstWd);
q('DELETE FROM events WHERE id = ?', [$offEv['id']]);
$half = $mk($a, ['kind' => 'off', 'title' => '', 'tag' => '午前半休', 'start' => $firstWd[0]]);
check('出勤日: 半休の日は、出勤日のまま', work_days_from($a, $mon, 3), $firstWd);
q('DELETE FROM events WHERE id = ?', [$half['id']]);
// 以前の版のメモ・日ごとのメモは、引き継ぎ元（seed）として返る（本文が構造化されるまで）
q('DELETE FROM memos WHERE owner_id = ?', [$b['id']]);
q('INSERT INTO memos (owner_id, body, updated_at) VALUES (?,?,?)', [$b['id'], '<div>旧版のメモ</div>', now_str()]);
$mst = get_memo_state($b);
q('INSERT INTO memo_days (owner_id, day, body, updated_at) VALUES (?,?,?,?)', [$b['id'], $mst['cur'], '<div>1.41の当日</div>', now_str()]);
$mst = get_memo_state($b);
check('日報: 旧版のメモ・日ごとのメモは、引き継ぎ元として返る', [$mst['html'], $mst['seed']['old'], $mst['seed']['cur'], $mst['seed']['next']], ['', '<div>旧版のメモ</div>', '<div>1.41の当日</div>', '']);

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
check('共有設定: ToDoに戻しても「共有しない」を引き継ぐ', (int)$tdBack['family_shared'], 0);
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
check('種類変更: プライベートにした予定は、本人には見える', in_array('種類を変える予定', array_column(list_events($a, $kd, $kd, 'me'), 'title'), true), true);
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


// ---- バックアップ（暗号化・復元） ----
$thB = function (callable $f) { try { $f(); return null; } catch (BackupException $x) { return $x->getMessage(); } };
$bkPriv = save_event(['kind' => 'private', 'title' => 'ひみつの通院予定', 'tag' => '', 'start' => '2026-11-05', 'end' => '2026-11-05', 'start_time' => '', 'end_time' => '', 'note' => 'メモひみつ', 'owner_id' => (int)$a['id'], 'family_shared' => 0, 'important' => 0], $a, null);
$bkWork = save_event(['kind' => 'work', 'title' => 'バックアップ確認会議', 'tag' => '全体会議', 'start' => '2026-11-06', 'end' => '2026-11-06', 'start_time' => '', 'end_time' => '', 'note' => '', 'owner_id' => (int)$a['id'], 'family_shared' => 0, 'important' => 0], $a, null);
$bk = backup_create('backup-pass-1');
check('バックアップ: 暗号化したファイルには、予定の件名・メモが平文で入らない', [strpos($bk['blob'], 'ひみつの通院予定') === false, strpos($bk['blob'], 'メモひみつ') === false, strpos($bk['blob'], 'バックアップ確認会議') === false, strpos($bk['blob'], 'password') === false], [true, true, true, true]);
check('バックアップ: ファイルの先頭は形式の印', substr($bk['blob'], 0, 8), 'SCHEDBK1');
$bkData = backup_inspect(backup_decrypt($bk['blob'], 'backup-pass-1'));
check('バックアップ: 正しいパスワードで開け、プライベートの予定も入っている', in_array('ひみつの通院予定', array_column($bkData['tables']['events'], 'title'), true), true);
check('バックアップ: 社員・予定の件数が記録される', [$bk['counts']['users'] > 0, $bk['counts']['events'] >= 2], [true, true]);
check('バックアップ: ログイン失敗の記録は含めない', isset($bkData['tables']['login_fails']), false);
check('バックアップ: 違うパスワードでは開けない', $thB(function () use ($bk) { backup_decrypt($bk['blob'], 'wrong-pass-123'); }) !== null, true);
$bad = $bk['blob']; $bad[strlen($bad) - 3] = chr(ord($bad[strlen($bad) - 3]) ^ 1);
check('バックアップ: 中身が1か所でも書き換えられたら、開けない', $thB(function () use ($bad) { backup_decrypt($bad, 'backup-pass-1'); }) !== null, true);
$bad2 = $bk['blob']; $bad2[10] = chr(ord($bad2[10]) ^ 1);
check('バックアップ: 先頭部分（塩）の改ざんも、開けない', $thB(function () use ($bad2) { backup_decrypt($bad2, 'backup-pass-1'); }) !== null, true);
check('バックアップ: バックアップではないファイルは、拒否', $thB(function () { backup_decrypt('これは違うファイル' . str_repeat('x', 80), 'backup-pass-1'); }) !== null, true);
check('バックアップ: 短いパスワードは、拒否', $thB(function () { backup_create('short'); }) !== null, true);
$bkA = $bk['blob']; $bkB = backup_create('backup-pass-1')['blob'];
check('バックアップ: 同じ内容・同じパスワードでも、毎回ちがう暗号文（塩とIVがランダム）', $bkA !== $bkB, true);
// 復元: あとから変えた内容が、バックアップの時点に戻る（スキーマ版・更新番号は、いまのまま）
$verBefore = row('SELECT meta_value FROM app_meta WHERE meta_key = ?', ['schema_version'])['meta_value'];
q('DELETE FROM events WHERE id = ?', [$bkPriv['id']]);
save_event(['kind' => 'work', 'title' => 'バックアップ後に増えた予定', 'tag' => '全体会議', 'start' => '2026-11-07', 'end' => '2026-11-07', 'start_time' => '', 'end_time' => '', 'note' => '', 'owner_id' => (int)$a['id'], 'family_shared' => 0, 'important' => 0], $a, null);
$cnt = backup_restore_data($bkData);
$titles = array_column(rows('SELECT title FROM events'), 'title');
check('復元: 消した予定（プライベート）が戻る', in_array('ひみつの通院予定', $titles, true), true);
check('復元: バックアップ後に増えた予定は消える', in_array('バックアップ後に増えた予定', $titles, true), false);
check('復元: 件数が、バックアップと同じ', $cnt['events'], $bk['counts']['events']);
check('復元: 社員（パスワードのハッシュも）がそのまま戻り、ログインできる', (bool)login_attempt('a@example.com', 'password1'), true);
check('復元: スキーマ版は、いまのまま', row('SELECT meta_value FROM app_meta WHERE meta_key = ?', ['schema_version'])['meta_value'], $verBefore);
$newerData = $bkData; $newerData['schema_version'] = SCHEMA_VERSION + 1;
check('復元: いまより新しい版のバックアップは、拒否', $thB(function () use ($newerData) { backup_inspect(json_encode($newerData)); }) !== null, true);
$noAdmin = $bkData; $noAdmin['tables']['users'] = array_map(function ($u) { $u['role'] = 'member'; return $u; }, $bkData['tables']['users']);
check('復元: 利用中の管理者がいないバックアップは、拒否（誰もログインできなくなるため）', $thB(function () use ($noAdmin) { backup_inspect(json_encode($noAdmin)); }) !== null, true);
$noUsers = $bkData; unset($noUsers['tables']['users']);
check('復元: 社員の表が入っていないバックアップは、管理者の確認の対象外', $thB(function () use ($noUsers) { backup_inspect(json_encode($noUsers)); }) === null, true);
// 画像の記録は、バックアップに入らない。復元で、別のコメントに結びつかないよう、記録とファイルを消す
@mkdir(attach_dir(), 0700, true); file_put_contents(attach_dir() . '/restoretest.png', 'x');
q("INSERT INTO todo_comment_files (comment_id, todo_id, name, mime, size, width, height, stored, created_at) VALUES (999999, 999999, 'x.png', 'image/png', 1, 1, 1, 'restoretest.png', ?)", [now_str()]);
backup_restore_data($bkData);
check('復元: コメントの画像の記録とファイルは、消える', [(int)row('SELECT COUNT(*) AS c FROM todo_comment_files')['c'], is_file(attach_dir() . '/restoretest.png')], [0, false]);
$evCount = (int)row('SELECT COUNT(*) AS c FROM events')['c'];
$brokenData = $bkData; $brokenData['tables']['users'][0]['email'] = null; // NOT NULL に違反させて、途中で失敗させる
check('復元: 途中で失敗したら、データは元のまま', $thB(function () use ($brokenData) { backup_restore_data($brokenData); }) !== null && (int)row('SELECT COUNT(*) AS c FROM events')['c'] === $evCount, true);


// ---- 自動バックアップ・月1回のお知らせ ----
$autoDir = backup_dir();
foreach (glob($autoDir . '/*') ?: [] as $f) { @unlink($f); }
check('自動バックアップ: パスワード未設定なら、動かない', [backup_auto_status()['enabled'], backup_auto_due(strtotime('2026-11-10 04:00:00'))], [false, []]);
backup_meta_set('backup_auto_pass', 'auto-pass-123');
check('自動バックアップ: パスワード設定で有効になる（DB）', [backup_auto_status()['enabled'], backup_auto_status()['source']], [true, 'db']);
check('自動バックアップ: 3時より前は、作らない', backup_auto_due(strtotime('2026-11-10 02:59:00')), []);
$msgA = backup_auto_due(strtotime('2026-11-10 03:05:00'));
check('自動バックアップ: 3時すぎに1回作る', [count($msgA), count(backup_auto_files())], [1, 1]);
$fileA = backup_auto_files()[0];
check('自動バックアップ: ファイルは暗号化され、設定したパスワードで復元できる', [substr(file_get_contents(backup_dir() . '/' . $fileA['name']), 0, 8), isset(backup_inspect(backup_decrypt(file_get_contents(backup_dir() . '/' . $fileA['name']), 'auto-pass-123'))['tables']['events'])], ['SCHEDBK1', true]);
check('自動バックアップ: 同じ日の2回目は、作らない', backup_auto_due(strtotime(date('Y-m-d') . ' 15:00:00')), []);
check('自動バックアップ: 保存先には、Webから見えないよう .htaccess がある', is_file(backup_dir() . '/.htaccess'), true);
check('自動バックアップ: 自動バックアップの設定そのもの（パスワード）は、バックアップに含まれない', array_filter(backup_collect()['tables']['app_meta'], function ($r) { return strpos($r['meta_key'], 'backup_') === 0; }), []);
check('自動バックアップ: 名前の検証（一覧にあるものだけ取り出せる）', [backup_auto_file_path($fileA['name']) !== null, backup_auto_file_path('../../config.php'), backup_auto_file_path('auto-19990101-000000.enc')], [true, null, null]);
// 古いものは消える（既定: 新しい30個）
for ($i = 1; $i <= 33; $i++) { file_put_contents(backup_dir() . sprintf('/auto-2026%02d%02d-010000.enc', 1 + intdiv($i - 1, 28), 1 + ($i - 1) % 28), 'x'); }
backup_auto_run();
check('自動バックアップ: 保存は新しい30個まで（古いものは消える）', count(backup_auto_files()), 30);
// 失敗: 書けないとき
backup_meta_set('backup_auto_pass', 'short');
check('自動バックアップ: 失敗したときは、記録される', [$thB(function () { backup_auto_run(); }) !== null, backup_auto_status()['last_error'] !== ''], [true, true]);
backup_meta_set('backup_auto_pass', 'auto-pass-123');
backup_meta_set('backup_auto_at', '');
backup_meta_set('backup_auto_try', (string)strtotime('2030-01-01 03:00:00'));
check('自動バックアップ: 失敗のあと、1時間は、やり直さない', backup_auto_due(strtotime('2030-01-01 03:30:00')), []);
check('自動バックアップ: 1時間たてば、やり直す', count(backup_auto_due(strtotime('2030-01-01 04:10:00'))), 1);
foreach (glob(backup_dir() . '/*') ?: [] as $f) { if (basename($f) !== '.htaccess') { @unlink($f); } }
backup_meta_set('backup_auto_pass', '');
// 月1回のお知らせ
foreach (['backup_manual_at', 'backup_first', 'backup_snooze', 'backup_alert_slack'] as $k) { backup_meta_set($k, ''); }
$t0 = strtotime('2026-11-01 10:00:00');
check('お知らせ: 使い始めた日が基準（すぐには出ない）', [backup_alert_status($t0)['overdue'], backup_alert_for_screen() === null], [false, true]);
check('お知らせ: 29日後は、まだ出ない', backup_alert_status($t0 + 29 * 86400)['overdue'], false);
check('お知らせ: 30日たつと出る', backup_alert_status($t0 + 30 * 86400)['overdue'], true);
backup_snooze(7);
check('お知らせ: 「あとで」で、7日間は消える', backup_alert_status(time())['snoozed'], true);
backup_meta_set('backup_snooze', (string)(time() - 10));
check('お知らせ: 7日たつと、また出る', backup_alert_status(time() + 60)['snoozed'], false);
backup_manual_mark();
check('お知らせ: 手動でダウンロードすると、数え直す（出なくなる）', [backup_alert_status()['overdue'], backup_alert_status()['last'] !== null, backup_alert_status()['snoozed']], [false, true, false]);
backup_meta_set('backup_manual_at', date('Y-m-d H:i:s', strtotime('-31 days')));
check('お知らせ: 画面に出す内容（管理者用）', backup_alert_for_screen() !== null && backup_alert_for_screen()['days'] >= 31, true);
// Slack: オフなら送らない／オンなら月に1回
$sentSlack = 0;
check('お知らせ(Slack): オフのときは、送らない', backup_alert_due(strtotime('2026-12-05 10:00:00')), []);
backup_meta_set('backup_alert_slack', '1');
check('お知らせ(Slack): Slackの送り先が無ければ、送れない（何もしない）', backup_alert_due(strtotime('2026-12-05 10:00:00')), []);

// ---- 家族用の更新履歴の削除 ----
$flA = save_event(['kind' => 'private', 'title' => '履歴削除A', 'tag' => '', 'start' => date('Y-m-d'), 'end' => date('Y-m-d'), 'start_time' => '', 'end_time' => '', 'note' => '', 'owner_id' => (int)$a['id'], 'family_shared' => 1, 'important' => 0], $a, null);
$flB = save_event(['kind' => 'private', 'title' => '履歴削除B', 'tag' => '', 'start' => date('Y-m-d'), 'end' => date('Y-m-d'), 'start_time' => '', 'end_time' => '', 'note' => '', 'owner_id' => (int)$b['id'], 'family_shared' => 1, 'important' => 0], $b, null);
$flAll = rows('SELECT id FROM event_log WHERE owner_id = ? ORDER BY id', [(int)$a['id']]);
$flBAll = (int)row('SELECT COUNT(*) AS c FROM event_log WHERE owner_id = ?', [(int)$b['id']])['c'];
$flFirst = (int)$flAll[0]['id'];
check('更新履歴の削除: 他の人の履歴は、消せない', family_log_delete((int)$b['id'], $flFirst), 0);
check('更新履歴の削除: 1件だけ消す', [family_log_delete((int)$a['id'], $flFirst), count(rows('SELECT id FROM event_log WHERE owner_id = ?', [(int)$a['id']])) === count($flAll) - 1], [1, true]);
check('更新履歴の削除: 家族に見える履歴からも消える', in_array($flFirst, array_column(family_event_log((int)$a['id'])['entries'], 'id'), true), false);
// 削除した予定の取消線（墓石）も、記録といっしょに消える
delete_event($flA);
$tombBefore = family_tombstones((int)$a['id'], date('Y-m-d', strtotime('-1 day')), date('Y-m-d', strtotime('+1 day')), [], []);
check('更新履歴の削除: 削除した予定は、取消線として残る', count($tombBefore) >= 1, true);
$delLog = (int)row("SELECT MAX(id) AS m FROM event_log WHERE owner_id = ? AND action = 'delete'", [(int)$a['id']])['m'];
family_log_delete((int)$a['id'], $delLog);
check('更新履歴の削除: その記録を消すと、取消線も消える', count(family_tombstones((int)$a['id'], date('Y-m-d', strtotime('-1 day')), date('Y-m-d', strtotime('+1 day')), [], [])), count($tombBefore) - 1);
$nAll = family_log_delete((int)$a['id'], null);
check('更新履歴の削除: すべて削除', [(int)row('SELECT COUNT(*) AS c FROM event_log WHERE owner_id = ?', [(int)$a['id']])['c'], $nAll >= 0], [0, true]);
check('更新履歴の削除: 他の人の履歴は、そのまま', (int)row('SELECT COUNT(*) AS c FROM event_log WHERE owner_id = ?', [(int)$b['id']])['c'], $flBAll);
check('更新履歴の削除: 予定そのものは、消えない', (bool)row('SELECT id FROM events WHERE id = ?', [(int)$flB['id']]), true);
$flF = save_event(['kind' => 'private', 'title' => '履歴ごと消す予定', 'tag' => '', 'start' => date('Y-m-d'), 'end' => date('Y-m-d'), 'start_time' => '', 'end_time' => '', 'note' => '', 'owner_id' => (int)$a['id'], 'family_shared' => 1, 'important' => 0], $a, null);
$flFrow = find_event((int)$flF['id'], $a); $flFbefore = (int)row('SELECT COUNT(*) AS c FROM event_log WHERE owner_id = ? AND event_id = ?', [(int)$a['id'], (int)$flF['id']])['c'];
delete_event($flFrow); $flFdel = (int)row('SELECT COUNT(*) AS c FROM event_log WHERE owner_id = ? AND event_id = ?', [(int)$a['id'], (int)$flF['id']])['c'];
$flFn = family_log_forget_event((int)$a['id'], (int)$flF['id']);
check('更新履歴: 予定を消すとき「家族の更新履歴にも残さない」を選ぶと、その予定の履歴（追加・削除）が全部消える。他の予定の履歴は、そのまま', [$flFbefore >= 1, $flFdel >= 2, $flFn >= 2, (int)row('SELECT COUNT(*) AS c FROM event_log WHERE owner_id = ? AND event_id = ?', [(int)$a['id'], (int)$flF['id']])['c'], (int)row('SELECT COUNT(*) AS c FROM event_log WHERE owner_id = ? AND event_id <> ?', [(int)$a['id'], (int)$flF['id']])['c'] >= 0], [true, true, true, 0, true]);
$flNew = save_event(['kind' => 'private', 'title' => '履歴削除C', 'tag' => '', 'start' => date('Y-m-d'), 'end' => date('Y-m-d'), 'start_time' => '', 'end_time' => '', 'note' => '', 'owner_id' => (int)$a['id'], 'family_shared' => 1, 'important' => 0], $a, null);
check('更新履歴の削除: 削除のあとの新しい記録は、これまでより大きい番号（家族の「新着」判定が崩れない）', (int)family_event_log((int)$a['id'])['last_id'] > $flFirst, true);


// ---- 変更履歴（管理者）の削除 ----
// （記録のたびに、1/40 の確率で、365日より古い履歴が自動で消える。テストが揺れないよう、いちばん古い履歴も 365日より新しくしておく）
q('DELETE FROM audit_log');
$au0 = function () { return (int)row('SELECT COUNT(*) AS c FROM audit_log')['c']; };
foreach ([[200, '古い履歴A'], [100, '古い履歴B'], [10, '新しい履歴C'], [1, '新しい履歴D']] as [$ago, $lbl]) {
    q('INSERT INTO audit_log (at, actor_id, actor_name, type, action, label, target_name, detail) VALUES (?,?,?,?,?,?,?,?)', [date('Y-m-d H:i:s', time() - $ago * 86400), null, 'テスト', 'event', 'add', $lbl, '', '']);
}
$auOne = (int)row('SELECT id FROM audit_log WHERE label = ?', ['新しい履歴D'])['id'];
check('変更履歴の削除: 1件だけ消せる', [audit_delete('one', $auOne), (bool)row('SELECT id FROM audit_log WHERE id = ?', [$auOne])], [1, false]);
$lastRec = row("SELECT label, detail, type, action FROM audit_log ORDER BY id DESC LIMIT 1");
check('変更履歴の削除: 消したことが、新しい履歴として残る（中身は残さない）', [$lastRec['label'], $lastRec['type'], $lastRec['action'], strpos($lastRec['detail'], '新しい履歴D') === false, strpos($lastRec['detail'], '1件') !== false], ['変更履歴を削除', 'security', 'delete', true, true]);
check('変更履歴の削除: 存在しない番号は、何も消さず、記録も増やさない', [audit_delete('one', 999999), $au0()], [0, 4]);
check('変更履歴の削除: 90日より前を消す（200日前・100日前が消える）', [audit_delete('older', 90), array_column(rows("SELECT label FROM audit_log WHERE label NOT LIKE '変更履歴を削除'"), 'label')], [2, ['新しい履歴C']]);
$beforeAll = $au0();
check('変更履歴の削除: すべて削除し、削除の記録だけが残る', [audit_delete('all'), $au0(), row('SELECT label FROM audit_log')['label']], [$beforeAll, 1, '変更履歴を削除']);
check('変更履歴の削除: 知らないモードは、何もしない', audit_delete('x'), 0);


// ---- 業務のToDoの共有（全員に見える・見るだけ） ----
q('DELETE FROM todos');
$tdA1 = save_todo(['title' => '山田の業務ToDo', 'kind' => 'work', 'tag' => '', 'note' => '山田のメモ', 'family_shared' => 0], $a, null);
$tdA2 = save_todo(['title' => '山田のプライベートToDo', 'kind' => 'private', 'tag' => '', 'note' => 'ひみつ', 'family_shared' => 0], $a, null);
$tdB1 = save_todo(['title' => '鈴木の業務ToDo', 'kind' => 'work', 'tag' => '', 'note' => '', 'family_shared' => 0], $b, null);
$tdDone = save_todo(['title' => '鈴木の完了済みToDo', 'kind' => 'work', 'tag' => '', 'note' => '', 'family_shared' => 0], $b, null);
set_todo_done($tdDone, true);
$oa = list_others_todos($admin);
check('業務のToDoの共有: 管理者にも、他の社員の業務のToDoが見える（持ち主の名前つき）', [array_column($oa['todos'], 'title'), array_unique(array_column($oa['todos'], 'owner_name'))], [['山田の業務ToDo', '鈴木の業務ToDo'], ['山田', '鈴木']] );
check('業務のToDoの共有: 完了したものも見える', array_column($oa['done'], 'title'), ['鈴木の完了済みToDo']);
check('業務のToDoの共有: プライベートのToDoは、誰にも見えない', in_array('山田のプライベートToDo', array_merge(array_column($oa['todos'], 'title'), array_column($oa['done'], 'title')), true), false);
check('業務のToDoの共有: プライベートのメモ（ひみつ）も、出てこない', strpos(json_encode($oa, JSON_UNESCAPED_UNICODE), 'ひみつ') === false, true);
$ob = list_others_todos($b);
check('業務のToDoの共有: 自分のToDoは「他の人」に含まれない', array_column($ob['todos'], 'title'), ['山田の業務ToDo']);
check('業務のToDoの共有: 見るだけ（editable=false・持ち主はそのまま）', [$ob['todos'][0]['editable'], $ob['todos'][0]['owner_id']], [false, (int)$a['id']]);
check('業務のToDoの共有: 他の人は、変更できない（持ち主だけが探せる）', [find_todo((int)$tdA1['id'], $b), (bool)find_todo((int)$tdA1['id'], $a)], [null, true]);
q('UPDATE users SET active = 0 WHERE id = ?', [(int)$b['id']]);
check('業務のToDoの共有: 利用停止の社員のToDoは、出ない', array_column(list_others_todos($a)['todos'], 'title'), []);
q('UPDATE users SET active = 1 WHERE id = ?', [(int)$b['id']]);
check('業務のToDoの共有: 自分のToDo一覧（list_todos）は、版ごとに、自分の分だけ', [array_column(list_todos($a, 'team'), 'title'), array_column(list_todos($a, 'me'), 'title')], [['山田の業務ToDo'], ['山田のプライベートToDo']]);


// ---- ToDoのコメント ----
check('ToDoのコメント: 他の社員も、業務のToDoを探せる', [(bool)todo_for_comments((int)$tdA1['id'], $b), (bool)todo_for_comments((int)$tdA1['id'], $admin)], [true, true]);
check('ToDoのコメント: プライベートのToDoは、他の人には見つからない（持ち主だけ）', [todo_for_comments((int)$tdA2['id'], $b), (bool)todo_for_comments((int)$tdA2['id'], $a)], [null, true]);
[$c1, $e1] = todo_comment_add(todo_for_comments((int)$tdA1['id'], $b), $b, "確認しました\n来週までに共有をお願いします");
check('ToDoのコメント: 持ち主以外が、コメントを付けられる', [$e1, $c1 !== null], [null, true]);
[$c2] = todo_comment_add(todo_for_comments((int)$tdA1['id'], $a), $a, '了解です');
check('ToDoのコメント: 持ち主も、返事を書ける', $c2 !== null, true);
$tl = todo_comments_list(todo_for_comments((int)$tdA1['id'], $a), $a);
check('ToDoのコメント: 古い順に並び、書いた人の名前・本文が付く', [array_column($tl, 'author_name'), strpos($tl[0]['body'], '来週') !== false], [['鈴木', '山田'], true]);
check('ToDoのコメント: 持ち主は全部消せる。書いた人は自分の分だけ。他の人は消せない', [$tl[0]['can_delete'], $tl[1]['can_delete'], array_column(todo_comments_list(todo_for_comments((int)$tdA1['id'], $b), $b), 'can_delete'), array_column(todo_comments_list(todo_for_comments((int)$tdA1['id'], $admin), $admin), 'can_delete')], [true, true, [true, false], [true, true]]);
[$cx, $ex] = todo_comment_add(todo_for_comments((int)$tdA2['id'], $a), $a, 'プライベートにコメント');
check('ToDoのコメント: プライベートのToDoには、付けられない', [$cx, $ex !== null], [null, true]);
check('ToDoのコメント: 空のコメントは、拒否', todo_comment_add(todo_for_comments((int)$tdA1['id'], $b), $b, "  \n ")[1] !== null, true);
check('ToDoのコメント: 500文字を超えたら、拒否', todo_comment_add(todo_for_comments((int)$tdA1['id'], $b), $b, str_repeat('あ', 501))[1] !== null, true);
check('ToDoのコメント: 500文字ちょうどは、OK', todo_comment_add(todo_for_comments((int)$tdA1['id'], $b), $b, str_repeat('あ', 500))[1], null);
$stat = todo_with_comment_stats([['id' => (int)$tdA1['id']], ['id' => (int)$tdB1['id']]]);
check('ToDoのコメント: 一覧に、コメントの数と、最新の番号が付く', [$stat[0]['comments'], $stat[0]['last_comment_id'] > 0, $stat[1]['comments']], [3, true, 0]);
check('ToDoのコメント: 他の社員の一覧（他の人のToDo）にも、数が付く', array_column(list_others_todos($b)['todos'], 'comments'), [3]);
check('ToDoのコメント: 削除できるのは、書いた人・持ち主・管理者だけ', [todo_comment_delete((int)$tl[0]['id'], $tmpUser), todo_comment_delete((int)$tl[0]['id'], $b), todo_comment_delete((int)$tl[1]['id'], $a)], [false, true, true]);
$cid = todo_comments_list(todo_for_comments((int)$tdA1['id'], $a), $a)[0]['id'];
check('ToDoのコメント: 管理者は、だれのコメントも消せる', todo_comment_delete((int)$cid, $admin), true);
todo_comment_add(todo_for_comments((int)$tdB1['id'], $a), $a, '鈴木さんのToDoへ');
set_todo_done(row('SELECT * FROM todos WHERE id = ?', [$tdB1['id']]), true);
clear_done_todos($b, 'team');
check('ToDoのコメント: ToDoを削除すると、コメントも消える（完了分の一括削除）', (int)row('SELECT COUNT(*) AS c FROM todo_comments WHERE todo_id = ?', [(int)$tdB1['id']])['c'], 0);
check('ToDoのコメント: バックアップに含まれる', isset(backup_collect()['tables']['todo_comments']), true);


// ---- コメントの画像 ----
define('ATTACH_TEST', true);
$mkImg = function (string $kind, int $w = 120, int $h = 80) use ($tmp) {
    $im = imagecreatetruecolor($w, $h); imagefill($im, 0, 0, imagecolorallocate($im, 30, 120, 220)); imagestring($im, 3, 5, 5, 'shot', imagecolorallocate($im, 255, 255, 255));
    $f = $tmp . '/img-' . uniqid() . '.' . $kind; ob_start();
    if ($kind === 'png') imagepng($im); elseif ($kind === 'jpg') imagejpeg($im); elseif ($kind === 'gif') imagegif($im); else imagewebp($im);
    file_put_contents($f, ob_get_clean()); imagedestroy($im);
    return ['name' => 'スクリーンショット.' . $kind, 'tmp_name' => $f, 'error' => UPLOAD_ERR_OK, 'size' => filesize($f)];
};
$thA = function (callable $fn) { try { $fn(); return null; } catch (AttachException $x) { return $x->getMessage(); } };
$pngP = attach_process($mkImg('png'));
check('画像: PNGは、PNGのまま受け取る（大きさも分かる）', [$pngP['mime'], $pngP['ext'], $pngP['w'], $pngP['h']], ['image/png', 'png', 120, 80]);
check('画像: JPEGは、JPEGのまま', attach_process($mkImg('jpg'))['mime'], 'image/jpeg');
check('画像: GIFは、PNGにそろえる（動かない1枚）', attach_process($mkImg('gif'))['mime'], 'image/png');
check('画像: WebPも受け取る', attach_process($mkImg('webp'))['mime'], 'image/webp');
$big = attach_process($mkImg('png', 4000, 1000));
check('画像: 長辺2000pxまで縮める（縦横の比率は保つ）', [$big['w'], $big['h']], [2000, 500]);
$txt = $tmp . '/fake.png'; file_put_contents($txt, '<?php echo "x";');
check('画像: 画像でないファイルは、拡張子が.pngでも拒否', $thA(function () use ($txt) { attach_process(['name' => 'fake.png', 'tmp_name' => $txt, 'error' => UPLOAD_ERR_OK, 'size' => 15]); }) !== null, true);
$svg = $tmp . '/a.svg'; file_put_contents($svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
check('画像: SVG（文字の中にスクリプトを入れられる）は、拒否', $thA(function () use ($svg) { attach_process(['name' => 'a.svg', 'tmp_name' => $svg, 'error' => UPLOAD_ERR_OK, 'size' => 100]); }) !== null, true);
$poly = $mkImg('png'); file_put_contents($poly['tmp_name'], file_get_contents($poly['tmp_name']) . '<?php system($_GET["c"]); ?>');
check('画像: 画像のうしろに仕込まれたPHPは、描き直しで消える', strpos(attach_process($poly)['data'], '<?php') === false, true);
check('画像: 送信エラー（サイズ超過）は、分かりやすい文言', strpos($thA(function () { attach_process(['name' => 'x.png', 'tmp_name' => '', 'error' => UPLOAD_ERR_INI_SIZE, 'size' => 0]); }), '大きすぎ') !== false, true);
// 保存・取得・削除
q('DELETE FROM todo_comment_files'); q('DELETE FROM todo_comments');
foreach (glob(attach_dir() . '/*') ?: [] as $f) { if (basename($f) !== '.htaccess') { @unlink($f); } }
$tdImg = save_todo(['title' => '画像つきToDo', 'kind' => 'work', 'tag' => '', 'note' => '', 'family_shared' => 0], $a, null);
[$cI] = todo_comment_add(todo_for_comments((int)$tdImg['id'], $b), $b, '', 1);
$fid = attach_store((int)$cI['id'], (int)$tdImg['id'], $pngP);
$stored = row('SELECT stored FROM todo_comment_files WHERE id = ?', [$fid])['stored'];
check('画像: 本文が空でも、画像があればコメントにできる', [$cI !== null, todo_comment_add(todo_for_comments((int)$tdImg['id'], $b), $b, '', 0)[1] !== null], [true, true]);
check('画像: 保存先に、ランダムな名前で置かれる（権限 600）', [(bool)preg_match('/^[a-f0-9]{32}\.png$/', $stored), is_file(attach_dir() . '/' . $stored), substr(sprintf('%o', fileperms(attach_dir() . '/' . $stored)), -3)], [true, true, '600']);
check('画像: 保存先は Web から見えない（.htaccess）', is_file(attach_dir() . '/.htaccess'), true);
check('画像: コメント一覧に、画像の情報が付く', todo_comments_list(todo_for_comments((int)$tdImg['id'], $a), $a)[0]['files'][0]['w'], 120);
check('画像: 見てよい社員（他の人・管理者）は、取り出せる', [(bool)attach_find($fid, $b), (bool)attach_find($fid, $admin), (bool)attach_find($fid, $a)], [true, true, true]);
$tdPriv = save_todo(['title' => '私用', 'kind' => 'private', 'tag' => '', 'note' => '', 'family_shared' => 0], $a, null);
q('UPDATE todo_comment_files SET todo_id = ? WHERE id = ?', [(int)$tdPriv['id'], $fid]);
check('画像: プライベートのToDoの画像は、他の人は取り出せない（持ち主だけ）', [attach_find($fid, $b), (bool)attach_find($fid, $a)], [null, true]);
q('UPDATE todo_comment_files SET todo_id = ? WHERE id = ?', [(int)$tdImg['id'], $fid]);
check('画像: 存在しない番号は null', attach_find(99999, $a), null);
check('画像: ファイルが無いときは、missing になる', (function () use ($fid, $stored, $a) { rename(attach_dir() . '/' . $stored, attach_dir() . '/tmp-moved'); $r = attach_find($fid, $a); rename(attach_dir() . '/tmp-moved', attach_dir() . '/' . $stored); return !empty($r['missing']); })(), true);
// 1つのToDoの上限
$cap = save_todo(['title' => '上限', 'kind' => 'work', 'tag' => '', 'note' => '', 'family_shared' => 0], $a, null);
for ($i = 0; $i < ATTACH_MAX_PER_TODO; $i++) { q('INSERT INTO todo_comment_files (comment_id, todo_id, name, mime, size, width, height, stored, created_at) VALUES (0,?,?,?,?,?,?,?,?)', [(int)$cap['id'], 'x', 'image/png', 1, 1, 1, str_repeat('0', 32) . '.png', now_str()]); }
check('画像: 1つのToDoに付けられるのは30枚まで', todo_comment_add(todo_for_comments((int)$cap['id'], $b), $b, 'もう1枚', 1)[1] !== null, true);
q('DELETE FROM todo_comment_files WHERE todo_id = ?', [(int)$cap['id']]);
// 削除で、ファイルも消える
todo_comment_delete((int)$cI['id'], $a);
check('画像: コメントを消すと、画像のファイルも消える', [is_file(attach_dir() . '/' . $stored), (int)row('SELECT COUNT(*) AS c FROM todo_comment_files WHERE id = ?', [$fid])['c']], [false, 0]);
[$cJ] = todo_comment_add(todo_for_comments((int)$tdImg['id'], $b), $b, 'もう一度', 1);
$fid2 = attach_store((int)$cJ['id'], (int)$tdImg['id'], $pngP); $stored2 = row('SELECT stored FROM todo_comment_files WHERE id = ?', [$fid2])['stored'];
todo_comments_purge('SELECT id FROM todos WHERE id = ?', [(int)$tdImg['id']]);
check('画像: ToDoを消す処理で、コメントと画像のファイルが消える', [is_file(attach_dir() . '/' . $stored2), (int)row('SELECT COUNT(*) AS c FROM todo_comments WHERE todo_id = ?', [(int)$tdImg['id']])['c']], [false, 0]);
check('画像: バックアップには含めない（画像のファイルは、サーバーの data/attachments/ にだけある）', isset(backup_collect()['tables']['todo_comment_files']), false);

// ---- 利用状況（管理者向け）----
q('UPDATE users SET last_login_at = NULL, last_seen_at = NULL');
$_SESSION = []; login_attempt('a@example.com', 'password1');
check('利用状況: ログインすると、最後にログインした日時が残る', [row('SELECT last_login_at FROM users WHERE id = ?', [$a['id']])['last_login_at'] !== null, row('SELECT last_login_at FROM users WHERE id = ?', [$b['id']])['last_login_at']], [true, null]);
$_SESSION = [];
$secretTodo = save_todo(['title' => '利用状況に出てはいけない私用の件名', 'kind' => 'private', 'tag' => '', 'note' => '', 'family_shared' => 0], $a, null);
$rep = usage_report();
$names = array_column($rep['users'], 'name');
check('利用状況: 社員の一覧に、最後にログインした日時が入る', [count($rep['users']) >= 2, array_key_exists('last_login', $rep['users'][0]), in_array($a['name'], $names, true)], [true, true, true]);
check('利用状況: 件名・本文などの中身は、含まれない', strpos(json_encode($rep, JSON_UNESCAPED_UNICODE), '利用状況に出てはいけない') === false, true);
$ws = array_column($rep['warnings'], 'text');
$has = function (array $w, string $needle): bool { foreach ($w as $x) { if (strpos($x, $needle) !== false) { return true; } } return false; };
check('利用状況: install.php が残っていると、注意に出る', $has($ws, 'install.php'), is_file(dirname(__DIR__) . '/public/install.php'));
check('利用状況: 自動バックアップが未設定だと、注意に出る', $has($ws, '自動バックアップが設定されていません'), true);
check('利用状況: cron の記録が無いと、「まだ記録がない」と知らせる（警告ではない）', [$has($ws, 'notify'), (function () use ($rep) { foreach ($rep['warnings'] as $x) { if (strpos($x['text'], 'notify') !== false) { return $x['level']; } } return null; })()], [true, 'info']);
usage_cron_mark('notify'); usage_cron_mark('nightly'); usage_cron_mark('bogus');
$rep2 = usage_report();
check('利用状況: cron が動いた印が残る（種類以外は無視）', [$rep2['cron']['notify'] !== null, $rep2['cron']['nightly'] !== null, backup_meta('cron_bogus_at')], [true, true, '']);
check('利用状況: cron が最近動いていれば、cron の注意は出ない', $has(array_column($rep2['warnings'], 'text'), '動いていません'), false);
$later = usage_report(time() + 7200);
check('利用状況: notify が1時間以上止まると、注意に出る', $has(array_column($later['warnings'], 'text'), 'notify）が、1時間以上動いていません'), true);
$much = usage_report(time() + 3 * 86400);
check('利用状況: nightly が1日半以上止まると、注意に出る', $has(array_column($much['warnings'], 'text'), 'nightly の cron）が、1日半以上'), true);
check('利用状況: 90日以上使っていない人が、注意に出る', $has(array_column(usage_report(time() + 100 * 86400)['warnings'], 'text'), '90日以上、使っていない'), true);
check('利用状況: 日数の計算（空・不正は null）', [usage_days_since(null), usage_days_since(''), usage_days_since('x'), usage_days_since('2026-01-01 00:00:00', strtotime('2026-01-04 12:00:00'))], [null, null, null, 3]);
check('利用状況: 大きさの表示', [usage_size(500), usage_size(5 * 1048576), usage_size(3 * 1073741824)], ['0 KB', '5 MB', '3 GB']);
backup_meta_set('backup_auto_pass', 'usagepass-1');
check('利用状況: 自動バックアップを設定すると、未設定の注意は消える', $has(array_column(usage_report()['warnings'], 'text'), '自動バックアップが設定されていません'), false);
backup_meta_set('backup_auto_err', now_str() . ' 失敗のテスト');
check('利用状況: 自動バックアップが失敗していると、注意に出る', $has(array_column(usage_report()['warnings'], 'text'), '自動バックアップが失敗しています'), true);
backup_meta_set('backup_auto_err', ''); backup_meta_set('backup_auto_pass', '');
q('UPDATE users SET must_change_password = 1 WHERE id = ?', [$b['id']]);
check('利用状況: 初回パスワード未変更の人が、注意に出る', $has(array_column(usage_report()['warnings'], 'text'), $b['name']), true);
q('UPDATE users SET must_change_password = 0 WHERE id = ?', [$b['id']]);
q('DELETE FROM todos WHERE id = ?', [$secretTodo['id']]);

// ---- カレンダーの予定を、ToDoリストにも入れる ----
$mkEv = function (array $over, array $user) { [$d, $e] = validate_event_input($over + ['kind' => 'work', 'title' => 'カレンダーで作った予定', 'tag' => '個人作業', 'start' => '2026-11-10', 'end' => '2026-11-10', 'start_time' => '', 'end_time' => '', 'note' => 'メモ', 'important' => 0], $user); return save_event($d, $user, null); };
$evA = $mkEv([], $a);
$tdA = event_attach_todo($evA, $a, 'doing');
check('予定→ToDo: 進行中で入れると、ToDoができる（件名・種類・分類・メモが同じ）', [$tdA['title'], $tdA['kind'], $tdA['tag'], $tdA['note'], (int)$tdA['doing'], $tdA['done_at']], ['カレンダーで作った予定', 'work', '個人作業', 'メモ', 1, null]);
check('予定→ToDo: 予定とToDoが結びつく', (int)row('SELECT todo_id FROM events WHERE id = ?', [$evA['id']])['todo_id'], (int)$tdA['id']);
$evShown = array_values(array_filter(list_events($a, '2026-11-01', '2026-11-30', 'team'), function ($x) use ($evA) { return $x['id'] === (int)$evA['id']; }))[0] ?? null;
check('予定→ToDo: 予定に、ToDoの状態（進行中）が付く', [$evShown['todo_id'] ?? null, $evShown['todo_status'] ?? null, $evShown['done'] ?? null], [(int)$tdA['id'], 'doing', false]);
check('予定→ToDo: すでに結びついた予定には、もう一度は作らない', event_attach_todo(row('SELECT * FROM events WHERE id = ?', [$evA['id']]), $a, 'todo'), null);
$evDone = $mkEv(['title' => '完了で入れる予定'], $a);
$tdDone = event_attach_todo($evDone, $a, 'done');
check('予定→ToDo: 完了で入れると、ToDoは完了（予定は取り消し線）', [$tdDone['done_at'] !== null, array_values(array_filter(list_events($a, '2026-11-01', '2026-11-30', 'team'), function ($x) use ($evDone) { return $x['id'] === (int)$evDone['id']; }))[0]['done']], [true, true]);
$evTodo = $mkEv(['title' => '未着手で入れる予定'], $a);
$tdTodo = event_attach_todo($evTodo, $a, 'todo');
check('予定→ToDo: 未着手で入れる', [(int)$tdTodo['doing'], $tdTodo['done_at']], [0, null]);
$evPriv = $mkEv(['kind' => 'private', 'title' => '私用の予定', 'tag' => ''], $a);
$tdPriv2 = event_attach_todo($evPriv, $a, 'doing');
check('予定→ToDo: プライベートの予定は、プライベートのToDoになる', [$tdPriv2['kind'], $tdPriv2['tag']], ['private', '']);
$evOff = $mkEv(['kind' => 'off', 'title' => '', 'tag' => '有給'], $a);
check('予定→ToDo: 休みは入れられない', event_attach_todo($evOff, $a, 'doing'), null);
check('予定→ToDo: 状態が空・不正なら、入れない', [event_attach_todo($mkEv(['title' => 'x1'], $a), $a, ''), event_attach_todo($mkEv(['title' => 'x2'], $a), $a, 'bogus')], [null, null]);
$evB = $mkEv(['title' => '他の人の予定'], $b);
check('予定→ToDo: 他の人の予定は、入れられない', event_attach_todo($evB, $a, 'doing'), null);
$evSeries = $mkEv(['title' => '繰り返しの回'], $a); q('UPDATE events SET series_id = 999 WHERE id = ?', [$evSeries['id']]);
$tdSeries = event_attach_todo(row('SELECT * FROM events WHERE id = ?', [$evSeries['id']]), $a, 'doing');
check('予定→ToDo: 繰り返しから作られた予定も、その回だけToDoにできる（完了にすると、その回だけ取り消し線）', [$tdSeries['title'], (int)row('SELECT todo_id FROM events WHERE id = ?', [$evSeries['id']])['todo_id'] === (int)$tdSeries['id']], ['繰り返しの回', true]);
set_todo_status($tdSeries, 'done');
check('予定→ToDo: 繰り返しの回の、予定側の「完了」', array_values(array_filter(list_events($a, '2026-11-01', '2026-11-30', 'team'), function ($x) use ($evSeries) { return $x['id'] === (int)$evSeries['id']; }))[0]['done'], true);
check('予定→ToDo: 繰り返しの回は、「ToDoに戻す」はできない（予定が消えるため）', (function () use ($evSeries, $a) { try { event_to_todo(row('SELECT * FROM events WHERE id = ?', [$evSeries['id']]), $a); return 'ok'; } catch (RuntimeException $x) { return 'refused'; } })(), 'refused');
q('DELETE FROM todos WHERE id = ?', [$tdSeries['id']]);
q('UPDATE events SET todo_id = NULL WHERE owner_id IN (?, ?)', [$a['id'], $b['id']]);
q('DELETE FROM events WHERE title IN (?,?,?,?,?,?,?,?)', ['カレンダーで作った予定', '完了で入れる予定', '未着手で入れる予定', '私用の予定', '他の人の予定', '繰り返しの回', 'x1', 'x2']);
q('DELETE FROM todos WHERE title IN (?,?,?,?)', ['カレンダーで作った予定', '完了で入れる予定', '未着手で入れる予定', '私用の予定']);

// ---- 予定とToDoの件名の同期・ToDoの期限日 ----
$sy = $mkEv(['title' => '同期の元の予定', 'note' => '元のメモ'], $a);
$syTodo = event_attach_todo($sy, $a, 'doing');
$sy2 = row('SELECT * FROM events WHERE id = ?', [$sy['id']]);
[$dd, $de] = validate_event_input(['id' => $sy['id'], 'kind' => 'work', 'title' => '直した件名', 'tag' => '個人作業', 'start' => '2026-11-10', 'end' => '2026-11-10', 'note' => '直したメモ'], $a);
$syNew = save_event($dd, $a, $sy2);
check('同期: 予定を編集しても、ToDoとの結びつきは残る', (int)($syNew['todo_id'] ?? 0), (int)$syTodo['id']);
event_sync_todo($syNew);
$t1 = row('SELECT * FROM todos WHERE id = ?', [$syTodo['id']]);
check('同期: 予定の件名・メモを直すと、ToDoの件名・メモも変わる（状態は変わらない）', [$t1['title'], $t1['note'], (int)$t1['doing']], ['直した件名', '直したメモ', 1]);
[$td2, $te2] = validate_todo_input(['kind' => 'work', 'title' => 'ToDo側で直した件名', 'tag' => '個人作業', 'note' => 'ToDo側のメモ', 'due' => '2026-12-01']);
save_todo($td2, $a, $t1);
$e1 = row('SELECT * FROM events WHERE id = ?', [$sy['id']]);
check('同期: ToDoの件名・メモを直すと、予定の件名・メモも変わる', [$e1['title'], $e1['note']], ['ToDo側で直した件名', 'ToDo側のメモ']);
check('期限日: 保存できて、一覧に出る', [row('SELECT due_date FROM todos WHERE id = ?', [$syTodo['id']])['due_date'], todo_for_client(row('SELECT * FROM todos WHERE id = ?', [$syTodo['id']]))['due']], ['2026-12-01', '2026-12-01']);
[$td3] = validate_todo_input(['kind' => 'work', 'title' => 'ToDo側で直した件名', 'tag' => '個人作業', 'note' => 'ToDo側のメモ']);
save_todo($td3, $a, row('SELECT * FROM todos WHERE id = ?', [$syTodo['id']]));
check('期限日: 送られてこなければ、いまの期限日を変えない', row('SELECT due_date FROM todos WHERE id = ?', [$syTodo['id']])['due_date'], '2026-12-01');
[$td4] = validate_todo_input(['kind' => 'work', 'title' => 'ToDo側で直した件名', 'tag' => '個人作業', 'note' => 'ToDo側のメモ', 'due' => '']);
save_todo($td4, $a, row('SELECT * FROM todos WHERE id = ?', [$syTodo['id']]));
check('期限日: 空で送ると、期限なしにできる', row('SELECT due_date FROM todos WHERE id = ?', [$syTodo['id']])['due_date'], null);
check('期限日: 日付でない値は、断る', validate_todo_input(['kind' => 'work', 'title' => 'x', 'due' => '2026-13-45'])[1], '期限日を正しく入力してください。');
$newTd = save_todo(validate_todo_input(['kind' => 'work', 'title' => '期限つきで作る', 'tag' => '個人作業', 'due' => '2026-11-30'])[0], $a, null);
check('期限日: 新しく作るときにも付けられる', row('SELECT due_date FROM todos WHERE id = ?', [$newTd['id']])['due_date'], '2026-11-30');
// 予定を「休み」に変えると、結びつきが外れる
$offSrc = row('SELECT * FROM events WHERE id = ?', [$sy['id']]);
q('UPDATE events SET kind = ?, tag = ? WHERE id = ?', ['off', '有給', $sy['id']]);
event_sync_todo(row('SELECT * FROM events WHERE id = ?', [$sy['id']]));
check('同期: 予定を休みに変えると、ToDoとの結びつきが外れる（ToDoは残る）', [row('SELECT todo_id FROM events WHERE id = ?', [$sy['id']])['todo_id'], (int)row('SELECT COUNT(*) AS c FROM todos WHERE id = ?', [$syTodo['id']])['c']], [null, 1]);
q('UPDATE events SET todo_id = NULL WHERE owner_id = ?', [$a['id']]);
q('DELETE FROM events WHERE id = ?', [$sy['id']]);
q('DELETE FROM todos WHERE id IN (?, ?)', [$syTodo['id'], $newTd['id']]);

// 繰り返しの回に結びついたToDoは、ルールの件名変更に追従する
q('INSERT INTO series (owner_id,title,tag,rule_type,p_day,p_day2,p_nth,p_weekday,p_count,shift,bizonly,start_time,end_time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [$a['id'], '追従の元の件名', '定例業務', 'day', 20, null, null, null, null, 'prev', 0, '', '', now_str()]);
$serId = (int)db()->lastInsertId();
materialize_series($serId);
$occ = row('SELECT * FROM events WHERE series_id = ? ORDER BY start_date LIMIT 1', [$serId]);
$occTodo = event_attach_todo($occ, $a, 'doing');
q('UPDATE series SET title = ? WHERE id = ?', ['追従した件名', $serId]);
materialize_series($serId);
check('繰り返し: ルールの件名を変えると、その回のToDoの件名も変わる', [row('SELECT title FROM events WHERE id = ?', [$occ['id']])['title'], row('SELECT title FROM todos WHERE id = ?', [$occTodo['id']])['title']], ['追従した件名', '追従した件名']);
delete_series($serId);
q('DELETE FROM events WHERE todo_id = ?', [$occTodo['id']]); q('DELETE FROM todos WHERE id = ?', [$occTodo['id']]);

// ---- 繰り返し業務の「毎回ToDoにも入れる」----
q('INSERT INTO series (owner_id,title,tag,rule_type,p_day,p_day2,p_nth,p_weekday,p_count,shift,bizonly,start_time,end_time,todo_auto,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [$a['id'], '毎月の自動ToDo', '定例業務', 'day', (int)date('j', strtotime('+3 days')) , null, null, null, null, 'none', 0, '', '', 1, now_str()]);
$sidA = (int)db()->lastInsertId();
materialize_series($sidA);
$autoTodos = rows("SELECT t.* FROM todos t JOIN events e ON e.todo_id = t.id WHERE e.series_id = ? ORDER BY e.start_date", [$sidA]);
check('自動ToDo: 実施日が2週間以内の回だけ、ToDoができる（12か月分は並ばない）', count($autoTodos) <= 2 && count($autoTodos) >= 1, true);
$firstAuto = $autoTodos[0];
check('自動ToDo: 未着手で、件名・分類は、ルールと同じ。期限日は、その回の日付', [$firstAuto['title'], $firstAuto['tag'], (int)$firstAuto['doing'], $firstAuto['done_at'], $firstAuto['due_date'] === row('SELECT end_date FROM events WHERE todo_id = ?', [$firstAuto['id']])['end_date']], ['毎月の自動ToDo', '定例業務', 0, null, true]);
check('自動ToDo: 何度呼んでも、増えない', [series_make_todos($sidA), count(rows('SELECT 1 FROM events WHERE series_id = ? AND todo_id IS NOT NULL', [$sidA]))], [0, count($autoTodos)]);
q('DELETE FROM todos WHERE id = ?', [$firstAuto['id']]); q('UPDATE events SET todo_id = NULL WHERE todo_id = ?', [$firstAuto['id']]);
check('自動ToDo: 作ったあとにToDoを消しても、作り直さない', series_make_todos($sidA), 0);
q('UPDATE series SET todo_auto = 0 WHERE id = ?', [$sidA]); q('UPDATE events SET todo_made = 0 WHERE series_id = ?', [$sidA]);
check('自動ToDo: 「毎回ToDoにも入れる」を切ると、作られない', series_make_todos($sidA), 0);
q('UPDATE series SET todo_auto = 1 WHERE id = ?', [$sidA]);
q('UPDATE series SET p_day = ? WHERE id = ?', [(int)date('j', strtotime('+4 days')), $sidA]);
materialize_series($sidA);
$moved = row("SELECT t.due_date, e.end_date FROM todos t JOIN events e ON e.todo_id = t.id WHERE e.series_id = ? LIMIT 1", [$sidA]);
check('自動ToDo: ルールの日付を変えると、未完了のToDoの期限日も、その回の日付に動く', $moved['due_date'], $moved['end_date']);
$notStarted = (int)row("SELECT COUNT(*) AS c FROM todos t JOIN events e ON e.todo_id = t.id WHERE e.series_id = ?", [$sidA])['c'];
$started = row("SELECT t.* FROM todos t JOIN events e ON e.todo_id = t.id WHERE e.series_id = ? LIMIT 1", [$sidA]);
set_todo_status($started, 'doing');
delete_series($sidA);
check('自動ToDo: ルールを消すと、手を付けていないToDoは消え、進行中のものは残る', [$notStarted >= 1, (int)row('SELECT COUNT(*) AS c FROM todos WHERE id = ?', [$started['id']])['c'], (int)row("SELECT COUNT(*) AS c FROM todos WHERE title = '毎月の自動ToDo' AND doing = 0 AND done_at IS NULL")['c']], [true, 1, 0]);
q('DELETE FROM todos WHERE title = ?', ['毎月の自動ToDo']); q('DELETE FROM events WHERE title = ?', ['毎月の自動ToDo']);

// ---- 「元に戻す」----
$_SESSION = [];
$ue = $mkEv(['title' => '消して戻す予定', 'note' => '戻すメモ', 'important' => 1], $a);
$ueId = (int)$ue['id'];
$tok = undo_stash('event', row('SELECT * FROM events WHERE id = ?', [$ueId])); delete_event(row('SELECT * FROM events WHERE id = ?', [$ueId]));
check('元に戻す: 消した予定は、なくなる', row('SELECT 1 AS x FROM events WHERE id = ?', [$ueId]), null);
$snapE = undo_take($tok, 'event');
check('元に戻す: 控えを取り出せる（1度きり）', [$snapE !== null, undo_take($tok, 'event')], [true, null]);
$back = undo_event_restore($snapE, $a);
check('元に戻す: 元の番号・件名・メモ・重要のまま戻る', [(int)$back['id'], $back['title'], $back['note'], (int)$back['important']], [$ueId, '消して戻す予定', '戻すメモ', 1]);
check('元に戻す: すでにある予定は、重ねて戻せない', (function () use ($snapE, $a) { try { undo_event_restore($snapE, $a); return 'ok'; } catch (RuntimeException $x) { return 'refused'; } })(), 'refused');
check('元に戻す: 他の人の控えの種類違い・不正なトークンは、取り出せない', [undo_take('bogus', 'event'), undo_take(undo_stash('todo', ['x' => 1]), 'event')], [null, null]);
$tokB = undo_stash('event', row('SELECT * FROM events WHERE id = ?', [$ueId])); delete_event(row('SELECT * FROM events WHERE id = ?', [$ueId]));
check('元に戻す: 他の人（一般の社員）は、他人の予定を戻せない', (function () use ($tokB, $b) { try { undo_event_restore(undo_take($tokB, 'event'), $b); return 'ok'; } catch (RuntimeException $x) { return 'refused'; } })(), 'refused');
// 繰り返しの1回分
q('INSERT INTO series (owner_id,title,tag,rule_type,p_day,p_day2,p_nth,p_weekday,p_count,shift,bizonly,start_time,end_time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [$a['id'], '戻す繰り返し', '定例業務', 'day', 20, null, null, null, null, 'none', 0, '', '', now_str()]);
$usid = (int)db()->lastInsertId(); materialize_series($usid);
$occ = row('SELECT * FROM events WHERE series_id = ? ORDER BY start_date LIMIT 1', [$usid]);
$tokS = undo_stash('event', $occ); delete_event($occ);
check('元に戻す（繰り返しの回）: 消すと「この回を消した」記録ができる', (int)row('SELECT COUNT(*) AS c FROM series_skips WHERE series_id = ? AND ym = ?', [$usid, $occ['ym']])['c'], 1);
undo_event_restore(undo_take($tokS, 'event'), $a);
check('元に戻す（繰り返しの回）: 戻すと、記録も外れて、次の自動作成でも消えない', [(int)row('SELECT COUNT(*) AS c FROM series_skips WHERE series_id = ? AND ym = ?', [$usid, $occ['ym']])['c'], (int)row('SELECT COUNT(*) AS c FROM events WHERE id = ?', [$occ['id']])['c'], (materialize_series($usid) >= 0 ? (int)row('SELECT COUNT(*) AS c FROM events WHERE id = ?', [$occ['id']])['c'] : 0)], [0, 1, 1]);
delete_series($usid); q('DELETE FROM events WHERE series_id IS NULL AND title IN (?, ?)', ['戻す繰り返し', '消して戻す予定']);
// ToDo
$ut = save_todo(validate_todo_input(['kind' => 'work', 'title' => '消して戻すToDo', 'tag' => '個人作業', 'due' => '2026-12-05'])[0], $a, null);
$utEv = $mkEv(['title' => 'ToDoと結んだ予定'], $a); q('UPDATE events SET todo_id = ? WHERE id = ?', [$ut['id'], $utEv['id']]);
$tokT = undo_stash('todo', ['todo' => $ut, 'events' => [(int)$utEv['id']]]);
todo_detach_events('SELECT id FROM todos WHERE id = ?', [$ut['id']]); q('DELETE FROM todos WHERE id = ?', [$ut['id']]);
$tb = undo_todo_restore(undo_take($tokT, 'todo'), $a);
check('元に戻す（ToDo）: 元の番号・期限日のまま戻り、結びついた予定も結び直る', [(int)$tb['id'], $tb['due_date'], (int)row('SELECT todo_id FROM events WHERE id = ?', [$utEv['id']])['todo_id']], [(int)$ut['id'], '2026-12-05', (int)$ut['id']]);
check('元に戻す（ToDo）: 他の人は戻せない', (function () use ($ut, $b) { try { undo_todo_restore(['todo' => $ut, 'events' => []], $b); return 'ok'; } catch (RuntimeException $x) { return 'refused'; } })(), 'refused');
q('UPDATE events SET todo_id = NULL WHERE id = ?', [$utEv['id']]); q('DELETE FROM events WHERE id = ?', [$utEv['id']]); q('DELETE FROM todos WHERE id = ?', [$ut['id']]);
// 期限切れ
$_SESSION['undo'] = [undo_stash('event', ['x' => 1]) => ['type' => 'event', 'at' => time() - 7200, 'data' => ['x' => 1]]];
check('元に戻す: 10分を過ぎた控えは、使えない', undo_take(array_key_first($_SESSION['undo']), 'event'), null);
$_SESSION = [];

// ---- カレンダー購読（ICS）----
$icPriv = $mkEv(['kind' => 'private', 'title' => '購読のひみつ予定', 'tag' => '', 'note' => 'ひみつのメモ'], $a);
$icWork = $mkEv(['title' => '購読の業務,会議;大事', 'tag' => '打ち合わせ', 'start' => '2026-11-12', 'end' => '2026-11-12', 'start_time' => '09:30', 'end_time' => '10:30', 'note' => "1行目\n2行目", 'important' => 1], $a);
$icOff = $mkEv(['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => '2026-11-13', 'end' => '2026-11-14'], $a);
$icShared = $mkEv(['title' => '家族に見せる業務', 'tag' => '個人作業', 'family_shared' => 1], $a); q('UPDATE events SET family_shared = 1 WHERE id = ?', [$icShared['id']]);
q('UPDATE events SET family_shared = 0 WHERE id = ?', [$icPriv['id']]); // 家族には、見せない（プライベートは、初期値が「共有」なので、外す）
$icA = ical_link_create('me', $a); $icFam = ical_link_create('family', $a);
check('ICS: 作ったURLは、48文字の合言葉。作り直すと、変わる', [strlen($icA['token']), ical_link_create('me', $a)['token'] !== $icA['token']], [48, true]);
$icA = ical_link_get('me', $a);
check('ICS: 会社用は、管理者だけが作れる', (function () use ($a) { try { ical_link_create('company', $a); return 'ok'; } catch (RuntimeException $x) { return 'refused'; } })(), 'refused');
$icCo = ical_link_create('company', $admin);
$linkMe = ical_link_find($icA['token']);
$ics = ical_render($linkMe, strtotime('2026-11-01 12:00:00'));
check('ICS: 先頭と末尾・改行は CRLF', [strpos($ics, "BEGIN:VCALENDAR\r\n") === 0, substr($ics, -15) === "END:VCALENDAR\r\n", strpos(str_replace("\r\n", '', $ics), "\n") === false], [true, true, true]);
check('ICS（自分用）: プライベートの予定も入る', [strpos($ics, 'SUMMARY:購読のひみつ予定') !== false, strpos($ics, 'ひみつのメモ') !== false], [true, true]);
check('ICS: 時刻のある予定は、UTCに直る（09:30 JST → 00:30Z）。終日は DATE で、終了は翌日', [strpos($ics, 'DTSTART:20261112T003000Z') !== false, strpos($ics, 'DTEND:20261112T013000Z') !== false, strpos($ics, 'DTSTART;VALUE=DATE:20261113') !== false, strpos($ics, 'DTEND;VALUE=DATE:20261115') !== false], [true, true, true, true]);
check('ICS: カンマ・セミコロン・改行は、エスケープされる。重要は ★', [strpos(str_replace("\r\n ", '', $ics), 'SUMMARY:★ 購読の業務\\,会議\;大事') !== false, strpos(str_replace("\r\n ", '', $ics), 'DESCRIPTION:1行目\\n2行目') !== false], [true, true]);
check('ICS: 休みは「休み（有給）」で、予定としては空き（TRANSPARENT）', [strpos($ics, 'SUMMARY:休み（有給）') !== false, strpos($ics, 'TRANSP:TRANSPARENT') !== false], [true, true]);
check('ICS（自分用）: 時刻のある業務には、15分前の通知が付く', strpos($ics, 'TRIGGER:-PT15M') !== false, true);
$tooLong = true; foreach (explode("\r\n", $ics) as $ln) { if (strlen($ln) > 75) { $tooLong = false; } }
check('ICS: どの行も75バイト以内（長い行は折り返す）', $tooLong, true);
$longEv = $mkEv(['title' => str_repeat('長い件名あいうえお', 8), 'start' => '2026-11-20', 'end' => '2026-11-20'], $a);
$ics2 = ical_render($linkMe, strtotime('2026-11-01 12:00:00'));
$tooLong = true; foreach (explode("\r\n", $ics2) as $ln) { if (strlen($ln) > 75) { $tooLong = false; } }
check('ICS: 長い日本語の件名も、折り返して、元に戻せる（UTF-8の途中で切らない）', [$tooLong, strpos(str_replace("\r\n ", '', $ics2), 'SUMMARY:' . str_repeat('長い件名あいうえお', 8)) !== false], [true, true]);
$icsFam = ical_render(ical_link_find($icFam['token']), strtotime('2026-11-01 12:00:00'));
check('ICS（家族用）: 共有した予定だけ。業務の件名・メモは、共有にしていないものは出ない', [strpos($icsFam, '家族に見せる業務') !== false, strpos($icsFam, '購読の業務') === false, strpos($icsFam, 'ひみつのメモ') === false], [true, true, true]);
$icsCo = ical_render(ical_link_find($icCo['token']), strtotime('2026-11-01 12:00:00'));
check('ICS（会社用）: 業務と休みだけ。プライベートは入らない。誰の予定かが先頭に付く', [strpos($icsCo, '購読のひみつ予定') === false, strpos($icsCo, 'ひみつのメモ') === false, strpos($icsCo, $a['name'] . '　') !== false, strpos($icsCo, '購読の業務') !== false], [true, true, true, true]);
check('ICS: 共有ページ用の合言葉では、購読できない。購読用の合言葉では、共有ページを開けない', [ical_link_find(share_link_create('family', $a)['token']), share_link_find($icA['token'])], [null, null]);
check('ICS: でたらめ・短い合言葉は、無効', [ical_link_find('abc'), ical_link_find(str_repeat('0', 48))], [null, null]);
q('UPDATE users SET active = 0 WHERE id = ?', [$a['id']]);
check('ICS: 持ち主が利用停止になると、購読できなくなる', [ical_link_find($icA['token']), ical_link_find($icFam['token'])], [null, null]);
q('UPDATE users SET active = 1 WHERE id = ?', [$a['id']]);
ical_link_revoke('me', $a);
check('ICS: 止めると、そのURLでは取り込めない', ical_link_find($icA['token']), null);
check('ICS: 一覧（画面用）に、自分用・家族用が出る（管理者は会社用も）', [count(ical_links_for($a)), count(ical_links_for($admin))], [2, 3]);
share_link_revoke('family', $a); ical_link_revoke('family', $a); ical_link_revoke('company', $admin);
q('DELETE FROM events WHERE title IN (?,?,?,?,?) OR title LIKE ?', ['購読のひみつ予定', '購読の業務,会議;大事', '', '家族に見せる業務', str_repeat('長い件名あいうえお', 8), '%長い件名%']);

// ---- 毎週・隔週の繰り返し ----
$calW = BizCalendar::fromDb();
$wk = ['rule_type' => 'weekly', 'title' => '週次定例', 'tag' => '全体会議', 'p_weekday' => 1, 'p_interval' => 1, 'p_anchor' => date('Y-m-01'), 'shift' => 'none', 'start_time' => '10:00', 'end_time' => '11:00', 'p_day' => null, 'p_day2' => null, 'p_nth' => null, 'p_count' => null, 'bizonly' => 0];
$pv = series_preview($wk, 2, $calW);
$allMon = true; foreach ($pv as $x) { if ((int)date('w', strtotime($x['start'])) !== 1) { $allMon = false; } }
check('毎週: 毎週月曜（今月の初めから2か月先の月末まで）。全部月曜で、7日おき', [$allMon, count($pv) >= 8, (strtotime($pv[1]['start']) - strtotime($pv[0]['start'])) / 86400], [true, true, 7]);
check('毎週: 印（ym）は日付', preg_match('/^\d{4}-\d{2}-\d{2}$/', $pv[0]['ym']) === 1, true);
$bi = series_preview($wk + [], 2, $calW); $wk2 = $wk; $wk2['p_interval'] = 2; $pv2 = series_preview($wk2, 2, $calW);
check('隔週: 14日おき', (strtotime($pv2[1]['start']) - strtotime($pv2[0]['start'])) / 86400, 14);
$wk3 = $wk2; $wk3['p_anchor'] = date('Y-m-d', strtotime($pv2[0]['start'] . ' +7 days')); $pv3 = series_preview($wk3, 2, $calW);
check('隔週: 数え始める週をずらすと、1週間ずれる', (strtotime($pv3[0]['start']) - strtotime($pv2[0]['start'])) / 86400 % 14, 7);
$wk4 = $wk; $wk4['p_anchor'] = date('Y-m-d', strtotime('+40 days')); $pv4 = series_preview($wk4, 2, $calW);
check('毎週: 数え始める日が先なら、その日以降だけ', $pv4[0]['start'] >= $wk4['p_anchor'], true);
check('毎週: ラベル', [rule_label($wk), rule_label(array_merge($wk2, ['p_anchor' => '2026-11-02']))], ['毎週 月曜日', '隔週 月曜日（11/2 の週から）']);
// 休日ずらし（会社の休業日を月曜に置く）
$monDay = $pv[count($pv) - 1]['start']; q('INSERT INTO company_holidays (hdate, name) VALUES (?, ?)', [$monDay, '会社休業']);
$calH = BizCalendar::fromDb();
$wkP = $wk; $wkP['shift'] = 'next'; $pvP = series_preview($wkP, 2, $calH); $lastP = $pvP[count($pvP) - 1];
$wkN = $wk; $pvN = series_preview($wk, 2, $calH);
check('毎週: 休業日の月曜は、「翌営業日」でずらせる（印は元の日付のまま）。「ずらさない」ならそのまま', [$lastP['ym'], $lastP['start'] > $monDay, $pvN[count($pvN) - 1]['start']], [$monDay, true, $monDay]);
q('DELETE FROM company_holidays WHERE hdate = ?', [$monDay]);
// 展開
q('INSERT INTO series (owner_id,title,tag,rule_type,p_weekday,p_interval,p_anchor,shift,start_time,end_time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [$a['id'], '週次の展開テスト', '全体会議', 'weekly', 3, 1, date('Y-m-01'), 'none', '', '', now_str()]);
$wsid = (int)db()->lastInsertId();
$made = materialize_series($wsid);
$evs = rows('SELECT * FROM events WHERE series_id = ? ORDER BY start_date', [$wsid]);
check('毎週: 展開すると、毎週水曜の予定が、たくさんできる（12か月分）', [count($evs) >= 50, (int)date('w', strtotime($evs[0]['start_date']))], [true, 3]);
check('毎週: 何度展開しても、増えない', [materialize_series($wsid), count(rows('SELECT 1 FROM events WHERE series_id = ?', [$wsid]))], [0, count($evs)]);
// 1回分を消す → 復活しない。元に戻す → 戻る
$one = $evs[5]; $tokW = undo_stash('event', $one); delete_event($one);
check('毎週: 1回分を消しても、次の展開で復活しない（日付の印で記録）', [materialize_series($wsid), (int)row('SELECT COUNT(*) AS c FROM events WHERE id = ?', [$one['id']])['c'], (int)row('SELECT COUNT(*) AS c FROM series_skips WHERE series_id = ? AND ym = ?', [$wsid, $one['ym']])['c']], [0, 0, 1]);
undo_event_restore(undo_take($tokW, 'event'), $a);
check('毎週: 「元に戻す」で、その回が戻り、消した記録も外れる', [(int)row('SELECT COUNT(*) AS c FROM events WHERE id = ?', [$one['id']])['c'], (int)row('SELECT COUNT(*) AS c FROM series_skips WHERE series_id = ? AND ym = ?', [$wsid, $one['ym']])['c']], [1, 0]);
// 自分が休みの日の回は作らない
$leaveDay = $evs[8]['start_date'];
$offId = (int)$mkEv(['kind' => 'off', 'title' => '', 'tag' => '有給', 'start' => $leaveDay, 'end' => $leaveDay], $a)['id'];
rematerialize_owner((int)$a['id']);
check('毎週: 自分が休みの日の回は、作られない（別の日へも動かない）', (int)row('SELECT COUNT(*) AS c FROM events WHERE series_id = ? AND start_date = ?', [$wsid, $leaveDay])['c'], 0);
q('DELETE FROM events WHERE id = ?', [$offId]); rematerialize_owner((int)$a['id']);
check('毎週: 休みを消すと、その回が戻る', (int)row('SELECT COUNT(*) AS c FROM events WHERE series_id = ? AND start_date = ?', [$wsid, $leaveDay])['c'], 1);
// 曜日を変えると、今日以降の回は新しい曜日に（古い曜日の回は消える）
q('UPDATE series SET p_weekday = 5 WHERE id = ?', [$wsid]); materialize_series($wsid);
$today = date('Y-m-d'); $wrong = (int)row("SELECT COUNT(*) AS c FROM events WHERE series_id = ? AND start_date >= ? AND start_date IS NOT NULL", [$wsid, $today])['c'];
$fridays = true; foreach (rows('SELECT start_date FROM events WHERE series_id = ? AND start_date >= ?', [$wsid, $today]) as $r) { if ((int)date('w', strtotime($r['start_date'])) !== 5) { $fridays = false; } }
check('毎週: 曜日を変えると、今日以降の回は、全部新しい曜日になる（古い曜日は残らない）', [$fridays, $wrong >= 40], [true, true]);
// 毎回ToDoにも入れる（毎週）
q('UPDATE series SET todo_auto = 1 WHERE id = ?', [$wsid]); series_make_todos($wsid);
check('毎週 × ToDo連動: 2週間以内の回だけ ToDo ができる（1〜3件）', (int)row('SELECT COUNT(*) AS c FROM events WHERE series_id = ? AND todo_id IS NOT NULL', [$wsid])['c'] >= 1 && (int)row('SELECT COUNT(*) AS c FROM events WHERE series_id = ? AND todo_id IS NOT NULL', [$wsid])['c'] <= 3, true);
delete_series($wsid); q('DELETE FROM todos WHERE title = ?', ['週次の展開テスト']); q('DELETE FROM events WHERE title = ?', ['週次の展開テスト']);
check('毎週: 入力の検証（曜日が無い・数え始める日が不正は断る）', [validate_series_input(['rule_type' => 'weekly', 'title' => 'x'])[1], validate_series_input(['rule_type' => 'weekly', 'title' => 'x', 'p_weekday' => 1, 'p_anchor' => '2026-13-40'])[1], validate_series_input(['rule_type' => 'weekly', 'title' => 'x', 'p_weekday' => 2, 'p_interval' => 9])[0]['p_interval']], ['曜日を選んでください。', '数え始める日を正しく入力してください。', 1]);

// ---- 会議室の予約 ----
$rms = rooms_all();
check('会議室: 初めから、会議室（6名）と応接室（3名）が入っている。設備は入っていない', [count($rms), $rms[0]['name'], (int)$rms[0]['capacity'], $rms[1]['name'], (int)$rms[1]['capacity'], $rms[0]['equipment'] . $rms[1]['equipment']], [2, '会議室', 6, '応接室', 3, '']);
$rA = (int)$rms[0]['id']; $rB = (int)$rms[1]['id'];
$rn = strtotime('2031-03-12 10:00:00'); // 水曜日の10:00 を「いま」にして確かめる
$rin = function (array $o = []) use ($rA) { return array_merge(['room_id' => $rA, 'date' => '2031-03-13', 'start' => '10:00', 'end' => '12:00', 'title' => '安全衛生委員会', 'kind' => 'committee', 'pax' => 6, 'private' => false], $o); };
$rv = function (array $o, $u = null, $ex = null) use ($rin, $a, $rn) { return rooms_validate_input($rin($o), $u ?? $a, $ex, $rn)[1]; };
check('会議室: 正しい入力は通る（当日の予約も、過去でない日の予約もよい）', [$rv([]), $rv(['date' => '2031-03-12', 'start' => '09:30', 'end' => '11:00'])], [null, null]);
check('会議室: 30分刻みでない時間・終わりが始まりより前は断る', [strpos((string)$rv(['start' => '10:15']), '30分刻み') !== false, $rv(['start' => '11:00', 'end' => '10:30'])], [true, '終了は、開始より後の時刻にしてください。']);
check('会議室: 過去の日付・すでに終わった時間は断る', [$rv(['date' => '2031-03-11']), $rv(['date' => '2031-03-12', 'start' => '08:00', 'end' => '10:00'])], ['過去の日付には、予約できません。', 'この時間は、すでに終わっています。']);
q("INSERT INTO company_holidays (hdate, name) VALUES ('2031-03-14', '創立記念日')");
check('会議室: 土日・祝日・会社の休業日は、一般の社員は予約できない', [strpos((string)$rv(['date' => '2031-03-15']), '土曜日') !== false, strpos((string)$rv(['date' => '2031-03-14']), '創立記念日') !== false, strpos((string)$rv(['date' => '2031-03-21']), '休業日') !== false], [true, true, true]);
check('会議室: 管理者は、休業日にも予約できる', [rooms_validate_input($rin(['date' => '2031-03-15']), $admin, null, $rn)[1], rooms_validate_input($rin(['date' => '2031-03-14']), $admin, null, $rn)[1]], [null, null]);
check('会議室: 営業時間（9:00〜18:00）の外は、一般の社員は予約できない。管理者はできる', [strpos((string)$rv(['start' => '08:30', 'end' => '09:30']), '9:00〜18:00') !== false, strpos((string)$rv(['start' => '17:00', 'end' => '18:30']), '9:00〜18:00') !== false, $rv(['start' => '09:00', 'end' => '18:00']), rooms_validate_input($rin(['start' => '08:00', 'end' => '19:30']), $admin, null, $rn)[1]], [true, true, null, null]);
check('会議室: 予約は3か月先まで（管理者は、それより先も可）', [$rv(['date' => '2031-06-12']), strpos((string)$rv(['date' => '2031-06-13']), '3か月先') !== false, rooms_validate_input($rin(['date' => '2031-09-10']), $admin, null, $rn)[1]], [null, true, null]);
check('会議室: 人数は必須で、定員を超えると断る（応接室は3名まで）', [$rv(['pax' => '']), $rv(['pax' => 0]), strpos((string)$rv(['room_id' => $rB, 'pax' => 4]), '定員は3名') !== false, $rv(['room_id' => $rB, 'pax' => 3]), $rv(['pax' => 6]), strpos((string)$rv(['pax' => 7]), '定員は6名') !== false], ['人数を入力してください。', '人数を入力してください。', true, null, null, true]);
check('会議室: 用件・区分は必須', [strpos((string)$rv(['title' => '  ']), '用件') !== false, strpos((string)$rv(['kind' => 'xxx']), '区分') !== false, strpos((string)$rv(['title' => str_repeat('あ', 61)]), '60文字') !== false], [true, true, true]);
check('会議室: 存在しない部屋・使わない部屋は選べない', [$rv(['room_id' => 99999]), strpos((string)$rv(['room_id' => 0]), '部屋') !== false], ['部屋を選んでください。', true]);
// 保存・二重予約
$bk1 = rooms_save(rooms_validate_input($rin(), $a, null, $rn)[0], $a);
check('会議室: 予約を保存すると、予約した人・日付・時間が残る', [(int)$bk1['owner_id'], $bk1['bdate'], $bk1['start_time'], $bk1['end_time'], (int)$bk1['pax']], [(int)$a['id'], '2031-03-13', '10:00', '12:00', 6]);
check('会議室: 同じ部屋・重なる時間は、二重予約として断る（先に取った人が優先）', [strpos((string)$rv(['start' => '11:00', 'end' => '13:00'], $b), '「安全衛生委員会」（山田）') !== false, strpos((string)$rv(['start' => '09:30', 'end' => '10:30'], $b), '10:00〜12:00') !== false, $rv(['start' => '09:00', 'end' => '13:00'], $b) !== null], [true, true, true]);
check('会議室: 時間が接しているだけなら、予約できる。別の部屋も、同じ時間に予約できる', [$rv(['start' => '12:00', 'end' => '13:00'], $b), $rv(['start' => '09:00', 'end' => '10:00'], $b), $rv(['room_id' => $rB, 'pax' => 3], $b)], [null, null, null]);
check('会議室: 自分の予約を変更するときは、自分自身とは重ならない', $rv(['end' => '12:30'], $a, $bk1), null);
$bkP = rooms_save(rooms_validate_input($rin(['room_id' => $rB, 'pax' => 3, 'start' => '14:00', 'end' => '15:00', 'title' => '人事面談（秘密）', 'kind' => 'other', 'private' => true]), $a, null, $rn)[0], $a);
$mErr = (string)$rv(['room_id' => $rB, 'pax' => 3, 'start' => '14:30', 'end' => '15:30'], $b);
check('会議室: 非公開の予約と重なったとき、他の人には、件名・予約した人を見せない（本人・管理者には見える）', [strpos($mErr, '人事面談') === false && strpos($mErr, '山田') === false && strpos($mErr, '14:00〜15:00') !== false, strpos((string)rooms_validate_input($rin(['room_id' => $rB, 'pax' => 3, 'start' => '14:30', 'end' => '15:30']), $admin, null, $rn)[1], '人事面談') !== false], [true, true]);
$bkPr = row('SELECT b.*, u.name AS owner_name FROM room_bookings b JOIN users u ON u.id = b.owner_id WHERE b.id = ?', [$bkP['id']]);
$cB = room_booking_for_client($bkPr, $b, $rn); $cA = room_booking_for_client($bkPr, $a, $rn); $cAd = room_booking_for_client($bkPr, $admin, $rn);
check('会議室: 非公開の予約は、他の人には「予約済」とだけ見える（用件・区分・人数・予約した人は渡さない）', [$cB['title'], $cB['kind'], $cB['pax'], $cB['owner_name'], $cB['masked'], $cB['editable'], isset($cB['note'])], ['予約済', 'other', null, '', true, false, false]);
check('会議室: 非公開でも、本人と管理者には、全部見える（管理者は変更もできる）', [$cA['title'], $cA['masked'], $cA['editable'], $cAd['title'], $cAd['editable']], ['人事面談（秘密）', false, true, '人事面談（秘密）', true]);
$bk1r = row('SELECT * FROM room_bookings WHERE id = ?', [$bk1['id']]);
check('会議室: 変更・取り消しできるのは、予約した本人と管理者だけ', [rooms_can_edit($bk1r, $a, $rn), rooms_can_edit($bk1r, $b, $rn), rooms_can_edit($bk1r, $admin, $rn)], [true, false, true]);
check('会議室: 終わった予約は、本人も管理者も、変更・取り消しできない', [rooms_is_past($bk1r, strtotime('2031-03-13 11:59:00')), rooms_is_past($bk1r, strtotime('2031-03-13 12:00:00')), rooms_is_past($bk1r, strtotime('2031-03-14 08:00:00')), rooms_can_edit($bk1r, $a, strtotime('2031-03-13 12:30:00')), rooms_can_edit($bk1r, $admin, strtotime('2031-03-14 09:00:00'))], [false, true, true, false, false]);
// 管理者は、終わった予約も取り消せる（変更はできない）
$endedB = rooms_can_delete($bk1r, $a, strtotime('2031-03-13 12:30:00'));
check('会議室: 終わった予約は、本人は取り消せず、管理者は取り消せる（変更は、管理者もできない）', [$endedB, rooms_can_delete($bk1r, $admin, strtotime('2031-03-14 09:00:00')), rooms_can_edit($bk1r, $admin, strtotime('2031-03-14 09:00:00')), rooms_can_delete($bk1r, $b, strtotime('2031-03-13 10:30:00')), rooms_can_delete($bk1r, $a, strtotime('2031-03-13 10:30:00'))], [false, true, false, false, true]);
$cAdPast = room_booking_for_client(row('SELECT b.*, u.name AS owner_name FROM room_bookings b JOIN users u ON u.id = b.owner_id WHERE b.id = ?', [$bk1r['id']]), $admin, strtotime('2031-03-14 09:00:00'));
check('会議室: 管理者には、終わった予約も「取り消せる」と渡す（変更はできない）', [$cAdPast['past'], $cAdPast['editable'], $cAdPast['deletable']], [true, false, true]);
$pastSnap = $bk1r; $pastSnap['id'] = 99901; $pastSnap['bdate'] = '2020-01-06';
$pastTry = []; foreach ([$a, $admin] as $who) { try { $pr = undo_room_restore($pastSnap, $who); $pastTry[] = 'ok'; q('DELETE FROM room_bookings WHERE id = ?', [$pastSnap['id']]); } catch (RuntimeException $x) { $pastTry[] = 'ng'; } }
check('会議室: 終わった予約を管理者が取り消したときの「元に戻す」は、管理者だけが戻せる', $pastTry, ['ng', 'ok']);
// 取り消し・元に戻す
$snapR = $bk1r; rooms_delete($bk1r);
check('会議室: 取り消すと、予約はなくなる', row('SELECT 1 AS x FROM room_bookings WHERE id = ?', [$snapR['id']]), null);
$backR = undo_room_restore($snapR, $a);
check('会議室: 「元に戻す」で、元の番号・内容のまま戻る', [(int)$backR['id'], $backR['title'], $backR['start_time']], [(int)$snapR['id'], '安全衛生委員会', '10:00']);
check('会議室: 戻せない場合（すでにある・他人・同じ時間に別の予約が入った）は断る', (function () use ($snapR, $a, $b, $rA, $rin, $rn) {
    $out = [];
    try { undo_room_restore($snapR, $a); $out[] = 'ok'; } catch (RuntimeException $x) { $out[] = 'ng'; }
    rooms_delete(row('SELECT * FROM room_bookings WHERE id = ?', [$snapR['id']]));
    try { undo_room_restore($snapR, $b); $out[] = 'ok'; } catch (RuntimeException $x) { $out[] = 'ng'; }
    $tmpB = rooms_save(rooms_validate_input($rin(['start' => '10:30', 'end' => '11:30']), $b, null, $rn)[0], $b);
    try { undo_room_restore($snapR, $a); $out[] = 'ok'; } catch (RuntimeException $x) { $out[] = 'ng'; }
    q('DELETE FROM room_bookings WHERE id = ?', [$tmpB['id']]);
    undo_room_restore($snapR, $a);
    return $out;
})(), ['ng', 'ng', 'ng']);
check('会議室: 戻した予約は、また取り消せる状態（本人の予約として）', (int)row('SELECT owner_id FROM room_bookings WHERE id = ?', [$snapR['id']])['owner_id'], (int)$a['id']);
// 変更履歴
$lg = rows("SELECT * FROM audit_log WHERE type = 'room' ORDER BY id");
$lgText = implode("\n", array_map(function ($r) { return $r['action'] . '|' . $r['label'] . '|' . $r['detail']; }, $lg));
check('会議室: 予約の追加・取り消し・元に戻すが、変更履歴に残る', [strpos($lgText, 'add|会議室｜会議室　3/13 10:00〜12:00　安全衛生委員会') !== false, strpos($lgText, 'delete|会議室｜会議室') !== false, strpos($lgText, '取り消しを元に戻しました') !== false], [true, true, true]);
check('会議室: 非公開の予約は、変更履歴にも、件名を残さない', [strpos($lgText, '人事面談') === false, strpos($lgText, '非公開の予約') !== false], [true, true]);
// 一覧
$lst = rooms_list_bookings('2031-03-01', '2031-03-31', $b);
check('会議室: 一覧は、日付・時間の順で、非公開は「予約済」', array_map(function ($x) { return $x['date'] . ' ' . $x['start'] . ' ' . $x['title']; }, $lst), ['2031-03-13 10:00 安全衛生委員会', '2031-03-13 14:00 予約済']);
// 通知
$lines = rooms_notify_text('2031-03-13', '明日');
check('会議室: Slack通知の文面は、時刻順に並び、非公開は件名を出さない', [strpos($lines, "【明日の会議室】3/13（木）") === 0, strpos($lines, '• 10:00〜12:00　会議室　安全衛生委員会（委員会）　山田') !== false, strpos($lines, '• 14:00〜15:00　応接室　予約済（非公開）') !== false, strpos($lines, '人事面談') === false], [true, true, true, true]);
$bkX = rooms_save(rooms_validate_input($rin(['room_id' => $rB, 'pax' => 2, 'start' => '16:00', 'end' => '17:00', 'title' => '<!channel> & <@U12345678> 全員集合', 'kind' => 'other']), $a, null, $rn)[0], $a);
$xt = rooms_notify_text('2031-03-13', '明日');
check('会議室: Slack の通知に入れる用件は、<!channel> や @呼び出しが効かない形にする', [strpos($xt, '<!channel>') === false && strpos($xt, '<@U12345678>') === false, strpos($xt, '&lt;!channel&gt; &amp; &lt;@U12345678&gt; 全員集合') !== false], [true, true]);
q('DELETE FROM room_bookings WHERE id = ?', [$bkX['id']]);
q("DELETE FROM notification_log WHERE ref LIKE 'room%2031%'");
$np = rooms_notify_due(strtotime('2031-03-12 16:50:00')); $np2 = rooms_notify_due(strtotime('2031-03-12 17:05:00')); $np3 = rooms_notify_due(strtotime('2031-03-12 17:20:00')); $np4 = rooms_notify_due(strtotime('2031-03-12 20:30:00'));
check('会議室: 前日17:00の通知は、時刻の前は送らず・過ぎたら1回だけ送り・3時間以上過ぎたら送らない', [count($np), $np2, count($np3), count($np4)], [0, ['会議室の予約（明日）: 2 件を通知しました'], 0, 0]);
$nt = rooms_notify_due(strtotime('2031-03-13 08:40:00'));
check('会議室: 当日の朝8:30の通知も、1回だけ送る', [$nt, count(rooms_notify_due(strtotime('2031-03-13 08:50:00')))], [['会議室の予約（本日）: 2 件を通知しました'], 0]);
check('会議室: 予約のない日は、通知しない', count(rooms_notify_due(strtotime('2031-03-16 17:05:00'))), 0);
$cf = rooms_cfg(); $cf['notify_prev']['on'] = false; rooms_cfg_save($cf); q("DELETE FROM notification_log WHERE ref LIKE 'room%2031%'");
check('会議室: 通知を止めると、送らない', count(rooms_notify_due(strtotime('2031-03-12 17:05:00'))), 0);
$cf['notify_prev']['on'] = true; rooms_cfg_save($cf);
// 参加者・開始の1時間前の通知
$bid = (int)$b['id'];
$pv = function (array $o) use ($rin, $a, $rn, $rB) { return rooms_validate_input($rin(array_merge(['room_id' => $rB, 'pax' => 2, 'date' => '2031-03-17', 'start' => '15:00', 'end' => '16:00', 'title' => '参加者つきの打ち合わせ', 'kind' => 'meeting'], $o)), $a, null, $rn); };
check('会議室の参加者: 予約した人自身・重複は除き、番号順に保存する', [$pv(['participants' => [$bid, (int)$a['id'], $bid]])[0]['participants'], $pv([])[0]['participants'], $pv(['participants' => (string)$bid])[0]['participants']], [(string)$bid, '', (string)$bid]);
check('会議室の参加者: 存在しない人・おかしな指定・多すぎる人数は断る', [$pv(['participants' => [999999]])[1] !== null, $pv(['participants' => ['x']])[1] !== null, $pv(['participants' => range(1000, 1031)])[1] !== null], [true, true, true]);
check('会議室の1時間前の通知: 初めは「送る」。指定すれば「送らない」にもできる', [$pv([])[0]['notify_pre'], $pv(['notify_pre' => false])[0]['notify_pre'], $pv(['notify_pre' => true])[0]['notify_pre']], [1, 0, 1]);
$bkP2 = rooms_save($pv(['participants' => [$bid], 'private' => true])[0], $a);
$bkProw = row('SELECT b.*, u.name AS owner_name FROM room_bookings b JOIN users u ON u.id = b.owner_id WHERE b.id = ?', [$bkP2['id']]);
$cOwn = room_booking_for_client($bkProw, $a, $rn); $cPart = room_booking_for_client($bkProw, $b, $rn); $cOther = room_booking_for_client($bkProw, $admin_other ?? ['id' => 987654, 'role' => 'member'], $rn);
check('会議室の参加者: 非公開の予約でも、参加者には内容が見える。参加者でない人には「予約済」とだけ', [$cPart['masked'], $cPart['title'], $cPart['invited'], $cPart['participants'][0]['name'], $cOther['masked'], $cOther['title'], $cOther['participants']], [false, '参加者つきの打ち合わせ', true, $b['name'], true, '予約済', []]);
check('会議室の参加者: 予約した本人には、参加者と通知の設定が渡る', [array_column($cOwn['participants'], 'id'), $cOwn['notify_pre']], [[$bid], true]);
$calAll = rooms_list_for_calendar('2031-03-17', '2031-03-17', $b, 0);
$calMe = rooms_list_for_calendar('2031-03-17', '2031-03-17', $b, $bid);
$calOwner = rooms_list_for_calendar('2031-03-17', '2031-03-17', $b, (int)$a['id']);
$calOther = rooms_list_for_calendar('2031-03-17', '2031-03-17', $a, 987654);
check('会議室のカレンダー表示: 全社は全部。特定の人は、その人が予約した・参加者の予約だけ（参加者のカレンダーにも出る）', [count($calAll), count($calMe), count($calOwner), count($calOther)], [1, 1, 1, 0]);
$bPre = rooms_notify_pre(strtotime('2031-03-17 13:50:00'));
$bPre2 = rooms_notify_pre(strtotime('2031-03-17 14:05:00'));
$bPre3 = rooms_notify_pre(strtotime('2031-03-17 14:20:00'));
$bPre4 = rooms_notify_pre(strtotime('2031-03-17 15:05:00'));
check('会議室の1時間前の通知: 1時間前より前は送らない・1時間前を過ぎたら1回だけ送る・開始後は送らない', [count($bPre), count($bPre2), count($bPre3), count($bPre4)], [0, 1, 0, 0]);
$upd = $pv(['participants' => [$bid], 'private' => true, 'start' => '16:00', 'end' => '17:00']);
check('会議室の1時間前の通知: 開始時刻を変えると、新しく送れる', (function () use ($upd, $bkP2, $a, $rn) { $ex = row('SELECT * FROM room_bookings WHERE id = ?', [$bkP2['id']]); $v = rooms_validate_input(['room_id' => $ex['room_id'], 'date' => $ex['bdate'], 'start' => '16:00', 'end' => '17:00', 'title' => $ex['title'], 'kind' => $ex['kind'], 'pax' => 2, 'private' => true, 'participants' => [], 'notify_pre' => true], $a, $ex, strtotime('2031-03-12 10:00:00')); rooms_save($v[0], $a, $ex); return count(rooms_notify_pre(strtotime('2031-03-17 15:10:00'))); })(), 1);
q('UPDATE room_bookings SET notify_pre = 0 WHERE id = ?', [$bkP2['id']]); q("DELETE FROM notification_log WHERE ref LIKE 'roompre:%'");
check('会議室の1時間前の通知: 予約ごとにオフにしていれば、送らない', count(rooms_notify_pre(strtotime('2031-03-17 15:10:00'))), 0);
q('DELETE FROM room_bookings WHERE id = ?', [$bkP2['id']]);
// 決まりの設定
$badC = [];
foreach ([['advance_months' => 0], ['advance_months' => 13], ['open' => '09:10'], ['open' => '19:00', 'close' => '18:00'], ['notify_prev' => ['time' => '25:00']]] as $chg) {
    try { rooms_cfg_save(array_merge(rooms_cfg(), $chg)); $badC[] = 'ok'; } catch (RuntimeException $x) { $badC[] = 'ng'; }
}
check('会議室: 決まりの設定は、おかしな値（月数・30分刻みでない時刻・逆の時間帯・通知の時刻）を保存できない', $badC, ['ng', 'ng', 'ng', 'ng', 'ng']);
$nc = rooms_cfg_save(array_merge(rooms_cfg(), ['advance_months' => 6, 'open' => '08:30', 'close' => '19:00']));
check('会議室: 決まりを変えると、予約の検査にも反映される（営業時間・先の月数）', [$nc['advance_months'], rooms_validate_input($rin(['start' => '08:30', 'end' => '09:30']), $a, null, $rn)[1], rooms_validate_input($rin(['date' => '2031-09-12']), $a, null, $rn)[1], strpos((string)rooms_validate_input($rin(['date' => '2031-09-16']), $a, null, $rn)[1], '6か月先') !== false], [6, null, null, true]);
rooms_cfg_save(array_merge(rooms_cfg(), rooms_cfg_defaults()));
check('会議室: 決まりを初期値に戻せる', [rooms_cfg()['advance_months'], rooms_cfg()['open'], rooms_cfg()['close']], [3, '09:00', '18:00']);
check('会議室: 少人数のお勧めはない（設定にも出ない）', array_key_exists('small_hint_pax', rooms_cfg()), false);
// 部屋の管理
$nr3 = rooms_save_room(['name' => '相談室', 'short' => '', 'capacity' => 4, 'equipment' => 'テレビ']);
$r3 = row('SELECT * FROM rooms WHERE id = ?', [$nr3['id']]);
check('会議室: 部屋を追加できる（略称は、名前の1文字目）', [$r3['name'], $r3['short'], (int)$r3['capacity'], (int)$r3['sort_order']], ['相談室', '相', 4, 3]);
$ov = rooms_save_room(['id' => $rA, 'name' => '会議室', 'short' => '会', 'capacity' => 4, 'equipment' => '']);
check('会議室: 定員を減らしたとき、先の予約で人数が超える件数を知らせる（予約は残る）', [$ov['over'], (int)row('SELECT COUNT(*) AS c FROM room_bookings WHERE room_id = ?', [$rA])['c']], [1, 1]);
rooms_save_room(['id' => $rA, 'name' => '会議室', 'short' => '会', 'capacity' => 6, 'equipment' => 'プロジェクター・ホワイトボード']);
rooms_save_room(['id' => $nr3['id'], 'name' => '相談室', 'short' => '相', 'capacity' => 4, 'equipment' => '', 'active' => 0]);
check('会議室: 使わない部屋は、選択肢から外れ、予約には選べない（色の番号は、並び順のまま）', [count(rooms_all()), strpos((string)$rv(['room_id' => $nr3['id'], 'pax' => 2]), '部屋') !== false, array_map(function ($x) { return $x['slot']; }, rooms_for_client(false))], [2, true, [0, 1, 2]]);
$badR = [];
foreach ([['name' => '', 'capacity' => 5], ['name' => 'あ', 'capacity' => 0], ['name' => 'あ', 'capacity' => 5, 'equipment' => str_repeat('あ', 61)]] as $in) {
    try { rooms_save_room($in); $badR[] = 'ok'; } catch (RuntimeException $x) { $badR[] = 'ng'; }
}
check('会議室: 部屋の名前・定員・設備がおかしいと、保存できない', $badR, ['ng', 'ng', 'ng']);
check('会議室: 最後の1部屋は、使わない設定にできない', (function () use ($rA, $rB) {
    rooms_save_room(['id' => $rB, 'name' => '応接室', 'short' => '応', 'capacity' => 3, 'equipment' => '', 'active' => 0]);
    try { rooms_save_room(['id' => $rA, 'name' => '会議室', 'short' => '会', 'capacity' => 6, 'active' => 0]); return 'ok'; } catch (RuntimeException $x) { return 'ng'; } finally { rooms_save_room(['id' => $rB, 'name' => '応接室', 'short' => '応', 'capacity' => 3, 'equipment' => '', 'active' => 1]); }
})(), 'ng');
check('会議室: バックアップに、部屋と予約が入る', [isset(backup_collect()['tables']['rooms']), count(backup_collect()['tables']['room_bookings']) >= 1], [true, true]);
q('DELETE FROM room_bookings'); q("DELETE FROM company_holidays WHERE hdate = '2031-03-14'"); q('DELETE FROM rooms WHERE id = ?', [$nr3['id']]);

// 初期の部屋の名前・定員の見直し（v1.54.0）: 小会議室(6名) → 応接室(4名)、大会議室(16名) → 8名。名前を変えている部屋は触らない
q("INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES ('小会議室', '小', 6, 'モニター', 8, 1)");
q("INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES ('大会議室', '大', 16, '', 9, 1)");
q("INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES ('小さな部屋', '小', 5, '', 10, 1)");
rooms_migrate_v25(); rooms_migrate_v25();
$m25 = function ($o) { $r = row('SELECT name, short, capacity FROM rooms WHERE sort_order = ?', [$o]); return $r['name'] . '/' . $r['short'] . '/' . $r['capacity']; }; // 文字をつなぐのは PHP で（MariaDB では || が「または」になる）
check('会議室: 古い初期値の部屋は、応接室（4名）・大会議室（8名）に直る。名前を変えた部屋はそのまま', [$m25(8), $m25(9), $m25(10)], ['応接室/応/4', '大会議室/大/8', '小さな部屋/小/5']);
q('DELETE FROM rooms WHERE sort_order >= 8');

// v1.55.0: 大会議室(8名) → 会議室(6名)、応接室(4名) → 3名。初期の設備名は消し、自分で書いた設備は残す。名前を変えた部屋は触らない
q("INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES ('大会議室', '大', 8, 'プロジェクター・ホワイトボード', 8, 1)");
q("INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES ('応接室', '応', 4, 'モニター', 9, 1)");
q("INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES ('大会議室', '大', 8, '大きなテレビ', 10, 1)");
q("INSERT INTO rooms (name, short, capacity, equipment, sort_order, active) VALUES ('第2会議室', '2', 8, 'モニター', 11, 1)");
rooms_migrate_v26(); rooms_migrate_v26();
$m26 = function ($o) { $r = row('SELECT * FROM rooms WHERE sort_order = ?', [$o]); return $r['name'] . '/' . $r['short'] . '/' . $r['capacity'] . '/' . $r['equipment']; };
check('会議室: 古い初期値の部屋は、会議室（6名）・応接室（3名）になり、初期の設備名は消える。自分で書いた設備・名前を変えた部屋は、そのまま', [$m26(8), $m26(9), $m26(10), $m26(11)], ['会議室/会/6/', '応接室/応/3/', '会議室/会/6/大きなテレビ', '第2会議室/2/8/モニター']);
q('DELETE FROM rooms WHERE sort_order >= 8');


// ---- 家族のアカウント（v1.76.0）: 招待・見える範囲・書ける範囲 ----
$fD = '2031-05-12';
$mkF = function (array $user, array $in) { [$d, $err] = validate_event_input($in, $user); if ($err) { throw new RuntimeException($err); } return save_event($d, $user, null); };
$fOwner = $a; // 山田
[$fid1, $fpw1] = family_add($fOwner, '山田 妻', 'wife@example.com');
$fam1 = row('SELECT * FROM users WHERE id = ?', [$fid1]);
check('家族: 招待すると、家族のアカウントができる（持ち主・一時パスワード・初回に変更）', [$fam1['role'], (int)$fam1['family_of'] === (int)$fOwner['id'], (int)$fam1['must_change_password'], strlen($fpw1) >= 8], ['family', true, 1, true]);
check('家族: 一時パスワードでログインできる（家族のアカウントとして）', (function () use ($fpw1) { $u = login_attempt('wife@example.com', $fpw1); return $u !== null && $u['role'] === 'family'; })(), true);
check('家族: 同じメールアドレスでは招待できない', (function () use ($fOwner) { try { family_add($fOwner, '別人', 'wife@example.com'); return 'ok'; } catch (RuntimeException $x) { return 'ng'; } })(), 'ng');
check('家族: メールアドレスが正しくないと招待できない', (function () use ($fOwner) { try { family_add($fOwner, '別人', 'not-an-email'); return 'ok'; } catch (RuntimeException $x) { return 'ng'; } })(), 'ng');
check('家族: 家族のアカウントからは、招待できない', (function () use ($fam1) { try { family_add($fam1, '孫', 'grand@example.com'); return 'ok'; } catch (RuntimeException $x) { return 'ng'; } })(), 'ng');
[$fid2] = family_add($fOwner, '山田 長男', 'son@example.com');
$fam2 = row('SELECT * FROM users WHERE id = ?', [$fid2]);
check('家族: 招待できるのは、決まった人数まで', (function () use ($fOwner) { try { for ($i = 0; $i < FAMILY_MAX + 1; $i++) { family_add($fOwner, '多数' . $i, "many$i@example.com"); } return 'ok'; } catch (RuntimeException $x) { return 'ng'; } })(), 'ng');
foreach (rows("SELECT id FROM users WHERE email LIKE 'many%@example.com'") as $r) { q('DELETE FROM users WHERE id = ?', [$r['id']]); }
check('家族: 家族の数は、持ち主ごとに数える', count(family_members((int)$b['id'])), 0);

$fShared = $mkF($fOwner, ['kind' => 'private', 'title' => '家族に共有の予定', 'start' => $fD]);
$fHidden = $mkF($fOwner, ['kind' => 'private', 'title' => '共有しない予定', 'start' => $fD, 'family_shared' => 0]);
$fWork = $mkF($fOwner, ['kind' => 'work', 'title' => '共有しない業務', 'tag' => '打ち合わせ', 'start' => $fD]);
$fT = function (array $u, string $view = 'me') use ($fD) { $t = array_column(list_events($u, $fD, $fD, $view), 'title'); sort($t); return $t; };
check('家族: 見えるのは、持ち主が家族に共有した予定だけ（共有しない予定・業務は見えない）', $fT($fam1), ['家族に共有の予定']);
check('家族: 業務版を指定しても、プライベート版の見え方', $fT($fam1, 'team'), ['家族に共有の予定']);
$fMine = $mkF($fam1, ['kind' => 'work', 'title' => '妻の予定', 'tag' => '会議', 'start' => $fD, 'family_shared' => 0, 'owner_id' => $b['id']]);
$fMineRow = row('SELECT * FROM events WHERE id = ?', [$fMine['id']]);
check('家族: 家族が入れる予定は、いつも、プライベート（api で種類を固定する前の関数でも、持ち主は本人）', [(int)$fMineRow['owner_id'] === (int)$fam1['id']], [true]);
q("UPDATE events SET kind = 'private', family_shared = 1 WHERE id = ?", [$fMine['id']]); // api.php が、家族の予定を、プライベート・共有に固定する
check('家族: 家族の予定は、ほかの家族にも見える', $fT($fam2), ['妻の予定', '家族に共有の予定']);
check('家族: 家族の予定は、自分にも見える', $fT($fam1), ['妻の予定', '家族に共有の予定']);
check('家族: 持ち主のプライベート版に、家族の予定も出る', $fT($fOwner), ['共有しない予定', '妻の予定', '家族に共有の予定']);
check('家族: ほかの社員のプライベート版には出ない', $fT($b), []);
check('家族: 業務版には、家族の予定は出ない', in_array('妻の予定', $fT($fOwner, 'team'), true) || in_array('妻の予定', $fT($admin, 'team'), true), false);
check('家族: 管理者にも、家族の予定は見えない', $fT($admin), []);
check('家族: 家族の予定は、持ち主の家族用リンクの更新履歴には出ない', count(array_filter(family_event_log((int)$fOwner['id'], 200), function ($l) { return strpos(json_encode($l, JSON_UNESCAPED_UNICODE), '妻の予定') !== false; })), 0);
check('家族: 見える予定は、開ける（find_event）', [find_event((int)$fShared['id'], $fam1) !== null, find_event((int)$fMine['id'], $fam2) !== null], [true, true]);
check('家族: 共有しない予定・業務は、開けない', [find_event((int)$fHidden['id'], $fam1), find_event((int)$fWork['id'], $fam1)], [null, null]);
check('家族: 編集できるのは、自分の予定だけ', [can_edit_event($fMineRow, $fam1), can_edit_event(row('SELECT * FROM events WHERE id = ?', [$fMine['id']]), $fam2), can_edit_event($fShared, $fam1), can_edit_event($fWork, $fam1)], [true, false, false, false]);
check('家族: 持ち主も、家族の予定は編集できない（見るだけ）', can_edit_event(row('SELECT * FROM events WHERE id = ?', [$fMine['id']]), $fOwner), false);
check('家族: 管理者も、家族の予定は編集できない', can_edit_event(row('SELECT * FROM events WHERE id = ?', [$fMine['id']]), $admin), false);

// 別の持ち主の家族には、混ざらない
[$fidB] = family_add($b, '鈴木 妻', 'wifeb@example.com');
$famB = row('SELECT * FROM users WHERE id = ?', [$fidB]);
check('家族: 別の持ち主の家族には、見えない（互いの予定が混ざらない）', [$fT($famB), find_event((int)$fShared['id'], $famB), find_event((int)$fMine['id'], $famB)], [[], null, null]);

// 利用停止・削除
q('UPDATE users SET active = 0 WHERE id = ?', [$fid2]);
check('家族: 利用を止めた家族は、ログインできない', login_attempt('son@example.com', 'whatever1'), null);
q('UPDATE users SET active = 0 WHERE id = ?', [$fid1]);
check('家族: 利用を止めると、その家族の予定は、持ち主のプライベート版からも見えなくなる', $fT($fOwner), ['共有しない予定', '家族に共有の予定']);
q('UPDATE users SET active = 1 WHERE id = ?', [$fid1]);
check('家族: 利用を再開すると、また見える', $fT($fOwner), ['共有しない予定', '妻の予定', '家族に共有の予定']);
check('家族: 他の持ち主は、家族を消せない', family_delete($b, (int)$fid1), false);
check('家族: 持ち主が消すと、アカウントも予定も消える', [family_delete($fOwner, (int)$fid1), row('SELECT id FROM users WHERE id = ?', [$fid1]), (int)row('SELECT COUNT(*) AS c FROM events WHERE owner_id = ?', [$fid1])['c']], [true, null, 0]);
check('家族: 家族の一覧に、他の持ち主の家族は出ない', array_column(family_members((int)$fOwner['id']), 'email'), ['son@example.com']);
family_delete($fOwner, (int)$fid2); family_delete($b, (int)$fidB);
check('家族: 家族のアカウントの許可する操作に、業務・ToDo・設定は入っていない', array_intersect(FAMILY_ALLOWED_ACTIONS, ['todo_list', 'todo_save', 'users_list', 'user_save', 'share_create', 'rooms_list', 'memo_get', 'series_list', 'family_add', 'backup_snooze', 'usage_get', 'audit_list', 'slack_status', 'prefs_save']), []);
q('DELETE FROM events WHERE start_date = ?', [$fD]);

// 古い版（family_of の列が無い）のデータベースからの更新: 列が足され、家族のアカウントが使える
db()->exec('ALTER TABLE users DROP COLUMN family_of');
q('DELETE FROM app_meta WHERE meta_key = ?', ['schema_version']);
q('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', ['schema_version', '27']);
ensure_schema();
check('更新: 古いデータベースに family_of の列が足される', (function () { try { db()->query('SELECT family_of FROM users LIMIT 1')->fetchAll(); return true; } catch (PDOException $e) { return false; } })(), true);
check('更新: 更新したあとに、家族を招待できる', (function () use ($a) { [$id] = family_add($a, '更新後の家族', 'after-upgrade@example.com'); return family_delete($a, $id); })(), true);

echo "\n結果: 成功 $pass / 失敗 $fail\n";
// 後片付け
$rm = function ($p) use (&$rm) { if (is_dir($p) && !is_link($p)) { foreach (scandir($p) as $f) { if ($f !== '.' && $f !== '..') { $rm($p . '/' . $f); } } @rmdir($p); } else { @unlink($p); } };
$rm($tmp);
exit($fail ? 1 : 0);
