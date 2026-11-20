// 上の帯の「アプリ ▾」（ポータルへ戻る・ほかのアプリへ移る。v1.119.0）: パソコン・スマホ・設定のページ・年間計画・ログインの画面
// ポータル・ほかのアプリの URL は本物（https://…skym.ink）なので、ブラウザの中で受け止めて、移った先の URL だけを確かめる
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
  const links = p => p.$$eval('#app-list a', as => as.map(a => ({ id: a.dataset.app, text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target') })));

  // ---- ログインの画面: 下に「← ポータルへ戻る」
  const p = await mk();
  await p.goto(BASE + 'login.php');
  ok('ログインの画面の下に「← ポータルへ戻る」（ポータルの URL）', (await p.getAttribute('#login-portal', 'href')) === PORTAL && (await p.locator('#login-portal').innerText()).includes('ポータルへ戻る'));

  // ---- パソコン: 一般の社員（ポータルから入ったことがない = 経理のアプリは出ない）
  await login(p, 'yamada@example.com', 'yamadapass1');
  const btn = p.locator('#btn-apps');
  ok('上の帯に「アプリ ▾」のボタン（aria-haspopup・aria-expanded）', await btn.isVisible() && (await btn.innerText()).includes('アプリ') && (await btn.getAttribute('aria-haspopup')) === 'true' && (await btn.getAttribute('aria-expanded')) === 'false');
  ok('初めは、一覧は閉じている', (await p.locator('#app-list').count()) === 0);
  await btn.click();
  let l = await links(p);
  ok('押すと開く: 「← ポータルへ戻る」・区切りの線・ほかのアプリ（このアプリ自身と、経理のアプリは出ない）', await p.locator('#app-list').isVisible() && (await btn.getAttribute('aria-expanded')) === 'true'
    && JSON.stringify(l.map(x => x.id)) === '["portal","password"]' && l[0].href === PORTAL && l[0].text.includes('ポータルへ戻る') && (await p.locator('#app-list .menu-sep').count()) === 1, l);
  ok('ほかのアプリは、受け取り口（sso.php）へ。同じタブで移る（target なし）', l[1].href === 'https://password-manager.skym.ink/public/sso.php' && l[1].text === 'パスワード管理' && l.every(x => !x.target), l);
  const box = await p.locator('#app-list').boundingBox();
  ok('開いた一覧は、画面の中に収まる', box && box.x >= 0 && box.x + box.width <= 1280, box);
  await p.click('header .brand'); // カレンダーのマスを押すと、予定の入力が開くので、アプリ名のところを押す
  ok('外を押すと閉じる', (await p.locator('#app-list').count()) === 0 && (await btn.getAttribute('aria-expanded')) === 'false');
  await btn.click(); await p.click('header .uname');
  ok('名前のメニューを開くと、「アプリ」の一覧は閉じる（同時に開くのは1つ）', (await p.locator('#app-list').count()) === 0 && await p.locator('header .menu-list:not(#app-list)').isVisible());
  ok('パソコンでは、名前のメニューの中のアプリのリンクは出さない', await p.locator('#user-apps').isHidden());
  await btn.click();
  ok('「アプリ」を開くと、名前のメニューは閉じる', await p.locator('#app-list').isVisible() && (await p.locator('header .menu-list:not(#app-list)').count()) === 0);
  await Promise.all([p.waitForURL('https://password-manager.skym.ink/public/sso.php'), p.click('#app-list a[data-app=password]')]);
  ok('パスワード管理を押すと、その受け取り口へ移る', p.url() === 'https://password-manager.skym.ink/public/sso.php', p.url());

  // ---- ポータルで経理か管理者の人（portal_acc = 1）には、経理のアプリも出る
  sql("UPDATE users SET portal_acc = 1 WHERE email = 'yamada@example.com'");
  await p.goto(BASE + 'index.php'); await p.waitForSelector('.cal');
  await p.click('#btn-apps'); l = await links(p);
  await p.screenshot({ path: 'appnav-pc.png', clip: { x: 0, y: 0, width: 760, height: 300 } });
  ok('経理の人には、給与計算・請求書も出る（小さく「経理」の印）', JSON.stringify(l.map(x => x.id)) === '["portal","password","payroll","invoice"]' && (await p.locator('#app-list a[data-app=payroll] .menu-acc').innerText()) === '経理'
    && (await p.locator('#app-list a[data-app=password] .menu-acc').count()) === 0 && l[2].href === 'https://payroll.skym.ink/' && l[3].href === 'https://skym.ink/invoice/', l);
  await Promise.all([p.waitForURL(PORTAL), p.click('#app-list a[data-app=portal]')]);
  ok('「← ポータルへ戻る」を押すと、ポータルへ移る', p.url() === PORTAL, p.url());

  // ---- 設定のページ・年間計画のページにも出る
  await p.goto(BASE + 'index.php#settings'); await p.waitForSelector('.settings-page');
  ok('設定のページの上の帯にも「アプリ ▾」', await p.locator('.settings-bar #btn-apps').isVisible());
  await p.click('#btn-apps');
  ok('設定のページでも開いて、同じリンク', JSON.stringify((await links(p)).map(x => x.id)) === '["portal","password","payroll","invoice"]');
  await p.click('.settings-page > h2');
  ok('設定のページでも、外を押すと閉じる', (await p.locator('#app-list').count()) === 0);
  await p.goto(BASE + 'index.php#annual'); await p.waitForSelector('#insp-btn.on');
  ok('年間計画のページの上の帯にも「アプリ ▾」', await p.locator('#btn-apps').isVisible());

  // ---- 管理者（ポータルから入ったことがない）
  sql("UPDATE users SET portal_acc = 0 WHERE email = 'yamada@example.com'");
  const a = await mk(); await login(a, 'admin@example.com', 'adminpass1');
  await a.click('#btn-apps');
  ok('ポータルから入ったことのない管理者には、経理のアプリは出ない（ポータルで確かめた値だけを使う）', JSON.stringify((await links(a)).map(x => x.id)) === '["portal","password"]');

  // ---- スマホ: 上の帯には置かず、名前のメニューの中に出す
  const m = await mk({ width: 390, height: 844 }); await login(m, 'yamada@example.com', 'yamadapass1');
  ok('スマホのカレンダーでは、上の帯に「アプリ」を出さない', await m.locator('#btn-apps').isHidden());
  ok('スマホでも、横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await m.click('header .uname');
  const ua = await m.$$eval('#user-apps a', as => as.map(a => ({ id: a.dataset.app, href: a.getAttribute('href') })));
  ok('名前のメニューの中に、ポータルへ戻る・パスワード管理（経理のアプリは出ない）', await m.locator('#user-apps').isVisible() && JSON.stringify(ua.map(x => x.id)) === '["portal","password"]' && ua[0].href === PORTAL, ua);
  await m.screenshot({ path: 'appnav-phone.png', clip: { x: 0, y: 0, width: 390, height: 460 } });
  const mb = await m.locator('header .menu-list:not(#app-list)').boundingBox();
  ok('名前のメニューは、画面の中に収まる', mb && mb.x >= 0 && mb.x + mb.width <= 390, mb);
  const hidden = await m.evaluate(() => [...document.querySelectorAll('#user-apps a')].filter(a => { const r = a.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !t || !a.contains(t); }).map(a => a.textContent));
  ok('名前のメニューのアプリのリンクは、ほかの要素の後ろに隠れない', hidden.length === 0, hidden);
  ok('名前のメニューの、いつもの項目（パスワードの変更・ログアウト）も残る', (await m.locator('header .menu-list:not(#app-list)').innerText()).includes('パスワードの変更') && (await m.locator('header .menu-list:not(#app-list)').innerText()).includes('ログアウト'));
  await m.click('header .uname'); // 開いた一覧が見出しに重なるので、閉じるときは名前のボタンを押す
  ok('名前のボタンを押すと閉じる', (await m.locator('header .menu-list:not(#app-list)').count()) === 0);
  await m.click('header .uname');
  await Promise.all([m.waitForURL('https://password-manager.skym.ink/public/sso.php'), m.click('#user-apps a[data-app=password]')]);
  ok('スマホ: 名前のメニューから、パスワード管理の受け取り口へ移る', m.url() === 'https://password-manager.skym.ink/public/sso.php', m.url());

  // スマホの設定のページ（名前のメニューがない）では、上の帯に「アプリ」を出す
  await m.goto(BASE + 'index.php#settings'); await m.waitForSelector('.settings-page');
  ok('スマホの設定のページでは、上の帯に「アプリ ▾」', await m.locator('.settings-bar #btn-apps').isVisible());
  const bar = await m.evaluate(() => { const t = document.querySelector('.topbar-in'); return { sw: document.documentElement.scrollWidth, h: t.getBoundingClientRect().height }; });
  ok('スマホの設定のページの上の帯は、1行に収まり、横にはみ出さない', bar.sw <= 390 && bar.h < 60, bar);
  await m.click('#btn-apps');
  await m.screenshot({ path: 'appnav-phone-settings.png', clip: { x: 0, y: 0, width: 390, height: 300 } });
  const sb = await m.locator('#app-list').boundingBox();
  ok('スマホの設定のページでも開き、画面の中に収まる', sb && sb.x >= 0 && sb.x + sb.width <= 390, sb);
  await Promise.all([m.waitForURL(PORTAL), m.click('#app-list a[data-app=portal]')]);
  ok('スマホの設定のページから、ポータルへ戻る', m.url() === PORTAL, m.url());

  // ---- ダークモードでも、リンクの字が読める（背景と同じ色にならない）
  const d = await mk(); await d.emulateMedia({ colorScheme: 'dark' }); await login(d, 'yamada@example.com', 'yamadapass1');
  await d.click('#btn-apps');
  const col = await d.evaluate(() => { const a = document.querySelector('#app-list a'); const l = document.getElementById('app-list'); return [getComputedStyle(a).color, getComputedStyle(l).backgroundColor]; });
  ok('ダークモード: 一覧の字と背景の色が違う', col[0] !== col[1], col);

  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
