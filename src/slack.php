<?php
// Slack の Incoming Webhook へ通知する。失敗してもアプリの動作は止めない。

// 送り先（Incoming Webhook）は、チャンネル名を付けて複数登録でき、どれを使うかをプルダウンで選ぶ。
//   app_meta.slack_dests  … 登録した送り先の一覧（JSON: [{id,name,url}]）
//   app_meta.slack_active … 使う送り先の id（'config' なら config.php の設定）
//   app_meta.slack_webhook … 古い版（1件だけ登録）のもの。あれば「登録済みの送り先」として引き継ぐ
const SLACK_MAX_DESTS = 10;

function slack_meta_get(string $key): string
{
    try {
        $r = row('SELECT meta_value FROM app_meta WHERE meta_key = ?', [$key]);
        return $r ? (string)$r['meta_value'] : '';
    } catch (Throwable $e) {
        return ''; // app_meta がまだ無いときは、未設定として扱う
    }
}

function slack_meta_set(string $key, string $val): void
{
    q('DELETE FROM app_meta WHERE meta_key = ?', [$key]);
    if ($val !== '') {
        q('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', [$key, $val]);
    }
}

/** 登録した送り先の一覧。古い版の1件だけの登録があれば、それも1件として含める */
function slack_dests(): array
{
    $list = [];
    $raw = slack_meta_get('slack_dests');
    if ($raw !== '') {
        $j = json_decode($raw, true);
        foreach (is_array($j) ? $j : [] as $d) {
            if (is_array($d) && isset($d['id'], $d['name'], $d['url']) && slack_valid_webhook((string)$d['url'])) {
                $list[] = ['id' => (string)$d['id'], 'name' => (string)$d['name'], 'url' => (string)$d['url']];
            }
        }
    }
    $old = slack_meta_get('slack_webhook');
    if ($old !== '' && slack_valid_webhook($old)) {
        $list[] = ['id' => 'old', 'name' => '登録済みの送り先', 'url' => $old];
    }
    return $list;
}

