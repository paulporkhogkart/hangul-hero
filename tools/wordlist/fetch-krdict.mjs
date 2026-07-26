// Pull 국립국어원 data for every candidate word and cache the raw XML on disk.
//   node --env-file=.env.local tools/wordlist/fetch-krdict.mjs
//
// Cache-first and resume-safe: interrupt it and run it again and it picks up where it
// stopped without re-requesting anything it already has. Deliberately gentle on the
// API, since this is somebody else's free public service.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCandidates } from './candidates.mjs'

const KEY = process.env.KRDICT_API_KEY
if (!KEY) { console.error('KRDICT_API_KEY missing. Run with --env-file=.env.local'); process.exit(1) }

const CACHE = fileURLToPath(new URL('../../data/cache/krdict', import.meta.url))
const CONCURRENCY = 4
const GAP_MS = 120        // pause between requests within a worker
const MAX_RETRIES = 3

await mkdir(CACHE, { recursive: true })
const candidates = await loadCandidates()
const already = new Set((await readdir(CACHE)).filter(f => f.endsWith('.xml')).map(f => decodeURIComponent(f.slice(0, -4))))
const todo = candidates.filter(c => !already.has(c.word))

console.log(`candidates : ${candidates.length.toLocaleString()}`)
console.log(`cached     : ${already.size.toLocaleString()}`)
console.log(`to fetch   : ${todo.length.toLocaleString()}\n`)
if (!todo.length) { console.log('nothing to do.'); process.exit(0) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const cachePath = word => join(CACHE, `${encodeURIComponent(word)}.xml`)

function url(q) {
  const u = new URL('https://krdict.korean.go.kr/api/search')
  u.searchParams.set('key', KEY)
  u.searchParams.set('q', q)
  u.searchParams.set('part', 'word')
  u.searchParams.set('method', 'exact')
  u.searchParams.set('translated', 'y')
  u.searchParams.set('trans_lang', '1')
  u.searchParams.set('num', '20')
  return u
}

let done = 0, failed = 0, empty = 0
const started = Date.now()

async function fetchOne(word) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const r = await fetch(url(word), { headers: { 'User-Agent': 'hangul-hero (personal learning project)' } })
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`)
      const xml = await r.text()
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${xml.slice(0, 120)}`)
      // An <error_code> body means the API rejected us; do not cache that as data.
      if (/<error_code>/.test(xml)) throw new Error(xml.match(/<message>([\s\S]*?)<\/message>/)?.[1] ?? 'api error')
      await writeFile(cachePath(word), xml)
      if (!/<item>/.test(xml)) empty++
      return true
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        failed++
        if (failed <= 10) console.error(`  ! ${word}: ${err.message}`)
        return false
      }
      await sleep(600 * attempt * attempt) // back off hard; the quota is not ours to burn
    }
  }
}

async function worker(slice) {
  for (const c of slice) {
    await fetchOne(c.word)
    done++
    if (done % 250 === 0) {
      const rate = done / ((Date.now() - started) / 1000)
      const left = Math.round((todo.length - done) / rate)
      console.log(`  ${done.toLocaleString()} / ${todo.length.toLocaleString()}   ${rate.toFixed(1)}/s   ~${Math.floor(left / 60)}m${left % 60}s left   (${failed} failed, ${empty} empty)`)
    }
    await sleep(GAP_MS)
  }
}

// Round-robin the work so each worker gets an even mix rather than one contiguous block.
const slices = Array.from({ length: CONCURRENCY }, (_, i) => todo.filter((_, j) => j % CONCURRENCY === i))
await Promise.all(slices.map(worker))

console.log(`\nfetched : ${(done - failed).toLocaleString()}`)
console.log(`failed  : ${failed.toLocaleString()}`)
console.log(`no match in the dictionary : ${empty.toLocaleString()}`)
console.log(`elapsed : ${Math.round((Date.now() - started) / 1000)}s`)
if (failed) console.log('\nre-run to retry the failures; everything already cached is skipped.')
