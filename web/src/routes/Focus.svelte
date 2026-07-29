<script>
  import { api, formatTime } from '../lib/api.js'
  import Race from './Race.svelte'

  let { user, config, loginHref } = $props()

  // loading | anon | notReady | ready | racing | done | error
  let state = $state('loading')
  let data = $state(null)     // the /api/focus response: seed, words, profile
  let run = $state(null)      // what Race hands back when the drill ends
  let count = $state(10)
  let error = $state(null)

  const SLOT = { initial: 'initial', vowel: 'vowel', final: 'final' }
  const pct = rate => `${Math.round(rate * 100)}%`

  // Rules that change what you hear but not what you type. Shown with a tag, because
  // "you miss tensing" without it reads as a contradiction: the miss it names is
  // typing the sound instead of the spelling.
  const UNWRITTEN = new Set(['tensification', 'vowelheld'])

  async function load(n) {
    count = n
    state = 'loading'
    error = null
    run = null
    try {
      data = await api.focus(n)
      state = data.ready ? 'ready' : 'notReady'
    } catch (e) {
      error = e.message
      state = e.status === 401 ? 'anon' : 'error'
    }
  }

  // user is null both before /api/me answers and when nobody is signed in; config
  // arrives with it, so config alone says whether "no user" is an answer or a wait.
  $effect(() => {
    if (!config) return
    if (!user) { state = 'anon'; return }
    if (state !== 'loading') return
    load(10)
  })

  function finished(payload) {
    run = payload
    state = 'done'
  }

  const missed = $derived(run ? run.words.filter(w => w.misses > 0 || w.peeked) : [])
</script>

