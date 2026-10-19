import { Agent, fetch } from 'undici';
import { craftyCfg } from './config.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';

const agents = {};
const agent = (insecure) =>
  (agents[insecure] ??= new Agent({ connect: { rejectUnauthorized: !insecure, timeout: 6000, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 800 } }));

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
    res = await fetch(effectiveUrl(cfg) + p, {
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
  servers: () => call('GET', '/api/v2/servers', { timeout: 7000 }),
  stats: (id) => call('GET', `/api/v2/servers/${id}/stats`, { timeout: 7000 }),
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

function tcpProbe(host, port, ms = 4000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: ms });
    s.once('connect', () => (s.destroy(), resolve({ ok: true })));
    s.once('timeout', () => (s.destroy(), resolve({ ok: false, error: 'Zeitüberschreitung' })));
    s.once('error', (e) => resolve({ ok: false, error: e.code || e.message }));
  });
}

/** Prüft Schritt für Schritt: DNS → Port → TLS/API-Anmeldung, damit klar ist, woran es scheitert. */
// Automatisch gefundene Alternativadresse (z. B. Service-Name statt Host-IP), nur im Speicher
let detected = null;
function effectiveUrl(cfg) {
  return !cfg.raw && detected && detected.from === cfg.url ? detected.url : cfg.url;
}
export const getDetected = (cfg) => (detected && detected.from === cfg.url ? detected.url : null);
export const resetDetected = () => (detected = null);

function gatewayIp() {
  try {
    const row = fs
      .readFileSync('/proc/net/route', 'utf8')
      .split('\n')
      .slice(1)
      .map((l) => l.split('\t'))
      .find((c) => c[1] === '00000000');
    return row ? [6, 4, 2, 0].map((i) => parseInt(row[2].slice(i, i + 2), 16)).join('.') : null;
  } catch {
    return null;
  }
}

/** Probiert typische Adressen durch (Service-Name, Container-Name, host.docker.internal, Gateway). */
async function scan(cfg) {
  const u = new URL(cfg.url);
  const userPort = u.port || '8443';
  const uniq = (...a) => [...new Set(a)];
  const pairs = [];
  for (const host of ['crafty', 'crafty_container']) for (const port of uniq('8443', userPort)) pairs.push([host, port]);
  for (const host of ['host.docker.internal', gatewayIp(), u.hostname]) {
    if (host) for (const port of uniq(userPort, '8443')) pairs.push([host, port]);
  }
  const seen = new Set();
  const list = pairs.filter(([h, p]) => {
    const k = `${h}:${p}`;
    if (seen.has(k) || (h === u.hostname && p === userPort)) return false;
    seen.add(k);
    return true;
  });
  const probes = await Promise.all(
    list.map(async ([host, port]) => {
      if (!net.isIP(host)) {
        try {
          await dns.lookup(host);
        } catch {
          return { host, port, state: null };
        }
      }
      const r = await tcpProbe(host, Number(port), 1500);
      return { host, port, state: r.ok ? 'offen' : r.error };
    }),
  );
  const steps = [];
  let found = null;
  for (const p of probes) {
    if (p.state === null) continue; // Name gibt es im Netzwerk nicht – nicht anzeigen
    const name = `Alternative ${p.host}:${p.port}`;
    const url = `${u.protocol}//${p.host}:${p.port}`;
    if (p.state !== 'offen') {
      steps.push({ name, ok: false, detail: p.state });
      continue;
    }
    try {
      const r = await testConnection({ ...cfg, url, raw: true });
      steps.push({ name, ok: true, detail: `funktioniert (${r.serverCount} Server)` });
      found ??= { url, serverCount: r.serverCount };
    } catch (e) {
      steps.push({ name, ok: false, detail: `Port offen, aber ${e.message}` });
    }
  }
  return { steps, found };
}

export async function autodetect(cfg) {
  const alt = await scan(cfg);
  if (alt.found) detected = { from: cfg.url, url: alt.found.url };
  return Boolean(alt.found);
}

