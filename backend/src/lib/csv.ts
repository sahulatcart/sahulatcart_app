// Minimal, dependency-free CSV parser (handles quoted fields, embedded commas/newlines).
function tokenize(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse CSV text to header-keyed rows (headers lowercased/trimmed). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = tokenize(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 1) return [];
  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => (o[h] = (r[i] ?? '').trim()));
    return o;
  });
}
