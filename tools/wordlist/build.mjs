// Turn the cached 국립국어원 responses into the shipping word list, and put anything
// that cannot be verified into a review queue instead of into the game.
//   node tools/wordlist/build.mjs
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCandidates } from './candidates.mjs'
import { romanize, romanizePronunciation, toWrittenForm, normalize, variantsAreAmbiguous, splitVariants, isNominal } from '../../src/core/rr.mjs'
import { syllableCount } from '../../src/core/hangul.mjs'

const p = f => fileURLToPath(new URL(f, import.meta.url))
const CACHE = p('../../data/cache/krdict')
const OUT = p('../../data')

// ── minimal XML reading, enough for this one well-formed feed ───────────────
const cdata = s => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim()
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? cdata(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) : null
}
const blocks = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1])

const GRADE_ORDER = { '초급': 0, '중급': 1, '고급': 2 }
const gradeRank = g => GRADE_ORDER[g] ?? 3

/** Pick the entry a learner would actually mean: most basic grade, and one that
 *  carries both a pronunciation and an English translation.
 *
 *  `want` is not optional. The API's method=exact still returns entries that merely
 *  contain the query, so asking for 하다 comes back with 가까이하다 among the results.
 *  Without this check we would happily attach one word's pronunciation to another. */
function pickEntry(xml, want) {
  const items = blocks(xml, 'item').filter(it => tag(it, 'word') === want).map(it => {
    const senses = blocks(it, 'sense').map(s => ({
      order: Number(tag(s, 'sense_order') ?? 0),
      definition: tag(s, 'definition'),
      transWord: tag(s, 'trans_word'),
      transDfn: tag(s, 'trans_dfn'),
    }))
    return {
      targetCode: tag(it, 'target_code'),
      word: tag(it, 'word'),
      supNo: Number(tag(it, 'sup_no') ?? 0),
      hanja: tag(it, 'origin'),
      pron: tag(it, 'pronunciation'),
      grade: tag(it, 'word_grade'),
      pos: tag(it, 'pos'),
      senses,
    }
  })
  if (!items.length) return { entry: null, count: 0 }
  const usable = items.filter(i => i.pron && i.senses.some(s => s.transWord))
  const pool = usable.length ? usable : items
  pool.sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.supNo - b.supNo)
  return { entry: pool[0], count: items.length }
}

// ── load everything ────────────────────────────────────────────────────────
const candidates = await loadCandidates()
const byWord = new Map(candidates.map(c => [c.word, c]))
const files = (await readdir(CACHE)).filter(f => f.endsWith('.xml'))
let wik = {}
try { wik = JSON.parse(await readFile(p('../../data/raw/wiktionary-index.json'), 'utf8')) } catch {}

const words = []
const review = []
const stats = { noCache: 0, noItem: 0, noPron: 0, noGloss: 0, ambiguous: 0, ambiguousPron: 0, lenMismatch: 0, ok: 0 }

for (const c of candidates) {
  const file = join(CACHE, `${encodeURIComponent(c.word)}.xml`)
  let xml
  try { xml = await readFile(file, 'utf8') } catch { stats.noCache++; continue }

  const { entry, count } = pickEntry(xml, c.word)
  if (!entry) { stats.noItem++; review.push({ word: c.word, why: 'not in the dictionary' }); continue }
  if (!entry.pron) { stats.noPron++; review.push({ word: c.word, why: 'no published pronunciation' }); continue }

  const sense = entry.senses.find(s => s.transWord) ?? entry.senses[0]
  if (!sense?.transWord) { stats.noGloss++; review.push({ word: c.word, why: 'no English translation' }); continue }

  // The 체언 exception needs the part of speech, so it has to be decided here where we
  // have it, not inside the romanizer.
  const nominal = isNominal(entry.pos ?? c.pos)

  // toWrittenForm falls back to the raw pronunciation when it cannot align the two
  // syllable by syllable. That fallback is not safe to ship, so flag it instead.
  const written = toWrittenForm(c.word, entry.pron, { nominal })
  if (syllableCount(written) !== syllableCount(c.word)) {
    stats.lenMismatch++
    review.push({ word: c.word, pron: entry.pron, why: 'pronunciation does not align with spelling' })
    continue
  }

  // Two permitted pronunciations that romanize differently, with nothing in the statute
  // preferring either. Both are officially correct, so the game accepts both rather
  // than marking a player wrong for choosing the variant we happened not to sort first.
  const ambiguous = variantsAreAmbiguous(c.word, entry.pron)
  if (ambiguous) stats.ambiguousPron++

  const { rr, syllables } = romanize(c.word, entry.pron, { nominal })
  if (!rr || /[^a-z]/i.test(rr)) {
    review.push({ word: c.word, pron: entry.pron, rr, why: 'romanization produced non-latin output' })
    continue
  }

  // Independent opinions, kept for the verification pass rather than used as truth.
  const wikEntries = wik[c.word] ?? []
  const wikRoman = wikEntries.find(e => e.roman)?.roman ?? null
  const wikPron = wikEntries.find(e => e.pron)?.pron ?? null

  if (count > 1) stats.ambiguous++
  stats.ok++
  // Everything the checker will treat as correct. Normally just the canonical answer;
  // for a word with two officially permitted pronunciations, both of them.
  const accept = [...new Set(
    ambiguous
      ? splitVariants(entry.pron).map(v => romanizePronunciation(toWrittenForm(c.word, v, { nominal })).rr)
      : [rr],
  )]

  words.push({
    word: c.word,
    rr,
    accept,
    pron: entry.pron,
    written,
    meaning: sense.transWord,
    definition: sense.transDfn ?? null,
    pos: entry.pos ?? c.pos,
    grade: entry.grade ?? null,
    rank: Number.isFinite(c.rank) ? c.rank : null,
    hanja: entry.hanja ?? c.hanja ?? null,
    syllables: syllableCount(c.word),
    targetCode: entry.targetCode,
    homographs: count,
    xref: { wikRoman, wikPron },
  })
}

