const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  p.on('pageerror', e => console.log('ERR', String(e)));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  // ---- リスト画面 ----
  await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr');
  ok('リスト: 上の追加欄・追加ボタンは無い', await p.locator('#todo-mgr > .todo-add, #todo-mgr > form').count() === 0 && await p.locator('#todo-mgr .todo-add').count() === 0);
  ok('リスト: 未着手の一番下に「＋ 追加」がある', await p.locator('#todo-mgr .kb-col.todo > :last-child.todo-add-btn').count() === 1, await p.locator('#todo-mgr .kb-col.todo').innerHTML());
  ok('リスト: 進行中・完了には「＋ 追加」は無い', await p.locator('#todo-mgr .kb-col.doing .todo-add-btn, #todo-mgr .kb-col.done .todo-add-btn').count() === 0);
  await p.click('#todo-mgr .todo-add-btn'); await p.waitForSelector('#todo-mgr .kb-col.todo .todo-add input[type=text]');
  ok('押すと、その場に入力欄が開き、すぐ入力できる', await p.evaluate(() => document.activeElement && document.activeElement.matches('#todo-mgr .kb-col.todo .todo-add input[type=text]')));
  await p.keyboard.type('一件目'); await p.keyboard.press('Enter');
  await p.waitForSelector('#todo-mgr .kb-card:has-text("一件目")'); ok('Enterで未着手に追加される', await p.locator('#todo-mgr .kb-col.todo .kb-card:has-text("一件目")').count() === 1);
  ok('追加後も入力欄が開いたまま・入力欄が空・フォーカスあり', await p.evaluate(() => { const i = document.querySelector('#todo-mgr .todo-add input[type=text]'); return !!i && i.value === '' && document.activeElement === i; }));
  await p.keyboard.type('二件目'); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('#todo-mgr .kb-card:has-text("二件目")');
  ok('続けて追加できる（順は追加した順）', JSON.stringify(await p.locator('#todo-mgr .kb-col.todo .t-title').allInnerTexts()) === '["一件目","二件目"]');
  ok('入力欄は、カードより下（一番下）にある', await p.evaluate(() => { const f = document.querySelector('#todo-mgr .kb-col.todo .todo-add'); const c = [...document.querySelectorAll('#todo-mgr .kb-col.todo .kb-card')].pop(); return f.getBoundingClientRect().top > c.getBoundingClientRect().bottom - 1; }));
  await p.keyboard.type('書きかけ'); await p.waitForTimeout(100);
  await p.keyboard.press('Escape'); await p.waitForSelector('#todo-mgr .todo-add-btn');
  ok('Escで閉じて、「＋ 追加」に戻る（書きかけは捨てる）', await p.locator('#todo-mgr .todo-add').count() === 0);
  await p.click('#todo-mgr .todo-add-btn'); ok('開き直すと、入力欄は空', await p.inputValue('#todo-mgr .todo-add input[type=text]') === '');
  await p.click('#todo-mgr .todo-add button:has-text("キャンセル")'); await p.waitForSelector('#todo-mgr .todo-add-btn'); ok('キャンセルでも閉じる', true);
  // 入力途中に、画面が描き直されても（他の人の更新など）消えない
  await p.click('#todo-mgr .todo-add-btn'); await p.keyboard.type('途中の文字');
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(300);
  await p.click('.toolbar .seg label:has-text("カレンダー")'); await p.waitForSelector('.cal'); await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr');
  ok('カレンダーと行き来しても、入力途中の文字が残る', (await p.locator('#todo-mgr .todo-add input[type=text]').count()) === 1 && (await p.inputValue('#todo-mgr .todo-add input[type=text]')) === '途中の文字');
  await p.click('#todo-mgr .todo-add button:has-text("キャンセル")');
  // ---- カレンダー画面のToDoパネル ----
  await p.click('.toolbar .seg label:has-text("カレンダー")'); await p.waitForSelector('.cal');
  await p.keyboard.press('d'); await p.waitForSelector('#todo-panel.open');
  ok('パネル: 上の追加欄は無い', await p.locator('#todo-panel .tp-add').count() === 0 && await p.locator('#todo-panel > .todo-add').count() === 0);
  ok('パネル: 未着手の一番下に「＋ 追加」がある', await p.locator('#todo-panel .tp-zone.st-todo > :last-child.todo-add-btn').count() === 1, await p.locator('#todo-panel .tp-zone.st-todo').innerHTML());
  ok('パネル: 進行中には「＋ 追加」は無い', await p.locator('#todo-panel .tp-zone.st-doing .todo-add-btn').count() === 0);
  await p.click('#todo-panel .todo-add-btn'); ok('パネルの入力欄は、リストの書きかけを引き継がない', await p.inputValue('#todo-panel .todo-add input[type=text]') === ''); await p.keyboard.type('パネルから'); await p.keyboard.press('Enter');
  await p.waitForSelector('#todo-panel .tp-card:has-text("パネルから")'); ok('パネルから追加でき、未着手に入る', await p.locator('#todo-panel .tp-zone.st-todo .tp-card:has-text("パネルから")').count() === 1);
  ok('パネル: 続けて入力できる（入力欄が開いたまま）', await p.evaluate(() => document.activeElement && document.activeElement.matches('#todo-panel .todo-add input[type=text]')));
  await p.keyboard.press('Escape'); await p.waitForSelector('#todo-panel .todo-add-btn');
  ok('パネル: Escで入力欄だけが閉じる（パネルは開いたまま）', await p.locator('#todo-panel.open').count() === 1);
  await p.screenshot({ path: 'add-panel.png' });
  // ---- プライベート版: 種類の選択 ----
  await p.keyboard.press('Escape'); await p.click('.tab[data-view=me]'); await p.waitForTimeout(500);
  await p.keyboard.press('d'); await p.waitForSelector('#todo-panel.open'); await p.click('#todo-panel .todo-add-btn');
  ok('プライベート版: 入力欄に、種類の選択はない（プライベート版では、プライベートのToDoを追加する）', await p.locator('#todo-panel .todo-add select').count() === 0);
  await p.fill('#todo-panel .todo-add input[type=text]', '私用のToDo'); await p.press('#todo-panel .todo-add input[type=text]', 'Enter');
  await p.waitForSelector('#todo-panel .tp-card.private:has-text("私用のToDo")'); ok('プライベート版で追加したToDoは、プライベートのToDoになる', true);
  await p.keyboard.press('Escape'); await p.click('.tab[data-view=team]'); await p.waitForTimeout(900); await p.keyboard.press('Escape'); await p.waitForTimeout(500); await p.keyboard.press('d'); await p.waitForSelector('#todo-panel.open');
  ok('業務版には、プライベートのToDoは出ない（ToDoは、業務とプライベートで分かれている）', (await p.locator('#todo-panel .tp-card:has-text("私用のToDo")').count()) === 0 && (await p.locator('#todo-panel .tp-card:has-text("パネルから")').count()) === 1);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
