// 削除の「元に戻す」: 予定・ToDo を消した直後に戻せる。確認ダイアログは出ない（コメントのあるToDoだけ確認する）
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  let dialogs = 0; p.on('dialog', d => { dialogs++; d.accept(); });
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const ym = new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1);
  // 予定
  await p.click(`.cell[data-date="${ym}-12"]`); await p.waitForSelector('.modal input[name=title]');
  await p.fill('.modal input[name=title]', '消して戻す予定'); await p.fill('.modal textarea[name=note]', '戻るメモ'); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.bar:has-text("消して戻す予定")');
  await p.click('.bar:has-text("消して戻す予定")'); await p.waitForSelector('.modal input[name=title]'); await p.click('.modal button:has-text("削除")');
  await p.waitForSelector('.toast .toast-act');
  ok('予定を消しても、確認ダイアログは出ない', dialogs === 0, dialogs);
  ok('消した直後に「元に戻す」が出る', (await p.locator('.toast.with-action').innerText()).includes('予定を削除しました'));
  await p.waitForFunction(() => !Array.from(document.querySelectorAll('.bar')).some(b => b.textContent.includes('消して戻す予定')));
  ok('消した予定は、カレンダーから消える', await p.locator('.bar:has-text("消して戻す予定")').count() === 0);
  await p.click('.toast .toast-act'); await p.waitForSelector('.bar:has-text("消して戻す予定")');
  ok('「元に戻す」で、予定が戻る', true);
  await p.click('.bar:has-text("消して戻す予定")'); await p.waitForSelector('.modal input[name=title]');
  ok('メモも、元のまま', (await p.inputValue('.modal textarea[name=note]')) === '戻るメモ');
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  // ToDo
  const t = await api('todo_save', { title: '消して戻すToDo', kind: 'work', tag: '個人作業', due: ym + '-28' }); const tid = (t.todo || t).id;
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban'); await p.waitForSelector('#todo-mgr .kb-card:has-text("消して戻すToDo")');
  await p.click('#todo-mgr .kb-card:has-text("消して戻すToDo") button:has-text("削除")'); await p.waitForSelector('.toast .toast-act');
  ok('ToDoを消しても、確認ダイアログは出ない', dialogs === 0, dialogs);
  await p.waitForFunction(() => !document.querySelector('#todo-mgr .kb-card') || !Array.from(document.querySelectorAll('#todo-mgr .kb-card')).some(c => c.textContent.includes('消して戻すToDo')));
  await p.click('.toast .toast-act'); await p.waitForSelector('#todo-mgr .kb-card:has-text("消して戻すToDo")');
  ok('「元に戻す」で、ToDoが戻る（期限日も元のまま）', await p.locator('#todo-mgr .kb-card:has-text("消して戻すToDo") .pill.due').count() === 1);
  // 期限切れの控えは使えない・同じ控えは2度使えない
  const del = await api('todo_delete', { id: tid }); ok('消すと、戻すための合言葉が返る', typeof del.undo === 'string' && del.undo.length >= 20, del);
  const r1 = await api('todo_restore', { undo: del.undo }); const r2 = await api('todo_restore', { undo: del.undo });
  ok('同じ合言葉で、2度は戻せない', !r1.error && !!r2.error, [r1.error, r2.error]);
  // コメントつきのToDoは、確認する・戻せない
  const t2 = await api('todo_save', { title: 'コメントつきToDo', kind: 'work', tag: '個人作業' }); const tid2 = (t2.todo || t2).id;
  await api('todo_comment_add', { id: tid2, body: 'コメントです' });
  const before = dialogs; await p.reload(); await p.waitForSelector('#todo-mgr .kb-card:has-text("コメントつきToDo")');
  await p.click('#todo-mgr .kb-card:has-text("コメントつきToDo") button:has-text("削除")'); await p.waitForTimeout(800);
  ok('コメントのあるToDoは、消す前に確認が出る', dialogs === before + 1, dialogs - before);
  ok('コメントのあるToDoは、「元に戻す」は出ない（コメントも消えるため）', await p.locator('.toast .toast-act').count() === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
