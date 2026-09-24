import { searchMiraInternet } from './miraWebSearch'
import { getMiraWeather } from './miraWeather'

// Public query text only: never attach conversation history or workplace records.
export async function getMiraInternetContext(message, screen, previousUserMessage = '') {
  if (/weather|मौसम|mausam/i.test(previousUserMessage) && /^[\p{L}\p{M}\s-]{2,60}$/u.test(message.trim()) && !/weather|मौसम|mausam/i.test(message)) {
    message = `weather in ${message.trim()}`
  }
  const weather = /weather|मौसम|mausam|temperature/i.test(message)
  const explicitSearch = /search|look up|internet|online|खोज|इंटरनेट/i.test(message)
  const currentPublic = /latest|news|current price|आज.*समाचार|ताजा.*खबर/i.test(message)
  if (!weather && !explicitSearch && !currentPublic) return null
  if (/my tasks|attendance|salary|payroll|employee|मेरे.*काम|वेतन|हाजिरी/i.test(message)) return null
  let query = String(message).replace(/(?:please\s+)?search (?:the )?(?:web|internet)(?: for)?/i, '').trim().slice(0, 400)
  if (weather) {
    // Do not send precise GPS or check-in coordinates to public search.
    let place = message.match(/(?:in|for|at)\s+([\p{L}\p{M}\s-]{2,60})/iu)?.[1]?.trim()
      || message.match(/([\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+){0,2})\s+(?:ka|ke|mein|में|का)\s+(?:aaj\s+ka\s+|आज\s+का\s+)?(?:weather|mausam|मौसम|temperature)/iu)?.[1]?.replace(/^(?:please|hey|mira)\s+/i, '')
      || message.match(/([\p{L}\p{M}]{2,40})\s+(?:का|में)\s*(?:आज\s*)?(?:मौसम)/u)?.[1]
    if (!place && screen?.location && Date.now() - screen.location.capturedAt < 300000) {
      const { latitude, longitude } = screen.location
      if (Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180) {
        try {
          // City-level lookup only; no precise GPS, history or workplace records go to search.
          const params = new URLSearchParams({ lat: latitude.toFixed(2), lon: longitude.toFixed(2), format: 'jsonv2', zoom: '10' })
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { headers: { 'User-Agent': 'Talio-MIRA/1.0 (https://app.talio.in)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(4000) })
          if (response.ok) {
            const geo = await response.json()
            place = geo.address?.city || geo.address?.town || geo.address?.municipality
          }
        } catch { /* Ask for a city when reverse geocoding is unavailable. */ }
      }
    }
    if (!place || ['आज', 'अभी', 'aaj', 'my', 'here'].includes(place.toLowerCase())) return { unavailable: 'Ask which city the user wants weather for. Do not guess a city from their timezone or workplace records.' }
    const city = place.replace(/\b(weather|today|now|tonight)\b/gi, '').trim()
    const forecast = await getMiraWeather(city)
    if (forecast) return forecast
    query = `${city} weather today ${new Date().toISOString().slice(0, 10)}`
  }
  try { return await searchMiraInternet(query) }
  catch { return { unavailable: 'The internet lookup failed. Do not claim current verification.' } }
}
