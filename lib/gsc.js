/**
 * Local Google Search Console CSV import (no login, no API, no network).
 *
 * Accepts the CSV files the Search Console UI exports (Portuguese or English headers) and any CSV with the
 * same column names. A query is linked to a URL ONLY when both are in the same row of the same file.
 * A file with queries only never gets URLs from another file (e.g. the separate "Páginas" export), and
 * metrics are never summed or mixed across rows, files or date ranges.
 */
import { fold } from '../web/js/classify.js';
import { domainToUnicode } from 'node:url';
import { WS, trimWS } from '../web/js/normalize.js';

/**
 * Join key between an observed phrase and a Search Console query: NFC, lower-case, whitespace collapsed — nothing else.
 * Unlike the miner's de-duplication key it keeps zero-width joiners ("curso 👩‍💻" ≠ "curso 👩💻"), combining marks and accents.
 */
export const gscKey = (s) => trimWS(String(s ?? '').normalize('NFC').toLowerCase().replace(WS, ' '));

/**
 * RFC 4180-ish CSV parser: BOM, quoted fields, "" escapes, CRLF/LF, delimiter auto-detected (, ; tab).
 * Every row keeps the 1-based line number where it starts (for diagnostics and evidence).
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  // First complete RECORD (a quoted header may contain line breaks), skipping blank lines.
  let firstLine = '';
  for (let i = 0, q = false, start = 0; i <= src.length; i++) {
    const ch = src[i];
    if (ch === '"') q = !q;
    if (!q && (ch === '\n' || ch === '\r' || i === src.length)) {
      const rec = src.slice(start, i);
      if (rec.trim() !== '') { firstLine = rec; break; }
      if (ch === '\r' && src[i + 1] === '\n') i++;
      start = i + 1;
    }
  }
  const outside = firstLine.replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((d) => [d, outside.split(d).length - 1]).sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 0 ? counts[0][0] : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closed = false;   // just left a quoted field: only a delimiter or a line break may follow
  let malformed = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    row.push(cell); cell = '';
    if (row.some((x) => x.trim() !== '')) rows.push({ line: rowLine, cells: row, ...(malformed ? { malformed: true } : {}) });
    row = []; malformed = false; closed = false;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else { if (c === '\n' || (c === '\r' && src[i + 1] !== '\n')) line += 1; cell += c; }
    } else if (c === '"' && trimWS(cell) === '' && !closed) { quoted = true; cell = ''; } // opens a field at its start, also after spaces (`a, "b,c"`); 'tubo 2" pvc' stays literal
    else if (c === '"' && !closed && /^[\p{Cf}\s]+$/u.test(cell)) { malformed = true; cell += c; } // invisible char + quote: not trustworthy
    else if (c === delim) { row.push(cell); cell = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line += 1; rowLine = line;
    } else {
      if (closed) malformed = true; // text after a closing quote ("1"2, "s"im): the cell is not trustworthy
      cell += c;
    }
  }
  if (quoted) throw new Error(`CSV inválido: aspas não fechadas a partir da linha ${rowLine}`);
  endRow();
  const [head, ...body] = rows;
  if (head?.malformed || head?.cells.some((h) => h.includes('"'))) throw new Error('CSV inválido: cabeçalho com aspas fora do lugar');
  return { delimiter: delim, header: head ? head.cells.map((h) => h.trim()) : [], rows: body };
}

/** Accepted header names (compared folded: no accents, lower-case). */
export const GSC_HEADERS = {
  query: ['consultas principais', 'consulta principal', 'consultas', 'consulta', 'top queries', 'top query', 'queries', 'query', 'search query'],
  page: ['paginas principais', 'pagina principal', 'paginas', 'pagina', 'pagina de destino', 'url da pagina', 'top pages', 'top page', 'pages', 'page', 'landing page', 'url'],
  clicks: ['cliques', 'clicks'],
  impressions: ['impressoes', 'impressions'],
  ctr: ['ctr', 'ctr (%)'],
  position: ['posicao', 'posicao media', 'position', 'average position', 'avg. position', 'avg position'],
};

export function mapHeaders(header, name = 'arquivo') {
  const map = {};
  header.forEach((h, i) => {
    const k = fold(h).replace(/\s+/g, ' ').trim();
    for (const [field, names] of Object.entries(GSC_HEADERS)) {
      if (!names.includes(k)) continue;
      // Two columns for the same field (e.g. "Clicks" and "Cliques") conflict: refuse instead of picking one.
      if (map[field] !== undefined) throw new Error(`${name}: colunas repetidas para o mesmo campo ("${header[map[field]]}" e "${h}")`);
      map[field] = i;
    }
  });
  return map;
}

