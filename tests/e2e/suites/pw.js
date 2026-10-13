const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
(async () => { const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  const get = async (u) => { const r = await fetch(BASE + u); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
  const m = await get('manifest.php'); const mj = JSON.parse(m.text);
  ok('manifest.php が、ログインなしで読める（JSON・アプリ名・standalone）', m.status === 200 && /manifest\+json/.test(m.type) && mj.display === 'standalone' && mj.name === 'スケジュール管理' && mj.start_url === 'index.php', [m.status, m.type, mj]);
  const imgs = []; for (const ic of mj.icons) { const r = await fetch(BASE + ic.src); imgs.push([r.status, r.headers.get('content-type')]); } imgs.push((await fetch(BASE + 'assets/icons/apple-touch-icon.png')).status);
  ok('アイコン（192・512・maskable・apple）が、ログインなしで取れる（PNG）', imgs.slice(0, 3).every(x => x[0] === 200 && x[1] === 'image/png') && imgs[3] === 200 && mj.icons.some(i => i.purpose === 'maskable'), imgs);
  ok('マニフェストの説明（ログインしていなくても、中身はアプリ名とアイコンだけ）', Object.keys(mj).every(k => ['name', 'short_name', 'id', 'start_url', 'scope', 'display', 'orientation', 'lang', 'background_color', 'theme_color', 'icons'].includes(k)));
  // ページの <head>
  await p.goto(BASE + 'login.php'); const head = await p.evaluate(() => ({ man: document.querySelector('link[rel=manifest]')?.getAttribute('href'), apple: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href'), theme: document.querySelector('meta[name=theme-color]')?.content, cap: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content }));
  ok('ログイン画面に、マニフェスト・アイコン・テーマ色の指定がある', head.man === 'manifest.php' && !!head.apple && !!head.theme && head.cap === 'yes', head);
  await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  ok('アプリの画面にも、同じ指定がある', (await p.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'))) === 'manifest.php');
  // 設定のページ: ホーム画面に追加
  await p.click('header button:has-text("設定")'); await p.waitForSelector('#set-install'); const it = await p.locator('#set-install').innerText();
  ok('設定のページに、「ホーム画面に追加」の手順（iPhone・Android）が出る', it.includes('iPhone（Safari）') && it.includes('Android（Chrome）') && it.includes('ホーム画面に追加'), it);
  // 共有リンク
  const sh = await p.evaluate(async () => { const tk = document.getElementById('app').dataset.csrf; const f = k => fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify({ kind: k }) }).then(x => x.json()); return [(await f('company')).path, (await f('family')).path]; });
  const tok = sh[1].split('t=')[1]; const sm = await get('manifest.php?t=' + tok); const smj = JSON.parse(sm.text);
  ok('共有リンク用のマニフェストは、その共有ページが開く（start_url）。名前は共有ページの名前', sm.status === 200 && smj.start_url === 'share.php?t=' + tok && /家族用/.test(smj.name), smj);
  const bad = await get('manifest.php?t=' + 'a'.repeat(48)); const bad2 = await get('manifest.php?t=abc'); ok('無効な共有リンクのマニフェストは、404', bad.status === 404 && bad2.status === 404, [bad.status, bad2.status]);
  const g = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage(); await g.goto(BASE + sh[1]); await g.waitForSelector('.cal');
  ok('共有ページの <head> は、その共有リンク用のマニフェストを指す', (await g.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'))) === 'manifest.php?t=' + tok);
  await g.click('header button:has-text("ホーム画面に追加")'); await g.waitForSelector('.modal .install'); ok('共有ページにも「ホーム画面に追加」のボタンがあり、手順が出る', (await g.locator('.modal').innerText()).includes('iPhone（Safari）'));
  await g.click('.modal button:has-text("閉じる")'); await g.waitForFunction(() => !document.querySelector('.modal'));
  ok('共有ページのトップバーが、スマホ幅ではみ出さない', await g.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); })();
