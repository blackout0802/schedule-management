<?php
// 初回だけ使う設定ページ。
//   手順1: データベース（MySQL）の情報を入力 → 接続を確かめて config.php を自動で作る
//   手順2: テーブルを作り、最初の管理者を登録する
// 終わったら、このファイル（install.php）をサーバーから削除してください。
require_once __DIR__ . '/app_path.php';
require_once SCHEDULE_APP_DIR . '/src/bootstrap.php';
require_once SCHEDULE_APP_DIR . '/src/auth.php';

session_boot();
$csrf = csrf_token();
$cfgPath = config_file_path();
$err = '';
$fallbackCode = null; // config.php を自動で書けなかったときに、手で貼り付けてもらう内容
$done = false;
$v = ['host' => 'localhost', 'dbname' => '', 'user' => ''];

/** 接続エラーを、原因が分かる日本語にする（接続先の情報は画面に出さない） */
function db_error_hint(Throwable $e): string
{
    $code = (int)($e instanceof PDOException && isset($e->errorInfo[1]) ? $e->errorInfo[1] : 0);
    $sqlstate = (string)$e->getCode();
    if ($code === 1045) return 'ユーザー名またはパスワードが違います。';
    if ($code === 1049) return 'データベース名が見つかりません。サーバーIDが前に付いた完全な名前か確認してください。';
    if ($code === 1044) return 'このユーザーに、データベースを使う権限がありません。サーバーパネルでユーザーに権限を付けてください。';
    if ($code === 2002 || $code === 2006 || strpos((string)$e->getMessage(), 'getaddrinfo') !== false) return 'ホスト名に接続できません。サーバーパネルの「MySQL情報」のホスト名を確認してください。';
    if ($sqlstate === '1045') return 'ユーザー名またはパスワードが違います。';
    return 'データベースに接続できませんでした。入力内容を確認してください。';
}

// 初期設定が済んでいる（ユーザーが1人以上いる）ときは、この画面からデータベースの設定を書き換えさせない。
// install.php をサーバーに残したままでも、第三者に接続先をすり替えられないようにするため
$locked = false;
if (is_file($cfgPath)) {
    try {
        $locked = (int)(row('SELECT COUNT(*) AS c FROM users')['c']) > 0;
    } catch (Throwable $e) {
        $locked = false;
    }
}

// ---- 手順1: データベース情報の保存 ----
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['step'] ?? '') === 'db' && $locked) {
    $err = '初期設定はすでに完了しています。データベースの設定を変えるときは、config.php を直接書き換えてください。';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['step'] ?? '') === 'db') {
    $v['host'] = trim((string)($_POST['host'] ?? ''));
    $v['dbname'] = trim((string)($_POST['dbname'] ?? ''));
    $v['user'] = trim((string)($_POST['user'] ?? ''));
    $pass = (string)($_POST['pass'] ?? '');
    if (!csrf_valid($_POST['csrf'] ?? null)) {
        $err = '画面の有効期限が切れました。ページを再読み込みして、もう一度お試しください。';
    } elseif (!preg_match('/^[A-Za-z0-9._-]+$/', $v['host'])) {
        $err = 'ホスト名に使えない文字が入っています。サーバーパネルの「MySQL情報」の表示をそのまま入力してください。';
    } elseif (!preg_match('/^[A-Za-z0-9_$-]+$/', $v['dbname'])) {
        $err = 'データベース名に使えない文字が入っています。「【 】」や日本語などの見本の文字が残っていないか確認してください。';
    } elseif ($v['user'] === '') {
        $err = 'ユーザー名を入力してください。';
    } elseif ($pass === '') {
        $err = 'パスワードを入力してください。（安全のため、入力し直しになったときは、パスワードも毎回入れ直す必要があります）';
    } else {
        $dsn = 'mysql:host=' . $v['host'] . ';dbname=' . $v['dbname'] . ';charset=utf8mb4';
        try {
            new PDO($dsn, $v['user'], $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 8]);
        } catch (Throwable $e) {
            $err = db_error_hint($e);
            error_log('[schedule install] DB接続失敗: ' . $e->getMessage());
        }
        if ($err === '') {
            // 既に config.php があれば、他の設定（Slackなど）は残して db だけ差し替える
            $conf = [];
            if (is_file($cfgPath)) {
                try {
                    $x = include $cfgPath;
                    if (is_array($x)) $conf = $x;
                } catch (Throwable $e) {
                    $conf = [];
                }
            }
            $conf += ['app_name' => 'スケジュール管理', 'timezone' => 'Asia/Tokyo', 'slack_webhook' => '', 'cron_token' => ''];
            if (empty($conf['base_url'])) {
                $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
                $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
                $conf['base_url'] = ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/';
            }
            $conf['db'] = ['dsn' => $dsn, 'user' => $v['user'], 'pass' => $pass];
            $code = "<?php\n// install.php が作成した設定ファイルです。必要なら、Slack の設定などをここに追記してください。\nreturn " . var_export($conf, true) . ";\n";
            if (@file_put_contents($cfgPath, $code, LOCK_EX) !== false) {
                header('Location: install.php');
                exit;
            }
            $fallbackCode = $code;
        }
    }
}