await mkdir(OUT, { recursive: true })
await writeFile(join(OUT, 'words.json'), JSON.stringify(words, null, 1))
await writeFile(join(OUT, 'review-queue.json'), JSON.stringify(review, null, 1))

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a')
console.log(`candidates                 : ${candidates.length.toLocaleString()}`)
console.log(`  no cached response       : ${stats.noCache.toLocaleString()}`)
console.log(`  not in the dictionary    : ${stats.noItem.toLocaleString()}`)
console.log(`  no published pronunciation: ${stats.noPron.toLocaleString()}`)
console.log(`  no English translation   : ${stats.noGloss.toLocaleString()}`)
console.log(`  could not align          : ${stats.lenMismatch.toLocaleString()}`)
console.log(`  ambiguous pronunciation  : ${stats.ambiguousPron.toLocaleString()}`)
console.log(`\nBUILT : ${words.length.toLocaleString()}  (${pct(words.length, candidates.length)} of candidates)`)
console.log(`  of which have homographs : ${stats.ambiguous.toLocaleString()}  (a sense was chosen for them)`)

const byGrade = new Map(), bySyl = new Map()
for (const w of words) {
  byGrade.set(w.grade ?? '(none)', (byGrade.get(w.grade ?? '(none)') ?? 0) + 1)
  bySyl.set(w.syllables, (bySyl.get(w.syllables) ?? 0) + 1)
}
console.log(`\nby official grade : ` + [...byGrade].sort((a, b) => gradeRank(a[0]) - gradeRank(b[0])).map(([k, v]) => `${k}=${v}`).join('  '))
console.log(`by syllables      : ` + [...bySyl].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}=${v}`).join('  '))

// ── cross-check against the independent sources ────────────────────────────
const withWik = words.filter(w => w.xref.wikRoman)
const agreeRoman = withWik.filter(w => normalize(w.rr) === normalize(w.xref.wikRoman))
console.log(`\nCROSS-CHECK vs Wiktionary romanization, over ${withWik.length.toLocaleString()} words`)
console.log(`  agree  : ${agreeRoman.length.toLocaleString()}  ${pct(agreeRoman.length, withWik.length)}`)
console.log(`  differ : ${(withWik.length - agreeRoman.length).toLocaleString()}`)

// The cross-check has to run the other source through the SAME pipeline, nominal flag
// included, or every 체언 shows up as a disagreement with itself.
const nominalOf = w => isNominal(w.pos)
const throughPipeline = w => normalize(romanizePronunciation(toWrittenForm(w.word, w.xref.wikPron, { nominal: nominalOf(w) })).rr)

const withWikPron = words.filter(w => w.xref.wikPron)
const agreePron = withWikPron.filter(w => throughPipeline(w) === normalize(w.rr))
console.log(`\nCROSS-CHECK vs Wiktionary pronunciation (put through the same pipeline), over ${withWikPron.length.toLocaleString()}`)
console.log(`  agree  : ${agreePron.length.toLocaleString()}  ${pct(agreePron.length, withWikPron.length)}`)
console.log(`  differ : ${(withWikPron.length - agreePron.length).toLocaleString()}`)

const disagreements = withWikPron.filter(w => throughPipeline(w) !== normalize(w.rr))
await writeFile(join(OUT, 'disagreements.json'), JSON.stringify(
  disagreements.map(w => ({ word: w.word, ours: w.rr, niklPron: w.pron, wikPron: w.xref.wikPron, wikRoman: w.xref.wikRoman })), null, 1))
console.log(`\nwrote data/words.json, data/review-queue.json (${review.length.toLocaleString()}), data/disagreements.json (${disagreements.length.toLocaleString()})`)
