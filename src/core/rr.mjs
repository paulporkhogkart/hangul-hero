// Revised Romanization, applied to a PRONUNCIATION rather than to a spelling.
//
// This is deliberately the easy half of the problem. Every sound change (liaison,
// nasalisation, tensification, palatalisation) is assumed to have already happened
// before anything here runs, so this file contains lookup tables and exactly one
// adjacency rule. Nothing here makes a judgement call.
//
//   input : 동닙   (the pronunciation of 독립)
//   output: dongnip
//
// If you hand it a spelling instead of a pronunciation you will get a wrong answer,
// and that is the intended failure mode: the wrongness stays in one place.
import { compose, decomposeWord } from './hangul.mjs'

/** Initial position. Every initial is followed by a vowel, so the voiced forms always apply. */
export const INITIAL_RR = {
  'ㄱ': 'g',  'ㄲ': 'kk', 'ㄴ': 'n',  'ㄷ': 'd',  'ㄸ': 'tt',
  'ㄹ': 'r',  'ㅁ': 'm',  'ㅂ': 'b',  'ㅃ': 'pp', 'ㅅ': 's',
  'ㅆ': 'ss', 'ㅇ': '',   'ㅈ': 'j',  'ㅉ': 'jj', 'ㅊ': 'ch',
  'ㅋ': 'k',  'ㅌ': 't',  'ㅍ': 'p',  'ㅎ': 'h',
}

export const VOWEL_RR = {
  'ㅏ': 'a',  'ㅐ': 'ae', 'ㅑ': 'ya', 'ㅒ': 'yae', 'ㅓ': 'eo', 'ㅔ': 'e',
  'ㅕ': 'yeo','ㅖ': 'ye', 'ㅗ': 'o',  'ㅘ': 'wa',  'ㅙ': 'wae','ㅚ': 'oe',
  'ㅛ': 'yo', 'ㅜ': 'u',  'ㅝ': 'wo', 'ㅞ': 'we',  'ㅟ': 'wi', 'ㅠ': 'yu',
  'ㅡ': 'eu', 'ㅢ': 'ui', 'ㅣ': 'i',
}

/** Final position. Finals neutralise, so many distinct jamo share a romanization. */
export const FINAL_RR = {
  '':   '',
  'ㄱ': 'k',  'ㄲ': 'k',  'ㄳ': 'k',  'ㄴ': 'n',  'ㄵ': 'n',  'ㄶ': 'n',
  'ㄷ': 't',  'ㄹ': 'l',  'ㄺ': 'k',  'ㄻ': 'm',  'ㄼ': 'l',  'ㄽ': 'l',
  'ㄾ': 'l',  'ㄿ': 'p',  'ㅀ': 'l',  'ㅁ': 'm',  'ㅂ': 'p',  'ㅄ': 'p',
  'ㅅ': 't',  'ㅆ': 't',  'ㅇ': 'ng', 'ㅈ': 't',  'ㅊ': 't',  'ㅋ': 'k',
  'ㅌ': 't',  'ㅍ': 'p',  'ㅎ': 't',
}

/** Vowel-length marks and stress marks carry no information for us. */
const clean = s => s.replace(/[ːˈˌ.]/g, '').trim()

/** Tense consonants, and the plain consonant each one tensified from. */
const DETENSE = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' }

/**
 * 국립국어원 publishes two permitted pronunciations for some words, separated by a
 * slash: 햇살 is 해쌀/핻쌀 and 되다 is 되다/뒈다. Taking the first blindly is wrong.
 *
 * The statute's own example decides it. 샛별 is such a word, pronounced 새뼐/샏뼐, and
 * the statute prints **saetbyeol** - the variant that keeps a 받침 where the spelling
 * has one. So: pick whichever variant agrees with the spelling about which syllables
 * carry a final consonant. Ties keep the first, which is the principal form.
 */
export const splitVariants = pronunciation => String(pronunciation).split('/').map(clean).filter(Boolean)

/**
 * How well a candidate pronunciation agrees with the spelling, as [finals, vowels],
 * compared lexicographically. Returns [-1, -1] when the two cannot be compared.
 *
 * Finals come first because that ranking is backed by the statute: 샛별 -> saetbyeol
 * proves RR keeps the 받침 variant of a 사이시옷 word.
 *
 * Vowels break the remaining ties. 표준발음법 제5항 다만 2 permits 'ㅖ' to be said as
 * [ㅔ], so 시계 is published as 시계/시게, but that is an optional monophthongization
 * of the same kind RR already refuses to reflect for ㅢ (광희문 -> Gwanghuimun). The
 * spelling's vowel wins, giving sigye rather than sige.
 */
