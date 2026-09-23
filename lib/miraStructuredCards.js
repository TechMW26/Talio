// Bound generated JSON before handing it to React. Never render model-supplied HTML.
export function sanitizeMiraCards(cards) {
  if (!Array.isArray(cards)) return []
  const text = value => typeof value === 'string' ? value.slice(0, 500) : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  return cards.slice(0, 3).flatMap(card => {
    if (!card || !card.data) return []
    const result = { type: card.type, title: text(card.title), data: {} }
    if (card.type === 'stat' && Array.isArray(card.data.stats)) {
      result.data.stats = card.data.stats.slice(0, 8).map(s => ({ label: text(s?.label), value: text(s?.value) }))
      if (!result.data.stats.length) return []
    } else if (card.type === 'table' && Array.isArray(card.data.headers) && Array.isArray(card.data.rows)) {
      result.data.headers = card.data.headers.slice(0, 6).map(text)
      result.data.rows = card.data.rows.slice(0, 20).filter(Array.isArray).map(row => row.slice(0, result.data.headers.length).map(text))
      if (!result.data.headers.length || !result.data.rows.length) return []
    } else if (card.type === 'list' && Array.isArray(card.data.items)) {
      result.data.items = card.data.items.slice(0, 20).map(item => ({ title: text(item?.title), subtitle: text(item?.subtitle) }))
      if (!result.data.items.length) return []
    } else return []
    return [result]
  })
}
