// ToDoの「保留」（完了の下）と、完了は、ふだんは畳んで、押すと開く
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e))); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  const add = async (t) => { await p.click('#todo-mgr .todo-add-btn').catch(() => {}); await p.fill('#todo-mgr .todo-add input[type=text]', t); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('#todo-mgr .kb-card:has-text("' + t + '")'); };
  const card = t => '#todo-mgr .kb-card:has-text("' + t + '")';
  await add('終わらせるToDo'); await add('寝かせるToDo');
  // 完了にする
  await p.click(card('終わらせるToDo') + ' button:has-text("進行中へ")'); await p.waitForSelector(card('終わらせるToDo') + ' button:has-text("完了 ✓")'); await p.click(card('終わらせるToDo') + ' button:has-text("完了 ✓")');
  await p.waitForSelector('.kb-col.done .kb-fold'); await p.waitForTimeout(500);
  ok('完了は、ふだんは畳まれている（見出しに件数だけ。カードは出ない）', (await p.locator('.kb-col.done').getAttribute('class')).includes('collapsed') && (await p.locator('.kb-col.done .cnt').innerText()) === '1' && (await p.locator('.kb-col.done .kb-card').count()) === 0, await p.locator('.kb-col.done').innerText());
  await p.click('.kb-col.done .kb-fold'); await p.waitForSelector('.kb-col.done .kb-card:has-text("終わらせるToDo")');
  ok('見出しを押すと、完了が開き、完了したToDoが見える', (await p.locator('.kb-col.done .kb-fold').getAttribute('aria-expanded')) === 'true');
  await p.reload(); await p.waitForSelector('.kanban');
  ok('開き畳みは、開き直しても覚えている（開いたまま）', (await p.locator('.kb-col.done .kb-card').count()) === 1);
  await p.click('.kb-col.done .kb-fold'); await p.waitForFunction(() => document.querySelectorAll('.kb-col.done .kb-card').length === 0);
  ok('もう一度押すと、畳まれる', (await p.locator('.kb-col.done').getAttribute('class')).includes('collapsed'));
  // 保留
  const topOf = s => p.locator(s).evaluate(e => e.getBoundingClientRect().top);
  ok('「保留」の枠が、完了の下にある（同じ右の列）', (await p.locator('.kb-stack .kb-col.hold').count()) === 1 && (await topOf('.kb-col.hold')) > (await topOf('.kb-col.done')), [await topOf('.kb-col.hold'), await topOf('.kb-col.done')]);
  await p.click(card('寝かせるToDo') + ' button:has-text("保留")'); await p.waitForSelector('.kb-col.hold .kb-card:has-text("寝かせるToDo")');
  ok('未着手のToDoを「保留」にすると、保留の枠に移る。件数も出る', (await p.locator('.kb-col.todo .kb-card:has-text("寝かせるToDo")').count()) === 0 && (await p.locator('.kb-col.hold .cnt').innerText()) === '1');
  await p.waitForTimeout(800); await p.reload(); await p.waitForSelector('.kanban');
  ok('保留は、保存される（開き直しても、保留のまま）', (await p.locator('.kb-col.hold .kb-card:has-text("寝かせるToDo")').count()) === 1);
  await p.click('.kb-col.hold .kb-card:has-text("寝かせるToDo") button:has-text("進行中へ")'); await p.waitForSelector('.kb-col.doing .kb-card:has-text("寝かせるToDo")');
  ok('保留から、進行中へ戻せる', (await p.locator('.kb-col.hold .kb-card').count()) === 0);
  // ドラッグで保留へ
  await p.locator('.kb-col.doing .kb-card:has-text("寝かせるToDo")').dragTo(p.locator('.kb-col.hold')); await p.waitForSelector('.kb-col.hold .kb-card:has-text("寝かせるToDo")');
  ok('カードを、保留の枠へドラッグしても、保留になる', true);
  // 保留のToDoは、カレンダーの ToDo パネル（進行中・未着手）には出ない
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.cal'); await p.keyboard.press('d'); await p.waitForSelector('#todo-panel.open');
  ok('カレンダーのToDoパネルには、保留のToDoは出ない', (await p.locator('#todo-panel .tp-card:has-text("寝かせるToDo")').count()) === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
