/* Craftynos – Frontend (ohne Build-Schritt) */

class StaleError extends Error {}
const S = { cfg: null, timers: [], rid: 0, ac: null };
const $app = document.getElementById('app');
const $conn = document.getElementById('conn');

/* ---------- Helfer ---------- */

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}

const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  restart: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  trash: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13',
  folder: 'M3 6h6l2 2h10v11H3z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  cloud: 'M7 18a4 4 0 0 1-.6-7.9A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17.5 18z',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  back: 'M15 5l-7 7 7 7',
  up: 'M12 19V6M6 11l6-6 6 6',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  heart: 'M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.4-7 10-7 10z',
  food: 'M15 4a5 5 0 0 1 3.5 8.5L14 17l-7-7 4.5-4.5A5 5 0 0 1 15 4zM7 10l-3 3 2 2 3-3',
};
const FILLED = new Set(['play', 'stop', 'heart', 'food']);

function ico(name, size = 16) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('class', 'ico' + (FILLED.has(name) ? ' fill' : ''));
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[name]);
  s.append(p);
  return s;
}

function btn(label, { icon, kind = 'primary', sm, title, disabled, onclick, cls } = {}) {
  return h(
    'button',
    { class: `btn k-${kind}${sm ? ' sm' : ''}${label ? '' : ' icon'}${cls ? ' ' + cls : ''}`, title, disabled, onclick },
    icon && ico(icon, sm ? 14 : 16),
    label && h('span', {}, label),
  );
}
function abtn(href, label, { icon, kind = 'ghost', sm, title } = {}) {
  return h('a', { class: `btn k-${kind}${sm ? ' sm' : ''}${label ? '' : ' icon'}`, href, title }, icon && ico(icon, sm ? 14 : 16), label && h('span', {}, label));
}

async function api(path, opts = {}) {
  const rid = S.rid;
  const r = await fetch('/api' + path, { ...opts, signal: S.ac?.signal }).catch((e) => {
    throw e.name === 'AbortError' ? new StaleError() : e;
  });
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (rid !== S.rid) throw new StaleError();
  if (!r.ok) throw new Error((body && body.error) || (typeof body === 'string' && body) || r.statusText);
  return body;
}
const send = (method, path, body) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

function toast(msg, err = false) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), err ? 7000 : 3500);
}
const guard = (fn) => async (...a) => {
  try {
    return await fn(...a);
  } catch (e) {
    if (!(e instanceof StaleError)) toast(e.message, true);
  }
};
window.addEventListener('unhandledrejection', (e) => !(e.reason instanceof StaleError) && toast(String(e.reason?.message || e.reason), true));

function modal(title, body, footer = []) {
  const close = () => bg.remove();
  const bg = h(
    'div',
    { class: 'modal-bg', onclick: (e) => e.target === bg && close() },
    h(
      'div',
      { class: 'modal' },
      h('div', { class: 'ph' }, h('span', {}, title), btn('', { icon: 'x', kind: 'ghost', sm: true, onclick: close, title: 'Schließen' })),
      h('div', { class: 'pb' }, body),
      footer.length ? h('div', { class: 'foot' }, footer) : null,
    ),
  );
  document.body.append(bg);
  return { close };
}

const clearTimers = () => {
  S.timers.forEach(clearInterval);
  S.timers = [];
};
const every = (fn, ms) => S.timers.push(setInterval(fn, ms));

const nf = new Intl.NumberFormat('de-DE');
const fmtNum = (n) => nf.format(n ?? 0);
const fmtBytes = (n) => {
  if (n == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('de-DE') : '');
const fmtTicks = (t) => {
  const s = Math.floor((t || 0) / 20);
  return `${Math.floor(s / 3600)} Stunden, ${Math.floor((s % 3600) / 60)} Minuten`;
};
const pretty = (id) => id.replace(/_/g, ' ');
const headUrl = (uuid) => S.cfg.icons.head.replace('{uuid}', uuid);
const range = (a, b) => [...Array(b - a)].map((_, i) => a + i);

const STATUS = {
  online: 'Online',
  offline: 'Offline',
  starting: 'Startet …',
  crashed: 'Abgestürzt',
  updating: 'Aktualisiert …',
  unknown: 'Dateizugriff',
};
const statusEl = (st) => h('span', { class: `status s-${st}` }, h('span', { class: 'dot' }), STATUS[st] || st);

function icon(name) {
  const urls = [S.cfg.icons.item, S.cfg.icons.block];
  let step = 0;
  const img = h('img', { alt: name, loading: 'lazy' });
  const next = () => {
    if (step < urls.length) img.src = urls[step++].replace('{name}', name);
    else img.replaceWith(h('span', { class: 'txt' }, pretty(name)));
  };
  img.addEventListener('error', next);
  next();
  return img;
}

/* ---------- Konfiguration & Kopfleiste ---------- */

async function loadConfig(refresh = false) {
  S.cfg = await api('/config' + (refresh ? '?refresh=1' : ''));
  const { mode, api: a } = S.cfg;
  let cls = 'bad';
  let text = 'Keine Server gefunden';
  if (mode === 'api') (cls = 'ok'), (text = 'Crafty verbunden');
  else if (mode === 'volumes') (cls = 'warn'), (text = a.configured ? 'API nicht erreichbar · Dateizugriff' : 'Nur Dateizugriff');
  $conn.className = `conn ${cls}`;
  $conn.replaceChildren(h('span', { class: 'dot' }), text);
}

function updateNav(key) {
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.k === key));
}

/* ---------- Router ---------- */

async function route() {
  clearTimers();
  S.rid++;
  S.ac?.abort();
  S.ac = new AbortController();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  updateNav(parts[0] === 'settings' ? 'settings' : 'servers');
  try {
    if (!S.cfg) await loadConfig();
    else loadConfig().catch(() => {});
    if (parts[0] === 'settings') await viewSettings(parts[1] || 'connection');
    else if (parts[0] === 's' && parts[1]) await viewServer(parts[1], parts[2] || 'overview');
    else await viewList();
  } catch (e) {
    if (e instanceof StaleError) return;
    $app.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Fehler')), h('div', { class: 'empty' }, h('p', {}, e.message)));
  }
}

