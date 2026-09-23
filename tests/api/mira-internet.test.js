import { getMiraInternetContext } from '@/lib/miraInternet'
import { searchMiraInternet } from '@/lib/miraWebSearch'
jest.mock('@/lib/miraWebSearch', () => ({ searchMiraInternet: jest.fn() }))
beforeEach(() => { global.fetch = jest.fn(); delete process.env.BRAVE_SEARCH_API_KEY; delete process.env.OPEN_METEO_API_KEY })
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
