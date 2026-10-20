import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { env, settings, craftyCfg, normalizeUrl, DEFAULT_BACKUP } from './config.js';
import { crafty, normalizeStats, unknownStats, testConnection, diagnose, autodetect, getDetected, resetDetected } from './crafty.js';
import { HttpError, mapPath, safeJoin, listDir, walk, readJson, exists } from './files.js';
import { parseProps, applyProps } from './props.js';
import { knownPlayers, playerDetail, resolveUuid, updateOfflinePlayer } from './players.js';
import { discoverServers, volumeInfo } from './discovery.js';
import { uploadTo, testTarget, publicTarget, runSync, syncLog, setServerProvider } from './backups.js';
import { createWorldBackup } from './zipbackup.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: 'text/plain', limit: '5mb' }));

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ error: e.message || String(e) });
  });

/* ---------- Server-Liste: Crafty-API (optional) + Volumes (immer) ---------- */

let cache = { t: 0, v: null };

async function loadServersUncached() {
  // (Cache und Parallelabfragen werden in loadServers() geregelt)
  let apiList = null;
  let apiError = null;
  if (craftyCfg().token) {
    try {
      apiList = (await crafty.servers()).data || [];
    } catch (e) {
      apiError = e.message;
      // Nicht erreichbar? Typische Alternativadressen (Service-Name, host.docker.internal, Gateway) probieren.
      if (!/Token ung/.test(e.message) && (await autodetect(craftyCfg()).catch(() => false))) {
        try {
          apiList = (await crafty.servers()).data || [];
          apiError = null;
        } catch (e2) {
          apiError = e2.message;
        }
      }
    }
  }
  const disk = await discoverServers().catch(() => []);
  const diskMap = new Map(disk.map((d) => [d.server_id, d]));
  const list = (apiList ?? disk).map((s) => {
    const discovered = diskMap.get(String(s.server_id || '')) || {};
    const merged = { ...discovered, ...s };
    merged.server_id = String(merged.server_id || s.server_id || '');
    const apiName = plainText(s.server_name);
    const discoveredName = plainText(discovered.server_name);
    merged.server_name = (apiName && !isServerIdName(apiName) ? apiName : '') ||
      (discoveredName && !isServerIdName(discoveredName) ? discoveredName : '') || 'Minecraft-Server';
    merged.type = plainText(merged.type);
    merged.path = s.path || diskMap.get(s.server_id)?.path || path.join(env.craftyRoot, 'servers', s.server_id);
    merged._dir = mapPath(merged.path);
    const bp = merged.backup_path;
    const mappedBp = bp ? mapPath(bp) : null;
    merged._backupDir = mappedBp && fs.existsSync(mappedBp) ? mappedBp : path.join(env.craftyRoot, 'backups', s.server_id);
    return merged;
  });
  cache = { t: Date.now(), v: { list, api: apiList !== null, apiError, serverCount: list.length } };
  return cache.v;
}
// Ist die API nicht erreichbar, wird das Ergebnis 20 s gemerkt, damit nicht jede Anfrage in einen Timeout läuft.
let inflight = null;
async function loadServers(force = false) {
  const ttl = cache.v?.api ? 6000 : 20000;
  if (!force && cache.v && Date.now() - cache.t < ttl) return cache.v;
  inflight ??= loadServersUncached().finally(() => (inflight = null));
  return !force && cache.v ? cache.v : inflight; // veraltete Daten sofort liefern, im Hintergrund erneuern
}
setServerProvider(async () => (await loadServers()).list);

async function ctx(id) {
  let { list } = await loadServers();
  let s = list.find((x) => x.server_id === id);
  if (!s) s = (await loadServers(true)).list.find((x) => x.server_id === id);
  if (!s) throw new HttpError(404, 'Server nicht gefunden');
  if (!s._dir || !(await exists(s._dir)))
    throw new HttpError(500, `Serverordner nicht erreichbar (${s.path}). Das Volume /crafty/servers muss in Craftynos gemountet sein (siehe README).`);
  return { server: s, dir: s._dir };
}

async function requireApi() {
  if (!(await loadServers()).api) throw new HttpError(409, 'Dafür wird die Crafty-API benötigt (Einstellungen → Verbindung).');
}

