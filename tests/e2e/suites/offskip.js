const { chromium } = require(process.env.NODE_PATH + '/playwright');
// 期間のある業務: 本人の休みの日には帯を出さない／ドラッグで動かすと、最初と最後の休みの日（土日・祝日・本人の休み）を削る
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => (n < 10 ? '0' : '') + n; const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8099/login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const post = (act, body) => p.evaluate(async ([act, body]) => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify(body) }); return [r.status, await r.json()]; }, [act, body]);
  const get = q => p.evaluate(async q => (await fetch('api.php?action=' + q)).json(), q);
  // 3週先から、月〜金と次の週の月〜金に祝日のない週を探す（日付によって祝日に当たらないように）
  const sun0 = add(new Date(), -new Date().getDay()); let w = 3, sun;
  for (; w < 20; w++) {
    sun = add(sun0, 7 * w); const hol = (await get(`events&view=me&from=${ymd(sun)}&to=${ymd(add(sun, 15))}`)).holidays || {};
    if (![1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 15].some(i => hol[ymd(add(sun, i))])) break;
  }
  const D = i => ymd(add(sun, i)); // 0 = 日曜
  await post('event_save', { kind: 'work', title: '休みをはさむ業務', tag: '個人作業', start: D(1), end: D(5) });
  await post('event_save', { kind: 'off', title: '', tag: '調整休', start: D(3), end: D(3) });
  await post('event_save', { kind: 'work', title: '動かす業務', tag: '個人作業', start: D(8), end: D(10) });
  await post('event_save', { kind: 'off', title: '', tag: '調整休', start: D(11), end: D(12) });
  await p.evaluate(() => localStorage.setItem('sched.span', '"week"')); await p.reload(); await p.waitForSelector('.cal.wk');
  for (let i = 0; i < w; i++) { await p.click('button[aria-label="次の週"]'); await p.waitForTimeout(150); }
  await p.waitForSelector('.bar:has-text("休みをはさむ業務")');
  const cols = t => p.$$eval('.bar', (bs, t) => bs.filter(b => b.textContent.includes(t)).length, t);
  ok('本人の休み（水）をはさむ業務は、休みの日に帯が出ず、2本に分かれる', await cols('休みをはさむ業務') === 2, await cols('休みをはさむ業務'));
  // 次の週: 「動かす業務」（月〜水）を、水曜へドラッグ → 水〜金のうち、木・金は本人の休みなので削る
  await p.click('button[aria-label="次の週"]'); await p.waitForSelector(`.cell[data-date="${D(10)}"]`); await p.waitForSelector('.bar:has-text("動かす業務")');
  await p.locator('.bar:has-text("動かす業務")').first().dragTo(p.locator(`.cell[data-date="${D(10)}"]`).first(), { force: true, sourcePosition: { x: 8, y: 6 }, targetPosition: { x: 20, y: 10 } });
  await p.waitForSelector('.toast:has-text("休みの日は除きました")');
  ok('ドラッグで動かすと、最後の休みの日（木・金）を削って、そう知らせる', true);
  const ev2 = (await get(`events&view=team&from=${D(7)}&to=${D(14)}`)).events.find(e => e.title === '動かす業務');
  ok('動かした予定は、水曜の1日になる', ev2 && ev2.start === D(10) && ev2.end === D(10), ev2);
  // 3日間の業務を土曜へ → 土日を削って、月曜からに（日数は増やさない）
  const e3 = (await post('event_save', { kind: 'work', title: '土曜へ動かす業務', tag: '個人作業', start: D(1), end: D(3) }))[1].event;
  const [st3, j3] = await post('event_move', { id: e3.id, start: D(13) });
  ok('動かした先の最初の土日も削る（日数は増やさない）', st3 === 200 && j3.start === D(15) && j3.end === D(15), j3);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
