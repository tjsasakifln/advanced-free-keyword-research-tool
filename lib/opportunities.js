/**
 * Opportunities: observed suggestion -> evidence -> existing candidate page -> concrete improvement.
 *
 * Inputs are local files only: the evidence JSON exported by the miner (schema afkrt-br/evidencias@1),
 * optional Search Console CSVs (see gsc.js) and an optional inventory of existing pages authorised for
 * editorial improvements. Nothing is fetched or published. A candidate URL is ALWAYS a URL of the inventory.
 */
import { normalizeKeyword, trimWS, WS } from '../web/js/normalize.js';
import { classifyObservations, fold, familyOfStrategy } from '../web/js/classify.js';
import { csvCell, EVIDENCE_SCHEMA, sortTimes } from '../web/js/export.js';
import { sourceTypeOf } from '../web/js/miner.js';
import { isValidLang, isValidCountry } from '../web/js/engines.js';
import { parseCsv, canonicalUrl, indexGsc, GSC_KINDS, gscKey } from './gsc.js';

export const STATUS = {
  candidate: 'candidata definida',
  ambiguous: 'ambígua',
  conflict: 'revisar: URL observada no Search Console com intenção divergente',
  intent: 'intenção não cabe em nenhuma página do inventário',
  none: 'nenhuma página do inventário atende',
  noInventory: 'inventário não informado',
};
export const GSC_STATUS = {
  data: 'com dados',
  noMatch: 'sem dados no recorte',
  noUsable: 'nenhum arquivo do Search Console utilizável',
  notGiven: 'search console não informado',
  allRejected: 'nenhuma linha válida no Search Console (todas recusadas)',
};

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Folded phrase contains the folded term as whole words. */
const hasTerm = (f, t) => new RegExp(`(?:^|\\s)${esc(t)}(?=\\s|$)`, 'u').test(f);
const hasAny = (f, list) => list.some((t) => hasTerm(f, t));

// ---------------- inventory ----------------
const INV_HEADERS = {
  url: ['url', 'pagina', 'page', 'endereco'],
  title: ['titulo', 'title', 'nome'],
  terms: ['termos', 'terms', 'palavras-chave', 'palavras chave', 'keywords', 'temas', 'topics'],
  intents: ['intencoes', 'intencao', 'intents', 'intent', 'tipo'],
  authorized: ['autorizada', 'autorizado', 'authorized', 'permitida'],
};
// Free-text columns allowed (and ignored) in the inventory.
const NOTE_HEADERS = new Set(['notas', 'nota', 'observacoes', 'observacao', 'comentarios', 'comentario', 'notes']);
/** Authorisation value: case and accents ignored, surrounding whitespace removed (U+FEFF kept), punctuation kept. */
const authValue = (v) => trimWS(String(v ?? '')).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const YES = new Set(['sim', 's', 'yes', 'y', 'true', '1', 'x', 'autorizada', 'autorizado']);
const NO = new Set(['nao', 'n', 'no', 'false', '0', '']);
/**
 * Intents a page can declare in `intencoes`. Page types: ferramenta, servico, local. Editorial: conteudo (answers
 * questions; also accepts comparacao and preco), comparacao, preco.
 */
export const PAGE_INTENTS = ['ferramenta', 'servico', 'local', 'conteudo', 'comparacao', 'preco'];
// Inventory terms that would match almost any phrase: ignored (with a warning) so they never pick a page.
const GENERIC_TERMS = new Set(['para', 'pra', 'com', 'sem', 'em', 'de', 'do', 'da', 'no', 'na', 'online', 'gratis', 'gratuito', 'preco', 'valor',
  'melhor', 'como', 'o que', 'qual', 'arquivo', 'arquivos', 'projeto', 'projetos', 'ferramenta', 'ferramentas', 'servico', 'servicos', 'site', 'app']);
// Lists inside a cell use "|" only (";" is the column separator of many Brazilian spreadsheets).
// Words that carry no subject on their own: they never make a term more specific ("projeto de" is not more specific than a subject word).
const GENERIC_WORDS = new Set([...GENERIC_TERMS, 'a', 'o', 'as', 'os', 'e', 'ou', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'pra', 'por', 'com', 'sem', 'que', 'como', 'qual', 'quais', 'mais', 'melhor', 'gratis', 'gratuito', 'barato', 'novo',
  'completo', 'simples', 'facil', 'rapido', 'profissional', 'bom', 'otimo', 'grande', 'pequeno', 'documento', 'programa', 'sistema', 'util', 'pratico']);
/** Generic word, including plural and feminine forms ("melhores", "gratuitas", "ferramentas", "arquivos", "serviços"). */
export function isGenericWord(w) {
  const forms = [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/as$/, 'o'), w.replace(/a$/, 'o'), w.replace(/oes$/, 'ao'), w.replace(/ais$/, 'al'),
    w.replace(/eis$/, 'il'), w.replace(/ns$/, 'm'), w.replace(/oas?$/, 'om')];
  return forms.some((f) => GENERIC_WORDS.has(f));
}
/** Number of words of a term that are not generic (its specificity). */
export const specificWords = (term) => term.split(' ').filter((w) => w && !isGenericWord(w)).length;

