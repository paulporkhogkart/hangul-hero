<script>
  import { api, localDate, isMobile, takeRun, takeDaily } from './lib/api.js'
  import { audio, unlock, play } from './lib/audio.svelte.js'
  import { route, go } from './lib/router.svelte.js'
  import Race from './routes/Race.svelte'
  import Home from './routes/Home.svelte'
  import Results from './routes/Results.svelte'
  import Board from './routes/Board.svelte'
  import Learn from './routes/Learn.svelte'
  import Focus from './routes/Focus.svelte'

  let user = $state(null)
  let config = $state(null)
  let error = $state(null)

  // The run currently in play, and the one just finished.
  let live = $state(null)
  let outcome = $state(null)

  /**
   * Signing in is a full page load, so anything held only in memory is gone by the time
   * we come back. That is why finishing a run, signing in, and landing on the home page
   * with no score looked like the claim had failed: the claim was fine, the results
   * screen simply had nothing left to render and fell through to the menu.
   *
   * The finished run is parked in sessionStorage and picked up again on the way back.
   */
  const OUTCOME_KEY = 'hh-outcome'
  const park = o => { try { sessionStorage.setItem(OUTCOME_KEY, JSON.stringify(o)) } catch {} }
  const unpark = () => {
    try { return JSON.parse(sessionStorage.getItem(OUTCOME_KEY) ?? 'null') } catch { return null }
  }

  $effect(() => {
    if (route.path === '/results' && !outcome) outcome = unpark()
  })

  $effect(() => {
    void (async () => {
      try {
        const [c, m] = await Promise.all([api.config(), api.me()])
        config = c
        user = m.user
      } catch (e) { error = e.message }
    })()
  })

  // A failed sign in comes back as a query parameter rather than a dead end.
  $effect(() => {
    const e = route.query.get('login_error')
    if (e) { error = e; go(route.path, { replace: true }) }
  })

  /**
   * The screen answers the click, not the response. Fetching the words used to sit
   * between the two, which read as a dead button for a whole round trip; now the race
   * chrome appears immediately with the words still on the wire, and Race treats a
   * null word list as "not ready yet". On a prefetched path the words are already
   * here and the gap never renders at all.
   *
   * The token does two jobs: it keys the Race component so a new run remounts it
   * while the pending-to-loaded fill of the SAME run does not (a remount there would
   * throw away a keypress Race is holding), and it discards a slow response that
   * arrives after the player has already started a different run.
   */
  let runToken = 0

  async function start({ mode, daily = false }) {
    unlock()
    error = null
    outcome = null
    const date = daily ? localDate() : null
    const token = ++runToken
    live = { token, mode, daily: date, seed: null, words: null }
    go('/race')
    try {
      const run = await (
        (daily ? takeDaily(mode, date) : takeRun(mode))
        ?? (daily ? api.daily(mode, date) : api.newRun(mode))
      )
      if (token !== runToken) return
      live = { ...run, token }
    } catch (e) {
      if (token !== runToken) return
      error = e.message
      live = null
      go('/', { replace: true })
    }
  }

  async function finished(run) {
    const payload = { ...run, device: isMobile() ? 'mobile' : 'desktop' }
    outcome = { run: payload, standings: null, pending: true }
    park(outcome)
    go('/results')
    try {
      const res = await api.submit(payload)
      if (res.beatPersonalBest) play('best')
      // Keep the claim token so a sign in from the results screen can attach this run.
      if (res.claimToken) sessionStorage.setItem('hh-claim', res.claimToken)
      outcome = { run: payload, standings: res, pending: false, saved: Boolean(user) }
      park(outcome)
    } catch (e) {
      outcome = { run: payload, standings: null, pending: false, error: e.message }
      park(outcome)
    }
  }

  // Returning from Discord: attach the run that was waiting on a sign in, and say so.
  $effect(() => {
    if (!user) return
    const token = sessionStorage.getItem('hh-claim')
    if (!token) return
    sessionStorage.removeItem('hh-claim')
    void (async () => {
      try {
        await api.claim(token)
        if (outcome) { outcome = { ...outcome, saved: true }; park(outcome) }
      } catch {
        if (outcome) { outcome = { ...outcome, claimFailed: true }; park(outcome) }
      }
    })()
  })

  async function signOut() {
    await api.logout()
    user = null
  }

  const loginHref = $derived(`/auth/discord?next=${encodeURIComponent(route.path + location.search)}`)
