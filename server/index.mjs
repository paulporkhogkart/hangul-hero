// Hangul Hero server. node:http, node:sqlite, no runtime dependencies.
//   node --env-file=.env.local server/index.mjs
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { extname, join, normalize as normPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHash } from 'node:crypto'
import { openDb } from './db.mjs'
import { beginLogin, completeLogin, parseCookies, cookie, publicUser, SESSION_COOKIE, PROVIDERS } from './auth.mjs'
import { sample, dailySeed, newSeed } from '../src/core/seed.mjs'

const here = f => fileURLToPath(new URL(f, import.meta.url))

const PORT = Number(process.env.PORT || 8790)
const DATA_DIR = process.env.HH_DATA || here('../data')
const DB_FILE = process.env.HH_DB || join(DATA_DIR, 'hangul-hero.db')
const STATIC_DIR = process.env.HH_STATIC || here('../web/dist')
// Pronunciation clips live outside the build: they are generated, not authored, and
// 6,000 files would bloat every deploy artefact for no reason.
const AUDIO_DIR = process.env.HH_AUDIO || join(DATA_DIR, 'audio')
const PACK_FILE = here('../assets/audio.pack')
const PACK_INDEX = here('../assets/audio.index.json')
const DEV = process.env.NODE_ENV !== 'production'

export const MODES = [10, 25, 50, 100, 250, 500]
const CLAIM_TTL = 60 * 60 * 1000
const MAX_BODY = 256 * 1024

// A stable secret so sessions survive a restart. Derived from the Discord secret
// rather than stored separately, since losing it only means everyone signs in again.
const SECRET = process.env.SESSION_SECRET
  || createHash('sha256').update(String(process.env.DISCORD_CLIENT_SECRET ?? 'dev-secret')).digest('base64url')

const db = openDb(DB_FILE)
const WORDS = JSON.parse(await readFile(here('../data/words.json'), 'utf8'))

// Only what the client needs to run a race and draw a breakdown.
const forClient = w => ({
  word: w.word, rr: w.rr, accept: w.accept, pron: w.pron,
  meaning: w.meaning, definition: w.definition, grade: w.grade, pos: w.pos,
})

setInterval(() => db.sweep(), 60 * 60 * 1000).unref()

// Pronunciation clips ship as one packed file with an offset index, so a deploy moves a
// single artefact rather than six thousand. Loose files in the data directory still win
// when they exist, which keeps regenerating a single word during development instant.
let pack = null
try {
  const { index, count } = JSON.parse(await readFile(PACK_INDEX, 'utf8'))
  await stat(PACK_FILE)
  pack = index
  console.log(`audio pack: ${count.toLocaleString()} clips`)
} catch {
  console.log(`audio pack: none, falling back to loose files in ${AUDIO_DIR}`)
}

// ── plumbing ───────────────────────────────────────────────────────────────
const json = (res, code, body, headers = {}) => {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(text)
}
const fail = (res, code, message) => json(res, code, { error: message })

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(c)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Behind the Cloudflare tunnel the connection to us is plain http, so trust the
 *  forwarded protocol for building redirect URIs and deciding on Secure cookies. */
function originOf(req) {
  const proto = (req.headers['x-forwarded-proto'] || (DEV ? 'http' : 'https')).split(',')[0].trim()
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return { origin: `${proto}://${host}`, secure: proto === 'https' }
}

const userOf = req => db.userForSession(parseCookies(req.headers.cookie).hh_session)

/** Behind the tunnel every connection comes from localhost, so the real client is in a
 *  forwarded header. Cloudflare sets cf-connecting-ip and strips any client-supplied
 *  copy, which is why it is preferred over x-forwarded-for. */
const clientIp = req =>
  req.headers['cf-connecting-ip']
  || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  || req.socket.remoteAddress
  || 'unknown'

/**
 * A crude fixed-window limiter for the endpoints that write.
 *
 * This is not anti-cheat, which we deliberately do not do. It is to stop a bored person
 * with curl filling a 29GB SD card that five other projects are also living on.
 * Generous enough that a fast player racing 10 word runs back to back will never see it.
 */
const RATE = { windowMs: 10 * 60 * 1000, max: 80 }
const hits = new Map()

function rateLimited(req) {
  const ip = clientIp(req)
  const now = Date.now()
  const seen = hits.get(ip)
  if (!seen || now - seen.start > RATE.windowMs) {
    hits.set(ip, { start: now, n: 1 })
    return false
  }
  seen.n += 1
  return seen.n > RATE.max
}

