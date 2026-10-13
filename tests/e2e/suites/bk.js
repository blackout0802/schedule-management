const { chromium } = require(process.env.NODE_PATH + '/playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const login = async (b, email, pw) => { const p = await b.newPage({ viewport: { width: 1100, height: 900 } }); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
(async () => {
  const b = await chromium.launch();
  const y = await login(b, 'yamada@example.com', 'yamadapass1');
  await y.click('.tab[data-view=me]'); await y.waitForTimeout(400);
  await y.keyboard.press('n'); await y.waitForSelector('.modal'); await y.fill('.modal input[name=title]', 'こっそり通院'); await y.click('.modal button[type=submit]'); await y.waitForSelector('.bar:has-text("こっそり通院")');
  const r403 = await y.goto(BASE + 'backup.php'); ok('一般の社員は、バックアップの画面を開けない（403）', r403.status() === 403);
  const a = await login(b, 'admin@example.com', 'adminpass1');
  await a.click('.menu >> text=管理者'); 
  await a.goto(BASE + 'index.php#settings'); await a.waitForSelector('#set-backup'); ok('設定に「バックアップ」の項目がある（管理者）', true);
  const sy = await y.evaluate(async () => (await fetch('index.php#settings')).status); 
  await a.goto(BASE + 'backup.php'); await a.waitForSelector('h1:has-text("バックアップ")');
  // パスワード不一致
  await a.fill('form:has(input[value=download]) input[name=pass]', 'backup-pass-1'); await a.fill('form:has(input[value=download]) input[name=pass2]', 'backup-pass-2'); await a.click('button:has-text("バックアップをダウンロード")');
  await a.waitForSelector('.error'); ok('パスワードが2回で一致しないと、エラー', (await a.locator('.error').innerText()).includes('一致しません'));
  // 短いパスワードは、ブラウザの入力チェックで止まる
  await a.fill('form:has(input[value=download]) input[name=pass]', 'short'); await a.fill('form:has(input[value=download]) input[name=pass2]', 'short'); await a.click('button:has-text("バックアップをダウンロード")'); await a.waitForTimeout(300);
  ok('短いパスワードでは、ダウンロードされない', (await a.locator('input[name=pass]:invalid').count()) >= 1);
  // ダウンロード
  await a.fill('form:has(input[value=download]) input[name=pass]', 'backup-pass-1'); await a.fill('form:has(input[value=download]) input[name=pass2]', 'backup-pass-1');
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('button:has-text("バックアップをダウンロード")')]);
  const path = require('../lib/env').TMP + '/bk-test.enc'; await dl.saveAs(path); const blob = fs.readFileSync(path);
  ok('ファイル名は schedule-backup-日時.enc', /^schedule-backup-\d{8}-\d{6}\.enc$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok('中身は暗号化されている（プライベートの件名が、そのまま入っていない）', blob.length > 200 && !blob.includes(Buffer.from('こっそり通院')) && blob.slice(0, 8).toString() === 'SCHEDBK1');
  // データを変える（プライベートの予定を消す／別の予定を足す）
  await y.goto(BASE + 'index.php'); await y.waitForSelector('.cal'); await y.click('.tab[data-view=me]'); await y.waitForSelector('.bar:has-text("こっそり通院")');
  await y.click('.bar:has-text("こっそり通院")'); await y.waitForSelector('.modal'); y.once('dialog', d => d.accept()); await y.click('.modal button:has-text("削除")'); await y.waitForSelector('.bar:has-text("こっそり通院")', { state: 'detached' });
  ok('いったん、プライベートの予定を消した', true);
  // 復元: 間違ったパスワード
  await a.goto(BASE + 'backup.php');
  const rf = 'form#restore-form';
  await a.setInputFiles(rf + ' input[type=file]', path); await a.fill(rf + ' input[name=pass]', 'wrong-password'); await a.fill(rf + ' input[name=confirm]', '復元する'); a.once('dialog', d => d.accept()); await a.click(rf + ' button[type=submit]');
  await a.waitForSelector('.error'); ok('間違ったパスワードでは復元できない', (await a.locator('.error').innerText()).includes('パスワードが違う'));
  // 確認文字が違う
  await a.setInputFiles(rf + ' input[type=file]', path); await a.fill(rf + ' input[name=pass]', 'backup-pass-1'); await a.fill(rf + ' input[name=confirm]', 'はい'); a.once('dialog', d => d.accept()); await a.click(rf + ' button[type=submit]');
  await a.waitForSelector('.error'); ok('「復元する」と入力しないと、復元できない', (await a.locator('.error').innerText()).includes('復元する'));
  // 復元
  await a.setInputFiles(rf + ' input[type=file]', path); await a.fill(rf + ' input[name=pass]', 'backup-pass-1'); await a.fill(rf + ' input[name=confirm]', '復元する'); a.once('dialog', d => d.accept()); await a.click(rf + ' button[type=submit]');
  await a.waitForSelector('.notice'); const t = await a.locator('.notice').innerText(); ok('復元できた（件数が出る）', t.includes('復元しました') && t.includes('予定:'), t);
  await a.screenshot({ path: 'bk-done.png' });
  const y2 = await login(b, 'yamada@example.com', 'yamadapass1'); await y2.click('.tab[data-view=me]'); await y2.waitForSelector('.bar:has-text("こっそり通院")');
  ok('消したプライベートの予定が戻り、本人のログインもそのまま使える', true);
  // 管理者がプライベートを見られない決まりは、復元後も同じ
  await y2.close();
  const a2 = await login(b, 'admin@example.com', 'adminpass1'); const ls = await a2.evaluate(async () => { const r = await (await fetch('api.php?action=events&from=2026-10-01&to=2026-12-31&view=team')).text(); return r.includes('こっそり通院'); });
  ok('管理者の画面（業務版）には、プライベートの予定は出ない', ls === false);
  // 変更履歴に残る
  const au = await a2.evaluate(async () => (await (await fetch('api.php?action=audit_list&type=security')).json()).entries.map(i => i.action_name + ':' + i.label));
  ok('変更履歴に、バックアップ・復元が記録される', au.some(x => x.startsWith('バックアップ')) && au.some(x => x.startsWith('復元')), au);
  await a.goto(BASE + 'backup.php'); await a.screenshot({ path: 'bk-page.png', fullPage: true });
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
