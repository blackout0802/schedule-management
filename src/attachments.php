<?php
// ToDoのコメントに付ける画像（スクリーンショットなど）。
//
// ・保存先は data/attachments/（Web からは直接見えない。見るときは、ログインの確認と、そのToDoが見られる人かの確認をしてから、api.php?action=todo_file で返す）
// ・受け付けるのは、画像（PNG / JPEG / GIF / WebP）だけ。中身を調べ（拡張子は信用しない）、GD があれば、描き直して保存する
//   （写真の位置情報などの付随情報を取り除き、画像のふりをした別のものを無効にし、長辺2000pxまでに縮める）。GD が無いときは、2MBまでをそのまま保存
// ・1つのコメントに3枚まで、1つのToDoに30枚まで。コメントやToDoを消すと、画像も消える
// ・バックアップ（暗号化したファイル）には含まれない（画像は、サーバーの data/attachments/ にだけある）

const ATTACH_MAX_PER_COMMENT = 3;
const ATTACH_MAX_PER_TODO = 30;
const ATTACH_MAX_UPLOAD = 6 * 1024 * 1024; // 受け取る1枚の上限（ブラウザ側で縮めてから送るので、ふつうは1MB前後）
const ATTACH_MAX_RAW = 2 * 1024 * 1024;     // GD が無いとき、そのまま保存できる上限
const ATTACH_MAX_SIDE = 2000;
const ATTACH_MAX_PIXELS = 16000000;         // 読み込む画像の大きさの上限（メモリを使い切らないため）

class AttachException extends RuntimeException
{
}

function attach_dir(): string
{
    return dirname(__DIR__) . '/data/attachments';
}

function attach_prepare_dir(): string
{
    $dir = attach_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new AttachException('画像の保存先（data/attachments）を作れません。');
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n");
    }
    return $dir;
}

/** アップロードされた1ファイルを検査して、保存する画像（バイナリ・種類・大きさ）にする */
function attach_process(array $f): array
{
    $codes = [UPLOAD_ERR_INI_SIZE => '画像が大きすぎます（サーバーの上限を超えています）。', UPLOAD_ERR_FORM_SIZE => '画像が大きすぎます。', UPLOAD_ERR_PARTIAL => '画像の送信が途中で途切れました。もう一度お試しください。', UPLOAD_ERR_NO_FILE => '画像が選ばれていません。'];
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new AttachException($codes[$f['error'] ?? UPLOAD_ERR_NO_FILE] ?? '画像を受け取れませんでした。');
    }
    if (!is_uploaded_file($f['tmp_name']) && !(defined('ATTACH_TEST') && is_file($f['tmp_name']))) {
        throw new AttachException('画像を受け取れませんでした。');
    }
    $size = (int)filesize($f['tmp_name']);
    if ($size <= 0 || $size > ATTACH_MAX_UPLOAD) {
        throw new AttachException('画像は ' . (int)(ATTACH_MAX_UPLOAD / 1048576) . 'MB 以下にしてください。');
    }
    $info = @getimagesize($f['tmp_name']);
    $types = [IMAGETYPE_PNG => ['image/png', 'png'], IMAGETYPE_JPEG => ['image/jpeg', 'jpg'], IMAGETYPE_GIF => ['image/gif', 'gif']];
    if (defined('IMAGETYPE_WEBP')) {
        $types[IMAGETYPE_WEBP] = ['image/webp', 'webp'];
    }
    if (!$info || !isset($types[$info[2]]) || $info[0] < 1 || $info[1] < 1) {
        throw new AttachException('画像（PNG・JPEG・GIF・WebP）だけ添付できます。');
    }
    if ($info[0] * $info[1] > ATTACH_MAX_PIXELS) {
        throw new AttachException('画像の大きさ（縦×横）が大きすぎます。縮めてから添付してください。');
    }
    [$mime, $ext] = $types[$info[2]];
    $raw = (string)file_get_contents($f['tmp_name']);
    $name = mb_substr(preg_replace('/[\x00-\x1f\/\\\\]/u', '', (string)($f['name'] ?? '')), 0, 100);

    if (!function_exists('imagecreatefromstring')) {
        if ($size > ATTACH_MAX_RAW) {
            throw new AttachException('画像は ' . (int)(ATTACH_MAX_RAW / 1048576) . 'MB 以下にしてください。');
        }
        return ['data' => $raw, 'mime' => $mime, 'ext' => $ext, 'w' => (int)$info[0], 'h' => (int)$info[1], 'name' => $name];
    }
    $img = @imagecreatefromstring($raw);
    if (!$img) {
        throw new AttachException('画像を読み取れませんでした。');
    }
    if ($mime === 'image/jpeg' && function_exists('exif_read_data')) { // 写真の向き
        $ex = @exif_read_data($f['tmp_name']);
        $o = (int)($ex['Orientation'] ?? 1);
        $rot = [3 => 180, 6 => -90, 8 => 90][$o] ?? 0;
        if ($rot) {
            $r = imagerotate($img, $rot, 0);
            if ($r) {
                $img = $r;
            }
        }
    }
    $w = imagesx($img);
    $h = imagesy($img);
    $m = max($w, $h);
    if ($m > ATTACH_MAX_SIDE) {
        $nw = (int)max(1, round($w * ATTACH_MAX_SIDE / $m));
        $nh = (int)max(1, round($h * ATTACH_MAX_SIDE / $m));
        $s = imagescale($img, $nw, $nh, IMG_BICUBIC);
        if ($s) {
            $img = $s;
            $w = $nw;
            $h = $nh;
        }
    }
    ob_start();
    if ($mime === 'image/jpeg') {
        imageinterlace($img, true);
        imagejpeg($img, null, 85);
    } elseif ($mime === 'image/webp' && function_exists('imagewebp')) {
        imagewebp($img, null, 85);
    } else { // PNG、GIF（動かない1枚目）、WebP が書けない環境は、PNG にそろえる
        $mime = 'image/png';
        $ext = 'png';
        imagealphablending($img, false);
        imagesavealpha($img, true);
        imagepng($img, null, 6);
    }
    $out = (string)ob_get_clean();
    imagedestroy($img);
    if ($out === '') {
        throw new AttachException('画像を変換できませんでした。');
    }
    return ['data' => $out, 'mime' => $mime, 'ext' => $ext, 'w' => $w, 'h' => $h, 'name' => $name];
}

