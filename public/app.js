/* Craftynos – Frontend (ohne Build-Schritt) */

const S = { cfg: null, timers: [] };
const $app = document.getElementById('app');
const $banner = document.getElementById('banner');

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

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, opts);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
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
    toast(e.message, true);
  }
};

function modal(title, body, buttons = []) {
  const close = () => bg.remove();
  const bg = h(
    'div',
    { class: 'modal-bg', onclick: (e) => e.target === bg && close() },
    h(
      'div',
      { class: 'modal' },
      h('div', { class: 'ph' }, h('span', {}, title), h('button', { class: 'btn-gray btn-sm', onclick: close }, '✕')),
      h('div', { class: 'pb' }, body),
      buttons.length ? h('div', { class: 'ph', style: 'border-top:1px solid var(--panel-line);border-bottom:0' }, buttons) : null,
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

const STATUS = {
  online: 'Online',
  offline: 'Offline',
  starting: 'Startet …',
  crashed: 'Abgestürzt',
  updating: 'Aktualisiert …',
  unknown: 'Unbekannt',
};
const statusBadge = (st) =>
  h('span', { class: `st-${st}` }, h('span', { class: 'dot' }), STATUS[st] || st);

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

/* ---------- Konfiguration & Banner ---------- */

async function loadConfig() {
  S.cfg = await api('/config');
  const c = S.cfg.crafty;
  $banner.replaceChildren();
  if (!c.hasToken || !c.ok) {
    $banner.append(
      h(
        'div',
        { class: 'warn' },
        !c.hasToken ? 'Kein Crafty-API-Token hinterlegt. ' : `Crafty nicht erreichbar: ${c.error} `,
        h('a', { href: '#/settings' }, 'Verbindung einrichten'),
      ),
    );
  }
}

/* ---------- Router ---------- */

async function route() {
  clearTimers();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  try {
    if (!S.cfg) await loadConfig();
    if (parts[0] === 'settings') await viewSettings();
    else if (parts[0] === 's' && parts[1]) await viewServer(parts[1], parts[2] || 'overview');
    else await viewList();
  } catch (e) {
    $app.replaceChildren(h('h1', {}, 'Fehler'), h('p', {}, e.message));
  }
}
window.addEventListener('hashchange', route);
route();

/* ---------- Serverliste ---------- */

const doAction = guard(async (id, action, label) => {
  await send('POST', `/servers/${id}/action/${action}`);
  toast(label);
});

function actionButtons(id, st, big = false) {
  const cls = big ? '' : 'btn-sm';
  const stop = (e) => e.stopPropagation();
  const mk = (txt, c, action, label) =>
    h('button', { class: `${c} ${cls}`, onclick: (e) => (stop(e), doAction(id, action, label)) }, txt);
  if (st === 'offline' || st === 'crashed' || st === 'unknown') return [mk('▶ Starten', 'btn-green', 'start_server', 'Start angefordert')];
  return [
    mk('■ Stoppen', 'btn-red', 'stop_server', 'Stop angefordert'),
    mk('↻ Neustart', 'btn-orange', 'restart_server', 'Neustart angefordert'),
  ];
}

async function viewList() {
  const grid = h('div', { class: 'grid' });
  $app.replaceChildren(h('h1', {}, 'Deine Server'), grid);
  const load = async () => {
    try {
      const list = await api('/servers');
      grid.replaceChildren(
        ...list.map((s) =>
          h(
            'div',
            { class: `scard st-${s.status}`, onclick: () => (location.hash = `#/s/${s.id}`) },
            h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('b', { style: 'font-size:18px' }, s.name), statusBadge(s.status)),
            h('div', { class: 'row' }, `👥 ${s.online}/${s.max || '–'}`, s.version && `· ${s.version}`, s.port && `· Port ${s.port}`),
            h('div', { class: 'row' }, `CPU ${s.cpu ?? 0}% · RAM ${s.mem || '–'}`),
            h('div', { class: 'actions' }, actionButtons(s.id, s.status)),
          ),
        ),
      );
      if (!list.length) grid.append(h('p', { class: 'muted' }, 'Keine Server in Crafty gefunden.'));
    } catch (e) {
      grid.replaceChildren(h('p', { class: 'muted' }, e.message));
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
  const head = h('div', { class: 'shead' });
  const paintHead = () =>
    head.replaceChildren(h('h1', {}, info.name), statusBadge(info.status), h('span', { class: 'sp', style: 'flex:1' }), actionButtons(id, info.status, true));
  paintHead();
  const body = h('div');
  $app.replaceChildren(
    h('a', { href: '#/' }, '← Alle Server'),
    head,
    h('div', { class: 'tabs' }, TABS.map(([k, label]) => h('a', { href: `#/s/${id}/${k}`, class: k === tab ? 'active' : '' }, label))),
    body,
  );
  const refresh = async () => {
    try {
      info = await api(`/servers/${id}`);
      paintHead();
      hooks.onInfo?.(info);
    } catch {
      /* nächster Versuch */
    }
  };
  every(refresh, 4000);
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
        ['Spieler', `${i.online}/${i.max || '–'}`],
        ['Version', i.version || '–'],
        ['CPU', `${i.cpu}%`],
        ['RAM', i.mem || '–'],
        ['Welt', i.worldSize || '–'],
        ['Port', i.port || '–'],
      ].map(([k, v]) => h('div', { class: 'tile' }, h('small', {}, k), h('b', {}, v))),
    );
  paint(info);
  hooks.onInfo = paint;

  const con = h('div', { class: 'console' });
  const input = h('input', { placeholder: 'Befehl, z. B. say Hallo (ohne /)', onkeydown: (e) => e.key === 'Enter' && run() });
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
      con.textContent = lines.join('\n');
      if (atBottom) con.scrollTop = con.scrollHeight;
    } catch (e) {
      con.textContent = e.message;
    }
  };
  el.append(
    tiles,
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'Konsole'), h('div', { class: 'pb' }, con, h('div', { class: 'cmd' }, input, h('button', { onclick: run }, 'Senden')))),
  );
  await loadLogs();
  con.scrollTop = con.scrollHeight;
  every(loadLogs, 3000);
}