function scoreVariant(spelling, variant) {
  const sp = decomposeWord(spelling)
  const pr = decomposeWord(variant)
  if (pr.length !== sp.length) return [-1, -1]
  let finals = 0, vowels = 0
  for (let i = 0; i < sp.length; i++) {
    if (Boolean(sp[i]?.final) === Boolean(pr[i]?.final)) finals++
    if (sp[i]?.vowel === pr[i]?.vowel) vowels++
  }
  return [finals, vowels]
}

const cmpScore = (a, b) => a[0] - b[0] || a[1] - b[1]

export function chooseVariant(spelling, pronunciation) {
  const variants = splitVariants(pronunciation)
  if (variants.length <= 1) return variants[0] ?? ''
  // Strictly greater, so an exact tie keeps the first, which is the principal form.
  return variants.reduce((best, v) =>
    cmpScore(scoreVariant(spelling, v), scoreVariant(spelling, best)) > 0 ? v : best)
}

/**
 * True when two permitted pronunciations romanize differently AND the 받침 tiebreak
 * does not separate them, so choosing between them is an editorial call rather than a
 * derivation. These go to the review queue instead of being decided by sort order.
 */
export function variantsAreAmbiguous(spelling, pronunciation) {
  const variants = splitVariants(pronunciation)
  if (variants.length <= 1) return false
  const romanizations = new Set(variants.map(v => romanizePronunciation(toWrittenForm(spelling, v)).rr))
  if (romanizations.size <= 1) return false
  const scores = new Set(variants.map(v => scoreVariant(spelling, v).join(',')))
  return scores.size === 1
}

/**
 * Turn a standard pronunciation (표준 발음, as published by 국립국어원) into the form RR
 * is actually written from. Two corrections, both straight from the statute:
 *
 *   1. 제3장 제1항 붙임 - 된소리되기는 표기에 반영하지 않는다.
 *      Tensification is not reflected, so a syllable whose initial is tense in the
 *      pronunciation but plain in the spelling reverts to plain. 학꾜 -> 학교 -> hakgyo.
 *
 *   2. 제2장 제1항/제2항 - ㅚ and ㅢ are written oe and ui however they are said.
 *      광희문 is Gwanghuimun even though it is pronounced 광히문.
 *
 * Everything RR *does* reflect (assimilation, ㄴ/ㄹ insertion, palatalisation,
 * aspiration) is already baked into the published pronunciation, so it survives
 * untouched. Spelling and pronunciation always carry the same syllable count, which
 * is what makes the positional comparison safe.
 */
/** Aspirates, and the plain stop each one is a ㅎ fused with. */
const UNASPIRATE = { 'ㅋ': 'ㄱ', 'ㅌ': 'ㄷ', 'ㅍ': 'ㅂ' }

/**
 * 제3장 제1항 4 다만: in a 체언, a ㅎ following ㄱ, ㄷ or ㅂ is written out rather than
 * fused. 묵호 is Mukho and not Muko, 축하 is chukha and not chuka.
 *
 * The fusion has already happened by the time we see a pronunciation, so this cannot be
 * derived from sound alone: it needs to know the word is a nominal. That is why the
 * exception went unimplemented for so long, and why 17 shipping words were wrong.
 *
 * Applies only where the spelling actually has stop + ㅎ across the boundary, so it can
 * never invent an h that was not written.
 */
function keepWrittenH(sp, pr, i) {
  const prev = sp[i - 1], s = sp[i], p = pr[i], prevP = pr[i - 1]
  if (!prev || !s || !p || !prevP) return null
  if (s.initial !== 'ㅎ') return null
  const plain = UNASPIRATE[p.initial]
  if (!plain) return null
  // The spelling's own final must be that stop, or close as it (묵호 ㄱ, 잡히 ㅂ).
  const prevFinal = prev.final
  if (!prevFinal) return null
  const closed = { 'ㄲ': 'ㄱ', 'ㅋ': 'ㄱ', 'ㅅ': 'ㄷ', 'ㅆ': 'ㄷ', 'ㅈ': 'ㄷ', 'ㅊ': 'ㄷ', 'ㅌ': 'ㄷ', 'ㅍ': 'ㅂ' }[prevFinal] ?? prevFinal
  if (closed !== plain) return null
  return { prevFinal, initial: 'ㅎ' }
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.nominal] the word is a 체언, which changes how ㅎ is written
 */
