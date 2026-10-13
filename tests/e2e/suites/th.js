const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const M = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  // ---- 文字の太さ
  const w = await p.evaluate(() => { const g = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontWeight : null; }; return { body: g('body'), hint: g('.view-banner'), h2: g('.toolbar h2') }; });
  ok('ふつうの文字は、Apple風の細め（太さ400）、補足は500', w.body === '400' && w.hint === '500', w);
  ok('もともと太い見出し（700）は、そのまま', w.h2 === '700' || w.h2 === 'bold', w.h2);
  const ws = await p.evaluate(() => { const els = [...document.querySelectorAll('body *')]; return els.filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => Number(getComputedStyle(e).fontWeight)).filter(v => v < 600).length; });
  // ---- カレンダーの右端 → ToDo
  await p.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const h = { 'Content-Type': 'application/json', 'X-CSRF-Token': t };
    for (const title of ['ホバーのToDo', '進行中にするToDo']) await fetch('api.php?action=todo_save', { method: 'POST', headers: h, body: JSON.stringify({ title, kind: 'work' }) }); });
  await p.reload(); await p.waitForSelector('.cal'); await p.waitForSelector('#todo-hover');
  ok('カレンダー画面の右端に、「ToDo」の目印がある', await p.locator('#todo-hover').isVisible());
  ok('はじめは、ToDoのパネルは出ていない', await p.locator('#todo-panel').count() === 0);
  await p.mouse.move(1000, 450); await p.mouse.move(1270, 450, { steps: 8 }); await p.waitForSelector('#todo-panel.open'); await p.waitForTimeout(300);
  ok('右端にカーソルを持っていくと、ToDoのパネルが出る', (await p.locator('#todo-panel').innerText()).includes('ホバーのToDo'));
  await p.screenshot({ path: 'th-panel.png' });
  // 追加
  await p.click('#todo-panel .todo-add-btn'); await p.fill('#todo-panel .todo-add input[type=text]', '横から追加'); await p.press('#todo-panel .todo-add input[type=text]', 'Enter'); await p.waitForSelector('#todo-panel .tp-card:has-text("横から追加")'); ok('パネルからToDoを追加できる', true);
  // ドラッグしてカレンダーへ
  const card = p.locator('#todo-panel .tp-card:has-text("ホバーのToDo")'); const cb = await card.boundingBox();
  await p.mouse.move(cb.x + 40, cb.y + 12); await p.mouse.down(); await p.mouse.move(cb.x - 60, cb.y + 40, { steps: 6 }); await p.waitForTimeout(300);
  ok('ドラッグを始めると、パネルが脇へどく（カレンダーの日付に届く）', await p.locator('#todo-panel.away').count() === 1);
  const cell = p.locator(`.cell[data-date="${M}-15"]`); const cellb = await cell.boundingBox();
  await p.mouse.move(cellb.x + cellb.width / 2, cellb.y + 30, { steps: 12 }); await p.waitForTimeout(250); await p.mouse.up();
  await p.waitForSelector('.toast:has-text("予定に追加しました")'); await p.waitForTimeout(500);
  ok('ドロップすると、その日の予定になる（15日）', await p.locator('.bar:has-text("ホバーのToDo")').count() === 1);
  ok('ドロップしたあと、パネルは閉じる', await p.locator('#todo-panel').count() === 0);
  // 離れると閉じる
  await p.mouse.move(1000, 450); await p.mouse.move(1272, 450, { steps: 6 }); await p.waitForSelector('#todo-panel.open'); await p.mouse.move(400, 450, { steps: 8 }); await p.waitForTimeout(900);
  ok('カーソルが離れると、パネルは閉じる', await p.locator('#todo-panel').count() === 0);
  // ショートカット d / Esc
  await p.mouse.move(300, 300); await p.keyboard.press('d'); await p.waitForSelector('#todo-panel.open'); ok('d キーで、ToDoのパネルが開く', true);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); ok('Esc で閉じる', await p.locator('#todo-panel').count() === 0);
  // リストタブでは、目印もパネルも出ない
  await p.keyboard.press('l'); await p.waitForSelector('.kanban'); ok('リストタブでは、右端のToDoの目印は出ない', await p.locator('#todo-hover').count() === 0);
  await p.keyboard.press('c'); await p.waitForSelector('#todo-hover'); ok('カレンダーに戻ると、また出る', true);
  // 予定をドラッグ中は、右端でパネルが勝手に開かない（予定→ToDoの動きを邪魔しない）
  await p.keyboard.press('n'); await p.waitForSelector('.modal'); await p.fill('.modal input[name=title]', 'ToDoにする予定'); await p.fill('.modal input[name=start]', `${M}-18`); await p.click('.modal button[type=submit]'); await p.waitForSelector('.bar:has-text("ToDoにする予定")');
  const bar = p.locator('.bar:has-text("ToDoにする予定")').first(); const bb = await bar.boundingBox(); await p.mouse.move(bb.x + 20, bb.y + 8); await p.mouse.down(); await p.mouse.move(bb.x + 120, bb.y + 60, { steps: 5 }); await p.waitForTimeout(300); await p.mouse.move(1000, 300, { steps: 6 }); await p.waitForTimeout(300); await p.mouse.move(1275, 300, { steps: 10 }); await p.waitForTimeout(400);
  ok('予定をドラッグして右端へ持っていくと、同じToDoのパネルが開く（進行中・未着手の欄が出ている）', await p.locator('#todo-drop').count() === 0 && await p.locator('#todo-panel .tp-zone').count() === 2 && await p.locator('#todo-panel .tp-zone.st-doing').count() === 1);
  ok('「進行中」の欄は、必ず出ている（落とし先になる。カレンダーに置いたToDoは、進行中に入っている）', await p.locator('#todo-panel .tp-zone.st-doing').count() === 1);
  const zb = await p.locator('#todo-panel .tp-zone.st-doing').boundingBox(); await p.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2, { steps: 10 }); await p.waitForTimeout(250); await p.screenshot({ path: 'th-drop.png' }); ok('欄の上では強調される', await p.locator('#todo-panel .tp-zone.st-doing.drop').count() === 1);
  await p.mouse.up(); await p.waitForSelector('.toast:has-text("ToDoにしました（進行中）")'); await p.waitForTimeout(500);
  ok('進行中の欄にドロップすると、予定が消えて、ToDo（進行中）になる', await p.locator('.bar:has-text("ToDoにする予定")').count() === 0);
  await p.mouse.move(1000, 450); await p.mouse.move(1272, 450, { steps: 6 }); await p.waitForSelector('#todo-panel.open'); await p.waitForTimeout(300);
  ok('ToDoのパネルの「進行中」の欄に、そのToDoが入っている', (await p.locator('#todo-panel .tp-zone.st-doing').innerText()).includes('ToDoにする予定'));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
