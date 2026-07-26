// Pack the generated clips into one file plus an index.
//   node tools/audio-pack.mjs
//
// Why a pack rather than 6,153 committed files:
//   - one Git LFS object instead of six thousand, so checkout is a single transfer
//     rather than six thousand round trips
//   - no 6,000-entry directory to sit on the Pi's SD card, where every small file
//     wastes most of a block
//   - the deploy either has the whole pack or does not; there is no half-copied state
//
// The generator still writes individual files locally, because those are pleasant to
// work with. This turns them into the thing we ship.
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const SRC = process.env.HH_AUDIO || fileURLToPath(new URL('../data/audio', import.meta.url))
const OUT = fileURLToPath(new URL('../assets', import.meta.url))

await mkdir(OUT, { recursive: true })
const files = (await readdir(SRC)).filter(f => f.endsWith('.mp3')).sort()
if (!files.length) { console.error(`no clips in ${SRC}. Run: npm run tts:build`); process.exit(1) }

const chunks = []
const index = {}
let offset = 0

for (const f of files) {
  const word = decodeURIComponent(f.slice(0, -4))
  const buf = await readFile(join(SRC, f))
  index[word] = [offset, buf.length]
  chunks.push(buf)
  offset += buf.length
}

const pack = Buffer.concat(chunks, offset)
const digest = createHash('sha256').update(pack).digest('hex').slice(0, 16)

await writeFile(join(OUT, 'audio.pack'), pack)
await writeFile(join(OUT, 'audio.index.json'), JSON.stringify({ version: 1, digest, count: files.length, index }))

const mb = n => `${(n / 1048576).toFixed(1)} MB`
console.log(`clips  : ${files.length.toLocaleString()}`)
console.log(`pack   : ${mb(pack.length)}  (assets/audio.pack)`)
console.log(`index  : ${mb((await stat(join(OUT, 'audio.index.json'))).size)}  (assets/audio.index.json)`)
console.log(`digest : ${digest}`)
