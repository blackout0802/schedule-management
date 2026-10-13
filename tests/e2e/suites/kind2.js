const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const f = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const t = new Date(); const d = n => f(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } }); const A = await ctx.newPage(); A.on('dialog', x => x.accept());
  await A.goto(BASE + 'login.php'); await A.fill('input[name=email]', 'yamada@example.com'); await A.fill('input[name=password]', 'yamadapass1');
  await Promise.all([A.waitForURL('**/index.php'), A.click('button[type=submit]')]); await A.waitForSelector('.cal');
  await A.keyboard.press('n'); await A.check('.modal input[name=kind][value=off]'); await A.fill('input[name=start]', d(3)); await A.click('.modal button[type=submit]'); await A.waitForSelector('.bar.off');
  await A.click('.bar.off'); await A.waitForSelector('.modal input[name=kind]');
  ok('休み（件名は自動の「休み」）', (await A.inputValue('.modal input[name=title]')) === '休み');
  await A.check('.modal input[name=kind][value=work]');
  ok('休み→業務に切り替えると、自動の件名「休み」が空になり、入力を促す', (await A.inputValue('.modal input[name=title]')) === '' && (await A.getAttribute('.modal input[name=title]', 'placeholder')).includes('件名を入力'));
  await A.check('.modal input[name=kind][value=off]');
  ok('休みに戻しても動く（件名は空のままでよい旨が出る）', (await A.getAttribute('.modal input[name=title]', 'placeholder')).includes('空のままで可'));
  await A.check('.modal input[name=kind][value=work]'); await A.click('.modal button[type=submit]');
  await A.waitForSelector('.modal .error:not([hidden])');
  ok('件名を入れずに業務で保存すると、分かりやすいエラーが出る', (await A.locator('.modal .error').innerText()).includes('件名'));
  await A.fill('.modal input[name=title]', '打ち合わせ（元は休み）'); await A.click('.modal button[type=submit]'); await A.waitForSelector('.bar.work:has-text("打ち合わせ（元は休み）")');
  ok('件名を入れて保存すると、業務の予定になる', true);
  // 手で付けた件名「休み」は、勝手に消さない（元が休みでない予定）
  await A.keyboard.press('n'); await A.fill('.modal input[name=title]', '休み'); await A.fill('input[name=start]', d(5)); await A.check('.modal input[name=kind][value=off]'); await A.check('.modal input[name=kind][value=work]');
  ok('新規の予定で手入力した件名は、種類を切り替えても消えない', (await A.inputValue('.modal input[name=title]')) === '休み');
  console.log(fails ? '失敗 ' + fails : 'すべて成功'); await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
