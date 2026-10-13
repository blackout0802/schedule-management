const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { execSync } = require('child_process'); const fs = require('fs');
const BASE = 'http://127.0.0.1:8099/'; const IMG = require('../lib/env').makeImages(); const ATT = process.env.E2E_APP + '/data/attachments';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const { sql } = require('../lib/env');
const login = async (b, email, pw) => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('ERR', String(e))); await p.addInitScript(() => { window.SCHEDULE_POLL_TEST_MS = 1000; }); await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; };
const openList = async p => { await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr'); await p.waitForTimeout(500); };
(async () => {
  execSync(`rm -f ${ATT}/*.png ${ATT}/*.jpg 2>/dev/null; true`);
  sql("DROP TABLE IF EXISTS todo_comment_files; UPDATE app_meta SET meta_value='16' WHERE meta_key='schema_version'");
  const b = await chromium.launch();
  const y = await login(b, 'yamada@example.com', 'yamadapass1');
  ok('更新後の初回表示で、画像用の表が自動で作られる', require('../lib/env').tableExists('todo_comment_files'));
  await openList(y); await y.click('#todo-mgr .todo-add-btn'); await y.fill('#todo-mgr .todo-add input[type=text]', '画面の不具合'); await y.click('#todo-mgr .todo-add button[type=submit]'); await y.waitForSelector('#todo-mgr .kb-card:has-text("画面の不具合")');
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await openList(s);
  await s.selectOption('#todo-mgr .todo-who select', 'all'); await s.click('#todo-mgr .kb-card.other:has-text("画面の不具合")'); await s.waitForSelector('.modal .tc-dialog');
  ok('コメント欄に「画像を添付」ボタンがある', await s.locator('.modal button:has-text("画像を添付")').count() === 1);
  // 1. ファイル選択（3000x1800の大きな画像→ブラウザ側で縮む）
  await s.setInputFiles('.modal input[type=file]', IMG + '/shot-big.png'); await s.waitForSelector('.modal .tc-pend img');
  ok('選んだ画像のプレビューが出る', await s.locator('.modal .tc-pend').count() === 1);
  // 2. 貼り付け（Ctrl+V のスクリーンショット）
  await s.evaluate(async () => { const bin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='); const blob = new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))], { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(new File([blob], 'paste.png', { type: 'image/png' })); document.querySelector('.modal textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await s.waitForFunction(() => document.querySelectorAll('.modal .tc-pend').length === 2); ok('貼り付け（Ctrl + V）でも、画像が添付される', true);
  // 4枚目は断られる
  await s.setInputFiles('.modal input[type=file]', [IMG + '/shot-small.png', IMG + '/shot-small.png', IMG + '/shot-small.png']); await s.waitForTimeout(1200);
  ok('1つのコメントに付けられる画像は3枚まで', await s.locator('.modal .tc-pend').count() === 3, await s.locator('.modal .tc-pend').count());
  await s.click('.modal .tc-pend:last-child .tc-x'); ok('×で、添付を外せる', await s.locator('.modal .tc-pend').count() === 2);
  await s.setInputFiles('.modal input[type=file]', IMG + '/not-image.txt'); await s.waitForTimeout(500);
  ok('画像でないファイルは、添付されない', await s.locator('.modal .tc-pend').count() === 2);
  await s.fill('.modal textarea', 'この画面で崩れます'); await s.screenshot({ path: 'tdimg-compose.png' });
  await s.click('.modal button:has-text("コメントを送る")'); await s.waitForSelector('.modal .tc-item .tc-thumb img');
  const info = await s.evaluate(async () => { const imgs = [...document.querySelectorAll('.modal .tc-item img')]; await Promise.all(imgs.map(i => i.decode().catch(() => {}))); return imgs.map(i => [i.naturalWidth, i.naturalHeight]); });
  ok('画像つきのコメントが付く（2枚が表示される）', info.length === 2 && info.every(a => a[0] > 0), info);
  ok('大きな画像は、ブラウザ側で長辺1600pxに縮んでいる', Math.max(info[0][0], info[0][1]) === 1600, info);
  const files = fs.readdirSync(ATT).filter(f => /\.(png|jpg)$/.test(f)); ok('サーバーに、2つのファイルが保存された', files.length === 2, files);
  ok('保存された画像は、PNGまたはJPEGの画像（中身を確認）', files.every(f => { const h = fs.readFileSync(ATT + '/' + f).slice(0, 4); return (h[0] === 0x89 && h[1] === 0x50) || (h[0] === 0xff && h[1] === 0xd8); }));
  await s.screenshot({ path: 'tdimg-comment.png' });
  // 大きく見る
  await s.click('.modal .tc-thumb >> nth=0'); await s.waitForSelector('.modal img.tc-big'); ok('画像を押すと、大きく表示される', true);
  await s.screenshot({ path: 'tdimg-viewer.png' });
  await s.keyboard.press('Escape'); await s.waitForTimeout(300); await s.keyboard.press('Escape'); await s.waitForFunction(() => !document.querySelector('.modal'));
  // 持ち主（山田）にも見える
  await y.waitForFunction(() => document.querySelector('#todo-mgr .pill.tc.new'), null, { timeout: 15000 });
  await y.click('#todo-mgr .kb-card:has-text("画面の不具合") button:has-text("コメント")'); await y.waitForSelector('.modal .tc-thumb img');
  const yi = await y.evaluate(async () => { const i = document.querySelector('.modal .tc-thumb img'); await i.decode().catch(() => {}); return i.naturalWidth; }); ok('持ち主にも、画像が表示される', yi > 0, yi);
  const fid = Number(sql("SELECT MIN(id) FROM todo_comment_files"));
  // ログインしていないと見られない
  const anon = await (await b.newContext()).newPage(); const rr = await anon.goto(BASE + 'api.php?action=todo_file&id=' + fid); ok('ログインしていないと、画像は見られない（401）', rr.status() === 401, rr.status());
  const direct = await anon.goto(BASE + '../data/attachments/' + fs.readdirSync(ATT).find(f => /\.png$/.test(f))).catch(() => null); ok('保存先のファイルを、URLで直接開くことはできない', !direct || direct.status() >= 400, direct && direct.status());
  // 他人のプライベートToDoに付いた画像は見られない（番号をずらして取得）
  await y.keyboard.press('Escape'); await y.waitForFunction(() => !document.querySelector('.modal'));
  // コメント削除で、ファイルも消える
  await y.click('#todo-mgr .kb-card:has-text("画面の不具合") button:has-text("コメント")'); await y.waitForSelector('.modal .tc-item'); y.once('dialog', d => { ok('削除の確認に「画像も消えます」と出る', d.message().includes('画像も消えます')); d.accept(); });
  await y.click('.modal .tc-item button:has-text("削除")'); await y.waitForFunction(() => !document.querySelector('.modal .tc-item')); await y.waitForTimeout(400);
  ok('コメントを削除すると、サーバーの画像ファイルも消える', fs.readdirSync(ATT).filter(f => /\.(png|jpg)$/.test(f)).length === 0 && Number(sql('SELECT COUNT(*) FROM todo_comment_files')) === 0);
  // 画像だけ（文字なし）
  await y.setInputFiles('.modal input[type=file]', IMG + '/shot-small.png'); await y.waitForSelector('.modal .tc-pend'); await y.click('.modal button:has-text("コメントを送る")'); await y.waitForSelector('.modal .tc-item .tc-thumb');
  ok('文字なしで、画像だけのコメントも送れる', true);
  // ToDoを削除すると画像も消える
  await y.keyboard.press('Escape'); await y.waitForFunction(() => !document.querySelector('.modal')); y.once('dialog', d => d.accept());
  await y.click('#todo-mgr .kb-card:has-text("画面の不具合") button:has-text("削除")'); await y.waitForFunction(() => !document.querySelector('#todo-mgr').innerText.includes('画面の不具合')); await y.waitForTimeout(400);
  ok('ToDoを削除すると、画像のファイルも消える', fs.readdirSync(ATT).filter(f => /\.(png|jpg)$/.test(f)).length === 0 && Number(sql('SELECT COUNT(*) FROM todo_comment_files')) === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
