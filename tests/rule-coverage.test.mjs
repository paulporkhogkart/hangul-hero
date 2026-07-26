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
 *  a change on that syllable as well as their own. */
const REACHES_BACK = new Set(['liaison', 'insertion', 'palatalisation', 'aspiration'])

function unexplained(word) {
  const b = breakdown(word.word, word.pron)
  const sp = decomposeWord(word.word)
  const pr = decomposeWord(b.spoken)
  if (sp.length !== pr.length) return [] // alignment failures are rejected at build time

  const covered = new Set()
  for (const c of b.changes) {
    covered.add(c.at)
    if (REACHES_BACK.has(c.type)) covered.add(c.at - 1)
  }

  const gaps = []
  for (let i = 0; i < sp.length; i++) {
    if (!sp[i] || !pr[i]) continue
    if (sp[i].ch !== pr[i].ch && !covered.has(i)) gaps.push(`${sp[i].ch} -> ${pr[i].ch}`)
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

  test('밟다, the exception that got past the weaker check', () => {
    const b = breakdown('밟다', '밥따')
    const titles = b.changes.map(c => c.title)
    assert.ok(titles.includes('Only one can close'), `expected the 받침 rule, got ${titles.join(', ')}`)
    // 넓다 keeps the ㄹ, 밟다 keeps the ㅂ. Both must say which one survived.
    assert.match(b.changes.find(c => c.title === 'Only one can close').text, /ㄹ is dropped and only the ㅂ/)
    assert.match(breakdown('넓다', '널따').changes.find(c => c.title === 'Only one can close').text, /ㅂ is dropped and only the ㄹ/)
  })
})
