// ToDo リスト: まとまり（列、または人ごとの見出しの中）ごとに 5件まで出し、6件目からは畳む（「ほか N件を表示」で開く）。
// 全部の列（完了も）。足したカード・移したカードは、畳んでいても出す
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
async function login(b, email, pw) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p;
}
const api = (p, a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
const col = s => '#todo-mgr .kb-col.' + s;
(async () => {
  const b = await chromium.launch();
  const y = await login(b, 'yamada@example.com', 'yamadapass1'); const s = await login(b, 'suzuki@example.com', 'suzukipass1');
  const add = async (p, title, status) => { const td = (await api(p, 'todo_save', { title, kind: 'work', tag: '個人作業' })).todo; if (status !== 'todo') await api(p, 'todo_status', { id: td.id, status }); };
  for (let i = 1; i <= 7; i++) await add(y, '未着手A' + i, 'todo');
  for (let i = 1; i <= 6; i++) await add(y, '進行中D' + i, 'doing');
  for (let i = 1; i <= 6; i++) await add(y, '完了X' + i, 'done');
  for (let i = 1; i <= 6; i++) await add(s, '鈴木S' + i, 'todo');
  await y.evaluate(() => localStorage.setItem('sched.doneOpen', 'true')); await y.reload(); await y.waitForSelector('.cal');
  await y.click('.seg label:has-text("リスト")'); await y.waitForSelector(col('todo') + ' .kb-card');
  const cards = st => y.locator(col(st) + ' .kb-card');
  const titles = async st => (await y.locator(col(st) + ' .kb-card .t-title').allInnerTexts());
  const more = async st => { const m = y.locator(col(st) + ' > .kb-more'); return (await m.count()) ? (await m.innerText()).trim() : ''; };
  let t = await titles('todo');
  ok('未着手（7件）: 5件だけ出て、「ほか 2件を表示」', t.length === 5 && t[0] === '未着手A1' && t[4] === '未着手A5' && (await more('todo')).includes('ほか 2件を表示'), [t, await more('todo')]);
  ok('進行中（6件）: 5件だけ出て、「ほか 1件を表示」', (await cards('doing').count()) === 5 && (await more('doing')).includes('ほか 1件を表示'), await more('doing'));
  ok('完了（6件。開いたとき）も: 5件だけ出て、「ほか 1件を表示」', (await cards('done').count()) === 5 && (await more('done')).includes('ほか 1件を表示'), await more('done'));
  await y.click(col('todo') + ' > .kb-more'); await y.waitForFunction(() => document.querySelectorAll('#todo-mgr .kb-col.todo .kb-card').length === 7);
  ok('押すと、全部出て「5件だけにする」になる（ほかの列は畳んだまま）', (await more('todo')).includes('5件だけにする') && (await cards('doing').count()) === 5);
  await y.evaluate(() => window.dispatchEvent(new Event('focus'))); await y.waitForTimeout(1500);
  ok('自動更新で描き直しても、開いたまま', (await cards('todo').count()) === 7);
  await y.click(col('todo') + ' > .kb-more'); await y.waitForFunction(() => document.querySelectorAll('#todo-mgr .kb-col.todo .kb-card').length === 5);
  ok('「5件だけにする」で、また畳む', (await more('todo')).includes('ほか 2件を表示'));
  // 足したカードは、畳んでいても出る
  await y.click('#todo-mgr .todo-add-btn'); await y.fill('#todo-mgr .todo-add input[type=text]', '足した未着手A8'); await y.click('#todo-mgr .todo-add button[type=submit]');
  await y.waitForSelector(col('todo') + ' .kb-card:has-text("足した未着手A8")');
  t = await titles('todo');
  ok('「＋ 追加」で足したカードは、6件目以降でも出る（ほかは畳んだまま）', t.length === 6 && t[5] === '足した未着手A8' && (await more('todo')).includes('ほか 2件を表示'), [t, await more('todo')]);
  // 移したカードは、移した先が畳まれていても出る
  await y.click(col('todo') + ' .kb-card:has-text("未着手A1") button:has-text("進行中へ")'); await y.waitForSelector(col('doing') + ' .kb-card:has-text("未着手A1")');
  const d = await titles('doing');
  ok('進行中へ移したカードは、畳んだ列の最後でも出る', d.length === 6 && d[5] === '未着手A1' && (await more('doing')).includes('ほか 1件を表示'), [d, await more('doing')]);
  t = await titles('todo');
  ok('移したあとの未着手は、また 5件まで', t.length === 5 && t[0] === '未着手A2' && (await more('todo')).includes('ほか 2件を表示'), [t, await more('todo')]);
  await y.screenshot({ path: 'kbmore.png', fullPage: true });
  // 全員の ToDo: 人ごとの見出しの中で、5件まで
  await y.selectOption('#todo-mgr .todo-who select', 'all'); await y.waitForSelector(col('todo') + ' .kb-who-h:has-text("鈴木")');
  await y.click(col('todo') + ' .kb-who-h:has-text("鈴木")'); await y.waitForSelector(col('todo') + ' .kb-card.other');
  const sbox = col('todo') + ' .kb-who:has(.kb-who-h:has-text("鈴木"))', mbox = col('todo') + ' .kb-who:has(.kb-who-h:has-text("自分"))';
  ok('全員の ToDo: 鈴木さん（6件）の見出しの中で 5件まで、「ほか 1件を表示」', (await y.locator(sbox + ' .kb-card').count()) === 5 && (await y.locator(sbox + ' > .kb-more').innerText()).includes('ほか 1件を表示'));
  ok('全員の ToDo: 自分（7件）の見出しの中でも 5件まで', (await y.locator(mbox + ' .kb-card').count()) === 5 && (await y.locator(mbox + ' > .kb-more').innerText()).includes('ほか 2件を表示'));
  await y.click(sbox + ' > .kb-more'); await y.waitForFunction(() => document.querySelectorAll('#todo-mgr .kb-col.todo .kb-card.other').length === 6);
  ok('見出しの中の「ほか N件を表示」で、その人の分だけ全部出る（自分は畳んだまま）', (await y.locator(mbox + ' .kb-card').count()) === 5);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
