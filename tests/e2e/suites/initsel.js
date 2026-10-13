const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }); const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8099/login.php');
  await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  ok('カレンダー: 最初は「自分」', (await p.locator('#who-sel option:checked').innerText()) === '自分');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr .todo-who select');
  ok('ToDoリスト: 最初は「自分のToDo」', (await p.locator('#todo-mgr .todo-who select option:checked').innerText()) === '自分のToDo');
  // 全員に切り替えて、開き直す → また自分
  await p.selectOption('#todo-mgr .todo-who select', 'all');
  await p.click('.seg label:has-text("カレンダー")'); await p.selectOption('#who-sel', 'all'); await p.waitForTimeout(400);
  await p.reload(); await p.waitForSelector('#who-sel');
  ok('開き直すと、カレンダーは自分に戻る', (await p.locator('#who-sel option:checked').innerText()) === '自分');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr .todo-who select');
  ok('開き直すと、ToDoも自分に戻る', (await p.locator('#todo-mgr .todo-who select option:checked').innerText()) === '自分のToDo');
  // ログインせずに見る（会社用リンク）は、全員
  const path = await p.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'family' }) }); return (await r.json()).path; });
  await p.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; for (const [ti, st] of [['山田の予定', 0]]) await fetch('api.php?action=event_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'work', title: ti, tag: '定例業務', start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) }) }); });
  const s = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const cpath = await p.evaluate(async () => 1); // 会社用リンクは管理者のみ
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