async function propsOf(dir) {
  try {
    return parseProps(await fsp.readFile(path.join(dir, 'server.properties'), 'utf8'));
  } catch {
    return [];
  }
}
const prop = (entries, key, def) => entries.find((e) => e.key === key)?.value ?? def;
const plainText = (value, fallback = '') => {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const text = String(value).trim();
  return !text || /^(false|null|undefined|\[object .+\])$/i.test(text) ? fallback : text;
};
const isServerIdName = (value) => /^[0-9a-f]{8}(?:-[0-9a-f-]{27})?$/i.test(String(value || '').trim());

async function stateOf(id) {
  if (!(await loadServers()).api) return unknownStats();
  return normalizeStats(await crafty.stats(id));
}

/* ---------- Allgemein / Verbindung ---------- */

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get(
  '/api/config',
  h(async (_req, res) => {
    const cfg = craftyCfg();
    const r = await loadServers(_req.query.refresh === '1');
    const vol = await volumeInfo();
    res.json({
      mode: r.api ? 'api' : r.serverCount ? 'volumes' : 'none',
      api: {
        configured: Boolean(cfg.token),
        ok: r.api,
        error: r.apiError,
        url: cfg.url,
        detectedUrl: getDetected(cfg),
        urlSource: cfg.urlSource,
        tokenSource: cfg.tokenSource,
        envUrl: cfg.envUrl,
        serverCount: r.api ? r.serverCount : null,
      },
      volumes: vol,
      backup: settings.get().backup,
      icons: { item: env.itemIconUrl, block: env.blockIconUrl, head: env.headUrl },
    });
  }),
);

app.put(
  '/api/settings/crafty',
  h(async (req, res) => {
    const { url, token, clearToken } = req.body || {};
    const cur = settings.get().crafty || {};
    settings.save({
      crafty: {
        url: url === undefined ? cur.url : normalizeUrl(url),
        token: clearToken ? '' : token ? String(token).trim() : cur.token,
      },
    });
    resetDetected();
    cache = { t: 0, v: null };
    res.json({ ok: true });
  }),
);

app.post(
  '/api/settings/crafty/test',
  h(async (req, res) => {
    const base = craftyCfg();
    const { url, token } = req.body || {};
    const cfg = { ...base, url: normalizeUrl(url) || base.url, token: (token && String(token).trim()) || base.token };
    try {
      res.json({ url: cfg.url, ...(await diagnose(cfg)) });
    } catch (e) {
      res.json({ ok: false, url: cfg.url, error: e.message });
    }
  }),
);

app.get('/api/settings/backup', (_req, res) => res.json(settings.get().backup));

app.put('/api/settings/backup', (req, res) => {
  const b = req.body || {};
  const current = settings.get().backup;
  const format = String(b.format ?? current.format ?? '').trim() || DEFAULT_BACKUP.format;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time ?? current.time)) ? String(b.time ?? current.time) : current.time;
  const excludedServers = Array.isArray(b.excludedServers) ? [...new Set(b.excludedServers.map(String))] : current.excludedServers;
  settings.save({ backup: {
    ...current,
    format: format.slice(0, 120),
    includeFolder: b.includeFolder === undefined ? current.includeFolder : b.includeFolder !== false,
    enabled: b.enabled === undefined ? current.enabled !== false : Boolean(b.enabled),
    time,
    excludedServers,
  } });
  res.json(settings.get().backup);
});

/* ---------- Server ---------- */

app.get(
  '/api/servers',
  h(async (_req, res) => {
    const { list, api } = await loadServers();
    const out = await Promise.all(
      list.map(async (s) => {
        const props = s._dir ? await propsOf(s._dir) : [];
        let st;
        try {
          st = await stateOf(s.server_id);
        } catch (e) {
          st = { ...unknownStats(), error: e.message };
        }
        if (!st.max) st.max = Number(prop(props, 'max-players', 0)) || 0;
        const port = st.port || s.server_port || Number(prop(props, 'server-port', 0)) || null;
        return { id: String(s.server_id), name: plainText(s.server_name, s.server_id || 'Unbenannter Server'), type: plainText(s.type), ...st, port, api };
      }),
    );
    res.json(out);
  }),
);

