const { chromium } = require(process.env.NODE_PATH + '/playwright');
const fs = require('fs'); const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:8099/';
const ROOT = process.env.E2E_APP; const ENV = process.env;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const { sql } = require('../lib/env');
const cron = m => execSync(`php ${ROOT}/bin/cron.php ${m}`, { env: ENV, encoding: 'utf8' });
const login = async (b, email, pw) => { const p = await b.newPage({ viewport: { width: 1100, height: 900 } }); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); await p.waitForTimeout(500); return p; };
(async () => {
  execSync(`rm -f ${ROOT}/data/backups/*.enc`);
  const b = await chromium.launch();
  let a = await login(b, 'admin@example.com', 'adminpass1');
  ok('はじめは、お知らせは出ない（使い始めて30日たっていない）', await a.locator('.backup-alert').count() === 0);
  sql(`DELETE FROM app_meta WHERE meta_key IN ('backup_manual_at','backup_snooze','backup_first'); INSERT INTO app_meta (meta_key, meta_value) VALUES ('backup_manual_at', '${require('../lib/env').ago(40)}')`);
  await a.reload(); await a.waitForSelector('.cal'); await a.waitForTimeout(500);
  ok('30日以上たつと、管理者の画面にお知らせが出る', await a.locator('.backup-alert').count() === 1, await a.locator('main').innerText());
  const tx = await a.locator('.backup-alert').innerText(); ok('お知らせに、最後にダウンロードした日（40日前）が出る', /40日前/.test(tx), tx);
  await a.screenshot({ path: 'bk2-banner.png', clip: { x: 0, y: 0, width: 1100, height: 330 } });
  const y = await login(b, 'yamada@example.com', 'yamadapass1'); ok('一般の社員には、お知らせは出ない', await y.locator('.backup-alert').count() === 0); await y.close();
  await a.click('.backup-alert button:has-text("あとで")'); await a.waitForTimeout(500);
  ok('「あとで」で、お知らせが消える', await a.locator('.backup-alert').count() === 0);
  await a.reload(); await a.waitForSelector('.cal'); await a.waitForTimeout(400); ok('開き直しても、7日間は出ない', await a.locator('.backup-alert').count() === 0);
  sql("DELETE FROM app_meta WHERE meta_key='backup_snooze'");
  await a.reload(); await a.waitForSelector('.cal'); await a.waitForTimeout(400); ok('お知らせの時期になっていれば、また出る', await a.locator('.backup-alert').count() === 1);
  // バックアップの画面: 自動バックアップ
  await a.goto(BASE + 'backup.php'); await a.waitForSelector('#auto');
  ok('自動バックアップは、はじめは無効', (await a.locator('#auto').innerText()).includes('無効'));
  const f = '#auto form:has(input[value=auto_set])';
  await a.fill(f + ' input[name=pass]', 'auto-pass-xyz'); await a.fill(f + ' input[name=pass2]', 'auto-pass-xyz'); await a.click(f + ' button[type=submit]'); await a.waitForSelector('.notice');
  ok('パスワードを設定すると、有効になる', (await a.locator('#auto').innerText()).includes('有効') && !(await a.locator('#auto').innerText()).includes('無効'));
  await a.click('#auto button:has-text("いま作成する")'); await a.waitForSelector('.notice:has-text("自動バックアップを作成しました")');
  ok('「いま作成する」で、保存済みの一覧に1件出る', await a.locator('#auto table.t tbody tr').count() === 1);
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#auto table.t button:has-text("ダウンロード")')]); await dl.saveAs(require('../lib/env').TMP + '/auto-dl.enc');
  const bl = fs.readFileSync(require('../lib/env').TMP + '/auto-dl.enc'); ok('保存済みのバックアップを、画面からダウンロードできる（暗号化されている）', bl.slice(0, 8).toString() === 'SCHEDBK1' && bl.length > 200);
  ok('サーバーの保存先にファイルがある（権限 600）', execSync(`ls -l ${ROOT}/data/backups/auto-*.enc`).toString().includes('-rw-------'));
  const dec = execSync(`php -r 'require "${ROOT}/src/bootstrap.php"; require "${ROOT}/src/backup.php"; $d = backup_inspect(backup_decrypt(file_get_contents("${require('../lib/env').TMP}/auto-dl.enc"), "auto-pass-xyz")); echo count($d["tables"]["users"]);'`, { env: ENV, encoding: 'utf8' });
  ok('設定したパスワードで復元できる（社員3人）', dec.trim() === '3', dec);
  // cron: 今日は作成済みなので、作らない
  const c1 = cron('notify'); ok('cron notify: 今日は作成済みなので、自動バックアップは作らない', !c1.includes('自動バックアップを作成'), c1);
  sql("DELETE FROM app_meta WHERE meta_key IN ('backup_auto_at','backup_auto_try')");
  const c2 = cron('notify'); ok('cron notify: 翌日になった想定で、自動バックアップを作る', c2.includes('自動バックアップを作成しました'), c2);
  ok('保存済みは、2件になる', execSync(`ls ${ROOT}/data/backups/auto-*.enc | wc -l`).toString().trim() === '2');
  const c3 = cron('backup'); ok('cron backup: 今すぐ作れる', c3.includes('自動バックアップを作成しました'), c3);
  // Slack のお知らせ
  fs.writeFileSync(require('../lib/env').SLACK_LOG, '');
  const c4 = cron('notify'); ok('Slack通知がオフなら、お知らせは送らない', !fs.readFileSync(require('../lib/env').SLACK_LOG, 'utf8').includes('手動バックアップ'), c4);
  await a.goto(BASE + 'backup.php'); await a.waitForSelector('#alert');
  await a.check('#alert input[name=slack]'); await a.click('#alert button:has-text("保存")'); await a.waitForSelector('.notice:has-text("Slackにも")');
  const c5 = cron('notify'); const rec = fs.readFileSync(require('../lib/env').SLACK_LOG, 'utf8');
  const jstHour = (new Date().getUTCHours() + 9) % 24;
  if (jstHour < 9) console.log('SKIP Slackのお知らせは、日本時間の9時以降に送る仕様のため、この時間帯は確認しない（単体テストで確認済み）'); else
  ok('Slack通知をオンにすると、管理者向けのお知らせが送られる（バックアップ画面のURL付き）', rec.includes('手動バックアップの時期') && rec.replace(/\\\//g, '/').includes('https://example.com/schedule/backup.php'), rec);
  fs.writeFileSync(require('../lib/env').SLACK_LOG, ''); cron('notify');
  if (jstHour >= 9) ok('同じ月に、2回は送らない', !fs.readFileSync(require('../lib/env').SLACK_LOG, 'utf8').includes('手動バックアップ'));
  // 手動ダウンロードで、お知らせが消える
  await a.goto(BASE + 'backup.php');
  const mf = 'form:has(input[value=download])'; await a.fill(mf + ' input[name=pass]', 'manual-pass-1'); await a.fill(mf + ' input[name=pass2]', 'manual-pass-1');
  const [dl2] = await Promise.all([a.waitForEvent('download'), a.click(mf + ' button[type=submit]')]); await dl2.path();
  await a.goto(BASE + 'index.php'); await a.waitForSelector('.cal'); await a.waitForTimeout(500);
  ok('手動でダウンロードすると、お知らせが消える', await a.locator('.backup-alert').count() === 0);
  ok('手動バックアップには、自動バックアップのパスワードが入っていない', (await a.evaluate(async () => 1)) && execSync(`php -r 'require "${ROOT}/src/bootstrap.php"; require "${ROOT}/src/backup.php"; echo json_encode(array_column(backup_collect()["tables"]["app_meta"], "meta_key"));'`, { env: ENV, encoding: 'utf8' }).indexOf('backup_auto_pass') < 0);
  // 自動バックアップを止める
  await a.goto(BASE + 'backup.php'); await a.click('#auto button:has-text("自動バックアップを止める")'); await a.waitForSelector('.notice');
  ok('止めると、無効に戻る（保存済みのファイルは残る）', (await a.locator('#auto').innerText()).includes('無効') && await a.locator('#auto table.t tbody tr').count() >= 2);
  await a.screenshot({ path: 'bk2-page.png', fullPage: true });
  execSync(`rm -f ${ROOT}/data/backups/*.enc`);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
