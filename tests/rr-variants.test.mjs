// The statute suite uses hand-written pronunciations, which is how a bug survived it:
// the fixture said 샏뼐 while the pipeline was reading 새뼐/샏뼐 from the API and taking
// the wrong half. These cases use the RAW published field values, slashes and length
// marks included, so they exercise the same path the build does.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { romanize, chooseVariant, normalize } from '../src/core/rr.mjs'

describe('two permitted pronunciations, as published', () => {
  // Every string on the right of the arrow is verbatim from 국립국어원.
  const cases = [
    // 사이시옷: keep the variant that has a 받침 where the spelling has one.
    // The statute's own 샛별 -> saetbyeol is the precedent for all of these.
    ['햇살', '해쌀/핻쌀', 'haetsal'],
    ['바닷가', '바다까/바닫까', 'badatga'],
    ['촛불', '초뿔/촏뿔', 'chotbul'],
    ['젓가락', '저까락/젇까락', 'jeotgarak'],
    ['칫솔', '치쏠/칟쏠', 'chitsol'],
    ['어젯밤', '어제빰/어젣빰', 'eojetbam'],
    ['오랫동안', '오래똥안/오랟똥안', 'oraetdongan'],
    ['고춧가루', '고추까루/고춛까루', 'gochutgaru'],
    ['빗방울', '비빵울/빋빵울', 'bitbangul'],
    ['낚싯대', '낙씨때/낙씯때', 'naksitdae'],

    // Not 사이시옷: the spelling has no finals to preserve, so the first variant
    // stands, and the ㅚ rule puts the vowel back regardless.
    ['되다', '되다/뒈다', 'doeda'],
    ['사회단체', '사회단체/사훼단체', 'sahoedanche'],
  ]
  for (const [spelling, published, expected] of cases) {
    test(`${spelling} [${published}] -> ${expected}`, () => {
      assert.equal(normalize(romanize(spelling, published).rr), normalize(expected))
    })
  }
})

describe('ㅖ said as ㅔ is optional, so the spelling wins', () => {
  // 표준발음법 제5항 다만 2 permits it, which is why 국립국어원 publishes both. RR does
  // not reflect an optional monophthongization, same as ㅢ in 광희문 -> Gwanghuimun.
  for (const [spelling, published, expected] of [
    ['시계', '시계/시게', 'sigye'],
    ['세계', '세ː계/세ː게', 'segye'],
    ['관계', '관계/관게', 'gwangye'],
    ['계단', '계단/게단', 'gyedan'],
    ['계란', '계란/게란', 'gyeran'],
    ['혜택', '혜ː택/헤ː택', 'hyetaek'],
    ['지폐', '지폐/지페', 'jipye'],
    ['삼계탕', '삼계탕/삼게탕', 'samgyetang'],
    ['업계', '업꼐/업께', 'eopgye'],           // tensification dropped as well
    ['계획', '계ː획/게ː훽', 'gyehoek'],       // and the ㅚ restored
  ]) {
    test(`${spelling} [${published}] -> ${expected}`, () => {
      assert.equal(normalize(romanize(spelling, published).rr), normalize(expected))
    })
  }

  test('뛰어 does not become 뛰여', () => {
    assert.equal(normalize(romanize('뛰어가다', '뛰어가다/뛰여가다').rr), 'ttwieogada')
  })
})

describe('length marks are not part of the word', () => {
  for (const [spelling, published, expected] of [
    ['닿다', '다ː타', 'data'],
    ['전화', '전ː화', 'jeonhwa'],
    ['환율', '화ː뉼', 'hwanyul'],
    ['한국어', '한ː구거', 'hangugeo'],
  ]) {
    test(`${spelling} [${published}] -> ${expected}`, () => {
      assert.equal(normalize(romanize(spelling, published).rr), normalize(expected))
    })
  }
})

describe('changes 국립국어원 records that RR must reflect', () => {
  for (const [spelling, published, expected] of [
    ['늦여름', '는녀름', 'neunnyeoreum'],   // inserted ㄴ, statute rule 2
    ['물약', '물략', 'mullyak'],            // statute prints 알약 -> allyak
    ['두통약', '두통냑', 'dutongnyak'],
    ['집안일', '지반닐', 'jibannil'],
    ['지하철역', '지하철력', 'jihacheollyeok'],
    ['큰일', '크닐', 'keunil'],             // plain liaison, no insertion here
    ['신입', '시닙', 'sinip'],
  ]) {
    test(`${spelling} [${published}] -> ${expected}`, () => {
      assert.equal(normalize(romanize(spelling, published).rr), normalize(expected))
    })
  }
})

describe('chooseVariant', () => {
  test('picks the 받침-preserving variant', () => {
    assert.equal(chooseVariant('햇살', '해쌀/핻쌀'), '핻쌀')
  })
  test('keeps the principal form when neither variant fits better', () => {
    assert.equal(chooseVariant('되다', '되다/뒈다'), '되다')
  })
  test('passes a single pronunciation straight through', () => {
    assert.equal(chooseVariant('사람', '사람'), '사람')
  })
  test('strips length marks', () => {
    assert.equal(chooseVariant('전화', '전ː화'), '전화')
  })
})
