import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Crafty liefert Pfade aus Sicht seines eigenen Containers (z. B. /crafty/servers/<uuid>).
 * Mountet man die Volumes identisch, passt der Pfad direkt. Sonst versuchen wir
 * ein Remapping unter CRAFTY_ROOT.
 */
export function mapPath(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return p;
  const m = String(p).match(/(servers|backups|logs|import)[\\/]+(.+)$/);
  if (m) {
    const candidate = path.join(env.craftyRoot, m[1], m[2]);
    if (fs.existsSync(candidate)) return candidate;
  }
  return p;
}

export function safeJoin(root, rel = '') {
  const base = path.resolve(root);
  const cleaned = String(rel).replace(/^[/\\]+/, '');
  const abs = path.resolve(base, cleaned);
  const r = path.relative(base, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new HttpError(400, 'Ungültiger Pfad');
  return abs;
}

export async function exists(p) {
  return fsp.access(p).then(
    () => true,
    () => false,
  );
}

export async function readJson(p, fallback) {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function listDir(abs) {
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    try {
      const st = await fsp.stat(path.join(abs, e.name));
      out.push({
        name: e.name,
        dir: st.isDirectory(),
        size: st.isDirectory() ? null : st.size,
        mtime: st.mtimeMs,
      });
    } catch {
      /* kaputter Symlink o. ä. */
    }
  }
  out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return out;
}

export async function walk(root, maxDepth = 3, limit = 2000) {
  const out = [];
  async function rec(dir, depth) {
    if (depth > maxDepth || out.length >= limit) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await rec(full, depth + 1);
      else if (e.isFile()) {
        const st = await fsp.stat(full);
        out.push({
          rel: path.relative(root, full).split(path.sep).join('/'),
          size: st.size,
          mtime: st.mtimeMs,
        });
      }
    }
  }
  await rec(root, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}
