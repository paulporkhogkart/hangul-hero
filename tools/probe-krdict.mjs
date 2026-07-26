// Live probe of the krdict Open API. The API answers in XML regardless of req_type,
// so we parse it with a small tag reader rather than pulling in a dependency for a probe.
//   node --env-file=.env.local tools/probe-krdict.mjs
const KEY = process.env.KRDICT_API_KEY
if (!KEY) { console.error('KRDICT_API_KEY missing in .env.local'); process.exit(1) }

// Chosen because their pronunciation is not their spelling. If <pronunciation> comes
// back identical to <word> for these, the field is not what we need.
const WORDS = ['독립', '학교', '같이', '좋다', '한국어', '물', '있다', '역사', '되다', '저희', '큰일', '생각하다']

const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim()
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? ent(m[1]) : null }
const blocks = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1])

async function search(q) {
  const u = new URL('https://krdict.korean.go.kr/api/search')
  u.searchParams.set('key', KEY)
  u.searchParams.set('q', q)
  u.searchParams.set('part', 'word')
  u.searchParams.set('method', 'exact')
  u.searchParams.set('translated', 'y')
  u.searchParams.set('trans_lang', '1') // English
  u.searchParams.set('num', '10')
  const r = await fetch(u, { headers: { 'User-Agent': 'hangul-hero' } })
  return { status: r.status, xml: await r.text() }
}

console.log('word    pron     grade  pos    changed?  english')
console.log('-'.repeat(78))
let changed = 0, missing = 0
for (const w of WORDS) {
  const { status, xml } = await search(w)
  if (status !== 200) { console.log(`${w.padEnd(7)} HTTP ${status}`); continue }
  const items = blocks(xml, 'item')
  if (!items.length) { console.log(`${w.padEnd(7)} (no results)`); missing++; continue }

  const it = items[0]
  const pron = tag(it, 'pronunciation')
  const grade = tag(it, 'word_grade') ?? '-'
  const pos = tag(it, 'pos') ?? '-'
  const tw = tag(blocks(it, 'sense')[0] ?? '', 'trans_word') ?? '-'
  const diff = pron && pron !== w
  if (diff) changed++
  if (!pron) missing++
  console.log(
    `${w.padEnd(7)} ${String(pron ?? '(none)').padEnd(8)} ${grade.padEnd(6)} ${pos.padEnd(6)} ${(diff ? 'YES' : 'no').padEnd(9)} ${tw}`,
  )
}
console.log('-'.repeat(78))
console.log(`pronunciation differs from spelling in ${changed}/${WORDS.length};  missing pronunciation: ${missing}`)

// Show one full item so the complete field set is visible, not just the fields I guessed at.
const { xml } = await search('독립')
const one = blocks(xml, 'item')[0] ?? ''
console.log('\n--- full <item> for 독립 ---')
console.log(one.replace(/^\s*[\r\n]/gm, '').slice(0, 1400))
