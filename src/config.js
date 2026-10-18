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

const defaults = {
  crafty: { url: '', token: '' },
  targets: [],
  autoSync: { enabled: false, intervalMin: 60 },
};

let state = load();

function load() {
  try {
    return { ...structuredClone(defaults), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
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

export function craftyCfg() {
  return {
    url: (process.env.CRAFTY_URL || state.crafty?.url || 'https://crafty:8443').replace(/\/$/, ''),
    token: process.env.CRAFTY_API_TOKEN || state.crafty?.token || '',
    insecure: (process.env.CRAFTY_INSECURE_TLS ?? 'true') !== 'false',
    fromEnv: Boolean(process.env.CRAFTY_API_TOKEN),
  };
}
