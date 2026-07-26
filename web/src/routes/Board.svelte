<script>
  import { plural } from '@core/scoring.mjs'
  import { api, formatTime, localDate } from '../lib/api.js'
  import { route } from '../lib/router.svelte.js'

  let { config, user } = $props()

  const MODES = [10, 25, 50, 100, 250, 500]
  // The daily is its own board, not a fourth way of viewing the free play one. It has a
  // fixed length, a fixed word set and one go per person, so mode, level and the
  // best-per-player view all mean nothing there.
  // Opened from a finish screen, the link says which board it means. Read once on
  // arrival: after that the controls own the state, so clicking around does not fight
  // with a stale URL.
  const q = route.query
  let kind = $state(q.get('kind') === 'daily' ? 'daily' : 'free')
  let mode = $state(MODES.includes(Number(q.get('mode'))) ? Number(q.get('mode')) : 25)
  let view = $state(['all', 'best', 'mine'].includes(q.get('view')) ? q.get('view') : 'all')
  let rows = $state([])
  let loading = $state(true)
  let error = $state(null)

  const today = localDate()

  const VIEWS = [
    { id: 'all', label: 'every run' },
    { id: 'best', label: 'best per player' },
    { id: 'mine', label: 'just me' },
  ]

  $effect(() => {
    const k = kind, m = mode, v = view
    loading = true
    error = null
    void (async () => {
      try {
        const res = k === 'daily' ? await api.dailyBoard(25, today) : await api.board(m, v)
        rows = res.rows
      } catch (e) { error = e.message } finally { loading = false }
    })()
  })

  const when = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
</script>

<div class="board shell">
  <div class="controls">
    <div class="seg">
      <button class:on={kind === 'free'} onclick={() => (kind = 'free')}>Free play</button>
      <button class:on={kind === 'daily'} onclick={() => (kind = 'daily')}>Daily challenge</button>
    </div>
  </div>

  {#if kind === 'free'}
    <div class="controls">
      <div class="seg">
        {#each MODES as m}
          <button class:on={mode === m} onclick={() => (mode = m)}>{m}</button>
        {/each}
      </div>
      <div class="seg">
        {#each VIEWS as v}
          <button class:on={view === v.id} disabled={v.id === 'mine' && !user} onclick={() => (view = v.id)}>{v.label}</button>
        {/each}
      </div>
    </div>
  {:else}
    <p class="dim caption">{today}. Twenty five words, the same for everyone, one scored go each.</p>
  {/if}

  {#if error}
    <p class="err">{error}</p>
  {:else if loading}
    <p class="dim empty">loading</p>
  {:else if !rows.length}
    <p class="dim empty">
      {#if kind === 'daily'}Nobody has finished today's daily yet.
      {:else if view === 'mine'}You have not put a time on this board yet.
      {:else}Nothing here yet. Be the first.{/if}
    </p>
  {:else}
    <ol class="rows">
      {#each rows as r, i}
        <li class:me={user && r.user_id === user.id}>
          <span class="pos tabular">{i + 1}</span>
          {#if r.avatar_url}<img src={r.avatar_url} alt="" width="20" height="20" loading="lazy">{/if}
          <span class="who">{r.display_name}</span>
          <span class="detail">
            {#if r.misses}<span class="miss">{plural(r.misses, 'mistake')}</span>{/if}
            {#if r.peeks}<span class="peek">{plural(r.peeks, 'peek')}</span>{/if}
            {#if r.device === 'mobile'}<span class="dev">mobile</span>{/if}
          </span>
          <span class="date">{when(r.finished_at)}</span>
          <span class="t tabular">{formatTime(r.duration_ms)}</span>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .board { padding: 40px 24px 90px; display: grid; gap: 20px; max-width: 820px; }

  .controls { display: flex; gap: 12px; flex-wrap: wrap; }
  .caption { font-size: 12.5px; margin: 0; }
  .seg { display: flex; border: 1px solid var(--line); }
  .seg button { border: 0; padding: 6px 13px; font-size: 12.5px; color: var(--dim); }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on { background: var(--accent); color: #14150f; }
  .seg button:hover:not(.on):not(:disabled) { color: var(--ink); }

  .empty { font-size: 13px; }

  /* The rank and the time are the two things people come here to read, so they get room
     to breathe rather than being squeezed against the edges of the row. */
  .rows { list-style: none; margin: 0; padding: 0; display: grid; }
  .rows li {
    display: grid;
    grid-template-columns: 3.4em 20px minmax(0, 1fr) auto auto 7.2em;
    align-items: center;
    gap: 16px;
    padding: 13px 14px;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }
  .rows li.me { background: var(--bg-lift); }
  .pos { color: var(--dimmer); font-size: 12px; padding-right: 4px; }
  .rows img { border-radius: 50%; display: block; }
  .who { color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li.me .who { color: var(--ink); }
  .detail { display: flex; gap: 12px; font-size: 11px; color: var(--dimmer); }
  .detail .miss { color: #8d5f57; }
  .detail .lv { color: var(--dim); }
  .date { font-size: 11px; color: var(--dimmer); }
  .t { text-align: right; color: var(--accent); padding-left: 6px; }

  .err { color: #e8b4ac; font-size: 13px; }

  @media (max-width: 640px) {
    .board { padding: 24px 16px 70px; }
    .rows li { grid-template-columns: 2.6em 20px minmax(0, 1fr) 6.4em; gap: 10px; padding: 12px 6px; }
    .detail, .date { display: none; }
  }
</style>
