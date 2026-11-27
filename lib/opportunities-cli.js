/**
 * `afkrt oportunidades` — local, offline crossing of collected evidence with Search Console CSVs and an inventory.
 * Reads only the files given on the command line, writes only the -o files. No network, no publishing.
 */
import { readFile, writeFile, mkdir, realpath, stat, rename, unlink } from 'node:fs/promises';
import { dirname, extname, resolve, basename } from 'node:path';
import { loadGscCsv } from './gsc.js';
import { readEvidence, loadInventoryCsv, buildOpportunities, opportunitiesToCsv, opportunitiesToJson, STATUS } from './opportunities.js';

/** Read a UTF-8 text file strictly: a Windows-1252 file re-saved by Excel would silently break accents and headers. */
export async function readUtf8(path) {
  const buf = await readFile(path);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new Error(`${path}: não está em UTF-8 (provavelmente salvo pelo Excel em Windows-1252). Exporte de novo do Search Console ou converta: iconv -f WINDOWS-1252 -t UTF-8 "${basename(path)}" > convertido.csv`);
  }
}

export const OPPORTUNITIES_HELP = `
afkrt oportunidades — cruza evidências coletadas com o Search Console e um inventário de páginas (tudo local)

Uso:
  afkrt oportunidades --evidencias <coleta.json> [--gsc <arquivo.csv> ...] [--inventario <paginas.csv>] -o <saida.csv> [-o <saida.json>]

  --evidencias, --evidence <json>   JSON exportado pela coleta (afkrt ... -o coleta.json). Obrigatório.
  --gsc <csv>                       CSV exportado do Search Console (repetível). Cabeçalhos em português ou inglês.
                                    Com "Consulta" e "Página" na MESMA linha → URL observada. Só consultas → sem URL.
                                    Só páginas → ignorado (não há vínculo consulta → página).
  --inventario, --inventory <csv>   Páginas existentes autorizadas a receber melhorias: url, titulo, termos (a|b|c),
                                    intencoes (ferramenta|servico|local|conteudo|comparacao|preco), autorizada (sim/não). Opcional.
  -o, --out <arquivo>               .csv (leitura) e/ou .json (detalhe). Não pode ser um dos arquivos de entrada.
      --mostrar <n>                 Quantas cadeias "consulta → evidência → página → melhoria" imprimir (padrão 10)
  -q, --quiet                       Sem resumo no terminal

Sem correspondência no Search Console: "sem dados no recorte" (nunca zero). Ocorrências não são volume de busca.
A melhoria sugerida não foi verificada na página: confira antes de editar. Nada é publicado.
`;

function parse(argv) {
  const a = { gsc: [], outs: [], show: 10 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`Falta valor para ${k}`); return x; };
    switch (k) {
      case '-h': case '--help': a.help = true; break;
      case '--evidencias': case '--evidence': a.evidence = v(); break;
      case '--gsc': case '--search-console': a.gsc.push(v()); break;
      case '--inventario': case '--inventory': a.inventory = v(); break;
      case '-o': case '--out': a.outs.push(v()); break;
      case '--mostrar': case '--show': a.show = Number(v()); break;
      case '-q': case '--quiet': a.quiet = true; break;
      default: throw new Error(`Opção desconhecida em "oportunidades": ${k}`);
    }
  }
  if (a.help) return a;
  if (!a.evidence) throw new Error('Informe --evidencias <coleta.json> (o JSON exportado pela coleta).');
  if (!a.outs.length) throw new Error('Informe ao menos uma saída: -o dados-locais/oportunidades.csv');
  if (!Number.isInteger(a.show) || a.show < 0 || a.show > 1000) throw new Error('--mostrar deve ser um inteiro entre 0 e 1000');
  if (extname(a.evidence).toLowerCase() !== '.json') throw new Error(`--evidencias ${a.evidence}: esperado um arquivo .json`);
  for (const f of [...a.gsc, ...(a.inventory ? [a.inventory] : [])]) if (extname(f).toLowerCase() !== '.csv') throw new Error(`${f}: esperado um arquivo .csv`);
  const inputs = new Set([a.evidence, a.inventory, ...a.gsc].filter(Boolean).map((p) => resolve(p)));
  const outs = new Set();
  for (const o of a.outs) {
    const fmt = extname(o).slice(1).toLowerCase();
    if (!['csv', 'json'].includes(fmt)) throw new Error(`Saída ${o}: use extensão .csv ou .json`);
    if (inputs.has(resolve(o))) throw new Error(`Saída ${o} sobrescreveria um arquivo de entrada — escolha outro nome.`);
    if (outs.has(resolve(o))) throw new Error(`Saída repetida: ${o}`);
    outs.add(resolve(o));
  }
  return a;
}

