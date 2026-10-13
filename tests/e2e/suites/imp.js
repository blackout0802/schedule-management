const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const ds = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
async function login(b, email, pw) { const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; }
(async () => {
  const b = await chromium.launch(); const p = await login(b, 'yamada@example.com', 'yamadapass1');
  await p.keyboard.press('n'); await p.waitForSelector('.modal'); await p.fill('.modal input[name=title]', '全体会議の準備'); await p.fill('.modal input[name=start]', ds);
  ok('予定の入力画面に「重要な予定にする」がある（初期はオフ）', await p.locator('.modal input[name=important]').count() === 1 && !(await p.locator('.modal input[name=important]').isChecked()));
  await p.check('.modal input[name=important]'); await p.click('.modal button[type=submit]'); await p.waitForSelector('.bar.imp');
  const bar = p.locator('.bar.imp').first(); ok('重要な予定は ★ 付きで、塗りつぶしの強調になる', (await bar.innerText()).startsWith('★') && await bar.evaluate(e => getComputedStyle(e).fontWeight) === '700', await bar.innerText());
  const bg = await bar.evaluate(e => getComputedStyle(e).backgroundColor); ok('背景は種類の色（業務=濃い青）で塗られる', bg === 'rgb(0, 102, 214)', bg);
  await p.screenshot({ path: 'imp-cal.png' });
  // 普通の予定との区別
  await p.keyboard.press('n'); await p.waitForSelector('.modal'); await p.fill('.modal input[name=title]', '普通の予定'); await p.fill('.modal input[name=start]', ds); await p.click('.modal button[type=submit]'); await p.waitForSelector('.bar:has-text("普通の予定")');
  ok('重要でない予定は、強調されない', !(await p.locator('.bar:has-text("普通の予定")').first().getAttribute('class')).includes('imp'));
  // 編集して外す・付ける
  await p.locator('.bar:has-text("普通の予定")').first().click(); await p.waitForSelector('.modal'); await p.check('.modal input[name=important]'); await p.click('.modal button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('.bar.imp').length === 2); ok('あとから重要にできる', true);
  await p.locator('.bar.imp:has-text("全体会議の準備")').first().click(); await p.waitForSelector('.modal'); ok('編集画面で、重要のチェックが入っている', await p.locator('.modal input[name=important]').isChecked()); await p.uncheck('.modal input[name=important]'); await p.click('.modal button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('.bar.imp').length === 1); ok('あとから外せる', true);
  // 他の社員にも強調されて見える
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await s.selectOption('#who-sel', 'all'); await s.waitForTimeout(500); ok('他の社員の画面でも、強調されて見える', await s.locator('.bar.imp:has-text("普通の予定")').count() === 1);
  await s.locator('.bar.imp').first().click(); await s.waitForSelector('.modal'); ok('他の社員が開いても「重要」と分かる（編集は持ち主か管理者だけ）', (await s.locator('.modal').innerText()).includes('重要'), await s.locator('.modal').innerText());
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
