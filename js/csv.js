// Minimal RFC-4180 CSV parser/serialiser.
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

export function toCsv(rows) {
  const cell = v => {
    v = v == null ? '' : String(v);
    return /[",\r\n]/.test(v) || v !== v.trim() ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Parse CSV into objects keyed by lower-cased, trimmed header. */
export function parseCsvObjects(text) {
  const [head, ...rest] = parseCsv(text);
  if (!head) return [];
  const keys = head.map(h => h.trim().toLowerCase());
  return rest.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
