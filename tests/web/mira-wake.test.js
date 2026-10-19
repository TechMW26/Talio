import { isMiraWakeResult, isMiraWakePartial } from '@/lib/miraWakeWord'

const phrase = (word = 'mira', conf = .99, start = 0, end = .4) => ({ result: [{ word, conf, start, end }] })
test.each(['mira', 'MIRA', 'Mira'])('accepts a confident standalone wake name: %s', word => {
  expect(isMiraWakeResult(phrase(word))).toBe(true)
})
test.each(['meera', 'mirah', 'myra', 'mirra', 'mera', 'mirror', 'miracle', 'miriam'])('rejects similar words: %s', word => {
  expect(isMiraWakeResult(phrase(word))).toBe(false)
})
test.each([undefined, { partial: 'mira' }, phrase('mira', .96), phrase('mira', .5), phrase('mira', NaN), phrase('mira', 2), phrase('mira', .99, -1), phrase('mira', .99, 0, 2), phrase('mira', .99, 0, .1)])('rejects weak or malformed final results', value => {
  expect(isMiraWakeResult(value)).toBe(false)
})
test.each(['mira', 'hey mira', 'mirror'])('never wakes from partial speech: %s', text => {
  expect(isMiraWakePartial(text)).toBe(false)
})
test('does not wake from Mira mentioned within a sentence or goodbye', () => {
  expect(isMiraWakeResult({ result: [{ word: 'bye', conf: .99, start: 0, end: .3 }, { word: 'mira', conf: .99, start: .4, end: .8 }] })).toBe(false)
})
