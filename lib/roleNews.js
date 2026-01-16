const DEFAULT_FRESHNESS_DAYS = 7

const DESIGNATION_MAPPINGS = {
  // Backend Development
  'backend': 'backend development programming nodejs python java',
  'backend developer': 'backend development APIs nodejs python java',
  'backend engineer': 'backend engineering microservices APIs',
  'node': 'nodejs backend javascript server development',
  'nodejs': 'nodejs backend javascript express development',
  'python': 'python development django flask programming',
  'java': 'java development spring boot backend',
  'php': 'php development laravel backend programming',
  'ruby': 'ruby rails backend development',
  'golang': 'golang go programming backend',
  'go developer': 'golang microservices backend',
  '.net': 'dotnet csharp backend development',
  'c#': 'csharp dotnet backend microsoft',

  // Frontend Development
  'frontend': 'frontend development react angular vue javascript',
  'frontend developer': 'frontend react javascript web development',
  'frontend engineer': 'frontend engineering UI javascript',
  'react': 'react javascript frontend web development',
  'angular': 'angular typescript frontend development',
  'vue': 'vuejs javascript frontend development',
  'ui developer': 'UI development frontend javascript CSS',

  // Full Stack
  'fullstack': 'fullstack development MERN MEAN javascript',
  'full stack': 'full stack development web javascript',
  'full-stack': 'fullstack web development javascript',
  'mern': 'MERN stack react nodejs mongodb',
  'mean': 'MEAN stack angular nodejs mongodb',

  // WordPress/CMS
  'wordpress': 'wordpress development themes plugins PHP',
  'wp developer': 'wordpress themes plugins development',
  'cms': 'CMS development wordpress drupal',
  'drupal': 'drupal development PHP CMS',
  'shopify': 'shopify ecommerce development',
  'woocommerce': 'woocommerce wordpress ecommerce',

  // Mobile Development
  'mobile': 'mobile app development iOS android',
  'android': 'android development kotlin java mobile',
  'ios': 'iOS development swift mobile apple',
  'flutter': 'flutter dart mobile cross-platform',
  'react native': 'react native mobile development',
  'swift': 'swift iOS apple development',
  'kotlin': 'kotlin android mobile development',

  // DevOps/Cloud
  'devops': 'devops CI/CD kubernetes docker cloud',
  'cloud': 'cloud computing AWS azure GCP',
  'aws': 'AWS cloud services amazon',
  'azure': 'azure microsoft cloud services',
  'kubernetes': 'kubernetes container orchestration devops',
  'docker': 'docker containerization devops',
  'sre': 'site reliability engineering devops',

  // Data/AI/ML
  'data scientist': 'data science machine learning AI analytics',
  'data analyst': 'data analytics business intelligence SQL',
  'data engineer': 'data engineering ETL pipeline big data',
  'machine learning': 'machine learning AI deep learning',
  'ml engineer': 'machine learning engineering AI',
  'ai': 'artificial intelligence machine learning',
  'ai engineer': 'AI engineering deep learning neural networks',

  // Design
  'ui/ux': 'UI UX design user experience',
  'ux': 'UX design user experience research',
  'ui': 'UI design interface visual',
  'designer': 'design UI UX visual',
  'graphic': 'graphic design visual branding',
  'product designer': 'product design UX UI',

  // QA/Testing
  'qa': 'QA testing software quality assurance',
  'tester': 'software testing QA automation',
  'automation': 'test automation selenium QA',
  'sdet': 'SDET testing automation development',

  // Management
  'project manager': 'project management agile scrum',
  'product manager': 'product management strategy roadmap',
  'tech lead': 'technical leadership engineering management',
  'team lead': 'team leadership management',
  'engineering manager': 'engineering management leadership',
  'cto': 'CTO technology leadership strategy',
  'vp engineering': 'VP engineering leadership technology',

  // HR
  'hr': 'human resources HR trends recruitment',
  'recruiter': 'recruitment talent acquisition hiring',
  'talent': 'talent management HR acquisition',

  // Marketing
  'marketing': 'digital marketing strategy growth',
  'seo': 'SEO search marketing digital',
  'content': 'content marketing strategy',
  'social media': 'social media marketing',

  // Sales
  'sales': 'sales strategy business development',
  'business development': 'business development growth',
  'account': 'account management sales',

  // Finance
  'accountant': 'accounting finance bookkeeping',
  'finance': 'finance accounting business',
  'analyst': 'business analyst data analysis',
}

const ROLE_KEYWORDS = {
  admin: 'business leadership management',
  hr: 'human resources talent management',
  manager: 'team management leadership',
  employee: 'career professional development',
  department_head: 'department leadership strategy',
}