const splitList = (s) => String(s || '').split('|').map((x) => fold(x)).filter(Boolean);

/**
 * Inventory CSV: `url` (required), `titulo`, `termos` (separated by |), `intencoes`, `autorizada`.
 * With an `autorizada` column only rows with an affirmative value are used; without it, the whole file is
 * taken as the list of pages authorised for editorial improvements.
 */
export function loadInventoryCsv(text, name = 'inventario.csv') {
  const { header, rows } = parseCsv(text);
  const h = {};
  header.forEach((x, i) => {
    const k = fold(x).trim();
    for (const [f, names] of Object.entries(INV_HEADERS)) {
      if (!names.includes(k)) continue;
      // Conflicting columns (two "autorizada", "url" and "página"…) are refused, never resolved by position.
      if (h[f] !== undefined) throw new Error(`${name}: colunas repetidas para o mesmo campo ("${header[h[f]]}" e "${x}")`);
      h[f] = i;
    }
  });
  if (h.url === undefined) throw new Error(`${name}: o inventário precisa de uma coluna "url" (cabeçalho lido: ${header.join(', ') || 'vazio'})`);
  const known = new Set(Object.values(h));
  for (const [i, x] of header.entries()) {
    if (known.has(i) || NOTE_HEADERS.has(fold(x).trim())) continue;
    // Any other column is refused: a misspelt "autorizada" must never turn every row into an authorised page.
    throw new Error(`${name}: coluna "${x}" não reconhecida${/autor|author|permi/.test(fold(x)) ? ' (parece de autorização: use "autorizada")' : ''}. `
      + `Colunas aceitas: url, titulo, termos, intencoes, autorizada e, para anotações, notas/observacoes/comentarios.`);
  }
  const warnings = [];
  const pages = [];
  const seen = new Set();
  let excluded = 0;
  // First pass: every canonical URL that has at least one row NOT clearly authorised. A URL listed as "sim" in one row and
  // "não" (or anything else) in another is a conflict: it is never recommended until the inventory is fixed.
  const notAuthorised = new Set();
  if (h.authorized !== undefined) {
    for (const r of rows) {
      if (r.cells.length !== header.length || r.malformed) continue;
      const canon = canonicalUrl(trimWS(r.cells[h.url] ?? ''));
      const a = authValue(r.cells[h.authorized]);
      if (canon && !YES.has(a)) notAuthorised.add(canon);
    }
  }
  for (const r of rows) {
    if (r.cells.length !== header.length || r.malformed) {
      // Shifted or broken cells could turn text into an authorisation: the row is not used.
      excluded += 1;
      warnings.push(`${name}: linha ${r.line} ignorada — ${r.malformed ? 'aspas mal formadas (texto depois das aspas de fechamento ou caractere invisível antes da abertura)' : `tem ${r.cells.length} colunas e o cabeçalho tem ${header.length}`} (confira aspas e separadores; listas usam "|").`);
      continue;
    }
    const cell = (f) => (h[f] === undefined ? '' : trimWS(r.cells[h[f]] ?? '')); // keeps U+FEFF (String#trim drops it)
    const raw = cell('url');
    if (!raw) continue;
    const canon = canonicalUrl(raw);
    if (!canon) { warnings.push(`${name}: linha ${r.line}: URL inválida ignorada ("${raw}").`); continue; }
    if (h.authorized !== undefined && notAuthorised.has(canon)) {
      const a0 = authValue(cell('authorized'));
      if (YES.has(a0)) {
        excluded += 1;
        warnings.push(`${name}: linha ${r.line}: autorização conflitante para ${raw} (outra linha da mesma URL não está autorizada) — página NÃO usada.`);
        continue;
      }
    }
    if (h.authorized !== undefined) {
      // Exact value (case and accents ignored, punctuation NOT): "sim?" is not an authorisation.
      const a = authValue(cell('authorized'));
      if (!YES.has(a)) {
        excluded += 1;
        if (!NO.has(a)) warnings.push(`${name}: linha ${r.line}: valor de "autorizada" não reconhecido ("${cell('authorized')}") — página NÃO usada (use sim/não).`);
        continue;
      }
    }
    if (seen.has(canon)) { warnings.push(`${name}: linha ${r.line}: URL repetida ignorada (${raw}).`); continue; }
    seen.add(canon);
    const intents = [];
    const unknownIntents = [];
    for (const it of splitList(cell('intents'))) (PAGE_INTENTS.includes(it) ? intents : unknownIntents).push(it);
    if (unknownIntents.length) {
      // An unknown value is not an empty column: the page would silently accept everything. Leave it out.
      excluded += 1;
      warnings.push(`${name}: linha ${r.line}: intenção desconhecida "${unknownIntents.join('|')}" — página NÃO usada (use ${PAGE_INTENTS.join(', ')}).`);
      continue;
    }
    const terms = [];
    for (const t of splitList(cell('terms'))) {
      if (t.length < 3 || GENERIC_TERMS.has(t) || specificWords(t) === 0) warnings.push(`${name}: linha ${r.line}: termo genérico "${t}" ignorado (casaria com quase qualquer frase).`);
      else terms.push(t);
    }
    if (!terms.length) warnings.push(`${name}: linha ${r.line}: ${raw} não tem termos específicos — só pode ser candidata via URL observada no Search Console.`);
    pages.push({ url: raw, canon, line: r.line, title: cell('title'), terms, intents });
  }
  return { name, pages, excluded, warnings };
}

