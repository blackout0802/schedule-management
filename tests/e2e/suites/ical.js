// カレンダー購読（ICS）: 画面で作る・ログインなしで取り込める・無効なURLは404・作り直すと古いURLは使えない・止めると使えない
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }); const p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const now = new Date(); const ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  await p.evaluate(async (ym) => { const t = document.getElementById('app').dataset.csrf; await fetch('api.php?action=event_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'private', title: '購読テストの私用', start: ym + '-20', end: ym + '-20', start_time: '18:00' }) }); }, ym);
  // 設定 → 共有リンク（家族へ）: 相手 × 見るリンク／カレンダー購読 の表（v1.106.0）
  await p.click('header button:has-text("設定")'); await p.waitForSelector('#set-share');
  if (await p.locator('#set-share.collapsible:not(.open)').count()) await p.click('#set-share > h3');
  await p.waitForSelector('#set-share table.share-tbl');
  const txt = await p.locator('#set-share table.share-tbl').innerText();
  ok('共有リンクの表に「カレンダーに取り込む」の列があり、家族・自分の行が並ぶ（会社の行は無い）', txt.includes('カレンダーに取り込む') && txt.includes('家族') && txt.includes('自分') && !txt.includes('会社'), txt.slice(0, 200));
  const cellSel = '#set-share .share-cell[data-kind=ical-me]', card = p.locator(cellSel);
  await card.locator('button:has-text("購読URLを作る")').click(); await p.waitForSelector(cellSel + '[data-url]');
  const url = await card.getAttribute('data-url');
  ok('購読URLが作られる（ical.php?t=48文字）', /ical\.php\?t=[a-f0-9]{48}$/.test(url), url);
  ok('マスには、URLの欄ではなく、状態・コピー・「⋯」と、末尾の5文字だけ', (await card.locator('input').count()) === 0 && (await card.locator('button:has-text("コピー")').count()) === 1 && (await card.locator('.share-tail').innerText()) === '…' + url.slice(-5));
  await card.locator('.share-more-btn').click(); await p.waitForSelector(cellSel + ' .share-menu');
  ok('「⋯」の「iPhoneで登録」は webcal:// のリンク', (await card.locator('.share-menu a:has-text("iPhoneで登録")').getAttribute('href')).startsWith('webcal://'));
  await p.click('#set-share .share-scope .hint'); await p.waitForFunction(s => !document.querySelector(s + ' .share-menu'), cellSel); // 外を押すと、メニューが閉じる
  // ログインなしで取り込める
  const anon = await (await b.newContext()).newPage();
  const r = await anon.request.get(url); const body = await r.text();
  ok('ログインなしで取れる（text/calendar）', r.status() === 200 && (r.headers()['content-type'] || '').startsWith('text/calendar'), [r.status(), r.headers()['content-type']]);
  ok('中身は iCalendar で、自分の予定（私用）が入る', body.startsWith('BEGIN:VCALENDAR') && body.includes('購読テストの私用') && body.trim().endsWith('END:VCALENDAR'));
  ok('検索エンジンに載らない・キャッシュは短い', (r.headers()['x-robots-tag'] || '').includes('noindex') && /private/.test(r.headers()['cache-control'] || ''));
  const bad = await anon.request.get(BASE + 'ical.php?t=' + '0'.repeat(48)); ok('でたらめなURLは 404', bad.status() === 404);
  // 共有ページ用のURLでは取れない
  const share = await p.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'family' }) }); return r.json(); });
  const tokenShare = share.path.split('t=')[1];
  ok('家族用の共有リンクの合言葉では、購読できない', (await anon.request.get(BASE + 'ical.php?t=' + tokenShare)).status() === 404);
  // 作り直す → 古いURLは使えない
  await card.locator('.share-more-btn').click(); await card.locator('.share-menu button:has-text("URLを作り直す")').click(); await p.waitForFunction(([s, u]) => { const c = document.querySelector(s); return c && c.getAttribute('data-url') && c.getAttribute('data-url') !== u; }, [cellSel, url]);
  const url2 = await card.getAttribute('data-url');
  ok('作り直すと、URLが変わり、古いURLは404', url2 !== url && (await anon.request.get(url)).status() === 404 && (await anon.request.get(url2)).status() === 200);
  // 止める
  await card.locator('.share-more-btn').click(); await card.locator('.share-menu button:has-text("購読を止める")').click(); await p.waitForSelector(cellSel + ' button:has-text("購読URLを作る")');
  ok('止めると、そのURLは404（マスは「購読URLを作る」に戻る）', (await anon.request.get(url2)).status() === 404);
  // 管理者には、会社用も出る
  const a = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  await a.goto(BASE + 'login.php'); await a.fill('input[name=email]', 'admin@example.com'); await a.fill('input[name=password]', 'adminpass1');
  await Promise.all([a.waitForURL('**/index.php'), a.click('button[type=submit]')]); await a.waitForSelector('.cal');
  await a.click('header button:has-text("会社の管理")'); await a.waitForSelector('#set-company-share table.share-tbl');
  ok('管理者には、会社の管理の「会社用の共有」に、会社用の購読も出る', (await a.locator('#set-company-share .share-cell[data-kind=ical-company]').count()) === 1);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
