// 管理者の「家族の画面の確認」（v1.111.0）: 会社の管理で社員を選ぶ → 家族のアカウントで見たときの画面（確認用の帯つき）が開く。
// 家族に共有した予定だけが見え、家族が入れた予定・ひみつ・業務は出ない。変更はできない。「確認を終える」で、元の管理者の画面に戻る
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { sql } = require('../lib/env');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const pad = n => String(n).padStart(2, '0');
const n = new Date(); const today = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
(async () => {
  const b = await chromium.launch();
  const login = async (email, pass, vp) => {
    const p = await (await b.newContext({ viewport: vp || { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pass);
    await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p;
  };
  const post = (p, act, body) => p.evaluate(async ([act, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.status; }, [act, body]);
  const yam = await login('yamada@example.com', 'yamadapass1');
  // 持ち主（山田）の予定と、家族
  const api = (act, body) => yam.evaluate(async ([act, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [act, body]);
  await api('event_save', { kind: 'private', title: '家族への連絡', start: today, family_shared: true });
  await api('event_save', { kind: 'private', title: 'ひみつの予定', start: today, family_shared: false });
  await api('event_save', { kind: 'work', title: '会社の打ち合わせ', tag: '打ち合わせ', start: today });
  const fam = await api('family_add', { name: '山田 妻', email: 'wife@example.com', send_mail: false });
  const famId = sql("SELECT id FROM users WHERE email = 'wife@example.com'");
  sql(`INSERT INTO events (owner_id,title,kind,tag,start_date,end_date,start_time,end_time,note,family_shared,important,participants,detached,created_by,created_at,updated_at) VALUES (${famId}, '妻の予定', 'private', '', '${today}', '${today}', '', '', '', 1, 0, '', 0, ${famId}, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  ok('準備: 家族を招待できた', !!fam.password || !!fam.id || fam.ok !== false, fam);

  // 一般の社員は、確認用の表示を始められない
  ok('一般の社員は、家族の画面の確認を始められない（403）', await post(yam, 'family_preview_start', { owner_id: 2 }) === 403);

  // 管理者: 会社の管理 › 家族の画面の確認
  const adm = await login('admin@example.com', 'adminpass1');
  await adm.goto(BASE + 'index.php#admin'); await adm.waitForSelector('#set-famprev');
  ok('会社の管理に「家族の画面の確認」の項目がある', (await adm.locator('#set-famprev h3').innerText()).includes('家族の画面の確認'));
  await adm.selectOption('#preview-owner', { label: '山田 花子' });
  await Promise.all([adm.waitForURL(u => !u.href.includes('#admin')), adm.click('#preview-start')]);
  await adm.waitForSelector('.preview-bar'); await adm.waitForSelector('.cal');
  ok('確認用の帯が出て、「山田 花子さんの家族の画面」と分かる', (await adm.locator('.preview-bar').innerText()).includes('山田 花子さんの家族の画面') && (await adm.locator('.fam-pill').innerText()).includes('山田 花子さんの家族'));
  await adm.waitForSelector('.cal .bar:has-text("家族への連絡")');
  const text = await adm.locator('.cal').innerText();
  ok('家族に共有した予定は見える', text.includes('家族への連絡'));
  ok('ひみつの予定・業務の予定は、出ない', !text.includes('ひみつの予定') && !text.includes('会社の打ち合わせ'));
  ok('家族が入れた予定は、管理者には出ない（家族のプライバシー）', !text.includes('妻の予定'));
  ok('家族の画面と同じで、業務版・プライベート版の切り替えや、設定・会社の管理のボタンは出ない', await adm.locator('.tab').count() === 0 && await adm.locator('header button:has-text("設定")').count() === 0 && await adm.locator('.admin-btn').count() === 0);
  ok('変更はできない（API は 403。画面からの保存も通らない）', await post(adm, 'event_save', { kind: 'private', title: '管理者が入れた予定', start: today }) === 403 && sql("SELECT COUNT(*) FROM events WHERE title = '管理者が入れた予定'") === '0');
  ok('家族のアカウントが使えない操作は、確認用の表示でも使えない（403）', await adm.evaluate(async () => (await fetch('api.php?action=users_list')).status) === 403);
  await adm.click('.uname');
  ok('名前のメニューには「確認を終えて、元の画面に戻る」だけが出る（パスワード・ログアウトは出ない）', (await adm.locator('.menu-list button').allInnerTexts()).join(',') === '確認を終えて、元の画面に戻る');
  await adm.keyboard.press('Escape'); await adm.click('body', { position: { x: 5, y: 5 } });
  // 終える
  await adm.click('#preview-stop'); await adm.waitForSelector('#set-famprev');
  ok('「確認を終える」で、管理者の会社の管理の画面に戻る（帯は消える）', await adm.locator('.preview-bar').count() === 0 && (await adm.evaluate(() => location.hash)) === '#admin');
  ok('終えたあとは、管理者の操作ができる（予定を入れられる）', await post(adm, 'event_save', { kind: 'work', title: '管理者の予定', tag: '打ち合わせ', start: today }) === 200);

  // スマホ幅: 帯がはみ出さず、メニューが画面の中に収まる
  const ph = await login('admin@example.com', 'adminpass1', { width: 390, height: 844 });
  await ph.goto(BASE + 'index.php#admin'); await ph.waitForSelector('#set-famprev');
  await ph.click('#set-famprev > h3'); // スマホ幅では、項目は畳んである
  await ph.selectOption('#preview-owner', { label: '山田 花子' });
  await Promise.all([ph.waitForURL(u => !u.href.includes('#admin')), ph.click('#preview-start')]);
  await ph.waitForSelector('.preview-bar'); await ph.waitForSelector('.cal');
  ok('スマホ幅でも、ページが横にはみ出さない', await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await ph.evaluate(() => document.documentElement.scrollWidth + '/' + window.innerWidth));
  await ph.click('.fam-menu .uname'); const lb = await ph.locator('.fam-menu .menu-list').boundingBox();
  ok('スマホ幅でも、開いたメニューが画面の中に収まる', lb && lb.x >= 0 && lb.x + lb.width <= 390, lb);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
