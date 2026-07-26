// Grading a typed answer.
//
// Forgiving about things that are not the skill being tested (capitals, the optional
// RR hyphen, stray whitespace) and strict about everything that is.

import { normalize } from './rr.mjs'

/** @param {{accept: string[]}} word */
export const isCorrect = (word, typed) => word.accept.some(a => normalize(a) === normalize(typed))

/** Levenshtein, capped: we only care whether it is 1 or 2, never 17. */
function distance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, row[j])
    }
    if (best > cap) return cap + 1
    prev = row
  }
  return prev[b.length]
}

/**
 * Why an answer was wrong, so the feedback can teach instead of just flashing red.
 * Returns the canonical answer plus a diagnosis where one is obvious.
 */
export function diagnose(word, typed) {
  const got = normalize(typed)
  const want = normalize(word.rr)
  if (word.accept.some(a => normalize(a) === got)) return { correct: true }
  if (!got) return { correct: false, kind: 'empty' }

  // The single most common miss: typing what the letters say instead of what they sound
  // like. Worth naming explicitly, because it is the whole point of the game.
  if (word.literal && normalize(word.literal) === got) {
    return { correct: false, kind: 'literal', want: word.rr, note: 'That is what the letters say. This word changes when it is spoken.' }
  }

  const d = distance(got, want)
  if (d === 1) return { correct: false, kind: 'typo', want: word.rr }

  // Vowels are where beginners lose most: eo/o, eu/u, ae/e.
  const strippedGot = got.replace(/[aeiou]/g, '')
  const strippedWant = want.replace(/[aeiou]/g, '')
  if (strippedGot === strippedWant) {
    return { correct: false, kind: 'vowel', want: word.rr, note: 'Consonants right, vowels not.' }
  }

  return { correct: false, kind: 'wrong', want: word.rr, d }
}

/** Characters normalize() throws away, so raw and normalized indices can be mapped. */
const IGNORED = /[-'\s.]/

/**
 * Mark each typed character right or wrong, aligned against the answer.
 *
 * Colouring everything after the first divergence overstates the mistake: typing
 * "hangukeo" for hangugeo is one wrong letter, not three, and painting "keo" red says
 * the eo was wrong too. An edit-distance backtrace finds the real correspondence, so a
 * single substitution marks one character and an extra or missing letter does not throw
 * everything after it out of step.
 */
export function markAnswer(typed, expected) {
  // Keep raw positions alongside the normalized ones so the marks land on what was
  // actually typed, hyphens and capitals included.
  const raw = []
  const got = []
  for (let i = 0; i < typed.length; i++) {
    if (IGNORED.test(typed[i])) continue
    raw.push(i)
    got.push(typed[i].toLowerCase())
  }
  const want = [...normalize(expected)]

  // Standard Levenshtein table, then walk it back to see which typed characters
  // survived unchanged.
  const d = Array.from({ length: got.length + 1 }, (_, i) =>
    Array.from({ length: want.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= got.length; i++) {
    for (let j = 1; j <= want.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (got[i - 1] === want[j - 1] ? 0 : 1),
      )
    }
  }

  const ok = new Array(typed.length).fill(true) // ignored characters are never "wrong"
  let i = got.length, j = want.length, firstBad = null
  while (i > 0) {
    const sub = j > 0 && d[i][j] === d[i - 1][j - 1] + (got[i - 1] === want[j - 1] ? 0 : 1)
    if (sub) {
      const matched = got[i - 1] === want[j - 1]
      ok[raw[i - 1]] = matched
      if (!matched) firstBad = j - 1
      i--; j--
    } else if (d[i][j] === d[i - 1][j] + 1) {
      ok[raw[i - 1]] = false      // a character that does not belong
      firstBad = j
      i--
    } else {
      firstBad = j - 1            // a character that is missing
      j--
    }
  }
  if (j > 0) firstBad = 0

  // Stopping early and dropping a letter from the middle are different mistakes and
  // deserve different words, so do not lump them together as "missing".
  const truncated = got.length < want.length && got.every((c, k) => c === want[k])

  return {
    marks: [...typed].map((ch, k) => ({ ch, ok: ok[k] })),
    correct: got.join('') === want.join(''),
    // Where in the ANSWER the first problem is, which is what the syllable highlight
    // needs. Missing characters have no typed position to point at.
    firstBadIndex: firstBad,
    truncated,
    missing: !truncated && got.length < want.length,
  }
}

/**
 * Where an answer first went wrong, and what that position corresponds to in the word.
 *
 * This is the first rung of the hint ladder. It says *where* without ever saying *what*,
 * which is the whole point: it should narrow the search without handing over the answer.
 *
 * Returns the split of the typed text (so the input can colour the wrong tail), plus the
 * syllable and the individual jamo the divergence lands on.
 */
/** Which syllable and jamo a position in the answer belongs to. */
export function locateIndex(syllables, index) {
  const real = syllables.filter(s => !s.literal)
  let remaining = Math.max(0, index)
  for (let s = 0; s < real.length; s++) {
    const len = (real[s].rr ?? '').length
    if (remaining < len || s === real.length - 1) {
      let jamo = 0
      for (const [k, part] of (real[s].jamo ?? []).entries()) {
        const pl = (part.rr ?? '').length
        jamo = k
        if (remaining < pl) break
        remaining -= pl
      }
      return { syllable: s, jamo }
    }
    remaining -= len
  }
  return { syllable: Math.max(0, real.length - 1), jamo: 0 }
}

export function locateError(syllables, typed, expected) {
  const real = syllables.filter(s => !s.literal)
  const want = normalize(expected)

  // Walk the raw typed string, tracking the normalized position alongside it, so the
  // split point lands on a real character rather than an index into a stripped copy.
  let norm = 0, rawSplit = typed.length
  for (let raw = 0; raw < typed.length; raw++) {
    const ch = typed[raw]
    if (IGNORED.test(ch)) continue
    if (norm >= want.length || ch.toLowerCase() !== want[norm]) { rawSplit = raw; break }
    norm++
  }

  // Which syllable, then which jamo inside it, that normalized position falls on.
  let remaining = norm
  let syllable = real.length - 1
  let jamo = 0
  for (let s = 0; s < real.length; s++) {
    const len = (real[s].rr ?? '').length
    if (remaining < len || s === real.length - 1) {
      syllable = s
      for (const [k, part] of (real[s].jamo ?? []).entries()) {
        const pl = (part.rr ?? '').length
        jamo = k
        if (remaining < pl) break
        remaining -= pl
      }
      break
    }
    remaining -= len
  }

  // Two different ways to be wrong, and they deserve different words. Diverging means a
  // character disagreed. Truncating means everything typed was right and there was
  // simply more to come, which is not the same mistake at all.
  const diverged = rawSplit < typed.length
  return {
    charIndex: norm,
    okPrefix: typed.slice(0, rawSplit),
    wrongTail: typed.slice(rawSplit),
    diverged,
    truncated: !diverged && norm < want.length,
    syllable: Math.min(syllable, real.length - 1),
    jamo,
  }
}