/* --- Spieler & Inventar --- */

async function tPlayers(id, info, el) {
  const list = h('div', { class: 'plist' });
  const detail = h('div');
  el.append(
    h(
      'div',
      { class: 'pl-layout' },
      h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'Spieler', h('span', { class: 'sp' }), h('button', { class: 'btn-sm', onclick: () => load() }, '↻')), list),
      detail,
    ),
  );
  let selected = null;
  const load = guard(async () => {
    const players = await api(`/servers/${id}/players`);
    list.replaceChildren(
      ...players.map((p) =>
        h(
          'div',
          { class: 'pitem' + (p.uuid === selected ? ' sel' : ''), onclick: () => ((selected = p.uuid), load(), showPlayer(p)) },
          h('img', { src: headUrl(p.uuid), alt: '' }),
          h('div', { style: 'flex:1;min-width:0' }, h('b', {}, p.name || p.uuid.slice(0, 8)), h('div', { class: 'muted', style: 'font-size:12px' }, p.hasData ? '' : 'keine Spielerdaten')),
          p.online && h('span', { class: 'badge green' }, 'online'),
          p.op && h('span', { class: 'badge orange' }, 'OP'),
          p.banned && h('span', { class: 'badge red' }, 'gebannt'),
        ),
      ),
    );
    if (!players.length) list.append(h('div', { class: 'pb muted' }, 'Noch keine Spieler bekannt.'));
  });
  const showPlayer = guard(async (p) => {
    detail.replaceChildren(h('p', { class: 'muted' }, 'Lade …'));
    const d = await api(`/servers/${id}/players/${p.uuid}`);
    detail.replaceChildren(playerView(p, d));
  });
  await load();
}

const GM = ['Überleben', 'Kreativ', 'Abenteuer', 'Zuschauer'];
const dimName = (d) => (d ? d.replace('minecraft:', '') : '');
const posStr = (p) => (p ? `X ${p[0]}  Y ${p[1]}  Z ${p[2]}` : '–');

