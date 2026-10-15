// 会議室の予約: ページ（カレンダーと同じ作り）を開く・日付を押して予約する・決まり（休業日・定員・二重予約・先の月）・部屋の色の見分け・非公開・取り消しと元に戻す・管理者の設定・Slack通知・スマホ幅
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const env = require('../lib/env');
const BASE = env.BASE; const LOG = env.SLACK_LOG;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const log = () => { try { return fs.readFileSync(LOG, 'utf8'); } catch (e) { return ''; } };
async function login(b, email, pw, vp) {
  const p = await (await b.newContext({ viewport: vp || { width: 1280, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  return p;
}
const api = (p, a, body) => p.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
const get = (p, qs) => p.evaluate(async qs => (await fetch('api.php?action=' + qs)).json(), qs);

(async () => {
  fs.writeFileSync(LOG, '');
  const b = await chromium.launch();
  const y = await login(b, 'yamada@example.com', 'yamadapass1');
  const today = new Date();
  // 予約できる日（休業日でない日）を、先の日から4つ。休業日（土日）を1つ
  const r0 = await get(y, 'rooms_list&from=' + ymd(today) + '&to=' + ymd(new Date(today.getTime() + 30 * 864e5)));
  const open = []; for (let i = 3; i < 30 && open.length < 4; i++) { const s = ymd(new Date(today.getTime() + i * 864e5)); if (!(s in r0.closed)) open.push(s); }
  const closedDay = Object.keys(r0.closed).filter(d => d > ymd(today))[0];
  ok('準備: 予約できる日が4つ・休業日が1つ見つかる', open.length === 4 && !!closedDay, [open, closedDay]);
  const showMonth = async (p, date) => { // 画面の月を、その日の月にする
    for (let i = 0; i < 14; i++) { const t = await p.locator('.toolbar h2').innerText(); if (t === date.slice(0, 4) + '年' + (+date.slice(5, 7)) + '月') return true; const cur = +t.slice(0, 4) * 12 + (+t.slice(5, t.indexOf('月'))); const want = +date.slice(0, 4) * 12 + (+date.slice(5, 7)); await p.click(cur < want ? '.toolbar button[aria-label="次の月"]' : '.toolbar button[aria-label="前の月"]'); await p.waitForTimeout(500); }
    return false;
  };
  const bar = (p, t) => p.locator('.bar.rm:has-text("' + t + '")');

  // ---- ページを開く
  const segTxt0 = await y.locator('.seg').first().innerText();
  ok('業務版の切り替えは、「カレンダー／会議室予約／リスト」。「休み表」はなくなり、右上の会議室ボタンもない', segTxt0.includes('会議室予約') && !segTxt0.includes('休み表') && (await y.locator('.rooms-btn').count()) === 0 && (await y.locator('header button[aria-label="会議室の予約"]').count()) === 0, segTxt0);
  await y.click('.seg label:has-text("会議室予約")'); await y.waitForSelector('.cal .week'); await y.waitForSelector('#rooms-body .month-sum');
  ok('「会議室予約」で、会議室のページが開く（URL は #rooms）。上の帯はカレンダーと同じで、「会議室予約」が選ばれている', (await y.url()).endsWith('#rooms') && (await y.locator('.seg label:has(input:checked)').innerText()).includes('会議室予約') && (await y.locator('.tabs .tab').count()) === 2 && (await y.locator('.brand .ver').count()) === 1);
  ok('カレンダーと同じ作り: 月の移動（‹ ›・今日）・曜日の行・日付のマス', (await y.locator('.toolbar h2').innerText()).includes('年') && (await y.locator('.toolbar > button').count()) === 3 && (await y.locator('.cal-dow .dow').count()) === 7 && (await y.locator('.cal .week .cell').count()) >= 28);
  ok('会議室のページに、「大・応で分ける」「まとめて」の切り替えと、「＋ 会議室を予約」ボタンは、ない。切り替えは「カレンダー／会議室予約／リスト」の3つ', (await y.locator('.rm-seg').count()) === 0 && (await y.locator('button:has-text("会議室を予約")').count()) === 0 && (await y.locator('.seg label').count()) === 3);
  const legTxt = await y.locator('.legend').innerText();
  ok('凡例に、会議室（6名）・応接室（3名）が出る。設備は出ない', legTxt.includes('会議室（6名）') && legTxt.includes('応接室（3名）') && !legTxt.includes('プロジェクター') && !legTxt.includes('モニター'), legTxt);
  ok('部屋の色: 会議室は青（色番号0）・応接室はオレンジ（色番号1）', (await y.locator('.legend .rm-s0').count()) === 1 && (await y.locator('.legend .rm-s1').count()) === 1);
  ok('今月の予約がまだ無いときは、下のまとめに案内が出る', (await y.locator('.month-sum').innerText()).includes('予約はありません'));

  // ---- 予約する（応接室）
  const book = async (p, o) => { // 月を合わせて、日付のマスを押して、予約の画面を埋める
    await showMonth(p, o.date); await p.click('.cell[data-date="' + o.date + '"]'); await p.waitForSelector('.modal input[name=title]');
    await p.fill('input[name=title]', o.title); await p.fill('input[name=date]', o.date);
    await p.click('.rm-pick:has-text("' + o.room + '")'); await p.selectOption('select[name=start]', o.start || '09:00'); await p.selectOption('select[name=end]', o.end || '11:00');
    if (o.kind) await p.selectOption('select[name=kind]', o.kind); await p.fill('input[name=pax]', String(o.pax || 3)); if (o.priv) await p.check('input[name=private]');
  };
  await book(y, { title: 'e2e 定例会議', date: open[0], room: '応接室', kind: 'committee', pax: 3 });
  ok('予約の画面に、「空いています」と出て、予約できる', (await y.locator('.rm-msg').innerText()).includes('空いています') && !(await y.locator('.modal button[type=submit]').isDisabled()));
  await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal'));
  await showMonth(y, open[0]); await y.waitForSelector('.bar.rm:has-text("e2e 定例会議")');
  const bb = bar(y, 'e2e 定例会議'), rowT = y.locator('.rm-table tr:has-text("e2e 定例会議")');
  ok('予約したものが、カレンダーに、応接室の色（番号1）・頭に「応」のバッジ・時間つきの帯で出る', (await bb.getAttribute('class')).includes('rm-s1') && (await bb.first().evaluate(e => getComputedStyle(e, '::before').content)) === '"応"' && (await bb.innerText()).includes('09:00-11:00') && (await bb.getAttribute('title')).includes('応接室'), await bb.getAttribute('class'));
  ok('その日のマスに、帯が出る（押したマスの日付と同じ列）', (await y.locator('.cal .week:has(.cell[data-date="' + open[0] + '"]) .bar.rm').count()) === 1);
  ok('下のまとめの表にも、日付・時間・部屋（色つき）・用件・区分・予約した人・人数が出る', (await rowT.count()) === 1 && (await rowT.innerText()).includes('応接室') && (await rowT.innerText()).includes('09:00–11:00') && (await rowT.innerText()).includes('委員会') && (await rowT.innerText()).includes('山田 花子（自分）') && (await rowT.innerText()).includes('3名') && (await rowT.getAttribute('class')).includes('rm-s1'), await rowT.innerText());
  ok('まとめの見出しに、この月の件数と、部屋ごとの件数・合計時間が出る', (await y.locator('.month-sum h3').innerText()).includes('1件') && (await y.locator('.month-sum h3').innerText()).includes('応接室 1件（計 2時間）'), await y.locator('.month-sum h3').innerText());
  // 休業日のマスを押すと、予約の画面は開かず、理由が出る
  await showMonth(y, closedDay); await y.click('.cell[data-date="' + closedDay + '"]', { position: { x: 8, y: 8 } }); await y.waitForSelector('.toast');
  ok('休業日のマスを押すと、予約の画面は開かず、休業日だと知らせる', (await y.locator('.toast').last().innerText()).includes('休業日') && (await y.locator('.modal').count()) === 0);
  await showMonth(y, open[0]);

  // ---- 決まり: 画面での確認
  await showMonth(y, open[0]); await y.click('.cell[data-date="' + open[0] + '"]', { position: { x: 8, y: 8 } }); await y.waitForSelector('.modal input[name=title]');
  ok('マスを押すと、押した日が入った予約の画面が開く', (await y.inputValue('input[name=date]')) === open[0]);
  await y.fill('input[name=title]', '確認'); await y.fill('input[name=pax]', '3');
  await y.fill('input[name=date]', closedDay); await y.waitForTimeout(500);
  ok('休業日は、予約できないと出て、予約ボタンが押せない', (await y.locator('.rm-msg').innerText()).includes('休業日') && await y.locator('.modal button[type=submit]').isDisabled(), await y.locator('.rm-msg').innerText());
  await y.fill('input[name=date]', open[0]); await y.click('.rm-pick:has-text("応接室")'); await y.fill('input[name=pax]', '4'); await y.waitForTimeout(300);
  ok('応接室に4名は、定員（3名）を超えると出る', (await y.locator('.rm-msg').innerText()).includes('定員は3名'), await y.locator('.rm-msg').innerText());
  await y.fill('input[name=pax]', '3'); await y.selectOption('select[name=start]', '10:00'); await y.selectOption('select[name=end]', '12:00'); await y.waitForTimeout(300);
  const dupMsg = await y.locator('.rm-msg').innerText();
  ok('同じ部屋・重なる時間は、「予約が入っています」と、先の予約の用件・予約した人が出る', dupMsg.includes('「e2e 定例会議」') && dupMsg.includes('山田 花子') && await y.locator('.modal button[type=submit]').isDisabled(), dupMsg);
  ok('二重予約の案内の部屋の枠に、「使用中」と出る（もう一方は「空き」）', (await y.locator('.rm-pick:has-text("応接室") .rs').innerText()) === '使用中' && (await y.locator('.rm-pick:has-text("会議室") .rs').innerText()) === '空き');
  await y.click('.rm-pick:has-text("会議室")'); await y.waitForTimeout(300);
  ok('別の部屋（会議室）なら、同じ時間でも予約できる', (await y.locator('.rm-msg').innerText()).includes('空いています') && !(await y.locator('.modal button[type=submit]').isDisabled()));
  await y.fill('input[name=pax]', '2'); await y.waitForTimeout(300);
  await y.click('.rm-quick button:has-text("午後")'); ok('「午後」で、13:00〜18:00 になる', (await y.inputValue('select[name=start]')) === '13:00' && (await y.inputValue('select[name=end]')) === '18:00');
  // 先の月（3か月より先）
  const far = await y.evaluate(async () => { const f = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); for (let i = 130; i < 160; i++) { const d = new Date(Date.now() + i * 864e5), s = f(d); if (d.getDay() === 0 || d.getDay() === 6) continue; const j = await (await fetch('api.php?action=rooms_list&from=' + s + '&to=' + s)).json(); if (!(s in j.closed)) return s; } return ''; });
  await y.fill('input[name=date]', far); await y.waitForTimeout(600);
  ok('3か月より先の日は、予約できないと出る', (await y.locator('.rm-msg').innerText()).includes('3か月先') && await y.locator('.modal button[type=submit]').isDisabled(), await y.locator('.rm-msg').innerText());
  await y.keyboard.press('Escape'); await y.waitForFunction(() => !document.querySelector('.modal'));

  // ---- サーバー側の確認（画面を通さない）
  const r1 = await get(y, 'rooms_list&from=' + open[0] + '&to=' + open[0]); const small = r1.rooms.find(r => r.name === '応接室'), big = r1.rooms.find(r => r.name === '会議室');
  const bad = async o => (await api(y, 'room_booking_save', Object.assign({ room_id: small.id, date: open[0], start: '13:00', end: '14:00', title: 'x', kind: 'meeting', pax: 2 }, o))).error || '';
  ok('サーバーも: 土日・営業時間の外・定員超え・二重予約・先の月・区分なしは断る', [closedDay, 'x'].length && (await bad({ date: closedDay })).includes('休業日') && (await bad({ start: '08:00', end: '09:00' })).includes('9:00〜18:00') && (await bad({ pax: 4 })).includes('定員') && (await bad({ start: '10:00', end: '10:30' })).includes('e2e 定例会議') && (await bad({ date: far })).includes('3か月先') && (await bad({ kind: 'zz' })).includes('区分') && (await bad({ pax: '' })).includes('人数'));
  ok('サーバーも: 30分刻みでない時間・過去の日付は断る', (await bad({ start: '13:10' })).includes('30分刻み') && (await bad({ date: ymd(new Date(Date.now() - 864e5)) })).includes('過去'));

  // ---- 非公開の予約
  await book(y, { title: '人事面談（秘密）', date: open[1], room: '会議室', start: '14:00', end: '15:00', kind: 'other', pax: 2, priv: true });
  await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal')); await showMonth(y, open[1]); await y.waitForSelector('.bar.rm:has-text("人事面談")');
  ok('本人には、非公開の予約の用件が見え、「非公開」の印が付く', (await y.locator('.rm-table tr:has-text("人事面談")').innerText()).includes('非公開') && (await bar(y, '人事面談').getAttribute('title')).includes('非公開'));
  const s = await login(b, 'suzuki@example.com', 'suzukipass1'); await s.click('.seg label:has-text("会議室予約")'); await s.waitForSelector('.cal .week'); await showMonth(s, open[1]); await s.waitForSelector('.bar.rm');
  const sTxt = await s.locator('#rooms-body').innerText();
  ok('他の人には、非公開の予約は「予約済」とだけ見える（用件・予約した人・人数は出ない）', sTxt.includes('予約済') && !sTxt.includes('人事面談') && (await s.locator('.rm-table tr:has-text("予約済")').innerText()).includes('会議室') && !(await s.locator('.rm-table tr:has-text("予約済")').innerText()).includes('山田'), sTxt);
  await bar(s, '予約済').click(); await s.waitForSelector('.modal .rm-view');
  ok('非公開の予約を開いても、中身は見えず、変更もできない', !(await s.locator('.modal').innerText()).includes('人事面談') && (await s.locator('.modal').innerText()).includes('非公開の予約です') && (await s.locator('.modal input[name=title]').count()) === 0);
  await s.keyboard.press('Escape'); await s.waitForFunction(() => !document.querySelector('.modal'));
  await showMonth(s, open[0]); await s.waitForSelector('.bar.rm:has-text("e2e 定例会議")'); await bar(s, 'e2e 定例会議').click(); await s.waitForSelector('.modal .rm-view');
  ok('他の人の（公開の）予約は、内容は見えるが、変更・取り消しはできない', (await s.locator('.modal').innerText()).includes('予約した人') && (await s.locator('.modal').innerText()).includes('予約した本人と管理者だけ') && (await s.locator('.modal button:has-text("取り消す")').count()) === 0);
  await s.keyboard.press('Escape');
  const ids = (await get(s, 'rooms_list&from=' + open[0] + '&to=' + open[1])).bookings; const mine = ids.find(x => x.title === 'e2e 定例会議'), sec = ids.find(x => x.masked);
  ok('サーバーも: 他の人は、変更・取り消しできない。非公開の予約の中身は、一覧にも含まれない', (await api(s, 'room_booking_save', { id: mine.id, room_id: small.id, date: open[0], start: '09:00', end: '10:00', title: 'のっとり', kind: 'meeting', pax: 2 })).error.includes('本人と管理者') && (await api(s, 'room_booking_delete', { id: mine.id })).error.includes('本人と管理者') && sec.title === '予約済' && sec.owner_name === '' && sec.pax === null && JSON.stringify(ids).indexOf('人事面談') < 0);
  const sbad = await api(s, 'room_booking_save', { room_id: big.id, date: open[1], start: '14:30', end: '15:30', title: 'y', kind: 'meeting', pax: 2 });
  ok('サーバーも: 非公開の予約と重なったとき、断る案内にも、件名・予約した人は出ない', !!sbad.error && !sbad.error.includes('人事面談') && !sbad.error.includes('山田') && sbad.error.includes('14:00〜15:00'), sbad);

  // ---- 取り消しと「元に戻す」
  await showMonth(y, open[0]); await bar(y, 'e2e 定例会議').click(); await y.waitForSelector('.modal input[name=title]');
  ok('自分の予約は、開くと変更できる（取り消しボタンもある）', (await y.inputValue('input[name=title]')) === 'e2e 定例会議' && (await y.locator('.modal button:has-text("予約を取り消す")').count()) === 1);
  await y.fill('input[name=title]', 'e2e 定例会議（変更後）'); await y.selectOption('select[name=end]', '12:00'); await y.click('.modal button[type=submit]'); await y.waitForFunction(() => !document.querySelector('.modal'));
  await y.waitForSelector('.bar.rm:has-text("変更後")');
  ok('予約を変更すると、カレンダーの帯に反映される', (await bar(y, '変更後').innerText()).includes('09:00-12:00'));
  await bar(y, '変更後').click(); await y.waitForSelector('.modal button:has-text("予約を取り消す")'); await y.click('.modal button:has-text("予約を取り消す")');
  await y.waitForSelector('.toast .toast-act'); await y.waitForFunction(() => !Array.from(document.querySelectorAll('.bar.rm')).some(r => r.textContent.includes('変更後')));
  ok('取り消すと、確認なしで消え、「元に戻す」が出る', (await y.locator('.toast.with-action').innerText()).includes('予約を取り消しました'));
  await y.click('.toast .toast-act'); await y.waitForSelector('.bar.rm:has-text("変更後")');
  ok('「元に戻す」で、予約が戻る', true);

  // ---- 管理者
  const a = await login(b, 'admin@example.com', 'adminpass1');
  ok('管理者は、休業日・営業時間の外にも予約できる（サーバー）', !!(await api(a, 'room_booking_save', { room_id: big.id, date: closedDay, start: '08:00', end: '09:30', title: '管理者の臨時', kind: 'other', pax: 2 })).booking);
  await a.click('header button:has-text("設定")'); await a.waitForSelector('#set-rooms .rm-adm-row');
  ok('設定のページに、「会議室の設定」（管理者のみ）が出る。部屋が2つ並ぶ', (await a.locator('#set-rooms .rm-adm-row').count()) >= 3 && (await a.locator('#set-rooms').innerText()).includes('予約の決まり'));
  ok('管理者でない人には、会議室の設定が出ない', await (async () => { await y.goto(BASE + 'index.php#settings'); await y.waitForSelector('.settings-page'); return (await y.locator('#set-rooms').count()) === 0; })());
  const row2 = a.locator('#set-rooms .rm-adm-row').nth(1); await row2.locator('input[type=number]').fill('5'); await row2.locator('button[type=submit]').click(); await a.waitForSelector('.toast');
  const r2 = await get(a, 'rooms_list&from=' + open[0] + '&to=' + open[0]);
  ok('部屋の定員を変えると、保存される（予約の人数の検査にも使われる）', r2.rooms.find(r => r.name === '応接室').capacity === 5 && !(await api(y, 'room_booking_save', { room_id: small.id, date: open[2], start: '09:00', end: '10:00', title: '5名の会議', kind: 'meeting', pax: 5 })).error);
  await a.waitForSelector('#set-rooms .rm-adm-row'); const row3 = a.locator('#set-rooms .rm-adm-row').nth(1); await row3.locator('input[type=number]').fill('3'); await row3.locator('button[type=submit]').click(); await a.waitForTimeout(700);
  const cfg0 = (await get(a, 'rooms_list&from=' + open[0] + '&to=' + open[0])).cfg;
  ok('予約の決まりの初期値: 3か月先・9:00〜18:00・前日17:00と当日8:30に通知', cfg0.advance_months === 3 && cfg0.open === '09:00' && cfg0.close === '18:00' && cfg0.notify_prev.time === '17:00' && cfg0.notify_today.time === '08:30', cfg0);
  const cf = await api(a, 'rooms_cfg_save', Object.assign({}, cfg0, { advance_months: 6, open: '08:30' }));
  ok('決まりを保存できる（先の月数・使える時間）。おかしな値は保存できない', cf.cfg.advance_months === 6 && cf.cfg.open === '08:30' && !!(await api(a, 'rooms_cfg_save', Object.assign({}, cfg0, { open: '09:10' }))).error && !!(await api(y, 'rooms_cfg_save', cfg0)).error);
  await api(a, 'rooms_cfg_save', cfg0);
  const hist = await get(a, 'audit_list&type=room');
  const hText = JSON.stringify(hist.entries);
  ok('変更履歴に、予約の追加・変更・取り消しが残る。非公開の予約は、件名が残らない', hist.entries.length >= 4 && hText.includes('e2e 定例会議') && hText.includes('非公開の予約') && hText.indexOf('人事面談') < 0, hText.slice(0, 300));

  // ---- Slack: 前日の夕方の通知（今の時刻の5分前を、通知の時刻にして、cron を動かす）
  const tom = ymd(new Date(Date.now() + 864e5));
  await api(a, 'room_booking_save', { room_id: big.id, date: tom, start: '10:00', end: '11:00', title: 'あした公開の会議', kind: 'meeting', pax: 3 });
  await api(a, 'room_booking_save', { room_id: small.id, date: tom, start: '13:00', end: '14:00', title: 'あした非公開の話', kind: 'other', pax: 2, private: true });
  const nm = Math.max(0, new Date().getHours() * 60 + new Date().getMinutes() - 5), tm = pad(Math.floor(nm / 60)) + ':' + pad(nm % 60);
  await api(a, 'rooms_cfg_save', Object.assign({}, cfg0, { notify_prev: { on: true, time: tm }, notify_today: { on: false, time: '08:30' } }));
  fs.writeFileSync(LOG, '');
  const cron = () => execFileSync('php', [env.APP + '/bin/cron.php', 'notify'], { env: process.env, encoding: 'utf8' });
  const o1 = cron(); const l1 = log();
  ok('cron の notify で、前日の予約が、1通にまとまって Slack に届く', /会議室の予約（明日）: \d+ 件/.test(o1) && l1.includes('【明日の会議室】') && l1.includes('あした公開の会議') && l1.includes('会議室'), [o1, l1.slice(0, 300)]);
  ok('非公開の予約は、Slack の通知にも、件名が出ない（予約済（非公開））', l1.includes('予約済（非公開）') && !l1.includes('あした非公開の話'));
  cron(); ok('同じ通知は、2回は送らない', (log().match(/【明日の会議室】/g) || []).length === 1);

  // ---- スマホ幅
  const m = await login(b, 'yamada@example.com', 'yamadapass1', { width: 390, height: 844 });
  await m.goto(BASE + 'index.php#rooms'); await m.waitForSelector('.cal .week'); await m.waitForSelector('#rooms-body .month-sum');
  ok('スマホ幅でも、会議室のページが横にはみ出さない（上の帯も、カレンダーと同じ高さに収まる）', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
  await showMonth(m, open[0]); await m.click('.cell[data-date="' + open[0] + '"]', { position: { x: 8, y: 8 } }); await m.waitForSelector('.modal input[name=title]');
  ok('スマホ幅の予約の画面も、横にはみ出さず、部屋の選択が見える', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && (await m.locator('.rm-pick').count()) === 2);
  await m.keyboard.press('Escape');

  // ---- カレンダーに戻る（切り替えの「カレンダー」か、上の「業務版」）
  await y.goto(BASE + 'index.php#rooms'); await y.waitForSelector('.cal .week'); await y.click('.seg label:has-text("カレンダー")'); await y.waitForSelector('#who-sel');
  ok('切り替えの「カレンダー」を押すと、カレンダーに戻る（会議室のページではなくなる）', !(await y.url()).includes('#rooms') && (await y.locator('.rm-table').count()) === 0 && (await y.locator('.seg label:has(input:checked)').innerText()).includes('カレンダー'));
  await y.click('.seg label:has-text("会議室予約")'); await y.waitForSelector('#rooms-body .month-sum'); await y.click('.tabs .tab[data-view=team]'); await y.waitForSelector('#who-sel');
  ok('上の「業務版」を押しても、カレンダーに戻る', !(await y.url()).includes('#rooms') && (await y.locator('.rm-table').count()) === 0);
  await y.click('.seg label:has-text("会議室予約")'); await y.waitForSelector('#rooms-body .month-sum'); await y.keyboard.press('c'); await y.waitForSelector('#who-sel');
  ok('キーの c でも、カレンダーに戻る', !(await y.url()).includes('#rooms'));
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
