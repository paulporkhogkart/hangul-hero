// Time penalties, in one place, because they are quoted on the home page, charged
// during a race and explained on the finish screen, and those three must never disagree.

/**
 * A miss costs more each time. The first is deliberately light, because it is usually a
 * typo rather than not knowing, and the last value repeats for every miss after it.
 */
export const MISS_PENALTY_MS = [1000, 2000, 3000]

/**
 * Buying the answer outright.
 *
 * The hint ladder tops out at the second miss: after that a miss tells you nothing new
 * and simply costs 3s. So this is priced against grinding, not against the hints. At 30s
 * it is worth paying once you would otherwise fail about ten more times, which is
 * roughly the point at which you are not going to get there on your own.
 *
 * It is one number. If it turns out to be the wrong one, this is the only line to change.
 */
export const REVEAL_PENALTY_MS = 30000

export const missCost = n => MISS_PENALTY_MS[Math.min(n, MISS_PENALTY_MS.length - 1)]

/** "1 mistake", "3 mistakes". Nothing is ever "missed", which reads like a noun. */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
