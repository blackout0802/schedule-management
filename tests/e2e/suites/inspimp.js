// 年間計画: PDF から点検項目を取り込む（v1.115.0）。PDF の文字をブラウザで読む → 確認の画面（新規・変更・変わらない・変更できない）→ 登録 → 元の資料を残す。
// PDF は、このテストの中で Chromium に作らせる（表の HTML → page.pdf()）。日付には依らない（年度は、画面に出ている今年度）
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const { sql, TMP } = require('../lib/env');
const path = require('path');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const FY = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
const css = '<style>body{font-family:"Noto Sans CJK JP","IPAGothic","IPAPGothic","WenQuanYi Zen Hei",sans-serif;font-size:11px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #888;padding:4px;text-align:center} td.l{text-align:left}</style>';
// 表の1行: [No, 項目名（<br> で折り返し）, 印のある月, 担当]
const tableA = (rows, head = true) => '<table>' + (head ? '<thead><tr><th>No.</th><th>活動内容</th>' + FY.map(m => `<th>${m}月</th>`).join('') + '<th>担当</th></tr></thead>' : '') + '<tbody>' +
  rows.map((r, i) => `<tr><td>${i + 1}</td><td class="l">${r[0]}</td>` + FY.map(m => `<td>${r[1].includes(m) ? '●' : ''}</td>`).join('') + `<td>${r[2] || ''}</td></tr>`).join('') + '</tbody></table>';

