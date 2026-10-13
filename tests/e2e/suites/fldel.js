const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const login = async (b, email, pw) => { const p = await b.newPage({ viewport: { width: 1200, height: 900 } }); p.on('pageerror', e => console.log('ERR', String(e))); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
(async () => {
  const b = await chromium.launch(); const y = await login(b, 'yamada@example.com', 'yamadapass1');
  const M = ((x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'))(new Date()).slice(0, 7);
  const addPriv = async (title, day) => { await y.keyboard.press('n'); await y.waitForSelector('.modal'); await y.click('.modal label:has-text("プライベート")'); await y.fill('.modal input[name=title]', title); await y.fill('.modal input[name=start]', `${M}-${day}`); await y.fill('.modal input[name=end]', `${M}-${day}`); await y.click('.modal button[type=submit]'); await y.waitForSelector('.bar:has-text("' + title + '")'); };
  await y.click('header >> text=プライベート版'); await y.waitForSelector('.view-banner.me');
  await addPriv('履歴その1', '05'); await addPriv('履歴その2', '06'); await addPriv('履歴その3', '07');
  const csrf = () => y.evaluate(() => document.getElementById('app').dataset.csrf);
  const path = await y.evaluate(async () => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify({ kind: 'family' }) }); return (await r.json()).path; });
  const f = await b.newPage({ viewport: { width: 1200, height: 900 } }); await f.goto(BASE + path); await f.waitForSelector('.upd-banner');
  const famLog = async () => { await f.reload(); await f.waitForSelector('.upd-banner'); await f.click('.upd-banner button:has-text("更新履歴を見る")'); await f.waitForSelector('.modal'); const t = await f.locator('.modal').innerText(); await f.click('.modal button:has-text("閉じる")'); await f.waitForFunction(() => !document.querySelector('.modal')); return t; };
  let t = await famLog(); ok('家族の更新履歴に、3件ある', ['履歴その1', '履歴その2', '履歴その3'].every(k => t.includes(k)), t);
  // 持ち主: 共有リンクのダイアログから
  await y.goto(BASE + 'index.php#settings'); await y.waitForSelector('#set-share'); await y.waitForTimeout(600);
  await y.click('#set-share button:has-text("家族に見える更新履歴を管理")'); await y.waitForSelector('.modal:has-text("家族に見える更新履歴")');
  const items = y.locator('.modal:has-text("家族に見える更新履歴") .log-item'); await items.first().waitFor().catch(() => {}); ok('持ち主の一覧に、3件が出る', await items.count() === 3, await items.count());
  await y.screenshot({ path: 'fldel-dialog.png' });
  await y.locator('.modal:has-text("家族に見える更新履歴") .log-item:has-text("履歴その2") button:has-text("削除")').click(); await y.waitForFunction(() => document.querySelectorAll('.modal .log-item').length === 2);
  ok('1件だけ削除できる（2件に減る）', true);
  t = await famLog(); ok('家族の履歴から、削除した1件が消える（他の2件は残る）', !t.includes('履歴その2') && t.includes('履歴その1') && t.includes('履歴その3'), t);
  // 他の人は、持ち主の履歴を消せない
  const s = await login(b, 'suzuki@example.com', 'suzukipass1');
  const rs = await s.evaluate(async () => { const tk = document.getElementById('app').dataset.csrf; const L = await (await fetch('api.php?action=family_log_list')).json(); const r = await fetch('api.php?action=family_log_delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify({ id: 1 }) }); return { mine: L.entries.length, del: (await r.json()).deleted }; });
  ok('他の社員は、自分の履歴しか見えず、他人の履歴は消せない', rs.mine === 0 && rs.del === 0, rs); await s.close();
  // すべて削除
  y.once('dialog', d => d.accept()); await y.click('.modal:has-text("家族に見える更新履歴") button:has-text("すべて削除")'); await y.waitForSelector('.modal:has-text("更新の記録はありません")');
  ok('「すべて削除」で、一覧が空になる', true);
  t = await famLog(); ok('家族の更新履歴も、空になる', t.includes('まだ更新の記録はありません'), t);
  ok('予定そのものは、消えない', await (async () => { await y.keyboard.press('Escape'); await y.goto(BASE + 'index.php'); await y.waitForSelector('.cal'); await y.click('header >> text=プライベート版'); await y.waitForSelector('.bar:has-text("履歴その1")'); return true; })());
  // 削除のあとの新しい更新は、家族に「新着」で出る
  await addPriv('履歴その4', '08'); await f.reload(); await f.waitForSelector('.upd-banner.has', { timeout: 20000 });
  ok('削除のあとに追加した予定は、家族に「更新あり」として出る', (await f.locator('.upd-banner').innerText()).includes('1件の更新'), await f.locator('.upd-banner').innerText());
  // 管理者の変更履歴: 件名は残らない
  const a = await login(b, 'admin@example.com', 'adminpass1');
  const au = await a.evaluate(async () => (await (await fetch('api.php?action=audit_list&type=share')).json()).entries.map(e => e.label + '|' + e.detail + '|' + e.target));
  ok('管理者の変更履歴に「家族用の更新履歴を削除」が残る（予定の件名は含まない）', au.some(x => x.includes('家族用の更新履歴を削除')) && !au.join('').includes('履歴その'), au);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
