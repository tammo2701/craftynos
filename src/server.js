import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { env, settings, craftyCfg, normalizeUrl, DEFAULT_BACKUP } from './config.js';
import { crafty, normalizeStats, unknownStats, testConnection } from './crafty.js';
import { HttpError, mapPath, safeJoin, listDir, walk, readJson, exists } from './files.js';
import { parseProps, applyProps } from './props.js';
import { knownPlayers, playerDetail, resolveUuid } from './players.js';
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

async function loadServers(force = false) {
  if (!force && cache.v && Date.now() - cache.t < 8000) return cache.v;
  let apiList = null;
  let apiError = null;
  if (craftyCfg().token) {
    try {
      apiList = (await crafty.servers()).data || [];
    } catch (e) {
      apiError = e.message;
    }
  }
  const disk = await discoverServers().catch(() => []);
  const diskMap = new Map(disk.map((d) => [d.server_id, d]));
  const list = (apiList ?? disk).map((s) => {
    const merged = { ...(diskMap.get(s.server_id) || {}), ...s };
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
    const r = await loadServers(true);
    const vol = await volumeInfo();
    res.json({
      mode: r.api ? 'api' : r.serverCount ? 'volumes' : 'none',
      api: {
        configured: Boolean(cfg.token),
        ok: r.api,
        error: r.apiError,
        url: cfg.url,
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
      res.json({ ok: true, url: cfg.url, ...(await testConnection(cfg)) });
    } catch (e) {
      res.json({ ok: false, url: cfg.url, error: e.message });
    }
  }),
);

app.get('/api/settings/backup', (_req, res) => res.json(settings.get().backup));

app.put('/api/settings/backup', (req, res) => {
  const b = req.body || {};
  const format = String(b.format ?? '').trim() || DEFAULT_BACKUP.format;
  settings.save({ backup: { format: format.slice(0, 120), includeFolder: b.includeFolder !== false } });
  res.json(settings.get().backup);
});

/* ---------- Server ---------- */

app.get(
  '/api/servers',
  h(async (_req, res) => {
    const { list, api } = await loadServers(true);
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
        return { id: s.server_id, name: s.server_name, type: s.type, ...st, port, api };
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
    res.json({
      id: server.server_id,
      name: server.server_name,
      type: server.type,
      path: server.path,
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

const ACTIONS = ['start_server', 'stop_server', 'restart_server', 'kill_server'];
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
        if (settings.get().targets.some((t) => t.auto)) {
          job.step = 'Wird auf Ziele kopiert …';
          await runSync();
        }
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
  const c = craftyCfg();
  console.log(`Craftynos läuft auf Port ${env.port} (Crafty-API: ${c.token ? c.url : 'kein Token – nur Volumes'})`);
});
