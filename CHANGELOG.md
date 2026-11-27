# Changelog

## 1.2.0-br — 2026-11-26 (fork tjsasakifln, a partir de cumabozkurt@59d8001)

- **Brasil como padrão:** idioma `pt-br`, país `br`, provedor Google (os outros 24 continuam como opção). `-l`/`-c` mantidos.
  Corrigido `Accept-Language: pt-br-BR` → `pt-BR,pt;q=0.9`; fallbacks dos adaptadores seguem o padrão.
- **Expansão em português** em quatro famílias (perguntas, preposições/modificadores, comparações, alfabética), modelos com
  `{s}`, conectores enviados com espaço final, sem modificador repetido, termos personalizados por família (CLI e web).
- **Evidências:** cada sugestão guarda observações (frase retornada, consulta enviada, todas as origens, provedor, fonte,
  idioma, país, coleta, requisição, cache). Consulta gerada por duas famílias é enviada uma vez com as duas origens.
  CSV ganha colunas de evidência (as originais ficam na mesma ordem); JSON com `schema: afkrt-br/evidencias@1`.
- **Classificação do texto** separada da família de origem (`web/js/classify.js`), multi-família, sem diferenciar acentos/pontuação.
- **`afkrt oportunidades`** (local, offline): CSV do Search Console (cabeçalhos PT/EN, vínculo consulta→URL só na mesma linha,
  “sem dados no recorte”), inventário de páginas autorizadas, URL observada × URL candidata, status de ambiguidade/intenção/conflito
  e melhoria concreta. Demonstração sintética em `scripts/demo-sintetico.js`.
- **Interface web** em português (padrão; alterna pt → en → tr), checkbox de comparações, termos por família, rótulos acessíveis traduzidos,
  metadados de exportação calculados a partir das observações de todos os lotes.
- **Fork público:** removidos os workflows *Mine keywords*, deploy do GitHub Pages e checagem semanal de endpoints;
  CI só com testes offline/sintéticos; `.gitignore` para dados locais; teste com Chrome usa CAPTCHA sintético autocontido.
- `normalizeKeyword` usa `toLowerCase()` (independe do locale do sistema).
- Revisões (Codex/Gemini): candidata decidida por linha do Search Console; linhas com colunas deslocadas recusadas (GSC e
  inventário); decimal/milhar por arquivo; URLs comparadas sem reescrever a query string; identificação de arquivos pelo caminho;
  JSON de evidências validado e cruzado pela frase observada; consulta com espaço final é uma requisição distinta (também no
  proxy); origens elegíveis na recursão; fontes distintas da mesma página SERP; `hits` = observações; texto extraído antes do
  colapso de espaços; data original de respostas em cache; seis intenções no inventário; empate sem critério de tamanho;
  saída protegida contra hard link e gravada de forma atômica; `{s}` preservado na interface; termos por lote na web;
  fixture de CAPTCHA capturada substituída por uma sintética.
- Segunda rodada: CSV com texto após aspas de fechamento ou colunas repetidas é recusado; autorização só com valor exato;
  convenção numérica inferida só de valores válidos (inclusive milhares nas colunas inteiras); evidência coerente (fonte ×
  provedor, idioma/país, IDs, data ISO, sem duplicatas); variantes do texto extraído preservadas no proxy, no cache, na SERP
  e em duplicatas de uma resposta; mesma `fetchedAt` para resposta nova e reutilizada; origens tardias propagadas à recursão;
  classificação por par (idioma, termos do lote); idioma sem vocabulário não usa regras do inglês; palavras genéricas não dão
  especificidade a termos do inventário; teste da interface renderizada no Chrome com respostas sintéticas interceptadas.
- Terceira rodada: cabeçalho com aspas ou coluna de autorização mal escrita é recusado; `%` só no CTR; inteiros acima de 2^53
  recusados; evidência coerente também entre fonte e origem (SERP), IDs `run#N`, datas ISO reais e requisições consistentes;
  `fetchedAt` do proxy chega à observação no navegador; profundidade da recursão por origem e respostas reaproveitadas para
  origens tardias; flexões genéricas (plural/feminino) não contam como assunto; READMEs apontam o fork e deixam deploy como
  referência ao upstream.
- Quarta rodada: inventário só aceita colunas conhecidas (e notas); números inválidos não votam no separador e magnitudes
  absurdas são recusadas; estratégia × família e consulta gerada × consulta enviada validadas; página SERP na identidade da
  requisição; toda origem elegível com profundidade disponível recursa a partir da sua profundidade (rotas mais curtas
  reaproveitam a resposta); hora de recebimento preservada nos reaproveitamentos; flexões genéricas adicionais;
  origens de uma resposta congeladas durante o processamento (eco da consulta); página SERP coerente com a estratégia.
- Quinta rodada: cruzamento com o Search Console por chave estrita (NFC, caixa, espaços; preserva ZWJ e acentos), dividindo
  registros que o minerador agrupou; só decimais importáveis votam no separador; origens pendentes processadas até esgotar
  (resultado independe da ordem); um horário de recebimento por página
  SERP; status próprio quando todas as linhas do CSV foram recusadas; demo com identificadores fixos.
