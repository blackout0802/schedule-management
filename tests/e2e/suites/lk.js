const { chromium } = require(process.env.NODE_PATH + '/playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8099/'; const LOG = require('../lib/env').SLACK_LOG;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const log = () => { try { return fs.readFileSync(LOG, 'utf8'); } catch (e) { return ''; } };
(async () => {
  fs.writeFileSync(LOG, '');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const a = await ctx.newPage(); a.on('pageerror', e => console.log('PAGEERR', e.message)); a.on('dialog', d => d.accept());
  await a.goto(BASE + 'login.php'); await a.fill('input[name=email]', 'admin@example.com'); await a.fill('input[name=password]', 'adminpass1');
  await Promise.all([a.waitForURL('**/index.php'), a.click('button[type=submit]')]); await a.waitForSelector('.cal');
  // 1) 会社用リンクが無い状態: 案内が出て、見本のリンクは入口(view=team)
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-slack .slack-status');
  ok('会社用リンクが無いとき、作るよう案内が出る', (await a.locator('#set-slack').innerText()).includes('会社用リンクを作ってください'));
  await a.waitForSelector('#set-slackcfg .slack-preview'); await a.locator('#set-slackcfg .slack-sec').nth(0).locator('button:has-text("見本を Slack に送る")').click(); await a.waitForSelector('.slack-result.ok'); await a.waitForTimeout(400);
  ok('リンクは入口（index.php?view=team）', log().includes('index.php?view=team|スケジュールを開く'), log());
  await a.click('button:has-text("カレンダーに戻る")'); await a.waitForSelector('.cal');
  // 2) 会社用リンクを作る
  const tok = await a.evaluate(async () => { const me = await (await fetch('api.php?action=me')).json(); const r = await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf }, body: JSON.stringify({ kind: 'company' }) }); return await r.json(); });
  const path = tok.path || (tok.link && tok.link.path); ok('会社用リンクが作れた', !!path, tok);
  fs.writeFileSync(LOG, '');
  await a.reload(); await a.waitForSelector('.cal'); await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-slack .slack-status');
  ok('状態の案内が、会社用リンクに切り替わる', (await a.locator('#set-slack').innerText()).includes('会社用の共有リンクに飛びます'));
  await a.waitForSelector('#set-slackcfg .slack-preview'); await a.locator('#set-slackcfg .slack-sec').nth(0).locator('button:has-text("見本を Slack に送る")').click(); await a.waitForSelector('.slack-result.ok'); await a.waitForTimeout(400);
  const m = log().replace(/\\\//g, "/").match(/<https:\/\/example\.com\/schedule\/(share\.php\?t=[a-f0-9]{48})\|スケジュールを開く>/); ok('通知のリンクが、会社用の共有リンク', !!m, log());
  // 3) ログインなしで開ける（業務版のカレンダー）
  const g = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); g.on('pageerror', e => console.log('PAGEERR', e.message));
  await g.goto(BASE + (m ? m[1] : path)); await g.waitForSelector('.cal'); ok('ログインなしで、業務カレンダーが見られる', (await g.title()).includes('業務カレンダー') && !g.url().includes('login'), g.url());
  // 4) 入口 view=team: プライベート版で閉じた端末でも、業務版で開く
  await a.evaluate(() => localStorage.setItem('sched.view', JSON.stringify('me'))); await a.goto(BASE + 'index.php'); await a.waitForSelector('.cal');
  ok('（前提）view指定なしだと、前回のプライベート版', (await a.locator('.view-banner').innerText()).includes('プライベート版'));
  await a.goto(BASE + 'index.php?view=team'); await a.waitForSelector('.cal'); await a.waitForTimeout(300);
  ok('?view=team で開くと、業務版', (await a.locator('.view-banner').innerText()).includes('業務版'), await a.locator('.view-banner').innerText());
  ok('開いたあと、URLから ?view=team が消える', !a.url().includes('view='), a.url());
  // 未ログイン→ログイン後は index.php に着く（業務版）
  const n = await (await b.newContext()).newPage(); await n.goto(BASE + 'index.php?view=team'); ok('未ログインはログイン画面へ', n.url().includes('login.php'), n.url());
  await b.close(); console.log(fails ? 'NG ' + fails : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
