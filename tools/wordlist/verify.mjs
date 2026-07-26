// Cross-check our romanization against Wiktionary's, over the real candidate list.
// Prints a disagreement rate and, more usefully, groups the disagreements so the
// PATTERN is visible rather than a wall of individual words.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { syllableCount } from '../../src/core/hangul.mjs'
import { romanizePronunciation, normalize } from '../../src/core/rr.mjs'

const p = f => fileURLToPath(new URL(f, import.meta.url))
const rows = (await readFile(p('../../data/raw/combined-vocab.tsv'), 'utf8')).split(/\r?\n/).filter(Boolean)
const head = rows.shift().split('\t')
const vocab = rows.map(r => Object.fromEntries(r.split('\t').map((v, i) => [head[i], v])))
const wik = JSON.parse(await readFile(p('../../data/raw/wiktionary-index.json'), 'utf8'))

const CONTENT = new Set(['명사', '동사', '형용사', '부사', '관형사', '대명사', '수사', '고유 명사'])
const strip = w => w.replace(/\d+$/, '')

// One row per distinct word, keeping the best (lowest) frequency rank we saw for it.
const byWord = new Map()
for (const r of vocab) {
  if (!CONTENT.has(r.part_of_speech)) continue
  const w = strip(r.word)
  // No syllable-count floor. 물, 밥, 산 are as real as anything longer; the
  // part-of-speech filter is what keeps particles and endings out.
  if (!/^[가-힣]+$/.test(w)) continue
  const rank = /^\d+$/.test(r.rank) ? Number(r.rank) : Infinity
  const prev = byWord.get(w)
  if (!prev || rank < prev.rank) byWord.set(w, { word: w, rank, pos: r.part_of_speech, level: r.nikl_level, topik: r.topik_level })
}
const candidates = [...byWord.values()].sort((a, b) => a.rank - b.rank)

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(2)}%` : 'n/a')
console.log(`candidate words (content, deduped) : ${candidates.length}`)
const bySyl = new Map()
for (const c of candidates) bySyl.set(syllableCount(c.word), (bySyl.get(syllableCount(c.word)) ?? 0) + 1)
console.log('  by syllable count: ' + [...bySyl].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}=${v}`).join('  '))

// ── join against Wiktionary ────────────────────────────────────────────────
let noEntry = 0, noPron = 0, noRoman = 0, noGloss = 0
const testable = []
for (const c of candidates) {
  const entries = wik[c.word]
  if (!entries) { noEntry++; continue }
  const pron = entries.find(e => e.pron)?.pron ?? null
  const roman = entries.find(e => e.roman)?.roman ?? null
  const gloss = entries.find(e => e.glosses.length)?.glosses ?? null
  if (!pron) noPron++
  if (!roman) noRoman++
  if (!gloss) noGloss++
  if (pron && roman) testable.push({ ...c, pron, roman, gloss })
}

console.log(`\njoin against Wiktionary`)
console.log(`  no entry at all   : ${noEntry.toLocaleString()}  ${pct(noEntry, candidates.length)}`)
console.log(`  entry, no pron    : ${noPron.toLocaleString()}`)
console.log(`  entry, no roman   : ${noRoman.toLocaleString()}`)
console.log(`  entry, no gloss   : ${noGloss.toLocaleString()}`)
console.log(`  fully testable    : ${testable.length.toLocaleString()}  ${pct(testable.length, candidates.length)}`)

// ── the actual comparison ──────────────────────────────────────────────────
const agree = [], differ = []
for (const t of testable) {
  const ours = romanizePronunciation(t.pron).rr
  ;(normalize(ours) === normalize(t.roman) ? agree : differ).push({ ...t, ours })
}

console.log(`\nOUR ROMANIZATION vs WIKTIONARY, over ${testable.length.toLocaleString()} words`)
console.log(`  agree  : ${agree.length.toLocaleString()}  ${pct(agree.length, testable.length)}`)
console.log(`  differ : ${differ.length.toLocaleString()}  ${pct(differ.length, testable.length)}`)

// Group disagreements by the shape of the difference, so systematic bugs stand out
// from genuine one-off editorial disagreements.
const sig = d => {
  const a = normalize(d.ours), b = normalize(d.roman)
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0; while (j < a.length - i && j < b.length - i && a.at(-1 - j) === b.at(-1 - j)) j++
  return `${a.slice(i, a.length - j) || '·'} -> ${b.slice(i, b.length - j) || '·'}`
}
const groups = new Map()
for (const d of differ) {
  const k = sig(d)
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(d)
}

console.log(`\ndisagreements grouped by shape (top 20 of ${groups.size})`)
for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  const ex = list.slice(0, 3).map(d => `${d.word}[${d.pron}] ours=${d.ours} wik=${d.roman}`).join('   ')
  console.log(`  ${String(list.length).padStart(5)}  ${k.padEnd(18)}  ${ex}`)
}

// Does Wiktionary's roman follow the spelling or the pronunciation? Words whose
// pronunciation differs from their spelling settle it.
const changed = testable.filter(t => t.pron !== t.word)
const fromPron = changed.filter(t => normalize(romanizePronunciation(t.pron).rr) === normalize(t.roman)).length
const fromSpelling = changed.filter(t => normalize(romanizePronunciation(t.word).rr) === normalize(t.roman)).length
console.log(`\nwords whose pronunciation differs from their spelling : ${changed.length.toLocaleString()}`)
console.log(`  Wiktionary's roman matches the PRONUNCIATION : ${fromPron.toLocaleString()}  ${pct(fromPron, changed.length)}`)
console.log(`  Wiktionary's roman matches the SPELLING      : ${fromSpelling.toLocaleString()}  ${pct(fromSpelling, changed.length)}`)
