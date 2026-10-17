const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const M = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
const BASE = 'http://127.0.0.1:8099/';
(async () => { const b = await chromium.launch();
  const mk = async (opts) => { const c = await b.newContext(opts || { viewport: { width: 1280, height: 1000 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept()); return p; };
  const login = async (p, em, pw) => { await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); };
  const post = (p, act, body) => p.evaluate(async ([act, body]) => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify(body) }); return [r.status, await r.json()]; }, [act, body]);
  const a = await mk(); await login(a, 'admin@example.com', 'adminpass1'); const y = await mk(); await login(y, 'yamada@example.com', 'yamadapass1');
  // ---- 操作を行う
  const uid = (await a.evaluate(async () => (await (await fetch('api.php?action=me')).json()).users.find(u => u.name.includes('山田')).id));
  const e1 = (await post(a, 'event_save', { kind: 'work', title: 'A社 打ち合わせ', tag: '打ち合わせ', start: `${M}-20`, end: `${M}-20`, owner_id: uid }))[1].event;
  await post(a, 'event_save', { id: e1.id, kind: 'work', title: 'A社 打ち合わせ', tag: '打ち合わせ', start: `${M}-21`, end: `${M}-21`, start_time: '14:00', owner_id: uid });
  await post(a, 'event_delete', { id: e1.id });
  await post(y, 'event_save', { kind: 'private', title: '歯医者の予約（秘密）', start: `${M}-22`, end: `${M}-22` });
  await post(y, 'event_save', { kind: 'off', title: '', tag: '有給', start: `${M}-23`, end: `${M}-23` });
  await post(a, 'holiday_save', { hdate: `${M}-27`, name: '創立記念日' });
  await post(a, 'user_reset_password', { id: uid });
  await post(a, 'share_create', { kind: 'company' });
  await a.reload(); await a.waitForSelector('.cal');
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-audit .audit-item');
  ok('変更履歴は、初めは直近の5件だけ出る（残りはボタンで）', (await a.locator('#set-audit .audit-item').count()) === 5 && (await a.locator('#set-audit button:has-text("古い履歴を表示する")').isVisible()));
  for (let g = 0; g < 8 && await a.locator('#set-audit button:has-text("古い履歴を表示する")').isVisible(); g++) { const n = await a.locator('#set-audit .audit-item').count(); await a.click('#set-audit button:has-text("古い履歴を表示する")'); await a.waitForFunction(k => document.querySelectorAll('#set-audit .audit-item').length > k, n); }
  const txt = await a.locator('#set-audit').innerText();
  ok('設定のページに、変更履歴の項目がある（管理者）', (await a.locator('#set-audit').count()) === 1);
  ok('予定の追加・変更・削除が出る（操作した人・対象・内容つき）', txt.includes('A社 打ち合わせ') && txt.includes('追加') && txt.includes('削除') && txt.includes('管理者 太郎') && txt.includes('対象: 山田 花子') && txt.includes('時刻 時刻なし → 14:00'), txt);
  ok('山田さんが登録した休みは、山田さんが操作した人で出る', txt.includes('山田 花子') && txt.includes('休み｜有給'));
  ok('休業日・パスワードのリセット・共有リンクの作成が出る', txt.includes('創立記念日') && txt.includes('パスワードをリセット') && txt.includes('会社用リンクを作成'));
  ok('プライベートの予定（件名）は、出ない', !txt.includes('歯医者の予定') && !txt.includes('歯医者の予約'));
  // 絞り込み
  await a.selectOption('#set-audit select[aria-label=種類]', 'holiday'); await a.waitForFunction(() => document.querySelectorAll('#set-audit .audit-item').length === 1);
  ok('種類で絞り込める（休業日）', (await a.locator('#set-audit .audit-item').innerText()).includes('創立記念日'));
  await a.selectOption('#set-audit select[aria-label=種類]', ''); await a.selectOption('#set-audit select[aria-label=操作した人]', { label: '山田 花子' }); await a.waitForFunction(() => [...document.querySelectorAll('#set-audit .audit-item')].every(e => e.innerText.includes('山田 花子')) && document.querySelectorAll('#set-audit .audit-item').length >= 1);
  ok('操作した人で絞り込める', (await a.locator('#set-audit .audit-item').count()) === 1);
  await a.selectOption('#set-audit select[aria-label=操作した人]', ''); await a.fill('#set-audit input[type=search]', 'リセット'); await a.waitForFunction(() => document.querySelectorAll('#set-audit .audit-item').length === 1);
  ok('検索で絞り込める', (await a.locator('#set-audit .audit-item').innerText()).includes('パスワードをリセット'));
  await a.fill('#set-audit input[type=search]', 'そんな履歴はない'); await a.waitForSelector('#set-audit .audit-list .muted'); ok('該当なしの案内が出る', true); await a.fill('#set-audit input[type=search]', ''); await a.waitForSelector('#set-audit .audit-item');
  // ページ送り（60件追加）
  for (let i = 0; i < 60; i++) await post(a, 'holiday_save', { hdate: `2032-0${1 + (i % 9)}-${pad(1 + Math.floor(i / 9))}`, name: '履歴多数' + i });
  await a.click('#set-audit button:has-text("最新の状態にする")'); await a.waitForFunction(() => document.querySelectorAll('#set-audit .audit-item').length === 5);
  await a.click('#set-audit button:has-text("古い履歴を表示する")'); await a.waitForFunction(() => document.querySelectorAll('#set-audit .audit-item').length === 55);
  ok('初めの5件のあと、50件ずつ読み込まれ、「古い履歴を表示する」が出る', (await a.locator('#set-audit button:has-text("古い履歴を表示する")').isVisible()));
  await a.click('#set-audit button:has-text("古い履歴を表示する")'); await a.waitForFunction(() => document.querySelectorAll('#set-audit .audit-item').length > 50); ok('押すと、続きが読み込まれる', (await a.locator('#set-audit .audit-item').count()) > 50);
  // 権限
  const y3 = await mk(); await login(y3, 'suzuki@example.com', 'suzukipass1'); // 山田さんは、パスワードをリセットされて、前のログインは終わっているので、別の一般社員で確かめる
  await y3.click('header button:has-text("設定")'); await y3.waitForSelector('.settings-page'); ok('一般の社員の設定には、変更履歴は出ない', (await y3.locator('#set-audit').count()) === 0);
  const forb = await y3.evaluate(async () => (await fetch('api.php?action=audit_list')).status); ok('一般の社員は、変更履歴のAPIを使えない（403）', forb === 403, forb);
  // スマホ幅で、はみ出さない
  const ph = await mk({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await login(ph, 'admin@example.com', 'adminpass1'); await ph.click('header button:has-text("設定")'); await ph.waitForSelector('#set-audit'); if (await ph.locator('#set-audit.collapsible:not(.open)').count()) await ph.click('#set-audit > h3'); await ph.waitForSelector('#set-audit .audit-item'); await ph.waitForTimeout(500);
  ok('スマホ幅でも、横にはみ出さない', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await ph.locator('#set-audit').scrollIntoViewIfNeeded(); await ph.screenshot({ path: 'audit-phone.png' });
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); })();
