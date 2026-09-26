import { requestTalioDevicePermission, readTalioDevicePermissions } from '@/lib/talioDevicePermissions'
test('camera and microphone checks immediately release the device', async () => {
  const stop = jest.fn(), getUserMedia = jest.fn(async () => ({ getTracks: () => [{ stop }] }))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  await requestTalioDevicePermission('camera')
  expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: true })
  await requestTalioDevicePermission('microphone')
  expect(stop).toHaveBeenCalledTimes(2)
})
test('location check is one-shot and does not return coordinates', async () => {
  const getCurrentPosition = jest.fn(resolve => resolve({ coords: { latitude: 1, longitude: 2 } }))
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  await expect(requestTalioDevicePermission('location')).resolves.toBeUndefined()
  expect(getCurrentPosition.mock.calls[0][2].timeout).toBe(10000)
})
test('unknown browser permission APIs are not reported as granted', async () => {
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: jest.fn().mockRejectedValue(new Error('unsupported')) } })
  expect(await readTalioDevicePermissions()).toMatchObject({ location: 'runtime', camera: 'runtime', microphone: 'runtime' })
})
