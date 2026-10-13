const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
(async () => { const b = await chromium.launch();
  const mk = async (opts) => { const c = await b.newContext(opts); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept()); p.cdp = await c.newCDPSession(p); return p; };
  const touch = async (p, x1, y1, x2, y2, ms = 120) => { const send = (type, x, y) => p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }); await send('touchStart', x1, y1); const n = 5; for (let i = 1; i <= n; i++) { await new Promise(r => setTimeout(r, ms / n)); await send('touchMove', x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n); } await send('touchEnd', x2, y2); await p.waitForTimeout(500); };
  const month = p => p.locator('.toolbar h2').innerText();
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const p = await mk(phone); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.evaluate(() => window.scrollTo(0, 0)); const box = await p.locator('.cal-wrap').boundingBox(); const cy = box.y + 120; const m0 = await month(p); const [Y, M] = m0.match(/\d+/g).map(Number);
  const label = (d) => { const dt = new Date(Y, M - 1 + d, 1); return dt.getFullYear() + '年' + (dt.getMonth() + 1) + '月'; };
  await touch(p, 320, cy, 80, cy + 10); ok('左へスワイプ → 次の月', (await month(p)) === label(1), [m0, await month(p)]);
  await touch(p, 80, cy, 320, cy - 10); ok('右へスワイプ → 前の月（元の月に戻る）', (await month(p)) === m0, await month(p));
  await touch(p, 80, cy, 320, cy); ok('右へスワイプ → 前の月', (await month(p)) === label(-1), await month(p));
  await touch(p, 320, cy, 80, cy); ok('左へスワイプ → 元の月', (await month(p)) === m0);
  await touch(p, 250, cy, 215, cy); ok('短いスワイプ（35px）では、動かない', (await month(p)) === m0);
  await touch(p, 200, cy, 150, cy + 200); ok('縦に動かす（スクロール）では、動かない', (await month(p)) === m0);
  await touch(p, 300, cy, 100, cy, 1500); ok('ゆっくり動かした（1.5秒）ときは、動かない', (await month(p)) === m0);
  await p.tap('.cell >> nth=10'); await p.waitForSelector('.modal'); ok('日付のタップで、これまでどおり、その日の予定が出る', (await p.locator('.modal').innerText()).includes('この日'));
  await touch(p, 320, 400, 80, 400); ok('ダイアログを開いている間は、動かない', (await month(p)) === m0); await p.click('.modal button:has-text("閉じる")'); await p.waitForFunction(() => !document.querySelector('.modal'));
  // 連続でめくる
  for (let i = 0; i < 3; i++) await touch(p, 320, cy, 80, cy); ok('続けて3回スワイプすると、3か月先に進む', (await month(p)) === label(3), await month(p));
  await p.click('.toolbar button:has-text("今日")'); await p.waitForTimeout(400);
  await p.click('.legend-help'); await p.waitForSelector('.modal'); ok('使い方に、スワイプのヒントが出る（スマホ）', (await p.locator('.modal').innerText()).includes('スワイプ')); await p.click('.modal button:has-text("閉じる")'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.evaluate(() => { window.__sl = []; new MutationObserver(() => { const w = document.querySelector('.cal-wrap'); if (w) window.__sl.push(w.className); }).observe(document.getElementById('board'), { childList: true, subtree: true, attributes: true }); });
  await touch(p, 320, cy, 80, cy, 100); ok('次の月へ: 右から入るアニメーションのクラス（slide-next）が付く', (await p.evaluate(() => window.__sl)).some(c => c.includes('slide-next')));
  await touch(p, 80, cy, 320, cy, 100); ok('前の月へ: 左から入るアニメーションのクラス（slide-prev）が付く', (await p.evaluate(() => window.__sl)).some(c => c.includes('slide-prev')));
  // リスト表示では動かない
  await p.click('.seg label:has-text("リスト")'); await p.waitForTimeout(500); const ml = await month(p); await touch(p, 320, 600, 80, 600); ok('リスト表示では、スワイプしても、月は変わらない', (await month(p)) === ml);
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.cal');
  // 設定のページでは動かない
  await p.click('header button:has-text("設定")'); await p.waitForSelector('.settings-page'); await touch(p, 320, 500, 80, 500); ok('設定のページでは、何も起きない', (await p.locator('.settings-page').count()) === 1);
  // 共有リンク
  await p.evaluate(() => window.scrollTo(0, 0)); await p.click('button:has-text("カレンダーに戻る")'); await p.waitForSelector('.cal');
  const sh = await p.evaluate(async () => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify({ kind: 'company' }) }); return (await r.json()).path; });
  const g = await mk(phone); await g.goto(BASE + sh); await g.waitForSelector('.cal'); const gb = await g.locator('.cal-wrap').boundingBox(); const g0 = await month(g); await touch(g, 320, gb.y + 100, 80, gb.y + 100); ok('共有リンク（会社用）でも、スワイプで月が変わる', (await month(g)) !== g0, [g0, await month(g)]);
  // パソコン（タッチなし）: マウスで横にドラッグしても動かない
  const d = await mk({ viewport: { width: 1280, height: 900 } }); await d.goto(BASE + 'login.php'); await d.fill('input[name=email]', 'admin@example.com'); await d.fill('input[name=password]', 'adminpass1'); await Promise.all([d.waitForURL('**/index.php'), d.click('button[type=submit]')]); await d.waitForSelector('.cal'); const dm = await month(d);
  await d.mouse.move(900, 400); await d.mouse.down(); await d.mouse.move(300, 400, { steps: 8 }); await d.mouse.up(); await d.waitForTimeout(400); ok('パソコンで、マウスをドラッグしても、月は変わらない', (await month(d)) === dm);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0); })();
