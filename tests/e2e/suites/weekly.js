// 毎週・隔週の繰り返し: 画面で登録・プレビュー・カレンダーに毎週出る・隔週は1週おき・1回だけ消せる（元に戻す）・ToDo連動
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const openSeries = require('../lib/series');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  // 今月に今日以降の月曜が無い（月末の月曜を過ぎた）ときは、プレビューは来月から（7か月分）、カレンダーは来月で確かめる
  const now = new Date(), last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); let monLeft = false;
  for (let d = now.getDate(); d <= last; d++) if (new Date(now.getFullYear(), now.getMonth(), d).getDay() === 1) monLeft = true;
  const reloadCal = async () => { await p.reload(); await p.waitForSelector('.cal'); if (!monLeft) { await p.click('button[aria-label="次の月"]'); await p.waitForTimeout(800); } };
  const openForm = async () => { await openSeries(p); await p.waitForSelector('.modal'); await p.click('.modal button:has-text("ルールを追加"), .modal button:has-text("追加")'); await p.waitForSelector('.modal input[name=title]'); };
  await openForm();
  ok('ルールの種類に「毎週・隔週 ○曜日」がある', (await p.locator('.modal select[name=rule_type] option').allInnerTexts()).includes('毎週・隔週 ○曜日'));
  await p.selectOption('.modal select[name=rule_type]', 'weekly'); await p.waitForSelector('.modal select[name=p_interval]');
  await p.fill('.modal input[name=title]', '毎週の定例ミーティング'); await p.selectOption('.modal select[name=p_weekday]', '1'); await p.selectOption('.modal select[name=p_interval]', '1');
  await p.waitForFunction(() => document.querySelector('.modal table.t tbody tr td:nth-child(2)') && /月/.test(document.querySelector('.modal table.t tbody tr td:nth-child(2)').textContent));
  const pv = await p.locator('.modal table.t tbody tr').first().locator('td').nth(1).innerText();
  ok('プレビューに、月ごとに、毎週月曜の日付が並ぶ', (await p.locator('.modal table.t tbody tr').count()) >= (monLeft ? 8 : 7) && pv.includes('（月）') && !pv.includes('（火）'), pv);
  await p.fill('.modal input[name=title]', '毎週の定例ミーティング'); await p.click('.modal button[type=submit]'); await p.waitForTimeout(1200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.waitForSelector('.cal');
  await reloadCal();
  const mondays = await p.evaluate(() => Array.from(document.querySelectorAll('.bar')).filter(b => b.textContent.includes('毎週の定例ミーティング')).length);
  ok('カレンダーに、毎週の予定が並ぶ（今日以降の月曜が、今月にある）。月の終わりの週は1回だけのこともある', mondays >= 1, mondays);
  await openSeries(p); await p.waitForSelector('.modal'); await p.waitForSelector('.modal .card:has-text("毎週の定例ミーティング")');
  ok('ルール一覧に「毎週 月曜日」と出る', (await p.locator('.modal .card:has-text("毎週の定例ミーティング")').innerText()).includes('毎週 月曜日'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // 1回だけ消す → 元に戻す
  const before = await p.locator('.bar:has-text("毎週の定例ミーティング")').count();
  await p.locator('.bar:has-text("毎週の定例ミーティング")').first().click(); await p.waitForSelector('.modal input[name=title]'); await p.click('.modal button:has-text("削除")');
  await p.waitForSelector('.toast .toast-act'); await p.waitForTimeout(500);
  ok('1回だけ消せる（毎週の繰り返し自体は残る）', (await p.locator('.bar:has-text("毎週の定例ミーティング")').count()) === before - 1, [before, await p.locator('.bar:has-text("毎週の定例ミーティング")').count()]);
  await p.click('.toast .toast-act'); await p.waitForTimeout(800);
  ok('「元に戻す」で、その回が戻る', (await p.locator('.bar:has-text("毎週の定例ミーティング")').count()) === before);
  // 隔週に変える → 回数が減る
  await openSeries(p); await p.waitForSelector('.modal .card:has-text("毎週の定例ミーティング")');
  await p.locator('.modal .card:has-text("毎週の定例ミーティング") button:has-text("編集")').click(); await p.waitForSelector('.modal select[name=p_interval]');
  await p.selectOption('.modal select[name=p_interval]', '2'); await p.check('.modal input[name=todo_auto]'); await p.waitForTimeout(500); await p.click('.modal button[type=submit]'); await p.waitForTimeout(1200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); await reloadCal();
  const biweekly = await p.locator('.bar:has-text("毎週の定例ミーティング")').count();
  ok('隔週にすると、今月の回数が、およそ半分になる', biweekly <= Math.ceil(before / 2) && biweekly >= 1, [before, biweekly]);
  await openSeries(p); await p.waitForSelector('.modal .card:has-text("毎週の定例ミーティング")');
  const lbl = await p.locator('.modal .card:has-text("毎週の定例ミーティング")').innerText();
  ok('ルール一覧は「隔週 月曜日」「ToDo連動」', lbl.includes('隔週 月曜日') && lbl.includes('ToDo連動'), lbl.slice(0, 120));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // ToDo連動: 2週間以内の回だけ入る
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  const todos = await p.locator('#todo-mgr .kb-card:has-text("毎週の定例ミーティング")').count();
  ok('ToDoリストには、2週間以内の回だけが入る（1〜2件）', todos >= 1 && todos <= 2, todos);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
