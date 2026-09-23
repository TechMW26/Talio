// Ported from the original MIRA project for matching search behavior.
const JINA_SEARCH_URL = 'https://s.jina.ai/';
const JINA_READER_URL = 'https://r.jina.ai/';
const SEARCH_TIMEOUT_MS = 6_000;
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const READER_CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 30 * 1000;
const SEARCH_CACHE = new Map();
const SEARCH_IN_FLIGHT = new Map();
const READER_CACHE = new Map();
let searchUnavailableUntil = 0;

function setBoundedCache(cache, key, value, limit = 100) {
  if (cache.size >= limit && !cache.has(key)) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
}

function jinaKey() {
  return String(process.env.JINA_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

function boundedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function cleanText(value = '', limit = 1800) {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function normalizeItem(item = {}) {
  const url = String(item.url || item.link || item.source || '').trim();
  const title = cleanText(item.title || item.name || url || 'Web result', 240);
  const snippet = cleanText(
    item.description || item.snippet || item.content || item.text || item.markdown || title,
  );
  if (!title || !snippet) return null;
  return {
    title,
    snippet,
    url,
    ...(item.publishedTime || item.publishedAt || item.date
      ? { publishedAt: String(item.publishedTime || item.publishedAt || item.date) }
      : {}),
    provider: 'jina',
  };
}

export function parseJinaSearchPayload(payload = {}) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.results)
        ? payload.results
        : [];
  return candidates.map(normalizeItem).filter(Boolean);
}

export async function searchJina(query, { signal } = {}) {
  const key = jinaKey();
  if (!key) return null;
  const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!normalizedQuery) return null;
  const now = Date.now();
  const cached = SEARCH_CACHE.get(normalizedQuery);
  if (cached?.expiresAt > now) return cached.results;
  if (now < searchUnavailableUntil) return null;
  if (SEARCH_IN_FLIGHT.has(normalizedQuery)) return SEARCH_IN_FLIGHT.get(normalizedQuery);

  const pending = (async () => {
    try {
      const response = await fetch(`${JINA_SEARCH_URL}?q=${encodeURIComponent(normalizedQuery)}`, {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          'X-Return-Format': 'markdown',
          'X-Retain-Images': 'none',
          // Search needs SERP evidence, not five fully crawled pages. This keeps
          // the preferred provider in the 1-3 second range; /api/crawl handles
          // deep reading separately through r.jina.ai.
          'X-Respond-With': 'no-content',
        },
        signal: boundedSignal(signal, SEARCH_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!response.ok) {
        if ([401, 403, 429, 500, 502, 503, 504].includes(response.status)) {
          searchUnavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
        }
        return null;
      }
      const payload = await response.json().catch(() => null);
      const results = parseJinaSearchPayload(payload);
      if (!results.length) return null;
      searchUnavailableUntil = 0;
      setBoundedCache(SEARCH_CACHE, normalizedQuery, {
        results,
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      });
      return results;
    } catch {
      searchUnavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
      return null;
    } finally {
      SEARCH_IN_FLIGHT.delete(normalizedQuery);
    }
  })();
  SEARCH_IN_FLIGHT.set(normalizedQuery, pending);
  return pending;
}
