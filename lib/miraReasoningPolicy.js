// Keep casual voice turns on the instant path. Numerical chains and interval
// constraints need deliberation, but not another routing-model round trip.
export function miraNeedsDeliberation(messages = []) {
  const last = messages.filter(m => m.role === 'user').at(-1)?.content || ''
  const text = last.slice(0, 12000)
  const operations = text.match(/\b(?:double|triple|multiply|divide|subtract|add|plus|minus|times|percent|probability)\b|गुणा|भाग|जोड़|घटा/giu) || []
  const numbers = text.match(/\d+(?::\d+)?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|hundred|thousand)\b|एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस/giu) || []
  const intervals = /\b(?:slot|occupied|overlap|availability|free|schedule|duration)\b|खाली|समय|अवधि/iu.test(text)
  return (operations.length >= 2 && numbers.length >= 2) || (intervals && numbers.length >= 3)
}
