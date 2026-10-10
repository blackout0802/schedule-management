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
    last_bizday: '毎月の最終営業日'
  };

  var S = {
    me: null, view: 'team', year: 0, month: 0, mode: 'cal', todos: [], done: [], drag: null, revEv: null, revTd: null, pendEv: false, pendTd: false, memoHtml: '', memoLoaded: false,
    events: [], holidays: {}, tags: null, showOff: true, loading: false
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
  function fail(e) { if (e.message !== 'login') toast(e.message); }

  /* ---------- モーダル ---------- */
  var modals = [];
  function openModal(title, body, wide, locked) {
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
  });

  /* ---------- 予定の色（本人の画面だけ） ----------
     単発の業務・繰り返しの業務・休み・プライベートの色を、本人が選べる。選んだ色は、文字（塗りつぶし）の色になり、淡い背景は、その色から作る。
     ダークモードでは、暗い色が読めなくなるので、選んだ色を明るい側へ寄せて表示する。 */
  var COLOR_DEFS = [
    ['work', '単発の業務', 'bar work', '打ち合わせの準備'], ['rec', '繰り返しの業務', 'bar work rec', '↻ 毎月の締め'],
    ['off', '休み', 'bar off', '山田 花子 有給'], ['private', 'プライベート', 'bar private', '歯医者の予約']
  ];
  var COLOR_PRESETS = ['#2155d6', '#0b7285', '#0d7f62', '#2b8a3e', '#9a4a00', '#c0392b', '#a61e4d', '#8337c9', '#5f3dc4', '#495057'];
  function isDarkTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function toneColor(hex) {
    if (!isDarkTheme()) return hex;
    var n = parseInt(hex.slice(1), 16), mix = function (c) { return Math.round(c + (255 - c) * 0.45); };
    return 'rgb(' + mix(n >> 16 & 255) + ',' + mix(n >> 8 & 255) + ',' + mix(n & 255) + ')';
  }
  /* 色の設定から、CSSの変数（--uc-* 文字・塗りつぶし、--ub-* 淡い背景）を作る。未設定の項目は作らない（標準の色になる） */
  function colorVars(colors) {
    var v = {};
    COLOR_DEFS.forEach(function (d) {
      var c = colors && colors[d[0]];
      if (!c) return;
      var f = toneColor(c);
      v['--uc-' + d[0]] = f;
      if (d[0] !== 'rec') v['--ub-' + d[0]] = 'color-mix(in srgb, ' + f + ' 16%, var(--surface))';
    });
    return v;
  }
  function applyColors(colors) {
    var st = document.documentElement.style, v = colorVars(colors);
    COLOR_DEFS.forEach(function (d) { st.removeProperty('--uc-' + d[0]); st.removeProperty('--ub-' + d[0]); });
    Object.keys(v).forEach(function (k) { st.setProperty(k, v[k]); });
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onTheme = function () { if (S.me && S.me.prefs) applyColors(S.me.prefs.colors); };
    if (mq.addEventListener) mq.addEventListener('change', onTheme); else if (mq.addListener) mq.addListener(onTheme);
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
  function openColorDialog() {
    var pending = {};
    COLOR_DEFS.forEach(function (d) { pending[d[0]] = (S.me.prefs && S.me.prefs.colors && S.me.prefs.colors[d[0]]) || ''; });
    var rows = el('div', { class: 'cs-rows' });
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    function styleOf() { var v = colorVars(pending); return Object.keys(v).map(function (k) { return k + ':' + v[k]; }).join(';'); }
    function draw() {
      rows.textContent = '';
      COLOR_DEFS.forEach(function (d) {
        var key = d[0], cur = pending[key];
        var sample = el('div', { class: 'cs-sample', style: styleOf() }, el('div', { class: d[2], text: d[3] }));
        var warn = el('span', { class: 'cs-warn', hidden: true, text: '⚠ 背景と色が近く、読みにくいかもしれません' });
        var sw = el('div', { class: 'cs-sw' }, COLOR_PRESETS.map(function (c) {
          return el('button', { type: 'button', class: 'sw', style: 'background:' + c, 'aria-label': c, 'aria-pressed': cur === c ? 'true' : 'false', title: c, onclick: function () { pending[key] = c; draw(); } });
        }), el('input', { type: 'color', 'aria-label': d[1] + 'の色を自由に選ぶ', value: cur || '#2155d6', onchange: function () { pending[key] = this.value.toLowerCase(); draw(); } }),
          el('button', { type: 'button', class: 'btn small', text: '標準に戻す', disabled: !cur, onclick: function () { pending[key] = ''; draw(); } }));
        rows.appendChild(el('div', { class: 'cs-row' }, el('div', { class: 'cs-top' }, el('span', { class: 'cs-name', text: d[1] }), warn), sw, sample));
        var bar = sample.querySelector('.bar'), cs = getComputedStyle(bar), fg = parseRgb(cs.color), bg = parseRgb(cs.backgroundColor);
        if (cur && fg && bg && contrastRatio(fg, bg) < 4.5) warn.hidden = false;
      });
    }
    draw();
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('prefs_save', { body: { colors: pending } }).then(function (j) {
        S.me.prefs = j.prefs; applyColors(j.prefs.colors); ov.close(); toast('色を保存しました'); renderBoard();
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('p', { class: 'hint', text: '予定の色を、自分の画面だけ変えられます（他の人の画面・共有リンクは、標準の色のままです）。選んだ色が、文字の色になり、背景は、その色から淡く作ります。ダークモードでは、暗い色を自動で明るくします。' }),
      rows, err,
      el('div', { class: 'actions' },
        el('button', { class: 'btn left', type: 'button', text: 'すべて標準に戻す', onclick: function () { COLOR_DEFS.forEach(function (d) { pending[d[0]] = ''; }); draw(); } }),
        el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '保存' })));
    var ov = openModal('予定の色の設定', form, true);
  }

  /* ---------- ショートカットキー ----------
     c カレンダー / l リスト / t 今日 / ← → 前の月・次の月 / n 予定を追加 / b 業務版 / p プライベート版 / ? 一覧
     入力欄に文字を打っているとき、ダイアログを開いているとき、Ctrl・Alt・Command を押しているときは、動かさない。
     日本語入力がオンでも動くよう、文字ではなく、キーの位置（KeyC など）で判定する。 */
  var SHORTCUTS = [
    ['c', 'カレンダーを表示'], ['l', 'リストを表示'], ['t', '今月に戻る（今日）'], ['← / →', '前の月 / 次の月'],
    ['n', '予定を追加'], ['b', '業務版に切り替え'], ['p', 'プライベート版に切り替え'], ['?', 'このショートカット一覧']
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
    var rows = SHORTCUTS.map(function (s) { return el('tr', null, el('th', { scope: 'row' }, el('kbd', { text: s[0] })), el('td', { text: s[1] })); });
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
    var done = true;
    if (k === 'c') setMode('cal');
    else if (k === 'l' && !FAMILY) setMode('list');
    else if (k === 't') goToday();
    else if (k === 'ArrowLeft') navMonth(-1);
    else if (k === 'ArrowRight') navMonth(1);
    else if (k === '?') openShortcuts();
    else if (!SHARE && k === 'n') openEventDialog(null, ymd(new Date()));
    else if (!SHARE && k === 'b') setView('team');
    else if (!SHARE && k === 'p') setView('me');
    else done = false;
    if (done) e.preventDefault();
  });

  /* ---------- 画面の骨組み ---------- */
  /* 共有リンクの閲覧ページ: 月の移動と、予定の詳細を見るだけ。編集・ToDo・メモは無い */
  function renderShareShell() {
    root.textContent = '';
    root.appendChild(el('header', { class: 'topbar' }, el('div', { class: 'topbar-in' }, el('span', { class: 'brand', text: S.shareTitle }))));
    root.appendChild(el('main', null, el('div', { id: 'toolbar' }), el('div', { class: 'layout single' }, el('div', { id: 'board', class: 'board' }))));
    renderToolbar();
  }

  function renderShell() {
    if (SHARE) return renderShareShell();
    flushMemo();
    root.textContent = '';
    var menuList = null;
    var menuBtn = el('button', { class: 'btn small', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: S.me.user.name + ' ▾' });
    var items = [
      el('button', { type: 'button', text: '繰り返し業務の設定', onclick: function () { closeMenu(); openSeriesDialog(); } }),
      el('button', { type: 'button', text: '共有リンク（家族・会社へ）', onclick: function () { closeMenu(); openShareDialog(); } })
    ];
    if (S.me.user.role === 'admin') {
      items.push(el('button', { type: 'button', text: '社員の管理', onclick: function () { closeMenu(); openUsersDialog(); } }));
      items.push(el('button', { type: 'button', text: '会社の休業日', onclick: function () { closeMenu(); openHolidaysDialog(); } }));
      items.push(el('button', { type: 'button', text: 'システム更新', onclick: function () { location.href = 'update.php'; } }));
    }
    items.push(el('hr'));
    items.push(el('button', { type: 'button', text: '予定の色の設定', onclick: function () { closeMenu(); openColorDialog(); } }));
    items.push(el('button', { type: 'button', text: 'ショートカットキー（?）', onclick: function () { closeMenu(); openShortcuts(); } }));
    items.push(el('button', { type: 'button', text: 'パスワードの変更', onclick: function () { closeMenu(); openPasswordDialog(); } }));
    items.push(el('button', { type: 'button', text: 'ログアウト', onclick: doLogout }));
    function closeMenu() { if (menuList) { menuList.remove(); menuList = null; menuBtn.setAttribute('aria-expanded', 'false'); } }
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menuList) return closeMenu();
      menuList = el('div', { class: 'menu-list' }, items);
      menuBtn.parentNode.appendChild(menuList);
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('click', closeMenu);

    var tabs = el('div', { class: 'tabs', role: 'tablist' },
      ['team', 'me'].map(function (v) {
        return el('button', { class: 'tab', type: 'button', role: 'tab', 'data-view': v, 'aria-selected': S.view === v ? 'true' : 'false',
          text: v === 'team' ? '業務版' : 'プライベート版', title: (v === 'team' ? '業務版（b）' : 'プライベート版（p）'), onclick: function () { setView(v); } });
      }));

    root.appendChild(el('header', { class: 'topbar' }, el('div', { class: 'topbar-in' },
      el('span', { class: 'brand', text: S.me.app_name }), tabs, el('span', { class: 'spacer' }),
      el('div', { class: 'menu' }, menuBtn))));
    root.appendChild(el('main', null, el('div', { id: 'toolbar' }), el('div', { id: 'filters' }),
      el('div', { class: 'layout' }, el('div', { id: 'board', class: 'board' }),
        el('div', { class: 'side' }, el('aside', { id: 'todo', class: 'todo', 'aria-label': 'ToDoリスト' }), el('section', { id: 'memo', class: 'todo memo', 'aria-label': 'メモ（日報用）' })))));
    renderToolbar();
    renderFilters();
    loadTodos();
    renderMemo();
  }

  /* 業務版で見る人。'all' = 全社（全員）、数字 = その社員だけ（自分を含む）。いまの社員一覧に無いidは、全社に戻す */
  function whoId() {
    var w = S.who;
    if (!w || w === 'all') return 0;
    return S.me.users.some(function (u) { return String(u.id) === String(w); }) ? +w : 0;
  }
  function whoName() { var id = whoId(); var u = S.me.users.filter(function (x) { return x.id === id; })[0]; return u ? u.name : ''; }

  /* 月の移動・今日・版（業務／プライベート）・「表示する人」の切り替え。ボタンとショートカットキーの両方から使う */
  function navMonth(delta) { var d = new Date(S.year, S.month - 1 + delta, 1); S.year = d.getFullYear(); S.month = d.getMonth() + 1; renderToolbar(); load(); }
  function goToday() { var n = new Date(); S.year = n.getFullYear(); S.month = n.getMonth() + 1; renderToolbar(); load(); }
  function setView(v) { if (S.view === v) return; S.view = v; store('sched.view', v); renderShell(); load(); }
  function selectWho(val) { S.who = val; store('sched.who', S.who); renderToolbar(); load(); }

  function renderToolbar() {
    var tb = document.getElementById('toolbar');
    tb.textContent = '';
    tb.appendChild(el('div', { class: 'toolbar' },
      el('button', { class: 'btn', type: 'button', 'aria-label': '前の月', title: '前の月（←）', text: '‹', onclick: function () { navMonth(-1); } }),
      el('h2', { text: S.year + '年' + S.month + '月' }),
      el('button', { class: 'btn', type: 'button', 'aria-label': '次の月', title: '次の月（→）', text: '›', onclick: function () { navMonth(1); } }),
      el('button', { class: 'btn', type: 'button', title: '今月へ戻る（t）', text: '今日', onclick: goToday }),
      el('span', { class: 'spacer', style: 'flex:1' }),
      SHARE || S.view !== 'team' ? null : el('label', { class: 'who' }, '表示する人',
        el('select', { id: 'who-sel', 'aria-label': '表示する人', onchange: function () { selectWho(this.value); } },
          el('option', { value: 'all', text: '全社（全員）', selected: !whoId() }),
          el('option', { value: String(S.me.user.id), text: '自分', selected: whoId() === S.me.user.id }),
          S.me.users.filter(function (u) { return u.id !== S.me.user.id; }).map(function (u) { return el('option', { value: String(u.id), text: u.name, selected: whoId() === u.id }); }))),
      SHARE && SHARE.kind === 'family' ? null : el('div', { class: 'seg', role: 'group', 'aria-label': '表示の切り替え' },
        [['cal', 'カレンダー'], ['list', 'リスト']].map(function (m) {
          return el('label', { class: 'work', title: m[0] === 'cal' ? 'カレンダー（c）' : 'リスト（l）' }, el('input', { type: 'radio', name: 'mode', checked: S.mode === m[0], onchange: function () { setMode(m[0]); } }), m[1]);
        })),
      SHARE ? null : el('button', { class: 'btn', type: 'button', text: '↻ 繰り返し業務', title: '毎月くり返す業務を登録・変更する（請求処理、棚卸し、25日の提出など）', onclick: function () { openSeriesDialog(); } }),
      SHARE ? null : el('button', { class: 'btn primary', type: 'button', text: '＋ 予定を追加', onclick: function () { openEventDialog(null, ymd(new Date())); } })
    ));
    tb.appendChild(el('div', { class: 'view-banner ' + (SHARE ? (SHARE.kind === 'family' ? 'me' : 'team') : S.view), style: 'margin-top:8px',
      text: SHARE ? (SHARE.kind === 'family' ? '共有された予定です（閲覧専用）。' : '会社の業務の予定と休みです（閲覧専用。プライベートの予定は含まれません）。')
        : S.view === 'team' ? (whoId() ? '業務版: ' + (whoId() === S.me.user.id ? '自分' : whoName() + 'さん') + 'の予定（業務・休み）だけを表示しています（プライベートの予定は含まれません）' : '業務版: 会社の全員に共有される予定だけを表示しています（プライベートの予定は含まれません）') : 'プライベート版: 自分のプライベート予定と、選んだ業務の予定を重ねて表示しています' }));
  }


  function renderFilters() {
    var box = document.getElementById('filters');
    box.textContent = '';
    if (S.view !== 'me') return;
    var onChange = function () { store('sched.filters', { tags: S.tags, showOff: S.showOff }); load(); };
    var chips = S.me.work_tags.map(function (t) {
      return el('label', { class: 'fchip' }, el('input', { type: 'checkbox', checked: S.tags.indexOf(t) >= 0, onchange: function (e) {
        S.tags = e.target.checked ? S.tags.concat([t]) : S.tags.filter(function (x) { return x !== t; }); onChange();
      } }), t);
    });
    chips.push(el('label', { class: 'fchip' }, el('input', { type: 'checkbox', checked: S.showOff, onchange: function (e) { S.showOff = e.target.checked; onChange(); } }), '同僚の休み'));
    box.appendChild(el('div', { class: 'filters', role: 'group', 'aria-label': '表示する業務の予定' }, el('span', { class: 'lbl', text: '表示する業務:' }), chips));
  }

  /* ---------- データの読み込みと描画 ---------- */
  function gridRange() {
    var first = new Date(S.year, S.month - 1, 1);
    var start = addDays(first, -first.getDay());
    var last = new Date(S.year, S.month, 0);
    var end = addDays(last, 6 - last.getDay());
    return { start: start, end: end };
  }

  function load() {
    var r = gridRange();
    var params = { from: ymd(r.start), to: ymd(r.end), view: S.view };
    if (S.view === 'me' && !SHARE) { params.tags = S.tags.join(','); params.off = S.showOff ? '1' : '0'; }
    if (S.view === 'team' && !SHARE && whoId()) params.who = String(whoId()); // 業務版で、特定の社員だけを見ているとき
    if (!SHARE) params.sum = S.year + '-' + pad(S.month); // 表示している月の、自分の出勤日・休みの日数
    S.loading = true;
    // 家族用の共有ページでは、更新履歴も一緒に読む（前回見たときからの更新を目立たせるため）
    Promise.all([api('events', { params: params }), FAMILY ? api('log') : Promise.resolve(null)]).then(function (r) {
      var j = r[0];
      if (r[1]) setUpdateLog(r[1]);
      S.events = j.events; S.holidays = j.holidays; S.summary = j.summary || null; buildLeaveIdx(); S.loading = false; S.revEv = j.rev; renderBoard();
    }).catch(fail);
  }

  /* ---------- 家族用: 更新履歴と、前回から更新された予定の目印 ---------- */
  function seenKey() { return 'sched.seen.' + SHARE.token.slice(0, 16); }
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
  function updatesBanner() {
    if (!FAMILY || !S.log) return null;
    var n = (S.newLog || []).length;
    return el('div', { class: 'upd-banner' + (n ? ' has' : ''), role: 'status' },
      el('span', { class: 'upd-msg', text: n ? '前回確認した ' + fmtAt(S.seen.at) + ' から、' + n + '件の更新があります。更新された予定には ● と色の枠が付いています。' : '前回から新しい更新はありません。' }),
      el('span', { class: 'upd-btns' },
        el('button', { class: 'btn small' + (n ? ' primary' : ''), type: 'button', text: '更新履歴を見る', onclick: openUpdateLog }),
        n ? el('button', { class: 'btn small', type: 'button', text: '確認した', onclick: markSeen }) : null));
  }

  function eventLabel(e, first) {
    var t;
    if (e.kind === 'off' && SHARE && SHARE.kind === 'family') {
      t = '休み'; // 家族用の共有には、名前も休みの種類も出さない
    } else if (e.kind === 'off') {
      t = e.owner_name + ' ' + (e.tag || '休み');
      if (e.title && e.title !== '休み') t += '（' + e.title + '）';
    } else t = e.title;
    var time = first && e.start_time ? e.start_time + (e.end_time ? '-' + e.end_time : '') + ' ' : '';
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
      if (e.kind !== 'off' || (e.tag || '').indexOf('半休') >= 0) return;
      var m = idx[e.owner_id] || (idx[e.owner_id] = {});
      for (var d = parse(e.start), end = parse(e.end), n = 0; d <= end && n < 120; d = addDays(d, 1), n++) m[ymd(d)] = true;
    });
    S.leaveIdx = idx;
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
    segs.forEach(function (g) { g.contL = g.ev.start < ymd(days[g.s]); g.contR = g.ev.end > ymd(days[g.e]); });
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
    var bar = el('div', { role: 'button', tabindex: '0', class: 'bar ' + e.kind + (e.recurring ? ' rec' : '') + (e.important ? ' imp' : '') + (FAMILY && S.updIds && S.updIds[e.id] ? ' upd' : '') + (g.contL ? ' cl' : '') + (g.contR ? ' cr' : ''),
      style: 'grid-column:' + (g.s + 1) + ' / ' + (g.e + 2) + ';grid-row:' + (g.lane + 2),
      text: (g.contL ? '… ' : '') + eventLabel(e, !g.contL), title: eventLabel(e, true) + (e.note ? '\n' + e.note : ''),
      draggable: e.editable ? 'true' : null,
      onclick: function (ev) { ev.stopPropagation(); openEventDialog(e); },
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

  /* リスト表示: ToDoの管理 + 今月の予定を日ごとに */
  function plainBar(e, ds) {
    var bar = el('div', { role: 'button', tabindex: '0', draggable: !SHARE && e.editable ? 'true' : null, class: 'bar plain ' + e.kind + (e.recurring ? ' rec' : '') + (e.important ? ' imp' : '') + (FAMILY && S.updIds && S.updIds[e.id] ? ' upd' : ''),
      text: (e.start === ds ? '' : '… ') + eventLabel(e, e.start === ds), title: eventLabel(e, true) + (e.note ? '\n' + e.note : ''),
      onclick: function () { openEventDialog(e); }, onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEventDialog(e); } } });
    if (!SHARE && e.editable) { // リストの予定を、ToDoの列へ・別の日の行へドラッグできる
      bar.addEventListener('dragstart', function (ev) { startDrag(ev, { t: 'event', id: e.id, off: Math.max(0, daysBetween(e.start, ds)), ok: canReturnToTodo(e) }); });
      bar.addEventListener('dragend', endDrag);
    }
    return bar;
  }
  function renderListView(board, keepFrom) {
    if (!SHARE) {
      var mgr = el('section', { id: 'todo-mgr', class: 'todo todo-mgr', 'aria-label': 'ToDoの管理' });
      board.appendChild(mgr);
      renderTodoInto(mgr, true, keepFrom);
    }
    var todayStr = ymd(new Date());
    // プライベート版のリストは、基本、自分の予定（プライベート・休み）だけにする。業務の予定は、必要なときだけ表示する
    var hideWork = S.view === 'me' && !SHARE && !S.listWork;
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
    if (S.view === 'me' && !SHARE) {
      board.appendChild(el('label', { class: 'check list-opt' },
        el('input', { type: 'checkbox', id: 'list-work', checked: !!S.listWork, style: 'width:auto', onchange: function () { S.listWork = this.checked; store('sched.listWork', S.listWork); renderBoard(); } }),
        '業務の予定も表示する（初期設定は、非表示）'));
    }
    board.appendChild(list);
  }

  function renderBoard() {
    var board = document.getElementById('board');
    if (!board) return;
    var mgrKeep = captureTodoInput(document.getElementById('todo-mgr')); // リスト表示のToDo入力欄は、描き直すと作り直されるので、入力中の内容を引き継ぐ
    board.textContent = '';
    var ub = updatesBanner();
    if (ub) board.appendChild(ub);
    var lay = document.querySelector('.layout');
    if (lay) lay.classList.toggle('list-mode', S.mode === 'list');
    if (S.mode === 'list') { renderListView(board, mgrKeep); return; }
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
    board.appendChild(el('div', { class: 'cal-wrap' }, el('div', { class: 'cal' }, head, weeks)));
    board.appendChild(el('div', { class: 'legend', style: 'margin-top:8px' },
      el('span', null, el('i', { style: 'background:var(--uc-work, var(--work))' }), '業務'),
      el('span', null, el('i', { style: 'background:var(--uc-off, var(--off))' }), '休み'),
      S.view === 'me' || (SHARE && SHARE.kind === 'family') ? el('span', null, el('i', { style: 'background:var(--uc-private, var(--private))' }), 'プライベート') : null,
      el('span', null, el('span', { class: 'rec-sample', text: '↻ 繰り返しの業務' }), '／単発の業務（文字の色で区別・色は右上のメニューの「予定の色の設定」で変更）'),
      el('span', { text: '期間のある業務は、土日祝を除いて1本にまとめて表示' }),
      SHARE ? null : el('span', { text: '予定はドラッグで別の日へ動かせます・画面の右端へ持っていくとToDoにできます' }),
      el('span', { text: 'ショートカット: ? で一覧' }),
      POLL_MS ? el('span', { text: '他の人の更新は、約' + Math.round(POLL_MS / 1000) + '秒以内に自動で反映されます' }) : null));
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
    var L = Math.max(pack.lanes, 3);
    var week = el('div', { class: 'week', role: 'row', style: 'grid-template-rows:24px repeat(' + L + ',22px) minmax(6px,1fr)' });
    days.forEach(function (d, c) {
      var s = ymd(d), hol = S.holidays[s];
      var cls = 'cell' + (d.getMonth() + 1 !== S.month ? ' other' : '') + (d.getDay() === 0 ? ' sun' : '') + (d.getDay() === 6 ? ' sat' : '') + (hol ? ' hol' : '') + (s === todayStr ? ' today' : '');
      week.appendChild(el('div', { class: cls, role: 'gridcell', 'data-col': String(c), 'data-date': s,
        style: 'grid-column:' + (c + 1) + ';grid-row:1 / ' + (L + 3), onclick: SHARE ? null : function () { openEventDialog(null, s); } },
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
    ['cal-edge', 'cal-drop', 'todo-edge', 'todo-drop'].forEach(function (id) { var x = document.getElementById(id); if (x) x.remove(); });
  }

  /* ---------- カレンダーの予定を、画面の右端へ持っていくと、ToDoの列（未着手・進行中）に落とせる ---------- */
  function setupTodoEdge() {
    if (document.getElementById('todo-edge')) return;
    var edge = el('div', { id: 'todo-edge', class: 'cal-edge todo-edge', text: 'ToDoへ ▶' });
    edge.addEventListener('dragover', function (ev) { ev.preventDefault(); openTodoDrop(); });
    document.body.appendChild(edge);
    calEdgeFn = function (ev) { if (ev.clientX >= window.innerWidth - 56) openTodoDrop(); };
    document.addEventListener('dragover', calEdgeFn);
  }
  function openTodoDrop() {
    clearTimeout(calCloseTimer);
    if (document.getElementById('todo-drop')) return;
    var panel = el('div', { id: 'todo-drop', class: 'cal-drop', role: 'dialog', 'aria-label': 'ToDoにする' });
    panel.appendChild(el('p', { class: 'cd-hint', text: 'ToDoにする列へドロップしてください' }));
    [['todo', '未着手'], ['doing', '進行中']].forEach(function (c) {
      var items = S.todos.filter(function (t) { return t.status === c[0]; });
      var zone = el('div', { class: 'td-zone ' + c[0], 'data-status': c[0] }, el('h3', null, c[1], el('span', { class: 'cnt', text: String(items.length) })),
        items.slice(0, 6).map(function (t) { return el('div', { class: 'td-item ' + t.kind, text: t.title }); }),
        items.length > 6 ? el('div', { class: 'td-more', text: '…ほか ' + (items.length - 6) + '件' }) : null,
        el('div', { class: 'td-drop', text: 'ここにドロップ' }));
      zone.addEventListener('dragover', function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; zone.classList.add('drop'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('drop'); });
      zone.addEventListener('drop', function (ev) {
        ev.preventDefault();
        var p = S.drag; endDrag();
        if (p && p.t === 'event' && p.ok) eventToKanban(p.id, c[0], null, false);
      });
      panel.appendChild(zone);
    });
    panel.addEventListener('dragleave', function (ev) {
      if (panel.contains(ev.relatedTarget)) return;
      clearTimeout(calCloseTimer);
      calCloseTimer = setTimeout(function () { var x = document.getElementById('todo-drop'); if (x) x.remove(); }, 400);
    });
    panel.addEventListener('dragenter', function () { clearTimeout(calCloseTimer); });
    panel.addEventListener('dragover', function (ev) { ev.preventDefault(); clearTimeout(calCloseTimer); });
    document.body.appendChild(panel);
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
        toast('予定に追加しました: ' + mdw(date)); loadTodos(); load();
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
      hint.textContent = k === 'private' ? 'プライベートの予定は、本人以外の誰にも（管理者にも）表示されません。' :
        k === 'off' ? '休みは全員に表示され、Slackにも通知されます。' : '業務の予定は全員に表示されます。';
      if (k === 'off' && !title.value) title.setAttribute('placeholder', '休み（空のままで可）');
      else if (title.value || !(ev && ev.kind === 'off')) title.removeAttribute('placeholder');
    }

    function syncFam() {
      var k = curKind();
      famLabel.hidden = famOwnerOnly;
      famText.textContent = k === 'private' ? '家族に共有する（共有リンクで見える）' : '家族にも共有する（家族用の共有リンクで見える。メモ欄の内容も見えます）';
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
      var kindChanged = !!ev && ev.kind !== body.kind;
      if (kindChanged && ev.kind === 'private' && !window.confirm('プライベートの予定を「' + KIND_NAME[body.kind] + '」に変えます。会社の全員に表示されます（メモの内容も）。' + (body.kind === 'off' && S.me.slack ? 'Slackにも、休みの登録が通知されます。' : '') + 'よろしいですか？')) return;
      api('event_save', { body: body }).then(function () {
        ov.close(); toast(kindChanged ? '種類を「' + KIND_NAME[body.kind] + '」に変えて、保存しました' : isNew ? '予定を登録しました' : '予定を更新しました');
        if ((isNew || kindChanged) && body.kind === 'private' && S.view === 'team') toast('プライベートの予定は「プライベート版」に表示されます');
        load();
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    };
    var del = ev ? el('button', { class: 'btn danger left', type: 'button', text: '削除', onclick: function () {
      var msg = ev.recurring ? 'この回だけを削除します（毎月の繰り返し自体は残ります）。よろしいですか？' : 'この予定を削除します。よろしいですか？';
      if (!window.confirm(msg)) return;
      api('event_delete', { body: { id: ev.id } }).then(function () { ov.close(); toast('削除しました'); load(); }).catch(fail);
    } }) : null;

    var form = el('form', { class: 'form', onsubmit: save },
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '種類' }, radios),
      !(isNew || isOwner) ? el('p', { class: 'hint', style: 'margin:-6px 0 0', text: '種類を変えられるのは、予定の持ち主だけです。' }) : null,
      el('label', null, '件名', title),
      el('div', { class: 'row' }, tagLabel, ownerLabel),
      el('div', { class: 'row' }, el('label', null, '開始日', start), el('label', null, '終了日', end)),
      el('div', { class: 'row' }, el('label', null, '開始時刻（任意）', st), el('label', null, '終了時刻（任意）', et)),
      el('label', { class: 'check imp-opt' }, impCb, '★ 重要な予定にする（カレンダーで目立たせる）'),
      el('label', null, 'メモ（任意）', note),
      famLabel,
      famNote,
      hint,
      repeatHint,
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
    return api('todo_list', { params: { view: S.view } }).then(function (j) { S.todos = j.todos; S.done = j.done || []; S.revTd = j.rev; renderTodo(); }).catch(fail);
  }

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
    var side = document.getElementById('todo');
    if (side) renderTodoInto(side, false);
    var mgr = document.getElementById('todo-mgr');
    if (mgr) renderTodoInto(mgr, true);
  }

  function setMode(m) { S.mode = m; store('sched.mode', m); renderToolbar(); renderBoard(); }

  /* 自動更新などで描き直しても、入力中の文字・選んでいる種類・カーソルを失わないよう、描き直す前に控える */
  function captureTodoInput(box) {
    var i = box && box.querySelector('.todo-add input[type=text]'), sel = box && box.querySelector('.todo-add select');
    return i ? { v: i.value, focus: document.activeElement === i, s: i.selectionStart, e: i.selectionEnd, k: sel ? sel.value : null } : null;
  }

  function renderTodoInto(box, full, keepFrom) {
    var keep = keepFrom || captureTodoInput(box);
    box.textContent = '';
    var input = el('input', { type: 'text', maxlength: '100', placeholder: 'やることを入力して Enter', 'aria-label': 'ToDoの内容' });
    var kindSel = S.view === 'me' ? el('select', { 'aria-label': 'ToDoの種類' }, el('option', { value: 'private', text: 'プライベート' }), el('option', { value: 'work', text: '業務' })) : null;
    if (keep) {
      input.value = keep.v;
      if (kindSel && keep.k) kindSel.value = keep.k;
    }
    var form = el('form', { class: 'todo-add', onsubmit: function (e) {
      e.preventDefault();
      if (!input.value.trim()) return;
      api('todo_save', { body: { title: input.value, kind: kindSel ? kindSel.value : 'work' } }).then(function () { input.value = ''; loadTodos(); }).catch(fail);
    } }, input, kindSel, el('button', { class: 'btn primary small', type: 'submit', text: '追加' }));

    var list = el('div', { class: 'todo-list' });
    S.todos.forEach(function (t) { list.appendChild(todoItem(t)); });
    if (!S.todos.length) list.appendChild(el('p', { class: 'todo-empty', text: '未完了のToDoはありません。上の欄に入力して追加できます。' }));

    box.appendChild(el('h2', { text: 'ToDo' + (S.todos.length ? '（' + S.todos.length + '）' : '') }));
    if (keep && keep.focus) setTimeout(function () { input.focus(); try { input.setSelectionRange(keep.s, keep.e); } catch (e) { /* 何もしない */ } }, 0);
    if (full) {
      box.appendChild(el('p', { class: 'hint', text: (S.view === 'team' ? '業務のToDoです（あなただけに見えます）。' : 'あなただけに見えるToDoです。') + 'カードをドラッグして、列（未着手・進行中・完了）を移せます。カードを画面の右端まで持っていくと、カレンダーが開いて、日付に落として予定にできます（下の「今月の予定」の日の行に落としても、その日の予定になります）。下の予定をこの列へドラッグすると、ToDoに戻せます。スマホでは、カードのボタン（列の移動・「日付」）を使います。' }));
      box.appendChild(form);
      box.appendChild(renderKanban());
    } else {
      box.appendChild(el('p', { class: 'hint', text: S.view === 'team' ? '業務のToDoです（あなただけに見えます）。左のチェックで完了にすると、リストから消えて「完了」に移ります。' : 'あなただけに見えるToDoです。左のチェックで完了にすると、リストから消えて「完了」に移ります。' }));
      box.appendChild(form);
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
      loadTodos();
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
    acts.push(el('button', { class: 'btn small ghost', type: 'button', text: '削除', onclick: function (e) {
      e.stopPropagation();
      if (!window.confirm('このToDoを削除します。よろしいですか？')) return;
      api('todo_delete', { body: { id: t.id } }).then(loadTodos).catch(fail);
    } }));
    var card = el('div', { class: 'todo-item kb-card ' + t.kind + (status === 'done' ? ' done' : ''), draggable: 'true', 'data-id': String(t.id) },
      el('div', { class: 't-body' },
        el('div', { class: 't-title', text: t.title }),
        el('div', { class: 't-main' },
          t.kind === 'private' ? el('span', { class: 'pill private', text: 'プライベート' }) : (t.tag ? el('span', { class: 'pill', text: t.tag }) : null),
          status === 'done' && t.done_at ? el('span', { class: 'pill', text: mdw(t.done_at.slice(0, 10)).replace(/（.*）/, '') + ' 完了' }) : null),
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

  function renderKanban() {
    var tab = store('sched.kbTab');
    if (tab !== 'todo' && tab !== 'doing' && tab !== 'done') tab = 'doing';
    var wrap = el('div', { class: 'kanban', 'data-tab': tab });
    // スマホ幅では、列を並べず、状態をタブで切り替える（幅が広いときは隠れる）
    var tabs = el('div', { class: 'kb-tabs', role: 'tablist', 'aria-label': 'ToDoの状態' });
    KANBAN.forEach(function (c) {
      var n = c[0] === 'done' ? S.done.length : S.todos.filter(function (t) { return t.status === c[0]; }).length;
      tabs.appendChild(el('button', { type: 'button', role: 'tab', class: 'kb-tab ' + c[0], 'aria-selected': c[0] === tab ? 'true' : 'false',
        text: c[1] + ' ' + n, onclick: function () {
          store('sched.kbTab', c[0]); wrap.setAttribute('data-tab', c[0]);
          tabs.querySelectorAll('.kb-tab').forEach(function (b) { b.setAttribute('aria-selected', b === this ? 'true' : 'false'); }, this);
        } }));
    });
    wrap.appendChild(tabs);
    KANBAN.forEach(function (c) {
      var status = c[0], items = status === 'done' ? S.done : S.todos.filter(function (t) { return t.status === status; });
      var col = el('div', { class: 'kb-col ' + status, 'data-status': status },
        el('h3', null, c[1], el('span', { class: 'cnt', text: String(items.length) })));
      items.forEach(function (t) { col.appendChild(kanbanCard(t, status)); });
      if (!items.length) col.appendChild(el('p', { class: 'todo-empty', text: status === 'done' ? 'ここに移すと完了になります。' : status === 'doing' ? 'ここへドラッグすると進行中になります。' : 'ToDoはありません。上の欄から追加できます。' }));
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
          if (!window.confirm('このToDoを削除します。よろしいですか？')) return;
          api('todo_delete', { body: { id: t.id } }).then(loadTodos).catch(fail);
        } }))));
  }

  function todoItem(t) {
    var btn = function (label, title, fn) { return el('button', { class: 'btn small ghost', type: 'button', text: label, title: title, onclick: function (e) { e.stopPropagation(); fn(); } }); };
    var item = el('div', { class: 'todo-item ' + t.kind, draggable: 'true', 'data-id': String(t.id) },
      el('input', { type: 'checkbox', class: 't-check', 'aria-label': '完了にする', title: '完了にする（リストから消えて、「完了」に移ります）', onchange: function () { setDone(t, true); } }),
      el('div', { class: 't-body' },
        el('div', { class: 't-main' }, el('span', { class: 't-title', text: t.title }),
          t.status === 'doing' ? el('span', { class: 'pill doing', text: '進行中' }) : null,
          t.kind === 'private' ? el('span', { class: 'pill private', text: 'プライベート' }) : (t.tag ? el('span', { class: 'pill', text: t.tag }) : null)),
        el('div', { class: 't-actions' },
          btn('日付', '日付を選んで予定にする', function () { openTodoScheduleDialog(t); }),
          btn('編集', 'ToDoを編集', function () { openTodoDialog(t); }),
          btn('削除', 'ToDoを削除', function () {
            if (!window.confirm('このToDoを削除します。よろしいですか？')) return;
            api('todo_delete', { body: { id: t.id } }).then(loadTodos).catch(fail);
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
      api('todo_save', { body: { id: t.id, title: title.value, kind: kindNow(), tag: tag.value, note: note.value, family_shared: famCb.checked } })
        .then(function () { ov.close(); toast('ToDoを更新しました'); loadTodos(); }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '種類' }, radios), el('label', null, '内容', title), tagLabel, el('label', null, 'メモ（任意）', note), famLabel, err,
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
        ov.close(); toast('予定に追加しました: ' + mdw(date.value)); loadTodos(); load();
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('div', { class: 'notice' }, el('b', { text: t.title }), el('p', { text: t.kind === 'private' ? 'プライベートの予定になります（本人以外には見えません）。' : '業務の予定になり、会社の全員に表示されます。' })),
      el('label', null, '日付', date), err,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '予定にする' })));
    var ov = openModal('日付を選んで予定にする', form);
  }

  /* ---------- メモ（日報用） ----------
   * 書式は「改行」と「取り消し線」だけ。コピーすると、書式つき(HTML)と文字だけ(text)の両方がクリップボードに入る。
   * メールなど書式を受け付ける貼り付け先では取り消し線がそのまま残り、書式を受け付けない所でも、
   * 取り消し線の文字には「線の結合文字(U+0336)」が付くので、線が消えない。 */
  var memoEditor = null, memoTimer = null, memoStatusEl = null;
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

  /* 編集欄の中身を、行ごとの [{t:文字, s:取り消し線か}] にする */
  function memoLines(root) {
    var lines = [], cur = [];
    function flush() { lines.push(cur); cur = []; }
    function walk(n, strike) {
      if (n.nodeType === 3) { if (n.nodeValue) cur.push({ t: n.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' '), s: strike }); return; }
      if (n.nodeType !== 1) return;
      var tag = n.nodeName.toUpperCase();
      if (tag === 'BR') { flush(); return; }
      var blk = BLOCK_TAGS.test(tag);
      if (blk && cur.length) flush();
      var st = strike || !!STRIKE_TAGS[tag] || /line-through/.test((n.getAttribute('style') || '').toLowerCase());
      Array.prototype.forEach.call(n.childNodes, function (c) { walk(c, st); });
      if (blk && cur.length) flush();
    }
    Array.prototype.forEach.call(root.childNodes, function (c) { walk(c, false); });
    if (cur.length) flush();
    while (lines.length && !lines[lines.length - 1].length) lines.pop(); // 末尾の空行は捨てる
    return lines;
  }
  function addStrikeChars(t) { return Array.from(t).map(function (ch) { return /\s/.test(ch) ? ch : ch + '̶'; }).join(''); }
  function linesToSaveHtml(lines) {
    return lines.map(function (segs) {
      return '<div>' + (segs.length ? segs.map(function (g) { var t = escHtml(g.t); return g.s ? '<s>' + t + '</s>' : t; }).join('') : '<br>') + '</div>';
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
  function saveMemoNow() {
    if (memoTimer) { clearTimeout(memoTimer); memoTimer = null; }
    if (!memoEditor) return Promise.resolve();
    var html = linesToSaveHtml(memoLines(memoEditor));
    S.memoHtml = html; S.memoLoaded = true;
    return api('memo_save', { body: { html: html } }).then(function (j) { memoSetStatus('保存しました ' + j.saved_at); })
      .catch(function (x) { memoSetStatus('保存できませんでした: ' + x.message); });
  }
  function flushMemo() { if (memoTimer) saveMemoNow(); }
  function memoChanged() {
    S.memoHtml = linesToSaveHtml(memoLines(memoEditor)); S.memoLoaded = true;
    memoSetStatus('編集中…');
    if (memoTimer) clearTimeout(memoTimer);
    memoTimer = setTimeout(saveMemoNow, 900);
  }

  function fillMemo(html) {
    memoEditor.textContent = '';
    memoEditor.appendChild(memoFragmentFromHtml(html));
  }

  /* 取り消し線の切り替え。何も選んでいなければ、カーソルのある行全体に付ける */
  function toggleStrike() {
    memoEditor.focus();
    var sel = window.getSelection();
    if (!sel.rangeCount || !memoEditor.contains(sel.anchorNode)) return;
    if (sel.isCollapsed) {
      var node = sel.anchorNode;
      while (node && node.parentNode !== memoEditor) node = node.parentNode;
      if (!node) return;
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
    var lines = memoLines(memoEditor);
    var plain = linesToPlain(lines);
    if (!plain.trim()) { toast('メモが空です'); return; }
    var html = plainOnly ? null : linesToClipHtml(lines);
    var okMsg = plainOnly ? 'テキストでコピーしました（取り消し線は線の文字で表します）' : 'コピーしました。日報に貼り付けてください（取り消し線も残ります）';
    writeClipboard(html, plain).then(function () { toast(okMsg); }).catch(function () {
      if (fallbackCopy(html, plain)) toast(okMsg); else toast('コピーできませんでした。メモを選択して Ctrl + C を押してください。');
    });
  }

  /* 日報の雛形: 本日と次の営業日の「予定・To Do」を入れる（業務の予定と、業務のToDoだけ） */
  function buildReportLines() {
    var today = new Date(), from = ymd(today), to = ymd(addDays(today, 14));
    return api('events', { params: { from: from, to: to, view: 'team' } }).then(function (j) {
      var me = S.me.user.id, hol = j.holidays;
      var off = function (ds) { var w = parse(ds).getDay(); return w === 0 || w === 6 || !!hol[ds]; };
      var todos = S.todos.filter(function (t) { return t.kind === 'work'; }).map(function (t) { return t.title; });
      // 今日完了した業務のToDoは、取り消し線つきで入れる（終わった業務に線を引く、いつもの形）
      var doneToday = S.done.filter(function (t) { return t.kind === 'work' && t.done_at && t.done_at.slice(0, 10) === from; }).map(function (t) { return { t: t.title, s: true }; });
      var itemsFor = function (ds) {
        var list = [];
        j.events.forEach(function (e) {
          if (e.kind !== 'work' || e.owner_id !== me || e.start > ds || e.end < ds) return;
          if (e.start !== e.end && off(ds)) return; // 期間のある業務は土日祝に出さない（カレンダーと同じ）
          list.push((e.start_time ? e.start_time + ' ' : '') + e.title);
        });
        return list.concat(todos, ds === from ? doneToday : []);
      };
      var next = addDays(today, 1);
      for (var i = 0; i < 14 && off(ymd(next)); i++) next = addDays(next, 1);
      var head = function (d) { return (d.getMonth() + 1) + '/' + d.getDate() + '　予定・To Do'; };
      var L = ['お疲れ様です。', '業務終了しました。', '', '以下、本日の業務報告です。', '', head(today), ''].concat(itemsFor(from), ['', head(next), ''], itemsFor(ymd(next)), ['', '以上となります。']);
      if (today.getDay() === 5) L.push('今週もありがとうございました。');
      L.push('よろしくお願いいたします。');
      return L;
    });
  }

  function renderMemo() {
    var box = document.getElementById('memo');
    if (!box) return;
    box.textContent = '';
    memoStatusEl = el('span', { class: 'memo-status', role: 'status' });
    memoEditor = el('div', { class: 'memo-editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'メモ（日報用）', spellcheck: 'false' });
    var tool = function (label, title, fn, cls) { return el('button', { class: 'btn small ' + (cls || ''), type: 'button', title: title, onmousedown: function (e) { e.preventDefault(); }, onclick: fn }, label); };
    box.appendChild(el('h2', { text: 'メモ（日報用）' }));
    box.appendChild(el('p', { class: 'hint', text: '終わった業務に取り消し線を付けて、そのまま日報に貼り付けられます。自動で保存されます。' }));
    box.appendChild(el('div', { class: 'memo-bar' },
      tool(el('s', { text: '取り消し線' }), '選んだ文字に取り消し線（何も選ばなければ、その行全体）。Ctrl + Shift + X', toggleStrike),
      tool('日報の雛形', '本日と次の営業日の予定・ToDoを入れた日報の下書きを作る', function () {
        if (memoLines(memoEditor).length && !window.confirm('いまのメモを、日報の雛形で置き換えます。よろしいですか？')) return;
        buildReportLines().then(function (L) {
          fillMemo(linesToSaveHtml(L.map(function (t) { return t === '' ? [] : typeof t === 'string' ? [{ t: t, s: false }] : [{ t: t.t, s: true }]; }))); memoChanged();
        }).catch(fail);
      }),
      tool('クリア', 'メモを空にする', function () {
        if (!memoLines(memoEditor).length || !window.confirm('メモを空にします。よろしいですか？')) return;
        memoEditor.textContent = ''; memoChanged();
      }, 'ghost')));
    box.appendChild(el('div', { class: 'memo-bar' },
      tool('日報にコピー', '書式つきでコピー（メールなどに貼ると、取り消し線が残る）', function () { copyMemo(false); }, 'primary'),
      tool('テキストでコピー', '文字だけでコピー（取り消し線は線の文字で表す）', function () { copyMemo(true); })));
    box.appendChild(memoEditor);
    box.appendChild(memoStatusEl);

    memoEditor.addEventListener('input', memoChanged);
    memoEditor.addEventListener('blur', function () { if (memoTimer) saveMemoNow(); });
    memoEditor.addEventListener('keydown', function (e) { if (e.ctrlKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) { e.preventDefault(); toggleStrike(); } });
    // 貼り付け: 書式つきでも、取り消し線だけを残して他の書式は捨てる。文字だけの貼り付けは、線の結合文字を取り消し線に戻す
    memoEditor.addEventListener('paste', function (e) {
      var cd = e.clipboardData; if (!cd) return;
      e.preventDefault();
      var html = cd.getData('text/html'), tmp = document.createElement('div');
      if (html) {
        tmp.appendChild(memoFragmentFromHtml(html));
      } else {
        cd.getData('text/plain').split(/\r?\n/).forEach(function (line) {
          var d = document.createElement('div');
          if (!line) d.appendChild(document.createElement('br'));
          line.split(/((?:[^̶]̶)+)/).forEach(function (part, i) {
            if (!part) return;
            if (i % 2 === 1) { var sEl = document.createElement('s'); sEl.textContent = part.replace(/̶/g, ''); d.appendChild(sEl); } else d.appendChild(document.createTextNode(part));
          });
          tmp.appendChild(d);
        });
      }
      document.execCommand('insertHTML', false, linesToInlineHtml(memoLines(tmp)));
      memoChanged();
    });
    // Ctrl + C でも、書式つき + 文字だけ の両方をコピーする（選んだ部分の取り消し線を保つ）
    memoEditor.addEventListener('copy', function (e) {
      var sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !e.clipboardData) return;
      var range = sel.getRangeAt(0), tmp = document.createElement('div'), holder = tmp;
      var anc = range.commonAncestorContainer; anc = anc.nodeType === 3 ? anc.parentNode : anc;
      if (anc && anc.closest && memoEditor.contains(anc) && anc.closest('s,strike,del')) { holder = document.createElement('s'); tmp.appendChild(holder); }
      holder.appendChild(range.cloneContents());
      var lines = memoLines(tmp);
      e.clipboardData.setData('text/html', linesToClipHtml(lines));
      e.clipboardData.setData('text/plain', linesToPlain(lines));
      e.preventDefault();
    });

    if (S.memoLoaded) fillMemo(S.memoHtml);
    else api('memo_get').then(function (j) { S.memoHtml = j.html; S.memoLoaded = true; if (!memoEditor.textContent && !memoTimer) fillMemo(j.html); }).catch(fail);
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
      ev.kind === 'off' ? el('p', { class: 'hint', text: '休みを複製すると、Slackにも1通にまとめて通知されます。' }) : null,
      ev.kind === 'private' ? el('p', { class: 'hint', text: 'プライベートの予定のまま複製されます（本人以外には表示されません）。' }) : null,
      err,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '複製する' })));
    var ov = openModal('予定を複製', form);
  }

  function openEventView(ev) {
    var rows = [['種類', ev.kind === 'off' ? '休み' : ev.kind === 'private' ? 'プライベート' : '業務'], ['件名', eventLabel(ev, true)], ['日付', ev.start === ev.end ? mdw(ev.start) : mdw(ev.start) + ' 〜 ' + mdw(ev.end)]];
    if (ev.start_time) rows.push(['時刻', ev.start_time + (ev.end_time ? ' 〜 ' + ev.end_time : '')]);
    if (ev.tag) rows.push(['分類', ev.tag]);
    rows.push(['持ち主', ev.owner_name]);
    if (ev.important) rows.push(['重要', '★ 重要な予定']);
    if (ev.note) rows.push(['メモ', ev.note]);
    var dl = el('dl', { class: 'detail' }, rows.map(function (r) { return [el('dt', { text: r[0] }), el('dd', { text: r[1] })]; }));
    var ov = openModal('予定の詳細', el('div', { class: 'form' }, dl,
      SHARE ? null : el('p', { class: 'hint', text: 'この予定は持ち主と管理者だけが編集できます。' }),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }))));
    ov.outsideClose = true;
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
        el('p', { class: 'hint', style: 'margin:2px 0 6px', text: '予定ごとの「家族に共有」のチェックとは別に、すでに登録してある予定も含めて、まとめて見せられます。チェックを外すと、すぐ見えなくなります。' }),
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
    function refresh() {
      api('share_list').then(function (j) {
        scope = j.family_share || scope; S.me.family_share = scope;
        body.textContent = '';
        body.appendChild(el('div', { class: 'notice' }, el('b', { text: 'このURLを知っている人は、ログインなしで見られます' }),
          el('p', { text: '見せたい人にだけ伝えてください。会社の人が見られる場所に、家族用のURLを載せないでください。URLが他の人に伝わったときは「リンクを作り直す」か「共有を止める」で、すぐに見られなくなります。' })));
        j.links.forEach(function (l) { body.appendChild(card(l)); });
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
            el('div', { class: 'top' }, el('div', null, el('div', { class: 'name', text: s.title }), el('div', { class: 'muted', text: s.label + (s.start_time ? '　' + s.start_time + (s.end_time ? '〜' + s.end_time : '') : '') })),
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
      var b = { id: s ? s.id : null, title: title.value, tag: tag.value, rule_type: typeSel.value, start_time: timeVal(st), end_time: timeVal(et) };
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
        preview.appendChild(el('table', { class: 't' }, el('thead', null, el('tr', null, el('th', { text: '月' }), el('th', { text: '作られる日付' }))),
          el('tbody', null, j.preview.map(function (p) {
            return el('tr', null, el('td', { text: p.ym.replace('-', '年') + '月' }), el('td', { text: p.start ? (p.start === p.end ? mdw(p.start) : mdw(p.start) + ' 〜 ' + mdw(p.end)) : 'この月はなし' }));
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
      el('h4', { style: 'margin:4px 0 0', text: 'この設定で作られる予定（今月から8か月分）' }), preview, err,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: function () { ov.close(); } }), el('button', { class: 'btn primary', type: 'submit', text: '保存' })));
    var ov = openModal(s ? 'ルールを編集' : 'ルールを追加', form, true);
    renderFields();
    showPreview();
  }

  /* ---------- 管理者向け ---------- */
  function openUsersDialog() {
    var body = el('div', { class: 'form' });
    var ov = openModal('社員の管理', body, true);
    function refresh() {
      api('users_list').then(function (j) {
        body.textContent = '';
        body.appendChild(el('div', { class: 'scroll-x' }, el('table', { class: 't stack' },
          el('thead', null, el('tr', null, ['名前', 'メールアドレス', '権限', 'Slack ID', ''].map(function (h) { return el('th', { text: h }); }))),
          el('tbody', null, j.users.map(function (u) {
            return el('tr', null, el('td', { text: u.name + (u.active ? '' : '（停止中）') + (u.must_change_password ? '（初回パスワード未変更）' : '') }), el('td', { text: u.email }),
              el('td', null, el('span', { class: 'pill' + (u.role === 'admin' ? ' admin' : ''), text: u.role === 'admin' ? '管理者' : '一般' })),
              el('td', { text: u.slack_id || '—' }),
              el('td', null, el('button', { class: 'btn small', type: 'button', text: '編集', onclick: function () { openUserForm(u, refresh); } })));
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
      slack: el('input', { name: 'slack_id', placeholder: '例: U01ABCDEF23（任意）', value: u ? u.slack_id : '' }),
      pw: el('input', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: !u }),
      active: el('input', { type: 'checkbox', checked: u ? !!u.active : true, style: 'width:auto' })
    };
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('user_save', { body: { id: u ? u.id : null, name: f.name.value, email: f.email.value, role: f.role.value, slack_id: f.slack.value, password: f.pw.value, active: f.active.checked ? 1 : 0 } })
        .then(function () { ov.close(); toast('保存しました'); done(); }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('div', { class: 'row' }, el('label', null, '名前', f.name), el('label', null, 'メールアドレス（ログインID）', f.email)),
      el('div', { class: 'row' }, el('label', null, '権限', f.role), el('label', null, 'SlackのメンバーID', f.slack)),
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
    applyColors(me.prefs && me.prefs.colors);
    csrf = me.csrf;
    var now = new Date();
    S.year = now.getFullYear(); S.month = now.getMonth() + 1;
    var f = store('sched.filters');
    S.tags = f && Array.isArray(f.tags) ? f.tags.filter(function (t) { return me.work_tags.indexOf(t) >= 0; }) : me.work_tags.filter(function (t) { return t !== '個人作業'; });
    S.showOff = f && typeof f.showOff === 'boolean' ? f.showOff : true;
    S.view = store('sched.view') === 'me' ? 'me' : 'team';
    S.mode = store('sched.mode') === 'list' ? 'list' : 'cal';
    S.listWork = store('sched.listWork') === true;
    S.who = store('sched.who') || 'all';
    var start = function () { renderShell(); load(); startAutoRefresh(); };
    if (me.user.must_change_password) {
      root.textContent = '';
      openPasswordDialog(true, start); // 変更が終わるまで予定の画面は出さない
    } else {
      start();
    }
  }).catch(function (e) { if (e.message !== 'login') root.textContent = 'うまく読み込めませんでした: ' + e.message; });
})();
