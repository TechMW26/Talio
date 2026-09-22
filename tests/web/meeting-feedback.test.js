import { createMeetingFeedback } from '@/lib/meetings/feedback'

describe('meeting feedback', () => {
  let play, feedback, time
  const packet = (topic, data, sender = 'remote') => ({ topic, data, sender, localIdentity: 'local' })
  beforeEach(() => {
    time = 0
    play = jest.fn()
    feedback = createMeetingFeedback(['👍'], play, () => time)
  })
  test('chimes only on a new hand raise, not repeats or lowering', () => {
    feedback(packet('talio-hand', { raised: true }))
    time = 1000
    feedback(packet('talio-hand', { raised: true }))
    feedback(packet('talio-hand', { raised: false }))
    expect(play).toHaveBeenCalledTimes(1)
    feedback(packet('talio-hand', { raised: true }))
    expect(play).toHaveBeenLastCalledWith('chime')
    expect(play).toHaveBeenCalledTimes(2)
  })
  test('deduplicates reactions and rate limits simultaneous sounds without hiding visuals', () => {
    expect(feedback(packet('talio-reaction', { id: 'a', reaction: '👍' }))).toBe(true)
    time = 1000
    expect(feedback(packet('talio-reaction', { id: 'a', reaction: '👍' }))).toBe(false)
    expect(feedback(packet('talio-reaction', { id: 'b', reaction: '👍' }))).toBe(true)
    expect(feedback(packet('talio-reaction', { id: 'c', reaction: '👍' }))).toBe(true)
    expect(play.mock.calls).toEqual([['pop'], ['pop']])
  })
  test('ignores local echoes, unknown emoji, malformed hands and missing senders', () => {
    expect(feedback(packet('talio-reaction', { reaction: '👍' }, 'local'))).toBe(false)
    expect(feedback(packet('talio-reaction', { reaction: 'arbitrary' }))).toBe(false)
    expect(feedback(packet('talio-hand', { raised: 'false' }))).toBe(false)
    expect(feedback(packet('talio-hand', { raised: true }, null))).toBe(false)
    expect(play).not.toHaveBeenCalled()
  })
  test('audio failure does not break the visual event', () => {
    play.mockImplementation(() => { throw new Error('Audio blocked') })
    expect(feedback(packet('talio-reaction', { reaction: '👍' }))).toBe(true)
  })
})
