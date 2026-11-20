// 日報に入る予定の行に、カレンダーの予定の時刻が付く（v1.117.0）。
//   1日の予定は「10:00〜11:00 名前」（開始だけなら「09:00 名前」）、期間のある予定は初日に「13:00〜 」・最終日に「〜17:00 」。時刻のない予定は、名前だけ。
//   予定の時刻を変えると行の時刻も変わり、時刻を消すと名前だけに戻る。当日から次回出勤日へ転記した行は、次回出勤日の時刻になる。
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 900)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e))); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', 'yamada@example.com'); await p.fill('input[name=password]', 'yamadapass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  const api = (a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const { cur, next } = await p.evaluate(async () => (await fetch('api.php?action=memo_get')).json());
  const ev = async (title, start, end, st, et) => (await api('event_save', { kind: 'work', title, tag: '個人作業', start, end: end || start, start_time: st || '', end_time: et || '' })).event;
  const A = await ev('時刻のある業務', cur, cur, '10:00', '11:00');
  await ev('開始だけの業務', cur, cur, '09:00', '');
  await ev('時刻のない業務', cur);
  await ev('期間のある業務', cur, next, '13:00', '17:00');
  await ev('次回の時刻の業務', next, next, '15:00', '16:00');
  await ev('9:30 朝礼', cur);
  const head = (k, d) => '<div data-md="' + k + '" data-date="' + d + '">【' + (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '　予定・To Do】</div>';
  await api('memo_save', { html: '<div>お疲れ様です。</div><div><br></div>' + head('cur', cur) + '<div><br></div><div>自分で書いた行</div><div><br></div>' + head('next', next) + '<div><br></div><div><br></div><div>以上となります。</div>' });
  await p.reload(); await p.waitForSelector('.cal');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single');
  const items = (kind) => p.evaluate((kind) => {
    const h = document.querySelector('.memo-single div[data-md=' + kind + ']'); const out = [];
    let d = h.nextElementSibling; if (d && !d.textContent.trim()) d = d.nextElementSibling;
    while (d && d.textContent.trim() && !d.hasAttribute('data-md')) { out.push(d.textContent + (d.hasAttribute('data-tr') ? '[tr]' : '')); d = d.nextElementSibling; }
    return out;
  }, kind);
  const waitLine = (t) => p.waitForFunction((t) => { // 見つかるまで、2秒ごとに読み直す（focus で日報とカレンダーを読み直す）
    if (Array.from(document.querySelectorAll('.memo-single div[data-ev]')).some(d => d.textContent === t)) return true;
    window.dispatchEvent(new Event('focus')); return false;
  }, t, { timeout: 20000, polling: 2000 }).catch(() => {});
  await waitLine('10:00〜11:00 時刻のある業務'); await p.waitForTimeout(500);
  let c = await items('cur'), n = await items('next');
  ok('1日の予定は、開始〜終了の時刻つきで入る', c.includes('10:00〜11:00 時刻のある業務'), c);
  ok('開始だけの予定は、開始の時刻だけ', c.includes('09:00 開始だけの業務'), c);
  ok('時刻のない予定は、名前だけ', c.includes('時刻のない業務'), c);
  ok('名前が時刻で始まる予定は、名前のまま', c.includes('9:30 朝礼'), c);
  ok('期間のある予定は、初日に「開始〜」', c.includes('13:00〜 期間のある業務'), c);
  ok('時刻の早い順に並ぶ', c.indexOf('09:00 開始だけの業務') < c.indexOf('10:00〜11:00 時刻のある業務') && c.indexOf('10:00〜11:00 時刻のある業務') < c.indexOf('13:00〜 期間のある業務'), c);
  ok('自分で書いた行は、そのまま', c.includes('自分で書いた行'), c);
  ok('次回出勤日の予定も、時刻つきで入る', n.includes('15:00〜16:00 次回の時刻の業務'), n);
  await p.waitForFunction(() => Array.from(document.querySelectorAll('.memo-single div[data-tr]')).some(d => d.textContent === '〜17:00 期間のある業務'), null, { timeout: 15000 }).catch(() => {});
  n = await items('next');
  ok('期間のある予定の転記は、次回出勤日の時刻（「〜終了」）になる', n.includes('〜17:00 期間のある業務[tr]') && n.filter(x => x.includes('期間のある業務')).length === 1, n);
  ok('1日の予定の転記は、当日の時刻を付けない（名前が時刻で始まる予定は、名前のまま）', n.includes('時刻のある業務[tr]') && !n.some(x => x.startsWith('10:00〜11:00')) && n.includes('9:30 朝礼[tr]'), n);
  // 開き直しても、増えない・変わらない
  await p.waitForTimeout(1500); await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(1500);
  const c2 = await items('cur'), n2 = await items('next');
  ok('開き直しても、同じ（増えない）', JSON.stringify(c2) === JSON.stringify(c) && n2.filter(x => x.includes('期間のある業務')).length === 1 && n2.filter(x => x.includes('次回の時刻の業務')).length === 1, [c, c2, n2]);
  // 予定の時刻を変えると、行の時刻も変わる（名前は、そのまま）
  await api('event_save', { id: A.id, kind: 'work', title: '時刻のある業務', tag: '個人作業', start: cur, end: cur, start_time: '14:00', end_time: '15:30' });
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await waitLine('14:00〜15:30 時刻のある業務');
  c = await items('cur');
  ok('予定の時刻を変えると、行の時刻も変わる', c.includes('14:00〜15:30 時刻のある業務') && c.filter(x => x.includes('時刻のある業務')).length === 1, c);
  // 日報で名前を書き足していても、時刻だけが変わる
  await p.evaluate(() => { const d = Array.from(document.querySelectorAll('.memo-single div[data-ev]')).find(d => d.textContent === '14:00〜15:30 時刻のある業務'); d.textContent = '14:00〜15:30 時刻のある業務（資料あり）'; document.querySelector('.memo-single').dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); });
  await api('event_save', { id: A.id, kind: 'work', title: '時刻のある業務', tag: '個人作業', start: cur, end: cur, start_time: '', end_time: '' });
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await waitLine('時刻のある業務（資料あり）');
  c = await items('cur');
  const srv = await p.evaluate(async ([id, cur]) => (await (await fetch('api.php?action=events&view=team&from=' + cur + '&to=' + cur)).json()).events.filter(e => e.id === id).map(e => [e.start_time, e.end_time, e.title]), [A.id, cur]);
  const dbg = await p.evaluate(() => { const ed = document.querySelector('.memo-single'), sel = getSelection(), a = sel.anchorNode; const line = Array.from(ed.querySelectorAll('div[data-ev]')).find(d => d.textContent.includes('資料あり')); return { focus: document.activeElement === ed, anchor: a ? (a.nodeType === 3 ? 'T:' + a.textContent : a.nodeName + '.' + (a.className || '') + ':' + (a.textContent || '').slice(0, 30)) : null, inLine: !!(line && a && line.contains(a)), html: line ? line.outerHTML : null, cur: ed.querySelector('div[data-md=cur]').getAttribute('data-date') }; });
  ok('予定の時刻を消すと、行の時刻も消える（書き足した文は残る）', c.includes('時刻のある業務（資料あり）') && !c.some(x => /^\d.*時刻のある業務/.test(x)), [dbg, srv, c]);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
