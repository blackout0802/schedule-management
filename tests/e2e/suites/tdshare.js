const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const login = async (b, email, pw) => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('ERR', String(e))); await p.addInitScript(() => { window.SCHEDULE_POLL_TEST_MS = 1000; }); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
const openList = async p => { await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr'); await p.waitForTimeout(500); };
const addTodo = async (p, text) => { if (!(await p.locator('#todo-mgr .todo-add input[type=text]').count())) await p.click('#todo-mgr .todo-add-btn'); await p.fill('#todo-mgr .todo-add input[type=text]', text); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('#todo-mgr .kb-card:has-text("' + text + '")'); };
(async () => {
  const b = await chromium.launch();
  const y = await login(b, 'yamada@example.com', 'yamadapass1'); await openList(y);
  await addTodo(y, '山田の共有ToDo');
  await y.click('.tab[data-view=me]'); await y.waitForTimeout(500);
  await y.click('.toolbar .seg label:has-text("リスト")').catch(() => {}); await y.waitForSelector('#todo-mgr');
  await y.click('#todo-mgr .todo-add-btn').catch(() => {}); ok('プライベート版の追加欄に、種類の説明（自分だけ／全員に見える）が出る', (await y.locator('#todo-mgr .todo-add select').innerText()).includes('全員に見える'));
  await y.selectOption('#todo-mgr .todo-add select', 'private'); await y.fill('#todo-mgr .todo-add input[type=text]', '山田のひみつToDo'); await y.click('#todo-mgr .todo-add button[type=submit]'); await y.waitForSelector('#todo-mgr .kb-card:has-text("山田のひみつToDo")');
  // 鈴木（別の社員）
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await openList(s);
  const txt = () => s.locator('#todo-mgr').innerText();
  ok('ログインして開くと、まず自分のToDo（他の人のToDoは出ない）', !(await txt()).includes('山田の共有ToDo') && (await s.inputValue('#todo-mgr .todo-who select')) === 'me');
  await s.selectOption('#todo-mgr .todo-who select', 'all'); await s.waitForTimeout(300);
  let t = await txt(); ok('他の社員（鈴木）の業務版リストに、山田の業務のToDoが見える', t.includes('山田の共有ToDo'), t);
  ok('持ち主の名前（山田 花子）が付く', await s.locator('#todo-mgr .kb-card.other:has-text("山田 花子")').count() === 1);
  ok('山田のプライベートのToDoは、見えない', !t.includes('山田のひみつToDo'));
  ok('他の人のToDoは、ドラッグできない・操作ボタンが無い', await s.locator('#todo-mgr .kb-card.other[draggable=true]').count() === 0 && await s.locator('#todo-mgr .kb-card.other .t-actions').count() === 0);
  await s.screenshot({ path: 'tdshare-list.png' });
  for (let i = 0; i < 3 && !(await s.locator('.modal').count()); i++) { await s.click('#todo-mgr .kb-card.other:has-text("山田の共有ToDo")'); await s.waitForSelector('.modal', { timeout: 3000 }).catch(() => {}); } /* 一覧の自動更新と重なったときは、押し直す */
  await s.waitForSelector('.modal'); await s.waitForFunction(() => (document.querySelector('.modal') || {}).innerText && document.querySelector('.modal').innerText.includes('山田の共有ToDo'), null, { timeout: 8000 }).catch(() => {}); await s.waitForTimeout(400); ok('押すと、内容が見られる（見るだけ）', (await s.locator('.modal').innerText()).includes('山田の共有ToDo') && !(await s.locator('.modal button:has-text("削除")').count()), (await s.locator('.modal').innerText()).slice(0, 200));
  await s.keyboard.press('Escape'); await s.waitForFunction(() => !document.querySelector('.modal'));
  // 絞り込み
  await s.selectOption('#todo-mgr .todo-who select', 'me'); await s.waitForTimeout(300); ok('「自分のToDo」にすると、他の人のToDoは出ない', !(await txt()).includes('山田の共有ToDo'));
  await s.reload(); await s.waitForSelector('#todo-mgr'); await s.waitForTimeout(500); ok('開き直すと、また自分のToDoに戻る（選んだ表示は覚えない）', !(await txt()).includes('山田の共有ToDo') && await s.inputValue('#todo-mgr .todo-who select') === 'me');
  await s.selectOption('#todo-mgr .todo-who select', 'all'); await s.waitForTimeout(300); ok('「全員のToDo」に戻せる', (await txt()).includes('山田の共有ToDo'));
  // 自分のToDoと混ざらない（自分のものは操作できる）
  await addTodo(s, '鈴木のToDo'); ok('自分のToDoは、これまで通り操作できる（ドラッグ可）', await s.locator('#todo-mgr .kb-card:not(.other)[draggable=true]:has-text("鈴木のToDo")').count() === 1);
  // 山田の画面にも、鈴木のToDoが（自動更新で）出る
  await y.click('.tab[data-view=team]'); await y.waitForTimeout(500); await y.click('.toolbar .seg label:has-text("リスト")').catch(() => {}); await y.waitForSelector('#todo-mgr');
  await y.selectOption('#todo-mgr .todo-who select', 'all');
  await y.waitForFunction(() => document.querySelector('#todo-mgr').innerText.includes('鈴木のToDo'), null, { timeout: 15000 }); ok('他の人が追加したToDoも、自動で反映される', true);
  // 他の人の更新が、リアルタイムに
  await addTodo(y, '山田の追加分');
  await s.waitForFunction(() => document.querySelector('#todo-mgr').innerText.includes('山田の追加分'), null, { timeout: 15000 }); ok('山田が追加すると、鈴木の画面にも自動で出る', true);
  // 他の人は、変更できない（サーバー側）
  const rj = await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const L = await (await fetch('api.php?action=todo_list&view=team')).json(); const id = L.others.todos[0].id; const out = {}; for (const [a, body] of [['todo_done', { id, done: true }], ['todo_status', { id, status: 'doing' }], ['todo_delete', { id }], ['todo_save', { id, title: '乗っ取り', kind: 'work' }]]) { const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); out[a] = r.status; } return out; });
  ok('サーバー側でも、他人のToDoは、完了・移動・削除・編集のすべてができない（404）', Object.values(rj).every(c => c === 404), rj);
  // プライベート版には、他の人のToDoは出ない
  await s.click('.tab[data-view=me]'); await s.waitForTimeout(500); await s.click('.toolbar .seg label:has-text("リスト")').catch(() => {}); await s.waitForSelector('#todo-mgr');
  ok('プライベート版のリストには、他の人のToDoは出ない', !(await txt()).includes('山田の共有ToDo') && await s.locator('#todo-mgr .todo-who').count() === 0);
  // 管理者
  const a = await login(b, 'admin@example.com', 'adminpass1'); await openList(a); await a.selectOption('#todo-mgr .todo-who select', 'all'); await a.waitForTimeout(300);
  const at = await a.locator('#todo-mgr').innerText(); ok('管理者にも、業務のToDoは見える（プライベートは見えない）', at.includes('山田の共有ToDo') && at.includes('鈴木のToDo') && !at.includes('山田のひみつToDo'), at);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
