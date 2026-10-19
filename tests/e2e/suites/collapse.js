// 設定のページ: 各項目は、見出しを押すと開く（初めは畳んである。開いた項目は覚える）／ショートカットキーは、コンパクトに並ぶ
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
  ok('設定の項目は、初めは、すべて畳んである', n >= 6 && (await p.locator('.set-sec.open').count()) === 0 && !(await p.locator('#set-colors .cs-tabs').isVisible()) && !(await p.locator('#set-shortcuts .sc-grid').isVisible()), n);
  ok('畳んでいても、見出しは並んでいる（押せる）', (await p.locator('.set-sec > h3[role=button][aria-expanded=false]').count()) === n);
  await p.click('#set-colors > h3'); await p.waitForSelector('#set-colors .cs-tabs', { state: 'visible' });
  ok('見出しを押すと、その項目が開く', (await p.locator('#set-colors.open').count()) === 1 && (await p.getAttribute('#set-colors > h3', 'aria-expanded')) === 'true' && (await p.locator('.set-sec.open').count()) === 1);
  await p.click('#set-colors > h3'); await p.waitForFunction(() => !document.querySelector('#set-colors .cs-tabs') || document.querySelector('#set-colors .cs-tabs').offsetParent === null);
  ok('もう一度押すと、畳まれる', (await p.locator('.set-sec.open').count()) === 0);
  // 左の一覧を押すと、開いて、そこへ動く
  await p.click('.set-nav a:has-text("会社の休業日")'); await p.waitForSelector('#set-holidays.open');
  ok('左の一覧の項目を押すと、その項目が開く', (await p.locator('#set-holidays.open').count()) === 1);
  // 開いた項目は、覚える
  await p.click('#set-shortcuts > h3'); await p.waitForSelector('#set-shortcuts .sc-grid', { state: 'visible' });
  await p.click('button:has-text("カレンダーに戻る")'); await p.waitForSelector('.cal'); await p.click('header button:has-text("設定")'); await p.waitForSelector('.settings-page');
  ok('開いた項目は、設定のページを開き直しても、開いたまま（この端末に記憶）', (await p.locator('#set-shortcuts.open').count()) === 1 && (await p.locator('#set-holidays.open').count()) === 1 && (await p.locator('#set-colors.open').count()) === 0);
  // ショートカットキー: コンパクト
  const g = await p.locator('#set-shortcuts .sc-grid').evaluate(e => ({ h: e.getBoundingClientRect().height, cols: getComputedStyle(e).gridTemplateColumns.split(' ').length, items: e.querySelectorAll('.sc-item').length, txt: e.innerText }));
  ok('ショートカットキーは、2列以上に並び、縦が短い（200px以内）', g.cols >= 2 && g.h <= 200 && g.items >= 11 && g.txt.includes('カレンダーを表示') && g.txt.includes('システム更新'), g);
  await p.screenshot({ path: 'collapse-open.png' });
  // ? のダイアログも、同じ並び
  await p.keyboard.press('Shift+/'); await p.waitForSelector('.overlay .sc-grid'); const mg = await p.locator('.overlay .sc-grid').evaluate(e => e.getBoundingClientRect().height); ok('「?」のダイアログも、コンパクト', mg <= 220, mg); await p.keyboard.press('Escape');
  // スマホ: 同じく畳んである
  const m = await (await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  await m.goto(BASE + 'login.php'); await m.fill('input[name=email]', 'admin@example.com'); await m.fill('input[name=password]', 'adminpass1'); await Promise.all([m.waitForURL('**/index.php'), m.click('button[type=submit]')]); await m.waitForSelector('.cal');
  await m.goto(BASE + 'index.php#settings'); await m.waitForSelector('.settings-page'); await m.waitForTimeout(300);
  const mo = await m.locator('.set-sec.open').count(); ok('スマホでも、初めは畳んである', mo === 0, [mo, await m.evaluate(() => localStorage.getItem('sched.setOpen'))]);
  await m.tap('#set-shortcuts > h3'); await m.waitForTimeout(400); ok('スマホでも、見出しを押すと開く', (await m.locator('#set-shortcuts.open').count()) === 1, await m.evaluate(() => document.getElementById('set-shortcuts').className));
  ok('スマホでも、ショートカットは横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
