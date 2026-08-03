// SQLite via node:sqlite, so there is no native module to compile on the Pi.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA = fileURLToPath(new URL('./schema.sql', import.meta.url))

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(readFileSync(SCHEMA, 'utf8'))
  migrate(db)
  return wrap(db)
}

/** CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so columns
 *  added later have to be applied by hand. Keyed on what the table actually has rather
 *  than on a version number, which cannot drift out of step with reality. */
function migrate(db) {
  const columns = new Set(db.prepare(`PRAGMA table_info(runs)`).all().map(c => c.name))
  if (!columns.has('grade')) db.exec(`ALTER TABLE runs ADD COLUMN grade TEXT`)

  // attempts shipped before substitutions were recorded, so a deployed database has
  // the table without the column and CREATE TABLE IF NOT EXISTS will not add it.
  const attempts = new Set(db.prepare(`PRAGMA table_info(attempts)`).all().map(c => c.name))
  if (!attempts.has('subs')) db.exec(`ALTER TABLE attempts ADD COLUMN subs TEXT`)
}

const now = () => Date.now()

function wrap(db) {
  const q = {
    upsertUser: db.prepare(`
      INSERT INTO users (id, provider, provider_id, display_name, avatar_url, email, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        avatar_url   = excluded.avatar_url,
        email        = COALESCE(excluded.email, users.email),
        last_seen_at = excluded.last_seen_at`),

    getUser: db.prepare(`SELECT * FROM users WHERE id = ?`),

    createSession: db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`),
    getSession: db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`),
    dropSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    sweepSessions: db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),

    insertRun: db.prepare(`
      INSERT INTO runs (user_id, mode, grade, daily_date, seed, elapsed_ms, penalty_ms, duration_ms,
                        misses, peeks, device, finished_at, claim_token, claim_expires)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),

    insertRunWord: db.prepare(`
      INSERT INTO run_words (run_id, idx, word, answer, ms, misses, peeked)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),

    claimRun: db.prepare(`
      UPDATE runs SET user_id = ?, claim_token = NULL, claim_expires = NULL
      WHERE claim_token = ? AND claim_expires > ? AND user_id IS NULL`),

    demoteDaily: db.prepare(`UPDATE runs SET daily_date = NULL WHERE id = ?`),

    runByClaim: db.prepare(`SELECT * FROM runs WHERE claim_token = ?`),
    runById: db.prepare(`SELECT * FROM runs WHERE id = ?`),
    runWords: db.prepare(`SELECT * FROM run_words WHERE run_id = ? ORDER BY idx`),

    // Pinball board: every run is its own row, so one player can hold several places.
    //
    // There is deliberately no level filter. The 국립국어원 grades were measured against
    // the whole word list and turned out to predict how RARE a word is, not how hard it
    // is to read: advanced words carried fewer sound changes than beginner ones. Slicing
    // the boards by a property the game does not test only thinned them out.
    board: db.prepare(`
      SELECT r.id, r.duration_ms, r.elapsed_ms, r.penalty_ms, r.misses, r.peeks, r.device,
             r.grade, r.finished_at, u.id AS user_id, u.display_name, u.avatar_url
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.mode = ? AND r.daily_date IS NULL      ORDER BY r.duration_ms ASC, r.finished_at ASC
      LIMIT ? OFFSET ?`),

    boardMine: db.prepare(`
      SELECT r.id, r.duration_ms, r.elapsed_ms, r.penalty_ms, r.misses, r.peeks, r.device,
             r.grade, r.finished_at, u.id AS user_id, u.display_name, u.avatar_url
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.mode = ? AND r.daily_date IS NULL        AND r.user_id = ?
      ORDER BY r.duration_ms ASC, r.finished_at ASC
      LIMIT ? OFFSET ?`),

    // One best row per player, for when you want the social view rather than the wall.
    boardBest: db.prepare(`
      SELECT r.id, r.duration_ms, r.elapsed_ms, r.penalty_ms, r.misses, r.peeks, r.device,
             r.grade, r.finished_at, u.id AS user_id, u.display_name, u.avatar_url
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.mode = ? AND r.daily_date IS NULL        AND r.duration_ms = (SELECT MIN(duration_ms) FROM runs x
                             WHERE x.user_id = r.user_id AND x.mode = r.mode AND x.daily_date IS NULL)
      GROUP BY r.user_id
      ORDER BY r.duration_ms ASC, r.finished_at ASC
      LIMIT ? OFFSET ?`),

    dailyBoard: db.prepare(`
      SELECT r.id, r.duration_ms, r.elapsed_ms, r.penalty_ms, r.misses, r.peeks, r.device,
             r.finished_at, u.id AS user_id, u.display_name, u.avatar_url
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.daily_date = ? AND r.mode = ?
      ORDER BY r.duration_ms ASC, r.finished_at ASC
      LIMIT ? OFFSET ?`),

    // How many rows a board has in total. A page of rows cannot say how much it left
    // out, and the finish screen needs exactly that number: it fakes the middle of a
    // long board and owes the player an honest count of what it skipped.
    boardCountAll: db.prepare(`
      SELECT COUNT(*) AS n FROM runs
      WHERE mode = ? AND daily_date IS NULL AND user_id IS NOT NULL`),

    boardCountMine: db.prepare(`
      SELECT COUNT(*) AS n FROM runs
      WHERE mode = ? AND daily_date IS NULL AND user_id = ?`),

    boardCountBest: db.prepare(`
      SELECT COUNT(DISTINCT user_id) AS n FROM runs
      WHERE mode = ? AND daily_date IS NULL AND user_id IS NOT NULL`),

    dailyBoardCount: db.prepare(`
      SELECT COUNT(*) AS n FROM runs
      WHERE daily_date = ? AND mode = ? AND user_id IS NOT NULL`),

    // Where a given time would land, without needing the whole board. Ranked against the
    // same level it was played at, or it would be comparing different contests.
    rankOf: db.prepare(`
      SELECT COUNT(*) AS n FROM runs
      WHERE mode = ? AND daily_date IS NULL AND user_id IS NOT NULL AND duration_ms < ?`),

    nextAbove: db.prepare(`
      SELECT r.duration_ms, u.display_name FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.mode = ? AND r.daily_date IS NULL AND r.duration_ms < ?
             ORDER BY r.duration_ms DESC LIMIT 1`),

    // The caller excludes the run it is asking on behalf of: standings are computed
    // after the run is recorded, and a "best" that included the run itself could never
    // be beaten by it.
    personalBest: db.prepare(`
      SELECT MIN(duration_ms) AS best FROM runs
      WHERE user_id = ? AND mode = ? AND daily_date IS NULL AND id <> ?`),

    dailyPlayed: db.prepare(`
      SELECT 1 FROM runs WHERE user_id = ? AND daily_date = ? AND mode = ? LIMIT 1`),

    dailyRankOf: db.prepare(`
      SELECT COUNT(*) AS n FROM runs
      WHERE daily_date = ? AND mode = ? AND user_id IS NOT NULL AND duration_ms < ?`),

    // The rows either side of a time, so a finished run can be shown in context rather
    // than as a bare number. A rank with nobody attached to it says nothing about how
    // close you were to anyone.
    aboveFree: db.prepare(`
      SELECT r.id, r.duration_ms, r.misses, r.peeks, r.device, r.finished_at,
             u.id AS user_id, u.display_name, u.avatar_url
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.mode = ? AND r.daily_date IS NULL        AND r.duration_ms < ? AND r.id <> ?
      ORDER BY r.duration_ms DESC LIMIT ?`),

    belowFree: db.prepare(`
      SELECT r.id, r.duration_ms, r.misses, r.peeks, r.device, r.finished_at,
             u.id AS user_id, u.display_name, u.avatar_url
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.mode = ? AND r.daily_date IS NULL        AND r.duration_ms >= ? AND r.id <> ?
      ORDER BY r.duration_ms ASC LIMIT ?`),

    aboveDaily: db.prepare(`
      SELECT r.id, r.duration_ms, r.misses, r.peeks, r.device, r.finished_at,
             u.id AS user_id, u.display_name, u.avatar_url
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.daily_date = ? AND r.mode = ? AND r.duration_ms < ? AND r.id <> ?
      ORDER BY r.duration_ms DESC LIMIT ?`),

    belowDaily: db.prepare(`
      SELECT r.id, r.duration_ms, r.misses, r.peeks, r.device, r.finished_at,
             u.id AS user_id, u.display_name, u.avatar_url
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.daily_date = ? AND r.mode = ? AND r.duration_ms >= ? AND r.id <> ?
      ORDER BY r.duration_ms ASC LIMIT ?`),

    getDaily: db.prepare(`SELECT * FROM dailies WHERE date = ?`),
    putDaily: db.prepare(`INSERT OR IGNORE INTO dailies (date, seed, created_at) VALUES (?, ?, ?)`),

    sweepClaims: db.prepare(`DELETE FROM runs WHERE user_id IS NULL AND claim_expires <= ?`),

    insertAttempt: db.prepare(`
      INSERT INTO attempts (user_id, word, mode, focus, ms, misses, peeked, rules, jamo, subs, kinds, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),

    attemptsFor: db.prepare(`
      SELECT word, ms, misses, peeked, rules, jamo, subs, kinds, at FROM attempts
      WHERE user_id = ? AND at > ? ORDER BY at DESC LIMIT ?`),

    firstAttemptAt: db.prepare(`SELECT MIN(at) AS t FROM attempts WHERE user_id = ?`),

    // The pre-feature history: per-word rows from completed runs, used only for runs
    // finished before this user's first attempts row so nothing is counted twice.
    historyWords: db.prepare(`
      SELECT rw.word, rw.misses, rw.peeked, r.finished_at AS at
      FROM run_words rw JOIN runs r ON r.id = rw.run_id
      WHERE r.user_id = ? AND r.finished_at < ?
      ORDER BY r.finished_at DESC LIMIT ?`),

    sweepAttempts: db.prepare(`DELETE FROM attempts WHERE at <= ?`),
  }

  return {
    raw: db,

    upsertUser(u) {
      q.upsertUser.run(u.id, u.provider, u.providerId, u.displayName, u.avatarUrl ?? null, u.email ?? null, now(), now())
      return q.getUser.get(u.id)
    },

    createSession(token, userId, ttlMs) {
      q.createSession.run(token, userId, now(), now() + ttlMs)
    },
    userForSession: token => (token ? q.getSession.get(token, now()) ?? null : null),
    dropSession: token => q.dropSession.run(token),

    /** Writes the run and its per-word rows in one transaction, so a crash midway
     *  cannot leave a run with half its words. */
    recordRun(run, words) {
      const tx = db.prepare('BEGIN')
      tx.run()
      try {
        const res = q.insertRun.run(
          run.userId ?? null, run.mode, run.grade ?? null, run.dailyDate ?? null, run.seed,
          run.elapsedMs, run.penaltyMs, run.durationMs,
          run.misses, run.peeks, run.device, now(),
          run.claimToken ?? null, run.claimExpires ?? null,
        )
        const id = Number(res.lastInsertRowid)
        words.forEach((w, i) => q.insertRunWord.run(id, i, w.word, w.answer, w.ms, w.misses ?? 0, w.peeked ? 1 : 0))
        db.prepare('COMMIT').run()
        return id
      } catch (err) {
        db.prepare('ROLLBACK').run()
        throw err
      }
    },

    /**
     * Attach an anonymous run to an account.
     *
     * A daily played before signing in has to keep its daily_date, or the whole "play
     * first, sign in after" flow silently drops it off the daily board. The one scored
     * attempt rule is therefore settled here rather than at submit time: if this account
     * already has a scored go at that day, the run is kept but demoted to practice
     * instead of being rejected outright.
     */
    claimRun(token, userId) {
      const run = q.runByClaim.get(token)
      if (!run || run.user_id || (run.claim_expires ?? 0) <= now()) return false
      if (run.daily_date && q.dailyPlayed.get(userId, run.daily_date, run.mode)) {
        q.demoteDaily.run(run.id)
      }
      return q.claimRun.run(userId, token, now()).changes > 0
    },
    runByClaim: token => q.runByClaim.get(token) ?? null,
    runById: id => q.runById.get(id) ?? null,
    runWords: id => q.runWords.all(id),

    board({ mode, view = 'all', userId = null, limit = 100, offset = 0 }) {
      if (view === 'mine') return userId ? q.boardMine.all(mode, userId, limit, offset) : []
      if (view === 'best') return q.boardBest.all(mode, limit, offset)
      return q.board.all(mode, limit, offset)
    },
    dailyBoard: (date, mode, limit = 100, offset = 0) => q.dailyBoard.all(date, mode, limit, offset),

    boardCount({ mode, view = 'all', userId = null }) {
      if (view === 'mine') return userId ? q.boardCountMine.get(mode, userId).n : 0
      if (view === 'best') return q.boardCountBest.get(mode).n
      return q.boardCountAll.get(mode).n
    },
    dailyBoardCount: (date, mode) => q.dailyBoardCount.get(date, mode).n,

    rankOf: (mode, durationMs) => q.rankOf.get(mode, durationMs).n + 1,
    nextAbove: (mode, durationMs) => q.nextAbove.get(mode, durationMs) ?? null,
    personalBest: (userId, mode, excludeId = -1) => q.personalBest.get(userId, mode, excludeId)?.best ?? null,
    dailyPlayed: (userId, date, mode) => Boolean(q.dailyPlayed.get(userId, date, mode)),
    dailyRankOf: (date, mode, durationMs) => q.dailyRankOf.get(date, mode, durationMs).n + 1,

    /** Rows either side of a time, fastest first, for the finish screen. */
    around({ mode, dailyDate = null, durationMs, excludeId = -1, span = 4 }) {
      const above = dailyDate
        ? q.aboveDaily.all(dailyDate, mode, durationMs, excludeId, span)
        : q.aboveFree.all(mode, durationMs, excludeId, span)
      const below = dailyDate
        ? q.belowDaily.all(dailyDate, mode, durationMs, excludeId, span)
        : q.belowFree.all(mode, durationMs, excludeId, span)
      return { above: above.reverse(), below }
    },

    daily(date, makeSeed) {
      const found = q.getDaily.get(date)
      if (found) return found
      // Written once. A later change to the seed function cannot rewrite a day people
      // have already played.
      q.putDaily.run(date, makeSeed(date), now())
      return q.getDaily.get(date)
    },

    /** One batch of mid-run attempt events, in one transaction for the same reason
     *  recordRun uses one: a crash must not leave half a flush. */
    recordAttempts(userId, { mode = 0, focus = false } = {}, events) {
      const tx = db.prepare('BEGIN')
      tx.run()
      try {
        const t = now()
        for (const e of events) {
          q.insertAttempt.run(
            userId, e.word, mode, focus ? 1 : 0,
            e.ms, e.misses ?? 0, e.peeked ? 1 : 0,
            e.rules?.length ? JSON.stringify(e.rules) : null,
            e.jamo?.length ? JSON.stringify(e.jamo) : null,
            e.subs?.length ? JSON.stringify(e.subs) : null,
            e.kinds?.length ? JSON.stringify(e.kinds) : null,
            t,
          )
        }
        db.prepare('COMMIT').run()
      } catch (err) {
        db.prepare('ROLLBACK').run()
        throw err
      }
    },

    attemptsFor: (userId, since, limit = 20000) => q.attemptsFor.all(userId, since, limit),
    firstAttemptAt: userId => q.firstAttemptAt.get(userId)?.t ?? null,
    historyWords: (userId, before, limit = 20000) => q.historyWords.all(userId, before, limit),

    sweep() {
      q.sweepSessions.run(now())
      q.sweepClaims.run(now())
      // A year of attempts is far more than the profile window ever reads, and the SD
      // card this lives on is shared. Old rows have nothing left to teach.
      q.sweepAttempts.run(now() - 365 * 24 * 60 * 60 * 1000)
    },
  }
}
