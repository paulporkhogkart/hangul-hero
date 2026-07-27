// Some rules live in the ROMANIZATION rather than in the pronunciation.
//
// 떠올리다 is said exactly as it is written, so every spelling-versus-sound check stays
// quiet, yet the answer is tteoollida and not tteoolrida. Comparing the two hangul forms
// could never find that, because nothing about the sound changed.
//
// The general test: wherever a jamo contributes something other than its context-free
// table value, some rule must say why.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { breakdown } from '../src/core/breakdown.mjs'
import { INITIAL_RR, VOWEL_RR, FINAL_RR } from '../src/core/rr.mjs'

const words = JSON.parse(readFileSync(fileURLToPath(new URL('../data/words.json', import.meta.url)), 'utf8'))

const tableValue = j =>
  j.slot === 'initial' ? INITIAL_RR[j.jamo] : j.slot === 'vowel' ? VOWEL_RR[j.jamo] : FINAL_RR[j.jamo]

/** Jamo whose fate already explains why they do not match the table. */
const ACCOUNTED_FOR = new Set(['moved', 'fused', 'silent', 'arrived', 'changed'])

describe('a letter that is not the table value is explained', () => {
  test('across the whole shipping word list', () => {
    const bad = []
    for (const w of words) {
      const b = breakdown(w.word, w.pron)
      const explained = new Set(b.changes.map(c => c.at))
      b.syllables.forEach((s, i) => {
        if (s.literal) return
        for (const j of s.jamo) {
          if (ACCOUNTED_FOR.has(j.fate)) continue
          if (j.rr !== tableValue(j) && !explained.has(i)) {
            bad.push(`${w.word} ${s.char}: ${j.jamo} is written "${j.rr}" but its table value is "${tableValue(j)}"`)
          }
        }
      })
    }
    assert.deepEqual(bad, [], `${bad.length} letters differ from the table with nothing said:\n  ${bad.slice(0, 15).join('\n  ')}`)
  })
})

describe('떠올리다 and the rest of the ㄹㄹ family', () => {
  for (const [word, pron, rr] of [
    ['떠올리다', '떠올리다', 'tteoollida'],
    ['흘리다', '흘리다', 'heullida'],
    ['걸리다', '걸리다', 'geollida'],
    ['빨리', '빨리', 'ppalli'],
  ]) {
    test(`${word} explains its ll`, () => {
      const b = breakdown(word, pron)
      assert.equal(b.rr, rr)
      const rule = b.changes.find(c => c.type === 'doubledR')
      assert.ok(rule, `no rule explains the ll in ${rr}: got ${b.changes.map(c => c.title).join(', ') || 'nothing'}`)
      assert.match(rule.text, /ll and not lr/)
    })
  }

  test('신라 explains both the ㄴ turning into ㄹ and the ll that results', () => {
    const titles = breakdown('신라', '실라').changes.map(c => c.title)
    assert.deepEqual(titles, ['ㄴ becomes ㄹ', 'Two ㄹ become ll'])
  })

  test('a lone ㄹ between vowels is still r, and says nothing', () => {
    const b = breakdown('사람', '사람')
    assert.equal(b.rr, 'saram')
    assert.equal(b.changes.length, 0)
  })
})