/* ---------- Serverliste ---------- */

const doAction = guard(async (id, action, label) => {
  await send('POST', `/servers/${id}/action/${action}`);
  toast(label);
});

function controls(id, st, hasApi, sm) {
  if (!hasApi)
    return [h('span', { class: 'muted', style: 'font-size:13px' }, 'Start/Stop benötigt die Crafty-API. ', h('a', { href: '#/settings/connection', onclick: (e) => e.stopPropagation() }, 'Einrichten'))];
  const mk = (label, icon, kind, action, msg) =>
    btn(label, { icon, kind, sm, onclick: (e) => (e.stopPropagation(), doAction(id, action, msg)) });
  if (st === 'offline' || st === 'crashed' || st === 'unknown') return [mk('Starten', 'play', 'success', 'start_server', 'Start angefordert')];
  return [mk('Stoppen', 'stop', 'danger', 'stop_server', 'Stop angefordert'), mk('Neustart', 'restart', 'ghost', 'restart_server', 'Neustart angefordert')];
}

async function viewList() {
  const wrap = h('div');
  $app.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Deine Server')), wrap);
  const load = async () => {
    try {
      const list = await api('/servers');
      if (!list.length) {
        wrap.replaceChildren(
          h('div', { class: 'empty' }, h('h2', {}, 'Keine Server gefunden'),
            h('p', {}, 'Craftynos liest Server aus dem gemounteten Ordner ', h('code', {}, '/crafty/servers'), ' oder über die Crafty-API.'),
            h('p', {}, 'Prüfe, ob die Volumes in der Compose gesetzt sind, und richte bei Bedarf die API ein.'),
            h('p', {}, abtn('#/settings/connection', 'Verbindung prüfen', { kind: 'primary' }))),
        );
        return;
      }
      const a = S.cfg.api;
      wrap.replaceChildren(
        S.cfg.mode === 'volumes' && a.configured && a.error ? h('div', { class: 'page-note' }, `Crafty-API nicht erreichbar: ${a.error} `, h('a', { href: '#/settings/connection' }, 'Einstellungen')) : null,
        h('div', { class: 'grid' },
          list.map((s) =>
            h('div', { class: `scard s-${s.status}`, onclick: () => (location.hash = `#/s/${s.id}`) },
              h('div', { class: 'scard-top' }, h('div', { class: 'scard-name' }, s.name), statusEl(s.status)),
              h('div', { class: 'scard-meta' },
                h('div', {}, h('small', {}, 'Spieler'), h('b', {}, s.api ? `${s.online}/${s.max || '–'}` : `max. ${s.max || '–'}`)),
                h('div', {}, h('small', {}, 'Version'), h('b', {}, s.version || '–')),
                h('div', {}, h('small', {}, 'Port'), h('b', {}, s.port || '–'))),
              h('div', { class: 'scard-actions' }, controls(s.id, s.status, s.api, true))))),
      );
    } catch (e) {
      wrap.replaceChildren(h('div', { class: 'empty' }, h('p', {}, e.message)));
    }
  };
  await load();
  every(load, 5000);
}

/* ---------- Server-Seite ---------- */

const TABS = [
  ['overview', 'Übersicht'],
  ['players', 'Spieler & Inventar'],
  ['whitelist', 'Whitelist'],
  ['properties', 'Properties'],
  ['files', 'Dateien'],
  ['backups', 'Backups'],
];

async function viewServer(id, tab) {
  let info = await api(`/servers/${id}`);
  const hooks = {};
  const head = h('div', { class: 'page-head' });
  const paintHead = () =>
    head.replaceChildren(h('h1', {}, info.name), statusEl(info.status), h('span', { class: 'sp' }), controls(id, info.status, info.api, false));
  paintHead();
  const body = h('div');
  $app.replaceChildren(
    h('a', { class: 'back', href: '#/' }, ico('back', 16), 'Alle Server'),
    head,
    h('div', { class: 'tabs' }, TABS.map(([k, label]) => h('a', { href: `#/s/${id}/${k}`, class: k === tab ? 'active' : '' }, label))),
    body,
  );
  every(async () => {
    try {
      info = await api(`/servers/${id}`);
      paintHead();
      hooks.onInfo?.(info);
    } catch {
      /* nächster Versuch */
    }
  }, 4000);
  const view = { overview: tOverview, players: tPlayers, whitelist: tWhitelist, properties: tProperties, files: tFiles, backups: tBackups }[tab] || tOverview;
  await view(id, info, body, hooks);
}

/* --- Übersicht --- */

async function tOverview(id, info, el, hooks) {
  const tiles = h('div', { class: 'tiles' });
  const paint = (i) =>
    tiles.replaceChildren(
      ...[
        ['Status', STATUS[i.status]],
        ['Spieler', i.api ? `${i.online}/${i.max || '–'}` : `max. ${i.max || '–'}`],
        ['Version', i.version || '–'],
        ['CPU', i.api ? `${i.cpu}%` : '–'],
        ['RAM', i.mem || '–'],
        ['Welt', i.level],
        ['Port', i.port || '–'],
      ].map(([k, v]) => h('div', { class: 'tile' }, h('small', {}, k), h('b', {}, v))),
    );
  paint(info);
  hooks.onInfo = paint;

  const con = h('div', { class: 'console' });
  const input = h('input', { placeholder: info.api ? 'Befehl, z. B. say Hallo (ohne /)' : 'Befehle benötigen die Crafty-API', disabled: !info.api, onkeydown: (e) => e.key === 'Enter' && run() });
  const run = guard(async () => {
    const command = input.value.trim();
    if (!command) return;
    input.value = '';
    await send('POST', `/servers/${id}/command`, { command });
    setTimeout(loadLogs, 600);
  });
  const loadLogs = async () => {
    try {
      const { lines } = await api(`/servers/${id}/logs`);
      const atBottom = con.scrollTop + con.clientHeight >= con.scrollHeight - 30;
      con.textContent = lines.length ? lines.join('\n') : 'Noch keine Logausgabe.';
      if (atBottom) con.scrollTop = con.scrollHeight;
    } catch (e) {
      con.textContent = e.message;
    }
  };
  el.append(
    tiles,
    h('div', { class: 'panel' },
      h('div', { class: 'ph' }, 'Konsole', h('span', { class: 'sp' }), !info.api && h('span', { class: 'panel-sub' }, 'Anzeige aus logs/latest.log')),
      h('div', { class: 'pb' }, con, h('div', { class: 'cmd' }, input, btn('Senden', { onclick: run, disabled: !info.api })))),
  );
  await loadLogs();
  con.scrollTop = con.scrollHeight;
  every(loadLogs, 3000);
}

