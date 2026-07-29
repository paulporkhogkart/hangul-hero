// The mistake profile: pinning a miss on the right rule, ranking weaknesses with
// honest denominators, and building a drill from them.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { breakdown } from '../src/core/breakdown.mjs'
import { diagnose, markAnswer } from '../src/core/answer.mjs'
import {
  literalOf, tagWord, attributeMiss, weaknessProfile, buildFocusPool, READY_AT,
} from '../src/core/profile.mjs'

const words = JSON.parse(readFileSync(fileURLToPath(new URL('../data/words.json', import.meta.url)), 'utf8'))

/** A miss, exactly as Race.svelte would see one. */
function miss(spelling, pron, rr, typed, literal = literalOf(spelling)) {
  const word = { rr, accept: [rr], literal }
  const parsed = breakdown(spelling, pron)
  return attributeMiss(parsed, markAnswer(typed, rr), diagnose(word, typed))
}

describe('literalOf', () => {
  test('reads the letters with no sound changes applied', () => {
    assert.equal(literalOf('독립'), 'dokrip')
    assert.equal(literalOf('꽃잎'), 'kkotip')
  })

  test('matches the real answer when nothing changes', () => {
    // These must be filtered out before reaching the client, or diagnose would call a
    // wrong answer "literal" on a word where literal IS the answer.
    assert.equal(literalOf('하다'), 'hada')
  })

  test('keeps the ㄹㄹ adjacency rule, which is spelling-driven rather than sound-driven', () => {
    assert.equal(literalOf('빨리'), 'ppalli')
  })
})

describe('tagWord', () => {
  test('독립 exercises both of its rules', () => {
    const t = tagWord('독립', '동닙')
    assert.ok(t.rules.includes('rtoN'), `expected rtoN in ${t.rules}`)
    assert.ok(t.rules.includes('nasalisation'), `expected nasalisation in ${t.rules}`)
    assert.ok(t.jamo.includes('final:ㄱ'))
    assert.ok(t.jamo.includes('vowel:ㅣ'))
    assert.ok(!t.jamo.includes('initial:ㅇ'), 'silent ㅇ can never be missed, so it is not indexed')
  })

  test('the whole shipping list tags without throwing', () => {
    for (const w of words) {
      const t = tagWord(w.word, w.pron)
      assert.ok(t.jamo.length > 0, `${w.word} produced no jamo tags`)
    }
  })
})

