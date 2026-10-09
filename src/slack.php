<?php
// Slack の Incoming Webhook へ通知する。失敗してもアプリの動作は止めない。

function slack_enabled(): bool
{
    return (string)cfg('slack_webhook', '') !== '';
}

function slack_post(string $text): bool
{
    if (!slack_enabled()) {
        return false;
    }
    $payload = json_encode(['text' => $text], JSON_UNESCAPED_UNICODE);
    $url = cfg('slack_webhook');
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
            curl_close($ch);
            $ok = $res !== false && $code >= 200 && $code < 300;
        } else {
            $ctx = stream_context_create(['http' => [
                'method' => 'POST', 'header' => "Content-Type: application/json; charset=utf-8\r\n",
                'content' => $payload, 'timeout' => 10, 'ignore_errors' => true,
            ]]);
            $res = @file_get_contents($url, false, $ctx);
            $ok = $res !== false && stripos($res, 'ok') !== false;
        }
        if (!$ok) {
            error_log('[schedule] Slack通知に失敗しました: ' . substr((string)$res, 0, 200));
        }
        return $ok;
    } catch (Throwable $e) {
        error_log('[schedule] Slack通知で例外: ' . $e->getMessage());
        return false;
    }
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

function slack_link_suffix(): string
{
    $base = (string)cfg('base_url', '');
    return $base !== '' ? "\n<{$base}|スケジュールを開く>" : '';
}

function off_line(array $e, string $who): string
{
    $range = $e['start_date'] === $e['end_date']
        ? md_ja($e['start_date'])
        : md_ja($e['start_date']) . '〜' . md_ja($e['end_date']);
    return '• ' . $who . '　' . ($e['tag'] !== '' ? $e['tag'] : '休み') . '　' . $range;
}

/** 休みが登録されたときの通知（件名と日付だけを送る） */
function notify_off_registered(array $event, array $owner, array $actor): void
{
    $by = (int)$owner['id'] !== (int)$actor['id'] ? "\n（{$actor['name']} さんが登録）" : '';
    slack_post("【休みの登録】\n" . off_line($event, slack_person($owner)) . $by . slack_link_suffix());
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
