// The jamo listed under a syllable must add up to that syllable's romanization.
//
// They never did. The panel printed dictionary values while the syllable underneath was
// contextual, so 쌓 listed its ㅎ as "t" above a syllable reading "ssa", and 국 listed a
// final "k" above "gu". Every liaison in the list had the same hole.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { breakdown } from '../src/core/breakdown.mjs'

const words = JSON.parse(readFileSync(fileURLToPath(new URL('../data/words.json', import.meta.url)), 'utf8'))

/** What a column claims, read left to right. A moved or silent jamo claims nothing. */
const GIVES_NOTHING_HERE = new Set(['moved', 'fused', 'silent'])
const column = syl => syl.jamo.map(j => (GIVES_NOTHING_HERE.has(j.fate) ? '' : j.rr)).join('')

describe('a syllable is the sum of its jamo', () => {
  test('across the whole shipping word list', () => {
    const bad = []
    for (const w of words) {
      for (const s of breakdown(w.word, w.pron).syllables) {
        if (s.literal) continue
        if (column(s) !== s.rr) {
          bad.push(`${w.word} ${s.char}: jamo say "${column(s)}" but the syllable says "${s.rr}"`)
        }
      }
    }
    assert.deepEqual(bad, [], `${bad.length} syllables disagree with their own jamo:\n  ${bad.slice(0, 15).join('\n  ')}`)
  })
})

describe('the cases that exposed it', () => {
  test('쌓이다: the ㅎ that drops contributes nothing, not a t', () => {
    const [first] = breakdown('쌓이다', '싸이다').syllables
    const h = first.jamo.find(j => j.jamo === 'ㅎ')
    assert.equal(h.fate, 'silent')
    assert.equal(h.rr, '')
    assert.equal(first.rr, 'ssa')
  })

  test('한국어: the ㄱ moves out of 국 and arrives in 어', () => {
    const [, guk, eo] = breakdown('한국어', '한구거').syllables
    assert.equal(guk.jamo.at(-1).fate, 'moved')
    assert.equal(guk.rr, 'gu')
    assert.equal(eo.jamo[0].fate, 'arrived')
    assert.equal(eo.jamo[0].rr, 'g')
    assert.equal(eo.rr, 'geo')
  })

  test('해돋이: the arriving consonant shows what it became, not what it was', () => {
    const [, , i] = breakdown('해돋이', '해도지').syllables
    assert.equal(i.jamo[0].fate, 'arrived')
    assert.equal(i.jamo[0].rr, 'j')
    assert.equal(i.rr, 'ji')
  })

  test('신라: the contextual ll survives, rather than l plus r', () => {
    const [sin, ra] = breakdown('신라', '실라').syllables
    assert.equal(sin.rr + ra.rr, 'silla')
  })

  test('그렇다: the ㅎ fuses forward, and the ㄷ that receives it is a t', () => {
    const [, reo, ta] = breakdown('그렇다', '그러타').syllables
    const h = reo.jamo.find(j => j.jamo === 'ㅎ')
    // Not silent: that ㅎ is the entire reason the next syllable is ta and not da.
    assert.equal(h.fate, 'fused')
    assert.equal(ta.jamo[0].fate, 'changed')
    assert.equal(ta.jamo[0].rr, 't')
    assert.equal(ta.rr, 'ta')
  })

  test('깨끗해지다: a stop fusing forward into a ㅎ reads the same way', () => {
    const [, kkeut, tae] = breakdown('깨끗해지다', '깨끄태지다').syllables
    assert.equal(kkeut.jamo.at(-1).fate, 'fused')
    assert.equal(tae.jamo[0].rr, 't')
  })

  test('an ordinary word is untouched', () => {
    const [sa, ram] = breakdown('사람', '사람').syllables
    assert.equal(sa.jamo.every(j => j.fate === 'kept'), true)
    assert.equal(sa.rr + ram.rr, 'saram')
  })
})
