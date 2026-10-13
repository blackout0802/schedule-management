const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
async function login(b, email, pw, vp) {
  const ctx = await b.newContext({ viewport: vp || { width: 1280, height: 1000 } }); const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal, .list'); return p;
}
const openAdd = async (pg, sel) => { if (!(await pg.locator(sel + ' .todo-add input[type=text]').count())) await pg.click(sel + ' .todo-add-btn'); await pg.waitForSelector(sel + ' .todo-add input[type=text]'); };
(async () => {
  const b = await chromium.launch();
  const p = await login(b, 'yamada@example.com', 'yamadapass1');
  await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  for (const t of ['A', 'B', 'C', 'D']) { await openAdd(p, '#todo-mgr'); await p.fill('#todo-mgr .todo-add input[type=text]', t); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('#todo-mgr .kb-card:has-text("' + t + '")'); }
  const col = (s) => `.kanban .kb-col.${s}`;
  const titles = (s) => p.locator(col(s) + ' .kb-card .t-title').allInnerTexts();
  const J = x => JSON.stringify(x);
  ok('3つの列（未着手・進行中・完了）がある', J(await p.locator('.kanban .kb-col h3').allInnerTexts()).includes('未着手') && await p.locator('.kanban .kb-col').count() === 3);
  ok('追加したToDoは未着手に並ぶ', J(await titles('todo')) === '["A","B","C","D"]', await titles('todo'));
  // ドラッグで進行中へ
  await p.locator(col('todo') + ' .kb-card:has-text("A")').dragTo(p.locator(col('doing')));
  await p.waitForFunction(() => document.querySelectorAll('.kb-col.doing .kb-card').length === 1);
  ok('ドラッグで進行中の列へ移せる', J(await titles('doing')) === '["A"]' && J(await titles('todo')) === '["B","C","D"]');
  // ボタンで進行中へ
  await p.click(col('todo') + ' .kb-card:has-text("B") button:has-text("進行中へ")');
  await p.waitForFunction(() => document.querySelectorAll('.kb-col.doing .kb-card').length === 2);
  ok('ボタンでも進行中へ移せる（末尾に入る）', J(await titles('doing')) === '["A","B"]', await titles('doing'));
  // 進行中の列で C を A の前へ（別の列から、位置指定）
  await p.locator(col('todo') + ' .kb-card:has-text("C")').dragTo(p.locator(col('doing') + ' .kb-card:has-text("A")'), { targetPosition: { x: 40, y: 3 } });
  await p.waitForFunction(() => document.querySelectorAll('.kb-col.doing .kb-card').length === 3);
  ok('他の列から、カードの前へ差し込める', J(await titles('doing')) === '["C","A","B"]', await titles('doing'));
  // 列の中で並べ替え
  await p.locator(col('doing') + ' .kb-card:has-text("B")').dragTo(p.locator(col('doing') + ' .kb-card:has-text("C")'), { targetPosition: { x: 40, y: 3 } });
  await p.waitForTimeout(600);
  ok('同じ列の中で並べ替えできる', J(await titles('doing')) === '["B","C","A"]', await titles('doing'));
  // 再読み込みしても保たれる
  await p.reload(); await p.waitForSelector('.kanban');
  ok('再読み込みしても、列と並びが保たれる', J(await titles('doing')) === '["B","C","A"]' && J(await titles('todo')) === '["D"]', [await titles('doing'), await titles('todo')]);
  // 完了へ
  await p.click(col('doing') + ' .kb-card:has-text("A") button:has-text("完了")');
  await p.waitForFunction(() => document.querySelectorAll('.kb-col.done .kb-card').length === 1);
  ok('「完了」で完了の列へ移り、完了日が付く', J(await titles('done')) === '["A"]' && /\d+\/\d+ 完了/.test(await p.locator(col('done')).innerText()));
  await p.waitForTimeout(400); ok('完了のカードは取り消し線', await p.locator(col('done') + ' .kb-card .t-title').evaluate(e => getComputedStyle(e).textDecorationLine) === 'line-through');
  // 進行中のカードを完了の列へドラッグ
  await p.locator(col('doing') + ' .kb-card:has-text("C")').dragTo(p.locator(col('done')));
  await p.waitForFunction(() => document.querySelectorAll('.kb-col.done .kb-card').length === 2);
  ok('ドラッグで完了の列へ移せる', J(await titles('done')) === '["C","A"]', await titles('done'));
  // 完了から未着手へ
  await p.locator(col('done') + ' .kb-card:has-text("A")').dragTo(p.locator(col('todo')), { targetPosition: { x: 60, y: 150 } }); // 列の空いた所（カードの下）
  await p.waitForFunction(() => document.querySelectorAll('.kb-col.todo .kb-card').length === 2);
  ok('完了から未着手へ戻せる', J(await titles('todo')) === '["D","A"]' && J(await titles('done')) === '["C"]', [await titles('todo'), await titles('done')]);
  await p.screenshot({ path: 'kanban.png', fullPage: true });
  // 他の人には見えない
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await s.click('.toolbar .seg label:has-text("リスト")'); await s.waitForSelector('.kanban'); await s.selectOption('#todo-mgr .todo-who select', 'all'); await s.waitForTimeout(300);
  ok('他の社員のカンバンには、業務のToDoが「見るだけ」で出る（自分のカードとしては出ない）', await s.locator('.kanban .kb-card:not(.other)').count() === 0 && await s.locator('.kanban .kb-card.other').count() > 0);
  // 業務版
  await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  // 削除・一括削除
  await p.click(col('todo') + ' .kb-card:has-text("D") button:has-text("削除")'); await p.waitForFunction(() => document.querySelectorAll('.kb-col.todo .kb-card').length === 1);
  ok('カードを削除できる', J(await titles('todo')) === '["A"]', await titles('todo'));
  await p.click(col('done') + ' button:has-text("完了をすべて削除")'); await p.waitForFunction(() => document.querySelectorAll('.kb-col.done .kb-card').length === 0);
  ok('完了をすべて削除できる', true);
  // 編集
  await p.click(col('todo') + ' .kb-card:has-text("A") button:has-text("編集")'); await p.fill('.modal input[name=title]', 'A改'); await p.click('.modal button[type=submit]');
  await p.waitForSelector(col('todo') + ' .kb-card:has-text("A改")'); ok('カードを編集できる', true);
  // スマホ幅
  const m = await login(b, 'yamada@example.com', 'yamadapass1', { width: 390, height: 800 }); await m.click('.toolbar .seg label:has-text("リスト")'); await m.waitForSelector('.kanban');
  const tabsVisible = await m.locator('.kb-tabs').isVisible();
  const shown = await m.locator('.kanban .kb-col').evaluateAll(es => es.filter(e => e.getBoundingClientRect().height > 0).map(e => e.dataset.status));
  ok('スマホ幅では、状態のタブが出て、1つの列だけが見える（初期は進行中）', tabsVisible && J(shown) === '["doing"]', [tabsVisible, shown]);
  ok('横スクロールしない', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.click('.kb-tab.todo');
  ok('タブで未着手に切り替わる', J(await m.locator('.kanban .kb-col').evaluateAll(es => es.filter(e => e.getBoundingClientRect().height > 0).map(e => e.dataset.status))) === '["todo"]');
  await m.click('.kb-col.todo .kb-card button:has-text("進行中へ")'); await m.waitForFunction(() => document.querySelectorAll('.kb-col.doing .kb-card').length >= 1);
  ok('スマホでもボタンで列を移せ、タブの件数が変わる', /進行中 \d/.test(await m.locator('.kb-tab.doing').innerText()), await m.locator('.kb-tab.doing').innerText());
  await m.reload(); await m.waitForSelector('.kanban');
  ok('選んだタブは再読み込みしても保たれる', await m.locator('.kanban').getAttribute('data-tab') === 'todo');
  ok('PC幅ではタブは出ない', !(await p.locator('.kb-tabs').isVisible()));
  await m.screenshot({ path: 'kanban-mobile.png', fullPage: true });
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
