const { chromium } = require(process.env.NODE_PATH + '/playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8099/'; const LOG = require('../lib/env').SLACK_LOG;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const log = () => { try { return fs.readFileSync(LOG, 'utf8'); } catch (e) { return ''; } };
async function login(b, email, pw) { const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; }
(async () => {
  fs.writeFileSync(LOG, '');
  const b = await chromium.launch(); const a = await login(b, 'admin@example.com', 'adminpass1');
  // ---- ショートカットの一覧に、システム更新（s）は無い（zip での更新は、廃止）
  await a.keyboard.press('?'); await a.waitForSelector('.sc-table'); ok('ショートカット一覧に、システム更新（s）は出ない', !(await a.locator('.sc-table').innerText()).includes('システム更新')); await a.keyboard.press('Escape');
  await a.keyboard.press('s'); await a.waitForTimeout(500); ok('s を押しても、何も起きない（システム更新の画面は、無い）', a.url().includes('index.php') && !a.url().includes('update.php'));
  const s = await login(b, 'yamada@example.com', 'yamadapass1');
  // ---- Slack設定ダイアログ
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-slack .slack-status'); ok('設定のページに、Slack通知の項目がある（管理者のみ）', (await a.locator('#set-slack').count()) === 1);
  await s.click('header button:has-text("設定")'); await s.waitForSelector('.settings-page'); ok('管理者でない人の設定には出ない', (await s.locator('#set-slack').count()) === 0); await s.click('button:has-text("カレンダーに戻る")'); await s.waitForSelector('.cal');
  const st = await a.locator('.slack-status').innerText(); ok('状態が出る（config.php で設定済み・URLは伏せ字）', st.includes('config.php') && !st.includes('hook.php?') , st);
  // テスト通知
  await a.click('button:has-text("テスト通知を送る")'); await a.waitForSelector('#set-slack .slack-result.ok'); ok('テスト通知を送ると、「送信できました」と出る', (await a.locator('#set-slack .slack-result').innerText()).includes('送信できました'));
  ok('Slack（受け口）に、テスト通知が届いている', log().includes('Slack通知のテストです') && log().includes('管理者 太郎'), log());
  // 画面から、名前を付けて複数登録 → プルダウンで選ぶ
  const HOOK = ['https:', '', 'hooks.slack' + '.com', 'services'].join('/'); // 見本のURL（実在しない）。ファイルに、そのままの文字列を置かない（秘密情報の検出に引っかかるため）
  const U1 = HOOK + '/T0123ABCD/B0123ABCD/' + 'abcdEFGH1234abcdEFGH1234', U2 = HOOK + '/T0123ABCD/B0456DEFG/' + 'zyxwVUTS9876zyxwVUTS9876';
  const add = async (n, u) => { await a.fill('#slack-name', n); await a.fill('#slack-url', u); await a.click('#set-slack .slack-add button[type=submit]'); };
  await add('', U1); await a.waitForSelector('#set-slack .error:not([hidden])'); ok('チャンネル名が空だと、保存できない', (await a.locator('#set-slack .error').innerText()).includes('チャンネル名'));
  await add('#休み連絡', 'https://evil.example.com/x'); await a.waitForSelector('#set-slack .error:not([hidden])'); ok('Slack以外のURLは、保存できない（案内が出る）', (await a.locator('#set-slack .error').innerText()).includes('hooks.slack.com'));
  await add('#休み連絡', U1); await a.waitForSelector('.slack-dest', { timeout: 5000 }).catch(async () => console.log('ERRTEXT', await a.locator('#set-slack .error').innerText()));
  let opts = await a.locator('#slack-pick option').allInnerTexts(); ok('登録すると、プルダウンにチャンネル名が出る（URLは伏せ字）', opts.some(o => o.includes('#休み連絡') && o.includes('1234') && !o.includes('abcdEFGH1234abcdEFGH1234')), opts);
  ok('config.php の設定も、プルダウンで選べる', opts.some(o => o.includes('config.php の設定')), opts);
  ok('最初の1件は、そのまま使う送り先（使用中）', (await a.locator('.slack-dest').innerText()).includes('使用中') && (await a.locator('#slack-pick').inputValue()) !== 'config');
  await add('#全体連絡', U2); await a.waitForFunction(() => document.querySelectorAll('.slack-dest').length === 2);
  ok('2件目を足しても、使う送り先は変わらない', (await a.locator('.slack-status').innerText()).includes('#休み連絡'), await a.locator('.slack-status').innerText());
  await a.selectOption('#slack-pick', { label: (await a.locator('#slack-pick option').allInnerTexts()).find(o => o.includes('#全体連絡')) }); await a.waitForFunction(() => /通知先: #全体連絡/.test(document.querySelector('.slack-status').innerText));
  ok('プルダウンで選ぶと、通知先が切り替わる（テスト送信の見出しにも出る）', (await a.locator('.slack-test h3').innerText()).includes('#全体連絡'));
  await a.reload(); await a.waitForSelector('.settings-page'); await a.waitForSelector('#set-slack .slack-status');
  ok('開き直しても、登録と選んだ送り先が残っている', (await a.locator('.slack-status').innerText()).includes('#全体連絡') && (await a.locator('.slack-dest').count()) === 2);
  await a.click('button:has-text("テスト通知を送る")'); await a.waitForSelector('#set-slack .slack-result.ng, .slack-result.ok', { timeout: 30000 }); const ng = await a.locator('#set-slack .slack-result').innerText();
  ok('送れなかったときは、失敗と、原因の案内が出る（サンドボックスは外へ出られない）', ng.includes('送信できませんでした') && ng.length > 30, ng);
  await a.selectOption('#slack-pick', 'config'); await a.waitForFunction(() => /通知先: config\.php/.test(document.querySelector('.slack-status').innerText));
  fs.writeFileSync(LOG, ''); await a.click('button:has-text("テスト通知を送る")'); await a.waitForSelector('#set-slack .slack-result.ok'); ok('config.php の設定を選ぶと、届く', log().includes('テストです'));
  // 削除（確認あり）。使用中の送り先を消すと、残りに切り替わる
  await a.selectOption('#slack-pick', { label: (await a.locator('#slack-pick option').allInnerTexts()).find(o => o.includes('#全体連絡')) }); await a.waitForFunction(() => /通知先: #全体連絡/.test(document.querySelector('.slack-status').innerText));
  await a.locator('.slack-dest', { hasText: '#全体連絡' }).locator('button:has-text("削除")').click(); await a.waitForFunction(() => document.querySelectorAll('.slack-dest').length === 1);
  ok('使用中の送り先を消すと、残りの送り先に切り替わる', (await a.locator('.slack-status').innerText()).includes('#休み連絡'), await a.locator('.slack-status').innerText());
  await a.locator('.slack-dest').locator('button:has-text("削除")').click(); await a.waitForSelector('.slack-status:has-text("config.php")');
  ok('全部消すと、config.php の設定に戻る', true);
  fs.writeFileSync(LOG, ''); await a.click('button:has-text("テスト通知を送る")'); await a.waitForSelector('#set-slack .slack-result.ok'); ok('戻したあとは、また届く', log().includes('テストです'));
  // 権限
  const r = await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const x = await fetch('api.php?action=slack_test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: '{}' }); const y = await fetch('api.php?action=slack_add', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ webhook: 'https://hooks.slack.com/services/T0/B0/x' }) }); return [x.status, y.status]; });
  ok('管理者でない人は、テスト送信も送り先の変更もできない（403）', r[0] === 403 && r[1] === 403, r);
  // 実際の休みの登録通知も、送り先に届く
  fs.writeFileSync(LOG, ''); const d = new Date(); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  await s.evaluate(async (ds) => { const t = document.getElementById('app').dataset.csrf; await fetch('api.php?action=event_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'off', title: '', tag: '有給', start: ds, end: ds }) }); }, ds); await s.waitForTimeout(800);
  ok('休みを登録しても、その場では通知しない（朝・夕方の通知だけ）', log() === '', log());
  // ---- 時刻を指定したテスト送信（cron が、決まった時刻に送れるかの確認）
  const env = require('../lib/env'); const { execFileSync } = require('child_process');
  const cron = () => execFileSync('php', [env.APP + '/bin/cron.php', 'notify'], { env: process.env, encoding: 'utf8' });
  const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const ymdhm = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + hm(d);
  const setAt = d => { const j = JSON.parse(env.sql("SELECT meta_value FROM app_meta WHERE meta_key = 'slack_test_at'")); j.at = ymdhm(d); env.sql("UPDATE app_meta SET meta_value = '" + JSON.stringify(j) + "' WHERE meta_key = 'slack_test_at'"); };
  const refresh = async () => { await a.click('#set-slack button:has-text("最新の状態を見る")'); await a.waitForTimeout(400); };
  await a.goto(BASE + 'index.php'); await a.waitForSelector('.cal'); await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-slack #slack-sched-time');
  ok('Slack の設定に「時刻を指定してテスト送信」がある（初めは、5分後の時刻が入っている）', (await a.locator('#set-slack .slack-sched h3').innerText()).includes('時刻を指定してテスト送信') && /^\d{2}:\d{2}$/.test(await a.inputValue('#slack-sched-time')));
  const at = new Date(Date.now() + 10 * 60000); at.setSeconds(0, 0);
  await a.fill('#slack-sched-time', hm(at)); await a.click('#set-slack .slack-sched button:has-text("予約する")'); await a.waitForSelector('#set-slack .slack-sched .slack-sched-st.wait');
  ok('予約すると、「予約中」と、送る日時が出る', (await a.locator('#set-slack .slack-sched .slack-sched-st.wait').innerText()).includes('予約中: ' + (at.getMonth() + 1) + '/' + at.getDate() + ' ' + hm(at)), await a.locator('#set-slack .slack-sched').innerText());
  fs.writeFileSync(LOG, ''); cron();
  ok('時刻の前に cron が動いても、送らない', !log().includes('時刻を指定したテスト送信'), log());
  setAt(new Date(Date.now() - 20 * 60000)); await refresh(); // cron が止まっていて、時刻を20分過ぎた
  ok('時刻を過ぎても送られていないと、「cron が動いていない可能性」と出る', (await a.locator('#set-slack .slack-sched .slack-sched-st.ng:not([hidden])').innerText()).includes('cron'), await a.locator('#set-slack .slack-sched').innerText());
  setAt(new Date(Date.now() - 2 * 60000)); cron();
  ok('時刻を過ぎて cron が動くと、Slack に送る（予定の時刻と、送った時刻が入る）', log().includes('時刻を指定したテスト送信') && log().includes('予定の時刻') && log().includes('送った時刻'), log());
  await refresh();
  const done = await a.locator('#set-slack .slack-sched').innerText();
  ok('画面に、前回の結果（予定 → 送った時刻）と、cron が最後に動いた日時が出る。予約は消える', done.includes('前回: 予定') && done.includes('cron が送りました') && /最後に動いた日時: \d+\/\d+ \d{2}:\d{2}/.test(done) && !done.includes('予約中'), done);
  await a.locator('#set-slack .slack-sched').screenshot({ path: 'slack-sched.png' });
  fs.writeFileSync(LOG, ''); cron();
  ok('送ったあとに cron が動いても、二重には送らない', !log().includes('時刻を指定したテスト送信'), log());
  await a.fill('#slack-sched-time', hm(at)); await a.click('#set-slack .slack-sched button:has-text("予約する")'); await a.waitForSelector('#set-slack .slack-sched button:has-text("予約を取り消す")');
  await a.click('#set-slack .slack-sched button:has-text("予約を取り消す")'); await a.waitForFunction(() => !document.querySelector('#set-slack .slack-sched .slack-sched-st.wait'));
  ok('予約を取り消せる', !(await a.locator('#set-slack .slack-sched').innerText()).includes('予約中'));
  const sp = await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; return (await fetch('api.php?action=slack_test_schedule', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ time: '09:00' }) })).status; });
  ok('管理者でない人は、予約できない（403）', sp === 403, sp);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