function slack_dests_save(array $list): void
{
    slack_meta_set('slack_dests', $list ? json_encode(array_values($list), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '');
    slack_meta_set('slack_webhook', ''); // 古い版の登録は、一覧に取り込んだので消す
}

/** 使う送り先の id。選ばれていない／消えているときは、登録の先頭、なければ config.php */
function slack_active_id(): string
{
    $list = slack_dests();
    $want = slack_meta_get('slack_active');
    foreach ($list as $d) {
        if ($d['id'] === $want) {
            return $want;
        }
    }
    if ($want === 'config' && (string)cfg('slack_webhook', '') !== '') {
        return 'config';
    }
    if ($list) {
        return $list[0]['id'];
    }
    return (string)cfg('slack_webhook', '') !== '' ? 'config' : '';
}

/** 通知の送り先（Incoming Webhook の URL）。選んだ送り先。なければ空 */
function slack_webhook_url(): string
{
    $id = slack_active_id();
    if ($id === 'config') {
        return (string)cfg('slack_webhook', '');
    }
    foreach (slack_dests() as $d) {
        if ($d['id'] === $id) {
            return $d['url'];
        }
    }
    return '';
}

function slack_enabled(): bool
{
    return slack_webhook_url() !== '';
}

/** 画面から登録できる URL の形（Slack の Incoming Webhook だけ。任意のサーバーへ送らせないため） */
function slack_valid_webhook(string $url): bool
{
    return strlen($url) <= 100 && preg_match('#^https://hooks\.slack\.com/services/[A-Za-z0-9]+/[A-Za-z0-9]+/[A-Za-z0-9]+$#', $url) === 1;
}

/** 送り先を1件登録する。最初の1件なら、そのまま使う送り先にする。失敗は RuntimeException（画面に出せる文） */
function slack_dest_add(string $name, string $url): array
{
    $name = trim(preg_replace('/\s+/u', ' ', $name));
    if ($name === '' || mb_strlen($name) > 30) {
        throw new RuntimeException('チャンネル名を、30文字以内で入力してください（例: #休み連絡）。');
    }
    if (!slack_valid_webhook($url)) {
        throw new RuntimeException('Webhook URL の形が違います。Slackで発行した https://hooks.slack.com/services/… の URL を、そのまま貼り付けてください。');
    }
    $list = slack_dests();
    if (count($list) >= SLACK_MAX_DESTS) {
        throw new RuntimeException('登録できるのは ' . SLACK_MAX_DESTS . ' 件までです。使わないものを削除してください。');
    }
    foreach ($list as $d) {
        if (mb_strtolower($d['name']) === mb_strtolower($name)) {
            throw new RuntimeException('同じ名前の送り先がすでにあります。別の名前にしてください。');
        }
        if ($d['url'] === $url) {
            throw new RuntimeException('その Webhook URL は、「' . $d['name'] . '」としてすでに登録されています。');
        }
    }
    $hadActive = slack_enabled();
    $d = ['id' => bin2hex(random_bytes(4)), 'name' => $name, 'url' => $url];
    $list[] = $d;
    if (mb_strlen(json_encode($list, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) > 1900) { // 保存先の欄（2000文字）に収まらない
        throw new RuntimeException('登録が多すぎます。使わないものを削除してください。');
    }
    slack_dests_save($list);
    if (!$hadActive) {
        slack_meta_set('slack_active', $d['id']);
    }
    return $d;
}

function slack_dest_delete(string $id): void
{
    $list = slack_dests();
    $keep = array_values(array_filter($list, function ($d) use ($id) { return $d['id'] !== $id; }));
    if (count($keep) === count($list)) {
        throw new RuntimeException('その送り先は、登録にありません。');
    }
    $wasActive = slack_active_id() === $id;
    slack_dests_save($keep);
    if ($wasActive) {
        slack_meta_set('slack_active', ''); // 残りの先頭（なければ config.php）に自動で切り替わる
    }
}

/** 使う送り先を選ぶ。'config' は config.php の設定 */
function slack_dest_use(string $id): void
{
    if ($id === 'config') {
        if ((string)cfg('slack_webhook', '') === '') {
            throw new RuntimeException('config.php には、送り先が設定されていません。');
        }
    } elseif (!array_filter(slack_dests(), function ($d) use ($id) { return $d['id'] === $id; })) {
        throw new RuntimeException('その送り先は、登録にありません。');
    }
    slack_meta_set('slack_active', $id);
}

function slack_mask(string $url): string
{
    if ($url === '') {
        return '';
    }
    $p = parse_url($url);
    return ($p['scheme'] ?? 'https') . '://' . ($p['host'] ?? '') . '/…' . substr($url, -4);
}

/** 送り先の状態。URL そのものは返さず、伏せた形だけ返す */
function slack_status(): array
{
    $active = slack_active_id();
    $dests = array_map(function ($d) { return ['id' => $d['id'], 'name' => $d['name'], 'masked' => slack_mask($d['url'])]; }, slack_dests());
    $cfg = (string)cfg('slack_webhook', '');
    if ($cfg !== '') {
        array_unshift($dests, ['id' => 'config', 'name' => 'config.php の設定', 'masked' => slack_mask($cfg)]);
    }
    $name = '';
    $mask = '';
    foreach ($dests as $d) {
        if ($d['id'] === $active) {
            $name = $d['name'];
            $mask = $d['masked'];
        }
    }
    return ['configured' => $active !== '', 'active' => $active, 'active_name' => $name, 'masked' => $mask, 'dests' => $dests,
        'source' => $active === '' ? 'none' : ($active === 'config' ? 'config' : 'ui'),
        'base_url' => (string)cfg('base_url', '') !== '', 'link' => slack_link_kind()];
}

/**
 * 通知を送り、結果を詳しく返す（テスト送信用）。
 * @return array{ok:bool,code:int,error:string,body:string}
 */
function slack_post_detailed(string $text): array
{
    $url = slack_webhook_url();
    if ($url === '') {
        return ['ok' => false, 'code' => 0, 'error' => '送り先（Webhook URL）が設定されていません。', 'body' => ''];
    }
    $payload = json_encode(['text' => $text], JSON_UNESCAPED_UNICODE);
    $res = false;
    $code = 0;
    $err = '';
    try {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $payload,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 10,
            ]);
            $res = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($res === false) {
                $err = (string)curl_error($ch);
            }
            curl_close($ch);
            $ok = $res !== false && $code >= 200 && $code < 300;
        } else {
            $ctx = stream_context_create(['http' => [
                'method' => 'POST', 'header' => "Content-Type: application/json; charset=utf-8\r\n",
                'content' => $payload, 'timeout' => 10, 'ignore_errors' => true,
            ]]);
            $res = @file_get_contents($url, false, $ctx);
            if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
                $code = (int)$m[1];
            }
            $ok = $res !== false && ($code === 0 ? stripos((string)$res, 'ok') !== false : ($code >= 200 && $code < 300));
            if ($res === false) {
                $err = '接続できませんでした。';
            }
        }
    } catch (Throwable $e) {
        $ok = false;
        $err = $e->getMessage();
    }
    $body = $res === false ? '' : substr((string)$res, 0, 200);
    if (!$ok) {
        error_log('[schedule] Slack通知に失敗しました: ' . ($err !== '' ? $err : $code . ' ' . $body));
    }
    return ['ok' => $ok, 'code' => $code, 'error' => $err, 'body' => $body];
}

