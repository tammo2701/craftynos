import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { exists } from './files.js';

const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Platzhalter: {server} {world} {date} {time} {YYYY} {MM} {DD} {HH} {mm} {ss} */
export function formatName(format, vars, d = new Date()) {
  const m = {
    server: vars.server,
    world: vars.world,
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  m.date = `${m.YYYY}-${m.MM}-${m.DD}`;
  m.time = `${m.HH}-${m.mm}-${m.ss}`;
  let s = String(format || '{server} {date} {time}').replace(/\{(\w+)\}/g, (x, k) => (k in m ? m[k] : x));
  // Doppelpunkte & andere unzulässige Dateinamen-Zeichen entfernen
  s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (s || 'Backup') + '.zip';
}

/**
 * Sichert immer nur den World-Ordner (level-name) als ZIP in backupDir.
 * Läuft der Server und ist die API verfügbar (command != null), wird vorher save-off/save-all flush gesendet.
 */
export async function createWorldBackup({ server, dir, level, backupDir, cfg, command, onStep = () => {} }) {
  const worldDir = path.join(dir, level);
  if (!(await exists(worldDir))) throw new Error(`World-Ordner „${level}“ nicht gefunden`);
  await fsp.mkdir(backupDir, { recursive: true });

  const base = formatName(cfg.format, { server: server.server_name, world: level });
  let final = path.join(backupDir, base);
  for (let n = 2; await exists(final); n++) final = path.join(backupDir, base.replace(/\.zip$/, ` (${n}).zip`));
  const tmp = final + '.part';

  let saveOff = false;
  try {
    if (command) {
      onStep('Welt wird gespeichert …');
      await command('save-off');
      saveOff = true;
      await command('save-all flush');
      await sleep(4000);
    }
    onStep('ZIP wird erstellt …');
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      const zip = archiver('zip', { zlib: { level: 6 } });
      out.on('close', resolve);
      out.on('error', reject);
      zip.on('error', reject);
      zip.on('warning', (e) => e.code !== 'ENOENT' && reject(e));
      zip.pipe(out);
      zip.directory(worldDir, cfg.includeFolder === false ? false : level);
      zip.finalize().catch(reject);
    });
    await fsp.rename(tmp, final);
  } finally {
    if (saveOff) await command('save-on').catch(() => {});
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
  return path.relative(backupDir, final).split(path.sep).join('/');
}
