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

function explain(e, url) {
  const code = [e.cause?.code, e.code].find((c) => typeof c === 'string') || '';
  const hints = {
    ENOTFOUND: 'Hostname nicht auflösbar. Läuft Craftynos im selben Docker-Netzwerk? Sonst die IP-Adresse des Hosts verwenden.',
    ECONNREFUSED: 'Verbindung abgelehnt. Stimmt der Port (Standard 8443)?',
    EHOSTUNREACH: 'Host nicht erreichbar.',
    ETIMEDOUT: 'Zeitüberschreitung.',
    UND_ERR_CONNECT_TIMEOUT: 'Zeitüberschreitung beim Verbinden.',
    ERR_SSL_WRONG_VERSION_NUMBER: 'Crafty spricht HTTPS. Die URL mit https:// angeben.',
    EPROTO: 'Crafty spricht HTTPS. Die URL mit https:// angeben.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Selbstsigniertes Zertifikat (CRAFTY_INSECURE_TLS=true setzen).',
    SELF_SIGNED_CERT_IN_CHAIN: 'Selbstsigniertes Zertifikat (CRAFTY_INSECURE_TLS=true setzen).',
  };
  return `Crafty unter ${url} nicht erreichbar${code ? ` (${code})` : ''}. ${hints[code] || e.cause?.message || e.message}`;
}

async function call(method, p, { body, text = false, timeout = 15000, auth = true, cfg } = {}) {
  cfg ||= craftyCfg();
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
    throw new CraftyError(explain(e, cfg.url));
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403)
    throw new CraftyError(`Token ungültig oder ohne Berechtigung (HTTP ${res.status})`, 502);
  if (!res.ok || data?.status === 'error')
    throw new CraftyError(data?.error_data || data?.error || `Crafty antwortete mit HTTP ${res.status}`, 502);
  return data;
}

export const crafty = {
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

/** Testet beliebige Zugangsdaten, ohne sie zu speichern. */
export async function testConnection(cfg) {
  const r = await call('GET', '/api/v2/servers', { cfg, timeout: 8000 });
  return { serverCount: Array.isArray(r.data) ? r.data.length : 0 };
}

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

export const unknownStats = () => ({
  status: 'unknown',
  running: false,
  cpu: 0,
  mem: '',
  memPercent: 0,
  online: 0,
  max: 0,
  players: [],
  version: '',
  desc: '',
  started: '',
  worldSize: '',
  port: null,
});

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
