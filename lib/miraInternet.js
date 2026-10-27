import { searchMiraInternet } from './miraWebSearch'
import { getMiraWeather } from './miraWeather'
import { publicMiraSearchQuery } from './miraSearchQuery'

export function miraWeatherPlace(message) {
  // The voice search endpoint adds "Search the web for". That "for" must
  // never become a location delimiter (e.g. "for मीरा, बताओ ... भोपाल").
  const text = String(message || '').replace(/^(?:please\s+)?search (?:the )?(?:web|internet)(?: for)?\s*/i, '')
    .replace(/^(?:(?:hey|hi|please|mira|मीरा|मीरा जी)[,।!\s]+)+/iu, '')
  const english = text.match(/\b(?:weather|temperature)(?:\s+(?:like|today|now))?\s+(?:in|for|at)\s+([\p{L}\p{M}\s-]{2,60})/iu)?.[1]
  const local = text.match(/([\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+){0,3})\s+(?:ka|ke|mein|में|का)\s+(?:aaj\s+ka\s+|आज\s+का\s+)?(?:weather|mausam|मौसम|temperature)/iu)?.[1]
  const compact = text.match(/^([\p{L}\p{M}\s-]{2,60})\s+(?:weather|temperature)\b/iu)?.[1]
  const compactPlace = compact && !/\b(?:what|how|tell|is|the|today|my|our|please)\b/i.test(compact) ? compact : ''
  const place = (english || local || compactPlace || '').trim()
    .replace(/^(?:(?:please|hey|mira|tell me|batao|bataiye|na|मीरा|बताओ|बताइए|ना|आज)\s+)+/iu, '')
    .replace(/\s+(?:today|now|tonight|please|right now)$/i, '').trim()
  return place && !/^(?:mira|meera|मीरा|आज|अभी|aaj|my|here|का|के|की|में|ka|ke|ki|mein)$/iu.test(place) ? place : null
}

// A live agent may request a public lookup without the caller saying "search".
// Send only that accepted utterance, never history, screen data or DB records.
export function miraPublicVoiceQuery(message) {
  return publicMiraSearchQuery(message)
}

// Public query text only: never attach conversation history or workplace records.
export async function getMiraInternetContext(message, screen, previousUserMessage = '', options = {}) {
  options.signal?.throwIfAborted()
  if (/weather|मौसम|mausam/i.test(previousUserMessage) && /^[\p{L}\p{M}\s-]{2,60}$/u.test(message.trim()) && !/weather|मौसम|mausam/i.test(message)) {
    message = `weather in ${message.trim()}`
  }
  const weather = /weather|मौसम|mausam|temperature/i.test(message)
  const explicitSearch = /search|look up|internet|online|खोज|इंटरनेट/i.test(message)
  const currentPublic = /latest|news|current price|आज.*समाचार|ताजा.*खबर/i.test(message)
  if (!weather && !explicitSearch && !currentPublic) return null
  if (!miraPublicVoiceQuery(message)) return null
  let query = miraPublicVoiceQuery(String(message).replace(/(?:please\s+)?search (?:the )?(?:web|internet)(?: for)?/i, '').trim().slice(0, 400))
  if (weather) {
    // Do not send precise GPS or check-in coordinates to public search.
    let place = miraWeatherPlace(message)
    if (!place && screen?.location && Date.now() - screen.location.capturedAt < 300000) {
      const { latitude, longitude } = screen.location
      if (Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180) {
        try {
          // City-level lookup only; no precise GPS, history or workplace records go to search.
          const params = new URLSearchParams({ lat: latitude.toFixed(2), lon: longitude.toFixed(2), format: 'jsonv2', zoom: '10' })
          const timeout = AbortSignal.timeout(3000)
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { headers: { 'User-Agent': 'Talio-MIRA/1.0 (https://app.talio.in)', 'Accept-Language': 'en' }, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout })
          if (response.ok) {
            const geo = await response.json()
            place = geo.address?.city || geo.address?.town || geo.address?.municipality
          }
        } catch (error) { if (options.signal?.aborted) throw error /* Ask for a city when reverse geocoding is unavailable. */ }
      }
    }
    if (!place || ['आज', 'अभी', 'aaj', 'my', 'here'].includes(place.toLowerCase())) return { unavailable: 'Ask which city the user wants weather for. Do not guess a city from their timezone or workplace records.' }
    const city = place.replace(/\b(weather|today|now|tonight)\b/gi, '').trim()
    const forecast = await getMiraWeather(city, options)
    if (forecast) return forecast
    query = `${city} weather today ${new Date().toISOString().slice(0, 10)}`
  }
  try { return await searchMiraInternet(query, ...(Object.keys(options).length ? [options] : [])) }
  catch (error) {
    if (options.signal?.aborted) throw error
    return { unavailable: 'The internet lookup failed. Do not claim current verification.' }
  }
}