function playerView(p, d) {
  const out = h('div');
  out.append(
    h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'phead' },
        h('img', { src: headUrl(p.uuid), alt: '' }),
        h('div', {}, h('h2', { style: 'font-size:24px' }, p.name || p.uuid), h('div', { class: 'muted mono', style: 'font-size:12px' }, p.uuid)),
        h('span', { style: 'flex:1' }),
        p.online && h('span', { class: 'badge green' }, 'Online'),
      ),
    ),
  );
  if (!d.hasData) out.append(h('p', { class: 'muted' }, 'Für diesen Spieler liegen noch keine Spielerdaten (NBT) vor.'));
  else {
    const hp = d.health ?? 20;
    const hearts = [...Array(10)].map((_, i) => h('span', { class: hp >= (i + 1) * 2 ? '' : hp > i * 2 ? '' : 'off', style: hp === i * 2 + 1 ? 'opacity:.55' : '' }, '❤'));
    const foods = [...Array(10)].map((_, i) => h('span', { class: d.food > i * 2 ? '' : 'off', style: d.food > i * 2 ? '' : 'opacity:.25;filter:grayscale(1)' }, '🍗'));
    out.append(
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'ph' }, 'Leben und Erfahrung'),
        h(
          'div',
          { class: 'pb' },
          h('div', { style: 'text-align:center;font-weight:700;margin-bottom:4px' }, `Level ${d.xpLevel}`),
          h('div', { class: 'xpbar' }, h('i', { style: `width:${Math.round((d.xpProgress || 0) * 100)}%` })),
          h('div', { class: 'hearts', style: 'margin-top:14px' }, hearts, h('span', { class: 'muted', style: 'font-size:13px;margin-left:8px' }, `${hp / 2} / 10`)),
          h('div', { class: 'hearts food', style: 'margin-top:6px;font-size:18px' }, foods),
        ),
      ),
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'ph' }, 'Informationen'),
        h(
          'div',
          { class: 'pb' },
          h('div', { class: 'tiles', style: 'margin:0' }, [
            ['Spielmodus', GM[d.gameMode] ?? d.gameMode],
            ['Aktuelle Position', `${posStr(d.pos)}\n${dimName(d.dimension)}`],
            ['Respawn', d.spawn ? posStr(d.spawn) : '–'],
            ['Letzter Tod', d.lastDeath ? `${posStr(d.lastDeath.pos)}\n${dimName(d.lastDeath.dimension)}` : '–'],
          ].map(([k, v]) => h('div', { class: 'tile', style: 'background:var(--panel-2);white-space:pre-line' }, h('small', {}, k), h('b', { style: 'font-size:14px' }, v)))),
          h('p', { class: 'muted', style: 'font-size:12px;margin:10px 0 0' }, `Spielerdaten gespeichert: ${fmtDate(d.updated)} (der Server schreibt sie beim Speichern/Ausloggen)`),
        ),
      ),
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
  const showInv = () => grid.replaceChildren(...[...range(9, 36), ...range(0, 9)].map((n) => slotEl(inv.get(n))));
  const showEnder = () => grid.replaceChildren(...range(0, 27).map((n) => slotEl(ender.get(n))));
  showInv();
  const btnInv = h('button', { class: 'btn-sm', onclick: () => (showInv(), (armor.style.display = '')) }, 'Inventar');
  const btnEnder = h('button', { class: 'btn-sm btn-gray', onclick: () => (showEnder(), (armor.style.display = 'none')) }, `Endertruhe (${ender.size})`);
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'ph' }, 'Inventar', h('span', { class: 'sp' }), btnInv, btnEnder),
    h('div', { class: 'pb' }, h('div', { class: 'invwrap' }, armor, grid)),
  );
}
const range = (a, b) => [...Array(b - a)].map((_, i) => a + i);

