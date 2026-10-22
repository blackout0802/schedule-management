// スケジュールに入っている業務のToDoは、日報に自動で入る。
//   進行中 = 当日の項目（カレンダーに先の日付で置いたものは、その日付の日報）／未着手 = 日付が決まっているものだけ、その日付の日報
//   （カレンダーに置いた日。置いていなければ期限日）／保留は入れない。日報から消した行は、入れ直さない。同じ文言の行があれば、足さない。
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e))); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const memo = () => p.evaluate(async () => (await fetch('api.php?action=memo_get')).json());
  const { cur, next } = await memo();
  const far = addDays(next, 60), after = addDays(next, 10);
  const mk = async (title, o) => {
    const t = (await api('todo_save', Object.assign({ title, kind: 'work', tag: '個人作業' }, o.due ? { due: o.due } : {}))).todo;
    if (o.sched) await api('todo_schedule', { id: t.id, date: o.sched });
    if (o.status) await api('todo_status', { id: t.id, status: o.status });
    return t;
  };
  const A = await mk('自動A進行中', { status: 'doing' });
  const B = await mk('自動B未着手期限が当日', { due: cur });
  await mk('自動C未着手日付なし', {});
  const D = await mk('自動D未着手で次回に置いた', { sched: next, status: 'todo' });
  await mk('自動E保留', { status: 'hold' });
  await mk('自動F進行中で遠い日', { sched: far });
  await mk('自動G未着手期限が先', { due: after });
  const H = await mk('自動H進行中で次回に置いた', { sched: next });
  await mk('自動I進行中で当日に置いた', { sched: cur });
  await mk('自動J未着手で当日に置いた', { sched: cur, status: 'todo' });
  await mk('自動K手書きと同じ', { status: 'doing' });
  await mk('自動L完了', { status: 'done' });
  await p.reload(); await p.waitForSelector('.cal');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single'); await p.waitForSelector('#todo-mgr');
  const items = (kind) => p.evaluate((kind) => {
    const h = document.querySelector('.memo-single div[data-md=' + kind + ']'); const out = [];
    let d = h.nextElementSibling; if (d && !d.textContent.trim()) d = d.nextElementSibling;
    while (d && d.textContent.trim() && !d.hasAttribute('data-md')) { out.push(d.textContent + (d.querySelector('s') ? '[s]' : '') + (d.hasAttribute('data-tr') ? '[tr]' : '')); d = d.nextElementSibling; }
    return out;
  }, kind);
  const has = (list, t) => list.some(x => x.startsWith(t));
  await p.waitForFunction(() => Array.from(document.querySelectorAll('.memo-single div[data-todo]')).some(d => d.textContent === '自動A進行中'));
  let c = await items('cur'), n = await items('next');
  ok('進行中のToDoは、当日の項目に自動で入る', has(c, '自動A進行中'), c);
  ok('未着手でも、期限日が当日なら、当日の項目に入る', has(c, '自動B未着手期限が当日'), c);
  ok('未着手で日付がなければ、入らない（当日にも次回出勤日にも）', !has(c, '自動C') && !has(n, '自動C'), [c, n]);
  ok('未着手で次回出勤日に置いたものは、次回出勤日の項目に入る（当日には入らない）', has(n, '自動D未着手で次回に置いた') && !has(c, '自動D'), [c, n]);
  ok('保留は入らない', !has(c, '自動E') && !has(n, '自動E'), [c, n]);
  ok('進行中でも、遠い日付に置いてあるものは、まだ入らない', !has(c, '自動F') && !has(n, '自動F'), [c, n]);
  ok('未着手で、期限日が先のものは、入らない', !has(c, '自動G') && !has(n, '自動G'), [c, n]);
  ok('進行中で、次回出勤日に置いたものは、次回出勤日の項目に入る', has(n, '自動H進行中で次回に置いた') && !has(c, '自動H'), [c, n]);
  ok('進行中で、当日に置いたものは、当日の項目に入る', has(c, '自動I進行中で当日に置いた'), c);
  ok('未着手で、当日に置いたものは、当日の項目に入る', has(c, '自動J未着手で当日に置いた'), c);
  ok('完了は、自動では入らない（完了にした瞬間に、取り消し線つきで入る）', !has(c, '自動L'), c);
  ok('当日の未着手・進行中は、次回出勤日にも転記される（取り消し線なしのため）', has(n, '自動A進行中[tr]'), n);
  ok('同じToDoを、2回は入れない', c.filter(x => x.startsWith('自動A進行中')).length === 1 && n.filter(x => x.startsWith('自動A進行中')).length === 1, [c, n]);

  // 保存される・開き直しても増えない
  await p.waitForTimeout(1500); await p.reload(); await p.waitForSelector('.memo-single');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('.memo-single div[data-todo]')).some(d => d.textContent === '自動A進行中'));
  await p.waitForTimeout(600);
  c = await items('cur'); n = await items('next');
  ok('開き直しても、日報に残り、増えない', c.filter(x => x.startsWith('自動A進行中')).length === 1 && c.filter(x => x.startsWith('自動B')).length === 1 && n.filter(x => x.startsWith('自動D')).length === 1, [c, n]);
  const saved = (await memo()).html;
  ok('日付の行に、自動で入れたToDoの控え（data-auto）が保存される', /data-md="cur"[^>]*data-auto="[0-9:,-]+"/.test(saved), saved.slice(0, 300));

  // 日報から消した行は、入れ直さない
  await p.evaluate(() => { const d = Array.from(document.querySelectorAll('.memo-single div[data-todo]')).find(x => x.textContent === '自動B未着手期限が当日' && !x.hasAttribute('data-tr')); d.remove(); d.ownerDocument.querySelector('.memo-single').dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(1500);
  await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(1200);
  c = await items('cur'); n = await items('next');
  ok('日報から消した行は、開き直しても入れ直されない', !has(c, '自動B') && !has(n, '自動B'), [c, n]);

  // ToDoの状態が変われば、行も追従する（進行中 → 完了で取り消し線）
  await api('todo_status', { id: A.id, status: 'done' });
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(1200);
  c = await items('cur');
  ok('完了にすると、自動で入った行にも取り消し線が付く', has(c, '自動A進行中[s]'), c);

  // 手書きの同じ文言の行があれば、足さない（新しいToDoで確かめる）
  const M = await mk('自動M手書きあり', {});
  await p.evaluate(() => { const ed = document.querySelector('.memo-single'); const h = ed.querySelector('div[data-md=cur]'); const d = document.createElement('div'); d.textContent = '自動M手書きあり'; h.nextElementSibling.after(d); ed.dispatchEvent(new Event('input', { bubbles: true })); });
  await api('todo_status', { id: M.id, status: 'doing' });
  await p.waitForTimeout(1500); await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(1200);
  c = await items('cur');
  ok('日報に同じ文言の行を自分で書いてあれば、重ねて足さない', c.filter(x => x.startsWith('自動M手書きあり')).length === 1, c);

  // プライベートのToDoは、日報に入れない
  const P = (await api('todo_save', { title: '自動N私用', kind: 'private' })).todo; await api('todo_status', { id: P.id, status: 'doing' });
  await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(1200);
  c = await items('cur'); n = await items('next');
  ok('プライベートのToDoは、入らない（日報は業務）', !has(c, '自動N') && !has(n, '自動N'), [c, n]);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
