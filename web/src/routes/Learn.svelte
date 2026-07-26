<script>
  import { INITIALS, VOWELS, FINALS, FINAL_PARTS, VOWEL_PARTS } from '@core/hangul.mjs'
  import { INITIAL_RR, VOWEL_RR, FINAL_RR } from '@core/rr.mjs'
  import Peek from '../components/Peek.svelte'

  // Same tables the grader uses, so this page cannot drift from what the game marks
  // correct. If a romanization is wrong here it is wrong everywhere.
  const initials = INITIALS.map(j => ({ j, rr: INITIAL_RR[j] }))
  const vowels = VOWELS.map(j => ({ j, rr: VOWEL_RR[j], parts: VOWEL_PARTS[j] ?? null }))
  const finals = FINALS.filter(Boolean).map(j => ({ j, rr: FINAL_RR[j], parts: FINAL_PARTS[j] ?? null }))

  // One worked example per statutory rule, each printed in the statute itself.
  const RULES = [
    {
      title: 'Liaison',
      korean: '연음',
      body: 'A final consonant with an empty ㅇ after it does not stay put. It slides across and is read at the start of the next syllable.',
      examples: [['한국어', '한ː구거'], ['음악', '으막'], ['설악', '서락']],
    },
    {
      title: 'Nasal assimilation',
      korean: '비음화',
      body: 'A stop cannot be held in front of a nasal, so it becomes the nasal made in the same part of the mouth. This one is reflected in the spelling.',
      examples: [['독립', '동닙'], ['백마', '뱅마'], ['왕십리', '왕심니']],
    },
    {
      title: 'ㄴ and ㄹ meeting',
      korean: '유음화',
      body: 'ㄴ next to ㄹ is awkward to say, so the ㄴ gives way and both come out as ㄹ. Written ll.',
      examples: [['신라', '실라'], ['별내', '별래'], ['대관령', '대괄령']],
    },
    {
      title: 'Palatalisation',
      korean: '구개음화',
      body: 'ㄷ or ㅌ landing in front of ㅣ gets pulled forward in the mouth and turns into ㅈ or ㅊ.',
      examples: [['같이', '가치'], ['해돋이', '해도지'], ['굳히다', '구치다']],
    },
    {
      title: 'Aspiration',
      korean: '격음화',
      body: 'ㅎ touching ㄱ, ㄷ, ㅂ or ㅈ fuses with it into a single aspirated sound. The ㅎ does not survive as its own letter.',
      examples: [['좋다', '조ː타'], ['놓다', '노타'], ['생각하다', '생가카다']],
    },
    {
      title: 'Tensing, which is not written',
      korean: '된소리되기',
      body: 'You will hear the consonant come out tight and hard. Revised Romanization deliberately does not mark it, so 학교 is hakgyo even though it sounds like 학꾜. This is the one sound change you hear but never type.',
      examples: [['학교', '학꾜'], ['압구정', '압꾸정'], ['울산', '울싼']],
      unwritten: true,
    },
  ]

  let open = $state(null)
</script>

