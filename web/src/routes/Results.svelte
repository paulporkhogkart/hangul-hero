<script>
  import { plural } from '@core/scoring.mjs'
  import { formatTime, formatDelta } from '../lib/api.js'
  import Peek from '../components/Peek.svelte'

  let { outcome, user, loginHref, onAgain } = $props()

  const run = $derived(outcome.run)
  const st = $derived(outcome.standings)

  const missed = $derived(run.words.filter(w => w.misses > 0))
  const median = $derived.by(() => {
    const times = run.words.map(w => w.ms).sort((a, b) => a - b)
    return times.length ? times[Math.floor(times.length / 2)] : 0
  })

  // Green clean, yellow slower than your own middle pace, red missed.
  const squares = $derived(run.words.map(w =>
    w.misses > 0 ? 'red' : w.ms > median * 1.35 ? 'yellow' : 'green'))

  const EMOJI = { green: '\u{1F7E9}', yellow: '\u{1F7E8}', red: '\u{1F7E5}' }

  let copied = $state(false)
  let openWord = $state(null)
  let againBtn = $state(null)
  let armed = $state(false)

  // Land on the board this run actually belongs to, rather than on whatever the board
  // page happens to default to.
  const boardHref = $derived(run.daily ? '/board?kind=daily' : `/board?mode=${run.mode}`)

  /**
   * The Enter that submitted the last word of the run is still down when this screen
   * appears, so it was landing here too and starting a fresh run instantly. Focusing the
   * button made it worse, since a focused button activates on Enter natively.
   *
   * So the screen arms itself on the first key RELEASE. Until then Enter does nothing and
   * the button is not focused, which means the keystroke that ended the run cannot also
   * begin the next one. Holding Enter down is covered too: repeats are all keydowns, and
   * none of them arm anything.
   */
  $effect(() => {
    const onUp = () => { armed = true }
    window.addEventListener('keyup', onUp, { once: true })
    return () => window.removeEventListener('keyup', onUp)
  })

  $effect(() => { if (armed) againBtn?.focus({ preventScroll: true }) })

  function onKeydown(e) {
    if (!armed || e.key !== 'Enter') return
    if (e.target?.tagName === 'BUTTON' || e.target?.tagName === 'A') return
    e.preventDefault()
    onAgain()
  }

  function shareText() {
    const rows = []
    for (let i = 0; i < squares.length; i += 13) {
      rows.push(squares.slice(i, i + 13).map(s => EMOJI[s]).join(''))
    }
    const title = run.daily ? `Hangul Hero · Daily ${run.daily}` : `Hangul Hero · ${run.mode} words`
    const bits = [
      `${formatTime(run.elapsedMs + run.penaltyMs)}s`,
      plural(run.misses, 'mistake'),
      plural(run.peeks, 'peek'),
    ]
    return `${title}\n${bits.join('  ·  ')}\n\n${rows.join('\n')}\n\n${location.origin}`
  }

  async function share() {
    const text = shareText()
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text })
      } else {
        await navigator.clipboard.writeText(text)
      }
      copied = true
      setTimeout(() => (copied = false), 2400)
    } catch { /* dismissed */ }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="results shell">
  <div class="headline">
    <div class="time tabular">{formatTime(run.elapsedMs + run.penaltyMs)}</div>
    <div class="meta">
      <span>{run.daily ? `daily ${run.daily}` : `${run.mode} words`}</span>
      {#if run.penaltyMs > 0}
        <span class="pen">{formatTime(run.elapsedMs)} plus {(run.penaltyMs / 1000).toFixed(0)}s of penalties</span>
      {/if}
    </div>
  </div>

  <div class="standing">
    {#if outcome.pending}
      <p class="dim">saving</p>
    {:else if outcome.error}
      <p class="err">{outcome.error}</p>
    {:else if st}
      <div class="rankline">
        <span class="rank tabular">#{st.rank}</span>
        {#if st.gapToNext != null}
          <span class="gap">{formatDelta(st.gapToNext)}s off {st.nextName}</span>
        {:else}
          <span class="gap top">fastest time on the board</span>
        {/if}
      </div>

      <!-- A rank with nobody attached to it says nothing. These are the runs immediately
           faster and immediately slower, so the number has faces either side of it.
           Shown even when there is nobody else: a board of one still says where you
           stand, and an empty space where a board should be reads as a bug. -->
      {#if st.nearby}
        <ol class="near" style="--start: {Math.max(1, st.rank - st.nearby.above.length)}">
          {#each st.nearby.above as r}
            <li>
              {#if r.avatar_url}<img src={r.avatar_url} alt="" width="18" height="18" loading="lazy">{/if}
              <span class="who">{r.display_name}</span>
              <span class="t tabular">{formatTime(r.duration_ms)}</span>
            </li>
          {/each}
          <li class="you">
            <span class="dot" aria-hidden="true"></span>
            <span class="who">{user ? user.name : 'this run'}</span>
            <span class="t tabular">{formatTime(run.elapsedMs + run.penaltyMs)}</span>
          </li>
          {#each st.nearby.below as r}
            <li>
              {#if r.avatar_url}<img src={r.avatar_url} alt="" width="18" height="18" loading="lazy">{/if}
              <span class="who">{r.display_name}</span>
              <span class="t tabular">{formatTime(r.duration_ms)}</span>
            </li>
          {/each}
        </ol>
        <div class="boardnote">
          {#if !st.nearby.above.length && !st.nearby.below.length}
            <span class="alone">
              {run.daily ? 'Nobody else has finished today\'s daily yet.' : 'Nobody else has a time on this board yet.'}
            </span>
          {/if}
          <a class="fullboard" href={boardHref}>see the whole board</a>
        </div>
      {/if}
      {#if st.beatPersonalBest}
        <p class="pb best">A new personal best.</p>
      {:else if st.personalBest != null}
        <p class="pb">Your best on this mode is {formatTime(st.personalBest)}.</p>
      {/if}
      {#if outcome.saved}
        <p class="pb best">Saved to the board.</p>
      {:else if outcome.claimFailed}
        <p class="claim">
          That run could not be attached to your account. Claim links last an hour, so it
          may simply have taken too long.
        </p>
      {:else if !user}
        <p class="claim">
          This time is not on the board yet.
          <a href={loginHref}>Sign in with Discord</a> to keep it. You will come straight
          back here and the run will still be waiting.
        </p>
      {/if}
    {/if}
  </div>

  <div class="grid" aria-label="per word result">
    {#each squares as s, i}
      <span class="sq {s}" title="{run.words[i].word}  {(run.words[i].ms / 1000).toFixed(2)}s"></span>
    {/each}
  </div>

  <div class="actions">
    <button class="primary" bind:this={againBtn} onclick={onAgain}>
      {run.daily ? `Free play, ${run.mode} words` : 'Again'}
      <kbd>enter</kbd>
    </button>
    <button onclick={share}>{copied ? 'copied' : 'Share result'}</button>
    <a class="home" href="/">back</a>
  </div>

  {#if run.daily}
    <!-- "Again" would be a lie here: the daily is one scored attempt on a fixed set of
         words, so there is nothing to repeat until tomorrow. -->
    <p class="note">
      The daily is one scored go at the same words everyone else gets, so that is you
      done until tomorrow. The button above starts an ordinary {run.mode} word run
      instead.
    </p>
  {/if}

  {#if missed.length}
    <section class="missed">
      <h2 class="label">{plural(missed.length, 'word')} you got wrong</h2>
      <ul>
        {#each missed as m}
          <li>
            <button class="row" onclick={() => (openWord = openWord === m.word ? null : m.word)}>
              <span class="kr w">{m.word}</span>
              <span class="a">{m.answer}</span>
              <span class="n tabular">{m.misses}x</span>
            </button>
            {#if openWord === m.word}
              {@const full = run.words.find(w => w.word === m.word)}
              <Peek word={m.word} pron={full?.pron ?? m.word} compact />
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .results { padding: 52px 24px 90px; display: grid; gap: 30px; max-width: 780px; }

  .headline { display: grid; gap: 6px; }
  .time { font-size: clamp(46px, 12vw, 78px); color: var(--ink); line-height: 1; letter-spacing: -.02em; }
  .meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: var(--dim); }
  .meta .pen { color: var(--bad); opacity: .8; }

  .standing { display: grid; gap: 8px; }
  .rankline { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .rank { font-size: 22px; color: var(--accent); }
  .gap { font-size: 13px; color: var(--dim); }
  .gap.top { color: var(--good); }
  .pb { margin: 0; font-size: 13px; color: var(--dim); }
  .pb.best { color: var(--good); }
  .claim {
    margin: 6px 0 0;
    font-size: 13px;
    color: #8b8983;
    border-left: 1px solid var(--accent);
    padding-left: 14px;
    line-height: 1.6;
    max-width: 56ch;
  }
  .err { color: #e8b4ac; font-size: 13px; margin: 0; }

  .near {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: grid;
    max-width: 380px;
    counter-reset: place calc(var(--start, 1) - 1);
  }
  .near li {
    display: grid;
    grid-template-columns: 2.6em 18px minmax(0, 1fr) 6.4em;
    align-items: center;
    gap: 12px;
    padding: 7px 8px;
    font-size: 12.5px;
    border-bottom: 1px solid #1c1d21;
  }
  .near li::before {
    counter-increment: place;
    content: counter(place);
    color: var(--dimmer);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .near img { border-radius: 50%; display: block; }
  .near .who { color: #8b8983; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .near .t { text-align: right; color: var(--dim); }
  .near .you { background: var(--bg-lift); }
  .near .you .who { color: var(--ink); }
  .near .you .t { color: var(--accent); }
  .near .you .dot { width: 6px; height: 6px; background: var(--accent); justify-self: center; }
  .boardnote {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 8px;
    font-size: 12px;
  }
  .boardnote .alone { color: var(--dim); }
  .fullboard { font-size: 12px; }

  .grid { display: flex; flex-wrap: wrap; gap: 3px; max-width: 420px; }
  .sq { width: 13px; height: 13px; }
  .sq.green { background: #3f7a4f; }
  .sq.yellow { background: #a58a34; }
  .sq.red { background: #8d3a33; }

  .actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .actions .home { font-size: 12px; color: var(--dim); }
  .actions .primary { display: inline-flex; align-items: center; gap: 10px; }
  .actions .primary kbd { border-color: currentColor; opacity: .5; }

  .note { margin: 0; max-width: 58ch; font-size: 12.5px; color: var(--dim); line-height: 1.6; }

  .missed h2 { margin: 0 0 10px; }
  .missed ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
  .missed li { border-bottom: 1px solid var(--line); }
  .missed .row {
    display: flex;
    align-items: baseline;
    gap: 16px;
    width: 100%;
    border: 0;
    padding: 11px 2px;
    text-align: left;
  }
  .missed .row:hover { border: 0; background: var(--bg-lift); }
  .missed .w { font-size: 19px; color: var(--ink); min-width: 5em; }
  .missed .a { flex: 1; font-size: 13px; color: var(--accent); }
  .missed .n { font-size: 12px; color: var(--bad); }

  @media (max-width: 640px) {
    .results { padding: 30px 16px 70px; gap: 24px; }
  }
</style>