describe('attributeMiss', () => {
  test('dongrip for 독립 charges rtoN and only rtoN', () => {
    // The first wrong character is the r where the n belongs: the ㄹ of 립 was not
    // turned into ㄴ. The nasalisation next door was performed correctly and must not
    // be charged along with it.
    const f = miss('독립', '동닙', 'dongnip', 'dongrip')
    assert.deepEqual(f.rules, ['rtoN'])
    assert.deepEqual(f.jamo, [])
  })

  test('the literal reading charges every reflected rule at once', () => {
    const f = miss('독립', '동닙', 'dongnip', 'dokrip')
    assert.ok(f.rules.includes('rtoN'))
    assert.ok(f.rules.includes('nasalisation'))
  })

  test('a wrong letter on an unchanged jamo charges the jamo, with its direction', () => {
    const f = miss('하다', '하다', 'hada', 'hata')
    assert.deepEqual(f.rules, [])
    assert.deepEqual(f.jamo, ['initial:ㄷ'])
    assert.deepEqual(f.subs, ['initial:ㄷ>t'])
  })

  test('ear-only rules are never charged, whatever was typed', () => {
    // 학교 is heard 학꾜, but the answer never depends on that: a rule that cannot
    // change what you type cannot be missed in a game that asks for the written form.
    // Even hakkyo, the tensed sound typed out, is recorded as what it demonstrably
    // is: the g of ㄱ coming out as k.
    const heard = miss('학교', '학꾜', 'hakgyo', 'hakkyo')
    assert.deepEqual(heard.rules, [])
    assert.ok(heard.jamo.includes('initial:ㄱ'))
    assert.deepEqual(heard.subs, ['initial:ㄱ>k'])

    const held = miss('희다', '히다', 'huida', 'hida')
    assert.deepEqual(held.rules, [])
    assert.ok(held.jamo.includes('vowel:ㅢ'))
  })

  test('a substitution records the direction, not just the letter', () => {
    const vowelSlip = miss('학교', '학꾜', 'hakgyo', 'hakgyu')
    assert.deepEqual(vowelSlip.subs, ['vowel:ㅛ>u'])

    const strayLetter = miss('학교', '학꾜', 'hakgyo', 'hakryo')
    assert.deepEqual(strayLetter.subs, ['initial:ㄱ>r'])
  })

  test('doubling a letter is a jamo miss with no direction', () => {
    // silssu for 실수: the extra s IS an s, and "types s as s" is not a sentence.
    const f = miss('실수', '실쑤', 'silsu', 'silssu')
    assert.deepEqual(f.rules, [])
    assert.ok(f.jamo.includes('initial:ㅅ'))
    assert.deepEqual(f.subs, [])
  })

  test('missing the inserted ㄴ charges the insertion', () => {
    const f = miss('담요', '담뇨', 'damnyo', 'damyo')
    assert.ok(f.rules.includes('insertion'), `expected insertion in ${f.rules}`)
  })

  test('a miss between two adjacent ㄴ sounds charges one of the rules that made them', () => {
    // kkonip for 꽃잎 is one ㄴ short, and the alignment cannot say which ㄴ is missing:
    // the nasalised final of 꼰 or the inserted initial of 닙 sit side by side. Either
    // charge is fair evidence; inventing certainty here would be dishonest.
    const f = miss('꽃잎', '꼰닙', 'kkonnip', 'kkonip')
    assert.ok(f.rules.length > 0)
    assert.ok(f.rules.every(r => ['insertion', 'nasalisation'].includes(r)), `got ${f.rules}`)
  })

  test('a truncated answer charges nothing', () => {
    // Stopping is not the same as getting the rest wrong. What was never attempted is
    // not evidence against anything.
    const f = miss('독립', '동닙', 'dongnip', 'dong')
    assert.deepEqual(f.rules, [])
    assert.deepEqual(f.jamo, [])
  })
})

