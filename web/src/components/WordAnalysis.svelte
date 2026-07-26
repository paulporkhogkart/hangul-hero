<script>
  /**
   * The word and its breakdown are one object. Each syllable owns a column, and its
   * annotation sits in the same column directly above it, so the two line up
   * structurally rather than by me guessing at offsets.
   *
   * Detail increases upward. Nearest the syllable is what you type, then how it is
   * actually said, then the individual jamo. The eye travels the shortest distance to
   * the thing it needs most.
   *
   * The annotation row is reserved whether or not it is showing, which is why the word
   * sits lower on the screen than it otherwise would. Nothing moves when the panel
   * opens. In a race, an interface that shifts under you is worse than one that shows
   * you less.
   *
   * `reveal` is the hint ladder, and the levels differ in kind rather than degree:
   *   none      just the word
   *   structure jamo and the spoken form, but never the romanization
   *   full      everything, including what to type
   * Earning your way up by missing gets you `structure`. Only paying for it gets you
   * `full`, which is what stops the cheap path from dominating the expensive one.
   */
  let { syllables, reveal = 'none', errorAt = null } = $props()

  const open = $derived(reveal !== 'none')
  const showAnswer = $derived(reveal === 'full')

  let wordRow = $state(null)

  /**
   * Each syllable is its own grid item, and browsers put a line break between block
   * boundaries when serialising a selection, so copying 한국어 would otherwise paste as
   * three lines. When the selection is entirely inside the word we hand over the clean
   * text instead. Selections that reach outside it are left alone.
   */
  function onCopy(e) {
    const sel = window.getSelection?.()
    if (!sel || sel.isCollapsed || !wordRow) return
    if (!wordRow.contains(sel.anchorNode) || !wordRow.contains(sel.focusNode)) return
    e.clipboardData?.setData('text/plain', sel.toString().replace(/\s+/g, ''))
    e.preventDefault()
  }
</script>

<!--
  Two rows, each a subgrid sharing the same columns. Annotations come first in the
  document and the word second, which is what makes the word a contiguous run of text:
  interleaving them per column meant dragging across 한국어 necessarily swept up the
  jamo sitting between the syllables, and there was no way to select the word alone.
  Visual alignment is unaffected, because the shared columns do that, not source order.
-->
<div class="analysis" class:open>
  <div class="grid" style="--n: {syllables.length}">
    <div class="row annos" aria-hidden={!open}>
      {#each syllables as s, i}
        <div class="anno" style="grid-column: {i + 1}; --i: {i}">
          {#if open}
            <div class="jamo">
              {#each s.jamo as j, k}
                <span
                  class="j {j.fate}"
                  class:wrong={errorAt && errorAt.syllable === i && errorAt.jamo === k}
                >
                  <b class="kr">{j.jamo}</b>
                  <!--
                    What this jamo contributes to THIS word, not its dictionary value.
                    A final that crossed into the next syllable shows an arrow rather
                    than a letter it does not supply here, and one that stopped being
                    pronounced shows nothing at all. The letters in a column now add up
                    to the syllable printed under them.
                  -->
                  <i
                    class:none={!j.rr}
                    title={j.fate === 'moved' ? 'moves into the next syllable'
                      : j.fate === 'fused' ? 'merges into the next consonant'
                      : j.fate === 'arrived' ? 'carried over from the syllable before'
                      : j.fate === 'silent' ? 'makes no sound here'
                      : null}
                  >{j.fate === 'moved' || j.fate === 'fused' ? '→'
                    : j.fate === 'arrived' ? `←${j.rr}`
                    : (j.rr || '··')}</i>
                </span>
              {/each}
            </div>
            {#if s.spoken && s.spoken !== s.char}
              <div class="spoken kr">{s.spoken}</div>
            {/if}
            {#if showAnswer}
              <div class="rr">{s.rr}</div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>

    <div class="row word" bind:this={wordRow} oncopy={onCopy}>
      {#each syllables as s, i}
        <span
          class="big kr"
          style="grid-column: {i + 1}"
          class:changed={s.spoken && s.spoken !== s.char}
          class:wrong={errorAt && errorAt.syllable === i}
        >{s.char}</span>
      {/each}
    </div>
  </div>
</div>

<style>
  .analysis { position: relative; display: grid; justify-items: center; }

  /* One duration and one curve for everything that moves when the panel opens. Three
     slightly different timings read as three things loading rather than one thing
     happening. */
  .analysis { --ease: cubic-bezier(.2, .8, .2, 1); --dur: 190ms; }

  .grid {
    display: grid;
    grid-template-columns: repeat(var(--n), auto);
    justify-content: center;
    /* The word opens up to make room. Closed, this is ordinary letter spacing. */
    column-gap: 4px;
    transition: column-gap var(--dur) var(--ease);
  }
  .analysis.open .grid { column-gap: 34px; }

  /* Both rows span the full grid and inherit its columns, so alignment survives the
     document order being annotations first and word second. */
  .row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    justify-items: center;
  }
  /* Reserved, always. This is what keeps the word still. */
  .annos { align-items: end; min-height: 148px; }
  .word { align-items: end; }

  .anno {
    display: grid;
    align-content: end;
    justify-items: center;
    gap: 5px;
    padding-bottom: 12px;
    /* Backwards fill, so a delayed column holds its start state instead of flashing at
       full opacity and then animating. That flash was most of what read as "loading". */
    animation: rise var(--dur) var(--ease) backwards;
    animation-delay: calc(var(--i, 0) * 22ms);
  }

  .jamo { display: grid; gap: 1px; justify-items: center; }
  .j { display: flex; align-items: baseline; gap: 6px; padding: 0 5px; }
  .j b { font-weight: 400; font-size: 15px; color: #8d8b85; }
  .j i { font-style: normal; font-size: 11px; color: var(--dimmer); }
  .j i.none { opacity: .55; letter-spacing: .08em; }
  /* A jamo that is doing something out of the ordinary is worth spotting before the
     prose underneath is read. */
  .j.moved i, .j.fused i, .j.arrived i { color: var(--accent); opacity: .8; }
  .j.changed i { color: var(--accent); opacity: .95; }
  .j.silent b { opacity: .5; }
  .j.wrong { background: rgba(212, 102, 79, .14); }
  .j.wrong b { color: var(--bad); }
  .j.wrong i { color: var(--bad); opacity: .8; }

  .spoken { font-size: 15px; color: var(--accent); opacity: .75; line-height: 1.2; }
  .spoken::before { content: "["; opacity: .45; }
  .spoken::after { content: "]"; opacity: .45; }

  /* Closest to the syllable, because it is the thing you are about to type. */
  .rr { font-size: 15px; color: var(--accent); letter-spacing: .02em; }

  .big {
    font-size: clamp(46px, 11vw, 88px);
    font-weight: 500;
    color: var(--ink);
    line-height: 1.15;
    transition: color .18s;
  }
  .analysis.open .big.changed { color: var(--accent); }
  /* Wins over the amber, because where you went wrong matters more right now than
     which syllables happen to shift. */
  .big.wrong, .analysis.open .big.changed.wrong { color: var(--bad); }

  @keyframes rise {
    from { opacity: 0; transform: translateY(9px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 640px) {
    .annos { min-height: 112px; }
    .analysis.open .grid { column-gap: 20px; }
    .j b { font-size: 13px; }
    .j i { font-size: 10px; }
    .spoken, .rr { font-size: 13px; }
  }
</style>
