// 日報: 当日の欄に、空行で区切られた2つ目のかたまりがあっても、日が進むと、当日の欄はまるごと入れ替わる（古い項目が残って、重なって見えない）。
// 日報の欄は、中身に合わせてのび、スクロールは右の欄の1つだけ。上の長い説明は出さない
const { chromium } = require(process.env.NODE_PATH + '/playwright');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n, c ? '' : JSON.stringify(x === undefined ? '' : x).slice(0, 500)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', String(e)));
  await p.goto('http://127.0.0.1:8099/login.php');
  await p.fill('input[name=email]', 'suzuki@example.com'); await p.fill('input[name=password]', 'suzukipass1');
  await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
  await p.click('.seg label:has-text("リスト")'); await p.waitForSelector('.memo-single');
  ok('日報の上に、長い説明の文は出ない', !(await p.locator('#memo').innerText()).includes('自動で入れ替わります'));
  // 前の出勤日のままの日報（当日の欄に、空行で区切られた古い項目のかたまりがある）を保存しておき、開き直す = 日が進む
  const html = [
    '<div>お疲れ様です。</div>', '<div><br></div>',
    '<div data-md="cur" data-date="2020-01-06">【1/6　予定・To Do】</div>', '<div><br></div>',
    '<div>続けている仕事</div>', '<div><s>終わった仕事</s></div>', '<div><br></div>',
    '<div>続けている仕事</div>', '<div><s>前の日に終わった仕事</s></div>', '<div><s>前の日に終わった仕事2</s></div>', '<div><br></div>', '<div><br></div>',
    '<div data-md="next" data-date="2020-01-07">【1/7　予定・To Do】</div>', '<div><br></div>',
    '<div>次の日の仕事</div>', '<div><br></div>', '<div>以上となります。</div>'].join('');
  const r = await p.evaluate(async (html) => { const t = document.getElementById('app').dataset.csrf; const r = await fetch('api.php?action=memo_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ html }) }); return r.status; }, html);
  ok('前の出勤日のままの日報を保存できる', r === 200, r);
  await p.reload(); await p.waitForSelector('.memo-single div[data-md=cur]'); await p.waitForTimeout(800);
  const sec = await p.evaluate(() => { // 当日の見出しから、次回出勤日の見出しまでの行
    const kids = [...document.querySelectorAll('.memo-single > div')], ci = kids.findIndex(d => d.getAttribute('data-md') === 'cur'), ni = kids.findIndex(d => d.getAttribute('data-md') === 'next');
    return kids.slice(ci + 1, ni).map(d => d.textContent.trim());
  });
  const items = sec.filter(Boolean);
  ok('日が進むと、当日の欄の古い項目（空行の下のかたまりも）は、すべて入れ替わる', !items.some(t => t.includes('終わった仕事')), sec);
  ok('当日の項目は、前の日の「次回出勤日」の項目と、取り消し線のない項目（1つだけ）', items.includes('次の日の仕事') && items.filter(t => t === '続けている仕事').length === 1, sec);
  ok('当日の欄の空行は、見出しの下と、次回出勤日の見出しの前の1つずつ（重ならない）', sec[0] === '' && sec[sec.length - 1] === '' && !sec.slice(1, -1).some(t => t === ''), sec);
  await p.screenshot({ path: 'memo-pane.png' });
  // 日報の欄は、中身に合わせてのびて、欄の中ではスクロールしない（スクロールは右の欄の1つだけ）
  for (let i = 0; i < 40; i++) await p.evaluate(() => { const d = document.createElement('div'); d.textContent = '長い日報の行'; document.querySelector('.memo-single').appendChild(d); });
  const sc = await p.evaluate(() => { const e = document.querySelector('.memo-single'); return { inner: e.scrollHeight - e.clientHeight, mh: getComputedStyle(e).maxHeight }; });
  ok('日報の欄の中に、スクロールが出ない（のびる）', sc.inner <= 2 && sc.mh === 'none', sc);
  await b.close(); console.log(fails ? fails + ' 件失敗' : 'すべて成功'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