// ---------------- phrase intent (heuristic) ----------------
const LOCAL = ['perto de', 'perto de mim', 'proximo de mim', 'proximo a mim', 'na minha regiao', 'na minha cidade'];
const SERVICE = ['empresa', 'empresas', 'contratar', 'contratacao', 'servico', 'servicos', 'consultoria', 'orcamento', 'profissional', 'tecnico', 'instalacao', 'manutencao',
  'engenheiro', 'engenheira', 'arquiteto', 'arquiteta', 'advogado', 'contador', 'laudo', 'elaboracao']; // professions: generic examples
const TOOL = ['online', 'converter', 'conversor', 'conversao', 'abrir', 'editar', 'editor', 'visualizar', 'visualizador', 'leitor', 'app', 'aplicativo', 'software', 'programa', 'baixar', 'download'];

const PRICE = ['quanto custa', 'preco', 'precos', 'valor', 'barato', 'barata', 'gratis', 'gratuito', 'gratuita', 'de graca', 'orcamento'];

/**
 * Intents of a phrase (heuristic): page types local / servico / ferramenta and editorial conteudo (questions),
 * comparacao, preco. None = any page.
 */
export function phraseIntents(phrase, textFamilies = []) {
  const f = fold(phrase);
  const out = [];
  if (hasAny(f, LOCAL)) out.push('local');
  if (hasAny(f, SERVICE)) out.push('servico');
  if (hasAny(f, TOOL)) out.push('ferramenta');
  if (textFamilies.includes('perguntas')) out.push('conteudo');
  if (textFamilies.includes('comparacoes')) out.push('comparacao');
  if (hasAny(f, PRICE)) out.push('preco');
  return out;
}

const pageAccepts = (page, i) => page.intents.includes(i) || ((i === 'comparacao' || i === 'preco') && page.intents.includes('conteudo'));
/**
 * Intent gate. A page without declared intents accepts any phrase. Otherwise "local" is mandatory when the phrase has it,
 * and among the other intents one accepted intent is enough ("consultoria online" fits a service page).
 */
export function intentOk(page, intents) {
  if (!page.intents.length || !intents.length) return true;
  if (intents.includes('local') && !page.intents.includes('local')) return false;
  const rest = intents.filter((i) => i !== 'local');
  return !rest.length || rest.some((i) => pageAccepts(page, i));
}

// ---------------- improvement rules ----------------
// Public file-format extensions (office, image, media, archive, CAD/BIM, GIS, 3D) — generic vocabulary, not a site inventory.
const FILE_FORMATS = ['pdf', 'doc', 'docx', 'odt', 'txt', 'rtf', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'tif', 'tiff', 'heic',
  'mp3', 'mp4', 'mov', 'avi', 'zip', 'rar', '7z', 'xml', 'json', 'html',
  'dwg', 'dxf', 'dwf', 'dgn', 'ifc', 'rvt', 'rfa', 'skp', 'nwd', 'nwc', 'step', 'stp', 'iges', 'igs', 'stl', 'obj', 'fbx', '3dm', 'pln',
  'kml', 'kmz', 'shp', 'geojson', 'las', 'laz', 'e57'];

/**
 * Conversion direction from the connector before the target format: "converter pdf em word ou odt" -> "PDF → WORD ou ODT",
 * "converter para docx a partir de pdf" -> "PDF → DOCX". Null when the phrase does not say it.
 */
function conversion(words, formats) {
  const fmts = new Set(formats.map((x) => x.toLowerCase()));
  const at = words.findIndex((w, i) => ['em', 'para', 'pra', 'to'].includes(w) && fmts.has(words[i + 1]));
  if (at < 0) return null;
  const partir = words.findIndex((w, i) => w === 'partir' && words[i + 1] === 'de');
  const isFmt = (w) => fmts.has(w);
  let sources = words.slice(0, at).filter(isFmt);
  let targets = words.slice(at + 1).filter(isFmt);
  if (partir > at) { sources = words.slice(partir + 2).filter(isFmt); targets = words.slice(at + 1, partir).filter(isFmt); }
  if (!sources.length || !targets.length) return null;
  return `${[...new Set(sources)].map((x) => x.toUpperCase()).join(', ')} → ${[...new Set(targets)].map((x) => x.toUpperCase()).join(' ou ')}`;
}

/**
 * One concrete editorial improvement for the candidate page, derived from the phrase text only.
 * Worded as "check, and if missing, add" — the page content itself was not verified by this tool.
 */