// Trim only: internal spaces are NOT thousands separators here ("1 2" is invalid, not 12).
const trimmed = (raw) => String(raw ?? '').trim();
const isMissing = (s) => !s || s === '-' || s === '—' || s === '--';
const DEC_COMMA = [/^\d+,\d+$/, /^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/];
const DEC_DOT = [/^\d+\.\d+$/, /^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/];
const AMBIGUOUS = /^[1-9]\d{0,2}[.,]\d{3}$/; // "0.123" is a plain decimal, never a thousands group
const withoutPercent = (s) => s.replace(/%$/, '');
const MAX = Number.MAX_SAFE_INTEGER;

/**
 * Number convention of a file, from VALID values only.
 * Decimal columns (CTR, position) vote with their decimal symbol ("12,5", "1.234,5"); "1,234"/"1.234" alone are ambiguous.
 * Integer columns (clicks, impressions) vote with their thousands symbol: "1.234" means a decimal comma file.
 * @returns {',' | '.' | null | 'misto'}  null = no evidence; 'misto' = the file uses both conventions.
 */
export function detectFileFormat(decimalValues = [], integerValues = [], percentValues = []) {
  const votes = new Set();
  // "%" is only valid in CTR (percentValues); a position like "1,5%" is invalid and does not vote.
  for (const v of [...decimalValues.map((x) => trimmed(x)), ...percentValues.map((x) => withoutPercent(trimmed(x)))]) {
    const s = v;
    if (isMissing(s) || /^\d+$/.test(s) || AMBIGUOUS.test(s)) continue;
    // Only a value the parser would really import may vote (e.g. not "1000000000000000,5").
    if (DEC_COMMA.some((re) => re.test(s)) && parseDecimal(s, ',').value !== null) votes.add(',');
    else if (DEC_DOT.some((re) => re.test(s)) && parseDecimal(s, '.').value !== null) votes.add('.');
  }
  for (const v of integerValues) {
    const t = trimmed(v);
    const m = /^[1-9]\d{0,2}([.,])\d{3}(?:\1\d{3})*$/.exec(t);
    // Only a count that would really be imported may vote (an unsafe 2^53+ value does not).
    if (m && Number.isSafeInteger(Number(t.replace(/[.,]/g, '')))) votes.add(m[1] === '.' ? ',' : '.');
  }
  if (votes.size > 1) return 'misto';
  return votes.size ? [...votes][0] : null;
}
/** Decimal symbol from decimal-column values only. */
export const detectDecimal = (values) => detectFileFormat(values, []);

/**
 * Integer (clicks, impressions): "1234", or one consistent thousands symbol ("1.234.567"); when the file's decimal
 * symbol is known, only the other symbol may group thousands. Percent signs and inner spaces are invalid.
 * Empty / "-" -> null (missing, never zero).
 * @returns {{ value: number|null, error?: string }}
 */
export function parseInteger(raw, decimal = null) {
  const s = trimmed(raw);
  if (isMissing(s)) return { value: null };
  const m = /^[1-9]\d{0,2}([.,])\d{3}(?:\1\d{3})*$/.exec(s);
  const digits = /^\d+$/.test(s) ? s : m && (!decimal || m[1] !== decimal) ? s.replace(/[.,]/g, '') : null;
  if (digits !== null) {
    const n = Number(digits);
    // Beyond 2^53 a JavaScript number silently changes the value: refuse instead of importing a different count.
    return Number.isSafeInteger(n) && n <= MAX ? { value: n } : { value: null, error: `inteiro grande demais "${raw}"` };
  }
  return { value: null, error: `inteiro inválido "${raw}"${decimal ? ` (separador decimal do arquivo: "${decimal}")` : ''}` };
}

/**
 * Decimal (CTR, position) with the file's decimal symbol; a trailing "%" is allowed (CTR). An ambiguous "1,234"/"1.234"
 * in a file without a known convention is reported, not guessed.
 * @returns {{ value: number|null, error?: string }}
 */
