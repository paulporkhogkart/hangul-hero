// Stream the 186MB Wiktionary extraction down to just what we need, keyed by word.
// Also reports which keys actually appear inside `sounds`, so the extraction below
// is based on what the data contains rather than on what I assumed it contains.
import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../../data/raw/wiktionary-korean.jsonl', import.meta.url))
const OUT = fileURLToPath(new URL('../../data/raw/wiktionary-index.json', import.meta.url))

const HANGUL_ONLY = /^[가-힣]+$/
// North Korean pronunciations differ; we want the South Korean standard only.
const NORTH = /North|Pyongyang|NK/i

const soundKeys = new Map()
const posSeen = new Map()
const index = new Map()
let lines = 0, korean = 0, kept = 0

const rl = createInterface({ input: createReadStream(SRC, 'utf8'), crlfDelay: Infinity })
for await (const line of rl) {
  lines++
  if (!line) continue
  let rec
  try { rec = JSON.parse(line) } catch { continue }
  if (rec.lang_code !== 'ko') continue
  korean++
  if (!HANGUL_ONLY.test(rec.word ?? '')) continue

  for (const s of rec.sounds ?? []) for (const k of Object.keys(s)) soundKeys.set(k, (soundKeys.get(k) ?? 0) + 1)
  posSeen.set(rec.pos, (posSeen.get(rec.pos) ?? 0) + 1)

  // Pronunciation, post sound-change, written in hangul. Wiktionary brackets it.
  let pron = null, ipa = null, roman = null
  for (const s of rec.sounds ?? []) {
    const tags = (s.tags ?? []).join(' ')
    if (NORTH.test(tags)) continue
    if (!pron && s.other && /^\[[가-힣ː\s]+\]$/.test(s.other)) pron = s.other.replace(/^\[|\]$/g, '').trim()
    if (!pron && s.hangeul && HANGUL_ONLY.test(s.hangeul)) pron = s.hangeul
    if (!ipa && s.ipa) ipa = s.ipa
    if (!roman && s.roman) roman = s.roman
  }
  if (!roman) roman = (rec.forms ?? []).find(f => (f.tags ?? []).includes('romanization'))?.form ?? null

  const glosses = []
  for (const sense of rec.senses ?? []) {
    for (const g of sense.glosses ?? []) {
      // Skip pure cross-reference senses; they read badly as an on-screen meaning.
      if (/^(alternative (form|spelling)|synonym of|hanja form of|obsolete|archaic|misspelling)/i.test(g)) continue
      if (!glosses.includes(g)) glosses.push(g)
    }
    if (glosses.length >= 4) break
  }

  const entry = { pos: rec.pos, glosses, pron, ipa, roman }
  const prev = index.get(rec.word)
  if (!prev) { index.set(rec.word, [entry]); kept++ }
  else prev.push(entry)
}

await writeFile(OUT, JSON.stringify(Object.fromEntries(index), null, 0))

const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`
console.log(`lines            : ${lines.toLocaleString()}`)
console.log(`korean entries   : ${korean.toLocaleString()}`)
console.log(`hangul-only words: ${kept.toLocaleString()} distinct`)
console.log(`\nkeys found inside "sounds" (frequency across corpus)`)
for (const [k, v] of [...soundKeys].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v.toLocaleString()}`)

const withPron = [...index.values()].filter(es => es.some(e => e.pron)).length
const withGloss = [...index.values()].filter(es => es.some(e => e.glosses.length)).length
const withRoman = [...index.values()].filter(es => es.some(e => e.roman)).length
console.log(`\ncoverage across the ${kept.toLocaleString()} distinct words`)
console.log(`  pronunciation : ${withPron.toLocaleString()}  ${pct(withPron, kept)}`)
console.log(`  english gloss : ${withGloss.toLocaleString()}  ${pct(withGloss, kept)}`)
console.log(`  romanization  : ${withRoman.toLocaleString()}  ${pct(withRoman, kept)}`)

console.log(`\nparts of speech`)
for (const [k, v] of [...posSeen].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(k).padEnd(14)} ${v.toLocaleString()}`)
