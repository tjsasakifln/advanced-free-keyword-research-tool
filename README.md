<div align="center">

<img src="web/favicon.svg" width="72" alt="">

# Advanced Free Keyword Research Tool

**Bulk long-tail keyword ideas from 25 search engines' autocomplete — free, open source, no API keys.**

Google · Bing · YouTube · Yahoo · DuckDuckGo · Yandex · Baidu · Naver · Amazon · eBay · Walmart · TikTok · Wikipedia · Ecosia · Qwant · Brave · Seznam · 360 · Sogou · Quark · Swisscows · Google Images / News / Shopping / Scholar

**🇧🇷 Versão Brasil (este fork): [guia em português](docs/BRASIL.md)** · original: [cumabozkurt/advanced-free-keyword-research-tool](https://github.com/cumabozkurt/advanced-free-keyword-research-tool)

[**▶ Open the upstream web app**](https://cumabozkurt.github.io/advanced-free-keyword-research-tool/) · [Türkçe](README.tr.md) · [Research](RESEARCH.md) · [Endpoints](docs/ENDPOINTS.md) · [Audit](docs/AUDIT.md)

![Screenshot](docs/screenshots/app-en-desktop.png)

</div>

> **This fork — Brazilian version.** Default search locale `pt-br` / `br`, Google only by default (every other engine
> stays available), Portuguese expansion families (perguntas, preposições/modificadores, comparações, alfabética),
> evidence-preserving CSV/JSON exports and a local, offline `afkrt oportunidades` command that crosses the evidence with
> Search Console CSVs and an inventory of existing pages. In this fork the *Mine keywords*, GitHub Pages deploy and weekly
> endpoint-health workflows were **removed**: in a public repository their inputs, logs, summaries and artifacts would be public.
> CI only runs offline tests with synthetic data. Read **[docs/BRASIL.md](docs/BRASIL.md)**. The sections below describe the
> original project (upstream links are attribution) and still apply unless the guide says otherwise.

## Features

- **25 engines** (14 work directly in the browser, all 25 via CLI / local server; the upstream GitHub Action was removed in this fork)
- **Bulk input** — paste hundreds of seeds, or load a `.txt` / `.csv`
- **Long-tail expansion** — alphabet suffix/prefix (locale-aware: Turkish `ç ğ ı ö ş ü`, German, Spanish, Russian…), digits, question words, modifiers (`for, best, price, near me…`), your own prefixes/suffixes
- **Recursive mining** with depth control; new suggestions are cross-checked on *all* selected engines
- **De-duplicated results** with an *engine agreement* score (how many engines suggested the phrase), hits, word count, question flag, source seed
- **Filter & sort** — search, exclude words, min. words, questions only
- **Exports** — TXT, CSV (UTF-8 BOM for Excel, formula-injection safe), TSV, JSON, Markdown, copy to clipboard
- **Polite by design** — per-engine delay, concurrency limit, max requests, pause / resume / stop, auto-disable failing engines
- **Google result-page (SERP) mining** — optionally walks Google result pages 1…100 per keyword and collects *related searches*, *People also ask* and (optional) organic titles; stops politely on CAPTCHA — see [Google result pages](#google-result-pages-serp)
- **Search language & country** (this fork: default 🇧🇷 `pt-br` / `br`; upstream: `tr` / `tr`) wired into every engine that supports it — see [Language & country](#language--country)
- **Portuguese (default in this fork), English & Turkish UI**, dark theme, keyboard accessible, mobile friendly, settings saved locally
- **Zero runtime dependencies, no build step** — plain ES modules shared by browser and Node (the optional SERP browser backend uses `puppeteer-core`)

## Ways to use it

### 1. In the browser (upstream GitHub Pages; this fork publishes no Pages site — use the local server)

Open **https://cumabozkurt.github.io/advanced-free-keyword-research-tool/**, type keywords, pick engines, press **Start**.
Engines marked **Direct** work immediately. Engines marked **Proxy** (Amazon, Yandex, Brave, Ecosia, Qwant, Walmart, TikTok, …)
need a proxy — use the local server (option 2).

Shareable links: `…/?q=seo+tools&engines=google,bing,youtube&hl=en&gl=us&run=1`

### 2. Local server — all engines in the browser

```bash
git clone https://github.com/tjsasakifln/advanced-free-keyword-research-tool   # this fork (upstream: cumabozkurt/…)
cd advanced-free-keyword-research-tool
npm start            # → http://localhost:8787  (Node 18+, nothing to install)
# optional, for Google result-page mining:  npm install  (then restart)
```

The app detects the built-in proxy automatically and unlocks every engine.

### 3. Command line

```bash
# This fork: defaults pt-br / br, Google, four families — keep real outputs in dados-locais/ (ignored by Git)
node bin/cli.js "converter pdf em word" -o dados-locais/coleta.csv -o dados-locais/coleta.json
node bin/cli.js "seo tools" -l en -c us                       # English / United States
node bin/cli.js -f dados-locais/sementes.txt -e all -x alpha,questions -d 1 -l de -c de -o dados-locais/out.csv
cat dados-locais/sementes.txt | node bin/cli.js -e web -x none --format tsv > dados-locais/out.tsv
node bin/cli.js --list-engines
node bin/cli.js --help
```

(Or `npm i -g .` once, then use `afkrt …`.)

### 4. On GitHub itself — removed in this fork

Upstream offers an **Actions → Mine keywords** workflow. This fork removed it on purpose: in a public repository the
keywords you type, the run summary (first 100 results) and the artifact are visible to anyone. Run the CLI on your own machine instead.

### 5. Public proxy for a Pages site — upstream only

The upstream project documents deploying `proxy/cloudflare-worker.js` for its GitHub Pages app (see the
[upstream README](https://github.com/cumabozkurt/advanced-free-keyword-research-tool#5-public-proxy-for-your-pages-site-optional)).
This fork publishes no Pages site and no public proxy: use the local server (option 2).

## Language & country

Suggestions differ a lot per market, so every search has a **search language** (`hl`) and **country/region** (`gl`),
independent of the interface language. Default in this fork: **Português (Brasil) / Brasil** (`pt-br` / `br`); upstream: `tr` / `tr`.

- **Web app:** *Search language & country* card with ~38 languages, ~60 countries and quick presets (BR, PT, TR, US, UK, DE, FR, AZ, SA). A live line shows which selected engines use the locale and where they point (e.g. `Amazon → amazon.com.tr`). Shareable via `?hl=tr&gl=tr`.
- **CLI:** `-l/--lang <hl>` and `-c/--country <gl>` (validated ISO codes). `--list-engines` shows each engine's locale support.
- **GitHub Action:** upstream only (`lang` / `country` inputs, default `tr` / `tr`); removed in this fork.
- The expansion alphabet and question words follow the search language (Turkish `ç ğ ı ö ş ü`, Azerbaijani `ə`, Polish, Ukrainian, Russian, German, Spanish…).

| Engine | What `hl` / `gl` control |
|---|---|
| Google, YouTube, Images, News, Shopping | `hl` + `gl` |
| Google Scholar | `hl` |
| Bing | market `mkt={hl}-{GL}` |
| DuckDuckGo | region `kl={gl}-{hl}` (gb → `uk`) |
| Yahoo | regional host for 19 countries (uk, de, fr, es, it, ca, au, in, br, mx, nl, ar, tw, hk, sg, ph, id, vn, th); others (incl. TR, which returns nothing) → US |
| Yandex | `uil={hl}` + region `lr` (tr, ru, ua, by, kz, uz, az, us, de, gb, fr) |
| Ecosia | `mkt={hl}-{gl}` · Qwant `locale={hl}_{GL}` · Swisscows `locale={hl}-{GL}` · Brave `country` |
| TikTok | `region={GL}&language={hl}` |
| Amazon | marketplace by country: us, gb, de, fr, it, es, **tr**, jp, ca, in, br, mx, au, nl (others → amazon.com) |
| eBay | site by country: us, ca, gb, au, at, fr, de, it, nl, es, ch, ie, pl (others → ebay.com) |
| Wikipedia | `{hl}.wikipedia.org` |
| Baidu, 360, Sogou, Quark (CN) · Naver (KR) · Seznam (CZ) · Walmart (US) | single market — locale ignored |

## Google result pages (SERP)

Autocomplete only shows what people *type*. Google's result pages add **related searches** ("Searches related to …" / "İlgili aramalar"),
**People also ask** questions and result titles. With this option the tool opens result pages `start=0,10,20…` for each seed
(1–100 pages, default 10), extracts only those keyword fields (no HTML is stored or shown), tags them by source
(`serp-related`, `serp-paa`, `serp-organic`) and merges them into the same de-duplicated results and exports.
Autocomplete engines keep running in parallel.

**Where it works:** CLI and the local server only (`npm install` once, then `npm start` or the CLI) — a static GitHub Pages site
cannot read Google result pages (CORS + Google requires JavaScript). The Pages app can use it if you point it at your local server.
The upstream GitHub Action has a `serp_pages` input (removed in this fork).

```bash
npm install                                     # adds the optional puppeteer-core (uses YOUR installed Chrome/Chromium/Edge)
node bin/cli.js "converter pdf em word" --serp -o dados-locais/serp.json          # autocomplete + 10 Google pages, related + PAA
node bin/cli.js "converter pdf em word" --serp-only --serp-pages 30 --serp-sources related,paa,organic -o dados-locais/serp.csv
npm start                                       # web app: tick "Scan Google result pages" (1–100 pages)
```

| CLI flag | Meaning |
|---|---|
| `--serp` | enable SERP pages in addition to autocomplete |
| `--serp-only` | only SERP pages, no autocomplete engines |
| `--serp-pages <1-100>` | pages per seed (default 10) |
| `--serp-sources related,paa,organic` | what to collect (default `related,paa`) |
| `--serp-delay <ms>` | pause between page loads, min 2000 (default 5000) |
| `--serp-backend browser\|html` | `browser` = your local Chrome via puppeteer-core (default); `html` = plain HTTP (Google currently answers it with a JavaScript wall) |
| `--serp-headful`, `--serp-chrome <path>`, `--serp-profile <dir>` | show the browser window, choose the browser binary (or `CHROME_PATH`), reuse a profile (keeps your cookie-consent choice) |

Server flags: `--no-serp`, `--serp-backend`, `--serp-headful`, `--serp-chrome`, `--serp-profile`, `--serp-gap <ms>` (min. gap between Google page loads, default 4000).
`/api/serp` is only answered for loopback clients of the local server (same origin or `--allow-origin`), returns parsed fields only,
serialises page loads, caches results for 6 h and refuses further Google requests for 15 minutes after a CAPTCHA.
`hl` / `gl` from the language & country controls are sent as `hl`, `gl` and `lr=lang_{hl}` (plus `pws=0`).

**Limits we observed (October 2026) — please read:**

- Google serves **10 results per page** (`num=` is no longer honoured), so 100 pages = up to ~1000 results; in practice Google
  usually stops after a handful to a few dozen pages (no "Next" link) — the tool then stops for that seed.
- Plain HTTP clients (curl, Node `fetch`, text browsers) get a **"please enable JavaScript" wall** instead of results.
- Real headless Chrome from **datacenter / cloud / CI IPs** gets the **"unusual traffic" CAPTCHA** (`/sorry/`) — on our test server
  already on page 1. Results are much better from a normal home/office connection, with few pages and long pauses.
- Related searches and *People also ask* blocks are not shown for every query or page; organic titles are noisy as keywords (off by default).
- Google's official Custom Search JSON API is closed to new customers and shuts down on 1 Jan 2027, so it is not offered.

**On CAPTCHA, consent or JavaScript walls the SERP phase stops immediately** and reports why; autocomplete continues.
By design there is **no CAPTCHA solving, no proxy rotation, no stealth / fingerprint spoofing** — that is bot-detection evasion and out of scope.

> ⚠️ **Terms of Service:** Google's Terms of Service do not allow automated querying of its search result pages.
> This feature drives an ordinary browser at a slow pace for personal research, but using it is still **at your own risk**
> (temporary blocks of your IP are the typical consequence). Use small page counts, keep the delays, and prefer the autocomplete engines for volume.

## Engines

| | Engines |
|---|---|
| **Direct in browser** (JSONP / CORS) | Google, YouTube, Google Images, Google News, Google Shopping, Bing, Yahoo, DuckDuckGo, Baidu, 360 Search, Naver, Seznam, eBay, Wikipedia |
| **Via proxy / CLI** | Yandex, Amazon (14 marketplaces), Walmart, Ecosia, Qwant, Swisscows, Sogou, Quark, Google Scholar, TikTok\*, Brave\* |

\* experimental. Full endpoint documentation: [docs/ENDPOINTS.md](docs/ENDPOINTS.md). Check health: `npm run check`.

## Architecture

```
web/                      static app (upstream deploys it to GitHub Pages; this fork runs it from the local server)
  index.html, css/, favicon.svg, manifest.webmanifest
  js/engines.js           engine registry: URLs + parsers for jsonp / cors / http transports
  js/miner.js             transport-agnostic queue: per-engine rate limits, recursion, dedupe, pause/stop
  js/expand.js            long-tail strategies (alphabets, questions, modifiers per language)
  js/export.js            TXT / CSV / TSV / JSON / MD serialisers
  js/transport-browser.js JSONP → CORS → proxy fetcher
  js/app.js, js/i18n.js   UI + TR/EN strings
  js/serp-client.js       Google SERP pagination phase (shared by app + CLI), stop-on-block
lib/http-fetcher.js       Node / edge fetcher (charset aware, JSONP unwrapping)
lib/serp-parse.js         pure Google SERP parser: related / PAA / titles / next page, CAPTCHA & wall detection
lib/google-serp.js        SERP URL builder (hl/gl/lr/start) + browser (puppeteer-core) and html backends
lib/serp-service.js       /api/serp: serialised loads, min gap, cache, cool-down after CAPTCHA
lib/proxy-core.js         allow-listed proxy: validation, cache, per-IP + per-engine rate limit
server/server.js          local server (static app + /api/suggest + /api/serp)
proxy/cloudflare-worker.js optional public proxy
bin/cli.js                CLI
scripts/check-endpoints.js live health check
.github/workflows/        CI only in this fork (offline tests with synthetic data)
web/js/classify.js        (fork) origin family of a query vs. text families of a returned phrase
lib/gsc.js                (fork) local Search Console CSV import (PT/EN headers, explicit query→URL only)
lib/opportunities*.js     (fork) `afkrt oportunidades`: evidence → candidate inventory page → improvement
```

The same `engines.js` and `miner.js` run in the browser, the CLI, the server and the Worker.

## Development

```bash
npm test        # node:test, offline: parsers, Brazilian expansion/evidence/Search Console/opportunities, locale wiring, miner, exports, proxy, CLI, server, SERP (HTML fixtures incl. a synthetic CAPTCHA page, fake-Google E2E)
npm run check   # live endpoint check
npm start       # local server
```

Adding an engine = one object in `web/js/engines.js` (+ a parser test). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security notes

- The web app uses a strict **Content-Security-Policy**: scripts only from the app itself and the fixed JSONP engine hosts; no inline scripts.
  JSONP still means those hosts' responses run as script on the page, which is why the page stores nothing sensitive (only your settings in `localStorage`).
- All engine output is rendered with `textContent` (no HTML injection). CSV exports are protected against spreadsheet formula injection.
- The proxy (local server / Worker) is **not an open proxy**: engine ids are allow-listed, upstream URLs are built server-side,
  `hl`/`gl` are validated, queries are length-limited, responses are size-limited (2 MB), per-IP rate limited and cached.
- The local server binds to `127.0.0.1` by default and only allows CORS from the configured origins (`--allow-origin`).
- `/api/serp` only answers loopback clients (and rejects foreign `Origin`s with 403), never returns raw HTML, and drives a fresh browser profile unless you pass `--serp-profile`.

## Responsible use

This tool reads **public autocomplete endpoints** at a low rate — the same requests a browser search box makes.
Keep the default delays, don't use it to hammer services, and respect each provider's terms. It does not bypass captchas or bot protection.
The optional Google SERP mode reads result pages, which Google's terms do not permit for automated clients — see the warning [above](#google-result-pages-serp).
Endpoints are unofficial and can change at any time.

## Credits & license

Inspired by [keywordshitter2](https://github.com/wassname/keywordshitter2) (wassname) and the original keywordshitter.
Backend list cross-checked with [SearXNG](https://github.com/searxng/searxng).

MIT © Cuma Bozkurt
