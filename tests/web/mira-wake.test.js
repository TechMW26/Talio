import { isMiraWakeResult, isMiraWakePartial } from '@/lib/miraWakeWord'

const phrase = (a = 'hey', b = 'mira', confidence = .95) => ({ result: [
  { word: a, conf: confidence, start: 0, end: .3 },
  { word: b, conf: confidence, start: .35, end: .8 },
] })
test('standalone Mira and partial candidates never activate', () => {
  expect(isMiraWakeResult({ result: [{ word: 'mira', conf: .96, start: 0, end: .4 }] })).toBe(false)
  expect(isMiraWakePartial('mira')).toBe(false)
  expect(isMiraWakePartial('hey mira')).toBe(false)
  expect(isMiraWakePartial('mirror')).toBe(false)
  expect(isMiraWakeResult({ result: [{ word: 'mera', conf: .99, start: 0, end: .4 }] })).toBe(false)
})
test('accepts confident final contiguous wake phrase', () => expect(isMiraWakeResult(phrase())).toBe(true))
test('accepts case-insensitive exact phrase', () => expect(isMiraWakeResult(phrase('HEY', 'MIRA'))).toBe(true))
test.each(['meera', 'mirah', 'myra', 'mirra', 'mera'])('rejects Mira variant %s', word => expect(isMiraWakeResult(phrase('hey', word))).toBe(false))
test.each(['more', 'mirror', 'miracle', 'miriam'])('rejects unrelated name %s', word => expect(isMiraWakeResult(phrase('hey', word))).toBe(false))
test('finds the adjacent wake phrase inside an utterance', () => {
  const result = phrase()
  result.result.unshift({ word: 'okay', conf: .95, start: 0, end: 0 })
  expect(isMiraWakeResult(result)).toBe(true)
})
test.each([undefined, { partial: 'hey mira' }, phrase('hey', 'mirror'), phrase('a', 'mira'), phrase('hey', 'mira', .5), phrase('hey', 'mira', .85)])('rejects partial, similar and low-confidence phrases', value => expect(isMiraWakeResult(value)).toBe(false))
test('rejects widely separated or malformed words', () => {
  const result = phrase()
  result.result[1].start = 2
  expect(isMiraWakeResult(result)).toBe(false)
  result.result[1].start = NaN
  expect(isMiraWakeResult(result)).toBe(false)
})
