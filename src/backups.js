import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env, settings } from './config.js';
import { walk } from './files.js';

/* ---------- Ziele: local (z. B. gemountetes NAS), webdav (Nextcloud), sftp ---------- */

const posix = (...p) => path.posix.join('/', ...p.map((s) => String(s || '').replace(/\\/g, '/')));

async function withWebdav(t, fn) {
  const { createClient } = await import('webdav');
  return fn(createClient(t.url, { username: t.username, password: t.password }));
}

async function withSftp(t, fn) {
  const { default: Sftp } = await import('ssh2-sftp-client');
  const c = new Sftp();
  await c.connect({
    host: t.host,
    port: Number(t.port) || 22,
    username: t.username,
    password: t.password,
    readyTimeout: 15000,
  });
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}

export async function uploadTo(t, localFile, remoteRel) {
  if (t.type === 'local') {
    const dest = path.join(t.path, ...remoteRel.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(localFile, dest);
  } else if (t.type === 'webdav') {
    const remote = posix(t.remoteDir, remoteRel);
    const size = (await fsp.stat(localFile)).size;
    await withWebdav(t, async (c) => {
      await c.createDirectory(path.posix.dirname(remote), { recursive: true });
      await c.putFileContents(remote, fs.createReadStream(localFile), { overwrite: true, contentLength: size });
    });
  } else if (t.type === 'sftp') {
    const remote = posix(t.remoteDir, remoteRel);
    await withSftp(t, async (c) => {
      await c.mkdir(path.posix.dirname(remote), true);
      await c.put(localFile, remote);
    });
  } else {
    throw new Error('Unbekannter Zieltyp: ' + t.type);
  }
}

export async function testTarget(t) {
  if (t.type === 'local') {
    if (!t.path) throw new Error('Kein Zielordner angegeben');
    await fsp.mkdir(t.path, { recursive: true });
    await fsp.access(t.path, fs.constants.W_OK);
  } else if (t.type === 'webdav') {
    if (!t.url) throw new Error('Keine URL angegeben');
    await withWebdav(t, (c) => c.getDirectoryContents(posix(t.remoteDir)));
  } else if (t.type === 'sftp') {
    if (!t.host) throw new Error('Kein Host angegeben');
    await withSftp(t, (c) => c.list(posix(t.remoteDir)));
  } else throw new Error('Unbekannter Zieltyp: ' + t.type);
}

export const publicTarget = (t) => ({ ...t, password: undefined, hasPassword: Boolean(t.password) });

/* ---------- Abgleich neuer Backups auf Ziele mit Auto-Kopie ---------- */

const stateFile = path.join(env.dataDir, 'synced.json');
const log = [];
const note = (msg) => {
  log.unshift({ t: Date.now(), msg });
  log.length = Math.min(log.length, 50);
};
export const syncLog = () => log;

let provider = async () => [];
export const setServerProvider = (fn) => (provider = fn);

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

let running = false;

export async function runSync({ pruneUploaded = false } = {}) {
  if (running) return { copied: 0, failed: 0, pruned: 0, copiedFiles: [], prunedFiles: [], busy: true };
  const result = { copied: 0, failed: 0, pruned: 0, copiedFiles: [], prunedFiles: [] };
  running = true;
  try {
    const targets = settings.get().targets.filter((t) => t.auto);
    if (!targets.length) return result;
    const state = loadState();
    const excluded = new Set(settings.get().backup.excludedServers || []);
    const sources = [];
    for (const s of await provider()) {
      if (excluded.has(String(s.server_id))) continue;
      const root = s._backupDir;
      if (!root) continue;
      for (const f of (await walk(root)).filter((x) => x.rel.toLowerCase().endsWith('.zip'))) {
        for (const t of targets) {
          const key = `${s.server_id}/${f.rel}`;
          sources.push({ server: s, root, file: f, key });
          state[t.id] ??= {};
          if (state[t.id][key] === f.mtime) continue;
          try {
            await uploadTo(t, path.join(root, ...f.rel.split('/')), `${s.server_name}/${f.rel}`);
            state[t.id][key] = f.mtime;
            result.copied++;
            result.copiedFiles.push(key);
            note(`${s.server_name}/${f.rel} → ${t.name}`);
          } catch (e) {
            result.failed++;
            note(`Fehler: ${s.server_name}/${f.rel} → ${t.name}: ${e.message}`);
          }
        }
      }
    }
    if (pruneUploaded) {
      const unique = new Map(sources.map((x) => [`${x.server.server_id}/${x.file.rel}`, x]));
      for (const source of unique.values()) {
        const complete = targets.every((t) => state[t.id]?.[source.key] === source.file.mtime);
        if (!complete) continue;
        await fsp.rm(path.join(source.root, ...source.file.rel.split('/')), { force: true });
        result.pruned++;
        result.prunedFiles.push(source.key);
      }
    }
    fs.writeFileSync(stateFile, JSON.stringify(state));
    return result;
  } catch (e) {
    note('Abgleich fehlgeschlagen: ' + e.message);
    return result;
  } finally {
    running = false;
  }
}
