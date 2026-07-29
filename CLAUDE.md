# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Hangul Hero: read a Korean word, type its romanization, scored on total time. Svelte 5 front
end, a dependency-free `node:http` + `node:sqlite` server, and a romanization engine shared by
both. Node >= 22 (the Pi runs 24).

## Commands

```bash
npm run dev            # vite on :5173, proxying /api and /auth to :8790
npm run server         # API server on :8790 with .env.local loaded
npm run build          # vite build into web/dist
npm test               # em dash check, then node --test over tests/
npm run lint:dashes    # the em dash check alone
npm run design         # static server for the design/ mockups
```

Both `npm run dev` and `npm run server` are needed at once for anything touching the API. The
server also serves `web/dist` directly, so `npm run build && npm run server` reproduces
production on one port.

A single test file: `node --test tests/rr-statute.test.mjs`. A single case within one:
`node --test --test-name-pattern "독립" tests/`.

Data pipelines, run on the desktop and never on the Pi:

```bash
npm run words:fetch    # KRDICT_API_KEY, caches one XML per word into data/cache/
npm run words:build    # cache -> data/words.json + review-queue.json
npm run words:verify
npm run tts:build      # AZURE_SPEECH_KEY, then node tools/audio-pack.mjs
```

## Architecture

**`src/core/` is the shared engine.** Imported unchanged by the server, the build tools, and
the app (aliased to `@core` in `vite.config.js`). Anything about how Korean works belongs here,
never in a component.

The romanization split is the load-bearing design decision:

- `rr.mjs` romanizes a **pronunciation**, not a spelling. Every sound change is assumed to have
  already happened. It is lookup tables plus one adjacency rule (ㄹ+ㄹ becomes `ll`), so it
  makes no judgement calls. Hand it a spelling and you get a wrong answer by design.
- The pronunciations come from 국립국어원 via `data/words.json`, so the hard half of the problem
  is sourced rather than derived. `toWrittenForm()` applies the two corrections the statute
  requires (tensification is not written; ㅚ and ㅢ keep their spelling) plus the 체언 ㅎ
  exception, which needs the part of speech and cannot be derived from sound.
- `breakdown.mjs` separately reconstructs *which* rules fired, ordered by derivation stage
  rather than syllable position, because rules feed each other (독립: ㄹ becomes ㄴ, and only
  then does ㄱ nasalise). It feeds both the peek panel and the Learn page from one derivation.

`answer.mjs` grades and diagnoses (`markAnswer` uses an edit-distance backtrace so one wrong
letter marks one letter). `scoring.mjs` holds every time penalty in one place. `seed.mjs` keeps
word selection a pure function of `(seed, pool, count)` so a daily is byte-identical everywhere.

`profile.mjs` turns misses into a mistake profile. `attributeMiss` pins one wrong answer on a
rule, a jamo, or a directed substitution (`initial:ㅂ>p`, the b of ㅂ typed as p) using where
the marking diverged and what fate that jamo had, and deliberately declines when the evidence
is ambiguous (a truncated answer charges nothing). Ear-only rules (tensing, the held vowels)
are excluded from the profile on principle: the answer never depends on them, so they cannot
be missed in a game that asks for the written form, and typing the heard sound is recorded as
the substitution it demonstrably is. `weaknessProfile`
ranks weaknesses as misses over exposures (clean attempts are logged for exactly this reason),
Wilson-bounded and recency-decayed so the profile heals as the player improves. `buildFocusPool`
assembles a drill from failed words, then words exercising the weak rules, then words carrying
the misread jamo. The server also derives each word's `literal` form here, the letter-by-letter
reading `rr.mjs` produces from a spelling, which is what lets `diagnose()` name the game's
defining mistake instead of shrugging.

**`server/`** has no runtime dependencies. Routes are a flat `"METHOD /path"` object in
`index.mjs`; `db.mjs` wraps `node:sqlite` with prepared statements and a column-presence
migration; `auth.mjs` does OAuth (Discord). Anonymous runs get a claim token so a race played
before signing in can still reach a board.

**Mistakes are captured mid-run, not at run end.** `Race.svelte` batches one event per word,
carrying whatever each miss was pinned on, and flushes to `POST /api/attempts` while the run is
live (`sendBeacon` on pagehide), because an abandoned race is evidence too and `POST /api/run`
never hears about it. The `attempts` table is the profile's source of truth from a user's first
row onward; `run_words` from runs finished before that serve as coarse pre-feature history, so
nothing is counted twice. `GET /api/focus` builds the personal drill from the profile.

**`web/`** is the Vite root. Svelte 5 runes, a hand-rolled router in `lib/router.svelte.js`, no
component library.

**Word data** is 6,153 entries in `data/words.json`, each carrying spelling, published
pronunciation, canonical `rr`, an `accept` list, gloss, grade and part of speech. Anything the
build could not verify goes to `data/review-queue.json` instead of into the game. Audio ships as
one LFS-tracked `assets/audio.pack` with an offset index rather than 6,153 loose files.

## Locked product decisions

- **Spoken Revised Romanization is the source of truth** for answer checking (독립 is
  `dongnip`, not `doklip`). The point of the game is reading fluency, so sound changes across
  syllable boundaries are the skill being tested, not an inconvenience.
- **Planned, not built: a "Letters" mode** doing literal jamo conversion with no cross-syllable
  changes (독립 as `doklip`) as a beginner on-ramp, with its own leaderboards. The word records
  already carry the pieces needed for it and `diagnose()` already names this mistake.
- **A wrong answer costs time and you retry until correct.** Feedback names the specific sound
  change that was missed rather than flashing a generic error.
- **Every interaction stays reachable from the keyboard.** The peek panel toggles on `` ` ``
  (or Tab) and stays open while typing. Deliberately not hover: hands stay on the keys.
- **Modes are word counts** (10/25/50/100/250/500) with separate leaderboards. Free play draws
  randomly; the Daily is one shared seed per date with a Wordle-style clipboard share, and one
  scored attempt.
- **Content words only.** No set phrases, no particles or bound nouns.
- **Focus mode is personal and unranked, and requires sign-in.** Every drill pool is built
  from one player's own miss rates, so no two players race the same words and the times are
  not comparable; a board over them would be a lie. Sign-in is the identity the longitudinal
  profile needs, consistent with boards requiring it.
- **Mnemonic glyphs are hand-authored SVG** where the jamo strokes are the drawing's structure.
  Not generated images. See `design/glyphs.html`.
- **Anti-cheat is deliberately not attempted.** The rate limit exists to protect a shared 29GB
  SD card, nothing more.

## Conventions

- **No em dashes, ever.** Enforced by `npm test` over `src`, `design`, `web`, `server`, `docs`.
  Spaced `--` is caught too. Use a comma, colon, full stop or brackets.
- Comments explain *why*, often at length, and frequently cite the statute clause or the bug
  that forced the code to look the way it does. Match that register rather than annotating what
  the next line does.
- `tests/rr-statute.test.mjs` is the statute's own worked examples, which makes it the closest
  thing to a conformance suite. `rule-coverage.test.mjs` runs over the whole shipping word list
  and asserts every changed syllable is explained by some rule. Both are expected to stay green.

## Deploy

Push to `main` and it is live at `https://hangul.paulclay.xyz` within two minutes: the Pi polls
GitHub on a systemd timer, builds into `web/dist-next` and only swaps it in on success. Full
setup, day-to-day commands and the backup schedule are in `docs/deploy.md`.
