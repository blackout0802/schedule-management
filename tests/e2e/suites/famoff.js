const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const ds = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }); const y = await ctx.newPage();
  y.on('pageerror', e => console.log('PAGEERR', e.message)); y.on('dialog', d => d.accept());
  await y.goto(BASE + 'login.php'); await y.fill('input[name=email]', 'yamada@example.com'); await y.fill('input[name=password]', 'yamadapass1'); await Promise.all([y.waitForURL('**/index.php'), y.click('button[type=submit]')]); await y.waitForSelector('.cal');
  await y.keyboard.press('n'); await y.waitForSelector('.modal'); await y.click('.modal label:has-text("休み")'); await y.selectOption('.modal select[name=tag]', '欠勤'); await y.fill('.modal input[name=start]', ds); await y.fill('.modal input[name=end]', ds);
  await y.check('.modal input[name=family_shared]'); await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal')); await y.waitForSelector('.bar.off');
  ok('本人の画面では、名前＋分類が出る', (await y.locator('.bar.off').first().innerText()).includes('山田 花子 欠勤'), await y.locator('.bar.off').first().innerText());
  const url = await y.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'family' }) }); const j = await r.json(); return JSON.stringify(j); });
  const tok = /share\.php\?t=([0-9a-f]+)/.exec(url)[1];
  const offmark = mode => y.evaluate(async (mode) => { const t = document.getElementById('app').dataset.csrf; await fetch('api.php?action=offmark_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ offmark: { team: 'bar', me: mode } }) }); }, mode);
  // 初期値（プライベート版 = 「休」のアイコン）: 家族用リンクも、アイコンだけ。説明（ホバー）にも、休みの種類は出ない
  const f = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); await f.goto(BASE + 'share.php?t=' + tok); await f.waitForSelector('.offmark');
  const iconTitle = await f.locator('.offmark').first().getAttribute('title');
  ok('家族用リンク（初期値）: 休みは「休」のアイコンだけ。説明にも、名前・種類（欠勤）は出ない', (await f.locator('.bar.off').count()) === 0 && (await f.locator('.offmark').first().innerText()) === '休' && !iconTitle.includes('欠勤') && !iconTitle.includes('山田'), iconTitle);
  await offmark('bar'); // ここからは、帯の表示で確かめる
  await f.reload(); await f.waitForSelector('.bar.off');
  const txt = await f.locator('.bar.off').first().innerText(); ok('家族用リンクでは、単に「休み」と表示される', txt.trim() === '休み', txt);
  ok('名前も分類（欠勤）も出ない', !txt.includes('山田') && !txt.includes('欠勤'), txt);
  const api = await f.evaluate(async (tk) => { const d = new Date(); const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); const r = await fetch('share_api.php?t=' + tk + '&action=events&from=' + m + '-01&to=' + m + '-28'); return await r.text(); }, tok);
  ok('サーバーの応答にも、休みの種類（欠勤）は含まれない', !api.includes('欠勤'), api.slice(0, 200));
  await f.locator('.bar.off').first().click(); await f.waitForSelector('.modal'); const dt = await f.locator('.modal').innerText(); ok('詳細にも、種類は出ない', !dt.includes('欠勤') && dt.includes('休み'), dt);
  // 休みの人がいる日の背景: 家族用リンクも、持ち主（本人）の設定のとおり。本人の画面と同じ見た目になる
  const bgOf = pg => pg.$$eval('.cell.offday', els => getComputedStyle(els[0]).backgroundColor);
  await y.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; await fetch('api.php?action=prefs_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ colors: { work: '', rec: '', off: '', private: '' }, offday: { on: true, color: '#c9e8d4' } }) }); });
  await y.reload(); await y.waitForSelector('.cell.offday'); await f.reload(); await f.waitForSelector('.cell.offday');
  await y.mouse.move(0, 0); await f.mouse.move(0, 0); await f.waitForTimeout(150); // マウスがマスの上に残っていると、ホバーの色（少し濃い）になるので、外しておく
  const mineBg = await bgOf(y), famBg = await bgOf(f);
  ok('家族用リンクの「休みの人がいる日」の背景は、本人が決めた色（本人の画面と同じ）', mineBg === famBg && mineBg !== 'rgba(0, 0, 0, 0)', [mineBg, famBg]);
  await y.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; await fetch('api.php?action=prefs_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ colors: { work: '', rec: '', off: '', private: '' }, offday: { on: false, color: '' } }) }); });
  await f.reload(); await f.waitForSelector('.bar.off');
  ok('本人が「休みの人がいる日」の背景を切っていれば、家族用リンクでも、背景は付かない', (await f.locator('.cell.offday').count()) === 0);
  // 共有した本人だけが、共有ページから、自分の画面へ戻れる
  const backBtn = pg => pg.locator('.topbar a:has-text("自分の画面に戻る")');
  const shareUrl = BASE + 'share.php?t=' + tok;
  await f.goto(shareUrl); await f.waitForSelector('.cal');
  ok('共有ページ（ログインしていない人）には、「自分の画面に戻る」は出ない', (await backBtn(f).count()) === 0);
  await y.goto(shareUrl); await y.waitForSelector('.cal');
  ok('共有した本人（ログイン中）には、「自分の画面に戻る」が出る', (await backBtn(y).count()) === 1 && (await backBtn(y).getAttribute('href')) === 'index.php?view=me');
  await backBtn(y).click(); await y.waitForSelector('.view-banner.me');
  ok('押すと、自分のプライベート版の画面に戻る', y.url().includes('index.php') && !y.url().includes('view='));
  const o = await (await ctx.browser().newContext({ viewport: { width: 1280, height: 900 } })).newPage(); await o.goto(BASE + 'login.php'); await o.fill('input[name=email]', 'suzuki@example.com'); await o.fill('input[name=password]', 'suzukipass1'); await Promise.all([o.waitForURL('**/index.php'), o.click('button[type=submit]')]);
  await o.goto(shareUrl); await o.waitForSelector('.cal');
  ok('ほかの社員（ログイン中）には、出ない', (await backBtn(o).count()) === 0);
  const mine = await o.evaluate(async (t) => (await (await fetch('share_api.php?t=' + t + '&action=meta')).json()).mine, tok);
  ok('共有ページの応答には、「本人か」の true/false だけが入る（ほかの情報は入らない）', mine === false);
  // 会社用リンク: 作った管理者だけ
  const ad = await (await ctx.browser().newContext({ viewport: { width: 1280, height: 900 } })).newPage(); await ad.goto(BASE + 'login.php'); await ad.fill('input[name=email]', 'admin@example.com'); await ad.fill('input[name=password]', 'adminpass1'); await Promise.all([ad.waitForURL('**/index.php'), ad.click('button[type=submit]')]);
  const cp = await ad.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; return (await (await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'company' }) })).json()).path; });
  await ad.goto(BASE + cp); await ad.waitForSelector('.cal');
  ok('会社用リンクも、作った管理者（ログイン中）には、戻るボタンが出る（業務版へ）', (await backBtn(ad).count()) === 1 && (await backBtn(ad).getAttribute('href')) === 'index.php?view=team');
  await o.goto(BASE + cp); await o.waitForSelector('.cal');
  ok('会社用リンクは、作った人以外には、出ない', (await backBtn(o).count()) === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
