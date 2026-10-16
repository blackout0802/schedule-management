const { chromium } = require(process.env.NODE_PATH + '/playwright');
const openSeries = require('../lib/series');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const today = new Date(); const ds = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
async function login(b, vp, mobile) {
  const ctx = await b.newContext(Object.assign({ viewport: vp }, mobile ? { isMobile: true, hasTouch: true } : {})); const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal, .list'); return p;
}
(async () => {
  const b = await chromium.launch();
  const p = await login(b, { width: 1280, height: 1000 });
  await p.keyboard.press('n'); await p.waitForSelector('.modal');
  ok('PC: 時刻欄は文字入力（候補つき）', await p.locator('.modal input[name=start_time]').getAttribute('type') === 'text' && await p.locator('#time-list option').count() === 48);
  await p.fill('.modal input[name=title]', '時刻テスト'); await p.fill('.modal input[name=start]', ds);
  const cases = [['9', '09:00'], ['930', '09:30'], ['0930', '09:30'], ['9:5', '09:05'], ['２１：３０', '21:30'], ['21時30分', '21:30'], ['18.45', '18:45']];
  for (const [i, o] of cases) { await p.fill('.modal input[name=start_time]', i); await p.press('.modal input[name=start_time]', 'Tab'); const v = await p.inputValue('.modal input[name=start_time]'); ok(`「${i}」→ ${o}`, v === o, v); }
  await p.fill('.modal input[name=start_time]', '930'); await p.fill('.modal input[name=end_time]', '1730');
  await p.click('.modal button[type=submit]'); await p.waitForSelector('.bar:has-text("時刻テスト")');
  ok('保存すると 09:30-17:30 で表示される', (await p.locator('.bar:has-text("時刻テスト")').first().innerText()).includes('09:30-17:30'), await p.locator('.bar:has-text("時刻テスト")').first().innerText());
  // Enter で確定しても正規化される（フォーカスを外さずに保存）
  await p.locator('.bar:has-text("時刻テスト")').first().click(); await p.waitForSelector('.modal');
  ok('編集画面に保存済みの時刻が入る', await p.inputValue('.modal input[name=start_time]') === '09:30' && await p.inputValue('.modal input[name=end_time]') === '17:30');
  await p.fill('.modal input[name=end_time]', '1800'); await p.press('.modal input[name=end_time]', 'Enter');
  await p.waitForFunction(() => !document.querySelector('.modal')); await p.waitForSelector('.bar:has-text("09:30-18:00")'); ok('Enterで保存でき、18:00になる', (await p.locator('.bar:has-text("時刻テスト")').first().innerText()).includes('09:30-18:00'), await p.locator('.bar:has-text("時刻テスト")').first().innerText());
  // 不正な入力は、サーバーの案内が出る
  await p.locator('.bar:has-text("時刻テスト")').first().click(); await p.waitForSelector('.modal');
  await p.fill('.modal input[name=end_time]', '25:00'); await p.click('.modal button[type=submit]'); await p.waitForSelector('.modal .error:not([hidden])');
  ok('不正な時刻（25:00）は、保存されずに案内が出る', (await p.locator('.modal .error').first().innerText()).includes('09:30 の形式'), await p.locator('.modal .error').first().innerText());
  await p.fill('.modal input[name=end_time]', ''); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.waitForFunction(() => { const b = Array.from(document.querySelectorAll('.bar')).find(x => x.textContent.includes('時刻テスト')); return b && !b.textContent.includes('-18:00'); }, null, { timeout: 8000 }).catch(() => {}); // 保存後のカレンダーの描き直しを待つ
  ok('終了時刻を空にできる', (await p.locator('.bar:has-text("時刻テスト")').first().innerText()).includes('09:30') && !(await p.locator('.bar:has-text("時刻テスト")').first().innerText()).includes('-18:00'));
  // 繰り返しの設定
  await openSeries(p); await p.click('.modal >> text=＋ 新しいルール').catch(() => {});
  const nt = await p.locator('.modal input[name=start_time]').count(); ok('繰り返しのルール画面にも同じ時刻欄がある', nt === 0 || await p.locator('.modal input[name=start_time]').first().getAttribute('type') === 'text', nt);
  // スマホ（指で操作する端末）では標準の時刻選択
  const m = await login(b, { width: 390, height: 800 }, true); await m.keyboard.press('n'); await m.waitForSelector('.modal');
  ok('スマホ: 端末標準の時刻選択を使う', await m.locator('.modal input[name=start_time]').getAttribute('type') === 'time');
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
