/**
 * Expansion families and text classification.
 *
 * Two different things are recorded for every suggestion:
 *   - origin family: HOW it was discovered = the family of the query the program SENT (perguntas, alfabetica…).
 *   - text families: WHAT the returned phrase looks like, judged from its own text only (can be several, or none).
 * Matching is case-, accent- and punctuation-insensitive; the phrase itself is never changed.
 * The rules are heuristics: they are documented in docs/BRASIL.md and covered by tests.
 */
import { normalizeKeyword, isQuestion as legacyIsQuestion } from './normalize.js';

/** The four families of the Brazilian expansion (ids are stable, ASCII, used in exports). */
export const FAMILIES = ['perguntas', 'modificadores', 'comparacoes', 'alfabetica'];
/** Families that can be recognised from a phrase's text ("alfabetica" only exists as an origin). */
export const TEXT_FAMILIES = ['perguntas', 'modificadores', 'comparacoes'];

const STRATEGY_FAMILY = Object.assign(Object.create(null), {
  seed: 'semente',
  alphaSuffix: 'alfabetica',
  alphaPrefix: 'alfabetica',
  questions: 'perguntas',
  modifiers: 'modificadores',
  comparisons: 'comparacoes',
  digitSuffix: 'numerica',
  custom: 'personalizada',
  recursive: 'recursiva',
});

/** Origin family of a submitted query, from the strategy that generated it. */
export function familyOfStrategy(strategy) {
  const s = String(strategy || '');
  if (Object.prototype.hasOwnProperty.call(STRATEGY_FAMILY, s)) return STRATEGY_FAMILY[s];
  if (s.startsWith('serp')) return 'serp';
  return s || 'desconhecida';
}

/**
 * Form used for MATCHING only: NFC, lower-case, no diacritics (also Turkish dotless ı -> i),
 * punctuation as spaces ("grátis?" -> "gratis", "pdf/docx" -> "pdf docx"), whitespace collapsed.
 */
export const fold = (s) => normalizeKeyword(s).normalize('NFD').replace(/\p{M}+/gu, '').replace(/ı/g, 'i')
  .replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim().normalize('NFC');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Classification vocabularies (already folded). `start` = opens the phrase; `any` = anywhere as whole words;