export function suggestImprovement(phrase, textFamilies = []) {
  const f = fold(phrase);
  const words = f.split(' ');
  const q = `“${String(phrase).trim()}”`;
  const formats = [...new Set(words.filter((w) => FILE_FORMATS.includes(w)))].map((x) => x.toUpperCase());
  if (formats.length >= 2 && hasAny(f, ['em', 'para', 'pra', 'to', 'converter', 'conversor', 'conversao', 'convert'])) {
    const dir = conversion(words, formats);
    const what = dir ? `a conversão ${dir}` : `a conversão entre ${formats.join(' e ')}`;
    return `Conferir se a página diz claramente se ${what} é suportada; se não disser, esclarecer isso com os limites (tamanho, versão, o que se perde na conversão) e um exemplo do resultado — responde a ${q}.`;
  }
  if (textFamilies.includes('comparacoes')) return `Conferir se a página compara as opções citadas em ${q}; se não, acrescentar uma seção curta com as diferenças práticas e quando usar cada uma.`;
  if (hasAny(f, ['o que e', 'o que significa', 'para que serve', 'pra que serve'])) return `Conferir se a página define o termo logo no início; se não, acrescentar uma definição curta que responda ${q}.`;
  if (hasAny(f, ['quanto custa', 'preco', 'precos', 'valor', 'barato', 'barata', 'gratis', 'gratuito', 'gratuita', 'de graca'])) return `Conferir se a página explica o preço e o que é gratuito; se não, explicar o custo e os limites do uso gratuito — responde a ${q}.`;
  // "sem X" is usually what the phrase adds ("editor de vídeo online sem marca d’água"); "sem instalar/baixar" is about where it runs.
  if (hasTerm(f, 'sem') && !hasAny(f, ['sem instalar', 'sem baixar'])) {
    const m = /(?:^|\s)sem(?:\s+(.+))?$/iu.exec(String(phrase).trim());
    const what = m && m[1] ? `“sem ${m[1]}”` : 'o “sem …” da busca';
    return `Conferir se a página explica o limite ou requisito citado (${what}); se não, explicar o que é possível e o que não é — responde a ${q}.`;
  }
  if (hasAny(f, ['online', 'no celular', 'pelo celular', 'no navegador', 'sem instalar', 'sem baixar', 'android', 'iphone', 'mac', 'linux'])) {
    return `Conferir se a página diz onde funciona; se não, explicar (navegador, celular, sistema), os requisitos e se é preciso instalar algo — responde a ${q}.`;
  }
  if (formats.length === 1) return `Conferir se a página lista os formatos suportados; se não, esclarecer o suporte a ${formats[0]} (versões, tamanho máximo) e o que não é possível fazer — responde a ${q}.`;
  if (hasAny(f, LOCAL)) return `Conferir se a página informa a área de atendimento; se não, informar onde o serviço é prestado e como solicitar — responde a ${q}.`;
  if (textFamilies.includes('perguntas')) return `Conferir se a página responde ${q}; se não, acrescentar uma resposta direta com um passo a passo curto e um exemplo.`;
  if (hasTerm(f, 'com')) return `Conferir se a página mostra esse caso de uso; se não, acrescentar um exemplo que cubra ${q}.`;
  return `Conferir se a página responde à busca ${q}; se não, acrescentar uma resposta direta com um exemplo concreto.`;
}

// ---------------- candidate choice ----------------
/** How many inventory pages declare a term (fewer = more specific). */
function termRarity(inventory) {
  const n = new Map();
  for (const p of inventory.pages) for (const t of new Set(p.terms)) n.set(t, (n.get(t) || 0) + 1);
  return n;
}
/**
 * Most specific matching term of a page: more NON-GENERIC words first, then the term fewer pages share. String length is NOT a
 * criterion ("converter" is not more specific than "pdf"); remaining ties are reported as ambiguous.
 */
function bestTerm(f, page, rarity) {
  let best = null;
  for (const t of page.terms) {
    if (!hasTerm(f, t)) continue;
    const score = [specificWords(t), -(rarity.get(t) || 1)];
    if (!best || cmpArr(score, best.score) > 0) best = { term: t, score };
  }
  return best;
}
const cmpArr = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const cmpScore = (a, b) => cmpArr(b.score, a.score);
const where = (refs) => refs.map((r) => `${r.file}, linha ${r.line}`).join('; ');

/**
 * Pick at most one inventory page for a phrase. Intent gating comes first; then an explicit Search Console
 * link (query and URL in the same row) to an inventory page; then the most specific inventory term.
 * Ties are never broken. An observed page whose declared intent conflicts is NOT swapped for another page silently.
 * @param {string} phrase
 * @param {{url:string, file:string, line:number}[]} observed  explicit Search Console links for this phrase
 * @returns {{ status, url, reason, options: string[], intents: string[] }}
 */
