// 完了の列: 全員の ToDo を出していて、他の人の完了もあるときは、人ごとに分けて畳んで出す（見出しを押すと開く）。自分の ToDo だけのときは、これまでどおり
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
async function login(b, email, pw) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p;
}
const api = (p, a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
(async () => {
  const b = await chromium.launch();
  const y = await login(b, 'yamada@example.com', 'yamadapass1'); const s = await login(b, 'suzuki@example.com', 'suzukipass1');
  for (const [p, t] of [[y, '山田の完了A'], [y, '山田の完了B'], [s, '鈴木の完了C']]) { const td = (await api(p, 'todo_save', { title: t, kind: 'work', tag: '個人作業' })).todo; await api(p, 'todo_status', { id: td.id, status: 'done' }); }
  await y.evaluate(() => localStorage.setItem('sched.doneOpen', 'true')); await y.reload(); await y.waitForSelector('.cal');
  await y.click('.seg label:has-text("リスト")'); await y.waitForSelector('#todo-mgr .kb-col.done');
  await y.selectOption('#todo-mgr .todo-who select', 'all'); await y.waitForSelector('#todo-mgr .kb-col.done .kb-who-h');
  const heads = await y.locator('#todo-mgr .kb-col.done .kb-who-h').allInnerTexts();
  ok('全員の ToDo: 完了は、人ごとの見出し（件数つき）で、畳んで出る', heads.length === 2 && heads[0].includes('自分') && heads[0].includes('2') && heads[1].includes('鈴木 一郎さん') && heads[1].includes('1') && (await y.locator('#todo-mgr .kb-col.done .kb-card').count()) === 0, heads);
  await y.click('#todo-mgr .kb-col.done .kb-who-h:has-text("鈴木")'); await y.waitForSelector('#todo-mgr .kb-col.done .kb-card:has-text("鈴木の完了C")');
  ok('見出しを押すと、その人の完了だけが開く', (await y.locator('#todo-mgr .kb-col.done .kb-card').count()) === 1);
  await y.evaluate(() => window.dispatchEvent(new Event('focus'))); await y.waitForTimeout(1500);
  ok('自動更新で描き直しても、開いたまま', (await y.locator('#todo-mgr .kb-col.done .kb-card:has-text("鈴木の完了C")').count()) === 1);
  await y.selectOption('#todo-mgr .todo-who select', 'me'); await y.waitForSelector('#todo-mgr .kb-col.done .kb-card:has-text("山田の完了A")');
  ok('自分の ToDo だけのときは、これまでどおり（分けない）', (await y.locator('#todo-mgr .kb-col.done .kb-who-h').count()) === 0 && (await y.locator('#todo-mgr .kb-col.done .kb-card').count()) === 2);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
