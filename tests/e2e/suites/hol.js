const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.click('header button:has-text("設定")'); await p.waitForSelector('#set-holidays form');
  // 範囲で登録
  await p.fill('#set-holidays input[type=date] >> nth=0', '2026-12-29'); await p.fill('#set-holidays input[type=date] >> nth=1', '2027-01-03'); await p.fill('#set-holidays input:not([type=date])', '年末年始休業'); await p.click('#set-holidays button[type=submit]');
  await p.waitForSelector('#set-holidays table.t'); const t = await p.locator('#set-holidays table.t').innerText();
  ok('範囲で登録すると、1行にまとめて表示される（6日間）', /12\/29.*〜.*1\/3.*6日間/.test(t) && (await p.locator('#set-holidays table.t tr').count()) === 1, t);
  await p.waitForSelector('.toast:has-text("6日分を追加しました")'); ok('「6日分を追加しました」と出る', true);
  // 1日だけ（終了日が空欄）
  await p.fill('#set-holidays input[type=date] >> nth=0', '2026-11-20'); await p.fill('#set-holidays input:not([type=date])', '創立記念日'); await p.click('#set-holidays button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('#set-holidays table.t tr').length === 2);
  ok('終了日が空欄なら1日だけ登録される', (await p.locator('#set-holidays table.t').innerText()).includes('創立記念日'));
  // 同じ範囲をもう一度 → 重複しない
  await p.fill('#set-holidays input[type=date] >> nth=0', '2026-12-30'); await p.fill('#set-holidays input[type=date] >> nth=1', '2027-01-05'); await p.fill('#set-holidays input:not([type=date])', '年末年始休業'); await p.click('#set-holidays button[type=submit]');
  await p.waitForSelector('.toast:has-text("2日分を追加しました")'); ok('すでにある日は飛ばして、足りない日だけ追加される（1/4・1/5の2日）', true);
  await p.waitForFunction(() => /8日間/.test(document.querySelector('#set-holidays table.t').innerText)); ok('つながって、8日間（12/29〜1/5）の1行になる', true);
  // 終了日が開始日より前 → 案内
  await p.fill('#set-holidays input[type=date] >> nth=0', '2027-02-10'); await p.fill('#set-holidays input[type=date] >> nth=1', '2027-02-05'); await p.fill('#set-holidays input:not([type=date])', 'x');
  const r = await p.evaluate(async () => { const csrf = document.getElementById('app').dataset.csrf; const x = await fetch('api.php?action=holiday_save', { method: 'POST', headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ hdate: '2027-02-10', hdate_end: '2027-02-05', name: 'x' }) }); return [x.status, (await x.json()).error]; });
  ok('終了日が開始日より前なら、エラー（400）', r[0] === 400 && /開始日以降/.test(r[1]), r);
  const r2 = await p.evaluate(async () => { const csrf = document.getElementById('app').dataset.csrf; const x = await fetch('api.php?action=holiday_save', { method: 'POST', headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ hdate: '2027-02-01', hdate_end: '2027-12-31', name: 'x' }) }); return [x.status, (await x.json()).error]; });
  ok('長すぎる範囲（60日超）は、エラー', r2[0] === 400 && /60日/.test(r2[1]), r2);
  // カレンダーに休業日の名前が出る（12月へ）
  await p.click('button:has-text("カレンダーに戻る")'); await p.waitForSelector('.cal'); for (let i = 0; i < 2; i++) await p.click('.toolbar button:has-text("›")'); await p.waitForTimeout(500);
  await p.waitForSelector('.cal .hname:has-text("年末年始休業")'); ok('カレンダーの該当日に「年末年始休業」が出る', await p.locator('.cal .hname:has-text("年末年始休業")').count() >= 3);
  // まとめて削除
  await p.click('header button:has-text("設定")'); await p.waitForSelector('#set-holidays table.t');
  await p.locator('#set-holidays table.t tr:has-text("年末年始休業") button:has-text("削除")').click(); await p.waitForFunction(() => !/年末年始休業/.test(document.querySelector('#set-holidays').innerText));
  ok('範囲をまとめて削除できる（創立記念日は残る）', (await p.locator('#set-holidays table.t').innerText()).includes('創立記念日'));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
