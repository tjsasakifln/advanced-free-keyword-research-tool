// Offline tests of the Brazilian version: Portuguese expansion, classification, evidence, Search Console
// import and opportunities. Every input is synthetic (fixtures in test/fixtures/br, domain exemplo.test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expandSeed, applyTemplate } from '../web/js/expand.js';
import { classifyPhrase, classifyInLangs, classifyObservations, familyOfStrategy, fold, isQuestionIn } from '../web/js/classify.js';
import { Miner } from '../web/js/miner.js';
import { serialize, EVIDENCE_SCHEMA } from '../web/js/export.js';
import { ENGINE_MAP, DEFAULT_ENGINES, DEFAULT_LOCALE } from '../web/js/engines.js';
import { acceptLanguage } from '../lib/http-fetcher.js';
import { loadGscCsv, parseCsv, parseInteger, parseDecimal, canonicalUrl } from '../lib/gsc.js';
import { loadInventoryCsv, buildOpportunities, chooseCandidate, readEvidence, opportunitiesToCsv, suggestImprovement, STATUS, GSC_STATUS } from '../lib/opportunities.js';
import { STRINGS } from '../web/js/i18n.js';
import { runDemo } from '../scripts/demo-sintetico.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fx = (f) => readFileSync(join(root, 'test', 'fixtures', 'br', f), 'utf8');
const cli = (...args) => spawnSync(process.execPath, ['bin/cli.js', ...args], { cwd: root, encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'afkrt-br-'));

// ------------------------------------------------------------------ defaults & locale
test('Brazil is the default: pt-br / br and Google only; other engines still registered', () => {
  assert.deepEqual(DEFAULT_LOCALE, { hl: 'pt-br', gl: 'br' });
  assert.deepEqual(DEFAULT_ENGINES, ['google']);
  for (const id of ['bing', 'yahoo', 'duckduckgo', 'youtube', 'amazon']) assert.ok(ENGINE_MAP[id], id);
});

test('pt-br reaches opt-in adapters as valid values (no "pt-br-BR", no pt-br.wikipedia.org)', () => {
  const o = { hl: 'pt-br', gl: 'br' };
  const u = (id) => new URL(ENGINE_MAP[id].http.url('abrir ifc', o));
  assert.equal(u('google').searchParams.get('hl'), 'pt-br');
  assert.equal(u('google').searchParams.get('gl'), 'br');
  assert.equal(u('bing').searchParams.get('mkt'), 'pt-BR');
  assert.equal(u('duckduckgo').searchParams.get('kl'), 'br-pt');
  assert.equal(u('wikipedia').host, 'pt.wikipedia.org');
  assert.equal(u('amazon').host, 'completion.amazon.com.br');
  assert.equal(acceptLanguage('pt-br', 'br'), 'pt-BR,pt;q=0.9');
  assert.equal(acceptLanguage('tr', 'tr'), 'tr-TR,tr;q=0.9');
  assert.equal(acceptLanguage('en', 'us'), 'en-US,en;q=0.9');
});

// ------------------------------------------------------------------ expansion
test('Portuguese expansion: four families, native templates (no English fallback)', () => {
  const q = expandSeed('converter pdf em dwg', { lang: 'pt-br', seed: false, alphaSuffix: true, questions: true, modifiers: true, comparisons: true });
  const by = (st) => q.filter((x) => x.strategy === st).map((x) => x.q);
  assert.ok(by('questions').includes('o que é converter pdf em dwg'));
  assert.ok(by('questions').includes('quanto custa converter pdf em dwg'));
  assert.ok(by('questions').includes('converter pdf em dwg vale a pena'), 'templates may put the seed first');
  assert.ok(by('modifiers').includes('converter pdf em dwg para '), 'connector sent with trailing space');
  assert.ok(by('modifiers').includes('converter pdf em dwg perto de mim'));
  assert.ok(by('comparisons').includes('diferença entre converter pdf em dwg e '));
  assert.ok(by('comparisons').includes('converter pdf em dwg vs '));
  assert.ok(by('comparisons').includes('converter pdf em dwg ou '));
  assert.equal(by('alphaSuffix').length, 26);
  for (const x of q) assert.ok(!/\b(how|what|for|best|near me)\b/.test(x.q), `English leaked: ${x.q}`);
});

test('expansion preserves accents, skips redundant modifiers and accepts custom terms per family', () => {
  const q = expandSeed('projeto de prevenção contra incêndio', {
    lang: 'pt-br', seed: false, alphaSuffix: false, modifiers: true, questions: true, comparisons: true,
    familyTerms: { perguntas: ['{s} é obrigatório'], modificadores: ['residencial'], comparacoes: ['{s} ou laudo'] },
  }).map((x) => x.q);
  assert.ok(q.includes('projeto de prevenção contra incêndio é obrigatório'));
  assert.ok(q.includes('projeto de prevenção contra incêndio residencial'));
  assert.ok(q.includes('projeto de prevenção contra incêndio ou laudo'));
  assert.ok(q.every((x) => x.includes('prevenção') && x.includes('incêndio')), 'accents kept');
  const online = expandSeed('editar dwg online', { lang: 'pt-br', seed: false, alphaSuffix: false, modifiers: true }).map((x) => x.q);
  assert.ok(!online.includes('editar dwg online online'));
  assert.equal(applyTemplate('{s} x', 'autocad'), 'autocad x ');
});

test('the same query generated by two strategies is kept once with both strategies', () => {
  const q = expandSeed('abrir ifc', { lang: 'pt-br', seed: false, alphaSuffix: false, modifiers: true, custom: true, customSuffixes: ['online'] });
  const online = q.filter((x) => x.q === 'abrir ifc online');
  assert.equal(online.length, 1);
  assert.deepEqual(online[0].strategies, ['modifiers', 'custom']);
});

// ------------------------------------------------------------------ classification
test('text classification is separate from origin, multi-family, accent and punctuation insensitive', () => {
  assert.deepEqual(classifyPhrase('Como abrir IFC online?', 'pt-br'), ['perguntas', 'modificadores']);
  assert.deepEqual(classifyPhrase('diferença entre ifc e rvt', 'pt-br'), ['comparacoes']);
  assert.deepEqual(classifyPhrase('diferenca entre ifc e rvt', 'pt-br'), ['comparacoes']);
  assert.deepEqual(classifyPhrase('quanto custa projeto de prevenção contra incêndio', 'pt-br'), ['perguntas']);
  assert.deepEqual(classifyPhrase('autocad é grátis?', 'pt-br'), ['perguntas', 'modificadores']);
  assert.deepEqual(classifyPhrase('autocad x revit', 'pt-br'), ['comparacoes']);
  assert.deepEqual(classifyPhrase('converter pdf em dwg', 'pt-br'), []);
  assert.equal(familyOfStrategy('alphaSuffix'), 'alfabetica');
  assert.equal(familyOfStrategy('comparisons'), 'comparacoes');
  assert.equal(fold('Prevenção  contra INCÊNDIO!'), 'prevencao contra incendio');
});

test('classification avoids common false positives', () => {
  for (const p of ['raio x digital', 'terreno 10 x 25', 'eixo x y']) assert.ok(!classifyPhrase(p, 'pt-br').includes('comparacoes'), p);
  assert.ok(!classifyPhrase('diferença de nível', 'pt-br').includes('comparacoes'));
  assert.ok(!classifyPhrase('autocad não funciona', 'pt-br').includes('perguntas'));
  assert.ok(!classifyPhrase('programa que é grátis', 'pt-br').includes('perguntas'));
  assert.ok(!classifyPhrase('do zero ao avançado', 'pt-br').includes('perguntas'), 'English "do" rule not applied to pt');
  assert.deepEqual(classifyPhrase('para que serve o ifc', 'pt-br'), ['perguntas'], '"para que" is not the preposition "para"');
  assert.ok(!classifyPhrase('raio x digital', 'pt-br', { comparacoes: ['{s} x'] }).includes('comparacoes'), 'custom "x" stays a between-words token');
  // Search language decides, not the UI: Turkish particles only with tr / unknown.
  assert.ok(isQuestionIn('kahve nasıl yapılır', 'tr'));
  assert.deepEqual(classifyInLangs('o que é ifc', ['pt-br', 'en']), ['perguntas']);
});

// ------------------------------------------------------------------ evidence
test('one request answered for two origins = one observation with both origins', async () => {
  const sent = [];
  const fetcher = async (e, q) => { sent.push(q); return q === 'abrir ifc online' ? ['abrir ifc online grátis'] : []; };
  const m = new Miner({ fetcher, engines: ['google'], seeds: ['abrir ifc'], delayMs: 0, hl: 'pt-br', gl: 'br',
    expansion: { seed: false, alphaSuffix: false, modifiers: true, custom: true, customSuffixes: ['online'], lang: 'pt-br' } });
  const res = await m.run();
  assert.equal(sent.filter((q) => q === 'abrir ifc online').length, 1, 'query sent once');
  const r = res.find((x) => x.keyword === 'abrir ifc online grátis');
  assert.equal(r.observations.length, 1);
  assert.deepEqual(r.observations[0].origins.map((o) => o.family), ['modificadores', 'personalizada']);
  assert.equal(r.observations[0].query, 'abrir ifc online');
  assert.equal(r.observations[0].provider, 'google');
  assert.equal(r.observations[0].hl, 'pt-br');
  assert.equal(r.observations[0].gl, 'br');
  assert.ok(r.observations[0].requestId.startsWith(m.runId));
  assert.ok(!Number.isNaN(Date.parse(r.observations[0].collectedAt)));
});

test('a phrase returned by two different requests is grouped, keeping both origins', async () => {
  const fetcher = async (e, q) => (q.startsWith('como') || q === 'editar dwg' ? ['como editar dwg no celular'] : []);
  const m = new Miner({ fetcher, engines: ['google'], seeds: ['editar dwg'], delayMs: 0,
    expansion: { seed: true, alphaSuffix: false, questions: true, lang: 'pt-br' } });
  const res = await m.run();
  const hits = res.filter((x) => normFold(x.keyword) === 'como editar dwg no celular');
  assert.equal(hits.length, 1, 'one row');
  const obs = hits[0].observations;
  assert.ok(obs.length >= 2);
  assert.equal(new Set(obs.map((o) => o.requestId)).size, obs.length, 'distinct requests');
  assert.ok(obs.some((o) => o.originFamily === 'semente') && obs.some((o) => o.originFamily === 'perguntas'));
  const csv = serialize('csv', res, { lang: 'pt-br' });
  const line = csv.split('\r\n').find((l) => l.startsWith('como editar dwg no celular,'));
  assert.match(line, /semente\|perguntas|perguntas\|semente/);
  const json = JSON.parse(serialize('json', res, { lang: 'pt-br' }));
  assert.equal(json.schema, EVIDENCE_SCHEMA);
  assert.match(json.notice, /NOT search volume/);
  assert.equal(json.keywords.find((k) => k.keyword === 'como editar dwg no celular').observations.length, obs.length);
});
const normFold = (s) => s.toLowerCase();