export function toWrittenForm(spelling, pronunciation, opts = {}) {
  const pron = chooseVariant(spelling, pronunciation)
  const sp = decomposeWord(spelling)
  const pr = decomposeWord(pron)
  if (sp.length !== pr.length) return pron // fall back rather than guess at an alignment

  // Undoing a fusion changes two syllables at once, so collect the repairs first.
  const restoreFinal = new Map()
  const restoreInitial = new Map()
  if (opts.nominal) {
    for (let i = 1; i < sp.length; i++) {
      const fix = keepWrittenH(sp, pr, i)
      if (!fix) continue
      restoreFinal.set(i - 1, fix.prevFinal)
      restoreInitial.set(i, fix.initial)
    }
  }

  return pr
    .map((p, i) => {
      const s = sp[i]
      if (!p || !s) return p?.ch ?? pron[i]
      let { initial, vowel, final } = p

      /*
       * De-tensing asks whether an initial is tense in the pronunciation but plain in the
       * spelling. At a liaison the spelling has a silent ㅇ there, so a genuinely tense
       * consonant that MOVED across looked like tensification and was being erased:
       * 섞이다 is 서끼다, and that ㄲ is 섞's own 받침, not a hardened ㄱ. It shipped as
       * seogida when it should be seokkida.
       *
       * A consonant that crossed the boundary keeps whatever it already was.
       */
      const prev = sp[i - 1], prevP = pr[i - 1]
      const liaised = prev && prevP && !prevP.final && prev.final === p.initial
      if (DETENSE[initial] && !DETENSE[s.initial] && !liaised) initial = DETENSE[initial]
      if (s.vowel === 'ㅚ' || s.vowel === 'ㅢ') vowel = s.vowel
      if (restoreInitial.has(i)) initial = restoreInitial.get(i)
      if (restoreFinal.has(i)) final = restoreFinal.get(i)
      return compose({ initial, vowel, final })
    })
    .join('')
}

/** Parts of speech that count as 체언 for the written-ㅎ exception. */
const NOMINAL_POS = new Set(['명사', '고유 명사', '대명사', '수사', '의존 명사'])
export const isNominal = pos => NOMINAL_POS.has(pos)

/** Spelling + published pronunciation -> official RR. The one entry point callers want. */
export function romanize(spelling, pronunciation, opts = {}) {
  return romanizePronunciation(toWrittenForm(spelling, pronunciation, opts))
}

/**
 * Romanize a pronunciation written in hangul.
 * Returns { rr, syllables: [{ ch, initial, vowel, final, rr, parts }] }.
 * `parts` is per-jamo so the breakdown panel can render it without re-deriving anything.
 */
export function romanizePronunciation(pron) {
  const syllables = []
  const decomposed = decomposeWord(clean(pron))

  decomposed.forEach((syl, i) => {
    if (!syl) {
      // Spaces and punctuation pass straight through.
      syllables.push({ ch: [...clean(pron)][i], literal: true, rr: [...clean(pron)][i] })
      return
    }
    const prev = decomposed[i - 1]

    // The one adjacency rule. RR writes ㄹ+ㄹ as "ll", not "lr":
    // 신라 is pronounced 실라 and romanizes as "silla".
    const initial = prev?.final === 'ㄹ' && syl.initial === 'ㄹ' ? 'l' : INITIAL_RR[syl.initial]

    const parts = [
      { jamo: syl.initial, slot: 'initial', rr: initial },
      { jamo: syl.vowel, slot: 'vowel', rr: VOWEL_RR[syl.vowel] },
    ]
    if (syl.final) parts.push({ jamo: syl.final, slot: 'final', rr: FINAL_RR[syl.final] })

    syllables.push({
      ch: syl.ch,
      initial: syl.initial,
      vowel: syl.vowel,
      final: syl.final,
      rr: parts.map(p => p.rr).join(''),
      parts,
    })
  })

  return { rr: syllables.map(s => s.rr).join(''), syllables }
}

/**
 * Fold a romanization to the form we compare against. Official RR permits an optional
 * hyphen to break up ambiguous sequences (중앙 -> jung-ang), which we should accept but
 * must never require someone to type mid-race.
 */
export const normalize = s => s.toLowerCase().normalize('NFC').replace(/[-'\s.]/g, '')

export const matches = (a, b) => normalize(a) === normalize(b)
