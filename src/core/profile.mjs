// Which mistakes a player actually makes, and what to drill because of them.
//
// Three layers, from evidence to prescription:
//
//   attributeMiss   one wrong answer -> which rule or jamo it is evidence against
//   weaknessProfile many attempts    -> ranked weaknesses with honest denominators
//   buildFocusPool  weaknesses       -> a run's worth of words that press on them
//
// It lives in core because deciding what a miss MEANS is knowledge about Korean, not
// about the UI: the same attribution has to hold whether it is judged in the browser
// the moment it happens or re-derived on the server years later.

import { decomposeWord } from './hangul.mjs'
import { romanizePronunciation, normalize } from './rr.mjs'
import { breakdown } from './breakdown.mjs'
import { locateIndex } from './answer.mjs'
import { sample } from './seed.mjs'

/** Display names for the rule types describeChanges emits. The per-instance titles vary
 *  ("Inserted ㄴ, then ㄹ"), so aggregation needs one stable name per type. */
export const RULE_NAMES = {
  liaison: 'Liaison',
  nasalisation: 'Nasal assimilation',
  lateralisation: 'ㄴ becomes ㄹ',
  rtoN: 'ㄹ becomes ㄴ',
  palatalisation: 'Palatalisation',
  aspiration: 'Aspiration',
  tensification: 'Tensing',
  insertion: 'Inserted ㄴ',
  hdrop: 'ㅎ drops',
  neutralisation: 'Closing sound',
  doubledR: 'Two ㄹ become ll',
  glideeaten: 'A swallowed y',
  vowelheld: 'Said one way, written another',
}

/**
 * What the letters say, before any sound change. rr.mjs romanizes whatever hangul it is
 * handed and CLAUDE.md calls feeding it a spelling "a wrong answer by design"; here that
 * wrong answer is exactly the thing we want, because it is what a player types when they
 * read 독립 letter by letter instead of hearing 동닙.
 */
export const literalOf = spelling => romanizePronunciation(spelling).rr

/**
 * The rules a word exercises and the jamo it contains, for building indexes over the
 * whole list ("every Inserted ㄴ word", "every word with a ㄼ final"). Initial ㅇ is
 * left out of the jamo set: it is silent, so no answer can ever be wrong AT it.
 */
export function tagWord(spelling, pron) {
  const rules = [...new Set(breakdown(spelling, pron).changes.map(c => c.type))]
  const jamo = new Set()
  for (const s of decomposeWord(spelling)) {
    if (!s) continue
    if (s.initial !== 'ㅇ') jamo.add(`initial:${s.initial}`)
    jamo.add(`vowel:${s.vowel}`)
    if (s.final) jamo.add(`final:${s.final}`)
  }
  return { rules, jamo: [...jamo] }
}

/**
 * Pin one wrong answer on a rule or on a jamo, or decline to.
 *
 * The whole point is restraint. Charging every rule in the word on every miss would
 * just rank rules by how often they occur, so a miss only becomes evidence when the
 * first wrong character lands somewhere that implicates something specific:
 *
 *   on a jamo the rules rewrote (fate changed/arrived/moved/fused)
 *       -> the rules that did the rewriting, which is what the player failed to apply
 *   on a jamo the rules left alone (fate kept)
 *       -> the jamo itself, plus any rule whose trap is precisely that the writing
 *          ignores the sound (tensing, the held ㅢ/ㅚ vowels)
 *   the whole answer matches the literal letter-by-letter reading
 *       -> every reflected rule at once: the player read the spelling, not the word
 *
 * A truncated answer is charged to nothing. "Right as far as it goes" means the player
 * stopped, and what they never attempted is not something they got wrong.
 */
