import { createMiraStreamingSpeech } from '@/lib/miraStreamingSpeech'

test('prepares one sentence ahead while playback is busy, with bounded lookahead', async () => {
  let release
  const prepare = jest.fn(phrase => ({ phrase, cancel: jest.fn() }))
  const speak = jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(undefined)
  const speech = createMiraStreamingSpeech({ prepare, speak, live: () => true })
  speech.update('First sentence. Second sentence. Third sentence.')
  await Promise.resolve()
  expect(prepare.mock.calls.map(([text]) => text)).toEqual(['First sentence. ', 'Second sentence. '])
  expect(speak).toHaveBeenCalledTimes(1)
  expect(speak.mock.calls[0][1]).toBe(prepare.mock.results[0].value)
  release()
  await speech.finish('First sentence. Second sentence. Third sentence.')
  expect(prepare).toHaveBeenCalledTimes(3)
  expect(speak.mock.calls.map(([text]) => text)).toEqual(['First sentence. ', 'Second sentence. ', 'Third sentence.'])
})

test('cancels prefetched audio when the turn becomes stale', async () => {
  let live = true
  const prepare = jest.fn(() => ({ cancel: jest.fn() }))
  const speak = jest.fn()
  const speech = createMiraStreamingSpeech({ prepare, speak, live: () => live })
  speech.update('First sentence. Second sentence.')
  live = false
  await speech.finish('First sentence. Second sentence.')
  expect(speak).not.toHaveBeenCalled()
  for (const result of prepare.mock.results) expect(result.value.cancel).toHaveBeenCalled()
})

test('a playback failure cancels lookahead and never acquires later phrases', async () => {
  const prepare = jest.fn(() => ({ cancel: jest.fn() }))
  const speak = jest.fn().mockRejectedValue(new Error('audio failed'))
  const speech = createMiraStreamingSpeech({ prepare, speak, live: () => true })
  await expect(speech.finish('First sentence. Second sentence. Third sentence.')).rejects.toThrow('audio failed')
  expect(prepare).toHaveBeenCalledTimes(2)
  expect(speak).toHaveBeenCalledTimes(1)
  expect(prepare.mock.results[1].value.cancel).toHaveBeenCalled()
})

test('starts before completion, queues in order and never repeats the final answer', async () => {
  let release
  const speak = jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(undefined)
  const speech = createMiraStreamingSpeech({ speak, live: () => true })
  speech.update('Hello there. ')
  await Promise.resolve()
  expect(speak).toHaveBeenCalledWith('Hello there. ')
  speech.update('Hello there. Here is your answer.')
  expect(speak).toHaveBeenCalledTimes(1)
  release()
  await speech.finish('Hello there. Here is your answer.')
  expect(speak.mock.calls.map(([text]) => text)).toEqual(['Hello there. ', 'Here is your answer.'])
  await speech.finish('Hello there. Here is your answer.')
  expect(speak).toHaveBeenCalledTimes(2)
})

test('holds a long unfinished sentence until the final answer instead of splitting it', async () => {
  const speak = jest.fn().mockResolvedValue(undefined)
  const speech = createMiraStreamingSpeech({ speak, live: () => true })
  const text = 'Yeh aapke project ki jaankari hai '.repeat(5)
  speech.update(text)
  await Promise.resolve()
  expect(speak).not.toHaveBeenCalled()
  await speech.finish(text)
  expect(speak.mock.calls.map(([chunk]) => chunk).join('')).toBe(text)
  expect(speak).toHaveBeenCalledTimes(1)
})

test('keeps long sentences, titles, decimals and closing quotes intact', async () => {
  const speak = jest.fn().mockResolvedValue(undefined)
  const speech = createMiraStreamingSpeech({ speak, live: () => true })
  const first = 'Dr. Sharma says "' + 'please review the project carefully '.repeat(7) + 'before 3.30 pm." '
  speech.update(first + 'Then reply')
  await Promise.resolve()
  expect(speak).toHaveBeenCalledWith(first)
  await speech.finish(first + 'Then reply when ready.')
  expect(speak.mock.calls.map(([chunk]) => chunk)).toEqual([first, 'Then reply when ready.'])
})

test('does not play queued chunks after interruption', async () => {
  let live = true
  const speak = jest.fn()
  const speech = createMiraStreamingSpeech({ speak, live: () => live })
  speech.update('First sentence. Second sentence.')
  live = false
  await speech.finish('First sentence. Second sentence.')
  expect(speak).not.toHaveBeenCalled()
})

test('holds unfinished code blocks and reports playback failure', async () => {
  const speak = jest.fn().mockRejectedValue(new Error('TTS unavailable'))
  const speech = createMiraStreamingSpeech({ speak, live: () => true })
  speech.update('```code in progress')
  await Promise.resolve()
  expect(speak).not.toHaveBeenCalled()
  await expect(speech.finish('Complete answer.')).rejects.toThrow('TTS unavailable')
})
