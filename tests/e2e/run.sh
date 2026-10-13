#!/usr/bin/env bash
# 画面テスト（ブラウザを動かして、画面ごと確かめる）。
#   使い方:  bash tests/e2e/run.sh            すべてのテスト
#            bash tests/e2e/run.sh who sum    名前を指定して、それだけ
#            bash tests/e2e/run.sh --list     テストの一覧
# 必要なもの: php 7.4以上（PDO, GD）、node、Playwright（npm i -g playwright）と、Chromium
# データベースは、既定で SQLite。MySQL/MariaDB で動かすときは、先に空のデータベースを作って:
#   E2E_DSN='mysql:host=localhost;dbname=sched_e2e;charset=utf8mb4' E2E_DB_USER=sched E2E_DB_PASS=xxx bash tests/e2e/run.sh
# アプリのフォルダは、作業用の場所（tests/e2e/.work/app）に複製して動かす。本物の data/ や config.php には触らない。
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK=${E2E_WORK:-$HERE/.work}
PORT=8099; HOOK_PORT=8098
SUITES_DIR="$HERE/suites"

if [ "${1:-}" = "--list" ]; then ls "$SUITES_DIR" | sed 's/\.js$//' | tr '\n' ' '; echo; exit 0; fi

command -v php >/dev/null || { echo "php が見つかりません"; exit 2; }
command -v node >/dev/null || { echo "node が見つかりません"; exit 2; }
if [ -z "${NODE_PATH:-}" ]; then NODE_PATH=$(npm root -g 2>/dev/null); fi
export NODE_PATH
[ -d "$NODE_PATH/playwright" ] || [ -d "$ROOT/node_modules/playwright" ] || { echo "Playwright が見つかりません（npm i -g playwright）"; exit 2; }

for p in $PORT $HOOK_PORT; do
  if (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then echo "ポート $p は、すでに使われています（前のテストのサーバーが残っていれば、止めてください）"; exit 2; fi
done

# 作業用の場所を作り直す（アプリの複製・データベース・出力）
rm -rf "$WORK/app" "$WORK/out"; mkdir -p "$WORK/app" "$WORK/out"
for d in src public sql bin; do cp -R "$ROOT/$d" "$WORK/app/$d"; done
cp "$ROOT/config.sample.php" "$WORK/app/"; mkdir -p "$WORK/app/data"
DSN=${E2E_DSN:-sqlite:$WORK/e2e.sqlite}
cat > "$WORK/config.php" <<PHP
<?php return ['db' => ['dsn' => '$DSN', 'user' => '${E2E_DB_USER:-}' ?: null, 'pass' => '${E2E_DB_PASS:-}' ?: null], 'slack_webhook' => 'http://127.0.0.1:$HOOK_PORT/hook.php', 'base_url' => 'https://example.com/schedule/'];
PHP
export SCHEDULE_CONFIG="$WORK/config.php" E2E_APP="$WORK/app" E2E_SLACK_LOG="$WORK/slack.log" TZ=${TZ:-Asia/Tokyo}

PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
(cd "$WORK/app" && exec php -S 127.0.0.1:$PORT -t public >"$WORK/web.log" 2>&1) & PIDS="$PIDS $!"
(cd "$HERE/mock" && exec php -S 127.0.0.1:$HOOK_PORT >"$WORK/hook.log" 2>&1) & PIDS="$PIDS $!"
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/login.php" && break; sleep 0.3; done

reset_db() {
  [ "${DSN#sqlite:}" != "$DSN" ] && rm -f "${DSN#sqlite:}"
  rm -rf "$WORK/app/data/attachments" "$WORK/app/data/backups"; : > "$WORK/slack.log"
  php "$HERE/lib/seed.php" || return 1
  [ "$1" = "seg" ] && php "$HERE/lib/seed-demo.php"   # 業務の予定を、あらかじめ入れておく必要があるテスト
  return 0
}

if [ $# -gt 0 ]; then LIST="$*"; else LIST=$(ls "$SUITES_DIR" | sed 's/\.js$//'); fi
PASS=0; FAILED=""
cd "$WORK/out"
for s in $LIST; do
  [ -f "$SUITES_DIR/$s.js" ] || { echo "== $s: テストがありません"; FAILED="$FAILED $s"; continue; }
  reset_db "$s" >/dev/null 2>&1 || { echo "== $s: データベースを用意できませんでした"; FAILED="$FAILED $s"; continue; }
  out=$(timeout 240 node "$SUITES_DIR/$s.js" 2>&1); code=$?
  if [ $code -eq 0 ]; then echo "OK   $s"; PASS=$((PASS+1)); else echo "NG   $s"; echo "$out" | grep -E "^NG|Error|Timeout|\.js:[0-9]+" | head -8 | sed 's/^/       /'; FAILED="$FAILED $s"; fi
done
echo
echo "結果: 成功 $PASS / 失敗 $(echo $FAILED | wc -w)${FAILED:+（$FAILED ）}"
echo "画面の写真などは $WORK/out に出ます"
[ -z "$FAILED" ]
