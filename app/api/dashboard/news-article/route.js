import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { generateContent } from '@/lib/gemini'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'

// Cache TTL: 2 hours for article content + summary
const ARTICLE_CACHE_TTL = 7200

/**
 * Try to decode a Google News RSS article URL to get the real publisher URL.
 * Google News RSS URLs look like: https://news.google.com/rss/articles/CBMi...
 * The base64 portion after "articles/" contains the real URL.
 */
function decodeGoogleNewsUrl(url) {
  try {
    if (!url.includes('news.google.com')) return null

    // Extract the encoded portion from the URL
    const articlesMatch = url.match(/\/articles\/([A-Za-z0-9_-]+)/)
    if (!articlesMatch) return null

    let encoded = articlesMatch[1]
    // Add padding if needed for base64
    while (encoded.length % 4 !== 0) encoded += '='
    // Replace URL-safe base64 chars
    encoded = encoded.replace(/-/g, '+').replace(/_/g, '/')

    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')

    // Extract URLs from the decoded string
    const urlMatch = decoded.match(/https?:\/\/[^\s"'<>\x00-\x1f]+/)
    if (urlMatch) {
      // Clean up the URL (may have trailing garbage bytes)
      let cleanUrl = urlMatch[0]
      cleanUrl = cleanUrl.replace(/[^\w\-_.~:/?#[\]@!$&'()*+,;=%]+$/, '')
      return cleanUrl
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fetch and extract article content from a direct publisher URL.
 */
async function fetchArticleContent(url) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) return { text: '', image: '', description: '' }

    const html = await response.text()

    // ── Extract image ──
    let image = ''
    const ogImageMatch = html.match(
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i
    )
    image = ogImageMatch?.[1] || ''

    if (!image) {
      const twitterImageMatch = html.match(
        /<meta[^>]*(?:name|property)=["']twitter:image["'][^>]*content=["']([^"']+)["']/i
      ) || html.match(
        /<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']twitter:image["']/i
      )
      image = twitterImageMatch?.[1] || ''
    }

    // ── Extract description ──
    const ogDescMatch = html.match(
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i
    ) || html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i
    )
    const description = ogDescMatch?.[1] || ''

    // ── Extract article body text ──
    const articleTagMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    const mainTagMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)

    const rawContent = articleTagMatch?.[1] || mainTagMatch?.[1] || bodyMatch?.[1] || ''

    let text = rawContent
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<form[\s\S]*?<\/form>/gi, '')
      .replace(/<figure[\s\S]*?<\/figure>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()

    // Truncate to ~6000 chars for AI processing
    if (text.length > 6000) text = text.slice(0, 6000) + '...'

    return { text, image, description }
  } catch (err) {
    console.error('[NewsArticle] fetchArticleContent error:', err.message)
    return { text: '', image: '', description: '' }
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, [])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { url, title, source } = body

    if (!url) {
      return NextResponse.json({ success: false, message: 'URL is required' }, { status: 400 })
    }

    // ── Check cache ──
    const urlHash = Buffer.from(url).toString('base64').slice(0, 40)
    const cacheKey = buildCacheKey({
      tenantId: auth.tenant?.databaseName,
      role: 'any',
      userId: 'shared',
      namespace: `news:article:${urlHash}`,
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json({ success: true, ...cached, cached: true })
    }

    // ── Step 1: Try to resolve the real article URL ──
    let realUrl = url
    let articleText = ''
    let articleImage = ''
    let articleDescription = ''

    // If it's a Google News URL, try to decode it to get the publisher URL
    if (url.includes('news.google.com')) {
      const decodedUrl = decodeGoogleNewsUrl(url)
      if (decodedUrl) {
        realUrl = decodedUrl
        console.log(`[NewsArticle] Decoded Google News URL -> ${realUrl}`)
      }
    }

    // ── Step 2: Try to fetch the actual article ──
    if (realUrl && !realUrl.includes('news.google.com')) {
      const scraped = await fetchArticleContent(realUrl)
      articleText = scraped.text
      articleImage = scraped.image
      articleDescription = scraped.description
      console.log(`[NewsArticle] Scraped ${articleText.length} chars from ${realUrl}`)
    }

    // ── Step 3: Generate AI content ──
    let summary = ''
    let aiArticle = ''

    // Check if we got real article content (not Google News boilerplate)
    const hasGoodContent = articleText.length > 200 &&
      !articleText.includes('Comprehensive, up-to-date news coverage, aggregated') &&
      !articleText.toLowerCase().includes('google news')

    try {
      if (hasGoodContent) {
        // We have real article content -> generate a summary
        const prompt = `You are reading this news article. Write a clear, detailed summary covering all the key points.\n\nTitle: ${title}\nSource: ${source || 'News'}\n\nFull article text:\n${articleText}`
        const systemInstruction = 'You are a professional news analyst. Write a comprehensive summary of the article in 4-6 well-structured sentences. Cover the who, what, when, where, why and impact. Output only the summary text, no headings or markdown formatting.'

        const result = await generateContent(prompt, systemInstruction, { useCase: 'creative' })
        if (typeof result === 'string' && result.length > 30) {
          summary = result.trim()
        }
      } else {
        // No real article content available -> ask AI to write a detailed briefing
        const prompt = `Write a detailed, factual news briefing about this story:\n\nHeadline: ${title}\nSource: ${source || 'News'}\nDescription: ${articleDescription || 'N/A'}\n\nProvide:\n1. A 3-4 sentence executive summary\n2. Then a detailed breakdown covering the key facts, context, implications, and what this means for the industry or people involved. Write 3-4 substantive paragraphs.\n\nBase your analysis on the headline and publicly known facts about this topic. Be factual and informative.`
        const systemInstruction = 'You are a senior news analyst writing an in-depth briefing for professionals. Write in a professional journalistic style. Structure your response as:\n\nSUMMARY:\n[3-4 sentence executive summary]\n\nDETAILS:\n[3-4 detailed paragraphs]\n\nUse plain text only, no markdown. Be thorough but factual. Do not fabricate specific quotes or statistics you are not sure about.'

        const result = await generateContent(prompt, systemInstruction, { useCase: 'creative' })
        if (typeof result === 'string' && result.length > 50) {
          const fullText = result.trim()

          // Split into summary and details
          const summaryMatch = fullText.match(/SUMMARY:\s*([\s\S]*?)(?=DETAILS:|$)/i)
          const detailsMatch = fullText.match(/DETAILS:\s*([\s\S]*)/i)

          if (summaryMatch && detailsMatch) {
            summary = summaryMatch[1].trim()
            aiArticle = detailsMatch[1].trim()
          } else {
            // If no clear sections, use first 3 sentences as summary, rest as article
            const sentences = fullText.split(/(?<=[.!?])\s+/)
            summary = sentences.slice(0, 3).join(' ')
            aiArticle = sentences.slice(3).join(' ')
          }
        }
      }
    } catch (err) {
      console.error('[NewsArticle] AI generation error:', err.message)
    }

    // ── Build final content ──
    const displayContent = hasGoodContent
      ? articleText
      : (aiArticle || articleDescription || 'Detailed content is not available for this article. Click "Open Original" to read the full story.')

    // ── Build response ──
    const articleData = {
      content: displayContent,
      image: articleImage,
      summary: summary || '',
      title: title || '',
      url: (!realUrl.includes('news.google.com') ? realUrl : url),
      source: source || '',
      aiGenerated: !hasGoodContent,
    }

    // Cache result
    setCache(cacheKey, articleData, ARTICLE_CACHE_TTL).catch(() => {})

    return NextResponse.json({ success: true, ...articleData })
  } catch (error) {
    console.error('[NewsArticle] Error:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch article' }, { status: 500 })
  }
}