/* --- Spieler & Inventar --- */

async function tPlayers(id, info, el) {
  const list = h('div');
  const detail = h('div');
  el.append(h('div', { class: 'pl-layout' }, h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'Spieler', h('span', { class: 'sp' }), btn('', { icon: 'restart', kind: 'ghost', sm: true, onclick: () => load(), title: 'Aktualisieren' })), list), detail));
  let selected = null;
  const load = guard(async () => {
    const players = await api(`/servers/${id}/players`);
    list.replaceChildren(
      ...players.map((p) =>
        h('div', { class: 'pitem' + (p.uuid === selected ? ' sel' : ''), onclick: () => ((selected = p.uuid), load(), showPlayer(p)) },
          h('img', { src: headUrl(p.uuid), alt: '' }),
          h('div', { style: 'flex:1;min-width:0' }, h('b', {}, p.name || p.uuid.slice(0, 8)), !p.hasData && h('div', { class: 'muted', style: 'font-size:12px' }, 'keine Spielerdaten')),
          p.online && h('span', { class: 'chip green' }, 'online'),
          p.op && h('span', { class: 'chip orange' }, 'OP'),
          p.banned && h('span', { class: 'chip red' }, 'gebannt')),
      ),
    );
    if (!players.length) list.append(h('div', { class: 'pb muted' }, 'Noch keine Spieler bekannt.'));
  });
  const showPlayer = guard(async (p) => {
    detail.replaceChildren(h('p', { class: 'muted' }, 'Lade …'));
    detail.replaceChildren(playerView(p, await api(`/servers/${id}/players/${p.uuid}`)));
  });
  await load();
}

const GM = ['Überleben', 'Kreativ', 'Abenteuer', 'Zuschauer'];
const dimName = (d) => (d ? d.replace('minecraft:', '') : '');
const posStr = (p) => (p ? `X ${p[0]}  Y ${p[1]}  Z ${p[2]}` : '–');

function playerView(p, d) {
  const out = h('div');
  out.append(
    h('div', { class: 'panel' },
      h('div', { class: 'phead' },
        h('img', { src: headUrl(p.uuid), alt: '' }),
        h('div', {}, h('h2', { style: 'font-size:22px' }, p.name || p.uuid), h('div', { class: 'muted mono', style: 'font-size:12px' }, p.uuid)),
        h('span', { class: 'sp' }),
        p.online && h('span', { class: 'chip green' }, 'Online'))),
  );
  if (!d.hasData) out.append(h('p', { class: 'muted' }, 'Für diesen Spieler liegen noch keine Spielerdaten vor.'));
  else {
    const hp = d.health ?? 20;
    const hearts = range(0, 10).map((i) => {
      const on = hp > i * 2;
      const e = h('span', { class: 'heart' + (on ? '' : ' off') }, ico('heart', 20));
      if (hp === i * 2 + 1) e.style.opacity = '.6';
      return e;
    });
    const foods = range(0, 10).map((i) => h('span', { class: 'food' + (d.food > i * 2 ? '' : ' off') }, ico('food', 18)));
    out.append(
      h('div', { class: 'panel' },
        h('div', { class: 'ph' }, 'Leben und Erfahrung'),
        h('div', { class: 'pb' },
          h('div', { style: 'text-align:center;font-weight:700;margin-bottom:6px' }, `Level ${d.xpLevel}`),
          h('div', { class: 'xpbar' }, h('i', { style: `width:${Math.round((d.xpProgress || 0) * 100)}%` })),
          h('div', { class: 'vitals' }, hearts),
          h('div', { class: 'vitals' }, foods))),
      h('div', { class: 'panel' },
        h('div', { class: 'ph' }, 'Informationen'),
        h('div', { class: 'pb' },
          h('div', { class: 'tiles', style: 'margin:0' },
            [
              ['Spielmodus', GM[d.gameMode] ?? d.gameMode],
              ['Aktuelle Position', `${posStr(d.pos)}\n${dimName(d.dimension)}`],
              ['Respawn', d.spawn ? posStr(d.spawn) : '–'],
              ['Letzter Tod', d.lastDeath ? `${posStr(d.lastDeath.pos)}\n${dimName(d.lastDeath.dimension)}` : '–'],
            ].map(([k, v]) => h('div', { class: 'tile', style: 'background:var(--panel-2);white-space:pre-line' }, h('small', {}, k), h('b', { style: 'font-size:14px' }, v)))),
          h('p', { class: 'muted', style: 'font-size:12px;margin:10px 0 0' }, `Spielerdaten gespeichert: ${fmtDate(d.updated)} (der Server schreibt sie beim Speichern/Ausloggen)`))),
      inventoryPanel(d),
    );
  }
  if (d.stats) out.append(statsPanel(d.stats));
  return out;
}

function slotEl(item) {
  const s = h('div', { class: 'slot', title: item ? `${item.customName || pretty(item.name)}${item.count > 1 ? ' ×' + item.count : ''}` : '' });
  if (item) {
    s.append(icon(item.name));
    if (item.count > 1) s.append(h('span', { class: 'cnt' }, item.count));
  }
  return s;
}

