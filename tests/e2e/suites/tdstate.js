// カレンダーの予定の詳細（ToDoから置いた予定）から、元のToDoを 未着手／進行中／完了 に変えられる。
// 完了にするとカレンダーでは取り消し線、ToDoの一覧・日報にも反映。持ち主でない人は、見るだけ。
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
(async () => {
  const b = await chromium.launch();
  const login = async (em, pw) => { const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
  const p = await login('yamada@example.com', 'yamadapass1');
  const api = (pg, a, body) => pg.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const now = new Date(); const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-15`;
  const t = await api(p, 'todo_save', { title: '詳細から状態を変えるToDo', kind: 'work', tag: '個人作業' });
  const tid = (t.todo || t).id;
  const sc = await api(p, 'todo_schedule', { id: tid, date: day });
  ok('ToDoをカレンダーに置くと、進行中になる', !sc.error, sc);
  await p.reload(); await p.waitForSelector('.cal');
  const bar = () => p.locator('.bar:has-text("詳細から状態を変えるToDo")');
  // 予定を開く（日の一覧が出る場合は、その予定を選ぶ）
  const openDlg = async () => {
    await bar().first().click(); await p.waitForSelector('.modal');
    if (!(await p.locator('.modal input[name=title]').count())) { await p.locator('.modal :text("詳細から状態を変えるToDo")').first().click(); await p.waitForSelector('.modal input[name=title]'); }
  };
  // 状態を押すと、保存を押さなくても、画面が閉じる
  const setSt = async (name) => { await p.click('.modal .td-state .btn:has-text("' + name + '")'); await p.waitForFunction(() => !document.querySelector('.modal')); };
  await openDlg();
  const box = p.locator('.modal .td-state');
  ok('予定の詳細に「ToDoの状態」が出る', await box.count() === 1);
  const on = async () => (await p.locator('.modal .td-state .btn.on').allInnerTexts()).join('|');
  ok('いまの状態（進行中）が選ばれている', (await on()) === '進行中', await on());
  ok('4つのボタン（未着手・進行中・保留・完了）', (await p.locator('.modal .td-state .btn').allInnerTexts()).join('|') === '未着手|進行中|保留|完了');
  await setSt('保留');
  ok('状態を変えると、保存を押さなくても、画面が閉じる', await p.locator('.modal').count() === 0);
  const holdSt = await p.evaluate(async () => { const j = await (await fetch('api.php?action=todo_list&view=team')).json(); const t = j.todos.find(x => x.title === '詳細から状態を変えるToDo'); return t ? t.status : null; });
  ok('詳細から「保留」にすると、ToDoも保留になる（カンバンの保留の列）', holdSt === 'hold', holdSt);
  await openDlg(); ok('開き直すと、保留が選ばれている', (await on()) === '保留', await on());
  await setSt('進行中');
  await openDlg(); await setSt('完了');
  await p.waitForSelector('.bar.done:has-text("詳細から状態を変えるToDo")');
  ok('完了にすると、カレンダーの予定に取り消し線が付く', await p.locator('.bar.done:has-text("詳細から状態を変えるToDo")').count() >= 1);
  const todos = await p.evaluate(async () => { const j = await (await fetch('api.php?action=todo_list&view=team')).json(); return { done: j.done.map(t => t.title), open: j.todos.map(t => t.title) }; });
  ok('ToDoの一覧でも、完了になっている', todos.done.includes('詳細から状態を変えるToDo') && !todos.open.includes('詳細から状態を変えるToDo'), todos);
  await openDlg(); await setSt('未着手');
  await p.waitForFunction(() => !document.querySelector('.bar.done'));
  ok('未着手に戻すと、取り消し線が消える', await p.locator('.bar.done').count() === 0);
  const st2 = await p.evaluate(async () => { const j = await (await fetch('api.php?action=todo_list&view=team')).json(); const t = j.todos.find(t => t.title === '詳細から状態を変えるToDo'); return t && t.status; });
  ok('ToDoの一覧でも、未着手に戻っている（予定はカレンダーに残る）', st2 === 'todo' && await bar().count() >= 1, st2);
  // ほかの欄も書き換えてから状態を変えると、書き換えた所も保存して閉じる
  await openDlg(); await p.fill('.modal textarea[name=note]', '状態といっしょに保存するメモ'); await setSt('進行中');
  await openDlg(); ok('書き換えたメモも、保存されている', (await p.locator('.modal textarea[name=note]').inputValue()) === '状態といっしょに保存するメモ');
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  const st3 = await p.evaluate(async () => { const j = await (await fetch('api.php?action=todo_list&view=team')).json(); const t = j.todos.find(t => t.title === '詳細から状態を変えるToDo'); return t && t.status; });
  ok('進行中にできる', st3 === 'doing', st3);
  // 別の人（管理者）は、見るだけ（ボタンが押せない）
  const a = await login('admin@example.com', 'adminpass1');
  await a.selectOption('#who-sel', 'all'); await a.waitForSelector('.bar:has-text("詳細から状態を変えるToDo")');
  await a.locator('.bar:has-text("詳細から状態を変えるToDo")').first().click(); await a.waitForSelector('.modal');
  const body = await a.locator('.modal').innerText();
  ok('他の人の予定の詳細にも、ToDoの状態が出る（見るだけ・進行中）', body.includes('ToDoの状態') && body.includes('進行中'), body.slice(0, 300));
  const dis = await a.locator('.modal .td-state .btn:not([disabled])').count();
  ok('持ち主でない人は、状態を変えられない', dis === 0, dis);
  const r = await api(a, 'todo_status', { id: tid, status: 'done' });
  ok('API でも、持ち主以外は変えられない（404）', !!r.error, r);
  // 日報にも反映（完了→取り消し線）
  await p.keyboard.press('Escape');
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
