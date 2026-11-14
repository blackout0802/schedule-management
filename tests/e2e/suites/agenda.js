// スマホの予定の一覧（v1.112.0）: スマホ幅では、カレンダーのすぐ下に、表示している期間の予定を「日付 時刻 誰｜予定」の1行ずつで並べる。
// 2日以上の予定は「11/12〜13」の1行。その日の中は、終日 → 時刻の早い順。月の表示で今日がその月にあるときは、今日より前の予定を畳む。
// 日付を押すと、一覧のその日の行に色が付く（ポップアップの代わり）。パソコンの幅では出さない。日付は今日から数える（どの日でも通る）
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOW = '日月火水木金土';
const mdw = d => `${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）`;
const t = new Date(); const today = ymd(t);
const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
// 2日続く予定: 今日と明日（今日が月末なら、昨日と今日）。どちらも、この月の中
const tripA = t.getDate() < last ? t : new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
const tripZ = new Date(tripA.getFullYear(), tripA.getMonth(), tripA.getDate() + 1);
const hasPast = t.getDate() > 1; // 月の1日でなければ、1日に「過去の予定」を入れる
const day1 = new Date(t.getFullYear(), t.getMonth(), 1);
(async () => {
  const b = await chromium.launch();
  const mk = async (opts) => { const c = await b.newContext(opts); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept()); return p; };
  const login = async (p, em, pw) => { await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); };
  const post = (p, act, body) => p.evaluate(async ([act, body]) => { const tk = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tk }, body: JSON.stringify(body) }); return r.json(); }, [act, body]);
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

  // 管理者の業務の予定（山田の「全社」の表示で、誰の予定かが出る）
  const ad = await mk({ viewport: { width: 1280, height: 900 } }); await login(ad, 'admin@example.com', 'adminpass1');
  await post(ad, 'event_save', { kind: 'work', title: '全社の朝礼', tag: '打ち合わせ', start: today, end: today, start_time: '09:00', end_time: '09:30' });
  ok('パソコンの幅では、予定の一覧は出ない', (await ad.locator('#agenda').count()) === 0);

  const y = await mk(phone); await login(y, 'yamada@example.com', 'yamadapass1');
  await post(y, 'event_save', { kind: 'private', title: 'マッサージ', start: today, end: today, start_time: '17:00', end_time: '17:30' });
  await post(y, 'event_save', { kind: 'private', title: 'ポケモン', start: today, end: today });
  await post(y, 'event_save', { kind: 'private', title: '家族旅行', start: ymd(tripA), end: ymd(tripZ), band: 'teal' });
  if (hasPast) await post(y, 'event_save', { kind: 'private', title: '歯医者', start: ymd(day1), end: ymd(day1), start_time: '19:00' });
  await post(y, 'event_save', { kind: 'work', title: '棚の整理', tag: '個人作業', start: today, end: today });
  await y.click('.tab[data-view=me]'); await y.waitForSelector('.view-banner.me', { state: 'attached' }); await y.waitForFunction(() => /ポケモン/.test(document.getElementById('agenda')?.textContent || '')); // 予定を読み込む前の一覧を見ないように、予定が出るまで待つ（CI で1回、空の一覧を見て落ちた）

  // ---- 月の表示（プライベート版）
  const rows = async () => y.locator('#agenda .ag-item').allInnerTexts();
  let r = await rows();
  const iP = r.findIndex(x => x.includes('ポケモン')), iM = r.findIndex(x => x.includes('マッサージ'));
  ok('スマホでは、カレンダーの下に「予定の一覧」が出る', (await y.locator('.cal-wrap + #agenda').count()) === 1);
  ok('1行が「日付 誰｜予定」（自分の予定は「自分」）', iP >= 0 && r[iP].includes(mdw(t)) && r[iP].includes('自分｜ポケモン'), r);
  ok('時刻のある予定は、時刻が付く', iM >= 0 && r[iM].includes('17:00') && r[iM].includes('自分｜マッサージ'), r);
  ok('同じ日の中は、終日 → 時刻の順', iP >= 0 && iM > iP, r);
  const trip = r.filter(x => x.includes('家族旅行'));
  ok('2日続く予定は、「月/日〜日」の1行にまとめる', trip.length === 1 && trip[0].includes(`${tripA.getMonth() + 1}/${tripA.getDate()}〜${tripZ.getDate()}`), trip);
  ok('プライベート版には、業務の予定（家族に共有していない）は出ない', !r.some(x => x.includes('棚の整理')), r);
  const dotTrip = await y.locator('#agenda .ag-item:has-text("家族旅行") .ag-dot').evaluate(e => getComputedStyle(e).backgroundColor);
  const dotPk = await y.locator('#agenda .ag-item:has-text("ポケモン") .ag-dot').evaluate(e => getComputedStyle(e).backgroundColor);
  ok('色の点は、帯の色（選んだ色はその色。標準は紫）', dotTrip !== dotPk && /rgb\(142, 53, 189\)/.test(dotPk), [dotTrip, dotPk]);
  if (hasPast) {
    ok('月の表示: 今日より前の予定は「過去の予定 N件」に畳む', !r.some(x => x.includes('歯医者')) && (await y.locator('#agenda .ag-past').innerText()).includes('過去の予定 1件'), r);
    await y.click('#agenda .ag-past');
    r = await rows(); ok('「過去の予定」を押すと開き、薄く出る', r.some(x => x.includes('歯医者') && x.includes('19:00')) && (await y.locator('#agenda .ag-item.past:has-text("歯医者")').count()) === 1, r);
    await y.click('#agenda .ag-past'); ok('もう一度押すと畳む', !(await rows()).some(x => x.includes('歯医者')));
  } else console.log('（今日は月の1日なので、過去の予定の確かめは省く）');
  ok('横にはみ出さない', await y.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  // ---- 日付を押す → その日の行に色（ポップアップは出ない）
  await y.locator('.cell[data-date="' + today + '"]').click({ position: { x: 20, y: 4 } }); await y.waitForSelector('#agenda .ag-selbar');
  const hl = (await y.locator('#agenda .ag-item.hl').allInnerTexts()).join(' / ');
  ok('日付を押すと、その日の予定（期間の予定も）に色が付き、ポップアップは出ない', hl.includes('ポケモン') && hl.includes('マッサージ') && hl.includes('家族旅行') && (await y.locator('.modal').count()) === 0, hl);
  await y.click('#agenda .ag-item:has-text("マッサージ")'); await y.waitForSelector('.modal input[name=title]');
  ok('一覧の行を押すと、その予定の編集画面', (await y.inputValue('.modal input[name=title]')) === 'マッサージ'); await y.click('.modal button:has-text("キャンセル")'); await y.waitForFunction(() => !document.querySelector('.modal'));
  ok('描き直しても、選んだ日はそのまま', (await y.locator('.cell.ag-sel[data-date="' + today + '"]').count()) === 1);
  if (hasPast) {
    await y.locator('.cell[data-date="' + ymd(day1) + '"]').click({ position: { x: 20, y: 4 } });
    await y.waitForFunction(() => /歯医者/.test([...document.querySelectorAll('#agenda .ag-item.hl')].map(x => x.textContent).join(' ')));
    ok('過去の日を押すと、畳んだ過去の予定も開いて、その日に色が付く', true);
  }

  // ---- 週の表示
  await y.click('.span-sw button:has-text("週")'); await y.waitForFunction(() => document.querySelector('#agenda .ag-range') && document.querySelectorAll('.cal .week').length === 1);
  const rg = await y.locator('#agenda .ag-range').innerText();
  ok('週の表示: 一覧の範囲は、その週の7日', /\d+\/\d+〜\d+\/\d+・\d+件/.test(rg), rg);
  r = await rows(); ok('週の表示でも、今日の予定が出る（過去は畳まない）', r.some(x => x.includes('ポケモン')) && (await y.locator('#agenda .ag-past').count()) === 0, r);
  await y.click('.span-sw button:has-text("月")'); await y.waitForSelector('#agenda');

  // ---- 業務版（全社）: ほかの人の予定は、その人の名前
  await y.click('.tab[data-view=team]'); await y.waitForSelector('.view-banner:not(.me)', { state: 'attached' }); await y.waitForFunction(() => /棚の整理/.test(document.getElementById('agenda')?.textContent || ''));
  r = await rows(); ok('業務版（自分）: 自分の業務の予定が出て、ほかの人の予定は出ない', r.some(x => x.includes('自分｜棚の整理')) && !r.some(x => x.includes('全社の朝礼')), r);
  await y.selectOption('#who-sel', 'all'); await y.waitForFunction(() => /全社の朝礼/.test(document.getElementById('agenda')?.textContent || ''));
  r = await rows();
  ok('業務版（全社）: ほかの人の予定は「姓｜予定」、自分の予定は「自分」', r.some(x => x.includes('管理者｜全社の朝礼') && x.includes('09:00')) && r.some(x => x.includes('自分｜棚の整理')), r);
  ok('業務版でも、一覧はカレンダーのすぐ下（月のまとめより上）', await y.evaluate(() => { const a = document.getElementById('agenda'), m = document.querySelector('.month-sum'); return !!a && (!m || !!(a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)); }));
  ok('リスト（ToDo）の表示では、一覧は出ない', await (async () => { await y.click('.seg label:has-text("リスト")'); await y.waitForTimeout(300); const n = await y.locator('#agenda').count(); await y.click('.seg label:has-text("カレンダー")'); await y.waitForSelector('#agenda'); return n === 0; })());

  // ---- 家族用リンク（ダーク）
  await y.click('.tab[data-view=me]'); await y.waitForSelector('.view-banner.me', { state: 'attached' });
  await post(y, 'event_save', { kind: 'private', title: '家族で外食', start: today, end: today, start_time: '19:00', family_shared: 1 });
  const sh = await post(y, 'share_create', { kind: 'family' });
  const g = await mk(Object.assign({ colorScheme: 'dark' }, phone)); await g.goto(BASE + sh.path); await g.waitForFunction(() => /家族で外食/.test(document.getElementById('agenda')?.textContent || ''));
  const gr = await g.locator('#agenda .ag-item').allInnerTexts();
  ok('家族用リンク: 一覧が出る（家族に共有した予定）', gr.some(x => x.includes('家族で外食') && x.includes('19:00')), gr);
  await g.locator('.cell[data-date="' + today + '"]').click({ position: { x: 20, y: 4 } }); await g.waitForSelector('#agenda .ag-selbar');
  ok('家族用リンク: 日付を押しても「予定を追加」は出ない', !(await g.locator('#agenda').innerText()).includes('予定を追加'));
  const bgc = await g.locator('#agenda').evaluate(e => getComputedStyle(e).backgroundColor);
  ok('ダークモードでは、一覧も暗い背景', /rgb\(22, 32, 51\)/.test(bgc), bgc);
  ok('家族用リンク: 横にはみ出さない', await g.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await g.screenshot({ path: 'agenda-share-dark.png', fullPage: true });
  await y.screenshot({ path: 'agenda-me.png', fullPage: true });

  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
