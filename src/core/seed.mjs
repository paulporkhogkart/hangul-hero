// Deterministic word selection.
//
// The daily needs everyone who plays it to get byte-identical words, today and in six
// months, on any machine. So selection is a pure function of (seed, pool, count) with
// no reliance on Math.random, insertion order, or locale-dependent sorting.

/** FNV-1a. Turns a seed string into a 32-bit integer. */
export function hashSeed(seed) {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32. Small, fast, and good enough for choosing words. */
export function rng(seedInt) {
  let a = seedInt >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Sample `count` distinct items. Partial Fisher-Yates over a copy, so it is unbiased
 * and costs O(count) rather than shuffling the whole pool for a ten word race.
 */
export function sample(pool, count, seed) {
  const n = Math.min(count, pool.length)
  const next = rng(hashSeed(seed))
  const a = pool.slice()
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(next() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

/**
 * The daily seed. Deliberately derived from the date alone so it can be recomputed
 * from nothing, but stored in the database on first use so that changing this function
 * later cannot retroactively alter a day people have already played.
 */
export const dailySeed = isoDate => `daily-${isoDate}`

/** A run seed for free play. Random, but printable so a run can be shared or replayed. */
export function newSeed(random = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1
  let s = ''
  for (let i = 0; i < 8; i++) s += A[Math.floor(random() * A.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

/** 'YYYY-MM-DD' for a given instant in a given zone. The daily rolls at local midnight. */
export function isoDateIn(zone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
  return parts // en-CA already formats as YYYY-MM-DD
}
