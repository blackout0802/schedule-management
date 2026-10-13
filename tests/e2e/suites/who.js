const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const t = new Date(); const ds = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
async function login(b, email, pw) { const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; }
const add = async (p, title) => { await p.keyboard.press('n'); await p.waitForSelector('.modal'); await p.fill('.modal input[name=title]', title); await p.fill('.modal input[name=start]', ds); await p.click('.modal button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.modal')); await p.waitForTimeout(300); };
(async () => {
  const b = await chromium.launch();
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await add(s, '鈴木の業務');
  const p = await login(b, 'yamada@example.com', 'yamadapass1'); await add(p, '山田の業務');
  const cal = () => p.locator('.cal').innerText();
  ok('ログインして開くと、まず「自分」のカレンダー', (await p.inputValue('#who-sel')) === String(await p.evaluate(() => window.__me || 0)) || (await p.locator('#who-sel option:checked').innerText()) === '自分');
  ok('初期は自分の予定だけ（他の人の予定は出ない）', (await cal()).includes('山田の業務') && !(await cal()).includes('鈴木の業務'));
  await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelector('.cal').innerText.includes('鈴木の業務'));
  ok('「全社（全員）」にすると、全員の予定が見える', (await cal()).includes('鈴木の業務') && (await cal()).includes('山田の業務'));
  const opts = await p.locator('#who-sel option').allInnerTexts(); ok('選択肢: 全社・自分・他の社員', opts[0].startsWith('全社') && opts[1] === '自分' && opts.includes('鈴木 一郎') && !opts.slice(2).includes('山田 花子'), opts);
  await p.selectOption('#who-sel', { label: '自分' }); await p.waitForFunction(() => !document.querySelector('.cal').innerText.includes('鈴木の業務'));
  ok('「自分」にすると、自分の予定だけ', (await cal()).includes('山田の業務') && !(await cal()).includes('鈴木の業務'));
  ok('バナーが「自分の予定だけ」になる', (await p.locator('.view-banner').innerText()).includes('自分の予定'), await p.locator('.view-banner').innerText());
  await p.selectOption('#who-sel', { label: '鈴木 一郎' }); await p.waitForFunction(() => !document.querySelector('.cal').innerText.includes('山田の業務'));
  ok('他の社員を選ぶと、その人の予定だけ', (await cal()).includes('鈴木の業務') && !(await cal()).includes('山田の業務'));
  ok('バナーに社員名が出る', (await p.locator('.view-banner').innerText()).includes('鈴木 一郎さんの予定'), await p.locator('.view-banner').innerText());
  await p.reload(); await p.waitForSelector('.cal'); await p.waitForTimeout(600); ok('開き直すと、また自分のカレンダーに戻る（選んだ人は覚えない）', (await p.locator('#who-sel option:checked').innerText()) === '自分' && (await cal()).includes('山田の業務') && !(await cal()).includes('鈴木の業務'));
  await p.selectOption('#who-sel', { label: '鈴木 一郎' }); await p.waitForFunction(() => !document.querySelector('.cal').innerText.includes('山田の業務'));
  // 自動更新: 鈴木が追加 → 山田(鈴木を表示中)に反映
  await add(s, '鈴木の追加分'); await p.waitForFunction(() => document.querySelector('.cal').innerText.includes('鈴木の追加分'), null, { timeout: 40000 }).catch(() => {});
  ok('他の人の更新も、選んだ人の分が自動で反映される', (await cal()).includes('鈴木の追加分'));
  await p.selectOption('#who-sel', 'all'); await p.waitForFunction(() => document.querySelector('.cal').innerText.includes('山田の業務')); ok('全社に戻せる', true);
  // プライベート版には、この切り替えは無い
  await p.click('header >> text=プライベート版'); await p.waitForSelector('.view-banner.me'); ok('プライベート版には「表示する人」は出ない', await p.locator('#who-sel').count() === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
