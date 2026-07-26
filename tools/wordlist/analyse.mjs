// Report what is actually in the combined NIKL/TOPIK vocabulary table before we
// build anything on top of it. Prints composition, not conclusions.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../../data/raw/combined-vocab.tsv', import.meta.url))
const rows = (await readFile(SRC, 'utf8')).split(/\r?\n/).filter(Boolean)
const head = rows.shift().split('\t')
const recs = rows.map(r => Object.fromEntries(r.split('\t').map((v, i) => [head[i], v])))

const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`
const bar = n => '#'.repeat(Math.max(1, Math.round(n / 40)))

console.log(`columns : ${head.join(', ')}`)
console.log(`rows    : ${recs.length}\n`)

// ── part of speech ─────────────────────────────────────────────────────────
const byPos = new Map()
for (const r of recs) byPos.set(r.part_of_speech || '(blank)', (byPos.get(r.part_of_speech || '(blank)') ?? 0) + 1)
console.log('part of speech')
for (const [k, v] of [...byPos].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)}  ${pct(v, recs.length).padStart(6)}  ${bar(v)}`)
}

// ── how usable is each field ───────────────────────────────────────────────
console.log('\nfield coverage')
for (const f of head) {
  const n = recs.filter(r => (r[f] ?? '').trim()).length
  console.log(`  ${f.padEnd(16)} ${String(n).padStart(5)} / ${recs.length}  ${pct(n, recs.length).padStart(6)}`)
}

// ── homograph markers and duplicates ───────────────────────────────────────
const HOMOGRAPH = /\d+$/
const marked = recs.filter(r => HOMOGRAPH.test(r.word))
const bare = w => w.replace(HOMOGRAPH, '')
const seen = new Map()
for (const r of recs) seen.set(bare(r.word), (seen.get(bare(r.word)) ?? 0) + 1)
const dupes = [...seen].filter(([, n]) => n > 1)
console.log(`\nhomograph-numbered entries : ${marked.length}  (${pct(marked.length, recs.length)})`)
console.log(`distinct words after stripping : ${seen.size}`)
console.log(`words appearing more than once : ${dupes.length}`)
console.log(`  worst: ${dupes.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, n]) => `${w}(${n})`).join(' ')}`)

// ── ranks ──────────────────────────────────────────────────────────────────
const ranked = recs.filter(r => /^\d+$/.test(r.rank))
const ranks = ranked.map(r => Number(r.rank)).sort((a, b) => a - b)
console.log(`\nranked entries : ${ranked.length} / ${recs.length}  (${pct(ranked.length, recs.length)})`)
console.log(`rank range     : ${ranks[0]} .. ${ranks.at(-1)}`)

// ── the actual question: how many CONTENT words can we get? ────────────────
// Content = something you can meaningfully show alone on a screen and read aloud.
// Affixes, particles, endings and dependent nouns fail that test.
const CONTENT = new Set(['명사', '동사', '형용사', '부사', '관형사', '감탄사', '대명사', '수사'])
const DROP = new Set(['접사', '조사', '어미', '의존명사', '보조동사', '보조형용사'])

const content = recs.filter(r => CONTENT.has(r.part_of_speech))
const dropped = recs.filter(r => DROP.has(r.part_of_speech))
const unclassified = recs.filter(r => !CONTENT.has(r.part_of_speech) && !DROP.has(r.part_of_speech))
console.log(`\ncontent words    : ${content.length}`)
console.log(`explicitly dropped: ${dropped.length}`)
console.log(`unclassified      : ${unclassified.length}  ${[...new Set(unclassified.map(r => r.part_of_speech))].slice(0, 8).join(' ')}`)

// Single-syllable words are poor reading practice: too little to decode.
const syl = w => [...bare(w)].filter(c => c >= '가' && c <= '힣').length
for (const min of [1, 2]) {
  const pool = content.filter(r => syl(r.word) >= min && /^[가-힣]+\d*$/.test(r.word))
  const withRank = pool.filter(r => /^\d+$/.test(r.rank))
  console.log(`\npool, >=${min} syllable, hangul only : ${pool.length}  (of which ranked: ${withRank.length})`)
  const lv = new Map()
  for (const r of pool) lv.set(r.nikl_level || '(none)', (lv.get(r.nikl_level || '(none)') ?? 0) + 1)
  console.log('  by NIKL level: ' + [...lv].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '))
}

// Syllable-length spread of the >=2 pool, which is what we would actually ship.
const ship = content.filter(r => syl(r.word) >= 2 && /^[가-힣]+\d*$/.test(r.word))
const lens = new Map()
for (const r of ship) lens.set(syl(r.word), (lens.get(syl(r.word)) ?? 0) + 1)
console.log('\nsyllable count spread of that pool')
for (const [k, v] of [...lens].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${k} syllables ${String(v).padStart(5)}  ${bar(v)}`)
}