/** 画像を保存して、todo_comment_files に記録する。記録した番号を返す */
function attach_store(int $commentId, int $todoId, array $p): int
{
    $dir = attach_prepare_dir();
    $stored = bin2hex(random_bytes(16)) . '.' . $p['ext'];
    if (@file_put_contents($dir . '/' . $stored, $p['data'], LOCK_EX) === false) {
        throw new AttachException('画像を保存できません（保存先の空き容量・権限を確認してください）。');
    }
    @chmod($dir . '/' . $stored, 0600);
    q('INSERT INTO todo_comment_files (comment_id, todo_id, name, mime, size, width, height, stored, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [$commentId, $todoId, $p['name'], $p['mime'], strlen($p['data']), $p['w'], $p['h'], $stored, now_str()]);
    return (int)db()->lastInsertId();
}

function attach_files_of_comments(array $commentIds): array
{
    if (!$commentIds) {
        return [];
    }
    $out = [];
    foreach (rows('SELECT id, comment_id, name, mime, size, width, height FROM todo_comment_files WHERE comment_id IN (' . implode(',', array_map('intval', $commentIds)) . ') ORDER BY id') as $r) {
        $out[(int)$r['comment_id']][] = ['id' => (int)$r['id'], 'name' => $r['name'], 'mime' => $r['mime'], 'size' => (int)$r['size'], 'w' => (int)$r['width'], 'h' => (int)$r['height']];
    }
    return $out;
}

/** コメントの画像のファイルと記録を消す */
function attach_delete_where(string $where, array $params): void
{
    foreach (rows("SELECT id, stored FROM todo_comment_files WHERE $where", $params) as $r) {
        if (preg_match('/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/', $r['stored'])) {
            @unlink(attach_dir() . '/' . $r['stored']);
        }
    }
    q("DELETE FROM todo_comment_files WHERE $where", $params);
}

/** 画像を探す（見てよいToDoのものだけ）。なければ null */
function attach_find(int $id, array $user): ?array
{
    $f = row('SELECT * FROM todo_comment_files WHERE id = ?', [$id]);
    if (!$f || !todo_for_comments((int)$f['todo_id'], $user)) {
        return null;
    }
    if (!preg_match('/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/', $f['stored']) || !is_file(attach_dir() . '/' . $f['stored'])) {
        return $f + ['missing' => true];
    }
    return $f;
}