function inventoryPanel(d) {
  const bySlot = (arr) => new Map((arr || []).map((i) => [i.slot, i]));
  const inv = bySlot(d.inventory);
  const ender = bySlot(d.enderChest);
  const grid = h('div', { class: 'inv' });
  const armor = h('div', { class: 'armor' }, [103, 102, 101, 100, -106].map((n) => slotEl(inv.get(n))));
  const showInv = () => (grid.replaceChildren(...[...range(9, 36), ...range(0, 9)].map((n) => slotEl(inv.get(n)))), (armor.style.display = ''));
  const showEnder = () => (grid.replaceChildren(...range(0, 27).map((n) => slotEl(ender.get(n)))), (armor.style.display = 'none'));
  showInv();
  return h('div', { class: 'panel' },
    h('div', { class: 'ph' }, 'Inventar', h('span', { class: 'sp' }), btn('Inventar', { sm: true, onclick: showInv }), btn(`Endertruhe (${ender.size})`, { sm: true, kind: 'ghost', onclick: showEnder })),
    h('div', { class: 'pb' }, h('div', { class: 'invwrap' }, armor, grid)));
}

function statsPanel(s) {
  const col = (title, total, rows, withIcon) =>
    h('div', {}, h('h3', {}, title),
      total != null && h('div', { class: 'sr' }, h('b', { class: 'muted' }, 'Gesamt'), h('span', { style: 'font-weight:700' }, fmtNum(total))),
      rows.map((r) => h('div', { class: 'sr' }, h('span', {}, withIcon && icon(r.id), pretty(r.id)), h('span', {}, fmtNum(r.count)))));
  const D = s.distances;
  const dist = [
    ['Strecke gelaufen', D.walk], ['Strecke gesprintet', D.sprint], ['Strecke gefallen', D.fall],
    ['Strecke in Boot gefahren', D.boat], ['Strecke geschwommen', D.swim], ['Strecke auf Wasser gelaufen', D.walkOnWater],
    ['Strecke unter Wasser gelaufen', D.walkUnderWater], ['Strecke geklettert', D.climb], ['Strecke geschlichen', D.crouch],
  ].filter(([, v]) => v);
  const big = (t, v) => h('div', { class: 'bigstat' }, h('b', {}, t), v);
  return h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'Statistiken'),
    h('div', { class: 'pb' },
      h('div', { class: 'statgrid', style: 'margin-bottom:24px' }, big('Spielzeit', fmtTicks(s.playTimeTicks)), big('Spieler Kills', fmtNum(s.playerKills)), big('Tode', fmtNum(s.deaths)), big('K/D', s.deaths ? (s.playerKills / s.deaths).toFixed(2) : fmtNum(s.playerKills))),
      h('div', { class: 'statgrid' },
        h('div', {}, h('h3', {}, 'Strecke zurückgelegt (in Blöcken)'), h('div', { class: 'sr' }, h('b', { class: 'muted' }, 'Gesamt'), h('span', { style: 'font-weight:700' }, fmtNum(D.total))), dist.map(([k, v]) => h('div', { class: 'sr' }, h('span', {}, k), h('span', {}, fmtNum(v))))),
        col('Blöcke abgebaut', s.mined.total, s.mined.top, true),
        col('Items verwendet', s.used.total, s.used.top, true),
        col('Entities getötet', s.killed.total, s.killed.top, false))));
}

/* --- Whitelist --- */

async function tWhitelist(id, info, el) {
  const rows = h('tbody');
  const input = h('input', { placeholder: 'Spielername', onkeydown: (e) => e.key === 'Enter' && add() });
  const paint = (list) =>
    rows.replaceChildren(
      ...list.map((p) =>
        h('tr', {},
          h('td', {}, h('img', { src: headUrl(p.uuid), style: 'width:24px;height:24px;vertical-align:middle;margin-right:10px;image-rendering:pixelated;border-radius:3px' }), p.name),
          h('td', { class: 'mono muted' }, p.uuid),
          h('td', { class: 'r' }, btn('Entfernen', { icon: 'trash', kind: 'ghost danger', sm: true, onclick: () => remove(p.name) }))),
      ),
    );
  const add = guard(async () => {
    const name = input.value.trim();
    if (!name) return;
    paint(await send('POST', `/servers/${id}/whitelist`, { name }));
    input.value = '';
    toast(`${name} hinzugefügt`);
  });
  const remove = guard(async (name) => {
    paint(await api(`/servers/${id}/whitelist/${encodeURIComponent(name)}`, { method: 'DELETE' }));
    toast(`${name} entfernt`);
  });
  el.append(
    h('div', { class: 'panel' },
      h('div', { class: 'ph' }, 'Whitelist', h('span', { class: 'sp' }), info.whitelistEnabled ? h('span', { class: 'chip green' }, 'aktiv') : h('span', { class: 'chip red' }, 'in den Properties deaktiviert')),
      h('div', { class: 'pb' },
        h('div', { class: 'row-form' }, input, btn('Hinzufügen', { icon: 'plus', kind: 'success', onclick: add })),
        h('p', { class: 'muted', style: 'font-size:12px' }, info.api ? 'Läuft der Server, wird per Konsole (/whitelist add|remove) live geändert, sonst direkt whitelist.json bearbeitet.' : 'Ohne Crafty-API wird direkt whitelist.json bearbeitet. Läuft der Server, danach /whitelist reload ausführen.'),
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'UUID'), h('th', {}))), rows))),
  );
  guard(async () => paint(await api(`/servers/${id}/whitelist`)))();
}

/* --- server.properties --- */

