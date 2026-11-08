// Translating captions into the language the viewer picks.
//
// Chrome and Edge ship an on-device Translator (and LanguageDetector) that
// handles most language pairs. Elsewhere we fall back to small Opus-MT models
// in the caption worker, which only translate from English.
import { translateInWorker, onWorkerTranslationProgress } from './autoCaptions';

export const TARGET_LANGUAGES = [
  ['en', 'English'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['he', 'Hebrew'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['tr', 'Turkish'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
];

export function targetName(code) {
  return TARGET_LANGUAGES.find(([c]) => c === code)?.[1] || code;
}

// ISO 639-2 codes some streams use for their tracks
const THREE_LETTER = {
  eng: 'en', rus: 'ru', ukr: 'uk', heb: 'he', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr',
  spa: 'es', ita: 'it', por: 'pt', nld: 'nl', dut: 'nl', pol: 'pl', tur: 'tr', ara: 'ar',
  hin: 'hi', zho: 'zh', chi: 'zh', jpn: 'ja', kor: 'ko',
};

export function baseLanguage(code) {
  if (!code) return '';
  const base = String(code).toLowerCase().split(/[-_]/)[0];
  return THREE_LETTER[base] || (base.length === 2 ? base : '');
}

function languageLabel(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(baseLanguage(code) || code) || code;
  } catch {
    return code || 'this language';
  }
}

export function hasBuiltInTranslator() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

// -----------------------------------------------------------------------------
// Built-in Translator (Chrome 138+, Edge)
// -----------------------------------------------------------------------------
const nativeTranslators = new Map(); // "en>ru" -> Promise<Translator>
const nativeUnusable = new Set();    // pairs the built-in translator can't do

// Some builds expose the API but never answer (no on-device model service)
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
let progressListener = null;         // ({ target, loaded, total }) => void

function nativeTranslator(source, target) {
  const key = `${source}>${target}`;
  if (!nativeTranslators.has(key)) {
    const promise = (async () => {
      const availability = await withTimeout(
        self.Translator.availability({ sourceLanguage: source, targetLanguage: target }),
        5000, 'The built-in translator is not responding');
      if (availability === 'unavailable') {
        throw new Error(`Your browser can't translate ${source.toUpperCase()} to ${targetName(target)}`);
      }
      return self.Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            progressListener?.({ target, loaded: e.loaded, total: 1 });
          });
        },
      });
    })().catch(err => {
      nativeTranslators.delete(key);
      if (err?.name !== 'NotAllowedError') nativeUnusable.add(key);
      if (err?.name === 'NotAllowedError') {
        throw new Error(`Choose ${targetName(target)} again in the subtitles menu to download it`);
      }
      throw err;
    });
    nativeTranslators.set(key, promise);
  }
  return nativeTranslators.get(key);
}

let detectorPromise = null;
async function detectLanguage(text) {
  if (typeof self === 'undefined' || !('LanguageDetector' in self) || text.length < 12) return '';
  try {
    detectorPromise = detectorPromise || withTimeout(self.LanguageDetector.create(), 4000, 'no detector');
    const results = await withTimeout((await detectorPromise).detect(text), 2000, 'no detector');
    const top = results?.[0];
    return top && top.confidence > 0.6 ? baseLanguage(top.detectedLanguage) : '';
  } catch {
    detectorPromise = null;
    return '';
  }
}

/**
 * Start downloading what a translation will need. Call it from a click:
 * the browser only downloads a language model during a user gesture.
 */
export function prepareTranslation(target, sources = []) {
  if (!target) return;
  const unique = new Set(sources.map(baseLanguage).filter(s => s && s !== target));
  if (hasBuiltInTranslator()) {
    unique.add('en');
    unique.delete(target);
    unique.forEach(source => nativeTranslator(source, target).catch(() => {}));
  }
}

export function onTranslationProgress(fn) {
  progressListener = fn;
  const off = onWorkerTranslationProgress(fn);
  return () => {
    if (progressListener === fn) progressListener = null;
    off();
  };
}

// -----------------------------------------------------------------------------
// translate()
// -----------------------------------------------------------------------------
const cache = new Map();
const CACHE_LIMIT = 400;

/**
 * Translate one caption into `target`. `source` is the caption's language
 * if known; otherwise it is detected (built-in) or assumed to be English.
 */
export async function translateCaption(text, { source, target }) {
  if (!target || !text) return text;
  let src = baseLanguage(source);
  if (!src && hasBuiltInTranslator()) src = await detectLanguage(text);
  if (!src) src = 'en';
  if (src === target) return text;

  const key = `${src}>${target}|${text}`;
  if (cache.has(key)) return cache.get(key);

  let result;
  let nativeError = null;
  if (hasBuiltInTranslator() && !nativeUnusable.has(`${src}>${target}`)) {
    try {
      result = await (await nativeTranslator(src, target)).translate(text);
    } catch (err) {
      nativeError = err;
      // No direct model for this pair: go through English
      if (src !== 'en' && target !== 'en' && !nativeUnusable.has(`${src}>en`) && !nativeUnusable.has(`en>${target}`)) {
        try {
          const english = await (await nativeTranslator(src, 'en')).translate(text);
          result = await (await nativeTranslator('en', target)).translate(english);
          nativeError = null;
        } catch {
          // fall through to the worker
        }
      }
    }
  }
  if (result == null) {
    // "Choose it again to download" is the one built-in error worth showing
    if (nativeError && /again/.test(nativeError.message)) throw nativeError;
    if (src !== 'en') {
      throw new Error(`Translating from ${languageLabel(source)} needs Chrome or Edge`);
    }
    try {
      result = await translateInWorker(text, target);
    } catch (err) {
      console.warn('Caption translation failed:', err);
      throw new Error(`${targetName(target)} translation isn't available in this browser`);
    }
  }

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
