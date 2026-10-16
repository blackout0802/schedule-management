// 繰り返し業務の画面を開く（右上のボタンは、なくなった。予定の追加画面の「登録済みの繰り返しを見る・変える」のリンクから開く）
module.exports = async function openSeries(page) {
  await page.keyboard.press('n'); await page.waitForSelector('.modal input[name=title]');
  await page.click('.modal a:has-text("登録済みの繰り返しを見る・変える")');
  await page.waitForFunction(() => document.querySelector('.modal') && !document.querySelector('.modal input[name=title]'));
};