const META = [
  ['max-players', 'Spieler', 'number'],
  ['gamemode', 'Spielmodus', 'select', { survival: 'Überleben', creative: 'Kreativ', adventure: 'Abenteuer', spectator: 'Zuschauer' }],
  ['difficulty', 'Schwierigkeit', 'select', { peaceful: 'Friedlich', easy: 'Leicht', normal: 'Normal', hard: 'Schwer' }],
  ['white-list', 'Whitelist', 'bool'],
  ['online-mode', 'Gecrackt', 'bool', { invert: true }],
  ['allow-flight', 'Fliegen', 'bool'],
  ['force-gamemode', 'Spielmodus erzwingen', 'bool'],
  ['spawn-protection', 'Spawn Schutz', 'number'],
  ['require-resource-pack', 'Ressourcenpaket erforderlich', 'bool'],
  ['pvp', 'PvP', 'bool'],
  ['hardcore', 'Hardcore', 'bool'],
  ['allow-nether', 'Nether', 'bool'],
  ['spawn-monsters', 'Monster', 'bool'],
  ['spawn-animals', 'Tiere', 'bool'],
  ['view-distance', 'Sichtweite', 'number'],
  ['simulation-distance', 'Simulationsdistanz', 'number'],
  ['motd', 'MOTD', 'text', null, true],
  ['resource-pack', 'Ressourcenpaket', 'text', null, true],
  ['resource-pack-prompt', 'Ressourcenpaket-Aufforderung', 'text', null, true],
  ['level-seed', 'Seed', 'text'],
];

async function tProperties(id, info, el) {
  const { entries } = await api(`/servers/${id}/properties`);
  const vals = Object.fromEntries(entries.map((e) => [e.key, e.value]));
  const dirty = {};
  const keyEls = {};
  const set = (k, v) => ((dirty[k] = String(v)), (vals[k] = String(v)), (keyEls[k].textContent = `${k}=${vals[k]}`));

  const control = (k, type, opts, invert) => {
    if (type === 'bool') {
      const on = () => (vals[k] === 'true') !== Boolean(invert);
      const t = h('button', { class: 'toggle' + (on() ? ' on' : ''), onclick: () => (set(k, vals[k] === 'true' ? 'false' : 'true'), t.classList.toggle('on', on())) });
      return t;
    }
    if (type === 'select') {
      const opt = { ...opts };
      if (!(vals[k] in opt)) opt[vals[k]] = vals[k];
      return h('select', { onchange: (e) => set(k, e.target.value) }, Object.entries(opt).map(([v, l]) => h('option', { value: v, selected: v === vals[k] }, l)));
    }
    return h('input', { type: type === 'number' ? 'number' : 'text', value: vals[k] ?? '', oninput: (e) => set(k, e.target.value) });
  };
  const card = (k, label, type, opts, wide) => {
    keyEls[k] = h('div', { class: 'key' }, `${k}=${vals[k]}`);
    return h('div', { class: 'prop', style: wide ? 'grid-column:1/-1' : '' },
      h('div', { class: 'top2' }, h('label', {}, label), control(k, type, opts?.invert ? null : opts, opts?.invert)), keyEls[k]);
  };
  const known = META.filter(([k]) => k in vals);
  const knownKeys = new Set(META.map(([k]) => k));
  const other = entries.filter((e) => !knownKeys.has(e.key));
  const guessType = (v) => (v === 'true' || v === 'false' ? 'bool' : /^-?\d+$/.test(v) ? 'number' : 'text');

  el.append(
    h('div', { class: 'panel' },
      h('div', { class: 'ph' }, 'server.properties', h('span', { class: 'sp' }), info.running && h('span', { class: 'chip orange' }, 'Server läuft – Änderungen greifen nach Neustart')),
      h('div', { class: 'pb' }, h('div', { class: 'pgrid' }, known.map(([k, l, t, o, w]) => card(k, l, t, o, w))))),
    h('details', { class: 'panel' },
      h('summary', { class: 'ph' }, `Erweitert (${other.length})`),
      h('div', { class: 'pb' }, h('div', { class: 'pgrid' }, other.map((e) => card(e.key, e.key, guessType(e.value), null, false))))),
    h('div', { class: 'savebar' },
      btn('Speichern', { icon: 'save', kind: 'success', onclick: guard(async () => {
        if (!Object.keys(dirty).length) return toast('Keine Änderungen');
        await send('PUT', `/servers/${id}/properties`, { values: dirty });
        Object.keys(dirty).forEach((k) => delete dirty[k]);
        toast('Gespeichert – Server neu starten, damit es wirksam wird');
      }) })),
  );
}

/* --- Dateien --- */

async function tFiles(id, info, el) {
  let cwd = '';
  const body = h('div');
  const crumbs = h('div', { class: 'crumbs' });
  const q = encodeURIComponent;
  const join = (a, b) => (a ? `${a}/${b}` : b);

  const fileInput = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: guard(async (e) => {
    for (const f of e.target.files) {
      const r = await fetch(`/api/servers/${id}/files/upload?path=${q(join(cwd, f.name))}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Upload fehlgeschlagen');
    }
    toast('Hochgeladen');
    e.target.value = '';
    load();
  }) });

  const edit = guard(async (path) => {
    const ta = h('textarea', { spellcheck: 'false' });
    ta.value = await api(`/servers/${id}/files/content?path=${q(path)}`);
    const m = modal(path, ta, [
      btn('Speichern', { icon: 'save', kind: 'success', onclick: guard(async () => {
        await api(`/servers/${id}/files/content?path=${q(path)}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: ta.value });
        toast('Gespeichert');
        m.close();
      }) }),
    ]);
  });

  const load = guard(async () => {
    const list = await api(`/servers/${id}/files?path=${q(cwd)}`);
    const segs = cwd ? cwd.split('/') : [];
    crumbs.replaceChildren(
      h('a', { onclick: () => ((cwd = ''), load()) }, 'Server'),
      ...segs.map((s, i) => [h('span', { class: 'muted' }, '/'), h('a', { onclick: () => ((cwd = segs.slice(0, i + 1).join('/')), load()) }, s)]),
    );
    body.replaceChildren(
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', { class: 'r' }, 'Größe'), h('th', {}, 'Geändert'), h('th', {}))),
        h('tbody', {},
          cwd && h('tr', { class: 'clickable', onclick: () => ((cwd = segs.slice(0, -1).join('/')), load()) }, h('td', { colspan: 4 }, ico('up'), '..')),
          list.map((f) => {
            const p = join(cwd, f.name);
            return h('tr', { class: f.dir ? 'clickable' : '', onclick: f.dir ? () => ((cwd = p), load()) : null },
              h('td', {}, ico(f.dir ? 'folder' : 'file'), f.name),
              h('td', { class: 'r muted' }, fmtBytes(f.size)),
              h('td', { class: 'muted' }, fmtDate(f.mtime)),
              h('td', { class: 'r', onclick: (e) => e.stopPropagation() },
                !f.dir && btn('', { icon: 'edit', kind: 'ghost', sm: true, title: 'Bearbeiten', onclick: () => edit(p) }),
                !f.dir && abtn(`/api/servers/${id}/files/download?path=${q(p)}`, '', { icon: 'download', sm: true, title: 'Herunterladen' }),
                btn('', { icon: 'trash', kind: 'ghost danger', sm: true, title: 'Löschen', onclick: guard(async () => {
                  if (!confirm(`„${f.name}“ wirklich löschen?`)) return;
                  await api(`/servers/${id}/files?path=${q(p)}`, { method: 'DELETE' });
                  load();
                }) })));
          }))),
    );
  });

  el.append(
    h('div', { class: 'panel' },
      h('div', { class: 'ph' }, crumbs, h('span', { class: 'sp' }),
        btn('Hochladen', { icon: 'upload', sm: true, onclick: () => fileInput.click() }),
        btn('Ordner', { icon: 'plus', sm: true, kind: 'ghost', onclick: guard(async () => {
          const n = prompt('Name des neuen Ordners');
          if (!n) return;
          await send('POST', `/servers/${id}/files/mkdir?path=${q(join(cwd, n))}`);
          load();
        }) }),
        fileInput),
      h('div', { class: 'pb' }, body)),
  );
  await load();
}