// `end` = closes the phrase and is not preceded by "que"/"não" ("programa que é grátis" is not a question);
// `between` = a token with a (non-numeric) word on each side ("word x pdf", not "10 x 25" or "raio x").
// Very generic prepositions ("de", "em", "no", "na") are expansion modifiers but are NOT used to classify text:
// almost every Portuguese phrase contains them.
const VOCAB = {
  pt: {
    perguntas: {
      start: ['o que', 'oque', 'como', 'qual', 'quais', 'quanto', 'quantos', 'quantas', 'quando', 'quem', 'onde', 'por que', 'porque',
        'pra que', 'para que', 'e possivel', 'da pra', 'da para', 'tem como', 'pode', 'posso', 'existe'],
      any: ['o que e', 'o que significa', 'como fazer', 'como funciona', 'como usar', 'como abrir', 'como converter', 'como editar',
        'para que serve', 'pra que serve', 'quanto custa', 'qual o melhor', 'qual a melhor', 'qual a diferenca', 'vale a pena', 'funciona mesmo'],
      end: ['e seguro', 'e confiavel', 'e gratis', 'e gratuito'],
    },
    modificadores: {
      start: [],
      any: ['para', 'pra', 'com', 'sem', 'perto de', 'perto de mim', 'online', 'gratis', 'gratuito', 'gratuita', 'de graca',
        'preco', 'precos', 'valor', 'barato', 'barata', 'melhor', 'melhores', 'profissional', 'empresa', 'empresas'],
      // Question locutions removed before matching, so "para que serve" does not count as the preposition "para".
      ignore: ['para que serve', 'pra que serve', 'para que', 'pra que', 'da para', 'da pra', 'qual o melhor', 'qual a melhor'],
    },
    comparacoes: {
      start: ['diferenca entre'],
      any: ['vs', 'versus', 'diferenca entre', 'qual a diferenca', 'comparacao', 'comparativo', 'melhor que', 'pior que',
        'alternativa', 'alternativas', 'ou'],
      between: ['x'],
    },
  },
  en: {
    perguntas: { start: ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'is', 'are', 'does', 'do', 'will', 'should'], any: [] },
    modificadores: { start: [], any: ['for', 'with', 'without', 'near', 'near me', 'free', 'best', 'cheap', 'online', 'price'] },
    comparacoes: { start: ['difference between'], any: ['vs', 'versus', 'or', 'difference between', 'compared to', 'alternative', 'alternatives'], between: ['x'] },
  },
  tr: {
    // Every Turkish question word/particle of the original detector (normalize.js), folded.
    perguntas: { start: [], any: ['nasil', 'nedir', 'neden', 'nicin', 'niye', 'hangi', 'hangisi', 'kim', 'kimdir', 'kac', 'nerede', 'nereye', 'nereden', 'ne zaman', 'ne kadar', 'ne demek', 'mi', 'mu', 'midir', 'mudur'] },
    modificadores: { start: [], any: ['icin', 'ile', 'olmadan', 'yakinimda', 'ucretsiz', 'en iyi', 'ucuz', 'online', 'fiyat', 'fiyatlari'] },
    comparacoes: { start: [], any: ['vs', 'veya', 'farki', 'karsilastirma', 'alternatif'] },
  },
  // Question words of the languages the original project detected (no modifier/comparison lists for them yet).
  de: { perguntas: { start: ['wie', 'was', 'warum', 'wann', 'wo', 'wer', 'welche', 'welcher', 'kann'], any: [] }, modificadores: { start: [], any: [] }, comparacoes: { start: [], any: ['vs', 'oder'] } },
  fr: { perguntas: { start: ['comment', 'quoi', 'pourquoi', 'quand', 'ou', 'qui', 'quel', 'quelle'], any: [] }, modificadores: { start: [], any: [] }, comparacoes: { start: [], any: ['vs', 'ou'] } },
  es: { perguntas: { start: ['como', 'que', 'por que', 'cuando', 'donde', 'quien', 'cual'], any: [] }, modificadores: { start: [], any: [] }, comparacoes: { start: [], any: ['vs', 'o'] } },
  ru: { perguntas: { start: ['как', 'что', 'почему', 'когда', 'где', 'кто', 'какой'], any: [] }, modificadores: { start: [], any: [] }, comparacoes: { start: [], any: ['vs', 'или'] } },
};
// Words before " x " that make it a name, not a comparison ("raio x", "eixo x", "geração x").
// "programa que é grátis", "não é seguro": statements, not questions.
const END_BLOCKERS = new Set(['que', 'nao']);
const X_NOT_COMPARISON = new Set(['raio', 'raios', 'eixo', 'eixos', 'plano', 'modelo', 'tipo', 'geracao', 'serie', 'versao', 'coordenada', 'ray', 'axis', 'model', 'type']);

// Unknown language (e.g. a legacy record without observations): union of every vocabulary.
const MULTI = Object.fromEntries(TEXT_FAMILIES.map((fam) => [fam, Object.fromEntries(['start', 'any', 'end', 'between', 'ignore']
  .map((k) => [k, Object.values(VOCAB).flatMap((v) => v[fam][k] || [])]))]));
// A known language without a vocabulary here (it, nl, ja…) gets no word rules — never English by default.
const NONE = Object.fromEntries(TEXT_FAMILIES.map((fam) => [fam, { start: [], any: [] }]));
const vocabFor = (lang) => {
  if (!lang) return MULTI;
  const b = String(lang).toLowerCase().split('-')[0];
  return Object.prototype.hasOwnProperty.call(VOCAB, b) ? VOCAB[b] : NONE;
};

/**
 * Classification terms from a user template: "{s} vale a pena" -> any ["vale a pena"];
 * "diferença entre {s} e" -> any ["diferenca entre"] (1-letter parts like "e" are never used);
 * "{s} x" in comparisons -> between ["x"].
 */
export function templateTerms(template, fam) {
  const parts = String(template || '').split('{s}').map((p) => fold(p)).filter(Boolean);
  const any = [];
  const between = [];
  for (const p of parts) {
    if (p.length === 1) { if (fam === 'comparacoes' && p === 'x') between.push(p); continue; }
    any.push(p);
  }
  return { any, between };
}

function betweenWords(words, tokens) {
  for (let i = 1; i < words.length - 1; i++) {
    if (!tokens.includes(words[i])) continue;
    const prev = words[i - 1];
    const next = words[i + 1];
    if (/^\d/.test(prev) || /^\d/.test(next) || X_NOT_COMPARISON.has(prev)) continue;
    return true;
  }
  return false;
}

