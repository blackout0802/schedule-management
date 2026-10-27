const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const M = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
const openAdd = async (pg, sel) => { if (!(await pg.locator(sel + ' .todo-add input[type=text]').count())) await pg.click(sel + ' .todo-add-btn'); await pg.waitForSelector(sel + ' .todo-add input[type=text]'); };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  ok('カレンダー画面には、ToDoもメモも表示されない', !(await p.locator('#todo').isVisible()) && !(await p.locator('#memo').isVisible()));
  const calW = await p.locator('.cal-wrap, .cal').first().evaluate(e => e.getBoundingClientRect().width); ok('カレンダーが横いっぱいに広がる', calW > 1100, calW);
  await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  ok('リストタブには、ToDoのカンバンとメモがある', await p.locator('#todo-mgr').isVisible() && await p.locator('#memo').isVisible());
  await openAdd(p, '#todo-mgr'); await p.fill('#todo-mgr .todo-add input[type=text]', 'ドラッグで予定にするToDo'); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('.kb-card:has-text("ドラッグで予定にするToDo")');
  const card = p.locator('.kb-card:has-text("ドラッグで予定にするToDo")'); const bb = await card.boundingBox();
  await p.mouse.move(bb.x + 30, bb.y + 15); await p.mouse.down(); await p.mouse.move(bb.x + 200, bb.y + 60, { steps: 5 });
  ok('ドラッグを始めると、右端に「カレンダーへ」の目印が出る', await p.locator('#cal-edge').count() === 1);
  await p.mouse.move(1000, 300, { steps: 8 }); ok('まだ右端に行っていないので、カレンダーは開かない', await p.locator('#cal-drop').count() === 0);
  await p.mouse.move(1275, 300, { steps: 10 }); await p.waitForSelector('#cal-drop');
  ok('画面の右端まで持っていくと、カレンダーが開く', await p.locator('#cal-drop .cd-cell').count() >= 28);
  const target = p.locator(`#cal-drop .cd-cell[data-date="${M}-15"]`); const tb = await target.boundingBox();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 }); await p.screenshot({ path: 'dnd-panel.png' });
  ok('日付の上では、その日が強調される', await target.evaluate(e => e.classList.contains('drop')));
  await p.mouse.up();
  await p.waitForSelector('.toast:has-text("予定に追加しました")'); await p.waitForSelector('.kb-col.doing .kb-card:has-text("ドラッグで予定にするToDo")');
  ok('ドロップすると、ToDoは予定になり、リストでは自動で「進行中」になる（消えない）', true);
  ok('ドロップしたあと、目印とカレンダーは閉じる', await p.locator('#cal-edge').count() === 0 && await p.locator('#cal-drop').count() === 0);
  await p.click('.toolbar .seg label:has-text("カレンダー")'); await p.waitForSelector('.cal');
  ok('カレンダーの15日に、予定として入っている', await p.locator('.bar:has-text("ドラッグで予定にするToDo")').count() === 1);
  // 右端に行かずに離す → 何も起きない・目印が消える
  await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  await openAdd(p, '#todo-mgr'); await p.fill('#todo-mgr .todo-add input[type=text]', '動かさないToDo'); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('.kb-card:has-text("動かさないToDo")');
  const c2 = await p.locator('.kb-card:has-text("動かさないToDo")').boundingBox(); await p.mouse.move(c2.x + 30, c2.y + 15); await p.mouse.down(); await p.mouse.move(c2.x + 100, c2.y + 40, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(300); ok('右端へ行かずに離したら、そのまま。目印は消える', await p.locator('#cal-edge').count() === 0 && await p.locator('.kb-card:has-text("動かさないToDo")').count() === 1);
  // 「日付」ボタン（スマホ・ドラッグが難しいとき）
  await p.locator('.kb-card:has-text("動かさないToDo") button:has-text("日付")').click(); await p.waitForSelector('.modal'); await p.fill('.modal input[type=date]', `${M}-20`); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.toast:has-text("予定に追加しました")'); ok('カードの「日付」ボタンからも、予定にできる', true);
  // 月の切り替え（ドラッグ中に ‹ › に乗せる）
  await openAdd(p, '#todo-mgr'); await p.fill('#todo-mgr .todo-add input[type=text]', '来月へ'); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('.kb-card:has-text("来月へ")');
  const c3 = await p.locator('.kb-card:has-text("来月へ")').boundingBox(); await p.mouse.move(c3.x + 30, c3.y + 15); await p.mouse.down(); await p.mouse.move(c3.x + 200, c3.y + 60, { steps: 5 }); await p.waitForTimeout(300); await p.mouse.move(1000, 300, { steps: 6 }); await p.waitForTimeout(300); await p.mouse.move(1275, 300, { steps: 10 }); await p.waitForTimeout(300);
  for (let i = 0; i < 10 && !(await p.locator('#cal-drop').count()); i++) { await p.mouse.move(1270 + (i % 2) * 6, 300 + i, { steps: 3 }); await p.waitForTimeout(200); } // 右端で dragover が届かないことがあるので、少し動かして待つ
  await p.waitForSelector('#cal-drop');
  const nb = await p.locator('#cal-drop button[aria-label="次の月"]').boundingBox(); await p.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2, { steps: 10 }); await p.waitForTimeout(1000);
  const head = await p.locator('#cal-drop .cd-head b').innerText(); ok('ドラッグしたまま「›」に乗せると、来月に切り替わる', head !== `${t.getFullYear()}年${t.getMonth() + 1}月`, head);
  await p.keyboard.press('Escape'); await p.mouse.up(); await p.waitForTimeout(300);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
