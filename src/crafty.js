import { Agent, fetch } from 'undici';
import { craftyCfg } from './config.js';

const agents = {};
const agent = (insecure) =>
  (agents[insecure] ??= new Agent({ connect: { rejectUnauthorized: !insecure } }));

export class CraftyError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

async function call(method, p, { body, text = false, timeout = 15000, auth = true } = {}) {
  const cfg = craftyCfg();
  if (auth && !cfg.token) throw new CraftyError('Kein Crafty-API-Token konfiguriert', 503);
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${cfg.token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = text ? 'text/plain' : 'application/json';
    payload = text ? body : JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(cfg.url + p, {
      method,
      headers,
      body: payload,
      dispatcher: agent(cfg.insecure),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new CraftyError(`Crafty nicht erreichbar (${cfg.url}): ${e.cause?.code || e.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status === 'error') {
    throw new CraftyError(
      data?.error_data || data?.error || `Crafty antwortete mit HTTP ${res.status}`,
      res.status === 403 ? 403 : 502,
    );
  }
  return data;
}

export const crafty = {
  ping: () => call('GET', '/api/v2/crafty/check', { auth: false, timeout: 5000 }),
  servers: () => call('GET', '/api/v2/servers'),
  stats: (id) => call('GET', `/api/v2/servers/${id}/stats`),
  action: (id, action) => call('POST', `/api/v2/servers/${id}/action/${action}`),
  stdin: (id, command) =>
    call('POST', `/api/v2/servers/${id}/stdin`, {
      body: String(command).replace(/[\r\n]+/g, ' '),
      text: true,
    }),
  logs: (id, file = false) => call('GET', `/api/v2/servers/${id}/logs?file=${file}&colors=false&raw=false`),
};

export function parsePlayers(v) {
  if (Array.isArray(v)) return v.map((p) => (typeof p === 'object' ? p.name : String(p)));
  if (typeof v !== 'string' || !v || v === '[]') return [];
  for (const candidate of [v, v.replace(/'/g, '"')]) {
    try {
      const j = JSON.parse(candidate);
      if (Array.isArray(j)) return j.map((p) => (typeof p === 'object' ? p.name : String(p)));
    } catch {
      /* weiter */
    }
  }
  return [];
}

const truthy = (v) => v === true || v === 'True' || v === 'true';

export function normalizeStats(s) {
  const r = { ...s, ...(s && typeof s.data === 'object' && !Array.isArray(s.data) ? s.data : {}) };
  const running = truthy(r.running);
  const pingOk = truthy(r.int_ping_results);
  let status = 'offline';
  if (truthy(r.crashed)) status = 'crashed';
  else if (truthy(r.updating)) status = 'updating';
  else if (running && pingOk) status = 'online';
  else if (running || truthy(r.waiting_start)) status = 'starting';
  return {
    status,
    running,
    cpu: Number(r.cpu) || 0,
    mem: r.mem ?? '',
    memPercent: Number(r.mem_percent) || 0,
    online: Number(r.online) || 0,
    max: Number(r.max) || 0,
    players: parsePlayers(r.players),
    version: r.version || '',
    desc: r.desc || '',
    started: r.started || '',
    worldSize: r.world_size || '',
    port: r.server_port || null,
  };
}
