/**
 * Query expansion strategies (long-tail generation).
 * Inspired by keywordshitter2's prefix/suffix lists, but locale-aware and configurable.
 *
 * Entries may be templates with a `{s}` placeholder for the seed ("o que é {s}", "{s} vale a pena").
 * Without `{s}`, question words go BEFORE the seed and modifiers / comparisons AFTER it (original behaviour).
 */
import { DEFAULT_LOCALE } from './engines.js';

export const ALPHABETS = {
  en: 'abcdefghijklmnopqrstuvwxyz'.split(''),
  tr: 'abcçdefgğhıijklmnoöprsştuüvyz'.split(''),
  de: 'abcdefghijklmnopqrstuvwxyzäöüß'.split(''),
  fr: 'abcdefghijklmnopqrstuvwxyz'.split(''),
  es: 'abcdefghijklmnñopqrstuvwxyz'.split(''),
  pt: 'abcdefghijklmnopqrstuvwxyz'.split(''),
  it: 'abcdefghijklmnopqrstuvwxyz'.split(''),
  ru: 'абвгдеёжзийклмнопрстуфхцчшщэюя'.split(''),
  uk: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'.split(''),
  az: 'abcçdeəfgğhxıijkqlmnoöprsştuüvyz'.split(''),
  pl: 'aąbcćdeęfghijklłmnńoóprsśtuwyzźż'.split(''),
  nl: 'abcdefghijklmnopqrstuvwxyz'.split(''),
  id: 'abcdefghijklmnopqrstuvwxyz'.split(''),
};

export const DIGITS = '0123456789'.split('');

export const QUESTIONS = {
  en: ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'is', 'are', 'does', 'will', 'should'],
  tr: ['nasıl', 'nedir', 'neden', 'ne zaman', 'nerede', 'kim', 'hangi', 'kaç', 'mı', 'ne kadar', 'nasıl yapılır'],
  de: ['wie', 'was', 'warum', 'wann', 'wo', 'wer', 'welche', 'kann'],
  fr: ['comment', 'quoi', 'pourquoi', 'quand', 'où', 'qui', 'quel'],
  es: ['cómo', 'qué', 'por qué', 'cuándo', 'dónde', 'quién', 'cuál'],
  ru: ['как', 'что', 'почему', 'когда', 'где', 'кто', 'какой'],
  // Português (Brasil). pt-br resolves to pt.
  // Probes for autocomplete, not finished sentences: some read better with nouns ("qual o melhor …"), others with verbs
  // ("como …"). Add your own with familyTerms / --termos-perguntas.
  pt: ['o que é {s}', 'como {s}', 'como usar {s}', 'qual {s}', 'qual o melhor {s}', 'qual a melhor {s}', 'quanto custa {s}', 'onde {s}',
    'por que {s}', 'quando {s}', 'para que serve {s}', 'é possível {s}', '{s} como funciona', '{s} vale a pena', '{s} é seguro'],
};

/** Words that go AFTER the seed (modifiers / prepositions / comparisons). */
export const MODIFIERS = {
  en: ['for', 'with', 'without', 'to', 'near', 'near me', 'vs', 'versus', 'like', 'free', 'best', 'cheap', 'online', 'review', 'alternative', 'price', '2026'],
  tr: ['için', 'ile', 'olmadan', 'gibi', 'vs', 'yakınımda', 'ücretsiz', 'en iyi', 'ucuz', 'online', 'fiyat', 'fiyatları', 'yorum', 'alternatif', 'nedir', 'nasıl', '2026'],
  de: ['für', 'mit', 'ohne', 'in der nähe', 'vs', 'kostenlos', 'beste', 'günstig', 'online', 'test', 'preis'],
  fr: ['pour', 'avec', 'sans', 'près de moi', 'vs', 'gratuit', 'meilleur', 'pas cher', 'en ligne', 'avis', 'prix'],
  es: ['para', 'con', 'sin', 'cerca de mí', 'vs', 'gratis', 'mejor', 'barato', 'online', 'opiniones', 'precio'],
  ru: ['для', 'с', 'без', 'рядом', 'vs', 'бесплатно', 'лучший', 'дешево', 'онлайн', 'отзывы', 'цена'],
  // Preposições e modificadores (pt-BR). Comparisons ("vs", "ou") live in COMPARISONS.
  pt: ['para', 'com', 'sem', 'em', 'no', 'na', 'perto de', 'perto de mim', 'online', 'grátis', 'gratuito', 'preço', 'valor', 'barato', 'melhor', 'profissional', 'empresa'],
};

/** Comparisons ("diferença entre", "vs", "ou"). */
export const COMPARISONS = {
  en: ['difference between {s} and', '{s} vs', '{s} or', '{s} versus', '{s} alternative'],
  tr: ['{s} vs', '{s} veya', '{s} farkı', '{s} alternatif'],
  pt: ['diferença entre {s} e', '{s} vs', '{s} x', '{s} ou', '{s} versus', 'melhor que {s}', 'alternativa para {s}', 'alternativas ao {s}'],
};

export const STRATEGIES = ['seed', 'alphaSuffix', 'alphaPrefix', 'digitSuffix', 'questions', 'modifiers', 'comparisons', 'custom'];