- Sexta rodada: chave estrita do Search Console preserva marcas combinantes; linhas sem consulta não votam no separador;
  profundidade legada acompanha a primeira observação; mesma regra de eco para marcar e para recursão; `afterRequest` medido
  contra a tentativa que respondeu; `collectedAt` coerente por requisição; testes de servidor com portas efêmeras.
- Sétima rodada: aspas após espaços abrem campo; U+FEFF não é espaço; parser da SERP mantém frases distintas (chave
  estrita); URLs com caracteres de controle recusadas; decimais com precisão excessiva recusados; respostas de motor
  desativado ainda reaproveitadas; exportação filtrada da web com metadados e nome só dos registros exportados; palavras
  interrogativas turcas restauradas; `.gitignore` sem distinção de maiúsculas nas extensões.
- Oitava rodada: U+FEFF preservado também nas extremidades (aparamento próprio, cruzamento sempre pela chave do texto
  observado); tags inline não inserem espaços na validação de links da SERP; URLs com caracteres invisíveis, `\` ou sem
  `http(s)://` recusadas; decimais de 16–17 dígitos aceitos e só o arredondamento indevido para zero recusado; sementes por
  lote na exportação filtrada; separador detectado pela primeira linha não vazia.
- Nona rodada: U+FEFF antes de aspas preservado; `<br>` com atributos separa palavras; URLs com invisíveis codificados ou
  U+FEFF final recusadas; respostas de cache reportadas à parte (`observacoes_cache`, fora de `ocorrencias`); autorização
  conflitante para a mesma URL recusada; separador pelo primeiro registro completo; URLs com credenciais ou com host
  "reparado" pelo parser (UTS #46) recusadas, preservando domínios IDN e portas.
- Décima rodada: células de URL e de autorização aparadas sem remover U+FEFF nos dois importadores; respostas com cache não
  observável em coluna própria; `\r` isolado encerra o primeiro registro na detecção do separador; `%XX` decodificado por trecho;
  ordenação das oportunidades prioriza ocorrências (sem cache).
- Décima primeira rodada: só marcação real (`<b>`, `<span>`…) é removida do texto do autocomplete (`a < e > b` preservado);
  mesma normalização de autorização nas duas passagens; atributos com `>` entre aspas e elementos de bloco na SERP; o proxy
  envia exatamente a consulta registrada; cada observação classificada pelo próprio texto; `ocorrencias` só com respostas
  novas confirmadas.
- Décima segunda rodada: só marcação pareada (`<b>…</b>`) é removida do autocomplete (tag solta é texto); âncoras da SERP
  lidas com atributos entre aspas e `href` exato; barra final da URL preservada no cruzamento; chave de requisição estrita
  (preserva ZWJ); CR dentro de aspas conta como linha; `%XX` com UTF-8 inválido recusado.
- Ajustes finais: o autocomplete do Google (texto simples) é registrado literalmente, sem interpretar HTML nem entidades;
  na SERP, `href` lido só do atributo real, `<h3>` com atributos entre aspas e comentários removidos antes das tags; eco
  da consulta e bloqueio de recursão usam a mesma chave estrita das requisições. 135 testes.

## 1.1.0 — 2026-10-09

- **Google result-page (SERP) mining** (CLI + local server + web app via local server): walks `start=0,10,20…` up to 1–100 pages per seed,
  collects related searches, People-also-ask and optional organic titles, tagged `serp-related` / `serp-paa` / `serp-organic`, merged and de-duplicated
  with autocomplete results. `hl`/`gl`/`lr` wired in. Stops on CAPTCHA / consent / JavaScript wall; autocomplete keeps running. No CAPTCHA solving or evasion.
- CLI: `--serp`, `--serp-only`, `--serp-pages`, `--serp-sources`, `--serp-delay`, `--serp-backend`, `--serp-headful`, `--serp-chrome`, `--serp-profile`.
- Server: `/api/serp` (loopback-only, serialised, cached, cool-down), `--no-serp`, `--serp-gap`; `/api/health` reports SERP availability.
- Web app: "Google arama sayfalarını tara" card (1–100 pages, sources, delay) with live status and block notices.
- GitHub Action "Mine keywords": `serp_pages` input (default 0).
- Optional dependency `puppeteer-core` (uses your installed Chrome/Chromium/Edge). 45 tests incl. SERP HTML fixtures and fake-Google E2E.

## 1.0.0 — 2026-10-09

First public release.

- 25 engines (14 browser-direct), bulk seeds, locale-aware long-tail expansion, recursive mining,
  cross-engine de-duplication with agreement score, TXT/CSV/TSV/JSON/MD exports, TR/EN UI,
  local server + allow-listed proxy, Cloudflare Worker, CLI, GitHub Actions
  (Pages deploy, CI, "Mine keywords", weekly endpoint health).
- Search language & country (default `tr`/`tr`) wired into Google family, Bing, Yahoo (regional hosts),
  DuckDuckGo, Yandex (`lr`), Ecosia, Qwant, Swisscows, Brave, TikTok, Amazon (14 marketplaces), eBay, Wikipedia, Scholar.
- Pre-release audit fixes (see docs/AUDIT.md): CSP, proxy CORS allow-list and validation, Turkish question detection,
  `İ` normalisation, Baidu invalid-JSONP handling, hidden-field CSS bug, CLI validation, proxy self-throttling fix + 429 back-off, 33 tests.