test('generated queries are never presented as observed suggestions', async () => {
  const fetcher = async () => ['abrir ifc online'];
  const m = new Miner({ fetcher, engines: ['google'], seeds: ['abrir ifc'], delayMs: 0,
    expansion: { seed: true, alphaSuffix: false, questions: true, lang: 'pt-br' } });
  const res = await m.run();
  assert.deepEqual(res.map((r) => r.keyword), ['abrir ifc online'], 'only the returned phrase');
  assert.ok(!res.some((r) => r.keyword === 'o que é abrir ifc'));
  const silent = new Miner({ fetcher: async () => [], engines: ['google'], seeds: ['abrir ifc'], delayMs: 0, expansion: { questions: true, lang: 'pt-br' } });
  assert.equal((await silent.run()).length, 0);
});

test('mustContainSeed is judged per origin', async () => {
  const fetcher = async () => ['dwg online grátis'];
  const m = new Miner({ fetcher, engines: ['google'], seeds: ['dwg online', 'ifc online'], delayMs: 0, mustContainSeed: true,
    expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const [r] = await m.run();
  assert.ok(r.observations.every((o) => o.origins.every((x) => x.seed === 'dwg online')));
});

test('CSV keeps accents (UTF-8 BOM) and one row per phrase', () => {
  const rec = { keyword: 'prevenção contra incêndio', engines: ['google'], hits: 2, seed: 's', query: 'q', strategy: 'seed', depth: 0,
    observations: [
      { phrase: 'prevenção contra incêndio', provider: 'google', sourceType: 'autocomplete', query: 'q', origins: [{ seed: 's', strategy: 'seed', family: 'semente', generatedQuery: 'q' }], originFamily: 'semente', hl: 'pt-br', gl: 'br', runId: 'r1', requestId: 'r1#1', collectedAt: '2026-11-26T10:00:00.000Z' },
      { phrase: 'Prevenção contra incêndio', provider: 'google', sourceType: 'autocomplete', query: 'q p', origins: [{ seed: 's', strategy: 'alphaSuffix', family: 'alfabetica', generatedQuery: 'q p' }], originFamily: 'alfabetica', hl: 'pt-br', gl: 'br', runId: 'r1', requestId: 'r1#2', collectedAt: '2026-11-26T10:00:01.000Z' },
    ] };
  const csv = serialize('csv', [rec]);
  assert.ok(csv.startsWith('\uFEFFkeyword,'));
  const rows = csv.trim().split('\r\n');
  assert.equal(rows.length, 2);
  assert.ok(rows[1].startsWith('prevenção contra incêndio,'));
  assert.ok(rows[1].includes('semente|alfabetica'));
});

// ------------------------------------------------------------------ Search Console import
test('Search Console CSV: Portuguese headers, ";" and decimal comma, explicit query → URL', () => {
  const g = loadGscCsv(fx('gsc-consultas-paginas-pt.csv'), 'pt.csv');
  assert.equal(g.kind, 'consulta+pagina');
  assert.equal(g.decimal, ',');
  const pdf = g.rows.filter((r) => r.query === 'converter pdf em dwg');
  assert.equal(pdf.length, 2, 'one row per (query, page); never summed');
  assert.deepEqual([pdf[0].clicks, pdf[0].impressions, pdf[0].ctr, pdf[0].position], [1234, 20480, 6.03, 4.1]);
  assert.equal(pdf[0].line, 3);
  const empty = g.rows.find((r) => r.query === 'abrir ifc online');
  assert.deepEqual([empty.clicks, empty.impressions, empty.position], [null, null, null], 'missing is null, not zero');
  const zero = g.rows.find((r) => r.query.startsWith('projeto'));
  assert.equal(zero.clicks, 0, 'a real zero stays zero');
});

test('Search Console CSV: English headers, query-only file gives no URL; pages-only file is ignored', () => {
  const en = loadGscCsv(fx('gsc-so-consultas-en.csv'), 'en.csv');
  assert.equal(en.kind, 'consulta');
  assert.equal(en.decimal, '.');
  assert.ok(en.rows.every((r) => r.page === null));
  assert.equal(en.rows.find((r) => r.query === 'o que é ifc').clicks, 1050);
  const pages = loadGscCsv(fx('gsc-so-paginas-pt.csv'), 'pages.csv');
  assert.equal(pages.kind, 'pagina');
  assert.equal(pages.rows.length, 0);
  assert.match(pages.warnings[0], /ignorado/);
});

test('Search Console CSV: diagnostics instead of silent "no data"', () => {
  assert.throws(() => loadGscCsv('Termo,Valor\na,1\n', 'x.csv'), /cabeçalho não reconhecido/);
  assert.throws(() => loadGscCsv('Query,Position\na,1.5\nb,"2,5"\n', 'mix.csv'), /mistura vírgula e ponto/);
  assert.throws(() => parseCsv('Query\n"aberta\n'), /aspas não fechadas/);
  assert.deepEqual(parseCsv('Query,Clicks\ntubo 2" pvc,3\n').rows[0].cells, ['tubo 2" pvc', '3']);
  assert.deepEqual(parseInteger('1.234'), { value: 1234 });
  assert.equal(parseInteger('10.0').value, null);
  assert.equal(parseDecimal('1.234', '.').value, 1.234);
  assert.equal(parseDecimal('1.234,5', ',').value, 1234.5);
  const bad = loadGscCsv('Consulta,Página\nabc,/relativa\n', 'b.csv');
  assert.equal(bad.rows[0].page, null);
  assert.equal(bad.rows[0].pageInvalid, '/relativa');
  const cmp = loadGscCsv('Consultas principais,Últimos 3 meses Cliques\na,1\n', 'cmp.csv');
  assert.match(cmp.warnings.join(' '), /nenhuma métrica reconhecida/);
  assert.equal(canonicalUrl('javascript:alert(1)'), null);
  assert.equal(canonicalUrl('https://Exemplo.test/a/?utm_source=x#y'), 'https://exemplo.test/a/', 'trailing slash kept');
  assert.notEqual(canonicalUrl('https://exemplo.test/cursos/fotografia/'), canonicalUrl('https://exemplo.test/cursos/fotografia'));
});

// ------------------------------------------------------------------ inventory & opportunities
const inv = () => loadInventoryCsv(fx('inventario-sintetico.csv'), 'inv.csv');
const ev = (phrases) => ({ keywords: phrases.map((p, i) => ({ keyword: p, hits: 1, lang: 'pt-br', observations: [{ phrase: p, query: p, provider: 'google', sourceType: 'autocomplete', originFamily: 'semente', origins: [{ seed: p, strategy: 'seed', family: 'semente', generatedQuery: p }], hl: 'pt-br', gl: 'br', runId: 'r', requestId: `r#${i + 1}`, collectedAt: '2026-11-26T10:00:00.000Z' }] })) });

test('inventory: only affirmative "autorizada" rows, generic terms ignored', () => {
  const i = inv();
  const urls = i.pages.map((p) => p.url);
  assert.ok(!urls.includes('https://exemplo.test/rascunho'), '"não" excluded');
  assert.ok(!urls.includes('https://exemplo.test/blog/pdf-dwg-guia'), 'unknown value excluded');
  assert.match(i.warnings.join(' '), /não reconhecido/);
  const g = loadInventoryCsv('url,termos\nhttps://exemplo.test/a,online|editar dwg\n', 'g.csv');
  assert.deepEqual(g.pages[0].terms, ['editar dwg']);
});

test('candidate URL comes only from the inventory; observed URL is kept apart', () => {
  const gsc = [loadGscCsv(fx('gsc-consultas-paginas-pt.csv'), 'pt.csv')];
  const rows = buildOpportunities(ev(['abrir ifc online', 'converter pdf em dwg']), gsc, inv());
  const ifc = rows.find((r) => r.frase === 'abrir ifc online');
  assert.equal(ifc.url_observada_gsc, 'https://exemplo.test/fora-do-inventario');
  assert.equal(ifc.url_candidata, 'https://exemplo.test/ferramentas/visualizador-ifc');
  const invUrls = new Set(inv().pages.map((p) => p.url));
  for (const r of rows) if (r.url_candidata) assert.ok(invUrls.has(r.url_candidata));
  const pdf = rows.filter((r) => r.frase === 'converter pdf em dwg');
  assert.equal(pdf.length, 2);
  const l3 = pdf.find((r) => r.gsc_linha === 3);
  const l4 = pdf.find((r) => r.gsc_linha === 4);
  assert.equal(l3.url_candidata, 'https://exemplo.test/ferramentas/pdf-para-dwg');
  assert.match(l3.motivo_candidata, /pt\.csv, linha 3/, 'reason cites the row that links the page');
  // Line 4 links a page outside the inventory: it must NOT inherit line 3's link; only the inventory terms decide.
  assert.equal(l4.url_observada_gsc, 'https://exemplo.test/blog/pdf-dwg-guia');
  assert.doesNotMatch(l4.motivo_candidata, /linha 3/);
  assert.match(l4.motivo_candidata, /Termo do inventário/);
  assert.match(l3.melhoria_sugerida, /PDF → DWG/);
});

test('no match is "sem dados no recorte" (never zero); no usable file and no file are distinct', () => {
  const pages = [loadGscCsv(fx('gsc-so-paginas-pt.csv'), 'p.csv')];
  const q = [loadGscCsv(fx('gsc-so-consultas-en.csv'), 'q.csv')];
  const a = buildOpportunities(ev(['frase inexistente']), q, null)[0];
  assert.equal(a.gsc_status, GSC_STATUS.noMatch);
  assert.equal(a.gsc_cliques, null);
  assert.equal(buildOpportunities(ev(['frase inexistente']), pages, null)[0].gsc_status, GSC_STATUS.noUsable);
  assert.equal(buildOpportunities(ev(['frase inexistente']), null, null)[0].gsc_status, GSC_STATUS.notGiven);
  const csv = opportunitiesToCsv([a]);
  assert.match(csv, /sem dados no recorte/);
  const [head, line] = csv.replace(/^\uFEFF/, '').split('\r\n');
  const col = (name) => parseCsv(`${head}\n${line}\n`).rows[0].cells[head.split(',').indexOf(name)];
  for (const c of ['gsc_cliques', 'gsc_impressoes', 'gsc_posicao']) assert.equal(col(c), '', `${c} is empty, not 0`);
});

test('query-only Search Console file never links a URL, even when another file has the page', () => {
  const q = loadGscCsv(fx('gsc-so-consultas-en.csv'), 'q.csv');
  const pages = loadGscCsv(fx('gsc-so-paginas-pt.csv'), 'p.csv');
  const rows = buildOpportunities(ev(['editar dwg online']), [q, pages], null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url_observada_gsc, '');
  assert.match(rows[0].url_observada_status, /sem vínculo explícito/);
  assert.equal(rows[0].gsc_impressoes, 340);
});

test('ambiguity, intent mismatch, conflict and missing inventory are flagged, without improvement', () => {
  const i = inv();
  assert.equal(chooseCandidate('o que é ifc', [], i).status, STATUS.ambiguous);
  assert.equal(chooseCandidate('projeto de prevenção contra incêndio perto de mim', [], i).status, STATUS.intent);
  assert.equal(chooseCandidate('editar dwg online', [], null).status, STATUS.noInventory);
  assert.equal(chooseCandidate('receita de bolo', [], i).status, STATUS.none);
  const c = chooseCandidate('ppci perto de mim', [{ url: 'https://exemplo.test/servicos/ppci', file: 'x.csv', line: 2 }], i);
  assert.equal(c.status, STATUS.conflict);
  assert.equal(c.url, '');
  assert.ok(c.options.includes('https://exemplo.test/servicos/ppci'));
  const rows = buildOpportunities(ev(['o que é ifc']), null, i);
  assert.equal(rows[0].melhoria_sugerida, '');
  // Most specific term wins (rarer across pages), not the longest generic word.
  const j = loadInventoryCsv('url,termos\nhttps://exemplo.test/a,converter arquivos|converter\nhttps://exemplo.test/b,dwg\nhttps://exemplo.test/c,converter\n', 'j.csv');
  assert.equal(chooseCandidate('converter dwg', [], j).url, 'https://exemplo.test/b');
});

test('improvements are concrete and do not claim the page lacks something', () => {
  assert.match(suggestImprovement('converter pdf em dwg ou dxf'), /PDF → DWG ou DXF/);
  assert.match(suggestImprovement('converter para dwg a partir de pdf'), /PDF → DWG/);
  assert.match(suggestImprovement('editar dwg sem autocad'), /sem autocad/);
  assert.match(suggestImprovement('diferença entre ifc e rvt', ['comparacoes']), /compara/);
  for (const p of ['abrir ifc online', 'o que é ifc', 'quanto custa ppci']) assert.match(suggestImprovement(p), /^Conferir se a página/);
});

test('evidence schema is enforced; legacy exports are refused, organic titles dropped', () => {
  assert.throws(() => readEvidence({ keywords: [{ keyword: 'x' }] }), /schema/);
  assert.throws(() => readEvidence({ schema: EVIDENCE_SCHEMA, keywords: [{ keyword: 'x', observations: [] }] }), /observations/);
  const d = readEvidence({ schema: EVIDENCE_SCHEMA, keywords: [
    { keyword: 'título', observations: [{ phrase: 'título', query: 'q', provider: 'serp-organic', sourceType: 'serp-organic', origins: [{ seed: 'q', strategy: 'serp-page-1', family: 'serp', generatedQuery: 'q' }], serpPage: 1, hl: 'pt-br', gl: 'br', runId: 'r', requestId: 'r#1', collectedAt: '2026-11-26T00:00:00Z' }] },
  ] });
  assert.equal(d.keywords.length, 0);
  assert.equal(d.droppedTitles, 1);
});

test('opportunities CSV guards against formula injection', () => {
  const rows = buildOpportunities(ev(['=HYPERLINK("x")']), null, null);
  assert.match(opportunitiesToCsv(rows), /"'=HYPERLINK\(""x""\)"/);
});

// ------------------------------------------------------------------ CLI
test('cli oportunidades: end-to-end with synthetic files, refuses to overwrite an input and non-UTF-8 files', () => {
  const dir = tmp();
  const evidence = join(dir, 'ev.json');
  const res = [{ keyword: 'abrir ifc online', engines: ['google'], hits: 1, seed: 'abrir ifc', query: 'abrir ifc online', strategy: 'modifiers', depth: 0,
    observations: ev(['abrir ifc online']).keywords[0].observations }];
  writeFileSync(evidence, serialize('json', res, { lang: 'pt-br', country: 'br' }));
  const fxp = (f) => join(root, 'test', 'fixtures', 'br', f);
  const out = join(dir, 'op.csv');
  const r = cli('oportunidades', '--evidencias', evidence, '--gsc', fxp('gsc-consultas-paginas-pt.csv'), '--inventario', fxp('inventario-sintetico.csv'), '-o', out, '-o', join(dir, 'op.json'));
  assert.equal(r.status, 0, r.stderr);
  const csv = readFileSync(out, 'utf8');
  assert.ok(csv.startsWith('\uFEFFfrase,'));
  assert.match(csv, /https:\/\/exemplo\.test\/ferramentas\/visualizador-ifc/);
  assert.match(r.stderr, /Consulta observada → evidência → página candidata → melhoria/);
  const invCopy = join(dir, 'inv.csv');
  writeFileSync(invCopy, readFileSync(fxp('inventario-sintetico.csv')));
  const over = cli('oportunidades', '--evidencias', evidence, '--inventario', invCopy, '-o', invCopy);
  assert.notEqual(over.status, 0);
  assert.match(over.stderr, /sobrescreveria/);
  assert.equal(readFileSync(invCopy, 'utf8'), readFileSync(fxp('inventario-sintetico.csv'), 'utf8'), 'input untouched');
  const overEv = cli('oportunidades', '--evidencias', evidence, '-o', join(dir, '.', 'ev.json'));
  assert.match(overEv.stderr, /sobrescreveria/);
  const evOver = cli('oportunidades', '--evidencias', evidence, '-o', join(dir, 'x.txt'));
  assert.match(evOver.stderr, /\.csv ou \.json/);
  const latin = join(dir, 'latin1.csv');
  writeFileSync(latin, Buffer.from('Consulta,Impress\xf5es\nabrir ifc online,3\n', 'latin1'));
  const enc = cli('oportunidades', '--evidencias', evidence, '--gsc', latin, '-o', join(dir, 'y.csv'));
  assert.notEqual(enc.status, 0);
  assert.match(enc.stderr, /UTF-8/);
  assert.ok(!existsSync(join(dir, 'y.csv')));
});

test('cli: "--" makes "oportunidades" a seed; -x accepts Portuguese family names', () => {
  const r = cli('-e', 'nao-existe', '--', 'oportunidades');
  assert.match(r.stderr, /Unknown engine "nao-existe"/, 'parsed as a collection run, not the subcommand');
  const bad = cli('-x', 'perguntas,inexistente', '--list-engines');
  assert.match(bad.stderr, /Unknown --expand entry "inexistente"/);
  assert.equal(cli('-x', 'perguntas,modificadores,comparações,alfabética', '--list-engines').status, 0);
});

// ------------------------------------------------------------------ UI strings & synthetic demo
test('every UI string used by index.html exists in pt, en and tr (incl. accessible labels)', () => {
  const html = readFileSync(join(root, 'web', 'index.html'), 'utf8');
  const keys = new Set([...html.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(keys.has('filter') && keys.has('exclude') && keys.has('termsComparisons'));
  for (const lang of ['pt', 'en', 'tr']) for (const k of keys) assert.ok(STRINGS[lang][k], `${lang}.${k}`);
  assert.match(html, /<html lang="pt-BR"/);
  assert.ok(!/aria-label="(Filter|Exclude|Language)"/.test(html), 'no hard-coded English labels');
});

test('synthetic demo shows observed query → evidence → candidate page → improvement', async () => {
  const dir = tmp();
  await runDemo(dir, { quiet: true });
  const d = JSON.parse(readFileSync(join(dir, 'oportunidades-sinteticas.json'), 'utf8'));
  const row = d.oportunidades.find((r) => r.frase === 'converter pdf em dwg' && r.gsc_linha === 3);
  assert.ok(row);
  assert.equal(row.url_observada_gsc, 'https://exemplo.test/ferramentas/pdf-para-dwg');
  assert.equal(row.url_candidata, 'https://exemplo.test/ferramentas/pdf-para-dwg');
  assert.match(row.cadeia, /“converter pdf em dwg” → .*observação.* → página candidata https:\/\/exemplo\.test\/ferramentas\/pdf-para-dwg → Conferir/);
  assert.ok(d.oportunidades.every((r) => !r.url_candidata || r.url_candidata.startsWith('https://exemplo.test/')));
});

// ------------------------------------------------------------------ regressions from the final reviews
import { linkSync } from 'node:fs';
import { createProxy } from '../lib/proxy-core.js';
import { t } from '../web/js/i18n.js';
import { ENGINE_MAP as EM } from '../web/js/engines.js';
import { runSerpPhase } from '../web/js/serp-client.js';

test('"seed x" (alphabet) and "seed x " (comparison) are two requests with their own origins', async () => {
  const sent = [];
  const m = new Miner({ fetcher: async (e, q) => { sent.push(q); return q === 'autocad x ' ? ['autocad x revit'] : q === 'autocad x' ? ['autocad xref'] : []; },
    engines: ['google'], seeds: ['autocad'], delayMs: 0, expansion: { seed: false, alphaSuffix: true, comparisons: true, lang: 'pt-br' } });
  const res = await m.run();
  assert.ok(sent.includes('autocad x') && sent.includes('autocad x '));
  assert.deepEqual(res.find((r) => r.keyword === 'autocad x revit').observations[0].origins.map((o) => o.family), ['comparacoes']);
  assert.deepEqual(res.find((r) => r.keyword === 'autocad xref').observations[0].origins.map((o) => o.family), ['alfabetica']);
});

test('hits count observations, not duplicates inside one response; extracted text kept when it differs', async () => {
  const fetcher = async () => Object.assign(['abrir ifc online', 'abrir ifc online'], { extracted: ['abrir  ifc online', 'abrir ifc online'], cached: false });
  const m = new Miner({ fetcher, engines: ['google'], seeds: ['abrir ifc'], delayMs: 0, expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const [r] = await m.run();
  assert.equal(r.hits, 1);
  assert.equal(r.observations.length, 1);
  assert.deepEqual(r.observations[0].extractedVariants, ['abrir  ifc online']);
  assert.equal(r.observations[0].fromCache, false);
  const parsed = EM.bing.http.parse(['q', ['abrir <b>ifc</b>  online']]);
  assert.deepEqual([...parsed], ['abrir ifc online']);
  assert.deepEqual(parsed.extracted, ['abrir ifc  online']);
  const plain = EM.google.http.parse(['q', ['abrir ifc  online']]);
  assert.deepEqual([...plain], ['abrir ifc online']);
  assert.deepEqual(plain.extracted, ['abrir ifc  online']);
});

test('same phrase as organic title and related search on one SERP page keeps both sources', async () => {
  const m = new Miner({ engines: [], seeds: ['ifc'], fetcher: async () => [] });
  await runSerpPhase({ miner: m, seeds: ['ifc'], pages: 1, sources: ['organic', 'related'], delayMs: 0, minDelayMs: 0,
    fetchPage: async () => ({ status: 'ok', organic: ['o que é ifc'], related: ['o que é ifc'], paa: [], hasNext: false, cached: false, fetchedAt: '2026-11-26T00:00:00.000Z' }) });
  const [r] = m.getResults();
  assert.deepEqual(r.observations.map((o) => o.sourceType).sort(), ['serp-organic', 'serp-related']);
  assert.equal(r.observations[0].providerFetchedAt, '2026-11-26T00:00:00.000Z');
  const json = JSON.parse(serialize('json', [r], { lang: 'pt-br' }));
  const ev2 = readEvidence(json);
  assert.equal(ev2.keywords.length, 1, 'kept through the related-search observation');
  assert.deepEqual(ev2.keywords[0].observations.map((o) => o.sourceType), ['serp-related']);
});

test('mustContainSeed: legacy fields and recursive children use the eligible seeds only', async () => {
  // "dwg z" is both the seed "dwg z" and the alphabet probe of the seed "dwg": ONE request, two origins.
  const fetcher = async (e, q) => (q === 'dwg z' ? ['dwg viewer'] : q === 'dwg viewer' ? ['dwg viewer online'] : []);
  const m = new Miner({ fetcher, engines: ['google'], seeds: ['dwg z', 'dwg'], delayMs: 0, depth: 1, mustContainSeed: true,
    expansion: { seed: true, alphaSuffix: true, lang: 'pt-br' } });
  const res = await m.run();
  const parent = res.find((r) => r.keyword === 'dwg viewer');
  assert.equal(parent.seed, 'dwg', 'legacy seed = first ELIGIBLE origin ("dwg z" does not fit "dwg viewer")');
  assert.deepEqual(parent.observations[0].origins.map((o) => o.seed), ['dwg']);
  const child = res.find((r) => r.keyword === 'dwg viewer online');
  assert.ok(child, 'recursive child kept');
  assert.ok(child.observations.every((o) => o.origins.every((x) => x.seed === 'dwg' && x.family === 'recursiva')));
});

test('Search Console: shifted rows are rejected, decimals per file, ambiguous integers flagged, CRLF accepted', () => {
  const r = loadGscCsv('Query,Clicks,Impressions\nabc,1,234,500\nok,3,4\n', 'x.csv');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rejected, 1);
  assert.match(r.warnings.join(' '), /linha 2 ignorada/);
  const pt = loadGscCsv('Consulta;Cliques;Posição\r\na;1.234;1.234,5\r\n', 'pt.csv');
  assert.equal(pt.decimal, ',');
  assert.deepEqual([pt.rows[0].clicks, pt.rows[0].position], [1234, 1234.5]);
  const en = loadGscCsv('Query,Clicks,Position\na,"1,234",2.5\n', 'en.csv');
  assert.deepEqual([en.rows[0].clicks, en.rows[0].position], [1234, 2.5]);
  assert.equal(parseInteger('1,234', ',').value, null, 'decimal comma file: 1,234 is not an integer');
  assert.equal(parseInteger('1.234,567').value, null, 'mixed thousands symbols');
  assert.equal(canonicalUrl('https://exemplo.test/a?q=a%20b&utm_source=x'), canonicalUrl('https://exemplo.test/a?q=a%20b'));
});

test('inventory: shifted rows and unknown intents never authorise a page; six intents', () => {
  const i = loadInventoryCsv('url,termos,intencoes,autorizada\nhttps://exemplo.test/a,termo a,ferramenta\nhttps://exemplo.test/b,termo b,sim,extra,sim\nhttps://exemplo.test/c,termo c,blog,sim\nhttps://exemplo.test/d,termo d,comparacao,sim\n', 'i.csv');
  assert.deepEqual(i.pages.map((p) => p.url), ['https://exemplo.test/d']);
  assert.match(i.warnings.join(' '), /linha 3 ignorada/);
  assert.match(i.warnings.join(' '), /intenção desconhecida "blog"/);
  const inv2 = loadInventoryCsv('url,termos,intencoes\nhttps://exemplo.test/cmp,editor de video,comparacao\nhttps://exemplo.test/cont,editor de video,conteudo\n', 'j.csv');
  assert.equal(chooseCandidate('editor de video ou outro', [], inv2, ['comparacoes']).status, STATUS.ambiguous, 'both accept comparisons');
  assert.equal(chooseCandidate('quanto custa editor de video', [], inv2, ['perguntas']).url, 'https://exemplo.test/cont', 'only conteudo answers questions/price');
  const tie = loadInventoryCsv('url,termos\nhttps://exemplo.test/x,converter\nhttps://exemplo.test/y,pdf\n', 't.csv');
  assert.equal(chooseCandidate('converter pdf', [], tie).status, STATUS.ambiguous, 'length is not a tiebreak');
});

test('candidate is per row: a query-only row never cites the link of another file', () => {
  const both = loadGscCsv(fx('gsc-consultas-paginas-pt.csv'), 'jan/Consultas.csv');
  const only = loadGscCsv(fx('gsc-so-consultas-en.csv'), 'fev/Consultas.csv');
  const rows = buildOpportunities(ev(['editar dwg online']), [both, only], inv());
  const a = rows.find((r) => r.gsc_arquivo === 'jan/Consultas.csv');
  const b = rows.find((r) => r.gsc_arquivo === 'fev/Consultas.csv');
  assert.match(a.motivo_candidata, /jan\/Consultas\.csv, linha 2/);
  assert.doesNotMatch(b.motivo_candidata, /jan\/Consultas/);
  assert.equal(b.url_observada_gsc, '');
});

test('evidence whose keyword is not proven by its observations is refused', () => {
  const k = { keyword: 'frase nunca devolvida', observations: ev(['abrir ifc online']).keywords[0].observations };
  assert.throws(() => readEvidence({ schema: EVIDENCE_SCHEMA, keywords: [k] }), /diferente da palavra/);
  const bad = { keyword: 'abrir ifc online', observations: [{ ...k.observations[0], sourceType: 'inventada' }] };
  assert.throws(() => readEvidence({ schema: EVIDENCE_SCHEMA, keywords: [bad] }), /fonte desconhecida/);
});

test('cli oportunidades: hard link to an input is refused; inputs need .json/.csv; same file name in two folders stays distinct', () => {
  const dir = tmp();
  const evidence = join(dir, 'ev.json');
  const res = [{ keyword: 'editar dwg online', engines: ['google'], hits: 1, seed: 's', query: 'q', strategy: 'seed', depth: 0, observations: ev(['editar dwg online']).keywords[0].observations }];
  writeFileSync(evidence, serialize('json', res, { lang: 'pt-br' }));
  const inv0 = join(dir, 'inv.csv');
  writeFileSync(inv0, readFileSync(join(root, 'test', 'fixtures', 'br', 'inventario-sintetico.csv')));
  const hard = join(dir, 'hard.csv');
  linkSync(inv0, hard);
  const r = cli('oportunidades', '--evidencias', evidence, '--inventario', inv0, '-o', hard);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sobrescreveria/);
  assert.equal(readFileSync(inv0, 'utf8'), readFileSync(join(root, 'test', 'fixtures', 'br', 'inventario-sintetico.csv'), 'utf8'));
  assert.match(cli('oportunidades', '--evidencias', inv0, '-o', join(dir, 'o.csv')).stderr, /esperado um arquivo \.json/);
  for (const m of ['jan', 'fev']) { mkdirSync(join(dir, m)); writeFileSync(join(dir, m, 'Consultas.csv'), `Consulta,Cliques\neditar dwg online,${m === 'jan' ? 1 : 2}\n`); }
  const out = join(dir, 'o.json');
  const ok = cli('oportunidades', '--evidencias', evidence, '--gsc', join(dir, 'jan', 'Consultas.csv'), '--gsc', join(dir, 'fev', 'Consultas.csv'), '-o', out, '-q');
  assert.equal(ok.status, 0, ok.stderr);
  const files = JSON.parse(readFileSync(out, 'utf8')).oportunidades.map((x) => x.gsc_arquivo);
  assert.equal(new Set(files).size, 2);
});

test('proxy keeps the trailing space of connector queries; UI keeps literal {s}', async () => {
  const seen = [];
  const handle = createProxy({ fetcher: async (e, q) => { seen.push(q); return ['x']; } });
  const res = await handle(new URLSearchParams({ engine: 'google', q: 'editar dwg com ', hl: 'pt-br', gl: 'br' }));
  assert.equal(seen[0], 'editar dwg com ');
  assert.equal(res.body.cached, false);
  assert.ok(res.body.fetchedAt);
  assert.match(t('pt', 'termsQuestionsPh'), /\{s\}/);
  assert.match(t('pt', 'familyTermsHint'), /\{s\}/);
});

test('known search languages use their own question words only', () => {
  assert.ok(isQuestionIn('cómo abrir un pdf', 'es'));
  assert.ok(!isQuestionIn('how to open pdf', 'tr'), 'English rule not applied to Turkish');
  assert.ok(isQuestionIn('how to open pdf', 'en'));
  assert.ok(isQuestionIn('how to open pdf', null), 'unknown language: legacy multi-language rule');
});

// ------------------------------------------------------------------ regressions from the second review round
import { parseGoogleSerp, stripTags } from '../lib/serp-parse.js';
import { detectFileFormat, gscKey } from '../lib/gsc.js';
import { createSerpService } from '../lib/serp-service.js';

test('CSV: text after a closing quote invalidates the row; duplicate fields and "sim?" never authorise', () => {
  const g = loadGscCsv('Query,Clicks\n"a",1\n"b","1"2\n', 'q.csv');
  assert.deepEqual(g.rows.map((r) => [r.query, r.clicks]), [['a', 1]]);
  assert.match(g.warnings.join(' '), /aspas mal formadas/);
  const i = loadInventoryCsv('url,termos,autorizada\nhttps://exemplo.test/a,termo a,"s"im\nhttps://exemplo.test/b,termo b,sim?\nhttps://exemplo.test/c,termo c,Sim\n', 'i.csv');
  assert.deepEqual(i.pages.map((p) => p.url), ['https://exemplo.test/c']);
  assert.throws(() => loadInventoryCsv('url,termos,autorizada,authorized\nhttps://exemplo.test/a,t a,não,sim\n', 'd.csv'), /colunas repetidas/);
  assert.throws(() => loadGscCsv('Query,Clicks,Cliques\na,1,2\n', 'd.csv'), /colunas repetidas/);
});

test('number convention is inferred from valid values only; counts reject percent signs and inner spaces', () => {
  assert.equal(detectFileFormat(['1.2,3', '1.5'], []), '.', 'an invalid "1.2,3" does not vote');
  assert.equal(detectFileFormat([], ['1,234', '1.234']), 'misto', 'conflicting thousands symbols');
  assert.throws(() => loadGscCsv('Query,Clicks\na,"1,234"\nb,1.234\n', 'x.csv'), /mistura/);
  assert.equal(parseInteger('1 2').value, null);
  assert.equal(parseInteger('12%').value, null);
  assert.equal(parseDecimal('1 2', ',').value, null);
  assert.equal(parseDecimal('3,2%', ',', { percent: true }).value, 3.2);
  assert.equal(parseDecimal('1,5%', ',').value, null, '"%" only in CTR');
  assert.equal(detectFileFormat(['1,5%'], [], ['2.5%']), '.', 'an invalid position with % does not vote');
  assert.equal(parseInteger('9007199254740993').value, null, 'beyond 2^53');
  assert.equal(canonicalUrl('https://exemplo.test/a?q=a%20b&utm_source_platform=x'), 'https://exemplo.test/a?q=a%20b');
});

test('evidence must be coherent: source matches provider, valid locale/ids/date, no duplicate observations', () => {
  const base = ev(['abrir ifc online']).keywords[0].observations[0];
  const one = (o) => ({ schema: EVIDENCE_SCHEMA, keywords: [{ keyword: 'abrir ifc online', observations: Array.isArray(o) ? o : [o] }] });
  assert.throws(() => readEvidence(one({ ...base, provider: 'serp-organic', sourceType: 'autocomplete' })), /incompatível/);
  assert.throws(() => readEvidence(one({ ...base, hl: 'português' })), /idioma\/país inválido/);
  assert.throws(() => readEvidence(one({ ...base, origins: [{ seed: 's', strategy: 'seed', family: 'semente' }] })), /consulta gerada/);
  assert.throws(() => readEvidence(one({ ...base, collectedAt: 0 })), /data da coleta/);
  assert.throws(() => readEvidence(one({ ...base, requestId: 'outro#1' })), /incoerentes/);
  assert.throws(() => readEvidence(one({ ...base, requestId: 'r#' })), /incoerentes/);
  assert.throws(() => readEvidence(one({ ...base, collectedAt: '2026-02-30T01:00:00Z' })), /data da coleta/);
  assert.throws(() => readEvidence(one({ ...base, provider: 'serp-organic ', sourceType: 'autocomplete' })), /provedor inválido/);
  assert.throws(() => readEvidence(one({ ...base, origins: [{ seed: 'q', strategy: 'serp-page-1', family: 'serp', generatedQuery: 'abrir ifc online' }], serpPage: 1 })), /incompatível/);
  assert.throws(() => readEvidence(one({ ...base, origins: [{ seed: 'q', strategy: ' serp-page-1', family: ' serp', generatedQuery: 'abrir ifc online' }] })), /estratégia desconhecida/);
  assert.throws(() => readEvidence(one({ ...base, origins: [{ seed: 'q', strategy: 'seed', family: 'perguntas', generatedQuery: 'abrir ifc online' }] })), /não corresponde/);
  assert.throws(() => readEvidence(one({ ...base, origins: [{ seed: 'q', strategy: 'seed', family: 'semente', generatedQuery: 'madeira' }] })), /consulta gerada/);
  const two = { schema: EVIDENCE_SCHEMA, keywords: [
    { keyword: 'abrir ifc online', observations: [base] },
    { keyword: 'abrir ifc', observations: [{ ...base, phrase: 'abrir ifc', query: 'outra consulta', origins: [{ ...base.origins[0], generatedQuery: 'outra consulta' }] }] },
  ] };
  assert.throws(() => readEvidence(two), /consulta, provedor ou idioma diferentes/);
  assert.throws(() => readEvidence(one([base, { ...base }])), /repetida/);
  assert.equal(readEvidence(one(base)).keywords.length, 1);
});

test('extracted variants survive the proxy, its cache and duplicates in one response; one fetchedAt for fresh and cached', async () => {
  const fetcher = async () => Object.defineProperty(['abrir ifc'], 'extracted', { value: ['abrir  ifc'], enumerable: false });
  const handle = createProxy({ fetcher });
  const p = new URLSearchParams({ engine: 'google', q: 'abrir', hl: 'pt-br', gl: 'br' });
  const fresh = await handle(p);
  const cached = await handle(p);
  assert.deepEqual(fresh.body.extracted, ['abrir  ifc']);
  assert.deepEqual(cached.body.extracted, ['abrir  ifc']);
  assert.equal(fresh.body.fetchedAt, cached.body.fetchedAt);
  assert.equal(cached.body.cached, true);
  const m = new Miner({ fetcher: async () => Object.defineProperty(['abrir ifc', 'abrir ifc'], 'extracted', { value: ['abrir ifc', 'abrir\tifc'], enumerable: false }),
    engines: ['google'], seeds: ['abrir'], delayMs: 0, expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const [r] = await m.run();
  assert.equal(r.observations.length, 1);
  assert.equal(r.hits, 1);
  assert.deepEqual(r.observations[0].extractedVariants, ['abrir\tifc'], 'collapsed variant first, spaced variant still kept');
});

test('SERP parser keeps extracted variants per item; the SERP cache reuses the original fetchedAt', async () => {
  const html = '<div id="search"><h3>Abrir   IFC</h3><div data-q="o que é  ifc"></div><div data-q="o que é ifc"></div></div>';
  const r = parseGoogleSerp(html, { query: 'ifc' });
  assert.deepEqual(r.paa, ['o que é ifc']);
  assert.deepEqual(r.extracted.paa, [['o que é  ifc', 'o que é ifc']]);
  assert.deepEqual(r.extracted.organic, [['Abrir   IFC']]);
  let clock = 1_000_000;
  const svc = createSerpService({ backend: { fetchPage: async () => ({ status: 'ok', related: [], paa: ['x'], organic: [], hasNext: false }) }, options: { minGapMs: 0 }, now: () => clock, sleep: async () => {} });
  const q = new URLSearchParams({ q: 'ifc', page: '0', hl: 'pt-br', gl: 'br' });
  const a = await svc.handle(q);
  clock += 5000;
  const b = await svc.handle(q);
  assert.equal(a.body.fetchedAt, b.body.fetchedAt);
  assert.equal(b.body.cached, true);
});

test('a later eligible origin is merged into the pending recursive child (mustContainSeed)', async () => {
  const answers = { ifc: ['ifc dwg'], dwg: ['ifc dwg'], 'ifc dwg': ['exportar dwg'] };
  const m = new Miner({ fetcher: async (e, q) => answers[q] || [], engines: ['google'], seeds: ['ifc', 'dwg'], delayMs: 0, depth: 1, mustContainSeed: true,
    expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const res = await m.run();
  const child = res.find((r) => r.keyword === 'exportar dwg');
  assert.ok(child, 'child kept thanks to the second seed');
  assert.deepEqual([...new Set(child.observations.flatMap((o) => o.origins.map((x) => x.seed)))], ['dwg']);
});

test('a known language without vocabulary gets no English rules; generic words do not make a term specific', () => {
  assert.ok(!isQuestionIn('how to open pdf', 'it'));
  assert.ok(isQuestionIn('come aprire pdf?', 'it'), 'the "?" rule still applies');
  const inv3 = loadInventoryCsv('url,termos\nhttps://exemplo.test/a,projeto de|projeto de prevenção\nhttps://exemplo.test/b,ppci\n', 'g.csv');
  assert.deepEqual(inv3.pages[0].terms, ['projeto de prevencao']);
  assert.equal(chooseCandidate('projeto de ppci', [], inv3).url, 'https://exemplo.test/b');
});

test('familyTermsByRun: export and opportunities classify each run with its own terms', () => {
  const obs = (phrase, runId) => ({ phrase, provider: 'google', sourceType: 'autocomplete', query: phrase, originFamily: 'semente',
    origins: [{ seed: phrase, strategy: 'seed', family: 'semente', generatedQuery: phrase }], hl: 'pt-br', gl: 'br', runId, requestId: `${runId}#1`, collectedAt: '2026-11-26T10:00:00.000Z' });
  const recs = [
    { keyword: 'abrir pdf xyzzy', engines: ['google'], hits: 1, observations: [obs('abrir pdf xyzzy', 'A')] },
    { keyword: 'outra xyzzy', engines: ['google'], hits: 1, observations: [obs('outra xyzzy', 'B')] },
  ];
  const meta = { familyTermsByRun: { A: { perguntas: ['{s} xyzzy'] }, B: {} } };
  const json = JSON.parse(serialize('json', recs, meta));
  assert.deepEqual(json.keywords.map((k) => k.question), [true, false]);
  const rows = buildOpportunities(readEvidence(json), null, null);
  assert.deepEqual(rows.find((r) => r.frase === 'abrir pdf xyzzy').familias_texto, ['perguntas']);
  assert.deepEqual(rows.find((r) => r.frase === 'outra xyzzy').familias_texto, []);
});

// ------------------------------------------------------------------ regressions from the third review round
import { createBrowserFetcher } from '../web/js/transport-browser.js';

test('browser fetcher via proxy carries cached, fetchedAt and extracted into the observation', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ engine: 'yandex', q: 'abrir', suggestions: ['abrir ifc'], extracted: ['abrir  ifc'], cached: true, fetchedAt: '2026-11-25T08:00:00.000Z' }), { headers: { 'content-type': 'application/json' } });
  const fetcher = createBrowserFetcher({ proxyUrl: 'http://127.0.0.1:9', preferProxy: true });
  const m = new Miner({ fetcher, engines: ['yandex'], seeds: ['abrir'], delayMs: 0, expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const [r] = await m.run();
  const o = r.observations[0];
  assert.equal(o.fromCache, true);
  assert.equal(o.providerFetchedAt, '2026-11-25T08:00:00.000Z');
  assert.deepEqual(o.extractedVariants, ['abrir  ifc']);
});

test('every eligible origin with depth left recurses from its own depth (depth 2, both seed orders)', async () => {
  const ans = { dwg: ['ifc dwg'], 'ifc dwg': ['ifc dwg online'], 'ifc dwg online': ['exportar dwg'] };
  for (const seeds of [['dwg', 'ifc dwg'], ['ifc dwg', 'dwg']]) {
    const m = new Miner({ fetcher: async (e, q) => ans[q] || [], engines: ['google'], seeds, delayMs: 0, depth: 2, mustContainSeed: true,
      expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
    const res = await m.run();
    assert.ok(res.some((r) => r.keyword === 'exportar dwg'), `exportar dwg kept (${seeds})`);
  }
});

test('a replayed answer keeps the time it was received', async () => {
  const ans = { ifc: ['guia ifc dwg'], dwg: ['ifc dwg'], 'ifc dwg': ['guia ifc dwg', 'exportar dwg'] };
  const m = new Miner({ fetcher: async (e, q) => { await new Promise((r) => setTimeout(r, 15)); return ans[q] || []; }, engines: ['google'], seeds: ['ifc dwg', 'ifc', 'dwg'], delayMs: 0, depth: 1, mustContainSeed: true,
    expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const res = await m.run();
  const a = res.find((r) => r.keyword === 'guia ifc dwg').observations.find((o) => o.query === 'ifc dwg');
  const b = res.find((r) => r.keyword === 'exportar dwg')?.observations.find((o) => o.query === 'ifc dwg');
  assert.ok(a && b, 'both phrases observed from the same request');
  assert.equal(a.requestId, b.requestId);
  assert.equal(a.collectedAt, b.collectedAt);
});

test('recursion depth is per origin and late origins are replayed, whatever the seed order', async () => {
  const ans = { dwg: ['ifc dwg'], 'ifc dwg': ['exportar dwg'], 'exportar dwg': ['graduar dwg'] };
  for (const seeds of [['ifc dwg', 'dwg'], ['dwg', 'ifc dwg']]) {
    const m = new Miner({ fetcher: async (e, q) => ans[q] || [], engines: ['google'], seeds, delayMs: 0, depth: 1, mustContainSeed: true,
      expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
    const res = await m.run();
    const exp = res.find((r) => r.keyword === 'exportar dwg');
    assert.ok(exp, `exportar dwg kept (${seeds})`);
    assert.equal(Math.min(...exp.observations.map((o) => o.depth)), 1, 'its only eligible origin is at depth 1');
    assert.ok(!res.some((r) => r.keyword === 'graduar dwg'), `no collection beyond the depth limit (${seeds})`);
  }
});

test('plural/feminine generic words do not make an inventory term specific', () => {
  const inv4 = loadInventoryCsv('url,termos\nhttps://exemplo.test/a,melhores ferramentas gratuitas online\nhttps://exemplo.test/b,ifc\n', 'f.csv');
  assert.deepEqual(inv4.pages[0].terms, []);
  assert.equal(chooseCandidate('melhores ferramentas gratuitas online ifc', [], inv4).url, 'https://exemplo.test/b');
  assert.throws(() => loadInventoryCsv('url,termos,autori"zada\nhttps://exemplo.test/a,t a,não\n', 'q.csv'), /aspas/);
  assert.throws(() => loadInventoryCsv('url,termos,autorizacao_ok\nhttps://exemplo.test/a,t a,não\n', 'q.csv'), /parece de autorização/);
  assert.throws(() => loadInventoryCsv('url,termos,autorziada\nhttps://exemplo.test/privada,cobre,não\n', 'q.csv'), /não reconhecida/);
  assert.equal(loadInventoryCsv('url,termos,notas\nhttps://exemplo.test/a,cobre,livre\n', 'n.csv').pages.length, 1, 'note columns are allowed');
  const inv5 = loadInventoryCsv('url,termos\nhttps://exemplo.test/a,ferramentas fáceis e boas\nhttps://exemplo.test/b,pdf\n', 'h.csv');
  assert.equal(chooseCandidate('ferramentas fáceis e boas para pdf', [], inv5).url, 'https://exemplo.test/b');
  assert.equal(parseInteger('0.123').value, null);
});

test('an echo of the query does not leak a recursive origin into the rest of the same answer', async () => {
  const m = new Miner({ fetcher: async (e, q) => (q === 'editar dwg' ? ['editar dwg', 'editar dwg online'] : []), engines: ['google'], seeds: ['editar dwg'], delayMs: 0, depth: 1,
    expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const res = await m.run();
  const r = res.find((x) => x.keyword === 'editar dwg online');
  const first = r.observations.find((o) => o.query === 'editar dwg');
  assert.deepEqual(first.origins.map((o) => o.family), ['semente']);
});

test('SERP evidence: page number must match the strategy; origins must be an array', () => {
  const o = { phrase: 'o que é ifc', provider: 'serp-related', sourceType: 'serp-related', query: 'ifc', originFamily: 'serp',
    origins: [{ seed: 'ifc', strategy: 'serp-page-1', family: 'serp', generatedQuery: 'ifc' }], serpPage: 2, hl: 'pt-br', gl: 'br', runId: 'r', requestId: 'r#1', collectedAt: '2026-11-26T10:00:00.000Z' };
  const doc = (x) => ({ schema: EVIDENCE_SCHEMA, keywords: [{ keyword: 'o que é ifc', observations: [x] }] });
  assert.throws(() => readEvidence(doc(o)), /página de resultado incoerente/);
  assert.equal(readEvidence(doc({ ...o, serpPage: 1 })).keywords.length, 1);
  assert.throws(() => readEvidence(doc({ ...o, serpPage: 1, origins: {} })), /origens ausentes/);
});

// ------------------------------------------------------------------ regressions from the fifth review round
test('Search Console join keeps zero-width joiners: different emoji sequences never share metrics', () => {
  const zwj = 'curso 👩‍💻';
  const plain = 'curso 👩💻';
  const gsc = loadGscCsv(`Consulta,Página,Cliques\n${plain},https://exemplo.test/a,10\n`, 'z.csv');
  const obs = (p, i) => ({ phrase: p, provider: 'google', sourceType: 'autocomplete', query: p, originFamily: 'semente',
    origins: [{ seed: p, strategy: 'seed', family: 'semente', generatedQuery: p }], hl: 'pt-br', gl: 'br', runId: 'r', requestId: `r#${i}`, collectedAt: '2026-11-26T10:00:00.000Z' });
  // The miner merges both under one record (its key drops U+200D); the opportunities split them again.
  const rows = buildOpportunities({ keywords: [{ keyword: zwj, observations: [obs(zwj, 1), obs(plain, 2)] }] }, [gsc], null);
  assert.equal(rows.find((r) => r.frase === zwj).gsc_status, 'sem dados no recorte');
  assert.equal(rows.find((r) => r.frase === plain).gsc_cliques, 10);
});

test('only importable decimals vote; a file whose rows were all refused is not an empty date range', () => {
  const g = loadGscCsv('Query;Position;CTR\ncobre;1000000000000000,5;2.5%\n', 'v.csv');
  assert.equal(g.decimal, '.');
  assert.equal(g.rows[0].position, null);
  const bad = loadGscCsv('Query,Clicks\n"a"x,1\n', 'b.csv');
  assert.equal(buildOpportunities(ev(['abrir ifc online']), [bad], null)[0].gsc_status, 'nenhuma linha válida no Search Console (todas recusadas)');
});

test('origins added while an answer is replayed are processed too (order-independent)', async () => {
  const ans = { 'pdf ifc': ['ifc'], ifc: ['pdf ifc', 'visualizar ifc'] };
  const fams = [];
  for (const seeds of [['pdf ifc', 'ifc'], ['ifc', 'pdf ifc']]) {
    const m = new Miner({ fetcher: async (e, q) => ans[q] || [], engines: ['google'], seeds, delayMs: 0, depth: 2, mustContainSeed: true,
      expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
    const v = (await m.run()).find((x) => x.keyword === 'visualizar ifc');
    fams.push([...new Set(v.observations.flatMap((o) => o.origins.map((y) => y.family)))].sort().join('|'));
  }
  assert.equal(fams[0], fams[1]);
});

test('the record depth follows its first observation; one receive time per SERP page', async () => {
  const m = new Miner({ engines: [], seeds: ['ifc'], fetcher: async () => [] });
  m.on('result', () => { const t = Date.now(); while (Date.now() - t < 15); });
  await runSerpPhase({ miner: m, seeds: ['ifc'], pages: 1, sources: ['related'], delayMs: 0, minDelayMs: 0,
    fetchPage: async () => ({ status: 'ok', related: ['ifc a', 'ifc b'], paa: [], organic: [], hasNext: false }) });
  const times = m.getResults().flatMap((r) => r.observations.map((o) => o.collectedAt));
  assert.equal(new Set(times).size, 1);
  const rec = { keyword: 'x', norm: 'x', depth: 2, engines: new Set(), hits: 1, observations: [{ depth: 2, phrase: 'x', provider: 'google', requestId: 'other#1', origins: [] }] };
  m.results.set('x', rec);
  m.addResult('x', 'google', { q: 'y', seed: 'y', strategy: 'seed', depth: 1, origins: [{ seed: 'y', strategy: 'seed', generatedQuery: 'y', depth: 1 }] });
  assert.equal(rec.depth, 2, 'another, shallower observation does not rewrite the first one\'s depth');
  rec.observations[0].depth = 1;
  m.addResult('x', 'google', { q: 'z', seed: 'z', strategy: 'seed', depth: 3, origins: [{ seed: 'z', strategy: 'seed', generatedQuery: 'z', depth: 3 }] });
  assert.equal(rec.depth, 1, 'follows the first observation when its own depth shrinks');
});

test('out-of-range decimals and CTRs never vote (Gemini round 5 reproductions); one SERP request = one page', () => {
  const big = '9'.repeat(310);
  assert.equal(loadGscCsv(`Query,CTR,Position\na,2.5%,"${big},5"\n`, 'x.csv').decimal, '.');
  assert.equal(loadGscCsv('Query,CTR,Position\na,2.5%,"1.000.000.000.000.000,5"\n', 'y.csv').decimal, '.');
  const amb = loadGscCsv(`Query,Position\na,"${big},5"\nb,1.234\n`, 'z.csv');
  assert.equal(amb.decimal, null);
  assert.equal(amb.rows.find((r) => r.query === 'b').position, null, 'still ambiguous, not 1234');
  assert.equal(detectFileFormat([], ['9.007.199.254.740.993']), null);
  const o = { phrase: 'o que é ifc', provider: 'serp-related', sourceType: 'serp-related', query: 'ifc', originFamily: 'serp',
    origins: [{ seed: 'ifc', strategy: 'serp-page-1', family: 'serp', generatedQuery: 'ifc' }], serpPage: 1, hl: 'pt-br', gl: 'br', runId: 'r', requestId: 'r#1', collectedAt: '2026-11-26T10:00:00.000Z' };
  const p2 = { ...o, phrase: 'ifc viewer', provider: 'serp-paa', sourceType: 'serp-paa', serpPage: 2, origins: [{ ...o.origins[0], strategy: 'serp-page-2' }] };
  assert.throws(() => readEvidence({ schema: EVIDENCE_SCHEMA, keywords: [{ keyword: 'o que é ifc', observations: [o] }, { keyword: 'ifc viewer', observations: [p2] }] }), /diferentes/);
});

// ------------------------------------------------------------------ regressions from the sixth review round
test('strict join key keeps combining marks; rows without a query do not vote', () => {
  const gsc = loadGscCsv('Consulta,Página,Cliques\ncurso i,https://exemplo.test/a,10\n', 'k.csv');
  const p = 'curso i̇';
  const k = { keyword: p, observations: [{ ...ev([p]).keywords[0].observations[0] }] };
  assert.equal(buildOpportunities({ keywords: [k] }, [gsc], null)[0].gsc_status, 'sem dados no recorte');
  assert.equal(loadGscCsv('Query;Position\n;2,5\ncurso;4.2\n', 'v.csv').decimal, '.');
  const amb = loadGscCsv('Query;Position\n;2,5\ncurso;1.234\n', 'w.csv');
  assert.equal(amb.rows[0].position, null, 'still ambiguous');
});

test('echo rule is the same for marking and for recursion (trailing space)', async () => {
  const sent = [];
  const m = new Miner({ fetcher: async (e, q) => { sent.push(q); return q === 'autocad x ' ? ['autocad x'] : []; }, engines: ['google'], seeds: ['autocad'], delayMs: 0, depth: 1,
    expansion: { seed: false, alphaSuffix: false, comparisons: true, lang: 'pt-br' } });
  const res = await m.run();
  assert.equal(res[0].observations[0].echoOfQuery, true);
  assert.equal(sent.filter((q) => q === 'autocad x').length, 0, 'an echo is not sent again as a recursive query');
});

test('afterRequest is relative to the attempt that answered, not to an earlier failed attempt', async () => {
  let googleCalls = 0;
  const fetcher = async (e, q) => {
    if (e === 'google' && q === 'ifc dwg') { googleCalls += 1; if (googleCalls === 1) throw new Error('boom'); return ['ifc dwg viewer']; }
    if (e === 'bing' && q === 'dwg') return ['ifc dwg'];
    return [];
  };
  const m = new Miner({ fetcher, engines: ['google', 'bing'], seeds: ['ifc dwg', 'dwg'], delayMs: 20, retries: 1, depth: 1,
    expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const res = await m.run();
  const v = res.find((r) => r.keyword === 'ifc dwg viewer');
  const late = v.observations.flatMap((o) => o.origins).find((x) => x.seed === 'dwg');
  assert.ok(late, 'the bing route added the origin while google was waiting to retry');
  assert.ok(!late.afterRequest, 'the origin existed before the successful attempt started');
});

test('contradicting collectedAt for one request is refused', () => {
  const base = ev(['abrir ifc online']).keywords[0].observations[0];
  const other = { ...base, phrase: 'abrir ifc', collectedAt: '2026-11-26T11:00:00.000Z' };
  assert.throws(() => readEvidence({ schema: EVIDENCE_SCHEMA, keywords: [{ keyword: 'abrir ifc online', observations: [base] }, { keyword: 'abrir ifc', observations: [other] }] }), /diferentes/);
});

// ------------------------------------------------------------------ regressions from the seventh review round
test('a quoted field after spaces stays one field (no hidden metrics, URLs or authorisation)', () => {
  const g = loadGscCsv('Query,Notes,Page,Clicks,Other\ncurso, "description,https://exemplo.test/a,10,rest",,,\n', 'n.csv');
  assert.equal(g.rows[0].page, null);
  assert.equal(g.rows[0].clicks, null);
  const i = loadInventoryCsv('url,termos,autorizada,notas\nhttps://exemplo.test/a, "cobre,sim,qualquer",,\n', 'i.csv');
  assert.equal(i.pages.length, 0, 'authorisation cell is empty, not "sim"');
});

test('SERP parser keeps distinct phrases distinct; U+FEFF is not whitespace', () => {
  const r = parseGoogleSerp('<div data-q="curso i"></div><div data-q="curso i̇"></div>', { query: 'x' });
  assert.deepEqual(r.paa, ['curso i', 'curso i̇']);
  const rel = parseGoogleSerp('<a href="/search?q=curso+i&amp;sa=X">curso i̇</a>', { query: 'x' });
  assert.deepEqual(rel.related, [], 'visible text must equal the linked query exactly');
  const gsc = loadGscCsv('Consulta,Página,Cliques\ncurso ifc,https://exemplo.test/a,10\n', 'f.csv');
  const p = 'curso﻿ifc';
  assert.equal(buildOpportunities({ keywords: [{ keyword: p, observations: [{ ...ev([p]).keywords[0].observations[0] }] }] }, [gsc], null)[0].gsc_status, 'sem dados no recorte');
  assert.deepEqual([...EM.google.http.parse(['q', ['curso﻿ifc']])], ['curso﻿ifc']);
  assert.deepEqual(parseGoogleSerp('<h3><span>PDF</span><br><span>online</span></h3>').extracted.organic, [['PDF online']]);
});

test('URLs with control characters are refused, never repaired; underflowing decimals do not vote', () => {
  const g = loadGscCsv('Consulta,Página,Cliques\ncurso,"https://exa\nmple.test/a",1\n', 'u.csv');
  assert.equal(g.rows[0].page, null);
  assert.equal(g.rows[0].pageInvalid, 'https://exa\nmple.test/a');
  const tiny = `0,${'0'.repeat(350)}1%`;
  const d = loadGscCsv(`Query;Position;CTR\ncurso;1.234;${tiny}\n`, 'd.csv');
  assert.equal(d.decimal, null);
  assert.equal(d.rows[0].ctr, null);
  assert.equal(d.rows[0].position, null, 'still ambiguous');
});

test('answers of a disabled engine are still replayed for new origins', async () => {
  const fetcher = async (e, q) => {
    if (e === 'google' && q === 'target child') return ['target child guide'];
    if (e === 'google') throw new Error('boom');
    if (e === 'bing' && q === 'different') { await new Promise((r) => setTimeout(r, 30)); return ['target child']; }
    return [];
  };
  const m = new Miner({ fetcher, engines: ['google', 'bing'], seeds: ['target child', 'different'], delayMs: 0, retries: 0, maxConsecutiveErrors: 1, depth: 1,
    expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const res = await m.run();
  assert.equal(m.stats.perEngine.google.disabled, true);
  const g = res.find((r) => r.keyword === 'target child guide').observations.find((o) => o.provider === 'google');
  assert.ok(g.origins.some((x) => x.seed === 'different' && x.strategy === 'recursive'), 'the late origin reached the stored Google answer');
});

test('Turkish question words of the original detector are kept', () => {
  for (const p of ['nereden bilet alınır', 'nereye gidilir', 'kahve nasıl yapılır']) assert.ok(isQuestionIn(p, 'tr'), p);
});

// ------------------------------------------------------------------ regressions from the eighth review round
test('U+FEFF at the ends is kept in the join key, the CSV import and SERP text', () => {
  const p = '﻿curso ifc';
  const gsc = loadGscCsv('Consulta,Página,Cliques\ncurso ifc,https://exemplo.test/a,10\n', 'f.csv');
  const k = { keyword: p, observations: [{ ...ev([p]).keywords[0].observations[0] }] };
  assert.equal(buildOpportunities({ keywords: [k] }, [gsc], null)[0].gsc_status, 'sem dados no recorte');
  const inv = loadGscCsv('Consulta,Cliques\n﻿curso ifc,3\n', 'g.csv');
  assert.equal(inv.rows[0].query, '﻿curso ifc');
  const k2 = { keyword: 'curso ifc', observations: [{ ...ev(['curso ifc']).keywords[0].observations[0] }] };
  assert.equal(buildOpportunities({ keywords: [k2] }, [inv], null)[0].gsc_status, 'sem dados no recorte');
});

test('SERP links are validated with the visible text (inline tags add no spaces)', () => {
  const r = parseGoogleSerp('<a href="/search?q=curso+ifc&amp;sa=X">curso i<b>fc</b></a><a href="/search?q=curso+i+fc&amp;sa=X">curso i<b>fc</b></a>', { query: 'x' });
  assert.deepEqual(r.related, ['curso ifc']);
});

test('invisible characters in URLs are refused; leading zeros are not precision', () => {
  assert.equal(canonicalUrl('https://exe​mplo.test/a'), null);
  const g = loadGscCsv('Query;Position;CTR\ncurso;1.234;0.0454545454545455%\n', 'p.csv');
  assert.equal(g.decimal, '.');
  assert.equal(g.rows[0].ctr, 0.0454545454545455);
  assert.equal(g.rows[0].position, 1.234);
  assert.equal(parseDecimal(`0,${'0'.repeat(350)}1`, ',').value, null, 'underflow refused');
  assert.equal(loadGscCsv('\nQuery;Clicks\ncurso;3\n', 'b.csv').rows[0].clicks, 3, 'separator from the first non-empty line');
});

test('16–17 digit spreadsheet decimals are accepted; URL repairs ("https:host", backslash) refused', () => {
  const g = loadGscCsv('Query;Position;CTR\ncurso;1,3333333333333333;3,333333333333333%\noutra;1.234;1%\n', 's.csv');
  assert.equal(g.decimal, ',');
  assert.equal(g.rows[0].position, 1.3333333333333333);
  assert.equal(g.rows[0].ctr, 3.333333333333333);
  assert.equal(g.rows[1].position, 1234);
  assert.equal(canonicalUrl('https:exemplo.test/a'), null);
  assert.equal(canonicalUrl('https://exemplo.test\\a'), null);
  assert.equal(canonicalUrl('https://exemplo.test/a'), 'https://exemplo.test/a');
});

// ------------------------------------------------------------------ regressions from the ninth review round
test('U+FEFF before a quote is kept; <br> with attributes separates words; encoded invisible URLs refused', () => {
  const g = loadGscCsv('Query,Page,Clicks\n﻿"curso ifc",https://exemplo.test/a,3\n', 'f.csv');
  assert.notEqual(g.rows[0]?.query, 'curso ifc');
  const r = parseGoogleSerp('<a href="/search?q=curso+ifc+online&amp;sa=X">curso i<b>fc</b><br class="sep">online</a><a href="/search?q=curso+ifconline&amp;sa=X">curso i<b>fc</b><br class="sep">online</a>', { query: 'x' });
  assert.deepEqual(r.related, ['curso ifc online']);
  assert.equal(canonicalUrl('https://exemplo.test/a﻿'), null);
  assert.equal(canonicalUrl('https://exe%E2%80%8Bmplo.test/a'), null);
  assert.equal(canonicalUrl('https://exemplo.test/a%E2%80%8B'), null);
  assert.equal(parseCsv('"Query\nfull";Clicks\ncurso;3\n').delimiter, ';', 'separator from the first complete record');
});

test('cache reuse is reported apart from provider answers; conflicting authorisations are refused', () => {
  const base = ev(['abrir ifc online']).keywords[0].observations[0];
  const cached = { ...base, requestId: 'r#2', fromCache: true, collectedAt: '2026-11-26T10:05:00.000Z' };
  const [row] = buildOpportunities({ keywords: [{ keyword: 'abrir ifc online', observations: [{ ...base, fromCache: false }, cached] }] }, null, null);
  assert.equal(row.ocorrencias, 1);
  assert.equal(row.observacoes_cache, 1);
  assert.match(row.cadeia, /reaproveitada\(s\) de cache/);
  for (const order of [['sim', 'não'], ['não', 'sim']]) {
    const inv = loadInventoryCsv(`url,termos,autorizada\nhttps://exemplo.test/a,cobre,${order[0]}\nhttps://EXEMPLO.test/a#topo,cobre,${order[1]}\n`, 'c.csv');
    assert.equal(inv.pages.length, 0, order.join('/'));
    assert.match(inv.warnings.join(' '), /conflitante/);
  }
});

test('URL credentials and silent host repairs are refused; IDN hosts and ports are kept', () => {
  for (const u of ['https://exe️mplo.test/a', 'https://exe͏mplo.test/a', 'https://outro@exemplo.test/a', 'https://ＥＸＥＭＰＬＯ.test/a', '﻿https://exemplo.test/a']) assert.equal(canonicalUrl(u), null, JSON.stringify(u));
  assert.equal(canonicalUrl('https://açaí.test/a'), 'https://xn--aa-4iaz.test/a');
  assert.equal(canonicalUrl('https://Exemplo.TEST:443/a'), 'https://exemplo.test/a');
  assert.equal(canonicalUrl('https://exemplo.test:8080/a'), 'https://exemplo.test:8080/a');
});

// ------------------------------------------------------------------ regression from the tenth review round
test('U+FEFF around a URL cell is refused by BOTH importers (end to end)', () => {
  const g = loadGscCsv('Consulta,Página,Cliques\ncurso ifc,https://exemplo.test/a﻿,7\noutra,﻿https://exemplo.test/a,1\n', 'f.csv');
  assert.deepEqual(g.rows.map((r) => r.page), [null, null]);
  const inv = loadInventoryCsv('url,termos\nhttps://exemplo.test/a,cobre\n', 'i.csv');
  const rows = buildOpportunities(ev(['curso ifc']), [g], inv);
  assert.equal(rows[0].url_observada_gsc, '');
  assert.match(rows[0].url_observada_status, /URL inválida/);
  assert.notEqual(rows[0].status_candidata, STATUS.candidate);
  const bad = loadInventoryCsv('url,termos,autorizada\nhttps://exemplo.test/a﻿,cobre,sim\n', 'b.csv');
  assert.equal(bad.pages.length, 0);
  assert.equal(parseCsv('Query;Clicks\rcurso, com vírgula;3\r').delimiter, ';', 'lone CR ends the first record');
});

test('a literal "%" does not hide an encoded invisible character elsewhere in the URL', () => {
  assert.equal(canonicalUrl('https://exemplo.test/a%E2%80%8B?q=100%'), null);
  assert.equal(canonicalUrl('https://exemplo.test/a?q=100%25'), 'https://exemplo.test/a?q=100%25');
});

// ------------------------------------------------------------------ regressions from the eleventh review round
test('literal "<" ">" in autocomplete text are kept; only real inline markup is removed', () => {
  assert.deepEqual([...EM.bing.http.parse(['q', ['operadores < e > javascript', 'abrir <b>ifc</b>']])], ['operadores < e > javascript', 'abrir ifc']);
});

test('one normalisation for authorisation in both inventory passes', () => {
  const i = loadInventoryCsv('url,termos,autorizada\nhttps://exemplo.test/a,cobre," sim "\n', 'n.csv');
  assert.equal(i.pages.length, 1);
  assert.doesNotMatch(i.warnings.join(' '), /conflitante/);
  const f = loadInventoryCsv('url,termos,autorizada,notas\nhttps://exemplo.test/a,﻿"cobre,sim,nota"\n', 'f.csv');
  assert.equal(f.pages.length, 0, 'invisible char before a quote: row refused');
});

test('SERP tags: quoted ">" in attributes and block elements', () => {
  assert.deepEqual(parseGoogleSerp('<a href="/search?q=curso+online&amp;sa=X">curso<br title="a > b">online</a>', { query: 'x' }).related, ['curso online']);
  assert.deepEqual(parseGoogleSerp('<a href="/search?q=casanova&amp;sa=X">casa<section>nova</section></a>', { query: 'x' }).related, []);
});

test('the proxy sends exactly the recorded query (U+FEFF is not turned into a space)', async () => {
  const seen = [];
  const handle = createProxy({ fetcher: async (e, q) => { seen.push(q); return []; } });
  await handle(new URLSearchParams({ engine: 'google', q: 'curso revit﻿', hl: 'pt-br', gl: 'br' }));
  await handle(new URLSearchParams({ engine: 'google', q: 'curso revit ', hl: 'pt-br', gl: 'br' }));
  assert.deepEqual(seen, ['curso revit﻿', 'curso revit ']);
});

test('each observation is classified with its own text; unknown cache status is not a confirmed occurrence', () => {
  const o = (phrase, i) => ({ ...ev([phrase]).keywords[0].observations[0], phrase, requestId: `r#${i}` });
  const fams = classifyObservations('ifc abre no mac?​', [o('ifc abre no mac?​', 1), o('ifc abre no mac?', 2)], null, {});
  assert.ok(fams.includes('perguntas'));
  const [row] = buildOpportunities({ keywords: [{ keyword: 'x', observations: [{ ...o('x', 1), fromCache: null }, { ...o('x', 2), fromCache: false }] }] }, null, null);
  assert.equal(row.ocorrencias, 1);
  assert.equal(row.observacoes_cache_desconhecido, 1);
});

test('authorisation with NBSP or a line break is accepted without a false conflict; U+FEFF is refused', () => {
  assert.equal(loadInventoryCsv('url,termos,autorizada\nhttps://exemplo.test/a,cobre,sim \n', 'a.csv').pages.length, 1);
  const nl = loadInventoryCsv('url,termos,autorizada\nhttps://exemplo.test/a,cobre,"sim\n"\n', 'b.csv');
  assert.equal(nl.pages.length, 1);
  assert.doesNotMatch(nl.warnings.join(' '), /conflitante/);
  assert.equal(loadInventoryCsv('url,termos,autorizada\nhttps://exemplo.test/a,cobre,sim﻿\n', 'c.csv').pages.length, 0);
});

// ------------------------------------------------------------------ regressions from the twelfth review round
test('an unpaired "<b>" in a plain suggestion is literal text', () => {
  assert.deepEqual([...EM.bing.http.parse(['q', ['operadores <b> javascript', 'seo <b>free</b>']])], ['operadores <b> javascript', 'seo free']);
});

test('SERP anchors: quoted ">" in attributes and the exact href attribute', () => {
  assert.deepEqual(parseGoogleSerp('<a href="/search?q=curso+online&amp;sa=X" title="a > b">curso online</a>', { query: 'x' }).related, ['curso online']);
  assert.deepEqual(parseGoogleSerp('<a data-href="/search?q=curso+online" href="/outside">curso online</a>', { query: 'x' }).related, []);
});

test('trailing slash is significant when linking Search Console rows to the inventory', () => {
  const gsc = loadGscCsv('Consulta,Página,Cliques\nfotografia,https://exemplo.test/cursos/fotografia/,9\n', 's.csv');
  const inv = loadInventoryCsv('url,termos\nhttps://exemplo.test/cursos/fotografia,retrato\n', 'i.csv');
  const [row] = buildOpportunities(ev(['fotografia']), [gsc], inv);
  assert.notEqual(row.status_candidata, STATUS.candidate);
});

test('different ZWJ sequences are different requests; CR inside quotes counts as a line', async () => {
  const sent = [];
  const m = new Miner({ fetcher: async (e, q) => { sent.push(q); return []; }, engines: ['google'], seeds: ['curso 👩‍💻', 'curso 👩💻'], delayMs: 0,
    expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  await m.run();
  assert.equal(sent.length, 2);
  const g = loadGscCsv('Query;Clicks;Note\r"curso online";7;"a\rb"\routra;2;ok\r', 'cr.csv');
  assert.equal(g.rows.find((r) => r.query === 'outra').line, 4);
  assert.equal(canonicalUrl('https://exemplo.test/a%FF%E2%80%8B'), null);
});

// ------------------------------------------------------------------ adjustments from the twelfth round (second reviewer)
test('Google suggest is plain text: entities and tags are kept literally and do not join other Search Console queries', () => {
  const parsed = EM.google.http.parse(['q', ['entidade &lt; html', 'tag <b></b> html', 'seo <b>free</b>']]);
  assert.deepEqual([...parsed], ['entidade &lt; html', 'tag <b></b> html', 'seo <b>free</b>']);
  assert.deepEqual(parsed.extracted, ['entidade &lt; html', 'tag <b></b> html', 'seo <b>free</b>']);
  assert.notEqual(gscKey('entidade &lt; html'), gscKey('entidade < html'));
  assert.notEqual(gscKey('tag <b></b> html'), gscKey('tag html'));
});

test('SERP: href only from the real attribute; quoted ">" in <h3>; comments removed first', () => {
  assert.deepEqual(parseGoogleSerp('<a title=\'ver href="/search?q=curso+online"\' href="/outside">curso online</a>', { query: 'x' }).related, []);
  assert.deepEqual(parseGoogleSerp('<a class="x"href="/search?q=curso+online&amp;sa=X">curso online</a><a href=\'/search?q=abrir+ifc\'>abrir ifc</a>', { query: 'x' }).related, ['curso online', 'abrir ifc']);
  assert.deepEqual(parseGoogleSerp('<h3 title="a > b">Curso Online</h3>', { query: 'x' }).organic, ['Curso Online']);
  assert.doesNotMatch(stripTags('curso<!-- <div title=" --><b>x"</b>online'), /<!--/);
});

test('echo detection uses the strict request key (ZWJ and U+FEFF kept)', async () => {
  const answers = { 'curso 👩‍💻': ['curso 👩💻'], 'curso 👩💻': ['curso 👩💻 online'] };
  const m = new Miner({ fetcher: async (e, q) => answers[q] || [], engines: ['google'], seeds: ['curso 👩‍💻'], delayMs: 0, depth: 1,
    expansion: { seed: true, alphaSuffix: false, lang: 'pt-br' } });
  const res = await m.run();
  const byPhrase = new Map(res.map((r) => [r.observations[0].phrase, r]));
  assert.equal(byPhrase.get('curso 👩💻').observations[0].echoOfQuery, false);
  assert.ok(byPhrase.has('curso 👩💻 online'));
});
