/**
 * Pure (dependency-free) parser for Google search result pages.
 * Extracts only keyword-research fields — never returns raw HTML to users.
 *
 *   parseGoogleSerp(html, { query, page, finalUrl }) -> {
 *     status: 'ok' | 'captcha' | 'jswall' | 'consent' | 'empty',
 *     related: string[],   // "İlgili aramalar" / "Searches related to" / "People also search for" chips
 *     paa: string[],       // "Diğer kullanıcılar şunları da sordu" / "People also ask" questions
 *     organic: string[],   // organic result titles (<h3>)
 *     hasNext: boolean,
 *   }
 *
 * Google changes its markup often. The parser relies on stable-ish signals rather than class names:
 *   - related searches: <a href="/search?q=X…"> links whose visible text equals X (tabs/pagination excluded)
 *   - PAA: data-q="question" attributes
 *   - organic titles: <h3> elements
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#34': '"' };

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] ?? m));
}

// Visible text: inline tags removed WITHOUT a space ("curso i<b>fc</b>" = "curso ifc"), line breaks and block tags as
// spaces; whitespace collapsed and trimmed without touching U+FEFF.
export const stripTags = (s) => extractRaw(s).replace(WSX, ' ').replace(/^ | $/g, '');

// Tag attributes may contain ">" inside quotes; block-level elements separate words ("casa<section>nova" = "casa nova").
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const BLOCK = 'p|div|li|ul|ol|dl|dt|dd|tr|td|th|table|thead|tbody|tfoot|h[1-6]|section|article|header|footer|nav|aside|main|figure|figcaption|blockquote|pre|hr|form|fieldset|address|details|summary';
// Strict key (same as the Search Console join): NFC, case and whitespace only — distinct phrases stay distinct.
const WSX = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
const norm = (s) => String(s).normalize('NFC').toLowerCase().replace(WSX, ' ').replace(/^ | $/g, '');
/** Text without tags/entities but with its original whitespace (evidence; never raw HTML). */
// Comments go first, so a tag-looking text inside a comment cannot swallow its "-->".
const extractRaw = (s) => decodeEntities(String(s).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
  .replace(new RegExp(`<(?:br|\\/?(?:${BLOCK}))\\b${ATTRS}>`, 'gi'), ' ').replace(new RegExp(`<\\/?[a-z][\\w:-]*${ATTRS}>`, 'gi'), ''));

/** Real attributes of a tag (quoted values consumed whole, so `title='href="…"'` is a title, not an href). */
function attributes(attrText) {
  const out = new Map();
  const re = /([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of String(attrText).matchAll(re)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? ''); // HTML: the first occurrence of a name wins
  }
  return out;
}

// Params that mark a link as a tab, pagination, tool, or spelling suggestion rather than a related search.
const NON_RELATED_PARAMS = ['tbm', 'udm', 'start', 'tbs', 'spell', 'nfpr', 'stick', 'ibp', 'lr', 'cr', 'as_sitesearch', 'si', 'csui'];

export function detectBlock(html, finalUrl = '') {
  const u = String(finalUrl);
  if (/\/sorry\//.test(u) || /id=["']?captcha-form|g-recaptcha|unusual traffic from your computer network|sıra dışı bir trafik algıladı|\/sorry\/index/i.test(html)) return 'captcha';
  if (/consent\.google\./i.test(u) || /action=["']https:\/\/consent\.google\./i.test(html)) return 'consent';
  if (/\/httpservice\/retry\/enablejs|[?&]enablejs|websearch\/answer\/16515119|update your browser|browser is no longer supported/i.test(html) && !/<h3[\s>]/i.test(html)) return 'jswall';
  return null;
}


/**
 * De-duplicate [clean, extracted] pairs by normalised text, keeping for each kept item every distinct extracted
 * variant (so two spellings of one phrase on a page are not lost as evidence).
 */
function uniqueWithVariants(pairs, exclude = new Set()) {
  const index = new Map();
  const list = [];
  const extracted = [];
  for (const [clean, raw] of pairs) {
    const k = norm(clean);
    if (!k || exclude.has(k)) continue;
    if (index.has(k)) { const v = extracted[index.get(k)]; if (!v.includes(raw)) v.push(raw); continue; }
    index.set(k, list.length);
    list.push(clean);
    extracted.push([raw]);
  }
  return { list, extracted };
}

export function parseGoogleSerp(html, { query = '', page = 0, finalUrl = '' } = {}) {
  const src = String(html || '');
  const blocked = detectBlock(src, finalUrl);
  if (blocked) return { status: blocked, related: [], paa: [], organic: [], hasNext: false };

  const seed = new Set([norm(query)]);

  // ---- organic titles
  const organic = [];
  for (const m of src.matchAll(new RegExp(`<h3\\b${ATTRS}>([\\s\\S]*?)<\\/h3>`, 'gi'))) {
    const t = stripTags(m[1]);
    if (t.length >= 3 && t.length <= 200) organic.push([t, extractRaw(m[1])]);
  }

  // ---- People also ask
  const paa = [];
  for (const m of src.matchAll(/\bdata-q="([^"]{3,300})"/gi)) paa.push([decodeEntities(m[1]).replace(WSX, ' ').replace(/^ | $/g, ''), decodeEntities(m[1])]);

  // ---- Related searches / people also search for
  const related = [];
  // Anchor tags read with quoted attributes (a ">" inside title="…" does not end the tag) and the exact href attribute
  // (never data-href).
  for (const a of src.matchAll(new RegExp(`<a\\b(${ATTRS})>([\\s\\S]*?)<\\/a>`, 'gi'))) {
    const href = attributes(a[1]).get('href');
    if (!href || !href.startsWith('/search?')) continue;
    const m = [a[0], href, a[2]];
    let params;
    try { params = new URLSearchParams(decodeEntities(m[1]).slice('/search?'.length)); } catch { continue; }
    const q = (params.get('q') || '').replace(WSX, ' ').replace(/^ | $/g, '');
    if (!q || NON_RELATED_PARAMS.some((p) => params.has(p))) continue;
    const text = stripTags(m[2]);
    if (!text || norm(text) !== norm(q)) continue; // visible text must equal the linked query
    related.push([q, extractRaw(m[2])]);
  }

  // ---- pagination
  const nextStart = (page + 1) * 10;
  const hasNext = /id=["']?pnnext/i.test(src) || new RegExp(`[?&;]start=${nextStart}(?:&|"|$)`).test(src);

  const rel = uniqueWithVariants(related, seed);
  const pa = uniqueWithVariants(paa);
  const org = uniqueWithVariants(organic);
  const result = {
    status: 'ok',
    related: rel.list,
    paa: pa.list,
    organic: org.list,
    hasNext,
    // Per item: the distinct extracted texts it came from (whitespace kept, no HTML).
    extracted: { related: rel.extracted, paa: pa.extracted, organic: org.extracted },
  };
  if (!result.related.length && !result.paa.length && !result.organic.length) result.status = 'empty';
  return result;
}