</script>

<header class="top">
  <div class="shell row">
    <a class="brand" href="/">hangul<span>hero</span></a>

    <nav>
      <a href="/board" class:on={route.path === '/board'}>leaderboard</a>
      <a href="/focus" class:on={route.path === '/focus'}>focus</a>
      <a href="/learn" class:on={route.path === '/learn'}>learn</a>
    </nav>

    <div class="spacer"></div>

    <div class="vol">
      <button
        class="bare mute"
        onclick={() => { audio.toggleMute(); unlock(); play('peek') }}
        aria-label={audio.muted ? 'unmute' : 'mute'}
        title={audio.muted ? 'unmute' : 'mute'}
      >{audio.muted ? 'muted' : 'sound'}</button>
      <input
        type="range" min="0" max="1" step="0.05"
        value={audio.muted ? 0 : audio.volume}
        oninput={e => { audio.volume = Number(e.currentTarget.value); unlock() }}
        aria-label="volume"
      />
    </div>

    {#if user}
      <div class="me">
        {#if user.avatar}<img src={user.avatar} alt="" width="22" height="22">{/if}
        <span class="name">{user.name}</span>
        <button class="bare" onclick={signOut}>sign out</button>
      </div>
    {:else if config?.providers?.length}
      <a class="signin" href={loginHref}>sign in</a>
    {/if}
  </div>
</header>

{#if error}
  <div class="shell"><p class="err">{error}</p></div>
{/if}

<main class="page">
  {#if route.path === '/race' && live}
    {#key live.token}
      <Race words={live.words} mode={live.mode} seed={live.seed} daily={live.daily} {user} onFinish={finished} />
    {/key}
  {:else if route.path === '/focus'}
    <Focus {user} {config} {loginHref} />
  {:else if route.path === '/results' && outcome}
    <Results
      {outcome}
      {user}
      {loginHref}
      onAgain={() => start({ mode: outcome.run.mode, daily: false })}
    />
  {:else if route.path === '/board'}
    <Board {config} {user} />
  {:else if route.path === '/learn'}
    <Learn />
  {:else}
    <Home {config} {user} onStart={start} />
  {/if}
</main>

<style>
  .top { border-bottom: 1px solid var(--line); }
  .row { display: flex; align-items: center; gap: 22px; height: 52px; }
  .spacer { flex: 1; }

  .brand {
    font-weight: 700;
    letter-spacing: .1em;
    text-transform: uppercase;
    font-size: 12px;
    color: var(--ink);
    text-decoration: none;
  }
  .brand span { color: var(--accent); }

  nav { display: flex; gap: 16px; }
  nav a {
    font-size: 12px;
    letter-spacing: .06em;
    color: var(--dim);
    text-decoration: none;
  }
  nav a:hover, nav a.on { color: var(--ink); }

  .vol { display: flex; align-items: center; gap: 9px; }
  .mute { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; min-width: 3.6em; text-align: left; }
  .vol input[type="range"] {
    appearance: none;
    width: 74px;
    height: 1px;
    background: var(--line);
    cursor: pointer;
  }
  .vol input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 9px; height: 13px;
    background: var(--accent);
    border: 0;
  }
  .vol input[type="range"]::-moz-range-thumb {
    width: 9px; height: 13px;
    background: var(--accent);
    border: 0; border-radius: 0;
  }

  .me { display: flex; align-items: center; gap: 9px; font-size: 12px; }
  .me img { border-radius: 50%; display: block; }
  .me .name { color: var(--body); }
  .signin { font-size: 12px; letter-spacing: .06em; }

  .err {
    border: 1px solid var(--bad);
    color: #e8b4ac;
    padding: 10px 14px;
    margin: 16px 0 0;
    font-size: 13px;
  }

  .page { flex: 1; display: flex; flex-direction: column; min-height: 0; }

  @media (max-width: 720px) {
    .row { gap: 14px; }
    .vol input[type="range"] { width: 52px; }
    .me .name { display: none; }
  }
  @media (max-width: 520px) {
    nav { display: none; }
  }
</style>
