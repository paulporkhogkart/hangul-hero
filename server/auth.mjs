// Discord OAuth2. Written provider-agnostically so adding Google later is a config
// object and a button, not a refactor.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'hh_session'
const STATE_COOKIE = 'hh_oauth'
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000 // 90 days
const STATE_TTL = 10 * 60 * 1000

export const PROVIDERS = {
  discord: {
    name: 'Discord',
    authorizeUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    clientId: () => process.env.DISCORD_CLIENT_ID,
    clientSecret: () => process.env.DISCORD_CLIENT_SECRET,
    /** Discord's own CDN rules for avatars, including the default when none is set. */
    profile(u) {
      const avatar = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(u.id) >> 22n) % 6n}.png`
      return {
        providerId: u.id,
        displayName: u.global_name || u.username,
        avatarUrl: avatar,
        email: u.verified ? u.email ?? null : null,
      }
    },
  },
}

// ── cookies ────────────────────────────────────────────────────────────────
export function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function cookie(name, value, { maxAge, secure = true, httpOnly = true, sameSite = 'Lax' } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${sameSite}`]
  if (httpOnly) bits.push('HttpOnly')
  if (secure) bits.push('Secure')
  if (maxAge !== undefined) bits.push(`Max-Age=${Math.floor(maxAge / 1000)}`)
  return bits.join('; ')
}

// ── signed state, so the callback cannot be forged ─────────────────────────
const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url')

function makeState(secret, next) {
  const payload = Buffer.from(JSON.stringify({ n: randomBytes(12).toString('base64url'), next, t: Date.now() })).toString('base64url')
  return `${payload}.${sign(secret, payload)}`
}

function readState(secret, state) {
  if (typeof state !== 'string' || !state.includes('.')) return null
  const [payload, mac] = state.split('.')
  const expect = sign(secret, payload)
  if (mac.length !== expect.length) return null
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (Date.now() - data.t > STATE_TTL) return null
    return data
  } catch { return null }
}

// ── the two endpoints ──────────────────────────────────────────────────────

/** Step 1. Send the browser to the provider. */
export function beginLogin({ provider, secret, origin, next = '/', secure }) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error(`unknown provider: ${provider}`)
  const clientId = p.clientId()
  if (!clientId) throw new Error(`${provider} is not configured`)

  const state = makeState(secret, next)
  const url = new URL(p.authorizeUrl)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${origin}/auth/${provider}/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', p.scope)
  url.searchParams.set('state', state)

  return {
    location: url.toString(),
    setCookie: cookie(STATE_COOKIE, state, { maxAge: STATE_TTL, secure }),
  }
}

/** Step 2. The provider sends the browser back. Exchange, identify, sign in. */
export async function completeLogin({ provider, secret, origin, query, cookies, db, secure }) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error(`unknown provider: ${provider}`)

  const state = readState(secret, query.get('state'))
  if (!state) throw new Error('login state was missing or expired, please try again')
  // The state must also match the cookie we set, so a state lifted from someone else's
  // browser is useless here.
  if (cookies[STATE_COOKIE] !== query.get('state')) throw new Error('login state did not match this browser')

  const code = query.get('code')
  if (!code) throw new Error(query.get('error_description') || 'no authorization code came back')

  const body = new URLSearchParams({
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${origin}/auth/${provider}/callback`,
  })
  const tokenRes = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!tokenRes.ok) throw new Error(`could not exchange the code (${tokenRes.status})`)
  const token = await tokenRes.json()

  const userRes = await fetch(p.userUrl, { headers: { authorization: `Bearer ${token.access_token}` } })
  if (!userRes.ok) throw new Error(`could not read the profile (${userRes.status})`)
  const profile = p.profile(await userRes.json())

  const user = db.upsertUser({ id: `${provider}:${profile.providerId}`, provider, ...profile })
  const session = randomBytes(32).toString('base64url')
  db.createSession(session, user.id, SESSION_TTL)

  return {
    user,
    next: typeof state.next === 'string' && state.next.startsWith('/') ? state.next : '/',
    setCookies: [
      cookie(SESSION_COOKIE, session, { maxAge: SESSION_TTL, secure }),
      cookie(STATE_COOKIE, '', { maxAge: 0, secure }),
    ],
  }
}

export const publicUser = u => (u ? { id: u.id, name: u.display_name, avatar: u.avatar_url } : null)
