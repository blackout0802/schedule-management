const { chromium } = require(process.env.NODE_PATH + '/playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8099/'; const LOG = require('../lib/env').SLACK_LOG;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const log = () => { try { return fs.readFileSync(LOG, 'utf8').replace(/\\\//g, '/'); } catch (e) { return ''; } };
async function login(b, email, pw) { const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; }
const open = async a => { if (!(await a.locator('.settings-page').count())) await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-slackcfg .slack-preview'); await a.waitForTimeout(300); };
const save = async a => { await a.locator('#set-slackcfg .actions button.btn.primary:has-text("保存")').click(); await a.waitForSelector('.toast:has-text("保存しました")'); await a.waitForTimeout(1200); };
(async () => {
  fs.writeFileSync(LOG, '');
  const b = await chromium.launch(); const a = await login(b, 'admin@example.com', 'adminpass1'); const s = await login(b, 'yamada@example.com', 'yamadapass1');
  await s.click('header button:has-text("設定")'); await s.waitForSelector('.settings-page'); ok('管理者でない人の設定には出ない', (await s.locator('#set-slackcfg').count()) === 0);
  const r = await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const f = a => fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: '{"cfg":{}}' }).then(x => x.status); return [await f('slack_cfg'), await f('slack_cfg_save'), await f('slack_cfg_preview')]; });
  ok('管理者でない人は、設定の取得・保存・プレビューができない（403）', r.every(x => x === 403), r);
  await open(a);
  ok('休みを登録したときの通知の項目は、無い', !(await a.locator('#set-slackcfg').innerText()).includes('登録したとき') && (await a.locator('#set-slackcfg textarea').count()) === 2);
  ok('メンションの項目は、無い', !(await a.locator('#set-slackcfg').innerText()).includes('メンション'));
  const pv = await a.locator('.slack-preview').allInnerTexts();
  ok('休みの人がいない日の見本が、「休みなし」で出る（初期値でオン）', pv.length === 3 && pv[2].includes('休みなし') && await a.locator('.slack-sec:has(h3:text("休みの人がいない日")) input[type=checkbox]').isChecked(), pv);
  ok('初期値: 朝・夕方の文面で、休みの一覧は名前だけ（@も分類も期間もない）', pv[0].includes('【本日のお休み】') && pv[1].includes('【明日のお休み】') && pv[0].includes('• 山田 花子\n') && !pv[0].includes('@') && !pv[0].includes('有給') && !pv[0].split('\n').slice(1).join('\n').includes('10/'), pv);
  ok('初期値: 朝 8:30・夕方 17:00', (await a.inputValue('[name=morTime]')) === '08:30' && (await a.inputValue('[name=eveTime]')) === '17:00');
  // 編集 → プレビューが変わる
  await a.fill('[name=morTime]', '9:05'); await a.press('[name=morTime]', 'Tab');
  const ta = a.locator('#set-slackcfg textarea').nth(0); await ta.fill('おはようございます！{日付}のお休みです（{人数}名）\n{休み一覧}\n{リンク}');
  await a.waitForFunction(() => document.querySelectorAll('.slack-preview')[0].innerText.includes('おはようございます'));
  const p2 = (await a.locator('.slack-preview').nth(0).innerText()); ok('文面を変えると、見本もその場で変わる（人数・日付が入る）', /（2名）/.test(p2) && /\d+\/\d+（.）/.test(p2), p2);
  await ta.click(); await a.locator('#set-slackcfg .slack-sec').nth(0).locator('.chip:has-text("{人数}")').click(); ok('差し込みボタンで、入力中の欄に入る', (await ta.inputValue()).split('{人数}').length >= 3, await ta.inputValue());
  await ta.fill('おはようございます！{日付}のお休みです（{人数}名）\n{休み一覧}\n{リンク}');
  await a.fill('.slack-sec:has(h3:text("休みの人がいない日")) input[type=text] >> nth=1', '全員出勤'); await a.waitForFunction(() => document.querySelectorAll('.slack-preview')[2].innerText.includes('全員出勤')); ok('休みなしの文言を変えると、見本も変わる', true);
  // 夕方を止める、1人分を変える（分類を足す）
  await a.locator('.slack-sec').nth(1).locator('input[type=checkbox]').uncheck(); await a.fill('.slack-sec:has(h3:text("1人分")) input[type=text]', '{名前}さん【{分類}】');
  await a.waitForFunction(() => document.querySelectorAll('.slack-preview')[0].innerText.includes('さん【'));
  // 不正
  await ta.fill('休みなし'); await a.waitForSelector('#set-slackcfg .error:not([hidden])'); ok('{休み一覧}が無いと、案内が出る', (await a.locator('#set-slackcfg .error').innerText()).includes('{休み一覧}'));
  await ta.fill('{なまえ}\n{休み一覧}'); await a.waitForFunction(() => document.querySelector('#set-slackcfg .error').innerText.includes('使えない差し込み')); ok('使えない差し込みは、案内が出る', true);
  await a.locator('#set-slackcfg .actions button.btn.primary:has-text("保存")').click(); await a.waitForTimeout(600);
  ok('不正な内容は、保存されない（画面も閉じない）', !(await a.locator('#set-slackcfg .error').isHidden()) && (await a.locator('#set-slackcfg').count()) === 1);
  await ta.fill('おはようございます！{日付}のお休みです（{人数}名）\n{休み一覧}\n{リンク}'); await a.waitForFunction(() => document.querySelector('#set-slackcfg .error').hidden);
  await save(a); ok('保存すると、最新の内容で描き直される（ページに残る）', (await a.locator('.settings-page').count()) === 1);
  // 開き直しても残る
  await a.reload(); await a.waitForSelector('.settings-page'); await open(a);
  ok('開き直しても、時刻・文面・止めた設定が残っている', (await a.inputValue('[name=morTime]')) === '09:05' && (await a.locator('#set-slackcfg textarea').nth(0).inputValue()).startsWith('おはようございます') && (await a.inputValue('.slack-sec:has(h3:text("休みの人がいない日")) input[type=text] >> nth=1')) === '全員出勤' && !(await a.locator('.slack-sec').nth(1).locator('input[type=checkbox]').isChecked()));
  // 見本送信（保存した文面で届く）
  fs.writeFileSync(LOG, ''); await a.locator('.slack-sec').nth(0).locator('button:has-text("見本を Slack に送る")').click(); await a.waitForSelector('.slack-result.ok');
  const L = log(); ok('朝の見本が、設定した文面で届く', L.includes('おはようございます！') && L.includes('のお休みです') && L.includes('これはテスト送信です') && L.includes('管理者 太郎さん【有給】'), L);
  // 休みを登録しても、その場では通知しない
  fs.writeFileSync(LOG, ''); const d = new Date(); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  await s.evaluate(async (ds) => { const t = document.getElementById('app').dataset.csrf; await fetch('api.php?action=event_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'off', title: '', tag: '有給', start: ds, end: ds }) }); }, ds); await new Promise(r => setTimeout(r, 800));
  ok('休みを登録しても、その場では Slack に送られない', log() === '', log());
  // 社員の管理に Slack ID の欄が無い
  await a.waitForSelector('#set-users table');
  ok('社員の管理に、Slack ID の欄は無い', !(await a.locator('#set-users').innerText()).includes('Slack'));
  await a.click('#set-users button:has-text("＋ 社員を追加")'); await a.waitForTimeout(300); ok('社員の追加画面にも、無い', !(await a.locator('.modal').last().innerText()).includes('Slack'));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