export function chooseCandidate(phrase, observed, inventory, textFamilies = []) {
  const intents = phraseIntents(phrase, textFamilies);
  if (!inventory) return { status: STATUS.noInventory, url: '', reason: 'Nenhum inventário de páginas autorizadas foi informado (--inventario).', options: [], intents };
  const byCanon = new Map(inventory.pages.map((p) => [p.canon, p]));
  const f = fold(phrase);
  // Observed inventory pages, each with the file/line references that link it to this query.
  const obsPages = new Map();
  for (const o of observed) {
    const c = canonicalUrl(o.url);
    if (!c || !byCanon.has(c)) continue;
    if (!obsPages.has(c)) obsPages.set(c, { page: byCanon.get(c), refs: [] });
    obsPages.get(c).refs.push(o);
  }
  const obsList = [...obsPages.values()];
  const obsOk = obsList.filter((x) => intentOk(x.page, intents));
  const obsBad = obsList.filter((x) => !intentOk(x.page, intents));
  const rarity = termRarity(inventory);
  const matched = inventory.pages.map((p) => ({ page: p, m: bestTerm(f, p, rarity) })).filter((x) => x.m).map((x) => ({ page: x.page, term: x.m.term, score: x.m.score }));
  const matchedOk = matched.filter((x) => intentOk(x.page, intents)).sort(cmpScore);

  if (obsOk.length === 1) {
    return { status: STATUS.candidate, url: obsOk[0].page.url, reason: `Página do inventário que aparece no Search Console para esta mesma consulta (consulta e URL na mesma linha: ${where(obsOk[0].refs)}).`, options: [], intents };
  }
  if (obsOk.length > 1) {
    return { status: STATUS.ambiguous, url: '', reason: `Mais de uma página do inventário aparece no Search Console para esta consulta (${obsOk.map((x) => where(x.refs)).join(' / ')}); decida qual deve responder.`, options: obsOk.map((x) => x.page.url), intents };
  }
  if (obsBad.length) {
    return { status: STATUS.conflict, url: '', reason: `O Search Console liga esta consulta a página(s) do inventário (${obsBad.map((x) => where(x.refs)).join(' / ')}) cujas intenções declaradas não incluem a da busca (${intents.join(', ')}). Revise a intenção da página ou da busca; nenhuma outra página foi escolhida no lugar.`,
      options: [...new Set([...obsBad.map((x) => x.page.url), ...matchedOk.map((x) => x.page.url)])], intents };
  }
  if (!matchedOk.length) {
    if (matched.length) {
      return { status: STATUS.intent, url: '', reason: `A intenção da busca (${intents.join(', ')}) não está entre as intenções declaradas das páginas do inventário ligadas ao tema.`, options: [...new Set(matched.map((x) => x.page.url))], intents };
    }
    return { status: STATUS.none, url: '', reason: 'Nenhum termo do inventário aparece na frase e o Search Console não liga a consulta a páginas do inventário.', options: [], intents };
  }
  const top = matchedOk.filter((x) => cmpScore(x, matchedOk[0]) === 0);
  if (top.length > 1) {
    return { status: STATUS.ambiguous, url: '', reason: `Páginas empatadas pelo mesmo termo/especificidade (${[...new Set(top.map((x) => `“${x.term}”`))].join(', ')}); defina termos mais específicos no inventário.`, options: top.map((x) => x.page.url), intents };
  }
  const others = [...new Set(matchedOk.slice(1).map((x) => `“${x.term}”`))];
  return { status: STATUS.candidate, url: top[0].page.url, reason: `Termo do inventário “${top[0].term}” presente na frase${others.length ? ` (mais específico que ${others.join(', ')})` : ''}.`, options: [], intents };
}

// ---------------- evidence input ----------------
const uniq = (a) => [...new Set(a.filter((x) => x !== undefined && x !== null && x !== ''))];

const SOURCE_TYPES = new Set(['autocomplete', 'serp-related', 'serp-paa', 'serp-organic']);
const KNOWN_STRATEGY = /^(seed|alphaSuffix|alphaPrefix|digitSuffix|questions|modifiers|comparisons|custom|recursive|serp-page-[1-9]\d*)$/;
/** Same request key as the miner: normalised text, trailing space significant. */
// Strict key (NFC, case, whitespace — zero-width joiners kept: "curso 👩\u200d💻" ≠ "curso 👩💻") + trailing-space marker.
const queryKey = (q) => trimWS(String(q).normalize('NFC').toLowerCase().replace(WS, ' ')) + (/[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(String(q)) ? ' ' : '');
/** A real calendar instant in ISO 8601 (2026-02-30 is refused, not rolled over to March). */
function isIsoDate(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m || Number.isNaN(Date.parse(v))) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((x) => Number(x || 0));
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
}
const isText = (x) => typeof x === 'string' && x.trim() !== '';

