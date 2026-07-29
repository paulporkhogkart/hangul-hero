<script>
  import { breakdown } from '@core/breakdown.mjs'
  import { isCorrect, diagnose, markAnswer, locateIndex } from '@core/answer.mjs'
  import { attributeMiss } from '@core/profile.mjs'
  import { missCost, REVEAL_PENALTY_MS } from '@core/scoring.mjs'
  import { play, speak, unlock } from '../lib/audio.svelte.js'
  import { api, formatTime } from '../lib/api.js'
  import WordAnalysis from '../components/WordAnalysis.svelte'

  let { words, mode, seed, daily = null, focus = false, user = null, onFinish } = $props()

  let index = $state(0)
  let typed = $state('')
  let status = $state('ready')       // ready | racing | done
  let startedAt = 0
  let wordStartedAt = 0
  let now = $state(0)
  let penaltyMs = $state(0)
  let misses = $state(0)             // on the current word
  let bought = $state(false)         // paid to see the answer for this word
  let hidden = $state(false)         // bought it, then chose to put it away
  let errorAt = $state(null)         // where the last miss diverged
  let split = $state(null)           // that miss, split into a good prefix and a bad tail
  let flash = $state(null)
  let hint = $state(null)
  let input = $state(null)
  const results = []

  /**
   * The mistake log, flushed to the server DURING the run rather than with it.
   *
   * POST /api/run only fires when a run completes, so everything learned in an
   * abandoned race used to evaporate, and abandoned races are not a corner case: a bad
   * start is precisely when someone quits. Events are batched to stay far inside the
   * rate limit (a per-word POST from a 500 run would trip it), sent in the background
   * on a cadence, and pushed out through sendBeacon when the tab itself goes away.
   *
   * A failed send is dropped without retry. This is study data, not a score; a retry
   * queue is more machinery than the data is worth.
   */
  const FLUSH_AT = 20
  const pending = []
  const fresh = () => ({ rules: new Set(), jamo: new Set(), kinds: new Set() })
  let faults = fresh() // what this word's misses have been pinned on, so far

  function flush(viaBeacon = false) {
    if (!user || !pending.length) return
    const payload = { mode, focus, events: pending.splice(0) }
    if (viaBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/attempts', new Blob([JSON.stringify(payload)], { type: 'application/json' }))
      return
    }
    api.attempts(payload).catch(() => {})
  }

  function record(e) {
    if (!user) return
    pending.push({ ...e, rules: [...faults.rules], jamo: [...faults.jamo], kinds: [...faults.kinds] })
    if (pending.length >= FLUSH_AT) flush()
  }

  // The word in progress when the page disappears still carries evidence, provided it
  // was actually fought with. If the player returns through the bfcache and then beats
  // the word, it is recorded a second time as completed; a rare, mildly duplicated
  // exposure is better than losing the common case.
  $effect(() => {
    if (!user) return
    const abandon = viaBeacon => {
      if (status === 'racing' && word && (misses > 0 || bought)) {
        record({ word: word.word, ms: Math.round(performance.now() - wordStartedAt), misses, peeked: bought })
      }
      flush(viaBeacon)
    }
    const onPagehide = () => abandon(true)
    window.addEventListener('pagehide', onPagehide)
    return () => {
      window.removeEventListener('pagehide', onPagehide)
      // Unmounting is the router leaving the page, so ordinary fetch still works.
      abandon(false)
    }
  })

  /**
   * The ladder. Each rung is charged for what it actually reveals.
   *
   *   miss 1   +5s    where you went wrong, without saying what is right
   *   miss 2   +25s   the jamo and the rules, which is nearly the whole answer
   *   miss 3+  free   nothing new is shown, so nothing more is charged
   *   Tab      +30s   the answer itself, with no attempt spent earning it
   *
   * Two misses cost 30s and Tab costs 30s, which is the point: they are worth about the
   * same, so they should cost about the same and the choice between them is real.
   */
  const REVEAL_PENALTY = REVEAL_PENALTY_MS

  const word = $derived(words[index])
  const parsed = $derived(word ? breakdown(word.word, word.pron) : null)
  const elapsed = $derived(status === 'ready' ? 0 : Math.max(0, now - startedAt))
  const shown = $derived(elapsed + penaltyMs)

  const reveal = $derived(
    hidden ? 'none'
      : bought ? 'full'
      : misses >= 2 ? 'structure'
      : 'none',
  )
  const showRules = $derived(reveal !== 'none')

  // The clock. Now that it shows milliseconds, a 33ms tick made the last digit jump in
  // visible steps, so it follows the display refresh instead.
  $effect(() => {
    if (status !== 'racing') return
    let raf = 0
    const tick = () => { now = performance.now(); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  /**
   * The input must never lose focus. Racing with a mouse is not a thing.
   *
   * The exception is selecting text, and getting this right took three attempts because
   * the obvious signals all fire at the wrong moment. `blur` arrives on mousedown, which
   * is BEFORE the drag has selected anything, so checking "is something selected" there
   * always said no and stole focus back on the first frame of every drag. Watching
   * `selectionchange` was worse, since mousedown also collapses the existing selection
   * and fired the same wrong answer.
   *
   * The honest signal is the pointer itself: while a button is held, a selection may be
   * in progress, so we do not touch focus at all. On release we take it back unless
   * something ended up selected.
   */
  let pointerHeld = $state(false)

  const hasSelection = () => {
    const sel = window.getSelection?.()
    return Boolean(sel && !sel.isCollapsed && String(sel).trim())
  }

  function refocus() {
    if (status === 'done' || pointerHeld || hasSelection()) return
    input?.focus({ preventScroll: true })
  }

  $effect(() => {
    void index
    refocus()
  })
  const keepFocus = () => queueMicrotask(refocus)

  $effect(() => {
    if (status === 'done') return
    const down = () => { pointerHeld = true }
    const up = () => { pointerHeld = false; setTimeout(refocus, 0) }
    document.addEventListener('pointerdown', down)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
    }
  })

  function begin() {
    if (status !== 'ready') return
    unlock()
    play('start')
    status = 'racing'
    startedAt = performance.now()
    wordStartedAt = startedAt
    now = startedAt
  }

  function nextWord() {
    typed = ''
    misses = 0
    hint = null
    errorAt = null
    split = null
    bought = false
    hidden = false
    faults = fresh()
  }

  function submit() {
    if (status !== 'racing' || !word) return
    const value = typed.trim()
    if (!value) return

    if (isCorrect(word, value)) {
      const ms = Math.round(performance.now() - wordStartedAt)
      results.push({
        word: word.word,
        answer: word.rr,
        pron: word.pron,
        ms,
        misses,
        peeked: bought,
      })
      record({ word: word.word, ms, misses, peeked: bought })
      play('correct')
      speak(word.word)
      flash = 'correct'
      setTimeout(() => (flash = null), 140)

      nextWord()
      if (index + 1 >= words.length) return finish()
      index += 1
      wordStartedAt = performance.now()
      return
    }

    penaltyMs += missCost(misses)
    misses += 1
    play('wrong')
    flash = 'wrong'
    setTimeout(() => (flash = null), 420)

    const marked = markAnswer(value, word.rr)
    split = marked
    errorAt = marked.firstBadIndex == null ? null : locateIndex(parsed.syllables, marked.firstBadIndex)

    const d = diagnose(word, value)

    // Pin this miss on whatever it is evidence against, before the next attempt
    // overwrites the marking. The union over a word's misses travels with its event.
    const fault = attributeMiss(parsed, marked, d)
    for (const r of fault.rules) faults.rules.add(r)
    for (const j of fault.jamo) faults.jamo.add(j)
    if (d.kind) faults.kinds.add(d.kind)

    const wrongCount = marked.marks.filter(m => !m.ok).length
    hint = marked.truncated
      ? 'Right as far as it goes, but there is more to come.'
      : marked.missing
        ? 'Something is missing from the middle.'
        : wrongCount === 1
          ? 'One character out.'
          : d.note ?? null

    // Put the caret on the first wrong character rather than selecting everything after
    // it. Now that the marking is per character, the answer is often right on both sides
    // of the mistake, and wiping the tail would throw away work that was correct.
    const firstWrong = marked.marks.findIndex(m => !m.ok)
    queueMicrotask(() => {
      if (!input) return
      input.focus({ preventScroll: true })
      const at = firstWrong < 0 ? typed.length : firstWrong
      input.setSelectionRange(at, firstWrong < 0 ? at : at + 1)
    })
  }

  function finish() {
    status = 'done'
    play('finish')
    flush()
    onFinish({
      seed, mode, daily,
      elapsedMs: Math.round(performance.now() - startedAt),
      penaltyMs,
      misses: results.reduce((n, r) => n + r.misses, 0),
      peeks: results.filter(r => r.peeked).length,
      words: results,
    })
  }

  /** Tab buys the answer. Once bought it is paid for, so hiding and showing is free. */
  function toggleReveal() {
    if (status !== 'racing') return
    if (!bought) {
      bought = true
      hidden = false
      penaltyMs += REVEAL_PENALTY
      play('wrong')
    } else {
      hidden = !hidden
      play('peek')
    }
    keepFocus()
  }

  function onKeydown(e) {
    if (e.key === 'Tab' || e.key === '`' || e.key === '~') { e.preventDefault(); toggleReveal(); return }
    if (e.key === 'Enter') { e.preventDefault(); submit() }
  }

  /** The keystroke that starts a run must not also be typed. Swallowing it here is the
   *  only reliable way: once the input has focus the browser is already committed. */
  function onWindowKeydown(e) {
    if (status !== 'ready') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key.length === 1 || e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') {
      e.preventDefault()
      begin()
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="race" class:flash-ok={flash === 'correct'} class:flash-bad={flash === 'wrong'}>
  <header class="bar shell">
    <span class="label">{daily ? 'Daily' : `${mode} words`}</span>
    <span class="progress tabular">{index + (status === 'done' ? 0 : 1)} / {words.length}</span>
    <span class="spacer"></span>
    {#if penaltyMs > 0}<span class="pen tabular">+{(penaltyMs / 1000).toFixed(0)}s</span>{/if}
    <span class="clock tabular">{formatTime(shown)}</span>
  </header>

  <!-- Before a run there is no annotation headroom and no explanation, so the three row
       layout that keeps the word still would strand this message high on the screen.
       Nothing needs anchoring yet, so centre it in the whole stage. -->
  <main class="stage shell" class:waiting={status === 'ready'}>
    <div class="pad"></div>

    <div class="core">
      {#if status === 'ready'}
        <p class="ready">Press any key to start</p>
      {:else if word}
        <div class="wordblock">
          <WordAnalysis syllables={parsed.syllables} {reveal} {errorAt} />
          <div class="gloss">{word.meaning}</div>
          {#if word.definition}<div class="context">{word.definition}</div>{/if}
        </div>

        <div class="field" class:bad={flash === 'wrong'}>
          {#if split}
            <!-- A mirror of what was typed, one span per character, because an input
                 cannot colour part of its own value. -->
            <div class="mirror" aria-hidden="true">{#each split.marks as m}<span class:bad={!m.ok}>{m.ch}</span>{/each}</div>
          {/if}
          <input
            bind:this={input}
            bind:value={typed}
            oninput={() => { split = null }}
            onkeydown={onKeydown}
            onblur={keepFocus}
            class:ghosted={Boolean(split)}
            type="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="go"
            aria-label="romanization"
          />
        </div>
      {/if}
    </div>

    <!--
      One place for "why", used by both paths that produce one. Anchored to the top of
      the space below the input and allowed to grow downward into room that already
      exists, so the word never moves and a scrollbar only appears when the viewport
      genuinely has nothing left to give.
    -->
    <div class="explain" aria-live="polite">
      {#if hint}
        <p class="row miss"><span class="what">Miss</span><span class="text">{hint}</span></p>
      {/if}
      {#if showRules && parsed}
        {#each parsed.changes as c}
          <p class="row" class:unwritten={!c.reflected}>
            <span class="what">{c.title}</span>
            <span class="text">
              {c.text}
              {#if c.why}<span class="why">{c.why}</span>{/if}
            </span>
          </p>
        {/each}
        {#if !parsed.changes.length}
          <p class="row"><span class="what">No change</span><span class="text">It is read exactly as it is written.</span></p>
        {/if}
      {/if}
    </div>
  </main>

  <footer class="bar shell">
    <button class="bare peek-btn" class:spent={bought} onclick={toggleReveal}>
      <kbd>tab</kbd>
      <span>{bought ? (hidden ? 'show answer' : 'hide answer') : 'show the answer'}</span>
      <span class="cost">{bought ? 'paid for this word' : `+${REVEAL_PENALTY / 1000}s`}</span>
    </button>
    <span class="spacer"></span>
    <span class="label keys"><kbd>enter</kbd> submit</span>
  </footer>
</div>

<style>
  .race { display: flex; flex-direction: column; flex: 1; min-height: 0; }

  .bar { display: flex; align-items: center; gap: 18px; padding-block: 16px; }
  .bar .spacer { flex: 1; }
  .progress { font-size: 12px; color: var(--dimmer); }
  .pen { font-size: 12px; color: var(--bad); }
  .clock { font-size: 15px; color: var(--accent); }

  /* Three rows: a little breathing room, the anchored core, then everything else for the
     explanation to grow into. The core sits in the middle row and never moves.
     The top row used to take an equal share, which was dead space above a word that
     already reserves its own headroom for the annotation. Giving most of it to the
     bottom row is what lets several rules show without a scrollbar. */
  .stage {
    flex: 1;
    display: grid;
    grid-template-rows: minmax(0, .34fr) auto minmax(0, 1.66fr);
    justify-items: center;
    text-align: center;
    min-height: 0;
  }
  .stage.waiting { grid-template-rows: 1fr auto 1fr; }
  .core { display: grid; justify-items: center; }
  .ready { color: var(--dim); font-size: 14px; letter-spacing: .04em; }

  .wordblock { width: 100%; display: grid; justify-items: center; }
  .gloss { font-size: 13px; color: var(--dim); margin-top: 8px; letter-spacing: .02em; }
  .context { font-size: 11.5px; color: var(--dimmer); margin-top: 4px; max-width: 52ch; line-height: 1.5; }

  /* The mirror has to match the input exactly or the colouring drifts off the letters. */
  .field { position: relative; margin-top: 40px; width: min(440px, 100%); }
  .field input,
  .field .mirror {
    width: 100%;
    padding: 6px 2px 10px;
    text-align: center;
    font-family: var(--mono);
    font-size: clamp(24px, 6vw, 30px);
    letter-spacing: .02em;
    line-height: 1.3;
  }
  .field input {
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--line);
    color: var(--accent);
    caret-color: var(--accent);
    position: relative;
    z-index: 1;
  }
  .field input:focus { outline: none; border-bottom-color: var(--dimmer); }
  .field input.ghosted { color: transparent; }
  /* Translucent, so the coloured mirror underneath still reads through the selection. */
  .field input::selection { background: rgba(212, 102, 79, .22); }

  .mirror {
    position: absolute;
    inset: 0;
    pointer-events: none;
    white-space: pre;
    z-index: 0;
  }
  .mirror span { color: var(--accent); }
  .mirror span.bad { color: var(--bad); background: rgba(212, 102, 79, .16); }

  .field.bad input { border-bottom-color: var(--bad); animation: shake .32s; }

  /* Label right aligned against the prose, so the rule names stack into a readable
     column instead of scattering along the left edge of each paragraph. */
  /* Shrink to fit rather than filling a fixed 680px. A single short line like "No
     change" sat left of centre in a wide invisible box; sized to its content, the block
     itself centres and the line sits where the eye expects it. */
  .explain {
    align-self: start;
    margin-top: 16px;
    width: fit-content;
    max-width: min(680px, 100%);
    max-height: 100%;
    overflow-y: auto;
    display: grid;
    gap: 8px;
    align-content: start;
    text-align: left;
  }
  /* Subgrid, so every row shares one label column sized to the longest label. A fixed
     width truncated "Nasal assimilation" and "Inserted ㄴ, then ㄹ", and a rule name is
     the one part that must never be cut short. */
  .explain { grid-template-columns: max-content minmax(0, 52ch); }
  .explain .row {
    margin: 0;
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    gap: 14px;
    font-size: 12.5px;
    line-height: 1.55;
    /* Same curve and duration as the panel above, landing just after it, so the whole
       thing reads as one movement running down the screen. */
    animation: rise 190ms cubic-bezier(.2, .8, .2, 1) 70ms backwards;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(7px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .explain .what { text-align: right; color: var(--accent); }
  .explain .text { color: #8b8983; }
  .explain .why { color: #6a6964; }
  .explain .why::before { content: " "; }
  .explain .miss .what { color: var(--bad); }
  .explain .miss .text { color: var(--bad); }
  /* A muted gold rather than grey. These are real rules and belong to the same family,
     but they change what you HEAR and not what you TYPE, and that distinction is worth
     being able to see at a glance without reading the sentence. */
  .explain .unwritten .what { color: #96813f; }

  .peek-btn { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; }
  .peek-btn .cost { color: var(--bad); font-size: 11px; letter-spacing: .04em; }
  .peek-btn.spent .cost { color: var(--dimmer); }
  .keys { display: flex; align-items: center; gap: 7px; }

  /* Correct is a whisper: a 140ms edge lift that never delays the next word. */
  .flash-ok .field input { color: var(--good); border-bottom-color: var(--good); }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-7px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(2px); }
  }

  @media (max-width: 640px) {
    .stage { grid-template-rows: .6fr auto minmax(0, 1.4fr); }
    .field { margin-top: 26px; }
    .context { display: none; }
    .keys { display: none; }
    .explain { margin-top: 12px; gap: 6px; grid-template-columns: 1fr; }
    .explain .row { grid-template-columns: 1fr; gap: 1px; font-size: 11.5px; }
    .explain .what { text-align: left; }
  }
</style>
