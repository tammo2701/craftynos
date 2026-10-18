import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { env, settings, craftyCfg } from './config.js';
import { crafty, normalizeStats } from './crafty.js';
import { HttpError, mapPath, safeJoin, listDir, walk, readJson, exists } from './files.js';
import { parseProps, applyProps } from './props.js';
import { knownPlayers, playerDetail, resolveUuid } from './players.js';
import { uploadTo, testTarget, publicTarget, runSync, syncLog, startScheduler } from './backups.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: 'text/plain', limit: '5mb' }));

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ error: e.message || String(e) });
  });

/* ---------- Server-Kontext ---------- */

let cache = { t: 0, v: null };
async function servers(force = false) {
  if (!force && cache.v && Date.now() - cache.t < 10000) return cache.v;
  const r = await crafty.servers();
  cache = { t: Date.now(), v: r.data || [] };
  return cache.v;
}

async function ctx(id) {
  const s = (await servers()).find((x) => x.server_id === id) || (await servers(true)).find((x) => x.server_id === id);
  if (!s) throw new HttpError(404, 'Server nicht gefunden');
  const dir = mapPath(s.path);
  if (!dir || !(await exists(dir)))
    throw new HttpError(
      500,
      `Serverordner nicht erreichbar (${s.path}). Crafty-Volumes in den Craftynos-Container mounten (siehe README).`,
    );
  return { server: s, dir };
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
  return normalizeStats(await crafty.stats(id));
}

/* ---------- Allgemein ---------- */

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get(
  '/api/config',
  h(async (_req, res) => {
    const cfg = craftyCfg();
    let craftyOk = false;
    let error = null;
    if (cfg.token) {
      try {
        await servers(true);
        craftyOk = true;
      } catch (e) {
        error = e.message;
      }
    }
    res.json({
      crafty: { url: cfg.url, hasToken: Boolean(cfg.token), fromEnv: cfg.fromEnv, ok: craftyOk, error },
      icons: { item: env.itemIconUrl, block: env.blockIconUrl, head: env.headUrl },
    });
  }),
);

app.put(
  '/api/settings/crafty',
  h(async (req, res) => {
    const { url, token } = req.body || {};
    const cur = settings.get().crafty || {};
    settings.save({ crafty: { url: url ?? cur.url, token: token || cur.token } });
    cache = { t: 0, v: null };
    res.json({ ok: true });
  }),
);

/* ---------- Server ---------- */

