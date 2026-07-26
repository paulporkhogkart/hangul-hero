// Hard rule: no em dash ever reaches the screen. Enforced as a build step rather than
// as a good intention, because a good intention does not survive six months of edits.
//   node tools/check-no-emdash.mjs
import { readdir, readFile } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCAN = ['src', 'design', 'web', 'server', 'docs']
const EXT = new Set(['.html', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.svelte', '.css', '.json', '.md'])
const SKIP = new Set(['node_modules', 'dist', '.git', 'samples', 'cache', 'raw'])

// U+2014 em dash, U+2015 horizontal bar, and the ASCII "--" used as a dash between
// spaces. En dash is fine: it is legitimate in numeric ranges like 10-25.
const RULES = [
  { re: /—/g, name: 'em dash (U+2014)' },
  { re: /―/g, name: 'horizontal bar (U+2015)' },
  { re: / -- /g, name: 'spaced double hyphen used as a dash' },
]

const hits = []

async function walk(dir) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) { await walk(full); continue }
    if (!EXT.has(extname(e.name))) continue
    const text = await readFile(full, 'utf8')
    const lines = text.split(/\r?\n/)
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        rule.re.lastIndex = 0
        if (rule.re.test(line)) {
          hits.push({ file: relative(ROOT, full), line: i + 1, rule: rule.name, text: line.trim().slice(0, 100) })
        }
      })
    }
  }
}

for (const d of SCAN) await walk(join(ROOT, d))

if (!hits.length) {
  console.log('no em dashes found.')
  process.exit(0)
}

console.error(`${hits.length} em dash violation${hits.length === 1 ? '' : 's'}:\n`)
for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.rule}\n    ${h.text}`)
console.error('\nUse a comma, a colon, a full stop, or brackets. Never an em dash.')
process.exit(1)
