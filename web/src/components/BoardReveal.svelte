<script>
  import { tick } from 'svelte'
  import { plural } from '@core/scoring.mjs'
  import { api, formatTime, formatDelta, takeBoard } from '../lib/api.js'
  import { optimisticRank, buildScene } from '../lib/scene.mjs'

  /**
   * The leaderboard a finished run lands on, revealed as a scene rather than a row.
   *
   * The board rows were (usually) prefetched while the last word was being typed, so
   * this renders in the frame the run ends, before the server has even heard about it.
   * The player's rank is computed locally by slotting their time into the fetched
   * rows; POST /api/run's answer arrives a beat later and quietly corrects anything
   * the board learned in between.
   *
   * The reveal: the board opens already scrolled to the run's own neighbourhood, and
   * a beat later the run slots itself in, pushing the rows below it down. A board can
   * be thousands of rows deep and loading them all to scroll past them would be
   * absurd, so anything between the loaded top of the board and the player's own
   * neighbourhood is faked with a single band that says exactly how many runs it
   * stands for. Scrolling into the band pages real rows in to replace it.
   */
  let { run, standings = null, pending = false, user = null, boardHref = '/board' } = $props()

  const PAGE = 100      // the server's page size, and the prefetch size
  const LOAD_CAP = 400  // past this the band stays and the board page takes over

  const myDuration = $derived(run.elapsedMs + run.penaltyMs)

  // Which board this run actually landed on. A daily replay is demoted to free play at
  // submit time, and the server says so; until it answers, trust the run's own claim.
  const dailyDate = $derived(
    standings ? (standings.board === 'daily' ? run.daily : null) : run.daily,
  )

  let base = $state([])          // contiguous rows from rank 1 down, as fetched
  let total = $state(null)       // how many rows the whole board has
  let exhausted = $state(false)  // a short page means there is nothing further
  let failed = $state(false)
  let loadingMore = false

  // Fetch the board for whichever board the run belongs to, once per board. The
  // demotion case above can flip dailyDate after the first fetch, which is exactly
  // when refetching is correct: the rows on screen are from the wrong board.
  let fetchedFor = null
  $effect(() => {
    const key = dailyDate ?? 'free'
    if (fetchedFor === key) return
    fetchedFor = key
    base = []
    total = null
    exhausted = false
    failed = false
    const p = takeBoard(run.mode, dailyDate)
      ?? (dailyDate ? api.dailyBoard(run.mode, dailyDate) : api.board(run.mode, 'all'))
    p.then(r => {
      if (fetchedFor !== key) return
      base = r.rows
      total = r.total ?? null
      exhausted = r.rows.length < PAGE
    }).catch(() => { if (fetchedFor === key) failed = true })
  })

  // The board without this run on it, so the run can be slotted in as its own row.
  // A prefetched board predates the submit and never contains it; a board fetched
  // after (no prefetch, or a sign-in return) does, and until the server has named the
  // run's id the only available key is the exact duration, which at millisecond
  // precision does not collide in practice.
  const cleanBase = $derived.by(() => {
    const myId = standings?.id
    if (myId != null) return base.filter(r => r.id !== myId)
    if (user) {
      const i = base.findIndex(r => r.user_id === user.id && r.duration_ms === myDuration)
      if (i >= 0) return base.filter((_, j) => j !== i)
    }
    return base
  })

  // Where this run stands: the server's answer wins, and before it lands the rank is
  // counted out of the fetched rows where that is honest (see scene.mjs).
  const rank = $derived(standings?.rank ?? optimisticRank(cleanBase, myDuration, exhausted))

  const loaded = $derived(Boolean(standings) || failed || exhausted || base.length > 0)

  // The scene itself: fetched rows, the band standing in for the unloaded middle, the
  // server's neighbourhood, and the run. All the arithmetic lives in scene.mjs.
  const entries = $derived(loaded
    ? buildScene({
        rows: cleanBase,
        rank,
        above: standings?.nearby?.above ?? [],
        below: standings?.nearby?.below ?? [],
      })
    : [])

  const boardTotal = $derived(standings?.total ?? total)
  const alone = $derived(loaded && entries.length === 1 && (exhausted || Boolean(standings)))

  // How much board continues past the last row shown, so the note under the list can
  // say so instead of letting the bottom of the scroll read as the bottom of the board.
  const moreBelow = $derived.by(() => {
    if (boardTotal == null || !entries.length) return null
    const last = entries[entries.length - 1]
    const lastPos = last.pos ?? null
    if (lastPos == null) return null
    return Math.max(0, boardTotal - lastPos)
  })

  const nextUp = $derived.by(() => {
    if (standings?.gapToNext != null) return { gap: standings.gapToNext, name: standings.nextName }
    const above = cleanBase.filter(r => r.duration_ms < myDuration)
    if (!above.length) return null
    const n = above[above.length - 1]
    return { gap: myDuration - n.duration_ms, name: n.display_name }
  })

  // ── the reveal ─────────────────────────────────────────────────────────────
  let wrap = $state(null)
  let youEl = $state(null)
  let gapEl = $state(null)
  let slotted = $state(false)
  let timer = 0

  // Aim a little above centre: the rows below the slot are the runs being beaten,
  // and they are the half of the context worth seeing more of.
  function targetTop() {
    const t = youEl.offsetTop - wrap.clientHeight * 0.45
    return Math.max(0, Math.min(t, wrap.scrollHeight - wrap.clientHeight))
  }

  /**
   * Open the board at the run's own neighbourhood; a beat later the run slots in.
   *
   * There was a scripted ride down from rank 1 here once. It never survived contact
   * with the real boards: they mostly fit inside the viewport, or the run lands near
   * enough the top that the clamped scroll distance is zero, so the ride cut straight
   * to the end anyway, and the bare cut read better. The row arriving is the event;
   * travel before it was ceremony. The beat before the slot-in is still deliberate,
   * so the board is a fact on screen before it changes.
   *
   * Started exactly once, the first moment there is both a scene and somewhere to
   * put it, guarded by a plain flag because the effect must not depend on state it
   * writes.
   */
  let started = false
  $effect(() => {
    if (started || !loaded || !wrap || !youEl) return
    started = true
    // Effects run after the DOM update and before the browser paints, so the board
    // first appears already open at the right place rather than visibly jumping.
    wrap.scrollTop = targetTop()
    const put = wrap.scrollTop
    timer = setTimeout(() => {
      slotted = true
      // Once the row has its height the clamp above can shift; land on it again,
      // unless the player has already taken the scrollbar somewhere else.
      requestAnimationFrame(() => {
        if (wrap && youEl && Math.abs(wrap.scrollTop - put) < 2) wrap.scrollTop = targetTop()
      })
    }, 240)
  })

  $effect(() => () => clearTimeout(timer))

  /**
   * Paging. Scrolling to the band (or the bottom) swaps faked distance for real rows,
   * a page at a time, so a curious player can walk the whole way down. Capped so a
   * monstrous board ends at the band and a link, not at ten thousand DOM nodes.
   *
   * The pages land ABOVE the player's row, so the view is re-anchored to that row by
   * hand. Chrome and Firefox scroll-anchor this on their own (making the correction a
   * measured zero), but Safari does not, and a hundred rows of silent shove is not a
   * thing to find out about by feel.
   */
  async function loadMore() {
    if (loadingMore || exhausted || failed || base.length >= LOAD_CAP) return
    loadingMore = true
    const key = fetchedFor
    try {
      const r = dailyDate
        ? await api.dailyBoard(run.mode, dailyDate, { offset: base.length })
        : await api.board(run.mode, 'all', { offset: base.length })
      if (key !== fetchedFor) return
      const anchor = youEl?.getBoundingClientRect().top
      const seen = new Set(base.map(x => x.id))
      base = [...base, ...r.rows.filter(x => !seen.has(x.id))]
      total = r.total ?? total
      if (r.rows.length < PAGE) exhausted = true
      await tick()
      if (anchor != null && youEl && wrap) wrap.scrollTop += youEl.getBoundingClientRect().top - anchor
    } catch { /* the next scroll retries */ } finally { loadingMore = false }
  }

  function onScroll() {
    if (!slotted || !wrap) return
    const bottomEdge = wrap.scrollTop + wrap.clientHeight
    const threshold = gapEl ? gapEl.offsetTop : wrap.scrollHeight
    if (bottomEdge > threshold - 220) loadMore()
  }
