// カレンダー右端の ToDo パネル: 入力中は、マウスが外へ出ても、閉じない。入力を終えて（欄の外をクリック）、マウスも外なら、閉じる
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const hoverEdge = async () => { await p.waitForFunction(() => !document.getElementById('todo-panel'), null, { timeout: 4000 }).catch(() => {}); const r = await p.evaluate(() => { const z = document.getElementById('todo-hover').getBoundingClientRect(); return [z.left + z.width / 2, z.top + z.height / 2]; }); await p.mouse.move(r[0] - 200, r[1]); await p.mouse.move(r[0], r[1], { steps: 8 }); };
  const open = () => p.evaluate(() => { const x = document.getElementById('todo-panel'); return !!x && x.classList.contains('open'); });
  // 右端にカーソルを持っていくと、パネルが開く
  await hoverEdge(); await p.waitForSelector('#todo-panel.open');
  ok('右端にカーソルを持っていくと、ToDoパネルが開く', await open());
  await p.click('#todo-panel .todo-add-btn'); await p.waitForSelector('#todo-panel .todo-add input[type=text]');
  await p.fill('#todo-panel .todo-add input[type=text]', '入力の途中で閉じない');
  // マウスを、パネルの外（カレンダーの真ん中）へ動かして、しばらく待つ
  await p.mouse.move(300, 400); await p.waitForTimeout(1500);
  ok('入力中は、マウスが外へ出ても、パネルは閉じない', await open());
  ok('入力した文字も、そのまま残っている', (await p.inputValue('#todo-panel .todo-add input[type=text]')) === '入力の途中で閉じない');
  await p.keyboard.type('（続き）'); await p.waitForTimeout(800);
  ok('続けて、最後まで入力できる', (await p.inputValue('#todo-panel .todo-add input[type=text]')) === '入力の途中で閉じない（続き）' && await open());
  await p.keyboard.press('Enter'); await p.waitForSelector('#todo-panel .tp-card:has-text("入力の途中で閉じない（続き）")');
  ok('Enter で追加できる（パネルの中に出る）', true);
  // 入力欄の外をクリックして、マウスも外なら、閉じる
  await p.mouse.click(700, 25); await p.waitForTimeout(1500); // 上の帯の空いた所（カレンダーの日付は、押すと入力画面が開くので避ける）
  ok('欄の外をクリックして、マウスも外にあれば、あとで閉じる', !(await open()));
  // ふつうに（入力せず）開いて、マウスを外すと、今までどおり閉じる
  await hoverEdge(); await p.waitForSelector('#todo-panel.open'); await p.mouse.move(300, 400); await p.waitForTimeout(1200);
  ok('入力していないときは、マウスが外へ出ると、今までどおり閉じる', !(await open()));
  // ✕ で閉じられる（入力中でも）
  await hoverEdge(); await p.waitForSelector('#todo-panel.open'); if (await p.locator('#todo-panel .todo-add-btn').count()) await p.click('#todo-panel .todo-add-btn'); await p.waitForSelector('#todo-panel .todo-add input[type=text]'); await p.focus('#todo-panel .todo-add input[type=text]');
  await p.click('#todo-panel .tp-head button'); await p.waitForTimeout(500);
  ok('✕ を押せば、入力中でも閉じる', !(await open()) && await p.locator('#todo-panel').count() === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
