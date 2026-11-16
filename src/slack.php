<?php
// Slack の Incoming Webhook へ通知する。失敗してもアプリの動作は止めない。

// 送り先（Incoming Webhook）は、チャンネル名を付けて複数登録でき、送り先ごとに「送る」を選ぶ（選んだ全部に、同じ通知を送る。v1.114.0〜）。
//   app_meta.slack_dests  … 登録した送り先の一覧（JSON: [{id,name,url}]）
//   app_meta.slack_send   … 通知を送る送り先の id の一覧（JSON: ["id", …]。'config' は config.php の設定）。v1.114.0〜
//   app_meta.slack_active … v1.113.0 までの「使う送り先」（1つ）。slack_send がまだ無いときは、これを使う
//   app_meta.slack_last   … 送り先ごとの、最後に送った結果（JSON: {id: {at, ok, err}}）
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

/** 使う送り先の id（v1.113.0 までの1つだけの選び方）。選ばれていない／消えているときは、登録の先頭、なければ config.php */
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

/** 選べる送り先の全部（config.php の設定があれば、先頭に 'config'）。[{id,name,url}] */
function slack_all_dests(): array
{
    $all = [];
    $c = (string)cfg('slack_webhook', '');
    if ($c !== '') {
        $all[] = ['id' => 'config', 'name' => 'config.php の設定', 'url' => $c];
    }
    return array_merge($all, slack_dests());
}

/** 通知を送る送り先の id（並びは一覧の順）。まだ選んだことがなければ、v1.113.0 までの「使う送り先」1つ */
function slack_send_ids(): array
{
    $raw = slack_meta_get('slack_send');
    if ($raw === '') {
        $a = slack_active_id();
        return $a === '' ? [] : [$a];
    }
    $j = json_decode($raw, true);
    $want = is_array($j) ? array_map('strval', $j) : [];
    $out = [];
    foreach (slack_all_dests() as $d) {
        if (in_array($d['id'], $want, true)) {
            $out[] = $d['id'];
        }
    }
    return $out;
}

function slack_send_ids_save(array $ids): void
{
    slack_meta_set('slack_send', json_encode(array_values(array_unique($ids))));
}

/** 通知を送る送り先 [{id,name,url}] */
function slack_targets(): array
{
    $ids = slack_send_ids();
    return array_values(array_filter(slack_all_dests(), function ($d) use ($ids) { return in_array($d['id'], $ids, true); }));
}

/** 通知を送る送り先の、先頭の URL（なければ空） */
function slack_webhook_url(): string
{
    $t = slack_targets();
    return $t ? $t[0]['url'] : '';
}