function slack_post(string $text): bool
{
    if (!slack_enabled()) {
        return false;
    }
    return slack_post_detailed($text)['ok'];
}

/** 同じ通知を二重に送らないための記録。初めての ref なら true */
function notify_once(string $ref): bool
{
    if (row('SELECT id FROM notification_log WHERE ref = ?', [$ref])) {
        return false;
    }
    try {
        q('INSERT INTO notification_log (ref, sent_at) VALUES (?, ?)', [$ref, now_str()]);
    } catch (PDOException $e) {
        return false; // 同時実行で先に記録された
    }
    return true;
}

// ---- 通知の時間と文面（管理者が画面で変えられる）----
//   app_meta.slack_cfg に JSON で保存。何も保存していなければ、下の初期値（従来どおりの通知）
const SLACK_PLACEHOLDERS = [
    'line' => ['{名前}', '{分類}', '{期間}'],
    'reg' => ['{休み一覧}', '{件数}', '{登録した人}', '{リンク}'],
    'day' => ['{日付}', '{休み一覧}', '{人数}', '{リンク}'],
];

function slack_cfg_defaults(): array
{
    return [
        'mention' => true,
        'line' => '• {名前}　{分類}　{期間}',
        'reg' => ['on' => true, 'tpl' => "【休みの登録】\n{休み一覧}\n{登録した人}\n{リンク}"],
        'morning' => ['on' => true, 'time' => '08:30', 'tpl' => "【本日のお休み】{日付}\n{休み一覧}\n{リンク}"],
        'evening' => ['on' => true, 'time' => '17:00', 'tpl' => "【明日のお休み】{日付}\n{休み一覧}\n{リンク}"],
    ];
}

/** 保存されている設定（足りない項目は初期値で補う）。壊れていても、初期値に戻るだけ */
function slack_cfg(): array
{
    $d = slack_cfg_defaults();
    $j = json_decode(slack_meta_get('slack_cfg'), true);
    if (!is_array($j)) {
        return $d;
    }
    $d['mention'] = isset($j['mention']) ? (bool)$j['mention'] : $d['mention'];
    if (isset($j['line']) && is_string($j['line']) && $j['line'] !== '') {
        $d['line'] = $j['line'];
    }
    foreach (['reg', 'morning', 'evening'] as $k) {
        if (!isset($j[$k]) || !is_array($j[$k])) {
            continue;
        }
        $d[$k]['on'] = isset($j[$k]['on']) ? (bool)$j[$k]['on'] : $d[$k]['on'];
        if (isset($j[$k]['tpl']) && is_string($j[$k]['tpl']) && $j[$k]['tpl'] !== '') {
            $d[$k]['tpl'] = $j[$k]['tpl'];
        }
        if ($k !== 'reg' && isset($j[$k]['time']) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string)$j[$k]['time'])) {
            $d[$k]['time'] = $j[$k]['time'];
        }
    }
    return $d;
}