export function attributeMiss(parsed, marked, diag) {
  const none = { rules: [], jamo: [] }
  if (!parsed) return none

  if (diag?.kind === 'literal') {
    return { rules: [...new Set(parsed.changes.filter(c => c.reflected).map(c => c.type))], jamo: [] }
  }
  if (!marked || marked.truncated || marked.firstBadIndex == null) return none

  const loc = locateIndex(parsed.syllables, marked.firstBadIndex)
  const real = parsed.syllables.filter(s => !s.literal)
  const part = real[loc.syllable]?.jamo?.[loc.jamo]
  if (!part) return none

  // changes[].at is anchored to the decomposed word, literal characters included, so
  // the filtered syllable index has to be walked back to its original position.
  let at = -1
  for (let i = 0, seen = -1; i < parsed.syllables.length; i++) {
    if (parsed.syllables[i].literal) continue
    if (++seen === loc.syllable) { at = i; break }
  }

  const rules = new Set()
  const jamo = new Set()
  const here = parsed.changes.filter(c => c.at === at)

  if (part.fate !== 'kept') {
    for (const c of here) if (c.reflected) rules.add(c.type)
    // A final that moved or fused is explained by the rule sitting on the syllable it
    // arrived in, the same reach-back rule-coverage.test.mjs relies on.
    if (part.fate === 'moved' || part.fate === 'fused') {
      for (const c of parsed.changes) if (c.at === at + 1 && c.reflected) rules.add(c.type)
    }
    // Nothing claims this change (should not happen while rule coverage stays green),
    // so fall back to the jamo rather than silently dropping the evidence.
    if (!rules.size) jamo.add(`${part.slot}:${part.jamo}`)
  } else {
    jamo.add(`${part.slot}:${part.jamo}`)

    /*
     * Rules that live only in the ear are charged on letter evidence, never on
     * position. Tensing and the held vowels do not change the expected answer, so a
     * miss merely landing on their syllable proves nothing: hakgyu is a vowel slip
     * that has nothing to do with the ㄲ in 학꾜, and charging tensing for it would
     * quietly turn "rules you miss" back into "rules that exist". What convicts is
     * typing the sound the writing ignores: the voiceless k/t/p where g/d/b is
     * written, a doubled s or j, the spoken vowel where the spelled one belongs.
     */
    const typedBad = marked.marks?.find(m => !m.ok)?.ch?.toLowerCase() ?? null
    for (const c of here) {
      if (c.reflected) continue
      if (c.type === 'tensification') {
        if (part.slot === 'initial' && typedBad && typedBad === TENSE_TRAP[part.rr]) rules.add(c.type)
      } else if (c.type === 'vowelheld') {
        if (part.slot === 'vowel') rules.add(c.type)
      } else {
        rules.add(c.type)
      }
    }
  }

  return { rules: [...rules], jamo: [...jamo] }
}

/** What a tensed consonant sounds like in the romanization the player reaches for:
 *  ㄲ begins with k where ㄱ writes g, and the sibilants simply double. */
const TENSE_TRAP = { g: 'k', d: 't', b: 'p', s: 's', j: 'j' }

/** Attempts to have seen before the profile is worth acting on. Below this the focus
 *  endpoint says "play more" rather than drilling noise. */
export const READY_AT = 30

/**
 * Wilson lower bound on a miss rate. The plain rate says 1 miss in 1 try is a 100%
 * weakness and 30 misses in 100 tries only 30%, which orders them exactly backwards
 * for our purposes. The lower confidence bound rewards evidence: rates only rank high
 * once they have the exposures to back them up.
 */
function wilson(misses, n, z) {
  if (n <= 0) return 0
  const p = misses / n
  const z2 = z * z
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
}

/**
 * Fold attempt events into ranked weaknesses.
 *
 * Each event is one word attempted: { word, rules, jamo, missedRules, missedJamo,
 * misses, peeked, at }. `rules`/`jamo` are what the word EXERCISES (the denominator),
 * `missedRules`/`missedJamo` what the miss was pinned on (the numerator). Logging clean
 * attempts is what makes the ratio honest: nasalisation appears in a large share of all
 * changed words and ㄴ insertion in very few, so raw miss counts would only ever
 * rediscover that skew.
 *
 * Events decay with a half-life so the profile heals as the player improves: last
 * month's disaster should not outvote this week's clean runs forever. A peek counts as
 * a failed attempt at the word (the answer was bought, not known) but charges no rule,
 * because a peek says nothing about WHERE the answer was unknown.
 */
