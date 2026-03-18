import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { buildCacheKey, getCache, setCache } from '@/lib/cache';
import { buildSearchQuery, fetchRoleNews } from '@/lib/roleNews';

// Redis cache TTLs (seconds)
const ROLE_NEWS_TTL = 30 * 60      // 30 min for normal requests
const ROLE_NEWS_FRESH_TTL = 10 * 60 // 10 min even for "fresh" requests

export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Employee', 'Designation']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }

        const { user, models, tenant } = auth;
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
                designation = employee.designation?.title || employee.designationLevelName || '';
                department = employee.department?.name || '';
            }
        }

        const { searchParams } = new URL(request.url);
        const fresh = searchParams.get('fresh') === 'true';

        // Build search query from designation and role
        const searchQuery = buildSearchQuery(designation, department, role);

        // Check Redis cache first - always serve from cache even for fresh=true
        // (fresh=true only uses a shorter write-TTL, not a cache bypass)
        const newsCacheKey = buildCacheKey({
            tenantId: tenant?.databaseName,
            role,
            userId: 'all',
            namespace: 'role-news',
            params: { searchQuery },
        })
        const cachedNews = await getCache(newsCacheKey)
        if (cachedNews) {
            return NextResponse.json({ ...cachedNews, cached: true })
        }

        const freshnessOptions = fresh
            ? { freshnessMinutes: 60, maxAgeMinutes: 60 }
            : { freshnessDays: 7 };
        const relaxedFreshnessOptions = fresh
            ? { freshnessHours: 24 }
            : { freshnessDays: 7 };

        // Fetch news - try multiple queries if needed
        let news = await fetchRoleNews(searchQuery, 5, freshnessOptions);

        if (fresh && news.length === 0) {
            news = await fetchRoleNews(searchQuery, 5, relaxedFreshnessOptions);
        }

        // If no results, try a simpler query
        if (news.length === 0 && designation) {
            const simpleQuery = `${designation} news ${new Date().getFullYear()} latest`;
            news = await fetchRoleNews(simpleQuery, 5, freshnessOptions);

            if (fresh && news.length === 0) {
                news = await fetchRoleNews(simpleQuery, 5, relaxedFreshnessOptions);
            }
        }

        // Last resort: use generic tech/business news
        if (news.length === 0) {
            const fallbackQuery = department
                ? `${department} industry news trends ${new Date().getFullYear()} latest`
                : `technology software industry news ${new Date().getFullYear()} latest`;
            news = await fetchRoleNews(fallbackQuery, 5, freshnessOptions);

            if (fresh && news.length === 0) {
                news = await fetchRoleNews(fallbackQuery, 5, relaxedFreshnessOptions);
            }
        }

        // Cache results in Redis
        if (news.length > 0) {
            const ttl = fresh ? ROLE_NEWS_FRESH_TTL : ROLE_NEWS_TTL
            const newsPayload = { success: true, news, designation, role, searchQuery, cached: false }
            await setCache(newsCacheKey, newsPayload, ttl).catch(() => { })
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
