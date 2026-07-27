// Explains how a spelling becomes a romanization, syllable by syllable.
//
// Feeds two surfaces from one derivation: the peek panel during a race, and the learn
// page. They can never disagree because there is only one implementation.

import { compose, decomposeWord, FINAL_PARTS, VOWEL_PARTS } from './hangul.mjs'
import { INITIAL_RR, VOWEL_RR, FINAL_RR, romanizePronunciation, toWrittenForm, chooseVariant } from './rr.mjs'

const NASAL = new Set(['ㄴ', 'ㅁ', 'ㅇ'])

/** Only seven sounds may close a syllable, so most finals collapse before any
 *  cross-syllable rule gets a look at them. */
const CLOSES_AS = {
  'ㄲ': 'ㄱ', 'ㅋ': 'ㄱ', 'ㄳ': 'ㄱ', 'ㄺ': 'ㄱ',
  'ㅅ': 'ㄷ', 'ㅆ': 'ㄷ', 'ㅈ': 'ㄷ', 'ㅊ': 'ㄷ', 'ㅌ': 'ㄷ', 'ㅎ': 'ㄷ',
  'ㅍ': 'ㅂ', 'ㅄ': 'ㅂ', 'ㄿ': 'ㅂ',
  'ㄵ': 'ㄴ', 'ㄶ': 'ㄴ', 'ㄻ': 'ㅁ', 'ㄼ': 'ㄹ', 'ㄽ': 'ㄹ', 'ㄾ': 'ㄹ', 'ㅀ': 'ㄹ',
}
const TENSE = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' }
const ASPIRATE = { 'ㅋ': 'ㄱ', 'ㅌ': 'ㄷ', 'ㅍ': 'ㅂ', 'ㅊ': 'ㅈ' }

/**
 * The articulatory reason each rule exists. Korean sound changes are not arbitrary
 * decrees, they are what your mouth does when asked to make two sounds in a row that
 * fight each other. Knowing the reason turns six rules into one idea, and one idea
 * generalises to words nobody has shown you.
 *
 * One entry per rule type rather than per combination, which is what makes this
 * tractable: the mechanism is the same whichever consonants are involved.
 */
/**
 * Where each rule sits in the derivation.
 *
 * Sound changes feed each other, so listing them by syllable position puts effects above
 * their own causes. 독립 is the clearest case: the ㄹ of 립 becomes ㄴ first, giving 독닙,
 * and only then does the ㄱ nasalise in front of that new ㄴ. Printed in syllable order it
 * read as "the ㄱ softens before the ㄴ" above the rule that creates the ㄴ.
 *
 * These stages are the standard feeding order, not a fix for one word: 꽃잎 (insertion
 * feeding nasalisation) and 수없이 (liaison feeding tensing) fall out of the same list.
 * Ties keep syllable order.
 */
const STAGE = {
  neutralisation: 1,   // what a syllable can close with, decided before anything crosses
  hdrop: 1,
  liaison: 2,          // resyllabification, which moves sounds into new company
  insertion: 2,        // and so does adding one
  aspiration: 3,
  palatalisation: 4,   // after aspiration, which can be what puts a ㅌ in front of the ㅣ
  rtoN: 5,             // ㄹ becomes ㄴ, creating the nasal that the next rule reacts to
  nasalisation: 6,
  lateralisation: 7,   // ㄴ becomes ㄹ
  doubledR: 7,         // and the spelling consequence of ending up with two of them
  tensification: 8,    // never written, so it can sit last without misleading anyone
  glideeaten: 8,
  vowelheld: 9,
}

