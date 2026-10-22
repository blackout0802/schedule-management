<?php
// メールの送信（家族の招待メールなど）。サーバーの mail() を使う（SMTP の設定は要らない）。
//   config.php の mail_from: 送信元のメールアドレス（空なら、noreply@ + このサイトのドメイン）。サーバーによっては、自分のドメインのアドレスでないと、届かない
//   config.php の mail_file: 試験用。空でないときは、メールを送らず、このファイルに書き足す（画面テスト・動作の確認用。本番では設定しない）

/** 送信元のメールアドレス */
function mail_from_address(): string
{
    $from = trim((string)cfg('mail_from', ''));
    if ($from !== '' && filter_var($from, FILTER_VALIDATE_EMAIL)) {
        return $from;
    }
    $host = parse_url((string)cfg('base_url', ''), PHP_URL_HOST) ?: preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? ''));
    $host = preg_match('/^[A-Za-z0-9.-]+$/', (string)$host) ? (string)$host : 'localhost';
    return 'noreply@' . $host;
}

/** 件名・名前に入れる文字から、改行などを除く（ヘッダーに別の行を足されないように） */
function mail_clean_line(string $s): string
{
    return trim((string)preg_replace('/[\x00-\x1f\x7f]+/u', ' ', $s));
}

/**
 * メールを1通送る（文字は UTF-8）。送れたら true。宛先が正しくないとき・送信に失敗したときは false（例外は出さない）。
 * 本文はログに残さない（一時パスワードが入ることがあるため）。
 */
function mail_send(string $to, string $subject, string $body): bool
{
    $to = trim($to);
    if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to)) {
        return false;
    }
    $subject = mail_clean_line($subject);
    $from = mail_from_address();
    $fromName = mail_clean_line((string)cfg('app_name', 'スケジュール管理'));
    $body = str_replace(["\r\n", "\r"], "\n", $body);
    $file = trim((string)cfg('mail_file', ''));
    if ($file !== '') { // 試験用: 送らずに、読める形でファイルへ書く
        $text = "To: $to\nFrom: $from\nSubject: $subject\n\n$body\n----\n";
        return @file_put_contents($file, $text, FILE_APPEND | LOCK_EX) !== false;
    }
    $headers = [
        'From: ' . mb_encode_mimeheader($fromName, 'UTF-8', 'B', "\r\n") . ' <' . $from . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
    ];
    $payload = chunk_split(base64_encode(str_replace("\n", "\r\n", $body)), 76, "\r\n");
    try {
        return @mail($to, mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n"), $payload, implode("\r\n", $headers), '-f' . $from);
    } catch (Throwable $e) {
        return false;
    }
}
