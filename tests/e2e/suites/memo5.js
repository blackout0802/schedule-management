const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 500)); if (!c) fails++; };
const st = s => Array.from(s).map(ch => /\s/.test(ch) ? ch : ch + '̶').join('');
const SAMPLE = ['お疲れ様です。', '業務終了しました。', '', '以下、本日の業務報告です。', '', '【10/13　予定・To Do】', '', '給与計算の準備', st('基本契約書・NDA') + 'の' + st('格納'), 'BASEの写真と商品名が違うものの修正', '優良企業のロゴ申請', '荒井さんの退職手続き', st('藤原さんの注文書作成・送付'), '', '【10/14　予定・To Do】', '', '給与計算の準備', 'BASEの写真と商品名が違うものの修正', '優良企業のロゴ申請', '荒井さんの退職手続き', '', '以上となります。', 'よろしくお願いいたします。'].join('\n');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => { console.log('PAGEERR', String(e)); errs.push(String(e)); });
  await p.goto('http://127.0.0.1:8099/login.php');
  await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single');
  // 全部選んで消してから、いつもの日報の文章を貼り付ける
  await p.locator('.memo-single').click(); await p.keyboard.press('Control+a'); await p.keyboard.press('Delete');
  await p.evaluate((txt) => { const ed = document.querySelector('.memo-single'); const dt = new DataTransfer(); dt.setData('text/plain', txt); ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, SAMPLE);
  await p.waitForTimeout(800);
  const heads = await p.locator('.memo-single div[data-md]').evaluateAll(l => l.map(x => [x.getAttribute('data-md'), x.getAttribute('data-date'), x.textContent]));
  ok('貼り付けた文章の「【日付】」の2行が、当日・次回出勤日の行になる', heads.length === 2 && heads[0][0] === 'cur' && heads[1][0] === 'next', heads);
  const blk = kind => p.evaluate((kind) => { const h = document.querySelector('.memo-single div[data-md=' + kind + ']'); const out = []; let d = h.nextElementSibling; if (d && !d.textContent.trim()) d = d.nextElementSibling; while (d && d.textContent.trim() && !d.hasAttribute('data-md')) { out.push(d.textContent + (d.querySelector('s') ? '[s]' : '') + (d.hasAttribute('data-tr') ? '[tr]' : '')); d = d.nextElementSibling; } return out; }, kind);
  const c = await blk('cur'), n = await blk('next');
  console.log('   当日', c, '\n   次回', n);
  ok('当日の項目が6件で、取り消し線の項目が2件', c.length === 6 && c.filter(x => x.includes('[s]')).length === 2, c);
  ok('次回出勤日の項目は4件（同じ内容は、重ねて足さない）', n.length === 4 && n.every(x => !x.includes('[s]')), n);
  const lines = (await p.locator('.memo-single > div').count());
  ok('行ごとの div になっている（1つの div に <br> でつながっていない）', lines >= 20 && (await p.locator('.memo-single > div br').count()) <= 6, lines);
  // 当日の項目に取り消し線を付ける → 次回出勤日の同じ手書き行は、そのまま（手書きの行は消さない）
  await p.waitForTimeout(1300);
  await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(600);
  const t = await p.locator('.memo-single').innerText();
  ok('貼り付けた内容が、保存されている', t.includes('給与計算の準備') && t.includes('以上となります。') && t.includes('よろしくお願いいたします。'), t);
  await p.locator('button:has-text("テキストでコピー")').click(); await p.waitForTimeout(400);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok('コピーすると、貼り付けた形のまま（取り消し線は線の文字）', clip.includes(st('藤原さんの注文書作成・送付')) && clip.includes('以上となります。'), clip);
  await p.screenshot({ path: 'memo5.png', fullPage: true });
  ok('JSエラーなし', errs.length === 0, errs);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
