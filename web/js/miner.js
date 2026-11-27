/**
 * Transport-agnostic mining engine shared by the web app, CLI, server and GitHub Action.
 *
 *   const miner = new Miner({ fetcher, engines: ['google','bing'], seeds: ['seo'], ... });
 *   miner.on('result', fn); miner.on('progress', fn); await miner.run();
 *
 * `fetcher(engineId, query, {hl, gl, signal}) -> Promise<string[]>` is injected per platform.
 */
import { expandSeed } from './expand.js';
import { normalizeKeyword, trimWS, WS } from './normalize.js';

/** Strict text key (NFC, case, whitespace; zero-width joiners kept): echo detection uses the same rule as request de-duplication. */
const strictKey = (q) => trimWS(String(q).normalize('NFC').toLowerCase().replace(WS, ' '));
import { DEFAULT_LOCALE } from './engines.js';
import { familyOfStrategy } from './classify.js';

/** Source type of a provider id: autocomplete engines vs. Google result-page fields (kept apart in exports). */
export const sourceTypeOf = (provider) => (/^serp-(related|paa|organic)$/.test(String(provider)) ? String(provider) : 'autocomplete');

export const DEFAULT_OPTIONS = {
  engines: ['google'],
  seeds: [],
  hl: DEFAULT_LOCALE.hl,
  gl: DEFAULT_LOCALE.gl,
  expansion: {},          // see expand.js DEFAULT_EXPANSION
  depth: 0,               // 0 = only seeds/expansions; 1+ = feed suggestions back as new queries
  expandRecursive: false, // apply expansion strategies on recursive levels too (explodes fast!)
  maxQueries: 2000,       // hard cap of requests per engine
  maxResults: 50000,      // stop when this many unique keywords were found
  delayMs: 400,           // delay between two requests to the SAME engine
  concurrency: 4,         // how many engines may request in parallel
  timeoutMs: 10000,
  retries: 1,
  maxConsecutiveErrors: 6, // disable an engine after this many failures in a row
  mustContainSeed: false, // keep only suggestions containing every seed word
  alongside: [],          // extra async phases fn(miner) run in parallel (e.g. Google SERP pages)
};

