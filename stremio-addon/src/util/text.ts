const NIQQUD_AND_CANTILLATION = /[֑-ׇ]/g;
const FINAL_LETTERS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const PUNCTUATION = /[׳״'"`׳״.,:;!?()[\]{}\-–—_/\\|]+/g;

/** Normalizes Hebrew and Latin text for matching: strips niqqud, folds final letters, case and punctuation. */
export function normalizeForSearch(input: string): string {
  return input
    .normalize("NFKD")
    .replace(NIQQUD_AND_CANTILLATION, "")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c] ?? c)
    .toLowerCase()
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HEBREW_PREFIX = /^[הובלמשכ](?=[\u05D0-\u05EA]{3,})/;

/** A Hebrew word plus the word without a one-letter prefix (ה, ו, ב, ל, מ, ש, כ), so "כנסת" finds "הכנסת". */
function wordForms(word: string): string[] {
  return HEBREW_PREFIX.test(word) ? [word, word.slice(1)] : [word];
}

/** True when every word of the query appears (as a prefix of a word) in one of the candidate strings. */
export function matchesQuery(query: string, candidates: Array<string | undefined>): boolean {
  const q = normalizeForSearch(query).split(" ").filter(Boolean);
  if (q.length === 0) return true;
  const words = candidates
    .filter((c): c is string => !!c)
    .flatMap((c) => normalizeForSearch(c).split(" "))
    .flatMap(wordForms);
  return q.every((term) => words.some((w) => w.startsWith(term)));
}
