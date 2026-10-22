// 自分の休みの出し方（版ごと）: プライベート版は、初めから「休」のアイコンだけ（帯は出ない）。業務版は、初めは帯。
// 設定の「休みの出し方」で、版ごとに変えられる。家族用リンク・家族の画面は、持ち主のプライベート版の設定に従う
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
  const now = new Date(); const day = ymd(new Date(now.getFullYear(), now.getMonth(), 15)); const half = ymd(new Date(now.getFullYear(), now.getMonth(), 16));
  const y = await login(b, 'yamada@example.com', 'yamadapass1'); const s = await login(b, 'suzuki@example.com', 'suzukipass1');
  await api(y, 'event_save', { kind: 'off', title: '', tag: '有給', start: day, end: day, family_shared: 1 });
  await api(y, 'event_save', { kind: 'off', title: '', tag: '午後半休', start: half, end: half, family_shared: 1 });
  await api(s, 'event_save', { kind: 'off', title: '', tag: '有給', start: day, end: day });
  const cell = (p, d) => p.locator('.cell[data-date="' + d + '"]');
  // プライベート版（初期値: アイコン）
  await y.click('.tab[data-view=me]'); await y.waitForSelector('.cell[data-date="' + day + '"] .offmark');
  ok('プライベート版: 自分の休みの日は、日付の横に「休」のアイコンだけ（休みの帯は出ない）', (await cell(y, day).locator('.offmark').innerText()) === '休' && (await y.locator('.bar.off').count()) === 0);
  await y.screenshot({ path: 'offmark-me.png' });
  ok('プライベート版: 半休は「半休」のアイコン', (await cell(y, half).locator('.offmark').innerText()) === '半休');
  ok('アイコンに、休みの内容の説明（ホバー）が付く', (await cell(y, day).locator('.offmark').getAttribute('title')).includes('有給'));
  await cell(y, day).locator('.offmark').click(); await y.waitForSelector('.modal');
  ok('アイコンを押すと、その休みが開く', (await y.locator('.modal').innerText()).includes('有給'));
  await y.keyboard.press('Escape'); await y.waitForFunction(() => !document.querySelector('.modal'));
  // 業務版（初期値: 帯）
  await y.click('.tab[data-view=team]'); await y.waitForSelector('#who-sel'); await y.selectOption('#who-sel', 'all'); await y.waitForSelector('.bar.off');
  ok('業務版: 初めは、これまでどおり帯（アイコンは出ない）', (await y.locator('.offmark').count()) === 0 && (await y.locator('.bar.off').count()) >= 3);
  // 設定で、版ごとに変える
  await y.click('header button:has-text("設定")'); await y.waitForSelector('#set-offmark select[name=offmark_team]');
  ok('設定に「休みの出し方」があり、業務版 = 帯、プライベート版 = アイコンが選ばれている', (await y.inputValue('#set-offmark select[name=offmark_team]')) === 'bar' && (await y.inputValue('#set-offmark select[name=offmark_me]')) === 'icon');
  await y.selectOption('#set-offmark select[name=offmark_team]', 'icon'); await y.selectOption('#set-offmark select[name=offmark_me]', 'bar');
  await y.click('#set-offmark button:has-text("保存")'); await y.waitForSelector('.toast:has-text("休みの出し方を保存しました")');
  await y.click('button:has-text("カレンダーに戻る")'); await y.waitForSelector('.cal'); await y.selectOption('#who-sel', 'all'); await y.waitForSelector('.cell[data-date="' + day + '"] .offmark');
  const teamBars = await y.locator('.bar.off').allInnerTexts();
  ok('業務版をアイコンにすると、自分の休みはアイコン、ほかの人の休みは帯のまま', (await cell(y, day).locator('.offmark').count()) === 1 && teamBars.some(t => t.includes('鈴木')) && !teamBars.some(t => t.includes('山田')), teamBars);
  await y.click('.tab[data-view=me]'); await y.waitForSelector('.bar.off');
  ok('プライベート版を帯にすると、帯に戻る（アイコンは出ない）', (await y.locator('.offmark').count()) === 0 && (await y.locator('.bar.off').count()) >= 2);
  // 家族用リンク: 持ち主のプライベート版の設定に従う
  const path = (await api(y, 'share_create', { kind: 'family' })).path;
  const g = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); g.on('pageerror', e => console.log('PAGEERR', e.message));
  await g.goto(BASE + path); await g.waitForSelector('.cal'); await g.waitForSelector('.bar.off');
  ok('家族用リンク: 持ち主のプライベート版が帯なら、帯', (await g.locator('.offmark').count()) === 0);
  await api(y, 'offmark_save', { offmark: { team: 'bar', me: 'icon' } });
  await g.reload(); await g.waitForSelector('.cell[data-date="' + day + '"] .offmark');
  ok('家族用リンク: 持ち主のプライベート版がアイコンなら、休みは「休」のアイコンだけ', (await g.locator('.bar.off').count()) === 0 && (await cell(g, day).locator('.offmark').innerText()) === '休');
  // 家族の画面: 持ち主のプライベート版の設定に従う
  const inv = await api(y, 'family_add', { name: '山田 妻', email: 'wife-om@example.com' });
  const f = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); f.on('pageerror', e => console.log('PAGEERR', e.message));
  await f.goto(BASE + 'login.php'); await f.fill('input[name=email]', 'wife-om@example.com'); await f.fill('input[name=password]', inv.password);
  await Promise.all([f.waitForURL('**/index.php'), f.click('button[type=submit]')]); await f.waitForSelector('.modal');
  await f.fill('.modal input[autocomplete=current-password]', inv.password); await f.fill('.modal input[autocomplete=new-password]', 'familypass99'); await f.click('.modal button[type=submit]');
  await f.waitForSelector('.cell[data-date="' + day + '"] .offmark');
  ok('家族の画面: 持ち主の休みは、「休」のアイコンだけ', (await f.locator('.bar.off').count()) === 0 && (await cell(f, day).locator('.offmark').count()) === 1);
  const denied = await f.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; return (await fetch('api.php?action=offmark_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ offmark: { me: 'bar' } }) })).status; });
  ok('家族のアカウントは、休みの出し方を変えられない（403）', denied === 403, denied);
  // スマホ幅: アイコンを押すと、その日の一覧
  const m = await (await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  await m.goto(BASE + path); await m.waitForSelector('.cell[data-date="' + day + '"] .offmark');
  await m.screenshot({ path: 'offmark-mobile.png' });
  await m.locator('.cell[data-date="' + day + '"] .offmark').tap(); await m.waitForSelector('.modal');
  ok('スマホ: アイコンを押すと、その日の一覧に休みが出る', (await m.locator('.modal').innerText()).includes('休み'), await m.locator('.modal').innerText());
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
