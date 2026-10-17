const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE + 'login.php');
  await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]);
  await p.waitForSelector('.cal');
  await p.evaluate(() => localStorage.setItem('sched.doneOpen', 'true')); await p.reload(); await p.waitForSelector('.cal'); // 完了は、ふだんは畳んである。このテストは、開いた状態で確かめる
  const ver = await p.locator('.brand .ver').innerText();
  ok('スケジュール管理の右横にバージョンが出る', /^v\d+\.\d+\.\d+$/.test(ver), ver);
  // ToDoを作る（API）
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const t1 = await api('todo_save', { title: '見積書を作る', kind: 'work', tag: '個人作業' });
  const t2 = await api('todo_save', { title: '請求書の確認', kind: 'work', tag: '定例業務' });
  await p.reload(); await p.waitForSelector('.cal');
  // 業務版のリスト画面
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  const blk = kind => p.evaluate((kind) => { const h = document.querySelector('.memo-single div[data-md=' + kind + ']'); const out = []; let d = h.nextElementSibling; if (d && !d.textContent.trim()) d = d.nextElementSibling; while (d && d.textContent.trim() && !d.hasAttribute('data-md')) { out.push({ t: d.textContent, s: !!d.querySelector('s,strike'), tr: d.hasAttribute('data-tr'), todo: d.getAttribute('data-todo') }); d = d.nextElementSibling; } return out; }, kind);
  ok('日報は1つの入力欄で、日付の行が2つ（当日・次回出勤日）', await p.locator('.memo-single').count() === 1 && await p.locator('.memo-single div[data-md]').count() === 2);
  ok('日報の項目は最初は空（自動で入らない）', (await blk('cur')).length === 0 && (await blk('next')).length === 0);
  // カードをカレンダーへ置く（日付ダイアログ）
  const card = p.locator('.kb-card:has-text("見積書を作る")');
  await card.locator('button:has-text("日付")').click();
  await p.waitForSelector('.modal input[type=date]');
  const today = ((x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'))(new Date());
  await p.fill('.modal input[type=date]', today); await p.click('.modal button[type=submit]');
  await p.waitForTimeout(900);
  ok('置いたToDoは「進行中」の列に移る', await p.locator('.kb-col.doing .kb-card:has-text("見積書を作る")').count() === 1 || await p.locator('.kb-col:has(.kb-card:has-text("見積書を作る"))').getAttribute('class').then(c => /doing/.test(c)));
  ok('カードに置いた日が出る', await p.locator('.kb-card:has-text("見積書を作る") .pill.sched').count() === 1);
  // カレンダーに予定がある
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.cal');
  await p.waitForSelector('.bar:has-text("見積書を作る")');
  ok('カレンダーに予定が出ている（まだ取り消し線なし）', await p.locator('.bar.work:has-text("見積書を作る")').count() === 1 && await p.locator('.bar.done:has-text("見積書を作る")').count() === 0);
  // 完了へ
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  await p.locator('.kb-card:has-text("見積書を作る") button:has-text("完了")').click();
  await p.waitForTimeout(800);
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.bar:has-text("見積書を作る")');
  await p.waitForTimeout(500);
  ok('完了にすると、カレンダーの予定に取り消し線', await p.locator('.bar.done:has-text("見積書を作る")').count() === 1);
  const deco = await p.locator('.bar.done:has-text("見積書を作る")').evaluate(e => getComputedStyle(e).textDecorationLine);
  ok('取り消し線が実際に引かれている', deco.includes('line-through'), deco);
  await p.screenshot({ path: 'tdlink-cal.png' });
  // 日報: ドラッグ&ドロップ（当日の日付の行の下へ）
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.kanban');
  const cardB = p.locator('.kb-card:has-text("請求書の確認")');
  await cardB.dragTo(p.locator('.memo-single div[data-md=cur]'));
  await p.waitForTimeout(600);
  let c1 = await blk('cur');
  const B = a => a.filter(x => x.t === '請求書の確認'); // 先に完了にした「見積書を作る」は、完了のときに、日報の当日にも、取り消し線で入っている
  ok('完了にしたToDo（見積書を作る）は、日報の当日にも、取り消し線つきで入っている', c1.some(x => x.t === '見積書を作る' && x.s && x.todo), c1);
  ok('ドロップすると、当日の項目に1行入る', B(c1).length === 1 && B(c1)[0].todo, c1);
  let n1 = await blk('next');
  ok('取り消し線のない項目は、次回出勤日に転記される', n1.length === 1 && n1[0].t === '請求書の確認' && n1[0].tr, n1);
  // 次回出勤日の見出しの行へ（完了済みのカード）
  const cardA = p.locator('.kb-card:has-text("見積書を作る")');
  await cardA.dragTo(p.locator('.memo-single div[data-md=next]'));
  await p.waitForTimeout(600);
  n1 = await blk('next');
  ok('次回出勤日の見出しへドロップすると、次回出勤日の項目に入る（完了は取り消し線つき）', n1.some(x => x.t === '見積書を作る' && x.s), n1);
  // 進捗に合わせる: 請求書の確認を完了にすると線が付く（転記の行は、消える）
  await p.locator('.kb-card:has-text("請求書の確認")').locator('button:has-text("進行中へ")').click();
  await p.waitForTimeout(500);
  await p.locator('.kb-card:has-text("請求書の確認") button:has-text("完了")').click();
  await p.waitForTimeout(900);
  c1 = await blk('cur'); n1 = await blk('next');
  ok('完了にすると、当日の行に取り消し線が付き、次回出勤日への転記は無くなる', B(c1).length === 1 && B(c1)[0].s && !n1.some(x => x.t === '請求書の確認' && x.tr), [c1, n1]);
  // 戻すと線が消えて、また転記される
  await p.locator('.kb-card:has-text("請求書の確認") button:has-text("戻す")').click();
  await p.waitForTimeout(900);
  c1 = await blk('cur'); n1 = await blk('next');
  ok('未完了に戻すと、線が消えて、また転記される', B(c1).length === 1 && !B(c1)[0].s && n1.some(x => x.t === '請求書の確認' && x.tr), [c1, n1]);
  // 保存されている（リロード）
  await p.waitForTimeout(1200);
  await p.reload(); await p.waitForSelector('.memo-single');
  await p.waitForTimeout(600);
  const all = await p.locator('.memo-single').innerText();
  ok('再読み込みしても、日報が残っている', all.includes('請求書の確認') && all.includes('見積書を作る'), all);
  // 手入力も保存される
  await p.evaluate(() => { const d = document.querySelector('.memo-single div[data-md=cur]').nextElementSibling.nextElementSibling; const r = document.createRange(); r.selectNodeContents(d); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.memo-single').focus(); });
  await p.keyboard.press('Enter'); await p.keyboard.type('手で入れた行');
  await p.waitForTimeout(1500);
  await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(500);
  const t = await p.locator('.memo-single').innerText();
  ok('手で入れた行も保存される', t.includes('手で入れた行'), t);
  const m1h = await p.locator('.memo-single').innerHTML();
  ok('Enterで増えた行には、ToDoの印が付かない', !/data-todo="\d+"[^>]*>手で入れた行/.test(m1h) && (m1h.match(/data-todo/g) || []).length === 4, m1h); // 見積（当日・次回）と請求書（当日・転記）の4つ
  await p.screenshot({ path: 'tdlink-list.png', fullPage: true });
  ok('JSエラーなし', errs.length === 0, errs);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
