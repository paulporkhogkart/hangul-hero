// Nightly backup of the leaderboard.
//   node tools/backup-db.mjs
//
// The database is the only thing here that cannot be regenerated. Words, audio and the
// site all rebuild from source; a run someone set at two in the morning does not.
//
// VACUUM INTO rather than copying the file: it takes a consistent snapshot of a live
// database without stopping the server, and produces a compacted copy with no WAL to
// replay. Copying hangul-hero.db while the server holds it open would give a torn file.
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readdir, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DB = process.env.HH_DB || fileURLToPath(new URL('../data/hangul-hero.db', import.meta.url))
const DEST = process.env.HH_BACKUPS || fileURLToPath(new URL('../data/backups', import.meta.url))
const KEEP = Number(process.env.HH_BACKUP_KEEP || 14)

await mkdir(DEST, { recursive: true })

// Date only, so a run twice in one day overwrites rather than accumulating.
const stamp = new Date().toISOString().slice(0, 10)
const out = join(DEST, `hangul-hero-${stamp}.db`)

const db = new DatabaseSync(DB, { readOnly: true })
try {
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
} finally {
  db.close()
}

const size = (await stat(out)).size
console.log(`backed up to ${out}  (${(size / 1048576).toFixed(1)} MB)`)

// Keep the most recent few and drop the rest, so a 29GB card shared with five other
// projects does not slowly fill with copies of a leaderboard.
const old = (await readdir(DEST))
  .filter(f => /^hangul-hero-\d{4}-\d{2}-\d{2}\.db$/.test(f))
  .sort()
  .slice(0, -KEEP)

for (const f of old) {
  await unlink(join(DEST, f))
  console.log(`removed ${f}`)
}
console.log(`keeping the most recent ${KEEP}`)