<div class="learn shell">
  <section class="intro">
    <h1>How hangul becomes letters</h1>
    <p>
      Korean is written one way and said another. Revised Romanization, the official
      South Korean standard, follows the <em>sound</em>, which is why 독립 comes out as
      dongnip rather than doknip. Six things happen between the page and the mouth, and
      five of them show up in the spelling.
    </p>
    <p class="sub">
      Everything on this page comes from the same tables the game grades with, so it can
      never quietly disagree with what you are marked on.
    </p>
  </section>

  <section>
    <h2 class="label">Consonants at the start of a syllable</h2>
    <div class="chart">
      {#each initials as c}
        <div class="cell">
          <b class="kr">{c.j}</b>
          <i>{c.rr || 'silent'}</i>
        </div>
      {/each}
    </div>
    <p class="foot">ㅇ at the front of a syllable makes no sound at all. It is a placeholder that holds the vowel up.</p>
  </section>

  <section>
    <h2 class="label">Vowels</h2>
    <div class="chart">
      {#each vowels as v}
        <div class="cell">
          <b class="kr">{v.j}</b>
          <i>{v.rr}</i>
          {#if v.parts}<u class="kr">{v.parts[0]}+{v.parts[1]}</u>{/if}
        </div>
      {/each}
    </div>
    <p class="foot">
      The compound vowels are exactly what they look like: two vowels written into one
      slot. ㅢ is always written ui even when it is said like ㅣ.
    </p>
  </section>

  <section>
    <h2 class="label">Consonants at the end of a syllable</h2>
    <div class="chart">
      {#each finals as f}
        <div class="cell">
          <b class="kr">{f.j}</b>
          <i>{f.rr}</i>
          {#if f.parts}<u class="kr">{f.parts[0]}+{f.parts[1]}</u>{/if}
        </div>
      {/each}
    </div>
    <p class="foot">
      Endings collapse. Seven sounds do the work of all of these, which is why ㅅ, ㅆ, ㅈ,
      ㅊ, ㅌ and ㅎ all end a syllable as a plain t. The letter still matters, because it
      comes back the moment a vowel follows it.
    </p>
  </section>

  <section>
    <h2 class="label">What happens between syllables</h2>
    <ul class="rules">
      {#each RULES as r}
        <li class:unwritten={r.unwritten}>
          <div class="rhead">
            <span class="rt">{r.title}</span>
            <span class="rk kr">{r.korean}</span>
            {#if r.unwritten}<span class="tag">heard, not written</span>{/if}
          </div>
          <p class="rbody">{r.body}</p>
          <div class="ex">
            {#each r.examples as [word, pron]}
              <button class:on={open === word} onclick={() => (open = open === word ? null : word)}>
                <span class="kr">{word}</span>
              </button>
            {/each}
          </div>
          {#each r.examples as [word, pron]}
            {#if open === word}
              <Peek {word} {pron} compact />
            {/if}
          {/each}
        </li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .learn { padding: 48px 24px 100px; display: grid; gap: 44px; max-width: 860px; }

  .intro { max-width: 62ch; }
  h1 { margin: 0 0 16px; font-size: clamp(20px, 3.2vw, 26px); font-weight: 500; color: var(--ink); line-height: 1.35; }
  .intro p { margin: 0 0 10px; color: #8b8983; font-size: 14px; line-height: 1.7; }
  .intro em { color: var(--ink); font-style: normal; }
  .intro .sub { font-size: 12.5px; color: var(--dim); }

  h2 { margin: 0 0 14px; }

  .chart {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(66px, 1fr));
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
  }
  .cell {
    background: var(--bg);
    display: grid;
    justify-items: center;
    gap: 1px;
    padding: 12px 4px 10px;
  }
  .cell b { font-weight: 400; font-size: 22px; color: var(--ink); line-height: 1.1; }
  .cell i { font-style: normal; font-size: 12px; color: var(--accent); }
  .cell u { text-decoration: none; font-size: 10px; color: var(--dimmer); }

  .foot { margin: 10px 0 0; font-size: 12.5px; color: var(--dim); max-width: 62ch; line-height: 1.6; }

  .rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 26px; }
  .rules li { border-left: 1px solid var(--line); padding-left: 18px; }
  .rules li.unwritten { border-left-color: var(--dimmer); }
  .rhead { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .rt { color: var(--ink); font-size: 15px; }
  .rk { color: var(--dim); font-size: 13px; }
  .tag {
    font-size: 10px;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--dimmer);
    border: 1px solid var(--line);
    padding: 1px 6px;
  }
  .rbody { margin: 7px 0 12px; font-size: 13.5px; color: #8b8983; line-height: 1.65; max-width: 64ch; }
  .ex { display: flex; gap: 8px; flex-wrap: wrap; }
  .ex button { padding: 5px 12px; font-size: 17px; }
  .ex button.on { border-color: var(--accent); color: var(--accent); }

  @media (max-width: 640px) {
    .learn { padding: 28px 16px 70px; gap: 32px; }
    .chart { grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); }
    .cell b { font-size: 19px; }
  }
</style>
