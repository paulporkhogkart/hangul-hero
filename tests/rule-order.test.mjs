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
    // 잎 also closes its own ㅍ as ㅂ, which went unreported while one rule per syllable
    // was the limit. What matters here is the ORDER of the two that form the chain.
    const t = titles('꽃잎', '꼰닙')
    assert.ok(t.indexOf('Inserted ㄴ') < t.indexOf('Nasal assimilation'), t.join(' | '))
    assert.ok(t.includes('Closing sound'), `expected 잎 to explain its ㅍ, got ${t.join(' | ')}`)
  })

  test('색연필: same chain, different consonants', () => {
    assert.deepEqual(titles('색연필', '생년필'), ['Inserted ㄴ', 'Nasal assimilation'])
  })

  test('수없이: the consonant moves before it tenses in its new home', () => {
    assert.deepEqual(titles('수없이', '수업씨'), ['Liaison', 'Tensing'])
  })

  test('닫히다: the ㄷ fuses with the ㅎ before the result meets the ㅣ', () => {
    // Two rules, not one. The ㄷ never touches the ㅣ, and saying it "lands directly in
    // front of" it put a whole consonant out of existence.
    assert.deepEqual(titles('닫히다', '다치다'), ['Aspiration', 'Palatalisation'])
  })

  test('올여름 names the intermediate 녀 rather than jumping to 려', () => {
    // The inserted consonant is a ㄴ. Announcing that a ㄴ appeared and therefore the
    // syllable reads 려 skips the very step the next sentence goes back to explain.
    const rule = breakdown('올여름', '올려름').changes.find(c => c.type === 'insertion')
    assert.match(rule.text, /여 first becomes 녀/)
    assert.match(rule.text, /녀 is read as 려/)
  })

  test('꽃잎 stops at 닙 and does not promise a step that never comes', () => {
    const rule = breakdown('꽃잎', '꼰닙').changes.find(c => c.type === 'insertion')
    assert.match(rule.text, /잎 is read as 닙/)
    assert.doesNotMatch(rule.text, /first becomes/)
  })

  test('붙이다 needs no aspiration, so it reports palatalisation alone', () => {
    assert.deepEqual(titles('붙이다', '부치다'), ['Palatalisation'])
  })

  test('맞히다 is aspiration alone, because ㅈ plus ㅎ is already ㅊ', () => {
    assert.deepEqual(titles('맞히다', '마치다'), ['Aspiration'])
  })
})

describe('the trigger is named as it is said, not as it is written', () => {
  test('독립 blames the ㄴ of 닙, because 립 contains no ㄴ', () => {
    const [, nasal] = breakdown('독립', '동닙').changes
    assert.match(nasal.text, /ㄴ of 닙/)
    assert.doesNotMatch(nasal.text, /ㄴ (starting|of) 립/)
  })

  test('꽃잎 likewise blames the ㄴ of 닙', () => {
    // Found by title rather than position: a syllable can carry several rules now, so an
    // index is not a stable way to name one.
    const nasal = breakdown('꽃잎', '꼰닙').changes.find(c => c.title === 'Nasal assimilation')
    assert.match(nasal.text, /ㄴ of 닙/)
  })
})

describe('single rule words are unaffected by the ordering', () => {
  for (const [word, pron, title] of [
    ['한국어', '한구거', 'Liaison'],
    // 신라 has moved out of this list: it now also explains the ll that its own ㄴ to ㄹ
    // change produces, which is two rules and covered in the ㄹㄹ suite instead.
    // The statute lists 같이 under 구개음화, and it is not plain liaison: the consonant
    // changes as it crosses. This assertion used to say Liaison and was wrong.
    ['같이', '가치', 'Palatalisation'],
    ['해돋이', '해도지', 'Palatalisation'],
    ['좋다', '조타', 'Aspiration'],
    ['학교', '학꾜', 'Tensing'],
    ['값', '갑', 'Only one can close'],
  ]) {
    test(`${word} reports ${title} alone`, () => {
      assert.deepEqual(titles(word, pron), [title])
    })
  }
})
