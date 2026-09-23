import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import MiraWakeSetup from '@/components/MiraWakeSetup'
import MiraWakeReminder from '@/components/MiraWakeReminder'
import { startMiraLocalRecognition, storeMiraVoiceProfile } from '@/lib/miraWakeWord'

jest.mock('@/lib/miraWakeWord', () => ({ startMiraLocalRecognition: jest.fn(), storeMiraVoiceProfile: jest.fn(), isMiraWakeResult: jest.fn(() => true) }))
jest.mock('@/utils/userHelper', () => ({ getCurrentUser: () => ({ _id: 'user-a', tenantId: 'tenant-a' }) }))
const originalAudio = global.Audio
const playConfirmation = jest.fn()
beforeAll(() => { global.Audio = jest.fn(() => ({ play: playConfirmation, pause: jest.fn(), currentTime: 0 })) })
afterAll(() => { global.Audio = originalAudio })
beforeEach(() => {
  delete window.electronAPI
  jest.resetAllMocks()
  global.Audio.mockImplementation(() => ({ play: playConfirmation, pause: jest.fn(), currentTime: 0 }))
  sessionStorage.clear()
  localStorage.clear()
  localStorage.setItem('mira-wake-enabled:tenant-a:user-a', 'false')
  require('@/lib/miraWakeWord').isMiraWakeResult.mockReturnValue(true)
})
test('new users start wake listening by default without a training prompt', async () => {
  localStorage.clear()
  startMiraLocalRecognition.mockResolvedValue({ stream: {}, stop: jest.fn() })
  let view
  await act(async () => { view = render(<MiraWakeSetup onWake={jest.fn()} onStream={jest.fn()} />) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(startMiraLocalRecognition).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Stop Hey MIRA listening' })).not.toBeInTheDocument()
  act(() => window.dispatchEvent(new Event('mira:voice-settings')))
  fireEvent.click(screen.getByText('Privacy & settings'))
  fireEvent.click(screen.getByText('Stop listening'))
  view.unmount()
  await act(async () => { render(<MiraWakeSetup onWake={jest.fn()} onStream={jest.fn()} />) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(startMiraLocalRecognition).toHaveBeenCalledTimes(1)
})
test('mounting and opening setup never activates the microphone', async () => {
  render(<MiraWakeSetup onWake={jest.fn()} onStream={jest.fn()} />)
  await act(async () => fireEvent.click(screen.getByText('Enable Hey MIRA')))
  expect(startMiraLocalRecognition).not.toHaveBeenCalled()
  expect(storeMiraVoiceProfile).not.toHaveBeenCalled()
})
test('stop cancels a pending model and stops a late stream', async () => {
  let finish
  startMiraLocalRecognition.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const stop = jest.fn()
  render(<MiraWakeSetup onWake={jest.fn()} onStream={jest.fn()} />)
  await act(async () => fireEvent.click(screen.getByText('Enable Hey MIRA')))
  fireEvent.click(screen.getByText('Enable'))
  const signal = startMiraLocalRecognition.mock.calls[0][0].signal
  fireEvent.click(screen.getByText('Stop listening'))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ stop, stream: {} }))
  expect(stop).toHaveBeenCalled()
})
test('deleting local samples uses the signed-in account scope', async () => {
  render(<MiraWakeSetup onWake={jest.fn()} onStream={jest.fn()} />)
  await act(async () => fireEvent.click(screen.getByText('Enable Hey MIRA')))
  await act(async () => fireEvent.click(screen.getByText('Delete old voice checks')))
  expect(storeMiraVoiceProfile).toHaveBeenCalledWith('tenant-a:user-a', null)
})

test('accepted wake plays the supplied sound once; blocked audio does not block MIRA', async () => {
  window.electronAPI = { activateMira: jest.fn().mockRejectedValue(new Error('Desktop unavailable')) }
  // Existing setup allows closing controls while leaving wake detection enabled.
  storeMiraVoiceProfile.mockResolvedValue({ samples: [1, 2, 3] })
  let recognition
  startMiraLocalRecognition.mockImplementation(async options => { recognition = options; return { stream: {}, stop: jest.fn() } })
  playConfirmation.mockImplementation(() => Promise.reject(new Error('Autoplay blocked')))
  const onWake = jest.fn()
  await act(async () => render(<MiraWakeSetup onWake={onWake} onStream={jest.fn()} />))
  await act(async () => fireEvent.click(screen.getByText('Enable Hey MIRA')))
  await act(async () => fireEvent.click(screen.getByText('Enable')))
  expect(playConfirmation).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => { recognition.onResult({}); recognition.onResult({}) })
  expect(playConfirmation).toHaveBeenCalledTimes(1)
  expect(onWake).toHaveBeenCalledTimes(1)
  expect(window.electronAPI.activateMira).toHaveBeenCalledTimes(1)
})

test('remembered opt-in starts once and resumes after voice chat, but not after explicit Stop', async () => {
  localStorage.setItem('mira-wake-enabled:tenant-a:user-a', 'true')
  const engineStop = jest.fn()
  startMiraLocalRecognition.mockResolvedValue({ stream: {}, stop: engineStop })
  const props = { onWake: jest.fn(), onStream: jest.fn() }
  let view
  await act(async () => { view = render(<MiraWakeSetup {...props} />) })
  expect(startMiraLocalRecognition).toHaveBeenCalledTimes(1)
  await act(async () => view.rerender(<MiraWakeSetup {...props} suspended />))
  expect(screen.queryByText('Enable Hey MIRA')).not.toBeInTheDocument()
  expect(screen.queryByText('Hey MIRA controls')).not.toBeInTheDocument()
  expect(engineStop).toHaveBeenCalled()
  await act(async () => view.rerender(<MiraWakeSetup {...props} suspended={false} />))
  expect(startMiraLocalRecognition).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Enable Hey MIRA')).not.toBeInTheDocument()
  act(() => window.dispatchEvent(new Event('mira:voice-settings')))
  fireEvent.click(screen.getByText('Privacy & settings'))
  fireEvent.click(screen.getByText('Stop listening'))
  expect(localStorage.getItem('mira-wake-enabled:tenant-a:user-a')).toBe('false')
  await act(async () => view.rerender(<MiraWakeSetup {...props} suspended />))
  await act(async () => view.rerender(<MiraWakeSetup {...props} suspended={false} />))
  expect(startMiraLocalRecognition).toHaveBeenCalledTimes(2)
})

test('blocked automatic startup shows a recovery prompt without a retry loop', async () => {
  localStorage.setItem('mira-wake-enabled:tenant-a:user-a', 'true')
  startMiraLocalRecognition.mockRejectedValue(new Error('Microphone permission required'))
  await act(async () => render(<MiraWakeSetup onWake={jest.fn()} onStream={jest.fn()} />))
  expect(startMiraLocalRecognition).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert')).toHaveTextContent('Microphone permission required')
  expect(screen.getByText('Enable')).toBeInTheDocument()
})

test('header reminder starts the actual wake listener and disappears on success', async () => {
  startMiraLocalRecognition.mockResolvedValue({ stream: {}, stop: jest.fn() })
  await act(async () => render(<><MiraWakeReminder /><MiraWakeSetup onWake={jest.fn()} onStream={jest.fn()} /></>))
  expect(screen.getByRole('complementary', { name: 'Enable Hey MIRA reminder' })).toBeInTheDocument()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enable' })))
  expect(startMiraLocalRecognition).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(localStorage.getItem('mira-wake-enabled:tenant-a:user-a')).toBe('true')
})
