const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : (x || '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + 'login.php');
  await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]);
  await p.waitForSelector('.cal');
  ok('右上に「＋ 予定を追加」は無い', await p.locator('text=＋ 予定を追加').count() === 0);
  await p.keyboard.press('n'); await p.waitForSelector('.modal');
  ok('n キーでは追加できる', true);
  await p.fill('input[name=title]', '切替テスト'); await p.fill('input[name=start]', new Date().toISOString().slice(0, 10)); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.bar:has-text("切替テスト")');
  await p.waitForTimeout(1500); // 裏の読み込みを待つ
  // 通信を遅くしても、切り替えでカレンダーが消えない
  await p.route('**/api.php?action=events*', async r => { await new Promise(x => setTimeout(x, 1500)); r.continue(); });
  await p.route('**/api.php?action=todo_list*', async r => { await new Promise(x => setTimeout(x, 1500)); r.continue(); });
  let blank = 0;
  await p.click('.tab[data-view=me]');
  for (let i = 0; i < 10; i++) { if (await p.locator('.cal-weeks .day, .cal .cell, .cal-dow').count() === 0) blank++; await p.waitForTimeout(100); }
  ok('切り替え中（通信が遅い間）も、カレンダーの枠が出ている', blank === 0, blank);
  ok('タブの選択が切り替わる', (await p.locator('.tab[data-view=me]').getAttribute('aria-selected')) === 'true');
  ok('バナーも切り替わる', (await p.locator('.view-banner').innerText()).includes('プライベート版'));
  await p.waitForTimeout(2200);
  // 戻る（前に読んだ内容がすぐ出る）
  await p.click('.tab[data-view=team]');
  await p.waitForTimeout(150);
  ok('戻ると、前に読んだ予定がすぐ出る（通信を待たない）', await p.locator('.bar').count() > 0);
  // 素早く往復しても、最後に選んだ版の内容になる
  await p.waitForTimeout(2200);
  await p.click('.tab[data-view=me]'); await p.click('.tab[data-view=team]'); await p.click('.tab[data-view=me]');
  await p.waitForTimeout(3500);
  ok('素早く往復しても、最後に選んだ版が表示される', (await p.locator('.view-banner').innerText()).includes('プライベート版') && (await p.locator('.tab[data-view=me]').getAttribute('aria-selected')) === 'true');
  ok('JSエラーなし', errs.length === 0, errs);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
