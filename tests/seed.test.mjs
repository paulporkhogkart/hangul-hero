import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sample, hashSeed, rng, newSeed, isoDateIn, dailySeed } from '../src/core/seed.mjs'

const POOL = Array.from({ length: 500 }, (_, i) => `w${i}`)

describe('seeded selection', () => {
  test('the same seed gives the same words', () => {
    assert.deepEqual(sample(POOL, 25, 'daily-2026-07-26'), sample(POOL, 25, 'daily-2026-07-26'))
  })

  test('a different seed gives different words', () => {
    assert.notDeepEqual(sample(POOL, 25, 'daily-2026-07-26'), sample(POOL, 25, 'daily-2026-07-27'))
  })

  test('no word appears twice in one run', () => {
    const got = sample(POOL, 100, 'ABCD-2345')
    assert.equal(new Set(got).size, got.length)
  })

  test('asking for more than the pool holds returns the whole pool', () => {
    assert.equal(sample(POOL, 9999, 'x').length, POOL.length)
  })

  test('selection does not depend on pool identity, only on order', () => {
    // Guards against anything sneaking in that keys off object references.
    assert.deepEqual(sample(POOL.slice(), 10, 's'), sample(POOL.slice(), 10, 's'))
  })

  test('every mode length works', () => {
    for (const n of [10, 25, 50, 100, 250, 500]) assert.equal(sample(POOL, n, 'seed').length, n)
  })
})

describe('rng', () => {
  test('stays inside [0, 1)', () => {
    const next = rng(hashSeed('anything'))
    for (let i = 0; i < 10000; i++) {
      const v = next()
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`)
    }
  })

  test('distribution is not obviously skewed', () => {
    const next = rng(hashSeed('spread'))
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 100000; i++) buckets[Math.floor(next() * 10)]++
    for (const b of buckets) assert.ok(b > 8000 && b < 12000, `lumpy bucket: ${b}`)
  })
})

describe('seeds and dates', () => {
  test('run seeds avoid visually ambiguous characters', () => {
    let r = 0
    const fake = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
    for (let i = 0; i < 200; i++) assert.ok(!/[IO01]/.test(newSeed(fake)))
  })

  test('daily seed depends only on the date', () => {
    assert.equal(dailySeed('2026-07-26'), dailySeed('2026-07-26'))
    assert.notEqual(dailySeed('2026-07-26'), dailySeed('2026-07-27'))
  })

  test('the date rolls in the configured zone, not in UTC', () => {
    // 23:30 in London on the 26th is already the 27th in Seoul.
    const at = new Date('2026-07-26T22:30:00Z')
    assert.equal(isoDateIn('Europe/London', at), '2026-07-26')
    assert.equal(isoDateIn('Asia/Seoul', at), '2026-07-27')
  })
})