(async () => {
  const b = await chromium.launch();
  const mkPdf = async (name, html) => {
    const p = await (await b.newContext()).newPage();
    await p.setContent('<html><head><meta charset="utf-8">' + css + '</head><body>' + html + '</body></html>');
    const file = path.join(TMP, name); await p.pdf({ path: file, format: 'A4', landscape: true }); await p.context().close(); return file;
  };
  const pdfA = await mkPdf('年間計画A.pdf', '<h3>2031年度 個人情報保護 年間活動計画</h3>' + tableA([
    ['個人情報の台帳の見直し', [7], '山田'],
    ['従業者教育', [10], '管理責任者'],
    ['入退室記録の確認', FY, '鈴木 一郎'],
    ['委託先の評価と<br>契約の見直し', [9, 3], '鈴木'],
    ['内部監査', [1], ''],
  ]));
  // 別の形: 4月はじまりの数字だけの見出し・項目名の列は「実施事項」・担当（責任者）は左・印は ○・「毎月」の横長のマス。2ページ目は見出しのない続き
  const B = (rows) => rows.map(r => `<tr><td class="l">${r[0]}</td><td>${r[2]}</td>` + (r[1] === 'all' ? '<td colspan="12">毎月実施</td>' : [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map(m => `<td>${r[1].includes(m) ? '○' : ''}</td>`).join('')) + '</tr>').join('');
  const pdfB = await mkPdf('plan-b.pdf', '<p>区分: 運用</p><table><tr><th>実施事項</th><th>責任者</th>' + [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map(m => `<th>${m}</th>`).join('') + '</tr>' +
    B([['アクセスログの確認', [7, 10, 1, 4], '山田 花子'], ['バックアップの確認', 'all', '鈴木']]) + '</table>' +
    '<table style="page-break-before:always">' + '<tr style="visibility:hidden"><td class="l">ダミー</td><td>　</td>' + [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map(m => `<td>${m}</td>`).join('') + '</tr>' + B([['マネジメントレビュー', [3], '総務部']]) + '</table>');
  const pdfNoHead = await mkPdf('memo.pdf', '<h3>点検のメモ</h3><p>内部監査は1月に行う。</p>');
  // ファイルを選ぶ（Playwright は、日本語の名前のファイルをパスで渡すと選べないことがあるので、中身で渡す）
  const pick = (p, file) => p.setInputFiles('#inspimp-file', { name: path.basename(file), mimeType: 'application/pdf', buffer: fs.readFileSync(file) });
  const notPdf = path.join(TMP, 'not-pdf.pdf'); fs.writeFileSync(notPdf, 'これは PDF ではありません');

  const login = async (email, pass, opt) => {
    const p = await (await b.newContext(opt || { viewport: { width: 1366, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
    await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pass);
    await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal'); return p;
  };
  const admin = await login('admin@example.com', 'adminpass1');
  const yam = await login('yamada@example.com', 'yamadapass1');
  const errs = []; yam.on('pageerror', e => errs.push(e.message));

  // 管理者が先に登録した項目: 「従業者教育」（11月。山田さんは変更できない）・「内部監査」（1月・担当は管理者。山田さんが登録したことにして、変わらない）
  const adminId = +sql("SELECT id FROM users WHERE email = 'admin@example.com'"), yamId = +sql("SELECT id FROM users WHERE email = 'yamada@example.com'"), suzId = +sql("SELECT id FROM users WHERE email = 'suzuki@example.com'");
  const now = '2031-01-01 00:00:00';
  sql(`INSERT INTO inspection_items (plan, title, months, due_rule, alert_days, alert_due, alert_late, alert_check, owner_id, checker_id, steps, need_attach, active, sort_order, created_by, created_at) VALUES
    ('Pマーク', '従業者教育', '11', 'last', 7, 1, 1, 1, ${adminId}, NULL, '手順X', 0, 1, 1, ${adminId}, '${now}'),
    ('Pマーク', '内部監査', '1', '15', 7, 1, 1, 1, ${yamId}, NULL, '', 0, 1, 2, ${yamId}, '${now}')`);

  // 年間計画のページに「PDFから取り込む」
  await yam.goto(BASE + 'index.php#annual'); await yam.waitForSelector('#annual-tbl');
  ok('年間計画のページに「PDFから取り込む」のボタンがある（一般の社員にも）', await yam.locator('#insp-import').count() === 1);
  await yam.click('#insp-import'); await yam.waitForSelector('#inspimp-file', { state: 'attached' });
  ok('取り込みの画面に、社外へ送らないこと・スキャンは読めないことが書いてある', /社外には送りません/.test(await yam.locator('.insp-imp').innerText()) && /スキャンした PDF・写真は読めません/.test(await yam.locator('.insp-imp').innerText()));

  // 文字の入っていないもの・見出しのないもの
  await pick(yam, notPdf); await yam.waitForSelector('#inspimp-status.error');
  ok('PDF でないファイルは、「PDF として読めません」と知らせる', /PDF として読めませんでした/.test(await yam.locator('#inspimp-status').innerText()), await yam.locator('#inspimp-status').innerText());
  await pick(yam, pdfNoHead); await yam.waitForFunction(() => /月の見出し/.test((document.querySelector('#inspimp-status') || {}).textContent || ''));
  ok('月の見出しのない PDF は、見出しが見つからないと知らせる', /月の見出しの行が見つかりませんでした/.test(await yam.locator('#inspimp-status').innerText()));

  // 表 A を読む
  await pick(yam, pdfA); await yam.waitForSelector('#inspimp-tbl');
  const rows = await yam.$$eval('#inspimp-tbl tbody tr', trs => trs.map(tr => ({
    title: tr.querySelector('.nm input').value, months: [...tr.querySelectorAll('.insp-imp-ms button[aria-pressed=true]')].map(x => +x.textContent),
    owner: tr.querySelector('select[aria-label$="担当者"]').selectedOptions[0].textContent, tag: tr.querySelector('.tag').textContent, on: tr.querySelector('.ck input').checked,
    dis: tr.querySelector('.ck input').disabled, src: (tr.querySelector('.insp-imp-src') || {}).textContent || '', note: tr.querySelector('.insp-imp-note').textContent, pg: tr.querySelector('.pg').textContent })));
  console.log(JSON.stringify(rows));
  ok('5行を読み取る（見出しの「No.」「活動内容」「担当」は、行にしない）', rows.length === 5, rows.map(r => r.title));
  ok('項目名と月（7月はじまりの順）を読む', JSON.stringify(rows.map(r => [r.title, r.months])) === JSON.stringify([['個人情報の台帳の見直し', [7]], ['従業者教育', [10]], ['入退室記録の確認', FY], ['委託先の評価と契約の見直し', [9, 3]], ['内部監査', [1]]]), rows.map(r => [r.title, r.months]));
  ok('折り返した項目名は、1つにつなぐ', rows[3] && rows[3].title === '委託先の評価と契約の見直し');
  ok('担当: 名字・氏名は社員に結びつく（山田 → 山田 花子、鈴木 一郎、鈴木 → 鈴木 一郎）', rows[0].owner === '山田 花子' && rows[2].owner === '鈴木 一郎' && rows[3].owner === '鈴木 一郎', rows.map(r => r.owner));
  ok('担当: 結びつかない書き方（管理責任者）は、資料の書き方を出す', rows[1].src === '資料: 管理責任者');
  ok('新しい項目は「新規」で、初めから選ばれている', rows[0].tag === '新規' && rows[0].on && rows[2].tag === '新規');
  ok('ほかの人が登録した項目は「変更できない」（選べない）', rows[1].tag === '変更できない' && rows[1].dis && !rows[1].on && /管理者 太郎/.test(rows[1].note), rows[1]);
  ok('同じ中身の項目は「変わらない」（初めは選ばない）', rows[4].tag === '変わらない' && !rows[4].on && !rows[4].dis, rows[4]);
  ok('行ごとに、資料のページ（p.1）', rows.every(r => r.pg === 'p.1'));
  ok('ボタンは「3件を登録」', (await yam.locator('#inspimp-go').innerText()) === '3件を登録');
  ok('読んだ資料の名前・月の見出しの範囲が出る', /年間計画A\.pdf/.test(await yam.locator('#inspimp-sum').innerText()) && /7月〜6月/.test(await yam.locator('#inspimp-sum').innerText()), await yam.locator('#inspimp-sum').innerText());

  // 直す: 内部監査に 7月を足すと「変更」になり、選ばれる。台帳の見直しの確認者を鈴木に
  const tr = n => `#inspimp-tbl tbody tr:nth-child(${n})`;
  await yam.click(`${tr(5)} .insp-imp-ms button[aria-label="7月"]`);
  ok('月を足すと「変更」になり、変わる中身が出る', (await yam.locator(`${tr(5)} .tag`).innerText()) === '変更' && /月: 1 → 7・1/.test(await yam.locator(`${tr(5)} .insp-imp-note`).innerText()), await yam.locator(`${tr(5)} .insp-imp-note`).innerText());
  await yam.click(`${tr(5)} .ck input`);
  ok('選ぶと「4件を登録」', (await yam.locator('#inspimp-go').innerText()) === '4件を登録');
  await yam.selectOption(`${tr(1)} select[aria-label$="確認者"]`, { label: '鈴木 一郎' });
  // 名前を消した行は選べない
  await yam.fill(`${tr(3)} .nm input`, '');
  ok('項目名を消すと、選べなくなる（3件を登録）', await yam.locator(`${tr(3)} .ck input`).isDisabled() && (await yam.locator('#inspimp-go').innerText()) === '3件を登録');
  await yam.fill(`${tr(3)} .nm input`, '入退室記録の確認');
  await yam.click(`${tr(3)} .ck input`);
  ok('名前を戻して選び直すと、4件', (await yam.locator('#inspimp-go').innerText()) === '4件を登録');
  ok('「元の資料として残す」は、初めから入っている', await yam.locator('#inspimp-keep').isChecked());

  // スマホ幅でも、横にはみ出さない（表は枠の中で横に動く）
  await yam.setViewportSize({ width: 390, height: 800 });
  ok('スマホ幅: ページが横にはみ出さない', await yam.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await yam.setViewportSize({ width: 1366, height: 900 });

  await yam.click('#inspimp-go'); await yam.waitForSelector('.toast:has-text("取り込みました")');
  ok('登録すると「追加 3件・変更 1件」', (await yam.locator('.toast:has-text("取り込みました")').innerText()).includes('追加 3件・変更 1件'));
  await yam.waitForFunction(() => !document.querySelector('.insp-imp')); await yam.waitForSelector('#annual-docs');
  const it = t => sql(`SELECT months, owner_id, IFNULL(checker_id, 0), created_by, IFNULL(doc_id, 0), IFNULL(doc_page, 0), due_rule, steps FROM inspection_items WHERE title = '${t}'`).split('\t');
  const docId = sql('SELECT id FROM inspection_docs');
  ok('台帳の見直し: 7月・担当 山田・確認者 鈴木・登録した人は山田・資料 p.1', JSON.stringify(it('個人情報の台帳の見直し').slice(0, 6)) === JSON.stringify(['7', String(yamId), String(suzId), String(yamId), docId, '1']), it('個人情報の台帳の見直し'));
  ok('入退室記録の確認: 12か月・担当 鈴木', it('入退室記録の確認')[0].split(',').length === 12 && it('入退室記録の確認')[1] === String(suzId));
  ok('内部監査（変更）: 月は 7・1（年度の順）になり、期限（15日）はそのまま', it('内部監査')[0] === '7,1' && it('内部監査')[6] === '15', it('内部監査'));
  ok('従業者教育（変更できない）は、そのまま（11月・手順 X）', it('従業者教育')[0] === '11' && it('従業者教育')[7] === '手順X' && it('従業者教育')[4] === '0');
  ok('元の資料が1件残る（年度・名前・項目の数・取り込んだ人）', sql('SELECT name, items, created_by FROM inspection_docs') === `年間計画A.pdf\t4\t${yamId}`, sql('SELECT name, items, created_by FROM inspection_docs'));
  const stored = sql('SELECT stored FROM inspection_docs');
  ok('資料のファイルは data/inspect_docs/ に保存される（Web からは直接見えない場所）', fs.existsSync(path.join(process.env.E2E_APP, 'data/inspect_docs', stored)) && fs.existsSync(path.join(process.env.E2E_APP, 'data/inspect_docs/.htaccess')));
  ok('変更履歴に、取り込みが残る', /点検項目の取り込み｜追加 3件・変更 1件/.test(sql("SELECT label FROM audit_log WHERE type = 'inspect' ORDER BY id DESC LIMIT 1")), sql("SELECT label FROM audit_log WHERE type = 'inspect' ORDER BY id DESC LIMIT 1"));

  // 年間計画の上に「元の資料」、項目ごとに「資料 p.1」
  ok('年間計画の上に「元の資料」（名前・取り込んだ人・項目の数）', /元の資料\s*年間計画A\.pdf/.test(await yam.locator('#annual-docs').innerText()) && /山田 花子が取り込み・4項目/.test(await yam.locator('#annual-docs').innerText()), await yam.locator('#annual-docs').innerText());
  const docLinks = await yam.$$eval('#annual-tbl .an-doc', as => as.map(a => [a.closest('th').querySelector('b').textContent, a.textContent, a.getAttribute('href')]));
  ok('取り込んだ項目に「資料 p.1」のリンク（ページへ飛ぶ）。取り込んでいない項目にはない', docLinks.length === 4 && docLinks.every(l => l[1] === '資料 p.1' && l[2] === `api.php?action=inspect_doc&id=${docId}#page=1`) && !docLinks.some(l => l[0] === '従業者教育'), docLinks);
  const resp = await yam.request.get(BASE + `api.php?action=inspect_doc&id=${docId}`);
  const body = await resp.body();
  ok('資料のリンクは、PDF を返す（application/pdf・nosniff・中身は同じ）', resp.status() === 200 && resp.headers()['content-type'] === 'application/pdf' && resp.headers()['x-content-type-options'] === 'nosniff' && !resp.headers()['content-security-policy'] && body.equals(fs.readFileSync(pdfA)));
  const anon = await (await b.newContext()).request.get(BASE + `api.php?action=inspect_doc&id=${docId}`);
  ok('ログインしていないと、資料は見られない', anon.status() === 401);
  ok('ないファイルは 404', (await yam.request.get(BASE + 'api.php?action=inspect_doc&id=999')).status() === 404);

  // 2回目: 同じ PDF をもう一度読むと、取り込んだ項目は「変わらない」
  await yam.click('#insp-import'); await pick(yam, pdfA); await yam.waitForSelector('#inspimp-tbl');
  const tags2 = await yam.$$eval('#inspimp-tbl tbody .tag', x => x.map(t => t.textContent));
  ok('同じ PDF をもう一度読むと、登録した行は「変わらない」（内部監査は 7月を足したので「変更」）', JSON.stringify(tags2) === JSON.stringify(['変わらない', '変更できない', '変わらない', '変わらない', '変更']), tags2);
  ok('選ぶものがないとき以外は、ボタンの件数どおり（1件を登録）', (await yam.locator('#inspimp-go').innerText()) === '1件を登録');
  await yam.click('.insp-imp .actions button:has-text("キャンセル")');

  // 別の形の PDF（4月はじまり・数字だけの見出し・責任者の列・○・毎月・見出しのない続きのページ）
  await yam.click('#insp-import'); await pick(yam, pdfB); await yam.waitForSelector('#inspimp-tbl');
  const rowsB = await yam.$$eval('#inspimp-tbl tbody tr', trs => trs.map(tr => [tr.querySelector('.nm input').value, [...tr.querySelectorAll('.insp-imp-ms button[aria-pressed=true]')].map(x => +x.textContent), tr.querySelector('select[aria-label$="担当者"]').selectedOptions[0].textContent, tr.querySelector('.pg').textContent]));
  console.log(JSON.stringify(rowsB));
  ok('別の形の表: 数字だけの見出し・○・左の責任者の列・「毎月」のマスも読む', JSON.stringify(rowsB.slice(0, 2)) === JSON.stringify([['アクセスログの確認', [7, 10, 1, 4], '山田 花子', 'p.1'], ['バックアップの確認', FY, '鈴木 一郎', 'p.1']]), rowsB);
  ok('見出しのない続きのページも、前のページの列で読む（p.2）', rowsB[2] && rowsB[2][0] === 'マネジメントレビュー' && JSON.stringify(rowsB[2][1]) === '[3]' && rowsB[2][3] === 'p.2', rowsB[2]);
  ok('結びつかない担当（総務部）は、登録する人（山田）が初めの担当', rowsB[2] && rowsB[2][2] === '山田 花子');
  // 資料を残さずに登録する
  await yam.uncheck('#inspimp-keep');
  await yam.click('#inspimp-go'); await yam.waitForSelector('.toast:has-text("追加 3件・変更 0件")');
  ok('資料を残さないと、資料は増えない（項目の資料のリンクもない）', sql('SELECT COUNT(*) FROM inspection_docs') === '1' && sql("SELECT IFNULL(doc_id, 0) FROM inspection_items WHERE title = 'アクセスログの確認'") === '0');

  // 削除: ほかの人（鈴木）は 403、取り込んだ人は消せる（項目は残り、リンクが外れる）
  const suz = await login('suzuki@example.com', 'suzukipass1');
  const del = await suz.evaluate(async id => { const r = await fetch('api.php?action=inspect_doc_delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.getElementById('app').getAttribute('data-csrf') }, body: JSON.stringify({ id }) }); return r.status; }, +docId);
  ok('取り込んだ人・管理者でない人は、資料を削除できない（403）', del === 403, del);
  await suz.goto(BASE + 'index.php#annual'); await suz.waitForSelector('#annual-docs');
  ok('ほかの人には、資料の「削除」は出ない（見ることはできる）', await suz.locator('#annual-docs .an-doc-del').count() === 0 && await suz.locator('#annual-docs a').count() === 1);
  // サーバーの確かめ: PDF でないものは、元の資料として残せない
  const fake = await suz.evaluate(async () => {
    const fd = new FormData(); fd.append('data', JSON.stringify({ rows: [{ title: 'にせ', months: [7], owner_id: 0 }] })); fd.append('file', new Blob(['hello'], { type: 'application/pdf' }), 'x.pdf');
    const token = document.getElementById('app').getAttribute('data-csrf');
    const r = await fetch('api.php?action=inspect_import', { method: 'POST', headers: { 'X-CSRF-Token': token }, body: fd }); return [r.status, (await r.json()).error];
  });
  ok('PDF でないファイルは、サーバーが受け付けない', fake[0] === 400 && /PDF だけ/.test(fake[1]), fake);
  await yam.reload(); await yam.waitForSelector('#annual-docs');
  await yam.click('#annual-docs .an-doc-del'); await yam.waitForSelector('.toast:has-text("資料を削除しました")');
  await yam.waitForFunction(() => !document.querySelector('#annual-docs'));
  ok('取り込んだ人は資料を削除できる（ファイルも消え、項目は残ってリンクが外れる）', sql('SELECT COUNT(*) FROM inspection_docs') === '0' && !fs.existsSync(path.join(process.env.E2E_APP, 'data/inspect_docs', stored)) && sql("SELECT COUNT(*) FROM inspection_items WHERE doc_id IS NOT NULL") === '0' && await yam.locator('#annual-tbl .an-doc').count() === 0);

  // ダークモードでも、確認の画面の文字が読める（背景と文字が同じ色にならない）
  const dark = await login('admin@example.com', 'adminpass1', { viewport: { width: 1366, height: 900 }, colorScheme: 'dark' });
  await dark.goto(BASE + 'index.php#annual'); await dark.waitForSelector('#annual-tbl');
  await dark.click('#insp-import'); await pick(dark, pdfA); await dark.waitForSelector('#inspimp-tbl');
  const col = await dark.evaluate(() => { const t = document.querySelector('#inspimp-tbl .tag'); const s = getComputedStyle(t); return [s.color, s.backgroundColor, getComputedStyle(document.querySelector('.modal')).backgroundColor]; });
  ok('ダークモード: 印の文字と背景の色が違い、画面は暗い', col[0] !== col[1] && /rgb\((\d+), (\d+), (\d+)\)/.exec(col[2]).slice(1).every(v => +v < 80), col);
  ok('管理者は、ほかの人が登録した項目も「変更」できる（変更できない、が出ない）', !(await dark.$$eval('#inspimp-tbl tbody .tag', x => x.map(t => t.textContent))).includes('変更できない'));

  ok('画面の JS エラーがない', errs.length === 0, errs);
  await b.close();
  console.log(fails ? fails + ' 件失敗' : 'すべて成功');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
