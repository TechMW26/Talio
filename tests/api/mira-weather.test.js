import { getMiraWeather } from '@/lib/miraWeather'
beforeEach(() => { global.fetch = jest.fn() })
test('returns observed weather with its source and date', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ current_condition: [{ temp_C: '27', weatherDesc: [{ value: 'Cloudy' }] }], weather: [{ date: new Date().toISOString().slice(0, 10), mintempC: '23', maxtempC: '30' }] }) })
  const result = await getMiraWeather('Test City')
  expect(result.source).toBe('wttr.in weather')
  expect(result.results[0].snippet).toContain('27')
})
test('rejects stale weather and unsafe location input', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ current_condition: [{ temp_C: '27' }], weather: [{ date: '2001-01-01' }] }) })
  expect(await getMiraWeather('Stale City')).toBeNull()
  fetch.mockClear()
  expect(await getMiraWeather('@internal-host')).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