describe('weaknessProfile', () => {
  const NOW = 1_800_000_000_000
  const ev = (over = {}) => ({
    word: '독립', rules: ['rtoN', 'nasalisation'], jamo: ['final:ㄱ'],
    missedRules: [], missedJamo: [], misses: 0, peeked: false, at: NOW, ...over,
  })

  test('clean attempts are the denominator that keeps common rules honest', () => {
    // rtoN: missed 4 of 8. nasalisation: missed 4 of 40. Raw miss counts tie them;
    // the rate does not, and the profile must follow the rate.
    const events = []
    for (let i = 0; i < 8; i++) events.push(ev({ missedRules: i < 4 ? ['rtoN'] : [], misses: i < 4 ? 1 : 0 }))
    for (let i = 0; i < 32; i++) {
      events.push(ev({
        word: '박물관', rules: ['nasalisation'], jamo: [],
        missedRules: i < 4 ? ['nasalisation'] : [], misses: i < 4 ? 1 : 0,
      }))
    }
    const p = weaknessProfile(events, { now: NOW })
    assert.equal(p.rules[0].key, 'rtoN')
    const nas = p.rules.find(r => r.key === 'nasalisation')
    assert.ok(p.rules[0].score > nas.score)
  })

  test('one bad first impression is not a weakness yet', () => {
    // A rule seen twice and missed twice has a 100% rate and nowhere near enough
    // evidence. It stays out until the exposures arrive.
    const events = [
      ev({ rules: ['insertion'], missedRules: ['insertion'], misses: 1 }),
      ev({ rules: ['insertion'], missedRules: ['insertion'], misses: 1 }),
    ]
    const p = weaknessProfile(events, { now: NOW })
    assert.equal(p.rules.length, 0)
  })

  test('old misses fade as clean recent attempts pile up', () => {
    const day = 24 * 60 * 60 * 1000
    const past = Array.from({ length: 6 }, () => ev({ at: NOW - 300 * day, missedRules: ['rtoN'], misses: 1 }))
    const recent = Array.from({ length: 6 }, () => ev({ at: NOW - day }))
    const then = weaknessProfile(past, { now: NOW - 299 * day }).rules.find(r => r.key === 'rtoN')
    const now = weaknessProfile([...past, ...recent], { now: NOW }).rules.find(r => r.key === 'rtoN')
    assert.ok(then.score > 0.5, `fresh misses should score high, got ${then.score}`)
    assert.ok(!now || now.score < 0.2, `decayed misses should barely register, got ${now?.score}`)
  })

  test('a peek fails the word without accusing any rule', () => {
    const p = weaknessProfile([ev({ peeked: true })], { now: NOW })
    assert.equal(p.words[0].key, '독립')
    assert.equal(p.rules.length, 0)
  })

  test('ear-only rules never reach the profile, even from stored rows', () => {
    // Older attempts rows and the run_words backfill both charge tensing, the first
    // because the client once did, the second because a historical miss charges every
    // rule its word exercises. The filter has to hold at profile time or history
    // keeps resurrecting a rule the game cannot test.
    const events = Array.from({ length: 8 }, () => ev({
      rules: ['tensification', 'rtoN'], missedRules: ['tensification', 'rtoN'], misses: 1,
    }))
    const p = weaknessProfile(events, { now: NOW })
    assert.ok(p.rules.some(r => r.key === 'rtoN'))
    assert.ok(!p.rules.some(r => r.key === 'tensification'), `tensification survived: ${p.rules.map(r => r.key)}`)
  })

  test('a letter weakness carries the direction it usually fails in', () => {
    const events = Array.from({ length: 8 }, (_, i) => ev({
      jamo: ['initial:ㅂ'],
      missedJamo: i < 4 ? ['initial:ㅂ'] : [],
      misses: i < 4 ? 1 : 0,
      subs: i < 3 ? ['initial:ㅂ>p'] : i === 3 ? ['initial:ㅂ>m'] : [],
    }))
    const p = weaknessProfile(events, { now: NOW })
    const b = p.jamo.find(j => j.key === 'initial:ㅂ')
    assert.equal(b.typedAs.ch, 'p')
    assert.ok(b.typedAs.share > 0.7 && b.typedAs.share <= 0.76, `share ${b.typedAs.share}`)
  })

  test('readiness is a plain event count', () => {
    const some = Array.from({ length: READY_AT - 1 }, () => ev())
    assert.equal(weaknessProfile(some, { now: NOW }).ready, false)
    assert.equal(weaknessProfile([...some, ev()], { now: NOW }).ready, true)
  })
})

describe('buildFocusPool', () => {
  // Real tags over the real list, so the pool test exercises the same index the
  // server builds at boot.
  const tags = new Map(words.map(w => [w.word, tagWord(w.word, w.pron)]))
  const failed = words.find(w => tags.get(w.word).rules.includes('rtoN'))
  const profile = {
    words: [{ key: failed.word, score: 0.6 }],
    rules: [{ key: 'rtoN', score: 0.5 }],
    jamo: [{ key: 'vowel:ㅢ', score: 0.4 }],
  }

  test('drills the failed word, the weak rule and the weak jamo', () => {
    const pool = buildFocusPool(words, profile, { count: 10, seed: 'TEST-SEED', tags })
    assert.equal(pool.length, 10)
    assert.equal(new Set(pool.map(w => w.word)).size, 10, 'no duplicates')
    assert.ok(pool.some(w => w.word === failed.word), 'the word being failed is in the drill')
    const rtoN = pool.filter(w => tags.get(w.word).rules.includes('rtoN'))
    assert.ok(rtoN.length >= 2, `expected rtoN words in the pool, got ${rtoN.length}`)
    assert.ok(pool.some(w => tags.get(w.word).jamo.includes('vowel:ㅢ')), 'expected a ㅢ word')
  })

  test('same seed, same pool', () => {
    const a = buildFocusPool(words, profile, { count: 25, seed: 'AAAA-BBBB', tags })
    const b = buildFocusPool(words, profile, { count: 25, seed: 'AAAA-BBBB', tags })
    assert.deepEqual(a.map(w => w.word), b.map(w => w.word))
  })

  test('an empty profile still fills the run with sound-changing words', () => {
    const pool = buildFocusPool(words, { words: [], rules: [], jamo: [] }, { count: 10, seed: 'XYZ2-3456', tags })
    assert.equal(pool.length, 10)
    assert.ok(pool.every(w => tags.get(w.word).rules.length > 0))
  })
})
