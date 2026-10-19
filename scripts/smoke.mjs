// Rauchtest ohne Crafty: legt Testordner an, startet Craftynos im Volume-Modus
// und prüft Serverliste, Properties, Backup (ZIP) und Verbindungstest.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'craftynos-smoke-'));
const id = '11111111-2222-3333-4444-555555555555';
const srv = path.join(root, 'crafty', 'servers', id);
fs.mkdirSync(path.join(srv, 'Welt', 'region'), { recursive: true });
fs.writeFileSync(path.join(srv, 'server.properties'), '#Minecraft\nmotd=Testserver\nlevel-name=Welt\nmax-players=7\nonline-mode=false\n');
fs.writeFileSync(path.join(srv, 'Welt', 'level.dat'), 'x'.repeat(1000));
fs.writeFileSync(path.join(srv, 'Welt', 'region', 'r.0.0.mca'), 'y'.repeat(5000));
fs.writeFileSync(path.join(srv, 'ops.json'), '[]');

const PORT = 18081;
const env = { ...process.env, PORT, CRAFTY_ROOT: path.join(root, 'crafty'), DATA_DIR: path.join(root, 'data'), CRAFTY_URL: 'https://127.0.0.1:1' };
const p = spawn('node', ['src/server.js'], { env, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 2000));

const get = async (u, o) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${u}`, o);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = (u, b, m = 'POST') => get(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) });
let failed = 0;
const ok = (c, msg) => (console.log(c ? 'OK  ' : 'FAIL', msg), c || failed++);

try {
  const cfg = await get('/config');
  ok(cfg.body.mode === 'volumes', `Modus volumes (${cfg.body.mode})`);
  const list = await get('/servers');
  ok(list.body.length === 1 && list.body[0].name === 'Testserver' && list.body[0].max === 7, 'Server per Volume gefunden, Name aus MOTD');
  const props = await get(`/servers/${id}/properties`);
  ok(props.body.entries.length === 4, 'server.properties lesbar');

  await post('/settings/backup', { format: '{server} {date} {time}: test', includeFolder: true }, 'PUT');
  const job = await post(`/servers/${id}/backups/create`);
  let j;
  for (let i = 0; i < 30; i++) {
    j = (await get(`/backup-jobs/${job.body.jobId}`)).body;
    if (j.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 300));
  }
  ok(j.status === 'done', `Backup fertig: ${j.file ?? j.error}`);
  ok(j.file && !j.file.includes(':') && j.file.endsWith('.zip') && j.file.startsWith('Testserver '), 'Dateiname ohne Doppelpunkt, mit Leerzeichen');
  const bl = await get(`/servers/${id}/backups`);
  ok(bl.body.length === 1 && bl.body[0].size > 100, 'Backup in Liste');

  const start = await post(`/servers/${id}/action/start_server`);
  ok(start.status === 409, 'Start ohne API wird sauber abgelehnt');

  const t = await post('/settings/crafty/test', { url: '127.0.0.1:1', token: 'x' });
  ok(t.status >= 400 && /nicht erreichbar/.test(t.body.error), `Verbindungstest meldet Fehler: ${t.body.error}`);
  await post('/settings/crafty', { url: 'http://10.0.0.5:8443', token: 'abc' }, 'PUT');
  const cfg2 = await get('/config');
  ok(cfg2.body.api.url === 'http://10.0.0.5:8443' && cfg2.body.api.urlSource === 'ui', 'Eingabe in der Oberfläche überschreibt Compose-URL');
} finally {
  p.kill();
  fs.rmSync(root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