function slack_enabled(): bool
{
    return slack_targets() !== [];
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
    $ids = slack_send_ids();
    $d = ['id' => bin2hex(random_bytes(4)), 'name' => $name, 'url' => $url];
    $list[] = $d;
    if (mb_strlen(json_encode($list, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) > 1900) { // 保存先の欄（2000文字）に収まらない
        throw new RuntimeException('登録が多すぎます。使わないものを削除してください。');
    }
    slack_dests_save($list);
    // 送る送り先がまだ無ければ、足した送り先に送る。あれば、いまの選び方のまま（足した送り先は、チェックを入れると送る）
    slack_send_ids_save($hadActive ? $ids : [$d['id']]);
    return $d;
}

function slack_dest_delete(string $id): void
{
    $list = slack_dests();
    $keep = array_values(array_filter($list, function ($d) use ($id) { return $d['id'] !== $id; }));
    if (count($keep) === count($list)) {
        throw new RuntimeException('その送り先は、登録にありません。');
    }
    $ids = slack_send_ids();
    $wasOn = in_array($id, $ids, true);
    slack_dests_save($keep);
    $ids = array_values(array_diff($ids, [$id]));
    if ($wasOn && !$ids) { // 送っていた送り先が無くなったら、残りの先頭（なければ config.php）に送る
        if ($keep) {
            $ids = [$keep[0]['id']];
        } elseif ((string)cfg('slack_webhook', '') !== '') {
            $ids = ['config'];
        }
    }
    slack_send_ids_save($ids);
    slack_last_forget($id);
}

/** 登録にある送り先か（'config' は config.php の設定）。無ければ RuntimeException */
function slack_dest_must(string $id): array
{
    foreach (slack_all_dests() as $d) {
        if ($d['id'] === $id) {
            return $d;
        }
    }
    throw new RuntimeException($id === 'config' ? 'config.php には、送り先が設定されていません。' : 'その送り先は、登録にありません。');
}

/** その送り先だけに送る（ほかの送り先は外す）。'config' は config.php の設定 */
function slack_dest_use(string $id): void
{
    slack_dest_must($id);
    slack_send_ids_save([$id]);
}

/** 送り先ごとに、通知を「送る／送らない」を切り替える */
function slack_dest_send(string $id, bool $on): void
{
    slack_dest_must($id);
    $ids = array_values(array_diff(slack_send_ids(), [$id]));
    if ($on) {
        $ids[] = $id;
    }
    slack_send_ids_save($ids);
}

/** 送り先ごとの、最後に送った結果 {id: {at, ok, err}} */
function slack_last_all(): array
{
    $j = json_decode(slack_meta_get('slack_last'), true);
    return is_array($j) ? $j : [];
}

function slack_last_record(string $id, array $r): void
{
    $all = slack_last_all();
    $err = $r['ok'] ? '' : ($r['error'] !== '' ? $r['error'] : trim('HTTP ' . $r['code'] . ' ' . $r['body']));
    $all[$id] = ['at' => date('Y-m-d H:i:s'), 'ok' => (bool)$r['ok'], 'err' => mb_substr($err, 0, 60)];
    try {
        slack_meta_set('slack_last', json_encode($all, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    } catch (Throwable $e) {
        // 記録できなくても、通知は止めない
    }
}

function slack_last_forget(string $id): void
{
    $all = slack_last_all();
    if (isset($all[$id])) {
        unset($all[$id]);
        slack_meta_set('slack_last', $all ? json_encode($all, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '');
    }
}

function slack_mask(string $url): string
{
    if ($url === '') {
        return '';
    }
    $p = parse_url($url);
    return ($p['scheme'] ?? 'https') . '://' . ($p['host'] ?? '') . '/…' . substr($url, -4);
}

/** 送り先の状態。URL そのものは返さず、伏せた形だけ返す。active・active_name は、送る送り先の先頭と、名前を「・」でつないだもの */
function slack_status(): array
{
    $ids = slack_send_ids();
    $last = slack_last_all();
    $dests = array_map(function ($d) use ($ids, $last) {
        return ['id' => $d['id'], 'name' => $d['name'], 'masked' => slack_mask($d['url']), 'send' => in_array($d['id'], $ids, true), 'last' => $last[$d['id']] ?? null];
    }, slack_all_dests());
    $names = array_column(array_filter($dests, function ($d) { return $d['send']; }), 'name');
    $active = $ids ? $ids[0] : '';
    $mask = '';
    foreach ($dests as $d) {
        if ($d['id'] === $active) {
            $mask = $d['masked'];
        }
    }
    return ['configured' => $ids !== [], 'active' => $active, 'active_name' => implode('・', $names), 'masked' => $mask, 'send' => $ids, 'dests' => $dests,
        'source' => $active === '' ? 'none' : ($active === 'config' && count($ids) === 1 ? 'config' : 'ui'),
        'base_url' => (string)cfg('base_url', '') !== '', 'link' => slack_link_kind(), 'sched' => slack_test_state(), 'cron' => cron_commands()];
}

/**
 * サーバーの cron に登録するコマンド（このサーバーでの、cron.php の本当の場所と、動いている PHP の版から作る）。
 * PHP のパスは候補（/usr/bin/php8.3 のような形）。サーバーの Cron 設定の画面に例があれば、そちらに合わせる
 * @return array{php:string,script:string,notify:string,nightly:string}
 */
function cron_commands(): array
{
    $php = '/usr/bin/php' . PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;
    $script = realpath(APP_ROOT . '/bin/cron.php') ?: APP_ROOT . '/bin/cron.php';
    return ['php' => $php, 'script' => $script, 'notify' => $php . ' ' . $script . ' notify', 'nightly' => $php . ' ' . $script . ' nightly'];
}

/**
 * 1つの送り先に送り、結果を詳しく返す。
 * @return array{ok:bool,code:int,error:string,body:string}
 */
function slack_post_to(string $url, string $text): array
{
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

/**
 * 通知を、送る送り先の全部に送り（$only を渡すと、その送り先だけ）、結果を詳しく返す（テスト送信用）。
 * ok = 全部に送れた。any = 1つでも送れた。results = 送り先ごとの結果。code・error・body は、最初に失敗した送り先のもの（全部送れたら、先頭のもの）
 * @return array{ok:bool,any:bool,code:int,error:string,body:string,results:array}
 */
function slack_post_detailed(string $text, ?string $only = null): array
{
    $targets = $only !== null ? array_values(array_filter(slack_all_dests(), function ($d) use ($only) { return $d['id'] === $only; })) : slack_targets();
    if (!$targets) {
        return ['ok' => false, 'any' => false, 'code' => 0, 'error' => '送り先（Webhook URL）が設定されていません。', 'body' => '', 'results' => []];
    }
    $results = [];
    $first = null;
    $any = false;
    $all = true;
    foreach ($targets as $d) {
        $r = slack_post_to($d['url'], $text);
        slack_last_record($d['id'], $r);
        $results[] = ['id' => $d['id'], 'name' => $d['name']] + $r;
        $any = $any || $r['ok'];
        $all = $all && $r['ok'];
        if ($first === null && !$r['ok']) {
            $first = $r;
        }
    }
    $first = $first ?? $results[0];
    $error = $first['error'];
    if (!$all && count($targets) > 1) { // どこに送れなかったかを、名前で添える
        $ng = array_column(array_filter($results, function ($r) { return !$r['ok']; }), 'name');
        $error = '送れなかった送り先: ' . implode('・', $ng) . ($error !== '' ? '（' . $error . '）' : '');
    }
    return ['ok' => $all, 'any' => $any, 'code' => $first['code'], 'error' => $error, 'body' => $first['body'], 'results' => $results];
}

/**
 * 通知を、送る送り先の全部に送る。1つでも送れたら true（送れなかった送り先は、送り先ごとの結果に残し、画面で分かるようにする。
 * 全部に送り直すと、送れた送り先に同じ通知が二重に届くため、やり直すのは、どこにも送れなかったときだけ）
 */
function slack_post(string $text): bool
{
    if (!slack_enabled()) {
        return false;
    }
    return slack_post_detailed($text)['any'];
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
    'day' => ['{日付}', '{休み一覧}', '{人数}', '{リンク}'],
];

function slack_cfg_defaults(): array
{
    return [
        'line' => '• {名前}',
        'empty' => ['on' => true, 'text' => '休みなし'], // 営業日で、休みの人がいないとき、{休み一覧} の代わりに出す
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
    // 以前の初期値（名前・分類・期間）のまま保存されていたものは、新しい初期値（名前だけ）にする
    if (isset($j['line']) && is_string($j['line']) && $j['line'] !== '' && $j['line'] !== '• {名前}　{分類}　{期間}') {
        $d['line'] = $j['line'];
    }
    if (isset($j['empty']) && is_array($j['empty'])) {
        $d['empty']['on'] = isset($j['empty']['on']) ? (bool)$j['empty']['on'] : $d['empty']['on'];
        if (isset($j['empty']['text']) && is_string($j['empty']['text']) && trim($j['empty']['text']) !== '') {
            $d['empty']['text'] = $j['empty']['text'];
        }
    }
    foreach (['morning', 'evening'] as $k) {
        if (!isset($j[$k]) || !is_array($j[$k])) {
            continue;
        }
        $d[$k]['on'] = isset($j[$k]['on']) ? (bool)$j[$k]['on'] : $d[$k]['on'];
        if (isset($j[$k]['tpl']) && is_string($j[$k]['tpl']) && $j[$k]['tpl'] !== '') {
            $d[$k]['tpl'] = $j[$k]['tpl'];
        }
        if (isset($j[$k]['time']) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string)$j[$k]['time'])) {
            $d[$k]['time'] = $j[$k]['time'];
        }
    }
    return $d;
}

/** 画面から来た設定を検べて、保存できる形にする。問題があれば RuntimeException（画面に出せる文） */
function slack_cfg_clean(array $in): array
{
    $d = slack_cfg_defaults();
    $out = [];
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
    $em = is_array($in['empty'] ?? null) ? $in['empty'] : [];
    $emText = trim(preg_replace('/\s+/u', ' ', (string)($em['text'] ?? $d['empty']['text'])));
    if ($emText === '' || mb_strlen($emText) > 50) {
        throw new RuntimeException('「休みの人がいない日」の表示は、50文字以内で入力してください（例: 休みなし）。');
    }
    $out['empty'] = ['on' => !empty($em['on']), 'text' => $emText];
    $names = ['morning' => '朝の通知（本日の休み）', 'evening' => '夕方の通知（明日の休み）'];
    foreach ($names as $k => $label) {
        $x = is_array($in[$k] ?? null) ? $in[$k] : [];
        $out[$k] = ['on' => !empty($x['on']), 'tpl' => $check($label, $x['tpl'] ?? $d[$k]['tpl'], SLACK_PLACEHOLDERS['day'], true, 250)];
        $t = (string)($x['time'] ?? $d[$k]['time']);
        if (!preg_match('/^([01]?\d|2[0-3]):([0-5]\d)$/', $t, $mm)) {
            throw new RuntimeException("「{$label}」の時刻が読み取れません（例 8:30）。");
        }
        $out[$k]['time'] = sprintf('%02d:%02d', $mm[1], $mm[2]);
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

/** 朝・夕方の通知の本文（$kind: 'morning' | 'evening'） */
function slack_day_text(string $kind, string $date, array $lines, ?array $cfg = null): string
{
    $cfg = $cfg ?? slack_cfg();
    $list = $lines ? implode("\n", $lines) : $cfg['empty']['text']; // 休みの人がいないときは、「休みなし」など
    return slack_render($cfg[$kind]['tpl'], ['{日付}' => md_ja($date), '{休み一覧}' => $list, '{人数}' => (string)count($lines), '{リンク}' => slack_link_text()]);
}

/** その日の休みをまとめて通知（$label は「本日」「明日」） */
function notify_offs_for_day(string $date, string $label, ?bool &$sent = null): int
{
    $sent = false;
    $kind = $label === '本日' ? 'morning' : 'evening';
    if (!slack_cfg()[$kind]['on']) {
        return 0; // 画面でこの通知を止めている
    }
    $offs = rows("SELECT e.*, u.name AS owner_name FROM events e JOIN users u ON u.id = e.owner_id
                  WHERE e.kind = 'off' AND e.start_date <= ? AND e.end_date >= ? AND u.active = 1 ORDER BY u.name", [$date, $date]);
    if (!$offs && !slack_cfg()['empty']['on']) {
        return 0; // 休みの人がいない日は、送らない設定
    }
    $ref = ($kind === 'morning' ? 'today:' : 'tomorrow:') . $date;
    if (!notify_once($ref)) {
        return 0;
    }
    $lines = [];
    foreach ($offs as $e) {
        $lines[] = off_line($e, $e['owner_name']);
    }
    $sent = true;
    $ok = slack_post(slack_day_text($kind, $date, $lines));
    if (!$ok && slack_enabled()) {
        q('DELETE FROM notification_log WHERE ref = ?', [$ref]); // 送れなかったので次回やり直せるようにする
    }
    return count($offs);
}

/**
 * 時刻を過ぎた朝・夕方の通知を送る。cron から10分おきに呼ぶ（bin/cron.php notify。次の cron までに送る予定があれば、その時刻まで待って送る: notify_wait）。
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
        $n = notify_offs_for_day($date, $label, $sent);
        if ($sent) {
            $msg[] = $n > 0 ? "{$label}の休み: {$n} 件を通知しました" : "{$label}は休みなしと通知しました";
        }
    }
    return array_merge($msg, rooms_notify_due($now), slack_test_due($now), inspect_issue_due($now), inspect_notify_due($now)); // 会議室の予約（前日の夕方・当日の朝）／時刻を指定したテスト送信／年間点検の起票とアラート
}

// ---- 時刻ちょうどに送る ----
//   cron（notify）は10分おきなので、時刻を過ぎてから次に cron が動くまで、送るのが最大10分遅れる。
//   そこで、cron が動いたとき、次の cron までに送る予定（朝・夕方の通知・会議室の通知・テスト送信）があれば、
//   その時刻まで待ってから送る（bin/cron.php notify。待つ長さは config.php の notify_wait（分。初期値10。0 なら待たない））。
//   待っているあいだに次の cron が動いても、notify_once などで、二重には送らない。

/** これから送る予定の時刻（$now より後で、$now + $window 秒まで）。土日祝などで実際に送るかは、その時刻に notify_due が決める */
function notify_upcoming(int $now, int $window): array
{
    $end = $now + $window;
    $ts = [];
    $add = function (int $t) use (&$ts, $now, $end) {
        if ($t > $now && $t <= $end) {
            $ts[$t] = true;
        }
    };
    $days = array_unique([date('Y-m-d', $now), date('Y-m-d', $end)]); // 日付をまたぐときは、次の日の分も
    $cfg = slack_cfg();
    $rc = rooms_cfg();
    foreach ($days as $d) {
        foreach (['morning', 'evening'] as $k) {
            if ($cfg[$k]['on']) {
                $add(strtotime($d . ' ' . $cfg[$k]['time'] . ':00'));
            }
        }
        foreach (['notify_prev', 'notify_today'] as $k) {
            if ($rc[$k]['on']) {
                $add(strtotime($d . ' ' . $rc[$k]['time'] . ':00'));
            }
        }
    }
    foreach (rows('SELECT bdate, start_time FROM room_bookings WHERE notify_pre = 1 AND bdate BETWEEN ? AND ?', [date('Y-m-d', $now), date('Y-m-d', strtotime('+1 day', $end))]) as $b) {
        $add(strtotime($b['bdate'] . ' ' . $b['start_time'] . ':00') - 3600); // 会議室の1時間前の通知
    }
    $p = slack_test_state($now)['pending'];
    if ($p) {
        $add(strtotime($p['at'] . ':00'));
    }
    $ts = array_keys($ts);
    sort($ts);
    return $ts;
}

/**
 * 次の cron までに送る予定があれば、その時刻まで待ってから送る。$waitUntil($t) は、$t まで待って、いまの時刻を返す（試験では、待たずに $t を返す）。
 * @return string[] 実行結果のメッセージ
 */
function notify_wait(int $now, int $window, callable $waitUntil): array
{
    $msg = [];
    foreach (notify_upcoming($now, $window) as $t) {
        $now = $waitUntil($t);
        $msg = array_merge($msg, notify_due($now));
    }
    return $msg;
}

// ---- 時刻を指定したテスト送信（cron が、決まった時刻に通知を送れるかの確認）----
//   管理者が時刻を予約すると、その時刻を過ぎたあと、cron（bin/cron.php notify）が動いたときに、テスト通知を1回だけ送る。
//   朝・夕方の通知と同じ仕組みで送るので、「決まった時間に届くか」を確かめられる。土日祝でも送る。
//   app_meta.slack_test_at   … 予約（JSON: {at: 'Y-m-d H:i', by: 予約した人, made: 予約した日時, id: 予約ごとの番号（二重送信の防止用）}）。1件だけ
//   app_meta.slack_test_last … 最後の結果（JSON: {at, sent_at, ok, error, by}）
const SLACK_TEST_GRACE = 3 * 3600; // 予定の時刻から、この時間を過ぎても cron が動かなければ、送らずに「送れなかった」とする
const SLACK_TEST_LATE = 15 * 60;   // 予定の時刻から、この時間を過ぎても送られていなければ、画面で「cron が動いていないかも」と知らせる

/** 時刻（HH:MM）を予約する。いまより後の、いちばん近いその時刻（今日か明日）。予約は1件だけ（前の予約は置き換える） */
function slack_test_schedule(string $time, array $user, ?int $now = null): array
{
    if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time)) {
        throw new RuntimeException('時刻を「09:30」のように入れてください。');
    }
    if (!slack_enabled()) {
        throw new RuntimeException('送り先（Webhook URL）がまだ設定されていません。');
    }
    $now = $now ?? time();
    $at = strtotime(date('Y-m-d', $now) . ' ' . $time . ':00');
    if ($at <= $now) {
        $at = strtotime('+1 day', $at);
    }
    slack_meta_set('slack_test_at', json_encode(['at' => date('Y-m-d H:i', $at), 'by' => (string)$user['name'], 'made' => date('Y-m-d H:i:s', $now), 'id' => bin2hex(random_bytes(6))], JSON_UNESCAPED_UNICODE));
    return slack_test_state($now);
}

function slack_test_cancel(): void
{
    slack_meta_set('slack_test_at', '');
}

/** 予約と、前回の結果と、cron（notify）が最後に動いた日時。late = 予定の時刻を過ぎても、まだ送られていない */
function slack_test_state(?int $now = null): array
{
    $now = $now ?? time();
    $p = json_decode(slack_meta_get('slack_test_at'), true);
    $l = json_decode(slack_meta_get('slack_test_last'), true);
    $p = is_array($p) && isset($p['at']) ? $p : null;
    return ['pending' => $p, 'last' => is_array($l) ? $l : null, 'cron_at' => slack_meta_get('cron_notify_at') ?: null,
        'late' => $p !== null && $now >= strtotime($p['at'] . ':00') + SLACK_TEST_LATE];
}

/** cron（notify）から呼ぶ。予約の時刻を過ぎていれば、テスト通知を送る。@return string[] 実行結果のメッセージ */
function slack_test_due(?int $now = null): array
{
    $now = $now ?? time();
    $p = slack_test_state($now)['pending'];
    if (!$p) {
        return [];
    }
    $at = strtotime($p['at'] . ':00');
    if ($now < $at) {
        return [];
    }
    if (!notify_once('slacktest:' . ($p['id'] ?? $p['at']))) {
        return []; // 同時に動いた別の cron が、もう送った
    }
    slack_test_cancel();
    if ($now >= $at + SLACK_TEST_GRACE) {
        slack_meta_set('slack_test_last', json_encode(['at' => $p['at'], 'sent_at' => null, 'ok' => false, 'by' => $p['by'],
            'error' => '予定の時刻から3時間以内に、cron（notify）が動かなかったため、送っていません。'], JSON_UNESCAPED_UNICODE));
        return ['時刻を指定したテスト送信: 予定の時刻から3時間を過ぎたため、送りませんでした'];
    }
    $name = (string)cfg('app_name', 'スケジュール管理');
    $md = function (int $t): string { return (int)date('n', $t) . '/' . (int)date('j', $t) . ' ' . date('H:i', $t); };
    $text = "【{$name}】時刻を指定したテスト送信です。\n予定の時刻: " . $md($at) . '　／　送った時刻: ' . $md($now) . "（cron が自動で送りました）\n"
        . "この通知が届いていれば、決まった時間の通知（朝・夕方のお休みの通知など）も届きます。（予約: {$p['by']} さん）";
    $r = slack_post_detailed($text);
    slack_meta_set('slack_test_last', json_encode(['at' => $p['at'], 'sent_at' => date('Y-m-d H:i', $now), 'ok' => $r['ok'], 'by' => $p['by'],
        'error' => $r['ok'] ? '' : ($r['error'] !== '' ? $r['error'] : 'HTTP ' . $r['code'])], JSON_UNESCAPED_UNICODE));
    return ['時刻を指定したテスト送信: ' . ($r['ok'] ? '送りました' : '送れませんでした')];
}

/** 設定画面のプレビュー（まだ保存していない入力のまま、3つの通知の見本文を作る。実在の社員は使わない） */
function slack_preview(array $cfg): array
{
    $today = date('Y-m-d');
    $tomorrow = date('Y-m-d', strtotime('+1 day'));
    $nm = function ($e, $who) use ($cfg) { return off_line($e, $who, $cfg); };
    $a = ['start_date' => $today, 'end_date' => $today, 'tag' => '有給'];
    $b = ['start_date' => $today, 'end_date' => $tomorrow, 'tag' => '調整休'];
    return [
        'morning' => slack_day_text('morning', $today, [$nm($a, '山田 花子'), $nm($b, '鈴木 一郎')], $cfg),
        'evening' => slack_day_text('evening', $tomorrow, [$nm($b, '鈴木 一郎')], $cfg),
        'none' => slack_day_text('morning', $today, [], $cfg),
    ];
}

/** テスト送信の文面。$kind: 'simple' = 接続の確認 / 'morning'・'evening' = 実際の通知と同じ文面の見本 */
function slack_test_message(string $kind, array $user): string
{
    $name = (string)cfg('app_name', 'スケジュール管理');
    if ($kind === 'simple') {
        return "【{$name}】Slack通知のテストです。この通知が見えていれば、設定は正しくできています。（{$user['name']} さんが送信・" . date('Y/m/d H:i') . '）';
    }
    $kind = $kind === 'evening' ? 'evening' : 'morning';
    $date = date('Y-m-d', strtotime($kind === 'evening' ? '+1 day' : 'today'));
    $head = "※これはテスト送信です（{$user['name']} さんが、通知の見本を送りました）\n";
    return $head . slack_day_text($kind, $date, [off_line(['start_date' => $date, 'end_date' => $date, 'tag' => '有給'], $user['name'])]);
}
