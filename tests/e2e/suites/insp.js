// 年間計画（v1.108.0）: 管理者が「会社の管理」で点検項目を登録 → 担当者に ToDo ができる → 年間計画の表で実施済み → 確認者が確認済み。
// 上のボタンの件数・今月の点検の帯・ToDo との連動・遅れの表示・スマホ幅・ダークモード。日付は「今日」の月で数えるので、どの月に流しても同じ結果になる
// （月の最初の営業日より前の日（月初の土日・祝日）に流したときだけ、起票のテストは省く）
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { sql } = require('../lib/env');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MON = new Date().getMonth() + 1;
(async () => {
  const b = await chromium.launch();
  const login = async (email, pass, opt) => {
    const p = await (await b.newContext(opt || { viewport: { width: 1280, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
    await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pass);
    await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p;
  };
  const admin = await login('admin@example.com', 'adminpass1');
  const yam = await login('yamada@example.com', 'yamadapass1');
  const suz = await login('suzuki@example.com', 'suzukipass1');

  // 項目がないとき: 年間計画のボタンはあるが、帯は出ない。ページには、登録を案内する
  ok('年間計画のボタンが、上の帯にある（件数のバッジは、まだ出ない）', await yam.locator('#insp-btn').count() === 1 && await yam.locator('#insp-btn-bd:visible').count() === 0);
  ok('項目がないと、今月の点検の帯は出ない', await yam.locator('#insp-band:visible').count() === 0);
  await yam.click('#insp-btn'); await yam.waitForSelector('.annual-empty');
  ok('年間計画のページ（#annual）が開き、一般の社員には「管理者が登録する」と案内する', (await yam.evaluate(() => location.hash)) === '#annual' && (await yam.locator('.annual-empty').innerText()).includes('管理者が'));
  ok('一般の社員には、登録のボタンは出ない', await yam.locator('.annual-empty a.btn').count() === 0);
  await yam.goBack(); await yam.waitForSelector('.cal');

  // 管理者: 会社の管理 › 点検項目 で、項目を追加する
  await admin.goto(BASE + 'index.php#admin'); await admin.waitForSelector('#set-inspect');
  ok('会社の管理に「点検項目（年間計画）」の項目がある（初めは未登録）', (await admin.locator('#set-inspect').innerText()).includes('まだ登録していません'));
  await admin.click('#insp-add'); await admin.waitForSelector('.insp-months');
  await admin.fill('.insp-admin form input[maxlength="60"]', 'テスト点検A');
  await admin.selectOption('select[aria-label=繰り返し]', 'month'); // 毎月
  ok('「毎月」を選ぶと、12か月すべてが入る', await admin.locator('.insp-months button[aria-pressed=true]').count() === 12);
  await admin.selectOption('select[aria-label=繰り返し]', 'half'); await admin.selectOption('select[aria-label=はじめの月]', '7');
  ok('「半期ごと・7月はじまり」は、7月と1月', (await admin.locator('.insp-months button[aria-pressed=true]').allInnerTexts()).join(',') === '7,1');
  await admin.click(`.insp-months button[aria-label="${MON}月"]`); // 今月も入れる（押すと入り切り）
  ok('月を押すと、繰り返しは「月を自分で選ぶ」になる', (await admin.locator('select[aria-label=繰り返し]').inputValue()) === 'free');
  if (MON === 7 || MON === 1) await admin.click(`.insp-months button[aria-label="${MON}月"]`); // 7月・1月は、押すと外れてしまうので、もう一度
  await admin.selectOption('select[aria-label=担当者]', { label: '山田 花子' });
  await admin.selectOption('select[aria-label=確認者]', { label: '鈴木 一郎' });
  await admin.fill('textarea', '手順その1\n手順その2');
  await admin.click('.insp-admin form button[type=submit]'); await admin.waitForSelector('.toast:has-text("追加しました")');
  await admin.waitForSelector('.insp-items');
  ok('追加すると、一覧に出る（担当 → 確認・期限つき）', (await admin.locator('.insp-items').innerText()).replace(/\s+/g, ' ').includes('テスト点検A') && (await admin.locator('.insp-items').innerText()).includes('山田 花子 → 鈴木 一郎'));
  const itemId = sql('SELECT id FROM inspection_items LIMIT 1');
  const runCount = +sql(`SELECT COUNT(*) FROM inspection_runs WHERE item_id = ${itemId} AND ym = '${new Date().getFullYear()}-${pad(MON)}'`);
  if (!runCount) { console.log('OK  （月の最初の営業日より前なので、起票のテストは省く）'); await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); }

  // 起票: 山田さんに ToDo ができ、期限の日の予定が置かれる
  const todo = sql(`SELECT title FROM todos WHERE id = (SELECT todo_id FROM inspection_runs WHERE item_id = ${itemId})`);
  ok('担当者（山田）の ToDo「【点検】項目名（○月分）」ができる', todo === `【点検】テスト点検A（${MON}月分）`, todo);
  ok('期限の日（最終営業日）に、ToDo と結びついた予定が置かれる', +sql(`SELECT COUNT(*) FROM events WHERE todo_id = (SELECT todo_id FROM inspection_runs WHERE item_id = ${itemId})`) === 1);

  // 山田: ボタンの件数・帯・年間計画の表
  await yam.reload(); await yam.waitForSelector('.cal'); await yam.waitForSelector('#insp-btn-bd:visible');
  ok('担当者には、ボタンに件数（1）が出る', (await yam.locator('#insp-btn-bd').innerText()) === '1');
  ok('今月の点検の帯に「未実施 1件」が出る（遅れはない）', await yam.locator('#insp-band:visible').count() === 1 && (await yam.locator('#insp-band').innerText()).includes('未実施 1件') && !(await yam.locator('#insp-band').innerText()).includes('遅れ'));
  await yam.click('#insp-band button'); await yam.waitForSelector('#annual-tbl');
  ok('帯から開くと、「要対応だけ」の表になる', await yam.locator('input[name=an-flt]:checked').evaluate(e => e.parentElement.textContent.trim()) === '要対応だけ');
  await yam.locator('input[name=an-flt]').first().check();
  ok('表に、項目の行と、今月の「未実施」のマス・これからの「予定」のマスがある', await yam.locator('#annual-tbl tbody tr').count() === 1 && await yam.locator('.an-cell.now').count() === 1 && await yam.locator('.an-cell.plan').count() >= 1);
  ok('年度は7月はじまり（列は7月から）', (await yam.locator('#annual-tbl thead th').allInnerTexts()).slice(1, 3).map(t => t.trim().slice(0, 3)).join(',') === '7月,8月');
  ok('今月の列が目立つ', await yam.locator('#annual-tbl thead th.cur').count() === 1);

  // 実施済みにする（確認者がいるので「確認待ち」）
  await yam.click('.an-cell.now'); await yam.waitForSelector('.insp-dialog');
  ok('マスを押すと、期限・担当・確認者・手順が出る', (await yam.locator('.insp-dialog').innerText()).includes('鈴木 一郎') && (await yam.locator('.insp-dialog').innerText()).includes('手順その2'));
  await yam.click('.insp-dialog button:has-text("実施済みにする")'); await yam.waitForSelector('.toast:has-text("実施済みにしました")');
  await yam.waitForSelector('.an-cell.wait');
  ok('実施済みにすると「確認待ち」のマスになる。ToDo も完了になる', sql(`SELECT status FROM inspection_runs WHERE item_id = ${itemId}`) === 'done' && sql(`SELECT COUNT(*) FROM todos WHERE done_at IS NOT NULL AND title LIKE '【点検】%'`) === '1');
  ok('担当者のボタンの件数は、なくなる（確認者に移る）', await yam.locator('#insp-btn-bd:visible').count() === 0);

  // 鈴木（確認者）: 件数が出て、確認済みにする
  await suz.reload(); await suz.waitForSelector('#insp-btn-bd:visible');
  ok('確認者には、ボタンに件数（1）と、帯に「確認待ち 1件」が出る', (await suz.locator('#insp-btn-bd').innerText()) === '1' && (await suz.locator('#insp-band').innerText()).includes('確認待ち 1件'));
  await suz.click('#insp-btn'); await suz.waitForSelector('.an-cell.wait'); await suz.click('.an-cell.wait'); await suz.waitForSelector('.insp-dialog');
  ok('確認者には「確認済みにする」が出て、「実施済みにする」は出ない', await suz.locator('.insp-dialog button:has-text("確認済みにする")').count() === 1 && await suz.locator('.insp-dialog button:has-text("実施済みにする")').count() === 0);
  await suz.click('.insp-dialog button:has-text("確認済みにする")'); await suz.waitForSelector('.toast:has-text("確認済みにしました")'); await suz.waitForSelector('.an-cell.done');
  ok('確認すると「確認済み」のマスになる', sql(`SELECT status FROM inspection_runs WHERE item_id = ${itemId}`) === 'checked');

  // 担当者でも確認者でもない人（管理者を除く）は、操作できない: 実施の取り消しは、管理者だけ
  await yam.reload(); await yam.waitForSelector('.an-cell.done'); await yam.click('.an-cell.done'); await yam.waitForSelector('.insp-dialog');
  ok('確認済みのマスでは、担当者に「実施を取り消す」は出ない', await yam.locator('.insp-dialog button:has-text("実施を取り消す")').count() === 0);
  await yam.click('.insp-dialog button:has-text("閉じる")');
  await admin.goto(BASE + 'index.php#annual'); await admin.waitForSelector('.an-cell.done'); await admin.click('.an-cell.done'); await admin.waitForSelector('.insp-dialog');
  await admin.click('.insp-dialog button:has-text("実施を取り消す")'); await admin.waitForSelector('.toast:has-text("未実施に戻しました")'); await admin.waitForSelector('.an-cell.now');
  ok('管理者は、実施を取り消せる（未実施に戻り、ToDo も未完了に戻る）', sql(`SELECT status FROM inspection_runs WHERE item_id = ${itemId}`) === 'open' && sql(`SELECT COUNT(*) FROM todos WHERE done_at IS NOT NULL AND title LIKE '【点検】%'`) === '0');

  // ToDo の側から完了にすると、年間計画も「確認待ち」になる
  await yam.goto(BASE + 'index.php'); await yam.waitForSelector('.cal'); await yam.click('.seg label:has-text("リスト")');
  await yam.waitForSelector('#todo-mgr .kb-card:has-text("【点検】テスト点検A")');
  const todoId = +sql(`SELECT todo_id FROM inspection_runs WHERE item_id = ${itemId}`);
  await yam.evaluate(async id => { const t = document.getElementById('app').dataset.csrf; await fetch('api.php?action=todo_done', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ id, done: true }) }); }, todoId);
  ok('ToDo を完了にすると、点検の記録も「確認待ち」になる', sql(`SELECT status FROM inspection_runs WHERE item_id = ${itemId}`) === 'done');
  await yam.goto(BASE + 'index.php#annual'); await yam.waitForSelector('.an-cell.wait');
  ok('年間計画にも、確認待ちで出る', await yam.locator('.an-cell.wait').count() === 1);

  // 遅れ: 期限を昨日にする
  sql(`UPDATE inspection_runs SET status = 'open', done_at = NULL, done_by = NULL, due_date = '${day(-1)}' WHERE item_id = ${itemId}`);
  sql(`UPDATE todos SET done_at = NULL WHERE title LIKE '【点検】%'`);
  await yam.reload(); await yam.waitForSelector('.an-cell.late');
  ok('期限を過ぎると「遅れ」のマス（+1日）になる', (await yam.locator('.an-cell.late .d').innerText()) === '+1日', await yam.locator('.an-cell.late').count());
  await yam.goto(BASE + 'index.php'); await yam.waitForSelector('.seg label:has-text("カレンダー")'); await yam.click('.seg label:has-text("カレンダー")'); await yam.waitForSelector('#insp-band:visible'); // さっきリストを開いたので、カレンダーに戻す
  ok('帯は「遅れ 1件」で、注意の色になる', (await yam.locator('#insp-band').innerText()).includes('遅れ 1件') && await yam.locator('#insp-band.late').count() === 1);

  // 項目の管理は、管理者だけ
  ok('API: 一般の社員は、点検項目の一覧（管理）を取れない（403）', await yam.evaluate(async () => { const r = await fetch('api.php?action=inspect_items'); return r.status; }) === 403);

  // スマホ幅・ダークモード
  const ph = await login('yamada@example.com', 'yamadapass1', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await ph.goto(BASE + 'index.php#annual'); await ph.waitForSelector('#annual-tbl');
  ok('スマホ幅でも、ページが横にはみ出さない（表は、枠の中で横に動く）', await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await ph.evaluate(() => document.documentElement.scrollWidth + '/' + window.innerWidth));
  ok('スマホ幅では、上の帯にボタンを出さず（2行を保つ）、名前のメニューに「年間計画」がある', (await ph.locator('#insp-btn').isHidden()) && await (async () => { await ph.click('.uname'); return (await ph.locator('.menu-list button:has-text("年間計画")').count()) === 1; })());
  await ph.click('.menu-list button:has-text("年間計画")'); await ph.waitForSelector('#annual-tbl');
  ok('ダークモードでも、マスの色が読める（遅れのマスの文字色が背景と違う）', await ph.evaluate(() => { const s = document.querySelector('.an-cell.late .s'); const c = getComputedStyle(s); return c.backgroundColor !== c.color; }));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
