-- Hangul Hero. SQLite, one file, WAL mode.
--
-- The central decision here: a run is a first-class row, not an update to a personal
-- best. Boards are pinball boards, so one player can legitimately hold six of the top
-- ten places, and "just me" is a filter over the same table rather than a second one.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── identity ───────────────────────────────────────────────────────────────
-- Discord only for now. The provider column exists so adding Google later is a row
-- value rather than a migration.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- 'discord:123456789'
  provider      TEXT NOT NULL,
  provider_id   TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  email         TEXT,                      -- verified address, used to link providers later
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- ── runs ───────────────────────────────────────────────────────────────────
-- Every completed run is recorded immediately, logged in or not. An anonymous run
-- carries a claim_token so it can be attached to an account afterwards, which is what
-- makes "finish first, sign in second" possible without losing the time.
--
-- duration_ms is the graded figure and already includes penalties. elapsed_ms is what
-- the clock actually showed. Keeping both means the finish screen can say "34.1s, plus
-- 3s in penalties" without recomputing anything.
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  mode          INTEGER NOT NULL,          -- 10, 25, 50, 100, 250, 500
  -- Kept for the historical record only. Levels were dropped once measurement showed the
  -- 국립국어원 grade tracks a word's rarity rather than its reading difficulty. Nothing
  -- reads this column any more.
  grade         TEXT,
  daily_date    TEXT,                      -- 'YYYY-MM-DD' for a daily run, else NULL
  seed          TEXT NOT NULL,
  elapsed_ms    INTEGER NOT NULL,
  penalty_ms    INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL,          -- elapsed + penalty; the ranked figure
  misses        INTEGER NOT NULL DEFAULT 0,
  peeks         INTEGER NOT NULL DEFAULT 0,
  device        TEXT NOT NULL DEFAULT 'desktop',
  finished_at   INTEGER NOT NULL,
  claim_token   TEXT,                      -- NULL once claimed or once created signed-in
  claim_expires INTEGER
);

-- The leaderboard query: one mode, fastest first. Partial index keeps unclaimed
-- anonymous runs out of the board without a WHERE clause doing the work each time.
CREATE INDEX IF NOT EXISTS runs_board
  ON runs(mode, duration_ms) WHERE user_id IS NOT NULL AND daily_date IS NULL;

CREATE INDEX IF NOT EXISTS runs_daily
  ON runs(daily_date, mode, duration_ms) WHERE user_id IS NOT NULL AND daily_date IS NOT NULL;

-- "Just me", and the personal-best comparison on the finish screen.
CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, mode, duration_ms);

CREATE INDEX IF NOT EXISTS runs_claim ON runs(claim_token) WHERE claim_token IS NOT NULL;

-- One scored daily attempt per person. Practice runs on the same seed are stored with
-- daily_date NULL, so they simply never reach the daily board.
CREATE UNIQUE INDEX IF NOT EXISTS runs_daily_once
  ON runs(user_id, daily_date, mode) WHERE user_id IS NOT NULL AND daily_date IS NOT NULL;

-- ── per-word detail ────────────────────────────────────────────────────────
-- Needed for the share grid (green = clean, yellow = slower than your own median,
-- red = missed) and for working out which sound-change rules a player keeps failing.
CREATE TABLE IF NOT EXISTS run_words (
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx       INTEGER NOT NULL,
  word      TEXT NOT NULL,
  answer    TEXT NOT NULL,               -- the expected romanization
  ms        INTEGER NOT NULL,
  misses    INTEGER NOT NULL DEFAULT 0,
  peeked    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, idx)
) WITHOUT ROWID;

-- Which words a player is actually bad at, cheap to aggregate.
CREATE INDEX IF NOT EXISTS run_words_word ON run_words(word);

-- ── attempts ───────────────────────────────────────────────────────────────
-- One row per word attempted, written DURING a run rather than after it, which is the
-- whole reason this table exists alongside run_words: an abandoned run never reaches
-- POST /api/run, and the mistakes made in it are exactly as real as the others.
--
-- Clean attempts are stored too, deliberately. A weakness is misses over exposures,
-- and without the denominator the profile would only ever rediscover which rules are
-- common. rules/jamo/kinds are small JSON arrays naming what the miss was pinned on
-- (see src/core/profile.mjs); NULL when there is nothing to say.
--
-- From the moment a user has rows here, this is their source of truth and run_words
-- only serves as pre-feature history, so nothing is counted twice.
CREATE TABLE IF NOT EXISTS attempts (
  id        INTEGER PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word      TEXT NOT NULL,
  mode      INTEGER NOT NULL,
  focus     INTEGER NOT NULL DEFAULT 0,       -- 1 when the word came from a focus drill
  ms        INTEGER NOT NULL,
  misses    INTEGER NOT NULL DEFAULT 0,
  peeked    INTEGER NOT NULL DEFAULT 0,
  rules     TEXT,                             -- JSON: rule types this miss is evidence against
  jamo      TEXT,                             -- JSON: 'slot:jamo' keys likewise
  kinds     TEXT,                             -- JSON: diagnose kinds seen on this word
  at        INTEGER NOT NULL
);

-- The profile query: one user's recent attempts. Everything else derives in memory.
CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id, at);

-- ── daily ──────────────────────────────────────────────────────────────────
-- The seed is written once per day and never regenerated, so a restart cannot hand
-- someone a different set of words to the people who played before it.
CREATE TABLE IF NOT EXISTS dailies (
  date        TEXT PRIMARY KEY,           -- 'YYYY-MM-DD', Europe/London
  seed        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
