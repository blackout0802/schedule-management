// 設定・会社の管理のページ: 各項目は、見出しを押すと開く（初めは畳んである。開いた項目は覚える）／ショートカットキー（「?」）は、コンパクトに並ぶ
const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  // 画面テストの「すべて開く」設定を外して、ふだんの状態にする
  await p.evaluate(() => { sessionStorage.setItem('e2e.keepCollapsed', '1'); localStorage.removeItem('sched.setOpen'); });
  await p.reload(); await p.waitForSelector('.cal');
  await p.click('header button:has-text("設定")'); await p.waitForSelector('.settings-page');
  const n = await p.locator('.set-sec').count();
  ok('設定の項目は、初めは、すべて畳んである', n === 4 && (await p.locator('.set-sec.open').count()) === 0 && !(await p.locator('#set-colors .cs-tabs').isVisible()), n);
  ok('畳んでいても、見出しは並んでいる（押せる）', (await p.locator('.set-sec > h3[role=button][aria-expanded=false]').count()) === n);
  await p.click('#set-colors > h3'); await p.waitForSelector('#set-colors .cs-tabs', { state: 'visible' });
  ok('見出しを押すと、その項目が開く', (await p.locator('#set-colors.open').count()) === 1 && (await p.getAttribute('#set-colors > h3', 'aria-expanded')) === 'true' && (await p.locator('.set-sec.open').count()) === 1);
  await p.click('#set-colors > h3'); await p.waitForFunction(() => !document.querySelector('#set-colors .cs-tabs') || document.querySelector('#set-colors .cs-tabs').offsetParent === null);
  ok('もう一度押すと、畳まれる', (await p.locator('.set-sec.open').count()) === 0);
  // 左の一覧を押すと、開いて、そこへ動く
  await p.click('.set-nav a:has-text("家族の招待")'); await p.waitForSelector('#set-family.open');
  ok('左の一覧の項目を押すと、その項目が開く', (await p.locator('#set-family.open').count()) === 1);
  // 会社の管理も、初めは畳んである
  await p.click('.set-switch button:has-text("会社の管理")'); await p.waitForSelector('.admin-page .set-sec');
  ok('会社の管理の項目も、初めは、すべて畳んである', (await p.locator('.set-sec').count()) === 7 && (await p.locator('.set-sec.open').count()) === 0); // 点検項目（年間計画）・家族の画面の確認が増えたので 5 → 7
  await p.click('.set-nav a:has-text("会社の休業日")'); await p.waitForSelector('#set-holidays.open');
  // 開いた項目は、覚える
  await p.click('.set-switch button:has-text("設定")'); await p.waitForSelector('.settings-page:not(.admin-page)');
  await p.click('#set-offmark > h3'); await p.waitForSelector('#set-offmark select', { state: 'visible' });
  await p.click('button:has-text("カレンダーに戻る")'); await p.waitForSelector('.cal'); await p.click('header button:has-text("設定")'); await p.waitForSelector('.settings-page');
  ok('開いた項目は、設定のページを開き直しても、開いたまま（この端末に記憶）', (await p.locator('#set-offmark.open').count()) === 1 && (await p.locator('#set-family.open').count()) === 1 && (await p.locator('#set-colors.open').count()) === 0);
  await p.click('.set-switch button:has-text("会社の管理")'); await p.waitForSelector('.admin-page .set-sec');
  ok('会社の管理で開いた項目も、覚える', (await p.locator('#set-holidays.open').count()) === 1 && (await p.locator('#set-users.open').count()) === 0);
  await p.screenshot({ path: 'collapse-open.png' });
  // ショートカットキー: 設定の項目ではなく、上の帯の「?」（「?」キー）。コンパクトに並ぶ
  await p.click('header .kbd-help'); await p.waitForSelector('.overlay .sc-grid');
  const g = await p.locator('.overlay .sc-grid').evaluate(e => ({ h: e.getBoundingClientRect().height, cols: getComputedStyle(e).gridTemplateColumns.split(' ').length, items: e.querySelectorAll('.sc-item').length, txt: e.innerText }));
  ok('ショートカットキーは、2列以上に並び、縦が短い（220px以内）', g.cols >= 2 && g.h <= 220 && g.items >= 11 && g.txt.includes('カレンダーを表示') && g.txt.includes('このショートカット一覧'), g);
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.overlay'));
  await p.keyboard.press('Shift+/'); await p.waitForSelector('.overlay .sc-grid'); ok('「?」キーでも、同じ一覧が開く', true); await p.keyboard.press('Escape');
  // スマホ: 同じく畳んである
  const m = await (await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  await m.goto(BASE + 'login.php'); await m.fill('input[name=email]', 'admin@example.com'); await m.fill('input[name=password]', 'adminpass1'); await Promise.all([m.waitForURL('**/index.php'), m.click('button[type=submit]')]); await m.waitForSelector('.cal');
  await m.goto(BASE + 'index.php#settings'); await m.waitForSelector('.settings-page'); await m.waitForTimeout(300);
  const mo = await m.locator('.set-sec.open').count(); ok('スマホでも、初めは畳んである', mo === 0, [mo, await m.evaluate(() => localStorage.getItem('sched.setOpen'))]);
  await m.tap('#set-offmark > h3'); await m.waitForTimeout(400); ok('スマホでも、見出しを押すと開く', (await m.locator('#set-offmark.open').count()) === 1, await m.evaluate(() => document.getElementById('set-offmark').className));
  ok('スマホでも、横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('スマホでは、「?」（ショートカットキー）のボタンは出さない', !(await m.locator('header .kbd-help').isVisible()));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
