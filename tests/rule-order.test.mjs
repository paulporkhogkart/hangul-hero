// Sound changes feed each other. A rule that creates a sound must be listed before the
// rule that reacts to it, or the explanation reads as an effect above its own cause.
//
// These are the feeding chains, and they are the reason ordering is by derivation stage
// rather than by syllable position.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { breakdown } from '../src/core/breakdown.mjs'

const titles = (word, pron) => breakdown(word, pron).changes.map(c => c.title)

describe('a rule that creates a sound comes before the rule it feeds', () => {
  test('독립: the ㄹ becomes ㄴ before the ㄱ reacts to that ㄴ', () => {
    assert.deepEqual(titles('독립', '동닙'), ['ㄹ becomes ㄴ', 'Nasal assimilation'])
  })

  test('꽃잎: the ㄴ is inserted before the ㅊ reacts to it', () => {
    assert.deepEqual(titles('꽃잎', '꼰닙'), ['Inserted ㄴ', 'Nasal assimilation'])
  })

  test('색연필: same chain, different consonants', () => {
    assert.deepEqual(titles('색연필', '생년필'), ['Inserted ㄴ', 'Nasal assimilation'])
  })

  test('수없이: the consonant moves before it tenses in its new home', () => {
    assert.deepEqual(titles('수없이', '수업씨'), ['Liaison', 'Tensing'])
  })
})

describe('the trigger is named as it is said, not as it is written', () => {
  test('독립 blames the ㄴ of 닙, because 립 contains no ㄴ', () => {
    const [, nasal] = breakdown('독립', '동닙').changes
    assert.match(nasal.text, /ㄴ of 닙/)
    assert.doesNotMatch(nasal.text, /ㄴ (starting|of) 립/)
  })

  test('꽃잎 likewise blames the ㄴ of 닙', () => {
    const [, nasal] = breakdown('꽃잎', '꼰닙').changes
    assert.match(nasal.text, /ㄴ of 닙/)
  })
})

describe('single rule words are unaffected by the ordering', () => {
  for (const [word, pron, title] of [
    ['한국어', '한구거', 'Liaison'],
    ['신라', '실라', 'ㄴ becomes ㄹ'],
    ['같이', '가치', 'Liaison'],
    ['좋다', '조타', 'Aspiration'],
    ['학교', '학꾜', 'Tensing'],
    ['값', '갑', 'Only one can close'],
  ]) {
    test(`${word} reports ${title} alone`, () => {
      assert.deepEqual(titles(word, pron), [title])
    })
  }
})
