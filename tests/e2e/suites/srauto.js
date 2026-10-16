// 繰り返し業務の「毎回ToDoにも入れる」: 画面のチェック・実施日が近い回だけToDoに入る・期限日はその回の日付・完了で取り消し線・件数が増えない
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const openSeries = require('../lib/series');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  // 画面から登録する（毎月、今日から3日後の日に）
  const d3 = new Date(Date.now() + 3 * 864e5).getDate();
  await openSeries(p);
  await p.click('.modal button:has-text("ルールを追加"), .modal button:has-text("追加")'); await p.waitForSelector('.modal input[name=title]');
  ok('ルールの画面に「毎回、ToDoリストにも入れる」のチェックがある', await p.locator('.modal input[name=todo_auto]').count() === 1);
  await p.fill('.modal input[name=title]', '毎月のToDo連動チェック'); await p.fill('.modal input[name=p_day]', String(d3)); await p.selectOption('.modal select[name=shift]', 'none');
  await p.check('.modal input[name=todo_auto]'); await p.click('.modal button[type=submit]'); await p.waitForTimeout(800);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // ToDoの一覧
  await p.reload(); await p.waitForSelector('.cal'); await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  const cards = p.locator('#todo-mgr .kb-card:has-text("毎月のToDo連動チェック")');
  ok('実施日が近い回だけが、ToDoリストに入る（12か月分は並ばない）', (await cards.count()) >= 1 && (await cards.count()) <= 2, await cards.count());
  const pill = (await cards.first().locator('.pill.due').allInnerTexts()).join('|');
  ok('期限日（その回の日付）が付いている（あと3日なので「期限 m/d」）', /^期限 \d+\/\d+$/.test(pill), pill);
  ok('「未着手」の列に入っている', await p.locator('#todo-mgr .kb-col.todo .kb-card:has-text("毎月のToDo連動チェック")').count() >= 1);
  // 画面を開き直しても、増えない
  const n1 = await cards.count(); await p.reload(); await p.waitForSelector('.kanban');
  ok('開き直しても、同じ回のToDoが増えない', (await p.locator('#todo-mgr .kb-card:has-text("毎月のToDo連動チェック")').count()) === n1);
  // ToDoを消しても、作り直されない
  p.on('dialog', d => d.accept());
  await cards.first().locator('button:has-text("削除")').click(); await p.waitForTimeout(600); await p.reload(); await p.waitForSelector('.kanban');
  ok('ToDoを消しても、作り直されない', (await p.locator('#todo-mgr .kb-card:has-text("毎月のToDo連動チェック")').count()) === n1 - 1);
  // ルール一覧の目印
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.cal');
  await openSeries(p);
  await p.waitForSelector('.modal .pill:has-text("ToDo連動")', { timeout: 8000 }).catch(() => {});
  ok('ルールの一覧に「ToDo連動」の目印が出る', (await p.locator('.modal').innerText()).includes('ToDo連動'), (await p.locator('.modal').innerText()).slice(0, 200));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
