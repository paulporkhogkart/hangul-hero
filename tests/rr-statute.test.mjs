// Every case below is an example printed in 국어의 로마자 표기법 itself
// (문화체육관광부 고시). These are not cases I invented and then made pass; they are
// the statute's own worked examples, which makes them the closest thing to a
// specification conformance suite that exists for this problem.
//
//   node --test tests/
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { romanize, normalize } from '../src/core/rr.mjs'

const check = cases => {
  for (const [spelling, pron, expected] of cases) {
    test(`${spelling} [${pron}] -> ${expected}`, () => {
      assert.equal(normalize(romanize(spelling, pron).rr), normalize(expected))
    })
  }
}

describe('제2장 제1항 붙임 1 - ㄱ/ㄷ/ㅂ are g,d,b before a vowel and k,t,p elsewhere', () => {
  check([
    ['구미', '구미', 'Gumi'],
    ['영동', '영동', 'Yeongdong'],
    ['백암', '배감', 'Baegam'],
    ['옥천', '옥천', 'Okcheon'],
    ['합덕', '합떡', 'Hapdeok'],
    ['호법', '호법', 'Hobeop'],
    ['월곶', '월곧', 'Wolgot'],
    ['벚꽃', '벋꼳', 'beotkkot'],
    ['한밭', '한받', 'Hanbat'],
  ])
})

describe('제2장 제2항 붙임 2 - ㄹ is r before a vowel, l elsewhere, ll when doubled', () => {
  check([
    ['구리', '구리', 'Guri'],
    ['설악', '서락', 'Seorak'],
    ['칠곡', '칠곡', 'Chilgok'],
    ['임실', '임실', 'Imsil'],
    ['울릉', '울릉', 'Ulleung'],
    ['대관령', '대괄령', 'Daegwallyeong'],
  ])
})

describe('제2장 - ㅢ is written ui however it is pronounced', () => {
  check([['광희문', '광히문', 'Gwanghuimun']])
})

describe('제3장 제1항 1 - consonant assimilation IS reflected', () => {
  check([
    ['백마', '뱅마', 'Baengma'],
    ['신문로', '신문노', 'Sinmunno'],
    ['종로', '종노', 'Jongno'],
    ['왕십리', '왕심니', 'Wangsimni'],
    ['별내', '별래', 'Byeollae'],
    ['신라', '실라', 'Silla'],
  ])
})

describe('제3장 제1항 2 - inserted ㄴ/ㄹ IS reflected', () => {
  check([
    ['학여울', '항녀울', 'Hangnyeoul'],
    ['알약', '알략', 'allyak'],
  ])
})

describe('제3장 제1항 3 - palatalisation IS reflected', () => {
  check([
    ['해돋이', '해도지', 'haedoji'],
    ['같이', '가치', 'gachi'],
    ['굳히다', '구치다', 'guchida'],
  ])
})

describe('제3장 제1항 4 - aspiration with ㅎ IS reflected', () => {
  check([
    ['좋고', '조코', 'joko'],
    ['놓다', '노타', 'nota'],
    ['잡혀', '자펴', 'japyeo'],
    ['낳지', '나치', 'nachi'],
  ])
})

describe('제3장 제1항 붙임 - 된소리되기 is NOT reflected', () => {
  check([
    ['압구정', '압꾸정', 'Apgujeong'],
    ['낙동강', '낙똥강', 'Nakdonggang'],
    ['죽변', '죽뼌', 'Jukbyeon'],
    ['낙성대', '낙썽대', 'Nakseongdae'],
    ['합정', '합쩡', 'Hapjeong'],
    ['팔당', '팔땅', 'Paldang'],
    ['샛별', '샏뼐', 'saetbyeol'],
    ['울산', '울싼', 'Ulsan'],
  ])
})

describe('KNOWN GAP - 제3장 제1항 다만, nominals keep a written ㅎ', () => {
  // The statute exempts 체언 from the aspiration rule, so 묵호 is Mukho and not "Muko".
  // Nothing in a pronunciation string says whether a word is a 체언, so this needs the
  // part of speech, which we have from krdict but have not wired in yet. Marked todo
  // rather than deleted, so it stays visible instead of quietly not being handled.
  for (const [spelling, pron, expected] of [
    ['묵호', '무코', 'Mukho'],
    ['집현전', '지편전', 'Jiphyeonjeon'],
  ]) {
    test(`${spelling} [${pron}] -> ${expected}`, { todo: 'needs the 체언 exception' }, () => {
      assert.equal(normalize(romanize(spelling, pron).rr), normalize(expected))
    })
  }
})
