const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 400)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('response', async r => { if (/memo_get|event_save/.test(r.url())) console.log('HTTP', r.url().slice(-20), (await r.text().catch(() => '')).slice(0, 110)); });
  const errs = []; p.on('pageerror', e => { console.log('PAGEERR', String(e)); errs.push(String(e)); });
  await p.goto('http://127.0.0.1:8099/login.php');
  await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single');
  const ed = p.locator('.memo-single');
  const txt = async () => (await ed.innerText()).replace(/\n+/g, '\n');
  let t = await ed.innerText();
  ok('雛形が入っている（挨拶・日付の行・締め）', t.includes('お疲れ様です。') && t.includes('業務終了しました。') && t.includes('以下、本日の業務報告です。') && t.includes('以上となります。') && t.includes('よろしくお願いいたします。'), t);
  const heads = await p.locator('.memo-single div[data-md]').allInnerTexts();
  ok('【日付】の行が2つ（当日・次回出勤日）', heads.length === 2 && /^【\d+\/\d+　予定・To Do】$/.test(heads[0]) && /^【\d+\/\d+　予定・To Do】$/.test(heads[1]), heads);
  const hd = await p.locator('.memo-single div[data-md]').evaluateAll(l => l.map(x => x.getAttribute('data-date')));
  ok('日付の行は、当日 < 次回出勤日', hd[0] < hd[1], hd);
  ok('日付の行は、編集できない', (await p.locator('.memo-single div[data-md]').first().getAttribute('contenteditable')) === 'false');
  // 当日の項目を入力（空行をはさんだ見出しの下）
  const items = ['給与計算の準備', '基本契約書・NDAの格納', 'BASEの写真と商品名が違うものの修正', '優良企業のロゴ申請', '荒井さんの退職手続き', '藤原さんの注文書作成・送付'];
  // 当日の見出しの2つ下（空行の次）の行へ
  const first = p.locator('.memo-single > div').nth(7); // 見出しの後の2つめの空行
  await p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=cur]'); const blank = h.nextElementSibling; const r = document.createRange(); r.selectNodeContents(blank.nextElementSibling); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.memo-single').focus(); });
  for (let i = 0; i < items.length; i++) { await p.keyboard.type(items[i]); if (i < items.length - 1) await p.keyboard.press('Enter'); }
  await p.waitForTimeout(500);
  // 2行目・6行目を取り消し線
  for (const k of [1, 5]) {
    await p.evaluate((k) => { const h = document.querySelector('.memo-single div[data-md=cur]'); let d = h.nextElementSibling.nextElementSibling; for (let i = 0; i < k; i++) d = d.nextElementSibling; const r = document.createRange(); r.selectNodeContents(d); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, k);
    await p.keyboard.press('Control+Shift+X');
  }
  await p.waitForTimeout(800);
  const nextItems = await p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=next]'); const out = []; let d = h.nextElementSibling; while (d && !d.textContent.trim()) d = d.nextElementSibling; while (d && d.textContent.trim()) { out.push(d.textContent + (d.hasAttribute('data-tr') ? '[tr]' : '')); d = d.nextElementSibling; } return out; });
  console.log('   次回出勤日:', nextItems);
  ok('取り消し線のない4件だけが、次回出勤日に転記される（順番どおり）', JSON.stringify(nextItems) === JSON.stringify(['給与計算の準備[tr]', 'BASEの写真と商品名が違うものの修正[tr]', '優良企業のロゴ申請[tr]', '荒井さんの退職手続き[tr]']), nextItems);
  // 取り消し線を外すと戻る / 付けると消える（3行目に線 → 3件）
  await p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=cur]'); let d = h.nextElementSibling.nextElementSibling; d = d.nextElementSibling.nextElementSibling; const r = document.createRange(); r.selectNodeContents(d); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await p.keyboard.press('Control+Shift+X'); await p.waitForTimeout(600);
  const n3 = await p.locator('.memo-single div[data-tr]').count();
  ok('当日の項目に取り消し線を付けると、次回出勤日からも消える', n3 === 3, n3);
  await p.keyboard.press('Control+Shift+X'); await p.waitForTimeout(600);
  ok('取り消し線を外すと、また転記される', await p.locator('.memo-single div[data-tr]').count() === 4);
  // 次回出勤日に、自分で追加
  await p.evaluate(() => { const ds = document.querySelectorAll('.memo-single div[data-tr]'); const last = ds[ds.length - 1]; const r = document.createRange(); r.selectNodeContents(last); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await p.keyboard.press('Enter'); await p.keyboard.type('明日だけの用事'); await p.waitForTimeout(500);
  ok('次回出勤日に自分で書いた行は、転記の印が付かない', await p.locator('.memo-single div:has-text("明日だけの用事")').first().getAttribute('data-tr') === null);
  // 当日の項目を変えても、自分で書いた行は残る
  await p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=cur]'); let d = h.nextElementSibling.nextElementSibling; const r = document.createRange(); r.selectNodeContents(d); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await p.keyboard.type('（更新）'); await p.waitForTimeout(700);
  t = await ed.innerText();
  ok('当日の項目を直すと、転記も直る（自分で書いた行は残る）', t.includes('給与計算の準備（更新）') && t.split('給与計算の準備（更新）').length === 3 && t.includes('明日だけの用事'), t);
  // 保存・再読み込み
  await p.waitForTimeout(1300);
  await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(600);
  const t2 = await ed.innerText();
  ok('再読み込みしても、そのまま', t2 === t || t2.replace(/\s+/g, '') === t.replace(/\s+/g, ''), [t2.length, t.length]);
  const sc = await p.locator('.memo-single s, .memo-single strike').allInnerTexts();
  ok('取り消し線も保存されている', sc.join('|').includes('基本契約書・NDAの格納') && sc.join('|').includes('藤原さんの注文書作成・送付'), sc);
  // コピー
  await p.locator('button:has-text("テキストでコピー")').click(); await p.waitForTimeout(400);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok('コピーすると、挨拶から締めまで、日付の行つきで1つのテキスト', clip.startsWith('お疲れ様です。') && /【\d+\/\d+　予定・To Do】/.test(clip) && clip.includes('以上となります。'), clip.slice(0, 200));
  ok('コピーでは、取り消し線は線の文字になる', clip.includes('基̶本̶契̶約̶書̶'), clip);
  // 日が進む: サーバーが今日が休みと答えるように、有給を登録
  const today = ((x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'))(new Date());
  console.log('EVSAVE', await p.evaluate(async (d) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=event_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'off', title: '', tag: '有給', start: d, end: d }) }); return r.status + ' ' + (await r.text()).slice(0, 150); }, today));
  const before = await p.locator('.memo-single div[data-md]').evaluateAll(l => l.map(x => x.getAttribute('data-date')));
  await p.click('.seg label:has-text("カレンダー")'); await p.waitForSelector('.cal'); await p.waitForTimeout(1500);
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single'); await p.waitForTimeout(900);
  const after = await p.locator('.memo-single div[data-md]').evaluateAll(l => l.map(x => x.getAttribute('data-date')));
  console.log('   日付', before, '→', after);
  ok('日が進むと、当日の日付が次回出勤日に、次回出勤日がその次になる', after[0] === before[1] && after[1] > before[1], [before, after]);
  const rolled = await p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=cur]'); const out = []; let d = h.nextElementSibling; while (d && !d.textContent.trim()) d = d.nextElementSibling; while (d && d.textContent.trim()) { out.push(d.textContent + (d.hasAttribute('data-tr') ? '[tr]' : '') + (d.querySelector('s') ? '[s]' : '')); d = d.nextElementSibling; } return out; });
  console.log('   新しい当日:', rolled);
  ok('次回出勤日の項目が、当日の項目になる（転記の印は外れる。取り消し線のものは無い）', rolled.length >= 4 && rolled.every(x => !x.includes('[tr]') && !x.includes('[s]')) && rolled.some(x => x.includes('明日だけの用事')) && !rolled.some(x => x.includes('基本契約書')), rolled);
  const nx = await p.evaluate(() => { const h = document.querySelector('.memo-single div[data-md=next]'); const out = []; let d = h.nextElementSibling; while (d && !d.textContent.trim()) d = d.nextElementSibling; while (d && d.textContent.trim()) { out.push(d.textContent + (d.hasAttribute('data-tr') ? '[tr]' : '')); d = d.nextElementSibling; } return out; });
  ok('新しい次回出勤日には、新しい当日の項目が転記される', nx.length === rolled.filter(x => !x.startsWith('【')).length && nx.every(x => x.includes('[tr]')), nx);
  // 過去の日報（控え）
  await p.waitForTimeout(1200);
  await p.locator('button:has-text("過去の日報")').click(); await p.waitForSelector('.modal');
  await p.waitForTimeout(700);
  const hv = await p.locator('.memo-hist-view').innerText();
  ok('過去の日報に、日が進む前の日報が残っている', hv.includes('基本契約書・NDAの格納') && hv.includes('藤原さんの注文書作成・送付'), hv);
  await p.screenshot({ path: 'memo4-hist.png' });
  await p.click('.modal button:has-text("閉じる")');
  await p.screenshot({ path: 'memo4.png', fullPage: true });
  ok('JSエラーなし', errs.length === 0, errs);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
