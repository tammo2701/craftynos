import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import nbt from 'prismarine-nbt';
import { exists, readJson } from './files.js';

const dataDirs = (w) => [path.join(w, 'playerdata'), path.join(w, 'players', 'data')];
const statsDirs = (w) => [path.join(w, 'stats'), path.join(w, 'players', 'stats')];

async function listUuids(dirs, ext) {
  const out = [];
  for (const d of dirs) {
    try {
      for (const f of await fsp.readdir(d)) {
        if (f.endsWith(ext)) out.push(f.slice(0, -ext.length).toLowerCase());
      }
    } catch {
      /* Ordner existiert nicht */
    }
  }
  return out;
}

async function findFile(dirs, uuid, ext) {
  for (const d of dirs) {
    const p = path.join(d, uuid + ext);
    if (await exists(p)) return p;
  }
  return null;
}

export async function knownPlayers(dir, level, onlineNames = []) {
  const w = path.join(dir, level);
  const map = new Map();
  const get = (uuid, name) => {
    const id = String(uuid).toLowerCase();
    if (!map.has(id))
      map.set(id, { uuid: id, name: null, whitelisted: false, op: false, banned: false, hasData: false, online: false });
    const p = map.get(id);
    if (name && !p.name) p.name = name;
    return p;
  };
  for (const u of await readJson(path.join(dir, 'usercache.json'), [])) get(u.uuid, u.name);
  for (const u of await readJson(path.join(dir, 'whitelist.json'), [])) get(u.uuid, u.name).whitelisted = true;
  for (const u of await readJson(path.join(dir, 'ops.json'), [])) get(u.uuid, u.name).op = true;
  for (const u of await readJson(path.join(dir, 'banned-players.json'), [])) get(u.uuid, u.name).banned = true;
  for (const id of await listUuids(dataDirs(w), '.dat')) get(id).hasData = true;
  for (const id of await listUuids(statsDirs(w), '.json')) get(id);
  const online = new Set(onlineNames.map((n) => n.toLowerCase()));
  const list = [...map.values()];
  for (const p of list) p.online = p.name ? online.has(p.name.toLowerCase()) : false;
  list.sort((a, b) => Number(b.online) - Number(a.online) || (a.name || a.uuid).localeCompare(b.name || b.uuid));
  return list;
}

const num = (v, d = 0) => (typeof v === 'number' ? v : d);

function normItem(it, slot) {
  if (!it || !it.id) return null;
  const count = it.count ?? it.Count ?? 1;
  const customName = it.components?.['minecraft:custom_name'] ?? it.tag?.display?.Name;
  return {
    slot,
    id: it.id,
    name: String(it.id).replace(/^minecraft:/, ''),
    count: num(count, 1),
    customName: typeof customName === 'string' ? customName.slice(0, 120) : undefined,
  };
}

function itemList(arr) {
  return (arr || []).map((it) => normItem(it, num(it.Slot, 0))).filter(Boolean);
}

function posOf(v) {
  return Array.isArray(v) && v.length >= 3 ? v.slice(0, 3).map((n) => Math.round(n * 100) / 100) : null;
}

function summarizeStats(j) {
  if (!j) return null;
  const s = j.stats || {};
  const c = s['minecraft:custom'] || {};
  const g = (k) => c['minecraft:' + k] || 0;
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const top = (o, n = 15) =>
    Object.entries(o || {})
      .map(([k, v]) => ({ id: k.replace('minecraft:', ''), count: v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  const cm = (k) => Math.round(g(k) / 100);
  const dist = {
    walk: cm('walk_one_cm'),
    sprint: cm('sprint_one_cm'),
    fall: cm('fall_one_cm'),
    boat: cm('boat_one_cm'),
    swim: cm('swim_one_cm'),
    walkOnWater: cm('walk_on_water_one_cm'),
    walkUnderWater: cm('walk_under_water_one_cm'),
    climb: cm('climb_one_cm'),
    crouch: cm('crouch_one_cm'),
  };
  return {
    playTimeTicks: g('play_time') || g('play_one_minute'),
    deaths: g('deaths'),
    playerKills: g('player_kills'),
    mobKills: g('mob_kills'),
    distances: { total: Object.values(dist).reduce((a, b) => a + b, 0), ...dist },
    mined: { total: sum(s['minecraft:mined']), top: top(s['minecraft:mined']) },
    used: { total: sum(s['minecraft:used']), top: top(s['minecraft:used']) },
    killed: { total: sum(s['minecraft:killed']), top: top(s['minecraft:killed']) },
  };
}

export async function playerDetail(dir, level, uuid) {
  const w = path.join(dir, level);
  const id = String(uuid).toLowerCase();
  if (!/^[0-9a-f-]{32,36}$/.test(id)) return null;
  const datPath = await findFile(dataDirs(w), id, '.dat');
  const statsPath = await findFile(statsDirs(w), id, '.json');
  const out = { uuid: id, hasData: Boolean(datPath), updated: null, stats: null };

  if (statsPath) out.stats = summarizeStats(await readJson(statsPath, null));

  if (datPath) {
    out.updated = (await fsp.stat(datPath)).mtimeMs;
    const { parsed } = await nbt.parse(await fsp.readFile(datPath));
    const p = nbt.simplify(parsed);
    const inventory = itemList(p.Inventory);
    // Ab 1.21.5 liegt die Ausrüstung in "equipment"
    const eq = p.equipment || {};
    for (const [key, slot] of [['feet', 100], ['legs', 101], ['chest', 102], ['head', 103], ['offhand', -106]]) {
      const it = normItem(eq[key], slot);
      if (it) inventory.push(it);
    }
    const respawn = p.respawn || {};
    const death = p.LastDeathLocation;
    out.health = num(p.Health, 20);
    out.food = num(p.foodLevel, 20);
    out.xpLevel = num(p.XpLevel);
    out.xpProgress = num(p.XpP);
    out.gameMode = num(p.playerGameType);
    out.dimension = p.Dimension || null;
    out.pos = posOf(p.Pos);
    out.spawn =
      posOf(respawn.pos) ||
      (p.SpawnX !== undefined ? [num(p.SpawnX), num(p.SpawnY), num(p.SpawnZ)] : null);
    out.spawnDimension = respawn.dimension || p.SpawnDimension || null;
    out.lastDeath = death ? { pos: posOf(death.pos), dimension: death.dimension || null } : null;
    out.inventory = inventory;
    out.enderChest = itemList(p.EnderItems);
  }
  return out;
}

export function offlineUuid(name) {
  const b = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const dash = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export async function resolveUuid(name, onlineMode) {
  if (onlineMode) {
    try {
      const r = await fetch('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name), {
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const j = await r.json();
        return { name: j.name, uuid: dash(j.id) };
      }
      if (r.status === 404 || r.status === 204) return null;
    } catch {
      /* Mojang nicht erreichbar -> unten */
    }
    return null;
  }
  return { name, uuid: offlineUuid(name) };
}