app.get(
  '/api/servers/:id',
  h(async (req, res) => {
    const { server, dir } = await ctx(req.params.id);
    const props = await propsOf(dir);
    const st = await stateOf(server.server_id).catch(() => unknownStats());
    const port = st.port || server.server_port || Number(prop(props, 'server-port', 0)) || null;
    const rawHost = plainText(server.hostname || server.server_ip || server.host || server.ip);
    const host = rawHost && !['0.0.0.0', '::', '*', 'localhost'].includes(rawHost.toLowerCase()) ? rawHost : '';
    res.json({
      id: server.server_id,
      name: plainText(server.server_name, server.server_id || 'Unbenannter Server'),
      type: server.type,
      path: server.path,
      address: host ? (host.includes(':') || !port ? host : `${host}:${port}`) : '',
      level: prop(props, 'level-name', 'world'),
      onlineMode: prop(props, 'online-mode', 'true') === 'true',
      whitelistEnabled: prop(props, 'white-list', 'false') === 'true',
      api: (await loadServers()).api,
      ...st,
      max: st.max || Number(prop(props, 'max-players', 0)) || 0,
      port: st.port || server.server_port || Number(prop(props, 'server-port', 0)) || null,
    });
  }),
);

const ACTIONS = ['start_server', 'stop_server', 'restart_server', 'kill_server', 'update_executable'];
app.post(
  '/api/servers/:id/action/:action',
  h(async (req, res) => {
    if (!ACTIONS.includes(req.params.action)) throw new HttpError(400, 'Unbekannte Aktion');
    await requireApi();
    await crafty.action(req.params.id, req.params.action);
    cache.t = 0;
    res.json({ ok: true });
  }),
);