// ---- 現在の状態を調べる ----
$state = 'need_db';
$count = -1;
if ($fallbackCode === null && is_file($cfgPath)) {
    try {
        run_schema();
        $count = (int)(row('SELECT COUNT(*) AS c FROM users')['c']);
        $state = $count === 0 ? 'need_admin' : 'finished';
    } catch (Throwable $e) {
        if ($err === '' && $_SERVER['REQUEST_METHOD'] !== 'POST') {
            $err = 'いまの config.php では、データベースに接続できませんでした。下の欄に、サーバーパネルの MySQL の情報を入れてください。（' . db_error_hint($e) . '）';
        }
        error_log('[schedule install] ' . $e->getMessage());
    }
}

// ---- 手順2: 最初の管理者の登録 ----
if ($state === 'need_admin' && $_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['step'] ?? '') === 'admin') {
    $name = trim((string)($_POST['name'] ?? ''));
    $email = trim((string)($_POST['email'] ?? ''));
    $pw = (string)($_POST['password'] ?? '');
    if (!csrf_valid($_POST['csrf'] ?? null)) {
        $err = '画面の有効期限が切れました。ページを再読み込みして、もう一度お試しください。';
    } elseif ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($pw) < 8) {
        $err = '名前・メールアドレス・8文字以上のパスワードを入力してください。';
    } else {
        create_user($name, $email, $pw, 'admin');
        $done = true;
        $state = 'finished';
    }
}
$appName = is_file($cfgPath) && $fallbackCode === null ? cfg('app_name') : 'スケジュール管理';
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>初期設定｜<?= h($appName) ?></title>
<link rel="stylesheet" href="assets/app.css">
</head>
<body class="login-page">
<main class="login-card">
  <h1>初期設定</h1>
  <?php if ($err): ?><p class="error" role="alert"><?= h($err) ?></p><?php endif; ?>

  <?php if ($fallbackCode !== null): ?>
    <p><b>接続は成功しましたが、config.php を自動で保存できませんでした。</b></p>
    <p class="muted">下の内容をすべてコピーし、パソコンで <code>config.php</code> という名前で保存して、サーバーの <b>README.md や src フォルダと同じ場所</b>（方式Aなら schedule_app フォルダの中）にアップロードしてください。そのあと、このページを再読み込みします。</p>
    <textarea readonly rows="12" onclick="this.select()" style="font-family:monospace;font-size:12px"><?= h($fallbackCode) ?></textarea>

  <?php elseif ($state === 'need_db'): ?>
    <p class="muted"><b>手順1 / 2　データベースの情報</b><br>サーバーパネルの「MySQL設定」に表示されている4つの値を入力してください。接続を確かめてから保存します。</p>
    <form method="post" autocomplete="off">
      <input type="hidden" name="step" value="db">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <label>ホスト名<input name="host" value="<?= h($v['host']) ?>" required placeholder="例: localhost（「MySQL情報」の表示のとおり）"></label>
      <label>データベース名<input name="dbname" value="<?= h($v['dbname']) ?>" required placeholder="サーバーIDが前に付いた完全な名前"></label>
      <label>ユーザー名<input name="user" value="<?= h($v['user']) ?>" required placeholder="サーバーIDが前に付いた完全な名前"></label>
      <label>パスワード<input id="pass" type="password" name="pass" required autocomplete="new-password"></label>
      <label style="flex-direction:row;display:flex;align-items:center;gap:6px"><input id="show-pass" type="checkbox" style="width:auto">パスワードを表示する</label>
      <script nonce="<?= csp_nonce() ?>">document.getElementById('show-pass').addEventListener('change', function () { document.getElementById('pass').type = this.checked ? 'text' : 'password'; });</script>
      <button class="btn primary" type="submit">接続を確かめて保存する</button>
    </form>

  <?php elseif ($state === 'need_admin'): ?>
    <p class="muted"><b>手順2 / 2　最初の管理者</b><br>データベースに接続できました。管理者を登録します。</p>
    <form method="post">
      <input type="hidden" name="step" value="admin">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <label>名前<input name="name" required></label>
      <label>メールアドレス（ログインID）<input type="email" name="email" required></label>
      <label>パスワード（8文字以上）<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn primary" type="submit">管理者を登録する</button>
    </form>

  <?php else: ?>
    <?php if ($done): ?><p>管理者を登録しました。</p><?php else: ?><p>すでに初期設定は完了しています。</p><?php endif; ?>
    <p class="error">この install.php をサーバーから削除してください。</p>
    <p><a class="btn primary" href="login.php">ログイン画面へ</a></p>
  <?php endif; ?>
</main>
</body>
</html>
