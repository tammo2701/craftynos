import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.resolve('./data'));

export const env = {
  port: Number(process.env.PORT || 8080),
  craftyRoot: process.env.CRAFTY_ROOT || '/crafty',
  dataDir,
  // Platzhalter: {name} = Item-ID ohne "minecraft:", {uuid} = Spieler-UUID
  itemIconUrl:
    process.env.ITEM_ICON_URL ||
    'https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-assets@master/data/1.21.1/items/{name}.png',
  blockIconUrl:
    process.env.BLOCK_ICON_URL ||
    'https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-assets@master/data/1.21.1/blocks/{name}.png',
  headUrl: process.env.HEAD_URL || 'https://mc-heads.net/avatar/{uuid}/64',
};

fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'settings.json');

export const DEFAULT_BACKUP = { format: '{server} {date} {time}', includeFolder: true, enabled: true, time: '03:00', excludedServers: [] };

const defaults = {
  crafty: { url: '', token: '' },
  backup: { ...DEFAULT_BACKUP },
  targets: [],
};

let state = load();

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const backup = { ...DEFAULT_BACKUP, ...(j.backup || {}) };
    backup.excludedServers = Array.isArray(backup.excludedServers) ? backup.excludedServers.map(String) : [];
    return { ...structuredClone(defaults), ...j, backup };
  } catch {
    return structuredClone(defaults);
  }
}

export const settings = {
  get: () => state,
  save(patch) {
    state = { ...state, ...patch };
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  },
};

export function normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    return new URL(s).origin;
  } catch {
    return s.replace(/\/+$/, '');
  }
}

/**
 * Reihenfolge: Eingabe in der Oberfläche > Umgebungsvariable (Compose) > Standardwert.
 */
export function craftyCfg() {
  const ui = state.crafty || {};
  const envUrl = normalizeUrl(process.env.CRAFTY_URL);
  const uiUrl = normalizeUrl(ui.url);
  const envToken = process.env.CRAFTY_API_TOKEN || '';
  return {
    url: uiUrl || envUrl || 'https://crafty:8443',
    token: ui.token || envToken,
    insecure: (process.env.CRAFTY_INSECURE_TLS ?? 'true') !== 'false',
    urlSource: uiUrl ? 'ui' : envUrl ? 'env' : 'default',
    tokenSource: ui.token ? 'ui' : envToken ? 'env' : 'none',
    envUrl: envUrl || 'https://crafty:8443',
  };
}
