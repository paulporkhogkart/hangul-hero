// Syllable block <-> jamo. Pure Unicode arithmetic, no tables of exceptions:
// a precomposed syllable is 0xAC00 + (initial * 21 + vowel) * 28 + final.

export const BASE = 0xac00
export const LAST = 0xd7a3

/** 19 initials (초성), in Unicode order. */
export const INITIALS = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']

/** 21 vowels (중성), in Unicode order. */
export const VOWELS = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ']

/** 28 finals (종성), index 0 being "no final". */
export const FINALS = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']

/** Compound finals, and the pair they are built from. Needed to explain them. */
export const FINAL_PARTS = {
  'ㄳ': ['ㄱ','ㅅ'], 'ㄵ': ['ㄴ','ㅈ'], 'ㄶ': ['ㄴ','ㅎ'], 'ㄺ': ['ㄹ','ㄱ'],
  'ㄻ': ['ㄹ','ㅁ'], 'ㄼ': ['ㄹ','ㅂ'], 'ㄽ': ['ㄹ','ㅅ'], 'ㄾ': ['ㄹ','ㅌ'],
  'ㄿ': ['ㄹ','ㅍ'], 'ㅀ': ['ㄹ','ㅎ'], 'ㅄ': ['ㅂ','ㅅ'],
}

/** Compound vowels, and the pair they are built from. */
export const VOWEL_PARTS = {
  'ㅘ': ['ㅗ','ㅏ'], 'ㅙ': ['ㅗ','ㅐ'], 'ㅚ': ['ㅗ','ㅣ'],
  'ㅝ': ['ㅜ','ㅓ'], 'ㅞ': ['ㅜ','ㅔ'], 'ㅟ': ['ㅜ','ㅣ'], 'ㅢ': ['ㅡ','ㅣ'],
}

export const isSyllable = ch => { const c = ch.codePointAt(0); return c >= BASE && c <= LAST }

/** 한 -> { initial:'ㅎ', vowel:'ㅏ', final:'ㄴ' }. Returns null for non-syllables. */
export function decompose(ch) {
  if (!isSyllable(ch)) return null
  const n = ch.codePointAt(0) - BASE
  return {
    initial: INITIALS[Math.floor(n / (21 * 28))],
    vowel: VOWELS[Math.floor(n / 28) % 21],
    final: FINALS[n % 28],
  }
}

/** Inverse of decompose. Throws on a jamo that is not legal in that slot. */
export function compose({ initial, vowel, final = '' }) {
  const i = INITIALS.indexOf(initial), v = VOWELS.indexOf(vowel), f = FINALS.indexOf(final)
  if (i < 0) throw new Error(`not an initial: ${initial}`)
  if (v < 0) throw new Error(`not a vowel: ${vowel}`)
  if (f < 0) throw new Error(`not a final: ${final}`)
  return String.fromCodePoint(BASE + (i * 21 + v) * 28 + f)
}

/** Every syllable of a word, decomposed. Non-syllable characters come back as null. */
export const decomposeWord = w => [...w].map(ch => (isSyllable(ch) ? { ch, ...decompose(ch) } : null))

export const syllableCount = w => [...w].filter(isSyllable).length