const WHY = {
  liaison:
    'A consonant wants a vowel to lean on, and ㅇ at the front of a syllable is an empty seat. Rather than close the first syllable and reopen the second, the tongue simply carries straight on.',
  nasalisation:
    'Your soft palate has to drop for the nasal that follows. It drops early, so air is already escaping through the nose while the first consonant is still being held, and a stop made with the nose open is a nasal.',
  lateralisation:
    'ㄴ and ㄹ are made in the same spot, just behind the teeth. Holding for the ㄴ and then flicking for the ㄹ means arriving and leaving the same place twice, so the flick wins both times.',
  rtoN:
    'ㄹ is a quick flick of the tongue, and a flick needs somewhere to travel from. Straight after a stopped consonant the tongue is already pinned, so the sound comes out held instead, which is a ㄴ.',
  palatalisation:
    'ㅣ is made with the tongue high and pushed forward. Starting a ㄷ back on the ridge and then dragging forward for the ㅣ is more work than beginning where you are already heading.',
  aspiration:
    'ㅎ is not really a consonant so much as a puff of breath. Made at the same moment as ㄱ, ㄷ, ㅂ or ㅈ it never gets a slot of its own, so it turns into the puff on that consonant instead.',
  tensification:
    'The stop before it leaves the vocal folds pressed shut. The next consonant is released while they are still tight, which is what makes it come out hard rather than soft.',
  insertion:
    'The join between two words is a real boundary, and a vowel starting with a ㅣ glide right after a closed syllable would blur it. The inserted ㄴ keeps the two halves audible as two halves.',
  hdrop:
    'ㅎ is made by letting breath through an open throat. Between two vowels the throat is already open, so there is nothing left for it to do and it simply stops being pronounced.',
  neutralisation:
    'Closing a syllable means stopping the air, and stopping it only has so many distinct positions. The fine differences between ㅅ, ㅈ, ㅊ, ㅌ and ㅎ live in how they are released, and a closed syllable never releases them.',
  vowelheld:
    'Spelling here follows the word rather than the mouth. Keeping it constant means the same word looks the same everywhere, whoever is saying it and however carefully.',
  glideeaten:
    'A y glide is a movement toward the hard palate. After a consonant already made there the tongue has nowhere to travel from, so the glide never becomes audible.',
  doubledR:
    'One ㄹ between vowels is a quick tap of the tongue, close enough to an English r to be written as one. Held twice as long it stops being a tap at all and becomes the other sound, which is why the letter changes rather than simply doubling.',
}

/**
 * Work out which sound changes turned `spelling` into `spoken`, one entry per change.
 * Each carries the syllable index it applies to so the panel can point at it.
 *
 * `reflected` says whether the change shows up in the romanization. Tensification does
 * not, and saying so out loud is the point: a player who hears 학꾜 and types "hakkyo"
 * needs to be told the sound is real but the spelling rule ignores it.
 */
