// 日報の当日・次回出勤日の項目は、カレンダーの、その日の自分の業務の予定が基準。
//   その日の予定は自動で入り（ToDo が完了なら取り消し線）、その日の予定に無いもの（過去の日の予定・以前の版で自動で入れた ToDo）は残らない。
//   自分で書いた行・「日報へ」で入れた行は残る。期間のある予定は当日だけに入り、次回出勤日には転記される。日が進むと、新しい当日の予定に入れ替わる。
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const BASE = 'http://127.0.0.1:8099/';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 300)); if (!c) fails++; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function login(b, email, pw) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e))); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'login.php'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  return p;
}
(async () => {
  const b = await chromium.launch();
  const p = await login(b, 'yamada@example.com', 'yamadapass1'); const s = await login(b, 'suzuki@example.com', 'suzukipass1');
  const api = (pg, a, body) => pg.evaluate(async ([a, body]) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(body) }); return r.json(); }, [a, body]);
  const memo = () => p.evaluate(async () => (await fetch('api.php?action=memo_get')).json());
  const { cur, next } = await memo();
  const past = addDays(cur, -7);
  const ev = async (pg, title, start, end, kind) => (await api(pg, 'event_save', { kind: kind || 'work', title, tag: '個人作業', start, end: end || start })).event;
  const A = await ev(p, '当日の業務A', cur);
  await ev(p, '次回の業務B', next);
  const C = await ev(p, '過去の業務C', past);
  await ev(p, '当日と次回の業務E', cur, next);
  await ev(p, '当日のプライベート', cur, cur, 'private');
  await ev(s, '鈴木さんの当日の業務', cur);
  const T = (await api(p, 'todo_save', { title: '当日に置いて完了したToDo', kind: 'work', tag: '個人作業' })).todo;
  await api(p, 'todo_schedule', { id: T.id, date: cur }); await api(p, 'todo_status', { id: T.id, status: 'done' });
  const U = (await api(p, 'todo_save', { title: '日付のない進行中のToDo', kind: 'work', tag: '個人作業' })).todo; await api(p, 'todo_status', { id: U.id, status: 'doing' });
  const O = (await api(p, 'todo_save', { title: '以前に自動で入った完了ToDo', kind: 'work', tag: '個人作業' })).todo; await api(p, 'todo_status', { id: O.id, status: 'done' });
  const M = (await api(p, 'todo_save', { title: '日報へで入れたToDo', kind: 'work', tag: '個人作業' })).todo;
  // 以前の版の日報: 当日に、カレンダーに無い ToDo の行（自動で入ったもの）・自分で書いた行・「日報へ」で入れた行・過去の予定の行
  const head = (k, d, t) => '<div data-md="' + k + '" data-date="' + d + '">【' + (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '　予定・To Do】</div>';
  await api(p, 'memo_save', { html: '<div>お疲れ様です。</div><div><br></div>' + head('cur', cur) + '<div><br></div>'
    + '<div data-todo="' + O.id + '" data-st="done"><s>以前に自動で入った完了ToDo</s></div><div data-todo="' + U.id + '" data-st="doing">日付のない進行中のToDo</div>'
    + '<div data-ev="' + C.id + '">過去の業務C</div><div>自分で書いた行</div><div data-todo="' + M.id + '" data-st="todo" data-man="1">日報へで入れたToDo</div>'
    + '<div><br></div>' + head('next', next) + '<div><br></div><div><br></div><div>以上となります。</div>' });
  await p.reload(); await p.waitForSelector('.cal');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single');
  const items = (kind) => p.evaluate((kind) => {
    const h = document.querySelector('.memo-single div[data-md=' + kind + ']'); const out = [];
    let d = h.nextElementSibling; if (d && !d.textContent.trim()) d = d.nextElementSibling;
    while (d && d.textContent.trim() && !d.hasAttribute('data-md')) { out.push(d.textContent + (d.querySelector('s') ? '[s]' : '') + (d.hasAttribute('data-tr') ? '[tr]' : '')); d = d.nextElementSibling; }
    return out;
  }, kind);
  const has = (list, t) => list.some(x => x.startsWith(t));
  await p.waitForFunction(() => Array.from(document.querySelectorAll('.memo-single div[data-ev]')).some(d => d.textContent === '当日の業務A'));
  await p.waitForTimeout(400);
  let c = await items('cur'), n = await items('next');
  ok('当日の項目に、カレンダーの当日の自分の業務の予定が入る', has(c, '当日の業務A') && has(c, '当日と次回の業務E'), c);
  ok('カレンダーに置いて完了した ToDo は、取り消し線つきで入る', c.includes('当日に置いて完了したToDo[s]'), c);
  ok('過去の日の予定の行は、残らない', !has(c, '過去の業務C') && !has(n, '過去の業務C'), c);
  ok('以前の版で自動で入った ToDo の行（カレンダーに無いもの）は、残らない', !has(c, '以前に自動で入った完了ToDo') && !has(c, '日付のない進行中のToDo'), c);
  ok('自分で書いた行と、「日報へ」で入れた行は、残る', has(c, '自分で書いた行') && has(c, '日報へで入れたToDo'), c);
  ok('プライベートの予定・ほかの人の予定は、入らない', !has(c, '当日のプライベート') && !has(c, '鈴木さん'), c);
  ok('次回出勤日の項目に、次回出勤日の予定が入る（当日の予定は入らない）', has(n, '次回の業務B') && !n.some(x => x === '当日の業務A'), n);
  ok('期間のある予定は、当日にだけ入り、次回出勤日には転記される（2つ重ねない）', n.filter(x => x.startsWith('当日と次回の業務E')).length === 1 && n.includes('当日と次回の業務E[tr]'), n);
  // 保存しても、開き直しても、増えない
  await p.waitForTimeout(1500); await p.reload(); await p.waitForSelector('.memo-single'); // リストのまま開く await p.waitForTimeout(1500);
  c = await items('cur'); n = await items('next');
  ok('開き直しても、同じ（増えない）', c.filter(x => x.startsWith('当日の業務A')).length === 1 && n.filter(x => x.startsWith('次回の業務B')).length === 1, [c, n]);
  // カレンダーの予定を別の日へ動かすと、日報からも消える
  await api(p, 'event_move', { id: A.id, start: addDays(cur, 20) });
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForFunction(() => !Array.from(document.querySelectorAll('.memo-single div[data-ev]')).some(d => d.textContent === '当日の業務A'), null, { timeout: 15000 }).catch(() => {});
  c = await items('cur');
  ok('予定を別の日へ動かすと、日報の当日の項目からも消える', !has(c, '当日の業務A'), c);
  // 「カレンダーに入れる」: 日報にあってカレンダーに無い行を、その日の業務の予定として入れる（取り消し線の行は完了として。次回出勤日の行も）
  await p.evaluate(() => { const ed = document.querySelector('.memo-single'); const add = (kind, html) => { const h = ed.querySelector('div[data-md=' + kind + ']'); let d = h.nextElementSibling; if (d && !d.textContent.trim()) d = d.nextElementSibling; const n = document.createElement('div'); n.innerHTML = html; ed.insertBefore(n, d); }; add('cur', '日報から入れる業務'); add('cur', '<s>日報から入れる終わった業務</s>'); add('next', '次回の日報から入れる業務'); ed.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.memo-bar button:has-text("カレンダーに入れる")'); await p.waitForSelector('.toast:has-text("カレンダーに入れました")');
  const cal = await p.evaluate(async ([cur, next]) => (await (await fetch('api.php?action=events&view=team&from=' + cur + '&to=' + next)).json()).events.map(e => e.title + '@' + e.start + (e.done ? '[done]' : '') + '|' + e.tag), [cur, next]);
  ok('カレンダーに無い行が、その日の業務の予定（個人作業）になる。取り消し線の行は完了、次回出勤日の行は次回出勤日に', cal.includes('日報から入れる業務@' + cur + '|個人作業') && cal.includes('日報から入れる終わった業務@' + cur + '[done]|個人作業') && cal.includes('次回の日報から入れる業務@' + next + '|個人作業') && cal.includes('自分で書いた行@' + cur + '|個人作業'), cal);
  ok('もとからカレンダーにある予定・転記された行は、二重に入れない', cal.filter(x => x.startsWith('当日と次回の業務E@')).length === 1 && cal.filter(x => x.startsWith('日報から入れる業務@')).length === 1, cal);
  await p.waitForTimeout(1500); await p.reload(); await p.waitForSelector('.memo-single'); await p.waitForTimeout(1500);
  c = await items('cur');
  ok('入れた行は、日報に残り（カレンダーの予定とつながる）、取り消し線も残る', has(c, '日報から入れる業務') && c.includes('日報から入れる終わった業務[s]') && c.filter(x => x.startsWith('日報から入れる業務')).length === 1, c);
  await p.click('.memo-bar button:has-text("カレンダーに入れる")'); await p.waitForSelector('.toast:has-text("カレンダーに無い行は、ありません")');
  ok('もう一度押しても、増えない（カレンダーに無い行は、ありません）', true);
  // 日が進む: 前の日の予定の行は残らず、新しい当日の予定に入れ替わる（自分で書いた行は残る）
  const prev = addDays(cur, -1);
  await api(p, 'memo_save', { html: head('cur', prev) + '<div><br></div><div data-ev="' + C.id + '">過去の業務C</div><div>昨日の手書き</div><div><br></div>'
    + head('next', cur) + '<div><br></div><div data-ev="' + C.id + '" data-tr="1">過去の業務C</div><div data-tr="1">昨日の手書き</div><div>今日のために書いた行</div><div><br></div><div>以上となります。</div>' });
  await p.reload(); await p.waitForSelector('.memo-single'); // リストのまま開く
  await p.waitForFunction(() => Array.from(document.querySelectorAll('.memo-single div[data-ev]')).some(d => d.textContent.includes('当日と次回の業務E'))); await p.waitForTimeout(500);
  c = await items('cur');
  ok('日が進むと、前の日の予定の行は残らず、当日の予定が入る。自分で書いた行は残る', !has(c, '過去の業務C') && has(c, '当日と次回の業務E') && has(c, '昨日の手書き') && has(c, '今日のために書いた行'), c);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
