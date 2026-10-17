// カレンダー: 1日の高さは固定（予定が増えても変わらない。入りきらない分は「他 n件」）／完了した予定は、同じ日の中で、下／週表示の予定の帯は、月表示と同じ高さ
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0'); const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e)));
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const t = new Date(); const day = ymd(new Date(t.getFullYear(), t.getMonth(), 10));
  const hOf = () => p.locator('.cal .week').evaluateAll(l => l.map(e => Math.round(e.getBoundingClientRect().height)));
  const before = await hOf();
  ok('月表示: どの週も、同じ高さ（予定のない週でも、ある週でも）。1日は約134px（従来より、長め）', Math.max(...before) - Math.min(...before) <= 1 && before[0] >= 130, before);
  // 1日に、7件（うち1件は完了、1件は進行中）
  for (let i = 1; i <= 7; i++) await api('event_save', { kind: 'work', title: '多い日の予定' + i, tag: '打ち合わせ', start: day, end: day, start_time: pad(8 + i) + ':00', end_time: pad(8 + i) + ':30', todo_status: i === 1 ? 'done' : i === 2 ? 'doing' : '' });
  await p.reload(); await p.waitForSelector('.cal'); await p.waitForTimeout(400);
  const after = await hOf();
  ok('予定が増えても、週の高さは変わらない', JSON.stringify(after) === JSON.stringify(before), [before, after]);
  const cell = '.cell[data-date="' + day + '"]';
  const more = await p.locator('.cal .more').allInnerTexts();
  ok('入りきらない予定は、「他 n件」にまとまる（7件のうち、4件が見えて、3件が「他 3件」）', more.length === 1 && more[0] === '他 3件' && (await p.locator('.cal .week:has(' + cell + ') .bar:has-text("多い日の予定")').count()) === 4, [more, await p.locator('.cal .bar:has-text("多い日の予定")').count()]);
  await p.click('.cal .more'); await p.waitForSelector('.modal .day-list');
  const popup = await p.locator('.modal .day-item').allInnerTexts();
  ok('「他 n件」を押すと、その日の予定が、すべて開く（7件）', popup.length === 7, popup.length);
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal'));
  // 完了した予定は、下（見えている4件に入らず、「他」に回る）
  const shown = await p.locator('.cal .bar:has-text("多い日の予定")').allInnerTexts();
  ok('完了した予定（1番目）は、完了していない予定より下に回り、見えている4件には入らない', !shown.some(x => x.includes('予定1')) && shown.some(x => x.includes('予定2')), shown);
  // 帯の高さ: 週表示も、月表示と同じ
  const barH = async () => p.locator('.cal .bar:has-text("多い日の予定")').first().evaluate(e => Math.round(e.getBoundingClientRect().height));
  const hm = await barH();
  await p.click('.span-sw button:has-text("週")'); await p.waitForTimeout(500);
  for (let i = 0; i < 8 && !(await p.locator('.cal .week .cell[data-date="' + day + '"]').count()); i++) { // その日の週まで、動く（今日より前か後かで、向きを決める）
    const first = await p.locator('.cal .week .cell').first().getAttribute('data-date');
    await p.click('.toolbar button[aria-label="' + (day < first ? '前の週' : '次の週') + '"]'); await p.waitForTimeout(400);
  }
  const hw = await barH();
  ok('週表示の予定の帯は、月表示と同じ高さ', hm === hw && hm <= 22, [hm, hw]);
  ok('週表示は、7件とも見える（入りきる）', (await p.locator('.cal .bar:has-text("多い日の予定")').count()) === 7 && (await p.locator('.cal .more').count()) === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