export function describeChanges(spelling, spoken) {
  const sp = decomposeWord(spelling)
  const pr = decomposeWord(spoken)
  const out = []
  if (sp.length !== pr.length) return out

  /** Name a final honestly: what is written, and what it actually closes as. Most
   *  cross-syllable rules operate on the closed value, so quoting the written letter
   *  alone sends people hunting for a rule that does not exist. This is what made
   *  깨끗해지다 talk about a ㄷ that appears nowhere in the spelling. */
  const nameFinal = jamo => {
    const closed = CLOSES_AS[jamo] ?? jamo
    return closed === jamo ? jamo : `${jamo}, which closes as ${closed},`
  }
  const closedOf = jamo => CLOSES_AS[jamo] ?? jamo

  for (let i = 0; i < sp.length; i++) {
    const s = sp[i], p = pr[i]
    const prev = sp[i - 1], prevP = pr[i - 1]
    const next = sp[i + 1], nextP = pr[i + 1]
    if (!s || !p) continue

    /*
     * Each slot is judged on its own.
     *
     * A syllable can change in more than one way at once. In 끝없다 the 없 both receives
     * the ㄷ that left 끝 AND reduces its own ㅄ to ㅂ. These used to be one chain ending
     * in `continue`, so whichever matched first won and every other change to that
     * syllable went unmentioned, which is how a 받침 vanished in silence.
     */
    /*
     * A rule that lives in the romanization rather than in the pronunciation.
     *
     * 떠올리다 is said exactly as it is written, so every check below stays quiet, yet
     * the answer is tteoollida and not tteoolrida. 제2장 제2항 붙임 2: ㄹ is r before a
     * vowel and l elsewhere, but ㄹㄹ is written ll. Nothing about the SOUND changes, so
     * comparing spelling against pronunciation could never find it.
     */
    if (prevP?.final === 'ㄹ' && p.initial === 'ㄹ') {
      out.push({
        at: i,
        type: 'doubledR',
        reflected: true,
        title: 'Two ㄹ become ll',
        text: `${prevP.ch} ends in ㄹ and ${p.ch} begins with another. A single ㄹ in front of a vowel is written r, but a pair is one long held sound rather than two separate flicks, so it is written ll and not lr.`,
      })
    }

    initialSlot: if (s.initial !== p.initial) {
    // ── something appears where the spelling has a silent ㅇ ──────────────
    // Liaison and insertion look identical from this syllable alone. The previous
    // syllable tells them apart: in liaison it LOSES its final because the consonant
    // moved; in insertion it KEEPS one, because nothing moved and a new sound arrived.
    if (s.initial === 'ㅇ' && p.initial !== 'ㅇ' && prev) {
      const pair = FINAL_PARTS[prev.final]
      // The whole final moved, as in 한국어 where 국 gives up its ㄱ entirely.
      const wholeMoved = Boolean(prev.final) && !prevP.final
      // Or a pair split, as in 수없이 where 없 keeps its ㅂ and lets the ㅅ go. My first
      // discriminator only asked whether the previous syllable lost its final, so a
      // syllable keeping HALF of one looked like nothing had moved at all, and the code
      // invented an inserted ㄴ to explain the arrival.
      const halfMoved = Boolean(pair) && prevP.final === pair[0]

      if (wholeMoved || halfMoved) {
        const moved = wholeMoved ? prev.final : pair[1]
        const tensed = TENSE[p.initial] && TENSE[p.initial] === moved

        /*
         * The consonant crossed the boundary AND changed on the way. Reporting only the
         * move leaves an explanation that contradicts itself: "the ㄷ slides across" next
         * to a syllable that plainly starts with ㅈ. 해돋이 and 같이 are the statute's own
         * examples of 구개음화, and both were being announced as ordinary liaison.
         */
        if ((p.initial === 'ㅈ' || p.initial === 'ㅊ') && s.vowel === 'ㅣ' && ['ㄷ', 'ㅌ'].includes(moved)) {
          out.push({
            at: i,
            type: 'palatalisation',
            reflected: true,
            title: 'Palatalisation',
            text: `${prev.ch} ends in ${moved} and ${s.ch} opens with the silent ㅇ, so the ${moved} slides across. It lands directly in front of ㅣ, which drags it forward in the mouth until it comes out as ${p.initial}, so ${prev.ch}${s.ch} is read as ${prevP.ch}${p.ch}.`,
          })
          break initialSlot
        }

        /*
         * What arrives is not always what left, and saying "the ㅌ slides across" beside
         * a syllable starting with ㄷ is a contradiction the reader has to resolve alone.
         * Three ways a consonant changes in transit, each needing its own sentence.
         */
        const arriving = p.initial
        const writtenPair = FINAL_PARTS[moved]
        let text

        // Arriving tensed is still the same consonant. Tensing has its own entry
        // directly below, so the liaison sentence should not pretend it changed.
        if (arriving === moved || TENSE[arriving] === moved) {
          text = halfMoved
            ? `${prev.ch} ends in the pair ${pair[0]}+${pair[1]}, and only one consonant can close a syllable. ${s.ch} opens with the silent ㅇ, so the ${pair[0]} stays behind and the ${pair[1]} slides across into it.`
            : `${prev.ch} ends in ${prev.final} and ${s.ch} opens with the silent ㅇ, so the ${prev.final} slides across and is read as the start of ${p.ch}.`
        } else if (writtenPair && writtenPair.includes(arriving) && writtenPair.includes('ㅎ')) {
          // 많이, 싫어하다: the ㅎ half of the pair simply gives up before a vowel.
          text = `${prev.ch} ends in the pair ${writtenPair[0]}+${writtenPair[1]}. A ㅎ has nothing to do in front of a vowel, so it falls silent, and the ${arriving} slides across into ${s.ch} instead, giving ${p.ch}.`
        } else if (closedOf(moved) === arriving) {
          // 맛있다, 끝없다: 표준발음법 제15항. Before a word that stands on its own, the
          // final closes to its neutral value FIRST and that is what moves. It is why
          // 맛이 is 마시 but 맛있다 is 마딛따, which otherwise looks like an inconsistency.
          text = `${prev.ch} ends in ${moved}, but what follows is a whole word rather than an ending, so the ${moved} first closes to its plain ${arriving} and it is that which slides across, giving ${p.ch}.`
        } else {
          text = `${prev.ch} ends in ${moved} and ${s.ch} opens with the silent ㅇ, so the sound moves across, arriving as ${arriving} in ${p.ch}.`
        }

        out.push({ at: i, type: 'liaison', reflected: true, title: 'Liaison', text })
        if (tensed) {
          out.push({
            at: i,
            type: 'tensification',
            reflected: false,
            title: 'Tensing',
            text: `Landing straight after the ${prevP.final}, that ${moved} comes out tight as ${p.initial}. Revised Romanization does not mark tensing, so it is still written ${INITIAL_RR[moved]}.`,
          })
        }
        break initialSlot
      }

      // 표준발음법 제29항. Fires at a compound boundary before a ㅣ-glide vowel.
      const GLIDE = { 'ㅣ': '이', 'ㅑ': '야', 'ㅕ': '여', 'ㅛ': '요', 'ㅠ': '유', 'ㅒ': '얘', 'ㅖ': '예' }
      const became = p.initial
      // What the syllable looks like with the ㄴ in it, BEFORE the ㄹ next door acts on
      // it. Naming the finished 려 as the result of inserting a ㄴ skipped straight past
      // the step the following sentence then went back to explain.
      const withN = compose({ initial: 'ㄴ', vowel: p.vowel, final: p.final })
      out.push({
        at: i,
        type: 'insertion',
        reflected: true,
        title: became === 'ㄹ' ? 'Inserted ㄴ, then ㄹ' : 'Inserted ㄴ',
        // "first becomes" only when something happens to it afterwards. 꽃잎 stops at 닙,
        // and promising a next step that never arrives is its own small confusion.
        text: `This is two words joined together and the second one starts with ${GLIDE[s.vowel] ?? s.vowel}, one of the ㅣ glide vowels. A ㄴ appears in front of it, so ${s.ch} ${became === 'ㄹ' ? `first becomes ${withN}` : `is read as ${withN}`}.`
          + (became === 'ㄹ'
            ? ` That new ㄴ is then sitting next to the ㄹ ending ${prev.ch}, and ㄴ beside ㄹ gives way, so ${withN} is read as ${p.ch}.`
            : '')
          + ` The inserted consonant also takes the slot ${prev.final ? `the ${prev.final} of ${prev.ch}` : 'the previous consonant'} would otherwise have slid into.`,
      })
      break initialSlot
    }

    // ── ㅎ fusing with a stop, in either direction ────────────────────────
    if (ASPIRATE[p.initial]) {
      const plain = ASPIRATE[p.initial]
      // ㅎ is at the start of this syllable, and the stop is the previous final. The
      // stop may aspirate as itself (꽂히다, ㅈ + ㅎ) or via its closed value
      // (깨끗해지다, where ㅅ closes as ㄷ first), so both count.
      // The stop may be the final itself (축하, ㄱ+ㅎ), its closed value (깨끗해지다,
      // where ㅅ closes as ㄷ first), or one half of a pair (넓히다, where the ㅂ of ㄼ
      // does the fusing and the ㄹ stays put).
      const prevPair = FINAL_PARTS[prev?.final] ?? []
      const sources = prev?.final ? [prev.final, closedOf(prev.final), ...prevPair] : []
      if (s.initial === 'ㅎ' && sources.includes(plain)) {
        const fromPair = prevPair.includes(plain)
        const viaClosed = !fromPair && prev.final !== plain
        const describe = fromPair
          ? `the pair ${prevPair[0]}+${prevPair[1]}, whose ${plain}`
          : viaClosed ? nameFinal(prev.final) : prev.final
        out.push({
          at: i,
          type: 'aspiration',
          reflected: true,
          title: 'Aspiration',
          text: `${prev.ch} ends in ${describe} ${fromPair ? 'meets' : 'and'} ${fromPair ? `the ㅎ of ${s.ch}` : `${s.ch} begins with ㅎ`}. The two fuse into a single ${p.initial}, so you hear ${prevP.ch}${p.ch} rather than two separate sounds.`,
        })
        break initialSlot
      }
      // ㅎ is the previous syllable's final, and the stop starts this one.
      if (prev && ['ㅎ', 'ㄶ', 'ㅀ'].includes(prev.final) && s.initial === plain) {
        out.push({
          at: i,
          type: 'aspiration',
          reflected: true,
          title: 'Aspiration',
          text: `${prev.ch} ends in ${prev.final} and ${s.ch} begins with ${s.initial}. The ㅎ has no room of its own, so it fuses into the ${s.initial} and both come out as a single ${p.initial}.`,
        })
        break initialSlot
      }
    }

    // ── ㄷ or ㅌ pulled forward by a following ㅣ ─────────────────────────
    if ((p.initial === 'ㅈ' || p.initial === 'ㅊ') && s.vowel === 'ㅣ'
        && prev && ['ㄷ', 'ㅌ'].includes(prev.final)) {
      // 닫히다 is two rules, not one. The ㄷ never meets the ㅣ: it fuses with the ㅎ of
      // 히 into ㅌ, and it is that ㅌ which then comes forward. Saying only the second
      // half left a sentence claiming the ㄷ "lands directly in front of ㅣ" with a whole
      // consonant standing between them.
      const viaH = s.initial === 'ㅎ'
      if (viaH) {
        out.push({
          at: i,
          type: 'aspiration',
          reflected: true,
          title: 'Aspiration',
          text: `${prev.ch} ends in ${prev.final} and ${s.ch} begins with ㅎ. The two fuse into a single ㅌ.`,
        })
      }
      out.push({
        at: i,
        type: 'palatalisation',
        reflected: true,
        title: 'Palatalisation',
        text: viaH
          ? `That ㅌ is now sitting directly in front of ㅣ, which drags it forward in the mouth until it comes out as ${p.initial}, so ${prev.ch}${s.ch} is read as ${prevP.ch}${p.ch}.`
          : `The ${prev.final} ending ${prev.ch} lands directly in front of ㅣ, which drags it forward in the mouth until it comes out as ${p.initial}.`,
      })
      break initialSlot
    }

    // ── a ㄴ starting this syllable, giving way to a neighbouring ㄹ ──────
    if (s.initial === 'ㄴ' && p.initial === 'ㄹ') {
      out.push({
        at: i,
        type: 'lateralisation',
        reflected: true,
        title: 'ㄴ becomes ㄹ',
        text: `The ㄴ starting ${s.ch} is touching a ㄹ, and the two cannot both be held, so it gives way and both are read as ㄹ.`,
      })
      break initialSlot
    }

    // ㄹ turning into ㄴ after a consonant that cannot lead into it. Its own type rather
    // than a flavour of nasalisation, because it runs BEFORE nasalisation and creates
    // the ㄴ that nasalisation then reacts to.
    if (s.initial === 'ㄹ' && p.initial === 'ㄴ') {
      out.push({
        at: i,
        type: 'rtoN',
        reflected: true,
        title: 'ㄹ becomes ㄴ',
        text: `A ㄹ cannot start a syllable straight after ${prev ? `the ${prev.final} ending ${prev.ch}` : 'that consonant'}, so ${s.ch} is read as ${p.ch}.`,
      })
      break initialSlot
    }

    // ── tensing, which is real and audible and never written ──────────────
    if (TENSE[p.initial] && !TENSE[s.initial]) {
      out.push({
        at: i,
        type: 'tensification',
        reflected: false,
        title: 'Tensing',
        text: `You will hear the ${s.initial} of ${s.ch} come out tight, as ${p.initial}. Revised Romanization does not mark tensing at all, so it is still written ${INITIAL_RR[s.initial]}.`,
      })
      break initialSlot
    }
    } // end initialSlot

    finalSlot: if (s.final !== p.final) {
    // ── a ㄴ ending this syllable, giving way to a neighbouring ㄹ ────────
    if (s.final === 'ㄴ' && p.final === 'ㄹ') {
      out.push({
        at: i,
        type: 'lateralisation',
        reflected: true,
        title: 'ㄴ becomes ㄹ',
        text: `The ㄴ ending ${s.ch} is touching a ㄹ, and the two cannot both be held, so it gives way and both are read as ㄹ.`,
      })
      break finalSlot
    }

    // ── a stop losing to a following nasal ────────────────────────────────
    if (s.final && p.final && s.final !== p.final && NASAL.has(p.final) && !NASAL.has(closedOf(s.final))) {
      out.push({
        at: i,
        type: 'nasalisation',
        reflected: true,
        title: 'Nasal assimilation',
        // Name the sound as it is actually said next door, not as it is written. In 독립
        // the trigger is the ㄴ of 닙, and 립 has no ㄴ in it anywhere.
        text: `${s.ch} ends in ${nameFinal(s.final)} which cannot be held in front of the ${nextP?.initial ?? 'following consonant'} of ${nextP?.ch ?? next?.ch ?? 'the next syllable'}, so it softens into ${p.final} and ${s.ch} is read as ${p.ch}.`,
      })
      break finalSlot
    }

    // ── ㅎ giving up between vowels ───────────────────────────────────────
    if (s.final === 'ㅎ' && !p.final && next?.initial === 'ㅇ' && nextP?.initial === 'ㅇ') {
      out.push({
        at: i,
        type: 'hdrop',
        reflected: true,
        title: 'ㅎ drops',
        text: `${s.ch} ends in ㅎ and ${next.ch} opens with a vowel. A ㅎ caught between two vowels is barely audible, so it disappears and ${s.ch} is read as ${p.ch}.`,
      })
      break finalSlot
    }

    // ── the seven closing sounds ──────────────────────────────────────────
    // Only reported when nothing more interesting happened to this syllable, because a
    // syllable that also nasalises has already explained itself. Silent until now, which
    // left 144 words in the list changing sound with no explanation offered at all.
    // Which half of a pair survives is not always the predictable one: 넓다 is 널따 but
    // 밟다 is 밥따, an exception the standard names explicitly. Hardcoding the usual
    // winner meant the exception matched nothing and 밟 changed shape in silence.
    const closingPair = FINAL_PARTS[s.final]
    const survived = s.final && p.final && s.final !== p.final
      && (closedOf(s.final) === p.final || (closingPair && closingPair.includes(p.final)))

    if (survived) {
      const pair = closingPair
      // If the next syllable took the second half, it was not dropped, it moved, and the
      // liaison entry on that syllable already says so. Reporting both left 수없이
      // claiming the ㅅ was discarded one line above explaining where it went.
      const secondMoved = pair && next?.initial === 'ㅇ' && nextP
        && (nextP.initial === pair[1] || TENSE[nextP.initial] === pair[1])
      if (secondMoved) break finalSlot

      out.push({
        at: i,
        type: 'neutralisation',
        reflected: true,
        title: pair ? 'Only one can close' : 'Closing sound',
        // A pair losing its second half and a single consonant changing its value are
        // different events, and 값 deserves to be told which one happened to it.
        text: pair
          ? `${s.ch} ends in the pair ${pair[0]}+${pair[1]}, but only one consonant may close a syllable. Nothing follows for the other to move into, so the ${pair.find(x => x !== p.final)} is dropped and only the ${p.final} is heard.`
            + (closedOf(s.final) !== p.final
              ? ` Which half survives is usually the ${closedOf(s.final)}, as in 넓다, so this word is worth remembering separately.`
              : '')
          : `Only seven sounds may close a Korean syllable, and ${s.final} is not one of them. With nothing following to rescue it, ${s.ch} closes as ${p.final} instead.`,
      })
      break finalSlot
    }
    } // end finalSlot

    vowelSlot: if (s.vowel !== p.vowel) {
    // ── 져 said as 저 ─────────────────────────────────────────────────────
    // 표준발음법 제5항 다만 1. In a conjugated verb, 져/쪄/쳐 are said 저/쩌/처.
    // These seven words changed sound with nothing said about it, which reads as a bug
    // in the panel rather than as a rule of the language.
    if (s.vowel === 'ㅕ' && p.vowel === 'ㅓ' && ['ㅈ', 'ㅉ', 'ㅊ'].includes(s.initial)) {
      out.push({
        at: i,
        type: 'glideeaten',
        reflected: true,
        title: 'The y is swallowed',
        text: `${s.initial} is already made with the tongue flat against the roof of the mouth, which is exactly where the y of ㅕ would go. There is nothing left for it to do, so ${s.ch} is simply read as ${p.ch}.`,
      })
      break vowelSlot
    }

    // ── a vowel said one way and written another ──────────────────────────
    // Without this the panel shows 희 with [히] underneath and offers no reason, which
    // reads as a mistake rather than as a deliberate rule.
    // ㅚ belongs here too: it is very commonly said ㅞ, and RR writes oe regardless.
    // Leaving it out meant 외갓집 showed 외 -> [웨] with no reason given.
    if (s.vowel !== p.vowel && ['ㅢ', 'ㅖ', 'ㅚ'].includes(s.vowel)) {
      out.push({
        at: i,
        type: 'vowelheld',
        reflected: false,
        title: `Said ${p.vowel}, written ${s.vowel}`,
        text: `${s.vowel} is very commonly said as ${p.vowel}, and ${s.ch} comes out as ${p.ch}. Revised Romanization spells ${s.vowel} the same way however it is said, so it is still written ${VOWEL_RR[s.vowel]}.`,
      })
    }
    } // end vowelSlot
  }

  return out
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => (STAGE[a.type] ?? 99) - (STAGE[b.type] ?? 99) || a.at - b.at || a.i - b.i)
    .map(({ i, ...c }) => ({ ...c, why: WHY[c.type] ?? null }))
}

