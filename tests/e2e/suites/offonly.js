// 業務版（全社）の「休みだけ」: チェックすると、全員の休みだけが表示される（業務の予定は隠す）。外すと戻る。特定の社員を選ぶと、チェックは出ない。開き直すと戻る
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const env = require('../lib/env');
const BASE = env.BASE;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
async function login(b, email, pw) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  return p;
}
const api = (p, a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
(async () => {
  const b = await chromium.launch();
  const today = ymd(new Date());
  const y = await login(b, 'yamada@example.com', 'yamadapass1'); const s = await login(b, 'suzuki@example.com', 'suzukipass1'); const a = await login(b, 'admin@example.com', 'adminpass1');
  await a.evaluate(() => localStorage.setItem('sched.span', '"week"'));
  await api(y, 'event_save', { kind: 'work', title: '休み検証の会議', tag: '打ち合わせ', start: today, end: today });
  await api(s, 'event_save', { kind: 'work', title: '休み検証B', tag: '打ち合わせ', start: today, end: today });
  await api(y, 'event_save', { kind: 'off', title: '', tag: '有給', start: today, end: today });
  await api(s, 'event_save', { kind: 'off', title: '', tag: '午前半休', start: today, end: today });
  await a.reload(); await a.waitForSelector('#who-sel'); await a.selectOption('#who-sel', 'all'); await a.waitForSelector('.bar.work:has-text("休み検証の会議")');
  ok('全社の表示に、「休みだけ」のチェックが出る（初めはオフ）', (await a.locator('#off-only').count()) === 1 && !(await a.locator('#off-only').isChecked()));
  ok('オフのときは、業務も休みも出る', (await a.locator('.bar.work').count()) >= 2 && (await a.locator('.bar.off').count()) >= 2);
  await a.check('#off-only'); await a.waitForFunction(() => !document.querySelector('.bar.work'));
  ok('チェックすると、業務の予定は出なくなる', (await a.locator('.bar.work').count()) === 0);
  const offs = await a.locator('.bar.off').allInnerTexts();
  ok('全員の休みだけが出る（山田さん・鈴木さん）', offs.length >= 2 && offs.some(t => t.includes('山田')) && offs.some(t => t.includes('鈴木')), offs);
  ok('説明の帯に、「全員の休みだけ」と出る', (await a.locator('.view-banner .vb-text').innerText()).includes('全員の休みだけ'), await a.locator('.view-banner .vb-text').innerText());
  ok('チェックしたままでも、チェックは表示されている', await a.locator('#off-only').isChecked());
  const legend = await a.locator('.legend').first().innerText();
  ok('凡例には、休みのある人だけが出る', legend.includes('山田') && legend.includes('鈴木'), legend);
  await a.uncheck('#off-only'); await a.waitForSelector('.bar.work:has-text("休み検証の会議")');
  ok('チェックを外すと、業務の予定が戻る', (await a.locator('.bar.work').count()) >= 2);
  await a.check('#off-only'); await a.waitForFunction(() => !document.querySelector('.bar.work'));
  await a.selectOption('#who-sel', { label: '山田 花子' });
  await a.waitForTimeout(500);
  ok('特定の人を選ぶと、「休みだけ」のチェックは出ない。その人の業務も出る', (await a.locator('#off-only').count()) === 0 && (await a.locator('.bar.work').count()) >= 1);
  await a.reload(); await a.waitForSelector('#who-sel'); await a.selectOption('#who-sel', 'all'); await a.waitForSelector('.bar.work');
  ok('開き直すと、元に戻る（休みだけは覚えない）', !(await a.locator('#off-only').isChecked()) && (await a.locator('.bar.work').count()) >= 2);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
