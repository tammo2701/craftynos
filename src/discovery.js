import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from './config.js';
import { exists } from './files.js';
import { parseProps } from './props.js';

/**
 * Liest die Crafty-Datenbank (nur lesend), falls /crafty/app/config gemountet ist.
 * Braucht node:sqlite (Node >= 22.13); sonst wird still auf den Ordner-Scan zurückgefallen.
 */
export async function readCraftyDb() {
  const file = path.join(env.craftyRoot, 'app', 'config', 'db', 'crafty.sqlite');
  if (!(await exists(file))) return { found: false, rows: [] };
  try {
    const { DatabaseSync } = await import('node:sqlite');
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
    } catch {
      db = new DatabaseSync(file);
    }
    try {
      const rows = db.prepare('SELECT * FROM servers').all();
      return {
        found: true,
        rows: rows.map((r) => ({
          server_id: String(r.server_id),
          server_name: r.server_name,
          path: r.path,
          backup_path: r.backup_path,
          server_port: r.server_port,
          type: r.type,
        })),
      };
    } finally {
      db.close();
    }
  } catch (e) {
    return { found: true, rows: [], error: e.message };
  }
}

export async function discoverServers() {
  const db = await readCraftyDb();
  const out = new Map(db.rows.map((r) => [r.server_id, r]));
  const serversDir = path.join(env.craftyRoot, 'servers');
  try {
    for (const ent of await fsp.readdir(serversDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || out.has(ent.name)) continue;
      const dir = path.join(serversDir, ent.name);
      let name = ent.name.slice(0, 8);
      try {
        const motd = parseProps(await fsp.readFile(path.join(dir, 'server.properties'), 'utf8')).find((e) => e.key === 'motd');
        if (motd?.value) name = motd.value.replace(/§./g, '').slice(0, 40) || name;
      } catch {
        /* keine server.properties */
      }
      out.set(ent.name, { server_id: ent.name, server_name: name, path: dir });
    }
  } catch {
    /* Ordner fehlt */
  }
  return [...out.values()];
}

export async function volumeInfo() {
  const serversDir = path.join(env.craftyRoot, 'servers');
  const db = await readCraftyDb();
  const list = await discoverServers();
  return {
    root: env.craftyRoot,
    serversDir,
    serversDirOk: await exists(serversDir),
    backupsDirOk: await exists(path.join(env.craftyRoot, 'backups')),
    serverCount: list.length,
    db: db.found,
    dbError: db.error || null,
  };
}
