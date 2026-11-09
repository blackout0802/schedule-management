// 設定のページ（#settings）と、会社の管理のページ（#admin。管理者だけ）（v1.105.0）
// 設定は自分のことだけ（4項目）。会社の管理は、まとまり（人と日付・通知）＋管理の道具（タイル）。見出しの右に、いまの設定の要約。
// Slack は1つの項目の中のタブ。ショートカットキーは、上の帯の「?」（「?」キー）
const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
(async () => { const b = await chromium.launch();
  const mk = async (opts) => { const c = await b.newContext(opts || { viewport: { width: 1280, height: 1000 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept()); return p; };
  const login = async (p, em, pw) => { await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); };
  const titles = p => p.locator('.set-sec .set-title').allInnerTexts();
  const a = await mk(); await login(a, 'admin@example.com', 'adminpass1');
  // ---- 設定（自分のこと）
  await a.click('header button:has-text("設定")'); await a.waitForSelector('.settings-page');
  ok('「設定」を押すと、ポップアップではなく、設定のページになる（URL は #settings）', a.url().endsWith('#settings') && (await a.locator('.overlay').count()) === 0 && (await a.locator('.cal').count()) === 0);
  let t = await titles(a);
  ok('設定は、自分のことの4項目だけ（管理者でも）', t.join(',') === '予定の色,休みの出し方,共有リンク（家族・会社へ）,家族の招待', t);
  ok('左に、項目の一覧（ジャンプ用）がある', (await a.locator('.set-nav a').count()) === t.length);
  ok('ショートカットキーは、設定の項目には無い', (await a.locator('#set-shortcuts').count()) === 0);
  await a.waitForFunction(() => document.querySelector('#set-family .set-sum').innerText.trim() !== '');
  ok('見出しの右に、いまの設定が出る（色・休みの出し方・共有リンク・家族）', (await a.locator('#set-colors .sum-chip').count()) === 4 && (await a.locator('#set-offmark .set-sum').innerText()).includes('業務: 帯')
    && (await a.locator('#set-share .set-sum').innerText()).includes('家族用: なし') && (await a.locator('#set-family .set-sum').innerText()).includes('まだ招待していません'));
  ok('予定の色: パレットが、ページの中に出ている', (await a.locator('#set-colors .cs-sw, #set-colors .pal').count()) > 0);
  ok('ページの中に、「閉じる」ボタンは無い', (await a.locator('.set-sec button:has-text("閉じる")').count()) === 0);
  ok('設定のページに、システム更新（zip）・画面の色の項目は無い', (await a.locator('#set-update').count()) === 0 && (await a.locator('#set-theme').count()) === 0);
  // 休みの出し方を変えると、要約も変わる
  await a.selectOption('#set-offmark select[name=offmark_team]', 'icon'); await a.click('#set-offmark button[type=submit]'); await a.waitForSelector('.toast');
  await a.waitForFunction(() => document.querySelector('#set-offmark .set-sum').innerText.includes('業務: アイコン'), null, { timeout: 5000 }).catch(() => {});
  ok('保存すると、見出しの右の要約も最新になる', (await a.locator('#set-offmark .set-sum').innerText()).includes('業務: アイコン'), await a.locator('#set-offmark .set-sum').innerText());
  // ショートカットキー: 上の帯の「?」
  await a.click('header .kbd-help'); await a.waitForSelector('.overlay .sc-table');
  ok('上の帯の「?」で、ショートカットキーの一覧が開く', (await a.locator('.overlay .sc-table').innerText()).includes('カレンダーを表示')); await a.keyboard.press('Escape'); await a.waitForFunction(() => !document.querySelector('.overlay'));
  // ---- 会社の管理（管理者）
  await a.click('.set-switch button:has-text("会社の管理")'); await a.waitForSelector('.admin-page');
  ok('切り替えで、会社の管理のページになる（URL は #admin）', a.url().endsWith('#admin') && (await a.locator('.settings-page > h2').innerText()) === '会社の管理');
  t = await titles(a);
  ok('会社の管理: 社員・休業日・会議室・Slack通知の4項目', t.join(',') === '社員の管理,会社の休業日,会議室の設定,Slack通知', t);
  ok('まとまりの見出し（人と日付・通知・管理の道具）', (await a.locator('.set-content > .set-group').allInnerTexts()).join(',') === '人と日付,通知,管理の道具');
  ok('管理の道具は、4つのタイル（利用状況・変更履歴・バックアップ・運用の手引き）', (await a.locator('#set-tools .set-tile').count()) === 4 && (await a.getAttribute('#set-backup', 'href')) === 'backup.php' && (await a.getAttribute('#set-guide', 'target')) === '_blank');
  await a.waitForFunction(() => document.querySelector('#set-slack .set-sum').innerText.trim() !== '' && document.querySelector('#set-usage .tile-sub').innerText.trim() !== '' && document.querySelector('#set-backup .tile-sub').innerText.trim() !== '');
  ok('見出しの右の要約（社員の数・Slack の時刻と送り先）', (await a.locator('#set-users .set-sum').innerText()).includes('3人') && /朝 \d\d:\d\d・夕方 \d\d:\d\d ／ /.test(await a.locator('#set-slack .set-sum').innerText()), [await a.locator('#set-users .set-sum').innerText(), await a.locator('#set-slack .set-sum').innerText()]);
  ok('タイルにも、いまの状態（利用状況の気をつけること・自動バックアップ）', (await a.locator('#set-usage .tile-sub').innerText()).includes('気をつけること') && (await a.locator('#set-backup .tile-sub').innerText()).includes('自動バックアップ'));
  ok('社員の管理: 社員の表が出ている', (await a.locator('#set-users table').innerText()).includes('山田 花子'));
  await a.locator('#set-users button:has-text("編集")').first().click(); await a.waitForSelector('.overlay .modal'); ok('社員の編集は、入力用のポップアップで開く', (await a.locator('.overlay .modal').innerText()).includes('社員を編集')); await a.click('.overlay button:has-text("キャンセル")'); await a.waitForFunction(() => !document.querySelector('.overlay'));
  ok('ポップアップを閉じても、会社の管理のページのまま', (await a.locator('.admin-page').count()) === 1);
  // Slack通知: タブ
  ok('Slack通知: 初めは「送り先・テスト送信」のタブ', await a.locator('#set-slack .slack-status').isVisible() && !(await a.locator('#set-slackcfg').isVisible()));
  await a.click('#set-slack .set-tab:has-text("時刻と文面")'); await a.waitForSelector('#set-slackcfg .slack-preview', { state: 'visible' });
  ok('「時刻と文面」のタブに切り替えると、時刻・文面が出る（送り先は隠れる）', (await a.locator('#set-slackcfg .slack-preview').count()) >= 2 && !(await a.locator('#set-slack .slack-status').isVisible()));
  await a.fill('#set-slackcfg [name=morTime]', '9:15'); await a.press('#set-slackcfg [name=morTime]', 'Tab'); await a.locator('#set-slackcfg button.btn.primary:has-text("保存")').click(); await a.waitForSelector('.toast:has-text("保存しました")'); await a.waitForTimeout(1200);
  ok('Slackの時間・文面: 保存してもページに残り、最新の内容で描き直される（タブもそのまま）', (await a.locator('.admin-page').count()) === 1 && (await a.inputValue('#set-slackcfg [name=morTime]')) === '09:15' && await a.locator('#set-slackcfg').isVisible());
  await a.waitForFunction(() => document.querySelector('#set-slack .set-sum').innerText.includes('朝 09:15'), null, { timeout: 5000 }).catch(() => {});
  ok('保存すると、Slack の要約も最新になる', (await a.locator('#set-slack .set-sum').innerText()).includes('朝 09:15'), await a.locator('#set-slack .set-sum').innerText());
  // 管理の道具: 利用状況・変更履歴は、ポップアップ
  await a.click('#set-usage'); await a.waitForSelector('.overlay .usage-sec'); ok('利用状況のタイルを押すと、ポップアップで開く', true); await a.keyboard.press('Escape'); await a.waitForFunction(() => !document.querySelector('.overlay'));
  await a.click('#set-audit'); await a.waitForSelector('.overlay .audit-list'); ok('変更履歴のタイルを押すと、ポップアップで開く', true); await a.keyboard.press('Escape'); await a.waitForFunction(() => !document.querySelector('.overlay'));
  // 戻る・進む・再読み込み
  await a.reload(); await a.waitForSelector('.admin-page'); ok('再読み込みしても、会社の管理のページのまま', true);
  ok('Slack のタブは、この端末が覚える', await a.locator('#set-slackcfg').isVisible());
  await a.click('#set-slack .set-tab:has-text("送り先")');
  await a.click('button:has-text("カレンダーに戻る")'); await a.waitForSelector('.cal'); ok('「カレンダーに戻る」で、カレンダーに戻る（予定も出る）', !a.url().includes('#admin') && (await a.locator('.settings-page').count()) === 0);
  await a.goBack(); await a.waitForSelector('.admin-page'); ok('ブラウザの「戻る」で、会社の管理のページに戻る', true);
  await a.keyboard.press('c'); await a.waitForSelector('.cal'); ok('会社の管理のページで「c」を押すと、カレンダーに戻る', (await a.locator('.settings-page').count()) === 0);
  await a.keyboard.press('?'); await a.waitForSelector('.overlay .sc-table'); await a.keyboard.press('Escape');
  ok('カレンダーの上の帯に、「会社の管理」のボタン（管理者）', await a.locator('header .admin-btn button').isVisible());
  await a.click('header button:has-text("会社の管理")'); await a.waitForSelector('.admin-page'); ok('押すと、会社の管理のページが開く', a.url().endsWith('#admin'));
  await a.screenshot({ path: 'admin-desk.png', fullPage: true });
  await a.click('.set-switch button:has-text("設定")'); await a.waitForSelector('.settings-page:not(.admin-page)'); await a.screenshot({ path: 'set-desk.png' });
  // ---- 一般の社員: 会社の管理は無い
  const y = await mk(); await login(y, 'yamada@example.com', 'yamadapass1');
  ok('一般の社員には、上の帯に「会社の管理」が無い', (await y.locator('header .admin-btn').count()) === 0);
  await y.click('header button:has-text("設定")'); await y.waitForSelector('.settings-page');
  const yt = await titles(y); ok('一般の社員の設定も、同じ4項目（管理者向けは出ない）・切り替えは無い', yt.length === 4 && yt.join().includes('休みの出し方') && (await y.locator('.set-switch').count()) === 0, yt);
  await y.goto(BASE + 'index.php#admin'); await y.waitForTimeout(500);
  ok('一般の社員が #admin を開いても、設定のページになる', (await y.locator('.admin-page').count()) === 0 && (await y.locator('.settings-page').count()) === 1 && (await y.locator('#set-users').count()) === 0);
  // ---- スマホ幅（管理者）
  const ph = await mk({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await login(ph, 'admin@example.com', 'adminpass1');
  ok('スマホ: カレンダーの上の帯には「会社の管理」を出さず（幅がないため）、名前のメニューに入れる', !(await ph.locator('header .admin-btn').isVisible()) && !(await ph.locator('header .kbd-help').isVisible()));
  ok('スマホ: カレンダーの上の帯は、増えていない（2段まで）', await ph.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().height) <= 130, await ph.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().height));
  await ph.click('header button:has-text("管理者")'); await ph.click('.menu-list button:has-text("会社の管理")'); await ph.waitForSelector('.admin-page'); await ph.waitForTimeout(800);
  const m = await ph.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.querySelector('.topbar').getBoundingClientRect().height]);
  ok('スマホ: 会社の管理は、横にはみ出さず、上の帯は1行（切り替えはページの見出しの上）', m[0] <= m[1] && m[2] <= 60 && await ph.locator('.settings-page > .set-switch').isVisible(), m);
  await ph.screenshot({ path: 'admin-phone.png', fullPage: true });
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); })();
