// Every syllable that changes must be accounted for by some rule.
//
// The weaker check this replaces only looked for words with NO rules at all, which is
// why 밟다 shipped unexplained: it reported the tensing on 다 and said nothing about 밟
// losing half its 받침, so it never looked empty. This runs over the whole shipping list
// and asks the harder question, one syllable at a time.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { breakdown } from '../src/core/breakdown.mjs'
import { decomposeWord } from '../src/core/hangul.mjs'

const words = JSON.parse(readFileSync(fileURLToPath(new URL('../data/words.json', import.meta.url)), 'utf8'))

/** Rules that describe a consonant leaving the syllable before them, so they account for
 *  that syllable losing its final as well as for their own arrival. */
const REACHES_BACK = new Set(['liaison', 'insertion', 'palatalisation', 'aspiration'])

/**
 * Per SLOT, not per syllable.
 *
 * Asking only "does any rule mention this syllable" is what let 끝없다 through: the 없
 * both received the ㄷ that left 끝 and reduced its own ㅄ to ㅂ, the liaison rule
 * mentioned the syllable, and the 받침 change was never spoken of.
 */
function unexplained(word) {
  const b = breakdown(word.word, word.pron)
  const sp = decomposeWord(word.word)
  const pr = decomposeWord(b.spoken)
  if (sp.length !== pr.length) return [] // alignment failures are rejected at build time

  const here = new Set()      // a rule sits on this syllable
  const explainsLostFinal = new Set()
  for (const c of b.changes) {
    here.add(c.at)
    if (REACHES_BACK.has(c.type)) explainsLostFinal.add(c.at - 1)
  }

  const gaps = []
  for (let i = 0; i < sp.length; i++) {
    const s = sp[i], p = pr[i]
    if (!s || !p) continue
    if (s.initial !== p.initial && !here.has(i)) gaps.push(`${s.ch} initial ${s.initial} -> ${p.initial}`)
    if (s.vowel !== p.vowel && !here.has(i)) gaps.push(`${s.ch} vowel ${s.vowel} -> ${p.vowel}`)
    if (s.final !== p.final && !here.has(i) && !explainsLostFinal.has(i)) {
      gaps.push(`${s.ch} final ${s.final || 'none'} -> ${p.final || 'none'}`)
    }
  }
  return gaps
}

describe('every changed syllable is explained', () => {
  test('across the whole shipping word list', () => {
    const failures = []
    for (const w of words) {
      const gaps = unexplained(w)
      if (gaps.length) failures.push(`${w.word} [${w.pron}]  unexplained: ${gaps.join(', ')}`)
    }
    assert.deepEqual(failures, [], `${failures.length} words change shape without saying why:\n  ${failures.slice(0, 20).join('\n  ')}`)
  })

  test('끝없다: one syllable, two changes, both spoken for', () => {
    // 없 receives the ㄷ that left 끝 and reduces its own ㅄ to ㅂ. The rules used to be a
    // single chain ending in `continue`, so the arrival won and the 받침 vanished quietly.
    const titles = breakdown('끝없다', '끄덥따').changes.map(c => c.title)
    assert.ok(titles.includes('Liaison'), `expected the arrival to be explained, got ${titles.join(', ')}`)
    assert.ok(titles.includes('Only one can close'), `expected the 받침 to be explained, got ${titles.join(', ')}`)
  })

  test('안다 changes only its second syllable, so tensing is the whole story', () => {
    assert.deepEqual(breakdown('안다', '안따').changes.map(c => c.title), ['Tensing'])
  })

  test('밟다, the exception that got past the weaker check', () => {
    const b = breakdown('밟다', '밥따')
    const titles = b.changes.map(c => c.title)
    assert.ok(titles.includes('Only one can close'), `expected the 받침 rule, got ${titles.join(', ')}`)
    // 넓다 keeps the ㄹ, 밟다 keeps the ㅂ. Both must say which one survived.
    assert.match(b.changes.find(c => c.title === 'Only one can close').text, /ㄹ is dropped and only the ㅂ/)
    assert.match(breakdown('넓다', '널따').changes.find(c => c.title === 'Only one can close').text, /ㅂ is dropped and only the ㄹ/)
  })
})
