const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
(async () => { const b = await chromium.launch();
  const mk = async (opts) => { const c = await b.newContext(opts || { viewport: { width: 1280, height: 1000 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept()); return p; };
  const login = async (p, em, pw) => { await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); };
  const a = await mk(); await login(a, 'admin@example.com', 'adminpass1');
  await a.click('header button:has-text("設定")'); await a.waitForSelector('.settings-page');
  ok('「設定」を押すと、ポップアップではなく、設定のページになる（URL は #settings）', a.url().endsWith('#settings') && (await a.locator('.overlay').count()) === 0 && (await a.locator('.cal').count()) === 0);
  const titles = await a.locator('.set-sec > h3').allInnerTexts();
  ok('すべての項目が、1ページに並ぶ', ['画面の色', '予定の色', '繰り返し業務', '共有リンク', 'ショートカットキー', '社員の管理', '会社の休業日', 'Slack通知の送り先', 'Slack通知の時間・文面', 'システム更新'].every(t => titles.some(x => x.includes(t))) && !titles.some(x => x.includes('パスワードの変更') || x.includes('ホーム画面に追加')), titles);
  ok('左に、項目の一覧（ジャンプ用）がある', (await a.locator('.set-nav a').count()) === titles.length);
  // 中身が、その場で出ている
  ok('予定の色: パレットが、ページの中に出ている', (await a.locator('#set-colors .cs-sw, #set-colors .pal').count()) > 0);
  ok('ショートカット一覧が出ている', (await a.locator('#set-shortcuts .sc-table').innerText()).includes('カレンダーを表示'));
  ok('社員の管理: 社員の表が出ている', (await a.locator('#set-users table').innerText()).includes('山田 花子'));
  ok('Slack通知の送り先・時間・文面が、ページの中で読み込まれる', (await a.locator('#set-slack .slack-status').count()) === 1 && (await a.locator('#set-slackcfg .slack-preview').count()) >= 2);
  ok('ページの中に、「閉じる」ボタンは無い', (await a.locator('.set-sec button:has-text("閉じる")').count()) === 0);
  ok('システム更新へのリンクがある', (await a.locator('#set-update a[href="update.php"]').count()) === 1);
  // 画面の色: その場で効く
  await a.click('#set-theme label:has-text("ダーク")'); await a.waitForTimeout(200); ok('画面の色: その場で切り替わる', await a.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
  await a.click('#set-theme label:has-text("自動")'); await a.waitForTimeout(100);
  // 社員の編集は、これまでどおりポップアップ
  await a.locator('#set-users button:has-text("編集")').first().click(); await a.waitForSelector('.overlay .modal'); ok('社員の編集は、入力用のポップアップで開く', (await a.locator('.overlay .modal').innerText()).includes('社員を編集')); await a.click('.overlay button:has-text("キャンセル")'); await a.waitForFunction(() => !document.querySelector('.overlay'));
  ok('ポップアップを閉じても、設定のページのまま', (await a.locator('.settings-page').count()) === 1);
  // Slack 時間・文面: 保存してもページは閉じない
  await a.fill('#set-slackcfg [name=morTime]', '9:15'); await a.press('#set-slackcfg [name=morTime]', 'Tab'); await a.locator('#set-slackcfg button.btn.primary:has-text("保存")').click(); await a.waitForSelector('.toast:has-text("保存しました")'); await a.waitForTimeout(1200);
  ok('Slackの時間・文面: 保存してもページに残り、最新の内容で描き直される', (await a.locator('.settings-page').count()) === 1 && (await a.inputValue('#set-slackcfg [name=morTime]')) === '09:15');
  // 戻る・進む・再読み込み
  await a.reload(); await a.waitForSelector('.settings-page'); ok('再読み込みしても、設定のページのまま', true);
  await a.click('button:has-text("カレンダーに戻る")'); await a.waitForSelector('.cal'); ok('「カレンダーに戻る」で、カレンダーに戻る（予定も出る）', !a.url().includes('#settings') && (await a.locator('.settings-page').count()) === 0);
  await a.goBack(); await a.waitForSelector('.settings-page'); ok('ブラウザの「戻る」で、設定のページに戻る', true);
  await a.keyboard.press('c'); await a.waitForSelector('.cal'); ok('設定のページで「c」を押すと、カレンダーに戻る', (await a.locator('.settings-page').count()) === 0);
  await a.keyboard.press('?'); await a.waitForSelector('.overlay .sc-table'); await a.keyboard.press('Escape');
  // 一般の社員: 管理者向けは出ない
  const y = await mk(); await login(y, 'yamada@example.com', 'yamadapass1'); await y.click('header button:has-text("設定")'); await y.waitForSelector('.settings-page');
  const yt = await y.locator('.set-sec > h3').allInnerTexts(); ok('一般の社員には、管理者向けの項目は出ない', yt.length === 5 && !yt.join().includes('社員の管理') && !yt.join().includes('Slack'), yt);
  // スマホ幅
  const ph = await mk({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await login(ph, 'admin@example.com', 'adminpass1'); await ph.click('header button:has-text("設定")'); await ph.waitForSelector('.settings-page'); await ph.waitForTimeout(800);
  const m = await ph.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok('スマホ: 横にはみ出さない', m[0] <= m[1], m); await ph.screenshot({ path: 'set-phone.png' });
  await a.goto(BASE + 'index.php#settings'); await a.waitForSelector('.settings-page'); await a.waitForTimeout(800); await a.screenshot({ path: 'set-desk.png' });
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); })();