// Forget everyone periodically rather than growing a map forever.
setInterval(() => {
  const cutoff = Date.now() - RATE.windowMs
  for (const [ip, seen] of hits) if (seen.start < cutoff) hits.delete(ip)
}, RATE.windowMs).unref()

/**
 * A client sends the date its own clock is on, so the daily rolls at each player's
 * local midnight. Real zones span UTC-12 to UTC+14, so anything more than a day from
 * our own date is a clock that has been meddled with.
 */
function validDailyDate(claimed) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(claimed ?? '')) return null
  const mine = new Date().toISOString().slice(0, 10)
  const diff = Math.abs(Date.parse(`${claimed}T00:00:00Z`) - Date.parse(`${mine}T00:00:00Z`))
  return diff <= 36 * 60 * 60 * 1000 ? claimed : null
}


// ── routes ─────────────────────────────────────────────────────────────────
const routes = {
  'GET /api/config': (req, res) => json(res, 200, {
    modes: MODES,
    providers: Object.entries(PROVIDERS).filter(([, p]) => p.clientId()).map(([k, p]) => ({ id: k, name: p.name })),
    words: WORDS.length,
  }),

  'GET /api/me': (req, res) => json(res, 200, { user: publicUser(userOf(req)) }),

  /**
   * A health check that can actually fail.
   *
   * /health used to answer 200 because the single page app fallback catches any
   * extensionless path, so an uptime check pointed at it would have passed on a server
   * that could not read its own database. This touches the database and the word list,
   * which are the two things that make the process useful rather than merely alive.
   */
  'GET /api/health': (req, res) => {
    try {
      const n = db.raw.prepare('SELECT COUNT(*) AS n FROM runs').get().n
      json(res, 200, { ok: true, words: WORDS.length, runs: n, audio: pack ? 'pack' : 'loose', uptime: Math.round(process.uptime()) })
    } catch (err) {
      fail(res, 503, DEV ? err.message : 'database unavailable')
    }
  },

  'POST /api/logout': (req, res) => {
    const token = parseCookies(req.headers.cookie).hh_session
    if (token) db.dropSession(token)
    const { secure } = originOf(req)
    json(res, 200, { ok: true }, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure }) })
  },

  'GET /api/run/new': (req, res, url) => {
    const mode = Number(url.searchParams.get('mode'))
    if (!MODES.includes(mode)) return fail(res, 400, 'unknown mode')
    const seed = newSeed()
    json(res, 200, { seed, mode, daily: null, words: sample(WORDS, mode, seed).map(forClient) })
  },

  'GET /api/daily': (req, res, url) => {
    const mode = Number(url.searchParams.get('mode') ?? 25)
    if (!MODES.includes(mode)) return fail(res, 400, 'unknown mode')
    const date = validDailyDate(url.searchParams.get('date'))
    if (!date) return fail(res, 400, 'that date does not look right')

    const row = db.daily(date, dailySeed)
    const user = userOf(req)
    json(res, 200, {
      seed: row.seed,
      mode,
      daily: date,
      played: user ? db.dailyPlayed(user.id, date, mode) : false,
      words: sample(WORDS, mode, `${row.seed}:${mode}`).map(forClient),
    })
  },

  'POST /api/run': async (req, res) => {
    const body = await readJson(req)
    const mode = Number(body.mode)
    if (!MODES.includes(mode)) return fail(res, 400, 'unknown mode')
    if (!Array.isArray(body.words) || body.words.length !== mode) return fail(res, 400, 'word count does not match the mode')

    const elapsedMs = Math.max(0, Math.round(Number(body.elapsedMs) || 0))
    const penaltyMs = Math.max(0, Math.round(Number(body.penaltyMs) || 0))
    if (!elapsedMs) return fail(res, 400, 'a run needs a time')

    const user = userOf(req)
    const dailyDate = body.daily ? validDailyDate(body.daily) : null
    // Keep the daily date even when nobody is signed in yet, or a daily played before
    // signing in can never reach the daily board however it is claimed afterwards. For a
    // signed-in player the one scored attempt rule applies here; for an anonymous one it
    // is settled when the run is claimed.
    const scoredDaily = dailyDate && (!user || !db.dailyPlayed(user.id, dailyDate, mode)) ? dailyDate : null

    const claimToken = user ? null : randomBytes(18).toString('base64url')
    const run = {
      userId: user?.id ?? null,
      mode,
      dailyDate: scoredDaily,
      seed: String(body.seed ?? ''),
      elapsedMs,
      penaltyMs,
      durationMs: elapsedMs + penaltyMs,
      misses: Math.max(0, Number(body.misses) || 0),
      peeks: Math.max(0, Number(body.peeks) || 0),
      device: body.device === 'mobile' ? 'mobile' : 'desktop',
      claimToken,
      claimExpires: claimToken ? Date.now() + CLAIM_TTL : null,
    }

    const id = db.recordRun(run, body.words.map(w => ({
      word: String(w.word ?? ''),
      answer: String(w.answer ?? ''),
      ms: Math.max(0, Math.round(Number(w.ms) || 0)),
      misses: Math.max(0, Number(w.misses) || 0),
      peeked: Boolean(w.peeked),
    })))

    json(res, 200, {
      id,
      claimToken,
      ...standings(run, user, id),
    })
  },

  'POST /api/run/claim': async (req, res) => {
    const user = userOf(req)
    if (!user) return fail(res, 401, 'sign in first')
    const { token } = await readJson(req)
    if (!token) return fail(res, 400, 'no token')
    if (!db.claimRun(token, user.id)) return fail(res, 410, 'that run has expired or was already saved')
    const run = db.runByClaim(token) ?? null
    json(res, 200, { ok: true, run })
  },

  'GET /api/board': (req, res, url) => {
    const mode = Number(url.searchParams.get('mode'))
    if (!MODES.includes(mode)) return fail(res, 400, 'unknown mode')
    const view = ['all', 'mine', 'best'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'all'
    const user = userOf(req)
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 100))
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
    json(res, 200, {
      mode, view, offset,
      rows: db.board({ mode, view, userId: user?.id ?? null, limit, offset }),
    })
  },

  'GET /api/board/daily': (req, res, url) => {
    const mode = Number(url.searchParams.get('mode') ?? 25)
    const date = validDailyDate(url.searchParams.get('date'))
    if (!MODES.includes(mode) || !date) return fail(res, 400, 'unknown mode or date')
    json(res, 200, { mode, date, rows: db.dailyBoard(date, mode) })
  },

  'GET /api/run': (req, res, url) => {
    const run = db.runById(Number(url.searchParams.get('id')))
    if (!run) return fail(res, 404, 'no such run')
    json(res, 200, { run, words: db.runWords(run.id) })
  },
}