/** 画面から来た設定を検べて、保存できる形にする。問題があれば RuntimeException（画面に出せる文） */
function slack_cfg_clean(array $in): array
{
    $d = slack_cfg_defaults();
    $out = ['mention' => !empty($in['mention'])];
    $check = function (string $label, $tpl, array $allowed, bool $needList, int $max) {
        $tpl = str_replace("\r", '', trim((string)$tpl));
        if ($tpl === '') {
            throw new RuntimeException("「{$label}」の文面が空です。");
        }
        if (mb_strlen($tpl) > $max) {
            throw new RuntimeException("「{$label}」の文面は、{$max}文字以内にしてください。");
        }
        preg_match_all('/\{[^{}\n]*\}/u', $tpl, $m);
        foreach ($m[0] as $ph) {
            if (!in_array($ph, $allowed, true)) {
                throw new RuntimeException("「{$label}」に、使えない差し込み {$ph} があります。使えるのは " . implode(' ', $allowed) . ' です。');
            }
        }
        if ($needList && strpos($tpl, '{休み一覧}') === false) {
            throw new RuntimeException("「{$label}」には、{休み一覧} を入れてください（入れないと、誰が休みか分かりません）。");
        }
        return $tpl;
    };
    $out['line'] = $check('1人分の表示', $in['line'] ?? $d['line'], SLACK_PLACEHOLDERS['line'], false, 100);
    if (strpos($out['line'], '{名前}') === false) {
        throw new RuntimeException('「1人分の表示」には、{名前} を入れてください。');
    }
    $names = ['reg' => '休みを登録したとき', 'morning' => '朝の通知（本日の休み）', 'evening' => '夕方の通知（明日の休み）'];
    foreach ($names as $k => $label) {
        $x = is_array($in[$k] ?? null) ? $in[$k] : [];
        $out[$k] = ['on' => !empty($x['on']), 'tpl' => $check($label, $x['tpl'] ?? $d[$k]['tpl'], SLACK_PLACEHOLDERS[$k === 'reg' ? 'reg' : 'day'], true, 250)];
        if ($k !== 'reg') {
            $t = (string)($x['time'] ?? $d[$k]['time']);
            if (!preg_match('/^([01]?\d|2[0-3]):([0-5]\d)$/', $t, $mm)) {
                throw new RuntimeException("「{$label}」の時刻が読み取れません（例 8:30）。");
            }
            $out[$k]['time'] = sprintf('%02d:%02d', $mm[1], $mm[2]);
        }
    }
    if (mb_strlen(json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) > 1900) {
        throw new RuntimeException('文面が長すぎます。短くしてください。');
    }
    return $out;
}

