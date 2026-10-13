const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c) => { console.log((c ? 'OK  ' : 'NG  ') + n); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + 'login.php');
  await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]);
  await p.waitForSelector('.cal');
  const ymd = ((x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'))(new Date());
  // 業務版で業務の予定を作る（共有なし）
  await p.keyboard.press('n');
  await p.fill('input[name=title]', 'B社 会議'); await p.fill('input[name=start]', ymd);
  await p.selectOption('select[name=tag]', '打ち合わせ');
  ok('業務版: 家族に共有は初期でオフ', !(await p.locator('input[name=family_shared]').isChecked()));
  await p.click('.modal button[type=submit]');
  await p.waitForSelector('.bar:has-text("B社 会議")');
  await p.click('.tab[data-view=me]');
  await p.waitForSelector('.view-banner.me');
  await p.waitForTimeout(500);
  ok('プライベート版: 絞り込みのチェックが無い', await p.locator('.fchip, .filters').count() === 0);
  ok('プライベート版: 共有していない業務は出ない', await p.locator('.bar:has-text("B社 会議")').count() === 0);
  ok('説明文が新しくなっている', (await p.locator('.view-banner').innerText()).includes('家族に共有'));
  // 業務版で共有にチェック
  await p.click('.tab[data-view=team]');
  await p.waitForSelector('.bar:has-text("B社 会議")');
  await p.click('.bar:has-text("B社 会議")');
  await p.waitForSelector('.modal input[name=family_shared]');
  ok('ダイアログの説明に、プライベート版にも出るとある', (await p.locator('.modal label.check:has(input[name=family_shared])').innerText()).includes('プライベート版'));
  await p.check('.modal input[name=family_shared]');
  await p.click('.modal button[type=submit]');
  await p.waitForTimeout(600);
  await p.click('.tab[data-view=me]');
  await p.waitForSelector('.bar:has-text("B社 会議")');
  ok('共有にした業務が、プライベート版に重なる', await p.locator('.bar.work:has-text("B社 会議")').count() === 1);
  await p.screenshot({ path: 'pv-me.png', fullPage: true });
  // 家族用リンクにも同じものが出る
  console.log('errs', errs);
  ok('JSエラーなし', errs.length === 0);
  await b.close();
  console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
