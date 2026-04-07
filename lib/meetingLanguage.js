const DEVANAGARI_REGEX = /[\u0900-\u097F]/
const LATIN_REGEX = /[A-Za-z]/

const LANGUAGE_ALIASES = {
  english: 'en',
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  hindi: 'hi',
  hi: 'hi',
  hinglish: 'hinglish',
  'hi-latn': 'hinglish',
  'hindi-latin': 'hinglish',
  auto: 'auto',
}

const HINGLISH_HINTS = [
  'hai',
  'haan',
  'nahi',
  'nahin',
  'karna',
  'karo',
  'krna',
  'kyunki',
  'matlab',
  'acha',
  'achha',
  'thik',
  'theek',
  'samajh',
  'yaar',
  'waise',
]

const ENGLISH_HINTS = [
  'the',
  'and',
  'for',
  'with',
  'next',
  'need',
  'will',
  'please',
  'summary',
  'action',
]

function countMatches(text, words) {
  return words.reduce((total, word) => {
    const regex = new RegExp(`(^|\\s)${word}(?=\\s|$)`, 'g')
    return total + (text.match(regex)?.length || 0)
  }, 0)
}

export function normalizeMeetingLanguage(language) {
  if (!language) return 'auto'

  const normalized = String(language).trim().toLowerCase()
  return LANGUAGE_ALIASES[normalized] || normalized
}

export function detectMeetingLanguage(text, fallback = 'en') {
  if (!text || !text.trim()) {
    return normalizeMeetingLanguage(fallback)
  }

  const sample = text.trim()
  const lowerSample = sample.toLowerCase()
  const hasDevanagari = DEVANAGARI_REGEX.test(sample)
  const hasLatin = LATIN_REGEX.test(sample)

  if (hasDevanagari && hasLatin) {
    return 'hinglish'
  }

  if (hasDevanagari) {
    return 'hi'
  }

  if (!hasLatin) {
    return normalizeMeetingLanguage(fallback)
  }

  const hinglishHits = countMatches(lowerSample, HINGLISH_HINTS)
  const englishHits = countMatches(lowerSample, ENGLISH_HINTS)

  if (hinglishHits >= 2 || (hinglishHits >= 1 && englishHits >= 1)) {
    return 'hinglish'
  }

  return 'en'
}

export function pickMeetingOutputLanguage(languages = [], transcriptText = '', fallback = 'en') {
  const normalizedLanguages = [...new Set(
    (languages || [])
      .map(normalizeMeetingLanguage)
      .filter(Boolean)
      .filter(language => language !== 'auto')
  )]

  if (normalizedLanguages.includes('hinglish')) {
    return 'hinglish'
  }

  if (normalizedLanguages.includes('hi') && normalizedLanguages.includes('en')) {
    return 'hinglish'
  }

  if (normalizedLanguages.length === 1) {
    return normalizedLanguages[0]
  }

  if (normalizedLanguages.length > 1) {
    return normalizedLanguages[0]
  }

  return detectMeetingLanguage(transcriptText, fallback)
}

export function buildTranscriptSegmentKey(segment = {}) {
  if (segment.segmentId) {
    return segment.segmentId
  }

  return [
    segment.speaker?._id || segment.speaker || segment.speakerName || 'unknown',
    segment.timestamp ? new Date(segment.timestamp).toISOString() : 'no-time',
    segment.text || '',
  ].join('::')
}

export function sortMeetingTranscript(transcript = []) {
  return [...transcript].sort((left, right) => {
    const leftTime = left?.timestamp ? new Date(left.timestamp).getTime() : 0
    const rightTime = right?.timestamp ? new Date(right.timestamp).getTime() : 0
    return leftTime - rightTime
  })
}

export function mergeTranscriptSegments(existing = [], incoming = []) {
  const mergedMap = new Map()

  for (const segment of existing) {
    mergedMap.set(buildTranscriptSegmentKey(segment), segment)
  }

  for (const segment of incoming) {
    mergedMap.set(buildTranscriptSegmentKey(segment), segment)
  }

  return sortMeetingTranscript([...mergedMap.values()])
}

export function formatMeetingTranscriptForPrompt(transcript = [], maxCharacters = 28000) {
  const formatted = sortMeetingTranscript(transcript)
    .map(segment => {
      const timestamp = segment?.timestamp
        ? new Date(segment.timestamp).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '--:--'

      const language = normalizeMeetingLanguage(segment?.language || 'auto')
      return `[${timestamp}] ${segment?.speakerName || 'Unknown'} (${language}): ${segment?.text || ''}`
    })
    .join('\n')

  if (formatted.length <= maxCharacters) {
    return formatted
  }

  return `${formatted.slice(0, maxCharacters)}\n...[transcript truncated for length]`
}
