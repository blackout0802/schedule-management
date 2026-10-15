// 日報の雛形を、自分の文面に決める: 書き換える→「いまの文面を雛形にする」→「雛形に戻す」で、その文面に戻る（項目は消え、日付は自動）→標準に戻せる
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 400)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e))); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single');
  const ed = p.locator('.memo-single');
  // 文面を書き換える: 挨拶・見出しの言葉・項目
  await p.evaluate(() => {
    const e = document.querySelector('.memo-single'), kids = Array.from(e.children);
    kids[0].textContent = 'おつかれさまです。'; kids[1].textContent = '本日の報告です。';
    e.querySelectorAll('div[data-md]').forEach(h => { const m = h.textContent.match(/^【(\d+\/\d+)/); h.textContent = '【' + m[1] + '　やること】'; });
    const h = e.querySelector('div[data-md=cur]'); const item = document.createElement('div'); item.textContent = '消えるはずの項目'; h.nextElementSibling.after(item);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('button:has-text("雛形の設定")'); await p.waitForSelector('.modal');
  ok('「雛形の設定」で、説明と、「いまの文面を雛形にする」「標準の雛形に戻す」が出る。いまは標準', (await p.locator('.modal').innerText()).includes('標準の雛形') && (await p.locator('.modal button:has-text("いまの文面を雛形にする")').count()) === 1 && (await p.locator('.modal button:has-text("標準の雛形に戻す")').count()) === 1);
  await p.click('.modal button:has-text("いまの文面を雛形にする")'); await p.waitForSelector('.modal .hint[role=status]:has-text("保存しました")');
  await p.click('.modal button:has-text("閉じる")'); await p.waitForFunction(() => !document.querySelector('.modal'));
  // 文面を、すっかり変えてから、雛形に戻す
  await p.evaluate(() => { const e = document.querySelector('.memo-single'); e.textContent = ''; const d = document.createElement('div'); d.textContent = '全然ちがう文章'; e.appendChild(d); e.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('button:has-text("雛形に戻す")'); await p.waitForFunction(() => !document.querySelector('.memo-single').innerText.includes('全然ちがう文章'));
  const t = await ed.innerText();
  ok('「雛形に戻す」で、自分の雛形（挨拶・見出しの言葉・締め）に戻る', t.includes('おつかれさまです。') && t.includes('本日の報告です。') && /【\d+\/\d+　やること】/.test(t) && !t.includes('お疲れ様です。'), t);
  ok('雛形には、項目（消えるはずの項目）は入らない', !t.includes('消えるはずの項目'), t);
  const hd = await p.locator('.memo-single div[data-md]').evaluateAll(l => l.map(x => x.getAttribute('data-date')));
  ok('日付の行は、いまの出勤日で入る（当日 < 次回出勤日）', hd.length === 2 && hd[0] < hd[1] && /^\d{4}-\d{2}-\d{2}$/.test(hd[0]), hd);
  // 開き直しても、雛形は残っている
  await p.reload(); await p.waitForSelector('.memo-single');
  await p.evaluate(() => { const e = document.querySelector('.memo-single'); e.textContent = '別の文章'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('button:has-text("雛形に戻す")'); await p.waitForFunction(() => document.querySelector('.memo-single').innerText.includes('おつかれさまです。'));
  ok('開き直しても、自分の雛形が使われる（保存されている）', true);
  // 標準に戻す
  await p.click('button:has-text("雛形の設定")'); await p.waitForSelector('.modal');
  ok('自分の雛形を使っているときは、そう表示される', (await p.locator('.modal').innerText()).includes('自分で決めた雛形'));
  await p.click('.modal button:has-text("標準の雛形に戻す")'); await p.waitForSelector('.modal .hint[role=status]:has-text("標準の雛形に戻しました")');
  await p.click('.modal button:has-text("閉じる")'); await p.waitForFunction(() => !document.querySelector('.modal'));
  await p.click('button:has-text("雛形に戻す")'); await p.waitForFunction(() => document.querySelector('.memo-single').innerText.includes('お疲れ様です。'));
  const t2 = await ed.innerText();
  ok('標準に戻すと、「雛形に戻す」は、標準の文面（お疲れ様です。〜よろしくお願いいたします。）に戻る', t2.includes('お疲れ様です。') && t2.includes('よろしくお願いいたします。') && /【\d+\/\d+　予定・To Do】/.test(t2), t2);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
