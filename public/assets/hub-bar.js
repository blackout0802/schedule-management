/*
 * Hub とつながるアプリの「上の帯」（共通の部品。2026-11-25 ユーザーが選んだ案 02・04・06・08・11・13・18）。
 *   上の黒い段: SKYM（Hub のアプリの一覧へ）と、名前と役割の2行（押すとメニュー）。全アプリで同じ。
 *   下の段: アプリの色の小さなポラロイド・アプリ名 ▾（ほかのアプリへ移る）・版・タブ・アプリの道具。その下にアプリの色の線。
 *   名前のメニューの並び: 名前・役割・メール → このアプリ（アプリの設定など）→ Hub（Hub に戻る・自分の設定）→ ログアウト。
 *
 * 元は Hub の public/assets/hub-bar.js（と hub-bar.css）。各アプリには同じものを写して置く（直すときは Hub を直して、全アプリに写す）。
 * 画面の文字は textContent だけで入れる。innerHTML・style 属性は使わない（どのアプリの CSP でも動くように）。
 *
 * 使い方:
 *   var bar = HubBar.create({
 *     appId: 'password', appName: 'パスワード管理', version: '1.20.3',
 *     tabs: [{ id: 'items', label: 'パスワード', title: '…', attrs: { 'data-view': 'x' } }], tab: 'items', onTab: function (id) {},
 *     user: { name: '山田 花子', role: '社員', email: 'a@example.com' },
 *     appItems: [{ label: '設定', onclick: fn }],            // 「このアプリ」に出す（無ければ、まとまりごと出さない）
 *     hubUrl: 'https://…/public/',                       // Hub の URL（無ければ「Hub に戻る」「自分の設定」は出さない）
 *     apps: [{ id: 'schedule', name: 'スケジュール管理', href: '...' }],   // または loadApps: function () { return Promise }
 *     onLogout: fn, tools: [要素],                           // tools は下の段の右に置く（アプリだけの道具）
 *   });
 *   document.body.prepend(bar.el); bar.setTab('items');
 * Hub 自身は isHub: true と onHome・onMySettings を渡す。
 */
