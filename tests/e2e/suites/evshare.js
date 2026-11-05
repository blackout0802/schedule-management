// 業務の予定を、社員どうしで共有する（一緒にやる人）: 選んだ人の「自分」の表示・日報にも出る。帯の先頭に、持ち主と一緒にやる人の姓。休みには出ない。編集は持ち主だけ
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
async function login(b, email, pw) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p;
}
(async () => {
  const b = await chromium.launch();
  const y = await login(b, 'yamada@example.com', 'yamadapass1');
  const { cur } = await y.evaluate(async () => (await fetch('api.php?action=memo_get')).json());
  await y.evaluate(() => localStorage.setItem('sched.span', '"week"')); await y.reload(); await y.waitForSelector('.cal');
  await y.keyboard.press('n'); await y.waitForSelector('.modal input[name=title]');
  ok('業務の予定の入力に「一緒にやる人」があり、自分は選べない', (await y.locator('.modal .ev-parts').isVisible()) && (await y.locator('.modal .ev-parts').innerText()).includes('鈴木 一郎') && !(await y.locator('.modal .ev-parts').innerText()).includes('山田 花子'));
  await y.click('.modal label.off'); ok('休みでは、「一緒にやる人」は出ない', !(await y.locator('.modal .ev-parts').isVisible())); await y.click('.modal label.work');
  await y.fill('.modal input[name=title]', '棚卸し'); await y.fill('.modal input[name=start]', cur); await y.fill('.modal input[name=end]', cur);
  await y.check('.modal .ev-parts input[value]:near(:text("鈴木 一郎"))').catch(async () => { await y.locator('.modal .ev-parts label:has-text("鈴木 一郎") input').check(); });
  await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal'));
  const s = await login(b, 'suzuki@example.com', 'suzukipass1');
  await s.evaluate(() => localStorage.setItem('sched.span', '"week"')); await s.reload(); await s.waitForSelector('.cal');
  await s.selectOption('#who-sel', { label: '自分' }).catch(() => {}); await s.waitForSelector('.bar:has-text("棚卸し")');
  const sb = await s.locator('.bar:has-text("棚卸し")').first().innerText();
  ok('一緒にやる人（鈴木さん）の「自分」の表示にも出る。先頭に、持ち主と一緒にやる人の姓', sb.startsWith('山田・鈴木｜'), sb);
  await s.locator('.bar:has-text("棚卸し")').first().click(); await s.waitForSelector('.modal');
  const view = await s.locator('.modal').innerText();
  ok('一緒にやる人は、開くと見るだけ（編集できない）。「一緒にやる人」が出る', (await s.locator('.modal input[name=title]').count()) === 0 && view.includes('一緒にやる人') && view.includes('鈴木 一郎'), view);
  await s.keyboard.press('Escape');
  await s.click('.seg label:has-text("リスト")'); await s.waitForSelector('.memo-single');
  await s.waitForFunction(() => Array.from(document.querySelectorAll('.memo-single div[data-ev]')).some(d => d.textContent === '棚卸し'), null, { timeout: 15000 }).catch(() => {});
  ok('一緒にやる人の日報（当日）にも入る', await s.evaluate(() => Array.from(document.querySelectorAll('.memo-single div[data-ev]')).some(d => d.textContent === '棚卸し')));
  const all = await y.evaluate(async (cur) => (await (await fetch('api.php?action=events&view=team&from=' + cur + '&to=' + cur)).json()).events.filter(e => e.title === '棚卸し').map(e => (e.participants || []).map(u => u.name).join('・')), cur);
  ok('予定には、一緒にやる人が保存される', all.length === 1 && all[0] === '鈴木 一郎', all);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
