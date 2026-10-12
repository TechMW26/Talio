import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { act, renderHook } from '@testing-library/react'
import useMiraAgentVoice from '@/hooks/useMiraAgentVoice'

const mockStart = jest.fn()
jest.mock('@elevenlabs/client', () => ({ Conversation: { startSession: (...args) => mockStart(...args) } }))
jest.mock('@/lib/miraListeningAudio', () => ({ createMiraListeningAudio: () => ({ close: jest.fn(), cancel: jest.fn(), play: jest.fn() }) }))

const root = process.cwd()
const assets = [
  ['elevenlabs-1.27.0/rawAudioProcessor.js', '@elevenlabs/client/worklets/rawAudioProcessor.js'],
  ['elevenlabs-1.27.0/audioConcatProcessor.js', '@elevenlabs/client/worklets/audioConcatProcessor.js'],
  ['libsamplerate-2.1.2/libsamplerate.worklet.js', '@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js'],
]
test.each(assets)('self-hosted %s matches the installed upstream source apart from trailing whitespace', (asset, upstream) => {
  expect(fs.readFileSync(path.join(root, 'public/mira/worklets', asset), 'utf8'))
    .toEqual(fs.readFileSync(path.join(root, 'node_modules', upstream), 'utf8').replace(/[\t ]+$/gm, ''))
})
test.each(['rawAudioProcessor', 'audioConcatProcessor'])('%s registers the processor expected by the SDK', name => {
  const registerProcessor = jest.fn()
  vm.runInNewContext(fs.readFileSync(path.join(root, `public/mira/worklets/elevenlabs-1.27.0/${name}.js`), 'utf8'), {
    AudioWorkletProcessor: class {}, registerProcessor,
  })
  expect(registerProcessor).toHaveBeenCalledWith(name, expect.any(Function))
})
test('voice startup uses same-origin microphone, playback and resampler assets without widening CSP', async () => {
  const originalFetch = global.fetch
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, signedUrl: 'wss://voice.example/private', voiceId: 'voice' }) }))
  mockStart.mockResolvedValue({ endSession: jest.fn(async () => {}) })
  const { result, unmount } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage: jest.fn() }))
  try {
    await act(async () => result.current.start())
    const options = mockStart.mock.calls.at(-1)[0]
    expect(options.workletPaths).toEqual({
      rawAudioProcessor: '/mira/worklets/elevenlabs-1.27.0/rawAudioProcessor.js',
      audioConcatProcessor: '/mira/worklets/elevenlabs-1.27.0/audioConcatProcessor.js',
    })
    expect(options.libsampleratePath).toBe('/mira/worklets/libsamplerate-2.1.2/libsamplerate.worklet.js')
    for (const url of [...Object.values(options.workletPaths), options.libsampleratePath]) {
      expect(fs.existsSync(path.join(root, 'public', url))).toBe(true)
    }
    const config = require(path.join(root, 'next.config.js'))
    const headers = await config.headers()
    const csp = headers.find(rule => rule.source === '/:path*').headers.find(header => header.key === 'Content-Security-Policy').value
    const scripts = csp.split(';').find(directive => directive.trim().startsWith('script-src '))
    expect(scripts).toContain("'self'")
    expect(scripts).not.toMatch(/blob:|data:|jsdelivr/)
  } finally { unmount(); global.fetch = originalFetch }
})
