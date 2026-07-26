// Generate a handful of sample pronunciations so the voice can be judged before we
// commit to the full word list.
//   npm run tts:sample                  -> default voice
//   npm run tts:sample -- JiMin SeoHyeon  -> also render those voices
//
// Writes design/samples/<voice>/<word>.mp3 plus an index.json for the player page.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = process.env.AZURE_SPEECH_KEY
const REGION = process.env.AZURE_SPEECH_REGION
if (!KEY || !REGION) {
  console.error('AZURE_SPEECH_KEY / AZURE_SPEECH_REGION missing. Run via `npm run tts:sample`.')
  process.exit(1)
}

// Chosen to stress the voice, not to be easy. Each one carries a sound change we
// need to hear applied, so the audio doubles as an independent check on the
// romanization engine.
const WORDS = [
  { han: '사람', rr: 'saram', note: 'control, no sound change' },
  { han: '학교', rr: 'hakgyo', note: 'tensification of the second syllable' },
  { han: '한국어', rr: 'hangugeo', note: 'liaison, final consonant crosses into the empty vowel slot' },
  { han: '독립', rr: 'dongnip', note: 'nasalisation, the hard one' },
  { han: '좋다', rr: 'jota', note: 'the h merges into the next consonant' },
  { han: '같이', rr: 'gachi', note: 'palatalisation' },
  { han: '감사합니다', rr: 'gamsahamnida', note: 'long, everyday, nasal assimilation' },
  { han: '없다', rr: 'eopda', note: 'consonant cluster in the final position' },
]

const VOICES = { SunHi: 'ko-KR-SunHiNeural', JiMin: 'ko-KR-JiMinNeural', SeoHyeon: 'ko-KR-SeoHyeonNeural', YuJin: 'ko-KR-YuJinNeural' }
const picked = process.argv.slice(2)
const voices = (picked.length ? picked : ['SunHi']).map(n => [n, VOICES[n] ?? n])

const OUT = join(fileURLToPath(new URL('../design/samples', import.meta.url)))
const ENDPOINT = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`

const esc = s => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])

async function speak(text, voice) {
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">` +
    `<voice name="${voice}">${esc(text)}</voice></speak>`
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      'User-Agent': 'hangul-hero',
    },
    body: ssml,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`)
  return Buffer.from(await res.arrayBuffer())
}

let chars = 0
for (const [name, voice] of voices) {
  const dir = join(OUT, name)
  await mkdir(dir, { recursive: true })
  for (const w of WORDS) {
    const buf = await speak(w.han, voice)
    await writeFile(join(dir, `${w.han}.mp3`), buf)
    chars += w.han.length
    console.log(`  ${name.padEnd(9)} ${w.han.padEnd(7)} ${String(buf.length).padStart(6)} bytes`)
  }
}

await writeFile(
  join(OUT, 'index.json'),
  JSON.stringify({ voices: voices.map(([n]) => n), words: WORDS }, null, 2),
)
console.log(`\ndone. ${chars} characters billed against the 500,000/month free tier.`)
