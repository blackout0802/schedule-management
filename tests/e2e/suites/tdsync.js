// 予定とToDoの件名の同期（どちらを直しても揃う）と、ToDoの期限日（追加・編集・目立たせる）
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const L = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.evaluate(() => localStorage.setItem('sched.doneOpen', 'true')); await p.reload(); await p.waitForSelector('.cal'); // 完了は、ふだんは畳んである。このテストは、開いた状態で確かめる
  const now = new Date(); const ym = L(now).slice(0, 7);
  const list = () => p.evaluate(async () => { const j = await (await fetch('api.php?action=todo_list&view=team')).json(); return j.todos.concat(j.done); });
  // 1) カレンダーで予定を作り、ToDoにも入れる → 件名を直すと、ToDoの件名も変わる
  await p.click(`.cell[data-date="${ym}-16"]`); await p.waitForSelector('.modal input[name=title]');
  await p.fill('.modal input[name=title]', '同期の元の件名'); await p.selectOption('.modal select[name=todo_status]', 'doing'); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.bar:has-text("同期の元の件名")');
  await p.click('.bar:has-text("同期の元の件名")'); await p.waitForSelector('.modal input[name=title]');
  await p.fill('.modal input[name=title]', '予定側で直した件名'); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.waitForSelector('.bar:has-text("予定側で直した件名")'); await p.waitForTimeout(400);
  ok('予定の件名を直すと、ToDoの件名も同じになる（ToDoの状態は進行中のまま）', (await list()).some(t => t.title === '予定側で直した件名' && t.status === 'doing'), (await list()).map(t => t.title + ':' + t.status));
  // 2) ToDo側で件名と期限日を直す → 予定の件名も変わる
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  await p.click('.kb-card:has-text("予定側で直した件名") button:has-text("編集")'); await p.waitForSelector('.modal input[name=title]');
  const yesterday = L(new Date(now.getTime() - 3 * 864e5));
  await p.fill('.modal input[name=title]', 'ToDo側で直した件名'); await p.fill('.modal input[name=due]', yesterday); await p.click('.modal button[type=submit]');
  await p.waitForFunction(() => !document.querySelector('.modal')); await p.waitForTimeout(500);
  ok('ToDo側で期限日（3日前）を付けると、「期限切れ 3日」が出る', (await p.locator('.kb-card:has-text("ToDo側で直した件名") .pill.due.over').innerText()).includes('期限切れ 3日'));
  ok('ToDoの見出しに、期限切れの数が出る', (await p.locator('#todo-mgr h2 .pill.due.over').innerText()).includes('期限切れ 1'));
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.cal');
  await p.waitForSelector('.bar:has-text("ToDo側で直した件名")', { timeout: 8000 }).catch(() => {}); // カレンダーの描き直しを待つ
  ok('ToDo側で件名を直すと、カレンダーの予定の件名も変わる', await p.locator('.bar:has-text("ToDo側で直した件名")').count() >= 1, await p.locator('.bar').allInnerTexts());
  // 3) 期限日つきで追加（今日・明日・先）
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  const add = async (title, due) => { if (await p.locator('#todo-mgr .todo-add-btn').count()) await p.click('#todo-mgr .todo-add-btn'); await p.waitForSelector('#todo-mgr .todo-add input[type=text]'); await p.fill('#todo-mgr .todo-add input[type=text]', title); if (due) await p.fill('#todo-mgr .todo-add .todo-due-in', due); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector(`#todo-mgr .kb-card:has-text("${title}")`); };
  await add('今日が期限', L(now)); await add('明日が期限', L(new Date(now.getTime() + 864e5))); await add('来週が期限', L(new Date(now.getTime() + 7 * 864e5))); await add('期限なし');
  const pill = async (t) => (await p.locator(`#todo-mgr .kb-card:has-text("${t}") .pill.due`).allInnerTexts()).join('|');
  ok('今日が期限 → 「今日まで」（橙）', (await pill('今日が期限')) === '今日まで' && await p.locator('#todo-mgr .kb-card:has-text("今日が期限") .pill.due.soon').count() === 1, await pill('今日が期限'));
  ok('明日が期限 → 「明日まで」（橙）', (await pill('明日が期限')) === '明日まで');
  ok('来週が期限 → 「期限 m/d」（灰色）', /^期限 \d+\/\d+$/.test(await pill('来週が期限')) && await p.locator('#todo-mgr .kb-card:has-text("来週が期限") .pill.due.soon, #todo-mgr .kb-card:has-text("来週が期限") .pill.due.over').count() === 0, await pill('来週が期限'));
  ok('期限なしには、何も出ない', (await pill('期限なし')) === '');
  // 4) 完了にすると、急かさない（赤・橙にならない）
  await p.click('.kb-card:has-text("ToDo側で直した件名") button:has-text("完了")'); await p.waitForTimeout(500);
  ok('完了したToDoは、期限日だけを灰色で出す（急かさない）', await p.locator('#todo-mgr .kb-card:has-text("ToDo側で直した件名") .pill.due:not(.over):not(.soon)').count() === 1);
  // 5) 期限日を消す
  await p.click('.kb-card:has-text("今日が期限") button:has-text("編集")'); await p.waitForSelector('.modal input[name=due]');
  ok('編集の画面に、いまの期限日が入っている', (await p.inputValue('.modal input[name=due]')) === L(now));
  await p.click('.modal button:has-text("消す")'); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal')); await p.waitForTimeout(400);
  ok('「消す」で、期限日を外せる', (await pill('今日が期限')) === '');
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