function statsPanel(s) {
  const col = (title, total, rows, withIcon) =>
    h(
      'div',
      {},
      h('h3', {}, title),
      total != null && h('div', { class: 'sr' }, h('b', { class: 'muted' }, 'Gesamt'), h('span', { style: 'font-weight:700' }, fmtNum(total))),
      rows.map((r) => h('div', { class: 'sr' }, h('span', {}, withIcon && icon(r.id), pretty(r.id)), h('span', {}, fmtNum(r.count)))),
    );
  const D = s.distances;
  const dist = [
    ['Strecke gelaufen', D.walk],
    ['Strecke gesprintet', D.sprint],
    ['Strecke gefallen', D.fall],
    ['Strecke in Boot gefahren', D.boat],
    ['Strecke geschwommen', D.swim],
    ['Strecke auf Wasser gelaufen', D.walkOnWater],
    ['Strecke unter Wasser gelaufen', D.walkUnderWater],
    ['Strecke geklettert', D.climb],
    ['Strecke geschlichen', D.crouch],
  ].filter(([, v]) => v);
  const big = (t, v) => h('div', { class: 'bigstat' }, h('b', {}, t), v);
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'ph' }, 'Statistiken'),
    h(
      'div',
      { class: 'pb' },
      h('div', { class: 'statgrid', style: 'margin-bottom:24px' }, big('Spielzeit', fmtTicks(s.playTimeTicks)), big('Spieler Kills', fmtNum(s.playerKills)), big('Tode', fmtNum(s.deaths)), big('K/D', s.deaths ? (s.playerKills / s.deaths).toFixed(2) : fmtNum(s.playerKills))),
      h(
        'div',
        { class: 'statgrid' },
        h('div', {}, h('h3', {}, 'Strecke zurückgelegt (in Blöcken)'), h('div', { class: 'sr' }, h('b', { class: 'muted' }, 'Gesamt'), h('span', { style: 'font-weight:700' }, fmtNum(D.total))), dist.map(([k, v]) => h('div', { class: 'sr' }, h('span', {}, k), h('span', {}, fmtNum(v))))),
        col('Blöcke abgebaut', s.mined.total, s.mined.top, true),
        col('Items verwendet', s.used.total, s.used.top, true),
        col('Entities getötet', s.killed.total, s.killed.top, false),
      ),
    ),
  );
}

/* --- Whitelist --- */

async function tWhitelist(id, info, el) {
  const rows = h('tbody');
  const input = h('input', { placeholder: 'Spielername', onkeydown: (e) => e.key === 'Enter' && add() });
  const paint = (list) =>
    rows.replaceChildren(
      ...list.map((p) =>
        h('tr', {}, h('td', {}, h('img', { src: headUrl(p.uuid), style: 'width:24px;height:24px;vertical-align:middle;margin-right:8px;image-rendering:pixelated' }), p.name), h('td', { class: 'mono muted' }, p.uuid), h('td', { class: 'r' }, h('button', { class: 'btn-red btn-sm', onclick: () => remove(p.name) }, 'Entfernen'))),
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
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'ph' }, 'Whitelist', h('span', { class: 'sp' }), info.whitelistEnabled ? h('span', { class: 'badge green' }, 'aktiv') : h('span', { class: 'badge red' }, 'in den Properties deaktiviert')),
      h(
        'div',
        { class: 'pb' },
        h('div', { class: 'row-form' }, input, h('button', { class: 'btn-green', onclick: add }, '+ Hinzufügen')),
        h('p', { class: 'muted', style: 'font-size:12px' }, 'Läuft der Server, wird per Konsole (/whitelist add|remove) live geändert, sonst direkt die whitelist.json bearbeitet.'),
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'UUID'), h('th', {}))), rows),
      ),
    ),
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
  const set = (k, v) => ((dirty[k] = String(v)), (vals[k] = String(v)), (keyEls[k].textContent = `${k}=${vals[k]}`));
  const keyEls = {};

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
    return h('div', { class: 'prop', style: wide ? 'grid-column:1/-1' : '' }, h('div', { class: 'top2' }, h('label', {}, label), control(k, type, opts?.invert ? null : opts, opts?.invert)), keyEls[k]);
  };

  const known = META.filter(([k]) => k in vals);
  const knownKeys = new Set(META.map(([k]) => k));
  const other = entries.filter((e) => !knownKeys.has(e.key));
  const guessType = (v) => (v === 'true' || v === 'false' ? 'bool' : /^-?\d+$/.test(v) ? 'number' : 'text');

  el.append(
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'server.properties', h('span', { class: 'sp' }), info.running && h('span', { class: 'badge orange' }, 'Server läuft – Änderungen greifen nach Neustart')), h('div', { class: 'pb' }, h('div', { class: 'pgrid', style: 'color:var(--text)' }, known.map(([k, l, t, o, w]) => card(k, l, t, t === 'bool' ? o : o, w))))),
    h('details', { class: 'panel' }, h('summary', { class: 'ph', style: 'cursor:pointer' }, `Erweitert (${other.length})`), h('div', { class: 'pb' }, h('div', { class: 'pgrid', style: 'color:var(--text)' }, other.map((e) => card(e.key, e.key, guessType(e.value), null, false))))),
    h(
      'div',
      { class: 'savebar' },
      h('button', { class: 'btn-green', onclick: guard(async () => {
        if (!Object.keys(dirty).length) return toast('Keine Änderungen');
        await send('PUT', `/servers/${id}/properties`, { values: dirty });
        Object.keys(dirty).forEach((k) => delete dirty[k]);
        toast('Gespeichert – Server neu starten, damit es wirksam wird');
      }) }, '💾 Speichern'),
    ),
  );
}