</script>

{#if !loaded}
  <p class="dim finding">finding the board</p>
{:else}
  <div class="rankline">
    <span class="rank tabular">#{rank ?? '…'}</span>
    {#if nextUp}
      <span class="gapline">{formatDelta(nextUp.gap)}s off {nextUp.name}</span>
    {:else if rank === 1}
      <span class="gapline top">fastest time on the board</span>
    {/if}
    {#if pending}<span class="saving">saving</span>{/if}
  </div>

  <!-- A focusable region, so arrow keys can walk the board once it has settled. The
       checker dislikes tabindex on a plain div, but an overflow region that cannot
       take focus cannot be scrolled from the keyboard at all in Firefox and Safari,
       and every interaction here staying reachable from the keyboard is a product
       rule, not a preference. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="boardwrap"
    bind:this={wrap}
    onscroll={onScroll}
    role="region"
    aria-label="leaderboard"
    tabindex="0"
  >
    <ol class="rows">
      {#each entries as e (e.key)}
        {#if e.kind === 'gap'}
          <li class="band" bind:this={gapEl} aria-hidden="true">
            <span>&middot;&thinsp;&middot;&thinsp;&middot;</span>
            {#if e.count != null}<span class="n">{plural(e.count, 'run')}</span>{/if}
            <span>&middot;&thinsp;&middot;&thinsp;&middot;</span>
          </li>
        {:else if e.kind === 'you'}
          <li class="you" class:slotted bind:this={youEl}>
            <span class="pos tabular">{e.pos ?? ''}</span>
            <span class="dot" aria-hidden="true"></span>
            <span class="who">{user ? user.name : 'this run'}</span>
            <span class="t tabular">{formatTime(myDuration)}</span>
          </li>
        {:else}
          <li class:mine={user && e.row.user_id === user.id}>
            <span class="pos tabular">{e.pos}</span>
            {#if e.row.avatar_url}
              <img src={e.row.avatar_url} alt="" width="18" height="18" loading="lazy">
            {:else}
              <span class="noface"></span>
            {/if}
            <span class="who">{e.row.display_name}</span>
            <span class="t tabular">{formatTime(e.row.duration_ms)}</span>
          </li>
        {/if}
      {/each}
    </ol>
  </div>

  <div class="boardnote">
    {#if alone}
      <span class="alone">
        {dailyDate ? "Nobody else has finished today's daily yet." : 'Nobody else has a time on this board yet.'}
      </span>
    {:else if moreBelow}
      <span class="count">{plural(moreBelow, 'more run')} below</span>
    {/if}
    <a class="fullboard" href={boardHref}>see the whole board</a>
  </div>
{/if}

<style>
  .finding { font-size: 13px; margin: 0; }

  .rankline { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .rank { font-size: 22px; color: var(--accent); }
  .gapline { font-size: 13px; color: var(--dim); }
  .gapline.top { color: var(--good); }
  .saving { font-size: 11px; color: var(--dimmer); letter-spacing: .08em; }

  /* Fixed row height on purpose: every scroll position the animation computes stays
     true while avatars trickle in, and a row count converts to pixels exactly. */
  .boardwrap {
    --rowh: 37px;
    position: relative;
    margin-top: 6px;
    max-width: 420px;
    max-height: min(44vh, 407px); /* eleven rows: a torn edge, so it reads as cut off */
    overflow-y: auto;
    overscroll-behavior: contain;
    border-block: 1px solid var(--line);
    scrollbar-width: thin;
    scrollbar-color: var(--dimmer) transparent;
  }

  .rows { list-style: none; margin: 0; padding: 0; }
  .rows li {
    height: var(--rowh);
    display: grid;
    grid-template-columns: 2.6em 18px minmax(0, 1fr) 6.4em;
    align-items: center;
    gap: 12px;
    padding: 0 8px;
    font-size: 12.5px;
    border-bottom: 1px solid #1c1d21;
  }
  .rows li:last-child { border-bottom: 0; }
  .pos { color: var(--dimmer); font-size: 11px; }
  .rows img, .noface { border-radius: 50%; display: block; width: 18px; height: 18px; }
  .noface { background: var(--bg-lift); }
  .who { color: #8b8983; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t { text-align: right; color: var(--dim); }
  li.mine .who { color: var(--body); }

  /* The stand-in for every row nobody needs rendered. Its height is deliberately one
     row: the point is the number on it, not a pretence of physical distance. */
  .band {
    grid-template-columns: 1fr auto 1fr;
    color: var(--dimmer);
    font-size: 11px;
    letter-spacing: .3em;
    text-align: center;
  }
  .band :first-child { text-align: right; }
  .band :last-child { text-align: left; }
  .band .n { letter-spacing: .08em; color: var(--dim); }

  /* The run arrives closed and opens on landing, which is what pushes the rows below
     it down: the slotting-in is real layout, not an overlay. */
  .you {
    height: 0;
    opacity: 0;
    overflow: hidden;
    border-bottom-width: 0;
    background: var(--bg-lift);
    transition: height .26s cubic-bezier(.2, .8, .2, 1), opacity .18s ease .08s;
  }
  .you.slotted {
    height: var(--rowh);
    opacity: 1;
    border-bottom-width: 1px;
    animation: land .9s ease .12s backwards;
  }
  .you .who { color: var(--ink); }
  .you .t { color: var(--accent); }
  .you .dot { width: 6px; height: 6px; background: var(--accent); justify-self: center; }
  .you .pos { color: var(--accent); }

  @keyframes land {
    from { background: rgba(216, 180, 74, .26); }
    to { background: var(--bg-lift); }
  }

  .boardnote {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 8px;
    font-size: 12px;
  }
  .boardnote .alone, .boardnote .count { color: var(--dim); }
  .fullboard { font-size: 12px; }

  @media (max-width: 640px) {
    .boardwrap { --rowh: 34px; max-height: 38vh; max-width: 100%; }
  }
</style>
