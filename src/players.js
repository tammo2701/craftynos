import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';
import { exists, readJson } from './files.js';

const dataDirs = (w) => [path.join(w, 'playerdata'), path.join(w, 'players', 'data')];
const statsDirs = (w) => [path.join(w, 'stats'), path.join(w, 'players', 'stats')];
const profileNames = new Map();

async function profileName(uuid) {
  const id = canonicalUuid(uuid);
  const cached = profileNames.get(id);
  if (cached && cached.expires > Date.now()) return cached.name;
  try {
    const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id.replace(/-/g, '')}`, { signal: AbortSignal.timeout(4000) });
    const name = response.ok ? (await response.json()).name : null;
    profileNames.set(id, { name: typeof name === 'string' ? name : null, expires: Date.now() + (name ? 86400000 : 300000) });
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

async function listUuids(dirs, ext) {
  const out = [];
  for (const d of dirs) {
    try {
      for (const f of await fsp.readdir(d)) {
        if (f.toLowerCase().endsWith(ext)) out.push(canonicalUuid(f.slice(0, -ext.length)));
      }
    } catch {
      /* Ordner existiert nicht */
    }
  }
  return out;
}

async function findFile(dirs, uuid, ext) {
  const variants = [...new Set([uuid, uuid.replace(/-/g, '')])];
  for (const d of dirs) {
    for (const variant of variants) {
      const p = path.join(d, variant + ext);
      if (await exists(p)) return p;
    }
  }
  return null;
}

function canonicalUuid(value) {
  const id = String(value).toLowerCase();
  if (/^[0-9a-f]{32}$/.test(id)) return id.slice(0, 8) + '-' + id.slice(8, 12) + '-' + id.slice(12, 16) + '-' + id.slice(16, 20) + '-' + id.slice(20);
  return id;
}

export async function knownPlayers(dir, level, onlineNames = []) {
  const w = path.join(dir, level);
  const map = new Map();
  const get = (uuid, name) => {
    const id = canonicalUuid(uuid);
    if (!map.has(id))
      map.set(id, { uuid: id, name: null, whitelisted: false, op: false, banned: false, hasData: false, online: false });
    const p = map.get(id);
    const candidate = typeof name === 'string' ? name.trim() : '';
    if (candidate && !p.name && candidate.toLowerCase() !== id && candidate.toLowerCase() !== id.slice(0, 8) && /^[A-Za-z0-9_.-]{1,32}$/.test(candidate)) p.name = candidate;
    return p;
  };
  for (const u of await readJson(path.join(dir, 'usercache.json'), [])) get(u.uuid, u.name);
  for (const u of await readJson(path.join(dir, 'whitelist.json'), [])) get(u.uuid, u.name).whitelisted = true;
  for (const u of await readJson(path.join(dir, 'ops.json'), [])) get(u.uuid, u.name).op = true;
  for (const u of await readJson(path.join(dir, 'banned-players.json'), [])) get(u.uuid, u.name).banned = true;
  for (const id of await listUuids(dataDirs(w), '.dat')) get(id).hasData = true;
  for (const id of await listUuids(statsDirs(w), '.json')) get(id);
  await Promise.all([...map.values()].filter((p) => !p.name).map(async (p) => { p.name = await profileName(p.uuid); }));
  const online = new Set(onlineNames.map((n) => n.toLowerCase()));
  const list = [...map.values()];
  for (const p of list) p.online = p.name ? online.has(p.name.toLowerCase()) : false;
  list.sort((a, b) => Number(b.online) - Number(a.online) || (a.name || a.uuid).localeCompare(b.name || b.uuid));
  return list;
}

const num = (v, d = 0) => (typeof v === 'number' ? v : d);

function normItem(it, slot) {
  if (it?.item && typeof it.item === 'object') it = { ...it.item, Slot: it.Slot ?? it.slot };
  const id = typeof it?.id === 'string' ? it.id : typeof it?.name === 'string' ? it.name : '';
  if (!id) return null;
  const count = it.count ?? it.Count ?? 1;
  const customName = it.components?.['minecraft:custom_name'] ?? it.tag?.display?.Name;
  return {
    slot,
    id,
    name: id.replace(/^minecraft:/, ''),
    count: Math.max(1, num(Number(count), 1)),
    customName: typeof customName === 'string' ? customName.slice(0, 120) : undefined,
  };
}

function itemList(arr) {
  return (Array.isArray(arr) ? arr : []).map((it, index) => normItem(it, Number.isInteger(Number(it?.Slot ?? it?.slot)) ? Number(it.Slot ?? it.slot) : index)).filter(Boolean);
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
    const root = nbt.simplify(parsed);
    const p = root.Data && typeof root.Data === 'object' ? { ...root, ...root.Data } : root;
    const inventory = itemList(p.Inventory);
    // Ab 1.21.5 liegt die Ausrüstung in "equipment"
    const eq = p.equipment || {};
    for (const [key, slot] of [['feet', 100], ['legs', 101], ['chest', 102], ['head', 103], ['offhand', -106]]) {
      const entry = Array.isArray(eq) ? eq.find((x) => x?.slot === key || x?.Slot === slot) : eq[key];
      const it = normItem(entry, slot);
      if (it) inventory.push(it);
    }
    const heldSlot = Math.max(0, Math.min(8, num(p.SelectedItemSlot)));
    const mainhandEntry = Array.isArray(eq) ? eq.find((x) => x?.slot === 'mainhand' || x?.Slot === heldSlot) : eq.mainhand;
    const mainhand = normItem(mainhandEntry, heldSlot);
    if (mainhand && !inventory.some((item) => item.slot === heldSlot)) inventory.push(mainhand);
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

/** Aktualisiert gespeicherte Spielerdaten, wenn Crafty bestätigt, dass der Server gestoppt ist. */
export async function updateOfflinePlayer(dir, level, uuid, action, levels, gameMode) {
  const id = String(uuid).toLowerCase();
  if (!/^[0-9a-f-]{32,36}$/.test(id)) throw new Error('Ungültige Spieler-UUID');
  const file = await findFile(dataDirs(path.join(dir, level)), id, '.dat');
  if (!file) throw new Error('Für diesen Spieler liegen keine gespeicherten Daten vor.');

  const original = await fsp.readFile(file);
  const { parsed, type } = await nbt.parse(original);
  const root = parsed.value?.Data?.value || parsed.value;
  const set = (key, value) => {
    const tag = root[key];
    if (!tag || !['byte', 'short', 'int', 'long', 'float', 'double'].includes(tag.type))
      throw new Error(`Das Spielerfeld „${key}“ fehlt in der NBT-Datei.`);
    tag.value = value;
  };

  if (action === 'heal') set('Health', 20);
  else if (action === 'feed') {
    set('foodLevel', 20);
    if (root.foodSaturationLevel) set('foodSaturationLevel', 20);
    if (root.foodExhaustionLevel) set('foodExhaustionLevel', 0);
  } else if (action === 'starve') {
    set('foodLevel', 0);
    if (root.foodSaturationLevel) set('foodSaturationLevel', 0);
    if (root.foodExhaustionLevel) set('foodExhaustionLevel', 0);
  } else if (action === 'xp') {
    if (!Number.isInteger(levels) || levels < 0 || levels > 100000) throw new Error('Erfahrungslevel müssen zwischen 0 und 100.000 liegen.');
    set('XpLevel', levels);
    set('XpP', 0);
    const total = levels <= 16 ? levels * levels + 6 * levels : levels <= 31 ? 2.5 * levels ** 2 - 40.5 * levels + 360 : 4.5 * levels ** 2 - 162.5 * levels + 2220;
    if (root.XpTotal) set('XpTotal', Math.floor(total));
  } else if (action === 'gamemode') {
    if (![0, 1, 2, 3].includes(gameMode)) throw new Error('Ungültiger Spielmodus');
    set('playerGameType', gameMode);
  } else throw new Error('Unbekannte Spieleraktion');

  const data = nbt.writeUncompressed(parsed, type);
  const output = original[0] === 0x1f && original[1] === 0x8b ? gzipSync(data) : data;
  const stat = await fsp.stat(file);
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(tmp, output, { mode: stat.mode });
    await fsp.rename(tmp, file);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
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
