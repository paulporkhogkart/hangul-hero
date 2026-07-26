// The candidate list, derived once and shared by every downstream tool so the
// filtering rules live in exactly one place.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Things you can put on screen alone and read aloud. Particles, endings and
 *  affixes fail that test, so they are the only exclusions. There is no
 *  syllable-count floor: 물 and 밥 are words. */
export const CONTENT_POS = new Set(['명사', '동사', '형용사', '부사', '관형사', '대명사', '수사', '고유 명사'])

/** Trailing digits are 표준국어대사전 homograph indices, not part of the word. */
export const stripHomograph = w => w.replace(/\d+$/, '')

export async function loadCandidates() {
  const src = fileURLToPath(new URL('../../data/raw/combined-vocab.tsv', import.meta.url))
  const rows = (await readFile(src, 'utf8')).split(/\r?\n/).filter(Boolean)
  const head = rows.shift().split('\t')

  const byWord = new Map()
  for (const row of rows) {
    const r = Object.fromEntries(row.split('\t').map((v, i) => [head[i], v]))
    if (!CONTENT_POS.has(r.part_of_speech)) continue
    const word = stripHomograph(r.word)
    if (!/^[가-힣]+$/.test(word)) continue

    const rank = /^\d+$/.test(r.rank) ? Number(r.rank) : Infinity
    const prev = byWord.get(word)
    // Keep the best (lowest) frequency rank seen across the word's homographs.
    if (!prev || rank < prev.rank) {
      byWord.set(word, {
        word,
        rank,
        pos: r.part_of_speech,
        hanja: r.hanja || null,
        niklLevel: r.nikl_level || null,
        topikLevel: r.topik_level || null,
      })
    }
  }
  return [...byWord.values()].sort((a, b) => a.rank - b.rank || a.word.localeCompare(b.word))
}
