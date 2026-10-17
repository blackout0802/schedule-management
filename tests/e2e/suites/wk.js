// カレンダーの週表示: 月／週の切り替え・1週間だけを大きく出す・‹ ›は1週ずつ・今日・w キー・覚える・月に戻せる・予定が出る・スマホで横にはみ出さない
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0'); const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
(async () => {
  const b = await chromium.launch();
  const mk = async (vp) => { const p = await (await b.newContext({ viewport: vp || { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', String(e)));
    await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
  const p = await mk();
  const today = new Date(), sun = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  // 今週と来週に、予定を入れる
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const d1 = ymd(new Date(sun.getTime() + 2 * 864e5)), d2 = ymd(new Date(sun.getTime() + 9 * 864e5));
  await api('event_save', { kind: 'work', title: '週の火曜の予定', tag: '打ち合わせ', start: d1, end: d1, start_time: '10:00', end_time: '11:00' });
  await api('event_save', { kind: 'work', title: '来週の火曜の予定', tag: '打ち合わせ', start: d2, end: d2 });
  await p.reload(); await p.waitForSelector('.cal');
  ok('初めは月表示。「月」「週」の切り替えがある', (await p.locator('.span-sw button[aria-pressed=true]').innerText()) === '月' && (await p.locator('.cal .week').count()) >= 4);
  await p.click('.span-sw button:has-text("週")'); await p.waitForFunction(() => document.querySelectorAll('.cal .week').length === 1);
  const h2 = await p.locator('.toolbar h2').innerText();
  ok('週表示: 1週間（7日）だけが出る。見出しは、その週の日付', (await p.locator('.cal .week .cell').count()) === 7 && /^\d{4}年\d+月\d+日〜(\d+月)?\d+日$/.test(h2), h2);
  ok('今日を含む週が出て、その週の予定が、全文で出る（来週の予定は出ない）', (await p.locator('.cal .week .cell.today').count()) === 1 && (await p.locator('.bar:has-text("週の火曜の予定")').count()) === 1 && (await p.locator('.bar:has-text("来週の火曜の予定")').count()) === 0);
  const hgt = await p.locator('.cal .week').evaluate(e => e.getBoundingClientRect().height);
  ok('週は、月表示の1週より、ずっと大きい', hgt > 300, hgt);
  await p.click('.toolbar button[aria-label="次の週"]'); await p.waitForSelector('.bar:has-text("来週の火曜の予定")');
  ok('「›」で、1週先へ進む（来週の予定が出る）', (await p.locator('.bar:has-text("週の火曜の予定")').count()) === 1 && (await p.locator('.cal .week .cell.today').count()) === 0);
  await p.click('.toolbar button[aria-label="前の週"]'); await p.waitForSelector('.cal .week .cell.today');
  await p.click('.toolbar button[aria-label="次の週"]'); await p.waitForTimeout(300); await p.click('.toolbar button:has-text("今日")'); await p.waitForSelector('.cal .week .cell.today');
  ok('「今日」で、今日の週に戻る', true);
  await p.keyboard.press('ArrowRight'); await p.waitForSelector('.bar:has-text("来週の火曜の予定")'); await p.keyboard.press('ArrowLeft'); await p.waitForSelector('.cal .week .cell.today');
  ok('キーの ← → も、1週ずつ', true);
  await p.reload(); await p.waitForSelector('.cal');
  ok('週表示は、開き直しても、覚えている', (await p.locator('.span-sw button[aria-pressed=true]').innerText()) === '週' && (await p.locator('.cal .week').count()) === 1);
  await p.keyboard.press('w'); await p.waitForFunction(() => document.querySelectorAll('.cal .week').length >= 4);
  ok('キーの w で、月表示に戻る', (await p.locator('.toolbar h2').innerText()).includes('月') && !(await p.locator('.toolbar h2').innerText()).includes('日〜'));
  await p.keyboard.press('w'); await p.waitForFunction(() => document.querySelectorAll('.cal .week').length === 1);
  // 週表示でも、日付を押して予定を追加できる
  await p.click('.cal .week .cell.today', { position: { x: 8, y: 150 } }); await p.waitForSelector('.modal input[name=title]');
  ok('週表示でも、日付の欄を押すと、予定の追加画面が開く', (await p.inputValue('.modal input[name=start]')) === ymd(today));
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.click('.span-sw button:has-text("月")'); await p.waitForFunction(() => document.querySelectorAll('.cal .week').length >= 4);
  await p.evaluate(() => localStorage.removeItem('sched.span'));
  // スマホ幅
  const m = await mk({ width: 390, height: 844 });
  await m.click('.span-sw button:has-text("週")'); await m.waitForFunction(() => document.querySelectorAll('.cal .week').length === 1);
  ok('スマホ幅でも、週表示が横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
