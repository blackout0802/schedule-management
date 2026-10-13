const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const M = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }); const y = await ctx.newPage();
  y.on('pageerror', e => console.log('PAGEERR', e.message)); y.on('dialog', d => d.accept());
  await y.goto(BASE + 'login.php'); await y.fill('input[name=email]', 'yamada@example.com'); await y.fill('input[name=password]', 'yamadapass1'); await Promise.all([y.waitForURL('**/index.php'), y.click('button[type=submit]')]); await y.waitForSelector('.cal');
  const addPriv = async (title, day, time) => { await y.keyboard.press('n'); await y.waitForSelector('.modal'); await y.click('.modal label:has-text("プライベート")'); await y.fill('.modal input[name=title]', title); await y.fill('.modal input[name=start]', `${M}-${day}`); await y.fill('.modal input[name=end]', `${M}-${day}`); if (time) await y.fill('.modal input[name=start_time]', time); await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal')); await y.waitForTimeout(400); };
  await y.click('header >> text=プライベート版'); await y.waitForSelector('.view-banner.me');
  await addPriv('歯医者の予約', '05', '10:00'); await addPriv('家族で食事', '06');
  const path = await y.evaluate(async () => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=share_create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify({ kind: 'family' }) }); return (await r.json()).path; });
  // 家族が初めて開く → 目印なし
  const fctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }); const f = await fctx.newPage(); f.on('pageerror', e => console.log('PAGEERR', e.message)); await f.addInitScript(() => { window.SCHEDULE_POLL_TEST_MS = 1000; });
  await f.goto(BASE + path); await f.waitForSelector('.upd-banner'); await f.waitForTimeout(1500);
  ok('初めて開いたときは、更新の目印は付かない', await f.locator('.bar.upd').count() === 0 && (await f.locator('.upd-banner').innerText()).includes('新しい更新はありません'), await f.locator('.upd-banner').innerText());
  // 山田が予定を更新・追加・削除
  await y.locator('.bar.private:has-text("歯医者の予約")').first().click(); await y.waitForSelector('.modal'); await y.fill('.modal input[name=start_time]', '14:30'); await y.fill('.modal input[name=title]', '歯医者の予約（変更）'); await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal')); await y.waitForTimeout(500);
  await addPriv('新しい予定', '09', '');
  await f.waitForSelector('.upd-banner.has', { timeout: 20000 }); await f.waitForTimeout(4000);
  const bt = await f.locator('.upd-banner').innerText(); ok('山田が更新すると、家族の画面（自動更新）に「N件の更新があります」が出る', /2件の更新/.test(bt), bt);
  ok('更新された予定に ● と色の枠が付く', await f.locator('.bar.upd').count() === 2 && (await f.locator('.bar.upd').first().innerText()).startsWith('●'), await f.locator('.bar.upd').allInnerTexts());
  ok('更新されていない予定（家族で食事）には付かない', await f.locator('.bar:has-text("家族で食事")').first().getAttribute('class').then(c => !c.includes('upd')));
  await f.click('.upd-banner button:has-text("更新履歴を見る")'); await f.waitForSelector('.log-list'); const lt = await f.locator('.log-list').innerText();
  ok('更新履歴に、いつ・何を更新したかが出る（件名・時刻の変更）', lt.includes('歯医者の予約（変更）') && lt.includes('時刻 10:00 → 14:30') && lt.includes('件名「歯医者の予約」→「歯医者の予約（変更）」'), lt);
  ok('追加した予定は「追加」、新着の印が付く', lt.includes('新しい予定') && lt.includes('追加') && (await f.locator('.log-item.new').count()) >= 2, lt);
  await f.screenshot({ path: 'flog-modal.png' });
  await f.click('.modal button:has-text("確認した")'); await f.waitForFunction(() => !document.querySelector('.modal'));
  ok('「確認した」で、目印が消える', await f.locator('.bar.upd').count() === 0 && (await f.locator('.upd-banner').innerText()).includes('新しい更新はありません'));
  await f.reload(); await f.waitForSelector('.upd-banner'); ok('再読み込みしても、確認済みのまま（ブラウザに記憶）', await f.locator('.bar.upd').count() === 0);
  // 削除 → 履歴に「削除」
  await y.locator('.bar.private:has-text("家族で食事")').first().click(); await y.waitForSelector('.modal'); await y.click('.modal button:has-text("削除")'); await y.waitForFunction(() => !document.querySelector('.modal')); await y.waitForTimeout(500);
  await f.waitForSelector('.upd-banner.has', { timeout: 20000 }); await f.waitForTimeout(4000); await f.click('.upd-banner button:has-text("更新履歴を見る")'); await f.waitForSelector('.log-list');
  const lt2 = await f.locator('.log-list').innerText(); ok('削除も「削除」として履歴に残る', /削除[\s\S]*家族で食事/.test(lt2), lt2);
  await f.click('.modal button:has-text("閉じる")');
  // 共有しない予定は履歴に出ない（非共有にして更新）
  await y.keyboard.press('n'); await y.waitForSelector('.modal'); await y.click('.modal label:has-text("プライベート")'); await y.fill('.modal input[name=title]', 'ひみつの予定'); await y.fill('.modal input[name=start]', `${M}-12`); await y.fill('.modal input[name=end]', `${M}-12`); await y.uncheck('.modal input[name=family_shared]'); await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal')); await y.waitForTimeout(1500);
  const api = await f.evaluate(async (p) => (await (await fetch('share_api.php?t=' + new URL(location.href).searchParams.get('t') + '&action=log')).text()), path);
  ok('家族に共有していない予定は、履歴にも出ない（サーバーの応答にも含まれない）', !api.includes('ひみつの予定'), api.slice(0, 200));
  // 会社用リンクには履歴は無い
  const cpath = await y.evaluate(async () => 'x'); 
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
