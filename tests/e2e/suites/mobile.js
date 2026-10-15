// スマホ（390x844）の画面: カレンダーが1画面に収まる・上の帯と操作が少ない行数・横にはみ出さない・
// リストは ToDo／日報メモ を切り替え・設定は項目を畳む・ダイアログが1画面に収まる
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1');
  await Promise.all([p.waitForURL('**/index.php'), p.tap('button[type=submit]')]); await p.waitForSelector('.cal'); await p.waitForTimeout(500);
  const size = () => p.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: window.innerHeight, w: document.documentElement.scrollWidth, vw: window.innerWidth }));
  const fit = async (n) => { const s = await size(); ok(n + ': 1画面に収まる（縦にスクロールしない）', s.h <= s.vh, s); ok(n + ': 横にはみ出さない', s.w <= s.vw, s); };
  // カレンダー
  await fit('カレンダー');
  const top = await p.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().height);
  ok('上の帯は2行（タイトル／設定／ユーザー と 業務版・プライベート版）で、90px以内', top <= 90, top);
  ok('上の帯は、画面に張り付かない（スクロールで消える）', await p.evaluate(() => getComputedStyle(document.querySelector('.topbar')).position) === 'static');
  const rows = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { seg: r('.toolbar .seg').top, rec: r('.toolbar > .btn:last-child').top, who: r('#who-sel').top }; });
  ok('表示する人・カレンダー／会議室予約／リスト が、同じ1行に並ぶ（繰り返しは、足りなければ次の行）', Math.abs(rows.seg - rows.who) < 8, rows);
  ok('長い説明の帯（view-banner）は、スマホでは出さない', await p.evaluate(() => getComputedStyle(document.querySelector('.view-banner')).display) === 'none');
  // 6週ある月でも、1画面
  let guard = 0; while ((await p.locator('.week').count()) < 6 && guard++ < 14) { await p.tap('button[aria-label="次の月"]'); await p.waitForTimeout(250); }
  ok('6週ある月を探せた', (await p.locator('.week').count()) === 6);
  await fit('6週の月のカレンダー');
  await p.tap('button:has-text("今日")'); await p.waitForTimeout(300);
  // 予定を追加するダイアログ
  await p.locator('.cell:not(.other)').nth(10).tap(); await p.waitForSelector('.modal');
  if (!(await p.locator('.modal input[name=title]').count())) { await p.tap('.modal button:has-text("予定を追加")'); }
  await p.waitForSelector('.modal input[name=title]'); await p.waitForTimeout(200);
  const mh = await p.evaluate(() => { const m = document.querySelector('.modal'); const r = m.getBoundingClientRect(); return { h: r.height, vh: innerHeight, right: r.right, w: innerWidth, over: Array.from(m.querySelectorAll('input,select,textarea')).filter(e => e.getBoundingClientRect().right > r.right + 1).length }; });
  ok('予定の追加ダイアログが、1画面に収まる', mh.h <= mh.vh - 16, mh);
  ok('ダイアログの入力欄が、枠からはみ出さない（日付・時刻も）', mh.over === 0 && mh.right <= mh.w, mh);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // リスト（ToDo／日報メモ）
  await p.tap('label:has-text("リスト")'); await p.waitForSelector('.kanban'); await p.waitForTimeout(400);
  await fit('リスト（ToDo）');
  ok('ToDo の説明は、「ⓘ 使い方」に畳まれている', (await p.locator('#todo-mgr details.help-sm').count()) === 1 && !(await p.locator('#todo-mgr details.help-sm').getAttribute('open') !== null));
  ok('ToDo を表示中は、日報メモは隠れる', !(await p.locator('#memo').isVisible()) && await p.locator('#todo-mgr').isVisible());
  await p.tap('.pane-seg label:has-text("日報メモ")'); await p.waitForSelector('#memo .memo-editor', { state: 'visible' });
  ok('日報メモに切り替えると、ToDo は隠れて、日報メモが出る', await p.locator('#memo').isVisible() && !(await p.locator('#todo-mgr').isVisible()));
  const s2 = await size(); ok('日報メモ: 横にはみ出さない', s2.w <= s2.vw, s2);
  ok('日報メモの使い方も、畳まれている', (await p.locator('#memo details.help-sm').count()) === 1);
  await p.tap('.pane-seg label:has-text("ToDo")'); await p.waitForSelector('#todo-mgr', { state: 'visible' });
  await p.tap('label:has-text("カレンダー")'); await p.waitForSelector('.cal');
  // プライベート版
  await p.tap('.tab[data-view=me]'); await p.waitForTimeout(400); await fit('プライベート版');
  // 設定
  await p.goto(BASE + 'index.php#settings'); await p.waitForSelector('.settings-page'); await p.waitForTimeout(500);
  const secs = await p.evaluate(() => ({ n: document.querySelectorAll('.set-sec.collapsible').length, open: document.querySelectorAll('.set-sec.collapsible.open').length, nav: getComputedStyle(document.querySelector('.set-nav')).display, h: document.documentElement.scrollHeight }));
  ok('設定の項目は、最初は全部畳まれている', secs.n >= 12 && secs.open === 0, secs);
  ok('設定のページは、畳んでいると短い（項目の一覧が、ほぼ2画面以内）', secs.h <= 844 * 1.45, secs);
  ok('設定の上の項目ナビ（横に長い一覧）は、スマホでは出さない', secs.nav === 'none');
  await p.tap('#set-colors > h3'); await p.waitForTimeout(300);
  ok('見出しを押すと、その項目が開く', await p.evaluate(() => document.querySelector('#set-colors').classList.contains('open') && document.querySelector('#set-colors .set-body').getBoundingClientRect().height > 40));
  ok('開いた項目だけが開いている', await p.evaluate(() => document.querySelectorAll('.set-sec.collapsible.open').length) === 1);
  await p.tap('#set-colors > h3'); await p.waitForTimeout(200);
  ok('もう一度押すと、畳まれる', await p.evaluate(() => !document.querySelector('#set-colors').classList.contains('open')));
  await p.tap('#set-usage > h3'); await p.waitForSelector('#set-usage .usage-sec', { state: 'visible' });
  const s3 = await size(); ok('設定の「利用状況」を開いても、横にはみ出さない', s3.w <= s3.vw, s3);
  ok('設定の上の帯が1行（スマホ）', await p.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().height) <= 60);
  // 横にずれない: 文字幅の広い端末（iPhone）を想定して文字間を広げても、画面より広がらない。スワイプ（横の移動）は元に戻る
  const css = await p.evaluate(() => ({ ox: getComputedStyle(document.documentElement).overflowX, ta: getComputedStyle(document.body).touchAction }));
  ok('スマホでは、横にずれない設定（overflow-x: hidden）と、ダブルタップで拡大しない設定（touch-action: manipulation）', css.ox === 'hidden' && css.ta === 'manipulation', css);
  await p.goto(BASE + 'index.php'); await p.waitForSelector('.cal'); await p.waitForTimeout(400);
  await p.addStyleTag({ content: '* { letter-spacing: .25em !important; }' });
  const wide = async (n) => { const r = await p.evaluate(() => { const vw = innerWidth; return { sw: document.documentElement.scrollWidth, vw, n: Array.from(document.querySelectorAll('body *')).filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && getComputedStyle(e).position !== 'fixed'; }).length }; }); ok(n + ': 文字幅が広くても、画面より横に広がらない', r.sw <= r.vw && r.n === 0, r); };
  await wide('カレンダー');
  await p.tap('label:has-text("リスト")'); await p.waitForSelector('.kanban'); await wide('ToDo');
  await p.tap('.pane-seg label:has-text("日報メモ")'); await p.waitForSelector('#memo .memo-editor', { state: 'visible' }); await wide('日報メモ');
  const small = async (n) => { const r = await p.evaluate(() => Array.from(document.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]), select, textarea, [contenteditable=true]')).filter(e => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.tagName + '.' + (e.className || e.name || ''))); ok(n + ': 入力欄の文字は、すべて16px以上（iPhone が勝手に拡大しない）', r.length === 0, r); };
  await small('日報メモ（日報の入力欄を含む）');
  await p.tap('.pane-seg label:has-text("ToDo")'); await p.waitForSelector('#todo-mgr', { state: 'visible' }); await small('ToDo');
  await p.tap('label:has-text("カレンダー")'); await p.waitForSelector('.cal'); await small('カレンダー（表示する人）');
  await p.locator('.cell:not(.other)').nth(10).tap(); await p.waitForSelector('.modal'); if (!(await p.locator('.modal input[name=title]').count())) await p.tap('.modal button:has-text("予定を追加")'); await p.waitForSelector('.modal input[name=title]'); await small('予定の追加ダイアログ'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('画面でエラーが出ていない', errs.length === 0, errs);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
