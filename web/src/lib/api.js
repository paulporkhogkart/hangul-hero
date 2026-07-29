// Everything that talks to the server, in one place.

async function req(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
  if (!res.ok) throw Object.assign(new Error(data.error ?? `request failed (${res.status})`), { status: res.status, data })
  return data
}

export const api = {
  config: () => req('/api/config'),
  me: () => req('/api/me'),
  logout: () => req('/api/logout', { method: 'POST' }),

  newRun: mode => req(`/api/run/new?mode=${mode}`),
  daily: (mode, date) => req(`/api/daily?mode=${mode}&date=${date}`),

  submit: run => req('/api/run', { method: 'POST', body: run }),
  claim: token => req('/api/run/claim', { method: 'POST', body: { token } }),

  attempts: payload => req('/api/attempts', { method: 'POST', body: payload }),
  profile: () => req('/api/profile'),
  focus: count => req(`/api/focus?count=${count}`),

  board: (mode, view = 'all') => req(`/api/board?mode=${mode}&view=${view}`),
  dailyBoard: (mode, date) => req(`/api/board/daily?mode=${mode}&date=${date}`),
}

/** The player's own calendar date, so the daily rolls over at their local midnight. */
export function localDate(at = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  return p
}

export const isMobile = () =>
  matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** 41.283, or 2:41.283 once it runs past a minute. Milliseconds throughout, because a
 *  leaderboard that ranks by them should show them. */
export function formatTime(ms) {
  if (ms == null) return '--.---'
  const total = ms / 1000
  if (total < 60) return total.toFixed(3)
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`
}

export const formatDelta = ms =>
  ms == null ? '' : `${ms < 0 ? '-' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`
