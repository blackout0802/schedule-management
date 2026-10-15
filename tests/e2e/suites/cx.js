const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const ds = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const openAdd = async (pg, sel) => { if (!(await pg.locator(sel + ' .todo-add input[type=text]').count())) await pg.click(sel + ' .todo-add-btn'); await pg.waitForSelector(sel + ' .todo-add input[type=text]'); };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const mode = () => p.evaluate(() => document.querySelector('.toolbar .seg input:checked').parentElement.innerText.trim());
  const h2 = () => p.locator('.toolbar h2').innerText();
  // ---- ショートカット
  await p.keyboard.press('l'); await p.waitForSelector('.kanban'); ok('l でリストに移る', (await mode()) === 'リスト');
  await p.keyboard.press('c'); await p.waitForSelector('.cal'); ok('c でカレンダーに移る', (await mode()) === 'カレンダー');
  const h0 = await h2(); await p.keyboard.press('ArrowRight'); await p.waitForFunction((h) => document.querySelector('.toolbar h2').innerText !== h, h0); ok('→ で次の月', (await h2()) !== h0);
  await p.keyboard.press('ArrowLeft'); await p.waitForFunction((h) => document.querySelector('.toolbar h2').innerText === h, h0); ok('← で前の月', (await h2()) === h0);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('t'); await p.waitForFunction((h) => document.querySelector('.toolbar h2').innerText === h, h0); ok('t で今月に戻る', (await h2()) === h0);
  await p.keyboard.press('p'); await p.waitForSelector('.view-banner.me'); ok('p でプライベート版', true); await p.keyboard.press('b'); await p.waitForSelector('.view-banner.team'); ok('b で業務版', true);
  await p.keyboard.press('n'); await p.waitForSelector('.modal'); ok('n で予定の追加画面が開く', (await p.locator('.modal h3').innerText()).includes('予定を追加')); ok('n の文字が入力欄に入らない', (await p.inputValue('.modal input[name=title]')) === '');
  await p.keyboard.press('c'); ok('ダイアログを開いている間は、ショートカットは動かない', (await p.locator('.modal').count()) === 1 && (await p.inputValue('.modal input[name=title]')) === 'c'); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.keyboard.press('Shift+/'); await p.waitForSelector('.sc-table'); ok('? でショートカット一覧', (await p.locator('.sc-table').innerText()).includes('カレンダーを表示')); await p.keyboard.press('Escape');
  // 日本語入力オン相当（key が全角・Process でも、code で動く）
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'ｌ', bubbles: true }))); await p.waitForSelector('.kanban'); ok('日本語入力（全角の ｌ）でも動く', (await mode()) === 'リスト');
  await openAdd(p, '#todo-mgr'); await p.focus('#todo-mgr .todo-add input[type=text]'); await p.keyboard.type('cl'); ok('入力欄に打っている文字では、動かない', (await mode()) === 'リスト' && (await p.inputValue('#todo-mgr .todo-add input[type=text]')) === 'cl'); await p.fill('#todo-mgr .todo-add input[type=text]', ''); await p.evaluate(() => document.activeElement.blur());
  await p.keyboard.press('Control+c'); ok('Ctrl+C（コピー）は邪魔しない', (await mode()) === 'リスト');
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); // 入力欄に、カーソルが残っていると、c は文字として入ってしまう
  await p.keyboard.press('c'); await p.waitForSelector('.cal');
  // ---- まとめの行を押す
  await p.selectOption('#who-sel', 'all'); await p.waitForSelector('.ms-table tbody tr.pick'); const rowsN = await p.locator('.ms-table tbody tr').count();
  await p.locator('.ms-table tbody tr:has-text("鈴木 一郎")').click(); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 1);
  const sel = await p.inputValue('#who-sel'); ok('まとめで他の社員の行を押すと、「表示する人」でその人を選んだときと同じになる', (await p.locator('#who-sel option:checked').innerText()) === '鈴木 一郎' && (await p.locator('.view-banner').innerText()).includes('鈴木 一郎さんの予定') && rowsN === 3, [sel, rowsN]);
  await p.click('.month-sum button:has-text("全社に戻す")'); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3); ok('「全社に戻す」で全社へ', (await p.inputValue('#who-sel')) === 'all');
  await p.locator('.ms-table tbody tr:has-text("山田 花子")').click(); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 1); ok('自分の行を押すと「自分」', (await p.locator('#who-sel option:checked').innerText()) === '自分');
  await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3);
  // ---- カレンダーの予定 → ToDo（右端のパネル）
  await p.keyboard.press('n'); await p.waitForSelector('.modal'); await p.fill('.modal input[name=title]', 'カレンダーから戻す予定'); await p.fill('.modal input[name=start]', ds); await p.click('.modal button[type=submit]'); await p.waitForSelector('.bar:has-text("カレンダーから戻す予定")');
  const bar = p.locator('.bar:has-text("カレンダーから戻す予定")').first(); const bb = await bar.boundingBox();
  await p.mouse.move(bb.x + 20, bb.y + 8); await p.mouse.down(); await p.mouse.move(bb.x + 120, bb.y + 60, { steps: 5 }); await p.waitForTimeout(300);
  ok('予定をドラッグすると、右端に「ToDoへ」の目印が出る', await p.locator('#todo-edge').count() === 1);
  await p.mouse.move(1000, 300, { steps: 6 }); await p.waitForTimeout(300); await p.mouse.move(1275, 300, { steps: 10 }); await p.waitForTimeout(300); await p.waitForSelector('#todo-panel.open');
  ok('右端まで持っていくと、ToDoのパネル（進行中・未着手の欄）が開く', await p.locator('#todo-panel .tp-zone').count() === 2 && await p.locator('#todo-drop').count() === 0);
  const zone = p.locator('#todo-panel .tp-zone.st-doing'); const zb = await zone.boundingBox(); await p.mouse.move(zb.x + zb.width / 2, zb.y + zb.height - 20, { steps: 12 }); await p.waitForTimeout(200); await p.screenshot({ path: 'cx-todo-drop.png' }); await p.mouse.up();
  await p.waitForSelector('.toast:has-text("ToDoにしました（進行中）")'); await p.waitForTimeout(500);
  ok('ドロップすると、予定が消えて、ToDoの「進行中」になる', await p.locator('.bar:has-text("カレンダーから戻す予定")').count() === 0);
  await p.keyboard.press('l'); await p.waitForSelector('.kanban'); ok('リストの「進行中」の列に入っている', await p.locator('.kb-col.doing .kb-card:has-text("カレンダーから戻す予定")').count() === 1);
  // ---- リストは、ToDoだけ（予定の一覧は出さない）
  ok('リスト画面に、予定の一覧（今月の予定・日の行）は出ない', (await p.locator('.list-day').count()) === 0 && (await p.locator('.list-h').count()) === 0 && (await p.locator('.list').count()) === 0);
  ok('リスト画面に、ToDoの管理（カンバン）は出る', (await p.locator('#todo-mgr .kanban').count()) === 1);
  ok('リスト画面では、月の移動・「今日」・「表示する人」・説明の帯は出ない', (await p.locator('.toolbar button[aria-label=前の月]').count()) === 0 && (await p.locator('#who-sel').count()) === 0 && (await p.locator('.view-banner').count()) === 0);
  ok('見出しは「ToDo（業務）」', (await p.locator('.toolbar h2').innerText()).startsWith('ToDo'));
  ok('ToDoの説明に、「今月の予定」の言葉は出ない', !(await p.locator('#todo-mgr .hint').first().innerText()).includes('今月の予定'));
  await p.keyboard.press('c'); await p.waitForSelector('.cal'); ok('カレンダーに戻ると、月の移動と予定が戻る', (await p.locator('.toolbar button[aria-label=前の月]').count()) === 1 && (await p.locator('.cal').count()) === 1);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
