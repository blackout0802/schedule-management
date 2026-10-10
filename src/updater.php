<?php
// システム更新: 更新用の zip を選ぶだけで、アプリのファイルを差し替える（管理者のみ）。
//
// 安全のための決まり:
//  ・差し替えるのは public / src / sql / bin の中の、決まった種類のファイルだけ
//  ・config.php、install.php、app_path.php、.htaccess、tests など、サーバー固有・危険なものは絶対に上書きしない
//  ・パスに .. や絶対パスを含む zip は、全体を拒否する
//  ・PHP ファイルは、書き込む前に文法を調べ、1つでも壊れていれば全体を中止する
//  ・書き換える前のファイルを data/backup/ に zip で保存し、あとで元に戻せる

const UPDATER_ROOTS = ['public', 'src', 'sql', 'bin'];
const UPDATER_EXT = ['php', 'js', 'css', 'sql', 'png', 'svg', 'ico', 'json', 'txt'];
const UPDATER_MAX_FILES = 600;
const UPDATER_MAX_BYTES = 3 * 1024 * 1024; // 1ファイルあたり
const UPDATER_KEEP_BACKUPS = 10;

/** 例外: zip の中身が不正なとき */
class UpdaterException extends RuntimeException
{
}

/** @return array<string,string> 種類 => 置き場所 */
function updater_bases(string $publicDir, string $appDir): array
{
    return ['public' => $publicDir, 'src' => $appDir . '/src', 'sql' => $appDir . '/sql', 'bin' => $appDir . '/bin'];
}

/** zip の中の名前を安全な形にする。フォルダなら null。危険なら例外 */
function updater_normalize(string $name): ?string
{
    $n = str_replace('\\', '/', $name);
    if (strpos($n, "\0") !== false || $n === '' || $n[0] === '/' || preg_match('/^[A-Za-z]:/', $n) || preg_match('#(^|/)\.\.(/|$)#', $n)) {
        throw new UpdaterException('zip の中に、安全でないファイル名が含まれています: ' . substr($name, 0, 60));
    }
    return substr($n, -1) === '/' ? null : $n;
}

/**
 * zip の中身を調べて、書き込む予定の一覧を作る（まだ何も書かない）。
 * @return array{files: array<string,array>, skipped:int}  files: 'src/api.php' => [index, target, code]
 */
function updater_plan(ZipArchive $zip, string $publicDir, string $appDir): array
{
    if ($zip->numFiles > UPDATER_MAX_FILES) {
        throw new UpdaterException('zip のファイル数が多すぎます。更新用の zip か確認してください。');
    }
    $names = [];
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $names[$i] = (string)$zip->getNameIndex($i);
        updater_normalize($names[$i]); // 危険な名前はここで全体を拒否
    }
    // GitHub の「Download ZIP」は、先頭にフォルダが1つ付く。そのフォルダを取り除く
    $prefix = '';
    if ($names) {
        $first = explode('/', str_replace('\\', '/', $names[0]))[0];
        $all = true;
        foreach ($names as $n) {
            if (strpos(str_replace('\\', '/', $n), $first . '/') !== 0) {
                $all = false;
                break;
            }
        }
        if ($all && !in_array($first, UPDATER_ROOTS, true)) {
            $prefix = $first . '/';
        }
    }
    $bases = updater_bases($publicDir, $appDir);
    $files = [];
    $skipped = 0;
    foreach ($names as $i => $raw) {
        $n = updater_normalize($raw);
        if ($n === null) {
            continue;
        }
        if ($prefix !== '') {
            $n = substr($n, strlen($prefix));
        }
        $parts = explode('/', $n);
        $root = $parts[0];
        $rel = implode('/', array_slice($parts, 1));
        $base = basename($n);
        $ext = strtolower(pathinfo($base, PATHINFO_EXTENSION));
        $excluded = $base === 'config.php' || ($root === 'public' && in_array($rel, ['install.php', 'app_path.php'], true));
        if (!isset($bases[$root]) || $rel === '' || !in_array($ext, UPDATER_EXT, true) || $excluded || $base[0] === '.') {
            $skipped++;
            continue;
        }
        $stat = $zip->statIndex($i);
        if ($stat['size'] > UPDATER_MAX_BYTES) {
            throw new UpdaterException('大きすぎるファイルがあります: ' . $n);
        }
        $code = $zip->getFromIndex($i);
        if ($code === false) {
            throw new UpdaterException('zip からファイルを読み出せませんでした: ' . $n);
        }
        if ($ext === 'php') {
            try {
                token_get_all($code, TOKEN_PARSE);
            } catch (ParseError $e) {
                throw new UpdaterException($n . ' の文法が壊れているため、更新を中止しました（' . $e->getMessage() . '）');
            }
        }
        $files[$root . '/' . $rel] = ['target' => $bases[$root] . '/' . $rel, 'code' => $code];
    }
    return ['files' => $files, 'skipped' => $skipped];
}

function updater_backup_dir(string $appDir): string
{
    $dir = $appDir . '/data/backup';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    // 外から見えないようにする
    foreach ([$appDir . '/data', $dir] as $d) {
        if (is_dir($d) && !is_file($d . '/.htaccess')) {
            @file_put_contents($d . '/.htaccess', "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n");
        }
    }
    return $dir;
}

