// 管理者の「利用状況」と「運用の手引き」: 最終ログインの記録・容量・バックアップ・cron・注意点・件名が出ない・一般の社員には見えない
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { BASE, sql } = require('../lib/env');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const login = async (b, em, pw, w = 1100) => { const p = await b.newPage({ viewport: { width: w, height: 900 } }); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
(async () => {
  const b = await chromium.launch();
  // 一般の社員: 設定に項目が出ない／API も手引きも使えない。その人の私用ToDoは、管理者の利用状況に出ない
  const y = await login(b, 'yamada@example.com', 'yamadapass1');
  await y.click('.tab[data-view=me]'); await y.waitForTimeout(300);
  const secret = await y.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=todo_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ title: '利用状況に出ない私用', kind: 'private' }) }); return r.status; });
  await y.click('header button:has-text("設定")'); await y.waitForSelector('.settings-page');
  ok('一般の社員の設定には、利用状況・運用の手引きが出ない', (await y.locator('#set-usage').count()) === 0 && (await y.locator('#set-guide').count()) === 0);
  ok('一般の社員は、利用状況の API を使えない（403）', (await y.evaluate(async () => (await fetch('api.php?action=usage_get')).status)) === 403);
  ok('一般の社員は、運用の手引きを開けない（403）', (await y.goto(BASE + 'guide.php')).status() === 403);
  ok('ログインすると、最後にログインした日時が残る', sql("SELECT COUNT(*) FROM users WHERE email='yamada@example.com' AND last_login_at IS NOT NULL") === '1');
  ok('ログインしていない人は、手引きからログイン画面に移る', await (async () => { const c = await b.newContext(); const p = await c.newPage(); await p.goto(BASE + 'guide.php'); return p.url().includes('login.php'); })());

  // 管理者
  const a = await login(b, 'admin@example.com', 'adminpass1');
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-usage');
  ok('管理者の設定に、利用状況と運用の手引きがある', (await a.locator('#set-usage').count()) === 1 && (await a.locator('#set-guide').count()) === 1);
  await a.waitForSelector('#set-usage .usage-sec');
  const txt = await a.locator('#set-usage').innerText();
  ok('社員ごとの、最後にログインした日時が出る', txt.includes('山田 花子') && txt.includes('鈴木 一郎') && /山田 花子[\s\S]*?\d+\/\d+ \d+:\d+（今日）/.test(txt), txt.slice(0, 500));
  ok('まだログインしていない人は「記録なし」', txt.includes('鈴木 一郎') && /鈴木 一郎[\s\S]{0,40}記録なし/.test(txt), txt.slice(0, 700));
  ok('容量・バックアップ・cron・システムの項目が出る', ['容量', 'データベース', 'ToDoの画像', 'サーバーの空き', '自動バックアップ', '自動処理（cron）', 'アプリの版'].every(w => txt.includes(w)), txt);
  ok('気をつけること: 自動バックアップが未設定だと出る', txt.includes('自動バックアップが設定されていません'));
  ok('気をつけること: 管理者が1人だけだと出る', txt.includes('管理者が1人だけ'));
  ok('他の人の私用ToDoの件名は、出ない', !txt.includes('利用状況に出ない私用') && secret === 200);
  await a.locator('#set-usage').screenshot({ path: 'usage.png' });
  // 自動バックアップを設定し、cron が動いた記録を入れると、注意が消える
  sql("INSERT INTO app_meta (meta_key, meta_value) VALUES ('backup_auto_pass', 'usage-pass-1')");
  sql(`INSERT INTO app_meta (meta_key, meta_value) VALUES ('cron_notify_at', '${require('../lib/env').ago(0)}')`);
  await a.reload(); await a.waitForSelector('#set-usage .usage-sec');
  const txt2 = await a.locator('#set-usage').innerText();
  ok('自動バックアップを設定すると、「設定されていません」は消える', !txt2.includes('自動バックアップが設定されていません') && txt2.includes('設定済み'), txt2.slice(0, 600));
  ok('cron の記録があると、通知の cron の項目に日時が出る', /notify（10分おき）[\s\S]{0,30}\d+\/\d+ \d+:\d+/.test(txt2), txt2);
  // cron が止まっていると警告
  sql(`UPDATE app_meta SET meta_value='${require('../lib/env').ago(1)}' WHERE meta_key='cron_notify_at'`);
  await a.reload(); await a.waitForSelector('#set-usage .usage-sec');
  ok('通知の cron が1時間以上止まると、警告が出る', (await a.locator('#set-usage .usage-warn li.warn').allInnerTexts()).some(t => t.includes('notify') && t.includes('1時間以上')));
  // 運用の手引き
  const g = await a.goto(BASE + 'guide.php');
  ok('管理者は、運用の手引きを開ける', g.status() === 200 && (await a.locator('h1').innerText()).includes('運用の手引き'));
  const gt = await a.locator('.paper').innerText();
  ok('手引きに、更新・バックアップ・cron・パスワード・控えの欄がある', ['システム更新', 'バックアップと復元', 'cron', 'reset_password.php', '控え', 'bin/cron.php notify'].every(w => gt.includes(w)), gt.slice(0, 300));
  ok('手引きのコマンドが、改行どおりに出る（cd と php が、くっつかない）', /cd [^\n]+\nphp bin\/reset_password\.php/.test(await a.locator('pre').first().innerText()), await a.locator('pre').first().innerText());
  ok('手引きに、いまの版と自動バックアップの状態が入る', /v\d+\.\d+\.\d+/.test(gt) && gt.includes('自動バックアップ') && (gt.includes('設定済み') || gt.includes('まだ設定されていません')));
  ok('印刷ボタンが動く（CSP のもとでも）', await a.evaluate(() => { let called = 0; window.print = () => { called++; }; document.getElementById('print-btn').click(); return called === 1; }));
  await a.screenshot({ path: 'guide.png', fullPage: true });
  // スマホ幅でも、横にはみ出さない
  const m = await login(b, 'admin@example.com', 'adminpass1', 390); await m.goto(BASE + 'guide.php');
  ok('スマホ幅でも、手引きが横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await m.goto(BASE + 'index.php#settings'); await m.waitForSelector('#set-usage .usage-sec');
  ok('スマホ幅でも、利用状況が横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await b.close();
  console.log(fails ? '失敗あり' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
