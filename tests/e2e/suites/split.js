// 繰り返し業務のボタンはなく、予定の追加画面のリンクから開く／プライベート版は、カレンダーの下を出さず、日報メモもない／ToDoは、業務版・プライベート版で分かれる
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const openSeries = require('../lib/series');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e))); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  ok('右上に「繰り返し」のボタンはない', (await p.locator('.toolbar button:has-text("繰り返し")').count()) === 0);
  await p.keyboard.press('n'); await p.waitForSelector('.modal input[name=title]');
  ok('予定の追加画面（業務）に、繰り返しのリンクが2つある（登録する／登録済みを見る・変える）', (await p.locator('.modal a:has-text("繰り返し業務」として登録")').count()) === 1 && (await p.locator('.modal a:has-text("登録済みの繰り返しを見る・変える")').count()) === 1);
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await openSeries(p);
  ok('リンクから、繰り返し業務の画面が開く', (await p.locator('.modal').innerText()).includes('繰り返し'));
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));

  // ToDoは分かれる
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr');
  const add = async (t) => { await p.click('#todo-mgr .todo-add-btn').catch(() => {}); await p.fill('#todo-mgr .todo-add input[type=text]', t); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('#todo-mgr .kb-card:has-text("' + t + '")'); };
  await add('業務で追加');
  await p.click('.tab[data-view=me]'); await p.waitForSelector('#todo-mgr'); await p.waitForTimeout(500);
  ok('プライベート版のToDoには、業務のToDoは出ない', (await p.locator('#todo-mgr .kb-card:has-text("業務で追加")').count()) === 0);
  ok('プライベート版には、日報メモは出ない（日報は業務）', (await p.locator('#memo').isVisible()) === false && (await p.locator('.pane-seg').count()) === 0);
  await add('私用で追加');
  ok('プライベート版で追加したToDoは、プライベートの色（種類）', (await p.locator('#todo-mgr .kb-card.private:has-text("私用で追加")').count()) === 1);
  await p.click('.tab[data-view=team]'); await p.waitForSelector('#todo-mgr .kb-card:has-text("業務で追加")'); await p.waitForTimeout(300);
  ok('業務版のToDoには、プライベートのToDoは出ない。業務のToDoは出る', (await p.locator('#todo-mgr .kb-card:has-text("私用で追加")').count()) === 0 && (await p.locator('#todo-mgr .kb-card:has-text("業務で追加")').count()) === 1);
  ok('業務版には、日報メモがある', (await p.locator('#memo').isVisible()) === true);
  // プライベート版のカレンダーの下
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.cal'); await p.click('.tab[data-view=me]'); await p.waitForSelector('.view-banner.me'); await p.waitForTimeout(300);
  ok('プライベート版は、カレンダーの下（凡例・「○月のまとめ」）を出さない', (await p.locator('.legend').count()) === 0 && (await p.locator('.month-sum').count()) === 0);
  await p.click('.tab[data-view=team]'); await p.waitForSelector('.view-banner.team'); await p.waitForTimeout(300);
  ok('業務版は、これまでどおり、凡例と「○月のまとめ」が出る', (await p.locator('.legend').count()) === 1 && (await p.locator('.month-sum').count()) === 1);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