/* --- Backups --- */

async function followJob(jobId, box) {
  for (;;) {
    const j = await api(`/backup-jobs/${jobId}`);
    if (j.status === 'running') {
      box.replaceChildren(h('div', { class: 'progress' }, h('span', { class: 'spinner' }), j.step));
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    box.replaceChildren();
    if (j.status === 'error') throw new Error('Backup fehlgeschlagen: ' + j.error);
    toast(`Backup erstellt: ${j.file}`);
    return;
  }
}

async function tBackups(id, info, el) {
  const targets = await api('/settings/targets');
  const q = encodeURIComponent;
  const sel = h('select', { style: 'height:30px;font-size:13px' }, targets.map((t) => h('option', { value: t.id }, t.name)));
  const rows = h('tbody');
  const prog = h('div');
  const load = guard(async () => {
    const list = await api(`/servers/${id}/backups`);
    rows.replaceChildren(
      ...list.map((f) =>
        h('tr', {},
          h('td', {}, ico('file'), f.rel),
          h('td', { class: 'r' }, fmtBytes(f.size)),
          h('td', {}, fmtDate(f.mtime)),
          h('td', { class: 'r' },
            abtn(`/api/servers/${id}/backups/download?path=${q(f.rel)}`, '', { icon: 'download', sm: true, title: 'Herunterladen' }),
            targets.length > 0 && btn('', { icon: 'cloud', kind: 'ghost', sm: true, title: 'Auf ausgewähltes Ziel kopieren', onclick: guard(async () => {
              toast('Kopieren gestartet …');
              await send('POST', `/servers/${id}/backups/upload`, { path: f.rel, targetId: sel.value });
              toast('Auf Ziel kopiert');
            }) }),
            btn('', { icon: 'trash', kind: 'ghost danger', sm: true, title: 'Löschen', onclick: guard(async () => {
              if (!confirm('Backup wirklich löschen?')) return;
              await api(`/servers/${id}/backups?path=${q(f.rel)}`, { method: 'DELETE' });
              load();
            }) }))),
      ),
    );
    if (!list.length) rows.append(h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'Noch keine Backups.')));
  });
  const create = btn('Backup erstellen', { icon: 'plus', kind: 'success', sm: true });
  create.addEventListener('click', guard(async () => {
    create.disabled = true;
    try {
      const { jobId } = await send('POST', `/servers/${id}/backups/create`);
      await followJob(jobId, prog);
    } finally {
      create.disabled = false;
      prog.replaceChildren();
      load();
    }
  }));
  el.append(
    h('div', { class: 'panel' },
      h('div', { class: 'ph' }, 'Backups', h('span', { class: 'panel-sub' }, `Ordner „${info.level}“ als ZIP`), h('span', { class: 'sp' }),
        targets.length ? [h('span', { class: 'panel-sub' }, 'Ziel:'), sel] : abtn('#/settings/backups', 'Ziel einrichten', { sm: true }),
        create),
      h('div', { class: 'pb' },
        !info.api && h('div', { class: 'notice' }, 'Ohne Crafty-API wird die Welt vor dem Backup nicht gespeichert. Am besten Backups bei gestopptem Server erstellen.'),
        prog,
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Datei'), h('th', { class: 'r' }, 'Größe'), h('th', {}, 'Erstellt'), h('th', {}))), rows))),
  );
  await load();
}

/* ---------- Einstellungen ---------- */

async function viewSettings(tab) {
  const body = h('div');
  const tabs = [['connection', 'Verbindung'], ['backups', 'Backups']];
  $app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Einstellungen')),
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('a', { href: `#/settings/${k}`, class: k === tab ? 'active' : '' }, l))),
    body,
  );
  if (tab === 'backups') await sBackups(body);
  else await sConnection(body);
}

const section = (title, desc, ...content) =>
  h('div', { class: 'set-sec' }, h('div', { class: 'lead' }, h('b', {}, title), h('span', {}, desc)), h('div', {}, content));

const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint && h('small', {}, hint));
const stateRow = (label, ok, text) => h('div', { class: 'state-row' }, h('span', { class: 'lbl' }, label), h('span', { class: `chip ${ok === true ? 'green' : ok === false ? 'red' : ''}` }, text));

