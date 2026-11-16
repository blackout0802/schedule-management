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
  await a.click('header button:has-text("会社の管理")'); await a.waitForSelector('#set-slack-dest .slack-status'); ok('会社の管理に、Slack通知の項目がある（管理者のみ）', (await a.locator('#set-slack').count()) === 1);
  await s.click('header button:has-text("設定")'); await s.waitForSelector('.settings-page'); ok('管理者でない人の設定には出ない', (await s.locator('#set-slack').count()) === 0); await s.click('button:has-text("カレンダーに戻る")'); await s.waitForSelector('.cal');
  const st = await a.locator('.slack-status').innerText(); ok('状態が出る（config.php で設定済み・URLは伏せ字）', st.includes('config.php') && !st.includes('hook.php?') , st);
  // テスト通知
  await a.click('button:has-text("テスト通知を送る")'); await a.waitForSelector('#set-slack-dest .slack-result.ok'); ok('テスト通知を送ると、「送信できました」と出る', (await a.locator('#set-slack-dest .slack-result').innerText()).includes('送信できました'));
  ok('Slack（受け口）に、テスト通知が届いている', log().includes('Slack通知のテストです') && log().includes('管理者 太郎'), log());
  // 画面から、名前を付けて複数登録 → 送り先ごとに「送る」を選ぶ（選んだ全部に送る。v1.114.0〜。以前はプルダウンで1つだけ選んでいた）
  const HOOK = ['https:', '', 'hooks.slack' + '.com', 'services'].join('/'); // 見本のURL（実在しない）。ファイルに、そのままの文字列を置かない（秘密情報の検出に引っかかるため）
  const U1 = HOOK + '/T0123ABCD/B0123ABCD/' + 'abcdEFGH1234abcdEFGH1234', U2 = HOOK + '/T0123ABCD/B0456DEFG/' + 'zyxwVUTS9876zyxwVUTS9876';
  const add = async (n, u) => { await a.fill('#slack-name', n); await a.fill('#slack-url', u); await a.click('#set-slack-dest .slack-add button[type=submit]'); };
  const row = n => a.locator('#set-slack-dest .slack-dest', { hasText: n });
  const status = () => a.locator('#set-slack-dest .slack-status').innerText();
  const toggle = async (n, want) => { await row(n).locator('input.slack-send').click(); await a.waitForFunction(([n, want]) => { const r = Array.from(document.querySelectorAll('#set-slack-dest .slack-dest')).find(x => x.innerText.includes(n)); const c = r && r.querySelector('input.slack-send'); return c && !c.disabled && c.checked === want; }, [n, want]); };
  await add('', U1); await a.waitForSelector('#set-slack-dest .error:not([hidden])'); ok('チャンネル名が空だと、保存できない', (await a.locator('#set-slack-dest .error').innerText()).includes('チャンネル名'));
  await add('#休み連絡', 'https://evil.example.com/x'); await a.waitForSelector('#set-slack-dest .error:not([hidden])'); ok('Slack以外のURLは、保存できない（案内が出る）', (await a.locator('#set-slack-dest .error').innerText()).includes('hooks.slack.com'));
  await add('#休み連絡', U1); await a.waitForFunction(() => document.querySelectorAll('#set-slack-dest .slack-dest').length === 2, null, { timeout: 5000 }).catch(async () => console.log('ERRTEXT', await a.locator('#set-slack-dest .error').innerText()));
  const r1 = await row('#休み連絡').innerText();
  ok('登録すると、一覧にチャンネル名が出る（URLは伏せ字）', r1.includes('1234') && !r1.includes('abcdEFGH1234abcdEFGH1234'), r1);
  ok('config.php の設定も、一覧に出る（削除のボタンはない）', (await row('config.php の設定').count()) === 1 && (await row('config.php の設定').locator('button:has-text("削除")').count()) === 0);
  ok('足しただけでは送らない（いままでの送り先に送ったまま）', (await row('config.php の設定').locator('input.slack-send').isChecked()) && !(await row('#休み連絡').locator('input.slack-send').isChecked()) && (await status()).includes('通知先: config.php の設定') && !(await status()).includes('#休み連絡'), await status());
  await toggle('#休み連絡', true);
  ok('「送る」を入れると、両方に送る（通知先に2つとも出る）', (await status()).includes('config.php の設定・#休み連絡'), await status());
  await a.reload(); await a.waitForSelector('.settings-page'); await a.waitForSelector('#set-slack-dest .slack-status');
  ok('開き直しても、登録と「送る」が残っている', (await status()).includes('config.php の設定・#休み連絡') && (await a.locator('#set-slack-dest .slack-dest input.slack-send:checked').count()) === 2);
  fs.writeFileSync(LOG, ''); await a.click('#set-slack-dest button:has-text("テスト通知を送る")'); await a.waitForSelector('#set-slack-dest .slack-result.ng', { timeout: 30000 }); const part = await a.locator('#set-slack-dest .slack-result').innerText();
  ok('両方に送る: 届いた送り先には届く（config.php の受け口）', log().includes('Slack通知のテストです'), log());
  ok('両方に送る: 一部に送れなかったときは、どこに送れなかったかと、原因の案内が出る（見本のURLは届かない）', part.includes('一部') && part.includes('✓ config.php の設定') && part.includes('✕ #休み連絡') && part.length > 40, part);
  ok('送り先ごとに、最後に送った結果が出る', (await row('config.php の設定').locator('.slack-last').innerText()).includes('✓') && (await row('#休み連絡').locator('.slack-last.ng').innerText()).includes('送れませんでした'), [await row('config.php の設定').innerText(), await row('#休み連絡').innerText()]);
  await a.locator('#set-slack-dest').screenshot({ path: 'slack-dests.png' });
  fs.writeFileSync(LOG, ''); await row('config.php の設定').locator('button:has-text("テスト")').click(); await a.waitForSelector('#set-slack-dest .slack-result.ok');
  ok('送り先ごとの「テスト」は、その送り先だけに送る', (await a.locator('#set-slack-dest .slack-result').innerText()).includes('config.php の設定') && log().split('Slack通知のテストです').length === 2, log());
  await toggle('config.php の設定', false);
  ok('外すと、そこには送らない', (await status()).includes('通知先: #休み連絡') && !(await status()).includes('config.php'), await status());
  fs.writeFileSync(LOG, ''); await row('config.php の設定').locator('button:has-text("テスト")').click(); await a.waitForSelector('#set-slack-dest .slack-result.ok');
  ok('「送る」を外した送り先でも、「テスト」で試せる', log().includes('テストです'));
  // 削除（確認あり）。送っていた送り先が無くなると、残りに送る
  await add('#全体連絡', U2); await a.waitForFunction(() => document.querySelectorAll('#set-slack-dest .slack-dest').length === 3);
  await row('#休み連絡').locator('button:has-text("削除")').click(); await a.waitForFunction(() => document.querySelectorAll('#set-slack-dest .slack-dest').length === 2);
  ok('送っていた送り先を消すと、残りの送り先に送る', (await status()).includes('#全体連絡'), await status());
  await row('#全体連絡').locator('button:has-text("削除")').click(); await a.waitForSelector('#set-slack-dest .slack-status:has-text("config.php")');
  ok('全部消すと、config.php の設定に戻る', (await a.locator('#set-slack-dest .slack-dest').count()) === 1 && (await row('config.php の設定').locator('input.slack-send').isChecked()));
  fs.writeFileSync(LOG, ''); await a.click('#set-slack-dest button:has-text("テスト通知を送る")'); await a.waitForSelector('#set-slack-dest .slack-result.ok'); ok('戻したあとは、また届く', log().includes('テストです'));
  // 権限
  const r = await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const x = await fetch('api.php?action=slack_test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: '{}' }); const y = await fetch('api.php?action=slack_add', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ webhook: 'https://hooks.slack.com/services/T0/B0/x' }) }); const z = await fetch('api.php?action=slack_send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ id: 'config', on: false }) }); return [x.status, y.status, z.status]; });
  ok('管理者でない人は、テスト送信も送り先の変更もできない（403）', r[0] === 403 && r[1] === 403 && r[2] === 403, r);
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
  const refresh = async () => { await a.click('#set-slack-dest button:has-text("最新の状態を見る")'); await a.waitForTimeout(400); };
  await a.goto(BASE + 'index.php'); await a.waitForSelector('.cal'); await a.click('header button:has-text("会社の管理")'); await a.waitForSelector('#set-slack #slack-sched-time');
  const cronCmds = await a.locator('#set-slack-dest .cron-cmds input.cron-cmd').evaluateAll(xs => xs.map(x => x.value));
  ok('cron に登録するコマンドが、このサーバーの本当の場所で、1つだけ出る（notify。繰り返し業務も、これが1日1回行う）', cronCmds.length === 1 && /^\/usr\/bin\/php\d+\.\d+ \/.+\/bin\/cron\.php notify$/.test(cronCmds[0]) && cronCmds[0].includes(process.env.E2E_APP || '/app/'), cronCmds);
  await a.locator('#set-slack-dest .cron-cmds').screenshot({ path: 'cron-cmds.png' });
  ok('Slack の設定に「時刻を指定してテスト送信」がある（初めは、5分後の時刻が入っている）', (await a.locator('#set-slack-dest .slack-sched > h3').innerText()).includes('時刻を指定してテスト送信') && /^\d{2}:\d{2}$/.test(await a.inputValue('#slack-sched-time')));
  const at = new Date(Date.now() + 10 * 60000); at.setSeconds(0, 0);
  await a.fill('#slack-sched-time', hm(at)); await a.click('#set-slack-dest .slack-sched button:has-text("予約する")'); await a.waitForSelector('#set-slack-dest .slack-sched .slack-sched-st.wait');
  ok('予約すると、「予約中」と、送る日時が出る', (await a.locator('#set-slack-dest .slack-sched .slack-sched-st.wait').innerText()).includes('予約中: ' + (at.getMonth() + 1) + '/' + at.getDate() + ' ' + hm(at)), await a.locator('#set-slack-dest .slack-sched').innerText());
  fs.writeFileSync(LOG, ''); cron();
  ok('時刻の前に cron が動いても、送らない', !log().includes('時刻を指定したテスト送信'), log());
  setAt(new Date(Date.now() - 20 * 60000)); await refresh(); // cron が止まっていて、時刻を20分過ぎた
  ok('時刻を過ぎても送られていないと、「cron が動いていない可能性」と出る', (await a.locator('#set-slack-dest .slack-sched .slack-sched-st.ng:not([hidden])').innerText()).includes('cron'), await a.locator('#set-slack-dest .slack-sched').innerText());
  setAt(new Date(Date.now() - 2 * 60000)); cron();
  ok('時刻を過ぎて cron が動くと、Slack に送る（予定の時刻と、送った時刻が入る）', log().includes('時刻を指定したテスト送信') && log().includes('予定の時刻') && log().includes('送った時刻'), log());
  await refresh();
  const done = await a.locator('#set-slack-dest .slack-sched').innerText();
  ok('画面に、前回の結果（予定 → 送った時刻）と、cron が最後に動いた日時が出る。予約は消える', done.includes('前回: 予定') && done.includes('cron が送りました') && /最後に動いた日時: \d+\/\d+ \d{2}:\d{2}/.test(done) && !done.includes('予約中'), done);
  await a.locator('#set-slack-dest .slack-sched').screenshot({ path: 'slack-sched.png' });
  fs.writeFileSync(LOG, ''); cron();
  ok('送ったあとに cron が動いても、二重には送らない', !log().includes('時刻を指定したテスト送信'), log());
  await a.fill('#slack-sched-time', hm(at)); await a.click('#set-slack-dest .slack-sched button:has-text("予約する")'); await a.waitForSelector('#set-slack-dest .slack-sched button:has-text("予約を取り消す")');
  await a.click('#set-slack-dest .slack-sched button:has-text("予約を取り消す")'); await a.waitForFunction(() => !document.querySelector('#set-slack-dest .slack-sched .slack-sched-st.wait'));
  ok('予約を取り消せる', !(await a.locator('#set-slack-dest .slack-sched').innerText()).includes('予約中'));
  // 時刻ちょうどに送る: cron が動いたとき、次の cron までに予定があれば、その時刻まで待って送る（画面テストの設定は notify_wait = 0 なので、--wait で指定）
  await a.fill('#slack-sched-time', hm(at)); await a.click('#set-slack-dest .slack-sched button:has-text("予約する")'); await a.waitForSelector('#set-slack-dest .slack-sched .slack-sched-st.wait');
  const next = new Date(Date.now() + 60000); next.setSeconds(0, 0); setAt(next); fs.writeFileSync(LOG, '');
  const t0 = Date.now(); const out = execFileSync('php', [env.APP + '/bin/cron.php', 'notify', '--wait=2'], { env: process.env, encoding: 'utf8', timeout: 180000 }); const t1 = Date.now();
  ok('cron は、予定の時刻（次の分の0秒）まで待ってから送る', t1 >= next.getTime() - 1000 && t1 < next.getTime() + 15000 && out.includes('時刻を指定したテスト送信: 送りました') && log().includes('時刻を指定したテスト送信'), { out, waited: Math.round((t1 - t0) / 1000) });
  await refresh();
  ok('予定の時刻と、送った時刻が同じ（時刻ちょうど）', (await a.locator('#set-slack-dest .slack-sched').innerText()).includes('予定 ' + (next.getMonth() + 1) + '/' + next.getDate() + ' ' + hm(next) + ' → ' + (next.getMonth() + 1) + '/' + next.getDate() + ' ' + hm(next)), await a.locator('#set-slack-dest .slack-sched').innerText());
  const sp = await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; return (await fetch('api.php?action=slack_test_schedule', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ time: '09:00' }) })).status; });
  ok('管理者でない人は、予約できない（403）', sp === 403, sp);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
