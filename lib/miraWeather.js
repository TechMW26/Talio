const cache = new Map()

// Public city only. Never infer location from the server IP or employee records.
export async function getMiraWeather(city) {
  const key = String(city || '').trim()
  if (!key || key.length > 100 || !/^[\p{L}\p{M}\s,.-]+$/u.test(key)) return null
  const previous = cache.get(key.toLowerCase())
  if (previous && Date.now() - previous.at < 300000) return previous.value
  try {
    const url = `https://wttr.in/${encodeURIComponent(key)}?format=j1`
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) return null
    const data = await response.json()
    const current = data.current_condition?.[0], day = data.weather?.[0]
    // Reject stale provider payloads instead of presenting them as today's weather.
    if (!current || !day?.date || Math.abs(Date.now() - Date.parse(day.date)) > 36 * 3600000 || !Number.isFinite(Number(current.temp_C))) return null
    const summary = {
      requestedCity: key, resolvedCity: data.nearest_area?.[0]?.areaName?.[0]?.value,
      country: data.nearest_area?.[0]?.country?.[0]?.value,
      observationTime: current.localObsDateTime || current.observation_time,
      temperatureC: Number(current.temp_C), feelsLikeC: current.FeelsLikeC,
      conditions: current.weatherDesc?.[0]?.value, humidityPercent: current.humidity,
      windKmph: current.windspeedKmph,
      forecast: (data.weather || []).slice(0, 3).map(item => ({ date: item.date, minC: item.mintempC, maxC: item.maxtempC,
        hourly: (item.hourly || []).map(hour => ({ time: hour.time, rainChancePercent: hour.chanceofrain, description: hour.weatherDesc?.[0]?.value })) })),
    }
    const value = { source: 'wttr.in weather', retrievedAt: new Date().toISOString(), results: [{ title: `Weather for ${key}`, url: `https://wttr.in/${encodeURIComponent(key)}`, snippet: JSON.stringify(summary) }] }
    if (cache.size >= 100) cache.delete(cache.keys().next().value)
    cache.set(key.toLowerCase(), { at: Date.now(), value })
    return value
  } catch { return null }
}