/** Same check with symlinks resolved and file identity (device + inode) compared, so a hard link is caught too. */
async function assertNoOverwrite(a) {
  const real = async (p) => { try { return await realpath(p); } catch { return resolve(p); } };
  const ident = async (p) => { try { const st = await stat(p); return `${st.dev}:${st.ino}`; } catch { return null; } };
  const ins = [a.evidence, a.inventory, ...a.gsc].filter(Boolean);
  const inputs = new Set(await Promise.all(ins.map(real)));
  const ids = new Set((await Promise.all(ins.map(ident))).filter(Boolean));
  for (const o of a.outs) {
    const id = await ident(o);
    if (inputs.has(await real(o)) || (id && ids.has(id))) throw new Error(`Saída ${o} sobrescreveria um arquivo de entrada — escolha outro nome.`);
  }
}

/** Write to a temporary file, then rename: never truncates an existing file in place (another name for it stays intact). */
async function writeAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmp, data, { flag: 'wx' });
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function runOpportunities(argv) {
  const a = parse(argv);
  if (a.help) { console.log(OPPORTUNITIES_HELP); return; }
  await assertNoOverwrite(a);
  const log = (...m) => { if (!a.quiet) process.stderr.write(`${m.join(' ')}\n`); };

  const evidence = readEvidence(await readUtf8(a.evidence));
  const gscFiles = [];
  // Each Search Console file is identified by the path given (two "Consultas.csv" from different folders stay distinct).
  const ids = new Map();
  const fileId = (p) => { const id = ids.has(p) ? `${p}#${ids.size + 1}` : p; ids.set(id, true); return id; };
  for (const g of a.gsc) gscFiles.push(loadGscCsv(await readUtf8(g), fileId(g)));
  const inventory = a.inventory ? loadInventoryCsv(await readUtf8(a.inventory), a.inventory) : null;
  for (const w of [...gscFiles.flatMap((g) => g.warnings), ...(inventory?.warnings || [])]) log(`  ⚠ ${w}`);
  if (evidence.droppedTitles) log(`  · ${evidence.droppedTitles} frase(s) só com títulos orgânicos do Google ignoradas (títulos não são buscas).`);

  const rows = buildOpportunities(evidence, a.gsc.length ? gscFiles : null, inventory);
  const meta = {
    entradas: {
      evidencias: basename(a.evidence),
      searchConsole: gscFiles.map((g) => ({ arquivo: g.name, tipo: g.kind, separadorDecimal: g.decimal, linhas: g.rows.length, linhasRecusadas: g.rejected || 0 })),
      inventario: inventory ? { arquivo: inventory.name, paginas: inventory.pages.length, excluidasPorAutorizacao: inventory.excluded } : null,
    },
  };
  for (const out of a.outs) {
    const fmt = extname(out).slice(1).toLowerCase();
    await mkdir(dirname(out), { recursive: true }).catch(() => {});
    await writeAtomic(out, fmt === 'csv' ? opportunitiesToCsv(rows) : opportunitiesToJson(rows, meta));
    log(`  → ${out}`);
  }

  const phrases = new Set(rows.map((r) => r.frase));
  const by = {};
  for (const r of rows) by[r.status_candidata] = (by[r.status_candidata] || new Set()).add(r.frase);
  log(`✔ ${phrases.size} frase(s) observada(s), ${rows.length} linha(s).`);
  for (const s of Object.values(STATUS)) if (by[s]) log(`   ${s}: ${by[s].size}`);
  const chains = rows.filter((r) => r.status_candidata === STATUS.candidate).slice(0, a.show);
  if (chains.length) {
    log('\nConsulta observada → evidência → página candidata → melhoria:');
    for (const r of chains) log(`  • ${r.cadeia}`);
  }
}