function slack_cfg_save(array $in): array
{
    $clean = slack_cfg_clean($in);
    slack_meta_set('slack_cfg', json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    return slack_cfg();
}

/** 差し込み文字を置き換える。置き換えた結果が空になった行（{リンク} が無いときなど）は、行ごと消す */
function slack_render(string $tpl, array $vars): string
{
    $out = [];
    foreach (explode("\n", str_replace("\r", '', $tpl)) as $line) {
        $r = strtr($line, $vars);
        if (trim($r) === '' && trim($line) !== '') {
            continue;
        }
        $out[] = $r;
    }
    return rtrim(implode("\n", $out));
}

function slack_person(array $u): string
{
    return !empty($u['slack_id']) && slack_cfg()['mention'] ? '<@' . $u['slack_id'] . '>' : $u['name'];
}

/** 通知のリンク先の、元になるフォルダのURL（base_url の末尾の index.php などは外し、最後を / にそろえる） */
function slack_base_dir(): string
{
    $base = trim((string)cfg('base_url', ''));
    if ($base === '') {
        return '';
    }
    $base = preg_replace('#/[^/]*\.php$#', '/', $base);
    return rtrim($base, '/') . '/';
}

/**
 * 通知の「スケジュールを開く」の飛び先。
 *   会社用の共有リンクがあれば、それ（ログインなしで、業務版のカレンダーを見られる）
 *   なければ、ログイン後に業務版が開く入口（index.php?view=team）
 *   base_url が空なら、リンクなし
 */
function slack_open_url(): string
{
    $dir = slack_base_dir();
    if ($dir === '') {
        return '';
    }
    try {
        $l = row('SELECT token FROM share_links WHERE kind = ? AND owner_id = 0', ['company']);
    } catch (Throwable $e) {
        $l = null;
    }
    if ($l && preg_match('/^[a-f0-9]{48}$/', (string)$l['token'])) {
        return $dir . 'share.php?t=' . $l['token'];
    }
    return $dir . 'index.php?view=team';
}

/** 'company'（会社用リンク）／'login'（ログインして業務版）／'none'（リンクなし） */
function slack_link_kind(): string
{
    $u = slack_open_url();
    return $u === '' ? 'none' : (strpos($u, 'share.php?t=') !== false ? 'company' : 'login');
}

/** 通知に差し込む「スケジュールを開く」のリンク（base_url が空なら、空） */
function slack_link_text(): string
{
    $u = slack_open_url();
    return $u !== '' ? "<{$u}|スケジュールを開く>" : '';
}

function off_line(array $e, string $who, ?array $cfg = null): string
{
    $range = $e['start_date'] === $e['end_date']
        ? md_ja($e['start_date'])
        : md_ja($e['start_date']) . '〜' . md_ja($e['end_date']);
    return strtr(($cfg ?? slack_cfg())['line'], ['{名前}' => $who, '{分類}' => $e['tag'] !== '' ? $e['tag'] : '休み', '{期間}' => $range]);
}

/** 「休みを登録したとき」の通知の本文 */
function slack_register_text(array $lines, string $actorNote, ?array $cfg = null): string
{
    $cfg = $cfg ?? slack_cfg();
    return slack_render($cfg['reg']['tpl'], ['{休み一覧}' => implode("\n", $lines), '{件数}' => (string)count($lines), '{登録した人}' => $actorNote, '{リンク}' => slack_link_text()]);
}

/** 朝・夕方の通知の本文（$kind: 'morning' | 'evening'） */
function slack_day_text(string $kind, string $date, array $lines, ?array $cfg = null): string
{
    $cfg = $cfg ?? slack_cfg();
    return slack_render($cfg[$kind]['tpl'], ['{日付}' => md_ja($date), '{休み一覧}' => implode("\n", $lines), '{人数}' => (string)count($lines), '{リンク}' => slack_link_text()]);
}

/** 休みが登録されたときの通知（件名と日付だけを送る）。複数件は1通にまとめる */
function notify_offs_registered(array $events, array $owner, array $actor): void
{
    if (!$events || !slack_cfg()['reg']['on']) {
        return;
    }
    $note = (int)$owner['id'] !== (int)$actor['id'] ? "（{$actor['name']} さんが登録）" : '';
    $lines = [];
    foreach ($events as $e) {
        $lines[] = off_line($e, slack_person($owner));
    }
    slack_post(slack_register_text($lines, $note));
}

function notify_off_registered(array $event, array $owner, array $actor): void
{
    notify_offs_registered([$event], $owner, $actor);
}

/** その日の休みをまとめて通知（$label は「本日」「明日」） */
function notify_offs_for_day(string $date, string $label): int
{
    $kind = $label === '本日' ? 'morning' : 'evening';
    if (!slack_cfg()[$kind]['on']) {
        return 0; // 画面でこの通知を止めている
    }
    $offs = rows("SELECT e.*, u.name AS owner_name, u.slack_id AS owner_slack FROM events e JOIN users u ON u.id = e.owner_id
                  WHERE e.kind = 'off' AND e.start_date <= ? AND e.end_date >= ? AND u.active = 1 ORDER BY u.name", [$date, $date]);
    if (!$offs) {
        return 0;
    }
    $ref = ($kind === 'morning' ? 'today:' : 'tomorrow:') . $date;
    if (!notify_once($ref)) {
        return 0;
    }
    $lines = [];
    foreach ($offs as $e) {
        $lines[] = off_line($e, slack_person(['name' => $e['owner_name'], 'slack_id' => $e['owner_slack']]));
    }
    $ok = slack_post(slack_day_text($kind, $date, $lines));
    if (!$ok && slack_enabled()) {
        q('DELETE FROM notification_log WHERE ref = ?', [$ref]); // 送れなかったので次回やり直せるようにする
    }
    return count($offs);
}

/**
 * 時刻を過ぎた朝・夕方の通知を送る。cron から5〜10分おきに呼ぶ（bin/cron.php notify）。
 * 設定した時刻から3時間以内で、まだ送っていなければ送る（同じ日に二重には送らない。土日祝・会社の休業日は送らない）
 * @return string[] 実行結果のメッセージ
 */
function notify_due(?int $now = null): array
{
    $now = $now ?? time();
    $cal = BizCalendar::fromDb();
    $cfg = slack_cfg();
    $msg = [];
    foreach (['morning' => ['本日', 0], 'evening' => ['明日', 1]] as $kind => [$label, $plus]) {
        if (!$cfg[$kind]['on']) {
            continue;
        }
        $due = strtotime(date('Y-m-d', $now) . ' ' . $cfg[$kind]['time'] . ':00');
        if ($now < $due || $now >= $due + 3 * 3600) {
            continue; // まだ時刻前、または3時間以上過ぎた
        }
        $date = date('Y-m-d', strtotime("+{$plus} day", $now));
        if (!$cal->isBusinessDay($date)) {
            continue;
        }
        $n = notify_offs_for_day($date, $label);
        if ($n > 0) {
            $msg[] = "{$label}の休み: {$n} 件を通知しました";
        }
    }
    return $msg;
}

/** 設定画面のプレビュー（まだ保存していない入力のまま、3つの通知の見本文を作る。実在の社員は使わない） */
function slack_preview(array $cfg): array
{
    $today = date('Y-m-d');
    $tomorrow = date('Y-m-d', strtotime('+1 day'));
    $nm = function ($e, $who) use ($cfg) { return off_line($e, $who, $cfg); };
    $a = ['start_date' => $today, 'end_date' => $today, 'tag' => '有給'];
    $b = ['start_date' => $today, 'end_date' => $tomorrow, 'tag' => '調整休'];
    $who1 = $cfg['mention'] ? '@山田 花子' : '山田 花子';
    $who2 = $cfg['mention'] ? '@鈴木 一郎' : '鈴木 一郎';
    return [
        'reg' => slack_register_text([$nm($a, $who1)], '（鈴木 一郎 さんが登録）', $cfg),
        'morning' => slack_day_text('morning', $today, [$nm($a, $who1), $nm($b, $who2)], $cfg),
        'evening' => slack_day_text('evening', $tomorrow, [$nm($b, $who2)], $cfg),
    ];
}

/** テスト送信の文面。$kind: 'simple' = 接続の確認 / 'sample'（休みの登録）・'morning'・'evening' = 実際の通知と同じ文面の見本 */
function slack_test_message(string $kind, array $user): string
{
    $name = (string)cfg('app_name', 'スケジュール管理');
    if ($kind === 'simple') {
        return "【{$name}】Slack通知のテストです。この通知が見えていれば、設定は正しくできています。（{$user['name']} さんが送信・" . date('Y/m/d H:i') . '）';
    }
    $head = "※これはテスト送信です（{$user['name']} さんが、通知の見本を送りました）\n";
    if ($kind === 'sample') {
        $today = date('Y-m-d');
        return $head . slack_register_text([off_line(['start_date' => $today, 'end_date' => $today, 'tag' => '有給'], slack_person($user))], '');
    }
    $kind = $kind === 'evening' ? 'evening' : 'morning';
    $date = date('Y-m-d', strtotime($kind === 'evening' ? '+1 day' : 'today'));
    return $head . slack_day_text($kind, $date, [off_line(['start_date' => $date, 'end_date' => $date, 'tag' => '有給'], slack_person($user))]);
}
