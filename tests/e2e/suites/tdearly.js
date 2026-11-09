// 早めに完了（v1.107.0）: ToDo と結びついた複数日の予定を、期間の途中で完了にすると、終了日が完了した日（今日）になる。
// 完了を取り消すと、元の終了日に戻る。カンバンの「完了」・予定の詳細の「ToDoの状態」のどちらからでも。開始日より前の完了では変えない。
// 日付は「今日」から数えるので、どの日に流しても同じ結果になる
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { sql } = require('../lib/env');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const md = s => (+s.slice(5, 7)) + '/' + (+s.slice(8, 10));
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const mk = (title, s, e) => api('event_save', { kind: 'work', title, tag: '個人作業', start: s, end: e, todo_status: 'doing' }); // 「ToDoリストにも入れる（進行中）」
  const endOf = title => sql(`SELECT end_date FROM events WHERE title = '${title}'`);
  await mk('早めに終わる作業', day(-1), day(3));
  await mk('来週からの作業', day(2), day(4));
  await p.evaluate(() => localStorage.setItem('sched.doneOpen', 'true')); await p.reload(); await p.waitForSelector('.cal');
  // カンバンで「完了」
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr .kb-col.doing .kb-card:has-text("早めに終わる作業")');
  await p.click('#todo-mgr .kb-col.doing .kb-card:has-text("早めに終わる作業") button:has-text("完了")');
  await p.waitForSelector('.toast:has-text("早めに完了したので")');
  ok('期間の途中で完了にすると、予定の終了日が今日になり、そのことを知らせる', endOf('早めに終わる作業') === day(0) && (await p.locator('.toast:has-text("早めに完了したので")').innerText()).includes(md(day(0))), [endOf('早めに終わる作業'), day(0)]);
  ok('ToDo は、完了の列に移る', await p.locator('#todo-mgr .kb-col.done .kb-card:has-text("早めに終わる作業")').count() === 1);
  // 取り消す（完了 → 未着手）
  await p.click('#todo-mgr .kb-col.done .kb-card:has-text("早めに終わる作業") button:has-text("戻す")');
  await p.waitForSelector('.toast:has-text("元の")');
  ok('完了を取り消すと、元の終了日に戻る', endOf('早めに終わる作業') === day(3), endOf('早めに終わる作業'));
  // 開始日より前の完了では、変えない
  await p.click('#todo-mgr .kb-col.doing .kb-card:has-text("来週からの作業") button:has-text("完了")'); await p.waitForSelector('.toast:has-text("完了にしました: 来週からの作業")');
  ok('開始日より前に完了したときは、予定の日付を変えない（知らせも出ない）', endOf('来週からの作業') === day(4) && (await p.locator('.toast:has-text("来週からの作業」の終了日")').count()) === 0);
  // 予定の詳細の「ToDoの状態」から
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.cal');
  await p.locator('.cal .bar:has-text("早めに終わる作業")').first().click(); await p.waitForSelector('.modal');
  await p.click('.modal button.st-done'); await p.waitForSelector('.toast:has-text("早めに完了したので")');
  ok('予定の詳細の「ToDoの状態」で完了にしても、終了日が今日になる', endOf('早めに終わる作業') === day(0), endOf('早めに終わる作業'));
  await p.waitForFunction(() => !document.querySelector('.modal')); // 状態を押すと、予定の画面は閉じる（これまでどおり）
  await p.locator('.cal .bar:has-text("早めに終わる作業")').first().click(); await p.waitForSelector('.modal button.st-doing');
  await p.click('.modal button.st-doing'); await p.waitForSelector('.toast:has-text("元の")');
  ok('予定の詳細で「進行中」に戻すと、元の終了日に戻る', endOf('早めに終わる作業') === day(3), endOf('早めに終わる作業'));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