/* --- Dateien --- */

async function tFiles(id, info, el) {
  let cwd = '';
  const body = h('div');
  const crumbs = h('div', { class: 'crumbs' });
  const q = (p) => encodeURIComponent(p);
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
    const text = await api(`/servers/${id}/files/content?path=${q(path)}`);
    const ta = h('textarea', { spellcheck: 'false' });
    ta.value = text;
    const m = modal(path, ta, [
      h('button', { class: 'btn-green', onclick: guard(async () => {
        await api(`/servers/${id}/files/content?path=${q(path)}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: ta.value });
        toast('Gespeichert');
        m.close();
      }) }, 'Speichern'),
    ]);
  });

  const load = guard(async () => {
    const list = await api(`/servers/${id}/files?path=${q(cwd)}`);
    const segs = cwd ? cwd.split('/') : [];
    crumbs.replaceChildren(
      h('a', { onclick: () => ((cwd = ''), load()) }, '📁 Server'),
      ...segs.map((s, i) => [' / ', h('a', { onclick: () => ((cwd = segs.slice(0, i + 1).join('/')), load()) }, s)]),
    );
    body.replaceChildren(
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', { class: 'r' }, 'Größe'), h('th', {}, 'Geändert'), h('th', {}))),
        h('tbody', {},
          cwd && h('tr', { class: 'clickable', onclick: () => ((cwd = segs.slice(0, -1).join('/')), load()) }, h('td', { colspan: 4 }, '⬆ ..')),
          list.map((f) => {
            const p = join(cwd, f.name);
            return h('tr', { class: f.dir ? 'clickable' : '', onclick: f.dir ? () => ((cwd = p), load()) : null },
              h('td', {}, f.dir ? '📁 ' : '📄 ', f.name),
              h('td', { class: 'r muted' }, fmtBytes(f.size)),
              h('td', { class: 'muted' }, fmtDate(f.mtime)),
              h('td', { class: 'r', onclick: (e) => e.stopPropagation() },
                !f.dir && h('button', { class: 'btn-sm btn-gray', onclick: () => edit(p) }, 'Bearbeiten'),
                !f.dir && h('a', { class: 'btn btn-sm', href: `/api/servers/${id}/files/download?path=${q(p)}` }, '⬇'),
                h('button', { class: 'btn-sm btn-red', onclick: guard(async () => {
                  if (!confirm(`„${f.name}" wirklich löschen?`)) return;
                  await api(`/servers/${id}/files?path=${q(p)}`, { method: 'DELETE' });
                  load();
                }) }, '🗑')));
          }))),
    );
  });

  el.append(
    h('div', { class: 'panel' },
      h('div', { class: 'ph' }, crumbs, h('span', { class: 'sp' }),
        h('button', { class: 'btn-sm', onclick: () => fileInput.click() }, '⬆ Hochladen'),
        h('button', { class: 'btn-sm btn-gray', onclick: guard(async () => {
          const n = prompt('Name des neuen Ordners');
          if (!n) return;
          await send('POST', `/servers/${id}/files/mkdir?path=${q(join(cwd, n))}`);
          load();
        }) }, '+ Ordner'),
        fileInput),
      h('div', { class: 'pb' }, body)),
  );
  await load();
}

/* --- Backups --- */

