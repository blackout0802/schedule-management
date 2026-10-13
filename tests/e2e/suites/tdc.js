const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const { sql } = require('../lib/env');
const login = async (b, email, pw) => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('ERR', String(e))); await p.addInitScript(() => { window.SCHEDULE_POLL_TEST_MS = 1000; }); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
const openList = async p => { await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr'); await p.waitForTimeout(500); };
(async () => {
  // 古い版（コメントの表が無い・スキーマ15）からの更新
  sql("DROP TABLE IF EXISTS todo_comments; UPDATE app_meta SET meta_value='15' WHERE meta_key='schema_version'");
  const b = await chromium.launch();
  const y = await login(b, 'yamada@example.com', 'yamadapass1');
  ok('更新後の初回表示で、コメントの表が自動で作られる', require('../lib/env').tableExists('todo_comments'));
  await openList(y);
  await y.click('#todo-mgr .todo-add-btn'); await y.fill('#todo-mgr .todo-add input[type=text]', 'コメントを付けるToDo'); await y.click('#todo-mgr .todo-add button[type=submit]'); await y.waitForSelector('#todo-mgr .kb-card:has-text("コメントを付けるToDo")');
  ok('自分のカードに「コメント」ボタンがある（業務）', await y.locator('#todo-mgr .kb-card:has-text("コメントを付けるToDo") button:has-text("コメント")').count() === 1);
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await openList(s);
  await s.selectOption('#todo-mgr .todo-who select', 'all'); await s.click('#todo-mgr .kb-card.other:has-text("コメントを付けるToDo")'); await s.waitForSelector('.modal .tc-dialog');
  ok('他の社員が開くと、内容・コメント欄が出る（まだコメントなし）', (await s.locator('.modal').innerText()).includes('まだコメントはありません') && await s.locator('.modal textarea').count() === 1);
  ok('編集・完了・削除のボタンは出ない', await s.locator('.modal button:has-text("編集"), .modal button:has-text("完了"), .modal button:has-text("ToDoを削除")').count() === 0);
  await s.screenshot({ path: 'tdc-dialog-empty.png' });
  await s.fill('.modal textarea', '進み具合はどうですか？\n手伝えます'); await s.click('.modal button:has-text("コメントを送る")'); await s.waitForSelector('.modal .tc-item');
  const ct = await s.locator('.modal .tc-list').innerText(); ok('コメントが付く（名前・内容・改行）', ct.includes('鈴木 一郎') && ct.includes('進み具合はどうですか？') && ct.includes('手伝えます'), ct);
  ok('自分のコメントには「削除」がある', await s.locator('.modal .tc-item button:has-text("削除")').count() === 1);
  await s.keyboard.press('Escape'); await s.waitForFunction(() => !document.querySelector('.modal'));
  ok('カードに、コメントの数（💬 1）が出る（自分で読んだので、新着の目印は出ない）', (await s.locator('#todo-mgr .kb-card.other .pill.tc').innerText()).includes('1') && await s.locator('#todo-mgr .kb-card.other .pill.tc.new').count() === 0);
  // 持ち主（山田）の画面: 自動で反映され、新着の目印が出る
  await y.waitForFunction(() => document.querySelector('#todo-mgr .pill.tc.new'), null, { timeout: 15000 }); ok('持ち主の画面に、コメントの数と「新着」の目印が自動で出る', (await y.locator('#todo-mgr .kb-card:has-text("コメントを付けるToDo") .pill.tc.new').innerText()).includes('1'));
  await y.screenshot({ path: 'tdc-owner-badge.png' });
  await y.click('#todo-mgr .kb-card:has-text("コメントを付けるToDo") button:has-text("コメント")'); await y.waitForSelector('.modal .tc-item');
  ok('持ち主が開くと、コメントが読める。他の人のコメントも削除できる', (await y.locator('.modal .tc-list').innerText()).includes('手伝えます') && await y.locator('.modal .tc-item button:has-text("削除")').count() === 1);
  await y.fill('.modal textarea', 'ありがとうございます'); await y.press('.modal textarea', 'Control+Enter'); await y.waitForFunction(() => document.querySelectorAll('.modal .tc-item').length === 2);
  ok('持ち主も、Ctrl+Enterで返事を送れる', true);
  await y.screenshot({ path: 'tdc-dialog.png' });
  await y.keyboard.press('Escape'); await y.waitForFunction(() => !document.querySelector('.modal'));
  ok('読んだあとは、新着の目印が消える', await y.locator('#todo-mgr .pill.tc.new').count() === 0);
  // 鈴木の画面に、山田の返事が出て、新着になる
  await s.waitForFunction(() => document.querySelector('#todo-mgr .kb-card.other .pill.tc.new'), null, { timeout: 15000 }); ok('鈴木の画面にも、返事（新着）が自動で出る', true);
  // サーバー側: プライベートのToDo／他人のプライベートには付けられない
  const r = await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const L = await (await fetch('api.php?action=todo_list&view=team')).json(); const id = L.others.todos[0].id; const post = async (a, body) => (await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) })).status; return { empty: await post('todo_comment_add', { id, body: ' ' }), long: await post('todo_comment_add', { id, body: 'あ'.repeat(501) }), nothere: await post('todo_comment_add', { id: 999999, body: 'x' }), delOthers: await post('todo_comment_delete', { id: (await (await fetch('api.php?action=todo_comments&id=' + id)).json()).comments.find(c => c.author_name.startsWith('山田')).id }) }; });
  ok('空・長すぎ・存在しないToDo・他人のコメントの削除は、すべて断られる', r.empty === 400 && r.long === 400 && r.nothere === 404 && r.delOthers === 403, r);
  await y.click('.tab[data-view=me]'); await y.waitForTimeout(500); await y.waitForSelector('.cal, #todo-mgr');
  await y.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; await fetch('api.php?action=todo_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ title: '山田の私用', kind: 'private' }) }); });
  const pr = await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const out = []; for (let id = 1; id < 40; id++) { const res = await fetch('api.php?action=todo_comment_add', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ id, body: 'のぞき見' }) }); out.push(res.status); } return out; });
  const privId = Number(sql("SELECT id FROM todos WHERE title='山田の私用'")); ok('他人のプライベートのToDoには、コメントできない（404）', pr[privId - 1] === 404, pr);
  // ToDoを削除すると、コメントも消える
  await y.goto(BASE + 'index.php?view=team'); await y.waitForSelector('#todo-mgr'); await y.click('.tab[data-view=team]'); await y.waitForTimeout(600);
  const todoId = Number(sql("SELECT id FROM todos WHERE title='コメントを付けるToDo'")); ok('コメントが保存されている', Number(sql(`SELECT COUNT(*) FROM todo_comments WHERE todo_id=${todoId}`)) >= 2);
  y.once('dialog', d => d.accept()); await y.click('#todo-mgr .kb-card:has-text("コメントを付けるToDo") button:has-text("削除")'); await y.waitForFunction(() => !document.querySelector('#todo-mgr').innerText.includes('コメントを付けるToDo'));
  await y.waitForTimeout(500); ok('ToDoを削除すると、コメントも消える', Number(sql(`SELECT COUNT(*) FROM todo_comments WHERE todo_id=${todoId}`)) === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
