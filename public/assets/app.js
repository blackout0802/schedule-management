// スケジュール管理アプリの画面。外部ライブラリは使いません。
(function () {
  'use strict';

  var SHARE = window.SCHEDULE_SHARE || null; // 共有リンクの閲覧ページ（ログイン不要・閲覧専用）
  var FAMILY = !!(SHARE && SHARE.kind === 'family'); // 家族用: 更新履歴・「前回見たとき」からの更新の目印がある
  var root = document.getElementById('app');
  var csrf = root.getAttribute('data-csrf');
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];
  var RULE_NAMES = {
    day: '毎月○日',
    weekday_nth: '毎月 第○○曜日',
    first_bizdays: '月初の○営業日',
    range: '毎月○日〜○日の期間',
    last_bizday: '毎月の最終営業日',
    weekly: '毎週・隔週 ○曜日'
  };

  var S = {
    me: null, view: 'team', year: 0, month: 0, mode: 'cal', todos: [], done: [], others: { todos: [], done: [] }, drag: null, revEv: null, revTd: null, pendEv: false, pendTd: false, memo: null,
    events: [], holidays: {}, cache: {}, tdCache: {}, loading: false,
    page: !SHARE && location.hash === '#settings' ? 'settings' : 'main' // 'settings' = 設定のページ（URL の #settings）
  };

  /* ---------- 小さな道具 ---------- */
  function el(tag, props) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, c) {
    if (c === undefined || c === null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(node, x); });
    else node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- 時刻の入力 ----------
     ブラウザ標準の時刻欄（上下にスクロールして選ぶ形）は、PCでは動きが重く選びにくい。
     PCでは「文字で打つ（9 / 930 / 9:30 / 21時30分 など）＋候補から選ぶ」形にする。
     スマホなど指で操作する端末では、その端末の標準の時刻選択を使う。 */
  function normTime(raw) {
    var t = String(raw || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[：︰]/g, ':').replace(/\s+/g, '').replace(/時/g, ':').replace(/分/g, '').replace(/[.．]/g, ':').replace(/:$/, '');
    var h, m, x;
    if ((x = /^(\d{1,2})$/.exec(t))) { h = +x[1]; m = 0; }
    else if ((x = /^(\d{1,2})(\d{2})$/.exec(t))) { h = +x[1]; m = +x[2]; }
    else if ((x = /^(\d{1,2}):(\d{1,2})$/.exec(t))) { h = +x[1]; m = +x[2]; }
    else return null;
    return h <= 23 && m <= 59 ? pad(h) + ':' + pad(m) : null;
  }
  function timeVal(inp) {
    var v = inp.value.trim();
    if (v === '') return '';
    var n = normTime(v);
    if (n) { inp.value = n; return n; }
    return v; // 読み取れない入力は、そのまま送って、サーバーの案内（09:30 の形式で…）を出す
  }
  function timeInput(name, value) {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return el('input', { type: 'time', name: name, value: value || '' });
    if (!document.getElementById('time-list')) {
      var dl = el('datalist', { id: 'time-list' });
      for (var i = 0; i < 48; i++) { var k = (i + 12) % 48; dl.appendChild(el('option', { value: pad(Math.floor(k / 2)) + ':' + (k % 2 ? '30' : '00') })); } // 6:00 から始めて、朝の時間が上に来る
      document.body.appendChild(dl);
    }
    var inp = el('input', { type: 'text', name: name, value: value || '', list: 'time-list', autocomplete: 'off', placeholder: '例 9:30', maxlength: '8', inputmode: 'text' });
    inp.addEventListener('change', function () { timeVal(inp); });
    return inp;
  }
  /* 画面の色: 自動（端末の設定に合わせる）／ライト／ダーク。端末ごとに覚える */
  function applyTheme() {
    var t = store('sched.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  }
  function openThemeDialog() {
    var cur = store('sched.theme'); cur = cur === 'light' || cur === 'dark' ? cur : 'auto';
    var opts = [['auto', '自動（端末の設定に合わせる）'], ['light', 'ライト（白い背景）'], ['dark', 'ダーク（黒い背景）']];
    var body = el('div', { class: 'form' },
      el('p', { class: 'hint', text: '「自動」では、スマホやパソコンがダークモードのとき、黒い背景になります。この端末だけの設定です。' }),
      opts.map(function (o) {
        return el('label', { class: 'check theme-opt' }, el('input', { type: 'radio', name: 'theme', value: o[0], checked: cur === o[0], onchange: function () { store('sched.theme', o[0]); applyTheme(); } }), ' ' + o[1]);
      }),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
    var ov = openModal('画面の色', body);
    ov.outsideClose = true;
  }
  function NARROW() { return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches); } // スマホの幅
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function mdw(s) { var d = parse(s); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）'; }
  function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } }

  function api(action, opts) {
    opts = opts || {};
    var qs = Object.keys(opts.params || {}).map(function (k) { return '&' + k + '=' + encodeURIComponent(opts.params[k]); }).join('');
    var init = { method: opts.body ? 'POST' : 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body) { init.headers['Content-Type'] = 'application/json'; init.headers['X-CSRF-Token'] = csrf; init.body = JSON.stringify(opts.body); }
    if (opts.form) { init.method = 'POST'; init.headers['X-CSRF-Token'] = csrf; init.body = opts.form; } // 画像つき（FormData）。Content-Type は、ブラウザが決める
    var url = SHARE ? 'share_api.php?t=' + encodeURIComponent(SHARE.token) + '&action=' + action + qs : 'api.php?action=' + action + qs;
    return fetch(url, init).then(function (r) {
      if (r.status === 401) { if (!opts.quiet) location.href = 'login.php'; throw new Error('login'); }
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'エラーが発生しました'); return j; });
    });
  }
  function toast(msg) {
    var t = el('div', { class: 'toast', role: 'status', text: msg });
    var n = document.querySelectorAll('.toast').length;
    t.style.bottom = (16 + n * 46) + 'px'; // 同時に複数出ても重ならないよう、下から積み上げる
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2800);
  }
  /* 「元に戻す」つきの通知（9秒）。ボタンを押すと doUndo を呼ぶ */
  function toastUndo(msg, doUndo) {
    var t = el('div', { class: 'toast with-action', role: 'status' }, el('span', { text: msg }),
      el('button', { type: 'button', class: 'toast-act', text: '元に戻す', onclick: function () { t.remove(); doUndo(); } }));
    var n = document.querySelectorAll('.toast').length;
    t.style.bottom = (16 + n * 46) + 'px';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 9000);
  }
  function fail(e) { if (e.message !== 'login') toast(e.message); }

  /* ---------- モーダル ---------- */
  var modals = [];
  /* 設定のページでは、各設定の画面を、ポップアップではなく、ページの中に並べて出す（embedHost に入れ先をセットして呼ぶと、最初の openModal だけがそこに入る） */
  var embedHost = null;
  function embedInto(host, body, rerender) {
    host.appendChild(body);
    var ov = { embedded: true, locked: false, close: rerender };
    var prune = function () { // ページの中では「閉じる」は要らない
      host.querySelectorAll('button').forEach(function (b) { if (b.textContent === '閉じる') b.remove(); });
    };
    prune();
    new MutationObserver(prune).observe(host, { childList: true, subtree: true });
    return ov;
  }
  function openModal(title, body, wide, locked) {
    if (embedHost) { var host = embedHost.host, re = embedHost.rerender; embedHost = null; return embedInto(host, body, re); }
    var ov = el('div', { class: 'overlay' });
    ov.locked = !!locked; // true の間は ✕・Esc・外側クリックで閉じられない
    var close = function () { ov.remove(); modals = modals.filter(function (m) { return m !== ov; }); setTimeout(maybeRefresh, 0); };
    var box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('h3', null, el('span', { text: title }), locked ? null : el('button', { class: 'btn small ghost', type: 'button', 'aria-label': '閉じる', onclick: close, text: '✕' })),
      body);
    ov.appendChild(box);
    // 入力画面は、外側をクリックしても閉じない（入力中の内容を、うっかり消さないため）。保存・キャンセル・✕・Esc で閉じる。
    // 読むだけの画面（予定の詳細）だけ、外側のクリックでも閉じる
    ov.addEventListener('mousedown', function (e) { if (e.target === ov && !ov.locked && ov.outsideClose) close(); });
    document.body.appendChild(ov);
    modals.push(ov);
    var f = box.querySelector('input:not([type=radio]):not([disabled]), select, textarea');
    if (f) f.focus();
    ov.close = close;
    return ov;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modals.length && !modals[modals.length - 1].locked) modals[modals.length - 1].close();
    else if (e.key === 'Escape' && !modals.length && document.getElementById('todo-panel')) closeTodoPanel(true);
  });

  /* ---------- 予定の色（本人の画面だけ） ----------
     単発の業務・繰り返しの業務・休み・プライベートの色を、本人が選べる。選んだ色は、文字（塗りつぶし）の色になり、淡い背景は、その色から作る。
     ダークモードでは、暗い色が読めなくなるので、選んだ色を明るい側へ寄せて表示する。 */
  var COLOR_DEFS = [
    ['work', '単発の業務', 'bar work', '打ち合わせの準備'], ['rec', '繰り返しの業務', 'bar work rec', '↻ 毎月の締め'],
    ['off', '休み', 'bar off', '山田 花子 有給'], ['private', 'プライベート', 'bar private', '歯医者の予約']
  ];
  /* 候補の色: 17色相 × 3段階（淡い・標準・鮮やか）。縦に3段で並べる。どれも明るい色で、濃い文字が読める */
  var COLOR_PRESETS = [
    '#fccfcf', '#f5a3a3', '#ee7777',   '#fcdbcf', '#f5b9a3', '#ee9777',   '#fce6cf', '#f5cca3', '#eeb277',   '#fcf1cf', '#f5e0a3', '#eed077',
    '#fbfccf', '#f2f5a3', '#eaee77',   '#e6fccf', '#ccf5a3', '#b3ee77',   '#cffcd6', '#a3f5b1', '#77ee8b',   '#cffced', '#a3f5da', '#77eec6',
    '#cffcfc', '#a3f5f5', '#77eeee',   '#cff0fc', '#a3dff5', '#77ceee',   '#cfe4fc', '#a3c9f5', '#77afee',   '#cfd8fc', '#a3b4f5', '#778fee',
    '#d8cffc', '#b4a3f5', '#8f77ee',   '#e7cffc', '#cfa3f5', '#b677ee',   '#f6cffc', '#eaa3f5', '#de77ee',   '#fccfed', '#f5a3da', '#ee77c6',
    '#f1f3f5', '#dee2e6', '#adb5bd'
  ];
  var COLOR_NAMES = ['赤', '朱', '橙', '黄', '黄緑', '若草', '緑', '青緑', '水', '空', '青', '藍', '青紫', '紫', '赤紫', '桃', '灰'];
  var TONE_NAMES = ['淡い', '標準', '鮮やか'];
  /* 選んだ色は、帯の背景の色になる（明るい色を選べる）。文字の色は、背景の色と連動して決まる:
     背景と同じ色相で、十分に読める濃さ（明るい背景なら濃い色、暗い背景なら淡い色）。 */
  function hexRgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbHex(rgb) { return '#' + rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
  function rgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, sat = 0;
    if (mx !== mn) {
      var d = mx - mn;
      sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, sat, l];
  }
  function hslToRgb(h, sat, l) {
    var c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function inkFor(hex) {
    var bg = hexRgb(hex), hsl = rgbToHsl(bg), sat = Math.min(0.75, hsl[1]);
    var light = contrastRatio(bg, [255, 255, 255]) > contrastRatio(bg, [20, 32, 51]); // 暗い背景には、淡い文字
    var best = null, bestC = 0;
    for (var k = 0; k <= 40; k++) {
      var l = light ? 0.8 + k * 0.005 : 0.36 - k * 0.008;
      var rgb = hslToRgb(hsl[0], sat, Math.max(0, Math.min(1, l))), c = contrastRatio(bg, rgb);
      if (c > bestC) { best = rgb; bestC = c; }
      if (c >= 7) return rgbHex(rgb); // 読みやすさの目安（7以上）を満たす、いちばん背景に近い（色味の残る）濃さ
    }
    return rgbHex(best);
  }
  /* 色の設定から、CSSの変数（--ub-* 背景、--uc-* 文字、--ur-* 重要な予定の縁取り）を作る。未設定の項目は作らない（標準の色になる） */
  function colorVars(colors) {
    var v = {};
    COLOR_DEFS.forEach(function (d) {
      var c = colors && colors[d[0]];
      if (!c) return;
      var ink = inkFor(c);
      v['--ub-' + d[0]] = c;
      v['--uc-' + d[0]] = ink;
      v['--ur-' + d[0]] = '0 0 0 2px ' + ink + ' inset'; // 重要な予定は、背景の色はそのまま、太字＋★＋縁取りで目立たせる
    });
    // 繰り返しの業務を決めていないときは、単発の業務の色にそろえる（別々の色の文字が読めなくなるのを防ぐ）
    if (colors && colors.work && !colors.rec) { v['--ub-rec'] = v['--ub-work']; v['--uc-rec'] = v['--uc-work']; v['--ur-rec'] = v['--ur-work']; }
    return v;
  }
  /* 予定の持ち主が決めた色を、その予定の帯だけに当てる（全員の画面で、その人の予定が、その人の色になる） */
  function eventColorStyle(e) {
    var v = colorVars(e.colors);
    return Object.keys(v).map(function (k) { return ';' + k + ':' + v[k]; }).join('');
  }
  function parseRgb(str) {
    var m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(str) || null;
    if (m) return [+m[1], +m[2], +m[3]];
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(str); // color-mix の結果は、この形で返ることがある
    return m ? [Math.round(m[1] * 255), Math.round(m[2] * 255), Math.round(m[3] * 255)] : null;
  }
  function contrastRatio(a, b) {
    var l = function (rgb) { var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    var x = l(a), y = l(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /* 休みの人がいる日のセルを薄く塗りつぶす設定（本人の画面だけ）。標準の色は、休みの色（緑）の薄い色 */
  function offdayPref() { var o = S.me && S.me.prefs && S.me.prefs.offday; return o ? { on: o.on !== false, color: o.color || '' } : { on: true, color: '' }; }
  function offdayBg(c) { return c ? 'color-mix(in srgb, ' + c + ' 55%, var(--surface))' : ''; }
  function openColorDialog() {
    var pending = {};
    COLOR_DEFS.forEach(function (d) { pending[d[0]] = (S.me.prefs && S.me.prefs.colors && S.me.prefs.colors[d[0]]) || ''; });
    var pOff = offdayPref();
    var rows = el('div', { class: 'cs-rows' });
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    function styleOf() { var v = colorVars(pending); return Object.keys(v).map(function (k) { return k + ':' + v[k]; }).join(';'); }
    function draw() {
      rows.textContent = '';
      COLOR_DEFS.forEach(function (d) {
        var key = d[0], cur = pending[key];
        var sample = el('div', { class: 'cs-sample', style: styleOf() }, el('div', { class: d[2], text: d[3] }));
        var warn = el('span', { class: 'cs-warn', hidden: true, text: '⚠ 背景と色が近く、読みにくいかもしれません' });
        var sw = el('div', { class: 'cs-sw' }, el('div', { class: 'pal', role: 'group', 'aria-label': d[1] + 'の色の候補' }, COLOR_PRESETS.map(function (c, i) {
          var nm = COLOR_NAMES[Math.floor(i / 3)] + '（' + TONE_NAMES[i % 3] + '）';
          return el('button', { type: 'button', class: 'sw', style: 'background:' + c, 'aria-label': nm + ' ' + c, 'aria-pressed': cur === c ? 'true' : 'false', title: nm + ' ' + c, onclick: function () { pending[key] = c; draw(); } });
        })), el('input', { type: 'color', 'aria-label': d[1] + 'の色を自由に選ぶ', value: cur || '#cfe4fc', onchange: function () { pending[key] = this.value.toLowerCase(); draw(); } }),
          el('button', { type: 'button', class: 'btn small', text: '標準に戻す', disabled: !cur, onclick: function () { pending[key] = ''; draw(); } }));
        rows.appendChild(el('div', { class: 'cs-row' }, el('div', { class: 'cs-top' }, el('span', { class: 'cs-name', text: d[1] }), warn), sw, sample));
        var bar = sample.querySelector('.bar'), cs = getComputedStyle(bar), fg = parseRgb(cs.color), bg = parseRgb(cs.backgroundColor);
        if (cur && fg && bg && contrastRatio(fg, bg) < 4.5) warn.hidden = false;
      });
      // 休みの人がいる日のセル
      var cell = el('div', { class: 'cs-sample' }, el('div', { class: 'cell' + (pOff.on ? ' offday' : ''), style: pOff.color ? '--offday-bg:' + offdayBg(pOff.color) : null }, el('div', { class: 'num' }, el('span', { class: 'd', text: '14' })), el('div', { class: 'bar off', text: '山田 花子 有給' })));
      var onCb = el('input', { type: 'checkbox', checked: pOff.on, onchange: function () { pOff.on = this.checked; draw(); } });
      var osw = el('div', { class: 'cs-sw' }, el('div', { class: 'pal', role: 'group', 'aria-label': '休みの人がいる日のセルの色の候補' }, COLOR_PRESETS.map(function (c, i) {
        var nm = COLOR_NAMES[Math.floor(i / 3)] + '（' + TONE_NAMES[i % 3] + '）';
        return el('button', { type: 'button', class: 'sw', disabled: !pOff.on, style: 'background:' + c, 'aria-label': nm + ' ' + c, 'aria-pressed': pOff.color === c ? 'true' : 'false', title: nm + ' ' + c, onclick: function () { pOff.color = c; draw(); } });
      })), el('input', { type: 'color', disabled: !pOff.on, 'aria-label': '休みの人がいる日のセルの色を自由に選ぶ', value: pOff.color || '#cfe4fc', onchange: function () { pOff.color = this.value.toLowerCase(); draw(); } }),
        el('button', { type: 'button', class: 'btn small', text: '標準に戻す', disabled: !pOff.on || !pOff.color, onclick: function () { pOff.color = ''; draw(); } }));
      rows.appendChild(el('div', { class: 'cs-row' }, el('div', { class: 'cs-top' }, el('span', { class: 'cs-name', text: '休みの人がいる日（カレンダーのセル）' })),
        el('label', { class: 'check' }, onCb, ' 休みの人がいる日のセルを、薄く塗りつぶす'), osw, cell));
    }
    draw();
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('prefs_save', { body: { colors: pending, offday: pOff } }).then(function (j) {
        S.me.prefs = j.prefs; ov.close(); toast('色を保存しました'); load(); // 自分の予定の色が変わるので、予定を読み直す（他の人の画面にも、自動で反映される）
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('p', { class: 'hint', text: 'あなたの予定の色を決めます。保存すると、他の人の画面（共有リンクを含む）でも、あなたの予定がこの色で表示されます。選んだ色が、予定の帯の背景の色になり、文字は、読みやすい濃さに自動で変わります。重要な予定は、太字・★・縁取りで目立ちます。プライベートの予定の色は、あなたの画面だけです。' }),
      rows, err,
      el('div', { class: 'actions' },
        el('button', { class: 'btn left', type: 'button', text: 'すべて標準に戻す', onclick: function () { COLOR_DEFS.forEach(function (d) { pending[d[0]] = ''; }); pOff = { on: true, color: '' }; draw(); } }),
        el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '保存' })));
    var ov = openModal('予定の色の設定', form, true);
  }

  /* ---------- ショートカットキー ----------
     c カレンダー / l リスト / t 今日 / ← → 前の月・次の月 / n 予定を追加 / b 業務版 / p プライベート版 / ? 一覧
     入力欄に文字を打っているとき、ダイアログを開いているとき、Ctrl・Alt・Command を押しているときは、動かさない。
     日本語入力がオンでも動くよう、文字ではなく、キーの位置（KeyC など）で判定する。 */
  var SHORTCUTS = [
    ['c', 'カレンダーを表示'], ['g', '休み表（人×日）を表示（業務版）'], ['l', 'リストを表示'], ['t', '今月に戻る（今日）'], ['← / →', '前の月 / 次の月'],
    ['n', '予定を追加'], ['d', 'ToDoを表示・閉じる（カレンダー）'], ['s', 'システム更新（管理者のみ）'], ['b', '業務版に切り替え'], ['p', 'プライベート版に切り替え'], ['?', 'このショートカット一覧']
  ];
  function shortcutKey(e) {
    var m = /^Key([A-Z])$/.exec(e.code || '');
    if (m) return m[1].toLowerCase();
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') return e.code;
    if (e.key === '?' || e.key === '？' || (e.code === 'Slash' && e.shiftKey)) return '?';
    return '';
  }
  function openShortcuts() {
    if (modals.some(function (m) { return m.shortcuts; })) return;
    var rows = SHORTCUTS.filter(function (s) { return s[0] !== 's' || S.me.user.role === 'admin'; }).map(function (s) { return el('tr', null, el('th', { scope: 'row' }, el('kbd', { text: s[0] })), el('td', { text: s[1] })); });
    var body = el('div', { class: 'form' }, el('table', { class: 't sc-table' }, el('tbody', null, rows)),
      el('p', { class: 'hint', text: '入力欄に文字を打っているときと、ダイアログを開いているときは、使えません。' }),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
    var ov = openModal('ショートカットキー', body);
    ov.shortcuts = true; ov.outsideClose = true;
  }
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || !S.me || modals.length) return;
    var a = document.activeElement, tag = a && a.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return;
    var k = shortcutKey(e);
    if (!k) return;
    if (S.page === 'settings') { // 設定のページ: カレンダーに関わるキーは、カレンダーに戻ってから動かす。それ以外（予定の追加など）は動かさない
      if (['c', 'g', 'l', 't', 'b', 'p', 'ArrowLeft', 'ArrowRight'].indexOf(k) >= 0) leaveSettings(); else if (k !== '?' && k !== 's') return;
    }
    var done = true;
    if (k === 'c') setMode('cal');
    else if (k === 'g' && !SHARE && S.view === 'team') setMode('grid');
    else if (k === 'l' && !FAMILY) setMode('list');
    else if (k === 't') goToday();
    else if (k === 'ArrowLeft') navMonth(-1);
    else if (k === 'ArrowRight') navMonth(1);
    else if (k === '?') openShortcuts();
    else if (!SHARE && k === 'n') openEventDialog(null, ymd(new Date()));
    else if (!SHARE && k === 'd' && S.mode === 'cal') { if (document.getElementById('todo-panel')) closeTodoPanel(true); else openTodoPanel(); }
    else if (!SHARE && k === 's' && S.me.user.role === 'admin') location.href = 'update.php';
    else if (!SHARE && k === 'b') setView('team');
    else if (!SHARE && k === 'p') setView('me');
    else done = false;
    if (done) e.preventDefault();
  });

  /* ---------- 画面の骨組み ---------- */
  /* 共有リンクの閲覧ページ: 月の移動と、予定の詳細を見るだけ。編集・ToDo・メモは無い */
  function renderShareShell() {
    root.textContent = '';
    root.appendChild(el('header', { class: 'topbar' }, el('div', { class: 'topbar-in' }, el('span', { class: 'brand', text: S.shareTitle }), el('button', { class: 'btn small', type: 'button', text: 'ホーム画面に追加', onclick: openInstallHelp }), el('button', { class: 'btn small', type: 'button', text: '画面の色', title: 'ライト（白い背景）／ダーク（黒い背景）', onclick: openThemeDialog }))));
    root.appendChild(el('main', null, el('div', { id: 'toolbar' }), el('div', { class: 'layout single' }, el('div', { id: 'board', class: 'board' }))));
    renderToolbar();
  }

  /* スマホ幅か（画面を縦に長くしないため、説明文を畳むなどに使う） */
  function isPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches); }
  /* 長い説明文。パソコンでは、そのまま見せる。スマホでは「ⓘ 使い方」に畳んで、画面を広く使う */
  function helpText(text) {
    var p = el('p', { class: 'hint', text: text });
    if (!isPhone()) return p;
    return el('details', { class: 'help-sm' }, el('summary', { text: 'ⓘ 使い方' }), p);
  }

  function renderShell() {
    if (SHARE) return renderShareShell();
    flushMemo();
    if (S.page === 'settings') return renderSettingsPage();
    root.textContent = '';
    /* 右上のメニュー: 「設定」ボタン（設定の項目）と、ユーザー名のボタン（パスワード・ログアウト）。同時に開くのは1つだけ */
    var openMenus = [];
    function closeAllMenus() { openMenus.slice().forEach(function (m) { m(); }); }
    function makeMenu(label, itemsFn, extraClass) {
      var list = null;
      var btn = el('button', { class: 'btn small uname', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: label });
      function close() { if (list) { list.remove(); list = null; btn.setAttribute('aria-expanded', 'false'); openMenus = openMenus.filter(function (f) { return f !== close; }); } }
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (list) return close();
        closeAllMenus();
        list = el('div', { class: 'menu-list' }, itemsFn(close));
        btn.parentNode.appendChild(list);
        btn.setAttribute('aria-expanded', 'true');
        openMenus.push(close);
      });
      return el('div', { class: 'menu' + (extraClass ? ' ' + extraClass : '') }, btn);
    }
    var item = function (text, fn, close, title) { return el('button', { type: 'button', text: text, title: title || null, onclick: function () { close(); fn(); } }); };
    var settingsMenu = el('div', { class: 'menu' }, el('button', { class: 'btn small', type: 'button', 'aria-label': '設定', title: '設定のページを開く', onclick: function (e) { e.stopPropagation(); openSettingsPage(); } }, '⚙', el('span', { class: 'lbl', text: ' 設定' })));
    var userMenu = makeMenu(S.me.user.name + ' ▾', function (close) {
      return [item('パスワードの変更', openPasswordDialog, close), item('ログアウト', doLogout, close)];
    });
    document.addEventListener('click', closeAllMenus);

    var tabs = el('div', { class: 'tabs', role: 'tablist' },
      ['team', 'me'].map(function (v) {
        return el('button', { class: 'tab', type: 'button', role: 'tab', 'data-view': v, 'aria-selected': S.view === v ? 'true' : 'false',
          text: v === 'team' ? '業務版' : 'プライベート版', title: (v === 'team' ? '業務版（b）' : 'プライベート版（p）'), onclick: function () { setView(v); } });
      }));

    root.appendChild(el('header', { class: 'topbar' }, el('div', { class: 'topbar-in' },
      el('span', { class: 'brand' }, S.me.app_name, el('span', { class: 'ver', text: 'v' + S.me.app_version, title: 'このアプリのバージョン' })), tabs, el('span', { class: 'spacer' }),
      settingsMenu, userMenu)));
    root.appendChild(el('main', null, el('div', { id: 'toolbar' }),
      el('div', { class: 'layout' }, el('div', { id: 'board', class: 'board' }),
        el('div', { class: 'side' }, el('aside', { id: 'todo', class: 'todo', 'aria-label': 'ToDoリスト' }), el('section', { id: 'memo', class: 'todo memo', 'aria-label': 'メモ（日報用）' })))));
    renderToolbar();
    loadTodos();
    renderMemo();
  }

  /* ---------- 設定のページ ----------
     「設定」を押すと、ポップアップではなく、1つの大きなページに、すべての設定が項目ごとに並ぶ（URL は #settings。戻るボタンで、カレンダーに戻れる）。
     各項目は、これまでのポップアップの画面を、そのままページの中に埋め込んでいる（embedHost）。 */
  function openSettingsPage() { location.hash = 'settings'; }
  function leaveSettings() { // カレンダーに戻る（ショートカットキーからも使う）
    if (S.page !== 'settings') return;
    S.page = 'main';
    if (location.hash === '#settings') history.pushState(null, '', location.pathname + location.search);
    renderShell(); load();
  }
  window.addEventListener('hashchange', function () {
    if (SHARE || !S.me) return;
    var want = location.hash === '#settings' ? 'settings' : 'main';
    if (want === S.page) return;
    S.page = want; renderShell(); if (want === 'main') load();
  });
  function settingsSections() {
    var admin = S.me.user.role === 'admin';
    var list = [
      { id: 'theme', title: '画面の色（ライト／ダーク）', build: openThemeDialog },
      { id: 'install', title: 'ホーム画面に追加（スマホ）', build: openInstallHelp },
      { id: 'colors', title: '予定の色', build: openColorDialog },
      { id: 'series', title: '繰り返し業務', build: openSeriesDialog },
      { id: 'share', title: '共有リンク（家族・会社へ）', build: openShareDialog },
      { id: 'shortcuts', title: 'ショートカットキー', build: openShortcuts },
      { id: 'password', title: 'パスワードの変更', build: function () { openPasswordDialog(false); } }
    ];
    if (admin) {
      list.push({ id: 'users', title: '社員の管理', admin: true, build: openUsersDialog },
        { id: 'holidays', title: '会社の休業日', admin: true, build: openHolidaysDialog },
        { id: 'slack', title: 'Slack通知の送り先・テスト', admin: true, build: openSlackDialog },
        { id: 'slackcfg', title: 'Slack通知の時間・文面', admin: true, build: openSlackCfgDialog },
        { id: 'audit', title: '変更履歴', admin: true, build: openAuditPanel },
        { id: 'usage', title: '利用状況', admin: true, build: openUsageDialog },
        { id: 'guide', title: '運用の手引き', admin: true, build: function () {
          openModal('運用の手引き', el('div', { class: 'form' },
            el('p', { class: 'hint', text: '社員の追加と停止、パスワードを忘れたとき、システム更新、バックアップと復元、cron、困ったときの対処を、1ページにまとめました。担当者が代わるときにも、そのまま印刷して渡せます。' }),
            el('div', { class: 'actions', style: 'justify-content:flex-start' }, el('a', { class: 'btn primary', href: 'guide.php', target: '_blank', rel: 'noopener', text: '運用の手引きを開く' }))));
        } },
        { id: 'backup', title: 'バックアップ', admin: true, build: function () {
          openModal('バックアップ', el('div', { class: 'form' },
            el('p', { class: 'hint', text: 'データ（プライベートの予定も含む）を、パスワードで暗号化した1つのファイルに保存します。パスワードを知らない人は、管理者でも中身を見られません。パスワードを忘れると復元できないので、ご注意ください。' }),
            el('div', { class: 'actions', style: 'justify-content:flex-start' }, el('a', { class: 'btn primary', href: 'backup.php', text: 'バックアップの画面を開く' }))));
        } },
        { id: 'update', title: 'システム更新', admin: true, build: function () {
          openModal('システム更新', el('div', { class: 'form' },
            el('p', { class: 'hint', text: '新しい版の更新ファイル（zip）を選んで、システムを更新します。更新の前の状態に戻すこともできます。ショートカットキー「s」でも開けます。' }),
            el('div', { class: 'actions', style: 'justify-content:flex-start' }, el('a', { class: 'btn primary', href: 'update.php', text: 'システム更新の画面を開く' }))));
        } });
    }
    return list;
  }
  /* ---------- ホーム画面に追加（スマホにアプリのアイコンを置く） ---------- */
  function isStandalone() { return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone); }
  function openInstallHelp() {
    var steps = function (title, list) { return el('div', { class: 'inst-box' }, el('h4', { text: title }), el('ol', null, list.map(function (t) { return el('li', { text: t }); }))); };
    var body = el('div', { class: 'form install' },
      isStandalone() ? el('p', { class: 'notice ok-note', text: '✓ いま、ホーム画面のアプリとして開いています。' }) : null,
      el('p', { class: 'hint', text: 'スマホのホーム画面にアイコンを置くと、アプリのように、ブラウザの枠なしで開けます。ログインの状態も、ふだんのブラウザと同じように保たれます。' }),
      steps('iPhone（Safari）', ['Safari で、このページを開く（ほかのブラウザでは、できないことがあります）', '画面の下（または上）の「共有」ボタン（□に↑）を押す', '「ホーム画面に追加」を選ぶ', '右上の「追加」を押す']),
      steps('Android（Chrome）', ['Chrome で、このページを開く', '右上の「︙」（メニュー）を押す', '「ホーム画面に追加」（または「アプリをインストール」）を選ぶ', '「追加」（または「インストール」）を押す']),
      el('p', { class: 'hint', text: SHARE ? 'このページ（共有リンク）を追加すると、アイコンから、この共有ページがそのまま開きます。' : '家族用・会社用の共有リンクのページでも、同じ手順で追加できます（そのページが開くアイコンになります）。' }));
    if (SHARE) { var ov = openModal('ホーム画面に追加', body); ov.outsideClose = true; body.appendChild(el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }))); }
    else openModal('ホーム画面に追加', body);
  }

  /* ---------- 利用状況（管理者）: 最終ログイン・容量・バックアップ・cron・気をつけること ---------- */
  function usageSize(b) { return b >= 1073741824 ? (Math.round(b / 107374182.4) / 10) + ' GB' : b >= 1048576 ? (Math.round(b / 104857.6) / 10) + ' MB' : Math.max(0, Math.round(b / 1024)) + ' KB'; }
  function usageAt(s) { return s ? (+s.slice(5, 7)) + '/' + (+s.slice(8, 10)) + ' ' + s.slice(11, 16) : '—'; }
  function usageAgo(s, now) {
    if (!s) return '記録なし';
    var d = Math.floor((new Date(now.replace(' ', 'T')) - new Date(s.replace(' ', 'T'))) / 86400000);
    return usageAt(s) + (d <= 0 ? '（今日）' : d === 1 ? '（昨日）' : '（' + d + '日前）');
  }
  function openUsageDialog() {
    var body = el('div', { class: 'form usage' }, el('p', { class: 'hint', text: '読み込み中…' }));
    var ov = openModal('利用状況', body, true);
    api('usage_get').then(function (j) {
      var st = j.storage, att = st.attachments, bk = j.backup;
      var sec = function (title, kids) { return el('section', { class: 'usage-sec' }, el('h4', { text: title }), kids); };
      var kv = function (rows) { return el('dl', { class: 'usage-kv' }, rows.map(function (r) { return [el('dt', { text: r[0] }), el('dd', { text: r[1] })]; })); };
      body.textContent = '';
      body.appendChild(el('p', { class: 'hint', text: '数と日時だけを表示します。予定・ToDo・日報の中身や、プライベートの件名は、ここには出ません。' }));
      body.appendChild(sec('気をつけること', j.warnings.length
        ? el('ul', { class: 'usage-warn' }, j.warnings.map(function (w) { return el('li', { class: w.level }, el('span', { class: 'ic', 'aria-hidden': 'true', text: w.level === 'warn' ? '⚠' : 'ℹ' }), el('span', { text: w.text })); }))
        : el('p', { class: 'notice ok-note', text: '✓ 気をつけることはありません。' })));
      body.appendChild(sec('社員（最後にログイン・最後に使った日時）', el('div', { class: 'scroll-x' }, el('table', { class: 't' },
        el('thead', null, el('tr', null, ['名前', '最後にログイン', '最後に使った'].map(function (h) { return el('th', { text: h }); }))),
        el('tbody', null, j.users.map(function (u) {
          return el('tr', { class: u.active ? '' : 'off' },
            el('td', { text: u.name + (u.role === 'admin' ? '（管理者）' : '') + (u.active ? '' : '（停止中）') + (u.must_change ? '（初回パスワード未変更）' : '') }),
            el('td', { text: usageAgo(u.last_login, j.now) }), el('td', { text: usageAgo(u.last_seen, j.now) }));
        }))))));
      var attRows = [['ToDoの画像', att.count + ' 枚 / ' + usageSize(att.bytes)]];
      att.by_user.forEach(function (x) { attRows.push(['　' + x.name, x.count + ' 枚 / ' + usageSize(x.bytes)]); });
      body.appendChild(sec('容量', kv([['データベース（' + (j.db.type || '不明') + '）', j.db.bytes === null ? '調べられませんでした' : usageSize(j.db.bytes)]].concat(attRows, [
        ['自動バックアップの置き場所', st.backups.count + ' 件 / ' + usageSize(st.backups.bytes)],
        ['サーバーの空き', st.disk_free === null ? '調べられませんでした' : usageSize(st.disk_free) + (st.disk_total ? ' / 全体 ' + usageSize(st.disk_total) : '')]]))));
      body.appendChild(sec('バックアップ', kv([
        ['自動バックアップ', bk.auto_enabled ? '設定済み（毎日 3時以降 / ' + bk.auto_files + ' 件 保管、最大 ' + bk.auto_keep + ' 件）' : '設定されていません'],
        ['　最後に作った日時', bk.auto_enabled ? (bk.auto_last ? usageAgo(bk.auto_last, j.now) : 'まだありません') : '—'],
        ['手動（ダウンロード）', bk.manual_last ? usageAgo(bk.manual_last, j.now) : 'まだ一度もありません']])));
      body.appendChild(sec('自動処理（cron）・通知', kv([
        ['通知用 notify（10分おき）', j.cron.notify ? usageAgo(j.cron.notify, j.now) : 'まだ確認できていません'],
        ['繰り返し予定 nightly（毎日）', j.cron.nightly ? usageAgo(j.cron.nightly, j.now) : 'まだ確認できていません'],
        ['Slack通知の送り先', j.slack.configured ? j.slack.name : '未設定']])));
      body.appendChild(sec('件数・システム', kv([
        ['予定 / 繰り返し業務 / ToDo / 日報', j.counts.events + ' / ' + j.counts.series + ' / ' + j.counts.todos + ' / ' + j.counts.memos],
        ['変更履歴', j.counts.audit + ' 件'],
        ['アプリの版 / PHP / DB', 'v' + j.version + ' / ' + j.php + ' / ' + (j.db.type ? j.db.type + ' ' + j.db.version : '不明')],
        ['時間帯 / いまの時刻', j.timezone + ' / ' + j.now.slice(0, 16)]])));
      body.appendChild(el('div', { class: 'actions' }, el('a', { class: 'btn', href: 'guide.php', target: '_blank', rel: 'noopener', text: '運用の手引き' }), el('button', { class: 'btn primary', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
    }).catch(function (e) { ov.close(); fail(e); });
  }

  /* ---------- 変更履歴（管理者）: 誰が・いつ・何を変えたか ---------- */
  function openAuditPanel() {
    var body = el('div', { class: 'form audit' });
    var ov = openModal('変更履歴', body, true);
    var list = el('div', { class: 'audit-list', 'aria-live': 'polite' });
    var more = el('button', { class: 'btn', type: 'button', text: 'さらに読み込む', hidden: true });
    var fType = el('select', { 'aria-label': '種類' }, el('option', { value: '', text: 'すべての種類' }));
    var fActor = el('select', { 'aria-label': '操作した人' }, el('option', { value: '', text: 'すべての人' }), S.me.users.map(function (u) { return el('option', { value: String(u.id), text: u.name }); }));
    var fQ = el('input', { type: 'search', placeholder: '件名・名前・内容で検索', maxlength: '50', 'aria-label': '検索', autocomplete: 'off' });
    var last = 0, timer = null, typesLoaded = false;
    var actLabel = { add: '追加', update: '変更', delete: '削除', reset: 'リセット' };
    function fmt(at) { return (+at.slice(5, 7)) + '/' + (+at.slice(8, 10)) + ' ' + at.slice(11, 16); }
    function item(e) {
      return el('div', { class: 'audit-item ' + e.action },
        el('div', { class: 'au-top' }, el('span', { class: 'au-at', text: fmt(e.at) }), el('span', { class: 'au-actor', text: e.actor }),
          el('span', { class: 'au-type', text: e.type_name }), el('span', { class: 'au-act ' + e.action, text: actLabel[e.action] || e.action })),
        el('div', { class: 'au-main' }, el('span', { class: 'au-label', text: e.label }), e.target ? el('span', { class: 'au-target', text: '　対象: ' + e.target }) : null),
        e.detail ? el('div', { class: 'au-detail', text: e.detail }) : null,
        el('button', { class: 'btn small ghost danger au-del', type: 'button', text: '削除', 'aria-label': 'この履歴を削除', onclick: function () {
          api('audit_delete', { body: { id: e.id } }).then(function () { toast('1件を削除しました'); load(true); }).catch(fail);
        } }));
    }
    function load(reset) {
      if (reset) { last = 0; list.textContent = ''; }
      var params = { limit: '50' };
      if (fType.value) params.type = fType.value;
      if (fActor.value) params.actor = fActor.value;
      if (fQ.value.trim()) params.q = fQ.value.trim();
      if (last) params.before = String(last);
      api('audit_list', { params: params }).then(function (j) {
        if (!typesLoaded) { typesLoaded = true; Object.keys(j.types).forEach(function (k) { fType.appendChild(el('option', { value: k, text: j.types[k] })); }); }
        if (reset && !j.entries.length) list.appendChild(el('p', { class: 'muted', text: '該当する履歴はありません。' }));
        j.entries.forEach(function (e) { list.appendChild(item(e)); last = e.id; });
        more.hidden = !j.has_more;
      }).catch(fail);
    }
    more.addEventListener('click', function () { load(false); });
    [fType, fActor].forEach(function (x) { x.addEventListener('change', function () { load(true); }); });
    fQ.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { load(true); }, 350); });
    body.appendChild(el('p', { class: 'hint', text: '予定（休み・業務）の追加・変更・削除、繰り返し業務、社員の管理、会社の休業日、共有リンク、Slack通知の設定、パスワードの変更を、1年間残します。プライベートの予定・ToDo・日報メモは、記録しません（管理者にも見せない約束のため）。' }));
    body.appendChild(el('div', { class: 'audit-filters' }, fType, fActor, fQ, el('button', { class: 'btn', type: 'button', text: '最新の状態にする', onclick: function () { load(true); } })));
    body.appendChild(list); body.appendChild(el('div', { class: 'actions', style: 'justify-content:center' }, more));
    // まとめて削除（古いものだけ／すべて）。削除したこと自体は、「変更履歴を削除（N件）」として残る
    var olderSel = el('select', { 'aria-label': '削除する期間', style: 'width:auto' },
      [['30', '30日より前'], ['90', '90日より前'], ['180', '半年（180日）より前'], ['365', '1年（365日）より前']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    body.appendChild(el('div', { class: 'audit-bulk' },
      el('b', { text: '履歴を削除する' }),
      el('p', { class: 'hint', style: 'margin:2px 0 6px', text: '削除は元に戻せません。削除したことと、その件数は、新しい履歴として残ります（中身は残りません）。' }),
      el('div', { class: 'audit-bulk-row' }, olderSel,
        el('button', { class: 'btn small danger', type: 'button', text: 'より前の履歴を削除', onclick: function () {
          if (!window.confirm('「' + olderSel.options[olderSel.selectedIndex].text + '」の変更履歴を、すべて削除します。元に戻せません。よろしいですか？')) return;
          api('audit_delete', { body: { older_than_days: Number(olderSel.value) } }).then(function (r) { toast(r.deleted + '件を削除しました'); load(true); }).catch(fail);
        } }),
        el('button', { class: 'btn small danger', type: 'button', text: 'すべて削除', onclick: function () {
          if (!window.confirm('変更履歴を、すべて削除します。元に戻せません。よろしいですか？')) return;
          api('audit_delete', { body: { all: true } }).then(function (r) { toast(r.deleted + '件を削除しました'); load(true); }).catch(fail);
        } }))));
    load(true);
    return ov;
  }

  function renderSettingsPage() {
    root.textContent = '';
    syncTodoHover(); // 右端のToDoの取っ手は、カレンダーのときだけ
    var secs = settingsSections();
    var phone = isPhone();
    var nav = el('nav', { class: 'set-nav', 'aria-label': '設定の項目' });
    var content = el('div', { class: 'set-content' });
    secs.forEach(function (sec) {
      var host = el('div', { class: 'set-body' });
      var head = el('h3', null, sec.title, sec.admin ? el('span', { class: 'pill admin', text: '管理者' }) : null);
      var card = el('section', { class: 'set-sec' + (sec.admin ? ' admin' : '') + (phone ? ' collapsible' : ''), id: 'set-' + sec.id, 'aria-label': sec.title }, head, host);
      if (phone) { // スマホでは、項目を畳んでおく（長いページを、ずっとスクロールしなくて済むように）。見出しを押すと開く
        var toggle = function () { var open = card.classList.toggle('open'); head.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) card.scrollIntoView({ block: 'start' }); };
        head.setAttribute('role', 'button'); head.setAttribute('tabindex', '0'); head.setAttribute('aria-expanded', 'false');
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      }
      var render = function () {
        host.textContent = '';
        sec.t = Date.now();
        embedHost = { host: host, rerender: function () { if (Date.now() - sec.t < 800) return; render(); } }; // 保存・キャンセルのあとは、最新の内容で描き直す
        try { sec.build(); } finally { embedHost = null; }
      };
      content.appendChild(card);
      nav.appendChild(el('a', { href: '#set-' + sec.id, text: sec.title, onclick: function (e) { e.preventDefault(); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));
      render();
    });
    root.appendChild(el('header', { class: 'topbar' }, el('div', { class: 'topbar-in' },
      el('span', { class: 'brand', text: S.me.app_name }),
      el('button', { class: 'btn small', type: 'button', title: 'カレンダー（c）', 'aria-label': 'カレンダーに戻る', onclick: leaveSettings }, '← ', el('span', { class: 'lbl', text: 'カレンダーに' }), '戻る'),
      el('span', { class: 'spacer' }), el('span', { class: 'muted', text: S.me.user.name }),
      el('button', { class: 'btn small', type: 'button', text: 'ログアウト', onclick: doLogout }))));
    root.appendChild(el('main', { class: 'settings-page' }, el('h2', { text: '設定' }), el('div', { class: 'set-layout' }, nav, content)));
    window.scrollTo(0, 0);
  }

  /* 業務版で見る人。'all' = 全社（全員）、数字 = その社員だけ（自分を含む）。いまの社員一覧に無いidは、全社に戻す */
  function whoId() {
    var w = S.who;
    if (!w || w === 'all') return 0;
    return S.me.users.some(function (u) { return String(u.id) === String(w); }) ? +w : 0;
  }
  function whoName() { var id = whoId(); var u = S.me.users.filter(function (x) { return x.id === id; })[0]; return u ? u.name : ''; }

  /* 月の移動・今日・版（業務／プライベート）・「表示する人」の切り替え。ボタンとショートカットキーの両方から使う */
  function navMonth(delta, slide) { var d = new Date(S.year, S.month - 1 + delta, 1); S.year = d.getFullYear(); S.month = d.getMonth() + 1; S.slide = slide ? (delta > 0 ? 'next' : 'prev') : ''; renderToolbar(); load(); }

  /* スマホ: カレンダーを、左右にスワイプして、月を切り替える（左へ＝次の月、右へ＝前の月）。
     縦のスクロール・日付のタップ・入力中・ダイアログを開いている間は、動かさない */
  var swipe = null;
  function swipeTarget(t) { return !!(t && t.closest && t.closest('#board .cal-wrap') && S.mode === 'cal' && S.page !== 'settings' && !modals.length && !S.drag); }
  document.addEventListener('touchstart', function (e) {
    swipe = null;
    if (e.touches.length !== 1 || !swipeTarget(e.target)) return;
    var t = e.touches[0]; swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  document.addEventListener('touchmove', function (e) { if (swipe && e.touches.length !== 1) swipe = null; }, { passive: true });
  document.addEventListener('touchcancel', function () { swipe = null; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    var sw = swipe; swipe = null;
    if (!sw || !e.changedTouches.length || S.mode !== 'cal' || S.page === 'settings' || modals.length || S.drag) return;
    var t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (Date.now() - sw.at > 800 || Math.abs(dx) < Math.max(56, window.innerWidth * 0.16) || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    navMonth(dx < 0 ? 1 : -1, true);
  }, { passive: true });
  function goToday() { var n = new Date(); S.year = n.getFullYear(); S.month = n.getMonth() + 1; renderToolbar(); load(); }
  /* 業務版とプライベート版の切り替え。画面を作り直さず、前に読んだ内容（なければ空の枠）をすぐに出して、あとから最新に差し替える */
  function setView(v) {
    if (S.view === v) return;
    S.view = v; store('sched.view', v);
    if (v !== 'team' && S.mode === 'grid') S.mode = 'cal'; // 休み表は、業務版だけ
    if (S.page === 'settings' || SHARE) { renderShell(); load(); return; }
    document.querySelectorAll('.tabs .tab').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-view') === v ? 'true' : 'false'); });
    var c = S.cache[evKey(evParams())];
    if (c) applyEvents(c); else { S.events = []; S.summary = null; }
    var t = S.tdCache[v];
    if (t) applyTodos(t); else { S.todos = []; S.done = []; S.others = { todos: [], done: [] }; }
    renderToolbar(); renderBoard(); renderTodo();
    load(); loadTodos();
  }
  function selectWho(val) { S.who = val; renderToolbar(); load(); } // 開き直すと、自分に戻る（覚えない）

  function renderToolbar() {
    var tb = document.getElementById('toolbar');
    tb.textContent = '';
    var todoOnly = !SHARE && S.mode === 'list'; // リストは、ToDoだけ（月の移動・表示する人は要らない）
    tb.appendChild(el('div', { class: 'toolbar' + (todoOnly ? ' todo-only' : '') },
      todoOnly ? null : el('button', { class: 'btn', type: 'button', 'aria-label': '前の月', title: '前の月（←）', text: '‹', onclick: function () { navMonth(-1); } }),
      el('h2', { text: todoOnly ? 'ToDo' + (S.view === 'team' ? '（業務）' : '（プライベート）') : S.year + '年' + S.month + '月' }),
      todoOnly ? null : el('button', { class: 'btn', type: 'button', 'aria-label': '次の月', title: '次の月（→）', text: '›', onclick: function () { navMonth(1); } }),
      todoOnly ? null : el('button', { class: 'btn', type: 'button', title: '今月へ戻る（t）', text: '今日', onclick: goToday }),
      el('span', { class: 'spacer', style: 'flex:1' }),
      el('span', { class: 'tb-break' }), // スマホでは、ここで行を分ける
      SHARE || todoOnly || S.view !== 'team' || S.mode === 'grid' ? null : el('label', { class: 'who' }, el('span', { class: 'lbl', text: '表示する人' }),
        el('select', { id: 'who-sel', 'aria-label': '表示する人', onchange: function () { selectWho(this.value); } },
          el('option', { value: 'all', text: '全社（全員）', selected: !whoId() }),
          el('option', { value: String(S.me.user.id), text: '自分', selected: whoId() === S.me.user.id }),
          S.me.users.filter(function (u) { return u.id !== S.me.user.id; }).map(function (u) { return el('option', { value: String(u.id), text: u.name, selected: whoId() === u.id }); }))),
      SHARE && SHARE.kind === 'family' ? null : el('div', { class: 'seg', role: 'group', 'aria-label': '表示の切り替え' },
        [['cal', 'カレンダー']].concat(!SHARE && S.view === 'team' ? [['grid', '休み表']] : [], [['list', 'リスト']]).map(function (m) {
          return el('label', { class: 'work', title: m[0] === 'cal' ? 'カレンダー（c）' : m[0] === 'grid' ? '休み表: 人×日（g）' : 'リスト（l）' }, el('input', { type: 'radio', name: 'mode', checked: S.mode === m[0], onchange: function () { setMode(m[0]); } }), m[1]);
        })),
      todoOnly && !SHARE ? el('div', { class: 'seg pane-seg', role: 'group', 'aria-label': 'ToDoと日報' }, [['todo', 'ToDo'], ['memo', '日報メモ']].map(function (m) {
        return el('label', { class: 'work' }, el('input', { type: 'radio', name: 'pane', checked: (S.pane || 'todo') === m[0], onchange: function () { S.pane = m[0]; var lay = document.querySelector('.layout'); if (lay) lay.setAttribute('data-pane', m[0]); } }), m[1]);
      })) : null,
      SHARE ? null : el('button', { class: 'btn', type: 'button', title: '毎月くり返す業務を登録・変更する（請求処理、棚卸し、25日の提出など）', onclick: function () { openSeriesDialog(); } }, '↻ 繰り返し', el('span', { class: 'lbl', text: '業務' }))
    ));
    if (!todoOnly && S.mode !== 'grid') tb.appendChild(el('div', { class: 'view-banner ' + (SHARE ? (SHARE.kind === 'family' ? 'me' : 'team') : S.view), style: 'margin-top:8px',
      text: SHARE ? (SHARE.kind === 'family' ? '共有された予定です（閲覧専用）。' : '会社の業務の予定と休みです（閲覧専用。プライベートの予定は含まれません）。')
        : S.view === 'team' ? (whoId() ? '業務版: ' + (whoId() === S.me.user.id ? '自分' : whoName() + 'さん') + 'の予定（業務・休み）だけを表示しています（プライベートの予定は含まれません）' : '業務版: 会社の全員に共有される予定だけを表示しています（プライベートの予定は含まれません）') : 'プライベート版: 自分のプライベート予定と、「家族に共有」にした業務・休みを表示しています（共有は、業務版で予定を開いて決めます）' }));
  }


  /* ---------- データの読み込みと描画 ---------- */
  function gridRange() {
    var first = new Date(S.year, S.month - 1, 1);
    var start = addDays(first, -first.getDay());
    var last = new Date(S.year, S.month, 0);
    var end = addDays(last, 6 - last.getDay());
    return { start: start, end: end };
  }

  function evParams(view) {
    var r = gridRange();
    var p = { from: ymd(r.start), to: ymd(r.end), view: view || S.view };
    if (p.view === 'team' && !SHARE && whoId() && S.mode !== 'grid') p.who = String(whoId()); // 業務版で、特定の社員だけを見ているとき
    if (!SHARE) p.sum = S.year + '-' + pad(S.month); // 表示している月の、自分の出勤日・休みの日数
    return p;
  }
  function evKey(p) { return [p.view, p.from, p.to, p.who || ''].join('|'); }
  function applyEvents(c) {
    S.events = c.events; S.holidays = c.holidays; S.summary = c.summary; buildLeaveIdx(); S.revEv = c.rev;
  }

  var loadSeq = 0;
  function load() {
    if (S.page === 'settings' || !document.getElementById('board')) return; // 設定のページを開いている間は、カレンダーを読み込まない（戻ったときに読み込む）
    var params = evParams();
    var seq = ++loadSeq; // 切り替えの途中で古い答えが届いても、画面を上書きしない
    S.loading = true;
    // 家族用の共有ページでは、更新履歴も一緒に読む（前回見たときからの更新を目立たせるため）
    Promise.all([api('events', { params: params }), FAMILY ? api('log') : Promise.resolve(null)]).then(function (r) {
      if (seq !== loadSeq) return;
      var j = r[0];
      if (r[1]) setUpdateLog(r[1]);
      var c = { events: FAMILY ? j.events.filter(function (e) { return !(e.deleted && ackIds().indexOf(e.log_id) >= 0); }) : j.events, holidays: j.holidays, summary: j.summary || null, rev: j.rev };
      S.loading = false;
      applyEvents(c); S.cache[evKey(params)] = c; renderBoard();
      if (!SHARE) memoRefreshDays(); // 休みなどが変わると、出勤日（日報の日）も変わる
      if (!SHARE) prefetchOtherView(params, seq);
    }).catch(function (e) { if (seq === loadSeq) S.loading = false; fail(e); });
  }
  /* もう一方の版も、裏で読んでおく（切り替えたとき、すぐ出せるように） */
  function prefetchOtherView(params, seq) {
    var other = params.view === 'team' ? 'me' : 'team';
    var p = evParams(other);
    api('events', { params: p, quiet: true }).then(function (j) {
      if (seq !== loadSeq) return;
      S.cache[evKey(p)] = { events: j.events, holidays: j.holidays, summary: j.summary || null, rev: j.rev };
    }).catch(function () { /* 裏の読み込みは、失敗しても何もしない */ });
    api('todo_list', { params: { view: other }, quiet: true }).then(function (j) { S.tdCache[other] = j; }).catch(function () { });
  }

  /* ---------- 家族用: 更新履歴と、前回から更新された予定の目印 ---------- */
  function seenKey() { return 'sched.seen.' + SHARE.token.slice(0, 16); }
  /* 削除された予定の「確認した」。このブラウザに覚えておく（家族のそれぞれが、自分で確認して消す） */
  function ackKey() { return 'sched.ack.' + SHARE.token.slice(0, 16); }
  function ackIds() { var a = store(ackKey()); return Array.isArray(a) ? a : []; }
  function ackAdd(ids) { store(ackKey(), ackIds().concat(ids).slice(-300)); }
  function delEvents() { return (S.events || []).filter(function (e) { return e.deleted; }); }
  function delCount() { return delEvents().length; }
  function ackAll() { ackAdd(delEvents().map(function (e) { return e.log_id; })); S.events = S.events.filter(function (e) { return !e.deleted; }); renderBoard(); }
  function setUpdateLog(lg) {
    S.log = lg;
    var seen = store(seenKey()); // { id: どの更新まで見たか, at: そのときの時刻 }
    if (!seen || typeof seen.id !== 'number') {
      // 初めて開いたときは、目印を付けず、いまを「確認済み」にする。記憶できないブラウザでは、直近3日の更新に目印を付ける
      seen = { id: lg.last_id, at: lg.now };
      if (store(seenKey(), seen) === null) {
        var old = lg.entries.filter(function (e) { return e.at <= lg.recent_since; });
        seen = { id: old.length ? old[0].id : 0, at: lg.recent_since };
      }
    }
    S.seen = seen;
    S.updIds = {};
    S.newLog = lg.entries.filter(function (e) { return e.id > seen.id; });
    S.newLog.forEach(function (e) { if (e.action !== 'delete') S.updIds[e.event_id] = true; });
  }
  function markSeen() { S.seen = { id: S.log.last_id, at: S.log.now }; store(seenKey(), S.seen); S.newLog = []; S.updIds = {}; renderBoard(); }
  function fmtAt(at) { return (+at.slice(5, 7)) + '/' + (+at.slice(8, 10)) + ' ' + at.slice(11, 16); }
  function openUpdateLog() {
    var newIds = {};
    (S.newLog || []).forEach(function (e) { newIds[e.id] = true; });
    var label = { add: '追加', update: '変更', delete: '削除' };
    var items = S.log.entries.map(function (e) {
      var when = e.from === e.to ? mdw(e.from) : mdw(e.from) + ' 〜 ' + mdw(e.to);
      return el('li', { class: 'log-item ' + e.action + (newIds[e.id] ? ' new' : '') },
        el('div', { class: 'log-top' }, el('span', { class: 'log-at', text: fmtAt(e.at) }), el('span', { class: 'log-act ' + e.action, text: label[e.action] || e.action }),
          newIds[e.id] ? el('span', { class: 'log-new', text: '新着' }) : null),
        el('div', { class: 'log-title' + (e.action === 'delete' ? ' gone' : ''), text: e.title + '　' + when }),
        e.detail ? el('div', { class: 'log-detail', text: e.detail }) : null);
    });
    var body = el('div', { class: 'form' },
      el('p', { class: 'hint', text: '家族に共有されている予定の、追加・変更・削除の記録です（最新の100件まで・約4か月分）。' }),
      items.length ? el('ul', { class: 'log-list' }, items) : el('p', { class: 'muted', text: 'まだ更新の記録はありません。' }),
      el('div', { class: 'actions' },
        (S.newLog || []).length ? el('button', { class: 'btn primary', type: 'button', text: '確認した（目印を消す）', onclick: function () { ov.close(); markSeen(); } }) : null,
        el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
    var ov = openModal('更新履歴', body, true);
    ov.outsideClose = true;
  }
  function deletedBanner() {
    var n = delCount();
    if (!FAMILY || !n) return null;
    return el('div', { class: 'upd-banner has del', role: 'status' },
      el('span', { class: 'upd-msg' }, el('span', { class: 'del-sample', text: '取消線' }), n + '件の予定が削除されました。確認すると、カレンダーから消えます。'),
      el('span', { class: 'upd-btns' }, el('button', { class: 'btn small primary', type: 'button', text: 'すべて確認した', onclick: ackAll })));
  }
  function updatesBanner() {
    if (!FAMILY || !S.log) return null;
    var n = (S.newLog || []).length;
    return el('div', { class: 'upd-banner' + (n ? ' has' : ''), role: 'status' },
      el('span', { class: 'upd-msg', text: n ? '前回確認した ' + fmtAt(S.seen.at) + ' から、' + n + '件の更新があります。更新された予定には ● と色の枠が付いています。' : '前回から新しい更新はありません。' }),
      el('span', { class: 'upd-btns' },
        el('button', { class: 'btn small' + (n ? ' primary' : ''), type: 'button', text: '更新履歴を見る', onclick: openUpdateLog }),
        n ? el('button', { class: 'btn small', type: 'button', text: '確認した', onclick: markSeen }) : null));
  }

  function eventLabel(e, first, compact) {
    var t;
    if (e.kind === 'off' && SHARE && SHARE.kind === 'family') {
      t = '休み'; // 家族用の共有には、名前も休みの種類も出さない
    } else if (e.kind === 'off' && compact) {
      t = e.owner_name.split(/[\s　]+/)[0] + (e.tag || '休み'); // スマホのカレンダー: 狭いので「山田有給」のように詰める
    } else if (e.kind === 'off') {
      t = e.owner_name + ' ' + (e.tag || '休み');
      if (e.title && e.title !== '休み') t += '（' + e.title + '）';
    } else t = e.title;
    var time = first && !compact && e.start_time ? e.start_time + (e.end_time ? '-' + e.end_time : '') + ' ' : '';
    return (FAMILY && S.updIds && S.updIds[e.id] ? '● ' : '') + (e.important ? '★ ' : '') + (e.recurring ? '↻ ' : '') + (e.kind === 'private' && e.family_shared === false && !SHARE ? '非共有｜' : '') + time + t;
  }

  /* 土日祝か（会社の休業日を含む。祝日は読み込んだ範囲の分だけ分かる） */
  function isOffDay(ds) { var w = parse(ds).getDay(); return w === 0 || w === 6 || !!S.holidays[ds]; }
  function hasBizDay(e) {
    if (e._biz !== undefined) return e._biz;
    var r = false;
    for (var d = parse(e.start), end = parse(e.end), n = 0; d <= end && n < 400; d = addDays(d, 1), n++) { if (!isOffDay(ymd(d))) { r = true; break; } }
    return (e._biz = r);
  }
  /* その日に表示するか。期間のある「業務」は、土日祝には出さない（全期間が休日なら、そのまま出す） */
  /* 本人が丸1日休みの日（半休は除く）。繰り返し業務の期間の途中に休みがあっても、その日には業務の帯を出さない（休みを優先） */
  function buildLeaveIdx() {
    var idx = {};
    S.events.forEach(function (e) {
      if (e.kind !== 'off' || e.deleted || (e.tag || '').indexOf('半休') >= 0) return;
      var m = idx[e.owner_id] || (idx[e.owner_id] = {});
      for (var d = parse(e.start), end = parse(e.end), n = 0; d <= end && n < 120; d = addDays(d, 1), n++) m[ymd(d)] = true;
    });
    S.leaveIdx = idx;
    // 休みの人がいる日（セルを薄く塗りつぶす）
    var od = {};
    S.events.forEach(function (e) {
      if (e.kind !== 'off' || e.deleted) return;
      for (var d = parse(e.start), end = parse(e.end), n = 0; d <= end && n < 120; d = addDays(d, 1), n++) od[ymd(d)] = true;
    });
    S.offDays = od;
  }
  function shownOn(e, ds) {
    if (e.start > ds || e.end < ds) return false;
    if (e.kind === 'work' && e.recurring && e.start !== e.end && S.leaveIdx && S.leaveIdx[e.owner_id] && S.leaveIdx[e.owner_id][ds]) return false;
    if (e.kind === 'work' && e.start !== e.end && isOffDay(ds) && hasBizDay(e)) return false;
    return true;
  }

  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function canReturnToTodo(e) { return e.editable && e.kind !== 'off' && !e.recurring && e.owner_id === S.me.user.id; }

  /* 1週間分の、連続する同じ予定を1本のバーにまとめる */
  function weekSegments(days) {
    var segs = [];
    S.events.forEach(function (e) {
      var cur = null;
      for (var c = 0; c < 7; c++) {
        if (shownOn(e, ymd(days[c]))) { if (cur) cur.e = c; else { cur = { ev: e, s: c, e: c }; segs.push(cur); } } else cur = null;
      }
    });
    /* 週をまたぐ予定のうち、行の端（日・土）でそのまま次の週へ続くものだけを「続き」とする（端を平らにして「… 」を付ける）。
       土日祝や休みで間があいて次の週に出る予定は、続きではなく、前後とも丸くして「… 」も付けない */
    segs.forEach(function (g) {
      g.contL = g.s === 0 && g.ev.start < ymd(days[0]) && shownOn(g.ev, ymd(addDays(days[0], -1)));
      g.contR = g.e === 6 && g.ev.end > ymd(days[6]) && shownOn(g.ev, ymd(addDays(days[6], 1)));
    });
    segs.sort(function (a, b) { return a.s - b.s || (b.e - b.s) - (a.e - a.s) || a.ev.id - b.ev.id; });
    var ends = [];
    segs.forEach(function (g) {
      var l = 0;
      while (ends[l] !== undefined && ends[l] >= g.s) l++;
      g.lane = l; ends[l] = g.e;
    });
    return { segs: segs, lanes: ends.length };
  }

  function barFor(g, days) {
    var e = g.ev;
    var bar = el('div', { role: 'button', tabindex: '0', class: 'bar ' + e.kind + (e.recurring ? ' rec' : '') + (e.important ? ' imp' : '') + (FAMILY && S.updIds && S.updIds[e.id] ? ' upd' : '') + (e.deleted ? ' deleted' : '') + (e.done ? ' done' : '') + (g.contL ? ' cl' : '') + (g.contR ? ' cr' : ''),
      style: 'grid-column:' + (g.s + 1) + ' / ' + (g.e + 2) + ';grid-row:' + (g.lane + 2) + eventColorStyle(e),
      text: (g.contL ? '… ' : '') + eventLabel(e, e.start === ymd(days[g.s]), NARROW()), title: (e.deleted ? '削除された予定: ' : '') + eventLabel(e, true) + (e.note ? '\n' + e.note : ''),
      draggable: e.editable ? 'true' : null,
      onclick: function (ev) {
        ev.stopPropagation();
        if (NARROW()) { // スマホ: 帯の文字は短く切れるので、押した日の予定の一覧を出す
          var rect = bar.parentNode.getBoundingClientRect();
          var col = Math.max(g.s, Math.min(g.e, Math.floor((ev.clientX - rect.left) / (rect.width / 7))));
          return openDayPopup(ymd(days[col]));
        }
        openEventDialog(e);
      },
      onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEventDialog(e); } } });
    if (e.editable) {
      bar.addEventListener('dragstart', function (ev) {
        // つかんだ日（何日目か）を覚えておく。ドロップ先の日付から開始日を逆算するため
        var rect = bar.parentNode.getBoundingClientRect();
        var col = Math.max(g.s, Math.min(g.e, Math.floor((ev.clientX - rect.left) / (rect.width / 7))));
        var off = Math.max(0, daysBetween(e.start, ymd(days[col])));
        startDrag(ev, { t: 'event', id: e.id, off: off, ok: canReturnToTodo(e) });
      });
      bar.addEventListener('dragend', endDrag);
    }
    return bar;
  }

  /* リスト表示: ログインして使う画面は、ToDoの管理だけ（予定は、カレンダーで見る）。共有リンク（会社用）は、今月の予定を日ごとに */
  function plainBar(e, ds) {
    var bar = el('div', { role: 'button', tabindex: '0', draggable: !SHARE && e.editable ? 'true' : null, style: eventColorStyle(e) || null, class: 'bar plain ' + e.kind + (e.recurring ? ' rec' : '') + (e.important ? ' imp' : '') + (FAMILY && S.updIds && S.updIds[e.id] ? ' upd' : '') + (e.deleted ? ' deleted' : '') + (e.done ? ' done' : ''),
      text: (e.start === ds ? '' : '… ') + eventLabel(e, e.start === ds), title: (e.deleted ? '削除された予定: ' : '') + eventLabel(e, true) + (e.note ? '\n' + e.note : ''),
      onclick: function () { openEventDialog(e); }, onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEventDialog(e); } } });
    if (!SHARE && e.editable) { // リストの予定を、ToDoの列へ・別の日の行へドラッグできる
      bar.addEventListener('dragstart', function (ev) { startDrag(ev, { t: 'event', id: e.id, off: Math.max(0, daysBetween(e.start, ds)), ok: canReturnToTodo(e) }); });
      bar.addEventListener('dragend', endDrag);
    }
    return bar;
  }
  /* ---------- 休み表（業務版）: 縦に社員、横に日付。いつ誰が休みかを、一目で見る ---------- */
  var GRID_ABBR = { '有給': '有', '調整休': '調', '欠勤': '欠', '午前半休': 'AM', '午後半休': 'PM' };
  function renderGridView(board) {
    var y = S.year, mo = S.month, n = new Date(y, mo, 0).getDate(), todayStr = ymd(new Date());
    var users = S.me.users.slice().sort(function (a, b) { return (a.id === S.me.user.id ? 0 : 1) - (b.id === S.me.user.id ? 0 : 1) || a.id - b.id; });
    var days = [];
    for (var i = 1; i <= n; i++) days.push(y + '-' + pad(mo) + '-' + pad(i));
    var offOf = function (uid, ds) { return S.events.filter(function (e) { return e.kind === 'off' && e.owner_id === uid && e.start <= ds && e.end >= ds; })[0] || null; };
    var weekday = function (ds) { return parse(ds).getDay(); };
    var dayCls = function (ds) { var w = weekday(ds); return (w === 0 ? ' sun' : w === 6 ? ' sat' : '') + (S.holidays[ds] ? ' hol' : '') + (ds === todayStr ? ' today' : ''); };
    var many = Math.max(2, Math.ceil(users.length * 0.3));
    var headCells = [el('th', { class: 'g-name', scope: 'col', text: '' })].concat(days.map(function (ds) {
      return el('th', { class: 'g-day' + dayCls(ds), scope: 'col', title: mdw(ds) + (S.holidays[ds] ? '（' + S.holidays[ds] + '）' : '') }, el('div', { class: 'g-d', text: String(+ds.slice(8)) }), el('div', { class: 'g-w', text: DOW[weekday(ds)] }));
    }), [el('th', { class: 'g-sum', scope: 'col', text: '休み計', title: '土日祝を除いた、休みの日数（半休は0.5日）' })]);
    var counts = days.map(function () { return 0; });
    var rows = users.map(function (u) {
      var total = 0;
      var cells = days.map(function (ds, di) {
        var e = offOf(u.id, ds);
        if (e && !isOffDay(ds)) { total += /半休/.test(e.tag || '') ? 0.5 : 1; counts[di] += /半休/.test(e.tag || '') ? 0.5 : 1; }
        var ab = e ? (GRID_ABBR[e.tag] || '休') : '';
        return el('td', { class: 'g-cell' + dayCls(ds) + (e ? ' off t-' + (ab === 'AM' || ab === 'PM' ? 'half' : ab === '欠' ? 'abs' : 'full') : ''), title: e ? u.name + '　' + mdw(ds) + '　' + (e.tag || '休み') : null,
          tabindex: e ? '0' : null, onclick: function () { openDayPopup(ds); } }, ab);
      });
      return el('tr', { class: u.id === S.me.user.id ? 'me' : '' }, [el('th', { class: 'g-name', scope: 'row', text: u.name })].concat(cells, [el('td', { class: 'g-sum', text: total ? fmtDays(total) : '' })]));
    });
    var foot = el('tr', { class: 'g-foot' }, [el('th', { class: 'g-name', scope: 'row', text: '休み人数' })].concat(days.map(function (ds, di) {
      var c = counts[di];
      return el('td', { class: 'g-cell' + dayCls(ds) + (c >= many ? ' many' : ''), text: c ? String(Math.round(c * 10) / 10) : '' });
    }), [el('td', { class: 'g-sum' })]));
    board.appendChild(el('div', { class: 'grid-wrap', role: 'region', 'aria-label': S.year + '年' + S.month + '月の休み表' },
      el('table', { class: 'grid-table' }, el('thead', null, el('tr', null, headCells)), el('tbody', null, rows), el('tfoot', null, foot))));
    board.appendChild(el('div', { class: 'legend', style: 'margin-top:8px' },
      el('span', null, el('b', { class: 'g-key full', text: '有' }), '有給'), el('span', null, el('b', { class: 'g-key full', text: '調' }), '調整休'), el('span', null, el('b', { class: 'g-key abs', text: '欠' }), '欠勤'),
      el('span', null, el('b', { class: 'g-key half', text: 'AM' }), '午前半休'), el('span', null, el('b', { class: 'g-key half', text: 'PM' }), '午後半休'), el('span', null, el('b', { class: 'g-key full', text: '休' }), 'その他の休み'),
      el('span', { class: 'muted', text: '日付や休みを押すと、その日の予定が開きます。「休み人数」が橙色の日は、休みが重なっています（全社員の3割以上、または2人以上）。' })));
  }

  function renderListView(board, keepFrom) {
    if (!SHARE) {
      var mgr = el('section', { id: 'todo-mgr', class: 'todo todo-mgr', 'aria-label': 'ToDoの管理' });
      board.appendChild(mgr);
      renderTodoInto(mgr, true, keepFrom);
      return;
    }
    var todayStr = ymd(new Date());
    var hideWork = false;
    var list = el('div', { class: 'list' });
    var any = false;
    var last = new Date(S.year, S.month, 0).getDate();
    for (var i = 1; i <= last; i++) {
      var d = new Date(S.year, S.month - 1, i), ds = ymd(d), hol = S.holidays[ds];
      var evs = S.events.filter(function (e) { return shownOn(e, ds) && !(hideWork && e.kind === 'work'); });
      if (!evs.length && !hol) continue;
      any = true;
      var dayRow = el('div', { class: 'list-day' + (d.getDay() === 0 ? ' sun' : '') + (d.getDay() === 6 ? ' sat' : '') + (hol ? ' hol' : '') + (ds === todayStr ? ' today' : '') },
        el('div', { class: 'dt' }, (d.getMonth() + 1) + '/' + d.getDate(), el('small', { text: DOW[d.getDay()] + '曜日' + (hol ? '・' + hol : '') })),
        el('div', { class: 'list-items' }, evs.map(function (e) { return plainBar(e, ds); })));
      if (!SHARE) { // ToDoや予定を、この日の行にドロップすると、その日の予定になる（予定は、その日へ移る）
        dayRow.addEventListener('dragover', function (ev) { if (!S.drag || !(S.drag.t === 'todo' || S.drag.t === 'event')) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; dayRow.classList.add('drop'); });
        dayRow.addEventListener('dragleave', function () { dayRow.classList.remove('drop'); });
        dayRow.addEventListener('drop', (function (date) { return function (ev) { if (!S.drag) return; ev.preventDefault(); var p = S.drag; endDrag(); dropOnDate(p, date); }; })(ds));
      }
      list.appendChild(dayRow);
    }
    if (!any) list.appendChild(el('p', { class: 'empty-note', text: 'この月の予定はまだありません。' }));
    board.appendChild(el('h3', { class: 'list-h', text: S.year + '年' + S.month + '月の予定' }));
    if (false) {
      board.appendChild(el('label', { class: 'check list-opt' },
        el('input', { type: 'checkbox', id: 'list-work', checked: !!S.listWork, style: 'width:auto', onchange: function () { S.listWork = this.checked; store('sched.listWork', S.listWork); renderBoard(); } }),
        '業務の予定も表示する（初期設定は、非表示）'));
    }
    board.appendChild(list);
  }

  function openTipsDialog(tips) {
    var ov = openModal('カレンダーの使い方', el('div', { class: 'form' },
      el('ul', { class: 'tips-list' }, tips.map(function (t) { return el('li', { text: t }); })),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }))));
    ov.outsideClose = true;
  }

  /* 管理者へ: 月1回の手動バックアップのお知らせ（カレンダー・リストの上）。「あとで」で7日間消す */
  function backupBanner() {
    var al = !SHARE && S.me && S.me.backup_alert;
    if (!al) return null;
    var box = el('div', { class: 'notice backup-alert', role: 'status' },
      el('b', { text: 'バックアップの時期です。' }),
      el('span', { text: al.last ? '（最後に手動でダウンロードしたのは、' + al.last.slice(0, 10) + '・' + al.days + '日前）' : '（まだ一度も、手動でダウンロードしていません）' }),
      ' データが消えてしまう場合に備えて、バックアップのファイルをダウンロードして、別の場所に保管してください。',
      el('span', { class: 'ba-actions' },
        el('a', { class: 'btn small primary', href: 'backup.php', text: 'バックアップの画面を開く' }),
        el('button', { class: 'btn small ghost', type: 'button', text: 'あとで（7日間表示しない）', onclick: function () {
          api('backup_snooze', { body: {} }).then(function () { S.me.backup_alert = null; renderBoard(); }).catch(fail);
        } })));
    return box;
  }

  function renderBoard() {
    var board = document.getElementById('board');
    if (!board) return;
    var mgrKeep = captureTodoInput(document.getElementById('todo-mgr')); // リスト表示のToDo入力欄は、描き直すと作り直されるので、入力中の内容を引き継ぐ
    board.textContent = '';
    var db = deletedBanner();
    if (db) board.appendChild(db);
    var ub = updatesBanner();
    if (ub) board.appendChild(ub);
    var bb = backupBanner();
    if (bb) board.appendChild(bb);
    var lay = document.querySelector('.layout');
    if (lay) { lay.classList.toggle('list-mode', S.mode === 'list'); lay.setAttribute('data-pane', S.pane || 'todo'); }
    syncTodoHover();
    if (S.mode === 'list') { renderListView(board, mgrKeep); return; }
    if (S.mode === 'grid') { renderGridView(board); return; }
    var todayStr = ymd(new Date());
    var r = gridRange();
    var days = [];
    for (var d = r.start; d <= r.end; d = addDays(d, 1)) days.push(d);

    var head = el('div', { class: 'cal-dow' });
    DOW.forEach(function (w, i) { head.appendChild(el('div', { class: 'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), text: w })); });
    var weeks = el('div', { class: 'cal-weeks', role: 'grid', 'aria-label': S.year + '年' + S.month + '月のカレンダー' });

    for (var w = 0; w < days.length; w += 7) {
      weeks.appendChild(renderWeek(days.slice(w, w + 7), todayStr));
    }
    var slide = S.slide; S.slide = '';
    board.appendChild(el('div', { class: 'cal-wrap' + (slide ? ' slide-' + slide : '') }, el('div', { class: 'cal', style: offdayPref().color ? '--offday-bg:' + offdayBg(offdayPref().color) : null }, head, weeks)));
    /* 使い方の説明は、画面に並べず、「ⓘ 使い方」のダイアログにまとめる */
    var tips = [];
    if (!FAMILY) tips.push('繰り返しの業務は「↻」付き・色は文字の色で区別します（標準）。色は、右上の「設定」→「予定の色」で変えられます。');
    if (!FAMILY) tips.push('期間のある業務は、土日祝を除いて1本にまとめて表示します。');
    if (!SHARE) tips.push('予定は、ドラッグして別の日へ動かせます。画面の右端へ持っていくと、ToDoにできます。');
    if (!FAMILY && !NARROW()) tips.push('ショートカット: ? を押すと、キーの一覧が出ます。');
    if (NARROW()) tips.push('カレンダーを左右にスワイプすると、前の月・次の月に切り替わります。');
    if (POLL_MS && !FAMILY) tips.push('他の人の更新は、約' + Math.round(POLL_MS / 1000) + '秒以内に、自動で反映されます。');
    board.appendChild(el('div', { class: 'legend', style: 'margin-top:8px' },
      el('span', null, el('i', { style: 'background:var(--uc-work, var(--work))' }), '業務'),
      el('span', null, el('i', { style: 'background:var(--uc-off, var(--off))' }), '休み'),
      offdayPref().on ? el('span', null, el('i', { class: 'offday-sw', style: offdayPref().color ? 'background:' + offdayBg(offdayPref().color) : null }), '休みの人がいる日') : null,
      S.view === 'me' || (SHARE && SHARE.kind === 'family') ? el('span', null, el('i', { style: 'background:var(--uc-private, var(--private))' }), 'プライベート') : null,
      FAMILY ? null : el('span', null, el('span', { class: 'rec-sample', text: '↻ 繰り返しの業務' })),
      tips.length ? el('button', { class: 'legend-help', type: 'button', text: 'ⓘ 使い方', title: 'カレンダーの使い方', onclick: function () { openTipsDialog(tips); } }) : null,
      FAMILY && delCount() ? el('span', null, el('span', { class: 'del-sample', text: '取消線' }), '＝削除された予定（押して「確認した」を選ぶと消えます）') : null));
    var sum = monthSummary();
    if (sum) board.appendChild(sum);
  }

  /* カレンダーの下: その月の出勤日と休みの日数。自分／全社員／選んだ社員（業務版で「表示する人」に合わせる）を、社員ごとに1行で */
  function fmtDays(n) { return (Math.round(n * 10) / 10) + '日'; }
  function monthSummary() {
    var m = S.summary;
    if (SHARE || !m || m.month !== S.year + '-' + pad(S.month) || !m.people || !m.people.length) return null;
    var wid = S.view === 'team' ? whoId() : S.me.user.id;
    var who = S.view === 'team' && !wid ? '全社員' : wid === S.me.user.id ? '自分' : whoName() + 'さん';
    var tagDays = function (p, tag) { var t = p.by_tag.filter(function (x) { return x.tag === tag; })[0]; return t ? t.days : 0; };
    var rows = m.people.map(function (p) {
      var other = p.by_tag.filter(function (x) { return x.tag !== '有給' && x.tag !== '欠勤' && x.days > 0; }).map(function (x) { return x.tag + ' ' + fmtDays(x.days); }).join('・');
      var abs = tagDays(p, '欠勤');
      var pick = S.view === 'team' && !SHARE ? function () { selectWho(String(p.id)); } : null; // 業務版では、行を押すと「表示する人」でその人を選んだときと同じ
      return el('tr', { class: (p.id === S.me.user.id && m.people.length > 1 ? 'me' : '') + (pick ? ' pick' : ''), tabindex: pick ? '0' : null,
        title: pick ? (p.id === S.me.user.id ? '押すと、自分の予定だけを表示' : '押すと、' + p.name + 'さんの予定だけを表示') : null,
        onclick: pick, onkeydown: pick ? function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } } : null },
        el('th', { scope: 'row', text: p.name }),
        el('td', { class: 'n work', text: fmtDays(p.work_days) }),
        el('td', { class: 'n off', text: fmtDays(p.off_days) }),
        el('td', { class: 'n', text: fmtDays(tagDays(p, '有給')) }),
        el('td', { class: 'n' + (abs > 0 ? ' absent' : ''), text: fmtDays(abs) }),
        el('td', { class: 'etc', text: other || '—' }));
    });
    return el('section', { class: 'month-sum', 'aria-label': S.month + '月の出勤日と休みの日数' },
      el('h3', null, S.month + '月のまとめ（' + who + '）', el('span', { class: 'ms-biz', text: '営業日 ' + fmtDays(m.biz_days) + '（土日祝・会社の休業日を除く）' + (S.view === 'team' && m.people.length > 1 ? '　行を押すと、その人の予定だけを表示' : '') }),
        S.view === 'team' && wid ? el('button', { class: 'btn small', type: 'button', text: '全社に戻す', onclick: function () { selectWho('all'); } }) : null),
      el('div', { class: 'scroll-x' }, el('table', { class: 'ms-table' },
        el('thead', null, el('tr', null, ['名前', '出勤日', '休み', '有給', '欠勤', 'その他の休み'].map(function (h) { return el('th', { scope: 'col', text: h }); }))),
        el('tbody', null, rows))));
  }


  function renderWeek(days, todayStr) {
    var pack = weekSegments(days);
    var L = Math.max(pack.lanes, NARROW() ? 2 : 3); // スマホでは、予定のない週を低くして、1画面に収める
    var week = el('div', { class: 'week', role: 'row', style: 'grid-template-rows:' + (NARROW() ? '20px repeat(' + L + ',19px)' : '24px repeat(' + L + ',22px)') + ' minmax(6px,1fr)' });
    days.forEach(function (d, c) {
      var s = ymd(d), hol = S.holidays[s];
      var cls = 'cell' + (d.getMonth() + 1 !== S.month ? ' other' : '') + (d.getDay() === 0 ? ' sun' : '') + (d.getDay() === 6 ? ' sat' : '') + (hol ? ' hol' : '') + (s === todayStr ? ' today' : '') + (S.offDays && S.offDays[s] && offdayPref().on ? ' offday' : '');
      week.appendChild(el('div', { class: cls, role: 'gridcell', 'data-col': String(c), 'data-date': s,
        style: 'grid-column:' + (c + 1) + ';grid-row:1 / ' + (L + 3), onclick: function () { if (useDayPopup()) openDayPopup(s); else if (!SHARE) openEventDialog(null, s); } },
        el('div', { class: 'num' }, el('span', { class: 'd', text: String(d.getDate()) }), hol ? el('span', { class: 'hname', text: hol }) : null)));
    });
    pack.segs.forEach(function (g) { week.appendChild(barFor(g, days)); });

    // ドロップ先: ポインタのある列が、その日になる（バーの上でも同じ）
    var colAt = function (ev) {
      var rect = week.getBoundingClientRect();
      return Math.max(0, Math.min(6, Math.floor((ev.clientX - rect.left) / (rect.width / 7))));
    };
    var mark = function (col) {
      week.querySelectorAll('.cell.drop').forEach(function (x) { x.classList.remove('drop'); });
      if (col !== null) week.querySelector('.cell[data-col="' + col + '"]').classList.add('drop');
    };
    week.addEventListener('dragover', function (ev) {
      if (!S.drag || S.drag.t === 'tdorder') return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; mark(colAt(ev));
    });
    week.addEventListener('dragleave', function (ev) { if (!week.contains(ev.relatedTarget)) mark(null); });
    week.addEventListener('drop', function (ev) {
      if (!S.drag) return;
      ev.preventDefault();
      var date = ymd(days[colAt(ev)]), p = S.drag;
      mark(null); endDrag();
      dropOnDate(p, date);
    });
    return week;
  }

  /* ---------- ドラッグ&ドロップ ---------- */
  function startDrag(ev, payload) {
    S.drag = payload;
    ev.dataTransfer.setData('text/plain', JSON.stringify(payload));
    ev.dataTransfer.effectAllowed = 'move';
    document.body.classList.add('is-dragging');
    document.body.classList.toggle('drag-event', payload.t === 'event');
    document.body.classList.toggle('drag-ok', !!payload.ok);
    if (payload.t === 'todo' && S.mode === 'list' && !SHARE) setupCalEdge();
    if (payload.t === 'event' && payload.ok && S.mode === 'cal' && !SHARE) setupTodoEdge(); // カレンダーの予定を、右端へ持っていくと、ToDoにできる
  }
  function endDrag() {
    S.drag = null;
    teardownCalEdge();
    setTimeout(maybeRefresh, 0);
    document.body.classList.remove('is-dragging', 'drag-event', 'drag-ok');
    document.querySelectorAll('.drop, .ins-before, .ins-after').forEach(function (x) { x.classList.remove('drop', 'ins-before', 'ins-after'); });
  }

  /* ---------- リストのToDoを、画面の右端へ持っていくと、カレンダーが開いて、日付に落として予定にできる ---------- */
  var calEdgeFn = null, calCloseTimer = null;
  function setupCalEdge() {
    if (document.getElementById('cal-edge')) return;
    var edge = el('div', { id: 'cal-edge', class: 'cal-edge', text: 'カレンダーへ ▶' });
    edge.addEventListener('dragover', function (ev) { ev.preventDefault(); openCalDrop(); });
    document.body.appendChild(edge);
    calEdgeFn = function (ev) { if (ev.clientX >= window.innerWidth - 56) openCalDrop(); }; // 画面の右端まで持っていったら開く
    document.addEventListener('dragover', calEdgeFn);
  }
  function teardownCalEdge() {
    if (calEdgeFn) { document.removeEventListener('dragover', calEdgeFn); calEdgeFn = null; }
    clearTimeout(calCloseTimer);
    ['cal-edge', 'cal-drop', 'todo-edge', 'todo-drop', 'todo-panel'].forEach(function (id) { var x = document.getElementById(id); if (x) x.remove(); });
  }

  /* ---------- カレンダーの右端にカーソルを持っていくと、ToDoが出る（そこからカレンダーの日付へドラッグして予定にできる） ---------- */
  var todoPanelTimer = null;
  function syncTodoHover() {
    var want = !SHARE && S.me && S.mode === 'cal' && S.page !== 'settings';
    var z = document.getElementById('todo-hover');
    if (want && !z) {
      z = el('div', { id: 'todo-hover', class: 'todo-hover', title: 'ToDoを表示（d）', text: 'ToDo' });
      z.addEventListener('mouseenter', openTodoPanel);
      z.addEventListener('mouseleave', scheduleCloseTodoPanel);
      z.addEventListener('click', openTodoPanel); // タッチでも開けるように
      document.body.appendChild(z);
    } else if (!want) {
      if (z) z.remove();
      closeTodoPanel(true);
    }
  }
  function scheduleCloseTodoPanel() { clearTimeout(todoPanelTimer); todoPanelTimer = setTimeout(function () { closeTodoPanel(); }, 450); }
  /* 入力中（欄の中の入力欄に、カーソルがある）は、マウスが外へ出ても、閉じない。✕・Esc・欄の外をクリックしたときは、閉じる */
  function todoPanelTyping(p) { var a = document.activeElement; return !!(a && p.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
  function closeTodoPanel(now) {
    clearTimeout(todoPanelTimer);
    var p = document.getElementById('todo-panel');
    if (!p) return;
    if (now) { p.remove(); return; }
    if (todoPanelTyping(p)) return; // 入力中は、閉じない
    p.classList.remove('open');
    setTimeout(function () { if (!p.classList.contains('open')) p.remove(); }, 200);
  }
  function openTodoPanel() {
    clearTimeout(todoPanelTimer);
    if ((S.drag && S.drag.t !== 'event') || S.mode !== 'cal' || SHARE) return;
    var p = document.getElementById('todo-panel');
    if (p) { p.classList.add('open'); return; }
    p = el('div', { id: 'todo-panel', class: 'todo-panel', role: 'dialog', 'aria-label': 'ToDo' });
    p.addEventListener('mouseenter', function () { clearTimeout(todoPanelTimer); });
    p.addEventListener('mouseleave', scheduleCloseTodoPanel);
    p.addEventListener('focusout', function (ev) { // 入力欄から離れたとき（欄の外をクリックしたなど）、マウスも外にあるなら、あとで閉じる
      if (ev.relatedTarget && p.contains(ev.relatedTarget)) return;
      setTimeout(function () { if (document.getElementById('todo-panel') === p && !todoPanelTyping(p) && !p.matches(':hover')) scheduleCloseTodoPanel(); }, 0);
    });
    // 予定をドラッグして持ってきたときの、閉じ方（左へ出ていったら閉じる）
    p.addEventListener('dragenter', function () { clearTimeout(todoPanelTimer); });
    p.addEventListener('dragover', function (ev) { if (S.drag && S.drag.t === 'event') { ev.preventDefault(); clearTimeout(todoPanelTimer); } });
    p.addEventListener('dragleave', function (ev) { if (S.drag && S.drag.t === 'event' && !p.contains(ev.relatedTarget)) scheduleCloseTodoPanel(); });
    document.body.appendChild(p);
    renderTodoPanel(p);
    requestAnimationFrame(function () { p.classList.add('open'); });
  }
  function renderTodoPanel(p) {
    var refocus = addFocused('panel');
    p.textContent = '';
    p.appendChild(el('div', { class: 'tp-head' }, el('b', { text: 'ToDo' }), 
      el('button', { class: 'btn small ghost', type: 'button', 'aria-label': '閉じる', text: '✕', onclick: function () { closeTodoPanel(true); } })));
    p.appendChild(el('p', { class: 'tp-sub', text: 'ToDoをカレンダーの日付へ、カレンダーの予定をこの欄へドラッグできます' }));
    // 進行中・未着手の2つの欄は、ToDoが無くても必ず出す（カレンダーの予定を、ここへドロップしてToDoにできる）
    var evOk = function () { return S.drag && S.drag.t === 'event' && S.drag.ok; };
    [['doing', '進行中'], ['todo', '未着手']].forEach(function (g) {
      var items = S.todos.filter(function (t) { return t.status === g[0]; });
      var zone = el('section', { class: 'tp-zone st-' + g[0], 'data-status': g[0], 'aria-label': g[1] },
        el('h3', { class: 'tp-g st-' + g[0] }, g[1], el('span', { class: 'cnt', text: String(items.length) })));
      items.forEach(function (t) {
        var card = el('div', { class: 'tp-card ' + t.kind, draggable: 'true', 'data-id': String(t.id) },
          el('div', { class: 'tp-title', text: t.title }),
          el('div', { class: 'tp-meta' }, t.kind === 'private' ? el('span', { class: 'pill private', text: 'プライベート' }) : (t.tag ? el('span', { class: 'pill', text: t.tag }) : null), schedBadge(t), tcBadge(t),
            el('button', { class: 'btn small ghost', type: 'button', text: '日付', title: '日付を選んで予定にする', onclick: function () { openTodoScheduleDialog(t); } })));
        card.addEventListener('dragstart', function (ev) {
          startDrag(ev, { t: 'todo', id: t.id });
          setTimeout(function () { p.classList.add('away'); }, 30); // ドラッグを始めたら、パネルを脇へどけて、カレンダーの日付に落とせるようにする
        });
        card.addEventListener('dragend', function () { endDrag(); });
        // 予定をカードの前後へ落とす
        card.addEventListener('dragover', function (ev) { if (!evOk()) return; ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'move'; zone.classList.add('drop'); });
        card.addEventListener('drop', function (ev) {
          if (!evOk()) return;
          ev.preventDefault(); ev.stopPropagation();
          var r = card.getBoundingClientRect(), after = ev.clientY > r.top + r.height / 2, d = S.drag;
          endDrag(); eventToKanban(d.id, g[0], t.id, after);
        });
        zone.appendChild(card);
      });
      if (!items.length) zone.appendChild(el('p', { class: 'tp-empty', text: g[0] === 'doing' ? '進行中のToDoはありません' : '未着手のToDoはありません' }));
      zone.appendChild(el('div', { class: 'tp-drop', text: 'ここに予定をドロップすると、ToDo（' + g[1] + '）になります' }));
      if (g[0] === 'todo') zone.appendChild(todoAddControl('panel', refocus)); // 未着手の一番下に「＋ 追加」
      // 予定を、この欄にドロップ
      zone.addEventListener('dragover', function (ev) { if (!evOk()) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; zone.classList.add('drop'); });
      zone.addEventListener('dragleave', function (ev) { if (!zone.contains(ev.relatedTarget)) zone.classList.remove('drop'); });
      zone.addEventListener('drop', function (ev) {
        if (!evOk()) return;
        ev.preventDefault();
        var d = S.drag; endDrag(); eventToKanban(d.id, g[0], null, false);
      });
      p.appendChild(zone);
    });
  }

  /* ---------- カレンダーの予定を、画面の右端へ持っていくと、ToDoの列（未着手・進行中）に落とせる ---------- */
  function setupTodoEdge() {
    if (document.getElementById('todo-edge')) return;
    var edge = el('div', { id: 'todo-edge', class: 'cal-edge todo-edge', text: 'ToDoへ ▶' });
    edge.addEventListener('dragover', function (ev) { ev.preventDefault(); openTodoPanel(); });
    document.body.appendChild(edge);
    calEdgeFn = function (ev) { if (ev.clientX >= window.innerWidth - 56) openTodoPanel(); }; // 予定を右端まで持っていくと、ToDoのパネル（ホバーで出るものと同じ）が開く
    document.addEventListener('dragover', calEdgeFn);
  }
  /* 予定をToDoにして、指定の列（targetId があればその前後）に入れる */
  function eventToKanban(eventId, status, targetId, after) {
    return api('event_to_todo', { body: { id: eventId } }).then(function (j) {
      toast('ToDoにしました（' + (status === 'doing' ? '進行中' : '未着手') + '）');
      load();
      return loadTodos().then(function () { moveTodo(j.todo.id, status, targetId === undefined ? null : targetId, after); });
    }).catch(fail);
  }
  function openCalDrop() {
    clearTimeout(calCloseTimer);
    if (document.getElementById('cal-drop')) return;
    var panel = el('div', { id: 'cal-drop', class: 'cal-drop', role: 'dialog', 'aria-label': 'カレンダーに追加' });
    var y = S.year, m = S.month, navTimer = null;
    function nav(delta) { var d = new Date(y, m - 1 + delta, 1); y = d.getFullYear(); m = d.getMonth() + 1; draw(); }
    function navBtn(label, delta, name) {
      var b = el('button', { type: 'button', class: 'btn small', text: label, 'aria-label': name, onclick: function () { nav(delta); } });
      b.addEventListener('dragenter', function () { clearTimeout(navTimer); navTimer = setTimeout(function () { nav(delta); }, 600); }); // 持ったまま乗せると、月が切り替わる
      b.addEventListener('dragover', function (ev) { ev.preventDefault(); });
      b.addEventListener('dragleave', function () { clearTimeout(navTimer); });
      return b;
    }
    function draw() {
      panel.textContent = '';
      panel.appendChild(el('p', { class: 'cd-hint', text: '日付にドロップすると、予定になります' }));
      panel.appendChild(el('div', { class: 'cd-head' }, navBtn('‹', -1, '前の月'), el('b', { text: y + '年' + m + '月' }), navBtn('›', 1, '次の月')));
      var grid = el('div', { class: 'cd-grid' });
      DOW.forEach(function (w, i) { grid.appendChild(el('div', { class: 'cd-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), text: w })); });
      var first = new Date(y, m - 1, 1), start = addDays(first, -first.getDay()), today = ymd(new Date());
      var last = new Date(y, m, 0), weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
      for (var i = 0; i < weeks * 7; i++) {
        var d = addDays(start, i), ds = ymd(d), n = S.events.filter(function (e) { return e.start <= ds && e.end >= ds; }).length;
        var cell = el('div', { class: 'cd-cell' + (d.getMonth() + 1 !== m ? ' other' : '') + (d.getDay() === 0 || S.holidays[ds] ? ' sun' : d.getDay() === 6 ? ' sat' : '') + (ds === today ? ' today' : ''), 'data-date': ds },
          el('span', { class: 'cd-num', text: String(d.getDate()) }), n ? el('span', { class: 'cd-n', text: n + '件' }) : null);
        cell.addEventListener('dragover', function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; this.classList.add('drop'); });
        cell.addEventListener('dragleave', function () { this.classList.remove('drop'); });
        cell.addEventListener('drop', (function (date) { return function (ev) {
          ev.preventDefault();
          var p = S.drag; endDrag();
          if (p && p.t === 'todo') dropOnDate(p, date);
        }; })(ds));
        grid.appendChild(cell);
      }
      panel.appendChild(grid);
    }
    draw();
    // 左へ出ていったら閉じる（ToDoの列に戻したいときのため）
    panel.addEventListener('dragleave', function (ev) {
      if (panel.contains(ev.relatedTarget)) return;
      clearTimeout(calCloseTimer);
      calCloseTimer = setTimeout(function () { var p = document.getElementById('cal-drop'); if (p) p.remove(); }, 400);
    });
    panel.addEventListener('dragenter', function () { clearTimeout(calCloseTimer); });
    panel.addEventListener('dragover', function (ev) { ev.preventDefault(); clearTimeout(calCloseTimer); });
    document.body.appendChild(panel);
  }

  function dropOnDate(p, date) {
    if (p.t === 'todo') {
      api('todo_schedule', { body: { id: p.id, date: date } }).then(function () {
        toast('予定に追加しました（ToDoは「進行中」になりました）: ' + mdw(date)); loadTodos(); load();
      }).catch(fail);
    } else if (p.t === 'event') {
      var e = S.events.filter(function (x) { return x.id === p.id; })[0];
      var start = ymd(addDays(parse(date), -p.off));
      if (!e || e.start === start) return;
      api('event_move', { body: { id: p.id, start: start } }).then(function () {
        toast('予定を ' + mdw(start) + ' に動かしました'); load();
      }).catch(fail);
    }
  }


  /* ---------- 予定の追加・編集 ---------- */
  function openEventDialog(ev, dateStr) {
    if (SHARE || (ev && !ev.editable)) return openEventView(ev);
    var isNew = !ev;
    var kind = ev ? ev.kind : (S.view === 'me' ? 'private' : 'work');
    // 種類（業務・休み・プライベート）は、登録したあとからも変えられる。変えられるのは、予定の持ち主だけ
    var isOwner = !ev || ev.owner_id === S.me.user.id;
    var kinds = [['work', '業務'], ['off', '休み']];
    if (S.view === 'me' || (ev && (ev.kind === 'private' || isOwner))) kinds.push(['private', 'プライベート']);
    var KIND_NAME = { work: '業務', off: '休み', private: 'プライベート' };

    var radios = kinds.map(function (k) {
      return el('label', { class: k[0] }, el('input', { type: 'radio', name: 'kind', value: k[0], checked: k[0] === kind, disabled: !(isNew || isOwner), onchange: onKindChange }), k[1]);
    });
    var title = el('input', { name: 'title', maxlength: '100', value: ev ? ev.title : '' });
    var tag = el('select', { name: 'tag' });
    var tagLabel = el('label', null, '分類', tag);
    var owner = el('select', { name: 'owner_id' }, S.me.users.map(function (u) { return el('option', { value: String(u.id), text: u.name, selected: u.id === S.me.user.id }); }));
    var ownerLabel = el('label', null, '休みを取る人', owner);
    var start = el('input', { type: 'date', name: 'start', required: true, value: ev ? ev.start : dateStr });
    var end = el('input', { type: 'date', name: 'end', value: ev ? ev.end : dateStr });
    start.addEventListener('change', function () { if (!end.value || end.value < start.value) end.value = start.value; });
    var st = timeInput('start_time', ev ? ev.start_time : '');
    var et = timeInput('end_time', ev ? ev.end_time : '');
    var note = el('textarea', { name: 'note', maxlength: '500' });
    note.value = ev ? ev.note : '';
    var impCb = el('input', { type: 'checkbox', name: 'important', checked: !!(ev && ev.important), style: 'width:auto' });
    // ToDoリストにも入れる（進捗を選ぶ）。ToDoから置いた予定は、下の「ToDoの状態」で変えるので、ここには出さない
    var todoSel = el('select', { name: 'todo_status', 'aria-label': 'ToDoリストの進捗' },
      [['', '入れない'], ['todo', '未着手'], ['doing', '進行中'], ['done', '完了']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var todoLabel = el('label', { class: 'todo-opt' }, 'ToDoリストにも入れる（進捗）', todoSel,
      ev && ev.recurring ? el('span', { class: 'hint', text: 'この回だけが ToDo になります（保存すると、この回は、あとでルールを変えても変わらなくなります）。' }) : null);
    var hint = el('p', { class: 'hint' });
    var famTouched = false;
    var famCb = el('input', { type: 'checkbox', name: 'family_shared', checked: ev ? ev.family_shared !== false : true, style: 'width:auto', onchange: function () { famTouched = true; } });
    var famText = el('span');
    var famNote = el('p', { class: 'hint', style: 'margin:-6px 0 0' });
    var famLabel = el('label', { class: 'check', title: '共有リンク（家族用）で見られるか' }, famCb, famText);
    // 他の人の予定を管理者が編集するとき、家族への共有は持ち主だけが決める
    var famOwnerOnly = !!ev && ev.owner_id !== S.me.user.id;
    // 本人が「共有リンク」で、休みや業務の分類を“まとめて共有”にしているか
    function famByScope(k) {
      var fs = S.me.family_share || { off: false, tags: [] };
      return k === 'off' ? fs.off : k === 'work' ? fs.tags.indexOf(tag.value) >= 0 : false;
    }
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    // 毎月くり返す業務は、「繰り返し業務」として登録すると自動で入る。その入口を、入力画面にも出す
    var repeatHint = el('p', { class: 'hint' });
    var linkTo = function (label, fn) { return el('a', { href: '#', text: label, onclick: function (e) { e.preventDefault(); fn(); } }); };
    function syncRepeat() {
      repeatHint.textContent = '';
      if (ev && ev.recurring) {
        repeatHint.appendChild(document.createTextNode('↻ 毎月の繰り返しから作られた予定です。この回を編集すると、以後ルールを変更してもこの回は変わりません。 '));
        repeatHint.appendChild(linkTo('繰り返しのルールを見る・変える', function () { ov.close(); openSeriesDialog(); }));
      } else if (curKind() === 'work') {
        repeatHint.appendChild(document.createTextNode('毎月くり返す業務は、 '));
        repeatHint.appendChild(linkTo('「繰り返し業務」として登録', function () {
          var pf = { title: title.value, tag: tag.value, start_time: timeVal(st), end_time: timeVal(et) };
          ov.close(); openSeriesForm(null, function () { load(); }, pf);
        }));
        repeatHint.appendChild(document.createTextNode(' すると、自動で毎月入ります。'));
      }
      repeatHint.hidden = !repeatHint.firstChild;
    }

    function curKind() { var c = form.querySelector('input[name=kind]:checked'); return c ? c.value : kind; }
    // 休み（件名が空だと「休み」で保存される）を、業務・プライベートに変えるときは、自動の件名「休み」を空にして、入力を促す
    function onKindChange() {
      if (ev && ev.kind === 'off' && curKind() !== 'off' && title.value === '休み') { title.value = ''; title.setAttribute('placeholder', '件名を入力してください'); title.focus(); }
      syncKind();
    }
    function syncKind() {
      var k = curKind();
      var tags = k === 'work' ? S.me.work_tags : k === 'off' ? S.me.off_tags : [];
      var cur = tag.value || (ev ? ev.tag : '');
      tag.textContent = '';
      tags.forEach(function (t) { tag.appendChild(el('option', { value: t, text: t, selected: t === cur })); });
      if (k === 'work' && !cur) tag.value = S.me.work_tags[0];
      tagLabel.hidden = k === 'private';
      syncFam();
      syncRepeat();
      ownerLabel.hidden = !(isNew && k === 'off' && S.me.user.role === 'admin');
      todoLabel.hidden = k === 'off' || !!(ev && (ev.todo_id || ev.owner_id !== S.me.user.id)); // 休み・ToDoと結びついた予定・他の人の予定には出さない
      hint.textContent = k === 'private' ? 'プライベートの予定は、本人以外の誰にも（管理者にも）表示されません。' :
        k === 'off' ? '休みは全員に表示されます。' : '業務の予定は全員に表示されます。';
      if (k === 'off' && !title.value) title.setAttribute('placeholder', '休み（空のままで可）');
      else if (title.value || !(ev && ev.kind === 'off')) title.removeAttribute('placeholder');
    }

    function syncFam() {
      var k = curKind();
      famLabel.hidden = famOwnerOnly;
      famText.textContent = k === 'private' ? '家族に共有する（共有リンクで見える）' : '家族にも共有する（家族用の共有リンクと、あなたのプライベート版に表示。メモ欄の内容も家族に見えます）';
      if (!famTouched) famCb.checked = (isNew || k !== kind) ? k === 'private' : ev.family_shared !== false; // 初期値: プライベートは共有する、業務・休みは共有しない（元の種類に戻したら、元の指定）
      var auto = !famOwnerOnly && famByScope(k);
      famCb.disabled = auto;
      if (auto) famCb.checked = true;
      famNote.hidden = !auto;
      famNote.textContent = auto ? '「共有リンク」の設定で、自分の' + (k === 'off' ? '休み' : '業務（' + tag.value + '）') + 'は全て家族に共有しています。' : '';
    }
    tag.addEventListener('change', syncFam);

    var save = function (e) {
      e.preventDefault();
      err.hidden = true;
      var body = {
        id: ev ? ev.id : null, kind: curKind(), title: title.value, tag: tag.value, start: start.value, end: end.value || start.value,
        start_time: timeVal(st), end_time: timeVal(et), note: note.value, important: impCb.checked
      };
      // 「まとめて共有」の範囲に入っている予定は、予定ごとの指定を変えない（範囲を外したときに、勝手に共有が残らないように）
      if (!famOwnerOnly) body.family_shared = famCb.disabled ? (ev ? ev.family_shared !== false : false) : famCb.checked;
      if (!ownerLabel.hidden) body.owner_id = owner.value;
      body.todo_status = todoLabel.hidden ? '' : todoSel.value;
      var kindChanged = !!ev && ev.kind !== body.kind;
      if (kindChanged && ev.kind === 'private' && !window.confirm('プライベートの予定を「' + KIND_NAME[body.kind] + '」に変えます。会社の全員に表示されます（メモの内容も）。' + 'よろしいですか？')) return;
      api('event_save', { body: body }).then(function () {
        ov.close(); toast(body.todo_status ? (isNew ? '予定を登録して、ToDoリストにも入れました（' : '予定をToDoリストにも入れました（') + TD_STATE_NAME[body.todo_status] + '）' : kindChanged ? '種類を「' + KIND_NAME[body.kind] + '」に変えて、保存しました' : isNew ? '予定を登録しました' : '予定を更新しました');
        if (body.todo_status) { loadTodos(); syncMemoTodos(); }
        if ((isNew || kindChanged) && body.kind === 'private' && S.view === 'team') toast('プライベートの予定は「プライベート版」に表示されます');
        load();
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    };
    var del = ev ? el('button', { class: 'btn danger left', type: 'button', text: '削除', onclick: function () {
      api('event_delete', { body: { id: ev.id } }).then(function (j) {
        ov.close(); load();
        var msg = ev.recurring ? 'この回を削除しました（毎月の繰り返し自体は残ります）' : '予定を削除しました';
        if (!j.undo) { toast(msg); return; }
        toastUndo(msg, function () { api('event_restore', { body: { undo: j.undo } }).then(function () { toast('予定を元に戻しました'); load(); loadTodos(); }).catch(fail); });
      }).catch(fail);
    } }) : null;

    var form = el('form', { class: 'form', onsubmit: save },
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '種類' }, radios),
      !(isNew || isOwner) ? el('p', { class: 'hint', style: 'margin:-6px 0 0', text: '種類を変えられるのは、予定の持ち主だけです。' }) : null,
      el('label', null, '件名', title),
      el('div', { class: 'row' }, tagLabel, ownerLabel),
      el('div', { class: 'row' }, el('label', null, '開始日', start), el('label', null, '終了日', end)),
      el('div', { class: 'row' }, el('label', null, '開始時刻（任意）', st), el('label', null, '終了時刻（任意）', et)),
      el('label', { class: 'check imp-opt' }, impCb, '★ 重要な予定にする（カレンダーで目立たせる）'),
      todoLabel,
      el('label', null, 'メモ（任意）', note),
      famLabel,
      famNote,
      hint,
      repeatHint,
      ev && ev.todo_id ? todoStateBox(ev, ev.owner_id === S.me.user.id) : null,
      ev && S.me.user.role === 'admin' && ev.owner_id !== S.me.user.id ? el('p', { class: 'hint', text: '持ち主: ' + ev.owner_name + '（管理者として編集しています）' }) : null,
      err,
      el('div', { class: 'actions' }, del,
        ev ? el('button', { class: 'btn', type: 'button', text: '複製', title: 'この予定を、他の日にも作る', onclick: function () { ov.close(); openDuplicateDialog(ev); } }) : null,
        ev && canReturnToTodo(ev) ? el('button', { class: 'btn', type: 'button', text: 'ToDoに戻す', title: '日付のない ToDo に戻す', onclick: function () { ov.close(); returnEventToTodo(ev.id, null, false); } }) : null,
        el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '保存' })));
    var ov = openModal(isNew ? '予定を追加' : '予定を編集', form);
    if (ev) tag.value = ev.tag;
    syncKind();
    if (ev) tag.value = ev.tag || tag.value;
  }

  /* ---------- ToDo ---------- */
  function loadTodos() {
    if (S.page === 'settings') return Promise.resolve();
    var view = S.view, seq = ++todoSeq;
    return api('todo_list', { params: { view: view } }).then(function (j) {
      S.tdCache[view] = j;
      if (seq !== todoSeq || view !== S.view) return; // 切り替えの途中で古い答えが届いたら、使わない
      applyTodos(j); renderTodo(); syncMemoTodos();
    }).catch(fail);
  }
  var todoSeq = 0;
  function applyTodos(j) { S.todos = j.todos; S.done = j.done || []; S.others = j.others || { todos: [], done: [] }; S.revTd = j.rev; }

  /* dragId を targetId の前（または後）へ。targetId が null なら末尾へ */
  function reorderTo(dragId, targetId, after) {
    var byId = {};
    S.todos.forEach(function (t) { byId[t.id] = t; });
    var ids = S.todos.map(function (t) { return t.id; }).filter(function (id) { return id !== dragId; });
    var i = targetId === null ? ids.length : ids.indexOf(targetId) + (after ? 1 : 0);
    ids.splice(i, 0, dragId);
    S.todos = ids.map(function (id) { return byId[id]; });
    renderTodo(); // 先に見た目を更新し、保存は裏で行う
    api('todo_reorder', { body: { ids: ids } }).catch(function (x) { fail(x); loadTodos(); });
  }

  /* 予定をToDoに戻す。targetId があれば、その位置に入れる */
  function returnEventToTodo(eventId, targetId, after) {
    return api('event_to_todo', { body: { id: eventId } }).then(function (j) {
      toast('ToDoに戻しました');
      load();
      return loadTodos().then(function () { if (targetId !== null && targetId !== undefined) reorderTo(j.todo.id, targetId, after); });
    }).catch(fail);
  }

  /* 細い欄（カレンダーの横）と、リストタブの管理画面の両方を描く */
  function renderTodo() {
    var tp = document.getElementById('todo-panel');
    if (tp && !tp.classList.contains('away') && !S.drag) renderTodoPanel(tp);
    var side = document.getElementById('todo');
    if (side) renderTodoInto(side, false);
    var mgr = document.getElementById('todo-mgr');
    if (mgr) renderTodoInto(mgr, true);
  }

  function setMode(m) {
    if (m === 'grid' && (SHARE || S.view !== 'team')) m = 'cal';
    S.mode = m; store('sched.mode', m);
    if (m !== 'list') { var c = S.cache[evKey(evParams())]; if (c) applyEvents(c); else S.events = []; } // 表示する人が違うと、読み込む予定も違う（休み表は、全員）
    renderToolbar(); renderBoard(); if (m !== 'list') load();
  }

  /* 自動更新などで描き直しても、入力中の文字・選んでいる種類・カーソルを失わないよう、描き直す前に控える */
  function captureTodoInput(box) {
    var i = box && box.querySelector('.todo-add input[type=text]');
    return i ? { focus: document.activeElement === i } : null;
  }

  /* ToDoの追加: 未着手の一番下の「＋ 追加」を押すと、その場に入力欄が開く（Enterで追加・Escで閉じる。続けて入力できる）。
     どの欄で開いているかは S.addIn（'mgr'=リスト画面 / 'panel'=カレンダー画面のToDo / 'side'）、入力途中の内容は S.addDrafts（欄ごと）に持つ */
  function addFocused(owner) {
    var a = document.activeElement;
    return !!(a && a.matches && a.matches('input[type=text]') && a.closest('.todo-add') && a.closest('[data-add-owner="' + owner + '"]'));
  }
  function todoAddControl(owner, refocus) {
    if (S.addIn !== owner) {
      return el('button', { class: 'todo-add-btn', type: 'button', text: '＋ 追加', title: 'ToDoを追加する',
        onclick: function () { S.addIn = owner; S.addFocus = owner; renderTodo(); var i = document.querySelector('[data-add-owner="' + owner + '"] input[type=text]'); if (i) { S.addFocus = null; i.focus(); } } });
    }
    var drafts = S.addDrafts || (S.addDrafts = {}), d = drafts[owner] || (drafts[owner] = { v: '', k: '', due: '' });
    var dueIn = el('input', { type: 'date', class: 'todo-due-in', 'aria-label': '期限日（任意）', title: '期限日（任意）', value: d.due || '', onchange: function () { d.due = dueIn.value; } });
    var input = el('input', { type: 'text', maxlength: '100', placeholder: 'やることを入力して Enter', 'aria-label': 'ToDoの内容', value: d.v,
      oninput: function () { d.v = input.value; },
      onkeydown: function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeTodoAdd(); } } });
    var kindSel = S.view === 'me' ? el('select', { 'aria-label': 'ToDoの種類', onchange: function () { d.k = kindSel.value; } }, el('option', { value: 'private', text: 'プライベート（自分だけ）' }), el('option', { value: 'work', text: '業務（全員に見える）' })) : null;
    if (kindSel && d.k) kindSel.value = d.k;
    var form = el('form', { class: 'todo-add', 'data-add-owner': owner, onsubmit: function (e) {
      e.preventDefault();
      if (!input.value.trim()) return;
      api('todo_save', { body: { title: input.value, kind: kindSel ? kindSel.value : 'work', due: dueIn.value } }).then(function () { d.v = ''; d.due = ''; S.addFocus = owner; loadTodos(); }).catch(fail);
    } }, input,
      el('div', { class: 'todo-add-row' }, kindSel, dueIn, el('span', { class: 'spacer' }),
        el('button', { class: 'btn small ghost', type: 'button', text: 'キャンセル', onclick: closeTodoAdd }),
        el('button', { class: 'btn primary small', type: 'submit', text: '追加' })));
    if (refocus || S.addFocus === owner) { S.addFocus = null; setTimeout(function () { input.focus(); }, 0); }
    return form;
  }
  function closeTodoAdd() { if (S.addDrafts && S.addIn) delete S.addDrafts[S.addIn]; S.addIn = null; renderTodo(); }

  function renderTodoInto(box, full, keepFrom) {
    var owner = box.id === 'todo-mgr' ? 'mgr' : 'side';
    var refocus = keepFrom ? !!keepFrom.focus : addFocused(owner);
    box.textContent = '';
    var list = el('div', { class: 'todo-list' });
    S.todos.forEach(function (t) { list.appendChild(todoItem(t)); });
    if (!S.todos.length) list.appendChild(el('p', { class: 'todo-empty', text: '未完了のToDoはありません。' }));
    if (!full) list.appendChild(todoAddControl(owner, refocus));

    var over = overdueCount(S.todos);
    box.appendChild(el('h2', null, 'ToDo' + (S.todos.length ? '（' + S.todos.length + '）' : ''), over ? el('span', { class: 'pill due over', style: 'margin-left:8px;font-size:12px', text: '期限切れ ' + over, title: '期限日を過ぎた ToDo の数' }) : null));
    if (full) {
      box.appendChild(helpText((S.view === 'team' ? '業務のToDoです（全員に見えます。変えられるのは持ち主だけです）。' : 'プライベートのToDoは、あなただけに見えます（種類が「業務」のToDoは、全員に見えます）。') + 'カードをドラッグして、列（未着手・進行中・完了）を移せます。カードを画面の右端まで持っていくと、カレンダーが開いて、日付に落として予定にできます。カレンダーの予定を画面の右端へ持っていくと、ToDoに戻せます。スマホでは、カードのボタン（列の移動・「日付」）を使います。'));
      if (S.view === 'team') box.appendChild(todoWhoBar());
      box.appendChild(renderKanban(refocus));
    } else {
      box.appendChild(el('p', { class: 'hint', text: S.view === 'team' ? '業務のToDoです（あなただけに見えます）。左のチェックで完了にすると、リストから消えて「完了」に移ります。' : 'あなただけに見えるToDoです。左のチェックで完了にすると、リストから消えて「完了」に移ります。' }));
      box.appendChild(list);
    }

    if (!full) {
      box.appendChild(el('p', { class: 'hint todo-foot' }, 'カレンダーの日付へドラッグすると予定になり、予定をここへドラッグするとToDoに戻ります。',
        el('br'), el('a', { href: '#', text: S.done.length ? '完了したToDo（' + S.done.length + '件）を見る・管理する' : 'リストでToDoを管理する', onclick: function (e) { e.preventDefault(); setMode('list'); } })));
    }

    // 欄の空いたところへのドロップ（末尾に入る）
    box.ondragover = function (ev) {
      if (full || !S.drag || !(S.drag.t === 'todo' || (S.drag.t === 'event' && S.drag.ok))) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; box.classList.add('drop');
    };
    box.ondragleave = function (ev) { if (!box.contains(ev.relatedTarget)) box.classList.remove('drop'); };
    box.ondrop = function (ev) {
      if (!S.drag || full) return;
      ev.preventDefault();
      var p = S.drag; box.classList.remove('drop'); endDrag();
      if (p.t === 'todo') reorderTo(p.id, null, false); else if (p.t === 'event' && p.ok) returnEventToTodo(p.id, null, false);
    };
  }

  /* ---------- ToDoのカンバン（リストタブ） ---------- */
  var KANBAN = [['todo', '未着手'], ['doing', '進行中'], ['done', '完了']];

  /* ToDoを、列 status の targetId の前（after なら後ろ）へ移す。targetId が null なら列の末尾 */
  function moveTodo(id, status, targetId, after) {
    var t = null;
    S.todos.forEach(function (x) { if (x.id === id) t = x; });
    S.done.forEach(function (x) { if (x.id === id) t = x; });
    if (!t) return;
    var before = t.status;
    if (targetId === id || (before === 'done' && status === 'done')) return;
    S.todos = S.todos.filter(function (x) { return x.id !== id; });
    S.done = S.done.filter(function (x) { return x.id !== id; });
    t.status = status;
    var ids = null;
    if (status === 'done') {
      t.done_at = (function (d) { return ymd(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':00'; })(new Date());
      S.done.unshift(t);
    } else {
      t.done_at = null;
      var col = S.todos.filter(function (x) { return x.status === status; }).map(function (x) { return x.id; });
      var i = targetId === null || targetId === undefined ? col.length : col.indexOf(targetId) + (after ? 1 : 0);
      if (i < 0) i = col.length;
      col.splice(i, 0, id);
      ids = col;
      var rest = S.todos.filter(function (x) { return x.status !== status; });
      var byId = {};
      S.todos.forEach(function (x) { byId[x.id] = x; });
      byId[id] = t;
      S.todos = rest.concat(col.map(function (x) { return byId[x]; }));
    }
    renderTodo(); // 先に見た目を更新し、保存は裏で行う
    var body = { id: id, status: status };
    if (ids) body.ids = ids;
    api('todo_status', { body: body }).then(function () {
      if (status === 'done' && before !== 'done') toast('完了にしました: ' + t.title);
      else if (status !== before) toast((status === 'doing' ? '進行中にしました: ' : '未着手に戻しました: ') + t.title);
      if (t.sched && (status === 'done' || before === 'done')) load(); // カレンダーに置いたToDoは、完了で取り消し線、戻すと線が消える
      loadTodos();
      syncMemoTodos();
    }).catch(function (x) { fail(x); loadTodos(); });
  }

  function kanbanCard(t, status) {
    var move = function (label, title, to) { return el('button', { class: 'btn small ghost', type: 'button', text: label, title: title, onclick: function (e) { e.stopPropagation(); moveTodo(t.id, to, null, false); } }); };
    var acts = [];
    if (status === 'todo') acts.push(move('進行中へ ▶', '進行中にする', 'doing'));
    if (status === 'doing') { acts.push(move('◀ 未着手', '未着手に戻す', 'todo')); acts.push(move('完了 ✓', '完了にする', 'done')); }
    if (status === 'done') acts.push(move('◀ 戻す', '未着手に戻す', 'todo'));
    if (status !== 'done') {
      acts.push(el('button', { class: 'btn small ghost', type: 'button', text: '日付', title: '日付を選んで、カレンダーの予定にする', onclick: function (e) { e.stopPropagation(); openTodoScheduleDialog(t); } }));
      acts.push(el('button', { class: 'btn small ghost', type: 'button', text: '編集', onclick: function (e) { e.stopPropagation(); openTodoDialog(t); } }));
    }
    acts.push(el('button', { class: 'btn small ghost', type: 'button', text: '日報へ', title: '当日の日報に、この行を入れる（ドラッグでも入れられます。完了なら取り消し線）', onclick: function (e) {
      e.stopPropagation();
      memoAddTodo(t, 'cur');
    } }));
    if (t.kind === 'work') acts.push(el('button', { class: 'btn small ghost', type: 'button', text: 'コメント', title: 'コメントを見る・書く（業務のToDoは、全員がコメントできます）', onclick: function (e) { e.stopPropagation(); openTodoThread(t); } }));
    acts.push(el('button', { class: 'btn small ghost', type: 'button', text: '削除', onclick: function (e) {
      e.stopPropagation();
      deleteTodo(t);
    } }));
    var card = el('div', { class: 'todo-item kb-card ' + t.kind + (status === 'done' ? ' done' : ''), draggable: 'true', 'data-id': String(t.id) },
      el('div', { class: 't-body' },
        el('div', { class: 't-title', text: t.title }),
        el('div', { class: 't-main' },
          t.kind === 'private' ? el('span', { class: 'pill private', text: 'プライベート' }) : (t.tag ? el('span', { class: 'pill', text: t.tag }) : null),
          status === 'done' && t.done_at ? el('span', { class: 'pill', text: mdw(t.done_at.slice(0, 10)).replace(/（.*）/, '') + ' 完了' }) : null, dueBadge(t), schedBadge(t), tcBadge(t)),
        el('div', { class: 't-actions' }, acts)));
    card.addEventListener('dragstart', function (ev) { startDrag(ev, { t: 'todo', id: t.id }); });
    card.addEventListener('dragend', endDrag);
    card.addEventListener('dragover', function (ev) {
      if (!S.drag || !((S.drag.t === 'todo' && S.drag.id !== t.id) || (S.drag.t === 'event' && S.drag.ok && status !== 'done'))) return;
      ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.ins-before, .ins-after, .kb-col.drop').forEach(function (x) { x.classList.remove('ins-before', 'ins-after', 'drop'); });
      if (status === 'done') { card.closest('.kb-col').classList.add('drop'); return; } // 完了の列は、並びを持たない
      var r = card.getBoundingClientRect();
      card.classList.add(ev.clientY > r.top + r.height / 2 ? 'ins-after' : 'ins-before');
    });
    card.addEventListener('dragleave', function () { card.classList.remove('ins-before', 'ins-after'); });
    card.addEventListener('drop', function (ev) {
      if (!S.drag || !(S.drag.t === 'todo' || (S.drag.t === 'event' && S.drag.ok && status !== 'done'))) return;
      ev.preventDefault(); ev.stopPropagation();
      var r = card.getBoundingClientRect(), after = ev.clientY > r.top + r.height / 2, p = S.drag;
      endDrag();
      if (p.t === 'event') { eventToKanban(p.id, status, t.id, after); return; } // リストの予定を、カードの前後へ
      moveTodo(p.id, status, status === 'done' ? null : t.id, after);
    });
    return card;
  }

  /* 業務のToDoは、全員に見える（見るだけ）。業務版のリスト画面で、「自分だけ／全員／○○さん」を選べる */
  function todoWho() { var w = S.todoWho; return w === 'me' || (w && S.me.users.some(function (u) { return String(u.id) === String(w) && u.id !== S.me.user.id; })) ? String(w) : 'all'; }
  function othersIn(status) {
    if (S.view !== 'team') return [];
    var w = todoWho();
    if (w === 'me') return [];
    var src = status === 'done' ? S.others.done : S.others.todos.filter(function (t) { return t.status === status; });
    return src.filter(function (t) { return w === 'all' || String(t.owner_id) === w; });
  }
  function othersCard(t) {
    var card = el('div', { class: 'todo-item kb-card work other' + (t.status === 'done' ? ' done' : ''), 'data-id': String(t.id), tabindex: '0', role: 'button', title: 'クリックで内容を見る・コメントする（編集・完了はできません。' + t.owner_name + 'さんのToDo）',
      onclick: function () { openOthersTodo(t); }, onkeydown: function (e) { if (e.key === 'Enter') openOthersTodo(t); } },
      el('div', { class: 't-body' },
        el('div', { class: 't-title', text: t.title }),
        el('div', { class: 't-main' }, el('span', { class: 'pill owner', text: t.owner_name }), t.tag ? el('span', { class: 'pill', text: t.tag }) : null, dueBadge(t), tcBadge(t),
          t.status === 'done' && t.done_at ? el('span', { class: 'pill', text: mdw(t.done_at.slice(0, 10)).replace(/（.*）/, '') + ' 完了' }) : null)));
    return card;
  }
  /* ToDoのコメント。業務のToDoは全員に見えるので、持ち主以外もコメントを付けられる（編集・完了はできない） */
  function tcSeenKey(t) { return 'sched.tcseen.' + t.id; }
  function tcNew(t) { return !!t.comments && (t.last_comment_id || 0) > (Number(store(tcSeenKey(t))) || 0); }
  /* ToDoの期限日。期限切れは赤、今日・明日までは橙、それ以外は灰色。完了したものは、日付だけ（急かさない） */
  function dueDays(t) { var a = t.due.split('-'); return Math.round((new Date(+a[0], +a[1] - 1, +a[2]) - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000); }
  function dueBadge(t) {
    if (!t.due) return null;
    var md = (+t.due.slice(5, 7)) + '/' + (+t.due.slice(8, 10));
    if (t.status === 'done') return el('span', { class: 'pill due', text: '期限 ' + md, title: '期限日 ' + t.due });
    var d = dueDays(t);
    var text = d < 0 ? '期限切れ ' + (-d) + '日' : d === 0 ? '今日まで' : d === 1 ? '明日まで' : '期限 ' + md;
    return el('span', { class: 'pill due' + (d < 0 ? ' over' : d <= 1 ? ' soon' : ''), text: text, title: '期限日 ' + t.due });
  }
  function overdueCount(list) { return (list || []).filter(function (t) { return t.due && t.status !== 'done' && dueDays(t) < 0; }).length; }
  /* カレンダーに置いたToDoの、置いた日 */
  function schedBadge(t) { return t.sched ? el('span', { class: 'pill sched', text: '📅 ' + mdw(t.sched).replace(/（.*）/, ''), title: 'カレンダーの ' + mdw(t.sched) + ' に置いてあります' }) : null; }
  function tcBadge(t) {
    if (t.kind === 'private' || !t.comments) return null;
    return el('span', { class: 'pill tc' + (tcNew(t) ? ' new' : ''), text: '💬 ' + t.comments, title: 'コメント ' + t.comments + '件' + (tcNew(t) ? '（新着あり）' : '') });
  }
  /* 画像（スクリーンショットなど）を、送る前に縮める。長辺1600pxまで、1枚およそ900KB以下（サーバーの受け取り上限に収まるように）。
     結果は { blob, url（小さなプレビュー用）, name } */
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { reject(new Error('画像（PNG・JPEG・GIF・WebP）だけ添付できます。')); return; }
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('画像を読み込めませんでした。')); };
      fr.onload = function () {
        var im = new Image();
        im.onerror = function () { reject(new Error('画像を読み込めませんでした。')); };
        im.onload = function () {
          var MAX = 1600, w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, MAX / Math.max(w, h));
          var cv = document.createElement('canvas'), ctx = cv.getContext('2d');
          var draw = function (scale) { cv.width = Math.max(1, Math.round(w * scale)); cv.height = Math.max(1, Math.round(h * scale)); ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0, cv.width, cv.height); };
          var LIMIT = 900 * 1024;
          var toBlob = function (type, q) { return new Promise(function (res) { cv.toBlob(res, type, q); }); };
          var step = function (scale) {
            draw(scale);
            return toBlob('image/png').then(function (b) {
              if (b && b.size <= LIMIT) return b;
              // 大きいときは、白い背景にして JPEG にする（写真・大きなスクリーンショット）
              var c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; var x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, c2.width, c2.height); x2.drawImage(cv, 0, 0);
              var tryQ = function (q) { return new Promise(function (res) { c2.toBlob(res, 'image/jpeg', q); }).then(function (jb) { return jb && (jb.size <= LIMIT || q <= 0.5) ? jb : tryQ(q - 0.15); }); };
              return tryQ(0.85).then(function (jb) { return jb.size <= LIMIT || scale < 0.3 ? jb : step(scale * 0.75); });
            });
          };
          step(k).then(function (blob) {
            var th = document.createElement('canvas'), tk = Math.min(1, 160 / Math.max(cv.width, cv.height)); th.width = Math.max(1, Math.round(cv.width * tk)); th.height = Math.max(1, Math.round(cv.height * tk));
            th.getContext('2d').drawImage(cv, 0, 0, th.width, th.height);
            var ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
            resolve({ blob: blob, url: th.toDataURL('image/png'), name: (file.name || 'screenshot').replace(/\.[^.]*$/, '') + '.' + ext });
          }, reject);
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function openImageViewer(f) {
    var img = el('img', { src: 'api.php?action=todo_file&id=' + f.id, alt: f.name || '添付画像', class: 'tc-big' });
    var ov = openModal('画像', el('div', { class: 'form' }, img,
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: 'api.php?action=todo_file&id=' + f.id, target: '_blank', rel: 'noopener', text: '別のタブで開く' }), el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }))), true);
    ov.outsideClose = true;
  }
  function openTodoThread(t) {
    var mine = t.owner_id === undefined || t.owner_id === S.me.user.id;
    var body = el('div', { class: 'form tc-dialog' });
    var ov = openModal('ToDo' + (mine ? '' : '（' + t.owner_name + 'さん）'), body);
    ov.outsideClose = true;
    var pending = []; // 添付する画像（送る前）。{ blob, url, name }
    var ta = el('textarea', { maxlength: '500', rows: '3', placeholder: 'コメントを入力（Ctrl + Enter で送信）。スクリーンショットは、貼り付け（Ctrl + V）できます', 'aria-label': 'コメント' });
    var fileIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true, onchange: function () { addFiles(fileIn.files); fileIn.value = ''; } });
    var thumbs = el('div', { class: 'tc-pending' });
    var sending = false;
    function drawThumbs() {
      thumbs.textContent = '';
      pending.forEach(function (p, i) {
        thumbs.appendChild(el('span', { class: 'tc-pend' }, el('img', { src: p.url, alt: p.name }),
          el('button', { class: 'tc-x', type: 'button', 'aria-label': '画像を外す', text: '×', onclick: function () { pending.splice(i, 1); drawThumbs(); } })));
      });
    }
    function addFiles(list) {
      var files = Array.prototype.slice.call(list || []).filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      if (pending.length + files.length > 3) { toast('1つのコメントに付けられる画像は、3枚までです'); files = files.slice(0, Math.max(0, 3 - pending.length)); }
      files.reduce(function (pr, f) { return pr.then(function () { return shrinkImage(f).then(function (r) { pending.push(r); drawThumbs(); }); }); }, Promise.resolve()).catch(fail);
    }
    ta.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [], imgs = [];
      for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) imgs.push(items[i].getAsFile());
      if (imgs.length) { e.preventDefault(); addFiles(imgs); }
    });
    body.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); body.classList.add('tc-drop'); } });
    body.addEventListener('dragleave', function (e) { if (!body.contains(e.relatedTarget)) body.classList.remove('tc-drop'); });
    body.addEventListener('drop', function (e) { body.classList.remove('tc-drop'); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
    function send() {
      var v = ta.value.trim();
      if ((!v && !pending.length) || sending) return;
      sending = true;
      var done = function (r) { sending = false; ta.value = ''; pending = []; drawThumbs(); store(tcSeenKey(t), r.comment_id); refresh(); loadTodos(); };
      var err = function (x) { sending = false; fail(x); };
      if (pending.length) {
        var fd = new FormData();
        fd.append('id', String(t.id)); fd.append('body', v);
        pending.forEach(function (p) { fd.append('files[]', p.blob, p.name); });
        api('todo_comment_upload', { form: fd }).then(done, err);
      } else {
        api('todo_comment_add', { body: { id: t.id, body: v } }).then(done, err);
      }
    }
    function refresh() {
      api('todo_comments', { params: { id: String(t.id) } }).then(function (j) {
        var first = !body.querySelector('.detail');
        var typed = ta.value;
        body.textContent = '';
        body.appendChild(el('dl', { class: 'detail' }, el('dt', { text: '内容' }), el('dd', { text: t.title }),
          el('dt', { text: '状態' }), el('dd', { text: j.todo.status === 'done' ? '完了' : j.todo.status === 'doing' ? '進行中' : '未着手' }),
          t.tag ? el('dt', { text: '分類' }) : null, t.tag ? el('dd', { text: t.tag }) : null,
          !mine && t.note ? el('dt', { text: 'メモ' }) : null, !mine && t.note ? el('dd', { text: t.note, style: 'white-space:pre-wrap' }) : null));
        if (!mine) body.appendChild(el('p', { class: 'hint', text: '業務のToDoは全員に見えます。変えられるのは' + t.owner_name + 'さんだけですが、コメントは誰でも付けられます。' }));
        body.appendChild(el('h4', { class: 'tc-h', text: 'コメント（' + j.comments.length + '件）' }));
        body.appendChild(j.comments.length ? el('ul', { class: 'tc-list' }, j.comments.map(function (c) {
          return el('li', { class: 'tc-item' },
            el('div', { class: 'tc-top' }, el('b', { text: c.author_name }), el('span', { class: 'tc-at', text: fmtAt(c.at) }),
              c.can_delete ? el('button', { class: 'btn small ghost danger', type: 'button', text: '削除', onclick: function () {
                if (!window.confirm('このコメントを削除します' + (c.files.length ? '（画像も消えます）' : '') + '。よろしいですか？')) return;
                api('todo_comment_delete', { body: { id: c.id } }).then(function () { refresh(); loadTodos(); }).catch(fail);
              } }) : null),
            c.body ? el('div', { class: 'tc-body', text: c.body }) : null,
            c.files.length ? el('div', { class: 'tc-files' }, c.files.map(function (f) {
              var im = el('img', { src: 'api.php?action=todo_file&id=' + f.id, alt: f.name || '添付画像', loading: 'lazy', onclick: function () { openImageViewer(f); } });
              im.addEventListener('error', function () { im.replaceWith(el('span', { class: 'muted', text: '（画像が見つかりません）' })); });
              return el('button', { class: 'tc-thumb', type: 'button', title: '大きく見る', 'aria-label': '画像を大きく見る' }, im);
            })) : null);
        })) : el('p', { class: 'muted', text: 'まだコメントはありません。' }));
        ta.value = typed;
        body.appendChild(ta);
        body.appendChild(thumbs);
        body.appendChild(el('div', { class: 'actions' },
          el('button', { class: 'btn left', type: 'button', text: '📎 画像を添付', title: '画像（スクリーンショットなど）を3枚まで。貼り付け（Ctrl + V）やドラッグでも添付できます', onclick: function () { fileIn.click(); } }), fileIn,
          el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }),
          el('button', { class: 'btn primary', type: 'button', text: 'コメントを送る', onclick: send })));
        if (j.comments.length) { store(tcSeenKey(t), j.comments[j.comments.length - 1].id); loadTodosQuiet(); }
        if (first) setTimeout(function () { ta.focus(); }, 0);
      }).catch(fail);
    }
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    refresh();
  }
  function loadTodosQuiet() { setTimeout(function () { renderTodo(); }, 0); } /* 「新着」の目印を消すため、描き直すだけ */
  function openOthersTodo(t) { openTodoThread(t); }
  function todoWhoBar() {
    var sel = el('select', { 'aria-label': '表示するToDo', onchange: function () { S.todoWho = sel.value; renderTodo(); } },
      el('option', { value: 'all', text: '全員のToDo' }), el('option', { value: 'me', text: '自分のToDo' }),
      S.me.users.filter(function (u) { return u.id !== S.me.user.id; }).map(function (u) { return el('option', { value: String(u.id), text: u.name + 'さん' }); }));
    sel.value = todoWho();
    return el('div', { class: 'todo-who' }, el('label', { class: 'inline' }, '表示:', sel));
  }
  function renderKanban(refocus) {
    var tab = store('sched.kbTab');
    if (tab !== 'todo' && tab !== 'doing' && tab !== 'done') tab = S.todos.some(function (t) { return t.status === 'doing'; }) || !S.todos.length ? 'doing' : 'todo'; // 選んだことがなければ、進行中があれば進行中、なければ未着手
    var wrap = el('div', { class: 'kanban', 'data-tab': tab });
    // スマホ幅では、列を並べず、状態をタブで切り替える（幅が広いときは隠れる）
    var tabs = el('div', { class: 'kb-tabs', role: 'tablist', 'aria-label': 'ToDoの状態' });
    KANBAN.forEach(function (c) {
      var n = (c[0] === 'done' ? S.done.length : S.todos.filter(function (t) { return t.status === c[0]; }).length) + othersIn(c[0]).length;
      tabs.appendChild(el('button', { type: 'button', role: 'tab', class: 'kb-tab ' + c[0], 'aria-selected': c[0] === tab ? 'true' : 'false',
        text: c[1] + ' ' + n, onclick: function () {
          store('sched.kbTab', c[0]); wrap.setAttribute('data-tab', c[0]);
          tabs.querySelectorAll('.kb-tab').forEach(function (b) { b.setAttribute('aria-selected', b === this ? 'true' : 'false'); }, this);
        } }));
    });
    wrap.appendChild(tabs);
    KANBAN.forEach(function (c) {
      var status = c[0], items = status === 'done' ? S.done : S.todos.filter(function (t) { return t.status === status; });
      var oth = othersIn(status);
      var col = el('div', { class: 'kb-col ' + status, 'data-status': status },
        el('h3', null, c[1], el('span', { class: 'cnt', text: String(items.length + oth.length) })));
      items.forEach(function (t) { col.appendChild(kanbanCard(t, status)); });
      if (!items.length && !oth.length) col.appendChild(el('p', { class: 'todo-empty', text: status === 'done' ? 'ここに移すと完了になります。' : status === 'doing' ? 'ここへドラッグすると進行中になります。' : 'ToDoはありません。' }));
      if (oth.length) { // 業務版: 他の人の業務のToDo（見るだけ）
        col.appendChild(el('div', { class: 'kb-others-h', text: '他の人のToDo' }));
        oth.forEach(function (t) { col.appendChild(othersCard(t)); });
      }
      if (status === 'todo') col.appendChild(todoAddControl('mgr', refocus)); // 未着手の一番下に「＋ 追加」
      if (status === 'done' && items.length) {
        col.appendChild(el('button', { class: 'btn small danger', type: 'button', text: '完了をすべて削除', onclick: function () {
          if (!window.confirm('完了したToDo ' + S.done.length + '件を、すべて削除します。元に戻せません。よろしいですか？')) return;
          api('todo_clear_done', { body: { view: S.view } }).then(function (j) { toast(j.deleted + '件を削除しました'); loadTodos(); }).catch(fail);
        } }));
      }
      col.addEventListener('dragover', function (ev) {
        if (!S.drag || !(S.drag.t === 'todo' || (S.drag.t === 'event' && S.drag.ok && status !== 'done'))) return;
        ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; col.classList.add('drop');
      });
      col.addEventListener('dragleave', function (ev) { if (!col.contains(ev.relatedTarget)) col.classList.remove('drop'); });
      col.addEventListener('drop', function (ev) {
        if (!S.drag || !(S.drag.t === 'todo' || (S.drag.t === 'event' && S.drag.ok && status !== 'done'))) return;
        ev.preventDefault(); ev.stopPropagation();
        var p = S.drag; endDrag();
        if (p.t === 'event') { eventToKanban(p.id, status, null, false); return; }
        moveTodo(p.id, status, null, false);
      });
      wrap.appendChild(col);
    });
    return wrap;
  }

  function setDone(t, done) {
    api('todo_done', { body: { id: t.id, done: done } }).then(function () {
      toast(done ? '完了にしました: ' + t.title : '未完了に戻しました: ' + t.title);
      if (t.sched) load();
      loadTodos();
    }).catch(function (x) { fail(x); loadTodos(); });
  }

  function doneItem(t) {
    return el('div', { class: 'todo-item done ' + t.kind },
      el('input', { type: 'checkbox', class: 't-check', checked: true, 'aria-label': '未完了に戻す', title: 'チェックを外すと、未完了に戻ります', onchange: function () { setDone(t, false); } }),
      el('div', { class: 't-body' },
        el('div', { class: 't-main' }, el('span', { class: 't-title', text: t.title }),
          el('span', { class: 'pill', text: t.done_at ? mdw(t.done_at.slice(0, 10)).replace(/（.*）/, '') + ' 完了' : '完了' })),
        el('div', { class: 't-actions' }, el('button', { class: 'btn small ghost', type: 'button', text: '削除', onclick: function () {
          deleteTodo(t);
        } }))));
  }

  /* ToDoを消す。「元に戻す」で戻せる（コメントのあるToDoは、コメントも消えて戻せないので、先に確かめる） */
  function deleteTodo(t) {
    if (t.comments && !window.confirm('このToDoには、コメント（' + t.comments + '件）があります。消すと、コメントも画像も消えて、元に戻せません。よろしいですか？')) return;
    api('todo_delete', { body: { id: t.id } }).then(function (j) {
      loadTodos(); load();
      if (!j.undo) { toast('ToDoを削除しました'); return; }
      toastUndo('ToDoを削除しました: ' + t.title, function () { api('todo_restore', { body: { undo: j.undo } }).then(function () { toast('ToDoを元に戻しました'); loadTodos(); load(); }).catch(fail); });
    }).catch(fail);
  }
  function todoItem(t) {
    var btn = function (label, title, fn) { return el('button', { class: 'btn small ghost', type: 'button', text: label, title: title, onclick: function (e) { e.stopPropagation(); fn(); } }); };
    var item = el('div', { class: 'todo-item ' + t.kind, draggable: 'true', 'data-id': String(t.id) },
      el('input', { type: 'checkbox', class: 't-check', 'aria-label': '完了にする', title: '完了にする（リストから消えて、「完了」に移ります）', onchange: function () { setDone(t, true); } }),
      el('div', { class: 't-body' },
        el('div', { class: 't-main' }, el('span', { class: 't-title', text: t.title }),
          t.status === 'doing' ? el('span', { class: 'pill doing', text: '進行中' }) : null,
          t.kind === 'private' ? el('span', { class: 'pill private', text: 'プライベート' }) : (t.tag ? el('span', { class: 'pill', text: t.tag }) : null), dueBadge(t)),
        el('div', { class: 't-actions' },
          btn('日付', '日付を選んで予定にする', function () { openTodoScheduleDialog(t); }),
          btn('編集', 'ToDoを編集', function () { openTodoDialog(t); }),
          btn('削除', 'ToDoを削除', function () {
            deleteTodo(t);
          }))));
    item.addEventListener('dragstart', function (ev) { startDrag(ev, { t: 'todo', id: t.id }); });
    item.addEventListener('dragend', endDrag);
    item.addEventListener('dragover', function (ev) {
      if (!S.drag || !((S.drag.t === 'todo' && S.drag.id !== t.id) || (S.drag.t === 'event' && S.drag.ok))) return;
      ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'move';
      var r = item.getBoundingClientRect(), after = ev.clientY > r.top + r.height / 2;
      document.querySelectorAll('.ins-before, .ins-after').forEach(function (x) { x.classList.remove('ins-before', 'ins-after'); });
      item.classList.add(after ? 'ins-after' : 'ins-before');
    });
    item.addEventListener('dragleave', function () { item.classList.remove('ins-before', 'ins-after'); });
    item.addEventListener('drop', function (ev) {
      if (!S.drag) return;
      ev.preventDefault(); ev.stopPropagation();
      var r = item.getBoundingClientRect(), after = ev.clientY > r.top + r.height / 2, p = S.drag;
      endDrag();
      if (p.t === 'todo') reorderTo(p.id, t.id, after); else if (p.t === 'event' && p.ok) returnEventToTodo(p.id, t.id, after);
    });
    return item;
  }

  function openTodoDialog(t) {
    var title = el('input', { name: 'title', maxlength: '100', required: true, value: t.title });
    var kinds = S.view === 'me' ? [['work', '業務'], ['private', 'プライベート']] : [['work', '業務']];
    var radios = kinds.map(function (k) { return el('label', { class: k[0] }, el('input', { type: 'radio', name: 'tkind', value: k[0], checked: t.kind === k[0], onchange: sync }), k[1]); });
    var tag = el('select', { name: 'tag' }, S.me.work_tags.map(function (x) { return el('option', { value: x, text: x, selected: x === t.tag }); }));
    var tagLabel = el('label', null, '分類（予定にしたときの分類）', tag);
    var note = el('textarea', { maxlength: '500' }); note.value = t.note || '';
    var due = el('input', { type: 'date', name: 'due', value: t.due || '' });
    var dueLabel = el('label', null, '期限日（任意）', el('div', { class: 'row-inline' }, due, el('button', { class: 'btn small ghost', type: 'button', text: '消す', onclick: function () { due.value = ''; } })));
    var famCb = el('input', { type: 'checkbox', checked: t.family_shared !== false, style: 'width:auto' });
    var famTouched = false; famCb.addEventListener('change', function () { famTouched = true; });
    var famText = el('span');
    var famLabel = el('label', { class: 'check' }, famCb, famText);
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    function kindNow() { var c = form.querySelector('input[name=tkind]:checked'); return c ? c.value : 'work'; }
    function sync() {
      var k = kindNow();
      tagLabel.hidden = k === 'private';
      famText.textContent = k === 'private' ? '家族に共有する（予定にしたとき、共有リンクで見える）' : '予定にしたとき、家族にも共有する';
      if (!famTouched && k !== t.kind) famCb.checked = k === 'private'; // 種類を変えたときは、その種類の初期値にする
    }
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('todo_save', { body: { id: t.id, title: title.value, kind: kindNow(), tag: tag.value, note: note.value, due: due.value, family_shared: famCb.checked } })
        .then(function () { ov.close(); toast('ToDoを更新しました'); loadTodos(); }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '種類' }, radios), el('label', null, '内容', title), tagLabel, dueLabel, el('label', null, 'メモ（任意）', note), famLabel, err,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '保存' })));
    var ov = openModal('ToDoを編集', form);
    sync();
  }

  function openTodoScheduleDialog(t) {
    var date = el('input', { type: 'date', required: true, value: ymd(new Date()) });
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('todo_schedule', { body: { id: t.id, date: date.value } }).then(function () {
        ov.close(); toast('予定に追加しました（ToDoは「進行中」になりました）: ' + mdw(date.value)); loadTodos(); load();
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('div', { class: 'notice' }, el('b', { text: t.title }), el('p', { text: (t.kind === 'private' ? 'プライベートの予定になります（本人以外には見えません）。' : '業務の予定になり、会社の全員に表示されます。') + 'ToDoは自動で「進行中」になり、完了にすると、カレンダーの予定に取り消し線が付きます。' })),
      el('label', null, '日付', date), err,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '予定にする' })));
    var ov = openModal('日付を選んで予定にする', form);
  }

  /* ---------- メモ（日報用） ----------
   * 書式は「改行」と「取り消し線」だけ。コピーすると、書式つき(HTML)と文字だけ(text)の両方がクリップボードに入る。
   * メールなど書式を受け付ける貼り付け先では取り消し線がそのまま残り、書式を受け付けない所でも、
   * 取り消し線の文字には「線の結合文字(U+0336)」が付くので、線が消えない。 */
  var memoEd = null, memoStatusEl = null, memoTimer = null, memoSig = null; // 日報の入力欄（1つ）、状態の表示、保存のタイマー、当日の項目の控え
  var STRIKE_TAGS = { S: 1, STRIKE: 1, DEL: 1 };
  var BLOCK_TAGS = /^(DIV|P|LI|TR|H[1-6]|UL|OL|TABLE|BLOCKQUOTE)$/;

  function escHtml(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* 貼り付けられた/保存された内容を、改行と取り消し線だけの安全なDOMにする */
  function cleanInto(n, out) {
    if (n.nodeType === 3) { out.appendChild(document.createTextNode(n.nodeValue)); return; }
    if (n.nodeType !== 1) return;
    var tag = n.nodeName.toUpperCase();
    if (/^(SCRIPT|STYLE|HEAD|TITLE|META|LINK|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|EMBED)$/.test(tag)) return;
    if (tag === 'BR') { out.appendChild(document.createElement('br')); return; }
    var target = out;
    if (BLOCK_TAGS.test(tag) && tag !== 'BODY') { var d = document.createElement('div'); out.appendChild(d); target = d; }
    var style = (n.getAttribute && n.getAttribute('style') || '').toLowerCase();
    if (STRIKE_TAGS[tag] || /line-through/.test(style)) { var sEl = document.createElement('s'); target.appendChild(sEl); target = sEl; }
    Array.prototype.forEach.call(n.childNodes, function (c) { cleanInto(c, target); });
  }
  function memoFragmentFromHtml(html) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    var frag = document.createDocumentFragment();
    cleanInto(doc.body, frag);
    return frag;
  }
  /* 保存された日報の本文 → 編集欄に入れる要素。行の印（日付の行・転記・ToDo）は、戻す */
  var MEMO_ATTRS = ['data-md', 'data-date', 'data-tr', 'data-todo', 'data-st'];
  function memoBuild(html) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html'), frag = document.createDocumentFragment();
    Array.prototype.forEach.call(doc.body.childNodes, function (n) {
      if (n.nodeType === 1 && n.nodeName === 'DIV') {
        var d = document.createElement('div'), inner = document.createDocumentFragment();
        MEMO_ATTRS.forEach(function (a) { if (n.hasAttribute(a)) d.setAttribute(a, n.getAttribute(a)); });
        Array.prototype.forEach.call(n.childNodes, function (c) { cleanInto(c, inner); });
        d.appendChild(inner);
        frag.appendChild(d);
      } else cleanInto(n, frag);
    });
    return frag;
  }

  /* 編集欄の中身を、行ごとの [{t:文字, s:取り消し線か}] にする。ToDoから入れた行には、行の .meta = { todo, st } が付く */
  function memoLines(root) {
    var lines = [], cur = [], meta = null;
    function flush() { cur.meta = meta; meta = null; lines.push(cur); cur = []; }
    function walk(n, strike, top) {
      if (n.nodeType === 3) { if (n.nodeValue) cur.push({ t: n.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' '), s: strike }); return; }
      if (n.nodeType !== 1) return;
      var tag = n.nodeName.toUpperCase();
      if (tag === 'BR') { flush(); return; }
      var blk = BLOCK_TAGS.test(tag);
      if (blk && cur.length) flush();
      if (blk && top) {
        var mt = null;
        if (tag === 'DIV') {
          var td = n.getAttribute('data-todo'), md = n.getAttribute('data-md');
          if (/^\d+$/.test(td || '')) mt = { todo: td, st: n.getAttribute('data-st') || '' };
          if (md === 'cur' || md === 'next') { mt = mt || {}; mt.md = md; mt.date = n.getAttribute('data-date') || ''; }
          if (n.getAttribute('data-tr') === '1') { mt = mt || {}; mt.tr = 1; }
        }
        meta = mt;
      }
      var st = strike || !!STRIKE_TAGS[tag] || /line-through/.test((n.getAttribute('style') || '').toLowerCase());
      Array.prototype.forEach.call(n.childNodes, function (c) { walk(c, st, false); });
      if (blk && cur.length) flush();
    }
    Array.prototype.forEach.call(root.childNodes, function (c) { walk(c, false, true); });
    if (cur.length) flush();
    while (lines.length && !lines[lines.length - 1].length) lines.pop(); // 末尾の空行は捨てる
    return lines;
  }
  function addStrikeChars(t) { return Array.from(t).map(function (ch) { return /\s/.test(ch) ? ch : ch + '̶'; }).join(''); }
  function metaAttr(m) {
    if (!m) return '';
    if ((m.md === 'cur' || m.md === 'next') && /^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) return ' data-md="' + m.md + '" data-date="' + m.date + '"';
    var a = '';
    if (/^\d+$/.test(m.todo || '')) { a += ' data-todo="' + m.todo + '"'; if (/^(todo|doing|done)$/.test(m.st)) a += ' data-st="' + m.st + '"'; }
    if (m.tr) a += ' data-tr="1"';
    return a;
  }
  function linesToSaveHtml(lines) {
    return lines.map(function (segs) {
      return '<div' + metaAttr(segs.meta) + '>' + (segs.length ? segs.map(function (g) { var t = escHtml(g.t); return g.s ? '<s>' + t + '</s>' : t; }).join('') : '<br>') + '</div>';
    }).join('');
  }
  /* 行を <br> でつないだ、1つの塊のHTML（カーソル位置への挿入用） */
  function linesToInlineHtml(lines) {
    return lines.map(function (segs) { return segs.map(function (g) { var t = escHtml(g.t); return g.s ? '<s>' + t + '</s>' : t; }).join(''); }).join('<br>');
  }
  /* メール等に貼るためのHTML。段落の余白をなくし、取り消し線は <s> と style の両方で指定（貼り付け先ごとの差を減らす） */
  function linesToClipHtml(lines) {
    return lines.map(function (segs) {
      return '<p style="margin:0;padding:0">' + (segs.length ? segs.map(function (g) {
        var t = escHtml(g.t); return g.s ? '<s style="text-decoration:line-through">' + t + '</s>' : t;
      }).join('') : '<br>') + '</p>';
    }).join('');
  }
  function linesToPlain(lines) {
    return lines.map(function (segs) { return segs.map(function (g) { return g.s ? addStrikeChars(g.t) : g.t; }).join(''); }).join('\n');
  }

  function memoSetStatus(t) { if (memoStatusEl) memoStatusEl.textContent = t; }
  function memoHtml() { return linesToSaveHtml(memoLines(memoEd)); }
  function saveMemoNow() {
    if (memoTimer) { clearTimeout(memoTimer); memoTimer = null; }
    if (!memoEd) return Promise.resolve();
    var html = memoHtml();
    if (S.memo) S.memo.html = html;
    return api('memo_save', { body: { html: html } }).then(function (j) { memoSetStatus('保存しました ' + j.saved_at); })
      .catch(function (x) { memoSetStatus('保存できませんでした: ' + x.message); });
  }
  function flushMemo() { if (memoTimer) saveMemoNow(); }

  /* ---- 日報の文章の構造: 「【日付】」の行（当日・次回出勤日）と、その下の項目の並び ---- */
  function mBlank(d) { return !d.textContent.trim(); }
  function mHead(kind) { return memoEd ? memoEd.querySelector(':scope > div[data-md="' + kind + '"]') : null; }
  function mStruck(d) { var ss = d.querySelectorAll('s,strike,del'); for (var i = 0; i < ss.length; i++) if (ss[i].textContent.trim()) return true; return false; }
  function mKey(d) { return d.textContent.trim() + '|' + (d.getAttribute('data-todo') || ''); }
  /* 見出しの下の項目: 見出しの次の行（空行が1つあれば、その次の行）から始まり、次の空行・見出しで終わる。
     items = 項目の行、ref = 項目がないときに新しい項目を入れる位置（この要素の前。なければ末尾）、after = 末尾に足すときの位置 */
  function mBlock(h) {
    var kids = Array.prototype.slice.call(memoEd.children), start = kids.indexOf(h) + 1;
    if (start < kids.length && mBlank(kids[start]) && !kids[start].hasAttribute('data-md')) start++;
    var k = start; while (k < kids.length && !mBlank(kids[k]) && !kids[k].hasAttribute('data-md')) k++;
    var items = kids.slice(start, k);
    var ref = items.length ? items[0] : (kids[start] || null);
    return { items: items, ref: ref, after: items.length ? items[items.length - 1].nextSibling : ref };
  }
  function mDiv(text, attrs) {
    var d = document.createElement('div');
    if (text) d.textContent = text; else d.appendChild(document.createElement('br'));
    Object.keys(attrs || {}).forEach(function (k) { d.setAttribute(k, attrs[k]); });
    return d;
  }
  function mHeadText(iso) { return '【' + (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) + '　予定・To Do】'; }
  function mHeadDiv(kind, iso) { var d = mDiv(mHeadText(iso), { 'data-md': kind, 'data-date': iso }); d.setAttribute('contenteditable', 'false'); return d; }
  function lockHeads() { memoEd.querySelectorAll(':scope > div[data-md]').forEach(function (h) { h.setAttribute('contenteditable', 'false'); }); }

  /* 当日の項目のうち、取り消し線のないものを、次回出勤日の項目に転記する（取り消し線のあるものは、転記しない）。変えたら true */
  function memoTranscribe() {
    var ch = mHead('cur'), nh = mHead('next');
    if (!ch || !nh) return false;
    var want = mBlock(ch).items.filter(function (d) { return !mStruck(d); });
    var manual = mBlock(nh).items.filter(function (d) { return !d.hasAttribute('data-tr'); }).map(function (d) { return d.textContent.trim(); });
    want = want.filter(function (d) { return manual.indexOf(d.textContent.trim()) < 0; }); // 次回出勤日に、同じ項目を自分で書いてあれば、足さない
    var have = Array.prototype.slice.call(memoEd.querySelectorAll(':scope > div[data-tr]'));
    if (want.map(mKey).join('\n') === have.map(mKey).join('\n')) return false;
    have.forEach(function (d) { d.remove(); });
    var blk = mBlock(nh);
    want.forEach(function (d) {
      var c = document.createElement('div');
      c.textContent = d.textContent.trim();
      if (d.getAttribute('data-todo')) { c.setAttribute('data-todo', d.getAttribute('data-todo')); c.setAttribute('data-st', d.getAttribute('data-st') || 'todo'); }
      c.setAttribute('data-tr', '1');
      memoEd.insertBefore(c, blk.ref);
    });
    return true;
  }
  /* 日付の行を、出勤日に合わせる。日が進んでいたら、次回出勤日の項目を、当日の項目にする（前の当日の項目は、取り消し線のないものが、すでに転記されている） */
  function memoReconcile(info) {
    var ch = mHead('cur'), nh = mHead('next');
    if (!ch || !nh) return false;
    var changed = false, was = ch.getAttribute('data-date');
    if (was && was < info.cur) {
      memoTranscribe();
      var moved = mBlock(nh).items;
      mBlock(ch).items.forEach(function (d) { d.remove(); });
      var ref = mBlock(ch).ref;
      moved.forEach(function (d) { d.removeAttribute('data-tr'); memoEd.insertBefore(d, ref); });
      changed = true;
    }
    [[ch, info.cur, 'cur'], [nh, info.next, 'next']].forEach(function (x) {
      if (x[0].getAttribute('data-date') === x[1] && x[0].textContent === mHeadText(x[1])) return;
      x[0].setAttribute('data-date', x[1]); x[0].textContent = mHeadText(x[1]); changed = true;
    });
    if (memoTranscribe()) changed = true;
    memoSig = memoCurSig();
    return changed;
  }
  function memoCurSig() { var ch = mHead('cur'); return ch ? mBlock(ch).items.map(function (d) { return mKey(d) + (mStruck(d) ? '~' : ''); }).join('\n') : ''; }

  /* 「【10/13　予定・To Do】」のような行（日付の入った【】だけの行）が、日付の行の印を持たないとき（貼り付けた文章など）、上の2つを、当日・次回出勤日の行にする。変えたら true */
  function memoAdoptHeads(info) {
    if (mHead('cur') || mHead('next') || !info) return false;
    var cand = Array.prototype.filter.call(memoEd.children, function (d) { return /^【\s*\d{1,2}\/\d{1,2}[^】]*】\s*$/.test(d.textContent.trim()); });
    if (cand.length < 2) return false;
    [[cand[0], 'cur', info.cur], [cand[1], 'next', info.next]].forEach(function (x) {
      x[0].setAttribute('data-md', x[1]); x[0].setAttribute('data-date', x[2]); x[0].setAttribute('contenteditable', 'false');
      MEMO_ATTRS.forEach(function (a) { if (a !== 'data-md' && a !== 'data-date') x[0].removeAttribute(a); });
      x[0].textContent = mHeadText(x[2]);
    });
    return true;
  }

  /* 貼り付け: 行ごとに、行（div）として、カーソルの位置へ入れる（行の途中なら、そこで分ける）。lines は memoLines の行 */
  function memoPasteLines(lines) {
    var sel = window.getSelection();
    if (!sel.rangeCount || !memoEd.contains(sel.anchorNode)) { var r0 = document.createRange(); r0.selectNodeContents(memoEd); r0.collapse(false); sel.removeAllRanges(); sel.addRange(r0); }
    var range = sel.getRangeAt(0);
    if (!range.collapsed) range.deleteContents();
    var blk = range.startContainer;
    while (blk && blk.parentNode !== memoEd) blk = blk.parentNode;
    var segsToNodes = function (segs) { return segs.map(function (g) { if (g.s) { var e = document.createElement('s'); e.textContent = g.t; return e; } return document.createTextNode(g.t); }); };
    var plain = function (d) { Array.prototype.forEach.call(d.querySelectorAll('br'), function (b) { if (d.textContent.trim() || d.childNodes.length > 1) b.remove(); }); };
    if (!blk || blk === memoEd || blk.nodeType !== 1 || blk.hasAttribute('data-md')) { // 見出しの行・欄の外: 次の行として入れる
      var after = blk && blk.nodeType === 1 ? blk.nextSibling : null, last = null;
      lines.forEach(function (segs) { var d = document.createElement('div'); segsToNodes(segs).forEach(function (n) { d.appendChild(n); }); if (!segs.length) d.appendChild(document.createElement('br')); memoEd.insertBefore(d, after); last = d; });
      if (last) { var rr = document.createRange(); rr.selectNodeContents(last); rr.collapse(false); sel.removeAllRanges(); sel.addRange(rr); }
      return;
    }
    var tailR = document.createRange(); tailR.setStart(range.startContainer, range.startOffset); tailR.setEnd(blk, blk.childNodes.length);
    var tail = tailR.extractContents(), cur = blk, nodesLast = [];
    lines.forEach(function (segs, i) {
      if (i > 0) { var d = document.createElement('div'); cur.parentNode.insertBefore(d, cur.nextSibling); cur = d; }
      nodesLast = segsToNodes(segs);
      nodesLast.forEach(function (n) { cur.appendChild(n); });
    });
    var mark = document.createTextNode(''); cur.appendChild(mark);
    cur.appendChild(tail);
    plain(blk); plain(cur);
    if (!cur.firstChild) cur.appendChild(document.createElement('br'));
    var rr2 = document.createRange(); rr2.setStartAfter(mark); rr2.collapse(true); sel.removeAllRanges(); sel.addRange(rr2);
    mark.remove();
  }

  function memoChanged() {
    var sig = memoCurSig();
    if (sig !== memoSig) { memoSig = sig; memoTranscribe(); } // 当日の項目が変わったら、次回出勤日の項目を作り直す
    if (S.memo) S.memo.html = memoHtml();
    memoSetStatus('編集中…');
    if (memoTimer) clearTimeout(memoTimer);
    memoTimer = setTimeout(saveMemoNow, 900);
  }

  /* 日報の雛形（初めて開いたとき・「雛形に戻す」）。seed があれば、以前の版の内容を引き継ぐ */
  function memoTemplate(info, seed) {
    var frag = document.createDocumentFragment(), add = function (t) { frag.appendChild(mDiv(t)); };
    var addHtml = function (h) { Array.prototype.forEach.call(memoBuild(h).childNodes, function (n) { frag.appendChild(n); }); };
    ['お疲れ様です。', '業務終了しました。', '', '以下、本日の業務報告です。', ''].forEach(add);
    frag.appendChild(mHeadDiv('cur', info.cur)); add('');
    if (seed && seed.cur) addHtml(seed.cur);
    add('');
    frag.appendChild(mHeadDiv('next', info.next)); add('');
    if (seed && seed.next) addHtml(seed.next);
    add('');
    add('以上となります。'); add('よろしくお願いいたします。');
    if (seed && seed.old && seed.old.replace(/<[^>]*>/g, '').trim()) { add(''); add('（以前のメモ）'); addHtml(seed.old); }
    return frag;
  }
  function memoInit(html, info, seed) {
    memoEd.textContent = '';
    if (html) memoEd.appendChild(memoBuild(html)); else memoEd.appendChild(memoTemplate(info, seed));
    lockHeads();
  }

  /* ToDoから入れた行は、ToDoの進捗に合わせる（完了 = 取り消し線、それ以外 = 線なし）。変えたら true */
  function todoStateOf(id) {
    id = Number(id);
    for (var i = 0; i < S.todos.length; i++) if (S.todos[i].id === id) return S.todos[i].status;
    for (var k = 0; k < S.done.length; k++) if (S.done[k].id === id) return 'done';
    return null; // いま見ているリストに無い（別の版のToDoなど）ときは、そのまま
  }
  function applyTodoState() {
    var changed = false, active = document.activeElement === memoEd ? window.getSelection().anchorNode : null;
    Array.prototype.forEach.call(memoEd.children, function (d) {
      var id = d.getAttribute('data-todo');
      if (!id) return;
      var st = todoStateOf(id);
      if (!st || d.getAttribute('data-st') === st) return;
      if (active && d.contains(active)) return; // 入力中の行は、触らない
      var text = d.textContent, done = st === 'done';
      d.textContent = '';
      if (done) { var sEl = document.createElement('s'); sEl.textContent = text; d.appendChild(sEl); } else d.appendChild(document.createTextNode(text));
      d.setAttribute('data-st', st);
      changed = true;
    });
    return changed;
  }
  function syncMemoTodos() { if (memoEd && applyTodoState()) memoChanged(); }

  /* ToDoを、日報に1行入れる。which = 'cur'（当日・初期値）か 'next'（次回出勤日）。完了なら取り消し線つき */
  function memoAddTodo(t, which) {
    if (!memoEd) { toast('日報が読み込まれていません'); return; }
    var h = mHead(which || 'cur');
    if (!h) { toast('日報に「【日付】」の行がありません。「雛形に戻す」で入れ直せます'); return; }
    var blk = mBlock(h), st = t.status || 'todo';
    if (blk.items.some(function (d) { return d.getAttribute('data-todo') === String(t.id); })) { toast('「' + t.title + '」は、すでに' + (which === 'next' ? '次回出勤日' : '当日') + 'の日報に入っています'); return; }
    var d = document.createElement('div');
    d.setAttribute('data-todo', String(t.id)); d.setAttribute('data-st', st);
    if (st === 'done') { var sEl = document.createElement('s'); sEl.textContent = t.title; d.appendChild(sEl); } else d.appendChild(document.createTextNode(t.title));
    memoEd.insertBefore(d, blk.items.length ? blk.after : blk.ref);
    memoChanged();
    toast('日報（' + (which === 'next' ? '次回出勤日' : '当日') + '）に入れました: ' + t.title + (st === 'done' ? '（完了・取り消し線）' : ''));
  }

  /* 取り消し線の切り替え。何も選んでいなければ、カーソルのある行全体に付ける */
  function toggleStrike() {
    var sel = window.getSelection();
    if (!sel.rangeCount || !memoEd.contains(sel.anchorNode)) { toast('日報の文章の中を選んでから、押してください'); return; }
    memoEd.focus();
    if (sel.isCollapsed) {
      var node = sel.anchorNode;
      while (node && node.parentNode !== memoEd) node = node.parentNode;
      if (!node || node.nodeType !== 1 || node.hasAttribute('data-md')) return;
      var r = document.createRange(); r.selectNodeContents(node); sel.removeAllRanges(); sel.addRange(r);
    }
    document.execCommand('strikeThrough');
    sel.collapseToEnd();
    memoChanged();
  }

  function writeClipboard(html, plain) {
    if (navigator.clipboard && window.ClipboardItem && html) {
      return navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
    }
    if (navigator.clipboard && !html) return navigator.clipboard.writeText(plain);
    return Promise.reject(new Error('unsupported'));
  }
  function fallbackCopy(html, plain) {
    var ta = document.createElement('textarea'); ta.value = plain; ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(ta); ta.select();
    var onCopy = function (e) { if (html) e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', plain); e.preventDefault(); };
    document.addEventListener('copy', onCopy, { once: true });
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.removeEventListener('copy', onCopy); ta.remove();
    return ok;
  }
  function copyMemo(plainOnly) {
    var lines = memoLines(memoEd);
    var plain = linesToPlain(lines);
    if (!plain.trim()) { toast('日報が空です'); return; }
    var html = plainOnly ? null : linesToClipHtml(lines);
    var okMsg = plainOnly ? 'テキストでコピーしました（取り消し線は線の文字で表します）' : 'コピーしました。日報に貼り付けてください（取り消し線も残ります）';
    writeClipboard(html, plain).then(function () { toast(okMsg); }).catch(function () {
      if (fallbackCopy(html, plain)) toast(okMsg); else toast('コピーできませんでした。日報を選択して Ctrl + C を押してください。');
    });
  }

  /* 日報の「【日付】」は、出勤日に合わせて自動で入れ替わる（上 = 当日、下 = 次回出勤日）。日が変わったとき・休みを登録したときは、読み直して合わせる */
  var memoBusy = false, memoLastFetch = 0, memoTrail = null;
  function memoRefreshDays(force) {
    if (SHARE || !S.me || memoBusy || !document.getElementById('memo')) return;
    var now = Date.now();
    if (!force && now - memoLastFetch < 1500) { clearTimeout(memoTrail); memoTrail = setTimeout(function () { memoRefreshDays(true); }, 1600 - (now - memoLastFetch)); return; } // 続けて呼ばれたときは、少し待ってから1回だけ
    memoLastFetch = now; memoBusy = true;
    api('memo_get', { quiet: true }).then(function (j) {
      memoBusy = false;
      var first = !S.memo;
      if (first) { S.memo = j; renderMemo(); return; }
      S.memo.history = j.history;
      if (S.memo.cur === j.cur && S.memo.next === j.next) return;
      S.memo.cur = j.cur; S.memo.next = j.next; S.memo.today = j.today;
      if (memoEd && memoReconcile(j)) memoChanged();
    }).catch(function () { memoBusy = false; });
  }
  setInterval(function () { if (!document.hidden) memoRefreshDays(true); }, 60000);
  window.addEventListener('focus', function () { memoRefreshDays(true); });

  /* 過去の日報（日が進んだときの控え）を見る・コピーする */
  function openMemoHistory() {
    api('memo_get').then(function (j) { if (S.memo) S.memo.history = j.history; showMemoHistory(j.history || []); }).catch(fail);
  }
  function showMemoHistory(days) {
    var view = el('div', { class: 'memo-editor memo-hist-view', 'aria-label': '過去の日報' });
    var cur = null;
    var sel = el('select', { 'aria-label': '日付', onchange: function () { show(sel.value); } }, days.map(function (d) { return el('option', { value: d, text: mdw(d) }); }));
    function show(d) {
      view.textContent = '読み込み中…';
      api('memo_history', { params: { day: d } }).then(function (j) { cur = j.html; view.textContent = ''; view.appendChild(memoBuild(j.html)); }).catch(function (x) { view.textContent = x.message; });
    }
    var ov = openModal('過去の日報', el('div', { class: 'form' },
      days.length ? el('p', { class: 'hint', text: '日が進んだときの、その日の日報の控えです（120日分）。見るだけです。' }) : el('p', { class: 'hint', text: '過去の日報は、まだありません（日が進むと、前の日の日報が残ります）。' }),
      days.length ? el('label', null, '日付', sel) : null, days.length ? view : null,
      el('div', { class: 'actions' },
        days.length ? el('button', { class: 'btn primary', type: 'button', text: 'コピー', onclick: function () {
          var lines = memoLines(view), plain = linesToPlain(lines);
          writeClipboard(linesToClipHtml(lines), plain).then(function () { toast('コピーしました'); }).catch(function () { if (fallbackCopy(linesToClipHtml(lines), plain)) toast('コピーしました'); else toast('コピーできませんでした'); });
        } }) : null,
        el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }))));
    ov.outsideClose = true;
    if (days.length) show(days[0]);
  }

  function renderMemo() {
    var box = document.getElementById('memo');
    if (!box) return;
    box.textContent = '';
    memoEd = null;
    var tool = function (label, title, fn, cls) { return el('button', { class: 'btn small ' + (cls || ''), type: 'button', title: title, onmousedown: function (e) { e.preventDefault(); }, onclick: fn }, label); };
    box.appendChild(el('h2', { text: 'メモ（日報用）' }));
    box.appendChild(helpText('【日付】は自動で入れ替わります（上 = 当日、下 = 次回出勤日）。当日の項目のうち、取り消し線のないものは、次回出勤日に転記されます。項目は、空行を入れずに並べてください。ToDoのカードを欄へドラッグして、追加もできます。自動で保存されます。'));
    box.appendChild(el('div', { class: 'memo-bar' },
      tool(el('s', { text: '取り消し線' }), '選んだ文字に取り消し線（何も選ばなければ、その行全体）。Ctrl + Shift + X', toggleStrike),
      tool('日報にコピー', '書式つきでコピー（メールなどに貼ると、取り消し線が残る）', function () { copyMemo(false); }, 'primary'),
      tool('テキストでコピー', '文字だけでコピー（取り消し線は線の文字で表す）', function () { copyMemo(true); })));
    box.appendChild(el('div', { class: 'memo-bar' },
      tool('雛形に戻す', '日報を、お疲れ様です〜よろしくお願いいたします、の雛形に置き換える', function () {
        if (memoLines(memoEd).length && !window.confirm('いまの日報を、雛形で置き換えます（当日・次回出勤日の項目は空になります）。よろしいですか？')) return;
        memoInit('', S.memo, null); memoSig = memoCurSig(); memoChanged();
      }, 'ghost'),
      tool('過去の日報', '日が進んだときの、前の日の日報の控えを見る', openMemoHistory, 'ghost')));
    if (!S.memo) { box.appendChild(el('p', { class: 'hint', text: '読み込み中…' })); memoRefreshDays(true); return; }
    memoStatusEl = el('span', { class: 'memo-status', role: 'status' });
    memoEd = el('div', { class: 'memo-editor memo-single', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'メモ（日報用）', spellcheck: 'false' });
    box.appendChild(memoEd);
    box.appendChild(memoStatusEl);
    var ed = memoEd;
    memoInit(S.memo.html, S.memo, S.memo.seed || null);
    S.memo.seed = null;
    var adopted = memoAdoptHeads(S.memo); lockHeads();
    var changed = memoReconcile(S.memo) || adopted;
    applyTodoState();
    memoSig = memoCurSig();
    if (changed || !S.memo.html) { S.memo.html = memoHtml(); saveMemoNow(); } // 初めての雛形・日が進んだときの入れ替えは、すぐ保存する

    ed.addEventListener('input', function (e) {
      var sel = window.getSelection(), n = sel.anchorNode;
      while (n && n.parentNode !== ed) n = n.parentNode;
      if (n && n.nodeType === 1) {
        if (e.inputType === 'insertParagraph') MEMO_ATTRS.forEach(function (a) { n.removeAttribute(a); }); // Enter で増えた行に、印（日付・ToDo・転記）まで写らないように
        else if (n.hasAttribute('data-tr')) n.removeAttribute('data-tr'); // 転記された行を書き換えたら、自分の行にする
      }
      memoChanged();
    });
    ed.addEventListener('blur', function () { if (memoTimer) saveMemoNow(); });
    ed.addEventListener('keydown', function (e) { if (e.ctrlKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) { e.preventDefault(); toggleStrike(); } });
    // ToDoのカードを、日報にドロップ（次回出勤日の見出しより下なら、次回出勤日。それ以外は当日）
    var canDrop = function () { return S.drag && S.drag.t === 'todo'; };
    ed.addEventListener('dragover', function (ev) { if (!canDrop()) return; ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'move'; ed.classList.add('drop'); });
    ed.addEventListener('dragleave', function (ev) { if (!ed.contains(ev.relatedTarget)) ed.classList.remove('drop'); });
    ed.addEventListener('drop', function (ev) {
      if (!canDrop()) return;
      ev.preventDefault(); ev.stopPropagation(); // 編集欄の標準のドロップ（文字の挿入）は止める
      var p = S.drag; ed.classList.remove('drop'); endDrag();
      var which = 'cur', nh = mHead('next'), at = document.elementFromPoint(ev.clientX, ev.clientY);
      while (at && at.parentNode !== ed) at = at.parentNode;
      if (nh && at && Array.prototype.indexOf.call(ed.children, at) >= Array.prototype.indexOf.call(ed.children, nh)) which = 'next';
      var t = null; S.todos.concat(S.done).forEach(function (x) { if (x.id === p.id) t = x; });
      if (t) memoAddTodo(t, which);
    });
    // 貼り付け: 書式つきでも、取り消し線だけを残して他の書式は捨てる。文字だけの貼り付けは、線の結合文字を取り消し線に戻す
    ed.addEventListener('paste', function (e) {
      var cd = e.clipboardData; if (!cd) return;
      e.preventDefault();
      var html = cd.getData('text/html'), tmp = document.createElement('div');
      if (html) {
        tmp.appendChild(memoFragmentFromHtml(html));
      } else {
        cd.getData('text/plain').split(/\r?\n/).forEach(function (line) {
          var dv = document.createElement('div');
          if (!line) dv.appendChild(document.createElement('br'));
          line.split(/((?:[^̶]̶)+)/).forEach(function (part, k) {
            if (!part) return;
            if (k % 2 === 1) { var sEl = document.createElement('s'); sEl.textContent = part.replace(/̶/g, ''); dv.appendChild(sEl); } else dv.appendChild(document.createTextNode(part));
          });
          tmp.appendChild(dv);
        });
      }
      memoPasteLines(memoLines(tmp));
      memoAdoptHeads(S.memo); // 貼り付けた文章に「【日付】」の行があれば、自動で入れ替わる行にする
      lockHeads();
      if (S.memo && memoReconcile(S.memo)) memoSig = memoCurSig();
      memoChanged();
    });
    // Ctrl + C でも、書式つき + 文字だけ の両方をコピーする（選んだ部分の取り消し線を保つ）
    ed.addEventListener('copy', function (e) {
      var sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !e.clipboardData) return;
      var range = sel.getRangeAt(0), tmp = document.createElement('div'), holder = tmp;
      var anc = range.commonAncestorContainer; anc = anc.nodeType === 3 ? anc.parentNode : anc;
      if (anc && anc.closest && ed.contains(anc) && anc.closest('s,strike,del')) { holder = document.createElement('s'); tmp.appendChild(holder); }
      holder.appendChild(range.cloneContents());
      var lines = memoLines(tmp);
      e.clipboardData.setData('text/html', linesToClipHtml(lines));
      e.clipboardData.setData('text/plain', linesToPlain(lines));
      e.preventDefault();
    });
  }

  /* ---------- 予定の複製 ---------- */
  function openDuplicateDialog(ev) {
    var span = Math.round((parse(ev.end) - parse(ev.start)) / 86400000);
    var rows = [];
    var list = el('div', { class: 'dup-list' });
    var err = el('p', { class: 'error', role: 'alert', hidden: true });

    function addRow(val) {
      var inp = el('input', { type: 'date', required: true, value: val || '', 'aria-label': '複製先の日付' });
      var info = el('span', { class: 'hint' });
      var update = function () {
        info.textContent = !inp.value ? '' : span > 0 ? mdw(inp.value) + ' 〜 ' + mdw(ymd(addDays(parse(inp.value), span))) : mdw(inp.value);
      };
      inp.addEventListener('input', update);
      update();
      var item = {};
      var rm = el('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'この日付を外す', text: '✕', onclick: function () {
        if (rows.length <= 1) return;
        rows = rows.filter(function (r) { return r !== item; });
        item.node.remove();
      } });
      item.input = inp;
      item.node = el('div', { class: 'dup-row' }, inp, info, rm);
      rows.push(item);
      list.appendChild(item.node);
      return inp;
    }
    addRow(ymd(addDays(parse(ev.end), 1)));

    var kindName = ev.kind === 'off' ? '休み' : ev.kind === 'private' ? 'プライベート' : '業務';
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      err.hidden = true;
      var dates = rows.map(function (r) { return r.input.value; }).filter(Boolean);
      if (!dates.length) { err.textContent = '複製先の日付を入力してください。'; err.hidden = false; return; }
      api('event_duplicate', { body: { id: ev.id, dates: dates } }).then(function (j) {
        ov.close();
        toast(j.created + '件を複製しました' + (j.skipped ? '（同じ予定がすでにある ' + j.skipped + '件は飛ばしました）' : ''));
        load();
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('div', { class: 'notice' }, el('b', { text: '複製する予定' }),
        el('p', { text: '[' + kindName + '] ' + eventLabel(ev, true) + '　' + (ev.start === ev.end ? mdw(ev.start) : mdw(ev.start) + ' 〜 ' + mdw(ev.end)) })),
      el('p', { class: 'hint', text: span > 0 ? '複製先の日付を選ぶと、同じ ' + (span + 1) + '日間の予定が作られます。' : '複製先の日付を選んでください。複数の日付をまとめて指定できます。' }),
      list,
      el('div', null, el('button', { class: 'btn small', type: 'button', text: '＋ 日付を追加', onclick: function () {
        var last = rows[rows.length - 1].input.value;
        var next = addRow(last ? ymd(addDays(parse(last), 1)) : '');
        next.focus();
      } })),
      ev.kind === 'private' ? el('p', { class: 'hint', text: 'プライベートの予定のまま複製されます（本人以外には表示されません）。' }) : null,
      err,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '複製する' })));
    var ov = openModal('予定を複製', form);
  }

  /* 日付を押したときの、その日の予定の一覧（スマホ・タッチ操作・共有リンクのとき）。予定を押すと詳細／編集 */
  function useDayPopup() { return !!SHARE || NARROW() || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
  function openDayPopup(ds) {
    var list = S.events.filter(function (e) { return shownOn(e, ds); });
    list.sort(function (a, b) { return (a.kind === 'off' ? 0 : 1) - (b.kind === 'off' ? 0 : 1) || (a.start_time || '').localeCompare(b.start_time || '') || a.id - b.id; });
    var hol = S.holidays[ds];
    var items = list.map(function (e) {
      var sub = [];
      if (e.kind === 'work' && !FAMILY && e.owner_name) sub.push(e.owner_name);
      if (e.tag && e.kind !== 'off') sub.push(e.tag); // 休みは、見出しに分類が入っている
      if (e.start !== e.end) sub.push(mdw(e.start) + ' 〜 ' + mdw(e.end));
      return el('button', { type: 'button', class: 'day-item ' + e.kind + (e.deleted ? ' deleted' : '') + (e.done ? ' done' : ''), style: eventColorStyle(e) || null, onclick: function () { ov.close(); openEventDialog(e); } },
        el('span', { class: 'di-title', text: (e.deleted ? '削除された予定: ' : '') + eventLabel(e, true) }),
        sub.length ? el('span', { class: 'di-sub', text: sub.join('　') }) : null,
        e.note ? el('span', { class: 'di-note', text: e.note }) : null);
    });
    var ov = openModal(mdw(ds) + (hol ? '　' + hol : '') + (ds === ymd(new Date()) ? '（今日）' : ''), el('div', { class: 'form' },
      items.length ? el('div', { class: 'day-list' }, items) : el('p', { class: 'muted', text: 'この日の予定はありません。' }),
      el('div', { class: 'actions' },
        SHARE ? null : el('button', { class: 'btn primary', type: 'button', text: '＋ この日に予定を追加', onclick: function () { ov.close(); openEventDialog(null, ds); } }),
        el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }))));
    ov.outsideClose = true;
  }
  function openDeletedView(ev) {
    var when = ev.start === ev.end ? mdw(ev.start) : mdw(ev.start) + ' 〜 ' + mdw(ev.end);
    var rows = [['予定', ev.title], ['日付', when]];
    if (ev.start_time) rows.push(['時刻', ev.start_time + (ev.end_time ? ' 〜 ' + ev.end_time : '')]);
    rows.push(['削除された日時', fmtAt(ev.deleted_at)]);
    var ov = openModal('削除された予定', el('div', { class: 'form' },
      el('p', { class: 'hint', text: 'この予定は削除されました。確認すると、カレンダーから消えます（ほかの家族の画面では、それぞれが確認するまで残ります）。' }),
      el('dl', { class: 'detail del' }, rows.map(function (r) { return [el('dt', { text: r[0] }), el('dd', { text: r[1] })]; })),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', text: '確認した（消す）', onclick: function () { ackAdd([ev.log_id]); S.events = S.events.filter(function (x) { return x !== ev; }); ov.close(); renderBoard(); } }),
        el('button', { class: 'btn', type: 'button', text: 'あとで', onclick: function () { ov.close(); } }))));
    ov.outsideClose = true;
  }
  /* ToDoから置いた予定の詳細で、元のToDoの状態（未着手・進行中・完了）を見る／変える。変えると、ToDoの一覧・日報・カレンダーの取り消し線にも反映される */
  var TD_STATE_NAME = { todo: '未着手', doing: '進行中', done: '完了' };
  function todoStateBox(ev, canChange) {
    var cur = ev.todo_status || (ev.done ? 'done' : 'todo');
    var box = el('div', { class: 'td-state', role: 'group', 'aria-label': 'ToDoの状態' });
    function draw() {
      box.textContent = '';
      box.appendChild(el('span', { class: 'td-state-lbl', text: 'ToDoの状態' }));
      ['todo', 'doing', 'done'].forEach(function (s) {
        box.appendChild(el('button', { class: 'btn small st-' + s + (cur === s ? ' on' : ''), type: 'button', 'aria-pressed': cur === s ? 'true' : 'false', disabled: canChange ? null : 'disabled', text: TD_STATE_NAME[s],
          onclick: function () {
            if (cur === s) return;
            api('todo_status', { body: { id: ev.todo_id, status: s } }).then(function () {
              cur = s; ev.todo_status = s; ev.done = s === 'done'; draw();
              toast(s === 'done' ? '完了にしました（カレンダーでは取り消し線になります）' : s === 'doing' ? '進行中にしました' : '未着手に戻しました');
              load(); loadTodos(); syncMemoTodos();
            }).catch(fail);
          } }));
      });
      if (!canChange) box.appendChild(el('span', { class: 'hint', text: '状態を変えられるのは、ToDoの持ち主だけです。' }));
    }
    draw();
    return box;
  }

  function openEventView(ev) {
    if (ev.deleted) return openDeletedView(ev);
    var rows = [['種類', ev.kind === 'off' ? '休み' : ev.kind === 'private' ? 'プライベート' : '業務'], ['件名', eventLabel(ev, true)], ['日付', ev.start === ev.end ? mdw(ev.start) : mdw(ev.start) + ' 〜 ' + mdw(ev.end)]];
    if (ev.start_time) rows.push(['時刻', ev.start_time + (ev.end_time ? ' 〜 ' + ev.end_time : '')]);
    if (ev.tag) rows.push(['分類', ev.tag]);
    rows.push(['持ち主', ev.owner_name]);
    if (ev.important) rows.push(['重要', '★ 重要な予定']);
    if (ev.todo_id && ev.todo_status) rows.push(['ToDoの状態', TD_STATE_NAME[ev.todo_status]]);
    if (ev.note) rows.push(['メモ', ev.note]);
    var dl = el('dl', { class: 'detail' }, rows.map(function (r) { return [el('dt', { text: r[0] }), el('dd', { text: r[1] })]; }));
    var ov = openModal('予定の詳細', el('div', { class: 'form' }, dl,
      SHARE ? null : el('p', { class: 'hint', text: 'この予定は持ち主と管理者だけが編集できます。' }),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }))));
    ov.outsideClose = true;
  }

  /* 家族用ページの「更新履歴」を、持ち主が確認して削除する（1件ずつ／すべて） */
  function openFamilyLogDialog() {
    var body = el('div', { class: 'form' });
    var ov = openModal('家族に見える更新履歴', body, true);
    var label = { add: '追加', update: '変更', delete: '削除' };
    function refresh() {
      api('family_log_list').then(function (j) {
        body.textContent = '';
        body.appendChild(el('p', { class: 'hint', text: '家族用リンクの「更新履歴を見る」に出る、あなたの予定の追加・変更・削除の記録です（新しい順・最新200件まで）。ここで削除すると、家族の画面の履歴から消えます。予定そのものは消えません。' }));
        body.appendChild(el('p', { class: 'hint', text: '※ 削除した予定を、家族がまだ「確認」していないときの取消線（カレンダー上）も、いっしょに消えます。' }));
        if (!j.entries.length) {
          body.appendChild(el('p', { class: 'muted', text: '更新の記録はありません。' }));
        } else {
          body.appendChild(el('ul', { class: 'log-list' }, j.entries.map(function (e) {
            var when = e.from === e.to ? mdw(e.from) : mdw(e.from) + ' 〜 ' + mdw(e.to);
            return el('li', { class: 'log-item ' + e.action },
              el('div', { class: 'log-top' }, el('span', { class: 'log-at', text: fmtAt(e.at) }), el('span', { class: 'log-act ' + e.action, text: label[e.action] || e.action }),
                el('button', { class: 'btn small ghost danger', type: 'button', style: 'margin-left:auto', text: '削除', 'aria-label': 'この履歴を削除', onclick: function () {
                  api('family_log_delete', { body: { id: e.id } }).then(function () { toast('削除しました'); refresh(); load(); }).catch(fail);
                } })),
              el('div', { class: 'log-title' + (e.action === 'delete' ? ' gone' : ''), text: e.title + '　' + when }),
              e.detail ? el('div', { class: 'log-detail', text: e.detail }) : null);
          })));
        }
        body.appendChild(el('div', { class: 'actions' },
          j.entries.length ? el('button', { class: 'btn danger', type: 'button', text: 'すべて削除', onclick: function () {
            if (!window.confirm('家族に見える更新履歴を、すべて削除します（' + j.entries.length + '件）。元に戻せません。予定そのものは消えません。よろしいですか？')) return;
            api('family_log_delete', { body: { all: true } }).then(function (r) { toast(r.deleted + '件を削除しました'); refresh(); load(); }).catch(fail);
          } }) : null,
          el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
      }).catch(fail);
    }
    refresh();
  }

  /* ---------- 共有リンク ---------- */
  function openShareDialog() {
    var body = el('div', { class: 'form' });
    var ov = openModal('共有リンク（閲覧専用）', body, true);
    var absUrl = function (path) { return new URL(path, location.href).href; };
    var scope = { off: false, tags: [] };
    function scopeBox() {
      var save = function () {
        var tags = S.me.work_tags.filter(function (t, i) { return boxes[i].checked; });
        api('share_options', { body: { off: offCb.checked, tags: tags } }).then(function (j) { S.me.family_share = j.family_share; scope = j.family_share; toast('家族に見せる範囲を保存しました'); }).catch(fail);
      };
      var offCb = el('input', { type: 'checkbox', checked: scope.off, onchange: save });
      var boxes = S.me.work_tags.map(function (t) { return el('input', { type: 'checkbox', checked: scope.tags.indexOf(t) >= 0, onchange: save }); });
      return el('div', { class: 'scope' },
        el('b', { text: '家族に見せる範囲（まとめて指定）' }),
        el('p', { class: 'hint', style: 'margin:2px 0 6px', text: '予定ごとの「家族に共有」のチェックとは別に、すでに登録してある予定も含めて、まとめて見せられます。チェックを外すと、すぐ見えなくなります。共有した業務・休みは、あなたのプライベート版にも表示されます。' }),
        el('label', { class: 'check' }, offCb, '自分の休みを、すべて見せる'),
        el('div', { class: 'scope-tags' }, el('span', { class: 'hint', text: '見せる業務の分類:' }),
          S.me.work_tags.map(function (t, i) { return el('label', { class: 'fchip' }, boxes[i], t); })),
        el('p', { class: 'hint', style: 'margin:6px 0 0', text: 'プライベートの予定は、予定ごとの「家族に共有」で決まります（初期値は共有）。業務の予定は会社の情報を含むことがあるので、見せてよい分類だけにチェックしてください。' }));
    }
    function card(l) {
      var family = l.kind === 'family';
      var box = el('div', { class: 'card' },
        el('div', { class: 'name', text: family ? '家族用リンク' : '会社用リンク（管理者のみ）' }),
        el('p', { class: 'hint', style: 'margin:0', text: family
          ? 'あなたの予定のうち、家族に共有すると決めたものだけが、カレンダーで見られます。プライベートは初期状態で共有（外した予定だけ隠れます）、業務・休みは、選んだものだけが共有されます。ログイン不要で、見るだけです。'
          : '会社の業務の予定と休みが見られます。プライベートの予定は含まれません。ログイン不要で、見るだけです。' }));
      if (family) box.appendChild(scopeBox());
      if (family) box.appendChild(el('div', { class: 'actions', style: 'justify-content:flex-start' },
        el('button', { class: 'btn small', type: 'button', text: '家族に見える更新履歴を管理（削除）', title: '家族用ページの「更新履歴を見る」に出る記録を、確認・削除します', onclick: openFamilyLogDialog })));
      if (l.path) {
        var url = absUrl(l.path);
        var input = el('input', { type: 'text', readonly: true, value: url, 'aria-label': 'リンクのURL', onclick: function (e) { e.target.select(); } });
        box.appendChild(el('div', { class: 'share-row' }, input,
          el('button', { class: 'btn small primary', type: 'button', text: 'コピー', onclick: function () {
            var done = function () { toast('リンクをコピーしました'); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { input.select(); toast('選択しました。Ctrl + C でコピーしてください'); });
            else { input.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Ctrl + C でコピーしてください'); } }
          } }),
          el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener noreferrer', text: '開く' })));
        box.appendChild(el('div', { class: 'actions', style: 'justify-content:flex-start' },
          el('button', { class: 'btn small', type: 'button', text: 'リンクを作り直す', title: '古いURLは、すぐに見られなくなります', onclick: function () {
            if (!window.confirm('リンクを作り直します。古いURLは、すぐに見られなくなります（共有している人には新しいURLを伝え直してください）。よろしいですか？')) return;
            api('share_create', { body: { kind: l.kind } }).then(function () { toast('作り直しました'); refresh(); }).catch(fail);
          } }),
          el('button', { class: 'btn small danger', type: 'button', text: '共有を止める', onclick: function () {
            if (!window.confirm('共有を止めます。このURLでは、もう見られなくなります。よろしいですか？')) return;
            api('share_revoke', { body: { kind: l.kind } }).then(function () { toast('共有を止めました'); refresh(); }).catch(fail);
          } })));
      } else {
        box.appendChild(el('div', null, el('button', { class: 'btn primary small', type: 'button', text: 'リンクを作る', onclick: function () {
          api('share_create', { body: { kind: l.kind } }).then(function () { toast('リンクを作りました'); refresh(); }).catch(fail);
        } })));
      }
      return box;
    }
    /* カレンダー購読（ICS）: スマホ標準のカレンダー・Googleカレンダーに、URLで取り込む */
    var ICAL_TEXT = {
      me: ['自分用（プライベートも含む全予定）', 'あなたの全予定（業務・休み・プライベート）です。URLは、あなただけの秘密にしてください。時刻のある予定には、15分前の通知が付きます（Appleのカレンダーなど）。'],
      family: ['家族用（共有した予定だけ）', '家族用リンクと同じ範囲（「家族に共有」にした予定だけ）です。家族のスマホに取り込んでもらえます。'],
      company: ['会社用（管理者のみ・業務と休み）', '会社用リンクと同じ範囲（業務と休み。プライベートは含みません）です。社員のスマホに取り込んでもらえます。']
    };
    function icalCard(l) {
      var t = ICAL_TEXT[l.kind];
      var box = el('div', { class: 'card' }, el('div', { class: 'name', text: t[0] }), el('p', { class: 'hint', style: 'margin:0', text: t[1] }));
      if (l.path) {
        var url = absUrl(l.path);
        var input = el('input', { type: 'text', readonly: true, value: url, 'aria-label': '購読URL', onclick: function (e) { e.target.select(); } });
        box.appendChild(el('div', { class: 'share-row' }, input,
          el('button', { class: 'btn small primary', type: 'button', text: 'コピー', onclick: function () {
            var done = function () { toast('購読URLをコピーしました'); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { input.select(); toast('選択しました。コピーしてください'); });
            else { input.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('コピーしてください'); } }
          } }),
          el('a', { class: 'btn small', href: url.replace(/^https?:/, 'webcal:'), text: 'iPhoneで登録', title: 'iPhone・Macで開くと、カレンダーに登録する画面が出ます' })));
        box.appendChild(el('div', { class: 'actions', style: 'justify-content:flex-start' },
          el('button', { class: 'btn small', type: 'button', text: 'URLを作り直す', title: '古いURLは、すぐに使えなくなります', onclick: function () {
            if (!window.confirm('購読URLを作り直します。古いURLで取り込んだカレンダーは、次の更新から空になります（新しいURLで取り込み直してください）。よろしいですか？')) return;
            api('ical_create', { body: { kind: l.kind } }).then(function () { toast('作り直しました'); refresh(); }).catch(fail);
          } }),
          el('button', { class: 'btn small danger', type: 'button', text: '購読を止める', onclick: function () {
            if (!window.confirm('購読を止めます。このURLでは、もう取り込めなくなります。よろしいですか？')) return;
            api('ical_revoke', { body: { kind: l.kind } }).then(function () { toast('購読を止めました'); refresh(); }).catch(fail);
          } })));
      } else {
        box.appendChild(el('div', null, el('button', { class: 'btn primary small', type: 'button', text: '購読URLを作る', onclick: function () {
          api('ical_create', { body: { kind: l.kind } }).then(function () { toast('購読URLを作りました'); refresh(); }).catch(fail);
        } })));
      }
      return box;
    }
    function icalSection(list) {
      var wrap = el('div', { class: 'ical-sec' }, el('h4', { style: 'margin:14px 0 4px', text: 'カレンダー購読（スマホのカレンダーに取り込む）' }),
        el('p', { class: 'hint', style: 'margin:0 0 6px', text: 'iPhone の標準カレンダーや Google カレンダーに、このアプリの予定を、読み取り専用で取り込めます。向こうの通知・ウィジェット・Apple Watch でも見られます。取り込んだ予定は、こちらで変えると、しばらくあとに（Apple は数分〜、Google は半日〜1日）向こうにも反映されます。' }));
      list.forEach(function (l) { wrap.appendChild(icalCard(l)); });
      wrap.appendChild(el('details', { class: 'help-sm', open: !isPhone() }, el('summary', { text: 'ⓘ 取り込み方' }),
        el('div', { class: 'inst-box' }, el('h4', { text: 'iPhone' }), el('ol', null, ['上の「iPhoneで登録」を押す（または、設定 → カレンダー → アカウント → アカウントを追加 → その他 → 照会するカレンダーを追加 に、URLを貼る）', '「購読」を押して、完了']),
          el('h4', { text: 'Google カレンダー（パソコン）' }), el('ol', null, ['左の「他のカレンダー」の「＋」→「URLで追加」', '上の購読URLを貼って、「カレンダーを追加」（https のURLです）']))));
      return wrap;
    }
    function refresh() {
      api('share_list').then(function (j) {
        scope = j.family_share || scope; S.me.family_share = scope;
        body.textContent = '';
        body.appendChild(el('div', { class: 'notice' }, el('b', { text: 'このURLを知っている人は、ログインなしで見られます' }),
          el('p', { text: '見せたい人にだけ伝えてください。会社の人が見られる場所に、家族用のURLを載せないでください。URLが他の人に伝わったときは「リンクを作り直す」か「共有を止める」で、すぐに見られなくなります。' })));
        j.links.forEach(function (l) { body.appendChild(card(l)); });
        if (j.ical) body.appendChild(icalSection(j.ical));
        body.appendChild(el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
      }).catch(fail);
    }
    refresh();
  }

  /* ---------- 繰り返し業務 ---------- */
  function openSeriesDialog() {
    var body = el('div', { class: 'form' });
    var ov = openModal('繰り返し業務の設定', body, true);
    function refresh() {
      api('series_list').then(function (j) {
        body.textContent = '';
        body.appendChild(el('p', { class: 'hint', text: 'ここで登録したルールから、今月を含む12か月先までの予定が自動で作られます（毎晩、足りない分を追加します）。' }));
        if (!j.series.length) {
          body.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted', style: 'margin:0', text: 'まだルールがありません。' }),
            el('div', null, el('button', { class: 'btn', type: 'button', text: 'よくある月次業務の例（6件）をまとめて登録', onclick: function () {
              api('series_seed', { body: {} }).then(function () { toast('6件のルールを登録しました'); refresh(); load(); }).catch(fail);
            } })),
            el('p', { class: 'hint', text: '請求処理（月初3営業日）／給与計算の準備（10〜15日の営業日）／棚卸し（20〜25日の営業日）／シフト提出・住民税チェック・支払請求書のスキャン（25日、休日なら前営業日）。あとから自由に変更できます。' })));
        }
        j.series.forEach(function (s) {
          body.appendChild(el('div', { class: 'card' },
            el('div', { class: 'top' }, el('div', null, el('div', { class: 'name', text: s.title }), el('div', { class: 'muted' }, s.label + (s.start_time ? '　' + s.start_time + (s.end_time ? '〜' + s.end_time : '') : ''), s.todo_auto ? el('span', { class: 'pill', style: 'margin-left:8px', text: 'ToDo連動', title: '毎回、ToDoリストにも入ります' }) : null)),
              s.editable ? el('div', null, el('button', { class: 'btn small', type: 'button', text: '編集', onclick: function () { openSeriesForm(s, function () { refresh(); load(); }); } }), ' ',
                el('button', { class: 'btn small danger', type: 'button', text: '削除', onclick: function () {
                  if (!window.confirm('「' + s.title + '」のルールを削除します。今日以降の自動作成分も消えます。よろしいですか？')) return;
                  api('series_delete', { body: { id: s.id } }).then(function () { toast('削除しました'); refresh(); load(); }).catch(fail);
                } })) : null),
            el('div', { class: 'hint', text: '次回: ' + (s.next.length ? s.next.map(function (n) { return n.start === n.end ? mdw(n.start) : mdw(n.start) + '〜' + mdw(n.end); }).join(' / ') : 'なし') + '　登録者: ' + s.owner_name })));
        });
        body.appendChild(el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: '＋ ルールを追加', onclick: function () { openSeriesForm(null, function () { refresh(); load(); }); } }),
          el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
      }).catch(fail);
    }
    refresh();
  }

  function openSeriesForm(s, done, prefill) {
    var pf = prefill || {};
    var typeSel = el('select', { name: 'rule_type' }, Object.keys(RULE_NAMES).map(function (k) { return el('option', { value: k, text: RULE_NAMES[k], selected: s && s.rule_type === k }); }));
    var title = el('input', { name: 'title', maxlength: '100', required: true, value: s ? s.title : (pf.title || '') });
    var tag = el('select', { name: 'tag' }, S.me.work_tags.map(function (t) { return el('option', { value: t, text: t, selected: s ? s.tag === t : (pf.tag && S.me.work_tags.indexOf(pf.tag) >= 0 ? t === pf.tag : t === '定例業務') }); }));
    var fields = el('div', { class: 'row' });
    var num = function (name, label, val, min, max) { return el('label', null, label, el('input', { type: 'number', name: name, min: String(min), max: String(max), value: val === null || val === undefined ? '' : String(val) })); };
    var st = timeInput('start_time', s ? s.start_time : (pf.start_time || ''));
    var et = timeInput('end_time', s ? s.end_time : (pf.end_time || ''));
    var preview = el('div', { class: 'scroll-x' });
    var autoTodo = el('input', { type: 'checkbox', name: 'todo_auto', checked: !!(s && s.todo_auto), style: 'width:auto' });
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    var timer = null;

    function renderFields() {
      var t = typeSel.value;
      fields.textContent = '';
      var v = function (k, d) { return s && s[k] !== null && s[k] !== undefined ? s[k] : d; };
      if (t === 'day') {
        fields.appendChild(num('p_day', '日', v('p_day', 25), 1, 31));
        fields.appendChild(el('label', null, '土日祝に当たる場合', el('select', { name: 'shift' },
          [['prev', '前の営業日にずらす'], ['next', '次の営業日にずらす'], ['none', 'ずらさない']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: v('shift', 'prev') === o[0] }); }))));
      } else if (t === 'weekly') {
        fields.appendChild(el('label', null, '曜日', el('select', { name: 'p_weekday' }, DOW.map(function (w, i) { return el('option', { value: String(i), text: w + '曜日', selected: v('p_weekday', 1) === i }); }))));
        fields.appendChild(el('label', null, 'くり返し', el('select', { name: 'p_interval' }, [[1, '毎週'], [2, '隔週（2週ごと）'], [3, '3週ごと'], [4, '4週ごと']].map(function (o) { return el('option', { value: String(o[0]), text: o[1], selected: v('p_interval', 1) === o[0] }); }))));
        fields.appendChild(el('label', null, '数え始める日（2週ごと以上のとき、この日を含む週から数えます）', el('input', { type: 'date', name: 'p_anchor', value: v('p_anchor', ymd(new Date())) })));
        fields.appendChild(el('label', null, '祝日・会社の休業日に当たる場合', el('select', { name: 'shift' },
          [['none', 'ずらさない（そのまま）'], ['prev', '前の営業日にずらす'], ['next', '次の営業日にずらす']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: v('shift', 'none') === o[0] }); }))));
        fields.appendChild(el('p', { class: 'hint', text: '自分が休みの日の回は、作られません（別の日へは動きません）。' }));
      } else if (t === 'weekday_nth') {
        fields.appendChild(el('label', null, '第何週', el('select', { name: 'p_nth' }, [[1, '第1'], [2, '第2'], [3, '第3'], [4, '第4'], [-1, '最終']].map(function (o) { return el('option', { value: String(o[0]), text: o[1], selected: v('p_nth', 1) === o[0] }); }))));
        fields.appendChild(el('label', null, '曜日', el('select', { name: 'p_weekday' }, DOW.map(function (w, i) { return el('option', { value: String(i), text: w + '曜日', selected: v('p_weekday', 1) === i }); }))));
      } else if (t === 'first_bizdays') {
        fields.appendChild(num('p_count', '営業日の数（1営業日目〜N営業日目）', v('p_count', 3), 1, 20));
      } else if (t === 'range') {
        fields.appendChild(num('p_day', '開始日', v('p_day', 10), 1, 31));
        fields.appendChild(num('p_day2', '終了日', v('p_day2', 15), 1, 31));
        fields.appendChild(el('label', { style: 'flex-direction:row' }, el('input', { type: 'checkbox', name: 'bizonly', checked: s ? !!s.bizonly : true, style: 'width:auto' }), '土日祝を除く（営業日だけに切り詰める）'));
      } else {
        fields.appendChild(el('p', { class: 'hint', text: '土日祝・会社の休業日を除いた、月の最後の営業日になります。' }));
      }
      fields.querySelectorAll('input,select').forEach(function (n) { n.addEventListener('input', schedule); n.addEventListener('change', schedule); });
    }
    function collect() {
      var b = { id: s ? s.id : null, title: title.value, tag: tag.value, rule_type: typeSel.value, start_time: timeVal(st), end_time: timeVal(et), todo_auto: autoTodo.checked };
      fields.querySelectorAll('input,select').forEach(function (n) { b[n.name] = n.type === 'checkbox' ? n.checked : n.value; });
      b.start_time = timeVal(st); b.end_time = timeVal(et);
      return b;
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(showPreview, 250); }
    function showPreview() {
      var b = collect();
      if (!b.title.trim()) b.title = '（件名）';
      api('series_preview', { body: b }).then(function (j) {
        err.hidden = true;
        preview.textContent = '';
        var months = [], byMonth = {}; // 毎週・隔週は、1か月に何回もあるので、月ごとにまとめる
        j.preview.forEach(function (p) {
          var m = p.start ? p.start.slice(0, 7) : p.ym.slice(0, 7);
          if (!byMonth[m]) { byMonth[m] = []; months.push(m); }
          if (p.start) byMonth[m].push(p.start === p.end ? mdw(p.start) : mdw(p.start) + ' 〜 ' + mdw(p.end));
        });
        preview.appendChild(el('table', { class: 't' }, el('thead', null, el('tr', null, el('th', { text: '月' }), el('th', { text: '作られる日付' }))),
          el('tbody', null, months.map(function (m) {
            return el('tr', null, el('td', { text: m.replace('-', '年') + '月' }), el('td', { text: byMonth[m].length ? byMonth[m].join('　') : 'この月はなし' }));
          }))));
      }).catch(function (x) { preview.textContent = ''; err.textContent = x.message; err.hidden = false; });
    }
    typeSel.addEventListener('change', function () { renderFields(); schedule(); });
    [title, tag, st, et].forEach(function (n) { n.addEventListener('input', schedule); });

    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('series_save', { body: collect() }).then(function () { ov.close(); toast('ルールを保存しました'); done(); }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('label', null, '件名', title),
      el('div', { class: 'row' }, el('label', null, 'ルールの種類', typeSel), el('label', null, '分類', tag)),
      fields,
      el('div', { class: 'row' }, el('label', null, '開始時刻（任意）', st), el('label', null, '終了時刻（任意）', et)),
      el('label', { class: 'check' }, autoTodo, '毎回、ToDoリストにも入れる（実施日の約2週間前に「未着手」で入り、期限日はその回の日付。ToDoを完了にすると、その回に取り消し線）'),
      el('h4', { style: 'margin:4px 0 0', text: 'この設定で作られる予定（今月から8か月分）' }), preview, err,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '保存' })));
    var ov = openModal(s ? 'ルールを編集' : 'ルールを追加', form, true);
    renderFields();
    showPreview();
  }

  /* ---------- Slack通知の設定とテスト（管理者） ---------- */
  function slackFailHint(r) {
    var b = (r.body || '').trim();
    if (r.code === 0) return 'サーバーから Slack へ接続できませんでした。' + (r.error ? '（' + r.error + '）' : '') + 'サーバーが外部へ通信できない設定になっていないか、確認してください。';
    if (r.code === 404 || b === 'no_service') return 'この Webhook URL は、無効か、削除されています。Slack で、新しい Webhook URL を発行し直してください。';
    if (b === 'invalid_token' || r.code === 403) return 'Webhook URL が正しくないか、権限がありません。URL を貼り付け直してください。';
    if (b === 'channel_not_found' || b === 'channel_is_archived') return '送り先のチャンネルが見つからない、またはアーカイブされています。Webhook を作り直してください。';
    if (b === 'invalid_payload') return 'Slack が、送った内容を受け付けませんでした（invalid_payload）。';
    if (r.code === 429) return 'Slack から、短時間に送りすぎと言われました。少し待ってからもう一度お試しください。';
    return 'Slack からの応答: ' + r.code + (b ? ' ' + b : '');
  }
  function openSlackDialog() {
    var body = el('div', { class: 'form' });
    var ov = openModal('Slack通知の設定・テスト', body, true);
    var result = el('div', { class: 'slack-result', role: 'status', 'aria-live': 'polite' });
    function send(kind, btn) {
      btn.disabled = true; result.className = 'slack-result wait'; result.textContent = '送信しています…';
      api('slack_test', { body: { kind: kind } }).then(function (j) {
        var r = j.result;
        if (r.ok) { result.className = 'slack-result ok'; result.textContent = '✓ 送信できました。Slack の送り先チャンネルに、届いているか確認してください。'; }
        else { result.className = 'slack-result ng'; result.textContent = '✕ 送信できませんでした。' + slackFailHint(r); }
      }).catch(function (x) { result.className = 'slack-result ng'; result.textContent = '✕ ' + x.message; }).then(function () { btn.disabled = false; });
    }
    function draw(st) {
      body.textContent = '';
      var url = el('input', { type: 'text', id: 'slack-url', placeholder: 'https://hooks.slack.com/services/…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Slack の Webhook URL' });
      var nm = el('input', { type: 'text', id: 'slack-name', placeholder: '例: #休み連絡', maxlength: '30', autocomplete: 'off', 'aria-label': 'チャンネル名' });
      var err = el('p', { class: 'error', role: 'alert', hidden: true });
      var fail2 = function (x) { err.textContent = x.message; err.hidden = false; };
      var t1 = el('button', { class: 'btn primary', type: 'button', text: 'テスト通知を送る', disabled: !st.configured, onclick: function () { send('simple', this); } });
      var dests = st.dests || [];
      var pick = el('select', { id: 'slack-pick', 'aria-label': '通知の送り先', disabled: !dests.length, onchange: function () {
        api('slack_use', { body: { id: pick.value } }).then(function (j) { toast('送り先を「' + j.slack.active_name + '」に切り替えました'); draw(j.slack); }).catch(function (x) { fail(x); draw(st); });
      } });
      if (!dests.length) pick.appendChild(el('option', { value: '', text: '（まだ登録がありません）' }));
      dests.forEach(function (d) { pick.appendChild(el('option', { value: d.id, text: d.name + '　' + d.masked, selected: d.id === st.active })); });
      body.appendChild(el('div', { class: 'slack-status ' + (st.configured ? 'on' : 'off') },
        el('span', { class: 'pill' + (st.configured ? ' admin' : ''), text: st.configured ? '通知先: ' + st.active_name : '未設定' })));
      body.appendChild(el('label', null, '通知の送り先（選ぶと、すぐに切り替わります）', pick));
      body.appendChild(el('p', { class: 'hint', text: '選んだ送り先に、朝と夕方の「お休み」の通知（cron の設定が必要）が届きます。送る時刻や文章は、「通知の時間・文面を変える」で決めます。' }));
      var mine = dests.filter(function (d) { return d.id !== 'config'; });
      if (mine.length) {
        body.appendChild(el('div', { class: 'slack-dests' }, mine.map(function (d) {
          return el('div', { class: 'slack-dest' }, el('b', { text: d.name }), el('code', { text: d.masked }), d.id === st.active ? el('span', { class: 'pill admin', text: '使用中' }) : null,
            el('button', { class: 'btn small danger', type: 'button', text: '削除', onclick: function () {
              if (!window.confirm('「' + d.name + '」を削除します。よろしいですか？' + (d.id === st.active ? '\n（使用中のため、残りの送り先に自動で切り替わります）' : ''))) return;
              api('slack_delete', { body: { id: d.id } }).then(function (j) { toast('削除しました'); draw(j.slack); }).catch(fail);
            } }));
        })));
      }
      body.appendChild(el('form', { class: 'form slack-add', onsubmit: function (e) {
        e.preventDefault(); err.hidden = true;
        api('slack_add', { body: { name: nm.value.trim(), webhook: url.value.trim() } }).then(function (j) { toast('送り先を保存しました'); draw(j.slack); }).catch(fail2);
      } },
        el('h3', { text: '送り先を追加' }),
        el('label', null, 'チャンネル名（プルダウンに出る名前。自分で分かる名前を付けてください）', nm),
        el('label', null, 'Slack の Webhook URL', url),
        el('p', { class: 'hint', text: '取得方法: Slack の「アプリを追加」→「Incoming Webhooks」→「Slack に追加」→ 送り先のチャンネルを選ぶと、URL が表示されます。チャンネルごとに1つずつ作り、ここに名前を付けて保存します（最大10件）。URL は画面に全部は出さず、サーバーに保存されます。' }),
        err, el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'submit', text: '追加して保存' }))));
      body.appendChild(el('div', { class: 'slack-test' }, el('h3', { text: 'テスト送信' + (st.configured ? '（送り先: ' + st.active_name + '）' : '') }), el('div', { class: 'actions', style: 'justify-content:flex-start' }, t1), result));
      if (!st.configured) body.appendChild(el('p', { class: 'hint', text: '送り先がまだ無いので、テストはできません。「送り先を追加」に、チャンネル名と Webhook URL を入れて保存してください。' }));
      body.appendChild(el('p', { class: st.link === 'company' ? 'hint' : 'hint warn', text: st.link === 'company' ? '通知の「スケジュールを開く」は、会社用の共有リンクに飛びます（ログイン不要で、業務版のカレンダーを閲覧専用で見られます）。共有リンクを作り直すと、過去の通知のリンクは開けなくなります。'
        : st.link === 'login' ? '※ 通知の「スケジュールを開く」は、ログイン後に業務版が開くリンクです。ログインなしですぐ見られるようにするには、「設定」→「共有リンク」で、会社用リンクを作ってください（作ると、自動でそちらに切り替わります）。'
        : '※ config.php の base_url が空なので、通知に「スケジュールを開く」のリンクは付きません。' }));
      if (!ov.embedded) body.appendChild(el('div', { class: 'actions', style: 'justify-content:flex-start' }, el('button', { class: 'btn', type: 'button', text: '通知の時間・文面を変える', onclick: function () { ov.close(); openSlackCfgDialog(); } })));
      body.appendChild(el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
    }
    api('slack_status').then(function (j) { draw(j.slack); }).catch(function (x) { fail(x); ov.close(); });
  }

  /* ---------- Slack通知の時間・文面（管理者） ---------- */
  function openSlackCfgDialog() {
    var body = el('div', { class: 'form slack-cfg' });
    var ov = openModal('Slack通知の時間・文面', body, true);
    var last = null; // 最後に入力していた欄（差し込みボタンの入れ先）
    var timer = null;
    var F = {};      // 入力欄
    var PV = {};     // プレビュー欄
    var result = el('div', { class: 'slack-result', role: 'status', 'aria-live': 'polite' });
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    function track(inp) { inp.addEventListener('focus', function () { last = inp; }); inp.addEventListener('input', schedulePreview); return inp; }
    function insert(ph) {
      var t = last && document.body.contains(last) ? last : null;
      if (!t) return toast('差し込みたい欄を、先に押してください');
      var a = t.selectionStart == null ? t.value.length : t.selectionStart, b = t.selectionEnd == null ? a : t.selectionEnd;
      t.value = t.value.slice(0, a) + ph + t.value.slice(b); t.focus(); t.setSelectionRange(a + ph.length, a + ph.length); schedulePreview();
    }
    function chips(list) { return el('div', { class: 'slack-chips' }, el('span', { class: 'hint', text: '差し込み（押すと、入力中の欄に入ります）: ' }), list.map(function (ph) { return el('button', { class: 'chip', type: 'button', text: ph, onclick: function () { insert(ph); } }); })); }
    function read() {
      return {
        line: F.line.value, empty: { on: F.emptyOn.checked, text: F.emptyText.value },
        morning: { on: F.morOn.checked, time: timeVal(F.morTime), tpl: F.morning.value },
        evening: { on: F.eveOn.checked, time: timeVal(F.eveTime), tpl: F.evening.value }
      };
    }
    // 見本では、Slack のリンク <URL|文字> を、リンクの文字だけで見せる（Slack ではその文字がリンクになる）
    function showPv(pv) { err.hidden = true; ['morning', 'evening', 'none'].forEach(function (k) { PV[k].textContent = pv[k].replace(/<([^|>]+)\|([^>]+)>/g, '$2'); PV[k].classList.remove('bad'); }); }
    function schedulePreview() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        api('slack_cfg_preview', { body: { cfg: read() } }).then(function (j) {
          if (j.error) { ['morning', 'evening', 'none'].forEach(function (k) { PV[k].classList.add('bad'); }); err.textContent = j.error; err.hidden = false; } else showPv(j.preview);
        }).catch(function () { /* 入力途中の通信エラーは、無視する */ });
      }, 350);
    }
    function fill(c) {
      F.line.value = c.line; F.emptyOn.checked = c.empty.on; F.emptyText.value = c.empty.text;
      F.morOn.checked = c.morning.on; F.morTime.value = c.morning.time; F.morning.value = c.morning.tpl;
      F.eveOn.checked = c.evening.on; F.eveTime.value = c.evening.time; F.evening.value = c.evening.tpl;
    }
    function save(after, closeAfter) {
      err.hidden = true;
      api('slack_cfg_save', { body: { cfg: read() } }).then(function (j) { toast('保存しました'); if (closeAfter) { ov.close(); return; } fill(j.cfg); showPv(j.preview); if (after) after(); }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    }
    function sample(kind, btn) {
      var go = function () {
        btn.disabled = true; result.className = 'slack-result wait'; result.textContent = '送信しています…';
        api('slack_test', { body: { kind: kind } }).then(function (j) {
          if (j.result.ok) { result.className = 'slack-result ok'; result.textContent = '✓ 送信できました。Slack に、届いているか確認してください（保存した文面で送っています）。'; }
          else { result.className = 'slack-result ng'; result.textContent = '✕ 送信できませんでした。' + slackFailHint(j.result); }
        }).catch(function (x) { result.className = 'slack-result ng'; result.textContent = '✕ ' + x.message; }).then(function () { btn.disabled = false; });
      };
      save(go); // 画面の入力を保存してから、その文面で見本を送る
    }
    function section(title, onBox, extra, ta, key) {
      PV[key] = el('pre', { class: 'slack-preview', 'aria-label': 'プレビュー' });
      return el('section', { class: 'slack-sec' }, el('h3', null, el('label', { class: 'work' }, onBox, ' ' + title)), extra,
        track(ta), el('div', { class: 'hint', text: 'Slack での見え方（見本）' }), PV[key],
        el('div', { class: 'actions', style: 'justify-content:flex-start' }, el('button', { class: 'btn small', type: 'button', text: '保存して、この文面の見本を Slack に送る', onclick: function () { sample(key, this); } })));
    }
    api('slack_cfg').then(function (j) {
      var c = j.cfg, ph = j.placeholders;
      F.line = track(el('input', { type: 'text', maxlength: '100', autocomplete: 'off' }));
      F.emptyOn = el('input', { type: 'checkbox' }); F.emptyText = track(el('input', { type: 'text', maxlength: '50', autocomplete: 'off' }));
      PV.none = el('pre', { class: 'slack-preview', 'aria-label': 'プレビュー' });
      F.morOn = el('input', { type: 'checkbox' }); F.eveOn = el('input', { type: 'checkbox' });
      F.morTime = timeInput('morTime', c.morning.time); F.eveTime = timeInput('eveTime', c.evening.time);
      F.morning = el('textarea', { rows: '4', maxlength: '250' }); F.evening = el('textarea', { rows: '4', maxlength: '250' });
      F.morTime.addEventListener('input', schedulePreview); F.eveTime.addEventListener('input', schedulePreview);
      [F.emptyOn, F.morOn, F.eveOn].forEach(function (x) { x.addEventListener('change', schedulePreview); });
      body.appendChild(el('p', { class: 'hint', text: 'Slack に送る通知の「いつ」と「どんな文章か」を変えられます。保存すると、すぐに次の通知から変わります。' }));
      body.appendChild(section('朝の通知（その日の休み）', F.morOn,
        [el('div', { class: 'slack-time' }, el('label', null, '送る時刻', F.morTime), el('span', { class: 'hint', text: '土日祝・会社の休業日は送りません（休みの人がいない営業日は「休みなし」と送ります）' })), chips(ph.day)], F.morning, 'morning'));
      body.appendChild(section('夕方の通知（次の営業日の休み）', F.eveOn,
        [el('div', { class: 'slack-time' }, el('label', null, '送る時刻', F.eveTime), el('span', { class: 'hint', text: '翌日が営業日のときに送ります（休みの人がいなければ「休みなし」と送ります）' })), chips(ph.day)], F.evening, 'evening'));
      body.appendChild(el('section', { class: 'slack-sec' }, el('h3', { text: '1人分の表示と、休みの人がいない日' }),
        el('label', null, '休みの一覧に出る、1人分の書き方（{名前} は必須。初期値は名前だけ）', F.line), chips(ph.line),
        el('h3', { text: '休みの人がいない日' }),
        el('label', { class: 'work' }, F.emptyOn, ' 営業日で、休みの人がいない日にも、通知する'),
        el('label', null, '{休み一覧} の代わりに出す文言', F.emptyText), el('div', { class: 'hint', text: '朝の通知の見え方（見本）' }), PV.none));
      body.appendChild(el('p', { class: 'hint', text: '※ 通知の時刻は、サーバーの cron が「php bin/cron.php notify」を5〜10分おきに動かしているときに、有効になります。設定した時刻から3時間以内に、1回だけ送ります。cron の登録方法は、docs/DEPLOY.md の「9. 毎日の自動処理」にあります。以前の「morning」「evening」の cron を使っている場合は、その時刻に従来どおり送られます（時刻は cron の設定のまま）。' }));
      body.appendChild(err); body.appendChild(result);
      body.appendChild(el('div', { class: 'actions' },
        el('button', { class: 'btn', type: 'button', text: '初期値に戻す（まだ保存しません）', onclick: function () { fill(j.defaults); schedulePreview(); } }),
        el('button', { class: 'btn primary', type: 'button', text: '保存', onclick: function () { save(null, true); } }),
        el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
      fill(c); showPv(j.preview);
    }).catch(function (x) { fail(x); ov.close(); });
  }

  /* ---------- 管理者向け ---------- */
  /* 社員のパスワードのリセット（管理者）。一時パスワードを1度だけ表示する。本人は、次にログインしたとき、自分のパスワードに変更する */
  function resetPasswordFor(u, done) {
    if (!window.confirm(u.name + ' さんのパスワードをリセットします。\n今のパスワードでは、ログインできなくなります。よろしいですか？')) return;
    api('user_reset_password', { body: { id: u.id } }).then(function (j) {
      var pw = el('input', { type: 'text', readonly: true, value: j.password, class: 'temp-pw', 'aria-label': '一時パスワード', onfocus: function () { this.select(); } });
      var ov = openModal('パスワードをリセットしました', el('div', { class: 'form' },
        el('p', { text: u.name + ' さんの一時パスワードです。本人に伝えてください。' }),
        el('div', { class: 'row' }, pw, el('button', { class: 'btn', type: 'button', text: 'コピー', onclick: function () {
          pw.select();
          var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(j.password).then(function () { toast('コピーしました'); }, function () { toast(ok ? 'コピーしました' : '選択しました。コピーしてください'); }); else toast(ok ? 'コピーしました' : '選択しました。コピーしてください');
        } })),
        el('p', { class: 'hint', text: 'この画面を閉じると、二度と表示されません（忘れたときは、もう一度リセットしてください）。本人は、次にログインしたとき、自分だけのパスワードに変更します。' }),
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: '伝えた（閉じる）', onclick: function () { ov.close(); done(); } }))), false, true); // 閉じ忘れを防ぐため、ボタンを押すまで閉じられない
    }).catch(fail);
  }
  function openUsersDialog() {
    var body = el('div', { class: 'form' });
    var ov = openModal('社員の管理', body, true);
    function refresh() {
      api('users_list').then(function (j) {
        body.textContent = '';
        body.appendChild(el('div', { class: 'scroll-x' }, el('table', { class: 't stack' },
          el('thead', null, el('tr', null, ['名前', 'メールアドレス', '権限', ''].map(function (h) { return el('th', { text: h }); }))),
          el('tbody', null, j.users.map(function (u) {
            return el('tr', null, el('td', { text: u.name + (u.active ? '' : '（停止中）') + (u.must_change_password ? '（初回パスワード未変更）' : '') }), el('td', { text: u.email }),
              el('td', null, el('span', { class: 'pill' + (u.role === 'admin' ? ' admin' : ''), text: u.role === 'admin' ? '管理者' : '一般' })),
              el('td', { class: 'row-btns' }, el('button', { class: 'btn small', type: 'button', text: '編集', onclick: function () { openUserForm(u, refresh); } }),
                u.id === S.me.user.id ? null : el('button', { class: 'btn small', type: 'button', text: 'パスワードをリセット', title: '新しい一時パスワードを作ります（本人は、次のログインで変更します）', onclick: function () { resetPasswordFor(u, refresh); } })));
          })))));
        body.appendChild(el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: '＋ 社員を追加', onclick: function () { openUserForm(null, refresh); } }),
          el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
      }).catch(fail);
    }
    refresh();
  }

  function openUserForm(u, done) {
    var f = {
      name: el('input', { name: 'name', required: true, maxlength: '60', value: u ? u.name : '' }),
      email: el('input', { name: 'email', type: 'email', required: true, value: u ? u.email : '' }),
      role: el('select', { name: 'role' }, [['member', '一般'], ['admin', '管理者']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: u && u.role === o[0] }); })),
      pw: el('input', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: !u }),
      active: el('input', { type: 'checkbox', checked: u ? !!u.active : true, style: 'width:auto' })
    };
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('user_save', { body: { id: u ? u.id : null, name: f.name.value, email: f.email.value, role: f.role.value, password: f.pw.value, active: f.active.checked ? 1 : 0 } })
        .then(function () { ov.close(); toast('保存しました'); done(); }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('div', { class: 'row' }, el('label', null, '名前', f.name), el('label', null, 'メールアドレス（ログインID）', f.email)),
      el('label', null, '権限', f.role),
      el('label', null, u ? '新しいパスワード（変更する場合のみ・8文字以上）' : 'パスワード（8文字以上）', f.pw),
      u ? el('label', { style: 'flex-direction:row;align-items:center;display:flex;gap:6px' }, f.active, '利用を許可する（退職時などは外す）') : null,
      el('p', { class: 'hint', text: u ? 'パスワードを入力して保存すると、その人は次のログイン時に、新しいパスワードへの変更を求められます。' : 'ここで決めたパスワードは初期パスワードです。本人に伝えてください。最初のログイン時に、本人が別のパスワードへ変更します。' }),
      el('p', { class: 'hint', text: '管理者は、他の社員の休みの登録・編集ができます。プライベートの予定は、管理者にも見えません。' }),
      err,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '保存' })));
    var ov = openModal(u ? '社員を編集' : '社員を追加', form);
  }

  function openHolidaysDialog() {
    var body = el('div', { class: 'form' });
    var ov = openModal('会社の休業日', body);
    function refresh() {
      api('holidays_list').then(function (j) {
        body.textContent = '';
        body.appendChild(el('p', { class: 'hint', text: '国の祝日は自動で判定されます。年末年始などの会社独自の休みをここに追加すると、繰り返し業務の日付計算で「休日」として扱われます。続く休みは、終了日も入れると、まとめて登録できます。' }));
        var d = el('input', { type: 'date', required: true }), d2 = el('input', { type: 'date' }), n = el('input', { required: true, maxlength: '60', placeholder: '例: 年末年始休業' });
        d.addEventListener('change', function () { if (d2.value && d2.value < d.value) d2.value = d.value; d2.min = d.value; });
        body.appendChild(el('form', { class: 'row', onsubmit: function (e) {
          e.preventDefault();
          api('holiday_save', { body: { hdate: d.value, hdate_end: d2.value, name: n.value } }).then(function (r) { toast(r.added + '日分を追加しました'); refresh(); load(); }).catch(fail);
        } }, el('label', null, '開始日', d), el('label', null, '終了日（1日だけなら空欄）', d2), el('label', null, '名前', n), el('div', { style: 'align-self:end' }, el('button', { class: 'btn primary', type: 'submit', text: '追加' }))));
        // 続いている同じ名前の休みは、「12/29（火）〜1/3（日）」のように1行にまとめて表示する
        var groups = [];
        j.holidays.forEach(function (h) {
          var g = groups[groups.length - 1];
          if (g && g.name === h.name && daysBetween(g.to, h.hdate) === 1) { g.to = h.hdate; g.ids.push(h.id); } else groups.push({ name: h.name, from: h.hdate, to: h.hdate, ids: [h.id] });
        });
        var range = function (g) { return g.from === g.to ? mdw(g.from) + ' ' + g.from.slice(0, 4) : mdw(g.from) + ' 〜 ' + mdw(g.to) + ' ' + g.to.slice(0, 4) + '（' + g.ids.length + '日間）'; };
        body.appendChild(groups.length ? el('table', { class: 't' }, el('tbody', null, groups.map(function (g) {
          return el('tr', null, el('td', { text: range(g) }), el('td', { text: g.name }), el('td', null, el('button', { class: 'btn small danger', type: 'button', text: '削除', onclick: function () {
            if (g.ids.length > 1 && !window.confirm(g.ids.length + '日間の休業日を、まとめて削除します。よろしいですか？')) return;
            api('holiday_delete', { body: { ids: g.ids } }).then(function () { refresh(); load(); }).catch(fail);
          } })));
        }))) : el('p', { class: 'muted', text: '登録されている休業日はありません。' }));
        body.appendChild(el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } })));
      }).catch(fail);
    }
    refresh();
  }

  // forced=true: 初期パスワードのままの人への案内。変更するまで閉じられない
  function openPasswordDialog(forced, onDone) {
    var cur = el('input', { type: 'password', required: true, autocomplete: 'current-password' });
    var nw = el('input', { type: 'password', required: true, minlength: '8', autocomplete: 'new-password' });
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('password_change', { body: { current_password: cur.value, new_password: nw.value } }).then(function () {
        ov.close(); toast('パスワードを変更しました');
        if (onDone) onDone();
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      forced ? el('div', { class: 'notice' }, el('b', { text: 'はじめにパスワードを変更してください' }),
        el('p', { text: '管理者が決めた初期パスワードでログインしています。ご自身だけが知っているパスワードに変更すると、予定の画面に進めます。' })) : null,
      el('label', null, forced ? '現在のパスワード（管理者から伝えられたもの）' : '現在のパスワード', cur),
      el('label', null, '新しいパスワード（8文字以上・現在のものとは別）', nw), err,
      el('div', { class: 'actions' },
        forced ? el('button', { class: 'btn left', type: 'button', text: 'ログアウト', onclick: doLogout }) : el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }),
        el('button', { class: 'btn primary', type: 'submit', text: '変更する' })));
    var ov = openModal(forced ? 'パスワードの変更（初回のみ）' : 'パスワードの変更', form, false, forced);
  }

  function doLogout() {
    var f = el('form', { method: 'post', action: 'logout.php' }, el('input', { type: 'hidden', name: 'csrf', value: csrf }));
    document.body.appendChild(f); f.submit();
  }

  /* ---------- 自動更新 ----------
   * 他の人（同僚・共有リンクを見ている家族）が予定やToDoを変えたら、開いている画面に自動で反映する。
   * 共有レンタルサーバーでは、サーバーから画面へ即時に通知できないため、画面が「更新番号」を一定間隔で軽く確認する方式。
   *  ・番号が変わったときだけ、予定とToDoを読み直す（変わっていなければ何も描き直さない）
   *  ・編集画面を開いている間・ドラッグ中は、画面を組み替えない（閉じたあとに反映）
   *  ・非表示のタブでは確認しない（見えるようになった瞬間に確認）
   *  ・自分が更新したあとは、読み直した時点で番号が追いつくので、二重に読み直さない */
  // 確認の間隔(ミリ秒)。サーバーの設定(poll_seconds)が渡される。0 = 自動更新しない。SCHEDULE_POLL_TEST_MS は自動テストで間隔を短くするための入口
  var POLL_MS = typeof window.SCHEDULE_POLL_TEST_MS === 'number' ? window.SCHEDULE_POLL_TEST_MS : typeof window.SCHEDULE_POLL_MS === 'number' ? window.SCHEDULE_POLL_MS : 20000;
  var pollBusy = false;
  function canRefresh() { return !S.drag && !modals.length; }
  /* 予定とToDoは別々に判定し、古くなったほうだけを読み直す（自分が予定を更新したあとに、予定まで二重に読み直さない） */
  /* アプリが更新されたら、開いたままの画面も自動で開き直す（入力中・ドラッグ中・ダイアログを開いている間は、終わるまで待つ） */
  function maybeReload() {
    if (!S.reloadPending) return false;
    var a = document.activeElement;
    var typing = a && ((a.tagName === 'INPUT' && a.type === 'text' && a.value !== '') || (a.tagName === 'TEXTAREA' && a.value !== ''));
    if (!canRefresh() || typing) {
      if (!S.reloadNotified) { S.reloadNotified = true; toast('新しい版に更新されました。入力が終わると、自動で開き直します'); }
      return true;
    }
    flushMemo(); // 書きかけの日報メモを保存してから
    toast('新しい版に更新されました。画面を開き直します');
    S.reloadPending = false;
    setTimeout(function () { location.reload(); }, 800);
    return true;
  }
  function maybeRefresh() {
    if (maybeReload()) return;
    if ((!S.pendEv && !S.pendTd) || !canRefresh()) return;
    var ev = S.pendEv, td = S.pendTd;
    S.pendEv = false; S.pendTd = false;
    if (ev) load();
    if (td && !SHARE) loadTodos();
  }
  function pollRev() {
    if (document.hidden || pollBusy || !S.me) return;
    pollBusy = true;
    api('rev', { quiet: true }).then(function (j) {
      pollBusy = false;
      if (j.build && window.SCHEDULE_BUILD && j.build !== window.SCHEDULE_BUILD) S.reloadPending = true;
      if (S.revEv !== null && j.rev !== S.revEv) S.pendEv = true;
      if (!SHARE && S.revTd !== null && j.rev !== S.revTd) S.pendTd = true;
      maybeRefresh();
    }).catch(function () { pollBusy = false; }); // 通信できないときは、黙って次回に回す
  }
  function startAutoRefresh() {
    if (!POLL_MS) return;
    setInterval(pollRev, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pollRev(); });
    window.addEventListener('focus', pollRev);
  }

  /* ---------- 起動 ---------- */
  applyTheme();
  if (SHARE) {
    api('meta').then(function (m) {
      S.me = { user: { id: 0, name: '閲覧専用', role: 'viewer' }, app_name: m.app_name, work_tags: [], off_tags: [], users: [] };
      S.shareTitle = m.title;
      S.view = SHARE.kind === 'family' ? 'me' : 'team';
      S.mode = SHARE.kind === 'family' ? 'cal' : (store('sched.mode') === 'list' ? 'list' : 'cal'); // 家族用はカレンダーだけ
      document.title = m.title;
      var now = new Date();
      S.year = now.getFullYear(); S.month = now.getMonth() + 1;
      renderShell(); load(); startAutoRefresh();
    }).catch(function (e) { if (window.console) console.error(e); root.textContent = 'このリンクは無効です。共有してくれた方に確認してください。'; });
    return;
  }
  api('me').then(function (me) {
    S.me = me;
    csrf = me.csrf;
    var now = new Date();
    S.year = now.getFullYear(); S.month = now.getMonth() + 1;
    S.view = store('sched.view') === 'me' ? 'me' : 'team';
    if (/[?&]view=team(&|$)/.test(location.search)) { // 通知のリンクから開いたときは、必ず業務版
      S.view = 'team'; store('sched.view', 'team');
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* 履歴を触れなくても、表示には影響しない */ }
    }
    S.mode = store('sched.mode') === 'list' ? 'list' : (store('sched.mode') === 'grid' && S.view === 'team' ? 'grid' : 'cal');
    S.listWork = store('sched.listWork') === true;
    S.who = String(me.user.id); // ログインして開いたときは、まず自分のカレンダー・自分のToDo（「表示する人」「表示」で全員にも切り替えられる。開き直すと自分に戻る）
    S.todoWho = 'me';
    var start = function () { renderShell(); load(); startAutoRefresh(); };
    if (me.user.must_change_password) {
      root.textContent = '';
      openPasswordDialog(true, start); // 変更が終わるまで予定の画面は出さない
    } else {
      start();
    }
  }).catch(function (e) { if (e.message !== 'login') root.textContent = 'うまく読み込めませんでした: ' + e.message; });
})();
