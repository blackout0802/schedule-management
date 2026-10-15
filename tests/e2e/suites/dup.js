const { chromium } = require(process.env.NODE_PATH + '/playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c) => { console.log((c ? 'OK  ' : 'NG  ') + n); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const f = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
async function login(browser, email, pw) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } }); const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p;
}
(async () => {
  const b = await chromium.launch();
  const now = new Date(); const d = n => f(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const p = await login(b, 'yamada@example.com', 'yamadapass1');
  // 休みを1件登録（今日から2日間）
  await p.keyboard.press('n'); await p.check('input[name=kind][value=off]'); await p.selectOption('select[name=tag]', '調整休');
  await p.fill('input[name=start]', d(0)); await p.fill('input[name=end]', d(1)); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.bar.off:has-text("調整休")');
  const before = await p.locator('.bar.off').count();
  const log0 = fs.existsSync(require('../lib/env').SLACK_LOG) ? fs.readFileSync(require('../lib/env').SLACK_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  // 編集 → 複製
  await p.click('.bar.off >> nth=0');
  ok('編集画面に「複製」ボタンがある', await p.locator('.modal button:has-text("複製")').count() === 1);
  await p.click('.modal button:has-text("複製")');
  ok('複製ダイアログが開く', await p.locator('.modal h3:has-text("予定を複製")').count() === 1);
  ok('複製元の内容が表示される', (await p.locator('.modal .notice').innerText()).includes('山田 花子 調整休'));
  ok('初期値は元の予定の翌日', await p.inputValue('.dup-row input >> nth=0') === d(2));
  ok('2日間の期間が表示される', (await p.locator('.dup-row .hint').first().innerText()).includes('〜'));
  await p.fill('.dup-row input >> nth=0', d(5));
  await p.click('.modal button:has-text("＋ 日付を追加")');
  ok('追加した日付の初期値は前の日付の翌日', await p.inputValue('.dup-row input >> nth=1') === d(6));
  await p.fill('.dup-row input >> nth=1', d(10));
  await p.screenshot({ path: 'dup-dialog.png' });
  await p.click('.modal button[type=submit]');
  await p.waitForSelector('.toast:has-text("2件を複製しました")');
  ok('「2件を複製しました」と表示', true);
  await p.waitForTimeout(600);
  ok('休みの登録では、Slackに通知しない（通知は朝・夕方の定時だけ）', (fs.existsSync(require('../lib/env').SLACK_LOG) ? fs.readFileSync(require('../lib/env').SLACK_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0) === log0);
  // 同じ日付をもう一度 → 飛ばされる
  await p.click('.bar.off:has-text("調整休") >> nth=0'); await p.click('.modal button:has-text("複製")');
  await p.fill('.dup-row input >> nth=0', d(5)); await p.click('.modal button[type=submit]'); await p.waitForSelector('.toast:has-text("飛ばしました")');
  ok('同じ予定がある日は飛ばす表示', (await p.locator('.toast:has-text("飛ばしました")').innerText()).includes('0件を複製しました'));
  const log2 = fs.existsSync(require('../lib/env').SLACK_LOG) ? fs.readFileSync(require('../lib/env').SLACK_LOG, 'utf8').trim().split('\n') : [];
  ok('飛ばした分も、Slackには送られない', log2.filter(Boolean).length === log0);
  // 他の社員(鈴木)の画面にも複製された休みが出る。かつ編集できない=複製ボタンなし
  const s = await login(b, 'suzuki@example.com', 'suzukipass1');
  await s.selectOption('#who-sel', 'all'); await s.waitForSelector('.bar.off:has-text("山田")');
  await s.click('.bar.off:has-text("山田") >> nth=0');
  ok('他の社員は複製できない（詳細表示のみ）', await s.locator('.modal button:has-text("複製")').count() === 0);
  // プライベートの複製
  await p.goto(BASE + 'index.php'); await p.waitForSelector('.cal'); await p.click('.tab[data-view=me]'); await p.waitForTimeout(500);
  await p.keyboard.press('n'); await p.fill('input[name=title]', '秘密の予定'); await p.fill('input[name=start]', d(0)); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.bar.private'); await p.click('.bar.private'); await p.click('.modal button:has-text("複製")');
  ok('プライベートには専用の注意書き', (await p.locator('.modal').innerText()).includes('本人以外には表示されません'));
  await p.fill('.dup-row input >> nth=0', d(3)); await p.click('.modal button[type=submit]'); await p.waitForSelector('.toast:has-text("1件を複製しました")');
  await p.waitForTimeout(500);
  ok('プライベートの複製が自分の画面に出る', await p.locator('.bar.private:has-text("秘密の予定")').count() === 2);
  await s.keyboard.press('Escape'); await s.click('.tab[data-view=me]'); await s.waitForTimeout(500);
  ok('鈴木さんにはプライベートのコピーも見えない', (await s.content()).indexOf('秘密の予定') < 0);
  // スマホ幅
  const m = await b.newContext({ viewport: { width: 390, height: 800 } }); const mp = await m.newPage();
  await mp.goto(BASE + 'login.php'); await mp.fill('input[name=email]', 'yamada@example.com'); await mp.fill('input[name=password]', 'yamadapass1');
  await Promise.all([mp.waitForURL('**/index.php'), mp.click('button[type=submit]')]); await mp.waitForSelector('.cal');
  await mp.keyboard.press('n'); await mp.waitForSelector('.modal');
  ok('スマホ幅でも横にはみ出さない', !(await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  await mp.screenshot({ path: 'dup-mobile.png' });
  console.log(fails ? '失敗 ' + fails : 'すべて成功'); await b.close(); process.exit(fails ? 1 : 0);
})();
