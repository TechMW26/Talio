import { miraAppPath } from './miraAppRoutes'

// Use the header's authenticated, permission-filtered AI Search rather than
// guessing routes or scraping links from unrelated pages.
export async function searchMiraNavigation(target, { token, signal } = {}) {
  const query = String(target || '').trim().slice(0, 100)
  if (query.length < 2 || /^ui-\d+$/.test(query)) return []
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal,
  })
  if (!response.ok) throw new Error('AI Search is unavailable. Please try again.')
  const result = await response.json()
  if (!result.success || !Array.isArray(result.data?.pages)) return []
  const seen = new Set()
  return result.data.pages.flatMap(item => {
    const path = miraAppPath(item?.link)
    if (!path || seen.has(path) || typeof item.title !== 'string') return []
    seen.add(path)
    return [{ title: item.title.slice(0, 100), path }]
  }).slice(0, 10)
}
