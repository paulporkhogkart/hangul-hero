// Tiny zero-dependency static server for the design gallery.
//   node design/serve.mjs   ->  http://localhost:5177
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT || 5177)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  // pathname stays percent-encoded, which matters the moment a filename is Korean.
  const path = decodeURIComponent(url.pathname)
  const rel = path === '/' ? 'index.html' : normalize(path).replace(/^[/\\]+/, '')
  const file = join(ROOT, rel)
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }
}).listen(PORT, () => {
  console.log(`design gallery -> http://localhost:${PORT}`)
})
