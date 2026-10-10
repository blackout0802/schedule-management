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

function slack_person(array $u): string
{
    return !empty($u['slack_id']) ? '<@' . $u['slack_id'] . '>' : $u['name'];
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

function slack_link_suffix(): string
{
    $u = slack_open_url();
    return $u !== '' ? "\n<{$u}|スケジュールを開く>" : '';
}

function off_line(array $e, string $who): string
{
    $range = $e['start_date'] === $e['end_date']
        ? md_ja($e['start_date'])
        : md_ja($e['start_date']) . '〜' . md_ja($e['end_date']);
    return '• ' . $who . '　' . ($e['tag'] !== '' ? $e['tag'] : '休み') . '　' . $range;
}

/** 休みが登録されたときの通知（件名と日付だけを送る）。複数件は1通にまとめる */
function notify_offs_registered(array $events, array $owner, array $actor): void
{
    if (!$events) {
        return;
    }
    $by = (int)$owner['id'] !== (int)$actor['id'] ? "\n（{$actor['name']} さんが登録）" : '';
    $lines = [];
    foreach ($events as $e) {
        $lines[] = off_line($e, slack_person($owner));
    }
    slack_post("【休みの登録】\n" . implode("\n", $lines) . $by . slack_link_suffix());
}

function notify_off_registered(array $event, array $owner, array $actor): void
{
    notify_offs_registered([$event], $owner, $actor);
}

/** その日の休みをまとめて通知（$label は「本日」「明日」） */
function notify_offs_for_day(string $date, string $label): int
{
    $offs = rows("SELECT e.*, u.name AS owner_name, u.slack_id AS owner_slack FROM events e JOIN users u ON u.id = e.owner_id
                  WHERE e.kind = 'off' AND e.start_date <= ? AND e.end_date >= ? AND u.active = 1 ORDER BY u.name", [$date, $date]);
    if (!$offs) {
        return 0;
    }
    $ref = ($label === '本日' ? 'today:' : 'tomorrow:') . $date;
    if (!notify_once($ref)) {
        return 0;
    }
    $lines = [];
    foreach ($offs as $e) {
        $who = !empty($e['owner_slack']) ? '<@' . $e['owner_slack'] . '>' : $e['owner_name'];
        $lines[] = off_line($e, $who);
    }
    $ok = slack_post("【{$label}のお休み】" . md_ja($date) . "\n" . implode("\n", $lines) . slack_link_suffix());
    if (!$ok && slack_enabled()) {
        q('DELETE FROM notification_log WHERE ref = ?', [$ref]); // 送れなかったので次回やり直せるようにする
    }
    return count($offs);
}


/** テスト送信の文面。$kind: 'simple' = 接続の確認 / 'sample' = 実際の「休みの登録」通知と同じ形の見本 */
function slack_test_message(string $kind, array $user): string
{
    $name = (string)cfg('app_name', 'スケジュール管理');
    if ($kind === 'sample') {
        $today = date('Y-m-d');
        $e = ['start_date' => $today, 'end_date' => $today, 'tag' => '有給'];
        return "【休みの登録】（これはテスト送信です）\n" . off_line($e, slack_person($user)) . "\n（{$user['name']} さんが、通知の見本を送りました）" . slack_link_suffix();
    }
    return "【{$name}】Slack通知のテストです。この通知が見えていれば、設定は正しくできています。（{$user['name']} さんが送信・" . date('Y/m/d H:i') . '）';
}
