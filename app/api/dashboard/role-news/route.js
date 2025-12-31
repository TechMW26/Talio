import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

// Cache for news (15 minutes)
const newsCache = new Map();
const CACHE_DURATION = 15 * 60 * 1000;

/**
 * Build search query directly from designation and role
 * This ensures highly relevant news based on exact job role
 */
function buildSearchQuery(designation, department, role) {
    // Clean and normalize designation
    const cleanDesignation = (designation || '').toLowerCase().trim();

    // Direct mapping for common designations to specific search terms
    const designationMappings = {
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
    };

    // Find matching designation
    let searchTerms = '';

    for (const [key, value] of Object.entries(designationMappings)) {
        if (cleanDesignation.includes(key)) {
            searchTerms = value;
            break;
        }
    }

    // If no specific match, use designation directly + tech/industry news
    if (!searchTerms) {
        searchTerms = cleanDesignation
            ? `${cleanDesignation} industry news trends`
            : 'technology software development news';
    }

    // Add department context if available and different from designation
    if (department && !searchTerms.toLowerCase().includes(department.toLowerCase())) {
        searchTerms += ` ${department}`;
    }

    // Role-based fallback keywords
    const roleKeywords = {
        'admin': 'business leadership management',
        'hr': 'human resources talent management',
        'manager': 'team management leadership',
        'employee': 'career professional development',
        'department_head': 'department leadership strategy'
    };

    // If still no good search terms, use role
    if (!searchTerms || searchTerms.includes('industry news trends')) {
        const roleTerms = roleKeywords[role] || 'technology industry';
        searchTerms = `${roleTerms} news ${new Date().getFullYear()}`;
    }

    return searchTerms;
}

/**
 * Fetch real news from Google News RSS
 */
async function fetchGoogleNews(searchQuery, limit = 5) {
    try {
        const encodedQuery = encodeURIComponent(searchQuery);
        const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;

        const response = await fetch(rssUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            console.error(`Google News RSS error: ${response.status}`);
            return [];
        }

        const xmlText = await response.text();

        // Parse RSS XML
        const items = [];
        const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/g) || [];

        for (let i = 0; i < Math.min(itemMatches.length, limit); i++) {
            const itemXml = itemMatches[i];

            const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
            const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
            const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);
            const sourceMatch = itemXml.match(/<source.*?>(.*?)<\/source>/);

            const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
            const link = linkMatch ? linkMatch[1].trim() : '';
            const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
            const source = sourceMatch ? sourceMatch[1].trim() : 'News';

            if (title && link) {
                items.push({
                    title: decodeHTMLEntities(title),
                    link,
                    source: decodeHTMLEntities(source),
                    time: formatNewsTime(pubDate),
                    category: detectCategory(title)
                });
            }
        }

        return items;
    } catch (error) {
        console.error('Error fetching Google News:', error);
        return [];
    }
}

/**
 * Decode HTML entities
 */
function decodeHTMLEntities(text) {
    if (!text) return '';
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}

/**
 * Format time for display
 */
function formatNewsTime(pubDate) {
    if (!pubDate) return 'Recently';

    try {
        const date = new Date(pubDate);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    } catch {
        return 'Recently';
    }
}

/**
 * Detect news category from title
 */
function detectCategory(title) {
    const t = (title || '').toLowerCase();

    if (t.includes('react') || t.includes('angular') || t.includes('vue') || t.includes('frontend') || t.includes('css') || t.includes('html')) return 'frontend';
    if (t.includes('node') || t.includes('python') || t.includes('java') || t.includes('backend') || t.includes('api') || t.includes('server')) return 'backend';
    if (t.includes('ai') || t.includes('machine learning') || t.includes('ml') || t.includes('gpt') || t.includes('llm')) return 'ai';
    if (t.includes('cloud') || t.includes('aws') || t.includes('azure') || t.includes('devops') || t.includes('kubernetes')) return 'cloud';
    if (t.includes('mobile') || t.includes('android') || t.includes('ios') || t.includes('flutter') || t.includes('app')) return 'mobile';
    if (t.includes('security') || t.includes('cyber') || t.includes('hack') || t.includes('vulnerability')) return 'security';
    if (t.includes('data') || t.includes('analytics') || t.includes('database') || t.includes('sql')) return 'data';
    if (t.includes('startup') || t.includes('funding') || t.includes('investment') || t.includes('company')) return 'business';

    return 'tech';
}

export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Employee', 'Designation']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }

        const { user, models } = auth;
        const role = user.role || 'employee';

        // Get employee designation
        let designation = '';
        let department = '';

        if (user.employeeId) {
            const employeeId = typeof user.employeeId === 'object' ? user.employeeId._id : user.employeeId;
            const employee = await models.Employee.findById(employeeId)
                .populate('department', 'name')
                .populate('designation', 'title');

            if (employee) {
                // Get designation title from populated field
                designation = employee.designation?.title || employee.designationLevelName || '';
                department = employee.department?.name || '';
            }
        }

        // Build search query from designation and role
        const searchQuery = buildSearchQuery(designation, department, role);

        // Check cache
        const cacheKey = `news_${searchQuery}`;
        const cached = newsCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
            return NextResponse.json({
                success: true,
                news: cached.news,
                designation,
                role,
                searchQuery,
                cached: true
            });
        }

        // Fetch news - try multiple queries if needed
        let news = await fetchGoogleNews(searchQuery, 5);

        // If no results, try a simpler query
        if (news.length === 0 && designation) {
            const simpleQuery = `${designation} news 2025`;
            news = await fetchGoogleNews(simpleQuery, 5);
        }

        // Last resort: use generic tech/business news
        if (news.length === 0) {
            const fallbackQuery = department
                ? `${department} industry news trends 2025`
                : 'technology software industry news 2025';
            news = await fetchGoogleNews(fallbackQuery, 5);
        }

        // Cache results
        if (news.length > 0) {
            newsCache.set(cacheKey, {
                news,
                timestamp: Date.now()
            });
        }

        return NextResponse.json({
            success: true,
            news,
            designation,
            role,
            searchQuery,
            cached: false
        });

    } catch (error) {
        console.error('Role News API Error:', error);
        return NextResponse.json(
            { message: 'Failed to fetch news', error: error.message },
            { status: 500 }
        );
    }
}
