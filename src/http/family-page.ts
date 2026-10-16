/**
 * The family calendar page. Self-contained (no build step, no framework): it runs inside
 * Telegram as a Mini App and in any browser. It only ever talks to /family/api on the
 * same origin, and every change it makes is a tool call made as the person
 * signed in, so it can do exactly what that person could say to the bot and nothing more.
 *
 * Written without backticks or template placeholders so it can live in this string.
 */
export const FAMILY_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Family Calendar · We’ve Got This</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root {
  --bg: #ffffff; --panel: #f6f7f9; --ink: #1d2433; --muted: #667085; --line: #e4e7ec;
  --accent: #2f6fed; --accent-ink: #ffffff; --warn: #b54708; --warn-bg: #fff4e5; --ok: #067647; --ok-bg: #e7f6ec;
  --bad-bg: #fdecec; --shadow: 0 8px 30px rgba(16,24,40,.12);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f1420; --panel: #171e2c; --ink: #e8ecf3; --muted: #98a2b3; --line: #273041;
    --accent: #6b9bff; --accent-ink: #0b1020; --warn: #fdb022; --warn-bg: #3a2a10; --ok: #47cd89; --ok-bg: #0f2e20;
    --bad-bg: #3a1717; --shadow: 0 8px 30px rgba(0,0,0,.5);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); }
body { font-size: 15px; line-height: 1.4; }
button { font: inherit; cursor: pointer; }
.top { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); padding: 10px 16px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.title { font-weight: 700; font-size: 18px; margin-right: auto; }
.range { font-weight: 600; min-width: 120px; }
.btn { border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 10px; padding: 7px 12px; }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
.btn.small { padding: 4px 9px; font-size: 13px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.seg button { border: 0; background: var(--panel); color: var(--ink); padding: 7px 12px; }
.seg button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.chip { border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 13px; background: var(--panel); color: var(--ink); display: inline-flex; align-items: center; gap: 6px; }
.chip.off { opacity: .45; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
.alert { font-size: 13px; padding: 3px 10px; border-radius: 999px; background: var(--warn-bg); color: var(--warn); font-weight: 600; }
.banner { margin: 10px 16px 0; padding: 10px 12px; border-radius: 10px; background: var(--panel); color: var(--muted); font-size: 14px; }
main { padding: 12px 16px 90px; }

/* Month */
.month { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.dow { font-size: 12px; color: var(--muted); text-align: center; padding: 6px 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.cell { min-height: 104px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 4px; overflow: hidden; }
.cell.other { background: var(--panel); }
.cell.today .num { background: var(--accent); color: var(--accent-ink); }
.num { font-size: 12px; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 2px; }
.ev { display: block; width: 100%; text-align: left; border: 0; border-radius: 6px; padding: 2px 6px; margin: 2px 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink); background: var(--panel); border-left: 3px solid var(--c, var(--accent)); }
.ev.needs { background: var(--warn-bg); }
.ev.cancelled { text-decoration: line-through; opacity: .55; }
.doses { font-size: 11px; color: var(--muted); padding: 0 4px; }
.more { font-size: 11px; color: var(--accent); border: 0; background: none; padding: 0 4px; }

/* Week */
.week { display: grid; grid-template-columns: 48px repeat(7, minmax(0,1fr)); }
.wk-head { font-size: 12px; text-align: center; padding: 6px 2px; color: var(--muted); border-bottom: 1px solid var(--line); }
.wk-head b { display: block; font-size: 18px; color: var(--ink); }
.wk-head.today b { color: var(--accent); }
.hours { position: relative; }
.hour { height: 48px; font-size: 11px; color: var(--muted); text-align: right; padding-right: 6px; transform: translateY(-7px); }
.col { position: relative; border-left: 1px solid var(--line); }
.slot { height: 48px; border-bottom: 1px solid var(--line); }
.slot:hover { background: var(--panel); }
.blk { position: absolute; left: 3px; right: 3px; border-radius: 8px; padding: 3px 6px; font-size: 12px; overflow: hidden; border: 0; text-align: left; color: var(--ink); background: var(--panel); border-left: 3px solid var(--c, var(--accent)); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.blk.dose { border-radius: 999px; padding: 1px 6px; font-size: 11px; }
.blk.needs { background: var(--warn-bg); }
.blk.recorded { background: var(--ok-bg); }
.blk.norecord { background: var(--bad-bg); }
.blk.cancelled { text-decoration: line-through; opacity: .55; }
.now-line { position: absolute; left: 0; right: 0; height: 2px; background: #e5484d; z-index: 2; }

/* Agenda */
.day { margin-bottom: 18px; }
.day h3 { font-size: 14px; color: var(--muted); margin: 0 0 6px; text-transform: uppercase; letter-spacing: .04em; }
.item { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 12px; padding: 10px 12px; margin-bottom: 6px; border-left: 4px solid var(--c, var(--accent)); }
.item .t { width: 64px; flex: none; color: var(--muted); font-size: 13px; padding-top: 1px; }
.item .w { flex: 1; min-width: 0; }
.item .d { color: var(--muted); font-size: 13px; }
.badge { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; white-space: nowrap; }
.b-needs { background: var(--warn-bg); color: var(--warn); }
.b-ok { background: var(--ok-bg); color: var(--ok); }
.b-none { background: var(--bad-bg); color: var(--ink); }
.empty { color: var(--muted); font-size: 14px; padding: 6px 2px; }

/* Drawer */
.scrim { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 20; display: none; }
.drawer { position: fixed; z-index: 21; left: 0; right: 0; bottom: 0; max-height: 86vh; overflow: auto; background: var(--bg); border-radius: 18px 18px 0 0; box-shadow: var(--shadow); padding: 18px 16px 28px; display: none; }
@media (min-width: 760px) { .drawer { left: auto; top: 0; bottom: 0; width: 420px; max-height: none; border-radius: 0; } }
.drawer h2 { margin: 0 0 4px; font-size: 20px; }
.drawer .sub { color: var(--muted); margin-bottom: 14px; }
.drawer .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 16px; }
.work { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; }
label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
input, select { width: 100%; font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 9px 10px; }
.tabs { display: flex; gap: 6px; margin-bottom: 8px; }
.toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 22px; z-index: 30; max-width: min(560px, calc(100% - 32px)); background: var(--ink); color: var(--bg); padding: 10px 14px; border-radius: 12px; box-shadow: var(--shadow); display: none; font-size: 14px; }
.fab { position: fixed; right: 18px; bottom: 18px; z-index: 10; border-radius: 16px; padding: 12px 18px; box-shadow: var(--shadow); }
.gate { max-width: 460px; margin: 60px auto; padding: 0 16px; text-align: center; color: var(--muted); }
.gate h1 { color: var(--ink); font-size: 22px; }
@media (max-width: 640px) { .cell { min-height: 76px; } .ev { font-size: 11px; } .hide-sm { display: none; } }
</style>
</head>
<body>
<div id="app"></div>
<div class="scrim" id="scrim"></div>
<div class="drawer" id="drawer" role="dialog" aria-modal="true"></div>
<div class="toast" id="toast" role="status"></div>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready(); tg.expand();
    var p = tg.themeParams || {};
    var r = document.documentElement.style;
    if (p.bg_color) r.setProperty('--bg', p.bg_color);
    if (p.secondary_bg_color) r.setProperty('--panel', p.secondary_bg_color);
    if (p.text_color) r.setProperty('--ink', p.text_color);
    if (p.hint_color) r.setProperty('--muted', p.hint_color);
    if (p.button_color) r.setProperty('--accent', p.button_color);
    if (p.button_text_color) r.setProperty('--accent-ink', p.button_text_color);
  }

  // A browser link carries its token in the #fragment, so it never reaches a server log.
  var token = null;
  try {
    var m = location.hash.match(/t=([A-Za-z0-9_.-]+)/);
    if (m) { sessionStorage.setItem('cc-token', m[1]); history.replaceState(null, '', location.pathname + location.search); }
    token = sessionStorage.getItem('cc-token');
  } catch (e) { var mm = location.hash.match(/t=([A-Za-z0-9_.-]+)/); token = mm ? mm[1] : null; }
  var demo = /[?&]demo/.test(location.search);

  var PALETTE = ['#2f6fed', '#d9480f', '#2b8a3e', '#ae3ec9', '#0c8599', '#e67700', '#c2255c', '#5f3dc4'];
  var S = { view: window.innerWidth < 640 ? 'agenda' : 'month', anchor: null, data: null, hidden: {}, loading: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function headers() {
    var h = { 'content-type': 'application/json' };
    if (tg) h['x-telegram-init-data'] = tg.initData; else if (token) h['x-family-token'] = token;
    return h;
  }
  function q() { return demo && !tg && !token ? '&demo=1' : ''; }
  function addDays(d, n) { var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function dow(d) { return new Date(d + 'T12:00:00Z').getUTCDay(); }
  function mondayOf(d) { var w = dow(d); return addDays(d, w === 0 ? -6 : 1 - w); }
  function monthStart(d) { return d.slice(0, 8) + '01'; }
  function fmt(d, o) { return new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, Object.assign({ timeZone: 'UTC' }, o)); }
  function colorOf(id) {
    if (!id || !S.data) return 'var(--accent)';
    var i = S.data.view.people.findIndex(function (p) { return p.id === id; });
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(function () { t.style.display = 'none'; }, 5200); }

  function range() {
    var a = S.anchor;
    if (S.view === 'month') { var start = mondayOf(monthStart(a)); return { from: start, days: 42 }; }
    if (S.view === 'week') return { from: mondayOf(a), days: 7 };
    return { from: a, days: 14 };
  }

  function load() {
    // The family's "today" is the server's to say (their time zone), so ask it first.
    if (!S.anchor) {
      return fetch('/family/api/view?days=1' + q(), { headers: headers() })
        .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
        .then(function (x) { if (!x.ok) { gate(x.b.error || 'Something went wrong.'); return; } S.anchor = x.b.view.today; return load(); })
        .catch(function () { gate('Could not reach the family calendar. Check your connection and try again.'); });
    }
    var r = range();
    S.loading = true;
    return fetch('/family/api/view?from=' + r.from + '&days=' + r.days + q(), { headers: headers() })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, b: b }; }); })
      .then(function (x) {
        S.loading = false;
        if (!x.ok) { gate(x.b.error || 'Something went wrong.'); return; }
        S.data = x.b; if (!S.anchor) S.anchor = x.b.view.today;
        render();
      })
      .catch(function () { S.loading = false; gate('Could not reach the family calendar. Check your connection and try again.'); });
  }

  function gate(msg) {
    $('app').innerHTML = '<div class="gate"><h1>Family calendar</h1><p>' + esc(msg) + '</p>'
      + '<p>In Telegram, send We’ve Got This <b>/calendar</b>. It opens here, just for you.</p>'
      + '<p><a href="?demo">See the demo family\'s calendar</a></p></div>';
  }

  function act(tool, args) {
    if (S.data && S.data.readOnly) { toast('This is the demo: look around, nothing here can be changed.'); return Promise.resolve(); }
    return fetch('/family/api/act' + (q() ? '?' + q().slice(1) : ''), { method: 'POST', headers: headers(), body: JSON.stringify({ tool: tool, args: args }) })
      .then(function (res) { return res.json(); })
      .then(function (b) { toast(b.text || b.error || 'Done.'); closeDrawer(); return load(); })
      .catch(function () { toast('That didn\'t go through. Try again.'); });
  }

  function visible(item) { var id = item.ids && item.ids.forMemberId; return !id || !S.hidden[id]; }
  function needs(item) { return item.status === 'unowned' || item.status === 'proposed' || item.status === 'asked'; }
  function allDays() { return S.data.view.days; }
  function dayOf(date) { return allDays().find(function (d) { return d.date === date; }); }

  function header() {
    var v = S.data.view, a = S.anchor, label;
    if (S.view === 'month') label = fmt(a, { month: 'long', year: 'numeric' });
    else if (S.view === 'week') { var s = mondayOf(a); label = fmt(s, { day: 'numeric', month: 'short' }) + ' - ' + fmt(addDays(s, 6), { day: 'numeric', month: 'short' }); }
    else label = 'From ' + fmt(a, { weekday: 'short', day: 'numeric', month: 'short' });
    var alerts = '';
    if (v.counts.needsSomeone) alerts += '<span class="alert">' + v.counts.needsSomeone + (v.counts.needsSomeone === 1 ? ' thing needs' : ' things need') + ' someone</span>';
    if (v.counts.noRecordToday) alerts += '<span class="alert">' + v.counts.noRecordToday + ' with no record today</span>';
    var people = v.people.map(function (p) {
      return '<button class="chip' + (S.hidden[p.id] ? ' off' : '') + '" data-person="' + esc(p.id) + '"><span class="dot" style="background:' + colorOf(p.id) + '"></span>' + esc(p.name) + '</button>';
    }).join('');
    return '<div class="top"><div class="row">'
      + '<div class="title">' + esc(v.household.name) + '</div>'
      + '<div class="seg" role="tablist">'
      + ['month', 'week', 'agenda'].map(function (x) { return '<button data-view="' + x + '" class="' + (S.view === x ? 'on' : '') + '">' + x.charAt(0).toUpperCase() + x.slice(1) + '</button>'; }).join('')
      + '</div></div>'
      + '<div class="row" style="margin-top:8px"><button class="btn small" data-nav="-1" aria-label="Previous">&#8249;</button>'
      + '<button class="btn small" data-nav="0">Today</button><button class="btn small" data-nav="1" aria-label="Next">&#8250;</button>'
      + '<span class="range">' + esc(label) + '</span>' + alerts + '</div>'
      + '<div class="chips">' + people + '</div></div>'
      + (S.data.readOnly ? '<div class="banner">This is the demo family, read-only. Your own family\'s calendar opens from We’ve Got This in Telegram with /calendar.</div>' : '');
  }

  function evButton(item, date, idx, cls) {
    var c = colorOf(item.ids && item.ids.forMemberId);
    var k = (needs(item) ? ' needs' : '') + (item.status === 'cancelled' ? ' cancelled' : '');
    return '<button class="' + cls + k + '" style="--c:' + c + '" data-open="' + date + ':' + idx + '">' + (item.time ? esc(item.time) + ' ' : '') + esc(title(item)) + '</button>';
  }
  function title(item) {
    if (item.kind === 'dose') return item.title + (item.forName ? ' (' + item.forName + ')' : '');
    if (item.kind === 'appointment') return (item.forName ? item.forName + ': ' : '') + item.title;
    return item.title;
  }

  function month() {
    var r = range(), html = '<div class="month">';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) { html += '<div class="dow">' + d + '</div>'; });
    var thisMonth = S.anchor.slice(0, 7);
    for (var i = 0; i < 42; i++) {
      var date = addDays(r.from, i), day = dayOf(date), items = day ? day.items.filter(visible) : [];
      var big = items.map(function (it, j) { return { it: it, j: j }; }).filter(function (x) { return x.it.kind !== 'dose'; });
      var doses = items.filter(function (it) { return it.kind === 'dose'; });
      var rec = doses.filter(function (d) { return d.status === 'recorded'; }).length;
      html += '<div class="cell' + (date.slice(0, 7) !== thisMonth ? ' other' : '') + (date === S.data.view.today ? ' today' : '') + '" data-day="' + date + '">'
        + '<span class="num">' + Number(date.slice(8)) + '</span>';
      big.slice(0, 3).forEach(function (x) { html += evButton(x.it, date, day.items.indexOf(x.it), 'ev'); });
      if (big.length > 3) html += '<button class="more" data-day-open="' + date + '">+' + (big.length - 3) + ' more</button>';
      if (doses.length) html += '<div class="doses">&#128138; ' + (date <= S.data.view.today ? rec + '/' + doses.length + ' recorded' : doses.length + ' doses') + '</div>';
      html += '</div>';
    }
    return html + '</div>';
  }

  var START_H = 6, END_H = 23, HOUR_PX = 48;
  function minutesOf(item) {
    if (!item.at) return null;
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: S.data.view.household.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(item.at));
    var h = Number(parts.find(function (p) { return p.type === 'hour'; }).value), mi = Number(parts.find(function (p) { return p.type === 'minute'; }).value);
    return (h % 24) * 60 + mi;
  }
  function week() {
    var r = range(), html = '<div class="week"><div></div>';
    for (var i = 0; i < 7; i++) {
      var d = addDays(r.from, i);
      html += '<div class="wk-head' + (d === S.data.view.today ? ' today' : '') + '">' + fmt(d, { weekday: 'short' }) + '<b>' + Number(d.slice(8)) + '</b></div>';
    }
    html += '<div class="hours">';
    for (var h = START_H; h < END_H; h++) html += '<div class="hour">' + (h === 12 ? '12 PM' : h > 12 ? (h - 12) + ' PM' : h + ' AM') + '</div>';
    html += '</div>';
    for (var c = 0; c < 7; c++) {
      var date = addDays(r.from, c), day = dayOf(date);
      html += '<div class="col" data-col="' + date + '">';
      for (var hh = START_H; hh < END_H; hh++) html += '<div class="slot" data-slot="' + date + 'T' + String(hh).padStart(2, '0') + ':00"></div>';
      if (date === S.data.view.today) {
        var nowM = minutesOf({ at: new Date().toISOString() });
        if (nowM >= START_H * 60 && nowM < END_H * 60) html += '<div class="now-line" style="top:' + ((nowM - START_H * 60) / 60 * HOUR_PX) + 'px"></div>';
      }
      (day ? day.items : []).forEach(function (it, idx) {
        if (!visible(it)) return;
        var mins = minutesOf(it); if (mins == null) return;
        var top = Math.max(0, (mins - START_H * 60) / 60 * HOUR_PX);
        var isDose = it.kind === 'dose';
        var cls = 'blk' + (isDose ? ' dose' : '') + (needs(it) ? ' needs' : '') + (it.status === 'recorded' ? ' recorded' : '') + (it.status === 'no-record' ? ' norecord' : '') + (it.status === 'cancelled' ? ' cancelled' : '');
        var height = isDose ? 20 : 44;
        html += '<button class="' + cls + '" style="top:' + top + 'px;height:' + height + 'px;--c:' + colorOf(it.ids && it.ids.forMemberId) + '" data-open="' + date + ':' + idx + '">'
          + (isDose ? '' : '<b>' + esc(it.time) + '</b> ') + esc(title(it)) + '</button>';
      });
      html += '</div>';
    }
    return html + '</div>';
  }

  function badge(it) {
    if (it.status === 'recorded' || it.status === 'owned' || it.status === 'done') return '<span class="badge b-ok">' + esc(it.status === 'recorded' ? 'recorded' : it.status === 'done' ? 'done' : 'arranged') + '</span>';
    if (needs(it)) return '<span class="badge b-needs">' + (it.status === 'asked' ? 'asked' : it.status === 'proposed' ? 'needs a yes' : 'needs someone') + '</span>';
    if (it.status === 'no-record') return '<span class="badge b-none">no record</span>';
    if (it.status === 'cancelled') return '<span class="badge b-none">cancelled</span>';
    if (it.status === 'due') return '<span class="badge b-needs">due now</span>';
    return '';
  }
  function agenda() {
    var html = '';
    allDays().forEach(function (d) {
      var items = d.items.filter(visible);
      html += '<div class="day"><h3>' + esc(d.label) + '</h3>';
      if (!items.length) html += '<div class="empty">Nothing on.</div>';
      items.forEach(function (it) {
        var idx = d.items.indexOf(it);
        html += '<button class="item" style="--c:' + colorOf(it.ids && it.ids.forMemberId) + '" data-open="' + d.date + ':' + idx + '"><span class="t">' + esc(it.time || '') + '</span>'
          + '<span class="w"><b>' + esc(title(it)) + '</b> ' + badge(it) + '<div class="d">' + esc(it.detail || '') + '</div>'
          + (it.work || []).map(function (w) { return '<div class="d">&#8627; ' + esc(w.title) + ': ' + esc(w.detail) + '</div>'; }).join('')
          + '</span></button>';
      });
      html += '</div>';
    });
    if (S.data.view.undated.length) {
      html += '<div class="day"><h3>No date yet</h3>';
      S.data.view.undated.forEach(function (it, i) {
        html += '<button class="item" data-undated="' + i + '"><span class="t"></span><span class="w"><b>' + esc(it.title) + '</b> ' + badge(it) + '<div class="d">' + esc(it.detail) + '</div></span></button>';
      });
      html += '</div>';
    }
    return html;
  }

  function render() {
    var body = S.view === 'month' ? month() : S.view === 'week' ? week() : agenda();
    $('app').innerHTML = header() + '<main>' + body + '</main>'
      + (S.data.readOnly ? '' : '<button class="btn primary fab" data-new="">+ New</button>');
  }

  // --- the drawer: one item, and what can be done about it -------------------
  function openDrawer(html) { $('drawer').innerHTML = html; $('drawer').style.display = 'block'; $('scrim').style.display = 'block'; }
  function closeDrawer() { $('drawer').style.display = 'none'; $('scrim').style.display = 'none'; }
  function can(cap) { return S.data.me.can.indexOf(cap) >= 0; }

  function workBlock(w) {
    var id = esc(w.ids.obligationId), btns = '';
    if (w.status === 'proposed' && can('confirm_proposal')) btns += '<button class="btn small primary" data-do="confirm" data-id="' + id + '">Yes, it\'s needed</button><button class="btn small" data-do="unconfirm" data-id="' + id + '">Not needed</button>';
    if ((w.status === 'unowned' || w.status === 'asked') && can('claim_obligation')) btns += '<button class="btn small primary" data-do="claim" data-id="' + id + '">I\'ll take it</button>';
    if ((w.status === 'unowned') && can('request_owner')) btns += '<button class="btn small" data-do="ask" data-id="' + id + '">Ask whoever\'s free</button>';
    if (w.status === 'owned' && can('resolve_obligation')) btns += '<button class="btn small" data-do="resolve" data-id="' + id + '">Mark done</button>';
    return '<div class="work"><b>' + esc(w.title) + '</b> ' + badge(w) + '<div class="d" style="color:var(--muted)">' + esc(w.detail) + '</div>'
      + (btns ? '<div class="actions">' + btns + '</div>' : '') + '</div>';
  }

  function showItem(it, date) {
    var when = fmt(date, { weekday: 'long', day: 'numeric', month: 'long' }) + (it.time ? ', ' + it.time : '');
    var html = '<h2>' + esc(title(it)) + '</h2><div class="sub">' + esc(when) + ' &middot; ' + badge(it) + ' ' + esc(it.detail || '') + '</div>';
    if (it.kind === 'dose') {
      if (it.status !== 'recorded' && it.status !== 'upcoming' && !S.data.readOnly) {
        html += '<div class="actions"><button class="btn primary" data-do="dose" data-name="' + esc(it.title) + '" data-for="' + esc(it.forName || '') + '">Record as taken now</button></div>';
      }
      html += '<p style="color:var(--muted);font-size:14px">A missing record means nobody has written it down yet. It never means it wasn\'t taken.</p>';
    } else if (it.kind === 'appointment') {
      if (it.status !== 'cancelled' && !S.data.readOnly) {
        var local = it.at ? new Date(it.at) : null;
        html += '<label>Move it to</label><input type="datetime-local" id="moveTo" value="' + date + 'T' + (it.time ? '' : '09:00') + '">'
          + '<div class="actions"><button class="btn primary" data-do="move" data-name="' + esc(it.title) + '" data-for="' + esc(it.forName || '') + '">Move</button>'
          + '<button class="btn" data-do="cancel" data-name="' + esc(it.title) + '" data-for="' + esc(it.forName || '') + '">Cancel appointment</button></div>';
      }
      (it.work || []).forEach(function (w) { html += workBlock(w); });
    } else {
      html += workBlock(it);
    }
    html += '<div class="actions"><button class="btn" data-close="">Close</button></div>';
    openDrawer(html);
    var mv = $('moveTo');
    if (mv && it.at) {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: S.data.view.household.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(it.at));
      function g(t) { return parts.find(function (p) { return p.type === t; }).value; }
      mv.value = g('year') + '-' + g('month') + '-' + g('day') + 'T' + (g('hour') === '24' ? '00' : g('hour')) + ':' + g('minute');
    }
  }

  function showNew(prefill) {
    var cared = S.data.view.people.filter(function (p) { return p.role === 'care_recipient'; });
    var who = '<select id="nFor">' + cared.map(function (p) { return '<option>' + esc(p.name) + '</option>'; }).join('') + '</select>';
    var d = (prefill || S.data.view.today + 'T10:00').split('T');
    openDrawer('<h2>Add to the calendar</h2><div class="tabs"><button class="btn small primary" data-tab="appt">Appointment</button><button class="btn small" data-tab="med">Medicine</button></div>'
      + '<div id="fAppt"><label>What</label><input id="nWhat" placeholder="Eye check-up">'
      + '<label>For</label>' + who
      + '<label>Date</label><input type="date" id="nDate" value="' + d[0] + '"><label>Time</label><input type="time" id="nTime" value="' + (d[1] || '10:00') + '">'
      + '<div class="actions"><button class="btn primary" data-do="add-appt">Add appointment</button></div></div>'
      + '<div id="fMed" style="display:none"><label>Medicine</label><input id="mName" placeholder="Vitamin D">'
      + '<label>For</label>' + who.replace('nFor', 'mFor')
      + '<label>Times (24-hour, comma-separated)</label><input id="mTimes" value="08:00, 20:00">'
      + '<label>Last day (optional)</label><input type="date" id="mUntil">'
      + '<div class="actions"><button class="btn primary" data-do="add-med">Add medicine</button></div></div>'
      + '<p style="color:var(--muted);font-size:14px">A medical appointment adds what it needs, like a ride, for someone to take on.</p>'
      + '<div class="actions"><button class="btn" data-close="">Close</button></div>');
  }

  // --- one click handler for the whole page ------------------------------------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button, .slot, [data-day]');
    if (e.target === $('scrim')) { closeDrawer(); return; }
    if (!el || !S.data) return;
    var ds = el.dataset;
    if (ds.view) { S.view = ds.view; load(); return; }
    if (ds.nav !== undefined) {
      var n = Number(ds.nav);
      if (n === 0) S.anchor = S.data.view.today;
      else if (S.view === 'month') { var x = new Date(S.anchor.slice(0, 8) + '15T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); S.anchor = x.toISOString().slice(0, 10); }
      else S.anchor = addDays(S.anchor, n * (S.view === 'week' ? 7 : 14));
      load(); return;
    }
    if (ds.person) { S.hidden[ds.person] = !S.hidden[ds.person]; render(); return; }
    if (ds.open) { var sp = ds.open.split(':'), day = dayOf(sp[0]); if (day) showItem(day.items[Number(sp[1])], sp[0]); return; }
    if (ds.undated !== undefined) { showItem(S.data.view.undated[Number(ds.undated)], S.data.view.today); return; }
    if (ds.dayOpen) { S.view = 'agenda'; S.anchor = ds.dayOpen; load(); return; }
    if (ds.close !== undefined) { closeDrawer(); return; }
    if (ds['new'] !== undefined) { showNew(); return; }
    if (ds.slot && !S.data.readOnly) { showNew(ds.slot); return; }
    if (ds.tab) {
      $('fAppt').style.display = ds.tab === 'appt' ? '' : 'none'; $('fMed').style.display = ds.tab === 'med' ? '' : 'none';
      Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) { b.classList.toggle('primary', b === el); });
      return;
    }
    if (ds['do']) {
      var d = ds['do'];
      if (d === 'claim') act('claim_obligation', { obligationId: ds.id });
      else if (d === 'resolve') act('resolve_obligation', { obligationId: ds.id });
      else if (d === 'ask') act('request_owner', { obligationId: ds.id });
      else if (d === 'confirm') act('confirm_proposal', { obligationId: ds.id, confirmed: true });
      else if (d === 'unconfirm') act('confirm_proposal', { obligationId: ds.id, confirmed: false });
      else if (d === 'dose') act('log_care_event', Object.assign({ kind: 'medication_taken', medicationName: ds.name }, ds['for'] ? { aboutMemberId: ds['for'] } : {}));
      else if (d === 'move') { var v = $('moveTo').value; if (!v) { toast('Pick the new date and time.'); return; } act('change_appointment', Object.assign({ appointment: ds.name, newStartsAt: v + ':00' }, ds['for'] ? { forMemberId: ds['for'] } : {})); }
      else if (d === 'cancel') { if (confirm('Cancel this appointment? Anything arranged for it is called off too.')) act('change_appointment', Object.assign({ appointment: ds.name, cancel: true }, ds['for'] ? { forMemberId: ds['for'] } : {})); }
      else if (d === 'add-appt') {
        var what = $('nWhat').value.trim(); if (!what) { toast('Say what the appointment is.'); return; }
        act('record_appointment', { kind: what, startsAt: $('nDate').value + 'T' + $('nTime').value + ':00', forMemberId: $('nFor').value });
      } else if (d === 'add-med') {
        var name = $('mName').value.trim(); if (!name) { toast('Say which medicine.'); return; }
        var times = $('mTimes').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
        var until = $('mUntil').value;
        act('add_medication', Object.assign({ name: name, times: times, forMemberId: $('mFor').value }, until ? { until: until } : {}));
      }
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  if (!tg && !token && !demo) { gate('This calendar belongs to a family.'); return; }
  load();
})();
</script>
</body>
</html>`;
