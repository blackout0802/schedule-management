// ToDoを完了にすると、日報の当日の項目にも、取り消し線つきで入る（すでに日報にあれば、取り消し線にする）。未完了に戻すと、線は消える
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
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single'); await p.waitForSelector('#todo-mgr');
  const add = async (t) => { await p.click('#todo-mgr .todo-add-btn').catch(() => {}); await p.fill('#todo-mgr .todo-add input[type=text]', t); await p.click('#todo-mgr .todo-add button[type=submit]'); await p.waitForSelector('#todo-mgr .kb-card:has-text("' + t + '")'); };
  const memoItems = () => p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=cur]'); const out = []; let d = h.nextElementSibling; while (d && !d.textContent.trim()) d = d.nextElementSibling; while (d && d.textContent.trim() && !d.hasAttribute('data-md')) { out.push(d.textContent + (d.querySelector('s') ? '[s]' : '') + (d.hasAttribute('data-todo') ? '[t]' : '')); d = d.nextElementSibling; } return out; });
  await add('日報へ反映するToDo');
  const inMemo = await memoItems();
  ok('準備: まだ、日報の当日には、どちらも入っていない', !inMemo.some(x => x.includes('日報へ反映するToDo')), inMemo);
  // 「進行中」→「完了」にする
  const done = async (t) => { await p.click('#todo-mgr .kb-card:has-text("' + t + '") button:has-text("進行中へ")'); await p.waitForSelector('#todo-mgr .kb-card:has-text("' + t + '") button:has-text("完了 ✓")'); await p.click('#todo-mgr .kb-card:has-text("' + t + '") button:has-text("完了 ✓")'); await p.waitForSelector('#todo-mgr .kb-col.done .kb-card:has-text("' + t + '"), #todo-mgr .kb-card.done:has-text("' + t + '")'); };
  await done('日報へ反映するToDo');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('.memo-single div[data-md=cur] ~ div')).some(d => d.textContent.includes('日報へ反映するToDo')));
  const after = await memoItems();
  ok('完了にすると、日報の当日の項目に、取り消し線つきで入る（ToDoの印つき）', after.includes('日報へ反映するToDo[s][t]'), after);
  // 保存される
  await p.waitForTimeout(1500); await p.reload(); await p.waitForSelector('.memo-single');
  ok('開き直しても、日報に残っている', (await memoItems()).includes('日報へ反映するToDo[s][t]'), await memoItems());
  // 取り消し線の行は、次回出勤日には転記されない
  const nextTxt = await p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=next]'); const out = []; let d = h.nextElementSibling; while (d && !d.hasAttribute('data-md')) { out.push(d.textContent); d = d.nextElementSibling; } return out.join('|'); });
  ok('取り消し線の項目は、次回出勤日には転記されない', !nextTxt.includes('日報へ反映するToDo'), nextTxt);
  // 同じToDoを、二重に入れない・未完了に戻すと線が消える
  await p.waitForSelector('#todo-mgr .kb-card:has-text("日報へ反映するToDo")');
  await p.click('#todo-mgr .kb-card:has-text("日報へ反映するToDo") button:has-text("戻す")');
  await p.waitForFunction(() => !Array.from(document.querySelectorAll('.memo-single div[data-todo]')).some(d => d.textContent.includes('日報へ反映するToDo') && d.querySelector('s')));
  const back = await memoItems();
  ok('未完了に戻すと、日報の取り消し線は消える。行は、1つだけ', back.filter(x => x.includes('日報へ反映するToDo')).length === 1 && back.includes('日報へ反映するToDo[t]'), back);
  // プライベートのToDoは、日報に入れない
  await p.click('.tab[data-view=me]'); await p.waitForSelector('#todo-mgr'); await p.waitForTimeout(400);
  await add('私用のToDo');
  await p.click('#todo-mgr .kb-card:has-text("私用のToDo") button:has-text("進行中へ")'); await p.waitForSelector('#todo-mgr .kb-card:has-text("私用のToDo") button:has-text("完了 ✓")'); await p.click('#todo-mgr .kb-card:has-text("私用のToDo") button:has-text("完了 ✓")'); await p.waitForTimeout(800);
  await p.click('.tab[data-view=team]'); await p.waitForSelector('.memo-single'); await p.waitForTimeout(500);
  ok('プライベートのToDoは、完了にしても、日報には入らない（日報は業務）', !(await memoItems()).some(x => x.includes('私用のToDo')), await memoItems());
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
