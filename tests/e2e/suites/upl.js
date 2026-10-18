// システム更新: ファイルを選んだら、ボタンを押さなくても、自動で更新が始まる（zip 以外は、始めずに知らせる）
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const fs = require('fs'); const path = require('path');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const root = path.join(__dirname, '..', '..', '..');
  const dist = path.join(root, 'dist');
  // dist/ は git に入れていない（CIには無い）ので、いまの版の更新ファイルを、その場で作る
  require('child_process').execFileSync('python3', [path.join(root, 'tools', 'make_update.py')], { cwd: root, stdio: 'ignore' });
  const zips = fs.readdirSync(dist).filter(f => /^update-v[\d.]+\.zip$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const zip = path.join(dist, zips[zips.length - 1]);
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', String(e)));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.goto(BASE + 'update.php'); await p.waitForSelector('#upload-file');
  ok('「ファイルを選ぶと、そのまま更新を始めます」の案内が出る', (await p.locator('#upload-note').innerText()).includes('そのまま更新を始めます'));
  // zip ではないファイル: 始めない
  const txt = path.join(require('os').tmpdir(), 'not-a-zip.txt'); fs.writeFileSync(txt, 'x');
  let navigated = false; p.on('framenavigated', () => { navigated = true; });
  await p.setInputFiles('#upload-file', txt); await p.waitForTimeout(800);
  ok('zip でないファイルを選んでも、更新は始まらず、知らせが出る（選んだファイルは外れる）', !navigated && (await p.locator('#upload-note').innerText()).includes('zip のファイルを選んでください') && (await p.inputValue('#upload-file')) === '', await p.locator('#upload-note').innerText());
  // zip: 自動で送られる
  await Promise.all([p.waitForNavigation(), p.setInputFiles('#upload-file', zip)]);
  const body = await p.locator('main').innerText();
  ok('zip を選ぶと、ボタンを押さなくても、更新が行われ、結果の画面になる', /個のファイルを更新しました|変更はありません|更新するファイル|より古い版/.test(body) && (await p.locator('#upload-form').count()) === 1, body.slice(0, 300));
  console.log('   結果の画面:', body.replace(/\n+/g, ' / ').slice(0, 260));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