/** Validate one observation of the evidence JSON; returns an error message or ''. */
function observationError(o, norm) {
  if (!o || typeof o.phrase !== 'string' || normalizeKeyword(o.phrase) !== norm) return 'frase da observação diferente da palavra';
  if (typeof o.query !== 'string' || !o.query.trim()) return 'consulta enviada ausente';
  if (!isText(o.provider)) return 'provedor ausente';
  if (!SOURCE_TYPES.has(o.sourceType)) return `fonte desconhecida "${o.sourceType}"`;
  // The source must match the provider: an organic title cannot pass as an autocomplete suggestion.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(o.provider)) return `provedor inválido "${o.provider}"`;
  if (sourceTypeOf(o.provider) !== o.sourceType) return `fonte "${o.sourceType}" incompatível com o provedor "${o.provider}"`;
  // ...and with how the query was generated: result-page origins (serp-page-N, family serp, serpPage) only for SERP sources.
  if (!Array.isArray(o.origins) || !o.origins.length) return 'origens ausentes';
  for (const x of o.origins) {
    if (typeof x?.strategy !== 'string' || !KNOWN_STRATEGY.test(x.strategy)) return `estratégia desconhecida "${x?.strategy}"`;
    if (x.family !== familyOfStrategy(x.strategy)) return `família "${x.family}" não corresponde à estratégia "${x.strategy}"`;
    // The generated query must be the query sent (same request key: case/space-normalised, trailing space significant).
    if (typeof x.generatedQuery !== 'string' || queryKey(x.generatedQuery) !== queryKey(o.query)) return `consulta gerada "${x.generatedQuery}" diferente da consulta enviada "${o.query}"`;
  }
  const serpSource = o.sourceType !== 'autocomplete';
  const serpOrigins = (o.origins || []).map((x) => x?.family === 'serp' || /^serp/.test(String(x?.strategy)));
  if (serpOrigins.some((x) => x !== serpSource) || (o.serpPage !== undefined) !== serpSource) return 'origem/página de resultado incompatível com a fonte';
  if (serpSource && (!Number.isInteger(o.serpPage) || o.serpPage < 1 || o.origins.some((x) => x.strategy !== `serp-page-${o.serpPage}`))) return 'página de resultado incoerente com a estratégia';
  if (!Array.isArray(o.origins) || !o.origins.length || o.origins.some((x) => !isText(x?.seed) || !isText(x?.strategy) || !isText(x?.family) || typeof x?.generatedQuery !== 'string' || !x.generatedQuery.trim())) return 'origens ausentes ou incompletas (semente, estratégia, família, consulta gerada)';
  if (!isValidLang(o.hl) || !isValidCountry(o.gl)) return `idioma/país inválido ("${o.hl}" / "${o.gl}")`;
  if (!isText(o.runId) || typeof o.requestId !== 'string' || !new RegExp(`^${o.runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#\\d+$`).test(o.requestId)) return 'identificadores de execução/requisição ausentes ou incoerentes';
  if (!isIsoDate(o.collectedAt)) return 'data da coleta inválida (esperado ISO 8601 real)';
  return '';
}

/**
 * Read the evidence JSON written by the collection (`-o arquivo.json`). The schema is enforced: every observation
 * must prove the phrase (same normalised text), its query, source, origins, locale, ids and date. Legacy exports are
 * refused (evidence is never reconstructed). Google result-page titles (serp-organic) are not searches: they are
 * dropped, and a phrase seen only as a title is left out.
 */
export function readEvidence(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (!d || d.schema !== EVIDENCE_SCHEMA || !Array.isArray(d.keywords)) {
    throw new Error(`arquivo de evidências inválido: esperado o JSON exportado pela coleta com "schema": "${EVIDENCE_SCHEMA}"`);
  }
  let droppedTitles = 0;
  const keywords = [];
  const seen = new Set();
  // One request = one query, one provider, one locale, one run: contradicting copies are refused across the whole file.
  const requests = new Map();
  d.keywords.forEach((k, i) => {
    if (!isText(k?.keyword) || !Array.isArray(k.observations) || !k.observations.length) {
      throw new Error(`arquivo de evidências inválido: palavra #${i + 1} sem "keyword" ou sem "observations"`);
    }
    const norm = normalizeKeyword(k.keyword);
    if (seen.has(norm)) throw new Error(`arquivo de evidências inválido: "${k.keyword}" repetida`);
    seen.add(norm);
    const ids = new Set();
    for (const o of k.observations) {
      const err = observationError(o, norm);
      if (err) throw new Error(`arquivo de evidências inválido: "${k.keyword}": ${err}`);
      // The sources of ONE result page (related / PAA / titles) share a request; an autocomplete request has one engine.
      const sig = JSON.stringify([queryKey(o.query), o.sourceType === 'autocomplete' ? ['autocomplete', o.provider] : ['serp'], o.serpPage ?? null, o.hl, o.gl, o.runId, o.collectedAt]);
      if (requests.has(o.requestId) && requests.get(o.requestId) !== sig) throw new Error(`arquivo de evidências inválido: "${k.keyword}": a requisição ${o.requestId} aparece com consulta, provedor ou idioma diferentes`);
      requests.set(o.requestId, sig);
      const id = `${o.requestId}\u0000${o.provider}\u0000${o.phrase}`;
      if (ids.has(id)) throw new Error(`arquivo de evidências inválido: "${k.keyword}": observação repetida (mesma requisição, provedor e frase)`);
      ids.add(id);
    }
    const observations = k.observations.filter((o) => o.sourceType !== 'serp-organic');
    if (!observations.length) { droppedTitles += 1; return; }
    // The joined text is the phrase PROVEN by the observations (not the generated query, not a free "keyword").
    keywords.push({ keyword: trimWS(observations[0].phrase), norm, observations });
  });
  return { keywords, familyTerms: d.familyTerms, familyTermsByRun: d.familyTermsByRun, droppedTitles, generatedAt: d.generatedAt };
}