<!-- The race takes the whole stage, exactly as it does from App: mounted inside the
     padded shell it would inherit a title and margins the timer has no use for. -->
{#if state === 'racing'}
  {#key data.seed}
    <Race words={data.words} mode={data.words.length} seed={data.seed} focus={true} {user} onFinish={finished} />
  {/key}
{:else}
<div class="focus shell">
  <h1 class="title">Focus</h1>

  {#if state === 'loading'}
    <p class="dim">Reading your mistakes...</p>
  {:else if state === 'anon'}
    <p class="dim">
      Focus drills the mistakes you personally keep making, which means someone has to
      remember them. <a href={loginHref}>Sign in</a> and every run starts feeding the
      profile, mid-run, whether or not you finish.
    </p>
  {:else if state === 'error'}
    <p class="err">{error}</p>
  {:else if state === 'notReady'}
    <p class="dim">
      Not enough evidence yet: {data.have} of the {data.need} recorded attempts a profile
      needs. Play a few races (finished or not, they all count) and come back.
    </p>
  {:else if state === 'ready'}
    <!-- The diagnosis first, so the drill is an argument rather than a mystery: these
         are the words you will see and this is why you are seeing them. -->
    <section class="report">
      {#if data.profile.rules.length}
        <div class="block">
          <h2>Rules you miss</h2>
          {#each data.profile.rules as r}
            <p class="row">
              <span class="what">{r.name}{#if UNWRITTEN.has(r.key)} <span class="slot">heard, never written</span>{/if}</span>
              <span class="stat tabular">{pct(r.rate)}</span>
              <span class="n">of {r.exposures} met</span>
            </p>
          {/each}
        </div>
      {/if}
      {#if data.profile.jamo.length}
        <div class="block">
          <h2>Letters that trip you</h2>
          {#each data.profile.jamo as j}
            <p class="row">
              <span class="what">{j.key.split(':')[1]} <span class="slot">{SLOT[j.key.split(':')[0]]}</span></span>
              <span class="stat tabular">{pct(j.rate)}</span>
              <span class="n">of {j.exposures} met</span>
            </p>
          {/each}
        </div>
      {/if}
      {#if data.profile.words.length}
        <div class="block">
          <h2>Words that beat you</h2>
          {#each data.profile.words.slice(0, 6) as w}
            <p class="row">
              <span class="what ko">{w.word}</span>
              <span class="rr">{w.rr}</span>
              <span class="n">{w.meaning}</span>
            </p>
          {/each}
        </div>
      {/if}
    </section>

    <section class="go">
      <div class="counts">
        {#each [10, 25, 50] as n}
          <button class="count" class:on={count === n} onclick={() => load(n)}>
            <span class="tabular">{n}</span> words
          </button>
        {/each}
      </div>
      <button class="start" onclick={() => (state = 'racing')}>
        <span class="d">Start the drill</span>
        <span class="dsub">your missed words, plus fresh ones built on the same rules. Never ranked.</span>
      </button>
    </section>
  {:else if state === 'done'}
    <section class="report">
      <p class="sum">
        {formatTime(run.elapsedMs + run.penaltyMs)} over {run.words.length} words,
        {run.misses === 0 && run.peeks === 0 ? 'nothing missed.' : `${run.misses} ${run.misses === 1 ? 'miss' : 'misses'}${run.peeks ? ` and ${run.peeks} peeked` : ''}.`}
      </p>
      {#if missed.length}
        <div class="block">
          <h2>Still fighting you</h2>
          {#each missed as w}
            <p class="row">
              <span class="what ko">{w.word}</span>
              <span class="rr">{w.answer}</span>
              <span class="n">{w.peeked ? 'peeked' : `${w.misses} ${w.misses === 1 ? 'miss' : 'misses'}`}</span>
            </p>
          {/each}
        </div>
      {:else}
        <p class="dim">Clean. The profile has already taken note, and tomorrow's drill will chase whatever is left.</p>
      {/if}
      <div class="again">
        <button class="start" onclick={() => load(count)}><span class="d">Drill again</span></button>
        <a class="home" href="/">home</a>
      </div>
    </section>
  {/if}
</div>
{/if}

<style>
  .focus { padding: 44px 24px 90px; display: grid; gap: 30px; align-content: start; }
  .title {
    margin: 0;
    font-size: 13px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 400;
  }
  .dim { margin: 0; max-width: 58ch; font-size: 13px; color: var(--dim); line-height: 1.65; }
  .err { color: var(--bad); font-size: 13px; }

  .report { display: grid; gap: 26px; max-width: 560px; }
  .sum { margin: 0; font-size: 15px; color: var(--ink); }
  .block { display: grid; gap: 7px; }
  .block h2 {
    margin: 0 0 3px;
    font-size: 11px;
    letter-spacing: .12em;
    text-transform: uppercase;
    font-weight: 400;
    color: var(--dimmer);
  }
  .row {
    margin: 0;
    display: grid;
    grid-template-columns: minmax(150px, max-content) max-content 1fr;
    gap: 14px;
    align-items: baseline;
    font-size: 12.5px;
  }
  .row .what { color: var(--ink); }
  .row .ko { font-size: 15px; }
  .row .slot { color: var(--dimmer); font-size: 11px; letter-spacing: .06em; }
  .row .stat { color: var(--bad); }
  .row .rr { color: var(--accent); font-family: var(--mono); }
  .row .n { color: var(--dimmer); font-size: 11.5px; }

  .go { display: grid; gap: 14px; max-width: 560px; }
  .counts { display: flex; gap: 8px; }
  .count { padding: 8px 14px; font-size: 12px; border-color: var(--line); color: var(--dim); }
  .count.on { border-color: var(--accent); color: var(--ink); }
  .start {
    display: grid;
    justify-items: start;
    gap: 3px;
    padding: 16px 18px;
    border-color: var(--line);
    text-align: left;
  }
  .start:hover { border-color: var(--accent); }
  .start .d { font-size: 15px; color: var(--accent); letter-spacing: .04em; }
  .start .dsub { font-size: 12px; color: var(--dim); }

  .again { display: flex; align-items: center; gap: 18px; }
  .again .home { font-size: 12px; color: var(--dim); }

  @media (max-width: 640px) {
    .focus { padding: 28px 16px 70px; }
    .row { grid-template-columns: minmax(110px, max-content) max-content 1fr; gap: 10px; }
  }
</style>
