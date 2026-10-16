const { chromium } = require(process.env.NODE_PATH + '/playwright');
const openSeries = require('../lib/series');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (name, cond) => { console.log((cond ? 'OK  ' : 'NG  ') + name); if (!cond) fails++; };

async function login(browser, email, pw) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('response', async r => { if (r.status() >= 400 && r.status() !== 403) console.log('   HTTP', r.status(), r.request().method(), decodeURIComponent(r.url()).slice(-90), (await r.text()).slice(0, 100)); });
  page.on('console', m => m.type() === 'error' && !/status of 403/.test(m.text()) && errs.push(m.text()));
  await page.goto(BASE + 'login.php');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', pw);
  await Promise.all([page.waitForURL('**/index.php'), page.click('button[type=submit]')]);
  await page.waitForSelector('.cal');
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch();

  // --- 山田さん（一般社員）---
  const y = await login(browser, 'yamada@example.com', 'yamadapass1');
  ok('ログインしてカレンダーが出る', await y.page.locator('.cal').count() === 1);

  // 繰り返し業務の例を一括登録
  await openSeries(y.page);
  await y.page.click('text=よくある月次業務の例（6件）をまとめて登録');
  await y.page.waitForSelector('.card .name >> text=請求処理');
  ok('6件のルールが登録される', await y.page.locator('.modal .card .name').count() === 6);
  await y.page.screenshot({ path: 'series.png' });
  await y.page.click('.modal >> text=閉じる');

  // 今月の予定にルールからの予定が入っている
  await y.page.waitForSelector('.bar:has-text("給与計算の準備")');
  ok('繰り返し予定がカレンダーに出る', await y.page.locator('.bar:has-text("請求処理")').count() >= 1);

  // 予定を追加: 業務・休み
  const today = new Date(); const pad = n => (n < 10 ? '0' : '') + n;
  const ymd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  await y.page.keyboard.press('n');
  await y.page.fill('input[name=title]', 'A社 打ち合わせ');
  await y.page.selectOption('select[name=tag]', '打ち合わせ');
  await y.page.fill('input[name=start]', ymd);
  await y.page.click('.modal button[type=submit]');
  await y.page.waitForSelector('.bar:has-text("A社 打ち合わせ")');
  ok('業務の予定が追加できる', true);

  await y.page.keyboard.press('n');
  await y.page.check('input[name=kind][value=off]');
  await y.page.selectOption('select[name=tag]', '有給');
  await y.page.fill('input[name=start]', ymd);
  await y.page.click('.modal button[type=submit]');
  await y.page.waitForSelector('.bar.off');
  ok('休みが追加できる（件名は空でよい）', await y.page.locator('.bar.off:has-text("山田 花子 有給")').count() >= 1);

  // プライベート版で追加
  await y.page.click('.tab[data-view=me]');
  await y.page.waitForSelector('.view-banner.me');
  await y.page.keyboard.press('n');
  ok('プライベート版ではプライベートが初期選択', await y.page.locator('input[name=kind][value=private]').isChecked());
  await y.page.fill('input[name=title]', '歯医者（秘密）');
  await y.page.fill('input[name=start]', ymd);
  await y.page.click('.modal button[type=submit]');
  await y.page.waitForSelector('.bar.private');
  ok('プライベート版にプライベートが出る', await y.page.locator('.bar.private:has-text("歯医者（秘密）")').count() === 1);
  await y.page.screenshot({ path: 'me.png', fullPage: true });

  // 「表示する業務」のチェックは無い。家族に共有していない業務は、プライベート版に出ない
  ok('「表示する業務」のチェックは無い', await y.page.locator('.fchip, .filters').count() === 0);
  ok('共有していない業務は、プライベート版に出ない', await y.page.locator('.bar.work:has-text("A社")').count() === 0);
  ok('プライベートは残る', await y.page.locator('.bar.private').count() === 1);

  // 業務版にはプライベートが出ない
  await y.page.click('.tab[data-view=team]');
  await y.page.waitForTimeout(500);
  ok('業務版にプライベートは出ない', await y.page.locator('.bar.private').count() === 0 && (await y.page.content()).indexOf('歯医者') < 0);
  await y.page.screenshot({ path: 'team.png', fullPage: true });

  // --- 鈴木さん（別の一般社員）---
  const s = await login(browser, 'suzuki@example.com', 'suzukipass1');
  await s.page.selectOption('#who-sel', 'all'); await s.page.waitForSelector('.bar:has-text("A社")');
  ok('鈴木さんに山田さんの業務・休みが見える', await s.page.locator('.bar:has-text("A社")').count() === 1 && await s.page.locator('.bar.off:has-text("山田")').count() >= 1);
  await s.page.click('.tab[data-view=me]');
  await s.page.waitForTimeout(500);
  ok('鈴木さんのプライベート版に山田さんのプライベートは出ない', (await s.page.content()).indexOf('歯医者') < 0);
  // APIを直接叩いても返らない
  const raw = await s.page.evaluate(async () => {
    const f = d => ((x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'))(d);
    const from = f(new Date(Date.now() - 30 * 864e5)), to = f(new Date(Date.now() + 30 * 864e5));
    const r1 = await fetch(`api.php?action=events&from=${from}&to=${to}&view=team`);
    const r2 = await fetch(`api.php?action=events&from=${from}&to=${to}&view=me&tags=全体会議,打ち合わせ,定例業務,個人作業,その他&off=1`);
    return [await r1.text(), await r2.text()];
  });
  ok('（確認）APIの応答が正常で、今日の予定を含んでいる（プライベート版には、他の人の業務は出ない）', raw.every(t => t.indexOf('"events"') >= 0) && raw[0].indexOf('A社') >= 0 && raw[1].indexOf('A社') < 0);
  ok('APIの応答にプライベートの文字列が含まれない', raw.every(t => t.indexOf('歯医者') < 0));
  // 他人の休みは一般社員は編集不可（詳細表示のみ）
  await s.page.click('.tab[data-view=team]');
  await s.page.waitForTimeout(400);
  await s.page.click('.bar.off >> nth=0');
  ok('他人の休みは閲覧のみ', await s.page.locator('.modal >> text=予定の詳細').count() === 1);
  await s.page.click('.modal >> text=閉じる');
  // 権限なしAPI
  const forb = await s.page.evaluate(async () => {
    const me = await (await fetch('api.php?action=me')).json();
    const r = await fetch('api.php?action=users_list');
    const r2 = await fetch('api.php?action=event_save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return [r.status, r2.status];
  });
  ok('一般社員は社員管理APIを使えない(403)', forb[0] === 403);
  ok('CSRFトークンなしの更新は拒否(403)', forb[1] === 403);
  ok('設定のページに管理項目がない', await (async () => { await s.page.click('header button:has-text("設定")'); await s.page.waitForSelector('.settings-page'); const n = (await s.page.locator('#set-users').count()) === 0; await s.page.click('button:has-text("カレンダーに戻る")'); await s.page.waitForSelector('.cal'); return n; })());

  // --- 管理者 ---
  const a = await login(browser, 'admin@example.com', 'adminpass1');
  await a.page.selectOption('#who-sel', 'all');
  await a.page.waitForSelector('.bar.off');
  ok('管理者にも山田さんのプライベートは見えない', (await a.page.content()).indexOf('歯医者') < 0);
  await a.page.click('.tab[data-view=me]'); await a.page.waitForTimeout(500);
  ok('管理者のプライベート版にも出ない', (await a.page.content()).indexOf('歯医者') < 0);
  await a.page.click('.tab[data-view=team]'); await a.page.waitForTimeout(300);
  // 管理者が他の社員の休みを代理登録
  await a.page.keyboard.press('n');
  await a.page.check('input[name=kind][value=off]');
  ok('管理者には「休みを取る人」が出る', await a.page.locator('select[name=owner_id]').isVisible());
  const tomorrow = new Date(Date.now() + 86400000 * 3); const t3 = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  await a.page.selectOption('select[name=owner_id]', { label: '鈴木 一郎' });
  await a.page.fill('input[name=start]', t3);
  await a.page.click('.modal button[type=submit]');
  await a.page.waitForSelector('.bar.off:has-text("鈴木")');
  ok('管理者が他の社員の休みを登録できる', true);
  // 管理者が山田さんの休みを編集できる
  await a.page.click('.bar.off:has-text("山田") >> nth=0');
  ok('管理者は他人の休みを編集できる(フォーム表示)', await a.page.locator('.modal input[name=title]').count() === 1);
  await a.page.click('.modal >> text=キャンセル');
  // 社員管理
  await a.page.click('header button:has-text("設定")');
  await a.page.waitForSelector('#set-users tbody tr');
  ok('社員一覧に3名', await a.page.locator('#set-users tbody tr').count() === 3);
  await a.page.screenshot({ path: 'admin-users.png' });
  await a.page.click('button:has-text("カレンダーに戻る")'); await a.page.waitForSelector('.cal');

  // --- 管理者が新しい社員を登録 → 初回ログインでパスワード変更を求める ---
  await a.page.click('header button:has-text("設定")'); await a.page.waitForSelector('#set-users tbody tr');
  await a.page.click('#set-users >> text=＋ 社員を追加');
  await a.page.fill('.modal input[name=name]', '新人 次郎');
  await a.page.fill('.modal input[name=email]', 'newbie@example.com');
  await a.page.fill('.modal input[name=password]', 'initial-pass1');
  await a.page.click('.modal button[type=submit]');
  await a.page.waitForSelector('#set-users tbody tr >> text=新人 次郎');
  ok('管理者の一覧に「初回パスワード未変更」と出る', await a.page.locator('#set-users td:has-text("新人 次郎（初回パスワード未変更）")').count() === 1);
  await a.page.screenshot({ path: 'admin-users2.png' });
  await a.page.click('button:has-text("カレンダーに戻る")'); await a.page.waitForSelector('.cal');

  const n = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const np = await n.newPage();
  const nerrs = [];
  np.on('pageerror', e => nerrs.push(String(e)));
  await np.goto(BASE + 'login.php');
  await np.fill('input[name=email]', 'newbie@example.com'); await np.fill('input[name=password]', 'initial-pass1');
  await Promise.all([np.waitForURL('**/index.php'), np.click('button[type=submit]')]);
  await np.waitForSelector('.notice');
  ok('初回ログインでパスワード変更のお知らせが出る', (await np.locator('.notice').innerText()).indexOf('はじめにパスワードを変更') >= 0);
  ok('カレンダーはまだ出ない', await np.locator('.cal, .topbar').count() === 0);
  ok('閉じるボタンがない', await np.locator('.modal [aria-label=閉じる]').count() === 0);
  await np.keyboard.press('Escape');
  await np.mouse.click(5, 5);
  ok('Esc・外側クリックでも閉じない', await np.locator('.modal').count() === 1);
  const gate = await np.evaluate(async () => {
    const f = d => ((x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'))(d);
    const r = await fetch(`api.php?action=events&from=${f(new Date())}&to=${f(new Date(Date.now() + 864e5))}&view=team`);
    return r.status;
  });
  ok('変更前は予定のAPIも使えない(403)', gate === 403);
  await np.screenshot({ path: 'forced-pw.png' });
  await np.fill('.modal input[autocomplete=current-password]', 'initial-pass1');
  await np.fill('.modal input[autocomplete=new-password]', 'initial-pass1');
  await np.click('.modal button[type=submit]');
  await np.waitForSelector('.modal .error:not([hidden])');
  ok('同じパスワードへの変更は拒否', (await np.locator('.modal .error').innerText()).indexOf('別のパスワード') >= 0);
  await np.fill('.modal input[autocomplete=new-password]', 'short');
  await np.click('.modal button[type=submit]');
  await np.waitForTimeout(300);
  await np.fill('.modal input[autocomplete=new-password]', 'my-own-pass-2');
  await np.click('.modal button[type=submit]');
  await np.waitForSelector('.cal');
  ok('変更後にカレンダーが出る', await np.locator('.topbar').count() === 1 && await np.locator('.modal').count() === 0);
  // 再ログイン: 新しいパスワードで入れて、もう変更を求められない
  await np.evaluate(() => { const f = document.createElement('form'); f.method = 'post'; f.action = 'logout.php'; document.body.appendChild(f); });
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.goto(BASE + 'login.php');
  await p2.fill('input[name=email]', 'newbie@example.com'); await p2.fill('input[name=password]', 'initial-pass1');
  await p2.click('button[type=submit]'); await p2.waitForTimeout(900);
  ok('古い初期パスワードではログインできない', p2.url().indexOf('login.php') >= 0);
  await p2.fill('input[name=password]', 'my-own-pass-2');
  await Promise.all([p2.waitForURL('**/index.php'), p2.click('button[type=submit]')]);
  await p2.waitForSelector('.cal, .notice');
  ok('2回目以降は変更を求められない', await p2.locator('.notice').count() === 0 && await p2.locator('.topbar').count() === 1);
  ok('新しい人のブラウザエラーなし', nerrs.length === 0);

  // 一般社員の画面(スマホ幅)
  const m = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const mp = await m.newPage();
  await mp.goto(BASE + 'login.php');
  await mp.fill('input[name=email]', 'yamada@example.com'); await mp.fill('input[name=password]', 'yamadapass1');
  await Promise.all([mp.waitForURL('**/index.php'), mp.click('button[type=submit]')]);
  await mp.waitForSelector('.cal');
  
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  ok('スマホ幅で横スクロールしない', !overflow);
  await mp.screenshot({ path: 'mobile.png', fullPage: true });

  const allErrs = [].concat(y.errs, s.errs, a.errs);
  ok('ブラウザのエラーなし ' + JSON.stringify(allErrs), allErrs.length === 0);
  console.log(fails ? `\n失敗 ${fails}` : '\nすべて成功');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