/**
 * A single jamo, with what it actually contributes to THIS word.
 *
 * `fate` is the point. The panel used to print dictionary values, so 쌓 listed its ㅎ as
 * "t" directly above a sentence saying the ㅎ disappears, and 국 listed a final "k" above
 * a syllable reading "gu". The letters never added up to the syllable they sat over.
 *
 *   kept     contributes its ordinary value
 *   silent   contributes nothing at all
 *   moved    a final that left for the next syllable, so nothing is heard here
 *   arrived  an empty ㅇ that received a consonant from the syllable before
 *   changed  contributes something other than its usual value
 */
const describeJamo = (jamo, slot, rr, fate = 'kept') => ({
  jamo,
  slot,
  rr,
  fate,
  parts: slot === 'final' ? FINAL_PARTS[jamo] ?? null : slot === 'vowel' ? VOWEL_PARTS[jamo] ?? null : null,
})

/**
 * The whole derivation for one word.
 *   spelling -> spoken -> written -> romanization
 * `spoken` is what you hear (tensification and all). `written` is the form RR is
 * actually derived from. Showing both is what stops the tensification rule feeling
 * arbitrary.
 */
export function breakdown(word, publishedPron) {
  const written = toWrittenForm(word, publishedPron)
  const { rr, syllables: romanized } = romanizePronunciation(written)
  const spelled = decomposeWord(word)
  // The SAME variant the romanization was derived from. Taking the first one blindly put
  // 햇 -> [해] on screen beside an answer of haetsal, so the panel contradicted the thing
  // it was there to explain.
  const spoken = chooseVariant(word, publishedPron)

  // The written form is what the romanization was derived from, and its per-jamo values
  // are contextual (the ㄹㄹ of 신라 becomes "ll", not "l" + "r"). Reading the letters
  // back off it is what makes the jamo add up to the syllable above them.
  const writtenSyl = decomposeWord(written)

  const syllables = spelled.map((s, i) => {
    const r = romanized[i]
    if (!s) return { char: word[i], literal: true }

    const w = writtenSyl[i]
    const part = slot => r?.parts?.find(p => p.slot === slot) ?? null

    const initial = (() => {
      if (!w) return describeJamo(s.initial, 'initial', INITIAL_RR[s.initial])
      const value = part('initial')?.rr ?? ''
      if (s.initial === 'ㅇ' && w.initial !== 'ㅇ') return describeJamo(s.initial, 'initial', value, 'arrived')
      if (s.initial === 'ㅇ') return describeJamo(s.initial, 'initial', '', 'silent')
      if (w.initial !== s.initial) return describeJamo(s.initial, 'initial', value, 'changed')
      return describeJamo(s.initial, 'initial', value)
    })()

    const vowel = w && w.vowel !== s.vowel
      ? describeJamo(s.vowel, 'vowel', part('vowel')?.rr ?? VOWEL_RR[w.vowel], 'changed')
      : describeJamo(s.vowel, 'vowel', part('vowel')?.rr ?? VOWEL_RR[s.vowel])

    const final = !s.final ? null : (() => {
      if (!w) return describeJamo(s.final, 'final', FINAL_RR[s.final])
      if (!w.final) {
        // It contributes nothing HERE, but that is not the same as contributing nothing.
        // Three fates: it crossed into an empty ㅇ next door, it fused with the consonant
        // already there (그렇다, where the ㅎ becomes part of the following ㅌ), or it
        // genuinely stopped being pronounced. Calling the middle one silent was wrong:
        // the ㅎ is the entire reason the next syllable is ta and not da.
        const nextSpelled = spelled[i + 1]
        const nextWritten = writtenSyl[i + 1]
        const gaveSomething = nextSpelled && nextWritten && nextWritten.initial !== nextSpelled.initial
        if (!gaveSomething) return describeJamo(s.final, 'final', '', 'silent')
        return describeJamo(s.final, 'final', '', nextSpelled.initial === 'ㅇ' ? 'moved' : 'fused')
      }
      if (w.final !== s.final) return describeJamo(s.final, 'final', part('final')?.rr ?? FINAL_RR[w.final], 'changed')
      return describeJamo(s.final, 'final', part('final')?.rr ?? FINAL_RR[s.final])
    })()

    return {
      char: s.ch,
      spoken: [...spoken][i] ?? null,
      rr: r?.rr ?? '',
      changed: (r?.ch ?? s.ch) !== s.ch,
      jamo: [initial, vowel, ...(final ? [final] : [])],
    }
  })

  return { word, spoken, written, rr, syllables, changes: describeChanges(word, spoken) }
}
