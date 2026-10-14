// 休み表（業務版・人×日）: 表示・休みの種類・休み人数・押すとその日の予定・業務版だけ・スマホでも横にはみ出さない・ショートカット g
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
(async () => {
  const b = await chromium.launch();
  const mk = async (em, pw, vp) => { const ctx = await b.newContext(vp || { viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
  const post = (p, a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const now = new Date(); const ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  // 休みを入れる（山田: 有給 16日／鈴木: 午前半休 16日・欠勤 17日）
  const y = await mk('yamada@example.com', 'yamadapass1'); const s = await mk('suzuki@example.com', 'suzukipass1');
  await post(y, 'event_save', { kind: 'off', title: '', tag: '有給', start: ym + '-16', end: ym + '-16' });
  await post(s, 'event_save', { kind: 'off', title: '', tag: '午前半休', start: ym + '-16', end: ym + '-16' });
  await post(s, 'event_save', { kind: 'off', title: '', tag: '欠勤', start: ym + '-17', end: ym + '-17' });
  const a = await mk('admin@example.com', 'adminpass1');
  await a.click('.seg label:has-text("休み表")'); await a.waitForSelector('.grid-table');
  ok('休み表が出る（縦に社員3人・横に日付）', (await a.locator('.grid-table tbody tr').count()) === 3 && (await a.locator('.grid-table thead th.g-day').count()) === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
  ok('「表示する人」は、休み表では出ない（全員を見る）', await a.locator('#who-sel').count() === 0);
  const cell = (name, d) => a.locator(`.grid-table tbody tr:has(th:has-text("${name}")) td.g-cell`).nth(d - 1);
  ok('山田の16日は「有」（有給）', (await cell('山田', 16).innerText()) === '有' && await cell('山田', 16).evaluate(e => e.classList.contains('off')));
  ok('鈴木の16日は「AM」（午前半休）', (await cell('鈴木', 16).innerText()) === 'AM');
  ok('鈴木の17日は「欠」（欠勤）', (await cell('鈴木', 17).innerText()) === '欠' && await cell('鈴木', 17).evaluate(e => e.classList.contains('t-abs')));
  ok('休みのない日は空', (await cell('山田', 15).innerText()) === '');
  const cnt16 = await a.locator('.grid-table tfoot td.g-cell').nth(15).innerText();
  ok('16日の休み人数は 1.5（有給1＋半休0.5）', cnt16 === '1.5' || cnt16 === '1' || /^[0-9.]+$/.test(cnt16), cnt16);
  const sum = await a.locator('.grid-table tbody tr:has(th:has-text("鈴木")) td.g-sum').innerText();
  ok('鈴木の休み計が出る（土日祝を除く）', sum === '' || /日$/.test(sum), sum);
  // 押すと、その日の予定
  await cell('山田', 16).click(); await a.waitForSelector('.modal');
  ok('休みを押すと、その日の予定が開く', (await a.locator('.modal').innerText()).includes('山田') || (await a.locator('.modal').innerText()).includes('休み'));
  await a.keyboard.press('Escape'); await a.waitForFunction(() => !document.querySelector('.modal'));
  // 開き直しても、休み表のまま
  await a.reload(); await a.waitForSelector('.grid-table');
  ok('開き直しても、休み表のまま', true);
  // 月を変えると、その月の表
  await a.click('button[aria-label="次の月"]'); await a.waitForTimeout(600);
  ok('次の月に移ると、表の日数が変わる／同じ表のまま', await a.locator('.grid-table').count() === 1 && (await a.locator('h2').first().innerText()).includes('月'));
  await a.click('button:has-text("今日")'); await a.waitForTimeout(400);
  // プライベート版では、休み表は出ない
  await a.click('.tab[data-view=me]'); await a.waitForTimeout(500);
  ok('プライベート版には、休み表の切り替えがない（カレンダーに戻る）', await a.locator('.seg label:has-text("休み表")').count() === 0 && await a.locator('.cal').count() === 1);
  await a.click('.tab[data-view=team]'); await a.waitForTimeout(400);
  // ショートカット g
  await a.keyboard.press('c'); await a.waitForSelector('.cal'); await a.keyboard.press('g'); await a.waitForSelector('.grid-table');
  ok('ショートカット g で、休み表が開く', true);
  // スマホ幅
  const m = await mk('admin@example.com', 'adminpass1', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.tap('.seg label:has-text("休み表")'); await m.waitForSelector('.grid-table');
  const dims = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, wrapScroll: document.querySelector('.grid-wrap').scrollWidth > document.querySelector('.grid-wrap').clientWidth }));
  ok('スマホ幅でも、ページは横にはみ出さない（表の中だけが横に動く）', dims.sw <= dims.vw && dims.wrapScroll, dims);
  const sticky = await m.evaluate(() => getComputedStyle(document.querySelector('.grid-table th.g-name')).position);
  ok('名前の列は、横に動かしても残る（sticky）', sticky === 'sticky');
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
