import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { optimisticRank, buildScene } from '../web/src/lib/scene.mjs'

// Rows as the board endpoints return them, shrunk to what the scene reads.
const row = (id, ms) => ({ id, duration_ms: ms })
const rows = (...ms) => ms.map((m, i) => row(i + 1, m))

const kinds = scene => scene.map(e => e.kind).join(',')
const positions = scene => scene.map(e => e.pos)

describe('optimisticRank', () => {
  test('slots between fetched rows', () => {
    assert.equal(optimisticRank(rows(30000, 40000, 50000), 45000, false), 3)
  })

  test('a tie counts as beaten, matching the server', () => {
    // rankOf is one plus the count of STRICTLY faster runs, so equal times rank equal.
    assert.equal(optimisticRank(rows(30000, 40000), 40000, false), 2)
  })

  test('slower than a complete board is last place, not unknown', () => {
    assert.equal(optimisticRank(rows(30000, 40000), 99000, true), 3)
  })

  test('slower than an incomplete page is unknown, not a guess', () => {
    assert.equal(optimisticRank(rows(30000, 40000), 99000, false), null)
  })

  test('an empty but complete board is rank 1', () => {
    assert.equal(optimisticRank([], 60000, true), 1)
  })
})

describe('buildScene', () => {
  test('a run inside the fetched rows splits them around itself', () => {
    const scene = buildScene({ rows: rows(30000, 40000, 50000), rank: 2 })
    assert.equal(kinds(scene), 'row,you,row,row')
    assert.deepEqual(positions(scene), [1, 2, 3, 4])
    // The row that was second on the fetched board is now third: the run displaced it.
    assert.equal(scene[2].row.id, 2)
  })

  test('a run beyond the fetch gets a band whose count is exactly what is missing', () => {
    const scene = buildScene({
      rows: rows(30000, 31000, 32000),           // ranks 1..3
      rank: 200,
      above: [row(90, 180000), row(91, 181000)], // ranks 198 and 199
      below: [row(92, 200000)],                  // rank 201
    })
    assert.equal(kinds(scene), 'row,row,row,gap,row,row,you,row')
    // 199 runs sit above: 3 fetched, 2 named, so the band stands in for 194.
    assert.equal(scene[3].count, 194)
    assert.deepEqual(positions(scene), [1, 2, 3, undefined, 198, 199, 200, 201])
  })

  test('neighbourhood rows the fetch already has are not shown twice', () => {
    // Rank 5 on a board fetched to depth 6: the server's neighbourhood repeats rows
    // 3, 4 and 6 of the fetch, and only the run itself may separate them.
    const fetched = rows(30000, 31000, 32000, 33000, 35000, 36000)
    const scene = buildScene({
      rows: fetched,
      rank: 5,
      above: [row(3, 32000), row(4, 33000)],
      below: [row(5, 35000)],
    })
    assert.equal(kinds(scene), 'row,row,row,row,you,row,row')
    assert.deepEqual(positions(scene), [1, 2, 3, 4, 5, 6, 7])
  })

  test('a band of zero rows vanishes instead of rendering an empty lie', () => {
    // Rank 6 against a fetch of 3 with the neighbourhood covering 4 and 5 exactly.
    const scene = buildScene({
      rows: rows(30000, 31000, 32000),
      rank: 6,
      above: [row(80, 40000), row(81, 41000)],
      below: [],
    })
    assert.equal(kinds(scene), 'row,row,row,row,row,you')
    assert.deepEqual(positions(scene), [1, 2, 3, 4, 5, 6])
  })

  test('an unknown rank shows the fetch, an unnumbered band, then the run', () => {
    const scene = buildScene({ rows: rows(30000, 31000), rank: null })
    assert.equal(kinds(scene), 'row,row,gap,you')
    assert.equal(scene[2].count, null)
    assert.equal(scene[3].pos, null)
  })

  test('an empty board is just the run, with no band pretending otherwise', () => {
    const scene = buildScene({ rows: [], rank: 1 })
    assert.equal(kinds(scene), 'you')
    assert.equal(scene[0].pos, 1)
  })

  test('last place on a complete board keeps every row above the run', () => {
    const scene = buildScene({ rows: rows(30000, 31000), rank: 3 })
    assert.equal(kinds(scene), 'row,row,you')
    assert.deepEqual(positions(scene), [1, 2, 3])
  })

  test('keys are unique even when sources overlap', () => {
    const scene = buildScene({
      rows: rows(30000, 31000, 32000),
      rank: 5,
      above: [row(2, 31000), row(50, 33000)],
      below: [row(3, 32000), row(51, 40000)],
    })
    const keys = scene.map(e => e.key)
    assert.equal(new Set(keys).size, keys.length)
  })
})
