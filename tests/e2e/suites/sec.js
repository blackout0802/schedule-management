// セキュリティ: 外のサイトのリンク（GET）だけで書き換えられない・読むだけの操作は GET でも使える・
//               パスワードを変えると、ほかの端末のログインが終わる・日報に危険なタグを保存しても無害
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { BASE } = require('../lib/env');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const mk = async () => { const p = await (await b.newContext()).newPage(); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
  const p = await mk();
  const csrf = () => p.evaluate(() => document.getElementById('app').dataset.csrf);
  const post = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return [r.status, await r.json().catch(() => null)]; }, [a, body]);
  const get = a => p.evaluate(async (a) => { const r = await fetch('api.php?action=' + a); return r.status; }, a);
  // 日報と、完了済みのToDoを用意
  const t1 = await post('todo_save', { title: '消えてはいけない完了ToDo', kind: 'private' });
  await post('todo_status', { id: t1[1].todo ? t1[1].todo.id : t1[1].id, status: 'done' });
  await post('memo_save', { html: '<div>大事な日報</div>' });
  // 外のサイトのリンクを踏んだ（GET）つもり
  for (const a of ['memo_save', 'todo_clear_done', 'prefs_save', 'share_options', 'todo_delete', 'event_save', 'user_save', 'series_seed']) {
    ok(`GET では「${a}」を実行できない（405）`, (await get(a)) === 405, await get(a));
  }
  const memoOf = () => p.evaluate(async () => { const j = await (await fetch('api.php?action=memo_get')).json(); return (j.html || '') + ((j.seed && j.seed.old) || ''); }); // 日付の行がない文章は、引き継ぎ元（seed）として返る
  const memo = await memoOf();
  ok('日報は、書き換えられていない', memo.includes('大事な日報'), memo);
  const todos = await p.evaluate(async () => (await (await fetch('api.php?action=todo_list&view=me')).json()).done.map(t => t.title));
  ok('完了のToDoも、消されていない', todos.includes('消えてはいけない完了ToDo'), todos);
  for (const a of ['me', 'events&from=2026-01-01&to=2026-01-31&view=team', 'todo_list&view=me', 'memo_get', 'share_list']) ok(`読むだけの「${a.split('&')[0]}」は、GET で使える`, (await get(a)) === 200, await get(a));
  ok('トークンなしの POST は、拒否（403）', (await p.evaluate(async () => (await fetch('api.php?action=memo_save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"html":""}' })).status)) === 403);
  ok('日報の内容が無い保存は、拒否', (await post('memo_save', {}))[0] === 400);
  // 日報に危険なタグを保存しても、文字になる
  await post('memo_save', { html: '< script>alert(1)< /script><div onclick="x()">a</div>< img src=x onerror=y>' });
  const saved = await memoOf();
  const bad = await p.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return Array.from(d.body.querySelectorAll('*')).filter(e => !['DIV', 'BR', 'S'].includes(e.tagName) || e.attributes.length).length; }, saved);
  ok('日報に保存された内容は、文字になり、危険なタグ・属性は残らない', bad === 0 && saved.includes('alert(1)'), saved);
  // パスワードを変えると、ほかの端末のログインが終わる
  const p2 = await mk();
  ok('別の端末も、ログインできている', (await p2.evaluate(async () => (await fetch('api.php?action=me')).status)) === 200);
  const ch = await post('password_change', { current_password: 'yamadapass1', new_password: 'yamadapass2-new' });
  ok('パスワードを変えられる', ch[0] === 200, ch);
  ok('変えた端末は、そのまま使える', (await p.evaluate(async () => (await fetch('api.php?action=me')).status)) === 200);
  ok('ほかの端末のログインは、終わる（401）', (await p2.evaluate(async () => (await fetch('api.php?action=me')).status)) === 401);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
