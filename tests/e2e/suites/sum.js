const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
async function login(b, email, pw, vp) {
  const ctx = await b.newContext({ viewport: vp || { width: 1280, height: 1000 } }); const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal, .list'); return p;
}
const addOff = async (p, tag, s, e) => { await p.keyboard.press('n'); await p.waitForSelector('.modal'); await p.click('.modal label:has-text("休み")'); await p.selectOption('.modal select[name=tag]', tag); await p.fill('.modal input[name=start]', s); await p.fill('.modal input[name=end]', e); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal')); await p.waitForTimeout(500); };
const rowsOf = (p) => p.locator('.ms-table tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(c => c.innerText.trim())));
(async () => {
  const b = await chromium.launch();
  const p = await login(b, 'yamada@example.com', 'yamadapass1');
  const now = new Date(); const y = now.getFullYear(), mo = now.getMonth() + 1; const pad = n => (n < 10 ? '0' : '') + n; const M = `${y}-${pad(mo)}`;
  await p.waitForSelector('.month-sum');
  ok('ログインして開くと、まず自分のまとめ', (await p.locator('.month-sum h3').innerText()).includes('自分'));
  await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3);
  const h0 = await p.locator('.month-sum h3').innerText(); let r = await rowsOf(p);
  ok('業務版・全社: 見出しが「全社員」で、全員が1行ずつ並ぶ（自分が先頭）', h0.includes('全社員') && r.length === 3 && r[0][0] === '山田 花子', [h0, r]);
  ok('表の列: 名前・出勤日・休み・有給・欠勤・その他の休み', JSON.stringify(await p.locator('.ms-table thead th').allInnerTexts()) === '["名前","出勤日","休み","有給","欠勤","その他の休み"]');
  const biz = +/営業日 ([\d.]+)日/.exec(h0)[1];
  await addOff(p, '欠勤', `${M}-13`, `${M}-13`); await addOff(p, '有給', `${M}-14`, `${M}-15`); await addOff(p, '午前半休', `${M}-16`, `${M}-16`);
  r = await rowsOf(p); const mine = r.find(x => x[0] === '山田 花子');
  ok('自分の行: 出勤日・休み・有給・欠勤・その他が正しい', mine && mine[1] === (biz - 3.5) + '日' && mine[2] === '3.5日' && mine[3] === '2日' && mine[4] === '1日' && mine[5] === '午前半休 0.5日', mine);
  ok('他の社員の行は、まだ休み0日', r.filter(x => x[0] !== '山田 花子').every(x => x[2] === '0日'), r);
  // 鈴木が休みを入れる → 全社の表に出る
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await addOff(s, '有給', `${M}-20`, `${M}-21`);
  await p.waitForTimeout(500); await p.reload(); await p.waitForSelector('.ms-table'); await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3); r = await rowsOf(p); const sz = r.find(x => x[0] === '鈴木 一郎');
  ok('全社の表に、他の社員の休み（鈴木: 有給2日）も出る', sz && sz[2] === '2日' && sz[3] === '2日', sz);
  const hs = await s.locator('.month-sum h3').innerText(); ok('鈴木の画面では、鈴木が先頭', (await rowsOf(s))[0][0] === '鈴木 一郎', hs);
  // 自分
  await p.selectOption('#who-sel', { label: '自分' }); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 1);
  r = await rowsOf(p); ok('「自分」: 自分だけ1行', r.length === 1 && r[0][0] === '山田 花子' && (await p.locator('.month-sum h3').innerText()).includes('自分'), r);
  // 他の社員
  await p.selectOption('#who-sel', { label: '鈴木 一郎' }); await p.waitForFunction(() => document.querySelector('.ms-table tbody th') && document.querySelector('.ms-table tbody th').innerText.includes('鈴木'));
  r = await rowsOf(p); ok('「他の社員」を選ぶと、その人だけ1行（鈴木）', r.length === 1 && r[0][0] === '鈴木 一郎' && r[0][2] === '2日' && (await p.locator('.month-sum h3').innerText()).includes('鈴木 一郎さん'), [r, await p.locator('.month-sum h3').innerText()]);
  // プライベート版は自分だけ
  await p.click('header >> text=プライベート版'); await p.waitForSelector('.view-banner.me'); ok('プライベート版: カレンダーの下（凡例・月のまとめ）は出ない', (await p.locator('.month-sum').count()) === 0 && (await p.locator('.legend').count()) === 0);
  // コンパクトさ
  await p.click('header >> text=業務版'); await p.selectOption('#who-sel', { label: '自分' }); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 1);
  const hgt = await p.locator('.month-sum').evaluate(e => e.getBoundingClientRect().height); ok('自分だけなら、高さは約90px以内（コンパクト）', hgt < 95, hgt);
  await p.screenshot({ path: 'sum-self.png', fullPage: true });
  await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3); await p.screenshot({ path: 'sum-all.png', fullPage: true });
  // スマホ
  const m = await login(b, 'yamada@example.com', 'yamadapass1', { width: 390, height: 900 }); await m.waitForSelector('.month-sum');
  ok('スマホ幅でも、ページが横にはみ出さない（表の中でスクロール）', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.locator('.month-sum').scrollIntoViewIfNeeded(); await m.screenshot({ path: 'sum-mobile.png' });
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
