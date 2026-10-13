const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const M = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
const BASE = 'http://127.0.0.1:8099/';
(async () => { const b = await chromium.launch();
  const mk = async (opts, scheme) => { const c = await b.newContext(Object.assign({ colorScheme: scheme || 'light' }, opts)); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept()); return p; };
  const login = async p => { await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); };
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const a = await mk(phone, 'dark'); await login(a);
  const post = (p, act, body) => p.evaluate(async ([act, body]) => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify(body) }); return await r.json(); }, [act, body]);
  await post(a, 'event_save', { kind: 'work', title: '全体会議', tag: '全体会議', start: `${M}-14`, end: `${M}-14`, start_time: '10:00', end_time: '11:00', note: '会議室Aで実施' });
  await post(a, 'event_save', { kind: 'off', title: '', tag: '有給', start: `${M}-14`, end: `${M}-14` });
  await post(a, 'event_save', { kind: 'work', title: '棚卸し作業', tag: 'その他', start: `${M}-13`, end: `${M}-15` });
  await post(a, 'event_save', { kind: 'private', title: '家族で外食', start: `${M}-14`, end: `${M}-14`, start_time: '19:00', family_shared: 1 });
  const sh = await a.evaluate(async () => { const tk = document.getElementById('app').dataset.csrf; const f = k => fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify({ kind: k }) }).then(x => x.json()); return [(await f('company')).path, (await f('family')).path]; });
  await a.reload(); await a.waitForSelector('.bar'); await a.waitForTimeout(400);
  // 背景: ダーク端末では黒い（自動）
  const bg = () => a.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await bg(); ok('端末がダークモードだと、自動のときは黒い背景になる', /rgb\(14, 21, 34\)/.test(dark), dark);
  // 日付を押す → ポップアップ
  await a.locator('.cell[data-date="' + `${M}-14` + '"]').click({ position: { x: 20, y: 4 } }); await a.waitForSelector('.day-list');
  const tx = await a.locator('.modal').innerText();
  ok('日付（空き）を押すと、その日の予定がポップアップで出る', tx.includes('全体会議') && tx.includes('10:00') && tx.includes('会議室Aで実施') && tx.includes('有給') && tx.includes('棚卸し作業'), tx);
  ok('見出しに、日付と曜日が出る', /\d+\/14（.）/.test(await a.locator('.modal h2, .modal .modal-title, .modal header').first().innerText().catch(() => tx)) || /\d+\/14（.）/.test(tx));
  ok('「この日に予定を追加」がある', tx.includes('この日に予定を追加'));
  await a.click('.day-item:has-text("全体会議")'); await a.waitForSelector('.modal input[name=title]'); ok('予定を押すと、編集画面が開く', (await a.inputValue('.modal input[name=title]')) === '全体会議'); await a.click('.modal button:has-text("キャンセル")'); await a.waitForFunction(() => !document.querySelector('.modal'));
  // 帯を押しても、押した日の一覧が出る（スマホ）
  await a.locator('.bar:has-text("棚卸し")').first().click({ position: { x: 10, y: 8 } }); await a.waitForSelector('.day-list'); ok('スマホでは、帯を押しても、その日の一覧が出る', (await a.locator('.modal').innerText()).includes('棚卸し作業'));
  await a.click('.modal button:has-text("この日に予定を追加")'); await a.waitForSelector('.modal input[name=title]'); ok('「この日に予定を追加」で、新規の登録画面が開く', (await a.inputValue('.modal input[name=title]')) === ''); await a.click('.modal button:has-text("キャンセル")'); await a.waitForFunction(() => !document.querySelector('.modal'));
  await a.locator('.cell[data-date="' + `${M}-22` + '"]').click({ position: { x: 20, y: 4 } }); await a.waitForSelector('.day-list, .modal .muted'); ok('予定のない日は、「予定はありません」', (await a.locator('.modal').innerText()).includes('予定はありません')); await a.click('.modal button:has-text("閉じる")');
  // 画面の色
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-theme .theme-opt');
  await a.click('#set-theme .theme-opt:has-text("ライト")'); await a.waitForTimeout(200); const light = await bg(); ok('「ライト」を選ぶと、ダーク端末でも白い背景になる', /rgb\(242, 242, 247\)/.test(light), light);
  await a.reload(); await a.waitForSelector('.settings-page'); ok('開き直しても、ライトのまま（この端末に記憶）', /rgb\(242, 242, 247\)/.test(await bg()));
  await a.click('#set-theme .theme-opt:has-text("ダーク")'); await a.waitForTimeout(200); ok('「ダーク」を選ぶと、黒い背景', /rgb\(14, 21, 34\)/.test(await bg()));
  await a.click('#set-theme .theme-opt:has-text("自動")'); await a.waitForTimeout(200); ok('「自動」に戻すと、端末の設定（ダーク）に従う', /rgb\(14, 21, 34\)/.test(await bg()));
  await a.click('button:has-text("カレンダーに戻る")'); await a.waitForSelector('.cal');
  // 共有リンク（未ログインの端末・ライト端末）
  for (const [i, nm] of [[0, '会社用'], [1, '家族用']]) {
    const g = await mk(phone, 'light'); await g.goto(BASE + sh[i]); await g.waitForSelector('.cal'); await g.waitForTimeout(400);
    await g.locator('.cell[data-date="' + `${M}-14` + '"]').click({ position: { x: 20, y: 4 } }); await g.waitForSelector('.modal');
    const gt = await g.locator('.modal').innerText(); ok(nm + 'リンク: 日付を押すと、その日の予定が出る（閲覧のみ・追加ボタンなし）', (i === 0 ? gt.includes('全体会議') : gt.includes('家族で外食') && gt.includes('19:00')), gt); ok(nm + 'リンク: 「予定を追加」は出ない', !gt.includes('予定を追加'));
    if (i === 0) { await g.click('.day-item:has-text("全体会議")'); await g.waitForSelector('.modal'); ok('会社用: 予定を押すと、詳細（閲覧）が出る', (await g.locator('.modal').innerText()).includes('予定の詳細')); }
    ok(nm + 'リンク: 画面の色のボタンがある', (await g.locator('header button:has-text("画面の色")').count()) === 1);
    await g.close(); }
  const g2 = await mk(phone, 'light'); await g2.goto(BASE + sh[0]); await g2.waitForSelector('.cal'); await g2.locator('.cell[data-date="' + `${M}-14` + '"]').click({ position: { x: 20, y: 4 } }); await g2.waitForSelector('.day-list'); await g2.screenshot({ path: 'dp-popup.png' });
  // PC幅では、これまでどおり（空きの日を押すと、登録画面）
  const d = await mk({ viewport: { width: 1280, height: 900 } }, 'light'); await login(d);
  await d.locator('.cell[data-date="' + `${M}-22` + '"]').click({ position: { x: 20, y: 30 } }); await d.waitForSelector('.modal'); ok('PCでは、空きの日を押すと、これまでどおり登録画面', (await d.locator('.modal').innerText()).includes('予定') && !!(await d.locator('.modal input[name=title]').count()));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); })();
