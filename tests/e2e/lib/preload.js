// 画面テスト用: 設定のページの項目は、ふだん畳んである（見出しを押すと開く）。
// 多くのテストは、項目の中身を直接確かめるので、パソコン幅（640px超）では「すべて開いた状態」にしておく。
// （畳んだ状態の確認は、collapse.js が、この設定を外して行う）
const Module = require('module');
const origRequire = Module.prototype.require;
let patched = false;
Module.prototype.require = function (request) {
  const m = origRequire.apply(this, arguments);
  if (!patched && /(^|\/)playwright$/.test(request) && m && m.chromium && typeof m.chromium.launch === 'function') {
    patched = true;
    const launch = m.chromium.launch.bind(m.chromium);
    m.chromium.launch = async function (...a) {
      const browser = await launch(...a);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async function (...b) {
        const ctx = await newContext(...b);
        await ctx.addInitScript(() => { try { if (Math.min(window.innerWidth, screen.width) > 640 && !sessionStorage.getItem('e2e.keepCollapsed') && localStorage.getItem('sched.setOpen') === null) localStorage.setItem('sched.setOpen', '"all"'); } catch (e) {} });
        return ctx;
      };
      return browser;
    };
  }
  return m;
};
