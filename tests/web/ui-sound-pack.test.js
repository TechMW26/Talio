jest.mock('@/utils/audio', () => ({ playSound: jest.fn(), unlockAudio: jest.fn() }))

import { playSound } from '@/utils/audio'
import { getNotificationSounds, playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import { UI_SOUNDS } from '@/lib/uiSounds'

beforeEach(() => {
  jest.clearAllMocks()
  getNotificationSounds().setEnabled(true)
  getNotificationSounds().setVolume(0.4)
})

test.each([
  ['CHIME', 'notification'], ['SUCCESS', 'success'], ['ALERT', 'alert'],
  ['WARNING', 'error'], ['UPDATE', 'click'], ['POP', 'messageNotification'],
  ['URGENT', 'alert'], ['REFRESH', 'click'],
])('%s uses the new sound mapping', (type, key) => {
  playNotificationSound(NotificationSoundTypes[type])
  expect(playSound).toHaveBeenCalledWith(key, 0.4)
})

test('preserves mute and volume settings', () => {
  const sounds = getNotificationSounds()
  sounds.setEnabled(false)
  sounds.playChime()
  expect(playSound).not.toHaveBeenCalled()
  sounds.setEnabled(true)
  sounds.setVolume(2)
  sounds.playSuccess()
  expect(playSound).toHaveBeenCalledWith('success', 1)
})

test('all six supplied assets have fresh cache-safe URLs', () => {
  expect(new Set(Object.values(UI_SOUNDS)).size).toBe(6)
  expect(Object.values(UI_SOUNDS).every(url => url.startsWith('/sounds/ui-v3-'))).toBe(true)
})
