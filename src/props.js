export function parseProps(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    entries.push({ key: line.slice(0, i).trim(), value: line.slice(i + 1) });
  }
  return entries;
}

/** Ersetzt Werte in bestehenden Zeilen (Kommentare/Reihenfolge bleiben), hängt neue Keys an. */
export function applyProps(text, updates) {
  const remaining = new Map(Object.entries(updates).map(([k, v]) => [k, String(v)]));
  const lines = text.split(/\r?\n/).map((line) => {
    if (!line || line.startsWith('#')) return line;
    const i = line.indexOf('=');
    if (i < 0) return line;
    const key = line.slice(0, i).trim();
    if (remaining.has(key)) {
      const v = remaining.get(key).replace(/[\r\n]+/g, ' ');
      remaining.delete(key);
      return `${key}=${v}`;
    }
    return line;
  });
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [k, v] of remaining) lines.push(`${k}=${v.replace(/[\r\n]+/g, ' ')}`);
  return lines.join('\n') + '\n';
}
