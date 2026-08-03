/**
 * The finish-screen board scene, as pure list building.
 *
 * The reveal component feeds this from two sources that overlap and disagree: rows
 * fetched from rank 1 downward (prefetched during the run, paged in afterwards), and
 * the server's neighbourhood around the finished run, which arrives later and may
 * repeat rows the fetch already has. Folding them into one display list is nothing
 * but off-by-one opportunities, which is why it lives here where a test can reach it
 * rather than inside a component.
 */

/**
 * Where a time slots into rows fetched from rank 1, before the server has answered.
 *
 * Only honest when the insertion point is actually inside the fetched rows (or the
 * fetch reached the end of the board): a time slower than everything on the first
 * page could be rank 101 or rank 5,000, so it stays unknown rather than guessing.
 * Ties count as beaten, matching the server, whose rank is one plus the count of
 * strictly faster runs.
 */
export function optimisticRank(rows, durationMs, exhausted) {
  const faster = rows.filter(r => r.duration_ms < durationMs).length
  if (faster < rows.length || exhausted) return faster + 1
  return null
}

/**
 * Flatten everything known so far into one renderable list: contiguous rows from
 * rank 1, then (when the run lands beyond them) a single band standing in for the
 * unloaded middle, the server's neighbourhood, the run itself, and whatever sits
 * below it. Every entry carries its board position, because a CSS counter cannot
 * count across a gap.
 *
 * rank may be null (the server has not answered and the fetched rows cannot place
 * the run): the whole fetch is shown, then a band of unknown size, then the run.
 */
export function buildScene({ rows, rank, above = [], below = [] }) {
  const out = []
  const seen = new Set(rows.map(r => r.id))
  const extraAbove = above.filter(r => !seen.has(r.id))
  const extraBelow = below.filter(r => !seen.has(r.id))

  const cut = rank == null ? rows.length : Math.min(rank - 1, rows.length)
  for (let i = 0; i < cut; i++) out.push({ key: `r${rows[i].id}`, kind: 'row', row: rows[i], pos: i + 1 })

  if (rank == null) {
    if (rows.length) out.push({ key: 'gap', kind: 'gap', count: null })
    out.push({ key: 'you', kind: 'you', pos: null })
    return out
  }

  const gapCount = Math.max(0, (rank - 1) - cut - extraAbove.length)
  if (gapCount > 0) out.push({ key: 'gap', kind: 'gap', count: gapCount })
  extraAbove.forEach((r, j) => out.push({ key: `r${r.id}`, kind: 'row', row: r, pos: rank - extraAbove.length + j }))
  out.push({ key: 'you', kind: 'you', pos: rank })

  // Below the run, the contiguous fetch continues wherever it reaches that far;
  // otherwise the server's neighbourhood is all there is.
  const belowRows = rank - 1 < rows.length ? rows.slice(rank - 1) : extraBelow
  belowRows.forEach((r, j) => out.push({ key: `r${r.id}`, kind: 'row', row: r, pos: rank + 1 + j }))
  return out
}
