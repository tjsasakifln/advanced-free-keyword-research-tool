#!/usr/bin/env node
/**
 * Demonstração 100% SINTÉTICA e offline do fluxo
 *   consulta observada → evidência → página existente candidata → melhoria concreta.
 *
 * Um provedor falso ("sintetico") responde a partir de uma tabela inventada abaixo; o Search Console e o
 * inventário são os arquivos de test/fixtures/br (domínio exemplo.test). Nenhum dado real, nenhuma rede.
 *
 *   node scripts/demo-sintetico.js [pasta-de-saida]      (padrão: dados-locais/demo-sintetica, ignorada pelo Git)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miner } from '../web/js/miner.js';
import { serialize } from '../web/js/export.js';
import { fold } from '../web/js/classify.js';
import { runOpportunities } from '../lib/opportunities-cli.js';

const root = fileURLToPath(new URL('..', import.meta.url));
// Fixed ids: the run happens from the repository root, so the file ids written into the outputs are always
// "test/fixtures/br/<file>" and never reveal local folders.
const fx = (f) => join('test', 'fixtures', 'br', f);

/** Respostas inventadas do provedor sintético, por semente. */
export const SYNTHETIC_SUGGESTIONS = {
  'editar dwg online': ['editar dwg online', 'editar dwg online grátis', 'editar dwg online sem autocad', 'editar dwg online no celular', 'como editar dwg online', 'editar dwg online vs autocad'],
  'converter pdf em dwg': ['converter pdf em dwg', 'converter pdf em dwg online', 'converter pdf em dwg grátis', 'como converter pdf em dwg', 'converter pdf em dwg com escala', 'converter pdf em dwg ou dxf'],
  'abrir ifc online': ['abrir ifc online', 'abrir ifc online grátis', 'como abrir ifc online', 'abrir ifc online no celular', 'o que é ifc'],
  'projeto de prevenção contra incêndio': ['projeto de prevenção contra incêndio', 'projeto de prevenção contra incêndio preço', 'quanto custa projeto de prevenção contra incêndio',
    'projeto de prevenção contra incêndio perto de mim', 'projeto de prevenção contra incêndio residencial', 'diferença entre ppci e psci'],
};

/** Imita um autocomplete: devolve as frases da semente que contêm as palavras acrescentadas à consulta. */
export function syntheticFetcher(engine, query) {
  const q = fold(query);
  for (const [seed, list] of Object.entries(SYNTHETIC_SUGGESTIONS)) {
    const s = fold(seed);
    if (!q.includes(s)) continue;
    const extra = q.replace(s, ' ').split(' ').filter(Boolean);
    if (!extra.length) return Promise.resolve(list.slice());
    return Promise.resolve(list.filter((p) => {
      const words = fold(p).split(' ');
      return extra.every((w) => (w.length === 1 ? words.some((x, i) => i > 0 && x.startsWith(w) && !s.split(' ').includes(x)) : words.includes(w)));
    }));
  }
  return Promise.resolve([]);
}

export async function runDemo(outDir = join(root, 'dados-locais', 'demo-sintetica'), { quiet = false } = {}) {
  outDir = resolve(outDir);
  await mkdir(outDir, { recursive: true });
  const cwd = process.cwd();
  process.chdir(root);
  try { return await runDemoInRoot(outDir, quiet); } finally { process.chdir(cwd); }
}

async function runDemoInRoot(outDir, quiet) {
  const seeds = Object.keys(SYNTHETIC_SUGGESTIONS);
  const miner = new Miner({
    fetcher: syntheticFetcher, engines: ['sintetico'], seeds, hl: 'pt-br', gl: 'br', delayMs: 0,
    expansion: { seed: true, alphaSuffix: true, questions: true, modifiers: true, comparisons: true, lang: 'pt-br' },
  });
  const results = await miner.run();
  const meta = { seeds, engines: ['sintetico'], lang: 'pt-br', country: 'br', sintetico: true };
  const evidence = join(outDir, 'evidencias-sinteticas.json');
  await writeFile(evidence, serialize('json', results, meta));
  await writeFile(join(outDir, 'coleta-sintetica.csv'), serialize('csv', results, meta));
  await runOpportunities(['--evidencias', evidence,
    '--gsc', fx('gsc-consultas-paginas-pt.csv'), '--gsc', fx('gsc-so-consultas-en.csv'), '--gsc', fx('gsc-so-paginas-pt.csv'),
    '--inventario', fx('inventario-sintetico.csv'),
    '-o', join(outDir, 'oportunidades-sinteticas.csv'), '-o', join(outDir, 'oportunidades-sinteticas.json'), ...(quiet ? ['-q'] : [])]);
  return { outDir, results };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDemo(process.argv[2]).catch((err) => { console.error(`Erro: ${err.message}`); process.exitCode = 1; });
}
