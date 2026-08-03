<script>
  import { REVEAL_PENALTY_MS } from '@core/scoring.mjs'
  import { localDate, prefetchRun, prefetchDaily } from '../lib/api.js'

  let { config, user, onStart } = $props()

  const MODES = [10, 25, 50, 100, 250, 500]

  // A pointer settling on a button is the earliest honest signal of which run is about
  // to be asked for, so the fetch starts here and the click finds its words already
  // in hand. On touch there is no hover, but pointerenter still fires just ahead of
  // the tap, so the two requests collapse into the same in-flight fetch.
</script>

<div class="home shell">
  <h1 class="sr-only">Hangul Hero</h1>

  <!-- What the thing is and what an account is for, before you have to choose anything.
       The controls stay at the bottom, where they are reference rather than preamble. -->
  <section class="facts">
    <!-- Two sentences, two lines. Letting them run together meant "Every" dangled at the
         end of the first line, orphaned from the clause it belongs to. -->
    <p class="lede">
      <span class="count">{#if config}{config.words.toLocaleString()}{:else}&nbsp;{/if} words.</span>
      <span class="from">Every pronunciation and meaning from <span class="src">국립국어원.</span></span>
    </p>
    <p>
      {#if user}
        You are logged in.
      {:else}
        Play without an account. Signing in only puts a time on the board, and you can do
        that after a run rather than before one.
      {/if}
    </p>
  </section>

  <section class="pick">
    <div class="modes">
      {#each MODES as m}
        <button
          class="mode"
          onclick={() => onStart({ mode: m })}
          onpointerenter={() => prefetchRun(m)}
          onfocus={() => prefetchRun(m)}
        >
          <span class="n tabular">{m}</span>
          <span class="w">words</span>
        </button>
      {/each}
    </div>

    <button
      class="daily"
      onclick={() => onStart({ mode: 25, daily: true })}
      onpointerenter={() => prefetchDaily(25, localDate())}
      onfocus={() => prefetchDaily(25, localDate())}
    >
      <span class="d">Daily</span>
      <span class="dsub">25 words, same for everyone, one scored go</span>
    </button>

    <a class="focus" href="/focus">
      <span class="d">Focus</span>
      <span class="dsub">
        {user
          ? 'a drill built from the mistakes you keep making'
          : 'sign in and it learns exactly what you keep missing'}
      </span>
    </a>
  </section>

  <p class="keys">
    <span><kbd>enter</kbd> submit</span>
    <span><kbd>tab</kbd> show the answer, <b>+{REVEAL_PENALTY_MS / 1000}s</b></span>
  </p>
</div>

<style>
  .home { padding: 64px 24px 90px; display: grid; gap: 40px; }

  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    margin: -1px; padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .pick { display: grid; gap: 22px; }

  .modes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
    gap: 10px;
  }
  .mode {
    display: grid;
    justify-items: start;
    gap: 2px;
    padding: 18px 18px 16px;
    border-color: var(--line);
  }
  .mode:hover { border-color: var(--accent); }
  .mode .n { font-size: 26px; color: var(--ink); line-height: 1; }
  .mode:hover .n { color: var(--accent); }
  .mode .w { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--dimmer); }

  .daily {
    display: grid;
    justify-items: start;
    gap: 3px;
    padding: 16px 18px;
    border-color: var(--line);
    text-align: left;
  }
  .daily:hover { border-color: var(--accent); }
  .daily .d { font-size: 15px; color: var(--accent); letter-spacing: .04em; }
  .daily .dsub { font-size: 12px; color: var(--dim); }

  /* A link dressed as the daily button, since it goes to a page rather than into a
     run: the profile deserves a look before the drill starts. */
  .focus {
    display: grid;
    justify-items: start;
    gap: 3px;
    padding: 16px 18px;
    border: 1px solid var(--line);
    text-align: left;
    text-decoration: none;
  }
  .focus:hover { border-color: var(--accent); }
  .focus .d { font-size: 15px; color: var(--accent); letter-spacing: .04em; }
  .focus .dsub { font-size: 12px; color: var(--dim); }

  .facts { display: grid; gap: 12px; max-width: 62ch; }
  .facts p { margin: 0; font-size: 12.5px; color: var(--dim); line-height: 1.65; }
  .facts .lede {
    font-size: clamp(19px, 3vw, 25px);
    line-height: 1.4;
    color: var(--ink);
    letter-spacing: -.01em;
    max-width: 34ch;
    /* Korean breaks between any two characters by default, which is how 국립국어 ended
       up on one line and a lonely 원. on the next. keep-all treats it as a word. */
    word-break: keep-all;
    text-wrap: balance;
  }
  .facts .lede .count,
  .facts .lede .from { display: block; }
  /* Subordinate in size as well as colour. Dimming alone left it competing with the
     count for the same weight while looking like it had simply been greyed out. */
  .facts .lede .from {
    color: var(--dim);
    font-size: .62em;
    line-height: 1.5;
    margin-top: 6px;
  }
  .facts .lede .src { white-space: nowrap; }

  .keys {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    margin: 0;
    font-size: 12.5px;
    color: var(--dimmer);
  }
  .keys b { color: var(--bad); font-weight: 400; }

  @media (max-width: 640px) {
    .home { padding: 34px 16px 70px; gap: 30px; }
    .modes { grid-template-columns: repeat(3, 1fr); }
    .mode { padding: 14px; }
    .mode .n { font-size: 21px; }
  }
</style>
