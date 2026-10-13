const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const post = (action, body) => p.evaluate(async ([a, bd]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(bd) }); return await r.json(); }, [action, body]);
  const evs = (from, to) => p.evaluate(async ([f, t]) => (await (await fetch('api.php?action=events&view=team&from=' + f + '&to=' + t)).json()).events, [from, to]);
  const rec = async () => (await evs('2026-12-01', '2027-01-09')).filter(e => e.recurring && e.title === '住民税チェック').map(e => [e.start, e.end]);
  await post('series_save', { rule_type: 'range', title: '住民税チェック', tag: '定例業務', p_day: 26, p_day2: 30, bizonly: true });
  ok('休みが無いときは、12/28〜12/30（営業日のみ）', JSON.stringify(await rec()) === '[["2026-12-28","2026-12-30"]]', await rec());
  const lv = await post('event_save', { kind: 'off', title: '', tag: '有給', start: '2026-12-29', end: '2026-12-31' });
  ok('休み（12/29〜12/31）を入れると、繰り返し業務は12/28だけになる（休みを優先）', JSON.stringify(await rec()) === '[["2026-12-28","2026-12-28"]]', [await rec(), lv]);
  for (let i = 0; i < 2; i++) await p.click('.toolbar button:has-text("›")'); await p.waitForSelector('.cell[data-date="2026-12-30"]'); await p.waitForTimeout(500);
  const barsOn = async (d) => p.evaluate((ds) => { const c = document.querySelector('.cell[data-date="' + ds + '"]'); if (!c) return -1; const r = c.getBoundingClientRect(); return [...document.querySelectorAll('.bar')].filter(b => { const x = b.getBoundingClientRect(); return b.innerText.includes('住民税チェック') && x.left < r.right - 2 && x.right > r.left + 2 && Math.abs(x.top - r.top) < 400 && x.top > r.top && x.bottom < r.bottom + 4; }).length; }, d);
  ok('画面でも、12/28には出て、12/29・12/30には出ない', (await barsOn('2026-12-28')) >= 1 && (await barsOn('2026-12-29')) === 0 && (await barsOn('2026-12-30')) === 0, [await barsOn('2026-12-28'), await barsOn('2026-12-29'), await barsOn('2026-12-30')]);
  await p.screenshot({ path: 'lp-dec.png' });
  await post('event_delete', { id: lv.event.id }); ok('休みを削除すると、元に戻る（12/28〜12/30）', JSON.stringify(await rec()) === '[["2026-12-28","2026-12-30"]]', await rec());
  // 半休では動かさない
  const hv = await post('event_save', { kind: 'off', title: '', tag: '午後半休', start: '2026-12-29', end: '2026-12-29' }); ok('午後半休なら、繰り返し業務はそのまま', JSON.stringify(await rec()) === '[["2026-12-28","2026-12-30"]]', await rec());
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