async function sConnection(el) {
  await loadConfig(true);
  const a = S.cfg.api;
  const v = S.cfg.volumes;
  const SRC = { ui: 'aus den Einstellungen', env: 'aus der Compose (CRAFTY_URL)', default: 'Standardwert' };
  const urlIn = h('input', { value: a.urlSource === 'ui' ? a.url : '', placeholder: a.envUrl, autocomplete: 'off' });
  const tokIn = h('input', { type: 'password', placeholder: a.tokenSource === 'none' ? 'API-Token einfügen' : 'Gesetzt – leer lassen, um beizubehalten', autocomplete: 'off' });
  const result = h('div');

  const test = guard(async () => {
    result.replaceChildren(h('div', { class: 'progress' }, h('span', { class: 'spinner' }), 'Teste Verbindung …'));
    const r = await send('POST', '/settings/crafty/test', { url: urlIn.value, token: tokIn.value });
    result.replaceChildren(
      h('div', { class: 'result ' + (r.ok ? 'ok' : 'err') }, r.ok ? `Verbunden mit ${r.url} – ${r.serverCount} Server gefunden.` : r.error),
      h('div', { class: 'steps' }, (r.steps || []).map((s) => h('div', { class: 'step ' + (s.ok ? 'ok' : 'err') }, ico(s.ok ? 'check' : 'x', 14), h('b', {}, s.name), h('span', {}, s.detail)))),
    );
  });
  const save = guard(async () => {
    await send('PUT', '/settings/crafty', { url: urlIn.value, token: tokIn.value });
    toast('Gespeichert');
    await route();
  });
  const clearTok = guard(async () => {
    await send('PUT', '/settings/crafty', { clearToken: true });
    toast('Token entfernt');
    await route();
  });

  el.append(
    h('div', { class: 'panel' },
      section('Dateizugriff (Volumes)', 'Pflicht. Darüber liest und bearbeitet Craftynos Server, Spieler, Whitelist, Properties, Dateien und Backups.',
        stateRow(`${v.root}/servers`, v.serversDirOk, v.serversDirOk ? 'gemountet' : 'nicht gefunden'),
        stateRow(`${v.root}/backups`, v.backupsDirOk, v.backupsDirOk ? 'gemountet' : 'nicht gefunden'),
        stateRow('Crafty-Datenbank (Servernamen)', v.db ? !v.dbError : false, v.db ? (v.dbError ? 'nicht lesbar' : 'gefunden') : '/crafty/app/config mounten'),
        stateRow('Gefundene Server', v.serverCount > 0, String(v.serverCount))),
      section('Crafty-API (optional)', 'Zusätzlich für Start, Stop, Neustart, Konsole und Live-Status. Eingaben hier haben Vorrang vor den Compose-Variablen.',
        field('Crafty-URL', urlIn, `Aktuell wirksam: ${a.url} (${SRC[a.urlSource]})`),
        field('API-Token', tokIn, a.tokenSource === 'none' ? 'In Crafty unter Benutzer → API-Schlüssel erzeugen.' : `Token ist gesetzt (${a.tokenSource === 'ui' ? 'aus den Einstellungen' : 'aus der Compose'}).`),
        h('div', { class: 'btn-row' },
          btn('Verbindung testen', { kind: 'ghost', onclick: test }),
          btn('Speichern', { kind: 'success', onclick: save }),
          a.tokenSource === 'ui' && btn('Token entfernen', { kind: 'ghost danger', onclick: clearTok })),
        result,
        a.configured && !a.ok && a.error && h('div', { class: 'result err' }, `Letzter Fehler: ${a.error}`))),
  );
}

const pad2 = (n) => String(n).padStart(2, '0');
function previewName(fmt) {
  const d = new Date();
  const m = { server: 'Survival', world: 'world', YYYY: d.getFullYear(), MM: pad2(d.getMonth() + 1), DD: pad2(d.getDate()), HH: pad2(d.getHours()), mm: pad2(d.getMinutes()), ss: pad2(d.getSeconds()) };
  m.date = `${m.YYYY}-${m.MM}-${m.DD}`;
  m.time = `${m.HH}-${m.mm}-${m.ss}`;
  const s = String(fmt || '').replace(/\{(\w+)\}/g, (x, k) => (k in m ? m[k] : x)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (s || 'Backup') + '.zip';
}

const TARGET_TYPES = {
  local: { label: 'Ordner / NAS', fields: [['path', 'Zielordner', '/mnt/nas/minecraft', 'text', 'Pfad im Container. Ein NAS bindest du als Volume ein (siehe README).']] },
  webdav: {
    label: 'Nextcloud / WebDAV',
    fields: [
      ['url', 'WebDAV-URL', 'https://cloud.example.com/remote.php/dav/files/BENUTZER/', 'text', 'Nextcloud: unten links in den Dateien unter „Einstellungen“ zu finden.'],
      ['username', 'Benutzername', ''],
      ['password', 'Passwort', '', 'password', 'Ein App-Passwort ist empfohlen.'],
      ['remoteDir', 'Ordner', '/Minecraft-Backups'],
    ],
  },
  sftp: {
    label: 'SFTP',
    fields: [
      ['host', 'Host', '192.168.1.10'],
      ['port', 'Port', '22'],
      ['username', 'Benutzername', ''],
      ['password', 'Passwort', '', 'password'],
      ['remoteDir', 'Ordner', '/volume1/backups'],
    ],
  },
};
const targetDest = (t) => (t.type === 'local' ? t.path : t.type === 'webdav' ? `${t.url}${t.remoteDir || ''}` : `${t.host}:${t.port || 22}${t.remoteDir || ''}`);

function targetModal(existing, onSaved) {
  let type = existing?.type || 'local';
  const nameIn = h('input', { value: existing?.name || '', placeholder: 'z. B. Synology NAS' });
  const autoCb = h('input', { type: 'checkbox', checked: existing ? existing.auto : true });
  const segBox = h('div', { class: 'seg' });
  const fieldsBox = h('div');
  const result = h('div');
  let inputs = {};
  const paint = () => {
    segBox.replaceChildren(...Object.entries(TARGET_TYPES).map(([k, t]) => h('button', { class: k === type ? 'on' : '', onclick: () => ((type = k), paint()) }, t.label)));
    inputs = {};
    fieldsBox.replaceChildren(
      ...TARGET_TYPES[type].fields.map(([k, label, ph, kind, hint]) => {
        const i = h('input', { type: kind || 'text', placeholder: kind === 'password' && existing?.hasPassword ? 'unverändert' : ph || '', value: kind === 'password' ? '' : existing && existing.type === type ? existing[k] || '' : '' });
        inputs[k] = i;
        return field(label, i, hint);
      }),
    );
  };
  paint();
  const collect = () => ({ id: existing?.id, type, name: nameIn.value, auto: autoCb.checked, ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])) });
  const m = modal(existing ? 'Ziel bearbeiten' : 'Ziel hinzufügen',
    h('div', {}, segBox, field('Name', nameIn), fieldsBox,
      h('label', { class: 'checkrow' }, autoCb, 'Neue Backups automatisch hierhin kopieren'), result),
    [
      btn('Testen', { kind: 'ghost', onclick: guard(async () => {
        result.replaceChildren(h('div', { class: 'progress' }, h('span', { class: 'spinner' }), 'Teste …'));
        const r = await send('POST', '/settings/targets/test', collect());
        result.replaceChildren(h('div', { class: 'result ' + (r.ok ? 'ok' : 'err') }, r.ok ? 'Verbindung erfolgreich.' : r.error));
      }) }),
      h('span', { class: 'sp' }),
      btn('Abbrechen', { kind: 'ghost', onclick: () => m.close() }),
      btn('Speichern', { kind: 'success', onclick: guard(async () => {
        await send('POST', '/settings/targets', collect());
        m.close();
        toast('Ziel gespeichert');
        onSaved();
      }) }),
    ]);
}

