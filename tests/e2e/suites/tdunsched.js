// ToDo の「日付」: カレンダーに置いたToDoは、今の日付が入って開き、「日付を外す」・日付を空にして決定で、カレンダーから外せる（ToDoは残る）
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const todo = title => p.evaluate(async title => { const j = await (await fetch('api.php?action=todo_list&view=team')).json(); return j.todos.find(t => t.title === title) || null; }, title);
  const now = new Date(); const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-15`;
  const mk = async title => { const t = await api('todo_save', { title, kind: 'work', tag: '個人作業' }); const id = (t.todo || t).id; await api('todo_schedule', { id, date: day }); return id; };
  await mk('日付を外すToDo'); await mk('日付を空にするToDo');
  await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  const openDate = async title => { await p.locator(`.kb-card:has-text("${title}") button:has-text("日付")`).first().click(); await p.waitForSelector('.modal input[type=date]'); };
  // 1) 「日付を外す」ボタン
  await openDate('日付を外すToDo');
  ok('置いてあるToDoは、今の日付が入って開く', (await p.locator('.modal input[type=date]').inputValue()) === day, await p.locator('.modal input[type=date]').inputValue());
  ok('見出しは「日付を変える・外す」、「日付を外す」ボタンがある', (await p.locator('.modal').innerText()).includes('日付を変える・外す') && await p.locator('.modal button:has-text("日付を外す")').count() === 1);
  await p.click('.modal button:has-text("日付を外す")'); await p.waitForSelector('.toast:has-text("日付を外しました")'); await p.waitForFunction(() => !document.querySelector('.modal'));
  const t1 = await todo('日付を外すToDo');
  ok('外すと、ToDoは残り、置いた日が無くなる（進行中のまま）', t1 && t1.sched === null && t1.status === 'doing', t1);
  // 2) 日付を空にして決定
  await openDate('日付を空にするToDo');
  await p.fill('.modal input[type=date]', ''); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.toast:has-text("日付を外しました")');
  const t2 = await todo('日付を空にするToDo');
  ok('日付を空にして決定しても、外れる（入力してくださいで止まらない）', t2 && t2.sched === null, t2);
  // 3) 置いていないToDoは、これまでどおり（日付は必須・「日付を外す」なし）
  await openDate('日付を外すToDo');
  ok('置いていないToDoには「日付を外す」は出ず、「予定にする」', await p.locator('.modal button:has-text("日付を外す")').count() === 0 && await p.locator('.modal button:has-text("予定にする")').count() === 1);
  await p.keyboard.press('Escape');
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
