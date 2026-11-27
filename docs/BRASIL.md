# Versão Brasil — guia de uso

Este fork adapta o [Advanced Free Keyword Research Tool](https://github.com/cumabozkurt/advanced-free-keyword-research-tool)
(MIT © Cuma Bozkurt, inspirado no keywordshitter2) para descobrir **como brasileiros pesquisam** ferramentas e serviços.
O objetivo não é criar uma página por palavra-chave: é decidir **qual página existente melhorar, qual dúvida responder e por quê**,
com a evidência à vista:

> consulta observada → evidência → página existente candidata → melhoria concreta

Tudo roda na sua máquina. Nada é publicado.

---

## 1. Instalar e rodar no Linux

Requisitos: Node.js 18 ou mais novo e `git`. Não há dependências obrigatórias.

```bash
git clone https://github.com/tjsasakifln/advanced-free-keyword-research-tool
cd advanced-free-keyword-research-tool
npm test                                   # testes offline com dados sintéticos
node bin/cli.js --help                     # ajuda da coleta
node bin/cli.js oportunidades --help       # ajuda do cruzamento
```

Opcional: `npm install -g .` para usar `afkrt` em vez de `node bin/cli.js`.
Interface web: `npm start` e abra `http://localhost:8787` (português por padrão; o botão do topo alterna pt → en → tr).

## 2. Onde guardar os arquivos locais (importante: o fork é público)

**Nunca** versione consultas estratégicas, exportações do Search Console, inventários internos de URLs, relatórios de
coleta ou credenciais. Use a pasta `dados-locais/`, que o `.gitignore` ignora:

```
dados-locais/
  sementes.txt              suas palavras iniciais
  coletas/                  saídas da coleta (.csv para ler, .json com as evidências)
  search-console/           CSVs exportados do Search Console
  inventario.csv            páginas autorizadas a receber melhorias
  oportunidades/            saídas do cruzamento
```

O `.gitignore` também ignora `*.csv`, `*.tsv`, `*.xlsx`, `*.zip`, arquivos `*coleta*.json` / `*evidencias*.json` /
`*oportunidades*.json`, `.env*`, chaves e perfis de navegador (`chrome-profile*/`) em qualquer pasta — a única exceção são
as quatro planilhas **sintéticas** de `test/fixtures/br/`, listadas uma a uma no `.gitignore`. Ainda assim, confira antes de qualquer commit:

```bash
git status --short          # nada de dados-locais/, .csv ou .json de coleta deve aparecer
```

O `.gitignore` não protege o que já foi versionado. Se usar `--serp-profile`, aponte para uma pasta **fora** do repositório.

Antes de cada push ou PR, revise **tudo o que vai ficar público**:

```bash
git diff --cached                      # o que entra no próximo commit
git ls-files                           # tudo o que já está versionado
git log -p origin/main..HEAD           # cada commit novo, com mensagem e conteúdo
```

E releia o título e o texto da PR. Nada de consultas estratégicas, dados do Search Console, URLs internas, saídas de coleta
ou credenciais — nem em mensagens de commit, comentários ou logs de CI.

## 3. Coletar sugestões

Padrão: idioma **pt-br**, país **br**, provedor **Google** (autocomplete), as quatro famílias de expansão.

```bash
node bin/cli.js "converter pdf em word" "planilha de orçamento" \
  -o dados-locais/coletas/coleta.csv -o dados-locais/coletas/coleta.json

node bin/cli.js -f dados-locais/sementes.txt -x perguntas,comparacoes -o dados-locais/coletas/coleta.json
node bin/cli.js "curso de fotografia" -l pt -c pt       # outro idioma/país continua possível
node bin/cli.js "curso de fotografia" -e google,bing    # outros provedores continuam como opção
node bin/cli.js -- oportunidades                        # pesquisa a palavra "oportunidades" (o -- encerra as opções)
```

### Famílias (`-x`)

| Família | Nome no `-x` | Exemplos de consulta enviada |
|---|---|---|
| Perguntas | `perguntas` (`questions`) | `o que é {s}`, `como {s}`, `qual {s}`, `quanto custa {s}`, `{s} vale a pena` |
| Preposições e modificadores | `modificadores` (`modifiers`) | `{s} para `, `{s} com `, `{s} sem `, `{s} perto de `, `{s} perto de mim`, `{s} grátis` |
| Comparações | `comparacoes` (`comparisons`) | `diferença entre {s} e `, `{s} vs `, `{s} x `, `{s} ou `, `alternativa para {s}` |
| Alfabética | `alfabetica` (`alpha`) | `{s} a` … `{s} z` (`alfabetica-prefixo` para `a {s}`) |

Também existem `digitos` e os prefixos/sufixos livres (`--prefixes`, `--suffixes`). Padrão: `perguntas,modificadores,comparacoes,alfabetica`.

- Consultas que terminam em conector (`para`, `com`, `sem`, `vs`, `ou`…) vão **com um espaço no final**, para o
  autocomplete sugerir a próxima palavra em vez de completar o próprio conector (`com` → `completo`). Com o espaço final o
  provedor também pode devolver sugestões gerais da semente; as duas formas são registradas como observações distintas.
- Um modificador que a semente já contém não é repetido (`editor de vídeo online` não gera `… online online`).
- Os modelos são sondas para o autocomplete, não frases prontas; alguns combinam melhor com substantivos, outros com verbos.

### Termos personalizados por família

```bash
node bin/cli.js "converter pdf em word" \
  --termos-perguntas "{s} funciona no mac, tem como {s}" \
  --termos-modificadores "no celular, sem cadastro" \
  --termos-comparacoes "{s} ou outra opção"
```

`{s}` marca onde entra a semente. Sem `{s}`, perguntas vão antes da semente; modificadores e comparações, depois.
Os termos extras também entram na **classificação** das frases retornadas. Na interface web: “Termos extras por família”.

## 4. O que a exportação contém

**CSV (`.csv`) — para leitura:** uma linha por frase sugerida (deduplicada por caixa e espaços; acentos são preservados,
então `preço` e `preco` são frases diferentes). As colunas originais vêm primeiro (`seed`, `source_query`, `strategy` e `depth`
descrevem a **primeira** observação; `depth` acompanha essa observação, que pode ficar mais rasa quando uma rota mais curta
para a mesma consulta é encontrada). Depois vêm as colunas de evidência:

| Coluna | Significado |
|---|---|
| `origin_families` | famílias das consultas **enviadas** que trouxeram a frase (como foi descoberta) |
| `text_families` | famílias reconhecidas no **texto** da frase (pode ser mais de uma, ou nenhuma) |
| `observations` / `distinct_requests` | quantas vezes a frase voltou / em quantas requisições diferentes |
| `submitted_queries`, `seeds`, `providers`, `source_types`, `hl`, `gl`, `runs` | de onde veio |
| `first_collected_at`, `last_collected_at` | data e hora da coleta (UTC) |
| `echo_of_query` | `yes` se o provedor devolveu exatamente a consulta enviada |
| `cached_observations` | respostas vindas do cache do proxy (não são observações novas) |

**JSON (`.json`) — evidências completas** (`"schema": "afkrt-br/evidencias@1"`). Para cada frase, `observations[]` traz uma
entrada por (requisição, frase): `phrase` (texto retornado), `provider`, `sourceType`, `query` (consulta enviada), `origins[]`
(toda expansão que gerou aquela consulta: semente, estratégia, família, consulta gerada), `hl`, `gl`, `runId`, `requestId`,
`collectedAt` (quando o programa recebeu a resposta), `providerFetchedAt` (quando o provedor respondeu — difere em respostas
reutilizadas do cache), `fromCache` (`true`/`false`; `null` = não observável, como no JSONP/CORS direto do navegador),
`extractedVariants` (texto extraído sem HTML quando difere da frase) e, para páginas de resultado, `serpPage`.

Regras de leitura:

- **Ocorrências não são volume de busca.** `hits`/`observations` contam quantas vezes o autocomplete devolveu a frase.
- **Consultas enviadas não são sugestões.** O programa gera `o que é converter pdf em word`; só o que o provedor devolve vira resultado.
- Uma consulta gerada por duas famílias é enviada **uma vez** e a observação guarda as duas origens.
- A mesma frase vinda por dois caminhos aparece em **uma** linha com as duas origens.
- O autocomplete do Google devolve texto simples: a frase é guardada literalmente (`a &lt; b` e `<b>` continuam como
  vieram), só com espaços colapsados. Nos campos que trazem HTML (alguns outros provedores e a SERP), os parsers removem a
  marcação e as entidades. Quando o texto extraído (com os espaços originais) difere da frase, ele fica em `extractedVariants` — no autocomplete (também via proxy local) e nas buscas relacionadas,
  “As pessoas também perguntam” e títulos da SERP. Variantes da mesma frase na mesma resposta ficam na mesma observação.
- Títulos orgânicos de páginas de resultado (SERP, opcional e desligado por padrão) não são buscas: ficam marcados como
  `serp-organic` e são descartados no cruzamento.

## 5. Exportar o CSV do Search Console

No Search Console: **Desempenho → Resultados da pesquisa → Exportar → Fazer download do CSV**. O arquivo `.zip` traz
`Consultas.csv`, `Páginas.csv` e outros, **separados**:

- `Consultas.csv` (só consultas) traz cliques, impressões, CTR e posição, **sem URL**. O cruzamento usa as métricas, mas
  **não associa URL**: não deduzimos a página a partir do `Páginas.csv`.
- Para registrar a **URL observada**, o arquivo precisa ter consulta **e** página na **mesma linha**. Isso vem, por exemplo,
  de uma exportação filtrada por página (adicione a coluna da página), de uma planilha ou do Looker Studio com as dimensões
  *consulta* e *página de destino*.
- `Páginas.csv` (só páginas) é **ignorado** no cruzamento, com aviso.

Cabeçalhos aceitos (português ou inglês, sem diferenciar acentos e maiúsculas):

| Campo | Cabeçalhos |
|---|---|
| consulta | Consultas principais, Consulta, Consultas, Top queries, Query, Queries |
| página | Páginas principais, Página, Página de destino, URL, Top pages, Page, Landing page |
| métricas | Cliques/Clicks, Impressões/Impressions, CTR, Posição/Posição média/Position |

- Separador `,`, `;` ou tabulação, detectado automaticamente. Decimal com vírgula ou ponto, detectado **por arquivo**
  (um arquivo que mistura os dois é recusado). Em cliques e impressões, o milhar só pode usar o símbolo que **não** é o
  decimal do arquivo (`1.234` num arquivo com vírgula decimal = 1234); valores ambíguos ficam “não informados”, com aviso.
- Linha com número de colunas diferente do cabeçalho (aspas ou separador errados) é **recusada**, com aviso — não é importada.
- O arquivo deve estar em **UTF-8**. Se o Excel salvou em Windows-1252, o comando recusa com instruções:
  `iconv -f WINDOWS-1252 -t UTF-8 Consultas.csv > Consultas-utf8.csv`.
- Cabeçalho desconhecido gera **erro** (não “sem dados”). Exportações em modo de comparação de períodos geram aviso
  (métricas não reconhecidas).
- A correspondência é **exata** com a frase **observada** (nunca com a consulta enviada), sem remover acentos e sem aproximação.
- URLs são comparadas exatamente no caminho (a barra final conta: `/cursos/x` ≠ `/cursos/x/`), ignorando só maiúsculas do
  domínio, `#fragmento` e parâmetros de rastreamento (`utm_*`, `gclid`…).
- Cada linha do Search Console vira uma linha própria nas oportunidades, com `gsc_arquivo` e `gsc_linha`. Métricas
  **não são somadas** entre páginas, arquivos ou períodos.
- Sem correspondência: `sem dados no recorte` (métricas vazias, nunca zero). Arquivos informados mas nenhum utilizável:
  `nenhum arquivo do Search Console utilizável`. Todas as linhas recusadas: `nenhuma linha válida no Search Console (todas
  recusadas)`. Sem `--gsc`: `search console não informado`.
- O cruzamento usa uma chave estrita (NFC, maiúsculas/minúsculas e espaços): acentos, marcas combinantes e caracteres de
  junção de emojis são preservados. Uma frase que o coletor agrupou com outra variante é separada antes do cruzamento.

## 6. Inventário de páginas autorizadas

Um CSV local com as páginas **existentes** que podem receber melhorias editoriais. Só elas podem ser **URL candidata**.

```csv
url,titulo,termos,intencoes,autorizada
https://exemplo.test/ferramentas/pdf-para-word,PDF para Word,pdf para word|pdf em word,ferramenta|conteudo,sim
https://exemplo.test/servicos/consultoria,Consultoria,consultoria tributária,servico|local,sim
```

- `url` (obrigatória, http/https). `termos`: assuntos que a página cobre, separados por `|`. `titulo`: livre.
- `autorizada` (opcional): com a coluna, só valores afirmativos (`sim`, `s`, `yes`, `true`, `1`, `x`) são usados;
  `não` ou vazio exclui; valor desconhecido exclui com aviso. **Sem a coluna, o arquivo inteiro vale como lista de páginas autorizadas.**
- `intencoes` (opcional): `ferramenta`, `servico`, `local` (tipo de página) e `conteudo`, `comparacao`, `preco` (dúvidas
  que a página responde; `conteudo` também aceita comparação e preço). Página sem intenções declaradas aceita qualquer busca;
  valor desconhecido exclui a página, com aviso.
- Termos genéricos (`online`, `para`, `projeto`, `ferramenta`…) e termos com menos de 3 letras são ignorados, com aviso.

Como a candidata é escolhida (nesta ordem):

A decisão é tomada **por linha** do Search Console: cada linha usa só a sua própria URL. Uma linha sem URL (arquivo só de
consultas) ou de outro arquivo/período nunca herda a página de outra linha.

1. **Intenção** da frase (heurística): `local` (perto de, perto de mim…), `servico` (empresa, contratar, consultoria, orçamento…),
   `ferramenta` (online, converter, abrir, editar, app…), `conteudo` (perguntas), `comparacao`, `preco`.
   `local` exige página `local`; entre as demais, basta uma aceita pela página.
2. **URL observada no Search Console** na mesma linha, se estiver no inventário e passar na intenção.
   Se estiver no inventário mas a intenção divergir: `revisar: URL observada no Search Console com intenção divergente` —
   nenhuma outra página é escolhida no lugar.
3. **Termo do inventário** presente na frase: vence o mais específico — mais palavras **não genéricas** (`projeto`, `de`,
   `melhores`, `gratuitas`, `online`… não contam, nem no plural/feminino); depois o termo que menos páginas compartilham.
   O tamanho do termo não desempata. Empate: `ambígua`, com as opções listadas.

Outros status: `intenção não cabe em nenhuma página do inventário`, `nenhuma página do inventário atende` e
`inventário não informado`. A **melhoria sugerida** só aparece quando há candidata definida, e é escrita como
“Conferir se a página…; se não, …”: a ferramenta não leu a página, então confira antes de editar.

## 7. Cruzar: `afkrt oportunidades`

```bash
node bin/cli.js oportunidades \
  --evidencias dados-locais/coletas/coleta.json \
  --gsc dados-locais/search-console/Consultas.csv \
  --gsc dados-locais/search-console/consulta-e-pagina.csv \
  --inventario dados-locais/inventario.csv \
  -o dados-locais/oportunidades/oportunidades.csv -o dados-locais/oportunidades/oportunidades.json
```

- Lê só os arquivos indicados, não acessa a rede e não publica nada. Recusa `-o` que sobrescreveria uma entrada (mesmo
  caminho, link simbólico ou hard link) e grava as saídas de forma atômica. `gsc_arquivo` mostra o caminho informado.
- Aceita só o JSON de evidências desta versão e o valida: cada observação precisa provar a frase (mesmo texto
  normalizado), a consulta, a fonte, as origens, idioma/país, os identificadores e a data. O cruzamento usa a frase observada.
- `ocorrencias` conta só respostas novas **confirmadas** do provedor; respostas reaproveitadas de cache (proxy local) ficam em
  `observacoes_cache` e respostas sem status de cache observável (JSONP direto no navegador) em `observacoes_cache_desconhecido`.
- Uma URL listada como autorizada numa linha e não autorizada em outra (mesma URL canônica) é recusada, com aviso.
- O CSV separa `url_observada_gsc` (o que o Search Console mostrou, com `url_observada_status`) de `url_candidata`
  (sempre do inventário), e traz `status_candidata`, `motivo_candidata`, `opcoes`, `melhoria_sugerida` e `cadeia`.
- O terminal mostra as primeiras cadeias “consulta observada → evidência → página candidata → melhoria” (`--mostrar N`).

Demonstração **sintética** completa (provedor falso, Search Console e inventário inventados em `exemplo.test`):

```bash
node scripts/demo-sintetico.js            # grava em dados-locais/demo-sintetica/
```

Veja um trecho em [exemplo-sintetico.md](exemplo-sintetico.md).

## 8. Classificação do texto (heurística)

- **Família de origem** = família da consulta enviada (`semente`, `perguntas`, `modificadores`, `comparacoes`, `alfabetica`,
  `numerica`, `personalizada`, `recursiva`, `serp`).
- **Famílias do texto** = `perguntas`, `modificadores` e/ou `comparacoes`, reconhecidas pelo texto da frase, sem diferenciar
  acentos, maiúsculas e pontuação. `alfabetica` só existe como origem.
- Perguntas: palavra interrogativa no início (`como`, `qual`, `quanto`, `onde`, `o que`…), locuções em qualquer posição
  (`o que é`, `para que serve`, `quanto custa`, `vale a pena`…), `é seguro/grátis` no fim (não depois de “que”/“não”) ou `?`.
- Modificadores: `para`, `com`, `sem`, `perto de`, `online`, `grátis`, `preço`, `melhor`, `empresa`… `de`, `em`, `no`, `na` não
  contam (estão em quase toda frase), e `para que serve` não conta como `para`.
- Comparações: `vs`, `versus`, `ou`, `diferença entre`, `comparação`, `melhor que`, `alternativa(s)` e `x` entre duas palavras
  (`word x pdf`; não `10 x 25`, `raio x`, `eixo x`). `ou` pode marcar coordenações comuns (`abrir ou salvar`): é heurística.
- O filtro “Só perguntas” e a coluna `question` seguem o **idioma da busca** de cada frase, não o idioma da interface.

## 9. Exemplos e casos de teste

Os testes e a demonstração sintética usam casos de exemplo com respostas, métricas e páginas **inventadas** em `exemplo.test`
(veja `test/fixtures/br` e `scripts/demo-sintetico.js`).
Seu vocabulário próprio (sementes, termos por família, inventário) fica em `dados-locais/`, fora do Git.

## 10. Fora desta versão

Novos provedores, estimativa de volume, agendamento, publicação automática, integração por API ou login no Search Console.
Os workflows herdados *Mine keywords*, deploy do GitHub Pages e checagem semanal de endpoints foram removidos: num repositório
público, entradas, resumos, logs e artefatos ficariam visíveis. A CI só roda lint e testes offline com dados sintéticos.