/** Where a finished run landed, and enough of the board around it to mean something. */
function standings(run, user, id = -1) {
  const daily = run.dailyDate ?? null

  const rank = daily
    ? db.dailyRankOf(daily, run.mode, run.durationMs)
    : db.rankOf(run.mode, run.durationMs)
  const above = daily ? null : db.nextAbove(run.mode, run.durationMs)
  const best = user && !daily ? db.personalBest(user.id, run.mode) : null
  const nearby = db.around({
    mode: run.mode, dailyDate: daily,
    durationMs: run.durationMs, excludeId: id, span: 4,
  })

  return {
    rank,
    gapToNext: above ? run.durationMs - above.duration_ms : null,
    nextName: above?.display_name ?? null,
    personalBest: best,
    beatPersonalBest: best !== null && run.durationMs < best,
    // The rank alone says nothing about how close anyone was. These are the runs
    // immediately faster and immediately slower, so the number has people attached.
    nearby,
  }
}

// ── static files ───────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon',
}

async function serveStatic(req, res, pathname) {
  if (!existsSync(STATIC_DIR)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('The site has not been built yet. Run: npm run build')
  }
  const rel = normPath(decodeURIComponent(pathname)).replace(/^[/\\]+/, '')
  let file = join(STATIC_DIR, rel)
  if (!file.startsWith(STATIC_DIR)) return fail(res, 403, 'no')

  let info = await stat(file).catch(() => null)
  if (info?.isDirectory()) { file = join(file, 'index.html'); info = await stat(file).catch(() => null) }
  // Unknown path with no extension: hand it to the single page app.
  if (!info) {
    if (extname(rel)) { res.writeHead(404); return res.end('not found') }
    file = join(STATIC_DIR, 'index.html')
    info = await stat(file).catch(() => null)
    if (!info) { res.writeHead(404); return res.end('not found') }
  }

  const ext = extname(file)
  const immutable = /-[A-Za-z0-9_]{8,}\./.test(file) // vite's content hashes
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

// ── the server ─────────────────────────────────────────────────────────────
const serverHandler = srv => srv.on('request', async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname

  try {
    // OAuth
    const auth = path.match(/^\/auth\/([a-z]+)(\/callback)?$/)
    if (auth) {
      const [, provider, isCallback] = auth
      const { origin, secure } = originOf(req)

      // ?debug=1 reports exactly what we would send instead of sending it. Comparing a
      // provider's error against a guess is a waste of everyone's time; this prints the
      // string that has to match, character for character. Development only: it is a
      // workbench tool and has no business answering on a public host.
      if (DEV && !isCallback && url.searchParams.has('debug')) {
        return json(res, 200, {
          redirect_uri: `${origin}/auth/${provider}/callback`,
          client_id: PROVIDERS[provider]?.clientId() ?? null,
          derived_from: {
            host: req.headers.host ?? null,
            'x-forwarded-host': req.headers['x-forwarded-host'] ?? null,
            'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? null,
            protocol_used: origin.split(':')[0],
          },
          paste_this_into_discord: `${origin}/auth/${provider}/callback`,
        })
      }

      if (!isCallback) {
        const { location, setCookie } = beginLogin({ provider, secret: SECRET, origin, next: url.searchParams.get('next') ?? '/', secure })
        res.writeHead(302, { location, 'set-cookie': setCookie })
        return res.end()
      }
      try {
        const { next, setCookies } = await completeLogin({
          provider, secret: SECRET, origin, query: url.searchParams,
          cookies: parseCookies(req.headers.cookie), db, secure,
        })
        res.writeHead(302, { location: next, 'set-cookie': setCookies })
        return res.end()
      } catch (err) {
        res.writeHead(302, { location: `/?login_error=${encodeURIComponent(err.message)}` })
        return res.end()
      }
    }

    // Pronunciation clips. A missing clip is an ordinary 404 the client ignores, not
    // an error, so the game works fine before they have all been generated.
    if (path.startsWith('/audio/')) {
      const name = decodeURIComponent(path.slice('/audio/'.length)).replace(/\.mp3$/, '')
      if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return fail(res, 400, 'no')
      const AUDIO_HEADERS = { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=604800, immutable' }

      const loose = join(AUDIO_DIR, `${encodeURIComponent(name)}.mp3`)
      const info = await stat(loose).catch(() => null)
      if (info) {
        res.writeHead(200, { ...AUDIO_HEADERS, 'content-length': info.size })
        return createReadStream(loose).pipe(res)
      }

      const at = pack?.[name]
      if (!at) { res.writeHead(404); return res.end() }
      const [start, length] = at
      res.writeHead(200, { ...AUDIO_HEADERS, 'content-length': length })
      return createReadStream(PACK_FILE, { start, end: start + length - 1 }).pipe(res)
    }

    const handler = routes[`${req.method} ${path}`]
    if (handler) {
      if (req.method === 'POST' && rateLimited(req)) return fail(res, 429, 'slow down a moment')
      return await handler(req, res, url)
    }
    if (path.startsWith('/api/')) return fail(res, 404, 'no such endpoint')
    return await serveStatic(req, res, path === '/' ? '/index.html' : path)
  } catch (err) {
    console.error(`${req.method} ${path}`, err)
    if (!res.headersSent) fail(res, 500, DEV ? err.message : 'something went wrong')
    else res.end()
  }
})

const server = createServer()
serverHandler(server)

server.listen(PORT, () => {
  console.log(`hangul-hero on :${PORT}  (${WORDS.length.toLocaleString()} words, db ${DB_FILE})`)
  if (!process.env.DISCORD_CLIENT_ID) console.log('  note: DISCORD_CLIENT_ID is not set, so sign in is disabled')
})

/**
 * systemd sends SIGTERM on every restart, which a deploy does on every push. Without
 * this the process is killed mid-request and, more to the point, mid-transaction. Closing
 * the database explicitly lets SQLite finish its checkpoint rather than leaving a WAL for
 * the next boot to recover.
 */
let closing = false
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (closing) return
    closing = true
    console.log(`${signal}, shutting down`)
    server.close(() => {
      try { db.raw.close() } catch { /* already gone */ }
      process.exit(0)
    })
    // Do not hang forever on a client holding a connection open.
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
