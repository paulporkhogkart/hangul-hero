// Penalties are quoted on the home page, charged during a race and explained on the
// finish screen. These pin the numbers so those three can never drift apart.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { missCost, MISS_PENALTY_MS, REVEAL_PENALTY_MS, plural } from '../src/core/scoring.mjs'

describe('miss penalties', () => {
  test('the first miss costs 5s', () => assert.equal(missCost(0), 5000))
  test('the second costs 25s, because it reveals nearly the whole answer', () => assert.equal(missCost(1), 25000))

  test('later misses are free, because nothing further is shown', () => {
    for (const n of [2, 3, 5, 20]) assert.equal(missCost(n), 0, `miss ${n + 1} should be free`)
  })

  test('two misses and buying the answer cost about the same', () => {
    // The whole point of the pricing: neither route dominates the other.
    const twoMisses = missCost(0) + missCost(1)
    assert.equal(twoMisses, 30000)
    assert.ok(Math.abs(twoMisses - REVEAL_PENALTY_MS) <= 5000,
      `two misses cost ${twoMisses}ms against a reveal at ${REVEAL_PENALTY_MS}ms`)
  })

  test('the table never runs out of values', () => {
    assert.ok(MISS_PENALTY_MS.length > 0)
    assert.equal(missCost(999), MISS_PENALTY_MS.at(-1))
  })
})

describe('plural', () => {
  test('one mistake, several mistakes', () => {
    assert.equal(plural(1, 'mistake'), '1 mistake')
    assert.equal(plural(3, 'mistake'), '3 mistakes')
    assert.equal(plural(0, 'mistake'), '0 mistakes')
  })
})