export function weaknessProfile(events, { now = Date.now(), halfLifeDays = 45, z = 1.0 } = {}) {
  const life = halfLifeDays * 24 * 60 * 60 * 1000
  const acc = { rules: new Map(), jamo: new Map(), words: new Map() }
  const bump = (map, key, w, missed) => {
    const e = map.get(key) ?? { exposures: 0, misses: 0 }
    e.exposures += w
    if (missed) e.misses += w
    map.set(key, e)
  }

  for (const ev of events) {
    const w = 0.5 ** (Math.max(0, now - (ev.at ?? now)) / life)
    const missedR = new Set(ev.missedRules ?? [])
    const missedJ = new Set(ev.missedJamo ?? [])
    for (const r of ev.rules ?? []) bump(acc.rules, r, w, missedR.has(r))
    for (const j of ev.jamo ?? []) bump(acc.jamo, j, w, missedJ.has(j))
    bump(acc.words, ev.word, w, (ev.misses ?? 0) > 0 || Boolean(ev.peeked))
  }

  const scored = (map, minExposure) => [...map.entries()]
    .map(([key, e]) => ({
      key,
      exposures: e.exposures,
      misses: e.misses,
      rate: e.misses / e.exposures,
      score: wilson(e.misses, e.exposures, z),
    }))
    .filter(e => e.misses > 0 && e.exposures >= minExposure)
    .sort((a, b) => b.score - a.score || b.rate - a.rate)

  return {
    events: events.length,
    ready: events.length >= READY_AT,
    rules: scored(acc.rules, 4).map(e => ({ ...e, name: RULE_NAMES[e.key] ?? e.key })),
    jamo: scored(acc.jamo, 4),
    // A single miss qualifies a word. Unlike a rule, a word needs no corroboration to
    // be worth seeing again; the cost of a false positive is one easy word in a drill.
    words: scored(acc.words, 0),
  }
}

/**
 * Assemble a focus run from a profile: the words being failed outright, then unseen
 * words that exercise the weakest rules, then words carrying the misread jamo, topped
 * up with ordinary sound-changing words when the profile is thin. Deterministic in
 * (profile, seed) so a run can be reasoned about after the fact.
 */
export function buildFocusPool(words, profile, { count, seed, tags }) {
  const byWord = new Map(words.map(w => [w.word, w]))
  const picked = new Map()
  const room = () => count - picked.size
  const take = (pool, n, s) => {
    for (const w of sample(pool, Math.min(n, room()), s)) {
      if (room() <= 0) break
      picked.set(w.word, w)
    }
  }

  // The exact words being failed, worst first. Repetition is the point of a drill, so
  // there is no freshness filter: a word stops appearing when it stops being missed.
  for (const e of profile.words) {
    if (picked.size >= Math.ceil(count * 0.4)) break
    const w = byWord.get(e.key)
    if (w) picked.set(w.word, w)
  }

  const weakRules = profile.rules.slice(0, 3)
  const perRule = Math.ceil((count * 0.4) / Math.max(1, weakRules.length))
  for (const r of weakRules) {
    if (room() <= 0) break
    take(words.filter(w => tags.get(w.word)?.rules.includes(r.key) && !picked.has(w.word)),
      perRule, `${seed}:rule:${r.key}`)
  }

  for (const j of profile.jamo.slice(0, 2)) {
    if (room() <= 0) break
    take(words.filter(w => tags.get(w.word)?.jamo.includes(j.key) && !picked.has(w.word)),
      Math.ceil(count * 0.1), `${seed}:jamo:${j.key}`)
  }

  if (room() > 0) {
    take(words.filter(w => (tags.get(w.word)?.rules.length ?? 0) > 0 && !picked.has(w.word)),
      room(), `${seed}:fill`)
  }

  // Shuffle, or every focus run would open with the same personal nemesis.
  return sample([...picked.values()], count, `${seed}:order`)
}
