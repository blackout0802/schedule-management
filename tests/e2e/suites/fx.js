const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const M = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
const BASE = 'http://127.0.0.1:8099/';
(async () => { const b = await chromium.launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 1000 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept()); return p; };
  const login = async (p, em, pw) => { await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await p.click('button[type=submit]'); };
  const a = await mk(); await login(a, 'admin@example.com', 'adminpass1'); await a.waitForSelector('.cal');
  const post = (p, act, body) => p.evaluate(async ([act, body]) => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify(body) }); return [r.status, await r.json()]; }, [act, body]);
  await post(a, 'event_save', { kind: 'off', title: '', tag: '有給', start: `${M}-14`, end: `${M}-15` });
  await a.reload(); await a.waitForSelector('.bar');
  const rgb = (c) => { const v = (c.match(/[\d.]+/g) || []).map(Number); return c.startsWith('color(') ? v.slice(0, 3).map(x => x * 255) : v.slice(0, 3); };
  const bg = (d) => a.locator(`.cell[data-date="${M}-${d}"]`).evaluate(e => getComputedStyle(e).backgroundColor);
  const c14 = await bg('14'), c15 = await bg('15'), c16 = await bg('16');
  ok('休みの人がいる日（14・15日）のセルが、薄く塗りつぶされる。いない日（16日）は塗らない', c14 === c15 && c14 !== c16, [c14, c15, c16]);
  ok('塗りは薄い（白に近い）', rgb(c14).every(v => v > 200), c14);
  ok('凡例に「休みの人がいる日」が出る', (await a.locator('.legend').innerText()).includes('休みの人がいる日'));
  // 設定で、オフ
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-colors .cs-row');
  ok('予定の色の設定に、休みの人がいる日のセルの項目がある', (await a.locator('#set-colors').innerText()).includes('休みの人がいる日（カレンダーのセル）'));
  await a.locator('#set-colors label:has-text("薄く塗りつぶす") input').uncheck(); await a.click('#set-colors button[type=submit]'); await a.waitForSelector('.toast:has-text("色を保存しました")');
  await a.click('button:has-text("カレンダーに戻る")'); await a.waitForSelector('.cal .bar'); await a.waitForTimeout(300);
  ok('オフにすると、塗りつぶされない', (await bg('14')) === (await bg('16')), [await bg('14'), await bg('16')]);
  // 色を選ぶ
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-colors .cs-row'); await a.locator('#set-colors label:has-text("薄く塗りつぶす") input').check();
  await a.locator('#set-colors .cs-row:has-text("休みの人がいる日") button.sw').nth(0).click(); // 淡い赤
  const sample = await a.locator('#set-colors .cs-row:has-text("休みの人がいる日") .cs-sample .cell').evaluate(e => getComputedStyle(e).backgroundColor); ok('色を選ぶと、見本のセルにその場で反映される', /rgb\(2[45]\d, 2[0-3]\d, 2[0-3]\d\)/.test(sample) || sample.startsWith('color('), sample);
  await a.click('#set-colors button[type=submit]'); await a.waitForSelector('.toast:has-text("色を保存しました")'); await a.click('button:has-text("カレンダーに戻る")'); await a.waitForSelector('.cal .bar'); await a.waitForTimeout(300);
  const red = await bg('14'); const [r, g, bl] = rgb(red); ok('選んだ色（赤系）で塗られる', r > g + 3 && r > bl + 3, red);
  await a.reload(); await a.waitForSelector('.cal .bar'); ok('再読み込みしても残る', (await bg('14')) === red);
  // 他の人の画面は、その人の設定（標準）
  const y = await mk(); await login(y, 'yamada@example.com', 'yamadapass1'); await y.selectOption('#who-sel', 'all'); await y.waitForSelector('.cal .bar'); const yc = await y.locator(`.cell[data-date="${M}-14"]`).evaluate(e => getComputedStyle(e).backgroundColor); ok('他の人の画面は、その人の設定（標準の色）のまま', yc !== red && yc !== await y.locator(`.cell[data-date="${M}-16"]`).evaluate(e => getComputedStyle(e).backgroundColor), yc);
  // パスワードのリセット
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-users tbody tr');
  ok('自分の行には、リセットのボタンが無い', (await a.locator('#set-users tr:has-text("管理者 太郎") button:has-text("リセット")').count()) === 0);
  await a.locator('#set-users tr:has-text("山田 花子") button:has-text("パスワードをリセット")').click(); await a.waitForSelector('.modal .temp-pw');
  const tmp = await a.inputValue('.modal .temp-pw'); ok('一時パスワードが、1度だけ表示される（12文字）', /^[A-Za-z0-9]{12}$/.test(tmp), tmp);
  await a.keyboard.press('Escape'); await a.mouse.click(5, 500); await a.waitForTimeout(200); ok('ボタンを押すまで、画面は閉じない（閉じ忘れ防止）', (await a.locator('.modal .temp-pw').count()) === 1);
  await a.click('.modal button:has-text("伝えた")'); await a.waitForFunction(() => !document.querySelector('.modal'));
  const y2 = await mk(); await login(y2, 'yamada@example.com', 'yamadapass1'); await y2.waitForTimeout(800); ok('リセット後は、古いパスワードではログインできない', y2.url().includes('login.php'));
  await y2.fill('input[name=email]', 'yamada@example.com'); await y2.fill('input[name=password]', tmp); await y2.click('button[type=submit]'); await y2.waitForSelector('.notice'); ok('一時パスワードでログインすると、パスワードの変更を求められる', (await y2.locator('.notice').innerText()).includes('はじめにパスワードを変更'));
  const y3 = await mk(); await login(y3, 'suzuki@example.com', 'suzukipass1'); await y3.waitForSelector('.cal'); // 山田さんは、リセットされて、前のログインは終わっているので、別の一般社員で確かめる
  const forb = await y3.evaluate(async () => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=user_reset_password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify({ id: 1 }) }); return r.status; }); ok('一般の社員は、リセットできない（403）', forb === 403, forb);
  const self = await post(a, 'user_reset_password', { id: 1 }); ok('自分自身のリセットは、できない（案内が出る）', self[0] === 400 && /パスワードの変更/.test(self[1].error || ''), self);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); })();
