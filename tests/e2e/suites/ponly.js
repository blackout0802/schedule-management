// Hub の段階6（v1.121.0）: Hub から一度でも入った社員は、ふつうのログイン（パスワード）を使えない。管理者と、まだ Hub から入っていない社員は使える
// Hub の仕組みを使うには確かめる鍵が要るので、このテストのあいだだけ、設定に仮の鍵を書く（終わったら元に戻す）。Hub（https://…skym.ink）は、ブラウザの中で受け止める
const { chromium } = require(process.env.NODE_PATH + '/playwright');
const fs = require('fs');
const { sql, CONFIG } = require('../lib/env');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'NG  ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const BASE = 'http://127.0.0.1:8099/';
const orig = fs.readFileSync(CONFIG, 'utf8');
(async () => {
  let b;
  try {
    fs.writeFileSync(CONFIG, orig.replace("'portal_pubkey' => ''", "'portal_pubkey' => '" + Buffer.alloc(32, 7).toString('base64') + "'"));
    await new Promise(r => setTimeout(r, 3000)); // PHP の opcache は、ファイルの変更を最大2秒見ない（revalidate_freq）ので、待ってから使う
    sql("UPDATE users SET portal_linked_at = '2026-11-24 10:00:00' WHERE email IN ('yamada@example.com', 'admin@example.com')");
    b = await chromium.launch();
    const mk = async () => {
      const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
      await c.route(/^https:\/\/([a-z-]+\.)?skym\.ink\//, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>' }));
      const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); return p;
    };
    const tryLogin = async (p, em, pw) => {
      await p.goto(BASE + 'login.php?sso=out'); // Hub へ自動で行かずに、ログインの画面を出す
      await p.fill('input[name=email]', em); await p.fill('input[name=password]', pw);
      await Promise.all([p.waitForLoadState('load'), p.click('button[type=submit]')]);
      await p.waitForTimeout(300);
    };

    // 1) Hub から入ったことのある社員: 正しいパスワードでも入れず、Hub からと案内する
    const y = await mk();
    await tryLogin(y, 'yamada@example.com', 'yamadapass1');
    const yErr = (await y.locator('.error').allInnerTexts()).join(' ');
    ok('Hub から入った社員は、ふつうのログインを使えない（ログインの画面のまま）', y.url().includes('login.php') && yErr.includes('Hub から入ります'), [y.url(), yErr]);
    ok('「Hub からログインする」のリンクがある', (await y.locator('a[href="sso.php"]').count()) === 1);
    const st = await y.evaluate(async () => (await fetch('api.php?action=me')).status);
    ok('ログインしていない（API は使えない）', st !== 200, st);
    // パスワードが違えば、いつもの案内（Hub の人かどうかは知らせない）
    await tryLogin(y, 'yamada@example.com', 'wrongpass1');
    const yErr2 = (await y.locator('.error').allInnerTexts()).join(' ');
    ok('パスワードが違うときは、いつもの案内（Hub の人かは知らせない）', yErr2.includes('メールアドレスまたはパスワードが違います') && !yErr2.includes('Hub'), yErr2);

    // 2) まだ Hub から入っていない社員: 今までどおり
    const s = await mk();
    await tryLogin(s, 'suzuki@example.com', 'suzukipass1');
    await s.waitForSelector('.cal');
    ok('まだ Hub から入っていない社員は、今までどおりふつうのログインで入れる', s.url().includes('index.php'), s.url());

    // 3) 管理者: Hub から入ったあとも、ふつうのログインで入れる（Hub が止まったとき）
    const a = await mk(); a.on('dialog', d => d.accept());
    await tryLogin(a, 'admin@example.com', 'adminpass1');
    await a.waitForSelector('.cal');
    ok('管理者は、Hub から入ったあとも、ふつうのログインで入れる', a.url().includes('index.php'), a.url());
    // 社員の管理: Hub で入る社員に印（管理者には付けない）
    await a.click('#btn-user'); await a.click('#btn-admin'); await a.waitForSelector('#set-users table');
    const ut = await a.locator('#set-users table').innerText();
    ok('社員の管理に「（Hub で入る）」の印（Hub から入った社員だけ）', ut.includes('山田 花子（Hub で入る）') && !ut.includes('鈴木 一郎（Hub で入る）') && !ut.includes('管理者 太郎（Hub で入る）'), ut);

    // 4) Hub の仕組みが使えない（鍵が無い）ときは、だれも止めない
    fs.writeFileSync(CONFIG, orig);
    await new Promise(r => setTimeout(r, 3000)); // opcache が、元に戻した設定を読むまで待つ
    const y2 = await mk();
    await tryLogin(y2, 'yamada@example.com', 'yamadapass1');
    await y2.waitForSelector('.cal');
    ok('Hub の仕組みが使えないときは、Hub から入った社員も、ふつうのログインで入れる', y2.url().includes('index.php'), y2.url());
  } catch (e) {
    ok('例外なく終わる', false, String(e && e.stack || e));
  } finally {
    fs.writeFileSync(CONFIG, orig);
    await new Promise(r => setTimeout(r, 3000)); // 次のテストが、元に戻した設定を読めるように
    try { sql('UPDATE users SET portal_linked_at = NULL'); } catch (e) { /* 次のテストでデータベースは作り直される */ }
    if (b) await b.close();
  }
  console.log(fails ? 'NG ' + fails : 'すべて成功'); process.exit(fails ? 1 : 0);
})();
