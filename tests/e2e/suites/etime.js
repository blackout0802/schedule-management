// 予定の入力: 業務の分類の初期値は「個人作業」／開始時刻を入れると、終了時刻に30分後が自動で入る
const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const S = '.modal input[name=start_time]', E = '.modal input[name=end_time]';
  const setStart = async (v) => { await p.fill(S, v); await p.press(S, 'Tab'); };
  await p.keyboard.press('n'); await p.waitForSelector('.modal input[name=title]');
  ok('業務の分類の初期値は「個人作業」', (await p.inputValue('.modal select[name=tag]')) === '個人作業', await p.inputValue('.modal select[name=tag]'));
  await p.click('.modal label.off'); ok('休みにすると、分類は、休みの先頭（有給）', (await p.inputValue('.modal select[name=tag]')) === '有給');
  await p.click('.modal label.work'); ok('休みから業務に戻すと、分類は、また「個人作業」', (await p.inputValue('.modal select[name=tag]')) === '個人作業', await p.inputValue('.modal select[name=tag]'));
  // 終了時刻の自動入力
  await setStart('9:30'); ok('開始を入れると、終了に30分後が入る（9:30 → 10:00）', (await p.inputValue(S)) === '09:30' && (await p.inputValue(E)) === '10:00', [await p.inputValue(S), await p.inputValue(E)]);
  await setStart('10:15'); ok('開始を変えると、自動で入れた終了も、ついてくる（10:15 → 10:45）', (await p.inputValue(E)) === '10:45', await p.inputValue(E));
  await p.fill(E, '12:00'); await p.press(E, 'Tab'); await setStart('11:00');
  ok('終了を手で入れたあとは、開始を変えても、終了は変わらない', (await p.inputValue(E)) === '12:00', await p.inputValue(E));
  await setStart(''); ok('終了を手で入れていれば、開始を消しても、終了は残る', (await p.inputValue(E)) === '12:00');
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.keyboard.press('n'); await p.waitForSelector('.modal input[name=title]');
  await setStart('14:00'); await setStart(''); ok('自動で入れた終了は、開始を消すと、いっしょに消える', (await p.inputValue(E)) === '', await p.inputValue(E));
  await setStart('23:45'); ok('日をまたぐときは、23:59 まで', (await p.inputValue(E)) === '23:59', await p.inputValue(E));
  await setStart('16:00'); await p.fill('.modal input[name=title]', '時刻の自動入力'); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal'));
  const saved = await p.evaluate(async () => { const n = new Date(); const d = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); const r = await (await fetch('api.php?action=events&from=' + d + '&to=' + d + '&view=team')).json(); const e = r.events.find(x => x.title === '時刻の自動入力'); return e ? [e.start_time, e.end_time, e.tag] : null; });
  ok('保存すると、開始16:00・終了16:30・分類は個人作業で登録される', JSON.stringify(saved) === JSON.stringify(['16:00', '16:30', '個人作業']), saved);
  // 手で時刻を入れた予定を開いて、開始を変えても、終了は変えない
  await p.locator('.bar:has-text("時刻の自動入力")').first().click(); await p.waitForSelector('.modal input[name=title]');
  await setStart('17:00'); ok('入れてある予定の開始を変えても、終了は変わらない', (await p.inputValue(E)) === '16:30', await p.inputValue(E));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
