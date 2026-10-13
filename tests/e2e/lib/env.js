// 画面テスト（suites/*.js）の共通部分。run.sh が、環境変数を用意してから、各テストを動かす。
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-e2e-'));

const pad = n => String(n).padStart(2, '0');
module.exports = {
  TMP,                                    // このテストだけの、一時フォルダ
  /** 添付のテスト用の画像（shot-big.png / shot-small.png / not-image.txt）を、TMP に作って、そのフォルダを返す */
  makeImages() { execFileSync('php', [path.join(__dirname, 'images.php'), TMP]); return TMP; },
  BASE: 'http://127.0.0.1:8099/',
  APP: process.env.E2E_APP,               // テスト用に複製したアプリ（本物のフォルダは触らない）
  SLACK_LOG: process.env.E2E_SLACK_LOG,   // Slack の代わりのサーバーが受け取った内容
  CONFIG: process.env.SCHEDULE_CONFIG,
  ENV: process.env,
  /** テスト用のデータベースへ、SQL を直接実行する（; で区切って複数可）。SELECT の結果は、1行ごとに、列をタブでつなぐ */
  /** N日前の日時（'YYYY-MM-DD HH:MM:SS'）。SQL の日付計算は、データベースごとに書き方が違うので、こちらで計算する */
  ago(days) { const d = new Date(Date.now() - days * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; },
  /** 表があるか */
  tableExists(name) { try { this.sql(`SELECT COUNT(*) FROM ${name}`); return true; } catch (e) { return false; } },
  sql(q) { return execFileSync('php', [path.join(__dirname, 'sql.php'), q], { env: process.env, encoding: 'utf8' }).trim(); },
};