export async function diagnose(cfg) {
  const r = await diagnosePrimary({ ...cfg, raw: true });
  if (r.ok || !cfg.token || /Token ung/.test(r.error || '')) return r;
  const alt = await scan(cfg);
  r.steps.push(...alt.steps);
  if (alt.found) {
    detected = { from: cfg.url, url: alt.found.url };
    return { ok: true, usedUrl: alt.found.url, serverCount: alt.found.serverCount, steps: r.steps };
  }
  return r;
}

async function diagnosePrimary(cfg) {
  const steps = [];
  let u;
  try {
    u = new URL(cfg.url);
  } catch {
    return { ok: false, steps, error: 'Ungültige URL' };
  }
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  let addrs;
  if (net.isIP(u.hostname)) addrs = [{ address: u.hostname }];
  else {
    try {
      addrs = await dns.lookup(u.hostname, { all: true });
      steps.push({ name: 'Hostname auflösen', ok: true, detail: `${u.hostname} → ${addrs.map((a) => a.address).join(', ')}` });
    } catch (e) {
      steps.push({ name: 'Hostname auflösen', ok: false, detail: `${u.hostname}: ${e.code || e.message}` });
      return {
        ok: false,
        steps,
        error: `Der Hostname „${u.hostname}“ ist im Container nicht auflösbar. Craftynos muss im selben Docker-Netzwerk wie Crafty laufen, sonst die IP-Adresse des Hosts verwenden.`,
      };
    }
  }
  const probes = [];
  for (const a of addrs) probes.push({ addr: a.address, r: await tcpProbe(a.address, port) });
  const open = probes.some((p) => p.r.ok);
  steps.push({
    name: `Port ${port} erreichbar`,
    ok: open,
    detail: probes.map((p) => `${p.addr}: ${p.r.ok ? 'offen' : p.r.error}`).join(', '),
  });
  if (!open)
    return {
      ok: false,
      steps,
      error: `Port ${port} ist von Craftynos aus nicht erreichbar. Mögliche Ursachen: falscher Port oder falsche IP, eine Firewall (z. B. ufw blockiert oft Container → Host-IP) oder Crafty läuft in einem anderen Docker-Netzwerk. Tipp: den Service-Namen verwenden (https://crafty:8443) oder https://host.docker.internal:${port}.`,
    };
  if (!cfg.token) return { ok: false, steps, error: 'Kein API-Token angegeben.' };
  try {
    const r = await testConnection(cfg);
    steps.push({ name: 'API-Anmeldung (TLS + Token)', ok: true, detail: `${r.serverCount} Server gefunden` });
    return { ok: true, steps, serverCount: r.serverCount };
  } catch (e) {
    steps.push({ name: 'API-Anmeldung (TLS + Token)', ok: false, detail: e.message });
    return { ok: false, steps, error: e.message };
  }
}

export function parsePlayers(v) {
  if (Array.isArray(v)) return v.map((p) => (p && typeof p === 'object' ? p.name : String(p)));
  if (typeof v !== 'string' || !v || v === '[]') return [];
  for (const candidate of [v, v.replace(/'/g, '"')]) {
    try {
      const j = JSON.parse(candidate);
      if (Array.isArray(j)) return j.map((p) => (p && typeof p === 'object' ? p.name : String(p)));
    } catch {
      /* weiter */
    }
  }
  return [];
}

const truthy = (v) => v === true || v === 'True' || v === 'true';
const textValue = (v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const text = String(v).trim();
  return /^(false|null|undefined|\[object .+\])$/i.test(text) ? '' : text;
};

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
    players: parsePlayers(r.players).filter((p) => typeof p === 'string' && p.trim()),
    version: textValue(r.version),
    desc: textValue(r.desc),
    started: textValue(r.started),
    worldSize: r.world_size || '',
    port: r.server_port || null,
  };
}
