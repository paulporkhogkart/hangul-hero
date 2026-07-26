// Marking every character after the first divergence as wrong overstates the mistake.
// These cases pin down that only the genuinely wrong characters get flagged.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { markAnswer } from '../src/core/answer.mjs'

/** Render marks as text so a failure is readable: hangu[k]eo */
const show = (typed, expected) =>
  markAnswer(typed, expected).marks.map(m => (m.ok ? m.ch : `[${m.ch}]`)).join('')

describe('only the wrong characters are marked', () => {
  test('one substitution flags one character, not the whole tail', () => {
    assert.equal(show('hangukeo', 'hangugeo'), 'hangu[k]eo')
  })

  test('an extra character does not throw the rest out of step', () => {
    assert.equal(show('hanggugeo', 'hangugeo'), 'han[g]gugeo')
  })

  test('a correct answer marks nothing', () => {
    assert.equal(show('hangugeo', 'hangugeo'), 'hangugeo')
  })

  test('the classic mistake flags exactly the letter that changed', () => {
    assert.equal(show('doknip', 'dongnip'), 'do[k]nip')
  })

  test('a doubled letter flags exactly one of the pair', () => {
    // Which of two identical adjacent characters is "the extra one" is genuinely
    // ambiguous, so pin the invariant rather than an arbitrary choice: exactly one is
    // marked, and removing it leaves the correct answer.
    const m = markAnswer('hangugeoo', 'hangugeo')
    const bad = m.marks.filter(x => !x.ok)
    assert.equal(bad.length, 1)
    assert.equal(m.marks.filter(x => x.ok).map(x => x.ch).join(''), 'hangugeo')
  })
})

describe('tolerated characters are never marked wrong', () => {
  test('the optional hyphen is accepted', () => {
    const m = markAnswer('jung-ang', 'jungang')
    assert.equal(m.correct, true)
    assert.ok(m.marks.every(x => x.ok))
  })

  test('capitals are accepted', () => {
    assert.equal(markAnswer('Saram', 'saram').correct, true)
  })
})

describe('stopping early and dropping a letter are different mistakes', () => {
  test('a correct prefix that stops early is truncated', () => {
    const m = markAnswer('hangug', 'hangugeo')
    assert.equal(m.truncated, true)
    assert.equal(m.missing, false)
  })

  test('a letter dropped from the middle is not truncation', () => {
    const m = markAnswer('hanugeo', 'hangugeo')
    assert.equal(m.truncated, false)
    assert.equal(m.missing, true)
  })

  test('a complete answer is neither', () => {
    const m = markAnswer('hangugeo', 'hangugeo')
    assert.equal(m.truncated, false)
    assert.equal(m.missing, false)
  })
})

describe('firstBadIndex points into the answer, for the syllable highlight', () => {
  test('a substitution points at the position that disagreed', () => {
    assert.equal(markAnswer('hangukeo', 'hangugeo').firstBadIndex, 5)
  })

  test('a correct answer has no bad position', () => {
    assert.equal(markAnswer('hangugeo', 'hangugeo').firstBadIndex, null)
  })
})
