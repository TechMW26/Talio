/**
 * Designation seniority ranking via AI.
 *
 * Returns a Map of (lowercased designation title) -> numeric rank (higher = more senior).
 * Caches per-tenant per-designation-set in process memory so we don't re-call AI on
 * every request. Falls back to a heuristic title-keyword scorer if AI fails.
 */

import { generateSmartContent } from './promptEngine'

const CACHE = new Map() // key -> { ts, ranks }
const TTL_MS = 24 * 60 * 60 * 1000 // 24h

function heuristicRank(title) {
  const t = (title || '').toLowerCase().trim()
  if (!t) return 10

  // Top-tier
  if (/(^|\b)(ceo|chief executive|founder|co[- ]?founder|owner|managing director|md)\b/.test(t)) return 100
  if (/\b(cto|coo|cfo|cmo|cpo|chro|ciso|cio|chief)\b/.test(t)) return 95
  if (/\b(president|svp|senior vice president)\b/.test(t)) return 90
  if (/\b(vp|vice president)\b/.test(t)) return 85
  if (/\b(director|head of|head)\b/.test(t)) return 80
  if (/\b(senior manager|sr\. manager|sr manager|principal)\b/.test(t)) return 70
  if (/\b(manager|architect)\b/.test(t)) return 65
  if (/\b(team lead|tech lead|lead|supervisor)\b/.test(t)) return 55
  if (/\b(senior|sr\.|sr )\b/.test(t)) return 45
  if (/\b(specialist|consultant|engineer ii|developer ii|analyst ii)\b/.test(t)) return 40
  if (/\b(executive|associate|engineer|developer|analyst|designer|writer|editor)\b/.test(t)) return 35
  if (/\b(junior|jr\.|jr )\b/.test(t)) return 25
  if (/\b(trainee|intern|apprentice)\b/.test(t)) return 10
  return 30
}

function parseRanks(rawText, titles) {
  const trimmed = (rawText || '').trim()
  const jsonMatch = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0])
    const arr = Array.isArray(parsed) ? parsed : parsed?.designations
    if (!Array.isArray(arr)) return null
    const map = new Map()
    for (const item of arr) {
      const title = (item?.title || item?.designation || item?.name || '').toString().toLowerCase().trim()
      const rank = Number(item?.rank ?? item?.score ?? item?.seniority)
      if (title && Number.isFinite(rank)) {
        map.set(title, Math.max(0, Math.min(100, rank)))
      }
    }
    // Fill any missing titles with heuristic
    for (const t of titles) {
      const k = t.toLowerCase().trim()
      if (!map.has(k)) map.set(k, heuristicRank(t))
    }
    return map
  } catch {
    return null
  }
}

/**
 * Rank a list of designation titles by seniority using AI.
 * @param {string[]} titles - unique designation titles
 * @param {string} cacheKey - tenant-scoped cache key
 * @returns {Promise<Map<string, number>>} title (lowercased) -> rank 0..100
 */
export async function rankDesignations(titles, cacheKey = 'global') {
  const unique = Array.from(new Set((titles || []).filter(Boolean).map((t) => t.trim()))).sort()
  if (unique.length === 0) return new Map()

  const sigKey = `${cacheKey}::${unique.join('|').toLowerCase()}`
  const cached = CACHE.get(sigKey)
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached.ranks
  }

  const prompt = `You are an organizational design expert.
Rank the following job titles by seniority on a 0-100 scale where 100 = most senior (CEO/Founder), 0 = trainee/intern.

IMPORTANT RULES:
- Use the title text only. Ignore numeric "level" suffixes.
- C-suite titles (CEO, CTO, COO, CFO, CMO, CHRO, etc.) = 90-100.
- VPs/SVPs = 80-90. Directors/Heads of <X> = 70-85.
- Senior Managers/Principals = 65-75. Managers/Architects = 55-70.
- Leads/Supervisors = 45-60. Senior IC = 40-55. Mid-level = 30-45.
- Junior/Associate = 15-30. Trainee/Intern = 0-15.
- Be consistent: a "Senior Manager" must score higher than a "Manager".
- Two distinct titles MAY share the same rank if they are peers.

Job titles to rank:
${unique.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Return ONLY this JSON (no prose):
{
  "designations": [
    { "title": "<exact title>", "rank": <number 0-100> }
  ]
}`

  try {
    const text = await generateSmartContent(prompt, {
      feature: 'designation-ranking',
      skipRefinement: true,
      skipGuardrails: true,
      skipContext: true,
    })
    const ranks = parseRanks(text, unique)
    if (ranks && ranks.size > 0) {
      CACHE.set(sigKey, { ts: Date.now(), ranks })
      return ranks
    }
  } catch (err) {
    console.warn('[designationRanker] AI ranking failed, using heuristic:', err.message)
  }

  // Fallback: heuristic
  const ranks = new Map()
  for (const t of unique) ranks.set(t.toLowerCase(), heuristicRank(t))
  CACHE.set(sigKey, { ts: Date.now(), ranks })
  return ranks
}

export function rankFor(ranksMap, title) {
  if (!title) return 0
  return ranksMap.get(title.toLowerCase().trim()) ?? heuristicRank(title)
}
