// 未着手・進行中・保留の列も、全員の ToDo のときは、人ごとの見出しに分ける（その人の ToDo がない列には、見出しを出さない）。
// 初めは、自分は開いて、他の人は畳む。見出しで開閉し、列ごとに覚える。畳んだ他の人の見出しに、新しいコメントの目印。自分の ToDo だけのときは、これまでどおり
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
  const add = async (p, title, status) => { const td = (await api(p, 'todo_save', { title, kind: 'work', tag: '個人作業' })).todo; if (status !== 'todo') await api(p, 'todo_status', { id: td.id, status }); return td; };
  await add(y, '山田の未着手A', 'todo'); await add(y, '山田の進行中B', 'doing');
  await add(s, '鈴木の未着手C', 'todo'); const sh = await add(s, '鈴木の保留D', 'hold');
  await api(s, 'todo_comment_add', { id: sh.id, body: '状況のメモ' }); // 山田から見ると、新しいコメント
  await y.reload(); await y.waitForSelector('.cal');
  await y.click('.seg label:has-text("リスト")'); await y.waitForSelector(col('todo'));
  await y.selectOption('#todo-mgr .todo-who select', 'all'); await y.waitForSelector(col('todo') + ' .kb-who-h');
  const heads = async st => y.locator(col(st) + ' .kb-who-h').allInnerTexts();
  const ht = await heads('todo');
  ok('未着手: 人ごとの見出し（件数つき）。自分は開いて、他の人は畳む', ht.length === 2 && ht[0].includes('自分') && ht[0].includes('1') && ht[1].includes('鈴木 一郎さん') && ht[1].includes('1')
    && (await y.locator(col('todo') + ' .kb-card:has-text("山田の未着手A")').count()) === 1 && (await y.locator(col('todo') + ' .kb-card.other').count()) === 0, ht);
  ok('ToDo のない人（管理者）は、見出しを出さない', !ht.some(h => h.includes('管理者')));
  const hh = await heads('hold');
  ok('保留: 自分の ToDo がない列には「自分」の見出しを出さない（鈴木さんだけ）', hh.length === 1 && hh[0].includes('鈴木 一郎さん') && (await y.locator(col('hold') + ' .kb-card').count()) === 0, hh);
  ok('畳んだ見出しに、新しいコメントの目印', (await y.locator(col('hold') + ' .kb-who-h .pill.tc.new').count()) === 1 && (await y.locator(col('todo') + ' .kb-who-h .pill.tc.new').count()) === 0);
  ok('進行中: 他の人の ToDo がない列は、これまでどおり（見出しなし）', (await y.locator(col('doing') + ' .kb-who-h').count()) === 0 && (await y.locator(col('doing') + ' .kb-card:has-text("山田の進行中B")').count()) === 1);
  ok('「他の人のToDo」の区切りは出ない', (await y.locator('#todo-mgr .kb-others-h').count()) === 0);
  await y.screenshot({ path: 'kbwho-closed.png', fullPage: true });
  // 見出しで開く（列ごと）
  await y.click(col('todo') + ' .kb-who-h:has-text("鈴木")'); await y.waitForSelector(col('todo') + ' .kb-card.other:has-text("鈴木の未着手C")');
  ok('見出しを押すと、その列の、その人の ToDo が開く（ほかの列は畳んだまま）', (await y.locator(col('hold') + ' .kb-card').count()) === 0);
  await y.evaluate(() => window.dispatchEvent(new Event('focus'))); await y.waitForTimeout(1500);
  ok('自動更新で描き直しても、開いたまま', (await y.locator(col('todo') + ' .kb-card.other:has-text("鈴木の未着手C")').count()) === 1);
  await y.click(col('hold') + ' .kb-who-h:has-text("鈴木")'); await y.waitForSelector(col('hold') + ' .kb-card.other:has-text("鈴木の保留D")');
  ok('開くと、見出しの新着の目印は消え、カードに出る', (await y.locator(col('hold') + ' .kb-who-h .pill.tc.new').count()) === 0 && (await y.locator(col('hold') + ' .kb-card.other .pill.tc.new').count()) === 1);
  // 自分を畳む・開く
  await y.click(col('todo') + ' .kb-who-h:has-text("自分")'); await y.waitForFunction(() => !document.querySelector('#todo-mgr .kb-col.todo .kb-card:not(.other)'));
  ok('自分の見出しを押すと、自分の ToDo が畳まれる', (await y.locator(col('todo') + ' .kb-card:has-text("山田の未着手A")').count()) === 0);
  await y.click(col('todo') + ' .kb-who-h:has-text("自分")'); await y.waitForSelector(col('todo') + ' .kb-card:has-text("山田の未着手A")');
  // 自分のカードは、これまでどおり動かせる
  await y.click(col('todo') + ' .kb-card:has-text("山田の未着手A") button:has-text("進行中へ")');
  await y.waitForSelector(col('doing') + ' .kb-card:has-text("山田の未着手A")');
  const ht2 = await heads('todo');
  ok('自分のカードを進行中へ移せる。未着手に自分の ToDo がなくなると「自分」の見出しも消える', ht2.length === 1 && ht2[0].includes('鈴木'), ht2);
  await y.screenshot({ path: 'kbwho.png', fullPage: true });
  // 自分の ToDo だけ
  await y.selectOption('#todo-mgr .todo-who select', 'me'); await y.waitForSelector(col('doing') + ' .kb-card:has-text("山田の進行中B")');
  ok('自分の ToDo だけのときは、これまでどおり（見出しなし）', (await y.locator('#todo-mgr .kb-who-h').count()) === 0 && (await y.locator(col('doing') + ' .kb-card').count()) === 2);
  // 特定の人だけ（鈴木さん）: 一人なので、見出しで分けない
  await y.selectOption('#todo-mgr .todo-who select', { label: '鈴木 一郎さん' }); await y.waitForSelector(col('todo') + ' .kb-card.other:has-text("鈴木の未着手C")');
  ok('特定の人を選んだときは、分けない（これまでどおり）', (await y.locator('#todo-mgr .kb-who-h').count()) === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
