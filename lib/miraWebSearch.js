// Text-search pipeline ported from MIRA/api/search.js. Media crawling is intentionally excluded.
import { detectFreshnessIntent, extractGooglePublishedAt, freshnessWindow, normalizePublishedAt, rankFreshResults } from './miraSearchFreshness'
import { fuseSearchProviders } from './miraSearchRelevance'
import { searchJina } from './miraJinaSearch'
import { buildMiraSearchQueries, publicMiraSearchQuery, publicMiraSearchUrl } from './miraSearchQuery'

const SEARCH_CACHE = new Map()
const SEARCH_IN_FLIGHT = new Map()
const MAX_CACHE_ENTRIES = 100
const DEFAULT_SEARCH_BUDGET_MS = 4800
const RESULT_GRACE_MS = 140
const signalWithin = (signal, milliseconds) => signal ? AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds)

function cleanRssText(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRSS(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const title = cleanRssText(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const desc = cleanRssText(block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] || '');
    const rawLink = block.match(/<link>([^<]+)<\/link>/)?.[1]?.trim()
      || block.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1]?.trim() || '';
    const publishedAt = normalizePublishedAt(
      block.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1]
      || block.match(/<dc:date>([^<]+)<\/dc:date>/i)?.[1]
      || '',
    );
    const cleanLink = rawLink.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // Decode Bing redirect URLs to get real URL
    let url = cleanLink;
    try {
      const u = new URL(cleanLink);
      const real = u.searchParams.get('url') || u.searchParams.get('r');
      if (real) url = decodeURIComponent(real);
    } catch {}
    if (title.length > 3) items.push({ title, snippet: desc || title, url, ...(publishedAt ? { publishedAt } : {}) });
  }
  return items;
}

async function searchBrave(query, fresh = false, window = freshnessWindow(query), signal) {
  const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY
  if (!BRAVE_KEY) return null;
  try {
    const params = new URLSearchParams({
      q: query,
      count: '10',
      search_lang: /[\u0900-\u097F]/u.test(query) ? 'hi' : 'en',
      safesearch: 'moderate',
      spellcheck: 'true',
      extra_snippets: 'true',
      ...(fresh ? { freshness: window.brave } : {}),
    });
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY }, signal: signalWithin(signal, 4000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data?.web?.results || []).map(r => ({
      title: r.title,
      snippet: [r.description, ...(Array.isArray(r.extra_snippets) ? r.extra_snippets.slice(0, 2) : [])].filter(Boolean).join(' '),
      url: r.url,
      ...(normalizePublishedAt(r.page_age || r.age || r.published || '') ? { publishedAt: normalizePublishedAt(r.page_age || r.age || r.published || '') } : {}),
    })).filter(r => r.snippet);
    return results.length ? results : null;
  } catch { return null; }
}

async function searchGoogle(query, fresh = false, window = freshnessWindow(query), signal) {
  const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY, GOOGLE_CX = process.env.GOOGLE_SEARCH_CX
  if (!GOOGLE_KEY || !GOOGLE_CX) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=10&safe=active&hl=en${fresh ? `&dateRestrict=${window.google}&sort=date` : ''}`,
      { signal: signalWithin(signal, 4000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data?.items || []).map(r => ({
      title: r.title,
      snippet: r.snippet || r.title,
      url: r.link,
      ...(extractGooglePublishedAt(r) ? { publishedAt: extractGooglePublishedAt(r) } : {}),
    })).filter(r => r.snippet);
    return results.length ? results : null;
  } catch { return null; }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const decodeHtmlEntities = cleanRssText
const cleanImageText = cleanRssText
async function searchBingNews(query, signal) {
  try {
    const res = await fetch(
      `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
      { headers: { 'User-Agent': UA }, signal: signalWithin(signal, 3500) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 5);
    return items.length ? items : null;
  } catch { return null; }
}

