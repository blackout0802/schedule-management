const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('http://127.0.0.1:8099/login.php'); await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1');
await Promise.all([p.waitForURL('**/index.php'), p.tap('button[type=submit]')]); await p.waitForSelector('.cal');
await p.goto('http://127.0.0.1:8099/index.php#settings'); await p.waitForSelector('.settings-page'); await p.waitForTimeout(600);
for (const id of ['users', 'holidays', 'slack', 'slackcfg', 'audit', 'backup']) {
  ok('スマホ幅の設定: 管理者の項目「' + id + '」がある', await p.locator('#set-' + id).count() === 1);
}
const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
ok('スマホ幅の設定ページは、横にはみ出さない', w[0] <= w[1], w);
for (const u of ['backup.php', 'guide.php']) { await p.goto('http://127.0.0.1:8099/' + u); const ww = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok(u + ' も、スマホ幅ではみ出さない', ww[0] <= ww[1], ww); }
await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); })();
