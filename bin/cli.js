#!/usr/bin/env node
/**
 * Advanced Free Keyword Research Tool — CLI
 *
 *   afkrt "converter pdf em word"                 (pt-br / br, Google, 4 famílias)
 *   afkrt -f sementes.txt -x perguntas,comparacoes -o dados-locais/coleta.csv -o dados-locais/coleta.json
 *   afkrt oportunidades --evidencias dados-locais/coleta.json --gsc dados-locais/consultas.csv --inventario dados-locais/inventario.csv -o dados-locais/oportunidades.csv
 *   afkrt --list-engines
 *   afkrt "kahve makinesi" --serp --serp-pages 10     (also walk Google result pages)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { ENGINES, DEFAULT_ENGINES, DEFAULT_LOCALE, isEngineId, isValidLang, isValidCountry, localeSupport } from '../web/js/engines.js';
import { Miner } from '../web/js/miner.js';
import { parseSeeds, parseList } from '../web/js/expand.js';
import { serialize, FORMATS } from '../web/js/export.js';
import { createHttpFetcher } from '../lib/http-fetcher.js';
import { runSerpPhase, SERP_LIMITS } from '../web/js/serp-client.js';

const DEFAULT_EXPAND = 'perguntas,modificadores,comparacoes,alfabetica';

const HELP = `
Advanced Free Keyword Research Tool (CLI) — versão Brasil

Uso:
  afkrt [opções] [palavra ...]                    coleta sugestões (autocomplete)
  afkrt oportunidades --evidencias <json> [...]   cruza evidências com Search Console e inventário (local, sem rede)
  afkrt -- oportunidades                          pesquisa a palavra "oportunidades" como semente

Entrada:
  -f, --file <arquivo>      Lê sementes de um arquivo (uma por linha ou separadas por vírgula)
  (stdin)                   Também aceita sementes por pipe:  cat sementes.txt | afkrt -o saida.csv
  --                        Tudo depois de -- é semente (mesmo que pareça opção ou subcomando)

Provedores:
  -e, --engines <lista>     Ids separados por vírgula, ou "all" / "web" / "shopping" / "video"
                            (padrão: ${DEFAULT_ENGINES.join(',')}; os demais continuam disponíveis como opção)
      --list-engines        Lista os provedores e sai

Expansão (cauda longa) — famílias:
  -x, --expand <lista>      perguntas (questions), modificadores (modifiers), comparacoes (comparisons),
                            alfabetica (alpha), alfabetica-prefixo (alpha-prefix), digitos (digits), none
                            (padrão: ${DEFAULT_EXPAND})
      --termos-perguntas <lista>      Termos extras da família perguntas (aceita {s}: "{s} funciona no mac")
      --termos-modificadores <lista>  Termos extras de preposições/modificadores ("no celular", "sem cadastro")
      --termos-comparacoes <lista>    Termos extras de comparações ("{s} ou outra opção")
                            Sem {s}: perguntas vão antes da semente; modificadores e comparações, depois.
                            Os termos extras também entram na classificação das frases retornadas.
      --prefixes <lista>    Prefixos personalizados (família "personalizada")
      --suffixes <lista>    Sufixos personalizados
  -d, --depth <n>           Profundidade recursiva: realimenta sugestões novas (padrão 0)
      --expand-recursive    Aplica a expansão também nos níveis recursivos (cresce muito!)
      --must-contain        Mantém só sugestões que contêm todas as palavras da semente

Idioma e país da busca (enviados a todo provedor que os suporta):
  -l, --lang <hl>           Idioma da busca: pt-br, pt, en, es, tr… (padrão ${DEFAULT_LOCALE.hl})
  -c, --country <gl>        País/região: br, pt, us, tr… (padrão ${DEFAULT_LOCALE.gl})
                            Também escolhe as palavras das famílias e o alfabeto da expansão.
                            Veja quem usa:  afkrt --list-engines

Limites / cortesia:
      --delay <ms>          Pausa entre requisições ao MESMO provedor (padrão 400)
      --concurrency <n>     Provedores em paralelo (padrão 4)
      --max-queries <n>     Máximo de requisições por provedor (padrão 2000)
      --max-results <n>     Para após N frases únicas (padrão 50000)
      --timeout <ms>        Tempo limite por requisição (padrão 10000)
      --user-agent <ua>     Substitui o User-Agent

Páginas de resultado do Google (SERP) — opcional, fora do padrão; requer \`npm install\` + Chrome/Chromium local:
      --serp                Também percorre páginas de resultado (start=0,10,20…) e coleta buscas relacionadas
                            e "As pessoas também perguntam" (+ títulos orgânicos se pedido)
      --serp-pages <n>      Páginas por semente, 1–100 (padrão ${SERP_LIMITS.defaultPages})
      --serp-sources <lista> related, paa, organic  (padrão related,paa)
      --serp-delay <ms>     Pausa entre páginas, mínimo ${SERP_LIMITS.minDelayMs} (padrão ${SERP_LIMITS.defaultDelayMs})
      --serp-backend <b>    browser (padrão, seu Chrome) | html (HTTP simples; geralmente bloqueado)
      --serp-headful        Mostra a janela do navegador
      --serp-chrome <path>  Executável do navegador (ou CHROME_PATH)
      --serp-profile <dir>  Perfil do navegador a reutilizar
      --serp-only           Só SERP, sem autocomplete
                            Para imediatamente em CAPTCHA (sem resolver, sem evasão). Acesso automatizado a
                            páginas de resultado contraria os Termos do Google — veja o README.

Saída:
  -o, --out <arquivo>       Arquivo de saída; formato pela extensão (.txt .csv .tsv .json .md)
                            Pode repetir:  -o dados-locais/coleta.csv -o dados-locais/coleta.json
                            .csv = leitura (1 linha por frase, com todas as origens); .json = evidências completas
      --format <fmt>        Formato no stdout quando não há -o (padrão txt)
  -q, --quiet               Sem progresso
  -h, --help                Ajuda

Oportunidades (afkrt oportunidades --help para detalhes):
  --evidencias <json>  --gsc <csv> (repetível)  --inventario <csv>  -o <saida.csv|saida.json>

Guarde entradas e saídas reais em dados-locais/ (ignorada pelo Git). Ocorrências não são volume de busca.
`;

function parseArgs(argv) {
  const a = { seeds: [], outs: [], engines: null, expand: DEFAULT_EXPAND, depth: 0, lang: DEFAULT_LOCALE.hl, country: DEFAULT_LOCALE.gl, delay: 400, concurrency: 4, maxQueries: 2000, maxResults: 50000, timeout: 10000, format: 'txt' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`Missing value for ${k}`); return x; };
    if (k === '--') { a.seeds.push(...argv.slice(i + 1)); break; }
    switch (k) {
      case '-h': case '--help': a.help = true; break;
      case '--termos-perguntas': case '--question-terms': a.termsQuestions = v(); break;
      case '--termos-modificadores': case '--modifier-terms': a.termsModifiers = v(); break;
      case '--termos-comparacoes': case '--comparison-terms': a.termsComparisons = v(); break;
      case '-f': case '--file': a.file = v(); break;
      case '-e': case '--engines': a.engines = v(); break;
      case '--list-engines': a.list = true; break;
      case '-x': case '--expand': a.expand = v(); break;
      case '--prefixes': a.prefixes = v(); break;
      case '--suffixes': a.suffixes = v(); break;
      case '-d': case '--depth': a.depth = Number(v()); break;
      case '--expand-recursive': a.expandRecursive = true; break;
      case '--must-contain': a.mustContain = true; break;
      case '-l': case '--lang': a.lang = v().toLowerCase(); break;
      case '-c': case '--country': a.country = v().toLowerCase(); break;
      case '--delay': a.delay = Number(v()); break;
      case '--concurrency': a.concurrency = Number(v()); break;
      case '--max-queries': a.maxQueries = Number(v()); break;
      case '--max-results': a.maxResults = Number(v()); break;
      case '--timeout': a.timeout = Number(v()); break;
      case '--user-agent': a.userAgent = v(); break;
      case '--serp': a.serp = true; break;
      case '--serp-only': a.serp = true; a.serpOnly = true; break;
      case '--serp-pages': a.serp = true; a.serpPages = Number(v()); break;
      case '--serp-sources': a.serpSources = v(); break;
      case '--serp-delay': a.serpDelay = Number(v()); break;
      case '--serp-backend': a.serpBackend = v(); break;
      case '--serp-headful': a.serpHeadful = true; break;
      case '--serp-chrome': a.serpChrome = v(); break;
      case '--serp-profile': a.serpProfile = v(); break;
      case '--serp-base-url': a.serpBaseUrl = v(); break; // tests: fake Google
      case '-o': case '--out': a.outs.push(v()); break;
      case '--format': a.format = v(); break;
      case '-q': case '--quiet': a.quiet = true; break;
      default:
        if (k.startsWith('-')) throw new Error(`Unknown option ${k}`);
        a.seeds.push(k);
    }
  }
  if (!isValidLang(a.lang)) throw new Error(`Invalid --lang "${a.lang}" (use a code like pt-br, pt, en, tr)`);
  resolveExpansion(a.expand, a); // validates -x early
  if (!isValidCountry(a.country)) throw new Error(`Invalid --country "${a.country}" (use a 2-letter code like br, pt, us, tr)`);
  const ints = { depth: [0, 10], delay: [0, 60000], concurrency: [1, 32], maxQueries: [1, 1e6], maxResults: [1, 1e7], timeout: [1000, 120000] };
  for (const [k, [min, max]] of Object.entries(ints)) {
    if (!Number.isInteger(a[k]) || a[k] < min || a[k] > max) throw new Error(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be an integer between ${min} and ${max}`);
  }
  if (a.serp) {
    a.serpPages ??= SERP_LIMITS.defaultPages;
    a.serpDelay ??= SERP_LIMITS.defaultDelayMs;
    a.serpBackend ??= 'browser';
    if (!Number.isInteger(a.serpPages) || a.serpPages < SERP_LIMITS.minPages || a.serpPages > SERP_LIMITS.maxPages) throw new Error(`--serp-pages must be an integer between 1 and ${SERP_LIMITS.maxPages}`);
    const minDelay = a.serpBaseUrl ? 0 : SERP_LIMITS.minDelayMs;
    if (!Number.isInteger(a.serpDelay) || a.serpDelay < minDelay || a.serpDelay > 600000) throw new Error(`--serp-delay must be an integer between ${SERP_LIMITS.minDelayMs} and 600000`);
    if (!['browser', 'html'].includes(a.serpBackend)) throw new Error('--serp-backend must be browser or html');
    a.serpSourceList = parseList((a.serpSources || 'related,paa').toLowerCase());
    for (const x of a.serpSourceList) if (!['related', 'paa', 'organic'].includes(x)) throw new Error(`Unknown --serp-sources entry "${x}" (use related, paa, organic)`);
    if (!a.serpSourceList.length) throw new Error('--serp-sources is empty');
  }
  return a;
}

function resolveEngines(spec) {
  if (!spec) return DEFAULT_ENGINES;
  const out = new Set();
  for (const part of parseList(spec.toLowerCase())) {
    if (part === 'all') ENGINES.filter((e) => !e.experimental).forEach((e) => out.add(e.id));
    else if (ENGINES.some((e) => e.category === part)) ENGINES.filter((e) => e.category === part && !e.experimental).forEach((e) => out.add(e.id));
    else if (isEngineId(part)) out.add(part);
    else throw new Error(`Unknown engine "${part}". Use --list-engines.`);
  }
  return [...out];
}

// -x accepts the Portuguese family names and the original English ones.
const EXPAND_ALIASES = {
  alpha: 'alpha', 'alpha-suffix': 'alpha', alfabetica: 'alpha', 'alfabetica-sufixo': 'alpha',
  'alpha-prefix': 'alpha-prefix', 'alfabetica-prefixo': 'alpha-prefix',
  digits: 'digits', digitos: 'digits',
  questions: 'questions', perguntas: 'questions',
  modifiers: 'modifiers', modificadores: 'modifiers', preposicoes: 'modifiers',
  comparisons: 'comparisons', comparacoes: 'comparisons',
  none: 'none', nenhuma: 'none',
};

function resolveExpansion(spec, a) {
  const set = new Set();
  for (const raw of parseList(spec.toLowerCase())) {
    const k = raw.normalize('NFD').replace(/\p{M}+/gu, '');
    if (!Object.prototype.hasOwnProperty.call(EXPAND_ALIASES, k)) throw new Error(`Unknown --expand entry "${raw}" (use ${DEFAULT_EXPAND}, alfabetica-prefixo, digitos, none)`);
    set.add(EXPAND_ALIASES[k]);
  }
  const none = set.has('none');
  // "-x none" means no expansion at all: extra family terms are ignored too.
  const familyTerms = none ? { perguntas: [], modificadores: [], comparacoes: [] } : familyTermsOf(a);
  return {
    seed: true,
    alphaSuffix: !none && set.has('alpha'),
    alphaPrefix: !none && set.has('alpha-prefix'),
    digitSuffix: !none && set.has('digits'),
    questions: !none && (set.has('questions') || familyTerms.perguntas.length > 0),
    modifiers: !none && (set.has('modifiers') || familyTerms.modificadores.length > 0),
    comparisons: !none && (set.has('comparisons') || familyTerms.comparacoes.length > 0),
    custom: Boolean(a.prefixes || a.suffixes),
    customPrefixes: parseList(a.prefixes),
    customSuffixes: parseList(a.suffixes),
    familyTerms,
    lang: a.lang,
  };
}

const familyTermsOf = (a) => ({ perguntas: parseList(a.termsQuestions), modificadores: parseList(a.termsModifiers), comparacoes: parseList(a.termsComparisons) });

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'oportunidades' || argv[0] === 'opportunities') {
    const { runOpportunities } = await import('../lib/opportunities-cli.js');
    await runOpportunities(argv.slice(1));
    return;
  }
  const a = parseArgs(argv);
  if (a.help) { console.log(HELP); return; }
  if (a.list) {
    console.log('id               category   browser  locale  notes');
    for (const e of ENGINES) console.log(`${e.id.padEnd(16)} ${e.category.padEnd(10)} ${(e.jsonp ? 'jsonp' : e.cors ? 'cors' : 'proxy').padEnd(8)} ${localeSupport(e).padEnd(7)} ${e.backend}${e.region ? ` · ${e.region} only` : ''}${e.localeNote ? ` · ${e.localeNote}` : ''}${e.experimental ? ' · experimental' : ''}`);
    console.log('\nlocale: hl+gl = language and country used · hl = language only · gl = country only · fixed = ignores both');
    return;
  }

  let seedText = a.seeds.join('\n');
  if (a.file) seedText += `\n${await readFile(a.file, 'utf8')}`;
  if (!a.seeds.length && !a.file) seedText += `\n${await readStdin()}`;
  const seeds = parseSeeds(seedText);
  if (!seeds.length) { console.error('Nenhuma semente. Tente: afkrt "converter pdf em word"  (ou --help)'); process.exitCode = 2; return; }

  const engines = a.serpOnly ? [] : resolveEngines(a.engines);
  const log = (...m) => { if (!a.quiet) process.stderr.write(`${m.join(' ')}\n`); };
  log(`▸ ${seeds.length} seed(s) · lang ${a.lang} · country ${a.country} · engines: ${engines.join(', ')} · depth ${a.depth}`);
  if (a.serp) log(`  + Google SERP: ${a.serpPages} page(s)/seed · sources ${a.serpSourceList.join(',')} · ${a.serpDelay} ms between pages · ${a.serpBackend} backend`);
  const fixed = engines.filter((id) => localeSupport(ENGINES.find((e) => e.id === id)) === 'fixed');
  if (fixed.length) log(`  note: ${fixed.join(', ')} ignore language/country (single-market engines)`);

  let serpBackend = null;
  const alongside = [];
  if (a.serp) {
    const { createSerpBackend } = await import('../lib/google-serp.js');
    serpBackend = createSerpBackend({ backend: a.serpBackend, headful: a.serpHeadful, chromePath: a.serpChrome, userDataDir: a.serpProfile, baseUrl: a.serpBaseUrl });
    alongside.push((m) => runSerpPhase({
      // Pages loaded right now by this process: a fresh answer, not a cache hit.
      miner: m, seeds, fetchPage: async (...args) => ({ ...(await serpBackend.fetchPage(...args)), cached: false, fetchedAt: new Date().toISOString() }), pages: a.serpPages, sources: a.serpSourceList,
      delayMs: a.serpDelay, minDelayMs: a.serpBaseUrl ? 0 : SERP_LIMITS.minDelayMs,
      onStatus: (s) => {
        if (s.type === 'blocked') {
          const hint = { captcha: 'Google asked for a CAPTCHA (unusual traffic). Not solved by design — try later, fewer pages, a longer --serp-delay, or a normal home connection', jswall: 'Google requires JavaScript for this client — use --serp-backend browser', consent: 'Google showed a cookie-consent page — try --serp-headful once and accept it with a --serp-profile, or another country', unavailable: 'browser backend not available' }[s.status] || '';
          log(`\n  ⚠ Google SERP stopped on page ${s.page} for "${s.seed}": ${s.status}${s.error && s.error !== s.status ? ` (${s.error})` : ''}${hint ? ` — ${hint}` : ''}.${engines.length ? ' Autocomplete engines continue.' : ''}`);
        }
        else if (s.type === 'error') log(`\n  ⚠ Google SERP page ${s.page} for "${s.seed}" failed: ${s.error}`);
        else if (s.type === 'end') log(`\n  · Google SERP: "${s.seed}" has no more result pages after page ${s.page}`);
      },
    }));
  }

  const miner = new Miner({
    alongside,
    fetcher: createHttpFetcher(a.userAgent ? { userAgent: a.userAgent } : {}),
    engines, seeds, hl: a.lang, gl: a.country,
    expansion: resolveExpansion(a.expand, a), depth: a.depth, expandRecursive: a.expandRecursive,
    mustContainSeed: a.mustContain, delayMs: a.delay, concurrency: a.concurrency,
    maxQueries: a.maxQueries, maxResults: a.maxResults, timeoutMs: a.timeout,
  });
  let lastPrint = 0;
  miner.on('progress', (p) => {
    if (a.quiet || !process.stderr.isTTY) return;
    const now = Date.now();
    if (now - lastPrint < 200) return;
    lastPrint = now;
    process.stderr.write(`\r  requests ${p.done}/${p.queued} · unique keywords ${p.unique} · errors ${p.errors}   `);
  });
  miner.on('engineDisabled', ({ engine, error }) => log(`\n  ⚠ ${engine} disabled after repeated errors (${error})`));
  process.on('SIGINT', () => { log('\n  ■ stopping… (partial results will be saved)'); miner.stop(); });

  let results;
  try { results = await miner.run(); } finally { await serpBackend?.close(); }
  results.sort((x, y) => y.engines.length - x.engines.length || y.hits - x.hits || x.keyword.localeCompare(y.keyword));
  if (!a.quiet && process.stderr.isTTY) process.stderr.write('\n');
  log(`✔ ${results.length} unique keywords from ${miner.stats.done} requests (${miner.stats.errors} errors)`);
  for (const [id, s] of Object.entries(miner.stats.perEngine)) log(`   ${id.padEnd(16)} req ${String(s.requests).padStart(5)}  new ${String(s.found).padStart(5)}  err ${s.errors}${s.disabled ? '  (disabled)' : ''}`);

  const expansion = resolveExpansion(a.expand, a);
  const meta = { seeds, engines, lang: a.lang, country: a.country, depth: a.depth, expansion: Object.keys(expansion).filter((k) => expansion[k] === true), familyTerms: expansion.familyTerms, ...(a.serp ? { serp: { pages: a.serpPages, sources: a.serpSourceList } } : {}) };
  if (!a.outs.length) {
    if (!FORMATS.includes(a.format)) throw new Error(`Unknown format ${a.format}`);
    process.stdout.write(serialize(a.format, results, meta));
    return;
  }
  for (const out of a.outs) {
    const fmt = extname(out).slice(1).toLowerCase() || 'txt';
    if (!FORMATS.includes(fmt)) throw new Error(`Unsupported output extension .${fmt} (use ${FORMATS.join(', ')})`);
    await mkdir(dirname(out), { recursive: true }).catch(() => {});
    await writeFile(out, serialize(fmt, results, meta));
    log(`  → ${out}`);
  }
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exitCode = 1; });
