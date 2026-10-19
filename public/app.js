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
    if (k.nodeType) e.append(k);
    else if (Array.isArray(k)) e.append(...k);
    else e.append(document.createTextNode(String(k)));
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
  chest: 'M3 7l9-4 9 4v12l-9 3-9-3zM3 7l9 4 9-4M12 11v11M7 9v4m10-4v4',
  ender: 'M4 8l8-4 8 4v10l-8 3-8-3zM4 8l8 4 8-4M12 12v9M9 6l6 3M9 15l6 3',
  backpack: 'M6 8V6a6 6 0 0 1 12 0v2M5 8h14v13H5zM8 8v5h8V8M9 17h6',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M11 7h6M11 17h6',
  players: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M16 4.5a3.5 3.5 0 0 1 0 6.8M17 15h1a3 3 0 0 1 3 3v2',
  shield: 'M12 3l8 3v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6zM9 12l2 2 4-4',
  sliders: 'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h9m4 0h3M13 4v4m-2 2v4m6 2v4',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3m6 0h4',
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
const pretty = (id) => id.replace(/^minecraft:/, '').replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
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

const ICON_ALIASES = {
  snow_block: ['snow'],
  grass_block: ['grass_block_side', 'grass'],
  dirt_path: ['dirt_path_side', 'dirt'],
  crafting_table: ['crafting_table_front', 'oak_planks'],
  furnace: ['furnace_front', 'furnace'],
  blast_furnace: ['blast_furnace_front', 'furnace'],
  smoker: ['smoker_front', 'furnace'],
  chest: ['oak_planks'],
  trapped_chest: ['oak_planks'],
  ender_chest: ['obsidian'],
  barrel: ['barrel_side', 'oak_planks'],
  tnt: ['tnt_side'],
  bookshelf: ['bookshelf'],
  pumpkin: ['pumpkin_side'],
  melon: ['melon_side'],
  hay_block: ['hay_block_side'],
  sandstone: ['sandstone'],
  farmland: ['farmland'],
  short_grass: ['grass'],
  tall_grass: ['tall_grass_top', 'grass'],
  oak_door: ['oak_door_bottom', 'oak_planks'],
  oak_trapdoor: ['oak_trapdoor', 'oak_planks'],
};

function icon(name) {
  const id = name.replace(/^minecraft:/, '');
  const candidates = [id, ...(ICON_ALIASES[id] || [])];
  const urls = [
    S.cfg.icons.item.replace('{name}', id),
    ...candidates.map((candidate) => S.cfg.icons.block.replace('{name}', candidate)),
  ];
  // Fallback auf GitHub Raw, falls der CDN-Host im Browser nicht erreichbar ist.
  for (const url of [...urls]) {
    const mirror = url.replace('https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-assets@master/', 'https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/');
    if (mirror !== url) urls.push(mirror);
  }
  const uniqueUrls = [...new Set(urls)];
  let step = 0;
  const img = h('img', { alt: name, loading: 'lazy' });
  const next = () => step < uniqueUrls.length ? (img.src = uniqueUrls[step++]) : img.replaceWith(h('span', { class: 'txt' }, pretty(id)));
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
    btn(label, { icon, kind, sm, onclick: (e) => {
      e.stopPropagation();
      if (action === 'update_executable' && !confirm('Crafty soll diese Serverinstanz über die in Crafty hinterlegte Update-URL aktualisieren und vorher ein Backup erstellen. Fortfahren?')) return;
      doAction(id, action, msg);
    } });
  if (st === 'offline' || st === 'crashed' || st === 'unknown') return [
    mk('Starten', 'play', 'success', 'start_server', 'Start angefordert'),
    mk('Instanz über Crafty aktualisieren', 'download', 'ghost', 'update_executable', 'Crafty-Update gestartet'),
  ];
  return [mk('Stoppen', 'stop', 'danger', 'stop_server', 'Stop angefordert'), mk('Neustart', 'restart', 'ghost', 'restart_server', 'Neustart angefordert')];
}

