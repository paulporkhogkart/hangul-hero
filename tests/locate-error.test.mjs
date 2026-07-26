// The first rung of the hint ladder has to point at the right place, or it teaches
// something worse than nothing.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { breakdown } from '../src/core/breakdown.mjs'
import { locateError } from '../src/core/answer.mjs'

const at = (word, pron, typed, expected) => {
  const b = breakdown(word, pron)
  const e = locateError(b.syllables, typed, expected)
  return {
    ...e,
    syllableChar: b.syllables[e.syllable].char,
    jamoChar: b.syllables[e.syllable].jamo[e.jamo]?.jamo,
  }
}

describe('한국어 -> hangugeo', () => {
  test('the liaised consonant is attributed to the syllable it moved INTO', () => {
    // Typing "hangukeo" splits after "hangu", and the g at that position belongs to 어,
    // not to 국: the ㄱ has already crossed the boundary. Pointing at 어 is what makes
    // the liaison visible. Pointing at 국 would show where the ㄱ used to live.
    const e = at('한국어', '한구거', 'hangukeo', 'hangugeo')
    assert.equal(e.okPrefix, 'hangu')
    assert.equal(e.wrongTail, 'keo')
    assert.equal(e.syllableChar, '어')
    assert.equal(e.diverged, true)
    assert.equal(e.truncated, false)
  })

  test('a short answer is truncated, which is a different mistake to diverging', () => {
    const e = at('한국어', '한구거', 'hangug', 'hangugeo')
    assert.equal(e.truncated, true)
    assert.equal(e.diverged, false)
    assert.equal(e.wrongTail, '')
  })

  test('a wrong first character points at the first jamo', () => {
    const e = at('한국어', '한구거', 'xangugeo', 'hangugeo')
    assert.equal(e.okPrefix, '')
    assert.equal(e.syllableChar, '한')
    assert.equal(e.jamoChar, 'ㅎ')
  })

  test('a fully correct answer is neither truncated nor diverged', () => {
    const e = at('한국어', '한구거', 'hangugeo', 'hangugeo')
    assert.equal(e.wrongTail, '')
    assert.equal(e.diverged, false)
    assert.equal(e.truncated, false)
  })

  test('an overlong answer marks the extra characters as the wrong tail', () => {
    const e = at('한국어', '한구거', 'hangugeoo', 'hangugeo')
    assert.equal(e.okPrefix, 'hangugeo')
    assert.equal(e.wrongTail, 'o')
    assert.equal(e.diverged, true)
  })
})

describe('tolerated punctuation does not shift the split', () => {
  test('a hyphen is skipped rather than counted as a mistake', () => {
    const e = at('중앙', '중앙', 'jung-ang', 'jungang')
    assert.equal(e.wrongTail, '')
  })

  test('capitals do not count as a divergence', () => {
    const e = at('사람', '사람', 'Saram', 'saram')
    assert.equal(e.wrongTail, '')
  })
})

describe('독립 -> dongnip, the whole point of the game', () => {
  test('typing the letters instead of the sounds points at the changed syllable', () => {
    const e = at('독립', '동닙', 'doknip', 'dongnip')
    assert.equal(e.okPrefix, 'do')
    assert.equal(e.wrongTail, 'knip')
    assert.equal(e.syllableChar, '독')
  })
})
