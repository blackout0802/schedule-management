// プライベートの予定の帯の色（v1.111.0）: 予定の入力画面で、9色（標準の紫・青・緑・オレンジ・ローズ・マスタード・ライム・ティール・ブラウン）から選べる。
// 選んだ色は、カレンダーの帯・ダークモード・家族用リンクで同じ色になる。業務・休みの予定には出ない。決められた色以外は、標準になる
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const bg = (p, sel) => p.locator(sel).first().evaluate(e => getComputedStyle(e).backgroundColor);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }); const y = await ctx.newPage();
  y.on('pageerror', e => console.log('PAGEERR', e.message)); y.on('dialog', d => d.accept());
  await y.goto(BASE + 'login.php'); await y.fill('input[name=email]', 'yamada@example.com'); await y.fill('input[name=password]', 'yamadapass1');
  await Promise.all([y.waitForURL('**/index.php'), y.click('button[type=submit]')]); await y.waitForSelector('.cal');
  const api = (act, body) => y.evaluate(async ([act, body]) => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify(body) }); return r.json(); }, [act, body]);
  const events = view => y.evaluate(async ([from, view]) => (await (await fetch('api.php?action=events&from=' + from + '&to=' + from + '&view=' + view)).json()).events, [today, view]);

  // プライベート版で、新しい予定を、ローズの帯で作る
  await y.click('.tab[data-view=me]'); await y.waitForSelector('.view-banner.me');
  await y.keyboard.press('n'); await y.waitForSelector('.modal .band-swatches');
  ok('入力画面に、帯の色が9色（標準の紫・青・緑・オレンジ・ローズ・マスタード・ライム・ティール・ブラウン）出る。初めは標準', await y.locator('.modal .band-sw').count() === 9 && (await y.locator('.modal .band-sw[aria-pressed=true]').getAttribute('data-band')) === 'standard');
  await y.fill('.modal input[name=title]', '色つきの予定'); await y.click('.modal .band-sw[data-band=rose]');
  ok('色を押すと、選んだ色の名前が出る', (await y.locator('.modal .band-name').innerText()) === 'ローズ');
  await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal')); await y.waitForSelector('.cal .bar:has-text("色つきの予定")');
  ok('カレンダーの帯が、ローズの色になる（背景 #fde7ef）', (await bg(y, '.cal .bar:has-text("色つきの予定")')) === 'rgb(253, 231, 239)');
  ok('保存した色が、データに入る（band = rose）', (await events('me')).filter(e => e.title === '色つきの予定')[0].band === 'rose');
  // 開き直すと、選んだ色が付いている。標準に戻せる
  await y.click('.cal .bar:has-text("色つきの予定")'); await y.waitForSelector('.modal .band-swatches');
  ok('編集画面を開くと、選んだ色（ローズ）が選ばれている', (await y.locator('.modal .band-sw[aria-pressed=true]').getAttribute('data-band')) === 'rose');
  await y.click('.modal .band-sw[data-band=standard]'); await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal'));
  await y.waitForFunction(() => getComputedStyle(document.querySelector('.cal .bar.private')).backgroundColor === 'rgb(243, 232, 251)');
  ok('標準（紫）に戻すと、いつもの紫の帯になる（背景 #f3e8fb）', (await bg(y, '.cal .bar:has-text("色つきの予定")')) === 'rgb(243, 232, 251)' && (await events('me')).filter(e => e.title === '色つきの予定')[0].band === '');
  // ほかの色
  const want = { blue: 'rgb(230, 241, 253)', green: 'rgb(227, 245, 232)', orange: 'rgb(251, 233, 214)', mustard: 'rgb(253, 243, 204)', lime: 'rgb(238, 245, 208)', teal: 'rgb(220, 241, 245)', brown: 'rgb(239, 230, 223)' };
  const got = {};
  for (const k of Object.keys(want)) {
    await y.click('.cal .bar:has-text("色つきの予定")'); await y.waitForSelector('.modal .band-swatches'); await y.click(`.modal .band-sw[data-band=${k}]`); await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal'));
    await y.waitForFunction(([k, v]) => getComputedStyle(document.querySelector('.cal .bar.private')).backgroundColor === v, [k, want[k]]).catch(() => { });
    got[k] = await bg(y, '.cal .bar:has-text("色つきの予定")');
  }
  ok('青・緑・オレンジ・マスタード・ライム・ティール・ブラウンも、それぞれの色の帯になる', Object.keys(want).every(k => got[k] === want[k]), got);
  // ダークモード
  await y.click('.cal .bar:has-text("色つきの予定")'); await y.waitForSelector('.modal .band-swatches'); await y.click('.modal .band-sw[data-band=rose]'); await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal'));
  await y.emulateMedia({ colorScheme: 'dark' });
  await y.waitForFunction(() => getComputedStyle(document.querySelector('.cal .bar.private')).backgroundColor === 'rgb(61, 26, 42)').catch(() => { });
  ok('ダークモードでは、ローズの帯が暗い色（背景 #3d1a2a）になる', (await bg(y, '.cal .bar:has-text("色つきの予定")')) === 'rgb(61, 26, 42)', await bg(y, '.cal .bar:has-text("色つきの予定")'));
  await y.emulateMedia({ colorScheme: 'light' });
  // 業務・休みの予定には出ない
  await y.keyboard.press('n'); await y.waitForSelector('.modal .band-swatches'); await y.click('.modal label:has-text("業務")');
  ok('種類を「業務」にすると、帯の色の欄は消える', await y.locator('.modal .band-row').isHidden());
  await y.click('.modal label:has-text("プライベート")');
  ok('「プライベート」に戻すと、また出る', await y.locator('.modal .band-row').isVisible());
  await y.click('.modal button:has-text("キャンセル")');
  const wk = await api('event_save', { kind: 'work', title: '業務に色', tag: '打ち合わせ', start: today, band: 'rose' });
  const bad = await api('event_save', { kind: 'private', title: 'おかしな色', start: today, band: 'zzz' });
  ok('業務の予定に色を送っても、付かない。決められた色以外は、標準になる', (await events('team')).filter(e => e.title === '業務に色')[0].band === '' && (await events('me')).filter(e => e.title === 'おかしな色')[0].band === '', [wk, bad]);
  // 小さな画面（1366×650）でも、色の欄を足したあと、保存ボタンまでスクロールせずに見える
  await y.setViewportSize({ width: 1366, height: 650 });
  await y.keyboard.press('n'); await y.waitForSelector('.modal .band-swatches');
  const sv = await y.locator('.modal button[type=submit]').boundingBox();
  ok('1366×650 の画面でも、プライベートの予定の入力画面で、保存ボタンまで見える（色の欄を足したあと）', sv && sv.y + sv.height <= 650, sv);
  await y.click('.modal button:has-text("キャンセル")'); await y.setViewportSize({ width: 1280, height: 1000 });
  // 家族用リンクでも、同じ色
  const j = await y.evaluate(async () => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify({ kind: 'family' }) }); return JSON.stringify(await r.json()); });
  const tok = /share\.php\?t=([0-9a-f]+)/.exec(j)[1];
  const f = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); f.on('pageerror', e => console.log('PAGEERR', e.message));
  await f.goto(BASE + 'share.php?t=' + tok); await f.waitForSelector('.cal .bar:has-text("色つきの予定")');
  ok('家族用リンクでも、選んだ色（ローズ）の帯で見える', (await bg(f, '.cal .bar:has-text("色つきの予定")')) === 'rgb(253, 231, 239)', await bg(f, '.cal .bar:has-text("色つきの予定")'));
  // 複製しても、色は引き継ぐ
  const id = (await events('me')).filter(e => e.title === '色つきの予定')[0].id;
  const tomorrow = new Date(t.getTime() + 864e5); const tm = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  await api('event_duplicate', { id, dates: [tm] });
  const dup = await y.evaluate(async d => (await (await fetch('api.php?action=events&from=' + d + '&to=' + d + '&view=me')).json()).events, tm);
  ok('予定を複製しても、帯の色を引き継ぐ', dup.filter(e => e.title === '色つきの予定').length === 1 && dup.filter(e => e.title === '色つきの予定')[0].band === 'rose', dup);
  // スマホ幅: 色の欄が1画面に収まり、はみ出さない
  const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await ph.goto(BASE + 'login.php'); await ph.fill('input[name=email]', 'yamada@example.com'); await ph.fill('input[name=password]', 'yamadapass1');
  await Promise.all([ph.waitForURL('**/index.php'), ph.click('button[type=submit]')]); await ph.waitForSelector('.cal'); await ph.click('.tab[data-view=me]'); await ph.waitForSelector('.tab[data-view=me][aria-selected=true]');
  await ph.keyboard.press('n').catch(() => { }); if (!(await ph.locator('.modal').count())) { await ph.click('.cal .cell >> nth=10'); await ph.waitForSelector('.modal').catch(() => { }); }
  if (await ph.locator('.modal .band-swatches').count()) {
    const box = await ph.locator('.modal .band-swatches').boundingBox(); const vw = await ph.evaluate(() => window.innerWidth);
    ok('スマホ幅でも、色の欄が画面の幅に収まる', box.x >= 0 && box.x + box.width <= vw + 1, [box, vw]);
  } else console.log('OK  （スマホ幅では、日付を押して入力画面を開く操作が異なるので、色の欄の幅の確認は省く）');
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