function decodeHTMLEntities(text) {
  if (!text) return ''
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

function formatNewsTime(pubDate) {
  if (!pubDate) return 'Recently'

  try {
    const date = new Date(pubDate)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
  } catch {
    return 'Recently'
  }
}

function detectCategory(title) {
  const t = (title || '').toLowerCase()

  if (t.includes('react') || t.includes('angular') || t.includes('vue') || t.includes('frontend') || t.includes('css') || t.includes('html')) return 'frontend'
  if (t.includes('node') || t.includes('python') || t.includes('java') || t.includes('backend') || t.includes('api') || t.includes('server')) return 'backend'
  if (t.includes('ai') || t.includes('machine learning') || t.includes('ml') || t.includes('gpt') || t.includes('llm')) return 'ai'
  if (t.includes('cloud') || t.includes('aws') || t.includes('azure') || t.includes('devops') || t.includes('kubernetes')) return 'cloud'
  if (t.includes('mobile') || t.includes('android') || t.includes('ios') || t.includes('flutter') || t.includes('app')) return 'mobile'
  if (t.includes('security') || t.includes('cyber') || t.includes('hack') || t.includes('vulnerability')) return 'security'
  if (t.includes('data') || t.includes('analytics') || t.includes('database') || t.includes('sql')) return 'data'
  if (t.includes('startup') || t.includes('funding') || t.includes('investment') || t.includes('company')) return 'business'

  return 'tech'
}

export function buildSearchQuery(designation, department, role) {
  const cleanDesignation = (designation || '').toLowerCase().trim()

  let searchTerms = ''
  for (const [key, value] of Object.entries(DESIGNATION_MAPPINGS)) {
    if (cleanDesignation.includes(key)) {
      searchTerms = value
      break
    }
  }

  if (!searchTerms) {
    searchTerms = cleanDesignation
      ? `${cleanDesignation} industry news trends`
      : 'technology software development news'
  }

  if (department && !searchTerms.toLowerCase().includes(department.toLowerCase())) {
    searchTerms += ` ${department}`
  }

  if (!searchTerms || searchTerms.includes('industry news trends')) {
    const roleTerms = ROLE_KEYWORDS[role] || 'technology industry'
    searchTerms = `${roleTerms} news`
  }

  const year = new Date().getFullYear()
  if (!searchTerms.includes(year.toString())) {
    searchTerms += ` ${year} latest`
  }

  return searchTerms
}

export async function fetchRoleNews(searchQuery, limit = 5, options = {}) {
  const freshnessMinutes = Number.isFinite(options.freshnessMinutes)
    ? Math.max(1, options.freshnessMinutes)
    : null
  const freshnessHours = Number.isFinite(options.freshnessHours)
    ? Math.max(1, options.freshnessHours)
    : null
  const freshnessDays = Number.isFinite(options.freshnessDays)
    ? Math.max(1, options.freshnessDays)
    : DEFAULT_FRESHNESS_DAYS
  const maxAgeMinutes = Number.isFinite(options.maxAgeMinutes)
    ? Math.max(1, options.maxAgeMinutes)
    : null

  let freshnessToken = ''
  if (freshnessMinutes) {
    freshnessToken = ` when:${freshnessMinutes}m`
  } else if (freshnessHours) {
    freshnessToken = ` when:${freshnessHours}h`
  } else {
    freshnessToken = ` when:${freshnessDays}d`
  }

  const freshnessSuffix = searchQuery.includes('when:') ? '' : freshnessToken
  const query = `${searchQuery}${freshnessSuffix}`
  const encodedQuery = encodeURIComponent(query)
  const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`

  try {
    const response = await fetch(rssUrl, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      console.error(`Google News RSS error: ${response.status}`)
      return []
    }

    const xmlText = await response.text()
    const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/g) || []

    const items = []
    for (let i = 0; i < Math.min(itemMatches.length, limit * 3); i += 1) {
      const itemXml = itemMatches[i]

      const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)
      const linkMatch = itemXml.match(/<link>(.*?)<\/link>/)
      const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)
      const sourceMatch = itemXml.match(/<source.*?>(.*?)<\/source>/)

      const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : ''
      const link = linkMatch ? linkMatch[1].trim() : ''
      const pubDate = pubDateMatch ? pubDateMatch[1].trim() : ''
      const source = sourceMatch ? sourceMatch[1].trim() : 'News'

      if (title && link) {
        items.push({
          title: decodeHTMLEntities(title),
          link,
          source: decodeHTMLEntities(source),
          pubDate,
          publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
          category: detectCategory(title),
        })
      }
    }

    let filteredItems = items
    if (maxAgeMinutes) {
      const cutoffTime = Date.now() - (maxAgeMinutes * 60 * 1000)
      filteredItems = items.filter((item) => {
        if (!item.publishedAt) return false
        const publishedTime = new Date(item.publishedAt).getTime()
        return publishedTime >= cutoffTime
      })

      if (filteredItems.length === 0 && items.length > 0) {
        filteredItems = items
      }
    }

    filteredItems.sort((a, b) => {
      const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
      const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
      return bTime - aTime
    })

    return filteredItems.slice(0, limit).map((item) => ({
      title: item.title,
      link: item.link,
      source: item.source,
      time: formatNewsTime(item.pubDate),
      category: item.category,
      publishedAt: item.publishedAt,
    }))
  } catch (error) {
    console.error('Error fetching Google News:', error)
    return []
  }
}
