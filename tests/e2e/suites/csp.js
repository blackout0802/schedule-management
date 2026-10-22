const { chromium } = require(process.env.NODE_PATH + '/playwright');
(async () => { const b = await chromium.launch(); const p = await (await b.newContext()).newPage(); const msgs = [];
p.on('console', m => { if (/Content Security|Refused/i.test(m.text())) msgs.push(m.text().slice(0, 160)); });
await p.goto('http://127.0.0.1:8099/login.php'); await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=password]', 'adminpass1');
await Promise.all([p.waitForURL('**/index.php'), p.click('button[type=submit]')]); await p.waitForSelector('.cal');
await p.click('.toolbar .seg label:has-text("リスト")'); await p.waitForSelector('.kanban'); await p.goto('http://127.0.0.1:8099/backup.php'); await p.waitForSelector('h1');
console.log('CSP violations:', msgs.length, msgs); await b.close(); })();