app.get(
  '/api/servers',
  h(async (_req, res) => {
    const list = await servers(true);
    const out = await Promise.all(
      list.map(async (s) => {
        let st;
        try {
          st = await stateOf(s.server_id);
        } catch (e) {
          st = { status: 'unknown', error: e.message, players: [], online: 0, max: 0 };
        }
        return { id: s.server_id, name: s.server_name, type: s.type, port: s.server_port, ...st };
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
    res.json({
      id: server.server_id,
      name: server.server_name,
      type: server.type,
      port: server.server_port,
      path: server.path,
      level: prop(props, 'level-name', 'world'),
      onlineMode: prop(props, 'online-mode', 'true') === 'true',
      whitelistEnabled: prop(props, 'white-list', 'false') === 'true',
      ...(await stateOf(server.server_id)),
    });
  }),
);

const ACTIONS = ['start_server', 'stop_server', 'restart_server', 'kill_server', 'backup_server'];
app.post(
  '/api/servers/:id/action/:action',
  h(async (req, res) => {
    if (!ACTIONS.includes(req.params.action)) throw new HttpError(400, 'Unbekannte Aktion');
    await crafty.action(req.params.id, req.params.action);
    res.json({ ok: true });
  }),
);

app.post(
  '/api/servers/:id/command',
  h(async (req, res) => {
    const cmd = String(req.body?.command || '').trim().replace(/^\//, '');
    if (!cmd) throw new HttpError(400, 'Leerer Befehl');
    await crafty.stdin(req.params.id, cmd);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/servers/:id/logs',
  h(async (req, res) => {
    const r = await crafty.logs(req.params.id, req.query.file === 'true');
    res.json({ lines: Array.isArray(r.data) ? r.data.slice(-500) : [] });
  }),
);

/* ---------- Spieler / Inventar ---------- */

app.get(
  '/api/servers/:id/players',
  h(async (req, res) => {
    const { server, dir } = await ctx(req.params.id);
    const level = prop(await propsOf(dir), 'level-name', 'world');
    let online = [];
    try {
      online = (await stateOf(server.server_id)).players;
    } catch {
      /* egal */
    }
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
    const st = await stateOf(server.server_id);
    if (st.running) {
      await crafty.stdin(server.server_id, `whitelist add ${name}`);
      await new Promise((r) => setTimeout(r, 800));
    } else {
      const onlineMode = prop(await propsOf(dir), 'online-mode', 'true') === 'true';
      const p = await resolveUuid(name, onlineMode);
      if (!p) throw new HttpError(404, `Spieler "${name}" nicht gefunden`);
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
    const st = await stateOf(server.server_id);
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

app.get(
  '/api/servers/:id/files',
  h(async (req, res) => {
    const { abs } = await fileCtx(req);
    res.json(await listDir(abs));
  }),
);

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

app.get(
  '/api/servers/:id/files/download',
  h(async (req, res) => {
    const { abs } = await fileCtx(req);
    res.download(abs);
  }),
);

app.post(
  '/api/servers/:id/files/mkdir',
  h(async (req, res) => {
    const { abs } = await fileCtx(req);
    await fsp.mkdir(abs, { recursive: true });
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

/* ---------- Backups ---------- */

async function backupRoot(id) {
  const { server } = await ctx(id);
  const root = mapPath(server.backup_path);
  if (!root || !(await exists(root)))
    throw new HttpError(
      500,
      `Backup-Ordner nicht erreichbar (${server.backup_path}). /crafty/backups mounten (siehe README).`,
    );
  return { server, root };
}

app.get(
  '/api/servers/:id/backups',
  h(async (req, res) => {
    const { root } = await backupRoot(req.params.id);
    res.json(await walk(root));
  }),
);

app.get(
  '/api/servers/:id/backups/download',
  h(async (req, res) => {
    const { root } = await backupRoot(req.params.id);
    res.download(safeJoin(root, req.query.path || ''));
  }),
);

app.delete(
  '/api/servers/:id/backups',
  h(async (req, res) => {
    const { root } = await backupRoot(req.params.id);
    const abs = safeJoin(root, req.query.path || '');
    if (abs === path.resolve(root)) throw new HttpError(400, 'Ungültiger Pfad');
    await fsp.rm(abs, { recursive: true, force: true });
    res.json({ ok: true });
  }),
);

app.post(
  '/api/servers/:id/backups/upload',
  h(async (req, res) => {
    const { server, root } = await backupRoot(req.params.id);
    const t = settings.get().targets.find((x) => x.id === req.body?.targetId);
    if (!t) throw new HttpError(404, 'Backup-Ziel nicht gefunden');
    const rel = String(req.body?.path || '');
    const abs = safeJoin(root, rel);
    await uploadTo(t, abs, `${server.server_name}/${rel}`);
    res.json({ ok: true });
  }),
);

/* ---------- Backup-Ziele & Sync ---------- */

app.get('/api/settings/targets', (_req, res) => res.json(settings.get().targets.map(publicTarget)));

app.post(
  '/api/settings/targets',
  h(async (req, res) => {
    const b = req.body || {};
    if (!['local', 'webdav', 'sftp'].includes(b.type)) throw new HttpError(400, 'Ungültiger Typ');
    const existing = b.id ? settings.get().targets.find((t) => t.id === b.id) : null;
    const t = {
      id: existing?.id || crypto.randomUUID(),
      type: b.type,
      name: String(b.name || b.type).slice(0, 60),
      auto: Boolean(b.auto),
      path: b.path,
      url: b.url,
      host: b.host,
      port: b.port,
      username: b.username,
      password: b.password || existing?.password,
      remoteDir: b.remoteDir,
    };
    const rest = settings.get().targets.filter((x) => x.id !== t.id);
    settings.save({ targets: [...rest, t] });
    res.json(publicTarget(t));
  }),
);

app.delete(
  '/api/settings/targets/:tid',
  h(async (req, res) => {
    settings.save({ targets: settings.get().targets.filter((t) => t.id !== req.params.tid) });
    res.json({ ok: true });
  }),
);

app.post(
  '/api/settings/targets/:tid/test',
  h(async (req, res) => {
    const t = settings.get().targets.find((x) => x.id === req.params.tid);
    if (!t) throw new HttpError(404, 'Ziel nicht gefunden');
    try {
      await testTarget(t);
      res.json({ ok: true });
    } catch (e) {
      throw new HttpError(502, 'Verbindung fehlgeschlagen: ' + e.message);
    }
  }),
);

app.get('/api/settings/sync', (_req, res) => res.json({ ...settings.get().autoSync, log: syncLog() }));

app.put('/api/settings/sync', (req, res) => {
  const { enabled, intervalMin } = req.body || {};
  settings.save({ autoSync: { enabled: Boolean(enabled), intervalMin: Math.max(1, Number(intervalMin) || 60) } });
  res.json({ ok: true });
});

app.post(
  '/api/settings/sync/run',
  h(async (_req, res) => {
    runSync();
    res.json({ ok: true });
  }),
);

/* ---------- Frontend ---------- */

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(pub));

app.listen(env.port, () => {
  console.log(`Craftynos läuft auf Port ${env.port} (Crafty: ${craftyCfg().url})`);
  startScheduler();
});
