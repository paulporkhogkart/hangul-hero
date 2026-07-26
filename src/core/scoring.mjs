// Time penalties, in one place, because they are quoted on the home page, charged
// during a race and explained on the finish screen, and those three must never disagree.

/**
 * A miss is charged for what it reveals, and the last value repeats for every miss after
 * it.
 *
 *   1st  +5s   where you went wrong, without saying what is right
 *   2nd  +25s  the jamo and the rules, which in practice is nearly the whole answer
 *   3rd+  free  nothing new is shown, so there is nothing left to charge for
 *
 * The second one is expensive because it is worth nearly as much as buying the answer
 * outright: seeing a word split into its jamo with the sound changes named is most of the
 * way to reading it. Pricing it at a couple of seconds made the paid reveal pointless.
 *
 * Once both hints are spent the game has nothing further to offer, so continuing to
 * punish someone for grinding at a word they have been told everything about is charging
 * for a service that has stopped being provided.
 */
export const MISS_PENALTY_MS = [5000, 25000, 0]

/**
 * Buying the answer outright, without spending an attempt to earn it.
 *
 * Sits just above the 30s that two misses cost, so the two routes are close enough to be
 * a real choice: guess twice and work it out, or pay and be told. Neither dominates.
 *
 * It is one number. If it turns out to be the wrong one, this is the only line to change.
 */
export const REVEAL_PENALTY_MS = 30000

export const missCost = n => MISS_PENALTY_MS[Math.min(n, MISS_PENALTY_MS.length - 1)]

/** "1 mistake", "3 mistakes". Nothing is ever "missed", which reads like a noun. */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
