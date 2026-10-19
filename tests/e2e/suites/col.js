const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
async function login(b, email, pw, vp) { const ctx = await b.newContext({ viewport: vp || { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p; }
const colorOf = (p, txt) => p.locator('.cal .bar:has-text("' + txt + '")').first().evaluate(e => { const c = getComputedStyle(e); return [c.color, c.backgroundColor, c.fontWeight, c.boxShadow]; });
const openColors = async (p) => { await p.click('header button:has-text("設定")'); await p.waitForSelector('#set-colors .cs-row'); };
const tab = (p, name) => p.click('#set-colors .cs-tab:has-text("' + name + '")');
const backToCal = async (p) => { await p.click('button:has-text("カレンダーに戻る")'); await p.waitForSelector('.cal .bar'); await p.waitForTimeout(300); };
(async () => {
  const b = await chromium.launch(); const p = await login(b, 'yamada@example.com', 'yamadapass1');
  await p.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const h = { 'Content-Type': 'application/json', 'X-CSRF-Token': t }; const d = new Date(); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    await fetch('api.php?action=series_save', { method: 'POST', headers: h, body: JSON.stringify({ rule_type: 'day', title: '毎月の締め', tag: '定例業務', p_day: d.getDate(), shift: 'none' }) });
    await fetch('api.php?action=event_save', { method: 'POST', headers: h, body: JSON.stringify({ kind: 'work', title: '単発の打ち合わせ', tag: '打ち合わせ', start: ds, end: ds }) });
    await fetch('api.php?action=event_save', { method: 'POST', headers: h, body: JSON.stringify({ kind: 'work', title: '重要な単発', tag: '打ち合わせ', start: ds, end: ds, important: true }) }); });
  await p.reload(); await p.waitForSelector('.cal .bar');
  // ---- 設定のページ
  await p.click('header button:has-text("設定")'); await p.waitForSelector('.settings-page'); const st = await p.locator('.set-sec > h3').allInnerTexts();
  ok('「設定」を押すと、設定のページが開き、項目が並ぶ（管理者向けは出ない）', ['予定の色', '共有リンク', 'ショートカットキー'].every(x => st.join().includes(x)) && !st.join().includes('繰り返し業務') && !st.join().includes('社員の管理') && !st.join().includes('システム更新'), st);
  ok('色の設定の画面は、タブで切り替える（単発の業務・繰り返しの業務・休み・プライベート・休みの人がいる日）。色の表示は、選んだ1つだけ', (await p.locator('.cs-tab').allInnerTexts()).join(',') === '単発の業務,繰り返しの業務,休み,プライベート,休みの人がいる日' && (await p.locator('.cs-row').count()) === 1);
  await tab(p, '休み'); ok('タブを押すと、その種類の色の画面に切り替わる', (await p.locator('.cs-name').innerText()) === '休み' && (await p.locator('.cs-row').count()) === 1); await tab(p, 'プライベート'); ok('プライベートのタブ', (await p.locator('.cs-name').innerText()) === 'プライベート'); await tab(p, '単発の業務');
  await backToCal(p); await p.click('header button:has-text("山田")'); const um = await p.locator('.menu-list').innerText(); ok('ユーザー名のメニューは、パスワードの変更・繰り返し業務・ログアウトの順', um.includes('パスワードの変更') && um.includes('繰り返し業務') && um.includes('ログアウト') && um.indexOf('パスワードの変更') < um.indexOf('繰り返し業務') && um.indexOf('繰り返し業務') < um.indexOf('ログアウト') && !um.includes('予定の色の設定'), um);
  await p.locator('.menu-list button:has-text("繰り返し業務")').click(); await p.waitForSelector('.modal'); ok('「繰り返し業務」を押すと、繰り返し業務の設定の画面が開く', (await p.locator('.modal').innerText()).includes('繰り返し業務の設定')); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal')); await p.click('header button:has-text("山田")');
  await p.keyboard.press('Escape'); await p.click('body', { position: { x: 5, y: 500 } }); ok('外を押すとメニューが閉じる', (await p.locator('.menu-list').count()) === 0);
  await openColors(p);
  // ---- 明るい色の候補
  const n = await p.locator('.cs-row').locator('button.sw').count(); ok('色の候補は、17色相×3段階の51色', n === 51, n);
  const cols = await p.locator('.cs-row').locator('button.sw').evaluateAll(es => es.map(e => getComputedStyle(e).backgroundColor));
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const bright = cols.filter(c => lum(c) > 0.25).length; ok('候補は、ほとんどが明るい色（51色中48色以上）', bright >= 48, bright);
  await tab(p, '繰り返しの業務'); const warnAll = []; for (let i = 0; i < 51; i++) { await p.locator('.cs-row').locator('button.sw').nth(i).click(); if (await p.locator('.cs-row').locator('.cs-warn').isVisible()) warnAll.push(i); }
  ok('候補の51色は、どれも、文字が読める（警告が出ない）', warnAll.length === 0, warnAll); await p.screenshot({ path: 'col-palette.png' });
  await p.locator('.cs-row').locator('button:has-text("標準に戻す")').click();
  await tab(p, '単発の業務'); await p.locator('.cs-row').locator('input[type=color]').fill('#f5a3a3'); await tab(p, '繰り返しの業務'); await p.locator('.cs-row').locator('input[type=color]').fill('#a3f5b1'); await tab(p, '単発の業務');
  const sm = await p.locator('.cs-row').locator('.bar').evaluate(e => { const c = getComputedStyle(e); return [c.color, c.backgroundColor]; });
  ok('見本は、選んだ色が背景になり、文字は背景の色相に合った濃い色（赤系）', sm[1] === 'rgb(245, 163, 163)' && (() => { const [r, g, bb] = sm[0].match(/\d+/g).map(Number); return r > g + 15 && r > bb + 15 && r < 140; })(), sm);
  // 51色すべてで: 文字が読める（コントラスト7以上）・背景と色相が連動する
  const res = await p.locator('.cs-row').locator('button.sw').evaluateAll(async (btns) => {
    const lumf = (rgb) => { const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const hue = (rgb) => { const [r, g, b] = rgb.map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return null; const d = mx - mn; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return (h + 360) % 360; };
    const sat = (rgb) => { const [r, g, b] = rgb.map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
    const out = []; const row = btns[0].closest('.cs-row');
    for (const bt of btns) { bt.click(); await new Promise(r => setTimeout(r, 0)); const r2 = document.querySelectorAll('.cs-row')[0]; const bar = r2.querySelector('.bar'); const cs = getComputedStyle(bar); const fg = cs.color.match(/\d+/g).map(Number), bg = cs.backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number);
      const [x, y] = [lumf(fg), lumf(bg)].sort((m, n) => n - m); const cr = (x + 0.05) / (y + 0.05); const hf = hue(fg), hb = hue(bg); const dh = hf === null || hb === null || sat(bg) < 0.12 ? 0 : Math.min(Math.abs(hf - hb), 360 - Math.abs(hf - hb)); out.push([cr, dh]); }
    return out; });
  const minCr = Math.min(...res.map(r => r[0])), maxDh = Math.max(...res.map(r => r[1]));
  ok('候補の51色すべてで、文字が読める（背景とのコントラスト4.5以上）', minCr >= 4.5, minCr);
  ok('文字の色は、背景の色相に連動している（色相のずれ25度以内）', maxDh <= 25, maxDh);
  await p.locator('.cs-row').locator('input[type=color]').fill('#f5a3a3');
  await p.click('#set-colors button[type=submit]'); await p.waitForSelector('.toast:has-text("色を保存しました")'); await p.waitForTimeout(400); await backToCal(p);
  const one = await colorOf(p, '単発の打ち合わせ'), rec = await colorOf(p, '毎月の締め'), imp = await colorOf(p, '重要な単発');
  ok('単発の業務の帯が、選んだ明るい赤の背景になる', one[1] === 'rgb(245, 163, 163)' && one[0] !== 'rgb(20, 32, 51)' && Number(one[0].match(/\d+/g)[0]) > Number(one[0].match(/\d+/g)[1]) + 15, one);
  ok('繰り返しの業務の帯は、選んだ明るい緑の背景', rec[1] === 'rgb(163, 245, 177)', rec);
  ok('重要な予定は、同じ背景色のまま、太字＋縁取りで目立つ', imp[1] === 'rgb(245, 163, 163)' && imp[2] === '700' && imp[3] !== 'none', imp);
  await p.screenshot({ path: 'col-light.png' });
  await p.reload(); await p.waitForSelector('.cal .bar'); ok('再読み込みしても残る', (await colorOf(p, '単発の打ち合わせ'))[1] === 'rgb(245, 163, 163)');
  // ---- 他の人の画面
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await s.selectOption('#who-sel', 'all'); await s.waitForSelector('.cal .bar');
  await s.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const d = new Date(); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); await fetch('api.php?action=event_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ kind: 'work', title: '鈴木の業務', tag: '打ち合わせ', start: ds, end: ds }) }); });
  await s.evaluate(() => localStorage.setItem('sched.personColor', 'false')); // 全社の「人ごとに色分け」は、ここでは切っておく（標準の色を確かめるため。人ごとの色は pcolor で確かめる）
  await s.reload(); await s.waitForSelector('.cal .bar:has-text("鈴木の業務")'); await s.selectOption('#who-sel', 'all'); await s.waitForSelector('.cal .bar:has-text("単発の打ち合わせ")');
  const sy = await colorOf(s, '単発の打ち合わせ'), ss = await colorOf(s, '鈴木の業務');
  ok('鈴木さんの画面でも、山田さんの予定は、山田さんの色', sy[1] === 'rgb(245, 163, 163)', sy);
  ok('鈴木さん自身の予定は、標準の色のまま', ss[1] === 'rgb(230, 241, 253)', ss);
  // 他の人の画面の自動反映
  await openColors(p); await p.locator('.cs-row').locator('input[type=color]').fill('#a3c9f5'); await p.click('#set-colors button[type=submit]'); await p.waitForSelector('.toast:has-text("色を保存しました")'); await backToCal(p);
  await s.waitForFunction(() => { const x = [...document.querySelectorAll('.cal .bar')].find(y => y.innerText.includes('単発の打ち合わせ')); return x && getComputedStyle(x).backgroundColor === 'rgb(163, 201, 245)'; }, null, { timeout: 40000 }).catch(() => {});
  ok('色を変えると、開いたままの他の人の画面にも、自動で反映される', (await colorOf(s, '単発の打ち合わせ'))[1] === 'rgb(163, 201, 245)', await colorOf(s, '単発の打ち合わせ'));
  // ---- 標準に戻す
  await openColors(p); await p.click('#set-colors button:has-text("すべて標準に戻す")'); await p.click('#set-colors button[type=submit]'); await p.waitForSelector('.toast:has-text("色を保存しました")'); await p.waitForTimeout(400); await backToCal(p);
  ok('「すべて標準に戻す」で元の色に戻る', (await colorOf(p, '単発の打ち合わせ'))[1] === 'rgb(230, 241, 253)');
  // ---- スマホ幅
  const m = await login(b, 'yamada@example.com', 'yamadapass1', { width: 390, height: 800 });
  ok('スマホ幅でも、トップバーが横にはみ出さない（設定・ユーザー名のボタンが見える）', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && await m.locator('header button:has-text("設定")').isVisible() && await m.locator('header button:has-text("山田")').isVisible());
  await m.click('header button:has-text("設定")'); await m.waitForSelector('.settings-page'); await m.waitForTimeout(500); await m.screenshot({ path: 'col-mobile.png' });
  ok('スマホ幅でも、設定のページが横にはみ出さない', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
