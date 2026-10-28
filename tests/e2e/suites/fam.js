// 家族のアカウント: 持ち主が招待 → 家族がログインして、プライベートのカレンダーを見る・自分の予定を書く／見えない・できないこと
const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
const pad = n => String(n).padStart(2, '0');
(async () => {
  const b = await chromium.launch();
  const mk = async (vp) => { const c = await b.newContext({ viewport: vp || { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept()); return p; };
  const login = async (p, em, pw) => { await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw); await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); };
  const api = (p, action, body) => p.evaluate(async ([action, body]) => { const t = document.getElementById('app')?.dataset.csrf; const r = await fetch('api.php?action=' + action, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) { } return { status: r.status, j }; }, [action, body]);
  const n = new Date(); const today = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;

  // ---- 持ち主（山田）が、家族を招待する
  const y = await mk(); await login(y, 'yamada@example.com', 'yamadapass1'); await y.waitForSelector('.cal');
  await y.click('.tab[data-view=me]'); await y.waitForSelector('.view-banner.me');
  await api(y, 'event_save', { kind: 'private', title: '家族への連絡', start: today, family_shared: true });
  await api(y, 'event_save', { kind: 'private', title: 'ひみつの予定', start: today, family_shared: false });
  await api(y, 'event_save', { kind: 'work', title: '会社の打ち合わせ', tag: '打ち合わせ', start: today });
  await y.click('header button:has-text("設定")'); await y.waitForSelector('.settings-page');
  ok('設定のページに「家族の招待」の項目がある（一般の社員）', (await y.locator('#set-family').count()) === 1);
  await y.waitForSelector('#set-family input[name=fam_name]');
  await y.fill('#set-family input[name=fam_name]', '山田 妻'); await y.fill('#set-family input[name=fam_email]', 'wife@example.com'); await y.click('#set-family button:has-text("招待する")');
  await y.waitForSelector('.fam-pw');
  const pw1 = (await y.locator('.fam-pw').innerText()).trim();
  ok('招待すると、一時パスワードが1度だけ表示される', pw1.length >= 8 && (await y.locator('.modal').innerText()).includes('wife@example.com'), pw1);
  ok('招待のダイアログに、「メールでも送りました」と出る', (await y.locator('.modal').innerText()).includes('メールでも送りました'), await y.locator('.modal').innerText());
  const mailLog = () => require('fs').readFileSync(process.env.E2E_MAIL_LOG, 'utf8');
  ok('招待メールが送られる（宛先・ログインのページ・メールアドレス・一時パスワード）', mailLog().includes('To: wife@example.com') && mailLog().includes('https://example.com/schedule/login.php') && mailLog().includes('一時パスワード: ' + pw1), mailLog());
  await y.click('.modal button:has-text("閉じる")'); await y.waitForFunction(() => !document.querySelector('.fam-pw'));
  const before = mailLog();
  const noMail = await api(y, 'family_add', { name: 'メールなし', email: 'nomail@example.com' });
  ok('メールを送らない招待（送るチェックなし）では、メールは出ない', noMail.j.mail === 'skipped' && mailLog() === before);
  await y.reload(); await y.waitForSelector('.cal, .settings-page'); if (!(await y.locator('.settings-page').count())) await y.click('header button:has-text("設定")'); await y.waitForSelector('#set-family input[name=fam_name]');
  ok('招待のフォームに「招待メールも送る」があり、初めはオン', await y.locator('#set-family input[name=fam_send_mail]').isChecked());
  await y.uncheck('#set-family input[name=fam_send_mail]'); await y.fill('#set-family input[name=fam_name]', '山田 次男'); await y.fill('#set-family input[name=fam_email]', 'jiro@example.com'); await y.click('#set-family button:has-text("招待する")'); await y.waitForSelector('.fam-pw');
  ok('チェックを外して招待すると、メールは出ず、「メールでも送りました」とも出ない', !(await y.locator('.modal').innerText()).includes('メールでも送りました') && mailLog() === before && !mailLog().includes('jiro@example.com'));
  await y.click('.modal button:has-text("閉じる")'); await y.waitForFunction(() => !document.querySelector('.fam-pw'));
  for (const m of (await api(y, 'family_list')).j.members.filter(m => m.email !== 'wife@example.com')) await api(y, 'family_delete', { id: m.id }); // この確認のために招待した人は、消しておく（あとの確認に影響しないように）
  await y.reload(); await y.waitForSelector('.cal, .settings-page'); if (!(await y.locator('.settings-page').count())) await y.click('header button:has-text("設定")'); await y.waitForSelector('#set-family .fam-member');
  ok('家族の一覧に出る（招待中）', (await y.locator('#set-family .fam-member').innerText()).includes('山田 妻') && (await y.locator('#set-family .fam-member').innerText()).includes('招待中'));
  ok('同じメールアドレスでは招待できない', (await api(y, 'family_add', { name: '別人', email: 'wife@example.com' })).status === 400);

  // ---- 家族がログインする（最初に、パスワードの変更）
  const f = await mk(); await login(f, 'wife@example.com', pw1);
  await f.waitForSelector('.modal');
  ok('最初のログインで、パスワードの変更を求められる（家族向けの文言）', (await f.locator('.modal').innerText()).includes('招待されたときの一時パスワード'));
  await f.fill('.modal input[autocomplete=current-password]', pw1); await f.fill('.modal input[autocomplete=new-password]', 'familypass99'); await f.click('.modal button[type=submit]');
  await f.waitForSelector('.cal'); await f.waitForSelector('.bar');
  const top = await f.evaluate(() => ({ tabs: document.querySelectorAll('.tabs .tab').length, pill: (document.querySelector('.fam-pill') || {}).innerText, setBtn: [...document.querySelectorAll('header button')].some(b => b.getAttribute('aria-label') === '設定' || b.textContent.trim() === '設定'), seg: document.querySelectorAll('.seg input[name=mode]').length, hover: !!document.getElementById('todo-hover'), side: !!document.querySelector('.side'), who: !!document.getElementById('who-sel') }));
  ok('家族の画面: 業務版・プライベート版のタブ、設定、ToDo、表示の切り替え、表示する人は出ない', top.tabs === 0 && !top.setBtn && top.seg === 0 && !top.hover && !top.side && !top.who, top);
  ok('家族の画面: 「○○さんの家族」の印と説明が出る', top.pill.includes('山田') && (await f.locator('.view-banner').innerText()).includes('家族のカレンダー'), top.pill);
  const names = await f.locator('.bar').allInnerTexts();
  ok('家族に見えるのは、共有された予定だけ（共有しない予定・業務は見えない）。持ち主の予定には、プライベート版の名前（決めていなければ下の名前）が付く', names.some(t => t.includes('家族への連絡') && t.includes('花子')) && !names.some(t => t.includes('ひみつ') || t.includes('会社の打ち合わせ')), names);
  // 家族が、自分の予定を入れる
  await f.keyboard.press('n'); await f.waitForSelector('.modal input[name=title]');
  const dlg = await f.evaluate(() => ({ kind: document.querySelectorAll('.modal input[name=kind]').length, todo: !!document.querySelector('.modal select[name=todo_status]') && !document.querySelector('.modal select[name=todo_status]').closest('label').hidden, fam: !!document.querySelector('.modal input[name=family_shared]') && !document.querySelector('.modal input[name=family_shared]').closest('label').hidden, owner: !document.querySelector('.modal select[name=owner_id]').closest('label').hidden }));
  ok('家族の予定の入力画面に、種類・ToDo・家族への共有・持ち主の欄は出ない', !dlg.kind && !dlg.todo && !dlg.fam && !dlg.owner, dlg);
  await f.fill('.modal input[name=title]', '妻の買い物'); await f.click('.modal button[type=submit]'); await f.waitForSelector('.bar:has-text("妻の買い物")');
  ok('家族が、自分の予定を入れられる', (await f.locator('.bar:has-text("妻の買い物")').count()) >= 1);
  const saved = await api(f, 'events&from=' + today + '&to=' + today + '&view=team');
  const mine = (saved.j.events || []).find(e => e.title === '妻の買い物');
  ok('家族の予定は、いつも、プライベート・家族に共有（業務版を指定しても、プライベート版の見え方）', mine && mine.kind === 'private' && mine.family_shared === true && !(saved.j.events || []).some(e => e.title === '会社の打ち合わせ'), mine);
  // 持ち主の予定は、見るだけ
  await f.locator('.bar:has-text("家族への連絡")').first().click(); await f.waitForSelector('.modal');
  ok('持ち主の予定は、開いても、編集できない（見るだけ）', (await f.locator('.modal input[name=title]').count()) === 0 && (await f.locator('.modal').innerText()).includes('家族への連絡'));
  await f.keyboard.press('Escape'); await f.waitForFunction(() => !document.querySelector('.modal'));
  // 家族のアカウントで使えない操作
  const denied = {};
  for (const [a, body] of [['todo_list'], ['users_list'], ['memo_get'], ['rooms_list&from=' + today + '&to=' + today], ['series_list'], ['share_list'], ['usage_get'], ['audit_list'], ['family_list'], ['todo_save', { title: 'x', kind: 'work' }], ['share_create', { kind: 'company' }], ['user_save', { name: 'x', email: 'x@example.com', password: 'password1', role: 'admin' }], ['family_add', { name: 'x', email: 'x2@example.com' }], ['prefs_save', {}], ['backup_snooze', {}], ['event_to_todo', { id: 1 }]]) denied[a] = (await api(f, a, body)).status;
  ok('家族のアカウントは、業務・ToDo・社員・共有・設定などのAPIを使えない（403）', Object.values(denied).every(s => s === 403), denied);
  const pages = await f.evaluate(async () => { const o = {}; for (const u of ['backup.php', 'guide.php']) o[u] = (await fetch(u)).status; return o; });
  ok('管理者向けのページ（バックアップ・運用の手引き）は、家族のアカウントでは開けない（403）', Object.values(pages).every(x => x === 403), pages);
  ok('家族のアカウントは、設定のページ・会議室のページを開けない（カレンダーのまま）', await (async () => { await f.goto(BASE + 'index.php#settings'); await f.waitForSelector('.cal'); const a = (await f.locator('.settings-page').count()) === 0; await f.goto(BASE + 'index.php#rooms'); await f.waitForSelector('.cal'); return a && (await f.locator('#rooms-body').count()) === 0; })());
  const me = await api(f, 'me'); ok('家族の「me」には、社員の一覧が入らない', (me.j.users || []).length === 0 && me.j.user.role === 'family', me.j);

  // ---- 持ち主の画面に、家族の予定が出る（見るだけ）
  await y.click('button:has-text("カレンダーに戻る")'); await y.waitForSelector('.cal'); await y.click('.tab[data-view=me]'); await y.waitForSelector('.bar:has-text("妻の買い物")');
  const yb = await y.locator('.bar:has-text("妻の買い物")').first().innerText();
  ok('持ち主のプライベート版に、家族の予定が出る（先頭に名前）', yb.includes('山田 妻'), yb);
  // 家族が、自分の表示名を変える → 持ち主の画面の予定の先頭も、その名前になる
  await f.goto(BASE + 'index.php'); await f.waitForSelector('.cal');
  await f.click('header .uname'); await f.waitForSelector('.menu-list');
  ok('家族のメニューに「表示名の変更」が出る', (await f.locator('.menu-list button:has-text("表示名の変更")').count()) === 1);
  await f.click('.menu-list button:has-text("表示名の変更")'); await f.waitForSelector('.modal input[name=fam_display_name]');
  ok('表示名の入力欄には、いまの名前が入っている', (await f.inputValue('.modal input[name=fam_display_name]')) === '山田 妻');
  await f.fill('.modal input[name=fam_display_name]', ''); await f.click('.modal button[type=submit]');
  ok('空の表示名では、変えられない（入力欄が必須）', (await f.locator('.modal input[name=fam_display_name]').count()) === 1);
  await f.fill('.modal input[name=fam_display_name]', 'ママ'); await f.click('.modal button[type=submit]'); await f.waitForFunction(() => !document.querySelector('.modal'));
  ok('変えると、家族の画面の名前のボタンも新しい名前になる', (await f.locator('header .uname').innerText()).includes('ママ'));
  await y.reload(); await y.waitForSelector('.bar:has-text("妻の買い物")');
  const yb2 = await y.locator('.bar:has-text("妻の買い物")').first().innerText();
  ok('持ち主のプライベート版の予定の先頭が、家族が決めた表示名になる（名字だけにしない）', yb2.startsWith('ママ｜'), yb2);
  ok('社員（持ち主）は、この方法では名前を変えられない（403）', (await api(y, 'family_name_save', { name: '別名' })).status === 403);
  await y.click('header .uname'); await y.waitForSelector('.menu-list');
  ok('社員のメニューには、「表示名の変更」は出ない', (await y.locator('.menu-list button:has-text("表示名の変更")').count()) === 0);
  await y.keyboard.press('Escape'); await y.mouse.click(5, 5);
  await api(f, 'family_name_save', { name: '山田 妻' }); // 以降の確認は、元の名前で
  await y.reload(); await y.waitForSelector('.bar:has-text("妻の買い物")');
  await y.locator('.bar:has-text("妻の買い物")').first().click(); await y.waitForSelector('.modal');
  ok('持ち主も、家族の予定は編集できない（見るだけ）', (await y.locator('.modal input[name=title]').count()) === 0);
  await y.keyboard.press('Escape'); await y.waitForFunction(() => !document.querySelector('.modal'));
  const yTeam = await api(y, 'events&from=' + today + '&to=' + today + '&view=team');
  ok('業務版には、家族の予定は出ない', !(yTeam.j.events || []).some(e => e.title === '妻の買い物'));
  // 他の人・管理者には見えない
  const s = await mk(); await login(s, 'suzuki@example.com', 'suzukipass1'); await s.waitForSelector('.cal');
  const sMe = await api(s, 'events&from=' + today + '&to=' + today + '&view=me'); ok('ほかの社員のプライベート版には、出ない', !(sMe.j.events || []).some(e => e.title === '妻の買い物' || e.title === '家族への連絡'));
  const a = await mk(); await login(a, 'admin@example.com', 'adminpass1'); await a.waitForSelector('.cal');
  const aMe = await api(a, 'events&from=' + today + '&to=' + today + '&view=me'); const aTeam = await api(a, 'events&from=' + today + '&to=' + today + '&view=team');
  ok('管理者にも、家族の予定は見えない', ![...(aMe.j.events || []), ...(aTeam.j.events || [])].some(e => e.title === '妻の買い物'));
  const au = await api(a, 'users_list'); ok('管理者の社員一覧に、家族のアカウントは出ない', !(au.j.users || []).some(u => u.email === 'wife@example.com' || u.role === 'family'), au.j);
  const aMeUsers = await api(a, 'me'); ok('管理者の「me」の社員の一覧にも、家族は出ない', !(aMeUsers.j.users || []).some(u => u.name === '山田 妻'));
  ok('管理者は、家族のパスワードをリセットできない（持ち主が管理）', (await api(a, 'user_reset_password', { id: (await api(y, 'family_list')).j.members[0].id })).status === 403);
  ok('他の社員は、山田さんの家族を操作できない', (await api(s, 'family_delete', { id: (await api(y, 'family_list')).j.members[0].id })).status === 404);

  // ---- 利用を止める・再開・削除
  const mid = (await api(y, 'family_list')).j.members[0].id;
  await api(y, 'family_set_active', { id: mid, active: 0 });
  const stopped = await api(y, 'events&from=' + today + '&to=' + today + '&view=me');
  ok('利用を止めると、その家族の予定は、持ち主の画面からも見えなくなる', !(stopped.j.events || []).some(e => e.title === '妻の買い物'));
  ok('利用を止めた家族は、ログインできず、使っていた画面も使えなくなる', (await api(f, 'events&from=' + today + '&to=' + today)).status === 401);
  await api(y, 'family_set_active', { id: mid, active: 1 });
  const f2 = await mk(); await login(f2, 'wife@example.com', 'familypass99'); await f2.waitForSelector('.cal');
  ok('再開すると、また使えて、予定も戻る', (await api(y, 'events&from=' + today + '&to=' + today + '&view=me')).j.events.some(e => e.title === '妻の買い物'));
  const reset = await api(y, 'family_reset_password', { id: mid });
  ok('パスワードをリセットすると、一時パスワードが返り、いまのパスワードは使えなくなる', reset.j.password.length >= 8 && (await api(f2, 'events&from=' + today + '&to=' + today)).status === 401);
  await api(y, 'family_delete', { id: mid });
  ok('削除すると、その家族の予定も消える', !(await api(y, 'events&from=' + today + '&to=' + today + '&view=me')).j.events.some(e => e.title === '妻の買い物') && (await api(y, 'family_list')).j.members.length === 0);
  // 人数の上限
  for (let i = 0; i < 5; i++) await api(y, 'family_add', { name: '家族' + i, email: 'fam' + i + '@example.com' });
  const over = await api(y, 'family_add', { name: '多すぎ', email: 'over@example.com' });
  ok('招待できるのは5人まで', over.status === 400 && String(over.j.error).includes('5人'), over);
  await y.reload(); await y.waitForSelector('.cal, .settings-page'); if (!(await y.locator('.settings-page').count())) await y.click('header button:has-text("設定")'); await y.waitForSelector('#set-family .fam-member');
  ok('人数に達すると、招待ボタンが押せない', await y.locator('#set-family button:has-text("招待する")').isDisabled());
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