async function viewList() {
  const wrap = h('div');
  $app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Deine Server')),
    h('p', { class: 'page-intro' }, 'Verwalte deine Minecraft-Server und behalte ihren Status im Blick.'),
    wrap,
  );
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
              h('div', { class: 'scard-actions' }, ...controls(s.id, s.status, s.api, true))))),
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
  ['overview', 'Übersicht', 'server'],
  ['players', 'Spieler', 'players'],
  ['whitelist', 'Whitelist', 'shield'],
  ['properties', 'Einstellungen', 'sliders'],
  ['files', 'Dateien', 'folder'],
  ['backups', 'Backups', 'cloud'],
];

async function viewServer(id, tab) {
  let info = await api(`/servers/${id}`);
  const hooks = {};
  const head = h('div', { class: 'page-head' });
  const paintHead = () =>
    head.replaceChildren(h('h1', {}, info.name), statusEl(info.status), h('span', { class: 'sp' }), ...controls(id, info.status, info.api, false));
  paintHead();
  const body = h('div');
  const serverNav = h('nav', { class: 'server-nav', 'aria-label': 'Servernavigation' },
    TABS.map(([key, label, iconName]) => h('a', { href: `#/s/${id}/${key}`, class: key === tab ? 'active' : '' }, ico(iconName, 17), h('span', {}, label))));
  $app.replaceChildren(
    h('a', { class: 'back', href: '#/' }, ico('back', 16), 'Alle Server'),
    head,
    h('div', { class: 'server-shell' }, serverNav, body),
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
  const search = h('input', { class: 'player-search', type: 'search', 'aria-label': 'Spieler suchen', placeholder: 'Spieler suchen …', oninput: () => paintList() });
  const count = h('span', { class: 'panel-sub' }, '0 Spieler');
  let playerRows = [];
  const paintList = () => {
    const query = search.value.trim().toLocaleLowerCase('de');
    const filtered = playerRows.filter((p) => (p.name || 'Spieler').toLocaleLowerCase('de').includes(query));
    count.textContent = `${filtered.length} Spieler`;
    list.replaceChildren(...filtered.map((p) =>
      h('button', { type: 'button', class: 'pitem' + (p.uuid === selected ? ' sel' : ''), 'aria-pressed': p.uuid === selected ? 'true' : 'false', onclick: () => ((selected = p.uuid), paintList(), showPlayer(p)) },
        h('img', { src: headUrl(p.uuid), alt: '', loading: 'lazy' }),
        h('div', { class: 'pitem-name' }, h('b', {}, p.name || 'Spieler'), !p.hasData && h('small', {}, 'Keine Spielerdaten')),
        p.online && h('span', { class: 'chip green' }, 'Online'),
        p.op && h('span', { class: 'chip orange' }, 'OP'),
        p.banned && h('span', { class: 'chip red' }, 'Gesperrt')),
    ));
    if (!filtered.length) list.append(h('div', { class: 'list-empty' }, query ? 'Kein passender Spieler.' : 'Noch keine Spieler bekannt.'));
  };
  detail.append(h('div', { class: 'empty player-placeholder' }, h('h2', {}, 'Spieler auswählen'), h('p', {}, 'Wähle links einen Spieler aus, um Status, Inventar und Statistiken zu sehen.')));
  el.append(h('div', { class: 'pl-layout' },
    h('div', { class: 'panel player-list-panel' },
      h('div', { class: 'ph' }, h('span', {}, 'Spieler'), count, h('span', { class: 'sp' }), btn('', { icon: 'restart', kind: 'ghost', sm: true, onclick: () => load(), title: 'Aktualisieren' })),
      h('div', { class: 'player-search-wrap' }, search), list),
    detail));
  let selected = null;
  const load = guard(async () => {
    playerRows = await api(`/servers/${id}/players`);
    paintList();
  });
  const showPlayer = guard(async (p) => {
    detail.replaceChildren(h('p', { class: 'muted' }, 'Lade …'));
    detail.replaceChildren(playerView(p, await api('/servers/' + id + '/players/' + p.uuid), info.api, id, () => showPlayer(p)));
  });
  await load();
}

const GM = ['Überleben', 'Kreativ', 'Abenteuer', 'Zuschauer'];
const dimName = (d) => (d ? pretty(d.replace('minecraft:', '')) : '');
const posStr = (p) => (p ? `X ${p[0]}  Y ${p[1]}  Z ${p[2]}` : '–');

function playerView(p, d, hasApi, serverId, refresh) {
  const out = h('div');
  out.append(
    h('div', { class: 'panel' },
    h('div', { class: 'phead' },
        h('img', { src: headUrl(p.uuid), alt: '' }),
        h('div', {}, h('h2', {}, p.name || 'Spieler'), h('div', { class: 'muted player-subtitle' }, p.name ? 'Spielerprofil' : 'Name nicht verfügbar')),
        h('span', { class: 'sp' }),
        p.online && h('span', { class: 'chip green' }, 'Online'))),
  );
  if (!d.hasData) out.append(h('p', { class: 'muted' }, 'Für diesen Spieler liegen noch keine Spielerdaten vor.'));
  else {
    const hp = Math.max(0, Math.min(20, Number(d.health) || 0));
    const food = Math.max(0, Math.min(20, Number(d.food) || 0));
    const hearts = range(0, 10).map((i) => {
      const on = hp > i * 2;
      const e = h('span', { class: 'heart' + (on ? '' : ' off') }, ico('heart', 20));
      if (hp === i * 2 + 1) e.style.opacity = '.6';
      return e;
    });
    const foods = range(0, 10).map((i) => h('span', { class: 'food' + (food > i * 2 ? '' : ' off') }, ico('food', 18)));
    out.append(
      h('div', { class: 'panel player-vitals' },
        h('div', { class: 'ph' }, 'Leben und Erfahrung'),
        h('div', { class: 'pb' },
          h('div', { class: 'xp-level' }, `Level ${d.xpLevel}`),
          h('div', { class: 'xpbar' }, h('i', { style: `width:${Math.round(Math.max(0, Math.min(1, Number(d.xpProgress) || 0)) * 100)}%` })),
          h('div', { class: 'vitals' }, h('span', { class: 'vital-label' }, 'Leben'), hearts, h('b', { class: 'vital-value' }, `${hp}/20`), h('span', { class: 'sp' }),
            btn('Heilen', { icon: 'heart', kind: 'success', sm: true, title: 'Leben auffüllen', cls: 'vital-action', onclick: guard(async () => {
              const result = await send('POST', '/servers/' + serverId + '/players/' + p.uuid + '/action', { action: 'heal' });
              toast(result.mode === 'offline' ? 'Leben auf 20 gesetzt' : 'Heilung an Crafty gesendet');
              setTimeout(refresh, 350);
            }) })),
          h('div', { class: 'vitals' }, h('span', { class: 'vital-label' }, 'Hunger'), foods, h('b', { class: 'vital-value' }, `${food}/20`), h('span', { class: 'sp' }),
            btn('Füttern', { icon: 'food', kind: 'success', sm: true, title: 'Hunger stillen', cls: 'vital-action', onclick: guard(async () => {
              const result = await send('POST', '/servers/' + serverId + '/players/' + p.uuid + '/action', { action: 'feed' });
              toast(result.mode === 'offline' ? 'Hunger aufgefüllt' : 'Sättigung an Crafty gesendet');
              setTimeout(refresh, 350);
            }) })),
          h('div', { class: 'btn-row player-actions' },
            !hasApi && h('span', { class: 'muted player-action-note' }, 'Ohne Crafty-API muss der Server für Änderungen an Spielerdaten gestoppt sein.'),
            h('label', { class: 'xp-control' }, h('span', {}, 'Erfahrungslevel'), h('input', { type: 'number', min: 0, max: 100000, value: d.xpLevel || 0 })),
            btn('Erfahrung setzen', { kind: 'ghost', sm: true, onclick: guard(async (e) => {
              const input = e?.currentTarget?.parentElement?.querySelector('.xp-control input');
              const levels = Number(input?.value ?? d.xpLevel ?? 0);
              const result = await send('POST', '/servers/' + serverId + '/players/' + p.uuid + '/action', { action: 'xp', levels });
              toast(result.mode === 'offline' ? 'Erfahrungslevel gespeichert' : 'Erfahrungslevel an Crafty gesendet');
              setTimeout(refresh, 350);
            }) })))),
      h('div', { class: 'panel' },
        h('div', { class: 'ph' }, 'Informationen'),
        h('div', { class: 'pb' },
          h('div', { class: 'tiles', style: 'margin:0' },
            [
              ['Spielmodus', GM[d.gameMode] ?? d.gameMode],
              ['Aktuelle Position', `${posStr(d.pos)}\n${dimName(d.dimension)}`],
              ['Respawn', d.spawn ? posStr(d.spawn) : '–'],
              ['Letzter Tod', d.lastDeath ? `${posStr(d.lastDeath.pos)}\n${dimName(d.lastDeath.dimension)}` : '–'],
            ].map(([k, v]) => h('div', { class: 'tile player-info-tile' }, h('small', {}, k), h('b', {}, v)))),
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
  const knownInventorySlots = new Set([...range(0, 36), 100, 101, 102, 103, -106]);
  const overflow = h('div', { class: 'inv-overflow' });
  const showInv = () => {
    const slots = [...range(9, 36), ...range(0, 9)];
    grid.replaceChildren(...slots.map((n) => slotEl(inv.get(n))));
    armor.style.display = '';
    const extras = (d.inventory || []).filter((item) => !knownInventorySlots.has(item.slot));
    overflow.replaceChildren(...extras.map((item) => h('div', { class: 'inv-extra' }, slotEl(item), h('span', {}, `${pretty(item.name)} · Slot ${item.slot}`))));
    overflow.hidden = !extras.length;
  };
  const showEnder = () => {
    const slots = [...range(0, Math.max(27, ...[...ender.keys()].map((n) => n + 1)))];
    grid.replaceChildren(...slots.map((n) => slotEl(ender.get(n))));
    armor.style.display = 'none';
    overflow.hidden = true;
  };
  showInv();
  return h('div', { class: 'panel' },
    h('div', { class: 'ph' }, 'Inventar', h('span', { class: 'sp' }), btn('Inventar', { icon: 'backpack', sm: true, onclick: showInv }), btn(`Endertruhe (${ender.size})`, { icon: 'ender', sm: true, kind: 'ghost', onclick: showEnder })),
    h('div', { class: 'pb' }, h('div', { class: 'invwrap' }, armor, grid), overflow));
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
  const backupCfg = S.cfg.backup;
  const q = encodeURIComponent;
  const sel = h('select', { style: 'height:36px;min-width:180px' },
    h('option', { value: '' }, 'Crafty-Backup-Ordner'),
    targets.map((t) => h('option', { value: t.id, selected: t.auto && !targets.some((x) => x.auto && x.id !== t.id) }, t.name)));
  const excluded = h('input', { type: 'checkbox', checked: (backupCfg.excludedServers || []).includes(id) });
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
      const { jobId } = await send('POST', `/servers/${id}/backups/create`, { targetId: sel.value || undefined });
      await followJob(jobId, prog);
    } finally {
      create.disabled = false;
      prog.replaceChildren();
      load();
    }
  }));
  const saveExclusion = guard(async () => {
    const excludedServers = new Set(backupCfg.excludedServers || []);
    if (excluded.checked) excludedServers.add(id);
    else excludedServers.delete(id);
    S.cfg.backup = await send('PUT', '/settings/backup', { ...backupCfg, excludedServers: [...excludedServers] });
    toast(excluded.checked ? 'Von automatischen Backups ausgenommen' : 'Automatische Backups aktiviert');
  });
  excluded.addEventListener('change', saveExclusion);
  el.append(
    h('div', { class: 'panel' },
      h('div', { class: 'ph' }, 'Backups', h('span', { class: 'panel-sub' }, `Ordner „${info.level}“ als ZIP`), h('span', { class: 'sp' }),
        h('label', { class: 'backup-target-label' }, h('span', {}, 'Ziel'), sel),
        create),
      h('div', { class: 'pb' },
        h('label', { class: 'checkrow' }, excluded, 'Diesen Server von automatischen globalen Backups ausnehmen'),
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
      h('div', { class: 'result ' + (r.ok ? 'ok' : 'err') }, r.ok ? (r.usedUrl ? `Die eingetragene URL ist nicht erreichbar, aber ${r.usedUrl} funktioniert (${r.serverCount} Server). Craftynos verwendet diese Adresse automatisch.` : `Verbunden mit ${r.url} – ${r.serverCount} Server gefunden.`) : r.error),
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
        field('Crafty-URL', urlIn, a.detectedUrl ? `Eingetragene URL nicht erreichbar – verwendet wird automatisch ${a.detectedUrl}. Trage diese Adresse ein, um die Meldung zu beenden.` : `Aktuell wirksam: ${a.url} (${SRC[a.urlSource]})`),
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
  const servers = await api('/servers');

  const fmtIn = h('input', { value: cfg.format, class: 'mono' });
  const prev = h('div', { class: 'preview' }, previewName(cfg.format));
  fmtIn.addEventListener('input', () => (prev.textContent = previewName(fmtIn.value)));
  const folderCb = h('input', { type: 'checkbox', checked: cfg.includeFolder !== false });
  const scheduleEnabled = h('input', { type: 'checkbox', checked: cfg.enabled !== false });
  const scheduleTime = h('input', { type: 'time', value: cfg.time || '03:00' });
  const excludedServers = new Set(cfg.excludedServers || []);
  const chips = ['{server}', '{world}', '{date}', '{time}', '{YYYY}', '{MM}', '{DD}', '{HH}', '{mm}', '{ss}'].map((c) =>
    h('button', { onclick: () => (fmtIn.setRangeText(c, fmtIn.selectionStart ?? fmtIn.value.length, fmtIn.selectionEnd ?? fmtIn.value.length, 'end'), fmtIn.dispatchEvent(new Event('input')), fmtIn.focus()) }, c));

  const saveFmt = guard(async () => {
    S.cfg.backup = await send('PUT', '/settings/backup', { ...cfg, format: fmtIn.value, includeFolder: folderCb.checked });
    toast('Gespeichert');
  });
  const saveSchedule = guard(async () => {
    S.cfg.backup = await send('PUT', '/settings/backup', { ...cfg, enabled: scheduleEnabled.checked, time: scheduleTime.value, excludedServers: [...excludedServers] });
    toast('Zeitplan gespeichert');
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
      section('Automatische globale Backups', 'Einmal täglich werden geänderte Welten zu dieser Uhrzeit gesichert. Laufende Server werden vor dem Backup über Crafty gespeichert.',
        h('label', { class: 'checkrow' }, scheduleEnabled, 'Automatische Backups aktivieren'),
        field('Tägliche Uhrzeit', scheduleTime, 'Es gilt die lokale Zeitzone des Containers (TZ in Docker).'),
        h('div', { class: 'exclude-list' }, servers.map((s) => {
          const checkbox = h('input', { type: 'checkbox', checked: excludedServers.has(s.id) });
          checkbox.addEventListener('change', () => checkbox.checked ? excludedServers.add(s.id) : excludedServers.delete(s.id));
          return h('label', { class: 'checkrow' }, checkbox, s.name || 'Unbenannter Server');
        })),
        h('div', { class: 'btn-row' }, btn('Zeitplan speichern', { icon: 'save', kind: 'success', onclick: saveSchedule }))),
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