// ---------------- build ----------------
/**
 * @param {{keywords, familyTerms}} evidence  from readEvidence()
 * @param {object[]|null} gscFiles  from loadGscCsv() (null = not provided)
 * @param {object|null} inventory   from loadInventoryCsv() (null = not provided)
 * @returns {object[]} one row per (phrase × matching Search Console row); a phrase without matches gives one row.
 */
export function buildOpportunities(evidence, gscFiles, inventory) {
  const usable = gscFiles ? gscFiles.filter((g) => g.kind !== GSC_KINDS.page) : [];
  const idx = usable.length ? indexGsc(usable) : null;
  const allRejected = usable.length > 0 && usable.every((g) => !g.rows.length) && usable.some((g) => g.rejected > 0);
  const gscEmptyStatus = !gscFiles || !gscFiles.length ? GSC_STATUS.notGiven : allRejected ? GSC_STATUS.allRejected : idx ? GSC_STATUS.noMatch : GSC_STATUS.noUsable;
  const rows = [];
  // The miner groups phrases by a looser key (it drops zero-width characters): split each record by the strict join key
  // so a Search Console row is only associated with the observations whose text really matches it.
  const units = [];
  for (const k of evidence.keywords) {
    const groups = new Map();
    for (const o of k.observations) groups.set(gscKey(o.phrase), [...(groups.get(gscKey(o.phrase)) || []), o]);
    // Always join with the key of the OBSERVED text (never a trimmed display copy).
    for (const [key, obs] of groups) units.push({ ...k, keyword: trimWS(obs[0].phrase), joinKey: key, observations: obs });
  }
  for (const k of units) {
    const obs = k.observations;
    const textFamilies = classifyObservations(k.keyword, obs, evidence.familyTermsByRun || null, evidence.familyTerms);
    // Join on the OBSERVED phrase (never on the generated query), exact after conservative normalisation.
    const gscRows = idx ? (idx.get(k.joinKey ?? gscKey(k.keyword)) || []) : [];
    const times = sortTimes(obs.map((o) => o.collectedAt));
    const base = {
      frase: k.keyword,
      frases_retornadas: uniq(obs.map((o) => o.phrase)),
      familias_origem: uniq(obs.flatMap((o) => (o.origins?.length ? o.origins.map((x) => x.family) : [o.originFamily]))),
      familias_texto: textFamilies,
      observacoes: obs.length,
      requisicoes: uniq(obs.map((o) => o.requestId)).length,
      // Answers reused from a cache are evidence of an EARLIER answer, not a new one: they do not count as occurrences.
      // Confirmed fresh provider answers only; unknown cache status (fromCache null) is reported in its own column.
      ocorrencias: obs.filter((o) => o.fromCache === false).length,
      observacoes_cache: obs.filter((o) => o.fromCache === true).length,
      // Answers whose cache status could not be observed (e.g. direct JSONP in the browser): counted, but shown apart.
      observacoes_cache_desconhecido: obs.filter((o) => o.fromCache !== true && o.fromCache !== false).length,
      fontes: uniq(obs.map((o) => o.sourceType || 'autocomplete')),
      eco_da_consulta: obs.some((o) => o.echoOfQuery) ? 'sim' : 'não',
      consultas_enviadas: uniq(obs.map((o) => o.query)),
      sementes: uniq(obs.flatMap((o) => (o.origins?.length ? o.origins.map((x) => x.seed) : [o.seed]))),
      provedores: uniq(obs.map((o) => o.provider)),
      idiomas: uniq(obs.map((o) => o.hl)),
      paises: uniq(obs.map((o) => o.gl)),
      coleta_primeira: times[0] || '',
      coleta_ultima: times.at(-1) || '',
    };
    const list = gscRows.length ? gscRows : [null];
    for (const r of list) {
      // The candidate is decided PER ROW, with the URL of this row only: a row without URL (or with another URL, from
      // another file or date range) never inherits the link of a different row. Without a URL only the inventory decides.
      const cand = chooseCandidate(k.keyword, r && r.page ? [{ url: r.page, file: r.file, line: r.line }] : [], inventory, textFamilies);
      const row = {
        ...base,
        intencoes: cand.intents,
        url_candidata: cand.url,
        status_candidata: cand.status,
        motivo_candidata: cand.reason,
        opcoes: cand.options,
        melhoria_sugerida: cand.status === STATUS.candidate ? suggestImprovement(k.keyword, textFamilies) : '',
        ...(r ? {
          gsc_status: GSC_STATUS.data,
          gsc_arquivo: r.file,
          gsc_linha: r.line,
          gsc_consulta: r.query,
          gsc_cliques: r.clicks,
          gsc_impressoes: r.impressions,
          gsc_ctr: r.ctr,
          gsc_posicao: r.position,
          url_observada_gsc: r.page || '',
          url_observada_status: r.page ? 'vínculo explícito (mesma linha do arquivo)'
            : r.pageInvalid ? `URL inválida no arquivo ("${r.pageInvalid}")` : 'não informada no arquivo (sem vínculo explícito)',
        } : {
          gsc_status: gscEmptyStatus,
          gsc_arquivo: '', gsc_linha: null, gsc_consulta: '', gsc_cliques: null, gsc_impressoes: null, gsc_ctr: null, gsc_posicao: null,
          url_observada_gsc: '', url_observada_status: '',
        }),
      };
      row.cadeia = chain(row);
      rows.push(row);
    }
  }
  const rank = (r) => (r.status_candidata === STATUS.candidate ? 0 : [STATUS.ambiguous, STATUS.conflict].includes(r.status_candidata) ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || (b.gsc_impressoes ?? -1) - (a.gsc_impressoes ?? -1) || b.ocorrencias - a.ocorrencias || b.observacoes - a.observacoes || a.frase.localeCompare(b.frase, 'pt-BR'));
  return rows;
}

