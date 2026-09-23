// Text-search pipeline ported from MIRA/api/search.js. Media crawling is intentionally excluded.
import { detectFreshnessIntent, extractGooglePublishedAt, freshnessWindow, normalizePublishedAt, rankFreshResults } from './miraSearchFreshness'
import { fuseSearchProviders } from './miraSearchRelevance'
import { searchJina } from './miraJinaSearch'
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;

function cleanRssText(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
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

async function searchBrave(query, fresh = false, window = freshnessWindow(query)) {
  if (!BRAVE_KEY) return null;
  try {
    const params = new URLSearchParams({
      q: query,
      count: '10',
      search_lang: 'en',
      safesearch: 'moderate',
      spellcheck: 'true',
      extra_snippets: 'true',
      ...(fresh ? { freshness: window.brave } : {}),
    });
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY }, signal: AbortSignal.timeout(8000) }
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

async function searchGoogle(query, fresh = false, window = freshnessWindow(query)) {
  if (!GOOGLE_KEY || !GOOGLE_CX) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=10&safe=active&hl=en${fresh ? `&dateRestrict=${window.google}&sort=date` : ''}`,
      { signal: AbortSignal.timeout(8000) }
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
async function searchBingNews(query) {
  try {
    const res = await fetch(
      `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 5);
    return items.length ? items : null;
  } catch { return null; }
}

async function searchBingWeb(query) {
  try {
    const res = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 8);
    return items.length ? items : null;
  } catch { return null; }
}

async function searchGoogleNews(query) {
  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const items = parseRSS(await res.text()).slice(0, 5);
    return items.length ? items : null;
  } catch { return null; }
}

async function searchDDG(query) {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    const d = await res.json();
    const results = [];
    if (d.Answer) results.push({ title: 'Direct Answer', snippet: d.Answer, url: '' });
    if (d.AbstractText) results.push({ title: d.Heading || query, snippet: d.AbstractText, url: d.AbstractURL || '' });
    return results.length ? results : null;
  } catch { return null; }
}

async function searchDDGHtml(query) {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(8000),
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


export async function searchMiraInternet(query) {
  const fresh = detectFreshnessIntent(query), window = freshnessWindow(query)
  const [jina, brave, google, bingWeb, bingNews, googleNews, ddg, ddgHtml] = await Promise.all([
    searchJina(query), searchBrave(query, fresh, window), searchGoogle(query, fresh, window),
    searchBingWeb(query), searchBingNews(query), searchGoogleNews(query), searchDDG(query), searchDDGHtml(query),
  ])
  const groups = [
    { provider: 'jina', results: jina, weight: 4 }, { provider: 'brave', results: brave, weight: 3 },
    { provider: 'google', results: google, weight: 3 }, { provider: 'bing-web', results: bingWeb, weight: 1.5 },
    { provider: 'bing-news', results: bingNews, weight: fresh ? 2.5 : 1 },
    { provider: 'google-news', results: googleNews, weight: fresh ? 2.5 : 1 },
    { provider: 'duckduckgo', results: ddg, weight: 2 }, { provider: 'duckduckgo-html', results: ddgHtml, weight: 2 },
  ]
  let results = fuseSearchProviders(groups, query, 8)
  if (fresh) results = rankFreshResults(results, window)
  results = results.filter(r => { try { return ['http:', 'https:'].includes(new URL(r.url).protocol) } catch { return false } })
    .slice(0, 6).map(r => ({ title: String(r.title).slice(0, 240), snippet: String(r.snippet).slice(0, 1800), url: r.url, publishedAt: r.publishedAt || '', provider: r.provider }))
  return { source: 'MIRA fused web search', retrievedAt: new Date().toISOString(), results,
    ...(results.length ? {} : { unavailable: 'No relevant public results were found. Do not claim live verification.' }) }
}
