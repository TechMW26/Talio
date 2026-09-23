import { createMiraStreamingSpeech } from '@/lib/miraStreamingSpeech'

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

test('chunks a long phrase without punctuation and flushes a short final tail', async () => {
  const speak = jest.fn().mockResolvedValue(undefined)
  const speech = createMiraStreamingSpeech({ speak, live: () => true })
  const text = 'Yeh aapke project ki jaankari hai '.repeat(5)
  speech.update(text)
  await Promise.resolve()
  expect(speak).toHaveBeenCalled()
  await speech.finish(text)
  expect(speak.mock.calls.map(([chunk]) => chunk).join('')).toBe(text)
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