const br = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
function chain(r) {
  const qs = r.consultas_enviadas;
  const ev = `${r.observacoes} observação(ões) em ${r.requisicoes} requisição(ões)${r.observacoes_cache ? `, ${r.observacoes_cache} reaproveitada(s) de cache` : ''} (fontes: ${r.fontes.join(', ')}; provedores: ${r.provedores.join(', ')}; origem: ${r.familias_origem.join(', ')}; consultas enviadas: ${qs.slice(0, 3).map((x) => `“${x.trim()}”`).join(', ')}${qs.length > 3 ? '…' : ''})`;
  let gsc = `Search Console: ${r.gsc_status}`;
  if (r.gsc_status === GSC_STATUS.data) {
    const m = [r.gsc_cliques !== null ? `${br(r.gsc_cliques)} cliques` : 'cliques não informados',
      r.gsc_impressoes !== null ? `${br(r.gsc_impressoes)} impressões` : 'impressões não informadas',
      r.gsc_posicao !== null ? `posição ${br(r.gsc_posicao)}` : 'posição não informada'].join(', ');
    gsc = `Search Console (${r.gsc_arquivo}, linha ${r.gsc_linha}): ${m}${r.url_observada_gsc ? ` em ${r.url_observada_gsc}` : ' (sem URL no arquivo)'}`;
  }
  const page = r.url_candidata ? `página candidata ${r.url_candidata}` : `sem página candidata (${r.status_candidata})`;
  return `“${r.frase}” → ${ev}; ${gsc} → ${page}${r.melhoria_sugerida ? ` → ${r.melhoria_sugerida}` : ''}`;
}

export const OPPORTUNITY_COLUMNS = ['frase', 'frases_retornadas', 'familias_origem', 'familias_texto', 'observacoes', 'requisicoes', 'ocorrencias', 'observacoes_cache', 'observacoes_cache_desconhecido', 'fontes', 'eco_da_consulta',
  'consultas_enviadas', 'sementes', 'provedores', 'idiomas', 'paises', 'coleta_primeira', 'coleta_ultima',
  'gsc_status', 'gsc_arquivo', 'gsc_linha', 'gsc_consulta', 'gsc_cliques', 'gsc_impressoes', 'gsc_ctr', 'gsc_posicao', 'url_observada_gsc', 'url_observada_status',
  'url_candidata', 'status_candidata', 'motivo_candidata', 'opcoes', 'intencoes', 'melhoria_sugerida', 'cadeia'];

/** CSV for reading in a spreadsheet (UTF-8 BOM, formula-injection guard, Brazilian decimal comma, empty = not informed). */
export function opportunitiesToCsv(rows) {
  const cell = (v) => csvCell(Array.isArray(v) ? v.join(' | ') : typeof v === 'number' ? br(v) : v);
  return '\uFEFF' + [OPPORTUNITY_COLUMNS.join(','), ...rows.map((r) => OPPORTUNITY_COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

export function opportunitiesToJson(rows, meta = {}) {
  return JSON.stringify({
    tool: 'Advanced Free Keyword Research Tool — oportunidades (BR)',
    generatedAt: new Date().toISOString(),
    aviso: 'Ocorrências (respostas novas confirmadas dos provedores; cache em observacoes_cache, status de cache não observável em observacoes_cache_desconhecido) não são volume de busca. Consultas enviadas são geradas pelo programa; só as frases retornadas são sugestões observadas. '
      + 'Métrica vazia/null = não informada (não é zero). URL candidata vem exclusivamente do inventário informado; a melhoria sugerida não foi verificada na página.',
    ...meta,
    count: rows.length,
    oportunidades: rows,
  }, null, 2);
}
