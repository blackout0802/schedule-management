// ToDo リストの未着手の列で「＋ 追加」を開いても、追加欄（日付・キャンセル・追加の行）が列からはみ出さない（v1.105.1）。
// パソコン幅（1280px・1024px）・タブレット幅・スマホ幅（タブ表示）・ダークモード、カレンダーの右端の ToDo も
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const api = (p, a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
// 箱（sel）の中身が横にはみ出していないか。追加欄の部品が、箱の右端より内側にあるか
const measure = (p, sel) => p.evaluate(sel => {
  const box = document.querySelector(sel); if (!box) return null;
  const r = box.getBoundingClientRect(), form = box.querySelector('.todo-add');
  const parts = form ? [form].concat(Array.from(form.querySelectorAll('input, button'))) : [];
  const out = parts.filter(e => e.getBoundingClientRect().right > r.right + 0.5).map(e => e.className || e.type);
  const cards = Array.from(box.querySelectorAll('.kb-card')).filter(e => e.getBoundingClientRect().right > r.right + 0.5).length;
  return { cw: box.clientWidth, sw: box.scrollWidth, open: !!form, out, cards };
}, sel);
async function login(b, opt) {
  const p = await (await b.newContext(opt)).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p;
}
(async () => {
  const b = await chromium.launch();
  const cases = [
    { name: '1280px', opt: { viewport: { width: 1280, height: 900 } } },
    { name: '1024px', opt: { viewport: { width: 1024, height: 800 } } },
    { name: 'タブレット幅（820px）', opt: { viewport: { width: 820, height: 1100 } } },
    { name: 'スマホ幅（390px・タブ表示）', opt: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'ダークモード（1280px）', opt: { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' } },
  ];
  let first = true;
  for (const c of cases) {
    const p = await login(b, c.opt);
    if (first) { await api(p, 'todo_save', { title: '長めの名前の未着手のToDo（カードの幅の確かめ）', kind: 'work', tag: '個人作業' }); first = false; }
    await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('#todo-mgr .kb-col.todo .kb-card');
    const col = '#todo-mgr .kb-col.todo';
    const closed = await measure(p, col);
    ok(c.name + ': 追加欄を閉じているときも、はみ出さない', closed && closed.sw <= closed.cw && !closed.cards, closed);
    await p.click(col + ' .todo-add-btn'); await p.waitForSelector(col + ' .todo-add input[type=text]');
    const m = await measure(p, col);
    ok(c.name + ': 「＋ 追加」を開いても、未着手の列の scrollWidth が clientWidth を超えない', m && m.open && m.sw <= m.cw, m);
    ok(c.name + ': 日付・キャンセル・追加と、カードが、列の右端の内側にある', m && !m.out.length && !m.cards, m);
    if (c.name === '1280px') {
      // 開いたまま、ToDo を足せる（ボタンが押せる）
      await p.fill(col + ' .todo-add input[type=text]', '追加欄から足したToDo'); await p.click(col + ' .todo-add button[type=submit]');
      await p.waitForSelector(col + ' .kb-card:has-text("追加欄から足したToDo")');
      ok(c.name + ': 「追加」で足せる', true);
      await p.click(col + ' .todo-add button:has-text("キャンセル")'); await p.waitForSelector(col + ' .todo-add-btn');
      ok(c.name + ': 「キャンセル」で閉じる', (await p.locator(col + ' .todo-add').count()) === 0);
      // カレンダーの右端の ToDo（同じ追加欄を使う）
      await p.click('.seg label:has-text("カレンダー")'); await p.click('#todo-hover'); await p.waitForSelector('#todo-panel.open .todo-add-btn');
      await p.click('#todo-panel .todo-add-btn'); await p.waitForSelector('#todo-panel .todo-add input[type=text]');
      const s = await measure(p, '#todo-panel');
      ok(c.name + ': カレンダーの右端の ToDo（同じ追加欄）でも、はみ出さない', s && s.open && s.sw <= s.cw && !s.out.length, s);
    }
    await p.screenshot({ path: 'kbadd-' + c.opt.viewport.width + (c.opt.colorScheme ? '-dark' : '') + '.png', fullPage: false });
    await p.context().close();
  }
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