async function searchBingWeb(query, signal) {
  try {
    const res = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`,
      { headers: { 'User-Agent': UA }, signal: signalWithin(signal, 3500) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 8);
    return items.length ? items : null;
  } catch { return null; }
}

async function searchGoogleNews(query, signal) {
  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { 'User-Agent': UA }, signal: signalWithin(signal, 3500) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 5);
    return items.length ? items : null;
  } catch { return null; }
}

async function searchDDG(query, signal) {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: signalWithin(signal, 2500) }
    );
    const d = await res.json();
    const results = [];
    if (d.Answer) results.push({ title: 'Direct Answer', snippet: d.Answer, url: '' });
    if (d.AbstractText) results.push({ title: d.Heading || query, snippet: d.AbstractText, url: d.AbstractURL || '' });
    return results.length ? results : null;
  } catch { return null; }
}

async function searchDDGHtml(query, signal) {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: signalWithin(signal, 3500),
      },
    );
    if (!res.ok) return null;
    const html = await res.text();
    const blocks = html.split(/class="result results_links[^"]*"/i).slice(1, 15);
    const results = blocks.map((block) => {
      const anchor = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!anchor) return null;
      let url = decodeHtmlEntities(anchor[1]);
      try {
        const parsed = new URL(url, 'https://html.duckduckgo.com');
        url = parsed.searchParams.get('uddg') ? decodeURIComponent(parsed.searchParams.get('uddg')) : parsed.href;
      } catch { /* keep raw URL */ }
      const title = cleanImageText(anchor[2]);
      const snippet = cleanImageText(
        block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] || title,
      );
      return title ? { title, snippet: snippet || title, url } : null;
    }).filter(Boolean);
    return results.length ? results : null;
  } catch {
    return null;
  }
}


function fusedResults(groups, query, fresh, window) {
  const candidates = groups.map(group => ({ ...group, results: (group.results || []).flatMap(item => {
    const url = publicMiraSearchUrl(item?.url)
    return url ? [{ ...item, url }] : []
  }) }))
  let results = fuseSearchProviders(candidates, query, 10)
  if (fresh) results = rankFreshResults(results, window)
  return results.slice(0, 6).map(result => ({
    title: cleanRssText(result.title).slice(0, 240), snippet: cleanRssText(result.snippet).slice(0, 1800),
    url: result.url, publishedAt: normalizePublishedAt(result.publishedAt), provider: result.provider,
  }))
}

// Return as soon as useful evidence arrives; a stuck fallback must not hold a
// good Jina/Brave result hostage. Every losing fetch is cancelled at the boundary.
function searchWave(query, relevanceQuery, fresh, window, signal, budgetMs, recovery) {
  signal.throwIfAborted()
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const jobs = [
    ...(process.env.JINA_API_KEY ? [{ provider: 'jina', weight: 4, run: () => searchJina(query, { signal: combined }) }] : []),
    ...(process.env.BRAVE_SEARCH_API_KEY ? [{ provider: 'brave', weight: 3, run: () => searchBrave(query, fresh, window, combined) }] : []),
    ...(!recovery && process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX ? [{ provider: 'google', weight: 3, run: () => searchGoogle(query, fresh, window, combined) }] : []),
    { provider: 'bing-web', weight: 1.5, run: () => searchBingWeb(query, combined) },
    { provider: 'duckduckgo-html', weight: 2, run: () => searchDDGHtml(query, combined) },
    ...(fresh ? [
      { provider: 'bing-news', weight: 2.5, run: () => searchBingNews(query, combined) },
      { provider: 'google-news', weight: 2.5, run: () => searchGoogleNews(query, combined) },
    ] : !recovery ? [{ provider: 'duckduckgo', weight: 2, run: () => searchDDG(query, combined) }] : []),
  ]
  return new Promise((resolve, reject) => {
    const groups = []
    let outstanding = jobs.length, finished = false, grace
    const finish = error => {
      if (finished) return
      finished = true
      clearTimeout(deadline); clearTimeout(grace)
      signal.removeEventListener('abort', abort)
      controller.abort()
      error ? reject(error) : resolve(groups)
    }
    const abort = () => finish(signal.reason || new DOMException('Search cancelled', 'AbortError'))
    const deadline = setTimeout(() => finish(), budgetMs)
    signal.addEventListener('abort', abort, { once: true })
    for (const job of jobs) Promise.resolve().then(job.run).then(results => {
      if (finished || !Array.isArray(results) || !results.length) return
      groups.push({ provider: job.provider, weight: job.weight, results })
      if (fusedResults(groups, relevanceQuery, fresh, window).length && !grace) grace = setTimeout(() => finish(), RESULT_GRACE_MS)
    }).catch(() => {}).finally(() => {
      if (--outstanding === 0) finish()
    })
  })
}

async function runSearch(query, { signal, timeoutMs }) {
  const startedAt = Date.now(), fresh = detectFreshnessIntent(query), window = freshnessWindow(query)
  const queries = buildMiraSearchQueries(query, fresh)
  const relevanceQuery = queries[0] || query
  let attempts = 0, used = queries[0] || query, results = []
  for (const variant of queries) {
    signal.throwIfAborted()
    const remaining = timeoutMs - (Date.now() - startedAt)
    if (remaining <= 0) break
    used = variant; attempts++
    const groups = await searchWave(variant, relevanceQuery, fresh, window, signal, Math.min(remaining, attempts === 1 && queries.length > 1 ? 2800 : remaining), attempts > 1)
    results = fusedResults(groups, relevanceQuery, fresh, window)
    if (results.length) break
  }
  return {
    source: 'MIRA fused web search', retrievedAt: new Date().toISOString(), results,
    searchMeta: { queryUsed: used, attempts, recovered: attempts > 1, freshness: fresh, elapsedMs: Date.now() - startedAt, cacheHit: false },
    ...(fresh && results.length && results.every(result => !result.publishedAt) ? { freshnessUnverified: true, limitation: 'These sources do not expose publication dates. Do not claim that a date or current status is verified from them.' } : {}),
    ...(results.length ? {} : { unavailable: 'No relevant public results were found within the search budget. Do not claim live verification.' }),
  }
}

function subscribeSearch(entry, signal) {
  signal?.throwIfAborted()
  entry.users++
  return new Promise((resolve, reject) => {
    let finished = false
    const settle = (callback, value) => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', abort)
      entry.users--
      if (!entry.users && !entry.finished) entry.controller.abort()
      callback(value)
    }
    const abort = () => settle(reject, signal.reason || new DOMException('Search cancelled', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    entry.promise.then(value => settle(resolve, structuredClone(value)), error => settle(reject, error))
  })
}

export async function searchMiraInternet(value, { signal, timeoutMs = DEFAULT_SEARCH_BUDGET_MS } = {}) {
  signal?.throwIfAborted()
  const query = publicMiraSearchQuery(value)
  if (!query) return { source: 'MIRA fused web search', results: [], unavailable: 'Public search cannot accept private account data or credential-bearing URLs.' }
  const budget = Math.max(100, Math.min(8000, Number(timeoutMs) || DEFAULT_SEARCH_BUDGET_MS))
  const key = `${detectFreshnessIntent(query) ? new Date().toISOString().slice(0, 10) : ''}:${query.toLocaleLowerCase()}`
  const cached = SEARCH_CACHE.get(key)
  if (cached?.expiresAt > Date.now()) return { ...structuredClone(cached.result), searchMeta: { ...cached.result.searchMeta, cacheHit: true } }
  let entry = SEARCH_IN_FLIGHT.get(key)
  if (!entry || entry.controller.signal.aborted) {
    entry = { controller: new AbortController(), users: 0, finished: false }
    entry.promise = runSearch(query, { signal: entry.controller.signal, timeoutMs: budget }).then(result => {
      if (result.results.length) {
        if (SEARCH_CACHE.size >= MAX_CACHE_ENTRIES && !SEARCH_CACHE.has(key)) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value)
        SEARCH_CACHE.set(key, { result, expiresAt: Date.now() + (detectFreshnessIntent(query) ? 30000 : 120000) })
      }
      return result
    }).finally(() => {
      entry.finished = true
      if (SEARCH_IN_FLIGHT.get(key) === entry) SEARCH_IN_FLIGHT.delete(key)
    })
    SEARCH_IN_FLIGHT.set(key, entry)
  }
  return subscribeSearch(entry, signal)
}
