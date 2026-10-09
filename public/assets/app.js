// スケジュール管理アプリの画面。外部ライブラリは使いません。
(function () {
  'use strict';

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
    me: null, view: 'team', year: 0, month: 0, todos: [], drag: null,
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
    return fetch('api.php?action=' + action + qs, init).then(function (r) {
      if (r.status === 401) { location.href = 'login.php'; throw new Error('login'); }
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'エラーが発生しました'); return j; });
    });
  }
  function toast(msg) {
    var t = el('div', { class: 'toast', role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2800);
  }
  function fail(e) { if (e.message !== 'login') toast(e.message); }

  /* ---------- モーダル ---------- */
  var modals = [];
  function openModal(title, body, wide, locked) {
    var ov = el('div', { class: 'overlay' });
    ov.locked = !!locked; // true の間は ✕・Esc・外側クリックで閉じられない
    var close = function () { ov.remove(); modals = modals.filter(function (m) { return m !== ov; }); };
    var box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('h3', null, el('span', { text: title }), locked ? null : el('button', { class: 'btn small ghost', type: 'button', 'aria-label': '閉じる', onclick: close, text: '✕' })),
      body);
    ov.appendChild(box);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov && !ov.locked) close(); });
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

  /* ---------- 画面の骨組み ---------- */
  function renderShell() {
    root.textContent = '';
    var menuList = null;
    var menuBtn = el('button', { class: 'btn small', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: S.me.user.name + ' ▾' });
    var items = [
      el('button', { type: 'button', text: '繰り返し業務の設定', onclick: function () { closeMenu(); openSeriesDialog(); } })
    ];
    if (S.me.user.role === 'admin') {
      items.push(el('button', { type: 'button', text: '社員の管理', onclick: function () { closeMenu(); openUsersDialog(); } }));
      items.push(el('button', { type: 'button', text: '会社の休業日', onclick: function () { closeMenu(); openHolidaysDialog(); } }));
      items.push(el('button', { type: 'button', text: 'システム更新', onclick: function () { location.href = 'update.php'; } }));
    }
    items.push(el('hr'));
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
          text: v === 'team' ? '業務版' : 'プライベート版', onclick: function () { S.view = v; store('sched.view', v); renderShell(); load(); } });
      }));

    root.appendChild(el('header', { class: 'topbar' }, el('div', { class: 'topbar-in' },
      el('span', { class: 'brand', text: S.me.app_name }), tabs, el('span', { class: 'spacer' }),
      el('div', { class: 'menu' }, menuBtn))));
    root.appendChild(el('main', null, el('div', { id: 'toolbar' }), el('div', { id: 'filters' }),
      el('div', { class: 'layout' }, el('div', { id: 'board', class: 'board' }), el('aside', { id: 'todo', class: 'todo', 'aria-label': 'ToDoリスト' }))));
    renderToolbar();
    renderFilters();
    loadTodos();
  }

  function renderToolbar() {
    var tb = document.getElementById('toolbar');
    tb.textContent = '';
    var nav = function (delta) { var d = new Date(S.year, S.month - 1 + delta, 1); S.year = d.getFullYear(); S.month = d.getMonth() + 1; renderToolbar(); load(); };
    tb.appendChild(el('div', { class: 'toolbar' },
      el('button', { class: 'btn', type: 'button', 'aria-label': '前の月', text: '‹', onclick: function () { nav(-1); } }),
      el('h2', { text: S.year + '年' + S.month + '月' }),
      el('button', { class: 'btn', type: 'button', 'aria-label': '次の月', text: '›', onclick: function () { nav(1); } }),
      el('button', { class: 'btn', type: 'button', text: '今日', onclick: function () { var n = new Date(); S.year = n.getFullYear(); S.month = n.getMonth() + 1; renderToolbar(); load(); } }),
      el('span', { class: 'spacer', style: 'flex:1' }),
      el('button', { class: 'btn primary', type: 'button', text: '＋ 予定を追加', onclick: function () { openEventDialog(null, ymd(new Date())); } })
    ));
    tb.appendChild(el('div', { class: 'view-banner ' + S.view, style: 'margin-top:8px',
      text: S.view === 'team' ? '業務版: 会社の全員に共有される予定だけを表示しています（プライベートの予定は含まれません）' : 'プライベート版: 自分のプライベート予定と、選んだ業務の予定を重ねて表示しています' }));
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
    if (S.view === 'me') { params.tags = S.tags.join(','); params.off = S.showOff ? '1' : '0'; }
    S.loading = true;
    api('events', { params: params }).then(function (j) {
      S.events = j.events; S.holidays = j.holidays; S.loading = false; renderBoard();
    }).catch(fail);
  }

  function eventLabel(e, first) {
    var t;
    if (e.kind === 'off') {
      t = e.owner_name + ' ' + (e.tag || '休み');
      if (e.title && e.title !== '休み') t += '（' + e.title + '）';
    } else t = e.title;
    var time = first && e.start_time ? e.start_time + (e.end_time ? '-' + e.end_time : '') + ' ' : '';
    return (e.recurring ? '↻ ' : '') + time + t;
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
  function shownOn(e, ds) {
    if (e.start > ds || e.end < ds) return false;
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
    var bar = el('div', { role: 'button', tabindex: '0', class: 'bar ' + e.kind + (g.contL ? ' cl' : '') + (g.contR ? ' cr' : ''),
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

  function renderBoard() {
    var board = document.getElementById('board');
    if (!board) return;
    board.textContent = '';
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
      el('span', null, el('i', { style: 'background:var(--work)' }), '業務'),
      el('span', null, el('i', { style: 'background:var(--off)' }), '休み'),
      S.view === 'me' ? el('span', null, el('i', { style: 'background:var(--private)' }), 'プライベート') : null,
      el('span', { text: '↻ 毎月の繰り返し' }),
      el('span', { text: '期間のある業務は、土日祝を除いて1本にまとめて表示' }),
      el('span', { text: '予定はドラッグで別の日へ動かせます' })));
  }

  function renderWeek(days, todayStr) {
    var pack = weekSegments(days);
    var L = Math.max(pack.lanes, 3);
    var week = el('div', { class: 'week', role: 'row', style: 'grid-template-rows:24px repeat(' + L + ',22px) minmax(6px,1fr)' });
    days.forEach(function (d, c) {
      var s = ymd(d), hol = S.holidays[s];
      var cls = 'cell' + (d.getMonth() + 1 !== S.month ? ' other' : '') + (d.getDay() === 0 ? ' sun' : '') + (d.getDay() === 6 ? ' sat' : '') + (hol ? ' hol' : '') + (s === todayStr ? ' today' : '');
      week.appendChild(el('div', { class: cls, role: 'gridcell', 'data-col': String(c), 'data-date': s,
        style: 'grid-column:' + (c + 1) + ';grid-row:1 / ' + (L + 3), onclick: function () { openEventDialog(null, s); } },
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
  }
  function endDrag() {
    S.drag = null;
    document.body.classList.remove('is-dragging', 'drag-event', 'drag-ok');
    document.querySelectorAll('.drop, .ins-before, .ins-after').forEach(function (x) { x.classList.remove('drop', 'ins-before', 'ins-after'); });
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
    if (ev && !ev.editable) return openEventView(ev);
    var isNew = !ev;
    var kind = ev ? ev.kind : (S.view === 'me' ? 'private' : 'work');
    var kinds = [['work', '業務'], ['off', '休み']];
    if (S.view === 'me' || (ev && ev.kind === 'private')) kinds.push(['private', 'プライベート']);

    var radios = kinds.map(function (k) {
      return el('label', { class: k[0] }, el('input', { type: 'radio', name: 'kind', value: k[0], checked: k[0] === kind, disabled: !isNew, onchange: syncKind }), k[1]);
    });
    var title = el('input', { name: 'title', maxlength: '100', value: ev ? ev.title : '' });
    var tag = el('select', { name: 'tag' });
    var tagLabel = el('label', null, '分類', tag);
    var owner = el('select', { name: 'owner_id' }, S.me.users.map(function (u) { return el('option', { value: String(u.id), text: u.name, selected: u.id === S.me.user.id }); }));
    var ownerLabel = el('label', null, '休みを取る人', owner);
    var start = el('input', { type: 'date', name: 'start', required: true, value: ev ? ev.start : dateStr });
    var end = el('input', { type: 'date', name: 'end', value: ev ? ev.end : dateStr });
    start.addEventListener('change', function () { if (!end.value || end.value < start.value) end.value = start.value; });
    var st = el('input', { type: 'time', name: 'start_time', value: ev ? ev.start_time : '' });
    var et = el('input', { type: 'time', name: 'end_time', value: ev ? ev.end_time : '' });
    var note = el('textarea', { name: 'note', maxlength: '500' });
    note.value = ev ? ev.note : '';
    var hint = el('p', { class: 'hint' });
    var err = el('p', { class: 'error', role: 'alert', hidden: true });

    function curKind() { var c = form.querySelector('input[name=kind]:checked'); return c ? c.value : kind; }
    function syncKind() {
      var k = curKind();
      var tags = k === 'work' ? S.me.work_tags : k === 'off' ? S.me.off_tags : [];
      var cur = tag.value || (ev ? ev.tag : '');
      tag.textContent = '';
      tags.forEach(function (t) { tag.appendChild(el('option', { value: t, text: t, selected: t === cur })); });
      if (k === 'work' && !cur) tag.value = S.me.work_tags[0];
      tagLabel.hidden = k === 'private';
      ownerLabel.hidden = !(isNew && k === 'off' && S.me.user.role === 'admin');
      hint.textContent = k === 'private' ? 'プライベートの予定は、本人以外の誰にも（管理者にも）表示されません。' :
        k === 'off' ? '休みは全員に表示され、Slackにも通知されます。' : '業務の予定は全員に表示されます。';
      if (k === 'off' && !title.value) title.setAttribute('placeholder', '休み（空のままで可）');
      else title.removeAttribute('placeholder');
    }

    var save = function (e) {
      e.preventDefault();
      err.hidden = true;
      var body = {
        id: ev ? ev.id : null, kind: curKind(), title: title.value, tag: tag.value, start: start.value, end: end.value || start.value,
        start_time: st.value, end_time: et.value, note: note.value
      };
      if (!ownerLabel.hidden) body.owner_id = owner.value;
      api('event_save', { body: body }).then(function () {
        ov.close(); toast(isNew ? '予定を登録しました' : '予定を更新しました');
        if (isNew && body.kind === 'private' && S.view === 'team') toast('プライベートの予定は「プライベート版」に表示されます');
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
      el('label', null, '件名', title),
      el('div', { class: 'row' }, tagLabel, ownerLabel),
      el('div', { class: 'row' }, el('label', null, '開始日', start), el('label', null, '終了日', end)),
      el('div', { class: 'row' }, el('label', null, '開始時刻（任意）', st), el('label', null, '終了時刻（任意）', et)),
      el('label', null, 'メモ（任意）', note),
      hint,
      ev && ev.recurring ? el('p', { class: 'hint', text: '↻ 毎月の繰り返しから作られた予定です。この回を編集すると、以後ルールを変更してもこの回は変わりません。' }) : null,
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
    return api('todo_list', { params: { view: S.view } }).then(function (j) { S.todos = j.todos; renderTodo(); }).catch(fail);
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

  function renderTodo() {
    var box = document.getElementById('todo');
    if (!box) return;
    box.textContent = '';
    var input = el('input', { type: 'text', maxlength: '100', placeholder: 'やることを入力して Enter', 'aria-label': 'ToDoの内容' });
    var kindSel = S.view === 'me' ? el('select', { 'aria-label': 'ToDoの種類' }, el('option', { value: 'private', text: 'プライベート' }), el('option', { value: 'work', text: '業務' })) : null;
    var form = el('form', { class: 'todo-add', onsubmit: function (e) {
      e.preventDefault();
      if (!input.value.trim()) return;
      api('todo_save', { body: { title: input.value, kind: kindSel ? kindSel.value : 'work' } }).then(function () { input.value = ''; loadTodos(); }).catch(fail);
    } }, input, kindSel, el('button', { class: 'btn primary small', type: 'submit', text: '追加' }));

    var list = el('div', { class: 'todo-list' });
    S.todos.forEach(function (t) { list.appendChild(todoItem(t)); });
    if (!S.todos.length) list.appendChild(el('p', { class: 'todo-empty', text: 'ToDoはありません。上の欄に入力して追加できます。' }));

    box.appendChild(el('h2', { text: 'ToDo' }));
    box.appendChild(el('p', { class: 'hint', text: S.view === 'team' ? '業務のToDoです（あなただけに見えます）。日付へドラッグすると、会社に共有される予定になります。' : 'あなただけに見えるToDoです。日付へドラッグすると予定になります。' }));
    box.appendChild(form);
    box.appendChild(list);
    box.appendChild(el('p', { class: 'hint todo-foot', text: 'カレンダーの予定をここへドラッグすると、ToDoに戻ります。ToDoは、ドラッグで並べ替えられます。' }));

    // 欄の空いたところへのドロップ（末尾に入る）
    box.ondragover = function (ev) {
      if (!S.drag || !(S.drag.t === 'todo' || (S.drag.t === 'event' && S.drag.ok))) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; box.classList.add('drop');
    };
    box.ondragleave = function (ev) { if (!box.contains(ev.relatedTarget)) box.classList.remove('drop'); };
    box.ondrop = function (ev) {
      if (!S.drag) return;
      ev.preventDefault();
      var p = S.drag; box.classList.remove('drop'); endDrag();
      if (p.t === 'todo') reorderTo(p.id, null, false); else if (p.t === 'event' && p.ok) returnEventToTodo(p.id, null, false);
    };
  }

  function todoItem(t) {
    var btn = function (label, title, fn) { return el('button', { class: 'btn small ghost', type: 'button', text: label, title: title, onclick: function (e) { e.stopPropagation(); fn(); } }); };
    var item = el('div', { class: 'todo-item ' + t.kind, draggable: 'true', 'data-id': String(t.id) },
      el('div', { class: 't-main' }, el('span', { class: 't-title', text: t.title }),
        t.kind === 'private' ? el('span', { class: 'pill private', text: 'プライベート' }) : (t.tag ? el('span', { class: 'pill', text: t.tag }) : null)),
      el('div', { class: 't-actions' },
        btn('日付', '日付を選んで予定にする', function () { openTodoScheduleDialog(t); }),
        btn('編集', 'ToDoを編集', function () { openTodoDialog(t); }),
        btn('削除', 'ToDoを削除', function () {
          if (!window.confirm('このToDoを削除します。よろしいですか？')) return;
          api('todo_delete', { body: { id: t.id } }).then(loadTodos).catch(fail);
        })));
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
    var err = el('p', { class: 'error', role: 'alert', hidden: true });
    function kindNow() { var c = form.querySelector('input[name=tkind]:checked'); return c ? c.value : 'work'; }
    function sync() { tagLabel.hidden = kindNow() === 'private'; }
    var form = el('form', { class: 'form', onsubmit: function (e) {
      e.preventDefault();
      api('todo_save', { body: { id: t.id, title: title.value, kind: kindNow(), tag: tag.value, note: note.value } })
        .then(function () { ov.close(); toast('ToDoを更新しました'); loadTodos(); }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
    } },
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '種類' }, radios), el('label', null, '内容', title), tagLabel, el('label', null, 'メモ（任意）', note), err,
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
    var rows = [['種類', ev.kind === 'off' ? '休み' : '業務'], ['件名', eventLabel(ev, true)], ['日付', ev.start === ev.end ? mdw(ev.start) : mdw(ev.start) + ' 〜 ' + mdw(ev.end)]];
    if (ev.start_time) rows.push(['時刻', ev.start_time + (ev.end_time ? ' 〜 ' + ev.end_time : '')]);
    if (ev.tag) rows.push(['分類', ev.tag]);
    rows.push(['持ち主', ev.owner_name]);
    if (ev.note) rows.push(['メモ', ev.note]);
    var dl = el('dl', { class: 'detail' }, rows.map(function (r) { return [el('dt', { text: r[0] }), el('dd', { text: r[1] })]; }));
    var ov = openModal('予定の詳細', el('div', { class: 'form' }, dl,
      el('p', { class: 'hint', text: 'この予定は持ち主と管理者だけが編集できます。' }),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: function () { ov.close(); } }))));
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

  function openSeriesForm(s, done) {
    var typeSel = el('select', { name: 'rule_type' }, Object.keys(RULE_NAMES).map(function (k) { return el('option', { value: k, text: RULE_NAMES[k], selected: s && s.rule_type === k }); }));
    var title = el('input', { name: 'title', maxlength: '100', required: true, value: s ? s.title : '' });
    var tag = el('select', { name: 'tag' }, S.me.work_tags.map(function (t) { return el('option', { value: t, text: t, selected: s ? s.tag === t : t === '定例業務' }); }));
    var fields = el('div', { class: 'row' });
    var num = function (name, label, val, min, max) { return el('label', null, label, el('input', { type: 'number', name: name, min: String(min), max: String(max), value: val === null || val === undefined ? '' : String(val) })); };
    var st = el('input', { type: 'time', name: 'start_time', value: s ? s.start_time : '' });
    var et = el('input', { type: 'time', name: 'end_time', value: s ? s.end_time : '' });
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
      var b = { id: s ? s.id : null, title: title.value, tag: tag.value, rule_type: typeSel.value, start_time: st.value, end_time: et.value };
      fields.querySelectorAll('input,select').forEach(function (n) { b[n.name] = n.type === 'checkbox' ? n.checked : n.value; });
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
        body.appendChild(el('div', { class: 'scroll-x' }, el('table', { class: 't' },
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
        body.appendChild(el('p', { class: 'hint', text: '国の祝日は自動で判定されます。年末年始などの会社独自の休みをここに追加すると、繰り返し業務の日付計算で「休日」として扱われます。' }));
        var d = el('input', { type: 'date', required: true }), n = el('input', { required: true, maxlength: '60', placeholder: '例: 年末年始休業' });
        body.appendChild(el('form', { class: 'row', onsubmit: function (e) {
          e.preventDefault();
          api('holiday_save', { body: { hdate: d.value, name: n.value } }).then(function () { toast('追加しました'); refresh(); load(); }).catch(fail);
        } }, el('label', null, '日付', d), el('label', null, '名前', n), el('div', { style: 'align-self:end' }, el('button', { class: 'btn primary', type: 'submit', text: '追加' }))));
        body.appendChild(j.holidays.length ? el('table', { class: 't' }, el('tbody', null, j.holidays.map(function (h) {
          return el('tr', null, el('td', { text: mdw(h.hdate) + ' ' + h.hdate.slice(0, 4) }), el('td', { text: h.name }), el('td', null, el('button', { class: 'btn small danger', type: 'button', text: '削除', onclick: function () {
            api('holiday_delete', { body: { id: h.id } }).then(function () { refresh(); load(); }).catch(fail);
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

  /* ---------- 起動 ---------- */
  api('me').then(function (me) {
    S.me = me;
    csrf = me.csrf;
    var now = new Date();
    S.year = now.getFullYear(); S.month = now.getMonth() + 1;
    var f = store('sched.filters');
    S.tags = f && Array.isArray(f.tags) ? f.tags.filter(function (t) { return me.work_tags.indexOf(t) >= 0; }) : me.work_tags.filter(function (t) { return t !== '個人作業'; });
    S.showOff = f && typeof f.showOff === 'boolean' ? f.showOff : true;
    S.view = store('sched.view') === 'me' ? 'me' : 'team';
    var start = function () { renderShell(); load(); };
    if (me.user.must_change_password) {
      root.textContent = '';
      openPasswordDialog(true, start); // 変更が終わるまで予定の画面は出さない
    } else {
      start();
    }
  }).catch(function (e) { if (e.message !== 'login') root.textContent = 'うまく読み込めませんでした: ' + e.message; });
})();