function updater_write(string $target, string $code): void
{
    $dir = dirname($target);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
        throw new UpdaterException('フォルダを作れませんでした: ' . $dir);
    }
    $tmp = $target . '.tmp' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $code, LOCK_EX) === false) {
        throw new UpdaterException('書き込めませんでした（権限を確認してください）: ' . basename($target));
    }
    // サーバーによっては、新しく作ったファイルが誰でも書ける権限(666)になり、公開側のPHPがWebサーバーに拒否される（403）。
    // 必ず、ふつうの権限（644）にそろえる
    @chmod($tmp, 0644);
    if (!@rename($tmp, $target)) {
        @unlink($tmp);
        throw new UpdaterException('置き換えられませんでした: ' . basename($target));
    }
}

/**
 * zip の内容でアプリを更新する。
 * @return array{changed:string[], unchanged:int, skipped:int, backup:string}
 */
function updater_apply(string $zipPath, string $publicDir, string $appDir): array
{
    if (!class_exists('ZipArchive')) {
        throw new UpdaterException('このサーバーでは zip を扱えません（PHPのZip拡張がありません）。ファイルを FTP で直接アップロードしてください。');
    }
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
        throw new UpdaterException('zip ファイルを開けませんでした。');
    }
    try {
        $plan = updater_plan($zip, $publicDir, $appDir);
    } finally {
        $zip->close();
    }
    if (!$plan['files']) {
        throw new UpdaterException('更新できるファイルが見つかりませんでした。更新用の zip を選んでください。');
    }
    // 変わるファイルだけを対象にする
    $todo = [];
    $unchanged = 0;
    foreach ($plan['files'] as $key => $f) {
        if (is_file($f['target']) && file_get_contents($f['target']) === $f['code']) {
            $unchanged++;
        } else {
            $todo[$key] = $f;
        }
    }
    $backupName = '';
    if ($todo) {
        $dir = updater_backup_dir($appDir);
        $backupName = 'update-' . date('Ymd-His') . '.zip';
        $b = new ZipArchive();
        if ($b->open($dir . '/' . $backupName, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new UpdaterException('バックアップを作れませんでした（data フォルダの書き込み権限を確認してください）。');
        }
        $new = [];
        foreach ($todo as $key => $f) {
            if (is_file($f['target'])) {
                $b->addFromString($key, (string)file_get_contents($f['target']));
            } else {
                $new[] = $key;
            }
        }
        $b->addFromString('_new_files.txt', implode("\n", $new));
        $b->addFromString('_version.txt', defined('APP_VERSION') ? APP_VERSION : '');
        if (!$b->close()) {
            throw new UpdaterException('バックアップの保存に失敗しました。');
        }
        // 古いバックアップを整理
        $olds = glob($dir . '/update-*.zip') ?: [];
        rsort($olds);
        foreach (array_slice($olds, UPDATER_KEEP_BACKUPS) as $old) {
            @unlink($old);
        }
        try {
            // 版の印（src/version.php）は最後に書く。開いたままの画面は、これが変わると自動で開き直すので、他のファイルがそろってからにする
            uksort($todo, function ($a, $b) { return ($a === 'src/version.php') <=> ($b === 'src/version.php'); });
            foreach ($todo as $f) {
                updater_write($f['target'], $f['code']);
            }
        } catch (UpdaterException $e) {
            updater_restore($backupName, $publicDir, $appDir); // 途中で失敗したら、元の状態に戻す
            throw new UpdaterException($e->getMessage() . '（途中で止まったため、更新前の状態に戻しました）');
        }
        if (function_exists('opcache_reset')) {
            @opcache_reset();
        }
    }
    return ['changed' => array_keys($todo), 'unchanged' => $unchanged, 'skipped' => $plan['skipped'], 'backup' => $backupName];
}

/** @return string[] バックアップの名前（新しい順） */
function updater_backups(string $appDir): array
{
    $list = glob($appDir . '/data/backup/update-*.zip') ?: [];
    rsort($list);
    return array_map('basename', $list);
}

/** バックアップの状態に戻す。更新で新しく増えたファイルは削除する */
function updater_restore(string $backupName, string $publicDir, string $appDir): int
{
    if (!preg_match('/^update-\d{8}-\d{6}\.zip$/', $backupName)) {
        throw new UpdaterException('バックアップの名前が正しくありません。');
    }
    $path = $appDir . '/data/backup/' . $backupName;
    $zip = new ZipArchive();
    if (!is_file($path) || $zip->open($path) !== true) {
        throw new UpdaterException('バックアップが見つかりません。');
    }
    $bases = updater_bases($publicDir, $appDir);
    $count = 0;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = (string)$zip->getNameIndex($i);
        if ($name === '_new_files.txt' || $name === '_version.txt' || substr($name, -1) === '/') {
            continue;
        }
        $parts = explode('/', updater_normalize($name));
        if (!isset($bases[$parts[0]]) || count($parts) < 2) {
            continue;
        }
        updater_write($bases[$parts[0]] . '/' . implode('/', array_slice($parts, 1)), (string)$zip->getFromIndex($i));
        $count++;
    }
    $new = trim((string)$zip->getFromName('_new_files.txt'));
    foreach ($new === '' ? [] : explode("\n", $new) as $key) {
        $parts = explode('/', updater_normalize(trim($key)) ?? '');
        if (isset($bases[$parts[0]]) && count($parts) >= 2) {
            @unlink($bases[$parts[0]] . '/' . implode('/', array_slice($parts, 1)));
            $count++;
        }
    }
    $zip->close();
    if (function_exists('opcache_reset')) {
        @opcache_reset();
    }
    return $count;
}