app.post(
  '/api/servers/:id/command',
  h(async (req, res) => {
    await requireApi();
    const cmd = String(req.body?.command || '').trim().replace(/^\//, '');
    if (!cmd) throw new HttpError(400, 'Leerer Befehl');
    await crafty.stdin(req.params.id, cmd);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/servers/:id/logs',
  h(async (req, res) => {
    const { server, dir } = await ctx(req.params.id);
    if ((await loadServers()).api) {
      const r = await crafty.logs(server.server_id, false);
      return res.json({ lines: Array.isArray(r.data) ? r.data.slice(-500) : [], source: 'api' });
    }
    // Ohne API: letzte Zeilen aus logs/latest.log
    try {
      const text = await fsp.readFile(path.join(dir, 'logs', 'latest.log'), 'utf8');
      res.json({ lines: text.split(/\r?\n/).slice(-500), source: 'file' });
    } catch {
      res.json({ lines: [], source: 'none' });
    }
  }),
);

/* ---------- Spieler / Inventar ---------- */

app.get(
  '/api/servers/:id/players',
  h(async (req, res) => {
    const { server, dir } = await ctx(req.params.id);
    const level = prop(await propsOf(dir), 'level-name', 'world');
    const online = (await stateOf(server.server_id).catch(() => unknownStats())).players;
    res.json(await knownPlayers(dir, level, online));
  }),
);

app.get(
  '/api/servers/:id/players/:uuid',
  h(async (req, res) => {
    const { dir } = await ctx(req.params.id);
    const level = prop(await propsOf(dir), 'level-name', 'world');
    const d = await playerDetail(dir, level, req.params.uuid);
    if (!d) throw new HttpError(400, 'Ungültige UUID');
    res.json(d);
  }),
);

/* ---------- Whitelist ---------- */

app.post(
  '/api/servers/:id/players/:uuid/action',
  h(async (req, res) => {
    const { server, dir } = await ctx(req.params.id);
    const hasApi = (await loadServers()).api;
    const level = prop(await propsOf(dir), 'level-name', 'world');
    const action = req.body?.action;
    const levels = Number(req.body?.levels);
    const gameMode = Number(req.body?.gameMode);
    if (action === 'xp' && (!Number.isInteger(levels) || levels < 0 || levels > 100000))
      throw new HttpError(400, 'Erfahrungslevel müssen zwischen 0 und 100.000 liegen.');
    if (action === 'gamemode' && ![0, 1, 2, 3].includes(gameMode)) throw new HttpError(400, 'Ungültiger Spielmodus');
    if (!['heal', 'feed', 'xp', 'gamemode', 'kill', 'starve'].includes(action)) throw new HttpError(400, 'Unbekannte Spieleraktion');

    if (!hasApi) {
      try {
        if (action === 'kill') throw new Error('Töten ist nur möglich, wenn der Server läuft und mit Crafty verbunden ist.');
        await updateOfflinePlayer(dir, level, req.params.uuid, action, levels, gameMode);
        return res.json({ ok: true, mode: 'offline' });
      } catch (e) {
        throw new HttpError(409, e.message);
      }
    }
    const state = await stateOf(server.server_id);
    if (state.running) {
      const player = (await knownPlayers(dir, level, state.players)).find((p) => p.uuid === req.params.uuid.toLowerCase());
      if (!player?.name || !NAME_RE.test(player.name)) throw new HttpError(404, 'Spielername nicht gefunden');
      if (!player.online && ['heal', 'feed', 'xp', 'gamemode', 'kill', 'starve'].includes(action))
        throw new HttpError(409, 'Der Spieler muss online sein. Für gespeicherte Spielerdaten stoppe den Server zuerst.');
      const commands = {
        // High effect levels fill modded health and food bars as well as vanilla ones.
        heal: `effect give ${player.name} minecraft:instant_health 2 255 true`,
        feed: `effect give ${player.name} minecraft:saturation 2 255 true`,
        xp: `experience set ${player.name} ${levels} levels`,
        gamemode: `gamemode ${['survival', 'creative', 'adventure', 'spectator'][gameMode]} ${player.name}`,
        kill: `kill ${player.name}`,
        starve: `effect give ${player.name} minecraft:hunger 1 255 true`,
      };
      await crafty.stdin(server.server_id, commands[action]);
      return res.json({ ok: true, mode: 'online' });
    }
    try {
      await updateOfflinePlayer(dir, level, req.params.uuid, action, levels, gameMode);
      res.json({ ok: true, mode: 'offline' });
    } catch (e) {
      throw new HttpError(409, e.message);
    }
  }),
);

app.post(
  '/api/servers/:id/players/:uuid/flag',
  h(async (req, res) => {
    const { server, dir } = await ctx(req.params.id);
    const { uuid } = req.params;
    const flag = req.body?.flag;
    const enabled = Boolean(req.body?.enabled);
    if (!['whitelisted', 'op', 'banned'].includes(flag)) throw new HttpError(400, 'Unbekannte Spielereigenschaft');
    const level = prop(await propsOf(dir), 'level-name', 'world');
    const player = (await knownPlayers(dir, level)).find((p) => p.uuid === uuid.toLowerCase());
    if (!player?.name || !NAME_RE.test(player.name)) throw new HttpError(404, 'Spielername nicht gefunden');
    const state = await stateOf(server.server_id).catch(() => unknownStats());
    if (state.running) {
      await requireApi();
      const commands = {
        whitelisted: enabled ? `whitelist add ${player.name}` : `whitelist remove ${player.name}`,
        op: enabled ? `op ${player.name}` : `deop ${player.name}`,
        banned: enabled ? `ban ${player.name}` : `pardon ${player.name}`,
      };
      await crafty.stdin(server.server_id, commands[flag]);
      await new Promise((r) => setTimeout(r, 500));
    } else {
      const files = { whitelisted: 'whitelist.json', op: 'ops.json', banned: 'banned-players.json' };
      const file = path.join(dir, files[flag]);
      const rows = await readJson(file, []);
      const kept = rows.filter((p) => String(p.uuid).toLowerCase() !== uuid.toLowerCase());
      if (enabled) {
        const entry = flag === 'op'
          ? { uuid, name: player.name, level: 4, bypassesPlayerLimit: false }
          : flag === 'banned'
            ? { uuid, name: player.name, created: new Date().toISOString(), source: 'Craftynos', expires: null, reason: 'Banned by an operator' }
            : { uuid, name: player.name };
        kept.push(entry);
      }
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        await fsp.writeFile(temp, JSON.stringify(kept, null, 2));
        await fsp.rename(temp, file);
      } finally {
        await fsp.rm(temp, { force: true }).catch(() => {});
      }
    }
    res.json({ ok: true, flag, enabled });
  }),
);

const NAME_RE = /^[A-Za-z0-9_.\-]{1,32}$/;

app.get(
  '/api/servers/:id/whitelist',
  h(async (req, res) => {
    const { dir } = await ctx(req.params.id);
    res.json(await readJson(path.join(dir, 'whitelist.json'), []));
  }),
);

app.post(
  '/api/servers/:id/whitelist',
  h(async (req, res) => {
    const { server, dir } = await ctx(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!NAME_RE.test(name)) throw new HttpError(400, 'Ungültiger Spielername');
    const st = await stateOf(server.server_id).catch(() => unknownStats());
    if (st.running) {
      await crafty.stdin(server.server_id, `whitelist add ${name}`);
      await new Promise((r) => setTimeout(r, 800));
    } else {
      const onlineMode = prop(await propsOf(dir), 'online-mode', 'true') === 'true';
      const p = await resolveUuid(name, onlineMode);
      if (!p) throw new HttpError(404, `Spieler „${name}“ nicht gefunden`);
      const file = path.join(dir, 'whitelist.json');
      const list = await readJson(file, []);
      if (!list.some((e) => e.uuid === p.uuid)) list.push(p);
      await fsp.writeFile(file, JSON.stringify(list, null, 2));
    }
    res.json(await readJson(path.join(dir, 'whitelist.json'), []));
  }),
);

app.delete(
  '/api/servers/:id/whitelist/:name',
  h(async (req, res) => {
    const { server, dir } = await ctx(req.params.id);
    const name = req.params.name;
    if (!NAME_RE.test(name)) throw new HttpError(400, 'Ungültiger Spielername');
    const st = await stateOf(server.server_id).catch(() => unknownStats());
    if (st.running) {
      await crafty.stdin(server.server_id, `whitelist remove ${name}`);
      await new Promise((r) => setTimeout(r, 800));
    } else {
      const file = path.join(dir, 'whitelist.json');
      const list = (await readJson(file, [])).filter((e) => e.name?.toLowerCase() !== name.toLowerCase());
      await fsp.writeFile(file, JSON.stringify(list, null, 2));
    }
    res.json(await readJson(path.join(dir, 'whitelist.json'), []));
  }),
);

/* ---------- server.properties ---------- */

app.get(
  '/api/servers/:id/properties',
  h(async (req, res) => {
    const { dir } = await ctx(req.params.id);
    const entries = await propsOf(dir);
    if (!entries.length) throw new HttpError(404, 'server.properties nicht gefunden (Server schon einmal gestartet?)');
    res.json({ entries });
  }),
);

app.put(
  '/api/servers/:id/properties',
  h(async (req, res) => {
    const { dir } = await ctx(req.params.id);
    const values = req.body?.values;
    if (!values || typeof values !== 'object') throw new HttpError(400, 'values fehlt');
    const file = path.join(dir, 'server.properties');
    const old = await fsp.readFile(file, 'utf8');
    await fsp.writeFile(file, applyProps(old, values));
    res.json({ ok: true });
  }),
);

/* ---------- Dateien ---------- */

async function fileCtx(req) {
  const { dir } = await ctx(req.params.id);
  return { dir, abs: safeJoin(dir, req.query.path || '') };
}

app.get('/api/servers/:id/files', h(async (req, res) => res.json(await listDir((await fileCtx(req)).abs))));

app.get(
  '/api/servers/:id/files/content',
  h(async (req, res) => {
    const { abs } = await fileCtx(req);
    const st = await fsp.stat(abs);
    if (st.size > 2 * 1024 * 1024) throw new HttpError(413, 'Datei zu groß zum Bearbeiten (max. 2 MB)');
    const buf = await fsp.readFile(abs);
    if (buf.includes(0)) throw new HttpError(415, 'Binärdatei – bitte herunterladen');
    res.type('text/plain').send(buf.toString('utf8'));
  }),
);

app.put(
  '/api/servers/:id/files/content',
  h(async (req, res) => {
    const { abs } = await fileCtx(req);
    if (typeof req.body !== 'string') throw new HttpError(400, 'Text erwartet');
    await fsp.writeFile(abs, req.body);
    res.json({ ok: true });
  }),
);

app.put(
  '/api/servers/:id/files/upload',
  h(async (req, res) => {
    const { abs } = await fileCtx(req);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await pipeline(req, fs.createWriteStream(abs));
    res.json({ ok: true });
  }),
);

app.get('/api/servers/:id/files/download', h(async (req, res) => res.download((await fileCtx(req)).abs)));

app.post(
  '/api/servers/:id/files/mkdir',
  h(async (req, res) => {
    await fsp.mkdir((await fileCtx(req)).abs, { recursive: true });
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/servers/:id/files',
  h(async (req, res) => {
    const { dir, abs } = await fileCtx(req);
    if (path.resolve(abs) === path.resolve(dir)) throw new HttpError(400, 'Serverordner nicht löschbar');
    await fsp.rm(abs, { recursive: true, force: true });
    res.json({ ok: true });
  }),
);

/* ---------- Backups (World-Ordner als ZIP) ---------- */

async function backupCtx(id) {
  const c = await ctx(id);
  return { ...c, root: c.server._backupDir };
}

const autoBackupStateFile = path.join(env.dataDir, 'auto-backups.json');
let autoBackupState = readJsonSync(autoBackupStateFile);
let autoBackupRunning = false;
function readJsonSync(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveAutoBackupState() {
  const tmp = `${autoBackupStateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(autoBackupState, null, 2));
  fs.renameSync(tmp, autoBackupStateFile);
}

async function worldFingerprint(server) {
  const props = await propsOf(server._dir);
  const level = prop(props, 'level-name', 'world');
  const worldDir = safeJoin(server._dir, level);
  const files = await walk(worldDir, 32, 100000);
  const hash = crypto.createHash('sha256');
  for (const f of files) hash.update(`${f.rel}\0${f.size}\0${f.mtime}\n`);
  return { level, signature: hash.digest('hex') };
}

async function runScheduledBackups() {
  const cfg = settings.get().backup;
  if (!cfg.enabled || autoBackupRunning || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.time || '')) return;
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (clock < cfg.time || autoBackupState.lastRunDay === day) return;
  autoBackupRunning = true;
  try {
    const servers = (await loadServers(true)).list;
    const excluded = new Set(cfg.excludedServers || []);
    await runSync({ pruneUploaded: true });
    for (const server of servers) {
      if (excluded.has(String(server.server_id)) || !server._dir || !(await exists(server._dir))) continue;
      try {
        const { level, signature } = await worldFingerprint(server);
        if (autoBackupState.servers?.[server.server_id] === signature) continue;
        const running = (await loadServers()).api && (await stateOf(server.server_id).catch(() => unknownStats())).running;
        await createWorldBackup({ server, dir: server._dir, level, backupDir: server._backupDir, cfg, command: running ? (c) => crafty.stdin(server.server_id, c) : null });
        autoBackupState.servers ??= {};
        autoBackupState.servers[server.server_id] = (await worldFingerprint(server)).signature;
        saveAutoBackupState();
        await runSync({ pruneUploaded: true });
        console.log(`Automatisches Backup erstellt: ${server.server_name || server.server_id}`);
      } catch (e) {
        console.error(`Automatisches Backup für ${server.server_name || server.server_id} fehlgeschlagen:`, e);
      }
    }
    autoBackupState.lastRunDay = day;
    saveAutoBackupState();
  } finally {
    autoBackupRunning = false;
  }
}

app.get(
  '/api/servers/:id/backups',
  h(async (req, res) => {
    const { root } = await backupCtx(req.params.id);
    res.json((await exists(root)) ? await walk(root) : []);
  }),
);

const jobs = new Map();

app.post(
  '/api/servers/:id/backups/create',
  h(async (req, res) => {
    const { server, dir, root } = await backupCtx(req.params.id);
    const level = prop(await propsOf(dir), 'level-name', 'world');
    const job = { id: crypto.randomUUID(), status: 'running', step: 'Startet …', file: null, error: null };
    jobs.set(job.id, job);
    (async () => {
      try {
        let running = false;
        if ((await loadServers()).api) running = (await stateOf(server.server_id).catch(() => unknownStats())).running;
        job.file = await createWorldBackup({
          server,
          dir,
          level,
          backupDir: root,
          cfg: settings.get().backup,
          command: running ? (c) => crafty.stdin(server.server_id, c) : null,
          onStep: (s) => (job.step = s),
        });
        const target = req.body?.targetId && settings.get().targets.find((t) => t.id === req.body.targetId);
        if (req.body?.targetId && !target) throw new HttpError(404, 'Backup-Ziel nicht gefunden');
        let delivered = false;
        if (target && !target.auto) {
          job.step = `Wird auf „${target.name}“ übertragen …`;
          await uploadTo(target, safeJoin(root, job.file), `${server.server_name || server.server_id}/${job.file}`);
          delivered = true;
        }
        if (settings.get().targets.some((t) => t.auto)) {
          job.step = 'Wird an die Backup-Ziele übertragen …';
          const sync = await runSync();
          delivered ||= sync.copiedFiles.includes(`${server.server_id}/${job.file}`);
        }
        if (delivered) await fsp.rm(safeJoin(root, job.file), { force: true });
        job.status = 'done';
        job.step = 'Fertig';
      } catch (e) {
        job.status = 'error';
        job.error = e.message;
      }
      setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000).unref();
    })();
    res.json({ jobId: job.id });
  }),
);

app.get(
  '/api/backup-jobs/:jid',
  h(async (req, res) => {
    const j = jobs.get(req.params.jid);
    if (!j) throw new HttpError(404, 'Job nicht gefunden');
    res.json(j);
  }),
);

app.get(
  '/api/servers/:id/backups/download',
  h(async (req, res) => {
    const { root } = await backupCtx(req.params.id);
    res.download(safeJoin(root, req.query.path || ''));
  }),
);

app.delete(
  '/api/servers/:id/backups',
  h(async (req, res) => {
    const { root } = await backupCtx(req.params.id);
    const abs = safeJoin(root, req.query.path || '');
    if (abs === path.resolve(root)) throw new HttpError(400, 'Ungültiger Pfad');
    await fsp.rm(abs, { recursive: true, force: true });
    res.json({ ok: true });
  }),
);

app.post(
  '/api/servers/:id/backups/upload',
  h(async (req, res) => {
    const { server, root } = await backupCtx(req.params.id);
    const t = settings.get().targets.find((x) => x.id === req.body?.targetId);
    if (!t) throw new HttpError(404, 'Backup-Ziel nicht gefunden');
    const rel = String(req.body?.path || '');
    await uploadTo(t, safeJoin(root, rel), `${server.server_name}/${rel}`);
    res.json({ ok: true });
  }),
);

/* ---------- Backup-Ziele ---------- */

function targetFromBody(b, existing) {
  return {
    id: existing?.id || crypto.randomUUID(),
    type: b.type,
    name: String(b.name || '').slice(0, 60),
    auto: Boolean(b.auto),
    path: b.path?.trim(),
    url: b.url?.trim(),
    host: b.host?.trim(),
    port: b.port,
    username: b.username?.trim(),
    password: b.password || existing?.password,
    remoteDir: b.remoteDir?.trim(),
  };
}

app.get('/api/settings/targets', (_req, res) => res.json(settings.get().targets.map(publicTarget)));

app.post(
  '/api/settings/targets',
  h(async (req, res) => {
    const b = req.body || {};
    if (!['local', 'webdav', 'sftp'].includes(b.type)) throw new HttpError(400, 'Ungültiger Typ');
    const existing = b.id ? settings.get().targets.find((t) => t.id === b.id) : null;
    const t = targetFromBody(b, existing);
    if (!t.name) t.name = { local: 'Ordner', webdav: 'Nextcloud', sftp: 'SFTP' }[t.type];
    const list = settings.get().targets;
    settings.save({ targets: existing ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t] });
    res.json(publicTarget(t));
  }),
);

app.post(
  '/api/settings/targets/test',
  h(async (req, res) => {
    const b = req.body || {};
    const existing = b.id ? settings.get().targets.find((t) => t.id === b.id) : null;
    try {
      await testTarget(targetFromBody(b, existing));
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  }),
);

app.delete(
  '/api/settings/targets/:tid',
  h(async (req, res) => {
    settings.save({ targets: settings.get().targets.filter((t) => t.id !== req.params.tid) });
    res.json({ ok: true });
  }),
);

app.get('/api/settings/sync', (_req, res) => res.json({ log: syncLog() }));

app.post(
  '/api/settings/sync/run',
  h(async (_req, res) => {
    await runSync();
    res.json({ ok: true, log: syncLog() });
  }),
);

/* ---------- Frontend ---------- */

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(pub));

app.listen(env.port, () => {
  loadServers().catch(() => {}); // Cache vorwärmen
  setInterval(() => runScheduledBackups().catch((e) => console.error('Backup-Zeitplan fehlgeschlagen:', e)), 30_000).unref();
  runScheduledBackups().catch((e) => console.error('Backup-Zeitplan fehlgeschlagen:', e));
  const c = craftyCfg();
  console.log(`Craftynos läuft auf Port ${env.port} (Crafty-API: ${c.token ? c.url : 'kein Token – nur Volumes'})`);
});
