import { searchMiraInternet } from './miraWebSearch'

// Public query text only: never attach conversation history or workplace records.
export async function getMiraInternetContext(message, screen, previousUserMessage = '') {
  if (/weather|मौसम/i.test(previousUserMessage) && /^[\p{L}\s-]{2,60}$/u.test(message.trim()) && !/weather|मौसम/i.test(message)) {
    message = `weather in ${message.trim()}`
  }
  const weather = /weather|मौसम/i.test(message)
  const explicitSearch = /search|look up|internet|online|खोज|इंटरनेट/i.test(message)
  const currentPublic = /latest|news|current price|आज.*समाचार|ताजा.*खबर/i.test(message)
  if (!weather && !explicitSearch && !currentPublic) return null
  if (/my tasks|attendance|salary|payroll|employee|मेरे.*काम|वेतन|हाजिरी/i.test(message)) return null
  let query = String(message).replace(/(?:please\s+)?search (?:the )?(?:web|internet)(?: for)?/i, '').trim().slice(0, 400)
  if (weather) {
    // Do not send precise GPS or check-in coordinates to public search.
    const place = message.match(/(?:in|for|at)\s+([\p{L}\s-]{2,60})/iu)?.[1]?.trim()
      || message.match(/([\p{L}]{2,40})\s+(?:का|में)\s*(?:आज\s*)?(?:मौसम)/u)?.[1]
    if (!place || ['आज', 'अभी'].includes(place)) return { unavailable: 'Ask which city the user wants weather for. Do not guess a city from their timezone or workplace records.' }
    const city = place.replace(/\b(weather|today|now|tonight)\b/gi, '').trim()
    query = `${city} weather today ${new Date().toISOString().slice(0, 10)}`
  }
  try { return await searchMiraInternet(query) }
  catch { return { unavailable: 'The internet lookup failed. Do not claim current verification.' } }
}
