const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
(async () => {
  const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme }); const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
    await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1'); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
    if (scheme === 'light') {
      await p.evaluate(async () => { const t = document.getElementById('app').dataset.csrf; const h = { 'Content-Type': 'application/json', 'X-CSRF-Token': t }; const d = new Date(); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        await fetch('api.php?action=series_save', { method: 'POST', headers: h, body: JSON.stringify({ rule_type: 'day', title: '毎月の締め', tag: '定例業務', p_day: d.getDate(), shift: 'none' }) });
        await fetch('api.php?action=event_save', { method: 'POST', headers: h, body: JSON.stringify({ kind: 'work', title: '単発の打ち合わせ', tag: '打ち合わせ', start: ds, end: ds }) });
        await fetch('api.php?action=event_save', { method: 'POST', headers: h, body: JSON.stringify({ kind: 'work', title: '重要な単発', tag: '打ち合わせ', start: ds, end: ds, important: true }) }); });
      await p.reload(); await p.waitForSelector('.bar');
    } else { await p.waitForSelector('.bar'); }
    const col = async (txt) => p.locator('.bar:has-text("' + txt + '")').first().evaluate(e => { const c = getComputedStyle(e); return [c.color, c.backgroundColor]; });
    const rec = await col('毎月の締め'), one = await col('単発の打ち合わせ');
    ok(`[${scheme}] 繰り返しの業務と単発の業務で、文字の色が違う`, rec[0] !== one[0], [rec, one]);
    ok(`[${scheme}] 繰り返しの文字は、背景に対して十分に読める（コントラスト4.5以上）`, contrast(rec[0], rec[1]) >= 4.5, contrast(rec[0], rec[1]));
    ok(`[${scheme}] 単発の文字も読める`, contrast(one[0], one[1]) >= 4.5, contrast(one[0], one[1]));
    await p.screenshot({ path: `rec-${scheme}.png` });
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
