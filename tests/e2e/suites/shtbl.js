// 共有リンク（v1.106.0）: 設定の「共有リンク（家族へ）」は、相手 × 見るリンク／カレンダー購読 の表。注意は1行（？で開く）。
// 家族に見せる範囲は1行の要約と「変える」。取り込み方はポップアップ。会社用は「会社の管理」の「会社用の共有」。開いても短い
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const mk = async (opt, email, pw) => {
    const c = await b.newContext(opt || { viewport: { width: 1280, height: 1000 } }); await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') }).catch(() => {});
    const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
    await p.evaluate(() => 0).catch(() => {});
    await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
    await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
    await p.evaluate(() => localStorage.setItem('sched.setOpen', JSON.stringify(['share', 'company-share'])));
    return p;
  };
  const y = await mk(null, 'yamada@example.com', 'yamadapass1');
  await y.goto(BASE + 'index.php#settings'); await y.waitForSelector('#set-share table.share-tbl');
  ok('見出しは「共有リンク（家族へ）」、要約は家族用リンクと購読の数', (await y.locator('#set-share .set-title').innerText()) === '共有リンク（家族へ）' && (await y.locator('#set-share .set-sum').innerText()).includes('家族用リンク: なし'));
  ok('表は、家族・自分の2行（会社の行は無い）', (await y.locator('#set-share .share-tbl tbody tr').evaluateAll(rs => rs.map(r => r.dataset.who))).join(',') === '家族,自分');
  ok('注意は1行で、くわしい説明は「？」を押すまで隠れている', await y.locator('#set-share .share-notice summary').isVisible() && !(await y.locator('#set-share .share-notice > p').isVisible()));
  await y.click('#set-share .share-notice summary'); ok('「？」（注意の行）を押すと、くわしい説明が出る', await y.locator('#set-share .share-notice > p').isVisible());
  // 家族用リンクを作る → 状態・コピー・「⋯」
  const fam = '#set-share .share-cell[data-kind=link-family]';
  await y.click(fam + ' button:has-text("リンクを作る")'); await y.waitForSelector(fam + '[data-url]');
  const url = await y.getAttribute(fam, 'data-url');
  ok('作ると、マスは「共有中・コピー・⋯」と末尾の5文字になる（URLの欄は無い）', /share\.php\?t=[a-f0-9]{48}$/.test(url) && (await y.locator(fam + ' .share-st').innerText()) === '共有中' && (await y.locator(fam + ' input').count()) === 0 && (await y.locator(fam + ' .share-tail').innerText()) === '…' + url.slice(-5), url);
  await y.waitForFunction(() => document.querySelector('#set-share .set-sum').innerText.includes('家族用リンク: あり'), null, { timeout: 5000 }).catch(() => {});
  ok('作ると、見出しの右の要約も「あり」になる', (await y.locator('#set-share .set-sum').innerText()).includes('家族用リンク: あり'));
  await y.click(fam + ' button:has-text("コピー")'); await y.waitForSelector('.toast:has-text("コピーしました")', { timeout: 3000 }).catch(() => {});
  const clip = await y.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok('「コピー」で、リンクがコピーされる', clip === url, clip);
  await y.click(fam + ' .share-more-btn'); await y.waitForSelector(fam + ' .share-menu');
  ok('「⋯」に、開く・作り直す・止める', (await y.locator(fam + ' .share-menu').innerText()).replace(/\s+/g, ',') === '開く,リンクを作り直す,共有を止める' && (await y.getAttribute(fam + ' .share-menu a', 'href')) === url);
  await y.click(fam + ' .share-menu button:has-text("リンクを作り直す")'); await y.waitForFunction(([s, u]) => { const c = document.querySelector(s); return c && c.dataset.url && c.dataset.url !== u; }, [fam, url]);
  ok('作り直すと、URLが変わる', (await y.getAttribute(fam, 'data-url')) !== url);
  await y.click(fam + ' .share-more-btn'); await y.click(fam + ' .share-menu button:has-text("共有を止める")'); await y.waitForSelector(fam + ' button:has-text("リンクを作る")');
  ok('止めると、マスは「リンクを作る」に戻る', true);
  // 家族に見せる範囲: 1行の要約と「変える」
  ok('家族に見せる範囲は、1行の要約（初めはプライベートだけ）。選ぶ欄は隠れている', (await y.locator('#set-share .share-scope-v').innerText()) === 'プライベート（予定ごと）' && (await y.locator('#set-share .scope').count()) === 0);
  await y.click('#set-share .share-scope button:has-text("変える")'); await y.waitForSelector('#set-share .scope');
  await y.locator('#set-share .scope label:has-text("自分の休みを、すべて見せる") input').check(); await y.waitForSelector('.toast:has-text("家族に見せる範囲を保存しました")');
  await y.locator('#set-share .scope label.fchip:has-text("打ち合わせ") input').check(); await y.waitForFunction(() => document.querySelector('#set-share .share-scope-v').innerText.includes('打ち合わせ'));
  ok('「変える」で選ぶと、すぐ保存され、要約も変わる', (await y.locator('#set-share .share-scope-v').innerText()) === 'プライベート（予定ごと）・休み（すべて）・打ち合わせ');
  await y.click('#set-share .share-scope button:has-text("完了")'); await y.waitForFunction(() => !document.querySelector('#set-share .scope'));
  const saved = await y.evaluate(async () => (await (await fetch('api.php?action=share_list')).json()).family_share);
  ok('サーバーにも保存されている', saved.off === true && saved.tags.join() === '打ち合わせ', saved);
  // 取り込み方・家族の更新履歴
  await y.click('#set-share button:has-text("取り込み方")'); await y.waitForSelector('.overlay .inst-box');
  ok('「取り込み方 ？」で、手順がポップアップで出る', (await y.locator('.overlay').innerText()).includes('Google カレンダー')); await y.keyboard.press('Escape'); await y.waitForFunction(() => !document.querySelector('.overlay'));
  ok('家族に見える更新履歴の管理は、下のボタン', (await y.locator('#set-share .share-foot button:has-text("家族に見える更新履歴を管理")').count()) === 1);
  // 短い: 家族用リンク・購読2つを作っても、パソコンで 500px 以下（今までは約1,540px）
  await y.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const post = (a, b) => fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(b) }); await post('share_create', { kind: 'family' }); await post('ical_create', { kind: 'me' }); await post('ical_create', { kind: 'family' }); });
  await y.reload(); await y.waitForSelector('#set-share .share-cell[data-kind=ical-family][data-url]');
  const h = await y.evaluate(() => document.querySelector('#set-share').getBoundingClientRect().height);
  ok('家族用リンクと購読2つを作っても、開いた共有リンクは 500px 以下', h <= 500, h);
  await y.locator('#set-share').screenshot({ path: 'shtbl.png' });
  // スマホ: はみ出さない・コピーと「⋯」が1行
  const m = await mk({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 'yamada@example.com', 'yamadapass1');
  await m.goto(BASE + 'index.php#settings'); await m.waitForSelector('#set-share .share-cell[data-kind=ical-family][data-url]');
  const mm = await m.evaluate(() => { const c = document.querySelector('#set-share .share-cell[data-kind=link-family] .share-cell-in'); const bs = [...c.children].filter(x => x.offsetParent); return { sw: document.documentElement.scrollWidth, vw: innerWidth, rows: new Set(bs.map(x => Math.round(x.getBoundingClientRect().top))).size, h: document.querySelector('#set-share').getBoundingClientRect().height }; });
  ok('スマホ: 横にはみ出さず、マスの「コピー」と「⋯」は1行', mm.sw <= mm.vw && mm.rows === 1, mm);
  await m.locator('#set-share').screenshot({ path: 'shtbl-phone.png' });
  // 会社用: 会社の管理（管理者）
  const a = await mk(null, 'admin@example.com', 'adminpass1');
  await a.goto(BASE + 'index.php#settings'); await a.waitForSelector('#set-share table.share-tbl');
  ok('管理者でも、設定の共有リンクには会社の行は無い', (await a.locator('#set-share .share-tbl tbody tr').count()) === 2 && (await a.locator('#set-share [data-kind$=company]').count()) === 0);
  await a.goto(BASE + 'index.php#admin'); await a.waitForSelector('#set-company-share table.share-tbl');
  ok('会社の管理の「通知と共有」に「会社用の共有」（会社の1行）', (await a.locator('#set-company-share .share-tbl tbody tr').evaluateAll(rs => rs.map(r => r.dataset.who))).join() === '会社' && (await a.locator('#set-company-share .set-sum').innerText()).includes('リンク: なし'));
  await a.click('#set-company-share .share-cell[data-kind=link-company] button:has-text("リンクを作る")'); await a.waitForSelector('#set-company-share .share-cell[data-kind=link-company][data-url]');
  await a.waitForFunction(() => document.querySelector('#set-company-share .set-sum').innerText.includes('リンク: あり'), null, { timeout: 5000 }).catch(() => {});
  ok('会社用リンクを作れる（要約も「あり」）', (await a.locator('#set-company-share .set-sum').innerText()).includes('リンク: あり'));
  ok('会社用の共有には、家族の範囲・家族の更新履歴は出ない', (await a.locator('#set-company-share .share-scope').count()) === 0 && (await a.locator('#set-company-share button:has-text("家族に見える更新履歴")').count()) === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
