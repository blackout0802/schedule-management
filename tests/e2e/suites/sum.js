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
  // ログインして開くと「表示する人」は自分。月のまとめは、それでも全社員（自分の行が選ばれて目立つ）
  await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3);
  ok('ログインして開くと、月のまとめは全社員で、自分の行が選ばれている', (await p.locator('.month-sum h3').innerText()).includes('全社員') && (await p.locator('.ms-table tbody tr.sel th').innerText()) === '山田 花子');
  await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3);
  const h0 = await p.locator('.month-sum h3').innerText(); let r = await rowsOf(p);
  ok('業務版・全社: 見出しが「全社員」で、全員が1行ずつ並ぶ（自分が先頭）', h0.includes('全社員') && r.length === 3 && r[0][0] === '山田 花子', [h0, r]);
  ok('表の列: 名前・出勤日・休み・有給・欠勤・その他の休み', JSON.stringify(await p.locator('.ms-table thead th').allInnerTexts()) === '["名前","出勤日","休み","有給","欠勤","その他の休み"]');
  const biz = +/営業日 ([\d.]+)日/.exec(h0)[1];
  // 休みを入れる日は、その月の平日（土日・祝日・会社の休業日でない日）から選ぶ（決まった日にすると、月によって土日に当たって落ちる）
  const last = new Date(y, mo, 0).getDate();
  const hol = await p.evaluate(async ([M, last]) => (await (await fetch(`api.php?action=events&view=team&from=${M}-01&to=${M}-${last}`)).json()).holidays || {}, [M, last]);
  const isBiz = d => { const w = new Date(y, mo - 1, d).getDay(); return d <= last && w > 0 && w < 6 && !hol[`${M}-${pad(d)}`]; };
  let d0 = 8; while (!(isBiz(d0) && isBiz(d0 + 1) && isBiz(d0 + 2) && isBiz(d0 + 3)) && d0 < last) d0++; // 4日続く平日（欠勤・有給2日・半休）
  let d1 = d0 + 4; while (!(isBiz(d1) && isBiz(d1 + 1)) && d1 < last) d1++; // 鈴木の有給2日（2日続く平日）
  const D = d => `${M}-${pad(d)}`;
  await addOff(p, '欠勤', D(d0), D(d0)); await addOff(p, '有給', D(d0 + 1), D(d0 + 2)); await addOff(p, '午前半休', D(d0 + 3), D(d0 + 3));
  r = await rowsOf(p); const mine = r.find(x => x[0] === '山田 花子');
  ok('自分の行: 出勤日・休み・有給・欠勤・その他が正しい', mine && mine[1] === (biz - 3.5) + '日' && mine[2] === '3.5日' && mine[3] === '2日' && mine[4] === '1日' && mine[5] === '午前半休 0.5日', mine);
  ok('他の社員の行は、まだ休み0日', r.filter(x => x[0] !== '山田 花子').every(x => x[2] === '0日'), r);
  // 鈴木が休みを入れる → 全社の表に出る
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await addOff(s, '有給', D(d1), D(d1 + 1));
  await p.waitForTimeout(500); await p.reload(); await p.waitForSelector('.ms-table'); await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3); r = await rowsOf(p); const sz = r.find(x => x[0] === '鈴木 一郎');
  ok('全社の表に、他の社員の休み（鈴木: 有給2日）も出る', sz && sz[2] === '2日' && sz[3] === '2日', sz);
  const hs = await s.locator('.month-sum h3').innerText(); ok('鈴木の画面では、鈴木が先頭', (await rowsOf(s))[0][0] === '鈴木 一郎', hs);
  // 自分
  ok('全社のときは、どの行も選ばれていない', await p.locator('.ms-table tbody tr.sel').count() === 0);
  await p.selectOption('#who-sel', { label: '自分' }); await p.waitForSelector('.ms-table tbody tr.sel');
  r = await rowsOf(p); ok('「自分」を選んでも、全社員が並び、自分の行が選ばれる', r.length === 3 && (await p.locator('.ms-table tbody tr.sel th').innerText()) === '山田 花子' && (await p.locator('.month-sum h3').innerText()).includes('全社員'), r);
  // 他の社員
  await p.selectOption('#who-sel', { label: '鈴木 一郎' }); await p.waitForFunction(() => { const t = document.querySelector('.ms-table tbody tr.sel th'); return t && t.innerText.includes('鈴木'); });
  r = await rowsOf(p); const sel = await p.locator('.ms-table tbody tr.sel').evaluate(tr => [...tr.children].map(c => c.innerText.trim()));
  ok('「他の社員」を選んでも、全社員が並び、その人（鈴木）の行が選ばれる', r.length === 3 && sel[0] === '鈴木 一郎' && sel[2] === '2日' && (await p.locator('.month-sum h3').innerText()).includes('全社員'), [r, sel]);
  // 行を押すと、その人に切り替わる（全社員の表のまま、すぐ次の人へ）
  const other = r.find(x => x[0] !== '山田 花子' && x[0] !== '鈴木 一郎')[0];
  await p.locator('.ms-table tbody tr', { hasText: other }).click(); await p.waitForFunction(n => { const t = document.querySelector('.ms-table tbody tr.sel th'); return t && t.innerText === n; }, other);
  ok('月のまとめの行を押すと、その人に切り替わり、表は全社員のまま', (await rowsOf(p)).length === 3 && (await p.locator('#who-sel option:checked').innerText()).includes(other.split(/\s/)[0]));
  // プライベート版は自分だけ
  await p.click('header >> text=プライベート版'); await p.waitForSelector('.view-banner.me'); ok('プライベート版: カレンダーの下（凡例・月のまとめ）は出ない', (await p.locator('.month-sum').count()) === 0 && (await p.locator('.legend').count()) === 0);
  // コンパクトさ
  await p.click('header >> text=業務版'); await p.selectOption('#who-sel', { label: '自分' }); await p.waitForSelector('.ms-table tbody tr.sel');
  await p.screenshot({ path: 'sum-self.png', fullPage: true });
  await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelectorAll('.ms-table tbody tr').length === 3); await p.screenshot({ path: 'sum-all.png', fullPage: true });
  // スマホ
  const m = await login(b, 'yamada@example.com', 'yamadapass1', { width: 390, height: 900 }); await m.waitForSelector('.month-sum');
  ok('スマホ幅でも、ページが横にはみ出さない（表の中でスクロール）', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.locator('.month-sum').scrollIntoViewIfNeeded(); await m.screenshot({ path: 'sum-mobile.png' });
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
