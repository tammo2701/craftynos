import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from './config.js';
import { exists } from './files.js';
import { parseProps } from './props.js';

const isIdName = (value) => /^[0-9a-f]{8}(?:-[0-9a-f-]{27})?$/i.test(String(value || '').trim());

function motdText(value) {
  let text = String(value || '').trim();
  try {
    const parsed = JSON.parse(text);
    const flatten = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map(flatten).join('') : v && typeof v === 'object' ? `${flatten(v.text || '')}${flatten(v.extra || '')}` : '';
    text = flatten(parsed);
  } catch { /* einfache Properties-Zeichenfolge */ }
  return text.replace(/§./g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

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
    let unnamed = 0;
    for (const ent of await fsp.readdir(serversDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(serversDir, ent.name);
      let properties = [];
      try {
        properties = parseProps(await fsp.readFile(path.join(dir, 'server.properties'), 'utf8'));
      } catch {
        /* keine server.properties */
      }
      const existing = out.get(ent.name) || {};
      const dbName = String(existing.server_name || '').trim();
      const diskName = motdText(properties.find((e) => e.key === 'motd')?.value);
      const levelName = String(properties.find((e) => e.key === 'level-name')?.value || '').trim();
      const folderName = !isIdName(ent.name) ? ent.name : '';
      const name = (!isIdName(dbName) && dbName) || diskName || levelName || folderName || `Minecraft-Server ${++unnamed}`;
      out.set(ent.name, { ...existing, server_id: ent.name, server_name: name, path: existing.path || dir });
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