const cache = new Map();
function compile(lang, extra) {
  const key = `${lang}\u0000${JSON.stringify(extra || {})}`;
  if (cache.has(key)) return cache.get(key);
  const v = vocabFor(lang);
  const out = {};
  for (const fam of TEXT_FAMILIES) {
    const custom = ((extra && Array.isArray(extra[fam]) && extra[fam]) || []).map((t) => templateTerms(t, fam));
    const start = (v[fam].start || []).map(fold);
    const any = [...(v[fam].any || []), ...custom.flatMap((c) => c.any)].map(fold).filter(Boolean);
    const end = (v[fam].end || []).map(fold);
    const between = [...(v[fam].between || []), ...custom.flatMap((c) => c.between)];
    const ignore = (v[fam].ignore || []).map(fold).sort((a, b) => b.length - a.length);
    const alt = (list) => list.map(escapeRe).join('|');
    const reStart = start.length && new RegExp(`^(?:${alt(start)})(?=\\s|$)`, 'u');
    const reAny = any.length && new RegExp(`(?:^|\\s)(?:${alt(any)})(?=\\s|$)`, 'u');
    const reEnd = end.length && new RegExp(`(?:^|\\s)(\\S+\\s)?(?:${alt(end)})$`, 'u');
    const reIgnore = ignore.length && new RegExp(`(?:^|\\s)(?:${alt(ignore)})(?=\\s|$)`, 'gu');
    out[fam] = (f) => {
      const g = reIgnore ? f.replace(reIgnore, ' ').replace(/\s+/g, ' ').trim() : f;
      if (reStart && reStart.test(g)) return true;
      if (reAny && reAny.test(g)) return true;
      if (reEnd) { const m = reEnd.exec(g); if (m && !END_BLOCKERS.has((m[1] || '').trim())) return true; }
      return between.length > 0 && betweenWords(g.split(' '), between);
    };
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * Families a returned phrase belongs to, judged by its text alone.
 * @param {string} phrase  text as returned by the provider (not modified)
 * @param {string} lang    search language (pt-br, en, tr…); empty = unknown (all vocabularies + the legacy rule)
 * @param {object} [extra] user terms per family: { perguntas: [...], modificadores: [...], comparacoes: [...] } (templates allowed)
 * @returns {string[]} subset of TEXT_FAMILIES, in fixed order
 */
export function classifyPhrase(phrase, lang = 'pt-br', extra) {
  const f = fold(phrase);
  if (!f) return [];
  const rules = compile(lang || '', extra);
  const fams = TEXT_FAMILIES.filter((fam) => rules[fam](f));
  // A known search language uses ONLY its own vocabulary (the legacy multi-language rule would read Portuguese
  // "do zero…" as English "do"). The legacy detector is used only when the language is unknown.
  const question = /\?\s*$/.test(String(phrase)) || (!lang && legacyIsQuestion(phrase));
  if (question && !fams.includes('perguntas')) fams.push('perguntas');
  return TEXT_FAMILIES.filter((x) => fams.includes(x));
}

/**
 * Classification of a phrase from its observations: each (search language, collection run) pair is classified with
 * that run's own family terms, then the labels are combined. Never mixes one batch's terms with another's language.
 * @param {object[]} observations  { hl, runId }
 * @param {object|null} termsByRun  runId -> family terms (null = use `fallbackTerms` for every run)
 */
export function classifyObservations(phrase, observations, termsByRun, fallbackTerms, fallbackLang = null) {
  const pairs = new Map();
  for (const o of observations || []) {
    const terms = termsByRun ? (termsByRun[o.runId] || {}) : fallbackTerms;
    // Each observation is classified with ITS OWN text (variants of one record may differ: "…?" vs "…?\u200B").
    const text = typeof o.phrase === 'string' ? o.phrase : phrase;
    pairs.set(`${text}\u0000${o.hl}\u0000${termsByRun ? o.runId : ''}`, [text, o.hl || null, terms]);
  }
  if (!pairs.size) return classifyPhrase(phrase, fallbackLang, fallbackTerms);
  const fams = new Set([...pairs.values()].flatMap(([text, hl, terms]) => classifyPhrase(text, hl, terms)));
  return TEXT_FAMILIES.filter((x) => fams.has(x));
}

/** Union of the classifications of a phrase for every search language it was observed in. */
export function classifyInLangs(phrase, langs, extra) {
  const list = [...new Set((langs || []).filter(Boolean))];
  const fams = new Set((list.length ? list : [null]).flatMap((l) => classifyPhrase(phrase, l, extra)));
  return TEXT_FAMILIES.filter((x) => fams.has(x));
}

/** Question detection used by the results filter and exports (follows the SEARCH language, not the UI language). */
export const isQuestionIn = (phrase, lang, extra) => classifyPhrase(phrase, lang, extra).includes('perguntas');