async function tBackups(id, info, el) {
  const targets = await api('/settings/targets');
  const q = encodeURIComponent;
  const sel = h('select', {}, targets.map((t) => h('option', { value: t.id }, `${t.name} (${t.type})`)));
  const rows = h('tbody');
  const load = guard(async () => {
    const list = await api(`/servers/${id}/backups`);
    rows.replaceChildren(
      ...list.map((f) =>
        h('tr', {}, h('td', {}, f.rel), h('td', { class: 'r' }, fmtBytes(f.size)), h('td', {}, fmtDate(f.mtime)),
          h('td', { class: 'r' },
            h('a', { class: 'btn btn-sm', href: `/api/servers/${id}/backups/download?path=${q(f.rel)}` }, '⬇'),
            targets.length > 0 && h('button', { class: 'btn-sm btn-gray', title: 'Auf ausgewähltes Ziel kopieren', onclick: guard(async () => {
              toast('Upload gestartet …');
              await send('POST', `/servers/${id}/backups/upload`, { path: f.rel, targetId: sel.value });
              toast('Auf Ziel kopiert');
            }) }, '☁'),
            h('button', { class: 'btn-sm btn-red', onclick: guard(async () => {
              if (!confirm('Backup wirklich löschen?')) return;
              await api(`/servers/${id}/backups?path=${q(f.rel)}`, { method: 'DELETE' });
              load();
            }) }, '🗑'))),
      ),
    );
    if (!list.length) rows.append(h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'Noch keine Backups.')));
  });
  el.append(
    h('div', { class: 'panel' },
      h('div', { class: 'ph' }, 'Backups', h('span', { class: 'sp' }),
        targets.length ? ['Ziel: ', sel] : h('a', { href: '#/settings' }, 'Backup-Ziel einrichten'),
        h('button', { class: 'btn-sm', onclick: () => load() }, '↻'),
        h('button', { class: 'btn-green btn-sm', onclick: guard(async () => {
          await send('POST', `/servers/${id}/action/backup_server`);
          toast('Backup in Crafty gestartet');
          setTimeout(load, 5000);
        }) }, '+ Backup jetzt erstellen')),
      h('div', { class: 'pb' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Datei'), h('th', { class: 'r' }, 'Größe'), h('th', {}, 'Erstellt'), h('th', {}))), rows))),
  );
  await load();
}

/* ---------- Einstellungen ---------- */

const TARGET_FIELDS = {
  local: [['path', 'Zielordner (z. B. gemountetes NAS: /mnt/nas/backups)']],
  webdav: [
    ['url', 'WebDAV-URL (Nextcloud: https://cloud.example.com/remote.php/dav/files/USER/)'],
    ['username', 'Benutzer'],
    ['password', 'Passwort / App-Passwort', 'password'],
    ['remoteDir', 'Ordner (z. B. /Minecraft-Backups)'],
  ],
  sftp: [
    ['host', 'Host'],
    ['port', 'Port (22)'],
    ['username', 'Benutzer'],
    ['password', 'Passwort', 'password'],
    ['remoteDir', 'Ordner (z. B. /volume1/backups)'],
  ],
};

async function viewSettings() {
  await loadConfig();
  const c = S.cfg.crafty;
  const urlIn = h('input', { value: c.url, style: 'width:100%' });
  const tokIn = h('input', { type: 'password', placeholder: c.hasToken ? '•••••••• (gesetzt)' : 'API-Token aus Crafty (Profil → API-Schlüssel)', style: 'width:100%' });

  const conn = h('div', { class: 'panel' },
    h('div', { class: 'ph' }, 'Crafty-Verbindung', h('span', { class: 'sp' }), c.ok ? h('span', { class: 'badge green' }, 'verbunden') : h('span', { class: 'badge red' }, 'nicht verbunden')),
    h('div', { class: 'pb' },
      h('div', { class: 'form-grid' }, h('label', {}, 'Crafty-URL', urlIn), h('label', {}, 'API-Token', tokIn)),
      c.fromEnv && h('p', { class: 'muted' }, 'Token kommt aus der Umgebungsvariable CRAFTY_API_TOKEN und hat Vorrang.'),
      h('p', {}, h('button', { onclick: guard(async () => {
        await send('PUT', '/settings/crafty', { url: urlIn.value.trim(), token: tokIn.value.trim() });
        await loadConfig();
        toast(S.cfg.crafty.ok ? 'Verbunden' : 'Gespeichert, aber keine Verbindung: ' + S.cfg.crafty.error, !S.cfg.crafty.ok);
        viewSettings();
      }) }, 'Speichern & testen'))),
  );

  // Backup-Ziele
  const targets = await api('/settings/targets');
  const typeSel = h('select', {}, [['local', 'Lokaler Ordner / NAS-Mount'], ['webdav', 'Nextcloud / WebDAV'], ['sftp', 'SFTP (NAS, Server)']].map(([v, l]) => h('option', { value: v }, l)));
  const nameIn = h('input', { placeholder: 'Name, z. B. Synology' });
  const autoCb = h('input', { type: 'checkbox' });
  const fieldsBox = h('div', { class: 'form-grid' });
  let inputs = {};
  const paintFields = () => {
    inputs = {};
    fieldsBox.replaceChildren(...TARGET_FIELDS[typeSel.value].map(([k, l, t]) => (inputs[k] = h('input', { type: t || 'text' }), h('label', {}, l, inputs[k]))));
  };
  typeSel.addEventListener('change', paintFields);
  paintFields();

  const tlist = h('div', {}, targets.length ? '' : h('p', { class: 'muted' }, 'Noch keine Ziele.'),
    targets.map((t) => h('div', { class: 'row-form', style: 'border-bottom:1px solid var(--panel-line);padding-bottom:10px' },
      h('b', {}, t.name), h('span', { class: 'badge blue' }, t.type), t.auto && h('span', { class: 'badge green' }, 'Auto-Sync'),
      h('span', { class: 'muted' }, t.path || t.url || t.host || ''),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn-sm', onclick: guard(async () => { await send('POST', `/settings/targets/${t.id}/test`); toast('Verbindung OK'); }) }, 'Testen'),
      h('button', { class: 'btn-sm btn-red', onclick: guard(async () => { if (!confirm('Ziel löschen?')) return; await api(`/settings/targets/${t.id}`, { method: 'DELETE' }); viewSettings(); }) }, 'Löschen'))));

  const tp = h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'Backup-Ziele'),
    h('div', { class: 'pb' }, tlist, h('h2', { style: 'margin:18px 0 10px' }, 'Neues Ziel'),
      h('div', { class: 'row-form' }, typeSel, nameIn, h('label', { style: 'display:flex;gap:6px;align-items:center' }, autoCb, 'Neue Backups automatisch hierhin kopieren')),
      fieldsBox,
      h('p', {}, h('button', { class: 'btn-green', onclick: guard(async () => {
        const body = { type: typeSel.value, name: nameIn.value || typeSel.value, auto: autoCb.checked };
        for (const [k, el] of Object.entries(inputs)) body[k] = el.value.trim();
        await send('POST', '/settings/targets', body);
        toast('Ziel gespeichert');
        viewSettings();
      }) }, '+ Ziel speichern'))));

  // Auto-Sync
  const sync = await api('/settings/sync');
  const enCb = h('input', { type: 'checkbox', checked: sync.enabled });
  const ivIn = h('input', { type: 'number', min: 1, value: sync.intervalMin, style: 'width:90px' });
  const sp = h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'Automatischer Backup-Sync'),
    h('div', { class: 'pb' },
      h('div', { class: 'row-form' }, h('label', { style: 'display:flex;gap:6px;align-items:center' }, enCb, 'Aktiv, alle'), ivIn, 'Minuten',
        h('button', { onclick: guard(async () => { await send('PUT', '/settings/sync', { enabled: enCb.checked, intervalMin: ivIn.value }); toast('Gespeichert'); }) }, 'Speichern'),
        h('button', { class: 'btn-gray', onclick: guard(async () => { await send('POST', '/settings/sync/run'); toast('Sync gestartet'); setTimeout(viewSettings, 4000); }) }, 'Jetzt synchronisieren')),
      h('p', { class: 'muted', style: 'font-size:12px' }, 'Kopiert neue Crafty-Backups aller Server auf alle Ziele mit „Auto-Sync".'),
      h('div', { class: 'console', style: 'height:160px' }, sync.log.map((l) => `${new Date(l.t).toLocaleTimeString('de-DE')}  ${l.msg}`).join('\n') || 'Noch keine Aktivität.')));

  $app.replaceChildren(h('h1', {}, 'Einstellungen'), conn, tp, sp);
}