(function () {
  'use strict';

  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') e.textContent = v;
        else if (k === 'class') e.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }

  // アプリの絵（Hub の一覧と同じ形）
  var ICONS = {
    calendar: [['rect', { x: '3.5', y: '5', width: '17', height: '15', rx: '2' }], ['path', { d: 'M3.5 9.5h17M8 3v4M16 3v4' }]],
    key: [['circle', { cx: '8', cy: '12', r: '3.8' }], ['path', { d: 'M11.8 12H21M18 12v3M21 12v2.4' }]],
    yen: [['path', { d: 'M6 4l6 8 6-8M12 12v8M7.5 13.5h9M7.5 17h9' }]],
    doc: [['path', { d: 'M6 3h8l4 4v14H6z' }], ['path', { d: 'M14 3v4h4M9 12h6M9 16h6' }]],
    clock: [['circle', { cx: '12', cy: '12', r: '8.5' }], ['path', { d: 'M12 7.5V12l3 2' }]],
    app: [['rect', { x: '4', y: '4', width: '7', height: '7', rx: '1.5' }], ['rect', { x: '13', y: '4', width: '7', height: '7', rx: '1.5' }], ['rect', { x: '4', y: '13', width: '7', height: '7', rx: '1.5' }], ['rect', { x: '13', y: '13', width: '7', height: '7', rx: '1.5' }]]
  };
  var APP_ICON = { schedule: 'calendar', password: 'key', payroll: 'yen', invoice: 'doc', kinmuhyo: 'clock' };
  function icon(appId) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'hb-ic');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    (ICONS[APP_ICON[appId]] || ICONS.app).forEach(function (p) {
      var e = document.createElementNS(NS, p[0]);
      Object.keys(p[1]).forEach(function (k) { e.setAttribute(k, p[1][k]); });
      svg.appendChild(e);
    });
    return svg;
  }
  /** SKYM のロゴ（墨色の四角に S K / Y M、横に SKYM。M だけ金茶） */
  function logo() {
    return h('span', { class: 'hb-logo', role: 'img', 'aria-label': 'SKYM' },
      h('span', { class: 'hb-logo-box', 'aria-hidden': 'true' }, h('span', { text: 'S' }), h('span', { text: 'K' }), h('span', { text: 'Y' }), h('span', { text: 'M' })),
      h('span', { class: 'hb-logo-word', 'aria-hidden': 'true' }, 'SKY', h('span', { text: 'M' })));
  }

  // 押すと開くメニュー。外を押す・Esc・中の項目を押すと閉じる。ほかのメニューが開いていたら閉じる
  var closers = [];
  function closeAll() { closers.forEach(function (f) { f(); }); }
  function dropdown(btn, list, cls, onOpen) {
    function onKey(e) { if (e.key === 'Escape') { close(); btn.focus(); } }
    function close() {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    }
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    list.hidden = true;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!list.hidden) { close(); return; }
      closeAll();
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      if (onOpen) onOpen();
    });
    list.addEventListener('click', function (e) { if (e.target.closest('button, a')) close(); else e.stopPropagation(); });
    closers.push(close);
    return h('div', { class: 'hb-menu' + (cls ? ' ' + cls : '') }, btn, list);
  }

  function item(it) {
    var kids = [it.label, it.note ? h('span', { class: 'hb-note', text: it.note }) : null];
    var cls = 'hb-mi' + (it.danger ? ' hb-danger' : '');
    if (it.href) return h('a', { class: cls, role: 'menuitem', href: it.href, id: it.id || null, target: it.newTab ? '_blank' : null, rel: it.newTab ? 'noopener noreferrer' : null }, kids);
    return h('button', { type: 'button', class: cls, role: 'menuitem', id: it.id || null, onclick: it.onclick || null }, kids);
  }

  /** 名前のメニュー */
  function userMenu(o) {
    var u = o.user;
    var kids = [h('div', { class: 'hb-who' }, h('b', { text: u.name }), u.role ? h('small', { text: u.role }) : null, u.email ? h('small', { text: u.email }) : null)];
    var appItems = (o.appItems || []).filter(Boolean);
    if (appItems.length) {
      kids.push(h('div', { class: 'hb-hr' }), h('span', { class: 'hb-sec', text: 'このアプリ' }), appItems.map(item));
    }
    var hubItems = [];
    if (o.isHub) {
      if (o.onMySettings) hubItems.push({ label: '自分の設定', note: 'パスワード・端末', onclick: o.onMySettings, id: 'btn-settings' });
    } else if (o.hubUrl) {
      hubItems.push({ label: 'Hub に戻る', href: o.hubUrl, id: 'hb-hub' });
      hubItems.push({ label: '自分の設定', note: 'パスワード・端末', href: o.hubUrl + '#settings', id: 'hb-me' });
    }
    if (hubItems.length) kids.push(h('div', { class: 'hb-hr' }), h('span', { class: 'hb-sec', text: 'Hub' }), hubItems.map(item));
    if (o.onLogout) kids.push(h('div', { class: 'hb-hr' }), item({ label: 'ログアウト', danger: true, onclick: o.onLogout, id: 'btn-logout' }));
    var list = h('div', { class: 'hb-list hb-user-list', role: 'menu' }, kids);
    var btn = h('button', { type: 'button', class: 'hb-ub', id: 'btn-user', title: u.name + (u.role ? '（' + u.role + '）' : '') },
      h('span', { class: 'hb-ub-name', text: u.name + ' ▾' }), u.role ? h('span', { class: 'hb-ub-role', text: u.role }) : null);
    return dropdown(btn, list, 'hb-right');
  }

  /** アプリ名 ▾: ほかのアプリへ移る（Hub の一覧と同じ絵・同じ色） */
  function appSwitch(o) {
    var tiles = h('div', { class: 'hb-tiles' });
    var head = o.isHub
      ? h('button', { type: 'button', class: 'hb-mi', role: 'menuitem', onclick: o.onHome || null }, logo(), 'アプリの一覧', h('span', { class: 'hb-note', text: 'いまここ' }))
      : (o.hubUrl ? h('a', { class: 'hb-mi', role: 'menuitem', href: o.hubUrl }, logo(), 'アプリの一覧（Hub）') : null);
    var list = h('div', { class: 'hb-list hb-sw-list', role: 'menu' }, head, head ? h('div', { class: 'hb-hr' }) : null, tiles);
    var loaded = false;
    function fill(apps) {
      tiles.textContent = '';
      if (!apps || !apps.length) { add(tiles, h('p', { class: 'hb-empty', text: 'ほかに使えるアプリはありません' })); return; }
      apps.forEach(function (a) {
        var cur = a.id === o.appId;
        add(tiles, h('a', { class: 'hb-tile' + (cur ? ' hb-cur' : ''), role: 'menuitem', href: a.href, 'data-app': a.id, 'aria-current': cur ? 'page' : null,
          target: o.appsNewTab ? '_blank' : null, rel: o.appsNewTab ? 'noopener noreferrer' : null },
          h('span', { class: 'hb-pola', 'aria-hidden': 'true' }, h('span', { class: 'hb-ph' }, icon(a.id))), a.name, cur ? h('small', { text: 'いまここ' }) : null));
      });
    }
    function load() {
      if (loaded) return;
      if (o.apps) { loaded = true; fill(o.apps); return; }
      if (!o.loadApps) { loaded = true; fill([]); return; }
      add(tiles, h('p', { class: 'hb-empty', text: '読み込んでいます…' }));
      Promise.resolve(o.loadApps()).then(function (apps) { loaded = true; fill(apps); }, function (e) {
        tiles.textContent = '';
        add(tiles, h('p', { class: 'hb-empty', text: (e && e.message) || '読み込めませんでした' }));
      });
    }
    var btn = h('button', { type: 'button', class: 'hb-appname', id: 'btn-apps', title: 'ほかのアプリへ移る' }, o.appName, h('small', { text: '▾' }));
    return dropdown(btn, list, 'hb-left', load);
  }

  function create(o) {
    closers = [];
    var tabBtns = (o.tabs || []).map(function (t) {
      var a = { type: 'button', class: 'hb-tab', role: 'tab', 'data-tab': t.id, 'aria-selected': 'false', text: t.label, title: t.title || null,
        onclick: function () { if (o.onTab) o.onTab(t.id); } };
      Object.keys(t.attrs || {}).forEach(function (k) { a[k] = t.attrs[k]; }); // アプリの印（data-view など）
      return h('button', a);
    });
    function setTab(id) {
      tabBtns.forEach(function (b) {
        var on = b.getAttribute('data-tab') === id;
        b.className = 'hb-tab' + (on ? ' hb-on' : '');
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    var home = o.isHub
      ? h('button', { type: 'button', class: 'hb-home', title: 'アプリの一覧へ', onclick: o.onHome || null }, logo())
      : (o.hubUrl ? h('a', { class: 'hb-home', href: o.hubUrl, title: 'Hub（アプリの一覧）へ' }, logo()) : h('span', { class: 'hb-home' }, logo()));
    var el = h('div', { class: 'hb' + (o.sticky === false ? '' : ' hb-sticky'), role: 'banner', 'data-app': o.isHub ? 'hub' : o.appId },
      h('div', { class: 'hb-band' }, h('div', { class: 'hb-in' },
        home, h('span', { class: 'hb-sp' }), o.user ? userMenu(o) : null)),
      h('div', { class: 'hb-appbar' }, h('div', { class: 'hb-in' },
        h('span', { class: 'hb-app-pola', 'aria-hidden': 'true' }),
        appSwitch(o),
        o.version ? h('span', { class: 'hb-ver', text: 'v' + o.version }) : null,
        tabBtns.length ? h('div', { class: 'hb-tabs', role: 'tablist', 'aria-label': o.appName + 'のページ' }, tabBtns) : null,
        h('span', { class: 'hb-sp' }),
        o.tools && o.tools.length ? h('div', { class: 'hb-tools' }, o.tools) : null)),
      h('div', { class: 'hb-line', 'aria-hidden': 'true' }));
    if (o.tab) setTab(o.tab);
    return { el: el, setTab: setTab, close: closeAll };
  }

  window.HubBar = { create: create, closeAll: closeAll };
})();