export function parseDecimal(raw, decimal, { percent = false } = {}) {
  const t = trimmed(raw);
  if (!percent && /%$/.test(t)) return { value: null, error: `"%" só é aceito no CTR ("${raw}")` };
  const s = percent ? withoutPercent(t) : t;
  if (isMissing(s)) return { value: null };
  if (/^\d+$/.test(s)) { const n = Number(s); return Number.isSafeInteger(n) ? { value: n } : { value: null, error: `número fora do intervalo "${raw}"` }; }
  if (!decimal && AMBIGUOUS.test(s)) return { value: null, error: `número ambíguo "${raw}" (milhar ou decimal?) e o arquivo não mostra o separador decimal` };
  const dec = decimal === ',' || decimal === '.' ? decimal : (DEC_COMMA.some((re) => re.test(s)) ? ',' : '.');
  const ok = (dec === ',' ? DEC_COMMA : DEC_DOT).some((re) => re.test(s));
  if (!ok) return { value: null, error: `número inválido "${raw}" (separador decimal do arquivo: "${dec}")` };
  // 16–17 significant digits are normal spreadsheet / Looker floats and are accepted; what is refused is a non-zero
  // value that underflows to 0 (below) and magnitudes out of range.
  const n = Number(s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.'));
  // Finite and within a sane magnitude (a 310-digit "position" is not a measurement).
  // A non-zero value that becomes 0 (underflow) is refused instead of being imported as a real zero.
  if (n === 0 && /[1-9]/.test(s)) return { value: null, error: `número pequeno demais "${raw}"` };
  return Number.isFinite(n) && Math.abs(n) < 1e15 ? { value: n } : { value: null, error: `número fora do intervalo "${raw}"` };
}

// Tracking parameters ignored when COMPARING URLs (the original URL is always kept in the output).
const TRACKING = /^(utm_[a-z_]+|srsltid|gclid|fbclid|msclkid|_ga)$/i;

/**
 * Canonical form for comparing URLs: http(s) only, host lower-case, no #fragment, no tracking parameters.
 * Paths are compared exactly (trailing slash included). Returns null for anything else (relative paths, javascript:, mailto:…).
 */
export function canonicalUrl(u) {
  const raw = trimWS(u); // String#trim would silently drop a trailing U+FEFF
  // Control characters or spaces INSIDE the URL: refused, never "repaired" by the URL parser into another address.
  // Also invisible format characters (U+200B, U+FEFF…), which the URL parser would silently drop.
  if (/[\p{Cc}\p{Cf}\p{Z}\s\\]/u.test(raw) || !/^https?:\/\/[^/]/i.test(raw)) return null; // also "https:host" and "\\" repairs
  // Percent-encoded host (e.g. "exe%E2%80%8Bmplo.test") or encoded invisible characters anywhere: refused too.
  if (/^https?:\/\/[^/?#]*%/i.test(raw)) return null;
  // Decode each valid %XX run on its own, so a lone literal "%" (e.g. "?q=100%") cannot skip the check for the rest.
  let badEncoding = false;
  const decoded = raw.replace(/(?:%[0-9a-f]{2})+/gi, (m) => { try { return decodeURIComponent(m); } catch { badEncoding = true; return m; } });
  if (badEncoding || /[\p{Cc}\p{Cf}]/u.test(decoded)) return null; // invalid UTF-8 could hide an invisible character
  try {
    const x = new URL(raw);
    if (!/^https?:$/.test(x.protocol)) return null;
    // No credentials (they would be dropped silently) and no host "repair": the host typed in the file must be exactly the
    // parsed host (ASCII or its Unicode/IDN form) — UTS #46 would otherwise delete or map characters (U+FE0F, fullwidth…).
    if (x.username || x.password) return null;
    const rawHost = /^https?:\/\/([^/?#]*)/i.exec(raw)[1].replace(/:\d*$/, '').normalize('NFC').toLowerCase();
    if (rawHost !== x.hostname && rawHost !== domainToUnicode(x.hostname)) return null;
    // Filter the raw query string: re-serialising it would change the encoding of the remaining parameters (%20 → +).
    const kept = x.search.replace(/^\?/, '').split('&').filter((part) => {
      if (!part) return false;
      let key = part.split('=')[0];
      try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch { /* keep raw */ }
      return !TRACKING.test(key);
    });
    // The trailing slash is kept: "/cursos/x" and "/cursos/x/" may be different pages for the site and for Google.
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname}${kept.length ? `?${kept.join('&')}` : ''}`;
  } catch { return null; }
}

export const GSC_KINDS = { both: 'consulta+pagina', query: 'consulta', page: 'pagina' };

/**
 * Load one Search Console CSV.
 * @returns {{ name, kind, decimal, rows: object[], warnings: string[] }}
 *   kind 'pagina' files have no rows usable for joining. An unrecognised header throws (diagnostic, not "no data").
 */
export function loadGscCsv(text, name = 'search-console.csv') {
  const { header, rows } = parseCsv(text);
  const h = mapHeaders(header, name);
  const warnings = [];
  const hasQ = h.query !== undefined;
  const hasP = h.page !== undefined;
  if (!hasQ && !hasP) {
    throw new Error(`${name}: cabeçalho não reconhecido (${header.join(', ') || 'vazio'}). Esperado uma coluna de consulta `
      + '("Consultas principais", "Consulta", "Top queries", "Query") — e, opcionalmente, "Página"/"Page", "Cliques"/"Clicks", '
      + '"Impressões"/"Impressions", "CTR", "Posição"/"Position".');
  }
  const kind = hasQ && hasP ? GSC_KINDS.both : hasQ ? GSC_KINDS.query : GSC_KINDS.page;
  if (kind === GSC_KINDS.page) {
    warnings.push(`${name}: só tem páginas, sem coluna de consulta — ignorado no cruzamento (não há vínculo explícito consulta → página).`);
    return { name, kind, decimal: null, rows: [], warnings };
  }
  if (kind === GSC_KINDS.query) warnings.push(`${name}: só consultas — nenhuma URL será associada (não deduzimos URL a partir de outro arquivo).`);
  const known = new Set(Object.values(h));
  const unknown = header.filter((_, i) => !known.has(i));
  if (!['clicks', 'impressions', 'ctr', 'position'].some((f) => h[f] !== undefined)) {
    warnings.push(`${name}: nenhuma métrica reconhecida${unknown.length ? ` (colunas ignoradas: ${unknown.join(', ')} — exportação em modo de comparação de períodos?)` : ''}; cliques, impressões e posição ficam "não informados".`);
  } else if (unknown.length) warnings.push(`${name}: colunas ignoradas: ${unknown.join(', ')}.`);
  const cell = (r, f) => (h[f] === undefined ? '' : r.cells[h[f]] ?? '');
  // Only rows that will be imported (right width, well-formed, with a query) decide the number convention.
  const valid = rows.filter((r) => r.cells.length === header.length && !r.malformed && trimWS(r.cells[h.query]));
  const decimal = detectFileFormat(valid.map((r) => cell(r, 'position')), valid.flatMap((r) => [cell(r, 'clicks'), cell(r, 'impressions')]), valid.map((r) => cell(r, 'ctr')));
  if (decimal === 'misto') throw new Error(`${name}: o arquivo mistura vírgula e ponto como separador decimal; exporte de novo sem editar.`);
  const out = [];
  let rejected = 0;
  for (const r of rows) {
    // A row with the wrong number of cells has shifted columns ("1,234" unquoted would become 1 click + 234 impressions):
    // it is NOT imported.
    if (r.cells.length !== header.length || r.malformed) {
      rejected += 1;
      warnings.push(`${name}: linha ${r.line} ignorada — ${r.malformed ? 'aspas mal formadas (texto depois das aspas de fechamento ou caractere invisível antes da abertura)' : `tem ${r.cells.length} colunas e o cabeçalho tem ${header.length}`} (confira aspas e separador).`);
      continue;
    }
    const query = trimWS(cell(r, 'query')); // keeps U+FEFF (String#trim would drop it)
    if (!query) continue;
    let page = null;
    let pageInvalid = '';
    if (kind === GSC_KINDS.both) {
      const raw = trimWS(cell(r, 'page')); // String#trim would drop U+FEFF before validation
      if (raw && canonicalUrl(raw)) page = raw;
      else if (raw) { pageInvalid = raw; warnings.push(`${name}: linha ${r.line}: URL inválida ("${raw}") — não usada.`); }
    }
    const metric = (f, parse) => {
      if (h[f] === undefined) return null;
      const res = parse(cell(r, f));
      if (res.error) warnings.push(`${name}: linha ${r.line}: ${f}: ${res.error} — tratado como não informado.`);
      return res.value;
    };
    out.push({
      file: name,
      line: r.line,
      query,
      norm: gscKey(query),
      page,
      pageInvalid,
      clicks: metric('clicks', (v) => parseInteger(v, decimal)),
      impressions: metric('impressions', (v) => parseInteger(v, decimal)),
      ctr: metric('ctr', (v) => parseDecimal(v, decimal, { percent: true })),
      position: metric('position', (v) => parseDecimal(v, decimal)),
    });
  }
  return { name, kind, decimal, rows: out, rejected, warnings };
}

/**
 * Index rows by normalised query. Conservative: NFC + case + whitespace only — accents are significant
 * ("preço" ≠ "preco") and there is no fuzzy matching.
 */
export function indexGsc(files) {
  const idx = new Map();
  for (const f of files) for (const r of f.rows) {
    if (!idx.has(r.norm)) idx.set(r.norm, []);
    idx.get(r.norm).push(r);
  }
  return idx;
}
