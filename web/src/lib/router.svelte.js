// Enough router for five screens. History API, no dependency.

const parse = () => {
  const u = new URL(location.href)
  return { path: u.pathname, query: u.searchParams }
}

let current = $state(parse())

export const route = {
  get path() { return current.path },
  get query() { return current.query },
}

export function go(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState']({}, '', to)
  current = parse()
  window.scrollTo(0, 0)
}

window.addEventListener('popstate', () => { current = parse() })

/** Intercept in-app links so they do not reload the whole page. */
window.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.target.closest('a')
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return
  const url = new URL(a.href, location.href)
  if (url.origin !== location.origin) return
  // Sign in is a real navigation: it has to leave the app.
  if (url.pathname.startsWith('/auth/')) return
  e.preventDefault()
  go(url.pathname + url.search)
})
