// 日報の ToDo の行と、ToDo の完了（v1.98.0〜: 日報はカレンダーが基準）
//   今日のカレンダーに置いた ToDo は、日報の当日の項目に入り、完了にすると取り消し線（未完了に戻すと消える）。
//   「日報へ」で入れた ToDo の行も、完了にすると取り消し線。日付のない ToDo は、完了にしても自動では入らない。プライベートの ToDo は入らない
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e))); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.evaluate(() => localStorage.setItem('sched.doneOpen', 'true')); await p.reload(); await p.waitForSelector('.cal'); // 完了は、ふだんは畳んである。このテストは、開いた状態で確かめる
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const { cur } = await p.evaluate(async () => (await fetch('api.php?action=memo_get')).json());
  const placed = (await api('todo_save', { title: '今日に置いたToDo', kind: 'work', tag: '個人作業' })).todo; await api('todo_schedule', { id: placed.id, date: cur });
  const plain = (await api('todo_save', { title: '日付のないToDo', kind: 'work', tag: '個人作業' })).todo;
  const byBtn = (await api('todo_save', { title: '日報へで入れるToDo', kind: 'work', tag: '個人作業' })).todo;
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single'); await p.waitForSelector('#todo-mgr');
  const memoItems = () => p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=cur]'); const out = []; let d = h.nextElementSibling; while (d && !d.textContent.trim()) d = d.nextElementSibling; while (d && d.textContent.trim() && !d.hasAttribute('data-md')) { out.push(d.textContent + (d.querySelector('s') ? '[s]' : '') + (d.hasAttribute('data-todo') ? '[t]' : '')); d = d.nextElementSibling; } return out; });
  const lineIs = (t, struck) => p.waitForFunction(([t, struck]) => Array.from(document.querySelectorAll('.memo-single div[data-todo]')).some(d => d.textContent === t && !!d.querySelector('s') === struck), [t, struck], { timeout: 15000 });
  await lineIs('今日に置いたToDo', false);
  ok('今日のカレンダーに置いた ToDo は、日報の当日の項目に入る（取り消し線なし）', (await memoItems()).includes('今日に置いたToDo[t]'), await memoItems());
  // 「完了 ✓」にする（カンバン）
  const done = async (t) => { await p.click('#todo-mgr .kb-card:has-text("' + t + '") button:has-text("完了 ✓")'); await p.waitForSelector('#todo-mgr .kb-col.done .kb-card:has-text("' + t + '"), #todo-mgr .kb-card.done:has-text("' + t + '")'); };
  await done('今日に置いたToDo'); await lineIs('今日に置いたToDo', true);
  ok('完了にすると、日報の行に取り消し線が付く', (await memoItems()).includes('今日に置いたToDo[s][t]'), await memoItems());
  await p.waitForTimeout(1500); await p.reload(); await p.waitForSelector('.memo-single'); await lineIs('今日に置いたToDo', true);
  ok('開き直しても、取り消し線のまま残る', (await memoItems()).includes('今日に置いたToDo[s][t]'), await memoItems());
  const nextTxt = await p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=next]'); const out = []; let d = h.nextElementSibling; while (d && !d.hasAttribute('data-md')) { out.push(d.textContent); d = d.nextElementSibling; } return out.join('|'); });
  ok('取り消し線の項目は、次回出勤日には転記されない', !nextTxt.includes('今日に置いたToDo'), nextTxt);
  await p.waitForSelector('#todo-mgr .kb-card:has-text("今日に置いたToDo")');
  await p.click('#todo-mgr .kb-card:has-text("今日に置いたToDo") button:has-text("戻す")'); await lineIs('今日に置いたToDo', false);
  const back = await memoItems();
  ok('未完了に戻すと、日報の取り消し線は消える。行は、1つだけ', back.filter(x => x.includes('今日に置いたToDo')).length === 1 && back.includes('今日に置いたToDo[t]'), back);
  // 日付のない ToDo は、完了にしても、自動では入らない
  await p.click('#todo-mgr .kb-card:has-text("日付のないToDo") button:has-text("進行中へ")'); await p.waitForSelector('#todo-mgr .kb-card:has-text("日付のないToDo") button:has-text("完了 ✓")');
  await done('日付のないToDo'); await p.waitForTimeout(1500);
  ok('日付のない ToDo は、進行中にしても完了にしても、日報には自動で入らない（カレンダーが基準）', !(await memoItems()).some(x => x.includes('日付のないToDo')), await memoItems());
  // 「日報へ」で入れた行は、完了にすると取り消し線
  await p.click('#todo-mgr .kb-card:has-text("日報へで入れるToDo") button:has-text("日報へ")'); await lineIs('日報へで入れるToDo', false);
  await p.click('#todo-mgr .kb-card:has-text("日報へで入れるToDo") button:has-text("進行中へ")'); await p.waitForSelector('#todo-mgr .kb-card:has-text("日報へで入れるToDo") button:has-text("完了 ✓")');
  await done('日報へで入れるToDo'); await lineIs('日報へで入れるToDo', true);
  ok('「日報へ」で入れた ToDo の行も、完了にすると取り消し線（カレンダーに無くても消えない）', (await memoItems()).includes('日報へで入れるToDo[s][t]'), await memoItems());
  // プライベートの ToDo は、日報に入れない
  const priv = (await api('todo_save', { title: '私用のToDo', kind: 'private' })).todo; await api('todo_schedule', { id: priv.id, date: cur }); await api('todo_status', { id: priv.id, status: 'done' });
  await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(1500);
  ok('プライベートの ToDo は、今日に置いて完了にしても、日報には入らない（日報は業務）', !(await memoItems()).some(x => x.includes('私用のToDo')), await memoItems());
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
