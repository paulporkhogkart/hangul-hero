<script>
  import { breakdown } from '@core/breakdown.mjs'

  let { word, pron, compact = false } = $props()
  const b = $derived(breakdown(word, pron))
</script>

<div class="peek" class:compact>
  <div class="syls">
    {#each b.syllables as s}
      <div class="syl" class:changed={s.changed}>
        <div class="han kr">{s.char}</div>
        {#if s.spoken && s.spoken !== s.char}
          <div class="spoken kr" title="how it is actually said">{s.spoken}</div>
        {/if}
        <div class="jamo">
          {#each s.jamo as j}
            <div class="j">
              <b class="kr">{j.jamo}</b>
              <i>{j.rr || 'silent'}</i>
              {#if j.parts}<u class="kr">{j.parts[0]}+{j.parts[1]}</u>{/if}
            </div>
          {/each}
        </div>
        <div class="rr">{s.rr}</div>
      </div>
    {/each}
  </div>

  {#if b.changes.length}
    <ul class="changes">
      {#each b.changes as c}
        <li class:unwritten={!c.reflected}>
          <span class="title">{c.title}</span>
          <span class="text">{c.text}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="result">
    <span class="kr">{b.word}</span>
    <span class="arrow">to</span>
    <span class="kr spoken-full">{b.spoken}</span>
    <span class="arrow">to</span>
    <span class="final">{b.rr}</span>
  </div>
</div>

<style>
  .peek {
    border-top: 1px solid var(--line);
    padding-top: 16px;
    width: 100%;
  }
  .syls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 26px;
    justify-content: center;
  }
  .syl {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 4px 8px 6px;
    border-bottom: 1px solid transparent;
  }
  .syl.changed { border-bottom-color: var(--dimmer); }
  .han { font-size: 26px; color: var(--ink); line-height: 1.2; }
  .spoken {
    font-size: 13px;
    color: var(--accent);
    line-height: 1.1;
    margin-top: -2px;
  }
  .spoken::before { content: "["; opacity: .5; }
  .spoken::after { content: "]"; opacity: .5; }
  .jamo { display: grid; gap: 1px; margin-top: 4px; }
  .j { display: flex; align-items: baseline; gap: 6px; }
  .j b { font-weight: 400; font-size: 14px; color: #8d8b85; min-width: 1.2em; }
  .j i { font-style: normal; font-size: 11.5px; color: var(--dimmer); }
  .j u { text-decoration: none; font-size: 10.5px; color: var(--dimmer); opacity: .7; }
  .rr { font-size: 13px; color: var(--accent); margin-top: 5px; }

  .changes {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
    max-width: 66ch;
    margin-inline: auto;
  }
  .changes li { font-size: 12.5px; color: #8b8983; line-height: 1.5; }
  .changes .title {
    color: var(--accent);
    margin-right: 8px;
  }
  .changes li.unwritten .title { color: var(--dim); }
  .changes li.unwritten { color: #6f6e69; }

  .result {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
    font-size: 15px;
    color: var(--dim);
  }
  .result .kr { color: var(--body); }
  .result .spoken-full { color: var(--accent); opacity: .85; }
  .result .arrow { font-size: 11px; letter-spacing: .1em; color: var(--dimmer); text-transform: uppercase; }
  .result .final { color: var(--ink); }

  .compact .han { font-size: 22px; }
  .compact .changes { font-size: 12px; }

  @media (max-width: 640px) {
    .syls { gap: 6px 16px; }
    .han { font-size: 22px; }
    .j b { font-size: 13px; }
  }
</style>
