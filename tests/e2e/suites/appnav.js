// 上の帯の「アプリ ▾」（Hub へ戻る・ほかのアプリへ移る。v1.119.0）: パソコン・スマホ・設定のページ・年間計画・ログインの画面
// Hub・ほかのアプリの URL は本物（https://…skym.ink）なので、ブラウザの中で受け止めて、移った先の URL だけを確かめる
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { sql } = require('../lib/env');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
const PORTAL = 'https://portal.skym.ink/public/';
(async () => {
  const b = await chromium.launch();
  const mk = async (vp) => {
    const c = await b.newContext({ viewport: vp || { width: 1280, height: 900 } });
    await c.route(/^https:\/\/([a-z-]+\.)?skym\.ink\//, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>' }));
    const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); return p;
  };
  const login = async (p, em, pw) => { await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); };
  const links = p => p.$$eval('.hb-sw-list a', as => as.map(a => ({ id: a.dataset.app || 'portal', text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target') })));
  const sw = p => p.locator('.hb-sw-list');
  const um = p => p.locator('.hb-user-list');

  // ---- ログインの画面: 下に「← Hub へ戻る」
  const p = await mk();
  await p.goto(BASE + 'login.php');
  ok('ログインの画面の下に「← Hub へ戻る」（Hub の URL）', (await p.getAttribute('#login-portal', 'href')) === PORTAL && (await p.locator('#login-portal').innerText()).includes('Hub へ戻る'));

  // ---- パソコン: 一般の社員（Hub から入ったことがない = 経理のアプリは出ない）
  // 上の帯は、Hub とつながる全アプリで共通の部品（v1.122.0〜）。アプリ名 ▾（#btn-apps）で、Hub・ほかのアプリへ
  await login(p, 'yamada@example.com', 'yamadapass1');
  const btn = p.locator('#btn-apps');
  ok('上の帯に、アプリ名 ▾ のボタン（aria-haspopup・aria-expanded）', await btn.isVisible() && (await btn.innerText()).includes('スケジュール管理') && (await btn.getAttribute('aria-haspopup')) === 'true' && (await btn.getAttribute('aria-expanded')) === 'false');
  ok('上の帯の左上の SKYM は、Hub へのリンク', (await p.getAttribute('.hb-home', 'href')) === PORTAL);
  ok('初めは、一覧は閉じている', await sw(p).isHidden());
  await btn.click();
  let l = await links(p);
  ok('押すと開く: アプリの一覧（Hub）・ほかのアプリ（このアプリ自身と、経理のアプリは出ない）', await sw(p).isVisible() && (await btn.getAttribute('aria-expanded')) === 'true'
    && JSON.stringify(l.map(x => x.id)) === '["portal","password","kinmuhyo"]' && l[0].href === PORTAL && l[0].text.includes('アプリの一覧'), l);
  ok('ほかのアプリは、受け取り口（sso.php）へ。同じタブで移る（target なし）', l[1].href === 'https://password-manager.skym.ink/public/sso.php' && l[1].text === 'パスワード管理' && l[2].href === 'https://kinmuhyo-auto.skym.ink/sso.php' && !l[1].target, l);
  const box = await sw(p).boundingBox();
  ok('開いた一覧は、画面の中に収まる', box && box.x >= 0 && box.x + box.width <= 1280, box);
  await p.click('.hb-app-pola'); // カレンダーのマスを押すと、予定の入力が開くので、帯の絵のところを押す
  ok('外を押すと閉じる', await sw(p).isHidden() && (await btn.getAttribute('aria-expanded')) === 'false');
  await btn.click(); await p.click('#btn-user');
  ok('名前のメニューを開くと、アプリの一覧は閉じる（同時に開くのは1つ）', await sw(p).isHidden() && await um(p).isVisible());
  const menu = await um(p).evaluate(e => [...e.querySelectorAll('.hb-sec, .hb-mi')].map(x => x.textContent));
  ok('名前のメニュー: このアプリ（設定・年間計画・パスワードの変更・繰り返し業務）→ Hub（Hub に戻る・自分の設定）→ ログアウト',
    menu.join('|') === 'このアプリ|設定|年間計画|パスワードの変更|繰り返し業務|Hub|Hub に戻る|自分の設定パスワード・端末|ログアウト', menu);
  ok('自分の設定は、Hub の設定（#settings）', (await p.getAttribute('#hb-me', 'href')) === PORTAL + '#settings');
  await btn.click();
  ok('アプリの一覧を開くと、名前のメニューは閉じる', await sw(p).isVisible() && await um(p).isHidden());
  await Promise.all([p.waitForURL('https://password-manager.skym.ink/public/sso.php'), p.click('.hb-sw-list a[data-app=password]')]);
  ok('パスワード管理を押すと、その受け取り口へ移る', p.url() === 'https://password-manager.skym.ink/public/sso.php', p.url());

  // ---- Hub で経理か管理者の人（portal_acc = 1）には、経理のアプリも出る
  sql("UPDATE users SET portal_acc = 1 WHERE email = 'yamada@example.com'");
  await p.goto(BASE + 'index.php'); await p.waitForSelector('.cal');
  await p.click('#btn-apps'); l = await links(p);
  await p.screenshot({ path: 'appnav-pc.png', clip: { x: 0, y: 0, width: 760, height: 360 } });
  ok('経理の人には、給与計算・請求書も出る', JSON.stringify(l.map(x => x.id)) === '["portal","password","payroll","invoice","kinmuhyo"]' && l[2].href === 'https://payroll.skym.ink/' && l[3].href === 'https://skym.ink/invoice/', l);
  await Promise.all([p.waitForURL(PORTAL), p.click('.hb-sw-list a:not([data-app])')]);
  ok('アプリの一覧（Hub）を押すと、Hub へ移る', p.url() === PORTAL, p.url());

  // ---- 設定のページ・年間計画のページにも、同じ帯
  await p.goto(BASE + 'index.php#settings'); await p.waitForSelector('.settings-page');
  ok('設定のページの上の帯にも、アプリ名 ▾', await p.locator('#btn-apps').isVisible());
  await p.click('#btn-apps');
  ok('設定のページでも開いて、同じリンク', JSON.stringify((await links(p)).map(x => x.id)) === '["portal","password","payroll","invoice","kinmuhyo"]');
  await p.click('.settings-page > h2');
  ok('設定のページでも、外を押すと閉じる', await sw(p).isHidden());
  await p.goto(BASE + 'index.php#annual'); await p.waitForSelector('#insp-btn.on');
  ok('年間計画のページの上の帯にも、アプリ名 ▾', await p.locator('#btn-apps').isVisible());

  // ---- 管理者（Hub から入ったことがない）
  sql("UPDATE users SET portal_acc = 0 WHERE email = 'yamada@example.com'");
  const a = await mk(); await login(a, 'admin@example.com', 'adminpass1');
  await a.click('#btn-apps');
  ok('Hub から入ったことのない管理者には、経理のアプリは出ない（Hub で確かめた値だけを使う）', JSON.stringify((await links(a)).map(x => x.id)) === '["portal","password","kinmuhyo"]');
  await a.click('#btn-user');
  ok('管理者の名前のメニューには「会社の管理」', (await um(a).innerText()).includes('会社の管理'));

  // ---- スマホ: アプリ名 ▾ は、下の段の幅いっぱいに開く
  const m = await mk({ width: 390, height: 844 }); await login(m, 'yamada@example.com', 'yamadapass1');
  ok('スマホでも、アプリ名 ▾ が上の帯にある', await m.locator('#btn-apps').isVisible());
  ok('スマホでも、横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await m.click('#btn-apps');
  await m.screenshot({ path: 'appnav-phone.png', clip: { x: 0, y: 0, width: 390, height: 460 } });
  const mb = await sw(m).boundingBox();
  ok('スマホ: 開いた一覧は、画面の中に収まる', mb && mb.x >= 0 && mb.x + mb.width <= 390, mb);
  await Promise.all([m.waitForURL('https://password-manager.skym.ink/public/sso.php'), m.click('.hb-sw-list a[data-app=password]')]);
  ok('スマホ: パスワード管理の受け取り口へ移る', m.url() === 'https://password-manager.skym.ink/public/sso.php', m.url());
  await m.goto(BASE + 'index.php'); await m.waitForSelector('.cal');
  await m.click('#btn-user');
  const ub = await um(m).boundingBox();
  ok('スマホ: 名前のメニューは、画面の中に収まる', ub && ub.x >= 0 && ub.x + ub.width <= 390, ub);
  const hidden = await m.evaluate(() => [...document.querySelectorAll('.hb-user-list .hb-mi')].filter(a => { const r = a.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !t || !a.contains(t); }).map(a => a.textContent));
  ok('スマホ: 名前のメニューの項目は、ほかの要素の後ろに隠れない', hidden.length === 0, hidden);
  await m.click('#btn-user');
  ok('スマホ: 名前のボタンを押すと閉じる', await um(m).isHidden());
  await m.goto(BASE + 'index.php#settings'); await m.waitForSelector('.settings-page');
  ok('スマホの設定のページも、横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  // ---- ダークモードでも、リンクの字が読める（背景と同じ色にならない）
  const d = await mk(); await d.emulateMedia({ colorScheme: 'dark' }); await login(d, 'yamada@example.com', 'yamadapass1');
  await d.click('#btn-apps');
  const col = await d.evaluate(() => { const a = document.querySelector('.hb-sw-list a[data-app]'); const l = document.querySelector('.hb-sw-list'); return [getComputedStyle(a).color, getComputedStyle(l).backgroundColor]; });
  ok('ダークモード: 一覧の字と背景の色が違う', col[0] !== col[1], col);

  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