export const DEFAULT_EXPANSION = {
  seed: true,
  alphaSuffix: true,
  alphaPrefix: false,
  digitSuffix: false,
  questions: false,
  modifiers: false,
  comparisons: false,
  custom: false,
  customPrefixes: [],
  customSuffixes: [],
  // Extra terms per family, added to the built-in lists (templates with {s} allowed):
  // { perguntas: ['{s} funciona no mac'], modificadores: ['no celular'], comparacoes: ['{s} ou outra opção'] }
  familyTerms: {},
  lang: DEFAULT_LOCALE.hl,
};

/**
 * Words that ask the autocomplete for the NEXT word. A query ending in one of them is sent with a trailing space
 * ("converter pdf em word com ") — otherwise providers tend to complete the connector itself ("com" -> "completo").
 */
export const CONNECTORS = new Set(['para', 'pra', 'com', 'sem', 'em', 'no', 'na', 'de', 'do', 'da', 'perto de', 'vs', 'x', 'ou', 'versus', 'e', 'entre', 'que', 'ao', 'a',
  'for', 'with', 'without', 'to', 'or', 'near', 'and', 'ile', 'için', 'veya']);

const lastWords = (q) => { const w = q.trim().split(/\s+/); return [w.slice(-1).join(' '), w.slice(-2).join(' ')]; };

/** Apply a template: "{s}" is replaced by the seed; otherwise prefix or suffix. */
export function applyTemplate(template, seed, position = 'suffix') {
  const t = String(template).trim();
  if (!t) return '';
  const q = t.includes('{s}') ? t.split('{s}').join(seed) : position === 'prefix' ? `${t} ${seed}` : `${seed} ${t}`;
  const [w1, w2] = lastWords(q).map((x) => x.toLowerCase());
  return CONNECTORS.has(w1) || CONNECTORS.has(w2) ? `${q.trim()} ` : q;
}

const foldWords = (x) => ` ${String(x).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
/** True when every literal part of the template is already in the seed ("editor de vídeo online" + "online"). */
export function redundantTemplate(template, seed) {
  const parts = String(template).split('{s}').map((p) => foldWords(p).trim()).filter(Boolean);
  const s = foldWords(seed);
  return parts.length > 0 && parts.every((p) => s.includes(` ${p} `));
}

const own = (t, k) => Object.prototype.hasOwnProperty.call(t, k);
export const pick = (table, l) => {
  const full = String(l || '').toLowerCase();
  const base = full.split('-')[0];
  return own(table, full) ? table[full] : own(table, base) ? table[base] : (table.en || []);
};
/** Which alphabet key is used for a language (for UI display). */
export const alphabetKey = (l) => { const b = String(l || '').toLowerCase().split('-')[0]; return own(ALPHABETS, b) ? b : 'en'; };

/**
 * Build the list of queries for one seed.
 * @returns {{q:string, strategy:string}[]}
 */
export function expandSeed(seed, opts = {}) {
  const o = { ...DEFAULT_EXPANSION, ...opts };
  const s = String(seed).trim().replace(/\s+/g, ' ');
  if (!s) return [];
  const out = [];
  const seen2 = new Map();
  // Same query generated twice (e.g. a modifier and a custom suffix): keep ONE query, remember every strategy.
  const add = (q, strategy) => {
    // Collapse whitespace but keep ONE trailing space when the template asked for it (see CONNECTORS).
    const k = q.trim().replace(/\s+/g, ' ') + (q.trim() && /\s$/.test(q) ? ' ' : '');
    if (!k) return;
    const prev = seen2.get(k);
    if (prev) { if (!prev.strategies.includes(strategy)) prev.strategies.push(strategy); return; }
    const item = { q: k, strategy, strategies: [strategy] };
    seen2.set(k, item);
    out.push(item);
  };
  if (o.seed) add(s, 'seed');
  if (o.alphaSuffix) for (const c of pick(ALPHABETS, o.lang)) add(`${s} ${c}`, 'alphaSuffix');
  if (o.alphaPrefix) for (const c of pick(ALPHABETS, o.lang)) add(`${c} ${s}`, 'alphaPrefix');
  if (o.digitSuffix) for (const d of DIGITS) add(`${s} ${d}`, 'digitSuffix');
  const extra = (fam) => (Array.isArray(o.familyTerms?.[fam]) ? o.familyTerms[fam] : []);
  const family = (list, position, strategy) => {
    for (const w of list) if (!redundantTemplate(w, s)) add(applyTemplate(w, s, position), strategy);
  };
  if (o.questions) family([...pick(QUESTIONS, o.lang), ...extra('perguntas')], 'prefix', 'questions');
  if (o.modifiers) family([...pick(MODIFIERS, o.lang), ...extra('modificadores')], 'suffix', 'modifiers');
  if (o.comparisons) family([...pick(COMPARISONS, o.lang), ...extra('comparacoes')], 'suffix', 'comparisons');
  if (o.custom) {
    for (const p of o.customPrefixes || []) if (p.trim()) add(`${p.trim()} ${s}`, 'custom');
    for (const x of o.customSuffixes || []) if (x.trim()) add(`${s} ${x.trim()}`, 'custom');
  }
  return out;
}

/** Parse a bulk textarea / file into unique seeds (newline, comma or semicolon separated). */
export function parseSeeds(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/[\n\r,;\t]+/)) {
    const s = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

/** Split comma/newline separated custom lists. */
export const parseList = (text) => String(text || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
