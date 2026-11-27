/**
 * HTTP fetcher for Node 18+ (CLI, local server, GitHub Action) and edge runtimes (Cloudflare Workers).
 * Uses the `http` transport of each engine. No dependencies.
 */
import { ENGINE_MAP, isEngineId, parseJsonish, DEFAULT_LOCALE } from '../web/js/engines.js';

/** Accept-Language for a search locale: pt-br + br -> "pt-BR,pt;q=0.9"; tr + tr -> "tr-TR,tr;q=0.9". */
export function acceptLanguage(hl = DEFAULT_LOCALE.hl, gl = DEFAULT_LOCALE.gl) {
  const [base, region] = String(hl || DEFAULT_LOCALE.hl).toLowerCase().split('-');
  const tag = `${base}-${String(region || gl || DEFAULT_LOCALE.gl).toUpperCase()}`;
  return `${tag},${base};q=0.9`;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const DEFAULT_USER_AGENT =
  'AdvancedFreeKeywordResearchTool/1.0 (+https://github.com/cumabozkurt/advanced-free-keyword-research-tool)';

export const parseBody = parseJsonish;

export function createHttpFetcher({ userAgent = DEFAULT_USER_AGENT, fetchImpl = globalThis.fetch } = {}) {
  return async function fetcher(engineId, query, opts = {}) {
    if (!isEngineId(engineId)) throw new Error(`unknown engine: ${engineId}`);
    const e = ENGINE_MAP[engineId];
    const url = e.http.url(query, opts);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), opts.timeoutMs || 10000);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      const res = await fetchImpl(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json, text/javascript, */*;q=0.1',
          'Accept-Language': acceptLanguage(opts.hl, opts.gl),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (Number(res.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new Error('response too large');
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BODY_BYTES) throw new Error('response too large');
      const headerCharset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1];
      let text;
      try {
        text = new TextDecoder(e.http.charset || headerCharset || 'utf-8').decode(buf);
      } catch {
        text = new TextDecoder('utf-8').decode(buf);
      }
      // Plain HTTP from this process: always a fresh answer (no cache here).
      const parsed = e.http.parse(parseBody(text));
      Object.defineProperty(parsed, 'cached', { value: false, enumerable: false });
      Object.defineProperty(parsed, 'fetchedAt', { value: new Date().toISOString(), enumerable: false });
      return parsed;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener?.('abort', onAbort);
    }
  };
}