const sleep = (ms, signal) => new Promise((resolve) => {
  if (ms <= 0) return resolve();
  const onAbort = () => { clearTimeout(t); resolve(); };
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

export class Miner {
  constructor(options = {}) {
    this.o = { ...DEFAULT_OPTIONS, ...options };
    if (typeof this.o.fetcher !== 'function') throw new Error('Miner needs a fetcher(engineId, query, opts)');
    this.listeners = {};
    this.results = new Map(); // norm -> record
    this.abort = new AbortController();
    this.paused = false;
    this.stats = { requests: 0, done: 0, errors: 0, queued: 0, perEngine: {} };
    this.state = 'idle';
    // Identity of this collection run; every observation carries it plus a request id.
    this.runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
    this.requestSeq = 0;
    this.requestIds = new WeakMap(); // task -> request id (tasks without one, e.g. a SERP page)
  }

  /** Origins of a task that accept this phrase (mustContainSeed is judged per origin: a shared query may fit one seed only). */
  eligibleOrigins(task, norm) {
    const all = task.origins && task.origins.length ? task.origins : [{ seed: task.seed, strategy: task.strategy, generatedQuery: task.q, depth: task.depth }];
    if (!this.o.mustContainSeed) return all;
    return all.filter((x) => normalizeKeyword(x.seed).split(' ').every((w) => norm.includes(w)));
  }

  /** Monotonic counter ordering origin creation and request attempts. */
  nextSeq() { this.seq = (this.seq || 0) + 1; return this.seq; }

  /** New request id for one request actually sent to a provider. */
  nextRequestId() { this.requestSeq += 1; return `${this.runId}#${this.requestSeq}`; }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, data) { for (const fn of this.listeners[evt] || []) { try { fn(data); } catch (e) { console.error(e); } } }

  stop() { this.abort.abort(); this.paused = false; }
  pause() { this.paused = true; this.emit('state', 'paused'); }
  resume() { this.paused = false; this.emit('state', 'running'); }

  get stopped() { return this.abort.signal.aborted; }

  /**
   * Accept a suggestion and merge it into the de-duplicated result set.
   * Every call is recorded as an observation (what the provider returned, for which request), so a phrase that
   * came back through several queries, engines, pages or runs keeps all of its origins.
   * @param {string} keyword  phrase exactly as the engine parser returned it
   * @param {object} [meta]   { fromCache: boolean|null, fetchedAt: ISO time the provider answered (cache), serpPage: number }
   */
  addResult(keyword, engineId, task, meta = {}) {
    const norm = normalizeKeyword(keyword);
    if (!norm) return false;
    const taskOrigins = this.eligibleOrigins(task, norm);
    if (!taskOrigins.length) return false;
    const first = taskOrigins[0];
    let rec = this.results.get(norm);
    const isNew = !rec;
    if (!rec) {
      if (this.results.size >= this.o.maxResults) return false;
      // Legacy fields describe the first ELIGIBLE origin (not a seed rejected by mustContainSeed).
      rec = { keyword: trimWS(keyword), norm, engines: new Set(), hits: 0, seed: first.seed, query: task.q, strategy: first.strategy, depth: Number.isInteger(first.depth) ? first.depth : task.depth, firstSeen: Date.now(), observations: [] };
      this.results.set(norm, rec);
    }
    if (!Array.isArray(rec.observations)) rec.observations = [];
    let requestId = task.requestId || this.requestIds.get(task);
    if (!requestId) { requestId = this.nextRequestId(); this.requestIds.set(task, requestId); }
    const phrase = String(keyword);
    // One observation per (request, source, exact phrase): a provider repeating a phrase inside ONE response is not new
    // evidence, but the same phrase as related search AND organic title on one result page are two sources.
    // Extracted texts (whitespace kept, no HTML) that differ from the phrase: evidence of how the provider wrote it.
    const variants = (Array.isArray(meta.extracted) ? meta.extracted : typeof meta.extracted === 'string' ? [meta.extracted] : [])
      .filter((x) => typeof x === 'string' && x !== phrase);
    const same = rec.observations.find((o) => o.requestId === requestId && o.provider === engineId && o.phrase === phrase);
    if (same) {
      // Same phrase twice in ONE response (e.g. two spellings that collapse to the same text), or the same answer replayed
      // for origins generated later: one observation, every variant and origin kept.
      for (const v of variants) if (!(same.extractedVariants ||= []).includes(v)) same.extractedVariants.push(v);
      for (const x of taskOrigins) {
        const known = same.origins.find((y) => y.seed === x.seed && y.strategy === x.strategy && y.generatedQuery === x.generatedQuery);
        if (!known) same.origins.push({ seed: x.seed, strategy: x.strategy, family: familyOfStrategy(x.strategy), generatedQuery: x.generatedQuery, depth: x.depth, ...(x.afterRequest ? { afterRequest: true } : {}) });
        else if (Number.isInteger(x.depth) && x.depth < known.depth) known.depth = x.depth;
      }
      same.depth = Math.min(...same.origins.map((y) => (Number.isInteger(y.depth) ? y.depth : same.depth)));
    }
    const added = !same;
    if (added) {
      const origins = taskOrigins.map((x) => ({ seed: x.seed, strategy: x.strategy, family: familyOfStrategy(x.strategy), generatedQuery: x.generatedQuery, depth: x.depth, ...(x.afterRequest ? { afterRequest: true } : {}) }));
      rec.observations.push({
        phrase,                                   // text returned by the provider (engine parsers already strip HTML tags)
        provider: engineId,
        sourceType: sourceTypeOf(engineId),       // autocomplete | serp-related | serp-paa | serp-organic
        query: task.q,                            // query actually SENT (generated by this program — not a suggestion)
        originFamily: origins[0].family,
        origins,                                  // every expansion that generated this query (same request)
        seed: origins[0].seed,
        depth: Math.min(...origins.map((x) => (Number.isInteger(x.depth) ? x.depth : task.depth))), // shallowest eligible origin
        hl: this.o.hl,
        gl: this.o.gl,
        runId: this.runId,
        requestId,
        collectedAt: meta.receivedAt || new Date().toISOString(), // when this program received the answer
        fromCache: typeof meta.fromCache === 'boolean' ? meta.fromCache : null, // null = unknown (e.g. browser JSONP)
        ...(meta.fetchedAt ? { providerFetchedAt: meta.fetchedAt } : {}), // when the provider actually answered (cache reuse)
        // Text before whitespace was collapsed by the parser, kept only when it differs (never raw HTML).
        ...(variants.length ? { extractedVariants: [...new Set(variants)] } : {}),
        ...(meta.serpPage ? { serpPage: meta.serpPage } : {}),
        echoOfQuery: strictKey(task.q) === strictKey(keyword),
      });
    }
    // Legacy columns (seed/query/strategy/depth) describe the FIRST observation; its depth may shrink on a shorter route.
    if (Number.isInteger(rec.observations[0]?.depth)) rec.depth = rec.observations[0].depth;
    const before = rec.engines.size;
    rec.engines.add(engineId);
    if (added) rec.hits += 1; // counts observations, never duplicates inside one response
    // Always notify: a repeat from the same engine still adds an observation (origins, hits) the UI must show.
    this.emit('result', { record: rec, isNew, engine: engineId, newEngine: rec.engines.size !== before });
    return isNew;
  }

  async run() {
    const o = this.o;
    this.state = 'running';
    this.emit('state', 'running');
    const signal = this.abort.signal;

    // Per-engine queues so each engine is rate-limited independently.
    const queues = {};
    const seenQueries = {};
    for (const id of o.engines) {
      queues[id] = [];
      seenQueries[id] = new Map(); // normalised query -> task
      this.stats.perEngine[id] = { requests: 0, ok: 0, errors: 0, found: 0, suggestions: 0, disabled: false, lastError: '' };
    }
    // A query generated by several seeds/strategies is SENT once; every generator is kept in task.origins.
    // Dedup key keeps a trailing space: "seed x" (alphabet) and "seed x " (comparison, asks for the next word) are different requests.
    // Strict key (NFC, case, whitespace — zero-width joiners kept: "curso 👩\u200d💻" ≠ "curso 👩💻") + trailing-space marker.
    const queryKey = (q) => strictKey(q) + (/[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(String(q)) ? ' ' : '');
    const enqueue = (id, task) => {
      const key = queryKey(task.q);
      const seeds = task.seeds && task.seeds.length ? task.seeds : [task.seed];
      const origins = seeds.flatMap((seed) => (task.strategies || [task.strategy]).map((strategy) => ({ seed, strategy, generatedQuery: task.q, depth: task.depth })));
      const prev = seenQueries[id].get(key);
      if (prev) {
        const same = (x, y) => y.seed === x.seed && y.strategy === x.strategy && y.generatedQuery === x.generatedQuery;
        const fresh = [];
        for (const x of origins) {
          const known = prev.origins.find((y) => same(x, y));
          if (!known) { fresh.push(x); continue; }
          // A shorter route for an origin already known: keep the smallest depth and process it again with it.
          if (Number.isInteger(x.depth) && Number.isInteger(known.depth) && x.depth < known.depth) { known.depth = x.depth; prev.processed?.delete(known); fresh.push(known); }
        }
        if (!fresh.length) return;
        // Generated after the request was sent: the query is not sent again, the origin is marked as such.
        for (const x of fresh) if (!prev.origins.includes(x)) { x.addedSeq = this.nextSeq(); prev.origins.push(x); }
        // Already answered: process the stored answer for every origin not processed yet (never re-sent). If the answer
        // is being processed right now, that loop picks the new origins up before finishing.
        if (prev.response && !prev.processing) processPending(id, prev);
        return;
      }
      // A disabled engine gets no NEW requests, but its stored answers are still replayed for new origins (above).
      if (this.stats.perEngine[id].disabled) return;
      if (seenQueries[id].size >= o.maxQueries) return;
      for (const x of origins) x.addedSeq = this.nextSeq();
      const t = { ...task, seed: seeds[0], origins };
      delete t.strategies;
      delete t.seeds;
      seenQueries[id].set(key, t);
      queues[id].push(t);
      this.stats.queued += 1;
    };

    /**
     * Record one answer for some origins of a task and feed children. Depth is decided PER ORIGIN: a phrase only recurses
     * through its eligible origins, from the shallowest of them (an origin found at depth 1 never re-enters at depth 0).
     */
    /** Process the stored answer of a task for all its origins not processed yet, until none is left (order-independent). */
    const processPending = (id, task) => {
      task.processed ||= new Set();
      task.processing = true;
      try {
        for (;;) {
          const pending = task.origins.filter((x) => !task.processed.has(x));
          if (!pending.length) break;
          for (const x of pending) task.processed.add(x);
          handleResponse(id, task, task.response, pending);
        }
      } finally { task.processing = false; }
    };

    const handleResponse = (id, task, suggestions, origins) => {
      const st = this.stats.perEngine[id];
      // Snapshot: enqueue() may add origins to this very task while its answer is being processed (picked up by processPending).
      // An origin is "afterRequest" when it was generated after the attempt that produced this answer had started.
      const after = (x) => Number.isInteger(task.attemptSeq) && Number.isInteger(x.addedSeq) && x.addedSeq > task.attemptSeq;
      const view = { ...task, origins: origins.map((x) => (after(x) ? { ...x, afterRequest: true } : x)) };
      const fromCache = typeof suggestions.cached === 'boolean' ? suggestions.cached : null;
      const fetchedAt = typeof suggestions.fetchedAt === 'string' ? suggestions.fetchedAt : undefined;
      const extracted = Array.isArray(suggestions.extracted) && suggestions.extracted.length === suggestions.length ? suggestions.extracted : null;
      const receivedAt = task.receivedAt; // a replay keeps the time the answer was RECEIVED, not the time of the replay
      for (const [i, s] of suggestions.entries()) {
        const norm = normalizeKeyword(s);
        const isNew = this.addResult(s, id, view, { fromCache, fetchedAt, receivedAt, extracted: extracted ? extracted[i] : undefined });
        if (isNew) st.found += 1;
        const eligible = this.results.has(norm) ? this.eligibleOrigins(view, norm) : [];
        // Every eligible origin with depth left recurses from ITS depth (grouped by depth; enqueue merges origins).
        const byDepth = new Map();
        for (const x of eligible) {
          const d = Number.isInteger(x.depth) ? x.depth : task.depth;
          if (d < o.depth) byDepth.set(d, [...(byDepth.get(d) || []), x.seed]);
        }
        // A suggestion equal to the query itself (echo, same rule as echoOfQuery) adds nothing to recurse on.
        if (strictKey(s) === strictKey(task.q)) continue;
        for (const [d, list] of byDepth) {
          const seeds = [...new Set(list)];
          const next = o.expandRecursive
            ? expandSeed(s, expansion).map((t) => ({ ...t, seed: seeds[0], seeds, depth: d + 1 }))
            : [{ q: s, strategy: 'recursive', seed: seeds[0], seeds, depth: d + 1 }];
          for (const n of next) for (const eid of o.engines) enqueue(eid, n);
        }
      }
    };

    const expansion = { lang: o.hl, ...o.expansion };
    for (const seed of o.seeds) {
      for (const t of expandSeed(seed, expansion)) {
        for (const id of o.engines) enqueue(id, { ...t, seed, depth: 0 });
      }
    }
    this.emitProgress();

    // Simple semaphore for global concurrency.
    let active = 0;
    let inFlight = 0;
    const waiters = [];
    const acquire = async () => {
      while (active >= o.concurrency) await new Promise((r) => waiters.push(r));
      active += 1;
    };
    const release = () => { active -= 1; waiters.shift()?.(); };

    const worker = async (id) => {
      const st = this.stats.perEngine[id];
      let consecutive = 0;
      while (!signal.aborted) {
        while (this.paused && !signal.aborted) await sleep(200, signal);
        const task = queues[id].shift();
        if (!task) {
          // Done only when nobody is working: in-flight tasks may still enqueue recursive work.
          if (inFlight === 0 && this.allQueuesEmpty(queues)) break;
          await sleep(150, signal);
          continue;
        }
        inFlight += 1;
        if (this.results.size >= o.maxResults) { inFlight -= 1; queues[id].length = 0; break; }
        await acquire();
        let suggestions = null;
        let lastErr = null;
        task.sent = true;
        for (let attempt = 0; attempt <= o.retries && !signal.aborted; attempt++) {
          try {
            this.stats.requests += 1; st.requests += 1;
            task.requestId = this.nextRequestId();
            // Origins added after THIS attempt started are "afterRequest" (an earlier failed attempt does not count).
            task.attemptSeq = this.nextSeq();
            suggestions = await this.o.fetcher(id, task.q, { hl: o.hl, gl: o.gl, signal, timeoutMs: o.timeoutMs });
            break;
          } catch (err) {
            lastErr = err;
            if (signal.aborted) break;
            // Rate limited -> back off much longer before retrying (be polite, avoid auto-disable storms)
            const limited = /\b(429|503)\b|rate limit/i.test(String(err?.message || err));
            await sleep(limited ? Math.max(5000, o.delayMs * 10) * (attempt + 1) : o.delayMs * (attempt + 2), signal);
          }
        }
        release();
        this.stats.done += 1;
        if (suggestions) {
          consecutive = 0; st.ok += 1; st.suggestions += suggestions.length;
          task.response = suggestions;
          task.receivedAt = new Date().toISOString();
          processPending(id, task);
          task.done = true;
        } else if (!signal.aborted) {
          consecutive += 1; st.errors += 1; this.stats.errors += 1;
          st.lastError = String(lastErr?.message || lastErr || 'error');
          this.emit('error', { engine: id, query: task.q, error: st.lastError });
          if (consecutive >= o.maxConsecutiveErrors) {
            st.disabled = true;
            this.stats.queued -= queues[id].length;
            queues[id].length = 0;
            this.emit('engineDisabled', { engine: id, error: st.lastError });
            inFlight -= 1;
            break;
          }
        }
        inFlight -= 1;
        this.emitProgress();
        await sleep(o.delayMs, signal);
      }
    };

    // Extra phases (e.g. Google SERP pagination) run alongside the autocomplete workers and share
    // the result set, stop/pause controls and stats. Their failure never stops autocomplete mining.
    const extra = (o.alongside || []).map((fn) => Promise.resolve().then(() => fn(this)).catch((err) => {
      this.emit('error', { engine: 'alongside', query: '', error: String(err?.message || err) });
    }));
    await Promise.all([...o.engines.map((id) => worker(id)), ...extra]);
    this.state = signal.aborted ? 'stopped' : 'done';
    this.emitProgress();
    this.emit('state', this.state);
    this.emit('done', { results: this.getResults(), stats: this.stats });
    return this.getResults();
  }

  allQueuesEmpty(queues) { return Object.values(queues).every((q) => q.length === 0); }

  emitProgress() {
    this.emit('progress', { ...this.stats, unique: this.results.size, remaining: Math.max(0, this.stats.queued - this.stats.done) });
  }

  getResults() {
    return [...this.results.values()].map((r) => ({ ...r, engines: [...r.engines], observations: [...(r.observations || [])] }));
  }
}
