// Generate a pronunciation clip for every word in the list.
//   node --env-file=.env.local tools/tts-build.mjs
//
// Cache-first and resumable, like the dictionary fetch. Safe to run on every deploy:
// once the clips exist it does nothing, and a word added to the list later costs one
// request rather than six thousand.
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = process.env.AZURE_SPEECH_KEY
const REGION = process.env.AZURE_SPEECH_REGION
const VOICE = process.env.AZURE_SPEECH_VOICE || 'ko-KR-SunHiNeural'
if (!KEY || !REGION) { console.error('AZURE_SPEECH_KEY / AZURE_SPEECH_REGION missing'); process.exit(1) }

const OUT = process.env.HH_AUDIO || fileURLToPath(new URL('../data/audio', import.meta.url))
const WORDS = JSON.parse(await readFile(fileURLToPath(new URL('../data/words.json', import.meta.url)), 'utf8'))

const CONCURRENCY = 4
const GAP_MS = 60
const MAX_RETRIES = 3
const ENDPOINT = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`

await mkdir(OUT, { recursive: true })
const have = new Set((await readdir(OUT)).filter(f => f.endsWith('.mp3')).map(f => decodeURIComponent(f.slice(0, -4))))
const todo = WORDS.filter(w => !have.has(w.word))

console.log(`words   : ${WORDS.length.toLocaleString()}`)
console.log(`existing: ${have.size.toLocaleString()}`)
console.log(`to make : ${todo.length.toLocaleString()}`)
console.log(`voice   : ${VOICE}`)
console.log(`chars   : ~${todo.reduce((n, w) => n + w.word.length, 0).toLocaleString()} against 500,000/month free\n`)
if (!todo.length) { console.log('nothing to do.'); process.exit(0) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const esc = s => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])

let done = 0, failed = 0, bytes = 0
const started = Date.now()

async function speak(word) {
  // Said on its own, a touch slower than conversational, because the point is to be
  // heard clearly rather than to sound natural in a sentence.
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ko-KR">` +
    `<voice name="${VOICE}"><prosody rate="-8%">${esc(word)}</prosody></voice></speak>`

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': KEY,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'hangul-hero',
        },
        body: ssml,
      })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 200) throw new Error('suspiciously small clip')
      await writeFile(join(OUT, `${encodeURIComponent(word)}.mp3`), buf)
      bytes += buf.length
      return true
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        failed++
        if (failed <= 8) console.error(`  ! ${word}: ${err.message}`)
        return false
      }
      await sleep(700 * attempt * attempt)
    }
  }
}

async function worker(slice) {
  for (const w of slice) {
    await speak(w.word)
    done++
    if (done % 400 === 0) {
      const rate = done / ((Date.now() - started) / 1000)
      const left = Math.round((todo.length - done) / rate)
      console.log(`  ${done.toLocaleString()} / ${todo.length.toLocaleString()}   ${rate.toFixed(1)}/s   ~${Math.floor(left / 60)}m${left % 60}s left   (${failed} failed, ${(bytes / 1048576).toFixed(0)}MB)`)
    }
    await sleep(GAP_MS)
  }
}

await Promise.all(
  Array.from({ length: CONCURRENCY }, (_, i) => worker(todo.filter((_, j) => j % CONCURRENCY === i))),
)

console.log(`\nmade    : ${(done - failed).toLocaleString()}`)
console.log(`failed  : ${failed.toLocaleString()}`)
console.log(`on disk : ${(bytes / 1048576).toFixed(1)}MB`)
console.log(`elapsed : ${Math.round((Date.now() - started) / 1000)}s`)
if (failed) console.log('\nre-run to retry the failures; anything already made is skipped.')
