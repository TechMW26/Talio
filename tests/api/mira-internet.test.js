import { getMiraInternetContext, miraWeatherPlace } from '@/lib/miraInternet'
import { searchMiraInternet } from '@/lib/miraWebSearch'
jest.mock('@/lib/miraWebSearch', () => ({ searchMiraInternet: jest.fn() }))
beforeEach(() => { global.fetch = jest.fn(); delete process.env.BRAVE_SEARCH_API_KEY; delete process.env.OPEN_METEO_API_KEY })
test.each([
  ['Search the web for मीरा, बताओ ना भोपाल का weather कैसा है? भोपाल का आज का weather कैसा है, ये बताओ।', 'भोपाल'],
  ['Mira, weather in Bhopal today', 'Bhopal'],
  ['What is the weather like in New Delhi?', 'New Delhi'],
  ['Search the web for New Delhi ka weather batao', 'New Delhi'],
  ['मीरा का weather कैसा है?', null],
  ['आज का मौसम', null],
])('extracts the location, not the assistant address: %s', (message, city) => {
  expect(miraWeatherPlace(message)).toBe(city)
})
test('voice search wrapper never sends Mira as the weather city', async () => {
  await getMiraInternetContext('Search the web for मीरा, बताओ ना भोपाल का weather कैसा है?', {})
  expect(searchMiraInternet).toHaveBeenLastCalledWith(expect.stringMatching(/^भोपाल weather today/))
})
test('ordinary workspace questions never go to public search', async () => {
  expect(await getMiraInternetContext('My pending tasks', {})).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
test('weather is honest about missing configuration and location', async () => {
  expect((await getMiraInternetContext('आज का मौसम', {})).unavailable).toBeTruthy()
  expect(fetch).not.toHaveBeenCalled()
})
test('uses the original MIRA search pipeline without passing private context', async () => {
  searchMiraInternet.mockResolvedValue({ results: [{ title: 'Moon', url: 'https://example.org/moon' }] })
  const result = await getMiraInternetContext('Search the web for Moon', { secret: 'private' })
  expect(result.results[0].url).toBe('https://example.org/moon')
  expect(searchMiraInternet).toHaveBeenLastCalledWith('Moon')
})
test('a city clarification continues the weather lookup without sending GPS', async () => {
  await getMiraInternetContext('Bhopal', { location: { latitude: 23.25, longitude: 77.4 } }, 'आज का मौसम कैसा है?')
  expect(searchMiraInternet).toHaveBeenLastCalledWith(expect.stringContaining('Bhopal weather today'))
})
test('mixed Hindi and Hinglish weather requests use the explicit city', async () => {
  await getMiraInternetContext('भोपाल का weather बताओ', {})
  expect(searchMiraInternet).toHaveBeenLastCalledWith(expect.stringContaining('भोपाल weather today'))
  await getMiraInternetContext('Bhopal ka weather batao', {})
  expect(searchMiraInternet).toHaveBeenLastCalledWith(expect.stringContaining('Bhopal weather today'))
})