async function sBackups(el) {
  const cfg = S.cfg.backup;
  const targets = await api('/settings/targets');
  const sync = await api('/settings/sync');

  const fmtIn = h('input', { value: cfg.format, class: 'mono' });
  const prev = h('div', { class: 'preview' }, previewName(cfg.format));
  fmtIn.addEventListener('input', () => (prev.textContent = previewName(fmtIn.value)));
  const folderCb = h('input', { type: 'checkbox', checked: cfg.includeFolder !== false });
  const chips = ['{server}', '{world}', '{date}', '{time}', '{YYYY}', '{MM}', '{DD}', '{HH}', '{mm}', '{ss}'].map((c) =>
    h('button', { onclick: () => (fmtIn.setRangeText(c, fmtIn.selectionStart ?? fmtIn.value.length, fmtIn.selectionEnd ?? fmtIn.value.length, 'end'), fmtIn.dispatchEvent(new Event('input')), fmtIn.focus()) }, c));

  const saveFmt = guard(async () => {
    S.cfg.backup = await send('PUT', '/settings/backup', { format: fmtIn.value, includeFolder: folderCb.checked });
    toast('Gespeichert');
  });
  const reset = () => ((fmtIn.value = '{server} {date} {time}'), fmtIn.dispatchEvent(new Event('input')));

  const logBox = h('div', { class: 'log' }, sync.log.map((l) => `${new Date(l.t).toLocaleTimeString('de-DE')}  ${l.msg}`).join('\n') || 'Noch keine Übertragungen.');
  const list = h('div', {},
    targets.length
      ? targets.map((t) =>
          h('div', { class: 'target' },
            h('div', { class: 'tinfo' }, h('div', { class: 'tname' }, t.name), h('div', { class: 'tdest' }, `${TARGET_TYPES[t.type].label} · ${targetDest(t)}`)),
            t.auto && h('span', { class: 'chip green' }, 'Auto-Kopie'),
            btn('Bearbeiten', { kind: 'ghost', sm: true, onclick: () => targetModal(t, () => viewSettings('backups')) }),
            btn('', { icon: 'trash', kind: 'ghost danger', sm: true, title: 'Löschen', onclick: guard(async () => {
              if (!confirm(`Ziel „${t.name}“ löschen?`)) return;
              await api(`/settings/targets/${t.id}`, { method: 'DELETE' });
              viewSettings('backups');
            }) })))
      : h('p', { class: 'muted', style: 'margin-top:0' }, 'Noch keine Ziele. Backups liegen nur im Crafty-Backup-Ordner.'));

  el.append(
    h('div', { class: 'panel' },
      section('Backup-Format', 'Gesichert wird immer der World-Ordner (level-name) als ZIP-Datei.',
        field('Dateiname', fmtIn, 'Platzhalter per Klick einfügen. Doppelpunkte und andere unzulässige Zeichen werden automatisch entfernt.'),
        h('div', { class: 'chips-row' }, chips),
        h('div', { class: 'preview' }, 'Vorschau'),
        prev,
        h('label', { class: 'checkrow' }, folderCb, 'World-Ordner im ZIP als Unterordner ablegen'),
        h('div', { class: 'btn-row' }, btn('Speichern', { icon: 'save', kind: 'success', onclick: saveFmt }), btn('Standard', { kind: 'ghost', onclick: reset }))),
      section('Zusätzliche Ziele', 'Kopien der ZIP-Dateien auf ein NAS, Nextcloud oder einen SFTP-Server. Lokal bleibt immer eine Kopie im Crafty-Backup-Ordner.',
        list,
        h('div', { class: 'btn-row', style: 'margin-top:14px' },
          btn('Ziel hinzufügen', { icon: 'plus', onclick: () => targetModal(null, () => viewSettings('backups')) }),
          targets.some((t) => t.auto) && btn('Jetzt abgleichen', { icon: 'cloud', kind: 'ghost', onclick: guard(async () => {
            toast('Abgleich läuft …');
            const r = await send('POST', '/settings/sync/run');
            logBox.textContent = r.log.map((l) => `${new Date(l.t).toLocaleTimeString('de-DE')}  ${l.msg}`).join('\n') || 'Nichts zu übertragen.';
            toast('Abgleich fertig');
          }) })),
        targets.some((t) => t.auto) && h('div', { style: 'margin-top:14px' }, h('h3', {}, 'Letzte Übertragungen'), logBox))),
  );
}

/* ---------- Start ---------- */

window.addEventListener('hashchange', route);
route();
