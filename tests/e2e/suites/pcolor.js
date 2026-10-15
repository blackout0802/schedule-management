// 全社の表示: 業務の予定の先頭に名前（姓）／人ごとの色分け（休みは「休」バッジ）／同じ姓はフルネーム／本人が決めた色が優先／自分の表示には名前を付けない
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
const styleOf = (p, sel) => p.locator(sel).first().getAttribute('style');

(async () => {
  const b = await chromium.launch();
  const today = ymd(new Date());
  const y = await login(b, 'yamada@example.com', 'yamadapass1'); const s = await login(b, 'suzuki@example.com', 'suzukipass1'); const a = await login(b, 'admin@example.com', 'adminpass1');
  await api(y, 'event_save', { kind: 'work', title: 'PC検証会議', tag: '打ち合わせ', start: today, end: today });
  await api(s, 'event_save', { kind: 'work', title: 'PC検証B', tag: '打ち合わせ', start: today, end: today });
  await api(y, 'event_save', { kind: 'off', title: '', tag: '有給', start: today, end: today });
  const whoAll = async p => { await p.reload(); await p.waitForSelector('#who-sel'); await p.selectOption('#who-sel', 'all'); await p.waitForSelector('.bar.work:has-text("PC検証会議")'); };
  await whoAll(a);
  const yBar = '.bar.work:has-text("PC検証会議")', sBar = '.bar.work:has-text("PC検証B")';
  ok('全社の表示: 業務の予定の先頭に、持ち主の姓が付く（山田｜…、鈴木｜…）', (await a.locator(yBar).first().innerText()).startsWith('山田｜') && (await a.locator(sBar).first().innerText()).startsWith('鈴木｜'), [await a.locator(yBar).first().innerText(), await a.locator(sBar).first().innerText()]);
  const ys = await styleOf(a, yBar), ss = await styleOf(a, sBar);
  ok('全社の表示: 人ごとに、違う色になる（初期値でオン）', !!ys && !!ss && ys.includes('--ub-work') && ss.includes('--ub-work') && ys !== ss, [ys, ss]);
  const offSel = '.bar.off.pc:has-text("山田")';
  const bg = sel => a.locator(sel).first().evaluate(e => getComputedStyle(e).backgroundColor);
  ok('全社の表示: 休みも、山田さんの業務と同じ淡い色で、頭に「休」バッジが付く', (await a.locator(offSel).count()) >= 1 && (await bg(offSel)) === (await bg(yBar)) && (await a.locator(offSel).first().evaluate(e => getComputedStyle(e, '::before').content)) === '"休"' && (await styleOf(a, offSel)).includes('--pc-badge'), [await bg(offSel), await bg(yBar)]);
  ok('「休」バッジは、人ごとの濃い色（帯の背景より濃い）', await a.locator(offSel).first().evaluate(e => { const c = s => s.match(/\d+/g).map(Number); const b = c(getComputedStyle(e).backgroundColor), k = c(getComputedStyle(e, '::before').backgroundColor); return (k[0] + k[1] + k[2]) < (b[0] + b[1] + b[2]); }));
  const offTxt = await a.locator(offSel).first().innerText();
  ok('全社の表示: 休みの帯は、「休」バッジと姓だけ（休みの分類は出さない）。くわしくは、押す・ホバーで', offTxt.trim() === '山田' && !offTxt.includes('有給') && (await a.locator(offSel).first().getAttribute('title')).includes('山田 花子') && (await a.locator(offSel).first().getAttribute('title')).includes('有給'), [offTxt, await a.locator(offSel).first().getAttribute('title')]);
  ok('「表示する人」の文字はなく、選択肢は「全社」（「（全員）」は付かない）', (await a.locator('label.who .lbl').count()) === 0 && (await a.locator('#who-sel option').first().innerText()) === '全社', await a.locator('#who-sel option').first().innerText());
  const legend = await a.locator('.legend').first().innerText();
  ok('凡例に、いま出ている社員の名前と、「休」バッジの説明が出る', legend.includes('山田') && legend.includes('鈴木') && legend.includes('休＝休み'), legend);
  ok('「人ごとに色分け」の切り替えが、全社のときだけ出る', (await a.locator('#pc-toggle').count()) === 1 && (await a.locator('#pc-toggle').isChecked()));
  // 切ると、色は標準に戻る（名前は残る）。開き直しても覚えている
  await a.uncheck('#pc-toggle'); await a.waitForTimeout(300);
  ok('切ると、標準の色（青）に戻り、「休」バッジもなくなる。先頭の名前は残る', !(await styleOf(a, yBar) || '').includes('--ub-work') && (await a.locator('.bar.off.pc').count()) === 0 && (await a.locator(yBar).first().innerText()).startsWith('山田｜'));
  await a.reload(); await a.waitForSelector('#who-sel'); await a.selectOption('#who-sel', 'all'); await a.waitForSelector(yBar);
  ok('切り替えは、開き直しても覚えている', !(await a.locator('#pc-toggle').isChecked()) && !(await styleOf(a, yBar) || '').includes('--ub-work'));
  await a.check('#pc-toggle'); await a.waitForTimeout(300);
  // 本人が決めた色が優先される
  const pr = await api(y, 'prefs_save', { colors: { work: '#f5a3a3', rec: '', off: '', private: '' }, offday: { on: true, color: '' } });
  await whoAll(a);
  ok('本人が「予定の色」で決めた色があれば、そちらが優先される', (await styleOf(a, yBar)).includes('#f5a3a3') && (await styleOf(a, sBar)).includes('--ub-work') && !(await styleOf(a, sBar)).includes('#f5a3a3'), [pr, await styleOf(a, yBar)]);
  await api(y, 'prefs_save', { colors: { work: '', rec: '', off: '', private: '' }, offday: { on: true, color: '' } });
  // 同じ姓の人がいるとき: フルネーム
  env.sql("INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES ('山田 二郎', 'y2@example.com', 'x', 'member', 1, '2026-01-01 00:00:00')");
  const y2 = env.sql("SELECT id FROM users WHERE email = 'y2@example.com'");
  env.sql(`INSERT INTO events (owner_id, title, kind, tag, start_date, end_date, created_by, created_at, updated_at) VALUES (${y2}, 'PC検証C', 'work', '打ち合わせ', '${today}', '${today}', ${y2}, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  await a.reload(); await a.waitForSelector('#who-sel'); await a.selectOption('#who-sel', 'all'); await a.waitForSelector('.bar.work:has-text("PC検証C")');
  env.sql(`INSERT INTO events (owner_id, title, kind, tag, start_date, end_date, created_by, created_at, updated_at) VALUES (${y2}, '', 'off', '有給', '${today}', '${today}', ${y2}, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  await a.reload(); await a.waitForSelector('#who-sel'); await a.selectOption('#who-sel', 'all'); await a.waitForSelector('.bar.off.pc:has-text("山田 二郎")');
  ok('同じ姓の人の休みは、フルネーム（休バッジ＋山田 花子 / 山田 二郎）。姓が違う人は姓だけ', (await a.locator('.bar.off.pc:has-text("山田 花子")').count()) >= 1 && (await a.locator('.bar.off.pc:has-text("山田 二郎")').count()) >= 1);
  ok('同じ姓の人がいるときは、フルネームにする（山田 花子｜…、山田 二郎｜…）。姓が違う人は、姓だけ', (await a.locator(yBar).first().innerText()).startsWith('山田 花子｜') && (await a.locator('.bar.work:has-text("PC検証C")').first().innerText()).startsWith('山田 二郎｜') && (await a.locator(sBar).first().innerText()).startsWith('鈴木｜'));
  // 特定の人・自分の表示には、名前も色分けも付けない
  await a.selectOption('#who-sel', String(y2)); await a.waitForSelector('.bar.work:has-text("PC検証C")');
  ok('特定の人だけを見るときは、名前を付けず、色分けもしない（切り替えも出ない）', !(await a.locator('.bar.work:has-text("PC検証C")').first().innerText()).includes('｜') && (await a.locator('#pc-toggle').count()) === 0 && !(await styleOf(a, '.bar.work:has-text("PC検証C")') || '').includes('--ub-work'));
  await y.reload(); await y.waitForSelector('.bar.work:has-text("PC検証会議")');
  ok('自分の表示（初期）にも、名前は付かない', !(await y.locator('.bar.work:has-text("PC検証会議")').first().innerText()).includes('｜') && (await y.locator('#pc-toggle').count()) === 0);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
