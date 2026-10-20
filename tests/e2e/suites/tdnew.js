// カレンダーで新規追加するときにも、「ToDoリストにも入れる（進捗）」を選べる。入れると、ToDoと予定が結びつき、状態をどちらからでも変えられる
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const now = new Date(); const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const todos = () => p.evaluate(async () => { const j = await (await fetch('api.php?action=todo_list&view=team')).json(); const f = (a, s) => a.map(t => [t.title, s]); return [].concat(f(j.todos.filter(t => t.status === 'todo'), 'todo'), f(j.todos.filter(t => t.status === 'doing'), 'doing'), f(j.done, 'done')); });
  const openAdd = async (d) => { await p.click(`.cell[data-date="${ym}-${d}"]`); await p.waitForSelector('.modal input[name=title]'); };
  // 1) 新規追加 → 進行中で、ToDoリストにも入れる
  await openAdd('16');
  ok('追加ダイアログに「ToDoリストにも入れる（進捗）」がある（既定は「入れない」）', (await p.locator('.modal select[name=todo_status]').inputValue()) === '' && await p.locator('.modal .todo-opt').isVisible());
  ok('選べる進捗は、入れない・未着手・進行中・保留・完了', (await p.locator('.modal select[name=todo_status] option').allInnerTexts()).join('|') === '入れない|未着手|進行中|保留|完了');
  await p.fill('.modal input[name=title]', 'カレンダーから作る業務A'); await p.selectOption('.modal select[name=todo_status]', 'doing'); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.bar:has-text("カレンダーから作る業務A")');
  ok('保存すると、ToDoリストにも「進行中」で入る', (await todos()).some(t => t[0] === 'カレンダーから作る業務A' && t[1] === 'doing'), await todos());
  // 2) その予定を開くと、ToDoの状態を変えられる
  await p.click('.bar:has-text("カレンダーから作る業務A")');
  await p.waitForSelector('.modal .td-state');
  ok('その予定の詳細に、ToDoの状態（進行中）が出る', (await p.locator('.modal .td-state .btn.on').innerText()) === '進行中');
  ok('追加欄（ToDoリストにも入れる）は、結びついた予定には出ない', !(await p.locator('.modal .todo-opt').isVisible()));
  await p.click('.modal .td-state .btn:has-text("完了")'); await p.waitForSelector('.bar.done:has-text("カレンダーから作る業務A")');
  ok('完了にすると、カレンダーで取り消し線', true);
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  // 3) 完了で入れる
  await openAdd('17'); await p.fill('.modal input[name=title]', 'カレンダーから作る業務B'); await p.selectOption('.modal select[name=todo_status]', 'done'); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.bar.done:has-text("カレンダーから作る業務B")');
  ok('「完了」で入れると、予定は最初から取り消し線で、ToDoは完了', (await todos()).some(t => t[0] === 'カレンダーから作る業務B' && t[1] === 'done'));
  // 4) 「入れない」なら、ToDoは増えない
  await openAdd('18'); await p.fill('.modal input[name=title]', 'ToDoにしない予定'); await p.click('.modal button[type=submit]'); await p.waitForSelector('.bar:has-text("ToDoにしない予定")');
  ok('「入れない」のままなら、ToDoリストには入らない', !(await todos()).some(t => t[0] === 'ToDoにしない予定'));
  // 5) あとから、ふつうの予定を ToDo リストに入れられる
  await p.click('.bar:has-text("ToDoにしない予定")'); await p.waitForSelector('.modal input[name=title]');
  ok('ふつうの予定の編集にも、進捗の選択がある', await p.locator('.modal .todo-opt').isVisible());
  await p.selectOption('.modal select[name=todo_status]', 'todo'); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.waitForTimeout(500);
  ok('あとからでも、「未着手」でToDoリストに入れられる', (await todos()).some(t => t[0] === 'ToDoにしない予定' && t[1] === 'todo'), await todos());
  // 6) 休みには出ない・プライベートには出る
  await openAdd('19'); await p.check('.modal input[name=kind][value=off]');
  ok('「休み」を選ぶと、ToDoの欄は出ない', !(await p.locator('.modal .todo-opt').isVisible()));
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.click('.tab[data-view=me]'); await p.waitForTimeout(500); await openAdd('19');
  ok('「プライベート」では、ToDoの欄が出る', await p.locator('.modal .todo-opt').isVisible());
  await p.fill('.modal input[name=title]', 'ひみつの私用'); await p.selectOption('.modal select[name=todo_status]', 'doing'); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal'));
  const priv = await p.evaluate(async () => { const j = await (await fetch('api.php?action=todo_list&view=me')).json(); const t = j.todos.find(t => t.title === 'ひみつの私用'); return t && [t.kind, t.status]; });
  ok('プライベートの予定は、プライベートのToDoになる（業務版のリストには出ない）', JSON.stringify(priv) === JSON.stringify(['private', 'doing']) && !(await todos()).some(t => t[0] === 'ひみつの私用'), priv);
  // 7) 毎月の繰り返しから作られた予定も、その回だけ ToDo にできる
  const sv = await p.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=series_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ title: '毎月の定例チェック', tag: '定例業務', rule_type: 'day', p_day: 21, shift: 'prev', bizonly: 0 }) }); return r.status; });
  ok('繰り返し業務を登録できた', sv === 200, sv);
  await p.click('.tab[data-view=team]'); await p.reload(); await p.waitForSelector('.bar:has-text("毎月の定例チェック")');
  await p.click('.bar:has-text("毎月の定例チェック")'); await p.waitForSelector('.modal input[name=title]');
  ok('繰り返しの回にも、「ToDoリストにも入れる」がある（この回だけ、と説明が出る）', await p.locator('.modal .todo-opt').isVisible() && (await p.locator('.modal .todo-opt').innerText()).includes('この回だけ'));
  await p.selectOption('.modal select[name=todo_status]', 'doing'); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal')); await p.waitForTimeout(500);
  ok('その回が、ToDoリストに「進行中」で入る', (await todos()).some(t => t[0] === '毎月の定例チェック' && t[1] === 'doing'), await todos());
  await p.click('.bar:has-text("毎月の定例チェック")'); await p.waitForSelector('.modal .td-state'); await p.click('.modal .td-state .btn:has-text("完了")');
  await p.waitForSelector('.bar.done:has-text("毎月の定例チェック")');
  ok('ToDoで完了にすると、その回に取り消し線が付く（繰り返しの予定でも）', true);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
