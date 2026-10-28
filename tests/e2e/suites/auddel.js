const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const { sql } = require('../lib/env');
const login = async (b, email, pw) => { const p = await b.newPage({ viewport: { width: 1200, height: 900 } }); p.on('pageerror', e => console.log('ERR', String(e))); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
(async () => {
  const b = await chromium.launch(); const a = await login(b, 'admin@example.com', 'adminpass1');
  // 履歴を作る: 休業日を2件追加
  const post = (act, body) => a.evaluate(async ([act, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return await r.json(); }, [act, body]);
  await post('holiday_save', { hdate: '2027-01-04', name: '履歴テスト休業日1' }); await post('holiday_save', { hdate: '2027-01-05', name: '履歴テスト休業日2' });
  sql(`UPDATE audit_log SET at = '${require('../lib/env').ago(200)}' WHERE label LIKE '%履歴テスト休業日1%'`);
  await a.goto(BASE + 'index.php#settings'); await a.waitForSelector('#set-audit'); await a.waitForTimeout(800);
  const items = () => a.locator('#set-audit .audit-item');
  const n0 = await items().count(); ok('変更履歴に、記録が出ている', n0 >= 2, n0);
  ok('各履歴に「削除」ボタンがある', await a.locator('#set-audit .audit-item .au-del').count() === n0);
  await a.locator('#set-audit').scrollIntoViewIfNeeded(); await a.locator('#set-audit').screenshot({ path: 'auddel-panel.png' });
  // 1件削除
  const c0 = Number(sql("SELECT COUNT(*) FROM audit_log"));
  const target = items().filter({ hasText: '履歴テスト休業日2' }).first();
  await target.locator('.au-del').click(); await a.waitForFunction(() => !document.querySelector('#set-audit').innerText.includes('履歴テスト休業日2'));
  ok('1件削除すると、一覧から消える', true);
  await a.waitForTimeout(500);
  ok('消したことは、新しい履歴として残らない（件数が1つ減る）', !(await a.locator('#set-audit').innerText()).includes('変更履歴を削除') && Number(sql("SELECT COUNT(*) FROM audit_log")) === c0 - 1, [Number(sql("SELECT COUNT(*) FROM audit_log")), c0]);
  // 180日より前を削除
  await a.selectOption('#set-audit .audit-bulk select', '180'); a.once('dialog', d => d.accept()); await a.click('#set-audit .audit-bulk button:has-text("より前の履歴を削除")');
  await a.waitForFunction(() => !document.querySelector('#set-audit').innerText.includes('履歴テスト休業日1'));
  ok('「180日より前」を削除すると、200日前の記録だけが消える', Number(sql("SELECT COUNT(*) FROM audit_log")) === c0 - 2, [Number(sql("SELECT COUNT(*) FROM audit_log")), c0]);
  // すべて削除
  a.once('dialog', d => d.accept()); await a.click('#set-audit .audit-bulk button:has-text("すべて削除")'); await a.waitForFunction(() => document.querySelectorAll('#set-audit .audit-item').length === 0);
  ok('すべて削除すると、一覧が空になる（削除の記録も残らない）', (await a.locator('#set-audit').innerText()).includes('該当する履歴はありません') && Number(sql("SELECT COUNT(*) FROM audit_log")) === 0);
  // 一般の社員は、削除できない
  await post('holiday_save', { hdate: '2027-01-06', name: '履歴テスト休業日3' }); const c1 = Number(sql("SELECT COUNT(*) FROM audit_log"));
  const y = await login(b, 'yamada@example.com', 'yamadapass1');
  const r = await y.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=audit_delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ all: true }) }); return r.status; });
  ok('一般の社員は、変更履歴を削除できない（403）', r === 403, r);
  ok('削除しようとしても、記録は残ったまま', c1 >= 1 && Number(sql("SELECT COUNT(*) FROM audit_log")) === c1, [Number(sql("SELECT COUNT(*) FROM audit_log")), c1]);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
